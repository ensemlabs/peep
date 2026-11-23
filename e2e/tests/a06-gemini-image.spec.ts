import {
  expect, fetchConversation, flattenParts, GEMINI_TIMEOUT, lastAssistant, selectModel, sendPrompt, sha256, test,
  conversationIdFrom, setThinking,
} from './helpers'

test.describe.configure({ retries: 1, timeout: GEMINI_TIMEOUT })

test('A6 @gemini: generated image in a gallery, no base64 in DOM, lightbox at original size, download == content', async ({ page, approved }) => {
  void approved
  await page.goto('/')
  await selectModel(page, 'gemini-pro')
  await setThinking(page, 'off')
  await sendPrompt(page, 'Generate an image of a red apple on a white table.')

  const msg = lastAssistant(page)
  await expect(msg).toHaveAttribute('data-status', /complete|error|stopped/, { timeout: GEMINI_TIMEOUT - 30_000 })
  await expect(msg, 'Gemini run did not complete').toHaveAttribute('data-status', 'complete')
  const gallery = msg.getByTestId('gallery')
  expect(await gallery.count(), 'no image returned (Gemini refusal / text-only answer?): ' + (await msg.innerText()).slice(0, 300)).toBeGreaterThan(0)
  await expect(gallery.first()).toBeVisible()
  const item = gallery.first().getByTestId('gallery-item').first()
  await expect(item.locator('img')).toBeVisible()

  // No base64 anywhere in the document.
  const html = await page.content()
  expect(html).not.toContain('data:image')
  expect(html).not.toContain('base64,')

  // Original file facts from the API.
  const conv = await fetchConversation(page, conversationIdFrom(page))
  const assistant = conv.messages.filter((m) => m.role === 'assistant').at(-1)!
  const file = flattenParts(assistant.parts).flatMap((p) => p.files ?? []).find((f) => f.kind === 'image')!
  expect(file, 'image FileMeta in the stored message').toBeTruthy()
  expect(file.width).toBeGreaterThan(0)

  // Download link == /content bytes (a real browser download).
  await item.hover()
  const [download] = await Promise.all([page.waitForEvent('download'), item.getByTestId('download').click()])
  const chunks: Buffer[] = []
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer)
  const downloaded = Buffer.concat(chunks)
  const content = await page.request.get(file.url)
  expect(content.status()).toBe(200)
  expect(sha256(downloaded)).toBe(sha256(await content.body()))

  // Lightbox: zoom control, image at original resolution (not the thumbnail).
  await item.locator('button').first().click()
  const lb = page.locator('.yarl__root')
  await expect(lb).toBeVisible()
  await expect(lb.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  const img = lb.locator('.yarl__slide_current img.yarl__slide_image').first()
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
  const nat = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight }))
  expect(nat).toEqual({ w: file.width, h: file.height })
})
