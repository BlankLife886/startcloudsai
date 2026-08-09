<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { createGrowthGroup, getGrowthPrograms, joinGrowthGroup } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import heroArt from '@/assets/incentives/group-hero-characters.png'

const giftArt = '/创作激励素材包/奖励礼盒插画-transparent.png'
const coinArt = '/创作激励素材包/金币图标-transparent.png'

const route = useRoute()
const router = useRouter()
const appearanceStore = useAppearanceStore()
const loading = ref(true)
const submitting = ref(false)
const loadError = ref('')
const growthData = ref(null)

const rules = computed(() => growthData.value?.rules || {})
const group = computed(() => growthData.value?.group || null)
const inviteCode = computed(() =>
  String(route.query.code || '')
    .trim()
    .toUpperCase(),
)
const targetMembers = computed(() =>
  Number(group.value?.targetMembers || rules.value.groupTargetMembers || 0),
)
const memberCount = computed(() => Number(group.value?.memberCount || (loading.value ? 0 : 1)))
const remainingMembers = computed(() => Math.max(0, targetMembers.value - memberCount.value))
const rewardCents = computed(() =>
  Number(group.value?.rewardCents ?? rules.value.groupRewardCents ?? 0),
)
const rewardNumber = computed(() =>
  rewardCents.value > 0 ? formatPoints(rewardCents.value).replace(/\s*积分\s*$/, '') : '—',
)
const slots = computed(() => {
  const target = Math.max(3, targetMembers.value || 3)
  return Array.from({ length: target }, (_, index) => ({
    filled: index < memberCount.value,
    owner: index === 0,
  }))
})
const actionLabel = computed(() => {
  if (submitting.value) return inviteCode.value && !group.value ? '加入中…' : '处理中…'
  if (group.value) return group.value.status === 'completed' ? '奖励已到账' : '邀请好友'
  return inviteCode.value ? '加入好友拼团' : '发起拼团'
})

async function loadGrowth() {
  loading.value = true
  loadError.value = ''
  try {
    growthData.value = await getGrowthPrograms()
  } catch (error) {
    loadError.value = error?.message || '拼团信息读取失败'
  } finally {
    loading.value = false
  }
}

async function shareGroup() {
  if (!group.value?.code) return
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('code', group.value.code)
  const shareData = { title: '好友拼团', text: '和我一起拼团，成团后领取积分奖励。', url: url.href }
  try {
    if (navigator.share) await navigator.share(shareData)
    else {
      await navigator.clipboard.writeText(url.href)
      notificationService.success('邀请链接已复制')
    }
  } catch (error) {
    if (error?.name !== 'AbortError') notificationService.error('邀请链接分享失败')
  }
}

