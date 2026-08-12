import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { buildRegionEditInstruction } from '../../src/legacy-modules/features/design-workshop/aiDesignDocument.js'

const USER = {
  id: 'region-e2e-user',
  email: 'region-e2e@example.com',
  username: '框选测试用户',
}

const IMAGE_MODEL = {
  id: 'region-image-model',
  publicModelKey: 'region-image-model',
  label: '框选测试图片模型',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['1:1', '16:9'],
  qualities: ['high'],
  resolutions: ['1K'],
  maxReferenceImages: 2,
  creditCost: 1,
}

const OUTPUT_URL = '/__test-assets/icon-wallet.png'
const OUTPUT_PATH = fileURLToPath(
  new URL('../fixtures/icon-wallet.png', import.meta.url),
)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ outputUrl, userId }) => {
      const scope = `user_${userId}`
      localStorage.setItem('starclouds-locale', 'zh-CN')
      localStorage.setItem('walleven_active_account_scope', scope)
      localStorage.setItem(
        `walleven_${scope}_local_ui-design-region-process-v1`,
        JSON.stringify({
          outputUrl,
          selection: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          coordinateSpace: 'image-content-v1',
          prompt: '',
          removeBackground: true,
          recognitionTypes: ['text', 'icon'],
          editAction: 'remove',
          preview: outputUrl,
          resultUrl: '',
          runId: '',
          conversationId: '',
          stage: '已识别 2 个元素，请点选要移除的',
          error: '',
          loading: false,
          elements: [
            {
              id: 'title',
              name: '标题',
              type: 'text',
              text: '标题',
              x: 150,
              y: 180,
              width: 260,
              height: 90,
            },
            {
              id: 'wallet',
              name: '钱包图标',
              type: 'icon',
              text: '',
              x: 560,
              y: 500,
              width: 230,
              height: 260,
            },
          ],
          elementViewport: { width: 1000, height: 1000 },
          elementGeometryVersion: 2,
          markedIds: [],
          updatedAt: new Date().toISOString(),
        }),
      )
    },
    { outputUrl: OUTPUT_URL, userId: USER.id },
  )
  await mockDesignWorkshopApis(page)
})

