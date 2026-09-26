import { expect, test } from '@playwright/test'
import { fulfillJson } from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL, 'Requires the isolated admin server')
const base = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:8146'
function auditFixture(section='payments',page=1) {
  const finance={total:1,confirmedOrders:1,pendingOrders:0,receivedCents:300,refundedCents:0,netCents:300,unallocatedRefundCents:0,partialRefundCents:0}
  const rows={
    payments:[{id:'paid-order',kind:'subscription',status:'completed',planName:'三日订阅',revision:1,amountCents:300,receivedCents:300,providerOrderId:'provider-paid',method:'alipay',dailyPoints:100,durationDays:3,createdAt:'2026-09-06T04:00:00Z'}],
    lots:[{id:'credit-batch',orderId:'paid-order',planName:'三日订阅',kind:'initial',granted:100,available:60,spent:40,frozen:0,held:0,expired:0,upgradeReclaimed:0,refundReclaimed:0,currentTerm:true,createdAt:'2026-09-06T04:00:00Z'}],
    usage:[{sourceType:'sandbox_subscription_usage',sourceId:'consumption-one',reason:'测试消费，余额变动0，实际结算40积分',subscriptionSpent:40,topupSpent:0,subscriptionFrozen:0,topupFrozen:0,priorSpent:0,currentSpent:40,released:0,expired:0,createdAt:'2026-09-06T05:00:00Z'}],
    changes:[{id:'prior-refund',kind:'refund',manual:true,status:'rejected',amountCents:100,planName:'三日订阅',reason:'历史退款申请',reviewNote:'已核对保留历史处理说明',createdAt:'2026-09-06T06:00:00Z'}],
    events:[{kind:'callback',action:'completed',detail:'渠道收款核验通过',actor:'支付渠道',amountCents:300,orderId:'paid-order',verified:true,createdAt:'2026-09-06T04:00:00Z'}],
  }
  return {orderId:'paid-order',asOf:'2026-09-06T07:00:00Z',user:{id:'manual-user',username:'协商客户',email:'manual@example.com'},subscription:{id:'manual-sub',planName:'三日订阅',status:'active',startsAt:'2026-09-06T04:00:00Z',endsAt:'2026-09-09T04:00:00Z'},credits:{granted:100,available:60,frozen:0,held:0,spent:40,expired:0,upgradeReclaimed:0,refundReclaimed:0,currentSpent:40,priorSpent:0},finance,accountFinance:finance,calculation:{maxRefundCents:0,timeValueCents:200,unusedValueCents:180,protectedUsagePoints:0,protectedTopupFrozenPoints:0,futurePoints:200,rule:'subscription_credits_used'},calculationError:'',records:{items:rows[section]||[],total:(rows[section]||[]).length,limit:20,page}}
}
async function mockManualLookup(page) {
  await page.route('**/api/v1/admin/orders/paid-order/subscription-refund',route=>fulfillJson(route,{orderId:'paid-order',user:{username:'协商客户',email:'manual@example.com'},subscription:{id:'manual-sub',planName:'三日订阅'},calculation:{paidCents:300,refundedCents:0,spentPoints:40,availablePoints:60,taskFrozenPoints:0,timeValueCents:200,unusedValueCents:180,maxRefundCents:0,rule:'subscription_credits_used'},maxManualAmountCents:300}))
  await page.route('**/api/v1/admin/orders/paid-order/subscription-audit?*',route=>{
    const url=new URL(route.request().url());return fulfillJson(route,auditFixture(url.searchParams.get('section'),Number(url.searchParams.get('page'))||1))
  })
}
async function setup(page, status) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/**', route => fulfillJson(route, { items: [] }))
  await page.route('**/api/v1/admin/auth/session', route => fulfillJson(route, { admin: { id: 'admin-one', username: '测试管理员', email: 'admin@example.com', role: 'admin' } }))
  const state = { status, submitted: null }
  await page.route('**/api/v1/admin/subscription-changes', route => fulfillJson(route, { items: [{ id: 'refund-one', userId: 'user-one', subscriptionId: 'sub-one', kind: 'refund', status: state.status, amountCents: 1990, reason: '买错套餐申请退订', reviewNote: '', snapshot: { planName: '三日订阅' }, createdAt: '2026-09-06T04:00:00Z' }] }))
  await page.route('**/api/v1/admin/subscription-changes/refund-one/review', route => { state.submitted = route.request().postDataJSON(); state.status = state.submitted.action === 'approve' ? 'processing' : 'completed'; return fulfillJson(route, { updated: true }) })
  await page.goto(`${base}/admin/subscription-changes`)
  return state
}
test('refund approval does not pretend that the provider has refunded', async ({ page }) => {
  const state = await setup(page, 'reviewing')
  await page.getByRole('button', { name: '通过审核', exact: true }).click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '审核退订申请' })
  await expect(dialog).toContainText('不会自动向支付渠道发起退款')
  await dialog.getByRole('textbox', { name: '内部核查说明', exact: true }).fill('已核查未使用订阅权益，批准退款')
  await dialog.getByRole('button', { name: '记录处理结果', exact: true }).click()
  await expect.poll(() => state.submitted?.action).toBe('approve')
  await expect(page.locator('.el-table').getByText('待渠道退款确认', { exact: true })).toBeVisible()
})
test('external refund confirmation requires a reference and explicit confirmation', async ({ page }) => {
  const state = await setup(page, 'processing')
  await page.getByRole('button', { name: '确认渠道退款', exact: true }).click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '确认渠道退款结果' })
  const submit = dialog.getByRole('button', { name: '记录处理结果', exact: true })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('textbox').first().fill('provider-refund-123')
  await dialog.getByRole('textbox', { name: '内部核查说明', exact: true }).fill('已核对渠道退款金额及流水号')
  await expect(submit).toBeDisabled()
  await dialog.getByText('已在支付渠道核实退款成功，金额与审核结果一致', { exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await submit.click()
  await expect.poll(() => state.submitted?.providerReference).toBe('provider-refund-123')
  expect(state.submitted.action).toBe('confirm_external_refund')
})

