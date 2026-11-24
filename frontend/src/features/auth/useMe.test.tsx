import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { api } from '@/api/client'
import type { Me } from '@/api/types'
import { useMe, QUOTA_POLL_MS } from './useMe'

vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), api: { me: vi.fn() } }))
const me = (used: number): Me => ({
  id: 'u', email: 'a@b.c', display_name: 'A', role: 'user', status: 'active', created_at: '', last_login_at: null, approved_at: null,
  token_limit: 10, token_period: 'day', quota: { limit: 10, period: 'day', used, resets_at: '2099-01-01T00:00:00Z' },
})

afterEach(() => vi.useRealTimers())

describe('useMe quota polling', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  )
  it('re-checks /me every minute while over quota, so the block can clear', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(api.me).mockResolvedValueOnce(me(10)).mockResolvedValue(me(0))
    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data?.quota?.used).toBe(10))
    vi.advanceTimersByTime(QUOTA_POLL_MS + 100)
    await waitFor(() => expect(result.current.data?.quota?.used).toBe(0))
    expect(vi.mocked(api.me)).toHaveBeenCalledTimes(2)
  })
  it('does not poll when under quota', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(api.me).mockReset().mockResolvedValue(me(1))
    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    vi.advanceTimersByTime(QUOTA_POLL_MS * 3)
    expect(vi.mocked(api.me)).toHaveBeenCalledTimes(1)
  })
})
