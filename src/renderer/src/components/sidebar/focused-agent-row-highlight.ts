import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'

export type FocusedAgentRowHighlightState = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'activeTabType'
  | 'activeTabId'
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'migrationUnsupportedByPtyId'
>

/**
 * The terminal the person is in, whether or not an agent runs there.
 *
 * Why separate from the agent version below: the inline card lists agent rows, so
 * it asks for a pane that has one. The terminal list lists terminals, so it must
 * mark the focused one even when it is an empty shell. Both ask the same question
 * about focus, and asking it in one place keeps the two marks from drifting apart.
 */
export function getFocusedTerminalPaneKeyForWorktree(
  state: Pick<
    FocusedAgentRowHighlightState,
    | 'activeWorktreeId'
    | 'activeTabType'
    | 'activeTabId'
    | 'tabsByWorktree'
    | 'terminalLayoutsByTabId'
  >,
  worktreeId: string
): string | null {
  if (state.activeWorktreeId !== worktreeId || state.activeTabType !== 'terminal') {
    return null
  }

  const activeTabId = state.activeTabId
  if (!activeTabId) {
    return null
  }

  const activeTabBelongsToWorktree = (state.tabsByWorktree[worktreeId] ?? []).some(
    (tab) => tab.id === activeTabId
  )
  if (!activeTabBelongsToWorktree) {
    return null
  }

  const activeLeafId = state.terminalLayoutsByTabId[activeTabId]?.activeLeafId
  if (!activeLeafId || !isTerminalLeafId(activeLeafId)) {
    return null
  }

  return makePaneKey(activeTabId, activeLeafId)
}

/** The focused terminal, for a surface that marks where the person is standing. */
export function useFocusedTerminalPaneKey(worktreeId: string | null): string | null {
  return useAppStore((state) =>
    worktreeId ? getFocusedTerminalPaneKeyForWorktree(state, worktreeId) : null
  )
}

export function getFocusedAgentPaneKeyForWorktree(
  state: FocusedAgentRowHighlightState,
  worktreeId: string
): string | null {
  const activePaneKey = getFocusedTerminalPaneKeyForWorktree(state, worktreeId)
  if (!activePaneKey) {
    return null
  }

  // Why: the inline card lists every agent attributed to this worktree, even
  // after its status decays to idle. Highlight whichever displayed row matches
  // the focused pane — gating on freshness left clicked-into stale rows with no
  // selection coloring.
  if (state.agentStatusByPaneKey[activePaneKey]) {
    return activePaneKey
  }

  if (state.retainedAgentsByPaneKey[activePaneKey]?.worktreeId === worktreeId) {
    return activePaneKey
  }

  const hasMigrationUnsupportedRow = Object.values(state.migrationUnsupportedByPtyId).some(
    (entry) => entry.paneKey === activePaneKey
  )
  return hasMigrationUnsupportedRow ? activePaneKey : null
}

export function useFocusedAgentPaneKey(worktreeId: string): string | null {
  return useAppStore((state) => getFocusedAgentPaneKeyForWorktree(state, worktreeId))
}
