import { describe, expect, it } from 'vitest'
import { translate } from '@/i18n'
import { auditDetail } from './auditDetail'

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v)

describe('auditDetail', () => {
  it('renders status and role changes as from → to', () => {
    expect(auditDetail({ action: 'user.status', detail: { from: 'pending', to: 'active' } }, t)).toBe('Pending → Active')
    expect(auditDetail({ action: 'user.role', detail: { from: 'user', to: 'admin' } }, t)).toBe('User → Admin')
  })
  it('renders quota changes with compact numbers and unlimited', () => {
    const detail = { from: { limit: null, period: 'month' }, to: { limit: 100000, period: 'day' } }
    expect(auditDetail({ action: 'user.quota', detail }, t)).toBe('Unlimited → 100k per day')
  })
  it('renders create and is empty for delete / password reset', () => {
    expect(auditDetail({ action: 'user.create', detail: { role: 'admin', status: 'active' } }, t)).toBe('Admin · Active')
    expect(auditDetail({ action: 'user.delete', detail: { bulk: true } }, t)).toBe('')
  })
})
