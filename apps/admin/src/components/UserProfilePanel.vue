<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase } from '@/chartTheme'
import { request } from '@/request'
import { formatShortTime, formatTime } from '@/utils'
import {
  buildModelCatalog,
  formatDurationMs,
  formatProfileMoney,
  lifecycleLabels,
  profileModelLabel,
  profileTagLabels,
  workspaceLabels,
  type UserProfileBreakdown,
  type UserProfileDetail,
} from '@/userProfile'

const props = defineProps<{
  profile: UserProfileDetail
  refreshing?: boolean
}>()

defineEmits<{ refresh: [] }>()

const metrics = computed(() => props.profile.metrics)
const historyExpanded = ref(false)
const visibleHistory = computed(() => {
  const history = props.profile.history || []
  return historyExpanded.value ? history : history.slice(0, 5)
})

const modelCatalog = ref<Record<string, string>>({})

onMounted(async () => {
  try {
    const cfg = await request<{
      models?: Array<{ id?: string; name?: string; upstreamModel?: string }>
    }>('/api/v1/admin/model-config')
    modelCatalog.value = buildModelCatalog(cfg.models)
  } catch {
    modelCatalog.value = {}
  }
})

function modelName(item: UserProfileBreakdown) {
  return profileModelLabel(item, modelCatalog.value)
}

function rate(item: UserProfileBreakdown) {
  const terminal = item.succeeded + item.failed
  return terminal > 0 ? Math.round((item.succeeded / terminal) * 100) : 0
}

function workspaceName(item: UserProfileBreakdown) {
  return workspaceLabels[item.label] || workspaceLabels[item.key] || item.label || item.key
}

function shareOf(runs: number, total: number) {
  return total > 0 ? Math.round((runs / total) * 100) : 0
}

const modelRunTotal = computed(() =>
  props.profile.models.reduce((sum, item) => sum + Number(item.runs || 0), 0),
)

function tagTone(tag: string) {
  if (tag === 'frequent_failure' || tag === 'loss_making') return 'danger'
  if (tag === 'churn_risk') return 'warning'
  if (tag === 'high_value') return 'accent'
  return 'neutral'
}

function lifecycleTone(lifecycle?: string) {
  if (lifecycle === 'active' || lifecycle === 'returned') return 'success'
  if (lifecycle === 'churn_risk') return 'warning'
  if (lifecycle === 'new' || lifecycle === 'activated') return 'info'
  return 'neutral'
}

function riskTone(value?: string) {
  if (value === 'high') return 'danger'
  if (value === 'medium') return 'warning'
  return 'success'
}

function bps(value: number) {
  return `${(Math.max(0, Number(value) || 0) / 100).toFixed(1)}%`
}

function riskLabel(value: string) {
  if (value === 'high') return '高风险'
  if (value === 'medium') return '需关注'
  return '状态正常'
}

function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const funnelFeatures = computed(() =>
  (props.profile.funnel?.features || [])
    .filter((item) => item.opens > 0 || item.submissions > 0)
    .slice(0, 6),
)

const hasTrend = computed(() =>
  props.profile.dailyTrend.some((point) => point.succeeded > 0 || point.failed > 0),
)

const workspaceSlices = computed(() => {
  const rows = [...props.profile.workspaces]
    .filter((item) => item.runs > 0)
    .sort((a, b) => b.runs - a.runs)
  const top = rows.slice(0, 6)
  const rest = rows.slice(6)
  const slices = top.map((item) => ({ name: workspaceName(item), value: item.runs }))
  const other = rest.reduce((sum, item) => sum + item.runs, 0)
  if (other > 0) slices.push({ name: '其他', value: other })
  return slices
})

const workspaceTotal = computed(() => workspaceSlices.value.reduce((sum, item) => sum + item.value, 0))

