import { expect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { fulfillJson } from './helpers/authMocks.js'

const base = {
  id: 'order-a', planId: 'plan-a', planName: '基础创作包', planKind: 'topup', status: 'pending',
  amountCents: 990, payAmountCents: 989, grantCents: 1000, bonusCents: 200,
  createdAt: '2026-08-11T03:55:00Z', expiresAt: '2026-08-11T04:10:00Z',
  payUrl: 'https://qr.example/pay-a', paymentMethod: 'alipay', requiresManualAmount: true,
}
const summary = { total: 31, pending: 9, paid: 2, completed: 18, expired: 1, failed: 1 }

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'orders-user', username: '测试用户', email: 'orders@example.com' } }))
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [base], nextCursor: null, summary }))
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, base))
})

for (const width of [1280, 390]) {
  test(`orders overview loads the supplied icon at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/orders')
    const icon = page.locator('.orders-stage__hero img')
    await expect(icon).toHaveAttribute('src', '/pricing/my-orders.webp')
    await expect(icon).toBeVisible()
    await expect.poll(() => icon.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  })
}

test('orders keep exact cents, global totals, server search and expiry-safe payments', async ({ page }) => {
  await page.goto('/orders')
  await expect(page.locator('.orders-stage__count strong')).toHaveText('9')
  await expect(page.locator('.orders-row > b')).toHaveText('¥9.89')
  await expect(page.locator('.orders-pager')).toContainText('共 31 笔')
  await page.getByRole('searchbox', { name: '搜索订单' }).fill('基础创作包')
  const request = page.waitForRequest(r => r.url().includes('/api/v1/orders?') && new URL(r.url()).searchParams.get('q') === '基础创作包')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await request
  await expect(page.locator('.orders-stage__count strong')).toHaveText('9')
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('link', { name: '打开支付' })).toBeVisible()
  await expect(dialog.locator('.order-dialog__paycopy > strong')).toHaveText('¥9.89')
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, { ...base, expiresAt: '2026-08-11T03:59:00Z' }))
  await dialog.getByRole('button', { name: '刷新订单状态' }).click()
  await expect(dialog.getByRole('link', { name: '打开支付' })).toHaveCount(0)
  await expect(dialog).toContainText('支付时间已截止')
  await expect(dialog.locator('.orders-status')).toContainText('待确认')
})

test('closing a detail prevents a late response from reopening or replacing another order', async ({ page }) => {
  const other = { ...base, id: 'order-b', planName: '专业创作包', status: 'completed', paidAt: base.createdAt, completedAt: base.createdAt }
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [base, other], summary }))
  let release
  const blocked = new Promise(resolve => { release = resolve })
  await page.route('**/api/v1/orders/order-a', async route => { await blocked; await fulfillJson(route, base).catch(() => {}) })
  await page.route('**/api/v1/orders/order-b', route => fulfillJson(route, other))
  await page.goto('/orders')
  const firstRequest = page.waitForRequest('**/api/v1/orders/order-a')
  await page.locator('.orders-row').filter({ hasText: '基础创作包' }).click()
  await firstRequest
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.orders-row').filter({ hasText: '专业创作包' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('专业创作包')
  release()
  await expect(page.getByRole('dialog')).toContainText('已入账')
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('专业创作包')
})

test('sync failure blocks payment until retry succeeds and clears the warning', async ({ page }) => {
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, { ...base, syncError: '支付渠道暂时无法确认状态，请稍后刷新' }))
  await page.goto('/orders')
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('暂时无法确认')
  await expect(dialog.getByRole('link', { name: '打开支付' })).toHaveCount(0)
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, base))
  await dialog.getByRole('button', { name: '重试', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: '打开支付' })).toBeVisible()
})

test('cancellation that finds a completed payment refreshes the wallet', async ({ page }) => {
  let walletRequests = 0
  await page.route('**/api/v1/me/wallet', route => { walletRequests++; return fulfillJson(route, { availableCents: 1200 }) })
  await page.route('**/api/v1/orders/order-a/close', route => fulfillJson(route, { ...base, status: 'completed', completedAt: '2026-08-11T04:00:00Z' }))
  await page.goto('/orders')
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '取消订单', exact: true }).click()
  const before = walletRequests
  await dialog.getByRole('button', { name: '确认取消', exact: true }).click()
  await expect(dialog).toContainText('已入账')
  await expect.poll(() => walletRequests).toBeGreaterThan(before)
  await expect(dialog.getByRole('link', { name: '打开支付' })).toHaveCount(0)
})

test('failed pagination keeps current page and can retry', async ({ page }) => {
  let failNext = true
  await page.route('**/api/v1/orders?*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    if (cursor && failNext) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: '分页暂不可用' }) })
    return fulfillJson(route, { items: cursor ? [{ ...base, id: 'page-two' }] : [base], nextCursor: cursor ? null : 'next-page', summary })
  })
  await page.goto('/orders')
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByRole('alert')).toContainText('分页暂不可用')
  await expect(page.locator('.orders-pager')).toContainText('第 1 页')
  failNext = false
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.locator('.orders-pager')).toContainText('第 2 页')
})

test('unpaid and failed orders never claim payment or invent subscription expiry', async ({ page }) => {
  const failed = { ...base, status: 'failed', planKind: 'subscription', durationDays: 30, dailyGrantCents: 150 }
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [failed], summary }))
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, failed))
  await page.goto('/orders')
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.order-sheet__amount > span')).toHaveText('订单金额')
  await expect(dialog).not.toContainText('预计到期')
  await expect(dialog).not.toContainText('订阅已开通')
  await expect(dialog.getByRole('link', { name: '重新选择套餐' })).toBeVisible()
})

test('minimum desktop layout and keyboard copying remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true }))
  await page.goto('/orders')
  await expect(page.locator('.orders-row')).toHaveCount(1)
  await page.locator('.orders-row__id').press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.orders-row__id')).toContainText('已复制')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  const input = await page.getByRole('searchbox', { name: '搜索订单' }).boundingBox()
  expect(input.width).toBeGreaterThan(100)
  await page.locator('.orders-row').press('Enter')
  await expect(page.getByRole('dialog').getByRole('link', { name: '打开支付' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.orders-row')).toBeFocused()
})

test('checkout keeps QR payment and cancellation without an external payment button', async ({ page }) => {
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [{ id: 'plan-a', name: '基础创作包', kind: 'topup', priceCents: 990, grantCents: 1000 }], paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.route('**/api/v1/orders', route => fulfillJson(route, base))
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await page.locator('.pp-checkout-backdrop').click({ position: { x: 8, y: 200 } })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  await page.locator('.pp-checkout-backdrop').click({ position: { x: 8, y: 200 } })
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  await expect(dialog.getByRole('link', { name: /打开/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: '取消订单', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '确认取消', exact: true })).toBeVisible()
  await page.locator('.pp-checkout-backdrop').click({ position: { x: 8, y: 200 } })
  await expect(dialog.getByRole('button', { name: '确认取消', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('checkout continues confirming paid orders without showing another payment QR', async ({ page }) => {
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [{ id: 'plan-a', name: '基础创作包', kind: 'topup', priceCents: 990, grantCents: 1000 }], paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.route('**/api/v1/orders', route => fulfillJson(route, { ...base, status: 'paid' }))
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, { ...base, status: 'completed', completedAt: '2026-08-11T04:00:00Z' }))
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('已收到付款')
  await expect(dialog.locator('.pp-checkout__qr')).toHaveCount(0)
  await expect(dialog).toContainText('支付成功，积分已到账')
})

test('cancelled and expired orders have distinct labels and filters', async ({ page }) => {
  const cancelled = { ...base, id: 'cancelled-order', status: 'cancelled' }
  const expired = { ...base, id: 'expired-order', status: 'expired' }
  await page.route('**/api/v1/orders?*', route => {
    const status = new URL(route.request().url()).searchParams.get('status')
    return fulfillJson(route, { items: [cancelled, expired].filter(order => !status || order.status === status), summary: { total: 2, cancelled: 1, expired: 1 } })
  })
  await page.route('**/api/v1/orders/cancelled-order', route => fulfillJson(route, cancelled))
  await page.goto('/orders')
  await expect(page.locator('.orders-row').filter({ hasText: '已取消' })).toHaveCount(1)
  await expect(page.locator('.orders-row').filter({ hasText: '已过期' })).toHaveCount(1)
  await page.getByRole('navigation', { name: '订单筛选' }).getByRole('button', { name: '已取消', exact: true }).click()
  await expect(page.locator('.orders-row')).toHaveCount(1)
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('已取消')
  await expect(dialog.getByRole('button', { name: '取消订单', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: '打开支付' })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: '重新选择套餐' })).toBeVisible()
})

test('checkout shows a persisted cancellation without confusing it with expiry', async ({ page }) => {
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [{ id: 'plan-a', name: '基础创作包', kind: 'topup', priceCents: 990, grantCents: 1000 }], paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.route('**/api/v1/orders', route => fulfillJson(route, { ...base, status: 'cancelled' }))
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
  await expect(dialog).toContainText('支付订单已取消')
  await expect(dialog).not.toContainText('支付订单已过期')
  await expect(dialog.locator('.pp-checkout__qr')).toHaveCount(0)
})

test('uncertain orders cannot be paid or cancelled and can recover on refresh', async ({ page }) => {
  const uncertain = { ...base, status: 'uncertain' }
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [uncertain], summary: { ...summary, uncertain: 1 } }))
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, uncertain))
  await page.goto('/orders')
  await expect(page.getByText('1 笔订单正在核实支付结果，请勿重复下单。')).toBeVisible()
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('支付渠道结果正在核实')
  await expect(dialog.getByRole('link', { name: '打开支付' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '取消订单', exact: true })).toHaveCount(0)
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, { ...base, status: 'completed', completedAt: '2026-08-11T04:00:00Z' }))
  await dialog.getByRole('button', { name: '刷新订单状态' }).click()
  await expect(dialog).toContainText('已入账')
})

test('queued subscription period displays its future activation without claiming it is active', async ({ page }) => {
  const queued = { ...base, status: 'completed', planKind: 'subscription', dailyGrantCents: 900, durationDays: 30,
    subscriptionStartsAt: '2026-09-01T02:00:00Z', subscriptionEndsAt: '2026-10-01T02:00:00Z' }
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [queued], summary }))
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, queued))
  await page.goto('/orders')
  await page.locator('.orders-row').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('订阅订单已完成')
  await expect(dialog).not.toContainText('续订已确认')
  await expect(dialog).toContainText('本次权益生效')
  await expect(dialog).not.toContainText('订阅已开通')
})

for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
  test(`completed receipt is isolated and scrolls internally in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.addInitScript(theme => { localStorage.setItem('starclouds-appearance', theme); localStorage.setItem('walleven-color-scheme', theme) }, theme)
    await page.setViewportSize({ width, height: 720 })
    const completed = { ...base, status: 'completed', planKind: 'subscription', planName: '三日进阶订阅测试', amountCents: 3990, payAmountCents: 3990, dailyGrantCents: 300, durationDays: 3, subscriptionStartsAt: '2026-09-13T15:24:00Z', subscriptionEndsAt: '2026-09-16T15:24:00Z', paidAt: '2026-09-07T15:24:00Z', completedAt: '2026-09-07T15:24:00Z', providerOrderId: 'provider-long-reference-1234567890' }
    await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [completed], summary }))
    await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, completed))
    await page.goto('/orders')
    await page.locator('.orders-row').click()
    const dialog = page.getByRole('dialog')
    await expect(page.locator('body > .order-dialog')).toBeVisible()
    await expect(dialog).toHaveCSS('background-color', theme === 'dark' ? 'rgb(35, 36, 41)' : 'rgb(255, 255, 255)')
    await expect(dialog.getByRole('heading', { name: '套餐权益' })).toBeVisible()
    await expect(dialog.getByRole('link', { name: '查看我的订阅' })).toBeVisible()
    await expect(dialog).not.toContainText('续订已确认')
    await expect(dialog).not.toContainText('支付截止')
    const benefits = await dialog.locator('.order-sheet__benefits').boundingBox()
    const payment = await dialog.locator('.order-sheet__payment').boundingBox()
    if (width > 640) {
      expect(payment.x).toBeGreaterThan(benefits.x + benefits.width)
      expect(Math.abs(payment.y - benefits.y)).toBeLessThan(1)
      expect(await dialog.locator('.order-dialog__body').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    } else {
      expect(payment.y).toBeGreaterThanOrEqual(benefits.y + benefits.height)
    }
    const before = await dialog.locator('header').boundingBox()
    await dialog.locator('.order-dialog__body').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(dialog.getByRole('heading', { name: '时间记录' })).toBeVisible()
    const after = await dialog.locator('header').boundingBox()
    expect(after.y).toBe(before.y)
    const bounds = await dialog.boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(721)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 10, r.y + 10)) })).toBe(true)
    await page.screenshot({ path: info.outputPath(`order-receipt-${theme}-${width}.png`) })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
}

test('uncertain checkout keeps polling without exposing repeat payment actions', async ({ page }) => {
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: [] }))
  let creates = 0
  let polls = 0
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [{ id: 'plan-a', name: '基础创作包', kind: 'topup', priceCents: 990, grantCents: 1000 }], paymentEnabled: true, paymentMethods: ['alipay'] }))
  await page.route('**/api/v1/orders', route => { creates++; return fulfillJson(route, { ...base, status: 'uncertain', payUrl: null }, 202) })
  await page.route('**/api/v1/orders/order-a', route => { polls++; return fulfillJson(route, { ...base, status: 'uncertain', payUrl: null }) })
  await page.goto('/pricing')
  await page.getByRole('button', { name: '选择此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '使用支付宝支付', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('正在核实支付渠道结果')
  await expect(dialog.locator('.pp-checkout__qr, .pp-checkout__submit')).toHaveCount(0)
  await expect.poll(() => polls).toBeGreaterThan(1)
  expect(creates).toBe(1)
  await page.route('**/api/v1/orders/order-a', route => fulfillJson(route, { ...base, status: 'completed' }))
  await expect(dialog).toContainText('支付成功，积分已到账')
})
