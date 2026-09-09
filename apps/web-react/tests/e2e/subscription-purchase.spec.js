import {test,expect} from '@playwright/test'
import {installVisualBaseline} from './helpers/visualBaseline.js'
import {fulfillJson} from './helpers/authMocks.js'

const consent='我已了解订阅权益、积分重置及退款规则'
async function setup(page,theme='light',kind='subscription') {
  await installVisualBaseline(page)
  await page.addInitScript(theme=>{localStorage.setItem('walleven-color-scheme',theme);localStorage.setItem('starclouds-appearance',theme);document.documentElement.classList.toggle('color-scheme-dark',theme==='dark')},theme)
  const state={requests:[],order:null,rejectNext:false,plan:{id:'purchase-plan',name:'轻享 3 日订阅',kind,revision:1,priceCents:1990,grantCents:kind==='topup'?1000:0,dailyGrantCents:100,durationDays:3,subscriptionPolicy:{version:2,series:'general',tier:1,channels:['web','api'],featureKeys:['text_to_image'],modelIds:['image-model'],concurrencyBonus:2,lockModelPrices:true,allowTopupPriceLock:false,refundWindowHours:24}}}
  await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'purchase-user',email:'purchase@example.com'}}))
  await page.route('**/api/v1/me/subscription',route=>fulfillJson(route,{active:false,blockingPurchase:false}))
  await page.route('**/api/v1/me/subscriptions',route=>fulfillJson(route,{items:[],changes:[]}))
  await page.route('**/api/v1/plans',route=>fulfillJson(route,{items:[state.plan],paymentEnabled:true,paymentMethods:['alipay','wechat']}))
  await page.route('**/api/v1/orders?*',route=>{const status=new URL(route.request().url()).searchParams.get('status');return fulfillJson(route,{items:state.order && (!status || status===state.order.status)?[state.order]:[]})})
  await page.route('**/api/v1/orders/purchase-order',route=>fulfillJson(route,state.order))
  await page.route('**/api/v1/orders',route=>{
    const body=route.request().postDataJSON();state.requests.push(body)
    if(state.rejectNext){state.rejectNext=false;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,code:'plan_changed',error:'订阅方案已更新，请重新确认权益'})})}
    state.order={id:'purchase-order',planId:state.plan.id,planName:state.plan.name,planKind:kind,status:'pending',amountCents:state.plan.priceCents,dailyGrantCents:state.plan.dailyGrantCents,durationDays:3,paymentMethod:body.paymentMethod,payUrl:'https://example.com/qr',expiresAt:'2026-08-11T04:30:00Z'}
    return fulfillJson(route,state.order)
  })
  return state
}

for(const [theme,width] of [['light',1280],['dark',390]]) {
  test(`subscription purchase discloses rights and requires explicit consent at ${width}`,async({page},info)=>{
    const state=await setup(page,theme)
    await page.setViewportSize({width,height:844})
    await page.goto('/pricing')
    await expect(page.getByRole('button',{name:'订阅',exact:true})).toHaveAttribute('aria-pressed','true')
    await page.getByRole('button',{name:'选择此方案',exact:true}).click()
    const dialog=page.getByRole('dialog')
    const benefits=dialog.getByRole('region',{name:'本次订阅权益'})
    await expect(benefits).toContainText('3 天')
    await expect(benefits).toContainText('自开通时起每24小时重置')
    await expect(benefits).toContainText('100 积分')
    await expect(benefits).toContainText('+2')
    await expect(benefits).toContainText('仅订阅积分锁价')
    await expect(benefits).toContainText('网站、API')
    await expect(benefits).toContainText('适用场景文生图')
    await expect(benefits).toContainText('适用模型image-model')
    await expect(benefits).toContainText('使用过订阅积分不支持自助退款')
    await expect(benefits).toContainText('开通后 24 小时内未使用')
    const checkbox=dialog.getByRole('checkbox',{name:consent})
    const pay=dialog.getByRole('button',{name:'使用支付宝支付',exact:true})
    await expect(checkbox).not.toBeChecked()
    await expect(pay).toBeDisabled()
    expect(state.requests).toHaveLength(0)
    await checkbox.check()
    await expect(pay).toBeEnabled()
    await checkbox.uncheck()
    await expect(pay).toBeDisabled()
    await checkbox.check()
    await dialog.getByRole('radio',{name:'微信支付',exact:true}).click()
    await expect(checkbox).toBeChecked()
    const method=await dialog.getByRole('radiogroup',{name:'支付方式'}).boundingBox()
    const accept=await dialog.locator('.pp-subscription-consent').boundingBox()
    const submit=await dialog.getByRole('button',{name:'使用微信支付',exact:true}).boundingBox()
    expect(accept.y).toBeGreaterThanOrEqual(method.y+method.height)
    expect(submit.y).toBeGreaterThanOrEqual(accept.y+accept.height)
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await page.screenshot({path:info.outputPath(`subscription-purchase-${width}.png`)})
    await dialog.getByRole('button',{name:'使用微信支付',exact:true}).click()
    expect(state.requests).toHaveLength(1)
    expect(state.requests[0].expectedPlanRevision).toBe(1)
    await expect(dialog.locator('.pp-checkout__qr')).toBeVisible()
  })
}

