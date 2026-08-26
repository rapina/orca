import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import {
  bindAgentSessionPane,
  getAgentSessionPaneBinding,
  resetAgentPaneAuthorityAliasesForTests
} from '@/store/slices/agent-pane-authority'
import {
  isBackgroundJobPaneKey,
  resetAgentStatusOwnerPaneForTests,
  resolveAgentStatusOwner,
  worktreeIdForPath,
  type AgentStatusOwnerState
} from './agent-status-owner-pane'
import {
  noteTerminalSubmitKeystroke,
  resetPaneSubmitKeystrokesForTests
} from './pane-submit-keystrokes'

const HOST_LEAF = '11111111-1111-4111-8111-111111111111'
const OTHER_LEAF = '22222222-2222-4222-8222-222222222222'
const JOB_SESSION = 'ec48af73-3b2d-4656-bd74-e95a63762fd2'
const HOST_PANE = makePaneKey('tab-cozy', HOST_LEAF)
const OTHER_PANE = makePaneKey('tab-cozy', OTHER_LEAF)
const ORCA_PANE = makePaneKey('tab-orca', OTHER_LEAF)

function tab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function worktree(id: string, path: string): Worktree {
  return { id, path } as Worktree
}

const state: AgentStatusOwnerState = {
  tabsByWorktree: {
    'repo::D:/Workspace/cozy-sandbox': [tab('tab-cozy', 'repo::D:/Workspace/cozy-sandbox')],
    'repo::D:/Workspace/orca': [tab('tab-orca', 'repo::D:/Workspace/orca')]
  },
  worktreesByRepo: {
    repo: [
      worktree('repo::D:/Workspace/cozy-sandbox', 'D:\\Workspace\\cozy-sandbox'),
      worktree('repo::D:/Workspace/orca', 'D:\\Workspace\\orca')
    ]
  }
}

function status(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    paneKey: HOST_PANE,
    state: 'working',
    prompt: 'do the thing',
    connectionId: null,
    receivedAt: 1,
    stateStartedAt: 1,
    providerSession: { key: 'claude', id: JOB_SESSION },
    ...overrides
  } as AgentStatusIpcPayload
}

describe('resolveAgentStatusOwner', () => {
  beforeEach(() => {
    resetAgentPaneAuthorityAliasesForTests()
    resetAgentStatusOwnerPaneForTests()
  })

  // Why: measured on a live machine — nine jobs across three workspaces all named
  // the pane of the terminal that started their host, which had a session of its
  // own. A job's key is the host's, never the job's.
  it('never puts a background job on the pane its hook names', () => {
    const owner = resolveAgentStatusOwner(
      state,
      status({ processHost: 'background-job', cwd: 'D:\\Workspace\\orca' })
    )

    expect(owner.sessionRouted).toBe(true)
    expect(owner.paneKey).not.toBe(HOST_PANE)
    // Why the job's own workspace: the hook's worktree is the host's.
    expect(owner.paneKey).toBe(makePaneKey('tab-orca', JOB_SESSION))
    expect(
      isBackgroundJobPaneKey(
        { [owner.paneKey]: { providerSession: { id: JOB_SESSION } } } as never,
        owner.paneKey
      )
    ).toBe(true)
  })

  it('keeps one row per job across its hooks', () => {
    const first = resolveAgentStatusOwner(
      state,
      status({ processHost: 'background-job', cwd: 'D:\\Workspace\\orca\\src' })
    )
    const again = resolveAgentStatusOwner(state, status({ processHost: 'background-job' }))

    expect(again.paneKey).toBe(first.paneKey)
  })

  it('sends a bound job to the terminal it was bound to', () => {
    bindAgentSessionPane(JOB_SESSION, OTHER_PANE)

    const owner = resolveAgentStatusOwner(state, status({ processHost: 'background-job' }))

    expect(owner).toEqual({ paneKey: OTHER_PANE, sessionRouted: true })
  })

  // Why the report wins: the process is running in that terminal. A binding made
  // while it was a job is stale the moment it is resumed somewhere, and keeping it
  // sent the resumed session back to the terminal it had left.
  it('lets a terminal report overwrite a stale binding and says so', () => {
    bindAgentSessionPane(JOB_SESSION, OTHER_PANE)

    const owner = resolveAgentStatusOwner(
      state,
      status({ processHost: 'terminal', paneKey: ORCA_PANE })
    )

    expect(owner.paneKey).toBe(ORCA_PANE)
    expect(owner.homeLearned).toEqual({ sessionId: JOB_SESSION, previousPaneKey: OTHER_PANE })
    expect(getAgentSessionPaneBinding(JOB_SESSION)).toBe(ORCA_PANE)

    const repeat = resolveAgentStatusOwner(
      state,
      status({ processHost: 'terminal', paneKey: ORCA_PANE })
    )
    expect(repeat.homeLearned).toBeUndefined()
  })

  // Why: a hook installed before the host field existed says nothing about who
  // runs it, and a binding is the only correction there is.
  it('keeps the old behaviour for a hook that does not say who runs it', () => {
    expect(resolveAgentStatusOwner(state, status({}))).toEqual({
      paneKey: HOST_PANE,
      sessionRouted: false
    })

    bindAgentSessionPane(JOB_SESSION, OTHER_PANE)
    expect(resolveAgentStatusOwner(state, status({})).paneKey).toBe(OTHER_PANE)
  })

  it('falls back to the reported tab when no workspace holds the job folder', () => {
    const owner = resolveAgentStatusOwner(
      state,
      status({ processHost: 'background-job', cwd: 'E:\\elsewhere' })
    )

    expect(owner.paneKey).toBe(makePaneKey('tab-cozy', JOB_SESSION))
  })
})

