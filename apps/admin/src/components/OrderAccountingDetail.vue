<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { CopyDocument, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { request, isRequestAborted } from '@/request';
import { billingMoney, deliveryLabels, orderKindLabels, orderStatusMeta, type BillingOrder } from '@/billingTypes';
import { formatPoints, formatTime } from '@/utils';
import SubscriptionAuditTrail from './SubscriptionAuditTrail.vue';

interface Detail extends BillingOrder {
  planSnapshot: Record<string, any> | null;
  benefitRecord: { id: string; priceBookId: string; concurrencyBonus: number; lockModelPrices: boolean; allowTopupPriceLock: boolean } | null;
  upgrade: { snapshot: { sourcePlan?: { planName: string }; planName: string; priceCents: number; upgradeCredit?: { creditCents: number; timeValueCents: number; unusedValueCents: number; reclaimPoints: number } } } | null;
  changes: { id: string; kind: string; status: string; amountCents: number; publicMessage: string; createdAt: string; snapshot?: { manualRefund?: boolean } }[];
  timeline: { at: string; title: string; detail: string; actor: string }[];
  timelineHasMore: boolean; changesHasMore: boolean;
  currentSubscription?: { id: string; planName: string; status: string };
  apiSpentPoints?: number;
}
const props = defineProps<{ orderId: string }>();
const emit = defineEmits<{ loaded: [order: BillingOrder] }>();
const router = useRouter();
const data = ref<Detail | null>(null), loading = ref(false), error = ref('');
const chainVisible=ref(false);
let controller: AbortController | undefined;
async function load() {
  controller?.abort(); const own = new AbortController(); controller = own;
  loading.value = true; error.value = ''; data.value = null;
  try {
    const result = await request<Detail>(`/api/v1/admin/orders/${props.orderId}`, { signal: own.signal, silent: true });
    if (!own.signal.aborted) { data.value = result; emit('loaded', result); }
  } catch (e) { if (controller === own && !own.signal.aborted && !isRequestAborted(e)) error.value = e instanceof Error ? e.message : '订单详情读取失败'; }
  finally { if (controller === own) loading.value = false; }
}
watch(() => props.orderId, () => {chainVisible.value=false;load()}, { immediate: true });
onBeforeUnmount(() => controller?.abort());
const changeLabel = (status: string) => ({ reviewing:'审核中',processing:'退款处理中',completed:'已完成',rejected:'已驳回',pending:'待支付',cancelled:'已取消' }[status] || status);
const subscriptionLabel = (status?:string) => ({active:'生效中',refunding:'退订处理中',cancelled:'已退订',expired:'已到期'}[status || ''] || '未关联');
function changes(id: string) { router.push({ path: '/subscription-changes', query: { search: id } }); }
async function copy(value:string){try{await navigator.clipboard.writeText(value);ElMessage.success('已复制')}catch{ElMessage.error('复制失败，请手动选择复制')}}
const outcomeLabels: Record<string,string> = { matched:'与渠道一致', repaired:'渠道已收款，已补齐到账', closed:'已按渠道状态关闭', provider_error:'渠道查询失败', provider_id_missing:'没有云端订单号', identity_or_amount_mismatch:'渠道订单信息不一致', repair_failed:'已收款但发放失败' };
const verifying = ref(false);
// Asks the provider for the live state now; a paid order is delivered on the spot.
async function verify(providerOrderId?: string) {
  if (!data.value || verifying.value) return;
  verifying.value = true;
  try {
    const body = providerOrderId ? { orderId: data.value.id, providerOrderId } : { orderId: data.value.id, resolution: 'check' };
    const result = await request<{ result: { outcome: string; detail?: string | null } }>('/api/v1/admin/payment-reconciliations/run', { method: 'POST', body, silent: true });
    const outcome = result.result?.outcome || '';
    ElMessage({ type: ['matched','repaired','closed'].includes(outcome) ? 'success' : 'warning', message: `${outcomeLabels[outcome] || outcome}${result.result?.detail ? '：' + result.result.detail : ''}`, duration: 6000 });
    await load();
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '核实失败'); }
  finally { verifying.value = false; }
}
async function attachProviderOrder() {
  try {
    const { value } = await ElMessageBox.prompt('在蓝鲸后台找到这笔订单（商户订单号即平台订单号），填入它的云端订单号。系统会先向渠道校验订单号、金额一致后再关联。', '关联云端订单号', { inputPattern: /^\S{1,128}$/, inputErrorMessage: '请输入云端订单号', confirmButtonText: '校验并关联', cancelButtonText: '取消' });
    await verify(value.trim());
  } catch { /* cancelled */ }
}
</script>

