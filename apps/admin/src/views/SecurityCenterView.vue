<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from 'vue-router';
import { CircleCheck, Delete, Lock, Plus, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AdminDialog from "@/components/AdminDialog.vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";
import { formatTime } from "@/utils";

type Risk = {
  id: number;
  userId?: string;
  apiKeyId?: string;
  clientIp?: string;
  category: string;
  severity: string;
  score: number;
  action: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
type Block = { id: string; subjectType: string; subjectValue: string; scope: string; reason: string; expiresAt: string };
type HashRule = { sha256: string; reason: string; active: boolean; updatedAt: string };
type Reconciliation = {
  id: number;
  orderId: string;
  localStatus: string;
  providerState?: number;
  expectedAmountCents: number;
  providerAmountCents?: number;
  providerPaidAmountCents?: number;
  outcome: string;
  detail?: string;
  checkedAt: string;
};

const tab = ref("risks");
const router = useRouter();
const selectedRisk = ref<Risk | null>(null);
const riskDrawer = ref(false);
const relatedBlocks = computed(() => selectedRisk.value ? blocks.value.filter(block => [selectedRisk.value?.userId, selectedRisk.value?.apiKeyId, selectedRisk.value?.clientIp].includes(block.subjectValue)) : []);
function investigateRisk(item: Risk) { selectedRisk.value = item; riskDrawer.value = true }
function riskLogs(item: Risk) { void router.push({ path: '/platform-logs', query: { category: 'security', userId: item.userId || '', ip: item.clientIp || '', search: item.userId || item.clientIp ? '' : item.category } }) }
const loading = ref(false);
const loadError = ref('');
const loaded = ref(false);
const running = ref(false);
const reconciliationReport = ref('');
const risks = ref<Risk[]>([]);
const blocks = ref<Block[]>([]);
const hashes = ref<HashRule[]>([]);
const reconciliations = ref<Reconciliation[]>([]);
const hashDialog = ref(false);
const hashDraft = ref({ sha256: "", reason: "" });
const recoveryDialog = ref(false);
const recovering = ref(false);
const recoverySupported = ref(false);
const recoveryDraft = ref({ orderId: "", providerOrderId: "", resolution: "link", note: "" });

// 各表服务端分页；计数来自服务端（带上限，超过时显示"N+"），不再由已加载的前 200 条推算。
const PAGE_SIZE = 20;
const riskPage = ref(1);
const hashPage = ref(1);
const paymentPage = ref(1);
const riskTotal = ref(0);
const riskTotalCapped = ref(false);
const blockTotal = ref(0);
const blockTotalCapped = ref(false);
const hashTotal = ref(0);
const hashTotalCapped = ref(false);
const activeHashTotal = ref(0);
const activeHashCapped = ref(false);
const paymentTotal = ref(0);
const paymentIssueTotal = ref(0);
const countLabel = (value: number, capped: boolean) => `${value}${capped ? '+' : ''}`;
const unresolvedCount = computed(() => countLabel(riskTotal.value, riskTotalCapped.value));
const blockCount = computed(() => countLabel(blockTotal.value, blockTotalCapped.value));
const activeHashCount = computed(() => countLabel(activeHashTotal.value, activeHashCapped.value));
const paymentIssueCount = computed(() => paymentIssueTotal.value);

const tabs = computed(() => [
  { id: "risks", label: "风险事件", count: unresolvedCount.value, alert: riskTotal.value > 0 },
  { id: "blocks", label: "临时限制", count: blockCount.value, alert: false },
  { id: "uploads", label: "文件拦截", count: activeHashCount.value, alert: false },
  { id: "payments", label: "支付对账", count: String(paymentIssueCount.value), alert: paymentIssueCount.value > 0 },
]);

const categoryLabels: Record<string, string> = {
  login_bruteforce: "登录暴力尝试", api_key_abuse: "API Key 滥用", upload_blocked_hash: "违规文件上传",
  payment_amount_mismatch: "支付金额异常", redeem_bruteforce: "兑换码爆破", signup_burst: "批量注册",
};
const actionLabels: Record<string, string> = {
  ip_blocked: "已限制 IP", key_frozen: "已冻结 Key", upload_rejected: "已拒绝上传", order_held: "订单已暂扣",
  rate_limited: "已限流", observed: "仅记录",
};
const categoryLabel = (value: string) => categoryLabels[value] || value;
// 列表用紧凑时间（月-日 时:分），抽屉里保留完整时间。
const shortTime = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const actionLabel = (value: string) => actionLabels[value] || value || "—";

function points(value?: number) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `¥${(Number(value) / 100).toFixed(2)}`;
}

function severityType(value: string) {
  return ({ low: "info", medium: "warning", high: "danger", critical: "danger" } as Record<string, "info" | "warning" | "danger">)[value] || "info";
}

function severityLabel(value: string) {
  return ({ low: "低", medium: "中", high: "高", critical: "严重" } as Record<string, string>)[value] || value;
}

function outcomeType(value: string) {
  return ["matched", "manual_not_created"].includes(value) ? "success" : value === "repaired" ? "warning" : "danger";
}

function outcomeLabel(value: string) {
  return (
    ({
      matched: "一致",
      repaired: "已自动补单",
      provider_error: "上游查询失败",
      provider_id_missing: "待补充渠道单号",
      manual_not_created: "人工确认未建单",
      identity_or_amount_mismatch: "订单信息不一致",
      paid_amount_mismatch: "实付金额不一致",
      repair_failed: "补单失败",
      local_terminal_mismatch: "终态冲突",
      local_ahead: "本站状态超前",
    } as Record<string, string>)[value] || value
  );
}

function subjectLabel(value: string) {
  return ({ user: "用户", api_key: "API Key", ip: "IP", email: "邮箱" } as Record<string, string>)[value] || value;
}

function scopeLabel(value: string) {
  return ({ upload: "上传", login: "登录", payment: "支付", api: "接口", all: "全部" } as Record<string, string>)[value] || value;
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const [riskData, hashData, paymentData, issueData] = await Promise.all([
      request<{ items: Risk[]; activeBlocks: Block[]; total: number; totalCapped?: boolean; activeBlocksTotal: number; activeBlocksCapped?: boolean }>(
        "/api/v1/admin/security/risks", { query: { unresolved: true, page: riskPage.value, limit: PAGE_SIZE }, silent: true }),
      request<{ items: HashRule[]; total: number; totalCapped?: boolean; activeTotal: number; activeCapped?: boolean }>(
        "/api/v1/admin/security/upload-hashes", { query: { page: hashPage.value, limit: PAGE_SIZE }, silent: true }),
      request<{ items: Reconciliation[]; total: number; recoverySupported?: boolean }>(
        "/api/v1/admin/payment-reconciliations", { query: { issues: false, page: paymentPage.value, limit: PAGE_SIZE }, silent: true }),
      request<{ total: number }>("/api/v1/admin/payment-reconciliations", { query: { issues: true, page: 1, limit: 1 }, silent: true }),
    ]);
    risks.value = riskData.items || [];
    riskTotal.value = riskData.total ?? 0;
    riskTotalCapped.value = riskData.totalCapped === true;
    blocks.value = riskData.activeBlocks || [];
    blockTotal.value = riskData.activeBlocksTotal ?? blocks.value.length;
    blockTotalCapped.value = riskData.activeBlocksCapped === true;
    hashes.value = hashData.items || [];
    hashTotal.value = hashData.total ?? 0;
    hashTotalCapped.value = hashData.totalCapped === true;
    activeHashTotal.value = hashData.activeTotal ?? 0;
    activeHashCapped.value = hashData.activeCapped === true;
    reconciliations.value = paymentData.items || [];
    paymentTotal.value = paymentData.total ?? 0;
    paymentIssueTotal.value = issueData.total ?? 0;
    recoverySupported.value = paymentData.recoverySupported === true;
    loaded.value = true;
    // Resolving or removing the last row of a page leaves it empty: step back.
    const emptied = [
      [risks.value.length, riskPage] as const,
      [hashes.value.length, hashPage] as const,
      [reconciliations.value.length, paymentPage] as const,
    ].filter(([count, page]) => count === 0 && page.value > 1);
    if (emptied.length) {
      emptied.forEach(([, page]) => { page.value -= 1 });
      loading.value = false;
      await load();
      return;
    }
  } catch (error) {
    loadError.value = '安全数据读取失败，不能据此判断当前没有风险。';
    ElMessage.error(error instanceof Error ? error.message : "安全数据读取失败");
  } finally {
    loading.value = false;
  }
}

