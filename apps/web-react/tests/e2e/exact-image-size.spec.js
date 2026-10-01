import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const user = { id: 'exact-size-user', username: '精确尺寸用户', requireCostConfirm: false }
const exactModel = {
  id: 'exact-image', model: 'exact-image', name: '精确模型', label: '精确模型',
  supportsExactSize: true, pricePoints: 12,
  aspectRatios: ['auto', '1:1', '16:9'], resolutions: ['1K', '2K'], qualities: ['medium'],
  exactSizeLimits: { minWidth: 256, maxWidth: 4096, minHeight: 256, maxHeight: 4096, step: 1 },
}
const ratioModel = { ...exactModel, id: 'ratio-image', model: 'ratio-image', name: '比例模型', label: '比例模型', supportsExactSize: false }

async function mockImageWorkspaces(page, { limits = {}, models = null, conversations = [] } = {}) {
  await installVisualBaseline(page)
  const imageModels = models || [{ ...exactModel, exactSizeLimits: { ...exactModel.exactSizeLimits, ...limits } }, ratioModel]
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/me/wallet', (route) => fulfillJson(route, { availableCents: 10000, balanceCents: 10000 }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    features: { 'ai.wallpaperGeneration': { enabled: true, config: { publicModels: imageModels } } },
  }))
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, {
    conversationModels: [{ model: 'chat', label: '对话模型' }], imageModels,
  }))
  await page.route('**/api/v1/assistant/conversations**', (route) => fulfillJson(route,
    route.request().method() === 'POST'
      ? { id: 'size-conversation', title: '新对话', messages: [] }
      : { conversations },
  ))
  const imageRequests = []
  const assistantRequests = []
  await page.route('**/api/v1/tasks**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/quote')) return fulfillJson(route, { unitPriceCents: 12, totalPriceCents: 12, authoritative: true })
    if (pathname.endsWith('/tasks') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      imageRequests.push(body)
      return fulfillJson(route, { task: { id: `exact-task-${imageRequests.length}`, type: 't2i', status: 'succeeded', prompt: body.prompt, params: body.params, inputKeys: [], createdAt: new Date().toISOString() } })
    }
    return fulfillJson(route, { items: [] })
  })
  await page.route('**/api/v1/assistant/runs**', async (route) => {
    if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
    const body = route.request().postDataJSON()
    assistantRequests.push(body)
    return fulfillJson(route, {
      run: { id: `size-run-${assistantRequests.length}`, conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, mode: body.mode, status: 'succeeded', stage: 'complete' },
      userMessage: { id: body.clientUserMessageId, role: 'user', content: body.prompt, createdAt: new Date().toISOString() },
      assistantMessage: { ...body, id: body.clientAssistantMessageId, role: 'assistant', kind: body.mode, content: '已按所选尺寸完成。', pending: false, status: 'complete', images: [], createdAt: new Date().toISOString() },
    })
  })
  return { imageRequests, assistantRequests }
}

async function openT2iSize(page) {
  await page.goto('/text-to-image')
  await page.getByRole('button', { name: /画面 / }).click()
  return page.getByRole('region', { name: '画面参数' })
}

async function ensureT2iSizeOpen(page) {
  const trigger = page.getByRole('button', { name: /画面 / })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  await expect(page.getByRole('region', { name: '画面参数' })).toBeVisible()
}

async function openAssistantSize(page) {
  await page.goto('/assistant')
  await page.locator('.agent-mode-button').click()
  await page.getByRole('button', { name: '图片生成', exact: true }).click()
  await page.locator('.image-settings-button').click()
  return page.getByRole('region', { name: '图片生成参数' })
}

