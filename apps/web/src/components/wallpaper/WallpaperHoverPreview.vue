<script setup>
import { proxyWallhavenImageUrl } from '@/services/api'
import { getImageCrossorigin, markLoadedImageUrl } from '@/utils/imageRequest'
import { onMounted, onUnmounted, ref } from 'vue'

// 预览状态
const isVisible = ref(false)
const previewImage = ref('')
const previewResolution = ref('')
const previewRatio = ref('')
const position = ref({ x: 0, y: 0 })
const currentWallpaperId = ref(null)
const isImageLoading = ref(true)
const hasImageError = ref(false)
let preloadToken = 0

// 图片缓存
const imageCache = new Map()

// 预览容器引用
const previewContainer = ref(null)
const previewImageRef = ref(null)

// 处理图片加载成功
function handleImageLoad() {
  markLoadedImageUrl(previewImage.value)
  isImageLoading.value = false
  hasImageError.value = false
}

// 显示悬停预览：只使用搜索列表里的 thumbs.original
async function showPreview(wallpaper, event) {
  if (!wallpaper || !wallpaper.id) return

  // 重置状态
  const token = ++preloadToken
  isImageLoading.value = true
  hasImageError.value = false

  currentWallpaperId.value = wallpaper.id
  previewResolution.value = wallpaper.resolution || '未知'

  // 计算宽高比
  if (wallpaper.resolution) {
    const [width, height] = wallpaper.resolution.split('x').map(Number)
    if (width && height) {
      const ratio = (width / height).toFixed(2)
      previewRatio.value = `${ratio}:1`
    } else {
      previewRatio.value = '未知'
    }
  } else {
    previewRatio.value = '未知'
  }

  // 更新位置
  updatePosition(event)

  const originalThumbUrl =
    typeof wallpaper.thumbs?.original === 'string' ? wallpaper.thumbs.original : ''
  if (!originalThumbUrl) {
    hidePreview()
    return
  }

  // 显示预览
  isVisible.value = true

  if (imageCache.has(wallpaper.id)) {
    previewImage.value = imageCache.get(wallpaper.id)
    return
  }

  const displayUrl = proxyWallhavenImageUrl(originalThumbUrl)
  previewImage.value = displayUrl
  imageCache.set(wallpaper.id, displayUrl)
}

// 隐藏预览
function hidePreview() {
  preloadToken += 1
  isVisible.value = false
  currentWallpaperId.value = null
  isImageLoading.value = true
  hasImageError.value = false
  previewImage.value = ''
}

// 更新预览位置
function updatePosition(event) {
  if (!event) return

  const x = event.clientX
  const y = event.clientY

  // 获取窗口尺寸
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight

  // 预览容器尺寸 - 根据图片比例动态调整
  let previewWidth = 400
  let previewHeight = 400

  // 如果有分辨率信息，计算合适的预览尺寸
  if (previewResolution.value && previewResolution.value !== '未知') {
    try {
      const [width, height] = previewResolution.value.split('x').map(Number)
      if (width && height) {
        // 保持原始比例，但限制最大尺寸
        const ratio = width / height
        if (ratio > 1) {
          // 横向图片
          previewHeight = Math.min(400, previewWidth / ratio)
        } else {
          // 纵向图片
          previewWidth = Math.min(400, previewHeight * ratio)
        }
      }
    } catch (e) {
      // 解析失败，使用默认尺寸
      console.error('解析分辨率失败:', e)
    }
  }

  // 计算位置，确保预览不超出窗口
  let posX = x + 20 // 默认在鼠标右侧20px处
  let posY = y - previewHeight / 2 // 默认在鼠标中心对齐

  // 如果预览会超出右侧边界，则显示在鼠标左侧
  if (posX + previewWidth > windowWidth) {
    posX = x - previewWidth - 20
  }

  // 如果预览会超出底部边界，则调整垂直位置
  if (posY + previewHeight > windowHeight) {
    posY = windowHeight - previewHeight - 10
  }

  // 如果预览会超出顶部边界，则调整垂直位置
  if (posY < 10) {
    posY = 10
  }

  // 更新位置和尺寸
  position.value = {
    x: posX,
    y: posY,
    width: previewWidth,
    height: previewHeight,
  }
}

// 监听全局点击事件，隐藏预览
function handleGlobalClick() {
  hidePreview()
}

// 监听全局滚动事件，隐藏预览
function handleGlobalScroll() {
  hidePreview()
}

