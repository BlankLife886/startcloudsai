import { test, expect } from '@playwright/test'
import { getDefaultPageControls } from '../../src/config/pageControls.js'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3200'

async function mockAdminSettings(page, initial = {}, { failLoad = false } = {}) {
  let pageControls = structuredClone(initial)
  const writes = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, {
    admin: { id: 'admin', username: '管理员', email: 'admin@example.com', role: 'admin' },
  }))
  await page.route('**/api/v1/admin/settings', async route => {
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON()
      writes.push(payload)
      pageControls = structuredClone(payload.pageControls)
    } else if (failLoad) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: '配置读取失败' } }) })
    }
    return fulfillJson(route, { pageControls })
  })
  await page.goto(`${adminURL}/admin/page-controls`)
  return { writes, controls: () => pageControls }
}

test('admin manages new pages and retains defaults from a partial configuration', async ({ page }) => {
  const state = await mockAdminSettings(page, { studio: { status: 'maintenance', reason: '工作台升级' } })
  await expect(page.getByText('配置已同步', { exact: true })).toBeVisible()
  await expect(page.locator('.control-row')).toHaveCount(Object.keys(getDefaultPageControls()).length)
  await expect(page.getByRole('radiogroup', { name: '插画染色 页面状态' }).getByRole('radio', { name: '开发', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radiogroup', { name: '签到活动 页面状态' }).getByRole('radio', { name: '下架', exact: true })).toHaveAttribute('aria-checked', 'true')

  const search = page.getByRole('textbox', { name: '搜索页面或路径' })
  await search.fill('psd')
  await expect(page.locator('.control-row')).toHaveCount(1)
  await page.getByRole('radiogroup', { name: 'PSD 拆解 页面状态' }).getByRole('radio', { name: '维护', exact: true }).click()
  await page.getByRole('textbox', { name: 'PSD 拆解 状态说明' }).fill('PSD 工作台升级，稍后恢复。')
  await page.getByRole('button', { name: '保存并生效' }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.controls().psd_decompose).toEqual({ status: 'maintenance', reason: 'PSD 工作台升级，稍后恢复。' })
  expect(state.controls().studio).toEqual({ status: 'maintenance', reason: '工作台升级' })
  expect(Object.keys(state.controls()).sort()).toEqual(Object.keys(getDefaultPageControls()).sort())
  expect(state.controls()['activity.checkin'].status).toBe('removed')
  expect(state.controls().developer_api.status).toBe('removed')
  expect(state.controls().developer_api_docs.status).toBe('normal')
  await expect(page.getByRole('button', { name: '保存并生效' })).toBeDisabled()

  await search.fill('holo')
  await page.getByRole('radiogroup', { name: '全息卡片 页面状态' }).getByRole('radio', { name: '下架', exact: true }).click()
  await page.getByRole('button', { name: '保存并生效' }).click()
  const confirmation = page.locator('.el-message-box')
  await expect(confirmation).toContainText('全息卡片')
  await confirmation.getByRole('button', { name: '确认下架', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(2)
  expect(state.controls().holo_card.status).toBe('removed')
  await page.reload()
  await expect(page.getByText('配置已同步', { exact: true })).toBeVisible()
  await search.fill('holo')
  await expect(page.getByRole('radiogroup', { name: '全息卡片 页面状态' }).getByRole('radio', { name: '下架', exact: true })).toHaveAttribute('aria-checked', 'true')
})

test('group filtering and bulk status changes stay within their group', async ({ page }) => {
  const state = await mockAdminSettings(page, getDefaultPageControls())
  await expect(page.getByText('配置已同步', { exact: true })).toBeVisible()
  await page.getByText('全部分组', { exact: true }).click()
  await page.getByRole('option', { name: '图像工具', exact: true }).click()
  await expect(page.locator('.control-group')).toHaveCount(1)
  await expect(page.locator('.control-row')).toHaveCount(4)
  await page.getByRole('button', { name: '整组设为' }).click()
  await page.getByRole('menuitem', { name: '维护中', exact: true }).click()
  await expect(page.getByText('有 4 处未保存变更', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存并生效' }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  for (const key of ['background_remove', 'image_compress', 'puzzle', 'media_tools']) {
    expect(state.controls()[key].status).toBe('maintenance')
  }
  expect(state.controls().studio.status).toBe('normal')
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.getByRole('button', { name: '保存并生效' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('failed settings loads cannot overwrite existing page controls', async ({ page }) => {
  const state = await mockAdminSettings(page, {}, { failLoad: true })
  await expect(page.locator('.sync-state')).toHaveText('配置读取失败')
  await page.getByRole('radiogroup', { name: 'API 文档 页面状态' }).getByRole('radio', { name: '维护', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存并生效' })).toBeDisabled()
  expect(state.writes).toHaveLength(0)
})
