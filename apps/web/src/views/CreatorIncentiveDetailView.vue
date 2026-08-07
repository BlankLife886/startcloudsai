<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { createGrowthGroup, getGrowthPrograms, joinGrowthGroup } from '@/services/growthApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'

const route = useRoute()
const loading = ref(true)
const loadError = ref('')
const growthData = ref(null)
const groupAction = ref('')
const joinCode = ref('')

const benefitMap = {
  group: {
    name: '好友拼团',
    category: '拼团裂变',
    icon: 'bi-people-fill',
    tone: 'coral',
    statement: '和好友一起创作，一起解锁积分奖励。',
    description: '发起或加入限时拼团，满员后奖励自动发放到每位成员账户。',
  },
  membership: {
    name: '会员计划',
    category: '长期价值',
    icon: 'bi-gem',
    tone: 'violet',
    statement: '为持续创作准备稳定、清晰的长期权益。',
    description: '集中查看会员周期、积分供给与专属权益方案。',
  },
  failure: {
    name: '失败补偿',
    category: '服务保障',
    icon: 'bi-shield-check',
    tone: 'teal',
    statement: '生成服务异常时，获得明确且可预期的保障。',
    description: '符合规则的失败任务自动退款，并按活动配置发放额外补偿。',
  },
  milestone: {
    name: '越用越多',
    category: '忠诚激励',
    icon: 'bi-graph-up-arrow',
    tone: 'amber',
    statement: '持续交付作品，逐步解锁更高的创作回馈。',
    description: '本月成功交付数量达到里程碑后，自动获得对应积分奖励。',
  },
  suggestion: {
    name: '建议采纳',
    category: '产品共创',
    icon: 'bi-lightbulb-fill',
    tone: 'green',
    statement: '让真实、有价值的产品建议获得清晰回报。',
    description: '提交产品建议，评审采纳后按价值等级发放创作积分。',
  },
}

const programId = computed(() => {
  const id = String(route.params.program || '')
  return benefitMap[id] ? id : 'group'
})
const benefit = computed(() => benefitMap[programId.value])
const rules = computed(() => growthData.value?.rules || {})
const group = computed(() => growthData.value?.group || null)
const milestones = computed(() =>
  Array.isArray(rules.value.usageMilestones) ? rules.value.usageMilestones : [],
)
const groupProgress = computed(() => {
  const target = Number(group.value?.targetMembers || rules.value.groupTargetMembers || 0)
  const current = Number(group.value?.memberCount || 0)
  return target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
})

async function loadGrowth() {
  loading.value = true
  loadError.value = ''
  try {
    growthData.value = await getGrowthPrograms()
  } catch (error) {
    loadError.value = error?.message || '创作激励数据读取失败'
  } finally {
    loading.value = false
  }
}

async function startGroup() {
  if (groupAction.value || rules.value.groupEnabled === false) return
  groupAction.value = 'create'
  try {
    await createGrowthGroup()
    await loadGrowth()
    notificationService.success('拼团已创建，邀请好友输入拼团码即可加入')
  } catch (error) {
    notificationService.error(error?.message || '创建拼团失败')
  } finally {
    groupAction.value = ''
  }
}

async function joinGroup() {
  const code = joinCode.value.trim()
  if (groupAction.value || code.length < 6) {
    if (code.length < 6) notificationService.warning('请输入有效的拼团码')
    return
  }
  groupAction.value = 'join'
  try {
    await joinGrowthGroup(code)
    joinCode.value = ''
    await loadGrowth()
    notificationService.success('已加入拼团')
  } catch (error) {
    notificationService.error(error?.message || '加入拼团失败')
  } finally {
    groupAction.value = ''
  }
}

async function copyGroupCode() {
  if (!group.value?.code) return
  await navigator.clipboard.writeText(group.value.code)
  notificationService.success('拼团码已复制')
}

onMounted(loadGrowth)
</script>

