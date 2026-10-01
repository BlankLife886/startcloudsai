<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck, FullScreen, Money, Refresh, TrendCharts, User, Wallet } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase } from '@/chartTheme'
import { isDark } from '@/theme'
import { request, isRequestAborted } from '@/request'
import { formatTime } from '@/utils'
import { formatProfileMoney, lifecycleLabels, profileTagLabels, workspaceLabels } from '@/userProfile'
import type { UserAnalyticsData, WatchUser } from '@/userAnalytics'

/**
 * 用户画像：跟随后台明暗主题，不另铺背景。
 * 自上而下：核心指标 → 活跃趋势 + 生命周期 → 风险 / 价值 / 留存 → 重点用户 + 热门业务。
 * 每个面板标题下一句结论；图表颜色取自主题令牌。
 */

const screen = ref<HTMLElement | null>(null)
const router = useRouter()
const data = ref<UserAnalyticsData | null>(null)
const loading = ref(false)
const error = ref('')
const fullscreen = ref(false)
const refreshSeconds = ref(0)
const refreshOptions = [0, 30, 60, 120]
let timer: ReturnType<typeof setInterval> | undefined
let controller: AbortController | null = null

const number = (value: number) => (Number(value) || 0).toLocaleString('zh-CN')
const pct = (value: number, base: number, digits = 1) => (base > 0 ? `${((value / base) * 100).toFixed(digits)}%` : '—')
const money = formatProfileMoney
const lifecycleLabel = (key: string) => lifecycleLabels[key] || (key === 'pending' ? '待计算' : key)
const tagLabel = (key: string) => profileTagLabels[key] || key
const riskLabels: Record<string, string> = { high: '高风险', medium: '需关注', low: '正常', pending: '待计算' }
const valueLabels: Record<string, string> = { high: '高价值', standard: '普通付费', loss_making: '亏损', none: '未付费', pending: '待计算' }

// 模板里用 CSS 变量，图表里需要解析成实际颜色
const LIFECYCLE_ORDER = ['new', 'activated', 'active', 'returned', 'dormant', 'churn_risk', 'pending']
const LIFECYCLE_COLORS: Record<string, string> = {
  new: 'var(--info)', activated: '#22d3ee', active: 'var(--accent)', returned: 'var(--violet)',
  dormant: '#94a3b8', churn_risk: '#fb923c', pending: 'var(--surface-3)',
}
const RISK_COLORS: Record<string, string> = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)', pending: 'var(--surface-3)' }
const TIER_COLORS: Record<string, string> = { high: 'var(--violet)', standard: 'var(--info)', loss_making: 'var(--danger)', none: '#94a3b8' }

function resolve(color: string) {
  if (!color.startsWith('var(')) return color
  return getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1)).trim() || '#94a3b8'
}
/** 主题相关颜色，切换明暗时重新计算 */
const palette = computed(() => {
  void isDark.value
  return {
    accent: resolve('var(--accent)'), info: resolve('var(--info)'), violet: resolve('var(--violet)'),
    success: resolve('var(--success)'), warning: resolve('var(--warning)'), danger: resolve('var(--danger)'),
  }
})

// ---------- 核心指标 ----------
function diffText(current: number, previous: number, period: string) {
  const diff = current - previous
  if (!diff) return { text: `与${period}持平`, dir: 'flat' }
  return { text: `比${period}${diff > 0 ? '多' : '少'} ${number(Math.abs(diff))}`, dir: diff > 0 ? 'up' : 'down' }
}

/** 迷你走势：返回平滑曲线与面积的 SVG path */
function sparkPath(values: number[], width = 96, height = 30) {
  if (values.length < 2) return { line: '', area: '' }
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)])
  let line = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const mx = (x0 + x1) / 2
    line += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
  }
  return { line, area: `${line} L${width},${height} L0,${height} Z` }
}

const kpis = computed(() => {
  const d = data.value
  if (!d) return []
  const s = d.summary
  const c = d.comparison
  const trend = d.dailyTrend
  const runs = c ? c.succeededRuns30 + c.failedRuns30 : 0
  return [
    { key: 'total', label: '用户总数', icon: User, tone: 'info', value: number(s.totalUsers), sub: `30 天新注册 ${number(s.newUsers30)}`, diff: c ? diffText(s.newUsers30, c.newUsersPrev30, '前 30 天') : null, spark: sparkPath(trend.map(p => p.newUsers)) },
    { key: 'active', label: '近 7 天活跃', icon: TrendCharts, tone: 'accent', value: number(s.activeUsers7), sub: `活跃率 ${pct(s.activeUsers7, s.totalUsers, 0)}`, diff: c ? diffText(c.activeUsers7, c.activeUsersPrev7, '上周') : null, spark: sparkPath(trend.map(p => p.activeUsers)) },
    { key: 'paying', label: '近 30 天付费', icon: Wallet, tone: 'violet', value: c ? number(c.payingUsers30) : '—', sub: c ? `付费率 ${pct(c.payingUsers30, s.activeUsers30, 0)}` : '', diff: null, spark: null },
    { key: 'revenue', label: '近 30 天收入', icon: Money, tone: c && c.grossProfitCents30 < 0 ? 'danger' : 'warning', value: c ? money(c.revenueCents30) : '—', sub: c ? `毛利 ${money(c.grossProfitCents30)} · ${pct(c.grossProfitCents30, c.revenueCents30, 0)}` : '', diff: null, spark: null },
    { key: 'success', label: '创作成功率', icon: CircleCheck, tone: runs && c && c.failedRuns30 / runs > 0.1 ? 'warning' : 'success', value: runs && c ? pct(c.succeededRuns30, runs) : '—', sub: runs && c ? `${number(runs)} 次 · 失败 ${number(c.failedRuns30)}` : '近 30 天暂无创作', diff: null, spark: null, ring: runs && c ? c.succeededRuns30 / runs : null },
  ]
})