// Why: on Claude 2.1.246 a `claude` typed into a terminal is a client of a
// daemon-hosted job, and the job's hooks name the daemon's pane. Nothing on disk
// links the job to the terminal; the Enter that sent its prompt does.
describe('a prompt typed into a terminal claims the job that reports it', () => {
  const RECEIVED_AT = 100_000
  const OWN_ROW = makePaneKey('tab-cozy', JOB_SESSION)

  function submitted(overrides: Partial<AgentStatusIpcPayload> = {}): AgentStatusIpcPayload {
    return status({
      processHost: 'background-job',
      promptSubmitted: true,
      receivedAt: RECEIVED_AT,
      ...overrides
    })
  }

  beforeEach(() => {
    resetAgentPaneAuthorityAliasesForTests()
    resetAgentStatusOwnerPaneForTests()
    resetPaneSubmitKeystrokesForTests()
  })

  it("follows the terminal whose Enter sent the job's first prompt, seconds earlier", () => {
    noteTerminalSubmitKeystroke(OTHER_PANE, '\r', RECEIVED_AT - 8_000)

    const owner = resolveAgentStatusOwner(state, submitted())

    expect(owner).toEqual({
      paneKey: OTHER_PANE,
      sessionRouted: true,
      homeLearned: { sessionId: JOB_SESSION, previousPaneKey: null }
    })
    expect(getAgentSessionPaneBinding(JOB_SESSION)).toBe(OTHER_PANE)
  })

  it('leaves the job on its own row when two terminals submitted', () => {
    noteTerminalSubmitKeystroke(OTHER_PANE, '\r', RECEIVED_AT - 2_000)
    noteTerminalSubmitKeystroke(ORCA_PANE, '\r', RECEIVED_AT - 1_000)

    expect(resolveAgentStatusOwner(state, submitted()).paneKey).toBe(OWN_ROW)
    expect(getAgentSessionPaneBinding(JOB_SESSION)).toBeUndefined()
  })

  it('skips a terminal whose own session took the keystroke', () => {
    noteTerminalSubmitKeystroke(OTHER_PANE, '\r', RECEIVED_AT - 500)
    const busy: AgentStatusOwnerState = {
      ...state,
      agentStatusByPaneKey: {
        [OTHER_PANE]: { providerSession: { id: 'another-session' }, updatedAt: RECEIVED_AT - 200 }
      } as never
    }

    expect(resolveAgentStatusOwner(busy, submitted()).paneKey).toBe(OWN_ROW)
  })

  it('only listens on prompt reports', () => {
    noteTerminalSubmitKeystroke(OTHER_PANE, '\r', RECEIVED_AT - 500)

    expect(resolveAgentStatusOwner(state, submitted({ promptSubmitted: undefined })).paneKey).toBe(
      OWN_ROW
    )
  })

  it('moves a bound job to the terminal its next prompt was typed into', () => {
    bindAgentSessionPane(JOB_SESSION, OTHER_PANE)
    noteTerminalSubmitKeystroke(ORCA_PANE, '\r', RECEIVED_AT - 1_000)

    const owner = resolveAgentStatusOwner(state, submitted())

    expect(owner.paneKey).toBe(ORCA_PANE)
    expect(owner.homeLearned).toEqual({ sessionId: JOB_SESSION, previousPaneKey: OTHER_PANE })
    expect(getAgentSessionPaneBinding(JOB_SESSION)).toBe(ORCA_PANE)
  })

  it('keeps a bound job home past the short window, and when home itself submitted', () => {
    bindAgentSessionPane(JOB_SESSION, OTHER_PANE)
    noteTerminalSubmitKeystroke(ORCA_PANE, '\r', RECEIVED_AT - 5_000)

    expect(resolveAgentStatusOwner(state, submitted())).toEqual({
      paneKey: OTHER_PANE,
      sessionRouted: true
    })

    noteTerminalSubmitKeystroke(OTHER_PANE, '\r', RECEIVED_AT - 600)
    noteTerminalSubmitKeystroke(ORCA_PANE, '\r', RECEIVED_AT - 400)

    expect(resolveAgentStatusOwner(state, submitted())).toEqual({
      paneKey: OTHER_PANE,
      sessionRouted: true
    })
  })
})

describe('worktreeIdForPath', () => {
  it('picks the deepest workspace containing the folder', () => {
    const nested = worktree(
      'repo::D:/Workspace/orca/.claude/worktrees/x',
      'D:\\Workspace\\orca\\.claude\\worktrees\\x'
    )
    const worktreesByRepo = { repo: [...state.worktreesByRepo.repo!, nested] }

    expect(
      worktreeIdForPath(worktreesByRepo, 'D:\\Workspace\\orca\\.claude\\worktrees\\x\\src')
    ).toBe(nested.id)
    expect(worktreeIdForPath(worktreesByRepo, 'D:\\Workspace\\orca\\src')).toBe(
      'repo::D:/Workspace/orca'
    )
    expect(worktreeIdForPath(worktreesByRepo, 'D:\\Elsewhere')).toBeNull()
  })
})
