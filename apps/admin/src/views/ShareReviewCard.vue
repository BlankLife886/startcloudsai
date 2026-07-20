<script setup lang="ts">
import { computed } from 'vue'
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

const title = computed(() => String(props.item.title || '共享作品').trim())

const userName = computed(
  () =>
    String(props.item.author?.username || '').trim() ||
    String(props.item.userEmail || '').trim() ||
    String(props.item.author?.id || '').trim() ||
    '未知用户',
)

const userHint = computed(() => {
  const email = String(props.item.userEmail || '').trim()
  return email && email !== userName.value ? email : ''
})

const userInitial = computed(() => userName.value.slice(0, 1).toUpperCase() || '?')

const kindText = computed(() => (props.item.taskType ? taskTypeLabel(props.item.taskType) : 'AI 生成'))

const coverUrl = computed(() => props.item.coverUrl ?? props.item.mediaUrls?.[0] ?? '')

const mediaCount = computed(() => props.item.mediaUrls?.length ?? (props.item.coverUrl ? 1 : 0))

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

const statusText = computed(() => SUBMISSION_STATUS_LABELS[props.item.status] ?? props.item.status ?? '未知')

const canApprove = computed(() => props.item.status !== 'approved')
const canReject = computed(() => props.item.status !== 'rejected')
const hasNote = computed(() => Boolean(String(props.item.reason || '').trim()))
</script>

<template>
  <article class="share-card" :class="`is-${item.status || 'unknown'}`">
    <div class="share-card__media">
      <button type="button" class="share-card__pane" title="点击全屏预览" @click="emit('preview', item)">
        <ProgressiveImage :src="coverUrl" :alt="title" />
        <em v-if="mediaCount > 1">{{ mediaCount }} 图</em>
      </button>
      <span class="share-card__badge">{{ statusText }}</span>
    </div>

    <div class="share-card__body">
      <div class="share-card__user">
        <span class="share-card__avatar">{{ userInitial }}</span>
        <div class="share-card__names">
          <strong :title="title">{{ title }}</strong>
          <small :title="`${userName}${userHint ? ` · ${userHint}` : ''}`">
            {{ userName }}
            <template v-if="userHint"> · {{ userHint }}</template>
          </small>
        </div>
      </div>

      <div class="share-card__meta">
        <span>{{ kindText }}</span>
        <span>{{ timeText }}</span>
      </div>

      <p v-if="hasNote" class="share-card__note" :title="item.reason ?? ''">
        {{ item.reason }}
      </p>

      <div class="share-card__actions">
        <button
          type="button"
          class="share-action is-approve"
          :disabled="operating || !canApprove"
          @click="emit('approve', item)"
        >
          通过
        </button>
        <button
          type="button"
          class="share-action is-reject"
          :disabled="operating || !canReject"
          @click="emit('reject', item)"
        >
          拒绝
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
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 1px;
  background: var(--el-bg-color);
  box-shadow: 4px 4px 0 rgb(114 88 232 / 5%);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &::before {
    position: absolute;
    inset: 0 auto auto 0;
    z-index: 3;
    width: 100%;
    height: 2px;
    content: '';
    background: #7258e8;
    pointer-events: none;
  }

  &.is-pending::before {
    background: var(--el-color-warning);
  }

  &.is-approved::before {
    background: var(--el-color-success);
  }

  &.is-rejected::before {
    background: var(--el-color-danger);
  }

  &.is-removed::before {
    background: var(--el-color-info);
  }

  &:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, #7258e8 42%, transparent);
    box-shadow: 5px 5px 0 rgb(114 88 232 / 8%);
  }
}

.share-card__media {
  position: relative;
  flex: 0 0 auto;
  aspect-ratio: 2.05 / 1;
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
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 62%, rgb(15 23 42 / 28%));
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  &:hover::after {
    opacity: 1;
  }

  em {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 1;
    padding: 3px 8px;
    border-radius: 1px;
    background: rgb(15 23 42 / 62%);
    color: #fff;
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    letter-spacing: 0.02em;
    pointer-events: none;
  }
}

.share-card__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 3px 8px;
  border-radius: 1px;
  background: rgb(15 23 42 / 66%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  pointer-events: none;
  backdrop-filter: blur(6px);
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
  display: grid;
  gap: 8px;
  padding: 12px;
}

.share-card__user {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.share-card__avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 1px;
  background: linear-gradient(135deg, var(--el-color-primary-light-7), var(--el-color-primary-light-5));
  color: var(--el-color-primary);
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
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
  }

  small {
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 1.3;
  }
}

.share-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    padding: 2px 7px;
    border-radius: 1px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-secondary);
    font-size: 11px;
    font-weight: 600;
  }
}

.share-card__note {
  margin: 0;
  overflow: hidden;
  padding: 6px 8px;
  border-radius: 1px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2, #b45309);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.share-card__actions {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 6px;
  margin-top: 2px;
}

.share-action {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 1px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    filter 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &.is-approve {
    border-color: #86efac;
    background: linear-gradient(180deg, #ecfdf5, #dcfce7);
    color: #15803d;
  }

  &.is-reject {
    border-color: #fecaca;
    background: #fff1f2;
    color: #b91c1c;
  }

  &.is-violate {
    border-color: #fde68a;
    background: #fffbeb;
    color: #b45309;
  }

  &:not(:disabled):hover {
    transform: translateY(-1px);
    filter: brightness(0.98);
    box-shadow: 0 6px 14px rgb(15 23 42 / 8%);
  }
}
</style>