const trendChart = computed<EChartOption>(() => {
  const theme = chartBase()
  const { accent, info } = palette.value
  const points = data.value?.dailyTrend || []
  const avg7 = points.map((_, i) => {
    const win = points.slice(Math.max(0, i - 6), i + 1)
    return Math.round((win.reduce((sum, p) => sum + p.activeUsers, 0) / win.length) * 10) / 10
  })
  return {
    animationDuration: 500,
    tooltip: { ...theme.tooltip, trigger: 'axis', renderMode: 'richText', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,0.1)' } } },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 6, itemGap: 14, textStyle: theme.legendText },
    grid: { top: 28, right: 2, bottom: 0, left: 0, containLabel: true },
    xAxis: { type: 'category', data: points.map(p => p.date.slice(5)), axisLabel: { ...theme.axisLabel, interval: 4 }, axisLine: theme.axisLine, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, max: (v: { max: number }) => (v.max < 4 ? 4 : (undefined as unknown as number)), axisLabel: theme.axisLabel, splitLine: theme.splitLine },
    series: [
      {
        name: '活跃用户', type: 'bar', barMaxWidth: 14, barGap: '20%',
        itemStyle: { borderRadius: [4, 4, 1, 1], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: accent }, { offset: 1, color: `${accent}55` }] } },
        emphasis: { itemStyle: { color: accent } },
        data: points.map(p => p.activeUsers),
      },
      { name: '7 日平均', type: 'line', smooth: 0.4, symbol: 'none', lineStyle: { width: 2, type: 'dashed', color: info }, itemStyle: { color: info }, data: avg7, z: 5 },
    ],
  }
})

const trendStats = computed(() => {
  const points = data.value?.dailyTrend || []
  if (!points.length) return null
  const last7 = points.slice(-7)
  const peak = points.reduce((best, p) => (p.activeUsers > best.activeUsers ? p : best), points[0])
  return {
    avg: Math.round(last7.reduce((sum, p) => sum + p.activeUsers, 0) / last7.length),
    peak: peak.activeUsers, peakDate: peak.date.slice(5),
    newUsers: points.reduce((sum, p) => sum + p.newUsers, 0),
  }
})

// ---------- 生图 / 用户增长 / 费用 ----------
/** 三张小图共用的坐标与提示框 */
function miniChartBase(dual = false) {
  const theme = chartBase()
  const points = data.value?.dailyTrend || []
  const yAxis = { type: 'value' as const, minInterval: 1, axisLabel: { ...theme.axisLabel, fontSize: 10 }, splitLine: theme.splitLine }
  return {
    theme, points,
    base: {
      animationDuration: 500,
      tooltip: { ...theme.tooltip, trigger: 'axis' as const, renderMode: 'richText' as const, axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(148,163,184,0.1)' } } },
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 6, itemGap: 12, textStyle: { ...theme.legendText, fontSize: 11 } },
      grid: { top: 26, right: 2, bottom: 0, left: 0, containLabel: true },
      xAxis: { type: 'category' as const, data: points.map(p => p.date.slice(5)), axisLabel: { ...theme.axisLabel, fontSize: 10, interval: 6 }, axisLine: theme.axisLine, axisTick: { show: false } },
      yAxis: dual ? [yAxis, { ...yAxis, splitLine: { show: false } }] : yAxis,
    },
  }
}
const vgrad = (color: string, fade = '33') => ({ type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color }, { offset: 1, color: `${color}${fade}` }] })

const imageChart = computed<EChartOption>(() => {
  const { base, points } = miniChartBase(true)
  const { accent, danger } = palette.value
  const axes = base.yAxis as object[]
  return {
    ...base,
    // 失败线压在下半部，避免盖住柱子
    yAxis: [axes[0], { ...axes[1], max: (v: { max: number }) => Math.max(4, Math.ceil(v.max * 2.2)) }],
    series: [
      { name: '成功生图', type: 'bar', barMaxWidth: 10, itemStyle: { borderRadius: [3, 3, 0, 0], color: vgrad(accent) }, emphasis: { itemStyle: { color: accent } }, data: points.map(p => p.images ?? 0) },
      { name: '失败任务', type: 'line', yAxisIndex: 1, smooth: 0.3, symbol: 'none', lineStyle: { width: 1.4, color: danger, opacity: 0.8 }, itemStyle: { color: danger }, data: points.map(p => p.failedTasks ?? 0) },
    ],
  }
})
const growthChart = computed<EChartOption>(() => {
  const { base, points } = miniChartBase(true)
  const { info, violet } = palette.value
  return {
    ...base,
    // 用户少时从 0 起，避免 5→6 被画成断崖；用户多时贴近最小值以看清增长
    yAxis: [{ ...(base.yAxis as object[])[0], min: (v: { min: number; max: number }) => (v.max <= 50 ? 0 : Math.floor(v.min * 0.9)) }, { ...(base.yAxis as object[])[1], max: (v: { max: number }) => Math.max(4, Math.ceil(v.max * 3)) }],
    series: [
      { name: '累计用户', type: 'line', smooth: 0.3, symbol: 'none', lineStyle: { width: 2, color: info }, itemStyle: { color: info }, areaStyle: { color: vgrad(info, '00') }, data: points.map(p => p.totalUsers ?? 0) },
      { name: '新注册', type: 'bar', yAxisIndex: 1, barMaxWidth: 7, itemStyle: { borderRadius: [3, 3, 0, 0], color: `${violet}99` }, data: points.map(p => p.newUsers) },
    ],
  }
})
const costChart = computed<EChartOption>(() => {
  const { base, points } = miniChartBase()
  const { warning, danger, success } = palette.value
  const yuan = (cents?: number) => Math.round((cents ?? 0)) / 100
  return {
    ...base,
    yAxis: { ...(base.yAxis as object), minInterval: 0, axisLabel: { ...(base.yAxis as { axisLabel: object }).axisLabel, formatter: '¥{value}' } },
    series: [
      { name: '收入', type: 'bar', barMaxWidth: 8, barGap: '15%', itemStyle: { borderRadius: [3, 3, 0, 0], color: vgrad(warning) }, data: points.map(p => yuan(p.revenueCents)) },
      { name: '上游成本', type: 'bar', barMaxWidth: 8, itemStyle: { borderRadius: [3, 3, 0, 0], color: `${danger}bb` }, data: points.map(p => yuan(p.upstreamCostCents)) },
      { name: '毛利', type: 'line', smooth: 0.3, symbol: 'none', lineStyle: { width: 1.8, color: success }, itemStyle: { color: success }, data: points.map(p => yuan((p.revenueCents ?? 0) - (p.upstreamCostCents ?? 0))) },
    ],
  }
})
const dailyTotals = computed(() => {
  const points = data.value?.dailyTrend || []
  const sum = (pick: (p: (typeof points)[number]) => number) => points.reduce((total, p) => total + pick(p), 0)
  const images = sum(p => p.images ?? 0)
  const failed = sum(p => p.failedTasks ?? 0)
  const revenue = sum(p => p.revenueCents ?? 0)
  const cost = sum(p => p.upstreamCostCents ?? 0)
  const first = points[0]
  const last = points[points.length - 1]
  return {
    images, imagesAvg: points.length ? Math.round(images / points.length) : 0, failed,
    total: last?.totalUsers ?? 0,
    growth: first && last ? (last.totalUsers ?? 0) - (first.totalUsers ?? 0) + first.newUsers : 0,
    revenue, cost, profit: revenue - cost,
  }
})

