<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { DataAnalysis, Refresh, VideoPlay, View } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { isRequestAborted, request } from "@/request";

type AgentWorkspace = "assistant" | "canvas";

interface QualitySummary {
  totalTraces: number;
  succeededTraces: number;
  failedTraces: number;
  canceledTraces: number;
  runningTraces: number;
  averageScore: number;
  averageDurationMs: number;
  toolSteps: number;
  failedSteps: number;
  unfinishedSteps: number;
  confirmedSteps: number;
}

interface QualityVersion {
  workspace: AgentWorkspace;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  toolVersion: string;
  traceCount: number;
  succeeded: number;
  failed: number;
  averageScore: number;
  averageDurationMs: number;
}

interface TraceRow {
  id: string;
  runId: string;
  userEmail: string;
  workspace: AgentWorkspace;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  toolVersion: string;
  status: string;
  score?: number | null;
  stepCount: number;
  failedSteps: number;
  unfinishedSteps: number;
  durationMs: number;
  checkpointId?: string | null;
  startedAt: string;
}

interface EvalCase {
  id: string;
  key: string;
  workspace: AgentWorkspace;
  category: string;
  title: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  active: boolean;
}

interface EvalRun {
  id: string;
  workspace: AgentWorkspace;
  model: string;
  reasoningEffort: string;
  promptVersion: string;
  toolVersion: string;
  status: string;
  total: number;
  passed: number;
  score: number;
  sampleSize: number;
  startedAt: string;
}

interface Overview {
  days: number;
  workspace: AgentWorkspace;
  summary: QualitySummary;
  versions: QualityVersion[];
  traces: TraceRow[];
  evalCases: EvalCase[];
  evalRuns: EvalRun[];
}

interface TraceDetail extends TraceRow {
  initialSnapshot: Record<string, unknown>;
  visualSummary: Record<string, unknown>;
  goalContract: Record<string, unknown>;
  steps: Array<{
    id: string;
    sequence: number;
    toolName: string;
    status: string;
    arguments: unknown;
    result: unknown;
    requiresConfirmation: boolean;
    durationMs: number;
    errorMessage?: string | null;
  }>;
}

interface EvalRunDetail {
  run: EvalRun;
  results: Array<{
    case: EvalCase;
    traceId?: string | null;
    passed: boolean;
    score: number;
    metrics: Record<string, unknown>;
    errorMessage?: string | null;
  }>;
}

const emptySummary: QualitySummary = {
  totalTraces: 0,
  succeededTraces: 0,
  failedTraces: 0,
  canceledTraces: 0,
  runningTraces: 0,
  averageScore: 0,
  averageDurationMs: 0,
  toolSteps: 0,
  failedSteps: 0,
  unfinishedSteps: 0,
  confirmedSteps: 0,
};

const days = ref<7 | 30>(7);
const workspace = ref<AgentWorkspace>("assistant");
const status = ref("");
const versionKey = ref("");
const activeTab = ref("traces");
const loading = ref(false);
const evaluating = ref(false);
const data = ref<Overview | null>(null);
const traceDrawer = ref(false);
const traceLoading = ref(false);
const traceDetail = ref<TraceDetail | null>(null);
const evalDrawer = ref(false);
const evalLoading = ref(false);
const evalDetail = ref<EvalRunDetail | null>(null);
const caseSavingId = ref("");
let requestVersion = 0;

const summary = computed(() => data.value?.summary || emptySummary);
const versions = computed(() => data.value?.versions || []);
const selectedVersion = computed(() => versions.value.find((item) => keyOfVersion(item) === versionKey.value));
const successRate = computed(() => {
  const total = summary.value.totalTraces;
  return total ? (summary.value.succeededTraces / total) * 100 : 0;
});

function keyOfVersion(item: QualityVersion) {
  return [item.workspace, item.model, item.reasoningEffort, item.promptVersion, item.toolVersion].join("\u001f");
}

