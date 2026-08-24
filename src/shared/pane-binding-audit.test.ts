import { describe, expect, it } from 'vitest'
import { auditPaneBindings } from './pane-binding-audit'

/** Why from a char code: a literal escape byte in source is unreadable in a diff. */
const ESC = String.fromCharCode(27)
const SESSION = '195d9e30-b33a-49cc-ad47-76f5fc3b1489'
const OTHER_SESSION = '8cd64b19-47b1-4836-bb35-c6db195a7a20'

function tailWith(id: string, times: number, extra = ''): string {
  return `${`session ${id} line\n`.repeat(times)}${extra}`
}

describe('auditPaneBindings', () => {
  it('reports a status whose session only shows up in another terminal', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION }],
      [
        { paneKey: 'tab1:leafA', tail: tailWith(OTHER_SESSION, 9) },
        { paneKey: 'tab3:leafC', tail: tailWith(SESSION, 40) }
      ]
    )

    expect(findings).toEqual([
      {
        paneKey: 'tab1:leafA',
        sessionId: SESSION,
        candidatePaneKey: 'tab3:leafC',
        candidateHits: 40,
        runnerUpHits: 0
      }
    ])
  })

  it('leaves a status alone when its own terminal shows the session', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab3:leafC', sessionId: SESSION }],
      [
        { paneKey: 'tab3:leafC', tail: tailWith(SESSION, 4) },
        { paneKey: 'tab1:leafA', tail: tailWith(SESSION, 40) }
      ]
    )

    expect(findings).toEqual([])
  })

  // Why: an id echoed while debugging must not be enough to move a status.
  it('ignores a stray mention in another terminal', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION }],
      [
        { paneKey: 'tab1:leafA', tail: 'no trace here\n' },
        { paneKey: 'tab3:leafC', tail: `grep ${SESSION}\n` }
      ]
    )

    expect(findings).toEqual([])
  })

  // Why: two terminals mentioning the session means the recording cannot say
  // which one runs it; moving on a coin flip is worse than leaving it.
  it('stays quiet when two terminals mention the session comparably', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION }],
      [
        { paneKey: 'tab1:leafA', tail: 'nothing\n' },
        { paneKey: 'tab2:leafB', tail: tailWith(SESSION, 8) },
        { paneKey: 'tab3:leafC', tail: tailWith(SESSION, 10) }
      ]
    )

    expect(findings).toEqual([])
  })

  it('lets a distinctive turn line outweigh scattered id mentions', () => {
    const evidence = '정리(#653)가 병합되면 이어서 하겠습니다. 계획 문서에 적어 뒀습니다.'
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [evidence] }],
      [
        { paneKey: 'tab1:leafA', tail: 'nothing\n' },
        { paneKey: 'tab2:leafB', tail: tailWith(SESSION, 4) },
        { paneKey: 'tab3:leafC', tail: `${evidence}\n` }
      ]
    )

    expect(findings[0]?.candidatePaneKey).toBe('tab3:leafC')
  })

  it('skips a status whose bound terminal has no recording', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION }],
      [{ paneKey: 'tab3:leafC', tail: tailWith(SESSION, 40) }]
    )

    expect(findings).toEqual([])
  })

  // Why this is the case that matters: agents never print their own session id, so
  // in a real recording it appears nowhere. Measured on live terminals, three of
  // five held no id at all - an id-only audit reports nothing and looks healthy.
  it('finds the terminal from turn text when the id appears nowhere', () => {
    const spoken = '규약대로 worktree 생성 계획부터 조회하겠습니다'
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [spoken] }],
      [
        { paneKey: 'tab1:leafA', tail: 'PS D:\\Workspace> \n' },
        { paneKey: 'tab2:leafB', tail: 'unrelated build output\n' },
        { paneKey: 'tab3:leafC', tail: `${ESC}[38;5;250m${spoken}${ESC}[0m\n` }
      ]
    )

    expect(findings[0]?.candidatePaneKey).toBe('tab3:leafC')
  })

  // Why: a TUI hard-wraps at the terminal width, and Korean has no space at the
  // wrap column, so the break lands mid-word and repaints carry colour codes.
  // Comparing raw text would miss the line that is plainly on screen.
  it('matches turn text the terminal wrapped and repainted', () => {
    // Why built by concatenation: the rows below are this exact text, split where
    // the terminal broke it, so the test cannot drift from what it claims to render.
    const rows = [
      '임시 목표가 무엇을 기다리고 무엇으로 바뀌는지를 데이터가 들게 했습니다. 착공 수는 ',
      '건설 제공자의 작업 목록에서 파생합니다. 도구를 주는 퀘스트 보상이 ',
      '가방이 아니라 도구 지급을 지나게 했습니다.'
    ]
    const spoken = rows.join('')
    const rendered = rows.map((row) => `${ESC}[2m│${ESC}[0m ${row}\r\n`).join('')
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [spoken] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab3:leafC', tail: rendered }
      ]
    )

    expect(findings[0]?.candidatePaneKey).toBe('tab3:leafC')
  })

  // Why: `lastAssistantMessage` is cleared when the next turn starts, which is
  // exactly when a `working` status is worth auditing. The other fields carry it.
  it('takes the first evidence that lands, not only the first offered', () => {
    const carried = '착공 목표의 요약 문구 두 키를 넣고 안내 문구를 맞췄습니다'
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: ['', 'ok', carried] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab3:leafC', tail: `${carried}\n` }
      ]
    )

    expect(findings[0]?.candidatePaneKey).toBe('tab3:leafC')
  })

  // Why: short evidence ("ok", a bare flag) matches half the terminals on screen.
  it('ignores evidence too short to identify a session', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: ['ok', 'done'] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab3:leafC', tail: 'ok\ndone\nok\ndone\nok\n' }
      ]
    )

    expect(findings).toEqual([])
  })

  // Why: the pane a status names is where the correction moves *from*; evidence
  // showing there means the binding is right and nothing should move.
  it('leaves a status alone when its own terminal carries the turn text', () => {
    const spoken = '규약대로 worktree 생성 계획부터 조회하겠습니다'
    const findings = auditPaneBindings(
      [{ paneKey: 'tab3:leafC', sessionId: SESSION, evidence: [spoken] }],
      [
        { paneKey: 'tab3:leafC', tail: `${spoken}\n` },
        { paneKey: 'tab1:leafA', tail: `${spoken}\n${spoken}\n` }
      ]
    )

    expect(findings).toEqual([])
  })
})
