/**
 * What a terminal is working on, read from what it and its agent left on disk.
 *
 * Why here and not from the store: a terminal's list row is scoped to the Orca
 * worktree its tab belongs to, but an agent inside it routinely runs in another
 * folder — a git worktree of the same repo — and nothing in the renderer knows
 * that. The agent's own transcript records the directory it is in, and the
 * terminal's recording holds the pull requests it opened.
 */

/** What one terminal is working on. */
export type TerminalContext = {
  paneKey: string
  /** Folder the agent is actually in, as its transcript last recorded it. */
  worktreeName?: string
  /** Branch checked out there, when the transcript recorded one. */
  branch?: string
  /** Pull requests this terminal's own output has shown, oldest first. */
  pullRequestUrls: string[]
}

/** Why bounded: a long-lived terminal can name a dozen; the row has space for a few. */
export const MAX_TERMINAL_PULL_REQUESTS = 8

const PULL_REQUEST_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

/**
 * Pull request links a terminal printed, oldest first and without duplicates.
 *
 * Why the whole output and not just `gh pr create`: the link is printed by the
 * create, by every later `gh pr view`, and by the agent summarising its own work,
 * and no one of those is reliably present. Repetition is what dedupe is for.
 */
export function extractPullRequestUrls(text: string): string[] {
  const seen: string[] = []
  for (const match of text.matchAll(PULL_REQUEST_URL)) {
    const url = match[0]
    if (!seen.includes(url)) {
      seen.push(url)
    }
  }
  return seen
}

/** `#653` — what a row has room for. */
export function pullRequestLabel(url: string): string {
  const number = url.slice(url.lastIndexOf('/') + 1)
  return `#${number}`
}

/**
 * The directory and branch a transcript last recorded.
 *
 * Why the last and not the first: a session that starts in a repo root and moves
 * into a worktree keeps its first records, so reading from the top answers with
 * the folder it left. Why line by line rather than a JSON parse of the tail: the
 * tail begins mid-record, and later records can be torn by a concurrent write.
 */
export function parseTranscriptWorkingDirectory(
  tail: string
): { cwd: string; branch?: string } | null {
  const lines = tail.split('\n')
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object') {
      continue
    }
    const row = record as Record<string, unknown>
    const cwd = typeof row.cwd === 'string' ? row.cwd.trim() : ''
    if (!cwd) {
      continue
    }
    const branch = typeof row.gitBranch === 'string' ? row.gitBranch.trim() : ''
    return branch ? { cwd, branch } : { cwd }
  }
  return null
}

/**
 * Titles that name no turn: the workspace's own folder.
 *
 * Why this is needed at all: some agents write the directory they run in into the
 * window title and never the turn, so that title names every terminal of the
 * workspace identically. A worktree id carries its path after `::`.
 */
export function uninformativeTerminalTitles(worktreeId: string | null): ReadonlySet<string> {
  const path = worktreeId?.split('::').slice(1).join('::') ?? ''
  const folder = path ? worktreeNameFromPath(path) : ''
  return folder ? new Set([folder]) : new Set<string>()
}

/** The folder's own name — the part a person recognises a worktree by. */
export function worktreeNameFromPath(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return separator === -1 ? trimmed : trimmed.slice(separator + 1)
}
