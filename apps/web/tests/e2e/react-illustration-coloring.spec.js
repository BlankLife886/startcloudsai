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
    await expect(page.getByTitle('展开参考图')).toContainText('1/3')
    await page.getByTitle('展开参考图').click()
    await expect(page.locator('.coloring-reference-card')).toHaveCount(1)
  })
})
