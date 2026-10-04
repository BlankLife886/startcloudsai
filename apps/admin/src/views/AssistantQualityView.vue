<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { Refresh, VideoPlay } from "@element-plus/icons-vue";
import PageCard from "@/components/PageCard.vue";
import HelpTip from "@/components/HelpTip.vue";
import { request } from "@/request";

interface QualityGroup {
  mode: string;
  model: string;
  promptVersion: string;
  turns: number;
  proposals: number;
  proposalsRun: number;
  proposalsUnused: number;
  justAsking: number;
  drawIt: number;
  searchWeb: number;
  stopped: number;
  imageDeleted: number;
  negativeFeedback: number;
  correctedInText: number;
}

interface QualityDay {
  day: string;
  turns: number;
  proposals: number;
  unused: number;
  corrections: number;
  negative: number;
}

interface CorrectionExample {
  event: string;
  mode: string;
  model: string;
  prompt: string;
  got: string;
  expected: string;
  createdAt: string;
}

interface CorrectionSummary {
  event: string;
  count: number;
  examples: CorrectionExample[];
}

interface CaseMessage {
  role: string;
  content: string;
}

interface AgentCase {
  id: string;
  source: "builtin" | "user";
  mode: string;
  context?: CaseMessage[];
  prompt: string;
  referenceCount?: number;
  expected: string[];
  note?: string;
  active: boolean;
}

interface Candidate {
  id: string;
  name: string;
  upstreamModel: string;
  available: boolean;
  unusable?: string;
  pageDefault: boolean;
}

interface Move {
  category: string;
  tool?: string;
  arguments?: string;
  text?: string;
  latencyMs: number;
}

interface CaseResult {
  case: AgentCase;
  got: Move;
  passed: boolean;
  error?: string;
}

interface EvalReport {
  modelId: string;
  total: number;
  passed: number;
  accuracy: number;
  errors: number;
  avgLatencyMs: number;
  byExpected: { expected: string; total: number; passed: number }[];
  failures: CaseResult[];
  durationMs: number;
}

interface CompareItem {
  case: AgentCase;
  recorded: string;
  now: Move;
  label?: string;
  verdict: string;
  error?: string;
  createdAt: string;
}

interface CompareReport {
  modelId: string;
  total: number;
  same: number;
  changed: number;
  better: number;
  likelyBetter: number;
  worse: number;
  stillWrong: number;
  unknown: number;
  errors: number;
  items: CompareItem[];
  durationMs: number;
}

interface StatsCaseResult {
  id: string;
  category: string;
  prompt: string;
  note?: string;
  expect: { tool: string };
  grade: { toolOk: boolean; argsOk: boolean; passed: boolean; problems: string[]; ungrounded: string[] };
  transcript: { calls: { name: string; arguments: string }[]; answer: string; latencyMs: number };
  error?: string;
}

interface StatsReport {
  modelId: string;
  total: number;
  passed: number;
  passRate: number;
  toolRate: number;
  argsRate: number;
  groundedRate: number;
  errors: number;
  avgLatencyMs: number;
  byCategory: { category: string; total: number; passed: number }[];
  failures: StatsCaseResult[];
  durationMs: number;
}

const MOVE_LABELS: Record<string, string> = {
  answer: "直接回答",
  image: "出图方案",
  web: "联网搜索",
  data: "查数据",
  workspace: "站内工具",
  files: "文件",
  other: "其他",
};
const EVENT_LABELS: Record<string, string> = {
  correction_just_asking: "点了“我只是问问”",
  correction_draw_it: "点了“帮我画出来”",
  correction_search_web: "点了“联网查一下”",
  corrected_in_text: "用文字纠正",
};
const EVENT_HINTS: Record<string, string> = {
  correction_just_asking: "出了图片方案，但用户只是在问问题",
  correction_draw_it: "回答了文字，但用户想要图（问答模式里点这个只是切到 Agent，不算做错）",
  correction_search_web: "没有联网，但用户需要最新信息",
  corrected_in_text: "用户下一句话表示助手理解错了（例如“不对”“我只是问问”）",
};
const VERDICT_LABELS: Record<string, string> = {
  better: "改好了",
  likely_better: "可能改好了",
  worse: "改坏了",
  still_wrong: "仍然错",
  unknown: "变了，无法判断",
};
const MODE_LABELS: Record<string, string> = { chat: "问答", agent: "Agent" };
const STATS_CATEGORIES = ["总量", "时间", "对比", "分组", "明细", "API", "账户", "扣费"];
const STATS_CASE_TOTAL = 64;
const UNUSABLE_LABELS: Record<string, string> = { disabled: "未启用", maintenance: "维护中", provider: "服务商未启用" };

