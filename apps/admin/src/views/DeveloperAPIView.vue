<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { CopyDocument, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import AdminDateRange from '@/components/AdminDateRange.vue'
import { formatTime } from '@/utils'

interface CallUser { id: string; email?: string; username?: string }
interface Call {
  billingId: string
  createdAt: string
  settledAt?: string
  kind: 'image' | 'chat'
  operation: string
  model: string
  modelId: string
  provider: string
  route: string
  status: 'charged' | 'refunded' | 'pending'
  rawStatus: string
  chargedCents: number
  upstreamCostCents: number
  reason: string
  errorCode: string
  note: string
  responseFormat: string
  images?: number
  tokens?: { prompt: number | null; completion: number | null; total: number | null }
  usage?: Record<string, unknown>
  key: { label: string; prefix: string } | null
  user: CallUser | null
}
interface ModelTotal { modelId: string; model: string; calls: number; charged: number; revenueCents: number; upstreamCostCents: number; grossProfitCents: number }
interface Summary {
  calls: number; charged: number; refunded: number; pending: number
  revenueCents: number; upstreamCostCents: number; grossProfitCents: number
  users: number; keys: number; models: ModelTotal[]
  modelOptions: { id: string; name: string; kind: string }[]
}

// Beijing-time YYYY-MM-DD for the default "last 7 days" range.
function beijingDay(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
}
const defaults = () => ({ createdFrom: beijingDay(-6), createdTo: beijingDay(), kind: '', status: '', model: '', user: '', key: '' })
const filters = reactive(defaults())
const pageSize = ref(20)
const tab = ref<'calls' | 'models'>('calls')

const { items, loading, error, total, totalCapped, page, hasPrev, hasNext, reset, goToPage, retry } =
  usePagedList<Call>(
    // The server pages by number; its nextCursor is the next page number.
    (cursor, target) =>
      request<Page<Call>>('/api/v1/admin/developer-api/calls', {
        query: { ...filters, limit: pageSize.value, page: target ?? (Number(cursor) || 1) },
      }),
    () => ({ ...filters, limit: pageSize.value }),
    { pageSeek: true },
  )

const summary = ref<Summary | null>(null)
const summaryError = ref('')
const summaryLoading = ref(false)
let summaryGeneration = 0
async function loadSummary() {
  const own = ++summaryGeneration
  summaryLoading.value = true
  summaryError.value = ''
  try {
    const result = await request<Summary>('/api/v1/admin/developer-api/summary', { query: { ...filters }, silent: true })
    if (own === summaryGeneration) summary.value = result
  } catch (caught) {
    if (own === summaryGeneration) summaryError.value = caught instanceof Error ? caught.message : '汇总读取失败'
  } finally {
    if (own === summaryGeneration) summaryLoading.value = false
  }
}

function search() {
  void loadSummary()
  reset()
}
function clearFilters() {
  Object.assign(filters, defaults())
  search()
}
onMounted(search)

const points = (value?: number | null) => Math.round(Number(value || 0)).toLocaleString('zh-CN')
const margin = (revenue: number, profit: number) => (revenue > 0 ? `${((profit / revenue) * 100).toFixed(1)}%` : '—')
const shortTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const STATUS: Record<Call['status'], { label: string; type: 'success' | 'info' | 'warning' }> = {
  charged: { label: '已扣费', type: 'success' },
  refunded: { label: '已退回', type: 'info' },
  pending: { label: '进行中', type: 'warning' },
}
const userLabel = (user: CallUser | null) => user?.email || user?.username || (user ? user.id : '已删除的用户')
function usageLabel(call: Call) {
  if (call.kind === 'image') return call.images ? `${call.images} 张` : '—'
  return call.tokens?.total != null ? `${points(call.tokens.total)} tokens` : '—'
}
const modelOptions = computed(() => summary.value?.modelOptions || [])

const selected = ref<Call | null>(null)
const detailOpen = ref(false)
function openDetail(row: Call) {
  selected.value = row
  detailOpen.value = true
}
function filterUser(user: CallUser | null) {
  if (!user) return
  filters.user = user.email || user.id
  detailOpen.value = false
  search()
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
  <div class="page devapi-page">
    <PageCard>
      <template #header>
        <div class="devapi-filters">
          <AdminDateRange v-model:from="filters.createdFrom" v-model:to="filters.createdTo" label="调用时间" @change="search" />
          <el-select v-model="filters.kind" clearable placeholder="全部接口" class="devapi-select" @change="search">
            <el-option label="生图" value="image" /><el-option label="对话" value="chat" />
          </el-select>
          <el-select v-model="filters.status" clearable placeholder="全部结果" class="devapi-select" @change="search">
            <el-option label="已扣费" value="charged" /><el-option label="已退回" value="refunded" /><el-option label="进行中" value="pending" />
          </el-select>
          <el-select v-model="filters.model" clearable filterable placeholder="全部模型" class="devapi-model" @change="search">
            <el-option v-for="item in modelOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <el-input v-model="filters.user" class="devapi-search" placeholder="用户邮箱 / 用户名 / ID" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" />
          <el-input v-model="filters.key" class="devapi-search" placeholder="Key 名称或前缀" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" />
        </div>
      </template>
      <template #actions>
        <el-button type="primary" :icon="Refresh" :loading="loading || summaryLoading" @click="search">查询</el-button>
        <el-button text @click="clearFilters">重置</el-button>
      </template>

      <el-alert v-if="summaryError" :title="`汇总读取失败：${summaryError}`" type="error" :closable="false" />

      <section class="devapi-kpis" aria-label="开发者 API 汇总">
        <article><small>调用</small><strong class="tnum">{{ points(summary?.calls) }}</strong><span>{{ points(summary?.users) }} 个用户 · {{ points(summary?.keys) }} 把 Key</span></article>
        <article><small>已扣费</small><strong class="tnum">{{ points(summary?.charged) }}</strong><span>退回 {{ points(summary?.refunded) }}<template v-if="summary?.pending"> · 进行中 {{ points(summary.pending) }}</template></span></article>
        <article><small>实收积分</small><strong class="tnum">{{ points(summary?.revenueCents) }}</strong><span>只计已扣费的请求</span></article>
        <article><small>上游成本</small><strong class="tnum">{{ points(summary?.upstreamCostCents) }}</strong><span>按模型配置的成本估算</span></article>
        <article :class="{ 'is-loss': (summary?.grossProfitCents || 0) < 0, 'is-gain': (summary?.grossProfitCents || 0) > 0 }">
          <small>毛利</small><strong class="tnum">{{ points(summary?.grossProfitCents) }}</strong><span>毛利率 {{ margin(summary?.revenueCents || 0, summary?.grossProfitCents || 0) }}</span>
        </article>
      </section>

      <nav class="devapi-tabs" role="tablist" aria-label="视图">
        <button type="button" role="tab" :aria-selected="tab === 'calls'" :class="{ active: tab === 'calls' }" @click="tab = 'calls'">调用记录<em class="tnum">{{ total ?? items.length }}{{ totalCapped ? '+' : '' }}</em></button>
        <button type="button" role="tab" :aria-selected="tab === 'models'" :class="{ active: tab === 'models' }" @click="tab = 'models'">按模型<em class="tnum">{{ summary?.models.length || 0 }}</em></button>
      </nav>

      <template v-if="tab === 'calls'">
        <ListError :error="error" :loading="loading" @retry="retry" />
        <AdminListShell
          class="devapi-list-shell"
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
          <el-table v-loading="loading" class="devapi-table" :data="items" height="100%" row-key="billingId" @row-click="openDetail">
            <template #empty>
              <el-empty description="这个范围内没有 /v1 调用" :image-size="60"><div class="empty-sub">放宽时间或筛选条件后重新查询</div></el-empty>
            </template>
            <el-table-column label="时间" width="140">
              <template #default="{ row }"><span class="tnum">{{ shortTime(row.createdAt) }}</span></template>
            </el-table-column>
            <el-table-column label="用户" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">{{ userLabel(row.user) }}</template>
            </el-table-column>
            <el-table-column label="Key" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <template v-if="row.key">{{ row.key.label }} <span class="mono muted">{{ row.key.prefix }}</span></template>
                <span v-else class="muted">已删除</span>
              </template>
            </el-table-column>
            <el-table-column label="接口 / 模型" min-width="180" show-overflow-tooltip>
              <template #default="{ row }"><strong>{{ row.operation }}</strong> <span class="muted">{{ row.model || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="用量" width="120" align="right">
              <template #default="{ row }"><span class="tnum">{{ usageLabel(row as Call) }}</span></template>
            </el-table-column>
            <el-table-column label="实收" width="90" align="right">
              <template #default="{ row }"><span class="tnum">{{ points(row.chargedCents) }}</span></template>
            </el-table-column>
            <el-table-column label="上游成本" width="100" align="right">
              <template #default="{ row }"><span class="tnum muted">{{ points(row.upstreamCostCents) }}</span></template>
            </el-table-column>
            <el-table-column label="结果" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="devapi-result">
                  <el-tag :type="STATUS[row.status as Call['status']].type" size="small">{{ STATUS[row.status as Call['status']].label }}</el-tag>
                  <span class="muted">{{ row.reason }}</span>
                </span>
              </template>
            </el-table-column>
          </el-table>
        </AdminListShell>
      </template>

      <div v-else v-loading="summaryLoading" class="devapi-models">
        <el-table :data="summary?.models || []" height="100%" empty-text="这个范围内没有 /v1 调用">
          <el-table-column label="模型" min-width="200">
            <template #default="{ row }"><strong>{{ row.model || '未记录模型' }}</strong></template>
          </el-table-column>
          <el-table-column label="调用" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.calls) }}</span></template></el-table-column>
          <el-table-column label="已扣费" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.charged) }}</span></template></el-table-column>
          <el-table-column label="成功率" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ row.calls ? `${((row.charged / row.calls) * 100).toFixed(1)}%` : '—' }}</span></template></el-table-column>
          <el-table-column label="实收" width="120" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.revenueCents) }}</span></template></el-table-column>
          <el-table-column label="上游成本" width="120" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.upstreamCostCents) }}</span></template></el-table-column>
          <el-table-column label="毛利" width="120" align="right">
            <template #default="{ row }"><span class="tnum" :class="{ 'is-loss': row.grossProfitCents < 0 }">{{ points(row.grossProfitCents) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="110" align="right">
            <template #default="{ row }"><el-button v-if="row.modelId" text size="small" @click="filters.model = row.modelId; tab = 'calls'; search()">查看调用</el-button></template>
          </el-table-column>
        </el-table>
        <p class="devapi-footnote">按调用次数排序，最多显示 20 个模型。</p>
      </div>
    </PageCard>

    <el-drawer v-model="detailOpen" size="min(560px, 96vw)" append-to-body>
      <template #header>
        <div v-if="selected" class="devapi-head">
          <div><el-tag :type="STATUS[selected.status].type" size="small">{{ STATUS[selected.status].label }}</el-tag><strong>{{ selected.operation }} · {{ selected.model || '未记录模型' }}</strong></div>
          <span>{{ formatTime(selected.createdAt) }}</span>
        </div>
      </template>
      <dl v-if="selected" class="devapi-facts">
        <div class="is-wide"><dt>结果说明</dt><dd>{{ selected.reason || '成功返回结果' }}</dd></div>
        <div><dt>实收积分</dt><dd class="tnum">{{ points(selected.chargedCents) }}</dd></div>
        <div><dt>上游成本</dt><dd class="tnum">{{ points(selected.upstreamCostCents) }}</dd></div>
        <div><dt>用量</dt><dd>{{ usageLabel(selected) }}<template v-if="selected.tokens?.prompt != null">（输入 {{ points(selected.tokens.prompt) }} / 输出 {{ points(selected.tokens.completion) }}）</template></dd></div>
        <div><dt>结算时间</dt><dd>{{ selected.settledAt ? formatTime(selected.settledAt) : '—' }}</dd></div>
        <div class="is-wide">
          <dt>用户</dt>
          <dd class="devapi-copy">{{ userLabel(selected.user) }}<el-button v-if="selected.user" text size="small" @click="filterUser(selected.user)">只看此用户</el-button></dd>
        </div>
        <div><dt>Key</dt><dd>{{ selected.key ? `${selected.key.label}（${selected.key.prefix}…）` : '已删除' }}</dd></div>
        <div><dt>服务商 / 线路</dt><dd>{{ [selected.provider, selected.route].filter(Boolean).join(' / ') || '—' }}</dd></div>
        <div><dt>错误码</dt><dd class="mono">{{ selected.errorCode || '—' }}</dd></div>
        <div><dt>备注</dt><dd class="mono">{{ selected.note || '—' }}</dd></div>
        <div v-if="selected.responseFormat"><dt>返回格式</dt><dd class="mono">{{ selected.responseFormat }}</dd></div>
        <div><dt>模型 ID</dt><dd class="mono muted">{{ selected.modelId || '—' }}</dd></div>
        <div class="is-wide">
          <dt>计费单号</dt>
          <dd class="mono devapi-copy">{{ selected.billingId }}<el-button text size="small" :icon="CopyDocument" @click="copyText(selected.billingId, '计费单号')" /></dd>
        </div>
        <div v-if="selected.usage" class="is-wide"><dt>上游 usage</dt><dd><pre class="mono">{{ JSON.stringify(selected.usage, null, 2) }}</pre></dd></div>
      </dl>
    </el-drawer>
  </div>
