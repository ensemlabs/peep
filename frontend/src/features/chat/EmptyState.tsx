import { Code2, FileText, Image as ImageIcon, Lightbulb } from 'lucide-react'
import { Mascot } from '@/components/Mascot'
import { useT, type TKey } from '@/i18n'
import { timeOfDay } from '@/lib/format'
import { cn } from '@/lib/cn'

const EXAMPLES: { key: TKey; label: TKey; icon: typeof Code2; tone: string }[] = [
  { key: 'chat.example1', label: 'chat.suggestCode', icon: Code2, tone: 'text-violet-500' },
  { key: 'chat.example2', label: 'chat.suggestImage', icon: ImageIcon, tone: 'text-rose-500' },
  { key: 'chat.example3', label: 'chat.suggestDocs', icon: FileText, tone: 'text-sky-500' },
  { key: 'chat.example4', label: 'chat.suggestLearn', icon: Lightbulb, tone: 'text-amber-500' },
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
      {/* Plays the greeting when this empty state mounts (new chat / new session), then idles. */}
      <Mascot size={88} state="greet" className="mb-3 max-sm:size-[72px]" />
      <h1 className="text-[26px] font-semibold tracking-tight max-sm:text-2xl" data-testid="greeting">
        {who ? t(GREETING[timeOfDay(hour)], { name: who }) : t('chat.greetingNoName')}
      </h1>
      <p className="mt-1.5 text-sm text-muted">{t('chat.greetingSub')}</p>
      {/* Phones: a balanced 2×2 grid of equal chips; ≥ sm: one centred row. */}
      <div className="mt-8 grid w-full max-w-xs grid-cols-2 gap-2 sm:flex sm:w-auto sm:max-w-xl sm:flex-wrap sm:justify-center">
        {EXAMPLES.map(({ key, label, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            data-testid="example-prompt"
            title={t(key)}
            onClick={() => onExample(t(key))}
            className="flex min-w-0 items-center justify-center gap-2 rounded-full border border-line bg-bg px-4 py-2 text-sm transition-colors hover:bg-hover"
          >
            <Icon className={cn('size-4', tone)} />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  )
}
