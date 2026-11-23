import {
  expect, loginViaUi, lastAssistant, newContextLike, registerUser, REPLAY_MODEL, selectModel, sendPrompt, test, watchConsole,
} from './helpers'

test('A4: admin finds the pending user, approves; the pending user is unlocked and can chat', async ({ page, browser }, testInfo) => {
  const { email } = await registerUser(page)
  await expect(page.getByTestId('pending-overlay')).toBeVisible()

  const adminCtx = await newContextLike(browser, testInfo)
  const adminPage = await adminCtx.newPage()
  const watch = watchConsole(adminPage)
  try {
    await loginViaUi(adminPage, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)
    await adminPage.goto('/admin/users')
    await adminPage.getByTestId('admin-search').fill(email)
    const row = adminPage.locator(`[data-testid="user-row"][data-email="${email}"]`)
    await expect(row).toBeVisible()
    await expect(adminPage.getByTestId('user-row')).toHaveCount(1)
    await row.getByTestId('approve-btn').click()
    await expect(row.getByTestId('approve-btn')).toHaveCount(0)
    watch.assertClean()
  } finally {
    await adminCtx.close()
  }

  // The pending user's page: "check again" removes the overlay and the banner.
  await page.getByTestId('pending-check').click()
  await expect(page.getByTestId('pending-overlay')).toHaveCount(0)
  await expect(page.getByTestId('pending-banner')).toHaveCount(0)

  // Creating a chat works: through the API and through the UI.
  const res = await page.request.post('/api/conversations', { data: {}, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status()).toBe(201)
  await selectModel(page, REPLAY_MODEL)
  await sendPrompt(page, `approved ${Date.now()}`)
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(lastAssistant(page)).toBeVisible()

  // A reload keeps it unlocked.
  await page.reload()
  await expect(page.getByTestId('pending-overlay')).toHaveCount(0)
  await expect(page.getByTestId('composer-input')).toBeEnabled()
})
