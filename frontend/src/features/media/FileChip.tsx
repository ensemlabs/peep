import { lazy, Suspense, useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import type { FileMeta } from '@/api/types'
import { useT } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { isTextPreviewable } from '@/lib/files'
import { DownloadLink } from './DownloadLink'

const CodePreviewDialog = lazy(() => import('./CodePreviewDialog'))

export function FileChip({ file }: { file: FileMeta }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const previewable = isTextPreviewable(file)
  return (
    <div
      data-testid="file-chip"
      className="my-2 flex w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2"
    >
      <FileText className="size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={file.filename}>{file.filename}</div>
        <div className="text-xs text-muted">{formatBytes(file.size)}</div>
      </div>
      {previewable && (
        <button
          type="button"
          data-testid="file-preview"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
        >
          <Eye className="size-4" />
          <span className="hidden sm:inline">{t('common.preview')}</span>
          <span className="sr-only sm:hidden">{t('common.preview')}</span>
        </button>
      )}
      <DownloadLink file={file} />
      {open && (
        <Suspense fallback={null}>
          <CodePreviewDialog file={file} open onOpenChange={setOpen} />
        </Suspense>
      )}
    </div>
  )
}
