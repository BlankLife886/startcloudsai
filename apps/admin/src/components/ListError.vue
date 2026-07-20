<script setup lang="ts">
/** 列表加载失败错误条：配合 usePagedList 的 error/retry 使用，放在表格上方 */
defineProps<{
  error: string | null
  loading?: boolean
}>()

defineEmits<{
  retry: []
}>()
</script>

<template>
  <el-alert v-if="error" type="error" :closable="false" class="list-error">
    <template #title>
      <span class="list-error__text">{{ error }}</span>
      <el-button size="small" type="danger" plain :loading="loading" @click="$emit('retry')">重试</el-button>
    </template>
  </el-alert>
</template>

<style scoped>
.list-error {
  margin-bottom: 12px;
}

.list-error :deep(.el-alert__title) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.list-error__text {
  flex: 1;
  min-width: 0;
}
</style>
