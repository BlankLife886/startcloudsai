<script setup>
import { computed, ref, watch } from 'vue'
import SearchBulkActionBar from '@/components/search/SearchBulkActionBar.vue'
import { useAppearanceStore } from '@/stores/appearance'

const appearanceStore = useAppearanceStore()

const props = defineProps({
  selectionMode: { type: Boolean, default: false },
  selectedCount: { type: Number, default: 0 },
  bulkDisabled: { type: Boolean, default: false },
  summaryTitle: { type: String, default: '' },
  summarySubline: { type: String, default: '' },
  summaryFullTitle: { type: String, default: '' },
  totalResults: { type: Number, default: 0 },
  displayCount: { type: Number, default: 0 },
  aggregateColors: { type: Array, default: () => [] },
  allSelected: { type: Boolean, default: false },
  hiddenCount: { type: Number, default: 0 },
  pageInput: { type: [String, Number], default: '' },
  totalPages: { type: Number, default: 1 },
  isValidPageNumber: { type: Boolean, default: false },
  canGoPrev: { type: Boolean, default: false },
  canGoNext: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  infiniteScroll: { type: Boolean, default: false },
  hasMorePages: { type: Boolean, default: false },
  wallhavenCooldown: { type: [Boolean, Object, String, Number], default: false },
  visibleTools: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'compare',
  'download',
  'favorite',
  'export-links',
  'add-pending',
  'hide-selected',
  'bulk-collection',
  'pick-color',
  'toggle-selection-mode',
  'toggle-select-all',
  'clear-hidden',
  'update:pageInput',
  'jump',
  'prev',
  'next',
  'load-more',
])

const pageInputModel = computed({
  get: () => props.pageInput,
  set: (value) => emit('update:pageInput', value),
})

const colorsOpen = ref(false)
const dockSummaryTitle = computed(() => props.summaryTitle || '所有壁纸')

function formatCompactCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 100000000) return `${(n / 100000000).toFixed(n >= 1000000000 ? 0 : 1).replace(/\.0$/, '')}亿`
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`
  return n.toLocaleString('zh-CN')
}

const formattedTotalResults = computed(() => formatCompactCount(props.totalResults))
const formattedTotalPages = computed(() => formatCompactCount(props.totalPages))
const totalPagesTitle = computed(() =>
  Number.isFinite(Number(props.totalPages)) ? `共 ${Number(props.totalPages).toLocaleString('zh-CN')} 页` : '',
)

const tools = computed(() => ({
  summary: props.visibleTools.summary !== false,
  colors: props.visibleTools.colors !== false,
  selection: props.visibleTools.selection !== false,
  exportLinks: props.visibleTools.exportLinks !== false,
  hidden: props.visibleTools.hidden !== false,
  hideSelected: props.visibleTools.hideSelected !== false,
  compare: props.visibleTools.compare !== false,
  collection: props.visibleTools.collection !== false,
  favorite: props.visibleTools.favorite !== false,
  download: props.visibleTools.download !== false,
  jump: props.visibleTools.jump !== false,
  pager: props.visibleTools.pager !== false,
  more: props.visibleTools.more !== false,
  pending: props.visibleTools.pending !== false,
}))

const showTools = computed(
  () =>
    tools.value.selection ||
    (tools.value.hidden && props.hiddenCount > 0) ||
    (tools.value.colors && props.aggregateColors.length > 0),
)

const showPager = computed(
  () => tools.value.jump || tools.value.pager || (tools.value.more && props.infiniteScroll),
)

function toggleColors() {
  colorsOpen.value = !colorsOpen.value
}

function pickColor(hex) {
  colorsOpen.value = false
  emit('pick-color', hex)
}

function submitJump() {
  if (!props.isValidPageNumber || props.isLoading) return
  emit('jump')
}

watch(
  () => props.aggregateColors.length,
  (count) => {
    if (!count) colorsOpen.value = false
  },
)
</script>

<template>
  <div
    class="search-dock-row"
    :class="{
      'is-scheme-dark': appearanceStore.isDark,
      'has-tools': showTools,
      'has-pager': showPager,
    }"
  >
    <div v-if="tools.summary || selectionMode" class="search-dock-meta">
      <div v-if="selectionMode" class="search-dock-bulk-scroll">
        <SearchBulkActionBar
          :count="selectedCount"
          :disabled="bulkDisabled"
          :visible-actions="{
            exportLinks: tools.exportLinks,
            pending: tools.pending,
            hide: tools.hideSelected,
            compare: tools.compare,
            collection: tools.collection,
            favorite: tools.favorite,
            download: tools.download,
          }"
          @compare="emit('compare')"
          @download="emit('download')"
          @favorite="emit('favorite')"
          @export-links="emit('export-links')"
          @add-pending="emit('add-pending')"
          @hide-selected="emit('hide-selected')"
          @bulk-collection="emit('bulk-collection')"
        />
      </div>
      <div v-else-if="tools.summary" class="search-dock-main">
        <div class="search-dock-summary-head" :title="summaryFullTitle">
          <i class="bi bi-search search-dock-summary-icon" aria-hidden="true"></i>
          <span class="search-dock-summary-title">{{ dockSummaryTitle }}</span>
          <span v-if="summarySubline" class="search-dock-summary-sub">（{{ summarySubline }}）</span>
        </div>
        <div class="search-dock-stats" aria-label="搜索结果统计">
          <span class="search-dock-stat">
            <span id="results-count" class="search-dock-stat-value">{{ formattedTotalResults }}</span>
            <span class="search-dock-stat-label">结果</span>
          </span>
          <span class="search-dock-stat-sep" aria-hidden="true"></span>
          <span class="search-dock-stat">
            <span class="search-dock-stat-value">{{ displayCount }}</span>
            <span class="search-dock-stat-label">本页</span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="showTools" class="search-dock-tools" role="toolbar" aria-label="筛选与多选">
      <div
        v-if="tools.colors && aggregateColors.length"
        class="search-dock-tool-group search-dock-colors"
      >
        <button
          type="button"
          class="btn btn-sm search-dock-icon-btn search-dock-nav-btn search-dock-color-toggle"
          :class="{ active: colorsOpen }"
          :aria-expanded="colorsOpen"
          title="显示本页主色"
          aria-label="显示本页主色"
          @click="toggleColors"
        >
          <i class="bi bi-palette" aria-hidden="true"></i>
        </button>
        <div v-if="colorsOpen" class="search-dock-main-colors-panel" role="menu">
          <button
            v-for="color in aggregateColors"
            :key="color.hex"
            type="button"
            class="workbench-color-dot search-dock-color-dot"
            :title="`#${color.hex} · ${color.count} 张`"
            :style="{ backgroundColor: `#${color.hex}` }"
            role="menuitem"
            @click="pickColor(color.hex)"
          >
            <span class="visually-hidden">按主色筛选 #{{ color.hex }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="tools.selection || (tools.hidden && hiddenCount > 0)"
        class="search-dock-tool-group search-dock-select"
      >
        <button
          v-if="tools.selection"
          type="button"
          class="btn btn-sm search-dock-icon-btn search-dock-select-toggle"
          :class="selectionMode ? 'btn-primary' : 'btn-outline-secondary search-dock-nav-btn'"
          :aria-pressed="selectionMode"
          title="多选：点卡片勾选"
          aria-label="切换多选模式"
          @click="emit('toggle-selection-mode')"
        >
          <i class="bi bi-check2-square" aria-hidden="true"></i>
        </button>
        <button
          v-if="selectionMode"
          type="button"
          class="btn btn-sm search-dock-icon-btn search-dock-nav-btn"
          :class="allSelected ? 'btn-primary' : 'btn-outline-secondary'"
          :aria-pressed="allSelected"
          :title="allSelected ? '取消全选本页' : '全选本页可见'"
          :aria-label="allSelected ? '取消全选本页' : '全选本页可见'"
          :disabled="displayCount === 0"
          @click="emit('toggle-select-all')"
        >
          <i class="bi bi-check-all" aria-hidden="true"></i>
        </button>
        <button
          v-if="tools.hidden && hiddenCount > 0"
          type="button"
          class="btn btn-outline-warning btn-sm search-dock-icon-btn"
          :title="`恢复隐藏（${hiddenCount}）`"
          :aria-label="`恢复隐藏（${hiddenCount}）`"
          @click="emit('clear-hidden')"
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div
      v-if="showPager"
      class="search-dock-pager"
      role="navigation"
      aria-label="分页导航"
    >
      <button
        v-if="tools.pager"
        type="button"
        class="search-dock-pager-edge search-dock-pager-prev"
        :disabled="!canGoPrev || isLoading"
        title="上一页"
        aria-label="上一页"
        @click="emit('prev')"
      >
        <i class="bi bi-chevron-left" aria-hidden="true"></i>
      </button>

      <div v-if="tools.jump" class="search-dock-pager-core" role="group" aria-label="页码跳转">
        <label class="visually-hidden" for="search-dock-page-input">跳转到第几页</label>
        <span class="search-dock-pager-prefix">第</span>
        <input
          id="search-dock-page-input"
          v-model="pageInputModel"
          type="number"
          inputmode="numeric"
          class="search-dock-pager-input"
          min="1"
          :max="totalPages"
          :title="totalPagesTitle ? `${totalPagesTitle}，回车跳转` : '页码，回车跳转'"
          @keyup.enter="submitJump"
        />
        <span class="search-dock-pager-suffix">页</span>
        <span class="search-dock-pager-of" :title="totalPagesTitle">/ {{ formattedTotalPages }}</span>
        <button
          type="button"
          class="search-dock-pager-go"
          :disabled="!isValidPageNumber || isLoading"
          title="跳转到输入页码"
          aria-label="跳转到该页"
          @click="submitJump"
        >
          跳转
        </button>
      </div>

      <button
        v-if="tools.pager"
        type="button"
        class="search-dock-pager-edge search-dock-pager-next"
        :disabled="!canGoNext || isLoading"
        title="下一页（替换列表）"
        aria-label="下一页"
        @click="emit('next')"
      >
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>

      <button
        v-if="tools.more && infiniteScroll"
        type="button"
        class="search-dock-pager-more"
        :disabled="isLoading || !hasMorePages || !!wallhavenCooldown"
        title="立即拼接下一页（与滚动到底自动加载相同）"
        aria-label="加载更多"
        @click="emit('load-more')"
      >
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-dock-row {
  --dock-control-size: 2rem;
  --dock-ink: #18203b;
  --dock-muted: #6d748c;
  --dock-accent: #6a4fe0;
  --dock-active: #151a2d;
  --dock-line: rgba(21, 26, 45, 0.12);
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.45rem;
  width: max-content;
  max-width: 100%;
  min-width: 0;
}

