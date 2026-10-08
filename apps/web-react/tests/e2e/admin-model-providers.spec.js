import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'
const shotDir = process.env.MODEL_PROVIDER_SHOTS || ''

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const defaultProfiles = JSON.parse(readFileSync(new URL('../../../server/internal/modelconfig/image_param_profiles_default.json', import.meta.url), 'utf8'))
const defaultPresets = JSON.parse(readFileSync(new URL('../../../server/internal/modelconfig/presets_default.json', import.meta.url), 'utf8'))

function baseConfig() {
  const route = { id: 'c2a-1', name: '主线路', baseUrl: 'https://c2a.example.com', apiKey: '****abcd', timeoutSecs: 180, maxConcurrency: 100, enabled: true }
  return {
    version: 8,
    providers: [{ id: 'c2a', name: 'ChatGPT2API 主站', adapter: 'openai', baseUrl: route.baseUrl, apiKey: route.apiKey, timeoutSecs: 180, maxConcurrency: 100, enabled: true, discoveredModels: ['gpt-image-2', 'gpt-5.5'], routes: [route] }],
    models: [{ id: 'gpt-image-2', name: 'GPT Image 2', providerId: 'c2a', upstreamModel: 'gpt-image-2', kind: 'image', priceCents: 20, discountPriceCents: null, upstreamCostCents: 0, enabled: true, public: true, default: true, resolutions: ['1K'], aspectRatios: ['1:1'], aspectRatiosByResolution: { '1K': ['1:1'] }, qualities: ['medium'], transparentBackground: true, minSeconds: 30, maxSeconds: 90, maxImages: 4, maxReferenceImages: 4 }],
    workspaces: {},
    editableFiles: { enabled: false, providerId: '', routeId: '' },
  }
}

