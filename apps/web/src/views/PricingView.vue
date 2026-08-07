<script setup>
/**
 * 价格页 — 对齐文生图工作台视觉（网格底、面板圆角、紫 accent、亮暗 is-light）
 * 业务：运营套餐 / 创作单价 / 积分获取入口 / FAQ；支付通道未接入时不创建订单。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'
import { getTaskPricing } from '@/services/metaApi'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { TASK_TYPE_LABELS } from '@/services/tasksApi'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const { availableCents, frozenCents, refreshWalletBalance } = useClientWalletBalance()

const plans = ref([])
const plansLoading = ref(true)
const plansLoadFailed = ref(false)
const pricing = ref(null)
const section = ref('plans')
const pageRoot = ref(null)

const sectionTabs = [
  { id: 'plans', label: '套餐方案' },
  { id: 'unit', label: '创作单价' },
  { id: 'pay', label: '获取积分' },
  { id: 'faq', label: '常见问题' },
]

const previewPlans = [
  {
    id: 'preview-usage',
    name: '按量创作',
    eyebrow: '灵活起步',
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
    eyebrow: '持续创作',
    description: '为持续创作准备的月度方案，可先申请体验资格获取创作积分。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: [
      '连续创作权益预览',
      '体验申请审核后一键领取积分',
      '覆盖全部图像工作台',
      '优先体验后续创作能力',
    ],
    popular: true,
    preview: true,
  },
  {
    id: 'preview-pro',
    name: '专业制作',
    eyebrow: '高频制作',
    description: '面向高频制作与团队场景，套餐、发票和协作能力仍在规划中。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: [
      '更高的计划额度',
      '适合高频生产任务',
      '团队与商业能力预留',
      '可通过反馈页提交合作需求',
    ],
    preview: true,
  },
]

const taskPriceRows = computed(() => {
  const values = pricing.value?.taskPointPrices || pricing.value?.taskPrices || {}
  return Object.entries(TASK_TYPE_LABELS).map(([type, label]) => ({
    type,
    label,
    priceCents: Object.prototype.hasOwnProperty.call(values, type) ? Number(values[type]) : null,
  }))
})

const taskTypeMeta = {
  t2i: { icon: 'bi-image', tone: 'violet' },
  coloring: { icon: 'bi-palette2', tone: 'rose' },
  ui_design: { icon: 'bi-window-sidebar', tone: 'cyan' },
  ecommerce_design: { icon: 'bi-bag-check', tone: 'green' },
  model_sheet: { icon: 'bi-badge-hd', tone: 'green' },
  game_art: { icon: 'bi-controller', tone: 'amber' },
  puzzle: { icon: 'bi-puzzle', tone: 'blue' },
}

function taskTypeIcon(type) {
  return taskTypeMeta[type]?.icon || 'bi-stars'
}

function taskTypeTone(type) {
  return taskTypeMeta[type]?.tone || 'violet'
}

const validPrices = computed(() =>
  taskPriceRows.value
    .map((item) => item.priceCents)
    .filter((value) => value !== null && Number.isFinite(value) && value > 0),
)

const minimumTaskPrice = computed(() =>
  validPrices.value.length ? Math.min(...validPrices.value) : 0,
)

const maximumTaskPrice = computed(() =>
  validPrices.value.length ? Math.max(...validPrices.value) : 0,
)

function priceRatio(priceCents) {
  if (priceCents === null || !Number.isFinite(priceCents) || priceCents <= 0) return 0
  if (!maximumTaskPrice.value) return 0
  return Math.max(0.14, Math.min(1, priceCents / maximumTaskPrice.value))
}

const displayPlans = computed(() => {
  if (!plans.value.length) return previewPlans
  return plans.value.map((plan) => ({
    ...plan,
    eyebrow: plan.kind === 'subscription' ? '订阅方案' : '额度包',
    description:
      String(plan.description || '').trim() ||
      (plan.kind === 'subscription'
        ? '订阅期内按计划每日发放创作积分。'
        : '一次性发放到钱包，可用于全部创作工作台。'),
    popular: plan.recommended === true,
    preview: false,
  }))
})

const accessMethods = [
  {
    id: 'redeem',
    name: '兑换码入账',
    icon: 'bi-ticket-perforated',
    note: '已有兑换码可直接进入钱包兑换',
    action: '去兑换',
  },
  {
    id: 'trial',
    name: '申请体验资格',
    icon: 'bi-stars',
    note: '填写职业与用途，审核后一键领取积分',
    action: '立即申请',
  },
  {
    id: 'checkin',
    name: '每日签到',
    icon: 'bi-calendar-check',
    note: '连续签到，每天获得免费创作积分',
    action: '去签到',
  },
]

const faqs = [
  {
    question: '现在怎样获取套餐积分？',
    answer:
      '当前可通过兑换码、体验资格申请和每日签到获取积分。在线支付尚未接入，页面不会创建付款订单或发生自动扣款。',
  },
  {
    question: '当前创作如何计费？',
    answer:
      '任务提交时按张数冻结钱包额度，任务成功后结算；失败或取消时释放对应冻结额度。各工作台的当前单价可在本页下方查看。',
  },
  {
    question: '为什么有些套餐显示“待公布”？',
    answer:
      '运营后台尚未配置正式上架套餐时，页面只展示方案预览，不会虚构金额。正式套餐上架后，本页会自动同步价格、积分与权益。',
  },
  {
    question: '套餐价格会自动扣款吗？',
    answer:
      '不会。当前价格只用于展示套餐价值，支付接口未开放，不会创建订单、跳转收银台或从钱包自动扣款。',
  },
  {
    question: '已有钱包额度会受影响吗？',
    answer: '不会。现有钱包余额、兑换码、签到奖励和任务扣费逻辑保持不变。',
  },
]

function planPrice(plan) {
  if (plan.priceMode === 'unit') {
    return minimumTaskPrice.value > 0 ? formatPoints(minimumTaskPrice.value) : '按量计费'
  }
  if (plan.priceMode === 'coming') return '待公布'
  return formatCents(plan.priceCents)
}

function taskPriceLabel(row) {
  if (row.type === 'puzzle') return '永久免费'
  if (row.priceCents === null || !Number.isFinite(row.priceCents)) return '暂不可用'
  return formatPoints(row.priceCents)
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
      ? `每天发放 ${formatPoints(plan.dailyGrantCents)} 创作额度`
      : ''
  }
  const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0)
  return total > 0 ? `共入账 ${formatPoints(total)} 创作额度` : ''
}

function planFeatures(plan) {
  if (plan.preview) return plan.features
  const configured = Array.isArray(plan.features) ? plan.features : []
  const retained = configured.filter((item) => !/余额\s*[\d.]+\s*元|约\s*\d+\s*张/.test(item))
  const total =
    Number(plan.grantPoints ?? plan.grantCents ?? 0) +
    Number(plan.bonusPoints ?? plan.bonusCents ?? 0)
  const pointsFeatures = []
  if (total > 0) pointsFeatures.push(`${formatPoints(total)} 创作额度`)
  if (total > 0 && minimumTaskPrice.value > 0) {
    pointsFeatures.push(
      `约可生成 ${Math.floor(total / minimumTaskPrice.value)} 张（按最低积分单价）`,
    )
  }
  const items = [...pointsFeatures, ...retained]
  return items.length ? items : ['全平台创作工具通用', '积分进入个人钱包', '当前不会自动创建订单']
}

function scrollToSection(id) {
  section.value = id
  document.getElementById(`pricing-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goCreate() {
  router.push('/text-to-image')
}

function requestPlanAccess() {
  router.push({
    path: '/pricing',
    query: {
      ...router.currentRoute.value.query,
      trial: 'apply',
    },
  })
}

function handlePlanAction(plan) {
  if (plan.preview && plan.priceMode === 'unit') {
    goCreate()
    return
  }
  requestPlanAccess()
}

function planActionLabel(plan) {
  if (plan.preview && plan.priceMode === 'unit') return '开始创作'
  return '申请体验'
}

function useAccessMethod(method) {
  if (method.id === 'redeem') {
    router.push('/wallet')
    return
  }
  if (method.id === 'trial') {
    requestPlanAccess()
    return
  }
  router.push('/check-in')
}

let revealObserver = null
let sectionObserver = null
let revealDisabled = false

function bindReveal() {
  const nodes = Array.from(pageRoot.value?.querySelectorAll('[data-reveal]') || []).filter(
    (el) => !el.dataset.revealBound,
  )
  if (!nodes.length) return
  nodes.forEach((el) => {
    el.dataset.revealBound = '1'
  })
  if (revealDisabled || !revealObserver) {
    nodes.forEach((el) => el.classList.add('is-in'))
    return
  }
  nodes.forEach((el) => revealObserver.observe(el))
}

function setupReveal() {
  revealDisabled =
    document.documentElement.classList.contains('settings-no-animations') ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    typeof IntersectionObserver === 'undefined'
  if (!revealDisabled) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-in')
          revealObserver?.unobserve(entry.target)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -28px' },
    )
  }
  bindReveal()
}

function setupSectionTracking() {
  if (typeof IntersectionObserver === 'undefined') return
  const nodes = Array.from(pageRoot.value?.querySelectorAll('[data-section]') || [])
  if (!nodes.length) return
  sectionObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (hit?.target?.dataset?.section) section.value = hit.target.dataset.section
    },
    { rootMargin: '-42% 0px -42% 0px' },
  )
  nodes.forEach((el) => sectionObserver.observe(el))
}

onMounted(async () => {
  setupReveal()
  setupSectionTracking()

  const [plansResult, pricingResult] = await Promise.allSettled([listPlans(), getTaskPricing()])
  if (plansResult.status === 'fulfilled') {
    plans.value = plansResult.value.items
  } else {
    plansLoadFailed.value = true
  }
  if (pricingResult.status === 'fulfilled') pricing.value = pricingResult.value
  plansLoading.value = false
  await nextTick()
  bindReveal()

  if (authStore.isAuthenticated) {
    void refreshWalletBalance({ force: true }).catch(() => null)
  }
})

watch(
  () => authStore.isAuthenticated,
  (ok) => {
    if (ok) void refreshWalletBalance({ force: true }).catch(() => null)
  },
)

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  revealObserver = null
  sectionObserver?.disconnect()
  sectionObserver = null
})
</script>

<template>
  <div ref="pageRoot" class="pricing-page" :class="{ 'is-light': !appearanceStore.isDark }">
    <div class="pricing-shell">
      <header class="pricing-hero" data-reveal>
        <div class="pricing-hero__copy">
          <p class="pricing-kicker">
            <i class="bi bi-coin" aria-hidden="true"></i>
            计费与套餐
          </p>
          <h1>创作价格</h1>
          <p class="pricing-hero__lede">
            按实际创作任务清晰计价。提交时冻结额度，完成后结算；失败或取消自动返还。
          </p>

          <div class="pricing-tabs" role="tablist" aria-label="页面分区">
            <button
              v-for="tab in sectionTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="pricing-tabs__item"
              :class="{ 'is-active': section === tab.id }"
              :aria-selected="section === tab.id"
              @click="scrollToSection(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>

          <dl class="pricing-metrics" aria-label="价格概览">
            <div>
              <dt>最低单价</dt>
              <dd v-if="minimumTaskPrice > 0">{{ formatPoints(minimumTaskPrice) }}</dd>
              <dd v-else>读取中</dd>
            </div>
            <div>
              <dt>计费单位</dt>
              <dd>按张结算</dd>
            </div>
            <div>
              <dt>任务保障</dt>
              <dd>失败返还</dd>
            </div>
          </dl>
        </div>

        <aside class="pricing-wallet" aria-label="钱包概览">
          <header>
            <span>钱包</span>
            <span class="pricing-wallet__stamp">
              <i class="bi bi-lock-fill" aria-hidden="true"></i>
              安全计费
            </span>
          </header>
          <template v-if="authStore.isAuthenticated">
            <small>当前可用额度</small>
            <strong>{{ formatPoints(availableCents) }}</strong>
            <span v-if="frozenCents > 0" class="pricing-wallet__frozen">
              {{ formatPoints(frozenCents) }} 正在任务中冻结
            </span>
          </template>
          <template v-else>
            <small>登录后查看余额</small>
            <button type="button" class="pricing-wallet__login" @click="router.push('/auth')">
              前往登录
            </button>
          </template>
          <p>现有额度可直接用于全部 AI 创作工作台。</p>
        </aside>
      </header>

      <section
        id="pricing-plans"
        class="pricing-section"
        data-section="plans"
        data-reveal
        aria-labelledby="plans-title"
      >
        <header class="pricing-section__head">
          <div>
            <span>01 · PLANS</span>
            <h2 id="plans-title">套餐方案</h2>
          </div>
          <p>价格、积分和权益由运营后台统一配置；当前可申请体验或使用兑换码。</p>
        </header>

        <div v-if="plansLoading" class="pricing-plan-grid" aria-label="套餐加载中">
          <article v-for="item in 3" :key="item" class="pricing-plan is-loading"></article>
        </div>
        <div v-else class="pricing-plan-grid">
          <article
            v-for="(plan, planIndex) in displayPlans"
            :key="plan.id"
            class="pricing-plan"
            :class="{ 'is-popular': plan.popular }"
            data-reveal
            :style="{ '--reveal-delay': `${planIndex * 70}ms` }"
          >
            <span v-if="plan.badge || plan.popular" class="pricing-plan__badge">
              {{ plan.badge || '推荐' }}
            </span>
            <p class="pricing-plan__eyebrow">{{ plan.eyebrow }}</p>
            <h3>{{ plan.name }}</h3>
            <p class="pricing-plan__desc">{{ plan.description }}</p>
            <div class="pricing-plan__price">
              <strong>{{ planPrice(plan) }}</strong>
              <span>{{ planSuffix(plan) }}</span>
            </div>
            <p v-if="planQuota(plan)" class="pricing-plan__quota">{{ planQuota(plan) }}</p>
            <ul>
              <li v-for="feature in planFeatures(plan)" :key="feature">
                <i class="bi bi-check2" aria-hidden="true"></i>
                {{ feature }}
              </li>
            </ul>
            <button type="button" class="pricing-plan__btn" @click="handlePlanAction(plan)">
              <span>{{ planActionLabel(plan) }}</span>
              <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </button>
          </article>
        </div>

        <p v-if="plansLoadFailed" class="pricing-note">
          套餐服务暂时不可用，当前显示预览方案；创作单价仍以服务端实际返回为准。
        </p>
      </section>

      <section
        id="pricing-unit"
        class="pricing-section"
        data-section="unit"
        data-reveal
        aria-labelledby="unit-title"
      >
        <header class="pricing-section__head">
          <div>
            <span>02 · UNIT PRICE</span>
            <h2 id="unit-title">创作单价</h2>
          </div>
          <p>提交时冻结，成功后结算。</p>
        </header>

        <ul class="pricing-unit-list">
          <li
            v-for="row in taskPriceRows"
            :key="row.type"
            class="pricing-unit-row"
            :data-tone="taskTypeTone(row.type)"
          >
            <span class="pricing-unit-row__icon" aria-hidden="true">
              <i class="bi" :class="taskTypeIcon(row.type)"></i>
            </span>
            <div class="pricing-unit-row__copy">
              <strong>{{ row.label }}</strong>
              <small data-no-translate>{{ row.type }}</small>
            </div>
            <span
              class="pricing-unit-row__bar"
              aria-hidden="true"
              :style="{ '--mag': priceRatio(row.priceCents) }"
            >
              <i></i>
            </span>
            <p class="pricing-unit-row__price">
              <b>{{ taskPriceLabel(row) }}</b>
              <span v-if="row.type === 'puzzle'">· 本地处理</span>
              <span v-else-if="row.priceCents !== null">/ 张</span>
            </p>
          </li>
        </ul>
      </section>

      <section
        id="pricing-pay"
        class="pricing-section"
        data-section="pay"
        data-reveal
        aria-labelledby="pay-title"
      >
        <header class="pricing-section__head">
          <div>
            <span>03 · GET CREDITS</span>
            <h2 id="pay-title">获取创作积分</h2>
          </div>
          <p>无需在线支付，也可以通过以下方式开始创作。</p>
        </header>

        <div class="pricing-pay-grid">
          <article v-for="method in accessMethods" :key="method.id">
            <i class="bi" :class="method.icon" aria-hidden="true"></i>
            <div>
              <strong>{{ method.name }}</strong>
              <small>{{ method.note }}</small>
            </div>
            <button type="button" @click="useAccessMethod(method)">
              {{ method.action }}
              <i class="bi bi-arrow-right" aria-hidden="true"></i>
            </button>
          </article>
        </div>
      </section>

      <section
        id="pricing-faq"
        class="pricing-section"
        data-section="faq"
        data-reveal
        aria-labelledby="faq-title"
      >
        <header class="pricing-section__head">
          <div>
            <span>04 · FAQ</span>
            <h2 id="faq-title">常见问题</h2>
          </div>
        </header>

        <div class="pricing-faq">
          <details v-for="(item, index) in faqs" :key="item.question" :open="index === 0">
            <summary>
              <span>{{ item.question }}</span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </summary>
            <p>{{ item.answer }}</p>
          </details>
        </div>
      </section>

      <section class="pricing-cta" data-reveal>
        <div>
          <h2>使用现有额度，立即开始创作</h2>
          <p>跳转到文生图工作台，继续你的图像生产流程。</p>
        </div>
        <button type="button" class="pricing-cta__btn" @click="goCreate">
          <span>开始创作</span>
          <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pricing-page {
  --pp-bg: #09090c;
  --pp-panel: #121218;
  --pp-panel-2: #1a1a22;
  --pp-field: #16161e;
  --pp-ink: rgba(255, 255, 255, 0.96);
  --pp-muted: rgba(255, 255, 255, 0.62);
  --pp-faint: rgba(255, 255, 255, 0.38);
  --pp-line: rgba(255, 255, 255, 0.08);
  --pp-line-strong: rgba(124, 108, 255, 0.55);
  --pp-accent: #6d5cff;
  --pp-accent-2: #8b7bff;
  --pp-accent-rgb: 109, 92, 255;
  --pp-on-accent: #fff;
  --pp-radius: 20px;
  --pp-radius-sm: 14px;
  --pp-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --pp-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  position: relative;
  isolation: isolate;
  min-height: 100vh;
  overflow-x: clip;
  color: var(--pp-ink);
  color-scheme: dark;
  background-color: var(--pp-bg);
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    radial-gradient(circle at 14% 0%, rgba(var(--pp-accent-rgb), 0.14), transparent 36%);
  background-size:
    24px 24px,
    24px 24px,
    auto;
}

.pricing-page.is-light {
  --pp-bg: #f3f4f8;
  --pp-panel: #ffffff;
  --pp-panel-2: #f7f7fb;
  --pp-field: #fafafe;
  --pp-ink: rgba(24, 26, 37, 0.96);
  --pp-muted: rgba(42, 44, 58, 0.66);
  --pp-faint: rgba(48, 50, 66, 0.42);
  --pp-line: rgba(28, 30, 43, 0.1);
  --pp-line-strong: rgba(109, 92, 255, 0.38);
  --pp-accent: #6250e8;
  --pp-accent-2: #7564ee;
  color-scheme: light;
  background-image:
    linear-gradient(rgba(35, 37, 52, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(35, 37, 52, 0.035) 1px, transparent 1px),
    radial-gradient(circle at 14% 0%, rgba(var(--pp-accent-rgb), 0.08), transparent 36%);
}

.pricing-page *,
.pricing-page *::before,
.pricing-page *::after {
  box-sizing: border-box;
}

.pricing-shell {
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
  padding: calc(var(--app-header-offset, 68px) + 28px) 0
    calc(96px + var(--app-bottom-floating-clearance, 0px));
}

.pricing-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.8fr);
  gap: 20px;
  margin-bottom: 36px;
}

.pricing-hero__copy,
.pricing-wallet,
.pricing-plan,
.pricing-unit-row,
.pricing-pay-grid > article,
.pricing-faq details,
.pricing-cta {
  border: 1px solid var(--pp-line);
  border-radius: var(--pp-radius);
  background: color-mix(in srgb, var(--pp-panel) 92%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
}

.pricing-page.is-light .pricing-hero__copy,
.pricing-page.is-light .pricing-wallet,
.pricing-page.is-light .pricing-plan,
.pricing-page.is-light .pricing-unit-row,
.pricing-page.is-light .pricing-pay-grid > article,
.pricing-page.is-light .pricing-faq details,
.pricing-page.is-light .pricing-cta {
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 44px rgba(43, 39, 77, 0.08);
}

.pricing-hero__copy {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 28px 28px 26px;
}

.pricing-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  width: fit-content;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--pp-line);
  border-radius: 999px;
  color: var(--pp-muted);
  font-size: 12px;
  background: color-mix(in srgb, var(--pp-field) 80%, transparent);
}

.pricing-kicker i {
  color: var(--pp-accent-2);
}

.pricing-hero h1 {
  margin: 0;
  font-size: clamp(34px, 4.4vw, 48px);
  font-weight: 760;
  letter-spacing: -0.02em;
  line-height: 1.12;
}

.pricing-hero__lede {
  margin: 0;
  max-width: min(52ch, 100%);
  color: var(--pp-muted);
  font-size: 15px;
  line-height: 1.7;
}

.pricing-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  width: fit-content;
  max-width: 100%;
  padding: 4px;
  border: 1px solid var(--pp-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--pp-field) 88%, transparent);
}

.pricing-tabs__item {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  color: var(--pp-muted);
  font-size: 13px;
  font-weight: 650;
  background: transparent;
  cursor: pointer;
  transition:
    color 160ms var(--pp-ease),
    background 160ms var(--pp-ease);
}

.pricing-tabs__item.is-active {
  color: var(--pp-ink);
  background: color-mix(in srgb, var(--pp-accent) 18%, var(--pp-panel));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pp-accent) 28%, transparent);
}

.pricing-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 4px 0 0;
}

.pricing-metrics > div {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--pp-line);
  border-radius: var(--pp-radius-sm);
  background: color-mix(in srgb, var(--pp-field) 70%, transparent);
}

.pricing-metrics dt {
  color: var(--pp-faint);
  font-size: 11px;
}

.pricing-metrics dd {
  margin: 0;
  color: var(--pp-ink);
  font-size: 15px;
  font-weight: 700;
}

.pricing-wallet {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 22px 22px 20px;
}

.pricing-wallet header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--pp-muted);
  font-size: 13px;
  font-weight: 650;
}

.pricing-wallet__stamp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--pp-accent-2);
  font-size: 11px;
  background: color-mix(in srgb, var(--pp-accent) 14%, transparent);
}

.pricing-wallet small {
  color: var(--pp-faint);
  font-size: 12px;
}

.pricing-wallet strong {
  font-size: 34px;
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.pricing-wallet p {
  margin: 8px 0 0;
  color: var(--pp-muted);
  font-size: 13px;
  line-height: 1.6;
}

.pricing-wallet__frozen {
  width: fit-content;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, #f59e0b 30%, var(--pp-line));
  border-radius: 6px;
  color: #fbbf24;
  font-size: 11px;
  background: color-mix(in srgb, #f59e0b 9%, transparent);
}

.pricing-wallet__login {
  width: fit-content;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--pp-line-strong);
  border-radius: 999px;
  color: var(--pp-ink);
  font-size: 13px;
  font-weight: 700;
  background: color-mix(in srgb, var(--pp-accent) 16%, transparent);
  cursor: pointer;
}

.pricing-section {
  margin-top: 28px;
}

.pricing-section__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}

.pricing-section__head span {
  display: block;
  margin-bottom: 6px;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.pricing-section__head h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 740;
  letter-spacing: -0.02em;
}

.pricing-section__head > p {
  margin: 0;
  flex: 0 1 36ch;
  max-width: min(36ch, 42%);
  color: var(--pp-muted);
  font-size: 13px;
  line-height: 1.6;
  text-align: right;
}

.pricing-plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.pricing-plan {
  position: relative;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 420px;
  padding: 22px 20px 18px;
}

.pricing-plan.is-popular {
  border-color: color-mix(in srgb, var(--pp-accent) 45%, var(--pp-line));
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.24),
    0 0 0 1px color-mix(in srgb, var(--pp-accent) 22%, transparent);
}

.pricing-plan.is-loading {
  min-height: 320px;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--pp-panel) 90%, transparent) 24%,
    color-mix(in srgb, var(--pp-panel-2) 90%, transparent) 40%,
    color-mix(in srgb, var(--pp-panel) 90%, transparent) 56%
  );
  background-size: 220% 100%;
  animation: pricing-skeleton 1.3s linear infinite;
}

.pricing-plan__badge {
  position: absolute;
  top: 16px;
  right: 16px;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--pp-on-accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 26px;
  background: linear-gradient(108deg, var(--pp-accent), var(--pp-accent-2));
}

.pricing-plan__eyebrow {
  margin: 0;
  color: var(--pp-accent-2);
  font-size: 12px;
  font-weight: 650;
}

.pricing-plan h3 {
  margin: 0;
  font-size: 24px;
  font-weight: 740;
}

.pricing-plan__desc {
  margin: 0;
  color: var(--pp-muted);
  font-size: 13px;
  line-height: 1.65;
}

.pricing-plan__price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
}

.pricing-plan__price strong {
  font-size: 32px;
  font-weight: 760;
  letter-spacing: -0.03em;
}

.pricing-plan__price span,
.pricing-plan__quota {
  color: var(--pp-faint);
  font-size: 12px;
}

.pricing-plan__quota {
  margin: 0;
}

.pricing-plan ul {
  display: grid;
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.pricing-plan li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--pp-muted);
  font-size: 13px;
  line-height: 1.5;
}

.pricing-plan li i {
  margin-top: 2px;
  color: var(--pp-accent-2);
}

.pricing-plan__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  margin-top: auto;
  border: 1px solid var(--pp-line-strong);
  border-radius: 999px;
  color: var(--pp-ink);
  font-size: 13px;
  font-weight: 700;
  background: color-mix(in srgb, var(--pp-accent) 13%, var(--pp-field));
  cursor: pointer;
  transition:
    transform 160ms var(--pp-ease),
    border-color 160ms var(--pp-ease),
    background 160ms var(--pp-ease);
}

.pricing-plan__btn:hover {
  border-color: var(--pp-accent-2);
  background: color-mix(in srgb, var(--pp-accent) 23%, var(--pp-field));
  transform: translateY(-2px);
}

.pricing-note {
  margin: 12px 0 0;
  color: var(--pp-faint);
  font-size: 12px;
}

.pricing-unit-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pricing-unit-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(80px, 1.2fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 12px 16px;
}

.pricing-unit-row__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--pp-accent-2);
  font-size: 18px;
  background: color-mix(in srgb, var(--pp-accent) 14%, transparent);
}

.pricing-unit-row__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.pricing-unit-row__copy strong {
  font-size: 15px;
  font-weight: 700;
}

.pricing-unit-row__copy small {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 11px;
  text-transform: uppercase;
}

.pricing-unit-row__bar {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pp-line) 80%, transparent);
}

.pricing-unit-row__bar > i {
  display: block;
  width: calc(var(--mag, 0) * 100%);
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--pp-accent), var(--pp-accent-2));
}

.pricing-unit-row__price {
  display: grid;
  justify-items: end;
  gap: 2px;
  margin: 0;
  min-width: 88px;
}

.pricing-unit-row__price b {
  font-size: 16px;
  font-weight: 740;
}

.pricing-unit-row__price span {
  color: var(--pp-faint);
  font-size: 11px;
}

.pricing-pay-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.pricing-pay-grid > article {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 84px;
  padding: 16px 18px;
}

.pricing-pay-grid > article > i:first-child {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--pp-accent-2);
  font-size: 20px;
  background: color-mix(in srgb, var(--pp-accent) 14%, transparent);
}

.pricing-pay-grid strong {
  display: block;
  font-size: 15px;
}

.pricing-pay-grid small {
  color: var(--pp-faint);
  font-size: 12px;
}

.pricing-pay-grid > article > button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 11px;
  color: var(--pp-ink);
  border: 1px solid var(--pp-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--pp-accent) 10%, transparent);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  transition:
    border-color 160ms var(--pp-ease),
    background 160ms var(--pp-ease);
}

.pricing-pay-grid > article > button:hover {
  border-color: var(--pp-line-strong);
  background: color-mix(in srgb, var(--pp-accent) 18%, transparent);
}

.pricing-faq {
  display: grid;
  gap: 10px;
}

.pricing-faq details {
  overflow: hidden;
  padding: 0 18px;
}

.pricing-faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  list-style: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 680;
}

.pricing-faq summary::-webkit-details-marker {
  display: none;
}

.pricing-faq summary i {
  color: var(--pp-faint);
  transition: transform 180ms var(--pp-ease);
}

.pricing-faq details[open] summary i {
  transform: rotate(180deg);
}

.pricing-faq p {
  margin: 0 0 16px;
  color: var(--pp-muted);
  font-size: 14px;
  line-height: 1.7;
}

.pricing-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 28px;
  padding: 28px;
}

.pricing-cta > div {
  min-width: 0;
  flex: 1 1 auto;
}

.pricing-cta h2 {
  margin: 0 0 8px;
  font-size: clamp(20px, 2.4vw, 26px);
  font-weight: 740;
  letter-spacing: -0.02em;
}

.pricing-cta p {
  margin: 0;
  max-width: 48ch;
  color: var(--pp-muted);
  font-size: 14px;
}

.pricing-cta__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
  min-width: 168px;
  min-height: 50px;
  padding: 0 22px;
  border: 1px solid rgba(242, 247, 255, 0.42);
  border-radius: 999px;
  color: var(--pp-on-accent);
  font-size: 15px;
  font-weight: 740;
  cursor: pointer;
  background:
    radial-gradient(ellipse at 18% 0%, rgba(255, 255, 255, 0.24), transparent 44%),
    linear-gradient(
      108deg,
      rgba(84, 70, 255, 0.86),
      rgba(127, 103, 255, 0.72) 54%,
      rgba(159, 125, 255, 0.78)
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.56),
    0 12px 30px rgba(91, 77, 255, 0.34);
  transition:
    transform 160ms var(--pp-ease),
    box-shadow 200ms ease;
}

.pricing-cta__btn:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.64),
    0 16px 38px rgba(91, 77, 255, 0.44);
}

.pricing-page [data-reveal] {
  opacity: 1;
  transform: none;
  transition:
    opacity 420ms var(--pp-ease),
    transform 420ms var(--pp-ease);
  transition-delay: var(--reveal-delay, 0ms);
}

.pricing-page [data-reveal].is-in {
  opacity: 1;
  transform: none;
}

.pricing-tabs__item:focus-visible,
.pricing-wallet__login:focus-visible,
.pricing-plan__btn:focus-visible,
.pricing-faq summary:focus-visible,
.pricing-cta__btn:focus-visible {
  outline: 2px solid var(--pp-accent-2);
  outline-offset: 2px;
}

@keyframes pricing-skeleton {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (max-width: 980px) {
  .pricing-hero {
    grid-template-columns: 1fr;
  }

  .pricing-plan-grid,
  .pricing-pay-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pricing-section__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .pricing-section__head > p {
    max-width: 100%;
    text-align: left;
  }

  .pricing-plan {
    min-height: 0;
  }

  .pricing-cta {
    flex-direction: column;
    align-items: stretch;
  }

  .pricing-cta__btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pricing-page [data-reveal] {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .pricing-plan.is-loading,
  .pricing-cta__btn {
    animation: none;
    transition: none;
  }
}
</style>