async function resolveRisk(item: Risk) {
  let value = '';
  try { const result = await ElMessageBox.prompt("填写本次核查结论", "记录处理结果", {
    inputPlaceholder: "已核实 / 误报 / 已联系用户",
    confirmButtonText: "标记已处理",
    inputValidator: (text) => Boolean(text.trim()) || '请填写处理结果',
  }); value = result.value; } catch { return }
  await request(`/api/v1/admin/security/risks/${item.id}/resolve`, { method: "POST", body: { note: value || "" } });
  risks.value = risks.value.filter(risk => risk.id !== item.id);
  riskDrawer.value = false;
  ElMessage.success("风险事件已处理");
  await load();
  if (!risks.value.some(risk => risk.id === item.id)) riskDrawer.value = false;
}

async function revokeBlock(item: Block) {
  await request(`/api/v1/admin/security/blocks/${item.id}/revoke`, { method: "POST" });
  blocks.value = blocks.value.filter(block => block.id !== item.id);
  ElMessage.success("临时限制已解除");
  await load();
}

async function unfreezeKey(id: string) {
  await request(`/api/v1/admin/security/api-keys/${id}/unfreeze`, { method: "POST" });
  ElMessage.success("API Key 已解冻");
  await load();
}

async function addHash() {
  await request("/api/v1/admin/security/upload-hashes", { method: "POST", body: hashDraft.value });
  hashDialog.value = false;
  hashDraft.value = { sha256: "", reason: "" };
  ElMessage.success("哈希黑名单已更新");
  await load();
}

