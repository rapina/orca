import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import type { Tab, TabGroup } from '../../../shared/tab-types'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/terminal-tab-types'
import { isExplicitAgentStatusFresh } from './agent-status'
import { resolveTerminalName } from './terminal-display-name'
import { paneHasUnreadActivity, type PaneUnreadMaps } from './terminal-unread'

/** The four buckets the terminal list groups by, in display order. */
export type TerminalListStatus = 'question' | 'unread' | 'working' | 'idle'

export type TerminalListEntry = {
  /** Null for a tab whose layout has not been serialized yet (activate the tab only). */
  paneKey: string | null
  tabId: string
  leafId: string | null
  /** Position as the user counts it: `<tab>.<terminal>`, both 1-based. */
  position: string
  name: string
  status: TerminalListStatus
  /** Model id the agent here last reported, as the provider names it. */
  model?: string
}

const STATUS_RANK: Record<TerminalListStatus, number> = {
  question: 0,
  unread: 1,
  working: 2,
  idle: 3
}

function leafIdsInOrder(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  return node.type === 'leaf'
    ? [node.leafId]
    : [...leafIdsInOrder(node.first), ...leafIdsInOrder(node.second)]
}

/**
 * Why a question is its own bucket, above everything: a turn waiting on the user
 * goes nowhere until they answer, so it outranks even the bell of a finished
 * terminal. Why blocked folds into it: a permission prompt is a question too -
 * the agent asked and stopped.
 */
function agentStatusToListStatus(
  entry: AgentStatusEntry | undefined,
  now: number
): 'question' | 'working' | 'idle' {
  if (!entry || !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
    return 'idle'
  }
  if (entry.state === 'blocked' || entry.state === 'waiting') {
    return 'question'
  }
  return entry.state === 'working' ? 'working' : 'idle'
}

/** Why on the row: two terminals of one repo look alike, and the model is what tells them apart. */
function agentModelField(entry: AgentStatusEntry | undefined): { model?: string } {
  const model = entry?.model?.trim()
  return model ? { model } : {}
}

function listStatusOf(
  agentStatus: 'question' | 'working' | 'idle',
  unread: boolean
): TerminalListStatus {
  if (agentStatus === 'question') {
    return 'question'
  }
  return unread ? 'unread' : agentStatus
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
 * Rows for agents that name no terminal this workspace draws.
 *
 * Why they need a row at all: a background job is given a row of its own, keyed
 * by its session id under a tab of the workspace it runs in, because the pane
 * key its hook reports is the terminal that started its host and not one it was
 * ever in. The same happens to an agent whose terminal was closed under it. In
 * both cases the turn runs with no sign of it anywhere on screen unless it is
 * listed here, and the row is the only way to reach the move that binds it to a
 * terminal.
 *
 * Why only while running, asking, or unread: an idle agent that has been seen is
 * nothing to act on, and a row that never leaves would silt up the list.
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
    const agentStatus = agentStatusToListStatus(entry, input.now)
    const unread = paneHasUnreadActivity(input, paneKey)
    if (agentStatus === 'idle' && !unread) {
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
        // Why the same resolver as every other row: this row would otherwise skip
        // the folder-only title filter and show the very name the list is built to
        // reject, and its ladder would disagree with its neighbours for no reason.
        name: resolveTerminalName(
          {
            layout: input.layoutsByTabId[parsed.tabId],
            paneTitlesByLeafId: input.paneTitlesByTabId?.[parsed.tabId],
            agentStatusByPaneKey: input.agentStatusByPaneKey,
            tabTitle: input.tabs[tabIndex]?.title ?? '',
            ...(input.uninformativeTitles ? { uninformativeTitles: input.uninformativeTitles } : {})
          },
          parsed.tabId,
          parsed.leafId
        ),
        status: listStatusOf(agentStatus, unread),
        ...agentModelField(entry)
      },
      tabIndex,
      paneIndex: Number.MAX_SAFE_INTEGER
    })
  }
}

/**
 * One row per terminal, sorted question → unread → working → idle. Ties keep tab
 * order and then pane order inside the tab, so the list only reorders when a
 * terminal actually changes bucket.
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
      const status = listStatusOf(
        agentStatusToListStatus(
          paneKey ? input.agentStatusByPaneKey?.[paneKey] : undefined,
          input.now
        ),
        Boolean(paneKey && paneHasUnreadActivity(input, paneKey))
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
          status,
          ...agentModelField(paneKey ? input.agentStatusByPaneKey?.[paneKey] : undefined)
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
