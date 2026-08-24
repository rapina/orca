import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { TerminalListEntry } from './terminal-list-model'

export type PaneBindingAuditStatus = {
  paneKey: string
  sessionId: string
  /** The session's own on-disk record. Main reads its last turns from this and
   *  matches those against each terminal's recording. */
  transcriptPath?: string
}

export type PaneBindingAuditRequest = {
  panes: { paneKey: string; ptyId: string }[]
  statuses: PaneBindingAuditStatus[]
}

/**
 * The terminals to read and the statuses to check.
 *
 * Why only panes with a pty: the audit reads a terminal's recorded output, and a
 * pane that never ran one has nothing to say. Why only statuses with a session
 * id: the correction binds that id to a terminal, so a status without one has
 * nothing to move.
 *
 * Why the status's own text is not sent as evidence: a pane holds one status, and
 * its prompt, tool and message fields carry over from whatever reported there
 * last. Several sessions report one pane key whenever a background-job host owns
 * them, so that text can belong to a different session than the id beside it -
 * and matching it points confidently at *that* session's terminal. The session's
 * transcript is the only text that provably belongs to the session.
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

  const statuses: PaneBindingAuditStatus[] = []
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
    const transcriptPath = status.providerSession?.transcriptPath?.trim()
    statuses.push({ paneKey, sessionId, ...(transcriptPath ? { transcriptPath } : {}) })
  }
  return { panes, statuses }
}
