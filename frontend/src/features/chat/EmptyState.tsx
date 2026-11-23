import { Mascot } from '@/components/Mascot'
import { useT, type TKey } from '@/i18n'

const EXAMPLES: TKey[] = ['chat.example1', 'chat.example2', 'chat.example3', 'chat.example4']

export function EmptyState({ onExample }: { onExample: (text: string) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center pt-[8vh] text-center" data-testid="empty-state">
      <Mascot size={88} className="mb-4" />
      <h1 className="text-2xl font-semibold tracking-tight">{t('chat.greeting')}</h1>
      <p className="mt-2 text-sm text-muted">{t('chat.greetingSub')}</p>
      <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {EXAMPLES.map((k) => (
          <button
            key={k}
            type="button"
            data-testid="example-prompt"
            onClick={() => onExample(t(k))}
            className="rounded-xl border border-line px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            {t(k)}
          </button>
        ))}
      </div>
    </div>
  )
}
