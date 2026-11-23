import { Music } from 'lucide-react'
import type { FileMeta } from '@/api/types'
import { formatBytes } from '@/lib/format'
import { DownloadLink } from './DownloadLink'

export function AudioCard({ file }: { file: FileMeta }) {
  return (
    <div data-testid="audio-card" className="my-3 w-full max-w-md rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Music className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={file.filename}>{file.filename}</span>
        <span className="shrink-0 text-xs text-muted">{formatBytes(file.size)}</span>
        <DownloadLink file={file} />
      </div>
      <audio src={file.url} controls preload="metadata" className="w-full" aria-label={file.filename} />
    </div>
  )
}
