import { expect, test } from '@playwright/test'
import { fulfillJson, mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

// The original assistant UI driving the v2 engine: Q&A/Agent turns carry
// engine=v2, personal statistics render inside the original message bubble,
// and a send that never created a run gives the input back.

const account = { id: 'engine-v2-user', email: 'v2@example.com', username: '助手用户', role: 'user', requireCostConfirm: false }

const config = {
  conversationModels: [{ model: 'chat-basic', label: 'Chat Basic', pricePoints: 3 }],
  imageModels: [{ model: 'image-basic', label: 'Image Basic', pricePoints: 12, aspectRatios: ['auto', '1:1'], resolutions: ['1K'], qualities: ['low'], maxReferenceImages: 4 }],
}

const statsView = {
  tool: 'my_stats_query',
  view: 'stats',
  data: {
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

function message(id, role, content, extra = {}) {
  return { id, role, content, kind: 'chat', status: 'complete', pending: false, createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:05Z', ...extra }
}

async function mockAssistant(page) {
  await page.addInitScript(() => localStorage.setItem('starclouds-locale', 'zh-CN'))
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await mockBootstrapConfig(page)
  await mockAuthConfig(page)
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
  await page.route('**/api/v1/runtime-config', (route) =>
    fulfillJson(route, { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } }))
  await page.route('**/api/v1/assistant/config', (route) => fulfillJson(route, config))
  await page.route('**/api/v1/assistant/conversations**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      return fulfillJson(route, { id: 'conv-1', title: '新对话', messages: [], createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z' }, 201)
    }
    if (new URL(request.url()).pathname.endsWith('/conversations')) return fulfillJson(route, { conversations: [] })
    return fulfillJson(route, { conversations: [] })
  })
  await page.route('**/api/v1/assistant/runs?**', (route) => fulfillJson(route, { runs: [] }))
}

test.describe('original assistant UI on the v2 engine', () => {
  test('Q&A mode sends ordinary questions to the v2 engine instead of blocking them', async ({ page }) => {
    let runBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      runBody = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-1', conversationId: runBody.conversationId, assistantMessageId: runBody.clientAssistantMessageId, userMessageId: runBody.clientUserMessageId, status: 'succeeded' },
        userMessage: message(runBody.clientUserMessageId, 'user', runBody.prompt),
        assistantMessage: message(runBody.clientAssistantMessageId, 'assistant', '配网步骤如下。'),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.agent-mode-button')).toContainText('问答模式')
    await page.getByLabel('消息输入').fill('物联网设备怎么配网')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant')).toContainText('配网步骤如下。')
    expect(runBody).toMatchObject({ mode: 'chat', engine: 'v2', prompt: '物联网设备怎么配网' })
  })

  test('renders personal statistics inside the original message and keeps in-app links in place', async ({ page }) => {
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-2', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '本月共消耗 240 积分，主要用在 AI 电商。[打开钱包](/wallet)', {
          kind: 'agent', engine: 'v2', dataViews: [statsView],
          toolSteps: [{ requestId: 't1', name: 'my_stats_query', status: 'completed', durationMs: 120 }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('这个月积分都花在哪了')
    await page.getByRole('button', { name: '发送' }).click()

    const reply = page.locator('.message--assistant')
    await expect(reply).toContainText('本月共消耗 240 积分')
    const data = reply.getByRole('region', { name: '统计结果' })
    await expect(data).toContainText('240 积分')
    await expect(data).toContainText('较上期增加 20.0%')
    await expect(data.getByRole('img', { name: '消耗积分对比' })).toBeVisible()
    await data.getByRole('button', { name: '查看表格' }).click()
    await expect(data.getByRole('table')).toContainText('AI 电商')

    const pagesBefore = page.context().pages().length
    await reply.getByRole('link', { name: '打开钱包' }).click()
    await expect(page).toHaveURL(/\/wallet$/)
    expect(page.context().pages().length).toBe(pagesBefore)
  })

  test('renders account, order and charge explanations as cards', async ({ page }) => {
    const views = [
      {
        tool: 'my_account_overview', view: 'account',
        data: {
          balance: { availablePoints: 1520, frozenPoints: 40, subscriptionPoints: 300 },
          subscriptions: [{ planName: '月度会员', status: 'active', statusLabel: '生效中', daysLeft: 11, endsAt: '2026-10-13 09:00', dailyPoints: 100, nextGrantAt: '2026-10-03 09:00' }],
          orders: { pending: 1, confirming: 0 },
        },
      },
      {
        tool: 'my_orders_list', view: 'orders',
        data: { orders: [{ orderNo: 'o-1', createdAt: '2026-10-01 10:00', planName: '1000 积分', amountYuan: 10, points: 1000, bonusPoints: 100, statusLabel: '已完成，积分或套餐已到账' }] },
      },
      {
        tool: 'explain_charge', view: 'charge',
        data: {
          found: true,
          source: { type: 'task', typeLabel: '创作任务', workspaceLabel: 'AI 电商', statusLabel: '成功', model: '高清模型', time: '2026-10-02 09:00', link: '/history' },
          entries: [
            { time: '2026-10-02 09:00', kind: 'freeze', label: '预留', points: 40 },
            { time: '2026-10-02 09:01', kind: 'spend', label: '结算扣费', points: 30 },
            { time: '2026-10-02 09:01', kind: 'release', label: '退回可用余额', points: 10 },
          ],
          totals: { reservedPoints: 40, chargedPoints: 30, returnedPoints: 10, netPoints: 30, pendingPoints: 0 },
          summary: ['提交时预留了 40 积分。'],
        },
      },
    ]
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-3', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '你还有 1520 积分，会员 11 天后到期。', {
          kind: 'agent', engine: 'v2', dataViews: views,
          toolSteps: [{ requestId: 't1', name: 'explain_charge', status: 'completed', durationMs: 80 }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('我还有多少积分，刚才那笔怎么扣的')
    await page.getByRole('button', { name: '发送' }).click()

    const reply = page.locator('.message--assistant')
    const accountCard = reply.getByRole('region', { name: '账户概况' })
    await expect(accountCard).toContainText('1,520')
    await expect(accountCard).toContainText('月度会员')
    await expect(accountCard).toContainText('剩 11 天')
    await expect(accountCard.getByRole('link', { name: '查看订单' })).toBeVisible()
    await expect(reply.getByRole('region', { name: '订单' })).toContainText('1,100')
    const charge = reply.getByRole('region', { name: '扣费说明' })
    await expect(charge).toContainText('30 积分')
    await expect(charge.getByRole('table')).toContainText('退回可用余额')
    await expect(charge.getByRole('link', { name: '查看原记录' })).toHaveAttribute('href', '/history')
  })

  test('gives the input back when the run could not be created', async ({ page }) => {
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      return route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: '积分不足，请先充值', code: 'insufficient_balance' }),
      })
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    const input = page.getByLabel('消息输入')
    await input.fill('上周花了多少积分')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant')).toContainText('生成失败')
    await expect(input).toHaveValue('上周花了多少积分')
  })
})
