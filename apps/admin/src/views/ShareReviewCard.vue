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
      <span class="share-card__author" :title="userName">{{ userName }}</span>
      <span class="share-card__kind" :title="kindText">{{ kindText }}</span>
    </div>

    <div class="share-card__body">
      <strong class="share-card__title" :title="title">{{ title }}</strong>
      <div class="share-card__header-actions">
        <button
          v-if="item.status === 'approved'"
          type="button"
          class="share-action is-prompt"
          :disabled="operating || Boolean(item.promptEntryId)"
          @click.stop="emit('prompt', item)"
        >
          {{ item.promptEntryId ? '已入' : '入词库' }}
        </button>
        <button
          v-if="canApprove"
          type="button"
          class="share-action is-approve"
          :disabled="operating"
          @click.stop="emit('approve', item)"
        >
          通过
        </button>
        <button
          v-if="canReject"
          type="button"
          class="share-action is-reject"
          :disabled="operating"
          @click.stop="emit('reject', item)"
        >
          拒绝
        </button>
        <button
          type="button"
          class="share-action is-violate"
          :disabled="operating"
          @click.stop="emit('violation', item)"
        >
          违规
        </button>
      </div>
      <p v-if="reviewNote" class="share-card__note" :title="reviewNote">{{ reviewNote }}</p>
    </div>
  </article>
</template>

<style scoped lang="scss">
.share-card {
  display: grid;
  grid-template-rows: auto auto;
  align-content: start;
  gap: 8px;
  width: 100%;
  height: 100%;
  min-width: 0;
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
    top: 32px;
    right: 8px;
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

.share-card__author,
.share-card__kind {
  position: absolute;
  bottom: 8px;
  z-index: 2;
  max-width: calc(50% - 10px);
  overflow: hidden;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgb(18 20 26 / 72%);
  color: #fff;
  font-size: 10px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.share-card__author {
  left: 8px;
}

.share-card__kind {
  right: 8px;
}

.share-card__body {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 2px 2px 1px;
}

.share-card__title {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-card__header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
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

.share-action {
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

  &.is-approve {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-prompt {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  &.is-reject {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-violate {
    background: var(--warning-soft);
    color: var(--warning);
  }
}
</style>
