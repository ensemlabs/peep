import type { TKey } from '@/i18n'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(email: string): TKey | null {
  return EMAIL_RE.test(email.trim()) ? null : 'validation.emailRequired'
}

/** Mirrors the backend: 10-128 chars and not equal to the email. */
export function validateNewPassword(password: string, email?: string): TKey | null {
  if (password.length < 10 || password.length > 128) return 'validation.passwordLength'
  if (email && password.toLowerCase() === email.trim().toLowerCase()) return 'validation.passwordIsEmail'
  return null
}
