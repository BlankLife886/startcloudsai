<script setup>
// 价格页 · 星云暗夜版 v2「星图观测台」
// 视觉：分层星野（视差）+ 右侧观测导航轨 + 每方案独立星座 + 数据驱动星等条 + 分区巨型编号。
// 亮色为纸上星图，暗色为夜空星云，跟随全局 html.color-scheme-dark。
// 业务逻辑与支付停用状态保持不变；新增装饰元素全部 aria-hidden，不引入新的可见文案。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'
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
const pageRoot = ref(null)

// 支付通道尚未接入。即使后端将来增加支付能力，也必须完成前端收银台接入后再显式改为 true。
const PAYMENT_UI_ENABLED = false

// 右侧观测轨。label 复用页面内已有文案键，编号为 mono 装饰不参与翻译。
const railNodes = [
  { id: 'plans', code: '01', label: '套餐方案' },
  { id: 'unit', code: '02', label: '创作单价' },
  { id: 'pay', code: '03', label: '支付方式' },
  { id: 'faq', code: '04', label: '常见问题' },
]

// 每个方案一组独立星座，纯装饰。
const planCharts = [
  {
    line: '4,27 19,11 35,21 53,7',
    stars: [
      [4, 27, 1.4],
      [19, 11, 2.3],
      [35, 21, 1.4],
      [53, 7, 1.7],
    ],
  },
  {
    line: '5,9 19,25 37,13 51,27 62,9',
    stars: [
      [5, 9, 1.4],
      [19, 25, 1.6],
      [37, 13, 2.6],
      [51, 27, 1.5],
      [62, 9, 1.4],
    ],
  },
  {
    line: '4,19 23,6 31,27 49,16',
    stars: [
      [4, 19, 1.5],
      [23, 6, 2.2],
      [31, 27, 1.4],
      [49, 16, 1.7],
    ],
  },
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
    eyebrow: '高频制作',
    description: '面向高频制作与团队场景，套餐、发票和协作能力仍在规划中。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: ['更高的计划额度', '适合高频生产任务', '团队与商业能力预留', '支付接入后开放购买'],
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

// 星等条宽度：真实单价占全站最高单价的比例，最低保留 14% 以便可见。
function priceRatio(priceCents) {
  if (priceCents === null || !Number.isFinite(priceCents) || priceCents <= 0) return 0
  if (!maximumTaskPrice.value) return 0
  return Math.max(0.14, Math.min(1, priceCents / maximumTaskPrice.value))
}

const displayPlans = computed(() => {
  if (!plans.value.length) return previewPlans
  return plans.value.map((plan, index) => ({
    ...plan,
    eyebrow: plan.kind === 'subscription' ? '订阅方案' : '额度包',
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
    answer: '暂时不可以。支付通道尚未接入，当前套餐用于提前了解方案结构，不会创建订单或发生扣款。',
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
    return minimumTaskPrice.value > 0 ? formatPoints(minimumTaskPrice.value) : '按量计费'
  }
  if (plan.priceMode === 'coming') return '待公布'
  return formatCents(plan.priceCents)
}

function taskPriceLabel(priceCents) {
  if (priceCents === null || !Number.isFinite(priceCents)) return '暂不可用'
  return formatPoints(priceCents)
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
  const total = Number(plan.grantPoints ?? plan.grantCents ?? 0) + Number(plan.bonusPoints ?? plan.bonusCents ?? 0)
  const pointsFeatures = []
  if (total > 0) pointsFeatures.push(`${formatPoints(total)} 创作额度`)
  if (total > 0 && minimumTaskPrice.value > 0) {
    pointsFeatures.push(`约可生成 ${Math.floor(total / minimumTaskPrice.value)} 张（按最低积分单价）`)
  }
  const items = [...pointsFeatures, ...retained]
  return items.length ? items : ['套餐信息已配置', '支付接入后开放购买', '当前不会创建订单']
}

function planChart(index) {
  return planCharts[index % planCharts.length]
}

function scrollToSection(id) {
  section.value = id
  document.getElementById(`pricing-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goCreate() {
  router.push('/text-to-image')
}

/* ——— 动效：入场显现 / 分区高亮 / 滚动进度与视差 ——— */
let revealObserver = null
let sectionObserver = null
let revealDisabled = false
let rafId = 0
let scrollHandler = null

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
      { threshold: 0.1, rootMargin: '0px 0px -36px' },
    )
  }
  bindReveal()
}

// 观测轨高亮：取穿过视口中带的分区。
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
    { rootMargin: '-45% 0px -45% 0px' },
  )
  nodes.forEach((el) => sectionObserver.observe(el))
}

// 滚动进度写入 --pp-progress：观测轨填充始终使用，星野视差仅在允许动效时消费。
function setupScrollProgress() {
  const update = () => {
    rafId = 0
    const el = pageRoot.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const span = Math.max(1, rect.height - window.innerHeight)
    const progress = Math.min(1, Math.max(0, -rect.top / span))
    el.style.setProperty('--pp-progress', progress.toFixed(4))
  }
  scrollHandler = () => {
    if (rafId) return
    rafId = requestAnimationFrame(update)
  }
  window.addEventListener('scroll', scrollHandler, { passive: true })
  window.addEventListener('resize', scrollHandler, { passive: true })
  update()
}

onMounted(async () => {
  setupReveal()
  setupSectionTracking()
  setupScrollProgress()

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
  scrollHandler?.()

  if (authStore.isAuthenticated) {
    wallet.value = await getWallet().catch(() => null)
  }
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  revealObserver = null
  sectionObserver?.disconnect()
  sectionObserver = null
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler)
    window.removeEventListener('resize', scrollHandler)
    scrollHandler = null
  }
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
})
</script>

<template>
  <div ref="pageRoot" class="pricing-page">
    <!-- 星野：双层星幕 / 上下星云 / 轨道环 / 两道彗星 -->
    <div class="pricing-sky" aria-hidden="true">
      <div class="pricing-sky__nebula"></div>
      <div class="pricing-sky__nebula is-two"></div>
      <div class="pricing-sky__stars is-a"></div>
      <div class="pricing-sky__stars is-b"></div>
      <div class="pricing-sky__ring"></div>
      <div class="pricing-sky__comet"></div>
      <div class="pricing-sky__comet is-two"></div>
    </div>

    <!-- 右侧观测轨（窄屏与触屏隐藏） -->
    <nav class="pp-rail" aria-label="页面分区">
      <span class="pp-rail__track" aria-hidden="true"><i></i></span>
      <button
        v-for="node in railNodes"
        :key="node.id"
        type="button"
        class="pp-rail__item"
        :class="{ 'is-active': section === node.id }"
        @click="scrollToSection(node.id)"
      >
        <span class="pp-rail__name">{{ node.label }}</span>
        <span class="pp-rail__no" data-no-translate>{{ node.code }}</span>
        <span class="pp-rail__dot" aria-hidden="true"></span>
      </button>
    </nav>

    <main class="pricing-shell">
      <span class="pp-spine" aria-hidden="true" data-no-translate>STARCLOUDS · PRICING CHART</span>

      <!-- 序 · 观测台 -->
      <section class="pp-hero" aria-labelledby="pricing-title">
        <div class="pp-hero__copy">
          <p class="pp-kicker">
            <span class="pp-kicker__code" data-no-translate>SC·PRICING</span>
            <span class="pp-kicker__star" aria-hidden="true">✦</span>
            <span>计费与套餐</span>
          </p>
          <h1 id="pricing-title">创作价格</h1>
          <p class="pp-hero__lede">
            按实际创作任务清晰计价。提交时冻结额度，任务完成后结算，失败或取消会自动返还。
          </p>

          <div class="pp-switch" aria-label="页面分区">
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

          <dl class="pp-metrics" aria-label="价格概览">
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

        <aside class="pp-console" aria-label="支付接入状态">
          <div class="pp-console__orbit" aria-hidden="true"><i></i></div>
          <header class="pp-console__head">
            <span class="pp-console__code" data-no-translate>WALLET / 01</span>
            <span class="pp-console__stamp"><i class="bi bi-lock-fill"></i> 支付筹备中</span>
          </header>
          <p class="pp-console__label">钱包概览</p>
          <div v-if="authStore.isAuthenticated" class="pp-console__balance">
            <small>当前可用额度</small>
            <b>{{ formatPoints(availableCents) }}</b>
          </div>
          <div v-else class="pp-console__balance is-guest">
            <small>登录后查看余额</small>
            <button type="button" @click="router.push('/auth')">前往登录</button>
          </div>
          <p class="pp-console__foot">现有额度可直接用于全部 AI 创作工作台。</p>
        </aside>
      </section>

      <!-- 01 · 套餐方案 -->
      <section id="pricing-plans" class="pp-sec pp-plans" data-section="plans" data-reveal>
        <header class="pp-sec__head">
          <span class="pp-sec__ghost" aria-hidden="true" data-no-translate>01</span>
          <div>
            <span class="pp-sec__code" data-no-translate>01 / ROUTE MAP</span>
            <p>套餐方案</p>
            <h2>按创作频率选择</h2>
          </div>
          <span class="pp-sec__note"><i class="bi bi-eye"></i> 套餐预览</span>
        </header>

        <div class="pp-planmap">
          <div class="pp-planmap__sky" aria-hidden="true">
            <svg viewBox="0 0 1200 64" preserveAspectRatio="none" focusable="false">
              <polyline
                points="0,56 200,30 428,44 600,18 786,34 1000,26 1200,54"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <span class="pp-planmap__node" style="left: 16.66%"></span>
            <span class="pp-planmap__node is-major" style="left: 50%"></span>
            <span class="pp-planmap__node" style="left: 83.33%"></span>
          </div>

          <div v-if="plansLoading" class="pp-plan-grid" aria-label="套餐加载中">
            <article v-for="item in 3" :key="item" class="pp-plan pp-plan--loading"></article>
          </div>
          <div v-else class="pp-plan-grid">
            <article
              v-for="(plan, planIndex) in displayPlans"
              :key="plan.id"
              class="pp-plan"
              :class="{ 'pp-plan--popular': plan.popular }"
              :data-tone="['flexible', 'creator', 'studio'][planIndex % 3]"
              data-reveal
              :style="{ '--reveal-delay': `${planIndex * 90}ms` }"
            >
              <svg class="pp-plan__chart" viewBox="0 0 66 34" aria-hidden="true" focusable="false">
                <polyline :points="planChart(planIndex).line" vector-effect="non-scaling-stroke" />
                <circle
                  v-for="(star, starIndex) in planChart(planIndex).stars"
                  :key="starIndex"
                  :cx="star[0]"
                  :cy="star[1]"
                  :r="star[2]"
                />
              </svg>

              <span v-if="plan.popular" class="pp-plan__popular">
                <i class="bi bi-star-fill"></i> 推荐方案
              </span>
              <p class="pp-plan__eyebrow">{{ plan.eyebrow }}</p>
              <h3>{{ plan.name }}</h3>
              <p class="pp-plan__description">{{ plan.description }}</p>

              <div class="pp-plan__price">
                <strong>{{ planPrice(plan) }}</strong>
                <span>{{ planSuffix(plan) }}</span>
              </div>
              <p v-if="planQuota(plan)" class="pp-plan__quota">{{ planQuota(plan) }}</p>

              <div class="pp-plan__divider" aria-hidden="true"><span>✦</span></div>
              <p class="pp-plan__includes">包含权益</p>
              <ul>
                <li v-for="feature in planFeatures(plan)" :key="feature">{{ feature }}</li>
              </ul>

              <button
                type="button"
                class="pp-plan__button"
                :disabled="!PAYMENT_UI_ENABLED"
                title="支付通道尚未接入"
              >
                <i class="bi bi-lock-fill"></i>
                支付暂未开放
              </button>
            </article>
          </div>
        </div>

        <p v-if="plansLoadFailed" class="pp-data-note">
          套餐服务暂时不可用，当前显示的是预览方案；创作单价仍以服务端实际返回为准。
        </p>
      </section>

      <!-- 02 · 创作单价（星表） -->
      <section id="pricing-unit" class="pp-sec pp-catalog" data-section="unit" data-reveal>
        <header class="pp-sec__head">
          <span class="pp-sec__ghost" aria-hidden="true" data-no-translate>02</span>
          <div>
            <span class="pp-sec__code" data-no-translate>02 / STAR CATALOG</span>
            <p>创作单价</p>
            <h2>六类创作，一目了然</h2>
          </div>
          <span class="pp-sec__note">提交时冻结，成功后结算</span>
        </header>

        <ol class="pp-catalog__list">
          <li
            v-for="(row, rowIndex) in taskPriceRows"
            :key="row.type"
            :data-tone="taskTypeTone(row.type)"
            :style="{ '--mag': priceRatio(row.priceCents), '--row-delay': `${rowIndex * 70}ms` }"
          >
            <span class="pp-catalog__no" data-no-translate>
              {{ String(rowIndex + 1).padStart(2, '0') }}
            </span>
            <span class="pp-catalog__icon" aria-hidden="true">
              <i class="bi" :class="taskTypeIcon(row.type)"></i>
            </span>
            <div class="pp-catalog__name">
              <strong>{{ row.label }}</strong>
              <small data-no-translate>SC-{{ row.type.toUpperCase() }}</small>
            </div>
            <span class="pp-catalog__leader" aria-hidden="true"></span>
            <span class="pp-catalog__mag" aria-hidden="true"><i></i></span>
            <p class="pp-catalog__price">
              <b>{{ taskPriceLabel(row.priceCents) }}</b>
              <span v-if="row.priceCents !== null">/ 张</span>
            </p>
          </li>
        </ol>
      </section>

      <!-- 03 · 支付泊位 -->
      <section
        id="pricing-pay"
        class="pp-sec pp-payment"
        aria-labelledby="payment-title"
        data-section="pay"
        data-reveal
      >
        <div class="pp-payment__copy">
          <span class="pp-sec__code" data-no-translate>03 / DOCKING</span>
          <p>支付方式</p>
          <h2 id="payment-title">安全接入中</h2>
          <span class="pp-payment__lede">支付通道开放后，可在这里选择常用付款方式。</span>
        </div>
        <div class="pp-payment__methods">
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

      <!-- 04 · 航行手册 -->
      <section id="pricing-faq" class="pp-sec pp-faq" data-section="faq" data-reveal>
        <header class="pp-sec__head">
          <span class="pp-sec__ghost" aria-hidden="true" data-no-translate>04</span>
          <div>
            <span class="pp-sec__code" data-no-translate>04 / MANUAL</span>
            <p>帮助中心</p>
            <h2>常见问题</h2>
          </div>
        </header>

        <div class="pp-faq__list">
          <details v-for="(item, index) in faqs" :key="item.question" :open="index === 0">
            <summary>
              <span class="pp-faq__no" aria-hidden="true" data-no-translate>
                Q.{{ String(index + 1).padStart(2, '0') }}
              </span>
              <span class="pp-faq__q">{{ item.question }}</span>
              <i class="bi bi-plus-lg"></i>
            </summary>
            <p>{{ item.answer }}</p>
          </details>
        </div>
      </section>

      <!-- 尾声 · 启程 -->
      <section class="pp-cta" data-reveal>
        <div class="pp-cta__stars" aria-hidden="true"></div>
        <div class="pp-cta__trail" aria-hidden="true"></div>
        <div class="pp-cta__copy">
          <p>开始创作</p>
          <h2>使用现有额度，立即开始新的创作。</h2>
        </div>
        <button type="button" @click="goCreate">开始创作 <i class="bi bi-arrow-right"></i></button>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* ————— 主题变量：亮色 = 纸上星图，暗色 = 夜空星云 ————— */
.pricing-page {
  --pp-serif: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --pp-mono: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
  --pp-progress: 0;

  --pp-bg: #f4f2fc;
  --pp-ink: #1b2340;
  --pp-muted: #626a8c;
  --pp-faint: #8d93b0;
  --pp-line: rgba(24, 30, 58, 0.16);
  --pp-line-soft: rgba(24, 30, 58, 0.08);
  --pp-panel: #fffdfd;
  --pp-panel-2: #faf8ff;
  --pp-violet: #6a4fe0;
  --pp-violet-2: #5a3fd0;
  --pp-glow: rgba(106, 79, 224, 0.2);
  --pp-star: rgba(27, 35, 64, 0.5);
  --pp-star-bright: rgba(106, 79, 224, 0.7);
  --pp-shadow: 4px 4px 0 rgba(106, 79, 224, 0.13);
  --pp-shadow-hover: 6px 6px 0 rgba(106, 79, 224, 0.2);
  --pp-warn: #a26a2c;
  --pp-nebula-a: rgba(106, 79, 224, 0.11);
  --pp-nebula-b: rgba(97, 140, 255, 0.09);
  --pp-nebula-c: rgba(203, 108, 176, 0.07);
  --pp-ghost: rgba(24, 30, 58, 0.05);
  --pp-comet-alpha: 0.35;
  --pp-ease: cubic-bezier(0.22, 0.8, 0.24, 1);

  position: relative;
  isolation: isolate;
  overflow-x: clip;
  overflow-y: visible;
  min-height: 100vh;
  color: var(--pp-ink);
  background: var(--pp-bg);
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
}

html.color-scheme-dark .pricing-page {
  --pp-bg: #0a0d18;
  --pp-ink: #f1f2fa;
  --pp-muted: #a8adc8;
  --pp-faint: #767d9e;
  --pp-line: rgba(233, 236, 255, 0.14);
  --pp-line-soft: rgba(233, 236, 255, 0.07);
  --pp-panel: #131728;
  --pp-panel-2: #0f1322;
  --pp-violet: #8b7cf6;
  --pp-violet-2: #b6a9ff;
  --pp-glow: rgba(139, 124, 246, 0.42);
  --pp-star: rgba(255, 255, 255, 0.88);
  --pp-star-bright: rgba(216, 208, 255, 1);
  --pp-shadow: 0 14px 34px rgba(2, 4, 12, 0.44);
  --pp-shadow-hover: 0 22px 52px rgba(2, 4, 12, 0.6);
  --pp-warn: #e3b077;
  --pp-nebula-a: rgba(124, 92, 255, 0.22);
  --pp-nebula-b: rgba(66, 120, 255, 0.14);
  --pp-nebula-c: rgba(214, 120, 178, 0.12);
  --pp-ghost: rgba(233, 236, 255, 0.045);
  --pp-comet-alpha: 0.95;
}

/* ————— 星野 ————— */
.pricing-sky {
  pointer-events: none;
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
}

.pricing-sky__nebula {
  position: absolute;
  inset: -6% -8% auto;
  height: min(1180px, 96vh);
  background:
    radial-gradient(ellipse 44% 40% at 22% 18%, var(--pp-nebula-a), transparent 70%),
    radial-gradient(ellipse 38% 34% at 80% 8%, var(--pp-nebula-b), transparent 72%),
    radial-gradient(ellipse 30% 26% at 56% 52%, var(--pp-nebula-c), transparent 74%);
  mask-image: linear-gradient(180deg, #000 52%, transparent);
  transform: translate3d(0, calc(var(--pp-progress) * -78px), 0);
  animation: pp-breathe 26s ease-in-out infinite alternate;
  will-change: transform;
}

.pricing-sky__nebula.is-two {
  inset: auto -8% -4%;
  height: min(980px, 82vh);
  background:
    radial-gradient(ellipse 40% 42% at 74% 76%, var(--pp-nebula-a), transparent 72%),
    radial-gradient(ellipse 34% 32% at 20% 62%, var(--pp-nebula-c), transparent 74%);
  mask-image: linear-gradient(0deg, #000 54%, transparent);
  transform: translate3d(0, calc(var(--pp-progress) * 54px), 0);
  animation-duration: 34s;
}

.pricing-sky__stars {
  position: absolute;
  inset: -80px 0;
  background-repeat: repeat;
  will-change: transform;
}

.pricing-sky__stars.is-a {
  background-image:
    radial-gradient(1.4px 1.4px at 40px 62px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1px 1px at 124px 302px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1.5px 1.5px at 202px 108px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1px 1px at 262px 424px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1.3px 1.3px at 332px 218px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1px 1px at 412px 382px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1.4px 1.4px at 470px 92px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1px 1px at 92px 472px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1.2px 1.2px at 352px 32px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(1px 1px at 498px 258px, var(--pp-star) 50%, transparent 100%);
  background-size: 520px 520px;
  opacity: 0.62;
  transform: translate3d(0, calc(var(--pp-progress) * -26px), 0);
  animation: pp-twinkle 7s ease-in-out infinite alternate;
}

.pricing-sky__stars.is-b {
  background-image:
    radial-gradient(2.2px 2.2px at 62px 182px, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.6px 1.6px at 222px 58px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2px 2px at 332px 468px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2.4px 2.4px at 482px 222px, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.6px 1.6px at 622px 122px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2px 2px at 700px 402px, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.6px 1.6px at 152px 622px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2px 2px at 402px 302px, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2.4px 2.4px at 560px 562px, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.6px 1.6px at 92px 342px, var(--pp-star) 50%, transparent 100%);
  background-size: 760px 700px;
  opacity: 0.5;
  transform: translate3d(0, calc(var(--pp-progress) * -58px), 0);
  animation: pp-twinkle 11s ease-in-out -4s infinite alternate;
}

.pricing-sky__ring {
  position: absolute;
  top: -150px;
  right: -170px;
  width: min(48vw, 600px);
  aspect-ratio: 1;
  border: 1px dashed color-mix(in srgb, var(--pp-violet) 30%, transparent);
  border-radius: 50%;
  animation: pp-rotate 150s linear infinite;
}

.pricing-sky__ring::before {
  content: '';
  position: absolute;
  inset: 17%;
  border: 1px solid color-mix(in srgb, var(--pp-violet) 16%, transparent);
  border-radius: 50%;
}

.pricing-sky__ring::after {
  content: '';
  position: absolute;
  top: 13%;
  left: 16%;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--pp-violet);
  box-shadow: 0 0 16px var(--pp-glow);
}

.pricing-sky__comet {
  position: absolute;
  top: 13%;
  left: -16%;
  width: 200px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--pp-violet), #fff);
  opacity: 0;
  transform: rotate(9deg);
  animation: pp-comet 19s ease-in 5s infinite;
}

.pricing-sky__comet.is-two {
  top: 58%;
  left: -22%;
  width: 150px;
  animation: pp-comet 27s ease-in 14s infinite;
}

@keyframes pp-breathe {
  from {
    opacity: 0.78;
  }
  to {
    opacity: 1;
  }
}

@keyframes pp-twinkle {
  from {
    opacity: 0.3;
  }
  to {
    opacity: 0.82;
  }
}

@keyframes pp-rotate {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pp-comet {
  0% {
    transform: translate3d(0, 0, 0) rotate(9deg);
    opacity: 0;
  }
  2% {
    opacity: var(--pp-comet-alpha);
  }
  11% {
    transform: translate3d(70vw, 13vh, 0) rotate(9deg);
    opacity: 0;
  }
  100% {
    transform: translate3d(70vw, 13vh, 0) rotate(9deg);
    opacity: 0;
  }
}

/* ————— 右侧观测轨 ————— */
/* 轨道自身保持窄占位（编号 + 星点），分区名以浮层 chip 形式出现，避免挤压正文 */
.pp-rail {
  position: fixed;
  z-index: 3;
  top: 50%;
  right: clamp(10px, 1.6vw, 24px);
  display: grid;
  gap: 2px;
  transform: translateY(-50%);
}

.pp-rail__track {
  position: absolute;
  top: 14px;
  right: 5px;
  bottom: 14px;
  width: 1px;
  background: var(--pp-line);
}

.pp-rail__track i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--pp-violet);
  transform: scaleY(var(--pp-progress));
  transform-origin: top;
}

.pp-rail__item {
  position: relative;
  width: 42px;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.pp-rail__name {
  position: absolute;
  right: 100%;
  margin-right: 6px;
  padding: 5px 10px;
  border: 1px solid var(--pp-line);
  border-radius: 4px;
  color: var(--pp-muted);
  background: var(--pp-panel);
  box-shadow: var(--pp-shadow);
  font-size: 0.76rem;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  transform: translateX(6px);
  transition:
    opacity 200ms var(--pp-ease),
    transform 200ms var(--pp-ease);
}

.pp-rail__no {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  opacity: 0.45;
  transition:
    opacity 200ms ease,
    color 200ms ease;
}

.pp-rail__dot {
  width: 7px;
  height: 7px;
  margin-right: 2px;
  border: 1px solid var(--pp-line);
  border-radius: 50%;
  background: var(--pp-bg);
  transition:
    background-color 200ms ease,
    border-color 200ms ease,
    box-shadow 200ms ease,
    transform 200ms var(--pp-ease);
}

.pp-rail__item:hover .pp-rail__name,
.pp-rail__item:focus-visible .pp-rail__name {
  opacity: 1;
  transform: none;
}

.pp-rail__item:hover .pp-rail__no,
.pp-rail__item.is-active .pp-rail__no {
  opacity: 1;
}

.pp-rail__item.is-active .pp-rail__no {
  color: var(--pp-violet);
}

.pp-rail__item.is-active .pp-rail__dot {
  border-color: var(--pp-violet);
  background: var(--pp-violet);
  box-shadow: 0 0 12px var(--pp-glow);
  transform: scale(1.3);
}

.pp-rail__item:hover .pp-rail__dot {
  border-color: var(--pp-violet);
}

@media (max-width: 1359px), (hover: none) {
  .pp-rail {
    display: none;
  }
}

/* ————— 页面骨架 ————— */
.pricing-shell {
  position: relative;
  z-index: 1;
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: clamp(40px, 5vw, 64px) 0 72px;
}

.pp-spine {
  position: absolute;
  top: clamp(60px, 7vw, 96px);
  left: -30px;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.6rem;
  letter-spacing: 0.34em;
  opacity: 0.65;
  writing-mode: vertical-rl;
}

@media (max-width: 1399px) {
  .pp-spine {
    display: none;
  }
}

/* ————— 入场显现 ————— */
[data-reveal] {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s var(--pp-ease) var(--reveal-delay, 0ms),
    transform 0.6s var(--pp-ease) var(--reveal-delay, 0ms);
}

[data-reveal].is-in {
  opacity: 1;
  transform: none;
}

/* ————— 序 · 观测台 ————— */
.pp-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 336px);
  gap: clamp(28px, 5vw, 64px);
  align-items: stretch;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--pp-line);
}

.pp-kicker {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--pp-faint);
  font-size: 0.72rem;
  font-weight: 700;
}

.pp-kicker__code {
  color: var(--pp-violet);
  font-family: var(--pp-mono);
  font-size: 0.7rem;
  letter-spacing: 0.22em;
}

.pp-kicker__star {
  color: var(--pp-violet);
  font-size: 0.62rem;
  animation: pp-twinkle 3.5s ease-in-out infinite alternate;
}

.pp-hero h1 {
  margin: 14px 0 0;
  max-width: 760px;
  font-family: var(--pp-serif);
  font-size: clamp(2.7rem, 5.4vw, 4.8rem);
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1.04;
}

html.color-scheme-dark .pricing-page .pp-hero h1 {
  text-shadow: 0 0 48px var(--pp-glow);
}

.pp-hero__lede {
  max-width: 620px;
  margin: 18px 0 0;
  color: var(--pp-muted);
  font-size: 0.94rem;
  line-height: 1.75;
}

.pp-switch {
  width: fit-content;
  display: flex;
  margin-top: 26px;
  padding: 4px;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: var(--pp-panel-2);
}

.pp-switch button {
  min-width: 108px;
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 4px;
  color: var(--pp-muted);
  background: transparent;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.pp-switch button:hover:not(.active) {
  color: var(--pp-ink);
}

.pp-switch button.active {
  color: #fff;
  background: var(--pp-violet);
  box-shadow: 0 0 18px var(--pp-glow);
}

.pp-metrics {
  max-width: 640px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 30px 0 0;
  border-block: 1px solid var(--pp-line);
}

.pp-metrics > div {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 17px 18px;
}

.pp-metrics > div + div {
  border-left: 1px solid var(--pp-line);
}

.pp-metrics > div::before {
  content: '';
  position: absolute;
  top: -3px;
  left: 18px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--pp-violet) 55%, transparent);
}

.pp-metrics dt {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
}

.pp-metrics dd {
  overflow: hidden;
  margin: 0;
  color: var(--pp-ink);
  font-size: 0.98rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 观测舱 · 钱包卡 */
.pp-console {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 22px;
  border: 1px solid var(--pp-line);
  border-radius: 8px;
  background: var(--pp-panel);
  box-shadow: var(--pp-shadow);
  transition:
    background-color 0.3s ease,
    border-color 0.3s ease;
}

.pp-console__orbit {
  pointer-events: none;
  position: absolute;
  top: -68px;
  right: -74px;
  width: 190px;
  aspect-ratio: 1;
  border: 1px dashed color-mix(in srgb, var(--pp-violet) 34%, transparent);
  border-radius: 50%;
  animation: pp-rotate 88s linear infinite;
}

.pp-console__orbit i {
  position: absolute;
  top: 22%;
  left: 7%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pp-violet);
  box-shadow: 0 0 14px var(--pp-glow);
}

.pp-console__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.pp-console__code {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  letter-spacing: 0.18em;
}

.pp-console__stamp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--pp-warn) 55%, transparent);
  border-radius: 3px;
  color: var(--pp-warn);
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  transform: rotate(2deg);
}

.pp-console__label {
  margin: 26px 0 0;
  color: var(--pp-faint);
  font-size: 0.68rem;
  font-weight: 700;
}

.pp-console__balance {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 20px;
  margin-top: 8px;
  padding: 14px 0 18px;
  border-bottom: 1px solid var(--pp-line);
}

.pp-console__balance small {
  color: var(--pp-muted);
}

.pp-console__balance b {
  color: var(--pp-violet-2);
  font-family: var(--pp-mono);
  font-size: 1.24rem;
  letter-spacing: 0.01em;
}

html.color-scheme-dark .pricing-page .pp-console__balance b {
  text-shadow: 0 0 22px var(--pp-glow);
}

.pp-console__balance button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--pp-line);
  border-radius: 4px;
  color: var(--pp-ink);
  background: var(--pp-panel-2);
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}

.pp-console__balance button:hover {
  border-color: var(--pp-violet);
  color: var(--pp-violet);
  box-shadow: 0 0 14px var(--pp-glow);
}

.pp-console__foot {
  display: block;
  margin: auto 0 0;
  padding-top: 20px;
  color: var(--pp-muted);
  font-size: 0.85rem;
  line-height: 1.6;
}

/* ————— 分区骨架 ————— */
.pp-sec {
  scroll-margin-top: 110px;
  margin-top: clamp(58px, 7vw, 92px);
}

.pp-sec__head {
  position: relative;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 26px;
}

/* 巨型编号水印 */
.pp-sec__ghost {
  pointer-events: none;
  position: absolute;
  z-index: -1;
  top: -0.36em;
  left: -0.06em;
  color: var(--pp-ghost);
  font-family: var(--pp-serif);
  font-size: clamp(5rem, 11vw, 9.5rem);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  user-select: none;
}

.pp-sec__code {
  display: block;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.64rem;
  letter-spacing: 0.24em;
}

.pp-sec__head p,
.pp-payment__copy > p,
.pp-cta__copy p {
  margin: 10px 0 0;
  color: var(--pp-violet);
  font-size: 0.72rem;
  font-weight: 700;
}

.pp-sec__head h2,
.pp-payment__copy h2,
.pp-cta__copy h2 {
  margin: 8px 0 0;
  font-family: var(--pp-serif);
  font-size: clamp(1.6rem, 3vw, 2.35rem);
  font-weight: 600;
  letter-spacing: 0.015em;
}

.pp-sec__note {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--pp-muted);
  font-size: 0.82rem;
}

/* ————— 01 · 套餐 ————— */
.pp-planmap {
  position: relative;
}

.pp-planmap__sky {
  pointer-events: none;
  position: absolute;
  inset: -46px 0 auto;
  height: 64px;
}

.pp-planmap__sky svg {
  width: 100%;
  height: 100%;
  display: block;
}

.pp-planmap__sky polyline {
  fill: none;
  stroke: color-mix(in srgb, var(--pp-violet) 38%, transparent);
  stroke-width: 1;
  stroke-dasharray: 3 5;
}

.pp-planmap__node {
  position: absolute;
  top: 24px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--pp-violet);
  box-shadow: 0 0 12px var(--pp-glow);
  transform: translateX(-50%);
}

.pp-planmap__node::after {
  content: '';
  position: absolute;
  top: 9px;
  left: 50%;
  width: 0;
  height: 28px;
  border-left: 1px dashed color-mix(in srgb, var(--pp-violet) 30%, transparent);
}

.pp-planmap__node.is-major {
  width: 10px;
  height: 10px;
  box-shadow:
    0 0 16px var(--pp-glow),
    0 0 36px var(--pp-glow);
  animation: pp-twinkle 4s ease-in-out infinite alternate;
}

.pp-planmap__node.is-major::after {
  height: 46px;
}

.pp-plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
  padding-top: 22px;
}

.pp-plan {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 476px;
  padding: 26px;
  border: 1px solid var(--pp-line);
  border-radius: 8px;
  background: var(--pp-panel);
  box-shadow: var(--pp-shadow);
  transition:
    border-color 200ms ease,
    transform 200ms var(--pp-ease),
    box-shadow 200ms ease,
    background-color 0.3s ease;
}

/* 顶部星点：卡片即“星”，推荐方案为最亮的主星 */
.pp-plan::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tone, var(--pp-faint));
  box-shadow: 0 0 12px var(--pp-glow);
  transform: translateX(-50%);
}

.pp-plan__chart {
  pointer-events: none;
  position: absolute;
  top: 20px;
  right: 20px;
  width: 66px;
  height: 34px;
  opacity: 0.5;
}

.pp-plan__chart polyline {
  fill: none;
  stroke: var(--tone, var(--pp-violet));
  stroke-width: 0.8;
  stroke-dasharray: 2 3;
}

.pp-plan__chart circle {
  fill: var(--tone, var(--pp-violet));
}

.pp-plan[data-tone='flexible'] {
  --tone: #7d86a8;
  --tone-soft: rgba(125, 134, 168, 0.14);
}

.pp-plan[data-tone='creator'] {
  --tone: var(--pp-violet);
  --tone-soft: rgba(106, 79, 224, 0.13);
}

.pp-plan[data-tone='studio'] {
  --tone: #2f9d78;
  --tone-soft: rgba(47, 157, 120, 0.13);
}

html.color-scheme-dark .pricing-page .pp-plan[data-tone='studio'] {
  --tone: #8fdcc0;
  --tone-soft: rgba(94, 200, 160, 0.16);
}

.pp-plan:hover {
  transform: translateY(-5px);
  border-color: color-mix(in srgb, var(--pp-violet) 45%, var(--pp-line));
  box-shadow: var(--pp-shadow-hover);
}

.pp-plan--popular {
  margin-top: -20px;
  border-color: color-mix(in srgb, var(--pp-violet) 55%, transparent);
  background:
    radial-gradient(
      ellipse 90% 40% at 50% -8%,
      color-mix(in srgb, var(--pp-violet) 14%, transparent),
      transparent 72%
    ),
    var(--pp-panel);
}

.pp-plan--popular::before {
  width: 12px;
  height: 12px;
  box-shadow:
    0 0 14px var(--pp-glow),
    0 0 34px var(--pp-glow);
}

.pp-plan--popular .pp-plan__chart {
  opacity: 0.72;
}

.pp-plan__popular {
  position: absolute;
  top: 20px;
  left: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pp-warn);
  font-size: 0.76rem;
  font-weight: 700;
}

.pp-plan__popular i {
  font-size: 0.66rem;
}

.pp-plan--popular .pp-plan__eyebrow {
  margin-top: 26px;
}

.pp-plan__eyebrow {
  margin: 0;
  color: var(--tone, var(--pp-violet));
  font-family: var(--pp-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.pp-plan h3 {
  margin: 14px 0 0;
  font-family: var(--pp-serif);
  font-size: 1.62rem;
  font-weight: 620;
  letter-spacing: 0.015em;
}

.pp-plan__description {
  min-height: 70px;
  margin: 12px 0 0;
  color: var(--pp-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.pp-plan__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.pp-plan__price strong {
  color: var(--pp-violet-2);
  font-family: var(--pp-serif);
  font-size: clamp(1.8rem, 2.6vw, 2.4rem);
  font-weight: 650;
}

html.color-scheme-dark .pricing-page .pp-plan__price strong {
  text-shadow: 0 0 26px var(--pp-glow);
}

.pp-plan__price span,
.pp-plan__quota {
  color: var(--pp-muted);
  font-size: 0.82rem;
}

.pp-plan__quota {
  margin: 8px 0 0;
}

.pp-plan__divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0 14px;
  color: color-mix(in srgb, var(--pp-violet) 55%, transparent);
  font-size: 0.6rem;
}

.pp-plan__divider::before,
.pp-plan__divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--pp-line);
}

.pp-plan__includes {
  margin: 0 0 14px;
  color: var(--pp-faint);
  font-size: 0.78rem;
  font-weight: 700;
}

.pp-plan ul {
  flex: 1;
  display: grid;
  align-content: start;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pp-plan li {
  position: relative;
  padding-left: 22px;
  color: var(--pp-ink);
  font-size: 0.86rem;
  line-height: 1.55;
}

.pp-plan li::before {
  content: '✦';
  position: absolute;
  top: 0;
  left: 0;
  color: var(--tone, var(--pp-violet));
  font-size: 0.7rem;
}

.pp-plan__button {
  width: 100%;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
  padding: 0 16px;
  border: 1px dashed var(--pp-line);
  border-radius: 5px;
  color: var(--pp-faint);
  background: var(--pp-panel-2);
  font-family: var(--pp-mono);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.pp-plan__button:disabled {
  cursor: not-allowed;
}

.pp-plan--loading {
  min-height: 476px;
  border: 1px solid var(--pp-line-soft);
  background: linear-gradient(
    105deg,
    var(--pp-panel) 25%,
    var(--pp-panel-2) 44%,
    var(--pp-panel) 63%
  );
  background-size: 300% 100%;
  animation: pp-shimmer 1.4s linear infinite;
}

@keyframes pp-shimmer {
  to {
    background-position: -150% 0;
  }
}

.pp-data-note {
  margin: 22px 0 0;
  color: var(--pp-muted);
  font-size: 0.8rem;
}

/* ————— 02 · 星表 ————— */
.pp-catalog__list {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--pp-line);
  list-style: none;
}

.pp-catalog__list li {
  display: grid;
  grid-template-columns: auto auto minmax(0, auto) minmax(20px, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 16px 10px;
  border-bottom: 1px solid var(--pp-line);
  transition:
    background-color 160ms ease,
    transform 200ms var(--pp-ease);
}

.pp-catalog__list li:hover {
  background: var(--pp-panel-2);
  transform: translateX(5px);
}

.pp-catalog__list li[data-tone='violet'] {
  --tone: #5f45d6;
  --tone-soft: rgba(106, 79, 224, 0.12);
}
.pp-catalog__list li[data-tone='rose'] {
  --tone: #c2506f;
  --tone-soft: rgba(207, 95, 125, 0.12);
}
.pp-catalog__list li[data-tone='cyan'] {
  --tone: #237f9a;
  --tone-soft: rgba(47, 147, 173, 0.12);
}
.pp-catalog__list li[data-tone='green'] {
  --tone: #23825f;
  --tone-soft: rgba(47, 157, 120, 0.12);
}
.pp-catalog__list li[data-tone='amber'] {
  --tone: #a4762f;
  --tone-soft: rgba(192, 138, 62, 0.14);
}
.pp-catalog__list li[data-tone='blue'] {
  --tone: #3a6dbd;
  --tone-soft: rgba(74, 127, 208, 0.12);
}

html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='violet'] {
  --tone: #b6a9ff;
  --tone-soft: rgba(139, 124, 246, 0.16);
}
html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='rose'] {
  --tone: #f0a4bc;
  --tone-soft: rgba(207, 99, 121, 0.2);
}
html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='cyan'] {
  --tone: #8fd4e6;
  --tone-soft: rgba(74, 157, 177, 0.2);
}
html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='green'] {
  --tone: #93dcc0;
  --tone-soft: rgba(74, 165, 139, 0.2);
}
html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='amber'] {
  --tone: #eec089;
  --tone-soft: rgba(195, 139, 61, 0.2);
}
html.color-scheme-dark .pricing-page .pp-catalog__list li[data-tone='blue'] {
  --tone: #a9c6f4;
  --tone-soft: rgba(79, 125, 183, 0.24);
}

.pp-catalog__no {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.pp-catalog__icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--tone) 36%, transparent);
  border-radius: 6px;
  color: var(--tone);
  background: var(--tone-soft);
  transition: box-shadow 200ms ease;
}

.pp-catalog__list li:hover .pp-catalog__icon {
  box-shadow: 0 0 16px color-mix(in srgb, var(--tone) 34%, transparent);
}

.pp-catalog__name {
  min-width: 0;
}

.pp-catalog__name strong {
  display: block;
  overflow: hidden;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pp-catalog__name small {
  display: block;
  margin-top: 3px;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
}

.pp-catalog__leader {
  height: 0;
  border-top: 1px dotted color-mix(in srgb, var(--pp-faint) 55%, transparent);
}

/* 星等条：宽度来自真实单价占最高单价的比例 */
.pp-catalog__mag {
  width: clamp(44px, 9vw, 104px);
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--pp-line-soft);
}

.pp-catalog__mag i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  background: var(--tone);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.75s var(--pp-ease) var(--row-delay, 0ms);
}

.pp-catalog.is-in .pp-catalog__mag i {
  transform: scaleX(var(--mag, 0));
}

.pp-catalog__price {
  margin: 0;
  text-align: right;
  white-space: nowrap;
}

.pp-catalog__price b {
  color: var(--pp-violet-2);
  font-family: var(--pp-mono);
  font-size: 1.02rem;
  letter-spacing: 0.01em;
}

.pp-catalog__price span {
  margin-left: 4px;
  color: var(--pp-faint);
  font-size: 0.72rem;
}

/* ————— 03 · 支付泊位 ————— */
.pp-payment {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(0, 1.15fr);
  gap: clamp(30px, 6vw, 72px);
  align-items: center;
  padding: 34px;
  border: 1px solid var(--pp-line);
  border-radius: 8px;
  background: var(--pp-panel-2);
  box-shadow: var(--pp-shadow);
}

.pp-payment__lede {
  display: block;
  margin-top: 16px;
  color: var(--pp-muted);
  line-height: 1.7;
}

.pp-payment__methods {
  display: grid;
  gap: 12px;
}

.pp-payment__methods article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px 20px;
  border: 1px dashed var(--pp-line);
  border-radius: 6px;
  color: var(--pp-faint);
  background: var(--pp-panel);
  transition:
    border-color 160ms ease,
    background-color 160ms ease;
}

.pp-payment__methods article:hover {
  border-color: color-mix(in srgb, var(--pp-violet) 35%, var(--pp-line));
}

.pp-payment__methods article > i:first-child {
  font-size: 1.4rem;
}

.pp-payment__methods strong {
  display: block;
  color: var(--pp-muted);
}

.pp-payment__methods small {
  display: block;
  margin-top: 3px;
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
}

/* ————— 04 · 常见问题 ————— */
.pp-faq__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.pp-faq details {
  align-self: start;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: var(--pp-panel);
  transition: border-color 160ms ease;
}

.pp-faq details[open] {
  border-color: color-mix(in srgb, var(--pp-violet) 35%, var(--pp-line));
}

.pp-faq summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  cursor: pointer;
  list-style: none;
  transition: color 160ms ease;
}

.pp-faq summary::-webkit-details-marker {
  display: none;
}

.pp-faq__no {
  color: var(--pp-violet);
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

.pp-faq__q {
  font-size: 0.98rem;
  font-weight: 650;
}

.pp-faq summary:hover {
  color: var(--pp-violet);
}

.pp-faq summary > i {
  flex: 0 0 auto;
  color: var(--pp-violet);
  transition: transform 0.2s ease;
}

.pp-faq details[open] summary > i {
  transform: rotate(45deg);
}

.pp-faq details p {
  max-width: 850px;
  margin: -2px 18px 18px;
  color: var(--pp-muted);
  line-height: 1.8;
}

/* ————— 尾声 · 启程 ————— */
.pp-cta {
  position: relative;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 34px;
  overflow: hidden;
  margin-top: clamp(58px, 7vw, 92px);
  padding: 36px;
  border: 1px solid color-mix(in srgb, var(--pp-violet) 40%, var(--pp-line));
  border-radius: 8px;
  background:
    radial-gradient(
      ellipse 70% 120% at 82% -10%,
      color-mix(in srgb, var(--pp-violet) 16%, transparent),
      transparent 70%
    ),
    var(--pp-panel);
  box-shadow: var(--pp-shadow);
}

.pp-cta__stars {
  pointer-events: none;
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1.6px 1.6px at 12% 30%, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2px 2px at 34% 72%, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.4px 1.4px at 56% 20%, var(--pp-star) 50%, transparent 100%),
    radial-gradient(2.2px 2.2px at 78% 56%, var(--pp-star-bright) 50%, transparent 100%),
    radial-gradient(1.4px 1.4px at 92% 26%, var(--pp-star) 50%, transparent 100%);
  opacity: 0.5;
  animation: pp-twinkle 6s ease-in-out infinite alternate;
}

.pp-cta__trail {
  pointer-events: none;
  position: absolute;
  top: 22%;
  right: -8%;
  width: 46%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--pp-violet) 60%, transparent)
  );
  transform: rotate(-14deg);
}

.pp-cta__copy {
  position: relative;
}

.pp-cta__copy h2 {
  max-width: 720px;
  font-size: clamp(1.4rem, 2.7vw, 2.1rem);
}

.pp-cta button {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 22px;
  border: 0;
  border-radius: 5px;
  color: #fff;
  background: var(--pp-violet);
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 0 26px var(--pp-glow);
  transition:
    background-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.pp-cta button:hover {
  background: color-mix(in srgb, var(--pp-violet) 84%, #fff);
  transform: translateY(-1px);
  box-shadow: 0 0 36px var(--pp-glow);
}

/* ————— 可访问性 ————— */
.pp-rail__item:focus-visible,
.pp-switch button:focus-visible,
.pp-console__balance button:focus-visible,
.pp-plan__button:focus-visible,
.pp-faq summary:focus-visible,
.pp-cta button:focus-visible {
  outline: 2px solid var(--pp-violet);
  outline-offset: 2px;
}

/* ————— 响应式 ————— */
@media (max-width: 960px) {
  .pp-hero {
    grid-template-columns: 1fr;
  }
  .pp-planmap__sky {
    display: none;
  }
  .pp-plan-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-top: 0;
  }
  .pp-plan {
    min-height: auto;
  }
  .pp-plan--popular {
    margin-top: 0;
  }
  .pp-plan__description {
    min-height: 0;
  }
  .pp-payment {
    grid-template-columns: 1fr;
    padding: 30px;
  }
}

@media (max-width: 680px) {
  .pricing-shell {
    width: min(100% - 28px, 1240px);
    padding-top: 44px;
  }
  .pp-hero h1 {
    font-size: clamp(2.3rem, 12vw, 3.4rem);
  }
  .pp-metrics > div {
    padding: 14px 10px;
  }
  .pp-metrics > div::before {
    left: 10px;
  }
  .pp-metrics dd {
    font-size: 0.84rem;
  }
  .pp-sec__head {
    align-items: start;
    flex-direction: column;
    gap: 10px;
  }
  .pp-sec__ghost {
    top: -0.3em;
    font-size: clamp(4.2rem, 22vw, 6.4rem);
  }
  .pp-plan-grid {
    grid-template-columns: 1fr;
  }
  .pp-plan {
    padding: 24px 20px;
  }
  .pp-payment {
    padding: 24px 20px;
  }
  .pp-faq__list {
    grid-template-columns: 1fr;
  }
  .pp-cta {
    align-items: start;
    flex-direction: column;
    padding: 26px 22px;
  }
  .pricing-sky__ring {
    right: -48vw;
  }
}

@media (max-width: 480px) {
  .pp-catalog__list li {
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    gap: 12px;
  }
  .pp-catalog__leader,
  .pp-catalog__mag {
    display: none;
  }
}

/* ————— 动画偏好 ————— */
@media (prefers-reduced-motion: reduce) {
  .pricing-sky__nebula,
  .pricing-sky__nebula.is-two,
  .pricing-sky__stars.is-a,
  .pricing-sky__stars.is-b,
  .pricing-sky__ring,
  .pricing-sky__comet,
  .pp-kicker__star,
  .pp-console__orbit,
  .pp-planmap__node.is-major,
  .pp-cta__stars,
  .pp-plan--loading {
    animation: none;
  }
  /* 关闭星野视差：不消费滚动进度 */
  .pricing-sky__nebula,
  .pricing-sky__nebula.is-two,
  .pricing-sky__stars.is-a,
  .pricing-sky__stars.is-b {
    transform: none;
  }
  .pricing-sky__comet {
    opacity: 0;
  }
  [data-reveal] {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .pp-catalog__mag i {
    transform: scaleX(var(--mag, 0));
    transition: none;
  }
  .pp-plan,
  .pp-switch button,
  .pp-rail__name,
  .pp-rail__dot,
  .pp-catalog__list li,
  .pp-payment__methods article,
  .pp-faq summary > i,
  .pp-cta button {
    transition: none;
  }
  .pp-plan:hover,
  .pp-catalog__list li:hover,
  .pp-cta button:hover {
    transform: none;
  }
}

html.settings-no-animations .pricing-page .pricing-sky__nebula,
html.settings-no-animations .pricing-page .pricing-sky__stars,
html.settings-no-animations .pricing-page .pricing-sky__ring,
html.settings-no-animations .pricing-page .pricing-sky__comet,
html.settings-no-animations .pricing-page .pp-kicker__star,
html.settings-no-animations .pricing-page .pp-console__orbit,
html.settings-no-animations .pricing-page .pp-planmap__node.is-major,
html.settings-no-animations .pricing-page .pp-cta__stars,
html.settings-no-animations .pricing-page .pp-plan--loading {
  animation: none;
}

html.settings-no-animations .pricing-page .pricing-sky__nebula,
html.settings-no-animations .pricing-page .pricing-sky__stars {
  transform: none;
}

html.settings-no-animations .pricing-page .pricing-sky__comet {
  opacity: 0;
}

html.settings-no-animations .pricing-page [data-reveal] {
  opacity: 1;
  transform: none;
  transition: none;
}

html.settings-no-animations .pricing-page .pp-catalog__mag i {
  transform: scaleX(var(--mag, 0));
  transition: none;
}
</style>
