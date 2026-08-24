import { BellDot, CornerUpRight } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'

/** Why redeclared rather than imported: the tab bar, the sidebar and the status bar
 *  each keep their own copy of this name; one more menu is not a reason to make
 *  this file depend on any of those components. */
const CLOSE_ALL_CONTEXT_MENUS_EVENT = 'orca-close-all-context-menus'

export function closeAllContextMenus(): void {
  window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
}

/**
 * What can be done to one terminal without opening it.
 *
 * Why a menu and not buttons on the row: the row is narrow and these are rare,
 * deliberate acts. Why right-click and not a click: opening a terminal is what a
 * click means here, and opening it is also what clears its unread — a menu that
 * cost the user the unread they came to act on would be worse than no menu.
 */
export function TerminalListRowMenu({
  open,
  menuPoint,
  canMove,
  onOpenChange,
  onBeginMove,
  onMarkUnread
}: {
  open: boolean
  menuPoint: { x: number; y: number }
  canMove: boolean
  onOpenChange: (open: boolean) => void
  onBeginMove: () => void
  onMarkUnread: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: menuPoint.x, top: menuPoint.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" sideOffset={0} align="start">
        <DropdownMenuItem
          data-testid="terminal-list-menu-mark-unread"
          onSelect={() => {
            onMarkUnread()
          }}
        >
          <BellDot className="size-4" />
          {translate('components.terminalList.menu.markUnread', 'Mark as unread')}
        </DropdownMenuItem>
        {canMove ? (
          <DropdownMenuItem
            data-testid="terminal-list-menu-move-agent"
            onSelect={() => {
              onBeginMove()
            }}
          >
            <CornerUpRight className="size-4" />
            {translate(
              'components.terminalList.menu.moveAgent',
              'Move this agent to another terminal…'
            )}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