test('text-to-image sends original exact pixels and restores the existing ratio request', async ({ page }) => {
  const { imageRequests } = await mockImageWorkspaces(page)
  const panel = await openT2iSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('1237')
  await panel.getByRole('spinbutton', { name: '高 (px)' }).fill('891')
  await page.locator('.t2i-generate').click()
  await expect.poll(() => imageRequests.length).toBe(1)
  expect(imageRequests[0].params).toMatchObject({ sizeMode: 'exact', exactWidth: 1237, exactHeight: 891, size: '1237x891', outputSize: '1237x891' })
  expect(imageRequests[0].params).not.toHaveProperty('aspectRatio')
  expect(imageRequests[0].params).not.toHaveProperty('resolutionScale')
  await ensureT2iSizeOpen(page)
  await panel.getByRole('button', { name: '比例尺寸', exact: true }).click()
  await page.locator('.t2i-generate').click()
  await expect.poll(() => imageRequests.length).toBe(2)
  for (const field of ['sizeMode', 'exactWidth', 'exactHeight']) expect(imageRequests[1].params).not.toHaveProperty(field)
  expect(imageRequests[1].params).toMatchObject({ aspectRatio: '1:1', resolutionScale: '1K', outputSize: '1024x1024' })
})

test('text-to-image blocks invalid exact dimensions without rounding their inputs', async ({ page }) => {
  const { imageRequests } = await mockImageWorkspaces(page, { limits: { step: 64, maxPixels: 2097152, maxAspectRatio: 2 } })
  const panel = await openT2iSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('1033')
  await expect(panel.getByRole('alert')).toContainText('64 px 的整数倍')
  await expect(panel.getByRole('spinbutton', { name: '宽 (px)' })).toHaveValue('1033')
  await expect(page.locator('.t2i-generate')).toBeDisabled()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('3072')
  await expect(panel.getByRole('alert')).toContainText('总像素不得超过')
  await panel.getByRole('spinbutton', { name: '高 (px)' }).fill('512')
  await expect(panel.getByRole('alert')).toContainText('长边与短边')
  expect(imageRequests).toHaveLength(0)
})

test('text-to-image clears exact mode when switching to an unsupported model', async ({ page }) => {
  const { imageRequests } = await mockImageWorkspaces(page)
  const panel = await openT2iSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await page.getByRole('button', { name: '生成模型', exact: true }).click()
  await page.getByRole('option', { name: /比例模型/ }).click()
  await ensureT2iSizeOpen(page)
  await expect(panel.getByRole('button', { name: '精确尺寸', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('spinbutton')).toHaveCount(0)
  await page.locator('.t2i-generate').click()
  await expect.poll(() => imageRequests.length).toBe(1)
  expect(imageRequests[0].params.publicModelKey).toBe('ratio-image')
  for (const field of ['sizeMode', 'exactWidth', 'exactHeight']) expect(imageRequests[0].params).not.toHaveProperty(field)
})

test('assistant direct image mode sends original exact pixels', async ({ page }) => {
  const { assistantRequests } = await mockImageWorkspaces(page)
  const panel = await openAssistantSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('1237')
  await panel.getByRole('spinbutton', { name: '高 (px)' }).fill('891')
  await page.getByLabel('消息输入').fill('生成一张雪山风景图片')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => assistantRequests.length).toBe(1)
  expect(assistantRequests[0]).toMatchObject({ mode: 'image', sizeMode: 'exact', exactWidth: 1237, exactHeight: 891, requestSize: '1237x891', width: 1237, height: 891 })
  expect(assistantRequests[0]).not.toHaveProperty('resolution')
  expect(assistantRequests[0]).not.toHaveProperty('ratio')
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  await expect.poll(() => assistantRequests.length).toBe(2)
  expect(assistantRequests[1]).toMatchObject({ mode: 'image', sizeMode: 'exact', exactWidth: 1237, exactHeight: 891, requestSize: '1237x891' })
})

test('assistant rejects invalid exact inputs and clears them when its model changes', async ({ page }) => {
  const { assistantRequests } = await mockImageWorkspaces(page, { limits: { step: 64 } })
  const panel = await openAssistantSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('1033')
  await expect(panel.getByRole('alert')).toContainText('64 px 的整数倍')
  await page.getByLabel('消息输入').fill('生成一张雪山风景图片')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /精确模型/ }).click()
  await page.locator('.image-model-menu').getByRole('button', { name: /比例模型/ }).click()
  await page.locator('.image-settings-button').click()
  await expect(panel.getByRole('spinbutton')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '精确尺寸', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => assistantRequests.length).toBe(1)
  expect(assistantRequests[0].model).toBe('ratio-image')
  for (const field of ['sizeMode', 'exactWidth', 'exactHeight']) expect(assistantRequests[0]).not.toHaveProperty(field)
})

