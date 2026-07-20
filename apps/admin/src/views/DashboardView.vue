<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { request } from '@/request'
import { fenToYuan, formatTime } from '@/utils'

interface DailyTaskStat {
  date: string
  total: number
  succeeded: number
  failed?: number
}

/**
 * /api/admin/stats 契约未给出具体字段名，按以下形状假定（见 README 契约疑问）：
 * 缺失字段时卡片显示 -，近7日表格为空态。
 */
interface AdminStats {
  totalUsers?: number
  newUsersToday?: number
  taskDaily?: DailyTaskStat[]
  revenueCents?: number
  walletBalanceCents?: number
}

const loading = ref(false)
const stats = ref<AdminStats | null>(null)
const loadedAt = ref('')

const taskDaily = computed(() => stats.value?.taskDaily ?? [])

const tasks7dTotal = computed(() => taskDaily.value.reduce((sum, d) => sum + d.total, 0))
const tasks7dSucceeded = computed(() => taskDaily.value.reduce((sum, d) => sum + d.succeeded, 0))
const tasks7dRate = computed(() =>
  tasks7dTotal.value > 0 ? Math.round((tasks7dSucceeded.value / tasks7dTotal.value) * 100) : 0,
)

function dayRate(d: DailyTaskStat): number {
  return d.total > 0 ? Math.round((d.succeeded / d.total) * 100) : 0
}

const cards = computed(() => {
  const s = stats.value
  return [
    { label: '总用户数', value: s?.totalUsers ?? '-' },
    { label: '今日新增用户', value: s?.newUsersToday ?? '-' },
    { label: '近7日任务量', value: taskDaily.value.length ? tasks7dTotal.value : '-' },
    { label: '近7日成功率', value: taskDaily.value.length ? `${tasks7dRate.value}%` : '-' },
    { label: '近30日收入（元）', value: s?.revenueCents !== undefined ? fenToYuan(s.revenueCents) : '-' },
    { label: '钱包总余额（元）', value: s?.walletBalanceCents !== undefined ? fenToYuan(s.walletBalanceCents) : '-' },
  ]
})

async function load() {
  loading.value = true
  try {
    stats.value = await request<AdminStats>('/api/admin/stats')
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

    <el-card shadow="never">
      <template #header>近7日任务</template>
      <el-table :data="taskDaily" size="small">
        <template #empty>
          <el-empty description="暂无数据" :image-size="60" />
        </template>
        <el-table-column prop="date" label="日期" width="140" />
        <el-table-column prop="total" label="任务量" width="100" />
        <el-table-column prop="succeeded" label="成功" width="100" />
        <el-table-column label="成功率">
          <template #default="{ row }">
            <div class="rate-cell">
              <div class="bar">
                <div class="bar-inner" :style="{ width: `${dayRate(row as DailyTaskStat)}%` }" />
              </div>
              <span class="rate-text">{{ dayRate(row as DailyTaskStat) }}%</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
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

.rate-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rate-cell .bar {
  flex: 1;
  max-width: 240px;
}

.rate-text {
  width: 40px;
  font-size: 12px;
  color: #606266;
}
</style>