const tab = ref<"metrics" | "corrections" | "compare" | "evals">("metrics");
const loading = ref(false);
const days = ref(7);

// 指标
const groups = ref<QualityGroup[]>([]);
const trend = ref<QualityDay[]>([]);
const corrections = ref<CorrectionSummary[]>([]);

// 用例
const builtinCases = ref<AgentCase[]>([]);
const userCases = ref<AgentCase[]>([]);
const caseBusyId = ref("");
const models = ref<Candidate[]>([]);
const modelId = ref("");

// 版本对比
const compareSample = ref(200);
const comparing = ref(false);
const compareReport = ref<CompareReport | null>(null);
const verdictFilter = ref("");

// 评测
const evalKind = ref<"moves" | "stats">("moves");
const evalScope = ref<"all" | "builtin" | "user">("all");
const evaluating = ref(false);
const evalReport = ref<EvalReport | null>(null);
const statsEvaluating = ref(false);
const statsReport = ref<StatsReport | null>(null);
const statsCategories = ref<string[]>([]);

const moveLabel = (value: string) => MOVE_LABELS[value] || value || "—";
const moveList = (values: string[]) => values.map(moveLabel).join(" / ");
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const rate = (part: number, total: number) => (total ? percent(part / total) : "—");
const modelName = (id: string) => models.value.find((item) => item.id === id)?.name || id || "—";
const usableModels = computed(() => models.value.filter((item) => item.available));
const unusableModels = computed(() => models.value.filter((item) => !item.available));
const activeUserCases = computed(() => userCases.value.filter((item) => item.active).length);
const scopeTotal = computed(() => {
  if (evalScope.value === "builtin") return builtinCases.value.length;
  if (evalScope.value === "user") return activeUserCases.value;
  return builtinCases.value.length + activeUserCases.value;
});

const corrected = (group: QualityGroup) => group.justAsking + group.drawIt + group.searchWeb + group.correctedInText;
const totals = computed(() => groups.value.reduce((sum, group) => ({
  turns: sum.turns + group.turns,
  proposals: sum.proposals + group.proposals,
  unused: sum.unused + group.proposalsUnused,
  corrected: sum.corrected + corrected(group),
  negative: sum.negative + group.negativeFeedback,
  stopped: sum.stopped + group.stopped,
  imageDeleted: sum.imageDeleted + group.imageDeleted,
}), { turns: 0, proposals: 0, unused: 0, corrected: 0, negative: 0, stopped: 0, imageDeleted: 0 }));
const trendMax = computed(() => Math.max(1, ...trend.value.map((day) => day.turns)));
const compareItems = computed(() => (compareReport.value?.items || []).filter((item) => !verdictFilter.value || (verdictFilter.value === "error" ? item.error : item.verdict === verdictFilter.value)));

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

async function loadMetrics() {
  const data = await request<{ groups: QualityGroup[]; days: QualityDay[]; corrections: CorrectionSummary[] }>("/api/v1/admin/assistant/quality", {
    query: { days: days.value },
  });
  groups.value = data.groups;
  trend.value = data.days;
  corrections.value = data.corrections;
}

async function loadCases() {
  const data = await request<{ builtin: AgentCase[]; stored: AgentCase[]; models: Candidate[] }>("/api/v1/admin/assistant/quality/cases");
  builtinCases.value = data.builtin;
  userCases.value = data.stored;
  models.value = data.models;
  if (!modelId.value) modelId.value = data.models.find((item) => item.pageDefault)?.id || usableModels.value[0]?.id || "";
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([loadMetrics(), loadCases()]);
  } finally {
    loading.value = false;
  }
}

watch(days, () => { void loadMetrics(); });

async function toggleCase(item: AgentCase, active: boolean) {
  caseBusyId.value = item.id;
  try {
    await request(`/api/v1/admin/assistant/quality/cases/${item.id}`, { method: "PATCH", body: { active } });
    item.active = active;
  } finally {
    caseBusyId.value = "";
  }
}

async function deleteCase(item: AgentCase) {
  try {
    await ElMessageBox.confirm("删除后这条用例不再参与评测；用户以后再纠正同一句话会重新加入。", "删除用例", {
      confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
    });
  } catch {
    return;
  }
  caseBusyId.value = item.id;
  try {
    await request(`/api/v1/admin/assistant/quality/cases/${item.id}`, { method: "DELETE" });
    userCases.value = userCases.value.filter((row) => row.id !== item.id);
  } finally {
    caseBusyId.value = "";
  }
}

