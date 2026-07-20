<script setup>
import WallpaperCollectionSelector from '@/components/wallpaper/WallpaperCollectionSelector.vue'
import { promoteLoadedImageToPreviewBlobCache } from '@/components/wallpaper/fullscreen-preview/features/loader/previewBlobCache'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import notificationService from '@/services/notification'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useMosaicReveal } from '@/composables/useMosaicReveal'
import { useSettingsStore } from '@/stores/settings'
import { getImageCrossorigin, hasLoadedImageUrl, markLoadedImageUrl } from '@/utils/imageRequest'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

// 定义props
const props = defineProps({
  wallpaper: {
    type: Object,
    required: true,
  },
  showTags: {
    type: Boolean,
    default: true,
  },
  showUploader: {
    type: Boolean,
    default: true,
  },
  ratioMode: {
    type: String,
    default: 'square',
  },
  waterfallMode: {
    type: Boolean,
    default: false,
  },
  waterfallQuality: {
    type: String,
    default: 'tiny',
  },
  gridColumns: {
    type: Number,
    default: 4,
  },
  /** 覆盖全局卡片画质设置：tiny | medium | high | original。空字符串时从 settings 读取 */
  imageQuality: {
    type: String,
    default: '',
  },
  priority: {
    type: Boolean,
    default: false,
  },
  /** 搜索页多选：开启后点击卡片切换选中，不再打开预览 */
  selectionMode: {
    type: Boolean,
    default: false,
  },
  isSelected: {
    type: Boolean,
    default: false,
  },
  cardActions: {
    type: Object,
    default: () => ({}),
  },
})

// 定义emit
const emit = defineEmits([
  'preview',
  'hover-preview',
  'hover-preview-end',
  'hover-preview-move',
  'toggle-select',
  'hide',
  'find-similar',
  'filter-color',
  /** 右键菜单：{ wallpaper, clientX, clientY } */
  'context-menu',
])

// 获取router和stores
const router = useRouter()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const settingsStore = useSettingsStore()

// 首屏卡片优先加载，避免刷新后图片一个个延迟冒出来
const imageLoadingMode = computed(() =>
  props.priority || !settingsStore.getSetting('enable_lazy_loading', true) ? 'eager' : 'lazy',
)
const imageFetchPriority = computed(() => (props.priority ? 'high' : 'auto'))
const lowDataMode = computed(() => settingsStore.getSetting('performance_low_data_mode', false))
const showHoverPreview = computed(
  () =>
    !props.waterfallMode &&
    !lowDataMode.value &&
    settingsStore.getSetting('show_hover_preview', true),
)
const showActionToolbar = computed(() => settingsStore.getSetting('show_card_action_toolbar', true))
const showHideButton = computed(() => settingsStore.getSetting('show_card_hide_button', true))
function isCardActionEnabled(key) {
  const config = props.cardActions || {}
  if (config.enabled === false) return false
  return config[key]?.enabled !== false
}
const showCardActionToolbar = computed(() => showActionToolbar.value && isCardActionEnabled('toolbar'))
const showCardHideButton = computed(() => showHideButton.value && isCardActionEnabled('hide'))
const cardRevealStyle = computed(() => {
  if (revealStrength.value === 'off') return 'off'
  return revealStyle.value
})

/** 最终使用的卡片画质：优先使用 props.imageQuality，否则回退到全局设置 */
const previewQuality = computed(() => {
  if (props.imageQuality && ['tiny', 'medium', 'high', 'original'].includes(props.imageQuality)) {
    return props.imageQuality
  }
  const raw = settingsStore.getSetting('preview_image_quality', 'high')
  return ['tiny', 'medium', 'high', 'original'].includes(raw) ? raw : 'high'
})

const QUALITY_ORDER = ['tiny', 'medium', 'high', 'original']

function clampPreviewQuality(quality) {
  const normalized = QUALITY_ORDER.includes(quality) ? quality : 'high'
  const cap = lowDataMode.value
    ? 'medium'
    : settingsStore.getSetting('performance_preview_quality_cap', 'high')
  const normalizedCap = QUALITY_ORDER.includes(cap) ? cap : 'high'
  const targetIndex = QUALITY_ORDER.indexOf(normalized)
  const capIndex = QUALITY_ORDER.indexOf(normalizedCap)
  return QUALITY_ORDER[Math.min(targetIndex, capIndex)]
}

/** 是否像可直接给 <img> 用的 Wallhaven 图片地址（排除详情页 /w/ 等 HTML） */
function isLikelyBinaryWallhavenImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim().toLowerCase()
  if (/\/w\/[a-z0-9]+/i.test(u) && u.includes('wallhaven.cc')) return false
  if (u.includes('th.wallhaven.cc')) return true
  if (u.includes('w.wallhaven.cc')) return true
  if (u.includes('/full/')) return true
  return /\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(u)
}

// 本地状态
const isHovered = ref(false)
const isLoading = ref(false)
const imageError = ref(false)
const showCollectionSelector = ref(false) // 收藏夹选择器显示状态
const thumbnailFallbackIndex = ref(0)
const currentThumbnailUrl = ref('/placeholder.svg')
const pendingUpgradeUrl = ref('')
const cardImageElement = ref(null)
const resolvedOriginalUrl = ref('')
const isResolvingOriginal = ref(false)
const originalResolveAttempted = ref(false)
const imageRetryCount = ref(0)
const imageRetryTimer = ref(0)

const {
  strength: revealStrength,
  revealStyle,
  mosaicCount,
  mosaicCols,
  tileDelayMs,
  tileClass,
  revealDurationMs,
  revealScaleFrom,
  revealBlurPx,
  showMosaic,
  showSweep,
  imageReady,
  onImageLoad,
  resetReveal,
} = useMosaicReveal()

