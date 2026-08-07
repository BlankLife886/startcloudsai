<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { getCheckinState, claimDailyCheckin } from '@/services/checkinApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'

const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()
const { applyWalletSnapshot, refreshWalletBalance } = useClientWalletBalance()

const loading = ref(true)
const claiming = ref(false)
const loadError = ref('')
const state = ref(null)
const weekLabels = ['日', '一', '二', '三', '四', '五', '六']

const rewardItems = computed(() => (Array.isArray(state.value?.rewards) ? state.value.rewards : []))
const todayChecked = computed(() => state.value?.todayChecked === true)
const activityEnabled = computed(() => state.value?.enabled !== false)
const claimReward = computed(() => Number(state.value?.claimRewardCents || 0))
const activeCycleDay = computed(() => Number(state.value?.claimCycleDay || 1))
const displayName = computed(
  () => authStore.user?.username || authStore.user?.email?.split('@')[0] || '创作者',
)

const calendarDays = computed(() => {
  const monthValue = String(state.value?.month || '')
  const [year, month] = monthValue.split('-').map(Number)
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
  return year && month ? `${year} 年 ${Number(month)} 月` : '本月签到'
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
    if (result?.alreadyChecked) notificationService.info('今天已经签到过了')
    else
      notificationService.success(`签到成功，获得 ${formatPoints(result?.claimedRewardCents || 0)}`)
  } catch (error) {
    notificationService.error(error?.message || '签到失败，请稍后重试')
  } finally {
    claiming.value = false
  }
}

onMounted(load)
</script>

