import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { translate } from '@/i18n'
import { skillUploadError, stripFrontmatter } from './skills'
import { buildHeaders, renamedWithoutValue, toHeaderRows, type HeaderRow } from './plugins'

const en = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v)
const vi = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('vi', k, v)

describe('skillUploadError', () => {
  it('maps 422 invalid_skill to a translated message without replace', () => {
    const r = skillUploadError(new ApiError('invalid_skill', 422, 'RAW zip-slip detected'), vi)
    expect(r.message).toBe(vi('error.invalid_skill'))
    expect(r.message).not.toContain('RAW')
    expect(r.canReplace).toBe(false)
  })
  it('offers Replace on 409 skill_exists', () => {
    const r = skillUploadError(new ApiError('skill_exists', 409, 'x'), en)
    expect(r).toEqual({ message: en('error.skill_exists'), canReplace: true })
  })
  it('falls back to generic / network', () => {
    expect(skillUploadError(new ApiError('boom', 500, 'x'), en).message).toBe(en('error.generic'))
    expect(skillUploadError(new ApiError('network', 0, 'x'), en).message).toBe(en('error.network'))
  })
  it('strips YAML frontmatter for display', () => {
    expect(stripFrontmatter('---\nname: a\ndescription: b\n---\n# Title\nbody')).toBe('# Title\nbody')
    expect(stripFrontmatter('# no frontmatter')).toBe('# no frontmatter')
  })
})

describe('plugin header editing', () => {
  const rows = () => toHeaderRows([{ name: 'Authorization', value_masked: 'Bea…••••' }, { name: 'X-Key', value_masked: '••••' }])
  it('loads existing headers masked with an empty editable value', () => {
    const r = rows()
    expect(r[0]).toMatchObject({ name: 'Authorization', value: '', masked: 'Bea…••••' })
  })
  it('sends value:null for untouched existing headers (server keeps the secret)', () => {
    expect(buildHeaders(rows())).toEqual([{ name: 'Authorization', value: null }, { name: 'X-Key', value: null }])
  })
  it('sends the new value only for retyped headers', () => {
    const r = rows()
    r[1] = { ...r[1], value: 'new-secret' }
    expect(buildHeaders(r)).toEqual([{ name: 'Authorization', value: null }, { name: 'X-Key', value: 'new-secret' }])
  })
  it('sends typed values for new rows and skips rows without a name', () => {
    const fresh: HeaderRow[] = [
      { key: 'a', name: 'X-New', value: 'v', masked: null, origName: null, show: false },
      { key: 'b', name: '  ', value: 'ignored', masked: null, origName: null, show: false },
      { key: 'c', name: 'X-Empty', value: '', masked: null, origName: null, show: false },
    ]
    expect(buildHeaders(fresh)).toEqual([{ name: 'X-New', value: 'v' }, { name: 'X-Empty', value: '' }])
  })

  it('flags a renamed existing header that has no new value (would be a 422)', () => {
    const r = rows()
    expect(renamedWithoutValue(r)).toEqual([])
    r[0] = { ...r[0], name: 'X-Auth' }
    expect(renamedWithoutValue(r)).toEqual([r[0].key])
    r[0] = { ...r[0], value: 'retyped' }
    expect(renamedWithoutValue(r)).toEqual([])
    // case-only changes keep the value on the server (names are case-insensitive)
    r[1] = { ...r[1], name: 'x-key' }
    expect(renamedWithoutValue(r)).toEqual([])
  })
})
