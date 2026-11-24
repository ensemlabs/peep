import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'

interface Props {
  testId: string
  /** Optional small leading icon; most rows have none. */
  icon?: ReactNode
  title: ReactNode
  /** Elapsed milliseconds (live while running), shown muted after the title unless `hideDuration`. */
  elapsedMs?: number | null
  running?: boolean
  error?: boolean
  hideDuration?: boolean
  /** Default open state; user toggling overrides it for good. */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A step is one muted inline row (no box): label, optional duration, a chevron that rotates when open.
 * The body is indented under a left rule and rendered lazily; it animates open and closed.
 */
export function CollapsibleStep({ testId, icon, title, elapsedMs, running, error, hideDuration, defaultOpen = false, children }: Props) {
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
      className="my-1"
    >
      <button
        type="button"
        data-testid="step-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setUserOpen(!open)}
        className={cn(
          'group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left text-[14px] transition-colors',
          error ? 'text-danger' : 'text-muted hover:text-fg',
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="flex min-w-0 items-center gap-1.5 truncate">{title}</span>
        {showDuration && (
          <span data-testid="step-duration" className="shrink-0 text-[13px] tabular-nums opacity-70">
            {formatDuration(elapsedMs!, t)}
          </span>
        )}
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-200', open && 'rotate-90')} aria-hidden />
      </button>
      <div id={bodyId} className="collapse-grid" data-open={open} aria-hidden={!open}>
        <div className="collapse-inner" inert={!open}>
          {everOpen && <div className="ml-1 border-l-2 border-line py-1 pl-3 text-[14px]">{children}</div>}
        </div>
      </div>
    </div>
  )
}
