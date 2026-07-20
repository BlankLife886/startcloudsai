<script setup>
import { computed } from 'vue'
import { formatBytes } from '@/services/aiIllustrationColoringState'

const props = defineProps({
  open: { type: Boolean, default: false },
  info: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close'])

function sizeText(width, height) {
  return width && height ? `${width}×${height}` : '—'
}

const rows = computed(() => {
  const info = props.info || {}
  const originalBytes = Number(info.originalBytes || 0)
  const inputBytes = Number(info.inputBytes || 0)
  const delta =
    originalBytes > 0 && inputBytes > 0 ? inputBytes - originalBytes : 0
  const deltaText =
    originalBytes > 0 && inputBytes > 0
      ? delta === 0
        ? '与原图相同'
        : delta > 0
          ? `比原图大 ${formatBytes(delta)}`
          : `比原图小 ${formatBytes(Math.abs(delta))}`
      : '—'
  const requested =
    info.requestedOutputWidth && info.requestedOutputHeight
      ? `${info.requestedOutputWidth}×${info.requestedOutputHeight}`
      : info.outputSize || '—'
  const sizeValidation =
    info.outputSizeMatched === true
      ? '一致'
      : info.outputSizeMatched === false
        ? info.outputSizeWarning || '模型返回尺寸与请求不一致'
        : '待校验'
  return [
    { label: '模型', value: info.publicModelKey || '—' },
    { label: '原图尺寸', value: sizeText(info.originalWidth, info.originalHeight) },
    { label: '原图大小', value: originalBytes ? formatBytes(originalBytes) : '—' },
    { label: '传入尺寸', value: sizeText(info.inputWidth, info.inputHeight) },
    { label: '传入大小', value: inputBytes ? formatBytes(inputBytes) : '—' },
    { label: '处理变化', value: deltaText },
    { label: '传入格式', value: info.inputType || '—' },
    { label: '请求输出', value: requested },
    { label: '输出尺寸设置', value: info.outputSize || '—' },
    {
      label: '实际输出尺寸',
      value: sizeText(info.resultWidth, info.resultHeight),
    },
    { label: '尺寸校验', value: sizeValidation },
    { label: '实际输出大小', value: info.resultBytes ? formatBytes(info.resultBytes) : '—' },
    { label: '输出格式', value: info.resultType || '—' },
  ]
})
</script>

<template>
  <aside v-if="open" class="coloring-debug-panel">
    <header>
      <strong>调试面板</strong>
      <button type="button" title="关闭" @click="emit('close')">
        <i class="bi bi-x-lg"></i>
      </button>
    </header>
    <dl>
      <div v-for="row in rows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>
    <p>
      「传入」是发给模型的处理后图片。开启压缩时会优先 JPEG/WebP，并保证不比原图更大。
    </p>
  </aside>
</template>

<style scoped>
.coloring-debug-panel {
  position: absolute;
  right: 12px;
  bottom: 64px;
  z-index: 20;
  width: min(100% - 24px, 340px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(12, 10, 16, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
  color: #fff;
  overflow: hidden;
}

.coloring-debug-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.coloring-debug-panel header strong {
  font-size: 0.8rem;
}

.coloring-debug-panel header button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.coloring-debug-panel dl {
  margin: 0;
  padding: 8px 12px;
  display: grid;
  gap: 6px;
  max-height: min(52vh, 420px);
  overflow: auto;
}

.coloring-debug-panel dl > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.coloring-debug-panel dt {
  margin: 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.68rem;
}

.coloring-debug-panel dd {
  margin: 0;
  color: #f9a8d4;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  word-break: break-all;
}

.coloring-debug-panel p {
  margin: 0;
  padding: 0 12px 12px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.64rem;
  line-height: 1.4;
}
</style>
