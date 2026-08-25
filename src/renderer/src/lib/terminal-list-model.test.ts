import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry, AgentStatusState } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import type { Tab, TabGroup } from '../../../shared/tab-types'
import {
  buildTerminalListEntries,
  orderTerminalTabsForStrip,
  type TerminalListInput
} from './terminal-list-model'

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
    paneTitlesByTabId: {},
    agentStatusByPaneKey: {},
    unreadTerminalPanes: {},
    unreadAgentCompletionPanes: {},
    unreadTerminalTabs: {},
    now: NOW,
    ...overrides
  }
}

describe('agents on a terminal that is gone', () => {
  const DEAD_LEAF = '44444444-4444-4444-8444-444444444444'

  // Why this row exists: a hook reports the pane key its process was born with,
  // and a background-job host hands that key to every session it owns. Once the
  // terminal that started the host is closed, those agents report a pane nothing
  // draws — the turn runs with no sign of it anywhere. The row is also the only
  // way to reach the move that fixes it.
  it('lists a running agent whose pane no longer exists', () => {
    const dead = makePaneKey('tab-1', DEAD_LEAF)
    const working = agentEntry(dead, 'working')
    working.prompt = 'Please rename the held tool sockets'
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'a tab')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A]) },
        agentStatusByPaneKey: { [dead]: working }
      })
    )

    const orphan = entries.find((entry) => entry.paneKey === dead)
    expect(orphan?.status).toBe('working')
    expect(orphan?.leafId).toBeNull()
    expect(orphan?.position).toBe('1.-')
    expect(orphan?.name).toBe('Rename the held tool sockets')
  })

  // Why only while running, asking, or unread: a finished agent that has been seen
  // is nothing to act on, and a row that never leaves would silt up the list.
  it('leaves out an agent that has finished and been seen', () => {
    const dead = makePaneKey('tab-1', DEAD_LEAF)
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'a tab')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A]) },
        agentStatusByPaneKey: { [dead]: agentEntry(dead, 'done') }
      })
    )

    expect(entries.some((entry) => entry.paneKey === dead)).toBe(false)
  })

  // Why: a background job gets a row of its own, keyed by its session, and the
  // unread it leaves there when it finishes is the only sign that it did.
  it('keeps a finished job listed while its unread is unseen, and asks ahead of it', () => {
    const finished = makePaneKey('tab-1', DEAD_LEAF)
    const asking = makePaneKey('tab-1', '55555555-5555-4555-8555-555555555555')
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'a tab')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A]) },
        agentStatusByPaneKey: {
          [finished]: agentEntry(finished, 'done'),
          [asking]: agentEntry(asking, 'waiting')
        },
        unreadAgentCompletionPanes: { [finished]: true }
      })
    )

    expect(entries.map((entry) => [entry.paneKey, entry.status, entry.position])).toEqual([
      [asking, 'question', '1.-'],
      [finished, 'unread', '1.-'],
      [makePaneKey('tab-1', LEAF_A), 'idle', '1.1']
    ])
  })

  // Why: a pane key from a tab this workspace does not have belongs to another
  // workspace's list, not this one.
  it('leaves out an agent whose tab is not in this workspace', () => {
    const foreign = makePaneKey('tab-other', DEAD_LEAF)
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'a tab')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A]) },
        agentStatusByPaneKey: { [foreign]: agentEntry(foreign, 'working') }
      })
    )

    expect(entries.some((entry) => entry.paneKey === foreign)).toBe(false)
  })
})

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

  // Why (regression): falling back to the shared tab title made every terminal in a
  // split show the same name, and that name followed whichever pane had focus.
  it('names each pane by its own live title instead of the shared tab title', () => {
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'focused pane title')],
        layoutsByTabId: { 'tab-1': layout([LEAF_A, LEAF_B, LEAF_C]) },
        paneTitlesByTabId: { 'tab-1': { [LEAF_A]: 'build', [LEAF_B]: 'server' } }
      })
    )

    expect(entries.map((entry) => entry.name)).toEqual([
      'build',
      'server',
      // Why: only a pane with no live title of its own is left with the tab's.
      'focused pane title'
    ])
  })

  // Why a question outranks the bell: a turn waiting on the user goes nowhere
  // until they answer; a finished terminal can wait a moment longer.
  it('orders a question ahead of unread, even on an unread pane', () => {
    const askingKey = makePaneKey('tab-1', LEAF_A)
    const unreadKey = makePaneKey('tab-1', LEAF_B)
    const askingUnreadKey = makePaneKey('tab-1', LEAF_C)

    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'shell')],
        layoutsByTabId: { 'tab-1': layout([LEAF_B, LEAF_A, LEAF_C]) },
        agentStatusByPaneKey: {
          [askingKey]: agentEntry(askingKey, 'waiting'),
          [askingUnreadKey]: agentEntry(askingUnreadKey, 'blocked')
        },
        unreadAgentCompletionPanes: { [unreadKey]: true, [askingUnreadKey]: true }
      })
    )

    expect(entries.map((entry) => entry.status)).toEqual(['question', 'question', 'unread'])
    expect(entries.map((entry) => entry.paneKey)).toEqual([askingKey, askingUnreadKey, unreadKey])
  })

  it('treats a waiting turn as a question and a stale entry as idle', () => {
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

    expect(entries.map((entry) => entry.status)).toEqual(['question', 'idle'])
  })

  // Why: the list is sorted by status, so a row's number is the only thing left
  // pointing at where the terminal actually lives in the tab strip.
  it('numbers rows by tab and pane, not by their place in the sorted list', () => {
    const unread = makePaneKey('tab-2', LEAF_B)

    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'first'), tab('tab-2', 'second')],
        layoutsByTabId: {
          'tab-1': layout([LEAF_A]),
          'tab-2': layout([LEAF_A, LEAF_B])
        },
        unreadTerminalPanes: { [unread]: true }
      })
    )

    expect(entries.map((entry) => entry.position)).toEqual(['2.2', '1.1', '2.1'])
    expect(entries[0]?.status).toBe('unread')
  })

  it('lists a tab with no serialized layout as one terminal', () => {
    const entries = buildTerminalListEntries(
      input({
        tabs: [tab('tab-1', 'restored')],
        unreadTerminalTabs: { 'tab-1': true }
      })
    )

    expect(entries).toEqual([
      {
        paneKey: null,
        tabId: 'tab-1',
        leafId: null,
        position: '1.1',
        name: 'restored',
        status: 'unread'
      }
    ])
  })
})

