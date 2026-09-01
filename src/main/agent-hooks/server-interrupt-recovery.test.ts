import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { buildBody, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

const JOB = 'ed15d8da-ac9f-4413-ae45-0d265a463354'
const JOB_ROW = makePaneKey('tab-1', JOB)
const TERMINAL_PANE = makePaneKey('tab-1', '22222222-2222-4222-8222-222222222222')

let clockOffsetMs = 0

beforeEach(() => {
  _internals.resetCachesForTests()
  clockOffsetMs = 0
  const realNow = Date.now
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs)
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

function rowOf(server: AgentHookServer): { state?: string; interrupted?: boolean } {
  const row = server.getStatusSnapshot().find((entry) => entry.paneKey === JOB_ROW)
  return { state: row?.state, interrupted: row?.interrupted }
}

async function interruptedTurn(server: AgentHookServer): Promise<void> {
  await postHookEvent(server, jobBody({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }))
  const row = server.getStatusSnapshot().find((entry) => entry.paneKey === JOB_ROW)
  expect(
    server.inferInterrupt({
      paneKey: TERMINAL_PANE,
      providerSessionId: JOB,
      intent: 'plain-escape',
      baselineAgentType: 'claude',
      baselineUpdatedAt: row!.receivedAt,
      baselineStateStartedAt: row!.stateStartedAt,
      baselinePrompt: row!.prompt
    })
  ).toBe(true)
  expect(rowOf(server)).toEqual({ state: 'done', interrupted: true })
}

// Why: an interrupt stops the turn, so its late hooks arrive within seconds. Tool
// work that goes on arriving is proof the turn never stopped — measured on a live
// job whose row sat at an inferred interrupt while its transcript grew for 45 more
// minutes, so the terminal showed finished the whole time it was working.
describe('an interrupt the agent did not actually take', () => {
  // Why a completion proves nothing: the tool the turn was already running finishes
  // on its own schedule — a `sleep 90` reports long after the Ctrl+C around it.
  it('stays finished for the tool that was already running, however late it reports', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      await interruptedTurn(server)
      clockOffsetMs += 90_000

      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_late' })
      )

      expect(rowOf(server)).toEqual({ state: 'done', interrupted: true })
    } finally {
      await server.stop()
    }
  })

  it('stays finished for a tool announced in the moment the interrupt landed', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      await interruptedTurn(server)
      clockOffsetMs += 3_000

      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_queued' })
      )

      expect(rowOf(server)).toEqual({ state: 'done', interrupted: true })
    } finally {
      await server.stop()
    }
  })

  // Why a start is different: no stopped turn launches another tool.
  it('comes back to working when it starts another tool past that window', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      await interruptedTurn(server)
      clockOffsetMs += 20_000

      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_alive' })
      )

      expect(rowOf(server)).toEqual({ state: 'working', interrupted: undefined })
    } finally {
      await server.stop()
    }
  })
})