<template>
  <div
    class="checkin-page"
    :class="{ 'is-dark': appearanceStore.isDark, 'is-light': !appearanceStore.isDark }"
  >
    <div class="checkin-atmosphere" aria-hidden="true"><span></span><span></span><span></span></div>

    <main class="checkin-shell">
      <header class="checkin-header">
        <div>
          <p><i class="bi bi-stars"></i> DAILY CREATOR REWARDS</p>
          <h1>每日签到</h1>
          <span>把每一次回来，都变成下一次创作的能量。</span>
        </div>
        <div class="checkin-user-chip">
          <span>{{ displayName.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ displayName }}</strong
            ><small>{{ authStore.user?.email }}</small>
          </div>
        </div>
      </header>

      <div v-if="loading" class="checkin-loading" aria-live="polite">
        <span></span><span></span><span></span>
      </div>
      <section v-else-if="loadError" class="checkin-error">
        <i class="bi bi-cloud-slash"></i>
        <h2>签到活动加载失败</h2>
        <p>{{ loadError }}</p>
        <button type="button" @click="load">重新加载</button>
      </section>

      <template v-else-if="state">
        <section class="checkin-hero">
          <div class="checkin-hero__copy">
            <span class="checkin-live" :class="{ 'is-off': !activityEnabled }">
              <i></i>{{ activityEnabled ? '活动进行中' : '活动已暂停' }}
            </span>
            <h2>{{ state.campaignTitle }}</h2>
            <p>连续签到奖励逐日提升，第 7 天可领取本周期最高奖励。</p>
            <div class="checkin-metrics">
              <div>
                <span>连续签到</span><strong>{{ state.currentStreak }}</strong
                ><small>天</small>
              </div>
              <div>
                <span>本月获得</span><strong>{{ state.monthRewardCents }}</strong
                ><small>积分</small>
              </div>
              <div>
                <span>累计签到</span><strong>{{ state.totalCheckins }}</strong
                ><small>次</small>
              </div>
            </div>
          </div>

          <div class="checkin-action-card" :class="{ 'is-claimed': todayChecked }">
            <div class="checkin-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="checkin-action-card__date">{{ state.today }}</div>
            <button
              type="button"
              class="checkin-button"
              :disabled="claiming || todayChecked || !activityEnabled"
              @click="claim"
            >
              <span class="checkin-button__icon">
                <i class="bi" :class="todayChecked ? 'bi-check-lg' : 'bi-calendar-check'"></i>
              </span>
              <strong>{{
                todayChecked ? '今日已签到' : claiming ? '正在签到…' : '立即签到'
              }}</strong>
              <small v-if="activityEnabled">
                {{
                  todayChecked ? `明日 +${state.nextRewardCents} 积分` : `领取 ${claimReward} 积分`
                }}
              </small>
              <small v-else>等待活动重新开放</small>
            </button>
          </div>
        </section>

        <section class="reward-board">
          <header>
            <div>
              <span>7 DAY REWARD LOOP</span>
              <h2>连续签到奖励</h2>
            </div>
            <p>完成第 7 天后，奖励周期重新开始，连续天数仍会保留。</p>
          </header>
          <div class="reward-track">
            <article
              v-for="reward in rewardItems"
              :key="reward.day"
              :class="{
                'is-active': reward.day === activeCycleDay,
                'is-done': todayChecked && reward.day <= state.todayRecord?.cycleDay,
                'is-milestone': reward.milestone,
              }"
            >
              <span>DAY {{ String(reward.day).padStart(2, '0') }}</span>
              <div>
                <i class="bi" :class="reward.milestone ? 'bi-gem' : 'bi-lightning-charge-fill'"></i>
              </div>
              <strong>+{{ reward.rewardCents }}</strong>
              <small>积分</small>
              <em v-if="reward.milestone">里程碑</em>
              <i
                v-if="todayChecked && reward.day === state.todayRecord?.cycleDay"
                class="bi bi-check-circle-fill reward-check"
              ></i>
            </article>
          </div>
          <div class="reward-progress">
            <span
              :style="{
                width: `${Math.min(100, ((activeCycleDay - (todayChecked ? 0 : 1)) / 7) * 100)}%`,
              }"
            ></span>
          </div>
        </section>

        <section class="checkin-lower-grid">
          <div class="calendar-card">
            <header>
              <div>
                <span>MONTHLY FOOTPRINT</span>
                <h2>{{ monthTitle }}</h2>
              </div>
              <strong>{{ state.monthRecords?.length || 0 }} 天已签到</strong>
            </header>
            <div class="calendar-week">
              <span v-for="label in weekLabels" :key="label">{{ label }}</span>
            </div>
            <div class="calendar-grid">
              <div
                v-for="cell in calendarDays"
                :key="cell.key"
                class="calendar-day"
                :class="{
                  'is-checked': cell.record,
                  'is-today': cell.today,
                  'is-empty': !cell.day,
                }"
              >
                <template v-if="cell.day">
                  <span>{{ cell.day }}</span>
                  <i v-if="cell.record" class="bi bi-check-lg"></i>
                  <small v-if="cell.record">+{{ cell.record.rewardCents }}</small>
                </template>
              </div>
            </div>
          </div>

          <aside class="retention-card">
            <div class="retention-card__mark"><i class="bi bi-rocket-takeoff"></i></div>
            <span>KEEP CREATING</span>
            <h2>积分不只是奖励，<br />也是下一张作品。</h2>
            <p>签到积分会直接进入钱包，可用于文生图、设计稿、角色设定与更多创作工具。</p>
            <div class="tomorrow-reward">
              <div>
                <small>{{ todayChecked ? '明日签到' : '今日签到' }}</small
                ><strong>+{{ todayChecked ? state.nextRewardCents : claimReward }} 积分</strong>
              </div>
              <i class="bi bi-arrow-up-right"></i>
            </div>
            <div class="retention-actions">
              <RouterLink to="/studio">开始创作</RouterLink>
              <RouterLink to="/wallet">查看钱包</RouterLink>
            </div>
          </aside>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.checkin-page {
  --ck-text: #1a1825;
  --ck-muted: rgb(26 24 37 / 57%);
  --ck-line: rgb(26 24 37 / 10%);
  --ck-card: rgb(255 255 255 / 88%);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 34px clamp(16px, 3vw, 38px) 84px;
  overflow: clip;
  color: var(--ck-text);
  background: linear-gradient(180deg, #f7f3ff 0%, #eef3ff 52%, #f8fafc 100%);
}
.checkin-page.is-dark {
  --ck-text: #f7f4ff;
  --ck-muted: rgb(247 244 255 / 58%);
  --ck-line: rgb(255 255 255 / 12%);
  --ck-card: rgb(25 22 37 / 90%);
  background: linear-gradient(180deg, #120f1e, #161426 52%, #0f1018);
}
.checkin-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.checkin-atmosphere span {
  position: absolute;
  border-radius: 50%;
  filter: blur(2px);
}
.checkin-atmosphere span:nth-child(1) {
  top: -390px;
  left: -210px;
  width: 680px;
  height: 680px;
  background: rgb(139 92 246 / 18%);
}
.checkin-atmosphere span:nth-child(2) {
  top: -420px;
  right: -180px;
  width: 700px;
  height: 700px;
  background: rgb(56 189 248 / 13%);
}
.checkin-atmosphere span:nth-child(3) {
  top: 520px;
  left: 40%;
  width: 380px;
  height: 380px;
  background: rgb(251 191 36 / 7%);
}
.checkin-shell {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 20px;
  width: min(1240px, 100%);
  margin: 0 auto;
}
.checkin-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 0 4px 4px;
}
.checkin-header p {
  margin: 0 0 8px;
  color: #725bff;
  font:
    800 0.66rem/1 ui-monospace,
    monospace;
  letter-spacing: 0.14em;
}
.checkin-header p i {
  margin-right: 7px;
}
.checkin-header h1 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 2.65rem);
  letter-spacing: -0.055em;
}
.checkin-header > div > span {
  display: block;
  margin-top: 8px;
  color: var(--ck-muted);
  font-size: 0.86rem;
}
.checkin-user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 270px;
  padding: 8px 13px 8px 8px;
  border: 1px solid var(--ck-line);
  border-radius: 999px;
  background: var(--ck-card);
  backdrop-filter: blur(14px);
}
.checkin-user-chip > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #6552f4, #b54fd7);
  font-weight: 800;
}
.checkin-user-chip strong,
.checkin-user-chip small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkin-user-chip strong {
  font-size: 0.76rem;
}
.checkin-user-chip small {
  max-width: 185px;
  margin-top: 2px;
  color: var(--ck-muted);
  font-size: 0.62rem;
}
.checkin-hero {
  display: grid;
  grid-template-columns: 1.32fr 0.68fr;
  min-height: 430px;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 13%);
  border-radius: 30px;
  color: #fff;
  background:
    radial-gradient(circle at 5% 0%, rgb(139 92 246 / 42%), transparent 36%),
    radial-gradient(circle at 82% 110%, rgb(236 72 153 / 25%), transparent 42%),
    linear-gradient(145deg, #171226, #0b0c12 75%);
  box-shadow: 0 34px 75px rgb(45 32 90 / 20%);
}
.checkin-hero__copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(34px, 5vw, 68px);
}
.checkin-live {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  color: #c4b5fd;
  background: rgb(255 255 255 / 5%);
  font-size: 0.66rem;
  font-weight: 750;
}
.checkin-live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 4px rgb(34 197 94 / 13%);
}
.checkin-live.is-off i {
  background: #94a3b8;
  box-shadow: none;
}
.checkin-hero__copy h2 {
  max-width: 650px;
  margin: 24px 0 0;
  font-size: clamp(2.5rem, 5vw, 4.7rem);
  line-height: 1.02;
  letter-spacing: -0.07em;
}
.checkin-hero__copy > p {
  max-width: 520px;
  margin: 20px 0 0;
  color: rgb(255 255 255 / 57%);
  font-size: 0.88rem;
  line-height: 1.75;
}
.checkin-metrics {
  display: flex;
  gap: 35px;
  margin-top: 42px;
}
.checkin-metrics > div {
  position: relative;
}
.checkin-metrics > div + div::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -18px;
  width: 1px;
  content: '';
  background: rgb(255 255 255 / 12%);
}
.checkin-metrics span {
  display: block;
  margin-bottom: 5px;
  color: rgb(255 255 255 / 45%);
  font-size: 0.64rem;
}
.checkin-metrics strong {
  font-size: 1.65rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.checkin-metrics small {
  margin-left: 4px;
  color: #c4b5fd;
  font-size: 0.64rem;
}
.checkin-action-card {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 430px;
  overflow: hidden;
  background: linear-gradient(145deg, rgb(255 255 255 / 6%), rgb(255 255 255 / 1%));
  border-left: 1px solid rgb(255 255 255 / 8%);
}
.checkin-action-card__date {
  position: absolute;
  top: 30px;
  right: 30px;
  color: rgb(255 255 255 / 42%);
  font:
    700 0.62rem ui-monospace,
    monospace;
}
.checkin-orbit {
  position: absolute;
  width: 340px;
  height: 340px;
  border: 1px solid rgb(196 181 253 / 13%);
  border-radius: 50%;
  box-shadow:
    0 0 0 35px rgb(196 181 253 / 3%),
    0 0 0 70px rgb(196 181 253 / 2%);
  animation: orbit-float 6s ease-in-out infinite;
}
.checkin-orbit i {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c4b5fd;
  box-shadow: 0 0 18px #a78bfa;
}
.checkin-orbit i:nth-child(1) {
  top: 24px;
  left: 80px;
}
.checkin-orbit i:nth-child(2) {
  right: 10px;
  bottom: 110px;
}
.checkin-orbit i:nth-child(3) {
  bottom: 24px;
  left: 65px;
}
.checkin-button {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-direction: column;
  width: 190px;
  height: 190px;
  color: #1a1427;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(145deg, #f9a8d4, #c4b5fd 53%, #a5f3fc);
  box-shadow:
    0 25px 70px rgb(168 85 247 / 35%),
    inset 0 1px 1px rgb(255 255 255 / 75%);
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}
.checkin-button:hover:not(:disabled) {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 34px 80px rgb(168 85 247 / 45%);
}
.checkin-button:disabled {
  cursor: default;
}
.checkin-button__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-top: 33px;
  border-radius: 50%;
  background: rgb(255 255 255 / 55%);
  font-size: 1.2rem;
}
.checkin-button strong {
  margin-top: 12px;
  font-size: 1rem;
}
.checkin-button small {
  margin-top: 5px;
  font-size: 0.64rem;
  opacity: 0.62;
}
.checkin-action-card.is-claimed .checkin-button {
  background: linear-gradient(145deg, #bbf7d0, #a7f3d0 50%, #bfdbfe);
}
.reward-board,
.calendar-card {
  padding: clamp(24px, 4vw, 38px);
  border: 1px solid var(--ck-line);
  border-radius: 25px;
  background: var(--ck-card);
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 45px rgb(44 31 86 / 7%);
}
.reward-board > header,
.calendar-card > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}
.reward-board header span,
.calendar-card header span,
.retention-card > span {
  color: #725bff;
  font:
    800 0.62rem ui-monospace,
    monospace;
  letter-spacing: 0.13em;
}
.reward-board header h2,
.calendar-card header h2 {
  margin: 7px 0 0;
  font-size: 1.35rem;
}
.reward-board header p {
  max-width: 470px;
  margin: 0;
  color: var(--ck-muted);
  font-size: 0.72rem;
  line-height: 1.6;
  text-align: right;
}
.reward-track {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 10px;
  margin-top: 25px;
}
.reward-track article {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 156px;
  padding: 13px 8px;
  border: 1px solid var(--ck-line);
  border-radius: 16px;
  background: rgb(255 255 255 / 32%);
  transition: 160ms ease;
}
.is-dark .reward-track article {
  background: rgb(255 255 255 / 3%);
}
.reward-track article.is-active {
  border-color: rgb(114 91 255 / 55%);
  background: rgb(114 91 255 / 9%);
  transform: translateY(-3px);
  box-shadow: 0 13px 28px rgb(114 91 255 / 12%);
}
.reward-track article.is-milestone {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(145deg, #6d54f6, #a24be8);
}
.reward-track article > span {
  color: var(--ck-muted);
  font:
    750 0.55rem ui-monospace,
    monospace;
}
.reward-track article.is-milestone > span,
.reward-track article.is-milestone > small {
  color: rgb(255 255 255 / 68%);
}
.reward-track article > div {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin: 10px 0 6px;
  color: #735fff;
  border-radius: 12px;
  background: rgb(114 91 255 / 10%);
}
.reward-track article.is-milestone > div {
  color: #fff;
  background: rgb(255 255 255 / 15%);
}
.reward-track article > strong {
  font-size: 1rem;
}
.reward-track article > small {
  margin-top: 2px;
  color: var(--ck-muted);
  font-size: 0.57rem;
}
.reward-track article > em {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 5px;
  border-radius: 999px;
  background: rgb(255 255 255 / 17%);
  font-size: 0.5rem;
  font-style: normal;
}
.reward-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: #22c55e;
}
.reward-progress {
  height: 4px;
  margin-top: 18px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--ck-line);
}
.reward-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6d54f6, #d946ef);
  transition: width 400ms ease;
}
.checkin-lower-grid {
  display: grid;
  grid-template-columns: 1.35fr 0.65fr;
  gap: 20px;
}
.calendar-card header > strong {
  color: var(--ck-muted);
  font-size: 0.68rem;
}
.calendar-week,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 7px;
}
.calendar-week {
  margin-top: 24px;
}
.calendar-week span {
  color: var(--ck-muted);
  font-size: 0.6rem;
  text-align: center;
}
.calendar-grid {
  margin-top: 8px;
}
.calendar-day {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 62px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: var(--ck-muted);
  background: rgb(125 110 190 / 4%);
  font-size: 0.7rem;
}
.calendar-day.is-empty {
  background: transparent;
}
.calendar-day.is-checked {
  color: #fff;
  background: linear-gradient(145deg, #7560f5, #a64be4);
  box-shadow: 0 8px 16px rgb(117 96 245 / 17%);
}
.calendar-day.is-today {
  border-color: #7c66ff;
}
.calendar-day i {
  position: absolute;
  top: 6px;
  right: 7px;
  font-size: 0.55rem;
}
.calendar-day small {
  font-size: 0.5rem;
  opacity: 0.72;
}
.retention-card {
  position: relative;
  overflow: hidden;
  padding: clamp(27px, 4vw, 40px);
  color: #fff;
  border-radius: 25px;
  background:
    radial-gradient(circle at 100% 0%, rgb(236 72 153 / 30%), transparent 40%),
    linear-gradient(145deg, #171326, #0b0c12);
  box-shadow: 0 20px 48px rgb(30 24 54 / 18%);
}
.retention-card::after {
  position: absolute;
  right: -80px;
  bottom: -110px;
  width: 270px;
  height: 270px;
  content: '';
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 50%;
  box-shadow:
    0 0 0 35px rgb(255 255 255 / 3%),
    0 0 0 70px rgb(255 255 255 / 2%);
}
.retention-card__mark {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  margin-bottom: 36px;
  color: #1a1427;
  border-radius: 15px;
  background: linear-gradient(135deg, #f9a8d4, #c4b5fd);
  font-size: 1.15rem;
}
.retention-card h2 {
  margin: 14px 0 0;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  line-height: 1.16;
  letter-spacing: -0.05em;
}
.retention-card > p {
  margin: 18px 0 0;
  color: rgb(255 255 255 / 52%);
  font-size: 0.75rem;
  line-height: 1.75;
}
.tomorrow-reward {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28px;
  padding: 15px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 14px;
  background: rgb(255 255 255 / 5%);
}
.tomorrow-reward small,
.tomorrow-reward strong {
  display: block;
}
.tomorrow-reward small {
  color: rgb(255 255 255 / 45%);
  font-size: 0.6rem;
}
.tomorrow-reward strong {
  margin-top: 4px;
  font-size: 0.9rem;
}
.tomorrow-reward > i {
  color: #c4b5fd;
}
.retention-actions {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 9px;
  margin-top: 20px;
}
.retention-actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  color: #171326;
  border-radius: 10px;
  background: #fff;
  font-size: 0.72rem;
  font-weight: 750;
  text-decoration: none;
}
.retention-actions a + a {
  color: #fff;
  border: 1px solid rgb(255 255 255 / 14%);
  background: transparent;
}
.checkin-loading,
.checkin-error {
  display: grid;
  place-items: center;
  min-height: 520px;
  border: 1px solid var(--ck-line);
  border-radius: 28px;
  background: var(--ck-card);
}
.checkin-loading {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.checkin-loading span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #725bff;
  animation: pulse 800ms ease-in-out infinite alternate;
}
.checkin-loading span:nth-child(2) {
  animation-delay: 140ms;
}
.checkin-loading span:nth-child(3) {
  animation-delay: 280ms;
}
.checkin-error {
  align-content: center;
  text-align: center;
}
.checkin-error > i {
  color: #725bff;
  font-size: 2rem;
}
.checkin-error h2 {
  margin: 15px 0 0;
}
.checkin-error p {
  margin: 7px 0 0;
  color: var(--ck-muted);
}
.checkin-error button {
  margin-top: 17px;
  padding: 10px 15px;
  border: 1px solid var(--ck-line);
  border-radius: 10px;
  color: var(--ck-text);
  background: var(--ck-card);
}
@keyframes pulse {
  to {
    transform: translateY(-5px);
    opacity: 0.45;
  }
}
@keyframes orbit-float {
  50% {
    transform: rotate(5deg) scale(1.03);
  }
}
@media (max-width: 950px) {
  .checkin-hero,
  .checkin-lower-grid {
    grid-template-columns: 1fr;
  }
  .checkin-action-card {
    min-height: 340px;
    border-top: 1px solid rgb(255 255 255 / 8%);
    border-left: 0;
  }
  .reward-track {
    grid-template-columns: repeat(4, 1fr);
  }
  .checkin-hero__copy h2 {
    font-size: 3rem;
  }
}
@media (max-width: 620px) {
  .checkin-page {
    padding: 22px 12px 58px;
  }
  .checkin-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .checkin-user-chip {
    max-width: 100%;
  }
  .checkin-hero {
    border-radius: 23px;
  }
  .checkin-hero__copy {
    padding: 30px 22px;
  }
  .checkin-hero__copy h2 {
    font-size: 2.55rem;
  }
  .checkin-metrics {
    justify-content: space-between;
    gap: 18px;
  }
  .checkin-metrics > div + div::before {
    left: -10px;
  }
  .checkin-action-card {
    min-height: 320px;
  }
  .checkin-button {
    width: 168px;
    height: 168px;
  }
  .checkin-button__icon {
    margin-top: 26px;
  }
  .reward-board,
  .calendar-card,
  .retention-card {
    padding: 22px 16px;
    border-radius: 20px;
  }
  .reward-board > header {
    align-items: flex-start;
    flex-direction: column;
  }
  .reward-board header p {
    text-align: left;
  }
  .reward-track {
    grid-template-columns: repeat(2, 1fr);
  }
  .reward-track article {
    min-height: 135px;
  }
  .calendar-day {
    min-height: 48px;
  }
  .retention-actions {
    flex-direction: column;
  }
  .retention-actions a {
    width: 100%;
    box-sizing: border-box;
  }
}
</style>
