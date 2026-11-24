import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { ToolPart } from '@/api/types'
import { CollapsibleStep } from './CollapsibleStep'
import { CodeBlock } from './CodeBlock'
import { Markdown } from './Markdown'
import { MediaGrid } from '../../media/MediaGrid'
import { useElapsed } from './useElapsed'

/** A summary is only worth showing with at least two meaningful characters (punctuation and spaces do not count). */
export function meaningfulSummary(s: string): string {
  const trimmed = s.trim()
  return trimmed.replace(/[\s\p{P}\p{S}]/gu, '').length >= 2 ? trimmed : ''
}

export function summarize(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.slice(0, 100)
  if (typeof input === 'object') {
    const first = Object.values(input as Record<string, unknown>).find((v) => typeof v === 'string' && v.length > 0)
    if (typeof first === 'string') return first.slice(0, 100)
    return JSON.stringify(input).slice(0, 100)
  }
  return String(input)
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Headings, lists, quotes, tables, fences, emphasis or links. Anything else is shown verbatim (keeps newlines). */
export function looksLikeMarkdown(s: string): boolean {
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.*\||```)/m.test(s) || /\*\*[^*]+\*\*|\]\(/.test(s)
}

function Output({ output, live }: { output: string; live: boolean }) {
  const trimmed = output.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return <CodeBlock code={prettyJson(JSON.parse(trimmed))} language="json" streaming={live} />
    } catch {
      if (live) return <CodeBlock code={output} language="json" streaming />
    }
  }
  if (output.includes('\n') && !looksLikeMarkdown(output)) {
    return <CodeBlock code={output} language="text" streaming={live} className="my-0" />
  }
  return <Markdown text={output} streaming={live} />
}

export function ToolCard({ part, live }: { part: ToolPart; live: boolean }) {
  const t = useT()
  const running = part.status === 'running' && live
  const elapsed = useElapsed(part.started_at, part.ended_at, running)
  const error = part.status === 'error'
  const summary = meaningfulSummary(summarize(part.input))
  const inputText = typeof part.input === 'string' ? part.input : prettyJson(part.input)
  const verb = running ? t('tool.running') : error ? t('tool.failed') : t('tool.ran')
  return (
    <div data-testid="tool-group">
      <CollapsibleStep
        testId="step-tool"
        title={
          <span data-testid="tool-label" data-shimmer={running} className={cn('flex min-w-0 items-center gap-1.5', running && 'shimmer-text')}>
            <span className="shrink-0">{verb}</span>{' '}
            <code className="shrink-0 font-mono text-[13px]">{part.name}</code>
            {summary && <>{' '}<span className="truncate opacity-70">· {summary}</span></>}
            {running && <span aria-hidden>…</span>}
          </span>
        }
        running={running}
        error={error}
        elapsedMs={running ? null : elapsed}
        defaultOpen={running}
      >
        <div className="space-y-3">
          {part.input != null && (
            <section>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('step.input')}</h4>
              <CodeBlock code={inputText} language={typeof part.input === 'string' ? 'text' : 'json'} className="my-0" />
            </section>
          )}
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('step.output')}</h4>
            {part.output ? (
              <div className={error ? 'text-danger' : undefined} data-testid="tool-output">
                <Output output={part.output} live={live && running} />
              </div>
            ) : (
              <p className="text-sm text-muted">{running ? t('step.running') + '…' : t('step.noOutput')}</p>
            )}
          </section>
        </div>
      </CollapsibleStep>
      {/* What the tool produced is the result: visible without expanding. */}
      {part.files?.length > 0 && <MediaGrid files={part.files} />}
    </div>
  )
}
