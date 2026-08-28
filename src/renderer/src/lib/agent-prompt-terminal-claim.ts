import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import { stripPastedImagePaths } from '../../../shared/prompt-pasted-image-paths'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import {
  agentSessionsBoundToPane,
  unbindAgentSessionPane
} from '@/store/slices/agent-pane-authority'
import {
  anotherSessionSubmittedInto,
  terminalSubmitsBetween,
  type TerminalSubmit
} from './pane-submit-keystrokes'

/**
 * The terminal a background job's prompt was typed into.
 *
 * A job hosted by a daemon reports the daemon's pane, and nothing on disk names
 * the terminal whose attached client the person types into. The keystrokes do:
 * the prompt typed there is the prompt the job reports a moment later. Two
 * signals, in order of strength - the text itself, then the timing.
 */

/** Enter → daemon spawn → boot → hook: a job started from a terminal takes seconds to report its first prompt. */
const FIRST_PROMPT_SUBMIT_WINDOW_MS = 12_000
/** An attached job reports a prompt within a second of the keystroke; a slower match is coincidence. */
const PROMPT_SUBMIT_WINDOW_MS = 3_000
/** Keystroke clocks run in the renderer, receipt in main; a little slack covers the order. */
const PROMPT_SUBMIT_CLOCK_SLACK_MS = 1_000
/** Shorter than this, equal text says nothing - a "y" is typed everywhere. */
const MIN_MATCHING_TEXT_CHARS = 3
/** One text inside the other counts from here: a prompt with a word added at either end. */
const MIN_CONTAINED_TEXT_CHARS = 8
/** A shared opening this long is the same prompt, edited or cut short by the terminal. */
const MIN_COMMON_PREFIX_CHARS = 16

function normalizePromptText(text: string): string {
  return stripPastedImagePaths(text).normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * Whether what was typed into a terminal is the prompt a session reported. Why
 * not equality alone: the terminal sees the paste path and the edits, the hook
 * sees the final text; either can carry a little the other does not.
 */
export function promptMatchesTypedText(
  prompt: string | undefined,
  typed: string | undefined
): boolean {
  if (!prompt || !typed) {
    return false
  }
  const reported = normalizePromptText(prompt)
  const sent = normalizePromptText(typed)
  if (reported.length < MIN_MATCHING_TEXT_CHARS || sent.length < MIN_MATCHING_TEXT_CHARS) {
    return false
  }
  if (reported === sent) {
    return true
  }
  const [shorter, longer] = reported.length <= sent.length ? [reported, sent] : [sent, reported]
  if (shorter.length >= MIN_CONTAINED_TEXT_CHARS && longer.includes(shorter)) {
    return true
  }
  let shared = 0
  while (shared < shorter.length && reported[shared] === sent[shared]) {
    shared += 1
  }
  return shared >= MIN_COMMON_PREFIX_CHARS
}

function noteRoutingDiagnostic(line: string): void {
  if (typeof window === 'undefined') {
    return
  }
  window.api?.agentStatus?.noteRoutingDiagnostic?.(line)
}

function short(paneKey: string | null | undefined): string {
  return paneKey ? paneKey.slice(-8) : '-'
}

/**
 * The terminal whose Enter sent the prompt this job just reported, or null when
 * no single terminal can be named.
 *
 * Why the text decides first: two terminals with an Enter in the window is the
 * ordinary state of a person running several sessions, and only one of them typed
 * these words. Why timing still counts: a prompt too short to compare, or one the
 * terminal mangled, falls back to the one terminal that submitted at all. Why the
 * remembered home stays when it also submitted: that is the ordinary case, not
 * news. Why a terminal another session just reported a prompt into is skipped:
 * that session took the keystroke. Only a prompt counts - a job bound there
 * earlier keeps sending tool events long after the person moved on to a new
 * session in the same terminal, and treating those as "busy" left every reused
 * terminal unclaimable (measured: three sessions bound to one terminal by hand).
 */
export function terminalThatTypedPrompt(args: {
  data: AgentStatusIpcPayload
  sessionId: string
  home: string | null
  isOpenTab: (tabId: string) => boolean
}): string | null {
  const { data, sessionId, home } = args
  const window = home ? PROMPT_SUBMIT_WINDOW_MS : FIRST_PROMPT_SUBMIT_WINDOW_MS
  const from = data.receivedAt - window
  const submits = terminalSubmitsBetween(from, data.receivedAt + PROMPT_SUBMIT_CLOCK_SLACK_MS)
  const candidates: TerminalSubmit[] = []
  const notes: string[] = []
  for (const submit of submits) {
    const tabId = parsePaneKey(submit.paneKey)?.tabId
    const age = data.receivedAt - submit.at
    if (!tabId || !args.isOpenTab(tabId)) {
      notes.push(`${short(submit.paneKey)}@${age}ms:closed`)
      continue
    }
    if (anotherSessionSubmittedInto(submit.paneKey, sessionId, from)) {
      notes.push(`${short(submit.paneKey)}@${age}ms:taken`)
      continue
    }
    const matches = promptMatchesTypedText(data.prompt, submit.text)
    notes.push(`${short(submit.paneKey)}@${age}ms:${matches ? 'text' : 'enter'}`)
    candidates.push(matches ? { ...submit, text: '' } : submit)
  }
  const byText = candidates.filter((submit) => submit.text === '').map((s) => s.paneKey)
  const byEnter = candidates.map((submit) => submit.paneKey)
  const pool = byText.length > 0 ? byText : byEnter
  const chosen = home && pool.includes(home) ? home : pool.length === 1 ? (pool[0] ?? null) : null
  noteRoutingDiagnostic(
    `claim ${sessionId.slice(0, 8)} at=${data.receivedAt} home=${short(home)} win=${window}ms ` +
      `enters=[${notes.join(' ')}] -> ${chosen ? short(chosen) : pool.length > 1 ? 'ambiguous' : 'none'}`
  )
  return chosen
}

/**
 * Give this terminal to the session whose prompt was just typed into it. The
 * sessions bound there before are what it ran earlier; a daemon keeps running
 * them after the person moved on, and their hooks would keep landing on a
 * terminal that now shows something else. They go back to rows of their own.
 */
export function releaseTerminalToSession(paneKey: string, sessionId: string): void {
  for (const other of agentSessionsBoundToPane(paneKey, sessionId)) {
    unbindAgentSessionPane(other)
    if (typeof window !== 'undefined') {
      window.api?.agentStatus?.unbindSessionPane?.({ sessionId: other })
    }
  }
}
