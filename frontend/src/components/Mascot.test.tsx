import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Mascot, mascotClass } from './Mascot'
import { EmptyState } from '@/features/chat/EmptyState'
import { renderWithI18n } from '@/test/utils'

describe('Mascot (Peep)', () => {
  it.each(['greet', 'idle', 'pending', 'error'] as const)('maps state %s to the class and data-state', (state) => {
    expect(mascotClass(state, true)).toBe(`mascot mascot-peep mascot--${state}`)
    const { unmount } = render(<Mascot state={state} />)
    const el = screen.getByTestId('mascot')
    expect(el).toHaveAttribute('data-state', state)
    expect(el).toHaveClass('mascot-peep', `mascot--${state}`)
    unmount()
  })
  it('is static when animated=false', () => {
    expect(mascotClass('idle', false)).toContain('mascot--still')
  })
  it('has a unique gradient per instance, the thought dots and a stable animated group', () => {
    const { container } = render(<><Mascot state="pending" /><Mascot state="idle" /></>)
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id)
    expect(new Set(ids).size).toBe(2)
    expect(container.querySelectorAll('.peep-dots')).toHaveLength(2)
    expect(container.querySelectorAll('.peep-float')).toHaveLength(2) // target for animation checks
    expect(container.querySelector('.mascot-pip, .pip-float')).toBeNull() // no Pip left
  })
})

describe('Peep on the empty state', () => {
  it('plays the greeting when the empty state mounts, as a large Peep', () => {
    renderWithI18n(<EmptyState name="Ann" />)
    const peep = screen.getByTestId('mascot')
    expect(peep).toHaveClass('mascot--greet')
    expect(peep).toHaveAttribute('width', '88')
  })
  it('keeps the same greet element across re-renders (the CSS moves on to idle by itself)', () => {
    const { rerender } = renderWithI18n(<EmptyState name="Ann" />)
    const first = screen.getByTestId('mascot')
    rerender(<EmptyState name="Ann" hour={3} />)
    expect(screen.getByTestId('mascot')).toBe(first)
    expect(first).toHaveClass('mascot--greet')
  })
})
