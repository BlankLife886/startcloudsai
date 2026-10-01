import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

function notice(id, patch = {}) {
  return { id, title: `公告 ${id}`, body: `正文 ${id}`, placement: 'modal', layout: 'text_only', allowClose: true, frequency: 'session_once', version: 1, createdAt: '2026-09-09T12:00:00Z', ...patch }
}

async function mockLiveAnnouncements(page, initialItems = []) {
  let items = initialItems
  let failed = false
  let reads = 0
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('starclouds-locale', 'zh-CN')
    localStorage.setItem('starclouds-appearance', 'light')
    window.__announcementStreams = []
    window.__announcementVisibility = 'visible'
    window.__announcementOnline = true
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__announcementVisibility })
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__announcementOnline })
    window.EventSource = class FakeEventSource {
      constructor(url, options) {
        this.url = String(url)
        this.options = options
        this.readyState = 0
        this.handlers = new Map()
        this.closed = false
        if (this.url.endsWith('/announcements/events')) window.__announcementStreams.push(this)
        queueMicrotask(() => {
          if (!this.closed) { this.readyState = 1; this.onopen?.({}) }
        })
      }
      addEventListener(name, handler) {
        if (!this.handlers.has(name)) this.handlers.set(name, new Set())
        this.handlers.get(name).add(handler)
      }
      removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler) }
      emit(data) {
        if (!this.closed) for (const handler of this.handlers.get('announcements') || []) handler({ data: typeof data === 'string' ? data : JSON.stringify(data) })
      }
      fail(closed = false) { this.readyState = closed ? 2 : 0; this.onerror?.({}) }
      close() { this.closed = true; this.readyState = 2 }
    }
  })
  await page.route('**/api/**', route => fulfillJson(route, {}))
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: null }))
  await page.route('**/api/v1/runtime-config', route => fulfillJson(route, { routes: {}, features: {}, pageControls: {} }))
  await page.route('**/api/v1/me/notifications**', route => fulfillJson(route, { items: [], unread: 0, nextCursor: null }))
  await page.route('**/api/v1/announcements', route => {
    reads += 1
    return failed ? fulfillJson(route, {}, 503) : fulfillJson(route, { items })
  })
  return { setItems: value => { items = value }, fail: value => { failed = value }, reads: () => reads }
}

async function emitSnapshot(page, items) {
  await expect.poll(() => page.evaluate(() => window.__announcementStreams.filter(stream => !stream.closed).length)).toBe(1)
  await page.evaluate(value => window.__announcementStreams.find(stream => !stream.closed).emit({ items: value }), items)
}

async function dismissModal(page) {
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
}

test('a public SSE snapshot appears immediately and only a new push reopens a dismissed notice', async ({ page }) => {
  const controls = await mockLiveAnnouncements(page)
  await page.goto('/')
  await expect.poll(controls.reads).toBeGreaterThan(0)
  const first = notice('live', { frequency: 'every_open' })
  const reads = controls.reads()
  await emitSnapshot(page, [first])
  await expect(page.getByRole('dialog', { name: '公告 live' })).toBeVisible()
  expect(controls.reads()).toBe(reads)
  await dismissModal(page)
  await emitSnapshot(page, [{ ...first, version: 2, body: '普通编辑后不重弹' }])
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
  const pushed = { ...first, version: 2, pushId: 'push-one', pushedAt: new Date().toISOString() }
  await emitSnapshot(page, [pushed])
  await expect(page.getByRole('dialog', { name: '公告 live' })).toBeVisible()
  await dismissModal(page)
  await emitSnapshot(page, [pushed])
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('starclouds-announcement:live')))
  expect(stored.pushId).toBe('push-one')
  await emitSnapshot(page, [{ ...pushed, pushId: 'push-two' }])
  await expect(page.getByRole('dialog', { name: '公告 live' })).toBeVisible()
})

test('latest pushes take precedence and deactivation removes current announcements', async ({ page }) => {
  const old = notice('old')
  await mockLiveAnnouncements(page, [old])
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: '公告 old' })).toBeVisible()
  const latest = notice('priority', { pushId: 'priority-push' })
  await emitSnapshot(page, [latest, old])
  await expect(page.getByRole('dialog', { name: '公告 priority' })).toBeVisible()
  await dismissModal(page)
  await expect(page.getByRole('dialog', { name: '公告 old' })).toBeVisible()
  await emitSnapshot(page, [])
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
})

