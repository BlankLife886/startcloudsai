<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { getGrowthPrograms } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'

const router = useRouter()
const appearanceStore = useAppearanceStore()
const loading = ref(true)
const loadError = ref('')
const growthData = ref(null)

const rules = computed(() => growthData.value?.rules || {})
const milestones = computed(() =>
  Array.isArray(rules.value.usageMilestones) ? rules.value.usageMilestones : [],
)
const delivered = computed(() => Number(rules.value.monthDeliveredUnits || 0))
const nextMilestone = computed(() => milestones.value.find((item) => !item.achieved) || null)
const achievedCount = computed(() => milestones.value.filter((item) => item.achieved).length)
const progressPercent = computed(() => {
  if (!milestones.value.length) return 0
  const last = milestones.value[milestones.value.length - 1]
  const target = Math.max(1, Number(last?.units || 1))
  return Math.min(100, Math.round((delivered.value / target) * 100))
})
const remainingToNext = computed(() => {
  if (!nextMilestone.value) return 0
  return Math.max(0, Number(nextMilestone.value.units || 0) - delivered.value)
})

async function loadGrowth() {
  loading.value = true
  loadError.value = ''
  try {
    growthData.value = await getGrowthPrograms()
  } catch (error) {
    loadError.value = error?.message || '用量计划读取失败'
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
  <main class="usage-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <section class="usage-hero">
      <div class="usage-shell usage-hero__inner">
        <div class="usage-hero__copy">
          <button type="button" class="usage-back" @click="goBack">
            <i class="bi bi-arrow-left" aria-hidden="true"></i>
            返回上一页
          </button>
          <p class="usage-eyebrow">USAGE PLAN</p>
          <h1>用量计划</h1>
          <p>本月成功交付越多，自动解锁越高阶的积分回馈。</p>

          <div class="usage-summary" aria-label="本月用量">
            <div>
              <small>本月成功交付</small>
              <strong>{{ loading ? '—' : delivered }} <em>张</em></strong>
            </div>
            <span class="usage-summary__divider"></span>
            <div>
              <small>已解锁档位</small>
              <strong
                >{{ loading ? '—' : achievedCount }}
                <em>/ {{ milestones.length || '—' }}</em></strong
              >
            </div>
            <span class="usage-summary__divider"></span>
            <div>
              <small>{{ nextMilestone ? '距下一档' : '本月进度' }}</small>
              <strong v-if="nextMilestone">
                {{ remainingToNext }} <em>张</em>
              </strong>
              <strong v-else>{{ progressPercent }}<em>%</em></strong>
            </div>
          </div>
        </div>

        <div class="usage-hero__visual" aria-hidden="true">
          <span class="usage-hero__ring"></span>
          <span class="usage-hero__mark"><i class="bi bi-bar-chart-fill"></i></span>
          <div class="usage-hero__meter">
            <i :style="{ width: `${progressPercent}%` }"></i>
          </div>
        </div>
      </div>
    </section>

    <section class="usage-shell usage-panel" aria-label="用量档位">
      <header class="usage-panel__head">
        <div>
          <h2>本月档位</h2>
          <p>达到对应交付数量后，奖励自动发放到钱包，同档位本月只结算一次。</p>
        </div>
        <button
          v-if="loadError"
          type="button"
          class="usage-retry"
          @click="loadGrowth"
        >
          重新加载
        </button>
      </header>

      <div v-if="loading" class="usage-loading" aria-live="polite">
        <span></span><span></span><span></span>
      </div>

      <p v-else-if="loadError" class="usage-error">{{ loadError }}</p>

      <ul v-else-if="milestones.length" class="usage-ladder">
        <li
          v-for="(milestone, index) in milestones"
          :key="`${milestone.units}-${index}`"
          :class="{
            'is-achieved': milestone.achieved,
            'is-next': !milestone.achieved && milestone === nextMilestone,
          }"
        >
          <span class="usage-ladder__index">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="usage-ladder__copy">
            <strong>交付 {{ milestone.units }} 张</strong>
            <small>
              {{
                milestone.achieved
                  ? '本月已达成并结算'
                  : milestone === nextMilestone
                    ? `再交付 ${remainingToNext} 张即可解锁`
                    : '达到数量后自动发放'
              }}
            </small>
          </div>
          <div class="usage-ladder__reward">
            <span>奖励</span>
            <b>{{ formatPoints(milestone.rewardCents) }}</b>
          </div>
          <i
            class="bi"
            :class="milestone.achieved ? 'bi-check-circle-fill' : 'bi-circle'"
            aria-hidden="true"
          ></i>
        </li>
      </ul>

      <p v-else class="usage-empty">暂未配置用量档位，请稍后再看。</p>

      <div class="usage-tips" aria-label="用量计划说明">
        <div>
          <i class="bi bi-calendar3" aria-hidden="true"></i>
          <p><strong>按自然月统计</strong><small>每月 1 日重新累计交付量</small></p>
        </div>
        <div>
          <i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>
          <p><strong>达标自动到账</strong><small>无需手动领取，写入钱包账本</small></p>
        </div>
        <div>
          <i class="bi bi-shield-check" aria-hidden="true"></i>
          <p><strong>同档不重复发</strong><small>每个档位每月最多结算一次</small></p>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.usage-page {
  --ink: #1f2430;
  --muted: #6f7a8c;
  --orange: #f27021;
  --orange-deep: #c45a10;
  --line: #ebe3d8;
  --line-soft: #f2f2f2;
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-soft: #fffaf4;
  --surface-warm: #fff9f4;
  --cream: #fff8e9;
  --accent-soft: #fff7ef;
  --accent-border: #f2d2b4;
  --body: #3a4150;
  --back: #8a8a8a;
  --divider: #eeeeee;
  --hero-a: rgb(255 186 120 / 34%);
  --hero-b: rgb(255 220 160 / 28%);
  --hero-c: #fff8e9;
  --hero-d: #fffdf8;
  --hero-e: #ffffff;
  --summary-bg: rgb(255 255 255 / 92%);
  --summary-border: #ffe7d3;
  --summary-shadow: 0 8px 22px rgb(224 137 62 / 7%);
  --panel-bg: rgb(255 255 255 / 97%);
  --panel-shadow: 0 18px 55px rgb(31 39 49 / 10%);
  --ladder-bg: #fffaf4;
  --ladder-border: #f0e4d4;
  --ladder-achieved-bg: #ffffff;
  --ladder-achieved-border: #ffe0c4;
  --ladder-next-border: #ffb27a;
  --ladder-next-shadow: 0 10px 24px rgb(242 112 33 / 10%);
  --ladder-icon: #d7cfc4;
  --loading: #f2b27a;
  --ring-a: #ffc06a;
  --ring-b: #ff8a28;
  --ring-c: #f27021;
  --ring-shadow: 0 18px 40px rgb(255 120 20 / 22%);
  width: 100%;
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  overflow-x: clip;
  color: var(--ink);
  background: var(--bg);
}

.usage-page.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --orange: #ff8a3d;
  --orange-deep: #ffb06a;
  --line: #3b342c;
  --line-soft: #2f2922;
  --bg: #12100e;
  --surface: #1c1915;
  --surface-soft: #181511;
  --surface-warm: #221c16;
  --cream: #1c1814;
  --accent-soft: rgb(255 138 61 / 16%);
  --accent-border: #5a4030;
  --body: #cfc4b6;
  --back: #a79c8f;
  --divider: #3b342c;
  --hero-a: rgb(255 138 61 / 18%);
  --hero-b: rgb(255 176 96 / 12%);
  --hero-c: #1a1511;
  --hero-d: #241c15;
  --hero-e: #17130f;
  --summary-bg: rgb(28 25 21 / 92%);
  --summary-border: #5a4030;
  --summary-shadow: 0 18px 40px rgb(0 0 0 / 28%);
  --panel-bg: rgb(28 25 21 / 97%);
  --panel-shadow: 0 18px 40px rgb(0 0 0 / 32%);
  --ladder-bg: #221c16;
  --ladder-border: #3b342c;
  --ladder-achieved-bg: #1c1915;
  --ladder-achieved-border: #5a4030;
  --ladder-next-border: #ff8a3d;
  --ladder-next-shadow: 0 10px 24px rgb(255 138 61 / 14%);
  --ladder-icon: #5a5248;
  --loading: #ff8a3d;
  --ring-a: #ffb06a;
  --ring-b: #ff8a3d;
  --ring-c: #e06a20;
  --ring-shadow: 0 18px 40px rgb(0 0 0 / 32%);
}

