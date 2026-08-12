import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://127.0.0.1:3102'
const WEB_DIR = fileURLToPath(new URL('.', import.meta.url))
const WEB_PORT = readPort(WEB_BASE_URL, 3102)

export default defineConfig({
  testDir: './tests/e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      scale: 'css',
    },
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
    cwd: WEB_DIR,
    url: WEB_BASE_URL,
    timeout: 90_000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: /@visual/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual-desktop',
      grep: /@visual/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'visual-mobile',
      grep: /@visual/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})

function readPort(baseUrl, fallback) {
  try {
    const url = new URL(baseUrl)
    if (url.port) return Number(url.port)
    return url.protocol === 'https:' ? 443 : 80
  } catch {
    return fallback
  }
}
