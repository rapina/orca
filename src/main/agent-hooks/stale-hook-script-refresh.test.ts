import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refreshManagedScripts } = vi.hoisted(() => ({
  refreshManagedScripts: vi.fn(() => Promise.resolve())
}))

vi.mock('../claude/hook-service', () => ({
  claudeHookService: { refreshManagedScripts }
}))

import {
  noteStaleClaudeHookScript,
  resetStaleClaudeHookScriptForTests
} from './stale-hook-script-refresh'

describe('noteStaleClaudeHookScript', () => {
  beforeEach(() => {
    resetStaleClaudeHookScriptForTests()
    refreshManagedScripts.mockClear()
  })

  // Why: the start-up replacement can lose to a hook executing the script at that
  // moment, and nothing retried it; every old-shaped hook is the sign to retry.
  it('refreshes the script on the first stale hook and holds off after that', () => {
    expect(noteStaleClaudeHookScript(1_000)).toBe(true)
    expect(noteStaleClaudeHookScript(2_000)).toBe(false)
    expect(noteStaleClaudeHookScript(1_000 + 4 * 60_000)).toBe(false)
    expect(refreshManagedScripts).toHaveBeenCalledTimes(1)

    expect(noteStaleClaudeHookScript(1_000 + 5 * 60_000)).toBe(true)
    expect(refreshManagedScripts).toHaveBeenCalledTimes(2)
  })
})
