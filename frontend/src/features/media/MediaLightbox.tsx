import Lightbox, { type Slide } from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails'
import Download from 'yet-another-react-lightbox/plugins/download'
import Video from 'yet-another-react-lightbox/plugins/video'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/thumbnails.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import type { FileMeta } from '@/api/types'

/** Slides always use the original URL (never the thumbnail) at its natural resolution. */
export function toSlide(f: FileMeta): Slide {
  const download = { url: f.download_url, filename: f.filename }
  if (f.kind === 'video') {
    return {
      type: 'video',
      width: f.width ?? 1280,
      height: f.height ?? 720,
      sources: [{ src: f.url, type: f.mime }],
      download,
    }
  }
  return {
    src: f.url,
    alt: f.filename,
    ...(f.width && f.height ? { width: f.width, height: f.height, srcSet: [{ src: f.url, width: f.width, height: f.height }] } : {}),
    // The Thumbnails plugin shows the small variant in its strip only.
    ...(f.thumb_url ? { thumbnail: f.thumb_url } : {}),
    download,
  } as Slide
}

interface Props {
  files: FileMeta[]
  index: number
  open: boolean
  onClose: () => void
  onIndexChange?: (i: number) => void
}

export default function MediaLightbox({ files, index, open, onClose, onIndexChange }: Props) {
  const multi = files.length > 1
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={files.map(toSlide)}
      plugins={[Zoom, Download, Video, ...(multi ? [Thumbnails, Counter] : [])]}
      zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      video={{ controls: true, playsInline: true, preload: 'metadata' }}
      carousel={{ finite: !multi }}
      controller={{ closeOnBackdropClick: true }}
      on={{ view: ({ index: i }) => onIndexChange?.(i) }}
      thumbnails={{ vignette: false }}
    />
  )
}
