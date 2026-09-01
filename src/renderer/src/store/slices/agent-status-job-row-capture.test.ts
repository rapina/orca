import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { AppState } from '../types'
import { createTestStore, makeTab } from './store-test-helpers'

const JOB = 'ec48af73-3b2d-4656-bd74-e95a63762fd2'
const LEAF = '22222222-2222-4222-8222-222222222222'

// Why: measured after a restart — every remembered background job had become a
// fresh tab running `claude --resume <job>`, most of them daemon spares with no
// transcript. The job's own row is not a terminal and must never be slept as one.
describe('sleeping-session capture and a background job of its own row', () => {
  it('never records the row, while a terminal running the same session is kept', () => {
    const store = createTestStore()
    store.setState({
      tabsByWorktree: { 'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1' })] }
    } as Partial<AppState>)
    const jobRow = makePaneKey('tab-1', JOB)
    const terminal = makePaneKey('tab-1', LEAF)
    for (const paneKey of [jobRow, terminal]) {
      store
        .getState()
        .setAgentStatus(
          paneKey,
          { state: 'working', prompt: 'audit the inventory', agentType: 'claude' },
          'Claude',
          { updatedAt: 10, stateStartedAt: 10 },
          { tabId: 'tab-1', worktreeId: 'wt-1' },
          { providerSession: { key: 'session_id', id: JOB } }
        )
    }

    store.getState().captureAllSleepingAgentSessions('quit')

    const records = store.getState().sleepingAgentSessionsByPaneKey
    expect(records[jobRow]).toBeUndefined()
    expect(records[terminal]).toMatchObject({
      origin: 'quit',
      providerSession: { key: 'session_id', id: JOB }
    })
  })
})
