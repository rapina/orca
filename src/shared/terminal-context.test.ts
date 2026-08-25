import { describe, expect, it } from 'vitest'
import {
  extractPullRequestUrls,
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

describe('worktreeNameFromPath', () => {
  it('names a directory by its own last segment', () => {
    expect(worktreeNameFromPath('D:\\Workspace\\cozy-sandbox-worktrees\\slainer-w-level')).toBe(
      'slainer-w-level'
    )
    expect(worktreeNameFromPath('/home/pjh/work/cozy-sandbox/')).toBe('cozy-sandbox')
  })
})