test('manual refund requires order lookup, an explicit amount, reason and confirmation', async ({ page }) => {
  await setup(page, 'processing')
  await mockManualLookup(page)
  let submitted
  await page.route('**/api/v1/admin/orders/paid-order/subscription-refund', route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON()
      return fulfillJson(route, { id: 'manual-refund', status: 'processing' })
    }
    return fulfillJson(route, { orderId: 'paid-order', user: { username: '协商客户', email: 'manual@example.com' }, subscription: { id: 'sub', planName: '三日订阅' }, calculation: { paidCents: 300, refundedCents: 0, spentPoints: 40, availablePoints: 60, taskFrozenPoints: 0 }, maxManualAmountCents: 300 })
  })
  await page.getByRole('button', { name: '人工例外退款', exact: true }).click()
  const dialog = page.locator('.el-dialog').filter({ hasText: '人工例外退款' })
  const submit = dialog.getByRole('button', { name: '核定退款并冻结积分' })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('textbox', { name: '平台订阅订单号' }).fill('paid-order')
  await dialog.getByRole('button', { name: '核对订单' }).click()
  await expect(dialog).toContainText('manual@example.com')
  await expect(dialog).toContainText('历史消费')
  await expect(dialog).toContainText('用户订阅账务链路')
  await expect(dialog).toContainText('资金硬上限')
  await expect(dialog).toContainText('登记不会向支付渠道发起退款')
  await dialog.getByRole('spinbutton', { name: '人工核定退款金额' }).fill('2')
  await dialog.getByRole('textbox', { name: '内部例外处理原因' }).fill('已与用户协商扣除使用部分，例外退还两元')
  await expect(submit).toBeDisabled()
  await dialog.getByText('已核对用户、订阅和退款金额，确认按人工例外处理', { exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect.poll(() => submitted).toEqual({ amountCents: 200, note: '已与用户协商扣除使用部分，例外退还两元', confirmed: true })
})