async function removeHash(item: HashRule) {
  await ElMessageBox.confirm("停用这条文件哈希规则？", "确认操作", { type: "warning" });
  await request(`/api/v1/admin/security/upload-hashes/${item.sha256}`, { method: "DELETE" });
  ElMessage.success("规则已停用");
  await load();
}

async function runReconciliation() {
  if (running.value) return;
  running.value = true;
  reconciliationReport.value = '正在向渠道核对系统选出的最多 100 笔待核查订单…';
  try {
    const result = await request<{ checked: number; outcomes: Record<string, number> }>("/api/v1/admin/payment-reconciliations/run", { method: "POST" });
    ElMessage.success(`已核对 ${result.checked} 笔订单`);
    reconciliationReport.value = result.checked ? `检查 ${result.checked} 笔：` + Object.entries(result.outcomes || {}).map(([key, count]) => `${outcomeLabel(key)} ${count} 笔`).join('；') : '核对完成：没有符合本次批次条件的订单，不代表历史异常已解决。';
    await load();
  } catch (error) {
    reconciliationReport.value = `核对未完成：${error instanceof Error ? error.message : '请求失败'}`;
  } finally {
    running.value = false;
  }
}

function openRecovery(orderId = "") {
  if (recovering.value || !recoverySupported.value) return;
  recoveryDraft.value = { orderId, providerOrderId: "", resolution: "link", note: "" };
  recoveryDialog.value = true;
}

async function confirmNotCreated(orderId: string) {
  if (recovering.value || !recoverySupported.value) return;
  const { value: note } = await ElMessageBox.prompt(
    "请确认已在支付渠道后台核对：没有建立渠道订单，也没有收到款项。",
    "确认未建单",
    { inputPlaceholder: "例如：蓝鲸订单列表未找到，支付宝无收款记录", inputValidator: (value) => value.trim().length >= 6 ? true : "请填写至少 6 个字的核查说明", confirmButtonText: "确认并解除待核实", type: "warning" },
  );
  recovering.value = true;
  try {
    const result = await request<{ outcomes: Record<string, number> }>("/api/v1/admin/payment-reconciliations/run", {
      method: "POST", silent: true, body: { orderId, providerOrderId: "", resolution: "not_created", note: note.trim() },
    });
    const outcome = Object.keys(result.outcomes)[0];
    if (outcome === "manual_not_created") ElMessage.success("已解除待核实，用户可以重新支付");
    else ElMessage.warning(outcomeLabel(outcome || "provider_error"));
    await load();
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(error instanceof Error ? error.message : "订单处理失败");
  } finally { recovering.value = false; }
}

