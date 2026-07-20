<script setup>
import WallpaperPreview from '@/components/wallpaper/WallpaperFullscreenPreview.vue'
import { useMosaicReveal } from '@/composables/useMosaicReveal'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import { webDebugLog } from '@/services/debugLog'
import notificationService from '@/services/notification'
import { downloadWallpapersUnified } from '@/services/wallpaperDownload'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useSettingsStore } from '@/stores/settings'
import { getImageCrossorigin, markLoadedImageUrl } from '@/utils/imageRequest'
import { normalizeUploaderUsername } from '@/utils/wallhaven'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 获取route、router和stores
const route = useRoute()
const router = useRouter()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const runtimeConfigStore = useRuntimeConfigStore()
const settingsStore = useSettingsStore()

const heroReveal = useMosaicReveal()

// 壁纸数据
const wallpaper = ref(null)
const isLoading = ref(false)
const error = ref('')
const relatedWallpapers = ref([])
const isLoadingRelated = ref(false)
const relatedPage = ref(1)
const hasMoreRelated = ref(true)

// 下载相关
const isDownloading = ref(false)
const downloadProgress = ref(0)
const downloadError = ref('')
const downloadSuccess = ref(false)

// 预览相关
const showPreview = ref(false)

// 计算属性
const wallpaperId = computed(() => route.params.id)
const isFavorited = computed(
  () => wallpaper.value && favoritesStore.isFavorited(wallpaper.value.id),
)
const heroLqip = computed(() => {
  const colors = wallpaper.value?.colors
  if (!Array.isArray(colors) || !colors.length) return ''
  const c = colors[0]
  if (typeof c !== 'string') return ''
  return c.startsWith('#') ? c : `#${c}`
})

const heroImageSrc = computed(() => proxyWallhavenImageUrl(wallpaper.value?.url || ''))
const heroImageCrossorigin = computed(() => getImageCrossorigin(heroImageSrc.value))
const searchLayout = computed(() => runtimeConfigStore.getPageLayout('search') || {})
const previewLayout = computed(() => searchLayout.value.preview || {})

function isPreviewToolVisible(key) {
  return previewLayout.value?.enabled !== false && previewLayout.value?.[key]?.enabled !== false
}

const isPreviewEnabled = computed(
  () => searchLayout.value?.preview?.enabled !== false && previewLayout.value?.enabled !== false,
)
const canDownloadWallpaper = computed(() => runtimeConfigStore.canUse('download'))
const previewEnabledActions = computed(() => ({
  favorite: isPreviewToolVisible('favorite'),
  mockup: isPreviewToolVisible('mockup'),
  rotate: isPreviewToolVisible('rotate'),
  fit: isPreviewToolVisible('fit'),
  info: isPreviewToolVisible('info'),
  compare: isPreviewToolVisible('compare'),
  crop: isPreviewToolVisible('crop'),
  decompose: isPreviewToolVisible('decompose'),
  filters: isPreviewToolVisible('filters'),
  ai: isPreviewToolVisible('ai'),
  download: canDownloadWallpaper.value && isPreviewToolVisible('download'),
  fullscreen: isPreviewToolVisible('fullscreen'),
}))

const formattedFileSize = computed(() => {
  if (!wallpaper.value || !wallpaper.value.file_size) return '未知'

  const size = wallpaper.value.file_size
  if (size < 1024) {
    return `${size} B`
  } else if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  } else if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  } else {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
})

const uploaderName = computed(() => normalizeUploaderUsername(wallpaper.value?.uploader) || '未知')

