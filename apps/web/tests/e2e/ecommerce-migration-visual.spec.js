import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline, stabilizeVisualPage } from './helpers/visualBaseline.js'

const user = {
  id: 'ecommerce-visual-user',
  email: 'commerce@example.com',
  username: '电商视觉用户',
}

const model = {
  id: 'ecommerce-visual-model',
  publicModelKey: 'ecommerce-visual-model',
  label: '电商高清模型',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['1:1', '3:4', '4:5', '16:9', '9:16'],
  maxReferenceImages: 6,
  creditCost: 3,
}

const product = {
  id: 'visual-product-1',
  title: '便携式降噪耳机',
  sku: 'HEADPHONE-01',
  brand: 'Visual Lab',
  category: '数码配件',
  status: 'active',
  platform: 'Amazon',
  market: '美国',
  language: '英文',
  sellingPoints: '轻量佩戴\n主动降噪\n长续航',
  assetIds: ['visual-asset-1'],
  protectedElements: ['Logo', '按键数量'],
  assets: [
    {
      id: 'visual-asset-1',
      title: '商品正面',
      url: '/sucai/home-intro-03.png',
      thumbnailUrl: '/sucai/home-intro-03.png',
    },
  ],
}

const resultTask = {
  id: 'visual-result-task',
  type: 'ecommerce_design',
  status: 'succeeded',
  prompt: '测试电商结果',
  params: {
    _kind: 'ui-design-ecommerce-detail-generation',
    aspectRatio: '3:4',
    batchId: 'visual-result-batch',
    batchIndex: 0,
    batchSize: 1,
    batchCreatedAt: '2026-08-11T08:00:00.000Z',
  },
  originalUrls: ['/sucai/home-intro-03.png'],
  outputUrls: ['/sucai/home-intro-03.png'],
  createdAt: '2026-08-11T08:00:00.000Z',
  finishedAt: '2026-08-11T08:01:00.000Z',
}

