<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import {
	AlarmClock,
  CircleCheck,
	DataAnalysis,
  Histogram,
	Loading,
	Reading,
	Refresh,
  User,
  UserFilled,
  Wallet,
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

interface RuntimeMemoryMetrics {
	usedBytes: number
	limitBytes: number
	heapAllocBytes: number
	heapInUseBytes: number
	heapObjects: number
	stackInUseBytes: number
	nextGCBytes: number
	gcCycles: number
	gcPauseTotalMs: number
	gcCPUFraction: number
}

interface SystemMetrics {
	sampledAt: string
	process: {
		goVersion: string
		uptimeSeconds: number
		cpuUsagePercent: number
		logicalCPUs: number
		goMaxProcs: number
		goroutines: number
		memory: RuntimeMemoryMetrics
	}
	http: {
		inFlight: number
		total: number
		windowSeconds: number
		requests: number
		requestsPerSecond: number
		status2xx: number
		status4xx: number
		status5xx: number
		averageLatencyMs: number
		p95LatencyMs: number
		maximumLatencyMs: number
	}
	database: {
		maxConnections: number
		totalConnections: number
		acquiredConnections: number
		idleConnections: number
		constructingConnections: number
		utilizationPercent: number
		acquireCount: number
		emptyAcquireCount: number
		canceledAcquireCount: number
		acquireDurationMs: number
	}
	queue: {
		available: boolean
		paused: boolean
		latencyMs: number
		memoryBytes: number
		size: number
		pending: number
		active: number
		scheduled: number
		retry: number
		archived: number
		processedToday: number
		failedToday: number
		onlineWorkers: number
		workerConcurrency: number
		activeWorkers: number
		error?: string
		workers: Array<{
			id: string
			host: string
			pid: number
			concurrency: number
			active: number
			status: string
			startedAt: string
			queues: Record<string, number>
		}>
	}
	taskPressure: {
		queued: number
		running: number
		active: number
		globalLimit: number
		userConcurrencyLimit: number
		globalConcurrencyLimit: number
		workerConcurrencyCeiling: number
		effectiveGlobalConcurrency: number
		utilizationPercent: number
		oldestQueuedSeconds: number
		error?: string
	}
	providers: Array<{
		id: string
		name: string
		adapter: string
		running: number
		limit: number
		utilizationPercent: number
	}>
	profiling: { enabled: boolean }
}

interface SystemMetricPoint {
	time: string
	cpu: number
	memory: number
	rps: number
	p95: number
}

const loading = ref(false)
const systemLoading = ref(false)
const helpOpen = ref(false)
const stats = ref<AdminStats | null>(null)
const systemMetrics = ref<SystemMetrics | null>(null)
const systemHistory = ref<SystemMetricPoint[]>([])
const systemError = ref('')
const loadedAt = ref('')
let refreshTimer: number | null = null
let systemRefreshTimer: number | null = null

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

function formatBytes(bytes: number) {
	const value = Math.max(0, Number(bytes) || 0)
	if (value < 1024) return `${Math.round(value)} B`
	if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
	if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
	return `${(value / 1024 ** 3).toFixed(2)} GiB`
}

function formatUptime(seconds: number) {
	const value = Math.max(0, Math.floor(Number(seconds) || 0))
	const days = Math.floor(value / 86_400)
	const hours = Math.floor((value % 86_400) / 3600)
	const minutes = Math.floor((value % 3600) / 60)
	if (days > 0) return `${days} 天 ${hours} 小时`
	if (hours > 0) return `${hours} 小时 ${minutes} 分`
	return `${minutes} 分钟`
}

/** 系统健康仪表：只放与「运行时资源」不重复的容量类指标 */
const systemGaugeOption = computed((): EChartOption => {
	const base = chartBase()
	const metrics = systemMetrics.value
	if (!metrics) return {}
	const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
	const ink3 = getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim()
	const queue = metrics.queue
	const queuePressure =
		queue.available && queue.workerConcurrency > 0
			? Math.min(100, (queue.pending / queue.workerConcurrency) * 100)
			: 0
	const gauges = [
		{
			name: '数据库',
			value: Number(metrics.database.utilizationPercent.toFixed(1)),
			center: ['17%', '52%'],
		},
		{
			name: '任务容量',
			value: Number(metrics.taskPressure.utilizationPercent.toFixed(1)),
			center: ['50%', '52%'],
		},
		{
			name: '队列压力',
			value: Number(queuePressure.toFixed(1)),
			center: ['83%', '52%'],
		},
	]
	return {
		tooltip: {
			...base.tooltip,
			formatter: '{b} {c}%',
		},
		series: gauges.map((item) => ({
			type: 'gauge' as const,
			center: item.center,
			radius: '78%',
			startAngle: 210,
			endAngle: -30,
			min: 0,
			max: 100,
			splitNumber: 4,
			progress: { show: true, width: 8, roundCap: true },
			pointer: { show: false },
			axisLine: { lineStyle: { width: 8, color: [[1, 'rgb(128 128 128 / 0.16)']] } },
			axisTick: { show: false },
			splitLine: { show: false },
			axisLabel: { show: false },
			anchor: { show: false },
			title: { offsetCenter: [0, '68%'], color: ink3, fontSize: 10 },
			detail: {
				valueAnimation: true,
				offsetCenter: [0, '18%'],
				formatter: '{value}%',
				color: ink,
				fontSize: 13,
				fontWeight: 700,
			},
			data: [{ value: item.value, name: item.name }],
			itemStyle: {
				color:
					item.value >= 90 ? CHART_COLORS[1] : item.value >= 70 ? CHART_COLORS[3] : CHART_COLORS[0],
			},
		})),
	}
})

const systemChips = computed(() => {
	const metrics = systemMetrics.value
	if (!metrics) return []
	const queue = metrics.queue
	const pressure = metrics.taskPressure
	return [
		{ label: '吞吐', value: `${metrics.http.requestsPerSecond.toFixed(2)}/s` },
		{ label: 'API P95', value: formatDuration(metrics.http.p95LatencyMs) },
		{ label: 'CPU', value: `${metrics.process.cpuUsagePercent.toFixed(1)}%` },
		{ label: '内存', value: formatBytes(metrics.process.memory.usedBytes) },
		{ label: 'Goroutine', value: String(metrics.process.goroutines) },
		{
			label: 'DB',
			value: `${metrics.database.acquiredConnections}/${metrics.database.maxConnections}`,
		},
		{ label: '队列', value: queue.available ? String(queue.pending) : '-' },
		{ label: '容量', value: `${pressure.active}/${pressure.globalLimit}` },
		{ label: 'Worker', value: `${queue.onlineWorkers} 在线` },
		{ label: '运行', value: formatUptime(metrics.process.uptimeSeconds) },
		{
			label: 'GC',
			value: `${metrics.process.memory.gcCycles} · ${metrics.process.memory.gcCPUFraction.toFixed(2)}%`,
		},
	]
})

const runtimeChartOption = computed<EChartOption>(() => {
	const base = chartBase()
	return {
		color: [CHART_COLORS[0], CHART_COLORS[3]],
		tooltip: { trigger: 'axis', ...base.tooltip },
		legend: { data: ['CPU', '内存'], top: 0, textStyle: base.legendText },
		grid: { left: 34, right: 10, top: 26, bottom: 16 },
		xAxis: { type: 'category', data: systemHistory.value.map((point) => point.time), axisLabel: base.axisLabel, axisLine: base.axisLine },
		yAxis: [
			{ type: 'value', min: 0, max: 100, axisLabel: { ...base.axisLabel, formatter: '{value}%' }, splitLine: base.splitLine },
			{ type: 'value', min: 0, axisLabel: { ...base.axisLabel, formatter: '{value} MiB' }, splitLine: { show: false } },
		],
		series: [
			{ name: 'CPU', type: 'line', showSymbol: false, data: systemHistory.value.map((point) => point.cpu) },
			{ name: '内存', type: 'line', yAxisIndex: 1, showSymbol: false, data: systemHistory.value.map((point) => point.memory) },
		],
	}
})

const trafficChartOption = computed<EChartOption>(() => {
	const base = chartBase()
	return {
		color: [CHART_COLORS[2], CHART_COLORS[4]],
		tooltip: { trigger: 'axis', ...base.tooltip },
		legend: { data: ['请求/秒', 'P95 延迟'], top: 0, textStyle: base.legendText },
		grid: { left: 34, right: 36, top: 26, bottom: 16 },
		xAxis: { type: 'category', data: systemHistory.value.map((point) => point.time), axisLabel: base.axisLabel, axisLine: base.axisLine },
		yAxis: [
			{ type: 'value', min: 0, axisLabel: base.axisLabel, splitLine: base.splitLine },
			{ type: 'value', min: 0, axisLabel: { ...base.axisLabel, formatter: '{value} ms' }, splitLine: { show: false } },
		],
		series: [
			{ name: '请求/秒', type: 'line', showSymbol: false, data: systemHistory.value.map((point) => point.rps) },
			{ name: 'P95 延迟', type: 'line', yAxisIndex: 1, showSymbol: false, data: systemHistory.value.map((point) => point.p95) },
		],
	}
})

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

/** 顶部仅保留 4 个核心实时 KPI，其余耗时指标改图表 */
const heroCards = computed<KpiCard[]>(() => {
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
	  caption: p.created ? `失败 ${p.failed} · ${percent(p.failed, p.created)}%` : '暂无任务',
	  icon: CircleCheck,
	  tone: successRate24h.value >= 90 ? 'success' : successRate24h.value >= 70 ? 'warning' : 'danger',
    },
  ]
})

