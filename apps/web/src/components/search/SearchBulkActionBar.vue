<script setup>
import { useAppearanceStore } from '@/stores/appearance'

const appearanceStore = useAppearanceStore()

defineProps({
  count: {
    type: Number,
    default: 0,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  visibleActions: {
    type: Object,
    default: () => ({}),
  },
})

defineEmits([
  'compare',
  'download',
  'favorite',
  'export-links',
  'add-pending',
  'hide-selected',
  'bulk-collection',
])
</script>

<template>
  <!-- 多选开启即显示；未选张数时操作钮禁用，取消勾选靠关多选或全选切换 -->
  <div class="bulk-embed" :class="{ 'is-scheme-dark': appearanceStore.isDark }" role="toolbar" aria-label="批量操作">
    <span class="bulk-embed-label"
      >已选 <strong>{{ count }}</strong> 张</span
    >
    <div class="bulk-embed-actions">
      <button
        v-if="visibleActions.exportLinks !== false"
        type="button"
        class="btn btn-sm btn-outline-secondary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="导出链接"
        aria-label="导出链接"
        @click="$emit('export-links')"
      >
        <i class="bi bi-link-45deg" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.pending !== false"
        type="button"
        class="btn btn-sm btn-outline-secondary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="加入待定池"
        aria-label="加入待定池"
        @click="$emit('add-pending')"
      >
        <i class="bi bi-inbox" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.hide !== false"
        type="button"
        class="btn btn-sm btn-outline-secondary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="隐藏所选"
        aria-label="隐藏所选"
        @click="$emit('hide-selected')"
      >
        <i class="bi bi-eye-slash" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.compare !== false"
        type="button"
        class="btn btn-sm btn-outline-primary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="对比"
        aria-label="对比"
        @click="$emit('compare')"
      >
        <i class="bi bi-layout-three-columns" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.collection !== false"
        type="button"
        class="btn btn-sm btn-outline-primary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="进合集"
        aria-label="进合集"
        @click="$emit('bulk-collection')"
      >
        <i class="bi bi-folder-plus" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.favorite !== false"
        type="button"
        class="btn btn-sm btn-outline-primary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="收藏"
        aria-label="收藏"
        @click="$emit('favorite')"
      >
        <i class="bi bi-heart" aria-hidden="true"></i>
      </button>
      <button
        v-if="visibleActions.download !== false"
        type="button"
        class="btn btn-sm btn-primary bulk-embed-btn"
        :disabled="disabled || count < 1"
        title="下载"
        aria-label="下载"
        @click="$emit('download')"
      >
        <i class="bi bi-download" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.bulk-embed {
  --bulk-ink: #18203b;
  --bulk-muted: #6d748c;
  --bulk-accent: #6a4fe0;
  --bulk-active: #151a2d;
  --bulk-size: 2rem;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
  flex: 1 1 auto;
  min-width: 0;
}

.bulk-embed-label {
  font-size: 0.74rem;
  font-weight: 650;
  color: var(--bulk-muted);
  white-space: nowrap;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

.bulk-embed-label strong {
  color: var(--bulk-accent);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  margin: 0 0.12em;
}

.bulk-embed-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
  padding: 2px;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
}

.bulk-embed-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bulk-size);
  min-width: var(--bulk-size);
  height: var(--bulk-size);
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: var(--bulk-ink) !important;
  font-size: 0.92rem;
  line-height: 1;
  box-shadow: none !important;
  outline: none;
  transition:
    background 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease,
    opacity 0.14s ease;
}

.bulk-embed-btn:hover:not(:disabled),
.bulk-embed-btn:focus-visible:not(:disabled) {
  color: var(--bulk-accent) !important;
  background: rgba(106, 79, 224, 0.08) !important;
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.35) !important;
}

.bulk-embed-btn:disabled {
  opacity: 0.34;
  cursor: not-allowed;
}

.bulk-embed-btn.btn-outline-primary:hover:not(:disabled),
.bulk-embed-btn.btn-outline-primary:focus-visible:not(:disabled) {
  color: var(--bulk-accent) !important;
  background: rgba(106, 79, 224, 0.1) !important;
}

.bulk-embed-btn.btn-primary {
  background: var(--bulk-active) !important;
  color: #fff !important;
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75) !important;
}

.bulk-embed-btn.btn-primary:hover:not(:disabled),
.bulk-embed-btn.btn-primary:focus-visible:not(:disabled) {
  background: var(--bulk-accent) !important;
  color: #fff !important;
  box-shadow: 2px 2px 0 rgba(21, 26, 45, 0.55) !important;
}

.bulk-embed-btn.btn-primary:disabled {
  background: rgba(21, 26, 45, 0.28) !important;
  color: rgba(255, 255, 255, 0.72) !important;
  box-shadow: none !important;
  opacity: 1;
}

.bulk-embed.is-scheme-dark {
  --bulk-ink: #e8eaf4;
  --bulk-muted: #9aa1b8;
  --bulk-accent: #a08bff;
  color: var(--bulk-ink);
}

.bulk-embed.is-scheme-dark .bulk-embed-actions {
  box-shadow: inset 0 0 0 1px rgba(160, 139, 255, 0.28);
}

.bulk-embed.is-scheme-dark .bulk-embed-label {
  color: #9aa1b8 !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-label strong {
  color: #a08bff !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-btn {
  color: #e8eaf4 !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-btn:hover:not(:disabled),
.bulk-embed.is-scheme-dark .bulk-embed-btn:focus-visible:not(:disabled) {
  color: #c4b5ff !important;
  background: rgba(106, 79, 224, 0.16) !important;
  box-shadow: inset 0 0 0 1px rgba(160, 139, 255, 0.45) !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-btn.btn-primary {
  background: #f0ecff !important;
  color: #151a2d !important;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5) !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-btn.btn-primary:hover:not(:disabled),
.bulk-embed.is-scheme-dark .bulk-embed-btn.btn-primary:focus-visible:not(:disabled) {
  background: #fff !important;
  color: #151a2d !important;
}

.bulk-embed.is-scheme-dark .bulk-embed-btn.btn-primary:disabled {
  background: rgba(240, 236, 255, 0.28) !important;
  color: rgba(21, 26, 45, 0.55) !important;
  box-shadow: none !important;
}
</style>
