import { isBackgroundJobRowKey } from '../../../shared/background-job-row-key'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'

type SleepingRecords = NonNullable<WorkspaceSessionState['sleepingAgentSessionsByPaneKey']>

export function buildSleepingAgentSessionData(snapshot: {
  sleepingAgentSessionsByPaneKey?: WorkspaceSessionState['sleepingAgentSessionsByPaneKey']
}): Pick<WorkspaceSessionState, 'sleepingAgentSessionsByPaneKey'> {
  const records = snapshot.sleepingAgentSessionsByPaneKey
  return records && Object.keys(records).length > 0
    ? { sleepingAgentSessionsByPaneKey: records }
    : {}
}

/**
 * The records minus those made from a background job's own row.
 *
 * Why on the way in: a session saved before the capture learned to skip such rows
 * still holds them, and each one would become a fresh tab running
 * `claude --resume <job>` at start - once per remembered job, every start.
 */
export function withoutBackgroundJobRowRecords(records: SleepingRecords): SleepingRecords {
  let kept: SleepingRecords | null = null
  for (const [paneKey, record] of Object.entries(records)) {
    if (!isBackgroundJobRowKey(paneKey, record.providerSession?.id)) {
      continue
    }
    kept ??= { ...records }
    delete kept[paneKey]
  }
  return kept ?? records
}
