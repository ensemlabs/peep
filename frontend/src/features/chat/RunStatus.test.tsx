import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithI18n } from '@/test/utils'
import { RunStatus, shouldStopOnEscape, statusMascotState, streamedChars, tokenText } from './RunStatus'
import { EnsembleLogo } from '@/components/EnsembleLogo'
import { render } from '@testing-library/react'
import type { Message } from '@/api/types'

const T = '2026-01-01T00:00:00Z'
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm', role: 'assistant', content: '', attachments: [], parts: [], status: 'streaming', model: 'x', created_at: new Date().toISOString(), ...over,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('RunStatus', () => {
  it('rotates the playful verb every 2.5 s (and wraps)', () => {
    renderWithI18n(<RunStatus message={msg()} />)
    expect(screen.getByTestId('run-verb')).toHaveTextContent('Thinking…')
    act(() => void vi.advanceTimersByTime(2500))
    expect(screen.getByTestId('run-verb')).toHaveTextContent('Pondering…')
    act(() => void vi.advanceTimersByTime(2500))
    expect(screen.getByTestId('run-verb')).toHaveTextContent('Tinkering…')
    act(() => void vi.advanceTimersByTime(2500 * 6))
    expect(screen.getByTestId('run-verb')).toHaveTextContent('Thinking…')
  })
  it('localises the verbs', () => {
    renderWithI18n(<RunStatus message={msg()} />, 'vi')
    expect(screen.getByTestId('run-verb')).toHaveTextContent('Đang suy nghĩ…')
  })
  it('shows a ticking elapsed timer', () => {
    renderWithI18n(<RunStatus message={msg()} />)
    expect(screen.getByTestId('run-elapsed')).toHaveTextContent('0s')
    act(() => void vi.advanceTimersByTime(12_000))
    expect(screen.getByTestId('run-elapsed')).toHaveTextContent('12s')
  })
  it('estimates output tokens from streamed characters until usage arrives', () => {
    const m = msg({ parts: [{ id: 't', type: 'text', text: 'x'.repeat(2000) }] })
    expect(streamedChars(m.parts)).toBe(2000)
    expect(tokenText(m)).toBe('≈ ↓ 500')
    renderWithI18n(<RunStatus message={m} />)
    expect(screen.getByTestId('run-tokens')).toHaveTextContent('≈ ↓ 500')
  })
  it('shows real input/output once usage is known', () => {
    const m = msg({ usage: { input_tokens: 1200, output_tokens: 340, reasoning_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 1540, source: 'provider' } })
    expect(tokenText(m)).toBe('↑ 1.2k ↓ 340')
  })
  it('Pip follows the running part, defaulting to working', () => {
    expect(statusMascotState(msg({ parts: [{ id: 'a', type: 'thinking', text: '', status: 'running', started_at: T }] }))).toBe('thinking')
    expect(statusMascotState(msg({ parts: [{ id: 'a', type: 'tool', name: 'n', input: {}, output: null, files: [], status: 'running', started_at: T }] }))).toBe('working')
    expect(statusMascotState(msg({ parts: [{ id: 'a', type: 'text', text: 'hi' }] }))).toBe('working')
  })
  it('Esc stops the run, but not while a dialog is open', () => {
    const onStop = vi.fn()
    renderWithI18n(<RunStatus message={msg()} onStop={onStop} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onStop).toHaveBeenCalledTimes(1)
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    document.body.appendChild(dlg)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onStop).toHaveBeenCalledTimes(1)
    dlg.remove()
    expect(screen.getByText('Esc to stop')).toBeInTheDocument()
  })
  it('does not react to Esc while leaving', () => {
    const onStop = vi.fn()
    renderWithI18n(<RunStatus message={msg()} onStop={onStop} leaving />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onStop).not.toHaveBeenCalled()
    expect(screen.getByTestId('run-status')).toHaveAttribute('data-leaving', 'true')
  })
})

describe('EnsembleLogo', () => {
  it('renders the sigma path and the blue dot', () => {
    const { container } = render(<EnsembleLogo size={32} />)
    const svg = screen.getByTestId('ensemble-logo')
    expect(svg).toHaveAttribute('viewBox', '95 110 195 215')
    expect(container.querySelector('path')).toHaveAttribute('stroke-linecap', 'round')
    expect(container.querySelector('circle')).toHaveAttribute('fill', '#4f7cf7')
  })
})

describe('Escape-to-stop guards', () => {
  const press = (target: Element | Document, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: 'Escape', ...init })
  const setup = () => {
    const onStop = vi.fn()
    renderWithI18n(<RunStatus message={msg()} onStop={onStop} />)
    return onStop
  }
  it('stops when focus is on the page body', () => {
    const onStop = setup()
    press(document.body)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
  it('stops from the composer textarea (focus stays there after sending)', () => {
    const onStop = setup()
    const host = document.createElement('div')
    host.innerHTML = '<textarea data-composer aria-label="composer"></textarea>'
    document.body.appendChild(host)
    press(host.firstElementChild as Element)
    expect(onStop).toHaveBeenCalledTimes(1)
    press(host.firstElementChild as Element, { isComposing: true }) // IME in the composer: no
    press(host.firstElementChild as Element, { keyCode: 229 })
    expect(onStop).toHaveBeenCalledTimes(1)
    host.remove()
  })
  it('does not stop from the header rename input, the sidebar search, dialog fields or a select', () => {
    const onStop = setup()
    for (const html of ['<input aria-label="rename">', '<input type="search" aria-label="search">', '<select aria-label="s"><option>a</option></select>', '<textarea aria-label="other field"></textarea>']) {
      const host = document.createElement('div')
      host.innerHTML = html
      document.body.appendChild(host)
      press(host.firstElementChild as Element)
      host.remove()
    }
    expect(onStop).not.toHaveBeenCalled()
  })
  it('does not stop during IME composition', () => {
    const onStop = setup()
    press(document.body, { isComposing: true })
    press(document.body, { keyCode: 229 })
    expect(onStop).not.toHaveBeenCalled()
  })
  it('does not stop while the mobile drawer, a menu or a popper is open', () => {
    const onStop = setup()
    const drawer = document.createElement('aside')
    drawer.dataset.testid = 'sidebar'
    drawer.dataset.open = 'true'
    document.body.appendChild(drawer)
    press(document.body)
    drawer.remove()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    press(document.body)
    menu.remove()
    expect(onStop).not.toHaveBeenCalled()
    press(document.body)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
  it('ignores handled events and other keys', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    ev.preventDefault()
    expect(shouldStopOnEscape(ev)).toBe(false)
    expect(shouldStopOnEscape(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
  })
  it('does not rebind the key listener on every re-render', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const onStop = vi.fn()
    const { rerender } = renderWithI18n(<RunStatus message={msg()} onStop={onStop} />)
    const before = add.mock.calls.filter((c) => c[0] === 'keydown').length
    for (let i = 0; i < 5; i++) rerender(<RunStatus message={msg({ content: String(i) })} onStop={vi.fn()} />)
    expect(add.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(before)
    add.mockRestore()
  })
  it('announces only start and finish to screen readers', () => {
    const { rerender } = renderWithI18n(<RunStatus message={msg()} />)
    expect(screen.getByTestId('run-status-sr')).toHaveTextContent('Working…')
    expect(screen.getByTestId('run-elapsed').closest('[aria-hidden]')).not.toBeNull()
    rerender(<RunStatus message={msg()} leaving />)
    expect(screen.getByTestId('run-status-sr')).toHaveTextContent('Response finished')
  })
})
