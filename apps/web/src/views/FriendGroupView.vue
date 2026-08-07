<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { createGrowthGroup, getGrowthPrograms, joinGrowthGroup } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'

const route = useRoute()
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

onMounted(loadGrowth)
</script>

<template>
  <main class="group-page">
    <section class="group-hero">
      <span class="group-hero__corner" aria-hidden="true"></span>
      <span class="group-hero__sun" aria-hidden="true"></span>
      <div class="group-shell group-hero__inner">
        <div class="group-hero__copy">
          <h1>好友拼团</h1>
          <p>和好友一起创作，一起解锁积分奖励。</p>

          <div class="group-target" aria-label="拼团目标">
            <span class="group-target__coin"><i class="bi bi-star-fill"></i></span>
            <span class="group-target__divider"></span>
            <p>
              目标 <strong>{{ loading ? '—' : targetMembers }}</strong> 人，成团后每人获得
              <strong>{{ rewardNumber }}</strong> 积分。
            </p>
          </div>
        </div>
        <div class="group-hero__asset" aria-hidden="true"></div>
      </div>
    </section>

    <section class="group-shell group-panel" aria-label="好友拼团进度">
      <div v-if="loadError" class="group-error">
        <span>{{ loadError }}</span
        ><button type="button" @click="loadGrowth">重新加载</button>
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
          <span class="group-reward__gift"><i class="bi bi-gift-fill"></i></span>
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
            {{ actionLabel }}<i v-if="group?.status !== 'completed'" class="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>

      <div class="group-steps" aria-label="拼团步骤">
        <div class="group-step">
          <span><i class="bi bi-people-fill"></i></span>
          <p><strong>邀请好友</strong><small>分享链接给好友</small></p>
        </div>
        <i class="group-step-arrow bi bi-chevron-right" aria-hidden="true"></i>
        <div class="group-step">
          <span><i class="bi bi-people-fill"></i></span>
          <p><strong>好友加入</strong><small>好友点击链接加入拼团</small></p>
        </div>
        <i class="group-step-arrow bi bi-chevron-right" aria-hidden="true"></i>
        <div class="group-step">
          <span><i class="bi bi-gift-fill"></i></span>
          <p>
            <strong>成团领奖</strong><small>成团后每人获得 {{ rewardNumber }} 积分</small>
          </p>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.group-page {
  --orange: #ff6900;
  --soft-orange: #fff1e6;
  min-width: 1120px;
  min-height: 100vh;
  overflow: hidden;
  color: #1c1d1f;
  background: #fff;
}
.group-shell {
  width: min(1488px, calc(100% - 192px));
  margin-inline: auto;
}
.group-hero {
  position: relative;
  height: 510px;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 8%, rgb(255 214 116 / 34%), transparent 28%),
    linear-gradient(112deg, #fff8e9 0%, #fff 65%);
}
.group-hero__corner {
  position: absolute;
  top: -165px;
  right: -22px;
  width: 392px;
  height: 392px;
  background: linear-gradient(135deg, #ffd375, #ff9348);
  border-radius: 50%;
}
.group-hero__sun {
  position: absolute;
  right: 122px;
  bottom: -150px;
  width: 785px;
  height: 510px;
  background: linear-gradient(152deg, #ffd14f, #ff9b2f);
  border-radius: 50% 50% 0 0;
  opacity: 0.92;
}
.group-hero__inner {
  position: relative;
  display: grid;
  height: 100%;
  grid-template-columns: 47% 53%;
}
.group-hero__copy {
  position: relative;
  z-index: 2;
  padding-top: 126px;
}
.group-hero h1 {
  margin: 0;
  font-size: 82px;
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0;
}
.group-hero__copy > p {
  margin: 22px 0 0;
  font-size: 28px;
  line-height: 1.5;
}
.group-target {
  display: flex;
  width: 602px;
  height: 102px;
  align-items: center;
  margin-top: 43px;
  padding: 0 28px;
  background: rgb(255 255 255 / 90%);
  border: 2px solid #ffe7d3;
  border-radius: 20px;
  box-shadow: 0 8px 22px rgb(224 137 62 / 6%);
}
.group-target__coin {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
  color: #ff9f19;
  background: #ffd262;
  border: 7px solid #ffb72f;
  border-radius: 50%;
  box-shadow: 0 7px 0 #e99515;
  font-size: 27px;
}
.group-target__divider {
  width: 1px;
  height: 58px;
  margin: 0 25px;
  background: #eee;
}
.group-target p {
  margin: 0;
  white-space: nowrap;
  font-size: 23px;
}
.group-target strong {
  color: var(--orange);
  font-size: 34px;
  font-weight: 850;
}
.group-hero__asset {
  position: relative;
  z-index: 1;
}
.group-panel {
  position: relative;
  z-index: 3;
  min-height: 435px;
  margin-top: -30px;
  padding: 38px 67px 27px;
  background: rgb(255 255 255 / 97%);
  border: 1px solid #f2f2f2;
  border-radius: 24px;
  box-shadow: 0 18px 55px rgb(31 39 49 / 10%);
}
.group-error {
  position: absolute;
  top: 12px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #a44810;
  font-size: 13px;
  transform: translateX(-50%);
}
.group-error button {
  padding: 0;
  color: var(--orange);
  background: none;
  border: 0;
  font-weight: 800;
}
.group-panel__main {
  display: grid;
  min-height: 238px;
  grid-template-columns: 52% 48%;
}
.group-progress-block {
  padding-right: 66px;
  border-right: 1px solid #ededed;
}
.group-progress-block h2 {
  margin: 0 0 31px;
  font-size: 23px;
  font-weight: 850;
}
.member-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--slot-count), minmax(0, 1fr));
}
.member-track::before {
  position: absolute;
  top: 39px;
  right: calc(50% / var(--slot-count));
  left: calc(50% / var(--slot-count));
  height: 2px;
  background: repeating-linear-gradient(90deg, #e4e4e4 0 7px, transparent 7px 13px);
  content: '';
}
.member-slot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 9px;
  color: #999;
}
.member-slot span {
  display: grid;
  width: 82px;
  height: 82px;
  place-items: center;
  color: #c6c6c6;
  background: #f5f5f5;
  border: 5px solid #e9e9e9;
  border-radius: 50%;
  font-size: 43px;
}
.member-slot strong {
  font-size: 20px;
  font-weight: 500;
}
.member-slot.is-filled {
  color: var(--orange);
}
.member-slot.is-filled span {
  color: var(--orange);
  background: #fff;
  border-color: #ffe2cf;
}
.member-slot.is-filled:first-child::after {
  position: absolute;
  top: 39px;
  left: calc(50% + 41px);
  width: calc(50% - 41px);
  height: 2px;
  background: repeating-linear-gradient(90deg, #ffa268 0 7px, transparent 7px 13px);
  content: '';
}
.group-remaining {
  margin: 21px 0 0;
  color: #868686;
  font-size: 17px;
}
.group-remaining strong {
  color: var(--orange);
  font-size: 22px;
}
.group-reward {
  display: grid;
  grid-template-columns: 150px minmax(155px, 1fr) 300px;
  align-items: center;
  padding-left: 42px;
  gap: 13px;
}
.group-reward__gift {
  display: grid;
  width: 112px;
  height: 112px;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, #ff9e35, #ff5d19);
  border-radius: 25px;
  box-shadow: 0 14px 25px rgb(255 102 13 / 20%);
  font-size: 58px;
}
.group-reward__copy {
  display: flex;
  flex-direction: column;
}
.group-reward__copy > span {
  font-size: 20px;
  font-weight: 700;
}
.group-reward__copy > strong {
  margin-top: 8px;
  color: var(--orange);
  font-size: 34px;
  line-height: 1.1;
}
.group-reward__copy > small {
  margin-top: 10px;
  color: #8e8e8e;
  font-size: 16px;
}
.group-reward button {
  display: inline-flex;
  width: 300px;
  height: 90px;
  align-items: center;
  justify-content: center;
  gap: 24px;
  color: #fff;
  background: var(--orange);
  border: 0;
  border-radius: 17px;
  box-shadow: 0 9px 20px rgb(255 105 0 / 15%);
  font-size: 30px;
  font-weight: 850;
}
.group-reward button:hover:not(:disabled) {
  background: #f45f00;
}
.group-reward button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
.group-steps {
  display: grid;
  min-height: 110px;
  grid-template-columns: 1fr 46px 1fr 46px 1fr;
  align-items: center;
  margin-top: 11px;
  padding: 0 51px;
  background: #fff9f4;
  border-radius: 17px;
}
.group-step {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 19px;
}
.group-step > span {
  display: grid;
  width: 66px;
  height: 66px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--orange);
  background: var(--soft-orange);
  border-radius: 50%;
  font-size: 30px;
}
.group-step p {
  display: flex;
  margin: 0;
  flex-direction: column;
  gap: 5px;
}
.group-step strong {
  font-size: 20px;
}
.group-step small {
  color: #7d7d7d;
  font-size: 15px;
}
.group-step-arrow {
  color: #ffd7bb;
  font-size: 29px;
}
@media (max-width: 1360px) {
  .group-shell {
    width: calc(100% - 96px);
  }
  .group-hero h1 {
    font-size: 70px;
  }
  .group-reward {
    grid-template-columns: 110px 1fr 230px;
    padding-left: 30px;
  }
  .group-reward button {
    width: 230px;
    font-size: 25px;
  }
}
@media (max-width: 760px) {
  .group-page {
    min-width: 0;
  }
  .group-shell {
    width: calc(100% - 32px);
  }
  .group-hero {
    height: 460px;
  }
  .group-hero__sun {
    right: -260px;
    bottom: -280px;
  }
  .group-hero__inner {
    display: block;
  }
  .group-hero__copy {
    padding-top: 62px;
  }
  .group-hero h1 {
    font-size: 52px;
  }
  .group-hero__copy > p {
    font-size: 19px;
  }
  .group-target {
    width: 100%;
    height: 86px;
    margin-top: 35px;
    padding: 0 16px;
  }
  .group-target__coin {
    width: 52px;
    height: 52px;
    border-width: 5px;
    font-size: 20px;
  }
  .group-target__divider {
    margin: 0 14px;
  }
  .group-target p {
    white-space: normal;
    font-size: 15px;
  }
  .group-target strong {
    font-size: 23px;
  }
  .group-panel {
    margin-top: -42px;
    padding: 28px 20px 20px;
    border-radius: 18px;
  }
  .group-panel__main {
    display: block;
  }
  .group-progress-block {
    padding: 0 0 30px;
    border-right: 0;
    border-bottom: 1px solid #eee;
  }
  .member-slot span {
    width: 62px;
    height: 62px;
    font-size: 32px;
  }
  .member-track::before {
    top: 29px;
  }
  .member-slot strong {
    font-size: 15px;
  }
  .group-reward {
    grid-template-columns: 82px 1fr;
    padding: 28px 0;
  }
  .group-reward__gift {
    width: 72px;
    height: 72px;
    border-radius: 17px;
    font-size: 38px;
  }
  .group-reward__copy > strong {
    font-size: 28px;
  }
  .group-reward button {
    width: 100%;
    height: 64px;
    grid-column: 1 / -1;
    font-size: 22px;
  }
  .group-steps {
    display: flex;
    min-height: 0;
    align-items: stretch;
    flex-direction: column;
    gap: 17px;
    margin-top: 0;
    padding: 22px;
  }
  .group-step {
    justify-content: flex-start;
  }
  .group-step-arrow {
    display: none;
  }
}
</style>
