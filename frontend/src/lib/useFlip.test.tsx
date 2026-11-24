import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { flipHandoff, useFlip } from './useFlip'

function Probe({ k, top }: { k: boolean; top: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useFlip(ref, k)
  return <div ref={ref} data-top={top} />
}

afterEach(() => {
  flipHandoff.top = null
  vi.restoreAllMocks()
})

describe('useFlip', () => {
  it('animates from the handed-over position on a fresh mount (page remount after creating a chat)', () => {
    const animate = vi.fn()
    Element.prototype.animate = animate as never
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700 } as DOMRect)
    flipHandoff.top = 300
    flipHandoff.at = Date.now()
    render(<Probe k={false} top={0} />)
    expect(animate).toHaveBeenCalledTimes(1)
    expect((animate.mock.calls[0][0] as { transform: string }[])[0].transform).toBe('translateY(-400px)')
  })
  it('ignores a stale handoff and does nothing without movement', () => {
    const animate = vi.fn()
    Element.prototype.animate = animate as never
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700 } as DOMRect)
    flipHandoff.top = 300
    flipHandoff.at = Date.now() - 5000
    render(<Probe k={false} top={0} />)
    expect(animate).not.toHaveBeenCalled()
  })
  it('skips the animation under prefers-reduced-motion', () => {
    const animate = vi.fn()
    Element.prototype.animate = animate as never
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700 } as DOMRect)
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never
    flipHandoff.top = 300
    flipHandoff.at = Date.now()
    render(<Probe k={false} top={0} />)
    expect(animate).not.toHaveBeenCalled()
  })
})
