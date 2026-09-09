import { expect, test } from '@playwright/test'
import { installVisualBaseline } from './helpers/visualBaseline.js'
import { fulfillJson } from './helpers/authMocks.js'

const policy = { version: 2, series: 'creative', tier: 1, channels: ['web', 'api'], featureKeys: ['text_to_image'], modelIds: [] }
const sub = { id: 'sub-one', planId: 'base', planName: '创作订阅', status: 'active', billingVersion: 2, canChange: true, startsAt: '2026-08-11T02:30:00Z', endsAt: '2026-08-14T02:30:00Z', nextGrantAt: '2026-08-12T02:30:00Z', dailyPoints: 100, issuedPoints: 100, availablePoints: 100, frozenPoints: 0, spentPoints: 0, grantedCycles: 1, totalCycles: 3, policy }
const target = { id: 'pro', name: '进阶订阅', kind: 'subscription', priceCents: 6000, durationDays: 3, dailyGrantCents: 200, subscriptionPolicy: { ...policy, tier: 2 } }

async function setup(page, theme = 'light') {
  await installVisualBaseline(page)
  await page.addInitScript(theme => {
    localStorage.setItem('walleven-color-scheme', theme)
    localStorage.setItem('starclouds-appearance', theme)
    document.documentElement?.classList.toggle('color-scheme-dark', theme === 'dark')
  }, theme)
  await page.route('**/api/v1/auth/session', route => fulfillJson(route, { user: { id: 'sub-user', email: 'sub@example.com' } }))
  const state = { subscription:sub, changes: [], refundRequests: 0, orderRequests: 0, quoteRequests: 0, cancelRequests: 0, orderStatus: 'pending', hasUpgradeOrder: false, paymentMethods: ['alipay'], method: 'alipay' }
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, { items: [state.subscription], changes: state.changes, serverTime: '2026-08-11T04:00:00Z' }))
  await page.route('**/api/v1/me/subscription', route => fulfillJson(route, { active: true, blockingPurchase: true, id: state.subscription.id, planId: state.subscription.planId, planName: state.subscription.planName }))
  await page.route('**/api/v1/me/subscriptions/sub-one/grants?*', route => fulfillJson(route, { items: [{ id: 'grant-one', kind: 'cycle', scheduledAt: sub.startsAt, grantedAt: sub.startsAt, points: 100 }], total: 1, page: 1 }))
  await page.route('**/api/v1/plans', route => fulfillJson(route, { items: [{ id: 'pack', name: '额度包', kind: 'topup', priceCents: 990, grantCents: 1000 }, { ...target, id: 'base', name: '创作订阅', subscriptionPolicy: policy }, target], paymentEnabled: true, paymentMethods: state.paymentMethods }))
  const quote = { id: 'upgrade-quote', kind: 'upgrade', status: 'quoted', targetPlanId: target.id, amountCents: 1990, expiresAt: '2026-08-11T04:10:00Z', snapshot: { upgradeMode: 'restart', upgradeCredit: { creditCents: 4010, timeValueCents: 4010, unusedValueCents: 5000, reclaimPoints: 100 }, priceCents: 6000, durationDays: 3, planName: target.name, dailyPoints: 200, endsAt: sub.endsAt } }
  state.quote = quote
  const order = () => ({ id: 'upgrade-order', planId: 'pro', subscriptionChangeId: quote.id, status: state.orderStatus, paymentMethod: state.method, amountCents: 1990, payUrl: 'https://example.com/qr', expiresAt: '2026-08-11T04:10:00Z' })
  await page.route('**/api/v1/me/subscriptions/sub-one/upgrade-quote', route => { state.quoteRequests++; expect(route.request().postDataJSON().planId).toBe('pro'); return fulfillJson(route, quote) })
  await page.route('**/api/v1/me/subscription-changes/upgrade-quote', route => fulfillJson(route, quote))
  await page.route('**/api/v1/me/subscriptions/sub-one/refund-preview', route => fulfillJson(route, { estimatedAmountCents: 3000, requiresReview: true }))
  await page.route('**/api/v1/me/subscriptions/sub-one/refund', route => { state.refundRequests++; state.changes = [{ id: 'refund-one', subscriptionId: sub.id, kind: 'refund', status: 'reviewing', amountCents: 3000, reason: '购买错误申请退款', createdAt: sub.startsAt }]; return fulfillJson(route, state.changes[0]) })
  await page.route('**/api/v1/orders?*', route => { const status = new URL(route.request().url()).searchParams.get('status'); return fulfillJson(route, { items: state.hasUpgradeOrder && (!status || status === state.orderStatus) ? [order()] : [] }) })
  await page.route('**/api/v1/orders/upgrade-order', route => fulfillJson(route, order()))
  await page.route('**/api/v1/orders/upgrade-order/close', route => { state.cancelRequests++; state.orderStatus = 'cancelled'; quote.status = 'cancelled'; return fulfillJson(route, order()) })
  await page.route('**/api/v1/orders', route => { state.orderRequests++; state.hasUpgradeOrder = true; state.method = route.request().postDataJSON().paymentMethod; quote.status = 'pending'; expect(route.request().postDataJSON().upgradeQuoteId).toBe('upgrade-quote'); return fulfillJson(route, order()) })
  return state
}

