import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const user = {
  id: 'react-background-user',
  email: 'react-background@example.com',
  username: 'React 抠图用户',
}

const model = {
  id: 'background-removal-pro',
  label: '智能抠图',
  default: true,
  pricePoints: 2,
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test.describe('React background remove interactions', () => {
  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await page.route('**/api/v1/runtime-config', (route) =>
      fulfillJson(route, {
        routes: {},
        features: {
          'ai.imageTools': {
            enabled: true,
            config: { backgroundRemovalModels: [model] },
          },
        },
        blacklist: { blocked: false },
      }),
    )
    await page.route('**/api/v1/me/wallet', (route) =>
      fulfillJson(route, { availableCents: 50, balanceCents: 50 }),
    )
  })

  test('uses the dedicated background_remove task after cost confirmation', async ({ page }) => {
    const created = []
    await page.route('**/api/v1/uploads', (route) =>
      fulfillJson(route, {
        key: 'uploads/background/source.png',
        url: '/api/v1/media/uploads/background/source.png',
      }),
    )
    await page.route('**/api/v1/tasks**', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        created.push(body)
        return fulfillJson(route, {
          task: {
            id: 'background-created-1',
            type: 'background_remove',
            status: 'queued',
            prompt: body.prompt,
            params: body.params,
            inputKeys: body.inputKeys,
            createdAt: new Date().toISOString(),
          },
        })
      }
      const url = new URL(request.url())
      const completedTask = {
        id: 'background-created-1',
        type: 'background_remove',
        status: 'succeeded',
        prompt: '移除图片背景',
        params: {
          _kind: 'image-tool-background-remove',
          publicModelKey: model.id,
        },
        inputKeys: ['uploads/background/source.png'],
        outputUrls: ['/visual/background-output.png'],
        originalUrls: ['/visual/background-output.png'],
        thumbnailUrls: ['/visual/background-output.png'],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }
      if (url.searchParams.get('ids')?.split(',').includes(completedTask.id)) {
        return fulfillJson(route, { items: [completedTask], nextCursor: null })
      }
      if (/\/tasks\/background-created-1$/.test(url.pathname)) {
        return fulfillJson(route, { task: completedTask })
      }
      return fulfillJson(route, { items: [], nextCursor: null })
    })
    await page.route('**/*background-output.png', (route) =>
      route.fulfill({ body: tinyPng, contentType: 'image/png' }),
    )

    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'subject.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.locator('.br-actions .br-btn.is-primary').click()
    const dialog = page.getByRole('dialog', { name: '确认生成费用' })
    await expect(dialog).toContainText('2 积分 / 张 × 1 张')
    expect(created).toHaveLength(0)
    await dialog.getByRole('button', { name: '确认', exact: true }).click()

    await expect.poll(() => created.length).toBe(1)
    expect(created[0].type).toBe('background_remove')
    expect(created[0].prompt).toBe('移除图片背景')
    expect(created[0].params._kind).toBe('image-tool-background-remove')
    expect(created[0].params.publicModelKey).toBe(model.id)
    expect(created[0].inputKeys).toEqual(['uploads/background/source.png'])
    expect(created[0].params.transparentBackground).toBeUndefined()
    expect(created[0].params.transparentPngEnabled).toBeUndefined()
    await expect(page.getByAltText('背景移除结果')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('.br-status')).toContainText('处理完成')
  })

  test('pending upload does not block route navigation', async ({ page }) => {
    await page.route('**/api/v1/tasks**', (route) =>
      fulfillJson(route, { items: [], nextCursor: null }),
    )
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/tools/background-remove', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'subject.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })
    await page.locator('.br-actions .br-btn.is-primary').click()
    await page.getByRole('dialog', { name: '确认生成费用' }).getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.locator('.br-status')).toContainText('上传原图')
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
