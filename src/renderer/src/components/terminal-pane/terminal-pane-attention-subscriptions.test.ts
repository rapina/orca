import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'

const storeMock = vi.hoisted(() => ({
  state: {
    settings: { terminalUnreadOutline: true },
    unreadTerminalPanes: {},
    unreadAgentCompletionPanes: {}
  } as {
    settings: { terminalUnreadOutline?: boolean } | null
    unreadTerminalPanes: Record<string, true>
    unreadAgentCompletionPanes: Record<string, true>
  },
  subscribers: [] as ((state: {
    settings: { terminalUnreadOutline?: boolean } | null
    unreadTerminalPanes: Record<string, true>
    unreadAgentCompletionPanes: Record<string, true>
  }) => void)[]
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeMock.state,
    subscribe: (
      listener: (state: {
        settings: { terminalUnreadOutline?: boolean } | null
        unreadTerminalPanes: Record<string, true>
        unreadAgentCompletionPanes: Record<string, true>
      }) => void
    ) => {
      storeMock.subscribers.push(listener)
      return () => {
        storeMock.subscribers = storeMock.subscribers.filter((candidate) => candidate !== listener)
      }
    }
  }
}))

import {
  applyTerminalPaneAttentionToManager,
  resetTerminalPaneAttentionSubscriptionsForTests,
  subscribeTerminalPaneAttention
} from './terminal-pane-attention-subscriptions'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'
const LEAF_3 = '33333333-3333-4333-8333-333333333333'

function emitStoreChange(): void {
  for (const subscriber of storeMock.subscribers.slice()) {
    subscriber(storeMock.state)
  }
}

function createPane(leafId: string) {
  const attributes = new Set<string>()
  return {
    leafId,
    container: {
      setAttribute: vi.fn((name: string) => {
        attributes.add(name)
      }),
      removeAttribute: vi.fn((name: string) => {
        attributes.delete(name)
      }),
      hasAttribute: (name: string) => attributes.has(name)
    }
  }
}

function createManager(panes: ReturnType<typeof createPane>[]) {
  return {
    getPanes: () => panes
  }
}

describe('terminal pane attention subscriptions', () => {
  beforeEach(() => {
    storeMock.state = {
      settings: { terminalUnreadOutline: true },
      unreadTerminalPanes: {},
      unreadAgentCompletionPanes: {}
    }
    storeMock.subscribers = []
  })

  afterEach(() => {
    resetTerminalPaneAttentionSubscriptionsForTests()
    storeMock.subscribers = []
  })

  it('shares one store subscriber and notifies only tabs with changed pane attention', () => {
    const tab1Listener = vi.fn()
    const tab2Listener = vi.fn()
    const unsubscribeTab1 = subscribeTerminalPaneAttention('tab-1', tab1Listener)
    const unsubscribeTab2 = subscribeTerminalPaneAttention('tab-2', tab2Listener)

    expect(storeMock.subscribers).toHaveLength(1)

    storeMock.state = {
      ...storeMock.state,
      unreadTerminalPanes: { [makePaneKey('tab-1', LEAF_1)]: true }
    }
    emitStoreChange()

    expect(tab1Listener).toHaveBeenCalledTimes(1)
    expect(tab2Listener).not.toHaveBeenCalled()

    storeMock.state = {
      ...storeMock.state,
      unreadTerminalPanes: {
        ...storeMock.state.unreadTerminalPanes,
        [makePaneKey('tab-2', LEAF_2)]: true
      }
    }
    emitStoreChange()

    expect(tab1Listener).toHaveBeenCalledTimes(1)
    expect(tab2Listener).toHaveBeenCalledTimes(1)

    unsubscribeTab1()
    expect(storeMock.subscribers).toHaveLength(1)
    unsubscribeTab2()
    expect(storeMock.subscribers).toHaveLength(0)
  })

  it('does not notify unread changes while attention is disabled, but notifies all on toggle', () => {
    storeMock.state = {
      settings: { terminalUnreadOutline: false },
      unreadTerminalPanes: {},
      unreadAgentCompletionPanes: {}
    }
    const tab1Listener = vi.fn()
    const tab2Listener = vi.fn()
    subscribeTerminalPaneAttention('tab-1', tab1Listener)
    subscribeTerminalPaneAttention('tab-2', tab2Listener)

    storeMock.state = {
      ...storeMock.state,
      unreadTerminalPanes: { [makePaneKey('tab-1', LEAF_1)]: true }
    }
    emitStoreChange()

    expect(tab1Listener).not.toHaveBeenCalled()
    expect(tab2Listener).not.toHaveBeenCalled()

    storeMock.state = {
      ...storeMock.state,
      settings: { terminalUnreadOutline: true }
    }
    emitStoreChange()

    expect(tab1Listener).toHaveBeenCalledTimes(1)
    expect(tab2Listener).toHaveBeenCalledTimes(1)
  })

  it('applies attention attributes only to unread panes in the requested tab', () => {
    storeMock.state = {
      settings: { terminalUnreadOutline: true },
      unreadTerminalPanes: {
        [makePaneKey('tab-1', LEAF_1)]: true,
        [makePaneKey('tab-2', LEAF_3)]: true
      },
      unreadAgentCompletionPanes: {}
    }
    const pane1 = createPane(LEAF_1)
    const pane2 = createPane(LEAF_2)

    applyTerminalPaneAttentionToManager(createManager([pane1, pane2]) as never, 'tab-1')

    expect(pane1.container.hasAttribute('data-terminal-attention')).toBe(true)
    expect(pane2.container.hasAttribute('data-terminal-attention')).toBe(false)
  })

  // Why: unread has two sources, and an agent turn ending out of view is the common
  // one — a ring that only followed bells would miss most of what it exists for.
  it('rings a pane whose unread came from an agent completion', () => {
    storeMock.state = {
      settings: { terminalUnreadOutline: true },
      unreadTerminalPanes: {},
      unreadAgentCompletionPanes: { [makePaneKey('tab-1', LEAF_2)]: true }
    }
    const pane1 = createPane(LEAF_1)
    const pane2 = createPane(LEAF_2)

    applyTerminalPaneAttentionToManager(createManager([pane1, pane2]) as never, 'tab-1')

    expect(pane1.container.hasAttribute('data-terminal-attention')).toBe(false)
    expect(pane2.container.hasAttribute('data-terminal-attention')).toBe(true)
  })

  it('notifies when a completion unread lands', () => {
    const listener = vi.fn()
    subscribeTerminalPaneAttention('tab-1', listener)

    storeMock.state = {
      ...storeMock.state,
      unreadAgentCompletionPanes: { [makePaneKey('tab-1', LEAF_1)]: true }
    }
    emitStoreChange()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('drops the ring while the setting is off', () => {
    storeMock.state = {
      settings: { terminalUnreadOutline: false },
      unreadTerminalPanes: { [makePaneKey('tab-1', LEAF_1)]: true },
      unreadAgentCompletionPanes: {}
    }
    const pane1 = createPane(LEAF_1)

    applyTerminalPaneAttentionToManager(createManager([pane1]) as never, 'tab-1')

    expect(pane1.container.hasAttribute('data-terminal-attention')).toBe(false)
  })
})
