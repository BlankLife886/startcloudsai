<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageCard from '@/components/PageCard.vue'
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

const rangeOptions = [
  { label: '近 24 小时', value: '24h' },
  { label: '近 7 日', value: '7d' },
  { label: '近 30 日', value: '30d' },
  { label: '全部', value: 'all' },
]

const categoryTabs = [
  { value: '', label: '全部' },
  { value: 'security', label: '安全' },
  { value: 'operations', label: '运维' },
  { value: 'user', label: '用户' },
]

const summary = computed(() => stats.value?.overview.summary ?? emptySummary)
const errorRate = computed(() => summary.value.count > 0 ? (summary.value.errorCount * 100) / summary.value.count : 0)
const categoryEnabled = computed(() => ({
  security: stats.value?.config.securityEnabled ?? false,
  operations: stats.value?.config.operationsEnabled ?? false,
  user: stats.value?.config.userEnabled ?? false,
}))
const activeDrilldown = computed(() => filters.taskId || filters.requestId || filters.route || '')
const rangeLabel = computed(() => rangeOptions.find((item) => item.value === filters.range)?.label || '近 24 小时')
const categoryCount = computed(() => {
  const byCategory = stats.value?.capacity.byCategory ?? {}
  return {
    '': stats.value?.capacity.count ?? 0,
    security: byCategory.security || 0,
    operations: byCategory.operations || 0,
    user: byCategory.user || 0,
  } as Record<string, number>
})

