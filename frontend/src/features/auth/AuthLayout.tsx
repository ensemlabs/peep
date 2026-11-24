import type { ReactNode } from 'react'
import { LangSwitch } from '@/components/LangSwitch'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { EnsembleLogo } from '@/components/EnsembleLogo'
import { useT } from '@/i18n'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const t = useT()
  return (
    <main className="flex min-h-app flex-col items-center justify-center bg-surface px-[max(1rem,var(--safe-left))] pb-[max(2.5rem,var(--safe-bottom))] pt-[max(2.5rem,var(--safe-top))]">
      <div className="mb-4 flex w-full max-w-sm items-center justify-end gap-2">
        <ThemeSwitch />
        <LangSwitch />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <EnsembleLogo size={44} className="mx-auto mb-3" />
          <p data-testid="brand-name" className="text-2xl font-semibold leading-none tracking-tight">{t('app.name')}</p>
          <p data-testid="brand-by" className="mt-1 text-xs text-muted">{t('app.by')}</p>
          <h1 className="mt-5 text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  )
}