const trendOption = computed<EChartOption>(() => {
  const base = chartBase()
  const success = token('--success') || '#0d9f6e'
  const danger = token('--danger') || '#dc2626'
  const dates = props.profile.dailyTrend.map((point) => point.date)
  return {
    color: [success, danger],
    tooltip: { trigger: 'axis', ...base.tooltip, axisPointer: { type: 'shadow' } },
    legend: {
      data: ['成功', '失败'],
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { ...base.legendText, fontSize: 11 },
    },
    grid: { left: 28, right: 8, top: 28, bottom: 22 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        ...base.axisLabel,
        interval: 4,
        formatter: (value: string) => String(value).slice(5),
      },
      axisLine: base.axisLine,
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: base.axisLabel,
      splitLine: base.splitLine,
    },
    series: [
      {
        name: '成功',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 10,
        data: props.profile.dailyTrend.map((point) => point.succeeded),
        itemStyle: { color: success, borderRadius: [0, 0, 0, 0] },
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'runs',
        barMaxWidth: 10,
        data: props.profile.dailyTrend.map((point) => point.failed),
        itemStyle: { color: danger, borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})

const workspaceOption = computed<EChartOption>(() => {
  const base = chartBase()
  const ink = token('--ink')
  const counts = new Map(workspaceSlices.value.map((item) => [item.name, item.value]))
  return {
    color: base.color,
    tooltip: { trigger: 'item', ...base.tooltip },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: { ...base.legendText, fontSize: 11 },
      formatter: (name: string) => `${name}  ${counts.get(name) ?? 0}`,
    },
    title: {
      text: String(workspaceTotal.value),
      subtext: '近30日次数',
      left: '28%',
      top: '38%',
      textAlign: 'center',
      textStyle: { fontSize: 18, fontWeight: 750, color: ink },
      subtextStyle: { fontSize: 10, color: base.legendText.color },
    },
    series: [
      {
        name: '业务偏好',
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['28%', '50%'],
        itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data: workspaceSlices.value,
      },
    ],
  }
})
</script>

<template>
  <div class="profile-panel">
    <header class="profile-head">
      <div class="profile-head__line">
        <span class="badge" :class="`badge--${lifecycleTone(metrics.lifecycle)}`">
          {{ lifecycleLabels[metrics.lifecycle] || metrics.lifecycle }}
        </span>
        <span class="badge" :class="`badge--${riskTone(metrics.riskLevel)}`">
          {{ riskLabel(metrics.riskLevel) }}
        </span>
        <small>
          最近活跃 {{ formatShortTime(metrics.lastActivityAt) }}
          · 画像更新 {{ formatShortTime(metrics.calculatedAt) }}
        </small>
      </div>
      <el-tooltip content="重新读取该用户最新数据并计算画像" placement="top">
        <el-button circle :icon="Refresh" :loading="refreshing" aria-label="重新计算画像" @click="$emit('refresh')" />
      </el-tooltip>
    </header>

    <section class="profile-block">
      <header class="profile-block__title">
        <i class="tone tone--neutral" />
        <span>画像依据</span>
      </header>
      <div v-if="metrics.tags.length" class="profile-tags">
        <el-tooltip
          v-for="tag in metrics.tags"
          :key="tag"
          :content="metrics.tagReasons[tag] || '根据最近30日真实数据计算'"
          placement="top"
          :show-after="200"
        >
          <span class="badge" :class="`badge--${tagTone(tag)}`">{{ profileTagLabels[tag] || tag }}</span>
        </el-tooltip>
      </div>
      <p v-else class="profile-empty">当前没有需要特别标记的行为</p>
    </section>

    <div class="kpi-grid">
      <article
        class="kpi is-success"
        :title="`${metrics.successfulRuns30} 成功 / ${metrics.failedRuns30} 失败`"
      >
        <small>成功率</small>
        <strong class="tnum">{{ (metrics.successRateBps30 / 100).toFixed(1) }}%</strong>
      </article>
      <article class="kpi is-warning" title="实际扣除积分折算">
        <small>实收</small>
        <strong class="tnum">{{ formatProfileMoney(metrics.revenueCents30) }}</strong>
      </article>
      <article
        class="kpi"
        :class="metrics.grossProfitCents30 < 0 ? 'is-danger' : 'is-accent'"
        :title="`成本 ${formatProfileMoney(metrics.upstreamCostCents30)}`"
      >
        <small>毛利</small>
        <strong class="tnum">{{ formatProfileMoney(metrics.grossProfitCents30) }}</strong>
      </article>
      <article class="kpi is-info" :title="`近7日 ${metrics.activeDays7} 天`">
        <small>活跃</small>
        <strong class="tnum">{{ metrics.activeDays30 }} 天</strong>
      </article>
      <article class="kpi is-neutral" :title="`P95 ${formatDurationMs(metrics.p95DurationMs30)}`">
        <small>耗时</small>
        <strong class="tnum">{{ formatDurationMs(metrics.averageDurationMs30) }}</strong>
      </article>
      <article class="kpi is-violet" :title="`使用 ${metrics.featureDiversity30} 类功能`">
        <small>业务</small>
        <strong>{{ workspaceLabels[metrics.primaryWorkspace] || metrics.primaryWorkspace || '暂无' }}</strong>
      </article>
    </div>

    <div class="profile-split">
      <section class="profile-block">
        <header class="profile-block__title">
          <i class="tone tone--accent" />
          <span>近30日活跃趋势</span>
          <small>适合看量级变化，绿成功 / 红失败</small>
        </header>
        <EChart v-if="hasTrend" :option="trendOption" height="176px" />
        <p v-else class="profile-empty">近30日没有任务记录</p>
      </section>

      <section class="profile-block">
        <header class="profile-block__title">
          <i class="tone tone--violet" />
          <span>业务偏好</span>
          <small>按近30日任务次数</small>
        </header>
        <EChart v-if="workspaceTotal" :option="workspaceOption" height="176px" />
        <p v-else class="profile-empty">近30日没有业务记录</p>
      </section>
    </div>

    <section class="profile-block">
      <header class="profile-block__title">
        <i class="tone tone--info" />
        <span>近30日使用路径</span>
        <small>
          {{ profile.funnel?.trackingSince ? `自 ${formatTime(profile.funnel.trackingSince)} 采集` : '等待新操作' }}
        </small>
      </header>
      <div class="funnel-path">
        <span class="is-info">
          <em>进入</em>
          <strong class="tnum">{{ profile.funnel?.opens || 0 }}</strong>
        </span>
        <i>{{ bps(profile.funnel?.submitRateBps || 0) }}</i>
        <span class="is-accent">
          <em>提交</em>
          <strong class="tnum">{{ profile.funnel?.submissions || 0 }}</strong>
        </span>
        <i>{{ bps(profile.funnel?.successRateBps || 0) }}</i>
        <span class="is-success">
          <em>成功</em>
          <strong class="tnum">{{ profile.funnel?.succeeded || 0 }}</strong>
        </span>
      </div>
      <div class="funnel-meta">
        <span>参考图 {{ profile.funnel?.referenceUploadsCompleted || 0 }}</span>
        <span :class="{ 'is-danger': profile.funnel?.referenceUploadsFailed }">
          上传失败 {{ profile.funnel?.referenceUploadsFailed || 0 }}
        </span>
        <span>取消 {{ profile.funnel?.canceled || 0 }}</span>
        <span>提示词 {{ profile.funnel?.promptTemplatesUsed || 0 }}</span>
      </div>
      <div v-if="funnelFeatures.length" class="funnel-features">
        <div v-for="item in funnelFeatures" :key="item.feature">
          <strong>{{ workspaceLabels[item.feature] || item.feature }}</strong>
          <span>进入 {{ item.opens }} · 提交 {{ item.submissions }} · 成功 {{ item.succeeded }}</span>
        </div>
      </div>
      <p v-else class="profile-empty">行为采集刚启用，用户产生新操作后会自动显示</p>
    </section>

    <section class="profile-block">
      <header class="profile-block__title">
        <i class="tone tone--accent" />
        <span>常用模型</span>
        <small>按使用次数</small>
      </header>
      <div v-if="profile.models.length" class="model-list">
        <div v-for="item in profile.models" :key="item.key" class="model-row">
          <span :title="item.key">{{ modelName(item) }}</span>
          <strong class="tnum">{{ item.runs }} 次</strong>
          <small>{{ rate(item) }}%</small>
          <i class="share" aria-hidden="true">
            <b :style="{ width: `${shareOf(item.runs, modelRunTotal)}%` }" />
          </i>
        </div>
      </div>
      <p v-else class="profile-empty">近30日没有模型记录</p>
    </section>

    <section class="profile-block is-danger">
      <header class="profile-block__title">
        <i class="tone tone--danger" />
        <span>失败原因</span>
      </header>
      <div v-if="profile.failures.length" class="failure-list">
        <div v-for="item in profile.failures" :key="item.code">
          <strong class="tnum">{{ item.count }}</strong>
          <span>{{ item.message }}</span>
          <code>{{ item.code }}</code>
        </div>
      </div>
      <p v-else class="profile-empty">近30日没有失败任务</p>
    </section>

    <section class="profile-block">
      <header class="profile-block__title">
        <i class="tone tone--neutral" />
        <span>画像变化</span>
        <small>每天首次计算或关键状态变化时记录</small>
      </header>
      <div v-if="visibleHistory.length" class="profile-history-list">
        <div
          v-for="item in visibleHistory"
          :key="`${item.calculatedAt}-${item.lifecycle}-${item.riskLevel}`"
          class="profile-history-row"
        >
          <time class="tnum">{{ formatShortTime(item.calculatedAt) }}</time>
          <span class="history-state">
            <strong>{{ lifecycleLabels[item.lifecycle] || item.lifecycle }}</strong>
            <small :class="`is-${item.riskLevel}`">{{ riskLabel(item.riskLevel) }}</small>
          </span>
          <span class="history-workspace">
            <small>主要业务</small>
            <strong>{{ workspaceLabels[item.primaryWorkspace] || item.primaryWorkspace || '暂无' }}</strong>
          </span>
          <span class="is-metric">
            <small>成功率</small>
            <strong class="tnum">{{ (item.successRateBps30 / 100).toFixed(1) }}%</strong>
          </span>
          <span class="is-metric">
            <small>毛利</small>
            <strong class="tnum" :class="{ 'is-negative': item.grossProfitCents30 < 0 }">
              {{ formatProfileMoney(item.grossProfitCents30) }}
            </strong>
          </span>
        </div>
      </div>
      <p v-else class="profile-empty">首次画像计算后会开始记录变化</p>
      <el-button
        v-if="(profile.history?.length || 0) > 5"
        text
        class="history-toggle"
        @click="historyExpanded = !historyExpanded"
      >
        {{ historyExpanded ? '收起' : `查看全部 ${profile.history.length} 条` }}
      </el-button>
    </section>
  </div>
</template>

<style scoped>
.profile-panel {
  display: grid;
  gap: 12px;
}

.profile-head,
.profile-head__line,
.profile-block__title {
  display: flex;
  align-items: center;
}

.profile-head {
  justify-content: space-between;
  gap: 12px;
}

.profile-head__line {
  min-width: 0;
  flex: 1;
  gap: 8px;
}

.profile-head__line small,
.profile-block__title small,
.profile-empty {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-head .badge,
.profile-tags .badge {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 22px;
}

.profile-block {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.profile-block.is-danger {
  border-color: color-mix(in srgb, var(--danger) 22%, var(--border));
  background: color-mix(in srgb, var(--danger-soft) 70%, var(--surface));
}

.profile-block__title {
  gap: 8px;
  min-width: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 750;
}

.profile-block__title small {
  margin-left: auto;
  font-weight: 500;
}

.tone {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 99px;
}

.tone--neutral { background: var(--ink-3); }
.tone--accent { background: var(--accent); }
.tone--success { background: var(--success); }
.tone--warning { background: var(--warning); }
.tone--danger { background: var(--danger); }
.tone--info { background: var(--info); }
.tone--violet { background: var(--violet); }

.profile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--border);
}

.kpi {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
}

.kpi.is-success { background: var(--success-soft); }
.kpi.is-warning { background: var(--warning-soft); }
.kpi.is-danger { background: var(--danger-soft); }
.kpi.is-info { background: var(--info-soft); }
.kpi.is-violet { background: var(--violet-soft); }
.kpi.is-accent { background: var(--accent-soft); }
.kpi.is-neutral { background: var(--surface-2); }

.kpi small {
  flex: none;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.kpi strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 750;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 8px;
}

.funnel-path {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px minmax(0, 1fr) 44px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.funnel-path > span {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 4px 10px;
  border-radius: 8px;
}

.funnel-path > span.is-info { background: var(--info-soft); }
.funnel-path > span.is-accent { background: var(--accent-soft); }
.funnel-path > span.is-success { background: var(--success-soft); }

.funnel-path em {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 650;
}

.funnel-path strong {
  color: var(--ink);
  font-size: 15px;
  font-weight: 750;
}

.funnel-path > i {
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 750;
  text-align: center;
}

.funnel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--ink-2);
  font-size: 12px;
}

.funnel-meta .is-danger {
  color: var(--danger);
}

.funnel-features {
  display: grid;
}

.funnel-features > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 28px;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.funnel-features > div:last-child {
  border-bottom: 0;
}

.funnel-features strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.funnel-features span {
  flex: none;
  color: var(--ink-3);
  font-size: 11px;
}

.profile-empty {
  margin: 0;
}

.model-list,
.failure-list {
  display: grid;
  gap: 8px;
}

.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 36px;
  grid-template-rows: auto 4px;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
}

