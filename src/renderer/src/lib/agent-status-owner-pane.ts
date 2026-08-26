import type { AgentStatusEntry, AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import { isStablePaneId, makePaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import {
  bindAgentSessionPane,
  claimAgentSessionForkParentCheck,
  getAgentSessionPaneBinding,
  resolveAgentPaneAuthorityKey
} from '@/store/slices/agent-pane-authority'
import { panesThatSubmittedBetween } from './pane-submit-keystrokes'
import { isPathInsideWorktree } from './terminal-links'

/**
 * Which terminal a hook's status belongs to.
 *
 * A hook reports the pane key of the process it came from. For a session that
 * runs in a terminal that is the answer. For one a background-job host runs, it is
 * the terminal that started the host - the same key for every job the host owns,
 * and a terminal that is usually busy with a session of its own. Measured on a
 * live machine: nine jobs across three workspaces all named one pane, and that
 * pane had an interactive session in it. Each job's turn overwrote that session's
 * status, and each finished job left its unread on a terminal it was never in.
 *
 * So a job's key is never used as its own. A job goes to the terminal it was
 * bound to - by hand, or by having been seen running there before it was sent to
 * the background - and, failing that, to a row of its own keyed by its session id,
 * in the workspace its working directory names. The row is where the binding
 * that puts it right can be made, and nothing else is disturbed meanwhile.
 */

export type AgentStatusOwnerState = {
  tabsByWorktree: Record<string, TerminalTab[]>
  worktreesByRepo: Record<string, Worktree[]>
  agentStatusByPaneKey?: Readonly<Record<string, AgentStatusEntry>>
}

export type AgentStatusOwner = {
  paneKey: string
  /** The key was chosen for the session - a remembered terminal or a row of its
   *  own - rather than taken from the hook. */
  sessionRouted: boolean
  /** A terminal report placed this session; set when that is news. */
  homeLearned?: { sessionId: string; previousPaneKey: string | null }
}

const MAX_JOB_PANE_KEYS = 512
/** Rows given to background jobs, so a job keeps one row across its hooks. */
const jobPaneKeyBySessionId = new Map<string, string>()

function isOpenTabId(state: AgentStatusOwnerState, tabId: string): boolean {
  for (const tabs of Object.values(state.tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return true
    }
  }
  return false
}

/** The workspace whose folder contains `path`, deepest match first. */
export function worktreeIdForPath(
  worktreesByRepo: Record<string, Worktree[]>,
  path: string
): string | null {
  let best: Worktree | null = null
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (!worktree.path || !isPathInsideWorktree(path, worktree.path)) {
        continue
      }
      if (!best || worktree.path.length > best.path.length) {
        best = worktree
      }
    }
  }
  return best?.id ?? null
}

/**
 * A row of the job's own: the session id in the leaf's place, under a tab of the
 * workspace the job runs in.
 *
 * Why the session id: it is a UUID, so the key parses like any other and rides
 * every pane-keyed map - unread, list, taskbar - without a map of its own, and
 * two jobs can never share it. Why the reported tab when it is in the right
 * workspace: the job was started from there, so that is where a person looks.
 */
function backgroundJobPaneKey(
  state: AgentStatusOwnerState,
  data: AgentStatusIpcPayload,
  sessionId: string
): string | null {
  if (!isStablePaneId(sessionId)) {
    return null
  }
  const remembered = jobPaneKeyBySessionId.get(sessionId)
  const rememberedTabId = remembered ? parsePaneKey(remembered)?.tabId : undefined
  if (remembered && rememberedTabId && isOpenTabId(state, rememberedTabId)) {
    return remembered
  }
  const reportedTabId = parsePaneKey(data.paneKey)?.tabId
  const worktreeId = data.cwd ? worktreeIdForPath(state.worktreesByRepo, data.cwd) : null
  const tabs = worktreeId ? (state.tabsByWorktree[worktreeId] ?? []) : []
  const tabId =
    tabs.length > 0
      ? reportedTabId && tabs.some((tab) => tab.id === reportedTabId)
        ? reportedTabId
        : tabs[0]?.id
      : reportedTabId && isOpenTabId(state, reportedTabId)
        ? reportedTabId
        : undefined
  if (!tabId) {
    return null
  }
  const paneKey = makePaneKey(tabId, sessionId)
  jobPaneKeyBySessionId.delete(sessionId)
  jobPaneKeyBySessionId.set(sessionId, paneKey)
  while (jobPaneKeyBySessionId.size > MAX_JOB_PANE_KEYS) {
    const oldest = jobPaneKeyBySessionId.keys().next().value
    if (!oldest) {
      break
    }
    jobPaneKeyBySessionId.delete(oldest)
  }
  return paneKey
}

