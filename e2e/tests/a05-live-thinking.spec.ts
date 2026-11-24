import {
  expect, LIVE_LLM_ENABLED, LIVE_MODEL, LIVE_SKIP_MESSAGE, LIVE_TIMEOUT, lastAssistant, selectModel, sendPrompt, setThinking, test,
} from './helpers'

// Some live models intermittently return no thinking text even with reasoning_effort=high, so this spec gets extra retries.
test.skip(!LIVE_LLM_ENABLED, LIVE_SKIP_MESSAGE)
test.describe.configure({ retries: 2, timeout: LIVE_TIMEOUT })

const PROMPT = 'Write a Python function is_prime(n) in a code block, then explain it in one sentence.'

test('A5 @live-llm: live thinking block, collapse to "Thought for Ns", toggle, python code block + copy', async ({ page, approved }) => {
  void approved
  await page.goto('/')
  await selectModel(page, LIVE_MODEL)
  await setThinking(page, 'high')

  // Record (from inside the page, so it cannot be missed) whether the thinking step was ever open and live
  // (shimmering label + non-empty text) while the assistant message was still streaming.
  await page.evaluate(() => {
    const w = window as unknown as { __live: { text: number } | null }
    w.__live = null
    const check = () => {
      const step = document.querySelector('[data-testid="step-thinking"]')
      if (!step) return
      const streaming = !!document.querySelector('[data-testid="message-assistant"][data-status="streaming"]')
      const open = step.getAttribute('data-state') === 'open'
      const shimmer = step.querySelector('[data-testid="thinking-label"]')?.getAttribute('data-shimmer') === 'true'
      const text = step.querySelector('[data-testid="thinking-text"]')?.textContent?.trim() ?? ''
      if (streaming && open && shimmer && text.length > 0) w.__live = { text: text.length }
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  })

  await sendPrompt(page, PROMPT)
  const msg = lastAssistant(page)
  await expect(msg).toBeVisible()

  // Before the first content: the pending Pip is shown (visibility strict, animation soft: the window can be short).
  const pending = page.getByTestId('reply-pending')
  await expect(pending).toBeVisible()
  await expect(pending.getByTestId('mascot')).toBeVisible()
  // Any element of the mascot svg must animate (works for any mascot design).
  const animated = await pending
    .locator('[data-testid="mascot"]')
    .evaluate((m) => [m, ...m.querySelectorAll('*')].some((el) => getComputedStyle(el).animationName !== 'none'))
    .catch(() => false)
  expect.soft(animated, 'pending mascot animates (soft)').toBe(true)
  await expect(msg).toHaveAttribute('data-status', /complete|error|stopped/, { timeout: LIVE_TIMEOUT - 30_000 })
  await expect(msg, 'Live model run did not complete (refusal / upstream error?)').toHaveAttribute('data-status', 'complete')

  await expect(page.getByTestId('reply-pending'), 'pending Pip is gone once content arrived').toHaveCount(0)
  const step = msg.getByTestId('step-thinking')
  expect(await step.count(), 'The live model produced no thinking part on this run (retry should cover it)').toBeGreaterThan(0)
  const live = await page.evaluate(() => (window as unknown as { __live: { text: number } | null }).__live)
  expect(live, 'thinking step was never open + live (shimmering label, non-empty text) while streaming').not.toBeNull()

  // Finished: collapsed, header "Thought for Ns".
  await expect(step).toHaveAttribute('data-state', 'closed')
  await expect(step.getByTestId('step-toggle')).toHaveText(/Thought for (\d+m )?\d+s|Đã suy nghĩ (\d+ phút )?\d+ giây/)
  await step.getByTestId('step-toggle').click()
  await expect(step).toHaveAttribute('data-state', 'open')
  await expect(step.getByTestId('thinking-text')).not.toBeEmpty()
  await step.getByTestId('step-toggle').click()
  await expect(step).toHaveAttribute('data-state', 'closed')

  // Answer: a highlighted python code block + working Copy.
  const block = msg.getByTestId('code-block').first()
  await expect(block).toBeVisible()
  await expect(block.locator('span.font-mono').first()).toHaveText(/^python$/i)
  await expect(block.locator('pre span[style]').first(), 'syntax highlighting spans').toBeAttached()
  await block.getByTestId('copy-code').click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { message: 'clipboard content' })
    .toContain('def is_prime')
})
