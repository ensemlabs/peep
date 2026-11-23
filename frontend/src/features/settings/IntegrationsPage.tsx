import { Info } from 'lucide-react'
import { useI18n } from '@/i18n'
import { TopBar } from '@/layout/TopBar'
import { PluginsSection } from './PluginsSection'
import { SettingsTabs } from './SettingsTabs'
import { SkillsSection } from './SkillsSection'

export function IntegrationsPage() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar>
        <h1 className="text-base font-semibold">{t('settings.title')}</h1>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsTabs />
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
          <p
            data-testid="integrations-banner"
            className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-muted"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('integrations.banner')}
          </p>
          <SkillsSection />
          <PluginsSection />
        </div>
      </div>
    </div>
  )
}
