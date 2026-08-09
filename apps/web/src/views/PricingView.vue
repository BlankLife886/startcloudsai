<script setup>
/**
 * 价格页：套餐方案 / 模型价格 / 创作单价 / 获取积分 / FAQ。
 * 支付通道未接入时不创建订单；不展示重复额度文案。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'
import { getTaskPricing } from '@/services/metaApi'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { TASK_TYPE_LABELS } from '@/services/tasksApi'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const runtimeConfigStore = useRuntimeConfigStore()
const { availableCents, frozenCents, refreshWalletBalance } = useClientWalletBalance()

const plans = ref([])
const plansLoading = ref(true)
const plansLoadFailed = ref(false)
const pricing = ref(null)
const modelsLoading = ref(true)
const section = ref('plans')
const pageRoot = ref(null)

const sectionTabs = [
  { id: 'plans', label: '套餐方案' },
  { id: 'models', label: '模型价格' },
  { id: 'unit', label: '创作单价' },
  { id: 'pay', label: '获取积分' },
  { id: 'faq', label: '常见问题' },
]

const previewPlans = [
  {
    id: 'preview-usage',
    name: '按量创作',
    eyebrow: '灵活起步',
    description: '无需绑定套餐，按工作台任务单价消耗钱包额度，适合轻量试跑。',
    priceMode: 'unit',
    suffix: '/ 张起',
    features: ['全部 AI 创作工作台', '提交冻结 · 完成结算', '失败或取消自动返还'],
    preview: true,
  },
  {
    id: 'preview-creator',
    name: '创作者计划',
    eyebrow: '持续创作',
    description: '面向持续创作的月度方案。在线支付接入前，可先申请体验资格领取积分。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: ['体验资格领取积分', '覆盖全部图像工作台', '优先体验后续能力'],
    popular: true,
    preview: true,
  },
  {
    id: 'preview-pro',
    name: '专业制作',
    eyebrow: '高频制作',
    description: '面向高频生产与协作场景。正式套餐开放前，可通过反馈提交合作需求。',
    priceMode: 'coming',
    suffix: '/ 月',
    features: ['更高额度预留', '适合批量生产流程', '支持反馈合作需求'],
    preview: true,
  },
]

const taskTypeMeta = {
  t2i: { icon: 'bi-image', tone: 'orange', blurb: '文生图 / 图生图' },
  coloring: { icon: 'bi-palette2', tone: 'rose', blurb: '线稿上色' },
  ui_design: { icon: 'bi-window-sidebar', tone: 'blue', blurb: '界面设计稿' },
  ecommerce_design: { icon: 'bi-bag-check', tone: 'green', blurb: '电商设计' },
  model_sheet: { icon: 'bi-badge-hd', tone: 'teal', blurb: '超高清模型图' },
  game_art: { icon: 'bi-controller', tone: 'violet', blurb: '游戏美术' },
  puzzle: { icon: 'bi-puzzle', tone: 'slate', blurb: '本地拼图工具' },
  background_remove: { icon: 'bi-scissors', tone: 'amber', blurb: '背景移除' },
}

const priceRanges = computed(
  () => pricing.value?.taskPointPriceRanges || pricing.value?.taskPriceRanges || {},
)

const taskPriceCards = computed(() => {
  const values = pricing.value?.taskPointPrices || pricing.value?.taskPrices || {}
  return Object.entries(TASK_TYPE_LABELS).map(([type, label]) => {
    const meta = taskTypeMeta[type] || { icon: 'bi-stars', tone: 'orange', blurb: '' }
    const range = priceRanges.value[type] || {}
    const min =
      Number(range.minPoints ?? range.MinCents ?? range.minCents) ||
      (Object.prototype.hasOwnProperty.call(values, type) ? Number(values[type]) : null)
    const max = Number(range.maxPoints ?? range.MaxCents ?? range.maxCents) || min
    return {
      type,
      label,
      blurb: meta.blurb,
      icon: meta.icon,
      tone: meta.tone,
      minPoints: Number.isFinite(min) ? min : null,
      maxPoints: Number.isFinite(max) ? max : null,
    }
  })
})

const PLACEHOLDER_TEXT = /^(简短说明|暂无描述|description|aaa+|test|todo|placeholder)$/i

const modelCards = computed(() => {
  const catalog = runtimeConfigStore.getAiModelCatalog?.() || {}
  const models = Array.isArray(catalog.publicModels) ? catalog.publicModels : []
  const seen = new Set()
  return models
    .map((model) => {
      const id = String(model?.id || model?.publicModelKey || '').trim()
      if (!id || seen.has(id)) return null
      seen.add(id)
      const points = Number(
        model.pricePoints ??
          model.creditCost ??
          model.priceCents ??
          model.pricing?.points ??
          model.pricing?.cents ??
          0,
      )
      const standard = Number(model.standardPricePoints ?? model.pricing?.standardPoints ?? 0)
      const discount = Number(model.discountPricePoints ?? model.pricing?.discountPoints ?? 0)
      const rawProvider = String(model.providerName || model.provider || '').trim()
      const rawDescription = String(model.description || '').trim()
      return {
        id,
        name: String(model.label || model.name || id),
        provider: PLACEHOLDER_TEXT.test(rawProvider) ? '' : rawProvider,
        description: PLACEHOLDER_TEXT.test(rawDescription) ? '' : rawDescription,
        points: Number.isFinite(points) ? points : 0,
        standard: Number.isFinite(standard) ? standard : 0,
        discount: Number.isFinite(discount) ? discount : 0,
        fastMode: model.fastMode === true,
        isDefault: model.default === true,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name, 'zh'))
})

const displayPlans = computed(() => {
  if (!plans.value.length) return previewPlans
  return plans.value.map((plan) => ({
    ...plan,
    eyebrow: plan.kind === 'subscription' ? '订阅方案' : '额度包',
    description:
      String(plan.description || '').trim() ||
      (plan.kind === 'subscription'
        ? '订阅期内按计划发放创作积分。'
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
    note: '持有兑换码可在钱包直接入账',
    action: '去兑换',
  },
  {
    id: 'trial',
    name: '申请体验资格',
    icon: 'bi-stars',
    note: '填写职业与用途，审核后领取积分',
    action: '立即申请',
  },
  {
    id: 'checkin',
    name: '每日签到',
    icon: 'bi-calendar-check',
    note: '连续签到，每天领取免费创作积分',
    action: '去签到',
  },
]

const faqs = [
  {
    question: '现在怎样获取套餐积分？',
    answer:
      '当前可通过兑换码、体验资格申请和每日签到获取积分。在线支付尚未接入，页面不会创建付款订单。',
  },
  {
    question: '模型价格和创作单价有什么区别？',
    answer:
      '模型价格是具体生图模型的单次积分；创作单价是各工作台任务类型的起步/区间价。实际扣费以提交时选择的模型与工作台为准。',
  },
  {
    question: '任务失败会扣积分吗？',
    answer: '任务提交时冻结额度，成功后结算；失败或取消会释放对应冻结额度。',
  },
  {
    question: '套餐会自动扣款吗？',
    answer: '不会。当前价格只用于展示，支付接口未开放，不会创建订单或自动扣款。',
  },
]

function planPrice(plan) {
  if (plan.priceMode === 'unit') {
    const mins = taskPriceCards.value
      .map((row) => row.minPoints)
      .filter((value) => value !== null && value > 0)
    return mins.length ? `${formatPoints(Math.min(...mins))}起` : '按量计费'
  }
  if (plan.priceMode === 'coming') return '体验申请中'
  return formatCents(plan.priceCents)
}

function planSuffix(plan) {
  if (plan.priceMode === 'coming') return '正式价待开放'
  if (plan.suffix) return plan.suffix
  if (plan.kind === 'subscription') {
    return Number(plan.durationDays || 0) > 0 ? `/ ${plan.durationDays} 天` : '/ 订阅期'
  }
  return '一次性入账'
}

function planQuotaLine(plan) {
  if (plan.preview) return ''
  if (plan.kind === 'subscription') {
    return Number(plan.dailyGrantCents || 0) > 0
      ? `每天发放 ${formatPoints(plan.dailyGrantCents)}`
      : ''
  }
  const total = Number(plan.grantCents || 0) + Number(plan.bonusCents || 0)
  return total > 0 ? `共入账 ${formatPoints(total)}` : ''
}

function planFeatures(plan) {
  if (plan.preview) return plan.features
  const configured = Array.isArray(plan.features) ? plan.features : []
  const cleaned = configured.filter(
    (item) =>
      !/余额\s*[\d.]+\s*元|约\s*\d+\s*张|创作额度|积分入账|发放\s*\d/.test(String(item || '')),
  )
  return cleaned.length ? cleaned : ['全平台创作工具通用', '积分进入个人钱包', '当前不会自动创建订单']
}

function unitPriceLabel(card) {
  if (card.type === 'puzzle') return '永久免费'
  if (card.minPoints === null || !Number.isFinite(card.minPoints)) return '暂不可用'
  if (
    card.maxPoints !== null &&
    Number.isFinite(card.maxPoints) &&
    card.maxPoints > card.minPoints
  ) {
    return `${formatPoints(card.minPoints, { withUnit: false })}–${formatPoints(card.maxPoints)}`
  }
  return formatPoints(card.minPoints)
}

function modelPriceLabel(model) {
  if (!model.points && model.points !== 0) return '未配置'
  return formatPoints(model.points)
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
    query: { ...router.currentRoute.value.query, trial: 'apply' },
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

let sectionObserver = null

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
  await nextTick()
  setupSectionTracking()

  const [plansResult, pricingResult, runtimeResult] = await Promise.allSettled([
    listPlans(),
    getTaskPricing(),
    runtimeConfigStore.loadRuntimeConfig({ force: true }),
  ])
  if (plansResult.status === 'fulfilled') plans.value = plansResult.value.items
  else plansLoadFailed.value = true
  if (pricingResult.status === 'fulfilled') pricing.value = pricingResult.value
  plansLoading.value = false
  modelsLoading.value = false
  void runtimeResult

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
  sectionObserver?.disconnect()
  sectionObserver = null
})
</script>

<template>
  <main ref="pageRoot" class="pp" :class="{ 'is-dark': appearanceStore.isDark }">
    <section class="pp-hero">
      <div class="pp-shell pp-hero__grid">
        <div class="pp-hero__copy">
          <p class="pp-kicker">STARCLOUDS · BILLING</p>
          <h1>创作价格</h1>
          <p>
            按模型与任务清晰计价。提交时冻结，完成后结算；失败或取消自动返还。
          </p>
          <div class="pp-hero__actions">
            <button type="button" class="pp-btn is-primary" @click="goCreate">
              开始创作 <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="pp-btn is-ghost" @click="requestPlanAccess">
              申请体验资格
            </button>
          </div>
        </div>

        <aside class="pp-wallet" aria-label="钱包概览">
          <div class="pp-wallet__top">
            <span>我的钱包</span>
            <em><i class="bi bi-shield-check" aria-hidden="true"></i>安全计费</em>
          </div>
          <template v-if="authStore.isAuthenticated">
            <small>当前可用</small>
            <strong>{{ formatPoints(availableCents) }}</strong>
            <span v-if="frozenCents > 0" class="pp-wallet__frozen">
              {{ formatPoints(frozenCents) }} 任务冻结中
            </span>
          </template>
          <template v-else>
            <small>登录后查看余额</small>
            <strong class="is-muted">—</strong>
            <button type="button" class="pp-btn is-primary is-compact" @click="router.push('/auth')">
              前往登录
            </button>
          </template>
          <p>额度可用于全部 AI 创作工作台，不会自动扣款。</p>
          <RouterLink v-if="authStore.isAuthenticated" class="pp-wallet__link" to="/wallet">
            查看钱包明细 <i class="bi bi-arrow-right" aria-hidden="true"></i>
          </RouterLink>
        </aside>
      </div>
    </section>

    <nav class="pp-nav" aria-label="价格分区">
      <div class="pp-shell pp-nav__inner">
        <button
          v-for="tab in sectionTabs"
          :key="tab.id"
          type="button"
          :class="{ 'is-active': section === tab.id }"
          @click="scrollToSection(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
    </nav>

    <section
      id="pricing-plans"
      class="pp-section"
      data-section="plans"
      aria-labelledby="plans-title"
    >
      <div class="pp-shell">
        <header class="pp-head">
          <div>
            <h2 id="plans-title">套餐方案</h2>
            <p>价格与权益由运营后台配置；当前可申请体验或使用兑换码入账。</p>
          </div>
        </header>

        <div v-if="plansLoading" class="pp-plan-grid" aria-busy="true">
          <article v-for="n in 3" :key="n" class="pp-plan is-loading"></article>
        </div>
        <div v-else class="pp-plan-grid">
          <article
            v-for="plan in displayPlans"
            :key="plan.id"
            class="pp-plan"
            :class="{ 'is-popular': plan.popular }"
          >
            <div class="pp-plan__badge" v-if="plan.badge || plan.popular">
              {{ plan.badge || '推荐' }}
            </div>
            <small>{{ plan.eyebrow }}</small>
            <h3>{{ plan.name }}</h3>
            <p>{{ plan.description }}</p>
            <div class="pp-plan__price">
              <strong>{{ planPrice(plan) }}</strong>
              <span>{{ planSuffix(plan) }}</span>
            </div>
            <b v-if="planQuotaLine(plan)">{{ planQuotaLine(plan) }}</b>
            <ul>
              <li v-for="feature in planFeatures(plan)" :key="feature">
                <i class="bi bi-check2-circle" aria-hidden="true"></i>{{ feature }}
              </li>
            </ul>
            <button type="button" @click="handlePlanAction(plan)">
              {{ planActionLabel(plan) }}
              <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </button>
          </article>
        </div>
        <p v-if="plansLoadFailed" class="pp-note">套餐暂时不可用，已显示预览方案。</p>
      </div>
    </section>

    <section
      id="pricing-models"
      class="pp-section is-soft"
      data-section="models"
      aria-labelledby="models-title"
    >
      <div class="pp-shell">
        <header class="pp-head">
          <div>
            <h2 id="models-title">模型价格</h2>
            <p>各生图模型的单次积分；提交任务时按所选模型结算。</p>
          </div>
          <span v-if="modelCards.length" class="pp-head__meta">{{ modelCards.length }} 个可用模型</span>
        </header>

        <div v-if="modelsLoading" class="pp-model-table" aria-busy="true">
          <div v-for="n in 4" :key="n" class="pp-model-row is-loading"></div>
        </div>
        <div v-else-if="modelCards.length" class="pp-model-table" role="table" aria-label="模型价格表">
          <div class="pp-model-row is-head" role="row">
            <span>模型</span>
            <span>说明</span>
            <span>单价</span>
          </div>
          <article
            v-for="model in modelCards"
            :key="model.id"
            class="pp-model-row"
            :class="{ 'is-default': model.isDefault }"
            role="row"
          >
            <div class="pp-model-row__name">
              <span class="pp-model-row__icon" aria-hidden="true"><i class="bi bi-cpu"></i></span>
              <div>
                <strong>{{ model.name }}</strong>
                <small>
                  <template v-if="model.provider">{{ model.provider }} · </template>
                  <em v-if="model.isDefault">默认</em>
                  <em v-else-if="model.fastMode" class="is-fast">极速</em>
                  <template v-else>标准</template>
                </small>
              </div>
            </div>
            <p>{{ model.description || '按所选模型单次计费，提交时冻结对应积分。' }}</p>
            <div class="pp-model-row__price">
              <b>{{ modelPriceLabel(model) }}</b>
              <span>/ 张</span>
              <small
                v-if="model.standard > 0 && model.discount > 0 && model.discount < model.standard"
              >
                标准 {{ formatPoints(model.standard) }}
              </small>
            </div>
          </article>
        </div>
        <div v-else class="pp-empty">
          <i class="bi bi-cpu" aria-hidden="true"></i>
          <strong>暂无已上架模型价格</strong>
          <p>请稍后在创作台查看可用模型，或联系运营确认模型目录配置。</p>
        </div>
      </div>
    </section>

    <section id="pricing-unit" class="pp-section" data-section="unit" aria-labelledby="unit-title">
      <div class="pp-shell">
        <header class="pp-head">
          <div>
            <h2 id="unit-title">创作单价</h2>
            <p>按工作台任务类型计价；有模型区间时显示最低至最高。</p>
          </div>
        </header>

        <div class="pp-unit-grid">
          <article
            v-for="card in taskPriceCards"
            :key="card.type"
            class="pp-unit"
            :data-tone="card.tone"
          >
            <span class="pp-unit__icon" aria-hidden="true">
              <i class="bi" :class="card.icon"></i>
            </span>
            <div class="pp-unit__copy">
              <strong>{{ card.label }}</strong>
              <small>{{ card.blurb || card.type }}</small>
            </div>
            <div class="pp-unit__price">
              <b>{{ unitPriceLabel(card) }}</b>
              <span v-if="card.type !== 'puzzle' && card.minPoints !== null">/ 张</span>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section id="pricing-pay" class="pp-section is-soft" data-section="pay" aria-labelledby="pay-title">
      <div class="pp-shell">
        <header class="pp-head">
          <div>
            <h2 id="pay-title">获取创作积分</h2>
            <p>在线支付接入前，也可以通过以下方式开始创作。</p>
          </div>
        </header>

        <div class="pp-access">
          <article v-for="(method, index) in accessMethods" :key="method.id">
            <span class="pp-access__step">0{{ index + 1 }}</span>
            <i class="bi" :class="method.icon" aria-hidden="true"></i>
            <div>
              <strong>{{ method.name }}</strong>
              <small>{{ method.note }}</small>
            </div>
            <button type="button" @click="useAccessMethod(method)">
              {{ method.action }}<i class="bi bi-arrow-right" aria-hidden="true"></i>
            </button>
          </article>
        </div>
      </div>
    </section>

    <section id="pricing-faq" class="pp-section" data-section="faq" aria-labelledby="faq-title">
      <div class="pp-shell pp-faq-layout">
        <header class="pp-head is-stack">
          <h2 id="faq-title">常见问题</h2>
          <p>计费规则、积分获取与退款说明。</p>
        </header>
        <div class="pp-faq">
          <details v-for="(item, index) in faqs" :key="item.question" :open="index === 0">
            <summary>
              <span>{{ item.question }}</span>
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
            </summary>
            <p>{{ item.answer }}</p>
          </details>
        </div>
      </div>
    </section>

    <section class="pp-cta">
      <div class="pp-shell pp-cta__inner">
        <div>
          <h2>额度就绪，继续你的创作流程</h2>
          <p>跳转到文生图工作台，按所选模型与任务类型结算。</p>
        </div>
        <div class="pp-cta__actions">
          <button type="button" class="pp-btn is-primary" @click="goCreate">
            开始创作 <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
          </button>
          <button type="button" class="pp-btn is-light" @click="router.push('/wallet')">
            打开钱包
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.pp {
  --ink: #171b22;
  --muted: #6a7384;
  --line: #eadfce;
  --line-soft: #f0e6d8;
  --orange: #ef6a1a;
  --orange-deep: #c45a10;
  --orange-text: #b45309;
  --cream: #fff8ef;
  --bg: #f7f4ef;
  --surface: #ffffff;
  --surface-soft: #fffaf3;
  --surface-warm: #fff7ef;
  --accent-soft: #fff1e2;
  --hero-a: rgb(255 176 96 / 42%);
  --hero-b: rgb(255 214 150 / 34%);
  --hero-c: #fff9f0;
  --hero-d: #ffe9cf;
  --hero-e: #fff6ea;
  --hero-line: #f0e2d0;
  --card-shadow: 0 14px 34px rgb(60 45 20 / 5%);
  --wallet-shadow: 0 18px 40px rgb(90 50 10 / 8%);
  --body: #4a5363;
  --plan-li: #3f4756;
  --plan-note: #9a5a24;
  --muted-strong: #c4c9d2;
  --nav-bg: rgb(247 244 239 / 92%);
  --empty-dash: #e5d8c6;
  width: 100%;
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  overflow-x: clip;
  color: var(--ink);
  background: var(--bg);
}

.pp.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --line: #3b342c;
  --line-soft: #2f2922;
  --orange: #ff8a3d;
  --orange-deep: #ffb06a;
  --orange-text: #ffb06a;
  --cream: #1c1814;
  --bg: #12100e;
  --surface: #1c1915;
  --surface-soft: #181511;
  --surface-warm: #221c16;
  --accent-soft: rgb(255 138 61 / 16%);
  --hero-a: rgb(255 138 61 / 18%);
  --hero-b: rgb(255 176 96 / 12%);
  --hero-c: #1a1511;
  --hero-d: #241c15;
  --hero-e: #17130f;
  --hero-line: #332c24;
  --card-shadow: 0 18px 40px rgb(0 0 0 / 28%);
  --wallet-shadow: 0 18px 40px rgb(0 0 0 / 32%);
  --body: #cfc4b6;
  --plan-li: #ddd2c4;
  --plan-note: #e0a46a;
  --muted-strong: #5a5248;
  --nav-bg: rgb(18 16 14 / 92%);
  --empty-dash: #3b342c;
}

.pp-shell {
  width: min(1180px, calc(100% - 48px));
  margin-inline: auto;
}

.pp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 12px;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 750;
  cursor: pointer;
  text-decoration: none;
}

.pp-btn.is-primary {
  color: #fff;
  background: var(--orange);
  box-shadow: 0 10px 24px rgb(239 106 26 / 22%);
}

.pp-btn.is-primary:hover {
  background: #e05f12;
}

.pp-btn.is-ghost {
  color: var(--orange-text);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  border-color: color-mix(in srgb, var(--orange) 42%, var(--line));
}

.pp.is-dark .pp-btn.is-ghost {
  background: rgb(255 255 255 / 6%);
  border-color: rgb(255 138 61 / 28%);
}

.pp-btn.is-light {
  color: #fff;
  background: rgb(255 255 255 / 16%);
  border-color: rgb(255 255 255 / 24%);
}

.pp-btn.is-compact {
  min-height: 36px;
  width: fit-content;
  padding: 0 14px;
  font-size: 0.78rem;
}

.pp-hero {
  position: relative;
  padding: 36px 0 28px;
  background:
    radial-gradient(circle at 88% 12%, var(--hero-a), transparent 28%),
    radial-gradient(circle at 8% 0%, var(--hero-b), transparent 26%),
    linear-gradient(125deg, var(--hero-c) 0%, var(--hero-d) 46%, var(--hero-e) 100%);
  border-bottom: 1px solid var(--hero-line);
}

.pp-hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
  gap: 22px;
  align-items: stretch;
}

.pp-hero__copy {
  display: grid;
  align-content: center;
  gap: 14px;
  padding: 12px 0;
}

.pp-kicker {
  margin: 0;
  color: var(--orange-deep);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.pp-hero h1 {
  margin: 0;
  font-size: clamp(2.6rem, 5vw, 4rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
}

.pp-hero__copy > p {
  margin: 0;
  max-width: 38ch;
  color: var(--body);
  font-size: 1.02rem;
  line-height: 1.65;
}

.pp-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.pp-wallet {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 24px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--orange) 28%, var(--line));
  border-radius: 22px;
  box-shadow: var(--wallet-shadow);
  backdrop-filter: blur(10px);
}

.pp.is-dark .pp-wallet {
  background: rgb(28 25 21 / 88%);
}

.pp-wallet__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.pp-wallet__top em {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--orange-text);
  background: var(--accent-soft);
  font-style: normal;
  font-size: 0.66rem;
  font-weight: 750;
}

.pp-wallet small {
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.74rem;
}

.pp-wallet strong {
  font-size: 2.1rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
}

.pp-wallet strong.is-muted {
  color: var(--muted-strong);
}

.pp-wallet__frozen {
  width: fit-content;
  padding: 4px 9px;
  border-radius: 8px;
  color: var(--orange-text);
  background: var(--accent-soft);
  font-size: 0.7rem;
  font-weight: 700;
}

.pp-wallet > p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.55;
}

.pp-wallet__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--orange-deep);
  font-size: 0.8rem;
  font-weight: 750;
  text-decoration: none;
}

.pp-nav {
  position: sticky;
  top: var(--app-header-offset, 72px);
  z-index: 20;
  border-bottom: 1px solid var(--line);
  background: var(--nav-bg);
  backdrop-filter: blur(12px);
}

.pp-nav__inner {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0;
}

.pp-nav__inner button {
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.pp-nav__inner button.is-active {
  color: #fff;
  background: var(--orange);
}

.pp.is-dark .pp-nav__inner button.is-active {
  color: #1a120c;
  background: var(--orange);
}

.pp-section {
  padding: 42px 0;
  scroll-margin-top: calc(var(--app-header-offset, 72px) + 56px);
}

.pp-section.is-soft {
  background: var(--surface-soft);
  border-block: 1px solid var(--line-soft);
}

.pp-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 22px;
}

.pp-head.is-stack {
  display: grid;
  gap: 8px;
  margin-bottom: 0;
}

.pp-head h2 {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 1.9rem);
  font-weight: 900;
  letter-spacing: -0.03em;
}

.pp-head p {
  margin: 8px 0 0;
  max-width: 42ch;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.pp-head__meta {
  flex: none;
  padding: 7px 12px;
  border-radius: 999px;
  color: var(--orange-text);
  background: var(--accent-soft);
  font-size: 0.74rem;
  font-weight: 750;
}

.pp-plan-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.pp-plan {
  position: relative;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 420px;
  padding: 28px 24px 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--card-shadow);
}

.pp-plan.is-loading {
  min-height: 280px;
  background: linear-gradient(
    90deg,
    var(--surface) 25%,
    color-mix(in srgb, var(--orange) 12%, var(--surface)) 50%,
    var(--surface) 75%
  );
  background-size: 200% 100%;
  animation: pp-shimmer 1.2s linear infinite;
}

.pp-plan.is-popular {
  border-color: transparent;
  background:
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--orange) 28%, transparent), transparent 40%),
    linear-gradient(180deg, var(--cream) 0%, var(--surface) 55%);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--orange) 55%, var(--line)),
    0 22px 48px rgb(239 106 26 / 14%);
  transform: translateY(-6px);
}

.pp-plan__badge {
  position: absolute;
  top: 18px;
  right: 18px;
  padding: 6px 10px;
  border-radius: 999px;
  color: #fff;
  background: var(--orange);
  font-size: 0.68rem;
  font-weight: 800;
}

.pp-plan > small {
  color: var(--orange-deep);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.pp-plan h3 {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.pp-plan > p {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.6;
  min-height: 4.2em;
}

.pp-plan__price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
}

.pp-plan__price strong {
  font-size: 2rem;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.pp-plan__price span {
  color: var(--muted);
  font-size: 0.78rem;
}

.pp-plan > b {
  color: var(--plan-note);
  font-size: 0.8rem;
  font-weight: 750;
}

.pp-plan ul {
  display: grid;
  gap: 10px;
  margin: 4px 0 0;
  padding: 16px 0 0;
  border-top: 1px solid var(--line-soft);
  list-style: none;
}

.pp-plan li {
  display: flex;
  gap: 8px;
  color: var(--plan-li);
  font-size: 0.84rem;
  line-height: 1.45;
}

.pp-plan li i {
  color: var(--orange);
  margin-top: 1px;
}

.pp-plan > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  margin-top: auto;
  border: 1px solid color-mix(in srgb, var(--orange) 45%, var(--line));
  border-radius: 12px;
  color: var(--orange-deep);
  background: var(--surface-warm);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 800;
  cursor: pointer;
}

.pp-plan.is-popular > button {
  color: #fff;
  border-color: var(--orange);
  background: var(--orange);
}

.pp-model-table {
  display: grid;
  gap: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: var(--card-shadow);
}

.pp-model-row {
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(0, 1.3fr) 160px;
  gap: 18px;
  align-items: center;
  padding: 18px 22px;
  border-top: 1px solid var(--line-soft);
}

.pp-model-row.is-head {
  border-top: 0;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 0.74rem;
  font-weight: 750;
}

.pp-model-row.is-loading {
  min-height: 78px;
  background: linear-gradient(
    90deg,
    var(--surface) 25%,
    color-mix(in srgb, var(--orange) 12%, var(--surface)) 50%,
    var(--surface) 75%
  );
  background-size: 200% 100%;
  animation: pp-shimmer 1.2s linear infinite;
}

.pp-model-row.is-default {
  background: var(--surface-soft);
}

.pp-model-row__name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.pp-model-row__icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  color: var(--orange-deep);
  background: var(--accent-soft);
  font-size: 1.1rem;
}

.pp-model-row__name strong {
  display: block;
  font-size: 0.98rem;
  font-weight: 850;
}

.pp-model-row__name small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.72rem;
}

.pp-model-row__name em {
  font-style: normal;
  font-weight: 750;
  color: var(--orange-deep);
}

.pp-model-row__name em.is-fast {
  color: #38bdf8;
}

.pp:not(.is-dark) .pp-model-row__name em.is-fast {
  color: #0369a1;
}

.pp-model-row > p {
  margin: 0;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

.pp-model-row__price {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.pp-model-row__price b {
  font-size: 1.2rem;
  font-weight: 900;
}

.pp-model-row__price span,
.pp-model-row__price small {
  color: var(--muted);
  font-size: 0.72rem;
}

.pp-unit-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.pp-unit {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
  min-height: 118px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
}

.pp-unit__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 14px;
  color: var(--orange-deep);
  background: var(--accent-soft);
  font-size: 1.15rem;
}

.pp-unit[data-tone='rose'] .pp-unit__icon {
  color: #db2777;
  background: #fce7f3;
}
.pp-unit[data-tone='blue'] .pp-unit__icon {
  color: #2563eb;
  background: #dbeafe;
}
.pp-unit[data-tone='green'] .pp-unit__icon {
  color: #059669;
  background: #d1fae5;
}
.pp-unit[data-tone='teal'] .pp-unit__icon {
  color: #0d9488;
  background: #ccfbf1;
}
.pp-unit[data-tone='violet'] .pp-unit__icon {
  color: #7c3aed;
  background: #ede9fe;
}
.pp-unit[data-tone='slate'] .pp-unit__icon {
  color: #475569;
  background: #e2e8f0;
}
.pp-unit[data-tone='amber'] .pp-unit__icon {
  color: #d97706;
  background: #fef3c7;
}

.pp.is-dark .pp-unit[data-tone='rose'] .pp-unit__icon {
  color: #f9a8d4;
  background: rgb(219 39 119 / 18%);
}
.pp.is-dark .pp-unit[data-tone='blue'] .pp-unit__icon {
  color: #93c5fd;
  background: rgb(37 99 235 / 18%);
}
.pp.is-dark .pp-unit[data-tone='green'] .pp-unit__icon {
  color: #6ee7b7;
  background: rgb(5 150 105 / 18%);
}
.pp.is-dark .pp-unit[data-tone='teal'] .pp-unit__icon {
  color: #5eead4;
  background: rgb(13 148 136 / 18%);
}
.pp.is-dark .pp-unit[data-tone='violet'] .pp-unit__icon {
  color: #c4b5fd;
  background: rgb(124 58 237 / 18%);
}
.pp.is-dark .pp-unit[data-tone='slate'] .pp-unit__icon {
  color: #cbd5e1;
  background: rgb(71 85 105 / 22%);
}
.pp.is-dark .pp-unit[data-tone='amber'] .pp-unit__icon {
  color: #fcd34d;
  background: rgb(217 119 6 / 18%);
}

.pp-unit__copy strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 850;
}

.pp-unit__copy small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.72rem;
}

.pp-unit__price {
  display: flex;
  align-items: baseline;
  gap: 5px;
  grid-column: 2;
}

.pp-unit__price b {
  font-size: 1.05rem;
  font-weight: 900;
}

.pp-unit__price span {
  color: var(--muted);
  font-size: 0.7rem;
}

.pp-access {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.pp-access > article {
  display: grid;
  grid-template-columns: auto 44px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
}

.pp-access__step {
  grid-row: 1 / span 2;
  color: color-mix(in srgb, var(--orange) 70%, #fff);
  font-size: 1.4rem;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.pp-access > article > i {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 14px;
  color: var(--orange-deep);
  background: var(--accent-soft);
  font-size: 1.2rem;
}

.pp-access strong {
  display: block;
  font-size: 1rem;
  font-weight: 850;
}

.pp-access small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.76rem;
  line-height: 1.45;
}

.pp-access button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  grid-column: 2 / -1;
  min-height: 40px;
  margin-top: 4px;
  border: 0;
  border-radius: 11px;
  color: #fff;
  background: var(--orange);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 800;
  cursor: pointer;
}

.pp-faq-layout {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.3fr);
  gap: 28px;
  align-items: start;
}

.pp-faq {
  display: grid;
  gap: 10px;
}

.pp-faq details {
  padding: 0 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
}

.pp-faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 58px;
  cursor: pointer;
  list-style: none;
  font-size: 0.95rem;
  font-weight: 800;
}

.pp-faq summary::-webkit-details-marker {
  display: none;
}

.pp-faq summary i {
  color: var(--muted);
  transition: transform 160ms ease;
}

.pp-faq details[open] summary i {
  transform: rotate(45deg);
  color: var(--orange);
}

.pp-faq p {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.7;
}

.pp-cta {
  padding: 36px 0 48px;
  background:
    radial-gradient(circle at 90% 0%, rgb(255 170 90 / 35%), transparent 30%),
    linear-gradient(120deg, #2a2118 0%, #3b2a1c 48%, #1f1812 100%);
  color: #fff;
}

.pp-cta__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.pp-cta h2 {
  margin: 0;
  font-size: clamp(1.4rem, 2.4vw, 1.9rem);
  font-weight: 900;
  letter-spacing: -0.03em;
}

.pp-cta p {
  margin: 8px 0 0;
  color: rgb(255 255 255 / 68%);
  font-size: 0.88rem;
}

.pp-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pp-note {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 0.8rem;
}

.pp-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 48px 20px;
  border: 1px dashed var(--empty-dash);
  border-radius: 20px;
  background: var(--surface);
  text-align: center;
}

.pp-empty i {
  color: var(--orange);
  font-size: 1.6rem;
}

.pp-empty strong {
  font-size: 1rem;
}

.pp-empty p {
  margin: 0;
  max-width: 36ch;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

@keyframes pp-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 1100px) {
  .pp-plan-grid,
  .pp-unit-grid,
  .pp-access {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pp-plan.is-popular {
    transform: none;
  }
}

@media (max-width: 900px) {
  .pp-shell {
    width: calc(100% - 28px);
  }

  .pp-hero__grid,
  .pp-faq-layout,
  .pp-cta__inner {
    grid-template-columns: 1fr;
    display: grid;
  }

  .pp-model-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .pp-model-row.is-head {
    display: none;
  }

  .pp-model-row__price {
    justify-items: start;
  }
}

@media (max-width: 640px) {
  .pp-plan-grid,
  .pp-unit-grid,
  .pp-access {
    grid-template-columns: 1fr;
  }

  .pp-access > article {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .pp-access__step {
    display: none;
  }

  .pp-access button {
    grid-column: 1 / -1;
  }

  .pp-hero {
    padding-top: 24px;
  }

  .pp-cta__actions .pp-btn {
    width: 100%;
  }
}
</style>
