import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { I18nProvider, type Lang } from '@/i18n'

export function renderWithI18n(ui: ReactElement, lang: Lang = 'en') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider initial={lang}>
      <MemoryRouter>{children}</MemoryRouter>
    </I18nProvider>
  )
  return render(ui, { wrapper })
}
