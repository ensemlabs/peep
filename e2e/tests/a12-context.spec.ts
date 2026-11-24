import type { Page } from '@playwright/test'
import {
  conversationIdFrom, expect, fixturePath, LIVE_LLM_ENABLED, LIVE_MODEL, LIVE_SKIP_MESSAGE, LIVE_TIMEOUT, lastAssistant, REPLAY_MODEL, selectModel, sendPrompt,
  setThinking, startReplay, test, waitAssistantDone,
} from './helpers'

const KEYS = ['system', 'user_messages', 'assistant_messages', 'attachments', 'tool_results', 'skills', 'free']

interface ContextInfo {
  breakdown: { key: string; tokens: number }[]
  last_usage: { source: string; input_tokens: number; output_tokens: number } | null
}

async function getContext(page: Page, conversationId?: string): Promise<ContextInfo> {
  const res = await page.request.get('/api/context', { params: conversationId ? { conversation_id: conversationId } : {} })
  expect(res.status()).toBe(200)
  return res.json()
}
const tokens = (c: ContextInfo, key: string) => c.breakdown.find((b) => b.key === key)?.tokens ?? 0

test.describe('A12 context ring', () => {
  test('after a replay answer: ring, popover rows, estimated badge, cache read/write "—"', async ({ page, approved }) => {
    void approved
    test.setTimeout(120_000)
    await startReplay(page)
    await waitAssistantDone(page)

    const ring = page.getByTestId('context-ring')
    await expect(ring).toBeVisible()
    await expect(ring).toBeEnabled()
    await expect(ring).toHaveAttribute('data-pct', /^\d+$/)

    await ring.hover()
    const pop = page.getByTestId('context-popover')
    await expect(pop).toBeVisible()
    for (const k of KEYS) await expect(pop.locator(`[data-testid="context-legend"] li[data-key="${k}"]`), `row ${k}`).toBeVisible()
    for (const k of ['user_messages', 'assistant_messages']) {
      const nums = await pop.locator(`li[data-key="${k}"] span.tabular-nums`).first().innerText()
      expect(nums, `${k} tokens shown`).not.toBe('0')
    }
    const ctx = await getContext(page, conversationIdFrom(page))
    expect(tokens(ctx, 'user_messages')).toBeGreaterThan(0)
    expect(tokens(ctx, 'assistant_messages')).toBeGreaterThan(0)

    await expect(pop.getByTestId('context-source')).toHaveText(/≈ estimated/)
    const last = pop.getByTestId('context-last')
    await expect(last).toBeVisible()
    for (const label of ['Cache read', 'Cache write']) {
      await expect(last.locator('div', { hasText: new RegExp(`^${label}\\s*—$`) }).first(), `${label} shows "—"`).toBeVisible()
    }
  })

  test('attaching an image raises the attachments row by ~258 tokens', async ({ page, approved }) => {
    void approved
    await page.goto('/')
    await selectModel(page, REPLAY_MODEL)
    const before = tokens(await getContext(page), 'attachments')

    await page.getByTestId('file-input').setInputFiles(fixturePath('sample.png'))
    await expect(page.locator('[data-testid="attachment-chip"][data-status="done"]')).toHaveCount(1)
    await expect.poll(async () => tokens(await getContext(page), 'attachments') - before).toBeGreaterThanOrEqual(250)
    const delta = tokens(await getContext(page), 'attachments') - before
    expect(delta).toBeLessThanOrEqual(270)

    // The popover reflects it too.
    await page.getByTestId('context-ring').hover()
    await expect(page.locator('[data-testid="context-popover"] li[data-key="attachments"] span.tabular-nums').first()).not.toHaveText('0')
  })

  test.describe('@live-llm', () => {
    test.skip(!LIVE_LLM_ENABLED, LIVE_SKIP_MESSAGE)
    test.describe.configure({ retries: 1, timeout: LIVE_TIMEOUT })

    test('A12 @live-llm: usage after a live-model answer is an estimate', async ({ page, approved }) => {
      void approved
      await page.goto('/')
      await selectModel(page, LIVE_MODEL)
      await setThinking(page, 'off')
      await sendPrompt(page, 'Say hello in exactly three words.')
      await expect(lastAssistant(page)).toHaveAttribute('data-status', /complete|error|stopped/, { timeout: LIVE_TIMEOUT - 30_000 })
      await expect(lastAssistant(page), 'Live model run did not complete').toHaveAttribute('data-status', 'complete')
      const ctx = await getContext(page, conversationIdFrom(page))
      expect(ctx.last_usage?.source).toBe('estimate')
      expect(ctx.last_usage!.input_tokens).toBeGreaterThan(0)
      expect(ctx.last_usage!.output_tokens).toBeGreaterThan(0)
      await page.getByTestId('context-ring').hover()
      await expect(page.getByTestId('context-source')).toHaveText(/≈ estimated/)
    })
  })
})
