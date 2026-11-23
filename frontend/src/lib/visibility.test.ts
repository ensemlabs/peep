import { afterEach, describe, expect, it, vi } from 'vitest'
import { whenVisible } from './visibility'

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
}
afterEach(() => setVisibility('visible'))

describe('whenVisible', () => {
  it('runs immediately when the tab is visible', () => {
    const fn = vi.fn()
    whenVisible(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('waits for the tab to become visible, then runs once', () => {
    setVisibility('hidden')
    const fn = vi.fn()
    whenVisible(fn)
    expect(fn).not.toHaveBeenCalled()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).not.toHaveBeenCalled()
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('can be cancelled', () => {
    setVisibility('hidden')
    const fn = vi.fn()
    const cancel = whenVisible(fn)
    cancel()
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).not.toHaveBeenCalled()
  })
})
