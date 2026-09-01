import { describe, expect, it } from 'vitest'
import {
  extractPullRequestUrls,
  extractPullRequestUrlsFromTranscript,
  parseTranscriptWorkingDirectory,
  pullRequestLabel,
  worktreeNameFromPath
} from './terminal-context'

describe('extractPullRequestUrls', () => {
  // Why dedupe: the link is printed by `gh pr create`, by every later `gh pr view`,
  // and by the agent summarising itself — one pull request, many prints.
  it('keeps each pull request once, oldest first', () => {
    const text = [
      '⏺ Bash(gh pr create --title "one")',
      '  ⎿  https://github.com/rapina/cozy-sandbox/pull/653',
      'some other output',
      '$ gh pr create --fill',
      'Creating pull request for feat/two into main in rapina/cozy-sandbox',
      'https://github.com/rapina/cozy-sandbox/pull/656',
      'https://github.com/rapina/cozy-sandbox/pull/653'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual([
      'https://github.com/rapina/cozy-sandbox/pull/653',
      'https://github.com/rapina/cozy-sandbox/pull/656'
    ])
  })

  // Why: a terminal prints pull request links all day — `gh pr view`, review
  // comments fetched as JSON, a job list summarising other terminals' work — and
  // rows carried pull requests the terminal had only looked at. Measured.
  it('ignores links that no create printed', () => {
    const text = [
      '$ gh pr view 12',
      'url:\thttps://github.com/rapina/cozy-sandbox/pull/12',
      '"html_url": "https://github.com/rapina/cozy-sandbox/pull/40#discussion_r1"',
      'https://github.com/rapina/cozy-sandbox/pull/7'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual([])
  })

  it('stops counting links once the create is too far behind', () => {
    const text = [
      'gh pr create --title "x"',
      'https://github.com/rapina/cozy-sandbox/pull/1',
      'x'.repeat(9000),
      'https://github.com/rapina/cozy-sandbox/pull/2'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual(['https://github.com/rapina/cozy-sandbox/pull/1'])
  })

  it('ignores links that are not pull requests', () => {
    const text = [
      'gh pr create',
      'https://github.com/rapina/cozy-sandbox',
      'https://github.com/rapina/cozy-sandbox/issues/12',
      'remote: https://github.com/rapina/cozy-sandbox/pull/new/feat',
      'https://github.com/rapina/cozy-sandbox/pull/7'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual(['https://github.com/rapina/cozy-sandbox/pull/7'])
  })

  it('reads a merge request the same way', () => {
    const text = [
      'glab mr create --fill',
      'https://gitlab.com/rapina/cozy-sandbox/-/merge_requests/9'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual([
      'https://gitlab.com/rapina/cozy-sandbox/-/merge_requests/9'
    ])
  })

  it('labels a pull request by its number', () => {
    expect(pullRequestLabel('https://github.com/rapina/cozy-sandbox/pull/653')).toBe('#653')
    expect(pullRequestLabel('https://gitlab.com/rapina/cozy-sandbox/-/merge_requests/9')).toBe('!9')
  })
})

describe('parseTranscriptWorkingDirectory', () => {
  function record(cwd: string, gitBranch?: string): string {
    return JSON.stringify({ cwd, ...(gitBranch ? { gitBranch } : {}) })
  }

  // Why the last and not the first: a session that starts in a repo root and moves
  // into a worktree keeps its first records, so reading from the top answers with
  // the folder it left. Measured on a live transcript, exactly that happened.
  it('answers with the newest directory the session recorded', () => {
    const tail = [
      '{"cut":',
      record('D:\\Workspace\\cozy-sandbox', 'main'),
      record('D:\\Workspace\\cozy-sandbox-worktrees\\slainer-w-level-panel-scene', 'agent/level')
    ].join('\n')

    expect(parseTranscriptWorkingDirectory(tail)).toEqual({
      cwd: 'D:\\Workspace\\cozy-sandbox-worktrees\\slainer-w-level-panel-scene',
      branch: 'agent/level'
    })
  })

  // Why: reading from an offset lands mid-record, so the first line is never whole.
  it('never reads the partial first line', () => {
    const tail = [record('D:\\Workspace\\never-read-me'), record('D:\\Workspace\\real')].join('\n')

    expect(parseTranscriptWorkingDirectory(tail)?.cwd).toBe('D:\\Workspace\\real')
  })

  it('skips records that carry no directory', () => {
    const tail = [
      '{"cut":',
      record('D:\\Workspace\\cozy-sandbox'),
      JSON.stringify({ message: { role: 'assistant' } })
    ].join('\n')

    expect(parseTranscriptWorkingDirectory(tail)?.cwd).toBe('D:\\Workspace\\cozy-sandbox')
  })

  it('returns null when nothing in the tail recorded one', () => {
    expect(parseTranscriptWorkingDirectory('{"cut":\n{"a":1}\n')).toBeNull()
  })
})

// Why this source at all: an agent's TUI redraws its conversation, so the link it
// printed survives in the recording hundreds of times while the command that made
// it scrolls out entirely (measured on a live terminal: 620 copies of the link and
// not one `gh pr create`). The transcript keeps the call and its result as records.
describe('extractPullRequestUrlsFromTranscript', () => {
  function toolUse(id: string, command: string): string {
    return JSON.stringify({
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }]
      }
    })
  }

  function toolResult(id: string, content: unknown, toolUseResult?: unknown): string {
    return JSON.stringify({
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
      ...(toolUseResult === undefined ? {} : { toolUseResult })
    })
  }

  it('takes the link a create call returned', () => {
    const text = [
      toolUse('toolu_1', 'cd D:/w && gh pr create --base main --body-file "$JOB/pr-body.md"'),
      toolResult('toolu_1', 'https://github.com/rapina/cozy-sandbox/pull/772\nShell cwd was reset')
    ].join('\n')

    expect(extractPullRequestUrlsFromTranscript(text)).toEqual([
      'https://github.com/rapina/cozy-sandbox/pull/772'
    ])
  })

  it('reads a result given as blocks or in the structured field', () => {
    const text = [
      toolUse('toolu_1', 'glab mr create --fill'),
      toolResult('toolu_1', [{ type: 'text', text: 'https://gitlab.com/g/p/-/merge_requests/42' }]),
      toolUse('toolu_2', 'gh pr create --fill'),
      toolResult('toolu_2', '', { stdout: 'https://github.com/o/r/pull/9' })
    ].join('\n')

    expect(extractPullRequestUrlsFromTranscript(text)).toEqual([
      'https://gitlab.com/g/p/-/merge_requests/42',
      'https://github.com/o/r/pull/9'
    ])
  })

  it('leaves out the ones it only looked at', () => {
    const text = [
      toolUse('toolu_1', 'gh pr view 700 --json url'),
      toolResult('toolu_1', 'https://github.com/o/r/pull/700'),
      toolUse('toolu_2', 'gh pr list'),
      toolResult('toolu_2', 'https://github.com/o/r/pull/701'),
      JSON.stringify({
        message: { role: 'assistant', content: [{ type: 'text', text: 'see /pull/702' }] }
      })
    ].join('\n')

    expect(extractPullRequestUrlsFromTranscript(text)).toEqual([])
  })

  it('survives a torn first line, a half-written last one and blank space', () => {
    const text = [
      '{"message":{"content":[{"type":"tool_re',
      '',
      toolUse('toolu_1', 'gh pr create'),
      toolResult('toolu_1', 'https://github.com/o/r/pull/5'),
      '{"message":{"content":[{"type":"too'
    ].join('\n')

    expect(extractPullRequestUrlsFromTranscript(text)).toEqual(['https://github.com/o/r/pull/5'])
  })
})

describe('worktreeNameFromPath', () => {
  it('names a directory by its own last segment', () => {
    expect(worktreeNameFromPath('D:\\Workspace\\cozy-sandbox-worktrees\\slainer-w-level')).toBe(
      'slainer-w-level'
    )
    expect(worktreeNameFromPath('/home/pjh/work/cozy-sandbox/')).toBe('cozy-sandbox')
  })
})
