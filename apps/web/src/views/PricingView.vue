<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { getWallet, listWalletLedger } from '@/services/meApi'
import { getTaskPricing } from '@/services/metaApi'
import { createOrder, formatCents, getOrder, listOrders, listPlans } from '@/services/billingApi'
import { TASK_TYPE_LABELS } from '@/services/tasksApi'
import notificationService from '@/services/notification'

const router = useRouter()
const authStore = useAuthStore()

// ---- 钱包 & 单价 ----
const wallet = ref(null)
const walletLoading = ref(false)
const pricing = ref(null)

// ---- 套餐 & 下单 ----
const plans = ref([])
const plansLoading = ref(true)
const purchasingPlanId = ref('')
const activeOrder = ref(null)
let orderPollTimer = null

// ---- 我的订单 ----
const orders = ref([])
const ordersLoading = ref(false)
const ordersCursor = ref(null)

// ---- 钱包账本 ----
const ledger = ref([])
const ledgerLoading = ref(false)
const ledgerCursor = ref(null)

const isAuthenticated = computed(() => authStore.isAuthenticated)
const availableCents = computed(() =>
  Math.max(0, Number(wallet.value?.balanceCents || 0) - Number(wallet.value?.frozenCents || 0)),
)

const taskPriceRows = computed(() => {
  const prices = pricing.value?.taskPrices || {}
  return Object.entries(TASK_TYPE_LABELS).map(([type, label]) => ({
    type,
    label,
    priceCents: Number(prices[type] ?? 0),
  }))
})

const ORDER_STATUS_LABELS = {
  pending: '等待支付',
  paid: '已支付',
  completed: '已完成',
  failed: '失败',
  expired: '已过期',
}

const LEDGER_KIND_LABELS = {
  order_grant: '套餐入账',
  task_freeze: '任务冻结',
  task_settle: '任务结算',
  task_release: '任务解冻',
  admin_adjust: '人工调整',
  free_daily: '每日赠送',
}

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '未知'
}

