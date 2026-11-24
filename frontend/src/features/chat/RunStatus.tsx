import { useEffect, useRef, useState } from 'react'
import type { Message, Part } from '@/api/types'
import { Mascot, mascotStateFor, type MascotState } from '@/components/Mascot'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useT, type TKey } from '@/i18n'
import { formatDuration, formatTokens } from '@/lib/format'
import { cn } from '@/lib/cn'

export const VERB_COUNT = 8
export const VERB_INTERVAL_MS = 2500

/** Characters streamed so far (text, thinking, tool output) for the "≈ ↓" estimate. */
export function streamedChars(parts: Part[]): number {
  let n = 0
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'thinking') n += p.text.length
    else if (p.type === 'tool') n += p.output?.length ?? 0
    else if (p.type === 'subagent') n += streamedChars(p.parts)
  }
  return n
}

/** Pip's pose for the status line: the running part, otherwise a generic "working". */
export function statusMascotState(message: Message): MascotState {
  return mascotStateFor(message)
}

/** Pip walks while thinking or while text streams; it stops and "types" while a tool or sub-agent runs. */
export function statusPose(message: Message): { state: MascotState; walking: boolean } {
  const state = mascotStateFor(message)
  return { state, walking: state !== 'working' }
}

export function tokenText(message: Message): string {
  const u = message.usage
  if (u) return `↑ ${formatTokens(u.input_tokens)} ↓ ${formatTokens(u.output_tokens)}`
  return `≈ ↓ ${formatTokens(Math.ceil(streamedChars(message.parts) / 4))}`
}

/** Escape stops the run only when it is not already doing something else. */
export function shouldStopOnEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  if (e.isComposing || e.keyCode === 229) return false // IME composition
  const el = e.target instanceof HTMLElement ? e.target : null
  // The chat composer is the one text field where Esc stops the run (focus stays there after sending).
  if (el && !el.closest('[data-composer]') && (el.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]') || el.isContentEditable)) return false
  // Open dialogs, menus, poppers and the mobile drawer consume Escape first.
  if (document.querySelector('[role=dialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper],[data-testid=sidebar][data-open=true]')) return false
  return true
}

function useElapsedSince(createdAt: string): number {
  const [start] = useState(() => {
    const c = Date.parse(createdAt)
    const age = Date.now() - c
    return Number.isFinite(c) && age >= 0 && age < 30 * 60_000 ? c : Date.now()
  })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, now - start)
}

interface Props {
  message: Message
  onStop?: () => void
  leaving?: boolean
}

/** Claude-Code-style live status line under a streaming reply. Esc stops the run. */
export function RunStatus({ message, onStop, leaving }: Props) {
  const t = useT()
  const [verb, setVerb] = useState(0)
  const elapsed = useElapsedSince(message.created_at)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const pose = statusPose(message)
  const walking = pose.walking && !reduced

  useEffect(() => {
    const id = setInterval(() => setVerb((v) => (v + 1) % VERB_COUNT), VERB_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // The listener is bound once; the latest onStop lives in a ref so re-renders never rebind it.
  const stopRef = useRef(onStop)
  stopRef.current = onStop
  const canStop = !!onStop && !leaving
  useEffect(() => {
    if (!canStop) return
    const onKey = (e: KeyboardEvent) => {
      if (shouldStopOnEscape(e)) stopRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canStop])

  return (
    <div
      data-testid="run-status"
      data-leaving={leaving ? 'true' : 'false'}
      className={cn(
        'mt-2 flex items-center gap-2 text-[13px] text-muted transition-opacity duration-300',
        leaving ? 'opacity-0' : 'opacity-100',
      )}
    >
      {/* Screen readers hear only the start and the finish; the ticking parts are hidden from them. */}
      <span role="status" data-testid="run-status-sr" className="sr-only">
        {leaving ? t('run.finished') : t('run.working')}
      </span>
      <span aria-hidden className="flex items-center gap-2">
        {/* Fixed-size track: Pip patrols with transform-only animation, so nothing around it shifts. */}
        <span className="pip-track" data-testid="pip-track" data-reduced={reduced}>
          <span className="pip-walker" data-testid="pip-walker" data-walking={walking}>
            <span className="pip-hopper">
              <Mascot size={26} state={pose.state} walking={walking} />
            </span>
          </span>
        </span>
        <span key={verb} data-testid="run-verb" className="verb-fade font-medium text-fg/80">
          {t(`verb.${verb + 1}` as TKey)}…
        </span>
        <span data-testid="run-elapsed" className="tabular-nums">{formatDuration(elapsed, t)}</span>
        <span data-testid="run-tokens" className="tabular-nums">{tokenText(message)}</span>
        {onStop && <span className="hidden text-xs opacity-70 md:inline">{t('run.escToStop')}</span>}
      </span>
    </div>
  )
}
