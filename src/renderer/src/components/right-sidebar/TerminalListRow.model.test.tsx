// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalListEntry } from '@/lib/terminal-list-model'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ clearTerminalPaneUnread: vi.fn(), markTerminalPaneUnread: vi.fn() })
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: vi.fn() }))
vi.mock('@/components/AgentWorkingSpinner', () => ({ AgentWorkingSpinner: () => null }))
vi.mock('../sidebar/WorktreeCardHelpers', () => ({ FilledBellIcon: () => null }))
vi.mock('./terminal-row-context', () => ({ TerminalRowContext: () => null }))
vi.mock('./TerminalListRowMenu', () => ({
  closeAllContextMenus: vi.fn(),
  TerminalListRowMenu: () => null
}))

const { TerminalListRow } = await import('./TerminalListRow')

function entry(model?: string): TerminalListEntry {
  return {
    paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
    tabId: 'tab-1',
    leafId: '11111111-1111-4111-8111-111111111111',
    position: '1.1',
    name: 'shell',
    status: 'working',
    ...(model ? { model } : {})
  }
}

function renderRow(model?: string): void {
  render(
    <TerminalListRow
      entry={entry(model)}
      canMove={false}
      pendingMove={null}
      onBeginMove={vi.fn()}
      onCompleteMove={vi.fn()}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe('TerminalListRow model chip', () => {
  it('shows the model by its short name, with the id as the tooltip', () => {
    renderRow('claude-fable-5-1')
    const chip = screen.getByTestId('terminal-list-model')
    expect(chip.textContent).toBe('Fable 5.1')
    expect(chip.getAttribute('title')).toBe('claude-fable-5-1')
  })

  it('shows an unfamiliar id as it came', () => {
    renderRow('gpt-5.6-sol')
    expect(screen.getByTestId('terminal-list-model').textContent).toBe('gpt-5.6-sol')
  })

  it('shows nothing when no model is known', () => {
    renderRow()
    expect(screen.queryByTestId('terminal-list-model')).toBeNull()
  })
})
