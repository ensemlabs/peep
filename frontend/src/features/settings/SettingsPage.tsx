import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useI18n, type Lang } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { validateNewPassword } from '@/features/auth/validation'
import { useOutletContext } from 'react-router'
import type { User } from '@/api/types'
import { TopBar } from '@/layout/TopBar'

export function SettingsPage() {
  const { t, err, lang, setLang } = useI18n()
  const user = useOutletContext<User>()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setDone(true)
      setCurrent('')
      setNext('')
    },
    onError: (e) => setError(err(e)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setDone(false)
    const bad = validateNewPassword(next, user.email)
    if (!current) return setError(t('validation.passwordRequired'))
    if (bad) return setError(t(bad))
    setError(null)
    change.mutate()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar>
        <h1 className="text-base font-semibold">{t('settings.title')}</h1>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl space-y-8 px-4 py-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold">{t('settings.language')}</h2>
            <select
              aria-label={t('settings.language')}
              data-testid="settings-language"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className={inputClass}
            >
              <option value="en">{t('lang.en')}</option>
              <option value="vi">{t('lang.vi')}</option>
            </select>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold">{t('settings.password')}</h2>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="cur" className={labelClass}>{t('field.currentPassword')}</label>
                <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
              <div>
                <label htmlFor="new" className={labelClass}>{t('field.newPassword')}</label>
                <PasswordInput id="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                <p className="mt-1.5 text-xs text-muted">{t('validation.passwordLength')}</p>
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              {done && <p role="status" className="text-sm text-success">{t('settings.passwordDone')}</p>}
              <Button type="submit" variant="primary" disabled={change.isPending}>
                {change.isPending && <Spinner />}
                {t('settings.submit')}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
