import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getQuestionBadgeCount, getUnreadBadgeCount } from '@/lib/unread-badge-count'
import { useAppStore } from '@/store'

function setUnreadDockBadgeCountBestEffort(count: number, questions = 0): void {
  const setBadge = window.api?.app?.setUnreadDockBadgeCount
  if (!setBadge) {
    return
  }
  void setBadge(count, { questions }).catch(() => {
    // Dock sync is best-effort chrome; stale badge state should not affect app use.
  })
}

export function clearUnreadDockBadgeCount(): void {
  setUnreadDockBadgeCountBestEffort(0)
}

export function useUnreadDockBadge(): typeof clearUnreadDockBadgeCount {
  const { worktreesByRepo, tabsByWorktree, unreadTerminalTabs } = useAppStore(
    useShallow((state) => ({
      worktreesByRepo: state.worktreesByRepo,
      tabsByWorktree: state.tabsByWorktree,
      unreadTerminalTabs: state.unreadTerminalTabs
    }))
  )
  // Why: this hook is always mounted; unrelated remote writes must not rescan every workspace.
  const unreadCount = useMemo(
    () => getUnreadBadgeCount({ worktreesByRepo, tabsByWorktree, unreadTerminalTabs }),
    [tabsByWorktree, unreadTerminalTabs, worktreesByRepo]
  )

  const { agentStatusByPaneKey, agentStatusEpoch } = useAppStore(
    useShallow((state) => ({
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      agentStatusEpoch: state.agentStatusEpoch
    }))
  )
  // Why the epoch: freshness is time-based, and the store bumps it at the stale
  // boundary without replacing the map — the same invalidation the tab strip takes.
  const questionCount = useMemo(
    () => getQuestionBadgeCount(agentStatusByPaneKey, Date.now()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [agentStatusByPaneKey, agentStatusEpoch]
  )

  // oxlint-disable-next-line react-doctor/no-derived-state-effect -- Why: this syncs an external OS dock badge, not React render state.
  useEffect(() => {
    setUnreadDockBadgeCountBestEffort(unreadCount, questionCount)
  }, [unreadCount, questionCount])

  return clearUnreadDockBadgeCount
}
