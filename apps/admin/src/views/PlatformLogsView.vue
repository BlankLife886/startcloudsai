<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Connection, Delete, Refresh, Search, Setting, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/request'
import { formatTime, shortId } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase, CHART_COLORS } from '@/chartTheme'

type LogCategory = 'security' | 'operations' | 'user'
type LogLevel = 'info' | 'warning' | 'error'

interface PlatformLogConfig {
  enabled: boolean
  securityEnabled: boolean
  operationsEnabled: boolean
  userEnabled: boolean
  retentionDays: number
  maxMb: number
}

interface OverviewSummary {
  count: number
  errorCount: number
  warningCount: number
  slowCount: number
  averageDurationMs: number
  p95DurationMs: number
  distinctTasks: number
  distinctRequests: number
}

interface TrendPoint {
  bucket: string
  count: number
  errorCount: number
  warningCount: number
  slowCount: number
  averageDurationMs: number
}

interface EventRank {
  event: string
  category: LogCategory
  count: number
  errorCount: number
  warningCount: number
  lastAt: string
}

interface RouteRank {
  route: string
  service: string
  count: number
  errorCount: number
  averageDurationMs: number
  p95DurationMs: number
  maximumDurationMs: number
}

interface TaskIssue {
  taskId: string
  objectType: string
  userEmail: string
  taskType: string
  status: string
  model: string
  provider: string
  attempt: number
  errorCode: string
  errorMessage: string
  lastEvent: string
  lastMessage: string
  issueCount: number
  lastAt: string
}

interface PlatformLogStats {
  config: PlatformLogConfig
  capacity: {
    count: number
    logicalBytes: number
    physicalBytes: number
    oldestAt?: string | null
    newestAt?: string | null
    byCategory: Record<string, number>
    byLevel: Record<string, number>
  }
  maxBytes: number
  usagePercent: number
  overview: {
    summary: OverviewSummary
    trend: TrendPoint[]
    topEvents: EventRank[]
    slowRoutes: RouteRank[]
    taskIssues: TaskIssue[]
  }
}

interface PlatformLog {
  id: number
  category: LogCategory
  level: LogLevel
  service: string
  event: string
  message: string
  requestId?: string | null
  userId?: string | null
  adminId?: string | null
  taskId?: string | null
  clientIp?: string | null
  statusCode?: number | null
  durationMs?: number | null
  metadata: Record<string, unknown>
  sizeBytes: number
  createdAt: string
}

interface LogPage {
  items: PlatformLog[]
  hasMore: boolean
  nextCursor: string
}

interface SystemMetrics {
  http: {
    inFlight: number
    requests: number
    requestsPerSecond: number
    status5xx: number
    averageLatencyMs: number
    p95LatencyMs: number
    maximumLatencyMs: number
  }
  database: {
    acquiredConnections: number
    maxConnections: number
    utilizationPercent: number
  }
  taskPressure: {
    queued: number
    running: number
    oldestQueuedSeconds: number
  }
  imageFetch: {
    available: boolean
    active: number
    effectiveLimit: number
    forecastPressure: boolean
  }
}

const emptySummary: OverviewSummary = {
  count: 0,
  errorCount: 0,
  warningCount: 0,
  slowCount: 0,
  averageDurationMs: 0,
  p95DurationMs: 0,
  distinctTasks: 0,
  distinctRequests: 0,
}

const router = useRouter()
const loading = ref(false)
const statsLoading = ref(false)
const actionLoading = ref(false)
const items = ref<PlatformLog[]>([])
const hasMore = ref(false)
const nextCursor = ref('')
const stats = ref<PlatformLogStats | null>(null)
const systemMetrics = ref<SystemMetrics | null>(null)
const selected = ref<PlatformLog | null>(null)
const detailOpen = ref(false)
const filters = reactive({
  category: '',
  level: '',
  service: '',
  range: '24h',
  search: '',
  taskId: '',
  requestId: '',
  userId: '',
  route: '',
})
let refreshTimer: number | null = null

