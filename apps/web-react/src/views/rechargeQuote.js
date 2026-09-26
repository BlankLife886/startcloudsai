export function rechargeAmountLimit(plan) {
  return Math.min(1000, Number(plan.maxRechargeYuan ?? 1000), Math.floor(1000000000 / Number(plan.rechargePolicy.pointsPerYuan)));
}

export function rechargeCheckoutPlan(plan, input = '1') {
  if (!plan.rechargePolicy) return plan;
  const text = String(input);
  const amount = Number(text);
  const rate = Number(plan.rechargePolicy.pointsPerYuan);
  const limit = rechargeAmountLimit(plan);
  const valid = /^\d+$/.test(text) && Number.isSafeInteger(amount) && amount >= 1 && amount <= limit && Number.isSafeInteger(rate) && rate > 0;
  return {
    ...plan,
    rechargeInput: text,
    rechargeAmountYuan: valid ? amount : null,
    rechargeEligible: Boolean(valid && plan.priceLockEligible && amount >= plan.rechargePolicy.priceLockMinYuan),
    priceCents: valid ? amount * 100 : 0,
    grantCents: valid ? amount * rate : 0,
    bonusCents: 0,
  };
}
