const FOCUSED_PANE_FLASH_CLASS = 'pane-focus-rim-flash'
/** Why a second class rather than a second animation: the rim only changes colour,
 *  so the timing, shape and reduced-motion opt-out stay in one place. */
const FOCUSED_PANE_FLASH_UNREAD_CLASS = 'pane-focus-rim-flash-unread'
export const FOCUSED_PANE_FLASH_MS = 1_500

/** What the flash is saying: 'locate' points at the pane you jumped to, 'unread'
 *  says the click also took the terminal's unread mark away. */
export type FocusedPaneFlashTone = 'locate' | 'unread'

const flashTimersByPane = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

export function flashFocusedPaneRim(
  paneElement: HTMLElement,
  tone: FocusedPaneFlashTone = 'locate'
): void {
  const existingTimer = flashTimersByPane.get(paneElement)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  // Why: remove before add restarts the CSS animation when the same agent row
  // is clicked repeatedly while the previous rim flash is still active. The tone
  // class goes with it, or a second click would keep the first click's colour.
  paneElement.classList.remove(FOCUSED_PANE_FLASH_CLASS, FOCUSED_PANE_FLASH_UNREAD_CLASS)
  void paneElement.offsetWidth
  paneElement.classList.add(FOCUSED_PANE_FLASH_CLASS)
  if (tone === 'unread') {
    paneElement.classList.add(FOCUSED_PANE_FLASH_UNREAD_CLASS)
  }

  const timer = setTimeout(() => {
    paneElement.classList.remove(FOCUSED_PANE_FLASH_CLASS, FOCUSED_PANE_FLASH_UNREAD_CLASS)
    flashTimersByPane.delete(paneElement)
  }, FOCUSED_PANE_FLASH_MS)
  flashTimersByPane.set(paneElement, timer)
}
