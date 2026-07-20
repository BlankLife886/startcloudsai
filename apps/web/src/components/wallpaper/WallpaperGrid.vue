<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import VirtualGrid from '@/components/common/VirtualGrid.vue'
import WallpaperCard from './WallpaperCard.vue'
import WallpaperHoverPreview from './WallpaperHoverPreview.vue'

const VIRTUAL_IMAGE_HEIGHT = {
  2: 500,
  3: 400,
  4: 300,
  6: 180,
  8: 150,
}
const VIRTUAL_GRID_GAP = 14

// 定义props
const props = defineProps({
  wallpapers: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
  showEmptyState: {
    type: Boolean,
    default: true,
  },
  infiniteScroll: {
    type: Boolean,
    default: true,
  },
  showTags: {
    type: Boolean,
    default: true,
  },
  showUploader: {
    type: Boolean,
    default: true,
  },
  gridColumns: {
    type: Number,
    default: 4,
  },
  waterfallLayout: {
    type: Boolean,
    default: false,
  },
  waterfallQuality: {
    type: String,
    default: 'tiny',
  },
  waterfallInitialRenderCount: {
    type: Number,
    default: 18,
  },
  waterfallPreloadPx: {
    type: Number,
    default: 900,
  },
  /** 普通网格/瀑布流卡片图片画质：tiny | medium | high | original。空字符串时从 settings 读取 */
  imageQuality: {
    type: String,
    default: '',
  },
  ratioMode: {
    type: String,
    default: 'square',
  },
  selectionMode: {
    type: Boolean,
    default: false,
  },
  /** 与 Pinia 中 selectedIds 一致，使用字符串 id */
  selectedIds: {
    type: Array,
    default: () => [],
  },
  cardActions: {
    type: Object,
    default: () => ({}),
  },
  /** 是否还有下一页；为 false 时不触发 load-more，避免父级早退导致 isLoadingMore 卡死 */
  hasMore: {
    type: Boolean,
    default: true,
  },
  /** 嵌套滚动容器（如收藏页 .favorites-content）；不传则自动就近探测 */
  scrollRoot: {
    type: Object,
    default: null,
  },
  /** 标准网格也按视口渐进挂载卡片，降低大列表首屏压力 */
  progressiveMount: {
    type: Boolean,
    default: false,
  },
  /** 标准网格窗口化虚拟列表（瀑布流不适用） */
  virtualize: {
    type: Boolean,
    default: false,
  },
  /** 覆盖卡片揭幕形式 */
  revealStyle: {
    type: String,
    default: '',
  },
  /** 覆盖卡片揭幕强度 */
  revealStrength: {
    type: String,
    default: '',
  },
})

// 定义事件
const emit = defineEmits([
  'load-more',
  'preview',
  'toggle-select',
  'hide',
  'find-similar',
  'filter-color',
  'context-menu',
])

// 悬停预览引用
const hoverPreviewRef = ref(null)
const gridRootRef = ref(null)

// 本地状态
const observer = ref(null)
const loadingMoreRef = ref(null)
const masonryRenderObserver = ref(null)
const masonryRenderedMap = ref({})
const masonryItemEls = new Map()
const gridRenderedMap = ref({})
const gridItemEls = new Map()
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
/** 已 emit load-more、父级尚未把 loading 置 true 的短窗口内防重复触发 */
const isLoadingMore = ref(false)
/** emit 后父级若同步拒绝（未进入 loading），双 rAF 检测；需能取消内外两层 */
let loadMoreAckRafOuter = null
let loadMoreAckRafInner = null
let resolvedScrollRoot = null

function findScrollParent(el) {
  let node = el?.parentElement || null
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node)
    const overflowY = style.overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

function getObserverRoot() {
  if (props.scrollRoot && props.scrollRoot.nodeType === 1) return props.scrollRoot
  if (resolvedScrollRoot?.isConnected) return resolvedScrollRoot
  resolvedScrollRoot = findScrollParent(gridRootRef.value)
  return resolvedScrollRoot
}

// 获取列类名
function getColumnClass() {
  switch (props.gridColumns) {
    case 2:
      return 'col-6 col-sm-6 col-md-6 col-lg-6 col-xl-6'
    case 3:
      return 'col-6 col-sm-6 col-md-4 col-lg-4 col-xl-4'
    case 6:
      return 'col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2'
    case 8:
      return 'col-6 col-sm-4 col-md-3 col-lg-2 col-xl-1-5' // 8列布局
    case 4:
    default:
      return 'col-6 col-sm-4 col-md-3 col-lg-3 col-xl-3'
  }
}

