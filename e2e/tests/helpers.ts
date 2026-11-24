import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  test as base,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

export { expect }

export const BASE_URL = process.env.BASE_URL ?? 'http://peep:8000'
/** Sent on every API request: the API rejects state-changing requests whose Origin is not in APP_ORIGINS. */
export const ORIGIN = new URL(BASE_URL).origin
export const PASSWORD = 'E2e-Passw0rd-42!'
export const REPLAY_MODEL = 'replay:agent-demo'
export const LIVE_TIMEOUT = 4 * 60_000
/** Live-model specs (tag @live-llm) need an OpenAI-compatible endpoint: E2E_LLM_BASE_URL (+ E2E_LLM_API_KEY, E2E_LLM_MODEL). */
export const LIVE_LLM_ENABLED = Boolean(process.env.E2E_LLM_BASE_URL)
export const LIVE_SKIP_MESSAGE = 'live-model spec skipped: set E2E_LLM_BASE_URL (and E2E_LLM_API_KEY, E2E_LLM_MODEL) to run it'

export const fixturePath = (name: string) => path.join(__dirname, '..', 'fixtures', name)
export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')
export const fixtureSha = (name: string) => sha256(readFileSync(fixturePath(name)))

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`
}

// ---------------------------------------------------------------- console / layout guards

export interface ConsoleWatch {
  errors: string[]
  /** Patterns of console errors that the test provokes on purpose (e.g. the browser's log of an expected 422). */
  allowed: RegExp[]
  assertClean(): void
}

/** 401 on /api/auth/me is expected on logged-out pages (WebKit reports it as an access-control pageerror). */
function isExpected(text: string, url: string): boolean {
  const hay = `${text} ${url}`
  return hay.includes('/api/auth/me') && /401|access control/i.test(hay)
}

const watches = new WeakMap<Page, ConsoleWatch>()

/** Declares that this test deliberately triggers console errors matching `pattern` (checked against text + URL). */
export function allowConsoleError(page: Page, pattern: RegExp) {
  watches.get(page)?.allowed.push(pattern)
}

export function watchConsole(page: Page): ConsoleWatch {
  const errors: string[] = []
  const allowed: RegExp[] = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (isExpected(m.text(), m.location().url)) return
    if (allowed.some((re) => re.test(`${m.text()} ${m.location().url}`))) return
    errors.push(`console.error: ${m.text()} (${m.location().url})`)
  })
  page.on('pageerror', (e) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (isExpected(msg, '')) return
    errors.push(`pageerror: ${msg}`)
  })
  const watch: ConsoleWatch = {
    errors,
    allowed,
    assertClean() {
      expect(errors, 'unexpected console errors / page errors (incl. CSP violations)').toEqual([])
    },
  }
  watches.set(page, watch)
  return watch
}

export async function noHorizontalScroll(page: Page) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(m.sw, `scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw)
}

export async function attachShot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
}

// ---------------------------------------------------------------- API helpers

export function newApi(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: ORIGIN } })
}

/** Logs the admin in (credentials come from the ADMIN_EMAIL / ADMIN_PASSWORD env, never printed). */
export async function loginAdmin(): Promise<APIRequestContext> {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) throw new Error('ADMIN_EMAIL / ADMIN_PASSWORD are not set in the e2e container')
  const api = await newApi()
  const res = await api.post('/api/auth/login', { data: { email, password } })
  expect(res.status(), 'admin login').toBe(200)
  return api
}

export async function approveUser(admin: APIRequestContext, email: string) {
  const list = await admin.get('/api/admin/users', { params: { q: email } })
  expect(list.status()).toBe(200)
  const user = (await list.json()).items.find((u: { email: string }) => u.email === email)
  expect(user, `user ${email} not found by admin`).toBeTruthy()
  const res = await admin.patch(`/api/admin/users/${user.id}`, { data: { status: 'active' } })
  expect(res.status(), 'approve').toBe(200)
}

export interface TestUser {
  email: string
  password: string
  /** Request context holding the user's session cookie. */
  api: APIRequestContext
}

/** Registers through the API (user is pending, session cookie kept in `api`). */
export async function registerViaApi(): Promise<TestUser> {
  const api = await newApi()
  const email = uniqueEmail()
  const res = await api.post('/api/auth/register', { data: { email, password: PASSWORD, display_name: 'E2E User' } })
  expect(res.status(), 'register').toBe(201)
  return { email, password: PASSWORD, api }
}

/** Registers through the UI form (A2/A4). Leaves the page on the (pending) app. */
export async function registerUser(page: Page): Promise<{ email: string; password: string }> {
  const email = uniqueEmail()
  await page.goto('/register')
  await page.locator('#name').fill('E2E User')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('sidebar')).toBeAttached()
  return { email, password: PASSWORD }
}