const lqipBackground = computed(() => {
  const colors = props.wallpaper.colors
  if (!Array.isArray(colors) || !colors.length) return ''
  const c = colors[0]
  if (typeof c !== 'string') return ''
  return c.startsWith('#') ? c : `#${c}`
})

function handleThumbLoad() {
  markLoadedImageUrl(currentThumbnailUrl.value)
  imageRetryCount.value = 0
  if (imageRetryTimer.value) {
    window.clearTimeout(imageRetryTimer.value)
    imageRetryTimer.value = 0
  }

  const upgradeTarget = pendingUpgradeUrl.value
  if (upgradeTarget && upgradeTarget !== currentThumbnailUrl.value) {
    onImageLoad()
    startProgressiveUpgrade(upgradeTarget)
    return
  }

  const tiers = previewTierUrls.value
  const shouldResolveOriginal =
    !props.waterfallMode &&
    previewQuality.value === 'original' &&
    !originalResolveAttempted.value &&
    !isResolvingOriginal.value &&
    (!isLikelyBinaryWallhavenImageUrl(tiers.original) || tiers.original === tiers.high)

  if (shouldResolveOriginal) {
    // 先显示已有缩略图，再后台补原图地址；不要让用户等到原图解析完成才看到图片。
    onImageLoad()
    void resolveOriginalPreviewUrl()
    return
  }
  onImageLoad()
}

// 创建本地副本来存储API获取的额外数据
const wallpaperDetails = ref({
  tags: Array.isArray(props.wallpaper.tags) ? props.wallpaper.tags : [],
  uploader: props.wallpaper.uploader || '',
  resolution: props.wallpaper.resolution || '',
  path: props.wallpaper.path || '',
  url: props.wallpaper.url || '',
  thumbnail: props.wallpaper.thumbnail || '',
  thumbs: props.wallpaper.thumbs || {},
  file_size: props.wallpaper.file_size || '',
  category: props.wallpaper.category || '',
  colors: Array.isArray(props.wallpaper.colors) ? props.wallpaper.colors : [],
})

// 计算属性
const isFavorited = computed(() => favoritesStore.isFavorited(props.wallpaper.id))
const resolvedAspectRatio = computed(() => {
  const resolution = wallpaperDetails.value.resolution || props.wallpaper.resolution || ''
  if (typeof resolution === 'string') {
    const match = resolution.match(/(\d+)\s*[xX]\s*(\d+)/)
    if (match) {
      const width = Number(match[1])
      const height = Number(match[2])
      if (width > 0 && height > 0) return `${width} / ${height}`
    }
  }
  const width = Number(props.wallpaper.width)
  const height = Number(props.wallpaper.height)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return ''
})
const waterfallImageStyle = computed(() => {
  if (!props.waterfallMode || !resolvedAspectRatio.value) return undefined
  return { aspectRatio: resolvedAspectRatio.value }
})

function normalizePreviewUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (url.startsWith('http') || url.includes('wallhaven.cc')) return proxyWallhavenImageUrl(url)
  return url
}

function inferThumbExt() {
  const thumb = props.wallpaper.thumbnail || wallpaperDetails.value.thumbnail || ''
  if (typeof thumb === 'string' && thumb.toLowerCase().endsWith('.png')) return 'png'
  return 'jpg'
}

function buildTierUrl(tier) {
  const id = props.wallpaper.id
  if (!id) return ''
  const prefix = id.substring(0, 2)
  const ext = inferThumbExt()
  const bucket = tier === 'small' ? 'small' : 'large'
  return normalizePreviewUrl(`https://th.wallhaven.cc/${bucket}/${prefix}/wallhaven-${id}.${ext}`)
}

const previewTierUrls = computed(() => {
  const thumbs = props.wallpaper.thumbs || wallpaperDetails.value.thumbs || {}
  const tiny = normalizePreviewUrl(thumbs.small) || buildTierUrl('small')
  const medium = normalizePreviewUrl(thumbs.large) || buildTierUrl('large') || tiny
  const high =
    normalizePreviewUrl(thumbs.original) ||
    normalizePreviewUrl(props.wallpaper.thumbnail) ||
    normalizePreviewUrl(wallpaperDetails.value.thumbnail) ||
    medium
  const original =
    resolvedOriginalUrl.value ||
    normalizePreviewUrl(props.wallpaper.path) ||
    normalizePreviewUrl(props.wallpaper.url) ||
    normalizePreviewUrl(wallpaperDetails.value.path) ||
    normalizePreviewUrl(wallpaperDetails.value.url) ||
    high

  return { tiny, medium, high, original }
})

const selectedPreviewUrl = computed(() => {
  if (props.waterfallMode) {
    const quality = ['tiny', 'medium', 'high', 'original'].includes(props.waterfallQuality)
      ? props.waterfallQuality
      : previewQuality.value
    const cappedQuality = clampPreviewQuality(quality)
    return previewTierUrls.value[cappedQuality] || previewTierUrls.value.high || '/placeholder.svg'
  }
  const quality = clampPreviewQuality(previewQuality.value)
  return previewTierUrls.value[quality] || '/placeholder.svg'
})

const currentImageCrossorigin = computed(() => getImageCrossorigin(currentThumbnailUrl.value))

function clearImageRetryTimer() {
  if (!imageRetryTimer.value) return
  window.clearTimeout(imageRetryTimer.value)
  imageRetryTimer.value = 0
}

