<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listPlans, formatCents } from '@/services/billingApi'
import { getTaskPricing } from '@/services/metaApi'
import { getWallet } from '@/services/meApi'
import { TASK_TYPE_LABELS } from '@/services/tasksApi'

const router = useRouter()
const authStore = useAuthStore()

const plans = ref([])
const plansLoading = ref(true)
const plansLoadFailed = ref(false)
const pricing = ref(null)
const wallet = ref(null)
const section = ref('plans')

// 支付通道尚未接入。即使后端将来增加支付能力，也必须完成前端收银台接入后再显式改为 true。
const PAYMENT_UI_ENABLED = false

const previewPlans = [
  {
    id: 'preview-usage',
    name: '按量创作',
    eyebrow: 'Flexible',
    description: '无需固定套餐，按照不同工作台的实际任务单价消耗钱包额度。',
    priceMode: 'unit',
    suffix: '/ 张起',
    features: [
      '全部 AI 创作工作台',
      '按任务冻结与结算额度',
      '原图与 512px 缩略图分别保存',
      '适合轻量体验与偶尔创作',
    ],
    preview: true,
  },
  {
    id: 'preview-creator',
    name: '创作者计划',
    eyebrow: 'Creator',
    description: '为持续创作准备的月度方案，正式价格与每日额度将在支付接入后公布。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: [
      '计划包含月度创作额度',
      '每日额度自动发放',
      '覆盖全部图像工作台',
      '优先体验后续创作能力',
    ],
    popular: true,
    preview: true,
  },
  {
    id: 'preview-pro',
    name: '专业制作',
    eyebrow: 'Professional',
    description: '面向高频制作与团队场景，套餐、发票和协作能力仍在规划中。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: ['更高的计划额度', '适合高频生产任务', '团队与商业能力预留', '支付接入后开放购买'],
    preview: true,
  },
]

const taskPriceRows = computed(() => {
  const values = pricing.value?.taskPrices || {}
  return Object.entries(TASK_TYPE_LABELS).map(([type, label]) => ({
    type,
    label,
    priceCents: Object.prototype.hasOwnProperty.call(values, type) ? Number(values[type]) : null,
  }))
})

const minimumTaskPrice = computed(() => {
  const values = taskPriceRows.value
    .map((item) => item.priceCents)
    .filter((value) => value !== null && Number.isFinite(value) && value > 0)
  return values.length ? Math.min(...values) : 0
})

const displayPlans = computed(() => {
  if (!plans.value.length) return previewPlans
  return plans.value.map((plan, index) => ({
    ...plan,
    eyebrow: plan.kind === 'subscription' ? 'Subscription' : 'Top-up',
    description:
      plan.kind === 'subscription'
        ? '订阅期内按计划发放创作额度。支付接入前仅展示方案信息。'
        : '一次性额度包，支付接入前仅展示方案信息。',
    popular: index === 1,
    preview: false,
  }))
})

const availableCents = computed(() =>
  Math.max(0, Number(wallet.value?.balanceCents || 0) - Number(wallet.value?.frozenCents || 0)),
)

const paymentMethods = [
  { name: '支付宝', icon: 'bi-alipay', note: '尚未接入' },
  { name: '微信支付', icon: 'bi-wechat', note: '尚未接入' },
  { name: '银行卡', icon: 'bi-credit-card-2-front', note: '尚未接入' },
]

const faqs = [
  {
    question: '现在可以购买套餐吗？',
    answer:
      '暂时不可以。价格与套餐页面已经恢复，但支付通道尚未接入，所有购买按钮都处于禁用状态，不会创建订单或发生扣款。',
  },
  {
    question: '当前创作如何计费？',
    answer:
      '任务提交时按张数冻结钱包额度，任务成功后结算；失败或取消时释放对应冻结额度。各工作台的当前单价可在本页下方查看。',
  },
  {
    question: '为什么套餐显示“待公布”？',
    answer:
      '数据库尚未配置正式上架套餐时，页面只展示方案预览，不会虚构金额。配置正式套餐后，本页会自动显示对应价格和权益。',
  },
  {
    question: '将来会支持哪些支付方式？',
    answer:
      '页面已经为支付宝、微信支付和银行卡预留入口。最终开放方式以支付服务完成接入和安全审计后的实际上线结果为准。',
  },
  {
    question: '已有钱包额度会受影响吗？',
    answer:
      '不会。现有钱包余额、兑换码和任务扣费逻辑保持不变；恢复价格页不会启用任何新的自动扣费能力。',
  },
]

