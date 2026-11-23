import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { Pluggable } from 'unified'

export const remarkMathPlugins: Pluggable[] = [remarkMath]
// Partially streamed or invalid TeX must never throw or break the message.
export const rehypeMathPlugins: Pluggable[] = [[rehypeKatex, { throwOnError: false, strict: false, maxSize: 20, maxExpand: 200 }]] // `trust` stays unset