function startProgressiveUpgrade(targetUrl) {
  const upgradeTarget = String(targetUrl || '').trim()
  if (!upgradeTarget || upgradeTarget === currentThumbnailUrl.value) {
    pendingUpgradeUrl.value = ''
    return
  }
  pendingUpgradeUrl.value = ''
  const preloader = new Image()
  const crossorigin = getImageCrossorigin(upgradeTarget)
  if (crossorigin) preloader.crossOrigin = crossorigin
  preloader.decoding = 'async'
  preloader.onload = () => {
    markLoadedImageUrl(upgradeTarget)
    if (currentThumbnailUrl.value !== upgradeTarget) {
      currentThumbnailUrl.value = upgradeTarget
    }
  }
  preloader.onerror = () => {
    /* 保留已显示的低清图 */
  }
  preloader.src = upgradeTarget
}

watch(
  [
    () => props.wallpaper.id,
    previewQuality,
    lowDataMode,
    () => settingsStore.settings.performance_preview_quality_cap,
    () => props.imageQuality,
    () => props.waterfallQuality,
    () => props.waterfallMode,
  ],
  () => {
    resolvedOriginalUrl.value = ''
    isResolvingOriginal.value = false
    originalResolveAttempted.value = false
    imageRetryCount.value = 0
    clearImageRetryTimer()
    thumbnailFallbackIndex.value = 0
    imageError.value = false

    const targetUrl = selectedPreviewUrl.value || '/placeholder.svg'
    const tiers = previewTierUrls.value
    const quality = clampPreviewQuality(
      props.waterfallMode
        ? ['tiny', 'medium', 'high', 'original'].includes(props.waterfallQuality)
          ? props.waterfallQuality
          : previewQuality.value
        : previewQuality.value,
    )
    const canProgressive =
      !props.waterfallMode &&
      quality !== 'tiny' &&
      tiers.tiny &&
      tiers.tiny !== targetUrl &&
      targetUrl !== '/placeholder.svg'

    if (canProgressive) {
      currentThumbnailUrl.value = tiers.tiny
      pendingUpgradeUrl.value = targetUrl
    } else {
      currentThumbnailUrl.value = targetUrl
      pendingUpgradeUrl.value = ''
    }

    const fullCached = pendingUpgradeUrl.value && hasLoadedImageUrl(pendingUpgradeUrl.value)
    const tinyCached = hasLoadedImageUrl(currentThumbnailUrl.value)
    const cacheHit = tinyCached || fullCached

    resetReveal()
    if (!cacheHit) return

    if (fullCached) {
      currentThumbnailUrl.value = pendingUpgradeUrl.value
      pendingUpgradeUrl.value = ''
      nextTick(() => onImageLoad())
      return
    }

    const upgradeTarget = pendingUpgradeUrl.value
    nextTick(() => {
      onImageLoad()
      if (upgradeTarget) startProgressiveUpgrade(upgradeTarget)
    })
  },
  { immediate: true },
)

async function resolveOriginalPreviewUrl() {
  const wallpaperId = props.wallpaper.id
  if (!wallpaperId || originalResolveAttempted.value || isResolvingOriginal.value) return
  originalResolveAttempted.value = true
  isResolvingOriginal.value = true
  try {
    const response = await wallpaperApi.getWallpaper(wallpaperId)
    if (!response?.success || !response?.image) {
      console.warn(`补拉原图：详情接口未返回图片(${wallpaperId})`, response?.error || '')
      return
    }
    const image = response.image
    const fullUrl =
      normalizePreviewUrl(image?.path) ||
      normalizePreviewUrl(image?.url) ||
      normalizePreviewUrl(image?.thumbs?.original)
    if (!fullUrl) return
    resolvedOriginalUrl.value = fullUrl
    if (image?.path) wallpaperDetails.value.path = image.path
    if (image?.url) wallpaperDetails.value.url = image.url
    if (image?.thumbs) wallpaperDetails.value.thumbs = image.thumbs
    if (fullUrl !== currentThumbnailUrl.value) {
      currentThumbnailUrl.value = fullUrl
      return
    }
    onImageLoad()
  } catch (error) {
    console.warn(`补拉原图地址失败(${wallpaperId})`, error)
  } finally {
    isResolvingOriginal.value = false
    if (previewQuality.value === 'original' && !resolvedOriginalUrl.value) {
      onImageLoad()
    }
  }
}

// 处理图片加载错误
function handleImageError(event) {
  const currentSrc = event.target.src
  if (!currentSrc || currentSrc.endsWith('/placeholder.svg')) {
    imageError.value = true
    return
  }

  if (imageRetryCount.value < 3) {
    imageRetryCount.value += 1
    const retryUrl = currentThumbnailUrl.value || currentSrc
    const delay = 420 * imageRetryCount.value
    clearImageRetryTimer()
    imageRetryTimer.value = window.setTimeout(() => {
      const separator = retryUrl.includes('?') ? '&' : '?'
      currentThumbnailUrl.value = `${retryUrl}${separator}retry=${Date.now()}-${imageRetryCount.value}`
    }, delay)
    return
  }

  imageRetryCount.value = 0
  const fallbackUrls = [
    previewTierUrls.value.tiny,
    previewTierUrls.value.medium,
    previewTierUrls.value.high,
    previewTierUrls.value.original,
    normalizePreviewUrl(props.wallpaper.thumbnail),
  ].filter((url, index, urls) => url && urls.indexOf(url) === index && url !== currentSrc)

  const nextUrl = fallbackUrls[thumbnailFallbackIndex.value]
  if (nextUrl) {
    thumbnailFallbackIndex.value += 1
    clearImageRetryTimer()
    currentThumbnailUrl.value = nextUrl
    event.target.src = nextUrl
    return
  }

  imageError.value = true
  currentThumbnailUrl.value = '/placeholder.svg'
  event.target.src = '/placeholder.svg'
}

