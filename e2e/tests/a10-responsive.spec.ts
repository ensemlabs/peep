import {
  attachShot, expect, lastAssistant, noHorizontalScroll, startReplay, test, waitAssistantDone,
} from './helpers'

test.describe('A10 responsive layout', () => {
  test('login page has no horizontal scroll', async ({ page }, testInfo) => {
    await page.goto('/login')
    await expect(page.locator('#email')).toBeVisible()
    await noHorizontalScroll(page)
    await attachShot(page, testInfo, 'login')
  })

  test('empty chat: no horizontal scroll, drawer below 768px, composer usable', async ({ page, approved }, testInfo) => {
    void approved
    await page.goto('/')
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await noHorizontalScroll(page)
    await attachShot(page, testInfo, 'empty-chat')

    const width = page.viewportSize()!.width
    const sidebar = page.getByTestId('sidebar')
    const hamburger = page.getByTestId('hamburger')
    if (width < 768) {
      await expect(sidebar).toBeHidden()
      await expect(hamburger).toBeVisible()
      await hamburger.click()
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveAttribute('data-open', 'true')
      await attachShot(page, testInfo, 'drawer-open')
      await noHorizontalScroll(page)
      // Backdrop click (outside the 288px drawer) closes it.
      await page.getByTestId('drawer-backdrop').click({ position: { x: width - 10, y: 300 } })
      await expect(sidebar).toBeHidden()
    } else {
      await expect(sidebar).toBeVisible()
      await expect(hamburger).toBeHidden()
    }

    // The composer is on screen and usable.
    const input = page.getByTestId('composer-input')
    await expect(input).toBeInViewport()
    await input.fill('layout check')
    await expect(input).toHaveValue('layout check')
    await expect(page.getByTestId('send-button')).toBeEnabled()
    await expect(page.getByTestId('send-button')).toBeInViewport()
    await noHorizontalScroll(page)
    await attachShot(page, testInfo, 'composer-filled')
  })

  test('finished replay chat: no horizontal scroll, lightbox fits the viewport', async ({ page, approved }, testInfo) => {
    void approved
    test.setTimeout(120_000)
    await startReplay(page)
    await waitAssistantDone(page)
    await noHorizontalScroll(page)
    await attachShot(page, testInfo, 'replay-done')

    const msg = lastAssistant(page)
    const imgs = msg.getByTestId('tool-group').filter({ hasText: 'generate_images' })
    await expect(imgs.getByTestId('gallery-item')).toHaveCount(5)
    await noHorizontalScroll(page)
    await attachShot(page, testInfo, 'replay-gallery-open')

    await imgs.getByTestId('gallery-item').first().locator('button').first().click()
    const lb = page.locator('.yarl__root')
    await expect(lb).toBeVisible()
    const img = lb.locator('.yarl__slide_current img.yarl__slide_image').first()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    const vp = page.viewportSize()!
    const box = (await img.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.y).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1)
    await attachShot(page, testInfo, 'lightbox')
    await noHorizontalScroll(page)
  })
})
