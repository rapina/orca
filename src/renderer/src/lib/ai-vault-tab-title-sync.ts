import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../../shared/ai-vault-session-title'
import type { AppState } from '@/store/types'
import {
  collectAiVaultTitleRequests,
  type AiVaultTitleRequest
} from './ai-vault-tab-title-requests'
import { settleAiVaultTitleRequestBatches } from './ai-vault-tab-title-batches'
import { aiVaultTitleSyncInputsChanged } from './ai-vault-tab-title-sync-inputs'

const MISSING_TITLE_REFRESH_MS = 20_000
const LIVE_TITLE_REFRESH_MS = 5 * 60_000

function requestIdentity(request: AiVaultTitleRequest): string {
  return `${request.executionHostId}\0${request.agent}\0${request.providerSession.id}`
}

type SyncDependencies = {
  getState: () => AppState
  resolveSessionTitles: (args: AiVaultSessionTitlesArgs) => Promise<AiVaultSessionTitlesResult>
  subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void
  onPaneTitles?: (
    titles: ReadonlyMap<string, { request: AiVaultTitleRequest; title: string }>
  ) => void
  scheduleReconcile?: (callback: () => void) => () => void
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number
  clearTimer?: (timer: ReturnType<typeof setTimeout> | number) => void
}

function scheduleMicrotask(callback: () => void): () => void {
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) {
      callback()
    }
  })
  return () => {
    cancelled = true
  }
}

function nextLiveRefreshDelay(
  state: AppState,
  requests: AiVaultTitleRequest[],
  paneTitles: ReadonlyMap<string, { request: AiVaultTitleRequest; title: string }>
): number | null {
  const liveRequests = requests.filter((request) => request.refresh)
  if (liveRequests.length === 0) {
    return null
  }
  const tabsById = new Map(
    Object.values(state.tabsByWorktree)
      .flat()
      .map((tab) => [tab.id, tab] as const)
  )
  const hasMissingTitle = liveRequests.some((request) => {
    if (request.paneKey) {
      const stored = paneTitles.get(request.paneKey)
      return !stored || requestIdentity(stored.request) !== requestIdentity(request)
    }
    const stored = tabsById.get(request.tabId)?.aiVaultTitle
    return (
      stored?.agent !== request.agent ||
      stored.sessionId !== request.providerSession.id ||
      !stored.title.trim()
    )
  })
  return hasMissingTitle ? MISSING_TITLE_REFRESH_MS : LIVE_TITLE_REFRESH_MS
}

