<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getGrowthPrograms } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'

const loading = ref(true)
const loadError = ref('')
const growthData = ref(null)

const rules = computed(() => growthData.value?.rules || {})
const remainingClaims = computed(() =>
  Math.max(
    0,
    Number(rules.value.failureBonusDailyLimit || 0) - Number(rules.value.failureClaimsToday || 0),
  ),
)

const compensationItems = computed(() => [
  {
    icon: 'bi-arrow-counterclockwise',
    value: '自动释放',
    title: '失败任务费用',
    copy: '任务失败或取消后，冻结积分按结算规则释放。',
    action: '查看钱包记录',
    to: '/wallet',
  },
  {
    icon: 'bi-gift-fill',
    value:
      rules.value.failureBonusEnabled === false
        ? '暂未开放'
        : formatPoints(rules.value.failureBonusCents),
    title: '额外补偿积分',
    copy: '符合活动规则的失败任务自动获得额外补偿。',
    action: '查看任务记录',
    to: '/history',
  },
  {
    icon: 'bi-calendar-check',
    value: `${remainingClaims.value} 次`,
    title: '今日剩余补偿',
    copy: `今日已触发 ${Number(rules.value.failureClaimsToday || 0)} 次，每日上限 ${Number(rules.value.failureBonusDailyLimit || 0)} 次。`,
    action: '查看补偿规则',
    to: '#compensation-rules',
  },
])

const helpItems = [
  { icon: 'bi-headset', title: '需要帮助？', copy: '补偿未到账时提交问题反馈', to: '/feedback' },
  { icon: 'bi-wallet2', title: '钱包记录', copy: '查看积分释放与补偿入账', to: '/wallet' },
  { icon: 'bi-clock-history', title: '任务记录', copy: '核对失败任务与处理状态', to: '/history' },
  { icon: 'bi-chat-dots', title: '意见反馈', copy: '告诉我们遇到的问题', to: '/feedback' },
]

const assurances = [
  { icon: 'bi-journal-check', title: '规则透明', copy: '补偿条件清晰可查' },
  { icon: 'bi-arrow-repeat', title: '自动处理', copy: '符合条件无需手动领取' },
  { icon: 'bi-shield-check', title: '账本可查', copy: '每笔积分变化均有记录' },
  { icon: 'bi-life-preserver', title: '问题支持', copy: '异常情况可提交反馈' },
]

