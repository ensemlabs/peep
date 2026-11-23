import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { ME_KEY, useMe } from './useMe'
import { validateEmail } from './validation'

export function LoginPage() {
  const { t, err } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me.data) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = validateEmail(email)
    if (bad) return setError(t(bad))
    if (!password) return setError(t('validation.passwordRequired'))
    setError(null)
    setBusy(true)
    try {
      const user = await api.login(email.trim(), password)
      qc.setQueryData(ME_KEY, user)
      navigate('/', { replace: true })
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className={labelClass}>{t('field.email')}</label>
          <input id="email" name="email" type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>{t('field.password')}</label>
          <PasswordInput id="password" name="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        {notice === 'account_disabled' && !error && (
          <p role="alert" className="text-sm text-danger">{t('error.account_disabled')}</p>
        )}
        {error && <p role="alert" data-testid="form-error" className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy && <Spinner />}
          {t('login.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="font-medium text-fg underline underline-offset-2">{t('login.registerLink')}</Link>
      </p>
    </AuthLayout>
  )
}
