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
    <header class="usage-top">
      <div class="usage-shell usage-top__inner">
        <button type="button" class="usage-back" @click="goBack">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          返回
        </button>
        <div class="usage-top__copy">
          <h1>用量计划</h1>
          <p>本月成功交付越多，自动解锁越高阶的积分回馈。</p>
        </div>
        <div class="usage-facts" aria-label="本月用量">
          <span>
            <i class="bi bi-box-seam"></i>
            交付 {{ loading ? '—' : delivered }} 张
          </span>
          <span>
            <i class="bi bi-unlock"></i>
            已解锁 {{ loading ? '—' : achievedCount }}/{{ milestones.length || '—' }}
          </span>
          <span>
            <i class="bi bi-arrow-up-circle"></i>
            <template v-if="nextMilestone">距下一档 {{ remainingToNext }} 张</template>
            <template v-else>本月进度 {{ progressPercent }}%</template>
          </span>
        </div>
      </div>
    </header>

    <section class="usage-shell usage-workspace" aria-label="用量档位">
      <div class="workspace-heading">
        <div>
          <span class="status-dot" :class="{ 'is-complete': !nextMilestone && milestones.length }"></span>
          <strong>本月档位</strong>
          <small>达到对应交付数量后，奖励自动发放到钱包，同档位本月只结算一次。</small>
        </div>
        <button v-if="loadError" type="button" class="text-action" @click="loadGrowth">
          <i class="bi bi-arrow-clockwise"></i>重新加载
        </button>
      </div>

      <div v-if="loading" class="usage-loading" aria-live="polite">
        <span></span><span></span><span></span>
        <p>正在读取用量计划…</p>
      </div>

      <div v-else-if="loadError" class="usage-empty-state">
        <i class="bi bi-exclamation-circle"></i>
        <h2>暂时无法读取用量计划</h2>
        <p>{{ loadError }}</p>
      </div>

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
            class="bi usage-ladder__state"
            :class="milestone.achieved ? 'bi-check-circle-fill' : 'bi-circle'"
            aria-hidden="true"
          ></i>
        </li>
      </ul>

      <p v-else class="usage-empty">暂未配置用量档位，请稍后再看。</p>
    </section>

    <footer class="usage-rules" aria-labelledby="usage-rules-title">
      <div class="usage-shell">
        <h2 id="usage-rules-title" class="sr-only">用量计划说明</h2>
        <ol class="rule-list">
          <li>
            <span>1</span>
            <div>
              <strong>按自然月统计</strong>
              <p>每月 1 日重新累计交付量</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>达标自动到账</strong>
              <p>无需手动领取，写入钱包账本</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>同档不重复发</strong>
              <p>每个档位每月最多结算一次</p>
            </div>
          </li>
        </ol>
      </div>
    </footer>
  </main>
</template>

