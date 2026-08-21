import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { isTerminalLeafId, makePaneKey } from '../../../shared/stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/terminal-tab-types'
import { isExplicitAgentStatusFresh } from './agent-status'
import { resolveTerminalName } from './terminal-display-name'
import { paneHasUnreadActivity, type PaneUnreadMaps } from './terminal-unread'

/** The three buckets the terminal list groups by, in display order. */
export type TerminalListStatus = 'unread' | 'working' | 'idle'

export type TerminalListEntry = {
  /** Null for a tab whose layout has not been serialized yet (activate the tab only). */
  paneKey: string | null
  tabId: string
  leafId: string | null
  name: string
  status: TerminalListStatus
}

const STATUS_RANK: Record<TerminalListStatus, number> = { unread: 0, working: 1, idle: 2 }

function leafIdsInOrder(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  return node.type === 'leaf'
    ? [node.leafId]
    : [...leafIdsInOrder(node.first), ...leafIdsInOrder(node.second)]
}

/**
 * Why permission folds into 'working': the list has three buckets, and a turn
 * waiting on the user is still a turn in progress — the unread bell is what
 * marks "this one needs you", not the run state.
 */
function agentStatusToListStatus(
  entry: AgentStatusEntry | undefined,
  now: number
): TerminalListStatus {
  if (!entry || !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
    return 'idle'
  }
  return entry.state === 'working' || entry.state === 'blocked' || entry.state === 'waiting'
    ? 'working'
    : 'idle'
}

export type TerminalListInput = PaneUnreadMaps & {
  tabs: readonly TerminalTab[]
  layoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
  unreadTerminalTabs: Readonly<Record<string, boolean | undefined>> | undefined
  now: number
}

/**
 * One row per terminal, sorted unread → working → idle. Ties keep tab order and
 * then pane order inside the tab, so the list only reorders when a terminal
 * actually changes bucket.
 */
export function buildTerminalListEntries(input: TerminalListInput): TerminalListEntry[] {
  const ranked: { entry: TerminalListEntry; tabIndex: number; paneIndex: number }[] = []

  input.tabs.forEach((tab, tabIndex) => {
    const layout = input.layoutsByTabId[tab.id]
    const leafIds = leafIdsInOrder(layout?.root)
    const tabTitle = tab.title || tab.defaultTitle || ''

    if (leafIds.length === 0) {
      // Why: a tab restored but never mounted has no serialized layout yet. It is
      // still one terminal, so list it and fall back to the tab-level unread flag.
      ranked.push({
        entry: {
          paneKey: null,
          tabId: tab.id,
          leafId: null,
          name: tabTitle,
          status: input.unreadTerminalTabs?.[tab.id] === true ? 'unread' : 'idle'
        },
        tabIndex,
        paneIndex: 0
      })
      return
    }

    leafIds.forEach((leafId, paneIndex) => {
      const paneKey = isTerminalLeafId(leafId) ? makePaneKey(tab.id, leafId) : null
      const status: TerminalListStatus =
        paneKey && paneHasUnreadActivity(input, paneKey)
          ? 'unread'
          : agentStatusToListStatus(
              paneKey ? input.agentStatusByPaneKey?.[paneKey] : undefined,
              input.now
            )
      ranked.push({
        entry: {
          paneKey,
          tabId: tab.id,
          leafId,
          name: resolveTerminalName(
            {
              layout,
              agentStatusByPaneKey: input.agentStatusByPaneKey,
              tabTitle
            },
            tab.id,
            leafId
          ),
          status
        },
        tabIndex,
        paneIndex
      })
    })
  })

  return ranked
    .sort(
      (a, b) =>
        STATUS_RANK[a.entry.status] - STATUS_RANK[b.entry.status] ||
        a.tabIndex - b.tabIndex ||
        a.paneIndex - b.paneIndex
    )
    .map((item) => item.entry)
}
