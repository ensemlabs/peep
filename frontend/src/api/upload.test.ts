import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUploadForm, uploadFile } from './client'

const file = new File(['x'], 'a.png', { type: 'image/png' })

describe('upload form', () => {
  it('adds conversation_id only inside an existing chat', () => {
    expect(buildUploadForm(file, 'c1').get('conversation_id')).toBe('c1')
    expect(buildUploadForm(file).has('conversation_id')).toBe(false)
    expect(buildUploadForm(file, 'c1').get('file')).toBeInstanceOf(File)
  })
})

describe('uploadFile', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('sends the conversation_id form field with the XHR', async () => {
    let sent: FormData | undefined
    class FakeXHR {
      upload = {} as { onprogress?: unknown }
      status = 201
      responseText = JSON.stringify({ file: { id: 'f1' } })
      onload: () => void = () => {}
      open() {}
      setRequestHeader() {}
      getResponseHeader() { return null }
      send(f: FormData) { sent = f; queueMicrotask(() => this.onload()) }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    await uploadFile(file, () => {}, undefined, { conversationId: 'c42' })
    expect(sent?.get('conversation_id')).toBe('c42')
    await uploadFile(file, () => {})
    expect(sent?.has('conversation_id')).toBe(false)
  })
})
