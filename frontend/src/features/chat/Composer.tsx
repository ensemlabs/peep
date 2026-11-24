import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { ArrowUp, FileText, Film, Music, Plus, Square, X, AlertCircle } from 'lucide-react'
import { api, uploadFile as defaultUpload } from '@/api/client'
import type { FileMeta } from '@/api/types'
import { useI18n } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/Spinner'

type Upload = (file: File, onProgress: (f: number) => void, signal?: AbortSignal, opts?: { conversationId?: string }) => Promise<FileMeta>

interface Attachment {
  key: string
  file: File
  progress: number
  status: 'uploading' | 'done' | 'error'
  meta?: FileMeta
  error?: string
  preview?: string
  controller: AbortController
}

interface Props {
  streaming: boolean
  disabled?: boolean
  onSend: (text: string, attachments: FileMeta[]) => void
  onStop: () => void
  upload?: Upload
  /** Set inside /c/:id so uploads are tied to that conversation; absent on the new-chat page. */
  conversationId?: string
  /** Deletes an uploaded, not-yet-sent file on the server (404/409 are ignored). */
  removeFile?: (id: string) => Promise<unknown>
  autoFocus?: boolean
  initialText?: string
  /** Slot next to Send (the context ring); receives the live draft. */
  renderRing?: (draft: { text: string }) => ReactNode
  /** Toolbar slot after the attach button (thinking level). */
  toolbar?: ReactNode
  /** Called when the set of ready attachments changes (add/remove/finish). */
  onAttachmentsChange?: (count: number) => void
  ref?: Ref<ComposerHandle>
}

export interface ComposerHandle {
  /** Opens the file picker; after files are attached, an empty draft is prefilled with `prefill`. */
  pickFiles: (prefill?: string) => void
}

let seq = 0
const defaultRemove = (id: string) => api.deleteFile(id).catch(() => {})

