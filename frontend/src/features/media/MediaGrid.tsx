import type { FileMeta } from '@/api/types'
import { ImageGallery } from './ImageGallery'
import { VideoCard } from './VideoCard'
import { AudioCard } from './AudioCard'
import { FileChip } from './FileChip'

/** Routes each file to its renderer: images are grouped into one gallery. Only API URLs, never base64. */
export function MediaGrid({ files }: { files: FileMeta[] }) {
  if (!files?.length) return null
  const images = files.filter((f) => f.kind === 'image')
  const rest = files.filter((f) => f.kind !== 'image')
  return (
    <div className="min-w-0 max-w-full">
      <ImageGallery images={images} />
      {rest.map((f) => {
        switch (f.kind) {
          case 'video':
            return <VideoCard key={f.id} file={f} />
          case 'audio':
            return <AudioCard key={f.id} file={f} />
          default:
            return <FileChip key={f.id} file={f} />
        }
      })}
    </div>
  )
}
