import type { ReactNode } from 'react'
import { Clock, RefreshCw } from 'lucide-react'
import { useT } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  pending: boolean
  checking?: boolean
  onCheck: () => void
  onLogout: () => void
  children: ReactNode
}

/**
 * Renders the app shell. While `pending`, the content is `inert` (no focus, no clicks, hidden from AT),
 * a transparent overlay swallows pointer events, and a banner is the only interactive area.
 */
export function PendingGate({ pending, checking, onCheck, onLogout, children }: Props) {
  const t = useT()
  return (
    <div className="flex h-dvh flex-col">
      {pending && (
        <div
          role="status"
          data-testid="pending-banner"
          className="relative z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-line bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
        >
          <span className="flex items-center gap-2 font-medium">
            <Clock className="size-4 shrink-0" aria-hidden />
            {t('pending.banner')}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onCheck} disabled={checking} data-testid="pending-check">
              {checking ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />}
              {t('pending.check')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onLogout} data-testid="pending-logout">
              {t('pending.logout')}
            </Button>
          </span>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          data-testid="app-main"
          className="flex h-full min-h-0"
          inert={pending}
          aria-disabled={pending || undefined}
        >
          {children}
        </div>
        {pending && (
          <div
            data-testid="pending-overlay"
            aria-hidden="true"
            className="absolute inset-0 z-50 cursor-not-allowed bg-transparent"
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
      </div>
    </div>
  )
}