function planPrice(plan) {
  if (plan.priceMode === 'unit') {
    return minimumTaskPrice.value > 0 ? formatCents(minimumTaskPrice.value) : '按量计费'
  }
  if (plan.priceMode === 'coming') return '待公布'
  return formatCents(plan.priceCents)
}

function taskPriceLabel(priceCents) {
  if (priceCents === null || !Number.isFinite(priceCents)) return '暂不可用'
  return formatCents(priceCents)
}

function planSuffix(plan) {
  if (plan.suffix) return plan.suffix
  if (plan.kind === 'subscription') {
    return Number(plan.durationDays || 0) > 0 ? `/ ${plan.durationDays} 天` : '/ 订阅期'
  }
  return '一次性入账'
}

function planQuota(plan) {
  if (plan.preview) return ''
  if (plan.kind === 'subscription') {
    return Number(plan.dailyGrantCents || 0) > 0
      ? `每天发放 ${formatCents(plan.dailyGrantCents)} 创作额度`
      : ''
  }
  const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0)
  return total > 0 ? `共入账 ${formatCents(total)} 创作额度` : ''
}

function planFeatures(plan) {
  return Array.isArray(plan.features) && plan.features.length
    ? plan.features
    : ['套餐信息已配置', '支付接入后开放购买', '当前不会创建订单']
}

