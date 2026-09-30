import {test,expect} from '@playwright/test';
import {installVisualBaseline} from './helpers/visualBaseline.js';
import {fulfillJson} from './helpers/authMocks.js';

test.beforeEach(async({page})=>{await installVisualBaseline(page);await page.setViewportSize({width:1440,height:900})});

async function mockLiveConsole(page){
 const keys=[],writes=[];
 await page.route('**/api/v1/runtime-config**',route=>fulfillJson(route,{features:{},pageControls:{developer_api:{status:'normal',reason:''}}}));
 await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'key-controls-test',username:'tester',role:'user'}}));
 await page.route('**/api/v1/me/api-keys',async route=>{
  if(route.request().method()!=='POST')return fulfillJson(route,{items:keys});
  const payload=route.request().postDataJSON();writes.push(payload);
  const key={...payload,id:`key_${keys.length+1}`,prefix:'sk-sc-e2e',status:'active',createdAt:new Date().toISOString(),usage:{}};
  keys.push(key);return fulfillJson(route,{key,secret:'sk-sc-e2e-not-a-real-secret'});
 });
 await page.route('**/api/v1/me/api-models',route=>fulfillJson(route,{items:[]}));
 return writes;
}

test('real resource failures stay explicit and models are listed by their /v1 name',async({page})=>{
 await page.route('**/api/v1/runtime-config**',route=>fulfillJson(route,{features:{},pageControls:{developer_api:{status:'normal',reason:''}}}));
 await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'real-scope-test',username:'tester',role:'user'}}));
 await page.route('**/api/v1/me/api-keys',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'读取服务暂时不可用'})}));
 await page.route('**/api/v1/me/api-models',route=>fulfillJson(route,{items:[{id:'model-7f3a-internal',model:'real-image',name:'真实模型目录',kind:'image',priceCents:12}]}));
 await page.goto('/developer-api');
 await expect(page.getByRole('alert')).toContainText('读取服务暂时不可用');
 await expect(page.getByRole('navigation',{name:'开发者导航'}).getByRole('button')).toHaveText(['开始使用','API Keys','调用记录','模型']);
 await page.getByRole('button',{name:'模型',exact:true}).click();
 await expect(page).toHaveURL(/tab=models/);
 const table=page.getByRole('table');
 await expect(table.getByText('real-image',{exact:true})).toBeVisible();
 await expect(table.getByText('真实模型目录',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'用它生成代码'}).click();
 const snippet=page.locator('.dap-code pre');
 await expect(snippet).toContainText('model="real-image"');
 await page.getByRole('tab',{name:'cURL'}).click();
 await expect(snippet).toContainText('"model": "real-image"');
 await expect(page.getByTestId('developer-console')).not.toContainText('model-7f3a-internal');
});

