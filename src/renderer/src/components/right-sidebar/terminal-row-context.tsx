import { useEffect, useRef, useState } from 'react'
import {
  type TerminalContextRequest,
  terminalContextRequestKey
} from '@/lib/terminal-context-request'
import {
  MAX_TERMINAL_PULL_REQUESTS,
  type TerminalContext
} from '../../../../shared/terminal-context'
import { TerminalRowPullRequestChip } from './TerminalRowPullRequestChip'

/** Why re-read on a timer: a pull request appears in a recording minutes after the
 *  row was drawn, and nothing tells the renderer that it did. */
const TERMINAL_CONTEXT_REFRESH_MS = 10_000
const EMPTY_CONTEXTS: Record<string, TerminalContext> = {}

/**
 * What each terminal is working on, kept fresh while the panel is open.
 *
 * Why a fetch and not store state: both answers live on disk — the agent's own
 * transcript and the terminal's own recording — and neither passes through the
 * renderer. Why keyed on the request rather than held as a dependency: this panel
 * repaints on every agent ping, and a disk sweep per repaint would be a sweep per
 * line of agent output. The ref carries the current addresses; the key decides
 * when they are worth reading again.
 */
export function useTerminalContexts(
  request: TerminalContextRequest
): Record<string, TerminalContext> {
  const [result, setResult] = useState<{ key: string; contexts: Record<string, TerminalContext> }>({
    key: '',
    contexts: EMPTY_CONTEXTS
  })
  const requestRef = useRef(request)
  requestRef.current = request
  const requestKey = terminalContextRequestKey(request)

  useEffect(() => {
    if (requestRef.current.terminals.length === 0) {
      return
    }
    let cancelled = false
    let reading = false
    const read = (): void => {
      if (reading) {
        return
      }
      reading = true
      void window.api?.agentStatus
        ?.readTerminalContexts?.(requestRef.current)
        .then((rows) => {
          if (!cancelled) {
            setResult({
              key: requestKey,
              contexts: Object.fromEntries(rows.map((row) => [row.paneKey, row]))
            })
          }
        })
        .catch(() => {
          // Why swallowed: these lines are context on a row that reads fine without
          // them; a failed disk read must not take the terminal list with it.
        })
        .finally(() => {
          reading = false
        })
    }
    read()
    const timer = setInterval(read, TERMINAL_CONTEXT_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [requestKey])

  return result.key === requestKey ? result.contexts : EMPTY_CONTEXTS
}

/**
 * What this terminal is working on, under its name.
 *
 * Why the folder: every row of this panel belongs to one Orca worktree, but an
 * agent inside a terminal routinely runs in a git worktree of its own, and the row
 * said nothing about which. Why the pull requests: they are what a finished
 * terminal leaves behind, and this list is where the user comes looking for them.
 */
export function TerminalRowContext({
  context,
  ptyId
}: {
  context: TerminalContext
  /** The terminal's pty, so a link knows whose terminal it came from (local or remote). */
  ptyId?: string
}): React.JSX.Element {
  const pullRequests = context.pullRequestUrls.slice(-MAX_TERMINAL_PULL_REQUESTS)
  return (
    <div className="flex flex-col gap-0.5 pb-1 pl-[2.1rem] pr-3">
      {context.worktreeName ? (
        <div
          data-testid="terminal-list-worktree"
          className="truncate text-[10px] text-muted-foreground"
          title={context.branch ?? context.worktreeName}
        >
          {context.worktreeName}
        </div>
      ) : null}
      {pullRequests.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {pullRequests.map((url) => (
            <TerminalRowPullRequestChip key={url} url={url} {...(ptyId ? { ptyId } : {})} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