async function recoverPayment() {
  if (recovering.value || !recoverySupported.value) return;
  recovering.value = true;
  try {
    const notCreated = recoveryDraft.value.resolution === "not_created";
    if (notCreated) await ElMessageBox.confirm("仅在渠道后台已确认未建单、未收款时继续，查询超时不能作为未建单依据。操作将保留审计记录。", "确认核查结果", { type: "warning" });
    const result = await request<{ outcomes: Record<string, number> }>("/api/v1/admin/payment-reconciliations/run", {
      method: "POST", silent: true, body: { orderId: recoveryDraft.value.orderId.trim(), providerOrderId: notCreated ? "" : recoveryDraft.value.providerOrderId.trim(), resolution: notCreated ? "not_created" : "", note: recoveryDraft.value.note.trim() },
    });
    const outcome = Object.keys(result.outcomes)[0];
    if (["matched", "repaired", "manual_not_created"].includes(outcome || "")) {
      ElMessage.success(outcomeLabel(outcome));
      recoveryDialog.value = false;
    } else ElMessage.warning(outcomeLabel(outcome || "provider_error"));
    await load();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(error instanceof Error ? error.message : "订单核查失败");
  } finally { recovering.value = false; }
}

onMounted(() => void load());
</script>

<template>
  <div class="page security-page">
    <PageCard>
      <template #header>
        <div class="security-tabs" role="tablist" aria-label="安全视图">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            role="tab"
            class="security-tab"
            :class="{ 'is-active': tab === item.id, 'is-alert': item.alert }"
            :aria-selected="tab === item.id"
            @click="tab = item.id"
          >
            {{ item.label }}
            <em class="tnum">{{ loaded ? item.count : "—" }}</em>
          </button>
        </div>
      </template>
      <template #actions>
        <el-button v-if="tab === 'uploads'" type="primary" :icon="Plus" @click="hashDialog = true">添加规则</el-button>
        <el-button v-if="tab === 'payments'" type="primary" :icon="Search" :loading="running" @click="runReconciliation">立即核对</el-button>
        <el-button v-if="tab === 'payments' && recoverySupported" :icon="Plus" @click="openRecovery()">关联渠道单号</el-button>
        <el-button @click="router.push('/platform-logs?category=security')">安全日志</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>

      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-alert v-if="reconciliationReport" :title="reconciliationReport" type="info" closable @close="reconciliationReport = ''" />

      <div v-loading="loading" class="security-board">
        <el-table v-if="tab === 'risks'" :data="risks" height="100%" class="security-table is-clickable" empty-text="暂无未处理风险" @row-click="investigateRisk">
          <el-table-column label="等级" width="84">
            <template #default="{ row }"><el-tag :type="severityType(row.severity)" size="small" :effect="row.severity === 'critical' ? 'dark' : 'light'">{{ severityLabel(row.severity) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="分数" width="64" align="right">
            <template #default="{ row }"><span class="tnum" :class="{ 'is-bad': row.score >= 80 }">{{ row.score }}</span></template>
          </el-table-column>
          <el-table-column label="类型" width="130" show-overflow-tooltip>
            <template #default="{ row }"><strong>{{ categoryLabel(row.category) }}</strong></template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="260" show-overflow-tooltip />
          <el-table-column label="来源" min-width="150" show-overflow-tooltip>
            <template #default="{ row }"><span class="mono">{{ row.clientIp || row.userId || "—" }}</span></template>
          </el-table-column>
          <el-table-column label="已采取" width="110" show-overflow-tooltip>
            <template #default="{ row }"><span class="muted">{{ actionLabel(row.action) }}</span></template>
          </el-table-column>
          <el-table-column label="时间" width="116">
            <template #default="{ row }"><span class="tnum">{{ shortTime(row.createdAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="right">
            <template #default="{ row }">
              <el-button v-if="row.apiKeyId && row.action === 'key_frozen'" text size="small" type="warning" @click.stop="unfreezeKey(row.apiKeyId)">解冻 Key</el-button>
              <el-button text size="small" type="primary" @click.stop="investigateRisk(row as Risk)">核查</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="tab === 'blocks'" :data="blocks" height="100%" class="security-table" empty-text="当前没有临时限制">
          <el-table-column label="对象" width="100">
            <template #default="{ row }"><strong>{{ subjectLabel(row.subjectType) }}</strong></template>
          </el-table-column>
          <el-table-column label="标识" min-width="260" show-overflow-tooltip>
            <template #default="{ row }"><span class="mono">{{ row.subjectValue }}</span></template>
          </el-table-column>
          <el-table-column label="范围" width="90">
            <template #default="{ row }"><el-tag size="small" type="info">{{ scopeLabel(row.scope) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
          <el-table-column label="到期" width="116">
            <template #default="{ row }"><span class="tnum">{{ shortTime(row.expiresAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="right">
            <template #default="{ row }"><el-button text size="small" type="warning" @click="revokeBlock(row as Block)">解除</el-button></template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="tab === 'uploads'" :data="hashes" height="100%" class="security-table" empty-text="暂无哈希规则">
          <el-table-column label="SHA-256" min-width="300" show-overflow-tooltip>
            <template #default="{ row }"><span class="mono">{{ row.sha256 }}</span></template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag :type="row.active ? 'danger' : 'info'" size="small">{{ row.active ? "拦截中" : "已停用" }}</el-tag></template>
          </el-table-column>
          <el-table-column label="更新时间" width="116">
            <template #default="{ row }"><span class="tnum">{{ shortTime(row.updatedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="right">
            <template #default="{ row }"><el-button v-if="row.active" text size="small" type="danger" :icon="Delete" @click="removeHash(row as HashRule)">停用</el-button></template>
          </el-table-column>
        </el-table>

        <el-table v-else :data="reconciliations" height="100%" class="security-table" empty-text="尚未执行对账">
          <el-table-column label="订单" min-width="150" show-overflow-tooltip>
            <template #default="{ row }"><span class="mono">{{ row.orderId }}</span></template>
          </el-table-column>
          <el-table-column label="本站状态" width="96"><template #default="{ row }">{{ row.localStatus || "—" }}</template></el-table-column>
          <el-table-column label="本站金额" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.expectedAmountCents) }}</span></template></el-table-column>
          <el-table-column label="渠道实付" width="100" align="right">
            <template #default="{ row }"><span class="tnum" :class="{ 'is-bad': row.providerPaidAmountCents != null && row.providerPaidAmountCents !== row.expectedAmountCents }">{{ points(row.providerPaidAmountCents) }}</span></template>
          </el-table-column>
          <el-table-column label="结果" width="130">
            <template #default="{ row }"><el-tag :type="outcomeType(row.outcome)" :icon="row.outcome === 'matched' ? CircleCheck : undefined" size="small">{{ outcomeLabel(row.outcome) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="detail" label="说明" min-width="200" show-overflow-tooltip />
          <el-table-column label="核对时间" width="116"><template #default="{ row }"><span class="tnum">{{ shortTime(row.checkedAt) }}</span></template></el-table-column>
          <el-table-column label="处理" width="180" align="right">
            <template #default="{ row }">
              <el-button v-if="recoverySupported && row.outcome === 'provider_id_missing'" text size="small" type="success" @click="confirmNotCreated(row.orderId)">确认未建单</el-button>
              <el-button v-if="recoverySupported && row.outcome === 'provider_id_missing'" text size="small" @click="openRecovery(row.orderId)">补录单号</el-button>
              <el-button v-if="recoverySupported && ['close_result_unknown','provider_binding_failed','create_result_unknown'].includes(row.outcome)" text size="small" @click="openRecovery(row.orderId)">继续核查</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <p v-if="tab === 'blocks' && blockTotal > blocks.length" class="security-note">仅显示最新 {{ blocks.length }} 条，共 {{ blockCount }} 条生效限制。</p>
      <CursorPager
        v-if="tab === 'risks'"
        :has-prev="riskPage > 1" :has-next="riskPage * PAGE_SIZE < riskTotal" :loading="loading" :page="riskPage"
        :total="riskTotal" :total-capped="riskTotalCapped" :page-size="PAGE_SIZE" :page-sizes="[PAGE_SIZE]"
        @update:page="(value: number) => { riskPage = value; load() }"
      />
      <CursorPager
        v-else-if="tab === 'uploads'"
        :has-prev="hashPage > 1" :has-next="hashPage * PAGE_SIZE < hashTotal" :loading="loading" :page="hashPage"
        :total="hashTotal" :total-capped="hashTotalCapped" :page-size="PAGE_SIZE" :page-sizes="[PAGE_SIZE]"
        @update:page="(value: number) => { hashPage = value; load() }"
      />
      <CursorPager
        v-else-if="tab === 'payments'"
        :has-prev="paymentPage > 1" :has-next="paymentPage * PAGE_SIZE < Math.min(paymentTotal, 10000)" :loading="loading" :page="paymentPage"
        :total="Math.min(paymentTotal, 10000)" :total-capped="paymentTotal > 10000" :page-size="PAGE_SIZE" :page-sizes="[PAGE_SIZE]"
        @update:page="(value: number) => { paymentPage = value; load() }"
      />
    </PageCard>

    <el-drawer v-model="riskDrawer" size="min(620px, 96vw)" append-to-body class="risk-drawer">
      <template #header>
        <div v-if="selectedRisk" class="risk-head">
          <div class="risk-head__title">
            <el-tag :type="severityType(selectedRisk.severity)" size="small" :effect="selectedRisk.severity === 'critical' ? 'dark' : 'light'">{{ severityLabel(selectedRisk.severity) }} · {{ selectedRisk.score }}</el-tag>
            <strong>{{ categoryLabel(selectedRisk.category) }}</strong>
          </div>
          <span>#{{ selectedRisk.id }} · {{ formatTime(selectedRisk.createdAt) }}</span>
        </div>
      </template>
      <div v-if="selectedRisk" class="risk-investigation">
        <p class="risk-reason">{{ selectedRisk.reason }}</p>
        <dl class="risk-facts">
          <div><dt>来源 IP</dt><dd class="mono">{{ selectedRisk.clientIp || "未记录" }}</dd></div>
          <div><dt>已采取</dt><dd>{{ actionLabel(selectedRisk.action) }}</dd></div>
          <div v-if="selectedRisk.userId" class="is-wide"><dt>用户</dt><dd class="mono">{{ selectedRisk.userId }}</dd></div>
          <div v-if="selectedRisk.apiKeyId" class="is-wide"><dt>API Key</dt><dd class="mono">{{ selectedRisk.apiKeyId }}</dd></div>
        </dl>
        <div class="risk-actions">
          <el-button size="small" @click="riskLogs(selectedRisk)">关联日志</el-button>
          <el-button v-if="selectedRisk.userId" size="small" @click="router.push({ path: '/users', query: { search: selectedRisk.userId, userId: selectedRisk.userId } })">来源用户</el-button>
          <el-button v-if="typeof selectedRisk.metadata?.orderId === 'string'" size="small" @click="router.push({ path: '/orders', query: { search: String(selectedRisk.metadata.orderId), orderId: String(selectedRisk.metadata.orderId) } })">关联订单</el-button>
          <el-button v-if="selectedRisk.apiKeyId && selectedRisk.action === 'key_frozen'" size="small" type="warning" plain @click="unfreezeKey(selectedRisk.apiKeyId)">解冻 Key</el-button>
        </div>
        <section class="risk-section">
          <h4>关联的生效限制 <small class="tnum">{{ relatedBlocks.length }}</small></h4>
          <div v-for="block in relatedBlocks" :key="block.id" class="risk-block">
            <span><b>{{ scopeLabel(block.scope) }}</b> · {{ block.reason }}<small>到期 {{ formatTime(block.expiresAt) }}</small></span>
            <el-button size="small" type="warning" plain @click="revokeBlock(block)">解除</el-button>
          </div>
          <p v-if="!relatedBlocks.length" class="muted">没有匹配的临时限制。</p>
        </section>
        <details class="risk-evidence"><summary>原始证据</summary><pre>{{ JSON.stringify(selectedRisk.metadata, null, 2) }}</pre></details>
      </div>
      <template #footer>
        <el-button v-if="selectedRisk" type="primary" @click="resolveRisk(selectedRisk)">记录处理结果</el-button>
      </template>
    </el-drawer>

    <AdminDialog
      v-model="recoveryDialog" title="核查并恢复订单" :icon="Search" width="520px" confirm-text="核查订单"
      :confirm-loading="recovering" :show-close="!recovering" :show-cancel="!recovering" :close-on-click-modal="!recovering" :close-on-press-escape="!recovering"
      :confirm-disabled="recovering || !recoveryDraft.orderId.trim() || (recoveryDraft.resolution === 'link' ? !recoveryDraft.providerOrderId.trim() : recoveryDraft.note.trim().length < 6)" @confirm="recoverPayment"
    >
      <el-form label-position="top">
        <el-form-item label="平台订单号"><el-input v-model="recoveryDraft.orderId" :disabled="recovering" maxlength="36" /></el-form-item>
        <el-form-item label="核查方式"><el-radio-group v-model="recoveryDraft.resolution" :disabled="recovering"><el-radio-button value="link">关联渠道单号</el-radio-button><el-radio-button value="not_created">确认未建单</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="recoveryDraft.resolution === 'link'" label="渠道单号"><el-input v-model="recoveryDraft.providerOrderId" :disabled="recovering" maxlength="128" /></el-form-item>
        <el-form-item v-else label="渠道核查依据"><el-input v-model="recoveryDraft.note" type="textarea" :disabled="recovering" maxlength="300" show-word-limit /></el-form-item>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="hashDialog"
      title="添加文件哈希规则"
      subtitle="相同文件再次上传时会在写入 OSS 前被拦截"
      :icon="Lock"
      width="520px"
      confirm-text="保存"
      :confirm-disabled="hashDraft.sha256.length !== 64 || !hashDraft.reason.trim()"
      @confirm="addHash"
    >
      <el-form label-position="top">
        <el-form-item label="SHA-256">
          <el-input v-model="hashDraft.sha256" maxlength="64" placeholder="64 位十六进制摘要" />
        </el-form-item>
        <el-form-item label="拦截原因">
          <el-input v-model="hashDraft.reason" type="textarea" :rows="3" maxlength="300" show-word-limit />
        </el-form-item>
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
/* 卡片填满视口：表格在内部滚动，分页器固定在底部 */
.security-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow-y: auto; }
.security-page :deep(.page-card) { display: flex; flex: 1 1 0; flex-direction: column; min-height: 480px; overflow: hidden; }
.security-page :deep(.page-card__header) { flex-wrap: wrap; }
.security-page :deep(.page-card__actions) { flex-wrap: wrap; justify-content: flex-end; }
.security-page :deep(.page-card__body) { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }
.security-page :deep(.el-alert) { flex: 0 0 auto; }

