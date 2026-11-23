export type Translate = (key: 'time.s' | 'time.ms', vars?: Record<string, string | number>) => string

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** Human duration from milliseconds: "12s" / "1m 5s" (localised through `t`). */
export function formatDuration(ms: number, t: Translate): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return t('time.s', { n: total })
  return t('time.ms', { m: Math.floor(total / 60), s: total % 60 })
}

export function formatSeconds(totalSeconds: number, t: Translate): string {
  return formatDuration(totalSeconds * 1000, t)
}

export function toMillis(iso: string | undefined | null): number | null {
  if (!iso) return null
  const v = Date.parse(iso)
  return Number.isNaN(v) ? null : v
}

/** Compact token counts: 950, 1.2k, 12.3k, 128k, 1M, 1.5M. */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const trim = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''))
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${trim(n / 1000)}k`
  return `${trim(n / 1_000_000)}M`
}

export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number | null
  source: 'provider' | 'estimate'
}

/** "≈ 1.2k → 340 · cache 900" (≈ only for estimates, cache only when reported). */
export function usageSummary(u: UsageLike): string {
  const main = `${formatTokens(u.input_tokens)} → ${formatTokens(u.output_tokens)}`
  const cache = u.cache_read_tokens != null ? ` · cache ${formatTokens(u.cache_read_tokens)}` : ''
  return `${u.source === 'estimate' ? '≈ ' : ''}${main}${cache}`
}

export function timeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}
