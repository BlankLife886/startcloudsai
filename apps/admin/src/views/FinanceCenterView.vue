<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue'
import PageCard from '@/components/PageCard.vue'
import OrderAccountingDetail from '@/components/OrderAccountingDetail.vue'
import AdminDateRange from '@/components/AdminDateRange.vue'
import CursorPager from '@/components/CursorPager.vue'
import { useFinanceWorkspace } from '@/useFinanceWorkspace'
const financeTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const orderTagType = (status?: string) => status === 'completed' ? 'success' : status === 'uncertain' || status === 'paid' ? 'warning' : status === 'failed' ? 'danger' : 'info'
const { orderActions, activeTab, days, query, orderStatus, range, cashSummary, orders, reconciliations, changes, summary, selectedOrderId, detailVisible, runningRecon, recoverySupported, outcomeLabels, receivedCents, filteredOrders, tabs, money, points, statusLabel, changeLabel, outcomeType, openOrder, load, runReconciliation, confirmNotCreated, loading, loadError, reconciliationReport, orderList, reconTotal, reconIssueTotal, reconPage, changeTotal, changePage, changeRecordPage, profitPager } = useFinanceWorkspace()
const openOrderRow = (row: { id: string }) => openOrder(row.id)
</script>

<template>
  <div class="page finance-center">
    <PageCard>
      <template #header>
        <div class="finance-filters">
          <AdminDateRange v-model:from="range.createdFrom" v-model:to="range.createdTo" label="记录时间" />
          <el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索用户、订单、套餐" class="finance-search" @keyup.enter="load" @clear="load" />
          <el-button type="primary" :disabled="loading" @click="load">查询</el-button>
        </div>
      </template>
      <template #actions>
        <el-segmented v-model="days" :options="[{ label: '近 7 日', value: 7 }, { label: '近 30 日', value: 30 }]" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </template>

      <el-alert v-if="loadError || orderList.error.value" :title="loadError || orderList.error.value || ''" type="error" :closable="false" />
      <el-alert v-if="reconciliationReport" :title="reconciliationReport" :type="reconciliationReport.includes('未完成') ? 'error' : 'info'" closable @close="reconciliationReport = ''" />

      <section class="finance-kpis" aria-label="账务摘要" title="订单与收款按记录时间筛选；创作毛利按近 N 日统计，为积分口径">
        <article><small>订单</small><strong class="tnum">{{ cashSummary?.total ?? '—' }}</strong></article>
        <article><small>确认实收</small><strong class="tnum">{{ money(receivedCents) }}</strong></article>
        <article><small>已退款</small><strong class="tnum">{{ money(cashSummary?.refundedCents) }}</strong></article>
        <article :class="{ warn: (cashSummary?.pendingOrders || 0) > 0 }"><small>待处理订单</small><strong class="tnum">{{ cashSummary?.pendingOrders ?? '—' }}</strong></article>
        <article :class="{ warn: reconIssueTotal > 0 }"><small>对账异常</small><strong class="tnum">{{ reconIssueTotal }}</strong></article>
        <article :class="Number(summary.grossProfitCents || 0) < 0 ? 'loss' : 'gain'"><small>近 {{ days }} 日创作毛利</small><strong class="tnum">{{ points(summary.grossProfitCents) }}<em>积分</em></strong></article>
      </section>

      <div class="finance-toolbar">
        <nav class="finance-tabs" role="tablist" aria-label="账务模块">
          <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :class="{ active: activeTab === tab.id, alert: tab.id === 'reconcile' && tab.count > 0 }" @click="activeTab = tab.id">
            {{ tab.label }}<em v-if="tab.count" class="tnum">{{ tab.count }}</em>
          </button>
        </nav>
        <div class="finance-toolbar__right">
          <el-select v-if="activeTab === 'orders'" v-model="orderStatus" clearable placeholder="全部状态" class="finance-status" @change="load">
            <el-option label="已完成" value="completed" /><el-option label="待核实" value="uncertain" /><el-option label="待到账" value="paid" /><el-option label="失败" value="failed" />
          </el-select>
          <el-button v-else-if="activeTab === 'reconcile'" type="primary" :icon="Search" :loading="runningRecon" @click="runReconciliation">立即核对</el-button>
          <span v-else-if="activeTab === 'costs'" class="finance-note">积分口径 · 近 {{ days }} 日 · 最多 50 个模型</span>
        </div>
      </div>

      <section v-if="activeTab === 'costs'" class="finance-cost-strip" aria-label="成本汇总">
        <span>实收 <b class="tnum">{{ points(summary.revenueCents) }}</b></span>
        <span>上游成本 <b class="tnum">{{ points(summary.upstreamCostCents) }}</b></span>
        <span>毛利 <b class="tnum" :class="Number(summary.grossProfitCents || 0) < 0 ? 'loss' : 'gain'">{{ points(summary.grossProfitCents) }}</b></span>
        <span>成功 / 失败调用 <b class="tnum">{{ points(summary.succeededUnits) }} / {{ points(summary.failedUnits) }}</b></span>
      </section>

      <div v-loading="loading" class="finance-board">
        <el-table v-if="activeTab === 'orders'" :data="filteredOrders" height="100%" empty-text="暂无订单" class="finance-table is-clickable" @row-click="openOrderRow">
          <el-table-column label="订单号" min-width="150" show-overflow-tooltip><template #default="{ row }"><code class="finance-id">{{ row.id }}</code></template></el-table-column>
          <el-table-column label="用户" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ row.email || "—" }}</template></el-table-column>
          <el-table-column label="套餐" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.planName || "—" }}</template></el-table-column>
          <el-table-column label="应付" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ money(row.amountCents) }}</span></template></el-table-column>
          <el-table-column label="实收" width="110" align="right"><template #default="{ row }"><span class="tnum" :class="{ muted: !(row.finance?.receivedCents ?? row.providerPayAmountCents) }">{{ money(row.finance?.receivedCents ?? row.providerPayAmountCents ?? 0) }}</span></template></el-table-column>
          <el-table-column label="状态" width="112"><template #default="{ row }"><el-tag size="small" :type="orderTagType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="创建时间" width="120"><template #default="{ row }"><span class="tnum">{{ financeTime(row.createdAt) }}</span></template></el-table-column>
        </el-table>

        <el-table v-else-if="activeTab === 'reconcile'" :data="reconciliations" height="100%" empty-text="暂无对账记录" class="finance-table">
          <el-table-column label="订单号" min-width="150" show-overflow-tooltip><template #default="{ row }"><button class="finance-link" type="button" @click="openOrder(row.orderId)"><code class="finance-id">{{ row.orderId }}</code></button></template></el-table-column>
          <el-table-column label="本站状态" width="124"><template #default="{ row }">{{ row.localStatus ? statusLabel(row.localStatus) : "—" }}</template></el-table-column>
          <el-table-column label="应收" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ money(row.expectedAmountCents) }}</span></template></el-table-column>
          <el-table-column label="渠道实付" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ money(row.providerPaidAmountCents ?? row.providerAmountCents) }}</span></template></el-table-column>
          <el-table-column label="核对结果" width="130"><template #default="{ row }"><el-tag size="small" :type="outcomeType(row.outcome)">{{ outcomeLabels[row.outcome] || row.outcome }}</el-tag></template></el-table-column>
          <el-table-column prop="detail" label="说明" min-width="220" show-overflow-tooltip />
          <el-table-column label="核对时间" width="120"><template #default="{ row }"><span class="tnum">{{ financeTime(row.checkedAt) }}</span></template></el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" :loading="orderActions.checkingOrderId.value === row.orderId" :disabled="Boolean(orderActions.checkingOrderId.value)" @click="orderActions.checkOrder(row)">核对</el-button>
              <el-button v-if="recoverySupported && row.outcome === 'provider_id_missing'" text type="warning" size="small" @click="confirmNotCreated(row)">确认未建单</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="activeTab === 'subscriptions'" :data="changes" height="100%" empty-text="暂无订阅变更" class="finance-table">
          <el-table-column label="类型" width="110"><template #default="{ row }"><strong>{{ changeLabel(row.kind) }}</strong></template></el-table-column>
          <el-table-column label="套餐" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.planName || "—" }}</template></el-table-column>
          <el-table-column label="用户" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ row.email || "—" }}</template></el-table-column>
          <el-table-column label="金额" width="110" align="right"><template #default="{ row }"><span class="tnum" :class="{ loss: Number(row.amountCents) < 0 }">{{ money(row.amountCents) }}</span></template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="row.status === 'completed' || row.status === 'active' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="时间" width="120"><template #default="{ row }"><span class="tnum">{{ financeTime(row.createdAt) }}</span></template></el-table-column>
          <el-table-column label="关联订单" min-width="150" show-overflow-tooltip><template #default="{ row }"><button v-if="row.orderId" class="finance-link" type="button" @click="openOrder(row.orderId)"><code class="finance-id">{{ row.orderId }}</code></button><span v-else class="muted">—</span></template></el-table-column>
        </el-table>

        <el-table v-else :data="profitPager.items.value" height="100%" empty-text="当前周期暂无成本数据" class="finance-table">
          <el-table-column label="业务 / 模型" min-width="200" show-overflow-tooltip><template #default="{ row }"><strong>{{ row.label || row.key || "未记录" }}</strong></template></el-table-column>
          <el-table-column label="调用量" width="110" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.units) }}</span></template></el-table-column>
          <el-table-column label="实收" width="130" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.revenueCents) }}</span></template></el-table-column>
          <el-table-column label="上游成本" width="130" align="right"><template #default="{ row }"><span class="tnum">{{ points(row.upstreamCostCents) }}</span></template></el-table-column>
          <el-table-column label="毛利" width="130" align="right"><template #default="{ row }"><span class="tnum" :class="Number(row.grossProfitCents || 0) < 0 ? 'loss' : 'gain'">{{ points(row.grossProfitCents) }}</span></template></el-table-column>
          <el-table-column label="毛利率" width="100" align="right"><template #default="{ row }"><span class="tnum">{{ row.revenueCents ? `${((Number(row.grossProfitCents || 0) / row.revenueCents) * 100).toFixed(1)}%` : "—" }}</span></template></el-table-column>
        </el-table>
      </div>

      <CursorPager v-if="activeTab === 'orders'" :has-prev="orderList.hasPrev.value" :has-next="orderList.hasNext.value" :page="orderList.page.value" :total="orderList.total.value" :total-capped="orderList.totalCapped.value" :count="orders.length" :page-size="20" :page-sizes="[20]" :loading="loading" @update:page="orderList.goToPage" />
      <CursorPager v-else-if="activeTab === 'reconcile'" :has-prev="reconPage > 1" :has-next="reconPage * 20 < Math.min(reconTotal, 10000)" :page="reconPage" :total="Math.min(reconTotal, 10000)" :total-capped="reconTotal > 10000" :page-size="20" :page-sizes="[20]" :loading="loading" @update:page="value => changeRecordPage('reconcile', value)" />
      <CursorPager v-else-if="activeTab === 'subscriptions'" :has-prev="changePage > 1" :has-next="changePage * 25 < Math.min(changeTotal, 10000)" :page="changePage" :total="Math.min(changeTotal, 10000)" :total-capped="changeTotal > 10000" :page-size="25" :page-sizes="[25]" :loading="loading" @update:page="value => changeRecordPage('subscriptions', value)" />
      <CursorPager v-else :has-prev="profitPager.hasPrev.value" :has-next="profitPager.hasNext.value" :page="profitPager.page.value" :total="profitPager.total.value" :page-size="20" :page-sizes="[20]" @update:page="profitPager.goToPage" />
    </PageCard>

    <el-drawer v-model="detailVisible" title="订单账务详情" size="min(760px, 94vw)" destroy-on-close>
      <OrderAccountingDetail v-if="selectedOrderId" :order-id="selectedOrderId" />
    </el-drawer>
  </div>