function getWallpaperAspectRatio(wallpaper) {
  const resolution = String(wallpaper?.resolution || '')
  const match = resolution.match(/(\d+)\s*[xX]\s*(\d+)/)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > 0 && h > 0) return w / h
  }
  const w = Number(wallpaper?.width || 0)
  const h = Number(wallpaper?.height || 0)
  if (w > 0 && h > 0) return w / h
  return 16 / 9
}

function getResponsiveMasonryColumnCount() {
  const n = [2, 3, 4, 6, 8].includes(Number(props.gridColumns)) ? Number(props.gridColumns) : 4
  const w = viewportWidth.value
  if (w <= 480) return 1
  if (w <= 767) return [8, 6, 4, 3].includes(n) ? 2 : n
  if (w <= 991) return [8, 6, 4].includes(n) ? 3 : n
  if (w <= 1199) return [8, 6].includes(n) ? 4 : n
  return n
}

/** 与 Bootstrap getColumnClass 断点对齐，供虚拟网格锁定列数 */
function getResponsiveGridColumnCount() {
  const n = [2, 3, 4, 6, 8].includes(Number(props.gridColumns)) ? Number(props.gridColumns) : 4
  const w = viewportWidth.value
  if (n === 2) return 2
  if (w < 576) return 2
  if (w < 768) return n === 3 ? 2 : 3
  if (w < 992) {
    if (n === 3) return 3
    if (n === 4) return 4
    return 4
  }
  if (w < 1200) return n <= 4 ? n : 6
  return n
}

const virtualColumnCount = computed(() => getResponsiveGridColumnCount())

const virtualItemHeight = computed(() => {
  const cols = [2, 3, 4, 6, 8].includes(Number(props.gridColumns)) ? Number(props.gridColumns) : 4
  return VIRTUAL_IMAGE_HEIGHT[cols] || VIRTUAL_IMAGE_HEIGHT[4]
})

const useVirtualGrid = computed(() => {
  if (!props.virtualize || props.waterfallLayout) return false
  const count = props.wallpapers.length
  if (count <= 36) return false
  const cols = Math.max(1, virtualColumnCount.value)
  const rows = Math.ceil(count / cols)
  const estimated = rows * (virtualItemHeight.value + VIRTUAL_GRID_GAP)
  const vh = typeof window !== 'undefined' ? window.innerHeight || 900 : 900
  // 内容高度不足约两屏时全量渲染，避免首屏大片空白要靠滚动才“长出来”
  return estimated > vh * 1.75
})

const masonryColumns = computed(() => {
  if (!props.waterfallLayout) return []
  const count = Math.max(1, getResponsiveMasonryColumnCount())
  const columns = Array.from({ length: count }, () => [])
  const heights = Array.from({ length: count }, () => 0)

  props.wallpapers.forEach((wallpaper, index) => {
    let target = 0
    for (let i = 1; i < heights.length; i += 1) {
      if (heights[i] < heights[target]) target = i
    }
    columns[target].push({ wallpaper, index })
    const ratio = getWallpaperAspectRatio(wallpaper)
    heights[target] += 1 / Math.max(0.3, Math.min(ratio, 3.5))
  })

  return columns
})

const normalizedInitialRenderCount = computed(() => {
  const base = Math.min(120, Math.max(6, Number(props.waterfallInitialRenderCount) || 18))
  const cols = Number(props.gridColumns) || 4
  // 小图标/超小图标一屏卡片更多，首批多挂载一些，减少半屏骨架
  if (cols >= 8) return Math.min(120, Math.max(base, 56))
  if (cols >= 6) return Math.min(120, Math.max(base, 40))
  return base
})
const normalizedWaterfallPreloadPx = computed(() =>
  Math.min(3000, Math.max(200, Number(props.waterfallPreloadPx) || 900)),
)

const virtualOverscanRows = computed(() => {
  const preload = normalizedWaterfallPreloadPx.value
  const row = Math.max(100, virtualItemHeight.value + VIRTUAL_GRID_GAP)
  // 小图标/超小图标行高低，需要更多 overscan 才能铺满首屏
  const denser = Number(props.gridColumns) >= 6
  const base = Math.ceil(preload / row)
  return Math.min(14, Math.max(denser ? 6 : 3, base))
})

