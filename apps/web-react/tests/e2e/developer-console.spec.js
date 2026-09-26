import {test,expect} from '@playwright/test';
import {installVisualBaseline} from './helpers/visualBaseline.js';
import {fulfillJson} from './helpers/authMocks.js';

test.beforeEach(async({page})=>{await installVisualBaseline(page);await page.setViewportSize({width:1440,height:900})});

async function chooseOption(page,label,name){
 await page.getByRole('combobox',{name:label,exact:true}).click();
 await page.getByRole('option',{name,exact:true}).click();
}

test('demo is populated and key lifecycle never calls real developer services',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 const writes=[];const developerRequests=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/v1/')||/\/api\/open\/v1|\/api\/v1\/me\/(api-keys|api-models|webhooks|webhook-deliveries)/.test(request.url()))developerRequests.push(request.url());if(request.method()!=='GET'&&/\/api\//.test(request.url()))writes.push(request.url())});
 await page.goto('/developer-api/demo');
 await expect(page.getByTestId('developer-console')).toHaveAttribute('data-mode','demo');
 await expect(page.getByRole('heading',{name:'开发者 API',exact:true})).toBeVisible();
 await expect(page.getByText('演示工作区',{exact:true})).toBeVisible();
 await page.screenshot({path:'../../.artifacts/developer-console-overview.png'});
 await page.getByRole('button',{name:'API Keys',exact:true}).click();
 await expect(page.getByRole('button',{name:'生产环境 · 图像服务',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'创建 Key',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建演示 Key',exact:true});
 await form.getByLabel('名称',{exact:true}).fill('演示联调项目');
 await form.getByRole('button',{name:'创建 Key',exact:true}).click();
 const secret=page.getByRole('dialog',{name:'API Key 已创建',exact:true});
 await expect(secret.locator('.dap-secret-value')).toContainText('demo_');
 await secret.getByRole('button',{name:'关闭演示凭据',exact:true}).click();
 await page.getByRole('button',{name:'演示联调项目',exact:true}).click();
 const detail=page.getByRole('dialog',{name:'Key 详情',exact:true});
 await expect(detail.getByText('每日任务数',{exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'轮换 Key',exact:true}).click();
 await page.getByRole('dialog',{name:'轮换访问密钥'}).getByRole('button',{name:'确认操作'}).click();
 await page.getByRole('dialog',{name:'新密钥已生成'}).getByRole('button',{name:'关闭演示凭据'}).click();
 await chooseOption(page,'状态筛选','可用');
 await page.getByRole('button',{name:'演示联调项目',exact:true}).click();
 await page.getByRole('dialog',{name:'Key 详情'}).getByRole('button',{name:'撤销 Key'}).click();
 await page.getByRole('dialog',{name:'撤销访问密钥'}).getByRole('button',{name:'确认操作'}).click();
 await expect(page.getByRole('button',{name:'演示联调项目',exact:true})).toHaveCount(0);
 expect(developerRequests).toEqual([]);expect(writes).toEqual([]);
});

test('demo webhook failures can be inspected and retried',async({page})=>{
 await page.goto('/developer-api/demo');
 await page.getByRole('button',{name:'1 条失败回调待关注',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'状态筛选'})).toHaveText('投递失败');
 await page.getByRole('button',{name:/查看投递/}).first().click();
 const detail=page.getByRole('dialog',{name:'投递详情'});
 await expect(detail.getByText('最近错误',{exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'重新投递'}).click();
 await page.getByRole('dialog',{name:'重新投递事件'}).getByRole('button',{name:'确认操作'}).click();
 await expect(page.getByText('暂无匹配的投递记录',{exact:true})).toBeVisible();
 await chooseOption(page,'状态筛选','待投递');
 await expect(page.getByRole('button',{name:/查看投递/})).toHaveCount(2);
 await page.getByRole('button',{name:'刷新数据',exact:true}).click();
 await expect(page.getByRole('button',{name:/查看投递/})).toHaveCount(1);
});

test('scenarios, responsive layout and quote examples work',async({page})=>{
 await page.goto('/developer-api/demo');
 await chooseOption(page,'演示场景','异常状态');
 await page.getByRole('button',{name:'API Keys',exact:true}).click();
 await chooseOption(page,'状态筛选','已过期');
 await expect(page.locator('.dap-keys-table tbody tr')).not.toHaveCount(0);
 await page.screenshot({path:'../../.artifacts/developer-console-keys.png'});
 await chooseOption(page,'演示场景','空白空间');
 await expect(page.getByRole('heading',{name:'还没有 API Key',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'快速接入',exact:true}).click();
 await expect(page.locator('.dap-code pre')).toContainText('/v1/images/generations');
 await page.getByRole('button',{name:'模拟图片返回',exact:true}).click();
 await expect(page.locator('.dap-response')).toContainText('b64_json');
 await expect(page.locator('.dap-response')).not.toContainText('"success"');
 await page.getByRole('button',{name:'模拟报价返回'}).click();
 await expect(page.locator('.dap-response')).toContainText('totalPriceCents');
 for(const viewport of [{width:375,height:812},{width:747,height:902},{width:1280,height:720},{width:1440,height:900}]){
  await page.setViewportSize(viewport);
  const sidebar=await page.locator('.dap-sidebar').boundingBox(),content=await page.locator('.dap-content').boundingBox();
  expect(sidebar.y+sidebar.height).toBeLessThanOrEqual(content.y+1);
  expect(Math.abs(sidebar.x-content.x)).toBeLessThan(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('combobox',{name:'演示场景'})).toBeVisible();
 }
 await chooseOption(page,'演示场景','常规运行');
 await page.getByRole('button',{name:'概览',exact:true}).click();
 await page.locator('label[title="切换暗色模式"]').click();
 await expect(page.getByTestId('developer-console')).toHaveClass(/is-dark/);
 await page.screenshot({path:'../../.artifacts/developer-console-dark.png'});
});

test('real resource failures stay explicit and do not become demo data',async({page})=>{
 await page.route('**/api/v1/runtime-config**',route=>fulfillJson(route,{features:{},pageControls:{developer_api:{status:'normal',reason:''}}}));
 await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user:{id:'real-scope-test',username:'tester',role:'user'}}));
 await page.route('**/api/v1/me/api-keys',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'读取服务暂时不可用'})}));
 await page.route('**/api/v1/me/api-models',route=>fulfillJson(route,{items:[{id:'real-model',name:'真实模型目录',priceCents:12}]}));
 await page.route('**/api/v1/me/webhooks',route=>fulfillJson(route,{items:[]}));
 await page.route('**/api/v1/me/webhook-deliveries',route=>fulfillJson(route,{items:[]}));
 await page.goto('/developer-api');
 await expect(page.getByTestId('developer-console')).toHaveAttribute('data-mode','live');
 await expect(page.getByRole('alert')).toContainText('读取服务暂时不可用');
 await page.getByRole('button',{name:'模型目录',exact:true}).click();
 await expect(page.getByText('真实模型目录',{exact:true})).toBeVisible();
 await expect(page.getByText('生产环境 · 图像服务',{exact:true})).toHaveCount(0);
});

