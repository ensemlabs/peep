import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Message, StreamEvent } from '@/api/types'

const msg = (id: string, role: 'user' | 'assistant', status: Message['status']): Message => ({
  id, role, content: '', attachments: [], parts: [], status, model: 'm', created_at: '',
})

const markReadMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/api/sse', () => ({
  streamEvents: async (_p: string, _i: unknown, onEvent: (e: StreamEvent) => void) => {
    onEvent({ type: 'message', data: { user_message: msg('u', 'user', 'complete'), assistant_message: msg('a', 'assistant', 'streaming') } })
    onEvent({ type: 'done', data: { message_id: 'a', status: 'stopped' } })
  },
}))
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: { conversation: async () => ({ conversation: {}, messages: [] }), markRead: markReadMock },
}))

import { markReadWhenVisible, readKeyFor, readMarks, sendMessage } from './runner'
import { useRunStore } from './stores'

describe('sendMessage', () => {
  it('clears the run when finished, even if an animation-frame flush is still pending', async () => {
    const raf = vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 50))
    void raf
    await sendMessage('c1', { content: 'x', attachment_ids: [], model: 'm', reasoning: 'off' }, [], new QueryClient())
    await new Promise((r) => setTimeout(r, 120)) // let the late rAF fire
    expect(useRunStore.getState().runs['c1']).toBeUndefined()
    vi.unstubAllGlobals()
  })
})

describe('markReadWhenVisible', () => {
  const setVis = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  it('marks read only when the tab is visible, and only once per state', async () => {
    markReadMock.mockClear()
    readMarks.clear()
    const qc = new QueryClient()
    const key = readKeyFor('c9', [{ id: 'm1', status: 'complete' } as Message])
    setVis('hidden')
    markReadWhenVisible(qc, 'c9', key)
    expect(markReadMock).not.toHaveBeenCalled()
    setVis('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(markReadMock).toHaveBeenCalledTimes(1)
    markReadWhenVisible(qc, 'c9', key) // same key: already marked (e.g. by the run that just ended)
    expect(markReadMock).toHaveBeenCalledTimes(1)
  })
})