function scrollToSection(id) {
  section.value = id
  document.getElementById(`pricing-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goCreate() {
  router.push('/text-to-image')
}

onMounted(async () => {
  const [plansResult, pricingResult] = await Promise.allSettled([listPlans(), getTaskPricing()])
  if (plansResult.status === 'fulfilled') {
    plans.value = plansResult.value.items
  } else {
    plansLoadFailed.value = true
  }
  if (pricingResult.status === 'fulfilled') pricing.value = pricingResult.value
  plansLoading.value = false

  if (authStore.isAuthenticated) {
    wallet.value = await getWallet().catch(() => null)
  }
})
</script>

<template>
  <div class="pricing-page">
    <div class="pricing-glow" aria-hidden="true"></div>

    <main class="pricing-shell">
      <section class="pricing-hero" aria-labelledby="pricing-title">
        <div class="pricing-hero__copy">
          <p class="pricing-kicker">PLANS &amp; PRICING</p>
          <h1 id="pricing-title">选择适合你的<br /><span>创作方案</span></h1>
          <p class="pricing-hero__lede">
            从按量创作到未来的订阅计划，费用结构保持清晰。支付功能已预留，但在正式接入前不会创建订单或扣款。
          </p>

          <div class="pricing-switch" aria-label="页面分区">
            <button
              type="button"
              :class="{ active: section === 'plans' }"
              @click="scrollToSection('plans')"
            >
              套餐方案
            </button>
            <button
              type="button"
              :class="{ active: section === 'unit' }"
              @click="scrollToSection('unit')"
            >
              创作单价
            </button>
          </div>
        </div>

        <aside class="pricing-status" aria-label="支付接入状态">
          <div class="pricing-status__icon"><i class="bi bi-shield-lock"></i></div>
          <p>PAYMENT STATUS</p>
          <strong>支付暂未开放</strong>
          <span>开发、测试与生产环境均不会发起真实支付。</span>
          <div v-if="authStore.isAuthenticated" class="pricing-wallet">
            <small>当前可用额度</small>
            <b>{{ formatCents(availableCents) }}</b>
          </div>
        </aside>
      </section>

      <section id="pricing-plans" class="pricing-section pricing-plans">
        <header class="pricing-section__head">
          <div>
            <p>CHOOSE A PLAN</p>
            <h2>简单、透明的方案结构</h2>
          </div>
          <span class="pricing-disabled-note"><i class="bi bi-lock-fill"></i> 购买功能未启用</span>
        </header>

        <div v-if="plansLoading" class="pricing-plan-grid" aria-label="套餐加载中">
          <article
            v-for="item in 3"
            :key="item"
            class="pricing-plan pricing-plan--loading"
          ></article>
        </div>
        <div v-else class="pricing-plan-grid">
          <article
            v-for="plan in displayPlans"
            :key="plan.id"
            class="pricing-plan"
            :class="{ 'pricing-plan--popular': plan.popular }"
          >
            <span v-if="plan.popular" class="pricing-plan__popular">推荐方案</span>
            <p class="pricing-plan__eyebrow">{{ plan.eyebrow }}</p>
            <h3>{{ plan.name }}</h3>
            <p class="pricing-plan__description">{{ plan.description }}</p>

            <div class="pricing-plan__price">
              <strong>{{ planPrice(plan) }}</strong>
              <span>{{ planSuffix(plan) }}</span>
            </div>
            <p v-if="planQuota(plan)" class="pricing-plan__quota">{{ planQuota(plan) }}</p>

            <div class="pricing-plan__divider"></div>
            <p class="pricing-plan__includes">方案包含</p>
            <ul>
              <li v-for="feature in planFeatures(plan)" :key="feature">
                <i class="bi bi-check2"></i>
                <span>{{ feature }}</span>
              </li>
            </ul>

            <button
              type="button"
              class="pricing-plan__button"
              :disabled="!PAYMENT_UI_ENABLED"
              title="支付通道尚未接入"
            >
              <i class="bi bi-lock-fill"></i>
              支付暂未开放
            </button>
          </article>
        </div>

        <p v-if="plansLoadFailed" class="pricing-data-note">
          套餐服务暂时不可用，当前显示的是预览方案；创作单价仍以服务端实际返回为准。
        </p>
      </section>

      <section id="pricing-unit" class="pricing-section pricing-unit">
        <header class="pricing-section__head">
          <div>
            <p>UNIT PRICING</p>
            <h2>每一次创作都清楚计价</h2>
          </div>
          <span>提交时冻结，成功后结算</span>
        </header>

        <div class="pricing-unit-grid">
          <article v-for="row in taskPriceRows" :key="row.type">
            <span class="pricing-unit__icon"><i class="bi bi-stars"></i></span>
            <div>
              <small>{{ row.type.toUpperCase() }}</small>
              <strong>{{ row.label }}</strong>
            </div>
            <p>
              {{ taskPriceLabel(row.priceCents) }} <span v-if="row.priceCents !== null">/ 张</span>
            </p>
          </article>
        </div>
      </section>

      <section class="pricing-section pricing-payment" aria-labelledby="payment-title">
        <div class="pricing-payment__copy">
          <p>PAYMENT METHODS</p>
          <h2 id="payment-title">支付位置已经预留</h2>
          <span>通道接入和安全审计完成前，下面所有方式均保持禁用。</span>
        </div>
        <div class="pricing-payment__methods">
          <article v-for="method in paymentMethods" :key="method.name" aria-disabled="true">
            <i class="bi" :class="method.icon"></i>
            <div>
              <strong>{{ method.name }}</strong>
              <small>{{ method.note }}</small>
            </div>
            <i class="bi bi-lock-fill"></i>
          </article>
        </div>
      </section>

      <section class="pricing-section pricing-faq">
        <header class="pricing-section__head">
          <div>
            <p>FREQUENTLY ASKED QUESTIONS</p>
            <h2>常见问题</h2>
          </div>
        </header>

        <div class="pricing-faq__list">
          <details v-for="(item, index) in faqs" :key="item.question" :open="index === 0">
            <summary>
              <span>{{ item.question }}</span>
              <i class="bi bi-plus-lg"></i>
            </summary>
            <p>{{ item.answer }}</p>
          </details>
        </div>
      </section>

      <section class="pricing-cta">
        <div>
          <p>READY TO CREATE?</p>
          <h2>无需等待支付，也可以继续使用现有额度创作。</h2>
        </div>
        <button type="button" @click="goCreate">开始创作 <i class="bi bi-arrow-right"></i></button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.pricing-page {
  --price-bg: #191b28;
  --price-panel: #353845;
  --price-panel-deep: #2b2e3a;
  --price-ink: #f8f8fb;
  --price-muted: #a9acb9;
  --price-faint: #737786;
  --price-line: rgba(255, 255, 255, 0.1);
  --price-accent: #745cff;
  --price-accent-2: #a895ff;
  --price-warn: #ff9c8d;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  color: var(--price-ink);
  background: var(--price-bg);
}

.pricing-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 84% 4%, rgba(116, 92, 255, 0.17), transparent 28rem),
    radial-gradient(circle at 8% 28%, rgba(99, 208, 255, 0.07), transparent 24rem);
}

.pricing-shell {
  position: relative;
  width: min(1240px, calc(100% - 40px));
  margin: 0 auto;
  padding: clamp(62px, 8vw, 112px) 0 80px;
}

.pricing-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
  gap: clamp(36px, 8vw, 110px);
  align-items: end;
}

.pricing-kicker,
.pricing-section__head p,
.pricing-payment__copy > p,
.pricing-cta p,
.pricing-plan__eyebrow {
  margin: 0;
  color: var(--price-faint);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.2em;
}

.pricing-hero h1 {
  margin: 18px 0 0;
  max-width: 760px;
  font-size: clamp(3.2rem, 7vw, 6.4rem);
  font-weight: 400;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.pricing-hero h1 span {
  color: var(--price-accent-2);
}

.pricing-hero__lede {
  max-width: 650px;
  margin: 28px 0 0;
  color: var(--price-muted);
  font-size: clamp(1rem, 1.6vw, 1.16rem);
  line-height: 1.85;
}

.pricing-switch {
  width: fit-content;
  display: flex;
  margin-top: 34px;
  padding: 4px;
  border: 1px solid var(--price-line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.025);
}

.pricing-switch button {
  min-width: 118px;
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  color: var(--price-muted);
  background: transparent;
  cursor: pointer;
}

.pricing-switch button.active {
  color: white;
  background: #333644;
}

.pricing-status {
  padding: 28px;
  border: 1px solid rgba(116, 92, 255, 0.35);
  border-radius: 28px;
  background: linear-gradient(145deg, rgba(116, 92, 255, 0.12), rgba(255, 255, 255, 0.025));
}

.pricing-status__icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin-bottom: 28px;
  border-radius: 15px;
  color: var(--price-accent-2);
  background: rgba(116, 92, 255, 0.16);
  font-size: 1.35rem;
}

.pricing-status > p {
  margin: 0 0 8px;
  color: var(--price-faint);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.pricing-status > strong {
  display: block;
  font-size: 1.35rem;
}

.pricing-status > span {
  display: block;
  margin-top: 10px;
  color: var(--price-muted);
  font-size: 0.86rem;
  line-height: 1.65;
}

.pricing-wallet {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 20px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--price-line);
}

.pricing-wallet small {
  color: var(--price-muted);
}
.pricing-wallet b {
  color: var(--price-accent-2);
  font-size: 1.1rem;
}

.pricing-section {
  scroll-margin-top: 110px;
  margin-top: clamp(90px, 11vw, 150px);
}

.pricing-section__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 36px;
}

.pricing-section__head h2,
.pricing-payment__copy h2,
.pricing-cta h2 {
  margin: 10px 0 0;
  font-size: clamp(2rem, 4vw, 3.25rem);
  font-weight: 450;
  letter-spacing: -0.035em;
}

.pricing-section__head > span,
.pricing-disabled-note {
  color: var(--price-muted);
  font-size: 0.82rem;
}

.pricing-disabled-note {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.pricing-plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
  align-items: stretch;
}

.pricing-plan {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 550px;
  padding: 36px;
  border: 1px solid transparent;
  border-radius: 28px;
  background: var(--price-panel);
}

.pricing-plan--popular {
  border-color: rgba(168, 149, 255, 0.78);
  background:
    linear-gradient(180deg, rgba(116, 92, 255, 0.13), transparent 30%), var(--price-panel);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.2);
}

.pricing-plan__popular {
  position: absolute;
  top: 28px;
  right: 28px;
  color: var(--price-warn);
  font-size: 0.78rem;
  font-weight: 700;
}

.pricing-plan__eyebrow {
  color: var(--price-accent-2);
}

.pricing-plan h3 {
  margin: 20px 0 0;
  font-size: clamp(2rem, 3.4vw, 3.1rem);
  font-weight: 400;
  letter-spacing: -0.045em;
}

.pricing-plan__description {
  min-height: 76px;
  margin: 16px 0 0;
  color: var(--price-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.pricing-plan__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
}

.pricing-plan__price strong {
  color: var(--price-accent-2);
  font-size: clamp(2rem, 3vw, 2.8rem);
  font-weight: 500;
  letter-spacing: -0.04em;
}

.pricing-plan__price span,
.pricing-plan__quota {
  color: var(--price-muted);
  font-size: 0.82rem;
}

.pricing-plan__quota {
  margin: 8px 0 0;
}

.pricing-plan__divider {
  margin: 24px 0;
  border-top: 1px solid var(--price-line);
}

.pricing-plan__includes {
  margin: 0 0 14px;
  font-size: 0.82rem;
  font-weight: 700;
}

.pricing-plan ul {
  flex: 1;
  display: grid;
  align-content: start;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pricing-plan li {
  display: flex;
  gap: 10px;
  color: #d8d9df;
  font-size: 0.86rem;
  line-height: 1.5;
}

.pricing-plan li i {
  color: var(--price-accent-2);
}

.pricing-plan__button {
  width: 100%;
  margin-top: 30px;
  padding: 14px 18px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 999px;
  color: #8d909e;
  background: rgba(14, 16, 24, 0.38);
  font-weight: 700;
}

.pricing-plan__button:disabled {
  cursor: not-allowed;
}

.pricing-plan--loading {
  min-height: 550px;
  background: linear-gradient(105deg, #2d303b 25%, #393c48 44%, #2d303b 63%);
  background-size: 300% 100%;
  animation: pricing-shimmer 1.4s linear infinite;
}

@keyframes pricing-shimmer {
  to {
    background-position: -150% 0;
  }
}

.pricing-data-note {
  margin: 20px 0 0;
  color: var(--price-muted);
  font-size: 0.8rem;
}

.pricing-unit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--price-line);
}

.pricing-unit-grid article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 98px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--price-line);
}

.pricing-unit-grid article:nth-child(odd) {
  border-right: 1px solid var(--price-line);
}

.pricing-unit__icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--price-accent-2);
  background: rgba(116, 92, 255, 0.13);
}

.pricing-unit-grid small {
  display: block;
  color: var(--price-faint);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
}

.pricing-unit-grid strong {
  display: block;
  margin-top: 3px;
  font-size: 0.95rem;
}

.pricing-unit-grid article > p {
  margin: 0;
  color: var(--price-accent-2);
  font-size: 1.05rem;
  font-weight: 700;
}

.pricing-unit-grid article > p span {
  color: var(--price-faint);
  font-size: 0.72rem;
  font-weight: 400;
}

.pricing-payment {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(0, 1.15fr);
  gap: clamp(34px, 8vw, 100px);
  align-items: center;
  padding: 56px;
  border-radius: 32px;
  background: var(--price-panel-deep);
}

.pricing-payment__copy > span {
  display: block;
  margin-top: 16px;
  color: var(--price-muted);
  line-height: 1.7;
}

.pricing-payment__methods {
  display: grid;
  gap: 12px;
}

.pricing-payment__methods article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 17px 20px;
  border: 1px solid var(--price-line);
  border-radius: 18px;
  color: #777b89;
  background: rgba(255, 255, 255, 0.018);
}

.pricing-payment__methods article > i:first-child {
  font-size: 1.4rem;
}
.pricing-payment__methods strong {
  display: block;
  color: #9a9dab;
}
.pricing-payment__methods small {
  display: block;
  margin-top: 3px;
}

.pricing-faq__list {
  border-top: 1px solid var(--price-line);
}

.pricing-faq details {
  border-bottom: 1px solid var(--price-line);
}

.pricing-faq summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 24px 4px;
  cursor: pointer;
  list-style: none;
  font-size: 1rem;
  font-weight: 650;
}

.pricing-faq summary::-webkit-details-marker {
  display: none;
}

.pricing-faq summary i {
  color: var(--price-accent-2);
  transition: transform 0.2s ease;
}
.pricing-faq details[open] summary i {
  transform: rotate(45deg);
}

.pricing-faq details p {
  max-width: 850px;
  margin: -6px 0 24px;
  color: var(--price-muted);
  line-height: 1.8;
}

.pricing-cta {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 34px;
  margin-top: clamp(90px, 11vw, 150px);
  padding: 52px 56px;
  border-radius: 32px;
  background: linear-gradient(120deg, #5f48e8, #826cff);
}

.pricing-cta p {
  color: rgba(255, 255, 255, 0.62);
}
.pricing-cta h2 {
  max-width: 740px;
  font-size: clamp(1.7rem, 3.5vw, 2.7rem);
}

.pricing-cta button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border: 0;
  border-radius: 999px;
  color: #201b42;
  background: white;
  font-weight: 800;
  cursor: pointer;
}

@media (max-width: 960px) {
  .pricing-hero {
    grid-template-columns: 1fr;
  }
  .pricing-status {
    max-width: 520px;
  }
  .pricing-plan-grid {
    grid-template-columns: 1fr;
  }
  .pricing-plan {
    min-height: auto;
  }
  .pricing-plan__description {
    min-height: 0;
  }
  .pricing-payment {
    grid-template-columns: 1fr;
    padding: 38px;
  }
}

@media (max-width: 680px) {
  .pricing-shell {
    width: min(100% - 28px, 1240px);
    padding-top: 48px;
  }
  .pricing-hero h1 {
    font-size: clamp(2.7rem, 14vw, 4.5rem);
  }
  .pricing-section__head {
    align-items: start;
    flex-direction: column;
  }
  .pricing-unit-grid {
    grid-template-columns: 1fr;
  }
  .pricing-unit-grid article:nth-child(odd) {
    border-right: 0;
  }
  .pricing-plan {
    padding: 30px 24px;
    border-radius: 22px;
  }
  .pricing-payment {
    padding: 30px 24px;
    border-radius: 24px;
  }
  .pricing-cta {
    align-items: start;
    flex-direction: column;
    padding: 34px 26px;
    border-radius: 24px;
  }
}
</style>
