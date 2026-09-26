import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = {
  id: 'design-workshop-visual-user',
  email: 'design-workshop@example.com',
  username: '设计工作台用户',
}

const model = {
  id: 'ui-design-pro',
  publicModelKey: 'ui-design-pro',
  label: 'UI 设计 Pro',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['16:9', '9:16', '4:3', '1:1'],
  qualities: ['high'],
  resolutions: ['2K'],
  maxReferenceImages: 6,
  pricePoints: 3,
}

const outputImagePath = fileURLToPath(
  new URL('../fixtures/icon-wallet.png', import.meta.url),
)

const resultTask = {
  id: 'ui-design-result-1',
  type: 'ui_design',
  status: 'succeeded',
  prompt: '为创作者平台设计一个清晰的桌面工作台',
  params: {
    _kind: 'ui-design-generation',
    publicModelKey: model.id,
    aspectRatio: '16:9',
    platform: '智能网页端',
    deviceId: 'web',
    viewId: 'web',
    viewLabel: '智能网页端',
    groupId: 'ui-design-visual-group',
  },
  outputUrls: ['/visual/ui-design-output.png'],
  originalUrls: ['/visual/ui-design-output.png'],
  thumbnailUrls: ['/visual/ui-design-output.png'],
  createdAt: '2026-08-11T08:00:00.000Z',
  startedAt: '2026-08-11T08:00:02.000Z',
  finishedAt: '2026-08-11T08:00:18.000Z',
}

test.describe('Design workshop Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.addInitScript(() => {
      localStorage.removeItem('walleven_user_design-workshop-visual-user_local_ui-design-workshop-v2')
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.uiDesign': {
            enabled: true,
            config: {
              publicModels: [model],
              analysisModels: [
                { label: 'UI 分析模型', model: 'ui-analysis-model', default: true },
              ],
            },
          },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [model],
          featurePublicModels: [model],
          updatedAt: 'design-workshop-visual',
        },
        blacklist: { blocked: false, reason: '' },
      }),
    )
    await page.route('**/api/v1/pricing', (route) =>
      fulfillJson(route, { taskPointPrices: { ui_design: 3 } }),
    )
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availableCents: 60, balanceCents: 60 }),
    )
    await page.route('**/api/v1/tasks**', (route) => {
      const visualState = new URL(page.url()).searchParams.get('visualState')
      return fulfillJson(route, {
        items: visualState === 'result' ? [resultTask] : [],
        nextCursor: null,
      })
    })
    await page.route('**/*ui-design-output.png', (route) =>
      route.fulfill({ path: outputImagePath, contentType: 'image/png' }),
    )
  })

  test('empty desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.dws')
    await expect(page).toHaveScreenshot('design-workshop-empty-desktop.png', { fullPage: true })
  })

  test('empty mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.dws')
    await expect(page).toHaveScreenshot('design-workshop-empty-mobile.png', { fullPage: true })
  })

  test('page type picker desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /设计系统|页面设定|Design system|Page settings/ }).click()
    await page.getByRole('button', { name: '页面类型' }).click()
    await stabilizeVisualPage(page, '.dws-page-type-picker')
    await expect(page).toHaveScreenshot('design-workshop-page-types-desktop.png', { fullPage: true })
  })

  test('style picker desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /设计系统|页面设定|Design system|Page settings/ }).click()
    await page.getByRole('button', { name: '视觉风格' }).click()
    await stabilizeVisualPage(page, '.dws-config-picker.is-style')
    await expect(page).toHaveScreenshot('design-workshop-styles-desktop.png', { fullPage: true })
  })

  test('specification picker desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /设计系统|页面设定|Design system|Page settings/ }).click()
    await page.getByRole('button', { name: /设计规范/ }).click()
    await stabilizeVisualPage(page, '.dws-config-picker.is-specification')
    await expect(page).toHaveScreenshot('design-workshop-specification-desktop.png', { fullPage: true })
  })

  test('result desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop?visualState=result', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('UI 设计稿预览')).toBeVisible()
    await stabilizeVisualPage(page, '.dws-artboard')
    await expect(page).toHaveScreenshot('design-workshop-result-desktop.png', {
      fullPage: true,
      mask: [page.getByAltText('UI 设计稿预览'), page.locator('.dws-family-thumb')],
    })
  })

  test('version drawer desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /打开 V1 侧边栏/ }).click()
    await stabilizeVisualPage(page, '.dvd-drawer')
    await expect(page).toHaveScreenshot('design-workshop-version-drawer-desktop.png', {
      fullPage: true,
      mask: [page.locator('img')],
    })
  })

  test('fullscreen desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design-workshop?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '查看当前设计稿大图' }).click()
    await stabilizeVisualPage(page, '.wallpaper-fullscreen-preview')
    await expect(page).toHaveScreenshot('design-workshop-fullscreen-desktop.png', {
      fullPage: true,
      mask: [page.locator('img')],
    })
  })
})