export function Composer({ streaming, disabled, onSend, onStop, upload = defaultUpload, conversationId, removeFile = defaultRemove, autoFocus, initialText = '', renderRing, toolbar, onAttachmentsChange, ref }: Props) {
  const { t, err } = useI18n()
  const [text, setText] = useState(initialText)
  const [items, setItems] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const prefillRef = useRef<string | null>(null)
  useEffect(() => {
    const el = fileRef.current
    const onCancel = () => (prefillRef.current = null) // picker dismissed: no prefill
    el?.addEventListener('cancel', onCancel)
    return () => el?.removeEventListener('cancel', onCancel)
  }, [])
  useImperativeHandle(ref, () => ({
    pickFiles: (prefill) => {
      prefillRef.current = prefill ?? null
      fileRef.current?.click()
    },
  }))
  const itemsRef = useRef(items)
  itemsRef.current = items

  // Autosize up to ~40% of the viewport.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`
  }, [text])

  useEffect(() => {
    if (autoFocus) taRef.current?.focus()
  }, [autoFocus])

  useEffect(
    () => () => {
      itemsRef.current.forEach((a) => {
        a.controller.abort()
        if (a.preview) URL.revokeObjectURL(a.preview)
      })
    },
    [],
  )

  const patch = useCallback((key: string, p: Partial<Attachment>) => {
    setItems((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a)))
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      if (prefillRef.current !== null) {
        const pre = prefillRef.current
        prefillRef.current = null
        setText((cur) => (cur.trim() ? cur : pre))
      }
      const created: Attachment[] = files.map((file) => ({
        key: `f${++seq}`,
        file,
        progress: 0,
        status: 'uploading',
        controller: new AbortController(),
        preview: file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
      }))
      setItems((list) => [...list, ...created])
      created.forEach((a) => {
        upload(a.file, (progress) => patch(a.key, { progress }), a.controller.signal, { conversationId })
          .then((meta) => patch(a.key, { status: 'done', meta, progress: 1 }))
          .catch((e) => {
            if (a.controller.signal.aborted) return
            patch(a.key, { status: 'error', error: err(e) })
          })
      })
    },
    [upload, patch, err, conversationId],
  )

  // Window-level drag & drop.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      addFiles(Array.from(e.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [addFiles])

  const uploading = items.some((a) => a.status === 'uploading')
  const ready = items.filter((a) => a.status === 'done' && a.meta)
  const readyCount = ready.length
  const onChangeRef = useRef(onAttachmentsChange)
  onChangeRef.current = onAttachmentsChange
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    onChangeRef.current?.(readyCount)
  }, [readyCount])
  const canSend = !disabled && !uploading && (text.trim().length > 0 || ready.length > 0)

  function submit() {
    if (!canSend || streaming) return
    onSend(text.trim(), ready.map((a) => a.meta!))
    items.forEach((a) => a.preview && URL.revokeObjectURL(a.preview))
    setItems([])
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    // IME composition (Vietnamese Telex/VNI, CJK): Enter confirms the composition, it must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  function remove(a: Attachment) {
    a.controller.abort()
    if (a.preview) URL.revokeObjectURL(a.preview)
    if (a.meta) void removeFile(a.meta.id)
    setItems((list) => list.filter((x) => x.key !== a.key))
  }

  return (
    <div className="mx-auto w-full max-w-[768px] bg-gradient-to-t from-bg from-70% to-transparent px-3 pb-[max(12px,var(--safe-bottom))] pt-3 sm:px-4 sm:pb-[max(16px,var(--safe-bottom))]">
      {dragging && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
        >
          <div className="rounded-2xl border-2 border-dashed border-fg/40 px-8 py-6 text-lg font-medium">{t('chat.dropHere')}</div>
        </div>
      )}
      <div className="rounded-[28px] border border-line/70 bg-surface-2 shadow-[0_2px_16px_-6px_rgb(0_0_0/0.16)] transition-shadow focus-within:shadow-[0_4px_22px_-6px_rgb(0_0_0/0.22)]">
        {items.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label={t('chat.attach')}>
            {items.map((a) => (
              <li
                key={a.key}
                data-testid="attachment-chip"
                data-status={a.status}
                className={cn(
                  'relative flex max-w-[14rem] items-center gap-2 overflow-hidden rounded-xl border bg-bg py-1.5 pl-1.5 pr-8 text-xs',
                  a.status === 'error' ? 'border-danger/60' : 'border-line',
                )}
              >
                <Thumb a={a} />
                <div className="min-w-0">
                  <div className="truncate font-medium" title={a.file.name}>{a.file.name}</div>
                  <div className={cn('truncate', a.status === 'error' ? 'text-danger' : 'text-muted')}>
                    {a.status === 'uploading'
                      ? `${t('chat.uploading')} ${Math.round(a.progress * 100)}%`
                      : a.status === 'error'
                        ? a.error ?? t('chat.uploadFailed')
                        : formatBytes(a.file.size)}
                  </div>
                </div>
                {a.status === 'uploading' && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(a.progress * 100)}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-line"
                  >
                    <div className="h-full bg-fg transition-[width]" style={{ width: `${a.progress * 100}%` }} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={t('chat.removeAttachment', { name: a.file.name })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-hover hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={taRef}
          data-testid="composer-input"
          data-composer
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          className="block max-h-[40dvh] min-h-[52px] w-full resize-none bg-transparent px-5 pb-1 pt-3.5 text-[15px] leading-6 placeholder:text-muted focus:outline-none focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-1 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-0.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label={t('chat.attach')}
            title={t('chat.attach')}
            data-testid="attach-button"
            className="flex items-center justify-center rounded-full p-2 text-muted hover:bg-hover hover:text-fg disabled:opacity-50 tap:size-10 tap:p-0"
          >
            <Plus className="size-5" />
          </button>
            {toolbar}
          </div>
          <div className="flex items-center gap-1">
          {renderRing?.({ text })}
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
              data-testid="stop-button"
              className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-90 tap:size-10"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={t('chat.send')}
              title={t('chat.send')}
              data-testid="send-button"
              className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-30 tap:size-10"
            >
              {uploading ? <Spinner /> : <ArrowUp className="size-5" />}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Thumb({ a }: { a: Attachment }) {
  const cls = 'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted'
  if (a.preview) {
    return (
      <span className={cls}>
        <img src={a.preview} alt="" className="size-full object-cover" />
      </span>
    )
  }
  const type = a.file.type
  return (
    <span className={cls} aria-hidden>
      {a.status === 'error' ? <AlertCircle className="size-4 text-danger" /> : type.startsWith('video/') ? <Film className="size-4" /> : type.startsWith('audio/') ? <Music className="size-4" /> : <FileText className="size-4" />}
    </span>
  )
}
