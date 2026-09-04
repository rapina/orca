import { describe, expect, it } from 'vitest'
import {
  CLAUDE_MODEL_REFRESH_MS,
  CLAUDE_MODEL_RETRY_MS,
  extractClaudeModelFromTranscriptLine,
  rememberClaudeModelReading,
  shouldReadClaudeModel,
  type ClaudeTranscriptModelReading
} from './claude-transcript-model'

function assistantLine(model: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    cwd: 'D:\\Workspace\\orca',
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'hi' }] },
    ...extra
  })
}

describe('extractClaudeModelFromTranscriptLine', () => {
  it('reads the model off an assistant record', () => {
    expect(extractClaudeModelFromTranscriptLine(assistantLine('claude-fable-5-1'))).toBe(
      'claude-fable-5-1'
    )
  })

  it('ignores user records, tool results, and torn lines', () => {
    expect(
      extractClaudeModelFromTranscriptLine(
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'use "model" x' } })
      )
    ).toBeUndefined()
    expect(extractClaudeModelFromTranscriptLine('{"type":"assistant","message":{"model":"cl')).toBe(
      undefined
    )
    expect(extractClaudeModelFromTranscriptLine('"model"')).toBeUndefined()
  })

  it('skips records no model spoke and records of a subagent', () => {
    expect(extractClaudeModelFromTranscriptLine(assistantLine('<synthetic>'))).toBeUndefined()
    expect(
      extractClaudeModelFromTranscriptLine(assistantLine('claude-haiku-4-5', { isSidechain: true }))
    ).toBeUndefined()
    expect(extractClaudeModelFromTranscriptLine(assistantLine('   '))).toBeUndefined()
  })
})

describe('shouldReadClaudeModel', () => {
  const known: ClaudeTranscriptModelReading = { model: 'claude-opus-5', readAt: 1_000 }
  const unknown: ClaudeTranscriptModelReading = { readAt: 1_000 }

  it('always reads with nothing remembered, and at every turn boundary', () => {
    expect(shouldReadClaudeModel('PreToolUse', undefined, 1_000)).toBe(true)
    expect(shouldReadClaudeModel('Stop', known, 1_001)).toBe(true)
    expect(shouldReadClaudeModel('StopFailure', known, 1_001)).toBe(true)
    expect(shouldReadClaudeModel('SessionStart', known, 1_001)).toBe(true)
  })

  it('trusts a known model between boundaries for a while', () => {
    expect(shouldReadClaudeModel('PreToolUse', known, 1_000 + CLAUDE_MODEL_REFRESH_MS - 1)).toBe(
      false
    )
    expect(shouldReadClaudeModel('PreToolUse', known, 1_000 + CLAUDE_MODEL_REFRESH_MS)).toBe(true)
  })

  it('looks again sooner while no model has been seen', () => {
    expect(shouldReadClaudeModel('PostToolUse', unknown, 1_000 + CLAUDE_MODEL_RETRY_MS - 1)).toBe(
      false
    )
    expect(shouldReadClaudeModel('PostToolUse', unknown, 1_000 + CLAUDE_MODEL_RETRY_MS)).toBe(true)
  })
})

describe('rememberClaudeModelReading', () => {
  it('forgets the oldest transcript once past the bound, never a refreshed one', () => {
    const readings = new Map<string, ClaudeTranscriptModelReading>()
    for (let index = 0; index < 512; index += 1) {
      rememberClaudeModelReading(readings, `t${index}`, { readAt: index })
    }
    rememberClaudeModelReading(readings, 't0', { model: 'claude-opus-5', readAt: 600 })
    expect(readings.size).toBe(512)
    rememberClaudeModelReading(readings, 'new', { readAt: 601 })
    expect(readings.size).toBe(512)
    expect(readings.has('t1')).toBe(false)
    expect(readings.get('t0')?.model).toBe('claude-opus-5')
    expect(readings.has('new')).toBe(true)
  })
})
