<script setup lang="ts">
import { computed } from 'vue'
import { Rank } from '@element-plus/icons-vue'
import ProgressiveImage from '@/components/ProgressiveImage.vue'
import type { CommunityWork } from './CommunityView.vue'

const props = defineProps<{
  item: CommunityWork
  operating: boolean
  categoryLabel: string
  selected: boolean
  draggable: boolean
}>()

const emit = defineEmits<{
  edit: [item: CommunityWork]
  feature: [item: CommunityWork]
  preview: [item: CommunityWork]
  select: [item: CommunityWork, selected: boolean]
}>()

const title = computed(() => String(props.item.title || '共享作品').trim())

const coverUrl = computed(() => props.item.coverUrl ?? props.item.mediaUrls?.[0] ?? '')

const authorText = computed(
  () => props.item.author?.username || props.item.userEmail || props.item.author?.id || '未知作者',
)

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

const isFeatured = computed(() => props.item.featured === true)
</script>

<template>
  <article class="community-card" :class="{ 'is-featured': isFeatured, 'is-selected': selected }">
    <div class="community-card__media">
      <el-checkbox
        class="community-card__select"
        :model-value="selected"
        :aria-label="`选择${title}`"
        @click.stop
        @change="(value: boolean | string | number) => emit('select', item, value === true)"
      />
      <button
        type="button"
        class="community-card__drag"
        :disabled="!draggable"
        :title="draggable ? '拖动调整作品顺序' : '清除筛选并显示全部作品后可排序'"
      >
        <el-icon :size="14"><Rank /></el-icon>
      </button>
      <button type="button" class="community-card__pane" title="点击全屏预览" @click="emit('preview', item)">
        <ProgressiveImage :src="coverUrl" :alt="title" />
        <em v-if="(item.mediaUrls?.length ?? 0) > 1">{{ item.mediaUrls!.length }} 图</em>
      </button>
      <span v-if="isFeatured" class="community-card__badge">★ 精选</span>
    </div>

    <div class="community-card__body">
      <strong class="community-card__title" :title="title">{{ title }}</strong>

      <div class="community-card__line" :title="`${categoryLabel} · ${timeText}`">
        <span>{{ categoryLabel }}</span>
        <i>·</i>
        <span>{{ timeText }}</span>
      </div>

      <div class="community-card__line is-muted" :title="authorText">
        <span>{{ authorText }}</span>
        <i>·</i>
        <span>排序 {{ item.sort ?? 0 }}</span>
      </div>

      <div class="community-card__tags">
        <span v-for="tag in (item.tags ?? []).slice(0, 2)" :key="tag">#{{ tag }}</span>
        <span v-if="(item.tags?.length ?? 0) > 2">+{{ item.tags!.length - 2 }}</span>
        <small v-if="!item.tags?.length">暂无标签</small>
      </div>

      <div class="community-card__actions">
        <button type="button" class="community-action" :disabled="operating" @click="emit('edit', item)">
          详情
        </button>
        <button
          type="button"
          class="community-action"
          :class="isFeatured ? 'is-on' : 'is-off'"
          :disabled="operating"
          @click="emit('feature', item)"
        >
          {{ isFeatured ? '已精选' : '精选' }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.community-card {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);

  &.is-featured {
    border-color: color-mix(in srgb, var(--violet) 40%, var(--border));
  }

  &.is-selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
}

.community-card__media {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--el-fill-color);
}

.community-card__select,
.community-card__drag {
  position: absolute;
  top: 7px;
  z-index: 3;
}

.community-card__select {
  left: 8px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 2px 8px rgb(15 23 42 / 16%);

  :deep(.el-checkbox__label) {
    display: none;
  }
}

.community-card__drag {
  right: 7px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: rgb(15 23 42 / 62%);
  color: #fff;
  cursor: grab;

  &:active:not(:disabled) {
    cursor: grabbing;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.community-card__pane {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--el-fill-color-light);
  cursor: zoom-in;

  em {
    position: absolute;
    right: 4px;
    bottom: 4px;
    z-index: 1;
    padding: 0 5px;
    border-radius: 999px;
    background: rgb(15 23 42 / 55%);
    color: #fff;
    font-size: 9px;
    font-style: normal;
    font-weight: 700;
    line-height: 1.6;
    pointer-events: none;
  }
}

.community-card__badge {
  position: absolute;
  top: 40px;
  left: 8px;
  z-index: 2;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--violet) 92%, transparent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.7;
  pointer-events: none;
}

.community-card__body {
  display: grid;
  grid-template-rows: 18px 16px 16px 20px 28px;
  gap: 4px;
  align-content: start;
  padding: 8px;
  min-height: 0;
}

.community-card__tags {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;

  span {
    overflow: hidden;
    max-width: 74px;
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-size: 9px;
    font-weight: 650;
    text-overflow: ellipsis;
  }

  small {
    color: var(--el-text-color-placeholder);
    font-size: 9px;
  }
}

.community-card__title {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-card__line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;

  span,
  i {
    flex: 0 1 auto;
    overflow: hidden;
    font-style: normal;
    text-overflow: ellipsis;
  }
}

.community-card__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-self: end;
}

.community-action {
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--surface-3);
  }

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-off {
    border-color: color-mix(in srgb, var(--violet) 35%, transparent);
    background: var(--violet-soft);
    color: var(--violet);
  }

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 35%, transparent);
    background: var(--success-soft);
    color: var(--success);
  }
}
</style>