/** 任务耗时：平均 vs P95 横向对比 */
const latencyBarOption = computed((): EChartOption => {
	const base = chartBase()
	const p = performance.value
	const categories = ['排队', '生成', '端到端']
	const avg = [p.avgQueueMs, p.avgRunMs, p.avgEndToEndMs].map((v) => Number((v / 1000).toFixed(1)))
	const p95 = [p.p95QueueMs, p.p95RunMs, p.p95EndToEndMs].map((v) => Number((v / 1000).toFixed(1)))
	return {
		color: [CHART_COLORS[0], CHART_COLORS[1]],
		tooltip: {
			trigger: 'axis',
			...base.tooltip,
			axisPointer: { type: 'shadow' },
		},
		legend: { data: ['平均', 'P95'], top: 0, right: 0, textStyle: { ...base.legendText, fontSize: 10 } },
		grid: { left: 48, right: 12, top: 26, bottom: 8 },
		xAxis: {
			type: 'value',
			axisLabel: { ...base.axisLabel, fontSize: 10, formatter: '{value}s' },
			splitLine: base.splitLine,
		},
		yAxis: {
			type: 'category',
			data: categories,
			axisLabel: { ...base.axisLabel, fontSize: 10 },
			axisLine: base.axisLine,
		},
		series: [
			{ name: '平均', type: 'bar', barMaxWidth: 12, data: avg, itemStyle: { borderRadius: [0, 6, 6, 0] } },
			{ name: 'P95', type: 'bar', barMaxWidth: 12, data: p95, itemStyle: { borderRadius: [0, 6, 6, 0] } },
		],
	}
})

