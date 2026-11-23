import type { ModelInfo } from '@/api/types'
import { readStorage, writeStorage } from './storage'

const KEY = 'ec_levels'

export function loadLevels(): Record<string, string> {
  try {
    const v = JSON.parse(readStorage(KEY) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function saveLevel(levels: Record<string, string>, modelId: string, level: string): Record<string, string> {
  const next = { ...levels, [modelId]: level }
  writeStorage(KEY, JSON.stringify(next))
  return next
}

export type LevelMode = 'hidden' | 'single' | 'multi'

export function levelMode(model: ModelInfo | undefined | null): LevelMode {
  const n = model?.reasoning?.levels.length ?? 0
  return n === 0 ? 'hidden' : n === 1 ? 'single' : 'multi'
}

/** The level to send: stored choice if still valid, else the model default; null when the model has no levels. */
export function resolveLevel(model: ModelInfo | undefined | null, stored: string | undefined): string | null {
  const r = model?.reasoning
  if (!r || r.levels.length === 0) return null
  const ids = r.levels.map((l) => l.id)
  if (stored && ids.includes(stored)) return stored
  return ids.includes(r.default) ? r.default : ids[0]
}
