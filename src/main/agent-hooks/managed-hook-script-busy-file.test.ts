import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FsPromises from 'node:fs/promises'

const { renameFailures } = vi.hoisted(() => ({ renameFailures: { remaining: 0 } }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      if (renameFailures.remaining > 0) {
        renameFailures.remaining -= 1
        const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return actual.rename(from, to)
    })
  }
})

import { refreshManagedScriptIfPresent } from './managed-hook-script-refresh'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-busy-script-'))
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
})

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  rmSync(dir, { recursive: true, force: true })
  renameFailures.remaining = 0
})

// Why: cmd.exe keeps a running batch file open without delete sharing, so the
// rename that replaces the script loses whenever a hook is mid-flight. On a busy
// machine that was the moment start-up chose, and the new script never landed.
describe('refreshing a managed script that a hook is executing', () => {
  it('retries the rename until the hook lets go', async () => {
    const scriptPath = join(dir, 'claude-hook.cmd')
    writeFileSync(scriptPath, 'old\r\n')
    renameFailures.remaining = 3

    await expect(refreshManagedScriptIfPresent(scriptPath, 'new\r\n')).resolves.toBe(true)

    expect(readFileSync(scriptPath, 'utf-8')).toBe('new\r\n')
  })

  it('writes the content in place when the rename keeps losing', async () => {
    const scriptPath = join(dir, 'claude-hook.cmd')
    writeFileSync(scriptPath, 'old\r\n')
    renameFailures.remaining = 100

    await expect(refreshManagedScriptIfPresent(scriptPath, 'new\r\n')).resolves.toBe(true)

    expect(readFileSync(scriptPath, 'utf-8')).toBe('new\r\n')
  })
})
