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
  return taskType ? taskTypeLabel(taskType) : 'AI 作品'
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
      <header>
        <strong class="share-card__title" :title="title">{{ title }}</strong>
        <span v-if="categoryText" class="share-card__cat">{{ categoryText }}</span>
      </header>

      <div class="share-card__meta">
        <span :title="userName">{{ userName }}</span>
        <i>·</i>
        <span>{{ kindText }}</span>
      </div>

      <p v-if="reviewNote" class="share-card__note" :title="reviewNote">{{ reviewNote }}</p>

      <div class="share-card__actions">
        <button
          v-if="item.status === 'approved'"
          type="button"
          class="share-action is-prompt"
          :disabled="operating || Boolean(item.promptEntryId)"
          @click="emit('prompt', item)"
        >
          {{ item.promptEntryId ? '已入词库' : '入词库' }}
        </button>
        <button
          type="button"
          class="share-action is-approve"
          :disabled="operating || !canApprove"
          @click="emit('approve', item)"
        >
          {{ item.status === 'approved' ? '已通过' : '通过' }}
        </button>
        <button
          type="button"
          class="share-action is-reject"
          :disabled="operating || !canReject"
          @click="emit('reject', item)"
        >
          {{ item.status === 'rejected' ? '已拒绝' : '拒绝' }}
        </button>
        <button type="button" class="share-action is-violate" :disabled="operating" @click="emit('violation', item)">
          违规
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.share-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
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
  border-radius: 6px;
  background: #1c1917;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
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
  padding: 3px 7px;
  border-radius: 6px;
  background: rgb(28 25 23 / 78%);
  color: #fff;
  font-size: 10px;
  font-weight: 650;
  pointer-events: none;
}

.share-card__body {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 2px 2px 0;
}

.share-card__body > header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.share-card__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-card__cat {
  flex: 0 0 auto;
  max-width: 72px;
  overflow: hidden;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 10px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-card__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--muted);
  font-size: 11px;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  i {
    flex: 0 0 auto;
    font-style: normal;
    opacity: 0.5;
  }
}

.share-card__note {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--warning);
  font-size: 11px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.share-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}

.share-action {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: filter 0.15s ease;

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-approve {
    border-color: color-mix(in srgb, var(--success) 30%, transparent);
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-prompt {
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  &.is-reject {
    border-color: color-mix(in srgb, var(--danger) 30%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-violate {
    border-color: color-mix(in srgb, var(--warning) 30%, transparent);
    background: var(--warning-soft);
    color: var(--warning);
  }

  &:not(:disabled):hover {
    filter: brightness(0.97);
  }
}
</style>
