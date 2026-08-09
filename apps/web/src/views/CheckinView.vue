<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import { getCheckinState, claimDailyCheckin } from '@/services/checkinApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import coinArt from '@/assets/incentives/suggestion-coin.png'

const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const { applyWalletSnapshot, refreshWalletBalance } = useClientWalletBalance()

const loading = ref(true)
const claiming = ref(false)
const loadError = ref('')
const state = ref(null)
const claimBurst = ref(false)
const weekLabels = ['日', '一', '二', '三', '四', '五', '六']

const rewardItems = computed(() => (Array.isArray(state.value?.rewards) ? state.value.rewards : []))
const todayChecked = computed(() => state.value?.todayChecked === true)
const activityEnabled = computed(() => state.value?.enabled !== false)
const claimReward = computed(() => Math.max(0, Number(state.value?.claimRewardCents || 0)))
const nextReward = computed(() => Math.max(0, Number(state.value?.nextRewardCents || 0)))
const activeCycleDay = computed(() => Math.max(1, Number(state.value?.claimCycleDay || 1)))
const completedCycleDay = computed(() =>
  todayChecked.value ? Number(state.value?.todayRecord?.cycleDay || activeCycleDay.value) : 0,
)
const displayName = computed(
  () => authStore.user?.username || authStore.user?.email?.split('@')[0] || '创作者',
)

const calendarDays = computed(() => {
  const monthValue = String(state.value?.month || '')
  const [year, month] = monthValue.split('-').map((part) => Number(part))
  if (!year || !month) return []
  const recordMap = new Map(
    (state.value?.monthRecords || []).map((record) => [String(record.date), record]),
  )
  const days = new Date(year, month, 0).getDate()
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const cells = Array.from({ length: firstWeekday }, (_, index) => ({ key: `blank-${index}` }))
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      key: date,
      day,
      date,
      record: recordMap.get(date) || null,
      today: date === state.value?.today,
    })
  }
  return cells
})

const monthTitle = computed(() => {
  const [year, month] = String(state.value?.month || '').split('-')
  if (!year || !month) return '本月签到'
  return `${year} 年 ${Number(month)} 月`
})

const progressPercent = computed(() => {
  const done = todayChecked.value ? completedCycleDay.value : Math.max(0, activeCycleDay.value - 1)
  return Math.min(100, Math.max(0, (done / 7) * 100))
})

const statusLabel = computed(() => {
  if (!activityEnabled.value) return '活动暂停'
  if (todayChecked.value) return '今日已签到'
  return '今日可领取'
})

const statusDetail = computed(() => {
  if (!activityEnabled.value) return '签到活动暂未开放，稍后再来'
  if (todayChecked.value) return `明日可领 ${formatPoints(nextReward.value)}，继续保持连续`
  return `签到即可领取 ${formatPoints(claimReward.value)}，连续越多奖励越高`
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    state.value = await getCheckinState()
  } catch (error) {
    loadError.value = error?.message || '签到活动读取失败'
  } finally {
    loading.value = false
  }
}

