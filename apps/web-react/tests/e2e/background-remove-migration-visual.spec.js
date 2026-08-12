import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = {
  id: 'background-visual-user',
  email: 'background@example.com',
  username: '抠图用户',
}

const model = {
  id: 'background-removal-pro',
  label: '智能抠图',
  default: true,
  pricePoints: 2,
}

const resultImagePath = fileURLToPath(
  new URL('../../src/assets/icons/edit-image.png', import.meta.url),
)

const resultTask = {
  id: 'background-result-1',
  type: 'background_remove',
  status: 'succeeded',
  prompt: '移除图片背景',
  params: {
    _kind: 'image-tool-background-remove',
    publicModelKey: model.id,
    sourceUrl: '/visual/background-result.png',
  },
  outputUrls: ['/visual/background-result.png'],
  originalUrls: ['/visual/background-result.png'],
  thumbnailUrls: ['/visual/background-result.png'],
  createdAt: '2026-08-11T08:00:00.000Z',
  startedAt: '2026-08-11T08:00:03.000Z',
  finishedAt: '2026-08-11T08:00:14.000Z',
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test.describe('Background remove Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.imageTools': {
            enabled: true,
            config: { backgroundRemovalModels: [model] },
          },
        },
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availableCents: 60, balanceCents: 60 }),
    )
    await page.route('**/api/v1/tasks**', (route) => {
      const visualState = new URL(page.url()).searchParams.get('visualState')
      if (route.request().method() !== 'GET') return fulfillJson(route, { task: resultTask })
      return fulfillJson(route, {
        items: visualState === 'result' ? [resultTask] : [],
        nextCursor: null,
      })
    })
    await page.route('**/*background-result.png', (route) =>
      route.fulfill({ path: resultImagePath, contentType: 'image/png' }),
    )
  })

  test('empty desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.br')
    await expect(page).toHaveScreenshot('background-remove-empty-desktop.png', { fullPage: true })
  })

  test('empty mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.br')
    await expect(page).toHaveScreenshot('background-remove-empty-mobile.png', { fullPage: true })
  })

  test('uploaded source desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'portrait.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await stabilizeVisualPage(page, '.br-frame')
    await expect(page).toHaveScreenshot('background-remove-source-desktop.png', {
      fullPage: true,
      mask: [page.locator('.br-pane:not(.is-result) .br-frame img')],
    })
  })

  test('latest result and compression desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/background-remove?visualState=result', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('背景移除结果')).toBeVisible()
    await stabilizeVisualPage(page, '.br-compress')
    await expect(page).toHaveScreenshot('background-remove-result-desktop.png', {
      fullPage: true,
      mask: [page.locator('.br-result-image')],
    })
  })

  test('history drawer desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/background-remove?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '查看历史' }).click()
    await stabilizeVisualPage(page, '.br-history__panel')
    await expect(page).toHaveScreenshot('background-remove-history-desktop.png', {
      fullPage: true,
      mask: [page.locator('.br-history__thumb'), page.locator('.br-result-image')],
    })
  })

  test('cost dialog desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'portrait.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.locator('.br-actions .br-btn.is-primary').click({ force: true })
    await stabilizeVisualPage(page, '.ai-cost-confirm-panel')
    await expect(page).toHaveScreenshot('background-remove-cost-desktop.png', {
      fullPage: true,
      mask: [page.locator('.br-pane:not(.is-result) .br-frame img')],
    })
  })
})
