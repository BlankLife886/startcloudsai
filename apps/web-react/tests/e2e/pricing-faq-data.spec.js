import { test, expect } from '@playwright/test';
import { installVisualBaseline } from './helpers/visualBaseline.js';
import { fulfillJson } from './helpers/authMocks.js';

async function setup(page) {
  await installVisualBaseline(page);
  const state = { fail:false, catalog:{ baseConcurrency:6,paymentEnabled:true,paymentMethods:['wechat'],items:[
    {id:'recharge',name:'灵活充值',kind:'topup',priceCents:100,grantCents:250,maxRechargeYuan:1000,priceLockEligible:true,rechargePolicy:{pointsPerYuan:250,priceLockMinYuan:60}},
    {id:'sub',name:'周度方案',kind:'subscription',revision:2,priceCents:3990,dailyGrantCents:500,durationDays:7,subscriptionPolicy:{refundWindowHours:3,concurrencyBonus:2,lockModelPrices:true}},
    {id:'other',name:'灵活方案',kind:'subscription',revision:1,priceCents:6990,dailyGrantCents:800,durationDays:7,subscriptionPolicy:{refundWindowHours:0,concurrencyBonus:4,lockModelPrices:false}},
  ]}};
  await page.route('**/api/v1/auth/session',r=>fulfillJson(r,{user:{id:'faq-user',email:'faq@example.com'}}));
  await page.route('**/api/v1/plans',r=>state.fail?r.fulfill({status:503,json:{success:false,error:'暂不可用'}}):fulfillJson(r,state.catalog));
  await page.route('**/api/v1/pricing',r=>fulfillJson(r,{}));
  await page.route('**/api/v1/runtime-config',r=>fulfillJson(r,{features:{}}));
  await page.route('**/api/v1/orders?*',r=>fulfillJson(r,{items:[]}));
  await page.route('**/api/v1/me/subscription',r=>fulfillJson(r,{active:true,id:'old',planId:'sub',blockingPurchase:true}));
  await page.route('**/api/v1/me/subscriptions',r=>fulfillJson(r,{items:[{id:'old',planId:'sub',planName:'周度方案',billingVersion:2,status:'active',policy:{refundWindowHours:24,concurrencyBonus:1,lockModelPrices:true}}],changes:[],concurrency:{imageLimit:7,chatLimit:4}}));
  return state;
}

async function openQuestion(page, name) {
  const faq=page.locator('#pricing-faq');
  await faq.getByRole('button',{name,exact:true}).click();
  return faq.locator('.pp-faq__item.is-open');
}

test('FAQ follows changes to recharge rules, payment methods and search results',async({page})=>{
  const state=await setup(page);
  await page.goto('/pricing');
  let answer=await openQuestion(page,'可以自定义充值金额吗？最低充值多少？');
  await expect(answer).toContainText('1–1,000 元');
  await expect(answer).toContainText('250 积分');
  state.catalog.items[0].rechargePolicy.pointsPerYuan=80;
  state.catalog.items[0].rechargePolicy.priceLockMinYuan=120;
  state.catalog.paymentMethods=['alipay'];
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(answer).toContainText('80 积分');
  await expect(answer).not.toContainText('250 积分');
  answer=await openQuestion(page,'现在可以购买套餐吗？');
  await expect(answer.locator('.pp-faq__facts')).toContainText('支持支付宝');
  await expect(answer.locator('.pp-faq__facts')).not.toContainText('微信支付');
  const search=page.getByRole('searchbox',{name:'搜索购买与计费问题'});
  await search.fill('满 120 元');
  await expect(page.locator('#pricing-faq .pp-faq__item')).toHaveCount(1);
  await expect(page.locator('#pricing-faq .pp-faq__item')).toContainText('所有额度包都享受订阅锁价吗？');
});

test('FAQ separates purchased terms from new plan rules and handles unavailable config',async({page})=>{
  const state=await setup(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/pricing');
  const answer=await openQuestion(page,'买错订阅且没用过积分，可以退款吗？');
  await expect(answer.locator('.pp-faq__facts').first()).toContainText('开通后 3 小时');
  await expect(answer.locator('.pp-faq__facts').first()).toContainText('未启用未使用全退窗口');
  await expect(answer.locator('.is-purchased')).toContainText('开通后 24 小时');
  const layout=await answer.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,overflow:[...el.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({tag:n.tagName,className:n.className,width:n.clientWidth,scroll:n.scrollWidth,display:getComputedStyle(n).display,columns:getComputedStyle(n).gridTemplateColumns}))}));
  expect(layout.scroll,JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  state.catalog.items[1].subscriptionPolicy.refundWindowHours=6;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(answer.locator('.pp-faq__facts').first()).toContainText('开通后 6 小时');
  await expect(answer.locator('.is-purchased')).toContainText('开通后 24 小时');
  state.fail=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(answer).toContainText('当前规则暂时无法读取');
  await expect(answer.locator('.pp-faq__facts:not(.is-purchased)')).toHaveCount(0);
  await expect(answer.locator('.is-purchased')).toContainText('24 小时');
  state.fail=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(answer).not.toContainText('当前规则暂时无法读取');
  await expect(answer.locator('.pp-faq__facts').first()).toContainText('开通后 6 小时');
});
