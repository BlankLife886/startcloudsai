import { computed, ref } from 'vue'

// 统一管理“原图/处理后图/当前显示图”。AI、裁切等功能只写入这里，避免各业务互相覆盖。
export function usePreviewResult({ basePreviewUrl }) {
  const processedPreviewUrl = ref('')
  const undoStack = ref([])

  const previewDisplayUrl = computed(() => processedPreviewUrl.value || basePreviewUrl.value || '')
  const currentProcessedData = computed(() => previewDisplayUrl.value || '')

  function applyProcessedResult(url) {
    const nextUrl = String(url || '').trim()
    if (!nextUrl) return false
    if (processedPreviewUrl.value) {
      undoStack.value = [processedPreviewUrl.value, ...undoStack.value].slice(0, 5)
    }
    processedPreviewUrl.value = nextUrl
    return true
  }

  function resetProcessedResult() {
    processedPreviewUrl.value = ''
    undoStack.value = []
  }

  function undoProcessedResult() {
    const last = undoStack.value.shift()
    if (!last) return ''
    processedPreviewUrl.value = last
    return last
  }

  return {
    currentProcessedData,
    previewDisplayUrl,
    processedPreviewUrl,
    undoStack,
    applyProcessedResult,
    resetProcessedResult,
    undoProcessedResult,
  }
}
