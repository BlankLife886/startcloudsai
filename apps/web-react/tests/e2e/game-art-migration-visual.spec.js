import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = { id: 'game-art-visual-user', email: 'game-visual@example.com', username: '游戏设计用户' }
const model = {
  id: 'game-art-pro', publicModelKey: 'game-art-pro', label: '游戏美术 Pro', default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'], aspectRatios: ['3:4', '16:9', '1:1'],
  qualities: ['high', 'medium'], maxReferenceImages: 4, creditCost: 4, pricePoints: 4,
}
const outputImagePath = fileURLToPath(new URL('../../src/assets/pricing/wallet/icon-wallet.png', import.meta.url))
const resultTask = {
  id: 'game-art-result-1', type: 'game_art', status: 'succeeded', prompt: '星轨机械师角色立绘',
  params: { _kind: 'game-art-character-generation', publicModelKey: model.id, aspectRatio: '3:4', viewLabel: '角色', kindVariant: 'character', batchId: 'game-visual-group', batchIndex: 0, batchSize: 1 },
  outputUrls: ['/visual/game-art-output.png'], originalUrls: ['/visual/game-art-output.png'], thumbnailUrls: ['/visual/game-art-output.png'],
  createdAt: '2026-08-12T08:00:00.000Z', startedAt: '2026-08-12T08:00:02.000Z', finishedAt: '2026-08-12T08:00:18.000Z',
}

test.describe('Game art Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.addInitScript(() => localStorage.removeItem('walleven_user_game-art-visual-user_local_game-art-studio-v1'))
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
      routes: {}, features: { 'ai.gameDesign': { enabled: true, config: { publicModels: [model] } } },
      aiModelCatalog: { providers: [], publicModels: [model], featurePublicModels: [model] }, blacklist: { blocked: false },
    }))
    await page.route('**/api/v1/pricing', (route) => fulfillJson(route, { taskPointPrices: { game_art: 4 } }))
    await page.route('**/api/v1/tasks**', (route) => {
      const visualState = new URL(page.url()).searchParams.get('visualState')
      return fulfillJson(route, { items: visualState === 'result' ? [resultTask] : [], nextCursor: null })
    })
    await page.route('**/api/v1/prompts**', (route) => fulfillJson(route, { items: [], page: 1, hasMore: false }))
    await page.route('**/*game-art-output.png', (route) => route.fulfill({ path: outputImagePath, contentType: 'image/png' }))
  })

  test('empty desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.game-art-studio')
    await expect(page).toHaveScreenshot('game-art-empty-desktop.png', { fullPage: true })
  })

  test('empty mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.game-art-studio')
    await expect(page).toHaveScreenshot('game-art-empty-mobile.png', { fullPage: true })
  })

  test('prop type desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.locator('.ga-rail button[title="道具"]').click()
    await stabilizeVisualPage(page, '.game-art-studio')
    await expect(page).toHaveScreenshot('game-art-prop-desktop.png', { fullPage: true })
  })

  test('model menu desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '切换生成模型' }).click()
    await stabilizeVisualPage(page, '.ga-model-menu')
    await expect(page).toHaveScreenshot('game-art-model-menu-desktop.png', { fullPage: true })
  })

  test('output settings desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /比例与数量/ }).click()
    await stabilizeVisualPage(page, '.ga-feature-popover')
    await expect(page).toHaveScreenshot('game-art-output-settings-desktop.png', { fullPage: true })
  })

  test('library desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.getByTitle('历史记录与我的资产').click()
    await stabilizeVisualPage(page, '.ga-drawer')
    await expect(page).toHaveScreenshot('game-art-library-desktop.png', { fullPage: true })
  })

  test('result desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art?visualState=result', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('游戏美术资产')).toBeVisible()
    await stabilizeVisualPage(page, '.ga-output')
    await expect(page).toHaveScreenshot('game-art-result-desktop.png', { fullPage: true, mask: [page.getByAltText('游戏美术资产'), page.locator('.clock-filmstrip img')] })
  })

  test('fullscreen desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/game-art?visualState=result', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '查看大图' }).click()
    await stabilizeVisualPage(page, '.wallpaper-fullscreen-preview')
    await expect(page).toHaveScreenshot('game-art-fullscreen-desktop.png', { fullPage: true, mask: [page.locator('img')] })
  })
})