.security-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface-2); }
.security-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: background 0.15s ease, color 0.15s ease; }
.security-tab:hover:not(.is-active) { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
.security-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.security-tab em { color: var(--ink-3); font-size: 12px; font-style: normal; font-weight: 700; }
.security-tab.is-alert em { color: var(--danger); }
.security-tab.is-active { background: var(--ink); color: var(--surface); box-shadow: var(--shadow-sm); }
.security-tab.is-active em { color: color-mix(in srgb, var(--surface) 78%, transparent); }
html.dark .security-tab.is-active { background: var(--surface-3); color: var(--ink); box-shadow: inset 0 0 0 1px var(--border-strong); }
html.dark .security-tab.is-active em { color: var(--ink-3); }

.security-board { flex: 1; min-height: 240px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.security-table { width: 100%; }
.security-table :deep(.cell) { white-space: nowrap; }
.security-table.is-clickable :deep(.el-table__row) { cursor: pointer; }
.security-note { flex: 0 0 auto; margin: 0; color: var(--ink-3); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.muted { color: var(--ink-3); }
.is-bad { color: var(--danger); font-weight: 650; }

.risk-head { display: grid; gap: 4px; min-width: 0; }
.risk-head__title { display: flex; align-items: center; gap: 8px; }
.risk-head strong { font-size: 16px; font-weight: 700; }
.risk-head > span { color: var(--ink-3); font-size: 12px; }
.risk-investigation { display: grid; gap: 16px; }
.risk-reason { margin: 0; padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--danger); border-radius: var(--radius-control); background: var(--surface-2); color: var(--ink); font-size: 14px; line-height: 1.6; }
.risk-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; margin: 0; }
.risk-facts > div { display: grid; gap: 2px; min-width: 0; }
.risk-facts > div.is-wide { grid-column: 1 / -1; }
.risk-facts dt { color: var(--ink-3); font-size: 12px; }
.risk-facts dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.risk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.risk-actions :deep(.el-button) { margin: 0; }
.risk-section { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.risk-section h4 { display: flex; align-items: baseline; gap: 6px; margin: 0; font-size: 13px; }
.risk-section h4 small { color: var(--ink-3); font-weight: 600; }
.risk-section p { margin: 0; font-size: 12px; }
.risk-block { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-control); font-size: 13px; }
.risk-block small { display: block; margin-top: 2px; color: var(--ink-3); font-size: 12px; }
.risk-evidence summary { color: var(--ink-2); font-size: 13px; cursor: pointer; }
.risk-evidence pre { max-height: 260px; margin: 8px 0 0; overflow: auto; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; }
</style>
