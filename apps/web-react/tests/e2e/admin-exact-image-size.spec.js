import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'

const defaultLimits = { minWidth: 256, maxWidth: 4096, minHeight: 256, maxHeight: 4096, step: 1, minPixels: 0, maxPixels: 0, maxAspectRatio: 0 }

async function mockModelConfig(page, { adapter = 'openai', schema = {} } = {}) {
  let config = {
    version: 8,
    providers: [{ id: 'provider', name: '测试服务商', adapter, baseUrl: 'https://models.example.com', apiKey: '', timeoutSecs: 120, maxConcurrency: 10, enabled: true, discoveredModels: ['test-image'], routes: [] }],
    models: [{ id: 'test-image', name: '测试生图模型', providerId: 'provider', upstreamModel: 'test-image', kind: 'image', priceCents: 20, discountPriceCents: null, upstreamCostCents: 0, enabled: true, public: true, default: true, resolutions: ['1K'], aspectRatios: ['1:1', '16:9'], aspectRatiosByResolution: { '1K': ['1:1', '16:9'] }, qualities: ['medium'], transparentBackground: false, minSeconds: 30, maxSeconds: 90, maxImages: 1, maxReferenceImages: 0, upstreamInputSchema: schema }],
    workspaces: {},
  }
  const writes = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: 'test-admin', email: 'test@example.com', role: 'admin', username: '测试管理员' } }))
  await page.route('**/api/v1/admin/model-config', route => {
    if (route.request().method() === 'PUT') {
      config = route.request().postDataJSON()
      writes.push(structuredClone(config))
    }
    return fulfillJson(route, config)
  })
  await page.route('**/api/v1/admin/model-config/discoveries**', route => fulfillJson(route, { id: 'test-image', kind: 'image', compatible: true, inputFields: Object.keys(schema.properties || {}), inputSchema: schema }))
  await page.goto(`${adminURL}/admin/model-config`)
  await expect(page.getByText('测试生图模型', { exact: true }).first()).toBeVisible()
  return { writes, model: () => config.models[0] }
}

async function openEditor(page) {
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  const dialog = page.getByRole('dialog').filter({ hasText: '编辑模型' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function setLimit(dialog, label, value) {
  const input = dialog.getByRole('spinbutton', { name: `精确尺寸${label}`, exact: true })
  await input.fill(String(value))
  await input.press('Tab')
}

async function toggleExactSize(dialog) {
  await dialog.locator('.el-switch:has(input[aria-label="支持精确尺寸"])').click()
}

test('image models opt in to exact dimensions and persist constraints across edits', async ({ page }) => {
  const state = await mockModelConfig(page)
  let dialog = await openEditor(page)
  const toggle = dialog.getByRole('switch', { name: '支持精确尺寸', exact: true })
  await expect(toggle).not.toBeChecked()
  await expect(dialog.getByRole('spinbutton', { name: '精确尺寸像素步长' })).toHaveCount(0)
  await toggleExactSize(dialog)
  await setLimit(dialog, '最小宽度', 512)
  await setLimit(dialog, '最大宽度', 2048)
  await setLimit(dialog, '最小高度', 512)
  await setLimit(dialog, '最大高度', 2048)
  await setLimit(dialog, '像素步长', 64)
  await setLimit(dialog, '最多总像素', 3145728)
  await setLimit(dialog, '最大长短边比', 3)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.model().supportsExactSize).toBe(true)
  expect(state.model().exactSizeLimits).toEqual({ ...defaultLimits, minWidth: 512, maxWidth: 2048, minHeight: 512, maxHeight: 2048, step: 64, maxPixels: 3145728, maxAspectRatio: 3 })
  expect(state.model().aspectRatiosByResolution).toEqual({ '1K': ['1:1', '16:9'] })
  await page.reload()
  dialog = await openEditor(page)
  await expect(dialog.getByRole('switch', { name: '支持精确尺寸', exact: true })).toBeChecked()
  await expect(dialog.getByRole('spinbutton', { name: '精确尺寸像素步长' })).toHaveValue('64')
  await toggleExactSize(dialog)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(2)
  expect(state.model().supportsExactSize).toBe(false)
  expect(state.model().exactSizeLimits.step).toBe(64)
})

test('invalid or impossible size constraints cannot be saved', async ({ page }) => {
  const state = await mockModelConfig(page)
  const dialog = await openEditor(page)
  await toggleExactSize(dialog)
  await setLimit(dialog, '最小宽度', 2048)
  await setLimit(dialog, '最大宽度', 1024)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('精确尺寸的最小宽高不能大于最大宽高', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(0)
  await setLimit(dialog, '最大宽度', 2048)
  await setLimit(dialog, '最多总像素', 1024)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('这些限制没有可用的精确尺寸，请调整宽高范围、步长或像素限制', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(0)
})

test('new image models can enable exact sizes without enabling them for existing models', async ({ page }) => {
  const state = await mockModelConfig(page)
  await page.getByRole('button', { name: '添加模型', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '添加模型' })
  await dialog.getByRole('textbox', { name: '自定义名称', exact: true }).fill('精确尺寸新模型')
  await dialog.getByRole('combobox', { name: '上游模型 ID', exact: true }).press('ArrowDown')
  await page.getByRole('option', { name: 'test-image', exact: true }).click()
  await toggleExactSize(dialog)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  const added = state.writes[0].models.find(model => model.name === '精确尺寸新模型')
  expect(added.supportsExactSize).toBe(true)
  expect(added.exactSizeLimits).toEqual(defaultLimits)
  expect(state.model().supportsExactSize).toBe(false)
})

for (const supports of [false, true]) {
  test(`CRUN exact size capability follows the declared input schema (${supports})`, async ({ page }) => {
    const schema = { type: 'object', properties: supports ? { width: { type: 'integer', minimum: 256, maximum: 2048 }, height: { type: 'integer', minimum: 256, maximum: 2048 } } : { prompt: { type: 'string' } } }
    await mockModelConfig(page, { adapter: 'crun', schema })
    const dialog = await openEditor(page)
    const toggle = dialog.getByRole('switch', { name: '支持精确尺寸', exact: true })
    if (supports) {
      await expect(toggle).toBeEnabled()
      await toggleExactSize(dialog)
      await expect(dialog.getByRole('spinbutton', { name: '精确尺寸最小宽度' })).toHaveValue('256')
    } else {
      await expect(toggle).toBeDisabled()
      await expect(dialog.getByText('此模型尚未声明支持精确宽高，请读取最新模型能力后确认。')).toBeVisible()
    }
  })
}
