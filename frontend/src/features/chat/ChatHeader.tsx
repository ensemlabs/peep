import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ModelInfo, Reasoning } from '@/api/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { TopBar } from '@/layout/TopBar'

interface Props {
  models: ModelInfo[]
  model: string | null
  reasoning: Reasoning
  onModel: (id: string) => void
  onReasoning: (r: Reasoning) => void
}

export function ChatHeader({ models, model, reasoning, onModel, onReasoning }: Props) {
  const t = useT()
  const current = models.find((m) => m.id === model)
  const groups: { key: 'openai' | 'replay'; label: string; items: ModelInfo[] }[] = [
    { key: 'openai', label: t('models.openai'), items: models.filter((m) => m.provider === 'openai') },
    { key: 'replay', label: t('models.replay'), items: models.filter((m) => m.provider === 'replay') },
  ]
  const canThink = !!current?.reasoning
  const on = canThink && reasoning === 'high'

  return (
    <TopBar>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          data-testid="model-picker"
          aria-label={t('header.model')}
          className="flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-hover"
        >
          <span className="truncate">{current?.label ?? t('header.model')}</span>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[70dvh] min-w-56 max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-line bg-bg p-1 shadow-lg"
          >
            {groups.filter((g) => g.items.length).map((g, gi) => (
              <div key={g.key}>
                {gi > 0 && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
                <DropdownMenu.Label className="px-2.5 py-1 text-xs font-medium text-muted">{g.label}</DropdownMenu.Label>
                {g.items.map((m) => (
                  <DropdownMenu.Item
                    key={m.id}
                    data-testid={`model-option-${m.id}`}
                    onSelect={() => onModel(m.id)}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover"
                  >
                    <span className="truncate">{m.label}</span>
                    {m.id === model && <Check className="size-4 shrink-0" />}
                  </DropdownMenu.Item>
                ))}
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className="flex-1" />

      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-testid="thinking-toggle"
        data-state={on ? 'high' : 'off'}
        disabled={!canThink}
        title={canThink ? undefined : t('header.thinkingUnsupported')}
        onClick={() => onReasoning(on ? 'off' : 'high')}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm hover:bg-hover disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <span>{t('header.thinking')}</span>
        <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-medium', on ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted')}>
          {on ? t('header.thinkingHigh') : t('header.thinkingOff')}
        </span>
      </button>
    </TopBar>
  )
}