async function mockAdmin(page) {
  let config = baseConfig()
  const writes = []
  const tests = []
  const modelTests = []
  const profileWrites = []
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: 'test-admin', email: 'test@example.com', role: 'admin', username: '测试管理员' } }))
  await page.route('**/api/v1/admin/model-config', route => {
    if (route.request().method() === 'PUT') {
      config = route.request().postDataJSON()
      writes.push(structuredClone(config))
    }
    return fulfillJson(route, config)
  })
  await page.route('**/api/v1/admin/model-config/presets', route => fulfillJson(route, { presets: defaultPresets, customized: false }))
  const droppable = ['background', 'output_format', 'output_compression', 'moderation', 'style', 'input_fidelity', 'user']
  await page.route('**/api/v1/admin/model-config/image-param-profiles', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      profileWrites.push(body)
      return fulfillJson(route, { profiles: body.profiles, customized: true, droppable })
    }
    return fulfillJson(route, { profiles: defaultProfiles, customized: false, droppable })
  })
  await page.route('**/api/v1/admin/model-config/discoveries**', route => fulfillJson(route, {
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'imagen-4.0-generate-001'], modelCount: 3, catalogSource: 'compatible',
    entries: [
      { id: 'gemini-2.5-flash', kind: '', compatible: true },
      { id: 'gemini-2.5-pro', kind: '', compatible: true },
      { id: 'imagen-4.0-generate-001', kind: '', compatible: true },
    ],
  }))
  await page.route('**/api/v1/admin/model-config/model-tests', route => {
    const body = route.request().postDataJSON()
    modelTests.push(body)
    const steps = body.kind === 'image'
      ? [{ name: '文生图', ok: true, latencyMs: 21000, detail: '850 KB', image: PNG_B64 }]
      : [{ name: '对话', ok: true, latencyMs: 900, detail: '我是测试模型' }, { name: '工具调用', ok: false, optional: true, latencyMs: 700, detail: '未发起工具调用' }]
    return fulfillJson(route, { ok: true, provider: 'Google Gemini', route: '默认线路', result: { model: body.upstreamModel, kind: body.kind, steps } })
  })
  await page.route('**/api/v1/admin/model-config/connection-tests**', route => {
    tests.push({ url: route.request().url(), body: route.request().postDataJSON() })
    return fulfillJson(route, { ok: true, checks: [{ name: 'models', ok: true, latencyMs: 412, detail: '3 个模型' }] })
  })
  await page.goto(`${adminURL}/admin/model-config`)
  await page.getByRole('tab', { name: /服务商/ }).click()
  return { writes, tests, modelTests, profileWrites }
}

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` })
}

test('a provider created from the Gemini preset carries its connection settings and imports models', async ({ page }) => {
  const state = await mockAdmin(page)
  await expect(page.getByRole('option', { name: /ChatGPT2API 主站/ })).toBeVisible()
  await shot(page, '01-providers')

  await page.getByRole('button', { name: '添加', exact: true }).click()
  const picker = page.getByRole('dialog').filter({ hasText: '添加服务商' })
  await expect(picker.getByText('国内厂商')).toBeVisible()
  await shot(page, '02-preset-picker')
  await picker.getByRole('button', { name: /Google Gemini/ }).click()
  await expect(picker).toBeHidden()

  await expect(page.getByLabel('服务商名称')).toHaveValue('Google Gemini')
  await expect(page.getByLabel('接口路径前缀')).toHaveValue('/v1beta')
  await expect(page.getByLabel('Google Gemini 设置').getByText('https://generativelanguage.googleapis.com/v1beta', { exact: true })).toBeVisible()
  // Chat / image tests and request rules live on models, not on the provider.
  await expect(page.getByRole('combobox', { name: '对话测试模型' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '生图尺寸参数' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '图片返回方式' })).toHaveCount(0)

  await page.getByLabel('API Key').first().fill('test-gemini-key')
  await page.getByRole('button', { name: '读取模型' }).click()
  await expect(page.getByRole('cell', { name: 'imagen-4.0-generate-001', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '检查主线路' }).click()
  await expect(page.getByText('全部通过')).toBeVisible()
  expect(state.tests[0].url).not.toContain('model=')
  expect(state.tests[0].body.apiPath).toBe('/v1beta')
  expect(state.tests[0].body.adapter).toBe('gemini')
  expect(state.tests[0].body.vendor).toBe('gemini')

  await page.getByLabel('选择 gemini-2.5-flash').check()
  await page.getByLabel('选择 imagen-4.0-generate-001').check()
  // Nothing is preselected: importing without a type is refused.
  await expect(page.getByRole('group', { name: 'gemini-2.5-flash 类型' }).locator('.is-active')).toHaveCount(0)
  await page.getByRole('button', { name: '导入选中（2）' }).click()
  await expect(page.getByText('还有 2 个选中的模型没有设定类型')).toBeVisible()
  await page.getByRole('group', { name: 'gemini-2.5-flash 类型' }).getByRole('button', { name: '对话' }).click()
  await page.getByRole('group', { name: 'imagen-4.0-generate-001 类型' }).getByRole('button', { name: '生图' }).click()
  await shot(page, '03-provider-detail')
  await page.getByRole('button', { name: '导入选中（2）' }).click()
  await page.getByRole('tab', { name: /全部/ }).click()
  await expect(page.getByRole('button', { name: /gemini-2.5-flash\s*未启用/ })).toBeVisible()

  await page.locator('.el-switch:has(input[aria-label="启用服务商"])').click()
  await page.getByRole('button', { name: /保存配置/ }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  const saved = state.writes[0]
  const gemini = saved.providers.find(provider => provider.vendor === 'gemini')
  expect(gemini).toMatchObject({ adapter: 'gemini', apiPath: '/v1beta', enabled: true })
  expect(gemini.compat ?? null).toBeNull()
  expect(gemini.routes[0]).toMatchObject({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-gemini-key' })
  const imported = saved.models.filter(model => model.providerId === gemini.id)
  expect(imported.map(model => [model.upstreamModel, model.kind, model.enabled, model.public]).sort()).toEqual([
    ['gemini-2.5-flash', 'chat', false, false],
    ['imagen-4.0-generate-001', 'image', false, false],
  ])
})

test('the image response format is set per model and model tests run from the model catalog', async ({ page }) => {
  const state = await mockAdmin(page)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByRole('dialog').filter({ hasText: '添加服务商' }).getByRole('button', { name: /Google Gemini/ }).click()
  await page.getByLabel('API Key').first().fill('test-gemini-key')
  await page.getByRole('button', { name: '读取模型' }).click()
  await page.getByLabel('选择 gemini-2.5-flash').check()
  await page.getByLabel('选择 imagen-4.0-generate-001').check()
  await page.getByRole('group', { name: 'gemini-2.5-flash 类型' }).getByRole('button', { name: '对话' }).click()
  await page.getByRole('group', { name: 'imagen-4.0-generate-001 类型' }).getByRole('button', { name: '生图' }).click()
  await page.getByRole('button', { name: '导入选中（2）' }).click()

  await page.getByRole('tab', { name: /模型目录/ }).click()
  const imageCard = page.locator('article').filter({ hasText: 'imagen-4.0-generate-001' })
  const chatCard = page.locator('article').filter({ hasText: 'gemini-2.5-flash' })

  // Per-model image response format, only for Gemini image models.
  await chatCard.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('combobox', { name: '生图尺寸参数' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '图片返回方式' })).toHaveCount(0)
  await page.getByRole('combobox', { name: '对话接口' }).click({ force: true })
  await page.getByRole('option', { name: /OpenAI 标准路径/ }).click()
  await page.getByRole('button', { name: '确认修改' }).click()
  await imageCard.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('combobox', { name: '对话接口' })).toHaveCount(0)
  await page.getByRole('combobox', { name: '图片返回方式' }).click({ force: true })
  await page.getByRole('option', { name: /文本里的图片链接/ }).click()
  await page.getByRole('combobox', { name: '图片返回方式' }).scrollIntoViewIfNeeded()
  await shot(page, '04-model-image-response')
  await page.getByRole('button', { name: '确认修改' }).click()

  // Image test from the catalog card uses the model's current rules.
  await imageCard.getByRole('button', { name: '测试' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '测试 imagen-4.0-generate-001' })
  await expect(dialog.getByText('图片返回方式：文本里的图片链接')).toBeVisible()
  await dialog.getByRole('button', { name: '开始测试' }).click()
  await expect(dialog.getByText('✓ 通过')).toBeVisible()
  await expect(dialog.getByRole('img', { name: '文生图结果' })).toBeVisible()
  await shot(page, '05-model-test-image')
  expect(state.modelTests[0]).toMatchObject({ upstreamModel: 'imagen-4.0-generate-001', kind: 'image', edit: true, compat: { imageResponse: 'text_url' } })
  await dialog.getByRole('button', { name: /关闭|Close/ }).first().click().catch(() => page.keyboard.press('Escape'))
  await expect(dialog).toBeHidden()

  await chatCard.getByRole('button', { name: '测试' }).click()
  const chatDialog = page.getByRole('dialog').filter({ hasText: '测试 gemini-2.5-flash' })
  await expect(chatDialog.getByText('对话接口：OpenAI 标准路径')).toBeVisible()
  await chatDialog.getByRole('combobox', { name: '推理档位' }).click({ force: true })
  await page.getByRole('option', { name: /^高 · high/ }).click()
  await chatDialog.getByRole('button', { name: '开始测试' }).click()
  await expect(chatDialog.getByText('推理档位：高')).toBeVisible()
  await shot(page, '06-model-test-chat')
  await expect(chatDialog.getByText('我是测试模型')).toBeVisible()
  await expect(chatDialog.getByText('（可选）')).toBeVisible()
  expect(state.modelTests[1]).toMatchObject({ upstreamModel: 'gemini-2.5-flash', kind: 'chat', skipTools: false, reasoningEffort: 'high', compat: { chatApi: 'v1' } })
})

test('xAI template request rules are copied onto imported models', async ({ page }) => {
  const state = await mockAdmin(page)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByRole('dialog').filter({ hasText: '添加服务商' }).getByRole('button', { name: /xAI Grok/ }).click()
  await expect(page.getByRole('combobox', { name: '生图尺寸参数' })).toHaveCount(0)
  await page.getByLabel('API Key').first().fill('test-xai-key')
  await page.getByRole('button', { name: '读取模型' }).click()
  await page.getByLabel('选择 imagen-4.0-generate-001').check()
  await page.getByRole('group', { name: 'imagen-4.0-generate-001 类型' }).getByRole('button', { name: '生图' }).click()
  await page.getByLabel('选择 gemini-2.5-flash').check()
  await page.getByRole('group', { name: 'gemini-2.5-flash 类型' }).getByRole('button', { name: '对话' }).click()
  await page.getByRole('button', { name: '导入选中（2）' }).click()
  await page.getByRole('button', { name: /保存配置/ }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  const xai = state.writes[0].providers.find(provider => provider.vendor === 'xai')
  expect(xai.compat ?? null).toBeNull()
  const model = state.writes[0].models.find(item => item.providerId === xai.id && item.kind === 'image')
  expect(model.compat).toEqual({ imageParams: 'grok', imageEdit: 'json_image_url' })
  // Template rules are for image models; chat models start without any.
  const chat = state.writes[0].models.find(item => item.providerId === xai.id && item.kind === 'chat')
  expect(chat.compat ?? null).toBeNull()

  // The image model editor offers the reference-image format for OpenAI-compatible vendors.
  await page.getByRole('tab', { name: /模型目录/ }).click()
  await page.locator('article').filter({ hasText: 'imagen-4.0-generate-001' }).filter({ hasText: 'xAI' }).first().getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('combobox', { name: '参考图发送方式' })).toBeVisible()
})

test('the Qwen template uses the Model Studio native protocol', async ({ page }) => {
  await mockAdmin(page)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByRole('dialog').filter({ hasText: '添加服务商' }).getByRole('button', { name: /通义千问/ }).click()
  await expect(page.getByLabel('接口路径前缀')).toHaveValue('/api/v1')
  await expect(page.getByText('百炼原生').first()).toBeVisible()
  await expect(page.getByText('/services/aigc/multimodal-generation/generation')).toBeVisible()
  await shot(page, '07-qwen-provider')
})

test('PPT / PSD export settings open from a toolbar button instead of taking provider space', async ({ page }) => {
  await mockAdmin(page)
  await expect(page.getByText('为 PPT / PSD 导出指定服务商与线路')).toHaveCount(0)
  await page.getByRole('button', { name: /PPT \/ PSD 导出/ }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '可编辑文件 · PPT / PSD' })
  await expect(dialog.getByRole('combobox').first()).toBeVisible()
  await shot(page, '05-psd-dialog')
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(dialog).toBeHidden()
  await shot(page, '06-providers-toolbar')
})

test('picking an image parameter profile on a model fills its capabilities and is saved', async ({ page }) => {
  const state = await mockAdmin(page)
  await page.getByRole('tab', { name: /模型目录/ }).click()
  await page.locator('article').filter({ hasText: 'GPT Image 2' }).getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('combobox', { name: '生图尺寸参数' })).toBeVisible()
  await page.getByRole('combobox', { name: '生图参数档案' }).click({ force: true })
  await page.getByRole('option', { name: 'Grok 原生' }).click()
  await expect(page.getByText('已按「Grok 原生」填好分辨率')).toBeVisible()
  // The profile governs size, so the old size option is hidden.
  await expect(page.getByRole('combobox', { name: '生图尺寸参数' })).toHaveCount(0)
  await shot(page, '08-model-profile')
  await page.getByRole('button', { name: '确认修改' }).click()
  await page.getByRole('button', { name: /保存配置/ }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  const model = state.writes[0].models.find(item => item.id === 'gpt-image-2')
  expect(model.compat).toEqual({ imageParams: 'grok' })
  expect(model.resolutions).toEqual(['1K', '2K'])
  expect(model.qualities).toEqual([])
  expect(model.maxReferenceImages).toBe(5)
})

test('image parameter profiles are edited with a live request preview', async ({ page }) => {
  const state = await mockAdmin(page)
  await page.getByRole('button', { name: '生图参数档案' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '生图参数档案' })
  await dialog.getByRole('button', { name: /Grok 原生/ }).click()
  const preview = dialog.getByLabel('请求预览')
  await expect(preview).toContainText('"aspect_ratio": "16:9"')
  await expect(preview).toContainText('"resolution": "2k"')
  await expect(preview).not.toContainText('"quality"')
  await expect(dialog.getByRole('checkbox', { name: /背景/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /终端用户标识/ })).not.toBeChecked()
  await dialog.getByLabel('分辨率字段名').fill('res')
  await expect(preview).toContainText('"res": "2k"')
  await expect(preview).toContainText('去掉：size、quality、background、output_format')

  // The real test uses the unsaved draft rules and the chosen platform request.
  await dialog.getByRole('combobox', { name: '测试模型' }).click({ force: true })
  await page.getByRole('option', { name: /GPT Image 2/ }).click()
  await dialog.getByRole('button', { name: /用 2048x1152 测试/ }).click()
  await expect(dialog.getByText('✓ 文生图')).toBeVisible()
  await expect(dialog.getByText(/实际输出 1×1/)).toBeVisible()
  expect(state.modelTests[0]).toMatchObject({
    upstreamModel: 'gpt-image-2', kind: 'image', size: '2048x1152', quality: 'high',
    compat: { imageParams: 'grok' }, imageParamRules: { tierField: 'res', sizeMode: 'aspect_tier' },
  })
  await shot(page, '09-profile-dialog')
  // Only the columns scroll: the dialog body itself never does.
  const bodyScrolls = () => page.locator('.ipd-dialog .el-dialog__body').evaluate(body => body.scrollHeight > body.clientHeight + 1)
  expect(await bodyScrolls()).toBe(false)
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await bodyScrolls()).toBe(false)
  await shot(page, '10-profile-dialog-1280')
  await dialog.getByRole('button', { name: '保存档案' }).click()
  await expect.poll(() => state.profileWrites.length).toBe(1)
  const grok = state.profileWrites[0].profiles.find(profile => profile.id === 'grok')
  expect(grok.rules.tierField).toBe('res')
  expect(state.profileWrites[0].profiles.map(profile => profile.id)).toEqual(['openai', 'grok', 'gemini'])
})
