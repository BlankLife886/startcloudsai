import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const account = { id: 'account-notify-test', email: 'creator@example.com', username: '星云创作者' }
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

function notifications() {
  return [
    { id: 'n-task', kind: 'task', title: '任务已完成', body: '你的「t2i」任务已生成 4 张图片。', readAt: null, createdAt: minutesAgo(3) },
    { id: 'n-assistant', kind: 'assistant', title: 'AI 助手有新建议', body: '根据你最近的作品整理了 3 个灵感方向。', readAt: null, createdAt: minutesAgo(30), targetPath: '/assistant?c=conv-1' },
    { id: 'n-gallery', kind: 'gallery_review', title: '作品入选首页公告栏', body: '你的投稿已通过审核并被精选。', readAt: null, createdAt: minutesAgo(60) },
    { id: 'n-wallet', kind: 'wallet_redeem', title: '兑换积分已到账', body: '260 积分已加入账户余额。', readAt: '2026-10-01T08:00:00Z', createdAt: minutesAgo(60 * 26) },
  ]
}

async function mockInbox(page, rows = notifications()) {
  const calls = { patch: [], deleted: [] }
  let items = rows
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, { routes: {}, features: {}, pageControls: {} }))
  await page.route('**/api/v1/announcements', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/notifications**', async (route) => {
    const request = route.request()
    const unread = () => items.filter((item) => !item.readAt).length
    if (request.method() === 'PATCH') {
      const ids = request.postDataJSON()?.ids || items.map((item) => item.id)
      calls.patch.push(ids)
      items = items.map((item) => (ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item))
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'DELETE') {
      const id = new URL(request.url()).pathname.split('/').pop()
      calls.deleted.push(id)
      items = id === 'notifications' ? [] : items.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    return fulfillJson(route, { items, unread: unread(), nextCursor: null })
  })
  return calls
}

test('notification inbox groups messages, keeps 公告-titled personal notices, and supports read and delete', async ({ page }) => {
  const calls = await mockInbox(page)
  await page.goto('/notifications')

  const items = page.locator('.nt-item')
  await expect(items).toHaveCount(4)
  await expect(page.locator('.nt-day__head').first()).toContainText('今天')
  await expect(page.locator('.nt-head h1')).toContainText('3')
  // 标题里带「公告」二字的个人通知不能被当成平台公告藏起来
  await expect(page.locator('.nt-item', { hasText: '作品入选首页公告栏' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('notifications-desktop.png'), fullPage: true })

  await page.locator('.nt-scopes').getByRole('button', { name: /未读/ }).click()
  await expect(items).toHaveCount(3)

  const task = page.locator('.nt-item', { hasText: '文生图' })
  await task.hover()
  await task.getByRole('button', { name: '标为已读' }).click()
  await expect.poll(() => calls.patch).toEqual([['n-task']])
  await expect(page.locator('.nt-head h1')).toContainText('2')
  await expect(items).toHaveCount(2)

  await page.locator('.nt-scopes').getByRole('button', { name: /全部/ }).click()
  const wallet = page.locator('.nt-item', { hasText: '兑换积分已到账' })
  await wallet.hover()
  await wallet.getByRole('button', { name: '删除' }).click()
  await expect.poll(() => calls.deleted).toEqual(['n-wallet'])
  await expect(items).toHaveCount(3)

  const visited = []
  page.on('framenavigated', (frame) => frame === page.mainFrame() && visited.push(frame.url()))
  await page.locator('.nt-item', { hasText: 'AI 助手有新建议' }).locator('.nt-item__main').click()
  await expect.poll(() => visited.some((url) => url.endsWith('/assistant?c=conv-1'))).toBe(true)
  await expect.poll(() => calls.patch.at(-1)).toEqual(['n-assistant'])
})

test('announcements have their own nav entry, separate from the notification bell', async ({ page }) => {
  await mockInbox(page)
  const live = { id: 'a-live', title: '十月上新', body: '新模型已上线。', active: true, placement: 'card', frequency: 'session_once', createdAt: minutesAgo(10) }
  await page.route('**/api/v1/announcements', (route) => fulfillJson(route, { items: [live] }))
  await page.goto('/notifications')

  // 铃铛只算通知未读，公告未读挂在独立的公告入口上
  await expect(page.locator('.nav-notify__badge')).toHaveText('3')
  await expect(page.locator('.nav-announce__badge')).toHaveText('1')
  await expect(page.locator('.nt-side').getByRole('link', { name: /平台公告/ })).toHaveCount(0)

  // 弹窗看过并关掉后，公告入口不再提示未读
  await page.locator('.client-announcement-modal__backdrop').click({ position: { x: 8, y: 8 } })
  await expect(page.locator('.nav-announce__badge')).toHaveCount(0)

  await page.locator('.nav-notify__btn').hover()
  await expect(page.locator('.nav-notify__foot').getByRole('link', { name: /公告/ })).toHaveCount(0)

  await page.locator('.nav-announce').click()
  await expect(page).toHaveURL(/\/announcements$/)
  await expect(page.locator('.nt-head h1')).toContainText('公告')
})

test('notification inbox on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockInbox(page)
  await page.goto('/notifications')
  await expect(page.locator('.nt-item')).toHaveCount(4)
  await page.screenshot({ path: test.info().outputPath('notifications-mobile.png'), fullPage: true })
})


