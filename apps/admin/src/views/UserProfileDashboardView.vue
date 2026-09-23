<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FullScreen, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase } from '@/chartTheme'
import { request, isRequestAborted } from '@/request'
import { formatTime } from '@/utils'
import { lifecycleLabels, workspaceLabels } from '@/userProfile'
import type { DistributionItem, UserAnalyticsData } from '@/userAnalytics'

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
const number = (value: number) => value.toLocaleString('zh-CN')
const percent = (value: number, base: number) => base > 0 ? `${(value / base * 100).toFixed(1)}%` : '—'
const lifecycleLabel = (key: string) => lifecycleLabels[key] || (key === 'pending' ? '待计算' : key)
const riskLabels: Record<string, string> = { low: '状态正常', medium: '需关注', high: '高风险', pending: '待计算' }
const valueLabels: Record<string, string> = { none: '暂无收入', standard: '普通价值', high: '高价值', loss_making: '当前亏损', pending: '待计算' }
const distributionGroups = computed(() => data.value ? [
  { title: '风险分布', subtitle: '基于最新用户画像', items: data.value.distributions.risk, labels: riskLabels, tone: 'risk' },
  { title: '价值分布', subtitle: '价值分层与当前盈利状态', items: data.value.distributions.value, labels: valueLabels, tone: 'value' },
] : [])
const metrics = computed(() => {
  const s = data.value?.summary
  if (!s) return []
  return [
    { label: '用户总数', value: s.totalUsers, detail: `画像覆盖 ${percent(s.profilesReady, s.totalUsers)}`, tone: 'accent' },
    { label: '近 30 日新增', value: s.newUsers30, detail: '注册用户', tone: 'blue' },
    { label: '近 7 日活跃', value: s.activeUsers7, detail: `近 30 日活跃 ${number(s.activeUsers30)}`, tone: 'accent' },
    { label: '需关注用户', value: s.atRiskUsers, detail: `高频失败 ${number(s.frequentFailures)}`, tone: 'orange' },
    { label: '高价值用户', value: s.highValueUsers, detail: '依据画像高价值标签', tone: 'purple' },
    { label: '回流用户', value: s.returnedUsers, detail: '当前生命周期为回流', tone: 'blue' },
  ]
})
const lifecycleChart = computed<EChartOption>(() => {
  const theme = chartBase()
  return {
    color: theme.color, animationDuration: 300,
    title: { text: number(data.value?.summary.profilesReady || 0), subtext: '已生成画像', left: 'center', top: '29%', textStyle: { color: theme.legendText.color, fontSize: 25 }, subtextStyle: { color: theme.axisLabel.color, fontSize: 11 } },
    tooltip: { ...theme.tooltip, trigger: 'item', renderMode: 'richText' },
    legend: { bottom: 0, textStyle: theme.legendText, type: 'plain', itemWidth: 10, itemHeight: 8, itemGap: 10 },
    series: [{ type: 'pie', radius: ['48%', '67%'], center: ['50%', '41%'],
      label: { show: false }, emphasis: { label: { show: true, formatter: '{b}\n{d}%', color: theme.legendText.color } },
      data: (data.value?.distributions.lifecycle || []).map(item => ({ name: lifecycleLabel(item.key), value: item.count })),
    }],
  }
})
const trendChart = computed<EChartOption>(() => {
  const theme = chartBase()
  const points = data.value?.dailyTrend || []
  const series = [
    { key: 'activeUsers' as const, name: '活跃用户' },
    { key: 'newUsers' as const, name: '新增用户' },
    { key: 'submittingUsers' as const, name: '提交用户' },
    { key: 'successfulUsers' as const, name: '成功用户' },
  ]
  return {
    color: theme.color, animationDuration: 300,
    tooltip: { ...theme.tooltip, trigger: 'axis', renderMode: 'richText' },
    legend: { top: 0, textStyle: theme.legendText },
    grid: { top: 42, right: 16, bottom: 26, left: 44, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: points.map(p => p.date.slice(5)), axisLabel: theme.axisLabel, axisLine: theme.axisLine },
    yAxis: { type: 'value', minInterval: 1, axisLabel: theme.axisLabel, splitLine: theme.splitLine },
    series: series.map((s, index) => ({ name: s.name, type: 'line', showSymbol: false, lineStyle: theme.lineStyle,
      ...(index === 0 ? { areaStyle: theme.areaStyle } : {}), data: points.map(p => p[s.key]),
    })),
  }
})
const features = computed(() => [...(data.value?.funnel.features || [])].sort((a, b) => b.submittingUsers - a.submittingUsers))
function barWidth(item: DistributionItem) {
  const total = data.value?.summary.totalUsers || 0
  return `${total > 0 ? Math.min(100, item.count / total * 100) : 0}%`
}
function retentionStyle(value: number, base: number) {
  return base > 0 ? { background: `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, value / base) * 28 + 4)}%, var(--surface))` } : {}
}
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
  <div ref="screen" class="profile-screen">
    <header class="screen-header">
      <div class="screen-controls">
        <span class="updated-at">{{ data ? `统计于 ${formatTime(data.calculatedAt)}` : '等待统计数据' }}</span>
        <el-select v-model="refreshSeconds" aria-label="自动刷新间隔" style="width: 132px" :teleported="false">
          <el-option v-for="seconds in refreshOptions" :key="seconds" :value="seconds" :label="seconds ? `每 ${seconds} 秒刷新` : '手动刷新'" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button :icon="FullScreen" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</el-button>
      </div>
    </header>
    <el-alert v-if="error" type="error" :title="error" :description="data ? '刷新失败，以下保留上次成功读取的数据。可点击刷新重试。' : '点击刷新重试。'" :closable="false" show-icon />
    <div v-if="!data" v-loading="loading" class="screen-placeholder"><el-empty v-if="!loading" description="暂无可展示的统计数据" /></div>
    <template v-else>
      <div class="metric-grid">
        <article v-for="metric in metrics" :key="metric.label" class="metric-card" :class="`tone-${metric.tone}`">
          <span>{{ metric.label }}</span><strong>{{ number(metric.value) }}</strong><small>{{ metric.detail }}</small>
        </article>
      </div>
      <div class="coverage-strip"><span>画像计算进度</span><div><i :style="{ width: `${data.summary.totalUsers ? data.summary.profilesReady / data.summary.totalUsers * 100 : 0}%` }" /></div><strong>{{ number(data.summary.profilesReady) }} / {{ number(data.summary.totalUsers) }}</strong><small>画像异步计算，刷新大屏不会强制重算</small></div>
      <div class="overview-grid">
        <section class="screen-panel trend-panel"><header><h2>活跃与增长趋势</h2><span>近 30 日 · 人 / 日</span></header><EChart v-if="data.dailyTrend.length" :option="trendChart" height="250px" /><el-empty v-else description="暂无趋势数据" /></section>
        <section class="screen-panel"><header><h2>生命周期</h2><span>最新画像</span></header><EChart v-if="data.distributions.lifecycle.some(item => item.count > 0)" :option="lifecycleChart" height="250px" /><el-empty v-else description="暂无用户画像" /></section>
      </div>
      <div class="detail-grid">
        <section v-for="group in distributionGroups" :key="group.tone" class="screen-panel" :class="`distribution-${group.tone}`">
          <header><h2>{{ group.title }}</h2><span>{{ group.subtitle }}</span></header>
          <div v-if="group.items.length" class="distribution-list"><div v-for="item in group.items" :key="item.key"><div><span>{{ group.labels[item.key] || item.key }}</span><strong>{{ number(item.count) }} <small>{{ percent(item.count, data.summary.totalUsers) }}</small></strong></div><button v-if="group.tone === 'risk' && item.key !== 'pending'" class="distribution-drill" @click="router.push({ path: '/users', query: { risk: item.key } })">查看用户 →</button><div class="distribution-track"><i :style="{ width: barWidth(item) }" /></div></div></div>
          <el-empty v-else description="暂无分布数据" :image-size="50" />
        </section>
        <section class="screen-panel retention-panel"><header><h2>注册留存</h2><span>最近 8 周注册批次</span></header>
          <div class="table-scroll"><table><thead><tr><th>注册周</th><th>用户数</th><th>次日</th><th>第 7 天</th><th>第 30 天</th></tr></thead><tbody><tr v-for="row in data.retention" :key="row.week"><th>{{ row.week }}</th><td>{{ number(row.users) }}</td><td v-for="(cell, index) in [{ value: row.day1, base: row.day1Base }, { value: row.day7, base: row.day7Base }, { value: row.day30, base: row.day30Base }]" :key="index" :style="retentionStyle(cell.value, cell.base)"><strong>{{ cell.base ? percent(cell.value, cell.base) : '采集中' }}</strong><small v-if="cell.base">{{ cell.value }}/{{ cell.base }}</small></td></tr></tbody></table></div>
          <p class="panel-note">比例按已到观察日的样本计算；分母为 0 时不记为零留存。</p><el-empty v-if="!data.retention.length" description="最近 8 周暂无注册用户" :image-size="40" />
        </section>
      </div>
      <section class="screen-panel"><header><h2>业务使用路径</h2><span>按提交用户数排序 · 各业务独立去重</span></header>
        <div v-if="features.length" class="table-scroll"><table class="feature-table"><thead><tr><th>业务</th><th>进入用户</th><th>提交用户</th><th>成功用户</th><th>提交次数</th><th>成功次数</th></tr></thead><tbody><tr v-for="(feature, index) in features" :key="feature.feature"><th><span class="feature-rank">{{ String(index + 1).padStart(2, '0') }}</span>{{ workspaceLabels[feature.feature] || feature.feature }}</th><td>{{ number(feature.visitors) }}</td><td>{{ number(feature.submittingUsers) }}</td><td>{{ number(feature.successfulUsers) }}</td><td>{{ number(feature.submissions) }}</td><td>{{ number(feature.succeeded) }}</td></tr></tbody></table></div>
        <el-empty v-else description="暂无业务使用数据" :image-size="50" />
        <p class="panel-note">{{ data.funnel.trackingSince ? `页面行为采集起点：${formatTime(data.funnel.trackingSince)}` : '尚未产生页面进入事件，任务数据按接口统计窗口展示' }}。页面进入与任务提交是独立事件，不能直接视为严格的转化漏斗。</p>
      </section>
      <footer class="screen-footer"><span>统计来自用户分析接口 · 不包含用户创作内容</span><RouterLink to="/users">前往用户管理 →</RouterLink></footer>
    </template>
  </div>