const categoryLabels: Record<string, string> = { security: '安全', operations: '运维', user: '用户' }
const levelLabels: Record<string, string> = { info: '正常', warning: '警告', error: '错误' }
const metadataLabels: Record<string, string> = {
  objectType: '对象类型', userEmail: '用户邮箱', taskType: '任务类型', taskStatus: '任务状态',
  model: '上游模型', modelConfigId: '模型配置', attempt: '已重试次数', provider: '适配器',
  providerDisplayName: '服务商', providerConfigId: '服务商配置', providerRouteName: '线路名称',
  providerRouteId: '线路配置', providerRouteKey: '线路标识', errorCode: '错误码',
  errorMessage: '失败原因', currentStage: '当前阶段', stage: '事件阶段', status: '事件状态',
  method: '请求方法', route: '接口路由', scope: '访问范围', client: '客户端', outcome: '请求结果',
  responseBytes: '响应大小', contentLength: '请求大小', slow: '慢事件', images: '图片数量',
  requestedImages: '请求图片数', delaySecs: '重试等待秒数', memWaitMs: '内存等待',
  transformMs: '图片处理', uploadMs: '存储上传',
}

const summary = computed(() => stats.value?.overview.summary ?? emptySummary)
const errorRate = computed(() => summary.value.count > 0 ? (summary.value.errorCount * 100) / summary.value.count : 0)
const categoryEnabled = computed(() => ({
  security: stats.value?.config.securityEnabled ?? false,
  operations: stats.value?.config.operationsEnabled ?? false,
  user: stats.value?.config.userEnabled ?? false,
}))
const activeDrilldown = computed(() => filters.taskId || filters.requestId || filters.route || '')

const trendOption = computed<EChartOption>(() => {
  const base = chartBase()
  const points = stats.value?.overview.trend ?? []
  const labels = points.map((item) => {
    const date = new Date(item.bucket)
    return filters.range === '24h'
      ? `${String(date.getHours()).padStart(2, '0')}:00`
      : `${date.getMonth() + 1}/${date.getDate()}`
  })
  return {
    color: [CHART_COLORS[2], CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[0]],
    tooltip: { ...base.tooltip, trigger: 'axis' },
    legend: { top: 0, right: 0, textStyle: base.legendText },
    grid: { left: 42, right: 44, top: 38, bottom: 26 },
    xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: [
      { type: 'value', minInterval: 1, axisLabel: base.axisLabel, splitLine: base.splitLine },
      { type: 'value', axisLabel: { ...base.axisLabel, formatter: '{value}ms' }, splitLine: { show: false } },
    ],
    series: [
      { name: '事件', type: 'line', smooth: true, symbol: 'none', data: points.map((item) => item.count), lineStyle: { width: 2 } },
      { name: '错误', type: 'line', smooth: true, symbol: 'none', data: points.map((item) => item.errorCount), lineStyle: { width: 2 } },
      { name: '警告', type: 'line', smooth: true, symbol: 'none', data: points.map((item) => item.warningCount), lineStyle: { width: 2 } },
      { name: '平均耗时', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'none', data: points.map((item) => Math.round(item.averageDurationMs)), lineStyle: { width: 2, type: 'dashed' } },
    ],
  }
})

const diagnosticEntries = computed(() => Object.entries(selected.value?.metadata ?? {})
  .filter(([, value]) => value !== null && value !== '' && value !== false)
  .map(([key, value]) => ({ key, label: metadataLabels[key] || key, value: displayValue(key, value) })))

