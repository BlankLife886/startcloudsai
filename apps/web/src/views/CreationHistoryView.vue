<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import {
  deleteTask,
  listTasks,
  TASK_TYPE_LABELS,
  TASK_UPDATE_EVENT,
  subscribeTask,
} from '@/services/tasksApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import {
  stashPendingPrompt,
  studioRouteForTaskType,
} from '@/features/creator-hub/studioTools'
import { taskCoverUrl, taskOriginalUrl, taskThumbnailUrl } from '@/features/creator-hub/taskMedia'
import { taskAspectCss } from '@/features/creator-hub/useMasonryFeed'
import { useVirtualMasonryFeed } from '@/features/creator-hub/useVirtualMasonryFeed'
import DeleteHistoryConfirmDialog from '@/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue'
import { setBodyScrollLock } from '@/utils/bodyScrollLock'
import '@/features/creator-hub/creator-hub.css'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()

const HISTORY_PREVIEW_SCROLL_LOCK = 'creation-history-preview'
const HISTORY_CONFIRM_SCROLL_LOCK = 'creation-history-confirm'

const tasks = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const bulkBusy = ref(false)
const cursor = ref(null)
const search = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
const preview = ref(null)
const selectMode = ref(false)
const selectedIds = ref(new Set())
const failedThumbIds = ref(new Set())
const loadSentinelRef = ref(null)
const statusMenuOpen = ref(false)
const statusMenuRef = ref(null)
const previewPanelRef = ref(null)
const previewLayerRef = ref(null)
const taskSubscriptions = new Map()
let loadObserver = null
let confirmAction = null
let previewUnlockTimer = 0
let previewInertiaGuardCleanup = null

function stopPreviewInertiaGuard() {
  previewInertiaGuardCleanup?.()
  previewInertiaGuardCleanup = null
}

function startPreviewInertiaGuard(ms = 0, { allowPreviewScroll = false } = {}) {
  stopPreviewInertiaGuard()

  const shouldBlock = (event) => {
    if (!allowPreviewScroll) return true
    const scroller =
      event.target?.closest?.('.ch-preview__media') ||
      event.target?.closest?.('.ch-preview__mid')
    if (!scroller) return true

    // 允许弹窗内部滚动；到顶/到底后仍拦截，避免链到页面
    if (event.type === 'touchmove') return false

    const { scrollTop, scrollHeight, clientHeight } = scroller
    const delta = Number(event.deltaY) || 0
    if (scrollHeight <= clientHeight + 1) return true
    const atTop = scrollTop <= 0
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1
    return (atTop && delta < 0) || (atBottom && delta > 0)
  }

  const onWheel = (event) => {
    if (shouldBlock(event)) event.preventDefault()
  }
  const onTouchMove = (event) => {
    if (shouldBlock(event)) event.preventDefault()
  }

  document.addEventListener('wheel', onWheel, { passive: false, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })

  const timer =
    ms > 0
      ? window.setTimeout(() => {
          document.removeEventListener('wheel', onWheel, { capture: true })
          document.removeEventListener('touchmove', onTouchMove, { capture: true })
          if (previewInertiaGuardCleanup) previewInertiaGuardCleanup = null
        }, ms)
      : 0

  previewInertiaGuardCleanup = () => {
    if (timer) window.clearTimeout(timer)
    document.removeEventListener('wheel', onWheel, { capture: true })
    document.removeEventListener('touchmove', onTouchMove, { capture: true })
  }
}

const confirmDialog = reactive({
  open: false,
  busy: false,
  heading: '确认删除？',
  description: '',
  confirmLabel: '确认删除',
  busyLabel: '删除中…',
  icon: 'bi-trash3',
})

const DELETABLE_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

const STATUS_LABELS = {
  succeeded: '已完成',
  running: '生成中',
  queued: '排队中',
  failed: '失败',
  canceled: '已取消',
}

const TYPE_FILTERS = [
  { id: '', label: '全部' },
  ...Object.entries(TASK_TYPE_LABELS).map(([id, label]) => ({ id, label })),
]

