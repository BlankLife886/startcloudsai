<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { getGrowthPrograms } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'

const router = useRouter()
const appearanceStore = useAppearanceStore()
const loading = ref(true)
const loadError = ref('')
const growthData = ref(null)

const rules = computed(() => growthData.value?.rules || {})
const claimsToday = computed(() => Number(rules.value.failureClaimsToday || 0))
const dailyLimit = computed(() => Number(rules.value.failureBonusDailyLimit || 0))
const remainingClaims = computed(() => Math.max(0, dailyLimit.value - claimsToday.value))
const claimPercent = computed(() => {
  if (!dailyLimit.value) return 0
  return Math.min(100, Math.round((remainingClaims.value / dailyLimit.value) * 100))
})
const bonusLabel = computed(() =>
  rules.value.failureBonusEnabled === false
    ? '暂未开放'
    : formatPoints(rules.value.failureBonusCents),
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
    value: bonusLabel.value,
    title: '额外补偿积分',
    copy: '符合活动规则的失败任务自动获得额外补偿。',
    action: '查看任务记录',
    to: '/history',
  },
  {
    icon: 'bi-calendar-check',
    value: `${remainingClaims.value} 次`,
    title: '今日剩余补偿',
    copy: `今日已触发 ${claimsToday.value} 次，每日上限 ${dailyLimit.value || '—'} 次。`,
    action: '意见反馈',
    to: '/feedback',
  },
])

