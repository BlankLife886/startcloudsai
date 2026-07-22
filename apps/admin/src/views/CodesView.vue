<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Download, Hide, Plus, Refresh, Search, View } from '@element-plus/icons-vue'
import { normalizeList, request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { fenToYuan, formatTime, yuanToFen } from '@/utils'

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

const { items, loading, error, hasPrev, hasNext, reset, next, prev, refresh, retry } =
  usePagedList<RedemptionCode>(
    (cursor) =>
      request<Page<RedemptionCode>>('/api/admin/redemption-codes', {
        query: {
          status: filters.status,
          batchId: filters.batchId,
          search: filters.search.trim(),
          limit: 20,
          cursor,
        },
      }),
    () => filters,
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
  await request(`/api/admin/redemption-codes/${row.id}/disable`, { method: 'POST' })
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
      '/api/admin/redemption-codes/batches',
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
  return `${note || batch.batchId} · ${fenToYuan(batch.grantCents)} 元 · ${batch.total} 个`
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
  valueYuan: number
  expiresAt: Date | null
  note: string
}>({ count: 100, valueYuan: 10, expiresAt: null, note: '' })

function openGenerate() {
  genForm.count = 100
  genForm.valueYuan = 10
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
  const grantCents = yuanToFen(genForm.valueYuan)
  if (grantCents <= 0) {
    ElMessage.warning('面值必须大于 0 元')
    return
  }
  if (genForm.expiresAt && genForm.expiresAt.getTime() <= Date.now()) {
    ElMessage.warning('有效期必须晚于当前时间')
    return
  }
  genSubmitting.value = true
  try {
    genResult.value = await request<GenerateResult>('/api/admin/redemption-codes/generate', {
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
  <div class="codes-page">
    <header class="codes-header">
      <div class="codes-header__copy">
        <span>REDEMPTION CODES</span>
        <h2>兑换码</h2>
        <p>{{ batches.length }} 个批次 · 当前列表 {{ items.length }} 条</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openGenerate">生成兑换码</el-button>
    </header>

    <section class="codes-list-panel">
      <div class="codes-toolbar">
        <div class="status-tabs" role="tablist" aria-label="兑换码状态">
          <button
            v-for="option in STATUS_FILTERS"
            :key="option.value || 'all'"
            type="button"
            role="tab"
            :aria-selected="filters.status === option.value"
            :class="{ 'is-active': filters.status === option.value }"
            @click="setStatus(option.value)"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="codes-toolbar__filters">
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
            :prefix-icon="Search"
            placeholder="搜索完整兑换码"
            clearable
            class="code-search"
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button type="primary" @click="reset">查询</el-button>
          <el-button v-if="filters.status || filters.batchId || filters.search" text @click="clearFilters">重置</el-button>
          <el-tooltip content="刷新列表" placement="top">
            <el-button :icon="Refresh" circle :loading="loading" aria-label="刷新列表" @click="refresh" />
          </el-tooltip>
        </div>
      </div>

      <div v-if="selectedBatch" class="batch-context">
        <span class="mono">{{ selectedBatch.batchId }}</span>
        <strong>{{ selectedBatch.note || '无备注批次' }}</strong>
        <small>
          面值 {{ fenToYuan(selectedBatch.grantCents) }} 元 · 共 {{ selectedBatch.total }} 个 · 已兑换
          {{ selectedBatch.redeemed }} 个 · 已禁用 {{ selectedBatch.disabled }} 个
        </small>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <div class="codes-table-shell">
        <el-table v-loading="loading" :data="items" size="small" table-layout="fixed">
        <template #empty>
          <el-empty description="暂无兑换码" :image-size="60">
            <div class="empty-sub">调整筛选条件，或生成新的兑换码</div>
          </el-empty>
        </template>
        <el-table-column label="兑换码" min-width="230">
          <template #default="{ row }">
            <span class="code-cell">
              <span class="mono">{{ revealed[row.id] ? row.code : maskCode(row.code) }}</span>
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
        <el-table-column label="批次" min-width="185">
          <template #default="{ row }">
            <span class="batch-cell">
              <strong class="mono" :title="row.batchId">{{ row.batchId }}</strong>
              <small :title="row.note ?? ''">{{ row.note || '无备注' }}</small>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="面值" width="92" align="right" class-name="col-num">
          <template #default="{ row }"><strong class="value-cell tnum">{{ fenToYuan(row.grantCents) }} 元</strong></template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag :type="displayStatus(row as RedemptionCode).type" size="small" effect="light">
              {{ displayStatus(row as RedemptionCode).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="有效期" width="155">
          <template #default="{ row }">
            <span class="time-cell" :class="{ 'is-expired': isExpired(row as RedemptionCode) }">
              {{ row.expiresAt ? formatTime(row.expiresAt) : '长期有效' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="兑换信息" min-width="190">
          <template #default="{ row }">
            <span v-if="row.redeemedByEmail" class="redeem-cell">
              <strong :title="row.redeemedByEmail">{{ row.redeemedByEmail }}</strong>
              <small>{{ formatTime(row.redeemedAt) }}</small>
            </span>
            <span v-else class="cell-muted">尚未兑换</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="78" fixed="right" align="right">
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

      <footer class="codes-list-footer">
        <span>本页 {{ items.length }} 条</span>
        <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
      </footer>
    </section>

    <!-- 生成兑换码 -->
    <el-dialog v-model="genVisible" title="生成兑换码" width="480px">
      <el-form label-width="100px">
        <el-form-item label="数量" required>
          <el-input-number v-model="genForm.count" :min="1" :max="1000" :step="10" style="width: 180px" />
          <span class="text-muted" style="margin-left: 8px">单批 1 - 1000 个</span>
        </el-form-item>
        <el-form-item label="面值（元）" required>
          <el-input-number
            v-model="genForm.valueYuan"
            :min="0.01"
            :max="100000"
            :precision="2"
            :step="1"
            style="width: 180px"
          />
          <span class="text-muted" style="margin-left: 8px">= {{ yuanToFen(genForm.valueYuan) }} 分 / 码</span>
        </el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="genForm.expiresAt"
            type="datetime"
            placeholder="留空 = 长期有效"
            :disabled-date="(date: Date) => date.getTime() < Date.now() - 86400000"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="genForm.note" placeholder="如：618 活动兑换码" maxlength="100" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button type="primary" :loading="genSubmitting" @click="submitGenerate">生成</el-button>
      </template>
    </el-dialog>

    <!-- 生成结果（明文码仅此一次） -->
    <el-dialog v-model="resultVisible" title="生成成功" width="520px" :close-on-click-modal="false">
      <template v-if="genResult">
        <p class="result-warning">明文码仅此一次展示，关闭后无法再次查看，请立即复制或下载保存。</p>
        <div class="result-meta text-muted">
          批次 <span class="mono">{{ genResult.batchId }}</span> · 共 {{ genResult.codes.length }} 个 · 面值
          {{ fenToYuan(genResult.grantCents) }} 元 / 码
        </div>
        <div class="result-codes mono">
          <div v-for="code in genResult.codes" :key="code">{{ code }}</div>
        </div>
        <div class="result-actions">
          <el-button type="primary" :icon="CopyDocument" @click="copyAllCodes">一键全部复制</el-button>
          <el-button :icon="Download" @click="downloadCodes">下载 .txt</el-button>
        </div>
      </template>
      <template #footer>
        <el-button type="primary" @click="resultVisible = false">我已保存，关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.codes-page {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 24px 28px;
}

.codes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.codes-header__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.codes-header__copy > span {
  color: var(--accent-ink);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0;
}

.codes-header h2 {
  margin: 0;
  color: var(--ink);
  font-size: 20px;
  line-height: 1.3;
}

.codes-header p {
  margin: 0;
  color: var(--ink-3);
  font-size: 12px;
}

.codes-list-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.codes-toolbar {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.status-tabs {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.status-tabs button {
  min-width: 58px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  background: transparent;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-tabs button:hover {
  color: var(--ink);
  background: var(--surface-3);
}

.status-tabs button.is-active {
  color: var(--accent-ink);
  font-weight: 650;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.codes-toolbar__filters {
  display: flex;
  min-width: 0;
  flex: 1 1 540px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.batch-select {
  width: min(300px, 36vw);
}

.code-search {
  width: min(240px, 30vw);
}

.batch-context {
  display: grid;
  grid-template-columns: minmax(150px, 220px) minmax(120px, 1fr) minmax(260px, auto);
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  color: var(--ink-2);
  border-bottom: 1px solid var(--border);
  background: var(--accent-soft);
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
  font-size: 12px;
}

.batch-context small {
  color: var(--ink-2);
  font-size: 11px;
  text-align: right;
}

.codes-table-shell {
  min-width: 0;
  overflow-x: auto;
}

.codes-table-shell :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 42px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
  background: var(--surface-2);
}

.codes-table-shell :deep(.el-table__row td.el-table__cell) {
  height: 52px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.codes-table-shell :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
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
  color: var(--ink);
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

.batch-cell,
.redeem-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.batch-cell strong,
.batch-cell small,
.redeem-cell strong,
.redeem-cell small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-cell strong,
.redeem-cell strong {
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
}

.batch-cell small,
.redeem-cell small {
  color: var(--ink-3);
  font-size: 10px;
}

.value-cell {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.time-cell,
.cell-muted {
  color: var(--ink-3);
  font-size: 11px;
}

.time-cell.is-expired {
  color: var(--warning);
}

.codes-list-footer {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
}

.codes-list-footer > span {
  color: var(--ink-3);
  font-size: 11px;
}

.codes-list-footer :deep(.pager-bar) {
  margin-top: 0;
}

/* ---- 生成结果 ---- */
.result-warning {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
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

@media (max-width: 1180px) {
  .codes-toolbar {
    align-items: stretch;
  }

  .codes-toolbar__filters {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .batch-select,
  .code-search {
    width: min(280px, 38vw);
  }
}

@media (max-width: 720px) {
  .codes-page {
    padding: 12px;
  }

  .codes-header {
    align-items: flex-end;
  }

  .status-tabs {
    width: 100%;
  }

  .status-tabs button {
    min-width: 0;
    flex: 1 1 0;
  }

  .batch-select,
  .code-search {
    width: 100%;
  }

  .batch-context {
    grid-template-columns: 1fr;
    gap: 3px;
  }

  .batch-context small {
    text-align: left;
  }
}
</style>
