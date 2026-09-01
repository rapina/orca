import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { buildBody, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

const JOB = 'f59926b4-dd7f-4020-b44b-5840f5892b64'
const TOOL_USE = 'toolu_01permission'

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

// Why: a background job asks for permission with PermissionRequest and, once the
// person approves it wherever the job is being watched, goes straight on to the
// tool - no keystroke reaches Orca. The next tool hook alone has to end the wait.
describe('a background job approved outside Orca', () => {
  it('leaves the permission wait on its next tool hook', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const key = makePaneKey('tab-1', JOB)
      const stateOf = (): string | undefined =>
        server.getStatusSnapshot().find((entry) => entry.paneKey === key)?.state

      await postHookEvent(server, jobBody({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }))
      expect(stateOf()).toBe('working')

      await postHookEvent(
        server,
        jobBody({
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_use_id: TOOL_USE,
          tool_input: { command: 'git push' }
        })
      )
      expect(stateOf()).toBe('waiting')

      await postHookEvent(
        server,
        jobBody({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_use_id: TOOL_USE,
          tool_input: { command: 'git push' }
        })
      )
      expect(stateOf()).toBe('working')

      await postHookEvent(
        server,
        jobBody({
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: TOOL_USE,
          tool_response: 'ok'
        })
      )
      expect(stateOf()).toBe('working')

      await postHookEvent(
        server,
        jobBody({ hook_event_name: 'Stop', last_assistant_message: 'done' })
      )
      expect(stateOf()).toBe('done')
    } finally {
      await server.stop()
    }
  })
})
