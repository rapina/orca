import { afterEach, describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTerminalTranscriptContext } from './terminal-transcript-reader'

const directories: string[] = []
const url = 'https://github.com/o/r/pull/42'
const call = JSON.stringify({
  message: { content: [{ type: 'tool_use', id: 'one', input: { command: 'gh pr create' } }] }
})
const result = JSON.stringify({
  message: { content: [{ type: 'tool_result', tool_use_id: 'one', content: url }] }
})

async function transcript(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-terminal-context-'))
  directories.push(dir)
  const path = join(dir, 'session.jsonl')
  await writeFile(path, text)
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('terminal transcript reader', () => {
  it('finds a PR older than the former 4MB tail and a sparse Codex directory', async () => {
    const meta = JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo/feature' } })
    const path = await transcript(`${meta}\n${call}\n${result}\n${'{}\n'.repeat(1_400_000)}`)
    const context = await readTerminalTranscriptContext(path)
    expect(context?.urls).toEqual([url])
    expect(context?.directory).toEqual({ cwd: '/repo/feature' })
  })

  it('retains call identity across polls, large gaps and torn UTF-8 records', async () => {
    const path = await transcript(`${call}\n`)
    await readTerminalTranscriptContext(path)
    await appendFile(path, `${JSON.stringify({ noise: 'x'.repeat(300_000) })}\n`)
    await readTerminalTranscriptContext(path)
    const bytes = Buffer.from(`${result}\n${JSON.stringify({ cwd: '/work/한글' })}\n`)
    const split = bytes.indexOf(Buffer.from('한')) + 1
    await appendFile(path, bytes.subarray(0, split))
    expect((await readTerminalTranscriptContext(path))?.urls).toEqual([url])
    await appendFile(path, bytes.subarray(split))
    const results = await Promise.all([
      readTerminalTranscriptContext(path),
      readTerminalTranscriptContext(path)
    ])
    expect(results[0]?.directory).toEqual({ cwd: '/work/한글' })
    expect(results[1]?.urls).toEqual([url])
  })

  it('resets a truncated file and keeps different sessions isolated', async () => {
    const first = await transcript(`${call}\n${result}\n`)
    const second = await transcript(`${result}\n`)
    expect((await readTerminalTranscriptContext(first))?.urls).toEqual([url])
    expect((await readTerminalTranscriptContext(second))?.urls).toEqual([])
    await writeFile(first, '{"cwd":"/replacement"}\n')
    expect((await readTerminalTranscriptContext(first))?.urls).toEqual([])
  })
})