function retryImageLoad() {
  clearImageRetryTimer()
  imageRetryCount.value = 0
  thumbnailFallbackIndex.value = 0
  imageError.value = false
  resetReveal()
  const baseUrl =
    selectedPreviewUrl.value || previewTierUrls.value.high || previewTierUrls.value.medium
  if (!baseUrl) {
    currentThumbnailUrl.value = '/placeholder.svg'
    imageError.value = true
    return
  }
  const separator = baseUrl.includes('?') ? '&' : '?'
  currentThumbnailUrl.value = `${baseUrl}${separator}manualRetry=${Date.now()}`
}

onBeforeUnmount(clearImageRetryTimer)

// 处理鼠标进入
function handleMouseEnter(event) {
  isHovered.value = true
  if (!showHoverPreview.value) return

  emit('hover-preview', {
    wallpaper: props.wallpaper,
    event: event,
  })
}

// 处理鼠标离开
function handleMouseLeave() {
  isHovered.value = false
  if (!showHoverPreview.value) return

  // 触发取消悬停预览事件
  emit('hover-preview-end')
}

// 处理鼠标移动
function handleMouseMove(event) {
  if (!showHoverPreview.value) return
  // 触发更新悬停预览位置事件
  emit('hover-preview-move', event)
}

// 多选模式下双击仍可打开大图预览（单击仍为勾选）
function handleCardDblClick() {
  if (!props.selectionMode) return
  historyStore.addHistory(
    {
      ...props.wallpaper,
      ...wallpaperDetails.value,
    },
    {
      source: '壁纸预览',
      referrer: document.referrer,
      searchQuery: new URLSearchParams(window.location.search).get('query') || '',
      viewDuration: 0,
    },
  )
  void promoteCurrentFullImageForPreview()
  emit('preview', props.wallpaper)
}

function emitFindSimilar(event) {
  event.stopPropagation()
  emit('find-similar', props.wallpaper)
}

function hideWallpaper(event) {
  event.stopPropagation()
  emit('hide', props.wallpaper)
}

// 处理卡片点击
function handleCardClick() {
  if (props.selectionMode) {
    emit('toggle-select', props.wallpaper.id)
    return
  }

  // 添加到浏览历史，记录更详细的信息
  historyStore.addHistory(
    {
      ...props.wallpaper,
      ...wallpaperDetails.value, // 合并从API获取的额外信息
    },
    {
      source: '壁纸预览',
      referrer: document.referrer,
      searchQuery: new URLSearchParams(window.location.search).get('query') || '',
      viewDuration: 0, // 初始化浏览时长为0
    },
  )

  // 触发预览事件，由父组件处理
  void promoteCurrentFullImageForPreview()
  emit('preview', props.wallpaper)
}

async function promoteCurrentFullImageForPreview() {
  const fullUrl = currentThumbnailUrl.value || ''
  if (!props.wallpaper?.id || !fullUrl) return
  // 只提升当前已经显示的 full 图；低画质 small/large 缩略图不会被写入全屏缓存。
  await promoteLoadedImageToPreviewBlobCache({
    id: props.wallpaper.id,
    fullUrl,
    imageElement: cardImageElement.value,
    imageInfo: {
      ...props.wallpaper,
      ...wallpaperDetails.value,
    },
  })
}

/** 自定义右键菜单（由搜索页等父级承接） */
function onCardContextMenu(e) {
  emit('context-menu', {
    wallpaper: props.wallpaper,
    clientX: e.clientX,
    clientY: e.clientY,
  })
}

// 查看壁纸详情
function viewWallpaperDetails(event) {
  // 阻止事件冒泡，避免触发卡片点击事件
  event.stopPropagation()

  // 添加到浏览历史，记录更详细的信息
  historyStore.addHistory(
    {
      ...props.wallpaper,
      ...wallpaperDetails.value, // 合并从API获取的额外信息
    },
    {
      source: '壁纸卡片',
      referrer: document.referrer,
      searchQuery: new URLSearchParams(window.location.search).get('query') || '',
      viewDuration: 0, // 初始化浏览时长为0
    },
  )

  // 导航到壁纸详情页
  router.push({ name: 'wallpaper', params: { id: props.wallpaper.id } })
}

// 切换收藏状态
function toggleFavorite(event) {
  // 阻止事件冒泡，避免触发卡片点击事件
  event.stopPropagation()

  if (isLoading.value) return

  // 检查是否按下了Shift键，如果按下则显示收藏夹选择器
  if (event.shiftKey) {
    showCollectionSelector.value = true
    return
  }

  // 直接切换收藏状态（不显示收藏夹选择器）
  directToggleFavorite()
}

// 显示收藏夹选择器
function showCollectionSelectorDialog() {
  showCollectionSelector.value = true
}

