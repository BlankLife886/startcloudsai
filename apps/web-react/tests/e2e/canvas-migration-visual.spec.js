import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = { id: 'canvas-visual-user', email: 'canvas-visual@example.com', username: '画布用户' }

async function stabilizeCanvas(page, marker) {
  await expect(page.locator(marker)).toBeVisible()
  await stabilizeVisualPage(page, '.canvas-app-view')
}

test.describe('Native React canvas visual contract @visual', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.addInitScript(() => {
      localStorage.removeItem('infinite-canvas:canvas_store')
      indexedDB.deleteDatabase('infinite-canvas')
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
      routes: {}, features: {}, aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [] }, blacklist: { blocked: false },
    }))
    await page.route('**/api/v1/canvas-projects', (route) => fulfillJson(route, { items: [] }))
    await page.route('**/api/v1/prompts**', (route) => fulfillJson(route, { items: [], page: 1, pageSize: 20, total: 0, hasMore: false }))
  })

  test('canvas home desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await stabilizeCanvas(page, 'h1')
    await expect(page).toHaveScreenshot('canvas-home-desktop.png', { fullPage: true })
  })

  test('canvas home mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
    await stabilizeCanvas(page, 'h1')
    await expect(page).toHaveScreenshot('canvas-home-mobile.png', { fullPage: true })
  })

  test('canvas prompts desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/canvas?view=%2Fprompts', { waitUntil: 'domcontentloaded' })
    await stabilizeCanvas(page, 'h1')
    await expect(page).toHaveScreenshot('canvas-prompts-desktop.png', { fullPage: true })
  })
})
