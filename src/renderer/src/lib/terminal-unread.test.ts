import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  collectUnreadLeafIds,
  collectUnreadPaneKeys,
  paneHasUnreadActivity
} from './terminal-unread'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function maps(overrides: { bells?: string[]; completions?: string[] }): {
  unreadTerminalPanes: Record<string, true>
  unreadAgentCompletionPanes: Record<string, true>
} {
  return {
    unreadTerminalPanes: Object.fromEntries(
      (overrides.bells ?? []).map((key) => [key, true as const])
    ),
    unreadAgentCompletionPanes: Object.fromEntries(
      (overrides.completions ?? []).map((key) => [key, true as const])
    )
  }
}

describe('paneHasUnreadActivity', () => {
  it('is true for either source', () => {
    const bell = makePaneKey('tab-1', LEAF_A)
    const completion = makePaneKey('tab-1', LEAF_B)

    const state = maps({ bells: [bell], completions: [completion] })

    expect(paneHasUnreadActivity(state, bell)).toBe(true)
    expect(paneHasUnreadActivity(state, completion)).toBe(true)
    expect(paneHasUnreadActivity(state, makePaneKey('tab-2', LEAF_A))).toBe(false)
  })
})

describe('missing maps', () => {
  // Why (regression): a partial store snapshot used to throw here, which took the
  // whole tab strip down instead of simply reading as "nothing unread".
  it('reads as no unread instead of throwing', () => {
    const empty = { unreadTerminalPanes: undefined, unreadAgentCompletionPanes: undefined }

    expect(paneHasUnreadActivity(empty, makePaneKey('tab-1', LEAF_A))).toBe(false)
    expect(collectUnreadLeafIds(empty, 'tab-1')).toEqual([])
    expect(collectUnreadPaneKeys(empty)).toEqual([])
  })
})

describe('collectUnreadLeafIds', () => {
  it('returns only the requested tab, deduped across both sources', () => {
    const state = maps({
      bells: [makePaneKey('tab-1', LEAF_A), makePaneKey('tab-2', LEAF_B)],
      completions: [makePaneKey('tab-1', LEAF_A), makePaneKey('tab-1', LEAF_B)]
    })

    expect(collectUnreadLeafIds(state, 'tab-1')).toEqual([LEAF_A, LEAF_B])
    expect(collectUnreadLeafIds(state, 'tab-2')).toEqual([LEAF_B])
    expect(collectUnreadLeafIds(state, 'tab-3')).toEqual([])
  })
})

describe('collectUnreadPaneKeys', () => {
  it('spans tabs and drops keys that are not pane keys', () => {
    const state = maps({ bells: [makePaneKey('tab-1', LEAF_A), 'not-a-pane-key'] })

    expect(collectUnreadPaneKeys(state)).toEqual([makePaneKey('tab-1', LEAF_A)])
  })
})
