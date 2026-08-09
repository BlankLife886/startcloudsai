<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'
import crownArt from '@/assets/incentives/membership-crown.png'

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
    tone: 'blue',
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
    tone: 'green',
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
    tone: 'orange',
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
    tone: 'violet',
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
    tone: 'gold',
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
  return catalog.value.map((plan, index) => ({
    ...plan,
    id: plan.id || plan.code,
    subtitle: plan.description || (plan.kind === 'subscription' ? '周期会员方案' : '创作积分方案'),
    icon: plan.kind === 'subscription' ? 'bi-star-fill' : 'bi-gem',
    tone: ['blue', 'green', 'orange', 'violet', 'gold'][index % 5],
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

onMounted(loadPlans)
</script>

<template>
  <main class="membership-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <section class="membership-hero">
      <div class="membership-hero__copy">
        <h1>选择适合你的<br /><strong>会员计划</strong></h1>
        <span>解锁专属权益，享受更优质的服务体验<br />随时升级或取消，灵活无忧</span>
        <div class="membership-hero__social">
          <span class="hero-avatars" aria-hidden="true">
            <i class="bi bi-person-fill"></i><i class="bi bi-person-fill"></i
            ><i class="bi bi-person-fill"></i>
          </span>
          <small>已有 98,352 位用户加入</small>
        </div>
      </div>

      <div class="membership-hero__offer">
        <span><i class="bi bi-fire"></i>限时优惠</span>
        <strong>年付最高可省 <em>17%</em></strong>
        <small>优惠活动将于 7 天后结束</small>
      </div>

      <div class="membership-hero__asset" aria-hidden="true">
        <img :src="crownArt" alt="" loading="lazy" />
      </div>
    </section>

    <section class="plans-section" aria-label="会员方案对比">
      <div v-if="loading" class="plans-loading" aria-live="polite">
        <span></span><span></span><span></span>
      </div>
      <div v-else class="plan-grid">
        <article
          v-for="plan in displayPlans"
          :key="plan.id"
          class="plan-card"
          :class="{ 'is-recommended': plan.recommended, 'is-current': plan.current }"
          :data-tone="plan.tone"
        >
          <em v-if="plan.recommended">最受欢迎</em>
          <span class="plan-card__icon"><i class="bi" :class="plan.icon"></i></span>
          <h2>{{ plan.name }}</h2>
          <p>{{ plan.subtitle }}</p>
          <div class="plan-card__pricing">
            <div class="plan-card__price">
              <strong>{{ plan.price }}</strong
              ><span>{{ plan.period || '' }}</span>
            </div>
            <small v-if="plan.yearly">{{ plan.yearly }}</small>
          </div>
          <ul>
            <li v-for="feature in plan.features" :key="feature">
              <i class="bi bi-check-circle-fill"></i>{{ feature }}
            </li>
          </ul>
          <button type="button" @click="usePlan(plan)">
            {{ plan.current ? '当前计划' : plan.action }}
          </button>
        </article>
      </div>
      <button v-if="loadError" type="button" class="plans-retry" @click="loadPlans">
        套餐读取失败，重新加载
      </button>
    </section>

    <section class="membership-assurances" aria-label="会员服务保障">
      <div>
        <i class="bi bi-shield-check"></i
        ><span><strong>安全可靠</strong><small>数据加密存储，隐私有保障</small></span>
      </div>
      <div>
        <i class="bi bi-arrow-repeat"></i
        ><span><strong>灵活自由</strong><small>随时升级、降级或取消</small></span>
      </div>
      <div>
        <i class="bi bi-headset"></i
        ><span><strong>优质支持</strong><small>专业团队，快速响应</small></span>
      </div>
      <div>
        <i class="bi bi-gift"></i
        ><span><strong>会员专享</strong><small>定期福利与专属活动</small></span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.membership-page {
  --ink: #1f2430;
  --muted: #7b8798;
  --orange: #f27021;
  --orange-deep: #e2620f;
  --orange-text: #d4520f;
  --soft-orange: #ffe9d2;
  --line: #e7eaf0;
  --line-soft: #edf0f4;
  --bg: #f7f6f4;
  --surface: #ffffff;
  --surface-soft: #fffaf4;
  --surface-warm: #fff8ee;
  --hero-a: rgb(255 205 130 / 38%);
  --hero-b: rgb(255 226 190 / 45%);
  --hero-c: #fffefc;
  --hero-d: #fff8ee;
  --hero-e: #ffedd6;
  --hero-line: #f4ecdf;
  --offer-line: #f0e2cd;
  --body: #52617a;
  --social: #6c7889;
  --avatar-border: #ffffff;
  --card-border: #e7eaf0;
  --card-shadow: 0 9px 24px rgb(31 48 75 / 8%);
  --recommended-border: #f0a45c;
  --recommended-shadow: 0 16px 34px rgb(225 113 28 / 16%);
  --plan-li: #455267;
  --plan-note: #97a1b0;
  --assurance-line: #eadfd3;
  --assurance-border: #f2e8dc;
  --error: #b64d16;
  width: 100%;
  min-width: 1180px;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 0 0 18px;
  color: var(--ink);
  background: var(--bg);
}

.membership-page.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --orange: #ff8a3d;
  --orange-deep: #ffb06a;
  --orange-text: #ffb06a;
  --soft-orange: rgb(255 138 61 / 16%);
  --line: #3b342c;
  --line-soft: #2f2922;
  --bg: #12100e;
  --surface: #1c1915;
  --surface-soft: #221c16;
  --surface-warm: #181511;
  --hero-a: rgb(255 138 61 / 18%);
  --hero-b: rgb(255 176 96 / 12%);
  --hero-c: #1a1511;
  --hero-d: #241c15;
  --hero-e: #17130f;
  --hero-line: #332c24;
  --offer-line: #332c24;
  --body: #cfc4b6;
  --social: #a79c8f;
  --avatar-border: #1c1915;
  --card-border: #3b342c;
  --card-shadow: 0 18px 40px rgb(0 0 0 / 28%);
  --recommended-border: #ff8a3d;
  --recommended-shadow: 0 16px 34px rgb(0 0 0 / 32%);
  --plan-li: #ddd2c4;
  --plan-note: #a79c8f;
  --assurance-line: #3b342c;
  --assurance-border: #332c24;
  --error: #e0a46a;
}

.membership-hero {
  display: grid;
  width: calc(100% - 40px);
  min-height: 320px;
  grid-template-columns: minmax(460px, 1fr) 320px minmax(460px, 1fr);
  align-items: center;
  margin: 0 auto;
  overflow: hidden;
  background:
    radial-gradient(circle at 88% 0%, var(--hero-a), transparent 42%),
    radial-gradient(circle at 62% 100%, var(--hero-b), transparent 40%),
    linear-gradient(103deg, var(--hero-c) 0%, var(--hero-d) 52%, var(--hero-e) 100%);
  border: 1px solid var(--hero-line);
  border-radius: 8px;
}

.membership-hero__copy {
  padding: 36px 32px 32px 58px;
}
.membership-hero h1 {
  margin: 0;
  font-size: 46px;
  font-weight: 850;
  line-height: 1.14;
  letter-spacing: 0;
}
.membership-hero h1 strong {
  color: var(--orange);
}
.membership-hero__copy > span {
  display: block;
  max-width: 520px;
  margin-top: 18px;
  color: var(--body);
  font-size: 14px;
  line-height: 1.75;
}
.membership-hero__social {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-top: 22px;
}
.hero-avatars {
  display: inline-flex;
}
.hero-avatars i {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: #fff;
  background: linear-gradient(140deg, #f7b267, #ef7b45);
  border: 2px solid var(--avatar-border);
  border-radius: 50%;
  font-size: 15px;
}
.hero-avatars i:nth-child(2) {
  margin-left: -9px;
  background: linear-gradient(140deg, #7fb5f2, #4d7fe0);
}
.hero-avatars i:nth-child(3) {
  margin-left: -9px;
  background: linear-gradient(140deg, #62d3a4, #2ba374);
}
.membership-hero__social small {
  color: var(--social);
  font-size: 12px;
}

.membership-hero__offer {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  padding-left: 30px;
  border-left: 1px solid var(--offer-line);
}
.membership-hero__offer > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  color: var(--orange-text);
  background: var(--soft-orange);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}
.membership-hero__offer strong {
  margin-top: 18px;
  font-size: 21px;
  font-weight: 800;
}
.membership-hero__offer strong em {
  color: var(--orange);
  font-size: 27px;
  font-style: normal;
  font-weight: 900;
}
.membership-hero__offer small {
  margin-top: 9px;
  color: var(--muted);
  font-size: 12px;
}

.membership-hero__asset {
  display: grid;
  height: 100%;
  align-items: end;
  justify-items: center;
}
.membership-hero__asset img {
  width: min(100%, 470px);
  mix-blend-mode: multiply;
}
.membership-page.is-dark .membership-hero__asset img {
  mix-blend-mode: normal;
}

.plans-section {
  position: relative;
  width: calc(100% - 80px);
  margin: 22px auto 0;
}
.plans-loading {
  display: flex;
  height: 464px;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.plans-loading span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--orange);
}
.plan-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 18px;
}
.plan-card {
  --tone: #2476ea;
  position: relative;
  display: flex;
  min-height: 470px;
  flex-direction: column;
  padding: 27px 25px 22px;
  background: var(--surface);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  box-shadow: var(--card-shadow);
}
.plan-card[data-tone='green'] {
  --tone: #19ad72;
}
.plan-card[data-tone='orange'] {
  --tone: #f07a19;
}
.membership-page.is-dark .plan-card[data-tone='orange'] {
  --tone: #ff8a3d;
}
.plan-card[data-tone='violet'] {
  --tone: #8957df;
}
.plan-card[data-tone='gold'] {
  --tone: #d99a24;
}
.plan-card.is-recommended {
  border-color: var(--recommended-border);
  box-shadow: var(--recommended-shadow);
}
.plan-card > em {
  position: absolute;
  top: -1px;
  right: -1px;
  padding: 8px 17px;
  color: #fff;
  background: var(--orange);
  border-radius: 0 10px 0 18px;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
}
.plan-card__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 11%, var(--surface));
  border-radius: 14px;
  font-size: 22px;
}
.plan-card h2 {
  margin: 18px 0 5px;
  font-size: 22px;
  letter-spacing: 0;
}
.plan-card > p {
  min-height: 20px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.plan-card__pricing {
  display: flex;
  min-height: 78px;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
}
.plan-card__price {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.plan-card__price strong {
  font-size: 30px;
  letter-spacing: 0;
}
.plan-card__price span {
  color: var(--muted);
  font-size: 12px;
}
.plan-card__pricing > small {
  color: var(--plan-note);
  font-size: 11px;
}
.plan-card ul {
  display: grid;
  gap: 11px;
  margin: 0 0 22px;
  padding: 18px 0 0;
  border-top: 1px solid var(--line-soft);
  list-style: none;
}
.plan-card li {
  display: flex;
  gap: 8px;
  color: var(--plan-li);
  font-size: 12px;
  line-height: 1.4;
}
.plan-card li i {
  color: var(--tone);
}
.plan-card > button {
  width: 100%;
  min-height: 43px;
  margin-top: auto;
  color: var(--tone);
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--tone) 55%, var(--surface));
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}
.plan-card > button:hover {
  background: color-mix(in srgb, var(--tone) 7%, var(--surface));
  border-color: var(--tone);
}
.plan-card.is-current > button {
  background: color-mix(in srgb, var(--tone) 7%, var(--surface));
}
.plan-card.is-recommended > button {
  color: #fff;
  background: var(--orange);
  border-color: var(--orange);
}
.plan-card.is-recommended > button:hover {
  background: var(--orange-deep);
}
.plans-retry {
  position: absolute;
  right: 0;
  bottom: -32px;
  color: var(--error);
  background: transparent;
  border: 0;
  font-size: 12px;
}

.membership-assurances {
  display: grid;
  width: calc(100% - 80px);
  grid-template-columns: repeat(4, 1fr);
  margin: 24px auto 0;
  padding: 22px 28px;
  background: var(--surface-soft);
  border: 1px solid var(--assurance-border);
  border-radius: 8px;
}
.membership-assurances > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-right: 1px solid var(--assurance-line);
}
.membership-assurances > div:last-child {
  border-right: 0;
}
.membership-assurances i {
  color: var(--orange);
  font-size: 28px;
}
.membership-assurances span {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.membership-assurances strong {
  font-size: 13px;
}
.membership-assurances small {
  color: var(--muted);
  font-size: 11px;
}
</style>
