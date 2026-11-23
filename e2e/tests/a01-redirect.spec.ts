import { expect, test } from './helpers'

test('A1: logged-out / redirects to /login and shows no app content', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.getByTestId('sidebar')).toHaveCount(0)
  await expect(page.getByTestId('composer-input')).toHaveCount(0)
  await expect(page.getByTestId('model-picker')).toHaveCount(0)
})
