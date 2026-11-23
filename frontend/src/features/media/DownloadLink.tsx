import { Download } from 'lucide-react'
import type { FileMeta } from '@/api/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

export function DownloadLink({ file, className, label = false }: { file: FileMeta; className?: string; label?: boolean }) {
  const t = useT()
  return (
    <a
      href={file.download_url}
      download={file.filename}
      data-testid="download"
      aria-label={`${t('common.download')}: ${file.filename}`}
      title={t('common.download')}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg', className)}
    >
      <Download className="size-4" />
      {label && <span className="text-sm">{t('common.download')}</span>}
    </a>
  )
}
