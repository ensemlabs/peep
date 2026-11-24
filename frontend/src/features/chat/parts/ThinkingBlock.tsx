import { useLayoutEffect, useRef } from 'react'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ThinkingPart } from '@/api/types'
import { Lightbulb } from 'lucide-react'
import { Markdown } from './Markdown'
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
      <div data-testid="thinking-text">
        <Markdown text={text} streaming={running} muted />
      </div>
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
      icon={running ? null : <Lightbulb className="size-4" />}
      title={<span data-testid="thinking-label" data-shimmer={running} className={running ? 'shimmer-text' : undefined}>{title}</span>}
      running={running}
      elapsedMs={elapsed}
      hideDuration={!running}
      defaultOpen={running}
    >
      <ThinkingText text={part.text} running={running} />
    </CollapsibleStep>
  )
}
