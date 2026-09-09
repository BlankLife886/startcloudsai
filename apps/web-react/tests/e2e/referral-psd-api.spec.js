import { expect,test } from '@playwright/test';
import { installVisualBaseline } from './helpers/visualBaseline.js';
import { fulfillJson } from './helpers/authMocks.js';

const user={id:'11111111-1111-4111-8111-111111111111',email:'user@gmail.com',username:'测试用户',role:'user'};
test.beforeEach(async({page})=>{await installVisualBaseline(page);await page.setViewportSize({width:1280,height:720});await page.route('**/api/v1/auth/session',route=>fulfillJson(route,{user}));});

test('invitation shows server rule, private link and reward history',async({page})=>{
  await page.route('**/api/v1/me/referrals**',route=>fulfillJson(route,{code:'1234567890ABCDEF',invitePath:'/auth?ref=1234567890ABCDEF',config:{enabled:true,mode:'percent',percent:10,fixedPoints:10},invitedCount:4,paidCount:2,totalPoints:100,items:[{id:'reward',points:100,basePoints:1000,createdAt:'2026-09-06T00:00:00Z'}],page:1,hasMore:false}));
  await page.goto('/invite');
  await expect(page.getByRole('heading',{name:'邀请好友',exact:true})).toBeVisible();
  await expect(page.getByLabel('邀请链接')).toHaveValue(/ref=1234567890ABCDEF/);
  await expect(page.getByText('好友注册后，每笔充值基础积分计提 10% 返利，月底统一结算')).toBeVisible();
  await expect(page.getByRole('cell',{name:'+100',exact:true})).toBeVisible();
  await page.screenshot({path:'../../.artifacts/invitation-desktop.png',fullPage:true});
});

test('PSD workspace uploads one image and delivers real API artifacts',async({page})=>{
  const conversationId='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
  let submitted=null;
  await page.route('**/api/v1/assistant/config',route=>fulfillJson(route,{editableFilesEnabled:true,chatModel:'chat-pro'}));
  await page.route('**/api/v1/assistant/conversations**',route=>fulfillJson(route,route.request().method()==='POST'?{id:conversationId,title:'PSD 分解 · sample.webp'}:{conversations:[]}));
  await page.route('**/api/v1/uploads',route=>fulfillJson(route,{key:`uploads/${user.id}/original/sample.webp`,url:`/api/v1/files/uploads/${user.id}/original/sample.webp`}));
  await page.route('**/api/v1/assistant/runs',route=>{submitted=route.request().postDataJSON();return fulfillJson(route,{run:{id:runId,conversationId,status:'queued'}})});
  await page.route(`**/api/v1/assistant/runs/${runId}`,route=>fulfillJson(route,{run:{id:runId,conversationId,status:'succeeded',stage:'complete',reservedCents:10},assistantMessage:{content:'分层文件已完成。',artifacts:[{id:'psd',name:'sample.psd',format:'psd',sizeBytes:5000,downloadUrl:'/api/v1/files/uploads/test/original/sample.psd?download=1'}]}}));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/psd-decompose');
  await expect(page.getByRole('heading',{name:'PSD 分解',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始分解',exact:true})).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles('public/sucai/studio-cover-ecom-create.webp');
  await expect(page.getByText('1280 × 853',{exact:true})).toBeVisible();
  await page.getByLabel('拆层要求').fill('主体和背景分别拆层');
  await page.screenshot({path:'../../.artifacts/psd-workspace-desktop.png'});
  await page.getByRole('button',{name:'开始分解',exact:true}).click();
  await expect(page.getByRole('link',{name:/sample.psd/})).toBeVisible();
  expect(submitted.prompt).toContain('PSD');expect(submitted.referenceImages).toHaveLength(1);expect(submitted.idempotencyKey).toBeTruthy();
  await expect(page).toHaveURL(/run=/);
  const left=await page.locator('.psd-inputs').boundingBox(),center=await page.locator('.psd-stage').boundingBox(),right=await page.locator('.psd-delivery').boundingBox();
  expect(left.x+left.width).toBeLessThanOrEqual(center.x+1);expect(center.x+center.width).toBeLessThanOrEqual(right.x+1);
});

test('PSD disabled service cannot submit, API documentation is readable',async({page})=>{
  await page.route('**/api/v1/assistant/config',route=>fulfillJson(route,{editableFilesEnabled:false}));
  await page.goto('/psd-decompose');await expect(page.getByText('PSD 服务暂未开放')).toBeVisible();await expect(page.getByRole('button',{name:'开始分解',exact:true})).toBeDisabled();
  await page.goto('/developer-api/docs');await expect(page.getByRole('heading',{name:'StarClouds Open API',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'查询用量',exact:true})).toBeVisible();
});

test('admin can switch referral modes and save the exclusive rule',async({page})=>{
  test.skip(!process.env.ADMIN_BASE_URL,'Requires admin dev server');let saved=null;
  await page.route('**/api/v1/admin/auth/session',route=>fulfillJson(route,{admin:{...user,role:'admin'}}));
  await page.route('**/api/v1/admin/referral-config',route=>{if(route.request().method()==='PUT'){saved=route.request().postDataJSON();return fulfillJson(route,saved)}return fulfillJson(route,{version:3,settlementCycle:'monthly',enabled:true,mode:'percent',percent:10,fixedPoints:10,minimumAmountCents:100,dailyLimitPoints:1000,firstRewardOnly:false})});
  await page.goto(`${process.env.ADMIN_BASE_URL}/admin/referrals`);
  await page.getByText('固定积分',{exact:true}).click();
  await page.locator('.referral-editor > label').filter({hasText:'每笔充值返还积分'}).getByRole('spinbutton').fill('25');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await expect.poll(()=>saved?.mode).toBe('fixed');expect(saved.fixedPoints).toBe(25);
});

test('Skill catalogue filters, favorites and collects task parameters',async({page})=>{
  await page.goto('/skills');
  await expect(page.getByRole('heading',{name:'Skill 中心',exact:true})).toBeVisible();
  await expect(page.locator('.skill-item')).toHaveCount(5);
  await page.getByRole('tab',{name:'电商',exact:true}).click();
  await expect(page.locator('.skill-item')).toHaveCount(1);
  await page.getByRole('button',{name:'收藏商品主图策划',exact:true}).click();
  await page.getByRole('checkbox',{name:'已收藏',exact:true}).check();
  await expect(page.locator('.skill-item')).toHaveCount(1);
  await page.getByRole('button',{name:'填写参数',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'商品主图策划',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('商品与真实卖点').fill('可折叠旅行水杯');
  await dialog.getByLabel('目标用户').fill('城市通勤者');
  await page.screenshot({path:'../../.artifacts/skill-parameters.png'});
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab',{name:'全部',exact:true}).click();
  await page.getByRole('checkbox',{name:'已收藏',exact:true}).uncheck();
  await page.screenshot({path:'../../.artifacts/skills-catalog.png'});
});
