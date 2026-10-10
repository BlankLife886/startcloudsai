import { test, expect } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { fulfillJson } from './helpers/authMocks.js'

test.beforeEach(async ({ page }) => {
  await installVisualBaseline(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'billing-user', username: '账务测试用户' } }))
})

test('refund progress never renders internal audit text or operator IDs', async ({ page }) => {
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, {
    items: [{ id: 'sub', planId: 'plan', planName: '三日订阅', status: 'refunding', billingVersion: 2, availablePoints: 0, frozenPoints: 100, spentPoints: 0, issuedPoints: 100, policy: { channels: ['web'] } }],
    changes: [{ id: 'refund', subscriptionId: 'sub', kind: 'refund', status: 'processing', amountCents: 1990, createdAt: '2026-08-11T04:00:00Z', reviewNote: 'INTERNAL-ONLY admin=secret-operator 调试审核记录', publicMessage: '审核已通过，核定退款 ¥19.90，正在办理退款。订阅积分暂时冻结，通用积分不受影响。' }],
  }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/subscriptions/sub/grants?*', route => fulfillJson(route, { items: [], total: 0 }))
  await page.goto('/subscriptions?subscription=sub&view=changes')
  const table = page.locator('.subscription-changes-table')
  await expect(table).toContainText('退款处理中')
  await expect(table).toContainText('通用积分不受影响')
  await expect(table).not.toContainText('INTERNAL-ONLY')
  await expect(table).not.toContainText('admin=')
  await expect(table.locator('.subscription-change-money')).toHaveCSS('white-space', 'nowrap')
})

test('wallet distinguishes refund holds from AI task spending', async ({ page }) => {
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { balanceCents: 3800, frozenCents: 100, normalBalanceCents: 3800, subscriptionBalanceCents: 0, subscriptionFrozenCents: 100, refundHeldCents: 100, taskFrozenCents: 0 }))
  await page.route('**/api/v1/me/wallet/entries?*', route => fulfillJson(route, { items: [{ id: 'hold', kind: 'freeze', sourceType: 'subscription_refund_hold', sourceId: 'refund', deltaCents: -100, balanceAfterCents: 3800, reason: '订阅退订审核：approve', createdAt: '2026-08-11T04:00:00Z' }], total: 1, page: 1 }))
  await page.goto('/wallet')
  await expect(page.getByText('订阅退订', { exact: true })).toBeVisible()
  await expect(page.getByText('退订冻结', { exact: true })).toBeVisible()
  await expect(page.getByText(/不是AI任务扣费/)).toBeVisible()
  await expect(page.getByText(/提交时预扣/)).toHaveCount(0)
  await expect(page.getByText('无任务冻结', { exact: true })).toBeVisible()
})

test('ended subscription does not advertise remaining active days', async ({ page }) => {
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, { items: [{ id: 'ended', planName: '三日订阅', status: 'cancelled', billingVersion: 2, startsAt: '2026-08-11T04:00:00Z', endsAt: '2026-08-14T04:00:00Z', nextGrantAt: '2026-08-12T04:00:00Z', canChange: true, availablePoints: 0, dailyPoints: 300, issuedPoints: 300, revokedPoints: 260, frozenPoints: 0, grantedCycles: 1, totalCycles: 3, spentPoints: 40, policy: {} }], changes: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/subscriptions/ended/grants?*', route => fulfillJson(route, { items: [], total: 0 }))
  await page.goto('/subscriptions')
  const overview = page.getByRole('complementary', { name: '订阅概览' })
  await expect(overview).toContainText('原有效期')
  await expect(overview).toContainText('已退订，后续发放已停止')
  await expect(overview).not.toContainText('剩余 3 天')
  await expect(overview).toContainText('历史累计使用')
  await expect(overview).toContainText('历史累计 40 积分')
  await expect(overview.locator('.subscription-spotlight')).toContainText('订阅状态')
  await expect(overview.locator('.subscription-countdown')).toHaveText('已退订')
  await expect(overview).not.toContainText('下一次发放')
  await expect(overview).not.toContainText('每24小时发放')
  await expect(overview).not.toContainText('冻结中')
  await expect(overview).toContainText('原周期额度')
  await expect(overview.locator('.subscription-metrics > div').filter({ hasText: '退订已回收' })).toContainText('260')
  await expect(overview.getByRole('button', { name: '升级订阅', exact: true })).toHaveCount(0)
})

test('returning to a subscription tab refreshes its cancellation status', async ({ page }) => {
  let cancelled = false
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, {
    items: [{ id: 'live', planName: '三日订阅', status: cancelled ? 'cancelled' : 'active', billingVersion: 2, startsAt: '2026-08-11T04:00:00Z', endsAt: '2026-08-14T04:00:00Z', nextGrantAt: cancelled ? null : '2026-08-12T04:00:00Z', availablePoints: cancelled ? 0 : 100, revokedPoints: cancelled ? 100 : 0, policy: {} }], changes: [],
  }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/subscriptions/live/grants?*', route => fulfillJson(route, { items: [], total: 0 }))
  await page.goto('/subscriptions')
  const overview = page.getByRole('complementary', { name: '订阅概览' })
  await expect(overview).toContainText('下一次重置')
  cancelled = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(overview.locator('.subscription-countdown')).toHaveText('已退订')
  await expect(overview).toContainText('退订已回收')
})

test('wallet labels upgrade holds separately from refund holds and task spending', async ({ page }) => {
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { balanceCents: 3800, frozenCents: 100, normalBalanceCents: 3800, normalFrozenCents: 0, subscriptionBalanceCents: 0, subscriptionFrozenCents: 100, upgradeHeldCents: 100, refundHeldCents: 0, taskFrozenCents: 0 }))
  await page.route('**/api/v1/me/wallet/entries?*', route => fulfillJson(route, { items: [{ id: 'upgrade-hold', kind: 'freeze', sourceType: 'subscription_upgrade_exchange', sourceId: 'upgrade', deltaCents: -100, balanceAfterCents: 3800, reason: '升级整期置换待支付，锁定旧订阅积分', createdAt: '2026-08-11T04:00:00Z' }], total: 1, page: 1 }))
  await page.goto('/wallet')
  await expect(page.getByText('订阅升级置换', { exact: true })).toBeVisible()
  await expect(page.getByText('升级锁定', { exact: true })).toBeVisible()
  await expect(page.getByText('无任务冻结', { exact: true })).toBeVisible()
  await expect(page.getByText('退订冻结', { exact: true })).toHaveCount(0)
})

