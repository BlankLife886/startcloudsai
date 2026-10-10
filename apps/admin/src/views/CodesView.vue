<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Download, Hide, Plus, Refresh, Search, Ticket, View } from '@element-plus/icons-vue'
import PageCard from '@/components/PageCard.vue'
import AdminDialog from '@/components/AdminDialog.vue'
import AdminDateRange from '@/components/AdminDateRange.vue'
import CursorPager from '@/components/CursorPager.vue'
import { normalizeList, request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { formatPoints, formatTime, normalizePoints } from '@/utils'

/** 兑换码（契约「兑换码 CDK（v5 增补）」） */
interface RedemptionCode {
  id: string
  code: string
  grantCents: number
  batchId: string
  note: string | null
  status: string
  expiresAt: string | null
  redeemedBy: string | null
  redeemedByEmail: string | null
  redeemedAt: string | null
  createdAt: string
}

interface CodeBatch {
  batchId: string
  note: string | null
  grantCents: number
  total: number
  redeemed: number
  disabled: number
  createdAt: string
}

const CODE_STATUS_LABELS: Record<string, string> = {
  active: '可用',
  redeemed: '已兑换',
  disabled: '已禁用',
}

const CODE_STATUS_TAG: Record<string, 'success' | 'info' | 'danger'> = {
  active: 'success',
  redeemed: 'info',
  disabled: 'danger',
}

interface CodeSummary {
  total: number
  active: number
  redeemed: number
  disabled: number
  expired: number
}

const STATUS_FILTERS = [
  { value: '', label: '全部', count: (s: CodeSummary) => s.total },
  { value: 'active', label: '可用', count: (s: CodeSummary) => s.active + s.expired },
  { value: 'redeemed', label: '已兑换', count: (s: CodeSummary) => s.redeemed },
  { value: 'disabled', label: '已禁用', count: (s: CodeSummary) => s.disabled },
] as const

// ---------- 码列表 ----------
const filters = reactive({ status: '', batchId: '', search: '', createdFrom: '', createdTo: '' })

const pageSize = ref(20)

/** 与当前批次、搜索、日期筛选一致的状态统计（不受状态标签影响） */
const summary = ref<CodeSummary | null>(null)

const { items, loading, error, total, page, hasPrev, hasNext, reset, goToPage, refresh, retry } =
  usePagedList<RedemptionCode>(
    async (cursor) => {
      const result = await request<Page<RedemptionCode> & { summary?: CodeSummary }>('/api/v1/admin/redemption-codes', {
        query: {
          createdFrom: filters.createdFrom,
          createdTo: filters.createdTo,
          status: filters.status,
          batchId: filters.batchId,
          search: filters.search.trim(),
          limit: pageSize.value,
          cursor,
        },
      })
      summary.value = result.summary ?? null
      selection.value = []
      return result
    },
    () => ({ ...filters, limit: pageSize.value }),
  )

const selection = ref<RedemptionCode[]>([])
const bulkDisabling = ref(false)

const hasFilters = computed(() =>
  Boolean(filters.batchId || filters.search.trim() || filters.createdFrom || filters.createdTo),
)

function isSelectable(row: RedemptionCode) {
  return row.status === 'active'
}

function filterByBatch(batchId: string) {
  if (filters.batchId === batchId) return
  filters.batchId = batchId
  void reset()
}

async function copySelected() {
  try {
    await navigator.clipboard.writeText(selection.value.map((row) => row.code).join('\n'))
    ElMessage.success(`已复制 ${selection.value.length} 个兑换码`)
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

async function disableSelected() {
  const rows = selection.value.filter(isSelectable)
  if (!rows.length) return
  await ElMessageBox.confirm(
    `确认禁用选中的 ${rows.length} 个兑换码？禁用后无法兑换，此操作不可撤销。`,
    '批量禁用兑换码',
    { type: 'warning', confirmButtonText: `禁用 ${rows.length} 个`, cancelButtonText: '取消' },
  )
  bulkDisabling.value = true
  try {
    const results = await Promise.allSettled(
      rows.map((row) =>
        request(`/api/v1/admin/redemption-codes/${row.id}`, { method: 'PATCH', body: { active: false }, silent: true }),
      ),
    )
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed) ElMessage.warning(`已禁用 ${rows.length - failed} 个，${failed} 个失败（可能已被兑换）`)
    else ElMessage.success(`已禁用 ${rows.length} 个兑换码`)
  } finally {
    bulkDisabling.value = false
    refresh()
    void loadBatches()
  }
}

function clearFilters() {
  filters.status = ''
  filters.batchId = ''
  filters.search = ''
  filters.createdFrom = ''
  filters.createdTo = ''
  void reset()
}

/** 部分打码：SC-ABCD-EFGH-JKMN → SC-AB**-****-**MN */
function maskCode(code: string): string {
  const m = /^([A-Z0-9]{2})-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/i.exec(code)
  if (!m) return code.length > 6 ? `${code.slice(0, 4)}****${code.slice(-2)}` : code
  return `${m[1]}-${m[2].slice(0, 2)}**-****-**${m[4].slice(2)}`
}

/** 点击眼睛后显示完整码的行 id */
const revealed = reactive<Record<string, boolean>>({})

function toggleReveal(id: string) {
  revealed[id] = !revealed[id]
}

async function copyCode(row: RedemptionCode) {
  try {
    await navigator.clipboard.writeText(row.code)
    ElMessage.success('兑换码已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

function isExpired(row: RedemptionCode): boolean {
  return row.status === 'active' && !!row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()
}

function displayStatus(row: RedemptionCode) {
  if (isExpired(row)) return { label: '已过期', type: 'warning' as const }
  return {
    label: CODE_STATUS_LABELS[row.status] ?? row.status,
    type: CODE_STATUS_TAG[row.status] ?? ('info' as const),
  }
}

async function disableCode(row: RedemptionCode) {
  await ElMessageBox.confirm(
    `确认禁用兑换码 ${maskCode(row.code)}？禁用后该码将无法兑换，此操作不可撤销。`,
    '禁用兑换码',
    { type: 'warning', confirmButtonText: '禁用', cancelButtonText: '取消' },
  )
  await request(`/api/v1/admin/redemption-codes/${row.id}`, {
    method: 'PATCH',
    body: { active: false },
  })
  ElMessage.success('已禁用')
  refresh()
  loadBatches()
}

// ---------- 批次汇总 ----------
const batches = ref<CodeBatch[]>([])
const batchesLoading = ref(false)

// 服务端只返回最新 50 个批次；输入关键词时按批次号或备注远程搜索，旧批次仍可选中。
let batchSearchGeneration = 0
async function loadBatches(search = '') {
  const generation = ++batchSearchGeneration
  batchesLoading.value = true
  try {
    const data = await request<CodeBatch[] | { items: CodeBatch[] }>(
      '/api/v1/admin/redemption-code-batches',
      { query: { search: search.trim() || undefined }, silent: true },
    )
    if (generation !== batchSearchGeneration) return
    const found = normalizeList(data).items
    // Keep the selected batch visible even when the latest search omits it.
    const selected = batches.value.find(batch => batch.batchId === filters.batchId)
    batches.value = selected && !found.some(batch => batch.batchId === selected.batchId) ? [selected, ...found] : found
  } catch {
    // 批次卡片加载失败不阻塞码列表
  } finally {
    batchesLoading.value = false
  }
}

const selectedBatch = computed(() => batches.value.find((batch) => batch.batchId === filters.batchId) ?? null)

function batchOptionLabel(batch: CodeBatch) {
  const note = String(batch.note || '').trim()
  return `${note || batch.batchId} · ${formatPoints(batch.grantCents)} 积分 · ${batch.total} 个`
}

function setStatus(value: string) {
  if (filters.status === value) return
  filters.status = value
  void reset()
}

onMounted(() => {
  void reset()
  void loadBatches()
})

// ---------- 生成兑换码 ----------
const genVisible = ref(false)
const genSubmitting = ref(false)
const genForm = reactive<{
  count: number
  valuePoints: number
  expiresAt: Date | null
  note: string
}>({ count: 100, valuePoints: 1000, expiresAt: null, note: '' })

function openGenerate() {
  genForm.count = 100
  genForm.valuePoints = 1000
  genForm.expiresAt = null
  genForm.note = ''
  genVisible.value = true
}

const EXPIRY_PRESETS = [
  { label: '长期', days: 0 },
  { label: '7 天', days: 7 },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
] as const

function applyExpiryPreset(days: number) {
  if (!days) {
    genForm.expiresAt = null
    return
  }
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(23, 59, 59, 0)
  genForm.expiresAt = date
}

const genTotalPoints = computed(() => Math.max(0, Math.trunc(genForm.count || 0)) * Math.max(0, genForm.valuePoints || 0))

interface GenerateResult {
  batchId: string
  grantCents: number
  codes: string[]
}

const genResult = ref<GenerateResult | null>(null)
const resultVisible = ref(false)

async function submitGenerate() {
  const count = Math.trunc(genForm.count)
  if (!Number.isFinite(count) || count < 1 || count > 1000) {
    ElMessage.warning('数量范围为 1 - 1000')
    return
  }
  const grantCents = normalizePoints(genForm.valuePoints)
  if (grantCents <= 0) {
    ElMessage.warning('面值必须大于 0 积分')
    return
  }
  if (genForm.expiresAt && genForm.expiresAt.getTime() <= Date.now()) {
    ElMessage.warning('有效期必须晚于当前时间')
    return
  }
  genSubmitting.value = true
  try {
    genResult.value = await request<GenerateResult>('/api/v1/admin/redemption-code-batches', {
      method: 'POST',
      body: {
        count,
        grantCents,
        expiresAt: genForm.expiresAt ? genForm.expiresAt.toISOString() : undefined,
        note: genForm.note.trim() || undefined,
      },
    })
    genVisible.value = false
    resultVisible.value = true
    void reset()
    void loadBatches()
  } finally {
    genSubmitting.value = false
  }
}

async function copyAllCodes() {
  if (!genResult.value) return
  try {
    await navigator.clipboard.writeText(genResult.value.codes.join('\n'))
    ElMessage.success(`已复制 ${genResult.value.codes.length} 个兑换码`)
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

function downloadCodes() {
  if (!genResult.value) return
  const blob = new Blob([genResult.value.codes.join('\n') + '\n'], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `redemption-codes-${genResult.value.batchId}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page codes-page">
    <PageCard>
      <template #header>
        <div class="codes-filters">
          <AdminDateRange v-model:from="filters.createdFrom" v-model:to="filters.createdTo" label="生成时间" @change="reset" />
          <el-select
            v-model="filters.batchId"
            filterable
            remote
            :remote-method="loadBatches"
            clearable
            placeholder="全部批次（搜索批次号或备注）"
            :loading="batchesLoading"
            class="codes-batch"
            @change="reset"
          >
            <el-option v-for="batch in batches" :key="batch.batchId" :label="batchOptionLabel(batch)" :value="batch.batchId" />
          </el-select>
          <el-input
            v-model="filters.search"
            class="codes-search"
            :prefix-icon="Search"
            placeholder="输入完整兑换码搜索"
            clearable
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button type="primary" :disabled="loading" @click="reset">查询</el-button>
          <el-button v-if="hasFilters" text @click="clearFilters">清空筛选</el-button>
        </div>
      </template>
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openGenerate">生成兑换码</el-button>
      </template>

      <div v-if="selectedBatch" class="codes-batch-context">
        <span class="mono">{{ selectedBatch.batchId }}</span>
        <strong>{{ selectedBatch.note || '无备注批次' }}</strong>
        <small>面值 {{ formatPoints(selectedBatch.grantCents) }} 积分 / 码</small>
        <el-button text size="small" @click="filterByBatch('')">查看全部批次</el-button>
      </div>

      <div class="codes-toolbar">
        <nav class="codes-tabs" role="tablist" aria-label="兑换码状态">
          <button
            v-for="option in STATUS_FILTERS"
            :key="option.value || 'all'"
            type="button"
            role="tab"
            :aria-selected="filters.status === option.value"
            :class="{ active: filters.status === option.value }"
            @click="setStatus(option.value)"
          >
            {{ option.label }}<em v-if="summary" class="tnum">{{ option.count(summary) }}</em>
          </button>
        </nav>
        <div v-if="selection.length" class="codes-toolbar__right codes-bulk">
          <span>已选 <b class="tnum">{{ selection.length }}</b> 个</span>
          <el-button size="small" :icon="CopyDocument" @click="copySelected">复制</el-button>
          <el-button size="small" type="danger" plain :loading="bulkDisabling" @click="disableSelected">批量禁用</el-button>
        </div>
        <span v-else-if="summary?.expired" class="codes-toolbar__right codes-note is-warn">{{ summary.expired }} 个可用码已过期</span>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <div v-loading="loading" class="codes-board">
        <el-table
          :data="items"
          max-height="calc(100vh - 300px)"
          row-key="id"
          class="codes-table"
          @selection-change="(rows: RedemptionCode[]) => (selection = rows)"
        >
          <template #empty>
            <el-empty :description="hasFilters || filters.status ? '没有符合条件的兑换码' : '还没有兑换码'" :image-size="60">
              <el-button v-if="hasFilters" size="small" @click="clearFilters">清空筛选</el-button>
              <el-button v-else type="primary" size="small" :icon="Plus" @click="openGenerate">生成第一批</el-button>
            </el-empty>
          </template>
          <el-table-column type="selection" width="44" :selectable="(row: RedemptionCode) => isSelectable(row)" />
          <el-table-column label="兑换码" min-width="230">
            <template #default="{ row }">
              <span class="code-cell">
                <code class="code-value">{{ revealed[row.id] ? row.code : maskCode(row.code) }}</code>
                <span class="code-cell__actions">
                  <el-tooltip :content="revealed[row.id] ? '隐藏完整码' : '查看完整码'" placement="top">
                    <el-button text size="small" :icon="revealed[row.id] ? Hide : View" :aria-label="revealed[row.id] ? '隐藏完整码' : '查看完整码'" @click="toggleReveal(row.id)" />
                  </el-tooltip>
                  <el-tooltip content="复制完整码" placement="top">
                    <el-button text size="small" :icon="CopyDocument" aria-label="复制完整码" @click="copyCode(row as RedemptionCode)" />
                  </el-tooltip>
                </span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="面值(积分)" width="110" align="right">
            <template #default="{ row }"><span class="tnum strong">{{ formatPoints(row.grantCents) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag :type="displayStatus(row as RedemptionCode).type" size="small">{{ displayStatus(row as RedemptionCode).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="兑换人" min-width="190" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.redeemedByEmail">
                {{ row.redeemedByEmail }} <small class="muted tnum">· {{ formatTime(row.redeemedAt) }}</small>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="有效期至" width="160">
            <template #default="{ row }">
              <span class="tnum" :class="isExpired(row as RedemptionCode) ? 'warn' : row.expiresAt ? '' : 'muted'">
                {{ row.expiresAt ? formatTime(row.expiresAt) : '长期有效' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="批次" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">
              <button class="codes-link" type="button" title="只看这个批次" @click="filterByBatch(row.batchId)">
                <code class="codes-id">{{ row.batchId }}</code>
              </button>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="140" show-overflow-tooltip>
            <template #default="{ row }"><span :class="{ muted: !row.note }">{{ row.note || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 'active'" text type="danger" size="small" @click="disableCode(row as RedemptionCode)">禁用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <CursorPager
        :has-prev="hasPrev"
        :has-next="hasNext"
        :page="page"
        :count="items.length"
        :total="total"
        :page-size="pageSize"
        :loading="loading"
        @update:page="goToPage"
        @update:page-size="(size: number) => { pageSize = size; reset() }"
      />
    </PageCard>

    <AdminDialog
      v-model="genVisible"
      title="生成兑换码"
      subtitle="按批次生成，明文码仅在下一屏展示一次"
      :icon="Ticket"
      width="480px"
      :confirm-text="`生成 ${Math.max(0, Math.trunc(genForm.count || 0))} 个`"
      :confirm-loading="genSubmitting"
      @confirm="submitGenerate"
    >
      <el-form label-position="top" class="codes-dialog-form" @submit.prevent>
        <div class="codes-dialog-row">
          <el-form-item label="数量" required>
            <el-input-number v-model="genForm.count" :min="1" :max="1000" :step="10" style="width: 100%" />
          </el-form-item>
          <el-form-item label="面值（积分 / 码）" required>
            <el-input-number v-model="genForm.valuePoints" :min="1" :max="100000" :precision="0" :step="100" style="width: 100%" />
          </el-form-item>
        </div>
        <el-form-item label="有效期">
          <div class="codes-expiry">
            <el-date-picker
              v-model="genForm.expiresAt"
              type="datetime"
              placeholder="留空 = 长期有效"
              :disabled-date="(date: Date) => date.getTime() < Date.now() - 86400000"
              style="width: 100%"
            />
            <div class="codes-presets">
              <el-button v-for="preset in EXPIRY_PRESETS" :key="preset.label" size="small" @click="applyExpiryPreset(preset.days)">{{ preset.label }}</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="genForm.note" placeholder="如：618 活动兑换码" maxlength="100" show-word-limit />
        </el-form-item>
        <div class="codes-dialog-total">
          本批合计最多发放 <b class="tnum">{{ genTotalPoints.toLocaleString('zh-CN') }}</b> 积分
          <small>（{{ Math.max(0, Math.trunc(genForm.count || 0)) }} 个 × {{ genForm.valuePoints || 0 }} 积分）</small>
        </div>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="resultVisible"
      title="生成成功"
      subtitle="明文码仅此一次展示，关闭后无法再次查看"
      :icon="Ticket"
      width="520px"
      :close-on-click-modal="false"
      footer-hint="请立即复制或下载保存"
      confirm-text="我已保存，关闭"
      :show-cancel="false"
      @confirm="resultVisible = false"
    >
      <template v-if="genResult">
        <div class="result-meta">
          批次 <code class="codes-id">{{ genResult.batchId }}</code> · 共 {{ genResult.codes.length }} 个 · 面值
          {{ formatPoints(genResult.grantCents) }} 积分 / 码
        </div>
        <div class="result-codes">
          <div v-for="code in genResult.codes" :key="code">{{ code }}</div>
        </div>
        <div class="result-actions">
          <el-button type="primary" :icon="CopyDocument" @click="copyAllCodes">一键全部复制</el-button>
          <el-button :icon="Download" @click="downloadCodes">下载 .txt</el-button>
        </div>
      </template>
    </AdminDialog>
  </div>
</template>

<style scoped>
/* 卡片随内容高度，数据多时表格内部滚动，分页器紧跟表格 */
.codes-page :deep(.page-card__header) { flex-wrap: wrap; padding-bottom: 0; }
.codes-page :deep(.page-card__body) { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; }

.codes-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.codes-batch { width: 240px; }
.codes-search { width: 220px; }


.codes-batch-context { display: flex; flex: 0 0 auto; align-items: center; gap: 12px; min-width: 0; padding: 6px 6px 6px 14px; border-radius: var(--radius-control); background: var(--accent-soft); color: var(--ink-2); font-size: 12px; }
.codes-batch-context strong { overflow: hidden; color: var(--ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.codes-batch-context .el-button { margin-left: auto; }

.codes-toolbar { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.codes-tabs { display: flex; gap: 2px; }
.codes-tabs button { display: inline-flex; align-items: center; margin-bottom: -1px; padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--ink-3); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.codes-tabs button:hover { color: var(--ink); }
.codes-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.codes-tabs button.active { border-bottom-color: var(--accent); color: var(--ink); font-weight: 650; }
.codes-tabs em { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; border-radius: 9px; background: var(--surface-3); color: var(--ink-2); font-size: 11px; font-style: normal; }
.codes-toolbar__right { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; }
.codes-bulk { color: var(--ink-2); font-size: 12px; }
.codes-bulk b { color: var(--ink); }
.codes-note { color: var(--ink-3); font-size: 12px; white-space: nowrap; }
.codes-note.is-warn { color: var(--warning); }

.codes-board { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.codes-table { width: 100%; }
.codes-table :deep(.cell) { white-space: nowrap; }

.code-cell { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.code-value { overflow: hidden; color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; text-overflow: ellipsis; }
.code-cell__actions { display: inline-flex; flex: 0 0 auto; }
.code-cell__actions :deep(.el-button) { color: var(--ink-3); }
.code-cell__actions :deep(.el-button:hover) { color: var(--ink); }
.code-cell__actions :deep(.el-button + .el-button) { margin-left: 0; }

.codes-id { color: var(--ink-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.codes-link { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.codes-link:hover .codes-id { color: var(--accent-ink); text-decoration: underline; }
.strong { color: var(--ink); font-weight: 700; }
.muted { color: var(--ink-3); }
.warn { color: var(--warning); font-weight: 650; }

.codes-dialog-form :deep(.el-form-item) { margin-bottom: 14px; }
.codes-dialog-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.codes-expiry { display: grid; gap: 8px; width: 100%; }
.codes-presets { display: flex; gap: 6px; }
.codes-presets :deep(.el-button + .el-button) { margin-left: 0; }
.codes-dialog-total { padding: 10px 12px; border-radius: var(--radius-control); background: var(--surface-2); color: var(--ink-2); font-size: 12px; }
.codes-dialog-total b { color: var(--ink); font-size: 15px; }
.codes-dialog-total small { color: var(--ink-3); }

.result-meta { margin-bottom: 10px; color: var(--ink-2); font-size: 12px; }
.result-codes { max-height: 260px; overflow-y: auto; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.8; user-select: all; }
.result-actions { display: flex; gap: 8px; margin-top: 12px; }

</style>
