import { parsePaneKey } from '../../../shared/stable-pane-id'

/**
 * Unread is owned per terminal (pane), not per tab: a BEL marks
 * `unreadTerminalPanes`, and an agent turn that ends out of view marks
 * `unreadAgentCompletionPanes`. Every surface that shows unread — the pane
 * header, the tab strip, the terminal list, the taskbar — reads these helpers
 * so a single rule decides what "unread" means for one terminal.
 */
export type PaneUnreadMaps = {
  unreadTerminalPanes: Readonly<Record<string, boolean | undefined>> | undefined
  unreadAgentCompletionPanes: Readonly<Record<string, boolean | undefined>> | undefined
}

const NO_UNREAD: Readonly<Record<string, boolean | undefined>> = {}

// Why: partial store snapshots (tests, hydration, remote mirrors) can omit these
// maps entirely, and a crash here would take the whole tab strip down with it.
function unreadSources(maps: PaneUnreadMaps): Readonly<Record<string, boolean | undefined>>[] {
  return [maps.unreadTerminalPanes ?? NO_UNREAD, maps.unreadAgentCompletionPanes ?? NO_UNREAD]
}

export function paneHasUnreadActivity(maps: PaneUnreadMaps, paneKey: string): boolean {
  return unreadSources(maps).some((map) => map[paneKey] === true)
}

/**
 * Leaf ids of a tab's unread panes, sorted so a caller can subscribe to the
 * joined string and skip re-rendering when the set itself did not change.
 */
export function collectUnreadLeafIds(maps: PaneUnreadMaps, tabId: string): string[] {
  const leafIds = new Set<string>()
  for (const map of unreadSources(maps)) {
    for (const [paneKey, unread] of Object.entries(map)) {
      if (unread !== true) {
        continue
      }
      const parsed = parsePaneKey(paneKey)
      if (parsed && parsed.tabId === tabId) {
        leafIds.add(parsed.leafId)
      }
    }
  }
  return [...leafIds].sort()
}

let lastFocusedPaneKey: string | null = null

/**
 * True when focus just moved to a terminal that was not already the focused one.
 *
 * Why: unread clears by visiting a terminal, and returning to the Orca window
 * refocuses the terminal you left. Without this guard an alt-tab back would
 * silence a terminal the user never looked at. A terminal that already holds
 * focus therefore stays unread until the user types in it.
 */
export function noteTerminalPaneFocused(paneKey: string): boolean {
  if (lastFocusedPaneKey === paneKey) {
    return false
  }
  lastFocusedPaneKey = paneKey
  return true
}

export function resetTerminalPaneFocusTrackingForTests(): void {
  lastFocusedPaneKey = null
}

/** Pane keys of every unread terminal, across all tabs and worktrees. */
export function collectUnreadPaneKeys(maps: PaneUnreadMaps): string[] {
  const paneKeys = new Set<string>()
  for (const map of unreadSources(maps)) {
    for (const [paneKey, unread] of Object.entries(map)) {
      if (unread === true && parsePaneKey(paneKey)) {
        paneKeys.add(paneKey)
      }
    }
  }
  return [...paneKeys].sort()
}
