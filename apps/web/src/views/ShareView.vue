<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listGalleryCategories, listShareItems } from '@/services/shareGallery'
import { useAuthStore } from '@/stores/auth'
import ShareProgressiveImage from '@/features/share/components/ShareProgressiveImage.vue'
import { useSharePageMotion } from '@/features/share/composables/useSharePageMotion'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const pageRoot = ref(null)
const feedRoot = ref(null)
const detailRoot = ref(null)

/* —— 作品列表：GET /api/gallery，cursor 分页做成前后翻页 —— */
const items = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const pageSize = 16
const hasMore = ref(false)
const pageCursors = ref([''])
let listRequestId = 0

/* 首页精选轮播与统计取自第一页样本，翻页时保持稳定 */
const spotlightItems = ref([])
const seenItems = ref(new Map())

/* 精选轮播优先用 ?featured=1 数据，不足 3 件时回退第一页样本 */
const featuredItems = ref([])

/* 分类筛选：GET /api/gallery/categories，选中后带 ?category= 重新拉列表 */
const categories = ref([])
const activeCategory = ref('')

const heroIndex = ref(0)
const heroPaused = ref(false)
const heroTransitioning = ref(false)
let heroTimer = 0
let heroTransitionTimer = 0

const detailItem = ref(null)
const detailOpen = ref(false)
const detailClosing = ref(false)
const detailMediaIndex = ref(0)

const categoryStuck = ref(false)
const categorySentinelRef = ref(null)
let categoryStuckObserver = null

const { playDetailLeave } = useSharePageMotion({
  pageRef: pageRoot,
  feedRef: feedRoot,
  detailRef: detailRoot,
  detailOpen,
  loading,
  items,
})

function normalizeItem(raw) {
  const cover = raw?.coverUrl || raw?.mediaUrls?.[0] || ''
  if (!raw?.id || !cover) return null
  return {
    id: String(raw.id),
    title: String(raw.title || '').trim() || 'AI 作品',
    cover,
    mediaUrls: Array.isArray(raw.mediaUrls) && raw.mediaUrls.length ? raw.mediaUrls : [cover],
    authorName: raw.author?.username || '社区创作者',
    authorAvatar: raw.author?.avatarUrl || '',
    createdAt: raw.createdAt || '',
    featured: Boolean(raw.featured),
    categoryName: String(raw.category?.name || '').trim(),
  }
}

const activeCategoryName = computed(
  () => categories.value.find((item) => item.id === activeCategory.value)?.name || '',
)

/* 精选数量达标时轮播/榜单优先展示精选作品 */
const spotlightSource = computed(() =>
  featuredItems.value.length >= 3 ? featuredItems.value : spotlightItems.value,
)

const heroItems = computed(() => spotlightSource.value.slice(0, 5))
const currentHero = computed(() => {
  const rows = heroItems.value
  return rows[heroIndex.value % Math.max(1, rows.length)] || null
})
const hotItems = computed(() => {
  const pool = spotlightSource.value
  return pool.length > 5 ? pool.slice(5, 10) : pool.slice(0, 5)
})

const galleryStats = computed(() => {
  const rows = [...seenItems.value.values()]
  return {
    works: rows.length,
    creators: new Set(rows.map((item) => item.authorName)).size,
  }
})

const topCreators = computed(() => {
  const map = new Map()
  for (const item of seenItems.value.values()) {
    const entry = map.get(item.authorName) || {
      name: item.authorName,
      avatar: item.authorAvatar,
      workCount: 0,
      latestAt: '',
    }
    entry.workCount += 1
    if (!entry.avatar && item.authorAvatar) entry.avatar = item.authorAvatar
    if (String(item.createdAt) > String(entry.latestAt)) entry.latestAt = item.createdAt
    map.set(item.authorName, entry)
  }
  return [...map.values()].sort((a, b) => b.workCount - a.workCount).slice(0, 6)
})

