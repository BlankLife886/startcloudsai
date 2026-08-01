<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import {
	AlarmClock,
  CircleCheck,
	Coin,
	Clock,
	Connection,
	Cpu,
	DataAnalysis,
  Histogram,
	Loading,
	Memo,
	Odometer,
	Platform,
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

function finiteMemoryLimit(limit: number) {
	return Number.isFinite(limit) && limit > 0 && limit < Number.MAX_SAFE_INTEGER
}

const memoryUsagePercent = computed(() => {
	const memory = systemMetrics.value?.process.memory
	if (!memory || !finiteMemoryLimit(memory.limitBytes)) return 0
	return Math.min(100, (memory.usedBytes / memory.limitBytes) * 100)
})

const systemCards = computed<KpiCard[]>(() => {
	const metrics = systemMetrics.value
	if (!metrics) return []
	const queue = metrics.queue
	return [
		{
			label: 'API 吞吐', value: `${metrics.http.requestsPerSecond.toFixed(2)} req/s`,
			caption: `在途 ${metrics.http.inFlight} · 近 60 秒 ${metrics.http.requests}`,
			icon: Odometer, tone: 'accent',
		},
		{
			label: 'API P95', value: formatDuration(metrics.http.p95LatencyMs),
			caption: `平均 ${formatDuration(metrics.http.averageLatencyMs)} · 5xx ${metrics.http.status5xx}`,
			icon: TrendCharts, tone: metrics.http.status5xx > 0 ? 'danger' : 'success',
		},
		{
			label: '进程 CPU', value: `${metrics.process.cpuUsagePercent.toFixed(1)}%`,
			caption: `${metrics.process.goMaxProcs} 并行线程 · ${metrics.process.logicalCPUs} 逻辑核`,
			icon: Cpu, tone: metrics.process.cpuUsagePercent >= 85 ? 'danger' : metrics.process.cpuUsagePercent >= 65 ? 'warning' : 'info',
		},
		{
			label: 'Go 内存', value: formatBytes(metrics.process.memory.usedBytes),
			caption: finiteMemoryLimit(metrics.process.memory.limitBytes)
				? `${memoryUsagePercent.value.toFixed(1)}% / ${formatBytes(metrics.process.memory.limitBytes)}`
				: '未设置 GOMEMLIMIT',
			icon: Memo, tone: memoryUsagePercent.value >= 90 ? 'danger' : memoryUsagePercent.value >= 75 ? 'warning' : 'info',
		},
		{
			label: 'Goroutine', value: metrics.process.goroutines,
			caption: `运行 ${formatUptime(metrics.process.uptimeSeconds)} · GC ${metrics.process.memory.gcCycles} 次`,
			icon: Platform, tone: 'violet',
		},
		{
			label: '数据库连接', value: `${metrics.database.acquiredConnections} / ${metrics.database.maxConnections}`,
			caption: `利用率 ${metrics.database.utilizationPercent.toFixed(1)}% · 空闲 ${metrics.database.idleConnections}`,
			icon: Coin, tone: metrics.database.utilizationPercent >= 90 ? 'danger' : metrics.database.utilizationPercent >= 70 ? 'warning' : 'success',
		},
		{
			label: '队列积压', value: queue.available ? queue.pending : '-',
			caption: queue.available ? `活跃 ${queue.active} · 延迟 ${formatDuration(queue.latencyMs)}` : 'Redis 队列不可用',
			icon: AlarmClock, tone: !queue.available || queue.paused ? 'danger' : queue.pending > queue.workerConcurrency ? 'warning' : 'success',
		},
		{
			label: 'Worker', value: `${queue.onlineWorkers} 在线`,
			caption: `活跃 ${queue.activeWorkers} / 并发 ${queue.workerConcurrency}`,
			icon: Connection, tone: queue.onlineWorkers > 0 ? 'success' : 'danger',
		},
	]
})

const runtimeChartOption = computed<EChartOption>(() => {
	const base = chartBase()
	return {
		color: [CHART_COLORS[0], CHART_COLORS[3]],
		tooltip: { trigger: 'axis', ...base.tooltip },
		legend: { data: ['CPU', '内存'], top: 0, textStyle: base.legendText },
		grid: { left: 42, right: 18, top: 34, bottom: 24 },
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
		grid: { left: 42, right: 52, top: 34, bottom: 24 },
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
  <div v-loading="loading" class="page">
    <div class="page-header">
	  <div class="dashboard-title">
		<span class="title">任务运营仪表盘</span>
		<span class="dashboard-live"><i />系统指标 5 秒刷新</span>
	  </div>
	  <span v-if="loadedAt" class="text-muted">更新于 {{ loadedAt }}</span>
	  <el-button :icon="Refresh" size="small" :loading="loading || systemLoading" @click="refreshAll">刷新</el-button>
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

	<section class="system-monitor" aria-labelledby="system-monitor-title">
		<div class="section-heading">
			<div>
				<h2 id="system-monitor-title">实时系统性能</h2>
				<p>API 进程、数据库连接池与任务 Worker 实时状态</p>
			</div>
			<div class="system-status">
				<el-tag v-if="systemMetrics" :type="systemMetrics.queue.available ? 'success' : 'danger'" effect="plain" size="small">
					{{ systemMetrics.queue.available ? '服务在线' : '队列异常' }}
				</el-tag>
				<span v-if="systemMetrics" class="text-muted">{{ systemMetrics.process.goVersion }}</span>
			</div>
		</div>

		<el-alert v-if="systemError" :title="systemError" type="warning" :closable="false" show-icon />
		<div v-if="systemMetrics" class="system-kpi-grid">
			<StatCard
				v-for="card in systemCards"
				:key="card.label"
				:label="card.label"
				:value="card.value"
				:caption="card.caption"
				:icon="card.icon"
				:tone="card.tone"
			/>
		</div>

		<div v-if="systemMetrics" class="system-charts">
			<PageCard title="运行时资源" subtitle="最近 5 分钟 CPU 与 Go 内存占用">
				<EChart :option="runtimeChartOption" height="240px" />
			</PageCard>
			<PageCard title="API 实时流量" subtitle="近 60 秒请求速率与 P95 延迟">
				<EChart :option="trafficChartOption" height="240px" />
			</PageCard>
		</div>

		<div v-if="systemMetrics" class="system-details">
			<PageCard title="资源明细" subtitle="连接池、GC 与诊断配置">
				<dl class="metric-list">
					<div><dt>数据库连接</dt><dd>{{ systemMetrics.database.totalConnections }} 总计 / {{ systemMetrics.database.idleConnections }} 空闲</dd></div>
					<div><dt>连接池等待</dt><dd>{{ systemMetrics.database.emptyAcquireCount }} 次 / {{ formatDuration(systemMetrics.database.acquireDurationMs) }}</dd></div>
					<div><dt>Heap 使用</dt><dd>{{ formatBytes(systemMetrics.process.memory.heapInUseBytes) }}</dd></div>
					<div><dt>Stack 使用</dt><dd>{{ formatBytes(systemMetrics.process.memory.stackInUseBytes) }}</dd></div>
					<div><dt>GC CPU</dt><dd>{{ systemMetrics.process.memory.gcCPUFraction.toFixed(2) }}%</dd></div>
					<div><dt>私有 pprof</dt><dd>{{ systemMetrics.profiling.enabled ? '已启用' : '未启用' }}</dd></div>
				</dl>
			</PageCard>
			<PageCard title="Worker 实例" :subtitle="`今日处理 ${systemMetrics.queue.processedToday} · 失败 ${systemMetrics.queue.failedToday}`">
				<el-table v-if="systemMetrics.queue.workers.length" :data="systemMetrics.queue.workers" class="worker-table" max-height="260">
					<el-table-column prop="host" label="主机" min-width="130" show-overflow-tooltip />
					<el-table-column prop="pid" label="PID" width="80" align="right" />
					<el-table-column prop="active" label="活跃" width="75" align="right" />
					<el-table-column prop="concurrency" label="并发" width="75" align="right" />
					<el-table-column label="状态" width="90" align="right">
						<template #default="{ row }"><el-tag type="success" effect="plain" size="small">{{ row.status }}</el-tag></template>
					</el-table-column>
				</el-table>
				<div v-else class="worker-empty">
					<el-empty description="没有在线 Worker" :image-size="48" />
				</div>
			</PageCard>
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

.system-monitor {
	display: grid;
	gap: 14px;
	margin-bottom: 18px;
	padding: 18px 0;
	border-top: 1px solid var(--border);
	border-bottom: 1px solid var(--border);
}

.section-heading {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
}

.section-heading h2 {
	margin: 0;
	color: var(--ink-1);
	font-size: 15px;
	font-weight: 650;
	letter-spacing: 0;
}

.section-heading p {
	margin: 4px 0 0;
	color: var(--ink-3);
	font-size: 11px;
}

.system-status {
	display: flex;
	align-items: center;
	gap: 10px;
}

.system-kpi-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px;
}

.system-charts,
.system-details {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.metric-list {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	margin: 0;
}

.metric-list > div {
	display: flex;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px;
	border-bottom: 1px solid var(--border);
}

.metric-list > div:nth-last-child(-n + 2) {
	border-bottom: 0;
}

.metric-list dt {
	color: var(--ink-3);
	font-size: 11px;
}

.metric-list dd {
	margin: 0;
	overflow: hidden;
	color: var(--ink-1);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	font-weight: 600;
	text-align: right;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.worker-table {
	width: 100%;
}

.worker-empty {
	min-height: 160px;
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
	.system-kpi-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 1100px) {
  .charts,
	.system-charts,
	.system-details {
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
	.system-kpi-grid,
	.metric-list {
		grid-template-columns: 1fr;
	}
	.metric-list > div,
	.metric-list > div:nth-last-child(-n + 2) {
		border-bottom: 1px solid var(--border);
	}
	.metric-list > div:last-child {
		border-bottom: 0;
	}
	.section-heading {
		align-items: flex-start;
		flex-direction: column;
	}
}
</style>
