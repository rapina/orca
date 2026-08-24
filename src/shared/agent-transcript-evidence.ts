/**
 * What a session itself said, read from its own transcript.
 *
 * Why this exists apart from the status a pane holds: a pane holds one status,
 * and its prompt and tool fields carry over from whatever reported there last.
 * Several sessions can report one pane key - every agent a background-job host
 * owns reports the terminal that started that host - so the text on such a
 * status can belong to a different session than the id beside it. A transcript
 * belongs to exactly one session, so what it says can be trusted to identify it.
 */

/** Why: shorter turns ("done", "ok") match half the terminals on screen. */
const EVIDENCE_MIN_LENGTH = 24

function assistantTextsOf(record: unknown): string[] {
  if (!record || typeof record !== 'object') {
    return []
  }
  const row = record as Record<string, unknown>
  // Why skipped: a subagent's turns are not painted in the terminal the way the
  // session's own are, so they cannot say which terminal shows this session.
  if (row.isSidechain === true) {
    return []
  }
  const message = row.message
  if (!message || typeof message !== 'object') {
    return []
  }
  const body = message as Record<string, unknown>
  if (body.role !== 'assistant' || !Array.isArray(body.content)) {
    return []
  }
  const texts: string[] = []
  for (const part of body.content) {
    if (part && typeof part === 'object') {
      const block = part as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      }
    }
  }
  return texts
}

/**
 * The newest assistant turns in a transcript tail, newest first.
 *
 * Why a tail and not the file: transcripts run to megabytes and only the turns
 * still on a terminal's screen can be matched against its recording. The first
 * line is dropped because reading from an offset cuts a record in half.
 */
export function assistantTextsFromTranscriptTail(tail: string, limit: number): string[] {
  const lines = tail.split('\n')
  lines.shift()
  const texts: string[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // Why tolerated: a rotated or concurrently written transcript can hold a
      // torn line, and one unreadable record says nothing about the rest.
      continue
    }
    for (const text of assistantTextsOf(record)) {
      const trimmed = text.trim()
      if (trimmed.length >= EVIDENCE_MIN_LENGTH) {
        texts.push(trimmed)
      }
    }
    if (texts.length >= limit) {
      return texts.slice(0, limit)
    }
  }
  return texts
}