test('manual lookup exposes payments, credit batches, true consumption and handling history',async({page})=>{
  await setup(page,'processing');await mockManualLookup(page)
  await page.getByRole('button',{name:'人工例外退款',exact:true}).click()
  const dialog=page.locator('.el-dialog').filter({hasText:'人工例外退款'})
  await dialog.getByRole('textbox',{name:'平台订阅订单号'}).fill('paid-order')
  await dialog.getByRole('button',{name:'核对订单',exact:true}).click()
  await expect(dialog).toContainText('provider-paid')
  await expect(dialog.getByRole('spinbutton',{name:'人工核定退款金额'})).toHaveValue('')
  await dialog.getByRole('tab',{name:'积分批次',exact:true}).click()
  await expect(dialog).toContainText('credit-batch')
  await dialog.getByRole('tab',{name:'实际消费',exact:true}).click()
  await expect(dialog).toContainText('实际结算40积分')
  await expect(dialog).toContainText('订阅实际消费')
  await dialog.getByRole('tab',{name:'升级与退款记录',exact:true}).click()
  await expect(dialog).toContainText('历史退款申请')
  await dialog.getByRole('tab',{name:'处理日志',exact:true}).click()
  await expect(dialog).toContainText('渠道收款核验通过')
  await expect(dialog.getByRole('link',{name:'用户全部账务',exact:true})).toHaveAttribute('href',/userId=manual-user/)
})

test('incomplete audit data blocks manual submission and can be retried',async({page})=>{
  await setup(page,'processing');await mockManualLookup(page)
  let failed=true
  await page.route('**/api/v1/admin/orders/paid-order/subscription-audit?*',route=>failed?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'链路暂不可用'})}):fulfillJson(route,auditFixture()))
  await page.getByRole('button',{name:'人工例外退款',exact:true}).click()
  const dialog=page.locator('.el-dialog').filter({hasText:'人工例外退款'})
  await dialog.getByRole('textbox',{name:'平台订阅订单号'}).fill('paid-order')
  await dialog.getByRole('button',{name:'核对订单',exact:true}).click()
  await expect(dialog).toContainText('链路暂不可用')
  await dialog.getByRole('spinbutton',{name:'人工核定退款金额'}).fill('2')
  await dialog.getByRole('textbox',{name:'内部例外处理原因'}).fill('核查链路后进行人工协商退款')
  await dialog.getByText('已核对用户、订阅和退款金额，确认按人工例外处理',{exact:true}).click()
  await expect(dialog.getByRole('button',{name:'核定退款并冻结积分',exact:true})).toBeDisabled()
  failed=false
  await dialog.getByRole('button',{name:'刷新链路',exact:true}).click()
  await expect(dialog).toContainText('provider-paid')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
})

test('audit tables expose later pages instead of truncating the user chain',async({page})=>{
  await setup(page,'processing');await mockManualLookup(page)
  await page.route('**/api/v1/admin/orders/paid-order/subscription-audit?*',route=>{
    const url=new URL(route.request().url()),section=url.searchParams.get('section'),pageNo=Number(url.searchParams.get('page'))||1
    const data=auditFixture(section,pageNo)
    if(section==='usage'){data.records.total=21;data.records.items=pageNo===1?Array.from({length:20},(_,i)=>({...data.records.items[0],sourceId:`source-${i}`})):[{...data.records.items[0],sourceId:'earliest-use'}]}
    return fulfillJson(route,data)
  })
  await page.getByRole('button',{name:'人工例外退款',exact:true}).click()
  const dialog=page.locator('.el-dialog').filter({hasText:'人工例外退款'})
  await dialog.getByRole('textbox',{name:'平台订阅订单号'}).fill('paid-order')
  await dialog.getByRole('button',{name:'核对订单',exact:true}).click()
  await dialog.getByRole('tab',{name:'实际消费',exact:true}).click()
  await dialog.locator('.subscription-audit .el-pagination .btn-next').click()
  await expect(dialog).toContainText('earliest-use')
})

