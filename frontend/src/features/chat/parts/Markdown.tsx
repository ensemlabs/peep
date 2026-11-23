import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

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
    // Only API-served media is allowed; never inline base64 into the DOM.
    img: ({ src, alt }) =>
      typeof src === 'string' && !src.startsWith('data:') ? (
        <img src={src} alt={alt ?? ''} loading="lazy" className="max-h-[480px] max-w-full rounded-lg object-contain" />
      ) : null,
  }
}

const STREAMING = makeComponents(true, false)
const STATIC = makeComponents(false, false)
const STREAMING_MUTED = makeComponents(true, true)
const STATIC_MUTED = makeComponents(false, true)

/** `muted` is for thinking text: small, subdued, headings flattened to bold lines. */
export const Markdown = memo(function Markdown({ text, streaming = false, muted = false }: { text: string; streaming?: boolean; muted?: boolean }) {
  return (
    <div className={muted ? 'md md-muted' : 'md'} data-testid="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={muted ? (streaming ? STREAMING_MUTED : STATIC_MUTED) : streaming ? STREAMING : STATIC}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
