// Old saved policies without this field use the server's legacy 24-hour rule.
// New plans carry an explicit configured value, including 0 for a disabled window.
export function subscriptionRefundHours(policy = {}) {
  const hours = policy.refundWindowHours ?? 24;
  return Number.isSafeInteger(hours) && hours >= 0 && hours <= 720 ? hours : null;
}

// Quota rights a subscription adds on top of the site-wide base (from /plans).
// Shows the resulting limit when the base is known, otherwise only a real bonus.
export function subscriptionQuotaRights(policy = {}, bases = {}) {
  return [
    ['图片并发', bases.concurrency, policy.concurrencyBonus, '张'],
    ['画布项目', bases.canvasProjects, policy.canvasProjectBonus, '个'],
    ['助手对话', bases.assistantConversations, policy.assistantConversationBonus, '个'],
  ].flatMap(([label, base, rawBonus, unit]) => {
    const bonus = rawBonus > 0 ? rawBonus : 0;
    if (!(base >= 0)) return bonus ? [{ label, value: `+${bonus} ${unit}`, text: `${label} +${bonus} ${unit}` }] : [];
    const value = bonus ? `${base + bonus} ${unit}（订阅 +${bonus}）` : `${base} ${unit}`;
    return [{ label, value, text: `${label} ${value}` }];
  });
}
