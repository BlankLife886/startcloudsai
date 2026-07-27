<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// 单条 toast：负责倒计时（悬停/聚焦暂停）、进度条与操作按钮。
// 进出场/位移动画由父级 TransitionGroup 统一驱动，这里不做 transition。
const props = defineProps({
  notification: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const ICONS = {
  error: 'bi-exclamation-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
  success: 'bi-check-circle-fill',
}

const type = computed(() =>
  ['error', 'warning', 'info', 'success'].includes(props.notification.type)
    ? props.notification.type
    : 'info',
)
const icon = computed(() => ICONS[type.value])
// 错误/警告用 assertive 让读屏器立即播报
const ariaRole = computed(() => (['error', 'warning'].includes(type.value) ? 'alert' : 'status'))

const duration = computed(() => Math.max(0, Number(props.notification.duration) || 0))
const paused = ref(false)
// countdownKey 变化时重建进度条动画（去重合并会 bump revision）
const countdownKey = computed(() => `${props.notification.id}-${props.notification.revision || 0}`)

let timer = null
let remaining = 0
let startedAt = 0

function stopTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function startTimer(ms) {
  stopTimer()
  if (!duration.value) return
  remaining = ms
  startedAt = Date.now()
  timer = setTimeout(() => emit('close'), remaining)
}

function pauseTimer() {
  if (paused.value) return
  paused.value = true
  if (!timer) return
  remaining = Math.max(0, remaining - (Date.now() - startedAt))
  stopTimer()
}

function resumeTimer() {
  if (!paused.value) return
  paused.value = false
  if (!duration.value) return
  startTimer(Math.max(320, remaining))
}

watch(countdownKey, () => startTimer(duration.value), { immediate: true })
onBeforeUnmount(stopTimer)

function handleAction() {
  try {
    props.notification.action?.handler?.()
  } finally {
    emit('close')
  }
}
</script>

<template>
  <div
    class="toast-item"
    :class="[`is-${type}`, { 'is-paused': paused }]"
    :role="ariaRole"
    :aria-live="ariaRole === 'alert' ? 'assertive' : 'polite'"
    tabindex="0"
    @pointerenter="pauseTimer"
    @pointerleave="resumeTimer"
    @focusin="pauseTimer"
    @focusout="resumeTimer"
  >
    <span class="toast-icon" aria-hidden="true"><i class="bi" :class="icon"></i></span>
    <div class="toast-content">
      <strong v-if="notification.title" class="toast-title">{{ notification.title }}</strong>
      <span class="toast-message">{{ notification.message }}</span>
    </div>
    <button
      v-if="notification.action?.label"
      class="toast-action"
      type="button"
      @click="handleAction"
    >
      {{ notification.action.label }}
    </button>
    <button
      v-if="notification.closable !== false"
      class="toast-close"
      type="button"
      aria-label="关闭通知"
      @click="emit('close')"
    >
      <i class="bi bi-x"></i>
    </button>
    <span
      v-if="duration > 0"
      :key="countdownKey"
      class="toast-progress"
      :style="{ animationDuration: `${duration}ms` }"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style scoped>
.toast-item {
  --toast-text: color-mix(in srgb, var(--text-color) 94%, #fff 6%);
  --toast-muted: color-mix(in srgb, var(--text-muted-color) 82%, var(--text-color) 18%);
  --toast-bg: color-mix(in srgb, var(--card-bg-color) 96%, var(--toast-tint) 4%);
  --toast-border: color-mix(in srgb, var(--toast-accent) 26%, var(--border-color) 40%);
  --toast-accent: #60a5fa;
  --toast-tint: #1e3a8a;
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid var(--toast-border);
  background: var(--toast-bg);
  box-shadow:
    0 10px 26px rgba(6, 8, 14, 0.16),
    0 1px 0 rgba(255, 255, 255, 0.03) inset;
  overflow: hidden;
  outline: none;
}

.toast-item:focus-visible {
  border-color: var(--toast-accent);
}

.toast-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--toast-accent) 14%, transparent);
  color: var(--toast-accent);
}

.toast-icon i {
  font-size: 0.8rem;
  line-height: 1;
}

.toast-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toast-title {
  color: var(--toast-text);
  font-size: 0.8rem;
  line-height: 1.3;
  font-weight: 650;
}

.toast-message {
  color: var(--toast-text);
  font-size: 0.8rem;
  line-height: 1.35;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.toast-title + .toast-message {
  color: var(--toast-muted);
  font-weight: 450;
}

.toast-action {
  border: 1px solid color-mix(in srgb, var(--toast-accent) 42%, transparent);
  background: color-mix(in srgb, var(--toast-accent) 12%, transparent);
  color: var(--toast-accent);
  font-size: 0.74rem;
  font-weight: 600;
  line-height: 1;
  padding: 6px 9px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.16s ease;
}

.toast-action:hover {
  background: color-mix(in srgb, var(--toast-accent) 20%, transparent);
}

.toast-close {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  border-radius: 7px;
  color: var(--toast-muted);
  opacity: 0.7;
  cursor: pointer;
  transition:
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.toast-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--text-color) 9%, transparent);
  color: var(--toast-text);
}

/* 底部倒计时条：纯 transform 动画，悬停暂停 */
.toast-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: color-mix(in srgb, var(--toast-accent) 55%, transparent);
  transform-origin: left center;
  animation: toast-countdown linear forwards;
}

.toast-item.is-paused .toast-progress {
  animation-play-state: paused;
}

@keyframes toast-countdown {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.toast-item.is-error {
  --toast-accent: #f87171;
  --toast-tint: #7f1d1d;
}

.toast-item.is-warning {
  --toast-accent: #fbbf24;
  --toast-tint: #78350f;
}

.toast-item.is-info {
  --toast-accent: #60a5fa;
  --toast-tint: #1e3a8a;
}

.toast-item.is-success {
  --toast-accent: #4ade80;
  --toast-tint: #14532d;
}

@media (prefers-reduced-motion: reduce) {
  .toast-progress {
    animation: none;
    transform: scaleX(1);
    opacity: 0.4;
  }
}
</style>
