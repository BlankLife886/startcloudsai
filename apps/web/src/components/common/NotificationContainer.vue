<script setup>
import notificationService from '@/services/notification'
import { computed } from 'vue'
import ToastNotification from './ToastNotification.vue'

// 全局 toast 出口：App.vue 挂载一次，页面只调 notificationService.*。
// 进出场与列表位移由 TransitionGroup 统一处理（离场绝对定位让兄弟平滑补位）。
const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

const groupedNotifications = computed(() => {
  const groups = {}
  for (const notification of notificationService.notifications) {
    const position = notification.position || 'top-right'
    ;(groups[position] ||= []).push(notification)
  }
  return groups
})

const activePositions = computed(() =>
  POSITIONS.filter((position) => groupedNotifications.value[position]?.length),
)

function closeNotification(id) {
  notificationService.removeNotification(id)
}
</script>

<template>
  <div class="toaster-root" aria-label="通知">
    <TransitionGroup
      v-for="position in activePositions"
      :key="position"
      name="toast"
      tag="div"
      class="toaster-group"
      :class="`is-${position}`"
    >
      <ToastNotification
        v-for="notification in groupedNotifications[position]"
        :key="notification.id"
        :notification="notification"
        @close="closeNotification(notification.id)"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toaster-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 20000;
}

.toaster-group {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(330px, calc(100vw - 24px));
}

.toaster-group > :deep(*) {
  pointer-events: auto;
}

.is-top-right {
  top: 12px;
  right: 12px;
}

.is-top-left {
  top: 12px;
  left: 12px;
}

.is-bottom-right {
  bottom: 12px;
  right: 12px;
  flex-direction: column-reverse;
}

.is-bottom-left {
  bottom: 12px;
  left: 12px;
  flex-direction: column-reverse;
}

.is-top-center {
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
}

.is-bottom-center {
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: column-reverse;
}

/* 进出场：只动 transform/opacity；离场项脱离文档流，兄弟由 move 过渡平滑补位 */
.toast-enter-active {
  transition:
    transform 0.24s cubic-bezier(0.21, 1.02, 0.55, 1),
    opacity 0.24s ease;
}

.toast-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  transition:
    transform 0.18s ease-in,
    opacity 0.18s ease-in;
}

.toast-move {
  transition: transform 0.24s cubic-bezier(0.21, 1.02, 0.55, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

.is-bottom-right .toast-enter-from,
.is-bottom-left .toast-enter-from,
.is-bottom-center .toast-enter-from {
  transform: translateY(10px) scale(0.98);
}

.toast-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

@media (max-width: 640px) {
  .is-top-right,
  .is-top-left {
    left: 12px;
    right: 12px;
    width: auto;
  }

  .is-bottom-right,
  .is-bottom-left {
    left: 12px;
    right: 12px;
    width: auto;
  }

  .is-top-center,
  .is-bottom-center {
    width: calc(100vw - 24px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition-duration: 0.01ms;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>