<style scoped>
:global(.app-container > .main-content:has(> .usage-page)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.usage-page {
  --ink: #17171f;
  --body: #4f5160;
  --muted: #777785;
  --accent: #6d5cff;
  --accent-deep: #5746e5;
  --accent-soft: rgb(109 92 255 / 10%);
  --accent-hover: #4f3fe0;
  --green: #0f9f6e;
  --green-soft: rgb(15 159 110 / 12%);
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

.usage-page.is-dark {
  --ink: rgba(255, 255, 255, 0.96);
  --body: rgb(255 255 255 / 72%);
  --muted: rgb(255 255 255 / 52%);
  --accent: #8b7bff;
  --accent-deep: #a99cff;
  --accent-soft: rgb(109 92 255 / 16%);
  --accent-hover: #9d8fff;
  --green: #68c994;
  --green-soft: rgb(104 201 148 / 14%);
  --surface: #121218;
  --surface-soft: #1a1824;
  --line: rgb(255 255 255 / 10%);
  --hero: #161422;
}

.usage-shell {
  width: min(1100px, calc(100% - 40px));
  margin-inline: auto;
}

.usage-top {
  --hero-pad-top: calc(var(--app-header-offset, 72px) + var(--app-page-content-top-gap, 0px));
  flex: 0 0 auto;
  margin-top: calc(-1 * var(--hero-pad-top));
  padding: calc(var(--hero-pad-top) + 10px) 0 14px;
  background:
    radial-gradient(circle at 92% 0%, rgb(109 92 255 / 16%), transparent 36%),
    linear-gradient(145deg, var(--hero) 0%, color-mix(in srgb, var(--accent) 6%, var(--hero)) 100%);
  border-bottom: 1px solid var(--line);
}

.usage-top__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}

.usage-back {
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

.usage-back:hover {
  color: var(--accent);
}

.usage-top__copy h1 {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 840;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.usage-top__copy p {
  margin: 4px 0 0;
  color: var(--body);
  font-size: 0.84rem;
  line-height: 1.4;
}

.usage-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.usage-facts span {
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

.usage-facts i {
  color: var(--accent);
}

.usage-workspace {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 14px 0 8px;
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

.status-dot.is-complete {
  background: var(--green);
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

.usage-loading,
.usage-empty-state {
  display: flex;
  min-height: 120px;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.usage-loading {
  flex-wrap: wrap;
  gap: 7px;
  color: var(--body);
}

.usage-loading span {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: usage-pulse 1s infinite alternate;
}

.usage-loading span:nth-child(2) {
  animation-delay: 0.2s;
}

.usage-loading span:nth-child(3) {
  animation-delay: 0.4s;
}

.usage-loading p {
  width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 0.82rem;
}

@keyframes usage-pulse {
  to {
    opacity: 0.25;
    transform: translateY(-4px);
  }
}

.usage-empty-state {
  flex-direction: column;
  color: var(--body);
  text-align: center;
}

.usage-empty-state i {
  color: var(--accent);
  font-size: 1.6rem;
}

.usage-empty-state h2 {
  margin: 10px 0 0;
  color: var(--ink);
  font-size: 1.1rem;
}

.usage-empty-state p {
  margin: 6px 0 0;
  font-size: 0.84rem;
}

.usage-empty {
  margin: 0;
  padding: 32px 0;
  color: var(--muted);
  text-align: center;
  font-size: 0.84rem;
}

.usage-ladder {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  align-content: start;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.usage-ladder > li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto 22px;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.usage-ladder > li.is-achieved {
  background: var(--green-soft);
  border-color: color-mix(in srgb, var(--green) 28%, var(--line));
}

.usage-ladder > li.is-next {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line));
  box-shadow: 0 6px 16px rgb(109 92 255 / 12%);
}

.usage-ladder__index {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--accent-deep);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line));
  border-radius: 8px;
  font-size: 0.68rem;
  font-weight: 800;
}

.usage-ladder > li.is-achieved .usage-ladder__index {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--green) 28%, var(--line));
}

.usage-ladder__copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.usage-ladder__copy strong {
  font-size: 0.84rem;
  font-weight: 760;
}

.usage-ladder__copy small {
  color: var(--body);
  font-size: 0.72rem;
  line-height: 1.35;
}

.usage-ladder__reward {
  display: grid;
  justify-items: end;
  gap: 1px;
}

.usage-ladder__reward span {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 700;
}

.usage-ladder__reward b {
  color: var(--accent-deep);
  font-size: 0.88rem;
  font-weight: 820;
  white-space: nowrap;
}

.usage-ladder > li.is-achieved .usage-ladder__reward b {
  color: var(--green);
}

.usage-ladder__state {
  color: var(--muted);
  font-size: 1rem;
}

.usage-ladder > li.is-achieved .usage-ladder__state {
  color: var(--green);
}

.usage-ladder > li.is-next .usage-ladder__state {
  color: var(--accent);
}

.usage-rules {
  flex: 0 0 auto;
  padding: 10px 0 14px;
  background: var(--surface-soft);
  border-top: 1px solid var(--line);
}

.rule-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule-list li {
  display: flex;
  min-width: 0;
  gap: 10px;
}

.rule-list li > span {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  border-radius: 50%;
  font-size: 0.68rem;
  font-weight: 800;
}

.rule-list strong {
  display: block;
  font-size: 0.78rem;
}

.rule-list p {
  margin: 3px 0 0;
  color: var(--body);
  font-size: 0.7rem;
  line-height: 1.4;
}

@media (max-width: 960px) {
  :global(.app-container > .main-content:has(> .usage-page)) {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .usage-page {
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .usage-top__inner {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .usage-facts {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .rule-list {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (max-width: 640px) {
  .usage-shell {
    width: calc(100% - 28px);
  }

  .usage-top__inner {
    gap: 10px;
  }

  .usage-top__copy h1 {
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

  .usage-ladder > li {
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: 8px;
    padding: 10px;
  }

  .usage-ladder__state {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .usage-loading span {
    animation: none;
  }
}
</style>
