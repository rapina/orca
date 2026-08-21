import { describe, expect, it } from 'vitest'
import { wheelCountsAsTerminalVisit } from './terminal-wheel-visit'

const SCROLLABLE = { scrollTop: 400, scrollHeight: 2000, clientHeight: 600 }

describe('wheelCountsAsTerminalVisit', () => {
  it('counts a wheel that moved the viewport', () => {
    expect(wheelCountsAsTerminalVisit(SCROLLABLE, { ...SCROLLABLE, scrollTop: 280 })).toBe(true)
  })

  // Why: this is the case the user asked to keep out - wheeling a terminal that
  // is already at the bottom shows nothing new, so it must not clear unread.
  it('does not count a wheel that moved nothing', () => {
    expect(wheelCountsAsTerminalVisit(SCROLLABLE, { ...SCROLLABLE })).toBe(false)
  })

  // Why: a full-screen app (alternate buffer) keeps the viewport pinned and
  // scrolls its own content, which the DOM cannot tell from having nothing to
  // scroll. Both mean the user was working there.
  it('counts a wheel when the viewport cannot scroll', () => {
    const pinned = { scrollTop: 0, scrollHeight: 600, clientHeight: 600 }
    expect(wheelCountsAsTerminalVisit(pinned, pinned)).toBe(true)
  })

  it('counts a wheel when the geometry is unreadable', () => {
    expect(wheelCountsAsTerminalVisit(null, SCROLLABLE)).toBe(true)
    expect(wheelCountsAsTerminalVisit(SCROLLABLE, null)).toBe(true)
  })
})
