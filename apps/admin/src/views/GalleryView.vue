<script lang="ts">
/** 后台投稿（含 v3 审核增强字段） */
export interface AdminSubmission {
  id: string
  taskId?: string
  title: string
  status: string
  taskType?: string
  source?: string
  displayName?: string
  params?: Record<string, unknown>
  taskPrompt?: string
  taskModel?: string
  promptEntryId?: string
  coverUrl?: string
  mediaUrls?: string[]
  tags?: string[]
  author?: { id: string; username: string | null }
  userEmail?: string
  reason?: string | null
  rejectReason?: string | null
  featured?: boolean
  category?: { id: string; name: string } | null
  createdAt: string
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Refresh, CircleCloseFilled, CollectionTag, Picture, WarningFilled } from '@element-plus/icons-vue'
import { request, normalizeList, type Page } from '@/request'
import { useVirtualMasonryFeed } from '@/composables/useVirtualMasonryFeed'
import { formatTime, SUBMISSION_STATUS_LABELS, TASK_TYPES, taskTypeLabel } from '@/utils'
import AdminDialog from '@/components/AdminDialog.vue'
import ProgressiveImage from '@/components/ProgressiveImage.vue'
import ShareReviewCard from './ShareReviewCard.vue'

const status = ref('pending')
const operatingId = ref('')

const statusFilters = [
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已下架', value: 'removed' },
  { label: '全部', value: '' },
] as const

const items = ref<AdminSubmission[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const total = ref<number | null>(null)
let requestVersion = 0

const hasMore = computed(() => nextCursor.value !== null)
const galleryFeedRef = ref<HTMLElement | null>(null)
const isGridScrolling = ref(false)
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

async function loadSubmissionsPage(cursor: string | null, mode: 'replace' | 'append' = 'replace') {
  const version = ++requestVersion
  const append = mode === 'append'
  if (append) {
    if (!cursor || loading.value || loadingMore.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    error.value = null
  }
  try {
    const page = normalizeList(
      await request<AdminSubmission[] | Page<AdminSubmission>>('/api/v1/admin/gallery/submissions', {
        query: { status: status.value, limit: 24, cursor },
      }),
    )
    if (version !== requestVersion) return
    if (append) {
      const seen = new Set(items.value.map((item) => item.id))
      items.value = [...items.value, ...page.items.filter((item) => !seen.has(item.id))]
    } else {
      items.value = page.items
      await nextTick()
      galleryFeedRef.value?.scrollTo({ top: 0, behavior: 'auto' })
    }
    nextCursor.value = page.nextCursor
    total.value = page.total ?? page.scopeTotal ?? null
  } catch (cause) {
    if (version !== requestVersion) return
    if (!append) {
      items.value = []
      error.value = cause instanceof Error && cause.message ? cause.message : '加载失败，请重试'
    } else {
      ElMessage.error('加载更多失败，请重试')
    }
  } finally {
    if (version !== requestVersion) return
    if (append) loadingMore.value = false
    else loading.value = false
    await nextTick()
    scheduleViewportMeasure()
    void fillViewportIfNeeded()
  }
}

async function fillViewportIfNeeded() {
  const el = galleryFeedRef.value
  if (!el || !hasMore.value || loading.value || loadingMore.value) return
  if (el.scrollHeight > el.clientHeight + 120) return
  await loadMore()
}

function reset() {
  nextCursor.value = null
  return loadSubmissionsPage(null, 'replace')
}

function loadMore() {
  if (!nextCursor.value || loading.value || loadingMore.value) return
  return loadSubmissionsPage(nextCursor.value, 'append')
}

function retry() {
  return reset()
}

function refresh() {
  return reset()
}

function setStatusFilter(value: string) {
  if (status.value === value) return
  status.value = value
  void reset()
}

const masonryItems = computed(() =>
  items.value.map((item, index) => ({
    key: item.id,
    item,
    index,
    aspect: '3 / 4',
  })),
)

const {
  containerRef: masonryRef,
  visibleItems: visibleMasonryItems,
  columnCount,
  totalHeight: masonryHeight,
  measureFromEvent,
  scheduleViewportMeasure,
} = useVirtualMasonryFeed({
  items: masonryItems,
  fallbackAspect: 3 / 4,
  bodyHeight: 72,
  mediaInset: 8,
  minColumnWidth: 168,
  maxColumns: 6,
  overscan: 960,
  getAspect: (entry) => entry.aspect,
  scrollParent: galleryFeedRef,
})

function imageLoadingMode(index: number) {
  return index < Math.max(6, columnCount.value * 2) ? 'eager' : 'lazy'
}

function onGalleryScroll() {
  if (!isGridScrolling.value) isGridScrolling.value = true
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    isGridScrolling.value = false
  }, 140)

  scheduleViewportMeasure()

  const el = galleryFeedRef.value
  if (!el || !hasMore.value || loading.value || loadingMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
    void loadMore()
  }
}

