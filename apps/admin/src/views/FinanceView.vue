<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { fenToYuan, formatTime, ledgerKindLabel, shortId } from '@/utils'
import EChart, { type EChartOption } from '@/components/EChart.vue'

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

const totalCards = computed(() => {
  const t = summary.value?.totals
  return [
    { label: `近${days.value}日收入（元）`, value: t ? fenToYuan(t.revenueCents) : '-' },
    { label: `近${days.value}日消耗（元）`, value: t ? fenToYuan(t.spendCents) : '-' },
    { label: `近${days.value}日入账（元）`, value: t ? fenToYuan(t.grantCents) : '-' },
    { label: `近${days.value}日退款（元）`, value: t ? fenToYuan(t.refundCents) : '-' },
  ]
})

/** 收入 / 消耗双折线（按日期对齐，分 → 元） */
const trendOption = computed<EChartOption>(() => {
  const revenue = summary.value?.revenueDaily ?? []
  const spend = summary.value?.spendDaily ?? []
  const dates = [...new Set([...revenue.map((d) => d.date), ...spend.map((d) => d.date)])].sort()
  const revenueMap = new Map(revenue.map((d) => [d.date, d.amountCents / 100]))
  const spendMap = new Map(spend.map((d) => [d.date, d.amountCents / 100]))
  return {
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${value ?? 0} 元` },
    legend: { data: ['收入', '消耗'], top: 0 },
    grid: { left: 48, right: 16, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value' },
    series: [
      {
        name: '收入',
        type: 'line',
        smooth: true,
        data: dates.map((d) => revenueMap.get(d) ?? 0),
        itemStyle: { color: '#409eff' },
        lineStyle: { color: '#409eff' },
      },
      {
        name: '消耗',
        type: 'line',
        smooth: true,
        data: dates.map((d) => spendMap.get(d) ?? 0),
        itemStyle: { color: '#e6a23c' },
        lineStyle: { color: '#e6a23c' },
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

const { items, loading, hasPrev, hasNext, reset, next, prev } = usePagedList<AdminLedgerEntry>(
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
      <div class="cards">
        <el-card v-for="card in totalCards" :key="card.label" shadow="never">
          <div class="stat-value">{{ card.value }}</div>
          <div class="stat-label">{{ card.label }}</div>
        </el-card>
      </div>

      <el-card shadow="never" style="margin-bottom: 16px">
        <template #header>收入 / 消耗趋势（元）</template>
        <EChart v-if="hasTrend" :option="trendOption" />
        <el-empty v-else description="暂无数据" :image-size="60" />
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>全站账本流水</template>
      <div class="filter-bar">
        <el-input
          v-model="filters.kind"
          placeholder="kind（如 admin_adjust）"
          clearable
          style="width: 180px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.sourceType"
          placeholder="来源类型（如 order / task）"
          clearable
          style="width: 180px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.user"
          placeholder="用户（ID / 邮箱）"
          clearable
          style="width: 200px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-button type="primary" @click="reset">查询</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small">
        <template #empty>
          <el-empty description="暂无流水" :image-size="60" />
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
        <el-table-column label="变动（元）" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.deltaCents >= 0 ? 'delta-pos' : 'delta-neg'">
              {{ row.deltaCents >= 0 ? '+' : '' }}{{ fenToYuan(row.deltaCents) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="余额（元）" width="110" align="right">
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
    </el-card>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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

.delta-pos {
  color: #67c23a;
}

.delta-neg {
  color: #e6a23c;
}
</style>
