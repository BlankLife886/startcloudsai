import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const galleryRows = [
  ['work-1', '星云城市', '/sucai/ui-design-1785420316960.webp', '云端画师'],
  ['work-2', '角色设定', '/sucai/ultra-model-sheet-board-1785420340076.webp', '星河'],
  ['work-3', '游戏场景', '/sucai/game-ui-1785420083438.webp', '夜航'],
  ['work-4', '概念插画', '/sucai/game-character-1785420185589.webp', '云端画师'],
].map(([id, title, coverUrl, username], index) => ({
  id,
  title,
  coverUrl,
  mediaUrls: [coverUrl],
  author: { username },
  createdAt: `2026-08-0${index + 1}T08:00:00Z`,
  featured: index < 3,
  category: { id: 'concept', name: '概念设计' },
}))

const studioAccount = {
  id: 'studio-user',
  email: 'studio@example.com',
  username: '创作者',
}

async function mockStudioApis(page) {
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: studioAccount }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } }),
  )
  await page.route('**/api/v1/assistant/config', (route) =>
    fulfillJson(route, {
      conversationModels: [{ model: 'chat-pro', label: 'Chat Pro', pricePoints: 5 }],
      imageModels: [{ model: 'image-pro', label: 'Image Pro', pricePoints: 12 }],
    }),
  )
  await page.route('**/api/v1/tasks**', (route) =>
    fulfillJson(route, { items: [], nextCursor: null }),
  )
  await page.route('**/api/v1/me/wallet', (route) =>
    fulfillJson(route, { balanceCents: 1000, availableCents: 1000, normalBalanceCents: 1000 }),
  )
  await page.route('**/api/v1/pricing', (route) =>
    fulfillJson(route, { taskPointPrices: { t2i: 15 } }),
  )
}

const textToImageModel = {
  id: 'image-pro',
  label: 'Image Pro',
  creditCost: 12,
  pricePoints: 12,
  standardPricePoints: 18,
  discountPricePoints: 12,
  capabilities: ['textToImage'],
  aspectRatios: ['1:1', '16:9', '9:16'],
  resolutions: ['1K', '2K', '4K'],
  qualities: ['low', 'medium', 'high'],
  outputFormats: ['png', 'webp', 'jpeg'],
  moderationLevels: ['auto', 'low'],
  maxReferenceImages: 4,
  transparentBackground: true,
}

async function mockTextToImageApis(page, { requireCostConfirm = true } = {}) {
  await page.route('**/api/v1/auth/session', (route) =>
    fulfillJson(route, {
      user: { ...studioAccount, requireCostConfirm },
    }),
  )
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      routes: {},
      features: {
        'ai.wallpaperGeneration': {
          enabled: true,
          config: {
            creditCost: 15,
            publicModels: [textToImageModel],
          },
        },
        'ai.imageTools': {
          enabled: true,
          config: {
            backgroundRemovalModels: [
              { id: 'remove-bg-pro', label: 'Remove BG Pro', default: true, pricePoints: 3 },
            ],
          },
        },
      },
      pageLayout: {},
      blacklist: { blocked: false },
    }),
  )
  await page.route('**/api/v1/me/wallet', (route) =>
    fulfillJson(route, { balanceCents: 1000, availableCents: 1000 }),
  )
  await page.route('**/api/v1/pricing**', (route) =>
    fulfillJson(route, { taskPointPrices: { t2i: 15 } }),
  )
}

