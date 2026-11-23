import type { Message, Part, StreamEvent } from '@/api/types'

/** Apply `fn` to the part with `id` anywhere in the tree. Returns the same array when nothing matched. */
function mapPart(parts: Part[], id: string, fn: (p: Part) => Part): Part[] {
  let changed = false
  const next = parts.map((p) => {
    if (p.id === id) {
      changed = true
      return fn(p)
    }
    if (p.type === 'subagent') {
      const inner = mapPart(p.parts, id, fn)
      if (inner !== p.parts) {
        changed = true
        return { ...p, parts: inner }
      }
    }
    return p
  })
  return changed ? next : parts
}

function insertPart(parts: Part[], parentId: string | null, part: Part): Part[] {
  if (parentId === null) {
    const i = parts.findIndex((p) => p.id === part.id)
    if (i >= 0) return parts.map((p, j) => (j === i ? part : p)) // idempotent on replay
    return [...parts, part]
  }
  let found = false
  const next = parts.map((p) => {
    if (p.type !== 'subagent') return p
    if (p.id === parentId) {
      found = true
      return { ...p, parts: insertPart(p.parts, null, part) }
    }
    const inner = insertPart(p.parts, parentId, part)
    if (inner !== p.parts) {
      found = true
      return { ...p, parts: inner }
    }
    return p
  })
  return found ? next : parts
}

/** Pure reducer that folds one stream event into an assistant message. */
export function applyEvent(message: Message, event: StreamEvent): Message {
  switch (event.type) {
    case 'snapshot':
      return event.data.message
    case 'part': {
      const parts = insertPart(message.parts, event.data.parent_id, event.data.part)
      return parts === message.parts ? message : { ...message, parts }
    }
    case 'delta': {
      const { part_id, field, text } = event.data
      const parts = mapPart(message.parts, part_id, (p) => {
        if (field === 'text' && (p.type === 'text' || p.type === 'thinking')) {
          return { ...p, text: p.text + text }
        }
        if (field === 'output' && p.type === 'tool') {
          return { ...p, output: (p.output ?? '') + text }
        }
        return p
      })
      return parts === message.parts ? message : { ...message, parts }
    }
    case 'update': {
      const { part_id, patch } = event.data
      const parts = mapPart(message.parts, part_id, (p) => ({ ...p, ...patch }) as Part)
      return parts === message.parts ? message : { ...message, parts }
    }
    case 'usage':
      return { ...message, usage: event.data.usage }
    case 'done':
      return { ...message, status: event.data.status, error: event.data.error ?? null }
    default:
      return message
  }
}
