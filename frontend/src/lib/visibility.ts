/** Run `fn` now if the tab is visible, else on the next switch to visible. Returns a cancel function. */
export function whenVisible(fn: () => void): () => void {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    fn()
    return () => {}
  }
  const onChange = () => {
    if (document.visibilityState !== 'visible') return
    document.removeEventListener('visibilitychange', onChange)
    fn()
  }
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
