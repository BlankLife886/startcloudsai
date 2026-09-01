<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { CircleCheck, Delete, Lock, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { request } from "@/request";

type Risk = { id: number; userId?: string; apiKeyId?: string; clientIp?: string; category: string; severity: string; score: number; action: string; reason: string; metadata: Record<string, unknown>; createdAt: string };
type Block = { id: string; subjectType: string; subjectValue: string; scope: string; reason: string; expiresAt: string };
type HashRule = { sha256: string; reason: string; active: boolean; updatedAt: string };
type Reconciliation = { id: number; orderId: string; localStatus: string; providerState?: number; expectedAmountCents: number; providerAmountCents?: number; providerPaidAmountCents?: number; outcome: string; detail?: string; checkedAt: string };

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

function time(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—"; }
function points(value?: number) { return `${Math.max(0, Number(value) || 0).toLocaleString("zh-CN")} 分`; }
function severityType(value: string) { return ({ low: "info", medium: "warning", high: "danger", critical: "danger" } as Record<string, "info" | "warning" | "danger">)[value] || "info"; }
function outcomeType(value: string) { return value === "matched" ? "success" : value === "repaired" ? "warning" : "danger"; }
function outcomeLabel(value: string) { return ({ matched: "一致", repaired: "已自动补单", provider_error: "上游查询失败", identity_or_amount_mismatch: "订单信息不一致", paid_amount_mismatch: "实付金额不一致", repair_failed: "补单失败", local_terminal_mismatch: "终态冲突", local_ahead: "本站状态超前" } as Record<string, string>)[value] || value; }

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
  } finally { loading.value = false; }
}

async function resolveRisk(item: any) {
  const { value } = await ElMessageBox.prompt("填写处理说明（可留空）", "处理风险事件", { inputPlaceholder: "已核实 / 误报 / 已联系用户", confirmButtonText: "标记已处理" });
  await request(`/api/v1/admin/security/risks/${item.id}/resolve`, { method: "POST", body: { note: value || "" } });
  ElMessage.success("风险事件已处理");
  await load();
}

async function revokeBlock(item: any) {
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

async function removeHash(item: any) {
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
  } finally { running.value = false; }
}

onMounted(() => void load());
</script>

