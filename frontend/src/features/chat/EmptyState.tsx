import { Code2, FileText, Image as ImageIcon, Lightbulb } from 'lucide-react'
import { Mascot } from '@/components/Mascot'
import { useT, type TKey } from '@/i18n'
import { timeOfDay } from '@/lib/format'
import { cn } from '@/lib/cn'

const EXAMPLES: { key: TKey; label: TKey; icon: typeof Code2; tone: string }[] = [
  { key: 'chat.example1', label: 'chat.suggestCode', icon: Code2, tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
  { key: 'chat.example2', label: 'chat.suggestImage', icon: ImageIcon, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  { key: 'chat.example3', label: 'chat.suggestDocs', icon: FileText, tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  { key: 'chat.example4', label: 'chat.suggestLearn', icon: Lightbulb, tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
]

const GREETING: Record<ReturnType<typeof timeOfDay>, TKey> = {
  morning: 'chat.greetingMorning',
  afternoon: 'chat.greetingAfternoon',
  evening: 'chat.greetingEvening',
  night: 'chat.greetingNight',
}

/** First word of the display name, used in the greeting. */
export function firstName(name: string | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

export function EmptyState({ onExample, name, hour = new Date().getHours() }: { onExample: (text: string) => void; name?: string; hour?: number }) {
  const t = useT()
  const who = firstName(name)
  return (
    <div className="msg-enter flex flex-col items-center pt-[4vh] text-center sm:pt-[9vh]" data-testid="empty-state">
      <Mascot size={72} className="mb-3 max-sm:size-14" />
      <h1 className="text-[26px] font-semibold tracking-tight max-sm:text-2xl" data-testid="greeting">
        {who ? t(GREETING[timeOfDay(hour)], { name: who }) : t('chat.greetingNoName')}
      </h1>
      <p className="mt-1.5 text-sm text-muted">{t('chat.greetingSub')}</p>
      <div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {EXAMPLES.map(({ key, label, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            data-testid="example-prompt"
            onClick={() => onExample(t(key))}
            className="group flex items-start gap-3 rounded-xl border border-line bg-bg p-3 text-left transition-all hover:-translate-y-px hover:border-fg/25 hover:shadow-sm"
          >
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tone)}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-muted">{t(label)}</span>
              <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug">{t(key)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
