<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Refresh, VideoPlay, View } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import PageCard from "@/components/PageCard.vue";
import { isRequestAborted, request } from "@/request";
import { buildModelCatalog, catalogModelName } from "@/userProfile";

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
const modelCatalog = ref<Record<string, string>>({});
let requestVersion = 0;

const summary = computed(() => data.value?.summary || emptySummary);
const versions = computed(() => data.value?.versions || []);
const traces = computed(() => data.value?.traces || []);
const evalRuns = computed(() => data.value?.evalRuns || []);
const evalCases = computed(() => data.value?.evalCases || []);
const selectedVersion = computed(() => versions.value.find((item) => keyOfVersion(item) === versionKey.value));
const successRate = computed(() => {
  const total = summary.value.totalTraces;
  return total ? (summary.value.succeededTraces / total) * 100 : 0;
});
const tabs = computed(() => [
  { id: "traces", label: "执行追踪", count: traces.value.length },
  { id: "runs", label: "评测运行", count: evalRuns.value.length },
  { id: "cases", label: "固定评测集", count: evalCases.value.length },
  { id: "versions", label: "版本对比", count: versions.value.length },
]);

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

function modelName(value?: string | null) {
  return catalogModelName(value, modelCatalog.value);
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
onMounted(async () => {
  try {
    const cfg = await request<{
      models?: Array<{ id?: string; name?: string; upstreamModel?: string }>;
    }>("/api/v1/admin/model-config");
    modelCatalog.value = buildModelCatalog(cfg.models);
  } catch {
    modelCatalog.value = {};
  }
  await load();
});
</script>

<template>
  <div class="page aq-page">
    <PageCard>
      <template #actions>
        <el-segmented v-model="workspace" :options="[{ label: 'AI 助手', value: 'assistant' }, { label: '无限画布', value: 'canvas' }]" />
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-select v-model="versionKey" clearable placeholder="全部版本" class="aq-version">
          <el-option
            v-for="item in versions"
            :key="keyOfVersion(item)"
            :value="keyOfVersion(item)"
            :label="`${modelName(item.model)} · ${item.reasoningEffort || '默认强度'}`"
          />
        </el-select>
        <el-button type="primary" :icon="VideoPlay" :loading="evaluating" :disabled="!summary.totalTraces" @click="runEvaluation">
          运行评测
        </el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>

      <section class="aq-kpis" aria-label="质量摘要">
        <article>
          <small>真实执行</small>
          <strong class="tnum">{{ summary.totalTraces }}</strong>
        </article>
        <article>
          <small>成功率</small>
          <strong class="tnum">{{ percent(successRate) }}</strong>
        </article>
        <article :class="scoreClass(summary.averageScore)">
          <small>平均质量分</small>
          <strong class="tnum">{{ summary.averageScore.toFixed(1) }}</strong>
        </article>
        <article :class="{ 'is-bad': summary.unfinishedSteps > 0 }">
          <small>未完成工具调用</small>
          <strong class="tnum">{{ summary.unfinishedSteps }}</strong>
        </article>
        <article :class="{ 'is-bad': summary.failedSteps > 0 }">
          <small>失败步骤</small>
          <strong class="tnum">{{ summary.failedSteps }}</strong>
        </article>
        <article>
          <small>平均耗时</small>
          <strong class="tnum">{{ duration(summary.averageDurationMs) }}</strong>
        </article>
      </section>

      <p class="aq-legend">
        近 {{ days }} 日 {{ workspaceLabel(workspace) }}
        <em class="tnum">{{ summary.totalTraces }}</em>
        次执行，成功
        <em class="tnum">{{ summary.succeededTraces }}</em>
        、失败
        <em class="tnum">{{ summary.failedTraces }}</em>
        、取消
        <em class="tnum">{{ summary.canceledTraces }}</em>
        。评测只回放真实样本。
      </p>

      <div class="aq-toolbar">
        <div class="aq-tabs" role="tablist" aria-label="质量视图">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            class="aq-tab"
            :class="{ 'is-active': activeTab === tab.id }"
            :aria-selected="activeTab === tab.id"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
            <em class="tnum">{{ tab.count }}</em>
          </button>
        </div>
        <div v-if="activeTab === 'traces'" class="aq-toolbar__right">
          <el-select v-model="status" clearable placeholder="全部状态">
            <el-option label="执行中" value="running" />
            <el-option label="成功" value="succeeded" />
            <el-option label="失败" value="failed" />
            <el-option label="已取消" value="canceled" />
          </el-select>
        </div>
      </div>

      <div v-loading="loading" class="aq-board">
        <el-table v-if="activeTab === 'traces'" :data="traces" height="100%" empty-text="当前周期暂无 Agent 执行追踪">
          <el-table-column label="开始时间" width="150">
            <template #default="{ row }">{{ time(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="模型 / 推理强度" min-width="190">
            <template #default="{ row }">
              <div class="aq-primary">
                <strong :title="row.model || undefined">{{ modelName(row.model) }}</strong>
                <small>{{ row.reasoningEffort || "默认强度" }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="180" show-overflow-tooltip prop="userEmail" />
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="质量分" width="90" align="right">
            <template #default="{ row }">
              <strong class="aq-score" :class="scoreClass(row.score)">{{ row.score == null ? "—" : Number(row.score).toFixed(1) }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="工具步骤" width="110" align="right">
            <template #default="{ row }">
              <span class="tnum">{{ row.stepCount }}</span>
              <small v-if="row.failedSteps || row.unfinishedSteps" class="aq-alert"> · {{ row.failedSteps + row.unfinishedSteps }} 异常</small>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="100" align="right">
            <template #default="{ row }">{{ duration(row.durationMs) }}</template>
          </el-table-column>
          <el-table-column width="64" align="center">
            <template #default="{ row }">
              <el-button :icon="View" text circle title="查看追踪" @click="openTrace(row)" />
            </template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="activeTab === 'runs'" :data="evalRuns" height="100%" empty-text="还没有评测运行">
          <el-table-column label="运行时间" width="150">
            <template #default="{ row }">{{ time(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="模型 / 版本" min-width="230">
            <template #default="{ row }">
              <div class="aq-primary">
                <strong :title="row.model || undefined">{{ modelName(row.model) }}</strong>
                <small>{{ row.promptVersion }} · {{ row.toolVersion }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="样本" prop="sampleSize" width="80" align="right" />
          <el-table-column label="通过" width="100" align="right">
            <template #default="{ row }">{{ row.passed }}/{{ row.total }}</template>
          </el-table-column>
          <el-table-column label="评分" width="100" align="right">
            <template #default="{ row }">
              <strong class="aq-score" :class="scoreClass(row.score)">{{ Number(row.score).toFixed(1) }}</strong>
            </template>
          </el-table-column>
          <el-table-column width="64" align="center">
            <template #default="{ row }">
              <el-button :icon="View" text circle title="查看结果" @click="openEvalRun(row)" />
            </template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="activeTab === 'cases'" :data="evalCases" height="100%" empty-text="没有评测项">
          <el-table-column label="分类" prop="category" width="110" />
          <el-table-column label="评测项" min-width="220">
            <template #default="{ row }">
              <div class="aq-primary">
                <strong>{{ row.title }}</strong>
                <small>{{ row.key }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="输入条件" min-width="230" show-overflow-tooltip>
            <template #default="{ row }">{{ formatJSON(row.input).replace(/\s+/g, " ") }}</template>
          </el-table-column>
          <el-table-column label="通过条件" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">{{ formatJSON(row.expected).replace(/\s+/g, " ") }}</template>
          </el-table-column>
          <el-table-column label="启用" width="86" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.active" :loading="caseSavingId === row.id" @change="toggleCase(row, Boolean($event))" />
            </template>
          </el-table-column>
        </el-table>

        <el-table v-else :data="versions" height="100%" empty-text="当前周期还没有可比较版本">
          <el-table-column label="模型" min-width="170">
            <template #default="{ row }">
              <span :title="row.model || undefined">{{ modelName(row.model) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="推理强度" width="110">
            <template #default="{ row }">{{ row.reasoningEffort || "默认" }}</template>
          </el-table-column>
          <el-table-column label="Prompt 版本" min-width="180" prop="promptVersion" />
          <el-table-column label="工具版本" min-width="180" prop="toolVersion" />
          <el-table-column label="样本" width="80" align="right" prop="traceCount" />
          <el-table-column label="成功率" width="100" align="right">
            <template #default="{ row }">{{ percent(row.traceCount ? (row.succeeded / row.traceCount) * 100 : 0) }}</template>
          </el-table-column>
          <el-table-column label="质量分" width="90" align="right">
            <template #default="{ row }">
              <strong class="aq-score" :class="scoreClass(row.averageScore)">{{ Number(row.averageScore).toFixed(1) }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="平均耗时" width="110" align="right">
            <template #default="{ row }">{{ duration(row.averageDurationMs) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </PageCard>

    <el-drawer v-model="traceDrawer" size="min(760px, 92vw)">
      <template #header>
        <div class="aq-drawer-head">
          <strong>执行追踪</strong>
          <span v-if="traceDetail">{{ workspaceLabel(traceDetail.workspace) }} · {{ statusLabel(traceDetail.status) }}</span>
        </div>
      </template>
      <div v-loading="traceLoading" class="aq-drawer">
        <template v-if="traceDetail">
          <div class="aq-detail-grid">
            <div>
              <small>状态</small>
              <strong>{{ statusLabel(traceDetail.status) }}</strong>
            </div>
            <div>
              <small>质量分</small>
              <strong class="aq-score" :class="scoreClass(traceDetail.score)">{{ traceDetail.score == null ? "—" : Number(traceDetail.score).toFixed(1) }}</strong>
            </div>
            <div>
              <small>用户</small>
              <strong>{{ traceDetail.userEmail || "—" }}</strong>
            </div>
            <template v-if="traceDetail.workspace === 'canvas'">
              <div>
                <small>节点 / 连线</small>
                <strong>{{ traceSnapshotCount().nodes }} / {{ traceSnapshotCount().connections }}</strong>
              </div>
              <div>
                <small>选中节点 / 参考图</small>
                <strong>{{ traceSnapshotCount().selected }} / {{ traceVisualCount() }}</strong>
              </div>
            </template>
            <template v-else>
              <div>
                <small>结果类型</small>
                <strong>{{ outcomeLabel(traceGoal().outcomeKind) }}</strong>
              </div>
              <div>
                <small>交付数量 / 参考图</small>
                <strong>{{ traceGoal().deliverableCount || 0 }} / {{ traceGoal().referencedImageCount || traceVisualCount() }}</strong>
              </div>
              <div>
                <small>提示词方式</small>
                <strong>{{ traceGoal().promptMode === "faithful" ? "忠实执行" : traceGoal().promptMode === "enhanced" ? "智能优化" : "不适用" }}</strong>
              </div>
              <div>
                <small>已看历史图 / 联网</small>
                <strong>{{ traceGoal().inspectedImageCount || 0 }} / {{ traceGoal().webSearchCount || 0 }}</strong>
              </div>
            </template>
            <div>
              <small>Prompt 版本</small>
              <strong>{{ traceDetail.promptVersion }}</strong>
            </div>
            <div>
              <small>工具版本</small>
              <strong>{{ traceDetail.toolVersion }}</strong>
            </div>
          </div>
          <div class="aq-step-list">
            <article v-for="step in traceDetail.steps" :key="step.id">
              <header>
                <span>#{{ step.sequence }}</span>
                <strong>{{ step.toolName }}</strong>
                <el-tag size="small" :type="statusType(step.status)">{{ statusLabel(step.status) }}</el-tag>
                <small>{{ duration(step.durationMs) }}</small>
              </header>
              <p v-if="step.requiresConfirmation">已走高风险操作确认</p>
              <p v-if="step.errorMessage" class="aq-error">{{ step.errorMessage }}</p>
              <el-collapse>
                <el-collapse-item title="参数与结果">
                  <div class="aq-json-grid">
                    <section>
                      <small>参数</small>
                      <pre>{{ formatJSON(step.arguments) }}</pre>
                    </section>
                    <section>
                      <small>结果</small>
                      <pre>{{ formatJSON(step.result) }}</pre>
                    </section>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </article>
            <el-empty v-if="!traceDetail.steps.length" description="本次执行没有工具步骤" />
          </div>
        </template>
      </div>
    </el-drawer>

    <el-drawer v-model="evalDrawer" size="min(720px, 92vw)">
      <template #header>
        <div class="aq-drawer-head">
          <strong>评测结果</strong>
          <span v-if="evalDetail">{{ evalDetail.run.passed }}/{{ evalDetail.run.total }} 项通过</span>
        </div>
      </template>
      <div v-loading="evalLoading" class="aq-drawer">
        <template v-if="evalDetail">
          <div class="aq-eval-summary">
            <strong class="aq-score" :class="scoreClass(evalDetail.run.score)">{{ Number(evalDetail.run.score).toFixed(1) }}</strong>
            <span>{{ evalDetail.run.passed }}/{{ evalDetail.run.total }} 项通过 · {{ evalDetail.run.sampleSize }} 条真实样本</span>
          </div>
          <div class="aq-result-list">
            <article v-for="item in evalDetail.results" :key="item.case.id" :class="{ 'is-pass': item.passed }">
              <header>
                <strong>{{ item.case.title }}</strong>
                <span>{{ Number(item.score).toFixed(1) }}</span>
              </header>
              <p>{{ item.errorMessage || `样本 ${item.metrics.sampleCount || 0} 条，通过 ${item.metrics.passedCount || 0} 条` }}</p>
            </article>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.aq-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}
.aq-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.aq-page :deep(.page-card__header) {
  flex-wrap: wrap;
  align-items: flex-start;
}
.aq-page :deep(.page-card__actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.aq-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  overflow: hidden;
}
.aq-version {
  width: 220px;
}
.aq-kpis {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-kpis article {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
}
.aq-kpis article:last-child {
  border-right: 0;
}
.aq-kpis small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.aq-kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-kpis article.is-good strong,
.aq-score.is-good {
  color: var(--success);
}
.aq-kpis article.is-mid strong,
.aq-score.is-mid {
  color: var(--warning);
}
.aq-kpis article.is-bad strong,
.aq-score.is-bad,
.aq-alert,
.aq-error {
  color: var(--danger);
}
.aq-legend {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.aq-legend em {
  margin: 0 2px;
  color: var(--ink);
  font-style: normal;
  font-weight: 750;
}
.aq-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.aq-tabs {
  display: flex;
  min-width: 0;
  flex: 1 1 420px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}
.aq-tabs::-webkit-scrollbar {
  display: none;
}
.aq-tab {
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
.aq-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.aq-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}
.aq-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}
.aq-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.aq-toolbar__right :deep(.el-select) {
  width: 132px;
}
.aq-board {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.aq-primary {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.aq-primary strong,
.aq-primary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-primary small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-alert {
  font-size: 12px;
}
.aq-drawer-head {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.aq-drawer-head strong {
  font-size: 15px;
  font-weight: 650;
}
.aq-drawer-head span {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-drawer {
  min-height: 160px;
}
.aq-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.aq-detail-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-detail-grid small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-detail-grid strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-step-list,
.aq-result-list {
  display: grid;
  gap: 8px;
}
.aq-step-list article,
.aq-result-list article {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.aq-step-list article > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.aq-step-list article > header > span,
.aq-step-list article > header > small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-step-list article > header > strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-step-list article > p {
  margin: 0;
  padding: 0 12px 10px;
  color: var(--ink-2);
  font-size: 12px;
}
.aq-json-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.aq-json-grid small {
  display: block;
  margin-bottom: 6px;
  color: var(--ink-3);
  font-size: 12px;
}
.aq-json-grid pre {
  max-height: 280px;
  margin: 0;
  overflow: auto;
  padding: 10px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.aq-eval-summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}
.aq-eval-summary strong {
  font-size: 28px;
  letter-spacing: -0.03em;
}
.aq-eval-summary span {
  color: var(--ink-2);
  font-size: 13px;
}
.aq-result-list article {
  padding: 12px 14px;
  border-left: 3px solid var(--danger);
}
.aq-result-list article.is-pass {
  border-left-color: var(--success);
}
.aq-result-list header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.aq-result-list header strong {
  font-size: 13px;
}
.aq-result-list header span {
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.aq-result-list p {
  margin: 6px 0 0;
  color: var(--ink-2);
  font-size: 12px;
}
@media (max-width: 1280px) {
  .aq-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .aq-kpis article:nth-child(3) {
    border-right: 0;
  }
}
@media (max-width: 820px) {
  .aq-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .aq-kpis article:nth-child(odd) {
    border-right: 1px solid var(--border);
  }
  .aq-kpis article:nth-child(even) {
    border-right: 0;
  }
  .aq-detail-grid,
  .aq-json-grid {
    grid-template-columns: 1fr;
  }
}
</style>
