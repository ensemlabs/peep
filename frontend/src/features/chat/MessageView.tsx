import { memo } from 'react'
import { AlertCircle, Square } from 'lucide-react'
import type { Message } from '@/api/types'
import { useT } from '@/i18n'
import { Spinner } from '@/components/ui/Spinner'
import { Mascot, mascotStateFor } from '@/components/Mascot'
import { MediaGrid } from '../media/MediaGrid'
import { Markdown } from './parts/Markdown'
import { PartsRenderer } from './parts/PartsRenderer'

export const MessageView = memo(function MessageView({ message }: { message: Message }) {
  const t = useT()
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="message-user" aria-label={t('chat.userMessage')}>
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-2">
          {message.attachments?.length > 0 && <MediaGrid files={message.attachments} />}
          {message.content && (
            <div className="whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
      </div>
    )
  }
  const live = message.status === 'streaming'
  const hasContent = message.parts.length > 0 || !!message.content
  return (
    <div className="flex min-w-0 gap-3" data-testid="message-assistant" data-status={message.status} aria-label={t('chat.assistantMessage')}>
      <div className="hidden pt-1 sm:block">
        <Mascot state={mascotStateFor(message)} size={30} animated={live} />
      </div>
      <div className="min-w-0 flex-1">
      {message.parts.length > 0 ? (
        <PartsRenderer parts={message.parts} live={live} />
      ) : (
        message.content && <Markdown text={message.content} />
      )}
      {live && !hasContent && <Spinner className="my-2 text-muted" label={t('common.loading')} />}
      {message.status === 'stopped' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Square className="size-3" /> {t('chat.stopped')}</p>
      )}
      {message.status === 'error' && (
        <p role="alert" title={message.error ?? undefined} className="mt-2 flex items-center gap-1.5 text-sm text-danger" data-testid="message-error">
          <AlertCircle className="size-4 shrink-0" />
          {message.error === 'interrupted' ? t('chat.interrupted') : t('chat.failed')}
        </p>
      )}
      </div>
    </div>
  )
})
