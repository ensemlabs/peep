import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { applyTheme, getStoredTheme, initTheme, resolveTheme, setTheme } from './theme'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { renderWithI18n } from '@/test/utils'

let systemDark = false
const listeners: (() => void)[] = []

beforeEach(() => {
  localStorage.clear()
  systemDark = false
  listeners.length = 0
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    get matches() { return q.includes('dark') && systemDark },
    media: q,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})
afterEach(() => vi.restoreAllMocks())

describe('theme', () => {
  it('defaults to system and falls back to the OS scheme', () => {
    expect(getStoredTheme()).toBe('system')
    expect(resolveTheme('system')).toBe('light')
    systemDark = true
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
  })
  it('applies and persists an explicit choice', () => {
    systemDark = true
    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('ec_theme')).toBe('light')
    setTheme('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(getStoredTheme()).toBe('dark')
  })
  it('restores the stored choice on init and ignores garbage', () => {
    localStorage.setItem('ec_theme', 'dark')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    localStorage.setItem('ec_theme', 'purple')
    expect(getStoredTheme()).toBe('system')
  })
  it('follows OS changes only while on system', () => {
    initTheme()
    systemDark = true
    listeners.forEach((l) => l())
    expect(document.documentElement.dataset.theme).toBe('dark')
    setTheme('light')
    listeners.forEach((l) => l())
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(getStoredTheme()).toBe('system')
    expect(() => setTheme('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('theme-color meta', () => {
  it('follows the resolved theme', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff"><meta name="theme-color" content="#212121" media="(prefers-color-scheme: dark)">'
    setTheme('dark')
    expect([...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.getAttribute('content'))).toEqual(['#212121', '#212121'])
    setTheme('light')
    expect([...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.getAttribute('content'))).toEqual(['#ffffff', '#ffffff'])
    document.head.innerHTML = ''
  })
})

describe('ThemeSwitch', () => {
  it('shows three options and switches the theme', async () => {
    setTheme('system')
    renderWithI18n(<ThemeSwitch />)
    const sw = screen.getByTestId('theme-switch')
    expect(sw.querySelectorAll('button[data-value]')).toHaveLength(3)
    await userEvent.click(sw.querySelector('[data-value=dark]')!)
    expect(document.documentElement).toHaveClass('dark')
    expect(sw.querySelector('[data-value=dark]')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(sw.querySelector('[data-value=light]')!)
    expect(document.documentElement).not.toHaveClass('dark')
  })
  it('is labelled in Vietnamese', () => {
    render(<div />)
    renderWithI18n(<ThemeSwitch />, 'vi')
    expect(screen.getByRole('button', { name: 'Tối' })).toBeInTheDocument()
  })
})