.search-dock-meta {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0.28rem 0.62rem 0.28rem 0.52rem;
  box-shadow: inset 0 0 0 1px var(--dock-line);
}

.search-dock-meta > .search-dock-main,
.search-dock-bulk-scroll {
  min-width: 0;
}

.search-dock-bulk-scroll {
  display: flex;
  align-items: center;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.search-dock-bulk-scroll::-webkit-scrollbar {
  display: none;
}

.search-dock-main {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  color: var(--dock-ink);
}

.search-dock-summary-head {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  min-width: 0;
  white-space: nowrap;
}

.search-dock-summary-icon {
  flex-shrink: 0;
  font-size: 0.82rem;
  color: var(--dock-accent);
}

.search-dock-summary-title {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--dock-ink);
}

.search-dock-summary-sub {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--dock-muted);
}

.search-dock-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  flex-shrink: 0;
  padding-left: 0.48rem;
  border-left: 1px solid var(--dock-line);
}

.search-dock-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.18rem;
  white-space: nowrap;
}

.search-dock-stat-value {
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--dock-ink);
}

.search-dock-stat-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--dock-muted);
}

.search-dock-stat-sep {
  width: 3px;
  height: 3px;
  background: rgba(21, 26, 45, 0.28);
}

.search-dock-tools {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.28rem;
  flex-shrink: 0;
}

