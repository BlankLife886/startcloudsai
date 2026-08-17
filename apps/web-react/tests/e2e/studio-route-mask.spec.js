import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const maskedStudios = [
  ['/ai-illustration-coloring', '插画染色'],
  ['/model-sheet', '模型设计'],
  ['/game-art', '游戏设计'],
]

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: {},
    aiModelCatalog: { providers: [], publicModels: [], featurePublicModels: [] },
    blacklist: { blocked: false },
  }))
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
})

for (const [path, label] of maskedStudios) {
  test(`${label} page is covered while navigation remains available`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('status')).toHaveText('正在开发中')
    await expect(page.locator('.main-content')).toHaveAttribute('inert', '')
    await expect(page.locator('.site-header')).toBeVisible()
    const geometry = await page.evaluate(() => {
      const mask = document.querySelector('[data-studio-route-mask]').getBoundingClientRect()
      const header = document.querySelector('.site-header').getBoundingClientRect()
      return { maskTop: Math.round(mask.top), headerBottom: Math.round(header.bottom) }
    })
    expect(geometry.maskTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1)
  })
}
