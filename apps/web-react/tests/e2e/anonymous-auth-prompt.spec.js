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
  '/assets',
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
    await expect(page.locator('.auth-required-layer')).toHaveAttribute('data-dialog-motion-state', 'entered')
    await expect(dialog).toContainText(item.expected || item.name)
    await expect.poll(() => new URL(page.url()).pathname).toBe(item.path)

    await dialog.getByRole('button', { name: '关闭登录提示' }).click()
    await expect(page.locator('.auth-required-layer')).toHaveAttribute('data-dialog-motion-state', 'exiting')
    await expect(dialog).toBeVisible()
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

test('signed-out assistant does not show an auth error banner or request private workspace state', async ({ page }) => {
  let privateAssistantRequests = 0
  await page.route('**/api/v1/assistant/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          conversationModels: [
            { model: 'configured-chat', label: '已配置对话模型', pricePoints: 5 },
          ],
          imageModels: [
            { model: 'configured-image', label: '已配置图片模型', pricePoints: 12 },
          ],
        },
      }),
    }),
  )
  await page.route('**/api/v1/assistant/conversations**', (route) => {
    privateAssistantRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })
  await page.route('**/api/v1/assistant/runs**', (route) => {
    privateAssistantRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })

  await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.assistant-workspace')).toBeVisible()
  await expect(page.locator('.assistant-service-error')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '消息输入' })).toBeEnabled()
  await expect(page.locator('.image-model-button')).toContainText('已配置对话模型')
  expect(privateAssistantRequests).toBe(0)
})

test('signed-out navbar redeem action opens the shared auth component', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.nav-redeem-btn').click()

  await expect(page.locator('.redeem-dialog')).toHaveCount(0)
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('兑换积分')
  await expect(page).toHaveURL(/\/$/)
})

test('signed-out navbar check-in action opens auth without entering the page', async ({ page }) => {
  await page.goto('/prompts', { waitUntil: 'domcontentloaded' })
  await page.locator('.nav-checkin-btn').click()

  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('每日签到')
  await expect(page).toHaveURL(/\/prompts$/)
})

test('signed-out navbar history action opens auth without entering the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prompts', { waitUntil: 'domcontentloaded' })
  await page.locator('.main-nav > .nav-link').filter({ hasText: '历史记录' }).click()

  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('历史记录')
  await expect(page).toHaveURL(/\/prompts$/)
})

test('signed-out assets page waits for an asset action before opening auth', async ({ page }) => {
  let protectedAssetRequests = 0
  await page.route('**/api/v1/me/assets**', (route) => {
    protectedAssetRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })
  await page.route('**/api/v1/me/asset-groups**', (route) => {
    protectedAssetRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })

  await page.goto('/assets', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.ml-page')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
  expect(protectedAssetRequests).toBe(0)

  await page.getByRole('button', { name: '添加资产' }).click()
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('我的资产')
  await expect(page).toHaveURL(/\/assets$/)
  expect(protectedAssetRequests).toBe(0)
})

test('signed-out trial access action opens auth without opening the application dialog', async ({ page }) => {
  await page.route('**/api/v1/trial-access-campaign', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { campaign: { id: 'trial-campaign', enabled: true, status: 'active', title: '体验计划' } },
      }),
    }),
  )
  await page.goto('/prompts', { waitUntil: 'domcontentloaded' })
  const entry = page.getByRole('button', { name: '申请体验' })
  await expect(entry).toBeVisible()
  await entry.click()

  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('申请体验')
  await expect(page.locator('.trial-dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/prompts$/)
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

test('signed-out canvas creation actions open auth without creating or navigating', async ({ page }) => {
  const cachedProjectTitle = '其他账号的本地画布'
  let canvasProjectRequests = 0
  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (title) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('infinite-canvas', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('app_state')) {
          request.result.createObjectStore('app_state')
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const transaction = request.result.transaction('app_state', 'readwrite')
        transaction.objectStore('app_state').put(JSON.stringify({
          state: {
            ownerUserId: 'previous-user',
            projects: [{
              id: '00000000-0000-4000-8000-000000000099',
              title,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
              nodes: [],
              connections: [],
              chatSessions: [],
              activeChatId: null,
              backgroundMode: 'lines',
              showImageInfo: false,
              viewport: { x: 0, y: 0, k: 1 },
            }],
          },
          version: 0,
        }), 'infinite-canvas:canvas_store')
        transaction.oncomplete = () => {
          request.result.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, cachedProjectTitle)
  await page.route('**/api/v1/canvas-projects**', (route) => {
    canvasProjectRequests += 1
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    })
  })
  await page.goto('/canvas', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
  await expect(page.getByText(cachedProjectTitle, { exact: true })).toHaveCount(0)
  await expect(page.locator('.canvas-native-mount')).toBeVisible()
  expect(canvasProjectRequests).toBe(0)
  await expect(page.getByRole('button', { name: '打开画布' })).toHaveCount(0)
  await page.getByRole('button', { name: '新建画布' }).click()
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('无限画布')
  await expect(page).toHaveURL(/\/canvas$/)

  await page.locator('.auth-required-dialog').getByRole('button', { name: '关闭登录提示' }).click()
  await page.getByRole('button', { name: '导入画布' }).click()
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('无限画布')
  await expect(page).toHaveURL(/\/canvas$/)
  expect(canvasProjectRequests).toBe(0)
})

for (const protectedPath of [
  '/canvas/00000000-0000-4000-8000-000000000001',
  '/canvas/config',
  '/canvas?view=%2Fcanvas%2F00000000-0000-4000-8000-000000000001',
  '/canvas?view=%2Fconfig',
  '/canvas?view=%2Fcanvas%3Fmode%3Dnew',
  '/canvas?view=%2Fcanvas%3Fmode%3Drecent',
  '/canvas?view=%2Fcanvas%3Fmode%3Dchoose',
]) {
  test(`signed-out direct canvas route is guarded: ${protectedPath}`, async ({ page }) => {
    let protectedRequests = 0
    await page.route('**/api/v1/canvas-projects**', (route) => {
      protectedRequests += 1
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
      })
    })

    await page.goto(protectedPath, { waitUntil: 'domcontentloaded' })

    await expect(page.locator('.auth-required-dialog')).toBeVisible()
    await expect(page.locator('.auth-required-dialog')).toContainText('无限画布')
    await expect.poll(() => new URL(page.url()).pathname).toBe('/canvas')
    await expect.poll(() => new URL(page.url()).searchParams.has('view')).toBe(false)
    expect(protectedRequests).toBe(0)
  })
}
