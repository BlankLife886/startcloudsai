import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = { id: 'model-sheet-visual-user', email: 'model-visual@example.com', username: '模型设计用户' }
const model = {
  id: 'model-sheet-pro', publicModelKey: 'model-sheet-pro', label: '模型设计 Pro', default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'], aspectRatios: ['16:9', '1:1', '9:16'],
  qualities: ['high', 'medium', 'low'], maxReferenceImages: 4, creditCost: 3, pricePoints: 3,
}
const outputImagePath = fileURLToPath(new URL('../fixtures/icon-wallet.png', import.meta.url))
const resultTask = {
  id: 'model-sheet-result-1', type: 'model_sheet', status: 'succeeded', prompt: '机甲角色模型设定',
  params: { _kind: 'ultra-reference-generation', publicModelKey: model.id, aspectRatio: '16:9', viewId: 'front', viewLabel: '设定板', outputMode: 'board', batchId: 'model-visual-group', batchIndex: 0, batchSize: 1 },
  outputUrls: ['/visual/model-sheet-output.png'], originalUrls: ['/visual/model-sheet-output.png'], thumbnailUrls: ['/visual/model-sheet-output.png'],
  createdAt: '2026-08-12T08:00:00.000Z', startedAt: '2026-08-12T08:00:02.000Z', finishedAt: '2026-08-12T08:00:18.000Z',
}

test.describe('Model sheet Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.addInitScript(() => {
      localStorage.removeItem('walleven_user_model-sheet-visual-user_local_ultra-model-sheet-studio-v2')
      localStorage.removeItem('walleven_user_model-sheet-visual-user_local_ultra-model-sheet-subjects-v1')
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
      routes: {}, features: { 'ai.ultraModelSheet': { enabled: true, config: { publicModels: [model] } } },
      aiModelCatalog: { providers: [], publicModels: [model], featurePublicModels: [model] },
      pageControls: { model_sheet: { status: 'normal' } },
      blacklist: { blocked: false },
    }))
    await page.route('**/api/v1/pricing', (route) => fulfillJson(route, { taskPointPrices: { model_sheet: 3 } }))
    await page.route('**/api/v1/tasks**', (route) => {
      const visualState = new URL(page.url()).searchParams.get('visualState')
      return fulfillJson(route, { items: visualState === 'result' ? [resultTask] : [], nextCursor: null })
    })
    await page.route('**/api/v1/prompts**', (route) => fulfillJson(route, { items: [], page: 1, hasMore: false }))
    await page.route('**/*model-sheet-output.png', (route) => route.fulfill({ path: outputImagePath, contentType: 'image/png' }))
  })

  test('empty desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.ms3')
    await expect(page).toHaveScreenshot('model-sheet-empty-desktop.png', { fullPage: true })
  })

  test('empty mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.ms3')
    await expect(page).toHaveScreenshot('model-sheet-empty-mobile.png', { fullPage: true })
  })

  test('model picker desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.locator('.ms3-more > summary').filter({ hasText: '画面设置' }).click()
    await page.locator('.ms3-panel-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.getByRole('button', { name: '生成模型' }).click()
    await stabilizeVisualPage(page, '.ratio-select__menu')
    await expect(page).toHaveScreenshot('model-sheet-model-picker-desktop.png', { fullPage: true })
  })

  test('prompt library desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '词库' }).click()
    await stabilizeVisualPage(page, '.ms3-gallery')
    await expect(page).toHaveScreenshot('model-sheet-prompts-desktop.png', { fullPage: true })
  })

  test('result desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-sheet?visualState=result', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('模型设计')).toBeVisible()
    await stabilizeVisualPage(page, '.ms3-stage')
    await expect(page).toHaveScreenshot('model-sheet-result-desktop.png', { fullPage: true, mask: [page.getByAltText('模型设计'), page.locator('.ms3-card-pick img')] })
  })

  test('fullscreen desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-sheet?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByTitle('全屏查看').click()
    await stabilizeVisualPage(page, '.wallpaper-fullscreen-preview')
    await expect(page).toHaveScreenshot('model-sheet-fullscreen-desktop.png', { fullPage: true, mask: [page.locator('img')] })
  })
})
