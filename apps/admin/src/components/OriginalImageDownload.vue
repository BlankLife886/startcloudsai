<script setup lang="ts">
import { ref } from 'vue'
import { Download, FullScreen, Loading, RefreshLeft, RefreshRight, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  url: string
  actions: (action: 'zoomIn' | 'zoomOut' | 'clockwise' | 'anticlockwise') => void
  reset: () => void
}>()
const downloading = ref(false)

async function download() {
  if (!props.url || downloading.value) return
  downloading.value = true
  try {
    const url = new URL(props.url, window.location.href)
    const response = await fetch(url, { credentials: url.origin === window.location.origin ? 'same-origin' : 'omit' })
    if (!response.ok) throw new Error('下载失败')
    const blob = await response.blob()
    if (!blob.size || blob.type.includes('json') || blob.type.includes('text/html')) throw new Error('原图不可用')
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = decodeURIComponent(url.pathname.split('/').pop() || 'original-image')
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch {
    ElMessage.error('原图下载失败，图片可能已删除或暂时无法访问，请重试')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div class="preview-toolbar" @click.stop>
    <button type="button" title="缩小" aria-label="缩小" @click="actions('zoomOut')"><el-icon><ZoomOut /></el-icon></button>
    <button type="button" title="放大" aria-label="放大" @click="actions('zoomIn')"><el-icon><ZoomIn /></el-icon></button>
    <button type="button" title="适应窗口 / 原始尺寸" aria-label="适应窗口 / 原始尺寸" @click="reset"><el-icon><FullScreen /></el-icon></button>
    <button type="button" title="向左旋转" aria-label="向左旋转" @click="actions('anticlockwise')"><el-icon><RefreshLeft /></el-icon></button>
    <button type="button" title="向右旋转" aria-label="向右旋转" @click="actions('clockwise')"><el-icon><RefreshRight /></el-icon></button>
    <span class="toolbar-divider" aria-hidden="true" />
    <button type="button" title="下载原图" aria-label="下载原图" :disabled="!url || downloading" :aria-busy="downloading" @click="download">
      <el-icon :class="{ 'is-loading': downloading }"><Loading v-if="downloading" /><Download v-else /></el-icon>
    </button>
  </div>
</template>

<style scoped>
.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 6px;
}
.preview-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 20px;
  cursor: pointer;
}
.preview-toolbar button:hover:not(:disabled),
.preview-toolbar button:focus-visible {
  background: rgb(255 255 255 / 15%);
}
.preview-toolbar button:focus-visible {
  outline: 1px solid currentColor;
}
.preview-toolbar button:disabled {
  opacity: 0.45;
  cursor: default;
}
.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgb(255 255 255 / 25%);
}
</style>