async function confirmRun(title: string, message: string) {
  try {
    await ElMessageBox.confirm(message, title, { confirmButtonText: "开始", cancelButtonText: "取消", type: "warning" });
    return true;
  } catch {
    return false;
  }
}

async function runCompare() {
  if (comparing.value || !modelId.value) return;
  if (!(await confirmRun("版本对比", `将从近 ${days.value} 天的真实对话里随机取 ${compareSample.value} 轮，用当前提示词和「${modelName(modelId.value)}」各问一次第一步做什么（不执行工具），会真实调用模型并产生上游费用。`))) return;
  comparing.value = true;
  verdictFilter.value = "";
  try {
    const data = await request<{ report: CompareReport }>("/api/v1/admin/assistant/quality/compare", {
      method: "POST",
      body: { modelId: modelId.value, days: days.value, sample: compareSample.value },
    });
    compareReport.value = data.report;
  } finally {
    comparing.value = false;
  }
}

async function runEval() {
  if (evaluating.value || !modelId.value) return;
  if (!(await confirmRun("回归评测", `将用「${modelName(modelId.value)}」对 ${scopeTotal.value} 条用例各问一次第一步做什么（不执行工具），会真实调用模型并产生上游费用。`))) return;
  evaluating.value = true;
  try {
    const data = await request<{ report: EvalReport }>("/api/v1/admin/assistant/quality/evals", {
      method: "POST",
      body: { modelId: modelId.value, scope: evalScope.value },
    });
    evalReport.value = data.report;
  } finally {
    evaluating.value = false;
  }
}

