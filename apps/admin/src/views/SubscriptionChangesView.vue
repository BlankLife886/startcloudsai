<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from 'vue-router';
import { ElMessage } from "element-plus";
import {
  Refresh,
  Check,
  Close,
  CreditCard,
  Search,
  Download,
} from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import SubscriptionAuditTrail from '@/components/SubscriptionAuditTrail.vue';
import { request } from "@/request";
import { formatTime } from "@/utils";
type Change = {
  id: string;
  userId: string;
  subscriptionId: string;
  kind: string;
  status: string;
  amountCents: number;
  reason: string;
  reviewNote: string;
  providerReference?: string;
  createdAt: string;
  snapshot: { planName: string; sourcePlan?: { planId: string; planName: string; priceCents: number; dailyPoints: number; durationDays: number }; manualRefund?: boolean; upgradeMode?: string; durationDays?: number; priceCents?: number; startsAt?: string; endsAt?: string; upgradeCredit?: { creditCents: number; timeValueCents: number; unusedValueCents: number; reclaimPoints: number; spentPoints: number; oldStartsAt: string; oldEndsAt: string } };
  username?: string;
  userEmail?: string;
  requestedAmountCents?: number;
  refundCalculation?: Calculation;
};
type Calculation = {
  protectedUsagePoints?: number;
  protectedTopupFrozenPoints?: number;
  expiredPoints?: number;
  refundedCents?: number;
  paidCents: number;
  issuedPoints: number;
  spentPoints: number;
  availablePoints: number;
  taskFrozenPoints: number;
  refundHeldPoints: number;
  futurePoints: number;
  remainingSeconds: number;
  timeValueCents: number;
  unusedValueCents: number;
  maxRefundCents: number;
  rule: string;
  calculatedAt: string;
};
type Detail = {
  ledgerPage: number;
  ledgerTotal: number;
  ledgerLimit: number;
  change: Change;
  user: { username: string; email: string };
  wallet?: { normalBalanceCents: number; taskFrozenCents: number; refundHeldCents: number };
  subscription: { startsAt: string; endsAt: string };
  currentCalculation: Calculation;
  orders: Array<{
    id: string;
    planName: string;
    status: string;
    amountCents: number;
    providerOrderId: string;
  }>;
  ledger: Array<{
    id: string;
    kind: string;
    deltaPoints: number;
    balanceAfterPoints: number;
    sourceType: string;
    sourceId: string;
    reason: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    action: string;
    occurredAt: string;
    actorId: string;
    actorName?: string;
    internalNote: string;
    publicMessage: string;
    amountCents: number;
    calculation?: Calculation;
  }>;
};
const route=useRoute();
const query = ref(String(route.query.search || "")),
  statusFilter = ref(""),
  kindFilter = ref(""),
  page = ref(1),
  total = ref(0);
const detail = ref<Detail | null>(null),
  detailOpen = ref(false),
  detailLoading = ref(false),
  detailTab = ref("calculation");
const customerMessage = ref("");
const items = ref<Change[]>([]),
  loading = ref(false),
  saving = ref(false),
  error = ref("");
const selected = ref<Change | null>(null),
  action = ref("approve"),
  note = ref(""),
  reference = ref(""),
  confirmed = ref(false),
  dialog = ref(false);
const approvedYuan = ref<number | undefined>(undefined);
type ManualPreview = {
  orderId: string;
  subscription: { id: string; planName: string };
  user: { username: string; email: string };
  calculation: Calculation;
  maxManualAmountCents: number;
};
const manualOpen = ref(false), manualLoading = ref(false), manualSaving = ref(false);
const manualOrder = ref(""), manualNote = ref(""), manualConfirmed = ref(false);
const manualAmount = ref<number | undefined>(undefined);
const manualPreview = ref<ManualPreview | null>(null);
const manualAuditOrder=ref(''),manualAuditRevision=ref(0),manualAuditReady=ref(false);
const manualReferenceValue=computed(()=>{
 const c=manualPreview.value?.calculation;
 return c && Number.isFinite(c.timeValueCents) && Number.isFinite(c.unusedValueCents) ? Math.max(0,Math.min(c.timeValueCents,c.unusedValueCents,manualPreview.value!.maxManualAmountCents)) : null;
});
let manualLookup = 0;
const manualReady = computed(() => !!manualPreview.value &&
  manualAuditReady.value &&
  manualPreview.value.orderId === manualOrder.value.trim() &&
  !manualLoading.value && !manualSaving.value && manualConfirmed.value &&
  manualNote.value.trim().length >= 6 && Number.isFinite(manualAmount.value) &&
  Number(manualAmount.value) > 0 && Math.round(Number(manualAmount.value) * 100) <= manualPreview.value.maxManualAmountCents &&
  manualPreview.value.calculation.taskFrozenPoints === 0 &&
  !(manualPreview.value.calculation.protectedTopupFrozenPoints || 0));
