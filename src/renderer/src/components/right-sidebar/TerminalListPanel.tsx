import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { translate } from '@/i18n/i18n'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { selectTerminalListTabSources } from '@/lib/terminal-list-tab-sources'
import {
  buildTerminalListEntries,
  orderTerminalTabsForStrip,
  type TerminalListEntry,
  type TerminalListStatus
} from '@/lib/terminal-list-model'
import { useAppStore } from '@/store'
import { EMPTY_TABS, FilledBellIcon } from '../sidebar/WorktreeCardHelpers'

/** What is being moved, gathered before anything moves so a person can recognise
 *  it: which agent, and the last thing that agent itself said. */
type PendingMove = {
  paneKey: string
  position: string
  sessionId: string
  agentType: string
  prompt: string
  transcriptPath?: string
}

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
    useShallow((s) => selectTerminalListTabSources(s, activeWorktreeId))
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
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const beginMove = useCallback(
    (entry: TerminalListEntry) => {
      const status = entry.paneKey ? agentStatusByPaneKey[entry.paneKey] : undefined
      const sessionId = status?.providerSession?.id?.trim()
      if (!entry.paneKey || !sessionId) {
        return
      }
      setPendingMove({
        paneKey: entry.paneKey,
        position: entry.position,
        sessionId,
        agentType: status?.agentType ?? 'agent',
        prompt: status?.prompt?.trim() ?? '',
        ...(status?.providerSession?.transcriptPath
          ? { transcriptPath: status.providerSession.transcriptPath }
          : {})
      })
    },
    [agentStatusByPaneKey]
  )

  const completeMove = useCallback(
    (toPaneKey: string) => {
      if (!pendingMove || toPaneKey === pendingMove.paneKey) {
        return
      }
      // Why the session id rather than the pane: several agents report one pane key
      // whenever a background-job host owns them, so re-pointing the pane would drag
      // the others onto this terminal too. Only the named session moves.
      transferAgentPaneAuthority({
        fromPaneKey: pendingMove.paneKey,
        toPaneKey,
        sessionId: pendingMove.sessionId
      })
      setPendingMove(null)
    },
    [pendingMove, transferAgentPaneAuthority]
  )

  if (entries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {translate('components.terminalList.empty', 'No terminals in this worktree')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pendingMove ? (
        <MoveSubjectCard
          move={pendingMove}
          onCancel={() => {
            setPendingMove(null)
          }}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scrollbar-sleek">
        {entries.map((entry) => (
          <TerminalListRow
            key={entry.paneKey ?? entry.tabId}
            entry={entry}
            canMove={Boolean(
              entry.paneKey && agentStatusByPaneKey[entry.paneKey]?.providerSession?.id
            )}
            pendingMove={pendingMove}
            onBeginMove={beginMove}
            onCompleteMove={completeMove}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * What the pending move is about to take, in that agent's own words.
 *
 * Why the agent's own words and not the status text beside it: a pane holds one
 * status, and its prompt and message fields carry over from whatever reported
 * there last. Several agents report one pane key whenever a background-job host
 * owns them, so the text on the status can belong to a different agent than the
 * one named here - and telling those apart is the whole job of this card. A
 * transcript belongs to one session by construction.
 */
function MoveSubjectCard({
  move,
  onCancel
}: {
  move: PendingMove
  onCancel: () => void
}): React.JSX.Element {
  const [spokenTurn, setSpokenTurn] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const transcriptPath = move.transcriptPath

  useEffect(() => {
    let cancelled = false
    setSpokenTurn(null)
    setLoaded(false)
    if (!transcriptPath) {
      setLoaded(true)
      return
    }
    void window.api?.agentStatus
      ?.readSessionTurn?.({ transcriptPath })
      .then((text) => {
        if (!cancelled) {
          setSpokenTurn(text ?? null)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [transcriptPath])

  return (
    <div
      data-testid="terminal-list-move-subject"
      className="flex flex-col gap-1 border-b border-amber-500/40 bg-amber-500/5 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-amber-600 dark:text-amber-400">
          {translate(
            'components.terminalList.move.title',
            'Pick the terminal this agent is really in'
          )}
        </span>
        <button
          type="button"
          data-testid="terminal-list-move-cancel"
          className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50"
          onClick={onCancel}
        >
          {translate('components.terminalList.move.cancel', 'Cancel')}
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {`${move.agentType} · ${translate('components.terminalList.move.shownAt', 'shown at')} ${move.position} · ${move.sessionId.slice(0, 8)}`}
      </div>
      {/* Why both lines: the prompt is what you asked it and the reply is what you
          watched it say — either one can be what you recognise it by. */}
      {move.prompt ? (
        <div className="line-clamp-2 text-[11px] text-foreground">{`> ${move.prompt}`}</div>
      ) : null}
      <div className="line-clamp-3 text-[11px] text-foreground/80">
        {spokenTurn ??
          (loaded
            ? translate(
                'components.terminalList.move.noTurn',
                'No recent reply found for this session.'
              )
            : translate('components.terminalList.move.loading', 'Reading its last reply…'))}
      </div>
    </div>
  )
}

function TerminalListRow({
  entry,
  canMove,
  pendingMove,
  onBeginMove,
  onCompleteMove
}: {
  entry: TerminalListEntry
  canMove: boolean
  pendingMove: PendingMove | null
  onBeginMove: (entry: TerminalListEntry) => void
  onCompleteMove: (toPaneKey: string) => void
}): React.JSX.Element {
  const clearTerminalPaneUnread = useAppStore((s) => s.clearTerminalPaneUnread)
  const isMoveSource = pendingMove?.paneKey === entry.paneKey
  const isMoveTarget = Boolean(pendingMove) && !isMoveSource && Boolean(entry.paneKey)

  return (
    <div className="flex w-full items-center">
      <button
        type="button"
        data-testid={isMoveTarget ? 'terminal-list-move-target' : 'terminal-list-row'}
        data-terminal-status={entry.status}
        data-pane-key={entry.paneKey ?? ''}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          isMoveSource
            ? 'text-muted-foreground opacity-50'
            : isMoveTarget
              ? 'text-foreground hover:bg-amber-500/15'
              : 'text-foreground hover:bg-accent/50'
        }`}
        disabled={isMoveSource}
        title={
          isMoveTarget
            ? translate(
                'components.terminalList.move.targetHint',
                'Move the agent here, to terminal {position}'
              ).replace('{position}', entry.position)
            : `${entry.position}  ${entry.name} — ${statusLabel(entry.status)}`
        }
        onClick={() => {
          if (isMoveTarget && entry.paneKey) {
            onCompleteMove(entry.paneKey)
            return
          }
          activateTabAndFocusPane(entry.tabId, entry.leafId, {
            ...(entry.paneKey ? { ackPaneKeyOnSuccess: entry.paneKey } : {}),
            flashFocusedPane: true,
            // Why the tone: this click is what clears the unread, and the rim is
            // the only place the terminal itself shows that it happened.
            ...(entry.status === 'unread' ? { flashFocusedPaneTone: 'unread' as const } : {})
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
      {/* Why only on rows carrying an agent: there is nothing to move otherwise, and
          the move is scoped to one agent session, which is also what identifies it. */}
      {canMove && !pendingMove ? (
        <button
          type="button"
          data-testid="terminal-list-move-start"
          className="mr-2 shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/50"
          title={translate(
            'components.terminalList.move.startHint',
            'This agent is not really in this terminal — move it to the one it is in'
          )}
          onClick={() => {
            onBeginMove(entry)
          }}
        >
          ⤴
        </button>
      ) : null}
    </div>
  )
}