function compactNumber(value = 0) {
  const number = Number(value || 0)
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`
  return String(number)
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function shortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function authorInitial(item) {
  return String(item?.authorName || '创')
    .slice(0, 1)
    .toUpperCase()
}

/* —— 分类与精选 —— */
async function loadCategories() {
  categories.value = await listGalleryCategories().catch(() => [])
}

async function loadFeatured() {
  try {
    const data = await listShareItems({ limit: 10, featured: true })
    const rows = (Array.isArray(data?.items) ? data.items : [])
      .map(normalizeItem)
      .filter(Boolean)
    // 不足 3 件时不启用精选轮播，沿用第一页样本
    featuredItems.value = rows.length >= 3 ? rows : []
    const seen = new Map(seenItems.value)
    rows.forEach((item) => seen.set(item.id, item))
    seenItems.value = seen
  } catch {
    featuredItems.value = []
  }
}

function selectCategory(categoryId) {
  const normalized = String(categoryId || '')
  if (activeCategory.value === normalized) return
  activeCategory.value = normalized
  page.value = 1
  hasMore.value = false
  pageCursors.value = ['']
  items.value = []
  void loadItems()
}

/* —— 列表加载 —— */
async function loadItems() {
  const requestId = ++listRequestId
  loading.value = true
  error.value = ''
  try {
    const cursor = String(pageCursors.value[page.value - 1] || '')
    const data = await listShareItems({ limit: pageSize, cursor, category: activeCategory.value })
    if (requestId !== listRequestId) return
    const rows = (Array.isArray(data?.items) ? data.items : [])
      .map(normalizeItem)
      .filter(Boolean)
    items.value = rows
    hasMore.value = Boolean(data?.nextCursor)
    const cursors = pageCursors.value.slice(0, page.value)
    cursors[page.value] = String(data?.nextCursor || '')
    pageCursors.value = cursors
    const seen = new Map(seenItems.value)
    rows.forEach((item) => seen.set(item.id, item))
    seenItems.value = seen
    if (page.value === 1 && !activeCategory.value && !spotlightItems.value.length) {
      spotlightItems.value = rows.slice(0, 10)
    }
    await nextTick()
    openRouteDetailIfReady()
  } catch (err) {
    if (requestId !== listRequestId) return
    error.value = err?.message || '画廊作品读取失败'
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

function changePage(nextPage) {
  const normalized = Math.max(1, Number(nextPage || 1))
  if (normalized === page.value || loading.value) return
  if (normalized > page.value && !hasMore.value) return
  if (normalized > 1 && !pageCursors.value[normalized - 1]) return
  page.value = normalized
  items.value = []
  // 先瞬时回到列表顶，避免等接口完成后再 smooth 滚动打架
  scrollFeedIntoView('auto')
  void loadItems()
}

function refreshFeed() {
  page.value = 1
  hasMore.value = false
  pageCursors.value = ['']
  if (!activeCategory.value) spotlightItems.value = []
  items.value = []
  void loadItems()
  void loadFeatured()
}

function goSubmit() {
  if (!authStore.isAuthenticated) {
    router.push({ name: 'auth', query: { mode: 'login', redirect: '/profile' } })
    return
  }
  router.push('/profile')
}

function goCreate() {
  router.push('/text-to-image')
}

/* —— 详情弹层 —— */
function openRouteDetailIfReady() {
  const itemId = String(route.query.item || '').trim()
  if (!itemId || detailClosing.value || detailItem.value?.id === itemId) return
  const candidates = [...spotlightItems.value, ...items.value, ...seenItems.value.values()]
  const item = candidates.find((row) => String(row?.id || '') === itemId)
  if (item) void openDetail(item)
}

async function openDetail(item) {
  if (!item?.id || detailClosing.value) return
  detailItem.value = item
  detailMediaIndex.value = 0
  detailOpen.value = true
  document.body.classList.add('share-detail-open')
  if (String(route.query.item || '') !== item.id) {
    void router.replace({ query: { ...route.query, item: item.id } })
  }
}

async function closeDetail() {
  if (!detailOpen.value || detailClosing.value) return
  detailClosing.value = true
  try {
    await playDetailLeave()
  } finally {
    detailOpen.value = false
    detailItem.value = null
    detailClosing.value = false
    document.body.classList.remove('share-detail-open')
    if (route.query.item) {
      const nextQuery = { ...route.query }
      delete nextQuery.item
      void router.replace({ query: nextQuery })
    }
  }
}

/* —— 精选轮播 —— */
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

/* —— 吸顶导航阴影 —— */
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

function handleKeydown(event) {
  if (event.key === 'Escape' && detailOpen.value) closeDetail()
}

watch(
  () => route.query.item,
  () => nextTick(() => openRouteDetailIfReady()),
)

// 轮播数据源切换（精选到位/刷新）时回到第一张，避免指示点越界
watch(spotlightSource, () => {
  heroIndex.value = 0
})

onMounted(() => {
  document.documentElement.classList.add('share-gallery-page')
  void loadItems()
  void loadFeatured()
  void loadCategories()
  startHeroTimer()
  window.addEventListener('keydown', handleKeydown)
  nextTick(() => bindCategoryStuckObserver())
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('share-gallery-page')
  window.clearInterval(heroTimer)
  window.clearTimeout(heroTransitionTimer)
  window.removeEventListener('keydown', handleKeydown)
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
              灵感在此汇聚。浏览创作者分享并通过审核的 AI 作品，也把你的创作挂上展墙。
            </p>
            <div class="community-copy__actions">
              <button type="button" class="is-primary" @click="scrollFeedIntoView('smooth')">
                进入画廊<span aria-hidden="true">→</span>
              </button>
              <button type="button" class="is-text" @click="goSubmit">我要投稿</button>
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
                <ShareProgressiveImage :src="item.cover" :alt="item.title" eager />
              </span>
            </div>
            <div class="community-stats is-comments-off" :class="{ 'is-loading': loading }">
              <div>
                <strong>{{ compactNumber(galleryStats.creators) }}+</strong>
                <span>创作者</span>
              </div>
              <div>
                <strong>{{ compactNumber(galleryStats.works) }}+</strong>
                <span>作品</span>
              </div>
              <div>
                <strong>6</strong>
                <span>创作工坊</span>
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
            :src="currentHero.cover"
            :alt="currentHero.title"
            eager
          />
          <div class="community-featured__shade"></div>
          <div class="community-featured__frame" aria-hidden="true"></div>
          <div class="community-featured__meta" :key="`meta-${currentHero.id}`">
            <span class="community-featured__index">
              Featured {{ String(heroIndex + 1).padStart(2, '0') }}
            </span>
            <span class="community-featured__tag">{{ shortDate(currentHero.createdAt) }}</span>
            <strong>{{ currentHero.title }}</strong>
            <small>{{ currentHero.authorName }}</small>
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
            <strong>近期入馆</strong>
          </div>
          <button type="button" @click="scrollFeedIntoView('smooth')">完整馆藏 →</button>
        </header>
        <ol>
          <li v-for="(item, index) in hotItems" :key="item.id" @click="openDetail(item)">
            <b>{{ String(index + 1).padStart(2, '0') }}</b>
            <ShareProgressiveImage :src="item.cover" alt="" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.authorName }}</small>
            </span>
            <em><i class="bi bi-calendar3"></i>{{ shortDate(item.createdAt) }}</em>
          </li>
        </ol>
      </aside>
    </section>

    <section id="share-feed" class="community-body">
      <div ref="categorySentinelRef" class="community-categories-sentinel" aria-hidden="true"></div>
      <nav
        class="community-categories"
        :class="{ 'is-stuck': categoryStuck }"
        aria-label="画廊导航"
      >
        <button
          type="button"
          :class="{ 'is-active': !activeCategory }"
          @click="selectCategory('')"
        >
          <i class="bi bi-grid"></i>全部
        </button>
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          :class="{ 'is-active': activeCategory === category.id }"
          @click="selectCategory(category.id)"
        >
          {{ category.name }}
        </button>
        <button type="button" :disabled="loading" @click="refreshFeed">
          <i class="bi bi-arrow-clockwise" :class="{ spin: loading }"></i>刷新馆藏
        </button>
        <span class="community-categories__split" aria-hidden="true"></span>
        <button type="button" @click="goSubmit"><i class="bi bi-plus-square"></i>我要投稿</button>
      </nav>

      <div class="community-main" data-share-motion>
        <div class="community-feed-head">
          <div>
            <strong>{{ activeCategoryName || '最新入馆' }}</strong>
            <span>已收录 {{ galleryStats.works }}{{ hasMore ? '+' : '' }} 件</span>
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
            <i class="bi bi-images"></i
            ><strong>{{ activeCategory ? '该分类暂时没有作品' : '画廊还没有作品' }}</strong
            ><span>{{
              activeCategory
                ? '切换其他分类，或成为这个分类的第一位创作者。'
                : '去工作台创作，并在个人中心把满意的一幅投稿进来。'
            }}</span
            ><button type="button" @click="goCreate">开始创作</button>
          </div>
          <div v-else class="community-grid" aria-label="社区作品" :aria-busy="loading">
            <article
              v-for="item in items"
              :key="item.id"
              class="community-card"
              @click="openDetail(item)"
            >
              <div class="community-card__media">
                <ShareProgressiveImage :src="item.cover" :alt="item.title" />
                <span v-if="item.categoryName" class="community-card__category">{{
                  item.categoryName
                }}</span>
                <div class="community-card__overlay"><span>查看</span></div>
              </div>
              <footer>
                <strong :title="item.title">{{ item.title }}</strong>
                <div class="community-card__meta">
                  <small>{{ item.authorName }}</small>
                  <div class="community-card__actions">
                    <button type="button" @click.stop="openDetail(item)">
                      <i class="bi bi-calendar3"></i>{{ shortDate(item.createdAt) }}
                    </button>
                  </div>
                </div>
              </footer>
            </article>
          </div>
        </div>

        <nav v-if="hasMore || page > 1" class="community-pagination" aria-label="作品分页">
          <button type="button" :disabled="loading || page <= 1" @click="changePage(page - 1)">
            <i class="bi bi-chevron-left"></i><span>上一页</span>
          </button>
          <div class="community-pagination__meta">
            <em>Page</em>
            <strong>{{ String(page).padStart(2, '0') }}</strong>
            <small>已收录 {{ galleryStats.works }}{{ hasMore ? '+' : '' }} 件作品</small>
          </div>
          <button type="button" :disabled="loading || !hasMore" @click="changePage(page + 1)">
            <span>下一页</span><i class="bi bi-chevron-right"></i>
          </button>
        </nav>
      </div>

      <aside class="community-sidebar">
        <section class="community-side-card community-side-card--creators">
          <header>
            <div>
              <em>Creators</em>
              <strong>活跃创作者</strong>
            </div>
          </header>
          <ul class="community-creators">
            <li v-for="creator in topCreators" :key="creator.name">
              <span class="community-creator-avatar">{{ creator.name.slice(0, 1) }}</span>
              <div>
                <strong>{{ creator.name }}</strong>
                <small
                  >{{ creator.workCount }} 件作品<template v-if="creator.latestAt">
                    · 最近 {{ shortDate(creator.latestAt) }}</template
                  ></small
                >
              </div>
              <span class="community-creator-badge">创作者</span>
            </li>
            <li v-if="!topCreators.length" class="community-creators__empty">
              <div>
                <strong>虚位以待</strong>
                <small>第一位创作者就是你</small>
              </div>
            </li>
          </ul>
        </section>
        <section class="community-side-card community-side-card--submit">
          <header>
            <div>
              <em>Submit</em>
              <strong>分享你的创作</strong>
            </div>
          </header>
          <div class="community-submit">
            <p>在任意工坊完成创作后，到「个人中心 · 我的作品」一键投稿，通过审核即挂上展墙。</p>
            <div class="community-submit__actions">
              <button type="button" class="is-primary" @click="goCreate">去创作</button>
              <button type="button" @click="goSubmit">去投稿</button>
            </div>
          </div>
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
              :key="detailItem.mediaUrls[detailMediaIndex] || detailItem.cover"
              :src="detailItem.mediaUrls[detailMediaIndex] || detailItem.cover"
              :alt="detailItem.title"
              eager
            />
            <span class="share-detail__visual-mark">Artwork</span>
            <div v-if="detailItem.mediaUrls.length > 1" class="share-detail__thumbs" @click.stop>
              <button
                v-for="(url, index) in detailItem.mediaUrls"
                :key="url"
                type="button"
                :class="{ 'is-active': index === detailMediaIndex }"
                :aria-label="`查看第 ${index + 1} 张`"
                @click="detailMediaIndex = index"
              >
                <img :src="url" alt="" loading="lazy" />
              </button>
            </div>
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
                    <strong>{{ detailItem.authorName }}</strong>
                    <small>AI 创作 · 社区投稿</small>
                  </div>
                </div>
              </header>

              <div class="share-detail__intro">
                <em>Work</em>
                <h2>{{ detailItem.title }}</h2>
                <div class="share-detail__stats">
                  <span
                    ><i class="bi bi-calendar3"></i
                    >{{ formatDate(detailItem.createdAt) || '未知日期' }} 入馆</span
                  >
                  <span
                    ><i class="bi bi-images"></i>{{ detailItem.mediaUrls.length }} 张画面</span
                  >
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style src="../features/share/styles/share-view.css"></style>
