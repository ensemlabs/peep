import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { AdminUser, TokenPeriod } from '@/api/types'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { formatTokens } from '@/lib/format'
import { parseLimit } from '@/lib/quota'

export function QuotaDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n()
  const [limited, setLimited] = useState(user.token_limit != null)
  const [raw, setRaw] = useState(user.token_limit != null ? String(user.token_limit) : '')
  const [period, setPeriod] = useState<TokenPeriod>(user.token_period)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseLimit(raw)

  const save = useMutation({
    mutationFn: (limit: number | null) => api.adminPatchUser(user.id, { token_limit: limit, token_period: period }),
    onSuccess: onSaved,
    onError: (e) => setError(err(e)),
  })

  function submit() {
    if (limited && parsed == null) return setError(t('admin.quota.invalid'))
    setError(null)
    save.mutate(limited ? parsed : null)
  }

  const radio = 'flex cursor-pointer items-center gap-2 text-sm'
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.quota.title', { email: user.email })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" data-testid="quota-save" disabled={save.isPending} onClick={submit}>
            {save.isPending && <Spinner />} {t('common.save')}
          </Button>
        </>
      }
    >
      <div data-testid="quota-dialog" className="space-y-4">
        <div role="radiogroup" aria-label={t('admin.quota.mode')} className="flex flex-wrap gap-x-5 gap-y-2">
          <label className={radio}>
            <input type="radio" name="quota-mode" data-testid="quota-unlimited" checked={!limited} onChange={() => setLimited(false)} />
            {t('admin.quota.unlimited')}
          </label>
          <label className={radio}>
            <input type="radio" name="quota-mode" data-testid="quota-limited" checked={limited} onChange={() => setLimited(true)} />
            {t('admin.quota.limited')}
          </label>
        </div>
        {limited && (
          <div>
            <label htmlFor="quota-limit" className={labelClass}>{t('admin.quota.limit')}</label>
            <input
              id="quota-limit"
              data-testid="quota-limit-input"
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value.replace(/\D/g, ''))}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted" data-testid="quota-preview">{parsed != null ? formatTokens(parsed) : '—'}</p>
          </div>
        )}
        <fieldset>
          <legend className={labelClass}>{t('admin.quota.period')}</legend>
          <div className="flex gap-5">
            {(['day', 'month'] as const).map((p) => (
              <label key={p} className={radio}>
                <input type="radio" name="quota-period" data-testid={`quota-period-${p}`} checked={period === p} onChange={() => setPeriod(p)} />
                {t(p === 'day' ? 'admin.quota.day' : 'admin.quota.month')}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}
