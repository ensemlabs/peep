import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/api/client'
import type { FileMeta, Message, User } from '@/api/types'
import { useI18n } from '@/i18n'
import { Composer } from './Composer'
import { ReasoningLevel } from './ReasoningLevel'
import { ContextRing } from './ContextRing'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { resolveLevel } from '@/lib/reasoning'
import { attachRun, CONTEXT_KEY, convKey, CONVERSATIONS_KEY, markReadWhenVisible, readKeyFor, sendMessage, stopRun } from './runner'
import { useRunStore, useUiStore } from './stores'

export function ChatRoute() {
  const { id } = useParams()
  return <ChatPage key={id ?? 'new'} id={id} />
}

function ChatPage({ id }: { id?: string }) {
  const { t, err } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useOutletContext<User>()
  const active = user.status === 'active'
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const [seed, setSeed] = useState('')

  const { lang } = useI18n()
  const models = useQuery({ queryKey: ['models', lang], queryFn: api.models, staleTime: 5 * 60_000, enabled: active })
  const savedModel = useUiStore((s) => s.model)
  const setModel = useUiStore((s) => s.setModel)
  const levels = useUiStore((s) => s.levels)
  const setLevel = useUiStore((s) => s.setLevel)
  const run = useRunStore((s) => (id ? s.runs[id] : undefined))

  const switchable = models.data?.switchable ?? false
  const items = models.data?.items ?? []

  const context = useQuery({
    queryKey: [...CONTEXT_KEY, id ?? 'new'],
    queryFn: () => api.context(id),
    enabled: active,
    staleTime: 30_000,
  })

  const conv = useQuery({
    queryKey: convKey(id ?? ''),
    queryFn: () => api.conversation(id!),
    enabled: active && !!id && !run, // while a live run exists the run is the source of truth
    staleTime: 10_000,
  })

  // Model shown and used: this view's pick, else the open conversation's own model, else (new chat) the remembered one.
  const [picked, setPicked] = useState<string | null>(null)
  const convModel = id ? conv.data?.conversation.model : null
  const wanted = picked ?? convModel ?? (id ? null : savedModel)
  const current = (switchable ? items.find((m) => m.id === wanted) : undefined) ?? models.data?.active
  const level = resolveLevel(current, current ? levels[current.id] : undefined)
  const onModel = useCallback((mid: string) => {
    setPicked(mid)
    setModel(mid) // remembered for new chats
  }, [setModel])

  const server = conv.data?.messages
  const messages = useMemo<Message[]>(() => {
    const base = server ?? []
    if (!run) return base
    const liveIds = new Set([run.user?.id, run.assistant?.id].filter(Boolean))
    const kept = base.filter((m) => !liveIds.has(m.id))
    return [...kept, ...(run.user ? [run.user] : []), ...(run.assistant ? [run.assistant] : [])]
  }, [server, run])

  // Reload / revisit during a run: re-attach to the in-flight assistant message.
  const attached = useRef(false)
  useEffect(() => {
    if (!id || run || !server || attached.current) return
    const last = server[server.length - 1]
    if (last?.role === 'assistant' && last.status === 'streaming') {
      attached.current = true
      void attachRun(id, last.id, qc).finally(() => {
        attached.current = false
      })
    }
  }, [id, run, server, qc])

  // Opening a conversation (or landing on its finished state) marks it read, once, when the tab is visible.
  const lastMsg = server?.[server.length - 1]
  const readKey = id ? readKeyFor(id, server) : null
  useEffect(() => {
    if (!id || !readKey || run || lastMsg?.status === 'streaming') return
    return markReadWhenVisible(qc, id, readKey)
  }, [id, readKey, run, lastMsg?.status, qc])

  // Stable identity so memoised message rows do not re-render every streamed frame.
  const onStop = useCallback(() => {
    if (id) void stopRun(id)
  }, [id])
  const attachTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(attachTimer.current), [])
  const onAttachmentsChange = useCallback(() => {
    clearTimeout(attachTimer.current)
    attachTimer.current = setTimeout(() => qc.invalidateQueries({ queryKey: CONTEXT_KEY }), 300)
  }, [qc])

  const streaming = !!run || messages.some((m) => m.role === 'assistant' && m.status === 'streaming')

  async function onSend(text: string, attachments: FileMeta[]) {
    if (!current) return
    setSendError(null)
    const body = {
      content: text,
      attachment_ids: attachments.map((a) => a.id),
      ...(switchable ? { model: current.id } : {}),
      ...(level ? { reasoning: level } : {}),
    }
    try {
      let convId = id
      if (!convId) {
        const created = await api.createConversation(switchable ? { model: current.id } : {})
        convId = created.id
        // Seed the cache so the header shows the title and menu during the very first reply.
        qc.setQueryData(convKey(convId), { conversation: created, messages: [] })
        qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
        navigate(`/c/${convId}`)
      }
      void sendMessage(convId, body, attachments, qc)
    } catch (e) {
      setSendError(err(e))
      setSeed(text)
      setDraftKey((k) => k + 1)
    }
  }

  const loadFailed = conv.isError

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatHeader
        switchable={switchable}
        models={items}
        model={current}
        onModel={onModel}
        conversation={id && conv.data ? conv.data.conversation : undefined}
      />
      {loadFailed ? (
        <p role="alert" className="m-6 text-sm text-danger">{t('chat.loadFailed')}</p>
      ) : (
        <MessageList
          messages={messages}
          conversationKey={id ?? 'new'}
          userName={user.display_name}
          onStop={id ? onStop : undefined}
          loading={!!id && conv.isLoading && !run}
          onExample={(text) => {
            setSeed(text)
            setDraftKey((k) => k + 1)
          }}
        />
      )}
      {(sendError || run?.error) && (
        <p role="alert" data-testid="send-error" className="mx-auto w-full max-w-3xl px-4 pb-2 text-sm text-danger">
          {sendError ?? err(new ApiError(run?.error ?? 'generic', 0, ''))}
        </p>
      )}
      <Composer
        key={draftKey}
        initialText={seed}
        conversationId={id}
        streaming={streaming}
        disabled={!current}
        toolbar={<ReasoningLevel model={current} value={level} onChange={(l) => current && setLevel(current.id, l)} />}
        renderRing={({ text }) => <ContextRing data={context.data} model={current} draftText={text} />}
        onAttachmentsChange={onAttachmentsChange}
        autoFocus
        onSend={onSend}
        onStop={onStop}
      />
    </div>
  )
}