/** Enter → daemon spawn → boot → hook: a job started from a terminal takes seconds to report its first prompt. */
const FIRST_PROMPT_SUBMIT_WINDOW_MS = 12_000
/** An attached job reports a prompt within a second of the keystroke; a slower match is coincidence. */
const PROMPT_SUBMIT_WINDOW_MS = 3_000
/** Keystroke clocks run in the renderer, receipt in main; a little slack covers the order. */
const PROMPT_SUBMIT_CLOCK_SLACK_MS = 1_000

/**
 * The terminal whose Enter sent the prompt this job just reported, if exactly one
 * terminal can have.
 *
 * Why a keystroke: a job hosted by a daemon reports the daemon's pane, and nothing
 * on disk names the terminal whose attached client the person types into. The
 * prompt typed there is the prompt the job reports a moment later. Why exactly
 * one: two terminals with an Enter in the window is a coin toss, and the row of
 * the job's own is the safer place to leave it. Why the remembered home stays when
 * it also submitted: that is the ordinary case, not news. Why a terminal whose own
 * status moved for another session is skipped: that session took the keystroke.
 */
function paneThatSubmittedThisPrompt(
  state: AgentStatusOwnerState,
  data: AgentStatusIpcPayload,
  sessionId: string,
  home: string | null
): string | null {
  const window = home ? PROMPT_SUBMIT_WINDOW_MS : FIRST_PROMPT_SUBMIT_WINDOW_MS
  const from = data.receivedAt - window
  const candidates = panesThatSubmittedBetween(
    from,
    data.receivedAt + PROMPT_SUBMIT_CLOCK_SLACK_MS
  ).filter((paneKey) => {
    const tabId = parsePaneKey(paneKey)?.tabId
    if (!tabId || !isOpenTabId(state, tabId)) {
      return false
    }
    const own = state.agentStatusByPaneKey?.[paneKey]
    return !(own && own.providerSession?.id !== sessionId && own.updatedAt >= from)
  })
  if (home && candidates.includes(home)) {
    return home
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null
}

/** Whether this key is a job's own row rather than a terminal. */
export function isBackgroundJobPaneKey(
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>> | undefined,
  paneKey: string
): boolean {
  const leafId = parsePaneKey(paneKey)?.leafId
  return Boolean(leafId) && agentStatusByPaneKey?.[paneKey]?.providerSession?.id === leafId
}

export function resolveAgentStatusOwner(
  state: AgentStatusOwnerState,
  data: AgentStatusIpcPayload
): AgentStatusOwner {
  const sessionId = data.providerSession?.id?.trim()
  // Why the legacy path stays: a hook installed before the host field existed
  // says nothing about who runs it, and a binding is the only correction there is.
  if (!sessionId || !data.processHost || data.providerSessionOnly) {
    return { paneKey: resolveAgentPaneAuthorityKey(data.paneKey, sessionId), sessionRouted: false }
  }
  if (data.processHost === 'terminal') {
    // Why the report wins over any binding: the process is running in this
    // terminal. A binding made while it was a background job is stale the moment
    // it is resumed somewhere, and keeping it sent the resumed session back to
    // the terminal it had left.
    const previousPaneKey = getAgentSessionPaneBinding(sessionId) ?? null
    const paneKey = resolveAgentPaneAuthorityKey(data.paneKey)
    if (previousPaneKey === data.paneKey) {
      return { paneKey, sessionRouted: false }
    }
    bindAgentSessionPane(sessionId, data.paneKey)
    return { paneKey, sessionRouted: false, homeLearned: { sessionId, previousPaneKey } }
  }
  const home = getAgentSessionPaneBinding(sessionId) ?? null
  const typedInto = data.promptSubmitted
    ? paneThatSubmittedThisPrompt(state, data, sessionId, home)
    : null
  if (typedInto && typedInto !== home) {
    bindAgentSessionPane(sessionId, typedInto)
    return {
      paneKey: resolveAgentPaneAuthorityKey(typedInto),
      sessionRouted: true,
      homeLearned: { sessionId, previousPaneKey: home }
    }
  }
  if (home) {
    return { paneKey: resolveAgentPaneAuthorityKey(home), sessionRouted: true }
  }
  const ownRow = backgroundJobPaneKey(state, data, sessionId)
  if (ownRow) {
    return { paneKey: ownRow, sessionRouted: true }
  }
  return { paneKey: resolveAgentPaneAuthorityKey(data.paneKey, sessionId), sessionRouted: false }
}

export type AgentSessionHomeStore = {
  getState: () => {
    agentStatusByPaneKey: Record<string, AgentStatusEntry>
    dropAgentStatus: (paneKey: string) => void
    clearTerminalPaneUnread: (paneKey: string) => void
  }
}

function persistSessionHome(sessionId: string, paneKey: string): void {
  if (typeof window === 'undefined') {
    return
  }
  window.api?.agentStatus?.bindSessionPane?.({ sessionId, paneKey })
}

/**
 * Drop the row a session left behind, once its status lands elsewhere.
 *
 * Why only when the row is still this session's: the pane it left may be a
 * terminal that is busy with another session by now, and that one's row is not
 * ours to clear. Why the unread goes too: the session was just seen running in a
 * terminal the user opened, so what it left unseen on the old row has been seen.
 */
function dropRowsLeftBehind(
  store: AgentSessionHomeStore,
  sessionId: string,
  candidates: (string | null | undefined)[],
  paneKey: string
): void {
  const state = store.getState()
  for (const candidate of new Set(candidates)) {
    if (!candidate || candidate === paneKey) {
      continue
    }
    if (state.agentStatusByPaneKey[candidate]?.providerSession?.id !== sessionId) {
      continue
    }
    state.dropAgentStatus(candidate)
    state.clearTerminalPaneUnread(candidate)
  }
}

/**
 * What follows a terminal report that placed a session: remember it across
 * restarts, retire the row it came from, and bind the session it was forked from
 * to the same terminal.
 *
 * Why the fork parent: a job is worked on by forking it into a terminal
 * (`claude --resume <job> --fork-session`), and the person then wants the job's
 * own notifications on that terminal - the correction they were making by hand.
 * A forked transcript keeps the parent's records under the parent's session id,
 * so the parent can be named from the transcript alone.
 */
export function settleLearnedAgentSessionHome(
  store: AgentSessionHomeStore,
  input: {
    sessionId: string
    paneKey: string
    previousPaneKey: string | null
    transcriptPath?: string
  }
): void {
  const { sessionId, paneKey, previousPaneKey, transcriptPath } = input
  persistSessionHome(sessionId, paneKey)
  queueMicrotask(() => {
    dropRowsLeftBehind(
      store,
      sessionId,
      [previousPaneKey, jobPaneKeyBySessionId.get(sessionId)],
      paneKey
    )
  })
  if (!transcriptPath || typeof window === 'undefined') {
    return
  }
  if (!claimAgentSessionForkParentCheck(sessionId)) {
    return
  }
  void Promise.resolve(
    window.api?.agentStatus?.readSessionForkParent?.({ transcriptPath, sessionId }) ?? null
  )
    .then((parentSessionId) => {
      if (!parentSessionId || parentSessionId === sessionId) {
        return
      }
      const parentPrevious = getAgentSessionPaneBinding(parentSessionId) ?? null
      if (parentPrevious === paneKey) {
        return
      }
      bindAgentSessionPane(parentSessionId, paneKey)
      persistSessionHome(parentSessionId, paneKey)
      dropRowsLeftBehind(
        store,
        parentSessionId,
        [parentPrevious, jobPaneKeyBySessionId.get(parentSessionId)],
        paneKey
      )
    })
    .catch(() => {
      // Why swallowed: a parent left unbound costs one correction by hand, nothing else.
    })
}

export function resetAgentStatusOwnerPaneForTests(): void {
  jobPaneKeyBySessionId.clear()
}
