import type { Page } from '@playwright/test'
import {
  expect, lastAssistant, loginViaUi, newContextLike, noHorizontalScroll, PASSWORD, registerViaApi, REPLAY_MODEL,
  selectModel, sendPrompt, test, uniqueEmail, waitAssistantDone,
} from './helpers'

const row = (page: Page, email: string) => page.locator(`[data-testid="user-row"][data-email="${email}"]`)

async function openAdmin(page: Page) {
  await loginViaUi(page, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)
  await page.goto('/admin/users')
  await expect(page.getByTestId('user-row').first()).toBeVisible()
}

async function search(page: Page, q: string) {
  await page.getByTestId('admin-search').fill(q)
  await expect(page.getByTestId('user-row')).not.toHaveCount(0)
}

test('A17: admin creates an account, bulk-approves, reads the audit log and sets a token limit that blocks sending', async ({
  page, browser,
}, testInfo) => {
  test.setTimeout(180_000)
  const adminCtx = await newContextLike(browser, testInfo)
  const admin = await adminCtx.newPage()
  try {
    await openAdmin(admin)

    // 1. Create an account: it is active straight away.
    const created = uniqueEmail()
    await admin.getByTestId('create-user-btn').click()
    const dialog = admin.getByTestId('create-user-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('#new-email').fill(created)
    await dialog.locator('#new-name').fill('Created By Admin')
    await dialog.locator('#new-password').fill(PASSWORD)
    await admin.getByTestId('create-user-submit').click() // in the dialog footer, outside the form
    await expect(dialog).toHaveCount(0)
    await search(admin, created)
    await expect(row(admin, created)).toBeVisible()
    await expect(row(admin, created).getByTestId('approve-btn')).toHaveCount(0)

    // 2. Bulk-approve two pending users.
    const p1 = await registerViaApi()
    const p2 = await registerViaApi()
    // Selection resets when the filter changes, so select both on one unfiltered pending list (newest first).
    await admin.getByTestId('admin-search').fill('')
    await admin.getByTestId('tab-pending').click()
    for (const u of [p1, p2]) await row(admin, u.email).getByTestId('row-check').check()
    await expect(admin.getByTestId('bulk-bar')).toBeVisible()
    await admin.getByTestId('bulk-approve').click()
    await expect(admin.getByTestId('bulk-result')).toBeVisible()
    for (const u of [p1, p2]) expect((await (await u.api.get('/api/auth/me')).json()).user.status).toBe('active')
    await Promise.all([p1.api.dispose(), p2.api.dispose()])

    // 3. Audit log: the creation and the bulk approval are recorded.
    await admin.getByTestId('tab-audit').click()
    await admin.getByTestId('audit-search').fill(created)
    await expect(admin.locator(`[data-testid="audit-row"][data-action="user.create"][data-target="${created}"]`)).toHaveCount(1)
    await admin.getByTestId('audit-search').fill(p1.email)
    await expect(admin.locator(`[data-testid="audit-row"][data-action="user.status"][data-target="${p1.email}"]`)).toHaveCount(1)

    // 4. The created user logs in and chats (usage is recorded) ...
    await loginViaUi(page, created, PASSWORD)
    await page.goto('/')
    await selectModel(page, REPLAY_MODEL)
    await sendPrompt(page, `quota ${Date.now()}`)
    await expect(page).toHaveURL(/\/c\/[^/]+$/)
    await waitAssistantDone(page)
    await expect(lastAssistant(page)).toBeVisible()

    // ... then the admin sets a 1-token daily limit.
    await admin.getByTestId('tab-users').click()
    await admin.getByTestId('tab-all').click()
    await search(admin, created)
    await row(admin, created).getByTestId('row-menu').click()
    await admin.getByTestId('quota-btn').click()
    const quota = admin.getByTestId('quota-dialog')
    await quota.getByTestId('quota-limited').click()
    await quota.getByTestId('quota-limit-input').fill('1')
    await quota.getByTestId('quota-period-day').click()
    await admin.getByTestId('quota-save').click()
    await expect(quota).toHaveCount(0)
    await expect(row(admin, created).getByTestId('tokens-cell')).toContainText(/\/\s*1(?!\d)/)
    await admin.getByTestId('tab-audit').click()
    await admin.getByTestId('audit-search').fill(created)
    await expect(admin.locator(`[data-testid="audit-row"][data-action="user.quota"]`)).toHaveCount(1)
  } finally {
    await adminCtx.close()
  }

  // 5. The user is blocked: banner, disabled send, usage in the account menu, 429 from the API.
  await page.goto('/')
  await expect(page.getByTestId('quota-banner')).toBeVisible()
  await page.getByTestId('composer-input').fill('one more')
  await expect(page.getByTestId('send-button')).toBeDisabled()
  await page.getByTestId('user-menu').click()
  await expect(page.getByTestId('quota-usage')).toBeVisible()
  await page.keyboard.press('Escape')
  const origin = new URL(page.url()).origin
  const conv = await page.request.post('/api/conversations', { data: {}, headers: { Origin: origin } })
  expect(conv.status()).toBe(201)
  const res = await page.request.post(`/api/conversations/${(await conv.json()).conversation.id}/messages`, {
    data: { content: 'blocked?', model: REPLAY_MODEL },
    headers: { Origin: origin },
  })
  expect(res.status()).toBe(429)
  expect((await res.json()).error.code).toBe('quota_exceeded')
})

test('A17m: admin pages fit a phone screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  try {
    await openAdmin(page)
    await noHorizontalScroll(page)
    await page.getByTestId('row-check').first().check()
    await expect(page.getByTestId('bulk-bar')).toBeVisible()
    await noHorizontalScroll(page)
    await page.getByTestId('create-user-btn').click()
    await expect(page.getByTestId('create-user-dialog')).toBeInViewport()
    await page.keyboard.press('Escape')
    await page.getByTestId('tab-audit').click()
    await expect(page.getByTestId('audit-row').first()).toBeVisible()
    await noHorizontalScroll(page)
  } finally {
    await ctx.close()
  }
})