export function startAiVaultTabTitleSync(dependencies: SyncDependencies): () => void {
  const setTimer = dependencies.setTimer ?? setTimeout
  const clearTimer =
    dependencies.clearTimer ??
    ((timer: ReturnType<typeof setTimeout> | number) =>
      clearTimeout(timer as ReturnType<typeof setTimeout>))
  let refreshTimer: ReturnType<typeof setTimeout> | number | null = null
  let scanInFlight = false
  let scanAgain = false
  let scheduled = false
  let cancelScheduled: (() => void) | null = null
  let stopped = false
  let writing = false
  const paneTitles = new Map<string, { request: AiVaultTitleRequest; title: string }>()
  const collectRequests = (state: AppState): AiVaultTitleRequest[] =>
    collectAiVaultTitleRequests(state, Boolean(dependencies.onPaneTitles))

  const writeTitle = (request: AiVaultTitleRequest, title: string | null): void => {
    if (request.paneKey) {
      if (title) {
        paneTitles.set(request.paneKey, { request, title })
      } else {
        paneTitles.delete(request.paneKey)
      }
      const selected = collectAiVaultTitleRequests(dependencies.getState()).find(
        (candidate) => candidate.tabId === request.tabId
      )
      if (!selected || requestIdentity(selected) !== requestIdentity(request)) {
        return
      }
    }
    writing = true
    try {
      dependencies
        .getState()
        .setAiVaultTabTitle(
          request.tabId,
          title ? { agent: request.agent, sessionId: request.providerSession.id, title } : null
        )
    } finally {
      writing = false
    }
  }

  const resolveBatch = async (requests: AiVaultTitleRequest[]): Promise<void> => {
    const first = requests[0]!
    const result = await dependencies.resolveSessionTitles({
      executionHostScope: first.executionHostId,
      requests: requests.map((request) => ({
        agent: request.agent,
        sessionId: request.providerSession.id,
        ...(request.providerSession.transcriptPath
          ? { transcriptPath: request.providerSession.transcriptPath }
          : {})
      }))
    })
    if (stopped) {
      return
    }
    const titleByIdentity = new Map<string, string>()
    for (const title of result.titles) {
      if (title.title.trim()) {
        titleByIdentity.set(
          `${first.executionHostId}\0${title.agent}\0${title.sessionId}`,
          title.title.trim()
        )
      }
    }
    const currentByTarget = new Map(
      collectRequests(dependencies.getState()).map((request) => [
        request.paneKey ?? request.tabId,
        request
      ])
    )
    for (const request of requests) {
      const current = currentByTarget.get(request.paneKey ?? request.tabId)
      const title = titleByIdentity.get(requestIdentity(request))
      if (current && requestIdentity(current) === requestIdentity(request) && title) {
        writeTitle(request, title)
      }
    }
    dependencies.onPaneTitles?.(paneTitles)
  }

  const reconcile = async (): Promise<void> => {
    scheduled = false
    if (stopped) {
      return
    }
    if (scanInFlight) {
      scanAgain = true
      return
    }
    if (refreshTimer !== null) {
      clearTimer(refreshTimer)
      refreshTimer = null
    }

    const state = dependencies.getState()
    const tabsById = new Map(
      Object.values(state.tabsByWorktree)
        .flat()
        .map((tab) => [tab.id, tab] as const)
    )
    const requests = collectRequests(state)
    const currentByPane = new Map(requests.map((request) => [request.paneKey, request]))
    for (const [paneKey, stored] of paneTitles) {
      const current = currentByPane.get(paneKey)
      if (!current || requestIdentity(current) !== requestIdentity(stored.request)) {
        paneTitles.delete(paneKey)
      }
    }
    dependencies.onPaneTitles?.(paneTitles)
    if (dependencies.onPaneTitles) {
      for (const request of collectAiVaultTitleRequests(state)) {
        const stored = tabsById.get(request.tabId)?.aiVaultTitle
        if (
          stored &&
          (stored.agent !== request.agent || stored.sessionId !== request.providerSession.id)
        ) {
          writeTitle(request, null)
        }
      }
    }
    const requestsToScan = requests.filter((request) => {
      if (request.paneKey) {
        return request.refresh || !paneTitles.has(request.paneKey)
      }
      const stored = tabsById.get(request.tabId)?.aiVaultTitle
      const identityMatches =
        stored?.agent === request.agent && stored.sessionId === request.providerSession.id
      if (stored && !identityMatches) {
        writeTitle(request, null)
      }
      return request.refresh || !identityMatches || !stored?.title.trim()
    })

    if (requestsToScan.length > 0) {
      scanInFlight = true
      await settleAiVaultTitleRequestBatches(requestsToScan, resolveBatch)
      scanInFlight = false
    }

    if (scanAgain) {
      scanAgain = false
      schedule()
    } else if (!stopped) {
      const currentState = dependencies.getState()
      const currentRequests = collectRequests(currentState)
      const refreshDelay = nextLiveRefreshDelay(currentState, currentRequests, paneTitles)
      if (refreshDelay !== null) {
        refreshTimer = setTimer(schedule, refreshDelay)
      }
    }
  }

  function schedule(): void {
    if (scheduled || stopped) {
      return
    }
    scheduled = true
    cancelScheduled = (dependencies.scheduleReconcile ?? scheduleMicrotask)(() => {
      cancelScheduled = null
      void reconcile()
    })
  }

  const unsubscribe = dependencies.subscribe((state, previous) => {
    if (!writing && aiVaultTitleSyncInputsChanged(state, previous)) {
      schedule()
    }
  })
  schedule()

  return () => {
    stopped = true
    paneTitles.clear()
    dependencies.onPaneTitles?.(paneTitles)
    unsubscribe()
    cancelScheduled?.()
    cancelScheduled = null
    if (refreshTimer !== null) {
      clearTimer(refreshTimer)
    }
  }
}
