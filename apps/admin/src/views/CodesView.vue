<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Download, Hide, Plus, View } from '@element-plus/icons-vue'
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

function isExpired(row: RedemptionCode): boolean {
  return row.status === 'active' && !!row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()
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

/** 点批次卡片 = 按该批次筛选码列表（再点一次取消） */
function filterByBatch(batchId: string) {
  filters.batchId = filters.batchId === batchId ? '' : batchId
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
  <div class="page">
    <!-- 批次汇总 -->
    <PageCard title="批次汇总" subtitle="最近生成的兑换码批次，点击卡片可按批次筛选下方列表">
      <template #actions>
        <el-button type="primary" size="small" :icon="Plus" @click="openGenerate">生成兑换码</el-button>
      </template>
      <div v-loading="batchesLoading" class="batch-row">
        <el-empty v-if="!batchesLoading && batches.length === 0" description="暂无批次" :image-size="50">
          <div class="empty-sub">点击右上角「生成兑换码」创建第一批</div>
        </el-empty>
        <button
          v-for="batch in batches"
          :key="batch.batchId"
          type="button"
          class="batch-card"
          :class="{ 'is-active': filters.batchId === batch.batchId }"
          @click="filterByBatch(batch.batchId)"
        >
          <div class="batch-card__head">
            <span class="mono batch-card__id" :title="batch.batchId">{{ batch.batchId }}</span>
            <span class="batch-card__value tnum">{{ fenToYuan(batch.grantCents) }} 元</span>
          </div>
          <div class="batch-card__note" :title="batch.note ?? ''">{{ batch.note || '（无备注）' }}</div>
          <div class="batch-card__stats tnum">
            <span>总数 {{ batch.total }}</span>
            <span class="is-redeemed">已兑 {{ batch.redeemed }}</span>
            <span class="is-disabled">禁用 {{ batch.disabled }}</span>
          </div>
          <div class="batch-card__time">{{ formatTime(batch.createdAt) }}</div>
        </button>
      </div>
    </PageCard>

    <!-- 码列表 -->
    <PageCard title="兑换码列表" subtitle="兑换 = 面值一次性入账到用户钱包；仅可用状态的码可禁用">
      <div class="filter-bar">
        <el-select v-model="filters.status" placeholder="状态" size="small" clearable style="width: 120px" @change="reset">
          <el-option v-for="(label, value) in CODE_STATUS_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-input
          v-model="filters.batchId"
          placeholder="批次 ID"
          size="small"
          clearable
          style="width: 180px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-input
          v-model="filters.search"
          placeholder="完整兑换码（如 SC-XXXX-XXXX-XXXX）"
          size="small"
          clearable
          style="width: 240px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="clearFilters">重置</el-button>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <el-table v-loading="loading" :data="items" size="small">
        <template #empty>
          <el-empty description="暂无兑换码" :image-size="60">
            <div class="empty-sub">调整筛选条件，或生成新的兑换码</div>
          </el-empty>
        </template>
        <el-table-column label="兑换码" min-width="220">
          <template #default="{ row }">
            <span class="code-cell">
              <span class="mono">{{ revealed[row.id] ? row.code : maskCode(row.code) }}</span>
              <el-button
                text
                size="small"
                class="code-eye"
                :icon="revealed[row.id] ? Hide : View"
                :title="revealed[row.id] ? '隐藏完整码' : '查看完整码'"
                @click="toggleReveal(row.id)"
              />
            </span>
          </template>
        </el-table-column>
        <el-table-column label="面值（元）" width="100" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.grantCents) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="CODE_STATUS_TAG[row.status] ?? 'info'" size="small">
              {{ CODE_STATUS_LABELS[row.status] ?? row.status }}
            </el-tag>
            <el-tag v-if="isExpired(row as RedemptionCode)" type="warning" size="small" style="margin-left: 4px">
              已过期
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="兑换人邮箱" min-width="180">
          <template #default="{ row }">{{ row.redeemedByEmail || '-' }}</template>
        </el-table-column>
        <el-table-column label="兑换时间" width="160">
          <template #default="{ row }">{{ formatTime(row.redeemedAt) }}</template>
        </el-table-column>
        <el-table-column label="有效期" width="160">
          <template #default="{ row }">
            {{ row.expiresAt ? formatTime(row.expiresAt) : '长期有效' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
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

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
    </PageCard>

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
/* ---- 批次卡片行 ---- */
.batch-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  min-height: 60px;
}

.batch-card {
  flex: 0 0 220px;
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  color: var(--ink);
  font: inherit;
}

.batch-card:hover {
  border-color: var(--accent);
}

.batch-card.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.batch-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.batch-card__id {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-card__value {
  flex-shrink: 0;
  color: var(--accent-ink);
  font-size: 13px;
  font-weight: 700;
}

.batch-card__note {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-card__stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.batch-card__stats .is-redeemed {
  color: var(--success);
}

.batch-card__stats .is-disabled {
  color: var(--danger);
}

.batch-card__time {
  color: var(--ink-3);
  font-size: 11px;
}

/* ---- 码列表 ---- */
.code-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.code-eye {
  padding: 2px 4px;
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
</style>