test('custom key controls preserve number bounds, calendar focus and saved expiry',async({page})=>{
 const writes=await mockLiveConsole(page);
 await page.goto('/developer-api');
 const dates=await page.evaluate(()=>{
  const date=new Date();
  const format=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const today=format(date);date.setDate(date.getDate()-1);const yesterday=format(date);
  date.setDate(date.getDate()+2);
  return {today,yesterday,tomorrow:format(date),label:`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`,savedDate:date.toLocaleDateString('zh-CN')};
 });
 await page.getByRole('button',{name:/^API Keys/}).click();
 await page.locator('.dap-filterbar').getByRole('button',{name:'创建 Key',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建 API Key',exact:true});
 await form.getByLabel('名称',{exact:true}).fill('自定义控件联调');
 await expect(form.getByRole('radio',{name:'轻量'})).toHaveAttribute('aria-checked','true');
 await expect(form.getByRole('spinbutton',{name:'每日请求数',exact:true})).toHaveCount(0);
 await form.getByRole('radio',{name:'自定义'}).click();
 const limit=form.getByRole('spinbutton',{name:'每日请求数',exact:true});
 await limit.fill('2');
 await form.getByRole('button',{name:'减少 每日请求数',exact:true}).click();
 await expect(limit).toHaveValue('1');
 await form.getByRole('button',{name:'增加 每日请求数',exact:true}).click();
 await expect(limit).toHaveValue('2');
 await limit.fill('1.5');
 await form.getByRole('button',{name:'增加 每日请求数',exact:true}).click();
 await expect(limit).toHaveValue('2');
 const trigger=form.getByRole('button',{name:'到期日期',exact:true});
 await trigger.click();
 const calendar=page.getByRole('dialog',{name:'选择到期日期',exact:true});
 await expect(calendar.getByRole('button',{name:dates.yesterday,exact:true})).toBeDisabled();
 await calendar.getByRole('button',{name:dates.today,exact:true}).focus();
 await page.keyboard.press('ArrowRight');
 await expect(calendar.getByRole('button',{name:dates.tomorrow,exact:true})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(calendar).toHaveCount(0);
 await expect(trigger).toHaveText(dates.label);
 await trigger.click();
 await expect(calendar).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(calendar).toHaveCount(0);
 await expect(form).toBeVisible();
 await expect(trigger).toBeFocused();
 await trigger.click();
 await calendar.getByRole('button',{name:'长期有效',exact:true}).click();
 await expect(trigger).toHaveText('长期有效');
 await trigger.click();
 await calendar.getByRole('button',{name:dates.tomorrow,exact:true}).click();
 await form.getByRole('button',{name:'创建 Key',exact:true}).click();
 await page.getByRole('dialog',{name:'API Key 已创建',exact:true}).getByRole('button',{name:'我已安全保存',exact:true}).click();
 await page.getByRole('button',{name:'自定义控件联调',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Key 详情',exact:true})).toContainText(dates.savedDate);
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({label:'自定义控件联调',dailyTaskLimit:2});
});

test('a new key is filled into the start tab code and the tab survives reload',async({page})=>{
 await mockLiveConsole(page);
 await page.goto('/developer-api?tab=quickstart');
 const snippet=page.locator('.dap-code pre');
 await expect(snippet).toContainText('YOUR_API_KEY');
 await page.getByRole('button',{name:'创建 Key',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建 API Key',exact:true});
 await form.getByLabel('名称',{exact:true}).fill('联调');
 await form.getByRole('button',{name:'创建 Key',exact:true}).click();
 await page.getByRole('dialog',{name:'API Key 已创建',exact:true}).getByRole('button',{name:'我已安全保存',exact:true}).click();
 await expect(snippet).toContainText('sk-sc-e2e-not-a-real-secret');
 await expect(page.locator('.dap-secret-inline')).toContainText('sk-sc-e2e-');
 await expect(page.getByTestId('developer-console')).toContainText('已填入');
 await page.getByRole('button',{name:/^API Keys/}).click();
 await expect(page).toHaveURL(/tab=keys/);
 await page.reload();
 await expect(page.getByRole('button',{name:/^API Keys/})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('button',{name:'编辑 联调'})).toBeVisible();
});

test('legacy demo route redirects to the live console',async({page})=>{
 await mockLiveConsole(page);
 await page.goto('/developer-api/demo');
 await expect(page).toHaveURL(/\/developer-api$/);
 await expect(page.getByTestId('developer-console')).toBeVisible();
});

test('call history shows charges, refunds and reasons without internal ids',async({page})=>{
 await mockLiveConsole(page);
 await page.route('**/api/v1/me/api-calls**',route=>fulfillJson(route,{page:1,pageSize:20,total:2,totalCapped:false,items:[
  {createdAt:'2026-09-29T08:00:00Z',kind:'chat',operation:'对话',model:'gpt-5.6-luna',status:'charged',chargedCents:7,reason:'结果已产生，调用方中途断开，照常扣费',key:{label:'生产环境',prefix:'sk-sc-ab12'},tokens:{prompt:5,completion:1,total:6}},
  {createdAt:'2026-09-29T07:00:00Z',kind:'image',operation:'生成图片',model:'gpt-image-2',status:'refunded',chargedCents:0,reason:'上游拒绝了请求（如内容安全），已退回',key:null,images:1},
 ]}));
 await page.goto('/developer-api');
 await page.getByRole('button',{name:'调用记录',exact:true}).click();
 const table=page.locator('.dap-calls-table');
 await expect(table).toContainText('gpt-5.6-luna');
 await expect(table).toContainText('6 tokens');
 await expect(table).toContainText('-7');
 await expect(table).toContainText('照常扣费');
 await expect(table).toContainText('已退回');
 await expect(table).toContainText('已删除的 Key');
 await expect(page.getByTestId('developer-console')).toContainText('不进入钱包明细');
});

test('a key can be paused and resumed from the list',async({page})=>{
 const key={id:'key_pause',label:'暂停联调',prefix:'sk-sc-p4u5',status:'active',createdAt:'2026-09-01T00:00:00Z',allowedModelIds:[],dailyTaskLimit:100,dailySpendLimitCents:10000,usage:{}};
 const calls=[];
 await page.route('**/api/v1/runtime-config**',route=>fulfillJson(route,{features:{},pageControls:{developer_api:{status:'normal',reason:''}}}));
 await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'pause-test',username:'tester',role:'user'}}));
 await page.route('**/api/v1/me/api-models',route=>fulfillJson(route,{items:[]}));
 await page.route('**/api/v1/me/api-keys',route=>fulfillJson(route,{items:[key]}));
 await page.route(/\/api\/v1\/me\/api-keys\/key_pause\/(pause|resume)$/,route=>{const action=route.request().url().split('/').pop();calls.push(action);key.status=action==='pause'?'paused':'active';return fulfillJson(route,key)});
 await page.goto('/developer-api?tab=keys');
 await page.getByRole('button',{name:'停用 暂停联调'}).click();
 await expect(page.getByRole('status')).toContainText('已停用');
 await expect(page.locator('.dap-keys-table')).toContainText('已停用');
 await page.getByRole('button',{name:'启用 暂停联调'}).click();
 await expect(page.getByRole('button',{name:'停用 暂停联调'})).toBeVisible();
 expect(calls).toEqual(['pause','resume']);
});

test('model lifecycle shows on the models page, Key list, Key detail and Key form',async({page})=>{
 const sunset='2026-10-20T04:00:00Z',effective='2026-10-08T04:00:00Z';
 const models=[
  {id:'apim_live',model:'img-live',name:'img-live',kind:'image',status:'live',priceCents:10,pendingPrice:{priceCents:14,effectiveAt:effective},maxReferenceImages:4},
  {id:'apim_old',model:'img-old',name:'img-old',kind:'image',status:'deprecated',priceCents:8,sunsetAt:sunset,replacement:{id:'apim_live',model:'img-live'},maxReferenceImages:4},
  {id:'apim_fix',model:'img-fix',name:'img-fix',kind:'image',status:'maintenance',priceCents:9,maxReferenceImages:4},
  {id:'apim_gone',model:'img-gone',name:'img-gone',kind:'image',status:'retired',priceCents:null,retiredAt:'2026-09-20T00:00:00Z'},
 ];
 const base={prefix:'sk-sc-e2e',status:'active',createdAt:'2026-09-01T00:00:00Z',usage:{},dailyTaskLimit:100,monthlyTaskLimit:2000,dailySpendLimitCents:10000,monthlySpendLimitCents:200000,rateLimitPerMinute:120,dailyByteLimit:2*1024**3};
 const keys=[{...base,id:'k1',label:'即将下线的Key',allowedModelIds:['apim_live','apim_old']},{...base,id:'k2',label:'已下线的Key',allowedModelIds:['apim_live','apim_gone']}];
 await page.route('**/api/v1/runtime-config**',route=>fulfillJson(route,{features:{},pageControls:{developer_api:{status:'normal',reason:''}}}));
 await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'lifecycle-test',username:'tester',role:'user'}}));
 await page.route('**/api/v1/me/api-keys',route=>fulfillJson(route,{items:keys}));
 await page.route('**/api/v1/me/api-models',route=>fulfillJson(route,{items:models}));
 await page.goto('/developer-api?tab=models');
 const row=name=>page.getByRole('row').filter({has:page.getByText(name,{exact:true})});
 await expect(row('img-old')).toContainText('即将下线');
 await expect(row('img-old')).toContainText('10月20日 下线，建议改用 img-live');
 await expect(row('img-fix')).toContainText('维护中');
 await expect(row('img-gone')).toContainText('已下线');
 await expect(row('img-gone').getByRole('button',{name:'用它生成代码'})).toHaveCount(0);
 await expect(row('img-live')).toContainText('10月8日 起 14 积分/次');
 await expect(page.locator('.dap-models-footnote')).toContainText('API 价格不享受订阅锁价');

 await page.getByRole('button',{name:/^API Keys/}).click();
 await expect(row('即将下线的Key')).toContainText('1 个即将下线');
 await expect(row('已下线的Key')).toContainText('1 个已下线');
 await row('即将下线的Key').getByRole('button',{name:'即将下线的Key',exact:true}).click();
 const detail=page.getByRole('dialog',{name:'Key 详情'});
 await expect(detail).toContainText('img-old 将于 10月20日 下线');
 await expect(detail).toContainText('建议改用 img-live');
 if(process.env.SHOT_DIR){await page.waitForTimeout(500);await page.screenshot({path:`${process.env.SHOT_DIR}/key-detail.png`})}
 await detail.getByRole('button',{name:'编辑'}).click();
 const form=page.getByRole('dialog',{name:'编辑 API Key'});
 await form.getByRole('button',{name:'选择模型'}).click();
 const panel=page.getByRole('dialog',{name:'选择模型'});
 await expect(panel).toContainText('img-old');
 await expect(panel).toContainText('即将下线');
 await expect(panel).not.toContainText('img-gone');

 await page.goto('/developer-api');
 await page.getByRole('combobox',{name:'模型'}).click();
 await expect(page.getByRole('option')).toHaveText(['img-live','img-old']);
});