function userLabel(item: AdminSubmission | null) {
  if (!item) return '未知用户'
  const username = String(item.author?.username || '').trim()
  const email = String(item.userEmail || '').trim()
  const id = String(item.author?.id || '').trim()
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(username)
  if (username && !isUUID) return username
  if (email) return email.split('@')[0] || email
  if (id) return id
  return '未知用户'
}

function itemTitle(item: AdminSubmission | null) {
  return String(item?.title || '共享作品').trim()
}

function kindLabel(item: AdminSubmission | null) {
  if (!item) return 'AI 生成'
  return taskTypeLabel(item.taskType || '', item.params, item.source || item.displayName)
}

function mediaListOf(item: AdminSubmission) {
  if (item.mediaUrls?.length) return item.mediaUrls
  return item.coverUrl ? [item.coverUrl] : []
}

const PROMPT_CATEGORIES = [
  { value: 'portrait', label: '人像人物' },
  { value: 'photography', label: '摄影写实' },
  { value: 'product', label: '产品商业' },
  { value: 'illustration', label: '插画动漫' },
  { value: 'scene', label: '场景建筑' },
  { value: 'design', label: '视觉设计' },
  { value: 'game', label: '游戏美术' },
  { value: 'typography', label: '文字排版' },
  { value: 'other', label: '其他' },
] as const

function defaultPromptCategory(taskType = '') {
  if (taskType === 'game_art') return 'game'
  if (
    taskType === 'ui_design' ||
    taskType === 'ecommerce_design' ||
    taskType === 'model_sheet' ||
    taskType === 'puzzle'
  ) return 'design'
  if (taskType === 'coloring') return 'illustration'
  return 'other'
}

const promptCreatorOpen = ref(false)
const promptCreatorSaving = ref(false)
const promptCreatorTarget = ref<AdminSubmission | null>(null)
const promptCreatorMediaIndex = ref(0)
const promptCreatorForm = reactive({
  title: '',
  prompt: '',
  taskType: 't2i',
  category: 'other',
  tagsText: '',
  active: true,
})
const promptCreatorImage = computed(() => {
  const target = promptCreatorTarget.value
  return target ? mediaListOf(target)[promptCreatorMediaIndex.value] || target.coverUrl || '' : ''
})

function normalizePromptTitle(value: unknown) {
  return Array.from(String(value || '').trim()).slice(0, 80).join('')
}

function openPromptCreator(item: AdminSubmission, mediaIndex = 0) {
  if (item.status !== 'approved') {
    ElMessage.warning('请先审核通过，再加入提示词库')
    return
  }
  if (item.promptEntryId) {
    ElMessage.info('这张作品已经加入提示词库')
    return
  }
  const canvas =
    item.source === 'react_canvas' ||
    item.displayName === '无限画布' ||
    item.displayName === '画布去背'
  const taskType = canvas
    ? 'infinite_canvas'
    : TASK_TYPES.includes(item.taskType as (typeof TASK_TYPES)[number])
      ? String(item.taskType)
      : 't2i'
  promptCreatorTarget.value = item
  promptCreatorMediaIndex.value = Math.max(0, Math.min(mediaIndex, mediaListOf(item).length - 1))
  promptCreatorForm.title = normalizePromptTitle(itemTitle(item))
  promptCreatorForm.prompt = String(item.taskPrompt || item.title || '').trim()
  promptCreatorForm.taskType = taskType
  promptCreatorForm.category = defaultPromptCategory(taskType)
  promptCreatorForm.tagsText = Array.isArray(item.tags) ? item.tags.join('，') : ''
  promptCreatorForm.active = true
  promptCreatorOpen.value = true
}