async function runPrimaryAction() {
  if (submitting.value || rules.value.groupEnabled === false) return
  if (group.value) {
    if (group.value.status !== 'completed') await shareGroup()
    return
  }

  submitting.value = true
  try {
    if (inviteCode.value) {
      await joinGrowthGroup(inviteCode.value)
      notificationService.success('已加入好友拼团')
    } else {
      await createGrowthGroup()
      notificationService.success('拼团已发起，现在邀请好友加入吧')
    }
    await loadGrowth()
  } catch (error) {
    notificationService.error(error?.message || '拼团操作失败')
  } finally {
    submitting.value = false
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
  <main class="group-page" :class="{ 'is-dark': appearanceStore.isDark }">
    <section class="group-hero">
      <div class="group-shell group-hero__inner">
        <div class="group-hero__copy">
          <button type="button" class="group-back" @click="goBack">
            <i class="bi bi-arrow-left" aria-hidden="true"></i>
            返回上一页
          </button>
          <h1>好友拼团</h1>
          <p>和好友一起创作，一起解锁积分奖励。</p>

          <div class="group-target" aria-label="拼团目标">
            <span class="group-target__coin" aria-hidden="true">
              <img :src="coinArt" alt="" loading="lazy" />
            </span>
            <span class="group-target__divider"></span>
            <p>
              目标 <strong>{{ loading ? '—' : targetMembers }}</strong> 人，成团后每人获得
              <strong>{{ rewardNumber }}</strong> 积分。
            </p>
          </div>
        </div>

        <div class="group-hero__visual" aria-hidden="true">
          <span class="group-hero__sun"></span>
          <span class="group-hero__spark is-a"></span>
          <span class="group-hero__spark is-b"></span>
          <span class="group-hero__spark is-c"></span>
          <img class="group-hero__art" :src="heroArt" alt="" loading="lazy" />
        </div>
      </div>
    </section>

    <section class="group-shell group-panel" aria-label="好友拼团进度">
      <div v-if="loadError" class="group-error">
        <span>{{ loadError }}</span>
        <button type="button" @click="loadGrowth">重新加载</button>
      </div>

      <div class="group-panel__main">
        <div class="group-progress-block">
          <h2>拼团进度</h2>
          <div class="member-track" :style="{ '--slot-count': slots.length }">
            <div
              v-for="(slot, index) in slots"
              :key="index"
              class="member-slot"
              :class="{ 'is-filled': slot.filled }"
            >
              <span><i class="bi bi-person-fill"></i></span>
              <strong>{{ slot.owner ? '发起人' : slot.filled ? '已加入' : '待加入' }}</strong>
            </div>
          </div>
          <p class="group-remaining">
            <template v-if="remainingMembers > 0">
              还差 <strong>{{ remainingMembers }}</strong> 人即可成团，邀请好友一起加入吧！
            </template>
            <template v-else>拼团已完成，奖励将自动发放到每位成员账户。</template>
          </p>
        </div>

        <div class="group-reward">
          <span class="group-reward__gift" aria-hidden="true">
            <img :src="giftArt" alt="" loading="lazy" />
          </span>
          <div class="group-reward__copy">
            <span>成团奖励</span>
            <strong>{{ rewardNumber }} 积分</strong>
            <small>成团后每人获得</small>
          </div>
          <button
            type="button"
            :disabled="
              loading || submitting || rules.groupEnabled === false || group?.status === 'completed'
            "
            @click="runPrimaryAction"
          >
            {{ actionLabel }}
            <i v-if="group?.status !== 'completed'" class="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>

      <div class="group-steps" aria-label="拼团步骤">
        <div class="group-step">
          <span><i class="bi bi-people-fill"></i></span>
          <p>
            <strong>邀请好友</strong>
            <small>分享链接给好友</small>
          </p>
        </div>
        <i class="group-step-arrow bi bi-chevron-right" aria-hidden="true"></i>
        <div class="group-step">
          <span><i class="bi bi-person-plus-fill"></i></span>
          <p>
            <strong>好友加入</strong>
            <small>好友点击链接加入拼团</small>
          </p>
        </div>
        <i class="group-step-arrow bi bi-chevron-right" aria-hidden="true"></i>
        <div class="group-step">
          <span class="is-art"><img :src="giftArt" alt="" loading="lazy" /></span>
          <p>
            <strong>成团领奖</strong>
            <small>成团后每人获得 {{ rewardNumber }} 积分</small>
          </p>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.group-page {
  --ink: #1c1d1f;
  --muted: #868686;
  --orange: #ff6900;
  --orange-deep: #f45f00;
  --soft-orange: #fff1e6;
  --line: #ededed;
  --line-soft: #f2f2f2;
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-soft: #fff9f4;
  --surface-warm: #fffdf8;
  --hero-a: rgb(255 210 120 / 42%);
  --hero-b: rgb(255 220 150 / 34%);
  --hero-c: #fff8e9;
  --hero-d: #fffdf8;
  --hero-e: #ffffff;
  --hero-line: #ffe7d3;
  --body: #333333;
  --back: #8a8a8a;
  --soft-muted: #8e8e8e;
  --step-muted: #7d7d7d;
  --step-arrow: #ffd7bb;
  --divider: #eeeeee;
  --slot-bg: #f5f5f5;
  --slot-border: #e9e9e9;
  --slot-icon: #c6c6c6;
  --slot-muted: #999999;
  --track-dash: #e4e4e4;
  --track-filled: #ffa268;
  --target-bg: rgb(255 255 255 / 92%);
  --target-shadow: 0 8px 22px rgb(224 137 62 / 7%);
  --panel-bg: rgb(255 255 255 / 97%);
  --panel-shadow: 0 18px 55px rgb(31 39 49 / 10%);
  --error: #a44810;
  width: 100%;
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  overflow-x: clip;
  color: var(--ink);
  background: var(--bg);
}

.group-page.is-dark {
  --ink: #f4eee6;
  --muted: #a79c8f;
  --orange: #ff8a3d;
  --orange-deep: #ffb06a;
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
  --body: #cfc4b6;
  --back: #a79c8f;
  --soft-muted: #a79c8f;
  --step-muted: #a79c8f;
  --step-arrow: rgb(255 138 61 / 45%);
  --divider: #332c24;
  --slot-bg: #181511;
  --slot-border: #3b342c;
  --slot-icon: #5a5248;
  --slot-muted: #a79c8f;
  --track-dash: #3b342c;
  --track-filled: #ff8a3d;
  --target-bg: color-mix(in srgb, var(--surface) 92%, transparent);
  --target-shadow: 0 8px 22px rgb(0 0 0 / 28%);
  --panel-bg: color-mix(in srgb, var(--surface) 97%, transparent);
  --panel-shadow: 0 18px 40px rgb(0 0 0 / 28%);
  --error: #e0a46a;
}

.group-shell {
  width: min(1280px, calc(100% - 64px));
  margin-inline: auto;
}

.group-hero {
  position: relative;
  min-height: clamp(360px, 42vw, 460px);
  overflow: hidden;
  background:
    radial-gradient(circle at 78% 48%, var(--hero-a), transparent 34%),
    radial-gradient(circle at 14% 12%, var(--hero-b), transparent 26%),
    linear-gradient(112deg, var(--hero-c) 0%, var(--hero-d) 48%, var(--hero-e) 100%);
}

.group-hero__inner {
  position: relative;
  display: grid;
  min-height: inherit;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  align-items: center;
  gap: 12px;
}

.group-hero__copy {
  position: relative;
  z-index: 2;
  padding: 28px 0 88px;
}

.group-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 18px;
  padding: 0;
  color: var(--back);
  background: none;
  border: 0;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
}

.group-back:hover {
  color: var(--orange);
}

.group-back i {
  font-size: 1rem;
}

.group-hero h1 {
  margin: 0;
  font-size: clamp(2.8rem, 5.4vw, 4.6rem);
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.group-hero__copy > p {
  margin: 16px 0 0;
  color: var(--body);
  font-size: clamp(1.05rem, 1.8vw, 1.45rem);
  line-height: 1.5;
}

.group-target {
  display: flex;
  width: min(100%, 560px);
  min-height: 88px;
  align-items: center;
  margin-top: 28px;
  padding: 12px 22px;
  background: var(--target-bg);
  border: 2px solid var(--hero-line);
  border-radius: 18px;
  box-shadow: var(--target-shadow);
}

.group-target__coin {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
}

.group-target__coin img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.group-target__divider {
  width: 1px;
  height: 48px;
  margin: 0 18px;
  background: var(--divider);
}

.group-target p {
  margin: 0;
  font-size: clamp(0.95rem, 1.35vw, 1.15rem);
  line-height: 1.45;
}

.group-target strong {
  color: var(--orange);
  font-size: 1.35em;
  font-weight: 850;
}

.group-hero__visual {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  justify-self: end;
  width: min(100%, 520px);
  aspect-ratio: 1;
  min-height: 0;
  pointer-events: none;
}

.group-hero__sun {
  position: absolute;
  inset: 8% 6% 10% 6%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 42% 38%, #ffc06a 0%, #ff8a28 42%, #ff6900 78%, #f25c00 100%);
  box-shadow:
    0 22px 48px rgb(255 120 20 / 24%),
    inset 0 -18px 36px rgb(220 80 0 / 18%);
}

.group-hero__spark {
  position: absolute;
  z-index: 2;
  border-radius: 50%;
  background: #ffd36a;
  box-shadow: 0 0 0 3px rgb(255 255 255 / 45%);
}

.group-hero__spark.is-a {
  top: 12%;
  right: 10%;
  width: 16px;
  height: 16px;
}

.group-hero__spark.is-b {
  top: 22%;
  left: 8%;
  width: 11px;
  height: 11px;
  background: #ffb347;
}

.group-hero__spark.is-c {
  bottom: 18%;
  right: 16%;
  width: 13px;
  height: 13px;
}

.group-hero__art {
  position: relative;
  z-index: 1;
  width: 92%;
  height: 86%;
  margin-top: 4%;
  object-fit: contain;
  object-position: center bottom;
  filter: drop-shadow(0 16px 24px rgb(70 40 10 / 14%));
}

.group-panel {
  position: relative;
  z-index: 3;
  margin-top: -56px;
  margin-bottom: 40px;
  padding: 32px 40px 24px;
  background: var(--panel-bg);
  border: 1px solid var(--line-soft);
  border-radius: 22px;
  box-shadow: var(--panel-shadow);
}

.group-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--error);
  font-size: 0.82rem;
}

