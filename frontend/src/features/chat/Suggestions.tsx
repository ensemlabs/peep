import { Code2, FileText, Image as ImageIcon, Lightbulb } from 'lucide-react'
import { useT, type TKey } from '@/i18n'
import { cn } from '@/lib/cn'

export type SuggestionId = 'code' | 'image' | 'summarize' | 'explain'

export const SUGGESTIONS: { id: SuggestionId; icon: typeof Code2; tone: string }[] = [
  { id: 'code', icon: Code2, tone: 'text-violet-500' },
  { id: 'image', icon: ImageIcon, tone: 'text-rose-500' },
  { id: 'summarize', icon: FileText, tone: 'text-sky-500' },
  { id: 'explain', icon: Lightbulb, tone: 'text-amber-500' },
]

interface Props {
  /** `row`: phones, a snap-scrolling row above the composer. `wrap`: desktop, centred below it. */
  variant: 'row' | 'wrap'
  disabled?: boolean
  onPick: (id: SuggestionId, prompt: string) => void
}

/** Starter cards: a coloured icon, a bold title and a muted line that completes the thought. */
export function Suggestions({ variant, disabled, onPick }: Props) {
  const t = useT()
  const cards = SUGGESTIONS.map(({ id, icon: Icon, tone }) => (
    <button
      key={id}
      type="button"
      data-testid="example-prompt"
      data-prompt-id={id}
      disabled={disabled}
      onClick={() => onPick(id, t(`suggest.${id}.prompt` as TKey))}
      className={cn(
        'flex flex-col gap-1.5 rounded-2xl border border-line bg-bg px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-60',
        variant === 'row' ? 'w-[172px] shrink-0 snap-start' : 'w-[176px]',
      )}
    >
      <Icon className={cn('size-[18px]', tone)} aria-hidden />
      <span className="text-sm font-semibold leading-tight">{t(`suggest.${id}.title` as TKey)}</span>
      <span className="text-[13px] leading-tight text-muted">{t(`suggest.${id}.sub` as TKey)}</span>
    </button>
  ))
  if (variant === 'wrap') {
    return (
      <div data-testid="suggestions" data-variant="wrap" className="mx-auto flex w-full max-w-[768px] flex-wrap justify-center gap-2 px-4">
        {cards}
      </div>
    )
  }
  return (
    <div data-testid="suggestions" data-variant="row" className="relative">
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {cards}
        <span className="w-4 shrink-0" aria-hidden />
      </div>
      {/* fade on the right edge: hints that the row scrolls */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent" aria-hidden />
    </div>
  )
}