</template>

<style scoped>
.profile-screen { height: 100%; min-height: 0; overflow: auto; padding: 24px; background: var(--bg); color: var(--ink); display: flex; flex-direction: column; gap: 18px; }
.profile-screen:fullscreen { width: 100vw; height: 100vh; padding: 30px; }
.screen-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.screen-eyebrow { font-size: 10px; letter-spacing: 2px; color: var(--accent-ink); font-weight: 700; }
h1 { margin: 6px 0; font-size: 25px; letter-spacing: -.5px; } .screen-header p { margin: 0; font-size: 12px; color: var(--ink-3); }
.screen-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: flex-end; } .screen-controls :deep(.el-button) { margin: 0; }
.updated-at { flex-basis: 100%; text-align: right; color: var(--ink-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.metric-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.metric-card { padding: 20px; display: grid; gap: 9px; border: 1px solid var(--border); border-radius: 14px; background: linear-gradient(145deg, color-mix(in srgb, var(--metric-color) 7%, var(--surface)), var(--surface)); --metric-color: var(--accent); }
.metric-card > span { color: var(--ink-2); font-size: 12px; } .metric-card > strong { font-size: clamp(24px, 2.6vw, 38px); font-weight: 650; line-height: 1.1; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
.metric-card small { color: var(--ink-3); font-size: 11px; } .tone-blue { --metric-color: #38bdf8; } .tone-orange { --metric-color: #fb923c; } .tone-purple { --metric-color: #a78bfa; }
.coverage-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--ink-3); } .coverage-strip > div { width: 160px; height: 4px; background: var(--surface-2); border-radius: 4px; overflow: hidden; } .coverage-strip i { display: block; height: 100%; background: var(--accent); } .coverage-strip strong { color: var(--ink-2); } .coverage-strip small { margin-left: auto; }
.overview-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; } .detail-grid { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 16px; }
.screen-panel { min-width: 0; flex-shrink: 0; border: 1px solid var(--border); border-radius: 14px; padding: 18px; background: var(--surface); }
.screen-panel > header { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-bottom: 18px; } h2 { margin: 0; font-size: 14px; font-weight: 650; } .screen-panel header > span { color: var(--ink-3); font-size: 11px; }
.distribution-list { display: grid; gap: 18px; } .distribution-list > div > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; } .distribution-list strong { font-variant-numeric: tabular-nums; } .distribution-list small { color: var(--ink-3); font-size: 10px; margin-left: 6px; }
.distribution-track { height: 5px; border-radius: 5px; overflow: hidden; background: var(--surface-2); margin-top: 9px; } .distribution-track i { display: block; height: 100%; background: #a78bfa; border-radius: inherit; } .distribution-risk .distribution-track i { background: #fb923c; }
.table-scroll { overflow: auto; max-height: 330px; } table { border-collapse: separate; border-spacing: 0 4px; width: 100%; min-width: 410px; font-size: 12px; font-variant-numeric: tabular-nums; } th, td { text-align: right; padding: 9px 10px; } th:first-child { text-align: left; } thead th { color: var(--ink-3); font-weight: 500; white-space: nowrap; position: sticky; top: 0; background: var(--surface); z-index: 1; } tbody th { font-weight: 500; color: var(--ink-2); white-space: nowrap; } td small { display: block; margin-top: 3px; font-size: 10px; color: var(--ink-3); } .retention-panel td { border-radius: 5px; } .retention-panel td strong { font-size: 11px; font-weight: 500; }
.feature-table { min-width: 680px; } .feature-table tbody tr:hover { background: var(--surface-2); } .feature-rank { margin-right: 12px; color: var(--accent-ink); font-size: 10px; } .panel-note { color: var(--ink-3); font-size: 11px; line-height: 1.7; margin: 12px 0 0; }
.screen-footer { display: flex; justify-content: space-between; gap: 12px; color: var(--ink-3); font-size: 11px; padding: 4px 0; } .screen-footer a { color: var(--accent-ink); text-decoration: none; } .screen-placeholder { min-height: 300px; }
@media (min-width: 1800px) { .profile-screen { gap: 24px; } .metric-card { padding: 26px; } .screen-panel { padding: 22px; } }
@media (max-width: 1200px) { .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .retention-panel { grid-column: 1 / -1; } }
@media (max-width: 760px) { .profile-screen, .profile-screen:fullscreen { padding: 14px; } .screen-header { flex-direction: column; align-items: stretch; } .screen-controls { justify-content: flex-start; } .updated-at { text-align: left; } .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .metric-card { padding: 14px; } .overview-grid, .detail-grid { grid-template-columns: minmax(0, 1fr); } .coverage-strip small { margin-left: 0; } .screen-footer { flex-wrap: wrap; } }
.profile-screen { padding:20px;gap:14px;background:radial-gradient(ellipse at 85% 0%,color-mix(in srgb,var(--accent) 7%,transparent),transparent 45%),var(--bg); }
.screen-header { justify-content:flex-end;padding-bottom:14px;border-bottom:1px solid var(--border); }
.screen-header h1 { font-size:26px;letter-spacing:1px; }
.metric-card { padding:16px 18px;border-top:2px solid color-mix(in srgb,var(--metric-color) 60%,var(--border));gap:7px;border-radius:10px; }
.metric-card > strong { font-size:32px; }
.screen-panel { border-radius:12px;padding:16px; }
.screen-panel > header { margin-bottom:12px; }
.screen-panel > header h2 { display:flex;align-items:center;gap:8px; }
.screen-panel > header h2::before { content:'';display:block;width:3px;height:13px;background:var(--accent);border-radius:2px; }
.overview-grid { grid-template-columns:minmax(0,2fr) minmax(300px,1fr); }
.detail-grid { grid-template-columns:minmax(210px,1fr) minmax(210px,1fr) minmax(440px,2fr); align-items:start; }
.retention-panel th, .retention-panel td { padding:6px 8px;line-height:1.4; }
.retention-panel td small { display:inline;margin-left:5px;font-size:9px; }
.table-scroll { max-height:none; }
.distribution-list { gap:16px; }
.distribution-drill { padding:4px 0;border:0;background:none;color:var(--accent-ink);font-size:11px;cursor:pointer; }
.screen-footer { border-top:1px solid var(--border);padding-top:12px; }
.profile-screen:fullscreen { padding:24px 30px; }
@media(min-width:1700px){.overview-grid{grid-template-columns:minmax(0,2.4fr) minmax(330px,1fr)}.metric-card>strong{font-size:38px}.profile-screen{gap:18px}}
@media(max-width:1200px){.detail-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.retention-panel{grid-column:1/-1}}
@media(max-width:760px){.overview-grid,.detail-grid{grid-template-columns:minmax(0,1fr)}.metric-card{padding:14px}.metric-card>strong{font-size:27px}.screen-header h1{font-size:22px}}
</style>
