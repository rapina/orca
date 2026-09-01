import { claudeHookService } from '../claude/hook-service'

/**
 * Re-write the managed Claude hook script when a hook arrives in a shape older
 * than this build writes.
 *
 * Why: the script is replaced at start-up, and that replacement can lose to a hook
 * that is executing the script at that moment (see managed-hook-script-refresh).
 * Nothing retried it afterwards, so every running agent kept posting the old
 * shape - and every routing rule that depends on the new fields stayed off with
 * no sign of why. A hook without the host field is that sign; one refresh every
 * few minutes is enough to catch up, and it costs one read when nothing changed.
 */
const RETRY_INTERVAL_MS = 5 * 60_000

let lastAttemptAt: number | null = null

export function noteStaleClaudeHookScript(now = Date.now()): boolean {
  if (lastAttemptAt !== null && now - lastAttemptAt < RETRY_INTERVAL_MS) {
    return false
  }
  lastAttemptAt = now
  void claudeHookService.refreshManagedScripts().catch((error) => {
    console.warn(
      '[agent-hooks] Failed to refresh the Claude hook script after a stale hook:',
      error
    )
  })
  return true
}

export function resetStaleClaudeHookScriptForTests(): void {
  lastAttemptAt = null
}
