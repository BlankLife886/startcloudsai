import {expect,test} from '@playwright/test'
import {fulfillJson} from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL,'Requires the isolated admin server')
const base=process.env.ADMIN_BASE_URL || 'http://127.0.0.1:8144'

// A subscription plan limited to certain site models keeps its API model scope
// when edited, and the editor explains when API calls may use the plan.
test('plan editor keeps and edits the API model scope',async({page})=>{
 const plan={id:'p1',code:'pro',name:'专业版',kind:'subscription',status:'active',active:true,priceCents:9900,grantCents:0,dailyGrantCents:100,durationDays:30,revision:1,sortOrder:1,
  subscriptionPolicy:{version:2,series:'general',tier:1,channels:['web','api'],featureKeys:[],modelIds:['m1'],apiModelIds:['apim_a'],refundWindowHours:3,lockModelPrices:true,allowTopupPriceLock:false,concurrencyBonus:0,canvasProjectBonus:0}}
 const writes=[]
 await page.route('**/api/**',route=>fulfillJson(route,{items:[]}))
 await page.route('**/api/v1/admin/auth/session',route=>fulfillJson(route,{admin:{id:'admin',username:'管理员',email:'admin@example.com',role:'admin'}}))
 await page.route('**/api/v1/admin/developer-api/models',route=>fulfillJson(route,{items:[{id:'apim_a',apiName:'gpt-image-2',kind:'image',status:'live'},{id:'apim_b',apiName:'gpt-5.5',kind:'chat',status:'live'},{id:'apim_c',apiName:'old',kind:'image',status:'retired'}]}))
 await page.route('**/api/v1/admin/plans**',route=>{
  if(route.request().method()==='GET')return fulfillJson(route,{items:[plan],baseConcurrency:2,baseCanvasProjects:3})
  writes.push(route.request().postDataJSON());return fulfillJson(route,plan)
 })
 await page.goto(`${base}/admin/plans`)
 await page.getByRole('tab',{name:/订阅/}).click().catch(()=>{})
 await page.getByRole('button',{name:'编辑',exact:true}).first().click()
 const dialog=page.getByRole('dialog',{name:'编辑套餐'})
 const field=page.locator('.plan-api-models')
 await expect(field).toContainText('已限定模型ID范围')
 await expect(field).toContainText('gpt-image-2')
 await field.locator('.el-select').click()
 await expect(page.getByRole('option',{name:/old/})).toHaveCount(0)
 await page.getByRole('option',{name:/gpt-5\.5/}).click()
 await page.keyboard.press('Escape')
 if(process.env.SHOT_DIR){await page.waitForTimeout(300);await field.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.SHOT_DIR}/admin-plan-api.png`})}
 await page.getByRole('button',{name:'保存套餐'}).click()
 await expect.poll(()=>writes[0]?.subscriptionPolicy?.apiModelIds).toEqual(['apim_a','apim_b'])
})
