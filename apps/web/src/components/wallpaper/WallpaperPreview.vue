<script setup>
import { wallpaperApi } from '@/services/api'
import { webDebugLog } from '@/services/debugLog'
import { useFavoritesStore } from '@/stores/favorites'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

// 定义props
const props = defineProps({
  wallpaper: {
    type: Object,
    required: false,
    default: null,
  },
  show: {
    type: Boolean,
    default: false,
  },
})

// 定义事件
const emit = defineEmits(['close', 'error'])

// 获取收藏store
const favoritesStore = useFavoritesStore()

// 本地状态
const isFullscreen = ref(false)
const isZoomed = ref(false)
const isLoading = ref(true)
const dragStartX = ref(0)
const dragStartY = ref(0)
const offsetX = ref(0)
const offsetY = ref(0)
const isDragging = ref(false)

// 计算属性
const isFavorited = computed(() =>
  props.wallpaper ? favoritesStore.isFavorited(props.wallpaper.id) : false,
)

// 关闭预览
function closePreview() {
  isZoomed.value = false
  isFullscreen.value = false
  offsetX.value = 0
  offsetY.value = 0
  emit('close')
}

// 切换全屏
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.error(`全屏错误: ${err.message}`)
    })
    isFullscreen.value = true
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen()
      isFullscreen.value = false
    }
  }
}

// 切换缩放
function toggleZoom() {
  isZoomed.value = !isZoomed.value
  if (!isZoomed.value) {
    // 重置偏移
    offsetX.value = 0
    offsetY.value = 0
  }
}

// 切换收藏
function toggleFavorite() {
  if (!props.wallpaper) return

  if (isFavorited.value) {
    favoritesStore.removeFavorite(props.wallpaper.id)
  } else {
    favoritesStore.addFavorite(props.wallpaper)
  }
}

// 图片加载完成
function handleImageLoaded() {
  isLoading.value = false
}

// 图片加载错误
async function handleImageError(event) {
  console.error('预览图片加载失败:', event)

  const img = event.target
  const currentSrc = img.src

  webDebugLog('wallpaper', '当前预览图片URL:', currentSrc)

  // 如果没有壁纸数据，通知父组件处理错误
  if (!props.wallpaper || !props.wallpaper.id) {
    console.error('预览图片壁纸数据不完整')
    emit('error', event)
    return
  }

  const id = props.wallpaper.id

  try {
    const response = await wallpaperApi.getWallpaperDetails(id)
    const fallbackUrl = response?.image?.path || response?.image?.url

    if (response?.success && fallbackUrl && fallbackUrl !== currentSrc) {
      img.src = fallbackUrl
      return
    }

    console.error('远端接口未返回有效的预览图片URL，通知父组件处理错误')
    emit('error', event)
  } catch (error) {
    console.error('从远端接口获取图片详情失败:', error)
    emit('error', event)
  }
}

// 开始拖动
function startDrag(event) {
  if (!isZoomed.value) return

  isDragging.value = true
  dragStartX.value = event.clientX || (event.touches && event.touches[0].clientX)
  dragStartY.value = event.clientY || (event.touches && event.touches[0].clientY)

  // 阻止默认行为和事件冒泡
  event.preventDefault()
  event.stopPropagation()
}

// 拖动中
function drag(event) {
  if (!isDragging.value) return

  const clientX = event.clientX || (event.touches && event.touches[0].clientX)
  const clientY = event.clientY || (event.touches && event.touches[0].clientY)

  const deltaX = clientX - dragStartX.value
  const deltaY = clientY - dragStartY.value

  offsetX.value += deltaX
  offsetY.value += deltaY

  dragStartX.value = clientX
  dragStartY.value = clientY

  // 阻止默认行为和事件冒泡
  event.preventDefault()
  event.stopPropagation()
}

// 结束拖动
function endDrag() {
  isDragging.value = false
}

// 监听全屏变化
function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

// 组件挂载时添加事件监听
onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

// 组件卸载时移除事件监听
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
})

// 监听show属性变化
watch(
  () => props.show,
  (newValue) => {
    if (newValue) {
      isLoading.value = true
    } else {
      isZoomed.value = false
      offsetX.value = 0
      offsetY.value = 0
    }
  },
)
</script>

<template>
  <div class="wallpaper-preview" v-if="show">
    <div class="preview-overlay" @click="closePreview"></div>

    <div class="preview-container">
      <!-- 加载指示器 -->
      <div class="loading-indicator" v-if="isLoading">
        <div class="spinner-border text-light" role="status">
          <span class="visually-hidden">加载中...</span>
        </div>
      </div>

      <!-- 壁纸图片 -->
      <img
        v-if="wallpaper"
        :src="wallpaper.path || wallpaper.url"
        :alt="wallpaper.id"
        class="preview-image"
        :class="{ zoomed: isZoomed }"
        :style="{ transform: isZoomed ? `translate(${offsetX}px, ${offsetY}px)` : 'none' }"
        @load="handleImageLoaded"
        @error="handleImageError"
        @click="toggleZoom"
        @mousedown="startDrag"
        @mousemove="drag"
        @mouseup="endDrag"
        @mouseleave="endDrag"
        @touchstart="startDrag"
        @touchmove="drag"
        @touchend="endDrag"
      />

      <!-- 控制按钮 -->
      <div class="preview-controls">
        <!-- 收藏按钮 -->
        <button
          class="btn control-btn"
          @click.stop="toggleFavorite"
          :class="{ active: isFavorited }"
        >
          <i class="bi" :class="isFavorited ? 'bi-heart-fill' : 'bi-heart'"></i>
        </button>

        <!-- 全屏按钮 -->
        <button
          class="btn control-btn"
          @click.stop="toggleFullscreen"
          :class="{ active: isFullscreen }"
        >
          <i class="bi" :class="isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'"></i>
        </button>

        <!-- 关闭按钮 -->
        <button class="btn control-btn" @click.stop="closePreview">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wallpaper-preview {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.9);
}

.preview-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.loading-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  cursor: zoom-in;
  transition: transform 0.1s ease;
}

.preview-image.zoomed {
  max-width: none;
  max-height: none;
  cursor: grab;
}

.preview-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
  z-index: 2;
}

.control-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  transition: background-color 0.3s ease;
}

.control-btn:hover {
  background-color: rgba(0, 0, 0, 0.8);
}

.control-btn.active {
  background-color: var(--primary-color);
}
</style>
