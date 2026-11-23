import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { PendingGate } from './PendingGate'

describe('PendingGate', () => {
  it('locks the content, shows banner + overlay, and keeps Logout / Check working', async () => {
    const onClick = vi.fn()
    const onLogout = vi.fn()
    const onCheck = vi.fn()
    renderWithI18n(
      <PendingGate pending onCheck={onCheck} onLogout={onLogout}>
        <button onClick={onClick}>New chat</button>
      </PendingGate>,
    )
    expect(screen.getByTestId('pending-banner')).toHaveTextContent('Your account is waiting for admin approval')
    const main = screen.getByTestId('app-main')
    expect(main).toHaveAttribute('inert')
    expect(main).toHaveAttribute('aria-disabled', 'true')
    const overlay = screen.getByTestId('pending-overlay')
    // Clicking the overlay (what a real pointer would hit) never reaches the content.
    fireEvent.click(overlay)
    expect(onClick).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
  it('renders nothing extra when active', () => {
    renderWithI18n(<PendingGate pending={false} onCheck={() => {}} onLogout={() => {}}><button>New chat</button></PendingGate>)
    expect(screen.queryByTestId('pending-overlay')).toBeNull()
    expect(screen.queryByTestId('pending-banner')).toBeNull()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
  })
})
