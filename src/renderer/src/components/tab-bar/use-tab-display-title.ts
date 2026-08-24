import { stripLeadingAgentTitleDecoration } from '../../../../shared/agent-title-decoration'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { resolveTabStripTerminalName } from '@/lib/terminal-display-name'
import { uninformativeTerminalTitles } from '../../../../shared/terminal-context'
import { useAppStore } from '../../store'

/**
 * The label a terminal tab shows in the strip.
 *
 * Why it is not just `tab.title`: a tab is a container of terminals, and its
 * title follows whichever pane happens to drive it. When one terminal is asking
 * for the user — unread, or running the live turn — the strip names that
 * terminal instead, so the label and the leading icon always talk about the same
 * one. The agent's own leading status glyph is stripped whenever the provider
 * icon is shown, so a single agent never renders two icons.
 */
export function useTabDisplayTitle(
  tab: TerminalTab,
  tabAgent: TuiAgent | null,
  showUnreadActivity: boolean
): string {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  // Why not memoised: this hook is called outside a React render in places, and
  // the set is one string — the selector below returns a primitive either way.
  const uninformativeTitles = uninformativeTerminalTitles(activeWorktreeId)
  // Why: the resolver returns a primitive so unrelated store writes cannot repaint this tab.
  const terminalName = useAppStore((s) =>
    resolveTabStripTerminalName(
      {
        layout: s.terminalLayoutsByTabId?.[tab.id],
        paneTitlesByLeafId: s.runtimePaneTitlesByLeafId?.[tab.id],
        agentStatusByPaneKey: s.agentStatusByPaneKey,
        tabTitle: tab.title,
        unreadTerminalPanes: s.unreadTerminalPanes,
        unreadAgentCompletionPanes: s.unreadAgentCompletionPanes,
        uninformativeTitles
      },
      tab.id,
      { preferUnread: showUnreadActivity }
    )
  )

  // Why: a user-renamed tab is an explicit choice and outranks both.
  if (tab.customTitle) {
    return tab.customTitle
  }
  const title = terminalName ?? tab.title
  return tabAgent ? stripLeadingAgentTitleDecoration(title) : title
}
