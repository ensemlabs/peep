import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { Composer } from './Composer'
import type { FileMeta } from '@/api/types'

const meta = (name: string): FileMeta => ({
  id: 'id-' + name, kind: 'file', mime: 'text/plain', filename: name, size: 3, url: '/u', download_url: '/d',
})
const okUpload = vi.fn(async (f: File) => meta(f.name))
const removeFile = vi.fn(async () => {})

function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn()
  const onStop = vi.fn()
  renderWithI18n(<Composer streaming={false} onSend={onSend} onStop={onStop} upload={okUpload} removeFile={removeFile} {...props} />)
  return { onSend, onStop, input: screen.getByTestId('composer-input') as HTMLTextAreaElement }
}

describe('Composer', () => {
  it('Enter sends, Shift+Enter inserts a newline', async () => {
    const { onSend, input } = setup()
    await userEvent.type(input, 'hello{Shift>}{Enter}{/Shift}world')
    expect(onSend).not.toHaveBeenCalled()
    expect(input.value).toBe('hello\nworld')
    await userEvent.type(input, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('hello\nworld', [])
    expect(input.value).toBe('')
  })
  it('does not send while an IME composition is active', async () => {
    const { onSend, input } = setup()
    await userEvent.type(input, 'xin chao')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
  })
  it('keeps Send disabled when empty', () => {
    setup()
    expect(screen.getByTestId('send-button')).toBeDisabled()
  })
  it('uploads, shows a chip, supports removal, and sends attachments', async () => {
    const { onSend } = setup()
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByTestId('file-input'), file)
    const chip = await screen.findByTestId('attachment-chip')
    expect(chip).toHaveTextContent('a.txt')
    await waitFor(() => expect(chip).toHaveAttribute('data-status', 'done'))
    expect(screen.getByTestId('send-button')).toBeEnabled()
    await userEvent.click(screen.getByTestId('send-button'))
    expect(onSend).toHaveBeenCalledWith('', [expect.objectContaining({ id: 'id-a.txt' })])

    await userEvent.upload(screen.getByTestId('file-input'), new File(['x'], 'b.txt', { type: 'text/plain' }))
    await waitFor(() => expect(screen.getByTestId('attachment-chip')).toHaveAttribute('data-status', 'done'))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove b.txt' }))
    expect(screen.queryByTestId('attachment-chip')).toBeNull()
    expect(removeFile).toHaveBeenCalledWith('id-b.txt')
  })
  it('disables Send while an upload is in flight', async () => {
    let finish!: (m: FileMeta) => void
    const slow = vi.fn(() => new Promise<FileMeta>((r) => (finish = r)))
    setup({ upload: slow })
    await userEvent.upload(screen.getByTestId('file-input'), new File(['x'], 's.txt', { type: 'text/plain' }))
    expect(screen.getByTestId('send-button')).toBeDisabled()
    finish(meta('s.txt'))
    await waitFor(() => expect(screen.getByTestId('send-button')).toBeEnabled())
  })
  it('shows a translated error chip when upload fails', async () => {
    const { ApiError } = await import('@/api/client')
    setup({ upload: vi.fn().mockRejectedValue(new ApiError('file_too_large', 413, 'RAW')) })
    await userEvent.upload(screen.getByTestId('file-input'), new File(['x'], 'big.bin'))
    await waitFor(() => expect(screen.getByTestId('attachment-chip')).toHaveTextContent('This file is too large.'))
  })
  it('turns into Stop while streaming', async () => {
    const { onStop } = setup({ streaming: true })
    await userEvent.click(screen.getByTestId('stop-button'))
    expect(onStop).toHaveBeenCalled()
    expect(screen.queryByTestId('send-button')).toBeNull()
  })
  it('shows the quota banner and blocks sending when the limit is reached', async () => {
    const quota = { limit: 100, period: 'day' as const, used: 100, resets_at: '2099-11-25T00:00:00Z' }
    const { onSend, input } = setup({ quota })
    expect(screen.getByTestId('quota-banner')).toHaveTextContent('reached your token limit')
    await userEvent.type(input, 'hi')
    expect(screen.getByTestId('send-button')).toBeDisabled()
    await userEvent.type(input, '{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })
  it('has no banner under the limit or without one', () => {
    setup({ quota: { limit: 100, period: 'day', used: 99, resets_at: '2099-11-25T00:00:00Z' } })
    expect(screen.queryByTestId('quota-banner')).toBeNull()
  })
})
