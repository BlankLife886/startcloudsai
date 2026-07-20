<script setup>
import HistoryItemDetail from '@/components/history/HistoryItemDetail.vue'
import WallpaperPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import { useHistoryPageMotion } from '@/features/history/composables/useHistoryPageMotion'
import '@/features/history/styles/history-view.css'
import { useHistoryStore } from '@/stores/history'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const historyStore = useHistoryStore()
const runtimeConfigStore = useRuntimeConfigStore()

const pageRoot = ref(null)
const feedScrollRef = ref(null)
const pageReady = ref(false)

const searchQuery = ref('')
const sortBy = ref('date')
const sortOrder = ref('desc')
const viewMode = ref('timeline')
const filterMode = ref('all')
const previewWallpaper = ref(null)
const showPreview = ref(false)
const previewIndex = ref(-1)
const detailItem = ref(null)
const showDetail = ref(false)

const historyCount = computed(() => historyStore.historyCount)

const filteredHistory = computed(() => {
  let result = [...historyStore.history]
  const now = new Date()

  if (filterMode.value === 'today') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    result = result.filter((item) => new Date(item.viewed_at) >= today)
  } else if (filterMode.value === 'week') {
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - 6)
    weekStart.setHours(0, 0, 0, 0)
    result = result.filter((item) => new Date(item.viewed_at) >= weekStart)
  } else if (filterMode.value === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    result = result.filter((item) => new Date(item.viewed_at) >= monthStart)
  }

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter((item) => {
      const tags = Array.isArray(item.tags)
        ? item.tags.map((tag) => (typeof tag === 'string' ? tag : tag?.name || '')).join(' ')
        : ''

      return (
        item.id?.toLowerCase().includes(query) ||
        item.resolution?.toLowerCase().includes(query) ||
        item.uploader?.toLowerCase().includes(query) ||
        item.source?.toLowerCase().includes(query) ||
        item.search_query?.toLowerCase().includes(query) ||
        tags.toLowerCase().includes(query)
      )
    })
  }

  result.sort((a, b) => {
    if (sortBy.value === 'name') {
      const valueA = a.id || ''
      const valueB = b.id || ''
      return sortOrder.value === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA)
    }

    if (sortBy.value === 'count') {
      const valueA = a.view_count || 1
      const valueB = b.view_count || 1
      return sortOrder.value === 'asc' ? valueA - valueB : valueB - valueA
    }

    const dateA = new Date(a.viewed_at || 0)
    const dateB = new Date(b.viewed_at || 0)
    return sortOrder.value === 'asc' ? dateA - dateB : dateB - dateA
  })

  return result
})

const groupedHistory = computed(() => {
  const buckets = {}

  filteredHistory.value.forEach((item) => {
    const label = new Date(item.viewed_at || new Date()).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    if (!buckets[label]) buckets[label] = []
    buckets[label].push(item)
  })

  return Object.entries(buckets).map(([date, items]) => ({ date, items }))
})

const statistics = computed(() => historyStore.getStatistics())
const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})
const isPreviewEnabled = computed(
  () => searchLayout.value?.preview?.enabled !== false && previewLayout.value?.enabled !== false,
)
const previewEnabledActions = computed(() => ({
  favorite: previewLayout.value?.favorite?.enabled !== false,
  mockup: previewLayout.value?.mockup?.enabled !== false,
  rotate: previewLayout.value?.rotate?.enabled !== false,
  fit: previewLayout.value?.fit?.enabled !== false,
  info: previewLayout.value?.info?.enabled !== false,
  compare: previewLayout.value?.compare?.enabled !== false,
  crop: previewLayout.value?.crop?.enabled !== false,
  decompose: previewLayout.value?.decompose?.enabled !== false,
  filters: previewLayout.value?.filters?.enabled !== false,
  ai: previewLayout.value?.ai?.enabled !== false,
  download:
    runtimeConfigStore.canUse('download') && previewLayout.value?.download?.enabled !== false,
  fullscreen: previewLayout.value?.fullscreen?.enabled !== false,
}))
const previewInListContext = computed(
  () => previewIndex.value >= 0 && filteredHistory.value.length > 1,
)

const totalDuration = computed(() => {
  const seconds = statistics.value.totalViewDuration || 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
})

const topSources = computed(() => {
  const counter = {}
  filteredHistory.value.forEach((item) => {
    const source = item.source || '未知来源'
    counter[source] = (counter[source] || 0) + 1
  })
  return Object.entries(counter)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
})

