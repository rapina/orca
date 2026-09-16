import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { isShellProcess } from '../../../shared/agent-detection'
import { resolveExplicitTerminalTitleAgentType } from '../../../shared/terminal-title-agent-type'
import type { PaneForegroundAgentEntry } from '../store/slices/pane-foreground-agent'

export function terminalHasAgent(input: {
  status?: AgentStatusEntry
  foreground?: PaneForegroundAgentEntry
  title?: string
  launchAgent?: string
}): boolean {
  const { status, foreground, title, launchAgent } = input
  if (foreground?.agent) {
    return true
  }
  // Remote panes have no local process evidence; a missing probe is not an exit.
  if (!status?.connectionId && foreground?.shellForeground) {
    return false
  }
  if (status?.agentType) {
    if (status.state === 'done' && title && isShellProcess(title)) {
      return false
    }
    return true
  }
  return Boolean(launchAgent || (title && resolveExplicitTerminalTitleAgentType(title)))
}
