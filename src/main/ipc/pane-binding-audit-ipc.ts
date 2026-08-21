import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { isValidPaneKey } from '../agent-hooks/server'
import {
  auditPaneBindings,
  type PaneBindingFinding,
  type PaneBindingStatusInput,
  type PaneOutputSample
} from '../../shared/pane-binding-audit'

/** Why: enough recorded output to carry a session's own turns, small enough that
 *  auditing a dozen terminals stays a single on-demand read each. */
const TAIL_BYTES = 512 * 1024
const MAX_PANES = 200
const MAX_STATUSES = 200

export type PaneBindingAuditRequest = {
  panes: { paneKey: string; ptyId: string }[]
  statuses: PaneBindingStatusInput[]
}

function historyLogPath(ptyId: string): string {
  return join(app.getPath('userData'), 'terminal-history', encodeURIComponent(ptyId), 'output.log')
}

/** Why the tail only: these logs run to megabytes, and a session that is live in
 *  a terminal has written to its end. */
async function readOutputTail(ptyId: string): Promise<string | null> {
  const path = historyLogPath(ptyId)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const { size } = await stat(path)
    const length = Math.min(size, TAIL_BYTES)
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
  const statuses: PaneBindingStatusInput[] = []
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
        ...(typeof status.evidence === 'string' ? { evidence: status.evidence } : {})
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
    const tail = await readOutputTail(pane.ptyId)
    if (tail !== null) {
      samples.push({ paneKey: pane.paneKey, tail })
    }
  }
  return auditPaneBindings(request.statuses, samples)
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
