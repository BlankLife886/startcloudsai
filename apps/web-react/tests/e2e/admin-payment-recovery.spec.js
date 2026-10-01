import { test, expect } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires an isolated admin dev server')
const adminURL = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3201'
const orderID = '11111111-1111-4111-8111-111111111111'

async function setup(page, supported) {
  let submitted = null
  let resolved = false
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [], activeBlocks: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: '22222222-2222-4222-8222-222222222222', email: 'admin@example.com', username: '管理员', role: 'admin', avatarUrl: null } }))
  await page.route('**/api/v1/admin/payment-reconciliations?*', route => fulfillJson(route, {
    recoverySupported: supported,
    items: resolved ? [] : [{ id: 1, orderId: orderID, localStatus: 'failed', expectedAmountCents: 990, outcome: 'provider_id_missing', checkedAt: '2026-09-05T00:00:00Z' }],
  }))
  await page.route('**/api/v1/admin/payment-reconciliations/run', route => {
    submitted = route.request().postDataJSON()
    resolved = true
    return fulfillJson(route, { checked: 1, outcomes: { repaired: 1 } })
  })
  await page.goto(`${adminURL}/admin/security-center`)
  await page.getByRole('tab', { name: /支付对账/ }).click()
  return () => submitted
}

test('recovery is hidden when the backend lacks protocol support', async ({ page }) => {
  await setup(page, false)
  await expect(page.getByRole('button', { name: '关联云端订单号', exact: true })).toHaveCount(0)
})

test('admin associates a channel ID through the verified recovery action', async ({ page }) => {
  const result = await setup(page, true)
  await page.getByRole('button', { name: '关联云端订单号', exact: true }).first().click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '关联云端订单号' })
  await dialog.getByRole('textbox').first().fill(orderID)
  await dialog.getByRole('textbox').last().fill('provider-verified')
  await dialog.getByRole('button', { name: '校验并关联', exact: true }).click()
  await expect.poll(() => result()?.providerOrderId).toBe('provider-verified')
  expect(result().orderId).toBe(orderID)
  await expect(dialog).not.toBeVisible()
})
