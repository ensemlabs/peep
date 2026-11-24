import { describe, expect, it } from 'vitest'
import { translate } from './index'

describe('plural handling', () => {
  it('uses the singular form in English for exactly 1', () => {
    expect(translate('en', 'skills.files', { n: 1 })).toBe('1 file')
    expect(translate('en', 'skills.files', { n: 0 })).toBe('0 files')
    expect(translate('en', 'skills.files', { n: 3 })).toBe('3 files')
    expect(translate('en', 'admin.total', { n: 1 })).toBe('1 user')
    expect(translate('en', 'admin.total', { n: 2 })).toBe('2 users')
    expect(translate('en', 'context.messages', { n: 1 })).toBe('1 message')
    expect(translate('en', 'time.seconds', { n: 1 })).toBe('1 second')
    expect(translate('en', 'time.minutes', { n: 1 })).toBe('1 minute')
    expect(translate('en', 'time.hours', { n: 1 })).toBe('1 hour')
  })
  it('Vietnamese has no plural', () => {
    expect(translate('vi', 'skills.files', { n: 1 })).toBe('1 tệp')
    expect(translate('vi', 'skills.files', { n: 5 })).toBe('5 tệp')
    expect(translate('vi', 'admin.total', { n: 1 })).toBe('1 người dùng')
  })
  it('keys without a _one form and non-count variables are untouched', () => {
    expect(translate('en', 'media.openImage', { n: 1 })).toBe('Open image 1')
    expect(translate('en', 'time.s', { n: 1 })).toBe('1s')
  })
})
