import type { QueryClient } from '@tanstack/react-query'
import { api, ApiError, type SendBody } from '@/api/client'
import { streamEvents } from '@/api/sse'
import type { FileMeta, Message, StreamEvent } from '@/api/types'
import { applyEvent } from './applyEvent'
import { whenVisible } from '@/lib/visibility'
import { useRunStore } from './stores'

export const convKey = (id: string) => ['conversation', id] as const
export const CONVERSATIONS_KEY = ['conversations'] as const
export const CONTEXT_KEY = ['context'] as const

/** `${conversationId}` -> `convId:lastMessageId:status` already marked read, so ChatPage does not POST /read again. */
export const readMarks = new Map<string, string>()

export function readKeyFor(conversationId: string, messages: Message[] | undefined): string | null {
  const last = messages?.[messages.length - 1]
  return last ? `${conversationId}:${last.id}:${last.status}` : null
}

/** Mark a conversation read once the tab is visible (so the unread badge works from another tab). */
export function markReadWhenVisible(qc: QueryClient, conversationId: string, key: string | null): () => void {
  if (key && readMarks.get(conversationId) === key) return () => {}
  return whenVisible(() => {
    if (key) readMarks.set(conversationId, key)
    api
      .markRead(conversationId)
      .catch(() => {})
      .finally(() => qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY }))
  })
}

type Frame = (cb: () => void) => void
const raf: Frame = (cb) =>
  typeof requestAnimationFrame === 'function' ? void requestAnimationFrame(cb) : void setTimeout(cb, 16)

/**
 * Drive one live run (send or re-attach). Events fold into local state through `applyEvent`;
 * React sees the result at most once per animation frame.
 */
async function drive(
  conversationId: string,
  qc: QueryClient,
  start: { user: Message | null; assistant: Message | null },
  open: (onEvent: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  let user = start.user
  let assistant = start.assistant
  let error: string | null = null
  let sawDone = false
  let scheduled = false
  let finished = false

  const flush = () => {
    scheduled = false
    if (finished) return // a late rAF must not resurrect a cleared run
    useRunStore.getState().setRun(conversationId, { user, assistant, controller, error })
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    raf(flush)
  }
  flush()

  try {
    await open((ev) => {
      if (ev.type === 'message') {
        user = ev.data.user_message
        assistant = ev.data.assistant_message
        qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY }) // title is set from the first message
      } else if (ev.type === 'snapshot') {
        assistant = ev.data.message
      } else if (assistant && ev.data.message_id === assistant.id) {
        assistant = applyEvent(assistant, ev)
        if (ev.type === 'done') sawDone = true
      }
      schedule()
    }, controller.signal)
  } catch (e) {
    error = e instanceof ApiError ? e.code : 'network'
  }

  flush()
  if (!sawDone && !controller.signal.aborted && !error) {
    // Stream closed without a terminal event (connection dropped): give the server a moment, then resync.
    await new Promise((r) => setTimeout(r, 1500))
  }
  let fresh: { messages: Message[] } | undefined
  try {
    fresh = await qc.fetchQuery({ queryKey: convKey(conversationId), queryFn: () => api.conversation(conversationId), staleTime: 0 })
  } catch {
    /* keep the cache as is */
  }
  // One refresh of the list and of the context per run.
  qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
  qc.invalidateQueries({ queryKey: CONTEXT_KEY })
  // The user is looking at this conversation: it is read as soon as the run ends (and the tab is visible).
  if (typeof window !== 'undefined' && window.location.pathname === `/c/${conversationId}`) {
    markReadWhenVisible(qc, conversationId, readKeyFor(conversationId, fresh?.messages))
  }
  finished = true
  useRunStore.getState().clearRun(conversationId)
}

export function sendMessage(
  conversationId: string,
  body: SendBody,
  attachments: FileMeta[],
  qc: QueryClient,
): Promise<void> {
  const now = new Date().toISOString()
  const optimistic: Message = {
    id: `tmp-${Date.now()}`, role: 'user', content: body.content, attachments, parts: [],
    status: 'complete', model: body.model ?? '', created_at: now,
  }
  return drive(conversationId, qc, { user: optimistic, assistant: null }, (onEvent, signal) =>
    streamEvents(`/api/conversations/${conversationId}/messages`, { method: 'POST', body }, onEvent, signal),
  )
}

export function attachRun(conversationId: string, messageId: string, qc: QueryClient): Promise<void> {
  return drive(conversationId, qc, { user: null, assistant: null }, (onEvent, signal) =>
    streamEvents(`/api/messages/${messageId}/events`, { method: 'GET' }, onEvent, signal),
  )
}

export async function stopRun(conversationId: string): Promise<void> {
  const run = useRunStore.getState().runs[conversationId]
  const id = run?.assistant?.id
  if (!id) return
  try {
    await api.stopMessage(id)
  } catch {
    /* the stream reports the outcome */
  }
}
