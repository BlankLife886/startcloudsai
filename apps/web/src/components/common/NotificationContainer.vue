<script setup>
import notificationService from '@/services/notification'
import { computed } from 'vue'
import ErrorNotification from './ErrorNotification.vue'

// 获取通知列表
const notifications = computed(() => notificationService.notifications)

// 按位置分组通知
const groupedNotifications = computed(() => {
  const groups = {
    'top-right': [],
    'top-left': [],
    'bottom-right': [],
    'bottom-left': [],
    'top-center': [],
    'bottom-center': [],
  }

  notifications.value.forEach((notification) => {
    const position = notification.position || 'top-right'
    groups[position].push(notification)
  })

  return groups
})

// 关闭通知
function closeNotification(id) {
  notificationService.removeNotification(id)
}
</script>

<template>
  <div class="notification-container">
    <!-- 顶部左侧通知 -->
    <div class="notification-group top-left">
      <ErrorNotification
        v-for="notification in groupedNotifications['top-left']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="top-left"
        @close="closeNotification(notification.id)"
      />
    </div>

    <!-- 顶部中间通知 -->
    <div class="notification-group top-center">
      <ErrorNotification
        v-for="notification in groupedNotifications['top-center']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="top-center"
        @close="closeNotification(notification.id)"
      />
    </div>

    <!-- 顶部右侧通知 -->
    <div class="notification-group top-right">
      <ErrorNotification
        v-for="notification in groupedNotifications['top-right']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="top-right"
        @close="closeNotification(notification.id)"
      />
    </div>

    <!-- 底部左侧通知 -->
    <div class="notification-group bottom-left">
      <ErrorNotification
        v-for="notification in groupedNotifications['bottom-left']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="bottom-left"
        @close="closeNotification(notification.id)"
      />
    </div>

    <!-- 底部中间通知 -->
    <div class="notification-group bottom-center">
      <ErrorNotification
        v-for="notification in groupedNotifications['bottom-center']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="bottom-center"
        @close="closeNotification(notification.id)"
      />
    </div>

    <!-- 底部右侧通知 -->
    <div class="notification-group bottom-right">
      <ErrorNotification
        v-for="notification in groupedNotifications['bottom-right']"
        :key="notification.id"
        :message="notification.message"
        :type="notification.type"
        :duration="notification.duration"
        :closable="notification.closable"
        position="bottom-right"
        @close="closeNotification(notification.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 9999;
}

.notification-group {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(330px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  pointer-events: auto;
}

.top-right {
  top: 12px;
  right: 12px;
}

.top-left {
  top: 12px;
  left: 12px;
}

.bottom-right {
  bottom: 12px;
  right: 12px;
}

.bottom-left {
  bottom: 12px;
  left: 12px;
}

.top-center {
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
}

.bottom-center {
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
}

@media (max-width: 640px) {
  .top-right,
  .top-left,
  .bottom-right,
  .bottom-left {
    left: 12px;
    right: 12px;
    width: auto;
    max-width: none;
  }

  .top-right,
  .top-left,
  .top-center {
    top: 12px;
  }

  .bottom-right,
  .bottom-left,
  .bottom-center {
    bottom: 12px;
  }

  .top-center,
  .bottom-center {
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
  }
}
</style>
