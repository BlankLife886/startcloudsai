<script setup>
import { getWallhavenSearchWindowUsage } from '@/utils/wallhavenBudget'
import { onMounted, onUnmounted, ref } from 'vue'

const usage = ref(getWallhavenSearchWindowUsage())
let timer = null

onMounted(() => {
  timer = window.setInterval(() => {
    usage.value = getWallhavenSearchWindowUsage()
  }, 700)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

function barClass() {
  const r = usage.value.ratio
  if (r >= 1) return 'bg-danger'
  if (r >= 0.85) return 'bg-warning'
  if (r >= 0.65) return 'bg-info'
  return 'bg-success'
}
</script>

<template>
  <div
    class="budget-pill"
    role="status"
    :title="`约 60 秒内搜索 ${usage.used} 次，建议不超过 ${usage.capacity} 次/分钟`"
  >
    <span class="budget-title">API</span>
    <div class="progress budget-progress">
      <div
        class="progress-bar"
        :class="barClass()"
        :style="{ width: `${Math.min(100, usage.ratio * 100)}%` }"
      />
    </div>
    <span class="budget-count">{{ usage.used }}/{{ usage.capacity }}</span>
  </div>
</template>

<style scoped>
.budget-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: color-mix(in srgb, var(--card-bg-color) 96%, transparent);
  min-width: 0;
}

.budget-title {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--text-color) 50%, transparent);
}

.budget-progress {
  width: 52px;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--border-color) 50%, transparent);
}

.budget-count {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--text-color) 72%, transparent);
}
</style>