.search-dock-tool-group {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.14rem;
}

.search-dock-color-toggle.active {
  color: #fff;
  border: none;
  background: var(--dock-active);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
}

.search-dock-main-colors-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  z-index: 120;
  display: grid;
  grid-template-columns: repeat(8, 28px);
  gap: 6px;
  width: max-content;
  max-width: min(312px, calc(100vw - 32px));
  padding: 10px;
  border: 1px solid rgba(21, 26, 45, 0.14);
  background: #f7f7ff;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.55);
}

.search-dock-color-dot {
  appearance: none;
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0 !important;
  border-radius: 0 !important;
  outline: none;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.22);
  transition:
    box-shadow 0.14s ease,
    transform 0.14s ease;
}

.search-dock-color-dot:hover,
.search-dock-color-dot:focus-visible {
  transform: translate(-1px, -1px);
  box-shadow:
    inset 0 0 0 1px rgba(106, 79, 224, 0.55),
    2px 2px 0 rgba(106, 79, 224, 0.65);
}

.search-dock-color-dot:active {
  transform: none;
}

.search-dock-pager {
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
  min-height: var(--dock-control-size);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--dock-line);
  overflow: hidden;
}

.search-dock-pager:focus-within {
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.45);
}

.search-dock-pager-edge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.15rem;
  min-width: 2.15rem;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dock-muted);
  font-size: 0.95rem;
  line-height: 1;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.search-dock-pager-edge:hover:not(:disabled) {
  background: rgba(106, 79, 224, 0.08);
  color: var(--dock-accent);
}

.search-dock-pager-edge:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.search-dock-pager-prev {
  border-right: 1px solid var(--dock-line);
}

.search-dock-pager-next {
  border-left: 1px solid var(--dock-line);
}

.search-dock-pager-core {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0 0.42rem;
  min-width: 0;
}

.search-dock-pager-prefix,
.search-dock-pager-suffix {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--dock-muted);
  user-select: none;
}

.search-dock-pager-input {
  width: 2.35rem;
  min-width: 2.1rem;
  margin: 0;
  padding: 0.16rem 0.22rem;
  text-align: center;
  font-weight: 700;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--dock-ink);
  background: rgba(106, 79, 224, 0.06);
  border: none;
  box-shadow: none;
  transition: background 0.16s ease;
}

.search-dock-pager-input::-webkit-outer-spin-button,
.search-dock-pager-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.search-dock-pager-input[type='number'] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.search-dock-pager-input:focus {
  outline: none;
  background: rgba(106, 79, 224, 0.12);
}

.search-dock-pager-of {
  flex-shrink: 0;
  font-size: 0.66rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--dock-muted);
}

.search-dock-pager-go {
  flex-shrink: 0;
  margin-left: 0.08rem;
  padding: 0.18rem 0.46rem;
  border: none;
  background: var(--dock-active);
  color: #fff;
  font-size: 0.64rem;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.02em;
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
  transition:
    background 0.16s ease,
    opacity 0.16s ease;
}

.search-dock-pager-go:not(:disabled):hover {
  background: var(--dock-accent);
}

.search-dock-pager-go:disabled {
  opacity: 0.32;
  cursor: not-allowed;
  box-shadow: none;
}

.search-dock-pager-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2rem;
  min-width: 2rem;
  margin: 0;
  padding: 0;
  border: none;
  border-left: 1px solid var(--dock-line);
  background: transparent;
  color: var(--dock-muted);
  font-size: 0.82rem;
  line-height: 1;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.search-dock-pager-more:not(:disabled):hover {
  background: rgba(106, 79, 224, 0.08);
  color: var(--dock-accent);
}

.search-dock-pager-more:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.search-dock-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dock-control-size);
  min-width: var(--dock-control-size);
  height: var(--dock-control-size);
  padding: 0;
  border: none;
  border-radius: 0;
  font-size: 0.92rem;
  line-height: 1;
  box-shadow: inset 0 0 0 1px var(--dock-line);
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.search-dock-icon-btn:not(:disabled):active {
  transform: none;
}