function ledgerKindLabel(kind) {
  return LEDGER_KIND_LABELS[kind] || kind || '变动'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function goLogin() {
  router.push({
    name: 'auth',
    query: { ...createLoginRedirectQuery('/pricing'), mode: 'login' },
  })
}

async function refreshWallet() {
  if (!isAuthenticated.value) return
  walletLoading.value = true
  try {
    wallet.value = await getWallet()
  } catch {
    /* 钱包读取失败时保持旧值 */
  } finally {
    walletLoading.value = false
  }
}

async function loadOrders({ append = false } = {}) {
  if (!isAuthenticated.value || ordersLoading.value) return
  ordersLoading.value = true
  try {
    const { items, nextCursor } = await listOrders({
      limit: 10,
      cursor: append ? ordersCursor.value || '' : '',
    })
    orders.value = append ? [...orders.value, ...items] : items
    ordersCursor.value = nextCursor
  } catch {
    /* 静默失败 */
  } finally {
    ordersLoading.value = false
  }
}

async function loadLedger({ append = false } = {}) {
  if (!isAuthenticated.value || ledgerLoading.value) return
  ledgerLoading.value = true
  try {
    const { items, nextCursor } = await listWalletLedger({
      limit: 10,
      cursor: append ? ledgerCursor.value || '' : '',
    })
    ledger.value = append ? [...ledger.value, ...items] : items
    ledgerCursor.value = nextCursor
  } catch {
    /* 静默失败 */
  } finally {
    ledgerLoading.value = false
  }
}

function stopOrderPolling() {
  if (orderPollTimer) {
    clearInterval(orderPollTimer)
    orderPollTimer = null
  }
}

function startOrderPolling(orderId) {
  stopOrderPolling()
  orderPollTimer = setInterval(async () => {
    try {
      const order = await getOrder(orderId)
      activeOrder.value = order
      if (['completed', 'failed', 'expired'].includes(order?.status)) {
        stopOrderPolling()
        if (order.status === 'completed') {
          notificationService.success('订单已完成，余额已入账')
          await Promise.all([refreshWallet(), loadOrders(), loadLedger()])
        }
      }
    } catch {
      /* 下一轮重试 */
    }
  }, 3000)
}

async function purchase(plan) {
  if (!isAuthenticated.value) {
    goLogin()
    return
  }
  if (purchasingPlanId.value) return
  purchasingPlanId.value = plan.id
  try {
    const order = await createOrder(plan.id)
    activeOrder.value = { ...order, planName: plan.name }
    if (order?.payUrl) {
      window.open(order.payUrl, '_blank', 'noopener')
    }
    startOrderPolling(order.id)
    void loadOrders()
  } catch (error) {
    notificationService.error(error?.message || '订单创建失败')
  } finally {
    purchasingPlanId.value = ''
  }
}

function dismissActiveOrder() {
  stopOrderPolling()
  activeOrder.value = null
}

onMounted(async () => {
  await authStore.initAuth().catch(() => null)
  void getTaskPricing()
    .then((data) => {
      pricing.value = data
    })
    .catch(() => null)
  void listPlans()
    .then((items) => {
      plans.value = items
    })
    .catch(() => null)
    .finally(() => {
      plansLoading.value = false
    })
  if (isAuthenticated.value) {
    void refreshWallet()
    void loadOrders()
    void loadLedger()
  }
})

onBeforeUnmount(() => stopOrderPolling())
</script>

<template>
  <div class="pricing-page">
    <header class="pricing-head">
      <h1>价格与套餐</h1>
      <p>按任务张数计费，充值套餐即时入账，余额永不过期。</p>
    </header>

    <!-- 顶部：钱包 + 单价表 -->
    <section class="pricing-top">
      <article class="wallet-card">
        <header>
          <span class="wallet-card-label"><i class="bi bi-wallet2"></i> 钱包余额</span>
          <button
            v-if="isAuthenticated"
            type="button"
            class="wallet-refresh"
            :disabled="walletLoading"
            @click="refreshWallet"
          >
            <i class="bi" :class="walletLoading ? 'bi-arrow-repeat spin' : 'bi-arrow-repeat'"></i>
          </button>
        </header>
        <template v-if="isAuthenticated">
          <strong class="wallet-balance">{{ formatCents(availableCents) }}</strong>
          <div class="wallet-meta">
            <span>总余额 {{ formatCents(wallet?.balanceCents || 0) }}</span>
            <span v-if="Number(wallet?.frozenCents || 0) > 0" class="is-frozen">
              冻结中 {{ formatCents(wallet?.frozenCents || 0) }}
            </span>
          </div>
        </template>
        <template v-else>
          <strong class="wallet-balance is-muted">登录后查看</strong>
          <button type="button" class="pricing-btn is-primary" @click="goLogin">登录 / 注册</button>
        </template>
      </article>

      <article class="price-table-card">
        <header>
          <span><i class="bi bi-tags"></i> 创作单价</span>
          <small v-if="Number(pricing?.freeDailyCents || 0) > 0">
            每日赠送 {{ formatCents(pricing.freeDailyCents) }}
          </small>
        </header>
        <ul class="price-table">
          <li v-for="row in taskPriceRows" :key="row.type">
            <span class="price-name">{{ row.label }}</span>
            <span class="price-value">{{ formatCents(row.priceCents) }} <small>/ 张</small></span>
          </li>
        </ul>
      </article>
    </section>

    <!-- 订单进行中提示 -->
    <section v-if="activeOrder" class="order-banner" :data-status="activeOrder.status">
      <div class="order-banner-body">
        <i class="bi" :class="activeOrder.status === 'completed' ? 'bi-check-circle-fill' : 'bi-hourglass-split'"></i>
        <div>
          <strong>
            {{ activeOrder.planName || '套餐订单' }} · {{ orderStatusLabel(activeOrder.status) }}
          </strong>
          <p v-if="activeOrder.status === 'pending'">
            订单已创建（{{ formatCents(activeOrder.amountCents) }}），等待支付接入/联系管理员开通，完成后自动入账。
          </p>
          <p v-else-if="activeOrder.status === 'completed'">余额已入账，可以开始创作了。</p>
          <p v-else>订单状态：{{ orderStatusLabel(activeOrder.status) }}</p>
        </div>
      </div>
      <button type="button" aria-label="关闭" @click="dismissActiveOrder"><i class="bi bi-x-lg"></i></button>
    </section>

    <!-- 中部：套餐 -->
    <section class="pricing-section">
      <header class="pricing-section-head">
        <h2>充值套餐</h2>
        <p>购买后按「入账 + 赠送」金额充入钱包。</p>
      </header>
      <div v-if="plansLoading" class="plan-grid">
        <div v-for="n in 3" :key="n" class="plan-card is-skeleton"></div>
      </div>
      <div v-else-if="plans.length" class="plan-grid">
        <article v-for="plan in plans" :key="plan.id" class="plan-card">
          <h3>{{ plan.name }}</h3>
          <strong class="plan-price">{{ formatCents(plan.priceCents) }}</strong>
          <p class="plan-grant">
            入账 {{ formatCents(plan.grantCents) }}
            <span v-if="Number(plan.bonusCents || 0) > 0" class="plan-bonus">
              + 赠送 {{ formatCents(plan.bonusCents) }}
            </span>
          </p>
          <ul v-if="plan.features?.length" class="plan-features">
            <li v-for="(feature, index) in plan.features" :key="index">
              <i class="bi bi-check2"></i>{{ feature }}
            </li>
          </ul>
          <button
            type="button"
            class="pricing-btn is-primary"
            :disabled="purchasingPlanId === plan.id"
            @click="purchase(plan)"
          >
            {{ purchasingPlanId === plan.id ? '创建订单中…' : '立即购买' }}
          </button>
        </article>
      </div>
      <p v-else class="pricing-empty">暂无上架套餐，请稍后再来。</p>
    </section>

    <!-- 下部：订单 + 账本 -->
    <section v-if="isAuthenticated" class="pricing-bottom">
      <article class="record-card">
        <header><h2>我的订单</h2></header>
        <ul v-if="orders.length" class="record-list">
          <li v-for="order in orders" :key="order.id">
            <div class="record-main">
              <strong>{{ formatCents(order.amountCents) }}</strong>
              <span class="record-status" :data-status="order.status">{{ orderStatusLabel(order.status) }}</span>
            </div>
            <small>{{ formatTime(order.createdAt) }}</small>
          </li>
        </ul>
        <p v-else-if="!ordersLoading" class="pricing-empty">还没有订单记录。</p>
        <button
          v-if="ordersCursor"
          type="button"
          class="pricing-btn is-ghost"
          :disabled="ordersLoading"
          @click="loadOrders({ append: true })"
        >
          {{ ordersLoading ? '加载中…' : '加载更多' }}
        </button>
      </article>

      <article class="record-card">
        <header><h2>钱包账本</h2></header>
        <ul v-if="ledger.length" class="record-list">
          <li v-for="entry in ledger" :key="entry.id">
            <div class="record-main">
              <span>{{ ledgerKindLabel(entry.kind) }}</span>
              <strong :class="Number(entry.deltaCents) >= 0 ? 'is-income' : 'is-spend'">
                {{ Number(entry.deltaCents) >= 0 ? '+' : '' }}{{ formatCents(entry.deltaCents) }}
              </strong>
            </div>
            <small>
              {{ formatTime(entry.createdAt) }} · 余额 {{ formatCents(entry.balanceAfterCents) }}
              <template v-if="entry.reason"> · {{ entry.reason }}</template>
            </small>
          </li>
        </ul>
        <p v-else-if="!ledgerLoading" class="pricing-empty">暂无余额变动记录。</p>
        <button
          v-if="ledgerCursor"
          type="button"
          class="pricing-btn is-ghost"
          :disabled="ledgerLoading"
          @click="loadLedger({ append: true })"
        >
          {{ ledgerLoading ? '加载中…' : '加载更多' }}
        </button>
      </article>
    </section>
  </div>
</template>

<style scoped>
.pricing-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(24px, 5vh, 48px) clamp(16px, 3vw, 32px) 80px;
  color: var(--text-color, #f0f0f0);
}

.pricing-head h1 { margin: 0 0 6px; font-size: clamp(26px, 4vw, 34px); }
.pricing-head p { margin: 0; color: rgba(226, 232, 240, 0.6); }

.pricing-top {
  display: grid;
  grid-template-columns: minmax(260px, 380px) 1fr;
  gap: 18px;
  margin-top: 28px;
}

@media (max-width: 760px) {
  .pricing-top { grid-template-columns: 1fr; }
}

.wallet-card,
.price-table-card,
.plan-card,
.record-card {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(99, 102, 241, 0.06), rgba(15, 23, 42, 0.55) 60%);
  padding: 20px;
}

