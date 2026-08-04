<script lang="ts">
/** 后台投稿（含 v3 审核增强字段） */
export interface AdminSubmission {
  id: string
  taskId?: string
  title: string
  status: string
  taskType?: string
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
import { Close, Refresh, CircleCloseFilled, CollectionTag, WarningFilled } from '@element-plus/icons-vue'
import { request, normalizeList, type Page } from '@/request'
import { useVirtualMasonryFeed } from '@/composables/useVirtualMasonryFeed'
import { formatTime, SUBMISSION_STATUS_LABELS, TASK_TYPES, taskTypeLabel } from '@/utils'
import AdminDialog from '@/components/AdminDialog.vue'
import ProgressiveImage from '@/components/ProgressiveImage.vue'
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
  bodyHeight: 128,
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
  return item?.taskType ? taskTypeLabel(item.taskType) : 'AI 生成'
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
  if (taskType === 'ui_design' || taskType === 'model_sheet' || taskType === 'puzzle') return 'design'
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
  const taskType = TASK_TYPES.includes(item.taskType as (typeof TASK_TYPES)[number])
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
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
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
          <span v-if="items.length" class="share-toolbar__count">
            已加载 {{ items.length }} 条{{ total != null ? ` / ${total}` : '' }}
          </span>
          <el-button :icon="Refresh" :loading="loading" @click="reset">刷新</el-button>
        </div>
      </div>
    </div>

    <ListError :error="error" :loading="loading" @retry="retry" />

    <div
      ref="galleryFeedRef"
      v-loading="loading && items.length > 0"
      class="share-feed"
      :class="{ 'is-scrolling': isGridScrolling }"
      @scroll.passive="onGalleryScroll"
    >
      <div v-if="loading && !items.length" class="share-feed__loading">正在加载投稿…</div>

      <el-empty v-else-if="!items.length" description="当前没有待处理的投稿" />

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
        <span v-else-if="!hasMore">已加载全部 {{ items.length }} 条</span>
        <span v-else>下拉继续加载</span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="share-lightbox" @after-leave="onPreviewAfterLeave">
        <div v-if="previewOpen && previewItem" class="share-lightbox" @click.self="closePreview">
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
                  <ProgressiveImage
                    v-if="previewMediaUrl"
                    class="share-lightbox__image"
                    :src="previewMediaUrl"
                    :alt="itemTitle(previewItem)"
                    fit="contain"
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

          <footer class="share-lightbox__footer">
            <div class="share-lightbox__meta">
              <span class="share-lightbox__index">{{ previewIndex + 1 }} / {{ items.length }}</span>
              <span class="share-lightbox__hint">← → 切换 · A 通过 · R 拒绝 · Esc 关闭</span>
            </div>
            <div class="share-lightbox__actions" role="group" aria-label="审核操作">
              <button
                v-if="previewItem.status === 'approved'"
                type="button"
                class="share-action is-prompt"
                :disabled="operatingId === previewItem.id || Boolean(previewItem.promptEntryId)"
                @click="openPromptCreator(previewItem, previewMediaIndex)"
              >
                {{ previewItem.promptEntryId ? '已加入提示词库' : '作为提示词' }}
              </button>
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

    <AdminDialog
      v-model="promptCreatorOpen"
      title="加入提示词库"
      subtitle="将审核图片复制为提示词封面，不依赖原画廊状态"
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
      title="拒绝投稿"
      subtitle="拒绝后不会进入社区公开展示，原因将通知作者"
      :icon="CircleCloseFilled"
      width="480px"
      confirm-text="确认拒绝"
      confirm-type="danger"
      :confirm-loading="Boolean(rejectTarget && operatingId === rejectTarget.id)"
      @confirm="confirmReject"
    >
      <div class="share-review-panel">
        <div v-if="rejectTarget" class="share-review-panel__summary">
          <div class="share-review-panel__summary-main">
            <strong :title="itemTitle(rejectTarget)">{{ itemTitle(rejectTarget) }}</strong>
            <small>{{ userLabel(rejectTarget) }} · {{ kindLabel(rejectTarget) }}</small>
          </div>
          <span class="share-review-panel__pill is-reject">拒绝</span>
        </div>

