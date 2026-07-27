<script setup>
import { computed } from 'vue'

// 对比舞台只负责把原图和处理后图并排渲染，不直接持有图片状态。
const props = defineProps({
  comparisonMode: { type: String, default: 'none' },
  imageUrl: { type: String, default: '' },
  previewDisplayUrl: { type: String, default: '' },
  processedImageRef: { type: Function, default: null },
  originalImageCrossorigin: { default: null },
  previewImageCrossorigin: { default: null },
  isZoomed: { type: Boolean, default: false },
  transformStyle: { type: Object, required: true },
  cursorStyle: { type: String, default: 'default' },
  imageObjectFit: { type: String, default: 'contain' },
  imageSizingStyle: { type: Object, required: true },
  processedImageStyle: { type: Array, required: true },
  processedLabel: { type: String, default: '处理后' },
})

const emit = defineEmits(['toggle-zoom', 'start-drag', 'image-loaded', 'image-error'])

const isSideBySide = computed(() => props.comparisonMode === 'side-by-side')

const originalPaneStyle = computed(() => (isSideBySide.value ? { width: '50%' } : {}))
const processedPaneStyle = computed(() => (isSideBySide.value ? { width: '50%' } : {}))

/** 对比模式始终完整显示图片，避免沿用铺满(cover)导致半屏裁切 */
const compareFitStyle = {
  objectFit: 'contain',
  width: '100%',
  height: '100%',
  maxWidth: '100%',
  maxHeight: '100%',
}

const originalImageStyle = computed(() => [
  props.transformStyle,
  { cursor: props.cursorStyle },
  compareFitStyle,
])

const processedCompareStyle = computed(() => {
  const styles = Array.isArray(props.processedImageStyle)
    ? props.processedImageStyle
    : [props.processedImageStyle]
  return [
    ...styles.map((style) => {
      if (!style || typeof style !== 'object') return style
      const next = { ...style }
      delete next.objectFit
      delete next.width
      delete next.height
      delete next.maxWidth
      delete next.maxHeight
      return next
    }),
    compareFitStyle,
  ]
})
</script>

<template>
  <div class="comparison-stage">
    <div class="comparison-pane comparison-original" :style="originalPaneStyle">
      <img
        v-if="imageUrl"
        referrerpolicy="no-referrer"
        :crossorigin="originalImageCrossorigin"
        :src="imageUrl"
        alt="Original Preview"
        class="preview-image comparison-image"
        :class="{ zoomed: isZoomed }"
        :style="originalImageStyle"
        :draggable="false"
        @dblclick="emit('toggle-zoom', $event)"
        @mousedown="emit('start-drag', $event)"
      />
      <div class="comparison-label">原图</div>
    </div>

    <div class="comparison-pane comparison-processed" :style="processedPaneStyle">
      <img
        v-if="imageUrl"
        :ref="processedImageRef"
        referrerpolicy="no-referrer"
        :crossorigin="previewImageCrossorigin"
        :src="previewDisplayUrl"
        alt="Wallpaper Preview"
        class="preview-image"
        :class="{ zoomed: isZoomed }"
        :style="processedCompareStyle"
        :draggable="false"
        @dblclick="emit('toggle-zoom', $event)"
        @mousedown="emit('start-drag', $event)"
        @load="emit('image-loaded')"
        @error="emit('image-error')"
      />
      <div class="comparison-label">{{ processedLabel }}</div>
    </div>
  </div>
</template>

<style scoped>
.comparison-stage {
  display: flex;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 0;
}

.comparison-pane {
  position: relative;
  display: flex;
  flex: 1 1 50%;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 50%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  z-index: 1;
}

.comparison-stage .preview-image {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: center;
}

.comparison-label {
  position: absolute;
  top: 10px;
  left: 10px;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  z-index: 5;
  backdrop-filter: blur(5px);
  pointer-events: none;
}
</style>
