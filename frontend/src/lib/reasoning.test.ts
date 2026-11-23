import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelInfo } from '@/api/types'
import { levelMode, loadLevels, resolveLevel, saveLevel } from './reasoning'
import { formatTokens } from './format'

const model = (levels: string[], def = levels[0]): ModelInfo => ({
  id: 'm', label: 'M', provider: 'openai', context_window: 1000,
  reasoning: levels.length ? { levels: levels.map((id) => ({ id, label: id })), default: def } : null,
})

beforeEach(() => localStorage.clear())

describe('reasoning levels', () => {
  it('is hidden without reasoning or levels', () => {
    expect(levelMode({ ...model([]), reasoning: null })).toBe('hidden')
    expect(levelMode(model([]))).toBe('hidden')
    expect(levelMode(undefined)).toBe('hidden')
    expect(resolveLevel(model([]), 'high')).toBeNull()
  })
  it('is a static chip with exactly one level', () => {
    expect(levelMode(model(['always']))).toBe('single')
    expect(resolveLevel(model(['always']), undefined)).toBe('always')
  })
  it('is a dropdown with several levels and uses the default when nothing is stored', () => {
    const m = model(['off', 'low', 'high'], 'low')
    expect(levelMode(m)).toBe('multi')
    expect(resolveLevel(m, undefined)).toBe('low')
    expect(resolveLevel(m, 'high')).toBe('high')
  })
  it('falls back to the default when the stored level is no longer valid', () => {
    expect(resolveLevel(model(['off', 'high'], 'off'), 'max')).toBe('off')
  })
  it('falls back to the first level when the default is not in the list', () => {
    expect(resolveLevel(model(['a', 'b'], 'zzz'), undefined)).toBe('a')
  })
  it('persists the choice per model id', () => {
    let l = saveLevel({}, 'a', 'high')
    l = saveLevel(l, 'b', 'off')
    expect(loadLevels()).toEqual({ a: 'high', b: 'off' })
  })
  it('ignores corrupt storage', () => {
    localStorage.setItem('ec_levels', '[1,2')
    expect(loadLevels()).toEqual({})
    localStorage.setItem('ec_levels', '[1]')
    expect(loadLevels()).toEqual({})
  })
})

describe('formatTokens', () => {
  it.each([[0, '0'], [950, '950'], [1200, '1.2k'], [12345, '12.3k'], [128000, '128k'], [1_000_000, '1M'], [1_500_000, '1.5M']])('%s -> %s', (n, out) => {
    expect(formatTokens(n)).toBe(out)
  })
  it('shows a dash for null', () => expect(formatTokens(null)).toBe('—'))
})
