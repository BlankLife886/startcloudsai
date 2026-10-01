import test from 'node:test';
import assert from 'node:assert/strict';
import { planChanges, versionSummary } from '../src/planHistory.ts';

const entry = (previous,snapshot,extra={}) => ({previous,snapshot,action:'update',...extra});
test('money, daily points, bonus and false values are distinct readable changes', () => {
  const rows = planChanges(entry({price_cents:1990,daily_grant_cents:100,bonus_cents:0,active:true},{price_cents:3990,daily_grant_cents:200,bonus_cents:10,active:false}));
  assert.equal(rows.length,4);
  assert.equal(rows.find(r=>r.key==='price_cents').before,'¥19.90');
  assert.equal(rows.find(r=>r.key==='daily_grant_cents').after,'200 积分');
  assert.equal(rows.find(r=>r.key==='bonus_cents').before,'0 积分');
  assert.equal(rows.find(r=>r.key==='active').after,'已下架');
});
test('scope order is not a change; removed protection and unknown fields remain visible', () => {
  const rows=planChanges(entry({subscription_policy:{channels:['web','api'],lockModelPrices:true}},{subscription_policy:{channels:['api','web'],futureRule:'new'}}));
  assert.equal(rows.length,2);
  assert.equal(rows.find(r=>r.key.endsWith('lockModelPrices')).after,'未记录');
  assert.match(rows.find(r=>r.key.endsWith('futureRule')).label,/其他配置/);
});
test('baseline is not fabricated creation, technical timestamps are ignored', () => {
  assert.equal(versionSummary(entry(null,{price_cents:100},{action:'legacy'})),'最早保留记录');
  assert.equal(versionSummary(entry(null,{price_cents:100},{action:'create'})),'创建套餐');
  assert.equal(planChanges(entry({revision:1,updated_at:'a'},{revision:2,updated_at:'b'})).length,0);
});
test('custom recharge uses minimum amount labels and marks mode transition', () => {
  const rows = planChanges(entry({price_cents:3000,grant_cents:3000},{price_cents:100,grant_cents:100,recharge_policy:{pointsPerYuan:100,priceLockMinYuan:30}}));
  assert.equal(rows.find(r=>r.key==='customAmount').after,'开启');
  assert.match(rows.find(r=>r.key==='price_cents').label,/最低充值/);
  assert.equal(rows.find(r=>r.key.endsWith('priceLockMinYuan')).after,'满 ¥30');
});
test('single operational changes have a direct summary', () => {
  assert.equal(versionSummary(entry({active:true},{active:false})),'下架套餐');
  assert.equal(versionSummary(entry({sort:1},{sort:2})),'调整展示排序');
});
test('user-authored names and model IDs are not translated as enum values', () => {
  const rows=planChanges(entry(null,{name:'web',features:['api'],subscription_policy:{modelIds:['web'],channels:['web']}}));
  assert.equal(rows.find(r=>r.key==='name').after,'web');
  assert.equal(rows.find(r=>r.key==='features').after,'api');
  assert.equal(rows.find(r=>r.key.endsWith('modelIds')).after,'web');
  assert.equal(rows.find(r=>r.key.endsWith('channels')).after,'网站');
});
