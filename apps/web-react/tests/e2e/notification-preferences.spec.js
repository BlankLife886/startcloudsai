import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

const account = { id: 'account-prefs-test', email: 'creator@example.com', username: '星云创作者', createdAt: '2026-01-01T00:00:00Z' }

async function mockAccount(page) {
  const saved = []
  let prefs = { sound: true, categories: { task: 'alert', wallet: 'alert', trial: 'alert', review: 'alert', other: 'alert' }, quietHours: { enabled: false, start: '22:00', end: '08:00' } }
  await page.route('**/api/**', (route) => fulfillJson(route, {}))
  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user: account }))
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, { routes: {}, features: {}, pageControls: {} }))
  await page.route('**/api/v1/announcements', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/notifications**', (route) => fulfillJson(route, { items: [], unread: 0, nextCursor: null }))
  await page.route('**/api/v1/me/notification-preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      prefs = route.request().postDataJSON()
      saved.push(prefs)
    }
    return fulfillJson(route, prefs)
  })
  return saved
}

test('notification preferences save sound, quiet hours and per-category alerts', async ({ page }) => {
  const saved = await mockAccount(page)
  await page.goto('/account#notification-preferences')

  const panel = page.locator('#notification-preferences')
  await expect(panel).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('account-notify-prefs.png'), fullPage: true })

  await panel.getByLabel('提示音').uncheck({ force: true })
  await expect.poll(() => saved.at(-1)?.sound).toBe(false)

  await panel.getByLabel('免打扰时段').check({ force: true })
  await expect(panel.locator('input[type="time"]')).toHaveCount(2)
  await panel.locator('input[type="time"]').first().fill('23:30')
  await expect.poll(() => saved.at(-1)?.quietHours).toEqual({ enabled: true, start: '23:30', end: '08:00' })

  await panel.getByLabel('其他').uncheck({ force: true })
  await expect.poll(() => saved.at(-1)?.categories?.other).toBe('silent')
  await expect(panel).toContainText('静默 · AI 助手建议')
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('account-notify-prefs-edited.png') })
})

test('silenced categories update the badge without a toast', async ({ page }) => {
  await mockAccount(page)
  const rows = [{ id: 'n-old', kind: 'task', title: '任务已完成', readAt: null, createdAt: new Date().toISOString() }]
  await page.route('**/api/v1/me/notifications**', (route) => fulfillJson(route, { items: rows, unread: rows.filter((r) => !r.readAt).length, nextCursor: null }))
  await page.route('**/api/v1/me/notification-preferences', (route) => fulfillJson(route, {
    sound: true, categories: { task: 'alert', wallet: 'alert', trial: 'alert', review: 'alert', other: 'silent' }, quietHours: { enabled: false, start: '22:00', end: '08:00' },
  }))
  await page.goto('/announcements')
  await expect(page.locator('.nav-notify__badge')).toHaveText('1')

  rows.unshift({ id: 'n-assistant', kind: 'assistant', title: 'AI 助手有新建议', readAt: null, createdAt: new Date().toISOString() })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('starclouds:notifications-updated', { detail: { unreadCount: 2, source: 'sse' } })))
  await expect(page.locator('.nav-notify__badge')).toHaveText('2')
  await page.waitForTimeout(300)
  await expect(page.locator('.notify-toast')).toHaveCount(0)

  rows.unshift({ id: 'n-task', kind: 'task', title: '任务已完成', readAt: null, createdAt: new Date().toISOString() })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('starclouds:notifications-updated', { detail: { unreadCount: 3, source: 'sse' } })))
  await expect(page.locator('.notify-toast')).toBeVisible()
})

test('a hidden tab shows a desktop notification instead of only a chime', async ({ page }) => {
  await page.addInitScript(() => {
    window.__desktopNotices = []
    class FakeNotification {
      static permission = 'granted'
      static requestPermission() { return Promise.resolve('granted') }
      constructor(title, options) { window.__desktopNotices.push({ title, body: options?.body }) }
      close() {}
    }
    window.Notification = FakeNotification
    localStorage.setItem('starclouds-notify-desktop', 'on')
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__pageHidden === true })
  })
  await mockAccount(page)
  const rows = [{ id: 'n-old', kind: 'task', title: '任务已完成', readAt: null, createdAt: new Date().toISOString() }]
  await page.route('**/api/v1/me/notifications**', (route) => fulfillJson(route, { items: rows, unread: rows.length, nextCursor: null }))
  await page.goto('/announcements')
  await expect(page.locator('.nav-notify__badge')).toHaveText('1')

  await page.evaluate(() => { window.__pageHidden = true })
  rows.unshift({ id: 'n-pay', kind: 'order', title: '订单已支付', body: '会员已开通。', readAt: null, createdAt: new Date().toISOString() })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('starclouds:notifications-updated', { detail: { unreadCount: 2, source: 'sse' } })))
  await expect.poll(() => page.evaluate(() => window.__desktopNotices)).toEqual([{ title: '订单已支付', body: '会员已开通。' }])
})
