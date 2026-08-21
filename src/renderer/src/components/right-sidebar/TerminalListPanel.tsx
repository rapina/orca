import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { translate } from '@/i18n/i18n'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { buildPaneBindingAuditRequest } from '@/lib/terminal-binding-audit'
import {
  buildTerminalListEntries,
  orderTerminalTabsForStrip,
  type TerminalListEntry,
  type TerminalListStatus
} from '@/lib/terminal-list-model'
import { useAppStore } from '@/store'
import type { PaneBindingFinding } from '../../../../shared/pane-binding-audit'
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

  const transferAgentPaneAuthority = useAppStore((s) => s.transferAgentPaneAuthority)
  const [audit, setAudit] = useState<{
    ran: boolean
    busy: boolean
    findings: PaneBindingFinding[]
  }>({ ran: false, busy: false, findings: [] })

  const runAudit = useCallback(async () => {
    setAudit((current) => ({ ...current, busy: true }))
    const request = buildPaneBindingAuditRequest({
      entries,
      layoutsByTabId,
      agentStatusByPaneKey
    })
    const findings = (await window.api?.agentStatus?.auditPaneBindings?.(request)) ?? []
    setAudit({ ran: true, busy: false, findings })
  }, [entries, layoutsByTabId, agentStatusByPaneKey])

  // Why: rebinding is what the finding is for, so drop it once acted on rather
  // than leaving a stale warning until the next audit.
  const applyFinding = useCallback(
    (finding: PaneBindingFinding) => {
      transferAgentPaneAuthority({
        fromPaneKey: finding.paneKey,
        toPaneKey: finding.candidatePaneKey
      })
      setAudit((current) => ({
        ...current,
        findings: current.findings.filter((item) => item.paneKey !== finding.paneKey)
      }))
    },
    [transferAgentPaneAuthority]
  )

  const positionByPaneKey = useMemo(() => {
    const map: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.paneKey) {
        map[entry.paneKey] = entry.position
      }
    }
    return map
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {translate('components.terminalList.empty', 'No terminals in this worktree')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TerminalListAuditBar
        busy={audit.busy}
        ran={audit.ran}
        findingCount={audit.findings.length}
        onRun={() => {
          void runAudit()
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scrollbar-sleek">
        {entries.map((entry) => {
          const finding = entry.paneKey
            ? audit.findings.find((item) => item.paneKey === entry.paneKey)
            : undefined
          return (
            <TerminalListRow
              key={entry.paneKey ?? entry.tabId}
              entry={entry}
              {...(finding
                ? {
                    finding,
                    candidatePosition: positionByPaneKey[finding.candidatePaneKey] ?? '?',
                    onApplyFinding: applyFinding
                  }
                : {})}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * The audit control and its last result.
 *
 * Why a manual run: reading every terminal's recorded output is a burst of file
 * reads, and the answer only matters when a status looks wrong to the user.
 */
function TerminalListAuditBar({
  busy,
  ran,
  findingCount,
  onRun
}: {
  busy: boolean
  ran: boolean
  findingCount: number
  onRun: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
      <button
        type="button"
        data-testid="terminal-list-audit-run"
        className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
        disabled={busy}
        onClick={onRun}
      >
        {busy
          ? translate('components.terminalList.audit.running', 'Checking…')
          : translate('components.terminalList.audit.run', 'Check bindings')}
      </button>
      {ran && !busy ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {findingCount === 0
            ? translate('components.terminalList.audit.clean', 'All statuses match their terminal')
            : translate('components.terminalList.audit.found', '{count} look misplaced').replace(
                '{count}',
                String(findingCount)
              )}
        </span>
      ) : null}
    </div>
  )
}

function TerminalListRow({
  entry,
  finding,
  candidatePosition,
  onApplyFinding
}: {
  entry: TerminalListEntry
  finding?: PaneBindingFinding
  candidatePosition?: string
  onApplyFinding?: (finding: PaneBindingFinding) => void
}): React.JSX.Element {
  const clearTerminalPaneUnread = useAppStore((s) => s.clearTerminalPaneUnread)
  return (
    <div className="flex w-full items-center">
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
      {finding && onApplyFinding ? (
        <button
          type="button"
          data-testid="terminal-list-rebind"
          className="mr-2 shrink-0 rounded border border-amber-500/60 px-1.5 py-0.5 text-[11px] text-amber-500 hover:bg-amber-500/10"
          title={translate(
            'components.terminalList.audit.rebindHint',
            'This status looks like it belongs to terminal {position}. Move it there.'
          ).replace('{position}', candidatePosition ?? '?')}
          onClick={() => {
            onApplyFinding(finding)
          }}
        >
          {`⚠ → ${candidatePosition ?? '?'}`}
        </button>
      ) : null}
    </div>
  )
}