.usage-shell {
  width: min(1120px, calc(100% - 48px));
  margin-inline: auto;
}

.usage-hero {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 86% 20%, var(--hero-a), transparent 30%),
    radial-gradient(circle at 12% 0%, var(--hero-b), transparent 24%),
    linear-gradient(112deg, var(--hero-c) 0%, var(--hero-d) 52%, var(--hero-e) 100%);
}

.usage-hero__inner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr);
  align-items: center;
  gap: 20px;
  min-height: 320px;
}

.usage-hero__copy {
  padding: 28px 0 40px;
}

.usage-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  padding: 0;
  color: var(--back);
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
}

.usage-back:hover {
  color: var(--orange);
}

.usage-eyebrow {
  margin: 0;
  color: var(--orange-deep);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.usage-hero h1 {
  margin: 10px 0 0;
  font-size: clamp(2.4rem, 4.8vw, 3.8rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.usage-hero__copy > p:last-of-type {
  margin: 14px 0 0;
  color: var(--body);
  font-size: 1.05rem;
  line-height: 1.55;
}

.usage-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  width: min(100%, 560px);
  margin-top: 26px;
  padding: 16px 18px;
  background: var(--summary-bg);
  border: 2px solid var(--summary-border);
  border-radius: 18px;
  box-shadow: var(--summary-shadow);
}

.usage-summary > div {
  flex: 1;
  min-width: 110px;
  display: grid;
  gap: 4px;
}

.usage-summary small {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.usage-summary strong {
  color: var(--orange);
  font-size: 1.45rem;
  font-weight: 850;
  line-height: 1.1;
}

.usage-summary em {
  color: var(--ink);
  font-style: normal;
  font-size: 0.78rem;
  font-weight: 700;
}

.usage-summary__divider {
  width: 1px;
  margin: 4px 14px;
  background: var(--divider);
}

.usage-hero__visual {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 260px;
}

.usage-hero__ring {
  position: absolute;
  width: min(78%, 280px);
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at 40% 35%, var(--ring-a) 0%, var(--ring-b) 48%, var(--ring-c) 100%);
  box-shadow: var(--ring-shadow);
}

.usage-hero__mark {
  position: relative;
  z-index: 1;
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
  color: #fff;
  background: rgb(255 255 255 / 18%);
  border: 1px solid rgb(255 255 255 / 35%);
  border-radius: 28px;
  font-size: 2.2rem;
  backdrop-filter: blur(6px);
}

.usage-hero__meter {
  position: absolute;
  bottom: 28px;
  left: 18%;
  right: 18%;
  height: 10px;
  overflow: hidden;
  background: rgb(255 255 255 / 55%);
  border-radius: 999px;
}

.usage-hero__meter > i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #fff3, #fff);
  border-radius: inherit;
}

.usage-panel {
  position: relative;
  z-index: 2;
  margin-top: -28px;
  margin-bottom: 40px;
  padding: 28px 32px 24px;
  background: var(--panel-bg);
  border: 1px solid var(--line-soft);
  border-radius: 22px;
  box-shadow: var(--panel-shadow);
}

.usage-panel__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.usage-panel__head h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 850;
}

