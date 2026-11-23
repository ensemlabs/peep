import { expect, ORIGIN, registerUser, test } from './helpers'

test('A2: new user is pending: banner, click-blocking overlay, API 403, logout works', async ({ page }) => {
  await registerUser(page)

  await expect(page.getByTestId('pending-banner')).toBeVisible()
  await expect(page.getByTestId('pending-overlay')).toBeVisible()
  // The app frame is rendered (sidebar, composer, model picker exist) ...
  for (const id of ['sidebar', 'composer-input', 'new-chat', 'model-picker']) {
    await expect(page.getByTestId(id)).toBeAttached()
  }

  // ... but the overlay owns every point over the composer, the "new chat" button and the model picker.
  for (const id of ['composer-input', 'new-chat', 'model-picker']) {
    const hit = await page.evaluate((testId) => {
      const target = document.querySelector(`[data-testid="${testId}"]`)!
      const overlay = document.querySelector('[data-testid="pending-overlay"]')!
      const r = target.getBoundingClientRect()
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { overlay: !!el && overlay.contains(el), target: !!el && target.contains(el) }
    }, id)
    expect(hit, `elementFromPoint over ${id}`).toEqual({ overlay: true, target: false })
  }

  // A real mouse click on the model picker must not open its menu.
  const box = (await page.getByTestId('model-picker').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('menu')).toHaveCount(0)

  // The API refuses the pending user.
  const res = await page.request.post('/api/conversations', { data: {}, headers: { Origin: ORIGIN } })
  expect(res.status()).toBe(403)
  expect((await res.json()).error.code).toBe('account_pending')

  // "Log out" in the banner is still clickable.
  await page.getByTestId('pending-logout').click()
  await expect(page).toHaveURL(/\/login$/)
})
