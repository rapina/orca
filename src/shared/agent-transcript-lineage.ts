/**
 * Which session a transcript was forked from.
 *
 * Why this can be read at all: `claude --resume <session> --fork-session` copies
 * the parent's records into the new transcript with the parent's `sessionId`
 * still on them, and the new session's own records follow. Measured on a live
 * fork: 1,301 records under the parent's id at the head of a 9 MB transcript.
 */

/** Why a floor: one stray record naming another session is not a fork. */
const MIN_INHERITED_RECORDS = 5
/** Why bounded: the inherited records are at the head, and the head is what is read. */
const MAX_RECORDS_SCANNED = 400

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function forkParentSessionIdFromTranscriptHead(
  head: string,
  ownSessionId: string
): string | null {
  const counts = new Map<string, number>()
  let scanned = 0
  for (const rawLine of head.split('\n')) {
    if (scanned >= MAX_RECORDS_SCANNED) {
      break
    }
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // Why tolerated: a head read of a fixed size cuts its last record in half.
      continue
    }
    scanned += 1
    if (!record || typeof record !== 'object') {
      continue
    }
    const sessionId = (record as Record<string, unknown>).sessionId
    if (typeof sessionId !== 'string' || sessionId === ownSessionId || !UUID_RE.test(sessionId)) {
      continue
    }
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
  }
  let parent: string | null = null
  let parentCount = 0
  for (const [sessionId, count] of counts) {
    if (count > parentCount) {
      parent = sessionId
      parentCount = count
    }
  }
  return parentCount >= MIN_INHERITED_RECORDS ? parent : null
}
