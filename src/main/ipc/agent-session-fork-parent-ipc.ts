import { open } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { forkParentSessionIdFromTranscriptHead } from '../../shared/agent-transcript-lineage'

/** Why this much: a fork's inherited records start at byte 0; a few hundred fit here. */
const TRANSCRIPT_HEAD_BYTES = 64 * 1024

async function readHead(path: string, length: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** The session this transcript was forked from, or null when it was not forked. */
export async function readAgentSessionForkParent(
  transcriptPath: string,
  sessionId: string
): Promise<string | null> {
  if (!transcriptPath.toLowerCase().endsWith('.jsonl')) {
    return null
  }
  const head = await readHead(transcriptPath, TRANSCRIPT_HEAD_BYTES)
  return head ? forkParentSessionIdFromTranscriptHead(head, sessionId) : null
}

/** Why registered from the session-turn module: agent-hooks.ts sits at its line limit. */
export function registerAgentSessionForkParentIpcHandlers(): void {
  ipcMain.removeHandler('agentStatus:readSessionForkParent')
  ipcMain.handle('agentStatus:readSessionForkParent', async (_event, value: unknown) => {
    const args = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const transcriptPath = typeof args?.transcriptPath === 'string' ? args.transcriptPath : ''
    const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : ''
    if (transcriptPath.length === 0 || sessionId.length === 0) {
      return null
    }
    try {
      return await readAgentSessionForkParent(transcriptPath, sessionId)
    } catch (err) {
      console.warn('[agent-hooks] readSessionForkParent failed:', err)
      return null
    }
  })
}
