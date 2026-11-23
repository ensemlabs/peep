import { Bot } from 'lucide-react'
import { useT } from '@/i18n'
import type { SubagentPart } from '@/api/types'
import { CollapsibleStep } from './CollapsibleStep'
import { PartsRenderer } from './PartsRenderer'
import { useElapsed } from './useElapsed'

export function SubagentCard({ part, live }: { part: SubagentPart; live: boolean }) {
  const t = useT()
  const running = part.status === 'running' && live
  const elapsed = useElapsed(part.started_at, part.ended_at, running)
  return (
    <CollapsibleStep
      testId="step-subagent"
      icon={<Bot className="size-4" />}
      title={
        <>
          <span className="shrink-0 font-medium">{part.name}</span>
          {part.task && <span className="truncate text-muted">{part.task}</span>}
        </>
      }
      running={running}
      error={part.status === 'error'}
      elapsedMs={elapsed}
      defaultOpen={running}
    >
      {part.task && (
        <p className="mb-2 text-sm text-muted">
          <span className="font-medium">{t('step.task')}: </span>
          {part.task}
        </p>
      )}
      <div className="ml-1 border-l-2 border-line pl-3 sm:pl-4">
        <PartsRenderer parts={part.parts} live={live} />
      </div>
    </CollapsibleStep>
  )
}
