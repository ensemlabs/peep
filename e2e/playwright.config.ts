import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://peep:8000'

// http://peep:8000 is not a secure context; the clipboard API (A5) needs one, so treat it as such in Chromium.
// The flag is only honoured by the full Chromium build (channel 'chromium', new headless), not the default headless shell.
const chromiumLaunch = { args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`] }
const chromiumUse = { channel: 'chromium', permissions: ['clipboard-read', 'clipboard-write'], launchOptions: chromiumLaunch }

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Live-model specs (@live-llm) set their own retries / timeout (LIVE_TIMEOUT in tests/helpers.ts) and skip without E2E_LLM_BASE_URL.
  retries: 0,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    locale: 'en-US',
    reducedMotion: 'no-preference',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // Runs every spec (A1-A10).
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...chromiumUse },
    },
    {
      // Layout checks only (A10).
      name: 'tablet',
      testMatch: /a10-responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, ...chromiumUse },
    },
    {
      name: 'mobile',
      testMatch: /a10-responsive\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
})