function setCategory(value: string) {
  filters.category = value
  void load(true)
}

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
  <div class="page logs-page">
    <PageCard>
      <template #actions>
        <el-segmented v-model="filters.range" :options="rangeOptions" @change="changeRange" />
          <el-button :icon="Setting" @click="openSettings">设置</el-button>
          <el-button :icon="Refresh" :loading="loading || statsLoading" @click="refreshAll">刷新</el-button>
      </template>

      <section class="logs-kpis" aria-label="日志摘要">
        <article>
          <small>事件总量</small>
          <strong class="tnum">{{ summary.count.toLocaleString("zh-CN") }}</strong>
        </article>
        <article :class="{ 'is-bad': summary.errorCount > 0 }">
          <small>错误</small>
          <strong class="tnum">{{ summary.errorCount }}</strong>
        </article>
        <article :class="{ 'is-warn': summary.warningCount > 0 }">
          <small>警告</small>
          <strong class="tnum">{{ summary.warningCount }}</strong>
        </article>
        <article>
          <small>慢事件</small>
          <strong class="tnum">{{ summary.slowCount }}</strong>
        </article>
        <article>
          <small>平均耗时</small>
          <strong class="tnum">{{ formatDuration(summary.averageDurationMs) }}</strong>
        </article>
        <article :class="{ 'is-warn': summary.p95DurationMs >= 2000 }">
          <small>P95 耗时</small>
          <strong class="tnum">{{ formatDuration(summary.p95DurationMs) }}</strong>
        </article>
      </section>

      <section v-if="systemMetrics" class="logs-live" aria-label="实时压力">
        <article>
          <small>API 流量</small>
          <strong class="tnum">{{ systemMetrics.http.requestsPerSecond.toFixed(2) }} req/s</strong>
        </article>
        <article :class="{ 'is-bad': systemMetrics.http.status5xx > 0 }">
          <small>HTTP 5xx</small>
          <strong class="tnum">{{ systemMetrics.http.status5xx }}</strong>
        </article>
        <article :class="{ 'is-warn': systemMetrics.taskPressure.queued > 0 }">
          <small>任务压力</small>
          <strong class="tnum">{{ systemMetrics.taskPressure.queued }} / {{ systemMetrics.taskPressure.running }}</strong>
        </article>
        <article :class="{ 'is-warn': systemMetrics.database.utilizationPercent >= 80 }">
          <small>数据库连接</small>
          <strong class="tnum">{{ systemMetrics.database.acquiredConnections }} / {{ systemMetrics.database.maxConnections }}</strong>
        </article>
        <article :class="{ 'is-warn': systemMetrics.imageFetch.forecastPressure }">
          <small>图片拉回</small>
          <strong class="tnum">{{ systemMetrics.imageFetch.active }} / {{ systemMetrics.imageFetch.effectiveLimit }}</strong>
        </article>
      </section>

      <p class="logs-legend">
        {{ rangeLabel }}
        共
        <em class="tnum">{{ summary.count.toLocaleString("zh-CN") }}</em>
        条，错误率
        <em class="tnum">{{ errorRate.toFixed(1) }}%</em>
        ，覆盖
        <em class="tnum">{{ summary.distinctRequests }}</em>
        条请求 /
        <em class="tnum">{{ summary.distinctTasks }}</em>
        个任务。
        <template v-if="stats">
          {{ stats.config.enabled ? `采集中 · 保留 ${stats.config.retentionDays} 天` : "日志已关闭" }}
          · 占用
          <em>{{ formatBytes(stats.capacity.logicalBytes) }}</em>
          /
          {{ formatBytes(stats.maxBytes) }}。
          安全{{ categoryEnabled.security ? "开" : "关" }}
          · 运维{{ categoryEnabled.operations ? "开" : "关" }}
          · 用户{{ categoryEnabled.user ? "开" : "关" }}。
        </template>
        每 30 秒刷新。
      </p>

      <section class="logs-panels">
        <article class="logs-panel is-trend">
          <header>
            <strong>事件与耗时趋势</strong>
            <small>判断错误是否集中爆发</small>
          </header>
          <EChart v-if="stats?.overview.trend.length" :option="trendOption" height="228px" />
          <el-empty v-else description="当前周期没有趋势数据" :image-size="46" />
        </article>
        <article class="logs-panel is-rank">
          <header>
            <strong>异常事件排行</strong>
            <small>按错误、警告和次数排序</small>
          </header>
          <div v-if="stats?.overview.topEvents.length" class="logs-list">
            <button
              v-for="item in stats.overview.topEvents"
              :key="`${item.category}:${item.event}`"
              type="button"
              @click="drillEvent(item.event)"
            >
              <span>
                <b>{{ item.event }}</b>
                <small>{{ categoryLabels[item.category] }} · {{ formatTime(item.lastAt) }}</small>
              </span>
              <em v-if="item.errorCount" class="is-bad">{{ item.errorCount }} 错误</em>
              <em v-else-if="item.warningCount" class="is-warn">{{ item.warningCount }} 警告</em>
              <em v-else class="tnum">{{ item.count }} 次</em>
            </button>
          </div>
          <el-empty v-else description="当前周期没有异常事件" :image-size="46" />
        </article>
        <article class="logs-panel is-slow">
          <header>
            <strong>最慢接口</strong>
            <small>按 P95 耗时排序</small>
          </header>
          <div v-if="stats?.overview.slowRoutes.length" class="logs-list">
            <button
              v-for="item in stats.overview.slowRoutes"
              :key="`${item.service}:${item.route}`"
              type="button"
              @click="drillRoute(item.route)"
            >
              <span>
                <b>{{ item.route }}</b>
                <small>{{ item.service }} · {{ item.count }} 次 · {{ item.errorCount }} 错误</small>
              </span>
              <em class="tnum">{{ formatDuration(item.p95DurationMs) }}</em>
            </button>
          </div>
          <el-empty v-else description="暂无接口耗时数据" :image-size="42" />
        </article>
        <article class="logs-panel is-tasks">
          <header>
            <strong>异常任务</strong>
            <small>点击追踪完整时间线</small>
          </header>
          <div v-if="stats?.overview.taskIssues.length" class="logs-list">
            <button
              v-for="item in stats.overview.taskIssues"
              :key="item.taskId"
              type="button"
              @click="drillTask(item.taskId)"
            >
              <span>
                <b>{{ item.taskType || item.objectType }} · {{ shortId(item.taskId) }}</b>
                <small>{{ item.errorMessage || item.lastMessage }}<template v-if="item.model"> · {{ item.model }}</template></small>
              </span>
              <em class="tnum">{{ item.issueCount }} 条</em>
            </button>
          </div>
          <el-empty v-else description="当前周期没有异常任务" :image-size="42" />
        </article>
      </section>

      <div class="logs-toolbar">
        <div class="logs-tabs" role="tablist" aria-label="日志分类">
          <button
            v-for="tab in categoryTabs"
            :key="tab.value || 'all'"
            type="button"
            role="tab"
            class="logs-tab"
            :class="{ 'is-active': filters.category === tab.value }"
            :aria-selected="filters.category === tab.value"
            @click="setCategory(tab.value)"
          >
            {{ tab.label }}
            <em class="tnum">{{ categoryCount[tab.value] }}</em>
          </button>
        </div>
        <div class="logs-toolbar__right">
          <el-select v-model="filters.level" clearable placeholder="全部等级" @change="load(true)">
            <el-option label="正常" value="info" />
            <el-option label="警告" value="warning" />
            <el-option label="错误" value="error" />
        </el-select>
          <el-select v-model="filters.service" clearable placeholder="全部服务" @change="load(true)">
            <el-option label="API" value="api" />
            <el-option label="Worker" value="worker" />
        </el-select>
          <el-input v-model="filters.taskId" clearable placeholder="任务 ID" @keyup.enter="load(true)" />
          <el-input v-model="filters.requestId" clearable placeholder="请求 ID" @keyup.enter="load(true)" />
          <el-input v-model="filters.search" clearable placeholder="事件或描述" :prefix-icon="Search" @keyup.enter="load(true)" />
          <el-button @click="load(true)">查询</el-button>
          <el-button text @click="resetFilters">重置</el-button>
        <el-button :loading="actionLoading" @click="cleanupNow">按策略清理</el-button>
        <el-button type="danger" plain :icon="Delete" :loading="actionLoading" @click="clearLogs">清空</el-button>
        </div>
      </div>

      <div v-if="activeDrilldown" class="logs-drill">
        <span>正在追踪 <em>{{ activeDrilldown }}</em></span>
        <el-button text size="small" @click="clearDrilldown">退出追踪</el-button>
      </div>

      <div class="logs-board">
        <el-table v-loading="loading" class="logs-table" :data="items" height="100%" size="small" @row-click="openDetail">
          <template #empty>
            <el-empty :description="stats?.config.enabled ? '当前筛选条件下没有日志' : '日志已关闭，当前没有记录'" :image-size="54" />
          </template>
          <el-table-column label="时间" width="164">
            <template #default="{ row }"><span class="tnum">{{ formatTime(row.createdAt) }}</span></template>
          </el-table-column>
          <el-table-column label="等级" width="78">
            <template #default="{ row }">
              <el-tag :type="levelTag(row.level)" size="small">{{ levelLabels[row.level] }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="108">
            <template #default="{ row }">
              <span class="cell-main">{{ row.service }}</span>
              <small class="cell-sub">{{ categoryLabels[row.category] }}</small>
            </template>
          </el-table-column>
          <el-table-column label="事件与结果" min-width="280" show-overflow-tooltip>
            <template #default="{ row }">
              <strong class="cell-main">{{ row.event }}</strong>
              <small class="cell-sub">{{ row.message }}</small>
            </template>
          </el-table-column>
          <el-table-column label="上下文" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cell-main">{{ row.metadata?.model || row.metadata?.route || "—" }}</span>
              <small class="cell-sub">{{ row.metadata?.providerDisplayName || row.metadata?.provider || row.metadata?.taskType || row.metadata?.errorCode || "" }}</small>
            </template>
          </el-table-column>
          <el-table-column label="任务/请求" width="122">
            <template #default="{ row }">
              <button v-if="row.taskId" type="button" class="id-link" @click.stop="drillTask(row.taskId)">{{ shortId(row.taskId) }}</button>
              <button v-else-if="row.requestId" type="button" class="id-link" @click.stop="drillRequest(row.requestId)">{{ shortId(row.requestId) }}</button>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="72" align="right">
            <template #default="{ row }"><span class="tnum">{{ row.statusCode || row.metadata?.taskStatus || "—" }}</span></template>
          </el-table-column>
          <el-table-column label="耗时" width="96" align="right">
            <template #default="{ row }">
              <span class="tnum" :class="{ 'is-warn': (row.durationMs || 0) >= 2000 }">{{ row.durationMs == null ? "—" : formatDuration(row.durationMs) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <footer class="logs-footer">
          <span>当前显示 {{ items.length }} 条 · 数据库物理占用 {{ formatBytes(stats?.capacity.physicalBytes) }}</span>
          <el-button v-if="hasMore" :loading="loading" @click="load(false)">加载更多</el-button>
        </footer>
      </div>
    </PageCard>

    <el-drawer v-model="detailOpen" title="诊断详情" size="min(680px, 96vw)" append-to-body>
      <div v-if="selected" class="log-detail">
        <div class="log-detail__head" :class="`is-${selected.level}`">
          <small>{{ levelLabels[selected.level] }} · {{ categoryLabels[selected.category] }}日志</small>
          <strong>{{ selected.event }}</strong>
          <p>{{ selected.message }}</p>
        </div>
        <div class="log-detail__actions">
          <el-button v-if="selected.taskId" size="small" @click="drillTask(selected.taskId)">追踪该任务</el-button>
          <el-button v-if="selected.requestId" size="small" @click="drillRequest(selected.requestId)">追踪该请求</el-button>
          <el-button v-if="selected.metadata?.route" size="small" @click="drillRoute(String(selected.metadata.route))">查看该路由</el-button>
        </div>
        <dl class="log-detail__grid">
          <div><dt>时间</dt><dd>{{ formatTime(selected.createdAt) }}</dd></div>
          <div><dt>服务</dt><dd>{{ selected.service }}</dd></div>
          <div v-if="selected.statusCode != null"><dt>HTTP 状态</dt><dd>{{ selected.statusCode }}</dd></div>
          <div v-if="selected.durationMs != null"><dt>耗时</dt><dd>{{ formatDuration(selected.durationMs) }}</dd></div>
          <div v-if="selected.taskId" class="is-wide"><dt>任务 ID</dt><dd class="mono">{{ selected.taskId }}</dd></div>
          <div v-if="selected.requestId" class="is-wide"><dt>请求 ID</dt><dd class="mono">{{ selected.requestId }}</dd></div>
          <div v-if="selected.userId"><dt>用户</dt><dd class="mono">{{ selected.userId }}</dd></div>
          <div v-if="selected.adminId"><dt>管理员</dt><dd class="mono">{{ selected.adminId }}</dd></div>
          <div v-if="selected.clientIp"><dt>来源 IP</dt><dd class="mono">{{ selected.clientIp }}</dd></div>
          <div><dt>记录大小</dt><dd>{{ formatBytes(selected.sizeBytes) }}</dd></div>
        </dl>
        <section class="log-detail__fields">
          <header>
            <strong>诊断上下文</strong>
            <small>由当前数据库状态自动关联，不含提示词或密钥</small>
          </header>
          <div v-if="diagnosticEntries.length">
            <article v-for="item in diagnosticEntries" :key="item.key">
              <span>{{ item.label }}</span>
              <strong :class="{ mono: item.key.toLowerCase().includes('id') || item.key === 'route' }">{{ item.value }}</strong>
            </article>
          </div>
          <el-empty v-else description="没有附加诊断字段" :image-size="42" />
        </section>
        <details>
          <summary>查看原始脱敏字段</summary>
          <pre>{{ JSON.stringify(selected.metadata || {}, null, 2) }}</pre>
        </details>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  overflow: auto;
}
.logs-page :deep(.page-card) {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-height: 100%;
}
.logs-page :deep(.page-card__header) {
  flex-wrap: wrap;
  align-items: flex-start;
}
.logs-page :deep(.page-card__actions) {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.logs-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
}
.logs-kpis,
.logs-live {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.logs-kpis {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.logs-live {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.logs-kpis article,
.logs-live article {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
}
.logs-live article {
  padding: 12px 14px;
}
.logs-kpis article:last-child,
.logs-live article:last-child {
  border-right: 0;
}
.logs-kpis small,
.logs-live small {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
}
.logs-kpis strong,
.logs-live strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.logs-live strong {
  font-size: 18px;
}
.logs-kpis article.is-bad strong,
.logs-live article.is-bad strong,
.logs-list em.is-bad {
  color: var(--danger);
}
.logs-kpis article.is-warn strong,
.logs-live article.is-warn strong,
.logs-list em.is-warn,
.tnum.is-warn {
  color: var(--warning);
}
.logs-legend {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.5;
}
.logs-legend em {
  margin: 0 2px;
  color: var(--ink);
  font-style: normal;
  font-weight: 750;
}
.logs-panels {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  grid-template-areas:
    "trend rank"
    "slow tasks";
  gap: 10px;
}
.logs-panel.is-trend { grid-area: trend; }
.logs-panel.is-rank { grid-area: rank; }
.logs-panel.is-slow { grid-area: slow; }
.logs-panel.is-tasks { grid-area: tasks; }
.logs-panel {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.logs-panel header {
  display: grid;
  gap: 2px;
  margin-bottom: 10px;
}
.logs-panel header strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}
.logs-panel header small {
  color: var(--ink-3);
  font-size: 12px;
}
.logs-list {
  display: grid;
  gap: 4px;
  max-height: 228px;
  overflow: auto;
}
.logs-list button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 46px;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.logs-list button:hover {
  background: var(--surface-2);
}
.logs-list button > span {
  min-width: 0;
  flex: 1;
}
.logs-list b,
.logs-list small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.logs-list b {
  color: var(--ink);
  font-size: 13px;
}
.logs-list small {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 12px;
}
.logs-list em {
  margin-left: 8px;
  color: var(--ink-2);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
}
.logs-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.logs-tabs {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  scrollbar-width: none;
}
.logs-tabs::-webkit-scrollbar {
  display: none;
}
.logs-tab {
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
.logs-tab em {
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.logs-tab.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
}
.logs-tab.is-active em {
  color: color-mix(in srgb, var(--accent-on) 72%, transparent);
}
.logs-toolbar__right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.logs-toolbar__right :deep(.el-select),
.logs-toolbar__right :deep(.el-input) {
  width: 132px;
}
.logs-toolbar__right :deep(.el-input.filter-wide),
.logs-toolbar__right :deep(.el-input:last-of-type) {
  width: 180px;
}
.logs-drill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: var(--radius-control);
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 13px;
}
.logs-drill em {
  font-style: normal;
  font-weight: 750;
  overflow-wrap: anywhere;
}
.logs-board {
  display: grid;
  min-height: 420px;
  flex: 1;
  grid-template-rows: minmax(320px, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.logs-table :deep(.el-table__row) {
  cursor: pointer;
}
.cell-main,
.cell-sub {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-main {
  color: var(--ink);
  font-size: 13px;
}
.cell-sub {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 400;
}
.id-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-ink);
  font: 12px ui-monospace, monospace;
  cursor: pointer;
}
.logs-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 8px 18px;
  border-top: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 12px;
  background: var(--surface);
}
.log-detail {
  display: grid;
  gap: 16px;
}
.log-detail__head {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--success);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.log-detail__head.is-warning {
  border-left-color: var(--warning);
}
.log-detail__head.is-error {
  border-left-color: var(--danger);
}
.log-detail__head small {
  color: var(--ink-3);
  font-size: 12px;
}
.log-detail__head strong {
  display: block;
  margin-top: 6px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 650;
}
.log-detail__head p {
  margin: 8px 0 0;
  color: var(--ink-2);
  font-size: 13px;
}
.log-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.log-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.log-detail__grid > div {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.log-detail__grid .is-wide {
  grid-column: 1 / -1;
}
.log-detail__grid dt {
  color: var(--ink-3);
  font-size: 12px;
}
.log-detail__grid dd {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 13px;
}
.log-detail__fields {
  display: grid;
  gap: 8px;
}
.log-detail__fields > header {
  display: grid;
  gap: 2px;
}
.log-detail__fields > header strong {
  color: var(--ink);
  font-size: 13px;
}
.log-detail__fields > header small {
  color: var(--ink-3);
  font-size: 12px;
}
.log-detail__fields > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.log-detail__fields article {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-2);
}
.log-detail__fields article span,
.log-detail__fields article strong {
  display: block;
  overflow-wrap: anywhere;
}
.log-detail__fields article span {
  color: var(--ink-3);
  font-size: 12px;
}
.log-detail__fields article strong {
  margin-top: 4px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}
.log-detail details {
  border-top: 1px solid var(--border);
}
.log-detail summary {
  padding: 10px 0;
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
}
.log-detail pre {
  max-height: 320px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--ink-2);
  font: 12px/1.6 ui-monospace, monospace;
}
.mono {
  font-family: ui-monospace, monospace;
}
@media (max-width: 1280px) {
  .logs-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .logs-kpis article:nth-child(3) {
    border-right: 0;
  }
  .logs-kpis article:nth-child(n + 4) {
    border-top: 1px solid var(--border);
  }
  .logs-live {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .logs-live article:nth-child(3) {
    border-right: 0;
  }
  .logs-live article:nth-child(n + 4) {
    border-top: 1px solid var(--border);
  }
  .logs-panels {
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      "trend trend"
      "rank rank"
      "slow tasks";
  }
}
@media (max-width: 860px) {
  .logs-kpis,
  .logs-live,
  .logs-panels,
  .log-detail__grid,
  .log-detail__fields > div {
    grid-template-columns: 1fr;
  }
  .logs-panels {
    grid-template-areas:
      "trend"
      "rank"
      "slow"
      "tasks";
  }
  .logs-kpis article,
  .logs-live article {
    border-right: 0;
    border-top: 1px solid var(--border);
  }
  .logs-kpis article:first-child,
  .logs-live article:first-child {
    border-top: 0;
  }
  .logs-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