// 直接切换收藏状态（不显示收藏夹选择器）
function directToggleFavorite() {
  isLoading.value = true

  try {
    if (isFavorited.value) {
      // 取消收藏
      favoritesStore.removeFavorite(props.wallpaper.id)
    } else {
      // 添加收藏
      favoritesStore.addFavorite(props.wallpaper)
    }
  } catch (error) {
    // 显示错误通知
    notificationService.error(`收藏操作失败: ${error.message || '未知错误'}`, {
      duration: 5000,
      position: 'top-right',
    })
    console.error('收藏操作失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 关闭收藏夹选择器
function closeCollectionSelector() {
  showCollectionSelector.value = false
}

// 处理拖动开始 - 简化版本，不设置自定义拖动预览
function handleDragStart(event) {
  // 设置拖动的数据 - 使用text/plain格式确保兼容性
  event.dataTransfer.setData('text/plain', props.wallpaper.id)
  event.dataTransfer.setData('application/x-walleven-wallpaper-id', props.wallpaper.id)

  // 设置拖动效果
  event.dataTransfer.effectAllowed = 'copy'

  // 添加拖动样式 - 会立即应用CSS中的缩小效果
  event.target.classList.add('dragging')
}

// 处理拖动结束
function handleDragEnd(event) {
  // 移除拖动样式
  event.target.classList.remove('dragging')
}

// 下载壁纸
async function downloadWallpaper(event) {
  // 阻止事件冒泡，避免触发卡片点击事件
  event.stopPropagation()

  if (isLoading.value) return

  isLoading.value = true

  try {
    await downloadWallpapersUnified(props.wallpaper, {
      skipConfirmation: true,
      singleSuccessMessage: `壁纸 ${props.wallpaper.id} 已交给浏览器下载`,
    })
  } catch (error) {
    console.error('下载过程中发生错误:', error)
    notificationService.error(`下载失败: ${error.message || '未知错误'}`, {
      duration: 5000,
      position: 'top-right',
    })
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="wallpaper-card-wrapper">
    <!-- 收藏夹选择器 -->
    <WallpaperCollectionSelector
      :show="showCollectionSelector"
      :wallpaper="wallpaper"
      @close="closeCollectionSelector"
    />
    <div
      class="wallpaper-card"
      :class="{
        'is-select-mode': selectionMode,
        'is-selected': isSelected,
        'ratio-original': ratioMode === 'original',
        'waterfall-mode': waterfallMode,
        'grid-cols-2': gridColumns === 2,
        'grid-cols-3': gridColumns === 3,
        'grid-cols-4': gridColumns === 4,
        'grid-cols-6': gridColumns === 6,
        'grid-cols-8': gridColumns === 8,
      }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
      @mousemove="handleMouseMove"
      @click="handleCardClick"
      @dblclick.stop="handleCardDblClick"
      @contextmenu.prevent="onCardContextMenu"
      :data-id="wallpaper.id"
      :data-resolution="wallpaper.resolution || ''"
      draggable="true"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
    >
      <div class="position-relative">
        <div
          class="wallpaper-link"
          :class="{
            'reveal-off': revealStrength === 'off',
            'reveal-enabled': cardRevealStyle !== 'off',
            'reveal-soft': cardRevealStyle === 'soft',
            'reveal-blur': cardRevealStyle === 'blur',
            'reveal-mosaic': cardRevealStyle === 'mosaic',
            'reveal-mode-epic': cardRevealStyle === 'soft' && revealStrength === 'epic',
            'has-lqip': !!lqipBackground,
            'is-image-ready': imageReady,
            'is-image-loading': !imageReady && !imageError,
          }"
          :style="
            revealStrength === 'off'
              ? waterfallImageStyle
              : {
                  ...waterfallImageStyle,
                  '--reveal-duration':
                    cardRevealStyle === 'blur'
                      ? `${revealDurationMs}ms`
                      : `${Math.min(180, revealDurationMs)}ms`,
                  '--reveal-scale-from': String(revealScaleFrom),
                  '--reveal-blur': `${revealBlurPx}px`,
                }
          "
        >
          <div
            v-if="lqipBackground"
            class="wallpaper-lqip"
            aria-hidden="true"
            :style="{ backgroundColor: lqipBackground }"
          />
          <img
            :src="currentThumbnailUrl"
            :alt="'Wallpaper ' + wallpaper.id"
            ref="cardImageElement"
            referrerpolicy="no-referrer"
            :crossorigin="currentImageCrossorigin"
            class="wallpaper-img"
            :style="waterfallImageStyle"
            :class="{
              'is-loaded': imageReady,
              'reveal-motion': cardRevealStyle !== 'off',
            }"
            :loading="imageLoadingMode"
            :fetchpriority="imageFetchPriority"
            decoding="async"
            @error="handleImageError"
            @load="handleThumbLoad"
            @click.prevent
          />

          <div
            v-show="showSweep && cardRevealStyle === 'soft' && revealStrength === 'epic'"
            class="reveal-sweep"
            aria-hidden="true"
          />

          <div
            v-if="selectionMode"
            class="selection-badge"
            :class="{ 'is-checked': isSelected }"
            aria-hidden="true"
          >
            <i class="bi bi-check-lg" aria-hidden="true"></i>
          </div>

          <div v-if="imageError" class="wallpaper-image-error">
            <button type="button" @click.stop.prevent="retryImageLoad">
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
              重试图片
            </button>
          </div>

          <button
            v-if="showCardHideButton"
            type="button"
            class="wallpaper-hide-btn"
            title="隐藏这张图片"
            aria-label="隐藏这张图片"
            @click.stop="hideWallpaper"
          >
            <i class="bi bi-eye-slash" aria-hidden="true"></i>
          </button>

          <!-- 悬停操作栏 -->
          <div class="wallpaper-overlay">
            <div
              v-if="showCardActionToolbar"
              class="wallpaper-action-toolbar action-buttons"
              aria-label="壁纸操作"
            >
              <!-- 查看详情按钮 -->
              <a
                v-if="isCardActionEnabled('detail')"
                href="javascript:void(0);"
                class="wallpaper-action-btn detail-btn"
                title="查看详情"
                @click.stop="viewWallpaperDetails"
              >
                <i class="bi bi-eye"></i>
              </a>

              <button
                v-if="isCardActionEnabled('more')"
                type="button"
                class="wallpaper-action-btn similar-mini-btn"
                title="找相似（like: 当前图）"
                @click.stop="emitFindSimilar"
              >
                <i class="bi bi-shuffle" />
              </button>

              <!-- 下载按钮 -->
              <button
                v-if="isCardActionEnabled('download')"
                class="wallpaper-action-btn download-btn"
                title="点击直接下载，按住Shift键点击可配置下载选项"
                @click.stop="downloadWallpaper"
                :disabled="isLoading"
              >
                <i class="bi bi-download"></i>
              </button>

              <!-- 收藏按钮 -->
              <div
                v-if="isCardActionEnabled('favorite') || isCardActionEnabled('collection')"
                class="favorite-action-combo"
              >
                <button
                  v-if="isCardActionEnabled('favorite')"
                  class="wallpaper-action-btn favorite-btn"
                  :title="isFavorited ? '取消收藏' : '添加到收藏'"
                  @click.stop="toggleFavorite"
                  :class="{ favorited: isFavorited }"
                  :disabled="isLoading"
                >
                  <i class="bi" :class="isFavorited ? 'bi-heart-fill' : 'bi-heart'"></i>
                </button>
                <button
                  v-if="isCardActionEnabled('collection')"
                  class="wallpaper-action-btn collection-btn"
                  title="收藏夹选项"
                  @click.stop="showCollectionSelectorDialog"
                  :disabled="isLoading"
                >
                  <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  <span class="visually-hidden">收藏夹选项</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wallpaper-card-wrapper {
  display: contents;
}

.wallpaper-card {
  --card-radius: 14px;
  margin-bottom: 0;
  border-radius: var(--card-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
  contain: layout paint style;
  transform: translateZ(0);
  transition: box-shadow 0.2s ease;
}

.wallpaper-card.dragging {
  opacity: 0.55;
  transform: scale(0.15);
  cursor: grabbing;
  z-index: 9999;
  position: relative;
}

.position-relative {
  position: relative;
  width: 100%;
  height: 100%;
}

.wallpaper-img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
  pointer-events: none;
  transform: translateZ(0);
  transition:
    transform 0.26s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.22s ease,
    filter 0.22s ease;
}

.wallpaper-link.reveal-enabled.reveal-mosaic .wallpaper-img {
  opacity: 0;
}

.wallpaper-link.reveal-enabled.reveal-mosaic .wallpaper-img.is-loaded {
  opacity: 1;
}

.wallpaper-link.reveal-soft.reveal-enabled:not(.reveal-off) .wallpaper-img {
  opacity: 0;
  transform: scale(var(--reveal-scale-from, 1.01)) translateZ(0);
  transition-duration: var(--reveal-duration, 240ms), var(--reveal-duration, 240ms);
}

.wallpaper-link.reveal-soft.reveal-enabled:not(.reveal-off) .wallpaper-img.is-loaded {
  opacity: 1;
  transform: scale(1) translateZ(0);
}

.wallpaper-link.reveal-blur.reveal-enabled:not(.reveal-off) .wallpaper-img {
  opacity: 0.7;
  transform: scale(var(--reveal-scale-from, 1.035)) translateZ(0);
  filter: blur(var(--reveal-blur, 26px)) saturate(1.06) brightness(1.03);
  transition:
    filter var(--reveal-duration, 760ms) cubic-bezier(0.16, 1, 0.3, 1),
    opacity calc(var(--reveal-duration, 760ms) * 0.88) ease-out,
    transform var(--reveal-duration, 760ms) cubic-bezier(0.16, 1, 0.3, 1);
}

.wallpaper-link.reveal-blur.reveal-enabled:not(.reveal-off) .wallpaper-img.is-loaded {
  opacity: 1;
  transform: scale(1) translateZ(0);
  filter: blur(0) saturate(1) brightness(1);
}

.wallpaper-link.reveal-blur.is-image-loading .wallpaper-lqip {
  animation: wallpaper-blur-placeholder 2.2s ease-in-out infinite alternate;
}

@keyframes wallpaper-blur-placeholder {
  from {
    opacity: 0.48;
    transform: scale(1);
  }

  to {
    opacity: 0.82;
    transform: scale(1.015);
  }
}

.wallpaper-link.reveal-off .wallpaper-img,
.wallpaper-link.reveal-soft.reveal-off .wallpaper-img,
.wallpaper-link.reveal-blur.reveal-off .wallpaper-img {
  opacity: 1;
  transform: translateZ(0);
  filter: none;
}

.grid-cols-2 .wallpaper-img { height: 500px; }
.grid-cols-3 .wallpaper-img { height: 400px; }
.grid-cols-4 .wallpaper-img { height: 300px; }
.grid-cols-6 .wallpaper-img { height: 180px; }
.grid-cols-8 .wallpaper-img { height: 150px; }

.wallpaper-card.ratio-original .position-relative,
.wallpaper-card.ratio-original .wallpaper-link {
  height: auto;
}

.wallpaper-card.ratio-original .wallpaper-img {
  height: auto !important;
  max-height: 78vh;
  object-fit: contain;
}

.wallpaper-card.waterfall-mode .position-relative,
.wallpaper-card.waterfall-mode .wallpaper-link {
  height: auto;
}

.wallpaper-card.waterfall-mode .wallpaper-img {
  height: 100% !important;
  max-height: none;
  width: 100%;
  object-fit: cover;
}

.wallpaper-link {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.02);
  cursor: default;
}

.wallpaper-lqip {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.wallpaper-link.is-image-loading:not(.reveal-blur) .wallpaper-lqip {
  animation: wallpaper-lqip-pulse 1.1s ease-in-out infinite alternate;
}

@keyframes wallpaper-lqip-pulse {
  to {
    opacity: 0.45;
  }
}

.selection-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 20;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.35);
  color: transparent;
  pointer-events: none;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.selection-badge.is-checked {
  border-color: transparent;
  background: var(--primary-color, #0d6efd);
  color: #fff;
}

.selection-badge i {
  font-size: 0.75rem;
  line-height: 1;
}

.wallpaper-image-error {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}

.wallpaper-image-error button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  min-height: 32px;
  border: none;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  font-size: 0.78rem;
  font-weight: 600;
}

.mosaic-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  pointer-events: none;
}

