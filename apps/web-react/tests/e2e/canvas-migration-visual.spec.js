import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = { id: 'canvas-visual-user', email: 'canvas-visual@example.com', username: '画布用户' }

async function stabilizeCanvas(page, marker) {
  const iframe = page.locator('.canvas-app-frame')
  const legacyIframe = new URL(page.url()).port === '3103'
  if (legacyIframe) {
    await expect(iframe).toBeVisible()
    await expect(iframe).toHaveClass(/is-ready/)
    const surface = page.frameLocator('.canvas-app-frame')
    await expect(surface.locator(marker)).toBeVisible()
    await surface.locator('head').evaluate((head) => {
      const style = document.createElement('style')
      style.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}input,textarea{caret-color:transparent!important}'
      head.appendChild(style)
    })
  } else {
    await expect(page.locator(marker)).toBeVisible()
  }
  await stabilizeVisualPage(page, '.canvas-app-view')
}

test.describe('Canvas Vue iframe to native React visual contract @visual', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('http://127.0.0.1:3104/src/**', (route) => route.continue())
    await page.route('http://127.0.0.1:3105/@fs/**/canvas-react/src/**', (route) => route.continue())
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
