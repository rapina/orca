import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { isValidPaneKey } from '../agent-hooks/server'
import { assistantTextsFromTranscriptTail } from '../../shared/agent-transcript-evidence'
import {
  auditPaneBindings,
  type PaneBindingFinding,
  type PaneBindingStatusInput,
  type PaneOutputSample
} from '../../shared/pane-binding-audit'

/** Why: enough recorded output to carry a session's own turns, small enough that
 *  auditing a dozen terminals stays a single on-demand read each. */
const TAIL_BYTES = 512 * 1024
/** Why this large: a busy transcript's tail is mostly tool results, and the audit
 *  needs the last few turns the agent actually spoke. */
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024
const TRANSCRIPT_EVIDENCE_MAX = 4
const MAX_PANES = 200
const MAX_STATUSES = 200
/** Why bounded: a transcript turn can be enormous, and every window of it costs a
 *  scan of every terminal's tail. */
const MAX_EVIDENCE_LENGTH = 2000

export type PaneBindingAuditStatus = {
  paneKey: string
  sessionId: string
  /** The session's own on-disk record, when its hook reported one. */
  transcriptPath?: string
}

export type PaneBindingAuditRequest = {
  panes: { paneKey: string; ptyId: string }[]
  statuses: PaneBindingAuditStatus[]
}

function historyLogPath(ptyId: string): string {
  return join(app.getPath('userData'), 'terminal-history', encodeURIComponent(ptyId), 'output.log')
}

/** Why the tail only: these files run to megabytes, and what a live session put on
 *  screen is at the end of both its recording and its transcript. */
async function readTail(path: string, tailBytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const { size } = await stat(path)
    const length = Math.min(size, tailBytes)
    if (length === 0) {
      return ''
    }
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf-8')
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * What this session itself said, read from its own record.
 *
 * Why not the status fields: see the note on `agent-transcript-evidence`. Text on
 * a shared pane key can belong to another session and would point confidently at
 * that session's terminal.
 */
async function readTranscriptEvidence(transcriptPath: string): Promise<string[]> {
  if (!transcriptPath.toLowerCase().endsWith('.jsonl')) {
    return []
  }
  const tail = await readTail(transcriptPath, TRANSCRIPT_TAIL_BYTES)
  if (!tail) {
    return []
  }
  return assistantTextsFromTranscriptTail(tail, TRANSCRIPT_EVIDENCE_MAX).map((text) =>
    text.slice(0, MAX_EVIDENCE_LENGTH)
  )
}

function sanitizeRequest(value: unknown): PaneBindingAuditRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.panes) || !Array.isArray(raw.statuses)) {
    return null
  }
  const panes: PaneBindingAuditRequest['panes'] = []
  for (const entry of raw.panes.slice(0, MAX_PANES)) {
    const pane = entry as Record<string, unknown>
    if (
      typeof pane?.paneKey === 'string' &&
      isValidPaneKey(pane.paneKey) &&
      typeof pane?.ptyId === 'string' &&
      pane.ptyId.length > 0
    ) {
      panes.push({ paneKey: pane.paneKey, ptyId: pane.ptyId })
    }
  }
  const statuses: PaneBindingAuditStatus[] = []
  for (const entry of raw.statuses.slice(0, MAX_STATUSES)) {
    const status = entry as Record<string, unknown>
    if (
      typeof status?.paneKey === 'string' &&
      isValidPaneKey(status.paneKey) &&
      typeof status?.sessionId === 'string' &&
      status.sessionId.length > 0
    ) {
      statuses.push({
        paneKey: status.paneKey,
        sessionId: status.sessionId,
        ...(typeof status.transcriptPath === 'string' && status.transcriptPath.length > 0
          ? { transcriptPath: status.transcriptPath }
          : {})
      })
    }
  }
  return { panes, statuses }
}

export async function runPaneBindingAudit(
  request: PaneBindingAuditRequest
): Promise<PaneBindingFinding[]> {
  const samples: PaneOutputSample[] = []
  for (const pane of request.panes) {
    const tail = await readTail(historyLogPath(pane.ptyId), TAIL_BYTES)
    if (tail !== null) {
      samples.push({ paneKey: pane.paneKey, tail })
    }
  }
  const statuses: PaneBindingStatusInput[] = []
  for (const status of request.statuses) {
    // Why the transcript is the only source: text taken from the status itself can
    // belong to another session sharing that pane key, and it would then point at
    // that session's terminal with full confidence. A session with no readable
    // transcript falls back to its id, which nothing but the session echoes.
    const evidence = status.transcriptPath
      ? await readTranscriptEvidence(status.transcriptPath)
      : []
    statuses.push({
      paneKey: status.paneKey,
      sessionId: status.sessionId,
      ...(evidence.length > 0 ? { evidence } : {})
    })
  }
  return auditPaneBindings(statuses, samples)
}

export function registerPaneBindingAuditIpcHandlers(): void {
  ipcMain.removeHandler('agentStatus:auditPaneBindings')
  ipcMain.handle('agentStatus:auditPaneBindings', async (_event, value: unknown) => {
    const request = sanitizeRequest(value)
    if (!request || request.panes.length === 0 || request.statuses.length === 0) {
      return []
    }
    try {
      return await runPaneBindingAudit(request)
    } catch (err) {
      console.warn('[agent-hooks] auditPaneBindings failed:', err)
      return []
    }
  })
}
