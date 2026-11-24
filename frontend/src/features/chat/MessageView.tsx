import { memo, useState } from 'react'
import { Check, Copy, Square } from 'lucide-react'
import type { Message } from '@/api/types'
import { useT } from '@/i18n'
import { usageSummary } from '@/lib/format'
import { Mascot } from '@/components/Mascot'
import { MediaGrid } from '../media/MediaGrid'
import { Markdown } from './parts/Markdown'
import { PartsRenderer } from './parts/PartsRenderer'

/** Plain text of an assistant reply: the root text parts, else the stored content. */
export function messageText(m: Message): string {
  const texts = m.parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''))
  return texts.length ? texts.join('\n\n') : m.content
}

function AssistantActions({ message }: { message: Message }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(messageText(message))
    } catch {
      /* clipboard may be unavailable (insecure context) */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      data-testid="message-actions"
      className="mt-1.5 flex items-center gap-1 text-xs text-muted transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/msg:opacity-100 [@media(hover:hover)]:group-hover/msg:opacity-100"
    >
      <button
        type="button"
        data-testid="copy-message"
        onClick={copy}
        aria-label={t('message.copy')}
        title={t('message.copy')}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover hover:text-fg"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied && <span>{t('common.copied')}</span>}
      </button>
      {message.usage && (
        <span data-testid="message-usage" title={t('message.tokens')} className="hidden px-1 tabular-nums md:inline">
          {usageSummary(message.usage)}
        </span>
      )}
    </div>
  )
}

export const MessageView = memo(function MessageView({ message }: { message: Message }) {
  const t = useT()
  const live = message.status === 'streaming'
  if (message.role === 'user') {
    return (
      <div className="msg-enter flex justify-end" data-testid="message-user" aria-label={t('chat.userMessage')}>
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5 md:max-w-[70%]">
          {message.attachments?.length > 0 && <MediaGrid files={message.attachments} />}
          {message.content && (
            <div className="whitespace-pre-wrap break-words rounded-3xl bg-surface-2 px-5 py-2.5 text-base leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
      </div>
    )
  }
  const hasContent = message.parts.length > 0 || !!message.content
  return (
    <div
      className="msg-enter group/msg min-w-0"
      data-testid="message-assistant"
      data-status={message.status}
      aria-label={t('chat.assistantMessage')}
    >
      <div className="min-w-0">
        {live && !hasContent && (
          // Waiting for the first content: one small Peep in the reply position (thought dots, head-cock).
          <div data-testid="reply-pending" role="status" aria-label={t('common.loading')} className="py-1">
            <Mascot size={20} state="pending" />
          </div>
        )}
        {message.parts.length > 0 ? (
          <PartsRenderer parts={message.parts} live={live} />
        ) : (
          message.content && <Markdown text={message.content} />
        )}
        {message.status === 'stopped' && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Square className="size-3" /> {t('chat.stopped')}</p>
        )}
        {message.status === 'error' && (
          <p role="alert" title={message.error ?? undefined} className="mt-2 flex items-center gap-1.5 text-sm text-danger" data-testid="message-error">
            <Mascot size={20} state="error" />
            {message.error === 'interrupted' ? t('chat.interrupted') : t('chat.failed')}
          </p>
        )}
        {!live && hasContent && <AssistantActions message={message} />}
      </div>
    </div>
  )
})
