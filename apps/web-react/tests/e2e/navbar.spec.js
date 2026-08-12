import { expect, test } from '@playwright/test'

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  username: '导航测试用户',
  avatarUrl: null,
}

test.beforeEach(async ({ page }, testInfo) => {
  const sessionUser = testInfo.title.includes('anonymous navigation') ? null : user
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
  await expect(ecommerceDropdown.locator('.commerce-mega-menu')).toBeVisible()

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
  await expect(page.locator('.main-nav')).toBeVisible()

  await page.mouse.click(550, 780)
  await expect(header).not.toHaveClass(/is-mobile-open/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('anonymous navigation enters account pages without opening a prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const homeLink = page.locator('.main-nav > .nav-link').filter({ hasText: '首页' })
  const historyLink = page.locator('.main-nav > .nav-link').filter({ hasText: '历史记录' })
  await historyLink.click()

  await expect.poll(() => new URL(page.url()).pathname).toBe('/history')
  await expect(homeLink).not.toHaveClass(/active/)
  await expect(historyLink).toHaveClass(/active/)
  await expect(page.locator('.auth-required-dialog')).toHaveCount(0)
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