.usage-panel__head p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.usage-retry {
  min-height: 36px;
  padding: 0 14px;
  color: var(--orange);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
  cursor: pointer;
}

.usage-loading {
  display: flex;
  gap: 8px;
  padding: 28px 0;
}

.usage-loading > span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--loading);
  animation: usage-pulse 1s ease-in-out infinite;
}

.usage-loading > span:nth-child(2) {
  animation-delay: 0.12s;
}

.usage-loading > span:nth-child(3) {
  animation-delay: 0.24s;
}

.usage-error,
.usage-empty {
  margin: 0;
  padding: 28px 0;
  color: var(--muted);
  text-align: center;
}

.usage-ladder {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.usage-ladder > li {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: var(--ladder-bg);
  border: 1px solid var(--ladder-border);
  border-radius: 16px;
}

.usage-ladder > li.is-achieved {
  background: var(--ladder-achieved-bg);
  border-color: var(--ladder-achieved-border);
}

.usage-ladder > li.is-next {
  border-color: var(--ladder-next-border);
  box-shadow: var(--ladder-next-shadow);
}

.usage-ladder__index {
  color: var(--orange-deep);
  font-size: 0.95rem;
  font-weight: 850;
}

.usage-ladder__copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.usage-ladder__copy strong {
  font-size: 1rem;
}

.usage-ladder__copy small {
  color: var(--muted);
  font-size: 0.78rem;
}

.usage-ladder__reward {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.usage-ladder__reward span {
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.usage-ladder__reward b {
  color: var(--orange);
  font-size: 1.05rem;
  font-weight: 850;
  white-space: nowrap;
}

.usage-ladder > li > .bi {
  color: var(--ladder-icon);
  font-size: 1.2rem;
}

.usage-ladder > li.is-achieved > .bi {
  color: #16a34a;
}

.usage-ladder > li.is-next > .bi {
  color: var(--orange);
}

.usage-tips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.usage-tips > div {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--surface-warm);
  border-radius: 14px;
}

.usage-tips i {
  color: var(--orange);
  font-size: 1.2rem;
}

.usage-tips p {
  display: grid;
  gap: 3px;
  margin: 0;
}

.usage-tips strong {
  font-size: 0.88rem;
}

.usage-tips small {
  color: var(--muted);
  font-size: 0.74rem;
}

@keyframes usage-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@media (max-width: 900px) {
  .usage-shell {
    width: calc(100% - 28px);
  }

  .usage-hero__inner {
    grid-template-columns: 1fr;
  }

  .usage-hero__visual {
    order: -1;
    min-height: 200px;
    margin-top: 18px;
  }

  .usage-hero__copy {
    padding-top: 8px;
  }

  .usage-summary__divider {
    display: none;
  }

  .usage-tips {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .usage-panel {
    margin-top: -18px;
    padding: 22px 16px 18px;
  }

  .usage-ladder > li {
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 10px;
  }

  .usage-ladder > li > .bi {
    display: none;
  }
}
</style>
