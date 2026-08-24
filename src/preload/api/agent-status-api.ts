import type {
  AgentStatusClearIpcPayload,
  AgentStatusIpcPayload,
  MigrationUnsupportedPtyEntry
} from '../../shared/agent-status-types'
import type { AgentInterruptInferenceRequest } from '../../shared/agent-interrupt-intent'
import type { AgentQuestionAnsweredInferenceRequest } from '../../shared/agent-question-answered-intent'
import type { ComputerAwakeStatus } from '../../shared/computer-awake-mode'

export type AgentStatusApi = {
  /** Listen for agent status updates forwarded from native hook receivers. */
  onSet: (callback: (data: AgentStatusIpcPayload) => void) => () => void
  /** Listen for main-process cleanup that evicted cached hook status. */
  onClear: (callback: (data: AgentStatusClearIpcPayload) => void) => () => void
  /** Return the current main-process hook cache after renderer hydration. */
  getSnapshot: () => Promise<AgentStatusIpcPayload[]>
  inferInterrupt: (request: AgentInterruptInferenceRequest) => Promise<boolean>
  /** Guarded clear for an answered AskUserQuestion wait — the CLI emits no hook at answer time, so the renderer reports the submit keystroke. */
  inferQuestionAnswered: (request: AgentQuestionAnsweredInferenceRequest) => Promise<boolean>
  /** Listen for PTYs on a legacy numeric pane key that have registry-backed UUID pane proof. */
  onMigrationUnsupported: (callback: (entry: MigrationUnsupportedPtyEntry) => void) => () => void
  onMigrationUnsupportedClear: (callback: (data: { ptyId: string }) => void) => () => void
  onLegacyWorkerTerminalRecovery: (
    callback: (data: {
      paneKey: string
      resolution: 'adopted' | 'exited' | 'rolled_back'
      ptyId?: string
    }) => void
  ) => () => void
  getMigrationUnsupportedSnapshot: () => Promise<MigrationUnsupportedPtyEntry[]>
  /** Drop a paneKey from the main-process hook cache and on-disk last-status file. Fire-and-forget. */
  drop: (paneKey: string) => void
  /** Drop every cached hook status under one terminal tab prefix. Fire-and-forget. */
  dropByTabPrefix: (tabId: string) => void
  /** Permanently retire one pane's hook authority while siblings stay live. */
  retirePaneAuthority: (paneKey: string) => void
  /** Move hook authority when a live pane is detached into another tab. */
  transferPaneAuthority: (args: { fromPaneKey: string; toPaneKey: string; ptyId?: string }) => void
  /** The last thing one session said, read from its own transcript, so a person
   *  can tell which agent a status belongs to before moving it. */
  readSessionTurn: (args: { transcriptPath: string }) => Promise<string | null>
  /** TEMPORARY: see main/ipc/agent-status-diag.ts. */
  diag: (line: string) => void
  /** What each terminal is working on: the folder its agent is in, and the pull
   *  requests its own output has shown. */
  readTerminalContexts: (args: {
    terminals: { paneKey: string; ptyId?: string; transcriptPath?: string }[]
  }) => Promise<
    {
      paneKey: string
      worktreeName?: string
      branch?: string
      pullRequestUrls: string[]
    }[]
  >
}

export type AgentTrustApi = {
  markTrusted: (args: {
    preset: 'cursor' | 'copilot' | 'codex'
    workspacePath: string
    connectionId?: string
  }) => Promise<void>
}

export type AgentAwakeApi = {
  getStatus: () => Promise<ComputerAwakeStatus>
  onChanged: (callback: (status: ComputerAwakeStatus) => void) => () => void
}
