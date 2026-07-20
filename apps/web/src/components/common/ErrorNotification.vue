<script setup>
import { ref, watch } from 'vue'

// 定义props
const props = defineProps({
  message: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    default: 'error', // error, warning, info, success
    validator: (value) => ['error', 'warning', 'info', 'success'].includes(value),
  },
  duration: {
    type: Number,
    default: 5000, // 默认显示5秒
  },
  closable: {
    type: Boolean,
    default: true,
  },
  position: {
    type: String,
    default: 'top-right', // top-right, top-left, bottom-right, bottom-left, top-center, bottom-center
    validator: (value) =>
      [
        'top-right',
        'top-left',
        'bottom-right',
        'bottom-left',
        'top-center',
        'bottom-center',
      ].includes(value),
  },
})

// 定义事件
const emit = defineEmits(['close'])

// 本地状态
const visible = ref(false)
const timer = ref(null)

// 初始化时检查是否有消息
if (props.message) {
  visible.value = true

  // 如果设置了自动关闭，则设置定时器
  if (props.duration > 0) {
    timer.value = setTimeout(() => {
      closeNotification()
    }, props.duration)
  }
}

// 监听消息变化
watch(
  () => props.message,
  (newMessage) => {
    if (newMessage) {
      showNotification()
    }
  },
)

// 显示通知
function showNotification() {
  visible.value = true

  // 如果设置了自动关闭，则设置定时器
  if (props.duration > 0) {
    clearTimeout(timer.value)
    timer.value = setTimeout(() => {
      closeNotification()
    }, props.duration)
  }
}

// 关闭通知
function closeNotification() {
  visible.value = false
  clearTimeout(timer.value)
  emit('close')
}

// 获取图标
function getIcon() {
  switch (props.type) {
    case 'error':
      return 'bi-exclamation-circle-fill'
    case 'warning':
      return 'bi-exclamation-triangle-fill'
    case 'info':
      return 'bi-info-circle-fill'
    case 'success':
      return 'bi-check-circle-fill'
    default:
      return 'bi-info-circle-fill'
  }
}

// 获取类名
function getTypeClass() {
  switch (props.type) {
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    case 'success':
      return 'success'
    default:
      return 'info'
  }
}

// 获取位置类名
function getPositionClass() {
  return `position-${props.position}`
}
</script>

<template>
  <transition name="notification-fade">
    <div v-if="visible && message" :class="['notification', getTypeClass(), getPositionClass()]">
      <div class="notification-icon" aria-hidden="true">
        <i :class="['bi', getIcon()]"></i>
      </div>
      <div class="notification-content">
        <span class="notification-message">{{ message }}</span>
      </div>
      <button v-if="closable" class="notification-close" @click="closeNotification">
        <i class="bi bi-x"></i>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.notification {
  --notification-text: color-mix(in srgb, var(--text-color) 92%, #fff 8%);
  --notification-muted: color-mix(in srgb, var(--text-muted-color) 82%, var(--text-color) 18%);
  --notification-bg: color-mix(in srgb, var(--card-bg-color) 88%, transparent);
  --notification-border: color-mix(in srgb, var(--border-color) 68%, transparent);
  --notification-accent: #60a5fa;
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: min(240px, calc(100vw - 24px));
  max-width: min(330px, calc(100vw - 24px));
  padding: 8px 9px 8px 8px;
  border-radius: 10px;
  border: 1px solid var(--notification-border);
  background: var(--notification-bg);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(10px) saturate(1.04);
  transition: all 0.3s;
  overflow: hidden;
}

.notification-content {
  min-width: 0;
  display: flex;
  align-items: center;
}

.notification-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--notification-accent) 12%, transparent);
  color: var(--notification-accent) !important;
}

.notification-icon i {
  font-size: 0.76rem;
  color: inherit !important;
}

.notification-message {
  min-width: 0;
  margin: 0;
  color: var(--notification-text) !important;
  font-size: 0.8rem;
  line-height: 1.32;
  font-weight: 500;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.notification-close {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--notification-muted) !important;
  border-radius: 7px;
  opacity: 0.75;
}

.notification-close:hover {
  color: var(--notification-text) !important;
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  opacity: 1;
}

/* 类型样式 */
.notification.error {
  --notification-bg: color-mix(in srgb, var(--card-bg-color) 88%, #7f1d1d 12%);
  --notification-border: rgba(248, 113, 113, 0.2);
  --notification-accent: #f87171;
}

.notification.warning {
  --notification-bg: color-mix(in srgb, var(--card-bg-color) 88%, #78350f 12%);
  --notification-border: rgba(251, 191, 36, 0.22);
  --notification-accent: #fbbf24;
}

.notification.info {
  --notification-bg: color-mix(in srgb, var(--card-bg-color) 88%, #1e3a8a 12%);
  --notification-border: rgba(96, 165, 250, 0.2);
  --notification-accent: #60a5fa;
}

.notification.success {
  --notification-bg: color-mix(in srgb, var(--card-bg-color) 88%, #14532d 12%);
  --notification-border: rgba(74, 222, 128, 0.2);
  --notification-accent: #4ade80;
}

/* 动画 */
.notification-fade-enter-active,
.notification-fade-leave-active {
  transition:
    opacity 0.3s,
    transform 0.3s;
}

.notification-fade-enter-from,
.notification-fade-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

@media (max-width: 640px) {
  .notification {
    min-width: 0;
    max-width: calc(100vw - 24px);
    padding: 9px 10px 9px 8px;
    gap: 8px;
  }

  .notification-icon {
    width: 24px;
    height: 24px;
    flex-basis: 24px;
  }

  .notification-message {
    font-size: 0.84rem;
  }
}
</style>
