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
      'https://github.com/rapina/cozy-sandbox/pull/653',
      'some other output',
      'https://github.com/rapina/cozy-sandbox/pull/656',
      'https://github.com/rapina/cozy-sandbox/pull/653'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual([
      'https://github.com/rapina/cozy-sandbox/pull/653',
      'https://github.com/rapina/cozy-sandbox/pull/656'
    ])
  })

  it('ignores links that are not pull requests', () => {
    const text = [
      'https://github.com/rapina/cozy-sandbox',
      'https://github.com/rapina/cozy-sandbox/issues/12',
      'https://github.com/rapina/cozy-sandbox/pull/7'
    ].join('\n')

    expect(extractPullRequestUrls(text)).toEqual(['https://github.com/rapina/cozy-sandbox/pull/7'])
  })

  it('labels a pull request by its number', () => {
    expect(pullRequestLabel('https://github.com/rapina/cozy-sandbox/pull/653')).toBe('#653')
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
