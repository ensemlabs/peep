import {
  expect, GEMINI_TIMEOUT, lastAssistant, selectModel, sendPrompt, setThinking, test,
} from './helpers'

test.describe.configure({ retries: 1, timeout: GEMINI_TIMEOUT })

const PROMPT = 'Write a Python function is_prime(n) in a code block, then explain it in one sentence.'

test('A5 @gemini: live thinking block, collapse to "Thought for Ns", toggle, python code block + copy', async ({ page, approved }) => {
  void approved
  await page.goto('/')
  await selectModel(page, 'gemini-pro')
  await setThinking(page, 'high')

  // Record (from inside the page, so it cannot be missed) whether the thinking step was ever open and live
  // (mascot thinking + non-empty text) while the assistant message was still streaming.
  await page.evaluate(() => {
    const w = window as unknown as { __live: { text: number } | null }
    w.__live = null
    const check = () => {
      const step = document.querySelector('[data-testid="step-thinking"]')
      if (!step) return
      const streaming = !!document.querySelector('[data-testid="message-assistant"][data-status="streaming"]')
      const open = step.getAttribute('data-state') === 'open'
      const mascot = step.querySelector('[data-testid="mascot"]')?.getAttribute('data-state')
      const text = step.querySelector('[data-testid="thinking-text"]')?.textContent?.trim() ?? ''
      if (streaming && open && mascot === 'thinking' && text.length > 0) w.__live = { text: text.length }
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  })

  await sendPrompt(page, PROMPT)
  const msg = lastAssistant(page)
  await expect(msg).toBeVisible()
  await expect(msg).toHaveAttribute('data-status', /complete|error|stopped/, { timeout: GEMINI_TIMEOUT - 30_000 })
  await expect(msg, 'Gemini run did not complete (refusal / upstream error?)').toHaveAttribute('data-status', 'complete')

  const step = msg.getByTestId('step-thinking')
  expect(await step.count(), 'Gemini produced no thinking part on this run (retry should cover it)').toBeGreaterThan(0)
  const live = await page.evaluate(() => (window as unknown as { __live: { text: number } | null }).__live)
  expect(live, 'thinking step was never open + live (mascot=thinking, non-empty text) while streaming').not.toBeNull()

  // Finished: collapsed, header "Thought for Ns".
  await expect(step).toHaveAttribute('data-state', 'closed')
  await expect(step.getByTestId('step-toggle')).toHaveText(/Thought for \d+s|Đã suy nghĩ \d+ giây/)
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
