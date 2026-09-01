<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Coin, Refresh, TrendCharts, Warning } from "@element-plus/icons-vue";
import { request, isRequestAborted } from "@/request";

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

const lossCount = computed(() => data.value?.items.filter((item) => item.grossProfitCents < 0).length || 0);

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
onMounted(() => void load());
</script>

<template>
  <div class="profit-page">
    <header class="profit-head">
      <div>
        <h2>成本利润</h2>
        <p>实收积分与任务创建时快照的上游成本</p>
      </div>
      <div class="profit-head__actions">
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-button :icon="Refresh" :loading="loading" circle title="刷新" @click="load" />
      </div>
    </header>

    <section class="profit-kpis">
      <article>
        <span class="profit-kpis__icon is-revenue"><Coin /></span>
        <div><small>实收积分</small><strong>{{ points(summary.revenueCents) }}</strong></div>
      </article>
      <article>
        <span class="profit-kpis__icon is-cost"><TrendCharts /></span>
        <div><small>上游成本</small><strong>{{ points(summary.upstreamCostCents) }}</strong></div>
      </article>
      <article :class="{ 'is-loss': summary.grossProfitCents < 0 }">
        <span class="profit-kpis__icon is-profit"><TrendCharts /></span>
        <div><small>毛利</small><strong>{{ points(summary.grossProfitCents) }}</strong></div>
      </article>
      <article :class="{ 'is-loss': summary.grossProfitCents < 0 }">
        <span class="profit-kpis__icon is-margin"><Warning v-if="summary.grossProfitCents < 0" /><TrendCharts v-else /></span>
        <div><small>毛利率</small><strong>{{ margin(summary) }}</strong></div>
      </article>
    </section>

    <section class="profit-table-shell">
      <header>
        <div class="profit-dimensions" role="tablist" aria-label="利润维度">
          <button v-for="item in dimensions" :key="item.value" type="button" role="tab" :aria-selected="dimension === item.value" :class="{ 'is-active': dimension === item.value }" @click="dimension = item.value">{{ item.label }}</button>
        </div>
        <span v-if="lossCount" class="profit-loss-count">{{ lossCount }} 项亏损</span>
      </header>

      <el-table v-loading="loading" :data="data?.items || []" height="100%" empty-text="当前周期暂无成本数据">
        <el-table-column label="名称" min-width="220">
          <template #default="{ row }">
            <div class="profit-name"><strong>{{ row.label || '未记录' }}</strong><small v-if="row.label !== row.key">{{ row.key }}</small></div>
          </template>
        </el-table-column>
        <el-table-column label="调用量" prop="units" width="110" align="right">
          <template #default="{ row }">{{ points(row.units) }}</template>
        </el-table-column>
        <el-table-column label="实收" prop="revenueCents" width="130" align="right">
          <template #default="{ row }">{{ points(row.revenueCents) }}</template>
        </el-table-column>
        <el-table-column label="上游成本" prop="upstreamCostCents" width="140" align="right">
          <template #default="{ row }">{{ points(row.upstreamCostCents) }}</template>
        </el-table-column>
        <el-table-column label="毛利" prop="grossProfitCents" width="130" align="right">
          <template #default="{ row }"><span class="profit-value" :class="{ 'is-loss': row.grossProfitCents < 0 }">{{ points(row.grossProfitCents) }}</span></template>
        </el-table-column>
        <el-table-column label="毛利率" width="110" align="right">
          <template #default="{ row }"><span class="profit-value" :class="{ 'is-loss': row.grossProfitCents < 0 }">{{ margin(row) }}</span></template>
        </el-table-column>
      </el-table>
      <div v-if="loaded && !loading" class="profit-footnote">历史任务没有上游成本快照，不会猜测回填；统计从配置成本后的新任务开始准确累计。</div>
    </section>
  </div>
</template>

<style scoped>
.profit-page { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 14px; height: 100%; min-height: 0; }
.profit-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.profit-head h2 { margin: 0; color: var(--text-primary); font-size: 1.12rem; font-weight: 850; letter-spacing: 0; }
.profit-head p { margin: 4px 0 0; color: var(--text-secondary); font-size: .75rem; }
.profit-head__actions { display: flex; align-items: center; gap: 8px; }
.profit-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.profit-kpis article { display: flex; align-items: center; gap: 11px; min-width: 0; padding: 13px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.profit-kpis__icon { display: grid; width: 36px; height: 36px; place-items: center; flex: none; border-radius: 6px; color: #167d56; background: #e8f5ef; }
.profit-kpis__icon :deep(svg) { width: 17px; height: 17px; }
.profit-kpis article > div { display: grid; gap: 2px; min-width: 0; }
.profit-kpis small { color: var(--text-secondary); font-size: .68rem; font-weight: 700; }
.profit-kpis strong { overflow: hidden; color: var(--text-primary); font-size: 1.08rem; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.profit-kpis article.is-loss strong, .profit-kpis article.is-loss .profit-kpis__icon { color: var(--danger); }
.profit-table-shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
.profit-table-shell > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.profit-dimensions { display: flex; gap: 4px; }
.profit-dimensions button { min-height: 30px; padding: 0 11px; border: 0; border-radius: 5px; color: var(--text-secondary); background: transparent; font: inherit; font-size: .72rem; font-weight: 720; cursor: pointer; }
.profit-dimensions button.is-active { color: var(--primary); background: var(--primary-soft); }
.profit-loss-count { color: var(--danger); font-size: .7rem; font-weight: 750; }
.profit-name { display: grid; gap: 2px; min-width: 0; }
.profit-name strong { overflow: hidden; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.profit-name small { overflow: hidden; color: var(--text-secondary); font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
.profit-value { color: var(--success); font-weight: 750; font-variant-numeric: tabular-nums; }
.profit-value.is-loss { color: var(--danger); }
.profit-footnote { padding: 7px 12px; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: .65rem; }
@media (max-width: 1080px) { .profit-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
