import { expect, test } from '@playwright/test'

test.skip(!process.env.WEB_BASE_URL?.includes(':8144'), 'Requires the existing isolated sandbox console')

test('sandbox consumes a chosen number of subscription credits without creating a model task', async ({ page }) => {
  let spent = 0, submitted
  await page.route('**/__sandbox/state', route => route.fulfill({ json: {
    mode: 'normal', clock: '2026-09-07T04:00:00Z', creates: 1, checked: 0, gateways: [],
    accounts: [{ account: { key: 'demo', name: '支付测试', email: 'demo@payment.test' }, balance: 100 - spent, summary: { total: 1, uncertain: 0 }, subscription: { ID: 'sub-one', BillingVersion: 2, Status: 'active', DailyGrantCents: 100 }, subscriptionAvailable: 100 - spent, subscriptionSpent: spent, subscriptionHeld: 0 }],
  } }))
  await page.route('**/__sandbox/action', route => {
    submitted = route.request().postDataJSON()
    spent += submitted.points
    return route.fulfill({ json: { result: '已模拟使用订阅积分' } })
  })
  await page.goto('/__sandbox/')
  const account = page.locator('.account')
  await expect(account).toContainText('已使用 0')
  const input = account.getByRole('spinbutton')
  await expect(input).toHaveValue('1')
  await input.fill('2')
  await account.getByRole('button', { name: '模拟使用订阅积分', exact: true }).click()
  await expect(account).toContainText('订阅可用 98 · 已使用 2')
  expect(submitted).toMatchObject({ action: 'consume_subscription', account: 'demo', subscriptionId: 'sub-one', points: 2 })
  expect(submitted.id).toMatch(/^[0-9a-f-]{36}$/)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('sandbox disables consumption while refund credits are held', async ({ page }) => {
  await page.route('**/__sandbox/state', route => route.fulfill({ json: {
    mode: 'normal', clock: '2026-09-07T04:00:00Z', creates: 1, checked: 0, gateways: [],
    accounts: [{ account: { key: 'demo', name: '支付测试', email: 'demo@payment.test' }, balance: 0, summary: { total: 1, uncertain: 0 }, subscription: { ID: 'sub-one', BillingVersion: 2, Status: 'refunding', DailyGrantCents: 100 }, subscriptionAvailable: 0, subscriptionSpent: 1, subscriptionHeld: 99 }],
  } }))
  await page.goto('/__sandbox/')
  await expect(page.locator('.account')).toContainText('退订冻结 99')
  await expect(page.getByRole('button', { name: '模拟使用订阅积分', exact: true })).toBeDisabled()
})
