import assert from 'node:assert/strict';
import test from 'node:test';
import { rechargeCheckoutPlan } from '../src/views/rechargeQuote.js';

const plan = { id: 'custom', priceLockEligible: true, revision: 4, maxRechargeYuan: 100000,
  rechargePolicy: { pointsPerYuan: 100, priceLockMinYuan: 30 } };

test('fixed cards retain their own price and terms', () => {
  const fixed = { id: 'fixed', priceCents: 3000, grantCents: 1000 };
  assert.equal(rechargeCheckoutPlan(fixed), fixed);
});
test('custom card starts at one yuan and updates payment and credits together', () => {
  const one = rechargeCheckoutPlan(plan);
  assert.equal(one.priceCents, 100);
  assert.equal(one.grantCents, 100);
  assert.equal(one.rechargeEligible, false);
  const thirty = rechargeCheckoutPlan(one, '30');
  assert.equal(thirty.priceCents, 3000);
  assert.equal(thirty.grantCents, 3000);
  assert.equal(thirty.rechargeEligible, true);
  assert.equal(thirty.revision, 4);
  assert.equal(plan.priceCents, undefined);
});
test('invalid amounts cannot become payment requests', () => {
  for (const input of ['', '0', '-1', '1.5', '1e2', 'abc', '1001', '100000', '100001']) {
    const quote = rechargeCheckoutPlan(plan, input);
    assert.equal(quote.rechargeAmountYuan, null, input);
    assert.equal(quote.priceCents, 0, input);
    assert.equal(quote.grantCents, 0, input);
  }
});
test('1000 yuan is accepted and stale catalog limits cannot raise the cap', () => {
  for (const maxRechargeYuan of [undefined, 1000, 100000]) {
    const capped = { ...plan, maxRechargeYuan };
    assert.equal(rechargeCheckoutPlan(capped, '1000').priceCents, 100000);
    assert.equal(rechargeCheckoutPlan(capped, '1000').grantCents, 100000);
    assert.equal(rechargeCheckoutPlan(capped, '1001').rechargeAmountYuan, null);
  }
  assert.equal(rechargeCheckoutPlan({ ...plan, maxRechargeYuan: 500 }, '501').rechargeAmountYuan, null);
});
test('disabled lock qualification remains disabled at every amount', () => {
  assert.equal(rechargeCheckoutPlan({ ...plan, priceLockEligible: false }, '100').rechargeEligible, false);
});
test('resumed orders without a catalog limit use their saved conversion rate', () => {
  const quote = rechargeCheckoutPlan({ ...plan, maxRechargeYuan: undefined, rechargePolicy: { pointsPerYuan: 1000000, priceLockMinYuan: 30 } }, '1001');
  assert.equal(quote.rechargeAmountYuan, null);
});
