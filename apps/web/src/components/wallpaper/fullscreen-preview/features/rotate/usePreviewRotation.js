import { ref } from 'vue'

// 旋转只管理角度；视口层负责根据角度重新约束拖拽边界。
export function usePreviewRotation({ onRotate } = {}) {
  const rotation = ref(0)

  function rotateImage(degrees = 90) {
    rotation.value = (rotation.value + Number(degrees || 0)) % 360
    onRotate?.()
  }

  function resetRotation() {
    rotation.value = 0
  }

  return {
    rotation,
    rotateImage,
    resetRotation,
  }
}
