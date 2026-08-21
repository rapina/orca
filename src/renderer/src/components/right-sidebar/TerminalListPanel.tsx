import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { translate } from '@/i18n/i18n'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import {
  buildTerminalListEntries,
  orderTerminalTabsForStrip,
  type TerminalListEntry,
  type TerminalListStatus
} from '@/lib/terminal-list-model'
import { useAppStore } from '@/store'
import { EMPTY_TABS, FilledBellIcon } from '../sidebar/WorktreeCardHelpers'

function TerminalStatusIcon({ status }: { status: TerminalListStatus }): React.JSX.Element {
  if (status === 'unread') {
    return <FilledBellIcon className="size-3 shrink-0 text-amber-500" />
  }
  if (status === 'working') {
    return <AgentWorkingSpinner className="size-3 shrink-0" />
  }
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
}

function statusLabel(status: TerminalListStatus): string {
  if (status === 'unread') {
    return translate('components.terminalList.status.unread', 'Unread')
  }
  if (status === 'working') {
    return translate('components.terminalList.status.working', 'Working')
  }
  return translate('components.terminalList.status.idle', 'Idle')
}

/**
 * Every terminal of the active worktree, grouped unread → working → idle.
 *
 * Why a flat list instead of a tab tree: the point of this panel is finding the
 * terminal that needs you, so the bucket order carries the meaning and the tab
 * a terminal happens to live in is left to the click that focuses it.
 */
export default function TerminalListPanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const tabs = useAppStore((s) =>
    activeWorktreeId ? (s.tabsByWorktree[activeWorktreeId] ?? EMPTY_TABS) : EMPTY_TABS
  )
  const { layoutsByTabId, paneTitlesByTabId, agentStatusByPaneKey, agentStatusEpoch } = useAppStore(
    useShallow((s) => ({
      layoutsByTabId: s.terminalLayoutsByTabId,
      paneTitlesByTabId: s.runtimePaneTitlesByLeafId,
      agentStatusByPaneKey: s.agentStatusByPaneKey,
      agentStatusEpoch: s.agentStatusEpoch
    }))
  )
  const { unreadTerminalPanes, unreadAgentCompletionPanes, unreadTerminalTabs } = useAppStore(
    useShallow((s) => ({
      unreadTerminalPanes: s.unreadTerminalPanes,
      unreadAgentCompletionPanes: s.unreadAgentCompletionPanes,
      unreadTerminalTabs: s.unreadTerminalTabs
    }))
  )
  const { unifiedTabs, groups } = useAppStore(
    useShallow((s) => ({
      unifiedTabs: activeWorktreeId ? (s.unifiedTabsByWorktree[activeWorktreeId] ?? []) : [],
      groups: activeWorktreeId ? (s.groupsByWorktree[activeWorktreeId] ?? []) : []
    }))
  )

  // Why: row numbers point back at the tab strip, so the tabs have to be counted in
  // the order the strip draws them rather than the order the content store holds.
  const orderedTabs = useMemo(
    () => orderTerminalTabsForStrip({ tabs, unifiedTabs, groups }),
    [tabs, unifiedTabs, groups]
  )

  const entries = useMemo(
    () =>
      buildTerminalListEntries({
        tabs: orderedTabs,
        layoutsByTabId,
        paneTitlesByTabId,
        agentStatusByPaneKey,
        unreadTerminalPanes,
        unreadAgentCompletionPanes,
        unreadTerminalTabs,
        now: Date.now()
      }),
    // Why: agentStatusEpoch is the store's signal that time-based freshness moved without the
    // status map changing. Without it an abandoned agent would read as "working" here forever —
    // the same invalidation the tab strip's status resolver takes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [
      orderedTabs,
      layoutsByTabId,
      paneTitlesByTabId,
      agentStatusByPaneKey,
      agentStatusEpoch,
      unreadTerminalPanes,
      unreadAgentCompletionPanes,
      unreadTerminalTabs
    ]
  )

  if (entries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {translate('components.terminalList.empty', 'No terminals in this worktree')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scrollbar-sleek">
      {entries.map((entry) => (
        <TerminalListRow key={entry.paneKey ?? entry.tabId} entry={entry} />
      ))}
    </div>
  )
}

function TerminalListRow({ entry }: { entry: TerminalListEntry }): React.JSX.Element {
  const clearTerminalPaneUnread = useAppStore((s) => s.clearTerminalPaneUnread)
  return (
    <button
      type="button"
      data-testid="terminal-list-row"
      data-terminal-status={entry.status}
      data-pane-key={entry.paneKey ?? ''}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={`${entry.position}  ${entry.name} — ${statusLabel(entry.status)}`}
      onClick={() => {
        activateTabAndFocusPane(entry.tabId, entry.leafId, {
          ...(entry.paneKey ? { ackPaneKeyOnSuccess: entry.paneKey } : {}),
          flashFocusedPane: true
        })
        // Why: picking a row is an explicit choice of that terminal, which is what
        // dismisses unread. Focus alone does not, so the list clears it here.
        if (entry.paneKey) {
          clearTerminalPaneUnread(entry.paneKey)
        }
      }}
    >
      <TerminalStatusIcon status={entry.status} />
      {/* Why: sorting by status detaches a row from its place in the tab strip, so
          the number is what points back at "tab 3, terminal 1". */}
      <span className="shrink-0 tabular-nums text-muted-foreground">{entry.position}</span>
      <span className="truncate">{entry.name}</span>
    </button>
  )
}
