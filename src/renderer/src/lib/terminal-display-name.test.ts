import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry, AgentStatusState } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import {
  resolveTabStripTerminalName,
  resolveTerminalName,
  resolveUnreadTerminalName,
  resolveWorkingTerminalName
} from './terminal-display-name'

const NOW = 1_700_000_000_000
const TAB = 'tab-1'
const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function entry(leafId: string, state: AgentStatusState, terminalTitle?: string): AgentStatusEntry {
  return {
    state,
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    paneKey: makePaneKey(TAB, leafId),
    stateHistory: [],
    ...(terminalTitle ? { terminalTitle } : {})
  }
}

function sources(overrides?: {
  titlesByLeafId?: Record<string, string>
  entries?: AgentStatusEntry[]
  unreadLeafIds?: string[]
}): Parameters<typeof resolveTabStripTerminalName>[0] {
  const layout: TerminalLayoutSnapshot = {
    root: { type: 'leaf', leafId: LEAF_A },
    activeLeafId: LEAF_A,
    expandedLeafId: null,
    ...(overrides?.titlesByLeafId ? { titlesByLeafId: overrides.titlesByLeafId } : {})
  }
  return {
    layout,
    agentStatusByPaneKey: Object.fromEntries(
      (overrides?.entries ?? []).map((item) => [item.paneKey, item])
    ),
    tabTitle: 'tab title',
    unreadTerminalPanes: Object.fromEntries(
      (overrides?.unreadLeafIds ?? []).map((leafId) => [makePaneKey(TAB, leafId), true as const])
    ),
    unreadAgentCompletionPanes: {}
  }
}

describe('resolveTerminalName', () => {
  it('prefers the pane title, then the live agent title, then the tab title', () => {
    const state = sources({
      titlesByLeafId: { [LEAF_A]: 'build' },
      entries: [entry(LEAF_A, 'done', 'agent title'), entry(LEAF_B, 'done', 'agent title')]
    })

    expect(resolveTerminalName(state, TAB, LEAF_A)).toBe('build')
    expect(resolveTerminalName(state, TAB, LEAF_B)).toBe('agent title')
    expect(resolveTerminalName(sources(), TAB, LEAF_B)).toBe('tab title')
  })

  // Why: Codex writes `<spinner> <folder>` into the window title and never the
  // turn, so that title names every terminal of the workspace identically. What
  // that agent was asked is the only thing left that tells them apart.
  it('names a terminal by its turn when the window title is only a folder', () => {
    const codex = entry(LEAF_B, 'working')
    codex.prompt = 'Please rename the held tool sockets so the axe lines up'
    const state = {
      ...sources({ entries: [codex] }),
      paneTitlesByLeafId: { [LEAF_B]: '⠉ cozy-sandbox' },
      uninformativeTitles: new Set(['cozy-sandbox'])
    }

    expect(resolveTerminalName(state, TAB, LEAF_B)).toBe('Rename the held tool sockets so the axe')
  })

  // Why pinned: the tab title *is* one of the pane titles — whichever pane drove
  // it — so a rule that skipped a pane title matching the tab's erased a
  // terminal's own name exactly while that pane was the focused one.
  it('keeps a pane title that the tab happens to share', () => {
    const spoken = 'homestead cleanup design clarification'
    const state = {
      ...sources({ entries: [entry(LEAF_B, 'working')] }),
      paneTitlesByLeafId: { [LEAF_B]: spoken },
      tabTitle: spoken,
      uninformativeTitles: new Set(['cozy-sandbox'])
    }

    expect(resolveTerminalName(state, TAB, LEAF_B)).toBe(spoken)
  })

  // Why: an agent that does name its turn keeps naming it — this must not become a
  // rule that throws away the better title Claude already writes.
  it('keeps a window title that names a turn', () => {
    const state = {
      ...sources({ entries: [entry(LEAF_B, 'working')] }),
      paneTitlesByLeafId: { [LEAF_B]: '✳ homestead cleanup design clarification' },
      uninformativeTitles: new Set(['cozy-sandbox'])
    }

    expect(resolveTerminalName(state, TAB, LEAF_B)).toBe('homestead cleanup design clarification')
  })
})

describe('resolveWorkingTerminalName', () => {
  it('names the terminal running the live turn', () => {
    const state = sources({
      entries: [entry(LEAF_A, 'done', 'finished one'), entry(LEAF_B, 'working', 'running one')]
    })

    expect(resolveWorkingTerminalName(state, TAB, NOW)).toBe('running one')
  })

  it('counts a turn waiting on the user as working', () => {
    const state = sources({ entries: [entry(LEAF_B, 'waiting', 'asking')] })

    expect(resolveWorkingTerminalName(state, TAB, NOW)).toBe('asking')
  })

  it('ignores stale entries so an abandoned pane cannot rename the tab', () => {
    const stale = { ...entry(LEAF_B, 'working', 'zombie'), updatedAt: NOW - 60 * 60 * 1000 }
    const state = sources({ entries: [stale] })

    expect(resolveWorkingTerminalName(state, TAB, NOW)).toBeNull()
  })

  it('is null when nothing is running', () => {
    expect(resolveWorkingTerminalName(sources(), TAB, NOW)).toBeNull()
  })
})

describe('resolveTabStripTerminalName', () => {
  it('prefers the unread terminal while the bell owns the icon', () => {
    const state = sources({
      entries: [entry(LEAF_B, 'working', 'running one')],
      unreadLeafIds: [LEAF_A],
      titlesByLeafId: { [LEAF_A]: 'waiting one' }
    })

    expect(resolveTabStripTerminalName(state, TAB, { preferUnread: true }, NOW)).toBe('waiting one')
  })

  it('falls back to the working terminal when the live status owns the icon', () => {
    const state = sources({
      entries: [entry(LEAF_B, 'working', 'running one')],
      unreadLeafIds: [LEAF_A],
      titlesByLeafId: { [LEAF_A]: 'waiting one' }
    })

    // Why: a working tab hides the bell, so naming the unread terminal would point
    // the label at a terminal the icon is not talking about.
    expect(resolveTabStripTerminalName(state, TAB, { preferUnread: false }, NOW)).toBe(
      'running one'
    )
  })

  it('is null when the tab has neither, leaving the tab title alone', () => {
    expect(resolveTabStripTerminalName(sources(), TAB, { preferUnread: true }, NOW)).toBeNull()
  })
})

describe('resolveUnreadTerminalName', () => {
  it('is null when nothing is unread', () => {
    expect(resolveUnreadTerminalName(sources(), TAB)).toBeNull()
  })
})
