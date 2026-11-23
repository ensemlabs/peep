import { Monitor, Moon, Sun } from 'lucide-react'
import { useT, type TKey } from '@/i18n'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/cn'

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: TKey }[] = [
  { value: 'light', icon: Sun, label: 'theme.light' },
  { value: 'dark', icon: Moon, label: 'theme.dark' },
  { value: 'system', icon: Monitor, label: 'theme.system' },
]

/** Segmented Light / Dark / System control. `labels` adds text next to the icons. */
export function ThemeSwitch({ className, labels = false }: { className?: string; labels?: boolean }) {
  const t = useT()
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="group"
      aria-label={t('theme.label')}
      data-testid="theme-switch"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-line p-0.5 text-xs', className)}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          data-value={value}
          aria-pressed={theme === value}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => setTheme(value)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-colors',
            theme === value ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover hover:text-fg',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {labels && <span>{t(label)}</span>}
        </button>
      ))}
    </div>
  )
}
