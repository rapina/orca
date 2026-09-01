import { useCallback, useRef } from 'react'
import { useOptionalLinkRoutingPreferenceDialog } from '@/components/link-routing-preference-dialog'
import { resolveTerminalHttpLinkSourceOwner } from '@/components/terminal-pane/terminal-http-link-source-owner'
import {
  getTerminalUrlOrcaBrowserHint,
  getTerminalUrlSystemBrowserHint,
  isMacPlatform
} from '@/components/terminal-pane/terminal-link-open-hints'
import { openHttpLink, type HttpLinkSourceOwner } from '@/lib/http-link-routing'
import { useAppStore } from '@/store'

/**
 * How a link on a terminal's list row opens.
 *
 * Why the terminal's rules and not `shell.openUrl`: the same pull request, clicked
 * in the terminal itself, follows Link Routing — the in-app browser or the system
 * one by setting, the other one on Shift+modifier, and a one-time choice on the
 * first click. A row that always went to the system browser was the one link in
 * Orca that ignored what the user had picked.
 */

export type TerminalRowLinkDestination = 'orca' | 'system'

export type TerminalRowLinkOpenOptions = {
  /** Shift+Cmd/Ctrl was held; Link Routing decides which way it flips. */
  modifierHeld?: boolean
  /** A destination named outright, from the row's own menu. */
  destination?: TerminalRowLinkDestination
}

/** Who owns the terminal a link came from — a remote pane cannot open in Orca's local browser. */
export function terminalRowLinkSourceOwner(ptyId: string | undefined): HttpLinkSourceOwner {
  return ptyId ? resolveTerminalHttpLinkSourceOwner({ getPtyId: () => ptyId }) : { kind: 'local' }
}

export function isLinkRoutingModifier(
  event: Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>,
  isMac: boolean = isMacPlatform()
): boolean {
  return event.shiftKey && (isMac ? event.metaKey : event.ctrlKey)
}

/** What the modifier does here, in the terminal's own words. */
export function terminalRowLinkHint(
  settings:
    | { openLinksInApp?: boolean; openLinksInAppModifierInverts?: boolean }
    | null
    | undefined,
  sourceOwner: HttpLinkSourceOwner
): string {
  const invertsToOrca =
    settings?.openLinksInAppModifierInverts === true &&
    settings?.openLinksInApp !== true &&
    sourceOwner.kind === 'local'
  return invertsToOrca ? getTerminalUrlOrcaBrowserHint() : getTerminalUrlSystemBrowserHint()
}

export function useTerminalRowLinkOpener(): (
  url: string,
  ptyId: string | undefined,
  options?: TerminalRowLinkOpenOptions
) => void {
  const requestLinkRoutingPreference = useOptionalLinkRoutingPreferenceDialog()
  const updateSettings = useAppStore((state) => state.updateSettings)
  const pendingPreference = useRef<Promise<boolean> | null>(null)

  return useCallback(
    (url, ptyId, options = {}) => {
      const state = useAppStore.getState()
      const worktreeId = state.activeWorktreeId
      const sourceOwner = terminalRowLinkSourceOwner(ptyId)
      const base = { allowRuntimeInApp: true, worktreeId, sourceOwner }
      if (options.destination) {
        openHttpLink(url, {
          ...base,
          forceInApp: options.destination === 'orca',
          forceSystemBrowser: options.destination === 'system'
        })
        return
      }
      if (options.modifierHeld) {
        openHttpLink(url, { ...base, modifierHeld: true })
        return
      }
      const settings = state.settings
      // Why the prompt only for a local source: a remote pane follows the saved
      // preference and never asks, exactly as the terminal does.
      if (
        !requestLinkRoutingPreference ||
        sourceOwner.kind !== 'local' ||
        !settings ||
        settings.openLinksInAppPreferencePrompted === true
      ) {
        openHttpLink(url, base)
        return
      }
      const decision =
        pendingPreference.current ??
        (async () => {
          const openInOrca = await requestLinkRoutingPreference({
            openLinksInAppDefault: settings.openLinksInApp === true,
            url
          })
          await updateSettings({
            openLinksInApp: openInOrca,
            openLinksInAppPreferencePrompted: true
          })
          return openInOrca
        })()
      pendingPreference.current = decision
      void decision
        .then((openInOrca) => {
          openHttpLink(url, { ...base, forceSystemBrowser: !openInOrca })
        })
        .catch(() => {
          openHttpLink(url, { ...base, forceSystemBrowser: true })
        })
        .finally(() => {
          pendingPreference.current = null
        })
    },
    [requestLinkRoutingPreference, updateSettings]
  )
}
