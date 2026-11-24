import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { ApiError, api } from '@/api/client'
import type { AdminUser } from '@/api/types'
import { CreateUserDialog } from './CreateUserDialog'
import { QuotaDialog } from './QuotaDialog'
import { generatePassword } from './password'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: { adminCreateUser: vi.fn(), adminPatchUser: vi.fn() },
}))
const mocked = vi.mocked(api)
beforeEach(() => vi.clearAllMocks())

describe('generatePassword', () => {
  it('is 16 chars and valid for the server rules', () => {
    const a = generatePassword()
    expect(a).toHaveLength(16)
    expect(a).not.toBe(generatePassword())
  })
})

describe('CreateUserDialog', () => {
  it('validates client-side before calling the API', async () => {
    renderWithI18n(<CreateUserDialog onClose={vi.fn()} onCreated={vi.fn()} />)
    await userEvent.click(screen.getByTestId('create-user-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('valid email')
    await userEvent.type(document.getElementById('new-email')!, 'a@b.co')
    await userEvent.click(screen.getByTestId('create-user-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('name')
    await userEvent.type(document.getElementById('new-name')!, 'Ann')
    await userEvent.type(document.getElementById('new-password')!, 'short')
    await userEvent.click(screen.getByTestId('create-user-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('10 to 128')
    expect(mocked.adminCreateUser).not.toHaveBeenCalled()
  })
  it('generates a password and submits the contract body', async () => {
    mocked.adminCreateUser.mockResolvedValue({} as never)
    const onCreated = vi.fn()
    renderWithI18n(<CreateUserDialog onClose={vi.fn()} onCreated={onCreated} />)
    await userEvent.type(document.getElementById('new-email')!, ' a@b.co')
    await userEvent.type(document.getElementById('new-name')!, 'Ann')
    await userEvent.click(screen.getByTestId('gen-password'))
    const pw = (document.getElementById('new-password') as HTMLInputElement).value
    expect(pw).toHaveLength(16)
    await userEvent.selectOptions(screen.getByTestId('new-role'), 'admin')
    await userEvent.selectOptions(screen.getByTestId('new-status'), 'pending')
    await userEvent.click(screen.getByTestId('create-user-submit'))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(mocked.adminCreateUser).toHaveBeenCalledWith({ email: 'a@b.co', display_name: 'Ann', password: pw, role: 'admin', status: 'pending' })
  })
  it('shows server errors such as email_taken', async () => {
    mocked.adminCreateUser.mockRejectedValue(new ApiError('email_taken', 409, 'x'))
    renderWithI18n(<CreateUserDialog onClose={vi.fn()} onCreated={vi.fn()} />)
    await userEvent.type(document.getElementById('new-email')!, 'a@b.co')
    await userEvent.type(document.getElementById('new-name')!, 'Ann')
    await userEvent.click(screen.getByTestId('gen-password'))
    await userEvent.click(screen.getByTestId('create-user-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('already registered')
  })
})

const user = { id: 'u1', email: 'u@x.co', token_limit: null, token_period: 'month' } as AdminUser

describe('QuotaDialog', () => {
  it('saves unlimited as null with the chosen period', async () => {
    mocked.adminPatchUser.mockResolvedValue({} as never)
    renderWithI18n(<QuotaDialog user={{ ...user, token_limit: 5000 }} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.click(screen.getByTestId('quota-unlimited'))
    await userEvent.click(screen.getByTestId('quota-period-day'))
    await userEvent.click(screen.getByTestId('quota-save'))
    await waitFor(() => expect(mocked.adminPatchUser).toHaveBeenCalledWith('u1', { token_limit: null, token_period: 'day' }))
  })
  it('parses digits, previews compactly and rejects empty input', async () => {
    mocked.adminPatchUser.mockResolvedValue({} as never)
    renderWithI18n(<QuotaDialog user={user} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.click(screen.getByTestId('quota-limited'))
    await userEvent.click(screen.getByTestId('quota-save'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mocked.adminPatchUser).not.toHaveBeenCalled()
    await userEvent.type(screen.getByTestId('quota-limit-input'), '1a,2500000')
    expect(screen.getByTestId('quota-limit-input')).toHaveValue('12500000')
    expect(screen.getByTestId('quota-preview')).toHaveTextContent('12.5M')
    await userEvent.click(screen.getByTestId('quota-save'))
    await waitFor(() => expect(mocked.adminPatchUser).toHaveBeenCalledWith('u1', { token_limit: 12_500_000, token_period: 'month' }))
  })
})
