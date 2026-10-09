<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CopyDocument, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import AdminDateRange from '@/components/AdminDateRange.vue'
import { formatTime } from '@/utils'

interface ViolationUser { id: string; email?: string | null; username?: string | null }
type Status = 'charged' | 'waived' | 'refunded'
type Source = 'task' | 'assistant_run' | 'developer_api'
type Tab = 'records' | 'users'
interface Violation {
  id: string
  createdAt: string
  source: Source
  sourceId: string
  feature: string
  model: string
  prompt: string
  upstreamMessage: string
  matchedRule: string
  amountCents: number
  chargedCents: number
  status: Status
  waiveReason: string
  refundNote: string
  refundedAt: string | null
  user: ViolationUser
}
interface TopUser { user: ViolationUser; violations: number; chargedCents: number; lastAt: string }
interface Summary {
  violations: number; charged: number; waived: number; refunded: number
  chargedCents: number; refundedCents: number; users: number; topUsers: TopUser[]
}
interface Segment { text: string; hit: boolean }

// 北京时间 YYYY-MM-DD，默认看最近 7 天。
function beijingDay(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
}
const defaults = () => ({ createdFrom: beijingDay(-6), createdTo: beijingDay(), status: '', source: '', user: '', search: '' })
const filters = reactive(defaults())
const pageSize = ref(20)
const tab = ref<Tab>('records')
const router = useRouter()

