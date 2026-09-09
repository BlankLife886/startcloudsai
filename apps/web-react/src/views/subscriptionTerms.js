// Old saved policies without this field use the server's legacy 24-hour rule.
// New plans carry an explicit configured value, including 0 for a disabled window.
export function subscriptionRefundHours(policy = {}) {
  const hours = policy.refundWindowHours ?? 24;
  return Number.isSafeInteger(hours) && hours >= 0 && hours <= 720 ? hours : null;
}
