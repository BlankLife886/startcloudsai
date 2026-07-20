<script setup lang="ts">
/**
 * 通用内容卡片：灰底之上的白色容器（16px 圆角 + 细边 + shadow-sm）。
 * header 可选：title（15px semibold）+ subtitle（12px ink-3）+ actions 插槽。
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
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  min-width: 0;
}

.page-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.page-card__copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.page-card__title {
  font-size: 15px;
  font-weight: 600;
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
  padding: 16px 18px;
}

.page-card__body.is-flush {
  padding: 0;
}
</style>
