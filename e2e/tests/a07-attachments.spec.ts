import { readFileSync, statSync } from 'node:fs'
import {
  expect, fixturePath, fixtureSha, REPLAY_MODEL, selectModel, sendPrompt, sha256, test,
} from './helpers'
import type { Locator, Page } from '@playwright/test'

const FILES = ['sample.png', 'sample.webm', 'sample.mp3', 'sample.py']

async function downloadSha(page: Page, link: Locator): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  const chunks: Buffer[] = []
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer)
  return sha256(Buffer.concat(chunks))
}

test('A7: image + video + audio + .py attach, render, play/seek, range, download, preview', async ({ page, approved }) => {
  void approved
  await page.goto('/')
  await selectModel(page, REPLAY_MODEL)

  await page.getByTestId('file-input').setInputFiles(FILES.map(fixturePath))
  const chips = page.getByTestId('attachment-chip')
  await expect(chips).toHaveCount(4)
  await expect(page.locator('[data-testid="attachment-chip"][data-status="error"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="attachment-chip"][data-status="uploading"]')).toHaveCount(0)
  await sendPrompt(page, 'here are my files')

  const user = page.getByTestId('message-user').last()
  await expect(user.getByTestId('gallery-item')).toHaveCount(1)
  await expect(user.getByTestId('video-card')).toHaveCount(1)
  await expect(user.getByTestId('audio-card')).toHaveCount(1)
  await expect(user.getByTestId('file-chip')).toHaveCount(1)
  await expect(user.getByTestId('file-chip')).toContainText('sample.py')

  // Video: plays and seeks to 3 s.
  const video = user.getByTestId('video-card').locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  const t = await video.evaluate(async (v: HTMLVideoElement) => {
    await v.play()
    const seeked = new Promise<void>((res) => v.addEventListener('seeked', () => res(), { once: true }))
    v.currentTime = 3
    await seeked
    return v.currentTime
  })
  expect(t).toBeGreaterThanOrEqual(2.9)

  // Range request on the video content.
  const videoUrl = (await video.getAttribute('src'))!
  const range = await page.request.get(videoUrl, { headers: { Range: 'bytes=0-1' } })
  expect(range.status()).toBe(206)
  expect(range.headers()['content-range']).toBe(`bytes 0-1/${statSync(fixturePath('sample.webm')).size}`)
  expect((await range.body()).length).toBe(2)

  // Audio plays.
  const audio = user.getByTestId('audio-card').locator('audio')
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThanOrEqual(1)
  const playing = await audio.evaluate(async (a: HTMLAudioElement) => {
    await a.play()
    return !a.paused
  })
  expect(playing).toBe(true)

  // Downloads are byte-identical to what was uploaded.
  const item = user.getByTestId('gallery-item')
  await item.hover()
  expect(await downloadSha(page, item.getByTestId('download'))).toBe(fixtureSha('sample.png'))
  expect(await downloadSha(page, user.getByTestId('video-card').getByTestId('download'))).toBe(fixtureSha('sample.webm'))
  expect(await downloadSha(page, user.getByTestId('audio-card').getByTestId('download'))).toBe(fixtureSha('sample.mp3'))
  expect(await downloadSha(page, user.getByTestId('file-chip').getByTestId('download'))).toBe(fixtureSha('sample.py'))

  // .py preview: highlighted code containing a line of the fixture.
  await user.getByTestId('file-chip').getByTestId('file-preview').click()
  const preview = page.getByTestId('code-preview')
  const line = readFileSync(fixturePath('sample.py'), 'utf8').split('\n').find((l) => l.startsWith('def '))!.trim()
  await expect(preview).toContainText(line)
  await expect(preview.locator('pre span[style]').first()).toBeAttached()
})
