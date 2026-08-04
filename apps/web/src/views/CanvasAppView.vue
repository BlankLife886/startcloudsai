<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import {
  CANVAS_AUTH_REQUIRED_MESSAGE,
  CANVAS_ROUTE_MESSAGE,
  CANVAS_THEME_MESSAGE,
  getCanvasAppUrl,
  normalizeCanvasRoutePath,
} from '@/services/canvasApp'
import notificationService from '@/services/notification'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const canvasFrame = ref(null)
const canvasLoaded = ref(false)
const initialCanvasPath = normalizeCanvasRoutePath(route.query.view)
const canvasUrl = getCanvasAppUrl(appearanceStore.scheme, initialCanvasPath)
const canvasOrigin = new URL(canvasUrl, window.location.origin).origin
let headerResizeObserver = null

function sendCanvasTheme() {
  const frameRect = canvasFrame.value?.getBoundingClientRect()
  const headerRect = document.querySelector('.site-header')?.getBoundingClientRect()
  const sourceOrigin = appearanceStore.transitionOrigin
  const origin =
    frameRect && sourceOrigin
      ? {
          x: Math.min(frameRect.width, Math.max(0, sourceOrigin.x - frameRect.left)),
          y: Math.min(frameRect.height, Math.max(0, sourceOrigin.y - frameRect.top)),
        }
      : null
  canvasFrame.value?.contentWindow?.postMessage(
    {
      type: CANVAS_THEME_MESSAGE,
      theme: appearanceStore.scheme,
      origin,
      headerOffset: Math.max(0, Math.round(headerRect?.height || 0)),
    },
    canvasOrigin,
  )
}

function handleCanvasLoad() {
  canvasLoaded.value = true
  sendCanvasTheme()
}

function handleCanvasMessage(event) {
  if (event.source !== canvasFrame.value?.contentWindow || event.origin !== canvasOrigin) return
  if (!event.data) return

  if (event.data.type === CANVAS_ROUTE_MESSAGE) {
    const nextPath = normalizeCanvasRoutePath(event.data.path, '')
    if (!nextPath) return
    const currentPath = normalizeCanvasRoutePath(route.query.view)
    if (nextPath === currentPath) return
    const query = { ...route.query }
    if (nextPath === '/canvas') delete query.view
    else query.view = nextPath
    router.replace({ query }).catch(() => {})
    return
  }

  if (event.data.type !== CANVAS_AUTH_REQUIRED_MESSAGE) return

  authStore.resetAuthState()
  notificationService.warning('登录已过期，请重新登录')
  router
    .replace({
      path: '/auth',
      query: { mode: 'login', ...createLoginRedirectQuery(route.fullPath) },
    })
    .catch(() => {})
}

onMounted(() => {
  window.addEventListener('message', handleCanvasMessage)
  const header = document.querySelector('.site-header')
  if (header && typeof ResizeObserver !== 'undefined') {
    headerResizeObserver = new ResizeObserver(sendCanvasTheme)
    headerResizeObserver.observe(header)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', handleCanvasMessage)
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
})
watch(() => appearanceStore.scheme, sendCanvasTheme)
</script>

<template>
  <section class="canvas-app-view" :aria-busy="!canvasLoaded">
    <div v-if="!canvasLoaded" class="canvas-app-loading" role="status">
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      <span>正在加载智能画布…</span>
    </div>
    <iframe
      ref="canvasFrame"
      class="canvas-app-frame"
      :class="{ 'is-ready': canvasLoaded }"
      :src="canvasUrl"
      title="智能画布"
      sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
      allow="clipboard-read; clipboard-write"
      referrerpolicy="same-origin"
      @load="handleCanvasLoad"
    ></iframe>
  </section>
</template>

<style scoped>
.canvas-app-view {
  position: relative;
  width: 100%;
  height: auto;
  min-height: 0;
  overflow: hidden;
  background: var(--canvas-app-surface, oklch(1 0 0));
}

.canvas-app-frame {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  background: var(--canvas-app-surface, oklch(1 0 0));
  transition: opacity 160ms ease;
}

.canvas-app-frame.is-ready {
  opacity: 1;
}

.canvas-app-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--bs-secondary-color);
  background: var(--canvas-app-surface, oklch(1 0 0));
}

:global(html.color-scheme-dark) .canvas-app-view,
:global(html.color-scheme-dark) .canvas-app-frame,
:global(html.color-scheme-dark) .canvas-app-loading {
  background: var(--canvas-app-surface, oklch(0.145 0 0));
}
</style>
