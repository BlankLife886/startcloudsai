<script setup>
// 仅负责集合内前后切换，避免导航状态继续堆在顶部工具栏主文件里。
defineProps({
  showControls: { type: Boolean, default: true },
  inCollection: { type: Boolean, default: false },
  collectionIndex: { type: Number, default: -1 },
  collectionTotal: { type: Number, default: 0 },
})

const emit = defineEmits(['previous', 'next', 'controls-enter', 'controls-leave'])
</script>

<template>
  <div v-if="inCollection" class="preview-navigation" :class="{ 'controls-visible': showControls }">
    <button
      type="button"
      class="preview-btn preview-nav-btn preview-prev-btn"
      @click="emit('previous')"
      @mouseenter="emit('controls-enter')"
      @mouseleave="emit('controls-leave')"
      title="上一张"
      :disabled="collectionIndex <= 0"
    >
      <i class="bi bi-chevron-left"></i>
    </button>
    <button
      type="button"
      class="preview-btn preview-nav-btn preview-next-btn"
      @click="emit('next')"
      @mouseenter="emit('controls-enter')"
      @mouseleave="emit('controls-leave')"
      title="下一张"
      :disabled="collectionIndex >= collectionTotal - 1"
    >
      <i class="bi bi-chevron-right"></i>
    </button>
  </div>
</template>

<style scoped>
.preview-navigation {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 18;
}

.preview-navigation.controls-visible {
  opacity: 1;
}

.preview-navigation .preview-btn {
  pointer-events: auto;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
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
    background-color 0.2s ease,
    box-shadow 0.2s ease;
  backdrop-filter: blur(4px);
}

.preview-btn:hover {
  background: rgba(25, 25, 25, 0.8);
  transform: translateY(-50%);
}

.preview-btn:active {
  transform: translateY(-50%);
}

.preview-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preview-btn.active {
  background: rgba(76, 175, 80, 0.75);
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.35);
}

.preview-prev-btn {
  left: 16px;
}

.preview-next-btn {
  right: 16px;
}
</style>