const tips = [
  { icon: 'bi-journal-check', title: '规则透明', copy: '补偿条件清晰可查' },
  { icon: 'bi-lightning-charge-fill', title: '自动处理', copy: '符合条件无需手动领取' },
  { icon: 'bi-shield-check', title: '账本可查', copy: '每笔积分变化均有记录' },
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

function goBack() {
  const canGoBack =
    typeof window !== 'undefined' &&
    window.history.length > 1 &&
    Boolean(window.history.state?.back)
  if (canGoBack) router.back()
  else router.push('/incentive-plans')
}

onMounted(loadGrowth)
</script>

<template>
  <main class="compensation-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <header class="compensation-top">
      <div class="compensation-shell compensation-top__inner">
        <button type="button" class="compensation-back" @click="goBack">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          返回
        </button>
        <div class="compensation-top__copy">
          <h1>失败补偿</h1>
          <p>创作失败也有明确保障：冻结费用按规则释放，符合条件时自动发放额外补偿。</p>
        </div>
        <div class="compensation-facts" aria-label="补偿概览">
          <span
            ><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>费用处理
            {{ loading ? '—' : '自动释放' }}</span
          >
          <span
            ><i class="bi bi-gift-fill" aria-hidden="true"></i>额外补偿
            {{ loading ? '—' : bonusLabel }}</span
          >
          <span
            ><i class="bi bi-calendar-check" aria-hidden="true"></i>今日剩余
            {{ loading ? '—' : `${remainingClaims} 次` }}</span
          >
        </div>
      </div>
    </header>

    <section class="compensation-shell compensation-workspace" aria-label="补偿内容">
      <div class="workspace-heading">
        <div>
          <span class="status-dot"></span>
          <strong>自动处理</strong>
          <small>所有补偿均由系统自动处理，无需手动领取。</small>
        </div>
        <button v-if="loadError" type="button" class="text-action" @click="loadGrowth">
          <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>重新加载
        </button>
      </div>

      <div v-if="loading" class="compensation-loading" aria-live="polite">
        <span></span><span></span><span></span>
        <p>正在读取补偿规则…</p>
      </div>

      <div v-else-if="loadError" class="compensation-empty-state">
        <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
        <h2>暂时无法读取补偿规则</h2>
        <p>{{ loadError }}</p>
      </div>

      <div v-else class="compensation-cards">
        <article v-for="item in compensationItems" :key="item.title" class="compensation-card">
          <span class="compensation-card__icon" aria-hidden="true">
            <i class="bi" :class="item.icon"></i>
          </span>
          <div class="compensation-card__body">
            <div class="compensation-card__head">
              <span class="compensation-card__value">{{ item.value }}</span>
              <h3>{{ item.title }}</h3>
            </div>
            <p>{{ item.copy }}</p>
            <div v-if="item.icon === 'bi-calendar-check'" class="compensation-card__meter">
              <i :style="{ width: `${claimPercent}%` }"></i>
            </div>
          </div>
          <RouterLink class="compensation-card__action" :to="item.to">
            {{ item.action }}<i class="bi bi-arrow-right" aria-hidden="true"></i>
          </RouterLink>
        </article>
      </div>
    </section>

    <footer class="compensation-tips" aria-label="失败补偿说明">
      <div class="compensation-shell">
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
:global(.app-container > .main-content:has(> .compensation-page)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.compensation-page {
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

.compensation-page.is-dark {
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

.compensation-shell {
  width: min(1100px, calc(100% - 40px));
  margin-inline: auto;
}

.compensation-top {
  --hero-pad-top: calc(var(--app-header-offset, 72px) + var(--app-page-content-top-gap, 0px));
  flex: 0 0 auto;
  margin-top: calc(-1 * var(--hero-pad-top));
  padding: calc(var(--hero-pad-top) + 10px) 0 14px;
  background:
    radial-gradient(circle at 92% 0%, rgb(109 92 255 / 16%), transparent 36%),
    linear-gradient(145deg, var(--hero) 0%, color-mix(in srgb, var(--accent) 6%, var(--hero)) 100%);
  border-bottom: 1px solid var(--line);
}

.compensation-top__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}

.compensation-back {
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

.compensation-back:hover {
  color: var(--accent);
}

.compensation-top__copy h1 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 840;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.compensation-top__copy p {
  margin: 4px 0 0;
  color: var(--body);
  font-size: 0.84rem;
  line-height: 1.4;
}

.compensation-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.compensation-facts span {
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

.compensation-facts i {
  color: var(--accent);
}

.compensation-workspace {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 14px 0 10px;
  overflow: auto;
}

.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.workspace-heading > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.workspace-heading strong {
  font-size: 0.86rem;
}

.workspace-heading small {
  overflow: hidden;
  color: var(--body);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  background: var(--accent);
  border-radius: 50%;
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

.compensation-loading,
.compensation-empty-state {
  display: flex;
  min-height: 160px;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.compensation-loading {
  flex-wrap: wrap;
  gap: 7px;
  color: var(--body);
}

.compensation-loading span {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: compensation-pulse 1s infinite alternate;
}

.compensation-loading span:nth-child(2) {
  animation-delay: 0.2s;
}

.compensation-loading span:nth-child(3) {
  animation-delay: 0.4s;
}

.compensation-loading p {
  width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 0.82rem;
}

@keyframes compensation-pulse {
  to {
    opacity: 0.25;
    transform: translateY(-4px);
  }
}

.compensation-empty-state {
  flex-direction: column;
  color: var(--body);
  text-align: center;
}

.compensation-empty-state i {
  color: var(--accent);
  font-size: 1.6rem;
}

.compensation-empty-state h2 {
  margin: 10px 0 0;
  color: var(--ink);
  font-size: 1.1rem;
}

.compensation-empty-state p {
  margin: 6px 0 0;
  font-size: 0.84rem;
}

.compensation-cards {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
}

.compensation-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
}

.compensation-card:nth-child(2) {
  background: var(--accent-soft);
}

.compensation-card__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  border-radius: 12px;
  font-size: 1.05rem;
}

.compensation-card:nth-child(2) .compensation-card__icon {
  color: var(--accent);
  background: var(--surface);
  border: 1px solid var(--line);
}

.compensation-card__body {
  min-width: 0;
}

.compensation-card__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.compensation-card__value {
  color: var(--accent-deep);
  font-size: 0.95rem;
  font-weight: 820;
}

.compensation-card__body h3 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 780;
  line-height: 1.3;
}

.compensation-card__body p {
  margin: 4px 0 0;
  color: var(--body);
  font-size: 0.76rem;
  line-height: 1.45;
}

.compensation-card__meter {
  height: 4px;
  margin-top: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 12%, var(--line));
  border-radius: 999px;
}

.compensation-card__meter > i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  border-radius: inherit;
}

.compensation-card__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line));
  border-radius: 9px;
  font-size: 0.74rem;
  font-weight: 720;
  text-decoration: none;
  white-space: nowrap;
}

.compensation-card__action:hover {
  color: var(--accent-hover);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
}

.compensation-tips {
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
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--accent);
  font-size: 0.95rem;
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
  :global(.app-container > .main-content:has(> .compensation-page)) {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .compensation-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .compensation-top__inner {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .compensation-facts {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .tip-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .compensation-shell {
    width: calc(100% - 28px);
  }

  .compensation-top__inner {
    gap: 10px;
  }

  .compensation-top__copy h1 {
    font-size: 1.3rem;
  }

  .workspace-heading > div {
    flex-wrap: wrap;
  }

  .workspace-heading small {
    width: 100%;
    padding-left: 16px;
    white-space: normal;
  }

  .compensation-card {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 10px 12px;
    padding: 14px;
  }

  .compensation-card__action {
    grid-column: 1 / -1;
    justify-content: center;
  }

  .tip-list {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .compensation-loading span {
    animation: none;
  }
}
</style>
