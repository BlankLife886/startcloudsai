import {expect,test} from '@playwright/test'
import {fulfillJson} from './helpers/authMocks.js'

test.skip(!process.env.ADMIN_BASE_URL,'Requires the isolated admin server')
const base=process.env.ADMIN_BASE_URL || 'http://127.0.0.1:8144'

const usage={keys:2,onlyModel:1,calls7d:120,calls30d:860,users30d:14,revenue30d:10320,unrestrictedKeys:5,targetSiteCalls1h:40,targetApiCalls1h:9}
const target=(id,name,runnable=true)=>({id,name,exists:true,enabled:true,available:true,runnable,sitePriceCents:12})

async function setup(page){
 const state={items:[
  {id:'apim_live',apiName:'gpt-image-2',aliases:[],kind:'image',status:'live',priceMode:'follow',priceCents:null,unitPriceCents:12,pendingPrice:{priceCents:15,effectiveAt:'2026-10-07T04:00:00Z'},replacement:null,maxConcurrency:0,description:'',locked:true,publishedAt:'2026-09-30T00:00:00Z',target:target('m1','gpt-image-2'),usage},
  {id:'apim_next',apiName:'gpt-image-3',aliases:[],kind:'image',status:'live',priceMode:'follow',priceCents:null,unitPriceCents:14,pendingPrice:null,replacement:null,maxConcurrency:0,description:'',locked:true,target:target('m1','gpt-image-2'),usage},
  {id:'apim_old',apiName:'gpt-image-1',aliases:[],kind:'image',status:'deprecated',sunsetAt:'2026-10-20T04:00:00Z',replacement:{id:'apim_next',apiName:'gpt-image-3'},priceMode:'follow',priceCents:null,unitPriceCents:10,pendingPrice:null,maxConcurrency:0,description:'',locked:true,target:target('m1','gpt-image-2'),usage},
  {id:'apim_draft',apiName:'gpt-image-2-vip',aliases:['vip'],kind:'image',status:'draft',priceMode:'fixed',priceCents:6,unitPriceCents:6,maxConcurrency:5,description:'',locked:false,target:target('m1','gpt-image-2'),usage:{...usage,keys:0,onlyModel:0,calls7d:0,calls30d:0,users30d:0,revenue30d:0}},
  {id:'apim_down',apiName:'gpt-5.6-luna',aliases:[],kind:'chat',status:'live',priceMode:'follow',priceCents:null,unitPriceCents:10,maxConcurrency:0,description:'',locked:true,target:target('c1','gpt-5.6-luna',false),usage},
 ],requests:[]}
 await page.route('**/api/**',route=>fulfillJson(route,{items:[]}))
 await page.route('**/api/v1/admin/auth/session',route=>fulfillJson(route,{admin:{id:'admin',username:'管理员',email:'admin@example.com',role:'admin'}}))
 await page.route('**/api/v1/admin/developer-api/summary**',route=>fulfillJson(route,{calls:0,charged:0,refunded:0,pending:0,revenueCents:0,upstreamCostCents:0,grossProfitCents:0,users:0,keys:0,models:[],modelOptions:[]}))
 await page.route('**/api/v1/admin/developer-api/calls**',route=>fulfillJson(route,{items:[],total:0}))
 await page.route('**/api/v1/admin/developer-api/models**',route=>{
  const request=route.request()
  if(request.method()==='GET')return fulfillJson(route,{settings:{deprecationNoticeDays:7,priceIncreaseNoticeDays:7},items:state.items,targets:[{id:'m1',name:'gpt-image-2',kind:'image',enabled:true,runnable:true,sitePriceCents:12},{id:'c1',name:'gpt-5.6-luna',kind:'chat',enabled:false,runnable:false,sitePriceCents:10}]})
  const path=new URL(request.url()).pathname
  state.requests.push({method:request.method(),path,body:request.postDataJSON?.()})
  const id=path.split('/')[6]
  const item=state.items.find(row=>row.id===id)
  if(path.endsWith('/publish')){item.status='live';item.locked=true}
  if(path.endsWith('/withdraw'))item.status='draft'
  if(path.endsWith('/retire'))item.status='retired'
  if(path.endsWith('/deprecate'))item.status='deprecated'
  return fulfillJson(route,item)
 })
 await page.goto(`${base}/admin/developer-api`)
 await page.getByRole('tab',{name:'API 模型'}).click()
 return state
}

