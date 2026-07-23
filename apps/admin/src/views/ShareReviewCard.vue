<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Picture } from '@element-plus/icons-vue'
import ProgressiveImage from '@/components/ProgressiveImage.vue'
import { SUBMISSION_STATUS_LABELS, taskTypeLabel } from '@/utils'
import type { AdminSubmission } from './GalleryView.vue'

const props = defineProps<{
  item: AdminSubmission
  operating: boolean
}>()

const emit = defineEmits<{
  preview: [item: AdminSubmission]
  approve: [item: AdminSubmission]
  reject: [item: AdminSubmission]
  violation: [item: AdminSubmission]
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

const userHint = computed(() => (email.value && email.value !== userName.value ? email.value : ''))
const userInitial = computed(() => userName.value.slice(0, 1).toUpperCase() || '?')

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
  if (!value) return '时间未知'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
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
    <div class="share-card__media">
      <button type="button" class="share-card__pane" :aria-label="`预览${title}`" @click="emit('preview', item)">
        <ProgressiveImage :src="coverUrl" :alt="title" />
        <span class="share-card__preview-hint">查看大图</span>
        <em v-if="mediaCount > 1"><el-icon><Picture /></el-icon>{{ mediaCount }}</em>
      </button>
      <span class="share-card__badge">{{ statusText }}</span>
    </div>

    <div class="share-card__body">
      <div class="share-card__heading">
        <strong :title="title">{{ title }}</strong>
        <span v-if="categoryText">{{ categoryText }}</span>
      </div>

      <div class="share-card__footer">
        <div class="share-card__user">
          <span class="share-card__avatar">{{ userInitial }}</span>
          <div class="share-card__names">
            <strong :title="userName">{{ userName }}</strong>
            <small v-if="userHint" :title="userHint">{{ userHint }}</small>
            <small v-else>投稿用户</small>
          </div>
        </div>

        <div class="share-card__meta">
          <span><el-icon><Picture /></el-icon>{{ kindText }}</span>
          <span><el-icon><Clock /></el-icon>{{ timeText }}</span>
        </div>

        <div v-if="reviewNote" class="share-card__note" :title="reviewNote">
          <span>处理说明</span>
          <p>{{ reviewNote }}</p>
        </div>

        <div class="share-card__actions">
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
    </div>
  </article>
</template>

<style scoped lang="scss">
.share-card {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    box-shadow: var(--shadow-md);
  }
}

.share-card__media {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--el-fill-color);
}

.share-card__pane {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--el-fill-color-light);
  cursor: zoom-in;

  &::after {
    position: absolute;
    inset: 0;
    content: '';
    background: linear-gradient(180deg, transparent 50%, rgb(15 23 42 / 38%));
    opacity: 0.42;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  &:hover::after,
  &:focus-visible::after {
    opacity: 0.8;
  }

  em {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgb(15 23 42 / 66%);
    color: #fff;
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    pointer-events: none;
  }
}

.share-card__preview-hint {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 1;
  color: rgb(255 255 255 / 88%);
  font-size: 11px;
  font-weight: 650;
  opacity: 0;
  transform: translateY(3px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
  pointer-events: none;
}

.share-card__pane:hover .share-card__preview-hint,
.share-card__pane:focus-visible .share-card__preview-hint {
  opacity: 1;
  transform: translateY(0);
}

.share-card__badge {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgb(15 23 42 / 72%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.share-card.is-approved .share-card__badge {
  background: rgb(22 163 74 / 90%);
}

.share-card.is-rejected .share-card__badge {
  background: rgb(220 38 38 / 90%);
}

.share-card.is-pending .share-card__badge {
  background: rgb(217 119 6 / 90%);
}

.share-card__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
}

.share-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  // 标题最多两行，为不同长度的投稿保留一致的卡片内容高度。
  min-height: calc(1.4em * 2);

  > strong {
    display: -webkit-box;
    overflow: hidden;
    min-width: 0;
    color: var(--el-text-color-primary);
    font-size: 14px;
    font-weight: 740;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  > span {
    flex: 0 0 auto;
    max-width: 88px;
    overflow: hidden;
    padding: 3px 7px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-size: 10px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.share-card__user {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.share-card__footer {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin-top: auto;
}

.share-card__avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.share-card__names {
  min-width: 0;

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--el-text-color-primary);
    font-size: 12px;
    font-weight: 680;
    line-height: 1.3;
  }

  small {
    margin-top: 2px;
    color: var(--el-text-color-secondary);
    font-size: 10px;
    line-height: 1.3;
  }
}

.share-card__meta {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
  padding-top: 9px;
  border-top: 1px solid var(--border);

  span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: var(--el-text-color-secondary);
    font-size: 10px;
    font-weight: 580;

    &:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-icon {
      flex: 0 0 auto;
      color: var(--el-text-color-placeholder);
    }
  }
}

.share-card__note {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 7px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--warning) 18%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--warning-soft) 60%, var(--surface));

  span {
    color: var(--warning);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  p {
    display: -webkit-box;
    overflow: hidden;
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 10px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}

.share-card__actions {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 6px;
  align-self: end;
  padding-top: 2px;
}

.share-action {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s ease;

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-approve {
    border-color: color-mix(in srgb, var(--success) 35%, transparent);
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-reject {
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-violate {
    border-color: color-mix(in srgb, var(--warning) 35%, transparent);
    background: var(--warning-soft);
    color: var(--warning);
  }

  &:not(:disabled):hover {
    filter: brightness(0.97);
  }
}

@media (max-width: 520px) {
  .share-card__body {
    padding: 12px;
  }

  .share-card__preview-hint {
    display: none;
  }
}
</style>
