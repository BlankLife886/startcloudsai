<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useAppCatalog } from '@/features/app-space/composables/useAppCatalog'
import { createAppSpaceScene } from '@/features/app-space/composables/useAppSpaceScene'
import { useSettingsStore } from '@/stores/settings'
import '@/features/app-space/styles/app-space.css'

const MagicRings = defineAsyncComponent(() => import('@/components/bits/MagicRings.vue'))

const settingsStore = useSettingsStore()
const { apps, publishedApps, draftApps, groupByScope } = useAppCatalog()

const pageRef = useTemplateRef('pageRef')
const filter = ref('all')
let scene = null

const reducedMotion = computed(() => {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    settingsStore.getSetting('enable_animations') === false
  )
})

const visibleApps = computed(() => {
  if (filter.value === 'published') return publishedApps.value
  if (filter.value === 'draft') return draftApps.value
  return apps.value
})

const scopeGroups = computed(() => groupByScope(visibleApps.value))

onMounted(async () => {
  await nextTick()
  scene = createAppSpaceScene(pageRef.value, { reducedMotion: reducedMotion.value })
})

onBeforeUnmount(() => {
  scene?.destroy()
})

function cardStyle(app) {
  return {
    '--card-accent': app.accent,
    '--card-accent-rgb': app.accentRgb,
  }
}

function cardCategory(app) {
  const platform = app.platform ? ` · ${app.platform}` : ''
  return `${app.scopeLabel} · ${app.typeLabel}${platform}`
}
</script>

<template>
  <main ref="pageRef" class="app-space-page">
    <div class="app-space-rings" aria-hidden="true">
      <MagicRings
        v-if="!reducedMotion"
        color="#4ade80"
        color-two="#6366f1"
        :opacity="0.55"
        :ring-count="6"
        :speed="0.35"
        :mouse-influence="0.08"
        :hover-scale="1.04"
        :follow-mouse="true"
        :is-paused="false"
      />
    </div>
    <div class="app-space-orb" aria-hidden="true"></div>

    <div class="app-space-shell">
      <header class="app-space-hero">
        <span class="app-space-kicker">
          <i class="bi bi-columns-gap"></i>
          APP SPACE
        </span>
        <h1 class="app-space-title">应用空间</h1>
        <p class="app-space-lead">本站 App、小程序，以及其他站点产品的下载与打开入口</p>
      </header>

      <nav class="app-space-toolbar" aria-label="产品筛选">
        <button type="button" class="app-space-filter" :class="{ active: filter === 'all' }" @click="filter = 'all'">
          全部 {{ apps.length }}
        </button>
        <button
          type="button"
          class="app-space-filter"
          :class="{ active: filter === 'published' }"
          @click="filter = 'published'"
        >
          已上线 {{ publishedApps.length }}
        </button>
        <button
          type="button"
          class="app-space-filter"
          :class="{ active: filter === 'draft' }"
          @click="filter = 'draft'"
        >
          筹备中 {{ draftApps.length }}
        </button>
      </nav>

      <section v-for="group in scopeGroups" :key="group.scope" class="app-space-section">
        <div class="app-space-section-head">
          <h2>{{ group.label }}</h2>
          <span v-if="group.apps.length">{{ group.apps.length }}</span>
        </div>

        <div v-if="group.apps.length" class="app-space-grid">
          <a
            v-for="app in group.apps.filter((item) => item.href)"
            :key="app.id"
            :href="app.href"
            target="_blank"
            rel="noopener noreferrer"
            class="app-card"
            :class="{ 'is-featured': app.featured }"
            :style="cardStyle(app)"
          >
            <span class="app-card-shimmer"></span>
            <span class="app-card-glow"></span>
            <span class="app-card-badge is-live">{{ app.typeLabel }}</span>
            <span class="app-card-icon"><i class="bi" :class="app.icon"></i></span>
            <div class="app-card-body">
              <span class="app-card-category">{{ cardCategory(app) }}</span>
              <h3 class="app-card-name">{{ app.name }}</h3>
              <p class="app-card-tagline">{{ app.tagline }}</p>
            </div>
            <div class="app-card-foot">
              <span>{{ app.type === 'miniprogram' ? '打开小程序' : '前往下载' }}</span>
              <i class="bi bi-box-arrow-up-right"></i>
            </div>
          </a>

          <div
            v-for="app in group.apps.filter((item) => !item.href)"
            :key="app.id"
            class="app-card is-draft"
            :style="cardStyle(app)"
          >
            <span class="app-card-glow"></span>
            <span class="app-card-badge is-soon">{{ app.typeLabel }}</span>
            <span class="app-card-icon"><i class="bi" :class="app.icon"></i></span>
            <div class="app-card-body">
              <span class="app-card-category">{{ cardCategory(app) }}</span>
              <h3 class="app-card-name">{{ app.name }}</h3>
              <p class="app-card-tagline">{{ app.tagline }}</p>
            </div>
            <div class="app-card-foot">
              <span>敬请期待</span>
              <i class="bi bi-hourglass-split"></i>
            </div>
          </div>
        </div>

        <div v-else class="app-space-scope-empty">{{ group.emptyText }}</div>
      </section>
    </div>
  </main>
</template>
