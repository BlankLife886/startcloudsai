<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import PcAnimatedNumber from '@/components/pricing/PcAnimatedNumber.vue'
import { animate, cancelAnimations, ANIME_EASE_ENTER, prefersReducedMotion } from '@/lib/anime'

const props = defineProps({
  dashboard: { type: Object, required: true },
  compact: { type: Boolean, default: false },
  showEmptyCopy: { type: Boolean, default: false },
  numbersEnabled: { type: Boolean, default: true },
  keyActionLoading: { type: Boolean, default: false },
})

defineEmits(['reset-key', 'subscribe'])

const uid = useId()
const gradientId = `pc-sub-ring-gradient${uid}`
const glowId = `pc-sub-ring-glow${uid}`

const RING_RADIUS = 52
const RING_C = 2 * Math.PI * RING_RADIUS
const ringProgress = ref(0)
let ringState = null
let ringReady = false

function ringDelay(extra = 0) {
  return (props.compact ? 160 : 200) + Number(extra || 0)
}

function playRingAnimation(to = 0, from = 0) {
  if (ringState) cancelAnimations(ringState)
  if (
    !props.dashboard.hasDailyQuota
    || !props.numbersEnabled
    || !props.dashboard.hasSubscription
    || prefersReducedMotion()
  ) {
    ringProgress.value = to
    return
  }
  ringState = { value: from }
  animate(ringState, {
    value: { to },
    duration: 980,
    delay: ringDelay(),
    ease: ANIME_EASE_ENTER,
    onUpdate: () => {
      ringProgress.value = ringState.value
    },
  })
}

async function syncRingAnimation(from = 0) {
  await nextTick()
  playRingAnimation(props.dashboard.usagePercent, from)
}

watch(
  () => props.dashboard.usagePercent,
  (next, prev) => {
    if (!props.numbersEnabled) {
      ringProgress.value = next
      return
    }
    playRingAnimation(next, prev ?? 0)
  },
)

watch(
  () => props.numbersEnabled,
  (enabled) => {
    if (!enabled) {
      if (ringState) cancelAnimations(ringState)
      ringProgress.value = props.dashboard.usagePercent
      return
    }
    if (ringReady) syncRingAnimation(0)
  },
)

onMounted(async () => {
  ringReady = true
  await nextTick()
  syncRingAnimation(0)
})

onBeforeUnmount(() => {
  if (ringState) cancelAnimations(ringState)
})

const metricItems = [
  {
    id: 'quota',
    label: '总额度',
    icon: 'bi-layers',
    field: 'dailyQuota',
    format: 'usd',
    suffix: '/天',
    tone: 'cyan',
    delay: 80,
  },
  {
    id: 'used',
    label: '已使用',
    icon: 'bi-graph-up-arrow',
    field: 'usedToday',
    format: 'usd',
    tone: 'amber',
    delay: 140,
    showBar: true,
  },
  {
    id: 'remaining',
    label: '剩余',
    icon: 'bi-check-circle',
    field: 'remaining',
    format: 'usd',
    tone: 'green',
    delay: 200,
  },
  {
    id: 'expiry',
    label: '到期时间',
    icon: 'bi-calendar3',
    type: 'date',
    tone: 'violet',
  },
]
</script>

