<script setup>
import { computed } from 'vue'

const props = defineProps({
  historyIndex: { type: Number, default: -1 },
  filterHistoryLength: { type: Number, default: 0 },
})

const emit = defineEmits(['undo', 'redo', 'reset', 'close'])

const canUndo = computed(() => props.historyIndex > 0)
const canRedo = computed(() => props.filterHistoryLength > 0 && props.historyIndex < props.filterHistoryLength - 1)
const historyLabel = computed(() => {
  if (props.filterHistoryLength <= 0) return ''
  return `${Math.max(0, props.historyIndex + 1)}/${props.filterHistoryLength}`
})
</script>

<template>
  <div class="filter-header">
    <div class="filter-header-titles">
      <h5>图像滤镜</h5>
      <span class="filter-subtitle">预览与导出效果一致</span>
    </div>
    <div class="filter-actions">
      <span v-if="historyLabel" class="filter-history-badge">{{ historyLabel }}</span>
      <button
        class="filter-action-btn"
        type="button"
        title="撤销"
        :disabled="!canUndo"
        @click="emit('undo')"
      >
        <i class="bi bi-arrow-counterclockwise"></i>
      </button>
      <button
        class="filter-action-btn"
        type="button"
        title="重做"
        :disabled="!canRedo"
        @click="emit('redo')"
      >
        <i class="bi bi-arrow-clockwise"></i>
      </button>
      <button class="filter-action-btn" type="button" title="重置全部" @click="emit('reset')">
        <i class="bi bi-arrow-repeat"></i>
      </button>
      <button class="filter-close-btn" type="button" aria-label="关闭" @click="emit('close')">
        <i class="bi bi-x"></i>
      </button>
    </div>
  </div>
</template>