async function claim() {
  if (claiming.value || todayChecked.value || !activityEnabled.value) return
  claiming.value = true
  try {
    const result = await claimDailyCheckin()
    state.value = result
    if (result?.balanceCents != null) {
      applyWalletSnapshot({
        balanceCents: result.balanceCents,
        frozenCents: result.frozenCents,
        normalBalanceCents: result.normalBalanceCents,
        trialBalanceCents: result.trialBalanceCents,
        normalFrozenCents: result.normalFrozenCents,
        trialFrozenCents: result.trialFrozenCents,
      })
    }
    await refreshWalletBalance({ force: true }).catch(() => null)
    if (result?.alreadyChecked) {
      notificationService.info('今天已经签到过了')
    } else {
      claimBurst.value = false
      await nextTick()
      claimBurst.value = true
      notificationService.success(`签到成功，获得 ${formatPoints(result?.claimedRewardCents || 0)}`)
      window.setTimeout(() => {
        claimBurst.value = false
      }, 1200)
    }
  } catch (error) {
    notificationService.error(error?.message || '签到失败，请稍后重试')
  } finally {
    claiming.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="ck" :class="{ 'is-dark': appearanceStore.isDark }">
    <div class="ck-glow" aria-hidden="true"></div>

    <div v-if="loading" class="ck-state" aria-live="polite">
      <span></span><span></span><span></span>
      <p>正在读取签到状态…</p>
    </div>

    <section v-else-if="loadError" class="ck-state is-error">
      <i class="bi bi-cloud-slash" aria-hidden="true"></i>
      <h1>签到活动加载失败</h1>
      <p>{{ loadError }}</p>
      <button type="button" class="ck-btn is-primary" @click="load">重新加载</button>
    </section>

    <template v-else-if="state">
      <section class="ck-hero">
        <div class="ck-hero__copy">
          <p class="ck-kicker">
            <i class="bi bi-calendar2-check" aria-hidden="true"></i>
            DAILY CHECK-IN
          </p>
          <h1>{{ state.campaignTitle || '每日签到' }}</h1>
          <p class="ck-lead">连续签到领取创作积分，第 7 天解锁里程碑奖励，周期完成后自动重置。</p>

          <div class="ck-status" :data-tone="!activityEnabled ? 'off' : todayChecked ? 'done' : 'ready'">
            <i aria-hidden="true"></i>
            <div>
              <strong>{{ statusLabel }}</strong>
              <small>{{ statusDetail }}</small>
            </div>
          </div>

          <div class="ck-hero__actions">
            <button
              type="button"
              class="ck-btn is-claim"
              :class="{ 'is-claimed': todayChecked, 'is-burst': claimBurst }"
              :disabled="claiming || todayChecked || !activityEnabled"
              @click="claim"
            >
              <i
                class="bi"
                :class="
                  todayChecked ? 'bi-check2-circle' : claiming ? 'bi-arrow-repeat ck-spin' : 'bi-gift-fill'
                "
                aria-hidden="true"
              ></i>
              <span>
                <strong>{{
                  todayChecked ? '今日已签到' : claiming ? '签到中…' : '立即签到'
                }}</strong>
                <small v-if="activityEnabled">
                  {{
                    todayChecked
                      ? `明日 +${formatPoints(nextReward, { withUnit: false })} 积分`
                      : `领取 +${formatPoints(claimReward, { withUnit: false })} 积分`
                  }}
                </small>
                <small v-else>等待活动重新开放</small>
              </span>
            </button>
            <RouterLink class="ck-btn is-ghost" to="/wallet">查看钱包</RouterLink>
            <RouterLink class="ck-btn is-ghost" to="/studio">去创作</RouterLink>
          </div>

          <div class="ck-metrics" aria-label="签到数据">
            <article>
              <small>连续签到</small>
              <strong>{{ state.currentStreak }}<em>天</em></strong>
            </article>
            <article>
              <small>本月积分</small>
              <strong>{{ formatPoints(state.monthRewardCents, { withUnit: false }) }}<em>分</em></strong>
            </article>
            <article>
              <small>累计签到</small>
              <strong>{{ state.totalCheckins }}<em>次</em></strong>
            </article>
          </div>
        </div>

        <aside class="ck-hero__visual" aria-hidden="true">
          <div class="ck-orb"></div>
          <img :src="coinArt" alt="" loading="lazy" />
          <div class="ck-hero__badge">
            <span>DAY {{ String(activeCycleDay).padStart(2, '0') }}</span>
            <strong>/ 07</strong>
          </div>
        </aside>
      </section>

      <section class="ck-body">
        <section class="ck-panel ck-streak" aria-labelledby="ck-streak-title">
          <header>
            <div>
              <h2 id="ck-streak-title">7 日奖励轨迹</h2>
              <p>每天递增，第 7 天为里程碑；完成后重新从第 1 天开始。</p>
            </div>
            <span>{{ todayChecked ? `已完成 D${completedCycleDay}` : `当前 D${activeCycleDay}` }}</span>
          </header>

          <div class="ck-track" role="list">
            <article
              v-for="reward in rewardItems"
              :key="reward.day"
              role="listitem"
              :class="{
                'is-active': !todayChecked && reward.day === activeCycleDay,
                'is-done': reward.day <= completedCycleDay,
                'is-milestone': reward.milestone,
              }"
            >
              <span class="ck-track__day">D{{ reward.day }}</span>
              <strong>+{{ formatPoints(reward.rewardCents, { withUnit: false }) }}</strong>
              <small>{{ reward.milestone ? '里程碑' : '积分' }}</small>
              <i
                v-if="reward.day <= completedCycleDay"
                class="bi bi-check-lg"
                aria-hidden="true"
              ></i>
            </article>
          </div>

          <div class="ck-progress" aria-hidden="true">
            <span :style="{ width: `${progressPercent}%` }"></span>
          </div>

          <ul class="ck-tips">
            <li><i class="bi bi-lightning-charge-fill" aria-hidden="true"></i>连续天数越高，单日奖励越高</li>
            <li><i class="bi bi-arrow-repeat" aria-hidden="true"></i>中断后从第 1 天重新累计</li>
            <li><i class="bi bi-wallet2" aria-hidden="true"></i>积分自动入账，可直接用于创作</li>
          </ul>
        </section>

        <section class="ck-panel ck-calendar" aria-labelledby="ck-calendar-title">
          <header>
            <div>
              <h2 id="ck-calendar-title">{{ monthTitle }}</h2>
              <p>本月已签到 {{ state.monthRecords?.length || 0 }} 天</p>
            </div>
            <span class="ck-user" :title="authStore.user?.email || displayName">
              <em>{{ displayName.slice(0, 1).toUpperCase() }}</em>
              {{ displayName }}
            </span>
          </header>

          <div class="ck-week" aria-hidden="true">
            <span v-for="label in weekLabels" :key="label">{{ label }}</span>
          </div>
          <div class="ck-grid">
            <div
              v-for="cell in calendarDays"
              :key="cell.key"
              class="ck-day"
              :class="{
                'is-checked': cell.record,
                'is-today': cell.today,
                'is-empty': !cell.day,
              }"
            >
              <template v-if="cell.day">{{ cell.day }}</template>
            </div>
          </div>
        </section>
      </section>

      <footer class="ck-foot">
        <p>签到积分自动入账钱包，可用于全部 AI 创作工作台。</p>
        <div>
          <RouterLink to="/incentive-plans">创作激励</RouterLink>
          <RouterLink to="/pricing">创作价格</RouterLink>
        </div>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.ck {
  --ink: #1f2430;
  --muted: #6f7a8c;
  --line: #eadfce;
  --orange: #f27021;
  --orange-deep: #c45a10;
  --bg: #f7f4ef;
  --surface: #ffffff;
  --soft: #fff6eb;
  --hero-a: rgb(255 186 110 / 38%);
  --hero-b: rgb(255 220 170 / 34%);
  --hero-c: #fff9f0;
  --hero-d: #ffe9cf;
  --hero-e: #fff6ea;
  --card-shadow: 0 16px 40px rgb(70 45 15 / 8%);
  --track: #fffaf4;
  --day-bg: #faf6f0;
  --done: #22c55e;
  position: relative;
  isolation: isolate;
  width: 100%;
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  padding: 28px clamp(20px, 3.5vw, 56px) 40px;
  overflow-x: clip;
  color: var(--ink);
  background: var(--bg);
}