const { items, loading, error, total, totalCapped, page, hasPrev, hasNext, reset, goToPage, retry } =
  usePagedList<Violation>(
    (cursor, target) =>
      request<Page<Violation>>('/api/v1/admin/content-policy/violations', {
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
    const result = await request<Summary>('/api/v1/admin/content-policy/summary', { query: { ...filters }, silent: true })
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
const hasActiveFilters = computed(() => Boolean(filters.status || filters.source || filters.user || filters.search))
// 点汇总卡片按结果筛选；再点一次取消。
function filterStatus(status: '' | Status) {
  filters.status = status && filters.status === status ? '' : status
  tab.value = 'records'
  search()
}

const points = (value?: number | null) => Math.round(Number(value || 0)).toLocaleString('zh-CN')
const shortTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const userLabel = (user?: ViolationUser | null) => user?.email || user?.username || user?.id || '已删除的用户'

const STATUS: Record<Status, { label: string; type: 'danger' | 'info' | 'success' }> = {
  charged: { label: '已扣费', type: 'danger' },
  waived: { label: '免扣', type: 'info' },
  refunded: { label: '已退回', type: 'success' },
}
const WAIVE_REASONS: Record<string, string> = {
  daily_free: '在每日免扣次数内',
  disabled: '违规扣费已关闭',
  no_cost: '本次没有费用',
}
const SOURCES: Record<Source, string> = { task: '生图任务', assistant_run: 'AI 助手', developer_api: '开发者 API' }
const FEATURES: Record<string, string> = {
  'canvas-image-generation': '无限画布',
  'canvas-background-remove': '画布去背',
  'wallpaper-image-generation': '文生图',
  'wallpaper-image-edit': '图生图',
  'assistant-image': 'AI 助手生图',
  'assistant-chat': 'AI 助手对话',
  'assistant-agent': 'AI 助手 Agent',
  'developer-api-image': '开发者 API 生图',
  'image-tool-background-remove': '抠图',
}
function featureLabel(row: Violation) {
  if (FEATURES[row.feature]) return FEATURES[row.feature]
  if (row.feature.startsWith('ui-design-ecommerce-')) return '电商工作台'
  if (row.feature.startsWith('profile-studio-')) return '形象工作室'
  return row.feature || SOURCES[row.source]
}
function statusNote(row: Violation) {
  if (row.status === 'waived') return WAIVE_REASONS[row.waiveReason] || '照常退回'
  if (row.status === 'refunded') return row.refundNote ? `管理员退回：${row.refundNote}` : '管理员已退回'
  return `扣 ${points(row.chargedCents)} 积分`
}

// 把命中的关键词标出来；规则形如“不能帮助 + 裸露”时两个词都标。
const ruleTerms = (rule: string) => rule.split(' + ').map((term) => term.trim()).filter(Boolean)
function highlight(text: string, terms: string[]): Segment[] {
  const lower = text.toLowerCase()
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean)
  const segments: Segment[] = []
  let cursor = 0
  while (cursor < text.length) {
    let at = -1
    let length = 0
    for (const needle of needles) {
      const found = lower.indexOf(needle, cursor)
      if (found !== -1 && (at === -1 || found < at)) {
        at = found
        length = needle.length
      }
    }
    if (at === -1) {
      segments.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false })
    segments.push({ text: text.slice(at, at + length), hit: true })
    cursor = at + length
  }
  return segments
}

// ---- 详情抽屉 ----
const selected = ref<Violation | null>(null)
const detailOpen = ref(false)
const userContext = ref<{ today: number; month: number; monthCharged: number } | null>(null)
let contextGeneration = 0
async function loadUserContext(row: Violation) {
  const own = ++contextGeneration
  userContext.value = null
  const query = (from: string) => ({ user: row.user.id, createdFrom: from, createdTo: beijingDay() })
  try {
    const [today, month] = await Promise.all([
      request<Summary>('/api/v1/admin/content-policy/summary', { query: query(beijingDay()), silent: true }),
      request<Summary>('/api/v1/admin/content-policy/summary', { query: query(beijingDay(-29)), silent: true }),
    ])
    if (own === contextGeneration) userContext.value = { today: today.violations, month: month.violations, monthCharged: month.chargedCents }
  } catch {
    // 近况只是参考，读不到时不显示即可。
  }
}
function openDetail(row: Violation) {
  selected.value = row
  detailOpen.value = true
  void loadUserContext(row)
}
function filterUser(user?: ViolationUser | null) {
  if (!user) return
  filters.user = user.email || user.id
  detailOpen.value = false
  tab.value = 'records'
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

const refunding = ref(false)
async function refund(row: Violation) {
  let note = ''
  try {
    const result = await ElMessageBox.prompt(
      `退回 ${points(row.chargedCents)} 积分给 ${userLabel(row.user)}，并发站内通知告诉用户判定有误。每条记录只能退回一次。`,
      '退回违规扣费',
      { confirmButtonText: '确认退回', cancelButtonText: '取消', inputPlaceholder: '退回说明（选填，最多 200 字）', inputValidator: (value) => String(value || '').trim().length <= 200 || '最多 200 字', type: 'warning' },
    )
    note = String(result.value || '').trim()
  } catch {
    return
  }
  refunding.value = true
  try {
    await request(`/api/v1/admin/content-policy/violations/${row.id}/refund`, { method: 'POST', body: { note } })
    // 原地更新这一行，抽屉保持打开，管理员能直接看到结果。
    row.status = 'refunded'
    row.refundNote = note
    row.refundedAt = new Date().toISOString()
    ElMessage.success(`已退回 ${points(row.chargedCents)} 积分并通知用户`)
    void loadSummary()
  } finally {
    refunding.value = false
  }
}

// 识别与扣费规则在系统设置 · 内容违规里改；带上这段返回，过去后直接识别一次。
function testRow(row: Violation) {
  detailOpen.value = false
  void router.push({ path: '/settings', query: { section: 'content-policy' }, state: { policyTestMessage: row.upstreamMessage } })
}
function switchTab(next: Tab) {
  tab.value = next
}

onMounted(search)
</script>

<template>
  <div class="page cp-page">
    <PageCard>
      <template #header>
        <div class="cp-filters">
          <AdminDateRange v-model:from="filters.createdFrom" v-model:to="filters.createdTo" label="违规时间" @change="search" />
          <el-select v-model="filters.status" clearable placeholder="全部结果" class="cp-select" @change="search">
            <el-option label="已扣费" value="charged" /><el-option label="免扣" value="waived" /><el-option label="已退回" value="refunded" />
          </el-select>
          <el-select v-model="filters.source" clearable placeholder="全部来源" class="cp-select" @change="search">
            <el-option v-for="(label, value) in SOURCES" :key="value" :label="label" :value="value" />
          </el-select>
          <el-input v-model="filters.user" class="cp-search" placeholder="用户邮箱 / 用户名 / ID" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" />
          <el-input v-model="filters.search" class="cp-search" placeholder="搜索提示词或上游返回" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" />
        </div>
      </template>
      <template #actions>
        <el-button type="primary" :icon="Refresh" :loading="loading || summaryLoading" @click="search">查询</el-button>
        <el-button text :disabled="!hasActiveFilters && filters.createdFrom === defaults().createdFrom && filters.createdTo === defaults().createdTo" @click="clearFilters">重置</el-button>
      </template>

      <el-alert v-if="summaryError" :title="`汇总读取失败：${summaryError}`" type="error" :closable="false" />

      <div class="cp-bar">
        <nav class="cp-tabs" role="tablist" aria-label="视图">
          <button type="button" role="tab" :aria-selected="tab === 'records'" :class="{ active: tab === 'records' }" @click="switchTab('records')">违规记录<em class="tnum">{{ total ?? items.length }}{{ totalCapped ? '+' : '' }}</em></button>
          <button type="button" role="tab" :aria-selected="tab === 'users'" :class="{ active: tab === 'users' }" @click="switchTab('users')">违规用户<em class="tnum">{{ summary?.users || 0 }}</em></button>
        </nav>
        <section class="cp-kpis" aria-label="内容违规汇总（点击按结果筛选）">
          <button type="button" class="is-all" :class="{ active: !filters.status }" :title="`${points(summary?.users)} 个用户`" @click="filterStatus('')">
            <i />全部<strong class="tnum">{{ points(summary?.violations) }}</strong>
          </button>
          <button type="button" class="is-charged" :class="{ active: filters.status === 'charged' }" :title="`共 ${points(summary?.chargedCents)} 积分`" @click="filterStatus('charged')">
            <i />已扣费<strong class="tnum">{{ points(summary?.charged) }}</strong><span>{{ points(summary?.chargedCents) }} 积分</span>
          </button>
          <button type="button" class="is-waived" :class="{ active: filters.status === 'waived' }" title="每日免扣次数内或扣费关闭" @click="filterStatus('waived')">
            <i />免扣<strong class="tnum">{{ points(summary?.waived) }}</strong>
          </button>
          <button type="button" class="is-refunded" :class="{ active: filters.status === 'refunded' }" :title="`共 ${points(summary?.refundedCents)} 积分`" @click="filterStatus('refunded')">
            <i />已退回<strong class="tnum">{{ points(summary?.refunded) }}</strong><span>{{ points(summary?.refundedCents) }} 积分</span>
          </button>
        </section>
        <el-button class="cp-rules-link" text :icon="Setting" @click="router.push({ path: '/settings', query: { section: 'content-policy' } })">识别与扣费规则</el-button>
      </div>

      <template v-if="tab === 'records'">
        <ListError :error="error" :loading="loading" @retry="retry" />
        <AdminListShell
          class="cp-list-shell"
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
          <el-table v-loading="loading" class="cp-table" :data="items" height="100%" row-key="id" @row-click="openDetail">
            <template #empty>
              <el-empty :description="hasActiveFilters ? '没有符合筛选条件的违规记录' : '这个时间范围内没有违规记录'" :image-size="60">
                <div class="empty-sub">
                  <template v-if="hasActiveFilters">换个条件，或 <el-button text size="small" @click="clearFilters">清除筛选</el-button></template>
                  <template v-else>识别规则上线后发生的违规才会记录在这里；可以放宽时间范围再看看。</template>
                </div>
              </el-empty>
            </template>
            <el-table-column label="时间" width="110">
              <template #default="{ row }"><span class="tnum">{{ shortTime(row.createdAt) }}</span></template>
            </el-table-column>
            <el-table-column label="用户" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ userLabel(row.user) }}</template>
            </el-table-column>
            <el-table-column label="功能" width="110" show-overflow-tooltip>
              <template #default="{ row }">{{ featureLabel(row as Violation) }}</template>
            </el-table-column>
            <el-table-column label="提示词" min-width="220" show-overflow-tooltip>
              <template #default="{ row }"><span :class="{ muted: !row.prompt }">{{ row.prompt || '（无提示词）' }}</span></template>
            </el-table-column>
            <el-table-column label="命中规则" width="140" show-overflow-tooltip>
              <template #default="{ row }"><span class="cp-rule">{{ row.matchedRule }}</span></template>
            </el-table-column>
            <el-table-column label="结果" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cp-result">
                  <el-tag :type="STATUS[row.status as Status].type" size="small">{{ STATUS[row.status as Status].label }}</el-tag>
                  <span class="muted">{{ statusNote(row as Violation) }}</span>
                </span>
              </template>
            </el-table-column>
          </el-table>
        </AdminListShell>
      </template>

      <div v-else v-loading="summaryLoading" class="cp-users">
        <el-table :data="summary?.topUsers || []" height="100%" empty-text="这个范围内没有违规用户" @row-click="(row: TopUser) => filterUser(row.user)">
          <el-table-column label="用户" min-width="220" show-overflow-tooltip>
            <template #default="{ row }"><strong>{{ userLabel(row.user) }}</strong></template>
          </el-table-column>
          <el-table-column label="违规次数" width="110" align="right">
            <template #default="{ row }"><span class="tnum">{{ points(row.violations) }}</span></template>
          </el-table-column>
          <el-table-column label="已扣积分" width="110" align="right">
            <template #default="{ row }"><span class="tnum">{{ points(row.chargedCents) }}</span></template>
          </el-table-column>
          <el-table-column label="最近一次" width="140">
            <template #default="{ row }"><span class="tnum">{{ shortTime(row.lastAt) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="110" align="right">
            <template #default><span class="cp-link">查看记录 →</span></template>
          </el-table-column>
        </el-table>
        <p class="cp-footnote">按违规次数排序，最多显示 10 个用户；上方的时间、来源等筛选同样生效。点一行查看该用户的全部记录。</p>
      </div>

    </PageCard>

    <el-drawer v-model="detailOpen" size="min(600px, 96vw)" append-to-body>
      <template #header>
        <div v-if="selected" class="cp-head">
          <div><el-tag :type="STATUS[selected.status].type" size="small">{{ STATUS[selected.status].label }}</el-tag><strong>{{ featureLabel(selected) }}</strong></div>
          <span>{{ formatTime(selected.createdAt) }} · {{ statusNote(selected) }}</span>
        </div>
      </template>
      <dl v-if="selected" class="cp-facts">
        <div class="is-wide">
          <dt>用户</dt>
          <dd class="cp-copy">{{ userLabel(selected.user) }}<el-button text size="small" @click="filterUser(selected.user)">只看此用户</el-button></dd>
          <dd v-if="userContext" class="cp-context">
            该用户今天共 <strong>{{ points(userContext.today) }}</strong> 次违规 · 近 30 天 <strong>{{ points(userContext.month) }}</strong> 次，被扣 {{ points(userContext.monthCharged) }} 积分
          </dd>
        </div>
        <div class="is-wide">
          <dt class="cp-dt-action">提示词<el-button v-if="selected.prompt" text size="small" :icon="CopyDocument" @click="copyText(selected.prompt, '提示词')">复制</el-button></dt>
          <dd><pre>{{ selected.prompt || '（无提示词）' }}</pre></dd>
        </div>
        <div class="is-wide">
          <dt>上游返回 <span class="muted">· 标黄的是命中的关键词</span></dt>
          <dd><pre class="cp-marked"><template v-for="(segment, index) in highlight(selected.upstreamMessage, ruleTerms(selected.matchedRule))" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre></dd>
        </div>
        <div><dt>命中规则</dt><dd class="cp-rule">{{ selected.matchedRule }}</dd></div>
        <div><dt>来源</dt><dd>{{ SOURCES[selected.source] }}<template v-if="selected.model"> · {{ selected.model }}</template></dd></div>
        <div><dt>本次价格</dt><dd class="tnum">{{ points(selected.amountCents) }} 积分</dd></div>
        <div><dt>实际扣费</dt><dd class="tnum">{{ points(selected.status === 'charged' ? selected.chargedCents : 0) }} 积分</dd></div>
        <div v-if="selected.refundedAt" class="is-wide"><dt>退回</dt><dd>{{ formatTime(selected.refundedAt) }}<template v-if="selected.refundNote"> · {{ selected.refundNote }}</template></dd></div>
        <div class="is-wide">
          <dt>来源编号</dt>
          <dd class="mono cp-copy">{{ selected.sourceId }}<el-button text size="small" :icon="CopyDocument" @click="copyText(selected.sourceId, '来源编号')" /></dd>
        </div>
      </dl>
      <template #footer>
        <div v-if="selected" class="cp-drawer-actions">
          <el-button @click="testRow(selected)">用这段返回调规则</el-button>
          <el-button v-if="selected.status === 'charged'" type="primary" :loading="refunding" @click="refund(selected)">判定有误，退回 {{ points(selected.chargedCents) }} 积分</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.cp-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow-y: auto; }
