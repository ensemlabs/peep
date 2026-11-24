import type { ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** Render as a bottom sheet (mobile). */
  sheet?: boolean
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className, sheet }: Props) {
  const t = useT()
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <D.Content
          className={cn(
            'fixed z-50 flex flex-col border border-line bg-bg shadow-xl',
            sheet
              ? 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl p-4 pb-[max(1rem,var(--safe-bottom))] pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]'
              : 'left-1/2 top-1/2 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-5',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="break-words text-base font-semibold">{title}</D.Title>
            <D.Close
              aria-label={t('common.close')}
              className="-m-1 rounded-md p-1 text-muted hover:bg-hover"
            >
              <X className="size-4" />
            </D.Close>
          </div>
          {description ? (
            <D.Description className="mt-2 text-sm text-muted">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          <div className="mt-4 min-h-0 flex-1 overflow-auto">{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
