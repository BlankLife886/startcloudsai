<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'

withDefaults(defineProps<{
  hasPrev: boolean
  hasNext: boolean
  loading?: boolean
  page?: number
  count?: number
  total?: number | null
}>(), {
  loading: false,
  page: 1,
  count: 0,
  total: null,
})

defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <div class="cursor-pager" aria-label="分页">
    <div class="cursor-pager__meta">
      <span>本页 <strong>{{ count }}</strong> 条</span>
      <span v-if="total !== null">共 <strong>{{ total }}</strong> 条</span>
      <i />
      <span>第 <strong>{{ page }}</strong> 页</span>
    </div>
    <el-button-group>
      <el-button :icon="ArrowLeft" size="small" :disabled="!hasPrev || loading" @click="$emit('prev')">上一页</el-button>
      <el-button size="small" :disabled="!hasNext || loading" @click="$emit('next')">下一页<el-icon class="cursor-pager__next"><ArrowRight /></el-icon></el-button>
    </el-button-group>
  </div>
</template>

<style scoped>
.cursor-pager {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: var(--ink-3);
  font-size: 11px;
}
.cursor-pager__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.cursor-pager__meta strong {
  color: var(--ink-1);
  font-variant-numeric: tabular-nums;
}
.cursor-pager__meta i {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.cursor-pager__next {
  margin-left: 5px;
}

</style>
