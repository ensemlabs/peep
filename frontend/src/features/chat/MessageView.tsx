import { memo, useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, Square } from 'lucide-react'
import type { Message } from '@/api/types'
import { useT } from '@/i18n'
import { usageSummary } from '@/lib/format'
import { Mascot, mascotStateFor } from '@/components/Mascot'
import { MediaGrid } from '../media/MediaGrid'
import { Markdown } from './parts/Markdown'
import { PartsRenderer } from './parts/PartsRenderer'
import { RunStatus } from './RunStatus'

/** Keep a node mounted for `ms` after `on` turns false so it can fade out. */
function useLeaving(on: boolean, ms: number) {
  const [mounted, setMounted] = useState(on)
  useEffect(() => {
    if (on) {
      setMounted(true)
      return
    }
    const id = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(id)
  }, [on, ms])
  return { mounted: on || mounted, leaving: !on && mounted }
}

/** Plain text of an assistant reply: the root text parts, else the stored content. */
export function messageText(m: Message): string {
  const texts = m.parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''))
  return texts.length ? texts.join('\n\n') : m.content
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function AssistantActions({ message }: { message: Message }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const time = formatTime(message.created_at)
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
      className="mt-1 flex items-center gap-1 text-xs text-muted transition-opacity md:opacity-0 md:group-focus-within/msg:opacity-100 md:group-hover/msg:opacity-100"
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
      {time && <span data-testid="message-time" title={t('message.time', { time })} className="px-1 tabular-nums">{time}</span>}
      {message.usage && (
        <span data-testid="message-usage" title={t('message.tokens')} className="px-1 tabular-nums">
          {usageSummary(message.usage)}
        </span>
      )}
    </div>
  )
}

export const MessageView = memo(function MessageView({ message, isLast = false, onStop }: { message: Message; isLast?: boolean; onStop?: () => void }) {
  const t = useT()
  const live = message.status === 'streaming'
  const status = useLeaving(live, 300) // hook order must not depend on the role
  if (message.role === 'user') {
    return (
      <div className="msg-enter flex justify-end" data-testid="message-user" aria-label={t('chat.userMessage')}>
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
          {message.attachments?.length > 0 && <MediaGrid files={message.attachments} />}
          {message.content && (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2 text-[15px] leading-relaxed">
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
      className="msg-enter group/msg flex min-w-0 gap-3"
      data-testid="message-assistant"
      data-status={message.status}
      aria-label={t('chat.assistantMessage')}
    >
      <div className="hidden pt-0.5 sm:block">
        <Mascot state={mascotStateFor(message)} size={28} animated={live || isLast} />
      </div>
      <div className="min-w-0 flex-1">
        {message.parts.length > 0 ? (
          <PartsRenderer parts={message.parts} live={live} />
        ) : (
          message.content && <Markdown text={message.content} />
        )}
        {status.mounted && <RunStatus message={message} onStop={onStop} leaving={status.leaving} />}
        {message.status === 'stopped' && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Square className="size-3" /> {t('chat.stopped')}</p>
        )}
        {message.status === 'error' && (
          <p role="alert" title={message.error ?? undefined} className="mt-2 flex items-center gap-1.5 text-sm text-danger" data-testid="message-error">
            <AlertCircle className="size-4 shrink-0" />
            {message.error === 'interrupted' ? t('chat.interrupted') : t('chat.failed')}
          </p>
        )}
        {!live && hasContent && <AssistantActions message={message} />}
      </div>
    </div>
  )
})
