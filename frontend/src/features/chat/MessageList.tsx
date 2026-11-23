import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { Message } from '@/api/types'
import { useT } from '@/i18n'
import { MessageView } from './MessageView'
import { EmptyState } from './EmptyState'

interface Props {
  messages: Message[]
  conversationKey: string
  onExample: (text: string) => void
}

const THRESHOLD = 80

export function MessageList({ messages, conversationKey, onExample }: Props) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const messagesLen = useRef(messages.length)
  messagesLen.current = messages.length
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD
    atBottom.current = near
    setShowJump(!near)
  }

  useLayoutEffect(() => {
    atBottom.current = true
    if (messages.length > 0) scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, scrollToBottom])

  useLayoutEffect(() => {
    if (messages.length === 0) scroller.current?.scrollTo({ top: 0 })
    else if (atBottom.current) scrollToBottom()
  }, [messages, scrollToBottom])

  // Content can grow without a new render (images load, steps animate open): keep following.
  useEffect(() => {
    const el = content.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atBottom.current && messagesLen.current > 0) scrollToBottom()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToBottom])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden" data-testid="message-scroller">
        <div ref={content} role="log" aria-label={t('chat.messageList')} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-6 sm:px-4">
          {messages.length === 0 ? (
            <EmptyState onExample={onExample} />
          ) : (
            messages.map((m) => <MessageView key={m.id} message={m} />)
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          data-testid="jump-latest"
          onClick={() => scrollToBottom(true)}
          aria-label={t('chat.jumpLatest')}
          title={t('chat.jumpLatest')}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1.5 text-xs font-medium shadow-md hover:bg-hover"
        >
          <ArrowDown className="size-3.5" />
          {t('chat.jumpLatest')}
        </button>
      )}
    </div>
  )
}
