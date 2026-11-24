import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { SubagentPart } from '@/api/types'
import { CollapsibleStep } from './CollapsibleStep'
import { PartsRenderer } from './PartsRenderer'
import { useElapsed } from './useElapsed'
import { meaningfulSummary } from './ToolCard'

export function SubagentCard({ part, live }: { part: SubagentPart; live: boolean }) {
  const t = useT()
  const running = part.status === 'running' && live
  const elapsed = useElapsed(part.started_at, part.ended_at, running)
  const task = meaningfulSummary(part.task ?? '')
  return (
    <CollapsibleStep
      testId="step-subagent"
      title={
        <span data-testid="subagent-label" data-shimmer={running} className={cn('flex min-w-0 items-center gap-1.5', running && 'shimmer-text')}>
          <span className="shrink-0">{t('subagent.label')}</span>{' '}
          <span className="shrink-0 font-medium">{part.name}</span>
          {task && <>{' '}<span className="truncate opacity-70">· {task}</span></>}
        </span>
      }
      running={running}
      error={part.status === 'error'}
      elapsedMs={running ? null : elapsed}
      defaultOpen={running}
    >
      {part.task && (
        <p className="mb-1.5 text-[13px] text-muted">
          <span className="font-medium">{t('step.task')}: </span>
          {part.task}
        </p>
      )}
      <PartsRenderer parts={part.parts} live={live} />
    </CollapsibleStep>
  )
}