.mosaic-tile {
  background: linear-gradient(135deg, rgba(48, 52, 64, 0.96), rgba(110, 120, 150, 0.42));
  animation: walleven-mosaic-fade 0.5s ease forwards;
}

:global(html.settings-no-animations) .wallpaper-link.reveal-enabled .wallpaper-img {
  transition-duration: 0.28s !important;
}

:global(html.settings-no-animations)
  .wallpaper-link.reveal-soft.reveal-enabled:not(.reveal-off)
  .wallpaper-img {
  transition-duration: 0.22s !important, 0.22s !important;
}

:global(html.settings-no-animations) .wallpaper-link.reveal-enabled .mosaic-tile {
  animation-duration: 0.5s !important;
  animation-iteration-count: 1 !important;
}

:global(html.settings-no-animations)
  .wallpaper-link.reveal-blur.reveal-enabled:not(.reveal-off)
  .wallpaper-img {
  transition-duration:
    0.28s !important,
    0.28s !important,
    0.28s !important;
}

:global(html.settings-no-animations) .wallpaper-link.reveal-blur.is-image-loading .wallpaper-lqip {
  animation: none !important;
}

:global(html.settings-no-animations) .wallpaper-link.is-image-loading .wallpaper-lqip {
  animation: none !important;
}

.wallpaper-overlay {
  position: absolute;
  z-index: 5;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.6) 100%);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px;
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}

