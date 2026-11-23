import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { ME_KEY, useMe } from './useMe'
import { validateEmail, validateNewPassword } from './validation'

export function RegisterPage() {
  const { t, err } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me.data) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = (!name.trim() && 'validation.nameRequired') || validateEmail(email) || validateNewPassword(password, email)
    if (bad) return setError(t(bad as Parameters<typeof t>[0]))
    setError(null)
    setBusy(true)
    try {
      const user = await api.register(email.trim(), password, name.trim())
      qc.setQueryData(ME_KEY, user)
      navigate('/', { replace: true })
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('register.title')} subtitle={t('register.subtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="name" className={labelClass}>{t('field.displayName')}</label>
          <input id="name" name="name" autoComplete="name" value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>{t('field.email')}</label>
          <input id="email" name="email" type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>{t('field.password')}</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">{t('validation.passwordLength')}</p>
        </div>
        {error && <p role="alert" data-testid="form-error" className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy && <Spinner />}
          {t('register.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t('register.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-fg underline underline-offset-2">{t('register.loginLink')}</Link>
      </p>
    </AuthLayout>
  )
}
