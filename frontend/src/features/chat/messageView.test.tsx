import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { MessageView, messageText } from './MessageView'
import { EmptyState, firstName } from './EmptyState'
import { timeOfDay, usageSummary } from '@/lib/format'
import type { Message } from '@/api/types'

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm', role: 'assistant', content: 'hello', attachments: [], parts: [{ id: 't', type: 'text', text: 'hello' }],
  status: 'complete', model: 'x', created_at: '2026-01-01T10:30:00Z', ...over,
})

describe('assistant hover actions', () => {
  it('shows copy, time and token usage (≈ for estimates, cache only when reported)', () => {
    renderWithI18n(<MessageView message={msg({ usage: { input_tokens: 1200, output_tokens: 340, reasoning_tokens: null, cache_read_tokens: 900, cache_write_tokens: null, total_tokens: 1540, source: 'estimate' } })} />)
    expect(screen.getByTestId('copy-message')).toBeInTheDocument()
    expect(screen.getByTestId('message-time')).toBeInTheDocument()
    expect(screen.getByTestId('message-usage')).toHaveTextContent('≈ 1.2k → 340 · cache 900')
  })
  it('omits the approximation and cache when from the provider with null cache', () => {
    renderWithI18n(<MessageView message={msg({ usage: { input_tokens: 10, output_tokens: 5, reasoning_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 15, source: 'provider' } })} />)
    expect(screen.getByTestId('message-usage')).toHaveTextContent(/^10 → 5$/)
  })
  it('copies the text of the reply', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWithI18n(<MessageView message={msg()} />)
    await userEvent.click(screen.getByTestId('copy-message'))
    expect(writeText).toHaveBeenCalledWith('hello')
  })
  it('has no action row while streaming', () => {
    renderWithI18n(<MessageView message={msg({ status: 'streaming' })} />)
    expect(screen.queryByTestId('message-actions')).toBeNull()
  })
  it('joins root text parts for copying', () => {
    expect(messageText(msg({ parts: [{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'text', text: 'B' }] }))).toBe('A\n\nB')
  })
  it('usageSummary basics', () => {
    expect(usageSummary({ input_tokens: 5, output_tokens: 6, cache_read_tokens: null, source: 'provider' })).toBe('5 → 6')
  })
})

describe('empty state greeting', () => {
  it.each([[8, 'Good morning, Ann'], [14, 'Good afternoon, Ann'], [19, 'Good evening, Ann'], [2, 'Still up, Ann?']])('hour %s', (h, text) => {
    renderWithI18n(<EmptyState onExample={() => {}} name="Ann Lee" hour={h} />)
    expect(screen.getByTestId('greeting')).toHaveTextContent(text)
  })
  it('falls back without a name and localises', () => {
    renderWithI18n(<EmptyState onExample={() => {}} hour={8} />)
    expect(screen.getByTestId('greeting')).toHaveTextContent('How can I help you today?')
    renderWithI18n(<EmptyState onExample={() => {}} name="Lan" hour={8} />, 'vi')
    expect(screen.getAllByTestId('greeting').at(-1)).toHaveTextContent('Chào buổi sáng, Lan')
  })
  it('has four icon suggestion cards', () => {
    renderWithI18n(<EmptyState onExample={() => {}} name="A" />)
    expect(screen.getAllByTestId('example-prompt')).toHaveLength(4)
  })
  it('time-of-day buckets and first name', () => {
    expect([4, 5, 11, 12, 17, 18, 21, 22].map(timeOfDay)).toEqual(['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night'])
    expect(firstName('  Nguyen Van A ')).toBe('Nguyen')
  })
})
