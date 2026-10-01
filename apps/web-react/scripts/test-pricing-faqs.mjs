import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPricingFaqs } from '../src/views/pricingFaqData.js';

const sub = (id, hours) => ({ id, name: id, kind: 'subscription', durationDays: 7, dailyGrantCents: 500,
  subscriptionPolicy: { refundWindowHours: hours, concurrencyBonus: 2, lockModelPrices: true, allowTopupPriceLock: true } });
const pack = { id:'pack', name:'标准额度包', kind:'topup', priceCents:3000, grantCents:3000, bonusCents:0, priceLockEligible:true };
const catalog = { items:[pack, sub('短期方案',3),sub('长期方案',12),sub('关闭窗口',0)],baseConcurrency:7,paymentEnabled:true,paymentMethods:['wechat'] };
const faq = (id, options = {}) => buildPricingFaqs({catalog,status:'ready',...options}).find(f => f.id === id);
const values = item => item.facts.map(f => `${f.label}：${f.value}`).join('\n');

test('price protection, concurrency and payment use catalog values', () => {
  assert.equal(faq('custom-recharge'), undefined);
  assert.match(values(faq('topup-protection')), /标准额度包：有效合格订阅下可接受锁价/);
  assert.match(values(faq('contract-concurrency')), /平台基础并发：7/);
  assert.match(values(faq('contract-concurrency')), /图片上限 9/);
  assert.match(values(faq('buy')), /支持微信支付/);
  assert.doesNotMatch(values(faq('buy')), /支付宝/);
  assert.match(values(faq('plan-difference')), /完整 7 天，每天重置为 500 积分/);
});

test('mixed refund windows, including zero, stay associated with each plan', () => {
  const text = values(faq('unused-refund'));
  assert.match(text, /短期方案：开通后 3 小时/);
  assert.match(text, /长期方案：开通后 12 小时/);
  assert.match(text, /关闭窗口：未启用未使用全退窗口/);
});

test('rebuilding after catalog changes updates all facts without mutating the catalog', () => {
  const original = structuredClone(catalog);
  const changed = structuredClone(catalog);
  changed.items[0].priceLockEligible=false;
  changed.items[1].subscriptionPolicy.refundWindowHours=6;
  changed.baseConcurrency=10;
  assert.match(values(faq('topup-protection',{catalog:changed})), /不接受订阅锁价/);
  assert.match(values(faq('unused-refund',{catalog:changed})), /短期方案：开通后 6 小时/);
  assert.match(values(faq('contract-concurrency',{catalog:changed})), /图片上限 12/);
  assert.deepEqual(catalog,original);
});

test('purchased and historical terms are never replaced by the current catalog', () => {
  const saved={planName:'短期方案',billingVersion:2,status:'refunding',policy:{refundWindowHours:24,concurrencyBonus:6,lockModelPrices:false}};
  const result=faq('unused-refund',{subscription:saved});
  assert.match(values(result), /短期方案：开通后 3 小时/);
  assert.match(result.purchasedFacts[0].value, /24 小时/);
  assert.match(faq('contract-pricing',{subscription:saved}).purchasedFacts[0].value, /实时价格/);
  assert.match(faq('unused-refund',{subscription:{...saved,policy:{}}}).purchasedFacts[0].value, /24 小时/);
  assert.match(faq('unused-refund',{subscription:{...saved,billingVersion:1}}).purchasedFacts[0].value, /历史权益/);
});

test('loading, unavailable and empty catalogs never masquerade as current defaults', () => {
  for (const status of ['loading','error']) {
    for (const id of ['topup-protection','unused-refund','contract-concurrency','buy']) {
      const item=faq(id,{status});
      assert.deepEqual(item.facts,[]);
      assert.ok(item.notice);
    }
  }
  const empty={items:[],paymentEnabled:false,paymentMethods:['alipay']};
  assert.match(faq('topup-protection',{catalog:empty}).notice,/没有在售额度包/);
  assert.match(values(faq('buy',{catalog:empty})),/暂未开放/);
  assert.doesNotMatch(values(faq('buy',{catalog:empty})),/支持支付宝/);
  assert.match(values(faq('buy',{catalog:{items:[],paymentEnabled:true,paymentMethods:'alipay'}})),/暂未确认/);
});

test('inactive plans and invalid values do not produce advertised entitlements', () => {
  const invalid={items:[{...pack,active:false},sub('bad',9999)]};
  assert.doesNotMatch(values(faq('topup-protection',{catalog:invalid})),/标准额度包/);
  assert.match(values(faq('unused-refund',{catalog:invalid})),/规则暂未确认/);
});

test('numeric examples are explicit assumptions rather than current quotes', () => {
  for (const id of ['contract-pricing','plan-difference','spend-order','period','upgrade']) {
    assert.ok(faq(id).paragraphs.some(p=>p.includes('假设示例')),id);
  }
});
