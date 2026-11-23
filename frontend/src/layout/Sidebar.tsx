import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronsUpDown, LogOut, MoreHorizontal, Pencil, Plus, Settings, Shield, Trash2, X } from 'lucide-react'
import { api } from '@/api/client'
import type { Conversation, User } from '@/api/types'
import { useI18n, type Lang } from '@/i18n'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { Dialog } from '@/components/ui/Dialog'
import { useLogout } from '@/features/auth/useMe'
import { CONVERSATIONS_KEY } from '@/features/chat/runner'
import { useRunStore, useUiStore } from '@/features/chat/stores'

export function groupConversations(items: Conversation[], now = Date.now()) {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const weekAgo = startOfToday.getTime() - 7 * 86_400_000
  const groups = { today: [] as Conversation[], week: [] as Conversation[], older: [] as Conversation[] }
  for (const c of items) {
    const ts = Date.parse(c.updated_at)
    if (ts >= startOfToday.getTime()) groups.today.push(c)
    else if (ts >= weekAgo) groups.week.push(c)
    else groups.older.push(c)
  }
  return groups
}

export function Sidebar({ user }: { user: User }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const open = useUiStore((s) => s.sidebarOpen)
  const setOpen = useUiStore((s) => s.setSidebarOpen)
  const list = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: api.conversations, staleTime: 10_000, enabled: user.status === 'active' })
  const groups = useMemo(() => groupConversations(list.data?.items ?? []), [list.data])

  useEffect(() => setOpen(false), [location.pathname, setOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const sections: [string, Conversation[]][] = [
    [t('sidebar.today'), groups.today],
    [t('sidebar.previous7'), groups.week],
    [t('sidebar.older'), groups.older],
  ]
  const empty = !list.isLoading && (list.data?.items.length ?? 0) === 0

  return (
    <>
      {open && (
        <div
          data-testid="drawer-backdrop"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-hidden
        />
      )}
      <aside
        data-testid="sidebar"
        data-open={open}
        aria-label={t('app.name')}
        className={cn(
          'z-40 flex w-72 shrink-0 flex-col border-r border-line bg-surface',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-[transform,visibility] max-md:duration-200',
          open ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 p-3">
          <Link to="/" className="min-w-0 flex-1 truncate px-2 text-sm font-semibold tracking-tight">{t('app.name')}</Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('sidebar.close')}
            className="rounded-lg p-2 hover:bg-hover md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-3 pb-2">
          <Button variant="secondary" className="w-full justify-start" data-testid="new-chat" onClick={() => navigate('/')}>
            <Plus className="size-4" />
            {t('sidebar.newChat')}
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label={t('chat.messageList')}>
          {empty && <p className="px-3 py-4 text-sm text-muted">{t('sidebar.empty')}</p>}
          {sections.map(([label, items]) =>
            items.length ? (
              <div key={label} className="mt-3">
                <h3 className="px-3 pb-1 text-xs font-medium text-muted">{label}</h3>
                <ul>
                  {items.map((c) => (
                    <ConversationItem key={c.id} conv={c} />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </nav>
        <UserMenu user={user} />
      </aside>
    </>
  )
}

function ConversationItem({ conv }: { conv: Conversation }) {
  const { t, err } = useI18n()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conv.title)
  const [confirm, setConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const streaming = useRunStore((s) => !!s.runs[conv.id])

  const rename = useMutation({
    mutationFn: (v: string) => api.renameConversation(conv.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteConversation(conv.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
      qc.removeQueries({ queryKey: ['conversation', conv.id] })
      if (location.pathname === `/c/${conv.id}`) navigate('/')
      setConfirm(false)
    },
  })

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const v = title.trim()
    setEditing(false)
    if (v && v !== conv.title) rename.mutate(v)
    else setTitle(conv.title)
  }

  const label = conv.title || t('sidebar.untitled')

  return (
    <li className="group relative" data-testid="conversation-item">
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={title}
          maxLength={120}
          aria-label={t('sidebar.rename')}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setTitle(conv.title)
              setEditing(false)
            }
          }}
          className="h-9 w-full rounded-lg border border-fg/40 bg-bg px-3 text-sm focus:outline-none"
        />
      ) : (
        <NavLink
          to={`/c/${conv.id}`}
          className={({ isActive }) =>
            cn('flex h-9 items-center gap-2 rounded-lg px-3 pr-9 text-sm hover:bg-hover', isActive && 'bg-hover font-medium')
          }
        >
          <span className="truncate" title={label}>{label}</span>
          {streaming && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" aria-hidden />}
        </NavLink>
      )}
      {!editing && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={t('sidebar.menu')}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted opacity-100 hover:bg-line focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="z-50 min-w-36 rounded-xl border border-line bg-bg p-1 shadow-lg">
              <DropdownMenu.Item
                onSelect={() => setEditing(true)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover"
              >
                <Pencil className="size-4" /> {t('sidebar.rename')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setConfirm(true)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger outline-none data-[highlighted]:bg-hover"
              >
                <Trash2 className="size-4" /> {t('sidebar.delete')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('sidebar.deleteTitle')}
        description={t('sidebar.deleteBody', { title: label })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" data-testid="confirm-delete" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {remove.isError && (
          <p role="alert" data-testid="delete-error" className="text-sm text-danger">{err(remove.error)}</p>
        )}
      </Dialog>
    </li>
  )
}

function UserMenu({ user }: { user: User }) {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const logout = useLogout()
  const initial = (user.display_name || user.email).slice(0, 1).toUpperCase()
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover'
  return (
    <div className="border-t border-line p-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          data-testid="user-menu"
          aria-label={t('menu.account')}
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-hover"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.display_name || user.email}</span>
            <span className="block truncate text-xs text-muted">{user.email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="start" sideOffset={6} className="z-50 w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-bg p-1 shadow-lg">
            <DropdownMenu.Label className="px-2.5 py-1 text-xs font-medium text-muted">{t('common.language')}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
              {(['en', 'vi'] as Lang[]).map((l) => (
                <DropdownMenu.RadioItem key={l} value={l} data-testid={`menu-lang-${l}`} className={cn(item, 'justify-between')}>
                  {t(`lang.${l}`)}
                  <DropdownMenu.ItemIndicator><Check className="size-4" /></DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Label className="px-2.5 py-1 text-xs font-medium text-muted">{t('theme.label')}</DropdownMenu.Label>
            <div className="px-2 pb-1">
              <ThemeSwitch className="w-full [&>button]:flex-1" />
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={item} onSelect={() => navigate('/settings')} data-testid="menu-settings">
              <Settings className="size-4" /> {t('menu.settings')}
            </DropdownMenu.Item>
            {user.role === 'admin' && (
              <DropdownMenu.Item className={item} onSelect={() => navigate('/admin/users')} data-testid="menu-admin">
                <Shield className="size-4" /> {t('menu.admin')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={item} onSelect={() => logout.mutate()} data-testid="menu-logout">
              <LogOut className="size-4" /> {t('menu.logout')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