test('host and notification center share one stream and update the announcement tab together', async ({ page }) => {
  const first = notice('shared')
  const controls = await mockLiveAnnouncements(page, [first])
  await page.goto('/notifications?tab=announce')
  await expect(page.getByRole('dialog', { name: '公告 shared' })).toBeVisible()
  await dismissModal(page)
  const list = page.locator('.nt-announce-list')
  await expect(list.locator('.nt-announce-item')).toHaveCount(1)
  await list.getByRole('button', { name: /公告 shared/ }).click()
  await expect(list.locator('.nt-announce-item')).toHaveClass(/is-open/)
  const reads = controls.reads()
  await emitSnapshot(page, [{ ...first, version: 2, body: '实时更新的公告正文' }])
  await expect(list.locator('.nt-announce-item__detail')).toContainText('实时更新的公告正文')
  await expect(list.locator('.nt-announce-item')).toHaveClass(/is-open/)
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
  expect(controls.reads()).toBe(reads)
  expect(await page.evaluate(() => window.__announcementStreams.filter(stream => !stream.closed).length)).toBe(1)
  const added = notice('new-shared', { placement: 'banner', pushId: 'new-shared-push' })
  await emitSnapshot(page, [added, first])
  await expect(list.locator('.nt-announce-item')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: /公告/ })).toContainText('2')
  await expect(page.locator('.promo-banner')).toContainText('公告 new-shared')
  await emitSnapshot(page, [added])
  await expect(list.locator('.nt-announce-item')).toHaveCount(1)
  await expect(list).not.toContainText('公告 shared')
})

test('local expiry removes an announcement while offline', async ({ page }) => {
  const now = new Date('2026-09-09T12:00:00Z')
  await page.clock.install({ time: now })
  const expiring = notice('expires', { endsAt: new Date(now.getTime() + 3000).toISOString() })
  await mockLiveAnnouncements(page, [expiring])
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: '公告 expires' })).toBeVisible()
  await page.evaluate(() => {
    window.__announcementOnline = false
    window.dispatchEvent(new Event('offline'))
  })
  await page.clock.runFor(3100)
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
})

test('failed streams poll as a fallback, preserve notices on errors and stop polling after recovery', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T12:00:00Z') })
  const first = notice('fallback-old')
  const controls = await mockLiveAnnouncements(page, [first])
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: '公告 fallback-old' })).toBeVisible()
  await emitSnapshot(page, [first])
  controls.fail(true)
  const failedResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/announcements') && response.status() === 503)
  await page.evaluate(() => window.__announcementStreams.find(stream => !stream.closed).fail())
  await failedResponse
  await expect(page.getByRole('dialog', { name: '公告 fallback-old' })).toBeVisible()
  const next = notice('fallback-new', { pushId: 'fallback-push' })
  controls.setItems([next])
  controls.fail(false)
  await page.clock.runFor(30_001)
  await expect(page.getByRole('dialog', { name: '公告 fallback-new' })).toBeVisible()
  await dismissModal(page)
  await emitSnapshot(page, [next])
  const reads = controls.reads()
  await page.clock.runFor(30_001)
  expect(controls.reads()).toBe(reads)
  await expect(page.locator('.client-announcement-modal')).toHaveCount(0)
})

test('foreground and online recovery reconnect once and retrieve missed pushes', async ({ page }) => {
  const controls = await mockLiveAnnouncements(page)
  await page.goto('/')
  await emitSnapshot(page, [])
  await page.evaluate(() => {
    window.__announcementVisibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(await page.evaluate(() => window.__announcementStreams.filter(stream => !stream.closed).length)).toBe(0)
  controls.setItems([notice('foreground', { pushId: 'foreground-push' })])
  await page.evaluate(() => {
    window.__announcementVisibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog', { name: '公告 foreground' })).toBeVisible()
  expect(await page.evaluate(() => window.__announcementStreams.filter(stream => !stream.closed).length)).toBe(1)
  await dismissModal(page)
  await page.evaluate(() => {
    window.__announcementOnline = false
    window.dispatchEvent(new Event('offline'))
  })
  controls.setItems([notice('online', { pushId: 'online-push' })])
  await page.evaluate(() => {
    window.__announcementOnline = true
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.getByRole('dialog', { name: '公告 online' })).toBeVisible()
  expect(await page.evaluate(() => window.__announcementStreams.filter(stream => !stream.closed).length)).toBe(1)
})

test('an older GET response cannot overwrite a newer SSE snapshot', async ({ page }) => {
  await mockLiveAnnouncements(page)
  let pendingRoute
  await page.route('**/api/v1/announcements', route => { pendingRoute = route })
  await page.goto('/')
  await expect.poll(() => Boolean(pendingRoute)).toBe(true)
  await emitSnapshot(page, [notice('newest', { pushId: 'newest-push' })])
  await expect(page.getByRole('dialog', { name: '公告 newest' })).toBeVisible()
  const response = page.waitForResponse('**/api/v1/announcements')
  await fulfillJson(pendingRoute, { items: [] })
  await response
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.getByRole('dialog', { name: '公告 newest' })).toBeVisible()
})

test('a permanently closed stream reconnects and accepts its latest snapshot', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T12:00:00Z') })
  await mockLiveAnnouncements(page)
  await page.goto('/')
  await emitSnapshot(page, [])
  const connections = await page.evaluate(() => window.__announcementStreams.length)
  await page.evaluate(() => window.__announcementStreams.find(stream => !stream.closed).fail(true))
  await page.clock.runFor(5001)
  await expect.poll(() => page.evaluate(() => window.__announcementStreams.length)).toBe(connections + 1)
  await emitSnapshot(page, [notice('reconnected', { pushId: 'reconnected-push' })])
  await expect(page.getByRole('dialog', { name: '公告 reconnected' })).toBeVisible()
})
