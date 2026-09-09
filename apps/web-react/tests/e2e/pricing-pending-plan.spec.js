import { expect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { fulfillJson } from './helpers/authMocks.js'

const plans = [
  { id: 'basic', name: '基础额度包', kind: 'topup', priceCents: 990, grantCents: 1200 },
  { id: 'plus', name: '进阶额度包', kind: 'topup', priceCents: 2990, grantCents: 3800 },
]
const pending = { id: 'pending-one', planId: 'basic', planName: '基础额度包', status: 'pending', amountCents: 990, payUrl: 'https://example.com/simulated-qr', paymentMethod: 'alipay', expiresAt: '2026-08-11T04:10:00Z' }

async function setup(page, initial = pending) {
  await installVisualBaseline(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'pending-user', email: 'pending@example.com' } }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: plans, paymentEnabled: true, paymentMethods: ['alipay'] }))
  const state = { order: initial, creates: 0, detailReads: 0 }
  await page.route('**/api/v1/orders?*', route => fulfillJson(route, { items: state.order?.status === new URL(route.request().url()).searchParams.get('status') ? [state.order] : [] }))
  await page.route('**/api/v1/orders/pending-one', route => { state.detailReads++; return fulfillJson(route, state.order) })
  await page.route('**/api/v1/orders/pending-one/close', route => { state.order = { ...state.order, status: 'cancelled' }; return fulfillJson(route, state.order) })
  await page.route('**/api/v1/orders', route => { state.creates++; state.order = pending; return fulfillJson(route, pending) })
  return state
}

test('plan button restores its countdown and resumes the same order without POST', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/pricing')
  const basic = page.getByRole('article').filter({ hasText: '基础额度包' })
  const button = basic.getByRole('button', { name: /去支付/ })
  await expect(button).toContainText('10:00')
  const rect = await button.boundingBox()
  await page.clock.setFixedTime(new Date('2026-08-11T04:00:01Z'))
  await expect(button).toContainText('09:59')
  expect((await button.boundingBox()).height).toBe(rect.height)
  await button.click()
  await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('radiogroup')).toHaveCount(0)
  expect(state.creates).toBe(0)
  expect(state.detailReads).toBeGreaterThan(0)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await expect(button).toContainText('09:59')
  expect(state.creates).toBe(0)
})

test('another plan still warns and cancellation restores the purchase button', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/pricing')
  await page.getByRole('article').filter({ hasText: '进阶额度包' }).getByRole('button', { name: '选择此方案' }).click()
  await expect(page.getByRole('dialog')).toContainText('你有一笔未支付订单')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button', { name: /去支付/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '取消订单', exact: true }).click()
  await dialog.getByRole('button', { name: '确认取消', exact: true }).click()
  await expect(dialog).toContainText('支付订单已取消')
  await expect(page.locator('.pc-plans__pending-hint')).toHaveCount(0)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button')).toHaveText('选择此方案')
  expect(state.creates).toBe(0)
})

test('new unpaid checkout is retained on its card after closing the dialog', async ({ page }) => {
  const state = await setup(page, null)
  await page.goto('/pricing')
  await page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '使用支付宝支付' }).click()
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button', { name: /去支付/ })).toContainText('10:00')
  await page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button', { name: /去支付/ }).click()
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  expect(state.creates).toBe(1)
})

test('elapsed countdown does not invent an expiry or create a replacement order', async ({ page }) => {
  const state = await setup(page, { ...pending, expiresAt: '2026-08-11T03:59:00Z' })
  await page.goto('/pricing')
  await page.getByRole('button', { name: '支付待确认', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('支付时间已截止')
  await expect(page.getByRole('dialog').locator('canvas')).toHaveCount(0)
  expect(state.creates).toBe(0)
})

for (const [status, label] of [['uncertain', '订单待核实'], ['paid', '到账确认中']]) {
  test(`${status} plan does not offer another payment`, async ({ page }) => {
    const state = await setup(page, { ...pending, status })
    await page.goto('/pricing')
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status')).toBeVisible()
    await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toHaveCount(0)
    expect(state.creates).toBe(0)
  })
}

test('completed payment immediately clears its card countdown', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/pricing')
  await page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button', { name: /去支付/ }).click()
  await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
  state.order = { ...pending, status: 'completed' }
  await expect(page.getByRole('dialog')).toContainText('支付成功，积分已到账')
  await expect(page.locator('.pc-plans__pending-hint')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button')).toHaveText('选择此方案')
  expect(state.creates).toBe(0)
})

for (const width of [1280, 390]) {
  test(`unpaid hint sits below the plan switch and resumes payment at ${width}`, async ({ page }) => {
    const state = await setup(page)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/pricing')
    const hint = page.locator('.pc-plans__pending-hint')
    await expect(hint).toContainText('你有 1 笔未支付订单')
    await expect(hint).toHaveCSS('font-size', '12px')
    const switchBox = await page.getByRole('group', { name: '套餐类型', exact: true }).boundingBox()
    const hintBox = await hint.boundingBox()
    const card = await page.getByRole('article').first().boundingBox()
    expect(hintBox.y).toBeGreaterThanOrEqual(switchBox.y + switchBox.height)
    expect(hintBox.y + hintBox.height).toBeLessThan(card.y)
    expect(hintBox.x).toBeGreaterThanOrEqual(0)
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(width)
    await page.getByRole('group', { name: '套餐类型', exact: true }).getByRole('button', { name: '订阅', exact: true }).click()
    await expect(hint).toBeVisible()
    await hint.getByRole('button', { name: '去支付', exact: true }).click()
    await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('radiogroup')).toHaveCount(0)
    await expect(page).toHaveURL(/\/pricing\?plan=subscription$/)
    expect(state.creates).toBe(0)
  })
}

test('no unpaid hint is shown without a pending order', async ({ page }) => {
  await setup(page, null)
  await page.goto('/pricing')
  await expect(page.getByRole('article').filter({ hasText: '基础额度包' }).getByRole('button')).toHaveText('选择此方案')
  await expect(page.locator('.pc-plans__pending-hint')).toHaveCount(0)
})
