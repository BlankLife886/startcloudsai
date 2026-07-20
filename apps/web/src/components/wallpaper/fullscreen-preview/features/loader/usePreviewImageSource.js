import { ref } from 'vue'

import {
  buildPreviewFullUrls,
  getProxiedPreviewUrl,
} from '@/components/wallpaper/fullscreen-preview/features/loader/previewImageCandidates'
import { loadCanvasSafeImageFromSrc } from '@/components/wallpaper/fullscreen-preview/composables/useCanvasSafeImage'
import {
  loadPreviewBlobUrl,
  readPreviewBlobCacheConfig,
  readPreviewSource,
  rememberPreviewSource,
} from '@/components/wallpaper/fullscreen-preview/features/loader/previewBlobCache'
import { wallpaperApi } from '@/services/api'
import { hasLoadedImageUrl, markLoadedImageUrl } from '@/utils/imageRequest'

function normalizePreviewCacheKey(id) {
  return String(id || '').trim()
}

// 全屏预览只加载 full 原图；缩略图回退会降低清晰度，因此不参与这个流程。
export function usePreviewImageSource() {
  const isLoading = ref(false)
  const error = ref(null)
  const imageUrl = ref('')
  const previewImageUrl = ref('')
  const sourceFullUrl = ref('')
  const imageInfo = ref(null)
  const activeLoadToken = ref(0)
  const sourceImageElement = ref(null)
  const transientBlobUrl = ref('')
  let loadSequence = 0

  function releaseTransientBlobUrl() {
    const url = transientBlobUrl.value
    if (!url?.startsWith?.('blob:')) return
    try {
      URL.revokeObjectURL(url)
    } catch {
      // 临时 blob 释放失败时交给浏览器回收。
    }
    transientBlobUrl.value = ''
  }

  function applyFullImageUrl(url) {
    const nextUrl = getProxiedPreviewUrl(url)
    if (!nextUrl) return
    if (imageUrl.value === nextUrl && previewImageUrl.value === nextUrl) return
    imageUrl.value = nextUrl
    previewImageUrl.value = nextUrl
  }

  function hasDetailedWallpaperInfo(wallpaper) {
    // 详情页通常已带标签等完整元数据；列表页只带基础字段时，信息面板再懒加载详情。
    return Array.isArray(wallpaper?.tags) && wallpaper.tags.length > 0
  }

  async function loadImageElementFromUrl(url) {
    return await loadCanvasSafeImageFromSrc(url)
  }

  async function loadImage(wallpaper) {
    if (!wallpaper || !wallpaper.id) return

    const cacheKey = normalizePreviewCacheKey(wallpaper.id)
    const cachedSource = readPreviewSource(cacheKey)
    const initialFullUrl = buildPreviewFullUrls(wallpaper)[0]
    const initialSafeUrl = getProxiedPreviewUrl(initialFullUrl)

    if (cachedSource?.blobUrl && cachedSource.fullUrl === initialSafeUrl) {
      sourceFullUrl.value = cachedSource.fullUrl
      applyFullImageUrl(cachedSource.blobUrl)
      imageInfo.value =
        cachedSource.imageInfo || (hasDetailedWallpaperInfo(wallpaper) ? wallpaper : null)
      isLoading.value = !hasLoadedImageUrl(cachedSource.blobUrl)
      error.value = null
      return
    }

    // 用单调递增 token 防止首次打开/快速切图时，旧请求回包覆盖当前图片。
    const loadToken = ++loadSequence
    activeLoadToken.value = loadToken
    isLoading.value = true
    error.value = null

    let sourceUrl = initialSafeUrl || cachedSource?.fullUrl || ''
    let nextImageInfo =
      cachedSource?.imageInfo || (hasDetailedWallpaperInfo(wallpaper) ? wallpaper : null)

    try {
      if (!sourceUrl) {
        const response = await wallpaperApi.getImage(wallpaper.id)
        if (activeLoadToken.value !== loadToken) return

        if (response.success && response.image) {
          nextImageInfo = response.image
          imageInfo.value = response.image
          const fullUrl = buildPreviewFullUrls(wallpaper, response.image)[0]
          sourceUrl = getProxiedPreviewUrl(fullUrl)
        } else {
          error.value = response?.error || '加载 full 原图失败'
          isLoading.value = false
          return
        }
      }

      if (!sourceUrl) {
        error.value = '没有可用的 full 原图地址'
        isLoading.value = false
        return
      }

      // 缓存关闭时只保留当前正在浏览的这一张临时 blob；切换下一张前先释放上一张。
      if (!readPreviewBlobCacheConfig().enabled) {
        releaseTransientBlobUrl()
      }

      const blobUrl = await loadPreviewBlobUrl(sourceUrl, cacheKey, nextImageInfo)
      if (activeLoadToken.value !== loadToken) {
        // 快速切图时旧请求可能晚到，未接管展示的临时 blob 要立刻释放。
        if (blobUrl?.startsWith?.('blob:') && blobUrl !== transientBlobUrl.value) {
          URL.revokeObjectURL(blobUrl)
        }
        return
      }
      if (!blobUrl) {
        error.value = '加载 full 原图失败，请稍后重试'
        isLoading.value = false
        return
      }

      sourceFullUrl.value = sourceUrl
      if (!readPreviewBlobCacheConfig().enabled) {
        transientBlobUrl.value = blobUrl
      }
      applyFullImageUrl(blobUrl)
      imageInfo.value = nextImageInfo
      error.value = null
    } catch (err) {
      console.error('加载图片失败:', err)
      if (activeLoadToken.value !== loadToken) return
      error.value = '加载 full 原图失败，请稍后重试'
    } finally {
      if (activeLoadToken.value === loadToken) {
        if (imageUrl.value && hasLoadedImageUrl(imageUrl.value)) {
          isLoading.value = false
        }
      }
    }
  }

  async function loadImageInfo(id) {
    if (imageInfo.value && String(imageInfo.value.id || '') === String(id || '')) return
    const cachedSource = readPreviewSource(id)
    if (cachedSource?.imageInfo) {
      imageInfo.value = cachedSource.imageInfo
      return
    }
    try {
      const response = await wallpaperApi.getWallpaperDetails(id)
      if (response?.success && response.image) {
        imageInfo.value = response.image
        const cached = readPreviewSource(id) || {}
        rememberPreviewSource(id, {
          ...cached,
          imageInfo: response.image,
          fullUrl: cached.fullUrl || imageUrl.value || '',
          blobUrl: cached.blobUrl || '',
          blobSize: cached.blobSize || 0,
        })
      }
    } catch (err) {
      console.error('加载图片详情失败:', err)
    }
  }

  function handleImageError() {
    isLoading.value = false
    error.value = 'full 原图加载失败，请按 L 键或点击重试'
  }

  function markImageLoaded(url) {
    markLoadedImageUrl(url || imageUrl.value)
  }

  function retryLoadCurrentImage() {
    if (!imageUrl.value) return
    isLoading.value = true
    error.value = null
    const current = imageUrl.value
    imageUrl.value = ''
    previewImageUrl.value = ''
    requestAnimationFrame(() => {
      imageUrl.value = current
      previewImageUrl.value = current
    })
  }

  function resetImageSourceState() {
    error.value = null
    imageInfo.value = null
    activeLoadToken.value = 0
    sourceImageElement.value = null
    releaseTransientBlobUrl()
    imageUrl.value = ''
    previewImageUrl.value = ''
    sourceFullUrl.value = ''
    isLoading.value = false
  }

  return {
    isLoading,
    error,
    imageUrl,
    previewImageUrl,
    sourceFullUrl,
    imageInfo,
    sourceImageElement,
    loadImageElementFromUrl,
    loadImage,
    loadImageInfo,
    handleImageError,
    markImageLoaded,
    retryLoadCurrentImage,
    resetImageSourceState,
  }
}
