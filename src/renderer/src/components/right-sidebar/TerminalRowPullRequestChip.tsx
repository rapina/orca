import { useState } from 'react'
import { Copy, ExternalLink, MonitorUp } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { pullRequestLabel } from '../../../../shared/terminal-context'
import { TERMINAL_LIST_LINK_ATTR } from './terminal-list-link-marker'
import { closeAllContextMenus } from './TerminalListRowMenu'
import {
  isLinkRoutingModifier,
  terminalRowLinkHint,
  terminalRowLinkSourceOwner,
  useTerminalRowLinkOpener
} from './terminal-row-link-open'

/**
 * One pull request under a terminal's row.
 *
 * Why a menu of its own: the terminal offers both destinations for the same
 * link, so the row does too — a click follows Link Routing, the modifier flips
 * it, and the menu names either one outright.
 */
export function TerminalRowPullRequestChip({
  url,
  ptyId
}: {
  url: string
  ptyId?: string
}): React.JSX.Element {
  const openLink = useTerminalRowLinkOpener()
  const settings = useAppStore((state) => state.settings)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })
  const sourceOwner = terminalRowLinkSourceOwner(ptyId)
  // Why local only: the in-app browser is Orca's own; a remote pane's link has no
  // managed browser to land in from this panel.
  const canOpenInOrca = sourceOwner.kind === 'local'

  return (
    <>
      <button
        type="button"
        data-testid="terminal-list-pull-request"
        {...{ [TERMINAL_LIST_LINK_ATTR]: '' }}
        className="rounded border border-border/60 px-1 text-[10px] tabular-nums text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title={`${url}\n${terminalRowLinkHint(settings, sourceOwner)}`}
        onClick={(event) => {
          openLink(url, ptyId, { modifierHeld: isLinkRoutingModifier(event) })
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          closeAllContextMenus()
          setMenuPoint({ x: event.clientX, y: event.clientY })
          setMenuOpen(true)
        }}
      >
        {pullRequestLabel(url)}
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-48" sideOffset={0} align="start">
          {canOpenInOrca ? (
            <DropdownMenuItem
              data-testid="terminal-list-link-open-orca"
              onSelect={() => {
                openLink(url, ptyId, { destination: 'orca' })
              }}
            >
              <MonitorUp className="size-4" />
              {translate('components.terminalList.link.openInOrca', 'Open in Orca')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            data-testid="terminal-list-link-open-system"
            onSelect={() => {
              openLink(url, ptyId, { destination: 'system' })
            }}
          >
            <ExternalLink className="size-4" />
            {translate('components.terminalList.link.openInBrowser', 'Open in browser')}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="terminal-list-link-copy"
            onSelect={() => {
              void navigator.clipboard?.writeText(url)
            }}
          >
            <Copy className="size-4" />
            {translate('components.terminalList.link.copy', 'Copy link')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