.ck.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --line: #3b342c;
  --orange: #ff8a3d;
  --orange-deep: #ffb06a;
  --bg: #12100e;
  --surface: #1c1915;
  --soft: #221c16;
  --hero-a: rgb(255 138 61 / 18%);
  --hero-b: rgb(255 176 96 / 12%);
  --hero-c: #1a1511;
  --hero-d: #241c15;
  --hero-e: #17130f;
  --card-shadow: 0 20px 48px rgb(0 0 0 / 32%);
  --track: #221c16;
  --day-bg: #181511;
  --done: #34d399;
}

.ck-glow {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 10% 0%, var(--hero-a), transparent 30%),
    radial-gradient(circle at 90% 8%, var(--hero-b), transparent 26%);
}

.ck-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
  gap: 22px;
  align-items: stretch;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 28px;
  background:
    radial-gradient(circle at 88% 12%, var(--hero-a), transparent 28%),
    radial-gradient(circle at 8% 0%, var(--hero-b), transparent 26%),
    linear-gradient(125deg, var(--hero-c) 0%, var(--hero-d) 46%, var(--hero-e) 100%);
  box-shadow: var(--card-shadow);
}

.ck-hero__copy {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
}

.ck-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  margin: 0;
  color: var(--orange);
  font-size: 0.72rem;
  font-weight: 850;
  letter-spacing: 0.14em;
}

