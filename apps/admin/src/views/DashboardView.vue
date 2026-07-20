<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { request } from '@/request'
import { fenToYuan, formatTime, taskTypeLabel } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'

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

const cards = computed(() => {
  const s = stats.value
  return [
    { label: '总用户数', value: s?.totalUsers ?? '-' },
    { label: '今日新增用户', value: s?.newUsersToday ?? '-' },
    { label: '运行中任务', value: s?.runningTasks ?? '-' },
    { label: '近7日任务量', value: taskDaily.value.length ? tasks7dTotal.value : '-' },
    { label: '近7日成功率', value: taskDaily.value.length ? `${tasks7dRate.value}%` : '-' },
    { label: '近30日收入（元）', value: s?.revenueCents !== undefined ? fenToYuan(s.revenueCents) : '-' },
    { label: '钱包总余额（元）', value: s?.walletBalanceCents !== undefined ? fenToYuan(s.walletBalanceCents) : '-' },
  ]
})

/** 近7日任务量 + 成功数折线 */
const taskLineOption = computed<EChartOption>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['任务量', '成功数'], top: 0 },
  grid: { left: 40, right: 16, top: 32, bottom: 24 },
  xAxis: { type: 'category', data: taskDaily.value.map((d) => d.date) },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    { name: '任务量', type: 'line', smooth: true, data: taskDaily.value.map((d) => d.total) },
    {
      name: '成功数',
      type: 'line',
      smooth: true,
      data: taskDaily.value.map((d) => d.succeeded),
      itemStyle: { color: '#67c23a' },
      lineStyle: { color: '#67c23a' },
    },
  ],
}))

/** 近30日收入柱状（分 → 元） */
const revenueBarOption = computed<EChartOption>(() => {
  const daily = finance.value?.revenueDaily ?? []
  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => `${value ?? 0} 元`,
    },
    grid: { left: 48, right: 16, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: daily.map((d) => d.date) },
    yAxis: { type: 'value' },
    series: [
      {
        name: '收入（元）',
        type: 'bar',
        data: daily.map((d) => d.amountCents / 100),
        itemStyle: { color: '#409eff' },
      },
    ],
  }
})

/** 近30日任务类型分布饼图 */
const typePieOption = computed<EChartOption>(() => {
  const dist = stats.value?.typeDistribution ?? {}
  const data = Object.entries(dist).map(([type, count]) => ({ name: taskTypeLabel(type), value: count }))
  return {
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 0, top: 'middle' },
    series: [
      {
        name: '任务类型',
        type: 'pie',
        radius: ['40%', '68%'],
        center: ['58%', '50%'],
        label: { formatter: '{b}: {c}' },
        data,
      },
    ],
  }
})

const hasTypeDistribution = computed(
  () => Object.keys(stats.value?.typeDistribution ?? {}).length > 0,
)

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

    <div class="cards">
      <el-card v-for="card in cards" :key="card.label" shadow="never" class="stat-card">
        <div class="stat-value">{{ card.value }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="charts">
      <el-card shadow="never">
        <template #header>近7日任务量 / 成功数</template>
        <EChart v-if="taskDaily.length" :option="taskLineOption" />
        <el-empty v-else description="暂无数据" :image-size="60" />
      </el-card>

      <el-card shadow="never">
        <template #header>任务类型分布（近30日）</template>
        <EChart v-if="hasTypeDistribution" :option="typePieOption" />
        <el-empty v-else description="暂无数据" :image-size="60" />
      </el-card>
    </div>

    <el-card shadow="never" style="margin-top: 12px">
      <template #header>近30日收入（元）</template>
      <EChart v-if="finance?.revenueDaily?.length" :option="revenueBarOption" />
      <el-empty v-else description="暂无数据" :image-size="60" />
    </el-card>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
}

.stat-label {
  margin-top: 4px;
  color: #909399;
  font-size: 13px;
}

.charts {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
}

@media (max-width: 1100px) {
  .charts {
    grid-template-columns: 1fr;
  }
}
</style>
