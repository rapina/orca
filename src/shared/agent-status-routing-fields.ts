import type { AgentProcessHost, AgentStatusIpcPayload } from './agent-status-types'

/**
 * The fields that decide which terminal a status belongs to.
 *
 * Why a helper and not three spreads at each site: the hook server's snapshot
 * builder and main's live push each assemble their own payload, and the live one
 * carried none of these. Every routing decision that depends on them - a job's own
 * row, the terminal its prompt was typed into - therefore ran only on the snapshot
 * after a restart, and never on the events that arrive while a person works
 * (measured: new sessions kept landing on a row of their own, and the claim did
 * not even reach its diagnostic log). One place to add the next such field.
 */
export function agentStatusRoutingFields(entry: {
  processHost?: AgentProcessHost
  cwd?: string
  hookEventName?: string
}): Pick<AgentStatusIpcPayload, 'processHost' | 'cwd' | 'promptSubmitted'> {
  return {
    ...(entry.processHost ? { processHost: entry.processHost } : {}),
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    // Why the event name: this is the moment a keystroke in a terminal can claim
    // the job that reports the prompt, and nothing else in the payload says so.
    ...(entry.hookEventName === 'UserPromptSubmit' ? { promptSubmitted: true } : {})
  }
}