        <div class="share-review-panel__section">
          <div class="share-review-panel__label">
            <span>拒绝原因</span>
            <em>必填，将通知作者</em>
          </div>
          <div class="share-review-panel__presets is-reject">
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
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="violationOpen"
      title="违规处理"
      subtitle="下架作品并可限制该用户继续投稿"
      :icon="WarningFilled"
      width="520px"
      :confirm-text="violationForm.banDays > 0 ? '下架并禁投' : '确认下架'"
      confirm-type="danger"
      :confirm-loading="Boolean(violationTarget && operatingId === violationTarget.id)"
      @confirm="confirmViolation"
    >
      <div class="share-review-panel">
        <div class="share-review-panel__alert">
          <el-icon :size="16"><WarningFilled /></el-icon>
          <p>
            将下架作品并限制
            <strong>{{ userLabel(violationTarget) }}</strong>
            投稿，用户会收到违规通知。
          </p>
        </div>

        <div v-if="violationTarget" class="share-review-panel__summary">
          <div class="share-review-panel__summary-main">
            <strong :title="itemTitle(violationTarget)">{{ itemTitle(violationTarget) }}</strong>
            <small>{{ userLabel(violationTarget) }} · {{ kindLabel(violationTarget) }}</small>
          </div>
          <span class="share-review-panel__pill is-violate">违规</span>
        </div>

        <div class="share-review-panel__section">
          <div class="share-review-panel__label">
            <span>禁投天数</span>
            <em>0–365 天，0 表示只下架不禁投</em>
          </div>
          <div class="share-review-panel__presets is-violate">
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

        <div class="share-review-panel__section">
          <div class="share-review-panel__label">
            <span>违规原因</span>
            <em>将记录到处理结果并通知用户</em>
          </div>
          <el-input
            v-model="violationForm.reason"
            type="textarea"
            :rows="3"
            maxlength="300"
            show-word-limit
            resize="none"
            placeholder="说明违规原因，便于运营追溯"
          />
        </div>

        <div class="share-review-panel__section">
          <el-checkbox v-model="violationForm.deleteMedia">
            同时删除媒体文件（不可恢复）
          </el-checkbox>
        </div>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.community-ops-page {
  --community-accent: var(--accent);
  --community-line: var(--border);

  box-sizing: border-box;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 16px 18px;
  background: var(--bg);
}

.ops-toolbar-panel {
  flex-shrink: 0;
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

.share-feed {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 4px 2px 8px;
  border: 1px solid var(--community-line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
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

.share-feed__loading {
  display: grid;
  place-items: center;
  min-height: 240px;
  color: var(--ink-3);
  font-size: 13px;
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
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100dvh;
  min-height: 0;
  color: #fff;
  background: #05070c;
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
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 12px 18px;
  border: 0;
  background: rgb(12 14 20 / 92%);
  box-shadow: none;
  backdrop-filter: blur(14px);
}

.share-lightbox__bar {
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.share-lightbox__footer {
  border-top: 1px solid rgb(255 255 255 / 8%);
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
  border-radius: 6px;
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
  width: 34px;
  height: 34px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 10px;
  background: rgb(255 255 255 / 10%);
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
  position: relative;
  z-index: 2;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #0b0d12;
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
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  background: transparent !important;
  user-select: none;
  -webkit-user-drag: none;
}

.share-lightbox__image.progressive-image,
.share-lightbox__image .progressive-image,
.share-lightbox .progressive-image.share-lightbox__image {
  background: transparent !important;
}

.share-lightbox__image img,
.share-lightbox .share-lightbox__image img {
  object-fit: contain;
  object-position: center;
  background: transparent;
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
  grid-auto-flow: column;
  grid-auto-columns: minmax(96px, 1fr);
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

    &.is-prompt {
      color: #c4b5fd;
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

    &:not(:disabled):hover.is-prompt {
      background: rgb(124 58 237 / 28%);
      color: #ede9fe;
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



/* 审核对话框（拒绝 / 违规）——样式挂在弹窗内容根节点，不依赖 teleport 外层 class */
.share-review-panel {
  --community-dialog-line: var(--border);
  display: grid;
  gap: 14px;
}

.share-review-panel__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--community-dialog-line);
  border-radius: 12px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}

.share-review-panel__summary-main {
  min-width: 0;
  flex: 1 1 auto;

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

.share-review-panel__pill {
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

.share-review-panel__alert {
  display: flex;
  gap: 10px;
  align-items: flex-start;
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

.share-review-panel__section {
  display: grid;
  gap: 8px;
}

.share-review-panel__label {
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

.share-review-panel__presets {
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