test('demo webhook create, edit, pause and delete stay local',async({page})=>{
 const realCalls=[];
 page.on('request',request=>{if(/\/api\/v1\/me\/(webhooks|webhook-deliveries)/.test(request.url()))realCalls.push(request.url())});
 await page.goto('/developer-api/demo');
 await page.getByRole('button',{name:'Webhooks',exact:true}).click();
 await page.getByRole('button',{name:'添加 Webhook',exact:true}).click();
 const form=page.getByRole('dialog',{name:'添加演示 Webhook',exact:true});
 await form.getByLabel('名称',{exact:true}).fill('演示回调');
 await form.getByLabel('回调地址',{exact:true}).fill('https://example.com/demo/webhook');
 await form.getByRole('button',{name:'保存 Webhook',exact:true}).click();
 await page.getByRole('dialog',{name:'Webhook 签名密钥',exact:true}).getByRole('button',{name:'关闭演示凭据'}).click();
 let row=page.locator('.dap-hook-list article').filter({hasText:'演示回调'});
 await expect(row).toContainText('https://example.com/demo/webhook');
 await row.getByRole('button',{name:'暂停 演示回调',exact:true}).click();
 await page.getByRole('dialog',{name:'暂停回调端点'}).getByRole('button',{name:'确认操作'}).click();
 await expect(row.locator('.dap-badge')).toHaveText('停用');
 await row.getByRole('button',{name:'编辑',exact:true}).click();
 const edit=page.getByRole('dialog',{name:'编辑演示 Webhook',exact:true});
 await edit.getByLabel('回调地址',{exact:true}).fill('https://example.com/updated/webhook');
 await edit.getByRole('button',{name:'保存 Webhook',exact:true}).click();
 await expect(row).toContainText('https://example.com/updated/webhook');
 await row.getByRole('button',{name:'删除 演示回调',exact:true}).click();
 await page.getByRole('dialog',{name:'删除回调端点'}).getByRole('button',{name:'确认操作'}).click();
 await expect(row).toHaveCount(0);expect(realCalls).toEqual([]);
});