.group-error button {
  padding: 0;
  color: var(--orange);
  background: none;
  border: 0;
  font-weight: 800;
  cursor: pointer;
}

.group-panel__main {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 0;
  min-height: 200px;
}

.group-progress-block {
  padding-right: 36px;
  border-right: 1px solid var(--line);
}

.group-progress-block h2 {
  margin: 0 0 22px;
  font-size: 1.2rem;
  font-weight: 850;
}

.member-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--slot-count), minmax(0, 1fr));
}

.member-track::before {
  position: absolute;
  top: 34px;
  right: calc(50% / var(--slot-count));
  left: calc(50% / var(--slot-count));
  height: 2px;
  background: repeating-linear-gradient(90deg, var(--track-dash) 0 7px, transparent 7px 13px);
  content: '';
}

.member-slot {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--slot-muted);
}

.member-slot span {
  display: grid;
  width: 68px;
  height: 68px;
  place-items: center;
  color: var(--slot-icon);
  background: var(--slot-bg);
  border: 4px solid var(--slot-border);
  border-radius: 50%;
  font-size: 1.8rem;
}

.member-slot strong {
  font-size: 0.95rem;
  font-weight: 600;
}

.member-slot.is-filled {
  color: var(--orange);
}

.member-slot.is-filled span {
  color: var(--orange);
  background: var(--surface);
  border-color: var(--hero-line);
}

