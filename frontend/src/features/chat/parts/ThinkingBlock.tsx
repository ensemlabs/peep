import { useLayoutEffect, useRef } from 'react'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ThinkingPart } from '@/api/types'
import { Mascot } from '@/components/Mascot'
import { CollapsibleStep } from './CollapsibleStep'
import { useElapsed } from './useElapsed'

/** Muted thinking text; while running it follows the stream unless the user scrolled up. */
function ThinkingText({ text, running }: { text: string; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      data-testid="thinking-panel"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className={cn(
        'overflow-y-auto',
        running ? 'max-h-48 [mask-image:linear-gradient(to_bottom,transparent,black_1.75rem)]' : 'max-h-[28rem]',
      )}
    >
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted" data-testid="thinking-text">
        {text}
      </p>
    </div>
  )
}

export function ThinkingBlock({ part, live }: { part: ThinkingPart; live: boolean }) {
  const t = useT()
  const running = part.status === 'running' && live
  const elapsed = useElapsed(part.started_at, part.ended_at, running)
  const title = running
    ? t('step.thinking')
    : elapsed != null
      ? t('step.thought', { time: formatDuration(elapsed, t) })
      : t('step.thoughtDone')
  return (
    <CollapsibleStep
      testId="step-thinking"
      icon={<Mascot state={running ? 'thinking' : 'idle'} size={20} animated={running} />}
      title={<span className={running ? 'text-muted' : undefined}>{title}</span>}
      running={running}
      elapsedMs={elapsed}
      hideDuration={!running}
      showSpinner={false}
      defaultOpen={running}
    >
      <ThinkingText text={part.text} running={running} />
    </CollapsibleStep>
  )
}