test.describe('Ecommerce Vue to React visual contract @visual', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.ecommerceDesign': { enabled: true, config: { publicModels: [model] } },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [model],
          featurePublicModels: [model],
        },
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/pricing**', (route) =>
      fulfillJson(route, { taskPointPrices: { ecommerce_design: 3 } }),
    )
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: new URL(page.url()).searchParams.get('visualResult') === '1' ? [resultTask] : [],
        nextCursor: null,
      }),
    )
    await page.route('**/api/v1/commerce/products**', (route) =>
      fulfillJson(route, { items: [product], nextCursor: null }),
    )
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, { key: 'uploads/visual/product.png', url: '/sucai/home-intro-03.png' }),
    )
    await page.route('**/api/v1/commerce/product-briefs', (route) =>
      fulfillJson(route, {
        productName: '轻量降噪耳机',
        sellingPoints: '轻量佩戴\n主动降噪\n长续航',
      }),
    )
    await page.route('**/api/v1/me/assets**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.route('**/api/v1/me/asset-groups**', (route) =>
      fulfillJson(route, { items: [], ungroupedCount: 0, totalAssetCount: 0 }),
    )
  })

  test('listing desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=listing', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.commerce-studio')
    await expect(page).toHaveScreenshot('ecommerce-listing-desktop.png', { fullPage: true })
  })

  test('listing mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ecommerce-design?tool=listing', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.commerce-studio')
    await expect(page).toHaveScreenshot('ecommerce-listing-mobile.png', { fullPage: true })
  })

  for (const mode of ['clone', 'detail', 'tryon']) {
    test(`${mode} desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`/ecommerce-design?tool=${mode}`, { waitUntil: 'domcontentloaded' })
      await stabilizeVisualPage(page, '.commerce-studio')
      await expect(page).toHaveScreenshot(`ecommerce-${mode}-desktop.png`, { fullPage: true })
    })
  }

  test('detail result desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await stabilizeVisualPage(page, '.result-workspace')
    await expect(page).toHaveScreenshot('ecommerce-detail-result-desktop.png', { fullPage: true })
  })

  test('product library desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail', { waitUntil: 'domcontentloaded' })
    await page
      .locator('.commerce-header__actions button')
      .filter({ hasText: /商品库/ })
      .click()
    await stabilizeVisualPage(page, '.commerce-products')
    await expect(page).toHaveScreenshot('ecommerce-products-desktop.png', { fullPage: true })
  })

  test('select menu desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=listing', { waitUntil: 'domcontentloaded' })
    await stabilizeVisualPage(page, '.commerce-studio')
    await page.getByLabel('选择电商平台').click()
    await expect(page.locator('.commerce-select-menu')).toBeVisible()
    await expect(page).toHaveScreenshot('ecommerce-select-desktop.png', { fullPage: true })
  })

  test('brief dialog desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=listing', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await page.getByRole('button', { name: 'AI 生成' }).click()
    await expect(page.getByRole('dialog', { name: '生成商品名称和卖点' })).toBeVisible()
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    })
    await expect(page).toHaveScreenshot('ecommerce-brief-desktop.png', { fullPage: true })
  })

  test('detail result mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('tab', { name: '生成结果' }).click()
    await stabilizeVisualPage(page, '.result-workspace')
    await expect(page).toHaveScreenshot('ecommerce-detail-result-mobile.png', { fullPage: true })
  })

  test('product editor desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail', { waitUntil: 'domcontentloaded' })
    await page
      .locator('.commerce-header__actions button')
      .filter({ hasText: /商品库/ })
      .click()
    await page.getByRole('button', { name: '编辑商品' }).click()
    await stabilizeVisualPage(page, '.commerce-product-editor')
    await expect(page).toHaveScreenshot('ecommerce-product-editor-desktop.png', { fullPage: true })
  })

  test('revision panel desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '展开连续优化' }).click()
    await stabilizeVisualPage(page, '.revision-panel.open')
    await expect(page).toHaveScreenshot('ecommerce-revision-desktop.png', { fullPage: true })
  })

  test('fullscreen preview desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '放大查看当前结果' }).click()
    await expect(page.getByRole('dialog', { name: /全屏预览/ })).toBeVisible()
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    })
    await expect(page).toHaveScreenshot('ecommerce-fullscreen-preview-desktop.png', {
      fullPage: true,
    })
  })

  for (const state of [
    { id: 'info', title: '显示信息' },
    { id: 'compare', title: '比较模式' },
    { id: 'filters', title: '图像滤镜' },
  ]) {
    test(`fullscreen ${state.id} desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
        waitUntil: 'domcontentloaded',
      })
      await page.getByRole('button', { name: '放大查看当前结果' }).click()
      await expect(page.getByRole('dialog', { name: /全屏预览/ })).toBeVisible()
      await expect(page.locator('.preview-main-pane .preview-image')).toBeVisible()
      await expect
        .poll(() =>
          page.locator('.preview-main-pane .preview-image').evaluate((image) => image.naturalWidth),
        )
        .toBeGreaterThan(0)
      const actionId = state.id === 'filters' ? 'filters' : state.id
      const reactAction = page.locator(`[data-preview-action="${actionId}"]`)
      if (await reactAction.count()) {
        await reactAction.click()
        await expect(page.getByRole('dialog', { name: /全屏预览/ })).toHaveAttribute(
          state.id === 'info'
            ? 'data-show-info'
            : state.id === 'compare'
              ? 'data-comparison'
              : 'data-show-filters',
          'true',
        )
      } else await page.getByTitle(state.title).click()
      await expect(
        page.locator(
          state.id === 'info'
            ? '.preview-info-panel'
            : state.id === 'compare'
              ? '.comparison-stage'
              : '.preview-filter-panel',
        ),
      ).toBeVisible()
      await page.addStyleTag({
        content: '*,*::before,*::after{animation:none!important;transition:none!important}',
      })
      await expect(page).toHaveScreenshot(`ecommerce-fullscreen-${state.id}-desktop.png`, {
        fullPage: true,
      })
    })
  }

  test('fullscreen crop desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '放大查看当前结果' }).click()
    await expect(page.getByRole('dialog', { name: /全屏预览/ })).toBeVisible()
    await expect(page.locator('.preview-main-pane .preview-image')).toBeVisible()
    await expect
      .poll(() =>
        page.locator('.preview-main-pane .preview-image').evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0)
    const reactCrop = page.locator('[data-preview-action="crop"]')
    if (await reactCrop.count()) await reactCrop.click()
    else await page.getByTitle('进入裁切模式').click()
    const image = page.locator('.preview-main-pane .preview-image')
    const box = await image.boundingBox()
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.72)
    await page.mouse.up()
    await expect(page.locator('.crop-selection-box')).toBeVisible()
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    })
    await expect(page).toHaveScreenshot('ecommerce-fullscreen-crop-desktop.png', { fullPage: true })
  })

  test('fullscreen filter presets apply desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '放大查看当前结果' }).click()
    await expect(page.getByRole('dialog', { name: /全屏预览/ })).toBeVisible()
    const reactFilter = page.locator('[data-preview-action="filters"]')
    if (await reactFilter.count()) await reactFilter.click()
    else await page.getByTitle('图像滤镜').click()
    const preset = page.getByRole('button', { name: '柯达金', exact: true })
    await preset.click()
    await expect(preset).toHaveClass(/active/)
    await expect
      .poll(() =>
        page
          .locator('.preview-main-pane .preview-image')
          .evaluate((image) => getComputedStyle(image).filter),
      )
      .not.toBe('none')
  })

  test('local mask editor desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '局部编辑当前结果' }).click()
    await expect(page.getByRole('dialog', { name: /局部编辑/ })).toBeVisible()
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}',
    })
    await expect(page).toHaveScreenshot('ecommerce-local-mask-desktop.png', { fullPage: true })
  })

  test('local mask drawing controls desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/ecommerce-design?tool=detail&visualResult=1', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: '局部编辑当前结果' }).click()
    await expect(page.getByRole('dialog', { name: /局部编辑/ })).toBeVisible()
    const canvas = page.getByLabel('局部编辑蒙版画布')
    await expect(canvas).toBeVisible()
    await expect.poll(() => canvas.evaluate((node) => node.width)).toBeGreaterThan(1)
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.42)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.56, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.local-mask-coverage:not(.is-empty)')).toBeVisible()
    await page.getByRole('button', { name: '移除内容' }).click()
    await expect(page.locator('.local-mask-textarea')).toHaveValue(
      '移除选中区域的内容，并自然补全背景',
    )
    await page.getByRole('button', { name: '撤销蒙版' }).click()
    await expect(page.locator('.local-mask-coverage.is-empty')).toBeVisible()
    await page.getByRole('button', { name: '重做蒙版' }).click()
    await expect(page.locator('.local-mask-coverage:not(.is-empty)')).toBeVisible()
    await page.getByRole('button', { name: '擦除' }).click()
    await expect(page.getByRole('button', { name: '擦除' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '关闭局部编辑' }).click()
    await expect(page.getByRole('dialog', { name: /局部编辑/ })).toHaveCount(0)
  })
})