test('region selection uses image-content coordinates and keeps controls usable', async ({
  page,
}) => {
  let analysisRuns = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/assistant/runs'
    ) {
      analysisRuns += 1
    }
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design-workshop')
  const target = [{ id: 'icon', name: '搜索图标', type: 'icon', x: 10, y: 10, width: 20, height: 20 }]
  const editInstructions = {
    remove: buildRegionEditInstruction({ elements: target, action: 'remove' }),
    icon: buildRegionEditInstruction({ elements: target, action: 'improve-icon' }),
    background: buildRegionEditInstruction({ action: 'replace-background' }),
  }
  expect(editInstructions.remove).toContain('请移除')
  expect(editInstructions.remove).toContain('不得让相邻文字、图标、按钮或插画自动补位')
  expect(editInstructions.remove).toContain('所有框外像素视为锁定区')
  expect(editInstructions.remove).toContain('禁止裁切、扩图、重新构图')
  expect(editInstructions.icon).toContain('只重绘')
  expect(editInstructions.icon).not.toContain('请移除下列')
  expect(editInstructions.icon).toContain('完整画面和背景')
  expect(editInstructions.icon).toContain('禁止只输出图标')
  expect(editInstructions.background).toContain('禁止纯白背景')
  await expect(page.locator('.dws-region-box')).toBeVisible()
  await expect(page.locator('.dws-region-hit')).toHaveCount(2)
  await expect(page.locator('.dws-region-handle:visible')).toHaveCount(8)
  await expect(page.locator('.dws-region-composer__recognition input')).toHaveCount(3)
  await expect(page.getByRole('checkbox', { name: '文字' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '图标' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '大图' })).not.toBeChecked()
  await expect(page.locator('.dws-region-composer__modes button')).toHaveCount(4)
  await expect(page.locator('.dws-region-composer textarea')).toHaveCSS('min-height', '112px')
  await expect(page.locator('.dws-region-composer__cost')).toContainText(/输出 \d+×\d+/)
  await expect
    .poll(() =>
      page
        .locator('.dws-region-hit')
        .first()
        .evaluate((element) => getComputedStyle(element, '::before').content),
    )
    .toBe('"1"')

  const geometry = await page.evaluate(() => {
    const artboard = document.querySelector('.dws-artboard').getBoundingClientRect()
    const layer = document.querySelector('.dws-region-layer').getBoundingClientRect()
    const selection = document.querySelector('.dws-region-box').getBoundingClientRect()
    const hit = document.querySelector('.dws-region-hit').getBoundingClientRect()
    const close = document.querySelector('.dws-region-close').getBoundingClientRect()
    const composer = document.querySelector('.dws-region-composer').getBoundingClientRect()
    return {
      artboard: rect(artboard),
      layer: rect(layer),
      selection: rect(selection),
      hit: rect(hit),
      close: rect(close),
      composer: rect(composer),
      composerPosition: getComputedStyle(document.querySelector('.dws-region-composer')).position,
      viewport: { width: innerWidth, height: innerHeight },
    }

    function rect(value) {
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      }
    }
  })

  expect(Math.abs(geometry.layer.width - geometry.layer.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.layer.top - geometry.artboard.top)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(
      geometry.layer.left -
        (geometry.artboard.left + (geometry.artboard.width - geometry.layer.width) / 2),
    ),
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(geometry.selection.left - (geometry.layer.left + geometry.layer.width * 0.1)),
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(geometry.selection.top - (geometry.layer.top + geometry.layer.height * 0.1)),
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(geometry.hit.left - (geometry.selection.left + geometry.selection.width * 0.15)),
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(geometry.hit.top - (geometry.selection.top + geometry.selection.height * 0.18)),
  ).toBeLessThanOrEqual(2)
  expect(geometry.close.top).toBeGreaterThanOrEqual(geometry.composer.top)
  expect(geometry.close.right).toBeLessThanOrEqual(geometry.composer.right)
  expect(geometry.composerPosition).toBe('fixed')
  expect(geometry.composer.left).toBeGreaterThanOrEqual(8)
  expect(geometry.composer.top).toBeGreaterThanOrEqual(8)
  expect(geometry.composer.right).toBeLessThanOrEqual(geometry.viewport.width - 8)
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.viewport.height - 8)

  await page.mouse.click(
    geometry.selection.left + geometry.selection.width * 0.45,
    geometry.selection.top + geometry.selection.height * 0.82,
  )
  await expect(page.locator('.dws-region-hit')).toHaveCount(2)
  expect(analysisRuns).toBe(0)

  await page.getByRole('button', { name: '更换背景' }).click()
  await expect(page.getByText('更换背景模式输出完整背景')).toBeVisible()
  await expect(page.getByLabel('更换背景模式输出完整背景')).toBeDisabled()
  await page.getByRole('button', { name: '美化图标' }).click()
  await expect(page.getByLabel('美化图标保留完整画面')).toBeDisabled()
  await expect(page.getByLabel('美化图标保留完整画面')).not.toBeChecked()
  await page.getByRole('checkbox', { name: '文字' }).uncheck()
  await page.getByRole('checkbox', { name: '图标', exact: true }).uncheck()
  await expect(page.locator('.dws-region-hit')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始分析元素' })).toBeDisabled()
  await page.getByRole('button', { name: '手动框选元素' }).click()
  await expect(page.getByRole('button', { name: '退出手动框选' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const manualSelection = await page.locator('.dws-region-box').boundingBox()
  await page.mouse.move(
    manualSelection.x + manualSelection.width * 0.12,
    manualSelection.y + manualSelection.height * 0.2,
  )
  await page.mouse.down()
  await page.mouse.move(
    manualSelection.x + manualSelection.width * 0.32,
    manualSelection.y + manualSelection.height * 0.42,
  )
  await page.mouse.up()
  await expect(page.locator('.dws-region-hit')).toHaveCount(1)
  await expect(page.locator('.dws-region-hit')).toHaveClass(/is-marked/)
  await expect(page.locator('.dws-region-composer__chip')).toContainText('手动框选 1')
  await expect(page.getByRole('button', { name: '开始图片编辑' })).toBeEnabled()
  await page.getByRole('button', { name: '退出手动框选' }).click()
  await page.getByRole('checkbox', { name: '大图' }).check()
  await expect(page.getByRole('button', { name: '开始分析元素' })).toBeEnabled()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.dws-region-composer')).toBeVisible()
  await expect
    .poll(async () => {
      const box = await page.locator('.dws-region-composer').boundingBox()
      return box.x + box.width
    })
    .toBeLessThanOrEqual(382)
  const mobileComposer = await page.locator('.dws-region-composer').boundingBox()
  expect(mobileComposer.x).toBeGreaterThanOrEqual(8)
  expect(mobileComposer.y).toBeGreaterThanOrEqual(8)
  expect(mobileComposer.x + mobileComposer.width).toBeLessThanOrEqual(382)
  expect(mobileComposer.y + mobileComposer.height).toBeLessThanOrEqual(836)
})

test('initial region selection accepts an eight-pixel drag and removes the canvas hint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design-workshop')
  await page.getByRole('button', { name: '清除框选区域' }).click()
  await page.getByRole('button', { name: '框选优化' }).click()
  await expect(page.locator('.dws-region-layer.is-drawing')).toBeVisible()
  await expect(page.locator('.dws-region-hint')).toBeVisible()

  const layer = await page.locator('.dws-region-layer').boundingBox()
  const startX = Math.max(layer.x + 16, Math.min(layer.x + layer.width - 28, 720))
  const startY = Math.max(layer.y + 16, Math.min(layer.y + layer.height - 28, 450))
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 12, startY + 12)
  await page.mouse.up()

  await expect(page.locator('.dws-region-box')).toBeVisible()
  await expect(page.locator('.dws-region-hint')).toHaveCount(0)
  const selection = await page.locator('.dws-region-box').boundingBox()
  expect(selection.width).toBeGreaterThanOrEqual(8)
  expect(selection.height).toBeGreaterThanOrEqual(8)
})

async function mockDesignWorkshopApis(page) {
  await page.route('**/__test-assets/icon-wallet.png', (route) =>
    route.fulfill({ path: OUTPUT_PATH, contentType: 'image/png' }),
  )
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/auth/session') {
      await fulfill(route, { user: USER })
      return
    }
    if (path === '/api/v1/runtime-config') {
      await fulfill(route, {
        routes: {},
        features: {
          'ai.uiDesign': {
            enabled: true,
            config: {
              publicModels: [IMAGE_MODEL],
              analysisModels: [
                { label: '框选测试分析模型', model: 'region-analysis-model', default: true },
              ],
            },
          },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [IMAGE_MODEL],
          featurePublicModels: [IMAGE_MODEL],
          updatedAt: 'region-e2e',
        },
        blacklist: { blocked: false, reason: '' },
      })
      return
    }
    if (path === '/api/v1/pricing') {
      await fulfill(route, { taskPointPrices: { ui_design: 1 } })
      return
    }
    if (path === '/api/v1/tasks' && request.method() === 'GET') {
      await fulfill(route, { items: [], nextCursor: null })
      return
    }
    await fulfill(route, {})
  })
}

async function fulfill(route, data) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  })
}
