import { lazy, Suspense, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { FileMeta } from '@/api/types'
import { useT } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { DownloadLink } from './DownloadLink'

const MediaLightbox = lazy(() => import('./MediaLightbox'))

export function VideoCard({ file }: { file: FileMeta }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : '16 / 9'
  return (
    <div data-testid="video-card" className="my-3 w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-surface">
      <div className="bg-black" style={{ aspectRatio: ratio, maxHeight: '70dvh', width: '100%' }}>
        <video
          src={file.url}
          controls
          playsInline
          preload="metadata"
          className="size-full bg-black object-contain"
          aria-label={file.filename}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate" title={file.filename}>{file.filename}</span>
        <span className="shrink-0 text-xs text-muted">{formatBytes(file.size)}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('media.openVideo')}
          title={t('common.expand')}
          className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <Maximize2 className="size-4" />
        </button>
        <DownloadLink file={file} />
      </div>
      {open && (
        <Suspense fallback={null}>
          <MediaLightbox files={[file]} index={0} open onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
