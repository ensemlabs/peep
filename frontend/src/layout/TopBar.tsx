import type { ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { useT } from '@/i18n'
import { useUiStore } from '@/features/chat/stores'

export function TopBar({ children }: { children: ReactNode }) {
  const t = useT()
  const setOpen = useUiStore((s) => s.setSidebarOpen)
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 sm:px-4">
      <button
        type="button"
        data-testid="hamburger"
        onClick={() => setOpen(true)}
        aria-label={t('sidebar.open')}
        className="rounded-lg p-2 hover:bg-hover md:hidden"
      >
        <Menu className="size-5" />
      </button>
      {children}
    </header>
  )
}