function percent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function duration(value: number) {
  const ms = Math.max(0, Number(value || 0));
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function time(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function statusLabel(value: string) {
  return ({ running: "执行中", succeeded: "成功", failed: "失败", canceled: "已取消" } as Record<string, string>)[value] || value || "未知";
}

function statusType(value: string) {
  return ({ running: "warning", succeeded: "success", failed: "danger", canceled: "info" } as Record<string, "warning" | "success" | "danger" | "info">)[value] || "info";
}

function scoreClass(value?: number | null) {
  const score = Number(value || 0);
  return score >= 80 ? "is-good" : score >= 60 ? "is-mid" : "is-bad";
}

function formatJSON(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function traceSnapshotCount() {
  const snapshot = traceDetail.value?.initialSnapshot as { nodes?: unknown[]; connections?: unknown[]; selectedNodeIds?: unknown[] } | undefined;
  return {
    nodes: snapshot?.nodes?.length || 0,
    connections: snapshot?.connections?.length || 0,
    selected: snapshot?.selectedNodeIds?.length || 0,
  };
}

function traceVisualCount() {
  const visual = traceDetail.value?.visualSummary as { referenceImages?: unknown[] } | undefined;
  return visual?.referenceImages?.length || 0;
}

function traceGoal() {
  return (traceDetail.value?.goalContract || {}) as {
    outcomeKind?: string;
    deliverableCount?: number;
    promptMode?: string;
    referencedImageCount?: number;
    inspectedImageCount?: number;
    webSearchCount?: number;
  };
}

function workspaceLabel(value: AgentWorkspace) {
  return value === "assistant" ? "AI 助手" : "无限画布";
}

function outcomeLabel(value?: string) {
  return ({ image_proposal: "图片方案", chat: "对话回答" } as Record<string, string>)[value || ""] || value || "待识别";
}

function queryForSelection() {
  const selected = selectedVersion.value;
  return {
    days: days.value,
    workspace: workspace.value,
    status: status.value,
    model: selected?.model,
    reasoningEffort: selected?.reasoningEffort,
    promptVersion: selected?.promptVersion,
    toolVersion: selected?.toolVersion,
  };
}

async function load() {
  const version = ++requestVersion;
  loading.value = true;
  try {
    const result = await request<Overview>("/api/v1/admin/agent-quality", { query: queryForSelection() });
    if (version === requestVersion) data.value = result;
  } catch (error) {
    if (!isRequestAborted(error)) throw error;
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function runEvaluation() {
  evaluating.value = true;
  try {
    const selected = selectedVersion.value;
    const run = await request<EvalRun>("/api/v1/admin/agent-quality/eval-runs", {
      method: "POST",
      scope: "persistent",
      body: {
        days: days.value,
        workspace: workspace.value,
        sampleLimit: 80,
        model: selected?.model || "",
        reasoningEffort: selected?.reasoningEffort || "",
        promptVersion: selected?.promptVersion || "",
        toolVersion: selected?.toolVersion || "",
      },
    });
    ElMessage.success(`评测完成：${run.passed}/${run.total} 项通过`);
    await load();
    activeTab.value = "runs";
    await openEvalRun(run);
  } finally {
    evaluating.value = false;
  }
}

async function openTrace(raw: unknown) {
  const row = raw as TraceRow;
  traceDrawer.value = true;
  traceLoading.value = true;
  traceDetail.value = null;
  try {
    traceDetail.value = await request<TraceDetail>(`/api/v1/admin/agent-quality/traces/${encodeURIComponent(row.id)}`);
  } finally {
    traceLoading.value = false;
  }
}

async function openEvalRun(raw: unknown) {
  const row = raw as EvalRun;
  evalDrawer.value = true;
  evalLoading.value = true;
  evalDetail.value = null;
  try {
    evalDetail.value = await request<EvalRunDetail>(`/api/v1/admin/agent-quality/eval-runs/${encodeURIComponent(row.id)}`);
  } finally {
    evalLoading.value = false;
  }
}

async function toggleCase(raw: unknown, active: boolean) {
  const item = raw as EvalCase;
  caseSavingId.value = item.id;
  try {
    const updated = await request<EvalCase>(`/api/v1/admin/agent-quality/eval-cases/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      scope: "persistent",
      body: { active },
    });
    const target = data.value?.evalCases.find((candidate) => candidate.id === item.id);
    if (target) target.active = updated.active;
  } finally {
    caseSavingId.value = "";
  }
}

watch(workspace, () => {
  status.value = "";
  versionKey.value = "";
  activeTab.value = "traces";
});
watch([workspace, days, status, versionKey], () => void load());
onMounted(() => void load());
</script>

<template>
  <div class="aq-page">
    <header class="aq-head">
      <div>
        <h2>Agent 质量</h2>
        <p>{{ workspaceLabel(workspace) }}真实执行追踪与固定回归评测，不调用模型、不消耗积分</p>
      </div>
      <div class="aq-head__actions">
        <el-segmented v-model="workspace" :options="[{ label: 'AI 助手', value: 'assistant' }, { label: '无限画布', value: 'canvas' }]" />
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-select v-model="versionKey" clearable placeholder="全部版本" style="width: 220px">
          <el-option v-for="item in versions" :key="keyOfVersion(item)" :value="keyOfVersion(item)" :label="`${item.model || '默认模型'} · ${item.reasoningEffort || '默认强度'}`" />
        </el-select>
        <el-button type="primary" :icon="VideoPlay" :loading="evaluating" :disabled="!summary.totalTraces" @click="runEvaluation">运行评测</el-button>
        <el-button :icon="Refresh" :loading="loading" circle title="刷新" @click="load" />
      </div>
    </header>

    <section class="aq-kpis">
      <article><span><DataAnalysis /></span><div><small>真实执行</small><strong>{{ summary.totalTraces }}</strong></div></article>
      <article><span><DataAnalysis /></span><div><small>成功率</small><strong>{{ percent(successRate) }}</strong></div></article>
      <article :class="scoreClass(summary.averageScore)"><span><DataAnalysis /></span><div><small>平均质量分</small><strong>{{ summary.averageScore.toFixed(1) }}</strong></div></article>
      <article :class="{ 'is-bad': summary.unfinishedSteps > 0 }"><span><DataAnalysis /></span><div><small>未完成工具调用</small><strong>{{ summary.unfinishedSteps }}</strong></div></article>
      <article :class="{ 'is-bad': summary.failedSteps > 0 }"><span><DataAnalysis /></span><div><small>失败步骤</small><strong>{{ summary.failedSteps }}</strong></div></article>
      <article><span><DataAnalysis /></span><div><small>平均耗时</small><strong>{{ duration(summary.averageDurationMs) }}</strong></div></article>
    </section>

    <section class="aq-workspace">
      <el-tabs v-model="activeTab">
        <el-tab-pane name="traces" label="执行追踪">
          <div class="aq-toolbar">
            <el-select v-model="status" clearable placeholder="全部状态" style="width: 130px">
              <el-option label="执行中" value="running" /><el-option label="成功" value="succeeded" />
              <el-option label="失败" value="failed" /><el-option label="已取消" value="canceled" />
            </el-select>
            <span>{{ data?.traces.length || 0 }} 条</span>
          </div>
          <el-table v-loading="loading" :data="data?.traces || []" height="100%" empty-text="当前周期暂无 Agent 执行追踪">
            <el-table-column label="开始时间" width="150"><template #default="{ row }">{{ time(row.startedAt) }}</template></el-table-column>
            <el-table-column label="模型 / 推理强度" min-width="190"><template #default="{ row }"><div class="aq-primary"><strong>{{ row.model || '默认模型' }}</strong><small>{{ row.reasoningEffort || '默认强度' }}</small></div></template></el-table-column>
            <el-table-column label="用户" min-width="180" show-overflow-tooltip prop="userEmail" />
            <el-table-column label="状态" width="92"><template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="质量分" width="90" align="right"><template #default="{ row }"><strong class="aq-score" :class="scoreClass(row.score)">{{ row.score == null ? '—' : Number(row.score).toFixed(1) }}</strong></template></el-table-column>
            <el-table-column label="工具步骤" width="104" align="right"><template #default="{ row }">{{ row.stepCount }}<small v-if="row.failedSteps || row.unfinishedSteps" class="aq-alert"> · {{ row.failedSteps + row.unfinishedSteps }} 异常</small></template></el-table-column>
            <el-table-column label="耗时" width="100" align="right"><template #default="{ row }">{{ duration(row.durationMs) }}</template></el-table-column>
            <el-table-column width="58" align="center"><template #default="{ row }"><el-button :icon="View" text circle title="查看追踪" @click="openTrace(row)" /></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane name="runs" label="评测运行">
          <el-table :data="data?.evalRuns || []" height="100%" empty-text="还没有评测运行">
            <el-table-column label="运行时间" width="150"><template #default="{ row }">{{ time(row.startedAt) }}</template></el-table-column>
            <el-table-column label="模型 / 版本" min-width="230"><template #default="{ row }"><div class="aq-primary"><strong>{{ row.model === '*' ? '全部模型' : row.model }}</strong><small>{{ row.promptVersion }} · {{ row.toolVersion }}</small></div></template></el-table-column>
            <el-table-column label="样本" prop="sampleSize" width="80" align="right" />
            <el-table-column label="通过" width="100" align="right"><template #default="{ row }">{{ row.passed }}/{{ row.total }}</template></el-table-column>
            <el-table-column label="评分" width="100" align="right"><template #default="{ row }"><strong class="aq-score" :class="scoreClass(row.score)">{{ Number(row.score).toFixed(1) }}</strong></template></el-table-column>
            <el-table-column width="58" align="center"><template #default="{ row }"><el-button :icon="View" text circle title="查看结果" @click="openEvalRun(row)" /></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane name="cases" label="固定评测集">
          <el-table :data="data?.evalCases || []" height="100%" empty-text="没有评测项">
            <el-table-column label="分类" prop="category" width="110" />
            <el-table-column label="评测项" min-width="220"><template #default="{ row }"><div class="aq-primary"><strong>{{ row.title }}</strong><small>{{ row.key }}</small></div></template></el-table-column>
            <el-table-column label="输入条件" min-width="230" show-overflow-tooltip><template #default="{ row }">{{ formatJSON(row.input).replace(/\s+/g, ' ') }}</template></el-table-column>
            <el-table-column label="通过条件" min-width="260" show-overflow-tooltip><template #default="{ row }">{{ formatJSON(row.expected).replace(/\s+/g, ' ') }}</template></el-table-column>
            <el-table-column label="启用" width="86" align="center"><template #default="{ row }"><el-switch :model-value="row.active" :loading="caseSavingId === row.id" @change="toggleCase(row, Boolean($event))" /></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane name="versions" label="版本对比">
          <el-table :data="versions" height="100%" empty-text="当前周期还没有可比较版本">
            <el-table-column label="模型" min-width="170" prop="model" />
            <el-table-column label="推理强度" width="110"><template #default="{ row }">{{ row.reasoningEffort || '默认' }}</template></el-table-column>
            <el-table-column label="Prompt 版本" min-width="180" prop="promptVersion" />
            <el-table-column label="工具版本" min-width="180" prop="toolVersion" />
            <el-table-column label="样本" width="80" align="right" prop="traceCount" />
            <el-table-column label="成功率" width="100" align="right"><template #default="{ row }">{{ percent(row.traceCount ? row.succeeded / row.traceCount * 100 : 0) }}</template></el-table-column>
            <el-table-column label="质量分" width="90" align="right"><template #default="{ row }"><strong class="aq-score" :class="scoreClass(row.averageScore)">{{ Number(row.averageScore).toFixed(1) }}</strong></template></el-table-column>
            <el-table-column label="平均耗时" width="110" align="right"><template #default="{ row }">{{ duration(row.averageDurationMs) }}</template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-drawer v-model="traceDrawer" title="Agent 执行追踪" size="min(760px, 92vw)">
      <div v-loading="traceLoading" class="aq-drawer">
        <template v-if="traceDetail">
          <div class="aq-detail-grid">
            <div><small>状态</small><strong>{{ statusLabel(traceDetail.status) }}</strong></div>
            <div><small>质量分</small><strong>{{ traceDetail.score == null ? '—' : Number(traceDetail.score).toFixed(1) }}</strong></div>
            <div><small>Agent 范围</small><strong>{{ workspaceLabel(traceDetail.workspace) }}</strong></div>
            <template v-if="traceDetail.workspace === 'canvas'">
              <div><small>节点 / 连线</small><strong>{{ traceSnapshotCount().nodes }} / {{ traceSnapshotCount().connections }}</strong></div>
              <div><small>选中节点 / 参考图</small><strong>{{ traceSnapshotCount().selected }} / {{ traceVisualCount() }}</strong></div>
            </template>
            <template v-else>
              <div><small>结果类型</small><strong>{{ outcomeLabel(traceGoal().outcomeKind) }}</strong></div>
              <div><small>交付数量 / 参考图</small><strong>{{ traceGoal().deliverableCount || 0 }} / {{ traceGoal().referencedImageCount || traceVisualCount() }}</strong></div>
              <div><small>提示词方式</small><strong>{{ traceGoal().promptMode === 'faithful' ? '忠实执行' : traceGoal().promptMode === 'enhanced' ? '智能优化' : '不适用' }}</strong></div>
              <div><small>已看历史图 / 联网</small><strong>{{ traceGoal().inspectedImageCount || 0 }} / {{ traceGoal().webSearchCount || 0 }}</strong></div>
            </template>
            <div><small>Prompt 版本</small><strong>{{ traceDetail.promptVersion }}</strong></div>
            <div><small>工具版本</small><strong>{{ traceDetail.toolVersion }}</strong></div>
          </div>
          <div class="aq-step-list">
            <article v-for="step in traceDetail.steps" :key="step.id">
              <header><span>#{{ step.sequence }}</span><strong>{{ step.toolName }}</strong><el-tag size="small" :type="statusType(step.status)">{{ statusLabel(step.status) }}</el-tag><small>{{ duration(step.durationMs) }}</small></header>
              <p v-if="step.requiresConfirmation">已走高风险操作确认</p>
              <p v-if="step.errorMessage" class="aq-error">{{ step.errorMessage }}</p>
              <el-collapse>
                <el-collapse-item title="参数与结果">
                  <div class="aq-json-grid"><pre>{{ formatJSON(step.arguments) }}</pre><pre>{{ formatJSON(step.result) }}</pre></div>
                </el-collapse-item>
              </el-collapse>
            </article>
            <el-empty v-if="!traceDetail.steps.length" description="本次执行没有工具步骤" />
          </div>
        </template>
      </div>
    </el-drawer>

    <el-drawer v-model="evalDrawer" title="评测结果" size="min(720px, 92vw)">
      <div v-loading="evalLoading" class="aq-drawer">
        <template v-if="evalDetail">
          <div class="aq-eval-summary"><strong>{{ Number(evalDetail.run.score).toFixed(1) }}</strong><span>{{ evalDetail.run.passed }}/{{ evalDetail.run.total }} 项通过 · {{ evalDetail.run.sampleSize }} 条真实样本</span></div>
          <div class="aq-result-list">
            <article v-for="item in evalDetail.results" :key="item.case.id" :class="{ 'is-pass': item.passed }">
              <header><strong>{{ item.case.title }}</strong><span>{{ Number(item.score).toFixed(1) }}</span></header>
              <p>{{ item.errorMessage || `样本 ${item.metrics.sampleCount || 0} 条，通过 ${item.metrics.passedCount || 0} 条` }}</p>
            </article>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.aq-page { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 12px; height: 100%; min-height: 0; }
.aq-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.aq-head h2 { margin: 0; color: var(--text-primary); font-size: 1.12rem; font-weight: 850; }
.aq-head p { margin: 4px 0 0; color: var(--text-secondary); font-size: .74rem; }
.aq-head__actions { display: flex; align-items: center; gap: 8px; }
.aq-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.aq-kpis article { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 10px 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.aq-kpis article > span { display: grid; width: 30px; height: 30px; place-items: center; flex: none; border-radius: 6px; color: #146f5a; background: #e7f5ef; }
.aq-kpis article > span :deep(svg) { width: 15px; height: 15px; }
.aq-kpis article > div { display: grid; gap: 1px; min-width: 0; }
.aq-kpis small { color: var(--text-secondary); font-size: .64rem; font-weight: 700; }
.aq-kpis strong { overflow: hidden; color: var(--text-primary); font-size: .96rem; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.aq-kpis article.is-bad strong, .aq-score.is-bad, .aq-alert, .aq-error { color: var(--danger); }
.aq-score.is-good { color: var(--success); }.aq-score.is-mid { color: #b7791f; }
.aq-workspace { min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.aq-workspace :deep(.el-tabs) { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; }
.aq-workspace :deep(.el-tabs__header) { margin: 0; padding: 0 12px; }
.aq-workspace :deep(.el-tabs__content), .aq-workspace :deep(.el-tab-pane) { min-height: 0; height: 100%; }
.aq-workspace :deep(.el-tab-pane) { display: grid; grid-template-rows: minmax(0, 1fr); }
.aq-workspace :deep(.el-tab-pane:has(.aq-toolbar)) { grid-template-rows: auto minmax(0, 1fr); }
.aq-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: .68rem; }
.aq-primary { display: grid; gap: 2px; min-width: 0; }.aq-primary strong, .aq-primary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.aq-primary small { color: var(--text-secondary); font-size: .64rem; }
.aq-alert { font-size: .62rem; }
.aq-drawer { min-height: 160px; }
.aq-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.aq-detail-grid > div { display: grid; gap: 3px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; }.aq-detail-grid small { color: var(--text-secondary); font-size: .64rem; }.aq-detail-grid strong { overflow: hidden; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.aq-step-list, .aq-result-list { display: grid; gap: 8px; }
.aq-step-list article, .aq-result-list article { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.aq-step-list article > header { display: flex; align-items: center; gap: 8px; padding: 9px 11px; }.aq-step-list article > header > span, .aq-step-list article > header > small { color: var(--text-secondary); font-size: .65rem; }.aq-step-list article > header > strong { flex: 1; font-size: .74rem; }
.aq-step-list article > p { margin: 0; padding: 0 11px 8px; color: var(--text-secondary); font-size: .68rem; }
.aq-json-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.aq-json-grid pre { max-height: 300px; margin: 0; overflow: auto; padding: 9px; border-radius: 5px; background: var(--surface-muted); font-size: .66rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.aq-eval-summary { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }.aq-eval-summary strong { font-size: 1.75rem; }.aq-eval-summary span { color: var(--text-secondary); font-size: .72rem; }
.aq-result-list article { padding: 10px 12px; border-left: 3px solid var(--danger); }.aq-result-list article.is-pass { border-left-color: var(--success); }.aq-result-list header { display: flex; justify-content: space-between; gap: 10px; }.aq-result-list header strong { font-size: .76rem; }.aq-result-list header span { font-weight: 800; font-variant-numeric: tabular-nums; }.aq-result-list p { margin: 5px 0 0; color: var(--text-secondary); font-size: .68rem; }
@media (max-width: 1280px) { .aq-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }.aq-head { align-items: flex-start; }.aq-head__actions { flex-wrap: wrap; justify-content: flex-end; } }
@media (max-width: 820px) { .aq-head { display: grid; }.aq-head__actions { justify-content: flex-start; }.aq-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }.aq-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.aq-json-grid { grid-template-columns: 1fr; } }
</style>
