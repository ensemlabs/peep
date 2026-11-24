import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type TKey } from './en'
import { vi } from './vi'
import { writeStorage } from '@/lib/storage'
import { detectLang, LANG_KEY, type Lang } from '@/lib/lang'
import { ApiError } from '@/api/client'

export type { Lang }
export type { TKey }
export type Vars = Record<string, string | number>

const DICTS: Record<Lang, Record<TKey, string>> = { en, vi }
const STORAGE_KEY = LANG_KEY

export { detectLang }

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/**
 * Plural rule: when `vars.n` is a number and the language's plural category is "one" (English: exactly 1),
 * a `<key>_one` entry is used if it exists; otherwise the plain key is the "other" form.
 * Vietnamese has no plural, so it always uses the plain key.
 */
export function translate(lang: Lang, key: TKey, vars?: Vars): string {
  const dict = DICTS[lang] as Record<string, string>
  if (typeof vars?.n === 'number' && new Intl.PluralRules(lang).select(vars.n) === 'one') {
    const one = dict[`${key}_one`]
    if (one) return interpolate(one, vars)
  }
  return interpolate(DICTS[lang][key] ?? en[key], vars)
}

export type TFn = (key: TKey, vars?: Vars) => string

const KNOWN_ERRORS = new Set([
  'invalid_credentials', 'account_disabled', 'account_pending', 'too_many_attempts', 'email_taken',
  'weak_password', 'invalid_email', 'invalid_reasoning_level', 'invalid_skill', 'skill_exists', 'invalid_plugin', 'plugin_exists', 'too_many_plugins', 'file_in_use', 'secrets_not_configured', 'invalid_display_name', 'invalid_current_password', 'file_too_large', 'unsupported_type', 'cannot_modify_self',
  'bad_origin', 'run_in_progress', 'invalid_model', 'empty_message', 'invalid_attachment', 'empty_file', 'invalid_request', 'forbidden', 'unauthenticated', 'not_found',
])

function waitText(seconds: number, t: TFn): string {
  if (seconds < 90) return t('time.seconds', { n: Math.max(1, Math.ceil(seconds)) })
  if (seconds < 5400) return t('time.minutes', { n: Math.ceil(seconds / 60) })
  return t('time.hours', { n: Math.ceil(seconds / 3600) })
}

/** Map any thrown value to a translated message; never exposes raw backend text. */
export function errorMessage(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.code === 'too_many_attempts') {
      return err.retryAfter
        ? t('error.too_many_attempts', { time: waitText(err.retryAfter, t) })
        : t('error.too_many_attempts_unknown')
    }
    if (err.code === 'network') return t('error.network')
    if (KNOWN_ERRORS.has(err.code)) return t(`error.${err.code}` as TKey)
    if (err.status === 413) return t('error.file_too_large')
    if (err.status === 415) return t('error.unsupported_type')
  }
  if (err instanceof TypeError) return t('error.network')
  return t('error.generic')
}

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: TFn
  err: (e: unknown) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? detectLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    writeStorage(STORAGE_KEY, l)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const value = useMemo<I18nValue>(() => {
    const t: TFn = (key, vars) => translate(lang, key, vars)
    return { lang, setLang, t, err: (e) => errorMessage(e, t) }
  }, [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}

export function useT(): TFn {
  return useI18n().t
}
