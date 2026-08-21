import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry, AgentStatusState } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import { buildTerminalListEntries, type TerminalListInput } from './terminal-list-model'

const NOW = 1_700_000_000_000
const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const LEAF_C = '33333333-3333-4333-8333-333333333333'

function tab(id: string, title: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'wt-1',
    title,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: NOW
  }
}

function layout(
  leafIds: string[],
  titlesByLeafId?: Record<string, string>
): TerminalLayoutSnapshot {
  const [first, ...rest] = leafIds
  const root = rest.reduce<TerminalLayoutSnapshot['root']>(
    (node, leafId) =>
      node
        ? { type: 'split', direction: 'vertical', first: node, second: { type: 'leaf', leafId } }
        : { type: 'leaf', leafId },
    first ? { type: 'leaf', leafId: first } : null
  )
  return {
    root,
    activeLeafId: first ?? null,
    expandedLeafId: null,
    ...(titlesByLeafId ? { titlesByLeafId } : {})
  }
}

function agentEntry(
  paneKey: string,
  state: AgentStatusState,
  terminalTitle?: string
): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    paneKey,
    stateHistory: [],
    ...(terminalTitle ? { terminalTitle } : {})
  }
}

function input(overrides: Partial<TerminalListInput>): TerminalListInput {
  return {
    tabs: [],
    layoutsByTabId: {},
    agentStatusByPaneKey: {},
    unreadTerminalPanes: {},
    unreadAgentCompletionPanes: {},
    unreadTerminalTabs: {},
    now: NOW,
    ...overrides
  }
}

describe('buildTerminalListEntries', () => {
  it('orders unread first, then working, then idle', () => {
    const idleKey = makePaneKey('tab-1', LEAF_A)
    const workingKey = makePaneKey('tab-1', LEAF_B)
    const unreadKey = makePaneKey('tab-1', LEAF_C)

    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'shell')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A, LEAF_B, LEAF_C]) },
        agentStatusByPaneKey: { [workingKey]: agentEntry(workingKey, 'working') },
        unreadAgentCompletionPanes: { [unreadKey]: true }
      })
    )

    expect(entries.map((entry) => entry.paneKey)).toEqual([unreadKey, workingKey, idleKey])
    expect(entries.map((entry) => entry.status)).toEqual(['unread', 'working', 'idle'])
  })

  it('names a terminal by pane title, then live agent title, then the tab title', () => {
    const named = makePaneKey('tab-1', LEAF_A)
    const agentTitled = makePaneKey('tab-1', LEAF_B)

    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'tab title')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A, LEAF_B, LEAF_C], { [LEAF_A]: 'build' }) },
        agentStatusByPaneKey: { [agentTitled]: agentEntry(agentTitled, 'done', 'dialog rewrite') }
      })
    )

    expect(entries.map((entry) => entry.name)).toEqual(['build', 'dialog rewrite', 'tab title'])
    expect(entries.every((entry) => entry.status === 'idle')).toBe(true)
    expect(entries[0]?.paneKey).toBe(named)
  })

  it('treats a waiting turn as working and a stale entry as idle', () => {
    const waitingKey = makePaneKey('tab-1', LEAF_A)
    const staleKey = makePaneKey('tab-1', LEAF_B)
    const stale = agentEntry(staleKey, 'working')

    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'shell')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A, LEAF_B]) },
        agentStatusByPaneKey: {
          [waitingKey]: agentEntry(waitingKey, 'waiting'),
          // Why: an abandoned pane must not read as working forever.
          [staleKey]: {
            ...stale,
            updatedAt: NOW - 60 * 60 * 1000,
            stateStartedAt: NOW - 60 * 60 * 1000
          }
        }
      })
    )

    expect(entries.map((entry) => entry.status)).toEqual(['working', 'idle'])
  })

  it('lists a tab with no serialized layout as one terminal', () => {
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'restored')],
        unreadTerminalTabs: { 'tab-1': true }
      })
    )

    expect(entries).toEqual([
      { paneKey: null, tabId: 'tab-1', leafId: null, name: 'restored', status: 'unread' }
    ])
  })
})
