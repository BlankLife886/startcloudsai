<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { getMySubscription, getWallet } from '@/services/meApi'
import { getTaskPricing } from '@/services/metaApi'
import { createOrder, formatCents, getOrder, listPlans } from '@/services/billingApi'
import { TASK_TYPE_LABELS } from '@/services/tasksApi'
import notificationService from '@/services/notification'

const router = useRouter()
const authStore = useAuthStore()

// ---- 钱包快览 & 单价（订单/账本/兑换码在个人中心） ----
const wallet = ref(null)
const walletLoading = ref(false)
const pricing = ref(null)

// ---- 订阅现状（后端未上线时为 null，隐藏现状条） ----
const subscription = ref(null)

// ---- 套餐 & 下单 ----
const plans = ref([])
const plansLoading = ref(true)
const purchasingPlanId = ref('')
const activeOrder = ref(null)
let orderPollTimer = null

const isAuthenticated = computed(() => authStore.isAuthenticated)
const availableCents = computed(() =>
  Math.max(0, Number(wallet.value?.balanceCents || 0) - Number(wallet.value?.frozenCents || 0)),
)

/** 旧后端 plans 无 kind 字段时默认按 topup 处理。 */
function planKind(plan) {
  return plan?.kind === 'subscription' ? 'subscription' : 'topup'
}

const subscriptionPlans = computed(() =>
  plans.value.filter((plan) => planKind(plan) === 'subscription'),
)
const topupPlans = computed(() => plans.value.filter((plan) => planKind(plan) === 'topup'))

const hasActiveSubscription = computed(() => subscription.value?.active === true)

function subscriptionDailyLabel(plan) {
  const daily = Number(plan?.dailyGrantCents || 0)
  if (daily <= 0) return ''
  return `每天 ${formatCents(daily)} 额度`
}

function subscriptionTotalLabel(plan) {
  const daily = Number(plan?.dailyGrantCents || 0)
  const days = Number(plan?.durationDays || 0)
  if (daily <= 0 || days <= 0) return ''
  return `期内共 ${formatCents(daily * days)}`
}

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

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '未知'
}

function formatDay(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('zh-CN')
}

function goLogin() {
  router.push({
    name: 'auth',
    query: { ...createLoginRedirectQuery('/pricing'), mode: 'login' },
  })
}

