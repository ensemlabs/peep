import type { ReactNode } from 'react'
import { Menu, PanelLeftOpen } from 'lucide-react'
import { useT } from '@/i18n'
import { useUiStore } from '@/features/chat/stores'
import { cn } from '@/lib/cn'

/** 48px page header. The button opens the drawer on phones and re-opens a collapsed sidebar on desktop. */
export function TopBar({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  const t = useT()
  const setOpen = useUiStore((s) => s.setSidebarOpen)
  const collapsed = useUiStore((s) => s.collapsed)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  return (
    <header className={cn('flex h-[calc(3rem+var(--safe-top))] shrink-0 items-center gap-1.5 px-2 pt-[var(--safe-top)] sm:px-3', !plain && 'border-b border-line')}>
      <button
        type="button"
        data-testid="hamburger"
        onClick={() => (window.matchMedia('(min-width: 768px)').matches ? setCollapsed(false) : setOpen(true))}
        aria-label={collapsed ? t('sidebar.expand') : t('sidebar.open')}
        className={cn('flex items-center justify-center rounded-lg p-2 text-muted hover:bg-hover hover:text-fg tap:size-10 tap:p-0', !collapsed && 'md:hidden')}
      >
        {collapsed ? <PanelLeftOpen className="hidden size-5 md:block" /> : null}
        <Menu className={cn('size-5', collapsed && 'md:hidden')} />
      </button>
      {children}
    </header>
  )
}
