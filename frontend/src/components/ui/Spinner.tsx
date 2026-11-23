import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <Loader2
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="spinner"
      className={cn('size-4 animate-spin', className)}
    />
  )
}
