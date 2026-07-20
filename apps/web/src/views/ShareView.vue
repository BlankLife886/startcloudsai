<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  createShareComment,
  getShareOverview,
  listShareComments,
  listShareItems,
  recordShareView,
  toggleShareFavorite,
} from '@/services/shareGallery'
import notificationService from '@/services/notification'
import { useAuthStore } from '@/stores/auth'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import { useSharePageMotion } from '@/features/share/composables/useSharePageMotion'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const pageRoot = ref(null)
const feedRoot = ref(null)
const detailRoot = ref(null)
const items = ref([])
const loading = ref(true)
const overviewLoading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = 16
const totalPages = ref(1)
const total = ref(0)
const hasMore = ref(false)
const pageCursors = ref([''])
const sort = ref(
  ['recommended', 'popular', 'newest'].includes(String(route.query.sort))
    ? String(route.query.sort)
    : 'recommended',
)
const category = ref(String(route.query.category || ''))
const favoritesOnly = ref(route.query.favorites === 'mine')
const overview = ref({
  stats: { creators: 0, works: 0, favorites: 0, comments: 0 },
  categories: [],
  featured: [],
  popular: [],
  trendingTags: [],
  tags: [],
  creators: [],
  commentsEnabled: false,
})
const favoriteBusy = ref(new Set())
const heroIndex = ref(0)
const heroPaused = ref(false)
const heroTransitioning = ref(false)
let heroTimer = 0
let heroTransitionTimer = 0
let listRequestId = 0
let realtimeReloadTimer = 0

const detailItem = ref(null)
const detailOpen = ref(false)
const detailClosing = ref(false)
const comments = ref([])
const commentsLoading = ref(false)
const commentSubmitting = ref(false)
const commentText = ref('')
const commentPage = ref(1)
const commentTotalPages = ref(1)
const viewedIds = new Set()

const { playDetailLeave, pulseFavorite } = useSharePageMotion({
  pageRef: pageRoot,
  feedRef: feedRoot,
  detailRef: detailRoot,
  detailOpen,
  loading,
  items,
})

const sortTabs = [
  { value: 'recommended', label: '推荐', icon: 'bi-stars' },
  { value: 'popular', label: '热门', icon: 'bi-fire' },
]

const VISIBLE_CATEGORY_LIMIT = 5
const categoryMenuOpen = ref(false)
const categoryMenuRef = ref(null)
const categoryMenuPanelRef = ref(null)
const categoryMenuStyle = ref({})
const categoryStuck = ref(false)
const categorySentinelRef = ref(null)
let categoryStuckObserver = null

function bindCategoryStuckObserver() {
  categoryStuckObserver?.disconnect()
  categoryStuckObserver = null
  categoryStuck.value = false
  if (typeof IntersectionObserver === 'undefined' || !categorySentinelRef.value) return

  const headerOffset = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-header-offset'),
  )
  const stickyTop = (Number.isFinite(headerOffset) ? headerOffset : 82) + 6

  categoryStuckObserver = new IntersectionObserver(
    ([entry]) => {
      categoryStuck.value = Boolean(entry) && entry.intersectionRatio < 1
    },
    {
      root: null,
      threshold: [1],
      rootMargin: `-${stickyTop}px 0px 0px 0px`,
    },
  )
  categoryStuckObserver.observe(categorySentinelRef.value)
}

const currentHero = computed(() => {
  const rows = overview.value.featured?.length ? overview.value.featured : items.value.slice(0, 5)
  return rows[heroIndex.value % Math.max(1, rows.length)] || null
})
const heroItems = computed(() =>
  overview.value.featured?.length ? overview.value.featured : items.value.slice(0, 5),
)
const categoryTabs = computed(() => overview.value.categories || [])
const pinnedCategory = computed(
  () => categoryTabs.value.find((item) => item.key === category.value) || null,
)
const primaryCategories = computed(() => {
  const rows = categoryTabs.value
  if (rows.length <= VISIBLE_CATEGORY_LIMIT) return rows
  const visible = rows.slice(0, VISIBLE_CATEGORY_LIMIT)
  if (pinnedCategory.value && !visible.some((item) => item.key === pinnedCategory.value.key)) {
    return [...visible.slice(0, VISIBLE_CATEGORY_LIMIT - 1), pinnedCategory.value]
  }
  return visible
})
const overflowCategories = computed(() => {
  const visibleKeys = new Set(primaryCategories.value.map((item) => item.key))
  return categoryTabs.value.filter((item) => !visibleKeys.has(item.key))
})
const hasOverflowCategories = computed(() => overflowCategories.value.length > 0)
const overflowActive = computed(
  () =>
    Boolean(pinnedCategory.value) &&
    overflowCategories.value.some((item) => item.key === category.value),
)
const currentUserId = computed(() => String(authStore.user?.id || ''))
const communityCommentsEnabled = computed(() => overview.value.commentsEnabled === true)

