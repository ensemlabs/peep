import { describe, expect, it } from 'vitest'
import { applyEvent } from './applyEvent'
import type { Message, Part, StreamEvent } from '@/api/types'

const base: Message = {
  id: 'm1', role: 'assistant', content: '', attachments: [], parts: [], status: 'streaming',
  model: 'x', created_at: '2026-01-01T00:00:00Z',
}
const T = '2026-01-01T00:00:00Z'
const part = (parent_id: string | null, p: Part): StreamEvent => ({ type: 'part', data: { message_id: 'm1', parent_id, part: p } })
const sub = (id: string): Part => ({ id, type: 'subagent', name: 'a', task: 't', status: 'running', parts: [], started_at: T })
const text = (id: string, t = ''): Part => ({ id, type: 'text', text: t })
const tool = (id: string): Part => ({ id, type: 'tool', name: 'n', input: {}, output: null, files: [], status: 'running', started_at: T })

describe('applyEvent', () => {
  it('appends a root part', () => {
    const m = applyEvent(base, part(null, text('p1', 'hi')))
    expect(m.parts).toHaveLength(1)
    expect(base.parts).toHaveLength(0)
  })

  it('nests parts under subagents at two levels', () => {
    let m = applyEvent(base, part(null, sub('s1')))
    m = applyEvent(m, part('s1', sub('s2')))
    m = applyEvent(m, part('s2', tool('t1')))
    const s1 = m.parts[0] as Extract<Part, { type: 'subagent' }>
    const s2 = s1.parts[0] as Extract<Part, { type: 'subagent' }>
    expect(s2.parts[0].id).toBe('t1')
  })

  it('appends text deltas, including inside a subagent', () => {
    let m = applyEvent(base, part(null, text('p1', 'a')))
    m = applyEvent(m, { type: 'delta', data: { message_id: 'm1', part_id: 'p1', field: 'text', text: 'bc' } })
    expect((m.parts[0] as { text: string }).text).toBe('abc')
    m = applyEvent(m, part(null, sub('s1')))
    m = applyEvent(m, part('s1', text('p2')))
    m = applyEvent(m, { type: 'delta', data: { message_id: 'm1', part_id: 'p2', field: 'text', text: 'deep' } })
    const s = m.parts[1] as Extract<Part, { type: 'subagent' }>
    expect((s.parts[0] as { text: string }).text).toBe('deep')
  })

  it('appends tool output deltas starting from null', () => {
    let m = applyEvent(base, part(null, tool('t1')))
    m = applyEvent(m, { type: 'delta', data: { message_id: 'm1', part_id: 't1', field: 'output', text: '{"a"' } })
    m = applyEvent(m, { type: 'delta', data: { message_id: 'm1', part_id: 't1', field: 'output', text: ':1}' } })
    expect((m.parts[0] as { output: string }).output).toBe('{"a":1}')
  })

  it('shallow-merges update patches', () => {
    let m = applyEvent(base, part(null, tool('t1')))
    m = applyEvent(m, { type: 'update', data: { message_id: 'm1', part_id: 't1', patch: { status: 'done', ended_at: T } } })
    expect(m.parts[0]).toMatchObject({ status: 'done', ended_at: T, name: 'n' })
  })

  it('replaces the message on snapshot', () => {
    const snap: Message = { ...base, id: 'm2', parts: [text('x', 'y')] }
    expect(applyEvent(base, { type: 'snapshot', data: { message: snap } })).toBe(snap)
  })

  it('sets status and error on done', () => {
    const m = applyEvent(base, { type: 'done', data: { message_id: 'm1', status: 'error', error: 'boom' } })
    expect(m).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('ignores unknown part ids and parents safely', () => {
    const m = applyEvent(base, { type: 'delta', data: { message_id: 'm1', part_id: 'nope', field: 'text', text: 'x' } })
    expect(m).toBe(base)
    expect(applyEvent(base, { type: 'update', data: { message_id: 'm1', part_id: 'nope', patch: { a: 1 } } })).toBe(base)
    expect(applyEvent(base, part('missing', text('p')))).toBe(base)
  })

  it('does not duplicate a part re-sent with the same id', () => {
    let m = applyEvent(base, part(null, text('p1', 'a')))
    m = applyEvent(m, part(null, text('p1', 'ab')))
    expect(m.parts).toHaveLength(1)
  })

  it('stores usage on the message', () => {
    const usage = { input_tokens: 10, output_tokens: 5, reasoning_tokens: null, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 15, source: 'estimate' as const }
    const m = applyEvent(base, { type: 'usage', data: { message_id: 'm1', usage } })
    expect(m.usage).toEqual(usage)
    expect(base.usage).toBeUndefined()
  })
})
