import { readStorage } from './storage'

export type Lang = 'en' | 'vi'
export const LANG_KEY = 'ec_lang'

/** Saved choice, else navigator.language (vi* -> vi, anything else -> en). */
export function detectLang(): Lang {
  const saved = readStorage(LANG_KEY)
  if (saved === 'en' || saved === 'vi') return saved
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}
