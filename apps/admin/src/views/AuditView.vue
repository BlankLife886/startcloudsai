<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { CopyDocument, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import AdminDateRange from '@/components/AdminDateRange.vue'
import { formatTime, shortId } from '@/utils'
import { routeLabel, routeTemplate } from '@/platformLogRoutes'

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

const filters = reactive({ admin: '', path: '', method: '', createdFrom: '', createdTo: '' })
const pageSize = ref(20)

const { items, loading, error, total, totalCapped, page, hasPrev, hasNext, reset, goToPage, retry } =
  usePagedList<AuditLog>(
    (cursor, page) =>
      request<Page<AuditLog>>('/api/v1/admin/audit-logs', {
        query: { ...filters, limit: pageSize.value, cursor, page },
      }),
    () => ({ ...filters, limit: pageSize.value }),
    { pageSeek: true },
  )

onMounted(reset)

function clearFilters() {
  Object.assign(filters, { admin: '', path: '', method: '', createdFrom: '', createdTo: '' })
  reset()
}

// 请求方法对应的操作类型；筛选项与列表徽标共用。
const METHODS: Record<string, { label: string; type: 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = {
  POST: { label: '新增', type: 'primary' },
  PUT: { label: '替换', type: 'warning' },
  PATCH: { label: '修改', type: 'warning' },
  DELETE: { label: '删除', type: 'danger' },
  GET: { label: '查看', type: 'info' },
}
const methodLabel = (method: string) => METHODS[method]?.label || method
const methodType = (method: string) => METHODS[method]?.type || 'info'

// 审计记录都是后台接口，名称里省略"后台 · "前缀；识别不了时退回服务端的动作代码。
// 名称末尾只是重复请求方法的动词（如"用户管理 · 修改"）时去掉，由前面的彩色徽标表达。
const VERB_SUFFIXES: Record<string, string[]> = { POST: ['提交', '新增'], PUT: ['修改', '替换'], PATCH: ['修改'], DELETE: ['删除'], GET: ['查询', '详情'] }
function operationLabel(log: AuditLog) {
  let label = routeLabel(log.path, log.method).replace(/^后台 · /, '')
  for (const verb of VERB_SUFFIXES[log.method] || []) {
    if (label.endsWith(` · ${verb}`)) label = label.slice(0, -(verb.length + 3))
  }
  return label || log.action || log.path
}

function resultLabel(status: number) {
  if (status >= 500) return '服务错误'
  if (status >= 400) return '失败'
  return '成功'
}
function resultType(status: number): 'success' | 'warning' | 'danger' {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  return 'success'
}
const shortTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function detailJson(log: AuditLog): string {
  if (log.detail === null || log.detail === undefined) return ''
  if (typeof log.detail === 'string') {
    try {
      return JSON.stringify(JSON.parse(log.detail), null, 2)
    } catch {
      return log.detail
    }
  }
  return Object.keys(log.detail).length ? JSON.stringify(log.detail, null, 2) : ''
}

const selected = ref<AuditLog | null>(null)
const detailOpen = ref(false)
const selectedDetail = computed(() => (selected.value ? detailJson(selected.value) : ''))
function openDetail(row: AuditLog) {
  selected.value = row
  detailOpen.value = true
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.error('复制失败，请手动选择文本复制')
  }
}
</script>

<template>
  <div class="page audit-page">
    <PageCard>
      <template #header>
        <div class="audit-filters">
          <AdminDateRange v-model:from="filters.createdFrom" v-model:to="filters.createdTo" label="操作时间" @change="reset" />
          <el-select v-model="filters.method" clearable placeholder="全部操作" class="audit-method" @change="reset">
            <el-option v-for="(item, method) in METHODS" :key="method" :label="`${item.label}（${method}）`" :value="method" />
          </el-select>
          <el-input v-model="filters.admin" class="audit-search" placeholder="管理员邮箱" clearable :prefix-icon="Search" @keyup.enter="reset" @clear="reset" />
          <el-input v-model="filters.path" class="audit-search" placeholder="接口路径关键字，如 /users" clearable :prefix-icon="Search" @keyup.enter="reset" @clear="reset" />
        </div>
      </template>
      <template #actions>
        <el-button type="primary" :loading="loading" @click="reset">查询</el-button>
        <el-button text @click="clearFilters">重置</el-button>
      </template>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="audit-list-shell"
        fill
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        :total-capped="totalCapped"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="(size: number) => { pageSize = size; reset() }"
      >
        <el-table v-loading="loading" class="audit-table" :data="items" height="100%" row-key="id" @row-click="openDetail">
          <template #empty>
            <el-empty description="暂无审计记录" :image-size="60"><div class="empty-sub">调整筛选条件后重新查询</div></el-empty>
          </template>
          <el-table-column label="时间" width="134">
            <template #default="{ row }"><span class="tnum">{{ shortTime(row.createdAt) }}</span></template>
          </el-table-column>
          <el-table-column label="管理员" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.adminEmail || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="audit-op">
                <el-tag :type="methodType(row.method)" size="small" effect="plain">{{ methodLabel(row.method) }}</el-tag>
                <strong :title="`${row.method} ${row.path}`">{{ operationLabel(row as AuditLog) }}</strong>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="对象" width="120">
            <template #default="{ row }">
              <span v-if="row.targetId" class="mono muted" :title="row.targetId">{{ shortId(row.targetId) }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="128">
            <template #default="{ row }">
              <el-tag :type="resultType(row.status)" size="small">{{ resultLabel(row.status) }} · {{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }"><span class="mono muted">{{ row.ip || '—' }}</span></template>
          </el-table-column>
        </el-table>
      </AdminListShell>
    </PageCard>

    <el-drawer v-model="detailOpen" size="min(620px, 96vw)" append-to-body>
      <template #header>
        <div v-if="selected" class="audit-head">
          <div class="audit-head__title">
            <el-tag :type="methodType(selected.method)" size="small" effect="plain">{{ methodLabel(selected.method) }}</el-tag>
            <strong>{{ operationLabel(selected) }}</strong>
          </div>
          <span>{{ selected.adminEmail || '未知管理员' }} · {{ formatTime(selected.createdAt) }}</span>
        </div>
      </template>
      <div v-if="selected" class="audit-detail">
        <dl class="audit-facts">
          <div><dt>结果</dt><dd><el-tag :type="resultType(selected.status)" size="small">{{ resultLabel(selected.status) }} · {{ selected.status }}</el-tag></dd></div>
          <div><dt>来源 IP</dt><dd class="mono">{{ selected.ip || '未记录' }}</dd></div>
          <div class="is-wide"><dt>请求</dt><dd class="mono">{{ selected.method }} {{ selected.path }}</dd></div>
          <div v-if="routeTemplate(selected.path) !== selected.path" class="is-wide"><dt>接口模板</dt><dd class="mono muted">{{ routeTemplate(selected.path) }}</dd></div>
          <div v-if="selected.targetId" class="is-wide">
            <dt>操作对象</dt>
            <dd class="mono audit-copy">{{ selected.targetId }}<el-button text size="small" :icon="CopyDocument" @click="copyText(selected.targetId, '对象 ID')" /></dd>
          </div>
          <div><dt>动作代码</dt><dd class="mono muted">{{ selected.action || '—' }}</dd></div>
          <div><dt>记录 ID</dt><dd class="mono muted">{{ shortId(selected.id) }}</dd></div>
        </dl>
        <section class="audit-payload">
          <header>
            <strong>请求详情</strong>
            <el-button v-if="selectedDetail" text size="small" :icon="CopyDocument" @click="copyText(selectedDetail, '请求详情')">复制</el-button>
          </header>
          <pre v-if="selectedDetail" class="mono">{{ selectedDetail }}</pre>
          <p v-else class="muted">这条记录没有附带请求详情。</p>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
/* 卡片填满视口：表格在内部滚动，分页器固定在底部 */
.audit-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow-y: auto; }
.audit-page :deep(.page-card) { display: flex; flex: 1 1 0; flex-direction: column; min-height: 480px; overflow: hidden; }
.audit-page :deep(.page-card__header) { flex-wrap: wrap; }
.audit-page :deep(.page-card__body) { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }

.audit-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.audit-method { width: 140px; }
.audit-search { width: 220px; }

.audit-list-shell { flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.audit-table :deep(.el-table__row) { cursor: pointer; }
.audit-table :deep(.cell) { white-space: nowrap; }
.audit-op { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.audit-op strong { overflow: hidden; font-weight: 650; text-overflow: ellipsis; }
.empty-sub { color: var(--ink-3); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.muted { color: var(--ink-3); }

.audit-head { display: grid; gap: 4px; min-width: 0; }
.audit-head__title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.audit-head strong { overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.audit-head > span { color: var(--ink-3); font-size: 12px; }
.audit-detail { display: grid; gap: 16px; }
.audit-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 0; }
.audit-facts > div { display: grid; gap: 3px; min-width: 0; }
.audit-facts > div.is-wide { grid-column: 1 / -1; }
.audit-facts dt { color: var(--ink-3); font-size: 12px; }
.audit-facts dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.audit-copy { display: flex; align-items: center; gap: 4px; }
.audit-payload { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.audit-payload header { display: flex; align-items: center; justify-content: space-between; }
.audit-payload header strong { font-size: 13px; }
.audit-payload pre { max-height: 420px; margin: 0; overflow: auto; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--ink); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.audit-payload p { margin: 0; font-size: 12px; }
</style>
