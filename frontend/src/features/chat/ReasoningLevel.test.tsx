import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithI18n } from '@/test/utils'
import { ReasoningLevel } from './ReasoningLevel'
import type { ModelInfo } from '@/api/types'

const m = (reasoning: ModelInfo['reasoning']): ModelInfo => ({ id: 'a', label: 'A', provider: 'openai', context_window: 1000, reasoning })
const two = { levels: [{ id: 'off', label: 'Off' }, { id: 'high', label: 'High' }], default: 'off' }

describe('ReasoningLevel', () => {
  it('is hidden without reasoning', () => {
    renderWithI18n(<ReasoningLevel model={m(null)} value={null} onChange={vi.fn()} />)
    expect(screen.queryByTestId('reasoning-level')).toBeNull()
  })
  it('shows "Always on" for a single level', () => {
    renderWithI18n(<ReasoningLevel model={m({ levels: [{ id: 'on', label: 'On' }], default: 'on' })} value="on" onChange={vi.fn()} />)
    expect(screen.getByTestId('reasoning-level')).toHaveTextContent('Always on')
  })
  it('shows the current level in a dropdown for several levels', () => {
    renderWithI18n(<ReasoningLevel model={m(two)} value="high" onChange={vi.fn()} />)
    const el = screen.getByTestId('reasoning-level')
    expect(el).toHaveTextContent('High')
    expect(el).toHaveAttribute('data-value', 'high')
  })
})