.wallpaper-overlay .action-buttons {
  pointer-events: none;
}

.action-buttons .wallpaper-action-btn,
.action-buttons a {
  pointer-events: auto;
  position: relative;
  z-index: 10;
}

.wallpaper-hide-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 30;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  background: rgba(12, 16, 22, 0.74);
  color: #fff;
  opacity: 0;
  transform: translateY(-3px) scale(0.94);
  pointer-events: none;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px) saturate(1.12);
  -webkit-backdrop-filter: blur(12px) saturate(1.12);
  transition:
    opacity 0.09s ease,
    transform 0.09s ease,
    background-color 0.14s ease,
    color 0.14s ease;
}

.wallpaper-action-toolbar {
  --wallpaper-action-size: 32px;
  --wallpaper-action-favorite-size: 30px;
  --wallpaper-action-menu-width: 22px;
  --wallpaper-action-gap: 3px;
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: var(--wallpaper-action-gap);
  max-width: calc(100% - 20px);
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(16, 20, 28, 0.68), rgba(18, 23, 32, 0.52)), rgba(8, 11, 16, 0.42);
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px) saturate(1.12);
  -webkit-backdrop-filter: blur(14px) saturate(1.12);
  pointer-events: none;
  opacity: 0;
  transform: translateY(8px) scale(0.98);
  transition:
    opacity 0.09s ease,
    transform 0.09s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.wallpaper-action-btn {
  display: inline-grid;
  place-items: center;
  width: var(--wallpaper-action-size);
  height: var(--wallpaper-action-size);
  min-width: var(--wallpaper-action-size);
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  text-decoration: none;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.wallpaper-action-btn i {
  font-size: 0.94rem;
}

.wallpaper-action-btn:hover,
.wallpaper-action-btn:focus-visible {
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  transform: translateY(-1px);
  box-shadow: 0 7px 16px rgba(0, 0, 0, 0.2);
  outline: none;
}

.wallpaper-action-btn:active {
  transform: translateY(0) scale(0.96);
}

.wallpaper-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.48;
  transform: none;
  box-shadow: none;
}

.wallpaper-action-btn.detail-btn {
  color: rgba(180, 246, 255, 0.96);
}

.wallpaper-action-btn.similar-mini-btn {
  color: rgba(255, 255, 255, 0.88);
}

.wallpaper-action-btn.download-btn {
  color: rgba(176, 210, 255, 0.98);
}

.wallpaper-action-btn.favorite-btn {
  color: rgba(255, 174, 186, 0.98);
}

.wallpaper-action-btn.detail-btn:hover,
.wallpaper-action-btn.detail-btn:focus-visible {
  background: rgba(20, 184, 166, 0.22);
}

.wallpaper-action-btn.similar-mini-btn:hover,
.wallpaper-action-btn.similar-mini-btn:focus-visible {
  background: rgba(255, 255, 255, 0.16);
}

.wallpaper-action-btn.download-btn:hover,
.wallpaper-action-btn.download-btn:focus-visible {
  background: rgba(37, 99, 235, 0.22);
}

.wallpaper-action-btn.favorite-btn:hover,
.wallpaper-action-btn.favorite-btn:focus-visible,
.wallpaper-action-btn.favorite-btn.favorited {
  background: rgba(225, 45, 70, 0.24);
  color: #fff;
}