async function createPromptFromSubmission() {
  const target = promptCreatorTarget.value
  if (!target || promptCreatorSaving.value) return
  if (!promptCreatorForm.title.trim() || !promptCreatorForm.prompt.trim()) {
    ElMessage.warning('请填写提示词名称和内容')
    return
  }
  promptCreatorSaving.value = true
  try {
    const created = await request<{ id: string }>(`/api/v1/admin/gallery/submissions/${target.id}/prompts`, {
      method: 'POST',
      body: {
        title: normalizePromptTitle(promptCreatorForm.title),
        prompt: promptCreatorForm.prompt.trim(),
        taskType: promptCreatorForm.taskType,
        category: promptCreatorForm.category,
        tags: promptCreatorForm.tagsText.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        active: promptCreatorForm.active,
        mediaIndex: promptCreatorMediaIndex.value,
      },
    })
    target.promptEntryId = created.id
    const listed = items.value.find((item) => item.id === target.id)
    if (listed) listed.promptEntryId = created.id
    if (previewItem.value?.id === target.id) previewItem.value.promptEntryId = created.id
    promptCreatorOpen.value = false
    ElMessage.success('已加入提示词库，并复制审核图片作为封面')
  } finally {
    promptCreatorSaving.value = false
  }
}

/* ---------- 审核动作 ---------- */

