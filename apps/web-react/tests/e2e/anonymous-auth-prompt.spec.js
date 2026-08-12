import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const anonymousRoutes = [
  '/feedback',
  '/assistant',
  '/ecommerce-design',
  '/ai-illustration-coloring',
  '/tools/background-remove',
  '/design-workshop',
  '/model-sheet',
  '/game-art',
  '/canvas',
  '/check-in',
  '/history',
  '/profile',
  '/submissions',
  '/wallet',
  '/account',
  '/notifications',
  '/materials',
  '/incentive-plans',
  '/incentive-plans/group',
  '/incentive-plans/membership',
  '/incentive-plans/failure',
  '/incentive-plans/suggestion',
  '/incentive-plans/usage',
  '/text-to-image',
]

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    sessionStorage.removeItem('sc_auth_session_cache')
    localStorage.setItem('starclouds-locale', 'zh-CN')
  })
  await context.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user: null } }),
    }),
  )
})

for (const route of anonymousRoutes) {
  test(`signed-out user can enter ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect.poll(() => new URL(page.url()).pathname).toBe(route)
    await expect(page.locator('.main-content')).toBeVisible()
    await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
  })
}

for (const item of [
  { name: '文生图', path: '/text-to-image', action: '.t2i-generate' },
  { name: '游戏设计', path: '/game-art', action: '.ga-generate' },
  { name: '模型设计', path: '/model-sheet', action: '.ms3-generate' },
  { name: 'AI 助手', path: '/assistant', action: '.send-button' },
  { name: '创作台', path: '/studio', action: '.studio-composer__submit', expected: 'AI 助手' },
  { name: '插画染色', path: '/ai-illustration-coloring', action: '.coloring-primary-btn' },
  { name: '背景移除', path: '/tools/background-remove', action: '.br-actions .br-btn.is-primary' },
  { name: '每日签到', path: '/check-in', action: '.ck-action.is-primary' },
]) {
  test(`${item.name} action opens the shared auth component without leaving the page`, async ({
    page,
  }) => {
    await page.goto(item.path, { waitUntil: 'domcontentloaded' })
    const action = page.locator(item.action).first()
    await expect(action).toBeVisible()
    await expect(action).toBeEnabled()
    await action.click()

    const dialog = page.locator('.auth-required-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(item.expected || item.name)
    await expect.poll(() => new URL(page.url()).pathname).toBe(item.path)

    await dialog.getByRole('button', { name: '关闭登录提示' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).pathname).toBe(item.path)
  })
}

test('signed-out check-in renders the page without requesting protected state', async ({ page }) => {
  let checkinRequests = 0
  await page.route('**/api/v1/me/checkin', (route) => {
    checkinRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })

  await page.goto('/check-in', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.ck-dashboard')).toBeVisible()
  await expect(page.locator('.ck-state.is-error')).toHaveCount(0)
  await expect(page.locator('.ck-status')).toContainText('登录后可签到')
  expect(checkinRequests).toBe(0)
})

test('signed-out navbar redeem action opens the shared auth component', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.nav-redeem-btn').click()

  await expect(page.locator('.redeem-dialog')).toHaveCount(0)
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('兑换积分')
  await expect(page).toHaveURL(/\/$/)
})

test('registration preserves the exact page for returning after authentication', async ({ page }) => {
  await page.goto('/game-art?asset=character', { waitUntil: 'domcontentloaded' })
  await page.locator('.ga-generate').click()
  await page.getByRole('button', { name: '免费注册' }).click()
  await page.waitForURL(/\/auth\?/, { timeout: 15_000 })
  const url = new URL(page.url())
  expect(url.pathname).toBe('/auth')
  expect(url.searchParams.get('mode')).toBe('register')
  expect(url.searchParams.get('redirect')).toBe('/game-art?asset=character')
})

test('hosted canvas auth requests use the same shared component', async ({ page }) => {
  await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
  const mount = page.locator('.canvas-native-mount')
  await expect(mount).toBeVisible()
  await mount.dispatchEvent('pointerdown')
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'starclouds:canvas:auth-required' } }),
    ),
  )

  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('智能画布')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/canvas')
})
