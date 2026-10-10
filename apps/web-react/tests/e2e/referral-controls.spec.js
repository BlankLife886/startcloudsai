import { test,expect } from '@playwright/test';
import { installVisualBaseline } from './helpers/visualBaseline.js';
import { fulfillJson } from './helpers/authMocks.js';

test('registration restores remembered invitation and submits it',async({page})=>{
 await installVisualBaseline(page);
 let submitted;
 await page.route('**/api/v1/referral-attribution',route=>fulfillJson(route,{status:'valid',code:'ABCDEF0123456789',inviterName:'邀请人',expiresAt:'2026-12-01T00:00:00Z',message:'邀请资格已保留，首次注册成功后绑定'}));
 await page.route('**/api/v1/auth/session',route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return fulfillJson(route,{user:{id:'new-user',username:'new'},isNewUser:true,referral:{status:'bound',message:'注册成功，已绑定邀请关系'}})}return fulfillJson(route,{user:null})});
 await page.goto('/auth');
 await expect(page.getByLabel('邀请代码')).toHaveValue('ABCDEF0123456789');
 await page.getByPlaceholder('name@gmail.com').fill('new-user@gmail.com');await page.getByPlaceholder('6 位验证码').fill('123456');
 await page.locator('.auth-submit').click();await expect.poll(()=>submitted?.referralCode).toBe('ABCDEF0123456789');
});

test('registration can explicitly clear remembered invitation',async({page})=>{
 await installVisualBaseline(page);let cleared=false;
 await page.route('**/api/v1/referral-attribution',route=>{if(route.request().method()==='DELETE'){cleared=true;return fulfillJson(route,{status:'none'})}return fulfillJson(route,{status:'valid',code:'ABCDEF0123456789',inviterName:'邀请人',expiresAt:'2026-12-01T00:00:00Z'})});
 await page.goto('/auth');await expect(page.getByLabel('邀请代码')).toHaveValue('ABCDEF0123456789');await page.getByRole('button',{name:'不使用邀请',exact:true}).click();await expect.poll(()=>cleared).toBe(true);await expect(page.getByLabel('邀请代码')).toHaveValue('');
});

const FIRST_CODE = 'ABCDEF0123456789';
const SECOND_CODE = '1234567890ABCDEF';

function validAttribution(code) {
 return {status:'valid',code,inviterName:'邀请人',expiresAt:'2026-12-01T00:00:00Z',message:'邀请资格已保留，首次注册成功后绑定'};
}

async function captureRegistration(page) {
 const state={submitted:null};
 await page.route('**/api/v1/auth/session',route=>{
  if(route.request().method()==='POST'){
   state.submitted=route.request().postDataJSON();
   return fulfillJson(route,{user:{id:'new-user',username:'new'},isNewUser:true});
  }
  return fulfillJson(route,{user:null});
 });
 return state;
}

async function fillRegistration(page) {
 await page.getByPlaceholder('name@gmail.com').fill('new-user@gmail.com');
 await page.getByPlaceholder('6 位验证码').fill('123456');
}

test('changing the inviter survives refresh without replaying the original link',async({page})=>{
 await installVisualBaseline(page);
 let remembered='',posts=[];
 await page.route('**/api/v1/referral-attribution',route=>{
  if(route.request().method()==='POST'){
   remembered=route.request().postDataJSON().code;
   posts.push(remembered);
  }
  return fulfillJson(route,remembered?validAttribution(remembered):{status:'none'});
 });
 await page.goto(`/auth?ref=${FIRST_CODE}&redirect=%2Finvite`);
 await expect(page.getByLabel('邀请代码')).toHaveValue(FIRST_CODE);
 await expect(page).toHaveURL(url=>!url.searchParams.has('ref')&&url.searchParams.get('redirect')==='/invite');
 await page.getByLabel('邀请代码').fill(SECOND_CODE);
 await page.getByRole('button',{name:'校验邀请码',exact:true}).click();
 await expect.poll(()=>remembered).toBe(SECOND_CODE);
 await expect(page.getByText('邀请资格已保留，首次注册成功后绑定',{exact:true})).toBeVisible();
 const postCount=posts.length;
 await page.reload();
 await expect(page.getByLabel('邀请代码')).toHaveValue(SECOND_CODE);
 expect(posts).toHaveLength(postCount);
});

test('opting out survives refresh even when the device-cookie clear fails',async({page})=>{
 await installVisualBaseline(page);
 const registration=await captureRegistration(page);
 let posts=0,deletes=0;
 await page.route('**/api/v1/referral-attribution',route=>{
  if(route.request().method()==='DELETE'){
   deletes+=1;
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'暂时无法清除'})});
  }
  if(route.request().method()==='POST')posts+=1;
  return fulfillJson(route,validAttribution(FIRST_CODE));
 });
 await page.goto(`/auth?ref=${FIRST_CODE}&redirect=%2Finvite`);
 await expect(page).toHaveURL(url=>!url.searchParams.has('ref'));
 await page.getByRole('button',{name:'不使用邀请',exact:true}).click();
 await expect(page).toHaveURL(url=>url.searchParams.get('skipReferral')==='1'&&!url.searchParams.has('ref'));
 await expect(page.getByText('本次注册已跳过邀请；设备记录暂未清除，可重试清除',{exact:true})).toBeVisible();
 const postCount=posts;
 await page.reload();
 await expect(page.getByLabel('邀请代码')).toHaveValue('');
 await expect.poll(()=>deletes).toBeGreaterThanOrEqual(2);
 await fillRegistration(page);
 await page.locator('.auth-submit').click();
 await expect.poll(()=>registration.submitted?.skipReferral).toBe(true);
 expect(registration.submitted.referralCode).toBe('');
 expect(posts).toBe(postCount);
});

