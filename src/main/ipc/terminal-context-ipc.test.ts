import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolvePath, readTranscript } = vi.hoisted(() => ({
  resolvePath: vi.fn(),
  readTranscript: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, ipcMain: {} }))
vi.mock('../agent-hooks/server', () => ({ isValidPaneKey: () => true }))
vi.mock('../native-chat/session-file-resolver', () => ({ resolveSessionFilePath: resolvePath }))
vi.mock('./terminal-transcript-reader', () => ({ readTerminalTranscriptContext: readTranscript }))
import { readTerminalContexts } from './terminal-context-ipc'

beforeEach(() => {
  vi.clearAllMocks()
  resolvePath.mockResolvedValue('/sessions/codex-rollout.jsonl')
  readTranscript.mockResolvedValue({
    urls: ['https://github.com/o/r/pull/42'],
    directory: { cwd: '/repo/feature', branch: 'feature' }
  })
})

describe('terminal context session sources', () => {
  it('finds a Codex transcript from its session id when the hook has no path', async () => {
    const request = {
      terminals: [{ paneKey: 'pane', agentType: 'codex' as const, sessionId: 'codex-session' }]
    }
    expect(await readTerminalContexts(request)).toEqual([
      {
        paneKey: 'pane',
        worktreeName: 'feature',
        branch: 'feature',
        pullRequestUrls: ['https://github.com/o/r/pull/42']
      }
    ])
    expect(resolvePath).toHaveBeenCalledWith('codex', 'codex-session')
    await readTerminalContexts(request)
    expect(resolvePath).toHaveBeenCalledTimes(1)
  })

  it('never reads a remote transcript from the client filesystem, even with an identical local path', async () => {
    const rows = await readTerminalContexts({
      terminals: [
        {
          paneKey: 'remote-pane',
          ptyId: 'remote-pty',
          connectionId: 'ssh-host',
          transcriptPath: '/sessions/codex-rollout.jsonl',
          agentType: 'codex',
          sessionId: 'remote-session'
        }
      ]
    })
    expect(rows).toEqual([])
    expect(resolvePath).not.toHaveBeenCalled()
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('retries an unresolved session once its transcript is written', async () => {
    resolvePath.mockResolvedValueOnce(null)
    const request = {
      terminals: [{ paneKey: 'pane', agentType: 'codex' as const, sessionId: 'new-session' }]
    }
    expect(await readTerminalContexts(request)).toEqual([])
    expect(await readTerminalContexts(request)).toHaveLength(1)
  })
})
