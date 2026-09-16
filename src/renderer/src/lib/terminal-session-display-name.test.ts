import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { resolveTabStripTerminalName, resolveTerminalName } from './terminal-display-name'

const TAB = 'tab'
const LEAF = '11111111-1111-4111-8111-111111111111'
const KEY = makePaneKey(TAB, LEAF)

function sources(): Parameters<typeof resolveTabStripTerminalName>[0] {
  return {
    layout: { root: { type: 'leaf', leafId: LEAF }, activeLeafId: LEAF, expandedLeafId: null },
    paneTitlesByLeafId: { [LEAF]: 'delivery proposal review' },
    tabTitle: 'Previous session task',
    agentStatusByPaneKey: {},
    unreadTerminalPanes: {},
    unreadAgentCompletionPanes: {}
  }
}

describe('current terminal session names', () => {
  it('uses the active terminal when all split terminals are idle', () => {
    expect(resolveTabStripTerminalName(sources(), TAB, { preferUnread: false })).toBe(
      'delivery proposal review'
    )
  })

  it('does not return to a previous session title when a turn ends', () => {
    const state = sources()
    state.agentStatusByPaneKey![KEY] = {
      paneKey: KEY,
      state: 'working',
      prompt: '',
      updatedAt: Date.now(),
      stateStartedAt: Date.now(),
      stateHistory: []
    }
    expect(resolveTabStripTerminalName(state, TAB, { preferUnread: false })).toBe(
      'delivery proposal review'
    )
    state.agentStatusByPaneKey![KEY].state = 'done'
    expect(resolveTabStripTerminalName(state, TAB, { preferUnread: false })).toBe(
      'delivery proposal review'
    )
  })

  it('prefers the Codex session name over follow-up prompts and checks session identity', () => {
    const state = sources()
    state.agentStatusByPaneKey![KEY] = {
      paneKey: KEY,
      state: 'done',
      agentType: 'codex',
      prompt: 'Continue the work',
      updatedAt: 1,
      stateStartedAt: 1,
      stateHistory: [],
      providerSession: { key: 'session_id', id: 'session-a' }
    }
    state.sessionTitlesByPaneKey = {
      [KEY]: { agent: 'codex', sessionId: 'session-a', title: 'Terminal naming repair' }
    }
    expect(resolveTerminalName(state, TAB, LEAF)).toBe('Terminal naming repair')
    state.agentStatusByPaneKey![KEY].prompt = 'Check the tests again'
    expect(resolveTerminalName(state, TAB, LEAF)).toBe('Terminal naming repair')
    expect(resolveTabStripTerminalName(state, TAB, { preferUnread: false })).toBe(
      'Terminal naming repair'
    )
    state.agentStatusByPaneKey![KEY].providerSession!.id = 'session-b'
    expect(resolveTerminalName(state, TAB, LEAF)).toBe('Check the tests again')
    state.layout!.titlesByLeafId = { [LEAF]: 'My terminal' }
    expect(resolveTerminalName(state, TAB, LEAF)).toBe('My terminal')
  })
})
