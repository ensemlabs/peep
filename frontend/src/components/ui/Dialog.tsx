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
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className }: Props) {
  const t = useT()
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-bg p-5 shadow-xl',
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
