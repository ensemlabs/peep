import { useEffect } from 'react'

/**
 * Keeps `--vvh` equal to the visual viewport height so the app shell (and the composer pinned to its
 * bottom) stays above the on-screen keyboard even where the layout viewport does not shrink (iOS Safari).
 * While the keyboard is open the page is held at scroll 0 so the header cannot slide behind the notch.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--vvh')
    }
  }, [])
}
