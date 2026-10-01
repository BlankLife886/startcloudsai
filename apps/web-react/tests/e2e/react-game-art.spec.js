import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const user = { id: 'react-game-art-user', email: 'game-art@example.com', username: '游戏设计用户' }
const model = {
  id: 'game-art-pro', publicModelKey: 'game-art-pro', label: '游戏美术 Pro', default: true,
  capabilities: ['image.generate', 'image.edit', 'imageToImage'], aspectRatios: ['3:4', '16:9', '1:1'],
  qualities: ['high', 'medium'], maxReferenceImages: 4, creditCost: 4,
}
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function mockBase(page) {
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {}, features: { 'ai.gameDesign': { enabled: true, config: { publicModels: [model] } } },
    aiModelCatalog: { providers: [], publicModels: [model], featurePublicModels: [model] }, blacklist: { blocked: false },
  }))
}

test.describe('React game art interactions', () => {
  test('uploads a reference and creates grouped character game_art tasks', async ({ page }) => {
    await mockBase(page)
    const created = []
    const completed = new Map()
    let taskNumber = 0
    await page.route('**/api/v1/uploads', (route) => fulfillJson(route, { key: 'uploads/game/reference.png', url: '/api/v1/files/uploads/game/reference.png' }))
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        const id = `game-created-${++taskNumber}`
        created.push(body)
        completed.set(id, {
          id, type: 'game_art', status: 'succeeded', prompt: body.prompt, params: body.params, inputKeys: body.inputKeys,
          outputUrls: [`/visual/${id}.png`], originalUrls: [`/visual/${id}.png`], thumbnailUrls: [`/visual/${id}.png`],
          createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        })
        return fulfillJson(route, { task: { ...completed.get(id), status: 'queued', outputUrls: [], originalUrls: [] } })
      }
      const ids = String(url.searchParams.get('ids') || '').split(',').filter(Boolean)
      if (ids.length) return fulfillJson(route, { items: ids.map((id) => completed.get(id)).filter(Boolean) })
      return fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/visual/game-created-*.png', (route) => route.fulfill({ body: tinyPng, contentType: 'image/png' }))

    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: tinyPng })
    await page.getByRole('button', { name: /比例与数量/ }).click()
    await page.getByRole('button', { name: '2 张', exact: true }).click()
    await page.locator('.ga-feature-popover').getByTitle('关闭').click()
    await page.getByRole('button', { name: /启动生成/ }).click()

    await expect.poll(() => created.length).toBe(2)
    expect(created.every((item) => item.type === 'game_art')).toBe(true)
    expect(created.every((item) => item.params._kind === 'game-art-character-edit')).toBe(true)
    expect(created.map((item) => item.params.batchIndex)).toEqual([0, 1])
    expect(new Set(created.map((item) => item.params.batchId)).size).toBe(1)
    expect(created.every((item) => item.params.size === item.params.outputSize)).toBe(true)
    expect(created.every((item) => item.params.publicModelKey === model.id)).toBe(true)
    expect(created.every((item) => item.inputKeys[0] === 'uploads/game/reference.png')).toBe(true)
    await expect(page.getByAltText('游戏美术资产')).toHaveCount(2)
  })

  test('pending upload does not block route navigation', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/game-art', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: tinyPng })
    await page.getByRole('button', { name: /启动生成/ }).click()
    await expect(page.locator('.ga-render-copy')).toContainText('上传参考图')
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