test('pending optional attribution does not block email authentication',async({page})=>{
 await installVisualBaseline(page);
 const registration=await captureRegistration(page);
 let release;
 const pending=new Promise(resolve=>{release=resolve});
 await page.route('**/api/v1/referral-attribution',async route=>{
  await pending;
  await fulfillJson(route,validAttribution(FIRST_CODE)).catch(()=>{});
 });
 try{
  await page.goto('/auth');
  await fillRegistration(page);
  await expect(page.locator('.auth-submit')).toBeEnabled();
  await page.locator('.auth-submit').click();
  await expect.poll(()=>registration.submitted).not.toBeNull();
  // The server can restore its signed Cookie without the preview response.
  expect(registration.submitted).toMatchObject({referralCode:'',skipReferral:false});
 }finally{release()}
});

test('opting out takes effect while the optional clear is still pending',async({page})=>{
 await installVisualBaseline(page);
 const registration=await captureRegistration(page);
 let release;
 const pending=new Promise(resolve=>{release=resolve});
 await page.route('**/api/v1/referral-attribution',async route=>{
  await pending;
  await fulfillJson(route,route.request().method()==='DELETE'?{status:'none'}:validAttribution(FIRST_CODE)).catch(()=>{});
 });
 try{
  await page.goto(`/auth?ref=${FIRST_CODE}`);
  await expect(page.getByText('正在校验邀请资格…',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'不使用邀请',exact:true}).click();
  await expect(page).toHaveURL(url=>url.searchParams.get('skipReferral')==='1'&&!url.searchParams.has('ref'));
  await expect(page.getByText('已选择不使用邀请，本次注册不会绑定邀请人',{exact:true})).toBeVisible();
  await fillRegistration(page);
  await page.locator('.auth-submit').click();
  await expect.poll(()=>registration.submitted?.skipReferral).toBe(true);
  expect(registration.submitted.referralCode).toBe('');
 }finally{release()}
});

test('invitation preview times out and preserves the explicit registration code',async({page})=>{
 await installVisualBaseline(page);
 const registration=await captureRegistration(page);
 let release;
 const pending=new Promise(resolve=>{release=resolve});
 await page.route('**/api/v1/referral-attribution',async route=>{
  await pending;
  await fulfillJson(route,validAttribution(FIRST_CODE)).catch(()=>{});
 });
 try{
  await page.goto(`/auth?ref=${FIRST_CODE}`);
  await expect(page.getByText('邀请资格校验超时，可直接验证邮箱，是否绑定以注册结果为准',{exact:true})).toBeVisible({timeout:8000});
  await expect(page.getByLabel('邀请代码')).toHaveValue(FIRST_CODE);
  await fillRegistration(page);
  await page.locator('.auth-submit').click();
  await expect.poll(()=>registration.submitted?.referralCode).toBe(FIRST_CODE);
  expect(registration.submitted.skipReferral).toBe(false);
 }finally{release()}
});

test('admin cannot refresh stale referral settings while a save is pending',async({page})=>{
 test.skip(!process.env.ADMIN_BASE_URL,'Requires admin dev server');
 await installVisualBaseline(page);
 await page.route('**/api/v1/admin/auth/session',route=>fulfillJson(route,{admin:{id:'11111111-1111-4111-8111-111111111111',email:'admin@example.com',username:'管理员',role:'admin'}}));
 let config={version:3,settlementCycle:'monthly',enabled:true,mode:'percent',percent:10,fixedPoints:10,minimumAmountCents:100,dailyLimitPoints:1000,firstRewardOnly:false};
 let reads=0,saveStarted=false,release;
 const pending=new Promise(resolve=>{release=resolve});
 await page.route('**/api/v1/admin/referral-config',async route=>{
  if(route.request().method()==='PUT'){
   saveStarted=true;
   const saved=route.request().postDataJSON();
   await pending;
   config=saved;
   await fulfillJson(route,config);
   return;
  }
  reads+=1;
  await fulfillJson(route,config);
 });
 try{
  await page.goto(`${process.env.ADMIN_BASE_URL}/admin/referrals`);
  await page.getByText('固定积分',{exact:true}).click();
  const points=page.locator('.referral-editor > label').filter({hasText:'每笔充值返还积分'}).getByRole('spinbutton');
  await points.fill('25');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await expect.poll(()=>saveStarted).toBe(true);
  await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeDisabled();
  expect(reads).toBe(1);
  release();
  await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await expect(points).toHaveValue('25');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect.poll(()=>reads).toBe(2);
  await expect(points).toHaveValue('25');
 }finally{release()}
});
