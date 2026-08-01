<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listPromptLibrary, recordPromptEngagement } from '@/services/promptLibrary'
import { T2I_PROMPT_LIBRARY } from '@/features/ai-wallpaper/composables/wallpaperStudioConstants'
import notificationService from '@/services/notification'
import {
  PROMPT_CATEGORIES,
  PROMPT_TASK_TYPES,
  stashPendingPrompt,
  studioRouteForTaskType,
} from '@/features/creator-hub/studioTools'
import { useVirtualMasonryFeed } from '@/features/creator-hub/useVirtualMasonryFeed'
import { setBodyScrollLock } from '@/utils/bodyScrollLock'
import '@/features/creator-hub/creator-hub.css'

const router = useRouter()
const authStore = useAuthStore()

const PROMPT_PREVIEW_SCROLL_LOCK = 'prompt-library-preview'

const items = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const page = ref(1)
const hasMore = ref(false)
const search = ref('')
const activeType = ref('t2i')
const activeCategory = ref('all')
const preview = ref(null)
const previewPanelRef = ref(null)
const loadSentinelRef = ref(null)
let requestId = 0
let loadObserver = null
let previewUnlockTimer = 0
let previewInertiaGuardCleanup = null

const categoryMeta = computed(() =>
  PROMPT_CATEGORIES.filter((item) => {
    if (item.scope === 'favorites' && !authStore.isAuthenticated) return false
    return true
  }),
)

const activeTypeLabel = computed(
  () => PROMPT_TASK_TYPES.find((item) => item.id === activeType.value)?.label || '文生图',
)

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((item) =>
    `${item.title || ''} ${item.prompt || ''} ${(item.tags || []).join(' ')}`
      .toLowerCase()
      .includes(q),
  )
})

const previewIndex = computed(() => {
  if (!preview.value) return -1
  const id = String(preview.value.id || '')
  if (id) return filteredItems.value.findIndex((item) => String(item.id) === id)
  return filteredItems.value.findIndex((item) => item === preview.value)
})

const hasPreviewPrev = computed(() => previewIndex.value > 0)
const hasPreviewNext = computed(
  () => previewIndex.value >= 0 && previewIndex.value < filteredItems.value.length - 1,
)

const masonryItems = computed(() =>
  filteredItems.value.map((item, index) => ({
    key: String(item.id || index),
    item,
    index,
    aspect:
      Number(item.coverWidth) > 0 && Number(item.coverHeight) > 0
        ? `${item.coverWidth} / ${item.coverHeight}`
        : '3 / 4',
    cover: item.coverUrl || item.imageUrl || '',
  })),
)

const {
  containerRef: masonryRef,
  visibleItems: visibleMasonryItems,
  columnCount,
  totalHeight: masonryHeight,
  measureFromEvent,
  scheduleViewportMeasure,
} = useVirtualMasonryFeed({
  items: masonryItems,
  fallbackAspect: 3 / 4,
  bodyHeight: 178,
  overscan: 960,
  getAspect: (entry) => entry.aspect,
})

function imageLoadingMode(index) {
  return index < Math.max(6, columnCount.value * 2) ? 'eager' : 'lazy'
}

function imageFetchPriority(index) {
  return index < Math.max(4, columnCount.value) ? 'high' : 'low'
}

function activeScope() {
  const hit = PROMPT_CATEGORIES.find((item) => item.id === activeCategory.value)
  return hit?.scope || ''
}

function categoryParam() {
  if (activeScope()) return ''
  return activeCategory.value === 'all' ? '' : activeCategory.value
}

function disconnectLoadObserver() {
  loadObserver?.disconnect()
  loadObserver = null
}

function setupLoadObserver() {
  disconnectLoadObserver()
  if (typeof IntersectionObserver === 'undefined') return
  const sentinel = loadSentinelRef.value
  if (!sentinel || !hasMore.value) return
  loadObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      void loadPrompts({ reset: false })
    },
    { root: null, rootMargin: '1200px 0px', threshold: 0 },
  )
  loadObserver.observe(sentinel)
}

function stopPreviewInertiaGuard() {
  previewInertiaGuardCleanup?.()
  previewInertiaGuardCleanup = null
}

