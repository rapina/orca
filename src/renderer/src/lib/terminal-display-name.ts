import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { makePaneKey, isTerminalLeafId, parsePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import { isExplicitAgentStatusFresh } from './agent-status'
import { collectUnreadLeafIds, type PaneUnreadMaps } from './terminal-unread'

export type TerminalNameSources = {
  layout: TerminalLayoutSnapshot | null | undefined
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
  /** Shown when the terminal has neither a user title nor a live agent title. */
  tabTitle: string
}

/**
 * Display name of one terminal.
 *
 * Why this order: a user-assigned pane title is an explicit choice and wins; the
 * agent's live terminal title is the name the user recognizes in the tab strip;
 * the tab's own title is the last resort for a plain, untitled shell.
 */
export function resolveTerminalName(
  sources: TerminalNameSources,
  tabId: string,
  leafId: string
): string {
  const paneTitle = sources.layout?.titlesByLeafId?.[leafId]?.trim()
  if (paneTitle) {
    return paneTitle
  }
  if (isTerminalLeafId(leafId)) {
    const agentTitle = sources.agentStatusByPaneKey?.[makePaneKey(tabId, leafId)]?.terminalTitle
    const trimmed = agentTitle?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return sources.tabTitle
}

/**
 * Name of the terminal a tab's unread belongs to, or null when the tab has none.
 * Oldest-sorted leaf id wins so a tab with two unread terminals keeps one stable
 * label instead of flapping between them on unrelated store writes.
 */
export function resolveUnreadTerminalName(
  sources: TerminalNameSources & PaneUnreadMaps,
  tabId: string
): string | null {
  const [leafId] = collectUnreadLeafIds(sources, tabId)
  if (!leafId) {
    return null
  }
  return resolveTerminalName(sources, tabId, leafId)
}

/**
 * Name of the terminal running the tab's live turn, or null when none is.
 * Stale hook entries are ignored so an abandoned pane cannot keep renaming the
 * tab — the same freshness gate the tab's status dot uses.
 */
export function resolveWorkingTerminalName(
  sources: TerminalNameSources,
  tabId: string,
  now: number = Date.now()
): string | null {
  const leafIds: string[] = []
  for (const [paneKey, entry] of Object.entries(sources.agentStatusByPaneKey ?? {})) {
    const parsed = parsePaneKey(entry.paneKey || paneKey)
    if (!parsed || parsed.tabId !== tabId) {
      continue
    }
    if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
      continue
    }
    if (entry.state === 'working' || entry.state === 'blocked' || entry.state === 'waiting') {
      leafIds.push(parsed.leafId)
    }
  }
  // Why: sorted so a tab running two turns keeps one stable label instead of
  // flapping between them on unrelated store writes.
  const [leafId] = leafIds.sort()
  return leafId ? resolveTerminalName(sources, tabId, leafId) : null
}

/**
 * Name the tab strip shows for a terminal tab, or null to keep the tab's own title.
 *
 * Why this order: the label answers "which terminal does this tab want me for" —
 * a waiting (unread) terminal outranks a running one, and the caller passes
 * `preferUnread: false` while the live status dot has taken the icon, so the
 * label never names a terminal the icon is not talking about.
 */
export function resolveTabStripTerminalName(
  sources: TerminalNameSources & PaneUnreadMaps,
  tabId: string,
  opts: { preferUnread: boolean },
  now: number = Date.now()
): string | null {
  if (opts.preferUnread) {
    const unread = resolveUnreadTerminalName(sources, tabId)
    if (unread) {
      return unread
    }
  }
  return resolveWorkingTerminalName(sources, tabId, now)
}