const STATUS_FILTERS = [
  { id: '', label: '全部状态' },
  { id: 'succeeded', label: '已完成' },
  { id: 'running', label: '生成中' },
  { id: 'queued', label: '排队中' },
  { id: 'failed', label: '失败' },
]

const statusFilterLabel = computed(
  () => STATUS_FILTERS.find((item) => item.id === statusFilter.value)?.label || '全部状态',
)

function taskPrompt(task) {
  return String(
    task?.params?.userPrompt || task?.userPrompt || task?.params?.prompt || task?.prompt || '',
  )
    .replace(/\{argument\b[^{}]*\bdefault="([^"]*)"[^{}]*\}/gi, '$1')
    .replace(/\{argument\b[^{}]*\bdefault='([^']*)'[^{}]*\}/gi, '$1')
    .replace(/\{argument\b[^{}]*\}/gi, '')
    .trim()
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function coverSrc(task) {
  const thumb = taskThumbnailUrl(task)
  const original = taskOriginalUrl(task)
  if (failedThumbIds.value.has(task.id)) return original || thumb
  return thumb || original
}

function onCoverError(task) {
  const id = String(task?.id || '')
  if (!id || failedThumbIds.value.has(id)) return
  const thumb = taskThumbnailUrl(task)
  const original = taskOriginalUrl(task)
  if (thumb && original && thumb !== original) {
    failedThumbIds.value = new Set([...failedThumbIds.value, id])
  }
}

function isDeletable(task) {
  return DELETABLE_STATUSES.has(String(task?.status || '').toLowerCase())
}

const visibleTasks = computed(() => {
  const q = search.value.trim().toLowerCase()
  return tasks.value
    .filter((task) => {
      if (statusFilter.value && task.status !== statusFilter.value) return false
      if (!q) return true
      return `${taskPrompt(task)} ${TASK_TYPE_LABELS[task.type] || ''}`
        .toLowerCase()
        .includes(q)
    })
    .map((task) => ({
      ...task,
      cleanPrompt: taskPrompt(task) || '未填写提示词',
    }))
})

const selectedCount = computed(() => selectedIds.value.size)

const previewIndex = computed(() => {
  if (!preview.value?.id) return -1
  return visibleTasks.value.findIndex((task) => String(task.id) === String(preview.value.id))
})

const hasPreviewPrev = computed(() => previewIndex.value > 0)
const hasPreviewNext = computed(
  () => previewIndex.value >= 0 && previewIndex.value < visibleTasks.value.length - 1,
)

const masonryItems = computed(() =>
  visibleTasks.value.map((task, index) => ({
    key: String(task.id),
    task,
    index,
    aspect: taskAspectCss(task),
    src: coverSrc(task),
    selected: selectedIds.value.has(String(task.id)),
  })),
)

const {
  containerRef: historyMasonryRef,
  visibleItems: visibleMasonryItems,
  columnCount,
  totalHeight: historyMasonryHeight,
  measureFromEvent,
  scheduleViewportMeasure,
} = useVirtualMasonryFeed({
  items: masonryItems,
  fallbackAspect: 3 / 4,
  bodyHeight: 178,
  minColumnWidth: 260,
  maxColumns: 12,
  overscan: 960,
  getAspect: (entry) => entry.aspect,
})

function imageLoadingMode(index) {
  return index < Math.max(6, columnCount.value * 2) ? 'eager' : 'lazy'
}

function disconnectLoadObserver() {
  loadObserver?.disconnect()
  loadObserver = null
}

function setupLoadObserver() {
  disconnectLoadObserver()
  if (typeof IntersectionObserver === 'undefined') return
  const sentinel = loadSentinelRef.value
  if (!sentinel || !cursor.value) return
  loadObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      void loadTasks({ append: true })
    },
    { root: null, rootMargin: '1200px 0px', threshold: 0 },
  )
  loadObserver.observe(sentinel)
}

