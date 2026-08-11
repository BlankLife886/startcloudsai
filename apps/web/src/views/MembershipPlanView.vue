<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'

const router = useRouter()
const appearanceStore = useAppearanceStore()
const loading = ref(true)
const loadError = ref('')
const catalog = ref([])
const paymentEnabled = ref(false)

const previewPlans = [
  {
    id: 'trial',
    name: '体验版',
    subtitle: '适合初次体验的你',
    icon: 'bi-gem',
    price: '¥0',
    period: '/ 永久',
    features: ['基础功能访问', '标准内容浏览', '社区支持'],
    action: '当前计划',
    target: 'create',
    current: true,
  },
  {
    id: 'basic',
    name: '基础版',
    subtitle: '满足日常使用需求',
    icon: 'bi-tree-fill',
    price: '¥28',
    period: '/ 月',
    features: ['基础功能全部开放', '高清内容浏览', '优先客服支持'],
    action: '选择此计划',
    target: 'trial',
  },
  {
    id: 'premium',
    name: '高级版',
    subtitle: '畅享更多专属权益',
    icon: 'bi-star-fill',
    price: '¥68',
    period: '/ 月',
    yearly: '¥680 / 年（省 17%）',
    features: ['全部高级功能', '独家内容与资源', '专属客服支持', '无广告体验'],
    action: '选择此计划',
    target: 'trial',
    recommended: true,
  },
  {
    id: 'pro',
    name: '专业版',
    subtitle: '为高效人士打造',
    icon: 'bi-award-fill',
    price: '¥128',
    period: '/ 月',
    yearly: '¥1280 / 年（省 17%）',
    features: ['包含高级版所有权益', '团队协作功能', '数据分析报表', 'API 访问权限'],
    action: '选择此计划',
    target: 'trial',
  },
  {
    id: 'enterprise',
    name: '企业版',
    subtitle: '满足企业需求',
    icon: 'bi-gem',
    price: '定制价格',
    period: '',
    yearly: '联系销售获取报价',
    features: ['包含专业版所有权益', '专属解决方案', '私有化部署', '7×24 小时支持'],
    action: '联系销售',
    target: 'feedback',
  },
]

const displayPlans = computed(() => {
  if (!catalog.value.length) return previewPlans
  return catalog.value.map((plan) => ({
    ...plan,
    id: plan.id || plan.code,
    subtitle: plan.description || (plan.kind === 'subscription' ? '周期会员方案' : '创作积分方案'),
    icon: plan.kind === 'subscription' ? 'bi-star-fill' : 'bi-gem',
    price: formatCents(plan.priceCents),
    period: plan.kind === 'subscription' ? `/ ${plan.durationDays || 30} 天` : '一次性',
    features:
      Array.isArray(plan.features) && plan.features.length
        ? plan.features
        : [
            `发放 ${formatPoints(Number(plan.grantCents || 0) + Number(plan.bonusCents || 0))}`,
            '全平台创作工具通用',
          ],
    action: paymentEnabled.value ? '选择此计划' : '申请体验',
    target: 'trial',
    recommended: plan.recommended === true,
  }))
})

const planCount = computed(() => displayPlans.value.length)
const recommendedPlan = computed(() => displayPlans.value.find((plan) => plan.recommended) || null)
const accessLabel = computed(() => (paymentEnabled.value ? '在线开通' : '申请体验'))

const tips = [
  { icon: 'bi-shield-check', title: '安全可靠', copy: '数据加密存储，隐私有保障' },
  { icon: 'bi-arrow-repeat', title: '灵活自由', copy: '随时升级、降级或取消' },
  { icon: 'bi-headset', title: '优质支持', copy: '专业团队，快速响应' },
]

async function loadPlans() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await listPlans()
    catalog.value = result.items
    paymentEnabled.value = result.paymentEnabled
  } catch (error) {
    loadError.value = error?.message || '会员计划读取失败'
  } finally {
    loading.value = false
  }
}

function usePlan(plan) {
  if (plan.target === 'create') {
    router.push('/text-to-image')
    return
  }
  if (plan.target === 'feedback') {
    router.push('/feedback')
    return
  }
  router.push({ path: '/pricing', query: { trial: 'apply' } })
}

function goBack() {
  const canGoBack =
    typeof window !== 'undefined' &&
    window.history.length > 1 &&
    Boolean(window.history.state?.back)
  if (canGoBack) router.back()
  else router.push('/incentive-plans')
}

onMounted(loadPlans)
</script>

