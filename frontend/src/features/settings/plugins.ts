import type { Plugin, PluginInput } from '@/api/types'

export interface HeaderRow {
  key: string
  name: string
  value: string
  /** Set for headers loaded from the server: the stored value is masked and stays unless retyped. */
  masked: string | null
  /** The stored header name; a rename needs the value retyped (the server only keeps values by name). */
  origName: string | null
  show: boolean
}

let seq = 0
export const newRow = (): HeaderRow => ({ key: `h${++seq}`, name: '', value: '', masked: null, origName: null, show: false })

export function toHeaderRows(headers: Plugin['headers']): HeaderRow[] {
  return headers.map((h) => ({ key: `h${++seq}`, name: h.name, value: '', masked: h.value_masked, origName: h.name, show: false }))
}

/** Existing headers left untouched are sent as `value: null` (server keeps the stored secret). */
export function buildHeaders(rows: HeaderRow[]): PluginInput['headers'] {
  const out: PluginInput['headers'] = []
  for (const r of rows) {
    const name = r.name.trim()
    if (!name) continue
    if (r.masked !== null && r.value === '') out.push({ name, value: null })
    else out.push({ name, value: r.value })
  }
  return out
}

/** Keys of existing rows whose name changed without a new value: the server could not keep their secret. */
export function renamedWithoutValue(rows: HeaderRow[]): string[] {
  return rows
    .filter((r) => r.origName !== null && r.name.trim().toLowerCase() !== r.origName.toLowerCase() && r.name.trim() !== '' && r.value === '')
    .map((r) => r.key)
}
