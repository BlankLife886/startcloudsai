<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import {
	AlarmClock,
  CircleCheck,
	Clock,
	Connection,
	DataAnalysis,
  Histogram,
	Loading,
	Refresh,
  TrendCharts,
  User,
  UserFilled,
  Wallet,
	WarningFilled,
} from '@element-plus/icons-vue'
import { request } from '@/request'
import { formatPoints, formatTime, taskTypeLabel } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase, CHART_COLORS } from '@/chartTheme'

interface DailyTaskStat {
  date: string
  total: number
  succeeded: number
	failed: number
}

interface TaskPerformance {
	queuedNow: number
	runningNow: number
	created: number
	succeeded: number
	failed: number
	avgQueueMs: number
	p95QueueMs: number
	avgRunMs: number
	p95RunMs: number
	avgEndToEndMs: number
	p95EndToEndMs: number
}

interface ProviderPerformance {
	provider: string
	total: number
	succeeded: number
	failed: number
	avgDurationMs: number
	p95DurationMs: number
}

interface AdminStats {
  totalUsers?: number
  newUsersToday?: number
  taskDaily?: DailyTaskStat[]
  revenueCents?: number
  walletBalanceCents?: number
  runningTasks?: number
  typeDistribution?: Record<string, number>
	taskPerformance?: TaskPerformance
	providerPerformance?: ProviderPerformance[]
}

const loading = ref(false)
const stats = ref<AdminStats | null>(null)
const loadedAt = ref('')
let refreshTimer: number | null = null

const taskDaily = computed(() => stats.value?.taskDaily ?? [])

const performance = computed<TaskPerformance>(() => stats.value?.taskPerformance ?? {
	queuedNow: 0,
	runningNow: 0,
	created: 0,
	succeeded: 0,
	failed: 0,
	avgQueueMs: 0,
	p95QueueMs: 0,
	avgRunMs: 0,
	p95RunMs: 0,
	avgEndToEndMs: 0,
	p95EndToEndMs: 0,
})

function percent(value: number, total: number) {
	return total > 0 ? Math.round((value / total) * 100) : 0
}

