import { createParser } from 'eventsource-parser'
import { ApiError, baseHeaders, handleUnauthenticated, parseError } from './client'
import type { StreamEvent } from './types'

const EVENT_NAMES = new Set(['message', 'part', 'delta', 'update', 'done', 'snapshot', 'usage'])

/** Read an SSE endpoint with fetch; calls `onEvent` per contract event. Resolves when the stream ends. */
export async function streamEvents(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init.method,
      credentials: 'same-origin',
      headers: {
        ...baseHeaders(),
        Accept: 'text/event-stream',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    })
  } catch (e) {
    if (signal.aborted) return
    throw new ApiError('network', 0, String(e))
  }
  if (!res.ok) {
    const err = await parseError(res)
    handleUnauthenticated(path, err)
    throw err
  }
  if (!res.body) throw new ApiError('network', 0, 'empty body')

  const parser = createParser({
    onEvent(msg) {
      const name = msg.event ?? 'message'
      if (!EVENT_NAMES.has(name)) return
      try {
        onEvent({ type: name, data: JSON.parse(msg.data) } as StreamEvent)
      } catch {
        /* skip malformed event */
      }
    },
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
  } catch (e) {
    if (!signal.aborted) throw new ApiError('network', 0, String(e))
  }
}