test('subscription shows current-cycle quota and expiry separately from historical grants', async ({ page }) => {
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, { items: [{ id: 'reset', planName: '每日100积分', status: 'active', billingVersion: 2, startsAt: '2026-08-10T04:00:00Z', endsAt: '2026-08-13T04:00:00Z', nextGrantAt: '2026-08-12T04:00:00Z', availablePoints: 100, issuedPoints: 200, expiredPoints: 80, spentPoints: 20, dailyPoints: 100, grantedCycles: 2, totalCycles: 3, policy: {} }], changes: [] }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/me/subscriptions/reset/grants?*', route => fulfillJson(route, { items: [], total: 0 }))
  await page.goto('/subscriptions')
  const overview = page.getByRole('complementary', { name: '订阅概览' })
  await expect(overview).toContainText('本期可用额度')
  await expect(overview).toContainText('到期重置，不累计')
  await expect(overview).toContainText('历史发放合计')
  await expect(overview).toContainText('历史周期已失效 80 积分')
  await expect(overview.locator('.subscription-hero__amount strong')).toHaveText('100')
})

test('cycle expiry is not displayed as task consumption', async ({ page }) => {
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { balanceCents: 3900, frozenCents: 0, normalBalanceCents: 3800, subscriptionBalanceCents: 100, taskFrozenCents: 0 }))
  await page.route('**/api/v1/me/wallet/entries?*', route => fulfillJson(route, { items: [{ id: 'expiry', kind: 'spend', sourceType: 'subscription_cycle_expiry', deltaCents: -80, balanceAfterCents: 3800, reason: '上一周期80积分已到期，不计为创作消费', createdAt: '2026-08-11T04:00:00Z' }], total: 1, page: 1 }))
  await page.goto('/wallet')
  await expect(page.getByText('订阅额度到期', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '账本明细' }).getByText('周期到期', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '消费', exact: true })).toBeVisible()
})

for (const [theme, width] of [['light', 1440], ['dark', 390]]) {
  test(`wallet summary separates settlement and reclaim data in ${theme} at ${width}`, async ({ page }, info) => {
    await page.addInitScript(theme => { localStorage.setItem('starclouds-appearance', theme); localStorage.setItem('walleven-color-scheme', theme) }, theme)
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { balanceCents: 300, frozenCents: 0, normalBalanceCents: 0, subscriptionBalanceCents: 300 }))
    await page.route('**/api/v1/me/wallet/entries?*', route => fulfillJson(route, { items: [{ id: 'spent', kind: 'spend', deltaCents: 0, settledPoints: 419, sourceType: 'sandbox_subscription_usage', reason: '测试模拟使用订阅积分', createdAt: '2026-08-11T04:00:00Z' }], total: 1, page: 1 }))
    await page.route('**/api/v1/me/wallet/summary', route => fulfillJson(route, {
      incomeCents: 1700, incomeCount: 9, consumedCents: 419, consumedCount: 4, refundCents: 0, refundCount: 0, expiredPoints: 881, upgradeReclaimedPoints: 100, refundReclaimedPoints: 0,
      items: [{ id: 'subscription_cycle', label: '订阅额度发放', hint: '历史周期发放合计', cents: 1700, count: 9 }, { id: 'daily_checkin', label: '签到积分', hint: '签到到账', cents: 0, count: 0 }],
    }))
    await page.goto('/wallet')
    const summary = page.getByRole('region', { name: '账单汇总' })
    await summary.scrollIntoViewIfNeeded()
    await expect(summary).toContainText('已结算扣减')
    await expect(summary.locator('.is-spend strong')).toHaveText('419')
    await expect(summary.locator('.is-income strong')).toHaveText('1,700')
    await expect(summary.locator('.wallet-summary__adjustments')).toContainText('881 积分')
    await expect(summary.locator('li')).toHaveCount(2)
    await expect(summary.locator('.wallet-summary__sources.is-recorded')).toContainText('订阅额度发放')
    await expect(summary.locator('.wallet-summary__sources.is-empty')).toContainText('签到积分')
    const sections = await summary.evaluate(el => ['header', '.wallet-summary__totals', '.wallet-summary__sources-title', 'ul', '.wallet-summary__adjustments'].map(selector => { const r = el.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }))
    for (let i = 1; i < sections.length; i++) expect(sections[i].top).toBeGreaterThanOrEqual(sections[i - 1].bottom)
    expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`wallet-summary-${theme}-${width}.png`) })
    await expect(summary.getByRole('button', { name: /展开其他来源|收起其他来源/ })).toHaveCount(0)
    await expect(summary.getByText('签到积分',{exact:true})).toBeVisible()
    await expect(page.getByRole('region', { name: '账本明细' })).toContainText('结算 419 积分')
  })
}

