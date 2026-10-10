import { expect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { fulfillJson } from './helpers/authMocks.js'

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`focused QR checkout ${theme} ${viewport.width}`, async ({ page }, testInfo) => {
      await installVisualBaseline(page)
      await page.setViewportSize(viewport)
      await page.addInitScript(theme => {
        localStorage.setItem('walleven-color-scheme', theme)
        localStorage.setItem('starclouds-appearance', theme)
      }, theme)
      await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'qr-test', email: 'qr@example.com' } }))
      await page.route('**/api/v1/runtime-config', route => fulfillJson(route, { features: {} }))
      await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
      const plan = { id: 'qr-plan', name: '基础创作额度包', kind: 'topup', priceCents: 990, grantCents: 1000, bonusCents: 200 }
      const order = { id: 'qr-order', planId: plan.id, planName: plan.name, status: 'pending', amountCents: 990, paymentMethod: 'alipay', payUrl: 'https://example.com/payment-test', expiresAt: '2026-08-11T04:10:00Z' }
      await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [plan], paymentEnabled: true, paymentMethods: ['alipay', 'wechat'] }))
      await page.route('**/api/v1/orders', route => fulfillJson(route, order))
      await page.route('**/api/v1/orders/qr-order', route => fulfillJson(route, order))
      await page.goto('/pricing')
      const opener = page.locator('.pp-plan__purchase > button')
      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
      await expect(dialog.locator('.pp-checkout__method')).toHaveText('支付宝扫码支付')
      await expect(dialog.locator('.pp-checkout__amount strong')).toHaveText('¥9.90')
      await expect(page.locator('.pp-checkout-backdrop')).toHaveClass(theme === 'dark' ? /is-dark/ : /backdrop$/)
      await expect(dialog).toHaveCSS('border-radius', '32px')
      await expect(dialog).toHaveCSS('border-width', '0px')
      const rect = await dialog.boundingBox()
      const qr = await dialog.locator('.pp-checkout__qr').boundingBox()
      const timer = await dialog.locator('.pp-checkout__timer').boundingBox()
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width)
      const expectedQR = viewport.width <= 520 ? 248 : 280
      expect(qr.width).toBe(expectedQR)
      expect(qr.height).toBe(expectedQR)
      expect(Math.abs(qr.x + qr.width / 2 - viewport.width / 2)).toBeLessThan(1)
      expect(timer.y).toBeGreaterThan(qr.y + qr.height - 1)
      expect(Math.abs(timer.x + timer.width / 2 - viewport.width / 2)).toBeLessThan(2)
      const pixels = await dialog.locator('canvas').evaluate(canvas => {
        const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let dark = 0, white = 0
        for (let n = 0; n < values.length; n += 4) {
          if (values[n] < 70 && values[n + 3] > 240) dark++
          if (values[n] > 240 && values[n + 3] > 240) white++
        }
        return { dark, white }
      })
      expect(pixels.dark).toBeGreaterThan(1000)
      expect(pixels.white).toBeGreaterThan(1000)
      expect(await page.evaluate(() => Boolean(document.elementFromPoint(8, 8)?.closest('.pp-checkout-backdrop')))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`checkout-${theme}-${viewport.width}.png`) })
      await page.locator('.pp-checkout-backdrop').click({ position: { x: 8, y: 8 } })
      await expect(dialog).toBeVisible()
      const cancel = dialog.getByRole('button', { name: '取消订单', exact: true })
      await cancel.focus()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(cancel).toBeFocused()
      await cancel.click()
      await expect(dialog.getByRole('button', { name: '确认取消', exact: true })).toBeVisible()
      const confirmedQR = await dialog.locator('.pp-checkout__qr').boundingBox()
      expect(Math.abs(qr.y - confirmedQR.y)).toBeLessThan(2)
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    })
  }
}