</template>

<style scoped>
.devapi-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow-y: auto; }
.devapi-page :deep(.page-card) { display: flex; flex: 1 1 0; flex-direction: column; min-height: 560px; overflow: hidden; }
.devapi-page :deep(.page-card__header) { flex-wrap: wrap; }
.devapi-page :deep(.page-card__body) { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }

.devapi-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.devapi-select { width: 116px; }
.devapi-model { width: 180px; }
.devapi-search { width: 200px; }

.devapi-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); flex: none; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-2); }
.devapi-kpis article { display: grid; gap: 4px; min-width: 0; padding: 12px 16px; border-right: 1px solid var(--border); }
.devapi-kpis article:last-child { border-right: 0; }
.devapi-kpis small { color: var(--ink-3); font-size: 12px; font-weight: 650; }
.devapi-kpis strong { overflow: hidden; color: var(--ink); font-size: 21px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.devapi-kpis span { overflow: hidden; color: var(--ink-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.devapi-kpis article.is-gain strong { color: var(--success); }
.devapi-kpis article.is-loss strong, .is-loss { color: var(--danger); }

.devapi-tabs { display: flex; flex: none; gap: 6px; }
.devapi-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.devapi-tabs button.active { border-color: var(--ink); background: var(--ink); color: var(--surface); }
.devapi-tabs em { font-style: normal; font-size: 11px; opacity: .7; }

.devapi-list-shell { flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.devapi-table :deep(.el-table__row) { cursor: pointer; }
.devapi-table :deep(.cell) { white-space: nowrap; }
.devapi-result { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.devapi-result .muted { overflow: hidden; text-overflow: ellipsis; }
.devapi-models { display: flex; flex: 1; flex-direction: column; gap: 8px; min-height: 0; }
.devapi-models :deep(.el-table) { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-control); }
.devapi-footnote { margin: 0; color: var(--ink-3); font-size: 12px; }
.empty-sub { color: var(--ink-3); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.muted { color: var(--ink-3); }

.devapi-head { display: grid; gap: 4px; min-width: 0; }
.devapi-head > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
.devapi-head strong { overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.devapi-head > span { color: var(--ink-3); font-size: 12px; }
.devapi-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 0; }
.devapi-facts > div { display: grid; gap: 3px; min-width: 0; }
.devapi-facts > div.is-wide { grid-column: 1 / -1; }
.devapi-facts dt { color: var(--ink-3); font-size: 12px; }
.devapi-facts dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.devapi-facts pre { margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; }
.devapi-copy { display: flex; align-items: center; gap: 4px; }

@media (max-width: 900px) {
  .devapi-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .devapi-kpis article { border-bottom: 1px solid var(--border); }
  .devapi-search, .devapi-model { width: 100%; }
}
</style>