.ck-hero h1 {
  margin: 0;
  font-size: clamp(2.2rem, 4vw, 3.2rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.05;
}

.ck-lead {
  margin: 0;
  max-width: 40ch;
  color: var(--muted);
  font-size: 0.98rem;
  line-height: 1.65;
}

.ck-status {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  width: fit-content;
  max-width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
}

.ck-status > i {
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--muted);
}

.ck-status[data-tone='ready'] > i {
  background: var(--orange);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--orange) 18%, transparent);
  animation: ck-pulse 1.6s ease-out infinite;
}

.ck-status[data-tone='done'] > i {
  background: var(--done);
}

.ck-status strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 850;
}

.ck-status small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.ck-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 2px;
}

.ck-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 14px;
  font: inherit;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 160ms ease,
    background 160ms ease,
    border-color 160ms ease,
    opacity 160ms ease;
}

.ck-btn.is-claim {
  min-width: 210px;
  color: #fff;
  background: linear-gradient(135deg, #ff9a45 0%, var(--orange) 55%, #e45a12 100%);
  box-shadow: 0 14px 32px rgb(242 112 33 / 28%);
}

.ck-btn.is-claim span {
  display: grid;
  gap: 2px;
  text-align: left;
}

.ck-btn.is-claim strong {
  font-size: 0.98rem;
}

.ck-btn.is-claim small {
  font-size: 0.72rem;
  font-weight: 650;
  opacity: 0.9;
}

.ck-btn.is-claim.is-claimed {
  background: linear-gradient(135deg, #58d39a, #2fb978 60%, #1f9e66);
  box-shadow: 0 14px 32px rgb(47 185 120 / 24%);
}

.ck-btn.is-claim.is-burst {
  animation: ck-burst 700ms ease;
}

.ck-btn.is-ghost {
  color: var(--orange-deep);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  border-color: color-mix(in srgb, var(--orange) 35%, var(--line));
}

.ck-btn.is-primary {
  color: #fff;
  background: var(--orange);
}

.ck-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.ck-btn:disabled {
  cursor: default;
  opacity: 0.72;
  transform: none;
}

.ck-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;
}

.ck-metrics article {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 14px 14px 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
}

.ck-metrics small {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.ck-metrics strong {
  font-size: 1.45rem;
  font-weight: 900;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.ck-metrics em {
  margin-left: 3px;
  color: var(--orange);
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 750;
}

.ck-hero__visual {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 280px;
  overflow: hidden;
  border-radius: 22px;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
}

.ck-orb {
  position: absolute;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(255 186 100 / 45%), transparent 68%);
  filter: blur(4px);
}

.ck-hero__visual img {
  position: relative;
  z-index: 1;
  width: min(72%, 220px);
  filter: drop-shadow(0 18px 28px rgb(242 112 33 / 22%));
  animation: ck-float 4.5s ease-in-out infinite;
}

.ck.is-dark .ck-hero__visual img {
  mix-blend-mode: normal;
}

.ck-hero__badge {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 1;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 999px;
  color: #fff;
  background: color-mix(in srgb, var(--orange) 92%, #000);
  font-size: 0.78rem;
  font-weight: 850;
}

.ck-body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
  gap: 16px;
  max-width: 1180px;
  margin: 18px auto 0;
}

.ck-panel {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface);
  box-shadow: var(--card-shadow);
}

.ck-panel > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}

.ck-panel h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.ck-panel header p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.ck-panel header > span:not(.ck-user) {
  color: var(--orange);
  font-size: 0.78rem;
  font-weight: 850;
  white-space: nowrap;
}

.ck-track {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.ck-track article {
  position: relative;
  display: grid;
  gap: 4px;
  place-items: center;
  min-height: 96px;
  padding: 12px 6px 10px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--track);
  text-align: center;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease;
}

.ck-track__day {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 800;
}

.ck-track article > strong {
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.ck-track article > small {
  color: var(--muted);
  font-size: 0.66rem;
}

.ck-track article > i {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--done);
  font-size: 0.82rem;
}

.ck-track article.is-active {
  border-color: color-mix(in srgb, var(--orange) 55%, var(--line));
  background: color-mix(in srgb, var(--orange) 12%, var(--surface));
  box-shadow: 0 10px 24px rgb(242 112 33 / 12%);
  transform: translateY(-2px);
}

.ck-track article.is-done:not(.is-active) {
  color: color-mix(in srgb, var(--ink) 78%, var(--orange));
}

