import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { PaneBindingStatusInput } from '../../../shared/pane-binding-audit'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { TerminalListEntry } from './terminal-list-model'

export type PaneBindingAuditRequest = {
  panes: { paneKey: string; ptyId: string }[]
  statuses: PaneBindingStatusInput[]
}

/**
 * The terminals to read and the statuses to check.
 *
 * Why only panes with a pty: the audit reads a terminal's recorded output, and a
 * pane that never ran one has nothing to say. Why only statuses with a session
 * id: that id is the thing the recording can be searched for.
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
    const evidence = status.lastAssistantMessage?.trim()
    statuses.push({ paneKey, sessionId, ...(evidence ? { evidence } : {}) })
  }
  return { panes, statuses }
}
