<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const pageTitle = computed(() => route.meta.titleLabel || route.meta.navLabel || '功能空间')
const pageDescription = computed(
  () => route.meta.description || '该入口暂未开放，当前可以先回到已有工作区继续浏览。',
)
const pageIcon = computed(() => route.meta.icon || 'bi-columns-gap')
const shortcutLinks = [
  { label: '首页', to: '/', icon: 'bi-house' },
  { label: '搜索', to: '/search', icon: 'bi-search' },
  { label: '设置', to: '/settings', icon: 'bi-gear' },
]
</script>

<template>
  <main class="feature-shell">
    <section class="feature-panel">
      <div class="feature-icon">
        <i class="bi" :class="pageIcon"></i>
      </div>
      <div class="feature-copy">
        <p>StarCloudIsAI</p>
        <h1>{{ pageTitle }}</h1>
        <span>{{ pageDescription }}</span>
      </div>

      <nav class="feature-actions" aria-label="可用入口">
        <router-link v-for="link in shortcutLinks" :key="link.to" :to="link.to">
          <i class="bi" :class="link.icon" aria-hidden="true"></i>
          <span>{{ link.label }}</span>
        </router-link>
      </nav>
    </section>
  </main>
</template>

<style scoped>
.feature-shell {
  min-height: calc(100vh - var(--app-header-offset, 82px));
  display: grid;
  place-items: center;
  padding: clamp(32px, 6vw, 72px) clamp(16px, 4vw, 48px);
}

.feature-panel {
  width: min(720px, 100%);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'icon copy'
    'actions actions';
  gap: 22px;
  align-items: center;
  padding: clamp(24px, 4vw, 40px);
  border: 1px solid color-mix(in srgb, var(--primary-color) 24%, transparent);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(var(--primary-color-rgb), 0.16), transparent 52%),
    rgba(18, 18, 18, 0.82);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
}

.feature-icon {
  grid-area: icon;
  width: 64px;
  height: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.2);
  font-size: 1.7rem;
}

.feature-copy {
  grid-area: copy;
  min-width: 0;
}

.feature-copy p {
  margin-bottom: 4px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.feature-copy h1 {
  margin: 0;
  color: #ffffff;
  font-size: clamp(2rem, 4vw, 3.2rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: 0;
}

.feature-copy span {
  display: block;
  margin-top: 12px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 1rem;
}

.feature-actions {
  grid-area: actions;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 4px;
}

.feature-actions a {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.84);
  background: rgba(255, 255, 255, 0.055);
  font-size: 0.9rem;
  font-weight: 720;
  text-decoration: none;
}

.feature-actions a:hover {
  color: #ffffff;
  border-color: color-mix(in srgb, var(--primary-color) 34%, transparent);
  background: rgba(var(--primary-color-rgb), 0.12);
}

@media (max-width: 640px) {
  .feature-panel {
    grid-template-columns: 1fr;
    grid-template-areas:
      'icon'
      'copy'
      'actions';
  }
}
</style>
