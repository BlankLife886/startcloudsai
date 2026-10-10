import assert from 'node:assert/strict';
import test from 'node:test';
import { upgradeBlockReason, upgradeComparison } from '../src/views/subscriptionUpgrade.js';
const policy={series:'general',tier:1,channels:['web','api'],featureKeys:[],modelIds:[],concurrencyBonus:2,lockModelPrices:true,allowTopupPriceLock:true};
const source={id:'sub',planId:'old',status:'active',canChange:true,dailyPoints:100,policy,contract:policy};
const target={id:'new',kind:'subscription',dailyGrantCents:200,durationDays:7,subscriptionPolicy:{...policy,tier:2,concurrencyBonus:4}};
test('cross-duration upgrade can cover all purchased rights',()=>assert.equal(upgradeBlockReason(source,target),''));
test('current, lower-tier, other-series and equal-daily plans cannot be upgraded to',()=>{
  for(const patch of [{id:'old'},{dailyGrantCents:100},{subscriptionPolicy:{...policy,tier:1}},{subscriptionPolicy:{...policy,series:'other',tier:2}}]) assert.ok(upgradeBlockReason(source,{...target,...patch}));
});
test('cannot reduce protected price, concurrency or scopes',()=>{
  for(const patch of [{channels:['web']},{featureKeys:['text_to_image']},{modelIds:['one']},{concurrencyBonus:1},{lockModelPrices:false},{allowTopupPriceLock:false}]) assert.ok(upgradeBlockReason(source,{...target,subscriptionPolicy:{...target.subscriptionPolicy,...patch}}));
});
test('refund reviews and pending upgrades block changes, rejected changes do not',()=>{
  for(const status of ['reviewing','processing','pending']) assert.ok(upgradeBlockReason(source,target,[{subscriptionId:'sub',status}]));
  assert.equal(upgradeBlockReason(source,target,[{subscriptionId:'sub',status:'rejected'}]),'');
  assert.ok(upgradeBlockReason({...source,status:'cancelled'},target));
  assert.ok(upgradeBlockReason({...source,canChange:false},target));
});
test('upgrade comparison uses captured old rights and distinguishes actual changes',()=>{
  const rows=upgradeComparison({dailyPoints:500,durationDays:30,contract:{concurrencyBonus:8,lockModelPrices:true,allowTopupPriceLock:true},sourcePlan:{dailyPoints:200,durationDays:3,contract:{concurrencyBonus:4,lockModelPrices:true,allowTopupPriceLock:true}}});
  assert.deepEqual(rows.map(row=>[row.key,row.before,row.after,row.changed]),[
    ['daily','200 积分','500 积分',true],['duration','3 天','30 天',true],['concurrency','+4','+8',true],['protection','订阅及合格额度包','订阅及合格额度包',false],
  ]);
});
test('missing old records are not invented; zero bonus and real-time prices remain meaningful',()=>{
  const rows=upgradeComparison({dailyPoints:100,durationDays:3,contract:{concurrencyBonus:0,lockModelPrices:false}});
  assert.ok(rows.every(row=>row.before==='未记录' && !row.changed));
  assert.equal(rows.find(row=>row.key==='concurrency').after,'+0');
  assert.equal(rows.find(row=>row.key==='protection').after,'按实时价格');
});
test('all recorded scopes appear and reordered scopes remain unchanged',()=>{
  const rows=upgradeComparison({policy:{channels:['api','web'],featureKeys:[],modelIds:[]},sourcePlan:{policy:{channels:['web','api'],featureKeys:['text_to_image'],modelIds:['model-one']}}});
  assert.equal(rows.find(row=>row.key==='channels').changed,false);
  assert.equal(rows.find(row=>row.key==='featureKeys').after,'全部场景');
  assert.equal(rows.find(row=>row.key==='modelIds').before,'model-one');
});
test('comparison uses saved full plan prices, not the payable upgrade difference',()=>{
  const row=upgradeComparison({priceCents:12990,sourcePlan:{priceCents:2990}}).find(row=>row.key==='price');
  assert.deepEqual([row.before,row.after,row.changed],['¥29.90','¥129.90',true]);
  assert.equal(upgradeComparison({priceCents:12990}).find(row=>row.key==='price').before,'未记录');
});