.ck-track article.is-milestone {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(145deg, #ff9a45, var(--orange));
}

.ck-track article.is-milestone .ck-track__day,
.ck-track article.is-milestone > small {
  color: rgb(255 255 255 / 78%);
}

.ck-track article.is-milestone > i {
  color: #fff;
}

.ck-progress {
  height: 6px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--line);
}

.ck-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ffb15a, var(--orange));
  transition: width 360ms ease;
}

.ck-tips {
  display: grid;
  gap: 10px;
  margin: 18px 0 0;
  padding: 14px 16px;
  list-style: none;
  border: 1px dashed color-mix(in srgb, var(--orange) 28%, var(--line));
  border-radius: 16px;
  background: var(--soft);
}

.ck-tips li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.4;
}

.ck-tips i {
  color: var(--orange);
  font-size: 0.95rem;
}

.ck-user {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 180px;
  min-height: 36px;
  padding: 0 12px 0 6px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--soft);
  color: var(--ink);
  font-size: 0.74rem;
  font-weight: 750;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ck-user em {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(140deg, #f7b267, #ef7b45);
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 850;
}

.ck-week,
.ck-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.ck-week {
  margin-bottom: 8px;
}

.ck-week span {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
  text-align: center;
}

.ck-day {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: 12px;
  color: var(--muted);
  background: var(--day-bg);
  font-size: 0.78rem;
  font-weight: 700;
}

.ck-day.is-empty {
  background: transparent;
}

.ck-day.is-checked {
  color: #fff;
  background: linear-gradient(145deg, #ff9a45, var(--orange));
  box-shadow: 0 8px 16px rgb(242 112 33 / 18%);
}

.ck-day.is-today:not(.is-checked) {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 12%, var(--surface));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--orange) 55%, var(--line));
}

.ck-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 1180px;
  margin: 18px auto 0;
  color: var(--muted);
  font-size: 0.82rem;
}

.ck-foot a {
  margin-left: 14px;
  color: var(--orange-deep);
  font-weight: 750;
  text-decoration: none;
}

.ck-state {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  max-width: 1180px;
  min-height: 420px;
  margin: 0 auto;
  padding: 40px 24px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  text-align: center;
  box-shadow: var(--card-shadow);
}

.ck-state:not(.is-error) {
  display: flex;
  flex-direction: column;
}

.ck-state span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--orange);
  animation: ck-bounce 720ms ease-in-out infinite alternate;
}

.ck-state span + span {
  margin-left: 8px;
}

.ck-state span:nth-child(2) {
  animation-delay: 120ms;
}
.ck-state span:nth-child(3) {
  animation-delay: 240ms;
}

.ck-state p {
  margin: 8px 0 0;
  color: var(--muted);
}

.ck-state.is-error i {
  color: var(--orange);
  font-size: 2rem;
}

.ck-state.is-error h1 {
  margin: 0;
  font-size: 1.3rem;
}

.ck-spin {
  animation: ck-spin 0.85s linear infinite;
}

@keyframes ck-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ck-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--orange) 35%, transparent);
  }
  70% {
    box-shadow: 0 0 0 10px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@keyframes ck-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

@keyframes ck-burst {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.04);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes ck-bounce {
  to {
    transform: translateY(-5px);
    opacity: 0.45;
  }
}

@media (max-width: 980px) {
  .ck-hero,
  .ck-body {
    grid-template-columns: 1fr;
  }

  .ck-hero__visual {
    min-height: 220px;
  }

  .ck-track {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .ck-track article:nth-child(n + 5) {
    grid-column: span 1;
  }
}

@media (max-width: 640px) {
  .ck {
    padding: 18px 14px 28px;
  }

  .ck-hero {
    padding: 20px;
    border-radius: 22px;
  }

  .ck-metrics,
  .ck-track {
    grid-template-columns: 1fr 1fr;
  }

  .ck-track article:last-child {
    grid-column: 1 / -1;
  }

  .ck-btn.is-claim,
  .ck-btn.is-ghost {
    width: 100%;
  }

  .ck-hero__actions {
    display: grid;
  }

  .ck-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .ck-foot a {
    margin-left: 0;
    margin-right: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ck-hero__visual img,
  .ck-status[data-tone='ready'] > i,
  .ck-btn.is-claim.is-burst,
  .ck-spin,
  .ck-state span {
    animation: none !important;
  }
}
</style>