<template>
  <article
    class="pc-subscription-dashboard"
    :class="{ 'pc-subscription-dashboard--compact': compact }"
  >
    <header class="pc-subscription-dashboard__head">
      <h2><slot name="title">当前套餐</slot></h2>
      <div class="pc-subscription-dashboard__head-actions">
        <slot name="actions"></slot>
      </div>
    </header>

    <div
      class="pc-subscription-dashboard__card"
      :class="{ 'is-empty': !dashboard.hasSubscription }"
    >
      <div v-if="!dashboard.hasSubscription" class="pc-subscription-dashboard__empty-state">
        <h3 class="pc-subscription-dashboard__empty-title">尚未订阅套餐</h3>
        <p v-if="showEmptyCopy" class="pc-subscription-dashboard__empty-copy">
          你还没有生效中的套餐。请切换到「套餐列表」选购；生效后将在此显示额度、到期时间与订阅密钥。
        </p>
        <p v-else class="pc-subscription-dashboard__empty-copy">
          购买套餐后可获得订阅密钥、模型权限与专属额度。
        </p>
        <button type="button" class="pc-plan-subscribe-btn" @click="$emit('subscribe')">
          去选购套餐
        </button>
      </div>

      <template v-else>
      <div class="pc-subscription-dashboard__title-row">
        <div>
          <h3>{{ dashboard.planName }}</h3>
          <span v-if="dashboard.billingMode" class="pc-subscription-dashboard__mode">
            {{ dashboard.billingMode }}
          </span>
        </div>
        <div
          v-if="dashboard.statusLabel"
          class="pc-subscription-dashboard__status"
          :class="{ 'is-active': dashboard.isActive }"
        >
          <i aria-hidden="true"></i>
          {{ dashboard.statusLabel }}
        </div>
      </div>

      <div class="pc-subscription-dashboard__body">
        <div class="pc-subscription-dashboard__ring-stage">
          <svg
            class="pc-subscription-dashboard__ring-svg"
            viewBox="0 0 120 120"
            role="img"
            :aria-label="
              dashboard.hasDailyQuota
                ? `今日额度已用 ${dashboard.usagePercent}%`
                : `套餐状态 ${dashboard.statusLabel}`
            "
          >
            <defs>
              <linearGradient :id="gradientId" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#97ff7c" />
                <stop offset="100%" stop-color="#54d6c4" />
              </linearGradient>
              <filter :id="glowId" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle
              class="pc-subscription-dashboard__ring-track"
              cx="60"
              cy="60"
              :r="RING_RADIUS"
              fill="none"
            />
            <circle
              v-if="dashboard.hasDailyQuota"
              class="pc-subscription-dashboard__ring-progress"
              cx="60"
              cy="60"
              :r="RING_RADIUS"
              fill="none"
              :stroke="`url(#${gradientId})`"
              :stroke-dasharray="`${(ringProgress / 100) * RING_C} ${RING_C}`"
              transform="rotate(-90 60 60)"
              :filter="`url(#${glowId})`"
            />
          </svg>
          <div class="pc-subscription-dashboard__ring-readout">
            <template v-if="dashboard.hasDailyQuota">
              <PcAnimatedNumber
                tag="strong"
                class="pc-subscription-dashboard__ring-value"
                :value="dashboard.usagePercent"
                format="percent1"
                :delay="ringDelay()"
                :duration="980"
                :enabled="numbersEnabled && dashboard.hasSubscription"
              />
              <span>{{ dashboard.ringCaption }}</span>
            </template>
            <template v-else>
              <strong class="pc-subscription-dashboard__ring-status">{{ dashboard.statusLabel }}</strong>
              <span>{{ dashboard.ringCaption }}</span>
            </template>
          </div>
        </div>

        <div class="pc-subscription-dashboard__metrics">
          <article
            v-for="item in metricItems"
            :key="item.id"
            class="pc-subscription-dashboard__metric"
            :class="item.tone ? `is-${item.tone}` : ''"
          >
            <div class="pc-subscription-dashboard__metric-head">
              <span class="pc-subscription-dashboard__metric-label">{{ item.label }}</span>
              <span class="pc-subscription-dashboard__metric-icon" aria-hidden="true">
                <i class="bi" :class="item.icon"></i>
              </span>
            </div>

            <div v-if="item.type === 'date'" class="pc-subscription-dashboard__metric-value">
              <span class="pc-subscription-dashboard__metric-date">{{ dashboard.expiresAtLabel }}</span>
            </div>
            <div v-else-if="dashboard.hasDailyQuota && item.format" class="pc-subscription-dashboard__metric-value">
              <PcAnimatedNumber
                tag="strong"
                :value="dashboard[item.field] || 0"
                :format="item.format"
                :delay="ringDelay(item.delay)"
                :duration="980"
                :enabled="numbersEnabled && dashboard.hasSubscription"
              />
              <em v-if="item.suffix" class="pc-subscription-dashboard__metric-unit">{{ item.suffix }}</em>
            </div>
            <div v-else-if="item.field === 'usedToday' && dashboard.hasSubscription" class="pc-subscription-dashboard__metric-value">
              <PcAnimatedNumber
                tag="strong"
                :value="dashboard.usedToday || 0"
                format="usd"
                :delay="ringDelay(item.delay)"
                :duration="980"
                :enabled="numbersEnabled"
              />
            </div>
            <div v-else class="pc-subscription-dashboard__metric-value">
              <strong>{{ dashboard[`${item.field}Label`] || '—' }}</strong>
            </div>

            <div
              v-if="item.showBar && dashboard.hasDailyQuota"
              class="pc-subscription-dashboard__metric-bar"
              role="presentation"
            >
              <span :style="{ width: `${Math.min(100, dashboard.usagePercent)}%` }"></span>
            </div>
          </article>
        </div>
      </div>

      <div class="pc-subscription-dashboard__key-row">
        <div class="pc-subscription-dashboard__key-copy">
          <span>订阅密钥</span>
          <code>{{ dashboard.keyPrefix ? `${dashboard.keyPrefix}••••••••` : '未创建' }}</code>
          <small>
            {{
              dashboard.expiresAtLabel !== '—'
                ? '完整密钥离开页面后不可再看'
                : dashboard.periodLabel
            }}
          </small>
        </div>
        <div class="pc-subscription-dashboard__key-actions">
          <button
            v-if="dashboard.canResetKey"
            type="button"
            class="pc-btn pc-btn--ghost"
            :disabled="keyActionLoading"
            @click="$emit('reset-key')"
          >
            重置密钥
          </button>
        </div>
      </div>
      </template>
    </div>
  </article>
</template>
