import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'

/**
 * The unread marker on one terminal's header, sitting beside the pane actions.
 *
 * Why per pane: unread is owned by a terminal, so the tab-level bell alone cannot
 * say which of a split's terminals is waiting — this one can.
 */
export function PaneUnreadBell({ leafId }: { leafId: string }): React.JSX.Element {
  const label = translate('components.terminalUnread.paneBell', 'Unread terminal activity')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="pane-unread-bell"
          data-leaf-id={leafId}
          className="mr-1 inline-flex shrink-0 items-center"
          aria-label={label}
        >
          <FilledBellIcon className="size-3 text-amber-500 drop-shadow-sm" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
