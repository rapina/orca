import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { buildBody, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

const JOB = 'f59926b4-dd7f-4020-b44b-5840f5892b64'
const CHILD = 'a77028eea3ec959ce'
const ANSWER_DELAY = 'answer-delay'

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

async function run(
  server: AgentHookServer,
  events: (Record<string, unknown> | typeof ANSWER_DELAY)[]
): Promise<string[]> {
  const key = makePaneKey('tab-1', JOB)
  const states: string[] = []
  for (const event of events) {
    if (event === ANSWER_DELAY) {
      clockOffsetMs += 5_000
      continue
    }
    await postHookEvent(server, jobBody(event))
    states.push(server.getStatusSnapshot().find((entry) => entry.paneKey === key)?.state ?? '-')
  }
  return states
}

async function withServer(fn: (server: AgentHookServer) => Promise<void>): Promise<void> {
  const server = new AgentHookServer()
  await server.start({ env: 'production' })
  try {
    await fn(server)
  } finally {
    await server.stop()
  }
}

// Why: a background job answers its permission prompts where the person watches
// it, so no keystroke reaches Orca. Whatever the asking agent does next has to end
// the wait, or the terminal the job is bound to shows a question mark for the rest
// of the run (measured on a live job: EnterWorktree approved at 13:54, "?" until
// the turn ended at 14:16).
describe("a background job's permission wait", () => {
  it('ends when the lead starts another tool after the prompt', async () => {
    await withServer(async (server) => {
      const states = await run(server, [
        { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
        { hook_event_name: 'PreToolUse', tool_name: 'EnterWorktree', tool_use_id: 'toolu_enter' },
        { hook_event_name: 'PermissionRequest', tool_name: 'EnterWorktree' },
        ANSWER_DELAY,
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_use_id: 'toolu_next',
          tool_input: { command: 'git status' }
        }
      ])
      expect(states).toEqual(['working', 'working', 'waiting', 'working'])
    })
  })

  it('outlasts batch siblings that launch alongside the gated tool', async () => {
    await withServer(async (server) => {
      const states = await run(server, [
        { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
        {
          hook_event_name: 'PermissionRequest',
          tool_name: 'Read',
          tool_use_id: 'toolu_gated',
          tool_input: { file_path: 'D:/outside/secret.txt' }
        },
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_use_id: 'toolu_sibling',
          tool_input: { file_path: 'D:/repo/readme.md' }
        },
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Read',
          tool_use_id: 'toolu_sibling',
          tool_response: 'ok'
        }
      ])
      expect(states).toEqual(['working', 'waiting', 'waiting', 'waiting'])
    })
  })

  it("stays while another agent moves on, ends on the asking child's next tool", async () => {
    await withServer(async (server) => {
      const states = await run(server, [
        { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
        { hook_event_name: 'SubagentStart', agent_id: CHILD, agent_type: 'general-purpose' },
        {
          hook_event_name: 'PermissionRequest',
          agent_id: CHILD,
          tool_name: 'Bash',
          tool_use_id: 'toolu_child_1',
          tool_input: { command: 'git push' }
        },
        ANSWER_DELAY,
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_use_id: 'toolu_lead_2',
          tool_input: { command: 'echo lead' }
        },
        {
          hook_event_name: 'PreToolUse',
          agent_id: CHILD,
          tool_name: 'Write',
          tool_use_id: 'toolu_child_3',
          tool_input: { file_path: 'D:/repo/out.txt' }
        },
        { hook_event_name: 'SubagentStop', agent_id: CHILD }
      ])
      expect(states.slice(2)).toEqual(['waiting', 'waiting', 'working', 'working'])
    })
  })

  it('ends when the asking child stops', async () => {
    await withServer(async (server) => {
      const states = await run(server, [
        { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
        { hook_event_name: 'SubagentStart', agent_id: CHILD, agent_type: 'general-purpose' },
        {
          hook_event_name: 'PermissionRequest',
          agent_id: CHILD,
          tool_name: 'Bash',
          tool_use_id: 'toolu_child_1',
          tool_input: { command: 'git push' }
        },
        { hook_event_name: 'SubagentStop', agent_id: CHILD },
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Agent',
          tool_use_id: 'toolu_lead_agent',
          tool_response: 'child done'
        }
      ])
      expect(states.slice(2)).toEqual(['waiting', 'working', 'working'])
    })
  })
})
