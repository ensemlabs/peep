import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithI18n } from '@/test/utils'
import { ChatHeader } from './ChatHeader'
import type { ModelInfo } from '@/api/types'

const m = (id: string, reasoning: ModelInfo['reasoning'] = null): ModelInfo => ({ id, label: `Label ${id}`, provider: 'openai', context_window: 1000, reasoning })
const two = { levels: [{ id: 'off', label: 'Off' }, { id: 'high', label: 'High' }], default: 'off' }

const base = { onModel: vi.fn() }

describe('ChatHeader', () => {
  it('has no model picker when not switchable; shows a static label', () => {
    renderWithI18n(<ChatHeader {...base} switchable={false} models={[m('a')]} model={m('a')} />)
    expect(screen.queryByTestId('model-picker')).toBeNull()
    expect(screen.getByTestId('model-label')).toHaveTextContent('Label a')
  })
  it('shows the picker only when switchable', () => {
    renderWithI18n(<ChatHeader {...base} switchable models={[m('a'), m('b')]} model={m('a')} />)
    expect(screen.getByTestId('model-picker')).toHaveTextContent('Label a')
    expect(screen.queryByTestId('model-label')).toBeNull()
  })
  it('shows the conversation title and menu when a conversation is open', () => {
    renderWithI18n(<ChatHeader {...base} switchable={false} models={[m('a')]} model={m('a')} conversation={{ id: 'c1', title: 'My chat', pinned: false }} />)
    expect(screen.getByTestId('chat-title')).toHaveTextContent('My chat')
    expect(screen.getByTestId('chat-menu')).toBeInTheDocument()
  })
  it('has no thinking selector in the header any more', () => {
    renderWithI18n(<ChatHeader {...base} switchable={false} models={[m('a', two)]} model={m('a', two)} />)
    expect(screen.queryByTestId('reasoning-level')).toBeNull()
  })
})

describe('rename focus', () => {
  it('focuses and selects the title input after choosing Rename from the menu', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderWithI18n(<ChatHeader {...base} switchable={false} models={[m('a')]} model={m('a')} conversation={{ id: 'c1', title: 'My chat', pinned: false }} />)
    await userEvent.click(screen.getByTestId('chat-menu'))
    await userEvent.click(await screen.findByTestId('conv-rename'))
    const input = (await screen.findByRole('textbox', { name: 'Rename' })) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('My chat'.length)
  })
})
