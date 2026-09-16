import { readTerminalTranscriptContext } from './terminal-transcript-reader'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { isValidPaneKey } from '../agent-hooks/server'
import {
  extractPullRequestUrls,
  MAX_TERMINAL_PULL_REQUESTS,
  PULL_REQUEST_CREATE_WINDOW_CHARS,
  worktreeNameFromPath,
  type TerminalContext,
  type TerminalContextRequest
} from '../../shared/terminal-context'

/** Why capped: the first sweep of a long-lived terminal would otherwise read the
 *  whole recording, and a link older than this is not what the row is for. */
const FIRST_SCAN_BYTES = 4 * 1024 * 1024
/** Why an overlap: a link only counts within a window after the create command
 *  that printed it, so a read has to start far enough back to see that command.
 *  Three bytes per character covers the widest UTF-8 the window can hold, and
 *  the tail covers a link written across two reads. */
const SCAN_OVERLAP_BYTES = PULL_REQUEST_CREATE_WINDOW_CHARS * 3 + 256
const MAX_TERMINALS = 200

type ScanState = { scannedTo: number; urls: string[] }

/**
 * What has already been read out of each recording.
 *
 * Why kept: the panel asks again whenever it is looked at, and re-reading
 * megabytes of every terminal each time to find links that have not changed is
 * waste. Only what a recording has grown by is read after the first sweep, and
 * links found earlier are remembered rather than re-found.
 */
const scansByPtyId = new Map<string, ScanState>()
function historyLogPath(ptyId: string): string {
  return join(app.getPath('userData'), 'terminal-history', encodeURIComponent(ptyId), 'output.log')
}

async function readRange(path: string, from: number, length: number): Promise<string | null> {
  if (length <= 0) {
    return ''
  }
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Links this terminal has printed, carried forward across calls. */
async function scanPullRequestUrls(ptyId: string): Promise<string[]> {
  const path = historyLogPath(ptyId)
  let size: number
  try {
    ;({ size } = await stat(path))
  } catch {
    return scansByPtyId.get(ptyId)?.urls ?? []
  }
  const previous = scansByPtyId.get(ptyId)
  if (previous?.scannedTo === size) {
    return previous.urls
  }
  // Why the reset: a recording that shrank was replaced, so what was read before
  // describes a terminal that no longer exists.
  const state = previous && previous.scannedTo <= size ? previous : { scannedTo: 0, urls: [] }
  const from =
    state.scannedTo > 0
      ? Math.max(0, state.scannedTo - SCAN_OVERLAP_BYTES)
      : Math.max(0, size - FIRST_SCAN_BYTES)
  const text = await readRange(path, from, size - from)
  if (text === null) {
    return state.urls
  }
  const urls = [...state.urls]
  for (const url of extractPullRequestUrls(text)) {
    if (!urls.includes(url)) {
      urls.push(url)
    }
  }
  const next: ScanState = {
    scannedTo: size,
    urls: urls.slice(-MAX_TERMINAL_PULL_REQUESTS)
  }
  scansByPtyId.set(ptyId, next)
  if (scansByPtyId.size > MAX_TERMINALS) {
    scansByPtyId.delete(scansByPtyId.keys().next().value!)
  }
  return next.urls
}

const resolvedPaths = new Map<string, string>()

async function transcriptFor(
  terminal: TerminalContextRequest['terminals'][number]
): Promise<string | undefined> {
  // A remote path must never be resolved against this computer's session store.
  if (terminal.connectionId) {
    return undefined
  }
  if (terminal.transcriptPath) {
    return terminal.transcriptPath
  }
  if (!terminal.agentType || !terminal.sessionId) {
    return undefined
  }
  const key = `${terminal.agentType}:${terminal.sessionId}`
  const cached = resolvedPaths.get(key)
  if (cached) {
    return cached
  }
  const path = await resolveSessionFilePath(terminal.agentType, terminal.sessionId).catch(
    () => null
  )
  if (path) {
    resolvedPaths.set(key, path)
    if (resolvedPaths.size > MAX_TERMINALS) {
      resolvedPaths.delete(resolvedPaths.keys().next().value!)
    }
  }
  return path ?? undefined
}

export async function readTerminalContexts(
  request: TerminalContextRequest
): Promise<TerminalContext[]> {
  const contexts: TerminalContext[] = []
  for (const terminal of request.terminals) {
    const fromRecording =
      terminal.ptyId && !terminal.connectionId ? await scanPullRequestUrls(terminal.ptyId) : []
    // Why both: a person typing `gh pr create` at a shell leaves it only in the
    // recording, and an agent's TUI leaves it only in its transcript.
    const transcriptPath = await transcriptFor(terminal)
    const transcript = transcriptPath ? await readTerminalTranscriptContext(transcriptPath) : null
    const pullRequestUrls = [...new Set(transcript?.urls ?? fromRecording)].slice(
      -MAX_TERMINAL_PULL_REQUESTS
    )
    const directory = transcript?.directory
    if (pullRequestUrls.length === 0 && !directory) {
      continue
    }
    contexts.push({
      paneKey: terminal.paneKey,
      pullRequestUrls,
      ...(directory?.cwd ? { worktreeName: worktreeNameFromPath(directory.cwd) } : {}),
      ...(directory?.branch ? { branch: directory.branch } : {})
    })
  }
  return contexts
}

function sanitizeRequest(value: unknown): TerminalContextRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = (value as Record<string, unknown>).terminals
  if (!Array.isArray(raw)) {
    return null
  }
  const terminals: TerminalContextRequest['terminals'] = []
  for (const entry of raw.slice(0, MAX_TERMINALS)) {
    const terminal = entry as Record<string, unknown>
    if (typeof terminal?.paneKey !== 'string' || !isValidPaneKey(terminal.paneKey)) {
      continue
    }
    terminals.push({
      paneKey: terminal.paneKey,
      ...(terminal.agentType === 'claude' || terminal.agentType === 'codex'
        ? { agentType: terminal.agentType }
        : {}),
      ...(typeof terminal.sessionId === 'string' && terminal.sessionId.length > 0
        ? { sessionId: terminal.sessionId }
        : {}),
      ...(typeof terminal.connectionId === 'string' && terminal.connectionId.length > 0
        ? { connectionId: terminal.connectionId }
        : {}),
      ...(typeof terminal.ptyId === 'string' && terminal.ptyId.length > 0
        ? { ptyId: terminal.ptyId }
        : {}),
      ...(typeof terminal.transcriptPath === 'string' && terminal.transcriptPath.length > 0
        ? { transcriptPath: terminal.transcriptPath }
        : {})
    })
  }
  return { terminals }
}

export function registerTerminalContextIpcHandlers(): void {
  ipcMain.removeHandler('agentStatus:readTerminalContexts')
  ipcMain.handle('agentStatus:readTerminalContexts', async (_event, value: unknown) => {
    const request = sanitizeRequest(value)
    if (!request || request.terminals.length === 0) {
      return []
    }
    try {
      return await readTerminalContexts(request)
    } catch (err) {
      console.warn('[agent-hooks] readTerminalContexts failed:', err)
      return []
    }
  })
}
