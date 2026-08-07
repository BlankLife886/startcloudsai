<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listPlans, formatCents, formatPoints } from '@/services/billingApi'

const router = useRouter()
const loading = ref(true)
const loadError = ref('')
const catalog = ref([])
const paymentEnabled = ref(false)

const previewPlans = [
  {
    id: 'free',
    name: '自由创作',
    subtitle: '适合灵活体验',
    icon: 'bi-stars',
    tone: 'blue',
    price: '按量计费',
    features: ['全部创作工作台', '按任务实际用量结算', '失败任务自动释放额度'],
    action: '开始创作',
    target: 'create',
    current: true,
  },
  {
    id: 'trial',
    name: '体验计划',
    subtitle: '适合初次体验',
    icon: 'bi-gem',
    tone: 'green',
    price: '免费申请',
    features: ['按活动规则申请', '审核通过领取体验积分', '覆盖指定创作功能'],
    action: '申请体验',
    target: 'trial',
  },
  {
    id: 'creator',
    name: '创作者计划',
    subtitle: '面向持续创作',
    icon: 'bi-award-fill',
    tone: 'orange',
    price: '待公布',
    features: ['持续创作权益预览', '全部图像工作台', '优先体验后续能力', '专属活动通知'],
    action: '申请体验',
    target: 'trial',
    recommended: true,
  },
  {
    id: 'professional',
    name: '专业制作',
    subtitle: '面向高频制作',
    icon: 'bi-trophy-fill',
    tone: 'violet',
    price: '规划中',
    features: ['更高计划额度', '适合高频生产任务', '商业使用能力预留', '优先服务支持'],
    action: '提交需求',
    target: 'feedback',
  },
  {
    id: 'enterprise',
    name: '企业合作',
    subtitle: '满足团队级需求',
    icon: 'bi-buildings-fill',
    tone: 'gold',
    price: '定制方案',
    features: ['包含专业制作能力', '团队工作流规划', '专属解决方案', '业务合作支持'],
    action: '联系合作',
    target: 'feedback',
  },
]

