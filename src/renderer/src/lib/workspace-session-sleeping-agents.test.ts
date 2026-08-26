import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { withoutBackgroundJobRowRecords } from './workspace-session-sleeping-agents'

type Records = NonNullable<WorkspaceSessionState['sleepingAgentSessionsByPaneKey']>

const JOB = 'ec48af73-3b2d-4656-bd74-e95a63762fd2'
const LEAF = '22222222-2222-4222-8222-222222222222'

function record(paneKey: string, sessionId: string): Records[string] {
  return {
    paneKey,
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession: { key: 'session_id', id: sessionId },
    prompt: 'p',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1
  } as Records[string]
}

describe('withoutBackgroundJobRowRecords', () => {
  it("drops the records made from a job's own row and keeps the terminals", () => {
    const terminal = makePaneKey('tab-1', LEAF)
    const jobRow = makePaneKey('tab-1', JOB)
    const records: Records = {
      [terminal]: record(terminal, JOB),
      [jobRow]: record(jobRow, JOB)
    }

    expect(Object.keys(withoutBackgroundJobRowRecords(records))).toEqual([terminal])
  })

  it('hands back the same object when there is nothing to drop', () => {
    const terminal = makePaneKey('tab-1', LEAF)
    const records: Records = { [terminal]: record(terminal, JOB) }

    expect(withoutBackgroundJobRowRecords(records)).toBe(records)
  })
})
