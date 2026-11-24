import type { Quota } from '@/api/types'
import type { Lang } from '@/lib/lang'

export const MAX_TOKEN_LIMIT = 1_000_000_000_000

/** Parses the limit input: plain digits within the server range; null when empty or invalid. */
export function parseLimit(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d{1,13}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= MAX_TOKEN_LIMIT ? n : null
}

/** Share of the limit already used (0..1+), or null without a limit. */
export function usageRatio(used: number, limit: number | null): number | null {
  return limit ? used / limit : null
}

/** At or over the limit, unless the period already reset (the cached `used` is then stale). */
export function isOverQuota(q: Quota | undefined, now = Date.now()): boolean {
  if (!q || q.limit == null || q.used < q.limit) return false
  const resets = Date.parse(q.resets_at)
  return Number.isNaN(resets) || now < resets
}

/** Tailwind colour for the usage bar: amber from 80%, red from 100%. */
export function barColor(ratio: number): string {
  return ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-fg/60'
}

const LOCALES: Record<Lang, string> = { vi: 'vi-VN', en: 'en-US' }

/**
 * Local reset moment in the app language: a time of day for the daily period (with the date when it
 * falls on another local day than today), a date otherwise.
 */
export function formatReset(iso: string, period: Quota['period'], lang: Lang, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const locale = LOCALES[lang]
  if (period !== 'day') return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  return `${d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}
