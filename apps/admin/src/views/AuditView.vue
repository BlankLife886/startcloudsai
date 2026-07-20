<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { formatTime, shortId } from '@/utils'

interface AuditLog {
  id: string
  adminEmail: string
  method: string
  path: string
  action: string
  targetId: string | null
  status: number
  ip: string | null
  createdAt: string
  detail: Record<string, unknown> | string | null
}

const filters = reactive({ admin: '', path: '' })

const { items, loading, hasPrev, hasNext, reset, next, prev } = usePagedList<AuditLog>((cursor) =>
  request<Page<AuditLog>>('/api/admin/audit-logs', {
    query: { admin: filters.admin, path: filters.path, limit: 20, cursor },
  }),
)

onMounted(reset)

function statusTag(status: number): 'success' | 'warning' | 'danger' {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  return 'success'
}

function detailJson(log: AuditLog): string {
  if (log.detail === null || log.detail === undefined) return ''
  if (typeof log.detail === 'string') {
    try {
      return JSON.stringify(JSON.parse(log.detail), null, 2)
    } catch {
      return log.detail
    }
  }
  return JSON.stringify(log.detail, null, 2)
}

const METHOD_TAG: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  POST: 'primary',
  PATCH: 'warning',
  PUT: 'warning',
  DELETE: 'danger',
}
</script>

<template>
  <div class="page">
    <PageCard title="审计日志" subtitle="管理员敏感操作的完整记录，展开行可查看 detail">
      <div class="filter-bar">
        <el-input
          v-model="filters.admin"
          placeholder="管理员邮箱"
          size="small"
          clearable
          style="width: 220px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.path"
          placeholder="path 关键字（如 /users）"
          size="small"
          clearable
          style="width: 220px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="filters.admin = ''; filters.path = ''; reset()">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="items" size="small" row-key="id">
        <template #empty>
          <el-empty description="暂无审计记录" :image-size="60">
            <div class="empty-sub">调整筛选条件后重新查询</div>
          </el-empty>
        </template>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-body">
              <template v-if="detailJson(row as AuditLog)">
                <pre class="detail-pre mono">{{ detailJson(row as AuditLog) }}</pre>
              </template>
              <span v-else class="text-muted">无 detail</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="adminEmail" label="管理员" min-width="180" />
        <el-table-column label="操作" min-width="140">
          <template #default="{ row }">{{ row.action || '-' }}</template>
        </el-table-column>
        <el-table-column label="请求" min-width="240">
          <template #default="{ row }">
            <el-tag :type="METHOD_TAG[row.method] ?? 'info'" size="small">{{ row.method }}</el-tag>
            <span class="mono" style="margin-left: 6px">{{ row.path }}</span>
          </template>
        </el-table-column>
        <el-table-column label="目标" width="110">
          <template #default="{ row }">
            <span v-if="row.targetId" class="mono" :title="row.targetId">{{ shortId(row.targetId) }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态码" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="140">
          <template #default="{ row }">
            <span class="mono">{{ row.ip || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
    </PageCard>
  </div>
</template>

<style scoped>
.expand-body {
  padding: 8px 16px;
}

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
</style>
