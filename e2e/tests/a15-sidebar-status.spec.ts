import { randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'
import { ERROR_MODEL, expect, lastAssistant, REPLAY_MODEL, selectModel, sendPrompt, test } from './helpers'

const rand = () => randomBytes(3).toString('hex')
const row = (page: Page, prompt: string) => page.getByTestId('conv-row').filter({ hasText: prompt.slice(0, 60) })

/** Sends `prompt` to a new chat with `model` and waits for the conversation page. */
async function startChat(page: Page, model: string, prompt: string) {
  await page.goto('/')
  await selectModel(page, model)
  await sendPrompt(page, prompt)
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(lastAssistant(page)).toBeVisible()
}

/** A finished replay:error-demo chat (about 3 s). */
async function errorChat(page: Page, prompt: string) {
  await startChat(page, ERROR_MODEL, prompt)
  await expect(lastAssistant(page)).toHaveAttribute('data-status', 'error', { timeout: 30_000 })
}

test.describe('A15 sidebar status', () => {
  test('background chat: streaming spinner, then unread dot + tab title, cleared on open', async ({ page, approved }) => {
    void approved
    test.setTimeout(120_000)
    const a = `chat A ${rand()}`
    await startChat(page, REPLAY_MODEL, a)
    await expect(row(page, a)).toHaveAttribute('data-status', 'streaming')
    await expect(row(page, a).getByTestId('conv-indicator')).toHaveAttribute('data-kind', 'streaming')

    // Chat B (open, so it is read) while A keeps running in the background.
    const b = `chat B ${rand()}`
    await page.getByTestId('new-chat').click()
    await expect(page).toHaveURL(/\/$/)
    await selectModel(page, ERROR_MODEL)
    await sendPrompt(page, b)
    await expect(page).toHaveURL(/\/c\/[^/]+$/)
    await expect(lastAssistant(page)).toHaveAttribute('data-status', 'error', { timeout: 30_000 })
    await expect(row(page, a)).toHaveAttribute('data-status', 'streaming')

    // A finishes: unread dot and "(1)" in the tab title.
    await expect(row(page, a)).toHaveAttribute('data-status', 'complete', { timeout: 60_000 })
    await expect(row(page, a)).toHaveAttribute('data-unread', 'true')
    await expect(row(page, a).getByTestId('conv-indicator')).toHaveAttribute('data-kind', 'unread')
    await expect(page).toHaveTitle(/^\(1\)/)
    await expect(row(page, b)).toHaveAttribute('data-unread', 'false')

    // Opening A marks it read and restores the title.
    await row(page, a).locator('a').click()
    await expect(page).toHaveURL(/\/c\/[^/]+$/)
    await expect(row(page, a)).toHaveAttribute('data-unread', 'false')
    await expect(row(page, a).getByTestId('conv-indicator')).toHaveCount(0)
    await expect(page).not.toHaveTitle(/^\(/)
  })

  test('replay:error-demo in a background chat shows an error + unread', async ({ page, approved }) => {
    void approved
    const c = `chat err ${rand()}`
    await startChat(page, ERROR_MODEL, c)
    await page.getByTestId('new-chat').click() // leave before the ~2 s run ends
    await expect(page).toHaveURL(/\/$/)
    await expect(row(page, c)).toHaveAttribute('data-status', 'error', { timeout: 30_000 })
    await expect(row(page, c)).toHaveAttribute('data-unread', 'true')
    await expect(row(page, c).getByTestId('conv-indicator')).toHaveAttribute('data-kind', 'error')
  })

  test('stopping a run (button and Esc) gives "stopped" with no indicator', async ({ page, approved }) => {
    void approved
    test.setTimeout(90_000)
    const viaButton = `stop button ${rand()}`
    await startChat(page, REPLAY_MODEL, viaButton)
    await page.getByTestId('stop-button').click()
    await expect(row(page, viaButton)).toHaveAttribute('data-status', 'stopped')
    await expect(row(page, viaButton).getByTestId('conv-indicator')).toHaveCount(0)

    const viaEsc = `stop esc ${rand()}`
    await startChat(page, REPLAY_MODEL, viaEsc)
    await expect(page.getByTestId('stop-button')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(row(page, viaEsc)).toHaveAttribute('data-status', 'stopped')
    await expect(row(page, viaEsc).getByTestId('conv-indicator')).toHaveCount(0)
  })

  test('search matches message content and returns exactly that chat', async ({ page, approved }) => {
    void approved
    const word = `zebraquartz${rand()}`
    const withWord = `Tell me about the following unusual subject at some considerable length: ${word}`
    const other = `Something else entirely ${rand()}`
    await errorChat(page, other)
    await errorChat(page, withWord)
    await expect(page.getByTestId('conv-row')).toHaveCount(2)
    expect(withWord.indexOf(word), 'word must not be inside the 60-char title').toBeGreaterThan(60)

    await page.getByTestId('sidebar-search').fill(word)
    await expect(page.getByTestId('conv-row')).toHaveCount(1)
    await expect(page.getByTestId('conv-row')).toContainText(withWord.slice(0, 40))

    await page.getByTestId('sidebar-search').fill('')
    await expect(page.getByTestId('conv-row')).toHaveCount(2)
  })

  test('pinning moves the chat to the Pinned group at the top', async ({ page, approved }) => {
    void approved
    const older = `older chat ${rand()}`
    const newer = `newer chat ${rand()}`
    await errorChat(page, older)
    await errorChat(page, newer)
    const rows = page.getByTestId('conv-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText(newer) // newest first
    await expect(rows.first()).toHaveAttribute('data-pinned', 'false')

    const target = row(page, older)
    await target.hover()
    await target.getByTestId('conv-menu').click()
    await page.getByTestId('conv-pin').click()

    await expect(target).toHaveAttribute('data-pinned', 'true')
    await expect(page.getByTestId('group-pinned').getByTestId('conv-row')).toHaveCount(1)
    await expect(page.getByTestId('group-pinned')).toContainText(older.slice(0, 20))
    await expect(rows.first()).toContainText(older)
  })
})
