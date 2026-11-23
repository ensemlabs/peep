import { Navigate, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { PendingGate } from '@/features/auth/PendingGate'
import { ME_KEY, useLogout, useMe } from '@/features/auth/useMe'
import { useRunStore } from '@/features/chat/stores'
import { Sidebar } from './Sidebar'

export function AuthGuard() {
  const { t, err } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const logout = useLogout()

  if (me.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted">
        <Spinner className="size-6" label={t('common.loading')} />
      </div>
    )
  }
  if (me.isError) {
    const e = me.error
    if (e instanceof ApiError && (e.status === 401 || e.code === 'account_disabled')) {
      useRunStore.getState().abortAll()
      return <Navigate to="/login" replace state={e.code === 'account_disabled' ? { notice: 'account_disabled' } : undefined} />
    }
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-danger">{err(e)}</p>
        <Button onClick={() => qc.invalidateQueries({ queryKey: ME_KEY })}>{t('pending.check')}</Button>
      </div>
    )
  }

  const user = me.data
  const pending = user.status === 'pending'
  return (
    <PendingGate
      pending={pending}
      checking={me.isFetching}
      onCheck={() => me.refetch()}
      onLogout={() => {
        useRunStore.getState().abortAll()
        logout.mutate()
      }}
    >
      <Sidebar user={user} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet context={user} />
      </main>
    </PendingGate>
  )
}