<template>
  <main class="security-page">
    <header class="page-head">
      <div><h1>安全中心</h1><p>查看自动风控、文件安全与支付对账结果</p></div>
      <el-button :icon="Refresh" :loading="loading" circle title="刷新" @click="load" />
    </header>

    <section class="security-summary">
      <div><span>未处理风险</span><strong>{{ unresolvedCount }}</strong></div>
      <div><span>生效中的临时限制</span><strong>{{ blocks.length }}</strong></div>
      <div><span>文件哈希规则</span><strong>{{ hashes.filter(item => item.active).length }}</strong></div>
      <div><span>支付对账异常</span><strong>{{ reconciliations.filter(item => !['matched', 'repaired'].includes(item.outcome)).length }}</strong></div>
    </section>

    <el-tabs v-model="tab" class="security-tabs">
      <el-tab-pane label="风险与限制" name="risks">
        <h2>生效中的临时限制</h2>
        <el-table :data="blocks" empty-text="当前没有临时限制">
          <el-table-column label="对象" min-width="220"><template #default="{ row }"><code>{{ row.subjectType }} · {{ row.subjectValue }}</code></template></el-table-column>
          <el-table-column prop="scope" label="范围" width="120" />
          <el-table-column prop="reason" label="原因" min-width="260" show-overflow-tooltip />
          <el-table-column label="到期" width="180"><template #default="{ row }">{{ time(row.expiresAt) }}</template></el-table-column>
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="revokeBlock(row)">解除</el-button></template></el-table-column>
        </el-table>

        <h2>未处理风险事件</h2>
        <el-table :data="risks" empty-text="暂无未处理风险">
          <el-table-column label="等级" width="92"><template #default="{ row }"><el-tag :type="severityType(row.severity)" effect="light">{{ row.severity }} · {{ row.score }}</el-tag></template></el-table-column>
          <el-table-column prop="category" label="类型" width="190" />
          <el-table-column prop="reason" label="原因" min-width="260" show-overflow-tooltip />
          <el-table-column label="来源" min-width="220"><template #default="{ row }"><code>{{ row.clientIp || row.userId || '—' }}</code></template></el-table-column>
          <el-table-column label="时间" width="180"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" width="150"><template #default="{ row }"><el-button v-if="row.apiKeyId && row.action === 'key_frozen'" link type="warning" @click="unfreezeKey(row.apiKeyId)">解冻 Key</el-button><el-button link type="primary" @click="resolveRisk(row)">处理</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="文件安全" name="uploads">
        <div class="section-head"><div><h2>上传文件哈希黑名单</h2><p>相同文件再次上传时会在写入 OSS 前被拦截。</p></div><el-button type="primary" :icon="Lock" @click="hashDialog = true">添加规则</el-button></div>
        <el-table :data="hashes" empty-text="暂无哈希规则">
          <el-table-column label="SHA-256" min-width="340"><template #default="{ row }"><code>{{ row.sha256 }}</code></template></el-table-column>
          <el-table-column prop="reason" label="原因" min-width="260" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.active ? 'danger' : 'info'">{{ row.active ? '拦截中' : '已停用' }}</el-tag></template></el-table-column>
          <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ time(row.updatedAt) }}</template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button v-if="row.active" :icon="Delete" link type="danger" @click="removeHash(row)" /></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="支付对账" name="payments">
        <div class="section-head"><div><h2>支付订单主动对账</h2><p>仅自动修复金额完全一致的待支付订单，其他异常保留人工核查。</p></div><el-button type="primary" :icon="Search" :loading="running" @click="runReconciliation">立即核对</el-button></div>
        <el-table :data="reconciliations" empty-text="尚未执行对账">
          <el-table-column label="订单" min-width="230"><template #default="{ row }"><code>{{ row.orderId }}</code></template></el-table-column>
          <el-table-column prop="localStatus" label="本站状态" width="110" />
          <el-table-column label="金额" width="220"><template #default="{ row }">本站 {{ points(row.expectedAmountCents) }} / 上游 {{ points(row.providerPaidAmountCents) }}</template></el-table-column>
          <el-table-column label="结果" width="150"><template #default="{ row }"><el-tag :type="outcomeType(row.outcome)" :icon="row.outcome === 'matched' ? CircleCheck : undefined">{{ outcomeLabel(row.outcome) }}</el-tag></template></el-table-column>
          <el-table-column prop="detail" label="说明" min-width="240" show-overflow-tooltip />
          <el-table-column label="核对时间" width="180"><template #default="{ row }">{{ time(row.checkedAt) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="hashDialog" title="添加文件哈希规则" width="520px">
      <el-form label-position="top"><el-form-item label="SHA-256"><el-input v-model="hashDraft.sha256" maxlength="64" /></el-form-item><el-form-item label="拦截原因"><el-input v-model="hashDraft.reason" type="textarea" maxlength="300" show-word-limit /></el-form-item></el-form>
      <template #footer><el-button @click="hashDialog = false">取消</el-button><el-button type="primary" :disabled="hashDraft.sha256.length !== 64 || !hashDraft.reason.trim()" @click="addHash">保存</el-button></template>
    </el-dialog>
  </main>
</template>

<style scoped>
.security-page { display: grid; gap: 20px; }
.page-head,.section-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
h1,h2,p { margin: 0; }
h1 { font-size: 24px; }
h2 { margin: 18px 0 12px; font-size: 16px; }
p { color: var(--el-text-color-secondary); margin-top: 6px; }
.security-summary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); border: 1px solid var(--el-border-color-light); }
.security-summary div { padding: 16px 18px; border-right: 1px solid var(--el-border-color-light); }
.security-summary div:last-child { border-right: 0; }
.security-summary span,.security-summary strong { display: block; }
.security-summary span { color: var(--el-text-color-secondary); font-size: 13px; }
.security-summary strong { margin-top: 8px; font-size: 24px; }
.security-tabs { min-width: 0; }
code { font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .security-summary { grid-template-columns: repeat(2,minmax(0,1fr)); }.security-summary div:nth-child(2){border-right:0}.section-head{align-items:flex-start;flex-direction:column} }
</style>