<template>
  <main class="membership-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <header class="membership-top">
      <div class="membership-shell membership-top__inner">
        <button type="button" class="membership-back" @click="goBack">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          返回
        </button>
        <div class="membership-top__copy">
          <h1>会员计划</h1>
          <p>查看会员周期、积分供给与专属权益，按需选择并随时调整。</p>
        </div>
        <div class="membership-facts" aria-label="会员概览">
          <span>
            <i class="bi bi-collection"></i>{{ loading ? '—' : planCount }} 档方案
          </span>
          <span>
            <i class="bi bi-star"></i>推荐 {{ loading ? '—' : recommendedPlan?.name || '—' }}
          </span>
          <span>
            <i class="bi bi-shield-check"></i>{{ loading ? '—' : accessLabel }}
          </span>
        </div>
      </div>
    </header>

    <section class="membership-shell membership-workspace" aria-label="会员方案对比">
      <div class="workspace-heading">
        <div>
          <strong>选择适合你的方案</strong>
          <small>解锁专属权益，随时升级或取消。</small>
        </div>
        <button v-if="loadError" type="button" class="text-action" @click="loadPlans">
          <i class="bi bi-arrow-clockwise"></i>重新加载
        </button>
      </div>

      <div v-if="loading" class="membership-loading" aria-live="polite">
        <span></span><span></span><span></span>
        <p>正在读取会员方案…</p>
      </div>

      <div v-else-if="loadError" class="membership-empty-state">
        <i class="bi bi-exclamation-circle"></i>
        <h2>暂时无法读取会员计划</h2>
        <p>{{ loadError }}</p>
      </div>

      <div v-else class="plan-grid">
        <article
          v-for="plan in displayPlans"
          :key="plan.id"
          class="plan-card"
          :class="{ 'is-recommended': plan.recommended, 'is-current': plan.current }"
        >
          <span v-if="plan.recommended" class="plan-badge">推荐</span>
          <span v-else-if="plan.current" class="plan-badge is-current">当前</span>
          <span class="plan-card__icon"><i class="bi" :class="plan.icon"></i></span>
          <h3>{{ plan.name }}</h3>
          <p>{{ plan.subtitle }}</p>
          <div class="plan-card__pricing">
            <div class="plan-card__price">
              <strong>{{ plan.price }}</strong>
              <span>{{ plan.period || '' }}</span>
            </div>
            <small v-if="plan.yearly">{{ plan.yearly }}</small>
          </div>
          <ul>
            <li v-for="feature in plan.features" :key="feature">
              <i class="bi bi-check2" aria-hidden="true"></i>{{ feature }}
            </li>
          </ul>
          <button type="button" @click="usePlan(plan)">
            {{ plan.current ? '当前计划' : plan.action }}
          </button>
        </article>
      </div>
    </section>

    <footer class="membership-tips" aria-label="会员服务说明">
      <div class="membership-shell">
        <ol class="tip-list">
          <li v-for="item in tips" :key="item.title">
            <i class="bi" :class="item.icon" aria-hidden="true"></i>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.copy }}</p>
            </div>
          </li>
        </ol>
      </div>
    </footer>
  </main>
</template>

<style scoped>
:global(.app-container > .main-content:has(> .membership-page)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.membership-page {
  --ink: #17171f;
  --body: #4f5160;
  --muted: #777785;
  --accent: #6d5cff;
  --accent-deep: #5746e5;
  --accent-soft: rgb(109 92 255 / 10%);
  --accent-hover: #4f3fe0;
  --surface: #ffffff;
  --surface-soft: #f6f5fc;
  --line: rgb(21 22 31 / 10%);
  --hero: #f4f3fa;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100dvh;
  max-height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink);
  background: var(--surface);
}

.membership-page.is-dark {
  --ink: rgba(255, 255, 255, 0.96);
  --body: rgb(255 255 255 / 72%);
  --muted: rgb(255 255 255 / 52%);
  --accent: #8b7bff;
  --accent-deep: #a99cff;
  --accent-soft: rgb(109 92 255 / 16%);
  --accent-hover: #9d8fff;
  --surface: #121218;
  --surface-soft: #1a1824;
  --line: rgb(255 255 255 / 10%);
  --hero: #161422;
}

.membership-shell {
  width: min(1100px, calc(100% - 40px));
  margin-inline: auto;
}

.membership-top {
  --hero-pad-top: calc(var(--app-header-offset, 72px) + var(--app-page-content-top-gap, 0px));
  flex: 0 0 auto;
  margin-top: calc(-1 * var(--hero-pad-top));
  padding: calc(var(--hero-pad-top) + 10px) 0 14px;
  background:
    radial-gradient(circle at 92% 0%, rgb(109 92 255 / 16%), transparent 36%),
    linear-gradient(145deg, var(--hero) 0%, color-mix(in srgb, var(--accent) 6%, var(--hero)) 100%);
  border-bottom: 1px solid var(--line);
}

.membership-top__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}

.membership-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  color: var(--body);
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.membership-back:hover {
  color: var(--accent);
}

.membership-top__copy h1 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 840;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.membership-top__copy p {
  margin: 4px 0 0;
  color: var(--body);
  font-size: 0.84rem;
  line-height: 1.4;
}

.membership-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.membership-facts span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 720;
}

.membership-facts i {
  color: var(--accent);
}

