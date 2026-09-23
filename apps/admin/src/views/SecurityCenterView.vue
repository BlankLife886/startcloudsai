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
  { id: "risks", label: "风险与限制", count: countLabel(riskTotal.value + blockTotal.value, riskTotalCapped.value || blockTotalCapped.value) },
  { id: "uploads", label: "文件安全", count: activeHashCount.value },
  { id: "payments", label: "支付对账", count: paymentIssueCount.value },
]);

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
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="tab === 'uploads'" type="primary" :icon="Plus" @click="hashDialog = true">添加规则</el-button>
        <el-button v-if="tab === 'payments'" type="primary" :icon="Search" :loading="running" @click="runReconciliation">立即核对</el-button>
        <el-button v-if="tab === 'payments' && recoverySupported" :icon="Plus" @click="openRecovery()">关联渠道单号</el-button>
      </template>

      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-alert v-if="reconciliationReport" :title="reconciliationReport" type="info" :closable="false" />
      <section class="security-kpis" aria-label="安全摘要">
        <article :class="{ 'is-warn': riskTotal > 0 }">
          <small>未处理风险</small>
          <strong class="tnum">{{ loaded && !loadError ? unresolvedCount : '—' }}</strong>
        </article>
        <article :class="{ 'is-warn': blockTotal > 0 }">
          <small>临时限制</small>
          <strong class="tnum">{{ loaded && !loadError ? blockCount : '—' }}</strong>
        </article>
        <article>
          <small>拦截规则</small>
          <strong class="tnum">{{ loaded && !loadError ? activeHashCount : '—' }}</strong>
        </article>
        <article :class="{ 'is-bad': paymentIssueCount > 0 }">
          <small>对账异常</small>
          <strong class="tnum">{{ loaded && !loadError ? paymentIssueCount : '—' }}</strong>
        </article>
      </section>

      <p class="security-legend">
        未处理风险
        <em class="tnum">{{ unresolvedCount }}</em>
        条，生效限制
        <em class="tnum">{{ blockCount }}</em>
        条，文件拦截
        <em class="tnum">{{ activeHashCount }}</em>
        条。自动修复必须通过渠道订单身份、金额和支付方式校验，其余留人工核查。
        <span v-if="paymentIssueCount" class="is-bad">{{ paymentIssueCount }} 笔需要对账。</span>
      </p>

      <div class="security-toolbar">
        <RouterLink class="security-log-link" to="/platform-logs?category=security">查看安全日志 →</RouterLink>
        <div class="security-tabs" role="tablist" aria-label="安全视图">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            role="tab"
            class="security-tab"
            :class="{ 'is-active': tab === item.id }"
            :aria-selected="tab === item.id"
            @click="tab = item.id"
          >
            {{ item.label }}
            <em class="tnum">{{ item.count }}</em>
          </button>
        </div>
      </div>

      <div v-loading="loading" class="security-stage">
        <div v-if="tab === 'risks'" class="security-split">
          <section class="security-board">
            <header>
              <strong>生效中的临时限制</strong>
              <small>到期前会拦截对应对象</small>
            </header>
            <el-table :data="blocks" max-height="420" empty-text="当前没有临时限制">
              <el-table-column label="对象" min-width="220">
                <template #default="{ row }">
                  <div class="security-cell">
                    <strong>{{ subjectLabel(row.subjectType) }}</strong>
                    <small class="mono">{{ row.subjectValue }}</small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="范围" width="100">
                <template #default="{ row }">{{ scopeLabel(row.scope) }}</template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
              <el-table-column label="到期" width="170">
                <template #default="{ row }"><span class="tnum">{{ formatTime(row.expiresAt) }}</span></template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ row }">
                  <el-button text size="small" @click="revokeBlock(row as Block)">解除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <p v-if="blockTotal > blocks.length" class="security-note">仅显示最新 {{ blocks.length }} 条生效限制，共 {{ blockCount }} 条。</p>
          </section>
          <section class="security-board">
            <header>
              <strong>未处理风险事件</strong>
              <small>处理后会从当前列表移除</small>
            </header>
            <el-table :data="risks" max-height="420" empty-text="暂无未处理风险">
              <el-table-column label="等级" width="110">
                <template #default="{ row }">
                  <el-tag :type="severityType(row.severity)" effect="light" size="small">
                    {{ severityLabel(row.severity) }} · {{ row.score }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="category" label="类型" width="180" />
              <el-table-column prop="reason" label="原因" min-width="240" show-overflow-tooltip />
              <el-table-column label="来源" min-width="200">
                <template #default="{ row }">
                  <span class="mono">{{ row.clientIp || row.userId || "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="170">
                <template #default="{ row }"><span class="tnum">{{ formatTime(row.createdAt) }}</span></template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.apiKeyId && row.action === 'key_frozen'" text size="small" type="warning" @click="unfreezeKey(row.apiKeyId)">
                    解冻 Key
                  </el-button>
                  <el-button text size="small" type="primary" @click="investigateRisk(row as Risk)">核查处理</el-button>
                </template>
              </el-table-column>
            </el-table>
            <CursorPager
              v-if="riskTotal > PAGE_SIZE"
              :has-prev="riskPage > 1"
              :has-next="riskPage * PAGE_SIZE < riskTotal"
              :loading="loading"
              :page="riskPage"
              :total="riskTotal"
              :total-capped="riskTotalCapped"
              :page-size="PAGE_SIZE"
              :page-sizes="[PAGE_SIZE]"
              @update:page="(value: number) => { riskPage = value; load() }"
            />
          </section>
        </div>

        <section v-else-if="tab === 'uploads'" class="security-board">
          <header>
            <strong>上传文件哈希黑名单</strong>
            <small>相同文件再次上传时会在写入 OSS 前被拦截</small>
          </header>
          <el-table :data="hashes" max-height="420" empty-text="暂无哈希规则">
            <el-table-column label="SHA-256" min-width="340">
              <template #default="{ row }"><span class="mono">{{ row.sha256 }}</span></template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="240" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.active ? 'danger' : 'info'" effect="light" size="small">
                  {{ row.active ? "拦截中" : "已停用" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="170">
              <template #default="{ row }"><span class="tnum">{{ formatTime(row.updatedAt) }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.active" text size="small" type="danger" :icon="Delete" @click="removeHash(row as HashRule)">停用</el-button>
              </template>
            </el-table-column>
          </el-table>
          <CursorPager
            v-if="hashTotal > PAGE_SIZE"
            :has-prev="hashPage > 1"
            :has-next="hashPage * PAGE_SIZE < hashTotal"
            :loading="loading"
            :page="hashPage"
            :total="hashTotal"
            :total-capped="hashTotalCapped"
            :page-size="PAGE_SIZE"
            :page-sizes="[PAGE_SIZE]"
            @update:page="(value: number) => { hashPage = value; load() }"
          />
        </section>

        <section v-else class="security-board">
          <header>
            <strong>支付订单主动对账</strong>
            <small>优先核对未结订单，缺少渠道单号的记录需人工核查</small>
          </header>
          <el-table :data="reconciliations" max-height="420" empty-text="尚未执行对账">
            <el-table-column label="订单" min-width="220">
              <template #default="{ row }"><span class="mono">{{ row.orderId }}</span></template>
            </el-table-column>
            <el-table-column prop="localStatus" label="本站状态" width="110" />
            <el-table-column label="金额" width="240">
              <template #default="{ row }">
                <div class="security-cell">
                  <strong>本站 {{ points(row.expectedAmountCents) }}</strong>
                  <small>上游 {{ points(row.providerPaidAmountCents) }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="150">
              <template #default="{ row }">
                <el-tag :type="outcomeType(row.outcome)" :icon="row.outcome === 'matched' ? CircleCheck : undefined" effect="light" size="small">
                  {{ outcomeLabel(row.outcome) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="说明" min-width="220" show-overflow-tooltip />
            <el-table-column label="核对时间" width="170">
              <template #default="{ row }"><span class="tnum">{{ formatTime(row.checkedAt) }}</span></template>
            </el-table-column>
            <el-table-column label="处理" width="130" fixed="right">
              <template #default="{ row }">
                <el-button v-if="recoverySupported && row.outcome === 'provider_id_missing'" text type="success" @click="confirmNotCreated(row.orderId)">确认未建单</el-button>
                <el-button v-if="recoverySupported && row.outcome === 'provider_id_missing'" text @click="openRecovery(row.orderId)">补录渠道单号</el-button>
                <el-button v-if="recoverySupported && ['close_result_unknown','provider_binding_failed','create_result_unknown'].includes(row.outcome)" text @click="openRecovery(row.orderId)">继续核查</el-button>
              </template>
            </el-table-column>
          </el-table>
          <CursorPager
            v-if="paymentTotal > PAGE_SIZE"
            :has-prev="paymentPage > 1"
            :has-next="paymentPage * PAGE_SIZE < Math.min(paymentTotal, 10000)"
            :loading="loading"
            :page="paymentPage"
            :total="Math.min(paymentTotal, 10000)"
            :total-capped="paymentTotal > 10000"
            :page-size="PAGE_SIZE"
            :page-sizes="[PAGE_SIZE]"
            @update:page="(value: number) => { paymentPage = value; load() }"
          />
        </section>
      </div>
    </PageCard>
    <el-drawer v-model="riskDrawer" title="风险核查" size="min(660px, 96vw)" append-to-body>
      <div v-if="selectedRisk" class="risk-investigation">
        <el-tag :type="severityType(selectedRisk.severity)">{{ severityLabel(selectedRisk.severity) }}风险 · #{{ selectedRisk.id }}</el-tag>
        <h3>{{ selectedRisk.reason }}</h3>
        <div class="risk-actions"><el-button type="primary" @click="riskLogs(selectedRisk)">查看关联日志</el-button><el-button v-if="selectedRisk.userId" @click="router.push({ path: '/users', query: { search: selectedRisk.userId, userId: selectedRisk.userId } })">查看来源用户</el-button><el-button v-if="typeof selectedRisk.metadata?.orderId === 'string'" @click="router.push({ path: '/orders', query: { search: String(selectedRisk.metadata.orderId), orderId: String(selectedRisk.metadata.orderId) } })">查看关联订单</el-button></div>
        <dl><dt>发生时间</dt><dd>{{ formatTime(selectedRisk.createdAt) }}</dd><dt>来源 IP</dt><dd>{{ selectedRisk.clientIp || '未记录' }}</dd><dt>触发动作</dt><dd>{{ selectedRisk.action }}</dd></dl>
        <h4>关联的生效限制</h4>
        <div v-for="block in relatedBlocks" :key="block.id" class="risk-block"><span>{{ scopeLabel(block.scope) }} · {{ block.reason }}<small>到期 {{ formatTime(block.expiresAt) }}</small></span><el-button type="warning" plain @click="revokeBlock(block)">解除此限制</el-button></div>
        <p v-if="!relatedBlocks.length">当前没有读取到匹配的临时限制。</p>
        <el-button v-if="selectedRisk.apiKeyId && selectedRisk.action === 'key_frozen'" type="warning" @click="unfreezeKey(selectedRisk.apiKeyId)">解冻关联 Key</el-button>
        <details><summary>原始证据</summary><pre>{{ JSON.stringify(selectedRisk.metadata, null, 2) }}</pre></details>
        <el-button type="primary" @click="resolveRisk(selectedRisk)">记录处理结果</el-button>
      </div>
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
.security-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}
.security-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.security-page :deep(.page-card__header) {
  flex-wrap: wrap;
  align-items: flex-start;
}
.security-page :deep(.page-card__actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.security-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  overflow: hidden;
}
.security-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.security-kpis article {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
}
.security-kpis article:last-child {
  border-right: 0;
}
.security-kpis small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.security-kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.security-kpis article.is-warn strong {
  color: var(--warning);
}
.security-kpis article.is-bad strong,
.security-legend .is-bad {
  color: var(--danger);
}
.security-legend {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.security-legend em {
  margin: 0 2px;
  color: var(--ink);
  font-style: normal;
  font-weight: 750;
}
.security-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.security-tabs {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}
.security-tabs::-webkit-scrollbar {
  display: none;
}
.security-tab {
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
.security-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.security-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}
.security-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}
.security-stage {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.security-split {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-rows: minmax(180px, 0.7fr) minmax(240px, 1.3fr);
  gap: 10px;
}
.security-board {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.security-board header {
  display: grid;
  gap: 2px;
  padding: 12px 14px 10px;
}
.security-board header strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}
.security-board header small {
  color: var(--ink-3);
  font-size: 12px;
}
.security-board :deep(.el-table) {
  flex: 1;
}
.security-cell {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.security-cell strong,
.security-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.security-cell strong {
  color: var(--ink);
  font-size: 13px;
}
.security-cell small {
  color: var(--ink-3);
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, monospace;
  overflow-wrap: anywhere;
}
@media (max-width: 1080px) {
  .security-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .security-kpis article:nth-child(2) {
    border-right: 0;
  }
  .security-kpis article:nth-child(n + 3) {
    border-top: 1px solid var(--border);
  }
  .security-split {
    grid-template-rows: minmax(200px, 1fr) minmax(240px, 1fr);
  }
}
@media (max-width: 720px) {
  .security-kpis {
    grid-template-columns: 1fr;
  }
  .security-kpis article {
    border-right: 0;
    border-top: 1px solid var(--border);
  }
  .security-kpis article:first-child {
    border-top: 0;
  }
}
.security-page { overflow-y:auto; }
.security-log-link { color:var(--accent-ink);font-size:12px;text-decoration:none; }
.risk-investigation { display:grid;gap:16px;color:var(--ink-2); }.risk-investigation h3,.risk-investigation h4,.risk-investigation p { margin:0; }.risk-actions { display:flex;gap:8px;flex-wrap:wrap; }.risk-actions :deep(.el-button) {margin:0}.risk-investigation dl {display:grid;grid-template-columns:90px 1fr;gap:12px}.risk-investigation dd{margin:0;overflow-wrap:anywhere}.risk-block{display:flex;justify-content:space-between;gap:12px;padding:12px;background:var(--surface-2);border-radius:8px}.risk-block small{display:block;margin-top:6px}.risk-investigation pre{white-space:pre-wrap;overflow-wrap:anywhere}
.security-page :deep(.page-card) { flex:0 0 auto;min-height:100%; }
.security-stage { flex:0 0 auto;min-height:0; }
.security-split { display:flex;flex-direction:column;min-height:0; }
.security-split > .security-board:first-child { order:2; }
.security-split > .security-board:last-child { order:1; }
.security-board { min-height:180px;flex:0 0 auto; }
.security-note { margin: 8px 0 0; color: var(--ink-3); font-size: 12px; }
</style>
