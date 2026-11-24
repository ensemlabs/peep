import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ThinkingPart } from '@/api/types'
import { Markdown } from './Markdown'
import { CollapsibleStep } from './CollapsibleStep'
import { useElapsed } from './useElapsed'

/**
 * Plain muted thinking text. While running only the last few lines show, bottom-aligned with a fade
 * at the top (ChatGPT style, no scroller); once done and opened it shows in full.
 */
function ThinkingText({ text, running }: { text: string; running: boolean }) {
  return (
    <div
      data-testid="thinking-panel"
      data-clamped={running}
      className={cn(
        running && 'flex max-h-[9.6em] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]',
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
      title={
        <span data-testid="thinking-label" data-shimmer={running} className={running ? 'shimmer-text' : undefined}>
          {title}
        </span>
      }
      running={running}
      elapsedMs={elapsed}
      hideDuration={!running}
      defaultOpen={running}
    >
      <ThinkingText text={part.text} running={running} />
    </CollapsibleStep>
  )
}
