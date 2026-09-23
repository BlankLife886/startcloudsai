import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { useClientPagination } from '@/useClientPagination'
import { adminRecentRange } from '@/adminListFilters'
import type { AccountingSummary } from '@/billingTypes'

type Order = { id: string; status: string; amountCents: number; providerPayAmountCents?: number; createdAt: string; userEmail?: string; email?: string; planName?: string; providerOrderId?: string; finance?: { receivedCents?: number } }
type Reconciliation = { id?: number; orderId: string; localStatus?: string; expectedAmountCents?: number; providerAmountCents?: number; providerPaidAmountCents?: number; outcome: string; detail?: string; checkedAt: string }
type Change = { id: string; kind?: string; status?: string; createdAt?: string; orderId?: string; userEmail?: string; email?: string; planName?: string; amountCents?: number }
type ProfitRow = { key?: string; label?: string; units?: number; revenueCents?: number; upstreamCostCents?: number; grossProfitCents?: number }
type Profit = { summary?: { revenueCents?: number; upstreamCostCents?: number; grossProfitCents?: number; succeededUnits?: number; failedUnits?: number }; items?: ProfitRow[] }

export function useFinanceWorkspace() {
  const activeTab = ref('orders'), days = ref(7), query = ref(''), orderStatus = ref('')
  const range = ref(adminRecentRange(7)), applied = ref({ ...range.value, search: '', status: '' })
  const cashSummary = ref<AccountingSummary | null>(null), profit = ref<Profit>({}), extraLoading = ref(false), loadError = ref('')
  const selectedOrderId = ref(''), detailVisible = ref(false), runningRecon = ref(false), recoverySupported = ref(false), reconciliationReport = ref('')
  const checkingOrderId = ref('')
  const reconciliations = ref<Reconciliation[]>([]), reconTotal = ref(0), reconIssueTotal = ref(0), reconPage = ref(1), changes = ref<Change[]>([]), changeTotal = ref(0), changePage = ref(1)
  let orderSummaryScope = ''
  let orderListTotal: Pick<Page<Order>, 'total' | 'totalCapped'> = {}
  const orderList = usePagedList<Order>(async (cursor, page) => {
    // The summary scans every matching order: fetch it when filters change, reuse it while paging.
    const scope = JSON.stringify(applied.value)
    const includeSummary = scope !== orderSummaryScope || !cashSummary.value
    const data = await request<Page<Order> & { summary?: AccountingSummary }>('/api/v1/admin/orders', { query: { ...applied.value, limit: 20, cursor, page, summary: includeSummary }, silent: true })
    if (data.summary) {
      cashSummary.value = data.summary
      orderSummaryScope = scope
      orderListTotal = { total: data.total, totalCapped: data.totalCapped }
    }
    return { ...data, ...orderListTotal, items: data.items.map(item => ({ ...item, email: item.userEmail || item.email })) }
  }, () => applied.value, { pageSeek: true })
  const orders = orderList.items, filteredOrders = orderList.items
  const summary = computed(() => profit.value.summary || {}), profitRows = computed(() => profit.value.items || [])
  const profitPager = useClientPagination(() => profitRows.value, 20)
  const isSettledOutcome = (v: string) => ['matched', 'repaired', 'manual_not_created'].includes(v)
  const issueCount = computed(() => reconciliations.value.filter(item => !isSettledOutcome(item.outcome)).length)
  const receivedCents = computed(() => cashSummary.value?.receivedCents)
  const loading = computed(() => orderList.loading.value || extraLoading.value)
  const statusLabels: Record<string, string> = { completed: '已完成', paid: '已收款待到账', pending: '待支付', uncertain: '待核实', failed: '失败', expired: '已过期', cancelled: '已取消', active: '生效中', reviewing: '审核中', processing: '处理中', rejected: '已驳回' }
  const outcomeLabels: Record<string, string> = { matched: '金额一致', repaired: '已自动补齐', provider_id_missing: '缺少渠道单号', provider_error: '渠道查询失败', paid_amount_mismatch: '实付金额不一致', identity_or_amount_mismatch: '订单信息不一致', repair_failed: '补单失败', manual_not_created: '已确认未建单', create_result_unknown: '建单结果不明', close_result_unknown: '关单结果不明', local_terminal_mismatch: '终态冲突', local_ahead: '本站状态超前' }
  const money = (v?: number | null) => v == null ? '—' : `${v < 0 ? '-' : ''}¥${(Math.abs(v) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const points = (v?: number) => v == null ? '—' : v.toLocaleString('zh-CN')
  const statusLabel = (v?: string) => statusLabels[v || ''] || v || '未知'
  const changeLabel = (v?: string) => ({ upgrade: '订阅升级', subscription: '订阅开通', refund: '退订退款', cycle: '周期发放' }[v || ''] || v || '订阅变更')
  const outcomeType = (v: string) => isSettledOutcome(v) ? 'success' : 'warning'
  const tabs = computed(() => [{ id: 'orders', label: '订单与收款', count: cashSummary.value?.total || 0 }, { id: 'reconcile', label: '对账与异常', count: reconIssueTotal.value }, { id: 'subscriptions', label: '订阅变更', count: changeTotal.value }, { id: 'costs', label: '创作成本', count: profitRows.value.length }])
  let generation = 0
  async function loadRecords(mode: 'reconcile' | 'subscriptions', page = 1) {
    const endpoint = mode === 'reconcile' ? '/api/v1/admin/payment-reconciliations' : '/api/v1/admin/subscription-changes'
    const query = { ...applied.value, q: applied.value.search, status: '', page, limit: mode === 'reconcile' ? 20 : 25 }
    const [data, issues] = await Promise.all([
      request<{ items: (Reconciliation & Change)[]; total: number; recoverySupported?: boolean }>(endpoint, { query: { ...query, issues: false }, silent: true }),
      // 异常总数（全部页）：只取一条，用返回的 total。
      mode === 'reconcile' ? request<{ total: number }>(endpoint, { query: { ...query, issues: true, page: 1, limit: 1 }, silent: true }) : Promise.resolve(null),
    ])
    if (mode === 'reconcile') { reconciliations.value = data.items; reconTotal.value = data.total; reconIssueTotal.value = issues?.total ?? 0; reconPage.value = page; recoverySupported.value = !!data.recoverySupported }
    else { changes.value = data.items.map(item => ({ ...item, email: item.userEmail || item.email })); changeTotal.value = data.total; changePage.value = page }
  }
  async function changeRecordPage(mode: 'reconcile' | 'subscriptions', page: number) {
    if (extraLoading.value) return
    extraLoading.value = true; loadError.value = ''
    try { await loadRecords(mode, page) } catch(e) { loadError.value = e instanceof Error ? e.message : '翻页失败' } finally { extraLoading.value = false }
  }
  async function load() {
    if (loading.value) return
    const own = ++generation
    applied.value = { ...range.value, search: query.value.trim(), status: orderStatus.value }
    extraLoading.value = true; loadError.value = ''
    const loadProfit = request<Profit>('/api/v1/admin/profitability', { query: { days: days.value, dimension: 'model' }, silent: true }).then(value => { if (own === generation) profit.value = value })
    const results = await Promise.allSettled([orderList.reset(), loadRecords('reconcile'), loadRecords('subscriptions'), loadProfit])
    if (results.some(r => r.status === 'rejected') || orderList.error.value) loadError.value = '部分财务数据读取失败，保留的旧数据不可当作最新结果，请重试。'
    extraLoading.value = false; profitPager.reset()
  }
  watch(days, () => { range.value = adminRecentRange(days.value); void load() })
  const openOrder = (id: string) => { selectedOrderId.value = id; detailVisible.value = true }
  async function runReconciliation() {
    if (runningRecon.value || loading.value) return
    try { await ElMessageBox.confirm('将核对系统选出的最多 100 笔待核查订单，符合校验条件的漏单可能自动补齐。此操作不受当前列表时间筛选限制，不会重新收款。', '执行渠道核对', { confirmButtonText: '开始核对', cancelButtonText: '取消', type: 'warning' }) } catch { return }
    runningRecon.value = true; reconciliationReport.value = '正在查询支付渠道，请等待…'
    try {
      const result = await request<{ checked: number; outcomes: Record<string, number> }>('/api/v1/admin/payment-reconciliations/run', { method: 'POST', silent: true })
      reconciliationReport.value = `核对完成 · ${new Date().toLocaleTimeString('zh-CN')} · 检查 ${result.checked} 笔。` + (result.checked ? Object.entries(result.outcomes || {}).map(([key,count]) => `${outcomeLabels[key] || key} ${count} 笔`).join('；') : '没有符合当前批次条件的待核查订单，不代表历史异常已解决。')
      await load()
    } catch(e) { reconciliationReport.value = `核对未完成：${e instanceof Error ? e.message : '渠道请求失败'}，请检查渠道配置或稍后重试。` } finally { runningRecon.value = false }
  }
  async function confirmNotCreated(item: { orderId?: string }) {
    try {
      const { value } = await ElMessageBox.prompt('仅在渠道后台确认没有建立订单、没有收到款项后继续。', '确认未建单', { inputValidator: v => v.trim().length >= 6 || '请填写至少 6 个字的核查依据', type: 'warning' })
      await request('/api/v1/admin/payment-reconciliations/run', { method: 'POST', body: { orderId: item.orderId, resolution: 'not_created', note: value }, silent: true })
      ElMessage.success('核查结果已记录'); await load()
    } catch(e) { if(e !== 'cancel' && e !== 'close') ElMessage.error(e instanceof Error ? e.message : '处理失败') }
  }
  async function checkOrder(raw: unknown) {
    const item = raw as Reconciliation
    if (!item?.orderId) return
    if (checkingOrderId.value || runningRecon.value) return
    checkingOrderId.value = item.orderId
    try {
      const response = await request<{ result: Reconciliation }>('/api/v1/admin/payment-reconciliations/run', { method: 'POST', body: { orderId: item.orderId, resolution: 'check' }, silent: true })
      Object.assign(item, response.result)
      reconciliationReport.value = `订单 ${item.orderId}：${outcomeLabels[item.outcome] || item.outcome}。${item.detail || ''}`
      await orderList.refresh()
    } catch(e) { reconciliationReport.value = `订单 ${item.orderId} 核对失败：${e instanceof Error ? e.message : '请求失败'}`;ElMessage.error(reconciliationReport.value) }
    finally { checkingOrderId.value = '' }
  }
  onMounted(load)
  const orderActions = { checkingOrderId, checkOrder }
  return { orderActions, activeTab, days, query, orderStatus, range, applied, cashSummary, orders, reconciliations, changes, summary, profitRows, selectedOrderId, detailVisible, runningRecon, recoverySupported, statusLabels, outcomeLabels, issueCount, receivedCents, filteredOrders, tabs, money, points, statusLabel, changeLabel, outcomeType, openOrder, load, runReconciliation, confirmNotCreated, loading, loadError, reconciliationReport, orderList, reconTotal, reconIssueTotal, reconPage, changeTotal, changePage, changeRecordPage, profitPager }
}