<template>
  <div v-loading="loading" class="accounting-detail">
    <div class="accounting-detail__toolbar"><span>订单详情</span><div><el-button v-if="data && data.provider === 'lanjing' && data.status !== 'completed'" size="small" type="primary" :loading="verifying" @click="verify()">向渠道核实</el-button><el-button v-if="data && data.provider === 'lanjing' && !data.providerOrderId && data.status !== 'completed'" size="small" :disabled="verifying" @click="attachProviderOrder">关联云端订单号</el-button><el-button v-if="data?.finance.subscriptionId && data.status==='completed'" size="small" @click="chainVisible=!chainVisible">{{ chainVisible?'返回订单详情':'完整订阅链路' }}</el-button><el-button :icon="Refresh" size="small" :loading="loading" @click="load">刷新</el-button></div></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="data">
      <SubscriptionAuditTrail v-if="chainVisible" :order-id="data.id" :revision="0" />
      <template v-else>
      <div class="accounting-detail__money">
        <div><small>订单金额</small><strong>{{ billingMoney(data.amountCents) }}</strong></div>
        <div><small>确认实收</small><strong>{{ billingMoney(data.finance.receivedCents) }}</strong></div>
        <div><small>本单已退</small><strong>{{ billingMoney(data.finance.refundedCents) }}</strong></div>
        <div><small>本单净收款</small><strong>{{ billingMoney(data.finance.netCents) }}</strong></div>
      </div>
      <el-alert v-if="data.finance.refundNeedsAllocation" type="warning" :closable="false" :title="`关联订阅已确认退款 ${billingMoney(data.finance.relatedRefundCents)}，但未记录逐单归属；此金额不能重复计入每笔付款。`" />
      <el-alert v-if="data.apiSpentPoints" type="info" :closable="false" :title="`本单积分中已有 ${formatPoints(data.apiSpentPoints)} 用于API 调用。API 消费不显示在用户钱包明细里，只在API 调用控制台的调用记录中；退款核算时按已使用计入。`" />
      <el-alert v-if="data.checkError" type="warning" :closable="false" :title="`最近一次向渠道查询失败：${data.checkError}`" />
      <el-alert v-if="data.status !== 'completed' && data.paidAt" type="error" :closable="false" title="渠道已确认收款，但权益尚未发放。系统会自动重试；如持续失败请查看处理时间线中的原因。" />
      <el-alert v-if="data.finance.delivery === 'missing'" type="error" :closable="false" title="订单已完成，但未找到对应的权益发放记录，请核查积分流水或订阅记录。" />
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="用户"><el-button link type="primary" @click="router.push({path:'/users',query:{userId:data.userId,search:data.userEmail || data.userId}})">{{ data.username || data.userEmail }}</el-button></el-descriptions-item>
        <el-descriptions-item label="订单状态"><el-tag :type="orderStatusMeta(data).type" size="small">{{ orderStatusMeta(data).label }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="订单类型">{{ orderKindLabels[data.finance.kind] }}</el-descriptions-item>
        <el-descriptions-item label="支付方式">{{ data.paymentMethod === 'alipay' ? '支付宝' : data.paymentMethod === 'wechat' ? '微信支付' : '未记录' }}</el-descriptions-item>
        <el-descriptions-item label="渠道应付">{{ billingMoney(data.providerPayAmountCents ?? data.amountCents) }}</el-descriptions-item>
        <el-descriptions-item label="到账状态">{{ deliveryLabels[data.finance.delivery] }}</el-descriptions-item>
        <el-descriptions-item label="购买时套餐">{{ data.planName || '历史未记录' }}</el-descriptions-item>
        <el-descriptions-item label="套餐版本">{{ data.planRevision ? `v${data.planRevision}` : '历史未记录' }}</el-descriptions-item>
        <template v-if="data.planKind === 'topup'">
          <el-descriptions-item label="购买积分">{{ formatPoints(data.grantCents) }}</el-descriptions-item>
          <el-descriptions-item label="赠送积分">{{ formatPoints(data.bonusCents) }}</el-descriptions-item>
          <el-descriptions-item label="购买时比例">{{ data.rechargePolicy ? `每1元 ${data.rechargePolicy.pointsPerYuan} 积分` : '固定额度包，以本单积分为准' }}</el-descriptions-item>
          <el-descriptions-item label="本批次锁价资格">{{ data.priceLockEligible ? '接受符合资格的订阅锁价' : '不接受订阅锁价' }}</el-descriptions-item>
          <el-descriptions-item v-if="data.rechargePolicy" label="购买时门槛">单笔 {{ data.rechargePolicy.priceLockMinYuan }} 元</el-descriptions-item>
        </template>
        <template v-else-if="data.planKind === 'subscription'">
          <el-descriptions-item label="购买周期">{{ data.durationDays }} 天 · 每24小时 {{ formatPoints(data.dailyGrantCents || 0) }} 积分</el-descriptions-item>
          <el-descriptions-item label="本次生效时间">{{ formatTime(data.subscriptionStartsAt) }}</el-descriptions-item>
          <el-descriptions-item label="本次到期时间">{{ formatTime(data.subscriptionEndsAt) }}</el-descriptions-item>
          <el-descriptions-item label="当前订阅">{{ data.currentSubscription?.planName || '未关联' }} · {{ subscriptionLabel(data.currentSubscription?.status) }}</el-descriptions-item>
        </template>
        <template v-if="data.benefitRecord">
          <el-descriptions-item label="额外图片并发">+{{ data.benefitRecord.concurrencyBonus }} 张</el-descriptions-item>
          <el-descriptions-item label="价格保护">{{ data.benefitRecord.lockModelPrices ? data.benefitRecord.allowTopupPriceLock ? '订阅及合格额度包' : '仅订阅积分' : '实时价格' }}</el-descriptions-item>
          <el-descriptions-item label="权益编号" :span="2">{{ data.benefitRecord.id }}</el-descriptions-item>
          <el-descriptions-item label="价格版本" :span="2">{{ data.benefitRecord.priceBookId }}</el-descriptions-item>
        </template>
        <el-descriptions-item v-else-if="data.planKind === 'subscription'" label="价格保护记录" :span="2">本次购买的历史记录不完整，不以当前套餐配置代替。</el-descriptions-item>
        <el-descriptions-item label="平台订单号" :span="2">{{ data.id }}<el-button text :icon="CopyDocument" title="复制平台订单号" aria-label="复制平台订单号" @click="copy(data.id)" /></el-descriptions-item>
        <el-descriptions-item label="云端订单号" :span="2">{{ data.providerOrderId || '未记录' }}<el-button v-if="data.providerOrderId" text :icon="CopyDocument" title="复制渠道订单号" aria-label="复制渠道订单号" @click="copy(data.providerOrderId)" /></el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatTime(data.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="支付时间">{{ formatTime(data.paidAt) }}</el-descriptions-item>
        <el-descriptions-item label="完成时间">{{ formatTime(data.completedAt) }}</el-descriptions-item>
        <el-descriptions-item label="支付截止">{{ formatTime(data.expiresAt) }}</el-descriptions-item>
      </el-descriptions>
      <template v-if="data.upgrade">
        <h3>升级明细</h3>
        <p>{{ data.upgrade.snapshot.sourcePlan?.planName || '原套餐未记录' }} → {{ data.upgrade.snapshot.planName }}</p>
        <el-descriptions v-if="data.upgrade.snapshot.upgradeCredit" :column="2" border size="small">
          <el-descriptions-item label="新套餐原价">{{ billingMoney(data.upgrade.snapshot.priceCents) }}</el-descriptions-item>
          <el-descriptions-item label="旧权益抵扣">{{ billingMoney(data.upgrade.snapshot.upgradeCredit.creditCents) }}</el-descriptions-item>
          <el-descriptions-item label="剩余时间价值">{{ billingMoney(data.upgrade.snapshot.upgradeCredit.timeValueCents) }}</el-descriptions-item>
          <el-descriptions-item label="未消耗权益价值">{{ billingMoney(data.upgrade.snapshot.upgradeCredit.unusedValueCents) }}</el-descriptions-item>
          <el-descriptions-item label="回收旧积分">{{ data.upgrade.snapshot.upgradeCredit.reclaimPoints }}</el-descriptions-item>
        </el-descriptions>
      </template>
      <h3>关联订阅变更</h3>
      <el-table :data="data.changes" size="small" max-height="260">
        <el-table-column label="事项"><template #default="{ row }">{{ row.kind === 'upgrade' ? '升级' : row.snapshot?.manualRefund ? '人工例外退款' : '退订退款' }}</template></el-table-column>
        <el-table-column label="状态"><template #default="{ row }">{{ changeLabel(row.status) }}</template></el-table-column>
        <el-table-column label="金额"><template #default="{ row }">{{ billingMoney(row.amountCents) }}</template></el-table-column>
        <el-table-column label="详情" width="80"><template #default="{ row }"><el-button link type="primary" @click="changes(row.id)">查看</el-button></template></el-table-column>
      </el-table>
      <el-button v-if="data.changesHasMore && data.finance.subscriptionId" link type="primary" @click="changes(data.finance.subscriptionId)">查看全部变更</el-button>
      <h3>处理时间线</h3>
      <el-timeline><el-timeline-item v-for="(event,index) in data.timeline" :key="`${event.at}-${index}`" :timestamp="formatTime(event.at)"><strong>{{ event.title }}</strong><small> · {{ event.actor }}</small><p>{{ event.detail }}</p></el-timeline-item></el-timeline>
      <small v-if="data.timelineHasMore">仅展示最近200条处理事件。</small>
      </template>
    </template>
  </div>
</template>

<style scoped>
.accounting-detail { min-height:160px;display:grid;gap:14px; }
.accounting-detail__toolbar { display:flex;justify-content:space-between;align-items:center; }
.accounting-detail__money { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:12px 0;border-block:1px solid var(--border); }
.accounting-detail__money div { display:grid;gap:5px;min-width:0; }
.accounting-detail__money small { color:var(--ink-3); }
.accounting-detail__money strong { font-size:18px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums; }
.accounting-detail h3 { margin:8px 0 0;font-size:14px; }
.accounting-detail p { margin:4px 0;font-size:12px;color:var(--ink-2);overflow-wrap:anywhere; }
.accounting-detail :deep(.el-descriptions__content) { overflow-wrap:anywhere;word-break:break-word; }
@media(max-width:600px){.accounting-detail__money {grid-template-columns:repeat(2,minmax(0,1fr));}}
</style>