function unifiedTab(
  id: string,
  entityId: string,
  groupId: string,
  contentType: Tab['contentType'] = 'terminal'
): Tab {
  return {
    id,
    entityId,
    groupId,
    worktreeId: 'wt-1',
    contentType,
    label: entityId,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: NOW
  }
}

function group(id: string, tabOrder: string[]): TabGroup {
  return { id, worktreeId: 'wt-1', activeTabId: tabOrder[0] ?? null, tabOrder }
}

describe('orderTerminalTabsForStrip', () => {
  it('follows the strip: groups in order, each group in its own tab order', () => {
    const ordered = orderTerminalTabsForStrip({
      tabs: [tab('term-a', 'a'), tab('term-b', 'b'), tab('term-c', 'c')],
      unifiedTabs: [
        unifiedTab('u1', 'term-b', 'g1'),
        unifiedTab('u2', 'term-a', 'g1'),
        unifiedTab('u3', 'term-c', 'g2'),
        unifiedTab('u4', 'browser-1', 'g1', 'browser')
      ],
      groups: [group('g1', ['u1', 'u4', 'u2']), group('g2', ['u3'])]
    })

    expect(ordered.map((entry) => entry.id)).toEqual(['term-b', 'term-a', 'term-c'])
  })

  it('keeps a terminal that no group order mentions', () => {
    const ordered = orderTerminalTabsForStrip({
      tabs: [tab('term-a', 'a'), tab('term-orphan', 'orphan')],
      unifiedTabs: [unifiedTab('u1', 'term-a', 'g1')],
      groups: [group('g1', ['u1'])]
    })

    // Why: dropping it would hide an unread terminal from the list entirely.
    expect(ordered.map((entry) => entry.id)).toEqual(['term-a', 'term-orphan'])
  })
})
