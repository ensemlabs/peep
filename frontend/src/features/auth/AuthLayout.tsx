import type { ReactNode } from 'react'
import { LangSwitch } from '@/components/LangSwitch'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { Mascot } from '@/components/Mascot'
import { useT } from '@/i18n'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const t = useT()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-4 flex w-full max-w-sm items-center justify-end gap-2">
        <ThemeSwitch />
        <LangSwitch />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <Mascot size={56} className="mx-auto mb-2" />
          <p className="text-sm font-semibold tracking-tight text-muted">{t('app.name')}</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  )
}
