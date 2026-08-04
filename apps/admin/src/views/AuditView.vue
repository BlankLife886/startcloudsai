<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { TableInstance } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
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
const tableRef = ref<TableInstance>()

const { items, loading, error, total, page, hasPrev, hasNext, reset, next, prev, retry } =
  usePagedList<AuditLog>(
    (cursor) =>
      request<Page<AuditLog>>('/api/v1/admin/audit-logs', {
        query: { admin: filters.admin, path: filters.path, limit: 20, cursor },
      }),
    () => filters,
  )

onMounted(reset)

function clearFilters() {
  filters.admin = ''
  filters.path = ''
  reset()
}

function onRowClick(row: AuditLog) {
  tableRef.value?.toggleRowExpansion(row)
}

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
    <PageCard>
      <div class="audit-toolbar">
        <div class="audit-toolbar__actions">
          <el-input
            v-model="filters.admin"
            class="audit-search"
            placeholder="管理员邮箱"
            clearable
            :prefix-icon="Search"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-input
            v-model="filters.path"
            class="audit-search"
            placeholder="path 关键字（如 /users）"
            clearable
            :prefix-icon="Search"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
        </div>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="audit-list-shell"
        viewport-height="clamp(360px, calc(100vh - 250px), 710px)"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        @prev="prev"
        @next="next"
      >
        <div class="audit-table-shell">
          <el-table
            ref="tableRef"
            v-loading="loading"
            class="audit-table"
            :data="items"
            height="100%"
            size="small"
            row-key="id"
            row-class-name="row-clickable"
            @row-click="(row: AuditLog) => onRowClick(row)"
          >
            <template #empty>
              <el-empty description="暂无审计记录" :image-size="60">
                <div class="empty-sub">调整筛选条件后重新查询</div>
              </el-empty>
            </template>
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="expand-body">
                  <div class="detail-grid">
                    <div class="detail-block">
                      <span class="detail-block__label">操作</span>
                      <span class="detail-block__value">{{ row.action || '-' }}</span>
                    </div>
                    <div class="detail-block">
                      <span class="detail-block__label">请求方式</span>
                      <span class="detail-block__value">
                        <el-tag :type="METHOD_TAG[row.method] ?? 'info'" size="small" effect="plain">{{
                          row.method
                        }}</el-tag>
                      </span>
                    </div>
                    <div class="detail-block detail-block--wide">
                      <span class="detail-block__label">路径</span>
                      <span class="detail-block__value mono">{{ row.path }}</span>
                    </div>
                  </div>
                  <template v-if="detailJson(row as AuditLog)">
                    <div class="detail-block">
                      <span class="detail-block__label">detail</span>
                      <pre class="detail-pre mono">{{ detailJson(row as AuditLog) }}</pre>
                    </div>
                  </template>
                  <span v-else class="cell-muted">无 detail</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态码" width="90" align="left" header-align="left">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="请求方式" width="100" align="left" header-align="left">
              <template #default="{ row }">
                <el-tag :type="METHOD_TAG[row.method] ?? 'info'" size="small" effect="plain">{{
                  row.method
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="路径" min-width="240" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono path-cell" :title="row.path">{{ row.path }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="160" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="action-text" :title="row.action || ''">{{ row.action || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="170" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum">{{ formatTime(row.createdAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="管理员" min-width="180" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-text">{{ row.adminEmail }}</span>
              </template>
            </el-table-column>
            <el-table-column label="目标" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span v-if="row.targetId" class="mono cell-muted" :title="row.targetId">{{
                  shortId(row.targetId)
                }}</span>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column label="IP" width="140" align="left" header-align="left">
              <template #default="{ row }">
                <span class="mono cell-muted">{{ row.ip || '-' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </AdminListShell>
    </PageCard>
  </div>
</template>

<style scoped>
:deep(.row-clickable) {
  cursor: pointer;
}

.audit-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 14px;
}

.audit-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.audit-search {
  width: min(240px, 42vw);
}

.audit-search :deep(.el-input__wrapper) {
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--border) inset;
}

.audit-list-shell {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.audit-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.audit-list-shell :deep(.cursor-pager__meta strong) {
  color: var(--ink);
}

.audit-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.audit-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.audit-table :deep(.el-table__header-wrapper th.el-table__cell),
.audit-table :deep(.el-table__body td.el-table__cell),
.audit-table :deep(.el-table .cell) {
  text-align: left !important;
}

.audit-table :deep(.el-table .cell) {
  display: block;
  justify-content: flex-start;
  padding-left: 12px;
  padding-right: 12px;
}

.audit-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.audit-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.audit-table :deep(.el-table__row td.el-table__cell) {
  height: 56px;
}

.audit-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.audit-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
}

.audit-table :deep(.el-table__expanded-cell) {
  background: var(--surface-2);
}

.path-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}

.action-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.cell-text,
.cell-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.expand-body {
  display: grid;
  gap: 14px;
  padding: 10px 16px 14px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
}

.detail-block--wide {
  grid-column: 1 / -1;
}

.detail-block {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.detail-block__label {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.detail-block__value {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
  word-break: break-word;
}

.detail-pre {
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}


</style>
