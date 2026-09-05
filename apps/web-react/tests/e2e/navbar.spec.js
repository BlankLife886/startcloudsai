import { expect, test } from '@playwright/test'

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  username: '导航测试用户',
  avatarUrl: null,
}

test.beforeEach(async ({ page }, testInfo) => {
  const sessionUser = testInfo.title.includes('anonymous') ? null : user
  await page.addInitScript((currentUser) => {
    if (currentUser) sessionStorage.setItem('sc_auth_session_cache', JSON.stringify({ user: currentUser }))
    else sessionStorage.removeItem('sc_auth_session_cache')
    sessionStorage.setItem(
      'walleven.runtime-config.v2',
      JSON.stringify({
        savedAt: Date.now(),
        config: { routes: {}, features: {}, pageLayout: {}, blacklist: { blocked: false } },
      }),
    )
    localStorage.setItem('starclouds-locale', 'zh-CN')
  }, sessionUser)

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    }),
  )
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user: sessionUser } }),
    }),
  )
})

test('desktop dropdown opens on click and closes on trigger or outside', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/studio')

  const studioLink = page.locator('.main-nav > .nav-link').filter({ hasText: '创作台' })
  await expect(studioLink).toHaveClass(/router-link-exact-active/)
  await expect(studioLink).toHaveAttribute('aria-current', 'page')

  const ecommerceDropdown = page.locator('.nav-dropdown').filter({ hasText: 'AI 电商' }).first()
  const ecommerceTrigger = ecommerceDropdown.locator('.nav-dropdown-label')
  await ecommerceTrigger.click()
  await expect(ecommerceDropdown).toHaveClass(/open/)
  const ecommerceMenu = ecommerceDropdown.locator('.commerce-mega-menu')
  await expect(ecommerceMenu).toBeVisible()
  await expect(ecommerceMenu).toHaveAttribute('data-nav-motion-state', 'entered')

  // 快速切换分组时，新菜单必须接管动画且不能残留半透明状态。
  const designDropdown = page.locator('.nav-dropdown--mega')
  await designDropdown.locator('.nav-dropdown-label').click()
  const designMenu = designDropdown.locator('.nav-mega-menu')
  await expect(ecommerceTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(designMenu).toHaveAttribute('data-nav-motion-state', 'entered')
  await expect(designMenu).toHaveCSS('opacity', '1')
  await ecommerceTrigger.click()
  await expect(ecommerceMenu).toHaveAttribute('data-nav-motion-state', 'entered')

  // 再次点击主菜单项关闭
  await ecommerceTrigger.click()
  await expect(ecommerceDropdown).not.toHaveClass(/open/)
  await expect(ecommerceTrigger).toHaveAttribute('aria-expanded', 'false')

  await ecommerceTrigger.click()
  await expect(ecommerceDropdown).toHaveClass(/open/)
  await page.mouse.click(720, 700)
  await expect(ecommerceDropdown).not.toHaveClass(/open/)

  // 打开后点击其它主菜单项也会关闭
  await ecommerceTrigger.click()
  await expect(ecommerceDropdown).toHaveClass(/open/)
  await studioLink.click()
  await expect(ecommerceDropdown).not.toHaveClass(/open/)

  const promptsLink = page.locator('.main-nav > .nav-link').filter({ hasText: '提示词' })
  await promptsLink.click()
  await expect(page).toHaveURL(/\/prompts$/)
  await expect(promptsLink).toHaveClass(/active/)
  await expect(studioLink).not.toHaveClass(/active/)

  const visualState = await promptsLink.evaluate((element) => {
    const style = getComputedStyle(element)
    const marker = getComputedStyle(element, '::after')
    return {
      fontWeight: Number(style.fontWeight),
      markerContent: marker.content,
      markerWidth: marker.width,
    }
  })
  expect(visualState.fontWeight).toBeGreaterThanOrEqual(700)
  expect(visualState.markerContent).not.toBe('none')
  expect(visualState.markerWidth).not.toBe('0px')
})

test('mobile menu closes when the user clicks outside the header', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto('/studio')

  const header = page.locator('.site-header')
  const toggle = page.locator('.nav-mobile-toggle')
  await expect(page.locator('.main-nav > .nav-link').filter({ hasText: '创作台' })).toHaveClass(
    /router-link-exact-active/,
  )
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(header).toHaveClass(/is-mobile-open/)
  const navigation = page.locator('.main-nav')
  await expect(navigation).toBeVisible()
  await expect(navigation).toHaveAttribute('data-nav-motion-state', 'entered')

  await page.mouse.click(550, 780)
  await expect(header).not.toHaveClass(/is-mobile-open/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('authenticated navbar redeem button opens the existing redeem dialog', async ({ page }) => {
  await page.goto('/')
  await page.locator('.nav-redeem-btn').click()

  await expect(page.locator('.redeem-dialog')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '兑换码' })).toBeFocused()
  await page.locator('.redeem-dialog__close').click()
  await expect(page.locator('.redeem-dialog')).toHaveCount(0)
})

test('authenticated navbar check-in button enters the check-in page', async ({ page }) => {
  await page.route('**/api/v1/runtime-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          pageControls: {
            'activity.checkin': { status: 'normal', reason: '' },
          },
        },
      }),
    }),
  )
  await page.goto('/')
  await page.getByTitle('个人中心').click()
  await page.getByRole('menuitem', { name: '签到' }).click()

  await expect(page).toHaveURL(/\/check-in$/)
  await expect(page.locator('.ck-dashboard')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
})

