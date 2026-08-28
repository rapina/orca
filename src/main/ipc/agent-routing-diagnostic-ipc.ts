import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { getLogsDirectory } from '../observability/logs-directory'

/**
 * One line per routing decision the renderer makes for an agent status, kept on
 * disk so a misplaced row can be explained after the fact.
 *
 * Why a file of its own: the decision - which terminal's keystroke a background
 * job's prompt matched, and why the others were passed over - lives only in
 * renderer memory, and by the time a person notices the row is wrong the
 * evidence is gone. The trace log is for main; this is the renderer's account.
 */
const MAX_LINE_CHARS = 2_000
const ROTATE_AT_BYTES = 1_000_000

let writing: Promise<void> = Promise.resolve()

function diagnosticLogPath(): string {
  return join(getLogsDirectory(), 'agent-status-diag.log')
}

function append(line: string): void {
  writing = writing
    .then(async () => {
      const path = diagnosticLogPath()
      await mkdir(getLogsDirectory(), { recursive: true })
      try {
        if ((await stat(path)).size > ROTATE_AT_BYTES) {
          await rename(path, `${path}.1`)
        }
      } catch {
        // Why swallowed: no file yet is the ordinary first run.
      }
      await appendFile(path, `${new Date().toISOString()} ${line}\n`, 'utf-8')
    })
    .catch(() => {
      // Why swallowed: a diagnostic that fails to land must never cost the status it describes.
    })
}

export function registerAgentRoutingDiagnosticIpcHandlers(): void {
  ipcMain.removeAllListeners('agentStatus:noteRoutingDiagnostic')
  ipcMain.on('agentStatus:noteRoutingDiagnostic', (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) {
      return
    }
    append(value.slice(0, MAX_LINE_CHARS).replace(/[\r\n]+/g, ' '))
  })
}

// Why registered on import: agent-hooks.ts sits at its line limit.
registerAgentRoutingDiagnosticIpcHandlers()
