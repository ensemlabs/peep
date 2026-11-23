import { useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from './storage'

export type ThemePref = 'light' | 'dark' | 'system'
export const THEME_KEY = 'ec_theme'
const QUERY = '(prefers-color-scheme: dark)'

export function getStoredTheme(): ThemePref {
  const v = readStorage(THEME_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

/** Mirrors public/theme-init.js: concrete theme on <html> as data-theme and .dark. */
export function applyTheme(pref: ThemePref): void {
  const dark = resolveTheme(pref) === 'dark'
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
}

let current: ThemePref = getStoredTheme()
const listeners = new Set<() => void>()

export function setTheme(pref: ThemePref): void {
  current = pref
  writeStorage(THEME_KEY, pref)
  applyTheme(pref)
  listeners.forEach((l) => l())
}

/** Re-apply when the OS scheme flips while the preference is "system". Returns a cleanup. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const m = window.matchMedia(QUERY)
  const onChange = () => {
    if (current === 'system') applyTheme('system')
  }
  m.addEventListener?.('change', onChange)
  return () => m.removeEventListener?.('change', onChange)
}

export function initTheme(): () => void {
  current = getStoredTheme()
  applyTheme(current)
  return watchSystemTheme()
}

export function useTheme(): { theme: ThemePref; setTheme: (p: ThemePref) => void } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => 'system' as ThemePref,
  )
  return { theme, setTheme }
}
