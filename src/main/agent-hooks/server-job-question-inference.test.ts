import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { buildBody, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

const JOB = 'f59926b4-dd7f-4020-b44b-5840f5892b64'
const TERMINAL_LEAF = '22222222-2222-4222-8222-222222222222'
const JOB_ROW = makePaneKey('tab-1', JOB)
/** The terminal the job was bound to — where the person actually types. */
const TERMINAL_PANE = makePaneKey('tab-1', TERMINAL_LEAF)

beforeEach(() => {
  _internals.resetCachesForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

type HookBody = Parameters<typeof postHookEvent>[1]

function jobBody(payload: Record<string, unknown>): HookBody {
  return {
    ...buildBody({ session_id: JOB, ...payload }),
    processHost: 'background-job'
  } as HookBody
}

async function askQuestion(server: AgentHookServer): Promise<{
  baselineUpdatedAt: number
  baselineStateStartedAt: number
  baselinePrompt: string
}> {
  await postHookEvent(server, jobBody({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }))
  await postHookEvent(
    server,
    jobBody({
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_question',
      tool_input: { questions: [{ question: 'which one?' }] }
    })
  )
  const entry = server.getStatusSnapshot().find((row) => row.paneKey === JOB_ROW)
  expect(entry?.state).toBe('waiting')
  return {
    baselineUpdatedAt: entry!.receivedAt,
    baselineStateStartedAt: entry!.stateStartedAt,
    baselinePrompt: entry!.prompt
  }
}

function stateOf(server: AgentHookServer): string | undefined {
  return server.getStatusSnapshot().find((row) => row.paneKey === JOB_ROW)?.state
}

// Why: a background job's row is cached under a key of its own, but the person
// answering — or pressing Escape — is in the terminal the job was bound to. Sent
// under that terminal's pane key alone, both inferences found nothing and the
// question mark stayed up for the rest of the turn (measured 8/31).
describe("a question asked by a background job, dealt with in the job's terminal", () => {
  it('clears on the answer keystroke, addressed by session', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const baseline = await askQuestion(server)

      expect(
        server.inferQuestionAnswered({
          paneKey: TERMINAL_PANE,
          providerSessionId: JOB,
          baselineAgentType: 'claude',
          ...baseline
        })
      ).toBe(true)
      expect(stateOf(server)).toBe('working')
    } finally {
      await server.stop()
    }
  })

  it('clears when Escape dismisses the question instead of answering it', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const baseline = await askQuestion(server)

      expect(
        server.inferInterrupt({
          paneKey: TERMINAL_PANE,
          providerSessionId: JOB,
          intent: 'plain-escape',
          baselineAgentType: 'claude',
          ...baseline
        })
      ).toBe(true)
      expect(stateOf(server)).toBe('working')
    } finally {
      await server.stop()
    }
  })

  it('still finds nothing when the request names neither the row nor its session', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const baseline = await askQuestion(server)

      expect(
        server.inferQuestionAnswered({
          paneKey: TERMINAL_PANE,
          baselineAgentType: 'claude',
          ...baseline
        })
      ).toBe(false)
      expect(stateOf(server)).toBe('waiting')
    } finally {
      await server.stop()
    }
  })
})
