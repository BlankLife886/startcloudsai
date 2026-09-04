<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import PageCard from "@/components/PageCard.vue";
import { request, isRequestAborted } from "@/request";
import { buildModelCatalog, catalogModelName } from "@/userProfile";

interface ProfitSummary {
  revenueCents: number;
  upstreamCostCents: number;
  grossProfitCents: number;
  succeededUnits: number;
  failedUnits: number;
}

interface ProfitRow extends ProfitSummary {
  key: string;
  label: string;
  units: number;
}

interface ProfitResponse {
  dimension: string;
  days: number;
  since: string;
  summary: ProfitSummary;
  items: ProfitRow[];
}

const dimensions = [
  { value: "model", label: "模型" },
  { value: "provider", label: "服务商" },
  { value: "route", label: "线路" },
  { value: "workspace", label: "业务" },
  { value: "user", label: "用户" },
];

const days = ref<7 | 30>(30);
const dimension = ref("model");
const loading = ref(false);
const loaded = ref(false);
const data = ref<ProfitResponse | null>(null);
const modelCatalog = ref<Record<string, string>>({});
let requestVersion = 0;

function points(value: number | undefined) {
  return Math.round(Number(value || 0)).toLocaleString("zh-CN");
}

function margin(row: { revenueCents?: number; grossProfitCents?: number }) {
  const revenue = Number(row.revenueCents || 0);
  const profit = Number(row.grossProfitCents || 0);
  if (!revenue) return profit < 0 ? "亏损" : "—";
  return `${((profit / revenue) * 100).toFixed(1)}%`;
}

const summary = computed<ProfitSummary>(() => data.value?.summary || {
  revenueCents: 0,
  upstreamCostCents: 0,
  grossProfitCents: 0,
  succeededUnits: 0,
  failedUnits: 0,
});

const items = computed(() => data.value?.items || []);

function rowName(row: Partial<Pick<ProfitRow, "key" | "label">>) {
  if (dimension.value === "model" && row.key) {
    const named = catalogModelName(row.key, modelCatalog.value);
    if (named && named !== row.key) return named;
  }
  return row.label || row.key || "未记录";
}
const lossCount = computed(() => items.value.filter((item) => item.grossProfitCents < 0).length);
const dimensionLabel = computed(() => dimensions.find((item) => item.value === dimension.value)?.label || "模型");

async function load() {
  const version = ++requestVersion;
  loading.value = true;
  try {
    const result = await request<ProfitResponse>("/api/v1/admin/profitability", {
      query: { days: days.value, dimension: dimension.value },
    });
    if (version === requestVersion) data.value = result;
  } catch (error) {
    if (!isRequestAborted(error)) throw error;
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      loaded.value = true;
    }
  }
}

watch([days, dimension], () => void load());
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
  <div class="page profit-page">
    <PageCard>
      <template #actions>
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>

      <section class="profit-kpis" aria-label="利润摘要">
        <article>
          <small>实收积分</small>
          <strong class="tnum">{{ points(summary.revenueCents) }}</strong>
        </article>
        <article>
          <small>上游成本</small>
          <strong class="tnum">{{ points(summary.upstreamCostCents) }}</strong>
        </article>
        <article :class="{ 'is-loss': summary.grossProfitCents < 0, 'is-gain': summary.grossProfitCents > 0 }">
          <small>毛利</small>
          <strong class="tnum">{{ points(summary.grossProfitCents) }}</strong>
        </article>
        <article :class="{ 'is-loss': summary.grossProfitCents < 0, 'is-gain': summary.grossProfitCents > 0 }">
          <small>毛利率</small>
          <strong class="tnum">{{ margin(summary) }}</strong>
        </article>
      </section>

      <p class="profit-legend">
        近 {{ days }} 日按{{ dimensionLabel }}汇总
        <em class="tnum">{{ items.length }}</em>
        项，成功
        <em class="tnum">{{ points(summary.succeededUnits) }}</em>
        、失败
        <em class="tnum">{{ points(summary.failedUnits) }}</em>
        。
        <span v-if="lossCount" class="is-loss">{{ lossCount }} 项亏损。</span>
        统计从配置成本后的新任务开始累计。
      </p>

      <div class="profit-toolbar">
        <div class="profit-tabs" role="tablist" aria-label="利润维度">
          <button
            v-for="item in dimensions"
            :key="item.value"
            type="button"
            role="tab"
            class="profit-tab"
            :class="{ 'is-active': dimension === item.value }"
            :aria-selected="dimension === item.value"
            @click="dimension = item.value"
          >
            {{ item.label }}
            <em v-if="dimension === item.value" class="tnum">{{ items.length }}</em>
          </button>
        </div>
        <span v-if="lossCount" class="profit-loss">{{ lossCount }} 项亏损</span>
      </div>

      <div v-loading="loading" class="profit-board">
        <el-table :data="items" height="100%" empty-text="当前周期暂无成本数据">
          <el-table-column label="名称" min-width="220">
            <template #default="{ row }">
              <div class="profit-name">
                <strong :title="row.key && row.key !== rowName(row) ? row.key : undefined">
                  {{ rowName(row) }}
                </strong>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="调用量" prop="units" width="110" align="right">
            <template #default="{ row }">
              <span class="tnum">{{ points(row.units) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="实收" prop="revenueCents" width="130" align="right">
            <template #default="{ row }">
              <span class="tnum">{{ points(row.revenueCents) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="上游成本" prop="upstreamCostCents" width="140" align="right">
            <template #default="{ row }">
              <span class="tnum">{{ points(row.upstreamCostCents) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="毛利" prop="grossProfitCents" width="130" align="right">
            <template #default="{ row }">
              <span class="profit-value tnum" :class="{ 'is-loss': row.grossProfitCents < 0 }">{{ points(row.grossProfitCents) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="毛利率" width="110" align="right">
            <template #default="{ row }">
              <span class="profit-value tnum" :class="{ 'is-loss': row.grossProfitCents < 0 }">{{ margin(row) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <p v-if="loaded && !loading" class="profit-footnote">
        历史任务没有上游成本快照，不会猜测回填。
      </p>
    </PageCard>
  </div>
</template>

<style scoped>
.profit-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}
.profit-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.profit-page :deep(.page-card__header) {
  flex-wrap: wrap;
  align-items: flex-start;
}
.profit-page :deep(.page-card__actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.profit-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  overflow: hidden;
}
.profit-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.profit-kpis article {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
}
.profit-kpis article:last-child {
  border-right: 0;
}
.profit-kpis small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.profit-kpis strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profit-kpis article.is-gain strong,
.profit-value {
  color: var(--success);
}
.profit-kpis article.is-loss strong,
.profit-value.is-loss,
.profit-legend .is-loss,
.profit-loss {
  color: var(--danger);
}
.profit-legend {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.profit-legend em {
  margin: 0 2px;
  color: var(--ink);
  font-style: normal;
  font-weight: 750;
}
.profit-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.profit-tabs {
  display: flex;
  min-width: 0;
  flex: 1 1 360px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}
.profit-tabs::-webkit-scrollbar {
  display: none;
}
.profit-tab {
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
.profit-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.profit-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}
.profit-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}
.profit-loss {
  font-size: 12px;
  font-weight: 750;
}
.profit-board {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.profit-name {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.profit-name strong,
.profit-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profit-name small {
  color: var(--ink-3);
  font-size: 12px;
}
.profit-value {
  font-weight: 750;
}
.profit-footnote {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.5;
}
@media (max-width: 1080px) {
  .profit-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .profit-kpis article:nth-child(2) {
    border-right: 0;
  }
}
</style>
