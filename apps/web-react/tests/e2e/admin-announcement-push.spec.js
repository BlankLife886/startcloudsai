import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'

async function mockAnnouncements(page, { failFirstPush = false } = {}) {
  const now = Date.now()
  let items = [
    { id: 'live', title: '在线更新公告', body: '打开中的页面也能收到。', active: true, createdAt: new Date(now - 60000).toISOString() },
    { id: 'disabled', title: '停用公告', body: '尚未启用。', active: false },
    { id: 'pending', title: '计划公告', body: '按原计划发布。', active: true, startsAt: new Date(now + 86400000).toISOString() },
    { id: 'ended', title: '过期公告', body: '展示已结束。', active: true, endsAt: new Date(now - 86400000).toISOString() },
  ]
  const pushes = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' } }))
  await page.route('**/api/v1/admin/announcements', route => fulfillJson(route, items))
  await page.route('**/api/v1/admin/announcements/*/push', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)
    pushes.push({ id, method: route.request().method() })
    if (failFirstPush && pushes.length === 1) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'internal_error', error: '推送暂时失败' }) })
    }
    const updated = { ...items.find(item => item.id === id), pushId: `push-${pushes.length}`, pushedAt: new Date().toISOString() }
    items = items.map(item => item.id === id ? updated : item)
    return fulfillJson(route, updated)
  })
  await page.goto(`${adminURL}/admin/content`)
  await expect(page.getByRole('heading', { name: '在线更新公告', exact: true })).toBeVisible()
  return { pushes }
}

function card(page, title) {
  return page.locator('.ann-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

test('admin confirms an immediate push and sees the latest push time', async ({ page }) => {
  const state = await mockAnnouncements(page)
  const live = card(page, '在线更新公告')
  await live.getByRole('button', { name: '立即推送', exact: true }).click()
  const confirmation = page.locator('.el-message-box')
  await expect(confirmation).toContainText('在线更新公告')
  await expect(confirmation).toContainText('已关闭该公告的用户也会再次看到一次')
  expect(state.pushes).toHaveLength(0)
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  expect(state.pushes).toHaveLength(0)
  await live.getByRole('button', { name: '立即推送', exact: true }).click()
  await confirmation.getByRole('button', { name: '立即推送', exact: true }).click()
  await expect.poll(() => state.pushes.length).toBe(1)
  expect(state.pushes[0]).toEqual({ id: 'live', method: 'POST' })
  await expect(live.getByText(/最近推送/)).toBeVisible()
  await expect(page.getByText('已发起推送，在线页面将自动更新', { exact: true })).toBeVisible()
  await expect(live.getByRole('button', { name: '立即推送', exact: true })).toBeEnabled()
})

test('only currently visible announcements can be pushed', async ({ page }) => {
  await mockAnnouncements(page)
  await expect(card(page, '在线更新公告').getByRole('button', { name: '立即推送', exact: true })).toBeEnabled()
  for (const title of ['停用公告', '计划公告', '过期公告']) {
    await expect(card(page, title).getByRole('button', { name: '立即推送', exact: true })).toBeDisabled()
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  const overflow = await page.locator('.ann-card').evaluateAll(cards => cards.some(item => item.scrollWidth > item.clientWidth + 1))
  expect(overflow).toBe(false)
})

test('a failed push retains the announcement and allows retry', async ({ page }) => {
  const state = await mockAnnouncements(page, { failFirstPush: true })
  const live = card(page, '在线更新公告')
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await live.getByRole('button', { name: '立即推送', exact: true }).click()
    await page.locator('.el-message-box').getByRole('button', { name: '立即推送', exact: true }).click()
    await expect.poll(() => state.pushes.length).toBe(attempt)
    await expect(live.getByRole('button', { name: '立即推送', exact: true })).toBeEnabled()
    if (attempt === 1) {
      await expect(page.locator('.el-message--error')).toBeVisible()
      await expect(live.getByText(/最近推送/)).toHaveCount(0)
    }
  }
  await expect(live.getByText(/最近推送/)).toBeVisible()
})
