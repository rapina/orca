// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalListEntry } from '@/lib/terminal-list-model'

const { clearTerminalPaneUnread, markTerminalPaneUnread, activateTabAndFocusPane } = vi.hoisted(
  () => ({
    clearTerminalPaneUnread: vi.fn(),
    markTerminalPaneUnread: vi.fn(),
    activateTabAndFocusPane: vi.fn()
  })
)

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ clearTerminalPaneUnread, markTerminalPaneUnread })
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane }))
vi.mock('@/components/AgentWorkingSpinner', () => ({ AgentWorkingSpinner: () => null }))
vi.mock('../sidebar/WorktreeCardHelpers', () => ({ FilledBellIcon: () => null }))
vi.mock('./terminal-row-context', () => ({ TerminalRowContext: () => null }))
vi.mock('./TerminalListRowMenu', () => ({
  closeAllContextMenus: vi.fn(),
  TerminalListRowMenu: ({
    open,
    canDetach,
    onMarkUnread,
    onDetach
  }: {
    open: boolean
    canDetach?: boolean
    onMarkUnread: () => void
    onDetach?: () => void
  }) => (
    <div data-testid="row-menu" data-open={String(open)} data-can-detach={String(canDetach)}>
      <button type="button" data-testid="row-menu-mark-unread" onClick={onMarkUnread} />
      <button type="button" data-testid="row-menu-detach" onClick={onDetach} />
    </div>
  )
}))

const { TerminalListRow } = await import('./TerminalListRow')

const PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

function entry(): TerminalListEntry {
  return {
    paneKey: PANE,
    tabId: 'tab-1',
    leafId: '11111111-1111-4111-8111-111111111111',
    position: '1.1',
    name: 'a terminal',
    status: 'unread'
  }
}

function renderRow(extra: { canDetach?: boolean; onDetach?: () => void } = {}): void {
  render(
    <TerminalListRow
      entry={entry()}
      canMove={false}
      pendingMove={null}
      onBeginMove={vi.fn()}
      onCompleteMove={vi.fn()}
      {...extra}
    />
  )
}

describe('TerminalListRow right-click', () => {
  afterEach(() => {
    // Why explicit: this suite renders twice and the runner has no global cleanup,
    // so the first row would still be in the document for the second query.
    cleanup()
    vi.clearAllMocks()
  })

  // Why this is pinned: opening a terminal is what a click on this row means, and
  // opening it is what clears its unread. A right-click that reached that path
  // would take the very unread the user opened the menu to act on.
  it('opens the menu without clearing the unread or focusing the terminal', () => {
    renderRow()

    fireEvent.contextMenu(screen.getByTestId('terminal-list-row'))

    expect(screen.getByTestId('row-menu').dataset.open).toBe('true')
    expect(clearTerminalPaneUnread).not.toHaveBeenCalled()
    expect(activateTabAndFocusPane).not.toHaveBeenCalled()
  })

  it('still clears the unread on a plain click', () => {
    renderRow()

    fireEvent.click(screen.getByTestId('terminal-list-row'))

    expect(clearTerminalPaneUnread).toHaveBeenCalledWith(PANE)
    expect(activateTabAndFocusPane).toHaveBeenCalled()
    expect(screen.getByTestId('row-menu').dataset.open).toBe('false')
  })

  // Why: forcing an unread is the one action here that has no other way in — the
  // list is where a terminal is marked, and nothing else marks it.
  it('marks the terminal unread from the menu', () => {
    renderRow()

    fireEvent.contextMenu(screen.getByTestId('terminal-list-row'))
    fireEvent.click(screen.getByTestId('row-menu-mark-unread'))

    expect(markTerminalPaneUnread).toHaveBeenCalledWith(PANE)
  })

  // Why: a background job bound to this terminal keeps writing its state over the
  // terminal's own; the menu is the one place the binding can be undone.
  it('offers to give a bound agent its own row back', () => {
    const onDetach = vi.fn()
    renderRow({ canDetach: true, onDetach })

    fireEvent.contextMenu(screen.getByTestId('terminal-list-row'))
    expect(screen.getByTestId('row-menu').dataset.canDetach).toBe('true')
    fireEvent.click(screen.getByTestId('row-menu-detach'))

    expect(onDetach).toHaveBeenCalledWith(expect.objectContaining({ paneKey: PANE }))
  })
})