function disconnectObserver() {
  if (observer.value) {
    observer.value.disconnect()
    observer.value = null
  }
}

function disconnectMasonryRenderObserver() {
  if (masonryRenderObserver.value) {
    masonryRenderObserver.value.disconnect()
    masonryRenderObserver.value = null
  }
}

function markMasonryRendered(id) {
  const sid = String(id)
  if (masonryRenderedMap.value[sid]) return
  masonryRenderedMap.value = {
    ...masonryRenderedMap.value,
    [sid]: true,
  }
}

function markGridRendered(id) {
  const sid = String(id)
  if (gridRenderedMap.value[sid]) return
  gridRenderedMap.value = {
    ...gridRenderedMap.value,
    [sid]: true,
  }
}

function shouldRenderMasonryCard(id, index) {
  const sid = String(id)
  if (masonryRenderedMap.value[sid]) return true
  // 首屏优先渲染一批，减少骨架闪烁
  return index < normalizedInitialRenderCount.value
}

function shouldRenderGridCard(id, index) {
  if (!props.progressiveMount) return true
  const sid = String(id)
  if (gridRenderedMap.value[sid]) return true
  return index < normalizedInitialRenderCount.value
}

function setMasonryItemRef(el, id, index) {
  const sid = String(id)
  if (el) {
    masonryItemEls.set(sid, el)
    if (shouldRenderMasonryCard(sid, index)) {
      markMasonryRendered(sid)
    }
    if (masonryRenderObserver.value && !masonryRenderedMap.value[sid]) {
      masonryRenderObserver.value.observe(el)
    }
  } else {
    masonryItemEls.delete(sid)
  }
}

function setGridItemRef(el, id, index) {
  if (!props.progressiveMount) return
  const sid = String(id)
  if (el) {
    gridItemEls.set(sid, el)
    if (shouldRenderGridCard(sid, index)) {
      markGridRendered(sid)
    }
    if (masonryRenderObserver.value && !gridRenderedMap.value[sid]) {
      masonryRenderObserver.value.observe(el)
    }
  } else {
    gridItemEls.delete(sid)
  }
}

function connectMasonryRenderObserver() {
  disconnectMasonryRenderObserver()
  if (useVirtualGrid.value) return
  if (!props.waterfallLayout && !props.progressiveMount) return

  masonryRenderObserver.value = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const sid = entry.target?.getAttribute?.('data-wallpaper-id')
        if (!sid) continue
        if (props.waterfallLayout) markMasonryRendered(sid)
        else markGridRendered(sid)
        masonryRenderObserver.value?.unobserve(entry.target)
      }
    },
    {
      root: getObserverRoot(),
      rootMargin: `${normalizedWaterfallPreloadPx.value}px 0px ${Math.round(normalizedWaterfallPreloadPx.value * 1.4)}px 0px`,
      threshold: 0.01,
    },
  )

  const els = props.waterfallLayout ? masonryItemEls : gridItemEls
  const rendered = props.waterfallLayout ? masonryRenderedMap.value : gridRenderedMap.value
  els.forEach((el, sid) => {
    if (!rendered[sid]) {
      masonryRenderObserver.value.observe(el)
    }
  })
}

function cancelLoadMoreAckReset() {
  if (loadMoreAckRafOuter != null) {
    cancelAnimationFrame(loadMoreAckRafOuter)
    loadMoreAckRafOuter = null
  }
  if (loadMoreAckRafInner != null) {
    cancelAnimationFrame(loadMoreAckRafInner)
    loadMoreAckRafInner = null
  }
}

/**
 * 父级 load-more 正常会立刻把 loading 置 true；若因 in-flight / 仍加载中等同步 return，
 * loading 不会变，isLoadingMore 会永远 true（用户静置后懒加载触发 IO 时尤其常见）。
 * 双 rAF：排到微任务与首帧布局之后，再判断是否被承接。
 */
function scheduleLoadMoreAckReset() {
  cancelLoadMoreAckReset()
  loadMoreAckRafOuter = requestAnimationFrame(() => {
    loadMoreAckRafOuter = null
    loadMoreAckRafInner = requestAnimationFrame(() => {
      loadMoreAckRafInner = null
      if (!isLoadingMore.value) return
      if (props.loading) return
      isLoadingMore.value = false
    })
  })
}

/** 底部预触发距离（px），略大可减少「滑到底却不加载」 */
const ROOT_MARGIN = '0px 0px 900px 0px'