function syncTaskSubscriptions() {
  const active = new Map(
    tasks.value
      .filter((task) => ['queued', 'running'].includes(String(task.status || '').toLowerCase()))
      .map((task) => [task.id, task]),
  )
  for (const [taskId, unsubscribe] of taskSubscriptions) {
    if (active.has(taskId)) continue
    unsubscribe()
    taskSubscriptions.delete(taskId)
  }
  for (const taskId of active.keys()) {
    if (taskSubscriptions.has(taskId)) continue
    taskSubscriptions.set(
      taskId,
      subscribeTask(taskId, {
        onUpdate: (current) => {
          tasks.value = tasks.value.map((task) => (task.id === current.id ? current : task))
          if (!['queued', 'running'].includes(String(current.status || '').toLowerCase())) {
            taskSubscriptions.get(taskId)?.()
            taskSubscriptions.delete(taskId)
          }
        },
      }),
    )
  }
}

function clearSelection() {
  selectedIds.value = new Set()
}

function exitSelectMode() {
  selectMode.value = false
  clearSelection()
}

function toggleSelectMode() {
  if (selectMode.value) {
    exitSelectMode()
    return
  }
  selectMode.value = true
  clearSelection()
}

function isSelected(id) {
  return selectedIds.value.has(String(id))
}

function toggleSelect(id) {
  const key = String(id || '')
  if (!key) return
  const next = new Set(selectedIds.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedIds.value = next
}

function selectAllVisible() {
  selectedIds.value = new Set(
    visibleTasks.value.filter((task) => isDeletable(task)).map((task) => String(task.id)),
  )
}

function onCardActivate(task) {
  if (selectMode.value) {
    if (isDeletable(task)) toggleSelect(task.id)
    return
  }
  openPreview(task)
}

function openPreview(task) {
  if (previewUnlockTimer) {
    window.clearTimeout(previewUnlockTimer)
    previewUnlockTimer = 0
  }
  stopPreviewInertiaGuard()
  preview.value = task
  // 不用 freezeViewport，避免解锁时 scrollTo 回跳造成“自动滚动”
  setBodyScrollLock(HISTORY_PREVIEW_SCROLL_LOCK, true, { freezeViewport: false })
  // 打开期间拦截页面滚动，但允许弹窗内部滚动
  startPreviewInertiaGuard(0, { allowPreviewScroll: true })
  nextTick(() => {
    const media = previewPanelRef.value?.querySelector?.('.ch-preview__media')
    if (media) media.scrollTop = 0
  })
}

function showPreviewAt(index) {
  const task = visibleTasks.value[index]
  if (!task) return
  preview.value = task
  nextTick(() => {
    const media = previewPanelRef.value?.querySelector?.('.ch-preview__media')
    const mid = previewPanelRef.value?.querySelector?.('.ch-preview__mid')
    if (media) media.scrollTop = 0
    if (mid) mid.scrollTop = 0
  })
}

function showPreviewPrev() {
  if (!hasPreviewPrev.value) return
  showPreviewAt(previewIndex.value - 1)
}

function showPreviewNext() {
  if (!hasPreviewNext.value) return
  showPreviewAt(previewIndex.value + 1)
}

async function copyPreviewPrompt() {
  const prompt = taskPrompt(preview.value)
  if (!prompt) {
    notificationService.info('没有可复制的提示词')
    return
  }
  try {
    await navigator.clipboard.writeText(prompt)
    notificationService.success('提示词已复制')
  } catch {
    notificationService.error('复制失败，请手动选择文本')
  }
}

function closePreview() {
  const root = previewPanelRef.value
  const media = root?.querySelector?.('.ch-preview__media')
  const mid = root?.querySelector?.('.ch-preview__mid')
  for (const el of [media, mid]) {
    if (!el) continue
    el.style.overflow = 'hidden'
    el.scrollTop = el.scrollTop
  }

  preview.value = null

  // 关闭后短暂全拦截，吞掉触控板惯性，再解锁 body
  startPreviewInertiaGuard(450, { allowPreviewScroll: false })
  if (previewUnlockTimer) window.clearTimeout(previewUnlockTimer)
  previewUnlockTimer = window.setTimeout(() => {
    previewUnlockTimer = 0
    setBodyScrollLock(HISTORY_PREVIEW_SCROLL_LOCK, false)
  }, 50)
}

function onPreviewKeydown(event) {
  if (!preview.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreview()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    showPreviewPrev()
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    showPreviewNext()
  }
}

async function fetchAllTasks({ type = '', status = '' } = {}) {
  const all = []
  let pageCursor = ''
  for (;;) {
    const { items, nextCursor } = await listTasks({
      type,
      status,
      limit: 50,
      cursor: pageCursor,
    })
    all.push(...(items || []))
    if (!nextCursor) break
    pageCursor = nextCursor
  }
  return all
}

async function deleteTasksByIds(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))]
  if (!unique.length) return { succeeded: 0, failed: 0, total: 0 }
  let succeeded = 0
  let failed = 0
  const queue = [...unique]
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()
      if (!id) continue
      try {
        await deleteTask(id)
        succeeded += 1
      } catch {
        failed += 1
      }
    }
  })
  await Promise.all(workers)
  return { succeeded, failed, total: unique.length }
}

