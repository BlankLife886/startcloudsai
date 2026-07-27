<script setup>
// 缩放提示是视口能力的轻量展示组件，不持有缩放逻辑。
defineProps({
  showControls: { type: Boolean, default: true },
  zoomLevel: { type: Number, default: 1 },
})

const emit = defineEmits(['zoom-in', 'zoom-out', 'reset-zoom'])
</script>

<template>
  <div class="preview-zoom-hint" :class="{ 'controls-visible': showControls }">
    <div class="zoom-buttons">
      <button @click="emit('zoom-in')">放大+</button>
      <button @click="emit('zoom-out')">缩小-</button>
      <button @click="emit('reset-zoom')">重置</button>
    </div>
  </div>
</template>

<style scoped>
.preview-zoom-hint {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 14px;
  padding: 8px 12px;
  backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 20;
}

.preview-zoom-hint.controls-visible {
  opacity: 1;
}

.zoom-buttons {
  display: flex;
  gap: 6px;
}

.zoom-buttons button {
  border: none;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.zoom-buttons button:hover {
  background: rgba(36, 36, 36, 0.85);
}
</style>