test('switching assistant to Agent mode clears the exact request fields', async ({ page }) => {
  const { assistantRequests } = await mockImageWorkspaces(page)
  const panel = await openAssistantSize(page)
  await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
  await panel.getByRole('spinbutton', { name: '宽 (px)' }).fill('1237')
  await page.locator('.agent-mode-button').click()
  await page.getByRole('button', { name: 'Agent 模式', exact: true }).click()
  await expect(page.locator('.exact-size-control')).toHaveCount(0)
  await page.getByLabel('消息输入').fill('帮我分析这个产品的视觉方案')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => assistantRequests.length).toBe(1)
  expect(assistantRequests[0].mode).toBe('agent')
  for (const field of ['sizeMode', 'exactWidth', 'exactHeight']) expect(assistantRequests[0]).not.toHaveProperty(field)
})

test('exact inputs and validation fit the minimum desktop viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await mockImageWorkspaces(page)
  for (const [name, open] of [['text-to-image', openT2iSize], ['assistant', openAssistantSize]]) {
    const panel = await open(page)
    await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
    const control = panel.locator('.exact-size-control')
    await expect(control.getByRole('spinbutton', { name: '宽 (px)' })).toBeVisible()
    await expect(control.getByRole('spinbutton', { name: '高 (px)' })).toBeVisible()
    const bounds = await control.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280)
    await control.screenshot({ path: testInfo.outputPath(`${name}-exact-size.png`) })
  }
})

test('unaligned bounds keep native input validity and exact requests consistent', async ({ page }) => {
  const { imageRequests, assistantRequests } = await mockImageWorkspaces(page, {
    limits: { minWidth: 700, maxWidth: 900, minHeight: 700, maxHeight: 900, step: 64 },
  })
  for (const open of [openT2iSize, openAssistantSize]) {
    const panel = await open(page)
    await panel.getByRole('button', { name: '精确尺寸', exact: true }).click()
    const width = panel.getByRole('spinbutton', { name: '宽 (px)' })
    const height = panel.getByRole('spinbutton', { name: '高 (px)' })
    await expect(width).toHaveAttribute('min', '704')
    await expect(width).toHaveAttribute('max', '896')
    expect(await width.evaluate((input) => input.validity.valid)).toBe(true)
    expect(await height.evaluate((input) => input.validity.valid)).toBe(true)
    await width.fill('768')
    await height.fill('832')
    expect(await width.evaluate((input) => input.validity.valid)).toBe(true)
    expect(await height.evaluate((input) => input.validity.valid)).toBe(true)
    if (open === openT2iSize) {
      await page.locator('.t2i-generate').click()
      await expect.poll(() => imageRequests.length).toBe(1)
      expect(imageRequests[0].params).toMatchObject({ sizeMode: 'exact', exactWidth: 768, exactHeight: 832 })
    } else {
      await page.getByLabel('消息输入').fill('生成一张雪山风景图片')
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect.poll(() => assistantRequests.length).toBe(1)
      expect(assistantRequests[0]).toMatchObject({ sizeMode: 'exact', exactWidth: 768, exactHeight: 832 })
    }
  }
})

