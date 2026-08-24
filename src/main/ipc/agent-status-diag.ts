import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, ipcMain } from 'electron'

/**
 * TEMPORARY: a line-per-decision log of what the renderer does with an agent
 * status, written where it can be read after the fact.
 *
 * Why it exists: a running agent whose terminal was closed reached the main
 * process on every turn and still appeared nowhere in the renderer, and the drop
 * could not be found by reading the code. Delete this file, its preload entry and
 * its call sites once that is understood.
 */
const MAX_LINE_LENGTH = 500

function diagLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'agent-status-diag.log')
}

function registerAgentStatusDiagIpcHandlers(): void {
  ipcMain.removeAllListeners('agentStatus:diag')
  ipcMain.on('agentStatus:diag', (_event, line: unknown) => {
    if (typeof line !== 'string' || line.length === 0) {
      return
    }
    const path = diagLogPath()
    void mkdir(dirname(path), { recursive: true })
      .then(() =>
        appendFile(path, `${new Date().toISOString()} ${line.slice(0, MAX_LINE_LENGTH)}\n`, 'utf-8')
      )
      .catch(() => {
        // Why swallowed: a diagnostic that breaks the app it is diagnosing is worse
        // than no diagnostic.
      })
  })
}

// Why registered on import: this file is temporary, and the module that would
// normally call it sits at its line limit.
registerAgentStatusDiagIpcHandlers()
