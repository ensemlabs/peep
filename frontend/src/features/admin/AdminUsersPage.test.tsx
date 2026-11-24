import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { api } from '@/api/client'
import type { AdminUser, User } from '@/api/types'
import { AdminUsersPage } from './AdminUsersPage'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: { adminUsers: vi.fn(), adminPatchUser: vi.fn(), adminBulk: vi.fn(), adminAudit: vi.fn() },
}))
vi.mock('@/lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
const mocked = vi.mocked(api)

const mk = (id: string, status: AdminUser['status'], over: Partial<AdminUser> = {}): AdminUser => ({
  id, email: `${id}@x.co`, display_name: id, role: 'user', status, created_at: '2026-01-01T00:00:00Z', last_login_at: null,
  approved_at: null, token_limit: null, token_period: 'month', tokens_used: 12_300, ...over,
})
const me = mk('me', 'active', { role: 'admin' }) as User
const rows = [me as AdminUser, mk('a', 'pending'), mk('b', 'active', { token_limit: 100_000 })]

beforeEach(() => {
  vi.clearAllMocks()
  mocked.adminUsers.mockResolvedValue({ items: rows, total: 3 })
  mocked.adminBulk.mockResolvedValue({ done: ['a', 'b'], skipped: [{ id: 'x', reason: 'no_change' }] })
  mocked.adminAudit.mockResolvedValue({ items: [], total: 0 })
})

describe('AdminUsersPage selection', () => {
  it('excludes the own row, selects all, and shows the bulk bar', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    expect(screen.getAllByTestId('row-check')).toHaveLength(2)
    expect(screen.queryByTestId('bulk-bar')).toBeNull()
    await userEvent.click(screen.getAllByTestId('row-check')[0])
    expect(screen.getByTestId('bulk-bar')).toHaveTextContent('1 selected')
    expect((screen.getByTestId('select-all') as HTMLInputElement).indeterminate).toBe(true)
    await userEvent.click(screen.getByTestId('select-all'))
    expect(screen.getByTestId('bulk-bar')).toHaveTextContent('2 selected')
  })
  it('shows tokens usage cells', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    const cells = screen.getAllByTestId('tokens-cell').map((c) => c.textContent)
    expect(cells).toContain('12.3k · unlimited')
    expect(cells.some((c) => c?.startsWith('12.3k / 100k'))).toBe(true)
  })
  it('confirms delete, calls bulk, reports the result and clears the selection', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    await userEvent.click(screen.getByTestId('select-all'))
    await userEvent.click(screen.getByTestId('bulk-delete'))
    expect(mocked.adminBulk).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByTestId('confirm-btn'))
    await waitFor(() => expect(mocked.adminBulk).toHaveBeenCalledWith(['a', 'b'], 'delete'))
    expect(await screen.findByTestId('bulk-result')).toHaveTextContent('2 done · 1 skipped (no change needed)')
    expect(screen.queryByTestId('bulk-bar')).toBeNull()
  })
  it('drops a selected row that left the list after a row action', async () => {
    mocked.adminPatchUser.mockResolvedValue({} as never)
    const c = mk('c', 'pending')
    mocked.adminUsers.mockResolvedValueOnce({ items: [me as AdminUser, rows[1], c], total: 3 })
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    await userEvent.click(screen.getByTestId('select-all'))
    expect(screen.getByTestId('bulk-bar')).toHaveTextContent('2 selected')
    mocked.adminUsers.mockResolvedValue({ items: [me as AdminUser, c], total: 2 })
    await userEvent.click(within(screen.getAllByTestId('user-row')[1]).getByTestId('approve-btn'))
    await waitFor(() => expect(screen.getByTestId('bulk-bar')).toHaveTextContent('1 selected'))
    await userEvent.click(screen.getByTestId('bulk-approve'))
    await waitFor(() => expect(mocked.adminBulk).toHaveBeenCalledWith(['c'], 'approve'))
  })
  it('approve needs no confirmation', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    await userEvent.click(within(screen.getAllByTestId('user-row')[1]).getByTestId('row-check'))
    await userEvent.click(screen.getByTestId('bulk-approve'))
    await waitFor(() => expect(mocked.adminBulk).toHaveBeenCalledWith(['a'], 'approve'))
  })
  it('resets the selection when the filter changes', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await screen.findAllByTestId('user-row')
    await userEvent.click(screen.getByTestId('select-all'))
    expect(screen.getByTestId('bulk-bar')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('tab-pending'))
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).toBeNull())
  })
  it('switches to the audit log tab', async () => {
    renderWithI18n(<AdminUsersPage me={me} />)
    await userEvent.click(screen.getByTestId('tab-audit'))
    expect(await screen.findByTestId('audit-search')).toBeInTheDocument()
    expect(await screen.findByText('No audit entries.')).toBeInTheDocument()
  })
})