for (const theme of ['light', 'dark']) {
  test(`subscription center groups periods and grants in ${theme}`, async ({ page }, info) => {
    await setup(page, theme)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/subscriptions')
    await expect(page.getByRole('heading', { name: '我的订阅', exact: true })).toBeVisible()
    await expect(page.locator('.subscription-hero img')).toHaveAttribute('src', '/pricing/my-subscription-v2.webp')
    await expect.poll(() => page.locator('.subscription-hero img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(page.locator('.subscription-countdown')).toContainText('22:30:00')
    await expect(page.locator('.subscription-metrics')).toContainText('每天额度')
    await expect(page.locator('.subscription-scope')).toContainText('文生图')
    await expect(page.locator('tbody')).toContainText('+100 积分')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`subscriptions-${theme}.png`), fullPage: true })
  })
}

test('upgrade shows the quote and sends it through the existing QR checkout', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/subscriptions')
  await page.getByRole('button', { name: '升级订阅', exact: true }).click()
  await expect(page).toHaveURL(/\/pricing\?plan=subscription&upgradeFrom=sub-one$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const current = page.locator('.pp-plan').filter({ has: page.getByRole('heading', { name:'创作订阅',exact:true }) })
  await expect(current.getByRole('button',{name:'当前订阅',exact:true})).toBeDisabled()
  await page.getByRole('button', { name: '升级至此方案', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('¥19.90')
  await expect(page.getByRole('dialog')).toContainText('开通起完整 3 天')
  await expect(page.getByRole('dialog')).toContainText('¥40.10')
  await expect(page.getByRole('button', { name: '使用支付宝支付', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: '确认以抵扣额置换新周期，并回收旧订阅未用积分' }).check()
  await expect(page).toHaveURL(/\/pricing\?.*upgrade=upgrade-quote/)
  await expect(page.locator('#pricing-plans')).toHaveCount(1)
  expect(state.quoteRequests).toBe(1)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('订阅升级支付')
  await dialog.getByRole('button', { name: '使用支付宝支付' }).click()
  await expect(dialog.locator('.pp-checkout__amount')).toContainText('¥19.90')
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  expect(state.orderRequests).toBe(1)
  state.orderStatus = 'completed'
  state.quote.status = 'completed'
  state.subscription = {...sub,planId:target.id,planName:target.name,dailyPoints:target.dailyGrantCents,policy:target.subscriptionPolicy}
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog).toContainText('支付成功，积分已到账')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page).toHaveURL(/\/pricing\?plan=subscription&upgradeFrom=sub-one$/)
  await expect(page.locator('.pp-plan').filter({has:page.getByRole('heading',{name:target.name,exact:true})}).getByRole('button',{name:'当前订阅',exact:true})).toBeDisabled()
})

test('pending upgrade resumes and cancels inside subscription management without creating another order', async ({ page }) => {
  const state = await setup(page)
  state.quote.status = 'pending'
  state.hasUpgradeOrder = true
  await page.goto('/subscriptions?upgrade=upgrade-quote')
  const dialog = page.getByRole('dialog', { name: '订阅升级支付' })
  await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  await page.locator('.pp-checkout-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeVisible()
  expect(state.orderRequests).toBe(0)
  await dialog.getByRole('button', { name: '取消订单', exact: true }).click()
  await dialog.getByRole('button', { name: '确认取消', exact: true }).click()
  await expect(dialog).toContainText('支付订单已取消')
  await dialog.getByRole('button', { name: '返回订阅管理', exact: true }).click()
  await expect(page).toHaveURL(/\/subscriptions$/)
  expect(state.cancelRequests).toBe(1)
})

test('upgrade payment links stay on pricing without generating extra catalog cards', async ({ page }) => {
  await setup(page)
  await page.goto('/pricing?upgrade=upgrade-quote')
  await expect(page).toHaveURL(/\/pricing\?upgrade=upgrade-quote/)
  await expect(page.getByRole('dialog', { name: '订阅升级支付' })).toBeVisible()
  await expect(page.locator('#pricing-plans')).toHaveCount(1)
})

for (const [theme, width] of [['light', 1280], ['dark', 390]]) {
  test(`payment methods form a spaced capsule in ${theme} at ${width}`, async ({ page }, info) => {
    const state = await setup(page, theme)
    state.paymentMethods = ['alipay', 'wechat']
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/subscriptions?upgrade=upgrade-quote')
    const dialog = page.getByRole('dialog', { name: '订阅升级支付' })
    const group = dialog.getByRole('radiogroup', { name: '支付方式' })
    await expect(group).toBeVisible()
    await expect(dialog.locator('.pp-checkout__art')).toHaveAttribute('src', '/pricing/subscription-upgrade.webp')
    await expect(dialog.locator('.pp-checkout__art')).toHaveCSS('width', width > 520 ? '72px' : '64px')
    await expect.poll(() => dialog.locator('.pp-checkout__art').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    const notice = await dialog.locator('.pp-upgrade-consent').boundingBox()
    const box = await group.boundingBox()
    expect(notice.y - box.y - box.height).toBeCloseTo(8, 0)
    const explanation=await group.evaluate(el=>{const rect=el.previousElementSibling.getBoundingClientRect();return {y:rect.y,height:rect.height}})
    expect(box.y - explanation.y - explanation.height).toBeCloseTo(8, 0)
    const payBox = await dialog.getByRole('button', { name:'使用支付宝支付', exact:true }).boundingBox()
    expect(payBox.y - notice.y - notice.height).toBeCloseTo(8, 0)
    await expect(group).toHaveCSS('border-radius', '999px')
    await expect(dialog.locator('.pp-checkout__notice')).toHaveCSS('border-radius', '0px')
    await expect(group.getByRole('radio').first()).toHaveCSS('border-width', '0px')
    const alipay = group.getByRole('radio', { name: '支付宝', exact: true })
    const wechat = group.getByRole('radio', { name: '微信支付', exact: true })
    const thumb = group.locator('.pp-pay-methods__thumb')
    await alipay.press('ArrowRight')
    await expect(wechat).toHaveAttribute('aria-checked', 'true')
    await expect(wechat).toBeFocused()
    await expect.poll(async () => Math.abs((await thumb.boundingBox()).x - (await wechat.boundingBox()).x)).toBeLessThan(1)
    await expect(thumb).toHaveCSS('background-color', theme === 'dark' ? 'rgb(36, 70, 58)' : 'rgb(225, 244, 233)')
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(await group.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await page.screenshot({ path: info.outputPath(`payment-capsule-${theme}-${width}.png`) })
    await dialog.getByRole('checkbox', { name: '确认以抵扣额置换新周期，并回收旧订阅未用积分' }).check()
    await dialog.getByRole('button', { name: '使用微信支付' }).click()
    await expect(dialog).toContainText('微信扫码支付')
    expect(state.method).toBe('wechat')
  })
}

for (const [theme,width,height] of [['light',1280,720],['dark',390,844],['light',1280,640],['dark',390,640],['light',320,568]]) {
  test(`upgrade quote keeps payment visible without losing details at ${width}x${height}`, async ({page},info) => {
    const state=await setup(page,theme)
    state.quote.snapshot.sourcePlan={planName:'畅享 3 日订阅',priceCents:2990,dailyPoints:200,durationDays:3,policy:{channels:['web','api'],featureKeys:['text_to_image'],modelIds:[]},contract:{concurrencyBonus:4,lockModelPrices:true,allowTopupPriceLock:true}}
    state.quote.snapshot.policy={channels:['web','api'],featureKeys:[],modelIds:[]}
    state.quote.snapshot.priceCents=12990
    state.quote.snapshot.dailyPoints=500
    state.quote.snapshot.planName='专业 30 日订阅'
    state.quote.snapshot.durationDays=30
    state.quote.snapshot.contract={concurrencyBonus:8,lockModelPrices:true,allowTopupPriceLock:true}
    await page.setViewportSize({width,height})
    await page.goto('/subscriptions?upgrade=upgrade-quote')
    const dialog=page.getByRole('dialog',{name:'订阅升级支付'})
    await expect(dialog.locator('.pp-upgrade-breakdown dt')).toHaveCount(3)
    const comparison=dialog.locator('.pp-upgrade-comparison')
    await expect(comparison.getByRole('columnheader')).toHaveCount(3)
    await expect(comparison.getByRole('columnheader').nth(1)).toContainText('原套餐畅享 3 日订阅')
    await expect(comparison.getByRole('columnheader').nth(2)).toContainText('升级后套餐专业 30 日订阅')
    const price=comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'套餐价格',exact:true})})
    await expect(price.locator('.pp-upgrade-before')).toHaveText('¥29.90')
    await expect(price.locator('.pp-upgrade-after strong')).toHaveText('¥129.90')
    const daily=comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'每天额度',exact:true})})
    await expect(daily.locator('.pp-upgrade-before')).toHaveText('200 积分')
    await expect(daily.locator('strong')).toHaveText('500 积分')
    const concurrency=comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'并发',exact:true})})
    await expect(concurrency.locator('.pp-upgrade-before')).toHaveText('+4')
    await expect(concurrency.locator('strong')).toHaveText('+8')
    await expect(comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'锁价范围',exact:true})})).toContainText('不变')
    await expect(comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'适用场景',exact:true})})).toContainText('文生图')
    await expect(comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'适用场景',exact:true})})).toContainText('全部场景')
    await expect(comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'适用模型',exact:true})})).toContainText('不变')
    await expect(dialog).toContainText('原锁价不再沿用')
    await expect(dialog.locator('.pp-upgrade-credit dd')).toHaveCSS('color',theme === 'dark' ? 'rgb(123, 214, 174)' : 'rgb(35, 129, 92)')
    await expect(dialog.locator('.pp-upgrade-total dd')).toHaveCSS('font-size','18px')
    await expect(dialog.locator('.pp-upgrade-target')).toHaveText('专业 30 日订阅')
    await expect(dialog.getByRole('checkbox')).toBeVisible()
    await expect(dialog.locator('.pp-upgrade-calculation__rows')).toBeVisible()
    await expect(dialog.locator('details, summary')).toHaveCount(0)
    const separators=await dialog.locator('.pp-upgrade-comparison th, .pp-upgrade-comparison td, .pp-upgrade-breakdown, .pp-upgrade-breakdown > div, .pp-upgrade-calculation__rows > div, .pp-checkout__notice').evaluateAll(elements=>elements.filter(el=>{
      const style=getComputedStyle(el)
      return ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].some(key=>parseFloat(style[key])>0)
    }).length)
    expect(separators).toBe(0)
    await expect(dialog.locator('.pp-upgrade-breakdown')).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)')
    await expect(dialog.locator('.pp-upgrade-calculation__rows dt')).toHaveCount(4)
    await expect(dialog.locator('.pp-upgrade-calculation__rows')).toContainText('旧未用积分回收')
    for (const row of await dialog.locator('.pp-upgrade-calculation__rows > div').all()) await expect(row).toBeVisible()
    const measurements=await dialog.evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,verticalOverflow:el.scrollHeight>el.clientHeight+1}))
    const dialogBox=await dialog.boundingBox()
    expect(dialogBox.height).toBeLessThanOrEqual(height)
    expect(measurements.overflow).toBe(false)
    expect(measurements.verticalOverflow).toBe(false)
    const amounts=await dialog.locator('.pp-upgrade-breakdown > div').evaluateAll(rows=>rows.slice(0,3).map(row=>row.getBoundingClientRect().top))
    expect(Math.max(...amounts)-Math.min(...amounts)).toBeLessThan(1)
    await page.screenshot({path:info.outputPath(`compact-upgrade-${width}.png`)})
    const pay=dialog.getByRole('button',{name:'使用支付宝支付',exact:true})
    await expect(pay).toBeDisabled()
    await expect(pay).toBeInViewport({ratio:0.99})
    await expect(dialog.getByRole('checkbox')).toBeInViewport({ratio:0.99})
    const footer=dialog.locator('.pp-upgrade-payment')
    const initialFooter=await footer.boundingBox()
    const detail=dialog.getByRole('region',{name:'升级方案与抵扣明细'})
    if(width===1280 && height===720) expect(await detail.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true)
    await detail.evaluate(el=>{el.scrollTop=el.scrollHeight})
    expect(Math.abs((await footer.boundingBox()).y-initialFooter.y)).toBeLessThan(1)
    await expect(pay).toBeInViewport({ratio:0.99})
    await dialog.getByRole('checkbox').check()
    await expect(pay).toBeEnabled()
    await expect(pay).toBeInViewport({ratio:0.99})
    expect(state.orderRequests).toBe(0)
  })
}

