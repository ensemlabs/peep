import { expect, lastAssistant, openStep, startReplay, test, waitAssistantDone } from './helpers'

test('A8: replay:agent-demo renders thinking, tool cards, nested sub-agents, gallery, video + audio', async ({ page, approved }) => {
  void approved
  test.setTimeout(120_000)
  await startReplay(page)
  await waitAssistantDone(page)
  const msg = lastAssistant(page)

  // Thinking block.
  await expect(msg.getByTestId('step-thinking')).toHaveCount(1)

  // >= 4 tool cards; one opens/closes and shows its JSON input and JSON output.
  const tools = msg.locator('[data-testid="step-tool"]')
  expect(await tools.count()).toBeGreaterThanOrEqual(4)
  const tests = tools.filter({ hasText: 'run_tests' })
  await expect(tests).toHaveAttribute('data-state', 'closed')
  await openStep(tests)
  const input = tests.locator('[data-testid="code-block"]').first()
  await expect(input.locator('span.font-mono').first()).toHaveText('json')
  await expect(input).toContainText('"command"')
  const output = tests.getByTestId('tool-output')
  await expect(output.locator('span.font-mono').first()).toHaveText('json')
  await expect(output).toContainText('"passed": 7')
  await tests.getByTestId('step-toggle').first().click()
  await expect(tests).toHaveAttribute('data-state', 'closed')

  // Sub-agent (2 levels): contains a tool card and another sub-agent, which contains text.
  const outer = msg.getByTestId('step-subagent').first()
  await openStep(outer)
  await expect(outer.getByTestId('step-tool')).toHaveCount(1)
  const inner = outer.getByTestId('step-subagent')
  await expect(inner).toHaveCount(1)
  await openStep(inner)
  await expect(inner.getByTestId('markdown')).toContainText('Miller-Rabin')

  // Gallery of 5 + lightbox next/thumbnails.
  const imgs = tools.filter({ hasText: 'generate_images' })
  await openStep(imgs)
  const gallery = imgs.getByTestId('gallery')
  await expect(gallery).toHaveAttribute('data-count', '5')
  await expect(gallery.getByTestId('gallery-item')).toHaveCount(5)
  await gallery.getByTestId('gallery-item').first().locator('button').first().click()
  const lb = page.locator('.yarl__root')
  await expect(lb).toBeVisible()
  await expect(lb.locator('.yarl__thumbnails_thumbnail')).toHaveCount(5)
  await expect(lb.locator('.yarl__counter')).toHaveText('1 / 5')
  await lb.getByRole('button', { name: 'Next' }).click()
  await expect(lb.locator('.yarl__counter')).toHaveText('2 / 5')
  await lb.getByRole('button', { name: 'Previous' }).click()
  await expect(lb.locator('.yarl__counter')).toHaveText('1 / 5')
  await page.keyboard.press('Escape')
  await expect(lb).toHaveCount(0)

  // Video and audio live inside tool cards.
  const video = tools.filter({ hasText: 'render_video' })
  await openStep(video)
  await expect(video.getByTestId('video-card').first()).toBeVisible()
  const tts = tools.filter({ hasText: 'text_to_speech' })
  await openStep(tts)
  await expect(tts.getByTestId('audio-card')).toBeVisible()
})