test('wallet summary shows every source and keeps clickable common sources first', async ({ page }) => {
  await page.route('**/api/v1/me/wallet', route => fulfillJson(route, { balanceCents: 300 }))
  await page.route('**/api/v1/me/wallet/entries?*', route => fulfillJson(route, { items: [], total: 0, page: 1 }))
  await page.route('**/api/v1/me/wallet/summary', route => fulfillJson(route, { incomeCents: 12309, incomeCount: 14, items: [
    { id: 'admin', label: '人工调整', cents: 10000, count: 1 },
    { id: 'signup_bonus', label: '注册赠送', cents: 500, count: 1 },
    { id: 'subscription_cycle', label: '订阅额度发放', cents: 1700, count: 9 },
    { id: 'order', label: '套餐入账', cents: 99, count: 1 },
    { id: 'daily_checkin', label: '签到积分', cents: 10, count: 2 },
    { id: 'other', label: '其他入账', cents: 0, count: 0 },
  ] }))
  await page.goto('/wallet')
  const summary = page.getByRole('region', { name: '账单汇总' })
  await expect(summary.locator('li')).toHaveCount(6)
  await expect(summary.locator('li').first()).toContainText('套餐入账')
  await expect(summary.locator('li').nth(1)).toContainText('订阅额度发放')
  await expect(summary.getByText('注册赠送', { exact: true })).toBeVisible()
  await expect(summary.getByRole('button', { name: /展开其他来源|收起其他来源/ })).toHaveCount(0)
  const clickable = await summary.locator('li').evaluateAll(items => items.map(item => Boolean(item.querySelector('a'))))
  const firstStatic = clickable.indexOf(false)
  expect(clickable.slice(firstStatic).every(value => !value)).toBe(true)
})

for(const width of [1440,390,320]) {
  test(`all thirteen wallet sources remain readable in a compact grid at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900})
    const items=Array.from({length:13},(_,i)=>({id:i===0?'subscription_cycle':`source-${i}`,label:i===0?'订阅额度发放':`其他来源 ${i}`,cents:i===0?1000000000:0,count:i===0?10000:0}))
    await page.route('**/api/v1/me/wallet',route=>fulfillJson(route,{balanceCents:500,subscriptionBalanceCents:500}))
    await page.route('**/api/v1/me/wallet/entries?*',route=>fulfillJson(route,{items:[],total:0,page:1}))
    await page.route('**/api/v1/me/wallet/summary',route=>fulfillJson(route,{incomeCents:1000000000,incomeCount:10000,consumedCents:0,consumedCount:0,items}))
    await page.goto('/wallet')
    const summary=page.getByRole('region',{name:'账单汇总'})
    await expect(summary.locator('li')).toHaveCount(13)
    await expect(summary.getByRole('button',{name:/展开|收起/})).toHaveCount(0)
    await expect(summary.getByText('其他来源 12',{exact:true})).toBeVisible()
    await expect(summary.locator('.wallet-summary__source-value').last()).toContainText('0')
    const layout=await summary.locator('#wallet-income-sources').evaluate(el=>({height:el.getBoundingClientRect().height,columns:getComputedStyle(el.querySelector('.is-empty ul')).gridTemplateColumns.split(' ').length,overflow:[...el.querySelectorAll('.wallet-summary__row')].some(row=>row.scrollWidth>row.clientWidth+1)}))
    expect(layout.columns).toBe(2)
    await expect(summary.locator('.wallet-summary__sources.is-recorded li')).toHaveCount(1)
    await expect(summary.locator('.wallet-summary__sources.is-empty li')).toHaveCount(12)
    expect(layout.height).toBeLessThan(420)
    expect(layout.overflow).toBe(false)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await summary.scrollIntoViewIfNeeded()
    await page.screenshot({path:info.outputPath(`wallet-all-sources-${width}.png`)})
  })
}