// ---------- 生命周期 ----------
const lifecycleItems = computed(() =>
  [...(data.value?.distributions.lifecycle || [])].sort((a, b) => LIFECYCLE_ORDER.indexOf(a.key) - LIFECYCLE_ORDER.indexOf(b.key)),
)
const lifecycleTotal = computed(() => lifecycleItems.value.reduce((sum, item) => sum + item.count, 0))
const lifecycleMax = computed(() => Math.max(1, ...lifecycleItems.value.map(item => item.count)))
const lifecycleSummary = computed(() => {
  const get = (key: string) => lifecycleItems.value.find(item => item.key === key)?.count || 0
  const healthy = get('active') + get('activated') + get('returned')
  return `${pct(healthy, lifecycleTotal.value, 0)} 在活跃，${number(get('dormant') + get('churn_risk'))} 人沉默或有流失风险`
})
const lifecycleChart = computed<EChartOption>(() => {
  const theme = chartBase()
  return {
    animationDuration: 500,
    tooltip: { ...theme.tooltip, trigger: 'item', renderMode: 'richText', formatter: '{b}  {c} 人（{d}%）' },
    series: [{
      type: 'pie', radius: ['70%', '94%'], padAngle: 2, itemStyle: { borderRadius: 4 },
      label: { show: false }, emphasis: { scale: true, scaleSize: 3 },
      data: lifecycleItems.value.map(item => ({ name: lifecycleLabel(item.key), value: item.count, itemStyle: { color: resolve(LIFECYCLE_COLORS[item.key] || '#94a3b8') } })),
    }],
  }
})

// ---------- 风险 ----------
const riskItems = computed(() => {
  const order = ['high', 'medium', 'low', 'pending']
  return [...(data.value?.distributions.risk || [])].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
})
const riskTotal = computed(() => riskItems.value.reduce((sum, item) => sum + item.count, 0))
const riskCount = (key: string) => riskItems.value.find(i => i.key === key)?.count || 0
const riskSummary = computed(() => {
  const watch = riskCount('high') + riskCount('medium')
  return watch ? `${number(watch)} 人需要关注，其中高风险 ${number(riskCount('high'))} 人` : '目前没有需要关注的用户'
})
const topTags = computed(() => (data.value?.tags || []).slice(0, 4))

// ---------- 价值 ----------
const valueTiers = computed(() => data.value?.valueTiers || [])
const tierRevenueTotal = computed(() => valueTiers.value.reduce((sum, tier) => sum + Math.max(0, tier.revenueCents), 0))
const valueSummary = computed(() => {
  const high = valueTiers.value.find(t => t.tier === 'high')
  const loss = valueTiers.value.find(t => t.tier === 'loss_making')
  if (!tierRevenueTotal.value) return '近 30 天暂无付费收入'
  const parts = [`${number(high?.users || 0)} 位高价值用户贡献 ${pct(Math.max(0, high?.revenueCents || 0), tierRevenueTotal.value, 0)} 收入`]
  if (loss?.users) parts.push(`${number(loss.users)} 人亏损`)
  return parts.join('，')
})

// ---------- 留存 ----------
const retentionRows = computed(() => (data.value?.retention || []).slice(0, 6))
const retentionSummary = computed(() => {
  const rows = (data.value?.retention || []).filter(r => r.day1Base > 0)
  const base = rows.reduce((sum, r) => sum + r.day1Base, 0)
  const kept = rows.reduce((sum, r) => sum + r.day1, 0)
  return base ? `新用户次日回访率 ${pct(kept, base, 0)}（8 周平均）` : '新用户还没到观察日'
})
function heat(value: number, base: number) {
  if (!base) return {}
  const ratio = Math.min(1, value / base)
  return {
    background: `color-mix(in srgb, var(--accent) ${Math.round(12 + ratio * 70)}%, var(--surface-2))`,
    color: ratio > 0.4 ? 'var(--accent-on)' : 'var(--ink)',
  }
}