for (const [lockModelPrices,allowTopupPriceLock,copy] of [
  [true,true,'订阅及合格额度包'],
  [true,false,'仅订阅积分'],
  [false,false,'按实时价格'],
]) {
  test(`upgrade explanation respects price protection ${lockModelPrices}/${allowTopupPriceLock}`, async ({page}) => {
    const state=await setup(page)
    state.quote.snapshot.contract={concurrencyBonus:8,lockModelPrices,allowTopupPriceLock}
    await page.goto('/subscriptions?upgrade=upgrade-quote')
    const notice=page.getByRole('dialog',{name:'订阅升级支付'}).locator('.pp-checkout__notice').last()
    const comparison=page.getByRole('dialog',{name:'订阅升级支付'}).locator('.pp-upgrade-comparison')
    await expect(comparison).toContainText('并发')
    await expect(comparison).toContainText('+8')
    await expect(comparison).toContainText(copy)
    if(lockModelPrices) await expect(notice).toContainText('原锁价不再沿用')
    else await expect(notice).not.toContainText('重新锁定')
  })
}

test('payment capsule visibly slides and reverses without shifting the layout', async ({ page }) => {
  const state = await setup(page)
  state.paymentMethods = ['alipay', 'wechat']
  await page.clock.setSystemTime(new Date('2026-08-11T12:00:00+08:00'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/subscriptions?upgrade=upgrade-quote')
  await expect(page.locator('.pp-checkout-backdrop')).toHaveAttribute('data-dialog-motion-state', 'entered')
  const group = page.getByRole('radiogroup', { name: '支付方式' })
  const thumb = group.locator('.pp-pay-methods__thumb')
  const origin = (await thumb.boundingBox()).x
  const target = (await group.getByRole('radio', { name: '微信支付' }).boundingBox()).x
  const size = await group.boundingBox()
  await thumb.evaluate(el => {
    el.samples = new Promise(resolve => el.parentElement.addEventListener('click', () => {
      const values = []
      const sample = () => { values.push(el.getBoundingClientRect().x); values.length >= 30 ? resolve(values) : requestAnimationFrame(sample) }
      requestAnimationFrame(sample)
    }, { once: true, capture: true }))
  })
  await group.getByRole('radio', { name: '微信支付' }).click()
  const positions = await thumb.evaluate(el => el.samples)
  expect(positions.some(x => x > origin + 1 && x < target - 1)).toBe(true)
  await group.getByRole('radio', { name: '支付宝', exact: true }).click()
  await expect.poll(async () => Math.abs((await thumb.boundingBox()).x - origin)).toBeLessThan(1)
  const after = await group.boundingBox()
  expect(after.width).toBe(size.width)
  expect(after.height).toBe(size.height)
})

test('a single payment method fills its capsule and respects reduced motion', async ({ page }) => {
  const state = await setup(page)
  state.paymentMethods = ['wechat']
  await page.goto('/subscriptions?upgrade=upgrade-quote')
  const group = page.getByRole('radiogroup', { name: '支付方式' })
  await expect(group.getByRole('radio')).toHaveCount(1)
  await expect(group.getByRole('radio')).toHaveAttribute('aria-checked', 'true')
  const thumb = group.locator('.pp-pay-methods__thumb')
  await expect(thumb).toHaveCSS('transition-duration', '0s')
  expect(Math.abs((await thumb.boundingBox()).width - (await group.getByRole('radio').boundingBox()).width)).toBeLessThan(1)
})

test('an upgrade order does not replace a catalog plan button with pay-the-difference', async ({ page }) => {
  const state = await setup(page)
  state.quote.status = 'pending'
  state.hasUpgradeOrder = true
  await page.goto('/pricing?plan=subscription')
  const card = page.locator('.pp-plan').filter({ has: page.getByRole('heading', { name: '进阶订阅', exact: true }) })
  await expect(card.getByRole('button', { name: '升级至此方案', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /去支付/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await card.getByRole('button', { name: '升级至此方案', exact: true }).click()
  await expect(page.locator('.pp-upgrade-context')).toContainText('已有未完成订单')
  expect(state.quoteRequests).toBe(0)
})

test('restart upgrade details fit a mobile dialog', async ({ page }, info) => {
  await setup(page, 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/subscriptions')
  await page.getByRole('button', { name: '升级订阅', exact: true }).click()
  await page.getByRole('button', { name: '升级至此方案', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('旧未用积分回收')
  await expect(dialog).toContainText('开通起完整 3 天')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await dialog.getByRole('checkbox').check()
  await expect(dialog.getByRole('button', { name: '使用支付宝支付' })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('restart-upgrade-mobile.png') })
})

test('upgraded subscription shows its source in the overview and change history', async ({ page }) => {
  await setup(page)
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, {
    items: [{ ...sub, planId: 'pro', planName: '进阶订阅' }],
    changes: [{ id: 'completed-upgrade', subscriptionId: sub.id, targetPlanId: 'pro', kind: 'upgrade', status: 'completed', amountCents: 1990, snapshot: { planName: '进阶订阅', dailyPoints: 200, durationDays: 3, sourcePlan: { planId: 'base', planName: '创作订阅', dailyPoints: 100, durationDays: 3 } }, publicMessage: '新周期已经开始。' }],
  }))
  await page.goto('/subscriptions')
  await expect(page.getByRole('complementary', { name: '订阅概览' })).toContainText('升级来源：创作订阅')
  await page.getByRole('button', { name: '查看升级记录', exact: true }).click()
  await expect(page.locator('.subscription-change-route')).toContainText('从「创作订阅」升级至「进阶订阅」')
  await expect(page.locator('.subscription-change-route')).toContainText('原每天 100 积分')
})

test('missing historical upgrade source is not inferred from the current plan', async ({ page }) => {
  await setup(page)
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, {
    items: [sub], changes: [{ id: 'old-upgrade', subscriptionId: sub.id, kind: 'upgrade', status: 'completed', amountCents: 1990, snapshot: { planName: '历史目标套餐' } }],
  }))
  await page.goto('/subscriptions?view=changes')
  await expect(page.locator('.subscription-change-route')).toContainText('原套餐信息未记录')
  await expect(page.locator('.subscription-change-route')).not.toContainText('创作订阅')
})

test('refund request shows an estimate and remains under review rather than pretending refunded', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/subscriptions')
  await page.getByRole('button', { name: '申请退订', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('预计退款上限')
  await expect(dialog).toContainText('¥30.00')
  await expect(dialog).toContainText('提交申请后立即冻结订阅积分')
  await dialog.getByRole('textbox', { name: '退订原因' }).fill('购买错误申请退款')
  await dialog.getByRole('button', { name: '提交退款审核' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('tbody')).toContainText('审核中')
  await expect(page.locator('tbody')).toContainText('订阅积分已冻结')
  await expect(page.locator('tbody')).not.toContainText('已退款')
  expect(state.refundRequests).toBe(1)
})

test('used subscription credits disable refunds but still allow upgrades', async ({ page }) => {
  const state = await setup(page)
  await page.route('**/api/v1/me/subscriptions', route => fulfillJson(route, {
    items: [{ ...sub, spentPoints: 1, availablePoints: 99 }], changes: [], serverTime: '2026-08-11T04:00:00Z',
  }))
  await page.goto('/subscriptions')
  await expect(page.getByRole('button', { name: '已使用积分，退款需人工处理' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '升级订阅', exact: true })).toBeEnabled()
  expect(state.refundRequests).toBe(0)
})

for(const [currentUsed,priorUsed,expected] of [
  [0,19,'升级前已使用积分，退款需人工处理'],
  [3,19,'已使用积分，退款需人工处理'],
]) {
  test(`subscription usage separates current ${currentUsed} from historical ${priorUsed}`,async({page})=>{
    const state=await setup(page)
    await page.setViewportSize({width:390,height:844})
    await page.route('**/api/v1/me/subscriptions',route=>fulfillJson(route,{items:[{...sub,hasPriorTerm:true,currentTermSpentPoints:currentUsed,priorTermSpentPoints:priorUsed,spentPoints:currentUsed+priorUsed}],changes:[],serverTime:'2026-08-11T04:00:00Z'}))
    await page.goto('/subscriptions')
    const metric=page.locator('.subscription-metrics > div').filter({has:page.getByText('本次升级后使用',{exact:true})})
    await expect(metric.locator('dd')).toHaveText(String(currentUsed))
    await expect(metric).toContainText(`升级前使用 ${priorUsed} 积分`)
    await expect(metric).toContainText(`历史累计 ${currentUsed+priorUsed} 积分`)
    await expect(page.getByRole('button',{name:expected,exact:true})).toBeDisabled()
    expect(state.refundRequests).toBe(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  })
}

test('missing usage attribution is not presented as zero use after an upgrade',async({page})=>{
  await setup(page)
  await page.route('**/api/v1/me/subscriptions',route=>fulfillJson(route,{items:[{...sub,hasPriorTerm:true,currentTermSpentPoints:null,priorTermSpentPoints:null,spentPoints:19}],changes:[]}))
  await page.goto('/subscriptions')
  const metric=page.locator('.subscription-metrics > div').filter({has:page.getByText('历史累计使用',{exact:true})})
  await expect(metric.locator('dd')).toHaveText('19')
  await expect(metric).toContainText('周期用量未独立记录')
  await expect(page.getByText('本次升级后使用',{exact:true})).toHaveCount(0)
})

for(const [theme,width] of [['light',1280],['light',900],['dark',390]]) {
  test(`subscription rights are readable and actions stay at the card bottom at ${width}`,async({page},info)=>{
    await setup(page,theme)
    await page.setViewportSize({width,height:844})
    await page.route('**/api/v1/me/subscriptions',route=>fulfillJson(route,{
      items:[{...sub,spentPoints:19,currentTermSpentPoints:0,priorTermSpentPoints:19,hasPriorTerm:true,contract:{planRevision:2,concurrencyBonus:8,lockModelPrices:true,allowTopupPriceLock:true},policy:{...policy,modelIds:Array.from({length:8},(_,i)=>`subscription-model-${i}`)}}],
      changes:[],concurrency:{base:4,bonus:8,limit:12},serverTime:'2026-08-11T04:00:00Z',
    }))
    await page.goto('/subscriptions')
    const card=page.locator('.subscription-aside__card')
    const content=page.getByRole('region',{name:'订阅详情',exact:true})
    const rights=page.getByRole('region',{name:'订阅权益',exact:true})
    const footer=page.locator('.subscription-aside__footer')
    await expect(rights).toContainText('订阅及合格额度包')
    await expect(rights).toContainText('额外并发')
    await expect(rights).toContainText('+8')
    await expect(rights).toContainText('12 张')
    await expect(rights).toContainText('网站、API')
    await expect(rights).toContainText('文生图')
    await expect(footer.getByRole('button',{name:'升级前已使用积分，退款需人工处理',exact:true})).toBeDisabled()
    const actionTops=await footer.locator('button,a').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().top))
    expect(Math.max(...actionTops)-Math.min(...actionTops)).toBeLessThan(1)
    await expect(footer.getByRole('link',{name:'购买额度包',exact:true})).toHaveAttribute('href','/pricing?plan=topup')
    await expect(footer.getByRole('link',{name:'购买额度包',exact:true})).toBeInViewport({ratio:1})
    const before=await footer.boundingBox()
    await content.evaluate(el=>{el.scrollTop=el.scrollHeight})
    expect(await content.evaluate(el=>el.scrollTop)).toBeGreaterThan(0)
    const after=await footer.boundingBox(),frame=await card.boundingBox(),body=await content.boundingBox()
    expect(Math.abs(after.y-before.y)).toBeLessThan(1)
    expect(Math.abs(after.y+after.height-frame.y-frame.height)).toBeLessThan(2)
    expect(body.y+body.height).toBeLessThanOrEqual(after.y+1)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await expect(footer.getByRole('button',{name:'升级订阅',exact:true})).toBeEnabled()
    await page.screenshot({path:info.outputPath(`subscription-fixed-actions-${width}.png`)})
    if(width<=1080) {
      const ledger=page.getByRole('region',{name:'发放记录',exact:true}).getByRole('heading',{name:'发放记录',exact:true})
      await ledger.scrollIntoViewIfNeeded()
      await expect(ledger).toBeInViewport({ratio:1})
    }
  })
}

test('historical subscriptions switch from a compact dropdown', async ({ page }) => {
  await setup(page)
  const items = [
    sub,
    ...Array.from({ length: 45 }, (_, index) => ({
      ...sub,
      id: `old-${index}`,
      planName: `历史创作 ${index + 1}`,
      status: "expired",
      canChange: false,
      nextGrantAt: null,
    })),
  ]
  await page.route("**/api/v1/me/subscriptions", (route) =>
    fulfillJson(route, { items, changes: [], serverTime: "2026-08-11T04:00:00Z" }),
  )
  await page.route("**/api/v1/me/subscriptions/*/grants?*", (route) =>
    fulfillJson(route, { items: [], total: 0, page: 1 }),
  )
  await page.goto("/subscriptions")
  await expect(page.getByRole("heading", { name: "我的订阅", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "刷新订阅" })).toHaveCount(0)
  await page.getByRole("button", { name: "历史订阅", exact: true }).click()
  const menu = page.getByRole("listbox", { name: "历史订阅" })
  await expect(menu).toBeVisible()
  await expect(menu.locator("button")).toHaveCount(46)
  expect(await menu.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  expect(await menu.evaluate((node) => getComputedStyle(node).maxHeight !== "none")).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await menu.getByRole("option", { name: /历史创作 41/ }).click()
  await expect(page.locator(".subscription-hero__meta")).toContainText("历史创作 41")
  await expect(menu).toHaveCount(0)
})

test('active subscriber can buy packs and manage subscription from the upgrade context', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/pricing?plan=subscription')
  await expect(page.getByRole('button', { name: '当前订阅', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '额度包', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择此方案', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '订阅', exact: true }).click()
  await page.locator('.pp-upgrade-context').getByRole('link', { name: '我的订阅', exact: true }).click()
  await expect(page).toHaveURL(/\/subscriptions$/)
  expect(state.orderRequests).toBe(0)
})

test('pricing cannot mistake failed entitlement loading for permission to buy another subscription', async ({page}) => {
  const state=await setup(page)
  await page.route('**/api/v1/me/subscriptions',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'暂不可用'})}))
  await page.goto('/pricing?plan=subscription&upgradeFrom=sub-one')
  await expect(page.locator('.pp-upgrade-context')).toContainText('订阅状态读取失败')
  await expect(page.getByRole('button',{name:'升级至此方案',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'选择此方案',exact:true})).toHaveCount(0)
  expect(state.orderRequests).toBe(0)
})

for (const [theme,width] of [['light',1280],['dark',390]]) {
  test(`unavailable upgrade keeps its disabled button without a reason icon at ${width}`, async ({page}) => {
    await setup(page,theme)
    await page.setViewportSize({width,height:844})
    await page.route('**/api/v1/plans',route=>fulfillJson(route,{items:[{...target,dailyGrantCents:100,features:['每24小时重置，未用积分不结转','网站与 API 通用'],subscriptionPolicy:{...target.subscriptionPolicy,concurrencyBonus:2}}],paymentEnabled:true,paymentMethods:['alipay']}))
    await page.goto('/pricing?plan=subscription&upgradeFrom=sub-one')
    const card=page.locator('.pp-plan')
    await expect(card.locator('.pp-plan__benefits li').filter({hasText:/每日刷新|每天重置/})).toHaveCount(0)
    await expect(card.locator('.pp-plan__benefits li').filter({hasText:'网站与 API 通用'})).toHaveCount(1)
    await expect(card.locator('.pp-plan__benefits li').filter({hasText:'并发 +2'})).toHaveCount(1)
    await expect(card.locator('.pp-plan__benefits')).not.toContainText('最多同时处理')
    await expect(card.locator('.pp-plan__benefits')).not.toContainText('共享并发')
    await expect(card.locator('.pp-plan__quota > div')).toHaveText(/100\s*积分\s*\/\s*天/)
    await expect(card.locator('.pp-plan__quota small')).toHaveText('自开通时起每24小时重置')
    await expect(card.locator('.pp-plan__quota svg')).toHaveCount(0)
    await expect(card.locator('.pp-plan__quota')).toHaveCSS('flex-direction','row')
    await expect(card.locator('.pp-plan__quota small')).toHaveCSS('text-align','right')
    await expect(card.getByRole('button',{name:'暂不支持升级',exact:true})).toBeDisabled()
    await expect(card.locator('.pp-plan__go')).toHaveCount(0)
    await expect(card.getByRole('button',{name:'进阶订阅暂不支持升级的原因',exact:true})).toHaveCount(0)
    await expect(page.locator('.pp-upgrade-help-copy')).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    const button=await card.getByRole('button',{name:'暂不支持升级',exact:true}).boundingBox()
    const purchase=await card.locator('.pp-plan__purchase').boundingBox()
    expect(Math.abs(button.width-purchase.width)).toBeLessThan(1)
  })
}

test('a stale source link never silently becomes a new purchase', async ({page}) => {
  const state=await setup(page)
  await page.route('**/api/v1/me/subscription',route=>fulfillJson(route,{active:false,blockingPurchase:false}))
  await page.route('**/api/v1/me/subscriptions',route=>fulfillJson(route,{items:[{...sub,status:'cancelled',canChange:false}],changes:[]}))
  await page.goto('/pricing?plan=subscription&upgradeFrom=sub-one')
  await expect(page.getByRole('button',{name:'暂不支持升级',exact:true})).toHaveCount(2)
  expect(state.orderRequests).toBe(0)
  expect(state.quoteRequests).toBe(0)
})

test('subscription loading failure is not shown as no subscription and can retry', async ({ page }) => {
  await setup(page)
  let fail = true
  await page.route('**/api/v1/me/subscriptions', route => fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: '订阅暂时读取失败' }) })
    : fulfillJson(route, { items: [sub], changes: [], serverTime: '2026-08-11T04:00:00Z' }))
  await page.goto('/subscriptions')
  await expect(page.getByRole('alert')).toContainText('订阅暂时读取失败')
  await expect(page.getByRole('heading', { name: '暂无订阅', exact: true })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.locator('.subscription-metrics')).toContainText('每天额度')
})
