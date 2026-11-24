import { Mascot } from '@/components/Mascot'
import { useT, type TKey } from '@/i18n'
import { timeOfDay } from '@/lib/format'

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

/** Greeting block only; the suggestions and the composer are laid out by the chat page. */
export function EmptyState({ name, hour = new Date().getHours() }: { name?: string; hour?: number }) {
  const t = useT()
  const who = firstName(name)
  return (
    <div className="msg-enter flex flex-col items-center px-4 text-center" data-testid="empty-state">
      {/* Plays the greeting when this empty state mounts (new chat / new session), then idles. */}
      <Mascot size={88} state="greet" className="mb-3 max-sm:size-[72px]" />
      <h1 className="text-[26px] font-semibold tracking-tight max-sm:text-2xl" data-testid="greeting">
        {who ? t(GREETING[timeOfDay(hour)], { name: who }) : t('chat.greetingNoName')}
      </h1>
      <p className="mt-1.5 text-sm text-muted">{t('chat.greetingSub')}</p>
    </div>
  )
}
