import { describe, expect, it } from 'vitest'
import { assistantTextsFromTranscriptTail } from './agent-transcript-evidence'

function assistantLine(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...extra,
    message: { role: 'assistant', content: [{ type: 'text', text }] }
  })
}

function userLine(text: string): string {
  return JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text }] } })
}

const FIRST = 'This is the first thing the session said out loud.'
const SECOND = 'And this is the second thing it said, later in the turn.'

describe('assistantTextsFromTranscriptTail', () => {
  it('returns the newest assistant turns, newest first', () => {
    const tail = [
      '{"cut":',
      assistantLine(FIRST),
      userLine('a question from the user'),
      assistantLine(SECOND)
    ].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 4)).toEqual([SECOND, FIRST])
  })

  // Why: reading from an offset lands mid-record, so the first line is never whole.
  it('drops the partial first line without failing', () => {
    const tail = ['nt":[{"type":"text","text":"half a record"}]}}', assistantLine(FIRST)].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 4)).toEqual([FIRST])
  })

  it('stops once it has the turns it was asked for', () => {
    const tail = ['{"cut":', assistantLine(FIRST), assistantLine(SECOND)].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 1)).toEqual([SECOND])
  })

  // Why: "ok" and "done" appear in half the terminals on screen.
  it('ignores turns too short to identify a session', () => {
    const tail = ['{"cut":', assistantLine('ok'), assistantLine(FIRST)].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 4)).toEqual([FIRST])
  })

  // Why: a subagent's output is not painted in the terminal the way the session's
  // own turns are, so it cannot say which terminal is showing this session.
  it('ignores subagent turns', () => {
    const tail = [
      '{"cut":',
      assistantLine(SECOND, { isSidechain: true }),
      assistantLine(FIRST)
    ].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 4)).toEqual([FIRST])
  })

  // Why: a transcript being written while it is read can hold a torn line, and one
  // unreadable record says nothing about the rest of the file.
  it('skips a torn record and keeps reading', () => {
    const tail = [
      '{"cut":',
      assistantLine(FIRST),
      '{"message":{"role":"assis',
      assistantLine(SECOND)
    ].join('\n')

    expect(assistantTextsFromTranscriptTail(tail, 4)).toEqual([SECOND, FIRST])
  })
})
