import { expect, test } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

const account = {
  id: 'v2-user',
  email: 'v2@example.com',
  username: '新版助手用户',
  role: 'user',
  requireCostConfirm: true,
}

const config = {
  conversationModels: [
    { model: 'chat-default', label: 'Chat Default', pricePoints: 4 },
  ],
  imageModels: [],
}

const statsView = {
  tool: 'my_stats_query',
  view: 'stats',
  data: {
    timezone: 'Asia/Shanghai',
    range: { from: '2026-10-01', to: '2026-10-31', label: '本月' },
    previousRange: { from: '2026-09-01', to: '2026-09-30', label: '上一个月' },
    metrics: [{ id: 'spend_points', label: '消耗积分', unit: '积分' }],
    dimensions: [{ id: 'workspace', label: '功能' }],
    rows: [
      { keys: { workspace: 'ecommerce_design' }, labels: { workspace: 'AI 电商' }, values: { spend_points: 180 } },
      { keys: { workspace: 'assistant' }, labels: { workspace: 'AI 助手' }, values: { spend_points: 60 } },
    ],
    totals: { spend_points: 240 },
    previousTotals: { spend_points: 200 },
  },
}

function conversation(id = 'conv-1', title = '新对话') {
  return { id, title, createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z', messages: [] }
}

function message(id, role, content, extra = {}) {
  return { id, role, content, kind: role === 'assistant' ? 'agent' : 'chat', status: 'complete', createdAt: '2026-10-02T08:00:00Z', ...extra }
}

async function mockV2(page, { user = account, conversations = [], activeRuns = [] } = {}) {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } }))
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, config))
  await page.route('**/api/v1/assistant/conversations**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') return fulfillJson(route, conversation(), 201)
    if (request.method() === 'PATCH') return fulfillJson(route, {})
    const url = new URL(request.url())
    if (url.pathname.endsWith('/conversations')) return fulfillJson(route, { conversations })
    return fulfillJson(route, { conversation: conversations[0] || conversation(), messages: [], hasMoreMessages: false })
  })
  await page.route('**/api/v1/assistant/runs/*/events', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"stage":"thinking"}\n\n',
  }))
  await page.route('**/api/v1/assistant/runs?**', (route) => fulfillJson(route, { runs: activeRuns }))
}

test.describe('AI assistant v2', () => {
  test('confirms the turn price, sends a v2 run and renders the stats answer', async ({ page }) => {
    let runBody = null
    await mockV2(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      runBody = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-1', conversationId: runBody.conversationId, assistantMessageId: runBody.clientAssistantMessageId, userMessageId: runBody.clientUserMessageId, status: 'succeeded' },
        userMessage: message(runBody.clientUserMessageId, 'user', runBody.prompt),
        assistantMessage: message(runBody.clientAssistantMessageId, 'assistant', '本月共消耗 240 积分，主要用在 AI 电商。[打开钱包](/wallet)', {
          metadata: { engine: 'v2', dataViews: [statsView], toolSteps: [{ requestId: 't1', name: 'my_stats_query', status: 'completed', durationMs: 120 }] },
        }),
      }, 201)
    })

    await page.goto('/assistant?v=2')
    await expect(page.getByTestId('assistant-v2')).toBeVisible()
    await page.getByRole('button', { name: '这个月积分都花在哪了？' }).click()

    const dialog = page.getByRole('dialog', { name: '确认本轮费用' })
    await expect(dialog).toContainText('4 积分/轮')
    await dialog.getByRole('button', { name: '发送' }).click()

    await expect(page.getByText('本月共消耗 240 积分，主要用在 AI 电商。')).toBeVisible()
    expect(runBody).toMatchObject({ mode: 'agent', engine: 'v2', model: 'chat-default', prompt: '这个月积分都花在哪了？' })
    expect(typeof runBody.timezone).toBe('string')
    expect(runBody.idempotencyKey).toBe(runBody.clientAssistantMessageId)

    const data = page.getByRole('region', { name: '统计结果' })
    await expect(data).toContainText('240 积分')
    await expect(data).toContainText('较上期增加 20.0%')
    await expect(data.getByRole('img', { name: '消耗积分对比' })).toBeVisible()
    await data.getByRole('button', { name: '查看表格' }).click()
    await expect(data.getByRole('table')).toContainText('AI 电商')
    await expect(page.getByRole('button', { name: /用了 1 个工具/ })).toBeVisible()

    await page.getByRole('link', { name: '打开钱包' }).click()
    await expect(page).toHaveURL(/\/wallet$/)
  })

  test('tracks a running turn to completion and shows stop while it runs', async ({ page }) => {
    let polls = 0
    await mockV2(page, { user: { ...account, requireCostConfirm: false } })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      page.__body = body
      return fulfillJson(route, {
        run: { id: 'run-2', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'running', stage: 'thinking' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '', { status: 'running', metadata: { pending: true, statusStage: 'thinking' } }),
      }, 201)
    })
    await page.route('**/api/v1/assistant/runs/run-2', async (route) => {
      polls += 1
      const body = page.__body
      const done = polls >= 2
      return fulfillJson(route, {
        run: { id: 'run-2', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, status: done ? 'succeeded' : 'running', stage: done ? 'complete' : 'answering' },
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', done ? '最近 30 天共创作 12 次。' : '最近 30 天', {
          status: done ? 'complete' : 'running',
          metadata: { pending: !done, statusStage: done ? 'complete' : 'answering' },
        }),
      })
    })

    await page.goto('/assistant?v=2')
    await page.getByLabel('给 AI 助手发消息').fill('最近 30 天我创作了多少次')
    await page.getByLabel('给 AI 助手发消息').press('Enter')
    await expect(page.getByRole('button', { name: '停止当前任务' })).toBeVisible()
    await expect(page.getByText('最近 30 天共创作 12 次。')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: '停止当前任务' })).toBeHidden()
  })

  test('restores the draft when the run cannot be created', async ({ page }) => {
    await mockV2(page, { user: { ...account, requireCostConfirm: false } })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      return route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: '积分不足，请先充值', code: 'insufficient_balance' }),
      })
    })
    await page.goto('/assistant?v=2')
    const input = page.getByLabel('给 AI 助手发消息')
    await input.fill('上周花了多少积分')
    await input.press('Enter')
    await expect(page.getByText('积分不足，请先充值')).toBeVisible()
    await expect(input).toHaveValue('上周花了多少积分')
    await expect(page.getByRole('button', { name: '停止当前任务' })).toBeHidden()
  })

  test('clears a run that finished while the page was away', async ({ page }) => {
    const existing = conversation('conv-9', '上周的统计')
    await mockV2(page, {
      user: { ...account, requireCostConfirm: false },
      conversations: [existing],
      activeRuns: [{ id: 'run-9', conversationId: 'conv-9', assistantMessageId: 'a-9', userMessageId: 'u-9', status: 'running' }],
    })
    await page.route('**/api/v1/assistant/runs/run-9', (route) => fulfillJson(route, {
      run: { id: 'run-9', conversationId: 'conv-9', assistantMessageId: 'a-9', status: 'succeeded' },
      assistantMessage: message('a-9', 'assistant', '上周共消耗 90 积分。'),
    }))
    await page.goto('/assistant?v=2&c=conv-9')
    await expect(page.getByRole('button', { name: '删除对话：上周的统计' })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止当前任务' })).toBeHidden({ timeout: 10_000 })
  })
})
