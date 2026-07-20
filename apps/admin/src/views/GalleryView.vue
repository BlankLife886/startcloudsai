<script lang="ts">
/** 后台投稿（含 v3 审核增强字段） */
export interface AdminSubmission {
  id: string
  taskId?: string
  title: string
  status: string
  taskType?: string
  coverUrl?: string
  mediaUrls?: string[]
  author?: { id: string; username: string | null }
  userEmail?: string
  reason?: string | null
  featured?: boolean
  category?: { id: string; name: string } | null
  createdAt: string
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Refresh, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import { request, normalizeList, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import { formatTime, SUBMISSION_STATUS_LABELS, taskTypeLabel } from '@/utils'
import ShareReviewCard from './ShareReviewCard.vue'

const status = ref('pending')
const operatingId = ref('')

const statusFilters = [
  { label: '待审核', value: 'pending', type: 'warning' },
  { label: '已通过', value: 'approved', type: 'success' },
  { label: '已拒绝', value: 'rejected', type: 'danger' },
  { label: '已下架', value: 'removed', type: 'info' },
  { label: '全部', value: '', type: 'info' },
] as const

const { items, loading, error, hasPrev, hasNext, reset, next, prev, refresh, retry } =
  usePagedList<AdminSubmission>(
    (cursor) =>
      request<AdminSubmission[] | Page<AdminSubmission>>('/api/admin/gallery/submissions', {
        query: { status: status.value, limit: 12, cursor },
      }).then(normalizeList),
    () => status.value,
  )

function setStatusFilter(value: string) {
  if (status.value === value) return
  status.value = value
  void reset()
}

function userLabel(item: AdminSubmission | null) {
  if (!item) return '未知用户'
  return (
    String(item.author?.username || '').trim() ||
    String(item.userEmail || '').trim() ||
    String(item.author?.id || '').trim() ||
    '未知用户'
  )
}

function itemTitle(item: AdminSubmission | null) {
  return String(item?.title || '共享作品').trim()
}

function kindLabel(item: AdminSubmission | null) {
  return item?.taskType ? taskTypeLabel(item.taskType) : 'AI 生成'
}

function mediaListOf(item: AdminSubmission) {
  if (item.mediaUrls?.length) return item.mediaUrls
  return item.coverUrl ? [item.coverUrl] : []
}

/* ---------- 审核动作 ---------- */

async function approve(item: AdminSubmission) {
  if (operatingId.value) return
  operatingId.value = item.id
  try {
    await request(`/api/admin/gallery/submissions/${item.id}/review`, {
      method: 'POST',
      body: { action: 'approve' },
    })
    ElMessage.success('已通过，作品将公开展示')
    await refresh()
    syncPreviewItem()
  } finally {
    operatingId.value = ''
  }
}

/* 拒绝对话框 */
const rejectOpen = ref(false)
const rejectTarget = ref<AdminSubmission | null>(null)
const rejectNote = ref('')

const rejectReasonPresets = ['画面质量不足', '与社区风格不符', '疑似侵权或搬运', '含不当内容', '信息不完整'] as const

function openReject(item: AdminSubmission) {
  rejectTarget.value = item
  rejectNote.value = String(item.reason || '').trim()
  rejectOpen.value = true
}

function applyRejectPreset(reason: string) {
  const current = rejectNote.value.trim()
  if (!current) {
    rejectNote.value = reason
    return
  }
  if (current.includes(reason)) return
  rejectNote.value = `${current}；${reason}`
}

async function confirmReject() {
  const item = rejectTarget.value
  if (!item || operatingId.value) return
  if (!rejectNote.value.trim()) {
    ElMessage.warning('请填写拒绝原因')
    return
  }
  operatingId.value = item.id
  try {
    await request(`/api/admin/gallery/submissions/${item.id}/review`, {
      method: 'POST',
      body: { action: 'reject', reason: rejectNote.value.trim() },
    })
    rejectOpen.value = false
    rejectTarget.value = null
    ElMessage.success('已拒绝该投稿')
    await refresh()
    syncPreviewItem()
  } finally {
    operatingId.value = ''
  }
}

/* 违规处理对话框 */
const violationOpen = ref(false)
const violationTarget = ref<AdminSubmission | null>(null)
const violationForm = ref({ banDays: 7, deleteMedia: false, reason: '违规内容，禁止投稿共享作品' })

const banDayPresets = [0, 1, 3, 7, 30] as const

function openViolation(item: AdminSubmission) {
  violationTarget.value = item
  violationForm.value = {
    banDays: 7,
    deleteMedia: false,
    reason: `违规内容（${userLabel(item)}），禁止投稿共享作品`,
  }
  violationOpen.value = true
}

async function confirmViolation() {
  const item = violationTarget.value
  if (!item || operatingId.value) return
  if (!violationForm.value.reason.trim()) {
    ElMessage.warning('请填写违规原因')
    return
  }
  const banDays = Math.max(0, Math.min(365, Math.floor(Number(violationForm.value.banDays || 0))))
  try {
    await ElMessageBox.confirm(
      banDays > 0
        ? `将下架「${itemTitle(item)}」，并限制用户「${userLabel(item)}」投稿 ${banDays} 天。${violationForm.value.deleteMedia ? '媒体文件将被删除，此操作不可恢复。' : ''}`
        : `将下架「${itemTitle(item)}」。${violationForm.value.deleteMedia ? '媒体文件将被删除，此操作不可恢复。' : ''}`,
      '确认违规处理',
      { type: 'warning', confirmButtonText: banDays > 0 ? '下架并禁投' : '确认下架', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  operatingId.value = item.id
  try {
    await request(`/api/admin/gallery/submissions/${item.id}/violation`, {
      method: 'POST',
      body: { reason: violationForm.value.reason.trim(), banDays, deleteMedia: violationForm.value.deleteMedia },
    })
    violationOpen.value = false
    violationTarget.value = null
    ElMessage.success(banDays > 0 ? `已下架违规作品，并限制该用户投稿 ${banDays} 天` : '已下架违规作品')
    if (previewItem.value?.id === item.id) closePreview()
    await refresh()
  } finally {
    operatingId.value = ''
  }
}

/* ---------- 全屏预览（快捷键 A 通过 / R 拒绝 / ← → 切换 / Esc 关闭） ---------- */

const previewOpen = ref(false)
const previewItem = ref<AdminSubmission | null>(null)
const previewIndex = ref(0)
const previewMediaIndex = ref(0)

const previewUserName = computed(() => userLabel(previewItem.value))
const previewUserInitial = computed(() => previewUserName.value.slice(0, 1).toUpperCase() || '?')
const previewStatusText = computed(() =>
  previewItem.value ? (SUBMISSION_STATUS_LABELS[previewItem.value.status] ?? previewItem.value.status) : '',
)
const previewMedias = computed(() => (previewItem.value ? mediaListOf(previewItem.value) : []))
const previewMediaUrl = computed(() => previewMedias.value[previewMediaIndex.value] ?? '')

function openPreview(item: AdminSubmission) {
  const index = items.value.findIndex((row) => row.id === item.id)
  previewIndex.value = Math.max(0, index)
  previewItem.value = item
  previewMediaIndex.value = 0
  previewOpen.value = true
  document.body.style.overflow = 'hidden'
}

function closePreview() {
  if (!previewOpen.value) return
  previewOpen.value = false
  document.body.style.overflow = ''
}

function onPreviewAfterLeave() {
  previewItem.value = null
  previewMediaIndex.value = 0
}

function jumpPreview(offset: number) {
  if (!items.value.length) return
  const nextIndex = (previewIndex.value + offset + items.value.length) % items.value.length
  const nextItem = items.value[nextIndex]
  if (!nextItem) return
  previewIndex.value = nextIndex
  previewItem.value = nextItem
  previewMediaIndex.value = 0
}

/** 列表刷新后同步预览中的条目状态（条目可能已不在当前筛选下） */
function syncPreviewItem() {
  if (!previewOpen.value || !previewItem.value) return
  const found = items.value.find((row) => row.id === previewItem.value!.id)
  if (found) previewItem.value = found
  else closePreview()
}

function onPreviewKeydown(event: KeyboardEvent) {
  if (!previewOpen.value || !previewItem.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreview()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    jumpPreview(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    jumpPreview(1)
    return
  }
  const key = event.key.toLowerCase()
  if (key === 'a' && previewItem.value.status !== 'approved') {
    event.preventDefault()
    void approve(previewItem.value)
    return
  }
  if (key === 'r' && previewItem.value.status !== 'rejected') {
    event.preventDefault()
    openReject(previewItem.value)
  }
}

onMounted(() => {
  void reset()
  window.addEventListener('keydown', onPreviewKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onPreviewKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="community-ops-page">
    <div class="ops-toolbar-panel">
      <div class="share-toolbar">
        <div class="share-toolbar__lead">
          <strong class="share-toolbar__title">投稿审核</strong>
          <div class="share-toolbar__filters">
            <button
              v-for="filter in statusFilters"
              :key="filter.value || 'all'"
              type="button"
              class="share-filter"
              :class="{ 'is-active': status === filter.value, [`is-${filter.type}`]: true }"
              @click="setStatusFilter(filter.value)"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>
        <div class="share-toolbar__aside">
          <span v-if="items.length" class="share-toolbar__count">本页 {{ items.length }} 条</span>
          <el-button :icon="Refresh" :loading="loading" @click="reset">刷新</el-button>
        </div>
      </div>
    </div>

    <ListError :error="error" :loading="loading" @retry="retry" />

    <el-empty v-if="!loading && !items.length" description="当前没有待处理的投稿" />

    <div v-else-if="loading && !items.length" class="share-board" aria-label="正在加载投稿">
      <article v-for="index in 8" :key="index" class="share-card-skeleton">
        <div />
        <footer><span /><small /><em /></footer>
      </article>
    </div>

    <div v-else v-loading="loading" class="share-board">
      <ShareReviewCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :operating="operatingId === item.id"
        @preview="openPreview"
        @approve="approve"
        @reject="openReject"
        @violation="openViolation"
      />
    </div>

    <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />

    <Teleport to="body">
      <Transition name="share-lightbox" @after-leave="onPreviewAfterLeave">
        <div v-if="previewOpen && previewItem" class="share-lightbox" @click.self="closePreview">
          <div class="share-lightbox__stage">
            <button type="button" class="share-lightbox__nav is-prev" aria-label="上一张" title="上一张 ←" @click="jumpPreview(-1)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M14.5 5.5 8 12l6.5 6.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            <div class="share-lightbox__viewport">
              <Transition name="share-media" mode="out-in">
                <div :key="`${previewItem.id}:${previewMediaIndex}`" class="share-lightbox__media">
                  <img
                    v-if="previewMediaUrl"
                    class="share-lightbox__image"
                    :src="previewMediaUrl"
                    :alt="itemTitle(previewItem)"
                    decoding="async"
                  />
                  <div v-else class="share-lightbox__empty">暂无图片</div>
                </div>
              </Transition>
            </div>

            <button type="button" class="share-lightbox__nav is-next" aria-label="下一张" title="下一张 →" @click="jumpPreview(1)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9.5 5.5 16 12l-6.5 6.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <header class="share-lightbox__bar">
            <div class="share-lightbox__user">
              <span class="share-lightbox__avatar">{{ previewUserInitial }}</span>
              <div class="share-lightbox__copy">
                <div class="share-lightbox__title-row">
                  <strong>{{ itemTitle(previewItem) }}</strong>
                  <span class="share-lightbox__status" :class="`is-${previewItem.status || 'unknown'}`">
                    {{ previewStatusText }}
                  </span>
                </div>
                <small>
                  {{ previewUserName }} · {{ kindLabel(previewItem) }} · {{ formatTime(previewItem.createdAt) }}
                </small>
              </div>
            </div>
            <div class="share-lightbox__tools">
              <div v-if="previewMedias.length > 1" class="share-lightbox__switch" role="tablist" aria-label="媒体切换">
                <button
                  v-for="(url, index) in previewMedias"
                  :key="url"
                  type="button"
                  role="tab"
                  :aria-selected="previewMediaIndex === index"
                  :class="{ 'is-active': previewMediaIndex === index }"
                  @click="previewMediaIndex = index"
                >
                  图 {{ index + 1 }}
                </button>
              </div>
              <button type="button" class="share-lightbox__close" aria-label="关闭预览" @click="closePreview">
                <el-icon :size="18"><Close /></el-icon>
              </button>
            </div>
          </header>

          <footer class="share-lightbox__footer">
            <div class="share-lightbox__meta">
              <span class="share-lightbox__index">{{ previewIndex + 1 }} / {{ items.length }}</span>
              <span class="share-lightbox__hint">← → 切换 · A 通过 · R 拒绝 · Esc 关闭</span>
            </div>
            <div class="share-lightbox__actions" role="group" aria-label="审核操作">
              <button
                type="button"
                class="share-action is-approve"
                :disabled="operatingId === previewItem.id || previewItem.status === 'approved'"
                @click="approve(previewItem)"
              >
                通过
              </button>
              <button
                type="button"
                class="share-action is-reject"
                :disabled="operatingId === previewItem.id || previewItem.status === 'rejected'"
                @click="openReject(previewItem)"
              >
                拒绝
              </button>
              <button
                type="button"
                class="share-action is-violate"
                :disabled="operatingId === previewItem.id"
                @click="openViolation(previewItem)"
              >
                违规
              </button>
            </div>
          </footer>
        </div>
      </Transition>
    </Teleport>

    <el-dialog
      v-model="rejectOpen"
      align-center
      append-to-body
      destroy-on-close
      width="480px"
      class="share-review-dialog is-reject"
    >
      <template #header>
        <div class="share-review-dialog__header">
          <span class="share-review-dialog__icon is-reject">
            <el-icon :size="18"><CircleCloseFilled /></el-icon>
          </span>
          <div>
            <strong>拒绝投稿</strong>
            <small>拒绝后不会进入社区公开展示，原因将通知作者</small>
          </div>
        </div>
      </template>

      <div v-if="rejectTarget" class="share-review-dialog__summary">
        <div class="share-review-dialog__summary-main">
          <strong :title="itemTitle(rejectTarget)">{{ itemTitle(rejectTarget) }}</strong>
          <small>{{ userLabel(rejectTarget) }} · {{ kindLabel(rejectTarget) }}</small>
        </div>
        <span class="share-review-dialog__pill is-reject">拒绝</span>
      </div>

      <div class="share-review-dialog__section">
        <div class="share-review-dialog__label">
          <span>拒绝原因</span>
          <em>必填，将通知作者</em>
        </div>
        <div class="share-review-dialog__presets is-reject">
          <button
            v-for="reason in rejectReasonPresets"
            :key="reason"
            type="button"
            :class="{ 'is-active': rejectNote.includes(reason) }"
            @click="applyRejectPreset(reason)"
          >
            {{ reason }}
          </button>
        </div>
        <el-input
          v-model="rejectNote"
          type="textarea"
          :rows="4"
          maxlength="300"
          show-word-limit
          resize="none"
          placeholder="补充说明，例如质量、版权或内容问题…"
        />
      </div>

      <template #footer>
        <div class="share-review-dialog__footer">
          <el-button @click="rejectOpen = false">取消</el-button>
          <el-button
            type="danger"
            :loading="Boolean(rejectTarget && operatingId === rejectTarget.id)"
            @click="confirmReject"
          >
            确认拒绝
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="violationOpen"
      align-center
      append-to-body
      destroy-on-close
      width="520px"
      class="share-review-dialog is-violate"
    >
      <template #header>
        <div class="share-review-dialog__header">
          <span class="share-review-dialog__icon is-violate">
            <el-icon :size="18"><WarningFilled /></el-icon>
          </span>
          <div>
            <strong>违规处理</strong>
            <small>下架作品并可限制该用户继续投稿</small>
          </div>
        </div>
      </template>

      <div class="share-review-dialog__alert">
        <el-icon :size="16"><WarningFilled /></el-icon>
        <p>
          将下架「{{ itemTitle(violationTarget) }}」，并限制
          <strong>{{ userLabel(violationTarget) }}</strong>
          投稿。用户将收到违规通知。
        </p>
      </div>

      <div v-if="violationTarget" class="share-review-dialog__summary">
        <div class="share-review-dialog__summary-main">
          <strong :title="itemTitle(violationTarget)">{{ itemTitle(violationTarget) }}</strong>
          <small>{{ userLabel(violationTarget) }} · {{ kindLabel(violationTarget) }}</small>
        </div>
        <span class="share-review-dialog__pill is-violate">违规</span>
      </div>

      <div class="share-review-dialog__section">
        <div class="share-review-dialog__label">
          <span>禁投天数</span>
          <em>0 - 365 天，0 表示只下架不禁投</em>
        </div>
        <div class="share-review-dialog__presets is-violate">
          <button
            v-for="days in banDayPresets"
            :key="days"
            type="button"
            :class="{ 'is-active': violationForm.banDays === days }"
            @click="violationForm.banDays = days"
          >
            {{ days === 0 ? '仅下架' : `${days} 天` }}
          </button>
        </div>
        <el-input-number
          v-model="violationForm.banDays"
          :min="0"
          :max="365"
          :step="1"
          controls-position="right"
          style="width: 100%"
        />
      </div>

      <div class="share-review-dialog__section">
        <div class="share-review-dialog__label">
          <span>违规原因</span>
          <em>将记录到处理结果并通知用户</em>
        </div>
        <el-input
          v-model="violationForm.reason"
          type="textarea"
          :rows="4"
          maxlength="300"
          show-word-limit
          resize="none"
          placeholder="说明违规原因，便于运营追溯"
        />
      </div>

      <div class="share-review-dialog__section">
        <el-checkbox v-model="violationForm.deleteMedia">
          同时删除媒体文件（不可恢复）
        </el-checkbox>
      </div>

      <template #footer>
        <div class="share-review-dialog__footer">
          <el-button @click="violationOpen = false">取消</el-button>
          <el-button
            type="danger"
            :loading="Boolean(violationTarget && operatingId === violationTarget.id)"
            @click="confirmViolation"
          >
            {{ violationForm.banDays > 0 ? '下架并禁投' : '确认下架' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.community-ops-page {
  --community-accent: var(--accent);
  --community-line: var(--border);

  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 24px 28px;
}

.ops-toolbar-panel {
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid var(--community-line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.share-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.share-toolbar__lead {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.share-toolbar__title {
  position: relative;
  flex: 0 0 auto;
  padding-left: 10px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 760;

  &::before {
    position: absolute;
    top: 50%;
    left: 0;
    width: 3px;
    height: 16px;
    content: '';
    background: var(--community-accent);
    transform: translateY(-50%);
  }
}

.share-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--community-line);
  border-radius: 10px;
}

.share-toolbar__aside {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.share-toolbar__count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.share-filter {
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-right: 1px solid var(--community-line);
  border-radius: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;

  &:last-child {
    border-right: 0;
  }

  &:hover {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  &.is-active {
    background: var(--accent);
    color: #fff;
  }
}

.share-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  grid-auto-rows: 1fr;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.share-card-skeleton {
  min-height: 280px;
  overflow: hidden;
  border: 1px solid var(--community-line);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  content-visibility: auto;
  contain-intrinsic-size: 280px;

  > div {
    aspect-ratio: 2.05 / 1;
    background: linear-gradient(
      105deg,
      var(--el-fill-color-light) 22%,
      var(--el-fill-color) 42%,
      var(--el-fill-color-light) 62%
    );
    background-size: 220% 100%;
    animation: share-skeleton 1.2s linear infinite;
  }

  footer {
    padding: 14px;
    display: grid;
    gap: 10px;
  }

  footer span,
  footer small,
  footer em {
    display: block;
    height: 10px;
    border-radius: 999px;
    background: var(--el-fill-color);
  }

  footer small {
    width: 68%;
  }

  footer em {
    width: 42%;
    height: 22px;
    border-radius: 8px;
    font-style: normal;
  }
}

@keyframes share-skeleton {
  to {
    background-position: -220% 0;
  }
}

@media (max-width: 760px) {
  .share-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .share-toolbar__lead {
    align-items: stretch;
    flex-direction: column;
  }

  .share-toolbar__aside {
    justify-content: space-between;
  }

  .share-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .share-board {
    grid-template-columns: 1fr;
  }
}
</style>

<style lang="scss">
/* 灯箱与审核对话框 teleport 到 body，需全局样式 */
.share-lightbox {
  position: fixed;
  inset: 0;
  z-index: 4000;
  color: #fff;
  background: #05070c;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background:
      radial-gradient(circle at 50% 45%, transparent 42%, rgb(0 0 0 / 42%) 100%),
      linear-gradient(180deg, rgb(0 0 0 / 38%) 0%, transparent 18%, transparent 78%, rgb(0 0 0 / 48%) 100%);
  }
}

.share-lightbox-enter-active {
  transition: opacity 0.32s ease;
}

.share-lightbox-leave-active {
  transition: opacity 0.22s ease;
}

.share-lightbox-enter-from,
.share-lightbox-leave-to {
  opacity: 0;
}

.share-lightbox-enter-active .share-lightbox__bar {
  animation: share-lightbox-bar-in 0.38s cubic-bezier(0.22, 0.8, 0.24, 1) both;
}

.share-lightbox-enter-active .share-lightbox__stage {
  animation: share-lightbox-stage-in 0.42s cubic-bezier(0.22, 0.8, 0.24, 1) both;
}

.share-lightbox-enter-active .share-lightbox__footer {
  animation: share-lightbox-footer-in 0.38s cubic-bezier(0.22, 0.8, 0.24, 1) 0.05s both;
}

.share-media-enter-active,
.share-media-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 0.8, 0.24, 1);
}

.share-media-enter-from {
  opacity: 0;
  transform: scale(1.015);
}

.share-media-leave-to {
  opacity: 0;
  transform: scale(0.992);
}

@keyframes share-lightbox-bar-in {
  from {
    opacity: 0;
    transform: translateY(-14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes share-lightbox-footer-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes share-lightbox-stage-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(10px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .share-lightbox-enter-active,
  .share-lightbox-leave-active,
  .share-media-enter-active,
  .share-media-leave-active {
    transition: none;
  }

  .share-lightbox-enter-active .share-lightbox__bar,
  .share-lightbox-enter-active .share-lightbox__stage,
  .share-lightbox-enter-active .share-lightbox__footer {
    animation: none !important;
  }

  .share-media-enter-from,
  .share-media-leave-to {
    transform: none;
  }
}

.share-lightbox__bar,
.share-lightbox__footer {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px 28px;
  background: linear-gradient(180deg, rgb(5 7 12 / 78%) 0%, rgb(5 7 12 / 28%) 62%, transparent 100%);
  border: 0;
}

.share-lightbox__bar {
  top: 0;
}

.share-lightbox__footer {
  bottom: 0;
  padding: 28px 22px 18px;
  background: linear-gradient(0deg, rgb(5 7 12 / 82%) 0%, rgb(5 7 12 / 28%) 62%, transparent 100%);
}

.share-lightbox__user {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.share-lightbox__copy {
  min-width: 0;

  small {
    display: block;
    overflow: hidden;
    margin-top: 3px;
    color: rgb(255 255 255 / 62%);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.share-lightbox__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 740;
    line-height: 1.3;
  }
}

.share-lightbox__status {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;

  &.is-pending {
    background: rgb(217 119 6 / 88%);
  }

  &.is-approved {
    background: rgb(22 163 74 / 88%);
  }

  &.is-rejected {
    background: rgb(220 38 38 / 88%);
  }

  &.is-removed {
    background: rgb(100 116 139 / 88%);
  }
}

.share-lightbox__avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgb(129 140 248 / 70%), rgb(56 189 248 / 55%));
  font-size: 13px;
  font-weight: 700;
}

.share-lightbox__tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.share-lightbox__switch {
  display: inline-flex;
  padding: 3px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);

  button {
    min-height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: rgb(255 255 255 / 72%);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;

    &.is-active {
      background: #fff;
      color: #111827;
      box-shadow: 0 6px 16px rgb(0 0 0 / 18%);
    }
  }
}

.share-lightbox__close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 50%;
  background: rgb(255 255 255 / 8%);
  color: #fff;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;

  &:hover {
    background: rgb(255 255 255 / 16%);
    transform: scale(1.04);
  }
}

.share-lightbox__stage {
  position: absolute;
  inset: 0;
  z-index: 2;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.share-lightbox__viewport {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.share-lightbox__media {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.share-lightbox__image {
  display: block;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  object-fit: contain;
  object-position: center;
  user-select: none;
  -webkit-user-drag: none;
}

.share-lightbox__empty {
  display: grid;
  gap: 10px;
  place-content: center;
  justify-items: center;
  padding: 24px;
  color: rgb(255 255 255 / 62%);
  font-size: 13px;
  text-align: center;
}

.share-lightbox__nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 50%;
  background: rgb(8 10 16 / 42%);
  color: #fff;
  cursor: pointer;
  transform: translateY(-50%);
  backdrop-filter: blur(12px);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;

  svg {
    width: 20px;
    height: 20px;
  }

  &:hover {
    background: rgb(255 255 255 / 14%);
    border-color: rgb(255 255 255 / 24%);
  }

  &:active {
    transform: translateY(-50%) scale(0.96);
  }

  &.is-prev {
    left: 18px;
  }

  &.is-next {
    right: 18px;
  }
}

.share-lightbox__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  min-width: 0;
}

.share-lightbox__index {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.share-lightbox__hint {
  color: rgb(255 255 255 / 52%);
  font-size: 12px;
}

.share-lightbox__actions {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(96px, 1fr));
  gap: 0;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 12px;
  background: rgb(255 255 255 / 7%);

  .share-action {
    min-height: 38px;
    padding: 0 16px;
    border: 0;
    border-right: 1px solid rgb(255 255 255 / 10%);
    background: transparent;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;

    &:last-child {
      border-right: 0;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &.is-approve {
      color: #86efac;
    }

    &.is-reject {
      color: #fca5a5;
    }

    &.is-violate {
      color: #fcd34d;
    }

    &:not(:disabled):hover.is-approve {
      background: rgb(22 163 74 / 28%);
      color: #bbf7d0;
    }

    &:not(:disabled):hover.is-reject {
      background: rgb(220 38 38 / 28%);
      color: #fecaca;
    }

    &:not(:disabled):hover.is-violate {
      background: rgb(217 119 6 / 28%);
      color: #fde68a;
    }
  }
}

@media (max-width: 760px) {
  .share-lightbox__bar,
  .share-lightbox__footer {
    flex-direction: column;
    align-items: stretch;
  }

  .share-lightbox__nav,
  .share-lightbox__hint {
    display: none;
  }

  .share-lightbox__actions {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .share-lightbox__tools {
    justify-content: space-between;
  }

  .share-lightbox__image {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
  }
}

/* 审核对话框（拒绝 / 违规） */
.share-review-dialog {
  --community-dialog-line: var(--border);

  .share-review-dialog__header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding-right: 8px;

    strong,
    small {
      display: block;
    }

    strong {
      color: var(--el-text-color-primary);
      font-size: 15px;
      font-weight: 740;
      line-height: 1.3;
    }

    small {
      margin-top: 2px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.35;
    }
  }

  .share-review-dialog__icon {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;

    &.is-reject {
      background: var(--el-color-danger-light-9);
      color: var(--el-color-danger);
    }

    &.is-violate {
      background: var(--el-color-warning-light-9);
      color: var(--el-color-warning);
    }
  }

  .share-review-dialog__summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 12px;
    background: var(--surface-2);
    box-shadow: var(--shadow-sm);
  }

  .share-review-dialog__summary-main {
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
      font-size: 14px;
      font-weight: 700;
    }

    small {
      margin-top: 3px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }

  .share-review-dialog__pill {
    flex: 0 0 auto;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;

    &.is-reject {
      background: var(--danger-soft);
      color: var(--danger);
    }

    &.is-violate {
      background: var(--warning-soft);
      color: var(--warning);
    }
  }

  .share-review-dialog__alert {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: 12px;
    background: var(--danger-soft);
    color: var(--danger);

    .el-icon {
      flex: 0 0 auto;
      margin-top: 1px;
    }

    p {
      margin: 0;
      font-size: 13px;
      line-height: 1.55;
    }

    strong {
      font-weight: 740;
    }
  }

  .share-review-dialog__section {
    display: grid;
    gap: 8px;

    + .share-review-dialog__section {
      margin-top: 16px;
    }
  }

  .share-review-dialog__label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;

    span {
      color: var(--el-text-color-primary);
      font-size: 13px;
      font-weight: 700;
    }

    em {
      color: var(--el-text-color-secondary);
      font-size: 12px;
      font-style: normal;
    }
  }

  .share-review-dialog__presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    button {
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
      transition:
        border-color 0.15s ease,
        color 0.15s ease,
        background-color 0.15s ease,
        transform 0.15s ease;

      &:hover {
        transform: translateY(-1px);
        border-color: var(--el-color-primary-light-5);
        color: var(--el-color-primary);
      }
    }

    &.is-reject button.is-active {
      border-color: color-mix(in srgb, var(--danger) 40%, transparent);
      background: var(--danger-soft);
      color: var(--danger);
    }

    &.is-violate button.is-active {
      border-color: color-mix(in srgb, var(--warning) 40%, transparent);
      background: var(--warning-soft);
      color: var(--warning);
    }
  }

  .share-review-dialog__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    width: 100%;
  }
}
</style>