const displayPlans = computed(() => {
  if (!catalog.value.length) return previewPlans
  return catalog.value.map((plan, index) => ({
    ...plan,
    id: plan.id || plan.code,
    subtitle: plan.description || (plan.kind === 'subscription' ? '周期会员方案' : '创作积分方案'),
    icon: plan.kind === 'subscription' ? 'bi-trophy-fill' : 'bi-gem',
    tone: ['blue', 'green', 'orange', 'violet', 'gold'][index % 5],
    price: formatCents(plan.priceCents),
    suffix: plan.kind === 'subscription' ? `/ ${plan.durationDays || 30} 天` : '一次性',
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
  <main class="membership-page">
    <section class="membership-hero">
      <div class="membership-hero__copy">
        <p>MEMBERSHIP PLANS</p>
        <h1>选择适合你的<br /><strong>会员计划</strong></h1>
        <span>解锁专属权益，享受更优质的创作服务体验。正式会员价格以运营后台发布为准。</span>
        <div class="membership-hero__social" aria-hidden="true"></div>
      </div>

      <div class="membership-hero__offer">
        <span><i class="bi bi-fire"></i>当前开放</span>
        <strong>体验资格申请</strong>
        <small>审核通过后可领取活动积分</small>
      </div>

      <div class="membership-hero__asset" aria-hidden="true"></div>
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
          :class="{ 'is-recommended': plan.recommended }"
          :data-tone="plan.tone"
        >
          <em v-if="plan.recommended">推荐方案</em>
          <span class="plan-card__icon"><i class="bi" :class="plan.icon"></i></span>
          <h2>{{ plan.name }}</h2>
          <p>{{ plan.subtitle }}</p>
          <div class="plan-card__price">
            <strong>{{ plan.price }}</strong
            ><span>{{ plan.suffix || '' }}</span>
          </div>
          <ul>
            <li v-for="feature in plan.features" :key="feature">
              <i class="bi bi-check-circle-fill"></i>{{ feature }}
            </li>
          </ul>
          <button type="button" @click="usePlan(plan)">
            {{ plan.current ? '当前模式' : plan.action }}
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
        ><span><strong>安全可靠</strong><small>积分记录清晰可查</small></span>
      </div>
      <div>
        <i class="bi bi-arrow-repeat"></i
        ><span><strong>灵活参与</strong><small>按需求选择体验方式</small></span>
      </div>
      <div>
        <i class="bi bi-headset"></i
        ><span><strong>创作支持</strong><small>问题反馈快速响应</small></span>
      </div>
      <div>
        <i class="bi bi-gift"></i
        ><span><strong>会员活动</strong><small>体验资格与专属奖励</small></span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.membership-page {
  --ink: #132138;
  --muted: #7b8798;
  --orange: #f27021;
  width: 100%;
  min-width: 1180px;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 0 0 18px;
  color: var(--ink);
  background: #f6f8fb;
}

.membership-hero {
  display: grid;
  width: calc(100% - 40px);
  min-height: 300px;
  grid-template-columns: minmax(480px, 1.05fr) 330px minmax(460px, 0.95fr);
  align-items: center;
  margin: 0 auto;
  overflow: hidden;
  background: #fffdf9;
  border: 1px solid #eef0f3;
  border-radius: 8px;
}

.membership-hero__copy {
  padding: 36px 32px 32px 58px;
}
.membership-hero__copy > p {
  margin: 0 0 9px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 850;
}
.membership-hero h1 {
  margin: 0;
  font-size: 46px;
  font-weight: 850;
  line-height: 1.08;
  letter-spacing: 0;
}
.membership-hero h1 strong {
  color: var(--orange);
}
.membership-hero__copy > span {
  display: block;
  max-width: 520px;
  margin-top: 20px;
  color: #52617a;
  font-size: 14px;
  line-height: 1.7;
}
.membership-hero__social {
  width: 260px;
  height: 28px;
  margin-top: 22px;
}
.membership-hero__offer {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  padding-left: 30px;
  border-left: 1px solid #f0e5d8;
}
.membership-hero__offer > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  color: #ad4c12;
  background: #fff0de;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
}
.membership-hero__offer strong {
  margin-top: 19px;
  font-size: 20px;
}
.membership-hero__offer small {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.membership-hero__asset {
  width: 100%;
  height: 300px;
}

.plans-section {
  position: relative;
  width: calc(100% - 80px);
  margin: 0 auto;
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
  min-height: 464px;
  flex-direction: column;
  padding: 27px 25px 22px;
  background: #fff;
  border: 1px solid #e7eaf0;
  border-radius: 8px;
  box-shadow: 0 9px 24px rgb(31 48 75 / 8%);
}
.plan-card[data-tone='green'] {
  --tone: #19ad72;
}
.plan-card[data-tone='orange'] {
  --tone: #f07a19;
}
.plan-card[data-tone='violet'] {
  --tone: #8957df;
}
.plan-card[data-tone='gold'] {
  --tone: #d99a24;
}
.plan-card.is-recommended {
  border-color: #efaa69;
  box-shadow: 0 14px 32px rgb(225 113 28 / 15%);
}
.plan-card > em {
  position: absolute;
  top: -1px;
  right: -1px;
  padding: 8px 17px;
  color: #fff;
  background: var(--orange);
  border-radius: 0 8px 0 18px;
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
  background: color-mix(in srgb, var(--tone) 11%, #fff);
  border-radius: 50%;
  font-size: 22px;
}
.plan-card h2 {
  margin: 18px 0 5px;
  font-size: 22px;
  letter-spacing: 0;
}
.plan-card > p {
  min-height: 38px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.plan-card__price {
  display: flex;
  min-height: 72px;
  align-items: center;
  gap: 7px;
}
.plan-card__price strong {
  font-size: 28px;
  letter-spacing: 0;
}
.plan-card__price span {
  color: var(--muted);
  font-size: 11px;
}
.plan-card ul {
  display: grid;
  gap: 11px;
  margin: 0 0 22px;
  padding: 18px 0 0;
  border-top: 1px solid #edf0f4;
  list-style: none;
}
.plan-card li {
  display: flex;
  gap: 8px;
  color: #455267;
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
  background: #fff;
  border: 1px solid var(--tone);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.plan-card.is-recommended > button {
  color: #fff;
  background: var(--orange);
  border-color: var(--orange);
}
.plans-retry {
  position: absolute;
  right: 0;
  bottom: -32px;
  color: #b64d16;
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
  background: #fffaf4;
  border: 1px solid #f2e8dc;
  border-radius: 8px;
}
.membership-assurances > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-right: 1px solid #eadfd3;
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
