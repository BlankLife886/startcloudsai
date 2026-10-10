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
    await expect(page.locator('.agent-mode-button')).toContainText('Agent 模式')
    await page.locator('.agent-mode-button').click()
    await page.getByRole('button', { name: '问答模式' }).click()
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

  test('keeps a daily statistics chart and its long table inside the card', async ({ page }) => {
    const days = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`)
    const daily = {
      tool: 'my_stats_query',
      view: 'stats',
      data: {
        range: { from: '2026-10-01', to: '2026-10-31', label: '本月' },
        metrics: [{ id: 'images', label: '生成图片数', unit: '张' }],
        dimensions: [{ id: 'day', label: '日期' }],
        rows: days.map((day, index) => ({ keys: { day }, labels: { day }, values: { images: [86, 3, 50, 1][index] || 0 } })),
        totals: { images: 140 },
      },
    }
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-daily', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '本月累计生成 **140 张**。', { kind: 'agent', engine: 'v2', dataViews: [daily] }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('这个月每天生成了多少张图')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.locator('.message--assistant').getByRole('region', { name: '统计结果' })
    await expect(card.getByRole('img', { name: '生成图片数趋势' })).toBeVisible()
    await card.getByRole('button', { name: '查看表格' }).click()
    await expect(card.getByRole('table')).toContainText('2026-10-31')
    // 按钮、图表、表格都不超出卡片右边框
    const overflow = await card.evaluate((node) => {
      const right = node.getBoundingClientRect().right - parseFloat(getComputedStyle(node).borderRightWidth)
      return ['.assistant-data-toggle', '.assistant-data-chart svg', '.assistant-data-table-wrap']
        .map((selector) => Math.round(node.querySelector(selector).getBoundingClientRect().right - right))
    })
    expect(Math.max(...overflow)).toBeLessThanOrEqual(0)
    // 31 行的表格限高滚动，不把卡片拉得很长
    const wrap = card.locator('.assistant-data-table-wrap')
    expect(await wrap.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  })

  test('switches the time range of a statistics card, compares and exports it', async ({ page }) => {
    const query = { metrics: ['spend_points'], dimensions: ['workspace'], timeRange: { preset: 'this_month' }, compareToPrevious: true }
    const lastMonth = {
      ...statsView.data, query: { ...query, timeRange: { preset: 'last_month' } },
      range: { from: '2026-09-01', to: '2026-09-30', label: '上月' },
      totals: { spend_points: 90 }, previousTotals: { spend_points: 60 },
      rows: [{ keys: { workspace: 'assistant' }, labels: { workspace: 'AI 助手' }, values: { spend_points: 90 } }],
    }
    let statsBody = null
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/stats-query', async (route) => {
      statsBody = route.request().postDataJSON()
      await fulfillJson(route, statsBody.compareToPrevious ? lastMonth : { ...lastMonth, previousTotals: undefined, previousRange: undefined, query: { ...lastMonth.query, compareToPrevious: false } })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-stats', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '本月共消耗 240 积分。', {
          kind: 'agent', engine: 'v2', dataViews: [{ ...statsView, data: { ...statsView.data, query } }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('这个月积分都花在哪了')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.getByRole('region', { name: '统计结果' })
    await expect(card.getByRole('button', { name: '本月' })).toHaveAttribute('aria-pressed', 'true')
    await card.getByRole('button', { name: '上月' }).click()
    await expect(card).toContainText('90 积分')
    expect(statsBody).toMatchObject({ metrics: ['spend_points'], dimensions: ['workspace'], timeRange: { preset: 'last_month' }, compareToPrevious: true })
    await expect(card.getByRole('button', { name: '上月' })).toHaveAttribute('aria-pressed', 'true')
    await card.getByRole('button', { name: '对比上一期' }).click()
    await expect.poll(() => statsBody?.compareToPrevious).toBe(false)
    await expect(card.getByRole('button', { name: '对比上一期' })).toHaveAttribute('aria-pressed', 'false')

    const download = page.waitForEvent('download')
    await card.getByRole('button', { name: '导出 CSV' }).click()
    expect((await download).suggestedFilename()).toBe('我的统计_2026-09-01_2026-09-30.csv')
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

  test('confirms, tracks, checks and delivers an e-commerce set from the card', async ({ page }) => {
    const shot = (id, label, extra = {}) => ({ id, label, role: 'main', aspectRatio: '1:1', attempts: 0, status: 'planned', reviewed: false, pass: false, canRedo: false, ...extra })
    const base = { id: 'set-1', productName: '保温杯', platform: '天猫', summary: '清爽白蓝', modelId: 'img', quotedCents: 20, total: 2, workbenchLink: '/ecommerce-design' }
    const planned = { ...base, status: 'planned', approvedCents: 0, done: 0, ready: false, needsReview: false, autoApprovable: false,
      confirmationNote: '这套图预计 20 积分，需要你在方案卡片上确认后再生成。',
      shots: [shot('white', '产品白底图'), shot('selling', '核心卖点图', { headline: '一杯暖一天', role: 'detail', aspectRatio: '3:4' })] }
    const finished = { ...base, status: 'generating', approvedCents: 20, done: 2, ready: false, needsReview: true,
      shots: [
        shot('white', '产品白底图', { attempts: 1, status: 'succeeded', imageUrl: '/api/v1/files/out/white.png', fileKey: 'tasks/assistant-user/assistant/set/white.png', canRedo: true, priceCents: 10 }),
        shot('selling', '核心卖点图', { attempts: 1, status: 'succeeded', imageUrl: '/api/v1/files/out/selling.png', canRedo: true, priceCents: 10 }),
      ] }
    const checked = { ...finished, status: 'done', needsReview: false, ready: true, downloadable: 2, spentCents: 20,
      shots: [
        { ...finished.shots[0], reviewed: true, pass: true },
        { ...finished.shots[1], reviewed: true, pass: false, issues: ['标题有错别字'] },
      ] }
    let generateBody = null
    let adoptBody = null
    let editRunBody = null
    let current = planned
    await mockAssistant(page)
    await page.route('**/api/v1/files/out/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route('**/api/v1/assistant/commerce-sets/set-1**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/generate')) {
        generateBody = route.request().postDataJSON()
        current = finished
        return fulfillJson(route, { ...finished, needsReview: false, done: 0, shots: finished.shots.map((item) => ({ ...item, status: 'running', imageUrl: '' })) })
      }
      if (url.pathname.endsWith('/adopt')) {
        adoptBody = route.request().postDataJSON()
        current = { ...checked, shots: [{ ...checked.shots[0], attempts: 2, edited: true, imageUrl: '/api/v1/files/out/edited.png' }, checked.shots[1]] }
        return fulfillJson(route, current)
      }
      if (url.pathname.endsWith('/review')) {
        current = checked
        return fulfillJson(route, { set: checked, reviewed: 2, failed: ['selling'], autoRedo: [] })
      }
      return fulfillJson(route, current)
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      if (body.mode === 'image') {
        editRunBody = body
        return fulfillJson(route, {
          run: { id: 'run-5', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
          userMessage: message(body.clientUserMessageId, 'user', body.userMessageContent),
          assistantMessage: message(body.clientAssistantMessageId, 'assistant', '', {
            kind: 'image', runId: 'run-5',
            images: [{ id: 'edited-image', fileKey: 'tasks/assistant-user/assistant/run-5/1.png', dataUrl: '/api/v1/files/out/edited.png' }],
          }),
        }, 201)
      }
      return fulfillJson(route, {
        run: { id: 'run-4', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '方案已准备好：2 张图，预计 20 积分，确认后开始出图。', {
          kind: 'agent', engine: 'v2', dataViews: [{ tool: 'commerce_set_plan', view: 'commerce_set', data: planned }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('帮我做一套保温杯的天猫主图')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.locator('.message--assistant').getByRole('region', { name: '电商套图' })
    await expect(card).toContainText('2 张 · 预计 20 积分')
    await expect(card).toContainText('一杯暖一天')
    await expect(card).toContainText('需要你在方案卡片上确认')
    await card.getByRole('button', { name: '确认生成（20 积分）' }).click()
    expect(generateBody).toEqual({ expectedTotalCents: 20 })

    // Polling picks up the finished images, the card runs the check once,
    // then offers the download and a redo for the flagged image.
    await expect(card.getByRole('link', { name: '下载全部' })).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('标题有错别字')
    await expect(card).toContainText('待修正')
    await expect(card.getByRole('button', { name: '重做 · 10 积分' })).toHaveCount(2)
    await expect(card.getByRole('link', { name: '在电商工作台继续调整' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '存为满意方案' })).toBeVisible()

    // Clicking a shot opens the image editor; a described edit runs as an
    // image edit of that shot and the result replaces it in the set.
    await card.getByRole('button', { name: '查看并编辑「产品白底图」' }).click()
    const viewer = page.getByRole('dialog', { name: '图片查看与编辑' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole('heading')).toHaveText('保温杯 · 产品白底图')
    for (const name of ['标注', '评论', '去背景', '擦除', '调整尺寸']) {
      await expect(viewer.getByRole('toolbar', { name: '编辑工具' }).getByRole('button', { name })).toBeVisible()
    }
    await viewer.getByLabel('描述修改').fill('把背景换成浅灰色')
    await viewer.getByRole('button', { name: '生成修改' }).click()
    await expect.poll(() => editRunBody).not.toBeNull()
    expect(editRunBody).toMatchObject({ mode: 'image', count: 1, userMessageContent: '把背景换成浅灰色' })
    expect(editRunBody.referenceImages[0]).toMatchObject({ fileKey: 'tasks/assistant-user/assistant/set/white.png' })
    await expect.poll(() => adoptBody).toEqual({ shotId: 'white', fileKey: 'tasks/assistant-user/assistant/run-5/1.png', note: '把背景换成浅灰色' })
    await expect(viewer.getByRole('button', { name: '查看修改 1' })).toBeVisible()
    await viewer.getByRole('button', { name: '关闭预览' }).click()
    await expect(card).toContainText('已修改')
  })

  test('keeps the images of an earlier round after the set was changed', async ({ page }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAEElEQVR4nGP43+AAQQx4WQCsOxT19tJRYAAAAABJRU5ErkJggg==', 'base64')
    const version = (n) => ({ id: 'set-3', productName: '按压泵瓶', platform: '亚马逊', quotedCents: 20, approvedCents: 20 * n, spentCents: 20 * n, total: 2, done: 2,
      ready: true, downloadable: 2, needsReview: false, status: 'done',
      shots: ['hero', 'scene'].map((id) => ({ id, label: id === 'hero' ? '首屏视觉图' : '场景图', role: 'detail', aspectRatio: '16:9', attempts: n, status: 'succeeded',
        imageUrl: `/api/v1/files/out/${id}-v${n}.png`, originalUrl: `/api/v1/files/out/${id}-v${n}.png`, reviewed: true, pass: true, canRedo: true, priceCents: 10 })) })
    await mockAssistant(page)
    await page.route('**/api/v1/files/out/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    await page.route('**/api/v1/assistant/commerce-sets/set-3**', (route) => fulfillJson(route, version(2)))
    let round = 0
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      round += 1
      return fulfillJson(route, {
        run: { id: `run-r${round}`, conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', round === 1 ? '这套图做好了。' : '已去掉 Logo。', {
          kind: 'agent', engine: 'v2', dataViews: [{ tool: 'commerce_set_status', view: 'commerce_set', data: version(round) }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('做一套亚马逊图')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant').first().getByRole('region', { name: '电商套图' })).toBeVisible()
    await page.getByLabel('消息输入').fill('瓶子去掉 logo 再做这两张')
    await expect(async () => {
      await page.getByRole('button', { name: '发送' }).click()
      await expect(page.locator('.message--assistant')).toHaveCount(2, { timeout: 1_500 })
    }).toPass({ timeout: 10_000 })

    // 上一轮的图还在（只读），最新的卡片是新版本。
    const earlier = page.locator('.message--assistant').first().getByRole('region', { name: '这一轮的成片' })
    await expect(earlier).toContainText('已被下方新版本替换')
    await expect(earlier.locator('img')).toHaveCount(2)
    await expect(earlier.locator('img').first()).toHaveAttribute('src', '/api/v1/files/out/hero-v1.png')
    const latest = page.locator('.message--assistant').last().getByRole('region', { name: '电商套图' })
    await expect(latest.locator('img').first()).toHaveAttribute('src', '/api/v1/files/out/hero-v2.png')
    await expect(page.getByRole('region', { name: '电商套图' })).toHaveCount(1)
  })

  test('shows only its own round in an earlier reply while a later turn is still running', async ({ page }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAEElEQVR4nGP43+AAQQx4WQCsOxT19tJRYAAAAABJRU5ErkJggg==', 'base64')
    const version = (n) => ({ id: 'set-4', productName: '按压泵瓶', platform: '亚马逊', quotedCents: 20, approvedCents: 20 * n, spentCents: 20 * n, total: 2, done: 2,
      ready: true, downloadable: 2, needsReview: false, status: 'done',
      shots: ['hero', 'scene'].map((id) => ({ id, label: id === 'hero' ? '首屏视觉图' : '场景图', role: 'detail', aspectRatio: '16:9', attempts: n, status: 'succeeded',
        imageUrl: `/api/v1/files/out/${id}-v${n}.png`, originalUrl: `/api/v1/files/out/${id}-v${n}.png`, reviewed: true, pass: true, canRedo: true, priceCents: 10 })) })
    await mockAssistant(page)
    await page.route('**/api/v1/files/out/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    // 套图的实时状态已经是后来的第 3 版
    await page.route('**/api/v1/assistant/commerce-sets/set-4**', (route) => fulfillJson(route, version(3)))
    let round = 0
    let pendingBody = null
    await page.route('**/api/v1/assistant/runs/run-w2**', (route) => (route.request().url().includes('/events')
      ? route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': keep-alive\n\n' })
      : fulfillJson(route, {
        run: { id: 'run-w2', conversationId: pendingBody?.conversationId, assistantMessageId: pendingBody?.clientAssistantMessageId, userMessageId: pendingBody?.clientUserMessageId, status: 'running' },
        assistantMessage: message(pendingBody?.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true }),
      })))
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      round += 1
      const running = round > 1
      if (running) pendingBody = body
      return fulfillJson(route, {
        run: { id: `run-w${round}`, conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: running ? 'running' : 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: running
          ? message(body.clientAssistantMessageId, 'assistant', '', { status: 'running', pending: true })
          : message(body.clientAssistantMessageId, 'assistant', '这套图做好了。', { kind: 'agent', engine: 'v2', dataViews: [{ tool: 'commerce_set_status', view: 'commerce_set', data: version(1) }] }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('做一套亚马逊图')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('.message--assistant').first().getByRole('region', { name: '电商套图' })).toBeVisible()
    await page.getByLabel('消息输入').fill('瓶子去掉 logo 再做这两张')
    await expect(async () => {
      await page.getByRole('button', { name: '发送' }).click()
      await expect(page.locator('.message--assistant')).toHaveCount(2, { timeout: 1_500 })
    }).toPass({ timeout: 10_000 })

    // 上面那一轮只显示它自己出的第 1 版，不显示套图后来的状态。
    const earlier = page.locator('.message--assistant').first().getByRole('region', { name: '这一轮的成片' })
    await expect(earlier).toContainText('下方正在处理新的要求')
    await expect(earlier.locator('img').first()).toHaveAttribute('src', '/api/v1/files/out/hero-v1.png')
    await expect(page.getByRole('region', { name: '电商套图' })).toHaveCount(0)
  })

  test('previews the detail pages of a set in a phone frame and downloads the long image', async ({ page }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAEElEQVR4nGP43+AAQQx4WQCsOxT19tJRYAAAAABJRU5ErkJggg==', 'base64')
    const shot = (id, label, role, headline = '') => ({ id, label, role, headline, aspectRatio: role === 'main' ? '1:1' : '3:4', attempts: 1, status: 'succeeded',
      imageUrl: `/api/v1/files/out/${id}.png`, originalUrl: `/api/v1/files/out/${id}.png`, reviewed: true, pass: true, canRedo: true, priceCents: 10 })
    const set = { id: 'set-2', productName: '保温杯', platform: '天猫', modelId: 'img', quotedCents: 40, approvedCents: 40, spentCents: 40, total: 4, done: 4,
      ready: true, downloadable: 4, needsReview: false, status: 'done', workbenchLink: '/ecommerce-design',
      shots: [shot('white', '产品白底图', 'main'), shot('hero', '首屏视觉图', 'detail', '一杯暖一天'), shot('hand', '手持场景', 'detail'), shot('spec', '规格参数', 'detail')] }
    await mockAssistant(page)
    await page.route('**/api/v1/files/out/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    await page.route('**/api/v1/assistant/commerce-sets/set-2**', (route) => fulfillJson(route, set))
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-6', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '这套图做好了。', {
          kind: 'agent', engine: 'v2', dataViews: [{ tool: 'commerce_set_status', view: 'commerce_set', data: set }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('看看保温杯套图')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.locator('.message--assistant').getByRole('region', { name: '电商套图' })
    await card.getByRole('button', { name: '预览详情页' }).click()
    const preview = page.getByRole('dialog', { name: '详情页预览' })
    await expect(preview).toContainText('天猫 · 3 屏 · 750 宽长图')
    // 只有详情页进手机框，主图不进。
    await expect(preview.locator('.adp-screen img')).toHaveCount(3)
    await expect(preview.getByRole('button', { name: /产品白底图/ })).toHaveCount(0)
    await preview.getByRole('button', { name: /^\d+\s*规格参数/ }).click()
    await expect(preview.getByRole('button', { name: /^\d+\s*规格参数/ })).toHaveAttribute('aria-current', 'true')

    // 拖动「规格参数」到第一位：手机里的顺序跟着变，关掉再打开还是这个顺序。
    const rows = preview.locator('.adp-row-main')
    const from = await rows.nth(2).boundingBox()
    const to = await rows.nth(0).boundingBox()
    await page.mouse.move(from.x + 40, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + from.height / 2 - 10, { steps: 3 })
    await page.mouse.move(to.x + 40, to.y + 4, { steps: 8 })
    await page.mouse.up()
    await expect(rows.nth(0)).toContainText('规格参数')
    await expect(preview.locator('.adp-screen img').first()).toHaveAttribute('src', '/api/v1/files/out/spec.png')
    await preview.getByRole('button', { name: '关闭预览' }).click()
    await expect(preview).toHaveCount(0)
    await card.getByRole('button', { name: '预览详情页' }).click()
    await expect(rows.nth(0)).toContainText('规格参数')
    // 键盘也能调：Alt + ↓ 把它挪回第二位，再一键恢复原顺序。
    await rows.nth(0).focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect(rows.nth(1)).toContainText('规格参数')
    await preview.getByRole('button', { name: '恢复原顺序' }).click()
    await expect(rows.nth(2)).toContainText('规格参数')
    await expect(preview.getByRole('button', { name: '恢复原顺序' })).toHaveCount(0)

    // 移除一屏：手机和长图里都没有它，下方可以一键恢复，且回到原来的位置。
    await rows.nth(1).hover()
    await preview.getByRole('button', { name: '移除「手持场景」' }).click()
    await expect(preview.locator('.adp-screen img')).toHaveCount(2)
    await expect(preview).toContainText('天猫 · 2 屏')
    await expect(preview).toContainText('已移除 1 屏')
    await preview.getByRole('button', { name: '恢复「手持场景」' }).click()
    await expect(rows.nth(1)).toContainText('手持场景')
    await expect(preview.locator('.adp-screen img')).toHaveCount(3)
    // 键盘 Delete 也能移除；只剩一屏时不能再移除。
    await rows.nth(0).focus()
    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete')
    await expect(rows).toHaveCount(1)
    await expect(preview.getByRole('button', { name: /^移除「/ })).toHaveCount(0)
    await preview.getByRole('button', { name: '恢复默认（顺序和全部屏）' }).click()
    await expect(rows).toHaveCount(3)

    const download = page.waitForEvent('download')
    await preview.getByRole('button', { name: '下载长图' }).click()
    expect((await download).suggestedFilename()).toBe('保温杯-详情页.jpg')
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
  })

  test('finds images, then confirms and undoes a library change from the card', async ({ page }) => {
    const views = [
      {
        tool: 'assets_search', view: 'assets',
        data: { query: '猫 海报', groups: [], items: [
          { id: 'asset:a1', kind: 'asset', title: '中秋猫咪海报', imageUrl: '/api/v1/files/out/a1.png', group: '节日海报', time: '2026-09-30 10:00', link: '/assets' },
          { id: 'task:t1', kind: 'generated', title: '一只橘猫坐在月亮上', prompt: '一只橘猫坐在月亮上的海报，暖色调', imageUrl: '/api/v1/files/out/t1.png', workspace: '文生图', time: '2026-09-29 10:00', link: '/history' },
        ] },
      },
      {
        tool: 'assets_organize', view: 'asset_action',
        data: { action: 'move', assetIds: ['asset:a1'], group: '中秋', createGroup: true, titles: ['中秋猫咪海报'], summary: '把 1 个素材移到「中秋」（新建这个分组）' },
      },
    ]
    let executed = null
    let undone = null
    await mockAssistant(page)
    await page.route('**/api/v1/files/out/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await page.route('**/api/v1/assistant/asset-actions/execute', async (route) => {
      executed = route.request().postDataJSON()
      return fulfillJson(route, { undo: { action: 'move', items: [{ assetId: 'a1', previousGroup: 'g-old' }], createdGroup: 'g-new' } })
    })
    await page.route('**/api/v1/assistant/asset-actions/undo', async (route) => {
      undone = route.request().postDataJSON()
      return fulfillJson(route, { undone: true })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-5', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '找到 2 张，已准备把海报移到「中秋」分组，确认后执行。', {
          kind: 'agent', engine: 'v2', dataViews: views,
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('找一下我的猫咪海报，放到中秋分组')
    await page.getByRole('button', { name: '发送' }).click()

    const reply = page.locator('.message--assistant')
    const found = reply.getByRole('region', { name: '找到的图片' })
    await expect(found).toContainText('“猫 海报” · 2 张')
    await expect(found).toContainText('节日海报')
    await expect(found.getByRole('button', { name: '复制提示词' })).toBeVisible()
    const action = reply.getByRole('region', { name: '资产整理' })
    await expect(action).toContainText('新建这个分组')
    await action.getByRole('button', { name: '确认执行' }).click()
    await expect(action).toContainText('已完成')
    expect(executed.action).toMatchObject({ action: 'move', group: '中秋', assetIds: ['asset:a1'] })
    await action.getByRole('button', { name: '撤销' }).click()
    await expect(action).toContainText('已撤销')
    expect(undone.undo).toMatchObject({ action: 'move', createdGroup: 'g-new' })
  })

  test('remembers from a reply, undoes it, and manages memory in the panel', async ({ page }) => {
    const brand = { id: 'm-brand', kind: 'brand', kindLabel: '品牌资料', title: '品牌色', content: '雾霾蓝，做图默认主色', imageKeys: [], imageUrls: [], source: 'assistant', createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z' }
    const style = { id: 'm-style', kind: 'style', kindLabel: '风格偏好', title: '画面风格', content: '喜欢暖色调', imageKeys: [], imageUrls: [], source: 'user', createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z' }
    let items = [brand, style]
    let enabled = true
    const calls = []
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/memories**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const body = request.postDataJSON?.() ?? null
      calls.push(`${request.method()} ${path.replace('/api/v1/assistant/memories', '') || '/'}`)
      if (request.method() === 'GET') {
        return fulfillJson(route, { enabled, items, limit: 200, kinds: [] })
      }
      if (path.endsWith('/settings')) {
        enabled = body.enabled
        return fulfillJson(route, { enabled })
      }
      const id = path.split('/').pop()
      if (request.method() === 'DELETE') {
        const previous = items.find((item) => item.id === id)
        items = items.filter((item) => item.id !== id)
        return fulfillJson(route, { action: 'deleted', previous })
      }
      if (request.method() === 'PATCH') {
        const previous = items.find((item) => item.id === id)
        const memory = { ...previous, ...body }
        items = items.map((item) => item.id === id ? memory : item)
        return fulfillJson(route, { action: 'updated', memory, previous })
      }
      const memory = { id: `m-${items.length + 1}`, kindLabel: '习惯', imageKeys: [], imageUrls: [], source: 'user', ...body }
      items = [memory, ...items]
      return fulfillJson(route, { action: 'created', memory })
    })
    await page.route('**/api/v1/assistant/runs', async (route) => {
      if (route.request().method() !== 'POST') return fulfillJson(route, { runs: [] })
      const body = route.request().postDataJSON()
      return fulfillJson(route, {
        run: { id: 'run-6', conversationId: body.conversationId, assistantMessageId: body.clientAssistantMessageId, userMessageId: body.clientUserMessageId, status: 'succeeded' },
        userMessage: message(body.clientUserMessageId, 'user', body.prompt),
        assistantMessage: message(body.clientAssistantMessageId, 'assistant', '记住了：品牌色是雾霾蓝。', {
          kind: 'agent', engine: 'v2', dataViews: [{ tool: 'memory_save', view: 'memory_change', data: { action: 'created', memory: brand } }],
        }),
      }, 201)
    })
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('消息输入').fill('记住我的品牌色是雾霾蓝')
    await page.getByRole('button', { name: '发送' }).click()

    const card = page.locator('.message--assistant').getByRole('region', { name: '记忆' })
    await expect(card).toContainText('已记住 · 品牌资料')
    await expect(card).toContainText('雾霾蓝，做图默认主色')
    await card.getByRole('button', { name: '撤销' }).click()
    await expect(card).toContainText('已撤销')
    expect(calls).toContain('DELETE /m-brand')

    await card.getByRole('button', { name: '管理记忆' }).click()
    const panel = page.getByRole('dialog', { name: '记忆与提醒' })
    await expect(panel).toContainText('画面风格')
    await expect(panel).not.toContainText('品牌色')

    await panel.getByRole('button', { name: '添加记忆' }).click()
    await panel.getByRole('radiogroup', { name: '记忆类型' }).getByRole('radio', { name: '习惯' }).click()
    await panel.getByLabel('记忆名称').fill('常用平台')
    await panel.getByLabel('记忆内容').fill('天猫，主图 1:1')
    await panel.getByRole('button', { name: '保存' }).click()
    await expect(panel).toContainText('天猫，主图 1:1')
    expect(calls).toContain('POST /')

    await panel.locator('.assistant-memory-item', { hasText: '画面风格' }).getByRole('button', { name: '编辑' }).click()
    const form = panel.locator('.assistant-memory-item form')
    await expect(form.getByLabel('记忆名称')).toHaveValue('画面风格')
    await form.getByLabel('记忆内容').fill('喜欢冷色调')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(panel).toContainText('喜欢冷色调')

    // Search narrows the list.
    await panel.getByLabel('搜索记忆').fill('天猫')
    await expect(panel.locator('.assistant-memory-item')).toHaveCount(1)
    await panel.getByLabel('搜索记忆').fill('')

    // Deleting is immediate and can be undone from the bar that appears.
    await panel.locator('.assistant-memory-item', { hasText: '常用平台' }).getByRole('button', { name: '删除' }).click()
    await expect(panel.locator('.assistant-memory-item', { hasText: '常用平台' })).toHaveCount(0)
    await panel.getByRole('status').getByRole('button', { name: '撤销' }).click()
    await expect(panel.locator('.assistant-memory-item', { hasText: '常用平台' })).toHaveCount(1)
    await panel.locator('.assistant-memory-item', { hasText: '常用平台' }).getByRole('button', { name: '删除' }).click()
    await expect(panel.locator('.assistant-memory-item', { hasText: '常用平台' })).toHaveCount(0)

    await panel.getByRole('switch', { name: '使用记忆' }).click()
    await expect(panel).toContainText('已关闭')
    expect(enabled).toBe(false)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('shows proactive messages with a way to their settings', async ({ page }) => {
    let settings = { taskNotices: true, alerts: true, reportSchedule: '', thresholds: { lowBalancePoints: 50, spikeFactor: 3, spikeMinPoints: 100, failureRate: 0.3, failureMinTasks: 5, reportHour: 9 } }
    const saved = []
    const inbox = {
      id: 'conv-inbox', title: '助手提醒', createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T09:00:00Z',
      messages: [message('m-alert', 'assistant', '提醒一下：你现在可用 30 积分，不到 50。', { kind: 'agent', engine: 'v2', proactive: 'alert' })],
    }
    await mockAssistant(page)
    await page.route('**/api/v1/assistant/conversations**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/conversations')) return fulfillJson(route, { conversations: [inbox] })
      return fulfillJson(route, inbox)
    })
    await page.route('**/api/v1/assistant/proactive/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        const patch = route.request().postDataJSON()
        saved.push(patch)
        settings = { ...settings, ...patch }
      }
      return fulfillJson(route, settings)
    })
    await page.goto('/assistant?c=conv-inbox', { waitUntil: 'domcontentloaded' })

    const note = page.locator('.assistant-proactive-note')
    await expect(note).toContainText('助手主动发送 · 异常提醒')
    await note.getByRole('button', { name: '提醒设置' }).click()
    const panel = page.getByRole('dialog', { name: '记忆与提醒' })
    await expect(panel.getByRole('tab', { name: '提醒' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel).toContainText('积分低于 50')
    await panel.getByRole('switch', { name: '异常提醒' }).click()
    await expect(panel.getByRole('switch', { name: '异常提醒' })).not.toBeChecked()
    await panel.getByLabel('定时用量报告').selectOption('weekly')
    await expect.poll(() => saved).toEqual([{ alerts: false }, { reportSchedule: 'weekly' }])
    await expect(panel.getByRole('switch', { name: '长任务完成通知' })).toBeChecked()
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
