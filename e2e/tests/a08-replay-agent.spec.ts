import { expect, lastAssistant, openStep, startReplay, test, waitAssistantDone } from './helpers'

test('A8: replay:agent-demo renders thinking, tool cards, nested sub-agents, gallery, video + audio', async ({ page, approved }) => {
  void approved
  test.setTimeout(120_000)
  await startReplay(page)
  await waitAssistantDone(page)
  const msg = lastAssistant(page)

  // Thinking block.
  await expect(msg.getByTestId('step-thinking')).toHaveCount(1)

  // >= 4 tool cards; one opens/closes and shows its JSON input and its output.
  const tools = msg.locator('[data-testid="step-tool"]')
  expect(await tools.count()).toBeGreaterThanOrEqual(4)
  const images = tools.filter({ hasText: 'generate_images' })
  await expect(images).toHaveAttribute('data-state', 'closed')
  await openStep(images)
  const input = images.locator('[data-testid="code-block"]').first()
  await expect(input.locator('span.font-mono').first()).toHaveText('json')
  await expect(input).toContainText('"prompts"')
  await expect(images.getByTestId('tool-output')).toContainText('5 images generated with Gemini')
  await images.getByTestId('step-toggle').first().click()
  await expect(images).toHaveAttribute('data-state', 'closed')

  // Sub-agent (2 levels): contains a tool card and another sub-agent, which contains text.
  const outer = msg.getByTestId('step-subagent').first()
  await openStep(outer)
  await expect(outer.getByTestId('step-tool')).toHaveCount(1)
  const inner = outer.getByTestId('step-subagent')
  await expect(inner).toHaveCount(1)
  await openStep(inner)
  await expect(inner.getByTestId('markdown')).toContainText('See everything your agent does')

  // Results are shown under the tool row (a tool-group), no expanding needed. Gallery of 5 + lightbox next/thumbnails.
  const group = (name: string) => msg.getByTestId('tool-group').filter({ hasText: name })
  const gallery = group('generate_images').getByTestId('gallery')
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

  // Video and audio belong to their tool cards.
  await expect(group('make_clip').getByTestId('video-card').first()).toBeVisible()
  await expect(group('make_chime').getByTestId('audio-card')).toBeVisible()
})
