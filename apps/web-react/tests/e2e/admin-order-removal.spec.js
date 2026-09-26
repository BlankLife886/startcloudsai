import {expect,test} from '@playwright/test'
import {fulfillJson} from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL,'Requires the isolated admin server')
const base=process.env.ADMIN_BASE_URL || 'http://127.0.0.1:8144'

async function setup(page){
 await page.route('**/api/**',route=>fulfillJson(route,{items:[]}))
 await page.route('**/api/v1/admin/auth/session',route=>fulfillJson(route,{admin:{id:'admin',username:'管理员',email:'admin@example.com',role:'admin'}}))
 const finance={kind:'topup',subscriptionId:null,receivedCents:0,receiptConfirmed:false,refundedCents:0,netCents:0,relatedRefundCents:0,refundPendingCents:0,refundNeedsAllocation:false,delivery:'not_due'}
 const common={userId:'user',userEmail:'user@example.com',planId:'plan',planKind:'topup',grantCents:100,bonusCents:0,amountCents:100,paymentMethod:'alipay',createdAt:'2026-09-08T04:00:00Z',paidAt:null,completedAt:null,finance}
 const state={calls:0,reject:false,items:[{...common,id:'expired-order',planName:'失效测试套餐',status:'expired'},{...common,id:'paid-order',planName:'已支付测试套餐',status:'completed',paidAt:'2026-09-08T04:01:00Z',completedAt:'2026-09-08T04:01:00Z',finance:{...finance,receivedCents:100,receiptConfirmed:true,netCents:100,delivery:'delivered'}}]}
 await page.route('**/api/v1/admin/orders?*',route=>fulfillJson(route,{items:state.items,total:state.items.length,summary:{total:state.items.length,confirmedOrders:1,pendingOrders:0,receivedCents:100,refundedCents:0,netCents:100,unallocatedRefundCents:0,partialRefundCents:0}}))
 await page.route('**/api/v1/admin/orders/expired-order',route=>{
  state.calls++
  if(state.reject){state.items[0]={...state.items[0],status:'completed',paidAt:'2026-09-08T04:02:00Z',completedAt:'2026-09-08T04:02:00Z'};return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,code:'order_not_deletable',error:'订单已收款，不能删除'})})}
  state.items=state.items.filter(row=>row.id!=='expired-order')
  return route.fulfill({status:204,body:''})
 })
 await page.goto(`${base}/admin/orders`)
 return state
}

test('only expired unpaid orders expose deletion and cancelling sends no request',async({page})=>{
 const state=await setup(page)
 const expired=page.getByRole('row').filter({hasText:'失效测试套餐'})
 const paid=page.getByRole('row').filter({hasText:'已支付测试套餐'})
 await expect(paid.getByRole('button',{name:'删除',exact:true})).toHaveCount(0)
 await expired.getByRole('button',{name:'删除',exact:true}).click()
 const confirmation=page.locator('.el-message-box')
 await expect(confirmation).toContainText('expired-order')
 await expect(confirmation).toContainText('原始记录与审计保留')
 await confirmation.getByRole('button',{name:'取消',exact:true}).click()
 expect(state.calls).toBe(0)
 await expect(expired).toBeVisible()
})

test('confirmed removal refreshes the list while preserving paid orders',async({page})=>{
 const state=await setup(page)
 await page.getByRole('row').filter({hasText:'失效测试套餐'}).getByRole('button',{name:'删除',exact:true}).click()
 await page.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click()
 await expect(page.getByRole('row').filter({hasText:'失效测试套餐'})).toHaveCount(0)
 await expect(page.getByRole('row').filter({hasText:'已支付测试套餐'})).toBeVisible()
 expect(state.calls).toBe(1)
})

test('a payment arriving before deletion is preserved and its latest status is loaded',async({page})=>{
 const state=await setup(page);state.reject=true
 await page.getByRole('row').filter({hasText:'失效测试套餐'}).getByRole('button',{name:'删除',exact:true}).click()
 await page.locator('.el-message-box').getByRole('button',{name:'删除',exact:true}).click()
 await expect(page.getByText('订单已收款，不能删除',{exact:true})).toBeVisible()
 const row=page.getByRole('row').filter({hasText:'失效测试套餐'})
 await expect(row).toContainText('已完成')
 await expect(row.getByRole('button',{name:'删除',exact:true})).toHaveCount(0)
 expect(state.items).toHaveLength(2)
})