</template>

<style scoped>
/* 卡片填满视口：表格在内部滚动，分页器固定在底部 */
.finance-center { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow-y: auto; }
.finance-center :deep(.page-card) { display: flex; flex: 1 1 0; flex-direction: column; min-height: 520px; overflow: hidden; }
.finance-center :deep(.page-card__header) { flex-wrap: wrap; padding-bottom: 0; }
.finance-center :deep(.page-card__body) { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; padding-top: 14px; }
.finance-center :deep(.el-alert) { flex: 0 0 auto; }

.finance-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.finance-search { width: 240px; }

.finance-kpis { display: grid; flex: 0 0 auto; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-2); }
.finance-kpis article { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 10px 14px; border-right: 1px solid var(--border); }
.finance-kpis article:last-child { border-right: 0; }
.finance-kpis small { flex: 0 0 auto; color: var(--ink-3); font-size: 12px; font-weight: 650; white-space: nowrap; }
.finance-kpis strong { overflow: hidden; color: var(--ink); font-size: 17px; font-weight: 750; letter-spacing: -0.02em; text-overflow: ellipsis; white-space: nowrap; }
.finance-kpis strong em { margin-left: 3px; color: var(--ink-3); font-size: 11px; font-style: normal; font-weight: 600; }
.finance-kpis .warn strong { color: var(--warning); }
.finance-kpis .gain strong { color: var(--success); }
.finance-kpis .loss strong { color: var(--danger); }

