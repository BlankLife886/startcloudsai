import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const user = { id: 'react-model-sheet-user', email: 'model-sheet@example.com', username: '模型设计用户' }
const model = {
  id: 'model-sheet-pro',
  publicModelKey: 'model-sheet-pro',
  label: '模型设计 Pro',
  default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'],
  aspectRatios: ['16:9', '1:1', '9:16'],
  qualities: ['high', 'medium', 'low'],
  maxReferenceImages: 4,
  creditCost: 3,
}
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function mockBase(page) {
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: { 'ai.ultraModelSheet': { enabled: true, config: { publicModels: [model] } } },
    aiModelCatalog: { providers: [], publicModels: [model], featurePublicModels: [model] },
    blacklist: { blocked: false },
  }))
}

test.describe('React model sheet interactions', () => {
  test('uploads references and creates grouped model_sheet view tasks', async ({ page }) => {
    await mockBase(page)
    const created = []
    const completed = new Map()
    let taskNumber = 0
    await page.route('**/api/v1/uploads', (route) => fulfillJson(route, {
      key: 'uploads/model-sheet/reference.png',
      url: '/api/v1/files/uploads/model-sheet/reference.png',
    }))
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        const id = `model-sheet-created-${++taskNumber}`
        created.push(body)
        completed.set(id, {
          id,
          type: 'model_sheet',
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
        return fulfillJson(route, { task: { ...completed.get(id), status: 'queued', outputUrls: [], originalUrls: [] } })
      }
      const ids = String(url.searchParams.get('ids') || '').split(',').filter(Boolean)
      if (ids.length) return fulfillJson(route, { items: ids.map((id) => completed.get(id)).filter(Boolean) })
      return fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/visual/model-sheet-created-*.png', (route) => route.fulfill({ body: tinyPng, contentType: 'image/png' }))

    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: tinyPng })
    await page.getByRole('button', { name: '多张独立视图' }).click()
    await page.getByRole('button', { name: '背面' }).click()
    await page.getByRole('button', { name: '3/4' }).click()
    await page.getByRole('button', { name: /生成 2 张视图/ }).click()

    await expect.poll(() => created.length).toBe(2)
    expect(created.every((item) => item.type === 'model_sheet')).toBe(true)
    expect(created.map((item) => item.params.viewId)).toEqual(['front', 'side'])
    expect(created.map((item) => item.params.batchIndex)).toEqual([0, 1])
    expect(new Set(created.map((item) => item.params.batchId)).size).toBe(1)
    expect(created.every((item) => item.params.size === item.params.outputSize)).toBe(true)
    expect(created.every((item) => item.params.publicModelKey === model.id)).toBe(true)
    expect(created.every((item) => item.inputKeys[0] === 'uploads/model-sheet/reference.png')).toBe(true)
    await expect(page.getByAltText('模型设计')).toBeVisible()
    await expect(page.locator('.ms3-groupbar')).toBeVisible()
  })

  test('pending reference upload does not block route navigation', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: tinyPng })
    await page.getByRole('button', { name: /生成设定板/ }).click()
    await expect(page.locator('.ms3-hud-status')).toContainText('准备参考图')
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