const wallpaperColors = computed(() => {
  const colors = Array.isArray(wallpaper.value?.colors) ? wallpaper.value.colors : []
  return colors
    .map((color) =>
      String(color || '')
        .replace(/^#/, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 12)
})

const wallpaperTags = computed(() => {
  const tags = Array.isArray(wallpaper.value?.tags) ? wallpaper.value.tags : []
  return tags
    .map((tag) => ({
      id: typeof tag === 'object' && tag ? tag.id : tag,
      name: normalizeTagName(tag),
    }))
    .filter((tag) => tag.name)
})

const detailStats = computed(() => [
  { label: '分辨率', value: wallpaper.value?.resolution || '未知', icon: 'bi-aspect-ratio' },
  { label: '文件大小', value: formattedFileSize.value, icon: 'bi-hdd' },
  { label: '收藏', value: formatCount(wallpaper.value?.favorites), icon: 'bi-heart' },
  { label: '浏览', value: formatCount(wallpaper.value?.views), icon: 'bi-eye' },
])

const relatedSummary = computed(() => {
  if (isLoadingRelated.value && !relatedWallpapers.value.length) return '正在匹配相似作品'
  if (!relatedWallpapers.value.length) return '暂无推荐'
  return `${relatedWallpapers.value.length} 张推荐`
})

function normalizeTagName(tag) {
  if (typeof tag === 'object' && tag) return String(tag.name || tag.id || '').trim()
  return String(tag || '').trim()
}

function formatCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '未知'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return n.toLocaleString()
}

function relatedImageSrc(item) {
  return proxyWallhavenImageUrl(
    item?.thumbs?.large ||
      item?.thumbs?.original ||
      item?.thumbnail ||
      item?.url ||
      item?.path ||
      '',
  )
}

// 加载壁纸详情 - 增强版
async function loadWallpaper() {
  if (isLoading.value) return

  isLoading.value = true
  error.value = ''

  try {
    const response = await wallpaperApi.getWallpaper(wallpaperId.value)
    webDebugLog('wallpaper', 'API返回壁纸详情:', response)

    if (response.success && response.image) {
      // 直接使用API返回的URL，不再构建备用URL列表

      // 确保壁纸对象包含必要的属性
      wallpaper.value = {
        ...response.image,
        // 直接使用API返回的URL
        url: response.image.url || response.image.path,
        path: response.image.path || response.image.url,
      }

      // 确保壁纸对象包含缩略图信息
      if (!wallpaper.value.thumbnail && wallpaper.value.url) {
        wallpaper.value.thumbnail = wallpaper.value.url
      }

      // 添加到浏览历史，记录更详细的信息
      historyStore.addHistory(
        {
          id: wallpaper.value.id,
          thumbnail: wallpaper.value.thumbnail || wallpaper.value.url,
          resolution: wallpaper.value.resolution,
          uploader: wallpaper.value.uploader,
          category: wallpaper.value.category,
          tags: wallpaper.value.tags,
          purity: wallpaper.value.purity,
          file_size: wallpaper.value.file_size,
          favorites: wallpaper.value.favorites,
          views: wallpaper.value.views,
        },
        {
          source: '壁纸详情页',
          referrer: document.referrer,
          viewDuration: 0, // 初始化浏览时长为0，后续可以更新
        },
      )

      // 加载相关壁纸
      loadRelatedWallpapers()
    } else {
      // 从URL中获取壁纸ID
      const id = wallpaperId.value

      // 创建基本的壁纸对象
      wallpaper.value = {
        id: id,
        url: `https://wallhaven.cc/w/${id}`,
        path: `https://wallhaven.cc/w/${id}`,
        resolution: '未知',
        file_size: 0,
        uploader: '未知',
        tags: [],
      }
    }
  } catch (err) {
    // 从URL中获取壁纸ID
    const id = wallpaperId.value

    // 创建基本的壁纸对象
    wallpaper.value = {
      id: id,
      url: `https://wallhaven.cc/w/${id}`,
      path: `https://wallhaven.cc/w/${id}`,
      resolution: '未知',
      file_size: 0,
      uploader: '未知',
      tags: [],
    }
  } finally {
    isLoading.value = false
  }
}

// 获取相关壁纸的查询参数
function getRelatedWallpapersQuery() {
  let query = ''
  if (wallpaper.value && wallpaper.value.tags && wallpaper.value.tags.length > 0) {
    // 选择最多5个标签以获取更多相关壁纸
    const tags = wallpaper.value.tags.map(normalizeTagName).filter(Boolean)
    const selectedTags = []

    // 如果标签数量少于5个，使用所有标签
    if (tags.length <= 5) {
      query = tags.join(' ')
    } else {
      // 否则随机选择5个标签
      while (selectedTags.length < 5 && tags.length > 0) {
        const randomIndex = Math.floor(Math.random() * tags.length)
        selectedTags.push(tags[randomIndex])
        tags.splice(randomIndex, 1)
      }
      query = selectedTags.join(' ')
    }
  }
  return query
}

// 加载相关壁纸
async function loadRelatedWallpapers() {
  if (!wallpaper.value || isLoadingRelated.value) return

  isLoadingRelated.value = true
  relatedPage.value = 1 // 重置页码
  hasMoreRelated.value = true // 重置加载更多状态

  try {
    // 获取查询参数
    const query = getRelatedWallpapersQuery()

    // 搜索相关壁纸，增加每页数量
    const response = await wallpaperApi.search({
      query,
      categories: '111',
      purity: '100',
      sorting: 'relevance',
      page: relatedPage.value,
      per_page: 24, // 请求更多壁纸
    })

    if (response.success && response.images) {
      // 过滤掉当前壁纸，保留更多相关壁纸
      relatedWallpapers.value = response.images
        .filter((img) => img.id !== wallpaper.value.id)
        .slice(0, 16) // 显示更多相关壁纸

      // 检查是否还有更多壁纸可加载
      hasMoreRelated.value = response.images.length > 16
    } else {
      hasMoreRelated.value = false
    }
  } catch (err) {
    console.error('加载相关壁纸失败:', err)
    hasMoreRelated.value = false
  } finally {
    isLoadingRelated.value = false
  }
}

// 加载更多相关壁纸
async function loadMoreRelatedWallpapers() {
  if (!wallpaper.value || isLoadingRelated.value || !hasMoreRelated.value) return

  isLoadingRelated.value = true
  relatedPage.value += 1 // 增加页码

  try {
    // 获取查询参数
    const query = getRelatedWallpapersQuery()

    // 搜索相关壁纸
    const response = await wallpaperApi.search({
      query,
      categories: '111',
      purity: '100',
      sorting: 'relevance',
      page: relatedPage.value,
      per_page: 24,
    })

    if (response.success && response.images && response.images.length > 0) {
      // 过滤掉当前壁纸和已有的壁纸
      const newWallpapers = response.images
        .filter(
          (img) =>
            img.id !== wallpaper.value.id &&
            !relatedWallpapers.value.some((existing) => existing.id === img.id),
        )
        .slice(0, 16)

      // 添加到现有列表
      if (newWallpapers.length > 0) {
        relatedWallpapers.value = [...relatedWallpapers.value, ...newWallpapers]
      }

      // 检查是否还有更多壁纸可加载
      hasMoreRelated.value = newWallpapers.length >= 8
    } else {
      hasMoreRelated.value = false
    }
  } catch (err) {
    console.error('加载更多相关壁纸失败:', err)
    hasMoreRelated.value = false
  } finally {
    isLoadingRelated.value = false
  }
}

// 切换收藏状态
function toggleFavorite() {
  if (!wallpaper.value) return

  if (isFavorited.value) {
    // 取消收藏
    favoritesStore.removeFavorite(wallpaper.value.id)
  } else {
    // 添加收藏
    favoritesStore.addFavorite({
      id: wallpaper.value.id,
      thumbnail: wallpaper.value.thumbnail || wallpaper.value.url,
      resolution: wallpaper.value.resolution,
      uploader: wallpaper.value.uploader,
      tags: wallpaper.value.tags,
    })
  }
}

// 下载壁纸
async function downloadWallpaper(event) {
  if (!wallpaper.value || isDownloading.value) return
  if (!canDownloadWallpaper.value) {
    notificationService.warning('下载功能暂未开放')
    return
  }

  // 检查是否按下了Shift键，如果按下则显示配置对话框
  if (event && event.shiftKey) {
    // 这里可以添加显示下载配置对话框的代码
    // 由于壁纸详情页面没有下载配置对话框，可以导航到设置页面的下载设置标签
    router.push({
      path: '/settings',
      query: { tab: 'download' },
    })
    return
  }

  isDownloading.value = true
  downloadProgress.value = 0
  downloadError.value = ''
  downloadSuccess.value = false

  try {
    // 确保壁纸对象包含缩略图信息
    const wallpaperToDownload = { ...wallpaper.value }

    // 如果壁纸对象没有thumbnail属性，但有url属性，将url作为thumbnail
    if (!wallpaperToDownload.thumbnail && wallpaperToDownload.url) {
      wallpaperToDownload.thumbnail = wallpaperToDownload.url
    }

    webDebugLog('wallpaper', '准备下载的壁纸数据:', wallpaperToDownload)

    const result = await downloadWallpapersUnified(wallpaperToDownload, {
      notify: false,
      skipConfirmation: true,
    })

    if (result.count > 0) {
      // 显示下载已添加通知
      notificationService.success(`壁纸 ${wallpaper.value.id} 已添加到下载队列`, {
        duration: 5000,
        position: 'top-right',
      })

      // 注意：下载管理器内部会自动检查并开始下载任务
      // 不需要在这里手动调用startDownload，避免任务不存在的错误
      webDebugLog('wallpaper', '下载任务已创建:', result)

      downloadSuccess.value = true
      setTimeout(() => {
        downloadSuccess.value = false
      }, 3000)
    } else {
      downloadError.value = '下载已取消或创建任务失败'
    }
  } catch (err) {
    downloadError.value = '下载壁纸失败'

    // 显示错误通知
    notificationService.error(`下载壁纸失败: ${err.message || '未知错误'}`, {
      duration: 5000,
      position: 'top-right',
    })
  } finally {
    isDownloading.value = false
  }
}

// 查看用户页面（uploader 常为 { username, ... }）
function viewUserPage() {
  const u = normalizeUploaderUsername(wallpaper.value?.uploader)
  if (!u) return
  router.push({ name: 'user', params: { username: u } })
}

// 搜索标签
function searchTag(tag) {
  const q = typeof tag === 'object' && tag !== null ? tag.name || tag.id : tag
  router.push({
    name: 'search',
    query: { query: String(q) },
  })
}

// Wallhaven「相似壁纸」：q=like:<id>
function searchSimilar() {
  if (!wallpaper.value?.id) return
  router.push({
    name: 'search',
    query: { query: `like:${wallpaper.value.id}` },
  })
}

function handleHeroImageLoad() {
  markLoadedImageUrl(heroImageSrc.value)
  heroReveal.onImageLoad()
}

function handleRelatedImageLoad(event) {
  markLoadedImageUrl(event?.target?.currentSrc || event?.target?.src)
}

// 预览壁纸
function previewImage() {
  if (!wallpaper.value || !isPreviewEnabled.value) return

  showPreview.value = true
}

// 关闭预览
function closePreview() {
  showPreview.value = false
}

// 查看相关壁纸
function viewRelatedWallpaper(relatedWallpaper) {
  router.push({ name: 'wallpaper', params: { id: relatedWallpaper.id } })
}

// 获取原始网址
function getOriginalUrl() {
  if (!wallpaper.value || !wallpaper.value.id) return '#'

  // 构建 Wallhaven 原始壁纸页面的 URL
  return `https://wallhaven.cc/w/${wallpaper.value.id}`
}

// 监听路由变化（换图时重置揭幕动效）
watch(
  () => route.params.id,
  () => {
    heroReveal.resetReveal()
    loadWallpaper()
  },
)

// 组件挂载时初始化
onMounted(() => {
  document.documentElement.classList.add('wallpaper-detail-page')
  favoritesStore.initFavorites()
  historyStore.initHistory()
  settingsStore.initSettings()
  loadWallpaper()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('wallpaper-detail-page')
})
</script>

<template>
  <div class="wallpaper-detail">
    <div class="wallpaper-detail__atmosphere" aria-hidden="true"></div>

    <div v-if="isLoading" class="wallpaper-detail__state">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">加载中...</span>
      </div>
      <p>加载壁纸中...</p>
    </div>

    <div v-else-if="error && !wallpaper" class="wallpaper-detail__state is-error">
      <i class="bi bi-exclamation-triangle"></i>
      <p>{{ error }}</p>
      <router-link to="/search" class="wallpaper-detail__btn is-primary">
        <i class="bi bi-arrow-left"></i>
        返回搜索
      </router-link>
    </div>

    <main v-else-if="wallpaper" class="wallpaper-detail__shell">
      <section class="wallpaper-detail__hero">
        <div class="wallpaper-detail__media">
          <div
            class="wallpaper-preview-container"
            :class="{
              'reveal-off': heroReveal.strength === 'off',
              'reveal-enabled': heroReveal.strength !== 'off',
              'reveal-soft': heroReveal.revealStyle === 'soft',
              'reveal-mode-epic':
                heroReveal.revealStyle === 'soft' && heroReveal.strength === 'epic',
            }"
            :style="
              heroReveal.strength === 'off'
                ? undefined
                : heroReveal.revealStyle === 'soft'
                  ? {
                      '--reveal-duration': `${heroReveal.revealDurationMs}ms`,
                      '--reveal-scale-from': String(heroReveal.revealScaleFrom),
                    }
                  : undefined
            "
          >
            <div
              v-if="heroImageSrc"
              class="wallpaper-detail__blur"
              aria-hidden="true"
              :style="{ backgroundImage: `url(${heroImageSrc})` }"
            />
            <div
              v-if="heroLqip"
              class="hero-lqip"
              aria-hidden="true"
              :style="{ backgroundColor: heroLqip }"
            />
            <div class="hero-image-wrap">
              <img
                :src="heroImageSrc"
                :alt="wallpaper.id"
                referrerpolicy="no-referrer"
                :crossorigin="heroImageCrossorigin"
                class="wallpaper-preview"
                :class="{ 'is-loaded': heroReveal.imageReady }"
                decoding="async"
                @click="previewImage"
                @load="handleHeroImageLoad"
              />
              <div
                v-show="heroReveal.showMosaic && heroReveal.mosaicCount > 0"
                class="mosaic-overlay"
                :style="{ gridTemplateColumns: `repeat(${heroReveal.mosaicCols}, minmax(0, 1fr))` }"
                aria-hidden="true"
              >
                <div
                  v-for="idx in heroReveal.mosaicCount"
                  :key="`${wallpaper.id}-h-${idx}`"
                  class="mosaic-tile"
                  :class="heroReveal.tileClass"
                  :style="{ animationDelay: `${idx * heroReveal.tileDelayMs}ms` }"
                />
              </div>
              <div
                v-show="
                  heroReveal.showSweep &&
                  heroReveal.revealStyle === 'soft' &&
                  heroReveal.strength === 'epic'
                "
                class="reveal-sweep"
                aria-hidden="true"
              />
            </div>
            <div class="wallpaper-detail__frame" aria-hidden="true"></div>
            <span class="wallpaper-detail__mark">Artwork</span>
          </div>

          <div v-if="downloadSuccess || downloadError" class="wallpaper-detail__status">
            <span v-if="downloadSuccess" class="is-ok">
              <i class="bi bi-check-circle"></i>
              壁纸已加入下载队列
            </span>
            <span v-if="downloadError" class="is-error">
              <i class="bi bi-exclamation-triangle"></i>
              {{ downloadError }}
            </span>
          </div>
        </div>

        <aside class="wallpaper-detail__side">
          <div class="wallpaper-detail__spine" aria-hidden="true">
            <span>Wallhaven</span>
            <i></i>
            <em>View</em>
          </div>

          <div class="wallpaper-detail__panel">
            <header class="wallpaper-detail__heading">
              <span class="wallpaper-detail__eyebrow">StarCloudIsAI · Wallhaven</span>
              <h1>{{ wallpaper.id }}</h1>
              <button type="button" class="wallpaper-detail__uploader" @click="viewUserPage">
                <span aria-hidden="true">{{ String(uploaderName).slice(0, 1) }}</span>
                <div>
                  <strong>{{ uploaderName }}</strong>
                  <small>上传者</small>
                </div>
              </button>
            </header>

            <div class="wallpaper-detail__actions">
              <button
                type="button"
                class="wallpaper-detail__btn is-favorite"
                :class="{ 'is-active': isFavorited }"
                @click="toggleFavorite"
              >
                <i class="bi" :class="isFavorited ? 'bi-heart-fill' : 'bi-heart'"></i>
                <span>{{ isFavorited ? '已收藏' : '收藏' }}</span>
              </button>
              <button
                type="button"
                class="wallpaper-detail__btn is-primary"
                :disabled="isDownloading || !canDownloadWallpaper"
                title="点击直接下载，按住 Shift 键点击可配置下载选项"
                @click="downloadWallpaper"
              >
                <i class="bi" :class="isDownloading ? 'bi-hourglass' : 'bi-download'"></i>
                <span>{{ isDownloading ? '下载中' : '下载' }}</span>
              </button>
              <button type="button" class="wallpaper-detail__btn" @click="searchSimilar">
                <i class="bi bi-intersect"></i>
                <span>相似</span>
              </button>
              <button type="button" class="wallpaper-detail__btn" @click="previewImage">
                <i class="bi bi-fullscreen"></i>
                <span>全屏</span>
              </button>
              <a
                class="wallpaper-detail__btn is-external"
                :href="getOriginalUrl()"
                target="_blank"
                rel="noopener noreferrer"
              >
                <i class="bi bi-box-arrow-up-right"></i>
                <span>Wallhaven</span>
              </a>
            </div>

            <div class="wallpaper-detail__facts">
              <div v-for="item in detailStats" :key="item.label">
                <strong>{{ item.value }}</strong>
                <span>{{ item.label }}</span>
              </div>
            </div>

            <section v-if="wallpaperColors.length" class="wallpaper-detail__section">
              <h2>颜色</h2>
              <div class="wallpaper-detail__colors">
                <button
                  v-for="color in wallpaperColors"
                  :key="color"
                  type="button"
                  class="wallpaper-detail__color"
                  :title="`#${color}`"
                  :style="{ backgroundColor: `#${color}` }"
                >
                  <span class="visually-hidden">#{{ color }}</span>
                </button>
              </div>
            </section>

            <section v-if="wallpaperTags.length" class="wallpaper-detail__section">
              <h2>标签</h2>
              <div class="wallpaper-detail__tags">
                <button
                  v-for="tag in wallpaperTags"
                  :key="tag.id || tag.name"
                  type="button"
                  class="wallpaper-detail__tag"
                  @click="searchTag(tag.name)"
                >
                  {{ tag.name }}
                </button>
              </div>
            </section>
          </div>
        </aside>
      </section>

      <section class="wallpaper-detail__related">
        <div class="wallpaper-detail__related-head">
          <div>
            <em>Related</em>
            <h2>相关壁纸</h2>
          </div>
          <p>{{ relatedSummary }}</p>
        </div>

        <div v-if="isLoadingRelated && !relatedWallpapers.length" class="wallpaper-detail__related-state">
          <div class="spinner-border spinner-border-sm" role="status">
            <span class="visually-hidden">加载中...</span>
          </div>
          <span>加载相关壁纸中...</span>
        </div>

        <div v-else-if="relatedWallpapers.length" class="wallpaper-detail__related-grid">
          <button
            v-for="relatedWallpaper in relatedWallpapers"
            :key="relatedWallpaper.id"
            type="button"
            class="wallpaper-detail__related-card"
            @click="viewRelatedWallpaper(relatedWallpaper)"
          >
            <img
              :src="relatedImageSrc(relatedWallpaper)"
              :alt="relatedWallpaper.id"
              referrerpolicy="no-referrer"
              :crossorigin="getImageCrossorigin(relatedImageSrc(relatedWallpaper))"
              loading="lazy"
              @load="handleRelatedImageLoad"
            />
            <span>
              <strong>{{ relatedWallpaper.resolution }}</strong>
              <small>{{ relatedWallpaper.id }}</small>
            </span>
          </button>
        </div>

        <div v-else class="wallpaper-detail__related-state">暂无可展示的相关壁纸</div>

        <div v-if="relatedWallpapers.length >= 8" class="wallpaper-detail__related-actions">
          <button
            type="button"
            class="wallpaper-detail__btn is-primary"
            :disabled="isLoadingRelated || !hasMoreRelated"
            @click="loadMoreRelatedWallpapers"
          >
            <i class="bi" :class="isLoadingRelated ? 'bi-hourglass' : 'bi-arrow-repeat'"></i>
            {{ isLoadingRelated ? '加载中' : hasMoreRelated ? '加载更多' : '没有更多' }}
          </button>
        </div>
      </section>
    </main>

    <WallpaperPreview
      v-if="isPreviewEnabled"
      :wallpaper="wallpaper"
      :show="showPreview"
      :enabled-actions="previewEnabledActions"
      @close="closePreview"
    />
  </div>
