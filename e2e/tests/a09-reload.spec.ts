import type { Page } from '@playwright/test'
import {
  conversationIdFrom, expect, fetchConversation, flattenParts, lastAssistant, startReplay, test, waitAssistantDone,
} from './helpers'

/** Counts of rendered top-level blocks of the last assistant message (nested ones are lazily mounted, so skipped). */
async function topLevelCounts(page: Page) {
  return page.evaluate(() => {
    const root = [...document.querySelectorAll('[data-testid="message-assistant"]')].at(-1)!
    const steps = '[data-testid="step-thinking"],[data-testid="step-tool"],[data-testid="step-subagent"]'
    const top = (sel: string) => [...root.querySelectorAll(sel)].filter((e) => !e.parentElement?.closest(steps)).length
    return {
      thinking: top('[data-testid="step-thinking"]'),
      tool: top('[data-testid="step-tool"]'),
      subagent: top('[data-testid="step-subagent"]'),
      markdown: top('[data-testid="markdown"]'),
      codeBlocks: top('[data-testid="code-block"]'),
    }
  })
}

async function partTypeCounts(page: Page) {
  const conv = await fetchConversation(page, conversationIdFrom(page))
  const parts = flattenParts(conv.messages.filter((m) => m.role === 'assistant').at(-1)!.parts)
  const counts: Record<string, number> = {}
  for (const p of parts) counts[p.type] = (counts[p.type] ?? 0) + 1
  return counts
}

test('A9: reload mid-stream resumes and completes; reload after done restores everything', async ({ page, approved }) => {
  void approved
  test.setTimeout(150_000)
  const prompt = await startReplay(page)

  // ~8 s in (the first tool card appears at ~6.5 s): reload.
  await expect(page.getByTestId('step-tool').first()).toBeVisible({ timeout: 30_000 })
  await expect(lastAssistant(page)).toHaveAttribute('data-status', 'streaming')
  await page.reload()

  // The message is re-attached (still streaming), then completes with all parts.
  await expect(lastAssistant(page)).toBeVisible()
  await expect(lastAssistant(page)).toHaveAttribute('data-status', /streaming|complete/)
  await waitAssistantDone(page)
  const afterResume = await topLevelCounts(page)
  const stored = await partTypeCounts(page)
  // Launch-kit demo: read_file, generate_images, make_clip, make_chime at the top level, plus web_search
  // nested in the art-director sub-agent (which also nests the copywriter sub-agent).
  expect(stored).toMatchObject({ thinking: 1, tool: 5, subagent: 2 })
  expect(afterResume).toMatchObject({ thinking: 1, tool: 4, subagent: 1 })

  // Reload after done: identical part counts, the sidebar lists the conversation.
  await page.reload()
  await expect(lastAssistant(page)).toHaveAttribute('data-status', 'complete')
  await expect(lastAssistant(page).getByTestId('step-thinking')).toHaveCount(1)
  expect(await topLevelCounts(page)).toEqual(afterResume)
  expect(await partTypeCounts(page)).toEqual(stored)
  await expect(page.getByTestId('conv-row').filter({ hasText: prompt })).toHaveCount(1)
  await expect(page.getByTestId('message-user').last()).toContainText(prompt)
})