.member-slot.is-filled:first-child::after {
  position: absolute;
  top: 34px;
  left: calc(50% + 34px);
  width: calc(50% - 34px);
  height: 2px;
  background: repeating-linear-gradient(90deg, var(--track-filled) 0 7px, transparent 7px 13px);
  content: '';
}

.group-remaining {
  margin: 18px 0 0;
  color: var(--muted);
  font-size: 0.95rem;
}

.group-remaining strong {
  color: var(--orange);
  font-size: 1.15em;
}

.group-reward {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding-left: 28px;
}

.group-reward__gift {
  display: grid;
  width: 110px;
  height: 110px;
  place-items: center;
}

.group-reward__gift img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.group-reward__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.group-reward__copy > span {
  font-size: 1rem;
  font-weight: 700;
}

.group-reward__copy > strong {
  margin-top: 6px;
  color: var(--orange);
  font-size: clamp(1.4rem, 2vw, 1.9rem);
  line-height: 1.1;
}

.group-reward__copy > small {
  margin-top: 8px;
  color: var(--soft-muted);
  font-size: 0.88rem;
}

.group-reward button {
  display: inline-flex;
  min-width: 200px;
  height: 72px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 22px;
  color: #fff;
  background: var(--orange);
  border: 0;
  border-radius: 16px;
  box-shadow: 0 9px 20px rgb(255 105 0 / 16%);
  font: inherit;
  font-size: 1.25rem;
  font-weight: 850;
  cursor: pointer;
}

.group-reward button:hover:not(:disabled) {
  background: var(--orange-deep);
}

.group-reward button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.group-steps {
  display: grid;
  grid-template-columns: 1fr 36px 1fr 36px 1fr;
  align-items: center;
  min-height: 96px;
  margin-top: 18px;
  padding: 10px 28px;
  background: var(--surface-soft);
  border-radius: 16px;
}

.group-step {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.group-step > span {
  display: grid;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--orange);
  background: var(--soft-orange);
  border-radius: 50%;
  font-size: 1.35rem;
}

.group-step > span.is-art {
  background: transparent;
}

.group-step > span.is-art img {
  width: 60px;
  height: 60px;
  object-fit: contain;
}

.group-step p {
  display: flex;
  margin: 0;
  flex-direction: column;
  gap: 4px;
}

.group-step strong {
  font-size: 1rem;
}

.group-step small {
  color: var(--step-muted);
  font-size: 0.82rem;
}

.group-step-arrow {
  color: var(--step-arrow);
  font-size: 1.4rem;
  text-align: center;
}

@media (max-width: 1100px) {
  .group-shell {
    width: calc(100% - 40px);
  }

  .group-panel {
    padding: 28px 24px 20px;
  }

  .group-reward {
    grid-template-columns: 90px minmax(0, 1fr);
    padding-left: 20px;
  }

  .group-reward button {
    grid-column: 1 / -1;
    width: 100%;
    min-width: 0;
    height: 60px;
    font-size: 1.1rem;
  }
}

@media (max-width: 820px) {
  .group-hero__inner {
    grid-template-columns: 1fr;
  }

  .group-hero__copy {
    padding: 28px 0 24px;
  }

  .group-hero__visual {
    width: min(100%, 340px);
    justify-self: center;
    margin: 0 auto 8px;
  }

  .group-panel {
    margin-top: -28px;
  }

  .group-panel__main {
    grid-template-columns: 1fr;
  }

  .group-progress-block {
    padding: 0 0 24px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .group-reward {
    padding: 24px 0 8px;
  }

  .group-steps {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    min-height: 0;
    padding: 18px;
  }

  .group-step {
    justify-content: flex-start;
  }

  .group-step-arrow {
    display: none;
  }

  .member-slot span {
    width: 56px;
    height: 56px;
    font-size: 1.45rem;
  }

  .member-track::before,
  .member-slot.is-filled:first-child::after {
    top: 28px;
  }
}
</style>
