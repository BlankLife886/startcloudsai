<script setup lang="ts">
/**
 * ERP 风格 KPI 卡：左侧「标签 + 大数字 + 底部说明」，右上角彩色 soft 底图标块。
 */
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string | number
  /** 底部趋势 / 说明小字 */
  caption?: string
  icon?: Component
  /** 图标块配色 */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
}>()
</script>

<template>
  <div class="stat-card">
    <div class="stat-card__main">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value tnum">{{ value }}</div>
      <div v-if="caption" class="stat-card__caption">{{ caption }}</div>
    </div>
    <span v-if="icon" class="stat-card__icon" :class="`is-${tone ?? 'accent'}`">
      <el-icon :size="17"><component :is="icon" /></el-icon>
    </span>
  </div>
</template>

<style scoped>
.stat-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  min-width: 0;
}

.stat-card__main {
  min-width: 0;
  flex: 1;
}

.stat-card__label {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-card__value {
  margin-top: 8px;
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.stat-card__caption {
  margin-top: 8px;
  color: var(--ink-3);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-card__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 10px;
}

.stat-card__icon.is-accent {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.stat-card__icon.is-success {
  background: var(--success-soft);
  color: var(--success);
}

.stat-card__icon.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.stat-card__icon.is-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.stat-card__icon.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.stat-card__icon.is-violet {
  background: var(--violet-soft);
  color: var(--violet);
}
</style>
