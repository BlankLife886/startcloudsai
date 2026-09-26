<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { adminRecentRange } from '@/adminListFilters'
import {
  CircleCheck,
  Reading,
  Refresh,
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
	canceled: number
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

interface PeriodUsageMetrics {
	settledCents: number
	imageCount: number
	text: {
		requestCount: number
		settledCents: number
		inputTokens: number
		outputTokens: number
		reasoningTokens: number
		totalTokens: number
	}
	image: {
		requestCount: number
		imageCount: number
		settledCents: number
	}
}

interface DashboardUsageMetrics {
	today: PeriodUsageMetrics
	last7Days: PeriodUsageMetrics
	last30Days: PeriodUsageMetrics
	todayToken: {
		inputTokens: number
		outputTokens: number
		reasoningTokens: number
		totalTokens: number
	}
}

interface ProfitPeriodMetrics {
	revenueCents: number
	upstreamCostCents: number
	grossProfitCents: number
	succeededUnits: number
	failedUnits: number
}

interface ProfitabilitySummary {
	today: ProfitPeriodMetrics
	last7Days: ProfitPeriodMetrics
	last30Days: ProfitPeriodMetrics
}

interface CreditTotals {
	incomeCents: number
	consumedCents: number
	refundCents: number
	remainingCents: number
	frozenCents: number
}

interface DashboardQualitySummary {
	agent: {
		traceCount: number
		succeeded: number
		failed: number
		averageScore: number
		failedSteps: number
		unfinishedSteps: number
	}
	billing: {
		anomalousEntries: number
		zeroRevenueEntries: number
		belowCostEntries: number
		zeroCostEntries: number
		missingRouteEntries: number
	}
	openApi: {
		enabled: boolean
		activeKeys: number
		requests24Hours: number
		pendingWebhooks: number
		deadWebhooks: number
	}
	objectCleanup: {
		pending: number
		failed: number
		oldestCreatedAt?: string | null
	}
}

interface OperationalIncident {
	key: string
	severity: 'warning' | 'critical'
	title: string
	summary: string
	status: 'open' | 'resolved'
	occurrences: number
	firstSeenAt: string
	lastSeenAt: string
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
	usageMetrics?: DashboardUsageMetrics
	profitability?: ProfitabilitySummary
	creditTotals?: CreditTotals
	quality?: DashboardQualitySummary
	operationalIncidents?: OperationalIncident[]
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
	executionPools?: {
		imageRunning: number
		imageLimit: number
		chatRunning: number
		chatLimit: number
		error?: string
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
	imageFetch: {
		available: boolean
		active: number
		effectiveLimit: number
		configuredCeiling: number
		workers: number
		activeUsers: number
		waitingUsers: number
		forecastWindowSeconds: number
		forecastImageUnits: number
		forecastCapacity: number
		forecastPressure: boolean
		error?: string
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
const helpOpen = ref(false)
const router = useRouter()
function overviewLink(label: string) {
  if (label === '注册用户总数') return { path: '/users' }
  if (label === '今日新注册') return { path: '/users', query: adminRecentRange(1) }
  if (label === '当前排队任务' || label === '当前执行任务') return { path: '/tasks', query: { status: label === '当前排队任务' ? 'queued' : 'running', createdFrom: '', createdTo: '' } }
  return null
}
function openOverview(label: string) { const target = overviewLink(label); if (target) void router.push(target) }
const incidentsOpen = ref(false)
const stats = ref<AdminStats | null>(null)
const systemMetrics = ref<SystemMetrics | null>(null)
const systemHistory = ref<SystemMetricPoint[]>([])
const systemError = ref('')
const loadedAt = ref('')
const businessError = ref('')
let refreshTimer: number | null = null
let systemRefreshTimer: number | null = null

const taskDaily = computed(() => stats.value?.taskDaily ?? [])
const operationalIncidents = computed(() => stats.value?.operationalIncidents ?? [])
const criticalIncidentCount = computed(() =>
	operationalIncidents.value.filter((item) => item.severity === 'critical').length,
)

const performance = computed<TaskPerformance>(() => stats.value?.taskPerformance ?? {
	queuedNow: 0,
	runningNow: 0,
	created: 0,
	succeeded: 0,
	failed: 0,
	canceled: 0,
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

function formatCount(value: number | null | undefined) {
	if (value == null) return '—'
	const count = Number(value)
	return Number.isFinite(count) ? Math.max(0, Math.round(count)).toLocaleString('zh-CN') : '-'
}

/** 大数字紧凑显示：≥1 万用「万」，≥1 亿用「亿」；完整值放在 title 里 */
function compactNumber(value: number | null | undefined) {
	if (value == null || !Number.isFinite(Number(value))) return '—'
	const n = Number(value)
	const abs = Math.abs(n)
	if (abs >= 1e8) return `${(n / 1e8).toFixed(abs >= 1e10 ? 0 : 2)} 亿`
	if (abs >= 1e5) return `${Math.round(n / 1e4).toLocaleString('zh-CN')} 万`
	return Math.round(n).toLocaleString('zh-CN')
}

/** 读取主题令牌；依赖 chartBase() 内的 isDark，调用方 computed 会随主题重算 */
function cssToken(name: string) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#94a3b8'
}

/** 竖向渐变：顶部实色，底部淡出 */
function fade(color: string, top = 0.28) {
	const alpha = Math.round(top * 255).toString(16).padStart(2, '0')
	return { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color.startsWith('#') ? `${color}${alpha}` : color }, { offset: 1, color: color.startsWith('#') ? `${color}00` : 'transparent' }] }
}

/** 系统容量三项：数据库连接、普通任务容量、队列压力（0–100%） */
const capacityRings = computed(() => {
	const metrics = systemMetrics.value
	if (!metrics) return []
	const queue = metrics.queue
	const queuePressure = queue.available && queue.workerConcurrency > 0 ? Math.min(100, (queue.pending / queue.workerConcurrency) * 100) : 0
	const tone = (value: number) => (value >= 90 ? '--danger' : value >= 70 ? '--warning' : '')
	return [
		{ name: '数据库连接', value: metrics.database.utilizationPercent, detail: `${metrics.database.acquiredConnections}/${metrics.database.maxConnections}`, color: tone(metrics.database.utilizationPercent) || '--accent' },
		{ name: '任务容量', value: metrics.taskPressure.utilizationPercent, detail: metrics.taskPressure.error ? '-' : `${metrics.taskPressure.active}/${metrics.taskPressure.globalLimit}`, color: tone(metrics.taskPressure.utilizationPercent) || '--info' },
		{ name: '队列压力', value: queuePressure, detail: queue.available ? `${queue.pending} 待处理` : '-', color: tone(queuePressure) || '--violet' },
	]
})

/** 同心圆环：外→内 数据库、任务容量、队列压力 */
const ringsOption = computed((): EChartOption => {
	const base = chartBase()
	const rings = capacityRings.value
	const radii = [['80%', '94%'], ['58%', '72%'], ['36%', '50%']]
	return {
		tooltip: { ...base.tooltip, formatter: '{b} {c}%' },
		series: rings.map((ring, index) => ({
			type: 'gauge' as const,
			startAngle: 90,
			endAngle: -270,
			radius: radii[index][1],
			min: 0,
			max: 100,
			progress: { show: true, width: 12, roundCap: true, itemStyle: { color: cssToken(ring.color), shadowBlur: 8, shadowColor: `${cssToken(ring.color)}55` } },
			pointer: { show: false },
			axisLine: { lineStyle: { width: 12, color: [[1, 'rgb(128 128 128 / 0.13)']] } },
			axisTick: { show: false },
			splitLine: { show: false },
			axisLabel: { show: false },
			title: { show: false },
			detail: { show: false },
			data: [{ value: Number(ring.value.toFixed(1)), name: ring.name }],
		})),
	}
})

const systemChips = computed(() => {
	const metrics = systemMetrics.value
	if (!metrics) return []
	const queue = metrics.queue
	const pressure = metrics.taskPressure
	const pools = metrics.executionPools
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
		{ label: '普通任务积压', value: pressure.error ? '-' : `${pressure.active}/${pressure.globalLimit} 个` },
		{ label: '图片执行', value: pools && !pools.error ? `${pools.imageRunning}/${pools.imageLimit} 张` : '-' },
		{ label: '对话执行', value: pools && !pools.error ? `${pools.chatRunning}/${pools.chatLimit} 次` : '-' },
		{
			label: '拉图槽',
			value: metrics.imageFetch.available
				? `${metrics.imageFetch.active}/${metrics.imageFetch.effectiveLimit}`
				: '-',
		},
		{
			label: '10秒回图',
			value: metrics.imageFetch.available
				? `${metrics.imageFetch.forecastImageUnits}/${metrics.imageFetch.forecastCapacity}`
				: '-',
		},
		{ label: 'Worker', value: `${queue.onlineWorkers} 在线` },
		{ label: '运行', value: formatUptime(metrics.process.uptimeSeconds) },
		{
			label: 'GC',
			value: `${metrics.process.memory.gcCycles} · ${metrics.process.memory.gcCPUFraction.toFixed(2)}%`,
		},
	]
})

/** 实时折线：面积渐变 + 双轴，运行时资源与 API 流量共用 */
function liveLineOption(
	series: Array<{ name: string; color: string; data: number[]; axis?: number }>,
	axes: Array<{ formatter?: string; max?: number }>,
): EChartOption {
	const base = chartBase()
	return {
		tooltip: { trigger: 'axis', ...base.tooltip },
		legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 6, textStyle: { ...base.legendText, fontSize: 11 } },
		grid: { left: 2, right: 6, top: 26, bottom: 0, containLabel: true },
		xAxis: {
			type: 'category',
			boundaryGap: false,
			data: systemHistory.value.map((point) => point.time),
			axisLabel: { ...base.axisLabel, fontSize: 10, hideOverlap: true },
			axisLine: base.axisLine,
			axisTick: { show: false },
		},
		yAxis: axes.map((axis, index) => ({
			type: 'value' as const,
			min: 0,
			max: axis.max,
			// 右轴只参与缩放不画刻度，当前值在卡片标题右侧直接显示
			axisLabel: index === 0 ? { ...base.axisLabel, fontSize: 10, formatter: axis.formatter ?? '{value}' } : { show: false },
			splitLine: index === 0 ? base.splitLine : { show: false },
		})),
		series: series.map((item) => ({
			name: item.name,
			type: 'line' as const,
			yAxisIndex: item.axis ?? 0,
			smooth: 0.35,
			// 按 x 方向单调平滑，数值跳变时不会画出实际不存在的尖峰和低谷
			smoothMonotone: 'x',
			// 刚打开时只有一两个采样点，显示圆点避免图表看起来是空的
			showSymbol: systemHistory.value.length < 4,
			symbolSize: 6,
			lineStyle: { width: 2, color: item.color },
			itemStyle: { color: item.color },
			areaStyle: { color: fade(item.color) },
			data: item.data,
		})),
	}
}

const runtimeChartOption = computed<EChartOption>(() =>
	liveLineOption(
		[
			{ name: 'CPU', color: cssToken('--accent'), data: systemHistory.value.map((point) => point.cpu) },
			{ name: '内存', color: cssToken('--warning'), data: systemHistory.value.map((point) => point.memory), axis: 1 },
		],
		[{ formatter: '{value}%', max: 100 }, { formatter: '{value} MiB' }],
	),
)

const trafficChartOption = computed<EChartOption>(() =>
	liveLineOption(
		[
			{ name: '请求/秒', color: cssToken('--info'), data: systemHistory.value.map((point) => point.rps) },
			{ name: 'P95 延迟', color: cssToken('--violet'), data: systemHistory.value.map((point) => point.p95), axis: 1 },
		],
		[{}, { formatter: '{value} ms' }],
	),
)

const terminalTasks24h = computed(() => performance.value.succeeded + performance.value.failed)
const successRate24h = computed(() => percent(performance.value.succeeded, terminalTasks24h.value))

const queueState = computed(() => {
	if (performance.value.queuedNow === 0) return { label: '队列畅通', tone: 'success' }
	if (performance.value.queuedNow <= Math.max(2, performance.value.runningNow)) {
		return { label: '轻度排队', tone: 'warning' }
	}
	return { label: '需要关注', tone: 'danger' }
})

/** 首屏横幅：今日快照（主数字为今日交付图片） */
const todayStats = computed(() => {
	const profit = stats.value?.profitability
	const usage = stats.value?.usageMetrics
	const profitToday = Number(profit?.today.grossProfitCents || 0)
	return {
		images: formatCount(usage?.today.image.imageCount),
		images30: formatCount(usage?.last30Days.image.imageCount),
		items: [
			{ label: '今日新注册', value: formatCount(stats.value?.newUsersToday), unit: '人', link: '今日新注册', tone: '' },
			{ label: '今日创作差额', value: profit ? formatPoints(profit.today.grossProfitCents) : '—', unit: '积分', link: '', tone: profitToday < 0 ? 'is-bad' : profitToday > 0 ? 'is-gain' : '' },
			{ label: '今日结算', value: formatPoints(usage?.today.settledCents), unit: '积分', link: '', tone: '' },
			{ label: '注册用户', value: formatCount(stats.value?.totalUsers), unit: '人', link: '注册用户总数', tone: '' },
		],
		week: profit ? formatPoints(profit.last7Days.grossProfitCents) : '—',
	}
})

/** 首屏横幅背景：近 7 日任务量面积 + 成功线，弱化坐标 */
const heroChartOption = computed<EChartOption>(() => {
	const base = chartBase()
	const accent = cssToken('--accent')
	const info = cssToken('--info')
	const danger = cssToken('--danger')
	return {
		tooltip: { trigger: 'axis', ...base.tooltip },
		legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 6, itemGap: 14, textStyle: { ...base.legendText, fontSize: 11 } },
		grid: { left: 4, right: 4, top: 30, bottom: 0, containLabel: true },
		xAxis: { type: 'category', boundaryGap: false, data: taskDaily.value.map((d) => d.date.slice(5)), axisLabel: { ...base.axisLabel, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
		yAxis: { type: 'value', minInterval: 1, axisLabel: { ...base.axisLabel, fontSize: 10 }, splitLine: base.splitLine },
		series: [
			{ name: '任务量', type: 'line', smooth: 0.4, symbol: 'circle', symbolSize: 7, showSymbol: true, lineStyle: { width: 3, color: accent, shadowBlur: 14, shadowColor: `${accent}66` }, itemStyle: { color: accent, borderColor: cssToken('--surface'), borderWidth: 2 }, areaStyle: { color: fade(accent, 0.32) }, data: taskDaily.value.map((d) => d.total) },
			{ name: '成功', type: 'line', smooth: 0.4, symbol: 'none', lineStyle: { width: 2, color: info }, itemStyle: { color: info }, data: taskDaily.value.map((d) => d.succeeded) },
			{ name: '失败', type: 'line', smooth: 0.4, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed', color: danger }, itemStyle: { color: danger }, data: taskDaily.value.map((d) => d.failed) },
		],
	}
})

/** 首屏大数字计数动画：首次拿到数据时从 0 滚到目标值，之后刷新直接更新 */
const heroCount = ref<number | null>(null)
let heroAnimated = false
watch(() => stats.value?.usageMetrics?.today.image.imageCount, (target) => {
	if (target == null) return
	const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
	if (heroAnimated || reduce) {
		heroCount.value = target
		return
	}
	heroAnimated = true
	const start = globalThis.performance.now()
	const duration = 900
	const step = (now: number) => {
		const t = Math.min(1, (now - start) / duration)
		heroCount.value = Math.round(target * (1 - Math.pow(1 - t, 3)))
		if (t < 1) requestAnimationFrame(step)
	}
	requestAnimationFrame(step)
})

/** 执行额度：图片按张、对话按次，另附最久排队时长 */
const executionPools = computed(() => {
	const metrics = systemMetrics.value
	const pools = metrics?.executionPools
	if (!metrics || !pools || pools.error) return []
	const pct = (running: number, limit: number) => (limit > 0 ? Math.min(100, (running / limit) * 100) : 0)
	return [
		{ label: '图片执行', value: `${pools.imageRunning}/${pools.imageLimit} 张`, pct: pct(pools.imageRunning, pools.imageLimit) },
		{ label: '对话执行', value: `${pools.chatRunning}/${pools.chatLimit} 次`, pct: pct(pools.chatRunning, pools.chatLimit) },
	]
})

/** 24h 任务结果分段：成功 / 失败 / 取消 */
const taskSplit = computed(() => {
	const p = performance.value
	const total = p.succeeded + p.failed + p.canceled
	return [
		{ key: 'ok', label: '成功', value: p.succeeded, share: total ? (p.succeeded / total) * 100 : 0 },
		{ key: 'fail', label: '失败', value: p.failed, share: total ? (p.failed / total) * 100 : 0 },
		{ key: 'cancel', label: '取消', value: p.canceled, share: total ? (p.canceled / total) * 100 : 0 },
	]
})

const creditKpis = computed(() => {
	const credits = stats.value?.creditTotals
	const usage = stats.value?.usageMetrics
	const remaining = credits?.remainingCents ?? stats.value?.walletBalanceCents
	return [
		{ label: '历史累计入账', value: formatPoints(credits?.incomeCents), hint: '充值、兑换、赠送、退款和正向人工调整的历史累计入账积分' },
		{ label: '历史累计结算', value: formatPoints(credits?.consumedCents), hint: '已完成结算的历史累计消耗积分，包含负向人工调整' },
		{ label: '当前可用积分', value: remaining !== undefined ? formatPoints(remaining) : '—', hint: '当前所有用户钱包可直接使用的积分总额' },
		{ label: '当前冻结积分', value: formatPoints(credits?.frozenCents), hint: '任务已预扣但尚未成功结算或退回的积分' },
		{ label: '今日结算积分', value: formatPoints(usage?.today.settledCents), hint: '北京时间今天成功结算的创作消耗积分' },
		{ label: '近 7 日结算积分', value: formatPoints(usage?.last7Days.settledCents), hint: '含今天在内 7 个北京时间自然日的结算积分' },
		{ label: '近 30 日结算积分', value: formatPoints(usage?.last30Days.settledCents), hint: '含今天在内 30 个北京时间自然日的结算积分' },
		{ label: '历史解冻退回', value: formatPoints(credits?.refundCents), hint: '任务失败或取消后，从冻结余额解冻退回的历史累计积分' },
	]
})

const usageKpis = computed(() => {
	const usage = stats.value?.usageMetrics
	const token = usage?.todayToken
	return [
		{ label: '今日文本请求', value: formatCount(usage?.today.text.requestCount), hint: '北京时间今天成功完成的文本请求数' },
		{ label: '今日文本 Token', value: formatCount(token?.totalTokens), hint: '北京时间今天成功文本请求记录的 Token 总量' },
		{ label: '今日输入 Token', value: formatCount(token?.inputTokens), hint: '今日文本请求记录的输入 Token' },
		{ label: '今日输出 Token', value: formatCount(token?.outputTokens), hint: '今日文本请求记录的输出 Token' },
		{ label: '今日交付图片', value: formatCount(usage?.today.image.imageCount), hint: '北京时间今天成功任务实际交付的图片张数' },
		{ label: '今日图片请求', value: formatCount(usage?.today.image.requestCount), hint: '北京时间今天成功完成的图片任务或生图请求数' },
		{ label: '近 7 日文本请求', value: formatCount(usage?.last7Days.text.requestCount), hint: '含今天在内 7 个北京时间自然日成功完成的文本请求数' },
		{ label: '近 30 日交付图片', value: formatCount(usage?.last30Days.image.imageCount), hint: '含今天在内 30 个北京时间自然日实际交付的图片张数' },
	]
})

/** 积分流向：按历史累计值比例画横条（当前值单独强调） */
const creditFlow = computed(() => {
	const c = stats.value?.creditTotals
	const remaining = c?.remainingCents ?? stats.value?.walletBalanceCents ?? 0
	const rows = [
		{ label: '累计入账', value: c?.incomeCents ?? 0, tone: '--info', hint: '充值、兑换、赠送、退款和正向人工调整的历史累计入账积分' },
		{ label: '累计结算', value: c?.consumedCents ?? 0, tone: '--accent', hint: '已完成结算的历史累计消耗积分，包含负向人工调整' },
		{ label: '解冻退回', value: c?.refundCents ?? 0, tone: '--violet', hint: '任务失败或取消后解冻退回的历史累计积分' },
		{ label: '当前可用', value: remaining, tone: '--success', hint: '当前所有用户钱包可直接使用的积分总额', now: true },
		{ label: '当前冻结', value: c?.frozenCents ?? 0, tone: '--warning', hint: '任务已预扣但尚未结算或退回的积分', now: true },
	]
	const max = Math.max(1, ...rows.map((row) => row.value))
	return rows.map((row) => ({ ...row, width: Math.max(row.value > 0 ? 1.5 : 0, (row.value / max) * 100) }))
})

/** 任务耗时哑铃：同一刻度上标出平均与 P95 */
const latencyRows = computed(() => {
	const p = performance.value
	const rows = [
		{ label: '排队', avg: p.avgQueueMs, p95: p.p95QueueMs },
		{ label: '生成', avg: p.avgRunMs, p95: p.p95RunMs },
		{ label: '端到端', avg: p.avgEndToEndMs, p95: p.p95EndToEndMs },
	]
	const max = Math.max(1, ...rows.map((row) => row.p95))
	return rows.map((row) => ({ ...row, avgPos: (row.avg / max) * 100, p95Pos: (row.p95 / max) * 100 }))
})

/** 有真实数据（计数 > 0）的任务类型 */
const typeEntries = computed(() =>
  Object.entries(stats.value?.typeDistribution ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ name: taskTypeLabel(type), value: count })),
)

const typeTotal = computed(() => typeEntries.value.reduce((sum, d) => sum + d.value, 0))

function typeColor(index: number) {
	const palette = [cssToken('--accent'), CHART_COLORS[2], CHART_COLORS[1], CHART_COLORS[5], CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[6]]
	return palette[index % palette.length]
}

const hasTypeDistribution = computed(() => typeTotal.value > 0)

const providers = computed(() => stats.value?.providerPerformance ?? [])

function providerSuccessRate(row: Partial<ProviderPerformance>) {
	return percent(Number(row.succeeded) || 0, Number(row.total) || 0)
}

/** 服务商近 24h 表现，按任务量排序 */
const providerRows = computed(() => [...providers.value].sort((a, b) => b.total - a.total))

const opsTab = ref<'capacity' | 'performance' | 'workers'>('capacity')

const qualityMetrics = computed(() => {
	const quality = stats.value?.quality
	const agent = quality?.agent
	const billing = quality?.billing
	const openApi = quality?.openApi
	const cleanup = quality?.objectCleanup
	const agentIssues = (agent?.failedSteps || 0) + (agent?.unfinishedSteps || 0)
	const webhookIssues = (openApi?.pendingWebhooks || 0) + (openApi?.deadWebhooks || 0)
	return [
		{
			label: '近 7 日 Agent 质量',
			value: agent?.traceCount ? `${Number(agent.averageScore || 0).toFixed(0)} 分` : '—',
			tone: !agent?.traceCount ? '' : agentIssues > 0 || agent.failed > 0 ? 'is-warn' : 'is-gain',
			hint: '含今天在内 7 个北京时间自然日的 Agent 执行平均质量分',
		},
		{
			label: '近 30 日计费异常',
			value: formatCount(billing?.anomalousEntries),
			tone: (billing?.anomalousEntries || 0) > 0 ? 'is-bad' : '',
			hint: '近 30 日成功用量中零收入、低于成本、零成本或缺少线路的记录数',
		},
		{
			label: '开放 API 状态',
			value: openApi?.enabled ? `${formatCount(openApi.activeKeys)} Key` : '已关闭',
			tone: (openApi?.deadWebhooks || 0) > 0 ? 'is-bad' : webhookIssues > 0 ? 'is-warn' : '',
			hint: '开放 API 的启用状态与当前有效密钥数量',
		},
		{
			label: '待清理存储对象',
			value: formatCount(cleanup?.pending),
			tone: (cleanup?.failed || 0) > 0 ? 'is-bad' : (cleanup?.pending || 0) > 0 ? 'is-warn' : '',
			hint: '对象存储清理队列中尚未完成的任务数',
		},
	]
})

async function load() {
	if (loading.value) return
  loading.value = true
  try {
		stats.value = await request<AdminStats>('/api/v1/admin/statistics', { silent: true })
    businessError.value = ''
    loadedAt.value = formatTime(new Date().toISOString())
  } catch {
    businessError.value = '业务统计读取失败，当前数字可能是上次快照，请刷新后再判断。'
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
  <div v-loading="loading && !stats" class="page dash">
    <!-- 状态条：无底色 -->
    <header class="dash-bar" aria-label="实时状态">
      <span class="live" :class="systemMetrics ? (systemMetrics.queue.available ? 'is-online' : 'is-offline') : 'is-pending'" />
      <strong class="dash-bar__title">经营与生产总览</strong>
      <span class="pill" :class="systemMetrics ? (systemMetrics.queue.available ? 'is-ok' : 'is-bad') : ''">
        {{ !systemMetrics ? '同步中' : systemMetrics.queue.available ? '服务在线' : '队列异常' }}
      </span>
      <button
        type="button"
        class="pill pill--btn"
        :class="!operationalIncidents.length ? 'is-ok' : criticalIncidentCount > 0 ? 'is-bad' : 'is-warn'"
        @click="incidentsOpen = true"
      >
        <el-icon><CircleCheck v-if="!operationalIncidents.length" /><WarningFilled v-else /></el-icon>
        {{ !stats || businessError ? '告警待同步' : operationalIncidents.length ? `${operationalIncidents.length} 项运行告警` : '暂无告警' }}
      </button>
      <span v-if="systemMetrics" class="dash-bar__meta">
        <span>Go <b>{{ systemMetrics.process.goVersion.replace(/^go/, '') }}</b></span>
        <span>Worker <b class="tnum">{{ systemMetrics.queue.onlineWorkers }}</b></span>
        <span>队列 <b class="tnum">{{ systemMetrics.queue.pending }}</b></span>
        <span>运行 <b>{{ formatUptime(systemMetrics.process.uptimeSeconds) }}</b></span>
      </span>
      <span v-if="systemError" class="dash-bar__alert">{{ systemError }}</span>
      <span class="dash-bar__spacer" />
      <span v-if="loadedAt" class="dash-bar__time">业务 20s · 系统 5s · 更新于 <b class="tnum">{{ loadedAt }}</b></span>
      <el-button size="small" :icon="Refresh" :loading="loading || systemLoading" @click="refreshAll">刷新</el-button>
      <el-button size="small" :icon="Reading" @click="helpOpen = true">说明</el-button>
    </header>

		<el-drawer
			v-model="incidentsOpen"
			title="运行告警"
			size="min(520px, 96vw)"
			append-to-body
			class="incident-drawer"
		>
			<div class="incident-list">
				<article
					v-for="incident in operationalIncidents"
					:key="incident.key"
					class="incident-item"
					:class="`is-${incident.severity}`"
				>
					<div class="incident-item__heading">
						<span>{{ incident.severity === 'critical' ? '严重' : '注意' }}</span>
						<time :datetime="incident.lastSeenAt">{{ formatTime(incident.lastSeenAt) }}</time>
					</div>
					<strong>{{ incident.title }}</strong>
					<p>{{ incident.summary }}</p>
					<small>首次出现 {{ formatTime(incident.firstSeenAt) }} · 已检测 {{ incident.occurrences }} 次</small>
				</article>
				<el-empty v-if="!operationalIncidents.length" description="当前没有运行告警" :image-size="56" />
			</div>
		</el-drawer>

    <el-drawer
      v-model="helpOpen"
      title="仪表盘说明"
      size="min(480px, 96vw)"
      append-to-body
      class="dashboard-help-drawer"
    >
      <div class="help-doc">
        <section class="help-section"><h3>新版阅读顺序</h3><p>首屏横幅是今日快照：大数字为今日交付图片，右侧为近 7 日任务曲线，下方四项可点击的今日指标。下面的网格依次是实时生产、系统容量三环、积分总账、任务类型、AI 用量、质量与风险、运行时资源、API 流量、服务商与 Worker、任务耗时和运行明细。</p><p>创作差额为积分口径，不是人民币净利润；真实收款和退款请去财务中心。当前值、累计值和时间窗口不能直接混算。</p><p>读取失败会提示并保留上次数据。尚未成功读取时显示「—」，不能当作 0 或运行正常。悬停指标可查看口径。</p></section>
        <section class="help-section">
          <h3>这个页面做什么</h3>
          <p>
            仪表盘是经营与生产的总览。日常先看用户、创作积分差额、排队和成功率，
            出现生产异常时再结合线路、Worker、API 和数据库指标定位问题。
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
              <dt>经营与生产总览</dt>
              <dd>业务数据每 20 秒刷新，系统运行数据每 5 秒采样一次。</dd>
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
              <dd>过去 24 小时创建的任务总量，并附带成功、失败和用户取消数量。统计包含文生图等图片任务，以及 AI 助手、无限画布、UI 设计工作区执行。</dd>
            </div>
            <div>
              <dt>近 24 小时成功率</dt>
              <dd>成功数 ÷（成功数 + 失败数），排除仍在处理和已取消任务。偏低时结合服务商表现和上游容量排查。</dd>
            </div>
          </dl>
        </section>

		<section class="help-section">
		  <h3>质量与风险</h3>
		  <p>四项摘要与业务统计一同每 20 秒刷新，只展示当前状态，不作为跳转入口。</p>
		  <dl>
			<div>
			  <dt>Agent 质量</dt>
			  <dd>近 7 日 Agent 执行评分，以及失败或未完成的工具步骤。</dd>
			</div>
			<div>
			  <dt>计费数据</dt>
			  <dd>近 30 日零积分、低于成本、成本为 0 或缺少线路记录的异常账目。</dd>
			</div>
			<div>
			  <dt>开放 API</dt>
			  <dd>用户入口开关、有效 Key、近 24 小时请求量和 Webhook 异常。</dd>
			</div>
			<div>
			  <dt>OSS 清理</dt>
			  <dd>等待空闲清理和已重试的对象数量；持续积压时进入设置页检查。</dd>
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
			  <dt>今日 / 近 7 日 / 近 30 日文本与图片</dt>
			  <dd>文本按成功调用次数与 Token 统计，图片按成功任务数与实际交付张数统计；两类实收分别记录，镜像历史不会重复计数。</dd>
			</div>
			<div>
			  <dt>今日 Token</dt>
			  <dd>按北京时间统计 AI 助手已记录的模型 Token 总量，卡片下方显示输入与输出拆分。</dd>
            </div>
            <div>
              <dt>累计入账 / 累计消耗 / 剩余积分</dt>
              <dd>全站积分总账：所有渠道累计到账、已结算消耗，以及用户钱包里尚未消耗的可用积分。冻结是预扣未结算额，失败退回是解冻退还。</dd>
            </div>
          </dl>
        </section>

        <section class="help-section">
          <h3>图表怎么读</h3>
          <dl>
            <div>
              <dt>近 7 日任务趋势</dt>
              <dd>每日任务量、成功、失败折线。看周末波动、突增突降和失败抬头。助手、画布和设计工作区执行已计入，镜像历史不重复计数。</dd>
            </div>
            <div>
              <dt>任务类型分布</dt>
              <dd>近 30 日各任务类型占比（文生图、AI 助手、无限画布、UI 设计等），环心为总任务数。</dd>
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
              <dt>普通任务容量</dt>
              <dd>普通任务的排队与运行数量相对积压容量的利用率；图片与对话执行额度分别在底部状态条显示。</dd>
            </div>
            <div>
              <dt>队列压力</dt>
              <dd>pending ÷ Worker 总并发槽。持续偏高说明消化不过来，可加 Worker 或查上游。</dd>
            </div>
          </dl>
          <p>底部显示图片执行占用（张）、对话执行占用（次）及各自上限，覆盖普通任务和助手；同时保留吞吐、API P95、CPU/内存、Worker等摘要。指标读取失败时显示「-」。</p>
        </section>

        <section class="help-section">
          <h3>Worker 实例</h3>
          <p>
            每一行是一个正在向 Redis 汇报心跳的
            <strong>执行服务实例</strong>。同一 Worker 进程可以分别运行图片和对话队列；生产可用
            <code>docker compose up -d --scale worker=N</code> 多开。
          </p>
          <dl>
            <div>
              <dt>主机 / PID</dt>
              <dd>进程所在机器与进程号，方便对照日志。</dd>
            </div>
            <div>
              <dt>活跃 / 槽位</dt>
              <dd>当前占用的操作槽 / 该执行服务的线程上限，与按图片张数或对话次数计算的执行额度分开显示。</dd>
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
          <p>各上游线路此刻的执行用量与配置容量，包含普通任务和助手。</p>
          <dl>
            <div>
              <dt>在途 / 容量</dt>
              <dd>正在占用该线路的执行用量 / 线路额度；图片按张累计，对话按次累计。</dd>
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

    <el-alert v-if="businessError" :title="businessError" type="error" :closable="false" show-icon />

    <!-- 首屏横幅：大字号今日快照 + 通栏 7 日任务曲线 -->
    <section class="hero" aria-label="今日快照">
      <div class="hero__copy">
        <span class="eyebrow">TODAY · 今日交付图片</span>
        <strong class="hero__big tnum">{{ heroCount !== null ? heroCount.toLocaleString('zh-CN') : '—' }}</strong>
        <span class="hero__caption">近 30 日共交付 <b class="tnum">{{ stats ? todayStats.images30 : '—' }}</b> 张 · 近 7 日创作差额 <b class="tnum">{{ stats ? todayStats.week : '—' }}</b> 积分</span>
        <dl class="hero__facts">
          <div
            v-for="item in todayStats.items"
            :key="item.label"
            :class="[item.tone, { 'is-link': item.link }]"
            :role="item.link ? 'link' : undefined"
            :tabindex="item.link ? 0 : undefined"
            @click="item.link && openOverview(item.link)"
            @keydown.enter="item.link && openOverview(item.link)"
          >
            <dt>{{ item.label }}</dt>
            <dd class="tnum">{{ stats ? item.value : '—' }}<small>{{ item.unit }}</small></dd>
          </div>
        </dl>
      </div>
      <div class="hero__chart">
        <span class="eyebrow">近 7 日任务</span>
        <div class="hero__plot"><EChart v-if="taskDaily.length" :option="heroChartOption" height="100%" /></div>
      </div>
    </section>

    <!-- Bento 网格 -->
    <div class="bento">
      <!-- 实时生产 -->
      <section class="tile tile--live o-live">
        <header class="tile__head"><h3>实时生产</h3><span class="state" :class="`is-${queueState.tone}`"><i />{{ queueState.label }}</span></header>
        <div class="live-nums">
          <button type="button" class="live-num" @click="openOverview('当前排队任务')">
            <small>排队中</small><b class="tnum">{{ stats ? formatCount(performance.queuedNow) : '—' }}</b>
          </button>
          <button type="button" class="live-num" @click="openOverview('当前执行任务')">
            <small>执行中</small><b class="tnum">{{ stats ? formatCount(performance.runningNow) : '—' }}</b>
          </button>
        </div>
        <ul v-if="executionPools.length" class="pools">
          <li v-for="pool in executionPools" :key="pool.label">
            <span>{{ pool.label }}</span>
            <i class="pools__bar"><u :class="pool.pct >= 90 ? 'is-bad' : pool.pct >= 70 ? 'is-warn' : ''" :style="{ width: `${pool.pct}%` }" /></i>
            <b class="tnum">{{ pool.value }}</b>
          </li>
          <li v-if="systemMetrics && !systemMetrics.taskPressure.error">
            <span>最久排队</span>
            <i class="pools__bar"><u :class="systemMetrics.taskPressure.oldestQueuedSeconds >= 60 ? 'is-bad' : systemMetrics.taskPressure.oldestQueuedSeconds >= 20 ? 'is-warn' : ''" :style="{ width: `${Math.min(100, (systemMetrics.taskPressure.oldestQueuedSeconds / 60) * 100)}%` }" /></i>
            <b class="tnum">{{ formatDuration(systemMetrics.taskPressure.oldestQueuedSeconds * 1000) }}</b>
          </li>
        </ul>
        <div class="split">
          <div class="split__head">
            <span>近 24h 新建 <b class="tnum">{{ stats ? formatCount(performance.created) : '—' }}</b></span>
            <span>成功率 <b class="tnum" :class="successRate24h < 70 ? 'is-bad' : successRate24h < 90 ? 'is-warn' : 'is-gain'">{{ terminalTasks24h ? `${successRate24h}%` : '—' }}</b></span>
          </div>
          <div class="split__bar"><i v-for="seg in taskSplit" :key="seg.key" :class="`is-${seg.key}`" :style="{ width: `${seg.share}%` }" /></div>
          <div class="split__legend">
            <span v-for="seg in taskSplit" :key="seg.key"><i :class="`is-${seg.key}`" />{{ seg.label }} <b class="tnum">{{ formatCount(seg.value) }}</b></span>
          </div>
        </div>
      </section>

      <!-- 系统容量：同心圆环 -->
      <section class="tile tile--rings o-rings">
        <header class="tile__head"><h3>系统容量</h3><span class="tile__aside">{{ systemMetrics ? `Worker ${systemMetrics.queue.onlineWorkers} · 运行 ${formatUptime(systemMetrics.process.uptimeSeconds)}` : '同步中' }}</span></header>
        <div v-if="systemMetrics" class="rings">
          <div class="rings__chart"><EChart :option="ringsOption" height="100%" /></div>
          <ul class="rings__legend">
            <li v-for="ring in capacityRings" :key="ring.name">
              <i :style="{ background: `var(${ring.color})` }" />
              <span>{{ ring.name }}<small>{{ ring.detail }}</small></span>
              <b class="tnum" :style="{ color: `var(${ring.color})` }">{{ ring.value.toFixed(0) }}%</b>
            </li>
          </ul>
        </div>
        <el-empty v-else description="系统指标加载中" :image-size="40" />
      </section>

      <!-- 任务耗时：哑铃 -->
      <section class="tile tile--latency o-latency">
        <header class="tile__head"><h3>任务耗时</h3><span class="legend-dots"><i class="is-avg" />平均 <i class="is-p95" />P95</span></header>
        <ul class="dumbbell">
          <li v-for="row in latencyRows" :key="row.label">
            <span class="dumbbell__label">{{ row.label }}</span>
            <span class="dumbbell__track">
              <i class="dumbbell__span" :style="{ left: `${row.avgPos}%`, width: `${Math.max(0, row.p95Pos - row.avgPos)}%` }" />
              <i class="dumbbell__dot is-avg" :style="{ left: `${row.avgPos}%` }" />
              <i class="dumbbell__dot is-p95" :style="{ left: `${row.p95Pos}%` }" />
            </span>
            <span class="dumbbell__vals tnum">{{ formatDuration(row.avg) }} <small>/ {{ formatDuration(row.p95) }}</small></span>
          </li>
        </ul>
      </section>

      <!-- 积分流向 -->
      <section class="tile tile--wide o-credit">
        <header class="tile__head"><h3>积分总账</h3><span class="tile__aside" title="累计值来自历史流水，不能相减推导余额；「当前」才是此刻余额">历史累计值 ≠ 当前余额</span></header>
        <ul class="flow">
          <li v-for="row in creditFlow" :key="row.label" :class="{ 'is-now': row.now }" :title="row.hint">
            <span class="flow__label">{{ row.label }}</span>
            <span class="flow__track"><i :style="{ width: `${row.width}%`, background: `var(${row.tone})` }" /></span>
            <b class="tnum" :title="stats ? formatPoints(row.value) : ''">{{ stats ? compactNumber(row.value) : '—' }}</b>
          </li>
        </ul>
        <dl class="settle">
          <div v-for="item in creditKpis.filter(k => k.label.includes('结算积分'))" :key="item.label" :title="item.hint">
            <dt>{{ item.label.replace('结算积分', '结算') }}</dt><dd class="tnum">{{ stats ? item.value : '—' }}</dd>
          </div>
        </dl>
      </section>

      <!-- 运行时 & 流量 -->
      <section class="tile o-runtime">
        <header class="tile__head"><h3>运行时资源</h3><span v-if="systemMetrics" class="readout"><b class="tnum">{{ systemMetrics.process.cpuUsagePercent.toFixed(0) }}%</b> CPU<em>·</em><b class="tnum">{{ formatBytes(systemMetrics.process.memory.usedBytes) }}</b></span></header>
        <div class="tile__chart"><EChart :option="runtimeChartOption" height="100%" /></div>
      </section>
      <section class="tile o-traffic">
        <header class="tile__head"><h3>API 流量</h3><span v-if="systemMetrics" class="readout"><b class="tnum">{{ systemMetrics.http.requestsPerSecond.toFixed(1) }}</b>/s<em>·</em>P95 <b class="tnum">{{ formatDuration(systemMetrics.http.p95LatencyMs) }}</b></span></header>
        <div class="tile__chart"><EChart :option="trafficChartOption" height="100%" /></div>
      </section>

      <!-- 系统指标明细 -->
      <section class="tile tile--xwide o-specs">
        <header class="tile__head"><h3>运行明细</h3><span class="tile__aside">{{ systemMetrics ? `Go ${systemMetrics.process.goVersion.replace(/^go/, '')} · Heap ${formatBytes(systemMetrics.process.memory.heapInUseBytes)}` : '等待系统指标' }}</span></header>
        <dl v-if="systemMetrics" class="specs">
          <div v-for="chip in systemChips" :key="chip.label"><dt>{{ chip.label }}</dt><dd class="tnum">{{ chip.value }}</dd></div>
        </dl>
        <el-empty v-else description="系统指标加载中" :image-size="40" />
      </section>
      <!-- 任务类型 -->
      <section class="tile tile--wide o-types">
        <header class="tile__head"><h3>任务类型</h3><span class="tile__aside">近 30 日 · 共 <b class="tnum">{{ formatCount(typeTotal) }}</b> 个任务</span></header>
        <template v-if="hasTypeDistribution">
          <div class="mix">
            <i v-for="(entry, index) in typeEntries" :key="entry.name" :style="{ flex: entry.value, background: typeColor(index) }" :title="`${entry.name} ${formatCount(entry.value)}`" />
          </div>
          <ul class="mix-legend">
            <li v-for="(entry, index) in typeEntries" :key="entry.name">
              <i :style="{ background: typeColor(index) }" />
              <span>{{ entry.name }}</span>
              <b class="tnum">{{ formatCount(entry.value) }}</b>
              <small class="tnum">{{ percent(entry.value, typeTotal) }}%</small>
            </li>
          </ul>
        </template>
        <el-empty v-else description="暂无类型数据" :image-size="40" />
      </section>

      <!-- AI 用量 -->
      <section class="tile o-usage">
        <header class="tile__head"><h3>AI 用量</h3><span class="tile__aside">仅成功请求</span></header>
        <div class="usage">
          <div class="usage__main">
            <small>今日文本 Token</small>
            <b class="tnum" :title="formatCount(stats?.usageMetrics?.todayToken.totalTokens)">{{ stats ? compactNumber(stats.usageMetrics?.todayToken.totalTokens) : '—' }}</b>
            <div class="usage__bar" :title="`输入 ${formatCount(stats?.usageMetrics?.todayToken.inputTokens)} · 输出 ${formatCount(stats?.usageMetrics?.todayToken.outputTokens)}`">
              <i class="is-in" :style="{ flex: stats?.usageMetrics?.todayToken.inputTokens || 0 }" />
              <i class="is-out" :style="{ flex: stats?.usageMetrics?.todayToken.outputTokens || 0 }" />
            </div>
            <span class="usage__io"><span><i class="is-in" />输入 {{ formatCount(stats?.usageMetrics?.todayToken.inputTokens) }}</span><span><i class="is-out" />输出 {{ formatCount(stats?.usageMetrics?.todayToken.outputTokens) }}</span></span>
          </div>
          <dl class="usage__list">
            <div v-for="item in usageKpis.filter(k => !k.label.includes('Token'))" :key="item.label" :title="item.hint">
              <dt>{{ item.label }}</dt><dd class="tnum">{{ stats ? item.value : '—' }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- 质量与风险 -->
      <section class="tile o-quality">
        <header class="tile__head"><h3>质量与风险</h3></header>
        <ul class="signals">
          <li v-for="item in qualityMetrics" :key="item.label" :class="item.tone || 'is-ok'" :title="item.hint">
            <i />
            <span>{{ item.label }}</span>
            <b class="tnum">{{ stats ? item.value : '—' }}</b>
          </li>
        </ul>
        <button type="button" class="incident-link" :class="!operationalIncidents.length ? 'is-ok' : criticalIncidentCount ? 'is-bad' : 'is-warn'" @click="incidentsOpen = true">
          {{ operationalIncidents.length ? `${operationalIncidents.length} 项运行告警，查看详情 →` : '暂无运行告警' }}
        </button>
      </section>

      <!-- 服务商 / Worker -->
      <section class="tile tile--wide o-ops">
        <header class="tile__head">
          <nav class="seg" role="tablist" aria-label="服务商与 Worker">
            <button type="button" role="tab" :aria-selected="opsTab === 'capacity'" :class="{ active: opsTab === 'capacity' }" @click="opsTab = 'capacity'">服务商容量</button>
            <button type="button" role="tab" :aria-selected="opsTab === 'performance'" :class="{ active: opsTab === 'performance' }" @click="opsTab = 'performance'">服务商表现 24h</button>
            <button type="button" role="tab" :aria-selected="opsTab === 'workers'" :class="{ active: opsTab === 'workers' }" @click="opsTab = 'workers'">Worker 实例</button>
          </nav>
          <span v-if="systemMetrics && opsTab === 'workers'" class="tile__aside">今日 {{ systemMetrics.queue.processedToday }} · 失败 {{ systemMetrics.queue.failedToday }}</span>
        </header>
        <table v-if="opsTab === 'capacity' && systemMetrics?.providers.length" class="ops">
          <thead><tr><th>服务商</th><th>协议</th><th>在途 / 容量</th><th class="ops__meter-col">利用率</th></tr></thead>
          <tbody>
            <tr v-for="row in systemMetrics.providers" :key="row.id">
              <td class="ops__name">{{ row.name }}</td><td class="muted">{{ row.adapter }}</td><td class="tnum">{{ row.running }} / {{ row.limit }}</td>
              <td><span class="meter"><u :class="row.utilizationPercent >= 90 ? 'is-bad' : row.utilizationPercent >= 70 ? 'is-warn' : ''" :style="{ width: `${Math.min(100, row.utilizationPercent)}%` }" /></span><b class="tnum meter-val">{{ row.utilizationPercent.toFixed(0) }}%</b></td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="opsTab === 'performance' && providerRows.length" class="ops">
          <thead><tr><th>服务商</th><th>任务</th><th>失败</th><th>平均 / P95</th><th class="ops__meter-col">成功率</th></tr></thead>
          <tbody>
            <tr v-for="row in providerRows" :key="row.provider">
              <td class="ops__name">{{ row.provider }}</td><td class="tnum">{{ formatCount(row.total) }}</td><td class="tnum" :class="{ 'is-bad': row.failed > 0 }">{{ formatCount(row.failed) }}</td>
              <td class="tnum muted">{{ formatDuration(row.avgDurationMs) }} / {{ formatDuration(row.p95DurationMs) }}</td>
              <td><span class="meter"><u :class="providerSuccessRate(row) < 70 ? 'is-bad' : providerSuccessRate(row) < 90 ? 'is-warn' : ''" :style="{ width: `${providerSuccessRate(row)}%` }" /></span><b class="tnum meter-val">{{ providerSuccessRate(row) }}%</b></td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="opsTab === 'workers' && systemMetrics?.queue.workers.length" class="ops">
          <thead><tr><th>主机</th><th>PID</th><th>状态</th><th class="ops__meter-col">活跃 / 槽位</th></tr></thead>
          <tbody>
            <tr v-for="worker in systemMetrics.queue.workers" :key="worker.id">
              <td class="ops__name">{{ worker.host }}</td><td class="tnum muted">{{ worker.pid }}</td><td><span class="state is-success"><i />{{ worker.status }}</span></td>
              <td><span class="meter"><u :style="{ width: `${worker.concurrency ? Math.min(100, (worker.active / worker.concurrency) * 100) : 0}%` }" /></span><b class="tnum meter-val">{{ worker.active }}/{{ worker.concurrency }}</b></td>
            </tr>
          </tbody>
        </table>
        <el-empty v-else :description="systemMetrics ? '暂无数据' : '系统指标加载中'" :image-size="40" />
      </section>

    </div>
  </div>
</template>

<style scoped>
/* 仪表盘「门面」：杂志式大标题首屏 + Bento 网格；跟随后台主题，无边框 */
.dash { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; padding: 2px 2px 18px; overflow: auto; container-type: inline-size; container-name: dash; }
.muted { color: var(--ink-3); }
.is-gain { color: var(--success); }
.is-warn { color: var(--warning); }
.is-bad { color: var(--danger); }

/* 状态条 */
.dash-bar { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; min-height: 30px; color: var(--ink-3); font-size: 12px; }
.dash-bar__title { color: var(--ink); font-size: 13px; font-weight: 650; letter-spacing: 0.02em; }
.dash-bar__meta { display: inline-flex; gap: 14px; padding-left: 12px; border-left: 1px solid color-mix(in srgb, var(--ink-3) 25%, transparent); }
.dash-bar__meta b { margin-left: 3px; color: var(--ink-2); font-weight: 650; }
.dash-bar__alert { color: var(--danger); }
.dash-bar__spacer { flex: 1; }
.dash-bar__time b { color: var(--ink-2); font-weight: 600; }
.dash-bar :deep(.el-button) { margin: 0; }
.live { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--ink-3); }
.live.is-online { background: var(--success); box-shadow: 0 0 0 3px var(--success-soft); animation: pulse 2s ease-in-out infinite; }
.live.is-offline { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px transparent; } }
.pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 600; }
.pill.is-ok { background: var(--success-soft); color: var(--success); }
.pill.is-warn { background: var(--warning-soft); color: var(--warning); }
.pill.is-bad { background: var(--danger-soft); color: var(--danger); }
.pill--btn { cursor: pointer; }

.eyebrow { color: var(--ink-3); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }

/* 首屏横幅 */
.hero {
  position: relative; display: grid; flex: 0 0 auto; grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.6fr); gap: 28px;
  padding: 24px 26px 20px; overflow: hidden; border-radius: 22px;
  background:
    radial-gradient(60% 120% at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
    radial-gradient(50% 90% at 100% 100%, color-mix(in srgb, var(--info) 10%, transparent), transparent 65%),
    var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 18px 40px -22px rgb(0 0 0 / 0.28);
}
.hero::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(color-mix(in srgb, var(--ink-3) 30%, transparent) 1px, transparent 1px);
  background-size: 16px 16px;
  mask-image: linear-gradient(100deg, rgb(0 0 0 / 0.5), transparent 55%);
}
html.dark .hero { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05), 0 20px 44px -24px rgb(0 0 0 / 0.8); }
.hero > * { position: relative; }
.hero__copy { display: flex; flex-direction: column; min-width: 0; }
.hero__big {
  margin: 4px 0 2px; font-size: 68px; font-weight: 800; line-height: 1; letter-spacing: -0.045em;
  background: linear-gradient(120deg, var(--ink) 20%, color-mix(in srgb, var(--accent) 80%, var(--ink)) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero__caption { color: var(--ink-3); font-size: 12px; }
.hero__caption b { color: var(--ink-2); font-weight: 650; }
.hero__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: auto 0 0; padding-top: 18px; }
.hero__facts > div { display: grid; gap: 2px; padding: 10px 0 2px; border-top: 1px solid color-mix(in srgb, var(--ink-3) 18%, transparent); }
.hero__facts > div:nth-child(odd) { padding-right: 16px; }
.hero__facts > div:nth-child(even) { padding-left: 16px; border-left: 1px solid color-mix(in srgb, var(--ink-3) 18%, transparent); }
.hero__facts > div.is-link { cursor: pointer; }
.hero__facts > div.is-link:hover dt { color: var(--accent-ink); }
.hero__facts dt { color: var(--ink-3); font-size: 12px; }
.hero__facts dd { margin: 0; color: var(--ink); font-size: 22px; font-weight: 750; letter-spacing: -0.02em; }
.hero__facts .is-gain dd { color: var(--success); }
.hero__facts .is-bad dd { color: var(--danger); }
.hero__facts dd small { margin-left: 4px; color: var(--ink-3); font-size: 11px; font-weight: 500; letter-spacing: 0; }
.hero__chart { display: flex; flex-direction: column; min-width: 0; }
.hero__plot { flex: 1; min-height: 220px; margin-top: -14px; }

/* Bento */
.bento { display: grid; flex: 0 0 auto; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
/* 按内容区宽度（不是视口）切列数：4 → 3 → 2 */
@container dash (max-width: 1240px) {
  .bento { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  /* 3 列：实时图并排在任务类型上方；类型 / 服务商 / 明细占满整行（加 .dash 前缀压过基础跨度） */
  .dash .bento .o-types, .dash .bento .o-ops, .dash .bento .o-specs { grid-column: span 3; }
  .dash .bento .o-latency { grid-column: span 1; }
  .dash .bento .o-credit { grid-column: span 2; }
  .o-live { order: 1; } .o-rings { order: 2; } .o-usage { order: 3; } .o-quality { order: 4; } .o-credit { order: 5; }
  .o-runtime { order: 6; } .o-traffic { order: 7; } .o-latency { order: 8; } .o-types { order: 9; } .o-ops { order: 10; } .o-specs { order: 11; }
  .tile .mix-legend { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tile .rings { grid-template-columns: 118px minmax(0, 1fr); gap: 12px; }
  .tile .rings__chart { height: 118px; }
  .tile .specs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@container dash (max-width: 900px) {
  .bento { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash .bento .o-types, .dash .bento .o-ops, .dash .bento .o-credit, .dash .bento .o-specs, .dash .bento .o-latency { grid-column: span 2; }
  .tile .mix-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile .specs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* 入场与悬停 */
.hero, .tile { animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.tile:nth-child(1) { animation-delay: 60ms; }
.tile:nth-child(2) { animation-delay: 100ms; }
.tile:nth-child(3) { animation-delay: 140ms; }
.tile:nth-child(4) { animation-delay: 180ms; }
.tile:nth-child(5) { animation-delay: 220ms; }
.tile:nth-child(6) { animation-delay: 260ms; }
.tile:nth-child(n + 7) { animation-delay: 300ms; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
.tile { transition: transform 0.2s ease, box-shadow 0.2s ease; }
.tile:hover { transform: translateY(-2px); box-shadow: 0 1px 2px rgb(0 0 0 / 0.05), 0 16px 32px -18px rgb(0 0 0 / 0.28); }
html.dark .tile:hover { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 18px 36px -18px rgb(0 0 0 / 0.85); }
@media (prefers-reduced-motion: reduce) { .hero, .tile { animation: none; } .tile, .tile:hover { transform: none; transition: none; } }

/* 执行额度 */
.pools { display: grid; gap: 3px; margin: 8px 0 0; padding: 0; list-style: none; }
.pools li { line-height: 16px; display: grid; grid-template-columns: 56px minmax(0, 1fr) 76px; align-items: center; gap: 10px; font-size: 12px; }
.pools span { color: var(--ink-3); white-space: nowrap; }
.pools__bar { height: 5px; overflow: hidden; border-radius: 3px; background: var(--surface-2); }
.pools__bar u { display: block; height: 100%; border-radius: inherit; background: var(--info); }
.pools__bar u.is-warn { background: var(--warning); }
.pools__bar u.is-bad { background: var(--danger); }
.pools b { color: var(--ink); font-weight: 650; text-align: right; white-space: nowrap; }
.tile { display: flex; flex-direction: column; min-width: 0; padding: 16px 18px; border-radius: 18px; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 10px 26px -16px rgb(0 0 0 / 0.2); }
html.dark .tile { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 12px 30px -18px rgb(0 0 0 / 0.7); }
.tile--wide { grid-column: span 2; }
.tile--xwide { grid-column: span 2; }
.tile--latency { grid-column: span 1; }
.bento .o-credit { grid-column: span 1; }
.bento .o-ops { grid-column: span 4; }
.tile__head { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; min-height: 24px; margin-bottom: 12px; }
.tile__head h3 { margin: 0; color: var(--ink); font-size: 14px; font-weight: 700; letter-spacing: 0.01em; }
.tile__aside { overflow: hidden; color: var(--ink-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.tile__aside b { color: var(--ink-2); }
.tile__chart { flex: 1; min-height: 170px; }
.readout { color: var(--ink-3); font-size: 11px; white-space: nowrap; }
.readout b { color: var(--ink); font-size: 14px; font-weight: 750; }
.readout em { margin: 0 6px; font-style: normal; opacity: 0.6; }
.state { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 12px; font-weight: 600; }
.state i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.state.is-success { color: var(--success); }
.state.is-warning { color: var(--warning); }
.state.is-danger { color: var(--danger); }

/* 实时生产 */
.live-nums { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.live-num { display: grid; gap: 0; padding: 6px 12px; border: 0; border-radius: 14px; background: var(--surface-2); color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background 0.15s; }
.live-num:hover { background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }
.live-num small { color: var(--ink-3); font-size: 12px; }
.live-num b { color: var(--ink); font-size: 24px; font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; }
.split { margin-top: auto; padding-top: 8px; }
.split__head { line-height: 16px; display: flex; justify-content: space-between; gap: 8px; color: var(--ink-3); font-size: 12px; }
.split__head b { margin-left: 3px; color: var(--ink); font-size: 14px; font-weight: 700; }
.split__head b.is-gain { color: var(--success); }
.split__bar { display: flex; gap: 2px; height: 6px; margin: 6px 0 5px; overflow: hidden; border-radius: 4px; background: var(--surface-2); }
.split__bar i, .split__legend i { background: var(--ink-3); }
.split__bar .is-ok, .split__legend .is-ok { background: var(--accent); }
.split__bar .is-fail, .split__legend .is-fail { background: var(--danger); }
.split__bar .is-cancel, .split__legend .is-cancel { background: color-mix(in srgb, var(--ink-3) 60%, transparent); }
.split__legend { line-height: 14px; display: flex; gap: 12px; color: var(--ink-3); font-size: 11px; }
.split__legend span { display: inline-flex; align-items: center; gap: 5px; }
.split__legend i { width: 7px; height: 7px; border-radius: 2px; }
.split__legend b { color: var(--ink-2); font-weight: 650; }

/* 同心圆环 */
.rings { display: grid; flex: 1; grid-template-columns: 128px minmax(0, 1fr); align-items: center; gap: 14px; }
.rings__chart { height: 128px; }
.rings__legend { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.rings__legend li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 8px; font-size: 12px; }
.rings__legend i { width: 8px; height: 8px; border-radius: 50%; }
.rings__legend span { display: grid; color: var(--ink-2); white-space: nowrap; }
.rings__legend small { color: var(--ink-3); font-size: 11px; }
.rings__legend b { color: var(--ink); font-size: 16px; font-weight: 750; }

/* 积分流向 */
.flow { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.flow li { line-height: 16px; display: grid; grid-template-columns: 64px minmax(0, 1fr) 84px; align-items: center; gap: 12px; font-size: 12px; }
.flow__label { color: var(--ink-3); white-space: nowrap; }
.flow__track { height: 8px; overflow: hidden; border-radius: 5px; background: var(--surface-2); }
.flow__track i { display: block; height: 100%; border-radius: inherit; opacity: 0.85; }
.flow b { color: var(--ink); font-size: 14px; font-weight: 700; text-align: right; }
.flow li.is-now .flow__label { color: var(--ink); font-weight: 650; }
.flow li.is-now .flow__track i { opacity: 1; box-shadow: 0 0 10px -2px currentColor; }
.settle { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 8px 0 0; padding-top: 8px; border-top: 1px solid color-mix(in srgb, var(--ink-3) 16%, transparent); }
.settle div { display: grid; gap: 0; line-height: 1.3; }
.settle div + div { padding-left: 16px; border-left: 1px solid color-mix(in srgb, var(--ink-3) 16%, transparent); }
.settle dt { color: var(--ink-3); font-size: 11px; }
.settle dd { margin: 0; color: var(--ink); font-size: 16px; font-weight: 750; }

/* 任务类型 */
.mix { display: flex; gap: 3px; height: 14px; overflow: hidden; border-radius: 7px; }
.mix i { min-width: 3px; }
.mix-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 24px; margin: 14px 0 0; padding: 0; list-style: none; }
.mix-legend li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 38px; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px dashed color-mix(in srgb, var(--ink-3) 16%, transparent); font-size: 12px; }
.mix-legend i { width: 8px; height: 8px; border-radius: 2px; }
.mix-legend span { overflow: hidden; color: var(--ink-2); text-overflow: ellipsis; white-space: nowrap; }
.mix-legend b { color: var(--ink); font-weight: 650; }
.mix-legend small { color: var(--ink-3); text-align: right; }

/* AI 用量 */
.usage { display: flex; flex: 1; flex-direction: column; gap: 12px; }
.usage__main small { color: var(--ink-3); font-size: 12px; }
.usage__main > b { display: block; color: var(--ink); font-size: 28px; font-weight: 800; line-height: 1.15; letter-spacing: -0.03em; }
.usage__bar { display: flex; gap: 2px; height: 6px; margin: 8px 0 6px; overflow: hidden; border-radius: 3px; background: var(--surface-2); }
.is-in { background: var(--info); }
.is-out { background: var(--violet); }
.usage__io { display: flex; gap: 12px; color: var(--ink-3); font-size: 11px; }
.usage__io span { display: inline-flex; align-items: center; gap: 5px; }
.usage__io i { width: 7px; height: 7px; border-radius: 2px; }
.usage__list { display: grid; gap: 5px; margin: 0; }
.usage__list div { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.usage__list dt { color: var(--ink-3); }
.usage__list dd { margin: 0; color: var(--ink); font-weight: 650; }

/* 质量信号 */
.signals { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.signals li { --c: var(--success); display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: var(--surface-2); font-size: 12px; }
.signals li.is-warn { --c: var(--warning); }
.signals li.is-bad { --c: var(--danger); }
.signals li.is-gain { --c: var(--success); }
.signals i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 20%, transparent); }
.signals span { color: var(--ink-2); }
.signals b { color: var(--ink); font-size: 14px; font-weight: 700; }
.signals li.is-warn b, .signals li.is-bad b { color: var(--c); }
.incident-link { margin-top: auto; padding: 10px 0 0; border: 0; background: none; font: inherit; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; }
.incident-link.is-ok { color: var(--success); cursor: default; }
.incident-link.is-warn { color: var(--warning); }
.incident-link.is-bad { color: var(--danger); }

/* 耗时哑铃 */
.legend-dots { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-3); font-size: 11px; }
.legend-dots i { width: 8px; height: 8px; border-radius: 50%; }
.legend-dots i + i, .legend-dots i:not(:first-child) { margin-left: 8px; }
.is-avg { background: var(--accent); }
.is-p95 { background: #fb923c; }
.dumbbell { display: grid; flex: 1; align-content: space-evenly; gap: 16px; margin: 4px 0 0; padding: 0; list-style: none; }
.dumbbell li { display: grid; gap: 6px; }
.dumbbell__label { display: flex; justify-content: space-between; color: var(--ink-2); font-size: 12px; }
.dumbbell li { grid-template-columns: 1fr auto; }
.dumbbell__track { position: relative; grid-column: 1 / -1; grid-row: 2; height: 12px; }
.dumbbell__track::before { content: ''; position: absolute; top: 5px; right: 0; left: 0; height: 2px; border-radius: 1px; background: var(--surface-2); }
.dumbbell__span { position: absolute; top: 4px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--accent), #fb923c); opacity: 0.6; }
.dumbbell__dot { position: absolute; top: 0; width: 12px; height: 12px; margin-left: -6px; border: 2px solid var(--surface); border-radius: 50%; box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); }
.dumbbell__vals { grid-row: 1; grid-column: 2; color: var(--ink); font-size: 12px; font-weight: 650; }
.dumbbell__vals small { color: var(--ink-3); font-weight: 500; }

/* 分段切换 */
.seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--surface-2); }
.seg button { padding: 5px 12px; border: 0; border-radius: 8px; background: none; color: var(--ink-3); font: inherit; font-size: 12px; cursor: pointer; }
.seg button:hover { color: var(--ink); }
.seg button.active { background: var(--surface); color: var(--ink); font-weight: 650; box-shadow: var(--shadow-sm); }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* 服务商 / Worker 表 */
.ops { width: 100%; border-collapse: collapse; font-size: 12px; }
.ops th { padding: 0 8px 8px 0; color: var(--ink-3); font-size: 11px; font-weight: 500; text-align: left; white-space: nowrap; }
.ops td { padding: 8px 8px 8px 0; border-top: 1px solid color-mix(in srgb, var(--ink-3) 14%, transparent); color: var(--ink-2); white-space: nowrap; }
.ops__name { color: var(--ink) !important; font-weight: 600; }
.ops__meter-col { width: 42%; }
.meter { display: inline-block; width: calc(100% - 52px); height: 6px; overflow: hidden; border-radius: 3px; background: var(--surface-2); vertical-align: middle; }
.meter u { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 45%, transparent), var(--accent)); }
.meter u.is-warn { background: linear-gradient(90deg, color-mix(in srgb, var(--warning) 45%, transparent), var(--warning)); }
.meter u.is-bad { background: linear-gradient(90deg, color-mix(in srgb, var(--danger) 45%, transparent), var(--danger)); }
.meter-val { display: inline-block; width: 48px; color: var(--ink); font-weight: 700; text-align: right; }

/* 运行明细 */
.specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 18px; margin: 0; }
.specs div { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px dashed color-mix(in srgb, var(--ink-3) 16%, transparent); font-size: 12px; }
.specs dt { color: var(--ink-3); white-space: nowrap; }
.specs dd { margin: 0; overflow: hidden; color: var(--ink); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) { .live.is-online { animation: none; } }

@media (max-width: 1500px) {
  .hero { grid-template-columns: minmax(300px, 0.9fr) minmax(0, 1.4fr); gap: 20px; }
  .hero__big { font-size: 54px; }
  .hero__facts dd { font-size: 19px; }
  .dash-bar__meta span:nth-child(n + 3), .dash-bar__time { display: none; }
}
@container dash (max-width: 900px) {
  .hero { grid-template-columns: minmax(0, 1fr); }
  .hero__plot { min-height: 180px; margin-top: 0; }
}

.incident-list {
	display: grid;
	gap: 8px;
}
.incident-item {
	padding: 12px;
	border: 1px solid var(--border);
	border-left: 3px solid var(--warning);
	border-radius: 6px;
	background: var(--surface);
}
.incident-item.is-critical {
	border-left-color: var(--danger);
}
.incident-item__heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 6px;
	color: var(--ink-3);
	font-size: 10px;
}
.incident-item__heading span {
	font-weight: 750;
}
.incident-item strong {
	display: block;
	color: var(--ink);
	font-size: 13px;
}
.incident-item p {
	margin: 5px 0;
	color: var(--ink-2);
	font-size: 12px;
	line-height: 1.55;
}
.incident-item small {
	color: var(--ink-3);
	font-size: 10px;
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
.help-section li {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.65;
}
.help-section ul + p {
  margin-top: 8px;
}
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
</style>
