// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTerminalWheelVisit, type TerminalViewportScroll } from './terminal-wheel-visit'

const AT_TOP = { scrollTop: 400, scrollHeight: 2000, clientHeight: 600 }
const MOVED = { scrollTop: 120, scrollHeight: 2000, clientHeight: 600 }

function buildPane(leafId: string): { pane: HTMLElement; inner: HTMLElement } {
  document.body.innerHTML = ''
  const pane = document.createElement('div')
  pane.className = 'pane'
  pane.setAttribute('data-leaf-id', leafId)
  const inner = document.createElement('span')
  pane.appendChild(inner)
  document.body.appendChild(pane)
  return { pane, inner }
}

function runDeps(viewports: (TerminalViewportScroll | null)[], onVisit: () => void) {
  let read = 0
  return {
    isTerminalLeaf: (leafId: string) => leafId.startsWith('term-'),
    readViewport: () => viewports[Math.min(read++, viewports.length - 1)] ?? null,
    schedule: (run: () => void) => run(),
    onVisit
  }
}

describe('handleTerminalWheelVisit', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('reports the terminal the wheel scrolled, resolved from a nested target', () => {
    const onVisit = vi.fn()
    const { inner } = buildPane('term-1')

    handleTerminalWheelVisit(inner, runDeps([AT_TOP, MOVED], onVisit))

    expect(onVisit).toHaveBeenCalledWith('term-1')
  })

  // Why: the whole point of the geometry check - a wheel that moved nothing must
  // leave the unread standing.
  it('reports nothing when the wheel did not move the viewport', () => {
    const onVisit = vi.fn()
    const { inner } = buildPane('term-1')

    handleTerminalWheelVisit(inner, runDeps([AT_TOP, AT_TOP], onVisit))

    expect(onVisit).not.toHaveBeenCalled()
  })

  it('ignores panes that are not terminals', () => {
    const onVisit = vi.fn()
    const { inner } = buildPane('editor-1')

    handleTerminalWheelVisit(inner, runDeps([AT_TOP, MOVED], onVisit))

    expect(onVisit).not.toHaveBeenCalled()
  })

  it('ignores a target outside any pane', () => {
    const onVisit = vi.fn()
    buildPane('term-1')
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    handleTerminalWheelVisit(outside, runDeps([AT_TOP, MOVED], onVisit))

    expect(onVisit).not.toHaveBeenCalled()
  })

  // Why: xterm applies the scroll after the event, so the comparison has to run
  // on the scheduled callback rather than inline.
  it('compares only after the scheduled frame runs', () => {
    const onVisit = vi.fn()
    const { inner } = buildPane('term-1')
    const scheduled: (() => void)[] = []
    const deps = runDeps([AT_TOP, MOVED], onVisit)

    handleTerminalWheelVisit(inner, {
      ...deps,
      schedule: (run: () => void) => {
        scheduled.push(run)
      }
    })

    expect(onVisit).not.toHaveBeenCalled()
    scheduled[0]?.()
    expect(onVisit).toHaveBeenCalledWith('term-1')
  })
})