test('ordinary order inspection can open the complete chain without entering refund workflow',async({page})=>{
  await setup(page,'processing');await mockManualLookup(page)
  let refundLookups=0
  page.on('request',request=>{if(request.url().includes('/subscription-refund'))refundLookups++})
  await page.route('**/api/v1/admin/orders/paid-order',route=>fulfillJson(route,{
    id:'paid-order',userId:'manual-user',username:'协商客户',userEmail:'manual@example.com',planId:'plan-one',planName:'三日订阅',planKind:'subscription',planRevision:1,status:'completed',amountCents:300,grantCents:0,bonusCents:0,dailyGrantCents:100,durationDays:3,paymentMethod:'alipay',createdAt:'2026-09-06T04:00:00Z',changes:[],timeline:[],benefitRecord:null,currentSubscription:{id:'manual-sub',planName:'三日订阅',status:'active'},
    finance:{kind:'subscription',subscriptionId:'manual-sub',receiptConfirmed:true,receivedCents:300,refundedCents:0,netCents:300,relatedRefundCents:0,refundPendingCents:0,refundNeedsAllocation:false,delivery:'delivered'},
  }))
  await page.goto(`${base}/admin/orders?orderId=paid-order&search=paid-order`)
  await page.getByRole('button',{name:'完整订阅链路',exact:true}).click()
  await expect(page.getByRole('region',{name:'用户订阅账务链路',exact:true})).toContainText('provider-paid')
  await expect(page.getByRole('button',{name:'核定退款并冻结积分',exact:true})).toHaveCount(0)
  expect(refundLookups).toBe(0)
})

test('admin can search a customer and inspect linked accounting records', async ({ page }) => {
  await setup(page, 'processing')
  const change = { id: 'refund-one', userId: 'user-one', username: '客户甲', userEmail: 'customer@example.com', subscriptionId: 'sub-one', kind: 'refund', status: 'processing', amountCents: 1326, reason: '申请退订', snapshot: { planName: '三日订阅' } }
  let searched = ''
  await page.route('**/api/v1/admin/subscription-changes?*', route => { searched = new URL(route.request().url()).searchParams.get('q'); return fulfillJson(route, { items: [change], total: 1 }) })
  await page.route('**/api/v1/admin/subscription-changes/refund-one', route => fulfillJson(route, {
    change, user: { username: '客户甲', email: 'customer@example.com' }, subscription: {},
    currentCalculation: { paidCents: 1990, issuedPoints: 100, spentPoints: 100, taskFrozenPoints: 0, refundHeldPoints: 0, futurePoints: 200, remainingSeconds: 172800, timeValueCents: 1326, unusedValueCents: 1326, maxRefundCents: 1326, rule: 'remaining_service_and_unused_credits' },
    orders: [{ id: 'original-payment-order', providerOrderId: 'provider-123', amountCents: 1990, status: 'completed' }], ledger: [], ledgerPage: 1, ledgerTotal: 0, ledgerLimit: 50, events: [],
  }))
  await page.getByRole('textbox', { name: '搜索订阅账务' }).fill('customer@example.com')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect.poll(() => searched).toBe('customer@example.com')
  await page.getByRole('button', { name: '查账', exact: true }).click()
  const drawer = page.locator('.el-drawer')
  await expect(drawer).toContainText('客户甲')
  await expect(drawer).toContainText('original-payment-order')
  await expect(drawer).toContainText('provider-123')
  await expect(drawer).toContainText('¥13.26')
  await expect(drawer.getByRole('button', { name: '导出当前页核查记录' })).toBeVisible()
})
