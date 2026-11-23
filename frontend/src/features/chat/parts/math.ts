/**
 * LaTeX support is optional and lazy: remark-math + rehype-katex + the KaTeX CSS/fonts only load
 * the first time a message actually contains math-looking text.
 *
 * Trade-off for the dollar sign: Gemini writes inline math as single `$...$`, so remark-math's default
 * (`singleDollarTextMath: true`) is kept. That would mis-parse prices ("$5 and $10" would become the
 * math `5 and `), so `prepareMath` first decides, per line, which `$` really delimit math, using
 * pandoc's rules: an opening `$` must not be followed by whitespace, the closing `$` is the next `$`
 * on the line and must not be preceded by whitespace nor followed by a digit. Any other `$` is
 * escaped as a literal dollar. Code (fenced, indented and inline spans) is never touched.
 */

const D = '$'

/** Inline code spans of any backtick length (``a ` b``), on one line. */
const INLINE_CODE = /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g

interface Block {
  code: boolean
  text: string
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/** Split into code blocks (fenced, indented) and prose, keeping every character. */
function splitBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  const push = (code: boolean, line: string) => {
    const last = blocks[blocks.length - 1]
    if (last && last.code === code) last.text += '\n' + line
    else blocks.push({ code, text: line })
  }
  let fence: string | null = null
  let prevBlank = true
  let inIndented = false
  let inList = false
  for (const line of lines) {
    if (fence) {
      push(true, line)
      const m = FENCE.exec(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
      continue
    }
    const f = FENCE.exec(line)
    if (f) {
      fence = f[1]
      push(true, line)
      prevBlank = false
      inIndented = false
      continue
    }
    const blank = line.trim() === ''
    if (LIST_ITEM.test(line)) inList = true
    else if (!blank && !/^( {2,}|\t)/.test(line)) inList = false
    const indented = /^( {4}|\t)/.test(line) && !blank
    if (indented && (prevBlank || inIndented) && !inList) {
      push(true, line)
      inIndented = true
    } else {
      push(false, line)
      if (!blank) inIndented = false
    }
    prevBlank = blank
  }
  return blocks
}

/** Escape the dollar signs of one prose line that do not delimit math. */
function processLine(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '\\') {
      out += c + (line[i + 1] ?? '')
      i += 2
      continue
    }
    if (c !== D) {
      out += c
      i++
      continue
    }
    if (line[i + 1] === D) {
      // `$$...$$` stays for remark-math
      const end = line.indexOf(D + D, i + 2)
      const stop = end === -1 ? line.length : end + 2
      out += line.slice(i, stop)
      i = stop
      continue
    }
    const after = line[i + 1]
    let j = i + 1
    while (j < line.length && (line[j] !== D || line[j - 1] === '\\')) j++
    const closer = j < line.length && j > i + 1 ? j : -1
    const validOpen = after !== undefined && !/\s/.test(after)
    const validClose = closer !== -1 && !/\s/.test(line[closer - 1]) && !/\d/.test(line[closer + 1] ?? '')
    if (validOpen && validClose) {
      out += line.slice(i, closer + 1)
      i = closer + 1
    } else {
      out += '\\' + D // a price or a stray dollar: literal
      i++
    }
  }
  return out
}

function processProseLine(line: string): string {
  // keep inline code spans untouched
  let out = ''
  let last = 0
  for (const m of line.matchAll(INLINE_CODE)) {
    out += processLine(line.slice(last, m.index)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + processLine(line.slice(last))
}

const TEX_COMMAND = /\\[a-zA-Z]+/

function convertDelimiters(text: string): string {
  return (
    text
      // `\[ ... \]` only when it is clearly TeX (spans lines or has a command): `\[1\]` is escaped markdown.
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, body: string) => (body.includes('\n') || TEX_COMMAND.test(body) ? D + D + '\n' + body.trim() + '\n' + D + D : m))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => D + body.trim() + D)
      // A `$$...$$` alone on its line is display math: remark-math only treats the fenced form as a block.
      .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_m, body: string) => D + D + '\n' + body.trim() + '\n' + D + D)
  )
}

export function prepareMath(text: string): string {
  return splitBlocks(text)
    .map((b) => (b.code ? b.text : convertDelimiters(b.text).split('\n').map(processProseLine).join('\n')))
    .join('\n')
}

/** Cheap check so plain text never pays for loading KaTeX. */
export function mightHaveMath(text: string): boolean {
  return text.includes(D) || text.includes('\\(') || text.includes('\\[')
}