</template>

<style scoped>
.wallpaper-detail {
  --wd-ink: #18203b;
  --wd-muted: #79809a;
  --wd-accent: #6a4fe0;
  --wd-active: #151a2d;
  --wd-ease: cubic-bezier(0.22, 0.8, 0.24, 1);
  --wd-copy-ink: #151a2d;
  position: relative;
  isolation: isolate;
  width: 100%;
  min-height: calc(100vh - var(--app-header-offset, 82px));
  padding: clamp(18px, 2.4vw, 36px) clamp(16px, 3.5vw, 56px) 40px;
  color: var(--wd-ink);
  background:
    radial-gradient(circle at 12% 0%, rgba(160, 139, 255, 0.14), transparent 24%),
    radial-gradient(circle at 86% 4%, rgba(191, 203, 255, 0.14), transparent 28%),
    linear-gradient(180deg, #f7f7ff 0%, #fff 46%, #fafaff 100%);
  box-sizing: border-box;
}

.wallpaper-detail__atmosphere {
  pointer-events: none;
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: min(56vh, 620px);
  background:
    radial-gradient(ellipse 42% 48% at 68% 22%, rgba(133, 104, 247, 0.12), transparent 70%),
    radial-gradient(ellipse 28% 34% at 14% 40%, rgba(168, 186, 255, 0.1), transparent 72%);
  mask-image: linear-gradient(180deg, #000 36%, transparent);
}

.wallpaper-detail__shell,
.wallpaper-detail__state {
  position: relative;
  z-index: 1;
  width: min(1540px, 100%);
  margin: 0 auto;
}

.wallpaper-detail__state {
  min-height: 52vh;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 14px;
  color: var(--wd-muted);
}

.wallpaper-detail__state.is-error {
  color: #c45d70;
}

.wallpaper-detail__state .bi {
  font-size: 2rem;
}

.wallpaper-detail__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.28fr) minmax(320px, 0.78fr);
  gap: clamp(18px, 2.2vw, 28px);
  align-items: start;
}

