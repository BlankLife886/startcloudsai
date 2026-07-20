<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import {
  CircleCheck,
  Coin,
  Histogram,
  Monitor,
  TrendCharts,
  User,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue'
import { request } from '@/request'
import { fenToYuan, formatTime, taskTypeLabel } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase, CHART_COLORS } from '@/chartTheme'

interface DailyTaskStat {
  date: string
  total: number
  succeeded: number
}

interface AdminStats {
  totalUsers?: number
  newUsersToday?: number
  taskDaily?: DailyTaskStat[]
  revenueCents?: number
  walletBalanceCents?: number
  runningTasks?: number
  /** 近30日各类型任务数（v2 增补） */
  typeDistribution?: Record<string, number>
}

interface DailyAmount {
  date: string
  amountCents: number
}

interface FinanceSummary {
  revenueDaily?: DailyAmount[]
  spendDaily?: DailyAmount[]
  totals?: { revenueCents: number; spendCents: number; grantCents: number; refundCents: number }
}

const loading = ref(false)
const stats = ref<AdminStats | null>(null)
const finance = ref<FinanceSummary | null>(null)
const loadedAt = ref('')

const taskDaily = computed(() => stats.value?.taskDaily ?? [])

const tasks7dTotal = computed(() => taskDaily.value.reduce((sum, d) => sum + d.total, 0))
const tasks7dSucceeded = computed(() => taskDaily.value.reduce((sum, d) => sum + d.succeeded, 0))
const tasks7dRate = computed(() =>
  tasks7dTotal.value > 0 ? Math.round((tasks7dSucceeded.value / tasks7dTotal.value) * 100) : 0,
)

interface KpiCard {
  label: string
  value: string | number
  caption: string
  icon: Component
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
}

const cards = computed<KpiCard[]>(() => {
  const s = stats.value
  const has7d = taskDaily.value.length > 0
  return [
    {
      label: '总用户数',
      value: s?.totalUsers ?? '-',
      caption: '全部注册用户',
      icon: User,
      tone: 'accent',
    },
    {
      label: '今日新增用户',
      value: s?.newUsersToday ?? '-',
      caption: '今日 0 点起累计',
      icon: UserFilled,
      tone: 'violet',
    },
    {
      label: '运行中任务',
      value: s?.runningTasks ?? '-',
      caption: '当前实时执行中',
      icon: Monitor,
      tone: 'info',
    },
    {
      label: '近7日任务量',
      value: has7d ? tasks7dTotal.value : '-',
      caption: has7d ? `日均 ${Math.round(tasks7dTotal.value / 7)} 单` : '暂无数据',
      icon: Histogram,
      tone: 'warning',
    },
    {
      label: '近7日成功数',
      value: has7d ? tasks7dSucceeded.value : '-',
      caption: '近 7 日完成任务',
      icon: CircleCheck,
      tone: 'success',
    },
    {
      label: '近7日成功率',
      value: has7d ? `${tasks7dRate.value}%` : '-',
      caption: has7d ? `成功 ${tasks7dSucceeded.value} / 共 ${tasks7dTotal.value}` : '暂无数据',
      icon: TrendCharts,
      tone: 'info',
    },
    {
      label: '近30日收入（元）',
      value: s?.revenueCents !== undefined ? fenToYuan(s.revenueCents) : '-',
      caption: '订单入账合计',
      icon: Coin,
      tone: 'success',
    },
    {
      label: '钱包总余额（元）',
      value: s?.walletBalanceCents !== undefined ? fenToYuan(s.walletBalanceCents) : '-',
      caption: '全站用户钱包结余',
      icon: Wallet,
      tone: 'violet',
    },
  ]
})

/** 近7日任务量 + 成功数折线 */
const taskLineOption = computed<EChartOption>(() => {
  const base = chartBase()
  return {
    color: base.color,
    tooltip: { trigger: 'axis', ...base.tooltip },
    legend: { data: ['任务量', '成功数'], top: 0, textStyle: base.legendText },
    grid: { left: 40, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: taskDaily.value.map((d) => d.date), axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: { type: 'value', minInterval: 1, axisLabel: base.axisLabel, splitLine: base.splitLine },
    series: [
      {
        name: '任务量',
        type: 'line',
        smooth: true,
        data: taskDaily.value.map((d) => d.total),
        areaStyle: { color: 'rgba(99, 102, 241, 0.08)' },
      },
      {
        name: '成功数',
        type: 'line',
        smooth: true,
        data: taskDaily.value.map((d) => d.succeeded),
        itemStyle: { color: CHART_COLORS[2] },
        lineStyle: { color: CHART_COLORS[2] },
      },
    ],
  }
})

/** 近30日收入柱状（分 → 元） */
const revenueBarOption = computed<EChartOption>(() => {
  const daily = finance.value?.revenueDaily ?? []
  const base = chartBase()
  return {
    color: base.color,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => `${value ?? 0} 元`,
      ...base.tooltip,
    },
    grid: { left: 48, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: daily.map((d) => d.date), axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: { type: 'value', axisLabel: base.axisLabel, splitLine: base.splitLine },
    series: [
      {
        name: '收入（元）',
        type: 'bar',
        data: daily.map((d) => d.amountCents / 100),
        itemStyle: { color: CHART_COLORS[0], borderRadius: [4, 4, 0, 0] },
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

async function load() {
  loading.value = true
  try {
    const [statsData, financeData] = await Promise.all([
      request<AdminStats>('/api/admin/stats'),
      // 财务汇总接口（v2）不可用时不阻塞仪表盘其余部分
      request<FinanceSummary>('/api/admin/finance/summary', {
        query: { days: 30 },
        silent: true,
      }).catch(() => null),
    ])
    stats.value = statsData
    finance.value = financeData
    loadedAt.value = formatTime(new Date().toISOString())
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-header">
      <span class="title">运营概览</span>
      <span v-if="loadedAt" class="text-muted">更新于 {{ loadedAt }}</span>
      <el-button size="small" @click="load">刷新</el-button>
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

    <div class="charts">
      <PageCard title="近7日任务量 / 成功数" subtitle="每日创建任务数与成功完成数">
        <EChart v-if="taskDaily.length" :option="taskLineOption" />
        <div v-else class="card-empty" style="min-height: 280px">
          <el-empty description="暂无任务数据" :image-size="60">
            <div class="empty-sub">近 7 日还没有任务记录</div>
          </el-empty>
        </div>
      </PageCard>

      <PageCard title="任务类型分布" subtitle="近 30 日各类型任务数">
        <EChart v-if="hasTypeDistribution" :option="typePieOption" />
        <div v-else class="card-empty" style="min-height: 280px">
          <el-empty description="暂无任务数据" :image-size="60">
            <div class="empty-sub">近 30 日还没有任务，暂无法统计分布</div>
          </el-empty>
        </div>
      </PageCard>
    </div>

    <PageCard title="近30日收入（元）" subtitle="订单入账金额按日汇总" style="margin-top: 16px">
      <EChart v-if="finance?.revenueDaily?.length" :option="revenueBarOption" />
      <div v-else class="card-empty" style="min-height: 280px">
        <el-empty description="暂无收入数据" :image-size="60">
          <div class="empty-sub">近 30 日还没有入账订单</div>
        </el-empty>
      </div>
    </PageCard>
  </div>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.charts {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
}

@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
}
</style>
