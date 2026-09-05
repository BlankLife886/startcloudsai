<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Download, Hide, Plus, Refresh, Search, Ticket, View } from '@element-plus/icons-vue'
import AdminDialog from '@/components/AdminDialog.vue'
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

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'active', label: '可用' },
  { value: 'redeemed', label: '已兑换' },
  { value: 'disabled', label: '已禁用' },
] as const

// ---------- 码列表 ----------
const filters = reactive({ status: '', batchId: '', search: '' })

const pageSize = ref(20)

const { items, loading, error, total, page, hasPrev, hasNext, reset, goToPage, refresh, retry } =
  usePagedList<RedemptionCode>(
    (cursor) =>
      request<Page<RedemptionCode>>('/api/v1/admin/redemption-codes', {
        query: {
          status: filters.status,
          batchId: filters.batchId,
          search: filters.search.trim(),
          limit: pageSize.value,
          cursor,
        },
      }),
    () => ({ ...filters, limit: pageSize.value }),
  )

function clearFilters() {
  filters.status = ''
  filters.batchId = ''
  filters.search = ''
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

async function loadBatches() {
  batchesLoading.value = true
  try {
    const data = await request<CodeBatch[] | { items: CodeBatch[] }>(
      '/api/v1/admin/redemption-code-batches',
      { silent: true },
    )
    batches.value = normalizeList(data).items
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
  <div class="page">
    <PageCard>
      <div class="codes-toolbar">
        <div class="status-tabs" role="tablist" aria-label="兑换码状态">
          <button
            v-for="option in STATUS_FILTERS"
            :key="option.value || 'all'"
            type="button"
            role="tab"
            class="status-tab"
            :class="{ 'is-active': filters.status === option.value }"
            :aria-selected="filters.status === option.value"
            @click="setStatus(option.value)"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="codes-toolbar__actions">
          <el-select
            v-model="filters.batchId"
            filterable
            clearable
            placeholder="全部批次"
            :loading="batchesLoading"
            class="batch-select"
            @change="reset"
          >
            <el-option
              v-for="batch in batches"
              :key="batch.batchId"
              :label="batchOptionLabel(batch)"
              :value="batch.batchId"
            />
          </el-select>
          <el-input
            v-model="filters.search"
            class="codes-search"
            :prefix-icon="Search"
            placeholder="搜索完整兑换码"
            clearable
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openGenerate">生成兑换码</el-button>
        </div>
      </div>

      <div v-if="selectedBatch" class="batch-context">
        <span class="mono">{{ selectedBatch.batchId }}</span>
        <strong>{{ selectedBatch.note || '无备注批次' }}</strong>
        <small>
          面值 {{ formatPoints(selectedBatch.grantCents) }} 积分 · 共 {{ selectedBatch.total }} 个 · 已兑换
          {{ selectedBatch.redeemed }} 个 · 已禁用 {{ selectedBatch.disabled }} 个
        </small>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="codes-list-shell"
        viewport-height="clamp(360px, calc(100vh - 250px), 710px)"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        :page-size="pageSize"
        @update:page="goToPage"
        @update:page-size="(size: number) => { pageSize = size; reset() }"
      >
        <div class="codes-table-shell">
          <el-table
            v-loading="loading"
            class="codes-table"
            :data="items"
            height="100%"
            size="small"
            table-layout="fixed"
          >
            <template #empty>
              <el-empty description="暂无兑换码" :image-size="60">
                <div class="empty-sub">调整筛选条件，或生成新的兑换码</div>
              </el-empty>
            </template>
            <el-table-column label="兑换码" min-width="230" align="left" header-align="left">
              <template #default="{ row }">
                <span class="code-cell">
                  <span class="mono cell-num">{{ revealed[row.id] ? row.code : maskCode(row.code) }}</span>
                  <span class="code-cell__actions">
                    <el-button
                      text
                      size="small"
                      :icon="revealed[row.id] ? Hide : View"
                      :title="revealed[row.id] ? '隐藏完整码' : '查看完整码'"
                      @click="toggleReveal(row.id)"
                    />
                    <el-button
                      text
                      size="small"
                      :icon="CopyDocument"
                      title="复制完整码"
                      @click="copyCode(row as RedemptionCode)"
                    />
                  </span>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="面值(积分)" width="120" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-num tnum">{{ formatPoints(row.grantCents) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="兑换信息" min-width="190" align="left" header-align="left">
              <template #default="{ row }">
                <span v-if="row.redeemedByEmail" class="redeem-cell">
                  <strong class="cell-text" :title="row.redeemedByEmail">{{ row.redeemedByEmail }}</strong>
                  <small class="cell-muted tnum">{{ formatTime(row.redeemedAt) }}</small>
                </span>
                <span v-else class="cell-muted">尚未兑换</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="92" align="left" header-align="left">
              <template #default="{ row }">
                <el-tag :type="displayStatus(row as RedemptionCode).type" size="small" effect="light">
                  {{ displayStatus(row as RedemptionCode).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="有效期" width="155" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum" :class="{ 'is-expired': isExpired(row as RedemptionCode) }">
                  {{ row.expiresAt ? formatTime(row.expiresAt) : '长期有效' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="批次" min-width="160" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono cell-text" :title="row.batchId">{{ row.batchId }}</span>
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="140" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-muted" :title="row.note ?? ''">{{ row.note || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="88" fixed="right" align="left" header-align="left">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'active'"
                  size="small"
                  type="danger"
                  plain
                  @click="disableCode(row as RedemptionCode)"
                >
                  禁用
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </AdminListShell>
    </PageCard>

    <AdminDialog
      v-model="genVisible"
      title="生成兑换码"
      subtitle="按批次生成，明文码仅在下一屏展示一次"
      :icon="Ticket"
      width="480px"
      confirm-text="生成"
      :confirm-loading="genSubmitting"
      @confirm="submitGenerate"
    >
      <el-form label-position="top" class="codes-dialog-form">
        <el-form-item label="数量" required>
          <el-input-number v-model="genForm.count" :min="1" :max="1000" :step="10" style="width: 100%" />
          <span class="codes-dialog-hint">单批 1 - 1000 个</span>
        </el-form-item>
        <el-form-item label="面值（积分）" required>
          <el-input-number
            v-model="genForm.valuePoints"
            :min="1"
            :max="100000"
            :precision="0"
            :step="100"
            style="width: 100%"
          />
          <span class="codes-dialog-hint">每个兑换码入账积分</span>
        </el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="genForm.expiresAt"
            type="datetime"
            placeholder="留空 = 长期有效"
            :disabled-date="(date: Date) => date.getTime() < Date.now() - 86400000"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="genForm.note" placeholder="如：618 活动兑换码" maxlength="100" show-word-limit />
        </el-form-item>
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
        <div class="result-meta text-muted">
          批次 <span class="mono">{{ genResult.batchId }}</span> · 共 {{ genResult.codes.length }} 个 · 面值
          {{ formatPoints(genResult.grantCents) }} 积分 / 码
        </div>
        <div class="result-codes mono">
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
.codes-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.status-tab {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}

html.dark .status-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.codes-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.batch-select {
  width: min(220px, 34vw);
}

.codes-search {
  width: min(240px, 36vw);
}

.codes-search :deep(.el-input__wrapper) {
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--border) inset;
}

.batch-select :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 999px;
}

.batch-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin: -4px 0 14px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  border-radius: calc(var(--radius-card) - 6px);
  background: var(--accent-soft);
  color: var(--ink-2);
}

.batch-context span,
.batch-context strong,
.batch-context small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-context strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.batch-context small {
  color: var(--ink-2);
  font-size: 12px;
}

.codes-list-shell {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.codes-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.codes-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.codes-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.codes-table :deep(.el-table__header-wrapper th.el-table__cell),
.codes-table :deep(.el-table__body td.el-table__cell),
.codes-table :deep(.el-table .cell) {
  text-align: left !important;
}

.codes-table :deep(.el-table .cell) {
  display: block;
  justify-content: flex-start;
  padding-left: 12px;
  padding-right: 12px;
}

.codes-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.codes-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.codes-table :deep(.el-table__row td.el-table__cell) {
  height: 56px;
}

.codes-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.codes-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
}

.code-cell {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.code-cell > .mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-cell__actions {
  display: inline-flex;
  flex: 0 0 auto;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.code-cell:hover .code-cell__actions {
  opacity: 1;
}

.code-cell__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.redeem-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.redeem-cell strong,
.redeem-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-text,
.cell-num,
.cell-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-text.is-expired {
  color: var(--warning);
  font-weight: 650;
}

.cell-num {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.codes-dialog-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.codes-dialog-hint {
  display: block;
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
}

.result-meta {
  margin-bottom: 10px;
  font-size: 12px;
}

.result-codes {
  max-height: 260px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13px;
  line-height: 1.8;
  user-select: all;
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 900px) {
  .codes-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .codes-toolbar__actions {
    width: 100%;
  }

  .batch-select,
  .codes-search {
    flex: 1;
    width: auto;
    min-width: 0;
  }
}
</style>
