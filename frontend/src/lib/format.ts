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