test('custom scenario select supports keyboard selection and focus return with reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/developer-api/demo');
 const scenario=page.getByRole('combobox',{name:'演示场景',exact:true});
 await scenario.focus();
 await scenario.press('Space');
 await expect(page.getByRole('option',{name:'常规运行',exact:true})).toBeVisible();
 await page.keyboard.press('End');
 await page.keyboard.press('Enter');
 await expect(scenario).toHaveText('空白空间');
 await expect(scenario).toBeFocused();
 await page.getByRole('button',{name:'API Keys',exact:true}).click();
 await expect(page.getByRole('heading',{name:'还没有 API Key',exact:true})).toBeVisible();
 await scenario.focus();
 await scenario.press('Space');
 await expect(page.getByRole('option',{name:'常规运行',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('option')).toHaveCount(0);
 await expect(scenario).toHaveText('空白空间');
 await expect(scenario).toBeFocused();
 await page.getByRole('button',{name:'创建 Key',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建演示 Key',exact:true});
 await expect(form).toBeVisible();
 await expect(form.getByLabel('名称',{exact:true})).toBeFocused();
});

test('custom key controls preserve number bounds, calendar focus and saved expiry',async({page})=>{
 const writes=[];
 page.on('request',request=>{if(request.method()!=='GET'&&/\/api\//.test(request.url()))writes.push(request.url())});
 await page.goto('/developer-api/demo');
 const dates=await page.evaluate(()=>{
  const date=new Date();
  const format=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const today=format(date);date.setDate(date.getDate()-1);const yesterday=format(date);
  date.setDate(date.getDate()+2);
  return {today,yesterday,tomorrow:format(date),label:`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`,savedDate:date.toLocaleDateString('zh-CN')};
 });
 await page.getByRole('button',{name:'API Keys',exact:true}).click();
 await page.getByRole('button',{name:'创建 Key',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建演示 Key',exact:true});
 await form.getByLabel('名称',{exact:true}).fill('自定义控件联调');
 const limit=form.getByRole('spinbutton',{name:'每日任务数',exact:true});
 await limit.fill('2');
 await form.getByRole('button',{name:'减少 每日任务数',exact:true}).click();
 await expect(limit).toHaveValue('1');
 await form.getByRole('button',{name:'增加 每日任务数',exact:true}).click();
 await expect(limit).toHaveValue('2');
 await limit.fill('1.5');
 await form.getByRole('button',{name:'增加 每日任务数',exact:true}).click();
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
 await page.getByRole('dialog',{name:'API Key 已创建',exact:true}).getByRole('button',{name:'关闭演示凭据',exact:true}).click();
 await page.getByRole('button',{name:'自定义控件联调',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Key 详情',exact:true})).toContainText(dates.savedDate);
 expect(writes).toEqual([]);
});
