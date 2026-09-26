<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ArrowDown, CopyDocument, Refresh, Search, VideoPlay, View } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import PageCard from "@/components/PageCard.vue";
import CursorPager from '@/components/CursorPager.vue';
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
  traceTotal?: number;
  page?: number;
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
const issuesOnly = ref(false);
// 用户搜索：邮箱、用户名或用户 ID；回车或清空时生效，汇总与列表同步筛选。
const userInput = ref("");
const userSearch = ref("");
function applyUserSearch() {
  userSearch.value = userInput.value.trim();
}
function clearUserSearch() {
  userInput.value = "";
  userSearch.value = "";
}
const tracePage = ref(1);
// 版本对比：执行次数低于该值时提示样本不足。
const MIN_VERSION_SAMPLES = 20;
const versionKey = ref("");
const activeTab = ref("traces");
const loading = ref(false);
const evaluating = ref(false);
const data = ref<Overview | null>(null);
const qualityError = ref('');
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
    goal?: string;
    acceptanceRequirements?: string[];
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
    issues: issuesOnly.value,
    user: userSearch.value,
    page: tracePage.value,
    model: selected?.model,
    reasoningEffort: selected?.reasoningEffort,
    promptVersion: selected?.promptVersion,
    toolVersion: selected?.toolVersion,
  };
}

async function load() {
  const version = ++requestVersion;
  loading.value = true;
  qualityError.value = '';
  try {
    const result = await request<Overview>("/api/v1/admin/agent-quality", { query: queryForSelection() });
    if (version === requestVersion) data.value = result;
  } catch (error) {
    if (!isRequestAborted(error) && version === requestVersion) qualityError.value = error instanceof Error ? error.message : '质量数据读取失败';
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
  } catch (error) {
    qualityError.value = error instanceof Error ? error.message : '评测未完成，请重试';
  } finally {
    evaluating.value = false;
  }
}

// 步骤的参数与结果默认收起；失败或有报错的步骤自动展开，便于直接定位问题。
const openSteps = ref<Record<string, boolean>>({});
const traceFailedSteps = computed(() => traceDetail.value?.steps.filter((step) => step.status === "failed").length ?? 0);
async function copyJSON(value: unknown, label: string) {
  try {
    await navigator.clipboard.writeText(formatJSON(value));
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.error("复制失败，请手动选择文本复制");
  }
}
function toggleStep(id: string) {
  openSteps.value = { ...openSteps.value, [id]: !openSteps.value[id] };
}