function openConfirmDialog(options, action) {
  if (bulkBusy.value || confirmDialog.busy) return
  confirmDialog.heading = options.heading || '确认删除？'
  confirmDialog.description = options.description || ''
  confirmDialog.confirmLabel = options.confirmLabel || '确认删除'
  confirmDialog.busyLabel = options.busyLabel || '删除中…'
  confirmDialog.icon = options.icon || 'bi-trash3'
  confirmAction = action
  confirmDialog.open = true
}

function closeConfirmDialog() {
  if (confirmDialog.busy) return
  confirmDialog.open = false
  confirmAction = null
}

async function runConfirmDialog() {
  if (!confirmAction || confirmDialog.busy) return
  confirmDialog.busy = true
  bulkBusy.value = true
  try {
    await confirmAction()
    confirmDialog.open = false
    confirmAction = null
  } catch (error) {
    notificationService.error(error?.message || '操作失败')
  } finally {
    confirmDialog.busy = false
    bulkBusy.value = false
  }
}

function removeTask(task) {
  if (!task?.id) return
  if (!isDeletable(task)) {
    notificationService.info('进行中的任务结束后才能删除')
    return
  }
  const prompt = taskPrompt(task).slice(0, 72)
  openConfirmDialog(
    {
      heading: '删除这条历史记录？',
      description: prompt
        ? `删除后无法恢复：“${prompt}”`
        : '删除后产物也会一并清除，且无法恢复。',
      confirmLabel: '确认删除',
      busyLabel: '删除中…',
    },
    async () => {
      await deleteTask(task.id)
      tasks.value = tasks.value.filter((item) => item.id !== task.id)
      const next = new Set(selectedIds.value)
      next.delete(String(task.id))
      selectedIds.value = next
      notificationService.success('已删除')
    },
  )
}

function deleteSelected() {
  if (bulkBusy.value) return
  const ids = [...selectedIds.value]
  if (!ids.length) {
    notificationService.info('请先勾选要删除的记录')
    return
  }
  openConfirmDialog(
    {
      heading: `删除选中的 ${ids.length} 条记录？`,
      description: '产物也会一并删除，删除后无法恢复。',
      confirmLabel: '删除所选',
      busyLabel: '删除中…',
    },
    async () => {
      const result = await deleteTasksByIds(ids)
      exitSelectMode()
      await loadTasks({ append: false })
      if (result.failed) {
        notificationService.error(`已删除 ${result.succeeded} 条，${result.failed} 条失败`)
      } else {
        notificationService.success(`已删除 ${result.succeeded} 条`)
      }
    },
  )
}

function clearFailedTasks() {
  if (bulkBusy.value) return
  openConfirmDialog(
    {
      heading: '清除全部失败记录？',
      description: '将删除账号下所有失败任务及其产物，此操作不可撤销。',
      confirmLabel: '全部清除',
      busyLabel: '清除中…',
      icon: 'bi-x-octagon',
    },
    async () => {
      const failed = await fetchAllTasks({ status: 'failed' })
      if (!failed.length) {
        notificationService.info('没有失败记录')
        return
      }
      const result = await deleteTasksByIds(failed.map((task) => task.id))
      exitSelectMode()
      await loadTasks({ append: false })
      if (result.failed) {
        notificationService.error(`已清除 ${result.succeeded} 条失败记录，${result.failed} 条失败`)
      } else {
        notificationService.success(`已清除 ${result.succeeded} 条失败记录`)
      }
    },
  )
}

