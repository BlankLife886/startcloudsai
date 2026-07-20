<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import {
  fenToYuan,
  formatTime,
  shortId,
  TASK_STATUS_LABELS,
  TASK_STATUS_TAG,
  TASK_TYPE_LABELS,
  taskTypeLabel,
} from '@/utils'

interface AdminTask {
  id: string
  type: string
  status: string
  prompt: string
  params: Record<string, unknown> | null
  count: number
  inputKeys?: string[]
  outputKeys?: string[]
  outputUrls?: string[]
  costCents: number
  errorCode: string | null
  errorMessage: string | null
  userId?: string
  userEmail?: string
  user?: { id: string; email: string }
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

const filters = reactive({ type: '', status: '', user: '', errorCode: '' })

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<AdminTask>(
  (cursor) =>
    request<Page<AdminTask>>('/api/admin/tasks', {
      query: { type: filters.type, status: filters.status, user: filters.user, limit: 20, cursor },
    }),
)

/** 错误码为纯前端过滤（仅当前页），后端契约暂无该筛选参数 */
const displayItems = computed(() => {
  const keyword = filters.errorCode.trim().toLowerCase()
  if (!keyword) return items.value
  return items.value.filter((task) => (task.errorCode ?? '').toLowerCase().includes(keyword))
})

onMounted(reset)

function taskUser(task: AdminTask): string {
  return task.userEmail ?? task.user?.email ?? task.userId ?? '-'
}

/** 输入图直接走文件网关（302 到 R2 presigned URL） */
function fileUrl(key: string): string {
  return `/api/files/${key}`
}

// 详情抽屉
const detailVisible = ref(false)
const detail = ref<AdminTask | null>(null)

const detailParams = computed(() => {
  const params = detail.value?.params
  return params && Object.keys(params).length > 0 ? JSON.stringify(params, null, 2) : ''
})

const detailInputUrls = computed(() => (detail.value?.inputKeys ?? []).map(fileUrl))

function openDetail(task: AdminTask) {
  detail.value = task
  detailVisible.value = true
}

const acting = ref(false)

async function requeue(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认将失败任务 ${task.id} 重新入队？不会重复向用户扣费。`,
    '重新入队',
    { type: 'warning', confirmButtonText: '重新入队', cancelButtonText: '取消' },
  )
  acting.value = true
  try {
    await request(`/api/admin/tasks/${task.id}/requeue`, { method: 'POST' })
    ElMessage.success('已重新入队')
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}

async function cancel(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认取消排队中任务 ${task.id}？取消后将解冻退还该任务费用。`,
    '取消任务',
    { type: 'warning', confirmButtonText: '取消任务', cancelButtonText: '返回' },
  )
  acting.value = true
  try {
    await request(`/api/admin/tasks/${task.id}/cancel`, { method: 'POST' })
    ElMessage.success('已取消并解冻费用')
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}

async function forceFail(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认将运行中任务 ${task.id} 强制置为失败？将解冻并退还该任务冻结的费用（errorCode=admin_force_failed）。仅用于卡死任务，若任务仍在正常执行请勿操作。`,
    '强制失败',
    {
      type: 'error',
      confirmButtonText: '强制失败',
      confirmButtonClass: 'el-button--danger',
      cancelButtonText: '取消',
    },
  )
  acting.value = true
  try {
    await request(`/api/admin/tasks/${task.id}/force-fail`, { method: 'POST' })
    ElMessage.success('已强制失败并解冻退款')
    detailVisible.value = false
    refresh()
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="page">
    <PageCard title="任务监控" subtitle="全站生成任务的运行状态与人工干预">
      <div class="filter-bar">
        <el-select v-model="filters.type" placeholder="任务类型" size="small" clearable style="width: 150px" @change="reset">
          <el-option v-for="(label, value) in TASK_TYPE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态" size="small" clearable style="width: 120px" @change="reset">
          <el-option v-for="(label, value) in TASK_STATUS_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-input
          v-model="filters.user"
          placeholder="用户（ID / 邮箱）"
          size="small"
          clearable
          style="width: 200px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.errorCode"
          placeholder="错误码（当前页过滤）"
          size="small"
          clearable
          style="width: 180px"
        />
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="filters.type = ''; filters.status = ''; filters.user = ''; filters.errorCode = ''; reset()">
          重置
        </el-button>
      </div>

      <el-table v-loading="loading" :data="displayItems" size="small">
        <template #empty>
          <el-empty description="暂无任务" :image-size="60">
            <div class="empty-sub">调整筛选条件后重新查询</div>
          </el-empty>
        </template>
        <el-table-column label="任务ID" width="110">
          <template #default="{ row }">
            <span class="mono" :title="row.id">{{ shortId(row.id) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">{{ taskTypeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="TASK_STATUS_TAG[row.status] ?? 'info'" size="small">
              {{ TASK_STATUS_LABELS[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">{{ taskUser(row as AdminTask) }}</template>
        </el-table-column>
        <el-table-column label="错误码" width="130">
          <template #default="{ row }">
            <span v-if="row.errorCode" class="mono" :title="row.errorMessage ?? ''">{{ row.errorCode }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="count" label="张数" width="70" align="right" class-name="col-num" />
        <el-table-column label="费用（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.costCents) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row as AdminTask)">详情</el-button>
            <el-button
              v-if="row.status === 'failed'"
              size="small"
              type="warning"
              plain
              @click="requeue(row as AdminTask)"
            >
              重新入队
            </el-button>
            <el-button
              v-if="row.status === 'queued'"
              size="small"
              type="warning"
              plain
              @click="cancel(row as AdminTask)"
            >
              取消
            </el-button>
            <el-button
              v-if="row.status === 'running'"
              size="small"
              type="danger"
              plain
              @click="forceFail(row as AdminTask)"
            >
              强制失败
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
    </PageCard>

    <el-drawer v-model="detailVisible" title="任务详情" size="480px">
      <template v-if="detail">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="ID">
            <span class="mono">{{ detail.id }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="类型">{{ taskTypeLabel(detail.type) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="TASK_STATUS_TAG[detail.status] ?? 'info'" size="small">
              {{ TASK_STATUS_LABELS[detail.status] ?? detail.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户">{{ taskUser(detail) }}</el-descriptions-item>
          <el-descriptions-item label="费用">{{ fenToYuan(detail.costCents) }} 元</el-descriptions-item>
          <el-descriptions-item label="创建">{{ formatTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="开始">{{ formatTime(detail.startedAt) }}</el-descriptions-item>
          <el-descriptions-item label="结束">{{ formatTime(detail.finishedAt) }}</el-descriptions-item>
        </el-descriptions>

        <h4>Prompt</h4>
        <pre class="detail-pre">{{ detail.prompt || '-' }}</pre>

        <template v-if="detailParams">
          <h4>参数</h4>
          <pre class="detail-pre mono">{{ detailParams }}</pre>
        </template>

        <template v-if="detail.errorCode || detail.errorMessage">
          <h4>错误信息</h4>
          <el-alert type="error" :closable="false" :title="detail.errorCode ?? '错误'"
            :description="detail.errorMessage ?? ''" />
        </template>

        <template v-if="detailInputUrls.length">
          <h4>输入图（{{ detailInputUrls.length }}）</h4>
          <div class="thumbs">
            <el-image
              v-for="(url, i) in detailInputUrls"
              :key="url"
              :src="url"
              :preview-src-list="detailInputUrls"
              :initial-index="i"
              fit="cover"
              class="thumb"
              preview-teleported
            />
          </div>
        </template>

        <template v-if="detail.outputUrls?.length">
          <h4>产物（{{ detail.outputUrls.length }}）</h4>
          <div class="thumbs">
            <el-image
              v-for="(url, i) in detail.outputUrls"
              :key="url"
              :src="url"
              :preview-src-list="detail.outputUrls"
              :initial-index="i"
              fit="cover"
              class="thumb"
              preview-teleported
            />
          </div>
        </template>

        <div class="detail-actions">
          <el-button
            v-if="detail.status === 'failed'"
            type="warning"
            :loading="acting"
            @click="requeue(detail)"
          >
            重新入队
          </el-button>
          <el-button
            v-if="detail.status === 'queued'"
            type="warning"
            :loading="acting"
            @click="cancel(detail)"
          >
            取消任务
          </el-button>
          <el-button
            v-if="detail.status === 'running'"
            type="danger"
            :loading="acting"
            @click="forceFail(detail)"
          >
            强制失败
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.detail-pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  margin: 0;
}

h4 {
  margin: 16px 0 8px;
}

.thumbs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.thumb {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  background: var(--surface-3);
}

.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
