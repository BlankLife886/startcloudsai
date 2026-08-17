<script setup lang="ts">
import { computed } from 'vue'
import { Picture } from '@element-plus/icons-vue'
import { SUBMISSION_STATUS_LABELS, taskTypeLabel } from '@/utils'
import type { AdminSubmission } from './GalleryView.vue'

const props = defineProps<{
  item: AdminSubmission
  operating: boolean
  mediaHeight: number
  cardWidth: number
  imageLoading?: 'eager' | 'lazy'
}>()

const emit = defineEmits<{
  preview: [item: AdminSubmission]
  approve: [item: AdminSubmission]
  reject: [item: AdminSubmission]
  violation: [item: AdminSubmission]
  prompt: [item: AdminSubmission]
  measure: [item: AdminSubmission, event: Event]
}>()

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

const title = computed(() => cleanText(props.item.title) || '未命名作品')
const email = computed(() => cleanText(props.item.userEmail))

const userName = computed(() => {
  const username = cleanText(props.item.author?.username)
  if (username && !isUUID(username)) return username
  if (email.value) return email.value.split('@')[0] || '未设置昵称'
  return '未设置昵称'
})

const kindText = computed(() => {
  const taskType = cleanText(props.item.taskType)
  const source = cleanText(props.item.source || props.item.displayName)
  if (!taskType && !source) return 'AI 作品'
  return taskTypeLabel(taskType, props.item.params, source)
})

const coverUrl = computed(() => cleanText(props.item.coverUrl) || cleanText(props.item.mediaUrls?.[0]))

const mediaCount = computed(() => {
  const urls = new Set((props.item.mediaUrls ?? []).map(cleanText).filter(Boolean))
  return urls.size || (coverUrl.value ? 1 : 0)
})

const timeText = computed(() => {
  const value = cleanText(props.item.createdAt)
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
})

const normalizedStatus = computed(() => cleanText(props.item.status) || 'unknown')
const statusText = computed(() => SUBMISSION_STATUS_LABELS[normalizedStatus.value] ?? '状态待确认')
const canApprove = computed(() => props.item.status !== 'approved')
const canReject = computed(() => props.item.status !== 'rejected')
const reviewNote = computed(() => cleanText(props.item.rejectReason ?? props.item.reason))
const categoryText = computed(() => cleanText(props.item.category?.name))
</script>

<template>
  <article class="share-card" :class="`is-${normalizedStatus}`">
    <div class="share-card__media" :style="{ height: `${mediaHeight}px` }">
      <button type="button" class="share-card__pane" :aria-label="`预览${title}`" @click="emit('preview', item)">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          :alt="title"
          :loading="imageLoading || 'lazy'"
          decoding="async"
          draggable="false"
          :width="Math.max(1, Math.round(cardWidth))"
          :height="Math.max(1, mediaHeight)"
          @load="emit('measure', item, $event)"
        />
        <div v-else class="share-card__empty">暂无封面</div>
        <em v-if="mediaCount > 1"><el-icon><Picture /></el-icon>{{ mediaCount }}</em>
      </button>
      <span class="share-card__badge">{{ statusText }}</span>
      <span class="share-card__time">{{ timeText }}</span>
    </div>

    <div class="share-card__body">
      <strong class="share-card__title" :title="title">{{ title }}</strong>
      <div class="share-card__meta">
        <span :title="userName">{{ userName }}</span>
        <span>{{ kindText }}</span>
        <span v-if="categoryText">{{ categoryText }}</span>
      </div>
      <p v-if="reviewNote" class="share-card__note" :title="reviewNote">{{ reviewNote }}</p>
    </div>

    <div class="share-card__actions">
      <button
        v-if="item.status === 'approved'"
        type="button"
        class="share-action is-prompt"
        :disabled="operating || Boolean(item.promptEntryId)"
        @click="emit('prompt', item)"
      >
        {{ item.promptEntryId ? '已入' : '入词库' }}
      </button>
      <button
        v-if="canApprove"
        type="button"
        class="share-action is-approve"
        :disabled="operating"
        @click="emit('approve', item)"
      >
        通过
      </button>
      <button
        v-if="canReject"
        type="button"
        class="share-action is-reject"
        :disabled="operating"
        @click="emit('reject', item)"
      >
        拒绝
      </button>
      <button type="button" class="share-action is-violate" :disabled="operating" @click="emit('violation', item)">
        违规
      </button>
    </div>
  </article>
</template>

<style scoped lang="scss">
.share-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  margin: 0;
  padding: 8px 8px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-sizing: border-box;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
    box-shadow: var(--shadow-sm);

    .share-card__pane img {
      transform: scale(1.02);
    }
  }
}

.share-card__media {
  position: relative;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface-2);
}

.share-card__pane {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
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

  em {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 7px;
    border-radius: 6px;
    background: #1c1917;
    color: #fff;
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    pointer-events: none;
  }
}

.share-card__empty {
  display: grid;
  height: 100%;
  min-height: 120px;
  place-items: center;
  color: var(--ink-3);
  font-size: 12px;
  background: var(--surface-2);
}

.share-card__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgb(18 20 26 / 78%);
  color: #fff;
  font-size: 10px;
  font-weight: 740;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.share-card.is-approved .share-card__badge {
  background: var(--success);
}

.share-card.is-rejected .share-card__badge {
  background: var(--danger);
}

.share-card.is-pending .share-card__badge {
  background: var(--warning);
}

.share-card__time {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgb(18 20 26 / 72%);
  color: #fff;
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.share-card__body {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 12px 6px 10px;
}

.share-card__title {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 740;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.share-card__meta {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.3;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span + span::before {
    content: '·';
    margin: 0 6px;
    color: var(--ink-3);
  }
}

.share-card__note {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--warning);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-card__actions {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  margin: 0 -8px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}

.share-action {
  min-width: 0;
  min-height: 36px;
  padding: 0 4px;
  overflow: hidden;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:last-child {
    border-right: 0;
  }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  &.is-approve {
    color: var(--success);
  }

  &.is-prompt {
    color: var(--accent-ink);
  }

  &.is-reject {
    color: var(--danger);
  }

  &.is-violate {
    color: var(--warning);
  }

  &:not(:disabled):hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
}
</style>