// ---------- 热门业务 ----------
const topFeatures = computed(() =>
  [...(data.value?.funnel.features || [])].sort((a, b) => b.submittingUsers - a.submittingUsers).slice(0, 6),
)
const featureMax = computed(() => Math.max(1, ...topFeatures.value.map(f => f.submittingUsers)))

// ---------- 重点用户 ----------
type WatchTab = 'risk' | 'churn' | 'highValue'
const watchTab = ref<WatchTab>('risk')
const WATCH_TABS: { id: WatchTab; label: string }[] = [
  { id: 'risk', label: '风险预警' },
  { id: 'churn', label: '流失挽回' },
  { id: 'highValue', label: '高价值' },
]
const WATCH_MORE: Record<WatchTab, Record<string, string>> = { risk: { risk: 'high' }, churn: { lifecycle: 'churn_risk' }, highValue: { profileTag: 'high_value' } }
const watchUsers = computed<WatchUser[]>(() => (data.value?.watchlist?.[watchTab.value] || []).slice(0, 6))
const watchCount = (id: WatchTab) => data.value?.watchlist?.[id]?.length ?? 0

function lastSeen(value: string | null) {
  if (!value) return '从未活跃'
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000)
  if (days <= 0) return '今天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}
function watchReason(user: WatchUser) {
  const tag = user.tags.find(t => user.tagReasons?.[t])
  if (tag) return user.tagReasons[tag]
  if (watchTab.value === 'highValue') return `近 30 天消费 ${money(user.revenueCents30)}`
  if (user.failedRuns30) return `近 30 天失败 ${user.failedRuns30} 次`
  return lifecycleLabel(user.lifecycle)
}

function drill(query: Record<string, string>) {
  void router.push({ path: '/users', query })
}

