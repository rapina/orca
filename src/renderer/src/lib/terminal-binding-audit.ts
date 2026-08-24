import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { PaneBindingStatusInput } from '../../../shared/pane-binding-audit'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { TerminalListEntry } from './terminal-list-model'

export type PaneBindingAuditRequest = {
  panes: { paneKey: string; ptyId: string }[]
  statuses: PaneBindingStatusInput[]
}

/**
 * Text this turn put on the terminal it actually runs in.
 *
 * Why all four and not just the assistant message: `lastAssistantMessage` is
 * cleared the moment the next turn starts, which is exactly when a `working`
 * status is worth auditing - a check run then would have nothing to search for.
 * `lastCompletedAssistantMessage` survives that clear, the prompt is echoed by
 * the TUI, and a tool argument is printed with the tool call.
 */
function evidenceFor(status: AgentStatusEntry): string[] {
  const evidence: string[] = []
  for (const candidate of [
    status.lastAssistantMessage,
    status.lastCompletedAssistantMessage,
    status.prompt,
    status.toolInput
  ]) {
    const text = candidate?.trim()
    if (text) {
      evidence.push(text)
    }
  }
  return evidence
}

/**
 * The terminals to read and the statuses to check.
 *
 * Why only panes with a pty: the audit reads a terminal's recorded output, and a
 * pane that never ran one has nothing to say. Why only statuses with a session
 * id: the correction binds that id to a terminal, so a status without one has
 * nothing to move.
 */
export function buildPaneBindingAuditRequest(input: {
  entries: readonly TerminalListEntry[]
  layoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>> | undefined
}): PaneBindingAuditRequest {
  const panes: PaneBindingAuditRequest['panes'] = []
  const paneKeys = new Set<string>()
  for (const entry of input.entries) {
    if (!entry.paneKey || !entry.leafId) {
      continue
    }
    const ptyId = input.layoutsByTabId[entry.tabId]?.ptyIdsByLeafId?.[entry.leafId]
    if (!ptyId) {
      continue
    }
    panes.push({ paneKey: entry.paneKey, ptyId })
    paneKeys.add(entry.paneKey)
  }

  const statuses: PaneBindingStatusInput[] = []
  for (const [paneKey, status] of Object.entries(input.agentStatusByPaneKey ?? {})) {
    // Why: a status on a pane this worktree does not list belongs to another
    // window's terminals; the recordings here cannot speak for it.
    if (!paneKeys.has(paneKey)) {
      continue
    }
    const sessionId = status.providerSession?.id?.trim()
    if (!sessionId) {
      continue
    }
    const evidence = evidenceFor(status)
    statuses.push({ paneKey, sessionId, ...(evidence.length > 0 ? { evidence } : {}) })
  }
  return { panes, statuses }
}
