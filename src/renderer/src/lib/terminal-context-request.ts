import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import type { TerminalListEntry } from './terminal-list-model'

export type TerminalContextRequest = {
  terminals: { paneKey: string; ptyId?: string; transcriptPath?: string }[]
}

/**
 * Which terminals to read context for, and where each one's context lives.
 *
 * Why both sources: the pull requests a terminal opened are in its own recording,
 * which is addressed by pty; the folder its agent works in is in that agent's
 * transcript, which is addressed by session. A terminal with neither is left out
 * rather than sent as an empty ask.
 */
export function buildTerminalContextRequest(input: {
  entries: readonly TerminalListEntry[]
  layoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot | undefined>>
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>> | undefined
}): TerminalContextRequest {
  const terminals: TerminalContextRequest['terminals'] = []
  for (const entry of input.entries) {
    if (!entry.paneKey || !entry.leafId) {
      continue
    }
    const ptyId = input.layoutsByTabId[entry.tabId]?.ptyIdsByLeafId?.[entry.leafId]
    const transcriptPath =
      input.agentStatusByPaneKey?.[entry.paneKey]?.providerSession?.transcriptPath?.trim()
    if (!ptyId && !transcriptPath) {
      continue
    }
    terminals.push({
      paneKey: entry.paneKey,
      ...(ptyId ? { ptyId } : {}),
      ...(transcriptPath ? { transcriptPath } : {})
    })
  }
  return { terminals }
}

/**
 * A value that changes only when the terminals to read, or where to read them
 * from, change.
 *
 * Why: the request is rebuilt on every render of a panel that repaints on any
 * agent ping, and re-reading every recording that often would be a disk sweep per
 * keystroke of agent output.
 */
export function terminalContextRequestKey(request: TerminalContextRequest): string {
  return request.terminals
    .map(
      (terminal) => `${terminal.paneKey}|${terminal.ptyId ?? ''}|${terminal.transcriptPath ?? ''}`
    )
    .join('\n')
}
