import { useEffect, useRef, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DropdownMenu } from 'radix-ui'
import { Check, KeyRound, Gauge, MoreHorizontal, Plus, Search, Shield, ShieldOff, Trash2, UserCheck, UserX, Wand2 } from 'lucide-react'
import { api } from '@/api/client'
import type { AdminUser, BulkAction, Role, User, UserStatus } from '@/api/types'
import { useI18n, type TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { validateNewPassword } from '@/features/auth/validation'
import { UsageBar } from '@/components/ui/UsageBar'
import { formatTokens } from '@/lib/format'
import { AuditLog } from './AuditLog'
import { BulkBar, BulkConfirm } from './BulkBar'
import { CreateUserDialog } from './CreateUserDialog'
import { generatePassword } from './password'
import { QuotaDialog } from './QuotaDialog'
import { TopBar } from '@/layout/TopBar'
import { useMediaQuery } from '@/lib/useMediaQuery'

type Filter = '' | UserStatus
const TABS: { value: Filter; label: TKey }[] = [
  { value: '', label: 'admin.tab.all' },
  { value: 'pending', label: 'admin.tab.pending' },
  { value: 'active', label: 'admin.tab.active' },
  { value: 'disabled', label: 'admin.tab.disabled' },
]

export function AdminGuard() {
  const me = useOutletContext<User>()
  if (me.role !== 'admin' || me.status !== 'active') return <Navigate to="/" replace />
  return <AdminUsersPage me={me} />
}

export function AdminUsersPage({ me }: { me: User }) {
  const { t, err } = useI18n()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('')
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [deleteFor, setDeleteFor] = useState<User | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [page, setPage] = useState<'users' | 'audit'>('users')
  const [creating, setCreating] = useState(false)
  const [quotaFor, setQuotaFor] = useState<AdminUser | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<BulkAction | null>(null)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const users = useQuery({
    queryKey: ['admin-users', q, filter],
    queryFn: () => api.adminUsers({ q, status: filter, limit: 100 }),
    placeholderData: (prev) => prev,
  })
  const pendingCount = useQuery({
    queryKey: ['admin-users-pending-count'],
    queryFn: () => api.adminUsers({ status: 'pending', limit: 1 }),
    select: (r) => r.total,
    refetchInterval: 30_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
    qc.invalidateQueries({ queryKey: ['admin-users-pending-count'] })
  }
  const patch = useMutation({
    mutationFn: (v: { id: string; body: { status?: UserStatus; role?: Role } }) => api.adminPatchUser(v.id, v.body),
    onSuccess: () => {
      setActionError(null)
      refresh()
    },
    onError: (e) => setActionError(err(e)),
  })

  const items = users.data?.items ?? []
  const selectable = items.filter((u) => u.id !== me.id)
  // Only rows still listed count: a row action can remove a selected user from the current view.
  const chosen = selectable.filter((u) => selected.has(u.id)).map((u) => u.id)
  const checked = chosen.length
  const allChecked = selectable.length > 0 && checked === selectable.length
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = checked > 0 && !allChecked
  }, [checked, allChecked])
  // A new filter or search shows different rows: start from an empty selection.
  useEffect(() => {
    setSelected(new Set())
    setBulkResult(null)
  }, [q, filter])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map((u) => u.id)))

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => api.adminBulk(chosen, action),
    onMutate: () => setBulkResult(null),
    onSuccess: (r) => {
      setActionError(null)
      const reasons = [...new Set(r.skipped.map((s) => t(`admin.bulk.reason.${s.reason}` as TKey)))].join(', ')
      setBulkResult(
        r.skipped.length
          ? t('admin.bulk.resultSkipped', { done: r.done.length, skipped: r.skipped.length, reasons })
          : t('admin.bulk.result', { done: r.done.length }),
      )
      setSelected(new Set())
      refresh()
    },
    onError: (e) => setActionError(err(e)),
    onSettled: () => setConfirm(null),
  })
  const onBulk = (a: BulkAction) => (a === 'disable' || a === 'delete' ? setConfirm(a) : bulk.mutate(a))
  const wide = useMediaQuery('(min-width: 768px)') // render one layout only, so test ids stay unique

  function actions(u: User) {
    const self = u.id === me.id
    const set = (body: { status?: UserStatus; role?: Role }) => patch.mutate({ id: u.id, body })
    return { self, set }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar>
        <h1 className="text-base font-semibold">{t('admin.title')}</h1>
        {users.data && <span className="hidden text-sm text-muted sm:inline">{t('admin.total', { n: users.data.total })}</span>}
        <Button size="sm" variant="primary" className="ml-auto" data-testid="create-user-btn" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {t('admin.create')}
        </Button>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-5 sm:px-6">
          <div role="tablist" aria-label={t('admin.page.label')} className="flex w-fit gap-1 rounded-xl bg-surface p-1">
            {(['users', 'audit'] as const).map((p) => (
              <button
                key={p}
                role="tab"
                type="button"
                aria-selected={page === p}
                data-testid={`tab-${p}`}
                onClick={() => {
                  setPage(p)
                  setBulkResult(null)
                }}
                className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', page === p ? 'bg-bg shadow-sm' : 'text-muted hover:text-fg')}
              >
                {t(p === 'users' ? 'admin.page.users' : 'admin.page.audit')}
              </button>
            ))}
          </div>
          {page === 'audit' && <AuditLog />}
          {page === 'users' && <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                data-testid="admin-search"
                aria-label={t('common.search')}
                placeholder={t('admin.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(inputClass, 'pl-9')}
              />
            </div>
            <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl bg-surface p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  role="tab"
                  type="button"
                  aria-selected={filter === tab.value}
                  data-testid={`tab-${tab.value || 'all'}`}
                  onClick={() => setFilter(tab.value)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    filter === tab.value ? 'bg-bg shadow-sm' : 'text-muted hover:text-fg',
                  )}
                >
                  {t(tab.label)}
                  {tab.value === 'pending' && !!pendingCount.data && (
                    <span data-testid="pending-count" className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                      {pendingCount.data}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {checked > 0 && <BulkBar count={checked} busy={bulk.isPending} onAction={onBulk} onClear={() => setSelected(new Set())} />}
          {bulkResult && <p role="status" data-testid="bulk-result" className="text-sm text-muted">{bulkResult}</p>}
          {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
          {users.isError && <p role="alert" className="text-sm text-danger">{err(users.error)}</p>}
          {users.isLoading && <Spinner className="mx-auto my-8 size-6 text-muted" label={t('common.loading')} />}
          {users.data && items.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('admin.empty')}</p>}

          {/* Table (>= 768px) */}
          {wide && items.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <input ref={selectAllRef} type="checkbox" data-testid="select-all" aria-label={t('admin.selectAll')} checked={allChecked} disabled={selectable.length === 0} onChange={toggleAll} />
                    </th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.user')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.role')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.status')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.tokens')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.created')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('admin.col.lastLogin')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('admin.col.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((u) => (
                    <tr key={u.id} data-testid="user-row" data-email={u.email}>
                      <td className="w-10 px-4 py-3">{u.id !== me.id && <RowCheck user={u} checked={selected.has(u.id)} onToggle={toggle} />}</td>
                      <td className="max-w-[16rem] px-4 py-3">
                        <div className="truncate font-medium">{u.display_name}{u.id === me.id && <span className="ml-1.5 text-xs text-muted">({t('common.you')})</span>}</div>
                        <div className="truncate text-xs text-muted">{u.email}</div>
                      </td>
                      <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                      <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                      <td className="min-w-32 px-4 py-3"><TokensCell user={u} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtDate(u.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{u.last_login_at ? fmtDate(u.last_login_at) : t('admin.never')}</td>
                      <td className="px-4 py-3">
                        <RowActions user={u} {...actions(u)} onReset={() => setResetFor(u)} onDelete={() => setDeleteFor(u)} onQuota={() => setQuotaFor(u)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cards (< 768px) */}
          {!wide && selectable.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input ref={selectAllRef} type="checkbox" data-testid="select-all" checked={allChecked} onChange={toggleAll} /> {t('admin.selectAll')}
            </label>
          )}
          {!wide && <ul className="space-y-3">
            {items.map((u) => (
              <li key={u.id} data-testid="user-row" data-email={u.email} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  {u.id !== me.id && <RowCheck user={u} checked={selected.has(u.id)} onToggle={toggle} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{u.display_name}{u.id === me.id && <span className="ml-1.5 text-xs text-muted">({t('common.you')})</span>}</div>
                    <div className="truncate text-xs text-muted">{u.email}</div>
                  </div>
                  <StatusBadge status={u.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <RoleBadge role={u.role} />
                  <span>{fmtDate(u.created_at)}</span>
                </div>
                <div className="mt-2 text-xs"><TokensCell user={u} /></div>
                <div className="mt-3">
                  <RowActions user={u} {...actions(u)} onReset={() => setResetFor(u)} onDelete={() => setDeleteFor(u)} onQuota={() => setQuotaFor(u)} inline />
                </div>
              </li>
            ))}
          </ul>}
          </>}
        </div>
      </div>

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
      {quotaFor && (
        <QuotaDialog
          user={quotaFor}
          onClose={() => setQuotaFor(null)}
          onSaved={() => {
            setQuotaFor(null)
            refresh()
          }}
        />
      )}
      {confirm && (
        <BulkConfirm action={confirm === 'delete' ? 'delete' : 'disable'} count={checked} busy={bulk.isPending} onClose={() => setConfirm(null)} onConfirm={() => bulk.mutate(confirm)} />
      )}
      {resetFor && <ResetDialog user={resetFor} onClose={() => setResetFor(null)} />}
      {deleteFor && (
        <DeleteDialog
          user={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDeleted={() => {
            setDeleteFor(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function RowCheck({ user, checked, onToggle }: { user: User; checked: boolean; onToggle: (id: string) => void }) {
  const { t } = useI18n()
  return (
    <input
      type="checkbox"
      data-testid="row-check"
      aria-label={t('admin.selectRow', { email: user.email })}
      className="mt-1 shrink-0"
      checked={checked}
      onChange={() => onToggle(user.id)}
    />
  )
}

function TokensCell({ user }: { user: AdminUser }) {
  const { t } = useI18n()
  const used = formatTokens(user.tokens_used)
  return (
    <div data-testid="tokens-cell" className="text-xs">
      {user.token_limit != null ? (
        <>
          <div className="whitespace-nowrap">{used} / {formatTokens(user.token_limit)}</div>
          <UsageBar used={user.tokens_used} limit={user.token_limit} label={t('quota.usage')} className="mt-1" />
        </>
      ) : (
        <span className="whitespace-nowrap text-muted">{t('admin.quota.usedUnlimited', { used })}</span>
      )}
    </div>
  )
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusBadge({ status }: { status: UserStatus }) {
  const { t } = useI18n()
  const cls = {
    pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    active: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
    disabled: 'bg-surface-2 text-muted',
  }[status]
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', cls)}>{t(`admin.status.${status}`)}</span>
}

function RoleBadge({ role }: { role: Role }) {
  const { t } = useI18n()
  return <span className="text-xs font-medium">{t(`admin.role.${role}`)}</span>
}

interface RowProps {
  user: AdminUser
  self: boolean
  set: (b: { status?: UserStatus; role?: Role }) => void
  onReset: () => void
  onDelete: () => void
  onQuota: () => void
  inline?: boolean
}

function RowActions({ user, self, set, onReset, onDelete, onQuota, inline }: RowProps) {
  const { t } = useI18n()
  if (self) return <div className={cn(!inline && 'text-right', 'text-xs text-muted')}>—</div>
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover'
  return (
    <div className={cn('flex items-center gap-2', inline ? 'flex-wrap' : 'justify-end')}>
      {user.status === 'pending' && (
        <Button size="sm" variant="primary" data-testid="approve-btn" onClick={() => set({ status: 'active' })}>
          <Check className="size-4" /> {t('admin.approve')}
        </Button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="sm" variant="secondary" aria-label={t('admin.actionsFor', { email: user.email })} data-testid="row-menu">
            <MoreHorizontal className="size-4" />
            {inline && <span>{t('admin.col.actions')}</span>}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" className="z-50 min-w-48 rounded-xl border border-line bg-bg p-1 shadow-lg">
            {user.status === 'active' && (
              <DropdownMenu.Item className={item} onSelect={() => set({ status: 'disabled' })}>
                <UserX className="size-4" /> {t('admin.disable')}
              </DropdownMenu.Item>
            )}
            {user.status === 'disabled' && (
              <DropdownMenu.Item className={item} onSelect={() => set({ status: 'active' })}>
                <UserCheck className="size-4" /> {t('admin.enable')}
              </DropdownMenu.Item>
            )}
            {user.role === 'user' ? (
              <DropdownMenu.Item className={item} onSelect={() => set({ role: 'admin' })}>
                <Shield className="size-4" /> {t('admin.makeAdmin')}
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item className={item} onSelect={() => set({ role: 'user' })}>
                <ShieldOff className="size-4" /> {t('admin.removeAdmin')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={item} onSelect={onReset}>
              <KeyRound className="size-4" /> {t('admin.resetPassword')}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={onQuota} data-testid="quota-btn">
              <Gauge className="size-4" /> {t('admin.quota.menu')}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={cn(item, 'text-danger')} onSelect={onDelete}>
              <Trash2 className="size-4" /> {t('admin.delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function ResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t, err } = useI18n()
  const [pw, setPw] = useState('')
  const [shown, setShown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const reset = useMutation({
    mutationFn: () => api.adminResetPassword(user.id, pw),
    onSuccess: () => setDone(true),
    onError: (e) => setError(err(e)),
  })
  function submit() {
    const bad = validateNewPassword(pw, user.email)
    if (bad) return setError(t(bad))
    setError(null)
    reset.mutate()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.resetTitle', { email: user.email })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          {!done && (
            <Button variant="primary" disabled={reset.isPending} onClick={submit}>
              {reset.isPending && <Spinner />} {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <label htmlFor="reset-pw" className={labelClass}>{t('field.newPassword')}</label>
      <div className="flex gap-2">
        <input
          id="reset-pw"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className={cn(inputClass, 'font-mono')}
          data-testid="reset-password-input"
        />
        <Button
          aria-label={t('admin.generate')}
          title={t('admin.generate')}
          onClick={() => {
            setPw(generatePassword())
            setShown(true)
          }}
        >
          <Wand2 className="size-4" />
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {done && <p role="status" className="mt-2 text-sm text-success">{t('admin.resetDone')}</p>}
    </Dialog>
  )
}

function DeleteDialog({ user, onClose, onDeleted }: { user: User; onClose: () => void; onDeleted: () => void }) {
  const { t, err } = useI18n()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const del = useMutation({
    mutationFn: () => api.adminDeleteUser(user.id),
    onSuccess: onDeleted,
    onError: (e) => setError(err(e)),
  })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.deleteTitle', { email: user.email })}
      description={t('admin.deleteBody')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            data-testid="confirm-delete-user"
            disabled={typed.trim().toLowerCase() !== user.email.toLowerCase() || del.isPending}
            onClick={() => del.mutate()}
          >
            {del.isPending && <Spinner />} {t('common.delete')}
          </Button>
        </>
      }
    >
      <input
        aria-label={t('field.email')}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={user.email}
        className={inputClass}
        autoComplete="off"
      />
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Dialog>
  )
}
