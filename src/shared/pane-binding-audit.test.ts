import { describe, expect, it } from 'vitest'
import { auditPaneBindings } from './pane-binding-audit'

/** Why from a char code: a literal escape byte in source is unreadable in a diff. */
const ESC = String.fromCharCode(27)
const SESSION = '195d9e30-b33a-49cc-ad47-76f5fc3b1489'
const OTHER_SESSION = '8cd64b19-47b1-4836-bb35-c6db195a7a20'

/** Two turns of one session. The audit needs both: one turn is what a job list
 *  shows for every session it lists, so it cannot tell them apart. */
const TURN_ONE = '규약대로 worktree 생성 계획부터 조회하겠습니다'
const TURN_TWO = '조건 셋을 규칙에 넣겠습니다. 먼저 계약부터 잡고 시작할게요.'

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

  it('lets the terminal carrying the turns outweigh scattered id mentions', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [TURN_ONE, TURN_TWO] }],
      [
        { paneKey: 'tab1:leafA', tail: 'nothing\n' },
        { paneKey: 'tab2:leafB', tail: tailWith(SESSION, 4) },
        { paneKey: 'tab3:leafC', tail: `${TURN_ONE}\n${TURN_TWO}\n` }
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
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [TURN_ONE, TURN_TWO] }],
      [
        { paneKey: 'tab1:leafA', tail: 'PS D:\\Workspace> \n' },
        { paneKey: 'tab2:leafB', tail: 'unrelated build output\n' },
        {
          paneKey: 'tab3:leafC',
          tail: `${ESC}[38;5;250m${TURN_ONE}${ESC}[0m\n${TURN_TWO}\n`
        }
      ]
    )

    expect(findings[0]?.candidatePaneKey).toBe('tab3:leafC')
  })

  // Why the finding carries it: the audit picks a terminal by finding this
  // session's own words there, and a wrong pick is only recognisable by seeing
  // which words those were - so the suggestion has to show them.
  it('reports the text that decided it', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [TURN_ONE, TURN_TWO] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab3:leafC', tail: `${TURN_ONE}\n${TURN_TWO}\n` }
      ]
    )

    expect(findings[0]?.matchedText).toBeTruthy()
    expect(TURN_ONE.replace(/\s+/g, '')).toContain(findings[0]?.matchedText)
  })

  // Why this rule exists: a terminal showing a job list carries one summary line
  // for every session it lists, so a single matching turn is exactly what a list
  // of other people's sessions looks like. Measured: one session's newest turn
  // appeared in six terminals at once and only one of them was running it.
  it('stays quiet when no terminal carries more than one turn', () => {
    const findings = auditPaneBindings(
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [TURN_ONE, TURN_TWO] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab2:leafB', tail: `${TURN_ONE}\n${TURN_ONE}\n${TURN_ONE}\n` },
        { paneKey: 'tab3:leafC', tail: `${TURN_ONE}\n` },
        { paneKey: 'tab4:leafD', tail: `${TURN_ONE}\n` }
      ]
    )

    expect(findings).toEqual([])
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
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence: [spoken, TURN_TWO] }],
      [
        { paneKey: 'tab1:leafA', tail: 'idle shell\n' },
        { paneKey: 'tab3:leafC', tail: `${rendered}${TURN_TWO}\n` }
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
    const findings = auditPaneBindings(
      [{ paneKey: 'tab3:leafC', sessionId: SESSION, evidence: [TURN_ONE, TURN_TWO] }],
      [
        { paneKey: 'tab3:leafC', tail: `${TURN_ONE}\n` },
        { paneKey: 'tab1:leafA', tail: `${TURN_ONE}\n${TURN_TWO}\n` }
      ]
    )

    expect(findings).toEqual([])
  })
})