.cp-page :deep(.page-card) { display: flex; flex: 1 1 0; flex-direction: column; min-height: 560px; overflow: hidden; }
.cp-page :deep(.page-card__header) { flex-wrap: wrap; }
.cp-page :deep(.page-card__body) { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }

.cp-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cp-select { width: 120px; }
.cp-search { width: 200px; }

.cp-bar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.cp-tabs { display: flex; gap: 6px; }
.cp-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-tabs button.active { border-color: var(--ink); background: var(--ink); color: var(--surface); }
.cp-tabs em { font-style: normal; font-size: 11px; opacity: .7; }

/* 汇总：无边框的轻量胶囊，点一下按结果筛选，选中时浅底加深 */
.cp-kpis { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.cp-kpis button { --dot: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-3); font: inherit; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: background-color .15s ease, color .15s ease; }
.cp-kpis button:hover { background: var(--surface-2); color: var(--ink-2); }
.cp-kpis button.active { background: color-mix(in srgb, var(--dot) 12%, var(--surface-2)); color: var(--ink); }
.cp-kpis button:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.cp-kpis i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dot); }
.cp-kpis strong { color: var(--ink); font-size: 14px; font-weight: 750; }
.cp-kpis span { color: var(--ink-3); font-size: 11px; font-weight: 500; }
.cp-kpis .is-all { --dot: var(--ink); }
.cp-kpis .is-charged { --dot: var(--danger); }
.cp-kpis .is-charged strong { color: var(--danger); }
.cp-kpis .is-waived { --dot: var(--info, #909399); }
.cp-kpis .is-refunded { --dot: var(--success); }
.cp-rules-link { margin-left: auto; color: var(--ink-3); }

.cp-list-shell { flex: 1; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.cp-table :deep(.el-table__row), .cp-users :deep(.el-table__row) { cursor: pointer; }
.cp-table :deep(.cell) { white-space: nowrap; }
.cp-result { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.cp-result .muted { overflow: hidden; text-overflow: ellipsis; }
.cp-rule { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.cp-users { display: flex; flex: 1; flex-direction: column; gap: 8px; min-height: 0; }
.cp-users :deep(.el-table) { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-control); }
.cp-link { color: var(--ink-3); font-size: 12px; }
.cp-users :deep(.el-table__row:hover) .cp-link { color: var(--ink); }
.cp-footnote { margin: 0; color: var(--ink-3); font-size: 12px; }
.empty-sub { color: var(--ink-3); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.muted { color: var(--ink-3); }
.cp-marked { margin: 4px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
mark { padding: 0 2px; border-radius: 3px; background: color-mix(in srgb, #f5c400 45%, transparent); color: inherit; }

.cp-head { display: grid; gap: 4px; min-width: 0; }
.cp-head > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cp-head strong { overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.cp-head > span { color: var(--ink-3); font-size: 12px; }
.cp-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 0; }
.cp-facts > div { display: grid; gap: 3px; min-width: 0; }
.cp-facts > div.is-wide { grid-column: 1 / -1; }
.cp-facts dt { color: var(--ink-3); font-size: 12px; }
.cp-facts dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.cp-facts pre { margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font: inherit; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.cp-dt-action { display: flex; align-items: center; justify-content: space-between; }
.cp-context { color: var(--ink-3); font-size: 12px; }
.cp-context strong { color: var(--ink); }
.cp-copy { display: flex; align-items: center; gap: 4px; }
.cp-drawer-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 900px) {
  .cp-search, .cp-select { width: 100%; }
}
</style>
