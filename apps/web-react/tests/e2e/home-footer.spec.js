import { expect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
})

test('footer omits the email-sharing form and keeps brand and navigation', async ({ page }) => {
  await page.goto('/?previewBanners=1#home-top')
  const footer = page.locator('.home-footer')
  await expect(footer.locator('.home-footer-mail, form, input, textarea, a[href^="mailto:"]')).toHaveCount(0)
  await expect(footer).not.toContainText(/邮件分享|收件邮箱|撰写邮件|附言/)
  await expect(footer.locator('.home-footer__brand')).toHaveText('星空云绘')
  await expect(footer.getByRole('navigation')).toHaveCount(3)
  await expect(footer.getByRole('link', { name: '回到顶部', exact: true })).toBeVisible()
})

for (const width of [1920, 1024, 745, 390, 320]) {
  test(`grid footer and refined tool cards fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 902 })
    await page.goto('/')
    await expect(page.locator('.home-card__icon')).toHaveCount(0)
    await expect(page.locator('#home-creation h2')).toHaveCSS('font-weight', '650')
    await expect(page.locator('#home-tools .home-compact').first()).toHaveCSS('border-radius', '14px')
    const footer = page.locator('.home-footer')
    await footer.scrollIntoViewIfNeeded()
    expect(await footer.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toContain('linear-gradient')
    expect(await footer.evaluate(el => getComputedStyle(el, '::before').backgroundSize)).toBe('48px 48px, 48px 48px')
    for (const element of [footer.locator('.home-footer__brand'), ...await footer.getByRole('navigation').all()]) {
      const rect = await element.boundingBox()
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath(`footer-${width}.png`) })
  })
}

test('footer grid and navigation follow the dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('walleven-color-scheme', 'dark'))
  await page.goto('/')
  await expect(page.locator('.home-catalog')).toHaveClass(/is-dark/)
  await expect(page.locator('.home-footer')).toHaveCSS('background-color', 'rgb(12, 10, 18)')
  await expect(page.locator('.home-footer').getByRole('navigation')).toHaveCount(3)
})