// 组件挂载时添加全局事件监听
onMounted(() => {
  window.addEventListener('click', handleGlobalClick)
  window.addEventListener('scroll', handleGlobalScroll)
})

// 组件卸载时移除全局事件监听
onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('scroll', handleGlobalScroll)
})

// 暴露方法给父组件
defineExpose({
  showPreview,
  hidePreview,
  updatePosition,
})
</script>

<template>
  <div
    ref="previewContainer"
    class="wallpaper-hover-preview"
    :class="{
      show: isVisible,
      loading: isImageLoading,
      error: hasImageError,
    }"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: position.width ? `${position.width}px` : '400px',
      height: position.height ? `${position.height}px` : '400px',
    }"
  >
    <!-- 加载指示器 -->
    <div class="preview-loading" v-if="isImageLoading">
      <div class="spinner-border text-light" role="status">
        <span class="visually-hidden">加载中...</span>
      </div>
    </div>

    <!-- 错误提示 -->
    <div class="preview-error" v-if="hasImageError">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span>图片加载失败</span>
    </div>

    <!-- 预览图片 -->
    <img
      :src="previewImage"
      referrerpolicy="no-referrer"
      :crossorigin="getImageCrossorigin(previewImage)"
      :alt="previewImage"
      class="preview-image"
      @load="handleImageLoad"
      ref="previewImageRef"
      :class="{ loading: isImageLoading, error: hasImageError }"
    />

    <!-- 图片信息 -->
    <div class="preview-info" v-if="isVisible && !isImageLoading">
      <span class="preview-resolution">{{ previewResolution }}</span>
      <span class="preview-ratio">{{ previewRatio }}</span>
    </div>
  </div>
</template>

<style scoped>
.wallpaper-hover-preview {
  position: fixed;
  z-index: 9999;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease,
    box-shadow 0.3s ease;
  pointer-events: none;
  background: #151a2d;
  border-radius: 0;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.65);
  border: 1px solid rgba(240, 236, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wallpaper-hover-preview.show {
  opacity: 1;
  visibility: visible;
  animation: preview-appear 0.3s ease forwards;
}

@keyframes preview-appear {
  from {
    transform: translate(2px, 2px);
  }
  to {
    transform: translate(0, 0);
  }
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: transform 0.3s ease;
  border-radius: 0;
  filter: none;
  z-index: 2;
}

/* 加载指示器 */
.preview-loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  background-color: rgba(21, 26, 45, 0.72);
}

.spinner-border {
  width: 2.2rem;
  height: 2.2rem;
  border-width: 0.2rem;
  border-radius: 0;
  color: #f0ecff;
}

/* 错误提示 */
.preview-error {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1;
  background-color: rgba(21, 26, 45, 0.88);
  color: #ff8f9a;
  font-size: 0.92rem;
}

.preview-error i {
  font-size: 1.6rem;
  margin-bottom: 10px;
}

/* 图片状态样式 */
.preview-image.loading {
  opacity: 0.5;
}

.preview-image.error {
  opacity: 0.3;
  filter: grayscale(100%);
}

/* 图片信息 */
.preview-info {
  position: absolute;
  bottom: 10px;
  left: 10px;
  right: 10px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  background-color: rgba(247, 247, 255, 0.94);
  padding: 6px 8px;
  border-radius: 0;
  color: #18203b;
  font-size: 0.78rem;
  font-weight: 700;
  z-index: 3;
  box-shadow:
    inset 0 0 0 1px rgba(21, 26, 45, 0.12),
    2px 2px 0 rgba(106, 79, 224, 0.55);
}

.preview-resolution,
.preview-ratio {
  padding: 2px 6px;
  background-color: transparent;
  border-radius: 0;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
}

:global(html.color-scheme-dark) .wallpaper-hover-preview {
  background: #0d0f18;
  border-color: rgba(160, 139, 255, 0.35);
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.45);
}

:global(html.color-scheme-dark) .preview-info {
  background-color: rgba(22, 24, 36, 0.96);
  color: #e8eaf4;
  box-shadow:
    inset 0 0 0 1px rgba(160, 139, 255, 0.28),
    2px 2px 0 rgba(106, 79, 224, 0.4);
}

:global(html.color-scheme-dark) .preview-resolution,
:global(html.color-scheme-dark) .preview-ratio {
  box-shadow: inset 0 0 0 1px rgba(160, 139, 255, 0.22);
}
</style>
