import { expect, test } from '@playwright/test'
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
    await page.getByLabel('产品与页面描述').fill('为设计团队创建项目工作台')
    await page.getByRole('button', { name: '手机端 9:16' }).click()
    await page.locator('input[type="file"]').setInputFiles({
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
    await expect(page.locator('.dws-stage-meta')).toContainText('手机端')
  })

  test('pending reference upload does not block route navigation', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/design-workshop', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('产品与页面描述').fill('路由非阻塞测试')
    await page.locator('input[type="file"]').setInputFiles({
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
})
