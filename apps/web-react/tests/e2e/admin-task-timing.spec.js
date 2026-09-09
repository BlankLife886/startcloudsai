import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an isolated admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3201'
const now = new Date('2026-09-06T13:17:35Z')

async function setup(page) {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.clock.install({ time: now })
  await page.clock.setFixedTime(now)
  const task = (id, name, patch) => ({
    id, type: 't2i', status: 'queued', attempt: 0,
    prompt: 'test image', params: { _modelDisplayName: name, _providerDisplayName: '测试线路' },
    count: 1, costCents: 3, inputKeys: [], outputKeys: [],
    userEmail: 'test@example.com', createdAt: '2026-09-06T13:15:14Z',
    startedAt: null, finishedAt: null, errorCode: null, errorMessage: null,
    ...patch,
  })
  const rows = [
    task('11111111-1111-4111-8111-111111111111', '首轮任务', {}),
    task('22222222-2222-4222-8222-222222222222', '重试任务', { attempt: 2 }),
    task('33333333-3333-4333-8333-333333333333', '完成任务', {
      status: 'succeeded', attempt: 2,
      createdAt: '2026-09-06T12:15:14Z', startedAt: '2026-09-06T12:17:33Z', finishedAt: '2026-09-06T12:18:33Z',
    }),
  ]
  const writes = []
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url())
    return fulfillJson(route, { items: [], activeBlocks: [] })
  })
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, {
    admin: { id: 'admin-test', email: 'admin@example.com', role: 'admin', username: '测试管理员' },
  }))
  await page.route('**/api/v1/admin/tasks?*', route => fulfillJson(route, {
    items: rows, total: rows.length, nextCursor: null,
    summary: { total: 3, queued: 2, running: 0, succeeded: 1, failed: 0, canceled: 0, today: 3 },
  }))
  await page.route('**/api/v1/admin/tasks/*/timeline', route => fulfillJson(route, {
    items: [{ id: 1, stage: 'queued', status: 'info', message: '排队结束（第 3 次尝试）', durationMs: 139000, meta: { attempt: 3 }, createdAt: '2026-09-06T13:17:33Z' }],
  }))
  await page.goto(`${adminURL}/admin/tasks`)
  return { rows, writes }
}

test('admin task lifetime includes every attempt and ticks while waiting to retry', async ({ page }) => {
  const { writes } = await setup(page)
  await expect(page.getByRole('columnheader', { name: '总耗时', exact: true })).toBeVisible()
  const first = page.getByRole('row').filter({ hasText: '首轮任务' })
  const retry = page.getByRole('row').filter({ hasText: '重试任务' })
  const completed = page.getByRole('row').filter({ hasText: '完成任务' })
  await expect(first).toContainText('排队中')
  await expect(retry).toContainText('等待重试')
  await expect(retry).toContainText('2 分 21 秒')
  await expect(completed).toContainText('3 分 19 秒')
  await page.clock.setFixedTime(new Date(now.valueOf() + 2000))
  await page.clock.fastForward(2000)
  await expect(retry).toContainText('2 分 23 秒')
  await expect(completed).toContainText('3 分 19 秒')
  expect(writes).toEqual([])
})

test('open task details retain total time and update to the final snapshot', async ({ page }) => {
  const { rows, writes } = await setup(page)
  await page.getByRole('row').filter({ hasText: '重试任务' }).getByText('等待重试', { exact: true }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('总耗时')
  await expect(detail).toContainText('2 分 21 秒')
  await expect(detail).toContainText('重试开始')
  await expect(detail).not.toContainText('2 分 19 秒')
  rows[1].status = 'succeeded'
  rows[1].startedAt = '2026-09-06T13:17:33Z'
  rows[1].finishedAt = '2026-09-06T13:18:33Z'
  await page.clock.setFixedTime(new Date(now.valueOf() + 60000))
  await page.clock.fastForward(60000)
  await expect(detail).toContainText('已成功')
  await expect(detail).toContainText('3 分 19 秒')
  await page.clock.fastForward(30000)
  await expect(detail).toContainText('3 分 19 秒')
  expect(writes).toEqual([])
})
