import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useVisualViewport } from './useVisualViewport'

function Probe() {
  useVisualViewport()
  return null
}

describe('useVisualViewport', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport')
    document.documentElement.style.removeProperty('--vvh')
  })
  it('keeps --vvh equal to the visual viewport height (keyboard open/close) and cleans up', () => {
    const vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    const { unmount } = render(<Probe />)
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('800px')
    vv.height = 480 // keyboard opens
    vv.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('480px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('')
  })
  it('scrolls the page back to the top while the viewport is offset', () => {
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 120 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<Probe />)
    expect(scroll).toHaveBeenCalledWith(0, 0)
    scroll.mockRestore()
  })
  it('does nothing without visualViewport support', () => {
    expect(() => render(<Probe />)).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('')
  })
})
