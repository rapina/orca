import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import type { Tab, TabGroup } from '../../../shared/tab-types'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/terminal-tab-types'
import { deriveGeneratedTabTitle } from '../../../shared/agent-tab-title'
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
  /** Position as the user counts it: `<tab>.<terminal>`, both 1-based. */
  position: string
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

/**
 * Terminal tabs in the order the tab strip shows them: groups left to right, each
 * group in its own canonical tab order.
 *
 * Why not the content store's own array: a drag or a split reorders the strip
 * without touching it, so its index would not match the tab the user counts on
 * screen — and the row number exists precisely to point back at that tab.
 */
export function orderTerminalTabsForStrip(input: {
  tabs: readonly TerminalTab[]
  unifiedTabs: readonly Tab[]
  groups: readonly TabGroup[]
}): TerminalTab[] {
  const tabById = new Map(input.tabs.map((tab) => [tab.id, tab]))
  const unifiedById = new Map(input.unifiedTabs.map((tab) => [tab.id, tab]))
  const ordered: TerminalTab[] = []
  const seen = new Set<string>()

  for (const group of input.groups) {
    for (const unifiedTabId of group.tabOrder) {
      const unified = unifiedById.get(unifiedTabId)
      if (!unified || unified.contentType !== 'terminal') {
        continue
      }
      const tab = tabById.get(unified.entityId)
      if (!tab || seen.has(tab.id)) {
        continue
      }
      seen.add(tab.id)
      ordered.push(tab)
    }
  }
  // Why: a terminal missing from every group order (mid-move, stale hydration) is
  // still a terminal. Dropping it here would hide an unread one from the list.
  for (const tab of input.tabs) {
    if (!seen.has(tab.id)) {
      ordered.push(tab)
    }
  }
  return ordered
}

export type TerminalListInput = PaneUnreadMaps & {
  tabs: readonly TerminalTab[]
  layoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  /** Live pane titles by tab then layout leaf; without them a split's terminals
   *  would all fall back to the shared tab title. */
  paneTitlesByTabId: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
  unreadTerminalTabs: Readonly<Record<string, boolean | undefined>> | undefined
  /** Window titles that name no turn — see `TerminalNameSources`. */
  uninformativeTitles?: ReadonlySet<string> | undefined
  now: number
}

/**
 * Rows for agents that name a terminal this workspace no longer has.
 *
 * Why they need a row at all: a hook reports the pane key its process was born
 * with, and a background-job host hands that key to every session it owns. When
 * the terminal that started the host is closed, its key stops matching any pane
 * and every one of those agents reports somewhere that is not drawn — the turn
 * runs with no sign of it anywhere on screen. A row is also the only way to reach
 * the move that fixes it.
 *
 * Why only while running: a finished agent on a pane that no longer exists is
 * nothing to act on, and would sit in the list forever. This row leaves by itself.
 */
function appendUnattachedAgents(
  ranked: { entry: TerminalListEntry; tabIndex: number; paneIndex: number }[],
  input: TerminalListInput
): void {
  const listedPaneKeys = new Set(ranked.map((item) => item.entry.paneKey).filter(Boolean))
  const tabIndexById = new Map(input.tabs.map((tab, index) => [tab.id, index]))
  for (const [paneKey, entry] of Object.entries(input.agentStatusByPaneKey ?? {})) {
    if (listedPaneKeys.has(paneKey)) {
      continue
    }
    if (agentStatusToListStatus(entry, input.now) !== 'working') {
      continue
    }
    const parsed = parsePaneKey(paneKey)
    const tabIndex = parsed ? tabIndexById.get(parsed.tabId) : undefined
    // Why the tab has to be one of ours: a pane key from another workspace's tab
    // belongs to that workspace's list, not this one.
    if (!parsed || tabIndex === undefined) {
      continue
    }
    ranked.push({
      entry: {
        paneKey,
        tabId: parsed.tabId,
        leafId: null,
        // Why no pane number: there is no terminal to count to.
        position: `${tabIndex + 1}.-`,
        name:
          deriveGeneratedTabTitle(entry.prompt) ??
          entry.terminalTitle?.trim() ??
          input.tabs[tabIndex]?.title ??
          '',
        status: 'working'
      },
      tabIndex,
      paneIndex: Number.MAX_SAFE_INTEGER
    })
  }
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
          position: `${tabIndex + 1}.1`,
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
          // Why: the list is sorted by status, so the row has to say where the
          // terminal actually lives — the number is how the user counts it in the
          // tab strip, not a position in this list.
          position: `${tabIndex + 1}.${paneIndex + 1}`,
          name: resolveTerminalName(
            {
              layout,
              paneTitlesByLeafId: input.paneTitlesByTabId?.[tab.id],
              agentStatusByPaneKey: input.agentStatusByPaneKey,
              tabTitle,
              ...(input.uninformativeTitles
                ? { uninformativeTitles: input.uninformativeTitles }
                : {})
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

  appendUnattachedAgents(ranked, input)

  return ranked
    .sort(
      (a, b) =>
        STATUS_RANK[a.entry.status] - STATUS_RANK[b.entry.status] ||
        a.tabIndex - b.tabIndex ||
        a.paneIndex - b.paneIndex
    )
    .map((item) => item.entry)
}
