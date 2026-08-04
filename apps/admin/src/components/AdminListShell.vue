<script setup lang="ts">
withDefaults(
  defineProps<{
    hasPrev: boolean
    hasNext: boolean
    loading?: boolean
    page?: number
    count?: number
    total?: number | null
    /** 视口固定高度；与 fill 互斥 */
    viewportHeight?: string
    /** 填满父级剩余高度（抽屉内列表用） */
    fill?: boolean
  }>(),
  {
    loading: false,
    page: 1,
    count: 0,
    total: null,
    viewportHeight: 'clamp(360px, calc(100vh - 300px), 680px)',
    fill: false,
  },
)

defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <section
    class="admin-list-shell"
    :class="{ 'is-fill': fill }"
    :style="fill ? undefined : { '--admin-list-height': viewportHeight }"
  >
    <div class="admin-list-shell__viewport">
      <slot />
    </div>
    <footer class="admin-list-shell__footer">
      <slot name="footer-start" />
      <CursorPager
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="count"
        :total="total"
        @prev="$emit('prev')"
        @next="$emit('next')"
      />
    </footer>
  </section>
</template>

<style scoped>
.admin-list-shell {
  display: grid;
  min-width: 0;
  grid-template-rows: var(--admin-list-height) auto;
  border-top: 1px solid var(--border);
}
.admin-list-shell.is-fill {
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
}
.admin-list-shell__viewport {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.admin-list-shell__viewport :deep(.el-table) {
  height: 100% !important;
}
.admin-list-shell__footer {
  display: flex;
  min-height: 50px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.admin-list-shell__footer :deep(.cursor-pager) {
  width: 100%;
}
@media (max-width: 720px) {
  .admin-list-shell:not(.is-fill) {
    grid-template-rows: minmax(360px, 62vh) auto;
  }
  .admin-list-shell__footer {
    padding: 8px 12px;
  }
}
</style>
