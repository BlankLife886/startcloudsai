<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  hasPrev: boolean
  hasNext: boolean
  loading?: boolean
  page?: number
  count?: number
  total?: number | null
  pageSize?: number
  pageSizes?: number[]
}>(), {
  loading: false,
  page: 1,
  count: 0,
  total: null,
  pageSize: 20,
  pageSizes: () => [10, 20, 50],
})

defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const resolvedTotal = computed(() => {
  if (props.total != null) return props.total
  return (props.page - 1) * props.pageSize + props.count + (props.hasNext ? 1 : 0)
})
</script>

<template>
  <div class="cursor-pager" aria-label="分页">
    <el-pagination
      background
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="pageSizes"
      :total="resolvedTotal"
      :disabled="loading"
      :pager-count="7"
      layout="total, sizes, prev, pager, next, jumper"
      @current-change="$emit('update:page', $event)"
      @size-change="$emit('update:pageSize', $event)"
    />
  </div>
</template>

<style scoped>
.cursor-pager {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: flex-end;
}

.cursor-pager :deep(.el-pagination) {
  flex-wrap: wrap;
  justify-content: flex-end;
  padding: 0;
  --el-pagination-font-size: 13px;
  --el-pagination-button-width: 32px;
  --el-pagination-button-height: 32px;
  --el-pagination-bg-color: var(--surface);
  --el-pagination-hover-color: var(--accent-ink);
  --el-pagination-button-bg-color: var(--surface);
}

.cursor-pager :deep(.el-pagination__total),
.cursor-pager :deep(.el-pagination__jump) {
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.cursor-pager :deep(.el-pager li.is-active) {
  background-color: var(--accent) !important;
  color: var(--accent-on) !important;
  font-weight: 700;
}

.cursor-pager :deep(.el-pagination__sizes .el-select) {
  width: 108px;
}
</style>
