import { useEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import type { ContextInfo, ContextKey, ModelInfo } from '@/api/types'
import { useT, type TKey } from '@/i18n'
import { formatTokens } from '@/lib/format'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/cn'
import { Dialog } from '@/components/ui/Dialog'

export type RingTone = 'neutral' | 'amber' | 'red'

export function contextPercent(used: number, windowSize: number): number {
  if (!windowSize || windowSize <= 0) return 0
  return Math.max(0, Math.min(100, (used / windowSize) * 100))
}

export function ringTone(pct: number): RingTone {
  return pct > 90 ? 'red' : pct > 70 ? 'amber' : 'neutral'
}

/** Rough client-side estimate of the text being typed (chars / 4). */
export function estimateDraftTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const SEGMENTS: { key: ContextKey | 'free'; color: string }[] = [
  { key: 'system', color: 'bg-slate-400' },
  { key: 'user_messages', color: 'bg-violet-500' },
  { key: 'assistant_messages', color: 'bg-rose-400' },
  { key: 'attachments', color: 'bg-sky-500' },
  { key: 'tool_results', color: 'bg-amber-500' },
  { key: 'skills', color: 'bg-emerald-500' },
  { key: 'free', color: 'bg-surface-2' },
]

const TONE_TEXT: Record<RingTone, string> = { neutral: 'text-fg/70', amber: 'text-amber-500', red: 'text-red-500' }

const TONE_STROKE: Record<RingTone, string> = {
  neutral: 'stroke-fg/70',
  amber: 'stroke-amber-500',
  red: 'stroke-red-500',
}

function Ring({ pct, tone, size = 20 }: { pct: number; tone: RingTone; size?: number }) {
  const r = 8
  const c = 2 * Math.PI * r
  const tiny = pct > 0 && pct < 1
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="-rotate-90">
      {/* full track so it reads as a gauge, never a spinner */}
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-muted/35" />
      {tiny ? (
        <circle data-testid="context-ring-dot" cx={10 + r} cy="10" r="2" className={cn('fill-current', TONE_TEXT[tone])} />
      ) : (
        pct >= 1 && (
          <circle
            data-testid="context-ring-arc"
            cx="10"
            cy="10"
            r={r}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            className={cn('transition-[stroke-dashoffset] duration-300', TONE_STROKE[tone])}
          />
        )
      )}
    </svg>
  )
}

function Dash({ title }: { title: string }) {
  return (
    <span title={title} aria-label={title} className="cursor-help text-muted">
      —
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  )
}

interface DetailsProps {
  data: ContextInfo
  model?: ModelInfo
  /** Typed text only: uploaded attachments are already counted server-side. */
  draftTokens: number
}