test('catalog lists API models with status, target and price',async({page})=>{
 await setup(page)
 const live=page.getByRole('row').filter({hasText:'gpt-image-2'}).first()
 await expect(live).toContainText('上线')
 await expect(live).toContainText('跟随站内价')
 await expect(live).toContainText('10/7')
 const old=page.getByRole('row').filter({hasText:'gpt-image-1'})
 await expect(old).toContainText('弃用中')
 await expect(old).toContainText('替代：gpt-image-3')
 await expect(page.getByRole('row').filter({hasText:'gpt-image-2-vip'})).toContainText('草稿')
 await expect(page.getByRole('row').filter({hasText:'gpt-5.6-luna'})).toContainText('不可用')
 if(process.env.SHOT_DIR){await page.waitForTimeout(500);await page.screenshot({path:`${process.env.SHOT_DIR}/admin-catalog.png`})}
})

test('a published name is locked and a draft can be published',async({page})=>{
 const state=await setup(page)
 await page.getByRole('row').filter({hasText:'gpt-image-2'}).first().getByRole('button',{name:'编辑',exact:true}).click()
 const drawer=page.locator('.el-drawer').filter({hasText:'编辑「gpt-image-2」'})
 await expect(drawer.getByPlaceholder('如：gpt-image-2')).toBeDisabled()
 await expect(drawer).toContainText('引用它的 Key 2 把')
 await expect(drawer).toContainText('近 1 小时：站内 40 次 · API 9 次')
 if(process.env.SHOT_DIR){await page.waitForTimeout(600);await page.screenshot({path:`${process.env.SHOT_DIR}/admin-catalog-edit.png`})}
 await drawer.getByRole('button',{name:'取消',exact:true}).click()
 await page.getByRole('row').filter({hasText:'gpt-image-2-vip'}).getByRole('button',{name:'发布',exact:true}).click()
 await page.locator('.el-message-box').getByRole('button',{name:'发布',exact:true}).click()
 await expect.poll(()=>state.requests.map(r=>r.path)).toContain('/api/v1/admin/developer-api/models/apim_draft/publish')
})

test('withdrawing asks for a reason and shows the impact',async({page})=>{
 const state=await setup(page)
 await page.getByRole('row').filter({hasText:'gpt-image-2'}).first().getByRole('button',{name:'状态'}).click()
 await page.getByRole('menuitem',{name:'撤回为草稿…'}).click()
 const box=page.locator('.el-message-box')
 await expect(box).toContainText('近 7 天 120 次调用')
 await box.getByRole('button',{name:'确认撤回',exact:true}).click()
 await expect(box).toContainText('请填写原因')
 expect(state.requests).toHaveLength(0)
 await box.getByRole('textbox').fill('上游故障')
 await box.getByRole('button',{name:'确认撤回',exact:true}).click()
 await expect.poll(()=>state.requests[0]?.body).toEqual({reason:'上游故障'})
})

test('emergency retirement needs a reason and a second confirmation',async({page})=>{
 const state=await setup(page)
 await page.getByRole('row').filter({has:page.getByText('gpt-image-3',{exact:true})}).getByRole('button',{name:'状态'}).click()
 await page.getByRole('menuitem',{name:'紧急下线…'}).click()
 const box=page.locator('.el-message-box')
 await expect(box).toContainText('没有预告期')
 await box.getByRole('textbox').fill('上游停服')
 await box.getByRole('button',{name:'下一步',exact:true}).click()
 await expect(page.locator('.el-message-box').filter({hasText:'再次确认'})).toContainText('近 7 天有 120 次调用')
 expect(state.requests).toHaveLength(0)
 await page.locator('.el-message-box').getByRole('button',{name:'立即下线',exact:true}).click()
 await expect.poll(()=>state.requests[0]).toMatchObject({path:'/api/v1/admin/developer-api/models/apim_next/retire',body:{reason:'上游停服'}})
})

test('deprecation asks for a sunset and replacement',async({page})=>{
 const state=await setup(page)
 await page.getByRole('row').filter({hasText:'gpt-image-2'}).first().getByRole('button',{name:'状态'}).click()
 await page.getByRole('menuitem',{name:'弃用并预告下线…'}).click()
 const dialog=page.getByRole('dialog',{name:'弃用「gpt-image-2」'})
 await expect(dialog).toContainText('至少 7 天后')
 await dialog.locator('.el-select').click()
 await page.getByRole('option',{name:'gpt-image-3'}).click()
 await dialog.getByPlaceholder('如：上游模型停止维护，迁移到新版').fill('迁移到新版')
 if(process.env.SHOT_DIR){await page.waitForTimeout(400);await page.screenshot({path:`${process.env.SHOT_DIR}/admin-deprecate.png`})}
 await dialog.getByRole('button',{name:'确认弃用'}).click()
 await expect.poll(()=>state.requests[0]?.body).toMatchObject({replacementId:'apim_next',reason:'迁移到新版'})
 const sunset=Date.parse(state.requests[0].body.sunsetAt)
 expect(sunset-Date.now()).toBeGreaterThan(7*86400000-60000)
})
