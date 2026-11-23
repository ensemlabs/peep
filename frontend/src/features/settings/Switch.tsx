import { cn } from '@/lib/cn'

export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-2 border border-line')}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full transition-all',
          checked ? 'left-[1.15rem] bg-accent-fg' : 'left-0.5 bg-muted',
        )}
      />
    </button>
  )
}
