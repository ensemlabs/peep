import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, MoreHorizontal } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { Conversation, ModelInfo } from '@/api/types'
import { useT } from '@/i18n'
import { TopBar } from '@/layout/TopBar'
import { ConversationMenuItems, DeleteConversationDialog, useConversationActions } from './conversationActions'

interface Props {
  switchable: boolean
  models: ModelInfo[]
  model: ModelInfo | undefined
  onModel: (id: string) => void
  /** The open conversation (undefined on a new chat). */
  conversation?: Pick<Conversation, 'id' | 'title' | 'pinned'>
}

/** The picker only exists when the server reports `switchable`; otherwise the model is a quiet static chip. */
function ConversationTitle({ conv }: { conv: Pick<Conversation, 'id' | 'title' | 'pinned'> }) {
  const t = useT()
  const actions = useConversationActions(conv)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conv.title)
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const renameRequested = useRef(false)
  useEffect(() => setTitle(conv.title), [conv.title])
  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])
  const commit = () => {
    const v = title.trim()
    setEditing(false)
    if (v && v !== conv.title) actions.rename(v)
    else setTitle(conv.title)
  }
  return (
    <div className="flex min-w-0 items-center gap-0.5" data-testid="chat-title">
      {editing ? (
        <input
          ref={ref}
          autoFocus
          value={title}
          maxLength={120}
          aria-label={t('sidebar.rename')}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setTitle(conv.title)
              setEditing(false)
            }
          }}
          className="h-8 w-56 max-w-full rounded-lg border border-fg/40 bg-bg px-2.5 text-sm font-medium focus:outline-none"
        />
      ) : (
        <h1 className="truncate px-1.5 text-sm font-medium" title={conv.title}>{conv.title || t('header.untitled')}</h1>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger aria-label={t('header.conversationMenu')} data-testid="chat-menu" className="flex items-center justify-center rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg tap:size-10 tap:p-0">
          <MoreHorizontal className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            className="z-50 min-w-40 rounded-xl border border-line bg-bg p-1 shadow-lg"
            // Radix returns focus to the trigger on close; after Rename the input must keep it.
            onCloseAutoFocus={(e) => {
              if (!renameRequested.current) return
              e.preventDefault()
              renameRequested.current = false
              requestAnimationFrame(() => {
                ref.current?.focus()
                ref.current?.select()
              })
            }}
          >
            <ConversationMenuItems pinned={conv.pinned} onRename={() => { renameRequested.current = true; setEditing(true) }} onPin={actions.togglePin} onDelete={() => setConfirm(true)} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <DeleteConversationDialog open={confirm} onOpenChange={setConfirm} title={conv.title || t('header.untitled')} remove={actions.remove} />
    </div>
  )
}

export function ChatHeader({ switchable, models, model, onModel, conversation }: Props) {
  const t = useT()
  const groups = [
    { key: 'openai', label: t('models.openai'), items: models.filter((m) => m.provider !== 'replay') },
    { key: 'replay', label: t('models.replay'), items: models.filter((m) => m.provider === 'replay') },
  ]
  return (
    <TopBar>
      {conversation && <ConversationTitle conv={conversation} />}
      <div className="flex-1" />
      {switchable ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            data-testid="model-picker"
            aria-label={t('header.model')}
            className="flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-hover"
          >
            <Cpu className="hidden size-4 shrink-0 text-muted max-[400px]:block" aria-hidden />
            <span className="truncate max-[400px]:hidden">{model?.label ?? t('header.model')}</span>
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
                      {m.id === model?.id && <Check className="size-4 shrink-0" />}
                    </DropdownMenu.Item>
                  ))}
                </div>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        model && (
          <span data-testid="model-label" className="hidden shrink-0 truncate px-2.5 text-sm text-muted sm:block">
            {model.label}
          </span>
        )
      )}

    </TopBar>
  )
}
