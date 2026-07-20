import { defineConfig, devices } from '@playwright/test'

const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://127.0.0.1:3102'
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787/api'
const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3103'
const LOCAL_NODE_BIN_DIR =
  process.env.E2E_NODE_BIN_DIR || (process.env.HOME ? `${process.env.HOME}/.local/bin` : '')
const E2E_ENV = {
  ...process.env,
  PATH: LOCAL_NODE_BIN_DIR ? `${LOCAL_NODE_BIN_DIR}:${process.env.PATH || ''}` : process.env.PATH,
}
const WEB_PORT = readPort(WEB_BASE_URL, 3102)
const ADMIN_PORT = readPort(ADMIN_BASE_URL, 3103)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
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
  webServer: [
    {
      command: 'pnpm --filter @walleven/api dev:e2e',
      url: `${API_BASE_URL}/health`,
      timeout: 90_000,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      env: E2E_ENV,
    },
    {
      command: `pnpm --filter @walleven/web dev --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_BASE_URL,
      timeout: 90_000,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      env: E2E_ENV,
    },
    {
      command: `pnpm --filter walleven-admin dev --host 127.0.0.1 --port ${ADMIN_PORT} --strictPort`,
      url: ADMIN_BASE_URL,
      timeout: 120_000,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      env: E2E_ENV,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
