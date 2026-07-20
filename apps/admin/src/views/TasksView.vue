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

const filters = reactive({ type: '', status: '', user: '' })

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<AdminTask>(
  (cursor) =>
    request<Page<AdminTask>>('/api/admin/tasks', {
      query: { type: filters.type, status: filters.status, user: filters.user, limit: 20, cursor },
    }),
)

onMounted(reset)

function taskUser(task: AdminTask): string {
  return task.userEmail ?? task.user?.email ?? task.userId ?? '-'
}

// 详情抽屉
const detailVisible = ref(false)
const detail = ref<AdminTask | null>(null)

const detailParams = computed(() => {
  const params = detail.value?.params
  return params && Object.keys(params).length > 0 ? JSON.stringify(params, null, 2) : ''
})

function openDetail(task: AdminTask) {
  detail.value = task
  detailVisible.value = true
}

const requeueing = ref(false)

async function requeue(task: AdminTask) {
  await ElMessageBox.confirm(
    `确认将失败任务 ${task.id} 重新入队？不会重复向用户扣费。`,
    '重新入队',
    { type: 'warning', confirmButtonText: '重新入队', cancelButtonText: '取消' },
  )
  requeueing.value = true
  try {
    await request(`/api/admin/tasks/${task.id}/requeue`, { method: 'POST' })
    ElMessage.success('已重新入队')
    detailVisible.value = false
    refresh()
  } finally {
    requeueing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="filter-bar">
      <el-select v-model="filters.type" placeholder="任务类型" clearable style="width: 150px" @change="reset">
        <el-option v-for="(label, value) in TASK_TYPE_LABELS" :key="value" :label="label" :value="value" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px" @change="reset">
        <el-option v-for="(label, value) in TASK_STATUS_LABELS" :key="value" :label="label" :value="value" />
      </el-select>
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
        <el-empty description="暂无任务" :image-size="60" />
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
      <el-table-column label="用户" min-width="180">
        <template #default="{ row }">{{ taskUser(row as AdminTask) }}</template>
      </el-table-column>
      <el-table-column prop="count" label="张数" width="70" />
      <el-table-column label="费用（元）" width="100">
        <template #default="{ row }">{{ fenToYuan(row.costCents) }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
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
        </template>
      </el-table-column>
    </el-table>

    <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />

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

        <div v-if="detail.status === 'failed'" style="margin-top: 16px">
          <el-button type="warning" :loading="requeueing" @click="requeue(detail)">重新入队</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.detail-pre {
  background: #f5f7fa;
  border-radius: 4px;
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
  border-radius: 4px;
  background: #f0f2f5;
}
</style>
