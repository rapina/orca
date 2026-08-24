import { useState } from 'react'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { translate } from '@/i18n/i18n'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import type { TerminalListEntry, TerminalListStatus } from '@/lib/terminal-list-model'
import { useAppStore } from '@/store'
import type { TerminalContext } from '../../../../shared/terminal-context'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'
import { closeAllContextMenus, TerminalListRowMenu } from './TerminalListRowMenu'
import { TerminalRowContext } from './terminal-row-context'

/** What a pending move is taking, so a row can tell whether it is the source. */
export type PendingMove = {
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

export function statusLabel(status: TerminalListStatus): string {
  if (status === 'unread') {
    return translate('components.terminalList.status.unread', 'Unread')
  }
  if (status === 'working') {
    return translate('components.terminalList.status.working', 'Working')
  }
  return translate('components.terminalList.status.idle', 'Idle')
}

export function TerminalListRow({
  entry,
  context,
  canMove,
  pendingMove,
  onBeginMove,
  onCompleteMove
}: {
  entry: TerminalListEntry
  context?: TerminalContext
  canMove: boolean
  pendingMove: PendingMove | null
  onBeginMove: (entry: TerminalListEntry) => void
  onCompleteMove: (toPaneKey: string) => void
}): React.JSX.Element {
  const clearTerminalPaneUnread = useAppStore((s) => s.clearTerminalPaneUnread)
  const markTerminalPaneUnread = useAppStore((s) => s.markTerminalPaneUnread)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })
  const isMoveSource = pendingMove?.paneKey === entry.paneKey
  const isMoveTarget = Boolean(pendingMove) && !isMoveSource && Boolean(entry.paneKey)

  return (
    <div
      className="w-full"
      // Why capture, and why nothing else happens here: opening a terminal is what
      // a click on this row means, and opening it is what clears its unread. A
      // right-click that fell through to that would take the unread the user came
      // to act on, so it stops here and only puts the menu up.
      onContextMenuCapture={(event) => {
        if (!entry.paneKey) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        closeAllContextMenus()
        setMenuPoint({ x: event.clientX, y: event.clientY })
        setMenuOpen(true)
      }}
    >
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
      </div>
      {context ? <TerminalRowContext context={context} /> : null}
      <TerminalListRowMenu
        open={menuOpen}
        menuPoint={menuPoint}
        canMove={canMove && !pendingMove}
        onOpenChange={setMenuOpen}
        onBeginMove={() => {
          onBeginMove(entry)
        }}
        onMarkUnread={() => {
          if (entry.paneKey) {
            markTerminalPaneUnread(entry.paneKey)
          }
        }}
      />
    </div>
  )
}
