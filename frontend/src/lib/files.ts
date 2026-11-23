const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'log', 'ini', 'env',
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sql', 'sh', 'bash',
  'zsh', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php', 'swift', 'diff', 'patch',
])

const EXT_LANG: Record<string, string> = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash', html: 'html', htm: 'html', css: 'css', scss: 'css',
  sql: 'sql', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown', diff: 'diff', patch: 'diff',
}

export const PREVIEW_MAX_BYTES = 1024 * 1024

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase()
}

export function isTextPreviewable(file: { filename: string; mime: string; size: number }): boolean {
  if (file.size > PREVIEW_MAX_BYTES) return false
  if (file.mime.startsWith('text/')) return true
  if (file.mime === 'application/json' || file.mime === 'application/xml') return true
  return TEXT_EXT.has(extOf(file.filename))
}

export function languageForFile(filename: string): string {
  return EXT_LANG[extOf(filename)] ?? 'text'
}