.search-dock-nav-btn {
  border: none;
  background: transparent;
  color: var(--dock-ink);
}

.search-dock-nav-btn:hover:not(:disabled) {
  border: none;
  background: rgba(106, 79, 224, 0.08);
  color: var(--dock-accent);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.35);
}

.search-dock-icon-btn.btn-outline-secondary,
.search-dock-icon-btn.btn-outline-primary,
.search-dock-icon-btn.btn-outline-warning {
  border: none !important;
  outline: none;
  color: var(--dock-ink) !important;
  background: transparent !important;
}

.search-dock-icon-btn.btn-outline-warning {
  color: #e6b84d !important;
}

.search-dock-select-toggle.btn-primary {
  border: none !important;
  background: var(--dock-active) !important;
  color: #fff !important;
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75) !important;
}

.search-dock-row.is-scheme-dark {
  --dock-ink: #e8eaf4;
  --dock-muted: #9aa1b8;
  --dock-accent: #a08bff;
  --dock-active: #f0ecff;
  --dock-line: rgba(160, 139, 255, 0.28);
  color: var(--dock-ink);
}

.search-dock-row.is-scheme-dark .search-dock-meta,
.search-dock-row.is-scheme-dark .search-dock-pager,
.search-dock-row.is-scheme-dark .search-dock-icon-btn {
  box-shadow: inset 0 0 0 1px var(--dock-line);
}

.search-dock-row.is-scheme-dark .search-dock-summary-title,
.search-dock-row.is-scheme-dark .search-dock-stat-value,
.search-dock-row.is-scheme-dark .search-dock-nav-btn,
.search-dock-row.is-scheme-dark .search-dock-pager-edge,
.search-dock-row.is-scheme-dark .search-dock-pager-more,
.search-dock-row.is-scheme-dark .search-dock-pager-input,
.search-dock-row.is-scheme-dark .search-dock-icon-btn.btn-outline-secondary,
.search-dock-row.is-scheme-dark .search-dock-icon-btn.btn-outline-primary {
  color: #e8eaf4 !important;
}

.search-dock-row.is-scheme-dark .search-dock-summary-sub,
.search-dock-row.is-scheme-dark .search-dock-stat-label,
.search-dock-row.is-scheme-dark .search-dock-pager-prefix,
.search-dock-row.is-scheme-dark .search-dock-pager-suffix,
.search-dock-row.is-scheme-dark .search-dock-pager-of {
  color: #9aa1b8 !important;
}

.search-dock-row.is-scheme-dark .search-dock-summary-icon {
  color: #a08bff !important;
}

.search-dock-row.is-scheme-dark .search-dock-stat-sep {
  background: rgba(160, 139, 255, 0.35);
}

.search-dock-row.is-scheme-dark .search-dock-pager-prev,
.search-dock-row.is-scheme-dark .search-dock-pager-next,
.search-dock-row.is-scheme-dark .search-dock-pager-more {
  border-color: rgba(160, 139, 255, 0.16);
}

.search-dock-row.is-scheme-dark .search-dock-nav-btn:hover:not(:disabled),
.search-dock-row.is-scheme-dark .search-dock-pager-edge:hover:not(:disabled),
.search-dock-row.is-scheme-dark .search-dock-pager-more:not(:disabled):hover,
.search-dock-row.is-scheme-dark .search-dock-icon-btn.btn-outline-secondary:hover:not(:disabled),
.search-dock-row.is-scheme-dark .search-dock-icon-btn.btn-outline-primary:hover:not(:disabled) {
  color: #c4b5ff !important;
  background: rgba(106, 79, 224, 0.16) !important;
  box-shadow: inset 0 0 0 1px rgba(160, 139, 255, 0.45) !important;
}

.search-dock-row.is-scheme-dark .search-dock-main-colors-panel {
  border-color: rgba(160, 139, 255, 0.28);
  background: #161824;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.4);
}