async function loadGrowth() {
  loading.value = true
  loadError.value = ''
  try {
    growthData.value = await getGrowthPrograms()
  } catch (error) {
    loadError.value = error?.message || '补偿规则读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadGrowth)
</script>

<template>
  <main class="compensation-page">
    <section class="compensation-panel">
      <div class="compensation-hero">
        <div class="compensation-hero__copy">
          <i class="bi bi-emoji-frown" aria-hidden="true"></i>
          <h1>创作失败，也有明确保障</h1>
          <p>系统繁忙或上游服务异常导致任务失败时，冻结费用会按规则释放。</p>
          <p>符合活动条件的任务，还会自动获得额外积分补偿。</p>
          <div>
            <a href="#compensation-rules">查看补偿规则</a>
            <RouterLink to="/incentive-plans">返回创作激励</RouterLink>
          </div>
        </div>
        <div class="compensation-hero__asset" aria-hidden="true"></div>
      </div>

      <section
        id="compensation-rules"
        class="compensation-benefits"
        aria-labelledby="benefits-title"
      >
        <header>
          <div>
            <span>COMPENSATION</span>
            <h2 id="benefits-title">为你准备的补偿</h2>
          </div>
          <button v-if="loadError" type="button" @click="loadGrowth">重新加载</button>
          <p v-else>所有补偿均由系统自动处理</p>
        </header>

        <div v-if="loading" class="compensation-loading" aria-live="polite">
          <span></span><span></span><span></span>
        </div>
        <div v-else class="compensation-grid">
          <article v-for="item in compensationItems" :key="item.title">
            <div class="compensation-value">
              <i class="bi" :class="item.icon"></i><strong>{{ item.value }}</strong>
            </div>
            <div class="compensation-copy">
              <h3>{{ item.title }}</h3>
              <p>{{ item.copy }}</p>
            </div>
            <component
              :is="item.to.startsWith('#') ? 'a' : RouterLink"
              :href="item.to.startsWith('#') ? item.to : undefined"
              :to="item.to.startsWith('#') ? undefined : item.to"
            >
              {{ item.action }}<i class="bi bi-arrow-right"></i>
            </component>
          </article>
        </div>
      </section>
    </section>

    <section class="help-strip" aria-label="补偿帮助入口">
      <RouterLink v-for="item in helpItems" :key="item.title" :to="item.to">
        <span><i class="bi" :class="item.icon"></i></span>
        <p>
          <strong>{{ item.title }}</strong
          ><small>{{ item.copy }}</small>
        </p>
      </RouterLink>
    </section>

    <section class="assurance-strip" aria-label="失败补偿保障">
      <div v-for="item in assurances" :key="item.title">
        <i class="bi" :class="item.icon"></i>
        <p>
          <strong>{{ item.title }}</strong
          ><small>{{ item.copy }}</small>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.compensation-page {
  --ink: #20242b;
  --muted: #6e7683;
  --orange: #f4761c;
  width: 100%;
  min-width: 1180px;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 14px 0 22px;
  color: var(--ink);
  background: #f6f7f9;
}
.compensation-panel {
  width: calc(100% - 120px);
  margin: 0 auto;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e7e9ed;
  border-radius: 8px;
}
.compensation-hero {
  display: grid;
  min-height: 385px;
  grid-template-columns: minmax(620px, 1fr) minmax(600px, 1fr);
  align-items: center;
  background: #fff9f3;
}
.compensation-hero__copy {
  padding: 48px 40px 44px 150px;
}
.compensation-hero__copy > i {
  color: var(--orange);
  font-size: 48px;
}
.compensation-hero h1 {
  margin: 18px 0 19px;
  font-size: 36px;
  letter-spacing: 0;
}
.compensation-hero__copy > p {
  margin: 6px 0;
  color: var(--muted);
  font-size: 14px;
}
.compensation-hero__copy > div {
  display: flex;
  gap: 28px;
  margin-top: 32px;
}
.compensation-hero__copy a {
  display: inline-flex;
  min-width: 142px;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  color: #fff;
  background: var(--orange);
  border: 1px solid var(--orange);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
}
.compensation-hero__copy a + a {
  color: #333942;
  background: #fff;
}
.compensation-hero__asset {
  width: 100%;
  height: 385px;
}
.compensation-benefits {
  padding: 25px 80px 30px;
  scroll-margin-top: 90px;
}
.compensation-benefits > header {
  display: flex;
  min-height: 44px;
  align-items: flex-end;
  justify-content: space-between;
}
.compensation-benefits header span {
  color: var(--orange);
  font-size: 10px;
  font-weight: 850;
}
.compensation-benefits h2 {
  margin: 4px 0 0;
  font-size: 22px;
}
.compensation-benefits header p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}
.compensation-benefits header button {
  padding: 7px 12px;
  color: var(--orange);
  background: #fff;
  border: 1px solid #f0b483;
  border-radius: 6px;
}
.compensation-loading {
  display: flex;
  min-height: 115px;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.compensation-loading span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--orange);
}
.compensation-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px;
  margin-top: 16px;
}
.compensation-grid article {
  display: grid;
  min-height: 112px;
  grid-template-columns: 145px 1fr auto;
  align-items: center;
  overflow: hidden;
  background: #fff;
  border: 1px solid #edf0f3;
  border-radius: 7px;
  box-shadow: 0 7px 18px rgb(41 51 67 / 6%);
}
.compensation-value {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: var(--orange);
  background: #fff1df;
}
.compensation-value i {
  font-size: 22px;
}
.compensation-value strong {
  font-size: 21px;
}
.compensation-copy {
  min-width: 0;
  padding: 0 18px;
}
.compensation-copy h3 {
  margin: 0 0 7px;
  font-size: 15px;
}
.compensation-copy p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.compensation-grid article > a {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 17px;
  color: var(--orange);
  font-size: 11px;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}
.help-strip {
  display: grid;
  width: calc(100% - 120px);
  min-height: 96px;
  grid-template-columns: repeat(4, 1fr);
  margin: 16px auto 0;
  background: #fff;
  border: 1px solid #e4e7eb;
  border-radius: 8px;
}
.help-strip a {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--ink);
  text-decoration: none;
  border-right: 1px solid #e8ebef;
}
.help-strip a:last-child {
  border-right: 0;
}
.help-strip a > span {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  color: var(--orange);
  background: #fff1e5;
  border-radius: 50%;
  font-size: 21px;
}
.help-strip p,
.assurance-strip p {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}
.help-strip strong {
  font-size: 14px;
}
.help-strip small,
.assurance-strip small {
  color: var(--muted);
  font-size: 11px;
}
.assurance-strip {
  display: grid;
  width: calc(100% - 120px);
  min-height: 76px;
  grid-template-columns: repeat(4, 1fr);
  margin: 14px auto 0;
  background: #fff;
  border: 1px solid #eceef1;
  border-radius: 8px;
}
.assurance-strip > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 13px;
}
.assurance-strip > div > i {
  color: #89919d;
  font-size: 22px;
}
.assurance-strip strong {
  font-size: 12px;
}
</style>
