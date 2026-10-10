export interface OrderFinance {
  kind: string; subscriptionId: string | null; receiptConfirmed: boolean; receivedCents: number;
  refundedCents: number | null; netCents: number | null; relatedRefundCents: number;
  refundPendingCents: number; refundNeedsAllocation: boolean; delivery: string;
}
export interface AccountingSummary {
  total: number; confirmedOrders: number; pendingOrders: number; receivedCents: number;
  refundedCents: number; netCents: number | null; unallocatedRefundCents: number; partialRefundCents: number;
}
export interface BillingOrder {
  id: string; userId: string; userEmail: string | null; username?: string; planId: string;
  planName: string | null; planKind: 'topup' | 'subscription' | null; planRevision: number;
  durationDays: number | null; dailyGrantCents: number | null; status: string;
  amountCents: number; providerPayAmountCents: number | null; payAmountCents: number | null;
  grantCents: number; bonusCents: number; provider: string; providerOrderId: string | null;
  paymentMethod: string | null; paidAt: string | null; completedAt: string | null; createdAt: string;
  expiresAt?: string | null; subscriptionStartsAt?: string | null; subscriptionEndsAt?: string | null;
  subscriptionChangeId?: string | null; priceLockEligible?: boolean;
  rechargePolicy?: { pointsPerYuan: number; priceLockMinYuan: number } | null;
  paymentState?: string; checkError?: string | null;
  finance: OrderFinance;
}
type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary';
// Order status as shown to operators. A provider-confirmed payment (paidAt) that
// has not been delivered yet is "到账中" whatever the stored status is.
export function orderStatusMeta(order: Pick<BillingOrder, 'status' | 'paidAt'> & { paymentState?: string }): { label: string; type: TagType } {
  if (order.status !== 'completed' && order.paidAt) return { label: '已收款·到账中', type: 'primary' };
  if (order.status === 'pending' && order.paymentState === 'timed_out') return { label: '待支付·已超时', type: 'warning' };
  const meta: Record<string, { label: string; type: TagType }> = {
    pending: { label: '待支付', type: 'warning' }, completed: { label: '已完成', type: 'success' },
    cancelled: { label: '已取消', type: 'info' }, expired: { label: '已过期', type: 'info' }, failed: { label: '失败', type: 'danger' },
  };
  return meta[order.status] || { label: order.status || '未知', type: 'info' };
}
export const orderKindLabels: Record<string, string> = { topup: '固定额度包', recharge: '自定义充值', subscription: '订阅开通', upgrade: '升级补差价', legacy: '历史记录' };
export const deliveryLabels: Record<string, string> = { delivered: '已发放', pending: '待发放', missing: '缺少发放记录', not_due: '尚未收款' };
export function billingMoney(cents: number | null | undefined) {
  return cents == null ? '待核对' : `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
