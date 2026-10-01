<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, VideoPlay } from "@element-plus/icons-vue";
import PageCard from "@/components/PageCard.vue";
import { request } from "@/request";

interface Thresholds {
  intent: number;
  clarify: number;
}

interface Candidate {
  id: string;
  name: string;
  pageDefault: boolean;
  available: boolean;
  upstreamModel: string;
}

interface DecisionSettings {
  override: { modelId: string; thresholds: Record<string, Thresholds> };
  defaultThresholds: Thresholds;
  source: "override" | "page_default" | "none";
  candidates: Candidate[];
  effective: { modelId: string; name: string; thresholds: Thresholds } | null;
  overrideIgnored: boolean;
}

interface DecisionStats {
  total: number;
  modelAnswered: number;
  rulesOnly: number;
  usedFallback: number;
  lowConfidence: number;
  agreeWithRules: number;
  delegated: number;
  clarified: number;
  avgLatencyMs: number;
  p90LatencyMs: number;
  byIntent: { intent: string; count: number; agree: number }[];
  byModel: { model: string; count: number; avgConfidence: number; avgLatencyMs: number }[];
}

interface CaseResult {
  id: string;
  prompt: string;
  context?: string;
  expected: string;
  note?: string;
  got: string;
  providerIntent: string;
  rulesIntent: string;
  confidence: number;
  provider: string;
  latencyMs: number;
  correct: boolean;
  error?: string;
}

interface EvalReport {
  modelId: string;
  mode: "rules" | "model";
  total: number;
  correct: number;
  accuracy: number;
  rulesAccuracy: number;
  avgLatencyMs: number;
  fallbackCount: number;
  byIntent: { intent: string; total: number; correct: number }[];
  mistakes: CaseResult[];
  thresholdCurve?: { threshold: number; accuracy: number }[];
  suggestedIntentThreshold?: number;
  durationMs: number;
}

const INTENT_LABELS: Record<string, string> = {
  answer: "直接回答",
  my_data: "查我的数据",
  create: "生成图片",
  web: "联网搜索",
  workspace: "站内工具",
  account: "账户与支付",
};

const loading = ref(false);
const saving = ref(false);
const settings = ref<DecisionSettings | null>(null);
const stats = ref<DecisionStats | null>(null);
const days = ref(7);
const evaluating = ref(false);
const report = ref<EvalReport | null>(null);
const evalModelId = ref("");
const form = reactive({ modelId: "", intent: 0.6, clarify: 0.75 });
const savedSignature = ref("");

const intentLabel = (intent: string) => INTENT_LABELS[intent] || intent || "—";
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ratio = (part: number, total: number) => (total ? percent(part / total) : "—");
const modelName = (id: string) => settings.value?.candidates.find((item) => item.id === id)?.name || id || "—";

// The thresholds edited here belong to the model that will actually run.
const targetModelId = computed(() => form.modelId || settings.value?.candidates.find((item) => item.pageDefault)?.id || "");
const signature = () => JSON.stringify([form.modelId, form.intent, form.clarify]);
const isDirty = computed(() => Boolean(savedSignature.value) && signature() !== savedSignature.value);

function thresholdsFor(modelId: string): Thresholds {
  const stored = settings.value?.override.thresholds || {};
  return stored[modelId] || stored.default || settings.value?.defaultThresholds || { intent: 0.6, clarify: 0.75 };
}

function hydrate(next: DecisionSettings) {
  settings.value = next;
  form.modelId = next.override.modelId || "";
  const thresholds = thresholdsFor(targetModelId.value);
  form.intent = thresholds.intent;
  form.clarify = thresholds.clarify;
  if (!evalModelId.value) evalModelId.value = next.effective?.modelId || "";
  savedSignature.value = signature();
}

watch(() => form.modelId, () => {
  if (!settings.value) return;
  const thresholds = thresholdsFor(targetModelId.value);
  form.intent = thresholds.intent;
  form.clarify = thresholds.clarify;
});

async function loadStats() {
  const data = await request<{ stats: DecisionStats }>("/api/v1/admin/assistant/decision/stats", { query: { days: days.value } });
  stats.value = data.stats;
}

async function load() {
  loading.value = true;
  try {
    const [next] = await Promise.all([
      request<DecisionSettings>("/api/v1/admin/assistant/decision"),
      loadStats(),
    ]);
    hydrate(next);
  } finally {
    loading.value = false;
  }
}

watch(days, () => { void loadStats(); });

async function save() {
  if (!settings.value || saving.value) return;
  saving.value = true;
  try {
    const thresholds = { ...(settings.value.override.thresholds || {}) };
    if (targetModelId.value) thresholds[targetModelId.value] = { intent: form.intent, clarify: form.clarify };
    hydrate(await request<DecisionSettings>("/api/v1/admin/assistant/decision", {
      method: "PUT",
      body: { modelId: form.modelId, thresholds },
    }));
    ElMessage.success("已保存，下一轮对话开始生效");
  } finally {
    saving.value = false;
  }
}

