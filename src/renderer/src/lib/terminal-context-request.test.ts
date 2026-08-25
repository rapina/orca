import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { buildTerminalContextRequest, terminalContextRequestKey } from './terminal-context-request'
import type { TerminalListEntry } from './terminal-list-model'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const LEAF_C = '33333333-3333-4333-8333-333333333333'

function entry(tabId: string, leafId: string | null, position: string): TerminalListEntry {
  return {
    paneKey: leafId ? `${tabId}:${leafId}` : null,
    tabId,
    leafId,
    position,
    name: position,
    status: 'idle'
  }
}

function status(paneKey: string, transcriptPath?: string): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    providerSession: {
      key: 'session_id',
      id: 'session-1',
      ...(transcriptPath ? { transcriptPath } : {})
    }
  } as AgentStatusEntry
}

const layouts = {
  tabA: { root: null, ptyIdsByLeafId: { [LEAF_A]: 'pty-a' } },
  tabB: { root: null, ptyIdsByLeafId: { [LEAF_B]: 'pty-b' } }
} as unknown as Record<string, never>

describe('buildTerminalContextRequest', () => {
  it('addresses the recording by pty and the working directory by transcript', () => {
    const request = buildTerminalContextRequest({
      entries: [entry('tabA', LEAF_A, '1.1'), entry('tabB', LEAF_B, '2.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: {
        [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'C:/t/session-1.jsonl')
      }
    })

    expect(request.terminals).toEqual([
      { paneKey: `tabA:${LEAF_A}`, ptyId: 'pty-a', transcriptPath: 'C:/t/session-1.jsonl' },
      { paneKey: `tabB:${LEAF_B}`, ptyId: 'pty-b' }
    ])
  })

  // Why: with neither a recording nor a transcript there is nothing on disk to
  // read, and asking for it would cost a stat per repaint to learn that again.
  it('leaves out a terminal with nothing to read', () => {
    const request = buildTerminalContextRequest({
      entries: [entry('tabC', LEAF_C, '3.1'), entry('tabC', null, '3.2')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: {}
    })

    expect(request.terminals).toEqual([])
  })

  // Why the key exists: this panel repaints on every agent ping, and re-reading
  // every recording that often would be a disk sweep per line of agent output.
  it('changes only when what to read, or where from, changes', () => {
    const base = {
      entries: [entry('tabA', LEAF_A, '1.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: { [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'C:/t/one.jsonl') }
    }
    const first = terminalContextRequestKey(buildTerminalContextRequest(base))
    const repaint = terminalContextRequestKey(buildTerminalContextRequest({ ...base }))
    const moved = terminalContextRequestKey(
      buildTerminalContextRequest({
        ...base,
        agentStatusByPaneKey: { [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'C:/t/two.jsonl') }
      })
    )

    expect(repaint).toBe(first)
    expect(moved).not.toBe(first)
  })
})
