import { open, stat } from 'node:fs/promises'
import { ipcMain } from 'electron'
import {
  assistantTextsFromTranscriptTail,
  userPromptTextsFromTranscriptTail,
  type AgentSessionTurn
} from '../../shared/agent-transcript-evidence'
import { registerAgentSessionForkParentIpcHandlers } from './agent-session-fork-parent-ipc'

/** Why this large: a busy transcript's tail is mostly tool results, and what is
 *  wanted is the last thing the agent actually said. */
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024
const MAX_TURN_LENGTH = 400

/** Why the tail only: transcripts run to megabytes and the newest turn is at the end. */
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
 * What one agent session was asked and last said, for a person to recognise it by.
 *
 * Why read the transcript instead of showing what the pane's status holds: a pane
 * holds one status, and its prompt and message fields carry over from whatever
 * reported there last. Several sessions report one pane key whenever a
 * background-job host owns them, so that text can belong to a different session
 * than the one being named - which is precisely the confusion this text exists to
 * settle. A transcript belongs to one session by construction. The prompt comes
 * from the same place for the same reason.
 */
export async function readAgentSessionTurn(
  transcriptPath: string
): Promise<AgentSessionTurn | null> {
  if (!transcriptPath.toLowerCase().endsWith('.jsonl')) {
    return null
  }
  const tail = await readTail(transcriptPath, TRANSCRIPT_TAIL_BYTES)
  if (!tail) {
    return null
  }
  const [reply] = assistantTextsFromTranscriptTail(tail, 1)
  const [prompt] = userPromptTextsFromTranscriptTail(tail, 1)
  if (!reply && !prompt) {
    return null
  }
  return {
    prompt: prompt ? prompt.slice(0, MAX_TURN_LENGTH) : null,
    reply: reply ? reply.slice(0, MAX_TURN_LENGTH) : null
  }
}

export function registerAgentSessionTurnIpcHandlers(): void {
  // Why here: the fork-parent read is the other transcript read a person's move
  // relies on, and agent-hooks.ts has no room for one more registration line.
  registerAgentSessionForkParentIpcHandlers()
  ipcMain.removeHandler('agentStatus:readSessionTurn')
  ipcMain.handle('agentStatus:readSessionTurn', async (_event, value: unknown) => {
    const transcriptPath =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>).transcriptPath
        : undefined
    if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
      return null
    }
    try {
      return await readAgentSessionTurn(transcriptPath)
    } catch (err) {
      console.warn('[agent-hooks] readSessionTurn failed:', err)
      return null
    }
  })
}
