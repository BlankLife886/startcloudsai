<script setup lang="ts">
/**
 * 通用内容卡片：大圆角 surface 容器 + 可选 header。
 */
defineProps<{
  title?: string
  subtitle?: string
  /** 去掉 body 内边距（如让表格贴边时使用） */
  flush?: boolean
}>()

const slots = defineSlots<{
  default(): unknown
  actions?(): unknown
  header?(): unknown
}>()

const hasHeader = (title?: string, subtitle?: string) =>
  Boolean(title || subtitle || slots.actions || slots.header)
</script>

<template>
  <section class="page-card">
    <header v-if="hasHeader(title, subtitle)" class="page-card__header">
      <div class="page-card__copy">
        <slot name="header">
          <div v-if="title" class="page-card__title">{{ title }}</div>
          <div v-if="subtitle" class="page-card__subtitle">{{ subtitle }}</div>
        </slot>
      </div>
      <div v-if="slots.actions" class="page-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="page-card__body" :class="{ 'is-flush': flush }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.page-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sm);
  min-width: 0;
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.page-card:hover {
  border-color: var(--border-strong);
}

.page-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px 0;
}

.page-card__copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.page-card__title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.4;
}

.page-card__subtitle {
  color: var(--ink-3);
  font-size: 12px;
}

.page-card__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.page-card__body {
  padding: 16px 20px 20px;
}

.page-card__body.is-flush {
  padding: 0;
}

.page-card__header + .page-card__body.is-flush {
  padding-top: 12px;
}
</style>
