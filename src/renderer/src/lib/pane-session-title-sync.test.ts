import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault-session-title'
import { startAiVaultTabTitleSync } from './ai-vault-tab-title-sync'
import { publishPaneSessionTitles, usePaneSessionTitles } from './pane-session-titles'

vi.mock('./worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: (state: AppState) => state.activeWorkspaceExecutionHostId
}))

function fixture() {
  const listeners = new Set<(state: AppState, previous: AppState) => void>()
  let state = {
    activeWorkspaceExecutionHostId: 'ssh:host-a',
    tabsByWorktree: { folder: [{ id: 'tab', worktreeId: 'folder', title: 'old title' }] },
    terminalLayoutsByTabId: { tab: { activeLeafId: 'a' } },
    agentStatusByPaneKey: Object.fromEntries(
      ['a', 'b'].map((leaf) => [
        `tab:${leaf}`,
        {
          paneKey: `tab:${leaf}`,
          tabId: 'tab',
          worktreeId: 'folder',
          agentType: 'codex',
          state: 'done',
          providerSession: { key: 'session_id', id: leaf }
        }
      ])
    ),
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    setAiVaultTabTitle: vi.fn()
  } as unknown as AppState
  return {
    getState: () => state,
    subscribe: (listener: (state: AppState, previous: AppState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    change: (update: Partial<AppState>) => {
      const previous = state
      state = { ...state, ...update }
      for (const listener of listeners) {
        listener(state, previous)
      }
    }
  }
}

afterEach(() => usePaneSessionTitles.setState({ titles: {} }))

describe('pane session title synchronization', () => {
  it('loads both split sessions through their host and only projects the active session to the tab', async () => {
    const store = fixture()
    const resolveSessionTitles = vi.fn(async (args: AiVaultSessionTitlesArgs) => ({
      titles: args.requests.map(({ agent, sessionId }) => ({
        agent,
        sessionId,
        title: `Task ${sessionId}`
      }))
    }))
    const stop = startAiVaultTabTitleSync({
      ...store,
      resolveSessionTitles,
      onPaneTitles: publishPaneSessionTitles
    })
    try {
      await vi.waitFor(() =>
        expect(Object.keys(usePaneSessionTitles.getState().titles)).toHaveLength(2)
      )
      expect(resolveSessionTitles).toHaveBeenCalledWith({
        executionHostScope: 'ssh:host-a',
        requests: [
          { agent: 'codex', sessionId: 'a' },
          { agent: 'codex', sessionId: 'b' }
        ]
      })
      expect(usePaneSessionTitles.getState().titles['tab:b'].title).toBe('Task b')
      expect(store.getState().setAiVaultTabTitle).toHaveBeenCalledExactlyOnceWith('tab', {
        agent: 'codex',
        sessionId: 'a',
        title: 'Task a'
      })
    } finally {
      stop()
    }
  })

  it.each(['session', 'host'] as const)(
    'rejects a late response after the %s changes',
    async (kind) => {
      const store = fixture()
      let complete!: (result: AiVaultSessionTitlesResult) => void
      const resolveSessionTitles = vi.fn(
        () =>
          new Promise<AiVaultSessionTitlesResult>((resolve) => {
            complete = resolve
          })
      )
      const stop = startAiVaultTabTitleSync({
        ...store,
        resolveSessionTitles,
        onPaneTitles: publishPaneSessionTitles
      })
      try {
        await vi.waitFor(() => expect(resolveSessionTitles).toHaveBeenCalledTimes(1))
        if (kind === 'host') {
          store.change({ activeWorkspaceExecutionHostId: 'ssh:host-b' })
        } else {
          store.change({
            agentStatusByPaneKey: Object.fromEntries(
              Object.entries(store.getState().agentStatusByPaneKey).map(([key, entry]) => [
                key,
                { ...entry, providerSession: { key: 'session_id', id: `new-${key}` } }
              ])
            )
          })
        }
        complete({ titles: [{ agent: 'codex', sessionId: 'a', title: 'Old task' }] })
        await vi.waitFor(() => expect(resolveSessionTitles).toHaveBeenCalledTimes(2))
        await Promise.resolve()
        expect(usePaneSessionTitles.getState().titles).toEqual({})
        expect(store.getState().setAiVaultTabTitle).not.toHaveBeenCalled()
      } finally {
        stop()
      }
    }
  )
})