const mostViewed = computed(() => statistics.value.mostViewed || [])

const filterKey = computed(
  () =>
    `${viewMode.value}::${filterMode.value}::${sortBy.value}::${sortOrder.value}::${searchQuery.value.trim()}::${filteredHistory.value.length}`,
)

useHistoryPageMotion({
  pageRef: pageRoot,
  feedRef: feedScrollRef,
  ready: pageReady,
  filterKey,
})

function setViewMode(mode) {
  viewMode.value = mode
}

function setFilterMode(mode) {
  filterMode.value = mode
}

function changeSorting(mode) {
  if (sortBy.value === mode) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortBy.value = mode
  sortOrder.value = 'desc'
}

function clearSearch() {
  searchQuery.value = ''
}

function loadNextHistoryPage() {
  void historyStore.loadMoreHistory()
}

function removeHistoryItem(id) {
  historyStore.removeHistory(id)
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function previewImage(item) {
  if (!isPreviewEnabled.value) return
  const index = filteredHistory.value.findIndex(
    (historyItem) => String(historyItem?.id) === String(item?.id),
  )
  previewIndex.value = index
  previewWallpaper.value = index >= 0 ? filteredHistory.value[index] : item
  showPreview.value = true
}

function closePreview() {
  showPreview.value = false
  previewIndex.value = -1
}

function setPreviewByIndex(index) {
  const list = filteredHistory.value
  if (!list.length) return
  const nextIndex = (index + list.length) % list.length
  previewIndex.value = nextIndex
  previewWallpaper.value = list[nextIndex]
}

function onPreviewNext() {
  setPreviewByIndex(previewIndex.value + 1)
}

function onPreviewPrevious() {
  setPreviewByIndex(previewIndex.value - 1)
}

function viewHistoryDetail(item) {
  detailItem.value = item
  showDetail.value = true
}

function closeDetail() {
  showDetail.value = false
}

function browseWallpapers() {
  router.push({ path: '/search' })
}

onBeforeMount(() => {
  document.documentElement.classList.add('history-gallery-page')
})

onMounted(async () => {
  historyStore.initHistory()
  historyStore.updateStatistics()
  await nextTick()
  pageReady.value = true
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('history-gallery-page')
})
</script>

<template>
  <main ref="pageRoot" class="history-page" :class="{ 'is-ready': pageReady }">
    <div class="history-atmosphere" aria-hidden="true"></div>

    <header class="history-masthead" data-history-motion>
      <div class="history-masthead__copy">
        <span class="history-masthead__eyebrow">StarCloudIsAI · History</span>
        <h1>
          <span class="history-masthead__title">浏览历史</span>
          <span class="history-masthead__seal" aria-hidden="true">史</span>
        </h1>
        <p class="history-masthead__lead">回看你翻过的壁纸足迹，随时找回心动瞬间。</p>
        <div class="history-masthead__meta" aria-label="历史统计">
          <div>
            <strong>{{ historyCount }}</strong>
            <span>记录</span>
          </div>
          <div>
            <strong>{{ filteredHistory.length }}</strong>
            <span>当前</span>
          </div>
          <div>
            <strong>{{ totalDuration }}</strong>
            <span>停留</span>
          </div>
        </div>
      </div>

      <label class="history-search">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="搜索 ID、来源、标签或分辨率"
          aria-label="搜索浏览历史"
        />
        <button
          v-if="searchQuery"
          type="button"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </label>
    </header>

    <nav class="history-controls" data-history-motion aria-label="历史筛选">
      <div class="history-controls__group" role="group" aria-label="视图">
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': viewMode === 'timeline' }"
          @click="setViewMode('timeline')"
        >
          <i class="bi bi-list-ul" aria-hidden="true"></i>
          <span>时间线</span>
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': viewMode === 'grid' }"
          @click="setViewMode('grid')"
        >
          <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
          <span>网格</span>
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': viewMode === 'stats' }"
          @click="setViewMode('stats')"
        >
          <i class="bi bi-bar-chart" aria-hidden="true"></i>
          <span>统计</span>
        </button>
      </div>

      <span class="history-controls__split" aria-hidden="true"></span>

      <div class="history-controls__group" role="group" aria-label="时间范围">
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': filterMode === 'all' }"
          @click="setFilterMode('all')"
        >
          全部
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': filterMode === 'today' }"
          @click="setFilterMode('today')"
        >
          今天
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': filterMode === 'week' }"
          @click="setFilterMode('week')"
        >
          近 7 天
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': filterMode === 'month' }"
          @click="setFilterMode('month')"
        >
          本月
        </button>
      </div>

      <span class="history-controls__split" aria-hidden="true"></span>

      <div class="history-controls__group" role="group" aria-label="排序">
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': sortBy === 'date' }"
          @click="changeSorting('date')"
        >
          <i class="bi bi-calendar2-week" aria-hidden="true"></i>
          <span>按时间</span>
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': sortBy === 'name' }"
          @click="changeSorting('name')"
        >
          <i class="bi bi-sort-alpha-down" aria-hidden="true"></i>
          <span>按 ID</span>
        </button>
        <button
          class="history-tool-btn"
          type="button"
          :class="{ 'is-active': sortBy === 'count' }"
          @click="changeSorting('count')"
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
          <span>按次数</span>
        </button>
      </div>
    </nav>

    <section class="history-body" data-history-motion>
      <div ref="feedScrollRef" class="history-feed">
        <div v-if="historyCount === 0" class="history-empty">
          <i class="bi bi-clock" aria-hidden="true"></i>
          <strong>历史记录还是空的</strong>
          <span>开始浏览壁纸后，这里会自动记录你看过的内容，方便后面回找。</span>
          <button type="button" @click="browseWallpapers">
            <i class="bi bi-search" aria-hidden="true"></i>
            <span>去浏览壁纸</span>
          </button>
        </div>

        <div v-else-if="filteredHistory.length === 0" class="history-empty">
          <i class="bi bi-search" aria-hidden="true"></i>
          <strong>没有找到匹配的记录</strong>
          <span>换一个搜索词或时间范围，应该就能找回你需要的记录。</span>
          <button class="is-ghost" type="button" @click="clearSearch">
            <i class="bi bi-x-circle" aria-hidden="true"></i>
            <span>清除搜索</span>
          </button>
        </div>

        <template v-else>
          <section v-if="viewMode === 'timeline'" class="history-timeline">
            <article
              v-for="group in groupedHistory"
              :key="group.date"
              class="history-day"
            >
              <header class="history-day__head">
                <div class="history-day__mark" aria-hidden="true"></div>
                <h2>{{ group.date }}</h2>
                <span>{{ String(group.items.length).padStart(2, '0') }} 条</span>
              </header>

              <ol class="history-timeline-list">
                <li
                  v-for="item in group.items"
                  :key="`${group.date}-${item.id}-${item.viewed_at}`"
                  class="history-timeline-item"
                >
                  <time class="history-timeline-item__time" :datetime="item.viewed_at">
                    {{ formatTime(item.viewed_at) }}
                  </time>

                  <div class="history-timeline-item__rail" aria-hidden="true">
                    <i></i>
                  </div>

                  <button
                    class="history-timeline-item__thumb"
                    type="button"
                    :title="`预览 ${item.id}`"
                    @click="previewImage(item)"
                  >
                    <img :src="item.thumbnail" :alt="item.id" loading="lazy" />
                  </button>

                  <div class="history-timeline-item__body">
                    <div class="history-timeline-item__top">
                      <button
                        class="history-timeline-item__title"
                        type="button"
                        @click="viewHistoryDetail(item)"
                      >
                        {{ item.id }}
                      </button>
                      <span class="history-timeline-item__count">
                        {{ item.view_count || 1 }} 次浏览
                      </span>
                    </div>
                    <div class="history-timeline-item__meta">
                      <span>{{ item.resolution || '未知分辨率' }}</span>
                      <span>{{ item.source || '未知来源' }}</span>
                      <span v-if="item.category">{{ item.category }}</span>
                    </div>
                  </div>

                  <div class="history-timeline-item__actions">
                    <button
                      class="history-icon-btn"
                      type="button"
                      title="详情"
                      @click="viewHistoryDetail(item)"
                    >
                      <i class="bi bi-info-circle"></i>
                    </button>
                    <button
                      class="history-icon-btn"
                      type="button"
                      title="预览"
                      @click="previewImage(item)"
                    >
                      <i class="bi bi-arrows-fullscreen"></i>
                    </button>
                    <button
                      class="history-icon-btn is-danger"
                      type="button"
                      title="移除"
                      @click="removeHistoryItem(item.id)"
                    >
                      <i class="bi bi-trash3"></i>
                    </button>
                  </div>
                </li>
              </ol>
            </article>
          </section>

          <section v-else-if="viewMode === 'grid'" class="history-grid" aria-label="历史网格">
            <button
              v-for="item in filteredHistory"
              :key="`${item.id}-${item.viewed_at}`"
              type="button"
              class="history-card"
              @click="previewImage(item)"
            >
              <div class="history-card__media">
                <img :src="item.thumbnail" :alt="item.id" />
                <div class="history-card__overlay"><span>查看</span></div>
              </div>
              <div class="history-card__meta">
                <strong>{{ item.id }}</strong>
                <small>{{ item.view_count || 1 }} 次</small>
              </div>
            </button>
          </section>

          <section v-else class="history-stats-board">
            <div class="history-stats-grid">
              <article class="history-stats-card">
                <span>总记录</span>
                <strong>{{ historyCount }}</strong>
                <p>累计保存的浏览行为数量。</p>
              </article>
              <article class="history-stats-card">
                <span>当前筛选</span>
                <strong>{{ filteredHistory.length }}</strong>
                <p>当前条件下可见的历史条目。</p>
              </article>
              <article class="history-stats-card">
                <span>总停留时长</span>
                <strong>{{ totalDuration }}</strong>
                <p>根据记录估算的壁纸浏览时长。</p>
              </article>
            </div>

            <div class="history-stats-panels">
              <article class="history-stats-panel">
                <div class="history-stats-panel__head">
                  <h2>最常浏览</h2>
                  <span>{{ mostViewed.length || 0 }} 项</span>
                </div>
                <div v-if="mostViewed.length" class="history-rank-list">
                  <button
                    v-for="item in mostViewed.slice(0, 6)"
                    :key="item.id"
                    class="history-rank-row"
                    type="button"
                    @click="previewImage(item)"
                  >
                    <div class="history-rank-thumb">
                      <img v-if="item.thumbnail" :src="item.thumbnail" :alt="item.id" />
                      <i v-else class="bi bi-image"></i>
                    </div>
                    <div class="history-rank-copy">
                      <strong>{{ item.id }}</strong>
                      <span>{{ item.resolution || '未知分辨率' }}</span>
                    </div>
                    <div class="history-rank-value">{{ item.count }}</div>
                  </button>
                </div>
                <p v-else class="history-panel-empty">暂无可展示的浏览热点。</p>
              </article>

              <article class="history-stats-panel">
                <div class="history-stats-panel__head">
                  <h2>来源分布</h2>
                  <span>{{ topSources.length }} 项</span>
                </div>
                <div v-if="topSources.length" class="history-distribution-list">
                  <div
                    v-for="source in topSources"
                    :key="source.name"
                    class="history-distribution-row"
                  >
                    <div class="history-distribution-copy">
                      <strong>{{ source.name }}</strong>
                      <span>{{ source.count }} 次浏览</span>
                    </div>
                    <div class="history-distribution-bar">
                      <div
                        class="history-distribution-fill"
                        :style="{
                          width: `${Math.max((source.count / filteredHistory.length) * 100, 8)}%`,
                        }"
                      ></div>
                    </div>
                  </div>
                </div>
                <p v-else class="history-panel-empty">暂无来源维度的统计数据。</p>
              </article>
            </div>
          </section>

          <div v-if="historyStore.historyHasMore" class="history-load-more">
            <button
              type="button"
              :disabled="historyStore.isLoadingMore"
              @click="loadNextHistoryPage"
            >
              <span
                v-if="historyStore.isLoadingMore"
                class="spinner-border spinner-border-sm"
              ></span>
              <i v-else class="bi bi-chevron-down"></i>
              <span>{{ historyStore.isLoadingMore ? '正在加载' : '加载更多历史' }}</span>
              <small>已加载 {{ historyStore.history.length }} / {{ historyCount }}</small>
            </button>
          </div>
        </template>
      </div>
    </section>

    <HistoryItemDetail
      v-if="detailItem"
      :show="showDetail"
      :history-item="detailItem"
      @close="closeDetail"
    />
    <WallpaperPreview
      v-if="isPreviewEnabled"
      :wallpaper="previewWallpaper"
      :show="showPreview"
      :enabled-actions="previewEnabledActions"
      :in-collection="previewInListContext"
      :collection-index="previewIndex >= 0 ? previewIndex : 0"
      :collection-total="filteredHistory.length"
      @close="closePreview"
      @next="onPreviewNext"
      @previous="onPreviewPrevious"
    />
  </main>
</template>
