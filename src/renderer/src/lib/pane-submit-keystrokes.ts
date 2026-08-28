import { isEnterSubmitInput } from '../../../shared/agent-question-answered-intent'

/**
 * When each terminal last had Enter pressed into it, and which session's prompt
 * that Enter turned out to be.
 *
 * A session hosted by a background-job daemon reports the daemon's pane, never the
 * terminal whose attached client the person is typing into; nothing on disk links
 * the two. The keystroke does: the prompt typed into that terminal is the prompt
 * the job reports a moment later. This is the same evidence the answered-question
 * inference already trusts.
 */

const MAX_TRACKED_PANES = 256
const submitAtByPaneKey = new Map<string, number>()
const promptSubmitByPaneKey = new Map<string, { sessionId: string; at: number }>()

function capOldest(map: Map<string, unknown>): void {
  while (map.size > MAX_TRACKED_PANES) {
    const oldest = map.keys().next().value
    if (oldest === undefined) {
      break
    }
    map.delete(oldest)
  }
}

export function noteTerminalSubmitKeystroke(
  paneKey: string,
  data: string,
  now: number = Date.now()
): void {
  if (!isEnterSubmitInput(data)) {
    return
  }
  submitAtByPaneKey.delete(paneKey)
  submitAtByPaneKey.set(paneKey, now)
  capOldest(submitAtByPaneKey)
}

/** Terminals whose last Enter fell inside [from, to]. */
export function panesThatSubmittedBetween(from: number, to: number): string[] {
  const panes: string[] = []
  for (const [paneKey, at] of submitAtByPaneKey) {
    if (at >= from && at <= to) {
      panes.push(paneKey)
    }
  }
  return panes
}

/** A session's prompt report landed on this terminal: the Enter there is spoken for. */
export function notePromptSubmitRoutedTo(paneKey: string, sessionId: string, at: number): void {
  promptSubmitByPaneKey.delete(paneKey)
  promptSubmitByPaneKey.set(paneKey, { sessionId, at })
  capOldest(promptSubmitByPaneKey)
}

/** Whether a session other than this one reported a prompt into the terminal since `from`. */
export function anotherSessionSubmittedInto(
  paneKey: string,
  sessionId: string,
  from: number
): boolean {
  const last = promptSubmitByPaneKey.get(paneKey)
  return last !== undefined && last.sessionId !== sessionId && last.at >= from
}

export function resetPaneSubmitKeystrokesForTests(): void {
  submitAtByPaneKey.clear()
  promptSubmitByPaneKey.clear()
}