<template>
  <main class="detail-page" :data-tone="benefit.tone">
    <nav class="detail-nav" aria-label="创作激励导航">
      <RouterLink to="/incentive-plans" class="back-link"
        ><i class="bi bi-arrow-left"></i>返回创作激励</RouterLink
      >
    </nav>

    <section class="detail-hero">
      <div class="detail-copy">
        <p class="detail-eyebrow"><span></span>{{ benefit.category }}</p>
        <span class="detail-icon" aria-hidden="true"><i class="bi" :class="benefit.icon"></i></span>
        <h1>{{ benefit.name }}</h1>
        <p class="detail-lead">{{ benefit.statement }}</p>

        <div v-if="loading" class="detail-loading" aria-live="polite">
          <span></span><span></span><span></span>
        </div>
        <div v-else-if="loadError" class="detail-error">
          <p>{{ loadError }}</p>
          <button type="button" @click="loadGrowth">重新加载</button>
        </div>

        <div v-else-if="programId === 'group'" class="detail-content">
          <template v-if="group">
            <div class="group-summary">
              <strong>{{ group.memberCount }} / {{ group.targetMembers }} 人</strong
              ><span>每人奖励 {{ formatPoints(group.rewardCents) }}</span>
            </div>
            <div
              class="group-progress"
              role="progressbar"
              :aria-valuenow="groupProgress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <i :style="{ width: `${groupProgress}%` }"></i>
            </div>
            <button type="button" class="group-code" @click="copyGroupCode">
              <span>拼团码</span><strong>{{ group.code }}</strong
              ><i class="bi bi-copy"></i>
            </button>
          </template>
          <template v-else>
            <p>
              目标 {{ rules.groupTargetMembers || 0 }} 人，成团后每人获得
              {{ formatPoints(rules.groupRewardCents) }}。
            </p>
            <div class="group-actions">
              <button
                type="button"
                :disabled="groupAction || rules.groupEnabled === false"
                @click="startGroup"
              >
                {{ groupAction === 'create' ? '创建中' : '发起拼团' }}
              </button>
              <form @submit.prevent="joinGroup">
                <input
                  v-model="joinCode"
                  maxlength="16"
                  autocomplete="off"
                  placeholder="输入好友拼团码"
                  aria-label="好友拼团码"
                /><button type="submit" :disabled="groupAction || rules.groupEnabled === false">
                  {{ groupAction === 'join' ? '加入中' : '加入' }}
                </button>
              </form>
            </div>
          </template>
        </div>

        <div v-else-if="programId === 'membership'" class="detail-content metric-content">
          <span>当前入口</span><strong>会员与创作方案</strong>
          <p>查看当前可用的会员周期、积分供给和专属权益。</p>
          <RouterLink to="/pricing">查看会员方案<i class="bi bi-arrow-right"></i></RouterLink>
        </div>

        <div v-else-if="programId === 'failure'" class="detail-content metric-content">
          <span>单次补偿</span><strong>{{ formatPoints(rules.failureBonusCents) }}</strong>
          <p>
            今日已触发 {{ rules.failureClaimsToday || 0 }} /
            {{ rules.failureBonusDailyLimit || 0 }} 次，符合条件时自动到账。
          </p>
        </div>

        <div v-else-if="programId === 'milestone'" class="detail-content metric-content">
          <span>本月成功交付</span><strong>{{ rules.monthDeliveredUnits || 0 }} 张</strong>
          <div class="milestone-list">
            <div
              v-for="milestone in milestones"
              :key="milestone.units"
              :class="{ 'is-achieved': milestone.achieved }"
            >
              <span>{{ milestone.units }} 张</span
              ><strong>{{ formatPoints(milestone.rewardCents) }}</strong
              ><i class="bi" :class="milestone.achieved ? 'bi-check-circle-fill' : 'bi-circle'"></i>
            </div>
          </div>
        </div>

        <div v-else class="detail-content metric-content">
          <span>单次奖励上限</span
          ><strong>{{ formatPoints(rules.suggestionRewardMaxCents) }}</strong>
          <p>提交真实、具体且可执行的产品建议，采纳后按价值等级发放奖励。</p>
          <RouterLink to="/feedback">提交产品建议<i class="bi bi-arrow-right"></i></RouterLink>
        </div>
      </div>

      <aside class="detail-visual" aria-hidden="true">
        <div class="detail-visual__index">CREATOR / {{ programId.toUpperCase() }}</div>
        <div class="detail-visual__mark"><i class="bi" :class="benefit.icon"></i></div>
        <div class="detail-visual__rules">
          <span>权益计划</span><span>账户联动</span><span>自动结算</span>
        </div>
        <div class="detail-visual__copy">
          <small>STARCLOUD CREATIVE</small><strong>{{ benefit.name }}</strong>
          <p>{{ benefit.description }}</p>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.detail-page {
  --accent: #ff6f66;
  min-width: 1080px;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  color: #f7f7f8;
  background: #0b0c0f;
}
.detail-page[data-tone='violet'] {
  --accent: #8d7cff;
}
.detail-page[data-tone='teal'] {
  --accent: #35c3bb;
}
.detail-page[data-tone='amber'] {
  --accent: #e7a83f;
}
.detail-page[data-tone='green'] {
  --accent: #43c980;
}
.detail-nav {
  width: min(1500px, calc(100% - 72px));
  margin: 0 auto;
  min-height: 68px;
  display: flex;
  align-items: center;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #aaaab3;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}
.back-link:hover {
  color: #fff;
}
.detail-hero {
  display: grid;
  grid-template-columns: minmax(540px, 1fr) minmax(500px, 1fr);
  min-height: calc(100vh - var(--app-header-offset, 72px) - 68px);
  background: #111214;
  border-top: 1px solid rgb(255 255 255 / 7%);
}
.detail-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 76px max(64px, calc((100vw - 1500px) / 2 + 36px));
}
.detail-eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 22px;
  color: #a8a8b2;
  font-size: 11px;
  font-weight: 800;
}
.detail-eyebrow span {
  width: 34px;
  height: 2px;
  background: var(--accent);
}
.detail-icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  margin-bottom: 22px;
  border-radius: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  font-size: 24px;
}
.detail-copy h1 {
  margin: 0;
  font-size: 58px;
  line-height: 1;
  letter-spacing: 0;
}
.detail-lead {
  margin: 20px 0 0;
  color: #d7d7dc;
  font-size: 17px;
  line-height: 1.65;
}
.detail-content {
  margin-top: 32px;
  color: #d7d7dc;
}
.detail-content > p {
  color: #9d9da7;
  line-height: 1.7;
}
.detail-loading {
  display: flex;
  gap: 8px;
  margin-top: 34px;
}
.detail-loading span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 800ms ease-in-out infinite alternate;
}
.detail-loading span:nth-child(2) {
  animation-delay: 120ms;
}
.detail-loading span:nth-child(3) {
  animation-delay: 240ms;
}
@keyframes pulse {
  to {
    opacity: 0.25;
    transform: translateY(-4px);
  }
}
.detail-error {
  margin-top: 28px;
  color: #ff9b96;
}
.detail-error button {
  padding: 9px 14px;
  color: #fff;
  background: transparent;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 8px;
}
.group-summary {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
.group-summary strong {
  font-size: 27px;
}
.group-summary span {
  color: #9d9da7;
  font-size: 12px;
}
.group-progress {
  height: 8px;
  margin: 13px 0 20px;
  overflow: hidden;
  border-radius: 4px;
  background: rgb(255 255 255 / 9%);
}
.group-progress i {
  display: block;
  height: 100%;
  background: var(--accent);
}
.group-code {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 14px;
  color: #fff;
  background: rgb(255 255 255 / 6%);
  border: 1px solid rgb(255 255 255 / 11%);
  border-radius: 10px;
}
.group-code span {
  color: #9d9da7;
  font-size: 12px;
}
.group-code strong {
  margin-right: auto;
}
.group-actions {
  display: flex;
  gap: 10px;
  margin-top: 24px;
}
.group-actions > button,
.group-actions form button,
.metric-content > a {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  color: #111214;
  background: #f6f6f7;
  border: 1px solid #fff;
  border-radius: 10px;
  font: inherit;
  font-weight: 800;
  text-decoration: none;
}
.group-actions form {
  display: flex;
  min-width: 0;
  flex: 1;
}
.group-actions input {
  min-width: 0;
  flex: 1;
  padding: 0 13px;
  color: #fff;
  background: rgb(255 255 255 / 7%);
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 10px 0 0 10px;
}
.group-actions form button {
  border-radius: 0 10px 10px 0;
}
.group-actions button:disabled {
  opacity: 0.45;
}
.metric-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.metric-content > span {
  color: #9d9da7;
  font-size: 12px;
}
.metric-content > strong {
  margin-top: 7px;
  font-size: 29px;
}
.metric-content > a {
  gap: 12px;
  margin-top: 20px;
}
.milestone-list {
  width: 100%;
  margin-top: 18px;
  border-top: 1px solid rgb(255 255 255 / 12%);
}
.milestone-list > div {
  display: grid;
  grid-template-columns: 1fr auto 20px;
  gap: 12px;
  align-items: center;
  min-height: 45px;
  border-bottom: 1px solid rgb(255 255 255 / 9%);
  color: #9d9da7;
}
.milestone-list > div > strong {
  color: #fff;
  font-size: 13px;
}
.milestone-list .is-achieved i {
  color: #43c980;
}
.detail-visual {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: calc(100vh - var(--app-header-offset, 72px) - 68px);
  overflow: hidden;
  padding: 54px max(46px, calc((100vw - 1500px) / 2 + 36px)) 48px 54px;
  background: #191a1f;
  border-left: 1px solid rgb(255 255 255 / 8%);
}
.detail-visual::before,
.detail-visual::after {
  position: absolute;
  content: '';
}
.detail-visual::before {
  top: 0;
  bottom: 0;
  left: 34%;
  width: 1px;
  background: rgb(255 255 255 / 7%);
}
.detail-visual::after {
  top: 43%;
  right: 0;
  left: 0;
  height: 1px;
  background: rgb(255 255 255 / 7%);
}
.detail-visual__index {
  position: relative;
  z-index: 2;
  color: #858690;
  font-size: 11px;
  font-weight: 800;
}
.detail-visual__mark {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  align-self: center;
  justify-self: center;
  width: 220px;
  height: 220px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, #1f2025);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, rgb(255 255 255 / 8%));
  border-radius: 50%;
  font-size: 76px;
}
.detail-visual__rules {
  position: absolute;
  z-index: 2;
  top: 54px;
  right: max(46px, calc((100vw - 1500px) / 2 + 36px));
  display: flex;
  gap: 18px;
  color: #858690;
  font-size: 10px;
}
.detail-visual__copy {
  position: relative;
  z-index: 2;
  max-width: 470px;
  padding-left: 22px;
  border-left: 2px solid var(--accent);
}
.detail-visual__copy small {
  display: block;
  color: #aaaab3;
  font-size: 10px;
  font-weight: 800;
}
.detail-visual__copy strong {
  display: block;
  margin-top: 7px;
  font-size: 27px;
}
.detail-visual__copy p {
  margin: 9px 0 0;
  color: #c2c2c9;
  line-height: 1.65;
}
</style>
