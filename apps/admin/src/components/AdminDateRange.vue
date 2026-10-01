<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ from: string; to: string; label?: string; hideLabel?: boolean }>(), { label: '创建时间', hideLabel: false })
const emit = defineEmits<{ 'update:from': [value: string]; 'update:to': [value: string]; change: [] }>()
const range = computed(() => props.from && props.to ? [props.from, props.to] : [])
function recent(days: number) {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const [year, month, day] = today.split('-').map(Number)
  const end = new Date(year!, month! - 1, day!)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  return [start, end]
}
const shortcuts = [1, 7, 30, 90].map(days => ({ text: days === 1 ? '今天' : `近 ${days} 天`, value: () => recent(days) }))
function change(value: string[] | null) {
  emit('update:from', value?.[0] || '')
  emit('update:to', value?.[1] || '')
  emit('change')
}
</script>

<template>
  <div class="admin-date-range">
    <span v-if="!hideLabel">{{ label }} <small>北京时间</small></span>
    <el-date-picker :model-value="range" type="daterange" value-format="YYYY-MM-DD" format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" :shortcuts="shortcuts" :aria-label="`${label}范围（北京时间）`" clearable @update:model-value="change" />
  </div>
</template>

<style scoped>
.admin-date-range { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.admin-date-range > span { font-size: 12px; color: var(--ink-2); white-space: nowrap; }
.admin-date-range small { font-size: 10px; color: var(--ink-3); }
.admin-date-range :deep(.el-date-editor) { width: 260px; max-width: 100%; flex-grow: 0; }
</style>
