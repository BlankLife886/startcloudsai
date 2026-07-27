<script setup>
// 主工具按钮只做布局和事件转发，按钮的业务语义由父层维持。
defineProps({
  showControls: { type: Boolean, default: true },
  isFullscreen: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  mockupMode: { type: String, default: 'none' },
  showMockupSettings: { type: Boolean, default: false },
  fitMode: { type: String, default: 'contain' },
  showFilters: { type: Boolean, default: false },
  activeFilter: { type: String, default: 'none' },
  activeArtStyle: { type: String, default: 'none' },
  comparisonMode: { type: String, default: 'none' },
  showInfo: { type: Boolean, default: false },
  cropMode: { type: Boolean, default: false },
  cropReady: { type: Boolean, default: false },
  showAiPanel: { type: Boolean, default: false },
  aiTitle: { type: String, default: '' },
  downloadStatus: { type: String, default: 'idle' },
  enabledActions: {
    type: Object,
    default: () => ({
      favorite: true,
      mockup: true,
      rotate: true,
      fit: true,
      info: true,
      compare: true,
      crop: true,
      decompose: true,
      filters: true,
      ai: true,
      download: true,
      fullscreen: true,
    }),
  },
})

const emit = defineEmits([
  'close',
  'toggle-fullscreen',
  'toggle-favorite',
  'toggle-desktop-mockup',
  'toggle-mockup-settings',
  'toggle-phone-mockup',
  'toggle-fit-mode',
  'open-download',
  'rotate',
  'toggle-filters',
  'toggle-compare',
  'toggle-info',
  'toggle-crop',
  'apply-crop',
  'cancel-crop',
  'decompose-image',
  'toggle-ai',
  'controls-enter',
  'controls-leave',
])
</script>

<template>
  <div
    class="preview-controls"
    :class="{ 'controls-visible': showControls }"
    @mouseenter="emit('controls-enter')"
    @mouseleave="emit('controls-leave')"
  >
    <button
      v-if="enabledActions.favorite !== false"
      type="button"
      class="preview-btn preview-favorite-btn"
      @click="emit('toggle-favorite')"
      title="收藏壁纸"
    >
      <i class="bi" :class="isFavorite ? 'bi-heart-fill' : 'bi-heart'"></i>
    </button>
    <button
      v-if="enabledActions.mockup !== false"
      type="button"
      class="preview-btn"
      :class="{ active: mockupMode === 'desktop' }"
      @click="emit('toggle-desktop-mockup')"
      title="桌面样机预览"
    >
      <i class="bi bi-display"></i>
    </button>
    <button
      v-if="enabledActions.mockup !== false && mockupMode === 'desktop'"
      type="button"
      class="preview-btn"
      :class="{ active: showMockupSettings }"
      @click="emit('toggle-mockup-settings')"
      title="样机配置"
    >
      <i class="bi bi-gear"></i>
    </button>
    <button
      v-if="enabledActions.mockup !== false"
      type="button"
      class="preview-btn"
      :class="{ active: mockupMode.startsWith('phone-') }"
      @click="emit('toggle-phone-mockup')"
      title="手机样机预览"
    >
      <i class="bi bi-phone"></i>
    </button>
    <button
      v-if="enabledActions.rotate !== false"
      type="button"
      class="preview-btn preview-rotate-btn"
      @click="emit('rotate')"
      title="旋转图片"
    >
      <i class="bi bi-arrow-clockwise"></i>
    </button>
    <button
      v-if="enabledActions.fit !== false"
      type="button"
      class="preview-btn"
      :class="{ active: fitMode === 'cover' }"
      @click="emit('toggle-fit-mode')"
      :title="fitMode === 'cover' ? '切换为完整显示' : '切换为铺满显示'"
    >
      <i
        class="bi"
        :class="fitMode === 'cover' ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'"
      ></i>
    </button>
    <button
      v-if="enabledActions.info !== false"
      type="button"
      class="preview-btn preview-info-btn"
      @click="emit('toggle-info')"
      title="显示信息"
    >
      <i class="bi" :class="showInfo ? 'bi-info-circle-fill' : 'bi-info-circle'"></i>
    </button>
    <button
      v-if="enabledActions.compare !== false"
      type="button"
      class="preview-btn preview-compare-btn"
      @click="emit('toggle-compare')"
      :class="{ active: comparisonMode !== 'none' }"
      title="比较模式"
    >
      <i class="bi bi-layout-split"></i>
    </button>
    <button
      v-if="enabledActions.crop !== false"
      type="button"
      class="preview-btn"
      :class="{ active: cropMode }"
      @click="emit('toggle-crop')"
      :title="cropMode ? '退出裁切模式' : '进入裁切模式'"
    >
      <i class="bi bi-bounding-box-circles"></i>
    </button>
    <button
      v-if="enabledActions.crop !== false && cropMode"
      type="button"
      class="preview-btn"
      :disabled="!cropReady"
      @click="emit('apply-crop')"
      title="应用裁切"
    >
      <i class="bi bi-check2"></i>
    </button>
    <button
      v-if="enabledActions.crop !== false && cropMode"
      type="button"
      class="preview-btn"
      @click="emit('cancel-crop')"
      title="取消裁切"
    >
      <i class="bi bi-x-circle"></i>
    </button>
    <button
      v-if="enabledActions.decompose !== false"
      type="button"
      class="preview-btn"
      @click="emit('decompose-image')"
      title="分解图片（3x3）"
    >
      <i class="bi bi-grid-3x3-gap"></i>
    </button>
    <button
      v-if="enabledActions.filters !== false"
      type="button"
      class="preview-btn preview-filter-btn"
      @click="emit('toggle-filters')"
      :class="{ active: showFilters || activeFilter !== 'none' || activeArtStyle !== 'none' }"
      title="图像滤镜"
    >
      <i class="bi bi-sliders"></i>
    </button>
    <button
      v-if="enabledActions.ai !== false"
      type="button"
      class="preview-btn"
      :class="{ active: showAiPanel }"
      @click="emit('toggle-ai')"
      :title="aiTitle || 'AI'"
    >
      <i class="bi bi-stars"></i>
    </button>
    <button
      v-if="enabledActions.download !== false"
      type="button"
      class="preview-btn preview-download-btn"
      :class="`download-status-${downloadStatus}`"
      :disabled="downloadStatus === 'preparing' || downloadStatus === 'downloading'"
      @click="emit('open-download')"
      :title="
        downloadStatus === 'preparing'
          ? '正在准备下载'
          : downloadStatus === 'downloading'
            ? '下载中'
            : downloadStatus === 'success'
              ? '下载完成'
              : downloadStatus === 'failed'
                ? '下载失败'
                : '下载壁纸'
      "
    >
      <i
        class="bi"
        :class="
          downloadStatus === 'preparing'
            ? 'bi-hourglass-split'
            : downloadStatus === 'downloading'
              ? 'bi-arrow-repeat'
              : downloadStatus === 'success'
                ? 'bi-check2'
                : downloadStatus === 'failed'
                  ? 'bi-exclamation-lg'
                  : 'bi-download'
        "
      ></i>
    </button>
    <button
    type="button"
    class="preview-btn preview-fullscreen-btn"
    v-if="enabledActions.fullscreen !== false"
      @click="emit('toggle-fullscreen')"
      title="切换全屏"
    >
      <i class="bi" :class="isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'"></i>
    </button>
    <button
      type="button"
      class="preview-btn preview-close-btn"
      @click="emit('close')"
      title="关闭预览"
    >
      <i class="bi bi-x-lg"></i>
    </button>
  </div>
