<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from "element-plus";
import { Delete, Download, Refresh, Search, View, Wallet } from "@element-plus/icons-vue";
import OrderAccountingDetail from '@/components/OrderAccountingDetail.vue';
import { billingMoney, deliveryLabels, orderKindLabels, type BillingOrder, type AccountingSummary } from '@/billingTypes';
import { downloadAdminCsv } from '@/downloadCsv';
import AdminDialog from "@/components/AdminDialog.vue";
import AdminListShell from "@/components/AdminListShell.vue";
import ListError from "@/components/ListError.vue";
import PageCard from "@/components/PageCard.vue";
import { request, type Page } from "@/request";
import { usePagedList } from "@/usePagedList";
import { formatPoints, formatTime } from "@/utils";

type AdminOrder = BillingOrder;
const route = useRoute();
const router = useRouter();
const defaults = () => ({ planId:String(route.query.planId || ''),planRevision:String(route.query.planRevision || ''),status:'',search:String(route.query.search || ''),userId:String(route.query.userId || ''),kind:'',paymentMethod:'',refundState:'',delivery:'',createdFrom:'',createdTo:'',minAmount:'',maxAmount:'' });
const filters = reactive(defaults());
const summary = ref<AccountingSummary | null>(null);
const appliedFilters = ref<Record<string,string> | null>(null);
const unappliedFilters = computed(() => JSON.stringify(appliedFilters.value) !== JSON.stringify({ ...filters, search:filters.search.trim() }));
const exporting = ref(false);
let listGeneration = 0;
const detail = ref<AdminOrder | null>(null);
const detailVisible = ref(false);
const reconciling = ref(false);
const deletingOrder=ref('');
async function deleteExpiredOrder(order:AdminOrder) {
  if(deletingOrder.value || order.status!=='expired')return;
  deletingOrder.value=order.id;
  try {
    await ElMessageBox.confirm(`删除已过期订单 ${order.id}？订单将从列表移除，原始记录与审计保留；后续确认收款时会重新显示。`,'删除失效订单',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消',closeOnClickModal:false});
    await request(`/api/v1/admin/orders/${encodeURIComponent(order.id)}`,{method:'DELETE',silent:true});
    if(detail.value?.id===order.id){detailVisible.value=false;detail.value=null;}
    ElMessage.success('已过期订单已从列表移除');
    await refresh();
    if(!items.value.length && page.value>1)await goToPage(page.value-1);
  } catch(e) {
    if(e!=='cancel' && e!=='close')ElMessage.error(e instanceof Error?e.message:'删除失败，请重试');
    if(e instanceof Error && 'code' in e && e.code==='order_not_deletable')await refresh();
  } finally {deletingOrder.value='';}
}

const statusOptions = [
  { value: "", label: "全部" },
  { value: "pending", label: "待支付" },
  { value: "uncertain", label: "待核实" },
  { value: "paid", label: "待到账" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "expired", label: "已过期" },
  { value: "failed", label: "失败" },
];

const statusMeta: Record<string, { label: string; type: "success" | "warning" | "danger" | "info" | "primary" }> = {
  pending: { label: "待支付", type: "warning" },
  uncertain: { label: "待核实", type: "warning" },
  paid: { label: "待到账", type: "primary" },
  completed: { label: "已完成", type: "success" },
  cancelled: { label: "已取消", type: "info" },
  expired: { label: "已过期", type: "info" },
  failed: { label: "失败", type: "danger" },
};

const pageSize = ref(20);

const {
  items,
  loading,
  error,
  total,
  page,
  hasPrev,
  hasNext,
  reset,
  goToPage,
  refresh,
  retry,
} = usePagedList<AdminOrder>(
  async (cursor) => {
    const own = ++listGeneration;
    const selected = { ...filters, search:filters.search.trim() };
    summary.value = null;
    const result = await request<Page<AdminOrder> & { summary: AccountingSummary }>("/api/v1/admin/orders", {
      query: {
        ...selected,
        cursor,
        limit: pageSize.value,
      },
    });
    if (own === listGeneration) { summary.value = result.summary; appliedFilters.value = selected; }
    return result;
  },
  () => ({ ...filters, limit: pageSize.value }),
);

const matchedTotal = computed(() => total.value ?? items.value.length);

const pagePaidCents = computed(() =>
  summary.value?.receivedCents ?? 0,
);

const pagePending = computed(() =>
  summary.value?.pendingOrders ?? 0,
);

function formatMoney(cents: number | null | undefined) {
  return `¥${(Number(cents || 0) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paidAmount(order: AdminOrder) {
	return order.finance?.receivedCents ?? 0;
}

function orderBenefit(order: AdminOrder) {
	if (order.planKind === "subscription") {
		const dailyGrant = Number(order.dailyGrantCents || 0);
		const durationDays = Number(order.durationDays || 0);
		if (dailyGrant > 0 && durationDays > 0) {
			return `每24小时 ${formatPoints(dailyGrant)} 积分 · ${durationDays} 天`;
		}
		return "订阅权益";
	}
	return `${formatPoints(Number(order.grantCents || 0) + Number(order.bonusCents || 0))} 积分`;
}

function paymentMethodLabel(method: string | null) {
  if (method === "alipay") return "支付宝";
  if (method === "wechat") return "微信支付";
  return "未记录";
}

function orderStatus(status: string) {
  return statusMeta[status] || { label: status || "未知", type: "info" as const };
}

function openDetail(order: AdminOrder) {
  detail.value = order;
  detailVisible.value = true;
}

function clearFilters() {
  Object.assign(filters, defaults(), { search:'',userId:'',planId:'',planRevision:'' });
  void reset();
}

async function exportOrders() {
  if (loading.value || !summary.value || unappliedFilters.value || !appliedFilters.value) return;
  exporting.value = true;
  try { await downloadAdminCsv('/api/v1/admin/orders/export', { ...appliedFilters.value }, '订单明细.csv'); }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '导出失败'); }
  finally { exporting.value = false; }
}
watch(() => route.query.orderId, async id => {
  if (typeof id !== 'string' || !id) return;
  try { const order = await request<AdminOrder>(`/api/v1/admin/orders/${encodeURIComponent(id)}`); if (route.query.orderId === id) openDetail(order); }
  catch { /* The request layer reports invalid or missing order IDs. */ }
}, { immediate:true });
watch(() => [route.query.search, route.query.userId, route.query.planId, route.query.planRevision], () => { Object.assign(filters,defaults()); reset(); });

async function runReconciliation() {
  if (reconciling.value) return;
  reconciling.value = true;
  try {
    const result = await request<{ checked: number; outcomes: Record<string, number> }>(
      "/api/v1/admin/payment-reconciliations/run",
      { method: "POST" },
    );
    const repaired = Number(result.outcomes?.repaired || 0);
    ElMessage.success(`已核对 ${result.checked} 笔订单${repaired ? `，补齐 ${repaired} 笔` : ""}`);
    await refresh();
  } finally {
    reconciling.value = false;
  }
}

onMounted(reset);
</script>

<template>
  <div class="page orders-page">
    <PageCard>
      <section class="orders-kpis" aria-label="订单摘要">
        <div class="orders-kpis__metrics">
          <span>
            <em>筛选实收</em>
            <strong class="tnum">{{ formatMoney(pagePaidCents) }}</strong>
          </span>
          <span>
            <em>确认退款</em>
            <strong class="tnum">{{ formatMoney(summary?.refundedCents) }}</strong>
          </span>
          <span><em>净收款</em><strong class="tnum">{{ summary ? billingMoney(summary.netCents) : '-' }}</strong></span>
          <span>
            <em>待处理</em>
            <strong class="tnum">{{ pagePending }}</strong>
          </span>
        </div>
        <div class="orders-kpis__actions">
          <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
          <el-button :icon="Download" :loading="exporting" :disabled="loading || !summary || unappliedFilters" :title="unappliedFilters ? '请先查询以应用筛选条件' : '导出当前筛选的全部页面，最多5000笔'" @click="exportOrders">导出筛选结果</el-button>
          <el-button type="primary" :icon="Search" :loading="reconciling" @click="runReconciliation">
            主动对账
          </el-button>
        </div>
      </section>
      <el-alert v-if="summary?.unallocatedRefundCents" type="warning" :closable="false" :title="`关联订阅中有 ${formatMoney(summary.unallocatedRefundCents)} 退款尚未记录逐单归属。${summary.partialRefundCents ? '当前筛选未覆盖全部关联付款，净收款暂不计算。' : '汇总已去重，单笔退款与净额显示待核对。'}`" />

      <div class="orders-toolbar">
        <el-tag v-if="filters.planId" closable @close="filters.planId=''; filters.planRevision=''; reset()">{{ route.query.planName || '指定套餐' }} · {{ filters.planRevision ? `第 ${filters.planRevision} 版` : '全部版本' }}</el-tag>
        <div class="orders-tabs" role="tablist" aria-label="订单状态">
          <button
            v-for="option in statusOptions"
            :key="option.value || 'all'"
            type="button"
            role="tab"
            class="orders-tab"
            :class="{ 'is-active': filters.status === option.value }"
            :aria-selected="filters.status === option.value"
            @click="filters.status = option.value; reset()"
          >
            {{ option.label }}
            <em v-if="filters.status === option.value" class="tnum">{{ matchedTotal }}</em>
          </button>
        </div>
        <div class="orders-toolbar__search">
          <el-input
            v-model="filters.search"
            :prefix-icon="Search"
            clearable
            placeholder="订单号、渠道单号、用户或套餐"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
        </div>
      </div>

      <div class="orders-filters">
        <el-select v-model="filters.kind" clearable placeholder="订单类型" aria-label="订单类型" @change="reset"><el-option v-for="(label,value) in orderKindLabels" :key="value" :label="label" :value="value" /></el-select>
        <el-select v-model="filters.paymentMethod" clearable placeholder="支付方式" aria-label="支付方式" @change="reset"><el-option label="支付宝" value="alipay" /><el-option label="微信支付" value="wechat" /></el-select>
        <el-select v-model="filters.refundState" clearable placeholder="退款状态" aria-label="退款状态" @change="reset"><el-option label="无退款" value="none" /><el-option label="审核/处理中" value="pending" /><el-option label="已确认退款" value="completed" /><el-option label="逐单归属待核对" value="unallocated" /></el-select>
        <el-select v-model="filters.delivery" clearable placeholder="到账状态" aria-label="到账状态" @change="reset"><el-option v-for="(label,value) in deliveryLabels" :key="value" :label="label" :value="value" /></el-select>
        <el-date-picker v-model="filters.createdFrom" type="date" value-format="YYYY-MM-DD" placeholder="创建起始日期" aria-label="创建起始日期" @change="reset" />
        <el-date-picker v-model="filters.createdTo" type="date" value-format="YYYY-MM-DD" placeholder="创建截止日期" aria-label="创建截止日期" @change="reset" />
        <el-input v-model="filters.minAmount" placeholder="最低订单金额(元)" aria-label="最低订单金额" @keyup.enter="reset" />
        <el-input v-model="filters.maxAmount" placeholder="最高订单金额(元)" aria-label="最高订单金额" @keyup.enter="reset" />
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="orders-board"
        fill
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="(size: number) => { pageSize = size; reset() }"
      >
        <el-table v-loading="loading" class="orders-table" :data="items" height="100%" size="small" table-layout="fixed">
          <template #empty>
            <el-empty description="暂无订单" :image-size="64" />
          </template>
          <el-table-column label="套餐" min-width="180">
            <template #default="{ row }">
              <div class="order-main">
                <strong>{{ row.planName || "历史套餐" }}</strong>
                <small>{{ orderKindLabels[row.finance?.kind] || '历史记录' }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="210">
            <template #default="{ row }">
              <div class="order-user">
                <el-button link type="primary" :title="row.userEmail || undefined" @click="router.push({path:'/users',query:{userId:row.userId,search:row.userEmail || row.userId}})">{{ row.userEmail || "未知用户" }}</el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="确认实收 / 订单金额" width="160">
            <template #default="{ row }">
              <div class="order-money">
                <strong>{{ formatMoney(paidAmount(row as AdminOrder)) }}</strong>
                <small v-if="Number(paidAmount(row as AdminOrder)) !== Number(row.amountCents)">
                  订单金额 {{ formatMoney(row.amountCents) }}
                </small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="净收款 / 已退" width="150"><template #default="{ row }"><div class="order-money"><strong>{{ billingMoney(row.finance?.netCents) }}</strong><small>已退 {{ billingMoney(row.finance?.refundedCents) }}</small></div></template></el-table-column>
          <el-table-column label="到账" width="130"><template #default="{ row }"><span>{{ deliveryLabels[row.finance?.delivery] || '-' }}</span></template></el-table-column>
          <el-table-column label="发放权益" width="180">
            <template #default="{ row }">
              <span class="tnum">{{ orderBenefit(row as AdminOrder) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="支付渠道" width="110" align="center">
            <template #default="{ row }">
              <div class="order-channel">
                <strong>{{ paymentMethodLabel(row.paymentMethod) }}</strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="orderStatus(row.status).type" effect="light" size="small">
                {{ orderStatus(row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="160">
            <template #default="{ row }">
              <span class="tnum order-time">{{ formatTime(row.createdAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="支付时间" width="160">
            <template #default="{ row }">
              <span class="tnum order-time">{{ formatTime(row.paidAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="完成时间" width="160">
            <template #default="{ row }">
              <span class="tnum order-time">{{ formatTime(row.completedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" :icon="View" title="查看订单" @click="openDetail(row as AdminOrder)">详情</el-button>
              <el-button v-if="row.status==='expired' && !row.paidAt && !row.completedAt" text type="danger" size="small" :icon="Delete" :loading="deletingOrder===row.id" :disabled="!!deletingOrder && deletingOrder!==row.id" @click="deleteExpiredOrder(row as AdminOrder)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="detailVisible"
      title="订单详情"
      subtitle="支付快照与到账结果"
      :icon="Wallet"
      width="880px"
      :show-cancel="false"
      confirm-text="关闭"
      @confirm="detailVisible = false"
    >
      <template v-if="detail" #meta>
        <el-tag :type="orderStatus(detail.status).type" effect="light" size="small">
          {{ orderStatus(detail.status).label }}
        </el-tag>
      </template>
      <OrderAccountingDetail v-if="detail" :key="detail.id" :order-id="detail.id" @loaded="detail = $event" />
    </AdminDialog>
  </div>
</template>

<style scoped>
.orders-filters { display:flex;flex-wrap:wrap;gap:8px; }
.orders-filters :deep(.el-select), .orders-filters :deep(.el-input), .orders-filters :deep(.el-date-editor) { width:150px; }
.order-main small { color:var(--ink-3);font-size:11px; }
.orders-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}
.orders-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.orders-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  overflow: hidden;
}
.orders-kpis {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 6px 8px 6px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.orders-kpis__metrics {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
}
.orders-kpis__metrics::-webkit-scrollbar {
  display: none;
}
.orders-kpis__metrics > span {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 12px;
  border-right: 1px solid var(--border);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.3;
  white-space: nowrap;
}
.orders-kpis__metrics > span:last-child {
  border-right: 0;
}
.orders-kpis em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
}
.orders-kpis strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.orders-kpis__metrics > span.is-warn strong {
  color: var(--warning);
}
.orders-kpis__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.orders-kpis__actions :deep(.el-button) {
  min-width: 88px;
  height: 36px;
  padding: 0 16px;
}
.orders-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.orders-tabs {
  display: flex;
  min-width: 0;
  flex: 1 1 360px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}
.orders-tabs::-webkit-scrollbar {
  display: none;
}
.orders-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.orders-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.orders-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}
.orders-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}
.orders-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.orders-toolbar__search {
  display: flex;
  align-items: center;
  gap: 8px;
}
.orders-toolbar__search :deep(.el-input) {
  width: 240px;
}
.orders-board {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-top: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.orders-board :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}
.order-main,
.order-user,
.order-money,
.order-channel {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.order-main strong,
.order-user strong,
.order-channel strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-user small,
.order-money small,
.order-channel small {
  color: var(--ink-3);
  font-size: 11px;
}
.order-money strong {
  color: var(--success);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.order-money small {
  color: var(--warning);
}
.order-time {
  color: var(--ink-2);
  font-size: 12px;
}
.order-detail {
  display: grid;
  gap: 10px;
}
.order-detail__hero,
.order-detail__facts,
.order-detail__times {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--border);
}
.order-detail__times {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.order-detail__hero > div,
.order-detail__facts > div,
.order-detail__times > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--surface-2);
}
.order-detail em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 650;
}
.order-detail strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-detail__hero > div:first-child strong {
  color: var(--success);
  font-size: 22px;
  letter-spacing: -0.03em;
}
.order-detail small {
  color: var(--ink-3);
  font-size: 12px;
}
.order-detail__hero > div:first-child small {
  color: var(--warning);
}
.order-detail__times strong {
  font-size: 12px;
  font-weight: 650;
}
.order-detail__ids {
  display: grid;
  gap: 6px;
}
.order-detail__ids button {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--ink-2);
  background: var(--surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.order-detail__ids em {
  color: var(--ink-3);
}
.order-detail__ids code {
  overflow: hidden;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-detail__ids .el-icon {
  color: var(--ink-3);
}
@media (max-width: 860px) {
  .orders-kpis { flex-direction:column;align-items:stretch; }
  .orders-kpis__actions { flex-wrap:wrap; }
  .orders-kpis__actions :deep(.el-button) { flex:1;min-width:0;padding-inline:10px; }
  .orders-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .orders-toolbar__search :deep(.el-input) {
    width: min(100%, 280px);
  }
  .order-detail__hero,
  .order-detail__facts,
  .order-detail__times {
    grid-template-columns: 1fr;
  }
}
</style>