for (const state of ['missing', 'maintenance']) {
  test(`saved exact drafts keep their model and pixels when the model is ${state}`, async ({ page }) => {
    const replacement = { ...exactModel, id: 'replacement-image', model: 'replacement-image', name: '备用精确模型', label: '备用精确模型' }
    const { imageRequests, assistantRequests } = await mockImageWorkspaces(page, {
      models: [...(state === 'maintenance' ? [{ ...exactModel, status: 'maintenance' }] : []), ratioModel, replacement],
    })
    await page.addInitScript(() => {
      localStorage.setItem('walleven_user_exact-size-user_local_walleven_ai_wallpaper_studio_draft_v1', JSON.stringify({
        selectedPublicModel: 'exact-image', sizeMode: 'exact', exactWidth: 997, exactHeight: 613, prompt: '生成一张雪山风景图片',
      }))
      localStorage.setItem('starclouds-assistant-workspace:user:exact-size-user', JSON.stringify({
        creationType: 'image', generationModel: 'exact-image', generationSize: { sizeMode: 'exact', exactWidth: '997', exactHeight: '613' }, draft: '生成一张雪山风景图片',
      }))
    })
    await page.goto('/text-to-image')
    await expect(page.getByRole('alert')).toContainText('原精确尺寸模型暂不可用')
    await ensureT2iSizeOpen(page)
    const t2iPanel = page.getByRole('region', { name: '画面参数' })
    await expect(t2iPanel.getByRole('spinbutton', { name: '宽 (px)' })).toHaveValue('997')
    await expect(t2iPanel.getByRole('spinbutton', { name: '高 (px)' })).toHaveValue('613')
    await expect(page.locator('.t2i-generate')).toBeDisabled()
    expect(imageRequests).toHaveLength(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('walleven_user_exact-size-user_local_walleven_ai_wallpaper_studio_draft_v1')).selectedPublicModel)).toBe('exact-image')
    await page.getByRole('button', { name: '生成模型', exact: true }).click()
    await page.getByRole('option', { name: /备用精确模型/ }).click()
    await page.locator('.t2i-generate').click()
    await expect.poll(() => imageRequests.length).toBe(1)
    expect(imageRequests[0].params).toMatchObject({ publicModelKey: 'replacement-image', sizeMode: 'exact', exactWidth: 997, exactHeight: 613 })

    await page.goto('/assistant')
    await expect(page.getByRole('alert')).toContainText('原精确尺寸模型暂不可用')
    await page.locator('.image-settings-button').click()
    const assistantPanel = page.getByRole('region', { name: '图片生成参数' })
    await expect(assistantPanel.getByRole('spinbutton', { name: '宽 (px)' })).toHaveValue('997')
    await expect(assistantPanel.getByRole('spinbutton', { name: '高 (px)' })).toHaveValue('613')
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    expect(assistantRequests).toHaveLength(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('starclouds-assistant-workspace:user:exact-size-user')).generationModel)).toBe('exact-image')
    await page.getByRole('button', { name: /请重新选择模型/ }).click()
    await page.locator('.image-model-menu').getByRole('button', { name: /备用精确模型/ }).click()
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => assistantRequests.length).toBe(1)
    expect(assistantRequests[0]).toMatchObject({ model: 'replacement-image', sizeMode: 'exact', exactWidth: 997, exactHeight: 613 })
  })
}

test('assistant retry never replaces an unavailable exact model with another model', async ({ page }) => {
  const now = new Date().toISOString()
  const { assistantRequests } = await mockImageWorkspaces(page, {
    models: [ratioModel],
    conversations: [{
      id: 'old-exact-conversation', title: '原精确任务', createdAt: now, updatedAt: now,
      messages: [
        { id: 'old-user', role: 'user', content: '生成一张雪山风景图片', createdAt: now, pending: false },
        { id: 'old-reply', role: 'assistant', kind: 'image', model: 'exact-image', sizeMode: 'exact', exactWidth: 997, exactHeight: 613, width: 997, height: 613, requestSize: '997x613', content: '已生成', createdAt: now, pending: false, status: 'complete', count: 1, images: [] },
      ],
    }],
  })
  await page.goto('/assistant')
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  await expect(page.getByText(/原精确尺寸模型暂不可用/)).toBeVisible()
  expect(assistantRequests).toHaveLength(0)
  await expect(page.locator('.message--assistant')).toContainText('已生成')
})
