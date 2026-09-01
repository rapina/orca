import { parsePaneKey } from './stable-pane-id'

/**
 * Whether a pane key is the row of a background job's own: the job's session id
 * sits where a terminal's leaf id would.
 *
 * Such a row is never a terminal. There is no PTY behind it to sleep, resume or
 * wake, and a sleeping record made from it turns into a fresh tab running
 * `claude --resume <job>` at the next start - measured: one tab per remembered
 * job, most of them daemon spares with no transcript to resume.
 */
export function isBackgroundJobRowKey(paneKey: string, sessionId: string | undefined): boolean {
  if (!sessionId) {
    return false
  }
  return parsePaneKey(paneKey)?.leafId === sessionId
}
