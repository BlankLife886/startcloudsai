<script setup lang="ts">
/**
 * KPI 卡：左侧「标签 + 大数字 + 状态 pill」，右上角 tone 图标块。
 */
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string | number
  /** 底部趋势 / 说明小字 */
  caption?: string
  icon?: Component
  /** 图标块与 caption pill 配色 */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
}>()
</script>

<template>
  <div class="stat-card">
    <div class="stat-card__main">
      <div class="stat-card__label">{{ label }}</div>
      <div class="stat-card__value tnum">{{ value }}</div>
      <div
        v-if="caption"
        class="stat-card__caption"
        :class="`is-${tone ?? 'neutral'}`"
      >
        {{ caption }}
      </div>
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
  min-height: 124px;
  padding: 18px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sm);
  min-width: 0;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.stat-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.stat-card__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-card__label {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.stat-card__value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.stat-card__caption {
  display: inline-flex;
  align-items: center;
  margin-top: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-card__caption.is-accent {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.stat-card__caption.is-success {
  background: var(--success-soft);
  color: var(--success);
}

.stat-card__caption.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.stat-card__caption.is-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.stat-card__caption.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.stat-card__caption.is-violet {
  background: var(--violet-soft);
  color: var(--violet);
}

.stat-card__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 12px;
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

@media (prefers-reduced-motion: reduce) {
  .stat-card {
    transition: none;
  }
}
</style>