.finance-toolbar { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); }
.finance-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.finance-tabs button { display: inline-flex; align-items: center; margin-bottom: -1px; padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--ink-3); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.finance-tabs button:hover { color: var(--ink); }
.finance-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.finance-tabs button.active { border-bottom-color: var(--accent); color: var(--ink); font-weight: 650; }
.finance-tabs em { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; border-radius: 9px; background: var(--surface-3); color: var(--ink-2); font-size: 11px; font-style: normal; }
.finance-tabs button.alert em { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--warning); }
.finance-toolbar__right { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; }
.finance-status { width: 130px; }
.finance-note { color: var(--ink-3); font-size: 12px; white-space: nowrap; }

.finance-cost-strip { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 8px 24px; color: var(--ink-3); font-size: 12px; }
.finance-cost-strip b { margin-left: 4px; color: var(--ink); font-size: 14px; }

.finance-board { flex: 1; min-height: 240px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); }
.finance-table { width: 100%; }
.finance-table :deep(.cell) { white-space: nowrap; }
.finance-table.is-clickable :deep(.el-table__row) { cursor: pointer; }
.finance-center :deep(.el-table__body tr:hover) .finance-id { color: var(--ink); }
.finance-id { color: var(--ink-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.finance-link { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.finance-link:hover .finance-id { color: var(--accent-ink, var(--el-color-primary)); text-decoration: underline; }
.muted { color: var(--ink-3); }
.gain { color: var(--success); }
.loss { color: var(--danger); }


@media (max-width: 1100px) {
  .finance-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .finance-kpis article:nth-child(3) { border-right: 0; }
  .finance-kpis article:nth-child(-n + 3) { border-bottom: 1px solid var(--border); }
}
</style>
