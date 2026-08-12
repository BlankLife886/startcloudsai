import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const user = {
  id: 'react-coloring-user',
  email: 'react-coloring@example.com',
  username: 'React 染色用户',
}

const model = {
  id: 'react-coloring-model',
  publicModelKey: 'react-coloring-model',
  label: '插画染色模型',
  creditCost: 3,
  capabilities: ['image.edit', 'imageToImage'],
  resolutions: ['1K', '2K'],
  aspectRatios: ['auto', '1:1', '16:9'],
  aspectRatiosByResolution: {
    '1K': ['auto', '1:1'],
    '2K': ['auto', '16:9'],
  },
  qualities: ['medium', 'high'],
  outputFormats: ['png', 'webp'],
  moderationLevels: ['auto'],
  maxReferenceImages: 2,
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test.describe('React illustration coloring interactions', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.illustrationColoring': {
            enabled: true,
            config: { publicModels: [model] },
          },
        },
        aiModelCatalog: { publicModels: [model], featurePublicModels: [model] },
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availablePoints: 100 }),
    )
  })

  test('uploads source and reference, confirms cost, then creates the selected batch', async ({ page }) => {
    const createdBodies = []
    let uploadIndex = 0
    await page.route('**/api/v1/uploads', (route) => {
      uploadIndex += 1
      return fulfillJson(route, {
        key: `uploads/coloring/input-${uploadIndex}.png`,
        url: `/api/v1/media/uploads/coloring/input-${uploadIndex}.png`,
      })
    })
    await page.route('**/api/v1/tasks**', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        createdBodies.push(body)
        const id = `coloring-created-${createdBodies.length}`
        return fulfillJson(route, {
          task: {
            id,
            type: 'coloring',
            status: 'queued',
            prompt: body.prompt,
            params: body.params,
            inputKeys: body.inputKeys,
            createdAt: new Date().toISOString(),
          },
        })
      }
      const url = new URL(request.url())
      if (/\/tasks\/[^/?]+$/.test(url.pathname)) {
        const id = url.pathname.split('/').pop()
        return fulfillJson(route, {
          task: {
            id,
            type: 'coloring',
            status: 'queued',
            params: { _kind: 'illustration-coloring' },
            createdAt: new Date().toISOString(),
          },
        })
      }
      return fulfillJson(route, { items: [], nextCursor: null })
    })

    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    const fileInputs = page.locator('input[type="file"]')
    await fileInputs.nth(0).setInputFiles({ name: 'line-art.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(page.getByAltText('线稿预览')).toBeVisible()
    await fileInputs.nth(1).setInputFiles({ name: 'palette.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(page.locator('.coloring-reference-card')).toHaveCount(1)

    await page.getByLabel('生成张数').click()
    await page.getByRole('option', { name: '2 张' }).click()
    await page.getByPlaceholder(/描述主色/).fill('青绿色主色，暖金色高光，保持所有线稿细节')
    await page.getByRole('button', { name: /开始 AI 染色 · 2 张/ }).click()

    const dialog = page.getByRole('dialog', { name: '确认生成费用' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('3 积分 / 张 × 2 张')
    await expect(createdBodies).toHaveLength(0)
    await dialog.getByRole('button', { name: '确认', exact: true }).click()

    await expect.poll(() => createdBodies.length).toBe(2)
    expect(uploadIndex).toBe(2)
    for (const body of createdBodies) {
      expect(body.type).toBe('coloring')
      expect(body.params._kind).toBe('illustration-coloring')
      expect(body.params.referenceImageUrls).toHaveLength(1)
      expect(body.inputKeys).toHaveLength(2)
      expect(body.params.outputWidth).toBeGreaterThan(0)
      expect(body.params.outputHeight).toBeGreaterThan(0)
      expect(body.params.resolutionScale).toBe('2K')
      expect(body.params.aspectRatio).toBe('auto')
      expect(body.params.quality).toBe('medium')
      expect(body.params.outputFormat).toBe('png')
      expect(body.params.moderationLevel).toBe('auto')
    }
    expect(createdBodies.map((body) => body.params.variantIndex)).toEqual([1, 2])
    expect(new Set(createdBodies.map((body) => body.params.batchId)).size).toBe(1)
    await expect(page.locator('.coloring-batch-card')).toHaveCount(2)
    await expect(page.locator('.coloring-batch-status')).toContainText('已完成 0 / 2')
  })

  test('reference panel can be collapsed without removing selected references', async ({ page }) => {
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })
    const referenceInput = page.locator('input[type="file"]').nth(1)
    await referenceInput.setInputFiles({ name: 'palette.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(page.locator('.coloring-reference-card')).toHaveCount(1)
    await page.getByTitle('收起参考图').click()
    await expect(page.getByTitle('展开参考图')).toContainText('1/1')
    await page.getByTitle('展开参考图').click()
    await expect(page.locator('.coloring-reference-card')).toHaveCount(1)
  })

  test('output settings only expose capabilities returned for the selected model', async ({ page }) => {
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.coloring-sidebar .coloring-library-launcher')).toHaveCount(0)
    const toolbarLibrary = page.locator('.coloring-stage-toolbar .coloring-toolbar-library')
    await expect(toolbarLibrary.getByRole('button', { name: '资产库' })).toBeVisible()
    await expect(toolbarLibrary.getByRole('button', { name: '历史记录' })).toBeVisible()
    await expect(toolbarLibrary.getByRole('button', { name: '提示词库' })).toBeVisible()
    await toolbarLibrary.getByRole('button', { name: '历史记录' }).click()
    await expect(page.getByRole('dialog', { name: '染色资源' })).toBeVisible()
    await page.getByRole('dialog', { name: '染色资源' }).getByRole('button', { name: '关闭' }).click()

    await expect(page.getByLabel('分辨率')).toContainText('2K')
    await page.getByLabel('分辨率').click()
    await expect(page.getByRole('option', { name: '4K' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByLabel('输出比例').click()
    await expect(page.getByRole('option', { name: '原图比例' })).toBeVisible()
    await expect(page.getByRole('option', { name: '16:9 横屏' })).toBeVisible()
    await expect(page.getByRole('option', { name: '1:1 方形' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByLabel('质量').click()
    await expect(page.getByRole('option', { name: '低' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: '中' })).toBeVisible()
    await expect(page.getByRole('option', { name: '高' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByLabel('格式').click()
    await expect(page.getByRole('option', { name: 'PNG' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'WebP' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'JPEG' })).toHaveCount(0)
  })
})

test('signed-out illustration coloring ignores residual guest history', async ({ page }) => {
  await installVisualBaseline(page)
  await page.addInitScript(() => {
    const key = 'walleven_illustration_coloring_history_v2'
    const stale = [{
      id: 'stale-coloring-result',
      status: 'completed',
      title: '不应显示的旧任务',
      sourcePreview: '/sucai/home-intro-03.png',
      sourceRemoteUrl: '/sucai/home-intro-03.png',
      resultUrl: '/sucai/home-intro-03.png',
      outputs: ['/sucai/home-intro-03.png'],
      sourceWidth: 1024,
      sourceHeight: 1024,
    }]
    localStorage.setItem(`walleven_guest_local_${key}`, JSON.stringify(stale))
    localStorage.setItem(key, JSON.stringify(stale))
  })
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, {
      routes: {},
      features: { 'ai.illustrationColoring': { enabled: true, config: { publicModels: [model] } } },
      blacklist: { blocked: false },
    }),
  )

  await page.goto('/ai-illustration-coloring', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('登录后开始染色')).toHaveCount(0)
  await expect(page.getByText('不应显示的旧任务')).toHaveCount(0)
  await expect(page.getByAltText('线稿预览')).toHaveCount(0)
  await expect(page.locator('.coloring-history-card')).toHaveCount(0)
  await expect(page.locator('.coloring-board-empty')).toContainText('上传线稿开始创作')
})
