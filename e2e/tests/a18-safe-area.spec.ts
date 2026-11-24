import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  allowConsoleError, expect, lastAssistant, startReplay, test, waitAssistantDone,
} from './helpers'

// Playwright cannot emulate env(safe-area-inset-*), so the --safe-* variables (index.css) are overridden instead.
interface Insets { top: number; right: number; bottom: number; left: number }
const PORTRAIT = { viewport: { width: 393, height: 852 }, insets: { top: 59, right: 0, bottom: 34, left: 0 } }
const LANDSCAPE = { viewport: { width: 852, height: 393 }, insets: { top: 0, right: 59, bottom: 21, left: 59 } }

const ARTIFACTS = path.join(__dirname, '..', 'artifacts')

async function simulate(page: Page, i: Insets) {
  const css = `:root{--safe-top:${i.top}px!important;--safe-right:${i.right}px!important;--safe-bottom:${i.bottom}px!important;--safe-left:${i.left}px!important}`
  await page.addInitScript((c) => {
    localStorage.setItem('ec_theme', 'dark')
    const add = () => {
      const s = document.createElement('style')
      s.textContent = c
      document.documentElement.appendChild(s)
    }
    if (document.documentElement) add()
    else document.addEventListener('DOMContentLoaded', add)
  }, css)
}

async function shot(page: Page, name: string) {
  mkdirSync(ARTIFACTS, { recursive: true })
  await page.screenshot({ path: path.join(ARTIFACTS, `safe-area-${name}.png`) })
}

async function box(loc: ReturnType<Page['locator']>) {
  await expect(loc).toBeVisible()
  return (await loc.boundingBox())!
}

async function openGalleryLightbox(page: Page) {
  const imgs = lastAssistant(page).getByTestId('tool-group').filter({ hasText: 'generate_images' })
  await expect(imgs.getByTestId('gallery-item')).toHaveCount(5)
  await imgs.getByTestId('gallery-item').first().locator('button').first().click()
  await expect(page.locator('.yarl__root')).toBeVisible()
  await expect(page.locator('.yarl__thumbnails_thumbnail').first()).toBeVisible()
}

for (const [name, cfg] of [['portrait', PORTRAIT], ['landscape', LANDSCAPE]] as const) {
  test.describe(`A18 safe areas (${name})`, () => {
    test.use({ viewport: cfg.viewport })
    const { insets: s, viewport: vp } = cfg

    test.beforeEach(async ({ page, approved }) => {
      void approved
      test.setTimeout(120_000)
      await simulate(page, s)
    })

    test('gallery lightbox controls stay inside the safe area', async ({ page }) => {
      await startReplay(page)
      await waitAssistantDone(page)
      await openGalleryLightbox(page)
      const root = page.locator('.yarl__root')

      const close = await box(root.locator('button[aria-label="Close"]'))
      expect(close.y).toBeGreaterThanOrEqual(s.top)
      expect(close.x).toBeGreaterThanOrEqual(s.left)
      expect(close.x + close.width).toBeLessThanOrEqual(vp.width - s.right)

      const counter = await box(root.locator('.yarl__counter'))
      expect(counter.y).toBeGreaterThanOrEqual(s.top)
      expect(counter.x).toBeGreaterThanOrEqual(s.left)

      for (const label of ['Previous', 'Next']) {
        const nav = root.locator(`button[aria-label="${label}"]`)
        // The first slide has no prev in finite mode; the gallery is not finite, so both exist.
        const b = await box(nav)
        expect(b.x, `${label} left`).toBeGreaterThanOrEqual(s.left)
        expect(b.x + b.width, `${label} right`).toBeLessThanOrEqual(vp.width - s.right)
      }

      const thumbs = root.locator('.yarl__thumbnails_thumbnail')
      const n = await thumbs.count()
      expect(n).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) {
        const b = (await thumbs.nth(i).boundingBox())!
        expect(b.y + b.height, `thumbnail ${i} bottom`).toBeLessThanOrEqual(vp.height - s.bottom)
      }
      // The strip scrolls horizontally, so check its own padding rather than the thumbnails' boxes.
      const pad = await root.locator('.yarl__thumbnails_container').evaluate((e) => {
        const c = getComputedStyle(e)
        return { l: parseFloat(c.paddingLeft), r: parseFloat(c.paddingRight), b: parseFloat(c.paddingBottom) }
      })
      expect(pad.l).toBeGreaterThanOrEqual(s.left)
      expect(pad.r).toBeGreaterThanOrEqual(s.right)
      expect(pad.b).toBeGreaterThanOrEqual(s.bottom)

      // The visible image itself stays inside the insets (and above the thumbnails strip).
      const image = await box(root.locator('.yarl__slide_current img.yarl__slide_image').first())
      expect(image.y).toBeGreaterThanOrEqual(s.top)
      expect(image.x).toBeGreaterThanOrEqual(s.left)
      expect(image.x + image.width).toBeLessThanOrEqual(vp.width - s.right)
      const stripTop = (await root.locator('.yarl__thumbnails_container').boundingBox())!.y
      expect(image.y + image.height).toBeLessThanOrEqual(stripTop + 1)
      await shot(page, `${name}-lightbox`)
    })

    // Portrait video is not discriminating (a 16:9 video is narrow and centred); landscape is.
    test('video lightbox keeps the video clear of the insets', async ({ page }) => {
      await startReplay(page)
      await waitAssistantDone(page)
      const card = lastAssistant(page).getByTestId('video-card').first()
      await card.scrollIntoViewIfNeeded()
      await card.locator('button').first().click()
      const video = page.locator('.yarl__root video').first()
      const b = await box(video)
      expect(b.y).toBeGreaterThanOrEqual(s.top)
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height - s.bottom)
      expect(b.x).toBeGreaterThanOrEqual(s.left)
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width - s.right)
      const close = await box(page.locator('.yarl__root button[aria-label="Close"]'))
      expect(close.y).toBeGreaterThanOrEqual(s.top)
    })
  })
}

