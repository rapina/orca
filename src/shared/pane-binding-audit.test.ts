import { describe, expect, it } from 'vitest'
import { auditPaneBindings } from './pane-binding-audit'

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
      [{ paneKey: 'tab1:leafA', sessionId: SESSION, evidence }],
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
})
