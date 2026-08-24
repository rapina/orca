import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { buildPaneBindingAuditRequest } from './terminal-binding-audit'
import type { TerminalListEntry } from './terminal-list-model'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

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

function status(paneKey: string, sessionId?: string, transcriptPath?: string): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    ...(sessionId
      ? {
          providerSession: {
            key: 'session_id',
            id: sessionId,
            ...(transcriptPath ? { transcriptPath } : {})
          }
        }
      : {})
  } as AgentStatusEntry
}

describe('buildPaneBindingAuditRequest', () => {
  const layouts = {
    tabA: { root: null, ptyIdsByLeafId: { [LEAF_A]: 'pty-a' } },
    tabB: { root: null, ptyIdsByLeafId: { [LEAF_B]: 'pty-b' } }
  } as unknown as Record<string, never>

  it('pairs each listed terminal with its pty and keeps statuses that carry a session', () => {
    const request = buildPaneBindingAuditRequest({
      entries: [entry('tabA', LEAF_A, '1.1'), entry('tabB', LEAF_B, '2.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: {
        [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'session-1', 'C:/transcripts/session-1.jsonl'),
        [`tabB:${LEAF_B}`]: status(`tabB:${LEAF_B}`)
      }
    })

    expect(request.panes).toEqual([
      { paneKey: `tabA:${LEAF_A}`, ptyId: 'pty-a' },
      { paneKey: `tabB:${LEAF_B}`, ptyId: 'pty-b' }
    ])
    expect(request.statuses).toEqual([
      {
        paneKey: `tabA:${LEAF_A}`,
        sessionId: 'session-1',
        transcriptPath: 'C:/transcripts/session-1.jsonl'
      }
    ])
  })

  // Why nothing else is sent: a pane holds one status and its prompt, tool and
  // message fields carry over from whatever reported there last, so on a pane key
  // several sessions share, that text can belong to a different session than the
  // id beside it and would point straight at that session's terminal.
  it('sends no text of its own, only the session and where its record lives', () => {
    const noisy = {
      paneKey: `tabA:${LEAF_A}`,
      state: 'working',
      providerSession: { key: 'session_id', id: 'session-1' },
      prompt: 'a prompt that may belong to another session',
      lastAssistantMessage: 'an answer that may belong to another session',
      lastCompletedAssistantMessage: 'and so may this one',
      toolInput: 'cd /some/shared/path && ls'
    } as unknown as AgentStatusEntry
    const request = buildPaneBindingAuditRequest({
      entries: [entry('tabA', LEAF_A, '1.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: { [`tabA:${LEAF_A}`]: noisy }
    })

    expect(request.statuses).toEqual([{ paneKey: `tabA:${LEAF_A}`, sessionId: 'session-1' }])
  })

  // Why: a tab restored but never mounted has no pty yet, so there is no
  // recording to read and nothing to conclude from its silence.
  it('skips panes without a pty and statuses outside the listed terminals', () => {
    const request = buildPaneBindingAuditRequest({
      entries: [entry('tabA', LEAF_A, '1.1'), entry('tabC', null, '3.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: {
        [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'session-1'),
        [`tabB:${LEAF_B}`]: status(`tabB:${LEAF_B}`, 'session-2')
      }
    })

    expect(request.panes).toEqual([{ paneKey: `tabA:${LEAF_A}`, ptyId: 'pty-a' }])
    expect(request.statuses).toEqual([{ paneKey: `tabA:${LEAF_A}`, sessionId: 'session-1' }])
  })
})
