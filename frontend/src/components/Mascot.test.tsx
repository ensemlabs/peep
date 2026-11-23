import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Mascot, mascotClass, mascotStateFor } from './Mascot'
import type { Message } from '@/api/types'

const msg = (over: Partial<Message>): Message => ({
  id: 'm', role: 'assistant', content: '', attachments: [], parts: [], status: 'streaming', model: 'x', created_at: '', ...over,
})
const T = '2026-01-01T00:00:00Z'

describe('Mascot', () => {
  it.each(['idle', 'thinking', 'working', 'error'] as const)('maps state %s to a class and data-state', (state) => {
    expect(mascotClass(state, true)).toBe(`mascot mascot-pip mascot--${state}`)
    render(<Mascot state={state} />)
    const el = screen.getByTestId('mascot')
    expect(el).toHaveAttribute('data-state', state)
    expect(el).toHaveClass(`mascot--${state}`)
  })
  it('is static when animated=false', () => {
    expect(mascotClass('idle', false)).toContain('mascot--still')
  })
  it('renders Pip with a unique gradient per instance and the thought dots', () => {
    const { container } = render(<><Mascot state="thinking" /><Mascot state="idle" /></>)
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id)
    expect(new Set(ids).size).toBe(2)
    expect(container.querySelectorAll('.pip-dots')).toHaveLength(2)
    expect(container.querySelector('.mascot-pip.mascot--thinking')).not.toBeNull()
  })
})

describe('mascotStateFor', () => {
  it('follows the running part', () => {
    expect(mascotStateFor(msg({ parts: [] }))).toBe('thinking')
    expect(mascotStateFor(msg({ parts: [{ id: 't', type: 'thinking', text: '', status: 'running', started_at: T }] }))).toBe('thinking')
    expect(mascotStateFor(msg({ parts: [{ id: 't', type: 'tool', name: 'n', input: {}, output: null, files: [], status: 'running', started_at: T }] }))).toBe('working')
    expect(mascotStateFor(msg({ parts: [{ id: 't', type: 'text', text: 'hi' }] }))).toBe('idle')
  })
  it('is error / idle for finished messages', () => {
    expect(mascotStateFor(msg({ status: 'error' }))).toBe('error')
    expect(mascotStateFor(msg({ status: 'complete' }))).toBe('idle')
  })
})