.wallet-card > header,
.price-table-card > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  color: rgba(226, 232, 240, 0.72);
  font-size: 14px;
}

.wallet-card i { margin-right: 6px; }

.wallet-refresh {
  border: none;
  background: transparent;
  color: rgba(165, 180, 252, 0.9);
  cursor: pointer;
  font-size: 15px;
}

.wallet-balance {
  display: block;
  font-size: clamp(30px, 4vw, 40px);
  font-weight: 700;
  background: linear-gradient(120deg, #e0e7ff, #67e8f9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.wallet-balance.is-muted { font-size: 22px; margin-bottom: 12px; }

.wallet-meta {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 13px;
  color: rgba(203, 213, 225, 0.62);
}

.wallet-meta .is-frozen { color: #fbbf24; }

.price-table { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 22px; }

@media (max-width: 560px) {
  .price-table { grid-template-columns: 1fr; }
}

.price-table li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.14);
  font-size: 14px;
}

.price-name { color: rgba(226, 232, 240, 0.78); }
.price-value { font-weight: 600; color: #a5b4fc; }
.price-value small { color: rgba(203, 213, 225, 0.5); font-weight: 400; }

.order-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-top: 22px;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid rgba(251, 191, 36, 0.3);
  background: rgba(251, 191, 36, 0.08);
}

.order-banner[data-status='completed'] {
  border-color: rgba(52, 211, 153, 0.34);
  background: rgba(52, 211, 153, 0.08);
}

.order-banner-body { display: flex; gap: 12px; }
.order-banner-body i { font-size: 20px; color: #fbbf24; margin-top: 2px; }
.order-banner[data-status='completed'] .order-banner-body i { color: #34d399; }
.order-banner-body strong { font-size: 15px; }
.order-banner-body p { margin: 4px 0 0; font-size: 13px; color: rgba(226, 232, 240, 0.68); }
.order-banner > button { border: none; background: transparent; color: rgba(226, 232, 240, 0.55); cursor: pointer; }

.pricing-section { margin-top: 40px; }
.pricing-section-head h2 { margin: 0 0 4px; font-size: 22px; }
.pricing-section-head p { margin: 0 0 18px; font-size: 13.5px; color: rgba(226, 232, 240, 0.55); }

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

.plan-card { display: flex; flex-direction: column; gap: 8px; }
.plan-card.is-skeleton {
  min-height: 220px;
  background: linear-gradient(110deg, rgba(30, 41, 59, 0.6) 30%, rgba(51, 65, 85, 0.6) 50%, rgba(30, 41, 59, 0.6) 70%);
  background-size: 200% 100%;
  animation: pricing-skeleton 1.4s ease infinite;
}

@keyframes pricing-skeleton { to { background-position: -200% 0; } }

.plan-card h3 { margin: 0; font-size: 17px; }
.plan-price { font-size: 30px; font-weight: 700; color: #e0e7ff; }
.plan-grant { margin: 0; font-size: 13.5px; color: rgba(203, 213, 225, 0.66); }
.plan-bonus { color: #34d399; }

.plan-features { list-style: none; margin: 4px 0 8px; padding: 0; flex: 1; display: grid; gap: 6px; }
.plan-features li { font-size: 13px; color: rgba(226, 232, 240, 0.68); }
.plan-features i { color: #67e8f9; margin-right: 6px; }

.pricing-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.pricing-btn.is-primary {
  border: none;
  color: #0b1020;
  background: linear-gradient(120deg, #a5b4fc, #67e8f9);
}

.pricing-btn.is-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(103, 232, 249, 0.2); }
.pricing-btn.is-primary:disabled { opacity: 0.55; cursor: not-allowed; }

.pricing-btn.is-ghost {
  margin-top: 12px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: transparent;
  color: rgba(226, 232, 240, 0.78);
}

.pricing-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 40px;
}

@media (max-width: 860px) {
  .pricing-bottom { grid-template-columns: 1fr; }
}

.record-card header h2 { margin: 0 0 14px; font-size: 18px; }

.record-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }

.record-list li {
  padding: 10px 0;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.13);
}

.record-main { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.record-list small { display: block; margin-top: 3px; font-size: 12px; color: rgba(203, 213, 225, 0.5); }

.record-status { font-size: 12.5px; padding: 2px 10px; border-radius: 999px; background: rgba(148, 163, 184, 0.14); }
.record-status[data-status='pending'] { color: #fbbf24; background: rgba(251, 191, 36, 0.12); }
.record-status[data-status='completed'] { color: #34d399; background: rgba(52, 211, 153, 0.12); }
.record-status[data-status='paid'] { color: #67e8f9; background: rgba(103, 232, 249, 0.12); }
.record-status[data-status='failed'],
.record-status[data-status='expired'] { color: #f87171; background: rgba(248, 113, 113, 0.12); }

.is-income { color: #34d399; }
.is-spend { color: #f87171; }

.pricing-empty { color: rgba(203, 213, 225, 0.5); font-size: 14px; }

.spin { animation: pricing-spin 0.9s linear infinite; }
@keyframes pricing-spin { to { transform: rotate(360deg); } }
</style>