function startPreviewInertiaGuard(ms = 0, { allowPreviewScroll = false } = {}) {
  stopPreviewInertiaGuard()

  const shouldBlock = (event) => {
    if (!allowPreviewScroll) return true
    const scroller =
      event.target?.closest?.('.ch-preview__media') || event.target?.closest?.('.ch-preview__mid')
    if (!scroller) return true
    if (event.type === 'touchmove') return false

    const { scrollTop, scrollHeight, clientHeight } = scroller
    const delta = Number(event.deltaY) || 0
    if (scrollHeight <= clientHeight + 1) return true
    const atTop = scrollTop <= 0
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1
    return (atTop && delta < 0) || (atBottom && delta > 0)
  }

  const onWheel = (event) => {
    if (shouldBlock(event)) event.preventDefault()
  }
  const onTouchMove = (event) => {
    if (shouldBlock(event)) event.preventDefault()
  }

  document.addEventListener('wheel', onWheel, { passive: false, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })

  const timer =
    ms > 0
      ? window.setTimeout(() => {
          document.removeEventListener('wheel', onWheel, { capture: true })
          document.removeEventListener('touchmove', onTouchMove, { capture: true })
          if (previewInertiaGuardCleanup) previewInertiaGuardCleanup = null
        }, ms)
      : 0

  previewInertiaGuardCleanup = () => {
    if (timer) window.clearTimeout(timer)
    document.removeEventListener('wheel', onWheel, { capture: true })
    document.removeEventListener('touchmove', onTouchMove, { capture: true })
  }
}

async function loadPrompts({ reset = true } = {}) {
  if (!reset && (loadingMore.value || loading.value || !hasMore.value)) return
  const id = reset ? ++requestId : requestId
  if (reset) {
    loading.value = true
    page.value = 1
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  } else {
    loadingMore.value = true
  }
  try {
    const nextPage = reset ? 1 : page.value + 1
    const response = await listPromptLibrary(activeType.value, {
      pageNumber: nextPage,
      pageSize: 24,
      category: categoryParam(),
      scope: activeScope(),
      fallbackItems: activeType.value === 't2i' ? T2I_PROMPT_LIBRARY : [],
    })
    if (id !== requestId) return
    items.value = reset ? response.items || [] : [...items.value, ...(response.items || [])]
    page.value = nextPage
    hasMore.value = Boolean(response.hasMore)
  } catch (error) {
    if (reset) items.value = []
    notificationService.error(error?.message || '提示词读取失败')
  } finally {
    if (id === requestId) {
      loading.value = false
      loadingMore.value = false
      await nextTick()
      scheduleViewportMeasure()
      setupLoadObserver()
    }
  }
}

