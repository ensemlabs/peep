import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { ChatHeader } from './ChatHeader'
import { ModelPicker } from './ModelPicker'
import type { ModelInfo } from '@/api/types'

const m = (id: string, provider = 'p'): ModelInfo => ({ id, label: `Label ${id}`, provider, context_window: 1000, reasoning: null })
const conv = { id: 'c1', title: 'My chat', pinned: false }

describe('ChatHeader', () => {
  it('shows the conversation title and menu, and no model label or CPU icon', () => {
    renderWithI18n(<ChatHeader conversation={conv} />)
    expect(screen.getByTestId('chat-title')).toHaveTextContent('My chat')
    expect(screen.getByTestId('chat-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('model-picker')).toBeNull()
    expect(screen.queryByTestId('model-label')).toBeNull()
    expect(document.querySelector('.lucide-cpu')).toBeNull()
  })
  it('has a new-chat button for phones and nothing else on the right', () => {
    renderWithI18n(<ChatHeader />)
    expect(screen.getByTestId('header-new-chat')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-title')).toBeNull()
  })
  it('has no thinking selector in the header', () => {
    renderWithI18n(<ChatHeader conversation={conv} />)
    expect(screen.queryByTestId('reasoning-level')).toBeNull()
  })
})

describe('ModelPicker', () => {
  it('shows the current model and lists real and replay groups', async () => {
    const onChange = vi.fn()
    renderWithI18n(<ModelPicker models={[m('a'), m('replay:x', 'replay')]} value={m('a')} onChange={onChange} />)
    expect(screen.getByTestId('model-picker')).toHaveTextContent('Label a')
    await userEvent.click(screen.getByTestId('model-picker'))
    await userEvent.click(await screen.findByTestId('model-option-replay:x'))
    expect(onChange).toHaveBeenCalledWith('replay:x')
  })
})

describe('rename focus', () => {
  it('focuses and selects the title input after choosing Rename from the menu', async () => {
    renderWithI18n(<ChatHeader conversation={conv} />)
    await userEvent.click(screen.getByTestId('chat-menu'))
    await userEvent.click(await screen.findByTestId('conv-rename'))
    const input = (await screen.findByRole('textbox', { name: 'Rename' })) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('My chat'.length)
  })
})
