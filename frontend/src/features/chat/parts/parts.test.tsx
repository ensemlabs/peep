import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { CollapsibleStep } from './CollapsibleStep'
import { ThinkingBlock } from './ThinkingBlock'
import { looksLikeMarkdown, meaningfulSummary, ToolCard } from './ToolCard'
import type { ThinkingPart, ToolPart } from '@/api/types'

describe('CollapsibleStep', () => {
  it('toggles aria-expanded and renders the body lazily', async () => {
    renderWithI18n(<CollapsibleStep testId="step-x" icon={null} title="Title"><p>BODY</p></CollapsibleStep>)
    const btn = screen.getByTestId('step-toggle')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('BODY')).toBeNull()
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('BODY')).toBeInTheDocument()
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })
  it('shows a live duration while running and no spinner or icon clutter', () => {
    const { rerender } = renderWithI18n(<CollapsibleStep testId="s" title="T" running elapsedMs={3000}>x</CollapsibleStep>)
    expect(screen.queryByTestId('spinner')).toBeNull()
    expect(screen.getByTestId('step-duration')).toHaveTextContent('3s')
    rerender(<CollapsibleStep testId="s" title="T" running={false} elapsedMs={12000}>x</CollapsibleStep>)
    expect(screen.getByTestId('step-duration')).toHaveTextContent('12s')
  })
  it('is a plain row without a box: no border or background on the root', () => {
    renderWithI18n(<CollapsibleStep testId="s" title="T">x</CollapsibleStep>)
    const cls = screen.getByTestId('s').className
    expect(cls).not.toMatch(/border|bg-|rounded/)
  })
  it('indents the opened body under a left rule', async () => {
    renderWithI18n(<CollapsibleStep testId="s" title="T" defaultOpen><p>BODY</p></CollapsibleStep>)
    expect(screen.getByText('BODY').parentElement?.className).toContain('border-l-2')
  })
  it('respects defaultOpen until the user toggles', async () => {
    renderWithI18n(<CollapsibleStep testId="s" icon={null} title="T" defaultOpen>BODY</CollapsibleStep>)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByTestId('step-toggle'))
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'false')
  })
})

const thinking = (over: Partial<ThinkingPart> = {}): ThinkingPart => ({
  id: 't', type: 'thinking', text: 'secret thoughts', status: 'done',
  started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:00:12Z', ...over,
})

describe('ThinkingBlock', () => {
  it('is collapsed when loaded from history and expands on click, showing "Thought for 12s"', async () => {
    renderWithI18n(<ThinkingBlock part={thinking()} live={false} />)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Thought for 12s')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('step-toggle'))
    expect(screen.getByText('secret thoughts')).toBeInTheDocument()
  })
  it('is expanded while streaming, showing live text under a left rule, the shimmer label and no icon or spinner', () => {
    renderWithI18n(<ThinkingBlock part={thinking({ status: 'running', ended_at: null })} live />)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('step-thinking')).toHaveAttribute('data-state', 'open')
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.getByText('secret thoughts')).toBeInTheDocument()
    expect(screen.queryByTestId('mascot')).toBeNull()
    expect(screen.queryByTestId('spinner')).toBeNull()
    expect(screen.getByTestId('thinking-panel')).toHaveAttribute('data-clamped', 'true')
    expect(screen.getByTestId('thinking-label')).toHaveAttribute('data-shimmer', 'true')
    expect(screen.getByTestId('thinking-label')).toHaveClass('shimmer-text')
    expect(document.querySelector('.lucide-lightbulb')).toBeNull() // no icon while running
    expect(screen.getByTestId('step-duration')).toBeInTheDocument()
  })
  it('shows no icon and no shimmer once done, only the duration label with a chevron', () => {
    renderWithI18n(<ThinkingBlock part={thinking()} live={false} />)
    expect(document.querySelector('.lucide-lightbulb')).toBeNull()
    expect(document.querySelector('.lucide-chevron-right')).not.toBeNull()
    expect(screen.getByTestId('thinking-label')).toHaveAttribute('data-shimmer', 'false')
    expect(screen.getByTestId('thinking-label')).not.toHaveClass('shimmer-text')
  })
  it('auto-collapses once when done', () => {
    const { rerender } = renderWithI18n(<ThinkingBlock part={thinking({ status: 'running', ended_at: null })} live />)
    rerender(<ThinkingBlock part={thinking()} live />)
    expect(screen.getByTestId('step-thinking')).toHaveAttribute('data-state', 'closed')
    expect(screen.getByText('Thought for 12s')).toBeInTheDocument()
  })
  it('lets the user toggle freely afterwards', async () => {
    const { rerender } = renderWithI18n(<ThinkingBlock part={thinking({ status: 'running', ended_at: null })} live />)
    rerender(<ThinkingBlock part={thinking()} live />)
    await userEvent.click(screen.getByTestId('step-toggle'))
    expect(screen.getByTestId('step-thinking')).toHaveAttribute('data-state', 'open')
    await userEvent.click(screen.getByTestId('step-toggle'))
    expect(screen.getByTestId('step-thinking')).toHaveAttribute('data-state', 'closed')
  })
  it('respects a manual toggle made during streaming (no auto-collapse)', async () => {
    const { rerender } = renderWithI18n(<ThinkingBlock part={thinking({ status: 'running', ended_at: null })} live />)
    await userEvent.click(screen.getByTestId('step-toggle')) // user closes
    await userEvent.click(screen.getByTestId('step-toggle')) // user reopens
    rerender(<ThinkingBlock part={thinking()} live />)
    expect(screen.getByTestId('step-thinking')).toHaveAttribute('data-state', 'open')
  })
  it('renders markdown in the thinking text (bold, flat headings, no raw HTML)', async () => {
    renderWithI18n(<ThinkingBlock part={thinking({ text: '**Calculated divisors**\n\n# Big heading\n\n<b>raw</b> text' })} live={false} />)
    await userEvent.click(screen.getByTestId('step-toggle'))
    const panel = screen.getByTestId('thinking-text')
    expect(panel.querySelector('strong')?.textContent).toBe('Calculated divisors')
    expect(panel.textContent).not.toContain('**')
    expect(panel.querySelector('h1')).toBeNull()
    expect(panel.querySelector('b')).toBeNull()
  })
  it('localises the label in Vietnamese', () => {
    renderWithI18n(<ThinkingBlock part={thinking()} live={false} />, 'vi')
    expect(screen.getByText('Đã suy nghĩ 12 giây')).toBeInTheDocument()
  })
})

