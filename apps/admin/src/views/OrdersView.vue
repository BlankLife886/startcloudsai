<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { CopyDocument, Refresh, Search, View, Wallet } from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import AdminListShell from "@/components/AdminListShell.vue";
import ListError from "@/components/ListError.vue";
import PageCard from "@/components/PageCard.vue";
import { request, type Page } from "@/request";
import { usePagedList } from "@/usePagedList";
import { formatPoints, formatTime } from "@/utils";

type OrderStatus = "pending" | "paid" | "completed" | "failed" | "expired";

interface AdminOrder {
  id: string;
  userId: string;
  userEmail: string | null;
	planId: string;
	planName: string | null;
	planKind: "topup" | "subscription" | null;
	durationDays: number | null;
	dailyGrantCents: number | null;
  status: OrderStatus;
  amountCents: number;
  providerPayAmountCents: number | null;
  payAmountCents: number | null;
  grantCents: number;
  bonusCents: number;
  provider: string;
  providerOrderId: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const filters = reactive({ status: "", search: "" });
const detail = ref<AdminOrder | null>(null);
const detailVisible = ref(false);
const reconciling = ref(false);

const statusOptions = [
  { value: "", label: "全部" },
  { value: "pending", label: "待支付" },
  { value: "paid", label: "确认中" },
  { value: "completed", label: "已完成" },
  { value: "expired", label: "已失效" },
  { value: "failed", label: "失败" },
];

const statusMeta: Record<string, { label: string; type: "success" | "warning" | "danger" | "info" | "primary" }> = {
  pending: { label: "待支付", type: "warning" },
  paid: { label: "确认中", type: "primary" },
  completed: { label: "已完成", type: "success" },
  expired: { label: "已失效", type: "info" },
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
  (cursor) =>
    request<Page<AdminOrder>>("/api/v1/admin/orders", {
      query: {
        status: filters.status,
        search: filters.search.trim(),
        cursor,
        limit: pageSize.value,
      },
    }),
  () => ({ ...filters, limit: pageSize.value }),
);

const matchedTotal = computed(() => total.value ?? items.value.length);

const pagePaidCents = computed(() =>
  items.value.reduce((sum, order) => sum + Number(paidAmount(order)), 0),
);

const pageCompleted = computed(() => items.value.filter((order) => order.status === "completed").length);

const pagePending = computed(() =>
  items.value.filter((order) => order.status === "pending" || order.status === "paid").length,
);

const adjustedCount = computed(() =>
  items.value.filter(
    (order) =>
      order.providerPayAmountCents !== null &&
      Number(order.providerPayAmountCents) !== Number(order.amountCents),
  ).length,
);

const statusLabel = computed(
  () => statusOptions.find((option) => option.value === filters.status)?.label || "全部",
);

function formatMoney(cents: number | null | undefined) {
  return `¥${(Number(cents || 0) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paidAmount(order: AdminOrder) {
	return order.providerPayAmountCents ?? order.payAmountCents ?? order.amountCents;
}

function orderBenefit(order: AdminOrder) {
	if (order.planKind === "subscription") {
		const dailyGrant = Number(order.dailyGrantCents || 0);
		const durationDays = Number(order.durationDays || 0);
		if (dailyGrant > 0 && durationDays > 0) {
			return `每日 ${formatPoints(dailyGrant)} 积分 · ${durationDays} 天`;
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

function shortId(id: string) {
  return id ? `${id.slice(0, 8)}…${id.slice(-4)}` : "—";
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  ElMessage.success("已复制");
}

function openDetail(order: AdminOrder) {
  detail.value = order;
  detailVisible.value = true;
}

function clearFilters() {
  filters.status = "";
  filters.search = "";
  void reset();
}

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
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
        <el-button type="primary" :icon="Search" :loading="reconciling" @click="runReconciliation">
          主动对账
        </el-button>
      </template>

      <section class="orders-kpis" aria-label="订单摘要">
        <article>
          <small>匹配订单</small>
          <strong class="tnum">{{ matchedTotal }}</strong>
        </article>
        <article>
          <small>本页实付</small>
          <strong class="tnum">{{ formatMoney(pagePaidCents) }}</strong>
        </article>
        <article>
          <small>本页已完成</small>
          <strong class="tnum">{{ pageCompleted }}</strong>
        </article>
        <article>
          <small>本页待处理</small>
          <strong class="tnum">{{ pagePending }}</strong>
        </article>
        <article :class="{ 'is-warn': adjustedCount > 0 }">
          <small>金额差异</small>
          <strong class="tnum">{{ adjustedCount }}</strong>
        </article>
      </section>

      <p class="orders-legend">
        当前筛选
        <em>{{ statusLabel }}</em>
        共
        <em class="tnum">{{ matchedTotal }}</em>
        笔。本页
        <em class="tnum">{{ items.length }}</em>
        笔实付
        <em class="tnum">{{ formatMoney(pagePaidCents) }}</em>
        。
        <span v-if="adjustedCount" class="is-warn">{{ adjustedCount }} 笔实际收款与套餐标价不同。</span>
      </p>

      <div class="orders-toolbar">
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
            placeholder="搜索用户邮箱或昵称"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
        </div>
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
          <el-table-column label="订单 / 套餐" min-width="220">
            <template #default="{ row }">
              <div class="order-main">
                <strong>{{ row.planName || "历史套餐" }}</strong>
                <button type="button" title="复制订单号" @click="copy(row.id)">
                  <span class="mono">{{ shortId(row.id) }}</span>
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="210">
            <template #default="{ row }">
              <div class="order-user">
                <strong :title="row.userEmail || row.userId">{{ row.userEmail || "未知用户" }}</strong>
                <small class="mono">{{ shortId(row.userId) }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="标价 / 实付" width="150">
            <template #default="{ row }">
              <div class="order-money">
                <strong>{{ formatMoney(paidAmount(row as AdminOrder)) }}</strong>
                <small v-if="Number(paidAmount(row as AdminOrder)) !== Number(row.amountCents)">
                  标价 {{ formatMoney(row.amountCents) }}
                </small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="发放权益" width="180">
            <template #default="{ row }">
              <span class="tnum">{{ orderBenefit(row as AdminOrder) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="支付渠道" width="130">
            <template #default="{ row }">
              <div class="order-channel">
                <strong>{{ paymentMethodLabel(row.paymentMethod) }}</strong>
                <small>{{ row.provider }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
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
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" :icon="View" title="查看订单" @click="openDetail(row as AdminOrder)">详情</el-button>
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
      width="620px"
      :show-cancel="false"
      confirm-text="关闭"
      @confirm="detailVisible = false"
    >
      <div v-if="detail" class="order-detail">
        <div class="order-detail__kpis">
          <div>
            <small>订单状态</small>
            <el-tag :type="orderStatus(detail.status).type" effect="light">
              {{ orderStatus(detail.status).label }}
            </el-tag>
          </div>
          <div>
            <small>实际收款</small>
            <strong class="tnum">{{ formatMoney(paidAmount(detail)) }}</strong>
          </div>
          <div>
            <small>套餐权益</small>
            <strong>{{ orderBenefit(detail) }}</strong>
          </div>
        </div>
        <dl>
          <div><dt>订单号</dt><dd class="mono">{{ detail.id }}</dd></div>
          <div><dt>上游订单号</dt><dd class="mono">{{ detail.providerOrderId || "—" }}</dd></div>
          <div><dt>用户</dt><dd>{{ detail.userEmail || detail.userId }}</dd></div>
          <div><dt>套餐</dt><dd>{{ detail.planName || detail.planId }}</dd></div>
          <div><dt>套餐标价</dt><dd>{{ formatMoney(detail.amountCents) }}</dd></div>
          <div><dt>实际应付</dt><dd>{{ formatMoney(paidAmount(detail)) }}</dd></div>
          <div><dt>支付渠道</dt><dd>{{ paymentMethodLabel(detail.paymentMethod) }} · {{ detail.provider || "—" }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ formatTime(detail.createdAt) }}</dd></div>
          <div><dt>支付时间</dt><dd>{{ detail.paidAt ? formatTime(detail.paidAt) : "—" }}</dd></div>
          <div><dt>完成时间</dt><dd>{{ detail.completedAt ? formatTime(detail.completedAt) : "—" }}</dd></div>
        </dl>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped>
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
.orders-page :deep(.page-card__header) {
  flex-wrap: wrap;
  align-items: flex-start;
}
.orders-page :deep(.page-card__actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
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
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.orders-kpis article {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
}
.orders-kpis article:last-child {
  border-right: 0;
}
.orders-kpis small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.orders-kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orders-kpis article.is-warn strong,
.orders-legend .is-warn {
  color: var(--warning);
}
.orders-legend {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.orders-legend em {
  margin: 0 2px;
  color: var(--ink);
  font-style: normal;
  font-weight: 750;
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
.order-main button {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--ink-3);
  background: transparent;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
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
.order-detail__kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.order-detail__kpis > div {
  display: grid;
  gap: 6px;
  min-width: 0;
  min-height: 72px;
  align-content: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.order-detail__kpis small {
  color: var(--ink-3);
  font-size: 12px;
}
.order-detail__kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 16px;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-detail__kpis > div:nth-child(2) strong {
  color: var(--success);
}
.order-detail dl {
  display: grid;
  margin: 0;
}
.order-detail dl > div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 14px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--border);
}
.order-detail dt {
  color: var(--ink-3);
  font-size: 12px;
}
.order-detail dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 13px;
  text-align: right;
}
@media (max-width: 1080px) {
  .orders-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .orders-kpis article:nth-child(3) {
    border-right: 0;
  }
  .orders-kpis article:nth-child(4),
  .orders-kpis article:nth-child(5) {
    border-top: 1px solid var(--border);
  }
}
@media (max-width: 860px) {
  .orders-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .orders-kpis article:nth-child(odd) {
    border-right: 1px solid var(--border);
  }
  .orders-kpis article:nth-child(even) {
    border-right: 0;
  }
  .orders-kpis article:nth-child(3) {
    border-top: 1px solid var(--border);
  }
  .orders-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .orders-toolbar__search :deep(.el-input) {
    width: min(100%, 280px);
  }
  .order-detail__kpis {
    grid-template-columns: 1fr;
  }
}
</style>
