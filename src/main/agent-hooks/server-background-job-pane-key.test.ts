import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

const JOB_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const JOB_B = 'bbbbbbbb-2222-4222-8222-222222222222'

beforeEach(() => {
  _internals.resetCachesForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

type HookBody = Parameters<typeof postHookEvent>[1]

function jobBody(payload: Record<string, unknown>): HookBody {
  return { ...buildBody(payload), processHost: 'background-job' } as HookBody
}

// Why: every per-pane state the server and listener keep is keyed by pane key,
// and a background-job host stamps one pane key on every job it runs. Measured:
// one job's Stop was read against another job's running turn and never became
// `done`, so the terminal it was bound to showed "working" after it had finished.
describe('background-job hooks get a pane key of their own', () => {
  it('keeps two jobs on one host pane apart, and lets each finish on its own', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'UserPromptSubmit', session_id: JOB_A, prompt: 'job a' })
      )
      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'UserPromptSubmit', session_id: JOB_B, prompt: 'job b' })
      )
      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'Stop', session_id: JOB_B, last_assistant_message: 'b done' })
      )

      const byPane = new Map(server.getStatusSnapshot().map((entry) => [entry.paneKey, entry]))
      expect(byPane.has(PANE)).toBe(false)
      expect(byPane.get(makePaneKey('tab-1', JOB_A))).toEqual(
        expect.objectContaining({
          state: 'working',
          prompt: 'job a',
          processHost: 'background-job'
        })
      )
      expect(byPane.get(makePaneKey('tab-1', JOB_B))).toEqual(
        expect.objectContaining({ state: 'done', prompt: 'job b', processHost: 'background-job' })
      )
    } finally {
      await server.stop()
    }
  })

  it('leaves a terminal-hosted session on the pane its hook names', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      await postHookEvent(server, {
        ...buildBody({ hook_event_name: 'UserPromptSubmit', session_id: JOB_A, prompt: 'mine' }),
        processHost: 'terminal'
      } as HookBody)

      expect(server.getStatusSnapshot()).toEqual([
        expect.objectContaining({ paneKey: PANE, state: 'working', processHost: 'terminal' })
      ])
    } finally {
      await server.stop()
    }
  })
})
