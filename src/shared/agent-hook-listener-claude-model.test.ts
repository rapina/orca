import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHookListenerState,
  normalizeHookPayload,
  type HookListenerState
} from './agent-hook-listener'
import { PANE_KEY } from './agent-hook-listener-test-harness'
import { CLAUDE_MODEL_REFRESH_MS } from './claude-transcript-model'

function record(type: 'user' | 'assistant', model?: string): string {
  return `${JSON.stringify({
    type,
    cwd: 'D:\\Workspace\\orca',
    sessionId: 'session-1',
    message:
      type === 'user'
        ? { role: 'user', content: 'say hi' }
        : { role: 'assistant', model, content: [{ type: 'text', text: 'hi' }] }
  })}\n`
}

describe('Claude model from the transcript', () => {
  let state: HookListenerState
  let tmpDir: string
  let transcriptPath: string

  const send = (payload: Record<string, unknown>) =>
    normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { transcript_path: transcriptPath, ...payload } },
      'production'
    )

  beforeEach(() => {
    state = createHookListenerState()
    tmpDir = mkdtempSync(join(tmpdir(), 'orca-claude-model-'))
    transcriptPath = join(tmpDir, 'session-1.jsonl')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_700_000_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('names the model once the session has replied, and follows a switch at the next turn', () => {
    writeFileSync(transcriptPath, record('user'))
    const prompted = send({ hook_event_name: 'UserPromptSubmit', prompt: 'say hi' })
    expect(prompted?.payload.model).toBeUndefined()

    appendFileSync(transcriptPath, record('assistant', 'claude-fable-5-1'))
    const stopped = send({ hook_event_name: 'Stop' })
    expect(stopped?.payload.model).toBe('claude-fable-5-1')

    // Why: a tool hook right after a switch trusts what it knows; the boundary reads.
    appendFileSync(transcriptPath, record('user'))
    appendFileSync(transcriptPath, record('assistant', 'claude-opus-5'))
    vi.setSystemTime(Date.now() + 1_000)
    const tool = send({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'a.ts' }
    })
    expect(tool?.payload.model).toBe('claude-fable-5-1')
    expect(send({ hook_event_name: 'Stop' })?.payload.model).toBe('claude-opus-5')
  })

  it('looks again between boundaries once the known model has aged', () => {
    writeFileSync(transcriptPath, record('user') + record('assistant', 'claude-fable-5-1'))
    expect(send({ hook_event_name: 'Stop' })?.payload.model).toBe('claude-fable-5-1')

    appendFileSync(transcriptPath, record('assistant', 'claude-opus-5'))
    vi.setSystemTime(Date.now() + CLAUDE_MODEL_REFRESH_MS)
    const tool = send({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'a.ts' },
      tool_response: 'ok'
    })
    expect(tool?.payload.model).toBe('claude-opus-5')
  })

  it('keeps the last spoken model past a synthetic record and a missing file', () => {
    writeFileSync(transcriptPath, record('user') + record('assistant', 'claude-fable-5-1'))
    expect(send({ hook_event_name: 'Stop' })?.payload.model).toBe('claude-fable-5-1')

    appendFileSync(transcriptPath, record('assistant', '<synthetic>'))
    expect(send({ hook_event_name: 'Stop' })?.payload.model).toBe('claude-fable-5-1')

    rmSync(transcriptPath)
    expect(send({ hook_event_name: 'Stop' })?.payload.model).toBe('claude-fable-5-1')
  })

  it('reads a resumed session at SessionStart and says nothing without a transcript', () => {
    writeFileSync(transcriptPath, record('user') + record('assistant', 'claude-opus-5'))
    const resumed = send({ hook_event_name: 'SessionStart', source: 'resume' })
    expect(resumed?.payload.model).toBe('claude-opus-5')

    const bare = normalizeHookPayload(
      state,
      'claude',
      { paneKey: PANE_KEY, payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' } },
      'production'
    )
    expect(bare?.payload.model).toBeUndefined()
  })
})
