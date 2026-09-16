import { describe, expect, it } from 'vitest'
import {
  consumeTerminalTranscriptLine,
  createTerminalTranscriptContext,
  extractPullRequestUrlsFromTranscript,
  parseTranscriptWorkingDirectory
} from './terminal-transcript-context'

const url = 'https://github.com/owner/repo/pull/42'
const codex = (payload: unknown): string => JSON.stringify({ type: 'response_item', payload })

describe('Codex terminal context', () => {
  it('reads nested session and turn directories, including a later folder workspace', () => {
    const meta = JSON.stringify({
      type: 'session_meta',
      payload: { cwd: '/repo', git: { branch: 'main' } }
    })
    expect(parseTranscriptWorkingDirectory(`\n${meta}`)).toEqual({ cwd: '/repo', branch: 'main' })
    const turn = JSON.stringify({ type: 'turn_context', payload: { cwd: 'D:\\folder\\work' } })
    expect(parseTranscriptWorkingDirectory(`\n${meta}\n${turn}`)).toEqual({
      cwd: 'D:\\folder\\work'
    })
  })

  it.each(['function_call', 'custom_tool_call', 'local_shell_call'])(
    'pairs %s with its own result',
    (type) => {
      const call = {
        type,
        call_id: 'create',
        arguments: JSON.stringify({ cmd: 'gh pr create --fill' })
      }
      const lines = [
        codex(call),
        codex({ type: 'function_call', call_id: 'view', arguments: '{"cmd":"gh pr view 77"}' }),
        codex({
          type: 'function_call_output',
          call_id: 'view',
          output: 'https://github.com/o/r/pull/77'
        }),
        codex({ type: 'custom_tool_call_output', call_id: 'create', output: url })
      ]
      expect(extractPullRequestUrlsFromTranscript(lines.join('\n'))).toEqual([url])
    }
  )

  it('follows a running create command through write_stdin, without taking other jobs', () => {
    const lines = [
      codex({ type: 'function_call', call_id: 'create', arguments: '{"cmd":"gh pr create"}' }),
      codex({
        type: 'function_call_output',
        call_id: 'create',
        output: 'Process running with session ID 123'
      }),
      codex({ type: 'function_call', call_id: 'other', arguments: '{"session_id":456}' }),
      codex({
        type: 'function_call_output',
        call_id: 'other',
        output: 'https://github.com/o/r/pull/77'
      }),
      codex({ type: 'function_call', call_id: 'poll', arguments: '{"session_id":123,"chars":""}' }),
      codex({ type: 'function_call_output', call_id: 'poll', output: url })
    ]
    expect(extractPullRequestUrlsFromTranscript(lines.join('\n'))).toEqual([url])
  })
})

describe('incremental Claude context', () => {
  it('remembers a create across polls and unrelated results', () => {
    const state = createTerminalTranscriptContext()
    consumeTerminalTranscriptLine(
      state,
      JSON.stringify({
        message: {
          content: [{ type: 'tool_use', id: 'create', input: { command: 'glab mr create --fill' } }]
        }
      })
    )
    consumeTerminalTranscriptLine(state, JSON.stringify({ cwd: '/new/folder' }))
    consumeTerminalTranscriptLine(
      state,
      JSON.stringify({
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'view', content: url },
            {
              type: 'tool_result',
              tool_use_id: 'create',
              content: 'https://gitlab.com/group/sub/repo/-/merge_requests/5'
            }
          ]
        }
      })
    )
    expect(state.urls).toEqual(['https://gitlab.com/group/sub/repo/-/merge_requests/5'])
    expect(state.directory).toEqual({ cwd: '/new/folder' })
  })
})

it('follows Claude background create results through TaskOutput', () => {
  const records = [
    {
      message: {
        content: [{ type: 'tool_use', id: 'create', input: { command: 'gh pr create --fill' } }]
      }
    },
    {
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'create',
            content: 'Command running in background with ID: job-1'
          }
        ]
      }
    },
    { message: { content: [{ type: 'tool_use', id: 'poll', input: { task_id: 'job-1' } }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'poll', content: url }] } }
  ]
  expect(
    extractPullRequestUrlsFromTranscript(records.map((row) => JSON.stringify(row)).join('\n'))
  ).toEqual([url])
})

it('uses the Codex tool working directory when work happens in a different worktree', () => {
  const state = createTerminalTranscriptContext()
  consumeTerminalTranscriptLine(
    state,
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo' } })
  )
  consumeTerminalTranscriptLine(
    state,
    codex({
      type: 'function_call',
      call_id: 'shell',
      arguments: JSON.stringify({ cmd: 'git status', workdir: '/repo-worktrees/feature' })
    })
  )
  expect(state.directory).toEqual({ cwd: '/repo-worktrees/feature' })
})
