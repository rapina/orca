import type { Tab, TabGroup } from '../../../shared/tab-types'

/**
 * Shared empties for the misses.
 *
 * Why they have to be shared: the terminal list reads these through a shallow
 * equality selector. A fresh `[]` per read is a new reference every time, so the
 * store looks changed on every render and React tears the panel down with
 * "maximum update depth exceeded" - which is exactly what happened before a
 * worktree was active and both lookups missed.
 */
export const EMPTY_UNIFIED_TABS: readonly Tab[] = Object.freeze([])
export const EMPTY_TAB_GROUPS: readonly TabGroup[] = Object.freeze([])

export type TerminalListTabSources = {
  unifiedTabs: readonly Tab[]
  groups: readonly TabGroup[]
}

export function selectTerminalListTabSources(
  state: {
    unifiedTabsByWorktree: Readonly<Record<string, Tab[] | undefined>>
    groupsByWorktree: Readonly<Record<string, TabGroup[] | undefined>>
  },
  worktreeId: string | null | undefined
): TerminalListTabSources {
  if (!worktreeId) {
    return { unifiedTabs: EMPTY_UNIFIED_TABS, groups: EMPTY_TAB_GROUPS }
  }
  return {
    unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
    groups: state.groupsByWorktree[worktreeId] ?? EMPTY_TAB_GROUPS
  }
}
