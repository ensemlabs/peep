import { describe, expect, it } from 'vitest'
import { en } from './en'
import { vi } from './vi'
import { ApiError } from '@/api/client'
import { detectLang, errorMessage, interpolate, translate } from './index'

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('vi', k, v)

describe('i18n', () => {
  it('vi and en have identical key sets', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort())
  })
  it('has no empty strings and matching placeholders', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vi[k]).toBeTruthy()
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
      expect(ph(vi[k]), k).toBe(ph(en[k]))
    }
  })
  it('interpolates {name}', () => {
    expect(interpolate('Hi {name}, {n}!', { name: 'A', n: 3 })).toBe('Hi A, 3!')
    expect(interpolate('Hi {x}', {})).toBe('Hi {x}')
  })
  it('detects language from navigator and persists', () => {
    localStorage.clear()
    Object.defineProperty(navigator, 'language', { value: 'vi-VN', configurable: true })
    expect(detectLang()).toBe('vi')
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    expect(detectLang()).toBe('en')
    localStorage.setItem('ec_lang', 'vi')
    expect(detectLang()).toBe('vi')
  })
})

describe('errorMessage', () => {
  const codes = [
    'invalid_credentials', 'account_disabled', 'account_pending', 'email_taken', 'weak_password', 'invalid_email',
    'invalid_display_name', 'invalid_current_password', 'file_too_large', 'unsupported_type', 'cannot_modify_self',
    'bad_origin', 'run_in_progress', 'invalid_model', 'empty_message', 'invalid_attachment', 'empty_file', 'invalid_request', 'forbidden', 'unauthenticated',
  ]
  it.each(codes)('maps %s to a translated message, not backend text', (code) => {
    const msg = errorMessage(new ApiError(code, 400, 'RAW BACKEND ENGLISH'), t)
    expect(msg).not.toContain('RAW BACKEND')
    expect(msg).toBe(vi[`error.${code}` as keyof typeof vi])
  })
  it('shows retry time on lockout', () => {
    expect(errorMessage(new ApiError('too_many_attempts', 429, 'x', 900), t)).toContain('15 phút')
    expect(errorMessage(new ApiError('too_many_attempts', 429, 'x', 30), (k, v) => translate('en', k, v))).toContain('30 seconds')
  })
  it('falls back to generic / network', () => {
    expect(errorMessage(new ApiError('???', 500, 'boom'), t)).toBe(vi['error.generic'])
    expect(errorMessage(new ApiError('network', 0, ''), t)).toBe(vi['error.network'])
    expect(errorMessage(new Error('x'), t)).toBe(vi['error.generic'])
  })
})