async function approve(item: AdminSubmission) {
  if (operatingId.value) return
  operatingId.value = item.id
  try {
    await request(`/api/v1/admin/gallery/submissions/${item.id}/reviews`, {
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
  rejectNote.value = String(item.rejectReason ?? item.reason ?? '').trim()
  rejectOpen.value = true
}

function applyRejectPreset(reason: string) {
  const parts = rejectNote.value
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const index = parts.indexOf(reason)
  if (index >= 0) parts.splice(index, 1)
  else parts.push(reason)
  rejectNote.value = parts.join('；')
}

function rejectPresetSelected(reason: string) {
  return rejectNote.value
    .split(/[；;]/)
    .map((part) => part.trim())
    .includes(reason)
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
    await request(`/api/v1/admin/gallery/submissions/${item.id}/reviews`, {
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
    await request(`/api/v1/admin/gallery/submissions/${item.id}/violations`, {
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
const previewStatusText = computed(() =>
  previewItem.value ? (SUBMISSION_STATUS_LABELS[previewItem.value.status] ?? previewItem.value.status) : '',
)
const previewMedias = computed(() => (previewItem.value ? mediaListOf(previewItem.value) : []))
const previewMediaUrl = computed(() => previewMedias.value[previewMediaIndex.value] ?? '')
const previewHasNeighbors = computed(() => items.value.length > 1)
const previewCanApprove = computed(() => previewItem.value?.status !== 'approved')
const previewCanReject = computed(() => previewItem.value?.status !== 'rejected')

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
  if (rejectOpen.value || violationOpen.value || promptCreatorOpen.value) return
  const target = event.target as HTMLElement | null
  if (target && (target.closest('input, textarea, [contenteditable="true"]'))) return
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
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
})
</script>

<template>
  <div class="gallery-page">
    <header class="gallery-toolbar">
      <div class="gallery-tabs" role="tablist" aria-label="审核状态">
        <button
          v-for="filter in statusFilters"
          :key="filter.value || 'all'"
          type="button"
          role="tab"
          class="gallery-tab"
          :class="{ 'is-active': status === filter.value }"
          :aria-selected="status === filter.value"
          @click="setStatusFilter(filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
      <div class="gallery-toolbar__right">
        <el-button :icon="Refresh" :loading="loading" @click="reset">刷新</el-button>
      </div>
    </header>

    <ListError :error="error" :loading="loading" @retry="retry" />

    <div class="gallery-board">
      <div
        ref="galleryFeedRef"
        v-loading="loading && items.length > 0"
        class="share-feed"
        :class="{ 'is-scrolling': isGridScrolling }"
        @scroll.passive="onGalleryScroll"
      >
        <div v-if="loading && !items.length" class="share-feed__loading">正在加载投稿…</div>

        <div v-else-if="!items.length" class="gallery-empty">
          <el-icon><Picture /></el-icon>
          <strong>{{ status === 'pending' ? '没有待审核投稿' : '当前状态没有投稿' }}</strong>
          <span>{{ status === 'pending' ? '新投稿会显示在这里' : '换一个状态再看' }}</span>
        </div>

        <div
          v-else
          ref="masonryRef"
          class="share-masonry"
          :style="{ height: `${masonryHeight}px` }"
        >
          <ShareReviewCard
            v-for="entry in visibleMasonryItems"
            :key="entry.key"
            :style="{
              position: 'absolute',
              top: '0',
              left: '0',
              width: `${entry.width}px`,
              height: `${entry.height}px`,
              transform: `translate3d(${entry.left}px, ${entry.top}px, 0)`,
              willChange: 'transform',
            }"
            :item="entry.item"
            :operating="operatingId === entry.item.id"
            :media-height="entry.mediaHeight"
            :card-width="entry.width"
            :image-loading="imageLoadingMode(entry.index)"
            @preview="openPreview"
            @approve="approve"
            @reject="openReject"
            @violation="openViolation"
            @prompt="openPromptCreator"
            @measure="(item, event) => measureFromEvent(item.id, event)"
          />
        </div>

        <div v-if="items.length" class="share-load-status" :class="{ 'is-loading': loadingMore }">
          <span v-if="loadingMore">正在加载更多…</span>
          <span v-else-if="!hasMore">已加载全部 {{ total ?? items.length }} 条</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="share-lightbox" @after-leave="onPreviewAfterLeave">
        <div v-if="previewOpen && previewItem" class="share-lightbox" @click="closePreview">
          <header class="share-lightbox__bar">
            <div class="share-lightbox__copy">
              <strong :title="itemTitle(previewItem)">{{ itemTitle(previewItem) }}</strong>
              <span class="share-lightbox__status" :class="`is-${previewItem.status || 'unknown'}`">
                {{ previewStatusText }}
              </span>
              <span class="share-lightbox__facts">
                {{ previewUserName }}
                · {{ kindLabel(previewItem) }}
                · {{ formatTime(previewItem.createdAt) }}
                <template v-if="previewItem.category?.name"> · {{ previewItem.category.name }}</template>
              </span>
            </div>
            <button type="button" class="share-lightbox__close" aria-label="关闭预览" @click.stop="closePreview">
              <el-icon :size="18"><Close /></el-icon>
            </button>
          </header>

          <div class="share-lightbox__stage">
            <button
              v-if="previewHasNeighbors"
              type="button"
              class="share-lightbox__nav is-prev"
              aria-label="上一张"
              title="上一张 ←"
              @click.stop="jumpPreview(-1)"
            >
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
                  <ProgressiveImage
                    v-if="previewMediaUrl"
                    class="share-lightbox__image"
                    :src="previewMediaUrl"
                    :alt="itemTitle(previewItem)"
                    fit="contain"
                    @click.stop
                  />
                  <div v-else class="share-lightbox__empty" @click.stop>暂无图片</div>
                </div>
              </Transition>
            </div>

            <button
              v-if="previewHasNeighbors"
              type="button"
              class="share-lightbox__nav is-next"
              aria-label="下一张"
              title="下一张 →"
              @click.stop="jumpPreview(1)"
            >
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

          <footer class="share-lightbox__footer">
            <span class="share-lightbox__index tnum">{{ previewIndex + 1 }} / {{ items.length }}</span>
            <div
              v-if="previewMedias.length > 1"
              class="share-lightbox__dots"
              role="tablist"
              aria-label="媒体切换"
            >
              <button
                v-for="(url, index) in previewMedias"
                :key="url"
                type="button"
                role="tab"
                :aria-label="`第 ${index + 1} 张`"
                :aria-selected="previewMediaIndex === index"
                :class="{ 'is-active': previewMediaIndex === index }"
                @click.stop="previewMediaIndex = index"
              />
            </div>
            <div class="share-lightbox__actions" role="group" aria-label="审核操作">
              <button
                v-if="previewItem.status === 'approved'"
                type="button"
                class="share-action is-prompt"
                :disabled="operatingId === previewItem.id || Boolean(previewItem.promptEntryId)"
                @click.stop="openPromptCreator(previewItem, previewMediaIndex)"
              >
                {{ previewItem.promptEntryId ? '已入' : '入词库' }}
              </button>
              <button
                v-if="previewCanApprove"
                type="button"
                class="share-action is-approve"
                :disabled="operatingId === previewItem.id"
                @click.stop="approve(previewItem)"
              >
                通过
              </button>
              <button
                v-if="previewCanReject"
                type="button"
                class="share-action is-reject"
                :disabled="operatingId === previewItem.id"
                @click.stop="openReject(previewItem)"
              >
                拒绝
              </button>
              <button
                type="button"
                class="share-action is-violate"
                :disabled="operatingId === previewItem.id"
                @click.stop="openViolation(previewItem)"
              >
                违规
              </button>
            </div>
          </footer>
        </div>
      </Transition>
    </Teleport>

    <AdminDialog
      v-model="promptCreatorOpen"
      title="加入提示词库"
      :icon="CollectionTag"
      width="min(860px, 94vw)"
      nested-scroll
      confirm-text="加入提示词库"
      :confirm-loading="promptCreatorSaving"
      @confirm="createPromptFromSubmission"
    >
      <div class="gallery-prompt-layout">
        <aside class="gallery-prompt-cover">
          <ProgressiveImage v-if="promptCreatorImage" :src="promptCreatorImage" :alt="promptCreatorForm.title" fit="contain" />
          <div v-else><el-icon><CollectionTag /></el-icon><span>暂无图片</span></div>
        </aside>
        <el-form label-position="top" class="gallery-prompt-form">
          <el-form-item label="提示词名称">
            <el-input v-model="promptCreatorForm.title" maxlength="80" show-word-limit />
          </el-form-item>
          <el-form-item label="提示词内容">
            <el-input v-model="promptCreatorForm.prompt" type="textarea" :rows="7" maxlength="8000" show-word-limit />
          </el-form-item>
          <div class="gallery-prompt-form__row">
            <el-form-item label="投放功能">
              <el-select v-model="promptCreatorForm.taskType">
                <el-option v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
              </el-select>
            </el-form-item>
            <el-form-item label="内容分类">
              <el-select v-model="promptCreatorForm.category">
                <el-option v-for="category in PROMPT_CATEGORIES" :key="category.value" :label="category.label" :value="category.value" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="标签">
            <el-input v-model="promptCreatorForm.tagsText" placeholder="多个标签用逗号分隔" />
          </el-form-item>
          <el-form-item label="用户端状态">
            <el-switch v-model="promptCreatorForm.active" active-text="立即启用" inactive-text="暂不启用" />
          </el-form-item>
        </el-form>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="rejectOpen"
      panel-class="gallery-reject-dialog"
      title="拒绝投稿"
      :icon="CircleCloseFilled"
      width="520px"
      confirm-text="确认拒绝"
      confirm-type="danger"
      :confirm-disabled="!rejectNote.trim()"
      :confirm-loading="Boolean(rejectTarget && operatingId === rejectTarget.id)"
      @confirm="confirmReject"
    >
      <div class="gallery-reject">
        <div v-if="rejectTarget" class="gallery-reject__work">
          <img
            v-if="mediaListOf(rejectTarget)[0] || rejectTarget.coverUrl"
            :src="mediaListOf(rejectTarget)[0] || rejectTarget.coverUrl"
            :alt="itemTitle(rejectTarget)"
          />
          <div v-else class="gallery-reject__empty">暂无封面</div>
          <div class="gallery-reject__copy">
            <strong :title="itemTitle(rejectTarget)">{{ itemTitle(rejectTarget) }}</strong>
            <span>{{ userLabel(rejectTarget) }} · {{ kindLabel(rejectTarget) }}</span>
          </div>
        </div>

        <div class="gallery-reject__presets">
          <button
            v-for="reason in rejectReasonPresets"
            :key="reason"
            type="button"
            class="gallery-reject__chip"
            :class="{ 'is-active': rejectPresetSelected(reason) }"
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
          placeholder="拒绝原因会通知作者"
        />
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="violationOpen"
      panel-class="gallery-violate-dialog"
      title="违规处理"
      :icon="WarningFilled"
      width="520px"
      :confirm-text="violationForm.banDays > 0 ? '下架并禁投' : '确认下架'"
      confirm-type="danger"
      :confirm-disabled="!violationForm.reason.trim()"
      :confirm-loading="Boolean(violationTarget && operatingId === violationTarget.id)"
      @confirm="confirmViolation"
    >
      <div class="gallery-violate">
        <div v-if="violationTarget" class="gallery-violate__work">
          <img
            v-if="mediaListOf(violationTarget)[0] || violationTarget.coverUrl"
            :src="mediaListOf(violationTarget)[0] || violationTarget.coverUrl"
            :alt="itemTitle(violationTarget)"
          />
          <div v-else class="gallery-violate__empty">暂无封面</div>
          <div class="gallery-violate__copy">
            <strong :title="itemTitle(violationTarget)">{{ itemTitle(violationTarget) }}</strong>
            <span>{{ userLabel(violationTarget) }} · {{ kindLabel(violationTarget) }}</span>
          </div>
        </div>

        <div class="gallery-violate__bans">
          <button
            v-for="days in banDayPresets"
            :key="days"
            type="button"
            class="gallery-violate__chip"
            :class="{ 'is-active': violationForm.banDays === days }"
            @click="violationForm.banDays = days"
          >
            {{ days === 0 ? '仅下架' : `${days} 天` }}
          </button>
          <label class="gallery-violate__custom">
            <el-input-number
              v-model="violationForm.banDays"
              :min="0"
              :max="365"
              :controls="false"
            />
            <span>天</span>
          </label>
        </div>

        <el-input
          v-model="violationForm.reason"
          type="textarea"
          :rows="3"
          maxlength="300"
          show-word-limit
          resize="none"
          placeholder="违规原因会通知作者"
        />

        <label class="gallery-violate__option" :class="{ 'is-on': violationForm.deleteMedia }">
          <span>删除媒体文件</span>
          <el-switch v-model="violationForm.deleteMedia" size="small" />
        </label>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.gallery-page {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 0;
  background: var(--bg);
}

.gallery-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.gallery-tabs {
  display: inline-flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.gallery-tab {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);
  }
}

.gallery-toolbar__right {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.gallery-board {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.share-feed {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px;
}

.share-feed.is-scrolling :deep(.share-card) {
  pointer-events: none;
  box-shadow: none;
  transition: none;
}

.share-feed.is-scrolling :deep(.share-card__pane img) {
  transform: none;
  transition: none;
}

.share-feed__loading,
.gallery-empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
  text-align: center;
}

.gallery-empty {
  .el-icon {
    font-size: 30px;
  }

  strong {
    color: var(--ink);
  }

  span {
    font-size: 12px;
  }
}

.share-masonry {
  position: relative;
  width: 100%;
}

.share-load-status {
  display: grid;
  place-items: center;
  min-height: 40px;
  padding: 8px 0 4px;
  color: var(--ink-3);
  font-size: 12px;
}

.share-load-status.is-loading {
  color: var(--accent-ink);
}


</style>

<style lang="scss">
/* 灯箱与审核对话框 teleport 到 body，需全局样式 */
.share-lightbox {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  color: #f4f6fa;
  background: rgb(18 20 26 / 0.94);
}

.share-lightbox-enter-active {
  transition: opacity 0.22s ease;
}

.share-lightbox-leave-active {
  transition: opacity 0.16s ease;
}

.share-lightbox-enter-from,
.share-lightbox-leave-to {
  opacity: 0;
}

.share-media-enter-active,
.share-media-leave-active {
  transition: opacity 0.16s ease;
}

.share-media-enter-from,
.share-media-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .share-lightbox-enter-active,
  .share-lightbox-leave-active,
  .share-media-enter-active,
  .share-media-leave-active {
    transition: none;
  }
}

.share-lightbox__bar,
.share-lightbox__stage,
.share-lightbox__footer {
  grid-area: 1 / 1;
}

.share-lightbox__bar,
.share-lightbox__footer {
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 12px 16px;
  min-width: 0;
  pointer-events: none;
}

.share-lightbox__bar > *,
.share-lightbox__footer > * {
  pointer-events: auto;
}

.share-lightbox__bar {
  align-self: start;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 22px 56px;
  background: linear-gradient(to bottom, rgb(18 20 26 / 0.78), transparent);
}

.share-lightbox__footer {
  align-self: end;
  padding: 56px 22px 18px;
  background: linear-gradient(to top, rgb(18 20 26 / 0.82), transparent);
}

.share-lightbox__copy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  min-width: 0;
  padding-right: 12px;

  strong {
    overflow: hidden;
    max-width: min(560px, 46vw);
    font-size: 15px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.share-lightbox__facts {
  color: rgb(255 255 255 / 62%);
  font-size: 12px;
}

.share-lightbox__status {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 14%);
  font-size: 11px;
  font-weight: 700;

  &.is-pending {
    background: var(--warning);
    color: #fff;
  }

  &.is-approved {
    background: var(--success);
    color: #fff;
  }

  &.is-rejected {
    background: var(--danger);
    color: #fff;
  }

  &.is-removed {
    background: rgb(100 116 139);
    color: #fff;
  }
}

.share-lightbox__close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  cursor: pointer;

  &:hover {
    background: rgb(255 255 255 / 20%);
  }
}

.share-lightbox__stage {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.share-lightbox__viewport {
  position: absolute;
  inset: 72px 80px 84px;
  min-width: 0;
  min-height: 0;
}

.share-lightbox__media {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  pointer-events: none;
}

.share-lightbox__image {
  width: fit-content !important;
  height: fit-content !important;
  max-width: 100%;
  max-height: 100%;
  pointer-events: auto;
  background: transparent !important;
  user-select: none;
  -webkit-user-drag: none;
}

.share-lightbox__image.progressive-image,
.share-lightbox .progressive-image.share-lightbox__image {
  overflow: visible;
  background: transparent !important;
}

.share-lightbox__image img,
.share-lightbox .share-lightbox__image img {
  width: auto !important;
  height: auto !important;
  max-width: 100%;
  max-height: calc(100dvh - 168px);
  object-fit: contain;
  object-position: center;
  background: transparent;
}

.share-lightbox__empty {
  pointer-events: auto;
  color: rgb(255 255 255 / 58%);
  font-size: 13px;
}

.share-lightbox__nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 12%);
  color: #fff;
  cursor: pointer;
  transform: translateY(-50%);

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover {
    background: rgb(255 255 255 / 22%);
  }

  &.is-prev {
    left: 18px;
  }

  &.is-next {
    right: 18px;
  }
}

.share-lightbox__index {
  color: rgb(255 255 255 / 70%);
  font-size: 13px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.share-lightbox__dots {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  button {
    width: 7px;
    height: 7px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.35);
    cursor: pointer;

    &.is-active {
      width: 16px;
      background: #fff;
    }
  }
}

.share-lightbox__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-left: auto;

  .share-action {
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-pill);
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;

    &:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }

    &.is-approve {
      background: var(--success);
      color: #fff;
    }

    &.is-reject {
      background: var(--danger);
      color: #fff;
    }

    &.is-violate {
      background: var(--warning);
      color: #fff;
    }

    &.is-prompt {
      background: var(--violet);
      color: #fff;
    }

    &:not(:disabled):hover {
      filter: brightness(1.08);
    }
  }
}

