import { describe, expect, it } from 'vitest'
import { forkParentSessionIdFromTranscriptHead } from './agent-transcript-lineage'

const OWN = '88ab64da-3cd4-45eb-994e-1bc84d1d0f45'
const PARENT = 'ec48af73-3b2d-4656-bd74-e95a63762fd2'
const STRAY = '11111111-1111-4111-8111-111111111111'

function line(sessionId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', sessionId, ...extra })
}

describe('forkParentSessionIdFromTranscriptHead', () => {
  // Why: `--fork-session` copies the parent's records in with the parent's id still
  // on them; measured at 1,301 such records at the head of a live fork.
  it('names the session whose records the head inherited', () => {
    const head = [
      ...Array.from({ length: 6 }, () => line(PARENT)),
      line(OWN),
      line(OWN),
      '{"type":"user","sessionId":"' // torn last record
    ].join('\n')

    expect(forkParentSessionIdFromTranscriptHead(head, OWN)).toBe(PARENT)
  })

  it('is null for a transcript that is only its own session', () => {
    const head = Array.from({ length: 10 }, () => line(OWN)).join('\n')

    expect(forkParentSessionIdFromTranscriptHead(head, OWN)).toBeNull()
  })

  // Why a floor: one record mentioning another session is not an inheritance.
  it('ignores a stray record naming another session', () => {
    const head = [line(STRAY), ...Array.from({ length: 10 }, () => line(OWN))].join('\n')

    expect(forkParentSessionIdFromTranscriptHead(head, OWN)).toBeNull()
  })

  // Why: the id has to be on the record, not in what the agent happened to say.
  it('does not read a session id out of message text', () => {
    const head = Array.from({ length: 10 }, () =>
      line(OWN, { message: { role: 'user', content: `look at ${PARENT} please` } })
    ).join('\n')

    expect(forkParentSessionIdFromTranscriptHead(head, OWN)).toBeNull()
  })
})
