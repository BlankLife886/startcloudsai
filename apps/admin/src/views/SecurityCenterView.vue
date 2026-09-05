<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
const loading = ref(false);
const running = ref(false);
const risks = ref<Risk[]>([]);
const blocks = ref<Block[]>([]);
const hashes = ref<HashRule[]>([]);
const reconciliations = ref<Reconciliation[]>([]);
const hashDialog = ref(false);
const hashDraft = ref({ sha256: "", reason: "" });

const unresolvedCount = computed(() => risks.value.length);
const activeHashCount = computed(() => hashes.value.filter((item) => item.active).length);
const paymentIssueCount = computed(
  () => reconciliations.value.filter((item) => !["matched", "repaired"].includes(item.outcome)).length,
);

const tabs = computed(() => [
  { id: "risks", label: "风险与限制", count: unresolvedCount.value + blocks.value.length },
  { id: "uploads", label: "文件安全", count: activeHashCount.value },
  { id: "payments", label: "支付对账", count: paymentIssueCount.value },
]);

function points(value?: number) {
  return `${Math.max(0, Number(value) || 0).toLocaleString("zh-CN")} 分`;
}

function severityType(value: string) {
  return ({ low: "info", medium: "warning", high: "danger", critical: "danger" } as Record<string, "info" | "warning" | "danger">)[value] || "info";
}

function severityLabel(value: string) {
  return ({ low: "低", medium: "中", high: "高", critical: "严重" } as Record<string, string>)[value] || value;
}

function outcomeType(value: string) {
  return value === "matched" ? "success" : value === "repaired" ? "warning" : "danger";
}

function outcomeLabel(value: string) {
  return (
    ({
      matched: "一致",
      repaired: "已自动补单",
      provider_error: "上游查询失败",
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
  try {
    const [riskData, hashData, paymentData] = await Promise.all([
      request<{ items: Risk[]; activeBlocks: Block[] }>("/api/v1/admin/security/risks", { query: { unresolved: true, limit: 200 }, silent: true }),
      request<{ items: HashRule[] }>("/api/v1/admin/security/upload-hashes", { query: { limit: 200 }, silent: true }),
      request<{ items: Reconciliation[] }>("/api/v1/admin/payment-reconciliations", { query: { issues: false, limit: 200 }, silent: true }),
    ]);
    risks.value = riskData.items || [];
    blocks.value = riskData.activeBlocks || [];
    hashes.value = hashData.items || [];
    reconciliations.value = paymentData.items || [];
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "安全数据读取失败");
  } finally {
    loading.value = false;
  }
}

async function resolveRisk(item: Risk) {
  const { value } = await ElMessageBox.prompt("填写处理说明（可留空）", "处理风险事件", {
    inputPlaceholder: "已核实 / 误报 / 已联系用户",
    confirmButtonText: "标记已处理",
  });
  await request(`/api/v1/admin/security/risks/${item.id}/resolve`, { method: "POST", body: { note: value || "" } });
  ElMessage.success("风险事件已处理");
  await load();
}

async function revokeBlock(item: Block) {
  await request(`/api/v1/admin/security/blocks/${item.id}/revoke`, { method: "POST" });
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
  running.value = true;
  try {
    const result = await request<{ checked: number; outcomes: Record<string, number> }>("/api/v1/admin/payment-reconciliations/run", { method: "POST" });
    ElMessage.success(`已核对 ${result.checked} 笔订单`);
    await load();
  } finally {
    running.value = false;
  }
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
      </template>

      <section class="security-kpis" aria-label="安全摘要">
        <article :class="{ 'is-warn': unresolvedCount > 0 }">
          <small>未处理风险</small>
          <strong class="tnum">{{ unresolvedCount }}</strong>
        </article>
        <article :class="{ 'is-warn': blocks.length > 0 }">
          <small>临时限制</small>
          <strong class="tnum">{{ blocks.length }}</strong>
        </article>
        <article>
          <small>拦截规则</small>
          <strong class="tnum">{{ activeHashCount }}</strong>
        </article>
        <article :class="{ 'is-bad': paymentIssueCount > 0 }">
          <small>对账异常</small>
          <strong class="tnum">{{ paymentIssueCount }}</strong>
        </article>
      </section>

      <p class="security-legend">
        未处理风险
        <em class="tnum">{{ unresolvedCount }}</em>
        条，生效限制
        <em class="tnum">{{ blocks.length }}</em>
        条，文件拦截
        <em class="tnum">{{ activeHashCount }}</em>
        条。对账仅自动修复金额完全一致的待支付订单，其余留人工核查。
        <span v-if="paymentIssueCount" class="is-bad">{{ paymentIssueCount }} 笔需要对账。</span>
      </p>

      <div class="security-toolbar">
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
            <el-table :data="blocks" height="100%" empty-text="当前没有临时限制">
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
          </section>
          <section class="security-board">
            <header>
              <strong>未处理风险事件</strong>
              <small>处理后会从当前列表移除</small>
            </header>
            <el-table :data="risks" height="100%" empty-text="暂无未处理风险">
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
                  <el-button text size="small" @click="resolveRisk(row as Risk)">处理</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </div>

        <section v-else-if="tab === 'uploads'" class="security-board">
          <header>
            <strong>上传文件哈希黑名单</strong>
            <small>相同文件再次上传时会在写入 OSS 前被拦截</small>
          </header>
          <el-table :data="hashes" height="100%" empty-text="暂无哈希规则">
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
        </section>

        <section v-else class="security-board">
          <header>
            <strong>支付订单主动对账</strong>
            <small>仅自动修复金额完全一致的待支付订单</small>
          </header>
          <el-table :data="reconciliations" height="100%" empty-text="尚未执行对账">
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
          </el-table>
        </section>
      </div>
    </PageCard>

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
</style>
