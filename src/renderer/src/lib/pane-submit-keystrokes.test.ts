import { beforeEach, describe, expect, it } from 'vitest'
import {
  anotherSessionSubmittedInto,
  notePromptSubmitRoutedTo,
  noteTerminalSubmitKeystroke,
  panesThatSubmittedBetween,
  resetPaneSubmitKeystrokesForTests
} from './pane-submit-keystrokes'

describe('pane submit keystrokes', () => {
  beforeEach(() => {
    resetPaneSubmitKeystrokesForTests()
  })

  it('remembers a lone Enter and ignores typed text and pastes', () => {
    noteTerminalSubmitKeystroke('tab:a', 'h', 100)
    noteTerminalSubmitKeystroke('tab:a', 'line one\rline two\r', 200)
    noteTerminalSubmitKeystroke('tab:a', '\r', 300)
    noteTerminalSubmitKeystroke('tab:b', '\x1b[13u', 400)
    expect(panesThatSubmittedBetween(0, 250)).toEqual([])
    expect(panesThatSubmittedBetween(250, 450)).toEqual(['tab:a', 'tab:b'])
  })

  it('keeps only the latest Enter per terminal', () => {
    noteTerminalSubmitKeystroke('tab:a', '\r', 100)
    noteTerminalSubmitKeystroke('tab:a', '\r', 900)
    expect(panesThatSubmittedBetween(0, 500)).toEqual([])
    expect(panesThatSubmittedBetween(500, 1000)).toEqual(['tab:a'])
  })

  it('forgets the terminals it heard from longest ago past the cap', () => {
    for (let index = 0; index < 300; index += 1) {
      noteTerminalSubmitKeystroke(`tab:${index}`, '\r', index)
    }
    expect(panesThatSubmittedBetween(0, 43)).toEqual([])
    expect(panesThatSubmittedBetween(44, 44)).toEqual(['tab:44'])
  })

  it("knows when another session's prompt already took a terminal's Enter", () => {
    notePromptSubmitRoutedTo('tab:a', 'session-1', 500)
    expect(anotherSessionSubmittedInto('tab:a', 'session-2', 400)).toBe(true)
    expect(anotherSessionSubmittedInto('tab:a', 'session-1', 400)).toBe(false)
    expect(anotherSessionSubmittedInto('tab:a', 'session-2', 600)).toBe(false)
    expect(anotherSessionSubmittedInto('tab:b', 'session-2', 0)).toBe(false)
  })
})