/** The popover / bottom-sheet body. */
export function ContextDetails({ data, model, draftTokens }: DetailsProps) {
  const t = useT()
  const win = data.context_window
  const free = data.free_tokens ?? Math.max(0, win - data.used_tokens)
  const tokens: Record<string, number> = { free }
  for (const b of data.breakdown) tokens[b.key] = b.tokens
  const pct = (n: number) => (win > 0 ? (n / win) * 100 : 0)
  const u = data.last_usage
  const na = t('context.notReported')
  const num = (n: number | null | undefined) => (n == null ? <Dash title={na} /> : formatTokens(n))

  return (
    <div data-testid="context-popover" className="w-full text-sm sm:w-80">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{model?.label ?? data.model_id}</div>
          <div className="text-xs text-muted">
            {t('context.window')}: {formatTokens(win)}
          </div>
        </div>
        <span
          data-testid="context-source"
          data-estimated={data.estimated}
          className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted"
        >
          {data.estimated ? t('context.estimated') : t('context.fromProvider')}
        </span>
      </div>

      <div className="mb-1 text-xs text-muted">
        {t('context.used', { used: formatTokens(data.used_tokens), window: formatTokens(win) })} ({pct(data.used_tokens).toFixed(1)}%)
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={t('context.breakdown')}>
        {SEGMENTS.filter((s) => s.key !== 'free').map((s) => (
          <div key={s.key} className={s.color} style={{ width: `${pct(tokens[s.key] ?? 0)}%` }} />
        ))}
      </div>
      <ul className="mt-2 space-y-0.5" data-testid="context-legend">
        {SEGMENTS.map((s) => (
          <li key={s.key} data-key={s.key} className="flex items-center gap-2 py-0.5">
            <span className={cn('size-2.5 shrink-0 rounded-sm', s.color, s.key === 'free' && 'border border-line')} />
            <span className="flex-1 truncate">{t(`context.${s.key}` as TKey)}</span>
            <span className="tabular-nums text-muted">{formatTokens(tokens[s.key] ?? 0)}</span>
            <span className="w-12 text-right tabular-nums text-muted">{pct(tokens[s.key] ?? 0).toFixed(1)}%</span>
          </li>
        ))}
      </ul>

      {draftTokens > 0 && (
        <div data-testid="context-draft" className="mt-2 rounded-lg bg-surface px-2.5 py-1.5">
          <Row label={t('context.draft')}>≈ {formatTokens(draftTokens)}</Row>
        </div>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{t('context.lastResponse')}</h4>
          {u && (
            <span className="text-xs text-muted">{u.source === 'provider' ? t('context.fromProvider') : t('context.estimated')}</span>
          )}
        </div>
        {u ? (
          <div data-testid="context-last">
            <Row label={t('context.input')}>{num(u.input_tokens)}</Row>
            <Row label={t('context.output')}>{num(u.output_tokens)}</Row>
            <Row label={t('context.reasoning')}>{num(u.reasoning_tokens)}</Row>
            <Row label={t('context.cacheRead')}>{num(u.cache_read_tokens)}</Row>
            <Row label={t('context.cacheWrite')}>{num(u.cache_write_tokens)}</Row>
          </div>
        ) : (
          <p className="text-xs text-muted">{t('context.noResponse')}</p>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-2" data-testid="context-totals">
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('context.totals')}</h4>
        <Row label={t('context.input')}>{num(data.totals.input_tokens)}</Row>
        <Row label={t('context.output')}>{num(data.totals.output_tokens)}</Row>
        <Row label={t('context.cacheRead')}>{num(data.totals.cache_read_tokens)}</Row>
        <Row label={t('context.cacheWrite')}>{num(data.totals.cache_write_tokens)}</Row>
        <Row label={t('context.messages', { n: data.totals.messages })}>{''}</Row>
      </div>
    </div>
  )
}

interface RingProps {
  data?: ContextInfo
  model?: ModelInfo
  draftText: string
}

/** Ring next to Send. Desktop: hover previews, click pins. Mobile: tap opens a bottom sheet. */
export function ContextRing({ data, model, draftText }: RingProps) {
  const t = useT()
  const desktop = useMediaQuery('(min-width: 768px)')
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [sheet, setSheet] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ringRef = useRef<HTMLButtonElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const draftTokens = estimateDraftTokens(draftText)
  const used = (data?.used_tokens ?? 0) + draftTokens
  const pct = data ? contextPercent(used, data.context_window) : 0
  const tone = ringTone(pct)
  const label = t('context.ringLabel', { pct: Math.round(pct) })

  const enter = () => {
    clearTimeout(timer.current)
    setHover(true)
  }
  const leave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHover(false), 120)
  }

  const trigger = (
    <button
      ref={ringRef}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={desktop ? hover || pinned : sheet}
      data-testid="context-ring"
      data-pct={Math.round(pct)}
      data-tone={tone}
      aria-label={label}
      title={data ? `${formatTokens(used)} / ${formatTokens(data.context_window)} (${pct.toFixed(1)}%)` : undefined}
      disabled={!data}
      onClick={() => (desktop ? setPinned((p) => !p) : setSheet(true))}
      onPointerEnter={(e) => e.pointerType === 'mouse' && enter()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && leave()}
      onFocus={() => desktop && enter()}
      onBlur={() => desktop && leave()}
      className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-hover disabled:opacity-40 tap:size-10"
    >
      <Ring pct={pct} tone={tone} />
    </button>
  )

  if (!data) return trigger

  const details = <ContextDetails data={data} model={model} draftTokens={draftTokens} />

  if (!desktop) {
    return (
      <>
        {trigger}
        <Dialog open={sheet} onOpenChange={setSheet} title={t('context.title')} sheet>
          {details}
        </Dialog>
      </>
    )
  }

  return (
    <Popover.Root
      open={hover || pinned}
      onOpenChange={(o) => {
        if (!o) {
          setHover(false)
          setPinned(false)
        }
      }}
    >
      <Popover.Anchor asChild>{trigger}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Clicking the ring again must toggle the pin, not be swallowed as an outside click.
          onInteractOutside={(e) => {
            if (ringRef.current?.contains(e.target as Node)) e.preventDefault()
          }}
          onPointerEnter={enter}
          onPointerLeave={leave}
          className="z-50 max-h-[80dvh] overflow-auto rounded-xl border border-line bg-bg p-3 shadow-xl"
        >
          {details}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
