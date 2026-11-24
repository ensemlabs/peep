import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ModelInfo } from '@/api/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

interface Props {
  models: ModelInfo[]
  value: ModelInfo | undefined
  onChange: (id: string) => void
  /** Where the menu opens: above the composer, or beside the drawer. */
  side?: 'top' | 'bottom'
  className?: string
}

/** Dev-only model switcher (rendered only when the server reports `switchable`). */
export function ModelPicker({ models, value, onChange, side = 'top', className }: Props) {
  const t = useT()
  const groups = [
    { key: 'real', label: t('models.openai'), items: models.filter((m) => m.provider !== 'replay') },
    { key: 'replay', label: t('models.replay'), items: models.filter((m) => m.provider === 'replay') },
  ]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        data-testid="model-picker"
        aria-label={t('header.model')}
        className={cn('flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover hover:text-fg data-[state=open]:bg-hover tap:h-10', className)}
      >
        <span className="truncate">{value?.label ?? t('header.model')}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align="start" sideOffset={8} className="z-50 max-h-[70dvh] min-w-56 max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-line bg-bg p-1 shadow-lg">
          {groups.filter((g) => g.items.length).map((g, gi) => (
            <div key={g.key}>
              {gi > 0 && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
              <DropdownMenu.Label className="px-2.5 py-1 text-xs font-medium text-muted">{g.label}</DropdownMenu.Label>
              {g.items.map((m) => (
                <DropdownMenu.Item
                  key={m.id}
                  data-testid={`model-option-${m.id}`}
                  onSelect={() => onChange(m.id)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover"
                >
                  <span className="truncate">{m.label}</span>
                  {m.id === value?.id && <Check className="size-4 shrink-0" />}
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
