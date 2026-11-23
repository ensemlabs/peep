import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration } from './format'
import { translate } from '@/i18n'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'], [512, '512 B'], [1024, '1 KB'], [1536, '1.5 KB'], [5 * 1024 * 1024, '5 MB'], [1024 ** 3 * 2.5, '2.5 GB'],
  ])('%s -> %s', (n, out) => expect(formatBytes(n)).toBe(out))
  it('returns empty for invalid', () => expect(formatBytes(-1)).toBe(''))
})

describe('formatDuration', () => {
  const en = (k: 'time.s' | 'time.ms', v?: Record<string, string | number>) => translate('en', k, v)
  const vi = (k: 'time.s' | 'time.ms', v?: Record<string, string | number>) => translate('vi', k, v)
  it('seconds', () => expect(formatDuration(12_400, en)).toBe('12s'))
  it('minutes', () => expect(formatDuration(65_000, en)).toBe('1m 5s'))
  it('vietnamese', () => expect(formatDuration(12_000, vi)).toBe('12 giây'))
  it('clamps negatives', () => expect(formatDuration(-5, en)).toBe('0s'))
})
