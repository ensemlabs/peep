import { lazy, Suspense, useState } from 'react'
import type { FileMeta } from '@/api/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { DownloadLink } from './DownloadLink'

const MediaLightbox = lazy(() => import('./MediaLightbox'))

const MAX_TILES = 6

export function ImageGallery({ images }: { images: FileMeta[] }) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const count = images.length
  if (count === 0) return null

  const single = count === 1
  const cols = count <= 4 ? 2 : 3
  const shown = single ? images : images.slice(0, MAX_TILES)
  const hidden = count - shown.length

  const openAt = (i: number) => {
    setIndex(i)
    setOpen(true)
  }

  return (
    <div
      data-testid="gallery"
      data-count={count}
      data-cols={single ? 1 : cols}
      role="group"
      aria-label={t('media.gallery')}
      className={cn(
        'my-3',
        single ? 'inline-block max-w-full' : cn('grid max-w-xl gap-1.5', cols === 2 ? 'grid-cols-2' : 'grid-cols-3'),
      )}
    >
      {shown.map((img, i) => {
        const isLastWithMore = hidden > 0 && i === shown.length - 1
        return (
          <div
            key={img.id}
            data-testid="gallery-item"
            className={cn('group relative overflow-hidden rounded-xl bg-surface-2', !single && 'aspect-[4/3]')}
          >
            <button
              type="button"
              onClick={() => openAt(i)}
              aria-label={t('media.openImage', { n: i + 1 })}
              className={cn('block', single ? 'max-w-full' : 'size-full')}
            >
              <img
                src={img.thumb_url || img.url}
                alt={img.filename}
                loading="lazy"
                decoding="async"
                className={single ? 'max-h-[480px] max-w-full rounded-xl object-contain' : 'size-full object-cover'}
              />
              {isLastWithMore && (
                <span
                  data-testid="gallery-more"
                  className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white"
                >
                  {t('media.more', { n: hidden })}
                </span>
              )}
            </button>
            {!isLastWithMore && (
              <DownloadLink
                file={img}
                className="absolute right-1.5 top-1.5 bg-black/55 text-white opacity-100 hover:bg-black/70 hover:text-white [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
              />
            )}
          </div>
        )
      })}
      {open && (
        <Suspense fallback={null}>
          <MediaLightbox files={images} index={index} open={open} onClose={() => setOpen(false)} onIndexChange={setIndex} />
        </Suspense>
      )}
    </div>
  )
}