async function runEval(mode: "rules" | "model") {
  if (evaluating.value) return;
  if (mode === "model") {
    try {
      await ElMessageBox.confirm(
        `将用「${modelName(evalModelId.value)}」逐条判断 43 个内置问题，会真实调用模型并产生上游费用。`,
        "运行模型评测",
        { confirmButtonText: "开始评测", cancelButtonText: "取消", type: "warning" },
      );
    } catch {
      return;
    }
  }
  evaluating.value = true;
  try {
    const data = await request<{ report: EvalReport }>("/api/v1/admin/assistant/decision/evals", {
      method: "POST",
      body: { mode, modelId: mode === "model" ? evalModelId.value : "" },
    });
    report.value = data.report;
  } finally {
    evaluating.value = false;
  }
}

function applySuggested() {
  if (report.value?.suggestedIntentThreshold == null) return;
  if (report.value.modelId !== targetModelId.value) {
    ElMessage.warning("评测的模型与当前设置的判断模型不同，请先切换到同一模型再应用");
    return;
  }
  form.intent = report.value.suggestedIntentThreshold;
  ElMessage.info("已填入建议值，保存后生效");
}

const sourceText = computed(() => {
  switch (settings.value?.source) {
    case "override": return "使用单独指定的判断模型";
    case "page_default": return "跟随“页面分配”中 AI 助手的默认对话模型";
    default: return "没有可用模型，当前只用规则判断";
  }
});

onMounted(load);
</script>