async function runStatsEval() {
  if (statsEvaluating.value || !modelId.value) return;
  const scope = statsCategories.value.length ? `「${statsCategories.value.join("、")}」分类的问题` : `全部 ${STATS_CASE_TOTAL} 个问题`;
  if (!(await confirmRun("统计问答评测", `将用「${modelName(modelId.value)}」回答${scope}，每题会真实调用模型多次并产生上游费用；工具查询的是你自己账号的数据（只读）。最长约 5 分钟。`))) return;
  statsEvaluating.value = true;
  try {
    const data = await request<{ report: StatsReport }>("/api/v1/admin/assistant/stats-evals", {
      method: "POST",
      body: { modelId: modelId.value, categories: statsCategories.value },
    });
    statsReport.value = data.report;
  } finally {
    statsEvaluating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page aq-page">
    <PageCard class="aq-card">
      <template #header>
        <nav class="aq-tabs" role="tablist" aria-label="AI 助手质量">
          <button type="button" role="tab" :aria-selected="tab === 'metrics'" :class="{ active: tab === 'metrics' }" @click="tab = 'metrics'">指标</button>
          <button type="button" role="tab" :aria-selected="tab === 'corrections'" :class="{ active: tab === 'corrections' }" @click="tab = 'corrections'">用户纠正<em class="tnum">{{ totals.corrected }}</em></button>
          <button type="button" role="tab" :aria-selected="tab === 'compare'" :class="{ active: tab === 'compare' }" @click="tab = 'compare'">版本对比</button>
          <button type="button" role="tab" :aria-selected="tab === 'evals'" :class="{ active: tab === 'evals' }" @click="tab = 'evals'">回归评测</button>
        </nav>
      </template>
      <template #actions>
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>

      <!-- 指标 -->
      <section v-if="tab === 'metrics'" class="aq-pane" aria-label="指标">
        <p class="aq-intro">
          全部来自用户自己的操作，不需要任何人逐条复核：出了方案有没有人用、有没有点“我只是问问 / 帮我画出来 / 联网查一下”、有没有停止、点踩、出图后马上删掉、用文字纠正。
          <HelpTip content="只统计 AI 助手的问答和 Agent 模式。出图方案出来半小时还没执行才算“没人用”。按模式、模型和提示词版本分开统计，换模型或改提示词后直接对比。" />
        </p>
        <section class="aq-kpis" aria-label="总览">
          <article><small>回合数</small><strong class="tnum">{{ totals.turns }}</strong><span class="tnum">出图方案 {{ totals.proposals }}</span></article>
          <article :class="{ 'is-warn': totals.proposals > 0 && totals.unused / totals.proposals > 0.3 }"><small>方案没人用</small><strong class="tnum">{{ rate(totals.unused, totals.proposals) }}</strong><span class="tnum">{{ totals.unused }} 个</span></article>
          <article><small>用户纠正</small><strong class="tnum">{{ rate(totals.corrected, totals.turns) }}</strong><span class="tnum">{{ totals.corrected }} 次</span></article>
          <article><small>点踩</small><strong class="tnum">{{ rate(totals.negative, totals.turns) }}</strong><span class="tnum">停止 {{ totals.stopped }} · 出图后删图 {{ totals.imageDeleted }}</span></article>
        </section>

        <div class="aq-block">
          <h3>每天</h3>
          <p v-if="!trend.length" class="aq-empty">这段时间没有对话</p>
          <div v-else class="aq-trend" role="table" aria-label="每天的指标">
            <div class="aq-trend__row aq-trend__head" role="row">
              <span role="columnheader">日期</span><span role="columnheader">回合</span><span role="columnheader">方案没人用</span><span role="columnheader">纠正</span><span role="columnheader">点踩</span>
            </div>
            <div v-for="day in trend" :key="day.day" class="aq-trend__row" role="row">
              <span role="cell" class="tnum">{{ day.day.slice(5) }}</span>
              <span role="cell" class="aq-bar-cell"><i class="aq-bar" :style="{ width: `${(day.turns / trendMax) * 100}%` }" /><b class="tnum">{{ day.turns }}</b></span>
              <span role="cell" class="tnum">{{ rate(day.unused, day.proposals) }}</span>
              <span role="cell" class="tnum">{{ rate(day.corrections, day.turns) }}</span>
              <span role="cell" class="tnum">{{ rate(day.negative, day.turns) }}</span>
            </div>
          </div>
        </div>

        <div class="aq-block">
          <h3>按模式、模型和提示词版本</h3>
          <el-table :data="groups" size="small" empty-text="这段时间没有对话">
            <el-table-column label="模式" width="76">
              <template #default="{ row }">{{ MODE_LABELS[row.mode] || row.mode }}</template>
            </el-table-column>
            <el-table-column label="模型 · 提示词版本" min-width="180">
              <template #default="{ row }"><div class="aq-case"><span>{{ row.model || '—' }}</span><small>{{ row.promptVersion || '—' }}</small></div></template>
            </el-table-column>
            <el-table-column prop="turns" label="回合" width="80" align="right" />
            <el-table-column label="方案没人用" width="110" align="right">
              <template #default="{ row }">{{ rate(row.proposalsUnused, row.proposals) }}</template>
            </el-table-column>
            <el-table-column label="纠正" width="90" align="right">
              <template #default="{ row }">{{ rate(corrected(row as QualityGroup), row.turns) }}</template>
            </el-table-column>
            <el-table-column label="点踩" width="80" align="right">
              <template #default="{ row }">{{ rate(row.negativeFeedback, row.turns) }}</template>
            </el-table-column>
            <el-table-column label="停止" width="80" align="right">
              <template #default="{ row }">{{ rate(row.stopped, row.turns) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <!-- 用户纠正 -->
      <section v-else-if="tab === 'corrections'" class="aq-pane" aria-label="用户纠正">
        <p class="aq-intro">
          用户点一下就按对的方式重来，这一轮同时记成“本该怎么做”。真正做错的会自动变成回归用例，同一句话只留一条，最多 500 条。
        </p>
        <p v-if="!corrections.length" class="aq-empty">这段时间没有用户纠正</p>
        <article v-for="summary in corrections" :key="summary.event" class="aq-summary">
          <header>
            <strong>{{ EVENT_LABELS[summary.event] || summary.event }}</strong>
            <span class="aq-count tnum">{{ summary.count }} 次</span>
            <small>{{ EVENT_HINTS[summary.event] }}</small>
          </header>
          <ul>
            <li v-for="(example, index) in summary.examples" :key="index">
              <span class="aq-tag">{{ MODE_LABELS[example.mode] || example.mode }}</span>
              <span class="aq-prompt">{{ example.prompt || '—' }}</span>
              <small v-if="example.got" class="tnum">{{ moveLabel(example.got) }} → {{ moveLabel(example.expected) || '—' }} · {{ formatTime(example.createdAt) }}</small>
              <small v-else class="tnum">{{ formatTime(example.createdAt) }}</small>
            </li>
          </ul>
        </article>

        <div class="aq-block">
          <h3>回归用例<em class="tnum">{{ userCases.length }}</em><HelpTip content="来自用户的一键纠正；内置用例另有 62 条，随代码维护。暂停的用例不参与评测。" /></h3>
          <el-table :data="userCases" size="small" empty-text="还没有用户纠正产生的用例">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="aq-case aq-context">
                  <small v-if="!row.context?.length">（没有前文）</small>
                  <small v-for="(message, index) in row.context" :key="index"><b>{{ message.role === 'user' ? '用户' : '助手' }}：</b>{{ message.content }}</small>
                  <small v-if="row.referenceCount">本轮附带 {{ row.referenceCount }} 张参考图</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="用户这一句" min-width="240" prop="prompt" />
            <el-table-column label="模式" width="80">
              <template #default="{ row }">{{ MODE_LABELS[row.mode] || row.mode }}</template>
            </el-table-column>
            <el-table-column label="本该" width="110">
              <template #default="{ row }">{{ moveList(row.expected) }}</template>
            </el-table-column>
            <el-table-column label="参与评测" width="100" align="center">
              <template #default="{ row }">
                <el-switch :model-value="row.active" :loading="caseBusyId === row.id" :aria-label="`${row.active ? '暂停' : '启用'}用例`" @change="(value: string | number | boolean) => toggleCase(row as AgentCase, Boolean(value))" />
              </template>
            </el-table-column>
            <el-table-column label="" width="70" align="right">
              <template #default="{ row }">
                <el-button link type="danger" :disabled="caseBusyId === row.id" @click="deleteCase(row as AgentCase)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <!-- 版本对比 -->
      <section v-else-if="tab === 'compare'" class="aq-pane" aria-label="版本对比">
        <p class="aq-intro">
          换模型或改了提示词之后，从最近的真实对话里抽一批，用新版本重新问一次“第一步做什么”，只列出和当时做法不同的。好坏按当时用户自己的反应判断：用户纠正过的、执行过方案的、停止或点踩过的。
        </p>
        <div class="aq-toolbar">
          <el-select v-model="modelId" placeholder="选择模型" filterable class="aq-select" popper-class="aq-model-popper" :disabled="comparing">
            <el-option-group v-if="usableModels.length" label="可用">
              <el-option v-for="item in usableModels" :key="item.id" :value="item.id" :label="item.name">
                <div class="aq-option"><span>{{ item.name }}</span><small v-if="item.pageDefault" class="aq-option-tag">页面默认</small><small class="aq-mono">{{ item.upstreamModel }}</small></div>
              </el-option>
            </el-option-group>
            <el-option-group v-if="unusableModels.length" label="不可用">
              <el-option v-for="item in unusableModels" :key="item.id" :value="item.id" :label="item.name" disabled>
                <div class="aq-option"><span>{{ item.name }}</span><small class="aq-option-tag is-warn">{{ UNUSABLE_LABELS[item.unusable || ''] || '不可用' }}</small></div>
              </el-option>
            </el-option-group>
          </el-select>
          <label class="aq-inline">
            <span>抽样</span>
            <el-input-number v-model="compareSample" :min="20" :max="300" :step="50" size="small" controls-position="right" :disabled="comparing" />
            <span>轮</span>
          </label>
          <el-button type="primary" :icon="VideoPlay" :loading="comparing" :disabled="!modelId" @click="runCompare">开始对比</el-button>
        </div>
        <p v-if="!compareReport" class="aq-empty">还没有运行对比。每轮真实调用一次模型，不执行工具。</p>
        <template v-else>
          <section class="aq-kpis" aria-label="对比结果">
            <article><small>和当时一样 · {{ modelName(compareReport.modelId) }}</small><strong class="tnum">{{ rate(compareReport.same, compareReport.total) }}</strong><span class="tnum">{{ compareReport.same }}/{{ compareReport.total }}</span></article>
            <article class="is-good"><small>改好了</small><strong class="tnum">{{ compareReport.better }}</strong><span class="tnum">可能改好 {{ compareReport.likelyBetter }}</span></article>
            <article :class="{ 'is-warn': compareReport.worse > 0 }"><small>改坏了</small><strong class="tnum">{{ compareReport.worse }}</strong><span class="tnum">仍然错 {{ compareReport.stillWrong }}</span></article>
            <article><small>变了，无法判断</small><strong class="tnum">{{ compareReport.unknown }}</strong><span class="tnum">调用失败 {{ compareReport.errors }}</span></article>
          </section>
          <div class="aq-chips" role="group" aria-label="按结论筛选">
            <button type="button" :class="{ active: verdictFilter === '' }" @click="verdictFilter = ''">全部<em class="tnum">{{ compareReport.items.length }}</em></button>
            <button v-for="(label, key) in VERDICT_LABELS" :key="key" type="button" :class="{ active: verdictFilter === key }" @click="verdictFilter = key">{{ label }}</button>
            <button v-if="compareReport.errors" type="button" :class="{ active: verdictFilter === 'error' }" @click="verdictFilter = 'error'">调用失败</button>
          </div>
          <el-table :data="compareItems" size="small" empty-text="没有需要看的回合">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="aq-case aq-context">
                  <small v-for="(message, index) in row.case.context || []" :key="index"><b>{{ message.role === 'user' ? '用户' : '助手' }}：</b>{{ message.content }}</small>
                  <small v-if="row.now.tool"><code>{{ row.now.tool }} {{ row.now.arguments }}</code></small>
                  <span v-if="row.now.text" class="aq-answer">{{ row.now.text }}</span>
                  <small v-if="row.error" class="is-error">{{ row.error }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="用户这一句" min-width="220">
              <template #default="{ row }"><div class="aq-case"><span>{{ row.case.prompt }}</span><small>{{ MODE_LABELS[row.case.mode] || row.case.mode }} · {{ formatTime(row.createdAt) }}</small></div></template>
            </el-table-column>
            <el-table-column label="当时 → 现在" width="170">
              <template #default="{ row }">{{ moveLabel(row.recorded) }} → <b>{{ row.error ? '调用失败' : moveLabel(row.now.category) }}</b></template>
            </el-table-column>
            <el-table-column label="结论" width="140">
              <template #default="{ row }">
                <span class="aq-verdict" :class="row.verdict">{{ VERDICT_LABELS[row.verdict] || '—' }}</span>
                <small v-if="row.label" class="aq-muted"> 用户说本该{{ moveLabel(row.label) }}</small>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </section>

      <!-- 回归评测 -->
      <section v-else class="aq-pane" aria-label="回归评测">
        <div class="aq-toolbar">
          <el-segmented v-model="evalKind" :options="[{ label: `第一步 · ${builtinCases.length + activeUserCases} 题`, value: 'moves' }, { label: `统计问答 · ${STATS_CASE_TOTAL} 题`, value: 'stats' }]" />
          <HelpTip
            :content="evalKind === 'moves'
              ? '用和真实对话完全相同的提示词与工具，问模型每条用例第一步做什么（不执行工具）。用例包括 62 条内置和用户纠正产生的。'
              : `用 ${STATS_CASE_TOTAL} 个真实问法检验 AI 助手回答“我的数据”：选对工具、指标、分组和时间范围，回答里的每个数字都能在工具结果里找到出处。`"
          />
          <span class="aq-spacer" />
          <el-select v-model="modelId" placeholder="选择模型" filterable class="aq-select aq-select--sm" popper-class="aq-model-popper" :disabled="evaluating || statsEvaluating">
            <el-option v-for="item in usableModels" :key="item.id" :value="item.id" :label="item.name" />
          </el-select>
          <template v-if="evalKind === 'moves'">
            <el-select v-model="evalScope" class="aq-select aq-select--xs" :disabled="evaluating" aria-label="评测范围">
              <el-option label="全部用例" value="all" />
              <el-option label="只评内置" value="builtin" />
              <el-option label="只评用户纠正" value="user" />
            </el-select>
            <el-button type="primary" :icon="VideoPlay" :loading="evaluating" :disabled="!modelId || !scopeTotal" @click="runEval">开始评测</el-button>
          </template>
          <template v-else>
            <el-select v-model="statsCategories" multiple collapse-tags placeholder="全部分类" class="aq-select aq-select--sm" :disabled="statsEvaluating">
              <el-option v-for="item in STATS_CATEGORIES" :key="item" :value="item" :label="item" />
            </el-select>
            <el-button type="primary" :icon="VideoPlay" :loading="statsEvaluating" :disabled="!modelId" @click="runStatsEval">开始评测</el-button>
          </template>
        </div>

        <template v-if="evalKind === 'moves'">
          <p v-if="!evalReport" class="aq-empty">还没有运行评测。每条用例真实调用一次模型，不执行工具。</p>
          <template v-else>
            <section class="aq-kpis" aria-label="评测结果">
              <article><small>第一步正确 · {{ modelName(evalReport.modelId) }}</small><strong class="tnum">{{ percent(evalReport.accuracy) }}</strong><span class="tnum">{{ evalReport.passed }}/{{ evalReport.total }}</span></article>
              <article><small>平均耗时</small><strong class="tnum">{{ (evalReport.avgLatencyMs / 1000).toFixed(1) }} s</strong><span class="tnum">整轮 {{ (evalReport.durationMs / 1000).toFixed(0) }} s</span></article>
              <article :class="{ 'is-warn': evalReport.errors > 0 }"><small>调用失败</small><strong class="tnum">{{ evalReport.errors }}</strong></article>
            </section>
            <div class="aq-tables">
              <div>
                <h3>按本该的第一步</h3>
                <el-table :data="evalReport.byExpected" size="small">
                  <el-table-column label="本该" min-width="110">
                    <template #default="{ row }">{{ moveLabel(row.expected) }}</template>
                  </el-table-column>
                  <el-table-column label="正确" width="100" align="right">
                    <template #default="{ row }">{{ row.passed }}/{{ row.total }}</template>
                  </el-table-column>
                </el-table>
              </div>
              <div>
                <h3>做错的用例<em class="tnum">{{ evalReport.failures.length }}</em></h3>
                <el-table :data="evalReport.failures" size="small" empty-text="全部正确">
                  <el-table-column type="expand">
                    <template #default="{ row }">
                      <div class="aq-case aq-context">
                        <small v-for="(message, index) in row.case.context || []" :key="index"><b>{{ message.role === 'user' ? '用户' : '助手' }}：</b>{{ message.content }}</small>
                        <small v-if="row.got.tool"><code>{{ row.got.tool }} {{ row.got.arguments }}</code></small>
                        <span v-if="row.got.text" class="aq-answer">{{ row.got.text }}</span>
                        <small v-if="row.error" class="is-error">{{ row.error }}</small>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="用户这一句" min-width="200">
                    <template #default="{ row }">
                      <div class="aq-case">
                        <span>{{ row.case.prompt }}</span>
                        <small>{{ MODE_LABELS[row.case.mode] || row.case.mode }} · {{ row.case.source === 'user' ? '用户纠正' : '内置' }}<template v-if="row.case.note"> · {{ row.case.note }}</template></small>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="本该 → 实际" width="190">
                    <template #default="{ row }">
                      {{ moveList(row.case.expected) }} →
                      <span class="is-error">{{ row.error ? '调用失败' : moveLabel(row.got.category) }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </template>
        </template>

        <template v-else>
          <p v-if="!statsReport" class="aq-empty">还没有运行评测。每题会真实调用模型多次，最长约 5 分钟。</p>
          <template v-else>
            <section class="aq-kpis" aria-label="统计问答评测结果">
              <article><small>通过率 · {{ modelName(statsReport.modelId) }}</small><strong class="tnum">{{ percent(statsReport.passRate) }}</strong><span class="tnum">{{ statsReport.passed }}/{{ statsReport.total }} · 平均 {{ (statsReport.avgLatencyMs / 1000).toFixed(1) }} s</span></article>
              <article><small>选对工具 / 参数正确</small><strong class="tnum">{{ percent(statsReport.toolRate) }}</strong><span class="tnum">参数 {{ percent(statsReport.argsRate) }}</span></article>
              <article :class="{ 'is-warn': statsReport.groundedRate < 1 }"><small>数字都有出处</small><strong class="tnum">{{ percent(statsReport.groundedRate) }}</strong></article>
              <article :class="{ 'is-warn': statsReport.errors > 0 }"><small>回答失败</small><strong class="tnum">{{ statsReport.errors }}</strong></article>
            </section>
            <div class="aq-tables">
              <div>
                <h3>按分类</h3>
                <el-table :data="statsReport.byCategory" size="small">
                  <el-table-column prop="category" label="分类" min-width="100" />
                  <el-table-column label="通过" width="100" align="right">
                    <template #default="{ row }">{{ row.passed }}/{{ row.total }}</template>
                  </el-table-column>
                </el-table>
              </div>
              <div>
                <h3>未通过的问题<em class="tnum">{{ statsReport.failures.length }}</em></h3>
                <el-table :data="statsReport.failures" size="small" empty-text="全部通过">
                  <el-table-column type="expand">
                    <template #default="{ row }">
                      <div class="aq-case aq-context">
                        <small v-for="(call, index) in row.transcript.calls" :key="index"><code>{{ call.name }} {{ call.arguments }}</code></small>
                        <span class="aq-answer">{{ row.transcript.answer || row.error || '（没有回答）' }}</span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="问题" min-width="200">
                    <template #default="{ row }">
                      <div class="aq-case">
                        <span>{{ row.prompt }}</span>
                        <small>{{ row.category }} · 应调用 {{ row.expect.tool }}</small>
                        <small v-if="row.note">{{ row.note }}</small>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="原因" min-width="220">
                    <template #default="{ row }">
                      <div class="aq-case">
                        <small v-for="problem in row.grade.problems" :key="problem" class="is-error">{{ problem }}</small>
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </template>
        </template>
      </section>
    </PageCard>
  </div>
</template>

<style scoped>
.aq-page {
  display: grid;
  gap: 12px;
}

.aq-card :deep(.page-card__header) {
  flex-wrap: wrap;
  justify-content: space-between;
}

.aq-tabs,
.aq-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.aq-tabs button,
.aq-chips button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.aq-chips button {
  padding: 4px 12px;
  font-size: 12px;
}

.aq-tabs button.active,
.aq-chips button.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--surface);
}

.aq-tabs em,
.aq-chips em,
.aq-block h3 em,
.aq-tables h3 em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.7;
}

.aq-pane {
  display: grid;
  gap: 16px;
}

.aq-intro {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.aq-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.aq-toolbar .el-button + .el-button {
  margin-left: 0;
}

.aq-spacer {
  flex: 1;
}

.aq-select {
  width: 260px;
  max-width: 100%;
}

.aq-select--sm {
  width: 200px;
}

.aq-select--xs {
  width: 140px;
}

.aq-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 13px;
}

.aq-inline :deep(.el-input-number) {
  width: 110px;
}

.aq-empty {
  margin: 0;
  padding: 32px 16px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}

.aq-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.aq-kpis article {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.aq-kpis small,
.aq-kpis span {
  color: var(--ink-3);
  font-size: 12px;
}

.aq-kpis strong {
  font-size: 20px;
  font-weight: 600;
}

.aq-kpis .is-warn strong {
  color: var(--el-color-warning);
}

.aq-kpis .is-good strong {
  color: var(--el-color-success);
}

.aq-block {
  display: grid;
  gap: 8px;
}

.aq-block h3,
.aq-tables h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
}

.aq-trend {
  display: grid;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.aq-trend__row {
  display: grid;
  grid-template-columns: 64px minmax(120px, 2fr) repeat(3, minmax(70px, 1fr));
  align-items: center;
  gap: 12px;
  padding: 7px 14px;
  font-size: 12.5px;
}

.aq-trend__row + .aq-trend__row {
  border-top: 1px solid var(--border);
}

.aq-trend__head {
  background: var(--el-fill-color-light);
  color: var(--ink-3);
  font-size: 12px;
}

.aq-bar-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.aq-bar {
  display: block;
  height: 8px;
  min-width: 2px;
  border-radius: 4px;
  background: var(--el-color-primary-light-5);
}

.aq-bar-cell b {
  font-weight: 500;
}

.aq-summary {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.aq-summary header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.aq-summary header small {
  flex-basis: 100%;
  color: var(--ink-3);
}

.aq-count {
  color: var(--el-color-warning-dark-2);
  font-size: 13px;
  font-weight: 600;
}

.aq-summary ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.aq-summary li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.aq-summary li small {
  color: var(--ink-3);
}

.aq-prompt {
  min-width: 0;
  overflow-wrap: anywhere;
}

.aq-tag {
  padding: 0 8px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--ink-2);
  font-size: 12px;
  line-height: 20px;
}

.aq-verdict {
  font-weight: 600;
}

.aq-verdict.better,
.aq-verdict.likely_better {
  color: var(--el-color-success);
}

.aq-verdict.worse,
.aq-verdict.still_wrong {
  color: var(--el-color-danger);
}

.aq-muted {
  color: var(--ink-3);
}

.aq-tables {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 20px;
  align-items: start;
}

.aq-tables h3 {
  margin-bottom: 6px;
}

.aq-case {
  display: grid;
  gap: 2px;
}

.aq-case small {
  color: var(--ink-3);
}

.aq-context {
  padding: 4px 12px;
}

.aq-context code {
  white-space: pre-wrap;
  word-break: break-all;
}

.aq-answer {
  white-space: pre-wrap;
}

.is-error,
.aq-case .is-error {
  color: var(--el-color-danger);
}

.tnum {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .aq-tables {
    grid-template-columns: minmax(0, 1fr);
  }

  .aq-spacer {
    display: none;
  }

  .aq-trend__row {
    grid-template-columns: 48px minmax(80px, 1.4fr) repeat(3, minmax(52px, 1fr));
    gap: 8px;
    padding: 7px 10px;
  }
}
</style>

<style>
/* 下拉层被挂到 body 上，scoped 样式够不着 */
.aq-model-popper .aq-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.aq-model-popper .aq-option > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aq-model-popper .aq-option small {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.aq-model-popper .aq-mono {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.aq-model-popper .aq-option-tag {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary) !important;
  line-height: 18px;
}

.aq-model-popper .aq-option-tag.is-warn {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning) !important;
}
</style>
