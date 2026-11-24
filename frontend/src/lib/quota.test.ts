import { describe, expect, it } from 'vitest'
import { barColor, formatReset, isOverQuota, parseLimit } from './quota'

describe('parseLimit', () => {
  it.each([['100000', 100000], [' 42 ', 42], ['1000000000000', 1_000_000_000_000]])('%s -> %s', (raw, out) => expect(parseLimit(raw)).toBe(out))
  it.each([[''], ['0'], ['12.5'], ['-3'], ['1e5'], ['abc'], ['1000000000001']])('%s is invalid', (raw) => expect(parseLimit(raw)).toBeNull())
})

describe('quota helpers', () => {
  it('bar colour thresholds', () => {
    expect(barColor(0.5)).toContain('fg')
    expect(barColor(0.8)).toContain('amber')
    expect(barColor(1)).toContain('danger')
  })
  it('over quota only with a limit reached', () => {
    const q = { limit: 10, period: 'day' as const, used: 10, resets_at: '' }
    expect(isOverQuota(q)).toBe(true)
    expect(isOverQuota({ ...q, used: 9 })).toBe(false)
    expect(isOverQuota({ ...q, limit: null })).toBe(false)
    expect(isOverQuota(undefined)).toBe(false)
  })
  it('treats an expired period as not over quota', () => {
    const q = { limit: 10, period: 'day' as const, used: 10, resets_at: '2026-11-25T00:00:00Z' }
    expect(isOverQuota(q, Date.parse('2026-11-24T23:59:59Z'))).toBe(true)
    expect(isOverQuota(q, Date.parse('2026-11-25T00:00:00Z'))).toBe(false)
  })
})

describe('formatReset', () => {
  const iso = '2026-11-25T10:30:00'
  it('shows only the time when the reset is today, with the date otherwise', () => {
    const same = formatReset(iso, 'day', 'en', new Date('2026-11-25T01:00:00'))
    const other = formatReset(iso, 'day', 'en', new Date('2026-11-24T01:00:00'))
    expect(same).toMatch(/^\d{2}:\d{2}/)
    expect(other).toContain('Wed')
    expect(other.length).toBeGreaterThan(same.length)
  })
  it('uses the app language', () => {
    expect(formatReset('2026-12-01T00:00:00', 'month', 'vi')).toContain('thg')
    expect(formatReset('2026-12-01T00:00:00', 'month', 'en')).toContain('Dec')
  })
})