function invalidateManual(){manualLookup++;manualPreview.value=null;manualAuditOrder.value='';manualAuditReady.value=false;manualConfirmed.value=false;manualAmount.value=undefined;manualLoading.value=false;}
function auditReady(ready:boolean){manualAuditReady.value=ready;if(!ready)manualConfirmed.value=false;}
function openManual() {
  manualLookup++;
  manualOrder.value = "";
  manualNote.value = "";
  manualConfirmed.value = false;
  manualAmount.value = undefined;
  manualPreview.value = null;
  manualAuditOrder.value='';manualAuditReady.value=false;
  manualLoading.value = false;
  manualOpen.value = true;
}
async function lookupManual() {
  const order = manualOrder.value.trim(), lookup = ++manualLookup;
  if (!order) return;
  manualPreview.value = null;
  manualAmount.value = undefined;
  manualConfirmed.value = false;
  manualLoading.value = true;
  manualAuditReady.value=false;
  manualAuditOrder.value=order;
  manualAuditRevision.value++;
  try {
    const data = await request<ManualPreview>(`/api/v1/admin/orders/${encodeURIComponent(order)}/subscription-refund`, { silent: true });
    if (lookup === manualLookup && manualOpen.value && order === manualOrder.value.trim()) manualPreview.value = data;
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : "订单核查失败"); }
  finally { if (lookup === manualLookup) manualLoading.value = false; }
}
async function submitManual() {
  if (!manualReady.value || !manualPreview.value) return;
  manualSaving.value = true;
  try {
    await request(`/api/v1/admin/orders/${encodeURIComponent(manualPreview.value.orderId)}/subscription-refund`, {
      method: "POST", body: { amountCents: Math.round(Number(manualAmount.value) * 100), note: manualNote.value, confirmed: manualConfirmed.value },
    });
    manualOpen.value = false;
    ElMessage.success("人工退款已登记，剩余订阅积分已冻结，待渠道退款确认");
    query.value = "";
    statusFilter.value = "";
    kindFilter.value = "";
    page.value = 1;
    await load();
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : "人工退款登记失败"); }
  finally { manualSaving.value = false; }
}
const names: Record<string, string> = {
  reviewing: "待审核",
  processing: "待渠道退款确认",
  completed: "已完成",
  rejected: "已驳回",
  cancelled: "已取消",
  pending: "待支付",
};
const money = (value: number) => `¥${(value / 100).toFixed(2)}`;
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (query.value.trim()) params.set("q", query.value.trim());
    if (statusFilter.value) params.set("status", statusFilter.value);
    if (kindFilter.value) params.set("kind", kindFilter.value);
    if (page.value > 1) params.set("page", String(page.value));
    const data = await request<{ items: Change[]; total: number }>(
      "/api/v1/admin/subscription-changes" + (params.size ? `?${params}` : ""),
      { silent: true },
    );
    items.value = data.items || [];
    total.value = data.total ?? items.value.length;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取失败";
  } finally {
    loading.value = false;
  }
}
function open(item: unknown, next: string) {
  selected.value = item as Change;
  action.value = next;
  note.value = "";
  reference.value = "";
  confirmed.value = false;
  customerMessage.value = "";
  approvedYuan.value = undefined;
  dialog.value = true;
}
async function submit() {
  if (!selected.value || saving.value) return;
  saving.value = true;
  try {
    await request(
      `/api/v1/admin/subscription-changes/${selected.value.id}/review`,
      {
        method: "POST",
        body: {
          action: action.value,
          note: note.value,
          providerReference: reference.value,
          customerMessage: customerMessage.value,
          ...(action.value === "approve" &&
          typeof approvedYuan.value === "number"
            ? { approvedAmountCents: Math.round(approvedYuan.value * 100) }
            : {}),
        },
      },
    );
    dialog.value = false;
    ElMessage.success("处理结果已记录");
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "处理失败");
  } finally {
    saving.value = false;
  }
}
async function inspect(item: unknown) {
  const row = item as Change;
  detail.value = null;
  detailTab.value = "calculation";
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    detail.value = await request<Detail>(
      `/api/v1/admin/subscription-changes/${row.id}`,
      { silent: true },
    );
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "查账信息读取失败");
  } finally {
    detailLoading.value = false;
  }
}
function search() {
  page.value = 1;
  void load();
}
async function changeLedgerPage(nextPage: number) {
  if (!detail.value || detailLoading.value) return;
  const id = detail.value.change.id;
  detailLoading.value = true;
  try {
    const next = await request<Detail>(`/api/v1/admin/subscription-changes/${id}?ledgerPage=${nextPage}`, { silent: true });
    if (detail.value?.change.id === id) detail.value = next;
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : "流水读取失败"); }
  finally { detailLoading.value = false; }
}
function exportDetail() {
  if (!detail.value) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(detail.value, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `subscription-audit-${detail.value.change.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
const ruleLabel = (rule: string) =>
  ({
    unused_refund_window: "未使用全退窗口",
    subscription_credits_used: "已使用过订阅积分，不支持自助退款；人工例外需单独核定",
    subscription_price_protection_used: "已使用订阅价格保护，需人工例外处理",
    remaining_service_and_unused_credits:
      "剩余时间价值与未消耗权益价值取较低金额",
    awaiting_task_settlement: "存在订阅任务冻结，结算后才能审核",
    subscription_ended: "订阅已结束，不再产生可退额度",
  })[rule] || rule;
const actionLabel = (action: string) =>
  ({
    requested: "提交申请",
    approve: "审核通过",
    manual_approved: "管理员核定例外退款",
    reject: "驳回并恢复权益",
    confirm_external_refund: "确认渠道退款",
    upgrade_completed: "升级完成",
    legacy_status: "历史处理记录",
  })[action] || action;
onMounted(load);
watch(()=>route.query.search,value=>{query.value=String(value||'');page.value=1;load()});
</script>

<template>
  <div class="subscription-admin">
    <header>
      <h2>订阅变更</h2>
      <div>
      <el-button :icon="CreditCard" type="warning" plain @click="openManual">人工例外退款</el-button>
      <el-button :icon="Refresh" :loading="loading" @click="load"
        >刷新</el-button
      >
      </div>
    </header>
    <form class="subscription-admin-filters" @submit.prevent="search">
      <el-input
        v-model="query"
        clearable
        placeholder="搜索用户、申请号、订单号或渠道流水"
        aria-label="搜索订阅账务"
      />
      <el-select
        v-model="statusFilter"
        clearable
        placeholder="全部状态"
        aria-label="变更状态"
        @change="search"
        ><el-option
          v-for="(label, value) in names"
          :key="value"
          :value="value"
          :label="label"
      /></el-select>
      <el-select
        v-model="kindFilter"
        clearable
        placeholder="全部类型"
        aria-label="变更类型"
        @change="search"
        ><el-option value="refund" label="退订退款" /><el-option
          value="upgrade"
          label="订阅升级"
      /></el-select>
      <el-button native-type="submit" :icon="Search">查询</el-button>
    </form>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table :data="items" v-loading="loading" empty-text="暂无订阅变更申请">
      <el-table-column label="套餐 / 用户" min-width="220"
        ><template #default="{ row }"
          ><strong>{{ row.snapshot.planName }}</strong
          ><small v-if="row.kind === 'upgrade'">来源：{{ row.snapshot.sourcePlan?.planName || '原套餐信息未记录' }}</small
          ><small
            >{{ row.username || "未命名用户" }} ·
            {{ row.userEmail || row.userId }}</small
          ></template
        ></el-table-column
      >
      <el-table-column label="类型" width="110"
        ><template #default="{ row }">{{
          row.snapshot.manualRefund ? "人工例外退款" : row.kind === "refund" ? "退订退款" : row.snapshot.upgradeMode === "restart" ? "整期置换升级" : "升级补差价"
        }}</template></el-table-column
      >
      <el-table-column label="申请 / 核定金额" width="145"
        ><template #default="{ row }">{{
          money(row.amountCents)
        }}</template></el-table-column
      >
      <el-table-column label="状态" width="170"
        ><template #default="{ row }">{{
          row.kind === "refund" && row.status === "completed"
            ? "已人工确认退款"
            : names[row.status] || row.status
        }}</template></el-table-column
      >
      <el-table-column label="原因 / 处理记录" min-width="240"
        ><template #default="{ row }"
          ><span>{{ row.reason || "—" }}</span
          ><small>{{ row.publicMessage || "" }}</small
          ><small v-if="row.providerReference"
            >渠道流水：{{ row.providerReference }}</small
          ></template
        ></el-table-column
      >
      <el-table-column label="申请时间" width="165"
        ><template #default="{ row }">{{
          formatTime(row.createdAt)
        }}</template></el-table-column
      >
      <el-table-column label="处理" width="355" fixed="right"
        ><template #default="{ row }"
          ><el-button size="small" :icon="Search" @click="inspect(row)"
            >查账</el-button
          ><template v-if="row.kind === 'refund'"
            ><el-button
              v-if="row.status === 'reviewing'"
              size="small"
              :icon="Check"
              @click="open(row, 'approve')"
              >通过审核</el-button
            ><el-button
              v-if="row.status === 'processing'"
              size="small"
              :icon="CreditCard"
              @click="open(row, 'confirm_external_refund')"
              >确认渠道退款</el-button
            ><el-button
              v-if="['reviewing', 'processing'].includes(row.status)"
              size="small"
              :icon="Close"
              @click="open(row, 'reject')"
              >驳回 / 恢复</el-button
            ></template
          ></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      class="subscription-admin-pagination"
      v-model:current-page="page"
      :page-size="25"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <el-drawer
      v-model="detailOpen"
      title="订阅账务详情"
      size="min(980px, 96vw)"
    >
      <div v-loading="detailLoading" style="min-height: 200px">
        <template v-if="detail">
          <div class="subscription-audit-head">
            <div>
              <strong
                >{{ detail.user.username }} · {{ detail.user.email }}</strong
              >
              <p>申请号：{{ detail.change.id }}</p>
              <p>订阅号：{{ detail.change.subscriptionId }}</p>
              <p v-if="detail.change.kind === 'upgrade'">从「{{ detail.change.snapshot.sourcePlan?.planName || '原套餐信息未记录' }}」升级至「{{ detail.change.snapshot.planName }}」</p>
            </div>
            <el-button :icon="Download" @click="exportDetail"
              >导出当前页核查记录</el-button
            >
          </div>
          <el-tabs v-model="detailTab">
            <el-tab-pane name="calculation" label="退款核算与订单">
              <el-descriptions v-if="detail.change.snapshot.upgradeCredit" :column="2" border>
                <el-descriptions-item label="原套餐">{{ detail.change.snapshot.sourcePlan?.planName || '未记录' }}</el-descriptions-item>
                <el-descriptions-item label="目标套餐">{{ detail.change.snapshot.planName }}</el-descriptions-item>
                <el-descriptions-item v-if="detail.change.snapshot.sourcePlan" label="原套餐额度">每24小时 {{ detail.change.snapshot.sourcePlan.dailyPoints }} 积分 · {{ detail.change.snapshot.sourcePlan.durationDays }} 天</el-descriptions-item>
                <el-descriptions-item v-if="detail.change.snapshot.sourcePlan" label="原套餐价格">{{ money(detail.change.snapshot.sourcePlan.priceCents) }}</el-descriptions-item>
                <el-descriptions-item label="新套餐价格">{{ money(detail.change.snapshot.priceCents || 0) }}</el-descriptions-item>
                <el-descriptions-item label="旧权益抵扣">{{ money(detail.change.snapshot.upgradeCredit.creditCents) }}</el-descriptions-item>
                <el-descriptions-item label="报价剩余时间价值">{{ money(detail.change.snapshot.upgradeCredit.timeValueCents) }}</el-descriptions-item>
                <el-descriptions-item label="报价未消耗积分价值">{{ money(detail.change.snapshot.upgradeCredit.unusedValueCents) }}</el-descriptions-item>
                <el-descriptions-item label="旧积分回收">{{ detail.change.snapshot.upgradeCredit.reclaimPoints }}</el-descriptions-item>
                <el-descriptions-item label="旧订阅已使用">{{ detail.change.snapshot.upgradeCredit.spentPoints }}</el-descriptions-item>
                <el-descriptions-item label="原有效期">{{ formatTime(detail.change.snapshot.upgradeCredit.oldStartsAt) }} 至 {{ formatTime(detail.change.snapshot.upgradeCredit.oldEndsAt) }}</el-descriptions-item>
                <el-descriptions-item label="新周期">开通起完整 {{ detail.change.snapshot.durationDays }} 天</el-descriptions-item>
              </el-descriptions>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="通用可用积分">{{ detail.wallet?.normalBalanceCents ?? '—' }}</el-descriptions-item>
                <el-descriptions-item label="账户任务冻结">{{ detail.wallet?.taskFrozenCents ?? '—' }}</el-descriptions-item>
                <el-descriptions-item label="累计实付">{{
                  money(detail.currentCalculation.paidCents)
                }}</el-descriptions-item>
                <el-descriptions-item label="已确认退款">{{ money(detail.currentCalculation.refundedCents || 0) }}</el-descriptions-item>
                <el-descriptions-item label="价格保护已结算">{{ detail.currentCalculation.protectedUsagePoints || 0 }} 积分</el-descriptions-item>
                <el-descriptions-item label="锁价充值任务冻结">{{ detail.currentCalculation.protectedTopupFrozenPoints || 0 }} 积分</el-descriptions-item>
                <el-descriptions-item label="周期到期失效">{{ detail.currentCalculation.expiredPoints || 0 }} 积分</el-descriptions-item>
                <el-descriptions-item label="已发 / 已用积分"
                  >{{ detail.currentCalculation.issuedPoints }} /
                  {{
                    detail.currentCalculation.spentPoints
                  }}</el-descriptions-item
                >
                <el-descriptions-item label="任务冻结"
                  >{{
                    detail.currentCalculation.taskFrozenPoints
                  }}
                  积分</el-descriptions-item
                >
                <el-descriptions-item label="退订冻结"
                  >{{
                    detail.currentCalculation.refundHeldPoints
                  }}
                  积分</el-descriptions-item
                >
                <el-descriptions-item label="未来未发额度"
                  >{{
                    detail.currentCalculation.futurePoints
                  }}
                  积分</el-descriptions-item
                >
                <el-descriptions-item label="剩余时间"
                  >{{
                    Math.floor(
                      detail.currentCalculation.remainingSeconds / 86400,
                    )
                  }}
                  天
                  {{
                    Math.floor(
                      (detail.currentCalculation.remainingSeconds % 86400) /
                        3600,
                    )
                  }}
                  小时</el-descriptions-item
                >
                <el-descriptions-item label="剩余时间价值">{{
                  money(detail.currentCalculation.timeValueCents)
                }}</el-descriptions-item>
                <el-descriptions-item label="未消耗权益价值">{{
                  money(detail.currentCalculation.unusedValueCents)
                }}</el-descriptions-item>
                <el-descriptions-item :label="detail.change.snapshot.manualRefund ? '自助退款上限' : '当前估算上限'">{{
                  money(detail.currentCalculation.maxRefundCents)
                }}</el-descriptions-item>
                <el-descriptions-item :label="detail.change.snapshot.manualRefund ? '人工核定金额' : '已记录核定金额'">{{
                  money(detail.change.amountCents)
                }}</el-descriptions-item>
              </el-descriptions>
              <p v-if="detail.change.snapshot.manualRefund">本单为人工协商例外，自助退款限制不影响已记录的人工核定金额；操作依据保留在处理时间线中。</p>
              <p v-else>
                {{
                  ruleLabel(detail.currentCalculation.rule)
                }}；当前估算不覆盖已保存的审核快照。
              </p>
              <el-alert
                v-if="detail.currentCalculation.taskFrozenPoints > 0"
                title="该订阅有任务尚未结算，不能核定退款。"
                type="warning"
                :closable="false"
              />
              <h3>关联付款订单</h3>
              <el-table :data="detail.orders"
                ><el-table-column
                  prop="id"
                  label="平台订单号"
                  min-width="260" /><el-table-column
                  prop="providerOrderId"
                  label="渠道订单号"
                  min-width="180" /><el-table-column
                  label="实付 / 订单金额"
                  width="150"
                  ><template #default="{ row }">{{
                    money(row.amountCents)
                  }}</template></el-table-column
                ><el-table-column prop="status" label="订单状态" width="120"
              /></el-table>
            </el-tab-pane>
            <el-tab-pane name="ledger" label="积分流水">
              <p>
                余额变动与实际消费分别记录，结算不会重复扣减可用余额。
              </p>
              <el-table :data="detail.ledger"
                ><el-table-column label="时间" width="170"
                  ><template #default="{ row }">{{
                    formatTime(row.createdAt)
                  }}</template></el-table-column
                ><el-table-column
                  prop="sourceType"
                  label="业务来源"
                  min-width="180" /><el-table-column
                  prop="reason"
                  label="说明"
                  min-width="250" /><el-table-column
                  prop="deltaPoints"
                  label="余额变动"
                  width="100" /><el-table-column
                  prop="balanceAfterPoints"
                  label="变动后余额"
                  width="110" /><el-table-column
                  prop="sourceId"
                  label="关联记录"
                  min-width="240"
              /></el-table>
              <el-pagination class="subscription-admin-pagination" :current-page="detail.ledgerPage" :page-size="detail.ledgerLimit" :total="detail.ledgerTotal" layout="total, prev, pager, next" @current-change="changeLedgerPage" />
            </el-tab-pane>
            <el-tab-pane name="events" label="处理时间线">
              <el-timeline
                ><el-timeline-item
                  v-for="event in detail.events"
                  :key="event.id"
                  :timestamp="formatTime(event.occurredAt)"
                  ><strong
                    >{{ actionLabel(event.action) }} ·
                    {{ money(event.amountCents) }}</strong
                  >
                  <p>用户说明：{{ event.publicMessage }}</p>
                  <p class="subscription-audit-note">内部记录：{{ event.internalNote || "—" }}</p>
                  <p>操作人：{{ event.actorName || event.actorId || "用户 / 系统" }}</p>
                  <p v-if="event.calculation">
                    当时已用 {{ event.calculation.spentPoints }} 积分，核算上限
                    {{ money(event.calculation.maxRefundCents) }}
                  </p></el-timeline-item
                ></el-timeline
              >
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>
    <AdminDialog
      v-model="manualOpen"
      title="人工例外退款"
      :icon="CreditCard"
      width="1120px"
      :close-on-click-modal="false"
      :show-close="!manualSaving"
      :show-cancel="!manualSaving"
      confirm-text="核定退款并冻结积分"
      confirm-type="warning"
      :confirm-loading="manualSaving"
      :confirm-disabled="!manualReady"
      @confirm="submitManual"
    >
      <el-alert type="warning" :closable="false" title="仅供人工协商例外处理。登记不会向支付渠道发起退款，需渠道退款成功后另行确认。" />
      <el-form label-position="top" :disabled="manualSaving" class="manual-refund-form">
        <el-form-item label="平台订阅订单号" required>
          <el-input v-model="manualOrder" aria-label="平台订阅订单号" placeholder="原订阅或升级订单号" @input="invalidateManual" @keyup.enter="lookupManual">
            <template #append><el-button :icon="Search" :loading="manualLoading" @click="lookupManual">核对订单</el-button></template>
          </el-input>
        </el-form-item>
        <SubscriptionAuditTrail v-if="manualAuditOrder" :order-id="manualAuditOrder" :revision="manualAuditRevision" @ready="auditReady" />
        <template v-if="manualPreview">
          <el-descriptions :column="3" size="small">
            <el-descriptions-item label="自助退款额度">{{ money(manualPreview.calculation.maxRefundCents || 0) }}</el-descriptions-item>
            <el-descriptions-item label="剩余权益参考值">{{ manualReferenceValue==null?'待核对':money(manualReferenceValue) }}</el-descriptions-item>
            <el-descriptions-item label="资金硬上限">{{ money(manualPreview.maxManualAmountCents) }}</el-descriptions-item>
          </el-descriptions>
          <p>资金硬上限仅为累计实付减去已退，不代表扣除已消费、已履行权益后的应退金额。{{ ruleLabel(manualPreview.calculation.rule) }}</p>
          <el-alert v-if="manualPreview.calculation.taskFrozenPoints > 0 || manualPreview.calculation.protectedTopupFrozenPoints" type="error" :closable="false" title="该订阅或锁价额度包仍有进行中的任务，请等待结算后重新核对订单。" />
          <el-alert v-if="manualReferenceValue!=null && Number(manualAmount)*100>manualReferenceValue" type="warning" :closable="false" title="核定金额高于剩余权益参考值，可能包含已消费或已履行部分，请核对并在处理原因中记录协商依据。" />
          <el-form-item label="核定退款金额（元）" required>
            <el-input-number v-model="manualAmount" aria-label="人工核定退款金额" :min="0.01" :max="manualPreview.maxManualAmountCents / 100" :precision="2" :step="0.01" @change="manualConfirmed = false" />
          </el-form-item>
          <el-form-item label="内部例外处理原因" required>
            <el-input v-model="manualNote" aria-label="内部例外处理原因" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="记录协商依据及核定金额原因，不向用户展示" />
          </el-form-item>
          <el-checkbox v-model="manualConfirmed" class="subscription-refund-confirm">已核对用户、订阅和退款金额，确认按人工例外处理</el-checkbox>
        </template>
      </el-form>
    </AdminDialog>
    <AdminDialog
      v-model="dialog"
      :title="
        action === 'approve'
          ? '审核退订申请'
          : action === 'reject'
            ? '驳回退款申请'
            : '确认渠道退款结果'
      "
      :icon="CreditCard"
      width="520px"
      confirm-text="记录处理结果"
      :confirm-disabled="
        saving ||
        note.trim().length < 6 ||
        (action === 'confirm_external_refund' &&
          (!confirmed || reference.trim().length < 6))
      "
      @confirm="submit"
    >
      <p v-if="selected">
        {{ selected.snapshot.planName }} · 申请金额上限
        {{ money(selected.amountCents) }}
      </p>
      <el-alert
        v-if="action === 'approve'"
        type="warning"
        :closable="false"
        title="使用过订阅积分不可退款。申请提交后积分已冻结并暂停发放；通过审核不会自动向支付渠道发起退款。"
      />
      <el-alert
        v-if="action === 'reject'"
        type="warning"
        :closable="false"
        title="渠道未退款时才能驳回；已冻结的订阅权益将恢复。"
      />
      <el-form label-position="top">
        <el-form-item
          v-if="action === 'approve'"
          label="核定退款金额（元，留空按当前上限）"
          ><el-input-number
            v-model="approvedYuan"
            :min="0"
            :max="(selected?.amountCents || 0) / 100"
            :precision="2"
            :step="0.01"
        /></el-form-item>
        <el-form-item
          v-if="action === 'confirm_external_refund'"
          label="支付渠道退款流水号"
          required
          ><el-input v-model="reference" maxlength="128"
        /></el-form-item>
        <el-form-item label="内部核查说明" required
          ><el-input
            v-model="note"
            aria-label="内部核查说明"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
        /></el-form-item>
        <el-form-item label="用户可见说明（可选）"
          ><el-input
            v-model="customerMessage"
            aria-label="用户可见说明"
            type="textarea"
            :rows="2"
            maxlength="300"
            placeholder="留空使用标准进度说明，不会把内部记录发给用户"
        /></el-form-item>
        <el-checkbox
          v-if="action === 'confirm_external_refund'"
          v-model="confirmed"
          class="subscription-refund-confirm"
          >已在支付渠道核实退款成功，金额与审核结果一致</el-checkbox
        >
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
.manual-refund-form { margin-top: 18px; }
.manual-refund-form :deep(.el-descriptions) { margin-bottom: 18px; overflow-wrap: anywhere; }
.subscription-admin header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.subscription-admin-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}
.subscription-admin-filters > .el-input {
  max-width: 380px;
}
.subscription-admin-filters > .el-select {
  width: 160px;
}
.subscription-admin-pagination {
  margin-top: 18px;
  justify-content: flex-end;
}
.subscription-audit-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  font-size: 13px;
}
.subscription-audit-head p {
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.subscription-audit-note { white-space: pre-wrap; overflow-wrap: anywhere; }
.subscription-admin h2 {
  font-size: 18px;
  margin: 0;
}
.subscription-admin small {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.subscription-admin :deep(.el-form) {
  margin-top: 18px;
}
.subscription-refund-confirm {
  height: auto;
  align-items: flex-start;
  white-space: normal;
}
.subscription-refund-confirm :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.5;
}
</style>
