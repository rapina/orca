import { parsePaneKey } from '../../../../shared/stable-pane-id'

type AgentPaneAuthorityAlias = {
  ownerPaneKey: string
  ptyId: string | null
}

const aliasesByPhysicalPaneKey = new Map<string, AgentPaneAuthorityAlias>()

// Why: teardown paths that never retire (pty exit, workspace purge) would otherwise
// leak an entry per detach for the renderer's lifetime; evict oldest-first.
const MAX_AGENT_PANE_AUTHORITY_ALIASES = 512

function evictOldestAgentPaneAuthorityAliases(): void {
  // Why: mirrors the main-process alias bound (boundPaneKeyAliases) — insertion-order eviction.
  while (aliasesByPhysicalPaneKey.size > MAX_AGENT_PANE_AUTHORITY_ALIASES) {
    const oldestPaneKey = aliasesByPhysicalPaneKey.keys().next().value
    if (!oldestPaneKey) {
      break
    }
    aliasesByPhysicalPaneKey.delete(oldestPaneKey)
  }
}

export type AgentPaneAuthorityTransfer = {
  physicalPaneKey: string
  previousOwnerPaneKey: string
  ownerPaneKey: string
  ptyId: string | null
}

/**
 * Terminals a specific agent session was bound to by hand, overriding the pane
 * key its hook reports.
 *
 * Why keyed by session and not by pane: every background-job session reports the
 * pane key of the terminal that started their shared host, so they all claim one
 * pane. Re-pointing that pane would drag the other sessions along with the one
 * being corrected; only the session itself may move.
 */
const ownerPaneKeyBySessionId = new Map<string, string>()
const MAX_AGENT_SESSION_PANE_BINDINGS = 256

/**
 * Sessions that were moved off a pane, kept by the pane they left.
 *
 * Why: not every agent event names the session it belongs to. A finished turn
 * arrives as a pane-level notification, so without this the status row moves to
 * the terminal the agent is really in and the unread it leaves behind stays on
 * the one it was never in.
 */
const movedSessionsBySourcePaneKey = new Map<string, Map<string, string>>()

export function bindAgentSessionPane(
  sessionId: string,
  paneKey: string,
  fromPaneKey?: string
): boolean {
  if (!sessionId || !parsePaneKey(paneKey)) {
    return false
  }
  for (const moved of movedSessionsBySourcePaneKey.values()) {
    // Why: a session moved twice must not still count against the pane it left first.
    moved.delete(sessionId)
  }
  if (fromPaneKey && fromPaneKey !== paneKey) {
    const moved = movedSessionsBySourcePaneKey.get(fromPaneKey) ?? new Map<string, string>()
    moved.set(sessionId, paneKey)
    movedSessionsBySourcePaneKey.set(fromPaneKey, moved)
  }
  // Why delete first: re-insert so a refreshed binding is not the eviction victim.
  ownerPaneKeyBySessionId.delete(sessionId)
  ownerPaneKeyBySessionId.set(sessionId, paneKey)
  while (ownerPaneKeyBySessionId.size > MAX_AGENT_SESSION_PANE_BINDINGS) {
    const oldestSessionId = ownerPaneKeyBySessionId.keys().next().value
    if (!oldestSessionId) {
      break
    }
    ownerPaneKeyBySessionId.delete(oldestSessionId)
  }
  return true
}

/**
 * Take the bindings remembered from earlier runs.
 *
 * Why on boot and not per event: a hook keeps reporting the pane its process was
 * born with for as long as that agent runs, which outlasts one Orca run. Without
 * this every restart put a corrected agent back on the terminal it was never in.
 */
export function hydrateAgentSessionPaneBindings(bindings: Record<string, string>): void {
  for (const [sessionId, paneKey] of Object.entries(bindings)) {
    if (!ownerPaneKeyBySessionId.has(sessionId)) {
      bindAgentSessionPane(sessionId, paneKey)
    }
  }
}

/**
 * The pane that owns this status. A hand-made session binding wins over the
 * reported pane key; pane aliases still apply on top, so a corrected session
 * follows its terminal through a later detach.
 */
export function resolveAgentPaneAuthorityKey(paneKey: string, sessionId?: string): string {
  const boundPaneKey = sessionId ? ownerPaneKeyBySessionId.get(sessionId) : undefined
  const startPaneKey = boundPaneKey ?? paneKey
  return aliasesByPhysicalPaneKey.get(startPaneKey)?.ownerPaneKey ?? startPaneKey
}

/**
 * Where a pane's agent events belong after its moved session left it.
 *
 * Null when the pane gave up no session, or gave up more than one - an event that
 * does not name its session cannot be attributed then, and guessing would drop it
 * on a terminal it was never in. Callers must also check the pane is not holding a
 * live agent of its own, which owns the event if so.
 */
export function resolveMovedAgentPaneKey(paneKey: string): string | null {
  const moved = movedSessionsBySourcePaneKey.get(paneKey)
  if (!moved || moved.size !== 1) {
    return null
  }
  const [sessionId] = [...moved.keys()]
  return sessionId ? resolveAgentPaneAuthorityKey(paneKey, sessionId) : null
}