.membership-workspace {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 14px 0 10px;
  overflow: hidden;
}

.workspace-heading {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.workspace-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.workspace-heading strong {
  font-size: 0.86rem;
}

.workspace-heading small {
  color: var(--body);
  font-size: 0.76rem;
}

.text-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  color: var(--accent);
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 720;
  cursor: pointer;
}

.membership-loading,
.membership-empty-state {
  display: flex;
  min-height: 180px;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.membership-loading {
  flex-wrap: wrap;
  gap: 7px;
  color: var(--body);
}

.membership-loading span {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: membership-pulse 1s infinite alternate;
}

.membership-loading span:nth-child(2) {
  animation-delay: 0.2s;
}

.membership-loading span:nth-child(3) {
  animation-delay: 0.4s;
}

.membership-loading p {
  width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 0.82rem;
}

@keyframes membership-pulse {
  to {
    opacity: 0.25;
    transform: translateY(-4px);
  }
}

.membership-empty-state {
  flex-direction: column;
  color: var(--body);
  text-align: center;
}

.membership-empty-state i {
  color: var(--accent);
  font-size: 1.6rem;
}

.membership-empty-state h2 {
  margin: 10px 0 0;
  color: var(--ink);
  font-size: 1.1rem;
}

.membership-empty-state p {
  margin: 6px 0 0;
  font-size: 0.84rem;
}

.plan-grid {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-auto-flow: column;
  grid-auto-columns: minmax(196px, 1fr);
  gap: 12px;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.plan-card {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 16px 14px 12px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
}

.plan-card.is-current {
  background: var(--surface-soft);
  border-color: color-mix(in srgb, var(--accent) 22%, var(--line));
}

.plan-card.is-recommended {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line));
  box-shadow: 0 8px 20px rgb(109 92 255 / 12%);
}

.plan-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 8px;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 780;
  letter-spacing: 0.02em;
}

.plan-badge.is-current {
  color: var(--accent-deep);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
}

.plan-card__icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line));
  border-radius: 10px;
  font-size: 1rem;
}

.plan-card h3 {
  margin: 10px 0 2px;
  padding-right: 44px;
  font-size: 0.98rem;
  font-weight: 820;
  line-height: 1.25;
}

.plan-card > p {
  min-height: 1.35em;
  margin: 0;
  color: var(--body);
  font-size: 0.72rem;
  line-height: 1.4;
}

.plan-card__pricing {
  display: flex;
  min-height: 52px;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  margin-top: 8px;
}

.plan-card__price {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.plan-card__price strong {
  color: var(--accent-deep);
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.plan-card__price span {
  color: var(--muted);
  font-size: 0.72rem;
}

.plan-card__pricing > small {
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.35;
}

.plan-card ul {
  display: grid;
  gap: 5px;
  margin: 0 0 10px;
  padding: 10px 0 0;
  border-top: 1px solid var(--line);
  list-style: none;
  overflow: hidden;
}

.plan-card li {
  display: flex;
  gap: 6px;
  color: var(--body);
  font-size: 0.72rem;
  line-height: 1.35;
}

.plan-card li i {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
  font-size: 0.82rem;
}

.plan-card > button {
  width: 100%;
  min-height: 36px;
  margin-top: auto;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 9px;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 750;
  cursor: pointer;
}

.plan-card > button:hover {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
}

.plan-card.is-current > button {
  color: var(--accent-deep);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 28%, var(--line));
}

.plan-card.is-recommended > button {
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  border-color: transparent;
  box-shadow: 0 6px 14px rgb(109 92 255 / 18%);
}

.plan-card.is-recommended > button:hover {
  background: var(--accent-hover);
}

.membership-tips {
  flex: 0 0 auto;
  padding: 10px 0 14px;
  background: var(--surface-soft);
  border-top: 1px solid var(--line);
}

.tip-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tip-list li {
  display: flex;
  min-width: 0;
  gap: 10px;
}

.tip-list i {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  border-radius: 50%;
  font-size: 0.72rem;
}

.tip-list strong {
  display: block;
  font-size: 0.78rem;
}

.tip-list p {
  margin: 3px 0 0;
  color: var(--body);
  font-size: 0.7rem;
  line-height: 1.4;
}

@media (max-width: 960px) {
  :global(.app-container > .main-content:has(> .membership-page)) {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .membership-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .membership-top__inner {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .membership-facts {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .membership-workspace {
    overflow: visible;
  }

  .plan-grid {
    grid-auto-flow: row;
    grid-auto-columns: unset;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }

  .tip-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .membership-shell {
    width: calc(100% - 28px);
  }

  .membership-top__inner {
    gap: 10px;
  }

  .membership-top__copy h1 {
    font-size: 1.3rem;
  }

  .plan-grid {
    grid-template-columns: 1fr;
  }

  .tip-list {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .membership-loading span {
    animation: none;
  }
}
</style>
