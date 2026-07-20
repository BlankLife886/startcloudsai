<script lang="ts">
import { usePricingPageContext } from './pricingPageContext'
import ApiDocsView from '@/views/ApiDocsView.vue'
import PcDateTimeField from '@/components/pricing/PcDateTimeField.vue'
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import PcStatAnimatedValue from '@/components/pricing/PcStatAnimatedValue.vue'
import PcSubscriptionDashboardPanel from '@/components/pricing/PcSubscriptionDashboardPanel.vue'

export default {
  components: {
    ApiDocsView,
    PcDateTimeField,
    PcAnimatedNumber,
    PcStatAnimatedValue,
    PcSubscriptionDashboardPanel,
  },
  setup: usePricingPageContext,
}
</script>

<template>
<section class="pc-section pc-usage">
  <article class="pc-usage-token-24h">
    <div class="pc-usage-token-24h__head">
      <div>
        <h2>24h Token 消耗</h2>
        <p>近 24 小时内你的 API 调用 token 汇总（输入 / 缓存 / 输出）</p>
      </div>
      <span class="pc-usage-token-24h__count">
        {{ usageTokenTotals24h.callCount }} 次调用
      </span>
    </div>
    <div v-if="usageTokenTotals24h.callCount > 0" class="pc-usage-token-24h__body">
      <div class="pc-usage-token-24h__metric">
        <span>输入</span>
        <strong class="pc-num">{{
          formatTokenCountShort(usageTokenTotals24h.inputTokens)
        }}</strong>
      </div>
      <div class="pc-usage-token-24h__metric">
        <span>缓存</span>
        <strong class="pc-num">{{
          formatTokenCountShort(usageTokenTotals24h.cacheTokens)
        }}</strong>
      </div>
      <div class="pc-usage-token-24h__metric">
        <span>输出</span>
        <strong class="pc-num">{{
          formatTokenCountShort(usageTokenTotals24h.outputTokens)
        }}</strong>
      </div>
      <div class="pc-usage-token-24h__metric is-total">
        <span>合计</span>
        <strong class="pc-num">{{
          formatTokenCountShort(usageTokenTotals24h.totalTokens)
        }}</strong>
      </div>
    </div>
    <p v-else class="pc-usage-token-24h__empty">
      近 24 小时暂无调用记录。发起 API 请求后，这里会显示 token
      消耗汇总；下方表格可查看每次调用的明细。
    </p>
  </article>

  <div class="pc-usage-stats">
    <article
      v-for="card in usageStatsCards"
      :key="card.id"
      class="pc-usage-stat"
      :class="`is-${card.tone}`"
    >
      <div class="pc-usage-stat__head">
        <span>{{ card.label }}</span>
        <i class="bi" :class="card.icon"></i>
      </div>
      <PcStatAnimatedValue
        :card="card"
        :enabled="sectionNumbersEnabled && activeSection === 'usage'"
      />
      <small>{{ card.hint }}</small>
    </article>
  </div>

  <div v-if="keyKindUsageCards.length" class="pc-usage-key-split">
    <article
      v-for="card in keyKindUsageCards"
      :key="card.id"
      class="pc-usage-stat pc-usage-key-split__card"
      :class="`is-${card.tone}`"
    >
      <div class="pc-usage-stat__head">
        <span>{{ card.label }}（本月）</span>
        <i class="bi" :class="card.icon"></i>
      </div>
      <PcStatAnimatedValue
        :card="card"
        :enabled="sectionNumbersEnabled && activeSection === 'usage'"
      />
      <small>
        <template v-if="card.animateCost != null && card.animateCost > 0">
          <PcAnimatedNumber
            tag="span"
            :value="card.animateCost"
            format="usd"
            :delay="overviewNumberDelay((card.animateDelay || 0) + 40)"
            :enabled="sectionNumbersEnabled && activeSection === 'usage'"
          />
        </template>
        <template v-else>{{ card.hint }}</template>
      </small>
    </article>
  </div>

  <article class="pc-usage-panel">
    <header class="pc-usage-panel__head">
      <div class="pc-usage-filters">
        <div class="pc-usage-filter-control">
          <span class="pc-usage-filter-control__label">
            <i class="bi bi-check2-circle"></i>
            状态码
          </span>
          <div
            class="pc-usage-filter-control__select-wrap"
            :class="{ 'is-active': usageStatusFilter !== 'all' }"
          >
            <select
              v-model="usageStatusFilter"
              class="pc-usage-filter-control__select"
              aria-label="筛选状态码"
            >
              <option value="all">全部</option>
              <option value="2xx">2xx 成功</option>
              <option value="4xx">4xx 客户端错误</option>
              <option value="5xx">5xx 服务端错误</option>
            </select>
            <i
              class="bi bi-chevron-down pc-usage-filter-control__chevron"
              aria-hidden="true"
            ></i>
          </div>
        </div>
        <div class="pc-usage-filter-control">
          <span class="pc-usage-filter-control__label">
            <i class="bi bi-cpu"></i>
            模型
          </span>
          <div
            class="pc-usage-filter-control__select-wrap"
            :class="{ 'is-active': usageModelFilter !== 'all' }"
          >
            <select
              v-model="usageModelFilter"
              class="pc-usage-filter-control__select"
              aria-label="筛选模型"
            >
              <option value="all">全部</option>
              <option
                v-for="model in usageModelOptions"
                :key="model.value"
                :value="model.value"
              >
                {{ model.label }}
              </option>
            </select>
            <i
              class="bi bi-chevron-down pc-usage-filter-control__chevron"
              aria-hidden="true"
            ></i>
          </div>
        </div>
        <div class="pc-usage-filter-control">
          <span class="pc-usage-filter-control__label">
            <i class="bi bi-key"></i>
            密钥类型
          </span>
          <div
            class="pc-usage-filter-control__select-wrap"
            :class="{ 'is-active': usageKeyKindFilter !== 'all' }"
          >
            <select
              v-model="usageKeyKindFilter"
              class="pc-usage-filter-control__select"
              aria-label="筛选密钥类型"
            >
              <option value="all">全部</option>
              <option value="subscription">订阅密钥</option>
              <option value="wallet">充值密钥</option>
            </select>
            <i
              class="bi bi-chevron-down pc-usage-filter-control__chevron"
              aria-hidden="true"
            ></i>
          </div>
        </div>
        <button
          v-if="
            usageStatusFilter !== 'all' ||
            usageModelFilter !== 'all' ||
            usageKeyKindFilter !== 'all'
          "
          type="button"
          class="pc-usage-filter-reset"
          @click="resetUsageFilters"
        >
          <i class="bi bi-x-lg"></i>
          清除筛选
        </button>
      </div>
      <div class="pc-usage-panel__meta">
        <span class="pc-usage-count">共 {{ filteredUsageLogs.length }} 条</span>
      </div>
    </header>

    <div v-if="!filteredUsageLogs.length" class="pc-usage-empty">
      <i class="bi bi-inbox"></i>
      <strong>{{ usageLogs.length ? '暂无匹配记录' : '暂无调用记录' }}</strong>
      <p>
        {{
          usageLogs.length
            ? '调整筛选条件后再试。'
            : '发起 API 调用后，这里会展示用量与调用明细。'
        }}
      </p>
    </div>
    <div v-else class="pc-usage-table-wrap">
      <table class="pc-usage-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>模型</th>
            <th class="pc-cell-center">输入/缓存/输出</th>
            <th class="pc-cell-right">花费</th>
            <th class="pc-cell-center">状态码</th>
            <th class="pc-cell-center">总耗时</th>
            <th class="pc-cell-center">首字延迟</th>
            <th class="pc-cell-center">TPS</th>
            <th>密钥类型</th>
            <th class="pc-cell-center">流式响应</th>
            <th>请求端点</th>
            <th>来源 IP</th>
            <th>请求 ID</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayedUsageLogs" :key="row.id">
            <td class="pc-num pc-usage-table__time">
              {{ formatUsageDateTime(row.createdAt) }}
            </td>
            <td class="pc-usage-table__model">
              <strong>{{ row.modelLabel || formatUsageModelLabel(row) }}</strong>
            </td>
            <td class="pc-cell-center pc-num pc-usage-table__tokens">
              {{ formatUsageTokenLine(row) }}
            </td>
            <td class="pc-cell-right pc-num pc-usage-table__price">
              {{ formatUsageCostUsd(row.estimatedCostUsd) }}
            </td>
            <td class="pc-cell-center">
              <span
                v-if="row.httpStatus"
                class="pc-usage-pill pc-usage-pill--http"
                :class="usageHttpToneClass(row.httpStatus)"
              >
                {{ row.httpStatus }}
              </span>
              <span v-else class="pc-cell-muted">—</span>
            </td>
            <td class="pc-cell-center pc-num">
              {{ formatUsageDuration(row.totalMs) }}
            </td>
            <td
              class="pc-cell-center pc-num pc-usage-table__ttft"
              :class="usageTtftToneClass(row.ttftMs)"
              :title="formatUsagePhaseTooltip(row) || undefined"
            >
              {{ formatUsageDuration(row.ttftMs) }}
            </td>
            <td class="pc-cell-center pc-num">
              {{ formatUsageTps(row.tps) }}
            </td>
            <td class="pc-usage-table__key-kind">
              <span
                class="pc-usage-pill"
                :class="row.keyKind === 'subscription' ? 'is-plan' : 'is-wallet'"
              >
                {{ usageKeyKindLabel(row.keyKind) }}
              </span>
            </td>
            <td class="pc-cell-center">
              <span
                class="pc-usage-pill pc-usage-pill--stream"
                :class="row.stream ? 'is-yes' : 'is-no'"
              >
                {{ row.stream ? '是' : '否' }}
              </span>
            </td>
            <td class="pc-usage-table__endpoint">
              <code>{{ row.endpoint || '—' }}</code>
            </td>
            <td class="pc-num pc-usage-table__ip">
              {{ row.sourceIp || '—' }}
            </td>
            <td class="pc-usage-table__request">
              <button
                v-if="row.requestId"
                type="button"
                class="pc-usage-copy"
                :title="row.requestId"
                @click="copyText(row.requestId, '请求 ID 已复制')"
              >
                <code>{{ truncateRequestId(row.requestId, 5) }}</code>
                <i class="bi bi-clipboard"></i>
              </button>
              <span v-else class="pc-cell-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</section>
</template>
