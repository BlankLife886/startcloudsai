<script setup lang="ts">
defineProps<{
  hasPrev: boolean
  hasNext: boolean
  loading?: boolean
}>()

defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <div class="pager-bar">
    <el-button-group>
      <el-button size="small" :disabled="!hasPrev || loading" @click="$emit('prev')">上一页</el-button>
      <el-button size="small" :disabled="!hasNext || loading" @click="$emit('next')">下一页</el-button>
    </el-button-group>
  </div>
</template>
