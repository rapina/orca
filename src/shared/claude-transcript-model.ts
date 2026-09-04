/**
 * Which model a Claude session is on, read from its transcript.
 *
 * Why the transcript: Claude Code's hook input names the session, the transcript
 * and the working directory, but never the model (Codex's does, and Orca shows
 * it). Every assistant record in the transcript carries `message.model`, and the
 * newest one is the model the session is on now — a `/model` switch mid-session
 * changes what the next record says.
 */

/** One look at a transcript. A look that found nothing is kept too, so a
 *  session before its first reply is not re-read on every tool call. */
export type ClaudeTranscriptModelReading = { model?: string; readAt: number }

/** How long a known model is trusted between turn boundaries. */
export const CLAUDE_MODEL_REFRESH_MS = 30_000
/** Why shorter: the first tool call after a session's first reply should show it. */
export const CLAUDE_MODEL_RETRY_MS = 5_000
/** Why bounded: transcript paths are one per session and sessions never stop coming. */
const MAX_REMEMBERED_TRANSCRIPTS = 512

/** The model on one transcript line, when it is an assistant record of this session. */
export function extractClaudeModelFromTranscriptLine(line: string): string | undefined {
  // Why the cheap check first: most records are tool results and user turns, and
  // parsing megabytes of them to find no model is the cost this avoids.
  if (!line.includes('"model"')) {
    return undefined
  }
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!entry || typeof entry !== 'object') {
    return undefined
  }
  const record = entry as Record<string, unknown>
  // Why sidechains are skipped: a subagent's records can sit in the lead's file,
  // and the model it ran on is not the session's.
  if (record.type !== 'assistant' || record.isSidechain === true) {
    return undefined
  }
  const message = record.message
  if (!message || typeof message !== 'object') {
    return undefined
  }
  const model = (message as Record<string, unknown>).model
  if (typeof model !== 'string') {
    return undefined
  }
  const trimmed = model.trim()
  // Why: Claude Code writes `<synthetic>` on records it made itself — an
  // interrupt notice, a context-limit message — and no model spoke there.
  if (!trimmed || trimmed.startsWith('<')) {
    return undefined
  }
  return trimmed
}

/** Whether this hook event is worth a look at the transcript. */
export function shouldReadClaudeModel(
  eventName: unknown,
  previous: ClaudeTranscriptModelReading | undefined,
  now: number
): boolean {
  if (!previous) {
    return true
  }
  // Why turn boundaries always read: the reply that just ended is where a model
  // switch first shows, and a resumed session's model is whatever it last used.
  if (eventName === 'Stop' || eventName === 'StopFailure' || eventName === 'SessionStart') {
    return true
  }
  const interval = previous.model ? CLAUDE_MODEL_REFRESH_MS : CLAUDE_MODEL_RETRY_MS
  return now - previous.readAt >= interval
}

/** Keeps the newest reading per transcript, forgetting the oldest transcript past the bound. */
export function rememberClaudeModelReading(
  readings: Map<string, ClaudeTranscriptModelReading>,
  transcriptPath: string,
  reading: ClaudeTranscriptModelReading
): void {
  // Why delete first: a Map keeps insertion order, so a refreshed transcript
  // moves to the back and the one dropped is the one longest unheard from.
  readings.delete(transcriptPath)
  if (readings.size >= MAX_REMEMBERED_TRANSCRIPTS) {
    const oldest = readings.keys().next().value
    if (oldest !== undefined) {
      readings.delete(oldest)
    }
  }
  readings.set(transcriptPath, reading)
}
