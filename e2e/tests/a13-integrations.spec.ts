import { allowConsoleError, expect, fixturePath, test } from './helpers'

const SECRET = 'test-secret-123'
const skillFile = (name: string) => fixturePath(`skills/${name}`)
const MASK = '••••••••'

test.describe('A13 skills', () => {
  test('upload SKILL.md, toggle, view rendered content, delete', async ({ page, approved }) => {
    void approved
    await page.goto('/settings/integrations')
    await page.getByTestId('skills-upload').setInputFiles(skillFile('SKILL.md'))
    const row = page.locator('[data-testid="skill-row"][data-name="e2e-greeter"]')
    await expect(row).toBeVisible()

    // Toggle enabled (persisted across reload).
    const toggle = row.getByTestId('skill-toggle')
    const initial = await toggle.getAttribute('aria-checked')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')
    await page.reload()
    await expect(row.getByTestId('skill-toggle')).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true')

    // View: rendered markdown (heading + code block), frontmatter stripped.
    await row.getByTestId('skill-view').click()
    const dialog = page.getByTestId('skill-view-dialog')
    await expect(dialog.getByRole('heading', { name: 'E2E Greeter' })).toBeVisible()
    await expect(dialog.getByTestId('code-block')).toContainText('hello from the e2e skill')
    await expect(dialog).not.toContainText('description:')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Delete.
    await row.getByTestId('skill-delete').click()
    await page.getByTestId('skill-confirm-delete').click()
    await expect(row).toHaveCount(0)
  })

  test('zip with ../ path is rejected with a translated error', async ({ page, approved }) => {
    void approved
    allowConsoleError(page, /422.*\/api\/skills/)
    await page.goto('/settings/integrations')
    const invalid = page.waitForResponse((r) => r.url().endsWith('/api/skills') && r.request().method() === 'POST')
    await page.getByTestId('skills-upload').setInputFiles(skillFile('evil.zip'))
    expect((await invalid).status()).toBe(422)
    const err = page.getByTestId('skills-error')
    await expect(err).toContainText('This is not a valid skill')
    await expect(err).not.toContainText('invalid_skill') // translated, not the raw code
    await expect(page.getByTestId('skill-row')).toHaveCount(0)
    await expect(page.getByTestId('skills-replace')).toHaveCount(0)
  })

  test('duplicate name offers Replace', async ({ page, approved }) => {
    void approved
    allowConsoleError(page, /409.*\/api\/skills/)
    await page.goto('/settings/integrations')
    await page.getByTestId('skills-upload').setInputFiles(skillFile('SKILL.md'))
    await expect(page.locator('[data-testid="skill-row"][data-name="e2e-greeter"]')).toBeVisible()

    await page.getByTestId('skills-upload').setInputFiles(skillFile('SKILL.v2.md'))
    await expect(page.getByTestId('skills-error')).toContainText('already exists')
    await page.getByTestId('skills-replace').click()
    await expect(page.getByTestId('skills-error')).toHaveCount(0)
    await expect(page.getByTestId('skill-row')).toHaveCount(1)
    await expect(page.locator('[data-testid="skill-row"][data-name="e2e-greeter"]')).toContainText('Second version')
  })
})

test.describe('A13 plugins', () => {
  test('header value is masked everywhere; editing without retyping keeps it', async ({ page, approved }) => {
    void approved
    await page.goto('/settings/integrations')
    await page.getByTestId('plugin-add').click()
    await page.locator('#pl-name').fill('e2e-plugin')
    await page.locator('#pl-url').fill('https://mcp.example.com/mcp')
    await page.getByTestId('plugin-add-header').click()
    await page.getByRole('textbox', { name: 'Header name' }).fill('Authorization')
    await page.getByTestId('header-value').fill(`Bearer ${SECRET}`)
    await page.getByTestId('plugin-save').click()

    const row = page.locator('[data-testid="plugin-row"][data-name="e2e-plugin"]')
    await expect(row).toBeVisible()
    await expect(row.getByTestId('plugin-headers')).toContainText(`Authorization: ${MASK}`)
    expect(await page.content(), 'secret in DOM after save').not.toContain(SECRET)

    await page.reload()
    await expect(row.getByTestId('plugin-headers')).toContainText(MASK)
    expect(await page.content(), 'secret in DOM after reload').not.toContain(SECRET)
    const list = await page.request.get('/api/plugins')
    expect(await list.text(), 'secret in GET /api/plugins').not.toContain(SECRET)

    // Edit without retyping the header value: the stored value is kept.
    await row.getByTestId('plugin-edit').click()
    await page.locator('#pl-desc').fill('edited description')
    const patched = page.waitForResponse((r) => /\/api\/plugins\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
    await page.getByTestId('plugin-save').click()
    const res = await patched
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).not.toContain(SECRET)
    const plugin = JSON.parse(body).plugin ?? JSON.parse(body)
    expect(plugin.headers).toHaveLength(1)
    expect(plugin.headers[0].name).toBe('Authorization')
    expect(plugin.headers[0].value_masked).toContain(MASK)
    await expect(row.getByTestId('plugin-headers')).toContainText(`Authorization: ${MASK}`)
    await expect(row).toContainText('e2e-plugin')
    // The secret plaintext was never sent back to the page.
    expect(await page.content()).not.toContain(SECRET)
  })

  test('import .mcp.json with 2 servers, then delete one', async ({ page, approved }) => {
    void approved
    await page.goto('/settings/integrations')
    await page.getByTestId('plugin-import').setInputFiles(skillFile('two-servers.mcp.json'))
    await expect(page.getByTestId('plugin-import-result')).toContainText('2 created')
    await expect(page.getByTestId('plugin-row')).toHaveCount(2)
    await expect(page.locator('[data-testid="plugin-row"][data-name="e2e-docs"]')).toBeVisible()
    expect(await page.content()).not.toContain('import-secret-456')

    const row = page.locator('[data-testid="plugin-row"][data-name="e2e-search"]')
    await row.getByTestId('plugin-delete').click()
    await page.getByTestId('plugin-confirm-delete').click()
    await expect(row).toHaveCount(0)
    await expect(page.getByTestId('plugin-row')).toHaveCount(1)
  })
})
