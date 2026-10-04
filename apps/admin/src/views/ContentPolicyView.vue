<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { CopyDocument, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import AdminDateRange from '@/components/AdminDateRange.vue'
import { formatTime } from '@/utils'

interface ViolationUser { id: string; email?: string | null; username?: string | null }
type Status = 'charged' | 'waived' | 'refunded'
type Source = 'task' | 'assistant_run' | 'developer_api'
type Tab = 'records' | 'users' | 'rules'
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
interface Rules {
  enabled: boolean
  dailyFreeCount: number
  policyPhrases: string[]
  refusalPhrases: string[]
  sensitiveWords: string[]
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

// ---- 识别规则 ----
const rules = reactive({ enabled: true, dailyFreeCount: 0, policyPhrases: '', refusalPhrases: '', sensitiveWords: '' })
const savedRules = ref<Rules | null>(null)
const ruleDefaults = ref<Rules | null>(null)
const rulesLoading = ref(false)
const rulesSaving = ref(false)
const rulesError = ref('')
const lines = (text: string) => {
  const seen = new Set<string>()
  return text.split(/[\n,，]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLowerCase()
    if (!item || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
const joinLines = (items: string[]) => items.join('\n')
function setDraft(value: Rules) {
  rules.enabled = value.enabled
  rules.dailyFreeCount = value.dailyFreeCount
  rules.policyPhrases = joinLines(value.policyPhrases)
  rules.refusalPhrases = joinLines(value.refusalPhrases)
  rules.sensitiveWords = joinLines(value.sensitiveWords)
}
const draftRules = computed<Rules>(() => ({
  enabled: rules.enabled,
  dailyFreeCount: Number(rules.dailyFreeCount) || 0,
  policyPhrases: lines(rules.policyPhrases),
  refusalPhrases: lines(rules.refusalPhrases),
  sensitiveWords: lines(rules.sensitiveWords),
}))
const rulesDirty = computed(() => Boolean(savedRules.value) && JSON.stringify(draftRules.value) !== JSON.stringify(savedRules.value))
const keywordCount = (value: Rules | null) => (value ? value.policyPhrases.length + value.refusalPhrases.length + value.sensitiveWords.length : 0)
const freeExample = computed(() => {
  const n = draftRules.value.dailyFreeCount
  if (!draftRules.value.enabled) return '扣费已关闭：所有违规都照常退回积分，只做记录。'
  if (n === 0) return '每天第 1 次违规就扣费。'
  return `例：同一用户今天第 ${n === 1 ? '1' : `1–${n}`} 次违规照常退回，第 ${n + 1} 次起扣费；次日重新计数。`
})
const rulesProblem = computed(() => {
  const draft = draftRules.value
  if (!draft.policyPhrases.length && (!draft.refusalPhrases.length || !draft.sensitiveWords.length)) {
    return '至少要有一个违规说法，或同时填写拒绝说法和敏感词，否则什么都识别不出来。'
  }
  return ''
})

async function loadRules() {
  rulesLoading.value = true
  rulesError.value = ''
  try {
    const result = await request<{ config: Rules; defaults: Rules }>('/api/v1/admin/content-policy/config', { silent: true })
    setDraft(result.config)
    savedRules.value = draftRules.value
    ruleDefaults.value = result.defaults
  } catch (caught) {
    rulesError.value = caught instanceof Error ? caught.message : '规则读取失败'
  } finally {
    rulesLoading.value = false
  }
}
async function saveRules() {
  rulesSaving.value = true
  try {
    const result = await request<{ config: Rules }>('/api/v1/admin/content-policy/config', { method: 'PUT', body: draftRules.value })
    setDraft(result.config)
    savedRules.value = draftRules.value
    ElMessage.success('规则已保存，之后的失败按新规则判断')
  } finally {
    rulesSaving.value = false
  }
}
function revertRules() {
  if (savedRules.value) setDraft(savedRules.value)
}
async function restoreDefaults() {
  if (!ruleDefaults.value) return
  try {
    await ElMessageBox.confirm('把三组关键词恢复为系统默认值？扣费开关和每日免扣次数不变。点“保存规则”后才会生效。', '恢复默认关键词', { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' })
  } catch {
    return
  }
  setDraft({ ...ruleDefaults.value, enabled: rules.enabled, dailyFreeCount: rules.dailyFreeCount })
}

// 规则改了没保存时，切换标签页或离开页面先确认。
async function confirmDiscard() {
  try {
    await ElMessageBox.confirm('识别规则有未保存的修改，离开后会丢失。', '放弃修改？', { type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' })
    revertRules()
    // 先让输入框按还原后的内容完成自动调高，再卸载规则面板。
    await nextTick()
    await nextTick()
    return true
  } catch {
    return false
  }
}
async function switchTab(next: Tab) {
  if (next === tab.value) return
  if (tab.value === 'rules' && rulesDirty.value && !(await confirmDiscard())) return
  tab.value = next
}
onBeforeRouteLeave(async () => (rulesDirty.value ? await confirmDiscard() : true))
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!rulesDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

const testMessage = ref('')
const testing = ref(false)
const testResult = ref<{ violation: boolean; rule: string; message: string } | null>(null)
// 规则或文字变了，旧结果就不再可信。
watch([testMessage, draftRules], () => { testResult.value = null })
async function runTest() {
  const message = testMessage.value
  if (!message.trim() || testing.value) return
  testing.value = true
  try {
    const result = await request<{ violation: boolean; rule: string }>('/api/v1/admin/content-policy/test', { method: 'POST', body: { message, config: draftRules.value } })
    testResult.value = { ...result, message }
  } finally {
    testing.value = false
  }
}
function onTestKeydown(event: Event | KeyboardEvent) {
  if (event instanceof KeyboardEvent && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void runTest()
  }
}
async function testRow(row: Violation) {
  detailOpen.value = false
  await switchTab('rules')
  if (tab.value !== 'rules') return
  testMessage.value = row.upstreamMessage
  await runTest()
}

onMounted(() => {
  search()
  void loadRules()
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))
</script>

<template>
  <div class="page cp-page">
    <PageCard>
      <template v-if="tab !== 'rules'" #header>
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
      <template v-if="tab !== 'rules'" #actions>
        <el-button type="primary" :icon="Refresh" :loading="loading || summaryLoading" @click="search">查询</el-button>
        <el-button text :disabled="!hasActiveFilters && filters.createdFrom === defaults().createdFrom && filters.createdTo === defaults().createdTo" @click="clearFilters">重置</el-button>
      </template>

      <el-alert v-if="tab !== 'rules' && summaryError" :title="`汇总读取失败：${summaryError}`" type="error" :closable="false" />

      <section v-if="tab !== 'rules'" class="cp-kpis" aria-label="内容违规汇总">
        <button type="button" :class="{ active: !filters.status }" @click="filterStatus('')">
          <small>违规次数</small><strong class="tnum">{{ points(summary?.violations) }}</strong><span>{{ points(summary?.users) }} 个用户</span>
        </button>
        <button type="button" class="is-charged" :class="{ active: filters.status === 'charged' }" @click="filterStatus('charged')">
          <small>已扣费</small><strong class="tnum">{{ points(summary?.charged) }}</strong><span>共 {{ points(summary?.chargedCents) }} 积分</span>
        </button>
        <button type="button" :class="{ active: filters.status === 'waived' }" @click="filterStatus('waived')">
          <small>免扣</small><strong class="tnum">{{ points(summary?.waived) }}</strong><span>每日免扣次数内或扣费关闭</span>
        </button>
        <button type="button" :class="{ active: filters.status === 'refunded' }" @click="filterStatus('refunded')">
          <small>已退回</small><strong class="tnum">{{ points(summary?.refunded) }}</strong><span>共 {{ points(summary?.refundedCents) }} 积分</span>
        </button>
      </section>

      <nav class="cp-tabs" role="tablist" aria-label="视图">
        <button type="button" role="tab" :aria-selected="tab === 'records'" :class="{ active: tab === 'records' }" @click="switchTab('records')">违规记录<em class="tnum">{{ total ?? items.length }}{{ totalCapped ? '+' : '' }}</em></button>
        <button type="button" role="tab" :aria-selected="tab === 'users'" :class="{ active: tab === 'users' }" @click="switchTab('users')">违规用户<em class="tnum">{{ summary?.users || 0 }}</em></button>
        <button type="button" role="tab" :aria-selected="tab === 'rules'" :class="{ active: tab === 'rules' }" @click="switchTab('rules')">识别与扣费规则<i v-if="rulesDirty" class="cp-dot" title="有未保存的修改" /></button>
      </nav>

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

      <div v-else-if="tab === 'users'" v-loading="summaryLoading" class="cp-users">
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

      <div v-else v-loading="rulesLoading" class="cp-rules">
        <el-alert v-if="rulesError" :title="`规则读取失败：${rulesError}`" type="error" :closable="false" />
        <div v-if="savedRules" class="cp-rules-status" :class="{ 'is-dirty': rulesDirty }">
          <span v-if="rulesDirty"><strong>有未保存的修改</strong>，保存前仍按原规则判断。</span>
          <span v-else>当前生效：违规扣费<strong>{{ savedRules.enabled ? '已开启' : '已关闭' }}</strong> · 每人每天免扣 <strong>{{ savedRules.dailyFreeCount }}</strong> 次 · 共 <strong>{{ keywordCount(savedRules) }}</strong> 个关键词</span>
        </div>
        <section class="cp-rules-grid">
          <div class="cp-rules-form">
            <div class="cp-field-row">
              <div class="cp-field">
                <label>违规扣费</label>
                <el-switch v-model="rules.enabled" active-text="开启" inactive-text="关闭" />
                <p>关闭后仍会识别和记录违规，但所有违规都照常退回积分。</p>
              </div>
              <div class="cp-field">
                <label>每人每天免扣次数</label>
                <el-input-number v-model="rules.dailyFreeCount" :min="0" :max="1000" :step="1" :disabled="!rules.enabled" controls-position="right" />
                <p>{{ freeExample }}</p>
              </div>
            </div>
            <div class="cp-field">
              <label>违规说法 <em>{{ draftRules.policyPhrases.length }} 个</em></label>
              <el-input v-model="rules.policyPhrases" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="每行一个，例如：防护限制" />
              <p>上游安全过滤的固定说法。返回文字里出现任意一个就算违规。不区分大小写，重复项会自动去掉。</p>
            </div>
            <div class="cp-field-row">
              <div class="cp-field">
                <label>拒绝说法 <em>{{ draftRules.refusalPhrases.length }} 个</em></label>
                <el-input v-model="rules.refusalPhrases" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="每行一个，例如：不能帮助" />
                <p>模型直接拒绝时的说法。必须和右边的敏感词同时出现才算违规。</p>
              </div>
              <div class="cp-field">
                <label>敏感词 <em>{{ draftRules.sensitiveWords.length }} 个</em></label>
                <el-input v-model="rules.sensitiveWords" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="每行一个，例如：裸露" />
                <p>只有拒绝说法不算违规（模型也会用“无法帮助”拒绝正常请求）。</p>
              </div>
            </div>
            <el-alert v-if="rulesProblem" :title="rulesProblem" type="warning" :closable="false" show-icon />
            <div class="cp-rules-actions">
              <el-button type="primary" :loading="rulesSaving" :disabled="!rulesDirty || Boolean(rulesProblem)" @click="saveRules">保存规则</el-button>
              <el-button :disabled="!rulesDirty" @click="revertRules">放弃修改</el-button>
              <el-button text :disabled="!ruleDefaults" @click="restoreDefaults">恢复默认关键词</el-button>
            </div>
          </div>

          <aside class="cp-test">
            <h4>试一试</h4>
            <p>粘贴一段上游返回的失败文字，按左边正在编辑的规则（未保存也可以）判断是否算违规。</p>
            <el-input v-model="testMessage" type="textarea" :autosize="{ minRows: 5, maxRows: 12 }" placeholder="例如：非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。" @keydown="onTestKeydown" />
            <div class="cp-test-actions">
              <el-button type="primary" plain :loading="testing" :disabled="!testMessage.trim()" @click="runTest">识别</el-button>
              <span class="muted">⌘/Ctrl + Enter</span>
            </div>
            <div v-if="testResult" class="cp-test-result" :class="testResult.violation ? 'is-hit' : 'is-miss'">
              <strong>{{ testResult.violation ? '算违规' : '不算违规' }}</strong>
              <span v-if="testResult.violation">命中规则：<span class="cp-rule">{{ testResult.rule }}</span></span>
              <span v-else>按普通失败处理，积分照常退回</span>
              <p v-if="testResult.violation" class="cp-marked"><template v-for="(segment, index) in highlight(testResult.message, ruleTerms(testResult.rule))" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></p>
            </div>
          </aside>
        </section>
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

.cp-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); flex: none; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-2); }
.cp-kpis button { display: grid; gap: 4px; min-width: 0; padding: 12px 16px; border: 0; border-right: 1px solid var(--border); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color .15s ease; }
.cp-kpis button:last-child { border-right: 0; }
.cp-kpis button:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
.cp-kpis button.active { background: var(--surface); box-shadow: inset 0 -2px 0 var(--ink); }
.cp-kpis button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.cp-kpis small { color: var(--ink-3); font-size: 12px; font-weight: 650; }
.cp-kpis strong { overflow: hidden; color: var(--ink); font-size: 21px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.cp-kpis span { overflow: hidden; color: var(--ink-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.cp-kpis button.is-charged strong { color: var(--danger); }

.cp-tabs { display: flex; flex: none; gap: 6px; }
.cp-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-tabs button.active { border-color: var(--ink); background: var(--ink); color: var(--surface); }
.cp-tabs em { font-style: normal; font-size: 11px; opacity: .7; }
.cp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning, #e6a23c); }

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
mark { padding: 0 2px; border-radius: 3px; background: color-mix(in srgb, #f5c400 45%, transparent); color: inherit; }

.cp-rules { display: grid; gap: 14px; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }
.cp-rules-status { padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-2); color: var(--ink-2); font-size: 13px; }
.cp-rules-status strong { color: var(--ink); font-weight: 650; }
.cp-rules-status.is-dirty { border-color: color-mix(in srgb, var(--warning, #e6a23c) 55%, transparent); background: color-mix(in srgb, var(--warning, #e6a23c) 10%, transparent); }
.cp-rules-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
.cp-rules-form { display: grid; gap: 18px; min-width: 0; }
.cp-field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.cp-field { display: grid; gap: 6px; align-content: start; min-width: 0; }
.cp-field label { color: var(--ink); font-size: 13px; font-weight: 650; }
.cp-field label em { margin-left: 6px; color: var(--ink-3); font-size: 12px; font-style: normal; font-weight: 500; }
.cp-field p { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.cp-field :deep(.el-input-number) { width: 160px; }
.cp-rules-actions { position: sticky; bottom: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 -2px; padding: 10px 2px; border-top: 1px solid var(--border); background: var(--surface); }
.cp-test { position: sticky; top: 0; display: grid; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-2); }
.cp-test h4 { margin: 0; font-size: 14px; }
.cp-test > p { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.cp-test-actions { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.cp-test-result { display: grid; gap: 4px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
.cp-test-result.is-hit { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.cp-test-result.is-hit > strong { color: var(--danger); }
.cp-test-result.is-miss { background: color-mix(in srgb, var(--success) 12%, transparent); }
.cp-test-result.is-miss > strong { color: var(--success); }
.cp-test-result span { color: var(--ink-2); font-size: 12px; }
.cp-marked { margin: 4px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }

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

@media (max-width: 1100px) {
  .cp-rules-grid { grid-template-columns: minmax(0, 1fr); }
  .cp-test { position: static; }
}
@media (max-width: 900px) {
  .cp-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cp-kpis button { border-bottom: 1px solid var(--border); }
  .cp-search, .cp-select { width: 100%; }
  .cp-field-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
