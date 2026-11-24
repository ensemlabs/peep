import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '@/api/client'
import type { AuditAction, AuditItem } from '@/api/types'
import { useI18n, type TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass } from '@/components/ui/styles'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { auditDetail } from './auditDetail'

const PAGE = 50
export const AUDIT_ACTIONS: AuditAction[] = ['user.create', 'user.status', 'user.role', 'user.password_reset', 'user.delete', 'user.quota']

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function AuditLog() {
  const { t, err } = useI18n()
  const wide = useMediaQuery('(min-width: 768px)')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [action, setAction] = useState<AuditAction | ''>('')

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const audit = useInfiniteQuery({
    queryKey: ['admin-audit', q, action],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.adminAudit({ q, action, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total && last.items.length > 0 ? loaded : undefined
    },
    placeholderData: (prev) => prev,
  })
  const items = audit.data?.pages.flatMap((p) => p.items) ?? []
  const actionLabel = (a: AuditAction) => t(`admin.audit.action.${a}` as TKey)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            data-testid="audit-search"
            aria-label={t('common.search')}
            placeholder={t('admin.audit.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputClass, 'pl-9')}
          />
        </div>
        <select
          data-testid="audit-action-filter"
          aria-label={t('admin.audit.filter')}
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          className={cn(inputClass, 'sm:w-56')}
        >
          <option value="">{t('admin.audit.allActions')}</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
      </div>

      {audit.isError && <p role="alert" className="text-sm text-danger">{err(audit.error)}</p>}
      {audit.isLoading && <Spinner className="mx-auto my-8 size-6 text-muted" label={t('common.loading')} />}
      {audit.data && items.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('admin.audit.empty')}</p>}

      {wide && items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                {(['time', 'actor', 'action', 'target', 'details'] as const).map((c) => (
                  <th key={c} className="px-4 py-2.5 font-medium">{t(`admin.audit.col.${c}` as TKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((it) => (
                <tr key={it.id} data-testid="audit-row" data-action={it.action} data-target={it.target_email ?? ''}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDateTime(it.created_at)}</td>
                  <td className="max-w-[14rem] truncate px-4 py-3">{it.actor_email}</td>
                  <td className="px-4 py-3">{actionLabel(it.action)}</td>
                  <td className="max-w-[14rem] truncate px-4 py-3">{it.target_email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted"><Detail item={it} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!wide && (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} data-testid="audit-row" data-action={it.action} data-target={it.target_email ?? ''} className="rounded-xl border border-line p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{actionLabel(it.action)}</span>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(it.created_at)}</span>
              </div>
              <div className="mt-1 break-all text-xs text-muted">{it.actor_email} → {it.target_email ?? '—'}</div>
              <div className="mt-1 text-xs text-muted"><Detail item={it} /></div>
            </li>
          ))}
        </ul>
      )}

      {audit.hasNextPage && (
        <div className="text-center">
          <Button disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
            {audit.isFetchingNextPage && <Spinner />} {t('admin.audit.more')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Detail({ item }: { item: AuditItem }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {auditDetail(item, t)}
      {item.detail.bulk === true && (
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium">{t('admin.audit.bulk')}</span>
      )}
    </span>
  )
}
