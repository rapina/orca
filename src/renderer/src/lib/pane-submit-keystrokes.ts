import { isEnterSubmitInput } from '../../../shared/agent-question-answered-intent'

/**
 * When each terminal last had Enter pressed into it.
 *
 * A session hosted by a background-job daemon reports the daemon's pane, never the
 * terminal whose attached client the person is typing into; nothing on disk links
 * the two. The keystroke does: the prompt typed into that terminal is the prompt
 * the job reports a moment later. This is the same evidence the answered-question
 * inference already trusts.
 */

const MAX_TRACKED_PANES = 256
const submitAtByPaneKey = new Map<string, number>()

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
  while (submitAtByPaneKey.size > MAX_TRACKED_PANES) {
    const oldest = submitAtByPaneKey.keys().next().value
    if (oldest === undefined) {
      break
    }
    submitAtByPaneKey.delete(oldest)
  }
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

export function resetPaneSubmitKeystrokesForTests(): void {
  submitAtByPaneKey.clear()
}
