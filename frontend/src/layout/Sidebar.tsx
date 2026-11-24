import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { DropdownMenu, Tooltip } from 'radix-ui'
import { Check, ChevronsUpDown, LogOut, MoreHorizontal, PanelLeftClose, Pin, Plus, Puzzle, Search, Settings, Shield, X } from 'lucide-react'
import { api } from '@/api/client'
import type { Conversation, User } from '@/api/types'
import { useI18n, type Lang } from '@/i18n'
import { cn } from '@/lib/cn'
import { EnsembleLogo } from '@/components/EnsembleLogo'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { useLogout } from '@/features/auth/useMe'
import { ConversationMenuItems, DeleteConversationDialog, useConversationActions } from '@/features/chat/conversationActions'
import { CONVERSATIONS_KEY } from '@/features/chat/runner'
import { useRunStore, useUiStore } from '@/features/chat/stores'
import { ModelPicker } from '@/features/chat/ModelPicker'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { effectiveStatus, groupConversations, indicatorFor, unreadCount, type Indicator } from './conversationStatus'

export { groupConversations } from './conversationStatus'

const BASE_TITLE = 'Ensemble Chat'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function Sidebar({ user }: { user: User }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const open = useUiStore((s) => s.sidebarOpen)
  const setOpen = useUiStore((s) => s.setSidebarOpen)
  const collapsed = useUiStore((s) => s.collapsed)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const qc = useQueryClient()
  const active = user.status === 'active'
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 250)
  const searchRef = useRef<HTMLInputElement>(null)

  // Unfiltered list drives polling and the unread count; the search list only exists while searching.
  const base = useInfiniteQuery({
    queryKey: [...CONVERSATIONS_KEY, ''],
    queryFn: ({ pageParam }) => api.conversations('', pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
    staleTime: 10_000,
    enabled: active,
  })
  // Polling touches only the first page (O(1) however many pages are loaded), and only while
  // something on that page is streaming. The result is merged into the infinite cache below.
  const streamingNow = base.data?.pages[0]?.items.some((c) => c.status === 'streaming') ?? false
  const head = useQuery({
    queryKey: [...CONVERSATIONS_KEY, 'head'],
    queryFn: () => api.conversations('', null),
    enabled: active && streamingNow,
    refetchInterval: 5000,
  })
  useEffect(() => {
    if (!head.data) return
    qc.setQueryData<{ pages: { items: Conversation[]; next_before: string | null }[]; pageParams: unknown[] }>(
      [...CONVERSATIONS_KEY, ''],
      (old) => {
        if (!old || old.pages.length === 0) return old
        const [first, ...rest] = old.pages
        const same = JSON.stringify(first.items) === JSON.stringify(head.data.items)
        return same ? old : { ...old, pages: [{ items: head.data.items, next_before: first.next_before }, ...rest] }
      },
    )
  }, [head.data, qc])
  const found = useInfiniteQuery({
    queryKey: [...CONVERSATIONS_KEY, q],
    queryFn: ({ pageParam }) => api.conversations(q, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
    enabled: active && q !== '',
    placeholderData: (prev) => prev,
  })
  const searching = q !== ''
  const source = searching ? found : base
  const baseItems = useMemo(() => base.data?.pages.flatMap((pg) => pg.items) ?? [], [base.data])
  const items = useMemo(() => (searching ? found.data?.pages.flatMap((pg) => pg.items) : baseItems) ?? [], [searching, found.data, baseItems])
  const groups = useMemo(() => groupConversations(items), [items])
  const loading = source.isLoading

  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && source.hasNextPage && !source.isFetchingNextPage) {
      void source.fetchNextPage()
    }
  }

  const unread = unreadCount(baseItems)
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [unread])

  useEffect(() => setOpen(false), [location.pathname, setOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault() // consumed: the run-stop shortcut must not also fire
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCollapsed(false)
        setOpen(true)
        setTimeout(() => searchRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, setCollapsed, setOpen])

  const sections: [string, Conversation[]][] = [
    [t('sidebar.pinned'), groups.pinned],
    [t('sidebar.today'), groups.today],
    [t('sidebar.previous7'), groups.week],
    [t('sidebar.previous30'), groups.month],
    [t('sidebar.older'), groups.older],
  ]

  return (
    <Tooltip.Provider delayDuration={600}>
      {open && (
        <div data-testid="drawer-backdrop" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-hidden />
      )}
      <aside
        data-testid="sidebar"
        data-open={open}
        data-collapsed={collapsed}
        aria-label={t('app.name')}
        className={cn(
          'z-40 flex shrink-0 flex-col border-r border-line bg-surface md:w-[272px]',
          'max-md:w-[min(85vw,300px)] max-md:pb-[var(--safe-bottom)] max-md:pl-[var(--safe-left)] max-md:pt-[var(--safe-top)]',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-[transform,visibility] max-md:duration-200',
          open ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full',
          collapsed && 'md:hidden',
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold tracking-tight">
            <EnsembleLogo size={18} />
            <span className="truncate">{t('app.name')}</span>
          </Link>
          <button
            type="button"
            data-testid="sidebar-collapse"
            onClick={() => setCollapsed(true)}
            aria-label={t('sidebar.collapse')}
            title={t('sidebar.collapse')}
            className="hidden rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg md:block"
          >
            <PanelLeftClose className="size-[18px]" />
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('sidebar.close')} className="flex items-center justify-center rounded-lg p-1.5 text-muted hover:bg-hover tap:size-10 md:hidden">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-2 px-3 pb-2">
          <button
            type="button"
            data-testid="new-chat"
            onClick={() => navigate('/')}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg px-3 text-sm font-medium shadow-sm transition-colors hover:bg-hover"
          >
            <Plus className="size-4" />
            <span className="flex-1 text-left">{t('sidebar.newChat')}</span>
            <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-sans text-[10px] text-muted lg:block">{t('sidebar.newChatHint')}</kbd>
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              data-testid="sidebar-search"
              aria-label={t('sidebar.search')}
              placeholder={t('sidebar.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-transparent bg-surface-2 pl-8 pr-2 text-[13px] placeholder:text-muted focus:border-line focus:bg-bg focus:outline-none"
            />
          </div>
        </div>

        <DrawerModelPicker enabled={active} />
        <nav onScroll={onScroll} data-testid="sidebar-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label={t('chat.messageList')}>
          {loading && items.length === 0 && (
            <div className="space-y-1.5 px-2 pt-2" aria-hidden data-testid="sidebar-skeleton">
              {[70, 55, 80, 60, 45].map((w, i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-surface-2" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="px-3 py-4 text-[13px] text-muted">{searching ? t('sidebar.noResults') : t('sidebar.empty')}</p>
          )}
          {sections.map(([label, list], i) =>
            list.length ? (
              <div key={label} className="mt-3 first:mt-1" data-testid={i === 0 ? 'group-pinned' : undefined}>
                <h3 className="flex items-center gap-1 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {i === 0 && <Pin className="size-3" />}
                  {label}
                </h3>
                <ul>
                  {list.map((c) => (
                    <ConversationRow key={c.id} conv={c} />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </nav>
        <UserMenu user={user} />
      </aside>
    </Tooltip.Provider>
  )
}

/** The single 16px status slot on the right of a row. */
/** Dev model switcher inside the drawer on phones (on desktop it lives in the composer toolbar). */
function DrawerModelPicker({ enabled }: { enabled: boolean }) {
  const { lang } = useI18n()
  const desktop = useMediaQuery('(min-width: 768px)')
  const models = useQuery({ queryKey: ['models', lang], queryFn: api.models, staleTime: 5 * 60_000, enabled })
  const savedModel = useUiStore((s) => s.model)
  const setModel = useUiStore((s) => s.setModel)
  if (!models.data?.switchable || desktop) return null
  const value = models.data.items.find((m) => m.id === savedModel) ?? models.data.active
  return (
    <div className="px-3 pb-2">
      <ModelPicker models={models.data.items} value={value} onChange={setModel} side="bottom" className="w-full justify-between border border-line" />
    </div>
  )
}

function StatusIcon({ kind }: { kind: Indicator }) {
  const { t } = useI18n()
  if (!kind) return <span className="size-4" aria-hidden />
  const label = kind === 'streaming' ? t('sidebar.statusStreaming') : kind === 'error' ? t('sidebar.statusError') : t('sidebar.statusUnread')
  return (
    <span data-testid="conv-indicator" data-kind={kind} role="img" title={label} aria-label={label} className="grid size-4 place-items-center">
      {kind === 'streaming' ? (
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-muted/30 border-t-muted" />
      ) : (
        <span className={cn('size-1.5 rounded-full', kind === 'error' ? 'bg-red-400/80' : 'bg-sky-500')} />
      )}
    </span>
  )
}

const ConversationRow = memo(function ConversationRow({ conv }: { conv: Conversation }) {
  const { t } = useI18n()
  // Per-row selector: only this row re-renders when its own run starts or ends.
  const live = useRunStore((s) => !!s.runs[conv.id])
  const actions = useConversationActions(conv)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conv.title)
  const [confirm, setConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameRequested = useRef(false)
  const isActive = useLocation().pathname === `/c/${conv.id}`
  const status = effectiveStatus(conv, live)
  const unread = !!conv.unread
  const kind = indicatorFor(status, unread)
  const label = conv.title || t('sidebar.untitled')

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])
  useEffect(() => setTitle(conv.title), [conv.title])

  function commit() {
    const v = title.trim()
    setEditing(false)
    if (v && v !== conv.title) actions.rename(v)
    else setTitle(conv.title)
  }

  return (
    <li className="group relative tap:flex tap:items-center" data-testid="conv-row" data-status={status} data-unread={unread ? 'true' : 'false'} data-pinned={conv.pinned ? 'true' : 'false'}>
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
              e.preventDefault()
              e.stopPropagation()
              setTitle(conv.title)
              setEditing(false)
            }
          }}
          className="h-8 w-full rounded-lg border border-fg/40 bg-bg px-2.5 text-[13px] focus:outline-none"
        />
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Link
              to={`/c/${conv.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-lg px-2.5 pr-2 text-[13px] text-fg/90 hover:bg-hover tap:h-10 tap:min-w-0 tap:flex-1 tap:pr-0',
                isActive && 'bg-hover font-medium text-fg',
                unread && status !== 'streaming' && 'font-medium text-fg',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="flex shrink-0 items-center [@media(hover:hover)]:group-focus-within:opacity-0 [@media(hover:hover)]:group-hover:opacity-0">
                <StatusIcon kind={kind} />
              </span>
            </Link>
          </Tooltip.Trigger>
          {conv.preview && (
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={8}
                data-testid="conv-preview"
                className="z-50 hidden max-w-64 rounded-lg border border-line bg-bg px-3 py-2 text-xs shadow-lg md:block"
              >
                <div className="mb-0.5 font-medium">{label}</div>
                <div className="line-clamp-4 text-muted">{conv.preview}</div>
              </Tooltip.Content>
            </Tooltip.Portal>
          )}
        </Tooltip.Root>
      )}
      {!editing && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={t('sidebar.menu')}
            data-testid="conv-menu"
            className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-muted opacity-100 hover:bg-line focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 tap:static tap:size-10 tap:shrink-0 tap:translate-y-0 tap:p-0 tap:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-50 min-w-40 rounded-xl border border-line bg-bg p-1 shadow-lg"
              onCloseAutoFocus={(e) => {
                if (!renameRequested.current) return
                e.preventDefault()
                renameRequested.current = false
                requestAnimationFrame(() => {
                  inputRef.current?.focus()
                  inputRef.current?.select()
                })
              }}
            >
              <ConversationMenuItems pinned={conv.pinned} onRename={() => { renameRequested.current = true; setEditing(true) }} onPin={actions.togglePin} onDelete={() => setConfirm(true)} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <DeleteConversationDialog open={confirm} onOpenChange={setConfirm} title={label} remove={actions.remove} />
    </li>
  )
})

function UserMenu({ user }: { user: User }) {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const logout = useLogout()
  const initial = (user.display_name || user.email).slice(0, 1).toUpperCase()
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover'
  return (
    <div className="border-t border-line p-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger data-testid="user-menu" aria-label={t('menu.account')} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-hover">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight">{user.display_name || user.email}</span>
            <span className="block truncate text-[11px] leading-tight text-muted">{user.email}</span>
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
            <DropdownMenu.Item className={item} onSelect={() => navigate('/settings/integrations')} data-testid="menu-integrations">
              <Puzzle className="size-4" /> {t('menu.integrations')}
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
