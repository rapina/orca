import { isEnterSubmitInput } from '../../../shared/agent-question-answered-intent'
import {
  stripAnsiEscapeSequences,
  TERMINAL_CONTROL_CHARACTER_PATTERN
} from '../../../shared/ansi-escape-sequences'

/**
 * What was last typed into each terminal and when Enter sent it, and which
 * session's prompt that Enter turned out to be.
 *
 * A session hosted by a background-job daemon reports the daemon's pane, never the
 * terminal whose attached client the person is typing into; nothing on disk links
 * the two. The keystrokes do: the prompt typed into that terminal is the prompt
 * the job reports a moment later, word for word. This is the same evidence the
 * answered-question inference already trusts.
 */

const MAX_TRACKED_PANES = 256
const MAX_LINE_CHARS = 4_000
// Why kept apart from the other control bytes: Backspace is a key the person pressed,
// and the line loses a character for it. Built at runtime so no control byte sits in the source.
const DEL = String.fromCharCode(0x7f)
const BACKSPACE_KEY = String.fromCharCode(0x08)
const BACKSPACE = new RegExp(`([${DEL}${BACKSPACE_KEY}])`)

type TerminalInput = {
  line: string
  submittedAt?: number
  submittedText?: string
}

export type TerminalSubmit = { paneKey: string; at: number; text: string }

const inputByPaneKey = new Map<string, TerminalInput>()
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

/** The line as the person sees it: escapes dropped, Backspace taking a character back, a paste's line breaks folded. */
function appendTypedInput(line: string, data: string): string {
  let next = line
  for (const chunk of stripAnsiEscapeSequences(data).split(BACKSPACE)) {
    if (chunk === DEL || chunk === BACKSPACE_KEY) {
      next = next.slice(0, -1)
      continue
    }
    next += chunk.replace(/[\r\n]+/g, ' ').replace(TERMINAL_CONTROL_CHARACTER_PATTERN, '')
  }
  return next.length > MAX_LINE_CHARS ? next.slice(0, MAX_LINE_CHARS) : next
}

export function noteTerminalInput(paneKey: string, data: string, now: number = Date.now()): void {
  const current = inputByPaneKey.get(paneKey) ?? { line: '' }
  inputByPaneKey.delete(paneKey)
  if (isEnterSubmitInput(data)) {
    // Why the earlier text survives an empty Enter: an IME commits with one Enter and
    // submits with the next, and the second must not erase what the first typed.
    const submittedText = current.line.length > 0 ? current.line : (current.submittedText ?? '')
    inputByPaneKey.set(paneKey, { line: '', submittedAt: now, submittedText })
  } else {
    inputByPaneKey.set(paneKey, { ...current, line: appendTypedInput(current.line, data) })
  }
  capOldest(inputByPaneKey)
}

/** Terminals whose last Enter fell inside [from, to], with what that Enter sent. */
export function terminalSubmitsBetween(from: number, to: number): TerminalSubmit[] {
  const submits: TerminalSubmit[] = []
  for (const [paneKey, input] of inputByPaneKey) {
    if (input.submittedAt !== undefined && input.submittedAt >= from && input.submittedAt <= to) {
      submits.push({ paneKey, at: input.submittedAt, text: input.submittedText ?? '' })
    }
  }
  return submits
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
  inputByPaneKey.clear()
  promptSubmitByPaneKey.clear()
}
