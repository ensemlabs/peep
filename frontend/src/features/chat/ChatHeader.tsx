import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, SquarePen } from 'lucide-react'
import { useNavigate } from 'react-router'
import { DropdownMenu } from 'radix-ui'
import type { Conversation } from '@/api/types'
import { useT } from '@/i18n'
import { TopBar } from '@/layout/TopBar'
import { ConversationMenuItems, DeleteConversationDialog, useConversationActions } from './conversationActions'

interface Props {
  /** The open conversation (undefined on a new chat). */
  conversation?: Pick<Conversation, 'id' | 'title' | 'pinned'>
}

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
        <h1 className="min-w-0 truncate px-1.5 text-sm font-medium" title={conv.title}>{conv.title || t('header.untitled')}</h1>
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

export function ChatHeader({ conversation }: Props) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <TopBar plain>
      <div className="flex min-w-0 flex-1 items-center max-md:justify-center">
        {conversation ? (
          <ConversationTitle conv={conversation} />
        ) : (
          // Empty chat on phones: the app name keeps the header from looking vacant.
          <span data-testid="header-app-name" className="truncate text-sm font-medium md:hidden">{t('app.name')}</span>
        )}
      </div>
      <button
        type="button"
        data-testid="header-new-chat"
        onClick={() => navigate('/')}
        aria-label={t('sidebar.newChat')}
        title={t('sidebar.newChat')}
        className="flex items-center justify-center rounded-lg p-2 text-muted hover:bg-hover hover:text-fg tap:size-10 tap:p-0 md:hidden"
      >
        <SquarePen className="size-5" />
      </button>
    </TopBar>
  )
}
