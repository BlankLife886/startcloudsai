import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'

const user = { id: 'page-controls-user', username: '页面控制测试用户' }
const removed = { status: 'removed', reason: '该页面暂时下架。' }

async function mockControls(page, pageControls = {}, authenticated = false) {
  await installVisualBaseline(page)
  if (authenticated) {
    await page.addInitScript((sessionUser) => {
      sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user: sessionUser }))
    }, user)
    await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }))
  }
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: {
      'ai.mediaTools': {
        enabled: true,
        config: { tools: [{ id: 'image-upscale', name: '高清放大', modality: 'image', pricePoints: 6 }] },
      },
    },
    pageControls,
  }))
  await page.route('**/api/v1/home-banners', (route) => fulfillJson(route, { items: [] }))
}

test('removed pages disappear from homepage cards, footer and dynamic media links', async ({ page }) => {
  await mockControls(page, {
    skills: removed,
    prompts: removed,
    image_compress: removed,
    media_tools: removed,
    history: removed,
    orders: removed,
    psd_decompose: { status: 'maintenance', reason: 'PSD 分解维护中，请稍后再试。' },
  })
  await page.goto('/')
  const home = page.locator('.commercial-home')
  await expect(home).toBeVisible()
  for (const path of ['/skills', '/prompts', '/tools/image-compress', '/tools/image-upscale', '/history', '/orders']) {
    await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0)
  }
  await expect(home.locator('a[href="/account"]')).toBeVisible()
  const psdLink = home.locator('a[href="/psd-decompose"]')
  await expect(psdLink).toBeVisible()
  await expect(psdLink).toContainText('维护中')
  await psdLink.click()
  await expect(page.locator('.status-showcase.is-maintenance')).toContainText('PSD 分解维护中，请稍后再试。')
})

test('tool directory filters removed workspaces and tools while keeping maintained entries', async ({ page }) => {
  await mockControls(page, {
    assistant: removed,
    canvas: removed,
    holo_card: removed,
    image_compress: removed,
    media_tools: removed,
    assets: removed,
    background_remove: { status: 'maintenance', reason: '背景移除维护中' },
  })
  await page.goto('/ai-tools')
  const catalog = page.locator('.ai-tools-page')
  await expect(catalog).toBeVisible()
  for (const path of ['/assistant', '/canvas', '/holo-card', '/tools/image-compress', '/tools/image-upscale', '/assets']) {
    await expect(catalog.locator(`a[href="${path}"]`)).toHaveCount(0)
  }
  await expect(catalog.locator('a[href="/tools/background-remove"]')).toBeVisible()
  await expect(catalog.getByRole('tab', { name: /AI 助手/ })).toHaveCount(0)
  await expect(catalog.getByRole('tab', { name: /无限画布/ })).toHaveCount(0)
})

test('account menu hides removed destinations and notification entry while retaining settings', async ({ page }) => {
  await mockControls(page, Object.fromEntries([
    'profile', 'assets', 'submissions', 'wallet', 'subscriptions', 'orders', 'invitation', 'notifications',
  ].map((key) => [key, removed])), true)
  await page.goto('/')
  await expect(page.locator('.commercial-home')).toBeVisible()
  await page.getByTitle('个人中心').click()
  const menu = page.getByRole('menu', { name: '个人中心菜单' })
  await expect(menu).toBeVisible()
  for (const path of ['/profile', '/assets', '/submissions', '/wallet', '/subscriptions', '/orders', '/invite']) {
    await expect(menu.locator(`a[href="${path}"]`)).toHaveCount(0)
  }
  await expect(page.locator('.nav-notify')).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: '账号设置' })).toBeVisible()
})

test('personal dashboard hides removed shortcuts and keeps account settings accessible', async ({ page }) => {
  await mockControls(page, Object.fromEntries([
    'assets', 'submissions', 'wallet', 'orders', 'history', 'notifications',
  ].map((key) => [key, removed])), true)
  await page.goto('/profile')
  const dashboard = page.locator('.pp-page.is-dashboard')
  await expect(dashboard).toBeVisible()
  for (const path of ['/assets', '/submissions', '/wallet', '/orders', '/history', '/notifications']) {
    await expect(dashboard.locator(`a[href="${path}"]`)).toHaveCount(0)
  }
  await expect(dashboard.getByRole('button', { name: '查看投稿', exact: true })).toHaveCount(0)
  await expect(dashboard.locator('a[href="/account"]')).toBeVisible()
})

for (const [path, key, status] of [
  ['/skills', 'skills', 'removed'],
  ['/SKILLS/', 'skills', 'removed'],
  ['/%73kills', 'skills', 'removed'],
  ['/invite', 'invitation', 'maintenance'],
  ['/psd-decompose', 'psd_decompose', 'developing'],
  ['/holo-card/sample', 'holo_card', 'removed'],
  ['/tools/image-upscale', 'media_tools', 'maintenance'],
  ['/materials', 'assets', 'removed'],
  ['/incentive-plans/membership', 'subscriptions', 'maintenance'],
  ['/developer-api/docs', 'developer_api_docs', 'developing'],
]) {
  test(`direct link ${path} respects its page status`, async ({ page }) => {
    const reason = `${key} 测试状态说明`
    await mockControls(page, { [key]: { status, reason } })
    await page.goto(path)
    await expect(page.locator(`.status-showcase.is-${status}`)).toContainText(reason)
    await expect(page.getByRole('button', { name: '返回上一页' })).toBeVisible()
    await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
  })
}

test('API documentation remains public while developer console is removed', async ({ page }) => {
  await mockControls(page)
  await page.goto('/developer-api/docs')
  await expect(page.locator('.open-api-docs')).toBeVisible()
  await expect(page.locator('.open-api-docs a[href="/developer-api"]')).toHaveCount(0)
  await expect(page.locator('.status-showcase')).toHaveCount(0)
})

test('support remains available when feedback is removed', async ({ page }) => {
  await mockControls(page, { feedback: removed })
  await page.goto('/support')
  await expect(page.locator('main')).toContainText('支持')
  await expect(page.locator('a[href="/feedback"]')).toHaveCount(0)
  await expect(page.locator('.status-showcase')).toHaveCount(0)
})
