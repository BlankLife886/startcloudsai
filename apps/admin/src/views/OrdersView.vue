<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { fenToYuan, formatTime, ORDER_STATUS_LABELS, ORDER_STATUS_TAG, shortId } from '@/utils'

interface AdminOrder {
  id: string
  status: string
  amountCents: number
  createdAt: string
  paidAt?: string | null
  completedAt?: string | null
  userId?: string
  userEmail?: string
  user?: { id: string; email: string }
  planId?: string
  planName?: string
  plan?: { id: string; name: string }
}

const filters = reactive({ status: '', search: '' })

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<AdminOrder>(
  (cursor) =>
    request<Page<AdminOrder>>('/api/admin/orders', {
      query: { status: filters.status, search: filters.search, limit: 20, cursor },
    }),
)

onMounted(reset)

function orderUser(order: AdminOrder): string {
  return order.userEmail ?? order.user?.email ?? order.userId ?? '-'
}

function orderPlan(order: AdminOrder): string {
  return order.planName ?? order.plan?.name ?? order.planId ?? '-'
}

function canComplete(order: AdminOrder): boolean {
  return order.status === 'pending' || order.status === 'paid'
}

async function complete(order: AdminOrder) {
  await ElMessageBox.confirm(
    `确认对订单 ${order.id} 人工补单？将按套餐金额幂等入账到用户钱包，此操作不可撤销。`,
    '人工补单',
    { type: 'warning', confirmButtonText: '确认补单', cancelButtonText: '取消' },
  )
  await request(`/api/admin/orders/${order.id}/complete`, { method: 'POST' })
  ElMessage.success('补单成功')
  refresh()
}
</script>

<template>
  <div class="page">
    <PageCard title="订单列表" subtitle="全站充值订单，支持人工补单">
      <div class="filter-bar">
        <el-select v-model="filters.status" placeholder="订单状态" size="small" clearable style="width: 130px" @change="reset">
          <el-option v-for="(label, value) in ORDER_STATUS_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-input
          v-model="filters.search"
          placeholder="搜索用户邮箱 / 订单号"
          size="small"
          clearable
          style="width: 220px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="filters.status = ''; filters.search = ''; reset()">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small">
        <template #empty>
          <el-empty description="暂无订单" :image-size="60">
            <div class="empty-sub">调整筛选条件后重新查询</div>
          </el-empty>
        </template>
        <el-table-column label="订单ID" width="110">
          <template #default="{ row }">
            <span class="mono" :title="row.id">{{ shortId(row.id) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">{{ orderUser(row as AdminOrder) }}</template>
        </el-table-column>
        <el-table-column label="套餐" min-width="140">
          <template #default="{ row }">{{ orderPlan(row as AdminOrder) }}</template>
        </el-table-column>
        <el-table-column label="金额（元）" width="110" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.amountCents) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="ORDER_STATUS_TAG[row.status] ?? 'info'" size="small">
              {{ ORDER_STATUS_LABELS[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="支付时间" width="170">
          <template #default="{ row }">{{ formatTime(row.paidAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canComplete(row as AdminOrder)"
              size="small"
              type="warning"
              plain
              @click="complete(row as AdminOrder)"
            >
              人工补单
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
    </PageCard>
  </div>
</template>
