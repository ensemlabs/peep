import { barColor, usageRatio } from '@/lib/quota'
import { cn } from '@/lib/cn'

/** Thin progress bar for token usage; amber from 80%, red from 100%. */
export function UsageBar({ used, limit, label, className }: { used: number; limit: number; label: string; className?: string }) {
  const ratio = usageRatio(used, limit) ?? 0
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))} className={cn('h-1 w-full overflow-hidden rounded-full bg-line', className)}>
      <div className={cn('h-full rounded-full', barColor(ratio))} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  )
}