/** 近7日任务量与结果趋势 */
const taskLineOption = computed<EChartOption>(() => {
  const base = chartBase()
  return {
    color: base.color,
    tooltip: { trigger: 'axis', ...base.tooltip },
	legend: { data: ['任务量', '成功', '失败'], top: 0, textStyle: base.legendText },
    grid: { left: 34, right: 10, top: 26, bottom: 16 },
    xAxis: { type: 'category', data: taskDaily.value.map((d) => d.date), axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: { type: 'value', minInterval: 1, axisLabel: base.axisLabel, splitLine: base.splitLine },
    series: [
      {
        name: '任务量',
        type: 'line',
        smooth: 0.35,
        showSymbol: false,
        data: taskDaily.value.map((d) => d.total),
        areaStyle: base.areaStyle,
        lineStyle: { ...base.lineStyle, color: base.color[0] },
        itemStyle: { color: base.color[0] },
      },
      {
        name: '成功',
        type: 'line',
        smooth: 0.35,
        showSymbol: false,
        data: taskDaily.value.map((d) => d.succeeded),
        itemStyle: { color: CHART_COLORS[0] },
        lineStyle: { width: 2, color: CHART_COLORS[0] },
      },
      {
        name: '失败',
        type: 'line',
        smooth: 0.35,
        showSymbol: false,
        data: taskDaily.value.map((d) => d.failed),
        itemStyle: { color: CHART_COLORS[1] },
        lineStyle: { width: 2, color: CHART_COLORS[1] },
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
      textStyle: { ...base.legendText, fontSize: 10 },
      formatter: (name: string) => `${name}   ${counts.get(name) ?? 0}`,
    },
    title: {
      text: String(typeTotal.value),
      subtext: '总任务数',
      left: '28%',
      top: '38%',
      textAlign: 'center',
      textStyle: { fontSize: 17, fontWeight: 700, color: ink },
      subtextStyle: { fontSize: 10, color: base.legendText.color },
    },
    series: [
      {
        name: '任务类型',
        type: 'pie',
        radius: ['46%', '68%'],
        center: ['28%', '50%'],
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

/** 服务商近 24h：任务量 + 成功率 */
const providerPerfOption = computed((): EChartOption => {
	const base = chartBase()
	const rows = providers.value
	return {
		color: [CHART_COLORS[0], CHART_COLORS[2]],
		tooltip: { trigger: 'axis', ...base.tooltip, axisPointer: { type: 'shadow' } },
		legend: {
			data: ['任务数', '成功率'],
			top: 0,
			right: 0,
			textStyle: { ...base.legendText, fontSize: 10 },
		},
		grid: { left: 36, right: 36, top: 26, bottom: 28 },
		xAxis: {
			type: 'category',
			data: rows.map((row) => row.provider),
			axisLabel: {
				...base.axisLabel,
				fontSize: 10,
				interval: 0,
				rotate: rows.length > 4 ? 20 : 0,
			},
			axisLine: base.axisLine,
		},
		yAxis: [
			{ type: 'value', minInterval: 1, axisLabel: { ...base.axisLabel, fontSize: 10 }, splitLine: base.splitLine },
			{
				type: 'value',
				min: 0,
				max: 100,
				axisLabel: { ...base.axisLabel, fontSize: 10, formatter: '{value}%' },
				splitLine: { show: false },
			},
		],
		series: [
			{
				name: '任务数',
				type: 'bar',
				barMaxWidth: 18,
				data: rows.map((row) => row.total),
				itemStyle: { borderRadius: [6, 6, 0, 0] },
			},
			{
				name: '成功率',
				type: 'line',
				yAxisIndex: 1,
				smooth: 0.3,
				showSymbol: true,
				symbolSize: 6,
				data: rows.map((row) => providerSuccessRate(row)),
			},
		],
	}
})

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
    stats.value = await request<AdminStats>('/api/v1/admin/statistics')
    loadedAt.value = formatTime(new Date().toISOString())
  } finally {
    loading.value = false
  }
}

async function loadSystemMetrics(silent = true) {
	if (systemLoading.value) return
	systemLoading.value = true
	try {
		const snapshot = await request<SystemMetrics>('/api/v1/admin/system/metrics', { silent })
		systemMetrics.value = snapshot
		systemError.value = ''
		const sampled = new Date(snapshot.sampledAt)
		const timeLabel = sampled.toLocaleTimeString('zh-CN', { hour12: false })
		const point: SystemMetricPoint = {
			time: timeLabel,
			cpu: snapshot.process.cpuUsagePercent,
			memory: Number((snapshot.process.memory.usedBytes / 1024 ** 2).toFixed(2)),
			rps: snapshot.http.requestsPerSecond,
			p95: snapshot.http.p95LatencyMs,
		}
		if (systemHistory.value.at(-1)?.time !== point.time) {
			systemHistory.value = [...systemHistory.value.slice(-59), point]
		}
	} catch {
		systemError.value = '系统指标暂时不可用'
	} finally {
		systemLoading.value = false
	}
}

async function refreshAll() {
	await Promise.all([load(), loadSystemMetrics(false)])
}

onMounted(() => {
	void refreshAll()
	refreshTimer = window.setInterval(() => {
	  if (document.visibilityState === 'visible') void load()
	}, 20_000)
	systemRefreshTimer = window.setInterval(() => {
		if (document.visibilityState === 'visible') void loadSystemMetrics()
	}, 5_000)
})

onBeforeUnmount(() => {
	if (refreshTimer !== null) window.clearInterval(refreshTimer)
	if (systemRefreshTimer !== null) window.clearInterval(systemRefreshTimer)
})
</script>

<template>
  <div v-loading="loading" class="page dashboard">
    <header class="status-rail" aria-label="实时状态">
      <div class="status-rail__pulse" aria-hidden="true">
        <span class="status-rail__pulse-ring" />
        <span class="status-rail__pulse-core" />
      </div>

      <div class="status-rail__primary">
        <span class="status-rail__kicker">LIVE</span>
        <span class="status-rail__title">系统监控</span>
        <span class="status-rail__cadence">5s</span>
      </div>

      <div class="status-rail__divider" aria-hidden="true" />

      <div
        class="status-rail__badge"
        :class="
          systemMetrics
            ? systemMetrics.queue.available
              ? 'is-online'
              : 'is-offline'
            : 'is-pending'
        "
      >
        <i />
        <span>
          {{
            !systemMetrics
              ? '同步中'
              : systemMetrics.queue.available
                ? '服务在线'
                : '队列异常'
          }}
        </span>
      </div>

      <div v-if="systemMetrics" class="status-rail__meta">
        <span class="status-rail__meta-item">
          <em>Runtime</em>
          <strong>{{ systemMetrics.process.goVersion }}</strong>
        </span>
        <span class="status-rail__meta-item">
          <em>Workers</em>
          <strong class="tnum">{{ systemMetrics.queue.onlineWorkers }}</strong>
        </span>
        <span class="status-rail__meta-item">
          <em>Queue</em>
          <strong class="tnum">{{ systemMetrics.queue.pending }}</strong>
        </span>
      </div>

      <p v-if="systemError" class="status-rail__alert">{{ systemError }}</p>

      <div class="status-rail__spacer" />

      <time v-if="loadedAt" class="status-rail__clock" :datetime="loadedAt">
        <em>更新于</em>
        <strong class="tnum">{{ loadedAt }}</strong>
      </time>

      <button
        type="button"
        class="status-rail__refresh"
        :disabled="loading || systemLoading"
        :aria-busy="loading || systemLoading"
        @click="refreshAll"
      >
        <el-icon :class="{ 'is-spinning': loading || systemLoading }"><Refresh /></el-icon>
        <span>刷新</span>
      </button>

      <button
        type="button"
        class="status-rail__help"
        aria-label="打开仪表盘说明"
        @click="helpOpen = true"
      >
        <el-icon><Reading /></el-icon>
        <span>说明</span>
      </button>
    </header>

    <el-drawer
      v-model="helpOpen"
      title="仪表盘说明"
      size="min(480px, 96vw)"
      append-to-body
      class="dashboard-help-drawer"
    >
      <div class="help-doc">
        <section class="help-section">
          <h3>这个页面做什么</h3>
          <p>
            仪表盘是运维总览：一眼看到任务是否顺畅、业务量大概多少、API / Worker /
            数据库有没有压力。适合值班巡检和排障时先判断「问题在哪一层」。
          </p>
          <ul>
            <li>业务统计约每 20 秒自动刷新；系统指标约每 5 秒刷新。</li>
            <li>点「刷新」会立刻同时拉业务与系统两套数据。</li>
            <li>页面切到后台时会暂停轮询，回到前台再继续。</li>
          </ul>
        </section>

        <section class="help-section">
          <h3>顶部状态条</h3>
          <dl>
            <div>
              <dt>LIVE / 5s</dt>
              <dd>系统指标处于实时监控，默认 5 秒采样一次。</dd>
            </div>
            <div>
              <dt>服务在线 / 队列异常</dt>
              <dd>看 Asynq / Redis 队列是否可用。异常时任务可能卡住，应先查 Redis 与 Worker。</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>API 进程的 Go 版本，便于确认部署是否一致。</dd>
            </div>
            <div>
              <dt>Workers / Queue</dt>
              <dd>在线 Worker 进程数，以及队列里等待处理的任务数（pending）。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>核心任务指标</h3>
          <dl>
            <div>
              <dt>当前排队</dt>
              <dd>此刻仍在队列、尚未开始执行的任务数。持续升高说明吞吐不够或上游拥堵。</dd>
            </div>
            <div>
              <dt>正在执行</dt>
              <dd>Worker 正在处理的任务数（实时）。</dd>
            </div>
            <div>
              <dt>近 24 小时任务</dt>
              <dd>过去 24 小时创建的任务总量，并附带成功 / 失败拆分。</dd>
            </div>
            <div>
              <dt>近 24 小时成功率</dt>
              <dd>成功数 ÷ 创建数。偏低时结合失败数、服务商表现和上游容量排查。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>业务概览</h3>
          <dl>
            <div>
              <dt>总用户 / 今日新增</dt>
              <dd>注册用户规模与今日净增，观察增长是否异常。</dd>
            </div>
            <div>
              <dt>近 30 日消耗积分</dt>
              <dd>近 30 天用户消耗的积分总量，反映平台使用强度。</dd>
            </div>
            <div>
              <dt>用户积分结余</dt>
              <dd>当前所有用户钱包里尚未消耗的积分合计。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>图表怎么读</h3>
          <dl>
            <div>
              <dt>近 7 日任务趋势</dt>
              <dd>每日任务量、成功、失败折线。看周末波动、突增突降和失败抬头。</dd>
            </div>
            <div>
              <dt>任务类型分布</dt>
              <dd>近 30 日各任务类型占比（如文生图、高清等），环心为总任务数。</dd>
            </div>
            <div>
              <dt>任务耗时</dt>
              <dd>
                排队、生成、端到端的平均与 P95（秒）。P95 明显高于平均，说明少数任务特别慢。
              </dd>
            </div>
            <div>
              <dt>运行时资源</dt>
              <dd>最近几分钟 API 进程 CPU（%）与 Go 内存（MiB）走势。</dd>
            </div>
            <div>
              <dt>API 实时流量</dt>
              <dd>近 60 秒请求速率（req/s）与 P95 延迟（ms）。延迟尖刺常伴随上游或 DB 压力。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>系统健康</h3>
          <p>
            CPU / 内存走势只在「运行时资源」看，这里不重复。本卡三个仪表是容量类利用率（0–100%）：
          </p>
          <dl>
            <div>
              <dt>数据库</dt>
              <dd>连接池已占用 / 最大连接。偏高时检查慢查询或连接泄漏。</dd>
            </div>
            <div>
              <dt>任务容量</dt>
              <dd>当前活跃任务相对全站并发上限的利用率。</dd>
            </div>
            <div>
              <dt>队列压力</dt>
              <dd>pending ÷ Worker 总并发槽。持续偏高说明消化不过来，可加 Worker 或查上游。</dd>
            </div>
          </dl>
          <p>底部芯片是摘要：吞吐、API P95、当前 CPU/内存绝对值、Goroutine、Worker、GC 等。</p>
        </section>

        <section class="help-section">
          <h3>Worker 实例</h3>
          <p>
            每一行是一个正在向 Redis 汇报心跳的 Worker
            <strong>进程</strong>，不是任务数。本地默认通常只有 1 个；生产可用
            <code>docker compose up -d --scale worker=N</code> 多开。
          </p>
          <dl>
            <div>
              <dt>主机 / PID</dt>
              <dd>进程所在机器与进程号，方便对照日志。</dd>
            </div>
            <div>
              <dt>活跃 / 并发</dt>
              <dd>当前占用的短操作槽 / 该进程配置的槽位上限（如 WORKER_CONCURRENCY=32）。</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>Asynq 汇报的进程状态，一般为 active。</dd>
            </div>
            <div>
              <dt>今日 · 失败</dt>
              <dd>整条队列今天处理成功量与失败量（不是单个 Worker 独有）。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>服务商容量</h3>
          <p>各上游线路此刻的在途任务与配置容量。</p>
          <dl>
            <div>
              <dt>在途 / 容量</dt>
              <dd>正在占用该线路的任务数 / 该线路允许的最大并发。</dd>
            </div>
            <div>
              <dt>利用率</dt>
              <dd>在途 ÷ 容量。约 70% 预警，约 90% 应扩容、加路由或排查上游。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>服务商表现</h3>
          <p>近 24 小时各服务商实际完成情况：任务柱状图 + 成功率折线。</p>
          <ul>
            <li>任务数高但成功率低：优先查该服务商密钥、限额或上游故障。</li>
            <li>成功率正常但耗时长：看上游排队或模型本身耗时，不一定是平台故障。</li>
          </ul>
        </section>

        <section class="help-section">
          <h3>建议巡检顺序</h3>
          <ol>
            <li>状态条是否「服务在线」，Worker 是否 ≥ 1。</li>
            <li>排队是否持续升高，成功率是否明显下滑。</li>
            <li>系统健康三环与 API P95 是否异常。</li>
            <li>服务商容量是否打满，表现图是否某一家拖垮成功率。</li>
          </ol>
        </section>
      </div>
    </el-drawer>

    <div class="dashboard-board">
      <section class="board-top" aria-label="核心概览">
        <div class="board-strip board-strip--hero">
          <StatCard
            v-for="card in heroCards"
            :key="card.label"
            :label="card.label"
            :value="card.value"
            :caption="card.caption"
            :icon="card.icon"
            :tone="card.tone"
          />
        </div>
        <div class="board-strip board-strip--business" aria-label="业务概览">
          <div v-for="item in businessMetrics" :key="item.label" class="business-metric">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
            <strong class="tnum">{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <div class="board-main">
        <PageCard class="dash-panel panel--task-trend" title="近 7 日任务趋势">
          <div v-if="taskDaily.length" class="chart-fill">
            <EChart :option="taskLineOption" height="100%" />
          </div>
          <div v-else class="panel-empty">
            <el-empty description="暂无任务数据" :image-size="40" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--type-pie" title="任务类型分布">
          <div v-if="hasTypeDistribution" class="chart-fill">
            <EChart :option="typePieOption" height="100%" />
          </div>
          <div v-else class="panel-empty">
            <el-empty description="暂无类型数据" :image-size="40" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--latency" title="任务耗时" subtitle="平均 vs P95（秒）">
          <div class="chart-fill">
            <EChart :option="latencyBarOption" height="100%" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--runtime" title="运行时资源">
          <div class="chart-fill">
            <EChart :option="runtimeChartOption" height="100%" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--traffic" title="API 实时流量">
          <div class="chart-fill">
            <EChart :option="trafficChartOption" height="100%" />
          </div>
        </PageCard>

        <PageCard
          class="dash-panel panel--system"
          title="系统健康"
          :subtitle="
            systemMetrics
              ? `Heap ${formatBytes(systemMetrics.process.memory.heapInUseBytes)} · 上限 ${systemMetrics.taskPressure.effectiveGlobalConcurrency}`
              : '等待系统指标'
          "
        >
          <template v-if="systemMetrics">
            <div class="chart-fill chart-fill--gauges">
              <EChart :option="systemGaugeOption" height="100%" />
            </div>
            <div class="system-chips">
              <span v-for="chip in systemChips" :key="chip.label" class="system-chip">
                <em>{{ chip.label }}</em>
                <strong class="tnum">{{ chip.value }}</strong>
              </span>
            </div>
          </template>
          <div v-else class="panel-empty">
            <el-empty description="系统指标加载中" :image-size="36" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--workers" title="Worker 实例">
          <template v-if="systemMetrics" #actions>
            <span class="panel-aside-text">
              今日 {{ systemMetrics.queue.processedToday }} · 失败 {{ systemMetrics.queue.failedToday }}
            </span>
          </template>
          <div v-if="systemMetrics?.queue.workers.length" class="table-fill">
            <el-table :data="systemMetrics.queue.workers" class="worker-table" height="100%" size="small">
              <el-table-column prop="host" label="主机" min-width="90" show-overflow-tooltip />
              <el-table-column prop="pid" label="PID" width="56" align="right" />
              <el-table-column prop="active" label="活跃" width="48" align="right" />
              <el-table-column prop="concurrency" label="并发" width="48" align="right" />
              <el-table-column label="状态" width="68" align="right">
                <template #default="{ row }">
                  <el-tag type="success" effect="plain" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-else class="panel-empty">
            <el-empty :description="systemMetrics ? '没有在线 Worker' : '系统指标加载中'" :image-size="36" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--capacity" title="服务商容量">
          <div v-if="systemMetrics?.providers.length" class="table-fill">
            <el-table :data="systemMetrics.providers" class="worker-table" height="100%" size="small">
              <el-table-column prop="name" label="服务商" min-width="96" show-overflow-tooltip />
              <el-table-column prop="adapter" label="协议" width="64" />
              <el-table-column prop="running" label="在途" width="52" align="right" />
              <el-table-column prop="limit" label="容量" width="52" align="right" />
              <el-table-column label="利用率" width="96" align="right">
                <template #default="{ row }">
                  <div class="util-cell">
                    <div class="bar util-bar">
                      <div
                        class="bar-inner"
                        :style="{ width: `${Math.min(100, row.utilizationPercent)}%` }"
                      />
                    </div>
                    <span class="tnum">{{ row.utilizationPercent.toFixed(1) }}%</span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-else class="panel-empty">
            <el-empty :description="systemMetrics ? '没有启用的服务商' : '系统指标加载中'" :image-size="36" />
          </div>
        </PageCard>

        <PageCard class="dash-panel panel--providers" title="服务商表现" subtitle="近 24 小时任务量与成功率">
          <div v-if="providers.length" class="chart-fill">
            <EChart :option="providerPerfOption" height="100%" />
          </div>
          <div v-else class="panel-empty">
            <el-empty description="近 24 小时暂无服务商任务" :image-size="36" />
          </div>
        </PageCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  --dash-gap: 6px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--dash-gap);
  padding: 2px 4px 4px;
  overflow: hidden;
}

.status-rail {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  min-height: 40px;
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 2px);
  background:
    linear-gradient(
      105deg,
      color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%,
      var(--surface) 42%,
      var(--surface) 100%
    );
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.status-rail__pulse {
  position: relative;
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
}

.status-rail__pulse-core {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 55%, transparent);
}

.status-rail__pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
  animation: status-pulse 1.8s ease-out infinite;
}

.status-rail__primary {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.status-rail__kicker {
  color: var(--accent-ink);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  line-height: 1;
}

.status-rail__title {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.status-rail__cadence {
  display: inline-grid;
  place-items: center;
  min-width: 28px;
  height: 18px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-on);
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.status-rail__divider {
  width: 1px;
  height: 18px;
  flex: 0 0 auto;
  background: var(--border-strong, var(--border));
  opacity: 0.9;
}

.status-rail__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.status-rail__badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-rail__badge.is-online {
  color: var(--accent-ink);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
}

.status-rail__badge.is-offline {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger) 28%, transparent);
}

.status-rail__badge.is-pending {
  color: var(--ink-3);
  background: var(--surface-2);
  border-color: var(--border);
}

.status-rail__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.status-rail__meta-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.status-rail__meta-item em {
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-rail__meta-item strong {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.status-rail__alert {
  margin: 0;
  overflow: hidden;
  color: var(--warning);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-rail__spacer {
  flex: 1;
  min-width: 8px;
}

.status-rail__clock {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
}

.status-rail__clock em {
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
}

.status-rail__clock strong {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.status-rail__refresh,
.status-rail__help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 30px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
}

.status-rail__refresh {
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  color: var(--accent-ink);
}

.status-rail__help {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink-2);
}

.status-rail__refresh:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.status-rail__help:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--ink);
}

.status-rail__refresh:active:not(:disabled),
.status-rail__help:active {
  transform: scale(0.97);
}

.status-rail__refresh:disabled {
  cursor: wait;
  opacity: 0.72;
}

.status-rail__refresh .el-icon,
.status-rail__help .el-icon {
  font-size: 14px;
}

.help-doc {
  display: grid;
  gap: 20px;
  padding-bottom: 12px;
}

.help-section h3 {
  margin: 0 0 8px;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.help-section p,
.help-section li {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.65;
}

.help-section p + p,
.help-section p + ul,
.help-section p + ol,
.help-section p + dl,
.help-section ul + p {
  margin-top: 8px;
}

.help-section ul,
.help-section ol {
  margin: 0;
  padding-left: 1.2em;
}

.help-section li + li {
  margin-top: 4px;
}

.help-section dl {
  display: grid;
  gap: 10px;
  margin: 0;
}

.help-section dl > div {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.help-section dt {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.help-section dd {
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
}

.help-section code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--accent-ink);
  font-size: 11px;
}

.status-rail__refresh .is-spinning {
  animation: status-spin 0.8s linear infinite;
}

@keyframes status-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.9;
  }
  70% {
    transform: scale(1.7);
    opacity: 0;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-rail__pulse-ring,
  .status-rail__refresh .is-spinning {
    animation: none;
  }
}

@media (max-width: 1100px) {
  .status-rail__meta,
  .status-rail__divider {
    display: none;
  }
}



.dashboard-board {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--dash-gap);
}

.board-top {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: var(--dash-gap);
  min-width: 0;
}

.board-strip {
  display: grid;
  gap: var(--dash-gap);
  min-width: 0;
}

.board-strip--hero {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.board-strip--business {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
}

.dashboard :deep(.stat-card) {
  min-height: 0;
  padding: 8px 10px;
  gap: 4px;
  border-radius: calc(var(--radius-card) - 4px);
}

.dashboard :deep(.stat-card__icon) {
  width: 28px;
  height: 28px;
  border-radius: 9px;
}

.dashboard :deep(.stat-card__icon .el-icon) {
  font-size: 14px !important;
}

.dashboard :deep(.stat-card__label) {
  font-size: 11px;
}

.dashboard :deep(.stat-card__value) {
  margin-top: 3px;
  font-size: 22px;
  line-height: 1.1;
}

.dashboard :deep(.stat-card__caption) {
  margin-top: 4px;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 1.25;
}

.business-metric {
  display: grid;
  min-width: 0;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.business-metric .el-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 13px;
}

.business-metric span {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.business-metric strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.board-main {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 0.95fr);
  gap: var(--dash-gap);
  min-height: 0;
}

.panel--task-trend {
  grid-column: 1 / 6;
  grid-row: 1;
}

.panel--type-pie {
  grid-column: 6 / 9;
  grid-row: 1;
}

.panel--latency {
  grid-column: 9 / 13;
  grid-row: 1;
}

.panel--runtime {
  grid-column: 1 / 5;
  grid-row: 2;
}

.panel--traffic {
  grid-column: 5 / 9;
  grid-row: 2;
}

.panel--system {
  grid-column: 9 / 13;
  grid-row: 2;
}

.panel--workers {
  grid-column: 1 / 5;
  grid-row: 3;
}

.panel--capacity {
  grid-column: 5 / 9;
  grid-row: 3;
}

.panel--providers {
  grid-column: 9 / 13;
  grid-row: 3;
}

.dash-panel {
  min-height: 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: calc(var(--radius-card) - 4px);
}

.panel-aside-text {
  color: var(--ink-3);
  font-size: 10px;
  white-space: nowrap;
}

.dash-panel :deep(.page-card__header) {
  padding: 7px 10px 0;
  flex-shrink: 0;
}

.dash-panel :deep(.page-card__title) {
  font-size: 12px;
  font-weight: 650;
}

.dash-panel :deep(.page-card__subtitle) {
  font-size: 10px;
}

.dash-panel :deep(.page-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 10px 8px;
}

.chart-fill,
.table-fill {
  flex: 1;
  min-height: 0;
}

.chart-fill--gauges {
  min-height: 0;
}

.system-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
  margin-top: 4px;
}

.system-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 10px;
  line-height: 1.3;
}

