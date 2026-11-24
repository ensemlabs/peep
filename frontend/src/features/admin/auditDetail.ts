import type { AuditItem } from '@/api/types'
import type { TFn, TKey } from '@/i18n'
import { formatTokens } from '@/lib/format'

type Limit = { limit?: number | null; period?: string } | undefined

function quotaText(q: Limit, t: TFn): string {
  if (!q || q.limit == null) return t('admin.quota.unlimited')
  return `${formatTokens(q.limit)} ${t(q.period === 'day' ? 'admin.quota.perDay' : 'admin.quota.perMonth')}`
}

/** One-line description of what an audit entry changed (the "bulk" tag is rendered separately). */
export function auditDetail(item: Pick<AuditItem, 'action' | 'detail'>, t: TFn): string {
  const d = item.detail as Record<string, unknown>
  const label = (prefix: 'status' | 'role', v: unknown) => (typeof v === 'string' ? t(`admin.${prefix}.${v}` as TKey) : '')
  switch (item.action) {
    case 'user.create':
      return `${label('role', d.role)} · ${label('status', d.status)}`
    case 'user.status':
      return `${label('status', d.from)} → ${label('status', d.to)}`
    case 'user.role':
      return `${label('role', d.from)} → ${label('role', d.to)}`
    case 'user.quota':
      return `${quotaText(d.from as Limit, t)} → ${quotaText(d.to as Limit, t)}`
    default:
      return ''
  }
}