function openRouteDetailIfReady() {
  const itemId = String(route.query.item || '').trim()
  if (!itemId || detailClosing.value || detailItem.value?.id === itemId) return
  const candidates = [
    ...(overview.value.featured || []),
    ...(overview.value.popular || []),
    ...items.value,
  ]
  const item = candidates.find((row) => String(row?.id || '') === itemId)
  if (item) void openDetail(item)
}

function resolveUrl(url = '') {
  return String(url || '').trim()
}

function compactNumber(value = 0) {
  const number = Number(value || 0)
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`
  return String(number)
}

function authorInitial(item) {
  return String(item?.authorName || '创')
    .slice(0, 1)
    .toUpperCase()
}

function syncItem(next) {
  if (!next?.id) return
  items.value = items.value.map((item) => (item.id === next.id ? { ...item, ...next } : item))
  overview.value = {
    ...overview.value,
    featured: (overview.value.featured || []).map((item) =>
      item.id === next.id ? { ...item, ...next } : item,
    ),
    popular: (overview.value.popular || []).map((item) =>
      item.id === next.id ? { ...item, ...next } : item,
    ),
  }
  if (detailItem.value?.id === next.id) detailItem.value = { ...detailItem.value, ...next }
}

async function loadOverview() {
  overviewLoading.value = true
  try {
    const data = await getShareOverview()
    overview.value = { ...overview.value, ...data }
    if (heroIndex.value >= (data.featured?.length || 0)) heroIndex.value = 0
    await nextTick()
    openRouteDetailIfReady()
  } catch (err) {
    console.warn('社区概览读取失败', err)
  } finally {
    overviewLoading.value = false
  }
}

async function loadItems({ scroll = false, scrollBehavior = 'auto' } = {}) {
  const requestId = ++listRequestId
  loading.value = true
  error.value = ''
  try {
    const cursor = String(pageCursors.value[page.value - 1] || '')
    const data = await listShareItems({
      page: page.value,
      pageSize,
      category: category.value,
      sort: sort.value,
      favoritesOnly: favoritesOnly.value,
      cursor,
      includeTotal: page.value === 1,
    })
    if (requestId !== listRequestId) return
    if (data?.cursorInvalid && page.value > 1) {
      resetFeedPagination()
      await loadItems({ scroll, scrollBehavior })
      return
    }
    items.value = Array.isArray(data?.items) ? data.items : []
    await nextTick()
    openRouteDetailIfReady()
    hasMore.value = data?.hasMore === true
    if (data?.total !== null && data?.total !== undefined) {
      total.value = Math.max(0, Number(data.total || 0))
    }
    if (data?.totalPages !== null && data?.totalPages !== undefined) {
      totalPages.value = Math.max(1, Number(data.totalPages || 1))
    }
    const cursors = pageCursors.value.slice(0, page.value)
    cursors[page.value] = String(data?.nextCursor || '')
    pageCursors.value = cursors
    if (page.value > totalPages.value) {
      page.value = Math.max(1, totalPages.value)
      await loadItems({ scroll, scrollBehavior })
      return
    }
    if (scroll) scrollFeedIntoView(scrollBehavior)
  } catch (err) {
    if (requestId !== listRequestId) return
    error.value = err?.message || '社区作品读取失败'
  } finally {
    if (requestId === listRequestId) loading.value = false
  }
}

function scrollFeedIntoView(behavior = 'auto') {
  const el = document.getElementById('share-feed')
  if (!el) return
  const reduceMotion =
    typeof window !== 'undefined' &&
    (document.documentElement.classList.contains('settings-no-animations') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  el.scrollIntoView({
    behavior: reduceMotion || behavior === 'auto' ? 'auto' : 'smooth',
    block: 'start',
  })
}

function resetFeedPagination() {
  page.value = 1
  hasMore.value = false
  pageCursors.value = ['']
}

function applyFeed(nextSort, nextCategory = category.value) {
  categoryMenuOpen.value = false
  sort.value = nextSort
  category.value = nextCategory
  favoritesOnly.value = false
  resetFeedPagination()
  const nextQuery = { ...route.query }
  delete nextQuery.sort
  delete nextQuery.category
  delete nextQuery.favorites
  if (sort.value !== 'recommended') nextQuery.sort = sort.value
  if (category.value) nextQuery.category = category.value
  router.replace({ query: nextQuery })
  items.value = []
  scrollFeedIntoView('auto')
  void loadItems({ scroll: false })
}

function showMyFavorites() {
  if (!requireLogin()) return
  categoryMenuOpen.value = false
  favoritesOnly.value = true
  category.value = ''
  resetFeedPagination()
  const nextQuery = { ...route.query, favorites: 'mine' }
  delete nextQuery.category
  router.replace({ query: nextQuery })
  items.value = []
  scrollFeedIntoView('auto')
  void loadItems({ scroll: false })
}

function chooseCategory(key = '') {
  categoryMenuOpen.value = false
  applyFeed(sort.value === 'newest' ? 'newest' : 'recommended', category.value === key ? '' : key)
}

function updateCategoryMenuPosition() {
  const trigger = categoryMenuRef.value?.querySelector?.('button')
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const panelWidth = Math.min(320, window.innerWidth - 24)
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - panelWidth - 12)
  categoryMenuStyle.value = {
    top: `${Math.round(rect.bottom + 8)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(panelWidth)}px`,
  }
}

async function toggleCategoryMenu() {
  categoryMenuOpen.value = !categoryMenuOpen.value
  if (!categoryMenuOpen.value) return
  await nextTick()
  updateCategoryMenuPosition()
}

function handleDocumentClick(event) {
  if (!categoryMenuOpen.value) return
  const target = event.target
  if (categoryMenuRef.value?.contains?.(target)) return
  if (categoryMenuPanelRef.value?.contains?.(target)) return
  categoryMenuOpen.value = false
}

function handleCategoryMenuReposition() {
  if (!categoryMenuOpen.value) return
  updateCategoryMenuPosition()
}

function changePage(nextPage) {
  const normalized = Math.max(1, Math.min(totalPages.value, Number(nextPage || 1)))
  if (normalized === page.value || loading.value) return
  if (normalized > page.value && !hasMore.value) return
  if (normalized > 1 && !pageCursors.value[normalized - 1]) return
  page.value = normalized
  items.value = []
  // 先瞬时回到列表顶，避免等接口完成后再 smooth 滚动打架
  scrollFeedIntoView('auto')
  void loadItems({ scroll: false })
}

function requireLogin() {
  if (authStore.isAuthenticated) return true
  router.push({ name: 'auth', query: { mode: 'login', redirect: route.fullPath } })
  return false
}

async function toggleFavorite(item, event) {
  if (!requireLogin() || !item?.id || favoriteBusy.value.has(item.id)) return
  const button = event?.currentTarget
  favoriteBusy.value = new Set([...favoriteBusy.value, item.id])
  const previous = { isFavorited: item.isFavorited, favoriteCount: item.favoriteCount }
  const nextFavorited = !item.isFavorited
  syncItem({
    id: item.id,
    isFavorited: nextFavorited,
    favoriteCount: Math.max(0, Number(item.favoriteCount || 0) + (item.isFavorited ? -1 : 1)),
  })
  if (nextFavorited) pulseFavorite(button)
  try {
    const data = await toggleShareFavorite(item.id)
    syncItem({ id: item.id, isFavorited: data.favorited, favoriteCount: data.favoriteCount })
  } catch (err) {
    syncItem({ id: item.id, ...previous })
    notificationService.error(err?.message || '收藏失败')
  } finally {
    const next = new Set(favoriteBusy.value)
    next.delete(item.id)
    favoriteBusy.value = next
  }
}

async function openDetail(item) {
  if (!item?.id || detailClosing.value) return
  detailItem.value = item
  detailOpen.value = true
  commentText.value = ''
  commentPage.value = 1
  document.body.classList.add('share-detail-open')
  // 先让弹层完成首帧绘制，再拉评论/记浏览，避免打开瞬间主线程抢活
  requestAnimationFrame(() => {
    if (!detailOpen.value || detailItem.value?.id !== item.id) return
    if (communityCommentsEnabled.value) void loadComments()
    if (!viewedIds.has(item.id)) {
      viewedIds.add(item.id)
      syncItem({ id: item.id, viewCount: Number(item.viewCount || 0) + 1 })
      void recordShareView(item.id).catch(() => null)
    }
  })
}

async function closeDetail() {
  if (!detailOpen.value || detailClosing.value) return
  detailClosing.value = true
  try {
    await playDetailLeave()
  } finally {
    detailOpen.value = false
    detailItem.value = null
    comments.value = []
    detailClosing.value = false
    document.body.classList.remove('share-detail-open')
    if (route.query.item) {
      const nextQuery = { ...route.query }
      delete nextQuery.item
      void router.replace({ query: nextQuery })
    }
  }
}

async function loadComments() {
  if (!detailItem.value?.id || !communityCommentsEnabled.value) return
  const itemId = detailItem.value.id
  commentsLoading.value = true
  try {
    const data = await listShareComments(itemId, { page: commentPage.value, pageSize: 12 })
    if (detailItem.value?.id !== itemId) return
    comments.value = Array.isArray(data?.comments) ? data.comments : []
    commentTotalPages.value = Math.max(1, Number(data?.totalPages || 1))
  } catch (err) {
    notificationService.error(err?.message || '评论读取失败')
  } finally {
    commentsLoading.value = false
  }
}

async function submitComment() {
  if (!requireLogin() || !detailItem.value?.id || commentSubmitting.value) return
  const content = commentText.value.trim()
  if (content.length < 2) {
    notificationService.info('评论至少需要 2 个字符')
    return
  }
  commentSubmitting.value = true
  try {
    await createShareComment(detailItem.value.id, content)
    commentText.value = ''
    commentPage.value = 1
    syncItem({
      id: detailItem.value.id,
      commentCount: Number(detailItem.value.commentCount || 0) + 1,
    })
    await loadComments()
  } catch (err) {
    notificationService.error(err?.message || '评论发布失败')
  } finally {
    commentSubmitting.value = false
  }
}

function setCommentPage(nextPage) {
  const normalized = Math.max(1, Math.min(commentTotalPages.value, nextPage))
  if (normalized === commentPage.value) return
  commentPage.value = normalized
  void loadComments()
}

function showTag(tag) {
  category.value = ''
  sort.value = 'popular'
  resetFeedPagination()
  items.value = []
  scrollFeedIntoView('auto')
  void loadItems({ scroll: false })
  notificationService.info(`正在展示热门作品：#${tag}`)
}

