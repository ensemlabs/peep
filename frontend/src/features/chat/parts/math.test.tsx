import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Markdown } from './Markdown'
import { mightHaveMath, prepareMath } from './math'

describe('prepareMath', () => {
  it('escapes prices but keeps inline math', () => {
    expect(prepareMath('It costs $5 and $10.')).toBe('It costs \\$5 and \\$10.')
    expect(prepareMath('Pay $5.')).toBe('Pay \\$5.')
    expect(prepareMath('Since $4$ and $2 \\cdot 3$ hold')).toBe('Since $4$ and $2 \\cdot 3$ hold')
    expect(prepareMath('$x$ costs $5')).toBe('$x$ costs \\$5')
  })
  it('follows pandoc rules for openers and closers', () => {
    expect(prepareMath('A pen costs $3 and a book costs $x$.')).toBe('A pen costs \\$3 and a book costs $x$.')
    expect(prepareMath('a $ b $ c')).toBe('a \\$ b \\$ c') // whitespace inside: not math
    expect(prepareMath('cost $5$10')).toBe('cost \\$5\\$10') // closer followed by a digit
    expect(prepareMath('only $x')).toBe('only \\$x') // no closer: literal
  })
  it('protects indented code, multi-backtick spans and escaped brackets', () => {
    expect(prepareMath('Text\n\n    echo $5 and $10\n\nafter $3')).toBe('Text\n\n    echo $5 and $10\n\nafter \\$3')
    expect(prepareMath('use ``$5`` here')).toBe('use ``$5`` here')
    expect(prepareMath('see \\[1\\] and \\[2\\]')).toBe('see \\[1\\] and \\[2\\]')
    expect(prepareMath('- item\n\n    $5 stays in a list continuation? $3')).toContain('\\$5')
  })
  it('never touches code', () => {
    expect(prepareMath('run `echo $5` now')).toBe('run `echo $5` now')
    expect(prepareMath('```bash\necho $5 and $10\n```')).toBe('```bash\necho $5 and $10\n```')
  })
  it('normalises \\( \\) and \\[ \\] delimiters', () => {
    expect(prepareMath('a \\(x^2\\) b')).toBe('a $x^2$ b')
    expect(prepareMath('\\[\\frac{a}{b}\\]')).toBe('$$\n\\frac{a}{b}\n$$')
    expect(prepareMath('\\[x^2\\]')).toBe('\\[x^2\\]') // no TeX command: left alone
  })
  it('turns a one-line $$..$$ into a fenced display block', () => {
    expect(prepareMath('$$a^2$$')).toBe('$$\na^2\n$$')
    expect(prepareMath('text $$a^2$$ inline')).toBe('text $$a^2$$ inline')
  })
  it('only flags text that might contain math', () => {
    expect(mightHaveMath('plain text')).toBe(false)
    expect(mightHaveMath('a $x$')).toBe(true)
  })
})

describe('Markdown math', () => {
  it('renders inline and display math with KaTeX', async () => {
    const { container } = render(<Markdown text={'Since $10 \\equiv -1 \\pmod{11}$ we get:\n\n$$a^2 + b^2 = c^2$$'} />)
    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2))
    expect(container.querySelector('.katex-display')).not.toBeNull()
  })
  it('renders a price sentence as plain text, not math', async () => {
    const { container } = render(<Markdown text="It costs $5 and $10 in total." />)
    await new Promise((r) => setTimeout(r, 150))
    expect(container.querySelector('.katex')).toBeNull()
    expect(screen.getByText('It costs $5 and $10 in total.')).toBeInTheDocument()
  })
  it('does not throw on partially streamed or invalid TeX', async () => {
    const { container } = render(<Markdown text={'Partial $\\frac{1}{ and $$\\begin{aligned} x &= '} streaming />)
    await new Promise((r) => setTimeout(r, 150))
    expect(container.textContent).toContain('Partial')
  })
  it('works in the muted thinking markdown too', async () => {
    const { container } = render(<Markdown text="Check $x^2$ first" muted />)
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull())
  })
})