<template>
  <div class="page ad-page">
    <PageCard title="判断模型" subtitle="每一轮对话先判断“需要什么能力、要不要先追问”。判断模型可以单独指定，不指定时跟随 AI 助手页面的默认对话模型。">
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>
      <el-alert
        v-if="settings?.overrideIgnored"
        type="warning"
        :closable="false"
        title="单独指定的模型已不可用（被停用或移出 AI 助手页面），当前已回退到页面默认模型。"
      />
      <div v-if="settings" class="ad-settings">
        <div class="ad-field">
          <label for="ad-model">判断模型</label>
          <el-select id="ad-model" v-model="form.modelId" placeholder="跟随页面默认模型" clearable class="ad-select">
            <el-option label="跟随页面默认模型" value="" />
            <el-option
              v-for="item in settings.candidates"
              :key="item.id"
              :value="item.id"
              :disabled="!item.available"
              :label="`${item.name}${item.pageDefault ? '（页面默认）' : ''}${item.available ? '' : '（维护中）'}`"
            />
          </el-select>
          <small>当前生效：{{ settings.effective?.name || "无" }} · {{ sourceText }}</small>
        </div>
        <div class="ad-field">
          <label for="ad-intent">意图置信度下限</label>
          <el-input-number id="ad-intent" v-model="form.intent" :min="0" :max="1" :step="0.05" :precision="2" />
          <small>模型给出的置信度低于该值时，改用规则的判断。不同模型的置信度不可比，所以每个模型单独设置。</small>
        </div>
        <div class="ad-field">
          <label for="ad-clarify">追问阈值</label>
          <el-input-number id="ad-clarify" v-model="form.clarify" :min="0" :max="1" :step="0.05" :precision="2" />
          <small>判断“必须先追问”的概率达到该值，才会先问用户一个问题。</small>
        </div>
        <div class="ad-save">
          <span v-if="targetModelId" class="ad-muted">阈值作用于：{{ modelName(targetModelId) }}</span>
          <el-button type="primary" :loading="saving" :disabled="!isDirty" @click="save">保存</el-button>
        </div>
      </div>
    </PageCard>

    <PageCard title="判断记录" :subtitle="`近 ${days} 日 AI 助手每一轮的判断。模型和规则同时判断，规则的结果只用于对比。`">
      <template #actions>
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
      </template>
      <section v-if="stats" class="ad-kpis" aria-label="判断摘要">
        <article><small>判断次数</small><strong class="tnum">{{ stats.total }}</strong></article>
        <article><small>由模型判断</small><strong class="tnum">{{ ratio(stats.modelAnswered, stats.total) }}</strong></article>
        <article :class="{ 'is-warn': stats.usedFallback > 0 }"><small>模型失败、改用规则</small><strong class="tnum">{{ stats.usedFallback }}</strong></article>
        <article><small>低置信度改用规则</small><strong class="tnum">{{ stats.lowConfidence }}</strong></article>
        <article><small>与规则一致</small><strong class="tnum">{{ ratio(stats.agreeWithRules, stats.modelAnswered) }}</strong></article>
        <article><small>交给原引擎</small><strong class="tnum">{{ stats.delegated }}</strong></article>
        <article><small>平均 / P90 耗时</small><strong class="tnum">{{ Math.round(stats.avgLatencyMs) }} / {{ Math.round(stats.p90LatencyMs) }} ms</strong></article>
      </section>
      <div v-if="stats" class="ad-tables">
        <el-table :data="stats.byIntent" size="small" empty-text="暂无记录">
          <el-table-column label="意图" min-width="120">
            <template #default="{ row }">{{ intentLabel(row.intent) }}</template>
          </el-table-column>
          <el-table-column prop="count" label="次数" width="90" align="right" />
          <el-table-column label="规则一致率" width="120" align="right">
            <template #default="{ row }">{{ ratio(row.agree, row.count) }}</template>
          </el-table-column>
        </el-table>
        <el-table :data="stats.byModel" size="small" empty-text="暂无模型判断">
          <el-table-column label="模型" min-width="140">
            <template #default="{ row }">{{ modelName(row.model) }}</template>
          </el-table-column>
          <el-table-column prop="count" label="次数" width="90" align="right" />
          <el-table-column label="平均置信度" width="120" align="right">
            <template #default="{ row }">{{ row.avgConfidence.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="平均耗时" width="110" align="right">
            <template #default="{ row }">{{ Math.round(row.avgLatencyMs) }} ms</template>
          </el-table-column>
        </el-table>
      </div>
    </PageCard>

    <PageCard title="评测" subtitle="用 43 个标注好的问题检验判断准确率，其中包含历史上被关键词误判过的问题。规则评测不花钱；模型评测会真实调用模型。">
      <template #actions>
        <el-select v-model="evalModelId" placeholder="选择模型" class="ad-select" :disabled="evaluating">
          <el-option v-for="item in settings?.candidates || []" :key="item.id" :value="item.id" :label="item.name" :disabled="!item.available" />
        </el-select>
        <el-button :loading="evaluating" @click="runEval('rules')">只评测规则</el-button>
        <el-button type="primary" :icon="VideoPlay" :loading="evaluating" :disabled="!evalModelId" @click="runEval('model')">评测模型</el-button>
      </template>
      <el-empty v-if="!report" description="还没有运行评测" :image-size="64" />
      <template v-else>
        <section class="ad-kpis" aria-label="评测结果">
          <article><small>{{ report.mode === 'model' ? `准确率 · ${modelName(report.modelId)}` : '规则准确率' }}</small><strong class="tnum">{{ percent(report.accuracy) }}</strong><span class="tnum">{{ report.correct }}/{{ report.total }}</span></article>
          <article v-if="report.mode === 'model'"><small>同一批问题的规则准确率</small><strong class="tnum">{{ percent(report.rulesAccuracy) }}</strong></article>
          <article v-if="report.mode === 'model'" :class="{ 'is-warn': report.fallbackCount > 0 }"><small>模型失败、改用规则</small><strong class="tnum">{{ report.fallbackCount }}</strong></article>
          <article v-if="report.mode === 'model'"><small>平均耗时</small><strong class="tnum">{{ Math.round(report.avgLatencyMs) }} ms</strong></article>
          <article v-if="report.suggestedIntentThreshold != null">
            <small>建议的意图置信度下限</small>
            <strong class="tnum">{{ report.suggestedIntentThreshold.toFixed(2) }}</strong>
            <el-button link type="primary" @click="applySuggested">填入设置</el-button>
          </article>
        </section>
        <div class="ad-tables">
          <el-table :data="report.byIntent" size="small">
            <el-table-column label="意图" min-width="120">
              <template #default="{ row }">{{ intentLabel(row.intent) }}</template>
            </el-table-column>
            <el-table-column label="正确" width="120" align="right">
              <template #default="{ row }">{{ row.correct }}/{{ row.total }}</template>
            </el-table-column>
          </el-table>
          <el-table :data="report.mistakes" size="small" empty-text="全部判断正确">
            <el-table-column label="判错的问题" min-width="220">
              <template #default="{ row }">
                <div class="ad-case">
                  <span>{{ row.prompt }}</span>
                  <small v-if="row.context">{{ row.context }}</small>
                  <small v-if="row.note">{{ row.note }}</small>
                  <small v-if="row.error" class="is-error">{{ row.error }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="应为" width="100">
              <template #default="{ row }">{{ intentLabel(row.expected) }}</template>
            </el-table-column>
            <el-table-column label="判为" width="100">
              <template #default="{ row }">{{ intentLabel(row.got) }}</template>
            </el-table-column>
            <el-table-column v-if="report.mode === 'model'" label="置信度" width="80" align="right">
              <template #default="{ row }">{{ row.provider === 'rules' ? '—' : row.confidence.toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </template>
    </PageCard>
  </div>
</template>

<style scoped>
.ad-page {
  display: grid;
  gap: 16px;
}

.ad-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px 24px;
  align-items: start;
  margin-top: 8px;
}

.ad-field {
  display: grid;
  gap: 6px;
}

.ad-field label {
  font-weight: 600;
  font-size: 13px;
}

.ad-field small,
.ad-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.ad-select {
  width: 100%;
  min-width: 200px;
}

.ad-save {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  grid-column: 1 / -1;
}

.ad-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.ad-kpis article {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.ad-kpis small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ad-kpis strong {
  font-size: 20px;
  font-weight: 600;
}

.ad-kpis span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ad-kpis .is-warn strong {
  color: var(--el-color-warning);
}

.ad-tables {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 16px;
}

.ad-case {
  display: grid;
  gap: 2px;
}

.ad-case small {
  color: var(--el-text-color-secondary);
}

.ad-case .is-error {
  color: var(--el-color-danger);
}

.tnum {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .ad-tables {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
