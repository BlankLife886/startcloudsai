import { expect, test } from '@playwright/test'

test('pricing refresh keeps the target navigation and renders a loading shell', async ({ page }) => {
  let releaseAuth
  const authGate = new Promise((resolve) => {
    releaseAuth = resolve
  })

  await page.route('**/api/client/auth/me', async (route) => {
    await authGate
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unauthorized' }),
    })
  })

  await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

  const pricingNav = page.locator('.main-nav .nav-link.active', { hasText: '模型价格' })
  await expect(pricingNav).toBeVisible()
  await expect(page.locator('.main-nav .nav-home-link')).not.toHaveClass(/active/)
  await expect(page.locator('#pricing-static-boot')).toBeVisible()

  releaseAuth()
  await expect(page).toHaveURL(/\/auth\?redirect=(%2F|\/)pricing&mode=login/)
  await expect(page.locator('#pricing-static-boot')).toHaveCount(0)
})
