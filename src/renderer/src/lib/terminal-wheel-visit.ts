/** The scroll geometry of a terminal's viewport at one instant. */
export type TerminalViewportScroll = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Whether a wheel gesture over a terminal counts as visiting it.
 *
 * Why the geometry check: rolling the wheel on a terminal already parked at the
 * bottom of its output moves nothing, and silencing a terminal the user never
 * actually read is the failure this whole feature exists to avoid. So a wheel
 * only counts once the viewport really moved.
 *
 * Why the lenient branches: when the viewport cannot scroll at all, the wheel
 * was either delivered to a full-screen app that scrolls its own content
 * (xterm's alternate buffer keeps the viewport pinned) or there was nothing to
 * scroll. Neither is distinguishable from the DOM, and both mean the user was
 * working in that terminal, so they count. Missing geometry counts too rather
 * than swallowing the gesture.
 */
export function wheelCountsAsTerminalVisit(
  before: TerminalViewportScroll | null,
  after: TerminalViewportScroll | null
): boolean {
  if (!before || !after) {
    return true
  }
  if (before.scrollHeight <= before.clientHeight) {
    return true
  }
  return after.scrollTop !== before.scrollTop
}

/**
 * Scroll geometry of the terminal viewport inside a pane element, or null when
 * the pane has no live viewport (a parked or not-yet-attached terminal).
 */
export function readPaneViewportScroll(paneElement: Element): TerminalViewportScroll | null {
  const viewport = paneElement.querySelector('.xterm-viewport')
  if (!(viewport instanceof HTMLElement)) {
    return null
  }
  return {
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight
  }
}

export type TerminalWheelVisitDeps = {
  isTerminalLeaf: (leafId: string) => boolean
  readViewport: (paneElement: Element) => TerminalViewportScroll | null
  /** Runs the comparison after the browser applied the scroll (one frame later). */
  schedule: (run: () => void) => void
  onVisit: (leafId: string) => void
}

/**
 * Routes one wheel gesture to the terminal it happened over, and reports a visit
 * when the gesture actually scrolled that terminal.
 *
 * The pane is resolved from the event target rather than from the listener's own
 * element so a single container listener covers every split in the tab.
 */
export function handleTerminalWheelVisit(
  target: EventTarget | null,
  deps: TerminalWheelVisitDeps
): void {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return
  }
  const paneElement = target.closest('.pane[data-leaf-id]')
  const leafId = paneElement?.getAttribute('data-leaf-id')
  if (!paneElement || !leafId || !deps.isTerminalLeaf(leafId)) {
    return
  }
  const before = deps.readViewport(paneElement)
  deps.schedule(() => {
    if (!wheelCountsAsTerminalVisit(before, deps.readViewport(paneElement))) {
      return
    }
    deps.onVisit(leafId)
  })
}
