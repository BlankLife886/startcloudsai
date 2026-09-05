import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { expectPricingPageIsolated } from './helpers/pricingIsolation.js'

test.describe('React migration navigation contract', () => {
  test.skip(
    process.env.REACT_MIGRATION !== '1',
    'Only runs against the isolated React migration app',
  )

  test.beforeEach(async ({ page }) => {
    await installVisualBaseline(page)
  })

  test('desktop dropdown, outside click, and active route state', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    const pricingLink = page.locator('.main-nav .nav-link[href="/pricing"]')
    await expect(pricingLink).toHaveClass(/active/)
    await expect(pricingLink).toHaveAttribute('aria-current', 'page')

    const trigger = page.locator('.nav-dropdown--commerce .nav-dropdown-label')
    const menu = page.locator('[data-dropdown-menu="ecommerce"]')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(menu).toBeVisible()

    await page.mouse.click(8, 890)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).not.toBeVisible()
  })

  test('mobile menu opens and closes after route navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    const toggle = page.locator('.nav-mobile-toggle')
    const navigation = page.locator('#primary-navigation')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation).toBeVisible()

    await navigation.locator('a[href="/prompts"]').click()
    await expect(page).toHaveURL(/\/prompts$/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('pending pricing request does not block client-side navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.route('**/api/v1/pricing', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      await fulfillJson(route, { taskPointPrices: {} })
    })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    await page.locator('.main-nav a[href="/prompts"]').click()
    await expect(page).toHaveURL(/\/prompts$/, { timeout: 2_000 })
    await expect(page.locator('.ch-page--prompts')).toBeVisible()
  })

  test('pricing section state resets after returning to the top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })

    await page.locator('#pricing-faq').scrollIntoViewIfNeeded()
    await expect(page.locator('.pp-nav button', { hasText: '常见问题' })).toHaveClass(/is-active/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.locator('.pp-nav button', { hasText: '套餐方案' })).toHaveClass(/is-active/)
  })

  test('pricing layout stays isolated after a cold visit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' })
    await expectPricingPageIsolated(page)
  })
})