</template>

<style scoped>
.preview-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
  opacity: 0;
  transform: translateY(-10px);
  transition: all 0.25s ease;
  z-index: 20;
}

.preview-controls.controls-visible {
  opacity: 1;
  transform: translateY(0);
}

.preview-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease;
  backdrop-filter: blur(4px);
}

.preview-btn:hover {
  background: rgba(25, 25, 25, 0.8);
  transform: scale(1.06);
}

.preview-btn:active {
  transform: scale(0.96);
}

.preview-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preview-btn.active {
  background: rgba(76, 175, 80, 0.75);
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.35);
}

.preview-favorite-btn .bi-heart-fill {
  color: #ff5e5e;
}

.preview-favorite-btn:hover .bi-heart {
  color: #ff5e5e;
}

.preview-download-btn {
  position: relative;
  overflow: hidden;
}

.preview-download-btn::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  border: 2px solid transparent;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.preview-download-btn.download-status-preparing,
.preview-download-btn.download-status-downloading {
  background: rgba(37, 99, 235, 0.82);
  box-shadow: 0 0 18px rgba(59, 130, 246, 0.36);
  cursor: wait;
  opacity: 1;
}

.preview-download-btn.download-status-preparing::after,
.preview-download-btn.download-status-downloading::after {
  border-color: rgba(147, 197, 253, 0.76);
  opacity: 1;
  animation: downloadPulse 1.15s ease-in-out infinite;
}

.preview-download-btn.download-status-downloading .bi {
  animation: downloadSpin 0.88s linear infinite;
}

.preview-download-btn.download-status-success {
  background: rgba(34, 197, 94, 0.86);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.38);
}

.preview-download-btn.download-status-success::after {
  border-color: rgba(187, 247, 208, 0.8);
  opacity: 1;
  transform: scale(1.08);
}

.preview-download-btn.download-status-failed {
  background: rgba(239, 68, 68, 0.86);
  box-shadow: 0 0 18px rgba(239, 68, 68, 0.36);
}

.preview-download-btn.download-status-failed::after {
  border-color: rgba(254, 202, 202, 0.86);
  opacity: 1;
}

@keyframes downloadSpin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes downloadPulse {
  0%,
  100% {
    transform: scale(0.92);
    opacity: 0.55;
  }

  50% {
    transform: scale(1.12);
    opacity: 1;
  }
}
</style>
