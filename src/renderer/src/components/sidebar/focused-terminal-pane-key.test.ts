import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  getFocusedAgentPaneKeyForWorktree,
  getFocusedTerminalPaneKeyForWorktree,
  type FocusedAgentRowHighlightState
} from './focused-agent-row-highlight'

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE = makePaneKey('tab-1', LEAF)

function state(overrides: Partial<FocusedAgentRowHighlightState> = {}) {
  return {
    activeWorktreeId: 'wt-1',
    activeTabType: 'terminal',
    activeTabId: 'tab-1',
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
    terminalLayoutsByTabId: {
      'tab-1': { root: { type: 'leaf', leafId: LEAF }, activeLeafId: LEAF, expandedLeafId: null }
    },
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    ...overrides
  } as unknown as FocusedAgentRowHighlightState
}

// Why this one is separate from the agent version: the terminal list marks the
// terminal the person is in even when nothing runs there, while the inline card
// only ever draws rows that have an agent.
describe('getFocusedTerminalPaneKeyForWorktree', () => {
  it('names the focused terminal, agent or not', () => {
    expect(getFocusedTerminalPaneKeyForWorktree(state(), 'wt-1')).toBe(PANE)
    expect(getFocusedAgentPaneKeyForWorktree(state(), 'wt-1')).toBeNull()
  })

  it('names nothing while the person is looking at something else', () => {
    expect(
      getFocusedTerminalPaneKeyForWorktree(state({ activeTabType: 'editor' }), 'wt-1')
    ).toBeNull()
    expect(getFocusedTerminalPaneKeyForWorktree(state(), 'wt-2')).toBeNull()
    expect(getFocusedTerminalPaneKeyForWorktree(state({ activeTabId: null }), 'wt-1')).toBeNull()
  })

  it('names nothing when the active tab belongs to another workspace', () => {
    expect(
      getFocusedTerminalPaneKeyForWorktree(state({ tabsByWorktree: { 'wt-1': [] } }), 'wt-1')
    ).toBeNull()
  })

  it('still finds the agent row when one is there', () => {
    expect(
      getFocusedAgentPaneKeyForWorktree(
        state({ agentStatusByPaneKey: { [PANE]: { paneKey: PANE } } as never }),
        'wt-1'
      )
    ).toBe(PANE)
  })
})
