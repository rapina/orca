import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setBadgeMock, windowMock, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (() => void)[]>()
  return {
    setBadgeMock: vi.fn(),
    listeners,
    windowMock: {
      id: 1,
      isDestroyed: () => false,
      isFocused: vi.fn(() => true),
      setOverlayIcon: vi.fn(),
      flashFrame: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler])
      }),
      once: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  app: { dock: { setBadge: setBadgeMock } },
  BrowserWindow: { getAllWindows: () => [windowMock] }
}))

vi.mock('../tray/tray-attention-icon', () => ({
  createUnreadTaskbarOverlayIcon: () => ({})
}))

function fire(event: string): void {
  for (const handler of listeners.get(event) ?? []) {
    handler()
  }
}

describe('Windows taskbar unread flash', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    listeners.clear()
    windowMock.flashFrame.mockReset()
    windowMock.setOverlayIcon.mockReset()
    windowMock.on.mockClear()
    windowMock.isFocused.mockReturnValue(true)
    vi.resetModules()
  })

  // Why this is the case that matters: an unread almost always arrives while the
  // user is in Orca looking at some other terminal, and flashing is suppressed
  // then. The flash has to start when they leave — that is the moment a taskbar
  // button is the only cue that can still reach them.
  it('starts flashing when the window loses focus while unread', async () => {
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(1)
    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(false)

    windowMock.isFocused.mockReturnValue(false)
    fire('blur')
    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(true)
  })

  it('stops flashing when the window is focused again', async () => {
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(1)
    windowMock.isFocused.mockReturnValue(false)
    fire('blur')
    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(true)

    windowMock.isFocused.mockReturnValue(true)
    fire('focus')
    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(false)
  })

  it('does not flash a window with nothing unread', async () => {
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(0)
    windowMock.isFocused.mockReturnValue(false)
    fire('blur')

    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(false)
  })

  // Why: the listeners outlive every count write, so registering per write would
  // stack one more pair on the window each time an unread came or went.
  it('follows focus with one pair of listeners however often the count changes', async () => {
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(1)
    setUnreadDockBadgeCount(2)
    setUnreadDockBadgeCount(0)

    expect(windowMock.on).toHaveBeenCalledTimes(2)
  })
})
