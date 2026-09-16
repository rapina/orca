import { create } from 'zustand'
import type { AiVaultSessionTitle } from '../../../shared/ai-vault-session-title'
import type { AiVaultTitleRequest } from './ai-vault-tab-title-requests'

export type PaneSessionTitles = Readonly<Record<string, AiVaultSessionTitle>>

export const usePaneSessionTitles = create<{ titles: PaneSessionTitles }>(() => ({ titles: {} }))

export function publishPaneSessionTitles(
  entries: ReadonlyMap<string, { request: AiVaultTitleRequest; title: string }>
): void {
  const titles: Record<string, AiVaultSessionTitle> = {}
  for (const [paneKey, { request, title }] of entries) {
    titles[paneKey] = { agent: request.agent, sessionId: request.providerSession.id, title }
  }
  const previous = usePaneSessionTitles.getState().titles
  if (
    Object.keys(previous).length === Object.keys(titles).length &&
    Object.entries(titles).every(
      ([key, value]) =>
        previous[key]?.agent === value.agent &&
        previous[key]?.sessionId === value.sessionId &&
        previous[key]?.title === value.title
    )
  ) {
    return
  }
  usePaneSessionTitles.setState({ titles })
}
