import { beforeEach, describe, expect, it } from 'vitest'
import {
  bindAgentSessionPane,
  forgetAgentPaneAuthorityAliasesByTabIds,
  resetAgentPaneAuthorityAliasesForTests,
  resolveAgentPaneAuthorityKey,
  resolveMovedAgentPaneKey,
  transferAgentPaneAuthorityAlias
} from './agent-pane-authority'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'
const LEAF_C = '33333333-3333-4333-8333-333333333333'
const PANE_A = `tabA:${LEAF_A}`
const PANE_B = `tabB:${LEAF_B}`
const PANE_C = `tabC:${LEAF_C}`

describe('agent session pane bindings', () => {
  beforeEach(() => {
    resetAgentPaneAuthorityAliasesForTests()
  })

  it('sends a bound session to its terminal and leaves the reported pane otherwise', () => {
    bindAgentSessionPane('session-1', PANE_C)

    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-1')).toBe(PANE_C)
    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-2')).toBe(PANE_A)
    expect(resolveAgentPaneAuthorityKey(PANE_A)).toBe(PANE_A)
  })

  // Why this is the whole point: every background-job session reports the pane key
  // of the terminal that started their shared host. Correcting one by re-pointing
  // that pane would drag all the others onto the corrected terminal with it.
  it('moves only the corrected session off a shared reported pane', () => {
    bindAgentSessionPane('session-1', PANE_C)

    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-1')).toBe(PANE_C)
    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-9')).toBe(PANE_A)
  })

  // Why: the correction names a terminal, and that terminal can still detach later.
  it('follows its terminal through a later pane move', () => {
    bindAgentSessionPane('session-1', PANE_C)
    transferAgentPaneAuthorityAlias({ fromPaneKey: PANE_C, toPaneKey: PANE_B })

    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-1')).toBe(PANE_B)
  })

  it('rejects a binding to something that is not a pane', () => {
    expect(bindAgentSessionPane('session-1', 'not-a-pane-key')).toBe(false)
    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-1')).toBe(PANE_A)
  })

  // Why: a binding to a purged tab would route a live session to a pane that is gone.
  it('drops a binding whose terminal was purged', () => {
    bindAgentSessionPane('session-1', PANE_C)
    forgetAgentPaneAuthorityAliasesByTabIds(['tabC'])

    expect(resolveAgentPaneAuthorityKey(PANE_A, 'session-1')).toBe(PANE_A)
  })

  // Why this exists: a finished turn arrives as a pane-level notification that
  // never names its session, so without the pane it left being remembered the
  // status row moves to the right terminal and its unread stays on the wrong one.
  it('points a pane-only event at the terminal its one moved session went to', () => {
    bindAgentSessionPane('session-1', PANE_C, PANE_A)

    expect(resolveMovedAgentPaneKey(PANE_A)).toBe(PANE_C)
    expect(resolveMovedAgentPaneKey(PANE_B)).toBeNull()
  })

  // Why: with two gone there is nothing in a pane-only event to say which of them
  // it belongs to, and guessing drops it on a terminal it was never in.
  it('says nothing when a pane gave up more than one session', () => {
    bindAgentSessionPane('session-1', PANE_C, PANE_A)
    bindAgentSessionPane('session-2', PANE_B, PANE_A)

    expect(resolveMovedAgentPaneKey(PANE_A)).toBeNull()
  })

  it('follows a session that was moved again', () => {
    bindAgentSessionPane('session-1', PANE_C, PANE_A)
    bindAgentSessionPane('session-1', PANE_B, PANE_C)

    expect(resolveMovedAgentPaneKey(PANE_A)).toBeNull()
    expect(resolveMovedAgentPaneKey(PANE_C)).toBe(PANE_B)
  })

  it('forgets a move whose terminal was purged', () => {
    bindAgentSessionPane('session-1', PANE_C, PANE_A)
    forgetAgentPaneAuthorityAliasesByTabIds(['tabC'])

    expect(resolveMovedAgentPaneKey(PANE_A)).toBeNull()
  })
})
