import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { DropdownMenu } from 'radix-ui'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import type { Conversation } from '@/api/types'
import { useI18n } from '@/i18n'
import { useToasts } from '@/components/Toaster'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CONVERSATIONS_KEY, convKey } from './runner'

/** Rename / pin / delete for one conversation; shared by the sidebar rows and the chat header. */
export function useConversationActions(conv: Pick<Conversation, 'id' | 'title' | 'pinned'>) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { err } = useI18n()
  const toast = useToasts((s) => s.push)
  const patch = useMutation({
    mutationFn: (b: { title?: string; pinned?: boolean }) => api.patchConversation(conv.id, b),
    onSuccess: (updated) => {
      // Update the cached conversation directly: its query is disabled during a run, so a refetch would not happen.
      qc.setQueryData<{ conversation: Conversation; messages: unknown[] }>(convKey(conv.id), (old) =>
        old ? { ...old, conversation: { ...old.conversation, ...updated } } : old,
      )
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
    onError: (e) => toast(err(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteConversation(conv.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
      qc.removeQueries({ queryKey: convKey(conv.id) })
      if (location.pathname === `/c/${conv.id}`) navigate('/')
    },
  })
  return {
    rename: (title: string) => patch.mutate({ title }),
    togglePin: () => patch.mutate({ pinned: !conv.pinned }),
    remove,
  }
}

const ITEM = 'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-hover'

export function ConversationMenuItems({ pinned, onRename, onPin, onDelete }: { pinned?: boolean; onRename: () => void; onPin: () => void; onDelete: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <DropdownMenu.Item onSelect={onRename} className={ITEM} data-testid="conv-rename">
        <Pencil className="size-4" /> {t('sidebar.rename')}
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={onPin} className={ITEM} data-testid="conv-pin">
        {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} {pinned ? t('sidebar.unpin') : t('sidebar.pin')}
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      <DropdownMenu.Item onSelect={onDelete} className={`${ITEM} text-danger`} data-testid="conv-delete">
        <Trash2 className="size-4" /> {t('sidebar.delete')}
      </DropdownMenu.Item>
    </>
  )
}

export function DeleteConversationDialog({
  open, onOpenChange, title, remove,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  remove: ReturnType<typeof useConversationActions>['remove']
}) {
  const { t, err } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.deleteTitle')}
      description={t('sidebar.deleteBody', { title })}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            data-testid="confirm-delete"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      {remove.isError && <p role="alert" data-testid="delete-error" className="text-sm text-danger">{err(remove.error)}</p>}
    </Dialog>
  )
}
