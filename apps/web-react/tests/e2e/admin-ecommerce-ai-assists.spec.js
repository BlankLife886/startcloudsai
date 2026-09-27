import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'

const MODEL = { id: 'gpt-analysis', name: '商品分析 · GPT', provider: 'Sub2API', upstreamModel: 'gpt-5-mini' }

function assists({ model = MODEL, enabled = true } = {}) {
  const base = {
    modelSource: '模型配置 › 工作区 › AI 电商 › 商品分析模型（未指定时取该工作区第一个可用的对话模型）',
    model,
    modelError: model ? '' : '未配置：请在模型配置中为“AI 电商”绑定商品分析模型，否则以下功能都会失败',
    billing: '不扣用户积分',
  }
  return [
    { ...base, id: 'tryon-garment-classify', name: '服装品类识别', tool: '虚拟试衣', description: '识别服装是上装、下装还是全身。', trigger: '用户在虚拟试衣上传服装图后自动调用', endpoint: 'POST /api/v1/commerce/tryon/garment-classifications', rateLimit: '每人每分钟 30 次', toggleable: true, enabled, offBehavior: '关闭后上传服装不再识别' },
    { ...base, id: 'product-brief', name: 'AI 商品识别', tool: '商拍 / 套图 / 营销图等', description: '生成商品名称与卖点。', trigger: '用户点击“AI 生成商品信息”时调用', endpoint: 'POST /api/v1/commerce/product-briefs', rateLimit: '每人每分钟 60 次', toggleable: false, enabled: true },
  ]
}

async function mockAdmin(page, options = {}) {
  const writes = []
  let enabled = options.enabled ?? true
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, {
    admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' },
  }))
  await page.route('**/api/v1/admin/ecommerce/ai-assists', route =>
    fulfillJson(route, { items: assists({ model: options.model === undefined ? MODEL : options.model, enabled }) }))
  await page.route('**/api/v1/admin/ecommerce/ai-assists/*', async route => {
    const payload = route.request().postDataJSON()
    writes.push({ url: route.request().url(), payload })
    enabled = payload.enabled
    return fulfillJson(route, { id: 'tryon-garment-classify', enabled })
  })
  await page.goto(`${adminURL}/admin/ecommerce`)
  return { writes }
}

test('AI 电商后台能看到服装识别关联的接口、模型、限流，并能开关', async ({ page }) => {
  const state = await mockAdmin(page)
  await page.getByRole('button', { name: 'AI 辅助功能' }).click()
  const dialog = page.locator('.ai-assists')
  await expect(dialog.locator('.ai-assist')).toHaveCount(2)
  const classify = dialog.locator('.ai-assist').first()
  await expect(classify).toContainText('服装品类识别')
  await expect(classify).toContainText('POST /api/v1/commerce/tryon/garment-classifications')
  await expect(classify).toContainText('商品分析 · GPT')
  await expect(classify).toContainText('gpt-5-mini')
  await expect(classify).toContainText('模型配置 › 工作区 › AI 电商 › 商品分析模型')
  await expect(classify).toContainText('每人每分钟 30 次')
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-ycc-Documents-TestCode-startcloudsai/df23ecdd-896c-4dbc-aaf3-e6779b53f812/scratchpad/admin-assists.png' })

  await classify.locator('.el-switch').click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0].url).toContain('/ai-assists/tryon-garment-classify')
  expect(state.writes[0].payload).toEqual({ enabled: false })
  // 常开项没有开关
  await expect(dialog.locator('.ai-assist').nth(1).locator('.el-switch')).toHaveCount(0)
  await expect(dialog.locator('.ai-assist').nth(1)).toContainText('常开')
})

test('没有配置商品分析模型时明确提示去哪里配置', async ({ page }) => {
  await mockAdmin(page, { model: null })
  await page.getByRole('button', { name: 'AI 辅助功能' }).click()
  await expect(page.locator('.ai-assists .el-alert')).toContainText('请在模型配置中为“AI 电商”绑定商品分析模型')
  await expect(page.locator('.ai-assist').first()).toContainText('未配置')
})
