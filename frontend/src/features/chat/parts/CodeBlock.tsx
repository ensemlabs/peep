import { useEffect, useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { useT } from '@/i18n'
import { highlightToHtml } from '@/lib/highlight'
import { cn } from '@/lib/cn'

interface Props {
  code: string
  language?: string
  /** True while text is still streaming in: highlighting is debounced 300 ms after the last change. */
  streaming?: boolean
  className?: string
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* fall through to the legacy path (insecure context / denied) */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function CodeBlock({ code, language, streaming = false, className }: Props) {
  const t = useT()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = () => {
      highlightToHtml(code, language).then((h) => {
        if (!cancelled) setHtml(h)
      })
    }
    if (!streaming) {
      run()
      return () => {
        cancelled = true
      }
    }
    const timer = setTimeout(run, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, language, streaming])

  async function onCopy() {
    await copyText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const code_ = code.replace(/\n$/, '')
  return (
    <div className={cn('group/code my-3 overflow-hidden rounded-xl border border-line bg-surface', className)} data-testid="code-block">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-muted">
        <span className="truncate font-mono">{language || 'text'}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            aria-label={wrap ? t('common.unwrap') : t('common.wrap')}
            title={wrap ? t('common.unwrap') : t('common.wrap')}
            className={cn('rounded-md p-1.5 hover:bg-hover', wrap && 'bg-hover text-fg')}
          >
            <WrapText className="size-3.5" />
          </button>
          <button
            type="button"
            data-testid="copy-code"
            onClick={onCopy}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            <span>{copied ? t('common.copied') : t('common.copy')}</span>
          </button>
        </div>
      </div>
      <div
        className={cn(
          'max-w-full overflow-x-auto p-3 font-mono text-[13px] leading-6',
          wrap ? '[&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:whitespace-pre-wrap' : '[&_pre]:w-max [&_pre]:min-w-full',
        )}
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className={cn('m-0', wrap && 'whitespace-pre-wrap break-words')}>
            <code>{code_}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