// ---------- 加载 / 刷新 / 全屏 ----------
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  controller = new AbortController()
  try {
    data.value = await request<UserAnalyticsData>('/api/v1/admin/user-analytics', { signal: controller.signal, silent: true })
  } catch (caught) {
    if (!isRequestAborted(caught)) error.value = caught instanceof Error ? caught.message : '画像数据读取失败'
  } finally {
    loading.value = false
  }
}
function configureRefresh() {
  clearInterval(timer)
  timer = undefined
  if (refreshSeconds.value > 0) timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load()
  }, refreshSeconds.value * 1000)
}
watch(refreshSeconds, () => {
  configureRefresh()
  try { localStorage.setItem('admin.profileDashboard.refreshSeconds', String(refreshSeconds.value)) } catch { /* Optional preference. */ }
}, { flush: 'sync' })
function syncFullscreen() { fullscreen.value = document.fullscreenElement === screen.value }
async function toggleFullscreen() {
  try {
    if (fullscreen.value) await document.exitFullscreen()
    else if (screen.value?.requestFullscreen) await screen.value.requestFullscreen()
    else ElMessage.warning('当前浏览器不支持全屏显示')
  } catch { ElMessage.warning('无法进入全屏，请检查浏览器权限') }
}
onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
  try {
    const saved = Number(localStorage.getItem('admin.profileDashboard.refreshSeconds'))
    if (refreshOptions.includes(saved)) refreshSeconds.value = saved
  } catch { /* Use manual refresh by default. */ }
  void load()
})
onBeforeUnmount(() => {
  clearInterval(timer)
  controller?.abort()
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (document.fullscreenElement === screen.value) void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <div ref="screen" class="profile">
    <header class="profile-head">
      <span class="head-meta">
        <i class="live" :class="{ on: refreshSeconds > 0 }" />
        <template v-if="data">更新于 {{ formatTime(data.calculatedAt) }}<em>·</em>画像覆盖 {{ pct(data.summary.profilesReady, data.summary.totalUsers, 0) }}</template>
        <template v-else>等待统计数据</template>
      </span>
      <span class="head-actions">
        <el-select v-model="refreshSeconds" aria-label="自动刷新间隔" size="small" style="width: 118px" :teleported="false">
          <el-option v-for="seconds in refreshOptions" :key="seconds" :value="seconds" :label="seconds ? `每 ${seconds} 秒刷新` : '手动刷新'" />
        </el-select>
        <el-button size="small" :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button size="small" :icon="FullScreen" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</el-button>
      </span>
    </header>

    <el-alert v-if="error" type="error" :title="error" :description="data ? '以下为上次成功读取的数据' : '请点击刷新重试'" :closable="false" show-icon />
    <div v-if="!data" v-loading="loading" class="profile-empty"><el-empty v-if="!loading" description="暂无可展示的统计数据" :image-size="70" /></div>

    <template v-else>
      <!-- 核心指标 -->
      <section class="kpis">
        <article v-for="kpi in kpis" :key="kpi.key" class="kpi" :class="`tone-${kpi.tone}`">
          <div class="kpi-top">
            <span class="kpi-label">{{ kpi.label }}</span>
            <span class="kpi-icon"><component :is="kpi.icon" /></span>
          </div>
          <div class="kpi-mid">
            <strong class="tnum">{{ kpi.value }}</strong>
            <svg v-if="kpi.spark?.line" class="spark" viewBox="0 0 96 30" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient :id="`spark-${kpi.key}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path :d="kpi.spark.area" :fill="`url(#spark-${kpi.key})`" />
              <path :d="kpi.spark.line" class="spark-line" />
            </svg>
            <svg v-else-if="kpi.ring !== undefined && kpi.ring !== null" class="ring" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15" class="ring-track" />
              <circle cx="18" cy="18" r="15" class="ring-value" :stroke-dasharray="`${(kpi.ring * 94.25).toFixed(1)} 94.25`" />
            </svg>
          </div>
          <div class="kpi-foot">
            <span v-if="kpi.diff" class="chip" :class="`is-${kpi.diff.dir}`">{{ kpi.diff.dir === 'up' ? '↑' : kpi.diff.dir === 'down' ? '↓' : '—' }} {{ kpi.diff.text }}</span>
            <span class="kpi-sub">{{ kpi.sub }}</span>
          </div>
        </article>
      </section>

      <!-- 趋势 + 生命周期 -->
      <div class="grid grid-main">
        <section class="card">
          <header class="card-head">
            <div><h3>每日活跃用户</h3><p>近 30 天 · 柱为当日活跃人数，虚线为 7 日平均</p></div>
            <dl v-if="trendStats" class="mini-stats">
              <div><dt>近 7 天日均</dt><dd class="tnum">{{ number(trendStats.avg) }}</dd></div>
              <div><dt>峰值 {{ trendStats.peakDate }}</dt><dd class="tnum">{{ number(trendStats.peak) }}</dd></div>
              <div><dt>30 天新注册</dt><dd class="tnum">{{ number(trendStats.newUsers) }}</dd></div>
            </dl>
          </header>
          <div class="chart-fill"><EChart v-if="data.dailyTrend.length" :option="trendChart" height="100%" /></div>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>用户生命周期</h3><p>{{ lifecycleSummary }}</p></div></header>
          <div class="life">
            <div class="donut">
              <EChart :option="lifecycleChart" height="100%" />
              <div class="donut-center"><b class="tnum">{{ number(lifecycleTotal) }}</b><small>位用户</small></div>
            </div>
            <ul class="legend">
              <li v-for="item in lifecycleItems" :key="item.key">
                <button type="button" :disabled="item.key === 'pending'" @click="drill({ lifecycle: item.key })">
                  <span class="legend-name"><i :style="{ background: LIFECYCLE_COLORS[item.key] }" />{{ lifecycleLabel(item.key) }}</span>
                  <b class="tnum">{{ number(item.count) }}</b>
                  <small class="tnum">{{ pct(item.count, lifecycleTotal, 0) }}</small>
                  <span class="legend-bar"><u :style="{ width: `${(item.count / lifecycleMax) * 100}%`, background: LIFECYCLE_COLORS[item.key] }" /></span>
                </button>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <!-- 生图 / 用户增长 / 费用 -->
      <div class="grid grid-three">
        <section class="card">
          <header class="card-head">
            <div><h3>每日生图数量</h3><p>柱：成功图片 · 线：失败任务</p></div>
            <dl class="mini-stats">
              <div><dt>30 天共</dt><dd class="tnum">{{ number(dailyTotals.images) }}</dd></div>
              <div><dt>日均</dt><dd class="tnum">{{ number(dailyTotals.imagesAvg) }}</dd></div>
            </dl>
          </header>
          <div class="chart-mini"><EChart :option="imageChart" height="100%" /></div>
        </section>
        <section class="card">
          <header class="card-head">
            <div><h3>用户增长</h3><p>线：累计用户 · 柱：新注册</p></div>
            <dl class="mini-stats">
              <div><dt>当前</dt><dd class="tnum">{{ number(dailyTotals.total) }}</dd></div>
              <div><dt>30 天净增</dt><dd class="tnum">+{{ number(dailyTotals.growth) }}</dd></div>
            </dl>
          </header>
          <div class="chart-mini"><EChart :option="growthChart" height="100%" /></div>
        </section>
        <section class="card">
          <header class="card-head">
            <div><h3>每日费用</h3><p>柱：收入 / 成本 · 线：毛利</p></div>
            <dl class="mini-stats">
              <div><dt>30 天收入</dt><dd class="tnum">{{ money(dailyTotals.revenue) }}</dd></div>
              <div><dt>上游成本</dt><dd class="tnum">{{ money(dailyTotals.cost) }}</dd></div>
            </dl>
          </header>
          <div class="chart-mini"><EChart :option="costChart" height="100%" /></div>
        </section>
      </div>

      <!-- 风险 / 价值 / 留存 -->
      <div class="grid grid-three">
        <section class="card">
          <header class="card-head"><div><h3>风险分布</h3><p>{{ riskSummary }}</p></div></header>
          <div v-if="riskTotal" class="stack">
            <i v-for="key in ['high', 'medium', 'low']" :key="key" :style="{ flex: riskCount(key), background: RISK_COLORS[key] }" />
          </div>
          <div class="risk-stats">
            <button v-for="key in ['high', 'medium', 'low']" :key="key" type="button" @click="drill({ risk: key })">
              <span><i :style="{ background: RISK_COLORS[key] }" />{{ riskLabels[key] }}</span>
              <b class="tnum">{{ number(riskCount(key)) }}</b>
              <small class="tnum">{{ pct(riskCount(key), riskTotal, 0) }}</small>
            </button>
          </div>
          <div v-if="topTags.length" class="chips">
            <button v-for="tag in topTags" :key="tag.key" type="button" @click="drill({ profileTag: tag.key })">
              {{ tagLabel(tag.key) }}<b class="tnum">{{ number(tag.count) }}</b>
            </button>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>用户价值</h3><p>{{ valueSummary }}</p></div></header>
          <div v-if="tierRevenueTotal" class="stack">
            <i v-for="tier in valueTiers.filter(t => t.revenueCents > 0)" :key="tier.tier" :style="{ flex: tier.revenueCents, background: TIER_COLORS[tier.tier] }" :title="`${valueLabels[tier.tier]} ${money(tier.revenueCents)}`" />
          </div>
          <table class="tiers">
            <thead><tr><th>分层</th><th>人数</th><th>30 天收入</th><th>毛利</th></tr></thead>
            <tbody>
              <tr v-for="tier in valueTiers" :key="tier.tier">
                <td><span class="dot" :style="{ background: TIER_COLORS[tier.tier] }" />{{ valueLabels[tier.tier] || tier.tier }}</td>
                <td class="tnum">{{ number(tier.users) }}</td>
                <td class="tnum strong">{{ money(tier.revenueCents) }}</td>
                <td class="tnum" :class="{ neg: tier.grossProfitCents < 0 }">{{ money(tier.grossProfitCents) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>新用户留存</h3><p>{{ retentionSummary }}</p></div></header>
          <table v-if="retentionRows.length" class="heat">
            <thead><tr><th>注册周</th><th>人数</th><th>次日</th><th>7 天</th><th>30 天</th></tr></thead>
            <tbody>
              <tr v-for="row in retentionRows" :key="row.week">
                <td class="tnum">{{ row.week.slice(5) }}</td>
                <td class="tnum">{{ number(row.users) }}</td>
                <td v-for="(cell, index) in [[row.day1, row.day1Base], [row.day7, row.day7Base], [row.day30, row.day30Base]]" :key="index">
                  <span class="heat-cell tnum" :style="heat(cell[0], cell[1])" :title="cell[1] ? `${cell[0]} / ${cell[1]} 人回访` : '尚未到观察日'">{{ cell[1] ? pct(cell[0], cell[1], 0) : '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- 重点用户 + 热门业务 -->
      <div class="grid grid-main">
        <section class="card">
          <header class="card-head">
            <div><h3>重点用户</h3></div>
            <nav class="seg" role="tablist" aria-label="重点用户">
              <button v-for="tab in WATCH_TABS" :key="tab.id" type="button" role="tab" :aria-selected="watchTab === tab.id" :class="{ active: watchTab === tab.id }" @click="watchTab = tab.id">
                {{ tab.label }}<em class="tnum">{{ watchCount(tab.id) }}</em>
              </button>
            </nav>
            <button type="button" class="link" @click="drill(WATCH_MORE[watchTab])">查看全部 →</button>
          </header>
          <div v-if="watchUsers.length" class="watch">
            <button v-for="user in watchUsers" :key="user.id" type="button" class="watch-row" @click="drill({ userId: user.id })">
              <span class="avatar" :style="{ '--c': RISK_COLORS[user.riskLevel] || '#94a3b8' }">{{ (user.username || user.email).slice(0, 1).toUpperCase() }}</span>
              <span class="watch-name"><b>{{ user.username || user.email.split('@')[0] }}</b><small>{{ user.email }}</small></span>
              <span class="watch-reason">{{ watchReason(user) }}</span>
              <span class="pill" :class="watchTab === 'highValue' ? 'is-value' : `is-${user.riskLevel}`">
                {{ watchTab === 'highValue' ? money(user.revenueCents30) : riskLabels[user.riskLevel] || user.riskLevel }}
              </span>
              <span class="watch-seen tnum">{{ lastSeen(user.lastActivityAt) }}</span>
            </button>
          </div>
          <p v-else class="none">这一类暂时没有需要处理的用户</p>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>热门业务</h3><p>按使用人数排序 · 近 30 天</p></div></header>
          <ol class="rank">
            <li v-for="(feature, index) in topFeatures" :key="feature.feature">
              <em class="tnum" :class="{ top: index < 3 }">{{ index + 1 }}</em>
              <span class="rank-name">{{ workspaceLabels[feature.feature] || feature.feature }}</span>
              <span class="rank-val tnum"><b>{{ number(feature.submittingUsers) }}</b> 人 · {{ number(feature.submissions) }} 次</span>
              <span class="rank-bar"><u :style="{ width: `${(feature.submittingUsers / featureMax) * 100}%` }" /></span>
            </li>
          </ol>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; overflow: auto; padding: 2px 2px 16px; }
.profile:fullscreen { height: 100vh; padding: 20px 24px; background: var(--bg); }
.profile-empty { min-height: 300px; }

/* 顶部信息行：无底色 */
.profile-head { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; }
.head-meta { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-3); font-size: 12px; }
.head-meta em { font-style: normal; opacity: 0.6; }
.live { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); }
.live.on { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); animation: blink 1.8s ease-in-out infinite; }
@keyframes blink { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .live.on { animation: none; } }
.head-actions { display: inline-flex; gap: 6px; }
.head-actions :deep(.el-button) { margin: 0; }

/* 卡片 */
.card { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 14px 16px; border-radius: 14px; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.18); }
html.dark .card { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 10px 28px -14px rgb(0 0 0 / 0.6); }
.card-head { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.card-head > div:first-child { flex: 1; min-width: 0; }
h3 { margin: 0; color: var(--ink); font-size: 14px; font-weight: 650; }
.card-head p { margin: 3px 0 0; overflow: hidden; color: var(--ink-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.none { margin: 6px 0; color: var(--ink-3); font-size: 12px; }
.link { flex: 0 0 auto; align-self: center; padding: 0; border: 0; background: none; color: var(--accent-ink); font: inherit; font-size: 12px; cursor: pointer; }
.link:hover { text-decoration: underline; }
.grid { display: grid; flex: 0 0 auto; gap: 10px; }
.grid-main { grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); }
.grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* 图标色调 */
.tone-accent { --tone: var(--accent); --tone-soft: var(--accent-soft); --tone-ink: var(--accent-ink); }
.tone-info { --tone: var(--info); --tone-soft: var(--info-soft); --tone-ink: var(--info); }
.tone-violet { --tone: var(--violet); --tone-soft: var(--violet-soft); --tone-ink: var(--violet); }
.tone-warning { --tone: var(--warning); --tone-soft: var(--warning-soft); --tone-ink: var(--warning); }
.tone-success { --tone: var(--success); --tone-soft: var(--success-soft); --tone-ink: var(--success); }
.tone-danger { --tone: var(--danger); --tone-soft: var(--danger-soft); --tone-ink: var(--danger); }

/* 核心指标 */
.kpis { display: grid; flex: 0 0 auto; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
/* 金属质感卡片：拉丝纹理 + 斜向高光 + 上亮下暗的倒角；无边框，色调来自 .tone-* */
.kpi {
  --sheen: rgb(255 255 255 / 0.55);
  --brush: rgb(255 255 255 / 0.35);
  --bevel-hi: rgb(255 255 255 / 0.9);
  --bevel-lo: rgb(15 23 42 / 0.08);
  position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 14px; overflow: hidden;
  border-radius: 14px;
  background:
    repeating-linear-gradient(90deg, var(--brush) 0 1px, transparent 1px 3px),
    radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--tone) 26%, transparent), transparent 62%),
    linear-gradient(160deg, color-mix(in srgb, var(--tone) 16%, #f8fafc) 0%, #eef1f5 48%, color-mix(in srgb, var(--tone) 10%, #dfe4ea) 100%);
  background-blend-mode: soft-light, normal, normal;
  box-shadow:
    inset 0 1px 0 var(--bevel-hi),
    inset 0 -1px 0 var(--bevel-lo),
    0 1px 2px rgb(15 23 42 / 0.06),
    0 10px 24px -14px color-mix(in srgb, var(--tone) 60%, rgb(15 23 42 / 0.4));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
html.dark .kpi {
  --sheen: rgb(255 255 255 / 0.1);
  --brush: rgb(255 255 255 / 0.05);
  --bevel-hi: rgb(255 255 255 / 0.12);
  --bevel-lo: rgb(0 0 0 / 0.5);
  background:
    repeating-linear-gradient(90deg, var(--brush) 0 1px, transparent 1px 3px),
    radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--tone) 24%, transparent), transparent 62%),
    linear-gradient(160deg, color-mix(in srgb, var(--tone) 14%, #2a303c) 0%, #1c212b 50%, color-mix(in srgb, var(--tone) 8%, #14181f) 100%);
  box-shadow:
    inset 0 1px 0 var(--bevel-hi),
    inset 0 -1px 0 var(--bevel-lo),
    0 12px 28px -14px color-mix(in srgb, var(--tone) 45%, rgb(0 0 0 / 0.7));
}
/* 斜向高光带，悬停时扫过 */
.kpi::after {
  content: ''; position: absolute; inset: -40% -60%; pointer-events: none;
  background: linear-gradient(110deg, transparent 42%, var(--sheen) 50%, transparent 58%);
  transform: translateX(-18%);
  transition: transform 0.8s ease;
}
.kpi:hover { transform: translateY(-1px); }
.kpi:hover::after { transform: translateX(18%); }
@media (prefers-reduced-motion: reduce) { .kpi, .kpi:hover, .kpi::after, .kpi:hover::after { transform: none; transition: none; } }
.kpi > * { position: relative; z-index: 1; }
.kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kpi-label { color: var(--ink-2); font-size: 12px; font-weight: 600; }
.kpi-icon {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px;
  background:
    linear-gradient(160deg, rgb(255 255 255 / 0.55) 0%, rgb(255 255 255 / 0) 45%),
    linear-gradient(160deg, color-mix(in srgb, var(--tone) 85%, #fff), color-mix(in srgb, var(--tone) 65%, #000));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.6), inset 0 -1px 0 rgb(0 0 0 / 0.25), 0 4px 10px -2px color-mix(in srgb, var(--tone) 50%, transparent);
  color: #fff;
}
.tone-accent .kpi-icon { color: var(--accent-on); }
.kpi-icon svg { width: 15px; height: 15px; }
.kpi-mid { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-height: 32px; }
.kpi-mid strong { overflow: hidden; background: linear-gradient(180deg, var(--ink) 30%, color-mix(in srgb, var(--ink) 55%, var(--tone)) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; font-size: 26px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; text-overflow: ellipsis; white-space: nowrap; }
.spark { flex: 0 0 auto; width: 92px; height: 30px; color: var(--tone); }
.spark-line { fill: none; stroke: var(--tone); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.ring { flex: 0 0 auto; width: 34px; height: 34px; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 4; }
.ring-track { stroke: color-mix(in srgb, var(--tone) 16%, var(--surface-2)); }
.ring-value { stroke: var(--tone); stroke-linecap: round; }
.kpi-foot { display: flex; align-items: center; gap: 6px; min-width: 0; }
.kpi-sub { overflow: hidden; color: var(--ink-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.chip { flex: 0 0 auto; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 650; white-space: nowrap; }
.chip.is-up { background: var(--success-soft); color: var(--success); }
.chip.is-down { background: var(--danger-soft); color: var(--danger); }
.chip.is-flat { background: color-mix(in srgb, var(--ink-3) 14%, transparent); color: var(--ink-2); }

/* 趋势 */
.mini-stats { display: flex; gap: 18px; margin: 0; }
.mini-stats div { display: grid; gap: 1px; text-align: right; }
.mini-stats dt { color: var(--ink-3); font-size: 11px; }
.mini-stats dd { margin: 0; color: var(--ink); font-size: 16px; font-weight: 700; }
.chart-fill { height: 210px; }
.chart-mini { height: 170px; }

/* 生命周期 */
.life { display: grid; grid-template-columns: 132px minmax(0, 1fr); align-items: center; gap: 16px; }
.donut { position: relative; height: 132px; }
.donut-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.donut-center b { color: var(--ink); font-size: 22px; font-weight: 700; line-height: 1.1; }
.donut-center small { color: var(--ink-3); font-size: 11px; }
.legend { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; }
.legend button { display: grid; grid-template-columns: minmax(0, 1fr) auto 34px; align-items: center; column-gap: 8px; row-gap: 3px; width: 100%; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: var(--ink-2); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.legend button:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
.legend button:disabled { cursor: default; }
.legend-name { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.legend-name i { width: 7px; height: 7px; border-radius: 2px; }
.legend b { color: var(--ink); font-weight: 650; }
.legend small { color: var(--ink-3); font-size: 11px; text-align: right; }
.legend-bar { grid-column: 1 / -1; height: 3px; overflow: hidden; border-radius: 2px; background: var(--surface-2); }
.legend-bar u { display: block; height: 100%; border-radius: inherit; opacity: 0.85; }

/* 堆叠条（风险 / 价值共用） */
.stack { display: flex; gap: 2px; height: 8px; overflow: hidden; border-radius: 4px; background: var(--surface-2); }
.stack i { min-width: 3px; }

/* 风险 */
.risk-stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 10px; border-radius: 10px; background: var(--surface-2); }
.risk-stats button { display: grid; gap: 1px; padding: 8px 10px; border: 0; border-right: 1px solid color-mix(in srgb, var(--ink-3) 14%, transparent); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.risk-stats button:last-child { border-right: 0; }
.risk-stats button:hover { background: var(--surface-3); }
.risk-stats button:first-child:hover { border-radius: 10px 0 0 10px; }
.risk-stats button:last-child:hover { border-radius: 0 10px 10px 0; }
.risk-stats span { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-2); font-size: 11px; }
.risk-stats span i { width: 6px; height: 6px; border-radius: 50%; }
.risk-stats b { color: var(--ink); font-size: 20px; font-weight: 700; line-height: 1.2; }
.risk-stats small { color: var(--ink-3); font-size: 11px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chips button { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font: inherit; font-size: 12px; cursor: pointer; }
.chips button:hover { background: var(--accent-soft); color: var(--ink); }
.chips b { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--surface); color: var(--ink); font-size: 11px; text-align: center; }

/* 表格（价值 / 留存共用） */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 0 4px 6px; color: var(--ink-3); font-size: 11px; font-weight: 500; text-align: left; }
td { padding: 5px 4px; color: var(--ink-2); }
.tiers { margin-top: 8px; }
.tiers th:nth-child(n + 2), .tiers td:nth-child(n + 2) { text-align: right; }
.tiers tbody tr { border-top: 1px solid var(--border); }
.tiers td:first-child { white-space: nowrap; }
.dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 2px; }
.strong { color: var(--ink); font-weight: 650; }
.neg { color: var(--danger); }
.heat { border-collapse: separate; border-spacing: 3px; margin: -3px; }
.heat td { padding: 0 1px; }
.heat-cell { display: block; padding: 4px 0; border-radius: 6px; background: var(--surface-2); color: var(--ink-3); font-size: 11px; font-weight: 650; text-align: center; }

/* 分段切换 */
.seg { display: inline-flex; flex: 0 0 auto; gap: 2px; padding: 2px; border-radius: 9px; background: var(--surface-2); }
.seg button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: var(--ink-3); font: inherit; font-size: 12px; cursor: pointer; }
.seg button:hover { color: var(--ink); }
.seg button.active { background: var(--surface); color: var(--ink); font-weight: 650; box-shadow: var(--shadow-sm); }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.seg em { font-size: 11px; font-style: normal; opacity: 0.6; }

/* 重点用户 */
.watch { display: grid; }
.watch-row { display: grid; grid-template-columns: 30px minmax(130px, 1.1fr) minmax(0, 2fr) auto 64px; align-items: center; gap: 12px; width: 100%; padding: 7px 6px; border: 0; border-top: 1px solid var(--border); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.watch-row:first-child { border-top: 0; }
.watch-row:hover { border-radius: 8px; background: var(--surface-2); }
.avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: color-mix(in srgb, var(--c) 16%, var(--surface)); color: var(--c); font-size: 12px; font-weight: 700; }
.watch-name { display: grid; min-width: 0; }
.watch-name b, .watch-name small, .watch-reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.watch-name b { color: var(--ink); font-size: 13px; font-weight: 600; }
.watch-name small { color: var(--ink-3); font-size: 11px; }
.watch-reason { color: var(--ink-2); font-size: 12px; }
.watch-seen { color: var(--ink-3); font-size: 11px; text-align: right; }
.pill { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; white-space: nowrap; }
.pill.is-high { background: var(--danger-soft); color: var(--danger); }
.pill.is-medium { background: var(--warning-soft); color: var(--warning); }
.pill.is-low { background: var(--success-soft); color: var(--success); }
.pill.is-value { background: var(--violet-soft); color: var(--violet); }

/* 热门业务 */
.rank { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.rank li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 4px 8px; font-size: 12px; }
.rank em { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--surface-2); color: var(--ink-3); font-size: 11px; font-style: normal; font-weight: 700; }
.rank em.top { background: var(--accent-soft); color: var(--accent-ink); }
.rank-name { overflow: hidden; color: var(--ink); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.rank-val { color: var(--ink-3); font-size: 11px; }
.rank-val b { color: var(--ink); font-size: 12px; }
.rank-bar { grid-column: 2 / -1; height: 4px; overflow: hidden; border-radius: 2px; background: var(--surface-2); }
.rank-bar u { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent)); }

@media (max-width: 1500px) {
  .kpi-mid strong { font-size: 22px; }
  .spark { width: 64px; }
  .mini-stats { gap: 12px; }
  .mini-stats div:last-child { display: none; }
  .grid-main { grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr); }
  .life { grid-template-columns: 112px minmax(0, 1fr); gap: 12px; }
  .donut { height: 112px; }
  .donut-center b { font-size: 19px; }
  .watch-row { grid-template-columns: 30px minmax(110px, 1fr) minmax(0, 1.5fr) auto; }
  .watch-seen { display: none; }
}
</style>
