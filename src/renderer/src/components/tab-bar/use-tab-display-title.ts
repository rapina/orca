import { stripLeadingAgentTitleDecoration } from '../../../../shared/agent-title-decoration'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { resolveTabStripTerminalName } from '@/lib/terminal-display-name'
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
  // Why: the resolver returns a primitive so unrelated store writes cannot repaint this tab.
  const terminalName = useAppStore((s) =>
    resolveTabStripTerminalName(
      {
        layout: s.terminalLayoutsByTabId?.[tab.id],
        agentStatusByPaneKey: s.agentStatusByPaneKey,
        tabTitle: tab.title,
        unreadTerminalPanes: s.unreadTerminalPanes,
        unreadAgentCompletionPanes: s.unreadAgentCompletionPanes
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