export function transferAgentPaneAuthorityAlias(args: {
  fromPaneKey: string
  toPaneKey: string
  ptyId?: string | null
}): AgentPaneAuthorityTransfer | null {
  if (!parsePaneKey(args.fromPaneKey) || !parsePaneKey(args.toPaneKey)) {
    return null
  }
  const previousOwnerPaneKey = resolveAgentPaneAuthorityKey(args.fromPaneKey)
  let physicalPaneKey = args.fromPaneKey
  for (const [candidatePhysicalPaneKey, alias] of aliasesByPhysicalPaneKey) {
    if (
      alias.ownerPaneKey === previousOwnerPaneKey &&
      (!args.ptyId || !alias.ptyId || alias.ptyId === args.ptyId)
    ) {
      physicalPaneKey = candidatePhysicalPaneKey
      break
    }
  }
  const ptyId = args.ptyId?.trim() || aliasesByPhysicalPaneKey.get(physicalPaneKey)?.ptyId || null
  // Why: every key that resolved to the old owner must follow the move in one hop,
  // or a chained detach leaves an intermediate key routing to a dead pane.
  const formerOwnerPaneKeys = new Set([physicalPaneKey, previousOwnerPaneKey])
  for (const [candidatePhysicalPaneKey, alias] of aliasesByPhysicalPaneKey) {
    if (alias.ownerPaneKey === previousOwnerPaneKey) {
      formerOwnerPaneKeys.add(candidatePhysicalPaneKey)
    }
  }
  for (const formerOwnerPaneKey of formerOwnerPaneKeys) {
    if (formerOwnerPaneKey === args.toPaneKey) {
      // Why: the pane came back to this key, so it owns itself again.
      aliasesByPhysicalPaneKey.delete(formerOwnerPaneKey)
      continue
    }
    // Why: re-insert so an alias refreshed by a later move is not the eviction victim.
    aliasesByPhysicalPaneKey.delete(formerOwnerPaneKey)
    aliasesByPhysicalPaneKey.set(formerOwnerPaneKey, {
      ownerPaneKey: args.toPaneKey,
      ptyId
    })
  }
  evictOldestAgentPaneAuthorityAliases()
  return {
    physicalPaneKey,
    previousOwnerPaneKey,
    ownerPaneKey: args.toPaneKey,
    ptyId
  }
}

export function retireAgentPaneAuthorityAliases(paneKey: string): string[] {
  const ownerPaneKey = resolveAgentPaneAuthorityKey(paneKey)
  const retiredPaneKeys = new Set([paneKey, ownerPaneKey])
  for (const [physicalPaneKey, alias] of aliasesByPhysicalPaneKey) {
    if (physicalPaneKey === paneKey || alias.ownerPaneKey === ownerPaneKey) {
      aliasesByPhysicalPaneKey.delete(physicalPaneKey)
      retiredPaneKeys.add(physicalPaneKey)
      retiredPaneKeys.add(alias.ownerPaneKey)
    }
  }
  return [...retiredPaneKeys]
}

export function retireAgentPaneAuthorityAliasesByOwnerTab(tabId: string): string[] {
  const ownerPrefix = `${tabId}:`
  const retiredPaneKeys = new Set<string>()
  for (const [physicalPaneKey, alias] of aliasesByPhysicalPaneKey) {
    if (!alias.ownerPaneKey.startsWith(ownerPrefix)) {
      continue
    }
    aliasesByPhysicalPaneKey.delete(physicalPaneKey)
    retiredPaneKeys.add(physicalPaneKey)
    retiredPaneKeys.add(alias.ownerPaneKey)
  }
  return [...retiredPaneKeys]
}

/** Drop aliases whose physical or owner pane belongs to a purged tab. */
export function forgetAgentPaneAuthorityAliasesByTabIds(tabIds: Iterable<string>): void {
  const doomedTabIds = tabIds instanceof Set ? tabIds : new Set(tabIds)
  if (doomedTabIds.size === 0) {
    return
  }
  for (const [physicalPaneKey, alias] of aliasesByPhysicalPaneKey) {
    const physicalTabId = parsePaneKey(physicalPaneKey)?.tabId
    const ownerTabId = parsePaneKey(alias.ownerPaneKey)?.tabId
    if (
      (physicalTabId && doomedTabIds.has(physicalTabId)) ||
      (ownerTabId && doomedTabIds.has(ownerTabId))
    ) {
      aliasesByPhysicalPaneKey.delete(physicalPaneKey)
    }
  }
  for (const [sessionId, boundPaneKey] of ownerPaneKeyBySessionId) {
    const boundTabId = parsePaneKey(boundPaneKey)?.tabId
    if (boundTabId && doomedTabIds.has(boundTabId)) {
      ownerPaneKeyBySessionId.delete(sessionId)
    }
  }
  for (const [sourcePaneKey, moved] of movedSessionsBySourcePaneKey) {
    const sourceTabId = parsePaneKey(sourcePaneKey)?.tabId
    if (sourceTabId && doomedTabIds.has(sourceTabId)) {
      movedSessionsBySourcePaneKey.delete(sourcePaneKey)
      continue
    }
    for (const [sessionId, targetPaneKey] of moved) {
      const targetTabId = parsePaneKey(targetPaneKey)?.tabId
      if (targetTabId && doomedTabIds.has(targetTabId)) {
        moved.delete(sessionId)
      }
    }
    if (moved.size === 0) {
      movedSessionsBySourcePaneKey.delete(sourcePaneKey)
    }
  }
}

export function countAgentPaneAuthorityAliasesForTests(): number {
  return aliasesByPhysicalPaneKey.size
}

export function resetAgentPaneAuthorityAliasesForTests(): void {
  aliasesByPhysicalPaneKey.clear()
  ownerPaneKeyBySessionId.clear()
  movedSessionsBySourcePaneKey.clear()
}