export async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByTestId('sidebar')).toBeAttached()
}

/** A fresh browser context configured like the current project (viewport, device, locale...). */
export async function newContextLike(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale } = testInfo.project.use
  return browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale })
}

// ---------------------------------------------------------------- fixtures

interface Fixtures {
  /** Admin session (API). */
  admin: APIRequestContext
  /** An approved user whose session cookie is already installed in the test's browser context (no UI login). */
  approved: TestUser
}

export const test = base.extend<Fixtures>({
  // Every page fails its test on unexpected console errors / page errors.
  page: async ({ page }, use, testInfo) => {
    const watch = watchConsole(page)
    await use(page)
    if (testInfo.status === testInfo.expectedStatus) watch.assertClean()
  },
  admin: async ({}, use) => {
    const admin = await loginAdmin()
    await use(admin)
    await admin.dispose()
  },
  approved: async ({ admin, context }, use) => {
    const user = await registerViaApi()
    await approveUser(admin, user.email)
    await context.addCookies((await user.api.storageState()).cookies)
    await use(user)
    await user.api.dispose()
  },
})

// ---------------------------------------------------------------- chat UI helpers

/** Desktop: compact picker in the composer toolbar. Phones (< 768px): inside the drawer (open the hamburger first). */
export async function selectModel(page: Page, id: string) {
  const picker = page.getByTestId('model-picker')
  const drawer = (page.viewportSize()?.width ?? 1280) < 768
  if (drawer) await page.getByTestId('hamburger').click()
  await picker.click()
  await page.getByTestId(`model-option-${id}`).click()
  if (drawer) {
    await page.getByTestId('drawer-backdrop').click({ position: { x: page.viewportSize()!.width - 10, y: 300 } })
    await expect(page.getByTestId('sidebar')).toBeHidden()
  }
}

/** Picks a thinking level in the composer's "reasoning-level" dropdown (model must support levels). */
export async function setThinking(page: Page, level: string) {
  const trigger = page.getByTestId('reasoning-level')
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute('data-value')) !== level) {
    await trigger.click()
    await page.locator(`[data-testid="reasoning-option"][data-value="${level}"]`).click()
  }
  await expect(trigger).toHaveAttribute('data-value', level)
}

export async function sendPrompt(page: Page, text: string) {
  const input = page.getByTestId('composer-input')
  await input.fill(text)
  await page.getByTestId('send-button').click()
}

export function conversationIdFrom(page: Page): string {
  const m = new URL(page.url()).pathname.match(/^\/c\/([^/]+)/)
  if (!m) throw new Error(`not on a conversation page: ${page.url()}`)
  return m[1]
}

/** Model id the e2e registry (e2e/config/models.e2e.yaml) exposes for the live endpoint. */
export const LIVE_MODEL = process.env.E2E_LLM_MODEL || 'live-llm'
export const ERROR_MODEL = 'replay:error-demo'

export const lastAssistant = (page: Page): Locator => page.getByTestId('message-assistant').last()

/** Starts a replay:agent-demo turn from the empty chat; returns the unique prompt used. */
export async function startReplay(page: Page): Promise<string> {
  const prompt = `agent demo ${randomBytes(3).toString('hex')}`
  await page.goto('/')
  await selectModel(page, REPLAY_MODEL)
  await sendPrompt(page, prompt)
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(lastAssistant(page)).toBeVisible()
  return prompt
}

export async function waitAssistantDone(page: Page, timeout = 90_000) {
  await expect(lastAssistant(page)).toHaveAttribute('data-status', /complete|error|stopped/, { timeout })
  await expect(lastAssistant(page), 'assistant message should complete').toHaveAttribute('data-status', 'complete')
}

/** Opens a collapsible step (idempotent). */
export async function openStep(step: Locator) {
  if ((await step.getAttribute('data-state')) !== 'open') await step.getByTestId('step-toggle').first().click()
  await expect(step).toHaveAttribute('data-state', 'open')
}

export async function fetchConversation(page: Page, id = conversationIdFrom(page)) {
  const res = await page.request.get(`/api/conversations/${id}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    conversation: { id: string; title: string }
    messages: { role: string; parts: Part[]; attachments: FileMeta[] }[]
  }
}

export interface FileMeta {
  id: string
  kind: string
  mime: string
  filename: string
  size: number
  width?: number
  height?: number
  url: string
  download_url: string
}
export interface Part {
  type: string
  files?: FileMeta[]
  parts?: Part[]
}

export function flattenParts(parts: Part[]): Part[] {
  return parts.flatMap((p) => [p, ...(p.parts ? flattenParts(p.parts) : [])])
}
