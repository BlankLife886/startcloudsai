<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const route = useRoute()
const router = useRouter()
const runtimeConfigStore = useRuntimeConfigStore()

const type = computed(() => String(route.query.type || 'hidden'))
const reason = computed(
  () => route.query.reason || runtimeConfigStore.blockReason || accessCopy.value.reason,
)
const accessCopy = computed(() => {
  if (type.value === 'maintenance') {
    return {
      icon: 'bi-tools',
      eyebrow: 'MAINTENANCE',
      title: '页面维护中',
      reason: '当前页面正在维护，请稍后再试。',
    }
  }
  if (type.value === 'forbidden') {
    return {
      icon: 'bi-shield-lock-fill',
      eyebrow: 'FORBIDDEN',
      title: '没有访问权限',
      reason: '当前页面暂不对你开放。',
    }
  }
  return {
    icon: 'bi-eye-slash-fill',
    eyebrow: 'LIMITED',
    title: '访问受限',
    reason: '当前功能暂不可用。',
  }
})

function goHome() {
  router.push('/')
}
</script>

<template>
  <main class="limited-shell">
    <section class="limited-panel">
      <div class="limited-icon">
        <i class="bi" :class="accessCopy.icon"></i>
      </div>
      <div class="limited-copy">
        <p>{{ accessCopy.eyebrow }}</p>
        <h1>{{ accessCopy.title }}</h1>
        <span>{{ reason }}</span>
      </div>
      <button type="button" class="limited-action" @click="goHome">
        返回首页
      </button>
    </section>
  </main>
</template>

<style scoped>
.limited-shell {
  min-height: calc(100vh - var(--app-header-offset, 82px));
  display: grid;
  place-items: center;
  padding: clamp(32px, 6vw, 72px) clamp(16px, 4vw, 48px);
}

.limited-panel {
  width: min(680px, 100%);
  display: grid;
  gap: 18px;
  justify-items: start;
  padding: clamp(24px, 4vw, 40px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(18, 18, 18, 0.86);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
}

.limited-icon {
  width: 58px;
  height: 58px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #fff;
  background: rgba(var(--primary-color-rgb), 0.22);
  font-size: 1.55rem;
}

.limited-copy p {
  margin: 0 0 4px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0;
}

.limited-copy h1 {
  margin: 0;
  color: #fff;
  font-size: clamp(2rem, 4vw, 3.2rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: 0;
}

.limited-copy span {
  display: block;
  margin-top: 12px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 1rem;
}

.limited-action {
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: var(--primary-color);
  font-weight: 700;
}
</style>