/* 审核对话框 teleport 到 body，需全局样式 */
.gallery-reject,
.gallery-violate {
  display: grid;
  gap: 14px;
}

.gallery-reject__work,
.gallery-violate__work {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  img,
  .gallery-reject__empty,
  .gallery-violate__empty {
    width: 72px;
    height: 72px;
    border-radius: 10px;
    background: var(--surface);
  }

  img {
    display: block;
    object-fit: cover;
  }
}

.gallery-reject__empty,
.gallery-violate__empty {
  display: grid;
  place-items: center;
  color: var(--ink-3);
  font-size: 11px;
}

.gallery-reject__copy,
.gallery-violate__copy {
  min-width: 0;

  strong,
  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
  }

  span {
    margin-top: 4px;
    color: var(--ink-3);
    font-size: 12px;
  }
}

.gallery-reject__presets,
.gallery-violate__bans {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.gallery-reject__chip,
.gallery-violate__chip {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface-3);
  }
}

.gallery-reject__chip.is-active {
  background: var(--danger-soft);
  color: var(--danger);
}

.gallery-violate__chip.is-active {
  background: var(--warning-soft);
  color: var(--warning);
}

.gallery-violate__custom {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  font-size: 12px;

  .el-input-number {
    width: 48px;
  }

  .el-input-number .el-input__wrapper {
    padding: 0;
    box-shadow: none;
    background: transparent;
  }

  .el-input-number .el-input__inner {
    height: 30px;
    text-align: center;
  }
}

.gallery-violate__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 40px;
  padding: 0 14px 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &.is-on {
    border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.gallery-prompt-layout {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.6fr);
  gap: 22px;
}

.gallery-prompt-cover {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;

  > .progressive-image,
  > div {
    display: grid;
    width: 100%;
    min-height: 260px;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-2);
  }

  > .progressive-image {
    height: min(52vh, 440px);
  }

  > div {
    align-content: center;
    gap: 8px;
    color: var(--ink-3);
  }

  > small {
    color: var(--ink-3);
    font-size: 12px;
    line-height: 1.55;
  }
}

.gallery-prompt-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  .el-select {
    width: 100%;
  }
}


</style>