.model-row span {
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-row strong {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.model-row small {
  color: var(--ink-3);
  font-size: 11px;
  text-align: right;
}

.share {
  display: block;
  grid-column: 1 / -1;
  height: 4px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--surface-3);
}

.share b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.failure-list > div {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.failure-list strong {
  color: var(--danger);
  font-size: 13px;
  font-weight: 750;
}

.failure-list span {
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.failure-list code {
  overflow: hidden;
  max-width: 160px;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-history-list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.profile-history-row {
  display: grid;
  grid-template-columns: 96px minmax(108px, 0.9fr) minmax(110px, 1fr) 72px 80px;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.profile-history-row:nth-child(even) {
  background: var(--surface-2);
}

.profile-history-row:last-child {
  border-bottom: 0;
}

.profile-history-row time,
.profile-history-row small {
  color: var(--ink-3);
  font-size: 11px;
}

.profile-history-row > span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.profile-history-row .is-metric {
  justify-items: end;
  text-align: right;
}

.profile-history-row strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-history-row strong.is-negative,
.history-state small.is-high {
  color: var(--danger);
}

.history-state small.is-medium {
  color: var(--warning);
}

.history-state small.is-low {
  color: var(--success);
}

.history-toggle {
  justify-self: start;
  padding-inline: 0;
}

@media (max-width: 900px) {
  .kpi-grid,
  .profile-split {
    grid-template-columns: 1fr 1fr;
  }

  .profile-history-row {
    grid-template-columns: 96px minmax(100px, 1fr) minmax(90px, 1fr);
  }

  .profile-history-row > span:nth-last-child(-n + 2) {
    display: none;
  }
}
</style>
