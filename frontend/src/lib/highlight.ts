import type { HighlighterCore } from 'shiki/core'

// Languages are code-split and fetched only when first used (no eval, JS regex engine => CSP safe).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loader = () => Promise<any>
const LOADERS: Record<string, Loader> = {
  python: () => import('shiki/langs/python.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
}

const ALIASES: Record<string, string> = {
  py: 'python', python3: 'python', js: 'javascript', mjs: 'javascript', node: 'javascript',
  ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml',
  md: 'markdown', 'c++': 'cpp', rs: 'rust', golang: 'go', jsonc: 'json', htm: 'html', patch: 'diff',
}

export function resolveLang(lang: string | undefined): string | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  const name = ALIASES[l] ?? l
  return name in LOADERS ? name : null
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighterPromise
}

/** Returns highlighted HTML (both themes as CSS variables), or null when the language is unknown/fails. */
export async function highlightToHtml(code: string, lang: string | undefined): Promise<string | null> {
  const name = resolveLang(lang)
  if (!name) return null
  try {
    const hl = await getHighlighter()
    if (!loaded.has(name)) loaded.set(name, hl.loadLanguage(LOADERS[name]()))
    await loaded.get(name)
    return hl.codeToHtml(code, {
      lang: name,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
  } catch {
    return null
  }
}