function clearAllTasks() {
  if (bulkBusy.value) return
  openConfirmDialog(
    {
      heading: '删除全部历史记录？',
      description:
        '仅已结束的任务会被删除，进行中的任务会保留。产物也会一并删除，且不可撤销。',
      confirmLabel: '清空全部',
      busyLabel: '清空中…',
    },
    async () => {
      const all = await fetchAllTasks()
      const deletable = all.filter(isDeletable)
      if (!deletable.length) {
        notificationService.info(all.length ? '没有可删除的已结束任务' : '没有历史记录')
        return
      }
      const result = await deleteTasksByIds(deletable.map((task) => task.id))
      const skipped = all.length - deletable.length
      exitSelectMode()
      await loadTasks({ append: false })
      if (result.failed || skipped) {
        notificationService.info(
          `已删除 ${result.succeeded} 条` +
            (result.failed ? `，失败 ${result.failed} 条` : '') +
            (skipped ? `，跳过进行中 ${skipped} 条` : ''),
        )
      } else {
        notificationService.success(`已删除全部 ${result.succeeded} 条记录`)
      }
    },
  )
}

async function loadTasks({ append = false } = {}) {
  if (!authStore.isAuthenticated) return
  if (append) {
    if (!cursor.value || loadingMore.value || loading.value || bulkBusy.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  try {
    const { items, nextCursor } = await listTasks({
      type: typeFilter.value,
      limit: 24,
      cursor: append ? cursor.value || '' : '',
    })
    tasks.value = append ? [...tasks.value, ...(items || [])] : items || []
    cursor.value = nextCursor || null
    syncTaskSubscriptions()
  } catch (error) {
    if (!append) tasks.value = []
    notificationService.error(error?.message || '历史记录读取失败')
  } finally {
    loading.value = false
    loadingMore.value = false
    await nextTick()
    scheduleViewportMeasure()
    setupLoadObserver()
  }
}

function setType(id) {
  if (typeFilter.value === id) return
  typeFilter.value = id
}

function setStatus(id) {
  if (statusFilter.value === id) return
  statusFilter.value = id
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

function closeStatusMenu() {
  statusMenuOpen.value = false
}

function toggleStatusMenu() {
  statusMenuOpen.value = !statusMenuOpen.value
}

function pickStatus(id) {
  setStatus(id)
  closeStatusMenu()
}

function onStatusMenuPointerDown(event) {
  if (!statusMenuOpen.value || !statusMenuRef.value) return
  if (!statusMenuRef.value.contains(event.target)) closeStatusMenu()
}

function onStatusMenuKeydown(event) {
  if (!statusMenuOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  closeStatusMenu()
}

function recreate(task) {
  const prompt = taskPrompt(task)
  if (!prompt) {
    notificationService.info('该任务没有可复用的提示词')
    return
  }
  stashPendingPrompt({ prompt, taskType: task.type || 't2i' })
  notificationService.success('已带到工作台')
  router.push(studioRouteForTaskType(task.type))
}

function handleRealtime(event) {
  if (!event?.detail?.task) return
  const incoming = event.detail.task
  const idx = tasks.value.findIndex((task) => task.id === incoming.id)
  if (idx >= 0) {
    tasks.value.splice(idx, 1, incoming)
  } else if (!typeFilter.value || typeFilter.value === incoming.type) {
    tasks.value = [incoming, ...tasks.value]
  }
  syncTaskSubscriptions()
}

watch(typeFilter, () => {
  clearSelection()
  void loadTasks({ append: false })
})

watch(statusFilter, () => {
  clearSelection()
})

watch(statusMenuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('pointerdown', onStatusMenuPointerDown, true)
    document.addEventListener('keydown', onStatusMenuKeydown)
  } else {
    document.removeEventListener('pointerdown', onStatusMenuPointerDown, true)
    document.removeEventListener('keydown', onStatusMenuKeydown)
  }
})

watch(preview, (value) => {
  if (typeof document === 'undefined') return
  if (value) document.addEventListener('keydown', onPreviewKeydown)
  else document.removeEventListener('keydown', onPreviewKeydown)
})

watch(
  () => confirmDialog.open,
  (open) => {
    setBodyScrollLock(HISTORY_CONFIRM_SCROLL_LOCK, Boolean(open), { freezeViewport: true })
  },
)

watch(
  () => authStore.isAuthenticated,
  (ok) => {
    if (ok) void loadTasks({ append: false })
    else {
      tasks.value = []
      cursor.value = null
      exitSelectMode()
      disconnectLoadObserver()
    }
  },
)

onMounted(() => {
  document.documentElement.classList.add('creator-hub-sticky-page')
  if (authStore.isAuthenticated) void loadTasks({ append: false })
  window.addEventListener(TASK_UPDATE_EVENT, handleRealtime)
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('creator-hub-sticky-page')
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtime)
  document.removeEventListener('pointerdown', onStatusMenuPointerDown, true)
  document.removeEventListener('keydown', onStatusMenuKeydown)
  document.removeEventListener('keydown', onPreviewKeydown)
  if (previewUnlockTimer) window.clearTimeout(previewUnlockTimer)
  stopPreviewInertiaGuard()
  setBodyScrollLock(HISTORY_PREVIEW_SCROLL_LOCK, false)
  setBodyScrollLock(HISTORY_CONFIRM_SCROLL_LOCK, false)
  disconnectLoadObserver()
  for (const unsubscribe of taskSubscriptions.values()) unsubscribe()
  taskSubscriptions.clear()
})
</script>

<template>
  <main class="ch-page ch-page--history">
    <div class="ch-shell">
      <div v-if="!authStore.isAuthenticated" class="ch-login">
        <strong>登录后查看历史记录</strong>
        <span>云端同步你的全部创作任务与产物</span>
        <router-link
          class="ch-btn is-primary"
          :to="{
            name: 'auth',
            query: { mode: 'login', ...createLoginRedirectQuery(route.fullPath) },
          }"
        >
          去登录
        </router-link>
      </div>

      <template v-else>
        <div class="ch-sticky-bar">
          <div class="ch-toolbar">
            <label class="ch-search">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input v-model="search" type="search" placeholder="搜索提示词" />
            </label>
            <div
              ref="statusMenuRef"
              class="ch-menu"
              :class="{ 'is-open': statusMenuOpen }"
            >
              <button
                type="button"
                class="ch-menu__trigger"
                aria-label="状态筛选"
                aria-haspopup="listbox"
                :aria-expanded="statusMenuOpen"
                @click="toggleStatusMenu"
              >
                <span>{{ statusFilterLabel }}</span>
                <i class="bi bi-chevron-down" aria-hidden="true"></i>
              </button>
              <Transition name="ch-menu">
                <ul
                  v-if="statusMenuOpen"
                  class="ch-menu__panel"
                  role="listbox"
                  aria-label="状态筛选"
                >
                  <li
                    v-for="item in STATUS_FILTERS"
                    :key="item.id || 'all-status'"
                    role="option"
                    class="ch-menu__option"
                    :class="{ 'is-active': statusFilter === item.id }"
                    :aria-selected="statusFilter === item.id"
                    @click="pickStatus(item.id)"
                  >
                    <span>{{ item.label }}</span>
                    <i
                      v-if="statusFilter === item.id"
                      class="bi bi-check2"
                      aria-hidden="true"
                    ></i>
                  </li>
                </ul>
              </Transition>
            </div>
            <div class="ch-bulk-bar" aria-label="批量操作">
              <button
                type="button"
                class="ch-chip"
                :class="{ 'is-active': selectMode }"
                :disabled="bulkBusy"
                @click="toggleSelectMode"
              >
                {{ selectMode ? '退出多选' : '多选' }}
              </button>
              <template v-if="selectMode">
                <button type="button" class="ch-chip" :disabled="bulkBusy" @click="selectAllVisible">
                  全选当前
                </button>
                <button
                  type="button"
                  class="ch-chip is-danger"
                  :disabled="bulkBusy || !selectedCount"
                  @click="deleteSelected"
                >
                  {{ bulkBusy ? '删除中…' : `删除所选${selectedCount ? ` (${selectedCount})` : ''}` }}
                </button>
              </template>
              <button
                type="button"
                class="ch-chip"
                :disabled="bulkBusy"
                @click="clearFailedTasks"
              >
                清除失败
              </button>
              <button
                type="button"
                class="ch-chip is-danger"
                :disabled="bulkBusy"
                @click="clearAllTasks"
              >
                清空全部
              </button>
            </div>
          </div>

          <div class="ch-chips" aria-label="工作台筛选">
            <button
              v-for="item in TYPE_FILTERS"
              :key="item.id || 'all-type'"
              type="button"
              class="ch-chip"
              :class="{ 'is-active': typeFilter === item.id }"
              @click="setType(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <section class="ch-section">
          <div v-if="loading && !visibleTasks.length" class="ch-loading">正在加载历史…</div>

          <div v-else-if="!visibleTasks.length" class="ch-empty">
            <strong>还没有历史记录</strong>
            <span>去创作台生成第一张图吧</span>
            <router-link class="ch-btn is-primary" to="/studio">打开创作台</router-link>
          </div>

          <div
            v-else
            ref="historyMasonryRef"
            class="ch-history-masonry"
            :style="{ height: `${historyMasonryHeight}px` }"
          >
            <article
              v-for="item in visibleMasonryItems"
              :key="item.key"
              class="ch-card ch-history-masonry__item"
              :class="{ 'is-selected': item.selected, 'is-selecting': selectMode }"
              :style="{
                width: `${item.width}px`,
                height: `${item.height}px`,
                transform: `translate3d(${item.left}px, ${item.top}px, 0)`,
              }"
            >
                <button
                  v-if="selectMode && isDeletable(item.task)"
                  type="button"
                  class="ch-card__check"
                  :aria-pressed="item.selected"
                  :aria-label="item.selected ? '取消选择' : '选择'"
                  @click.stop="toggleSelect(item.task.id)"
                >
                  <i
                    class="bi"
                    :class="item.selected ? 'bi-check-circle-fill' : 'bi-circle'"
                    aria-hidden="true"
                  ></i>
                </button>
                <button
                  type="button"
                  class="ch-card__media"
                  :style="{ height: `${item.mediaHeight}px`, aspectRatio: 'auto' }"
                  :disabled="!selectMode && !item.src"
                  @click="onCardActivate(item.task)"
                >
                  <AuthenticatedImage
                    v-if="item.src"
                    :key="`${item.key}:${failedThumbIds.has(item.key) ? 'orig' : 'thumb'}`"
                    :src="item.src"
                    :alt="item.task.cleanPrompt"
                    :loading="imageLoadingMode(item.index)"
                    root-margin="240px 0px"
                    :retry-count="2"
                    :max-dimension="failedThumbIds.has(item.key) ? 0 : 720"
                    @load="measureFromEvent(item.key, $event)"
                    @error="onCoverError(item.task)"
                  />
                  <div v-else class="ch-card__placeholder">
                    <i
                      class="bi"
                      :class="
                        item.task.status === 'failed'
                          ? 'bi-x-circle'
                          : item.task.status === 'succeeded'
                            ? 'bi-image'
                            : 'bi-hourglass-split'
                      "
                      aria-hidden="true"
                    ></i>
                    {{
                      item.task.status === 'succeeded'
                        ? '缩略图暂不可用'
                        : STATUS_LABELS[item.task.status] || item.task.status
                    }}
                  </div>
                </button>
                  <div class="ch-card__body">
                  <div class="ch-card__meta">
                    <span class="ch-pill">{{ TASK_TYPE_LABELS[item.task.type] || '创作' }}</span>
                    <span class="ch-pill is-status" :data-status="item.task.status">
                      {{ STATUS_LABELS[item.task.status] || item.task.status }}
                    </span>
                  </div>
                  <p class="ch-card__prompt" :title="item.task.cleanPrompt" data-no-translate>
                    {{ item.task.cleanPrompt }}
                  </p>
                  <span class="ch-pill">
                    {{ formatTime(item.task.createdAt) }} · {{ formatPoints(item.task.costCents) }}
                  </span>
                  <div class="ch-card__actions">
                    <button
                      v-if="item.task.cleanPrompt && item.task.cleanPrompt !== '未填写提示词'"
                      type="button"
                      class="is-primary"
                      @click="recreate(item.task)"
                    >
                      再做一张
                    </button>
                    <button
                      v-if="!selectMode"
                      type="button"
                      :disabled="!isDeletable(item.task)"
                      @click="removeTask(item.task)"
                    >
                      删除
                    </button>
                  </div>
                </div>
            </article>
          </div>

          <div
            v-if="cursor || loadingMore"
            ref="loadSentinelRef"
            class="ch-more"
            aria-live="polite"
          >
            <span v-if="loadingMore" class="ch-more__hint">加载中…</span>
          </div>
        </section>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-if="preview"
        ref="previewLayerRef"
        class="ch-preview-layer"
        role="presentation"
        @mousedown.self="closePreview"
      >
        <button
          type="button"
          class="ch-preview__nav is-prev"
          :disabled="!hasPreviewPrev"
          aria-label="上一张"
          @click="showPreviewPrev"
        >
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="ch-preview__nav is-next"
          :disabled="!hasPreviewNext"
          aria-label="下一张"
          @click="showPreviewNext"
        >
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>

        <div
          ref="previewPanelRef"
          class="ch-preview"
          role="dialog"
          aria-modal="true"
          aria-label="作品预览"
        >
          <div class="ch-preview__media">
            <AuthenticatedImage
              v-if="taskCoverUrl(preview)"
              :src="taskOriginalUrl(preview) || taskCoverUrl(preview)"
              :alt="taskPrompt(preview) || 'AI 作品'"
              loading="eager"
              :retry-count="2"
            />
            <div v-else class="ch-preview__empty">暂无预览图</div>
          </div>

          <aside class="ch-preview__body">
            <div class="ch-preview__top">
              <div class="ch-card__meta">
                <span class="ch-pill">{{ TASK_TYPE_LABELS[preview.type] || '创作' }}</span>
                <span class="ch-pill is-status" :data-status="preview.status">
                  {{ STATUS_LABELS[preview.status] || preview.status }}
                </span>
                <span class="ch-pill">{{ formatTime(preview.createdAt) }}</span>
                <span class="ch-pill">{{ formatPoints(preview.costCents) }}</span>
              </div>
            </div>

            <div class="ch-preview__mid">
              <p class="ch-preview__prompt" data-no-translate>
                {{ taskPrompt(preview) || '未填写提示词' }}
              </p>
            </div>

            <div class="ch-preview__bottom">
              <div class="ch-card__actions">
                <button
                  v-if="taskPrompt(preview)"
                  type="button"
                  class="is-primary"
                  @click="copyPreviewPrompt"
                >
                  复制提示词
                </button>
                <button
                  v-if="taskPrompt(preview)"
                  type="button"
                  @click="recreate(preview)"
                >
                  再做一张
                </button>
                <button type="button" @click="closePreview">关闭</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Teleport>

    <DeleteHistoryConfirmDialog
      :open="confirmDialog.open"
      :heading="confirmDialog.heading"
      :description="confirmDialog.description"
      :confirm-label="confirmDialog.confirmLabel"
      :busy-label="confirmDialog.busyLabel"
      :icon="confirmDialog.icon"
      :busy="confirmDialog.busy"
      :light="!appearanceStore.isDark"
      @close="closeConfirmDialog"
      @confirm="runConfirmDialog"
    />
  </main>
</template>
