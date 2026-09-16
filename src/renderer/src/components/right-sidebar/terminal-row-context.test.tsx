// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TerminalContext } from '../../../../shared/terminal-context'
import { useTerminalContexts } from './terminal-row-context'

vi.mock('./TerminalRowPullRequestChip', () => ({ TerminalRowPullRequestChip: () => null }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('clears previous session context immediately and ignores its late response', async () => {
  const pending: ((rows: TerminalContext[]) => void)[] = []
  const readTerminalContexts = vi.fn(
    () => new Promise<TerminalContext[]>((resolve) => pending.push(resolve))
  )
  vi.stubGlobal('window', { api: { agentStatus: { readTerminalContexts } } })
  const request = (sessionId: string) => ({ terminals: [{ paneKey: 'pane', sessionId }] })
  const { result, rerender } = renderHook(
    ({ sessionId }) => useTerminalContexts(request(sessionId)),
    { initialProps: { sessionId: 'first' } }
  )
  await act(async () =>
    pending[0]!([{ paneKey: 'pane', worktreeName: 'first', pullRequestUrls: [] }])
  )
  expect(result.current.pane?.worktreeName).toBe('first')
  rerender({ sessionId: 'second' })
  expect(result.current).toEqual({})
  rerender({ sessionId: 'third' })
  await act(async () =>
    pending[1]!([{ paneKey: 'pane', worktreeName: 'second', pullRequestUrls: [] }])
  )
  expect(result.current).toEqual({})
  await act(async () =>
    pending[2]!([{ paneKey: 'pane', worktreeName: 'third', pullRequestUrls: [] }])
  )
  expect(result.current.pane?.worktreeName).toBe('third')
})
