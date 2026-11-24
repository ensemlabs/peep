import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import type { Conversation, User } from '@/api/types'
import { effectiveStatus, groupConversations, indicatorFor, unreadCount } from './conversationStatus'

const NOW = Date.parse('2026-11-23T15:00:00Z')
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, title: `Chat ${id}`, model: 'm', updated_at: new Date(NOW - 3600_000).toISOString(),
  status: 'complete', unread: false, preview: `preview ${id}`, pinned: false, ...over,
})

const list = vi.fn()
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: { conversations: (q?: string, before?: string | null) => list(q, before), patchConversation: vi.fn(), deleteConversation: vi.fn(), markRead: vi.fn(), logout: vi.fn(), models: vi.fn(async () => ({ switchable: false, active: {}, items: [] })) },
}))
import { Sidebar } from './Sidebar'

const user: User = { id: 'u', email: 'a@b.c', display_name: 'Ann', role: 'user', status: 'active', created_at: '', last_login_at: null, approved_at: null, token_limit: null, token_period: 'month' }

describe('indicatorFor', () => {
  it.each([
    ['streaming', false, 'streaming'], ['streaming', true, 'streaming'],
    ['complete', true, 'unread'], ['complete', false, null],
    ['error', true, 'error'], ['error', false, null],
    ['stopped', true, null], ['stopped', false, null],
    ['idle', true, null],
  ] as const)('%s unread=%s -> %s', (status, unread, out) => {
    expect(indicatorFor(status, unread)).toBe(out)
  })
  it('a run driven by this client wins over stale server status', () => {
    expect(effectiveStatus({ status: 'complete' }, true)).toBe('streaming')
    expect(effectiveStatus({ status: undefined }, false)).toBe('idle')
  })
})

describe('groupConversations', () => {
  it('splits pinned, today, 7d, 30d and older', () => {
    const day = 86_400_000
    const g = groupConversations([
      conv('p', { pinned: true, updated_at: new Date(NOW - 90 * day).toISOString() }),
      conv('t'),
      conv('w', { updated_at: new Date(NOW - 3 * day).toISOString() }),
      conv('m', { updated_at: new Date(NOW - 20 * day).toISOString() }),
      conv('o', { updated_at: new Date(NOW - 60 * day).toISOString() }),
    ], NOW)
    expect(g.pinned.map((c) => c.id)).toEqual(['p'])
    expect(g.today.map((c) => c.id)).toEqual(['t'])
    expect(g.week.map((c) => c.id)).toEqual(['w'])
    expect(g.month.map((c) => c.id)).toEqual(['m'])
    expect(g.older.map((c) => c.id)).toEqual(['o'])
  })
  it('counts unread finished chats only', () => {
    expect(unreadCount([conv('a', { unread: true }), conv('b', { unread: true, status: 'streaming' }), conv('c')])).toBe(1)
  })
})

describe('Sidebar', () => {
  beforeEach(() => {
    list.mockReset()
    document.title = 'x'
  })
  it('renders status rows, pinned group, unread count in the tab title', async () => {
    list.mockResolvedValue({
      next_before: null,
      items: [
        conv('pin', { pinned: true }),
        conv('run', { status: 'streaming' }),
        conv('new', { unread: true }),
        conv('bad', { status: 'error', unread: true }),
        conv('stop', { status: 'stopped', unread: true }),
        conv('read'),
      ],
    })
    renderWithI18n(<Sidebar user={user} />)
    const rows = await screen.findAllByTestId('conv-row')
    expect(rows).toHaveLength(6)
    const by = (t: string) => rows.find((r) => r.textContent?.includes(t))!
    expect(by('Chat run')).toHaveAttribute('data-status', 'streaming')
    expect(by('Chat run').querySelector('[data-kind=streaming]')).not.toBeNull()
    expect(by('Chat new')).toHaveAttribute('data-unread', 'true')
    expect(by('Chat new').querySelector('[data-kind=unread]')).not.toBeNull()
    expect(by('Chat bad').querySelector('[data-kind=error]')).not.toBeNull()
    expect(by('Chat stop').querySelector('[data-testid=conv-indicator]')).toBeNull()
    expect(by('Chat stop')).toHaveAttribute('data-status', 'stopped')
    expect(by('Chat read').querySelector('[data-testid=conv-indicator]')).toBeNull()
    expect(screen.getByTestId('group-pinned')).toHaveTextContent('Chat pin')
    await waitFor(() => expect(document.title).toBe('(2) Peep'))
  })
  it('searches with the debounced query', async () => {
    list.mockImplementation(async (q?: string) => ({ next_before: null, items: q ? [conv('hit')] : [conv('a'), conv('b')] }))
    renderWithI18n(<Sidebar user={user} />)
    await screen.findAllByTestId('conv-row')
    await userEvent.type(screen.getByTestId('sidebar-search'), 'needle')
    await waitFor(() => expect(list).toHaveBeenCalledWith('needle', null))
    await waitFor(() => expect(screen.getAllByTestId('conv-row')).toHaveLength(1))
  })
  it('polls only the first page while something streams, and stops once nothing does', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let phase = 0
      list.mockImplementation(async (_q?: string, before?: string | null) => {
        if (before) return { next_before: null, items: [conv('old')] }
        return { next_before: 'tok', items: [conv('run', { status: phase === 0 ? 'streaming' : 'complete', unread: phase > 0 })] }
      })
      renderWithI18n(<Sidebar user={user} />)
      const row = async () => (await screen.findAllByTestId('conv-row')).find((r) => r.textContent?.includes('Chat run'))!
      expect(await row()).toHaveAttribute('data-status', 'streaming')
      const callsBefore = list.mock.calls.length
      phase = 1
      await vi.advanceTimersByTimeAsync(5200)
      await waitFor(async () => expect(await row()).toHaveAttribute('data-status', 'complete'))
      // the poll asked for the head only (no cursor), never for older pages
      expect(list.mock.calls.slice(callsBefore).every((c) => c[1] == null)).toBe(true)
      const afterDone = list.mock.calls.length
      await vi.advanceTimersByTimeAsync(11_000)
      expect(list.mock.calls.length).toBe(afterDone) // nothing streams any more: polling stopped
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Sidebar rename focus', () => {
  it('focuses the row input after choosing Rename', async () => {
    list.mockResolvedValue({ next_before: null, items: [conv('a')] })
    renderWithI18n(<Sidebar user={user} />)
    await screen.findAllByTestId('conv-row')
    await userEvent.click(screen.getByTestId('conv-menu'))
    await userEvent.click(await screen.findByTestId('conv-rename'))
    const input = await screen.findByRole('textbox', { name: 'Rename' })
    await waitFor(() => expect(document.activeElement).toBe(input))
  })
})

describe('Sidebar brand', () => {
  it('shows the Peep wordmark with a small "by Ensemble Labs" line in the header', async () => {
    list.mockResolvedValue({ next_before: null, items: [] })
    renderWithI18n(<Sidebar user={user} />)
    expect(screen.getByTestId('sidebar')).toHaveTextContent('Peep')
    expect(screen.getByTestId('brand-by')).toHaveTextContent('by Ensemble Labs')
    expect(screen.getByTestId('ensemble-logo')).toBeInTheDocument()
  })
})