describe('ToolCard', () => {
  const tool = (over: Partial<ToolPart> = {}): ToolPart => ({
    id: 'x', type: 'tool', name: 'web_search', input: { query: 'cats' }, output: null, files: [],
    status: 'running', started_at: '2026-01-01T00:00:00Z', ...over,
  })
  it('is expanded while running and collapsed when done', () => {
    const { unmount } = renderWithI18n(<ToolCard part={tool()} live />)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('web_search')).toBeInTheDocument()
    unmount()
    renderWithI18n(<ToolCard part={tool({ status: 'done', output: '{"a":1}' })} live={false} />)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'false')
  })
  it('reads "Running name…" with a shimmer, then "Ran name · summary", red text on error', () => {
    const { rerender } = renderWithI18n(<ToolCard part={tool()} live />)
    expect(screen.getByTestId('tool-label')).toHaveTextContent('Running web_search · cats…')
    expect(screen.getByTestId('tool-label')).toHaveAttribute('data-shimmer', 'true')
    rerender(<ToolCard part={tool({ status: 'done', output: 'x' })} live={false} />)
    expect(screen.getByTestId('tool-label')).toHaveTextContent('Ran web_search')
    expect(screen.getByTestId('tool-label')).toHaveAttribute('data-shimmer', 'false')
    rerender(<ToolCard part={tool({ status: 'error' })} live={false} />)
    expect(screen.getByTestId('tool-label')).toHaveTextContent('Failed web_search')
    expect(screen.getByTestId('step-toggle').className).toContain('text-danger')
  })
  it('renders produced media directly under the row, without expanding', () => {
    const file = { id: 'f1', kind: 'image' as const, mime: 'image/png', filename: 'a.png', size: 1, width: 10, height: 10, url: '/u', thumb_url: '/t', download_url: '/d' }
    renderWithI18n(<ToolCard part={tool({ status: 'done', files: [file], output: 'x' })} live={false} />)
    expect(screen.getByTestId('step-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('gallery')).toBeInTheDocument()
  })
})

describe('looksLikeMarkdown', () => {
  it('keeps raw multi-line output verbatim but renders real markdown', () => {
    expect(looksLikeMarkdown('def f(n):\n    return n')).toBe(false)
    expect(looksLikeMarkdown('Synthesised 5.0 s of audio.')).toBe(false)
    expect(looksLikeMarkdown('## Title\n\n- a\n- b')).toBe(true)
    expect(looksLikeMarkdown('see [docs](http://x)')).toBe(true)
  })
})

describe('tool summaries', () => {
  it('drops empty or punctuation-only summaries', () => {
    expect(meaningfulSummary('')).toBe('')
    expect(meaningfulSummary('.')).toBe('')
    expect(meaningfulSummary('  . ')).toBe('')
    expect(meaningfulSummary('/')).toBe('')
    expect(meaningfulSummary('a')).toBe('')
    expect(meaningfulSummary('src/primes.py')).toBe('src/primes.py')
    expect(meaningfulSummary('ls')).toBe('ls')
  })
  it('renders "Ran run_tests 2s" without a dangling dot for a tiny summary', () => {
    const t: ToolPart = { id: 'x', type: 'tool', name: 'run_tests', input: { path: '.' }, output: 'ok', files: [], status: 'done', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:00:02Z' }
    renderWithI18n(<ToolCard part={t} live={false} />)
    expect(screen.getByTestId('tool-label')).toHaveTextContent(/^Ran run_tests$/)
    expect(screen.getByTestId('step-toggle')).toHaveTextContent('Ran run_tests2s')
  })
})
