import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const user = {
  id: 'content-motion-user',
  email: 'motion@gmail.com',
  username: '动效测试用户',
}

const model = {
  id: 'content-motion-model',
  publicModelKey: 'content-motion-model',
  label: '内容动效模型',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage', 'textToImage'],
  aspectRatios: ['1:1', '3:4'],
  resolutions: ['1K'],
  qualities: ['medium'],
  maxReferenceImages: 6,
  creditCost: 3,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((sessionUser) => {
    sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user: sessionUser }))
    localStorage.setItem('starclouds-locale', 'zh-CN')
  }, user)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      routes: {},
      features: {
        'ai.wallpaperGeneration': { enabled: true, config: { publicModels: [model] } },
        'ai.ecommerceDesign': { enabled: true, config: { publicModels: [model] } },
      },
      aiModelCatalog: { publicModels: [model], featurePublicModels: [model] },
      blacklist: { blocked: false },
    }),
  )
  await page.route('**/api/v1/pricing**', (route) =>
    fulfillJson(route, { taskPointPrices: { t2i: 3, ecommerce_design: 3 } }),
  )
  await page.route('**/api/v1/me/wallet', (route) =>
    fulfillJson(route, { balanceCents: 1000, availableCents: 1000 }),
  )
})

test('text-to-image history and assets tabs complete the shared content reveal lifecycle', async ({ page }) => {
  await page.route('**/api/v1/tasks**', (route) =>
    fulfillJson(route, {
      items: [
        {
          id: 't2i-motion-task',
          type: 't2i',
          status: 'succeeded',
          prompt: '文生图历史动效测试',
          params: { _kind: 'wallpaper-image-generation', aspectRatio: '1:1' },
          outputUrls: ['/sucai/home-intro-03.png'],
          originalUrls: ['/sucai/home-intro-03.png'],
          createdAt: '2026-08-12T08:00:00Z',
          finishedAt: '2026-08-12T08:01:00Z',
        },
      ],
      nextCursor: null,
    }),
  )

  await page.goto('/text-to-image')
  await page.getByRole('tab', { name: '历史记录' }).click()
  await expect(page.locator('.t2i-history-card')).toHaveCount(1)
  await expect(page.locator('.t2i-page')).toHaveAttribute(
    'data-t2i-history-motion-state',
    'entered',
  )

  await page.getByRole('tab', { name: '我的资产' }).click()
  await expect(page.locator('.t2i-assets-view')).toBeVisible()
  await expect(page.locator('.t2i-page')).toHaveAttribute(
    'data-t2i-assets-motion-state',
    'entered',
  )
})

test('ecommerce assets tab reveals cards only after its asset request completes', async ({ page }) => {
  await page.route('**/api/v1/tasks**', (route) =>
    fulfillJson(route, { items: [], nextCursor: null }),
  )
  await page.route('**/api/v1/me/assets**', (route) =>
    fulfillJson(route, {
      items: [
        {
          id: 'commerce-motion-asset',
          title: '电商素材动效测试',
          url: '/sucai/home-intro-03.png',
          thumbnailUrl: '/sucai/home-intro-03.png',
        },
      ],
      nextCursor: null,
    }),
  )
  await page.route('**/api/v1/me/asset-groups**', (route) =>
    fulfillJson(route, { items: [], ungroupedCount: 1, totalAssetCount: 1 }),
  )

  await page.goto('/ecommerce-design?tool=detail')
  await page.locator('.commerce-header__actions button').filter({ hasText: '资产与素材' }).click()
  await expect(page.locator('.asset-card')).toHaveCount(1)
  await expect(page.locator('.commerce-studio')).toHaveAttribute(
    'data-commerce-library-motion-state',
    'entered',
  )
  await expect(page.locator('.asset-card')).toContainText('电商素材动效测试')
})
