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
<section class="pc-section pc-sub-plans">
  <nav
    ref="planTabsRef"
    class="pc-sub-plans__main-tabs"
    :class="{ 'is-indicator-ready': planTabIndicatorReady }"
    role="tablist"
    aria-label="套餐订阅"
  >
    <span
      class="pc-sub-plans__main-tabs-indicator"
      aria-hidden="true"
      :style="planTabIndicatorStyle"
    ></span>
    <button
      v-for="tab in visiblePlanConsoleTabs"
      :key="tab.id"
      type="button"
      role="tab"
      :ref="(el) => setPlanTabButtonRef(tab.id, el)"
      class="pc-sub-plans__main-tab"
      :class="{ 'is-active': planConsoleTab === tab.id }"
      :aria-selected="planConsoleTab === tab.id"
      @click="selectPlanConsoleTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>

  <Transition name="pc-sub-plans-panel" mode="out-in">
    <div v-if="planConsoleTab === 'current'" key="current" class="pc-sub-plans__panel">
      <div v-if="!authStore.isAuthenticated" class="pc-sub-plans__empty">
        <i class="bi bi-lock"></i>
        <strong>登录后查看当前套餐</strong>
        <p>订阅额度、到期时间与订阅密钥需登录后查看。</p>
        <RouterLink
          class="pc-btn pc-btn--primary"
          :to="{
            name: 'auth',
            query: { mode: 'login', redirect: '/pricing?section=plans' },
          }"
        >
          去登录
        </RouterLink>
      </div>
      <template v-else>
        <PcSubscriptionDashboardPanel
          show-empty-copy
          :dashboard="subscriptionDashboard"
          :numbers-enabled="
            subscriptionPanelNumbersEnabled && activeSection === 'plans'
          "
          :key-action-loading="Boolean(keyActionLoading)"
          @reset-key="openKeyResetModal(subscriptionKey)"
          @subscribe="goSubscribe"
        >
          <template #title>订阅详情</template>
        </PcSubscriptionDashboardPanel>

        <div
          v-if="accountNewSecret && accountNewSecretIsSubscription"
          class="pc-secret"
        >
          <div class="pc-secret-head">
            <i class="bi bi-shield-exclamation"></i>
            <div>
              <strong>请立即保存订阅密钥</strong>
              <small>完整密钥只显示这一次，离开页面后无法再次查看。</small>
            </div>
          </div>
          <div class="pc-secret-body">
            <code>{{ accountNewSecret }}</code>
            <div class="pc-secret-actions">
              <button
                type="button"
                class="pc-btn pc-btn--primary"
                @click="copyText(accountNewSecret, '订阅密钥已复制')"
              >
                <i class="bi bi-clipboard"></i>
                复制密钥
              </button>
              <button
                type="button"
                class="pc-btn pc-btn--ghost"
                @click="dismissNewSecret"
              >
                我已保存
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div
      v-else-if="planConsoleTab === 'catalog'"
      key="catalog"
      class="pc-sub-plans__panel"
    >
      <div
        v-if="!planCatalogMode && (planBillingOptions.month || planBillingOptions.year)"
        class="pc-sub-plans__toggle"
        :class="`is-${planBillingTab}`"
        role="tablist"
        aria-label="订阅周期"
      >
        <span class="pc-sub-plans__toggle-indicator" aria-hidden="true"></span>
        <button
          v-for="tab in planBillingTabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="pc-sub-plans__toggle-btn"
          :class="{ 'is-active': planBillingTab === tab.id }"
          :disabled="!planBillingOptions[tab.id]"
          @click="planBillingTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <small v-if="tab.badge && planBillingOptions.year">{{ tab.badge }}</small>
        </button>
      </div>

      <div v-if="plansLoading" class="pc-sub-plans__grid is-triple">
        <div
          v-for="n in planSkeletonCount"
          :key="n"
          class="pc-sub-plan pc-sub-plan--skeleton"
        ></div>
      </div>
      <div v-else-if="!subscriptionPlans.length" class="pc-sub-plans__empty">
        <i class="bi bi-inbox" aria-hidden="true"></i>
        <strong>暂无订阅套餐</strong>
      </div>
      <div v-else-if="!subscriptionPlanCards.length" class="pc-sub-plans__empty">
        <i class="bi bi-calendar-x" aria-hidden="true"></i>
        <strong>当前周期暂无套餐</strong>
        <p>请切换到另一个订阅周期查看可用方案。</p>
      </div>
      <div v-else class="pc-sub-plans__grid" :class="subscriptionPlansGridClass">
        <article
          v-for="card in subscriptionPlanCards"
          :key="card.key"
          class="pc-sub-plan"
          :class="{
            'is-featured': card.isFeatured,
            'is-current': card.isCurrent,
            'is-catalog': card.catalogMode,
          }"
        >
          <div v-if="card.isFeatured" class="pc-sub-plan__badge">推荐</div>
          <div v-else-if="card.savingsLabel" class="pc-sub-plan__ribbon">
            <span>{{ card.savingsLabel }}</span>
          </div>

          <header class="pc-sub-plan__head">
            <h3 class="pc-sub-plan__name">{{ card.name }}</h3>
            <span v-if="card.planTag" class="pc-sub-plan__tag">{{ card.planTag }}</span>
          </header>

          <div class="pc-sub-plan__pricing">
            <span v-if="card.comparePrice" class="pc-sub-plan__compare">{{
              card.comparePrice
            }}</span>
            <div class="pc-sub-plan__price-row">
              <strong class="pc-sub-plan__price">
                <span class="pc-sub-plan__currency">{{ card.priceParts.symbol }}</span>
                {{ card.priceParts.value }}
              </strong>
              <span v-if="card.durationLabel" class="pc-sub-plan__duration"
                >/ {{ card.durationLabel }}</span
              >
            </div>
            <p v-if="card.dailyPriceLabel" class="pc-sub-plan__daily">
              {{ card.dailyPriceLabel }}
            </p>
            <p v-else class="pc-sub-plan__cycle">{{ card.cycleLabel }}</p>
          </div>

          <p class="pc-sub-plan__headline">{{ card.headline }}</p>
          <ul class="pc-sub-plan__features">
            <li v-for="item in card.features" :key="item">
              <i class="bi bi-check-lg" aria-hidden="true"></i>
              <span>{{ item }}</span>
            </li>
          </ul>

          <div v-if="card.limitBarLabel" class="pc-sub-plan__limit">
            <span>套餐限速</span>
            <strong>{{ card.limitBarLabel }}</strong>
          </div>

          <div class="pc-sub-plan__actions">
            <button
              v-if="card.isCurrent"
              type="button"
              class="pc-sub-plan__cta"
              disabled
            >
              当前方案
            </button>
            <button
              v-else-if="card.purchaseBlocked"
              type="button"
              class="pc-sub-plan__cta"
              disabled
            >
              不可重复购买
            </button>
            <template v-else>
              <button
                v-for="method in onlineCheckoutProviderOptions"
                :key="method.id"
                type="button"
                class="pc-sub-plan__cta"
                :class="{
                  'pc-sub-plan__cta--ghost': method.id !== 'alipay',
                  'pc-sub-plan__cta--alipay': method.id === 'alipay',
                  'is-unconfigured': !method.configured,
                }"
                :disabled="checkoutLoading === card.key || !method.configured"
                :title="method.configured ? method.label : `${method.label}（未配置）`"
                @click="purchasePlan(card.plan, { provider: method.id })"
              >
                {{ checkoutLoading === card.key ? '处理中…' : method.label }}
              </button>
              <button
                v-if="checkoutOptions.testCheckoutEnabled && !hasOnlineCheckout"
                type="button"
                class="pc-sub-plan__cta"
                :disabled="checkoutLoading === card.key"
                @click="purchasePlan(card.plan, { provider: 'manual' })"
              >
                {{ checkoutLoading === card.key ? '处理中…' : '测试订阅' }}
              </button>
              <button
                v-if="checkoutOptions.walletEnabled"
                type="button"
                class="pc-sub-plan__cta pc-sub-plan__cta--ghost"
                :disabled="
                  checkoutLoading === card.key || !canPayPlanWithWallet(card.plan)
                "
                :title="
                  canPayPlanWithWallet(card.plan)
                    ? '使用账户余额支付'
                    : '余额还差一点，先去充值吧'
                "
                @click="purchasePlan(card.plan, { provider: 'wallet' })"
              >
                余额支付
              </button>
            </template>
            <p
              v-if="card.purchaseHint && !card.isCurrent"
              class="pc-sub-plan__purchase-hint"
            >
              {{ card.purchaseHint }}
            </p>
          </div>
        </article>
      </div>
    </div>

    <div
      v-else-if="planConsoleTab === 'orders'"
      key="orders"
      class="pc-sub-plans__panel"
    >
      <div v-if="!authStore.isAuthenticated" class="pc-sub-plans__empty">
        <i class="bi bi-lock"></i>
        <strong>登录后查看订单</strong>
        <p>套餐购买与支付记录需登录后查看。</p>
        <RouterLink
          class="pc-btn pc-btn--primary"
          :to="{
            name: 'auth',
            query: { mode: 'login', redirect: '/pricing?section=plans' },
          }"
        >
          去登录
        </RouterLink>
      </div>
      <article v-else class="pc-sub-plans__orders">
        <header class="pc-dash-panel__head">
          <h2>订单记录</h2>
        </header>
        <div v-if="!subscriptionOrderRows.length" class="pc-sub-plans__empty">
          <i class="bi bi-receipt"></i>
          <strong>暂无订阅订单</strong>
          <p>购买套餐后，订阅订单会显示在这里。</p>
          <button
            type="button"
            class="pc-btn pc-btn--primary"
            @click="selectPlanConsoleTab('catalog')"
          >
            去选购套餐
          </button>
        </div>
        <div v-else class="pc-dash-table-wrap">
          <table class="pc-dash-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>支付方式</th>
                <th>套餐</th>
                <th>状态</th>
                <th class="pc-cell-right">金额</th>
                <th>创建时间</th>
                <th>支付时间</th>
                <th>开始时间</th>
                <th>到期时间</th>
                <th class="pc-cell-center">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in subscriptionOrderRows" :key="row.order.id">
                <td class="pc-dash-table__model pc-dash-table__order-id">
                  <strong>{{ row.display.id }}</strong>
                </td>
                <td>{{ row.display.providerLabel }}</td>
                <td class="pc-dash-table__model">
                  <strong>{{ row.display.planName }}</strong>
                  <small v-if="row.display.planSubtitle">{{
                    row.display.planSubtitle
                  }}</small>
                  <small v-if="row.display.payAmountLabel"
                    >支付宝 {{ row.display.payAmountLabel }}</small
                  >
                </td>
                <td>
                  <span class="pc-dash-pill" :class="statusClass(row.order.status)">
                    {{ row.display.statusLabel }}
                  </span>
                </td>
                <td class="pc-cell-right pc-num pc-dash-table__price">
                  {{ row.display.amountLabel }}
                </td>
                <td class="pc-num pc-dash-table__time">
                  {{ row.display.createdAtLabel }}
                </td>
                <td class="pc-num pc-dash-table__time">
                  {{ row.display.paidAtLabel }}
                </td>
                <td class="pc-num pc-dash-table__time">
                  {{ row.display.startsAtLabel }}
                </td>
                <td class="pc-num pc-dash-table__time">
                  {{ row.display.endsAtLabel }}
                </td>
                <td class="pc-cell-center">
                  <button
                    v-if="
                      row.display.isPayable && row.order.checkoutProvider === 'alipay'
                    "
                    type="button"
                    class="pc-btn pc-btn--ghost pc-btn--compact"
                    :disabled="Boolean(checkoutLoading)"
                    @click="openCheckoutOrderStatus(row.order)"
                  >
                    继续支付
                  </button>
                  <span v-else class="pc-cell-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </Transition>
</section>
</template>