.favorite-action-combo {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.favorite-action-combo .favorite-btn {
  width: var(--wallpaper-action-favorite-size);
  height: var(--wallpaper-action-favorite-size);
  min-width: var(--wallpaper-action-favorite-size);
  border: 0;
  background: transparent;
}

.favorite-action-combo .collection-btn {
  width: var(--wallpaper-action-menu-width);
  height: var(--wallpaper-action-favorite-size);
  min-width: var(--wallpaper-action-menu-width);
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
}

.favorite-action-combo .collection-btn i {
  font-size: 0.72rem;
}

.grid-cols-6 .wallpaper-action-toolbar,
.grid-cols-8 .wallpaper-action-toolbar {
  --wallpaper-action-size: 27px;
  --wallpaper-action-favorite-size: 26px;
  --wallpaper-action-menu-width: 19px;
  --wallpaper-action-gap: 2px;
  right: 8px;
  bottom: 8px;
  padding: 2px;
}

.grid-cols-8 .wallpaper-action-toolbar {
  --wallpaper-action-size: 28px;
  --wallpaper-action-favorite-size: 28px;
  --wallpaper-action-menu-width: 24px;
  --wallpaper-action-gap: 3px;
  left: 8px;
  right: 8px;
  justify-content: space-between;
  max-width: none;
  padding: 4px;
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(10, 13, 18, 0.78), rgba(17, 22, 30, 0.68)), rgba(6, 8, 12, 0.58);
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

.grid-cols-6 .wallpaper-action-btn i,
.grid-cols-8 .wallpaper-action-btn i {
  font-size: 0.9rem;
}

.grid-cols-8 .wallpaper-action-btn {
  flex: 1 1 0;
  min-width: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.1);
}

.grid-cols-8 .favorite-action-combo {
  flex: 1.55 1 0;
  min-width: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.1);
}

.grid-cols-8 .favorite-action-combo .favorite-btn {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  border-radius: 8px 6px 6px 8px;
}

.grid-cols-8 .favorite-action-combo .collection-btn {
  flex: 0 0 22px;
  width: 22px;
  min-width: 22px;
  border-radius: 6px 8px 8px 6px;
}

.grid-cols-6 .favorite-action-combo .collection-btn i,
.grid-cols-8 .favorite-action-combo .collection-btn i {
  font-size: 0.62rem;
}

.wallpaper-card.is-select-mode {
  cursor: pointer;
  outline: 2px solid rgba(255, 255, 255, 0.22);
  outline-offset: -2px;
}

.wallpaper-card.is-select-mode.is-selected {
  outline: 2px solid var(--primary-color, #0d6efd);
  outline-offset: -2px;
}

@media (hover: hover) and (pointer: fine) {
  .wallpaper-card:has(.wallpaper-link:hover),
  .wallpaper-card:has(.wallpaper-link:focus-within) {
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  }

  .wallpaper-link:hover .wallpaper-img,
  .wallpaper-link:focus-within .wallpaper-img {
    transform: scale(1.018) translateZ(0);
  }

  .wallpaper-card.ratio-original:has(.wallpaper-link:hover) .wallpaper-img,
  .wallpaper-card.ratio-original:has(.wallpaper-link:focus-within) .wallpaper-img {
    transform: translateZ(0);
  }

  .wallpaper-link:hover .wallpaper-overlay,
  .wallpaper-link:focus-within .wallpaper-overlay {
    opacity: 1;
  }

  .wallpaper-link:hover .wallpaper-action-toolbar,
  .wallpaper-link:focus-within .wallpaper-action-toolbar,
  .wallpaper-action-toolbar:focus-within {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .wallpaper-link:hover .wallpaper-overlay .action-buttons,
  .wallpaper-link:focus-within .wallpaper-overlay .action-buttons {
    pointer-events: auto;
  }

  .wallpaper-link:hover .wallpaper-hide-btn,
  .wallpaper-link:focus-within .wallpaper-hide-btn,
  .wallpaper-hide-btn:focus-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .wallpaper-hide-btn:hover,
  .wallpaper-hide-btn:focus-visible {
    color: #fff;
    background: rgba(220, 53, 69, 0.72);
    outline: none;
  }
}

@media (max-width: 576px) {
  .wallpaper-action-toolbar {
    --wallpaper-action-size: 27px;
    --wallpaper-action-favorite-size: 26px;
    --wallpaper-action-menu-width: 19px;
    --wallpaper-action-gap: 2px;
    right: 8px;
    bottom: 8px;
    padding: 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wallpaper-card,
  .wallpaper-img,
  .wallpaper-overlay,
  .wallpaper-action-toolbar,
  .wallpaper-hide-btn,
  .wallpaper-action-btn,
  .selection-badge {
    transition: none !important;
  }

  .wallpaper-link.is-image-loading .wallpaper-lqip {
    animation: none !important;
  }

  .wallpaper-link.reveal-blur.reveal-enabled:not(.reveal-off) .wallpaper-img {
    filter: none !important;
    opacity: 1 !important;
    transform: translateZ(0) !important;
  }

  .wallpaper-link:hover .wallpaper-img,
  .wallpaper-link:focus-within .wallpaper-img {
    transform: translateZ(0) !important;
  }

  .wallpaper-link:hover .wallpaper-action-toolbar,
  .wallpaper-link:focus-within .wallpaper-action-toolbar,
  .wallpaper-action-toolbar:focus-within {
    transform: none !important;
  }

  .wallpaper-link:hover .wallpaper-hide-btn,
  .wallpaper-link:focus-within .wallpaper-hide-btn,
  .wallpaper-hide-btn:focus-visible {
    transform: none !important;
  }
}
</style>
