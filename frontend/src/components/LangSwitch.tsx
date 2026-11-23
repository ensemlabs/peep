import { Languages } from 'lucide-react'
import { useI18n, type Lang } from '@/i18n'
import { cn } from '@/lib/cn'

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cn('inline-flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs', className)}
    >
      <Languages className="ml-1.5 size-3.5 text-muted" aria-hidden />
      {(['en', 'vi'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          data-testid={`lang-${l}`}
          onClick={() => setLang(l)}
          className={cn(
            'rounded-md px-2 py-1 font-medium uppercase transition-colors',
            lang === l ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
