import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import { isExplicitAgentStatusFresh } from './agent-status'

/**
 * Agents waiting on an answer right now, across every workspace.
 *
 * Why blocked counts: a permission prompt is a question too — the agent asked and
 * stopped. Why the freshness gate: an abandoned pane must not hold the taskbar
 * hostage for a question nobody is going to answer.
 */
export function getQuestionBadgeCount(
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined,
  now: number
): number {
  let count = 0
  for (const entry of Object.values(agentStatusByPaneKey ?? {})) {
    if (entry.restoredUnconfirmed) {
      continue
    }
    if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
      continue
    }
    if (entry.state === 'blocked' || entry.state === 'waiting') {
      count += 1
    }
  }
  return count
}

export function getUnreadBadgeCount({
  worktreesByRepo,
  tabsByWorktree,
  unreadTerminalTabs
}: {
  worktreesByRepo: Record<string, Worktree[]>
  tabsByWorktree: Record<string, TerminalTab[]>
  unreadTerminalTabs: Record<string, true>
}): number {
  const unreadWorktreeIds = new Set<string>()

  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (worktree.isUnread) {
        unreadWorktreeIds.add(worktree.id)
      }
    }
  }

  const unreadTabIds = new Set(Object.keys(unreadTerminalTabs))
  if (unreadTabIds.size === 0) {
    return unreadWorktreeIds.size
  }

  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs) {
      if (!unreadTabIds.delete(tab.id)) {
        continue
      }
      unreadWorktreeIds.add(worktreeId)
    }
  }

  // Why: tab unread state should normally map to a live worktree, but counting
  // unmatched entries keeps the Dock badge honest during hydration races.
  return unreadWorktreeIds.size + unreadTabIds.size
}
