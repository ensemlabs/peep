import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/api/client'
import type { FileMeta, Message, User } from '@/api/types'
import { useI18n } from '@/i18n'
import { Composer } from './Composer'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { attachRun, convKey, CONVERSATIONS_KEY, sendMessage, stopRun } from './runner'
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

  const models = useQuery({ queryKey: ['models'], queryFn: api.models, staleTime: 5 * 60_000, enabled: active })
  const { model: savedModel, setModel, reasoning, setReasoning } = useUiStore()
  const run = useRunStore((s) => (id ? s.runs[id] : undefined))

  const items = models.data?.items ?? []
  const model = items.some((m) => m.id === savedModel) ? savedModel : (models.data?.default ?? null)
  const current = items.find((m) => m.id === model)
  const effReasoning = current?.reasoning ? reasoning : 'off'

  const conv = useQuery({
    queryKey: convKey(id ?? ''),
    queryFn: () => api.conversation(id!),
    enabled: active && !!id && !run, // while a live run exists the run is the source of truth
    staleTime: 10_000,
  })

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

  const streaming = !!run || messages.some((m) => m.role === 'assistant' && m.status === 'streaming')

  async function onSend(text: string, attachments: FileMeta[]) {
    if (!model) return
    setSendError(null)
    const body = { content: text, attachment_ids: attachments.map((a) => a.id), model, reasoning: effReasoning }
    try {
      let convId = id
      if (!convId) {
        const created = await api.createConversation({ model })
        convId = created.id
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
      <ChatHeader models={items} model={model} reasoning={effReasoning} onModel={setModel} onReasoning={setReasoning} />
      {loadFailed ? (
        <p role="alert" className="m-6 text-sm text-danger">{t('chat.loadFailed')}</p>
      ) : (
        <MessageList
          messages={messages}
          conversationKey={id ?? 'new'}
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
        streaming={streaming}
        disabled={!model}
        autoFocus
        onSend={onSend}
        onStop={() => id && stopRun(id)}
      />
    </div>
  )
}
