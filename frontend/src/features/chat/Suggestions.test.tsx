import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { Suggestions } from './Suggestions'
import { Composer, type ComposerHandle } from './Composer'
import { ReasoningLevel } from './ReasoningLevel'
import { ChatHeader } from './ChatHeader'
import type { ModelInfo } from '@/api/types'

describe('Suggestions', () => {
  it('shows four cards with a bold title and a completing second line', () => {
    renderWithI18n(<Suggestions variant="row" onPick={() => {}} />)
    const cards = screen.getAllByTestId('example-prompt')
    expect(cards.map((c) => c.getAttribute('data-prompt-id'))).toEqual(['code', 'image', 'summarize', 'explain'])
    expect(cards[0]).toHaveTextContent('Write a function')
    expect(cards[0]).toHaveTextContent('to check prime numbers')
  })
  it('hands the full prompt to the page on click (which sends it)', async () => {
    const onPick = vi.fn()
    renderWithI18n(<Suggestions variant="wrap" onPick={onPick} />)
    await userEvent.click(screen.getAllByTestId('example-prompt')[0])
    expect(onPick).toHaveBeenCalledWith('code', 'Write a Python function is_prime(n) in a code block and explain it briefly.')
    await userEvent.click(screen.getAllByTestId('example-prompt')[2])
    expect(onPick).toHaveBeenLastCalledWith('summarize', 'Summarize the key ideas of the attached document.')
  })
  it('is translated to Vietnamese', () => {
    renderWithI18n(<Suggestions variant="row" onPick={() => {}} />, 'vi')
    expect(screen.getAllByTestId('example-prompt')[0]).toHaveTextContent('Viết hàm')
    expect(screen.getAllByTestId('example-prompt')[0]).toHaveTextContent('kiểm tra số nguyên tố')
  })
  it('uses a scroll row on phones and a wrap on desktop', () => {
    const { unmount } = renderWithI18n(<Suggestions variant="row" onPick={() => {}} />)
    expect(screen.getByTestId('suggestions')).toHaveAttribute('data-variant', 'row')
    unmount()
    renderWithI18n(<Suggestions variant="wrap" onPick={() => {}} />)
    expect(screen.getByTestId('suggestions')).toHaveAttribute('data-variant', 'wrap')
  })
})

describe('Composer.pickFiles (Summarize a file)', () => {
  it('opens the picker and prefills an empty draft once a file is attached', async () => {
    const ref = createRef<ComposerHandle>()
    const upload = vi.fn(async (f: File) => ({ id: 'f1', kind: 'file' as const, mime: 'text/plain', filename: f.name, size: 1, url: '/u', download_url: '/d' }))
    renderWithI18n(<Composer ref={ref} streaming={false} onSend={() => {}} onStop={() => {}} upload={upload} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    ref.current!.pickFiles('Summarize the key ideas of the attached document.')
    expect(click).toHaveBeenCalled()
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('')
    await userEvent.upload(input, new File(['x'], 'doc.txt', { type: 'text/plain' }))
    await waitFor(() => expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('Summarize the key ideas of the attached document.'))
  })
  it('does not overwrite text the user already typed', async () => {
    const ref = createRef<ComposerHandle>()
    renderWithI18n(<Composer ref={ref} streaming={false} onSend={() => {}} onStop={() => {}} upload={async (f) => ({ id: 'f', kind: 'file', mime: '', filename: f.name, size: 1, url: '', download_url: '' })} initialText="my own text" />)
    ref.current!.pickFiles('PREFILL')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['x'], 'a.txt'))
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('my own text')
  })
})

const two: ModelInfo['reasoning'] = { levels: [{ id: 'off', label: 'Off' }, { id: 'high', label: 'High' }], default: 'off' }
const model = (r: ModelInfo['reasoning']): ModelInfo => ({ id: 'm', label: 'M', provider: 'p', context_window: 1, reasoning: r })

describe('thinking level button', () => {
  it('shows a bulb and the level, with the "Thinking level" tooltip; muted when off, accent when on', () => {
    const { rerender } = renderWithI18n(<ReasoningLevel model={model(two)} value="off" onChange={() => {}} />)
    const btn = screen.getByTestId('reasoning-level')
    expect(btn).toHaveAttribute('title', 'Thinking level')
    expect(btn).toHaveAttribute('data-value', 'off')
    expect(btn).toHaveTextContent('Thinking: Off') // "Thinking: " is shown from the md breakpoint up
    expect(btn.querySelector('.lucide-lightbulb')?.getAttribute('class')).toContain('text-muted')
    rerender(<ReasoningLevel model={model(two)} value="high" onChange={() => {}} />)
    expect(screen.getByTestId('reasoning-level').querySelector('.lucide-lightbulb')?.getAttribute('class')).toContain('text-amber-500')
  })
})

describe('header centre', () => {
  it('shows the app name for an empty chat and the title once there is a conversation', () => {
    const { rerender } = renderWithI18n(<ChatHeader />)
    expect(screen.getByTestId('header-app-name')).toHaveTextContent('Peep')
    rerender(<ChatHeader conversation={{ id: 'c', title: 'My chat', pinned: false }} />)
    expect(screen.queryByTestId('header-app-name')).toBeNull()
    expect(screen.getByTestId('chat-title')).toHaveTextContent('My chat')
  })
})
