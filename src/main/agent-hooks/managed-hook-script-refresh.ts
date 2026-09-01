import { randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { grantDirAcl, grantDirAclAsync, isPermissionError } from '../win32-utils'

type ExistingScript = { exists: false } | { exists: true; content: string | null }

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readExistingScript(scriptPath: string): Promise<ExistingScript> {
  try {
    return { exists: true, content: await readFile(scriptPath, 'utf-8') }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { exists: false }
    }
    try {
      await stat(scriptPath)
      return { exists: true, content: null }
    } catch (statError) {
      if (isMissingPathError(statError)) {
        return { exists: false }
      }
      throw error
    }
  }
}

/**
 * Why retried, and why an in-place write at the end: cmd.exe keeps a running batch
 * file open without delete sharing, so replacing it by rename fails with EPERM for
 * as long as some hook is executing it. A machine with twenty agents firing hooks
 * has the script busy often enough that a start-up refresh failed at exactly that
 * moment — silently, and the new script never landed. cmd.exe does share the file
 * for writing, so when the rename keeps losing, the content goes in place.
 */
const RENAME_RETRY_ATTEMPTS = 10
const RENAME_RETRY_DELAY_MS = 50

export function isBusyFileError(error: unknown): boolean {
  const code = error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : null
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

async function replaceScript(tmpPath: string, scriptPath: string, content: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tmpPath, scriptPath)
      return
    } catch (error) {
      if (process.platform !== 'win32' || !isBusyFileError(error)) {
        throw error
      }
      if (attempt >= RENAME_RETRY_ATTEMPTS) {
        await writeScriptWithAclRetry(scriptPath, content)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS))
    }
  }
}

/** The install path's twin: it cannot wait, so a busy script is written in place at once. */
export function replaceScriptSync(tmpPath: string, scriptPath: string, content: string): void {
  try {
    renameSync(tmpPath, scriptPath)
  } catch (error) {
    if (process.platform !== 'win32' || !isBusyFileError(error)) {
      throw error
    }
    try {
      writeFileSync(scriptPath, content, 'utf-8')
    } catch (writeError) {
      if (!isPermissionError(writeError)) {
        throw writeError
      }
      grantDirAcl(dirname(scriptPath))
      writeFileSync(scriptPath, content, 'utf-8')
    }
  }
}

async function scriptStillExists(scriptPath: string): Promise<boolean> {
  try {
    await stat(scriptPath)
    return true
  } catch (error) {
    if (isMissingPathError(error)) {
      return false
    }
    throw error
  }
}

async function writeScriptWithAclRetry(scriptPath: string, content: string): Promise<void> {
  try {
    await writeFile(scriptPath, content, 'utf-8')
  } catch (error) {
    if (isPermissionError(error) && process.platform === 'win32') {
      try {
        await grantDirAclAsync(dirname(scriptPath))
        await writeFile(scriptPath, content, 'utf-8')
        return
      } catch {
        // Re-throw the original permission error.
      }
    }
    throw error
  }
}

// Why: refresh must not block Electron's main thread or create state for an absent CLI.
export async function refreshManagedScriptIfPresent(
  scriptPath: string,
  content: string
): Promise<boolean> {
  const existing = await readExistingScript(scriptPath)
  if (!existing.exists) {
    return false
  }
  if (existing.content === content) {
    if (process.platform !== 'win32') {
      await chmod(scriptPath, 0o755)
    }
    return true
  }

  const tmpPath = join(dirname(scriptPath), `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    await writeScriptWithAclRetry(tmpPath, content)
    if (process.platform !== 'win32') {
      await chmod(tmpPath, 0o755)
    }
    if (!(await scriptStillExists(scriptPath))) {
      return false
    }
    await replaceScript(tmpPath, scriptPath, content)
    return true
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined)
  }
}
