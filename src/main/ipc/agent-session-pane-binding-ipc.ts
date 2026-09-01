import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, ipcMain } from 'electron'
import { isValidPaneKey } from '../agent-hooks/server'
import './agent-routing-diagnostic-ipc'

/**
 * Terminals an agent session was bound to by hand, kept across restarts.
 *
 * Why on disk: the correction says which terminal an agent is really in, and a
 * hook keeps reporting the pane its process was born with for as long as that
 * agent runs — which is longer than one Orca run. Holding the binding in renderer
 * memory meant every restart put the agent back on the terminal it was never in
 * and asked the user to fix it again.
 *
 * Why next to the hook state and not in the workspace session: this is what a
 * hook's pane key means, not what the window looks like.
 */
// Why this many: sessions seen running in a terminal record their home here too, so
// the hand-made corrections for background jobs must not be the ones evicted first.
const MAX_BINDINGS = 1024

let cache: Record<string, string> | null = null
let writing: Promise<void> = Promise.resolve()

function bindingsPath(): string {
  return join(app.getPath('userData'), 'agent-hooks', 'session-pane-bindings.json')
}

function sanitize(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [sessionId, paneKey] of Object.entries(value as Record<string, unknown>)) {
    if (sessionId.length > 0 && typeof paneKey === 'string' && isValidPaneKey(paneKey)) {
      out[sessionId] = paneKey
    }
  }
  return out
}

async function load(): Promise<Record<string, string>> {
  if (cache) {
    return cache
  }
  try {
    cache = sanitize(JSON.parse(await readFile(bindingsPath(), 'utf-8')))
  } catch {
    // Why swallowed: no file yet, or one written by a newer version. An empty map
    // costs the user one correction; refusing to start costs more.
    cache = {}
  }
  return cache
}

/** Why serialised: two corrections in the same tick would otherwise race the file. */
function persist(bindings: Record<string, string>): void {
  const path = bindingsPath()
  writing = writing
    .then(async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify(bindings, null, 2), 'utf-8')
    })
    .catch(() => {
      // Why swallowed: a binding that fails to persist still works this run.
    })
}

function registerAgentSessionPaneBindingIpcHandlers(): void {
  ipcMain.removeHandler('agentStatus:listSessionPaneBindings')
  ipcMain.handle('agentStatus:listSessionPaneBindings', async () => ({ ...(await load()) }))

  ipcMain.removeAllListeners('agentStatus:bindSessionPane')
  ipcMain.on('agentStatus:bindSessionPane', (_event, value: unknown) => {
    const args = value as Record<string, unknown> | null
    const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : ''
    const paneKey = typeof args?.paneKey === 'string' ? args.paneKey : ''
    if (sessionId.length === 0 || !isValidPaneKey(paneKey)) {
      return
    }
    void load().then((bindings) => {
      // Why delete first: re-insert so a refreshed binding is not the eviction victim.
      delete bindings[sessionId]
      bindings[sessionId] = paneKey
      const sessionIds = Object.keys(bindings)
      for (const oldest of sessionIds.slice(0, Math.max(0, sessionIds.length - MAX_BINDINGS))) {
        delete bindings[oldest]
      }
      persist(bindings)
    })
  })

  ipcMain.removeAllListeners('agentStatus:unbindSessionPane')
  ipcMain.on('agentStatus:unbindSessionPane', (_event, value: unknown) => {
    const args = value as Record<string, unknown> | null
    const sessionId = typeof args?.sessionId === 'string' ? args.sessionId : ''
    if (sessionId.length === 0) {
      return
    }
    void load().then((bindings) => {
      if (!(sessionId in bindings)) {
        return
      }
      delete bindings[sessionId]
      persist(bindings)
    })
  })
}

// Why registered on import: agent-hooks.ts sits at its line limit.
registerAgentSessionPaneBindingIpcHandlers()