test('announcement page is public and keeps ended announcements', async ({ page }) => {
  const day = 86_400_000
  const iso = (offset) => new Date(Date.now() + offset).toISOString()
  const live = { id: 'a-live', title: '国庆活动：全系列直降 2 积分', body: '10月1日–10月7日，所有模型按原价减 2 积分。', active: true, startsAt: iso(-3 * day), endsAt: iso(3 * day + 3_600_000), createdAt: iso(-3 * day), ctaText: '去创作', ctaUrl: '/studio' }
  const history = [
    live,
    { id: 'a-model', title: 'gpt-image-2 模型上线', body: '1. 支持 4K 输出\n2. 文字渲染更准确', active: true, startsAt: null, endsAt: null, createdAt: iso(-8 * day) },
    { id: 'a-ended', title: '系统维护通知', body: '维护期间生成任务会暂停约 30 分钟。', active: true, startsAt: iso(-22 * day), endsAt: iso(-21 * day), createdAt: iso(-23 * day) },
  ]
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: null }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, { routes: {}, features: {}, pageControls: {} }))
  await page.route('**/api/v1/announcements', (route) => fulfillJson(route, { items: [{ ...live, placement: 'banner', frequency: 'every_open' }] }))
  await page.route('**/api/v1/announcements/history', (route) => fulfillJson(route, { items: history }))

  await page.goto('/announcements')
  await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
  await expect(page.locator('.ann-card')).toHaveCount(1)
  await expect(page.locator('.ann-row')).toHaveCount(2)
  await expect(page.locator('.ann-row', { hasText: '系统维护通知' })).toContainText('已结束')
  await expect(page.locator('.nt-head h1')).toContainText('2')
  await page.screenshot({ path: test.info().outputPath('announcements-desktop.png'), fullPage: true })

  await page.locator('.ann-card').click()
  await expect(page).toHaveURL(/\/announcements\/a-live$/)
  const article = page.locator('.ann-article')
  await expect(article).toContainText('所有模型按原价减 2 积分')
  await expect(article.getByRole('link', { name: /去创作/ })).toHaveAttribute('href', '/studio')
  await page.screenshot({ path: test.info().outputPath('announcements-detail.png') })
  await page.locator('.ann-detail__back').click()
  await expect(page).toHaveURL(/\/announcements$/)
  await expect(page.locator('.nt-head h1')).toContainText('1')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: test.info().outputPath('announcements-mobile.png'), fullPage: true })
})

test('a newly arrived notification rings the bell and shows a toast once', async ({ page }) => {
  const rows = notifications().slice(0, 1)
  await mockInbox(page, rows)
  await page.goto('/announcements')
  await expect(page.locator('.nav-notify__badge')).toHaveText('1')
  // 首次加载的已有通知不提醒
  await expect(page.locator('.notify-toast')).toHaveCount(0)

  rows.unshift({ id: 'n-new', kind: 'order', sourceType: 'order', title: '订单已支付', body: '会员已开通。', readAt: null, createdAt: new Date().toISOString() })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('starclouds:notifications-updated', { detail: { unreadCount: 2, source: 'sse' } })))

  const toast = page.locator('.notify-toast')
  await expect(toast).toContainText('订单已支付')
  await expect(page.locator('.nav-notify')).toHaveClass(/is-ringing/)
  await expect(page.locator('.nav-notify__badge')).toHaveText('2')
  await page.screenshot({ path: test.info().outputPath('notification-toast.png') })

  await toast.getByRole('button', { name: '关闭提醒' }).click()
  await expect(toast).toHaveCount(0)

  // 同一条不会重复提醒
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('starclouds:notifications-updated', { detail: { unreadCount: 3, source: 'sse' } })))
  await page.waitForTimeout(300)
  await expect(toast).toHaveCount(0)

  // 提示音开关同步到账号的提醒设置
  const savedPrefs = []
  await page.route('**/api/v1/me/notification-preferences', async (route) => {
    if (route.request().method() === 'PUT') savedPrefs.push(route.request().postDataJSON())
    return fulfillJson(route, route.request().postDataJSON() || {})
  })
  await page.locator('.nav-notify__btn').hover()
  const sound = page.locator('button.nav-notify__sound')
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => savedPrefs.at(-1)?.sound).toBe(false)
  await expect(page.getByRole('link', { name: '提醒设置' })).toHaveAttribute('href', '/account#notification-preferences')
})