.search-dock-row.is-scheme-dark .search-dock-color-dot {
  box-shadow: inset 0 0 0 1px rgba(160, 139, 255, 0.28);
}

.search-dock-row.is-scheme-dark .search-dock-color-dot:hover,
.search-dock-row.is-scheme-dark .search-dock-color-dot:focus-visible {
  box-shadow:
    inset 0 0 0 1px rgba(180, 160, 255, 0.65),
    2px 2px 0 rgba(180, 160, 255, 0.45);
}

.search-dock-row.is-scheme-dark .search-dock-pager-input {
  color: #e8eaf4 !important;
  background: rgba(106, 79, 224, 0.2);
}

.search-dock-row.is-scheme-dark .search-dock-select-toggle.btn-primary,
.search-dock-row.is-scheme-dark .search-dock-color-toggle.active,
.search-dock-row.is-scheme-dark .search-dock-pager-go {
  color: #151a2d !important;
  background: #f0ecff !important;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5) !important;
}

.search-dock-row.is-scheme-dark .search-dock-icon-btn.btn-outline-warning {
  color: #f0c95a !important;
}

/*
 * Compact / phone:
 * ┌──────────────────────────────────┐
 * │ 🔍 标题               29万 · 116 │
 * │ [色][选][眼]   [<][5 / 1.2万][>][+] │
 * └──────────────────────────────────┘
 */
@media (max-width: 920px) {
  .search-dock-row {
    --dock-control-size: 2rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'meta meta'
      'tools pager';
    align-items: center;
    column-gap: 0.5rem;
    row-gap: 0.45rem;
    width: 100%;
    max-width: 100%;
  }

  .search-dock-row:not(.has-tools) {
    grid-template-areas:
      'meta meta'
      'pager pager';
  }

  .search-dock-row:not(.has-pager) {
    grid-template-areas: 'meta tools';
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .search-dock-meta {
    grid-area: meta;
    justify-content: space-between;
    width: 100%;
    padding: 0.3rem 0.55rem;
  }

  .search-dock-main {
    width: 100%;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .search-dock-summary-head {
    flex: 1 1 auto;
    min-width: 0;
  }

  .search-dock-summary-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-dock-summary-sub {
    display: none;
  }

  .search-dock-stats {
    padding-left: 0;
    border-left: none;
    gap: 0.34rem;
  }

  .search-dock-stat-label {
    display: none;
  }

  .search-dock-tools {
    grid-area: tools;
    justify-self: start;
  }

  .search-dock-pager {
    grid-area: pager;
    justify-self: end;
    width: auto;
    max-width: 100%;
  }

  .search-dock-row:not(.has-tools) .search-dock-pager {
    justify-self: stretch;
    width: 100%;
  }

  .search-dock-row:not(.has-tools) .search-dock-pager-core {
    flex: 1 1 auto;
    justify-content: center;
  }

  /* Compact pager: page · total, enter to jump — no protruding 跳转 chip */
  .search-dock-pager-prefix,
  .search-dock-pager-suffix,
  .search-dock-pager-go {
    display: none;
  }

  .search-dock-pager-core {
    gap: 0.22rem;
    padding: 0 0.4rem;
  }

  .search-dock-pager-input {
    width: 2.2rem;
    min-width: 2rem;
  }

  .search-dock-pager-of {
    font-size: 0.7rem;
  }

  .search-dock-pager-edge {
    width: var(--dock-control-size);
    min-width: var(--dock-control-size);
  }

  .search-dock-pager-more {
    width: var(--dock-control-size);
    min-width: var(--dock-control-size);
  }

  .search-dock-main-colors-panel {
    left: 0;
    right: auto;
    transform: none;
    grid-template-columns: repeat(6, 28px);
  }
}

@media (max-width: 420px) {
  .search-dock-row {
    column-gap: 0.4rem;
    row-gap: 0.4rem;
  }

  .search-dock-summary-title {
    max-width: 8.5rem;
  }

  .search-dock-pager-of {
    max-width: 3.2rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
