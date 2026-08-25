import { describe, expect, it } from 'vitest'
import { toAppSshPtyId } from '../../../../shared/ssh-pty-id'
import {
  isLinkRoutingModifier,
  terminalRowLinkHint,
  terminalRowLinkSourceOwner
} from './terminal-row-link-open'

describe('terminalRowLinkSourceOwner', () => {
  it('treats a row without a pty, and a plain pty, as local', () => {
    expect(terminalRowLinkSourceOwner(undefined)).toEqual({ kind: 'local' })
    expect(terminalRowLinkSourceOwner('pty-12')).toEqual({ kind: 'local' })
  })

  // Why: an SSH pane's link must not open in Orca's local browser, exactly as
  // the terminal itself refuses to.
  it('names the SSH connection of a remote pane', () => {
    expect(terminalRowLinkSourceOwner(toAppSshPtyId('conn-1', 'pty-9'))).toEqual({
      kind: 'ssh',
      connectionId: 'conn-1'
    })
  })
})

describe('isLinkRoutingModifier', () => {
  it('is Shift+Cmd on Mac and Shift+Ctrl elsewhere', () => {
    expect(isLinkRoutingModifier({ shiftKey: true, metaKey: true, ctrlKey: false }, true)).toBe(
      true
    )
    expect(isLinkRoutingModifier({ shiftKey: true, metaKey: false, ctrlKey: true }, true)).toBe(
      false
    )
    expect(isLinkRoutingModifier({ shiftKey: true, metaKey: false, ctrlKey: true }, false)).toBe(
      true
    )
    expect(isLinkRoutingModifier({ shiftKey: false, metaKey: true, ctrlKey: true }, false)).toBe(
      false
    )
  })
})

describe('terminalRowLinkHint', () => {
  // Why: with inversion on and links going to the system browser by default, the
  // modifier opens in Orca — the hint has to say so, as the terminal's does.
  it('names the destination the modifier reaches', () => {
    expect(terminalRowLinkHint({ openLinksInApp: false }, { kind: 'local' })).toMatch(
      /system browser/
    )
    expect(
      terminalRowLinkHint(
        { openLinksInApp: false, openLinksInAppModifierInverts: true },
        { kind: 'local' }
      )
    ).toMatch(/open in Orca/)
    expect(
      terminalRowLinkHint(
        { openLinksInApp: false, openLinksInAppModifierInverts: true },
        { kind: 'ssh', connectionId: 'c' }
      )
    ).toMatch(/system browser/)
  })
})