function formatDuration(milliseconds: number) {
	const value = Math.max(0, Number(milliseconds) || 0)
	if (value < 1000) return `${Math.round(value)} ms`
	if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`
	const minutes = Math.floor(value / 60_000)
	const seconds = Math.round((value % 60_000) / 1000)
	return `${minutes} 分 ${seconds} 秒`
}

const successRate24h = computed(() => percent(performance.value.succeeded, performance.value.created))

const queueState = computed(() => {
	if (performance.value.queuedNow === 0) return { label: '队列畅通', tone: 'success' }
	if (performance.value.queuedNow <= Math.max(2, performance.value.runningNow)) {
		return { label: '轻度排队', tone: 'warning' }
	}
	return { label: '需要关注', tone: 'danger' }
})

interface KpiCard {
  label: string
  value: string | number
  caption: string
  icon: Component
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
}

const cards = computed<KpiCard[]>(() => {
	const p = performance.value
  return [
    {
	  label: '当前排队',
	  value: p.queuedNow,
	  caption: queueState.value.label,
	  icon: AlarmClock,
	  tone: queueState.value.tone as KpiCard['tone'],
    },
    {
	  label: '正在执行',
	  value: p.runningNow,
	  caption: '实时 Worker 任务',
	  icon: Loading,
	  tone: 'info',
    },
    {
	  label: '近 24 小时任务',
	  value: p.created,
	  caption: `成功 ${p.succeeded} · 失败 ${p.failed}`,
	  icon: DataAnalysis,
	  tone: 'accent',
    },
    {
	  label: '近 24 小时成功率',
	  value: `${successRate24h.value}%`,
	  caption: `${p.succeeded} / ${p.created || 0}`,
	  icon: CircleCheck,
	  tone: successRate24h.value >= 90 ? 'success' : successRate24h.value >= 70 ? 'warning' : 'danger',
    },
    {
	  label: '平均排队',
	  value: formatDuration(p.avgQueueMs),
	  caption: `P95 ${formatDuration(p.p95QueueMs)}`,
	  icon: Clock,
	  tone: p.p95QueueMs > 10_000 ? 'warning' : 'success',
    },
    {
	  label: '平均生成耗时',
	  value: formatDuration(p.avgRunMs),
	  caption: `P95 ${formatDuration(p.p95RunMs)}`,
	  icon: TrendCharts,
	  tone: 'info',
    },
    {
	  label: 'P95 端到端耗时',
	  value: formatDuration(p.p95EndToEndMs),
	  caption: `平均 ${formatDuration(p.avgEndToEndMs)}`,
	  icon: Connection,
	  tone: 'violet',
	},
	{
	  label: '近 24 小时失败',
	  value: p.failed,
	  caption: p.created ? `失败率 ${percent(p.failed, p.created)}%` : '暂无任务',
	  icon: WarningFilled,
	  tone: p.failed > 0 ? 'danger' : 'success',
    },
  ]
})

/** 近7日任务量与结果趋势 */
const taskLineOption = computed<EChartOption>(() => {
  const base = chartBase()
  return {
    color: base.color,
    tooltip: { trigger: 'axis', ...base.tooltip },
	legend: { data: ['任务量', '成功', '失败'], top: 0, textStyle: base.legendText },
    grid: { left: 40, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: taskDaily.value.map((d) => d.date), axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: { type: 'value', minInterval: 1, axisLabel: base.axisLabel, splitLine: base.splitLine },
    series: [
      {
        name: '任务量',
        type: 'line',
        smooth: true,
        data: taskDaily.value.map((d) => d.total),
        areaStyle: base.areaStyle,
      },
      {
		name: '成功',
        type: 'line',
        smooth: true,
        data: taskDaily.value.map((d) => d.succeeded),
        itemStyle: { color: CHART_COLORS[2] },
        lineStyle: { color: CHART_COLORS[2] },
      },
	  {
		name: '失败',
		type: 'line',
		smooth: true,
		data: taskDaily.value.map((d) => d.failed),
		itemStyle: { color: '#ef6b73' },
		lineStyle: { color: '#ef6b73' },
	  },
    ],
  }
})

/** 有真实数据（计数 > 0）的任务类型 */
const typeEntries = computed(() =>
  Object.entries(stats.value?.typeDistribution ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ name: taskTypeLabel(type), value: count })),
)

const typeTotal = computed(() => typeEntries.value.reduce((sum, d) => sum + d.value, 0))

/** 近30日任务类型分布环形图：无引导线标签，右侧图例带数值，环心汇总 */
const typePieOption = computed<EChartOption>(() => {
  const base = chartBase()
  const counts = new Map(typeEntries.value.map((d) => [d.name, d.value]))
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
  return {
    color: base.color,
    tooltip: { trigger: 'item', ...base.tooltip },
    legend: {
      orient: 'vertical',
      right: 8,
      top: 'middle',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      textStyle: { ...base.legendText, fontSize: 12 },
      formatter: (name: string) => `${name}   ${counts.get(name) ?? 0}`,
    },
    title: {
      text: String(typeTotal.value),
      subtext: '总任务数',
      left: '31%',
      top: '40%',
      textAlign: 'center',
      textStyle: { fontSize: 24, fontWeight: 700, color: ink },
      subtextStyle: { fontSize: 12, color: base.legendText.color },
    },
    series: [
      {
        name: '任务类型',
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['32%', '50%'],
        itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scaleSize: 4 },
        data: typeEntries.value,
      },
    ],
  }
})

const hasTypeDistribution = computed(() => typeTotal.value > 0)

const providers = computed(() => stats.value?.providerPerformance ?? [])

function providerSuccessRate(row: Partial<ProviderPerformance>) {
	return percent(Number(row.succeeded) || 0, Number(row.total) || 0)
}

function providerRateTone(row: Partial<ProviderPerformance>) {
	const rate = providerSuccessRate(row)
	if (rate >= 90) return 'success'
	if (rate >= 70) return 'warning'
	return 'danger'
}

const businessMetrics = computed(() => [
	{ label: '总用户', value: stats.value?.totalUsers ?? '-', icon: User },
	{ label: '今日新增', value: stats.value?.newUsersToday ?? '-', icon: UserFilled },
	{
	  label: '近 30 日消耗积分',
	  value: stats.value?.revenueCents !== undefined ? formatPoints(stats.value.revenueCents) : '-',
	  icon: Histogram,
	},
	{
	  label: '用户积分结余',
	  value: stats.value?.walletBalanceCents !== undefined ? formatPoints(stats.value.walletBalanceCents) : '-',
	  icon: Wallet,
	},
])

async function load() {
	if (loading.value) return
  loading.value = true
  try {
    stats.value = await request<AdminStats>('/api/admin/stats')
    loadedAt.value = formatTime(new Date().toISOString())
  } finally {
    loading.value = false
  }
}

onMounted(() => {
	void load()
	refreshTimer = window.setInterval(() => {
	  if (document.visibilityState === 'visible') void load()
	}, 20_000)
})

onBeforeUnmount(() => {
	if (refreshTimer !== null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-header">
	  <div class="dashboard-title">
		<span class="title">任务运营仪表盘</span>
		<span class="dashboard-live"><i />20 秒自动刷新</span>
	  </div>
	  <span v-if="loadedAt" class="text-muted">更新于 {{ loadedAt }}</span>
	  <el-button :icon="Refresh" size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="kpi-grid">
      <StatCard
        v-for="card in cards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :caption="card.caption"
        :icon="card.icon"
        :tone="card.tone"
      />
    </div>

	<section class="business-strip" aria-label="业务概览">
	  <div v-for="item in businessMetrics" :key="item.label" class="business-metric">
		<el-icon><component :is="item.icon" /></el-icon>
		<span>{{ item.label }}</span>
		<strong>{{ item.value }}</strong>
	  </div>
	</section>

    <div class="charts">
	  <PageCard title="近 7 日任务趋势" subtitle="每日任务量、成功与失败">
        <EChart v-if="taskDaily.length" :option="taskLineOption" />
        <div v-else class="card-empty" style="min-height: 280px">
          <el-empty description="暂无任务数据" :image-size="60">
            <div class="empty-sub">近 7 日还没有任务记录</div>
          </el-empty>
        </div>
      </PageCard>

	  <PageCard title="任务类型分布" subtitle="近 30 日调用结构">
        <EChart v-if="hasTypeDistribution" :option="typePieOption" />
        <div v-else class="card-empty" style="min-height: 280px">
          <el-empty description="暂无任务数据" :image-size="60">
            <div class="empty-sub">近 30 日还没有任务，暂无法统计分布</div>
          </el-empty>
        </div>
      </PageCard>
    </div>

	<PageCard title="服务商表现" subtitle="近 24 小时实际任务耗时">
	  <el-table v-if="providers.length" :data="providers" class="provider-table" height="320">
		<el-table-column label="服务商" min-width="180">
		  <template #default="{ row }">
			<div class="provider-name">
			  <i />
			  <strong>{{ row.provider }}</strong>
			</div>
		  </template>
		</el-table-column>
		<el-table-column prop="total" label="任务数" width="100" align="right" />
		<el-table-column label="成功率" width="130" align="right">
		  <template #default="{ row }">
			<el-tag :type="providerRateTone(row)" effect="plain" size="small">
			  {{ providerSuccessRate(row) }}%
			</el-tag>
		  </template>
		</el-table-column>
		<el-table-column prop="succeeded" label="成功" width="90" align="right" />
		<el-table-column prop="failed" label="失败" width="90" align="right" />
		<el-table-column label="平均耗时" width="140" align="right">
		  <template #default="{ row }"><strong class="duration-value">{{ formatDuration(row.avgDurationMs) }}</strong></template>
		</el-table-column>
		<el-table-column label="P95 耗时" width="140" align="right">
		  <template #default="{ row }"><strong class="duration-value">{{ formatDuration(row.p95DurationMs) }}</strong></template>
		</el-table-column>
	  </el-table>
	  <div v-else class="card-empty provider-empty">
		<el-empty description="近 24 小时暂无服务商任务" :image-size="56" />
	  </div>
	</PageCard>
  </div>
</template>

<style scoped>
.dashboard-title {
	display: flex;
	align-items: center;
	gap: 12px;
}

.dashboard-live {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--ink-3);
	font-size: 11px;
}

.dashboard-live i {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--success);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 13%, transparent);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
	margin-bottom: 14px;
}

.business-strip {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	margin-bottom: 16px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--surface-2);
}

.business-metric {
	display: grid;
	min-width: 0;
	grid-template-columns: 24px minmax(0, 1fr) auto;
	align-items: center;
	gap: 8px;
	padding: 12px 14px;
	border-right: 1px solid var(--border);
}

.business-metric:last-child {
	border-right: 0;
}

.business-metric .el-icon {
	color: var(--accent);
	font-size: 15px;
}

.business-metric span {
	overflow: hidden;
	color: var(--ink-3);
	font-size: 11px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.business-metric strong {
	color: var(--ink-1);
	font-size: 13px;
	font-variant-numeric: tabular-nums;
}

.charts {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
	margin-bottom: 16px;
}

.provider-table {
	width: 100%;
}

.provider-table :deep(.el-table__header th) {
	height: 40px;
	background: var(--surface-2);
}

.provider-table :deep(.el-table__row td) {
	height: 46px;
}

.provider-name {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 9px;
}

.provider-name i {
	width: 7px;
	height: 7px;
	flex: 0 0 auto;
	border-radius: 50%;
	background: var(--success);
}

.provider-name strong {
	overflow: hidden;
	color: var(--ink-1);
	font-size: 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.duration-value {
	color: var(--ink-2);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
}

.provider-empty {
	min-height: 260px;
}

@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
	.business-strip {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.business-metric:nth-child(2) {
		border-right: 0;
	}
	.business-metric:nth-child(-n + 2) {
		border-bottom: 1px solid var(--border);
	}
}

@media (max-width: 1100px) {
  .charts {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
	.dashboard-live {
		display: none;
	}
	.business-strip {
		grid-template-columns: 1fr;
	}
	.business-metric,
	.business-metric:nth-child(2) {
		border-right: 0;
		border-bottom: 1px solid var(--border);
	}
	.business-metric:last-child {
		border-bottom: 0;
	}
}
</style>
