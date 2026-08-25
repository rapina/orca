import { describe, expect, it } from 'vitest'
import { selectTerminalListTabSources } from './terminal-list-tab-sources'

const STATE = { unifiedTabsByWorktree: {}, groupsByWorktree: {} }

describe('selectTerminalListTabSources', () => {
  // Why: the panel reads this through a shallow-equality selector, so a fresh
  // array on a miss makes every render look like a store change and React kills
  // the panel with "maximum update depth exceeded".
  it('returns the same empty references on every miss', () => {
    const first = selectTerminalListTabSources(STATE, null)
    const second = selectTerminalListTabSources(STATE, 'worktree-with-no-entry')

    expect(first.unifiedTabs).toBe(second.unifiedTabs)
    expect(first.groups).toBe(second.groups)
  })

  it('returns the stored arrays when the worktree has them', () => {
    const unifiedTabs = [{ id: 'tab-1' }] as never
    const groups = [{ id: 'group-1' }] as never
    const sources = selectTerminalListTabSources(
      { unifiedTabsByWorktree: { w: unifiedTabs }, groupsByWorktree: { w: groups } },
      'w'
    )

    expect(sources.unifiedTabs).toBe(unifiedTabs)
    expect(sources.groups).toBe(groups)
  })
})