function stepHero(offset) {
  const length = heroItems.value.length
  if (!length || length === 1) return
  heroTransitioning.value = true
  window.clearTimeout(heroTransitionTimer)
  heroIndex.value = (heroIndex.value + offset + length) % length
  heroTransitionTimer = window.setTimeout(() => {
    heroTransitioning.value = false
  }, 520)
}

function startHeroTimer() {
  window.clearInterval(heroTimer)
  heroTimer = window.setInterval(() => {
    if (!heroPaused.value && !heroTransitioning.value && heroItems.value.length > 1) stepHero(1)
  }, 6500)
}

function handleKeydown(event) {
  if (event.key === 'Escape' && categoryMenuOpen.value) {
    categoryMenuOpen.value = false
    return
  }
  if (event.key === 'Escape' && detailOpen.value) closeDetail()
}

function handleShareUpdated() {
  window.clearTimeout(realtimeReloadTimer)
  realtimeReloadTimer = window.setTimeout(() => {
    void Promise.all([loadOverview(), loadItems(), detailOpen.value ? loadComments() : null])
  }, 320)
}

watch(
  () => authStore.isAuthenticated,
  () => {
    resetFeedPagination()
    void Promise.all([loadOverview(), loadItems()])
  },
)

watch(
  () => route.query.item,
  () => nextTick(() => openRouteDetailIfReady()),
)

