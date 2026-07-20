import { expect, test } from '@playwright/test'
import { fulfillJson, mockBootstrapConfig } from './helpers/authMocks.js'

const wallpapers = Array.from({ length: 12 }, (_, index) => ({
  id: `home-${index + 1}`,
  resolution: index % 2 ? '3840x2160' : '2160x3840',
  favorites: 120 + index,
  path: `https://images.example.test/home-${index + 1}.jpg`,
  thumbs: {
    small: `https://images.example.test/home-${index + 1}-small.jpg`,
    original: `https://images.example.test/home-${index + 1}.jpg`,
  },
}))

test.beforeEach(async ({ page }) => {
  await mockBootstrapConfig(page)
  await page.route('**/api/client/bootstrap/home**', async (route) => {
    await fulfillJson(route, {
      config: { siteHome: {} },
      searches: [],
      announcements: [],
    })
  })
  await page.route('**/api/client/share/overview', async (route) => {
    await fulfillJson(route, {
      stats: { works: 0, creators: 0, favorites: 0, comments: 0 },
      featured: [],
      popular: [],
      trendingTags: [],
    })
  })
  await page.route('**/api/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: wallpapers, meta: {} }),
    })
  })
  await page.route('https://images.example.test/**', async (route) => route.abort())
})

test('home virtual grids keep a stable document height while scrolling', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-virtual-grid')).toHaveCount(3)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.home-virtual-grid')].every((grid) => grid.clientHeight > 0),
  )

  const initialHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y <= initialHeight; y += 500) {
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(40)
  }

  const result = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    hiddenRevealCount: document.querySelectorAll('[data-home-reveal]:not(.is-revealed)').length,
    gridOverflow: [...document.querySelectorAll('.home-virtual-grid')].map(
      (grid) => grid.scrollHeight - grid.clientHeight,
    ),
  }))

  expect(result.documentHeight).toBeLessThanOrEqual(initialHeight + 80)
  expect(result.hiddenRevealCount).toBe(0)
  expect(Math.max(...result.gridOverflow)).toBeLessThanOrEqual(1)
})

test('home content stays visible when reduced motion is requested', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await mockBootstrapConfig(page)
  await page.route('**/api/client/bootstrap/home**', async (route) => {
    await fulfillJson(route, { config: { siteHome: {} }, searches: [], announcements: [] })
  })
  await page.route('**/api/client/share/overview', async (route) => {
    await fulfillJson(route, { stats: {}, featured: [], popular: [], trendingTags: [] })
  })
  await page.route('**/api/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: wallpapers, meta: {} }),
    })
  })
  await page.route('https://images.example.test/**', async (route) => route.abort())

  await page.goto('/')
  await expect(page.locator('[data-home-reveal]').first()).toBeVisible()
  const hiddenCount = await page.locator('[data-home-reveal]:not(.is-revealed)').count()
  expect(hiddenCount).toBe(0)
  await context.close()
})