function displayValue(key: string, value: unknown) {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number' && key.toLowerCase().endsWith('ms')) return formatDuration(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatBytes(bytes?: number | null) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}

function formatDuration(ms?: number | null) {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`
}

function levelTag(level: string): 'success' | 'warning' | 'danger' {
  if (level === 'error') return 'danger'
  if (level === 'warning') return 'warning'
  return 'success'
}

async function loadStats() {
  if (statsLoading.value) return
  statsLoading.value = true
  try {
    stats.value = await request<PlatformLogStats>('/api/v1/admin/platform-logs/stats', {
      query: { range: filters.range }, silent: true,
    })
  } finally {
    statsLoading.value = false
  }
}

async function loadSystemMetrics() {
  systemMetrics.value = await request<SystemMetrics>('/api/v1/admin/system/metrics', { silent: true })
}

async function load(reset = true) {
  if (loading.value) return
  loading.value = true
  try {
    const page = await request<LogPage>('/api/v1/admin/platform-logs', {
      query: {
        category: filters.category, level: filters.level, service: filters.service, range: filters.range,
        search: filters.search.trim(), taskId: filters.taskId.trim(), requestId: filters.requestId.trim(),
        userId: filters.userId.trim(), route: filters.route, cursor: reset ? '' : nextCursor.value, limit: 100,
      },
    })
    items.value = reset ? page.items : [...items.value, ...page.items]
    hasMore.value = page.hasMore
    nextCursor.value = page.nextCursor || ''
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  await Promise.all([load(true), loadStats(), loadSystemMetrics()])
}

function changeRange() { void refreshAll() }

function resetFilters() {
  Object.assign(filters, {
    category: '', level: '', service: '', range: '24h', search: '', taskId: '', requestId: '', userId: '', route: '',
  })
  void refreshAll()
}

function drillTask(taskId: string) {
  filters.taskId = taskId
  filters.requestId = ''
  filters.route = ''
  detailOpen.value = false
  void load(true)
}

function drillRequest(requestId: string) {
  filters.requestId = requestId
  filters.taskId = ''
  filters.route = ''
  detailOpen.value = false
  void load(true)
}

function drillRoute(route: string) {
  filters.route = route
  filters.taskId = ''
  filters.requestId = ''
  detailOpen.value = false
  void load(true)
}

function drillEvent(event: string) { filters.search = event; void load(true) }
function clearDrilldown() { filters.taskId = ''; filters.requestId = ''; filters.route = ''; void load(true) }
function openDetail(row: PlatformLog) { selected.value = row; detailOpen.value = true }

async function cleanupNow() {
  actionLoading.value = true
  try {
    const result = await request<{ deleted: number }>('/api/v1/admin/platform-logs/cleanup', { method: 'POST' })
    ElMessage.success(result.deleted ? `已清理 ${result.deleted} 条日志` : '当前没有需要清理的日志')
    await refreshAll()
  } finally {
    actionLoading.value = false
  }
}

async function clearLogs() {
  await ElMessageBox.confirm('将永久删除全部平台日志。任务、钱包和用户业务数据不会被删除。', '清空平台日志', {
    type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消',
  })
  actionLoading.value = true
  try {
    const result = await request<{ deleted: number }>('/api/v1/admin/platform-logs', { method: 'DELETE', query: { all: true } })
    ElMessage.success(`已删除 ${result.deleted} 条日志`)
    await refreshAll()
  } finally {
    actionLoading.value = false
  }
}

function openSettings() { void router.push({ path: '/settings', query: { section: 'logging' } }) }

onMounted(() => {
  void refreshAll()
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAll()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div class="page platform-logs-page">
    <PageCard>
      <header class="logs-head">
        <div>
          <strong>运行日志与诊断</strong>
          <small>查看异常趋势、慢链路和任务上下文，所有内容均已脱敏</small>
        </div>
        <div class="logs-head__actions">
          <el-select v-model="filters.range" class="range-select" @change="changeRange">
            <el-option label="近24小时" value="24h" />
            <el-option label="近7日" value="7d" />
            <el-option label="近30日" value="30d" />
            <el-option label="全部" value="all" />
          </el-select>
          <el-button :icon="Setting" @click="openSettings">设置</el-button>
          <el-button :icon="Refresh" :loading="loading || statsLoading" @click="refreshAll">刷新</el-button>
        </div>
      </header>

      <div v-if="stats" class="runtime-strip" :class="{ 'is-off': !stats.config.enabled }">
        <div class="runtime-state">
          <i />
          <span>
            <strong>{{ stats.config.enabled ? '日志采集中' : '日志已关闭' }}</strong>
            <small>{{ stats.config.enabled ? `保留 ${stats.config.retentionDays} 天 · 每30秒刷新` : '不会记录新的平台日志' }}</small>
          </span>
        </div>
        <div v-for="category in ['security', 'operations', 'user']" :key="category" class="runtime-category">
          <i :class="{ 'is-on': categoryEnabled[category as keyof typeof categoryEnabled] }" />
          {{ categoryLabels[category] }} {{ stats.capacity.byCategory[category] || 0 }}
        </div>
        <div class="runtime-capacity">
          <span><i :style="{ width: `${Math.max(stats.usagePercent, 1)}%` }" /></span>
          <small>{{ formatBytes(stats.capacity.logicalBytes) }} / {{ formatBytes(stats.maxBytes) }}</small>
        </div>
      </div>

      <section v-if="systemMetrics" class="live-grid">
        <article><span>API 实时流量</span><strong>{{ systemMetrics.http.requestsPerSecond.toFixed(2) }} req/s</strong><small>近60秒 {{ systemMetrics.http.requests }} 次 · 当前 {{ systemMetrics.http.inFlight }} 个请求</small></article>
        <article :class="{ 'is-danger': systemMetrics.http.status5xx > 0 }"><span>HTTP 健康</span><strong>{{ systemMetrics.http.status5xx }} 个 5xx</strong><small>P95 {{ formatDuration(systemMetrics.http.p95LatencyMs) }} · 最大 {{ formatDuration(systemMetrics.http.maximumLatencyMs) }}</small></article>
        <article :class="{ 'is-warning': systemMetrics.taskPressure.queued > 0 }"><span>任务压力</span><strong>{{ systemMetrics.taskPressure.queued }} 排队 / {{ systemMetrics.taskPressure.running }} 运行</strong><small>最久排队 {{ systemMetrics.taskPressure.oldestQueuedSeconds }} 秒</small></article>
        <article :class="{ 'is-warning': systemMetrics.database.utilizationPercent >= 80 }"><span>数据库连接</span><strong>{{ systemMetrics.database.acquiredConnections }} / {{ systemMetrics.database.maxConnections }}</strong><small>使用率 {{ systemMetrics.database.utilizationPercent.toFixed(1) }}%</small></article>
        <article :class="{ 'is-warning': systemMetrics.imageFetch.forecastPressure }"><span>图片拉回</span><strong>{{ systemMetrics.imageFetch.active }} / {{ systemMetrics.imageFetch.effectiveLimit }}</strong><small>{{ systemMetrics.imageFetch.available ? '并发槽位正常' : '指标暂不可用' }}</small></article>
      </section>

      <section class="metric-grid">
        <article><span>事件总量</span><strong>{{ summary.count.toLocaleString('zh-CN') }}</strong><small>{{ summary.distinctRequests }} 条请求 · {{ summary.distinctTasks }} 个任务</small></article>
        <article :class="{ 'is-danger': summary.errorCount > 0 }"><span>错误</span><strong>{{ summary.errorCount }}</strong><small>错误率 {{ errorRate.toFixed(1) }}%</small></article>
        <article :class="{ 'is-warning': summary.warningCount > 0 }"><span>警告</span><strong>{{ summary.warningCount }}</strong><small>需要关注但未必失败</small></article>
        <article><span>慢事件</span><strong>{{ summary.slowCount }}</strong><small>耗时超过 2 秒</small></article>
        <article><span>平均耗时</span><strong>{{ formatDuration(summary.averageDurationMs) }}</strong><small>所有带耗时事件</small></article>
        <article :class="{ 'is-warning': summary.p95DurationMs >= 2000 }"><span>P95 耗时</span><strong>{{ formatDuration(summary.p95DurationMs) }}</strong><small>95% 的事件低于此值</small></article>
      </section>

      <section class="observability-grid">
        <div class="trend-panel">
          <header><div><strong>事件与耗时趋势</strong><small>快速判断错误是否集中爆发</small></div><Connection class="panel-icon" /></header>
          <EChart v-if="stats?.overview.trend.length" :option="trendOption" height="238px" />
          <el-empty v-else description="当前周期没有趋势数据" :image-size="46" />
        </div>
        <div class="rank-panel">
          <header><div><strong>异常事件排行</strong><small>按错误、警告和出现次数排序</small></div><WarningFilled class="panel-icon" /></header>
          <div v-if="stats?.overview.topEvents.length" class="rank-list">
            <button v-for="item in stats.overview.topEvents" :key="`${item.category}:${item.event}`" @click="drillEvent(item.event)">
              <span><b>{{ item.event }}</b><small>{{ categoryLabels[item.category] }} · {{ formatTime(item.lastAt) }}</small></span>
              <em v-if="item.errorCount" class="is-error">{{ item.errorCount }} 错误</em>
              <em v-else-if="item.warningCount" class="is-warning">{{ item.warningCount }} 警告</em>
              <em v-else>{{ item.count }} 次</em>
            </button>
          </div>
          <el-empty v-else description="当前周期没有异常事件" :image-size="46" />
        </div>
      </section>

      <section class="diagnostic-grid">
        <div class="diagnostic-panel">
          <header><strong>最慢接口</strong><small>按 P95 耗时排序，点击查看该路由日志</small></header>
          <div v-if="stats?.overview.slowRoutes.length" class="compact-list">
            <button v-for="item in stats.overview.slowRoutes" :key="`${item.service}:${item.route}`" @click="drillRoute(item.route)">
              <span><b>{{ item.route }}</b><small>{{ item.service }} · {{ item.count }} 次 · {{ item.errorCount }} 错误</small></span><em>{{ formatDuration(item.p95DurationMs) }}</em>
            </button>
          </div>
          <el-empty v-else description="暂无接口耗时数据" :image-size="42" />
        </div>
        <div class="diagnostic-panel">
          <header><strong>异常任务</strong><small>最近出现警告或错误的任务，点击追踪完整时间线</small></header>
          <div v-if="stats?.overview.taskIssues.length" class="compact-list">
            <button v-for="item in stats.overview.taskIssues" :key="item.taskId" @click="drillTask(item.taskId)">
              <span><b>{{ item.taskType || item.objectType }} · {{ shortId(item.taskId) }}</b><small>{{ item.errorMessage || item.lastMessage }}<template v-if="item.model"> · {{ item.model }}</template></small></span><em>{{ item.issueCount }} 条</em>
            </button>
          </div>
          <el-empty v-else description="当前周期没有异常任务" :image-size="42" />
        </div>
      </section>

      <div class="log-toolbar">
        <el-select v-model="filters.category" clearable placeholder="全部分类" class="filter-short" @change="load(true)">
          <el-option label="安全日志" value="security" /><el-option label="运维日志" value="operations" /><el-option label="用户日志" value="user" />
        </el-select>
        <el-select v-model="filters.level" clearable placeholder="全部等级" class="filter-short" @change="load(true)">
          <el-option label="正常" value="info" /><el-option label="警告" value="warning" /><el-option label="错误" value="error" />
        </el-select>
        <el-select v-model="filters.service" clearable placeholder="全部服务" class="filter-short" @change="load(true)">
          <el-option label="API" value="api" /><el-option label="Worker" value="worker" />
        </el-select>
        <el-input v-model="filters.taskId" clearable placeholder="任务 ID" class="filter-id" @keyup.enter="load(true)" />
        <el-input v-model="filters.requestId" clearable placeholder="请求 ID" class="filter-id" @keyup.enter="load(true)" />
        <el-input v-model="filters.search" clearable placeholder="事件或描述" class="filter-search" :prefix-icon="Search" @keyup.enter="load(true)" />
        <el-button type="primary" @click="load(true)">查询</el-button><el-button text @click="resetFilters">重置</el-button>
        <span class="toolbar-spacer" />
        <el-button :loading="actionLoading" @click="cleanupNow">按策略清理</el-button>
        <el-button type="danger" plain :icon="Delete" :loading="actionLoading" @click="clearLogs">清空</el-button>
      </div>

      <div v-if="activeDrilldown" class="drilldown-bar"><span>正在追踪：<b>{{ activeDrilldown }}</b></span><el-button text size="small" @click="clearDrilldown">退出追踪</el-button></div>

      <div class="logs-table-shell">
        <el-table v-loading="loading" :data="items" size="small" @row-click="openDetail">
          <template #empty><el-empty :description="stats?.config.enabled ? '当前筛选条件下没有日志' : '日志已关闭，当前没有记录'" :image-size="54" /></template>
          <el-table-column label="时间" width="164"><template #default="{ row }"><span class="tnum">{{ formatTime(row.createdAt) }}</span></template></el-table-column>
          <el-table-column label="等级" width="78"><template #default="{ row }"><el-tag :type="levelTag(row.level)" size="small">{{ levelLabels[row.level] }}</el-tag></template></el-table-column>
          <el-table-column label="来源" width="108"><template #default="{ row }"><span>{{ row.service }}</span><small class="cell-sub">{{ categoryLabels[row.category] }}</small></template></el-table-column>
          <el-table-column label="事件与结果" min-width="280" show-overflow-tooltip><template #default="{ row }"><strong class="event-name">{{ row.event }}</strong><small class="event-message">{{ row.message }}</small></template></el-table-column>
          <el-table-column label="上下文" min-width="180" show-overflow-tooltip><template #default="{ row }"><span class="context-main">{{ row.metadata?.model || row.metadata?.route || '-' }}</span><small class="cell-sub">{{ row.metadata?.providerDisplayName || row.metadata?.provider || row.metadata?.taskType || row.metadata?.errorCode || '' }}</small></template></el-table-column>
          <el-table-column label="任务/请求" width="122"><template #default="{ row }"><button v-if="row.taskId" class="id-link" @click.stop="drillTask(row.taskId)">{{ shortId(row.taskId) }}</button><button v-else-if="row.requestId" class="id-link" @click.stop="drillRequest(row.requestId)">{{ shortId(row.requestId) }}</button><span v-else>-</span></template></el-table-column>
          <el-table-column label="状态" width="72" align="right"><template #default="{ row }"><span class="tnum">{{ row.statusCode || row.metadata?.taskStatus || '-' }}</span></template></el-table-column>
          <el-table-column label="耗时" width="96" align="right"><template #default="{ row }"><span class="tnum" :class="{ 'duration-slow': (row.durationMs || 0) >= 2000 }">{{ row.durationMs == null ? '-' : formatDuration(row.durationMs) }}</span></template></el-table-column>
        </el-table>
      </div>
      <footer class="logs-footer"><span>当前显示 {{ items.length }} 条 · 数据库物理占用 {{ formatBytes(stats?.capacity.physicalBytes) }}</span><el-button v-if="hasMore" :loading="loading" @click="load(false)">加载更多</el-button></footer>
    </PageCard>

    <el-drawer v-model="detailOpen" title="诊断详情" size="min(680px, 96vw)" append-to-body>
      <div v-if="selected" class="log-detail">
        <div class="detail-summary" :class="`is-${selected.level}`"><span>{{ levelLabels[selected.level] }} · {{ categoryLabels[selected.category] }}日志</span><strong>{{ selected.event }}</strong><p>{{ selected.message }}</p></div>
        <div class="detail-actions"><el-button v-if="selected.taskId" size="small" @click="drillTask(selected.taskId)">追踪该任务</el-button><el-button v-if="selected.requestId" size="small" @click="drillRequest(selected.requestId)">追踪该请求</el-button><el-button v-if="selected.metadata?.route" size="small" @click="drillRoute(String(selected.metadata.route))">查看该路由</el-button></div>
        <dl class="identity-grid">
          <div><dt>时间</dt><dd>{{ formatTime(selected.createdAt) }}</dd></div><div><dt>服务</dt><dd>{{ selected.service }}</dd></div>
          <div v-if="selected.statusCode != null"><dt>HTTP 状态</dt><dd>{{ selected.statusCode }}</dd></div><div v-if="selected.durationMs != null"><dt>耗时</dt><dd>{{ formatDuration(selected.durationMs) }}</dd></div>
          <div v-if="selected.taskId" class="is-wide"><dt>任务 ID</dt><dd class="mono">{{ selected.taskId }}</dd></div><div v-if="selected.requestId" class="is-wide"><dt>请求 ID</dt><dd class="mono">{{ selected.requestId }}</dd></div>
          <div v-if="selected.userId"><dt>用户</dt><dd class="mono">{{ selected.userId }}</dd></div><div v-if="selected.adminId"><dt>管理员</dt><dd class="mono">{{ selected.adminId }}</dd></div><div v-if="selected.clientIp"><dt>来源 IP</dt><dd class="mono">{{ selected.clientIp }}</dd></div><div><dt>记录大小</dt><dd>{{ formatBytes(selected.sizeBytes) }}</dd></div>
        </dl>
        <section class="diagnostic-fields"><header><strong>诊断上下文</strong><small>任务信息由当前数据库状态自动关联，不包含提示词或密钥</small></header><div v-if="diagnosticEntries.length"><article v-for="item in diagnosticEntries" :key="item.key"><span>{{ item.label }}</span><strong :class="{ mono: item.key.toLowerCase().includes('id') || item.key === 'route' }">{{ item.value }}</strong></article></div><el-empty v-else description="没有附加诊断字段" :image-size="42" /></section>
        <details><summary>查看原始脱敏字段</summary><pre>{{ JSON.stringify(selected.metadata || {}, null, 2) }}</pre></details>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.platform-logs-page { height: 100%; min-height: 0; overflow: auto; }
.platform-logs-page :deep(.page-card__body) { display: grid; gap: 12px; }
.logs-head, .logs-head__actions, .runtime-strip, .runtime-state, .runtime-category, .log-toolbar, .logs-footer, .detail-actions { display: flex; align-items: center; }
.logs-head { justify-content: space-between; gap: 16px; }
.logs-head > div:first-child, .runtime-state span, .observability-grid header > div { display: grid; gap: 2px; }
.logs-head strong { color: var(--ink); font-size: 16px; }
.logs-head small, .observability-grid header small, .diagnostic-panel header small { color: var(--ink-3); font-size: 11px; }
.logs-head__actions { gap: 8px; }.range-select { width: 118px; }
.runtime-strip { min-height: 54px; gap: 16px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); }
.runtime-state { gap: 9px; min-width: 190px; }.runtime-state > i, .runtime-category i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--ink-3); }.runtime-state > i, .runtime-category i.is-on { background: var(--success); }.runtime-strip.is-off .runtime-state > i { background: var(--ink-3); }
.runtime-state strong { color: var(--ink); font-size: 12px; }.runtime-state small, .runtime-category, .runtime-capacity small { color: var(--ink-3); font-size: 10px; }.runtime-category { gap: 6px; white-space: nowrap; }
.runtime-capacity { display: flex; align-items: center; gap: 8px; margin-left: auto; }.runtime-capacity > span { width: 110px; height: 6px; overflow: hidden; border-radius: 3px; background: var(--surface-3); }.runtime-capacity > span i { display: block; height: 100%; background: var(--accent); }
.live-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); }.live-grid article { min-width: 0; padding: 5px 8px; border-right: 1px solid var(--border); }.live-grid article:last-child { border-right: 0; }.live-grid span, .live-grid small, .live-grid strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.live-grid span, .live-grid small { color: var(--ink-3); font-size: 9px; }.live-grid strong { margin: 4px 0 2px; color: var(--ink); font-size: 12px; }.live-grid article.is-danger strong { color: var(--danger); }.live-grid article.is-warning strong { color: var(--warning); }
.metric-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }.metric-grid article { min-width: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }.metric-grid span, .metric-grid small { display: block; color: var(--ink-3); font-size: 10px; }.metric-grid strong { display: block; margin: 5px 0 3px; overflow: hidden; color: var(--ink); font-size: 20px; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }.metric-grid article.is-danger { border-color: color-mix(in srgb, var(--danger) 34%, var(--border)); }.metric-grid article.is-danger strong { color: var(--danger); }.metric-grid article.is-warning strong { color: var(--warning); }
.observability-grid, .diagnostic-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, .8fr); gap: 10px; }.diagnostic-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.trend-panel, .rank-panel, .diagnostic-panel { min-width: 0; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }.observability-grid header, .diagnostic-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; }.observability-grid header strong, .diagnostic-panel header strong { color: var(--ink); font-size: 12px; }.panel-icon { width: 16px; color: var(--ink-3); }
.rank-list, .compact-list { display: grid; gap: 3px; max-height: 238px; overflow: auto; }.rank-list button, .compact-list button { display: flex; align-items: center; width: 100%; min-height: 43px; padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; }.rank-list button:hover, .compact-list button:hover { background: var(--surface-2); }.rank-list button > span, .compact-list button > span { min-width: 0; flex: 1; }.rank-list b, .rank-list small, .compact-list b, .compact-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.rank-list b, .compact-list b { color: var(--ink-2); font-size: 11px; }.rank-list small, .compact-list small { margin-top: 3px; color: var(--ink-3); font-size: 9px; }.rank-list em, .compact-list em { margin-left: 8px; color: var(--ink-2); font-size: 10px; font-style: normal; white-space: nowrap; }.rank-list em.is-error { color: var(--danger); }.rank-list em.is-warning { color: var(--warning); }
.log-toolbar { flex-wrap: wrap; gap: 7px; padding-top: 2px; }.filter-short { width: 118px; }.filter-id { width: 180px; }.filter-search { width: 190px; }.toolbar-spacer { flex: 1; }.drilldown-bar { display: flex; align-items: center; justify-content: space-between; min-height: 34px; padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 5px; background: var(--accent-soft); color: var(--accent-ink); font-size: 11px; }.drilldown-bar b { overflow-wrap: anywhere; }
.logs-table-shell { min-height: 360px; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; }.logs-table-shell :deep(.el-table__row) { cursor: pointer; }.event-name, .event-message, .cell-sub, .context-main { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.event-name, .context-main { color: var(--ink); font-size: 11px; }.event-message, .cell-sub { margin-top: 2px; color: var(--ink-3); font-size: 9px; font-weight: 400; }.id-link { padding: 0; border: 0; background: transparent; color: var(--accent-ink); font: 10px ui-monospace, monospace; cursor: pointer; }.duration-slow { color: var(--warning); font-weight: 650; }.logs-footer { justify-content: space-between; min-height: 28px; color: var(--ink-3); font-size: 10px; }
.log-detail { display: grid; gap: 16px; }.detail-summary { padding: 12px 14px; border-left: 3px solid var(--success); background: var(--surface-2); }.detail-summary.is-warning { border-left-color: var(--warning); }.detail-summary.is-error { border-left-color: var(--danger); }.detail-summary span { color: var(--ink-3); font-size: 10px; }.detail-summary strong { display: block; margin-top: 5px; color: var(--ink); font: 12px ui-monospace, monospace; }.detail-summary p { margin: 6px 0 0; color: var(--ink-2); font-size: 12px; }.detail-actions { gap: 8px; }
.identity-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }.identity-grid > div { min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 5px; }.identity-grid .is-wide { grid-column: 1 / -1; }.identity-grid dt { color: var(--ink-3); font-size: 9px; }.identity-grid dd { margin: 4px 0 0; overflow-wrap: anywhere; color: var(--ink); font-size: 11px; }
.diagnostic-fields { display: grid; gap: 8px; }.diagnostic-fields > header { display: grid; gap: 2px; }.diagnostic-fields > header strong { color: var(--ink); font-size: 12px; }.diagnostic-fields > header small { color: var(--ink-3); font-size: 10px; }.diagnostic-fields > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }.diagnostic-fields article { min-width: 0; padding: 8px 10px; border-bottom: 1px solid var(--border); }.diagnostic-fields article span, .diagnostic-fields article strong { display: block; overflow-wrap: anywhere; }.diagnostic-fields article span { color: var(--ink-3); font-size: 9px; }.diagnostic-fields article strong { margin-top: 4px; color: var(--ink-2); font-size: 11px; font-weight: 600; }.log-detail details { border-top: 1px solid var(--border); }.log-detail summary { padding: 10px 0; color: var(--ink-3); font-size: 10px; cursor: pointer; }.log-detail pre { max-height: 320px; margin: 0; padding: 12px; overflow: auto; border-radius: 5px; background: var(--surface-2); color: var(--ink-2); font: 10px/1.6 ui-monospace, monospace; }.mono { font-family: ui-monospace, monospace; }
@media (max-width: 1180px) { .live-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.live-grid article { border-right: 0; } .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .observability-grid { grid-template-columns: 1fr; } }
@media (max-width: 820px) { .runtime-strip { align-items: flex-start; flex-wrap: wrap; } .runtime-capacity { width: 100%; margin-left: 0; } .diagnostic-grid { grid-template-columns: 1fr; } .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .toolbar-spacer { display: none; } .identity-grid, .diagnostic-fields > div { grid-template-columns: 1fr; } }
</style>