function connectObserver() {
  disconnectObserver()
  if (!props.infiniteScroll || !loadingMoreRef.value) return

  observer.value = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      if (!props.hasMore || props.loading || isLoadingMore.value) return
      triggerLoadMore()
    },
    {
      root: getObserverRoot(),
      rootMargin: ROOT_MARGIN,
      threshold: 0,
    },
  )

  observer.value.observe(loadingMoreRef.value)
}

/** 父级请求结束后：若哨兵仍在视口附近，补一次检测（解决 IO 不重复触发） */
function scanSentinel() {
  if (!props.infiniteScroll || !loadingMoreRef.value) return
  if (!props.hasMore || props.loading || isLoadingMore.value) return
  const el = loadingMoreRef.value
  const rect = el.getBoundingClientRect()
  const extend = 720
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  if (!vh) return
  const nearViewport = rect.top < vh + extend && rect.bottom > -extend
  if (nearViewport) triggerLoadMore()
}

/** 内容高度不足以铺满视口时主动翻页，避免半屏空白只能靠用户滚动触发 */
function maybeFillViewport() {
  if (!props.infiniteScroll || !props.hasMore) return
  if (props.loading || isLoadingMore.value) return
  const grid = gridRootRef.value
  if (!grid) return
  const vh = typeof window !== 'undefined' ? window.innerHeight || 0 : 0
  if (!vh) return
  const rect = grid.getBoundingClientRect()
  // 网格底部仍落在视口内（含底栏余量）→ 继续加载
  if (rect.bottom < vh - 48) {
    triggerLoadMore()
  }
}

function scheduleViewportFillCheck() {
  nextTick(() => {
    requestAnimationFrame(() => {
      connectObserver()
      connectMasonryRenderObserver()
      scanSentinel()
      maybeFillViewport()
    })
  })
}

function triggerLoadMore() {
  if (!props.hasMore) {
    cancelLoadMoreAckReset()
    isLoadingMore.value = false
    return
  }
  if (props.loading || isLoadingMore.value) return
  if (!props.infiniteScroll) return
  // 允许「本页全部被隐藏」等 wallpapers 为空但仍可翻页的情况
  isLoadingMore.value = true
  emit('load-more')
  scheduleLoadMoreAckReset()
}

/** 滚动时补检：IO 在布局突变后有时不回调 */
let scrollRaf = null
let gridAlive = false
function onWindowScroll() {
  if (!gridAlive || !props.infiniteScroll || !props.hasMore) return
  if (scrollRaf != null) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null
    if (!gridAlive || props.loading) return
    scanSentinel()
  })
}

function onWindowResize() {
  viewportWidth.value = window.innerWidth
}

watch(
  () => props.hasMore,
  (ok) => {
    if (!ok) {
      cancelLoadMoreAckReset()
      isLoadingMore.value = false
    }
  },
)

watch(
  () => props.loading,
  (loading) => {
    // 父级一旦进入 loading，可视为已承接本次 load-more，解除本地互斥，避免卡在 true
    if (loading) {
      cancelLoadMoreAckReset()
      isLoadingMore.value = false
      return
    }
    isLoadingMore.value = false
    scheduleViewportFillCheck()
  },
)

watch(
  () => [
    props.infiniteScroll,
    props.hasMore,
    props.wallpapers.length,
    props.gridColumns,
    useVirtualGrid.value,
  ],
  () => {
    scheduleViewportFillCheck()
  },
)

watch(
  () => [props.wallpapers, props.waterfallLayout, props.progressiveMount],
  () => {
    const nextMasonry = {}
    const nextGrid = {}
    props.wallpapers.forEach((wallpaper, index) => {
      const sid = String(wallpaper.id)
      const prefer = index < normalizedInitialRenderCount.value
      if (masonryRenderedMap.value[sid] || prefer) nextMasonry[sid] = true
      if (gridRenderedMap.value[sid] || prefer) nextGrid[sid] = true
    })
    masonryRenderedMap.value = nextMasonry
    gridRenderedMap.value = nextGrid
    nextTick(() => {
      resolvedScrollRoot = findScrollParent(gridRootRef.value)
      requestAnimationFrame(() => connectMasonryRenderObserver())
    })
  },
  { deep: true },
)

watch(
  () => props.waterfallLayout,
  (enabled) => {
    if (enabled) {
      hoverPreviewRef.value?.hidePreview()
    }
  },
)

