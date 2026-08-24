import { app, BrowserWindow } from 'electron'
import { createUnreadTaskbarOverlayIcon } from '../tray/tray-attention-icon'

let unreadCount = 0

function applyDockBadge(): void {
  if (process.platform !== 'darwin') {
    return
  }

  const label = unreadCount === 0 ? '' : unreadCount > 99 ? '99+' : String(unreadCount)
  app.dock?.setBadge(label)
}

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
}

const flashFollowedWindowIds = new Set<number>()

/**
 * Re-apply the taskbar flash whenever the window gains or loses focus.
 *
 * Why: flashing is suppressed while the window is focused, so an unread that
 * arrives while the user is in Orca starts nothing. Without this, the moment they
 * leave for another app - which is exactly when a flashing taskbar button is the
 * only thing that can still reach them - the button sits still, because the unread
 * count has not changed since and nothing else re-applies it.
 */
function followFocusForTaskbarFlash(window: BrowserWindow): void {
  if (flashFollowedWindowIds.has(window.id)) {
    return
  }
  flashFollowedWindowIds.add(window.id)
  const reapply = (): void => {
    applyWindowsTaskbarUnread()
  }
  window.on('blur', reapply)
  window.on('focus', reapply)
  window.once('closed', () => {
    flashFollowedWindowIds.delete(window.id)
  })
}

/**
 * Windows has no dock badge. The taskbar button carries the same signal two ways:
 * an overlay icon (ignored by Windows when the taskbar runs in small-icon mode,
 * which is why it is not the only cue) and a flashing button, which works in
 * every mode. Flashing is suppressed while the window is focused — the user is
 * already looking at the unread terminal's app.
 */
function applyWindowsTaskbarUnread(): void {
  if (process.platform !== 'win32') {
    return
  }

  const window = mainWindow()
  if (!window) {
    return
  }
  followFocusForTaskbarFlash(window)

  const hasUnread = unreadCount > 0
  try {
    window.setOverlayIcon(
      hasUnread ? createUnreadTaskbarOverlayIcon() : null,
      hasUnread ? `${unreadCount} unread` : ''
    )
  } catch {
    // Taskbar chrome is best-effort; a failed overlay must not break the write.
  }
  // Why: flashFrame(true) keeps flashing until the window is activated, so it is
  // only started while the window is unfocused and always stopped once read.
  window.flashFrame(hasUnread && !window.isFocused())
}

export function setUnreadDockBadgeCount(count: number): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return
  }

  unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0

  applyDockBadge()
  applyWindowsTaskbarUnread()
}
