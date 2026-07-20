import { test, expect } from '@playwright/test'
import { mockAuthConfig, mockBootstrapConfig } from './helpers/authMocks.js'

test.describe('Auth page performance', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('login page layout stays stable after navigation', async ({ page }) => {
    await mockBootstrapConfig(page)
    await mockAuthConfig(page)

    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.auth-panel-shell')
    await page.waitForTimeout(400)

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector('.auth-panel-shell')
      return {
        shellTop: shell?.getBoundingClientRect().top ?? 0,
        shellHeight: shell?.getBoundingClientRect().height ?? 0,
      }
    })

    expect(metrics.shellHeight).toBeGreaterThan(200)
    expect(Math.abs(metrics.shellTop)).toBeLessThan(2000)
  })
})
