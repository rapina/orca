import { beforeEach, describe, expect, it } from 'vitest'
import {
  anotherSessionTookSubmit,
  notePromptSubmitRoutedTo,
  noteTerminalInput,
  noteTerminalPromptSubmitted,
  resetPaneSubmitKeystrokesForTests,
  terminalSubmitsBetween
} from './pane-submit-keystrokes'

function panes(from: number, to: number): string[] {
  return terminalSubmitsBetween(from, to).map((submit) => submit.paneKey)
}

describe('pane submit keystrokes', () => {
  beforeEach(() => {
    resetPaneSubmitKeystrokesForTests()
  })

  it('remembers a lone Enter and ignores typed text and pastes', () => {
    noteTerminalInput('tab:a', 'h', 100)
    noteTerminalInput('tab:a', 'line one\rline two\r', 200)
    noteTerminalInput('tab:a', '\r', 300)
    noteTerminalInput('tab:b', '\x1b[13u', 400)
    expect(panes(0, 250)).toEqual([])
    expect(panes(250, 450)).toEqual(['tab:a', 'tab:b'])
  })

  it('keeps only the latest Enter per terminal', () => {
    noteTerminalInput('tab:a', '\r', 100)
    noteTerminalInput('tab:a', '\r', 900)
    expect(panes(0, 500)).toEqual([])
    expect(panes(500, 1000)).toEqual(['tab:a'])
  })

  it('forgets the terminals it heard from longest ago past the cap', () => {
    for (let index = 0; index < 300; index += 1) {
      noteTerminalInput(`tab:${index}`, '\r', index)
    }
    expect(panes(0, 43)).toEqual([])
    expect(panes(44, 44)).toEqual(['tab:44'])
  })

  it('keeps the line Enter sent, as the person saw it', () => {
    noteTerminalInput('tab:a', 'quest_banner ', 1)
    noteTerminalInput('tab:a', '테스트가 ', 2)
    noteTerminalInput('tab:a', '\x1b[D\x1b[C', 3)
    noteTerminalInput('tab:a', '실패한다x', 4)
    noteTerminalInput('tab:a', '\x7f', 5)
    noteTerminalInput('tab:a', '\x1b[200~는데\n확인해줘\x1b[201~', 6)
    noteTerminalInput('tab:a', '\r', 7)

    expect(terminalSubmitsBetween(7, 7)).toEqual([
      { paneKey: 'tab:a', at: 7, text: 'quest_banner 테스트가 실패한다는데 확인해줘' }
    ])
  })

  it('lets an empty Enter after an IME commit keep the text the first one sent', () => {
    noteTerminalInput('tab:a', '응 그렇게 해', 1)
    noteTerminalInput('tab:a', '\r', 2)
    noteTerminalInput('tab:a', '\r', 3)

    expect(terminalSubmitsBetween(3, 3)).toEqual([
      { paneKey: 'tab:a', at: 3, text: '응 그렇게 해' }
    ])
  })

  it("takes Orca's own composer as a submit, since it never reaches xterm", () => {
    noteTerminalPromptSubmitted('tab:a', '계속', 100)

    expect(terminalSubmitsBetween(100, 100)).toEqual([{ paneKey: 'tab:a', at: 100, text: '계속' }])
  })

  // Why measured against the submit: a person working in a terminal has a session
  // reporting prompts there all the time, and the next Enter is still theirs to give.
  it("knows when another session's prompt already took a terminal's Enter", () => {
    notePromptSubmitRoutedTo('tab:a', 'session-1', 500)
    expect(anotherSessionTookSubmit('tab:a', 'session-2', 400)).toBe(true)
    expect(anotherSessionTookSubmit('tab:a', 'session-1', 400)).toBe(false)
    expect(anotherSessionTookSubmit('tab:a', 'session-2', 600)).toBe(false)
    expect(anotherSessionTookSubmit('tab:b', 'session-2', 0)).toBe(false)
  })
})
