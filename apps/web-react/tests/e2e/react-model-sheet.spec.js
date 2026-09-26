import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
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
    pageControls: { model_sheet: { status: 'normal' } },
    blacklist: { blocked: false },
  }))
}

async function mockRuntime(page, publicModel = model) {
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: { 'ai.ultraModelSheet': { enabled: true, config: { publicModels: [publicModel] } } },
    aiModelCatalog: { providers: [], publicModels: [publicModel], featurePublicModels: [publicModel] },
    pageControls: { model_sheet: { status: 'normal' } },
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
          outputUrls: [`/visual/${id}-thumbnail.png`],
          originalUrls: [`/visual/${id}-original.png`],
          thumbnailUrls: [`/visual/${id}-thumbnail.png`],
          displayUrls: [`/visual/${id}-display.png`],
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
    await page.getByRole('radio', { name: /自定义/ }).click()
    await page.locator('.ms3-view-chip', { hasText: '背面' }).click()
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
    await expect(page.locator('.ms3-slot.has-output')).toHaveCount(2)

    const downloadPromise = page.waitForEvent('download')
    await page.getByTitle('导出客户与 Codex 可读取的模型交付包').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/-handoff\.zip$/)
    const files = unzipSync(await readFile(await download.path()))
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'README.md',
      'model-sheet.json',
      'prompt.txt',
    ]))
    expect(Object.keys(files).filter((name) => name.startsWith('views/'))).toHaveLength(2)
    const manifest = JSON.parse(strFromU8(files['model-sheet.json']))
    expect(manifest.kind).toBe('starclouds-model-sheet')
    expect(manifest.files).toHaveLength(2)
    expect(manifest.files.every((item) => !('url' in item))).toBe(true)
  })

  test('pending reference upload does not block route navigation', async ({ page }) => {
    await mockBase(page)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))
    await page.route('**/api/v1/uploads', () => new Promise(() => {}))
    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: tinyPng })
    await page.getByRole('button', { name: /生成 3 张视图/ }).click()
    await expect(page.locator('.ms3-hud-status')).toContainText('准备参考图')
    await page.evaluate(() => history.pushState({}, '', '/pricing'))
    await page.dispatchEvent('body', 'popstate')
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('loads model sheet history after delayed authentication resolves', async ({ page }) => {
    let historyRequests = 0
    await page.route('**/api/v1/auth/session', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await fulfillJson(route, { user })
    })
    await mockRuntime(page)
    await page.route('**/api/v1/tasks**', (route) => {
      historyRequests += 1
      return fulfillJson(route, {
        items: [{
          id: 'delayed-auth-history',
          type: 'model_sheet',
          status: 'succeeded',
          params: { _kind: 'ultra-reference-generation', aspectRatio: '16:9' },
          outputUrls: ['/visual/delayed-auth-history.png'],
          originalUrls: ['/visual/delayed-auth-history.png'],
          thumbnailUrls: ['/visual/delayed-auth-history.png'],
          createdAt: new Date().toISOString(),
        }],
        nextCursor: null,
      })
    })
    await page.route('**/visual/delayed-auth-history.png', (route) => route.fulfill({ body: tinyPng, contentType: 'image/png' }))

    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })

    await expect.poll(() => historyRequests).toBeGreaterThan(0)
    await expect(page.getByAltText('模型设计')).toBeVisible()
  })

  test('does not expose the previous account model sheet data to guests', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('walleven_active_account_scope', 'user_previous')
      localStorage.setItem('walleven_user_previous_local_ultra-model-sheet-studio-v2', JSON.stringify({
        prompt: 'PREVIOUS_ACCOUNT_PRIVATE_PROMPT',
        referenceItems: [{ id: 'private-ref', type: 'url', url: '/visual/private-reference.png' }],
        activeSubjectId: 'private-subject',
      }))
      localStorage.setItem('walleven_user_previous_local_ultra-model-sheet-subjects-v1', JSON.stringify([{
        id: 'private-subject',
        name: 'PREVIOUS_ACCOUNT_PRIVATE_SUBJECT',
        url: '/visual/private-subject.png',
      }]))
    })
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
    await mockRuntime(page)

    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })

    await expect(page.getByAltText('参考主体')).toHaveCount(0)
    await expect(page.getByText('PREVIOUS_ACCOUNT_PRIVATE_SUBJECT', { exact: true })).toHaveCount(0)
    await expect(page.locator('.ms3-textarea')).not.toHaveValue('PREVIOUS_ACCOUNT_PRIVATE_PROMPT')
    expect(await page.evaluate(() => localStorage.getItem('walleven_active_account_scope'))).toBe('guest')
  })

  test('matches ratio, quality, transparency, and reference controls to model capabilities', async ({ page }) => {
    const restrictedModel = {
      ...model,
      id: 'restricted-model',
      publicModelKey: 'restricted-model',
      aspectRatios: ['1:1'],
      qualities: ['high'],
      maxReferenceImages: 1,
      transparentBackground: false,
      outputFormats: ['jpeg'],
    }
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
    await mockRuntime(page, restrictedModel)
    await page.route('**/api/v1/tasks**', (route) => fulfillJson(route, { items: [], nextCursor: null }))

    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.locator('.ms3-more > summary').filter({ hasText: '画面设置' }).click()
    await page.getByRole('button', { name: '输出比例' }).click()

    await expect(page.locator('.ratio-select__option')).toHaveCount(1)
    await expect(page.locator('.ratio-select__option')).toHaveText('1:1')
    await expect(page.getByRole('button', { name: '透明', exact: true })).toHaveCount(0)
    await expect(page.locator('.ms3-upload')).toContainText('最多 1 张')
    await expect(page.getByRole('slider', { name: '细节强度' })).toBeDisabled()
  })

  test('starts elapsed generation time only after the task enters running', async ({ page }) => {
    await mockBase(page)
    let pollCount = 0
    await page.route('**/api/v1/tasks**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        return fulfillJson(route, {
          task: {
            id: 'timing-task',
            type: 'model_sheet',
            status: 'queued',
            params: request.postDataJSON().params,
            outputUrls: [],
            originalUrls: [],
            createdAt: new Date().toISOString(),
          },
        })
      }
      if (url.searchParams.get('ids')) {
        pollCount += 1
        if (pollCount < 2) {
          return fulfillJson(route, { items: [{ id: 'timing-task', type: 'model_sheet', status: 'queued', outputUrls: [], originalUrls: [], createdAt: new Date().toISOString() }] })
        }
        return fulfillJson(route, { items: [{ id: 'timing-task', type: 'model_sheet', status: 'running', outputUrls: [], originalUrls: [], createdAt: new Date().toISOString(), startedAt: new Date(Date.now() - 2_000).toISOString() }] })
      }
      return fulfillJson(route, { items: [], nextCursor: null })
    })

    await page.goto('/model-sheet', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /生成 3 张视图/ }).click()

    await expect(page.locator('.ms3-render-timer')).toHaveText('--:--')
    await expect.poll(() => pollCount, { timeout: 7_000 }).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.ms3-render-timer')).not.toHaveText('--:--')
  })
})
