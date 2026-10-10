<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = withDefaults(defineProps<{
  hasPrev: boolean
  hasNext: boolean
  loading?: boolean
  page?: number
  count?: number
  total?: number | null
  /** total 为计数上限，显示为"N+" */
  totalCapped?: boolean
  pageSize?: number
  pageSizes?: number[]
}>(), {
  loading: false,
  page: 1,
  count: 0,
  total: null,
  totalCapped: false,
  pageSize: 20,
  pageSizes: () => [10, 20, 50],
})

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const sizes = computed(() => [...new Set([...props.pageSizes, props.pageSize])].sort((a, b) => a - b))
// 计数到达上限时在分页器外显示"共 N+ 条"；末尾 slot 为需点击确认的跳页表单，
// 代替 Element 输入即跳转（失焦、改值都会触发）的 jumper。
const layout = computed(() => [
  ...(props.totalCapped ? [] : ['total']),
  ...(sizes.value.length > 1 ? ['sizes'] : []),
  'prev', 'pager', 'next', 'slot',
].join(', '))
const pageCount = computed(() => Math.max(1, Math.ceil((props.total ?? 0) / props.pageSize)))
const jumpInput = ref('')
const jumpTarget = computed(() => {
  const value = Number(jumpInput.value.trim())
  return Number.isInteger(value) && value >= 1 && value <= pageCount.value ? value : null
})
function submitJump() {
  if (jumpTarget.value == null || props.loading) return
  changePage(jumpTarget.value)
}
const resizing = ref(false)
function changePage(value: number) {
  if (!props.loading && !resizing.value && value !== props.page) emit('update:page', value)
}
async function changeSize(value: number) {
  if (props.loading || value === props.pageSize) return
  resizing.value = true
  emit('update:pageSize', value)
  await nextTick()
  resizing.value = false
}
</script>

<template>
  <div class="cursor-pager" aria-label="分页">
    <span v-if="loading" class="pager-loading" role="status">正在读取数据…</span>
    <span v-if="total != null && totalCapped" class="pager-capped-total" title="超过上限的记录请缩小筛选范围后查看">共 {{ total }}+ 条</span>
    <el-pagination
      v-if="total != null"
      background
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="sizes"
      :total="total"
      :disabled="loading"
      :pager-count="5"
      :layout="layout"
      @update:current-page="changePage"
      @update:page-size="changeSize"
    >
      <form class="pager-jump" @submit.prevent="submitJump">
        <span>前往</span>
        <el-input
          v-model="jumpInput"
          class="pager-jump__input"
          inputmode="numeric"
          :placeholder="`1-${pageCount}`"
          :disabled="loading"
          aria-label="目标页码"
        />
        <span>页</span>
        <el-button native-type="submit" :disabled="loading || jumpTarget == null || jumpTarget === page">前往</el-button>
      </form>
    </el-pagination>
    <div v-else class="cursor-navigation">
      <span>第 {{ page }} 页 · 本页 {{ count }} 条</span>
      <el-select v-if="sizes.length > 1" :model-value="pageSize" :disabled="loading" aria-label="每页条数" @update:model-value="changeSize">
        <el-option v-for="size in sizes" :key="size" :value="size" :label="`${size} 条/页`" />
      </el-select>
      <el-button :disabled="loading || !hasPrev" @click="changePage(page - 1)">上一页</el-button>
      <el-button :disabled="loading || !hasNext" @click="changePage(page + 1)">下一页</el-button>
    </div>
  </div>
</template>

<style scoped>
.cursor-pager {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
}
.pager-loading { color: var(--ink-3); font-size: 12px; }
.pager-capped-total { color: var(--ink-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.pager-jump { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 13px; }
.pager-jump__input { width: 64px; }
.pager-jump :deep(.el-button) { margin-left: 0; }
.cursor-navigation { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--ink-2); }
.cursor-navigation :deep(.el-select) { width: 112px; }
.cursor-navigation :deep(.el-button) { margin-left: 0; }

.cursor-pager :deep(.el-pagination) {
  gap: 8px;
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
@media (max-width: 640px) {
  .cursor-pager :deep(.el-pagination) { --el-pagination-button-width: 28px; gap: 4px; }
}

.cursor-pager :deep(.el-pagination__total) {
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
