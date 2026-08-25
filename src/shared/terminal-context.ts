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

// GitHub (any host, so an enterprise instance counts) and GitLab's `/-/merge_requests/` path.
const PULL_REQUEST_URL =
  /https?:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+|https?:\/\/[\w.-]+\/[\w./-]+?\/-\/merge_requests\/\d+/g

// What a terminal prints when a pull request is being opened: the command itself,
// whether typed at the prompt or shown by an agent as `Bash(gh pr create …)`, and
// the CLI's own announcement, which lands on stderr just ahead of the link.
const PULL_REQUEST_CREATE_MARK =
  /\bgh\s+pr\s+create\b|\bglab\s+mr\s+create\b|Creating pull request for|Creating merge request/g

/**
 * How far after a create mark a link still counts as the pull request it opened.
 *
 * Why this far: the command's echo can carry a multi-kilobyte body before the
 * link is printed. Why not further: the next `gh pr view` or a list of other
 * people's pull requests would start to count.
 */
export const PULL_REQUEST_CREATE_WINDOW_CHARS = 8192

/**
 * Pull requests a terminal opened, oldest first and without duplicates.
 *
 * Why only links near a create: a terminal prints pull request links all day —
 * `gh pr view`, review comments fetched as JSON, a job list summarising other
 * terminals' work, an earlier session on the same shell — and none of those is
 * this terminal's own pull request. Measured: rows carried pull requests the
 * terminal had only looked at. The link that follows a create is the one it made;
 * a later `gh pr view` of the same link is caught by the dedupe.
 */
export function extractPullRequestUrls(text: string): string[] {
  const markEnds: number[] = []
  for (const mark of text.matchAll(PULL_REQUEST_CREATE_MARK)) {
    markEnds.push(mark.index + mark[0].length)
  }
  const seen: string[] = []
  let markIndex = 0
  for (const match of text.matchAll(PULL_REQUEST_URL)) {
    while (markIndex < markEnds.length && markEnds[markIndex]! <= match.index) {
      markIndex += 1
    }
    const lastMarkEnd = markIndex > 0 ? markEnds[markIndex - 1]! : -1
    if (lastMarkEnd < 0 || match.index - lastMarkEnd > PULL_REQUEST_CREATE_WINDOW_CHARS) {
      continue
    }
    const url = match[0]
    if (!seen.includes(url)) {
      seen.push(url)
    }
  }
  return seen
}

/** `#653` for a pull request, `!42` for a merge request — what a row has room for. */
export function pullRequestLabel(url: string): string {
  const number = url.slice(url.lastIndexOf('/') + 1)
  return url.includes('/-/merge_requests/') ? `!${number}` : `#${number}`
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
