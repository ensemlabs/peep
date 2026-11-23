import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  testId: string
  icon: ReactNode
  title: ReactNode
  /** Elapsed milliseconds (live while running). Shown as a chip unless `hideDuration`. */
  elapsedMs?: number | null
  running?: boolean
  error?: boolean
  hideDuration?: boolean
  /** Defaults to true while running; ThinkingBlock shows the animated mascot instead. */
  showSpinner?: boolean
  /** Default open state; user toggling overrides it for good. */
  defaultOpen?: boolean
  children: ReactNode
}

/** Header (icon, title, timer, spinner, chevron) + animated, lazily-rendered body. */
export function CollapsibleStep({ testId, icon, title, elapsedMs, running, error, hideDuration, showSpinner = true, defaultOpen = false, children }: Props) {
  const t = useT()
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const [everOpen, setEverOpen] = useState(false)
  const open = userOpen ?? defaultOpen
  if (open && !everOpen) setEverOpen(true)
  const bodyId = useId()
  const showDuration = !hideDuration && elapsedMs != null

  return (
    <div
      data-testid={testId}
      data-state={open ? 'open' : 'closed'}
      data-status={running ? 'running' : error ? 'error' : 'done'}
      className={cn('my-2 rounded-xl border bg-bg', error ? 'border-danger/50' : 'border-line')}
    >
      <button
        type="button"
        data-testid="step-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setUserOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
      >
        <span className={cn('shrink-0', error ? 'text-danger' : 'text-muted')}>{icon}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{title}</span>
        {showDuration && (
          <span data-testid="step-duration" className="shrink-0 text-xs tabular-nums text-muted">
            {formatDuration(elapsedMs!, t)}
          </span>
        )}
        {running && showSpinner && <Spinner className="shrink-0 text-muted" />}
        <ChevronRight className={cn('size-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-90')} aria-hidden />
      </button>
      <div id={bodyId} className="collapse-grid" data-open={open} aria-hidden={!open}>
        <div className="collapse-inner" inert={!open}>
          {everOpen && <div className="border-t border-line px-3 py-3 text-sm">{children}</div>}
        </div>
      </div>
    </div>
  )
}