.wallpaper-detail__media {
  min-width: 0;
}

.wallpaper-preview-container {
  position: relative;
  overflow: hidden;
  min-height: clamp(360px, 62vh, 780px);
  background: #12141f;
  box-shadow:
    0 0 0 1px rgba(21, 26, 45, 0.08),
    8px 8px 0 rgba(106, 79, 224, 0.18);
}

.wallpaper-detail__blur {
  position: absolute;
  inset: -24px;
  z-index: 0;
  background-position: center;
  background-size: cover;
  filter: blur(28px) saturate(1.15) brightness(0.55);
  transform: scale(1.08);
}

.hero-lqip,
.mosaic-overlay,
.reveal-sweep,
.wallpaper-detail__frame,
.wallpaper-detail__mark {
  position: absolute;
  pointer-events: none;
}

.hero-lqip {
  inset: 0;
  z-index: 0;
  opacity: 0.35;
}

.hero-image-wrap {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: clamp(360px, 62vh, 780px);
}

.wallpaper-preview {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: min(78vh, 860px);
  object-fit: contain;
  display: block;
  cursor: zoom-in;
  transition:
    transform 0.28s var(--wd-ease),
    opacity 0.28s ease;
}

.wallpaper-detail__frame {
  inset: 14px;
  z-index: 3;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.wallpaper-detail__mark {
  z-index: 3;
  left: 24px;
  bottom: 22px;
  color: rgba(255, 255, 255, 0.42);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.mosaic-overlay {
  inset: 0;
  z-index: 2;
  display: grid;
}

.mosaic-tile {
  background: linear-gradient(135deg, rgba(48, 52, 64, 0.96), rgba(110, 120, 150, 0.42));
  animation: walleven-mosaic-fade 0.52s ease forwards;
}

.reveal-sweep {
  inset: 0;
  z-index: 2;
}

.wallpaper-preview-container.reveal-enabled:not(.reveal-soft) .wallpaper-preview {
  opacity: 0;
}

.wallpaper-preview-container.reveal-enabled:not(.reveal-soft) .wallpaper-preview.is-loaded {
  opacity: 1;
}

.wallpaper-preview-container.reveal-soft.reveal-enabled:not(.reveal-off) .wallpaper-preview {
  opacity: 0;
  transform: scale(var(--reveal-scale-from, 1.015));
  transition-duration: var(--reveal-duration, 240ms), var(--reveal-duration, 240ms);
  transition-timing-function: cubic-bezier(0.22, 0.92, 0.25, 1), cubic-bezier(0.22, 0.92, 0.25, 1);
}

.wallpaper-preview-container.reveal-soft.reveal-enabled:not(.reveal-off)
  .wallpaper-preview.is-loaded {
  opacity: 1;
  transform: scale(1);
}

.wallpaper-preview-container.reveal-off .wallpaper-preview,
.wallpaper-preview-container.reveal-soft.reveal-off .wallpaper-preview {
  opacity: 1;
  transform: none;
}

:global(html.settings-no-animations)
  .wallpaper-preview-container.reveal-soft.reveal-enabled:not(.reveal-off)
  .wallpaper-preview {
  transition-duration: 0.22s !important, 0.22s !important;
}

.wallpaper-detail__status {
  margin-top: 12px;
  font-size: 0.82rem;
}

.wallpaper-detail__status .is-ok,
.wallpaper-detail__status .is-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wallpaper-detail__status .is-ok {
  color: #2f9d63;
}

.wallpaper-detail__status .is-error {
  color: #c45d70;
}

.wallpaper-detail__side {
  position: sticky;
  top: calc(var(--app-header-offset, 82px) + 12px);
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  padding: 4px 0;
}

.wallpaper-detail__spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  color: rgba(21, 26, 45, 0.38);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.wallpaper-detail__spine i {
  flex: 1;
  width: 1px;
  margin: 12px 0;
  background: linear-gradient(180deg, transparent, rgba(106, 79, 224, 0.55), transparent);
}

.wallpaper-detail__spine em {
  font-style: normal;
  color: var(--wd-accent);
}

.wallpaper-detail__panel {
  min-width: 0;
  display: grid;
  gap: 18px;
  padding: 18px 18px 20px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow:
    inset 0 0 0 1px rgba(21, 26, 45, 0.08),
    6px 6px 0 rgba(106, 79, 224, 0.14);
}

.wallpaper-detail__heading {
  display: grid;
  gap: 10px;
}

.wallpaper-detail__eyebrow {
  color: var(--wd-accent);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.wallpaper-detail__heading h1 {
  margin: 0;
  color: var(--wd-copy-ink);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(1.7rem, 2.6vw, 2.35rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.1;
  word-break: break-all;
}

.wallpaper-detail__uploader {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  width: max-content;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.wallpaper-detail__uploader > span {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--wd-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.65);
  font-family: 'Songti SC', 'Noto Serif SC', serif;
  font-size: 1rem;
  font-weight: 700;
}

.wallpaper-detail__uploader > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.wallpaper-detail__uploader strong {
  color: var(--wd-copy-ink);
  font-size: 0.92rem;
  font-weight: 750;
}

.wallpaper-detail__uploader small {
  color: var(--wd-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.wallpaper-detail__uploader:hover strong {
  color: var(--wd-accent);
}

.wallpaper-detail__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.wallpaper-detail__btn {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  color: var(--wd-ink);
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
  font-size: 0.82rem;
  font-weight: 720;
  letter-spacing: 0.03em;
  text-decoration: none;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.wallpaper-detail__btn:hover:not(:disabled) {
  color: var(--wd-accent);
  background: rgba(106, 79, 224, 0.06);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.35);
}

.wallpaper-detail__btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wallpaper-detail__btn.is-primary {
  color: #fff;
  background: var(--wd-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.wallpaper-detail__btn.is-primary:hover:not(:disabled) {
  color: #fff;
  background: #1f2740;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.85);
  transform: translate(-1px, -1px);
}

.wallpaper-detail__btn.is-favorite.is-active {
  color: #fff;
  background: #c45d70;
  box-shadow: 3px 3px 0 rgba(196, 93, 112, 0.4);
}

.wallpaper-detail__btn.is-external {
  grid-column: 1 / -1;
}

.wallpaper-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  padding: 14px 0;
  border-top: 1px solid rgba(21, 26, 45, 0.1);
  border-bottom: 1px solid rgba(21, 26, 45, 0.1);
}

.wallpaper-detail__facts div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.wallpaper-detail__facts strong {
  color: var(--wd-copy-ink);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.wallpaper-detail__facts span {
  color: var(--wd-muted);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.wallpaper-detail__section {
  display: grid;
  gap: 10px;
}

.wallpaper-detail__section h2 {
  margin: 0;
  color: var(--wd-copy-ink);
  font-family: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.wallpaper-detail__colors,
.wallpaper-detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wallpaper-detail__color {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.16);
  cursor: default;
}

.wallpaper-detail__tag {
  height: 30px;
  padding: 0 10px;
  border: 0;
  color: #5a6178;
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
  font-size: 0.76rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.wallpaper-detail__tag:hover {
  color: #fff;
  background: #151a2d;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.55);
}

.wallpaper-detail__related {
  margin-top: 28px;
  padding-top: 8px;
}

.wallpaper-detail__related-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(21, 26, 45, 0.1);
}

.wallpaper-detail__related-head em {
  display: block;
  color: var(--wd-muted);
  font-style: normal;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.64rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.wallpaper-detail__related-head h2 {
  margin: 4px 0 0;
  color: var(--wd-copy-ink);
  font-family: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  font-size: clamp(1.2rem, 2vw, 1.55rem);
  font-weight: 700;
  letter-spacing: 0.12em;
}

.wallpaper-detail__related-head p {
  margin: 0;
  color: var(--wd-muted);
  font-size: 0.84rem;
}

.wallpaper-detail__related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.wallpaper-detail__related-card {
  position: relative;
  aspect-ratio: 16 / 10;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: rgba(21, 26, 45, 0.06);
  box-shadow:
    inset 0 0 0 1px rgba(21, 26, 45, 0.1),
    3px 3px 0 rgba(106, 79, 224, 0.22);
  cursor: pointer;
  text-align: left;
}

.wallpaper-detail__related-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.45s var(--wd-ease);
}

.wallpaper-detail__related-card:hover img {
  transform: scale(1.035);
}

.wallpaper-detail__related-card > span {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 18px 10px 8px;
  color: #fff;
  font-size: 0.72rem;
  background: linear-gradient(to top, rgba(8, 10, 18, 0.72), transparent);
}

.wallpaper-detail__related-card strong,
.wallpaper-detail__related-card small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wallpaper-detail__related-state,
.wallpaper-detail__related-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 120px;
  color: var(--wd-muted);
}

.wallpaper-detail__related-actions {
  min-height: auto;
  margin-top: 18px;
}

@media (max-width: 1100px) {
  .wallpaper-detail__hero {
    grid-template-columns: 1fr;
  }

  .wallpaper-detail__side {
    position: relative;
    top: auto;
  }

  .wallpaper-detail__actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .wallpaper-detail__btn.is-external {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .wallpaper-detail {
    padding: 14px 12px 28px;
  }

  .wallpaper-detail__spine {
    display: none;
  }

  .wallpaper-detail__side {
    grid-template-columns: 1fr;
  }

  .wallpaper-detail__actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wallpaper-detail__btn.is-external {
    grid-column: 1 / -1;
  }

  .wallpaper-detail__facts {
    grid-template-columns: 1fr;
  }

  .wallpaper-detail__related-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .wallpaper-detail__related-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail {
  --wd-ink: #e8e9f2;
  --wd-muted: #9aa1b8;
  --wd-accent: #cfc7ff;
  --wd-active: #cfc7ff;
  --wd-copy-ink: #f0f1f8;
  color: var(--wd-ink);
  background:
    radial-gradient(circle at 12% 0%, rgba(106, 79, 224, 0.18), transparent 26%),
    radial-gradient(circle at 86% 4%, rgba(88, 110, 180, 0.12), transparent 30%),
    linear-gradient(180deg, #0d0f18 0%, #12141f 48%, #0f111a 100%);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__atmosphere {
  background:
    radial-gradient(ellipse 42% 48% at 68% 22%, rgba(133, 104, 247, 0.16), transparent 70%),
    radial-gradient(ellipse 28% 34% at 14% 40%, rgba(120, 140, 220, 0.1), transparent 72%);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-preview-container {
  box-shadow:
    0 0 0 1px rgba(207, 199, 255, 0.1),
    8px 8px 0 rgba(106, 79, 224, 0.28);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__spine {
  color: rgba(232, 233, 242, 0.38);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__panel {
  background: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px rgba(232, 233, 242, 0.1),
    6px 6px 0 rgba(106, 79, 224, 0.22);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__uploader > span {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__btn {
  box-shadow: inset 0 0 0 1px rgba(232, 233, 242, 0.14);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__btn.is-primary {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__btn.is-primary:hover:not(:disabled) {
  color: #151a2d;
  background: #ddd7ff;
  box-shadow: 4px 4px 0 rgba(133, 104, 247, 0.55);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__btn.is-favorite.is-active {
  color: #151a2d;
  background: #f0a0ac;
  box-shadow: 3px 3px 0 rgba(196, 93, 112, 0.35);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__facts,
html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__related-head {
  border-color: rgba(232, 233, 242, 0.1);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__tag {
  color: #b8bdd0;
  box-shadow: inset 0 0 0 1px rgba(232, 233, 242, 0.14);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__tag:hover {
  color: #151a2d;
  background: #cfc7ff;
  box-shadow: 3px 3px 0 rgba(133, 104, 247, 0.45);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__related-card {
  background: rgba(255, 255, 255, 0.04);
  box-shadow:
    inset 0 0 0 1px rgba(232, 233, 242, 0.1),
    3px 3px 0 rgba(106, 79, 224, 0.28);
}

html.color-scheme-dark.wallpaper-detail-page .wallpaper-detail__color {
  box-shadow: inset 0 0 0 1px rgba(232, 233, 242, 0.18);
}
</style>