function setType(type) {
  if (activeType.value === type) return
  activeType.value = type
  activeCategory.value = 'all'
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

function setCategory(id) {
  if (activeCategory.value === id) return
  activeCategory.value = id
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

async function usePrompt(item) {
  const prompt = String(item?.prompt || '').trim()
  if (!prompt) return
  const taskType = item?.taskType || activeType.value || 't2i'
  stashPendingPrompt({ prompt, taskType })
  if (item?.id) {
    void recordPromptEngagement(item.id, 'use', true).catch(() => null)
  }
  if (taskType === 't2i') {
    notificationService.success('已带到工作台')
  } else {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      /* ignore */
    }
    notificationService.success('提示词已复制，请在工作台粘贴')
  }
  closePreview()
  await router.push(studioRouteForTaskType(taskType))
}

async function toggleFavorite(item) {
  if (!authStore.isAuthenticated) {
    notificationService.info('登录后可收藏提示词')
    return
  }
  if (!item?.id) return
  const next = !item.favorited
  try {
    await recordPromptEngagement(item.id, 'favorite', next)
    item.favorited = next
    item.favoriteCount = Math.max(0, Number(item.favoriteCount || 0) + (next ? 1 : -1))
  } catch (error) {
    notificationService.error(error?.message || '收藏失败')
  }
}

async function copyPrompt(item) {
  const prompt = String(item?.prompt || '').trim()
  if (!prompt) {
    notificationService.info('没有可复制的提示词')
    return
  }
  try {
    await navigator.clipboard.writeText(prompt)
    notificationService.success('提示词已复制')
  } catch {
    notificationService.error('复制失败，请手动选择文本')
  }
}

function openPreview(item) {
  if (previewUnlockTimer) {
    window.clearTimeout(previewUnlockTimer)
    previewUnlockTimer = 0
  }
  stopPreviewInertiaGuard()
  preview.value = item
  setBodyScrollLock(PROMPT_PREVIEW_SCROLL_LOCK, true, { freezeViewport: false })
  startPreviewInertiaGuard(0, { allowPreviewScroll: true })
  nextTick(() => {
    const media = previewPanelRef.value?.querySelector?.('.ch-preview__media')
    if (media) media.scrollTop = 0
  })
}

function showPreviewAt(index) {
  const item = filteredItems.value[index]
  if (!item) return
  preview.value = item
  nextTick(() => {
    const media = previewPanelRef.value?.querySelector?.('.ch-preview__media')
    const mid = previewPanelRef.value?.querySelector?.('.ch-preview__mid')
    if (media) media.scrollTop = 0
    if (mid) mid.scrollTop = 0
  })
}

function showPreviewPrev() {
  if (!hasPreviewPrev.value) return
  showPreviewAt(previewIndex.value - 1)
}

function showPreviewNext() {
  if (!hasPreviewNext.value) return
  showPreviewAt(previewIndex.value + 1)
}

function closePreview() {
  const root = previewPanelRef.value
  const media = root?.querySelector?.('.ch-preview__media')
  const mid = root?.querySelector?.('.ch-preview__mid')
  for (const el of [media, mid]) {
    if (!el) continue
    el.style.overflow = 'hidden'
    el.scrollTop = el.scrollTop
  }

  preview.value = null
  startPreviewInertiaGuard(450, { allowPreviewScroll: false })
  if (previewUnlockTimer) window.clearTimeout(previewUnlockTimer)
  previewUnlockTimer = window.setTimeout(() => {
    previewUnlockTimer = 0
    setBodyScrollLock(PROMPT_PREVIEW_SCROLL_LOCK, false)
  }, 50)
}

function onPreviewKeydown(event) {
  if (!preview.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreview()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    showPreviewPrev()
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    showPreviewNext()
  }
}

watch([activeType, activeCategory], () => {
  void loadPrompts({ reset: true })
})

watch(preview, (value) => {
  if (typeof document === 'undefined') return
  if (value) document.addEventListener('keydown', onPreviewKeydown)
  else document.removeEventListener('keydown', onPreviewKeydown)
})

onMounted(() => {
  document.documentElement.classList.add('creator-hub-sticky-page')
  void loadPrompts({ reset: true })
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('creator-hub-sticky-page')
  document.removeEventListener('keydown', onPreviewKeydown)
  if (previewUnlockTimer) window.clearTimeout(previewUnlockTimer)
  stopPreviewInertiaGuard()
  setBodyScrollLock(PROMPT_PREVIEW_SCROLL_LOCK, false)
  disconnectLoadObserver()
})
</script>

<template>
  <main class="ch-page ch-page--prompts">
    <div class="ch-shell">
      <div class="ch-sticky-bar">
        <div class="ch-toolbar">
          <label class="ch-search">
            <i class="bi bi-search" aria-hidden="true"></i>
            <input v-model="search" type="search" placeholder="搜索标题、提示词或标签" />
          </label>
        </div>

        <div class="ch-chips" aria-label="工作台">
          <button
            v-for="type in PROMPT_TASK_TYPES"
            :key="type.id"
            type="button"
            class="ch-chip"
            :class="{ 'is-active': activeType === type.id }"
            @click="setType(type.id)"
          >
            {{ type.label }}
          </button>
        </div>

        <div class="ch-chips" aria-label="分类">
          <button
            v-for="cat in categoryMeta"
            :key="cat.id"
            type="button"
            class="ch-chip"
            :class="{ 'is-active': activeCategory === cat.id }"
            @click="setCategory(cat.id)"
          >
            {{ cat.label }}
          </button>
        </div>
      </div>

      <section class="ch-section">
        <div v-if="loading && !filteredItems.length" class="ch-loading">正在加载提示词…</div>

        <div v-else-if="!filteredItems.length" class="ch-empty">
          <strong>暂无提示词</strong>
          <span>换个分类试试，或稍后再来看官方更新</span>
        </div>

        <div
          v-else
          ref="masonryRef"
          class="ch-prompt-masonry"
          :style="{ height: `${masonryHeight}px` }"
        >
          <article
            v-for="entry in visibleMasonryItems"
            :key="entry.key"
            class="ch-card ch-prompt-masonry__item"
            :style="{
              width: `${entry.width}px`,
              height: `${entry.height}px`,
              transform: `translate3d(${entry.left}px, ${entry.top}px, 0)`,
            }"
          >
            <button
              type="button"
              class="ch-card__media ch-prompt-card__media"
              :style="{ height: `${entry.mediaHeight}px` }"
              @click="openPreview(entry.item)"
            >
              <img
                v-if="entry.cover"
                :src="entry.cover"
                :alt="entry.item.title || '提示词'"
                :loading="imageLoadingMode(entry.index)"
                :fetchpriority="imageFetchPriority(entry.index)"
                decoding="async"
                :width="Math.max(1, Math.round(entry.width))"
                :height="Math.max(1, entry.mediaHeight)"
                @load="measureFromEvent(entry.key, $event)"
              />
              <div v-else class="ch-card__placeholder">
                <i class="bi bi-quote" aria-hidden="true"></i>
                {{ entry.item.title || '灵感' }}
              </div>
            </button>
            <div class="ch-card__body">
              <div class="ch-card__meta">
                <span class="ch-pill">{{ entry.item.category || activeTypeLabel }}</span>
                <span v-if="entry.item.useCount" class="ch-pill">
                  <i class="bi bi-lightning-charge" aria-hidden="true"></i>
                  {{ entry.item.useCount }}
                </span>
              </div>
              <h3 class="ch-card__title">
                {{ entry.item.title || entry.item.label || '未命名灵感' }}
              </h3>
              <p class="ch-card__prompt" data-no-translate>{{ entry.item.prompt }}</p>
              <div class="ch-card__actions">
                <button type="button" class="is-primary" @click="usePrompt(entry.item)">
                  去做图
                </button>
                <button type="button" @click="copyPrompt(entry.item)">复制</button>
                <button type="button" @click="toggleFavorite(entry.item)">
                  {{ entry.item.favorited ? '已收藏' : '收藏' }}
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-if="hasMore || loadingMore" ref="loadSentinelRef" class="ch-more" aria-live="polite">
          <span v-if="loadingMore" class="ch-more__hint">加载中…</span>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="preview"
        class="ch-preview-layer"
        role="presentation"
        @mousedown.self="closePreview"
      >
        <button
          type="button"
          class="ch-preview__nav is-prev"
          :disabled="!hasPreviewPrev"
          aria-label="上一条"
          @click="showPreviewPrev"
        >
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="ch-preview__nav is-next"
          :disabled="!hasPreviewNext"
          aria-label="下一条"
          @click="showPreviewNext"
        >
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>

        <div
          ref="previewPanelRef"
          class="ch-preview"
          role="dialog"
          aria-modal="true"
          aria-label="提示词详情"
        >
          <div class="ch-preview__media">
            <img
              v-if="preview.coverUrl || preview.imageUrl"
              :src="preview.coverUrl || preview.imageUrl"
              :alt="preview.title || '提示词'"
              loading="eager"
              decoding="async"
              fetchpriority="high"
            />
            <div v-else class="ch-preview__empty">暂无预览图</div>
          </div>

          <aside class="ch-preview__body">
            <div class="ch-preview__top">
              <div class="ch-card__meta">
                <span class="ch-pill">{{ preview.category || activeTypeLabel }}</span>
                <span v-if="preview.useCount" class="ch-pill">
                  <i class="bi bi-lightning-charge" aria-hidden="true"></i>
                  {{ preview.useCount }}
                </span>
                <span v-if="preview.favoriteCount" class="ch-pill">
                  <i class="bi bi-heart" aria-hidden="true"></i>
                  {{ preview.favoriteCount }}
                </span>
              </div>
              <h2 class="ch-card__title" style="margin-top: 10px">
                {{ preview.title || preview.label || '未命名灵感' }}
              </h2>
            </div>

            <div class="ch-preview__mid">
              <p class="ch-preview__prompt" data-no-translate>
                {{ preview.prompt || '暂无提示词' }}
              </p>
            </div>

            <div class="ch-preview__bottom">
              <div class="ch-card__actions">
                <button
                  v-if="preview.prompt"
                  type="button"
                  class="is-primary"
                  @click="copyPrompt(preview)"
                >
                  复制提示词
                </button>
                <button type="button" @click="usePrompt(preview)">去做图</button>
                <button type="button" @click="toggleFavorite(preview)">
                  {{ preview.favorited ? '已收藏' : '收藏' }}
                </button>
                <button type="button" @click="closePreview">关闭</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Teleport>
  </main>
</template>