watch(
  () => props.scrollRoot,
  () => {
    resolvedScrollRoot = null
    nextTick(() => {
      requestAnimationFrame(() => {
        connectObserver()
        connectMasonryRenderObserver()
      })
    })
  },
)

// 组件挂载时设置无限滚动
onMounted(() => {
  gridAlive = true
  nextTick(() => {
    resolvedScrollRoot = findScrollParent(gridRootRef.value)
    scheduleViewportFillCheck()
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    window.addEventListener('resize', onWindowResize, { passive: true })
  }
})

// 组件卸载时清理观察器
onUnmounted(() => {
  gridAlive = false
  disconnectObserver()
  disconnectMasonryRenderObserver()
  cancelLoadMoreAckReset()
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', onWindowScroll)
    window.removeEventListener('resize', onWindowResize)
  }
  if (scrollRaf != null) {
    cancelAnimationFrame(scrollRaf)
    scrollRaf = null
  }
})

// 处理壁纸预览
function handlePreview(wallpaper) {
  emit('preview', wallpaper)
}

function handleToggleSelect(id) {
  emit('toggle-select', id)
}

function handleHide(wallpaper) {
  emit('hide', wallpaper)
  hoverPreviewRef.value?.hidePreview()
}

function handleFindSimilar(wallpaper) {
  emit('find-similar', wallpaper)
}

function handleFilterColor(hex) {
  emit('filter-color', hex)
}

function handleContextMenu(payload) {
  emit('context-menu', payload)
}

// 处理悬停预览
function handleHoverPreview(data) {
  if (hoverPreviewRef.value) {
    hoverPreviewRef.value.showPreview(data.wallpaper, data.event)
  }
}

// 处理悬停预览结束
function handleHoverPreviewEnd() {
  if (hoverPreviewRef.value) {
    hoverPreviewRef.value.hidePreview()
  }
}

// 处理悬停预览移动
function handleHoverPreviewMove(event) {
  if (hoverPreviewRef.value) {
    hoverPreviewRef.value.updatePosition(event)
  }
}

function isWallpaperSelected(id) {
  const sid = String(id)
  return props.selectedIds.some((x) => String(x) === sid)
}
</script>