function goProfile(tab) {
  router.push({ name: 'profile', query: tab ? { tab } : {} })
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

async function refreshSubscription() {
  if (!isAuthenticated.value) return
  try {
    subscription.value = await getMySubscription()
  } catch {
    /* 接口异常时静默：隐藏订阅现状条 */
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
      activeOrder.value = { ...activeOrder.value, ...order }
      if (['completed', 'failed', 'expired'].includes(order?.status)) {
        stopOrderPolling()
        if (order.status === 'completed') {
          notificationService.success('订单已完成，余额已入账')
          await Promise.all([refreshWallet(), refreshSubscription()])
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
    void refreshSubscription()
  }
})

onBeforeUnmount(() => stopOrderPolling())
</script>

<template>
  <div class="pr-page">
    <div class="pr-atmosphere" aria-hidden="true"></div>

    <!-- 页头：衬线大标题 + 钱包余额条 -->
    <header class="pr-masthead">
      <div class="pr-masthead__copy">
        <p class="pr-eyebrow">StarCloud Tariff <i></i> 馆内票务</p>
        <h1 class="pr-title">
          <span class="pr-seal" aria-hidden="true">藏</span>
          价格与套餐
        </h1>
        <p class="pr-lede">
          按任务张数计费，充值即时入账，余额永不过期。订阅期内每日自动发放创作额度。
        </p>
      </div>

      <aside class="pr-wallet" aria-label="钱包余额">
        <div class="pr-wallet__head">
          <span class="pr-wallet__label">Wallet · 可用余额</span>
          <button
            v-if="isAuthenticated"
            type="button"
            class="pr-wallet__refresh"
            aria-label="刷新余额"
            :disabled="walletLoading"
            @click="refreshWallet"
          >
            <i class="bi bi-arrow-repeat" :class="{ spin: walletLoading }"></i>
          </button>
        </div>
        <template v-if="isAuthenticated">
          <strong class="pr-wallet__amount">{{ formatCents(availableCents) }}</strong>
          <div class="pr-wallet__meta">
            <span>总余额 {{ formatCents(wallet?.balanceCents || 0) }}</span>
            <span v-if="Number(wallet?.frozenCents || 0) > 0" class="is-frozen">
              冻结中 {{ formatCents(wallet?.frozenCents || 0) }}
            </span>
          </div>
          <button type="button" class="pr-wallet__link" @click="goProfile('wallet')">
            个人中心 · 钱包与兑换码 →
          </button>
        </template>
        <template v-else>
          <strong class="pr-wallet__amount is-muted">登录后查看</strong>
          <button type="button" class="pr-btn is-primary" @click="goLogin">登录 / 注册</button>
        </template>
      </aside>
    </header>

    <!-- 订阅现状条 -->
    <section v-if="isAuthenticated && hasActiveSubscription" class="pr-substatus">
      <i class="bi bi-patch-check-fill" aria-hidden="true"></i>
      <div class="pr-substatus__body">
        <strong>{{ subscription.planName || '订阅会员' }}</strong>
        <span>有效期至 {{ formatDay(subscription.endsAt) }}</span>
        <span v-if="Number(subscription.dailyGrantCents || 0) > 0">
          每日发放 {{ formatCents(subscription.dailyGrantCents) }}
        </span>
        <em :class="{ 'is-done': subscription.grantedToday }">
          {{ subscription.grantedToday ? '今日已发放' : '今日待发放' }}
        </em>
      </div>
    </section>

    <!-- 下单后即时反馈，完整订单列表在个人中心 -->
    <section v-if="activeOrder" class="pr-order-banner" :data-status="activeOrder.status">
      <div class="pr-order-banner__body">
        <i
          class="bi"
          :class="activeOrder.status === 'completed' ? 'bi-check-circle-fill' : 'bi-hourglass-split'"
        ></i>
        <div>
          <strong>
            {{ activeOrder.planName || '套餐订单' }} · {{ orderStatusLabel(activeOrder.status) }}
          </strong>
          <p v-if="activeOrder.status === 'pending'">
            订单已创建（{{ formatCents(activeOrder.amountCents) }}），等待支付完成后自动入账。
            <button type="button" class="pr-inline-link" @click="goProfile('orders')">
              到个人中心查看订单 →
            </button>
          </p>
          <p v-else-if="activeOrder.status === 'completed'">
            余额已入账，可以开始创作了。
            <button type="button" class="pr-inline-link" @click="goProfile('wallet')">
              查看钱包 →
            </button>
          </p>
          <p v-else>
            订单状态：{{ orderStatusLabel(activeOrder.status) }}
            <button type="button" class="pr-inline-link" @click="goProfile('orders')">
              查看全部订单 →
            </button>
          </p>
        </div>
      </div>
      <button type="button" aria-label="关闭" @click="dismissActiveOrder">
        <i class="bi bi-x-lg"></i>
      </button>
    </section>

    <!-- 01 · 订阅 -->
    <section class="pr-hall">
      <header class="pr-hall__head">
        <div class="pr-hall__label">
          <em>01</em>
          <i></i>
          <span>Subscription</span>
        </div>
        <h2>订阅</h2>
        <p>订阅期内每天自动发放创作额度，北京时间每日入账，续购自动顺延。</p>
      </header>

      <div v-if="plansLoading" class="pr-plan-grid">
        <div v-for="n in 2" :key="n" class="pr-plan is-skeleton"></div>
      </div>
      <div v-else-if="subscriptionPlans.length" class="pr-plan-grid">
        <article v-for="plan in subscriptionPlans" :key="plan.id" class="pr-plan is-subscription">
          <div class="pr-plan__mark" aria-hidden="true">SUB</div>
          <h3 class="pr-plan__name">{{ plan.name }}</h3>
          <div class="pr-plan__price">
            <strong>{{ formatCents(plan.priceCents) }}</strong>
            <small v-if="Number(plan.durationDays || 0) > 0">/ {{ plan.durationDays }} 天</small>
          </div>
          <p v-if="subscriptionDailyLabel(plan)" class="pr-plan__daily">
            {{ subscriptionDailyLabel(plan) }}
            <span v-if="subscriptionTotalLabel(plan)">· {{ subscriptionTotalLabel(plan) }}</span>
          </p>
          <ul v-if="plan.features?.length" class="pr-plan__features">
            <li v-for="(feature, index) in plan.features" :key="index">{{ feature }}</li>
          </ul>
          <button
            type="button"
            class="pr-btn is-primary"
            :disabled="purchasingPlanId === plan.id"
            @click="purchase(plan)"
          >
            {{ purchasingPlanId === plan.id ? '创建订单中…' : hasActiveSubscription ? '续订' : '立即订阅' }}
          </button>
        </article>
      </div>
      <div v-else class="pr-coming">
        <span class="pr-coming__mono">Coming Soon</span>
        <strong>订阅套餐即将上线</strong>
        <p>每日自动发放创作额度的订阅方案正在筹备中，可先购买充值包。</p>
      </div>
    </section>

    <!-- 02 · 充值包 -->
    <section class="pr-hall">
      <header class="pr-hall__head">
        <div class="pr-hall__label">
          <em>02</em>
          <i></i>
          <span>Top-up</span>
        </div>
        <h2>充值包</h2>
        <p>一次性入账，按「入账 + 赠送」金额充入钱包，余额永不过期。</p>
      </header>

      <div v-if="plansLoading" class="pr-plan-grid">
        <div v-for="n in 2" :key="n" class="pr-plan is-skeleton"></div>
      </div>
      <div v-else-if="topupPlans.length" class="pr-plan-grid">
        <article v-for="plan in topupPlans" :key="plan.id" class="pr-plan">
          <h3 class="pr-plan__name">{{ plan.name }}</h3>
          <div class="pr-plan__price">
            <strong>{{ formatCents(plan.priceCents) }}</strong>
          </div>
          <p class="pr-plan__daily">
            入账 {{ formatCents(plan.grantCents) }}
            <span v-if="Number(plan.bonusCents || 0) > 0" class="is-bonus">
              + 赠送 {{ formatCents(plan.bonusCents) }}
            </span>
          </p>
          <ul v-if="plan.features?.length" class="pr-plan__features">
            <li v-for="(feature, index) in plan.features" :key="index">{{ feature }}</li>
          </ul>
          <button
            type="button"
            class="pr-btn is-primary"
            :disabled="purchasingPlanId === plan.id"
            @click="purchase(plan)"
          >
            {{ purchasingPlanId === plan.id ? '创建订单中…' : '立即购买' }}
          </button>
        </article>
      </div>
      <p v-else class="pr-empty">暂无上架套餐，请稍后再来。</p>
    </section>

    <!-- 03 · 创作单价 -->
    <section class="pr-hall">
      <header class="pr-hall__head">
        <div class="pr-hall__label">
          <em>03</em>
          <i></i>
          <span>Unit Price</span>
        </div>
        <h2>创作单价</h2>
        <p>
          各工作台按张计费，提交时按张数冻结、完成后结算。
          <template v-if="Number(pricing?.freeDailyCents || 0) > 0">
            每日赠送 {{ formatCents(pricing.freeDailyCents) }}。
          </template>
        </p>
      </header>

      <ul class="pr-price-table">
        <li v-for="row in taskPriceRows" :key="row.type">
          <span class="pr-price-table__name">{{ row.label }}</span>
          <i class="pr-price-table__rail" aria-hidden="true"></i>
          <span class="pr-price-table__value">
            {{ formatCents(row.priceCents) }} <small>/ 张</small>
          </span>
        </li>
      </ul>
    </section>

    <aside class="pr-help">
      <p>
        订单记录、钱包账本与兑换码已移至
        <button type="button" class="pr-inline-link" @click="goProfile('orders')">个人中心</button>
        ，购买完成后可在那里查看状态。
      </p>
    </aside>

    <footer class="pr-outro" aria-hidden="true">
      <span>StarCloudIsAI · Tariff Hall</span>
    </footer>
  </div>
</template>

<style scoped>
/* —— 价格页 · 深色美术馆语言 ——
   与首页/画廊同一套：衬线大字、mono 展签、hairline 分隔、金色点缀 */
.pr-page {
  --pr-bg: #0c0e16;
  --pr-ink: #eceaf2;
  --pr-muted: rgba(214, 218, 235, 0.58);
  --pr-faint: rgba(214, 218, 235, 0.34);
  --pr-line: rgba(226, 201, 143, 0.14);
  --pr-hairline: rgba(255, 255, 255, 0.08);
  --pr-gold: #e2c98f;
  --pr-gold-deep: #caa961;
  --pr-cyan: #8fd8d2;
  --pr-serif: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --pr-mono: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  max-width: 1180px;
  margin: 0 auto;
  padding: clamp(28px, 5vh, 56px) clamp(18px, 3.4vw, 40px) 72px;
  color: var(--pr-ink);
}

.pr-atmosphere {
  pointer-events: none;
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: min(64vh, 640px);
  background:
    radial-gradient(ellipse 46% 52% at 74% 12%, rgba(226, 201, 143, 0.07), transparent 70%),
    radial-gradient(ellipse 30% 38% at 12% 32%, rgba(143, 216, 210, 0.05), transparent 72%);
  mask-image: linear-gradient(180deg, #000 42%, transparent);
}

.pr-page > * {
  position: relative;
  z-index: 1;
}

/* —— 页头 —— */
.pr-masthead {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: clamp(20px, 3vw, 44px);
  align-items: end;
  padding-bottom: clamp(24px, 4vh, 36px);
  border-bottom: 1px solid var(--pr-line);
}

.pr-eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
  color: var(--pr-gold);
  font-family: var(--pr-mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pr-eyebrow i {
  width: 42px;
  height: 1px;
  background: linear-gradient(90deg, rgba(226, 201, 143, 0.6), transparent);
}

.pr-title {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 0;
  font-family: var(--pr-serif);
  font-size: clamp(2.1rem, 5vw, 3.3rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.12;
}

.pr-seal {
  display: grid;
  place-items: center;
  width: clamp(44px, 5vw, 58px);
  aspect-ratio: 1;
  border: 1px solid rgba(226, 201, 143, 0.5);
  color: var(--pr-gold);
  font-size: clamp(1.2rem, 2.6vw, 1.7rem);
  font-weight: 700;
  letter-spacing: 0;
}

.pr-lede {
  margin: 14px 0 0;
  max-width: 30em;
  color: var(--pr-muted);
  font-size: 0.92rem;
  line-height: 1.8;
}

/* 钱包条 */
.pr-wallet {
  display: grid;
  gap: 8px;
  padding: 18px 20px;
  border: 1px solid var(--pr-hairline);
  border-left: 2px solid var(--pr-gold);
  background: linear-gradient(150deg, rgba(226, 201, 143, 0.05), rgba(255, 255, 255, 0.015) 55%);
}

.pr-wallet__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pr-wallet__label {
  color: var(--pr-faint);
  font-family: var(--pr-mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.pr-wallet__refresh {
  border: none;
  background: transparent;
  color: var(--pr-gold);
  font-size: 0.95rem;
  cursor: pointer;
}

.pr-wallet__refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.pr-wallet__amount {
  font-family: var(--pr-serif);
  font-size: clamp(1.9rem, 3.4vw, 2.5rem);
  font-weight: 700;
  color: var(--pr-gold);
  font-variant-numeric: tabular-nums;
}

.pr-wallet__amount.is-muted {
  color: var(--pr-muted);
  font-size: 1.25rem;
}

.pr-wallet__meta {
  display: flex;
  gap: 14px;
  font-size: 0.78rem;
  color: var(--pr-muted);
}

.pr-wallet__meta .is-frozen {
  color: #f0b453;
}

.pr-wallet__link {
  margin-top: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--pr-cyan);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-align: left;
  cursor: pointer;
}

.pr-wallet__link:hover {
  color: var(--pr-gold);
}

.pr-inline-link {
  display: inline;
  margin-left: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--pr-cyan);
  font-size: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
}

.pr-inline-link:hover {
  color: var(--pr-gold);
}

/* —— 订阅现状条 —— */
.pr-substatus {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 18px;
  padding: 12px 18px;
  border: 1px solid rgba(143, 216, 210, 0.24);
  background: rgba(143, 216, 210, 0.05);
}

.pr-substatus > i {
  color: var(--pr-cyan);
  font-size: 1.05rem;
}

.pr-substatus__body {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 16px;
  font-size: 0.84rem;
  color: var(--pr-muted);
}

.pr-substatus__body strong {
  color: var(--pr-ink);
  font-family: var(--pr-serif);
  font-size: 0.98rem;
  letter-spacing: 0.04em;
}

.pr-substatus__body em {
  font-style: normal;
  font-family: var(--pr-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: #f0b453;
}

.pr-substatus__body em.is-done {
  color: var(--pr-cyan);
}

/* —— 订单横幅 —— */
.pr-order-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-top: 18px;
  padding: 15px 18px;
  border: 1px solid rgba(240, 180, 83, 0.32);
  background: rgba(240, 180, 83, 0.06);
}

.pr-order-banner[data-status='completed'] {
  border-color: rgba(143, 216, 210, 0.34);
  background: rgba(143, 216, 210, 0.06);
}

.pr-order-banner__body {
  display: flex;
  gap: 12px;
}

.pr-order-banner__body i {
  margin-top: 2px;
  font-size: 1.1rem;
  color: #f0b453;
}

.pr-order-banner[data-status='completed'] .pr-order-banner__body i {
  color: var(--pr-cyan);
}

.pr-order-banner__body strong {
  font-size: 0.92rem;
}

.pr-order-banner__body p {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--pr-muted);
}

.pr-order-banner > button {
  border: none;
  background: transparent;
  color: var(--pr-faint);
  cursor: pointer;
}

/* —— 展厅分区 —— */
.pr-hall {
  margin-top: clamp(40px, 7vh, 60px);
}

.pr-hall__head {
  margin-bottom: 22px;
}

.pr-hall__label {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.pr-hall__label em {
  font-style: normal;
  color: var(--pr-gold);
  font-family: var(--pr-serif);
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pr-hall__label i {
  width: 52px;
  height: 1px;
  background: var(--pr-line);
}

.pr-hall__label span {
  color: var(--pr-faint);
  font-family: var(--pr-mono);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pr-hall__head h2 {
  margin: 0;
  font-family: var(--pr-serif);
  font-size: clamp(1.35rem, 2.6vw, 1.75rem);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.pr-hall__head p {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--pr-muted);
  line-height: 1.7;
}

/* —— 套餐卡 —— */
.pr-plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(258px, 1fr));
  gap: 16px;
}

.pr-plan {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px 22px;
  border: 1px solid var(--pr-hairline);
  background: rgba(255, 255, 255, 0.014);
  transition:
    border-color 0.25s ease,
    transform 0.25s ease;
}

.pr-plan:hover {
  border-color: rgba(226, 201, 143, 0.4);
  transform: translateY(-2px);
}

.pr-plan.is-subscription {
  border-color: rgba(226, 201, 143, 0.24);
  background: linear-gradient(160deg, rgba(226, 201, 143, 0.045), rgba(255, 255, 255, 0.012) 58%);
}

.pr-plan__mark {
  position: absolute;
  top: 16px;
  right: 18px;
  color: rgba(226, 201, 143, 0.4);
  font-family: var(--pr-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.24em;
}

.pr-plan.is-skeleton {
  min-height: 230px;
  border: 1px solid var(--pr-hairline);
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.02) 30%,
    rgba(255, 255, 255, 0.05) 50%,
    rgba(255, 255, 255, 0.02) 70%
  );
  background-size: 200% 100%;
  animation: pr-skeleton 1.4s ease infinite;
}

@keyframes pr-skeleton {
  to {
    background-position: -200% 0;
  }
}

.pr-plan__name {
  margin: 0;
  font-family: var(--pr-serif);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.pr-plan__price {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pr-plan__price strong {
  font-family: var(--pr-serif);
  font-size: 2rem;
  font-weight: 700;
  color: var(--pr-gold);
  font-variant-numeric: tabular-nums;
}

.pr-plan__price small {
  color: var(--pr-faint);
  font-size: 0.8rem;
}

.pr-plan__daily {
  margin: 0;
  font-size: 0.82rem;
  color: var(--pr-muted);
}

.pr-plan__daily .is-bonus {
  color: var(--pr-cyan);
}

.pr-plan__features {
  list-style: none;
  margin: 4px 0 10px;
  padding: 0;
  flex: 1;
  display: grid;
  gap: 7px;
}

.pr-plan__features li {
  position: relative;
  padding-left: 16px;
  font-size: 0.8rem;
  color: var(--pr-muted);
  line-height: 1.55;
}

.pr-plan__features li::before {
  content: '';
  position: absolute;
  top: 0.55em;
  left: 2px;
  width: 5px;
  height: 5px;
  transform: rotate(45deg);
  background: rgba(226, 201, 143, 0.55);
}

/* —— 即将上线 —— */
.pr-coming {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 30px 26px;
  border: 1px dashed rgba(226, 201, 143, 0.26);
  background: rgba(226, 201, 143, 0.02);
}

.pr-coming__mono {
  color: var(--pr-gold);
  font-family: var(--pr-mono);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.26em;
  text-transform: uppercase;
}

.pr-coming strong {
  font-family: var(--pr-serif);
  font-size: 1.15rem;
  letter-spacing: 0.06em;
}

.pr-coming p {
  margin: 0;
  font-size: 0.83rem;
  color: var(--pr-muted);
}

/* —— 单价表 —— */
.pr-price-table {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 0 40px;
  border-top: 1px solid var(--pr-hairline);
}

.pr-price-table li {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid var(--pr-hairline);
}

.pr-price-table__name {
  font-size: 0.88rem;
  color: var(--pr-ink);
  letter-spacing: 0.04em;
}

.pr-price-table__rail {
  flex: 1;
  border-bottom: 1px dotted rgba(255, 255, 255, 0.14);
}

.pr-price-table__value {
  font-family: var(--pr-serif);
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--pr-gold);
  font-variant-numeric: tabular-nums;
}

.pr-price-table__value small {
  color: var(--pr-faint);
  font-family: var(--pr-mono);
  font-size: 0.66rem;
  font-weight: 400;
}

.pr-help {
  margin-top: clamp(36px, 6vh, 52px);
  padding: 16px 18px;
  border: 1px solid var(--pr-hairline);
  background: rgba(255, 255, 255, 0.012);
}

.pr-help p {
  margin: 0;
  color: var(--pr-muted);
  font-size: 0.84rem;
  line-height: 1.7;
}

/* —— 按钮 —— */
.pr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: 0;
  font-size: 0.86rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.pr-btn.is-primary {
  border: 1px solid var(--pr-gold);
  background: var(--pr-gold);
  color: #16130a;
}

.pr-btn.is-primary:hover:not(:disabled) {
  background: transparent;
  color: var(--pr-gold);
}

.pr-btn.is-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pr-btn.is-ghost {
  border: 1px solid var(--pr-hairline);
  background: transparent;
  color: var(--pr-muted);
}

.pr-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(226, 201, 143, 0.4);
  color: var(--pr-gold);
}

/* —— 尾注 —— */
.pr-outro {
  margin-top: clamp(46px, 8vh, 68px);
  padding-top: 18px;
  border-top: 1px solid var(--pr-line);
  color: var(--pr-faint);
  font-family: var(--pr-mono);
  font-size: 0.64rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  text-align: center;
}

.pr-empty {
  margin: 0;
  padding: 12px 0;
  color: var(--pr-faint);
  font-size: 0.84rem;
}

.spin {
  animation: pr-spin 0.9s linear infinite;
}

@keyframes pr-spin {
  to {
    transform: rotate(360deg);
  }
}

/* —— 响应式 —— */
@media (max-width: 860px) {
  .pr-masthead {
    grid-template-columns: 1fr;
    align-items: start;
  }
}

@media (max-width: 560px) {
  .pr-price-table {
    grid-template-columns: 1fr;
  }
}
</style>
