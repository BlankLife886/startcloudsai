import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { fulfillJson } from './helpers/authMocks.js'

const user = {
  id: 'react-design-workshop-user',
  email: 'design-react@example.com',
  username: 'React 设计用户',
}

const model = {
  id: 'ui-design-pro',
  publicModelKey: 'ui-design-pro',
  label: 'UI 设计 Pro',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['16:9', '9:16'],
  qualities: ['high'],
  resolutions: ['2K'],
  maxReferenceImages: 6,
  creditCost: 2,
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function mockBase(page) {
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      routes: {},
      features: {
        'ai.uiDesign': {
          enabled: true,
          config: {
            publicModels: [model],
            analysisModels: [{ label: 'UI 分析模型', model: 'ui-analysis', default: true }],
          },
        },
      },
      aiModelCatalog: { providers: [], publicModels: [model], featurePublicModels: [model] },
      blacklist: { blocked: false },
    }),
  )
  await page.route('**/api/v1/pricing', (route) =>
    fulfillJson(route, { taskPointPrices: { ui_design: 2 } }),
  )
  await page.route('**/api/v1/me/wallet', (route) =>
    fulfillJson(route, { availableCents: 80, balanceCents: 80 }),
  )
}

test.describe('React design workshop interactions', () => {
  test('uploads one reference and creates device-specific ui_design tasks', async ({ page }) => {
    test.setTimeout(60_000)
    await mockBase(page)
    const created = []
    const completed = new Map()
    let taskNumber = 0
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'uploads/design/reference.png',
        url: '/api/v1/files/uploads/design/reference.png',
      }),
    )
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        const id = `ui-created-${++taskNumber}`
        created.push(body)
        completed.set(id, {
          id,
          type: 'ui_design',
          status: 'succeeded',
          prompt: body.prompt,
          params: body.params,
          inputKeys: body.inputKeys,
          outputUrls: [`/visual/${id}.png`],
          originalUrls: [`/visual/${id}.png`],
          thumbnailUrls: [`/visual/${id}.png`],
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        })
        return fulfillJson(route, {
          task: { ...completed.get(id), status: 'queued', outputUrls: [], originalUrls: [] },
        })
      }
      const ids = String(url.searchParams.get('ids') || '').split(',').filter(Boolean)
      if (ids.length) return fulfillJson(route, { items: ids.map((id) => completed.get(id)).filter(Boolean) })
      return fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/visual/ui-created-*.png', (route) =>
      route.fulfill({ body: tinyPng, contentType: 'image/png' }),
    )

    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/产品与页面描述|Product and page description/).fill('为设计团队创建项目工作台')
    await page.getByRole('button', { name: /设计系统|页面设定|Design system|Page settings/ }).click()
    await page.getByRole('button', { name: '手机端 9:16' }).click()
    await expect(page.getByRole('button', { name: /设计系统|页面设定|Design system|Page settings/ })).toContainText('手机端')
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.getByRole('button', { name: /参考图重绘/ }).click()

    await expect.poll(() => created.length).toBe(2)
    expect(created.map((item) => item.type)).toEqual(['ui_design', 'ui_design'])
    expect(created.map((item) => item.params.deviceId)).toEqual(['web', 'phone'])
    expect(created.map((item) => item.params.aspectRatio)).toEqual(['16:9', '9:16'])
    expect(created.every((item) => item.params.size === item.params.outputSize)).toBe(true)
    expect(created.every((item) => item.params.publicModelKey === model.id)).toBe(true)
    expect(created.every((item) => item.inputKeys[0] === 'uploads/design/reference.png')).toBe(true)
    await expect(page.getByAltText('UI 设计稿预览')).toBeVisible()
    await expect(page.getByRole('button', { name: '框选优化' })).toBeVisible()
    await expect(page.getByRole('button', { name: '迭代此版本' })).toBeVisible()
    await expect(page.getByRole('button', { name: '下载' })).toBeVisible()
    await expect(page.getByRole('button', { name: /打开 V1 侧边栏/ })).toBeVisible()

    await page.getByRole('button', { name: '查看当前设计稿大图' }).click()
    const preview = page.getByRole('dialog', { name: /全屏预览/ })
    await expect(preview).toBeVisible()
    await expect.poll(() => preview.evaluate((node) => node.parentElement === document.body)).toBe(true)
    await expect.poll(() => preview.evaluate((node) => document.activeElement === node)).toBe(true)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    for (const action of ['copy-image', 'reference', 'region-edit', 'copy-prompt', 'favorite', 'publish', 'delete']) {
      await expect(page.locator(`[data-preview-action="${action}"]`)).toHaveCount(1)
    }
    await expect(page.locator('[data-preview-action="copy-image"]')).toBeEnabled()
    await expect(page.locator('[data-preview-action="reference"]')).toBeDisabled()
    await expect(page.locator('[data-preview-action="region-edit"]')).toBeDisabled()
    await expect(page.locator('[data-preview-action="favorite"]')).toBeDisabled()
    await expect(page.locator('[data-preview-action="publish"]')).toBeDisabled()
    await expect(page.locator('[data-preview-action="delete"]')).toBeDisabled()

    const closeButton = page.locator('[data-preview-command="close"]')
    await preview.dispatchEvent('pointermove')
    await expect.poll(async () => Math.round((await closeButton.boundingBox()).y)).toBe(20)
    const closeBoxBeforeHover = await closeButton.boundingBox()
    await closeButton.hover()
    const closeBoxAfterHover = await closeButton.boundingBox()
    expect(closeBoxAfterHover).toEqual(closeBoxBeforeHover)

    await page.getByRole('button', { name: '显示信息' }).click()
    await expect(page.locator('.preview-info-panel')).toContainText('V1')
    await expect(page.locator('.preview-info-panel')).toContainText('UI 设计稿')
    await expect(page.locator('.preview-info-panel')).not.toContainText('Wallhaven')
    await page.locator('.info-close-btn').click()

    await page.locator('[data-preview-action="filters"]').click()
    await page.locator('[data-filter-tab="styles"]').click()
    await page.locator('.filter-preset-btn').filter({ hasText: '油画' }).click()
    await expect
      .poll(() => page.locator('.preview-main-pane .preview-image').getAttribute('src'))
      .toMatch(/^data:image\/jpeg/)
    await page.locator('.filter-close-btn').click()

    await page.getByRole('button', { name: '桌面样机预览' }).click()
    await expect(page.locator('.preview-device-mockup.is-desktop')).toBeVisible()
    await expect(page.locator('.desktop-metal-bezel')).toBeVisible()
    await expect(page.locator('.desktop-folder')).toHaveCount(3)
    await expect(page.locator('.desktop-clock')).toBeVisible()
    const mockupScreen = page.locator('.preview-device-screen')
    const mockupImage = page.locator('.preview-device-screen .device-screen-image').last()
    const mockupPositionBefore = await mockupImage.evaluate((image) => image.style.objectPosition)
    const mockupBox = await mockupScreen.boundingBox()
    await page.mouse.move(mockupBox.x + mockupBox.width / 2, mockupBox.y + mockupBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(mockupBox.x + mockupBox.width / 2 + 90, mockupBox.y + mockupBox.height / 2 + 45)
    await page.mouse.up()
    await expect.poll(() => mockupImage.evaluate((image) => image.style.objectPosition)).not.toBe(mockupPositionBefore)
    await page.getByRole('button', { name: '样机配置' }).click()
    await expect(page.getByRole('complementary', { name: '桌面样机配置' })).toBeVisible()
    await page.getByRole('button', { name: 'Windows' }).click()
    await expect(page.locator('.desktop-export-chip')).toContainText('1920 x 1080')
    await page.getByRole('button', { name: '桌面样机预览' }).click()
    await expect(page.locator('.preview-device-mockup')).toHaveCount(0)

    await page.getByRole('button', { name: '手机样机预览' }).click()
    await expect(page.locator('.preview-device-mockup.is-phone')).toBeVisible()
    await expect(page.locator('.phone-status-bar')).toBeVisible()
    await expect(page.locator('.phone-companion')).toHaveCount(2)
    await page.getByRole('button', { name: '手机样机预览' }).click()

    const fullscreenImage = page.locator('.preview-main-pane .preview-image')
    const imageRotation = () => fullscreenImage.evaluate((image) => {
      const matrix = new DOMMatrix(getComputedStyle(image).transform)
      return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI)
    })
    await page.getByRole('button', { name: '旋转图片' }).click()
    await expect.poll(imageRotation).toBe(90)
    await page.getByRole('button', { name: '切换为铺满显示' }).click()
    await expect.poll(imageRotation).toBe(90)
    await page.getByRole('button', { name: '切换为完整显示' }).click()
    await expect.poll(imageRotation).toBe(90)
    await page.locator('[data-preview-command="reset-view"]').click()
    await expect.poll(imageRotation).toBe(0)

    await page.getByRole('button', { name: '分解图片（3x3）' }).click()
    await expect(page.getByRole('dialog', { name: '图片分解' })).toBeVisible()
    await expect(page.locator('.decompose-tile')).toHaveCount(9)
    await page.getByRole('button', { name: /分块 1/ }).click()
    await expect(page.getByRole('button', { name: /分块 1/ })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: '2x2' }).click()
    await expect(page.locator('.decompose-tile')).toHaveCount(4)
    await page.getByRole('button', { name: '取消分解' }).click()

    const imageBox = await fullscreenImage.boundingBox()
    await page.mouse.move(imageBox.x + imageBox.width * 0.75, imageBox.y + imageBox.height * 0.25)
    await page.mouse.wheel(0, -400)
    await expect(page.getByRole('button', { name: '移动当前预览范围' })).toBeVisible()
    await expect
      .poll(() =>
        fullscreenImage.evaluate((image) => {
          const matrix = new DOMMatrix(getComputedStyle(image).transform)
          return matrix.m41 < 0 && matrix.m42 > 0
        }),
      )
      .toBe(true)

    const minimap = page.getByRole('button', { name: '移动当前预览范围' })
    const minimapViewport = minimap.locator('.preview-minimap-viewport')
    const minimapBox = await minimap.boundingBox()
    const minimapViewportBox = await minimapViewport.boundingBox()
    const minimapPositionBefore = await minimapViewport.evaluate((node) => `${node.style.left}:${node.style.top}`)
    await page.mouse.move(
      minimapViewportBox.x + minimapViewportBox.width / 2,
      minimapViewportBox.y + minimapViewportBox.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      minimapBox.x + minimapBox.width * 0.2,
      minimapBox.y + minimapBox.height * 0.8,
    )
    await expect
      .poll(() => minimapViewport.evaluate((node) => `${node.style.left}:${node.style.top}`))
      .not.toBe(minimapPositionBefore)
    await page.mouse.up()

    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(imageBox.x + imageBox.width / 2 + 120, imageBox.y + imageBox.height / 2 + 80)
    await expect(fullscreenImage).toHaveCSS('transition-duration', '0s')
    await page.mouse.up()
    await expect(fullscreenImage).toHaveCSS('transition-duration', '0.2s')

    await page.setViewportSize({ width: 390, height: 844 })
    await preview.dispatchEvent('pointermove')
    await expect
      .poll(() =>
        page.locator('.preview-controls .preview-btn').evaluateAll((buttons) =>
          buttons.every((button) => {
            const rect = button.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= window.innerWidth
          }),
        ),
      )
      .toBe(true)

    await page.locator('[data-preview-command="close"]').dispatchEvent('click')
    await expect(preview).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('pending reference upload does not block route navigation', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/产品与页面描述|Product and page description/).fill('路由非阻塞测试')
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.getByRole('button', { name: /参考图重绘/ }).click()
    await expect(page.locator('.dws-generate')).toContainText('正在上传参考图')
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('downloads one offline handoff archive with the artboard and machine-readable files', async ({
    page,
  }) => {
    await mockBase(page)
    const task = {
      id: 'handoff-task',
      type: 'ui_design',
      status: 'succeeded',
      input: {
        batchId: 'handoff-batch',
        batchIndex: 0,
        deviceId: 'web',
        viewLabel: '桌面端',
      },
      originalUrls: ['/visual/handoff-original.png'],
      thumbnailUrls: ['/visual/handoff-thumbnail.png'],
      displayUrls: ['/visual/handoff-display.png'],
      outputUrls: ['/visual/handoff-thumbnail.png'],
      createdAt: new Date().toISOString(),
    }
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [task], nextCursor: null }),
    )
    await page.route('**/api/v1/assistant/runs**', (route) =>
      fulfillJson(route, { runs: [] }),
    )
    await page.route('**/visual/handoff-*.png', (route) =>
      route.fulfill({ body: tinyPng, contentType: 'image/png' }),
    )

    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await expect(page.getByAltText('UI 设计稿预览')).toBeVisible()
    await page.getByRole('button', { name: '交付' }).click()
    await expect(page.getByRole('dialog', { name: '设计交付' })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出交付包' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/-handoff\.zip$/)
    const archivePath = await download.path()
    const files = unzipSync(await readFile(archivePath))
    expect(Object.keys(files).sort()).toEqual([
      'README.md',
      'design-system.json',
      'design.png',
      'tokens.css',
    ])
    const handoff = JSON.parse(strFromU8(files['design-system.json']))
    expect(handoff.coordinateSpace).toBe('source-image-pixels')
    expect(handoff.source).toEqual({ width: 1, height: 1 })
    expect(handoff.imageUrl).toBe('design.png')
    expect(strFromU8(files['README.md'])).toContain('design.png')
    expect(strFromU8(files['tokens.css'])).toContain('--color-brand')
  })

  test('resumes an active ui design task after loading history', async ({ page }) => {
    await mockBase(page)
    let batchPolls = 0
    const activeTask = {
      id: 'resumed-ui-task',
      type: 'ui_design',
      status: 'running',
      input: { batchId: 'resume-batch', batchIndex: 0, deviceId: 'web', viewLabel: '桌面端' },
      outputUrls: [],
      originalUrls: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.searchParams.get('ids')) {
        batchPolls += 1
        return fulfillJson(route, {
          items: [{
            ...activeTask,
            status: 'succeeded',
            originalUrls: ['/visual/resumed-ui-original.png'],
            thumbnailUrls: ['/visual/resumed-ui-thumbnail.png'],
            outputUrls: ['/visual/resumed-ui-thumbnail.png'],
            finishedAt: new Date().toISOString(),
          }],
        })
      }
      return fulfillJson(route, { items: [activeTask], nextCursor: null })
    })
    await page.route('**/api/v1/assistant/runs**', (route) =>
      fulfillJson(route, { runs: [] }),
    )
    await page.route('**/visual/resumed-ui-*.png', (route) =>
      route.fulfill({ body: tinyPng, contentType: 'image/png' }),
    )

    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })

    await expect.poll(() => batchPolls).toBeGreaterThan(0)
    await expect(page.getByAltText('UI 设计稿预览')).toBeVisible()
    await expect(page.locator('.dws-running')).toHaveCount(0)
  })

  test('requires explicit confirmation before abandoning an upstream ui task', async ({ page }) => {
    await mockBase(page)
    let cancelRequests = 0
    const runningTask = {
      id: 'cancel-ui-task',
      type: 'ui_design',
      status: 'running',
      input: { batchId: 'cancel-batch', batchIndex: 0, deviceId: 'web', viewLabel: '桌面端' },
      outputUrls: [],
      originalUrls: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        return fulfillJson(route, { task: { ...runningTask, status: 'queued' } })
      }
      if (request.method() === 'PATCH') {
        cancelRequests += 1
        const body = request.postDataJSON()
        if (!body.acknowledgeUpstream) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              code: 'task_cancel_confirmation_required',
              error: '任务已提交上游',
            }),
          })
        }
        return fulfillJson(route, { task: { ...runningTask, status: 'canceled' } })
      }
      if (url.searchParams.get('ids')) {
        return fulfillJson(route, { items: [runningTask] })
      }
      return fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/api/v1/assistant/runs**', (route) =>
      fulfillJson(route, { runs: [] }),
    )

    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/产品与页面描述|Product and page description/).fill('需要取消确认的工作台')
    await page.getByRole('button', { name: /生成设计稿/ }).click()
    await expect(page.locator('.dws-running')).toBeVisible()
    await page.getByRole('button', { name: '停止生成' }).click()

    const dialog = page.getByRole('alertdialog', { name: '停止接收这次生成结果？' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.dws-running')).toBeVisible()
    await dialog.getByRole('button', { name: '仍然停止' }).click()

    await expect.poll(() => cancelRequests).toBe(2)
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.dws-running')).toHaveCount(0)
  })

  test('tablet and phone workspace tabs keep controls and canvas in separate geometry', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.route('**/api/v1/assistant/runs**', (route) =>
      fulfillJson(route, { items: [] }),
    )

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })

      const controlsTab = page.getByRole('tab', { name: '需求与规范' })
      const canvasTab = page.getByRole('tab', { name: /画布/ })
      const panel = page.locator('.dws-panel')
      const stage = page.locator('.dws-stage')

      await expect(controlsTab).toHaveAttribute('aria-selected', 'true')
      await expect(panel).toBeVisible()
      await expect(stage).toBeHidden()

      await canvasTab.click()
      await expect(canvasTab).toHaveAttribute('aria-selected', 'true')
      await expect(panel).toBeHidden()
      await expect(stage).toBeVisible()

      const geometry = await page.evaluate(() => {
        const root = document.querySelector('.dws')
        const shell = document.querySelector('.dws-shell')
        const stage = document.querySelector('.dws-stage').getBoundingClientRect()
        return {
          rootRight: root.getBoundingClientRect().right,
          shellRight: shell.getBoundingClientRect().right,
          stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          overflow: document.documentElement.scrollWidth - innerWidth,
        }
      })
      expect(geometry.rootRight).toBeLessThanOrEqual(geometry.viewport.width)
      expect(geometry.shellRight).toBeLessThanOrEqual(geometry.viewport.width)
      expect(geometry.stage.left).toBeGreaterThanOrEqual(0)
      expect(geometry.stage.right).toBeLessThanOrEqual(geometry.viewport.width)
      expect(geometry.stage.top).toBeGreaterThanOrEqual(0)
      expect(geometry.stage.bottom).toBeLessThanOrEqual(geometry.viewport.height)
      expect(geometry.overflow).toBeLessThanOrEqual(1)
    }
  })
})