onMounted(() => {
  document.documentElement.classList.add('share-gallery-page')
  document.addEventListener('click', handleDocumentClick)
  window.addEventListener('scroll', handleCategoryMenuReposition, true)
  window.addEventListener('resize', handleCategoryMenuReposition)
  void Promise.all([loadOverview(), loadItems()])
  startHeroTimer()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('walleven:share-updated', handleShareUpdated)
  nextTick(() => bindCategoryStuckObserver())
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('share-gallery-page')
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('scroll', handleCategoryMenuReposition, true)
  window.removeEventListener('resize', handleCategoryMenuReposition)
  window.clearInterval(heroTimer)
  window.clearTimeout(heroTransitionTimer)
  window.clearTimeout(realtimeReloadTimer)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('walleven:share-updated', handleShareUpdated)
  document.body.classList.remove('share-detail-open')
  categoryStuckObserver?.disconnect()
  categoryStuckObserver = null
})
</script>

<template>
  <main ref="pageRoot" class="community-page">
    <div class="community-atmosphere" aria-hidden="true"></div>

    <section class="community-intro">
      <div class="community-copy" data-share-motion>
        <div class="community-copy__spine" aria-hidden="true">
          <span>StarCloud Gallery</span>
          <i></i>
          <em>Vol.01</em>
        </div>
        <div class="community-copy__body">
          <div class="community-copy__top">
            <span class="community-eyebrow">StarCloudIsAI</span>
            <h1>
              <span class="community-copy__title">社区画廊</span>
              <span class="community-copy__seal" aria-hidden="true">画</span>
            </h1>
            <p class="community-copy__lead">
              灵感在此汇聚。浏览创作者分享的 AI 作品，收藏心动瞬间。
            </p>
            <div class="community-copy__actions">
              <button type="button" class="is-primary" @click="applyFeed('recommended', '')">
                进入画廊<span aria-hidden="true">→</span>
              </button>
              <button type="button" class="is-text" @click="applyFeed('popular', '')">
                热门作品
              </button>
            </div>
          </div>

          <div class="community-copy__foot">
            <div v-if="heroItems.length" class="community-copy__thumbs" aria-hidden="true">
              <span
                v-for="(item, index) in heroItems.slice(0, 3)"
                :key="item.id"
                class="community-copy__thumb"
                :style="{ '--i': index }"
              >
                <ShareProgressiveImage :src="resolveUrl(item.resultUrl)" :alt="item.title" eager />
              </span>
            </div>
            <div
              class="community-stats"
              :class="{
                'is-loading': overviewLoading,
                'is-comments-off': !communityCommentsEnabled,
              }"
            >
              <div>
                <strong>{{ compactNumber(overview.stats.creators) }}+</strong>
                <span>创作者</span>
              </div>
              <div>
                <strong>{{ compactNumber(overview.stats.works) }}+</strong>
                <span>作品</span>
              </div>
              <div>
                <strong>{{ compactNumber(overview.stats.favorites) }}+</strong>
                <span>收藏</span>
              </div>
              <div v-if="communityCommentsEnabled">
                <strong>{{ compactNumber(overview.stats.comments) }}+</strong>
                <span>评论</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="community-featured"
        :class="{ 'is-empty': !currentHero, 'is-transitioning': heroTransitioning }"
        data-share-motion
        role="button"
        tabindex="0"
        :aria-label="currentHero ? `查看精选作品：${currentHero.title}` : '等待精选作品'"
        @mouseenter="heroPaused = true"
        @mouseleave="heroPaused = false"
        @click="currentHero && openDetail(currentHero)"
        @keydown.enter.prevent="currentHero && openDetail(currentHero)"
      >
        <template v-if="currentHero">
          <ShareProgressiveImage
            :key="currentHero.id"
            class="community-featured__image"
            :src="resolveUrl(currentHero.resultUrl)"
            :alt="currentHero.title"
            eager
          />
          <div class="community-featured__shade"></div>
          <div class="community-featured__frame" aria-hidden="true"></div>
          <div class="community-featured__meta" :key="`meta-${currentHero.id}`">
            <span class="community-featured__index">
              Featured {{ String(heroIndex + 1).padStart(2, '0') }}
            </span>
            <span class="community-featured__tag">{{ currentHero.categoryLabel }}</span>
            <strong>{{ currentHero.title }}</strong>
            <small>{{ currentHero.authorName || '社区创作者' }}</small>
          </div>
          <button
            class="community-featured__arrow is-prev"
            type="button"
            aria-label="上一张"
            @click.stop="stepHero(-1)"
          >
            <i class="bi bi-chevron-left"></i>
          </button>
          <button
            class="community-featured__arrow is-next"
            type="button"
            aria-label="下一张"
            @click.stop="stepHero(1)"
          >
            <i class="bi bi-chevron-right"></i>
          </button>
          <div class="community-featured__dots" @click.stop>
            <button
              v-for="(item, index) in heroItems"
              :key="item.id"
              type="button"
              :class="{ 'is-active': index === heroIndex }"
              :aria-label="`切换到 ${item.title}`"
              @click="heroIndex !== index && stepHero(index - heroIndex)"
            >
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
            </button>
          </div>
        </template>
        <div v-else class="community-featured__placeholder">
          <i class="bi bi-images"></i><span>等待精选作品</span>
        </div>
      </div>

      <aside class="community-hot-panel" data-share-motion>
        <header>
          <div>
            <em>Board</em>
            <strong>热门排行榜</strong>
          </div>
          <button type="button" @click="applyFeed('popular', '')">完整榜单 →</button>
        </header>
        <ol>
          <li
            v-for="(item, index) in overview.popular.slice(0, 5)"
            :key="item.id"
            @click="openDetail(item)"
          >
            <b>{{ String(index + 1).padStart(2, '0') }}</b>
            <ShareProgressiveImage :src="resolveUrl(item.resultUrl)" alt="" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.authorName || '社区创作者' }}</small>
            </span>
            <em><i class="bi bi-heart"></i>{{ compactNumber(item.favoriteCount) }}</em>
          </li>
        </ol>
      </aside>
    </section>

    <section id="share-feed" class="community-body">
      <div ref="categorySentinelRef" class="community-categories-sentinel" aria-hidden="true"></div>
      <nav
        class="community-categories"
        :class="{ 'is-stuck': categoryStuck }"
        aria-label="作品分类"
      >
        <button
          v-for="tab in sortTabs"
          :key="tab.value"
          type="button"
          :class="{ 'is-active': sort === tab.value && !category && !favoritesOnly }"
          @click="applyFeed(tab.value, '')"
        >
          <i class="bi" :class="tab.icon"></i>{{ tab.label }}
        </button>
        <button
          v-for="tab in primaryCategories"
          :key="tab.key"
          type="button"
          :class="{ 'is-active': category === tab.key }"
          @click="chooseCategory(tab.key)"
        >
          <i class="bi" :class="tab.icon || 'bi-grid'"></i>{{ tab.label }}
        </button>
        <div
          v-if="hasOverflowCategories"
          ref="categoryMenuRef"
          class="community-category-more"
          :class="{ 'is-open': categoryMenuOpen, 'is-active': overflowActive }"
        >
          <button
            type="button"
            :class="{ 'is-active': overflowActive || categoryMenuOpen }"
            :aria-expanded="categoryMenuOpen"
            aria-haspopup="listbox"
            @click.stop="toggleCategoryMenu"
          >
            <i class="bi bi-grid-3x3-gap"></i>
            <span>{{ overflowActive ? pinnedCategory?.label : '更多' }}</span>
            <i class="bi bi-chevron-down community-category-more__caret"></i>
          </button>
        </div>
        <span class="community-categories__split" aria-hidden="true"></span>
        <button
          type="button"
          :class="{ 'is-active': sort === 'newest' && !category && !favoritesOnly }"
          @click="applyFeed('newest', '')"
        >
          <i class="bi bi-clock"></i>最新
        </button>
        <button type="button" :class="{ 'is-active': favoritesOnly }" @click="showMyFavorites">
          <i class="bi bi-heart"></i>我的收藏
        </button>
      </nav>

      <Teleport to="body">
        <div
          v-if="hasOverflowCategories && categoryMenuOpen"
          ref="categoryMenuPanelRef"
          class="community-category-more__panel"
          role="listbox"
          aria-label="更多分类"
          :style="categoryMenuStyle"
          @click.stop
        >
          <button
            v-for="tab in overflowCategories"
            :key="tab.key"
            type="button"
            role="option"
            :aria-selected="category === tab.key"
            :class="{ 'is-active': category === tab.key }"
            @click="chooseCategory(tab.key)"
          >
            <i class="bi" :class="tab.icon || 'bi-grid'"></i>{{ tab.label }}
          </button>
        </div>
      </Teleport>

      <div class="community-main" data-share-motion>
        <div class="community-feed-head">
          <div>
            <strong>{{
              favoritesOnly
                ? '我的收藏'
                : category
                  ? categoryTabs.find((item) => item.key === category)?.label
                  : sortTabs.find((item) => item.value === sort)?.label || '最新'
            }}</strong>
            <span>共 {{ total }} 件</span>
          </div>
          <button type="button" :disabled="loading" @click="loadItems()">
            <i class="bi bi-arrow-clockwise" :class="{ spin: loading }"></i>刷新
          </button>
        </div>

        <div ref="feedRoot" class="community-feed-body" :class="{ 'is-loading': loading }">
          <div
            v-if="loading && !items.length"
            class="community-grid"
            aria-label="加载作品"
            aria-busy="true"
          >
            <article
              v-for="index in pageSize"
              :key="`sk-${index}`"
              class="community-card is-skeleton"
            >
              <div class="community-card__media"></div>
              <footer><strong></strong><small></small></footer>
            </article>
          </div>
          <div v-else-if="error" class="community-empty is-error">
            <i class="bi bi-exclamation-circle"></i><strong>{{ error }}</strong
            ><button type="button" @click="loadItems()">重新加载</button>
          </div>
          <div v-else-if="!items.length" class="community-empty">
            <i class="bi bi-images"></i><strong>这个分类还没有作品</strong
            ><span>换个分类看看，或分享你的 AI 创作。</span>
          </div>
          <div v-else class="community-grid" aria-label="社区作品" :aria-busy="loading">
            <article
              v-for="item in items"
              :key="item.id"
              class="community-card"
              @click="openDetail(item)"
            >
              <div class="community-card__media">
                <ShareProgressiveImage :src="resolveUrl(item.resultUrl)" :alt="item.title" />
                <span v-if="item.featured" class="community-card__featured">精选</span>
                <div class="community-card__overlay"><span>查看</span></div>
              </div>
              <footer>
                <strong :title="item.title">{{ item.title }}</strong>
                <div class="community-card__meta">
                  <small>{{ item.authorName || '社区创作者' }}</small>
                  <div class="community-card__actions">
                    <button
                      type="button"
                      :class="{ 'is-active': item.isFavorited }"
                      :disabled="favoriteBusy.has(item.id)"
                      @click.stop="toggleFavorite(item, $event)"
                    >
                      <i class="bi" :class="item.isFavorited ? 'bi-heart-fill' : 'bi-heart'"></i
                      >{{ compactNumber(item.favoriteCount) }}
                    </button>
                    <button
                      v-if="communityCommentsEnabled"
                      type="button"
                      @click.stop="openDetail(item)"
                    >
                      <i class="bi bi-chat-square"></i>{{ compactNumber(item.commentCount) }}
                    </button>
                  </div>
                </div>
              </footer>
            </article>
          </div>
        </div>

        <nav v-if="totalPages > 1 || page > 1" class="community-pagination" aria-label="作品分页">
          <button type="button" :disabled="loading || page <= 1" @click="changePage(page - 1)">
            <i class="bi bi-chevron-left"></i><span>上一页</span>
          </button>
          <div class="community-pagination__meta">
            <em>Page</em>
            <strong
              >{{ String(page).padStart(2, '0') }} <span>/</span>
              {{ String(totalPages).padStart(2, '0') }}</strong
            >
            <small>共 {{ total }} 件作品</small>
          </div>
          <button type="button" :disabled="loading || !hasMore" @click="changePage(page + 1)">
            <span>下一页</span><i class="bi bi-chevron-right"></i>
          </button>
        </nav>
      </div>

      <aside class="community-sidebar">
        <section class="community-side-card community-side-card--tags">
          <header>
            <div>
              <em>Tags</em>
              <strong>趋势标签</strong>
            </div>
            <button type="button" @click="loadOverview">
              <i class="bi bi-arrow-repeat"></i>换一换
            </button>
          </header>
          <div class="community-tags">
            <button
              v-for="row in overview.trendingTags"
              :key="row.tag"
              type="button"
              @click="showTag(row.tag)"
            >
              # {{ row.tag }}
            </button>
            <span v-if="!overview.trendingTags?.length">等待更多作品标签</span>
          </div>
        </section>
        <section class="community-side-card community-side-card--creators">
          <header>
            <div>
              <em>Creators</em>
              <strong>优秀创作者</strong>
            </div>
          </header>
          <ul class="community-creators">
            <li v-for="creator in overview.creators" :key="creator.id">
              <span class="community-creator-avatar">{{ creator.name.slice(0, 1) }}</span>
              <div>
                <strong>{{ creator.name }}</strong>
                <small
                  >{{ creator.workCount }} 件作品 ·
                  {{ compactNumber(creator.favoriteCount) }} 收藏</small
                >
              </div>
              <span class="community-creator-badge">创作者</span>
            </li>
          </ul>
        </section>
      </aside>
    </section>

    <Teleport to="body">
      <div v-if="detailOpen && detailItem" ref="detailRoot" class="share-detail">
        <div class="share-detail__scrim" aria-hidden="true" @click="closeDetail"></div>
        <section
          class="share-detail__panel"
          role="dialog"
          aria-modal="true"
          :aria-label="detailItem.title"
        >
          <button class="share-detail__close" type="button" aria-label="关闭" @click="closeDetail">
            <i class="bi bi-x-lg"></i>
          </button>
          <div class="share-detail__visual">
            <div class="share-detail__frame" aria-hidden="true"></div>
            <ShareProgressiveImage
              :src="resolveUrl(detailItem.resultUrl)"
              :alt="detailItem.title"
              eager
            />
            <span class="share-detail__visual-mark">Artwork</span>
          </div>
          <div class="share-detail__content">
            <div class="share-detail__spine" aria-hidden="true">
              <span>StarCloud Gallery</span>
              <i></i>
              <em>Detail</em>
            </div>
            <div class="share-detail__body">
              <header class="share-detail__top">
                <div class="share-detail__author">
                  <span>{{ authorInitial(detailItem) }}</span>
                  <div>
                    <strong>{{ detailItem.authorName || '社区创作者' }}</strong>
                    <small
                      >{{ detailItem.categoryLabel }} ·
                      {{ detailItem.styleLabel || 'AI 创作' }}</small
                    >
                  </div>
                </div>
                <button
                  type="button"
                  :class="{ 'is-active': detailItem.isFavorited }"
                  @click="toggleFavorite(detailItem, $event)"
                >
                  <i class="bi" :class="detailItem.isFavorited ? 'bi-heart-fill' : 'bi-heart'"></i>
                  {{ detailItem.isFavorited ? '已收藏' : '收藏' }}
                </button>
              </header>

              <div class="share-detail__intro">
                <em>Work</em>
                <h2>{{ detailItem.title }}</h2>
                <p v-if="detailItem.description">{{ detailItem.description }}</p>
                <div v-if="detailItem.tags?.length" class="share-detail__tags">
                  <span v-for="tag in detailItem.tags" :key="tag"># {{ tag }}</span>
                </div>
                <div class="share-detail__stats">
                  <span
                    ><i class="bi bi-eye"></i>{{ compactNumber(detailItem.viewCount) }} 浏览</span
                  >
                  <span
                    ><i class="bi bi-heart"></i
                    >{{ compactNumber(detailItem.favoriteCount) }} 收藏</span
                  >
                </div>
              </div>

              <div class="share-permissions">
                <header>
                  <div>
                    <em>License</em>
                    <strong>作品授权</strong>
                  </div>
                  <span>{{ detailItem.licenseLabel }}</span>
                </header>
                <ul>
                  <li :class="{ 'is-allowed': detailItem.allowDownload }">
                    <i class="bi" :class="detailItem.allowDownload ? 'bi-check-lg' : 'bi-x-lg'"></i
                    >生成图下载
                  </li>
                  <li :class="{ 'is-allowed': detailItem.allowRemix }">
                    <i class="bi" :class="detailItem.allowRemix ? 'bi-check-lg' : 'bi-x-lg'"></i
                    >二次创作
                  </li>
                  <li :class="{ 'is-allowed': detailItem.allowRepost }">
                    <i class="bi" :class="detailItem.allowRepost ? 'bi-check-lg' : 'bi-x-lg'"></i
                    >转载
                  </li>
                </ul>
                <a
                  v-if="detailItem.allowDownload && detailItem.downloadUrl"
                  :href="detailItem.downloadUrl"
                  target="_blank"
                  rel="noopener"
                  download
                >
                  <i class="bi bi-download"></i>下载授权生成图
                </a>
                <details v-if="detailItem.promptVisibility === 'public' && detailItem.prompt">
                  <summary>查看公开提示词与生成参数</summary>
                  <p>{{ detailItem.prompt }}</p>
                  <dl v-if="Object.keys(detailItem.generationParams || {}).length">
                    <template v-for="(value, key) in detailItem.generationParams" :key="key">
                      <dt>{{ key }}</dt>
                      <dd>{{ value }}</dd>
                    </template>
                  </dl>
                </details>
                <p v-else class="share-permissions__private">
                  <i class="bi bi-lock"></i>创作者未公开提示词与生成参数
                </p>
              </div>

              <div v-if="communityCommentsEnabled" class="share-comments">
                <header class="share-comments__title">
                  <div>
                    <em>Comments</em>
                    <strong>评论 {{ detailItem.commentCount || 0 }}</strong>
                  </div>
                </header>
                <form
                  v-if="detailItem.commentsEnabled"
                  class="share-comment-form"
                  @submit.prevent="submitComment"
                >
                  <textarea
                    v-model="commentText"
                    maxlength="500"
                    rows="2"
                    :placeholder="authStore.isAuthenticated ? '写下你的想法…' : '登录后参与评论'"
                    @focus="requireLogin"
                  ></textarea>
                  <button
                    type="submit"
                    :disabled="commentSubmitting || commentText.trim().length < 2"
                  >
                    {{ commentSubmitting ? '发布中…' : '发布' }}
                  </button>
                </form>
                <div v-else class="share-comments__closed">
                  <em>Notes</em>
                  <p><i class="bi bi-chat-square-dots"></i>创作者已关闭新评论</p>
                </div>
                <div v-if="commentsLoading" class="share-comments__state">评论加载中…</div>
                <div v-else-if="!comments.length" class="share-comments__state">
                  还没有评论，来聊聊这幅作品吧。
                </div>
                <ul v-else class="share-comment-list">
                  <li v-for="comment in comments" :key="comment.id">
                    <span>{{ comment.authorName.slice(0, 1) }}</span>
                    <div>
                      <strong>
                        {{ comment.authorName }}
                        <time>{{ new Date(comment.createdAt).toLocaleDateString('zh-CN') }}</time>
                      </strong>
                      <p>{{ comment.content }}</p>
                    </div>
                  </li>
                </ul>
                <nav v-if="commentTotalPages > 1" class="share-comment-pages">
                  <button
                    type="button"
                    :disabled="commentPage <= 1"
                    @click="setCommentPage(commentPage - 1)"
                  >
                    上一页
                  </button>
                  <span>{{ commentPage }} / {{ commentTotalPages }}</span>
                  <button
                    type="button"
                    :disabled="commentPage >= commentTotalPages"
                    @click="setCommentPage(commentPage + 1)"
                  >
                    下一页
                  </button>
                </nav>
              </div>
              <div v-else class="share-comments share-comments__closed">
                <em>Notes</em>
                <p><i class="bi bi-chat-square-dots"></i>社区评论暂未开放</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style src="../features/share/styles/share-view.css"></style>