test.describe('A18 safe areas (portrait chat)', () => {
  test.use({ viewport: PORTRAIT.viewport })
  const s = PORTRAIT.insets
  const vp = PORTRAIT.viewport

  test('header, composer, drawer and toast respect the insets', async ({ page, approved }) => {
    void approved
    test.setTimeout(120_000)
    await simulate(page, s)
    await startReplay(page)
    await waitAssistantDone(page)

    const burger = await box(page.getByTestId('hamburger'))
    expect(burger.y).toBeGreaterThanOrEqual(s.top)
    const composer = await box(page.getByTestId('composer-input'))
    expect(composer.y + composer.height).toBeLessThanOrEqual(vp.height - s.bottom)
    const send = await box(page.getByTestId('send-button'))
    expect(send.y + send.height).toBeLessThanOrEqual(vp.height - s.bottom)
    await shot(page, 'portrait-chat')

    await page.getByTestId('hamburger').click()
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-open', 'true')
    const newChat = await box(page.getByTestId('new-chat'))
    expect(newChat.y).toBeGreaterThanOrEqual(s.top)
    const brand = await box(page.getByTestId('sidebar').locator('a, h1, span').first())
    expect(brand.y).toBeGreaterThanOrEqual(s.top)
    await page.getByTestId('drawer-backdrop').click({ position: { x: vp.width - 10, y: 300 } })
    await expect(page.getByTestId('sidebar')).toBeHidden()

    // A failing pin shows an error toast; it must clear the home indicator.
    allowConsoleError(page, /500/)
    await page.route(/\/api\/conversations\/[^/]+$/, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'boom' }) })
        : route.fallback())
    await page.getByTestId('hamburger').click()
    const row = page.getByTestId('conv-row').first()
    await row.getByTestId('conv-menu').click()
    await page.getByTestId('conv-pin').click()
    const toast = await box(page.getByTestId('toast').first())
    expect(toast.y + toast.height).toBeLessThanOrEqual(vp.height - s.bottom)
  })
})

test.describe('A18 safe areas (desktop baseline, no insets)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('lightbox keeps yarl defaults and zoom pans to the slide edge', async ({ page, approved }) => {
    void approved
    test.setTimeout(120_000)
    await simulate(page, { top: 0, right: 0, bottom: 0, left: 0 })
    await startReplay(page)
    await waitAssistantDone(page)

    const root = page.locator('.yarl__root')
    const paddings = (sel: string) => root.locator(sel).first().evaluate((e) => {
      const c = getComputedStyle(e)
      return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft]
    })

    await openGalleryLightbox(page)
    expect(await paddings('.yarl__slide_current')).toEqual(['16px', '16px', '16px', '16px'])
    expect(await paddings('.yarl__container')).toEqual(['0px', '0px', '0px', '0px'])
    const close = await box(root.locator('button[aria-label="Close"]'))
    expect(close.y).toBeCloseTo(8, 0)

    // Zoom to the maximum and pan to the bottom-right: the image edge reaches the slide's padding edge.
    const img = root.locator('.yarl__slide_current img.yarl__slide_image').first()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    const zoomIn = root.locator('button[aria-label="Zoom in"]')
    for (let i = 0; i < 12 && (await zoomIn.isEnabled()); i++) await zoomIn.click()
    await page.waitForTimeout(800)
    const slide = (await root.locator('.yarl__slide_current').boundingBox())!
    // Arrow keys pan the zoomed image (right/down moves the view towards the bottom-right corner).
    for (let i = 0; i < 80; i++) await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowDown')
    await page.waitForTimeout(800)
    const zoomed = (await img.boundingBox())!
    const gapRight = slide.x + slide.width - (zoomed.x + zoomed.width)
    const gapBottom = slide.y + slide.height - (zoomed.y + zoomed.height)
    expect(zoomed.width).toBeGreaterThan(slide.width)
    expect(gapRight).toBeGreaterThanOrEqual(15)
    expect(gapRight).toBeLessThanOrEqual(17)
    expect(gapBottom).toBeGreaterThanOrEqual(15)
    expect(gapBottom).toBeLessThanOrEqual(17)
    await page.keyboard.press('Escape')
    await expect(root).toBeHidden()

    const card = lastAssistant(page).getByTestId('video-card').first()
    await card.scrollIntoViewIfNeeded()
    await card.locator('button').first().click()
    await expect(root.locator('video').first()).toBeVisible()
    expect(await paddings('.yarl__slide_current')).toEqual(['16px', '16px', '16px', '16px'])
    expect(await paddings('.yarl__container')).toEqual(['0px', '0px', '0px', '0px'])
  })
})
