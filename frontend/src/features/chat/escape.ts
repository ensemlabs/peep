import { useEffect, useRef } from 'react'

/** Escape stops the run only when it is not already doing something else. */
export function shouldStopOnEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  if (e.isComposing || e.keyCode === 229) return false // IME composition
  const el = e.target instanceof HTMLElement ? e.target : null
  // The chat composer is the one text field where Esc stops the run (focus stays there after sending).
  if (el && !el.closest('[data-composer]') && (el.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]') || el.isContentEditable)) return false
  // Open dialogs, menus, poppers and the mobile drawer consume Escape first.
  if (document.querySelector('[role=dialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper],[data-testid=sidebar][data-open=true]')) return false
  return true
}

/** Esc-to-stop while a run is going. The listener is bound once; the latest handler lives in a ref. */
export function useEscapeToStop(enabled: boolean, onStop: () => void): void {
  const ref = useRef(onStop)
  ref.current = onStop
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (shouldStopOnEscape(e)) ref.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