.system-chip em {
  color: var(--ink-3);
  font-style: normal;
}

.system-chip strong {
  color: var(--ink);
  font-weight: 650;
}

.panel-empty {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
}

.panel-empty :deep(.el-empty__description) {
  font-size: 11px;
}

.worker-table {
  width: 100%;
}

.worker-table :deep(.el-table__header th) {
  height: 28px;
  padding: 0;
  background: var(--surface-2);
  font-size: 10px;
}

.worker-table :deep(.el-table__row td) {
  height: 30px;
  padding: 0;
  font-size: 10px;
}

.util-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.util-bar {
  width: 44px;
  height: 5px;
}

@media (max-width: 1400px) {
  .board-top {
    grid-template-columns: 1fr;
  }

  .board-strip--business {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-template-rows: auto;
  }

  .board-main {
    overflow: auto;
    grid-template-rows: 180px 180px 170px;
  }
}

@media (max-width: 1100px) {
  .dashboard {
    height: auto;
    overflow: visible;
  }

  .dashboard-board {
    overflow: visible;
  }

  .board-strip--hero,
  .board-strip--business {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .board-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    overflow: visible;
  }

  .panel--task-trend,
  .panel--type-pie,
  .panel--latency,
  .panel--runtime,
  .panel--traffic,
  .panel--system,
  .panel--workers,
  .panel--capacity,
  .panel--providers {
    grid-column: auto;
    grid-row: auto;
    min-height: 210px;
  }

  .chart-fill {
    min-height: 180px;
  }

}
</style>
