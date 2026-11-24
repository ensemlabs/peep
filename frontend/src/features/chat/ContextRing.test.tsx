import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { ContextDetails, ContextRing, contextPercent, estimateDraftTokens, ringTone } from './ContextRing'
import type { ContextInfo } from '@/api/types'

const data = (over: Partial<ContextInfo> = {}): ContextInfo => ({
  model_id: 'm', context_window: 100_000, used_tokens: 12_345, estimated: true,
  breakdown: [
    { key: 'system', tokens: 0 }, { key: 'user_messages', tokens: 2000 }, { key: 'assistant_messages', tokens: 10_000 },
    { key: 'attachments', tokens: 345 }, { key: 'tool_results', tokens: 0 }, { key: 'skills', tokens: 0 },
  ],
  last_usage: { input_tokens: 5000, output_tokens: 800, reasoning_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 5800, source: 'estimate' },
  totals: { input_tokens: 9000, output_tokens: 3000, cache_read_tokens: null, cache_write_tokens: null, messages: 4 },
  ...over,
})

describe('context ring maths', () => {
  it('computes and clamps the percentage', () => {
    expect(contextPercent(25_000, 100_000)).toBe(25)
    expect(contextPercent(500, 0)).toBe(0)
    expect(contextPercent(999_999, 1000)).toBe(100)
  })
  it.each([[0, 'neutral'], [70, 'neutral'], [70.1, 'amber'], [90, 'amber'], [90.5, 'red'], [100, 'red']])('%s%% -> %s', (p, tone) => {
    expect(ringTone(p)).toBe(tone)
  })
  it('estimates the draft at chars/4', () => {
    expect(estimateDraftTokens('')).toBe(0)
    expect(estimateDraftTokens('abcdefghi')).toBe(3)
  })
})

describe('ContextRing gauge', () => {
  it('below 1% shows only the closed track: no arc, no dot', () => {
    const { container } = renderWithI18n(<ContextRing data={data({ used_tokens: 500, context_window: 1_000_000 })} draftText="" />)
    expect(screen.queryByTestId('context-ring-arc')).toBeNull()
    expect(screen.queryByTestId('context-ring-dot')).toBeNull()
    expect(container.querySelectorAll('svg circle')).toHaveLength(1) // just the track
    expect(screen.getByTestId('context-ring')).toHaveAttribute('title', '500 / 1M (0.1%)')
  })
  it('from 1% draws a solid pie sector inside the track, with the formatted tooltip', () => {
    renderWithI18n(<ContextRing data={data({ used_tokens: 18_400, context_window: 1_000_000 })} draftText="" />)
    expect(screen.getByTestId('context-ring-arc').tagName.toLowerCase()).toBe('path')
    expect(screen.getByTestId('context-ring-arc').getAttribute('class')).toContain('fill-')
    expect(screen.getByTestId('context-ring')).toHaveAttribute('title', '18.4k / 1M (1.8%)')
  })
  it('never animates (no spinner-like rotation or transition)', () => {
    const { container } = renderWithI18n(<ContextRing data={data({ used_tokens: 400_000 })} draftText="" />)
    const html = container.innerHTML
    expect(html).not.toMatch(/animate-|rotate|transition/)
  })
  it('is a full disc at 100%', () => {
    renderWithI18n(<ContextRing data={data({ used_tokens: 100_000 })} draftText="" />)
    expect(screen.getByTestId('context-ring-arc').tagName.toLowerCase()).toBe('circle')
  })
  it('has no arc at 0%', () => {
    renderWithI18n(<ContextRing data={data({ used_tokens: 0 })} draftText="" />)
    expect(screen.queryByTestId('context-ring-arc')).toBeNull()
  })
})

describe('ContextRing', () => {
  it('shows the percentage in its label and tone, including the draft', () => {
    renderWithI18n(<ContextRing data={data({ used_tokens: 75_000 })} draftText=""  />)
    const ring = screen.getByTestId('context-ring')
    expect(ring).toHaveAttribute('data-pct', '75')
    expect(ring).toHaveAttribute('data-tone', 'amber')
    expect(ring).toHaveAccessibleName(/75%/)
  })
  it('turns red above 90%', () => {
    renderWithI18n(<ContextRing data={data({ used_tokens: 95_000 })} draftText=""  />)
    expect(screen.getByTestId('context-ring')).toHaveAttribute('data-tone', 'red')
  })
  it('opens a sheet with the popover on tap (touch layout)', async () => {
    renderWithI18n(<ContextRing data={data()} draftText=""  />)
    await userEvent.click(screen.getByTestId('context-ring'))
    expect(await screen.findByTestId('context-popover')).toBeInTheDocument()
  })
  it('is disabled until data arrives', () => {
    renderWithI18n(<ContextRing draftText=""  />)
    expect(screen.getByTestId('context-ring')).toBeDisabled()
  })
})

describe('ContextDetails', () => {
  it('lists every breakdown component with tokens and percent, plus free space', () => {
    renderWithI18n(<ContextDetails data={data()} draftTokens={0}  />)
    const legend = screen.getByTestId('context-legend')
    for (const k of ['system', 'user_messages', 'assistant_messages', 'attachments', 'tool_results', 'skills', 'free']) {
      expect(legend.querySelector(`[data-key=${k}]`)).not.toBeNull()
    }
    const free = legend.querySelector('[data-key=free]') as HTMLElement
    expect(free).toHaveTextContent('87.7k')
    expect(free).toHaveTextContent('87.7%')
    expect(legend.querySelector('[data-key=assistant_messages]')).toHaveTextContent('10k')
  })
  it('shows a dash with a tooltip for null cache fields and the estimate badge', () => {
    renderWithI18n(<ContextDetails data={data()} draftTokens={0}  />)
    const last = within(screen.getByTestId('context-last'))
    const dashes = last.getAllByTitle('Not reported by the provider')
    expect(dashes).toHaveLength(3) // reasoning, cache read, cache write
    expect(screen.getByTestId('context-source')).toHaveTextContent('≈ estimated')
  })
  it('shows real cache numbers and the provider badge', () => {
    renderWithI18n(
      <ContextDetails
        data={data({ estimated: false, last_usage: { input_tokens: 1000, output_tokens: 200, reasoning_tokens: 50, cache_read_tokens: 900, cache_write_tokens: 100, total_tokens: 1200, source: 'provider' } })}
        draftTokens={0}
        
      />,
    )
    expect(screen.getByTestId('context-last')).toHaveTextContent('900')
    expect(screen.getByTestId('context-source')).toHaveTextContent('from provider')
  })
  it('shows the draft row only when there is a draft', () => {
    const { rerender } = renderWithI18n(<ContextDetails data={data()} draftTokens={0}  />)
    expect(screen.queryByTestId('context-draft')).toBeNull()
    rerender(<ContextDetails data={data()} draftTokens={250} />)
    expect(screen.getByTestId('context-draft')).toHaveTextContent('250')
    expect(screen.getByTestId('context-draft')).not.toHaveTextContent('pending')
  })
  it('localises to Vietnamese', () => {
    renderWithI18n(<ContextDetails data={data()} draftTokens={0}  />, 'vi')
    expect(screen.getByTestId('context-source')).toHaveTextContent('≈ ước lượng')
    expect(screen.getByText('Còn trống')).toBeInTheDocument()
  })
})
