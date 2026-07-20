<script setup lang="ts">
import { computed, onMounted, reactive, ref, type Component } from 'vue'
import { Coin, RefreshLeft, TrendCharts, Wallet } from '@element-plus/icons-vue'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { fenToYuan, formatTime, ledgerKindLabel, shortId } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'
import { chartBase, CHART_COLORS } from '@/chartTheme'

interface DailyAmount {
  date: string
  amountCents: number
}

interface FinanceSummary {
  revenueDaily: DailyAmount[]
  spendDaily: DailyAmount[]
  totals: {
    revenueCents: number
    spendCents: number
    grantCents: number
    refundCents: number
  }
}

const days = ref<7 | 30 | 90>(30)
const summaryLoading = ref(false)
const summary = ref<FinanceSummary | null>(null)

async function loadSummary() {
  summaryLoading.value = true
  try {
    summary.value = await request<FinanceSummary>('/api/admin/finance/summary', {
      query: { days: days.value },
    })
  } finally {
    summaryLoading.value = false
  }
}

interface FinanceCard {
  label: string
  value: string
  caption: string
  icon: Component
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
}

const totalCards = computed<FinanceCard[]>(() => {
  const t = summary.value?.totals
  return [
    {
      label: `近${days.value}日收入（元）`,
      value: t ? fenToYuan(t.revenueCents) : '-',
      caption: '已支付订单合计',
      icon: Coin,
      tone: 'success',
    },
    {
      label: `近${days.value}日消耗（元）`,
      value: t ? fenToYuan(t.spendCents) : '-',
      caption: '任务扣费合计',
      icon: TrendCharts,
      tone: 'warning',
    },
    {
      label: `近${days.value}日入账（元）`,
      value: t ? fenToYuan(t.grantCents) : '-',
      caption: '钱包入账（含赠送）',
      icon: Wallet,
      tone: 'violet',
    },
    {
      label: `近${days.value}日退款（元）`,
      value: t ? fenToYuan(t.refundCents) : '-',
      caption: '退款与费用返还',
      icon: RefreshLeft,
      tone: 'danger',
    },
  ]
})

/** 收入 / 消耗双折线（按日期对齐，分 → 元） */
const trendOption = computed<EChartOption>(() => {
  const revenue = summary.value?.revenueDaily ?? []
  const spend = summary.value?.spendDaily ?? []
  const dates = [...new Set([...revenue.map((d) => d.date), ...spend.map((d) => d.date)])].sort()
  const revenueMap = new Map(revenue.map((d) => [d.date, d.amountCents / 100]))
  const spendMap = new Map(spend.map((d) => [d.date, d.amountCents / 100]))
  const base = chartBase()
  return {
    color: base.color,
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${value ?? 0} 元`, ...base.tooltip },
    legend: { data: ['收入', '消耗'], top: 0, textStyle: base.legendText },
    grid: { left: 48, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: dates, axisLabel: base.axisLabel, axisLine: base.axisLine },
    yAxis: { type: 'value', axisLabel: base.axisLabel, splitLine: base.splitLine },
    series: [
      {
        name: '收入',
        type: 'line',
        smooth: true,
        data: dates.map((d) => revenueMap.get(d) ?? 0),
        itemStyle: { color: CHART_COLORS[0] },
        lineStyle: { color: CHART_COLORS[0] },
        areaStyle: base.areaStyle,
      },
      {
        name: '消耗',
        type: 'line',
        smooth: true,
        data: dates.map((d) => spendMap.get(d) ?? 0),
        itemStyle: { color: CHART_COLORS[3] },
        lineStyle: { color: CHART_COLORS[3] },
      },
    ],
  }
})

const hasTrend = computed(
  () => (summary.value?.revenueDaily?.length ?? 0) > 0 || (summary.value?.spendDaily?.length ?? 0) > 0,
)

// ---------- 全站账本流水 ----------
interface AdminLedgerEntry {
  id: string
  kind: string
  deltaCents: number
  balanceAfterCents: number
  sourceType: string | null
  sourceId: string | null
  reason: string | null
  userEmail?: string
  createdAt: string
}

const filters = reactive({ kind: '', sourceType: '', user: '' })

const { items, loading, error, hasPrev, hasNext, reset, next, prev, retry } = usePagedList<AdminLedgerEntry>(
  (cursor) =>
    request<Page<AdminLedgerEntry>>('/api/admin/ledger', {
      query: {
        kind: filters.kind,
        sourceType: filters.sourceType,
        user: filters.user,
        limit: 20,
        cursor,
      },
    }),
  () => filters,
)

onMounted(() => {
  loadSummary()
  reset()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="title">财务概览</span>
      <el-radio-group v-model="days" size="small" @change="loadSummary">
        <el-radio-button :value="7">近7日</el-radio-button>
        <el-radio-button :value="30">近30日</el-radio-button>
        <el-radio-button :value="90">近90日</el-radio-button>
      </el-radio-group>
    </div>

    <div v-loading="summaryLoading">
      <div class="kpi-grid">
        <StatCard
          v-for="card in totalCards"
          :key="card.label"
          :label="card.label"
          :value="card.value"
          :caption="card.caption"
          :icon="card.icon"
          :tone="card.tone"
        />
      </div>

      <PageCard title="收入 / 消耗趋势（元）" subtitle="订单入账与任务扣费按日对比" style="margin-bottom: 16px">
        <EChart v-if="hasTrend" :option="trendOption" />
        <div v-else class="card-empty" style="min-height: 280px">
          <el-empty description="暂无数据" :image-size="60">
            <div class="empty-sub">当前时间范围内没有资金流水</div>
          </el-empty>
        </div>
      </PageCard>
    </div>

    <PageCard title="全站账本流水" subtitle="全站钱包账本明细，可按类型 / 来源 / 用户筛选">
      <div class="filter-bar">
        <el-input
          v-model="filters.kind"
          placeholder="kind（如 admin_adjust）"
          size="small"
          clearable
          style="width: 180px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.sourceType"
          placeholder="来源类型（如 order / task）"
          size="small"
          clearable
          style="width: 180px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.user"
          placeholder="用户（ID / 邮箱）"
          size="small"
          clearable
          style="width: 200px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="filters.kind = ''; filters.sourceType = ''; filters.user = ''; reset()">
          重置
        </el-button>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <el-table v-loading="loading" :data="items" size="small">
        <template #empty>
          <el-empty description="暂无流水" :image-size="60">
            <div class="empty-sub">调整筛选条件后重新查询</div>
          </el-empty>
        </template>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">{{ row.userEmail ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.deltaCents >= 0 ? 'success' : 'warning'">
              {{ ledgerKindLabel(row.kind) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变动（元）" width="110" align="right" class-name="col-num">
          <template #default="{ row }">
            <span :class="row.deltaCents >= 0 ? 'delta-pos' : 'delta-neg'">
              {{ row.deltaCents >= 0 ? '+' : '' }}{{ fenToYuan(row.deltaCents) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="余额（元）" width="110" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.balanceAfterCents) }}</template>
        </el-table-column>
        <el-table-column label="来源" width="150">
          <template #default="{ row }">
            <span v-if="row.sourceType" class="mono" :title="row.sourceId ?? ''">
              {{ row.sourceType }} / {{ shortId(row.sourceId) }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="原因" min-width="160">
          <template #default="{ row }">{{ row.reason || '-' }}</template>
        </el-table-column>
      </el-table>

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
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

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.delta-pos {
  color: var(--success);
}

.delta-neg {
  color: var(--warning);
}
</style>
