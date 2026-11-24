import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Position handed over from a page that is about to unmount (creating a chat navigates to /c/:id,
 * which remounts the page): the next `useFlip` mount animates from it.
 */
export const flipHandoff: { top: number | null; at: number } = { top: null, at: 0 }

/**
 * FLIP: when `key` changes and the element moved (e.g. the composer going from the middle of an empty
 * page to the bottom), animate from its old position to the new one with a transform. Skipped under
 * prefers-reduced-motion.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, key: unknown, ms = 320): void {
  const prevTop = useRef<number | null>(null)
  const prevKey = useRef(key)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (prevTop.current === null && flipHandoff.top !== null) {
      if (Date.now() - flipHandoff.at < 2000) prevTop.current = flipHandoff.top
      flipHandoff.top = null
      prevKey.current = !key // treat the first commit as a change
    }
    if (prevKey.current !== key && prevTop.current !== null) {
      const dy = prevTop.current - top
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (Math.abs(dy) > 1 && !reduced && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    prevKey.current = key
    prevTop.current = top
  })
}