test('closing and reopening subscription checkout resets consent',async({page})=>{
  await setup(page)
  await page.goto('/pricing?plan=subscription')
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  await page.getByRole('checkbox',{name:consent}).check()
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:consent})).not.toBeChecked()
  await expect(page.getByRole('button',{name:'使用支付宝支付',exact:true})).toBeDisabled()
})

test('changed subscription rights require refreshing and consenting again',async({page})=>{
  const state=await setup(page)
  await page.goto('/pricing?plan=subscription')
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  await page.getByRole('checkbox',{name:consent}).check()
  state.plan={...state.plan,revision:2,dailyGrantCents:200}
  state.plan.subscriptionPolicy={...state.plan.subscriptionPolicy,refundWindowHours:3}
  state.rejectNext=true
  await page.getByRole('button',{name:'使用支付宝支付',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:consent})).not.toBeChecked()
  await expect(page.getByRole('checkbox',{name:consent})).toBeDisabled()
  await expect(page.getByRole('button',{name:'使用支付宝支付',exact:true})).toBeDisabled()
  expect(state.order).toBeNull()
  await page.getByRole('button',{name:'重新确认订阅权益',exact:true}).click()
  await expect(page.getByRole('region',{name:'本次订阅权益'})).toContainText('200 积分')
  await expect(page.getByRole('region',{name:'本次订阅权益'})).toContainText('开通后 3 小时内未使用')
  await expect(page.getByRole('checkbox',{name:consent})).not.toBeChecked()
  await page.getByRole('checkbox',{name:consent}).check()
  await page.getByRole('button',{name:'使用支付宝支付',exact:true}).click()
  await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
  expect(state.requests.map(body=>body.expectedPlanRevision)).toEqual([1,2])
})

test('existing subscription orders resume without creating a new order',async({page})=>{
  const state=await setup(page)
  state.order={id:'purchase-order',planId:state.plan.id,planName:state.plan.name,planKind:'subscription',status:'pending',amountCents:1990,paymentMethod:'alipay',payUrl:'https://example.com/qr',expiresAt:'2026-08-11T04:30:00Z'}
  await page.goto('/pricing?plan=subscription')
  await page.locator('.pp-plan').getByRole('button',{name:/去支付/}).click()
  await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
  await expect(page.getByRole('checkbox',{name:consent})).toHaveCount(0)
  expect(state.requests).toHaveLength(0)
})

test('top-up checkout does not acquire a subscription agreement',async({page})=>{
  const state=await setup(page,'light','topup')
  await page.goto('/pricing')
  await page.getByRole('button',{name:'额度包',exact:true}).click()
  await expect(page).toHaveURL(/plan=topup/)
  await page.reload()
  await expect(page.getByRole('button',{name:'额度包',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  await expect(page.getByRole('checkbox',{name:consent})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'使用支付宝支付',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'使用支付宝支付',exact:true}).click()
  await expect(page.getByRole('dialog').locator('.pp-checkout__qr')).toBeVisible()
  expect(state.requests[0].expectedPlanRevision).toBeUndefined()
})

test('real-time pricing and restricted channels are disclosed without invented benefits',async({page})=>{
  const state=await setup(page)
  state.plan.subscriptionPolicy={...state.plan.subscriptionPolicy,channels:['api'],featureKeys:[],modelIds:[],concurrencyBonus:0,lockModelPrices:false,refundWindowHours:0}
  await page.goto('/pricing?plan=subscription')
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  const benefits=page.getByRole('region',{name:'本次订阅权益'})
  await expect(benefits).toContainText('按实时模型价格计费')
  await expect(benefits.locator('dl')).not.toContainText('网站')
  await expect(benefits).toContainText('适用场景全部场景')
  await expect(benefits).toContainText('适用模型全部模型')
  await expect(benefits).toContainText('+0')
  await expect(benefits).not.toContainText('全额退款')
})

test('failed entitlement refresh blocks purchasing from a stale plan card',async({page})=>{
  const state=await setup(page)
  await page.goto('/pricing?plan=subscription')
  await expect(page.getByRole('button',{name:'选择此方案',exact:true})).toBeEnabled()
  await page.route('**/api/v1/plans',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'暂不可用'})}))
  await page.getByRole('button',{name:'选择此方案',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('暂时无法确认订单或订阅权益')
  await expect(page.getByRole('button',{name:'使用支付宝支付',exact:true})).toHaveCount(0)
  expect(state.requests).toHaveLength(0)
})