test('notification hover shows recent messages and remains interactive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/me/notifications**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          unread: 2,
          items: [
            {
              id: 'nav-notification-1',
              kind: 'task_complete',
              title: '图片生成完成',
              body: '你的作品已经生成完成，可前往历史记录查看。',
              readAt: null,
              createdAt: new Date(Date.now() - 120_000).toISOString(),
            },
            {
              id: 'nav-notification-2',
              kind: 'wallet_redeem',
              title: '兑换积分已到账',
              body: '260 积分已加入账户余额。',
              readAt: '2026-08-11T08:00:00Z',
              createdAt: '2026-08-11T08:00:00Z',
            },
          ],
          nextCursor: null,
        },
      }),
    }),
  )
  await page.goto('/')

  const notificationButton = page.getByRole('link', { name: '通知' })
  await notificationButton.hover()
  const preview = page.getByRole('dialog', { name: '最近通知' })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('2 条未读')
  await expect(preview).toContainText('图片生成完成')
  await preview.hover()
  await page.waitForTimeout(220)
  await expect(preview).toBeVisible()
  await preview.getByRole('link', { name: /查看全部通知/ }).click()
  await expect(page).toHaveURL(/\/notifications$/)
})

test('account cluster hover shows the profile menu and click still works', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const trigger = page.locator('.account-cluster')
  const menu = page.getByRole('menu', { name: '个人中心菜单' })

  await trigger.hover()
  await expect(menu).toBeVisible()
  await expect(trigger.locator('.account-cluster__plan')).toHaveText('未订阅')
  await expect(menu.getByRole('menuitem', { name: '我的资产' })).toBeVisible()

  await menu.hover()
  await page.waitForTimeout(220)
  await expect(menu).toBeVisible()

  await page.mouse.move(24, 400)
  await expect(menu).toHaveCount(0)

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.mouse.move(24, 400)
  await page.waitForTimeout(220)
  await expect(menu).toBeVisible()
  await page.mouse.click(24, 400)
  await expect(menu).toHaveCount(0)
})

test('navbar logout requires confirmation before deleting the session', async ({ page }) => {
  let logoutRequests = 0
  await page.route('**/api/v1/auth/session', async (route) => {
    if (route.request().method() === 'DELETE') {
      logoutRequests += 1
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user } }),
    })
  })
  await page.goto('/')
  await page.locator('.account-cluster').click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()

  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('退出当前账号？')
  expect(logoutRequests).toBe(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect(logoutRequests).toBe(0)

  await page.locator('.account-cluster').click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await page.getByRole('button', { name: '确认退出' }).click()
  await expect.poll(() => logoutRequests).toBe(1)
  await expect(page.locator('.account-login')).toBeVisible()
})

test('anonymous history navigation opens auth without entering the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prompts')

  const historyLink = page.locator('.main-nav > .nav-link').filter({ hasText: '历史记录' })
  await historyLink.click()

  await expect(page).toHaveURL(/\/prompts$/)
  await expect(historyLink).not.toHaveClass(/active/)
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('历史记录')
})

test('anonymous navigation enters an ecommerce module without opening a prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/tasks**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'auth_required', error: '请先登录' }),
    }),
  )
  await page.goto('/')

  const ecommerceDropdown = page.locator('.nav-dropdown').filter({ hasText: 'AI 电商' }).first()
  await ecommerceDropdown.locator('.nav-dropdown-label').click()
  await ecommerceDropdown.getByRole('menuitem', { name: 'AI 虚拟试衣' }).click()

  await expect(page).toHaveURL(/\/ecommerce-design\?tool=tryon$/)
  await expect(page.locator('.commerce-studio')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toHaveCount(0)

  await page.locator('.generate-button').click()
  await expect(page.locator('.auth-required-dialog')).toBeVisible()
  await expect(page.locator('.auth-required-dialog')).toContainText('AI 电商')
})

test('desktop navigation never overlaps brand or account tools at boundary widths', async ({
  page,
}) => {
  await page.goto('/studio')
  await expect(page.locator('.main-nav > .nav-link').filter({ hasText: '创作台' })).toHaveClass(
    /router-link-exact-active/,
  )

  for (const width of [1800, 1601, 1481, 1440, 1401]) {
    await page.setViewportSize({ width, height: 820 })
    await expect(page.locator('.nav-mobile-toggle')).toBeHidden()
    const [brand, navigation, tools, navigationItems] = await Promise.all([
      page.locator('.brand-cluster').boundingBox(),
      page.locator('.main-nav').boundingBox(),
      page.locator('.header-tools').boundingBox(),
      page.locator('.main-nav > .nav-link, .main-nav > .nav-dropdown').evaluateAll((items) =>
        items.map((item) => {
          const rect = item.getBoundingClientRect()
          return { left: rect.left, right: rect.right }
        }),
      ),
    ])
    expect(brand).not.toBeNull()
    expect(navigation).not.toBeNull()
    expect(tools).not.toBeNull()
    expect(navigation.x).toBeGreaterThanOrEqual(brand.x + brand.width - 1)
    expect(navigation.x + navigation.width).toBeLessThanOrEqual(tools.x + 1)
    expect(
      Math.min(...navigationItems.map((item) => item.left)),
      `left navigation edge overlaps the brand at ${width}px`,
    ).toBeGreaterThanOrEqual(brand.x + brand.width - 4)
    expect(
      Math.max(...navigationItems.map((item) => item.right)),
      `right navigation edge overlaps account tools at ${width}px`,
    ).toBeLessThanOrEqual(tools.x + 4)
  }
})
