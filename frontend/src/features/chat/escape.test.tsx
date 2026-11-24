import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { shouldStopOnEscape, useEscapeToStop } from './escape'

function Harness({ enabled, onStop }: { enabled: boolean; onStop: () => void }) {
  useEscapeToStop(enabled, onStop)
  return null
}

describe('Escape-to-stop guards', () => {
  const press = (target: Element | Document, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: 'Escape', ...init })
  const setup = () => {
    const onStop = vi.fn()
    render(<Harness enabled onStop={onStop} />)
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
    const { rerender } = render(<Harness enabled onStop={vi.fn()} />)
    const before = add.mock.calls.filter((c) => c[0] === 'keydown').length
    for (let i = 0; i < 5; i++) rerender(<Harness enabled onStop={vi.fn()} />)
    expect(add.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(before)
    add.mockRestore()
  })
  it('does nothing when disabled', () => {
    const onStop = vi.fn()
    render(<Harness enabled={false} onStop={onStop} />)
    press(document.body)
    expect(onStop).not.toHaveBeenCalled()
  })
})