async function openTrace(raw: unknown) {
  const row = raw as TraceRow;
  traceDrawer.value = true;
  traceLoading.value = true;
  traceDetail.value = null;
  openSteps.value = {};
  try {
    const detail = await request<TraceDetail>(`/api/v1/admin/agent-quality/traces/${encodeURIComponent(row.id)}`);
    // 详情接口不含列表已计算的用户邮箱、耗时与步骤统计，沿用列表行的值。
    traceDetail.value = { ...row, ...detail };
    openSteps.value = Object.fromEntries(detail.steps.filter((step) => step.status === "failed" || step.errorMessage).map((step) => [step.id, true]));
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
watch([workspace, days, status, versionKey, issuesOnly, userSearch], () => { tracePage.value = 1; void load() });
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
      <!-- 快捷操作放在标题位，与右侧筛选和操作同一行显示 -->
      <template #header>
        <div class="quality-next-actions">
          <el-button :disabled="!summary.failedTraces" @click="activeTab = 'traces'; status = 'failed'">检查 {{ summary.failedTraces }} 次失败执行</el-button>
          <el-button @click="activeTab = 'versions'">比较版本表现</el-button>
          <span v-if="evalRuns.length" :title="`最近评测：${evalRuns[0]?.passed}/${evalRuns[0]?.total} 项通过，可在“评测运行”中查看证据`">最近评测：{{ evalRuns[0]?.passed }}/{{ evalRuns[0]?.total }} 项通过，可在“评测运行”中查看证据</span>
          <span v-else title="尚无评测记录，收集真实样本后运行评测">尚无评测记录，收集真实样本后运行评测</span>
        </div>
      </template>
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

      <el-alert v-if="qualityError" :title="qualityError" description="数据读取失败，不能据此认定没有失败或质量良好。" type="error" :closable="false" />
      <div v-if="userSearch" class="aq-active-filter">
        <el-tag closable @close="clearUserSearch">只看用户：{{ userSearch }}</el-tag>
        <small>汇总指标与执行追踪按该用户统计；版本对比和评测不受影响</small>
      </div>
      <section class="aq-kpis" aria-label="质量摘要" :title="`近 ${days} 日${workspaceLabel(workspace)}，指标与下方记录使用同一筛选范围`">
        <article class="aq-kpis__runs">
          <small>真实执行</small>
          <strong class="tnum">{{ summary.totalTraces }}</strong>
          <span class="aq-kpis__breakdown tnum">
            成功 {{ summary.succeededTraces }} · <b :class="{ 'is-bad': summary.failedTraces > 0 }">失败 {{ summary.failedTraces }}</b> · 取消 {{ summary.canceledTraces }}
          </span>
        </article>
        <article>
          <small>成功率</small>
          <strong class="tnum">{{ summary.totalTraces ? percent(successRate) : '—' }}</strong>
        </article>
        <article :class="scoreClass(summary.averageScore)">
          <small>平均质量分</small>
          <strong class="tnum">{{ summary.totalTraces ? summary.averageScore.toFixed(1) : '—' }}</strong>
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
          <el-input
            v-model="userInput"
            class="aq-user-search"
            :prefix-icon="Search"
            placeholder="用户邮箱 / 用户名 / ID，回车搜索"
            clearable
            @keyup.enter="applyUserSearch"
            @clear="applyUserSearch"
          />
          <el-checkbox v-model="issuesOnly">只看失败或未完成步骤</el-checkbox>
          <el-select v-model="status" clearable placeholder="全部状态">
            <el-option label="执行中" value="running" />
            <el-option label="成功" value="succeeded" />
            <el-option label="失败" value="failed" />
            <el-option label="已取消" value="canceled" />
          </el-select>
        </div>
      </div>

      <div v-loading="loading" class="aq-board">
        <el-table
          v-if="activeTab === 'traces'"
          :data="traces"
          height="100%"
          class="aq-trace-table"
          empty-text="当前周期暂无 Agent 执行追踪"
          @row-click="openTrace"
        >
          <el-table-column label="开始时间" width="140">
            <template #default="{ row }"><span class="tnum">{{ time(row.startedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="模型" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">
              <strong class="aq-cell-strong" :title="row.model || undefined">{{ modelName(row.model) }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="推理强度" width="100">
            <template #default="{ row }">
              <span :class="{ 'aq-cell-muted': !row.reasoningEffort }">{{ row.reasoningEffort || "默认" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="用户" min-width="200" show-overflow-tooltip prop="userEmail" />
          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="质量分" width="90" align="right">
            <template #default="{ row }">
              <strong class="aq-score" :class="scoreClass(row.score)">{{ row.score == null ? "—" : Number(row.score).toFixed(1) }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="工具步骤" width="120" align="right">
            <template #default="{ row }">
              <span class="aq-nowrap">
                <span class="tnum">{{ row.stepCount }}</span>
                <small v-if="row.failedSteps || row.unfinishedSteps" class="aq-alert"> · {{ row.failedSteps + row.unfinishedSteps }} 异常</small>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="90" align="right">
            <template #default="{ row }"><span class="tnum">{{ duration(row.durationMs) }}</span></template>
          </el-table-column>
          <el-table-column width="56" align="center">
            <template #default="{ row }">
              <el-button :icon="View" text circle title="查看追踪" aria-label="查看追踪" @click.stop="openTrace(row)" />
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
          <el-table-column label="样本" width="120" align="right">
            <template #default="{ row }">
              <span class="aq-nowrap">
                <el-tooltip v-if="row.traceCount < MIN_VERSION_SAMPLES" :content="`少于 ${MIN_VERSION_SAMPLES} 次执行，成功率与质量分波动大，不宜直接比较`" placement="top">
                  <el-tag size="small" type="warning" class="aq-sample-tag">样本不足</el-tag>
                </el-tooltip>
                <span class="tnum">{{ row.traceCount }}</span>
              </span>
            </template>
          </el-table-column>
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
      <CursorPager v-if="activeTab === 'traces'" :has-prev="(data?.page || 1) > 1" :has-next="(data?.page || 1) * 50 < (data?.traceTotal || 0)" :loading="loading" :page="data?.page || 1" :total="data?.traceTotal ?? summary.totalTraces" :page-size="50" :page-sizes="[50]" @update:page="value => { tracePage = value; load() }" />
    </PageCard>

    <el-drawer v-model="traceDrawer" size="min(760px, 92vw)" class="aq-trace-drawer">
      <template #header>
        <div class="aq-drawer-head">
          <div class="aq-drawer-head__title">
            <strong>执行追踪</strong>
            <el-tag v-if="traceDetail" size="small" round :type="statusType(traceDetail.status)">{{ statusLabel(traceDetail.status) }}</el-tag>
          </div>
          <span v-if="traceDetail">
            {{ workspaceLabel(traceDetail.workspace) }} · {{ modelName(traceDetail.model) }}{{ traceDetail.reasoningEffort ? ` · ${traceDetail.reasoningEffort}` : "" }} · {{ time(traceDetail.startedAt) }}
          </span>
        </div>
      </template>
      <div v-loading="traceLoading" class="aq-drawer">
        <template v-if="traceDetail">
          <section v-if="traceGoal().goal || traceGoal().acceptanceRequirements?.length" class="aq-trace-goal" aria-label="用户目标">
            <small>用户目标</small>
            <p v-if="traceGoal().goal">{{ traceGoal().goal }}</p>
            <ul v-if="traceGoal().acceptanceRequirements?.length">
              <li v-for="(item, index) in traceGoal().acceptanceRequirements" :key="index">{{ item }}</li>
            </ul>
          </section>
          <section class="aq-trace-overview" aria-label="执行概览">
            <div>
              <small>质量分</small>
              <strong class="aq-score tnum" :class="scoreClass(traceDetail.score)">{{ traceDetail.score == null ? "—" : Number(traceDetail.score).toFixed(1) }}</strong>
            </div>
            <div>
              <small>耗时</small>
              <strong class="tnum">{{ duration(traceDetail.durationMs) }}</strong>
            </div>
            <div>
              <small>工具步骤</small>
              <strong class="tnum">
                {{ traceDetail.steps.length }}
                <em v-if="traceFailedSteps" class="is-bad">失败 {{ traceFailedSteps }}</em>
              </strong>
            </div>
            <div>
              <small>用户</small>
              <strong :title="traceDetail.userEmail || ''">{{ traceDetail.userEmail || "—" }}</strong>
            </div>
          </section>

          <dl class="aq-trace-facts">
            <template v-if="traceDetail.workspace === 'canvas'">
              <div><dt>节点 / 连线</dt><dd class="tnum">{{ traceSnapshotCount().nodes }} / {{ traceSnapshotCount().connections }}</dd></div>
              <div><dt>选中节点 / 参考图</dt><dd class="tnum">{{ traceSnapshotCount().selected }} / {{ traceVisualCount() }}</dd></div>
            </template>
            <template v-else>
              <div><dt>结果类型</dt><dd>{{ outcomeLabel(traceGoal().outcomeKind) }}</dd></div>
              <div><dt>提示词方式</dt><dd>{{ traceGoal().promptMode === "faithful" ? "忠实执行" : traceGoal().promptMode === "enhanced" ? "智能优化" : "不适用" }}</dd></div>
              <div><dt>交付数量 / 参考图</dt><dd class="tnum">{{ traceGoal().deliverableCount || 0 }} / {{ traceGoal().referencedImageCount || traceVisualCount() }}</dd></div>
              <div><dt>已看历史图 / 联网</dt><dd class="tnum">{{ traceGoal().inspectedImageCount || 0 }} / {{ traceGoal().webSearchCount || 0 }}</dd></div>
            </template>
            <div class="is-wide"><dt>Prompt 版本</dt><dd class="is-mono">{{ traceDetail.promptVersion || "—" }}</dd></div>
            <div class="is-wide"><dt>工具版本</dt><dd class="is-mono">{{ traceDetail.toolVersion || "—" }}</dd></div>
          </dl>

          <div class="aq-section-title">
            <strong>工具步骤</strong>
            <small class="tnum">{{ traceDetail.steps.length }}</small>
          </div>
          <ol v-if="traceDetail.steps.length" class="aq-timeline">
            <li v-for="step in traceDetail.steps" :key="step.id" :class="`is-${step.status}`">
              <span class="aq-timeline__dot tnum">{{ step.sequence }}</span>
              <div class="aq-timeline__body">
                <header>
                  <code :title="step.toolName">{{ step.toolName }}</code>
                  <el-tag size="small" :type="statusType(step.status)">{{ statusLabel(step.status) }}</el-tag>
                  <small class="tnum">{{ duration(step.durationMs) }}</small>
                  <button type="button" class="aq-timeline__toggle" :aria-expanded="Boolean(openSteps[step.id])" @click="toggleStep(step.id)">
                    {{ openSteps[step.id] ? "收起" : "参数与结果" }}
                    <el-icon :class="{ 'is-open': openSteps[step.id] }"><ArrowDown /></el-icon>
                  </button>
                </header>
                <p v-if="step.requiresConfirmation" class="aq-timeline__note">已走高风险操作确认</p>
                <p v-if="step.errorMessage" class="aq-timeline__note aq-error">{{ step.errorMessage }}</p>
                <div v-if="openSteps[step.id]" class="aq-json-stack">
                  <section>
                    <div class="aq-json-stack__head">
                      <small>参数</small>
                      <el-button text size="small" :icon="CopyDocument" @click="copyJSON(step.arguments, '参数')">复制</el-button>
                    </div>
                    <pre>{{ formatJSON(step.arguments) }}</pre>
                  </section>
                  <section>
                    <div class="aq-json-stack__head">
                      <small>结果</small>
                      <el-button text size="small" :icon="CopyDocument" @click="copyJSON(step.result, '结果')">复制</el-button>
                    </div>
                    <pre>{{ formatJSON(step.result) }}</pre>
                  </section>
                </div>
              </div>
            </li>
          </ol>
          <el-empty v-else description="本次执行没有工具步骤" :image-size="64" />
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
  grid-template-columns: minmax(0, 1.8fr) repeat(5, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-kpis article {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 10px 14px;
  border-right: 1px solid var(--border);
}
.aq-kpis article:last-child {
  border-right: 0;
}
.aq-kpis small {
  flex: 0 0 auto;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.aq-kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 18px;
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
.aq-kpis__breakdown {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-kpis__breakdown b {
  font-weight: 650;
}
.aq-kpis__breakdown b.is-bad {
  color: var(--danger);
}
.aq-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
/* 与任务页状态标签一致：宽度随内容、选中态中性，高度与右侧 32px 控件对齐 */
.aq-tabs {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  padding: 2px;
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
  height: 26px;
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
  transition: background 0.15s ease, color 0.15s ease;
}
.aq-tab:hover:not(.is-active) {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.aq-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.aq-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.aq-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}
.aq-tab.is-active em {
  color: color-mix(in srgb, var(--surface) 78%, transparent);
}
html.dark .aq-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
html.dark .aq-tab.is-active em {
  color: var(--ink-3);
}
.aq-toolbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.aq-toolbar__right :deep(.el-checkbox) {
  height: 32px;
  margin-right: 0;
  color: var(--ink-2);
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
/* 执行追踪列表：每行单行显示，整行可点击打开详情 */
.aq-trace-table :deep(.el-table__row) {
  cursor: pointer;
}
.aq-trace-table :deep(.cell) {
  white-space: nowrap;
}
.aq-cell-strong {
  font-weight: 650;
}
.aq-cell-muted {
  color: var(--ink-3);
}
.aq-nowrap {
  white-space: nowrap;
}
.aq-drawer-head {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.aq-drawer-head__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.aq-drawer-head strong {
  font-size: 16px;
  font-weight: 700;
}
.aq-drawer-head > span {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-drawer {
  display: grid;
  align-content: start;
  gap: 16px;
  min-height: 160px;
}
.aq-trace-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 0.8fr)) minmax(0, 1.6fr);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-trace-overview > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border-right: 1px solid var(--border);
}
.aq-trace-overview > div:last-child {
  border-right: 0;
}
.aq-trace-overview small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-trace-overview strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-trace-overview > div:last-child strong {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 22px;
}
.aq-trace-overview em {
  margin-left: 4px;
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
  letter-spacing: 0;
}
.aq-trace-overview em.is-bad {
  color: var(--danger);
}
.aq-trace-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 24px;
  margin: 0;
  padding: 0 2px;
}
.aq-trace-facts > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.aq-trace-facts > div.is-wide {
  grid-column: 1 / -1;
}
.aq-trace-facts dt {
  flex: 0 0 112px;
  color: var(--ink-3);
  font-size: 12px;
}
.aq-trace-facts dd {
  min-width: 0;
  margin: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.aq-trace-facts dd.is-mono,
.aq-timeline code,
.aq-json-stack pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.aq-trace-facts dd.is-mono {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
}
.aq-section-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.aq-section-title strong {
  padding-top: 12px;
  font-size: 13px;
  font-weight: 700;
}
.aq-section-title small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.aq-timeline > li {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  padding-bottom: 14px;
}
.aq-timeline > li:not(:last-child)::before {
  content: "";
  position: absolute;
  top: 26px;
  bottom: 2px;
  left: 11.5px;
  width: 1px;
  background: var(--border);
}
.aq-timeline__dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;
}
.aq-timeline > li.is-succeeded .aq-timeline__dot {
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
  color: var(--success);
}
.aq-timeline > li.is-failed .aq-timeline__dot {
  border-color: color-mix(in srgb, var(--danger) 55%, transparent);
  color: var(--danger);
}
.aq-timeline > li.is-running .aq-timeline__dot {
  border-color: color-mix(in srgb, var(--warning) 55%, transparent);
  color: var(--warning);
}
.aq-timeline__body {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.aq-timeline__body > header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.aq-timeline code {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aq-timeline__body > header > small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-timeline__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.aq-timeline__toggle:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  color: var(--ink);
}
.aq-timeline__toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.aq-timeline__toggle .el-icon {
  transition: transform 0.15s ease;
}
.aq-timeline__toggle .el-icon.is-open {
  transform: rotate(180deg);
}
.aq-timeline__note {
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
}
.aq-json-stack {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-json-stack__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.aq-json-stack__head small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-json-stack__head .el-button {
  height: 22px;
  padding: 0 4px;
}
.aq-trace-goal {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.aq-trace-goal small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-trace-goal p {
  margin: 0;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.aq-trace-goal ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 18px;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.6;
}
.aq-user-search {
  width: 240px;
}
.aq-active-filter {
  display: flex;
  align-items: center;
  gap: 10px;
}
.aq-active-filter small {
  color: var(--ink-3);
  font-size: 12px;
}
.aq-sample-tag {
  margin-right: 6px;
}
.aq-json-stack pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.aq-result-list {
  display: grid;
  gap: 8px;
}
.aq-result-list article {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
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
@media (max-width: 1100px) {
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
  .aq-trace-overview,
  .aq-trace-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .aq-trace-overview > div:nth-child(2) {
    border-right: 0;
  }
  .aq-trace-overview > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--border);
  }
}
.quality-next-actions { display:flex;align-items:center;gap:10px;min-width:0; }.quality-next-actions .el-button { margin-left:0; }.quality-next-actions span { min-width:0;overflow:hidden;font-size:12px;color:var(--ink-3);text-overflow:ellipsis;white-space:nowrap; }
/* 卡片填满视口：列表在表格内部滚动，分页器固定在卡片底部可见。
   视口过矮时整页滚动，并给列表保留最低可读高度。 */
.aq-page { overflow-y:auto; }
.aq-page :deep(.page-card) { flex:1 1 0;min-height:560px; }
.aq-board { min-height:240px; }
.aq-page :deep(.cursor-pager) { flex:0 0 auto; }
</style>