test.describe('React public pages interaction contract', () => {
  test.skip(
    process.env.REACT_MIGRATION !== '1',
    'Only runs against the isolated React migration app',
  )

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
  })

  test('home shader and flowing menu remain after removing the showcase sections', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.commercial-hero')).toBeVisible()

    await expect(page.locator('[data-swap-card]')).toHaveCount(0)
    await expect(page.locator('.commercial-gallery')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '不同场景，各自保持完整语境' })).toHaveCount(0)

    const firstMenuItem = page.locator('.flowing-menu__item').first()
    await firstMenuItem.scrollIntoViewIfNeeded()
    await firstMenuItem.hover()
    await expect
      .poll(() =>
        firstMenuItem
          .locator('.flowing-menu__marquee')
          .evaluate((node) => getComputedStyle(node).transform),
      )
      .not.toBe('none')
  })

  test('home navigation is immediate while hero images are pending', async ({ page }) => {
    await page.route('**/sucai/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.continue()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.locator('.commercial-button--hero-cta').click()
    await expect(page).toHaveURL(/\/auth$/, { timeout: 700 })
    await expect(page.locator('.auth-page')).toBeVisible()
  })

  test('share gallery opens and closes a populated artwork detail', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await page.route('**/api/v1/gallery/submissions**', async (route) => {
      const featured = new URL(route.request().url()).searchParams.get('featured') === '1'
      await fulfillJson(route, {
        items: featured ? galleryRows.slice(0, 3) : galleryRows,
        nextCursor: null,
      })
    })
    await page.route('**/api/v1/gallery/categories**', (route) =>
      fulfillJson(route, {
        items: [{ id: 'concept', name: '概念设计' }],
      }),
    )
    await page.goto('/share', { waitUntil: 'domcontentloaded' })

    await expect
      .poll(() =>
        page.locator('.community-copy').evaluate((node) => getComputedStyle(node).opacity),
      )
      .toBe('1')
    await expect
      .poll(() =>
        page.locator('.community-main').evaluate((node) => getComputedStyle(node).opacity),
      )
      .toBe('1')
    const cards = page.locator('.community-card:not(.is-skeleton)')
    await expect(cards).toHaveCount(4)
    await cards.first().click()
    await expect(page.locator('.share-detail__panel')).toBeVisible()
    await expect(page).toHaveURL(/item=work-1/)

    await page.locator('.share-detail__close').click()
    await expect(page.locator('.share-detail')).toHaveCount(0)
    await expect(page).toHaveURL(/\/share$/)
  })

  test('studio opens a new assistant launch only after cost confirmation', async ({ page }) => {
    await mockStudioApis(page)
    await page.goto('/studio', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /AI 助手/ }).click()
    const toolMenu = page.getByRole('menu', { name: '选择创作工具' })
    await expect(toolMenu.getByRole('menuitem')).toHaveCount(2)
    await expect(toolMenu).toContainText('AI 助手')
    await expect(toolMenu).toContainText('文生图')
    await page.getByRole('button', { name: '关闭' }).click()

    await page.getByLabel('创作描述').fill('生成两张简洁的品牌主视觉')
    await page.getByRole('button', { name: '开始创作' }).click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await expect(page.locator('.ai-cost-confirm-total')).toContainText('24 积分')
    await page.getByRole('button', { name: '确认', exact: true }).click()

    await expect(page).toHaveURL(/\/assistant$/)
    const pending = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('starclouds:pending-prompt')),
    )
    expect(pending.taskType).toBe('assistant')
    expect(pending.prompt).toBe('生成两张简洁的品牌主视觉')
    expect(pending.config).toMatchObject({ autoStart: true, costConfirmed: true, count: 2 })
  })

  test('studio supports multiple text-to-image skills and reference uploads', async ({ page }) => {
    await mockStudioApis(page)
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'studio/reference.png',
        url: '/uploads/studio/reference.png',
        thumbnailUrl: '/uploads/studio/reference-thumb.png',
      }),
    )
    await page.goto('/studio', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /AI 助手/ }).click()
    await page.getByRole('menuitem', { name: /文生图/ }).click()
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByRole('option', { name: 'Style Director' }).click()
    await page.getByRole('option', { name: 'Detail QA' }).click()
    await expect(page.getByRole('button', { name: 'Skills' })).toContainText('Skills · 3')

    await page.locator('.studio-composer input[type="file"]').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByRole('button', { name: '移除参考图' })).toBeVisible()

    await page.getByLabel('创作描述').fill('极简白色背景的产品摄影')
    await page.getByRole('button', { name: '开始创作' }).click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await page.getByRole('button', { name: '确认', exact: true }).click()

    await expect(page).toHaveURL(/\/text-to-image$/)
    await expect(page.getByLabel('创作描述')).toHaveValue('极简白色背景的产品摄影')
    await expect(page.getByRole('button', { name: /Skills/ })).toContainText('3')
    await expect(page.getByRole('button', { name: '移除参考图' })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('starclouds:pending-prompt')))
      .toBeNull()
  })

  test('pending studio configuration does not block client-side navigation', async ({ page }) => {
    let markStarted
    const started = new Promise((resolve) => {
      markStarted = resolve
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
    await page.route('**/api/v1/runtime-config', async (route) => {
      markStarted()
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await fulfillJson(route, {}).catch(() => null)
    })
    await page.goto('/studio', { waitUntil: 'domcontentloaded' })
    await started

    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })

  test('text-to-image keeps reference keys, exact size, and multiple skills in task payload', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await mockTextToImageApis(page)
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'references/product.png',
        url: '/api/v1/files/references%2Fproduct.png',
      }),
    )
    let createBody = null
    await page.route('**/api/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        createBody = route.request().postDataJSON()
        await fulfillJson(route, {
          task: {
            id: 't2i-task-1',
            type: 't2i',
            status: 'queued',
            prompt: createBody.prompt,
            params: createBody.params,
            inputKeys: createBody.inputKeys,
            count: createBody.count,
            createdAt: '2026-08-11T08:00:00Z',
          },
        })
        return
      }
      if (new URL(route.request().url()).searchParams.get('ids') === 't2i-task-1') {
        await fulfillJson(route, {
          items: [
            {
              id: 't2i-task-1',
              type: 't2i',
              status: 'succeeded',
              prompt: createBody?.prompt || '',
              params: createBody?.params || {},
              inputKeys: createBody?.inputKeys || [],
              outputUrls: ['/sucai/home-intro-02.png'],
              originalUrls: ['/sucai/home-intro-02.png'],
              thumbnailUrls: ['/sucai/home-intro-02.png'],
              startedAt: '2026-08-11T08:00:01Z',
              finishedAt: '2026-08-11T08:00:04Z',
              createdAt: '2026-08-11T08:00:00Z',
            },
          ],
        })
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/api/v1/tasks/t2i-task-1', (route) =>
      fulfillJson(route, {
        task: {
          id: 't2i-task-1',
          type: 't2i',
          status: 'succeeded',
          prompt: createBody?.prompt || '',
          params: createBody?.params || {},
          inputKeys: createBody?.inputKeys || [],
          outputUrls: ['/sucai/home-intro-02.png'],
          originalUrls: ['/sucai/home-intro-02.png'],
          thumbnailUrls: ['/sucai/home-intro-02.png'],
          startedAt: '2026-08-11T08:00:01Z',
          finishedAt: '2026-08-11T08:00:04Z',
          createdAt: '2026-08-11T08:00:00Z',
        },
      }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.t2i-page')).toBeVisible()
    await page.getByRole('button', { name: '生成模型' }).click()
    const modelMenu = page.getByRole('listbox', { name: '生成模型列表' })
    await expect(modelMenu).toHaveClass(/has-priced-options/)
    await expect(modelMenu.locator('.model-point-price')).toContainText('12积分/张')
    await expect(modelMenu.locator('.model-point-price')).toContainText('标准 18 积分/张')
    const modelMenuStyle = await modelMenu.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        width: Number.parseFloat(style.width),
        zIndex: style.zIndex,
        transitionDuration: style.transitionDuration,
      }
    })
    expect(modelMenuStyle.width).toBeGreaterThanOrEqual(342)
    expect(modelMenuStyle.zIndex).toBe('1300')
    expect(modelMenuStyle.transitionDuration).toContain('0.24s')
    await page.keyboard.press('Escape')
    await expect(modelMenu).toHaveClass(/ratio-popover-leave-active/)
    await expect(modelMenu).toHaveClass(/ratio-popover-leave-to/)
    await expect(modelMenu).toHaveCount(0, { timeout: 1_000 })
    await page.getByLabel('创作描述').fill('极简产品摄影，柔和侧光')

    await page.getByRole('button', { name: /Skills/ }).click()
    const skillPanel = page.locator('.t2i-skill-panel.is-floating')
    await expect(skillPanel).toHaveCSS('position', 'fixed')
    await expect(skillPanel).toHaveCSS('z-index', '4200')
    await expect(skillPanel).toHaveCSS('transition-duration', '0.15s, 0.15s')
    await page.getByRole('option', { name: /Style Director/ }).click()
    await page.getByRole('option', { name: /Detail QA/ }).click()
    await expect(page.getByRole('button', { name: /Skills/ })).toContainText('3')
    await page.getByRole('button', { name: '关闭 Skill' }).click()
    await expect(skillPanel).toHaveClass(/t2i-skill-popover-leave-active/)
    await expect(skillPanel).toHaveCount(0, { timeout: 1_000 })

    await page.locator('.t2i-prompt-box input[type="file"]').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByRole('button', { name: '移除参考图' })).toBeVisible()

    await page.getByRole('button', { name: /画面/ }).click()
    const framePanel = page.locator('.t2i-control-layer-panel.is-frame')
    await expect(framePanel).toHaveCSS('position', 'absolute')
    await expect(framePanel).toHaveCSS('z-index', '48')
    await expect(framePanel).toHaveCSS('transition-duration', '0.16s, 0.19s')
    const selectedRatio = framePanel.locator('.t2i-compact-ratio-grid button.is-selected')
    const hoveredRatio = page.getByRole('button', { name: '16:9' })
    await expect(selectedRatio).toHaveCount(1)
    await expect(selectedRatio.locator('i')).toHaveClass(/is-square/)
    await expect(selectedRatio.locator('i')).toHaveCSS('width', '18px')
    await expect(framePanel.getByRole('button', { name: /8K/ })).toHaveCount(0)
    await hoveredRatio.click()
    await page.getByRole('button', { name: '4K' }).click()
    await page.getByRole('button', { name: '立即生成' }).click()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await expect(page.locator('.ai-cost-confirm-total')).toContainText('12 积分')
    await expect(page.locator('.ai-cost-confirm-balance')).toContainText('支付后余额')
    await expect(page.getByLabel('不再每次确认')).toBeVisible()
    await expect(page.locator('.ai-cost-confirm-layer')).toHaveCSS('z-index', '2500')
    await expect(page.locator('.ai-cost-confirm-layer')).toHaveAttribute('data-dialog-motion-state', 'entered')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.ai-cost-confirm-layer')).toHaveAttribute('data-dialog-motion-state', 'exiting')
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toHaveCount(0)

    await page.getByRole('button', { name: '立即生成' }).click()
    await expect(page.locator('.ai-cost-confirm-layer')).toHaveAttribute('data-dialog-motion-state', 'entered')
    await page.getByRole('button', { name: '确认', exact: true }).click()

    await expect.poll(() => createBody).not.toBeNull()
    expect(createBody.type).toBe('t2i')
    expect(createBody.count).toBe(1)
    expect(createBody.inputKeys).toEqual(['references/product.png'])
    expect(createBody.params.aspectRatio).toBe('16:9')
    expect(createBody.params.resolutionScale).toBe('4K')
    expect(createBody.params.outputSize).toBe(createBody.params.size)
    expect(createBody.params.outputSize).not.toBe('1024x1024')
    expect(createBody.params.skillIds).toEqual(
      expect.arrayContaining(['preserve-4k-upscale', 'style-director', 'detail-qa']),
    )
    await expect(page.locator('.t2i-stage-media img')).toBeVisible({ timeout: 8_000 })
  })

  test('text-to-image honors the saved cost confirmation preference', async ({ page }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    let createCount = 0
    await page.route('**/api/v1/tasks**', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { items: [], nextCursor: null })
        return
      }
      createCount += 1
      await fulfillJson(route, {
        task: {
          id: 'confirmed-direct-task',
          type: 't2i',
          status: 'queued',
          prompt: route.request().postDataJSON()?.prompt || '',
          createdAt: new Date().toISOString(),
        },
      })
    })

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('创作描述').fill('费用确认弹窗检查')
    await page.getByRole('button', { name: '立即生成' }).click()

    await expect(page.getByRole('dialog', { name: '确认生成费用' })).toHaveCount(0)
    await expect.poll(() => createCount).toBe(1)
  })

  test('text-to-image uses provider-native settings when model formats are not declared', async ({
    page,
  }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.wallpaperGeneration': {
            enabled: true,
            config: {
              creditCost: 3,
              publicModels: [
                {
                  ...textToImageModel,
                  id: 'provider-native-format',
                  label: 'Provider Native',
                  creditCost: 3,
                  pricePoints: 3,
                  outputFormats: [],
                  moderationLevels: [],
                },
              ],
            },
          },
        },
        pageLayout: {},
        blacklist: { blocked: false },
      }),
    )
    let createBody = null
    await page.route('**/api/v1/tasks**', async (route) => {
      if (route.request().method() !== 'POST') {
        await fulfillJson(route, { items: [], nextCursor: null })
        return
      }
      createBody = route.request().postDataJSON()
      await fulfillJson(route, {
        task: {
          id: 'provider-native-task',
          type: 't2i',
          status: 'queued',
          prompt: createBody.prompt,
          params: createBody.params,
          createdAt: await page.evaluate(() => new Date().toISOString()),
        },
      })
    })

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /输出/ })).toContainText(
      '模型内置 · 模型内置',
    )
    await page.getByLabel('创作描述').fill('使用模型内置输出格式生成图片')
    await page.getByRole('button', { name: '立即生成' }).click()

    await expect.poll(() => createBody).not.toBeNull()
    expect(createBody.params.publicModelKey).toBe('provider-native-format')
    expect(createBody.params).not.toHaveProperty('outputFormat')
    expect(createBody.params).not.toHaveProperty('moderationLevel')
  })

  test('text-to-image groups a batch without treating thumbnails as extra outputs', async ({
    page,
  }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    const createdAt = await page.evaluate(() => new Date().toISOString())
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: [
          {
            id: 'batch-output-1',
            type: 't2i',
            status: 'succeeded',
            prompt: '批次图片布局测试',
            params: {
              batchId: 'batch-layout',
              batchIndex: 0,
              batchSize: 2,
              aspectRatio: '1:1',
            },
            originalUrls: ['/sucai/home-intro-02.png'],
            thumbnailUrls: ['/sucai/game-ui-1785420083438.webp'],
            createdAt,
            finishedAt: createdAt,
          },
          {
            id: 'batch-output-2',
            type: 't2i',
            status: 'succeeded',
            prompt: '批次图片布局测试',
            params: {
              batchId: 'batch-layout',
              batchIndex: 1,
              batchSize: 2,
              aspectRatio: '1:1',
            },
            originalUrls: ['/sucai/home-intro-03.png'],
            thumbnailUrls: ['/sucai/game-character-1785420185589.webp'],
            createdAt,
            finishedAt: createdAt,
          },
        ],
        nextCursor: null,
      }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.t2i-stage-grid .t2i-stage-cell')).toHaveCount(2)
    await expect(page.locator('.t2i-stage-grid .t2i-stage-cell-media')).toHaveCount(2)

    await page.locator('.t2i-stage-cell-media').first().click()
    await expect(page.getByRole('dialog', { name: '全屏预览' })).toBeVisible()
    await expect(page.locator('.t2i-lightbox')).toHaveCSS('z-index', '10050')
    await expect(page.getByRole('button', { name: '下一张' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '缩小图片' })).toBeVisible()
    await expect(page.getByRole('button', { name: '放大图片' })).toBeVisible()
    await expect(page.getByRole('button', { name: '适应屏幕' })).toBeVisible()
    await expect(page.getByRole('button', { name: '局部编辑图片' })).toBeVisible()
    await page.getByRole('button', { name: '删除图片' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.locator('.delete-confirm__backdrop')).toHaveCSS('z-index', '10100')
    await expect(page.getByRole('dialog', { name: '全屏预览' })).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '关闭预览' }).click()
    await expect(page.getByRole('dialog', { name: '全屏预览' })).toHaveCount(0)
  })

  test('text-to-image canvas follows Vue image sizing and transparent output rules', async ({
    page,
  }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    const createdAt = await page.evaluate(() => new Date().toISOString())
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: [
          {
            id: 'natural-landscape',
            type: 't2i',
            status: 'succeeded',
            prompt: '真实比例优先',
            params: { aspectRatio: '1:1', transparentPngEnabled: true },
            originalUrls: ['/sucai/home-intro-03.png'],
            thumbnailUrls: ['/sucai/game-character-1785420185589.webp'],
            thumbnailKeys: ['thumb/natural-landscape.webp'],
            createdAt,
            finishedAt: createdAt,
          },
        ],
        nextCursor: null,
      }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    const media = page.locator('.t2i-stage-media')
    await expect(media).toHaveClass(/is-transparent-output/)
    await expect(media.locator('.progressive-authenticated-image')).toBeVisible()
    await expect(media.locator('.progressive-authenticated-image__layer.is-original img')).toBeVisible()
    await expect.poll(async () => {
      const value = await page.locator('.t2i-stage-frame').evaluate((node) => {
        const [width, height] = getComputedStyle(node).aspectRatio.split('/').map(Number)
        return width / height
      })
      return value
    }).toBeCloseTo(1928 / 816, 2)
    await expect(media.locator('img').last()).toHaveCSS('object-fit', 'contain')
  })

  test('text-to-image canvas isolates a broken output from the remaining group', async ({
    page,
  }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    const createdAt = await page.evaluate(() => new Date().toISOString())
    await page.route('**/missing-output.png', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.fulfill({ status: 404, body: '' })
    })
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, {
        items: [
          {
            id: 'broken-output',
            type: 't2i',
            status: 'succeeded',
            prompt: '坏图隔离',
            params: { batchId: 'broken-group', batchIndex: 0, batchSize: 2 },
            originalUrls: ['/missing-output.png'],
            createdAt,
            finishedAt: createdAt,
          },
          {
            id: 'valid-output',
            type: 't2i',
            status: 'succeeded',
            prompt: '坏图隔离',
            params: { batchId: 'broken-group', batchIndex: 1, batchSize: 2 },
            originalUrls: ['/sucai/home-intro-02.png'],
            createdAt,
            finishedAt: createdAt,
          },
        ],
        nextCursor: null,
      }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.t2i-stage-grid .t2i-stage-cell')).toHaveCount(2)
    await expect(page.locator('.t2i-stage-grid')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.t2i-stage-media img')).toBeVisible()
  })

  test('text-to-image queued work has no generation elapsed timer', async ({ page }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    const createdAt = await page.evaluate(() => new Date().toISOString())
    let body = null
    await page.route('**/api/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON()
        await fulfillJson(route, {
          task: {
            id: 'queued-task',
            type: 't2i',
            status: 'queued',
            prompt: body.prompt,
            params: body.params,
            createdAt,
          },
        })
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/api/v1/tasks/queued-task', (route) =>
      fulfillJson(route, {
        task: {
          id: 'queued-task',
          type: 't2i',
          status: 'queued',
          prompt: body?.prompt || '',
          params: body?.params || {},
          createdAt,
          startedAt: '',
        },
      }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('创作描述').fill('排队计时测试')
    await page.getByRole('button', { name: '立即生成' }).click()
    await expect(page.locator('.t2i-stage-pending')).toContainText('排队中')
    await page.waitForTimeout(1_200)
    await expect(page.locator('.t2i-pending-elapsed')).toHaveCount(0)
  })

  test('text-to-image keeps prompt and parameter controls reachable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockTextToImageApis(page)
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    const sidebar = page.locator('.t2i-sidebar')
    await sidebar.scrollIntoViewIfNeeded()
    await expect(page.getByLabel('创作描述')).toBeVisible()
    await page.locator('.t2i-side-scroll').evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(page.getByRole('button', { name: /增强/ })).toBeVisible()

    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox.width).toBeLessThanOrEqual(366)
    expect(sidebarBox.x).toBeGreaterThanOrEqual(12)
  })

  test('text-to-image cancels a queued server task through the existing contract', async ({
    page,
  }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    const createdAt = await page.evaluate(() => new Date().toISOString())
    let cancelBody = null
    await page.route('**/api/v1/tasks**', async (route) => {
      const method = route.request().method()
      if (method === 'POST') {
        const request = route.request().postDataJSON()
        await fulfillJson(route, {
          task: {
            id: 'cancel-task',
            type: 't2i',
            status: 'queued',
            prompt: request.prompt,
            params: request.params,
            createdAt,
          },
        })
        return
      }
      if (method === 'PATCH') {
        cancelBody = route.request().postDataJSON()
        await fulfillJson(route, {
          task: {
            id: 'cancel-task',
            type: 't2i',
            status: 'canceled',
            prompt: '取消任务测试',
            params: {},
            createdAt,
            finishedAt: createdAt,
          },
        })
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('创作描述').fill('取消任务测试')
    await page.getByRole('button', { name: '立即生成' }).click()
    await expect(page.locator('.t2i-stage-pending')).toContainText('排队中')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(() => cancelBody).toEqual({ status: 'canceled' })
    await expect(page.locator('.t2i-stage-copy')).toContainText('已取消')
  })

  test('text-to-image submission and images never block route navigation', async ({ page }) => {
    await mockTextToImageApis(page, { requireCostConfirm: false })
    await page.route('**/api/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 20_000))
        await fulfillJson(route, {}).catch(() => null)
        return
      }
      await fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/sucai/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await route.continue().catch(() => null)
    })

    await page.goto('/text-to-image', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('创作描述').fill('请求未完成时立即离开')
    await page.getByRole('button', { name: '立即生成' }).click()
    const startedAt = Date.now()
    await page.locator('a[href="/"]:visible').first().click()
    await expect(page).toHaveURL(/\/$/, { timeout: 700 })
    expect(Date.now() - startedAt).toBeLessThan(700)
    await expect(page.locator('.commercial-home')).toBeVisible()
  })
})
