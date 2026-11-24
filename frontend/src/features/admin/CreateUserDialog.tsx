import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, Wand2 } from 'lucide-react'
import { api } from '@/api/client'
import type { Role } from '@/api/types'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Spinner } from '@/components/ui/Spinner'
import { inputClass, labelClass } from '@/components/ui/styles'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { validateEmail, validateNewPassword } from '@/features/auth/validation'
import { generatePassword } from './password'

export function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t, err } = useI18n()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [status, setStatus] = useState<'active' | 'pending'>('active')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: () => api.adminCreateUser({ email: email.trim(), display_name: name.trim(), password, role, status }),
    onSuccess: onCreated,
    onError: (e) => setError(err(e)),
  })

  function submit() {
    const bad = validateEmail(email) || (!name.trim() && 'validation.nameRequired') || validateNewPassword(password, email)
    if (bad) return setError(t(bad))
    setError(null)
    create.mutate()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (insecure context): the password stays visible for manual copy */
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.createTitle')}
      description={t('admin.createHint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="create-user-form" variant="primary" data-testid="create-user-submit" disabled={create.isPending}>
            {create.isPending && <Spinner />} {t('admin.createSubmit')}
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        noValidate
        data-testid="create-user-dialog"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div>
          <label htmlFor="new-email" className={labelClass}>{t('field.email')}</label>
          <input id="new-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="new-name" className={labelClass}>{t('field.displayName')}</label>
          <input id="new-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>{t('admin.tempPassword')}</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
            </div>
            <Button data-testid="gen-password" aria-label={t('admin.generate')} title={t('admin.generate')} onClick={() => setPassword(generatePassword())}>
              <Wand2 className="size-4" />
            </Button>
            <Button aria-label={t('common.copy')} title={copied ? t('common.copied') : t('common.copy')} disabled={!password} onClick={copy}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">{t('validation.passwordLength')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-role" className={labelClass}>{t('admin.col.role')}</label>
            <select id="new-role" data-testid="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
              <option value="user">{t('admin.role.user')}</option>
              <option value="admin">{t('admin.role.admin')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="new-status" className={labelClass}>{t('admin.col.status')}</label>
            <select id="new-status" data-testid="new-status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'pending')} className={inputClass}>
              <option value="active">{t('admin.status.active')}</option>
              <option value="pending">{t('admin.status.pending')}</option>
            </select>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  )
}
