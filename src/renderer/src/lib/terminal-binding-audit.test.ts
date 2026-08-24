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

function status(paneKey: string, sessionId?: string, message?: string): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    ...(sessionId ? { providerSession: { key: 'session_id', id: sessionId } } : {}),
    ...(message ? { lastAssistantMessage: message } : {})
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
        [`tabA:${LEAF_A}`]: status(`tabA:${LEAF_A}`, 'session-1', 'the answer'),
        [`tabB:${LEAF_B}`]: status(`tabB:${LEAF_B}`)
      }
    })

    expect(request.panes).toEqual([
      { paneKey: `tabA:${LEAF_A}`, ptyId: 'pty-a' },
      { paneKey: `tabB:${LEAF_B}`, ptyId: 'pty-b' }
    ])
    expect(request.statuses).toEqual([
      { paneKey: `tabA:${LEAF_A}`, sessionId: 'session-1', evidence: ['the answer'] }
    ])
  })

  // Why this is the working case, not an edge one: `lastAssistantMessage` is cleared
  // the moment the next turn begins, and a `working` status is what the audit is run
  // on. Without the other fields there would be nothing to search a recording for.
  it('carries the fields that survive into the next turn', () => {
    const working = {
      paneKey: `tabA:${LEAF_A}`,
      state: 'working',
      providerSession: { key: 'session_id', id: 'session-1' },
      prompt: 'rebind the terminals',
      lastCompletedAssistantMessage: 'the previous answer',
      toolInput: 'src/shared/pane-binding-audit.ts'
    } as unknown as AgentStatusEntry
    const request = buildPaneBindingAuditRequest({
      entries: [entry('tabA', LEAF_A, '1.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: { [`tabA:${LEAF_A}`]: working }
    })

    expect(request.statuses[0]?.evidence).toEqual([
      'the previous answer',
      'rebind the terminals',
      'src/shared/pane-binding-audit.ts'
    ])
  })

  // Why: a tab restored but never mounted has no pty yet, so there is no
  // recording to read and nothing to conclude from its silence.
  it('skips panes without a pty and statuses outside the listed terminals', () => {
    const request = buildPaneBindingAuditRequest({
      entries: [entry('tabA', LEAF_A, '1.1'), entry('tabC', null, '3.1')],
      layoutsByTabId: layouts,
      agentStatusByPaneKey: {
        'other:pane': status('other:pane', 'session-2')
      }
    })

    expect(request.panes).toEqual([{ paneKey: `tabA:${LEAF_A}`, ptyId: 'pty-a' }])
    expect(request.statuses).toEqual([])
  })
})