<template>
  <div ref="gridRootRef" class="wallpaper-grid-container">
    <!-- 错误提示 -->
    <div class="alert alert-danger" v-if="error">
      {{ error }}
    </div>

    <!-- 虚拟网格：仅渲染可视行，无限滚动长列表时降低 DOM 压力 -->
    <VirtualGrid
      v-if="useVirtualGrid"
      class="wallpaper-virtual-grid"
      :class="[`grid-density-${gridColumns}`]"
      :items="wallpapers"
      item-key="id"
      :columns="virtualColumnCount"
      :item-height="virtualItemHeight"
      :gap="14"
      :overscan-rows="virtualOverscanRows"
      :scroll-root="scrollRoot"
      aria-label="壁纸结果"
    >
      <template #default="{ item: wallpaper, index }">
        <div
          class="wallpaper-virtual-cell"
          :class="{ 'is-priority': index < normalizedInitialRenderCount }"
          :data-wallpaper-id="String(wallpaper.id)"
        >
          <WallpaperCard
            :wallpaper="wallpaper"
            :showTags="showTags"
            :showUploader="showUploader"
            :ratioMode="ratioMode"
            :waterfallMode="false"
            :waterfallQuality="waterfallQuality"
            :gridColumns="gridColumns"
            :priority="true"
            :selectionMode="selectionMode"
            :isSelected="isWallpaperSelected(wallpaper.id)"
            :imageQuality="imageQuality"
            :cardActions="cardActions"
            :revealStyle="revealStyle"
            :revealStrength="revealStrength"
            @preview="handlePreview"
            @hover-preview="handleHoverPreview"
            @hover-preview-end="handleHoverPreviewEnd"
            @hover-preview-move="handleHoverPreviewMove"
            @toggle-select="handleToggleSelect"
            @hide="handleHide"
            @find-similar="handleFindSimilar"
            @filter-color="handleFilterColor"
            @context-menu="handleContextMenu"
          />
        </div>
      </template>
    </VirtualGrid>

    <!-- 标准网格 -->
    <div
      v-else-if="!waterfallLayout"
      class="row wallpaper-grid"
      :class="{
        'ratio-original': ratioMode === 'original',
        'is-progressive': progressiveMount,
        [`grid-density-${gridColumns}`]: true,
      }"
    >
      <div
        v-for="(wallpaper, index) in wallpapers"
        :key="wallpaper.id"
        :class="[getColumnClass(), { 'is-priority': index < normalizedInitialRenderCount }]"
        :data-wallpaper-id="String(wallpaper.id)"
        :ref="(el) => setGridItemRef(el, wallpaper.id, index)"
      >
        <WallpaperCard
          v-if="shouldRenderGridCard(wallpaper.id, index)"
          :wallpaper="wallpaper"
          :showTags="showTags"
          :showUploader="showUploader"
          :ratioMode="ratioMode"
          :waterfallMode="false"
          :waterfallQuality="waterfallQuality"
          :gridColumns="gridColumns"
          :priority="index < normalizedInitialRenderCount"
          :selectionMode="selectionMode"
          :isSelected="isWallpaperSelected(wallpaper.id)"
          :imageQuality="imageQuality"
          :cardActions="cardActions"
          :revealStyle="revealStyle"
          :revealStrength="revealStrength"
          @preview="handlePreview"
          @hover-preview="handleHoverPreview"
          @hover-preview-end="handleHoverPreviewEnd"
          @hover-preview-move="handleHoverPreviewMove"
          @toggle-select="handleToggleSelect"
          @hide="handleHide"
          @find-similar="handleFindSimilar"
          @filter-color="handleFilterColor"
          @context-menu="handleContextMenu"
        />
        <div v-else class="wallpaper-grid-placeholder" aria-hidden="true"></div>
      </div>
    </div>

    <!-- 瀑布流：按图片自身比例错位排列，减少空白 -->
    <div v-else class="wallpaper-masonry">
      <div
        v-for="(column, columnIdx) in masonryColumns"
        :key="`masonry-col-${columnIdx}`"
        class="wallpaper-masonry-col"
      >
        <div
          v-for="item in column"
          :key="item.wallpaper.id"
          class="wallpaper-masonry-item"
          :class="{ 'is-priority': item.index < normalizedInitialRenderCount }"
          :data-wallpaper-id="String(item.wallpaper.id)"
          :ref="(el) => setMasonryItemRef(el, item.wallpaper.id, item.index)"
        >
          <WallpaperCard
            v-if="shouldRenderMasonryCard(item.wallpaper.id, item.index)"
            :wallpaper="item.wallpaper"
            :showTags="showTags"
            :showUploader="showUploader"
            ratioMode="original"
            :waterfallMode="true"
            :waterfallQuality="waterfallQuality"
            :gridColumns="gridColumns"
            :priority="item.index < normalizedInitialRenderCount"
            :selectionMode="selectionMode"
            :isSelected="isWallpaperSelected(item.wallpaper.id)"
            :imageQuality="imageQuality"
            :cardActions="cardActions"
            :revealStyle="revealStyle"
            :revealStrength="revealStrength"
            @preview="handlePreview"
            @hover-preview="handleHoverPreview"
            @hover-preview-end="handleHoverPreviewEnd"
            @hover-preview-move="handleHoverPreviewMove"
            @toggle-select="handleToggleSelect"
            @hide="handleHide"
            @find-similar="handleFindSimilar"
            @filter-color="handleFilterColor"
            @context-menu="handleContextMenu"
          />
          <div v-else class="wallpaper-masonry-placeholder" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <!-- 加载中提示 -->
    <div class="text-center my-4" v-if="loading">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">加载中...</span>
      </div>
      <p class="mt-2">加载中...</p>
    </div>

    <!-- 无限滚动哨兵：有下一页时保留（含列表被筛成 0 条但仍可加载更多），避免 IO 目标被 v-if 卸掉 -->
    <div
      ref="loadingMoreRef"
      class="loading-more"
      v-if="infiniteScroll && hasMore && (!loading || wallpapers.length > 0)"
      aria-hidden="true"
    />

    <!-- 无壁纸提示 -->
    <div
      class="no-wallpapers text-center my-5"
      v-if="showEmptyState && !loading && wallpapers.length === 0 && !error"
    >
      <i class="bi bi-image text-muted display-1"></i>
      <p class="mt-3 text-muted">没有找到壁纸</p>
    </div>

    <!-- 悬停预览组件 -->
    <WallpaperHoverPreview v-if="!waterfallLayout" ref="hoverPreviewRef" />
  </div>
</template>

<style scoped src="./WallpaperGrid.css"></style>
