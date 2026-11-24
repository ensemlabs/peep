import { Check, ChevronDown, Lightbulb } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ModelInfo } from '@/api/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { levelMode } from '@/lib/reasoning'

interface Props {
  model: ModelInfo | undefined | null
  value: string | null
  onChange: (level: string) => void
}

/** Thinking level: hidden without reasoning, a static chip with one level, a dropdown otherwise. */
export function ReasoningLevel({ model, value, onChange }: Props) {
  const t = useT()
  const mode = levelMode(model)
  if (mode === 'hidden' || !model?.reasoning) return null

  if (mode === 'single') {
    return (
      <span
        data-testid="reasoning-level"
        data-mode="single"
        title={t('header.thinkingLevel')}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-muted tap:h-10"
      >
        <Lightbulb className="size-4 text-amber-500" aria-hidden />
        <span className="max-[329px]:hidden">{t('header.alwaysOn')}</span>
      </span>
    )
  }

  const levels = model.reasoning.levels
  const current = levels.find((l) => l.id === value) ?? levels[0]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        data-testid="reasoning-level"
        data-mode="multi"
        data-value={current.id}
        aria-label={`${t('header.thinkingLevel')}: ${current.label}`}
        title={t('header.thinkingLevel')}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg data-[state=open]:bg-hover tap:h-10"
      >
        {/* The bulb says what this is about: muted while off, accent colour once thinking is on. */}
        <Lightbulb className={cn('size-4 shrink-0', current.id === 'off' ? 'text-muted' : 'text-amber-500')} aria-hidden />
        <span className="max-w-32 truncate max-[329px]:hidden">
          <span className="hidden md:inline">{t('reasoning.label')}: </span>
          {current.label}
        </span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={8} className="z-50 min-w-40 rounded-xl border border-line bg-bg p-1 shadow-lg">
          <DropdownMenu.Label className="px-2.5 py-1 text-xs font-medium text-muted">{t('header.thinkingLevel')}</DropdownMenu.Label>
          {levels.map((l) => (
            <DropdownMenu.Item
              key={l.id}
              data-value={l.id}
              data-testid="reasoning-option"
              onSelect={() => onChange(l.id)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover"
            >
              {l.label}
              {l.id === current.id && <Check className="size-4" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
