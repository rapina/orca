import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateTabAndFocusPane } from './activate-tab-and-focus-pane'

const setActiveTab = vi.hoisted(() => vi.fn())
const setActiveTabType = vi.hoisted(() => vi.fn())

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      setActiveTab,
      setActiveTabType
    })
  }
}))

describe('activateTabAndFocusPane', () => {
  beforeEach(() => {
    setActiveTab.mockImplementation(() => undefined)
    setActiveTabType.mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('cancels a pending pane focus frame when a newer activation starts', () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 12)
    )
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn()
    })

    activateTabAndFocusPane('tab-1', 'leaf-1')
    activateTabAndFocusPane('tab-2', 'leaf-2')

    expect(setActiveTab).toHaveBeenNthCalledWith(1, 'tab-1')
    expect(setActiveTab).toHaveBeenNthCalledWith(2, 'tab-2')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(12)
  })

  it('reveals the terminal surface before selecting the terminal tab', () => {
    const callOrder: string[] = []
    setActiveTabType.mockImplementation((tabType: string) => {
      callOrder.push(`type:${tabType}`)
    })
    setActiveTab.mockImplementation((tabId: string) => {
      callOrder.push(`tab:${tabId}`)
    })
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 12)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn()
    })

    activateTabAndFocusPane('tab-1', 'leaf-1')

    expect(callOrder).toEqual(['type:terminal', 'tab:tab-1'])
  })

  it('reveals the terminal surface for tab-only activation without dispatching pane focus', () => {
    const requestAnimationFrame = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('window', {
      dispatchEvent
    })

    activateTabAndFocusPane('tab-1', null)

    expect(setActiveTabType).toHaveBeenCalledWith('terminal')
    expect(setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  // Why pinned: this builder whitelists the options it forwards, so a field added
  // to the focus event but not listed here is dropped silently - the pane then
  // flashes the wrong colour with nothing anywhere saying why.
  it('forwards every option the focus event carries', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('window', { dispatchEvent })

    activateTabAndFocusPane('tab-1', 'leaf-1', {
      ackPaneKeyOnSuccess: 'tab-1:leaf-1',
      flashFocusedPane: true,
      flashFocusedPaneTone: 'unread',
      scrollToBottomIfOutputSinceLastView: true
    })

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0]?.[0]?.detail).toEqual({
      tabId: 'tab-1',
      leafId: 'leaf-1',
      ackPaneKeyOnSuccess: 'tab-1:leaf-1',
      flashFocusedPane: true,
      flashFocusedPaneTone: 'unread',
      scrollToBottomIfOutputSinceLastView: true
    })
  })
})
