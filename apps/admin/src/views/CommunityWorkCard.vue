<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CommunityWork } from './CommunityView.vue'

const props = defineProps<{
  item: CommunityWork
  operating: boolean
  categoryLabel: string
  selected: boolean
  selectionMode: boolean
  mediaHeight: number
  cardWidth: number
  imageLoading?: 'eager' | 'lazy'
}>()

const emit = defineEmits<{
  edit: [item: CommunityWork]
  feature: [item: CommunityWork]
  preview: [item: CommunityWork]
  select: [item: CommunityWork, selected: boolean]
  measure: [item: CommunityWork, event: Event]
}>()

const coverImgRef = ref<HTMLImageElement | null>(null)

const title = computed(() => String(props.item.title || '共享作品').trim())
const coverUrl = computed(() => String(props.item.mediaUrls?.[0] || props.item.coverUrl || '').trim())
const authorText = computed(
  () => props.item.author?.username || props.item.userEmail || props.item.author?.id || '未知作者',
)
const isFeatured = computed(() => props.item.featured === true)
const mediaCount = computed(() => props.item.mediaUrls?.length ?? 0)

const timeText = computed(() => {
  const value = String(props.item.createdAt || '')
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
})

function emitMeasure(event: Event) {
  emit('measure', props.item, event)
}

function handleCoverClick() {
  if (props.selectionMode) {
    emit('select', props.item, !props.selected)
    return
  }
  emit('preview', props.item)
}

/** 缓存图可能在 @load 绑定前已完成，需补一次测高，避免按 3:4 占位导致上下留白 */
function measureIfComplete() {
  const image = coverImgRef.value
  if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return
  emitMeasure({ target: image } as unknown as Event)
}

onMounted(() => {
  void nextTick(measureIfComplete)
})

watch(coverUrl, () => {
  void nextTick(measureIfComplete)
})
</script>

<template>
  <article
    class="community-card"
    :class="{
      'is-featured': isFeatured,
      'is-selected': selected,
      'is-selection-mode': selectionMode,
    }"
  >
    <div
      class="community-cover"
      :class="{ 'has-image': Boolean(coverUrl) }"
      :style="{ height: `${mediaHeight}px` }"
      @click="handleCoverClick"
    >
      <img
        v-if="coverUrl"
        ref="coverImgRef"
        :src="coverUrl"
        :alt="title"
        :loading="imageLoading || 'lazy'"
        decoding="async"
        draggable="false"
        :width="Math.max(1, Math.round(cardWidth - 16))"
        :height="Math.max(1, mediaHeight)"
        @load="emitMeasure"
      />
      <div v-else class="community-cover__empty">暂无封面</div>

      <el-checkbox
        v-if="selectionMode"
        class="community-card__select"
        :model-value="selected"
        :aria-label="`选择${title}`"
        @click.stop
        @change="(value: boolean | string | number) => emit('select', item, value === true)"
      />
      <span v-if="isFeatured" class="community-card__badge">精选</span>
      <em v-if="mediaCount > 1" class="community-card__count">{{ mediaCount }} 图</em>
      <div v-if="item.tags?.length" class="community-cover__tags">
        <span v-for="tag in (item.tags ?? []).slice(0, 3)" :key="tag">{{ tag }}</span>
      </div>
      <span class="community-cover__time">{{ timeText }}</span>
    </div>

    <div class="community-card__body">
      <header>
        <strong class="community-card__title" :title="title">{{ title }}</strong>
        <div class="community-card__header-actions">
          <button type="button" class="community-action" :disabled="operating" @click.stop="emit('edit', item)">
            详情
          </button>
          <button
            type="button"
            class="community-action"
            :class="isFeatured ? 'is-on' : 'is-off'"
            :disabled="operating"
            @click.stop="emit('feature', item)"
          >
            {{ isFeatured ? '已精选' : '精选' }}
          </button>
        </div>
      </header>
      <div class="community-card__meta">
        <span>{{ categoryLabel }}</span>
        <i>·</i>
        <span :title="authorText">{{ authorText }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.community-card {
  display: grid;
  grid-template-rows: auto auto;
  align-content: start;
  width: 100%;
  height: 100%;
  min-width: 0;
  gap: 8px;
  margin: 0;
  padding: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);
  box-sizing: border-box;

  &:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-sm);

    .community-cover__tags,
    .community-cover__time {
      opacity: 1;
    }

    .community-cover.has-image img {
      transform: scale(1.02);
    }
  }

  &.is-featured {
    border-color: color-mix(in srgb, var(--violet) 40%, var(--border));
  }

  &.is-selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  &.is-selection-mode .community-cover {
    cursor: pointer;
  }
}

.community-cover {
  position: relative;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface-2);
  cursor: zoom-in;

  img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--surface-2);
    transition: transform 0.35s ease;
  }
}

.community-cover__empty {
  display: grid;
  height: 100%;
  min-height: 120px;
  place-items: center;
  color: var(--ink-3);
  font-size: 12px;
  background: var(--surface-2);
}

.community-card__select {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 4;
  display: grid;
  width: 28px;
  height: 28px;
  margin: 0;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 8px;
  background: rgb(15 23 42 / 68%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);

  :deep(.el-checkbox__label) {
    display: none;
  }

  :deep(.el-checkbox__inner) {
    width: 16px;
    height: 16px;
  }
}

.community-card__badge {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--violet);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  pointer-events: none;
}

.community-card__count {
  position: absolute;
  top: 46px;
  right: 10px;
  z-index: 3;
  padding: 3px 7px;
  border-radius: 999px;
  background: #1c1917;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 1.2;
  pointer-events: none;
}

.community-cover__tags {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: calc(100% - 72px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;

  > span {
    max-width: 100%;
    padding: 4px 9px;
    overflow: hidden;
    border-radius: 999px;
    color: #1c1917;
    background: #fff;
    font-size: 10px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.community-card.is-featured .community-cover__tags {
  top: 40px;
}

.community-cover__time {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  padding: 3px 7px;
  border-radius: 999px;
  color: #fff;
  background: #1c1917;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.community-card__body {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 2px 2px 1px;

  > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
}

.community-card__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-card__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.community-card__meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  white-space: nowrap;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  i {
    flex: 0 0 auto;
    font-style: normal;
  }
}

.community-action {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--ink);
    background: var(--accent-soft);
  }

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-off {
    background: var(--violet-soft);
    color: var(--violet);
  }

  &.is-on {
    background: var(--success-soft);
    color: var(--success);
  }
}
</style>
