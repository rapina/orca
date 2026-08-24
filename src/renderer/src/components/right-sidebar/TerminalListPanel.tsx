import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import { buildTerminalContextRequest } from '@/lib/terminal-context-request'
import { selectTerminalListTabSources } from '@/lib/terminal-list-tab-sources'
import {
  buildTerminalListEntries,
  orderTerminalTabsForStrip,
  type TerminalListEntry
} from '@/lib/terminal-list-model'
import { useAppStore } from '@/store'
import { uninformativeTerminalTitles } from '../../../../shared/terminal-context'
import { EMPTY_TABS } from '../sidebar/WorktreeCardHelpers'
import { type PendingMove, TerminalListRow } from './TerminalListRow'
import { useTerminalContexts } from './terminal-row-context'

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

  // Why: an agent that writes only its folder into the window title would name
  // every terminal of this workspace the same; the list has to skip that title.
  const uninformativeTitles = useMemo(
    () => uninformativeTerminalTitles(activeWorktreeId),
    [activeWorktreeId]
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
        uninformativeTitles,
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
      unreadTerminalTabs,
      uninformativeTitles
    ]
  )

  const contextRequest = useMemo(
    () => buildTerminalContextRequest({ entries, layoutsByTabId, agentStatusByPaneKey }),
    [entries, layoutsByTabId, agentStatusByPaneKey]
  )
  const contexts = useTerminalContexts(contextRequest)

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
            {...(entry.paneKey && contexts[entry.paneKey]
              ? { context: contexts[entry.paneKey] }
              : {})}
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
