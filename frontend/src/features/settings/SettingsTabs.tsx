import { NavLink } from 'react-router'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

export function SettingsTabs() {
  const t = useT()
  const cls = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-bg shadow-sm' : 'text-muted hover:text-fg')
  return (
    <nav className="mx-auto flex w-full max-w-3xl gap-1 px-4 pt-4" aria-label={t('settings.title')}>
      <div className="flex gap-1 rounded-xl bg-surface p-1">
        <NavLink to="/settings" end className={cls} data-testid="settings-tab-general">{t('settings.tab.general')}</NavLink>
        <NavLink to="/settings/integrations" className={cls} data-testid="settings-tab-integrations">{t('settings.tab.integrations')}</NavLink>
      </div>
    </nav>
  )
}
