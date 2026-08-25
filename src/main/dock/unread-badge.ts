import { app, BrowserWindow } from 'electron'
import {
  createQuestionTaskbarOverlayIcon,
  createUnreadTaskbarOverlayIcon
} from '../tray/tray-attention-icon'

let unreadCount = 0
/** Agents waiting on an answer. Why apart from unread: it outranks unread on every surface. */
let questionCount = 0

function applyDockBadge(): void {
  if (process.platform !== 'darwin') {
    return
  }

  // Why both: the badge counts what needs the user, and a question needs them at least as much.
  const total = unreadCount + questionCount
  const label = total === 0 ? '' : total > 99 ? '99+' : String(total)
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
 *
 * Why a question takes the overlay: there is one corner, and a turn waiting on an
 * answer goes nowhere until the user comes — the unread bell can wait behind it.
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

  const hasQuestion = questionCount > 0
  const hasUnread = unreadCount > 0
  try {
    window.setOverlayIcon(
      hasQuestion
        ? createQuestionTaskbarOverlayIcon()
        : hasUnread
          ? createUnreadTaskbarOverlayIcon()
          : null,
      hasQuestion
        ? `${questionCount} waiting for an answer`
        : hasUnread
          ? `${unreadCount} unread`
          : ''
    )
  } catch {
    // Taskbar chrome is best-effort; a failed overlay must not break the write.
  }
  // Why: flashFrame(true) keeps flashing until the window is activated, so it is
  // only started while the window is unfocused and always stopped once read.
  window.flashFrame((hasUnread || hasQuestion) && !window.isFocused())
}

function sanitizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

export function setUnreadDockBadgeCount(count: number, questions = 0): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return
  }

  unreadCount = sanitizeCount(count)
  questionCount = sanitizeCount(questions)

  applyDockBadge()
  applyWindowsTaskbarUnread()
}
