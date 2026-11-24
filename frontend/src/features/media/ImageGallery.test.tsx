import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithI18n } from '@/test/utils'
import { ImageGallery } from './ImageGallery'
import type { FileMeta } from '@/api/types'

const img = (i: number): FileMeta => ({
  id: `f${i}`, kind: 'image', mime: 'image/png', filename: `i${i}.png`, size: 1000, width: 1600, height: 1000,
  url: `/api/files/f${i}/content`, thumb_url: `/api/files/f${i}/thumb`, download_url: `/api/files/f${i}/content?download=1`,
})
const imgs = (n: number) => Array.from({ length: n }, (_, i) => img(i + 1))

describe('ImageGallery', () => {
  it('shows one large image using the thumbnail', () => {
    renderWithI18n(<ImageGallery images={imgs(1)} />)
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-cols', '1')
    const el = screen.getAllByRole('img')[0]
    expect(el).toHaveAttribute('src', '/api/files/f1/thumb')
    expect(el.className).toContain('max-h-[480px]')
    expect(el.className).toContain('object-contain')
  })
  it.each([[2, 'grid-cols-2'], [4, 'grid-cols-2'], [5, 'grid-cols-3'], [6, 'grid-cols-3']])('%i images use %s', (n, cls) => {
    renderWithI18n(<ImageGallery images={imgs(n)} />)
    expect(screen.getByTestId('gallery').className).toContain(cls)
    expect(screen.getAllByTestId('gallery-item')).toHaveLength(n)
    expect(screen.queryByTestId('gallery-more')).toBeNull()
  })
  it('shows a +N tile beyond 6', () => {
    renderWithI18n(<ImageGallery images={imgs(9)} />)
    expect(screen.getAllByTestId('gallery-item')).toHaveLength(6)
    expect(screen.getByTestId('gallery-more')).toHaveTextContent('+3')
  })
  it('falls back to url without thumb_url', () => {
    renderWithI18n(<ImageGallery images={[{ ...img(1), thumb_url: null }]} />)
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', '/api/files/f1/content')
  })
  it('opens the lightbox with the original URL, not the thumbnail', async () => {
    renderWithI18n(<ImageGallery images={imgs(3)} />)
    await userEvent.click(screen.getAllByRole('button', { name: /image 2/i })[0])
    await waitFor(() => expect(document.querySelector('.yarl__root')).not.toBeNull())
    await waitFor(() => {
      const srcs = Array.from(document.querySelectorAll('.yarl__carousel .yarl__slide_image')).map((e) => e.getAttribute('src'))
      expect(srcs).toContain('/api/files/f2/content')
      expect(srcs).not.toContain('/api/files/f2/thumb')
    })
  })
  it('uses 4:3 tiles in grids (not square) so wide images are not cropped badly', () => {
    renderWithI18n(<ImageGallery images={imgs(3)} />)
    for (const tile of screen.getAllByTestId('gallery-item')) {
      expect(tile.className).toContain('aspect-[4/3]')
      expect(tile.className).not.toContain('aspect-square')
    }
    for (const img of screen.getAllByRole('img')) expect(img.className).toContain('object-cover')
  })
  it('keeps the single image at its natural aspect (no fixed tile ratio), capped by max height', () => {
    renderWithI18n(<ImageGallery images={imgs(1)} />)
    expect(screen.getByTestId('gallery-item').className).not.toMatch(/aspect-/)
    expect(screen.getByRole('img').className).toContain('max-h-[480px]')
  })
  it('lays out 2, 3 and 5 images with 4:3 tiles and the right columns, and a +N tile keeps the same ratio', () => {
    for (const [n, cls] of [[2, 'grid-cols-2'], [3, 'grid-cols-2'], [5, 'grid-cols-3']] as const) {
      const { unmount } = renderWithI18n(<ImageGallery images={imgs(n)} />)
      expect(screen.getByTestId('gallery').className).toContain(cls)
      expect(screen.getAllByTestId('gallery-item')).toHaveLength(n)
      unmount()
    }
    renderWithI18n(<ImageGallery images={imgs(8)} />)
    const tiles = screen.getAllByTestId('gallery-item')
    expect(tiles).toHaveLength(6)
    expect(tiles[5].className).toContain('aspect-[4/3]')
    expect(screen.getByTestId('gallery-more')).toHaveTextContent('+2')
  })
})
