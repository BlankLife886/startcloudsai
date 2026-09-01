<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElCheckbox, ElMessage, ElMessageBox, type CheckboxValueType } from 'element-plus'
import {
  ArrowDown,
  CollectionTag,
  CircleCheck,
  CircleClose,
  CopyDocument,
  Delete,
  Download,
  EditPen,
  Link,
  MagicStick,
  Picture,
  Plus,
  Pointer,
  Rank,
  Refresh,
  Search,
  Star,
  UploadFilled,
  WarningFilled,
} from '@element-plus/icons-vue'
import AdminDialog from '@/components/AdminDialog.vue'
import PromptCategoryManager from '@/components/PromptCategoryManager.vue'
import { useVirtualMasonryFeed } from '@/composables/useVirtualMasonryFeed'
import { request, normalizeList, type Page } from '@/request'
import { PROMPT_TASK_TYPES, taskTypeLabel } from '@/utils'
import draggable from 'vuedraggable'

interface PromptItem {
  id: string
  title: string
  prompt: string
  taskType: string
  category: string
  tags: string[]
  coverUrl?: string | null
  /** 封面像素尺寸（有则用于预留比例，避免加载跳动） */
  coverWidth?: number | null
  coverHeight?: number | null
  sort: number
  likeCount: number
  favoriteCount: number
  useCount: number
  active: boolean
  createdAt?: string
  /** 远程源导入的词条携带来源 id（契约 v4，后端未返回时为空） */
  sourceId?: string | null
}

interface PromptSource {
  id: string
  name: string
  /** 列表接口字段名为 url；表单提交仍用 sourceUrl */
  url: string
  format: 'json' | 'markdown' | 'html'
  taskType: string
  defaultTags: string[]
  enabled: boolean
  autoSyncEnabled: boolean
  syncIntervalMinutes: number
  nextSyncAt?: string | null
  itemCount: number
  lastSyncedAt?: string | null
  lastSyncDurationMs?: number | null
  lastError?: string | null
  createdAt?: string
}

interface PromptImportBatch {
  id: string
  status: 'fetching' | 'review' | 'publishing' | 'completed' | 'failed'
  analysisMode: 'manual' | 'rules' | 'ai'
  sourceCount: number
  fetchedCount: number
  uniqueCount: number
  duplicateCount: number
  approvedCount: number
  rejectedCount: number
  importedCount: number
  updatedCount: number
  failedSourceCount: number
  error?: string
  createdAt: string
  completedAt?: string | null
}

interface PromptImportItem {
  id: string
  batchId: string
  sourceName: string
  title: string
  prompt: string
  taskType: string
  category: string
  tags: string[]
  coverUrl?: string
  duplicateKind: 'none' | 'batch' | 'library' | 'possible'
  duplicateTitle?: string
  duplicateAction: 'pending' | 'keep' | 'drop'
  complianceStatus: 'pending' | 'safe' | 'blocked'
  complianceReason?: string
  reviewStatus: 'pending' | 'approved' | 'rejected'
  publishedPromptId?: string | null
  publishedAt?: string | null
}

interface CategoryOption {
  value: string
  label: string
  icon: string
  color: string
  active: boolean
}

interface PromptCategory {
  id: string
  key: string
  label: string
  sort: number
  active: boolean
  builtin: boolean
  count: number
}

const CATEGORY_COLORS = ['#5a8f00', '#f472b6', '#38bdf8', '#fbbf24', '#a78bfa', '#34d399', '#f87171', '#64748b']
const promptCategories = ref<PromptCategory[]>([])
const categoryManagerOpen = ref(false)

function colorForCategory(key: string) {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length]
}

const categoryOptions = computed<CategoryOption[]>(() => [
  { value: 'all', label: '全部内容', icon: '▦', color: '#5a8f00', active: true },
  ...promptCategories.value.map((item) => ({
    value: item.key,
    label: item.label,
    icon: item.label.trim().slice(0, 1) || '·',
    color: colorForCategory(item.key),
    active: item.active,
  })),
])

async function loadPromptCategories() {
  const page = await request<PromptCategory[] | Page<PromptCategory>>(
    '/api/v1/admin/prompt-categories',
  ).then(normalizeList)
  promptCategories.value = page.items
}

const query = ref('')
const categoryFilter = ref('all')
const typeFilter = ref('all')
const statusFilter = ref('all')
const sourceFilter = ref('all')
const orderFilter = ref('manual')
const tagFilter = ref<string[]>([])
const availableTags = ref<string[]>([])
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null

async function handlePromptCategoriesChanged() {
  await loadPromptCategories()
  if (!categoryOptions.value.some((item) => item.value === categoryFilter.value)) {
    categoryFilter.value = 'all'
  }
  await refresh()
}
const items = ref<PromptItem[]>([])
const promptScopeTotal = ref(0)
const categoryCounts = ref<Record<string, number>>({})
const loading = ref(false)
const loadingMore = ref(false)
const cachingExternalCovers = ref(false)
const error = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const promptContentRef = ref<HTMLElement | null>(null)
let promptRequestVersion = 0
const isGridScrolling = ref(false)
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

const hasMore = computed(() => nextCursor.value !== null)
const initialLoading = computed(() => loading.value && items.value.length === 0)
const refreshing = computed(() => loading.value && items.value.length > 0)

function promptQueryParams(cursor: string | null) {
  return {
    type: typeFilter.value === 'all' ? '' : typeFilter.value,
    category: categoryFilter.value === 'all' ? '' : categoryFilter.value,
    status: statusFilter.value === 'all' ? '' : statusFilter.value,
    source: sourceFilter.value === 'all' ? '' : sourceFilter.value,
    sort: orderFilter.value === 'manual' ? '' : orderFilter.value,
    tag: tagFilter.value,
    search: query.value.trim(),
    limit: 24,
    cursor,
  }
}

async function loadPromptPage(cursor: string | null, mode: 'replace' | 'append' = 'replace') {
  const version = ++promptRequestVersion
  const append = mode === 'append'
  const hadItems = items.value.length > 0
  if (append) {
    if (!cursor || loading.value || loadingMore.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    error.value = null
  }
  try {
    const page = normalizeList(
      await request<PromptItem[] | Page<PromptItem>>('/api/v1/admin/prompts', {
        query: promptQueryParams(cursor),
      }),
    )
    if (version !== promptRequestVersion) return
    if (append) {
      const seen = new Set(items.value.map((item) => item.id))
      items.value = [
        ...items.value,
        ...page.items.filter((item) => !seen.has(item.id)),
      ]
    } else {
      items.value = page.items
      const loadedIds = new Set(page.items.map((item) => item.id))
      for (const id of selectedIds) {
        if (!loadedIds.has(id)) selectedIds.delete(id)
      }
      await nextTick()
      promptContentRef.value?.scrollTo({ top: 0, behavior: 'auto' })
      scheduleViewportMeasure()
    }
    nextCursor.value = page.nextCursor
    promptScopeTotal.value = page.scopeTotal ?? page.total ?? items.value.length
    if (page.categoryCounts && Object.keys(page.categoryCounts).length) {
      categoryCounts.value = page.categoryCounts
    } else if (!append) {
      categoryCounts.value = { all: promptScopeTotal.value }
    }
    if (!append) {
      availableTags.value = Array.isArray(page.tags) ? page.tags : []
    }
  } catch (cause) {
    if (version !== promptRequestVersion) return
    if (!append && !hadItems) items.value = []
    if (!append) {
      error.value =
        cause instanceof Error && cause.message ? cause.message : '加载失败，请重试'
    } else {
      ElMessage.error('加载更多失败，请重试')
    }
  } finally {
    if (version !== promptRequestVersion) return
    if (append) loadingMore.value = false
    else loading.value = false
    await nextTick()
    scheduleViewportMeasure()
  }
}

function reset() {
  nextCursor.value = null
  return loadPromptPage(null, 'replace')
}

function loadMore() {
  if (!nextCursor.value || loading.value || loadingMore.value) return
  return loadPromptPage(nextCursor.value, 'append')
}

function refresh() {
  return reset()
}

function retry() {
  return reset()
}

function onPromptScroll() {
  if (!isGridScrolling.value) isGridScrolling.value = true
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    isGridScrolling.value = false
  }, 140)

  scheduleViewportMeasure()

  const el = promptContentRef.value
  if (!el || !hasMore.value || loading.value || loadingMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 280) {
    void loadMore()
  }
}

const visibleItems = computed(() => items.value)

const masonryItems = computed(() =>
  visibleItems.value.map((item, index) => ({
    key: item.id,
    item,
    index,
    aspect:
      Number(item.coverWidth) > 0 && Number(item.coverHeight) > 0
        ? `${item.coverWidth} / ${item.coverHeight}`
        : '3 / 4',
    cover: item.coverUrl || '',
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
  bodyHeight: 104,
  mediaInset: 8,
  minColumnWidth: 260,
  maxColumns: 4,
  overscan: 960,
  getAspect: (entry) => entry.aspect,
  scrollParent: promptContentRef,
})

function imageLoadingMode(index: number) {
  return index < Math.max(6, columnCount.value * 2) ? 'eager' : 'lazy'
}

/* 多选编辑：只操作当前已经加载且可见的提示词，避免误改筛选范围之外的数据。 */
const selectedIds = reactive(new Set<string>())
const selectionMode = ref(false)
const batchSaving = ref(false)
const batchDeleting = ref(false)
const batchBusy = computed(() => batchSaving.value || batchDeleting.value)
const batchForm = reactive({
  category: '',
  taskType: '',
  active: '' as '' | 'enabled' | 'disabled',
})

const selectedItems = computed(() => items.value.filter((item) => selectedIds.has(item.id)))
const selectedVisibleCount = computed(() =>
  visibleItems.value.reduce((count, item) => count + Number(selectedIds.has(item.id)), 0),
)
const allVisibleSelected = computed(
  () => visibleItems.value.length > 0 && selectedVisibleCount.value === visibleItems.value.length,
)
const someVisibleSelected = computed(
  () => selectedVisibleCount.value > 0 && !allVisibleSelected.value,
)
const hasBatchChanges = computed(
  () => Boolean(batchForm.category || batchForm.taskType || batchForm.active),
)

function resetBatchForm() {
  batchForm.category = ''
  batchForm.taskType = ''
  batchForm.active = ''
}

function clearSelection() {
  selectedIds.clear()
  resetBatchForm()
}

function toggleSelectionMode() {
  if (selectionMode.value) clearSelection()
  selectionMode.value = !selectionMode.value
}

function toggleSelected(id: string, selected: boolean) {
  if (selected) selectedIds.add(id)
  else selectedIds.delete(id)
}

function toggleVisibleSelection(selected: boolean) {
  for (const item of visibleItems.value) {
    if (selected) selectedIds.add(item.id)
    else selectedIds.delete(item.id)
  }
}

async function applyBatchEdit() {
  const targets = selectedItems.value
  if (!targets.length) {
    ElMessage.warning('请先选择提示词')
    return
  }
  if (!hasBatchChanges.value) {
    ElMessage.warning('请选择需要批量修改的字段')
    return
  }

  const changes: Partial<Pick<PromptItem, 'category' | 'taskType' | 'active'>> = {}
  if (batchForm.category) changes.category = batchForm.category
  if (batchForm.taskType) changes.taskType = batchForm.taskType
  if (batchForm.active) changes.active = batchForm.active === 'enabled'

  batchSaving.value = true
  const queue = [...targets]
  const failedIds = new Set<string>()
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item) return
      try {
        await request(`/api/v1/admin/prompts/${item.id}`, {
          method: 'PATCH',
          body: changes,
          silent: true,
        })
        Object.assign(item, changes)
        selectedIds.delete(item.id)
      } catch {
        failedIds.add(item.id)
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(6, targets.length) }, worker))
    const successCount = targets.length - failedIds.size
    if (successCount) ElMessage.success(`已更新 ${successCount} 条提示词`)
    if (failedIds.size) {
      for (const id of failedIds) selectedIds.add(id)
      ElMessage.error(`${failedIds.size} 条更新失败，已保留选择`)
    } else {
      resetBatchForm()
    }

    const filterAffected =
      (Boolean(changes.category) && categoryFilter.value !== 'all') ||
      (Boolean(changes.taskType) && typeFilter.value !== 'all')
    if (filterAffected) await refresh()
  } finally {
    batchSaving.value = false
  }
}

async function applyBatchDelete() {
  const targets = selectedItems.value
  if (!targets.length) {
    ElMessage.warning('请先选择提示词')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认永久删除已选的 ${targets.length} 条提示词？删除后无法恢复。`,
      '批量删除提示词',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  batchDeleting.value = true
  const queue = [...targets]
  const failedIds = new Set<string>()
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item) return
      try {
        await request(`/api/v1/admin/prompts/${item.id}`, { method: 'DELETE', silent: true })
        selectedIds.delete(item.id)
      } catch {
        failedIds.add(item.id)
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(6, targets.length) }, worker))
    const successCount = targets.length - failedIds.size
    if (successCount) ElMessage.success(`已删除 ${successCount} 条提示词`)
    if (failedIds.size) {
      for (const id of failedIds) selectedIds.add(id)
      ElMessage.error(`${failedIds.size} 条删除失败，已保留选择`)
    }
    if (successCount) await refresh()
  } finally {
    batchDeleting.value = false
  }
}

const updatingItemFields = reactive(new Set<string>())

function categoryOptionsFor(item: PromptItem) {
  const options = categoryOptions.value.slice(1)
  if (!item.category || options.some((category) => category.value === item.category)) return options
  return [categoryMeta(item.category), ...options]
}

function categoryTotal(value: string) {
  const count = categoryCounts.value[value]
  if (typeof count === 'number') return count
  if (value === 'all') return promptScopeTotal.value
  return 0
}

async function quickChangeCategory(item: PromptItem, category: string) {
  if (!category || category === item.category) return
  const key = `${item.id}:category`
  if (updatingItemFields.has(key)) return
  const previous = item.category
  item.category = category
  updatingItemFields.add(key)
  try {
    await request(`/api/v1/admin/prompts/${item.id}`, { method: 'PATCH', body: { category } })
    ElMessage.success(`已移入「${categoryMeta(category).label}」`)
    if (categoryFilter.value !== 'all') await refresh()
  } catch {
    item.category = previous
  } finally {
    updatingItemFields.delete(key)
  }
}

async function quickChangeTaskType(item: PromptItem, taskType: string) {
  if (!taskType || taskType === item.taskType) return
  const key = `${item.id}:taskType`
  if (updatingItemFields.has(key)) return
  const previous = item.taskType
  item.taskType = taskType
  updatingItemFields.add(key)
  try {
    await request(`/api/v1/admin/prompts/${item.id}`, { method: 'PATCH', body: { taskType } })
    ElMessage.success(`已投放到「${taskTypeLabel(taskType)}」`)
    if (typeFilter.value !== 'all') await refresh()
  } catch {
    item.taskType = previous
  } finally {
    updatingItemFields.delete(key)
  }
}

const quickSortOpen = ref(false)
const quickSortLoading = ref(false)
const quickSortSaving = ref(false)
const quickSortItem = ref<PromptItem | null>(null)
const quickSortPosition = ref(1)
const quickSortCount = ref(1)
const quickSortScope = ref({ taskType: '', category: '', status: '' })

function currentSortScope() {
  return {
    taskType: typeFilter.value === 'all' ? '' : typeFilter.value,
    category: categoryFilter.value === 'all' ? '' : categoryFilter.value,
    status: statusFilter.value === 'all' ? '' : statusFilter.value,
  }
}

async function openQuickSort(item: PromptItem) {
  quickSortItem.value = item
  quickSortPosition.value = 1
  quickSortCount.value = Math.max(1, promptScopeTotal.value)
  quickSortScope.value = currentSortScope()
  quickSortOpen.value = true
  quickSortLoading.value = true
  try {
    const scope = quickSortScope.value
    const result = await request<{ position: number; count: number }>(
      `/api/v1/admin/prompts/${item.id}/position`,
      {
        query: { type: scope.taskType, category: scope.category, status: scope.status },
      },
    )
    if (quickSortItem.value?.id !== item.id) return
    quickSortPosition.value = result.position
    quickSortCount.value = result.count
  } finally {
    quickSortLoading.value = false
  }
}

async function submitQuickSort(position = quickSortPosition.value) {
  const item = quickSortItem.value
  if (!item || quickSortSaving.value) return
  const scope = quickSortScope.value
  const target = Math.max(1, Math.min(Math.round(position || 1), quickSortCount.value))
  quickSortSaving.value = true
  try {
    const result = await request<{ position: number; count: number }>(
      `/api/v1/admin/prompts/${item.id}/position`,
      {
        method: 'PATCH',
        body: {
          position: target,
          taskType: scope.taskType,
          category: scope.category,
          status: scope.status,
        },
      },
    )
    quickSortOpen.value = false
    ElMessage.success(`「${item.title}」已移到当前范围第 ${result.position} 位`)
    await refresh()
  } finally {
    quickSortSaving.value = false
  }
}

/* 瀑布流布局已迁至 useVirtualMasonryFeed（与用户端提示词页同逻辑） */

function categoryMeta(value: string | undefined): CategoryOption {
  const key = value ?? 'other'
  const found = categoryOptions.value.find((item) => item.value === key)
  if (found) return found
  // 自建分类：以原始 key 展示，用中性色
  return { value: key, label: key, icon: '·', color: '#94a3b8', active: false }
}

function formatTime(value: string | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function displayTag(tag: string) {
  const cleaned = String(tag || '')
    .replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D)+/gu, '')
    .trim()
  return cleaned || tag
}

function scheduleReload() {
  clearSelection()
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  filterReloadTimer = setTimeout(
    () => {
      filterReloadTimer = null
      void reset()
    },
    query.value.trim() ? 320 : 80,
  )
}

watch([query, categoryFilter, typeFilter, statusFilter, sourceFilter, orderFilter, tagFilter], scheduleReload)
watch([statusFilter, sourceFilter], clearSelection)

const hasFilters = computed(
  () =>
    Boolean(query.value.trim()) ||
    typeFilter.value !== 'all' ||
    statusFilter.value !== 'all' ||
    sourceFilter.value !== 'all' ||
    orderFilter.value !== 'manual' ||
    tagFilter.value.length > 0,
)

function resetFilters() {
  query.value = ''
  typeFilter.value = 'all'
  statusFilter.value = 'all'
  sourceFilter.value = 'all'
  orderFilter.value = 'manual'
  tagFilter.value = []
}

function onLibraryMore(command: string | number | object) {
  if (command === 'import') importFileRef.value?.click()
  else if (command === 'cache-external-covers') void cacheExternalCovers()
  else if (command === 'export-json') exportPromptLibrary('json')
  else if (command === 'export-csv') exportPromptLibrary('csv')
  else if (command === 'sort') openSortDrawer()
  else if (command === 'categories') categoryManagerOpen.value = true
}

async function cacheExternalCovers() {
  if (cachingExternalCovers.value) return
  try {
    await ElMessageBox.confirm(
      '系统会低并发下载外链封面并存入当前 OSS。原提示词内容不变，失败项会保留外链，可稍后重试。',
      '缓存外链封面到 OSS',
      { type: 'info', confirmButtonText: '开始缓存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  cachingExternalCovers.value = true
  let succeeded = 0
  let failed = 0
  let remaining = 0
  try {
    do {
      const result = await request<{ processed: number; succeeded: number; failed: number; remaining: number }>(
        '/api/v1/admin/prompts/external-covers/cache',
        { method: 'POST', body: { limit: 20 }, silent: true },
      )
      succeeded += result.succeeded
      failed += result.failed
      remaining = result.remaining
      if (!result.processed || !result.succeeded) break
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, 500))
    } while (remaining > 0)
    if (failed || remaining) {
      ElMessage.warning(`已缓存 ${succeeded} 张，${failed} 张本轮失败，剩余 ${remaining} 张可稍后重试`)
    } else {
      ElMessage.success(`外链封面已全部缓存到 OSS，共 ${succeeded} 张`)
    }
    await refresh()
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '外链封面缓存失败')
  } finally {
    cachingExternalCovers.value = false
  }
}

/* 大规模排序管理：服务端分页，每次只渲染一小段；跨页移动直接输入目标名次。
 * 当前页拖拽仍使用批量重排，未参与排序的条目保持原有相对位置。 */
const SORT_PAGE_SIZE = 60
const sortDrawerOpen = ref(false)
const sortLoading = ref(false)
const sortSaving = ref(false)
const sortItems = ref<PromptItem[]>([])
const sortSnapshot = ref<string[]>([])
const sortCategory = ref('all')
const sortType = ref('all')
const sortStatus = ref('all')
const sortPage = ref(1)
const sortCursors = ref<(string | null)[]>([null])
const sortNextCursor = ref<string | null>(null)
const sortMatchTotal = ref(0)
const sortScopeTotal = ref(0)
let sortFilterTimer: ReturnType<typeof setTimeout> | null = null
const sortDirty = computed(
  () => sortItems.value.map((item) => item.id).join('|') !== sortSnapshot.value.join('|'),
)

async function loadSortItems(resetPaging = false) {
  if (resetPaging) {
    sortPage.value = 1
    sortCursors.value = [null]
  }
  sortLoading.value = true
  try {
    const page: Page<PromptItem> = normalizeList(
      await request<PromptItem[] | Page<PromptItem>>('/api/v1/admin/prompts', {
        query: {
          type: sortType.value === 'all' ? '' : sortType.value,
          category: sortCategory.value === 'all' ? '' : sortCategory.value,
          status: sortStatus.value === 'all' ? '' : sortStatus.value,
          search: '',
          limit: SORT_PAGE_SIZE,
          cursor: sortCursors.value[sortPage.value - 1],
        },
        silent: true,
      }),
    )
    sortItems.value = page.items
    sortNextCursor.value = page.nextCursor
    sortMatchTotal.value = page.total ?? page.items.length
    sortScopeTotal.value = page.scopeTotal ?? sortMatchTotal.value
    if (page.nextCursor) sortCursors.value[sortPage.value] = page.nextCursor
    sortSnapshot.value = sortItems.value.map((item) => item.id)
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '排序列表加载失败')
  } finally {
    sortLoading.value = false
  }
}

function openSortDrawer() {
  sortCategory.value = categoryFilter.value
  sortType.value = typeFilter.value
  sortStatus.value = statusFilter.value
  sortDrawerOpen.value = true
  void loadSortItems(true)
}

async function closeSortDrawer() {
  if (!sortDirty.value || sortSaving.value) {
    sortDrawerOpen.value = false
    return
  }
  try {
    await ElMessageBox.confirm('当前排序还没有保存，确定放弃这些调整吗？', '放弃排序调整', {
      type: 'warning',
      confirmButtonText: '放弃调整',
      cancelButtonText: '继续排序',
    })
    sortDrawerOpen.value = false
  } catch {
    /* keep open */
  }
}

function reloadSortForFilters() {
  if (!sortDrawerOpen.value) return
  if (sortFilterTimer) clearTimeout(sortFilterTimer)
  sortFilterTimer = setTimeout(() => {
    sortFilterTimer = null
    void loadSortItems(true)
  }, 50)
}

watch([sortCategory, sortType, sortStatus], reloadSortForFilters)

async function changeSortPage(direction: -1 | 1) {
  if (sortDirty.value) {
    ElMessage.warning('请先保存或撤销当前页的拖拽调整')
    return
  }
  const nextPage = sortPage.value + direction
  if (nextPage < 1 || (direction > 0 && !sortNextCursor.value)) return
  sortPage.value = nextPage
  await loadSortItems()
}

async function saveSortOrder(refreshLibrary = true) {
  if (!sortItems.value.length || !sortDirty.value || sortSaving.value) return false
  sortSaving.value = true
  try {
    await request('/api/v1/admin/prompts/order', {
      method: 'PATCH',
      body: { ids: sortItems.value.map((item) => item.id) },
    })
    sortSnapshot.value = sortItems.value.map((item) => item.id)
    ElMessage.success(`已保存当前页 ${sortItems.value.length} 条提示词的顺序`)
    if (refreshLibrary) await refresh()
    return true
  } finally {
    sortSaving.value = false
  }
}

/* 新建/编辑对话框 */
const editorOpen = ref(false)
const saving = ref(false)
const editingId = ref('')
const pendingImage = ref<File | null>(null)
const previewUrl = ref('')
const coverInputRef = ref<HTMLInputElement | null>(null)
const coverPreviewOpen = ref(false)
const form = reactive({
  title: '',
  prompt: '',
  category: 'other',
  taskType: 't2i',
  tagsText: '',
  sort: 100,
  likeCount: 0,
  favoriteCount: 0,
  useCount: 0,
  active: true,
})

function openEditor(item: PromptItem | null = null) {
  editingId.value = item?.id ?? ''
  form.title = item?.title ?? ''
  form.prompt = item?.prompt ?? ''
  form.category = item?.category ?? 'other'
  form.taskType = item?.taskType ?? 't2i'
  form.tagsText = Array.isArray(item?.tags) ? item.tags.join('，') : ''
  form.sort = item?.sort ?? 100
  form.likeCount = Math.max(0, Number(item?.likeCount) || 0)
  form.favoriteCount = Math.max(0, Number(item?.favoriteCount) || 0)
  form.useCount = Math.max(0, Number(item?.useCount) || 0)
  form.active = item?.active !== false
  pendingImage.value = null
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = item?.coverUrl ?? ''
  editorOpen.value = true
}

function pickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    ElMessage.warning('封面仅支持 PNG、JPG 或 WebP')
    input.value = ''
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    ElMessage.warning('提示词封面不能超过 8MB')
    input.value = ''
    return
  }
  pendingImage.value = file
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(file)
  input.value = ''
}

function triggerCoverPick() {
  coverInputRef.value?.click()
}

function openCoverPreview() {
  if (!previewUrl.value) return
  coverPreviewOpen.value = true
}

async function uploadCover(id: string, file: File) {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`/api/v1/admin/prompts/${id}/cover`, {
    method: 'PUT',
    credentials: 'include',
    body,
  })
  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: { coverUrl?: string }; error?: string }
    | null
  if (!res.ok || !payload?.success) throw new Error(payload?.error || `封面上传失败（HTTP ${res.status}）`)
  return payload.data?.coverUrl ?? ''
}

async function save() {
  if (!form.title.trim() || !form.prompt.trim()) {
    ElMessage.warning('请填写提示词名称和内容')
    return
  }
  saving.value = true
  try {
    const body = {
      title: form.title.trim(),
      prompt: form.prompt,
      taskType: form.taskType,
      category: form.category,
      tags: form.tagsText
        .split(/[，,\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(editingId.value ? { sort: form.sort } : {}),
      likeCount: form.likeCount,
      favoriteCount: form.favoriteCount,
      useCount: form.useCount,
      active: form.active,
    }
    const creating = !editingId.value
    const saved = editingId.value
      ? await request<PromptItem>(`/api/v1/admin/prompts/${editingId.value}`, { method: 'PATCH', body })
      : await request<PromptItem>('/api/v1/admin/prompts', { method: 'POST', body })
    const id = saved?.id || editingId.value
    // 新增内容已落库后立即切换到编辑态，封面失败重试时不会重复创建词条。
    if (creating && id) editingId.value = id
    if (pendingImage.value && id) {
      previewUrl.value = (await uploadCover(id, pendingImage.value)) || previewUrl.value
      pendingImage.value = null
    }
    ElMessage.success('提示词已保存')
    editorOpen.value = false
    await refresh()
  } catch (error) {
    if (error instanceof Error && error.message) ElMessage.error(error.message)
  } finally {
    saving.value = false
  }
}

watch(editorOpen, (open) => {
  if (open) return
  coverPreviewOpen.value = false
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  pendingImage.value = null
})

async function toggleItem(item: PromptItem, active: boolean) {
  item.active = active
  try {
    await request(`/api/v1/admin/prompts/${item.id}`, { method: 'PATCH', body: { active } })
  } catch {
    item.active = !active
  }
}

async function remove(item: PromptItem) {
  await ElMessageBox.confirm(`确认永久删除「${item.title}」？`, '删除提示词', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  })
  await request(`/api/v1/admin/prompts/${item.id}`, { method: 'DELETE' })
  selectedIds.delete(item.id)
  ElMessage.success('提示词已删除')
  await refresh()
}

/* ============ 数据源管理（契约 v4：/api/v1/admin/prompt-sources） ============ */

interface FormatMeta {
  label: string
  color: string
}

/** json / markdown / html 各一色（取主题令牌，明暗主题自适应） */
const FORMAT_META: Record<PromptSource['format'], FormatMeta> = {
  json: { label: 'JSON', color: 'var(--info)' },
  markdown: { label: 'Markdown', color: 'var(--violet)' },
  html: { label: 'HTML', color: 'var(--warning)' },
}

function formatMeta(format: string): FormatMeta {
  return FORMAT_META[format as PromptSource['format']] ?? { label: format.toUpperCase(), color: 'var(--ink-3)' }
}

const sources = ref<PromptSource[]>([])
const enabledSourceCount = computed(() => sources.value.filter((source) => source.enabled).length)
const sourcesLoading = ref(false)
const sourcesDrawerOpen = ref(false)
const syncingSourceId = ref('')
const importBatches = ref<PromptImportBatch[]>([])
const importBatchCreating = ref(false)
const importMode = ref<'manual' | 'rules' | 'ai'>('rules')
const IMPORT_MODE_OPTIONS = [
  { label: '自动规则', value: 'rules' },
  { label: 'AI 辅助', value: 'ai' },
  { label: '全人工', value: 'manual' },
] as const
const importReviewOpen = ref(false)
const activeImportBatch = ref<PromptImportBatch | null>(null)
const importItems = ref<PromptImportItem[]>([])
const importItemsLoading = ref(false)
const importAnalyzing = ref(false)
const importBulkWorking = ref(false)
const importView = ref<'all' | 'duplicates' | 'pending' | 'approved' | 'rejected'>('all')
const IMPORT_VIEW_TABS: { label: string; value: typeof importView.value; countKey?: 'duplicateCount' | 'approvedCount' }[] = [
  { label: '全部', value: 'all' },
  { label: '重复项', value: 'duplicates', countKey: 'duplicateCount' },
  { label: '待处理', value: 'pending' },
  { label: '已通过', value: 'approved', countKey: 'approvedCount' },
  { label: '已移除', value: 'rejected' },
]
const importReviewSubtitle = computed(() => {
  const batch = activeImportBatch.value
  if (!batch) return ''
  return `共 ${batch.fetchedCount} 条 · 重复 ${batch.duplicateCount} · 已通过 ${batch.approvedCount} · 已入库 ${batch.importedCount + batch.updatedCount}`
})
const importPage = ref(1)
const importTotal = ref(0)
const selectedImportItemIds = ref<string[]>([])
const importFileRef = ref<HTMLInputElement | null>(null)
const importFileUploading = ref(false)
const importCoverInputRef = ref<HTMLInputElement | null>(null)
const importCoverTarget = ref<PromptImportItem | null>(null)
const importCoverPreviewUrl = ref('')
const importCoverUpdatingIds = reactive(new Set<string>())
const importSelectableItems = computed(() => importItems.value.filter((item) => !item.publishedAt))
const selectedImportItemSet = computed(() => new Set(selectedImportItemIds.value))
const importPageAllSelected = computed(() =>
  importSelectableItems.value.length > 0 &&
  importSelectableItems.value.every((item) => selectedImportItemSet.value.has(item.id)),
)
const importPageSomeSelected = computed(() =>
  importSelectableItems.value.some((item) => selectedImportItemSet.value.has(item.id)) &&
  !importPageAllSelected.value,
)

async function loadImportBatches(silent = false) {
  const data = await request<PromptImportBatch[] | Page<PromptImportBatch>>(
    '/api/v1/admin/prompt-import-batches',
    { silent },
  )
  importBatches.value = normalizeList(data).items
}

function exportPromptLibrary(format: 'json' | 'csv') {
  const link = document.createElement('a')
  link.href = `/api/v1/admin/prompts/export?format=${format}`
  link.download = ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function importPromptLibraryFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('导入文件不能超过 10MB')
    return
  }
  const body = new FormData()
  body.append('file', file)
  body.append('mode', importMode.value)
  importFileUploading.value = true
  try {
    const response = await fetch('/api/v1/admin/prompt-import-batches/upload', {
      method: 'POST', credentials: 'include', body,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `导入失败（${response.status}）`)
    const result = payload.data as { batchId: string; fetchedCount: number; duplicateCount: number }
    await loadImportBatches()
    const batch = importBatches.value.find((item) => item.id === result.batchId)
    if (batch) {
      importView.value = result.duplicateCount > 0 ? 'duplicates' : 'pending'
      await openImportBatch(batch)
      if (importMode.value === 'ai') void analyzeImportBatch()
    }
    ElMessage.success(`已从文件录入 ${result.fetchedCount} 条，进入批次审核`)
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '文件导入失败')
  } finally {
    importFileUploading.value = false
  }
}

async function createImportBatch() {
  if (!sources.value.some((source) => source.enabled)) {
    ElMessage.warning('请先启用至少一个数据源')
    return
  }
  importBatchCreating.value = true
  try {
    const result = await request<{ batchId: string; fetchedCount: number; duplicateCount: number; failedSourceCount: number }>(
      '/api/v1/admin/prompt-import-batches',
      { method: 'POST', body: { mode: importMode.value, sourceIds: [] } },
    )
    await Promise.all([loadSources(), loadImportBatches()])
    const batch = importBatches.value.find((item) => item.id === result.batchId)
    if (batch) {
      importView.value = result.duplicateCount > 0 ? 'duplicates' : 'pending'
      await openImportBatch(batch)
      if (importMode.value === 'ai') void analyzeImportBatch()
    }
    const failed = result.failedSourceCount ? `，${result.failedSourceCount} 个源失败` : ''
    ElMessage.success(`已获取 ${result.fetchedCount} 条，发现 ${result.duplicateCount} 条重复${failed}`)
  } finally {
    importBatchCreating.value = false
  }
}

async function loadImportItems() {
  const batch = activeImportBatch.value
  if (!batch) return
  importItemsLoading.value = true
  try {
    const page = await request<{ items: PromptImportItem[]; total: number }>(
      `/api/v1/admin/prompt-import-batches/${batch.id}/items`,
      { query: { view: importView.value, page: importPage.value, limit: 50 } },
    )
    importItems.value = page.items
    importTotal.value = page.total
  } finally {
    importItemsLoading.value = false
  }
}

async function openImportBatch(batch: PromptImportBatch) {
  activeImportBatch.value = batch
  importPage.value = 1
  selectedImportItemIds.value = []
  importReviewOpen.value = true
  await loadImportItems()
}

async function refreshImportBatch() {
  const batch = activeImportBatch.value
  if (!batch) return
  activeImportBatch.value = await request<PromptImportBatch>(`/api/v1/admin/prompt-import-batches/${batch.id}`)
  await loadImportItems()
  void loadImportBatches(true)
}

async function patchImportItem(item: PromptImportItem, changes: Record<string, unknown>) {
  const wasPublished = Boolean(item.publishedAt)
  const updated = await request<PromptImportItem>(
    `/api/v1/admin/prompt-import-batches/${item.batchId}/items/${item.id}`,
    { method: 'PATCH', body: changes, silent: true },
  )
  Object.assign(item, updated)
  await refreshImportBatch()
  if (!wasPublished && updated.publishedAt) await refresh()
}

async function approveImportItem(item: PromptImportItem) {
  await patchImportItem(item, {
    complianceStatus: 'safe',
    reviewStatus: 'approved',
    ...(item.duplicateKind !== 'none' ? { duplicateAction: 'keep' } : {}),
  })
  ElMessage.success('已通过并加入提示词库')
}

function triggerImportCoverPick(item: PromptImportItem) {
  if (item.publishedAt || importCoverUpdatingIds.has(item.id)) return
  importCoverTarget.value = item
  importCoverInputRef.value?.click()
}

function openImportCoverPreview(item: PromptImportItem) {
  if (!item.coverUrl) return
  importCoverPreviewUrl.value = item.coverUrl
}

async function uploadImportCover(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const item = importCoverTarget.value
  importCoverTarget.value = null
  if (!file || !item) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    ElMessage.warning('封面仅支持 PNG、JPG 或 WebP')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    ElMessage.warning('提示词封面不能超过 8MB')
    return
  }
  const body = new FormData()
  body.append('file', file)
  importCoverUpdatingIds.add(item.id)
  try {
    const response = await fetch(
      `/api/v1/admin/prompt-import-batches/${item.batchId}/items/${item.id}/cover`,
      { method: 'PUT', credentials: 'include', body },
    )
    const payload = await response.json().catch(() => null) as
      | { success?: boolean; data?: PromptImportItem; error?: string }
      | null
    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(payload?.error || `封面上传失败（HTTP ${response.status}）`)
    }
    Object.assign(item, payload.data)
    ElMessage.success('封面已替换')
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '封面上传失败')
  } finally {
    importCoverUpdatingIds.delete(item.id)
  }
}

function toggleImportItemSelection(item: PromptImportItem, checked: CheckboxValueType) {
  const next = new Set(selectedImportItemIds.value)
  if (checked) next.add(item.id)
  else next.delete(item.id)
  selectedImportItemIds.value = Array.from(next)
}

function toggleImportPageSelection(checked: CheckboxValueType) {
  const next = new Set(selectedImportItemIds.value)
  for (const item of importSelectableItems.value) {
    if (checked) next.add(item.id)
    else next.delete(item.id)
  }
  selectedImportItemIds.value = Array.from(next)
}

interface PromptImportBulkResult {
  batch: PromptImportBatch
  reviewed: number
  imported: number
  updated: number
}

function onImportReviewMore(command: string) {
  if (
    command === 'drop-duplicates' ||
    command === 'keep-duplicates' ||
    command === 'reject-blocked' ||
    command === 'approve-safe'
  ) {
    void bulkReviewImport(command)
  }
}

async function bulkReviewImport(action: string, itemIds: string[] = []) {
  const batch = activeImportBatch.value
  if (!batch || importBulkWorking.value) return
  importBulkWorking.value = true
  try {
    const result = await request<PromptImportBulkResult>(
      `/api/v1/admin/prompt-import-batches/${batch.id}/bulk-review`,
      { method: 'POST', body: { action, itemIds } },
    )
    selectedImportItemIds.value = []
    activeImportBatch.value = result.batch
    await Promise.all([loadImportItems(), loadImportBatches(true)])
    if (result.imported || result.updated) await refresh()
    if (action.startsWith('approve')) {
      ElMessage.success(`已审核 ${result.reviewed} 条，新增 ${result.imported} 条、更新 ${result.updated} 条`)
    } else {
      ElMessage.success(`已处理 ${result.reviewed} 条`)
    }
  } finally {
    importBulkWorking.value = false
  }
}

function approveSelectedImportItems() {
  if (!selectedImportItemIds.value.length) {
    ElMessage.warning('请先选择需要通过的数据')
    return
  }
  return bulkReviewImport('approve-selected', selectedImportItemIds.value)
}

function rejectSelectedImportItems() {
  if (!selectedImportItemIds.value.length) {
    ElMessage.warning('请先选择需要移除的数据')
    return
  }
  return bulkReviewImport('reject-selected', selectedImportItemIds.value)
}

async function approveAllImportItems() {
  try {
    await ElMessageBox.confirm(
      '将当前批次中所有待处理项标记为合规、保留重复项并立即加入提示词库。',
      '全部通过可入库项',
      { type: 'warning', confirmButtonText: '确认全部通过', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  await bulkReviewImport('approve-all')
}

async function analyzeImportBatch() {
  const batch = activeImportBatch.value
  if (!batch || importAnalyzing.value) return
  importAnalyzing.value = true
  try {
    const result = await request<{ analyzed: number }>(
      `/api/v1/admin/prompt-import-batches/${batch.id}/analyze`,
      { method: 'POST', silent: true },
    )
    ElMessage.success(`AI 已完成 ${result.analyzed} 条分类、去重与合规检测`)
    await refreshImportBatch()
  } catch (cause) {
    ElMessage.error({
      message: cause instanceof Error && cause.message ? cause.message : 'AI 检测失败',
      grouping: true,
    })
  } finally {
    importAnalyzing.value = false
  }
}

async function loadSources(silent = false) {
  sourcesLoading.value = true
  try {
    const data = await request<PromptSource[] | Page<PromptSource>>('/api/v1/admin/prompt-sources', { silent })
    sources.value = normalizeList(data).items
  } catch {
    // 错误提示由 request 统一处理（silent 时静默，页头徽标保持旧值）
  } finally {
    sourcesLoading.value = false
  }
}

function openSourcesDrawer() {
  sourcesDrawerOpen.value = true
  void Promise.all([loadSources(), loadImportBatches()])
}

/** ISO 时间 → 相对时间（源卡片"上次同步"用） */
function relativeTime(value: string | null | undefined): string {
  if (!value) return '尚未同步'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '未知时间'
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return formatTime(value)
}

function intervalLabel(minutes: number | undefined): string {
  const value = Number(minutes) || 360
  if (value < 60) return `每 ${value} 分钟`
  if (value % 1440 === 0) return `每 ${value / 1440} 天`
  if (value % 60 === 0) return `每 ${value / 60} 小时`
  return `每 ${value} 分钟`
}

function sourceUrlOf(source: PromptSource) {
  return source.url || ''
}

async function copyPromptText(item: PromptItem) {
  const text = item.prompt?.trim()
  if (!text) {
    ElMessage.warning('该提示词没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('提示词已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

/** 启停开关：即改即存，失败回滚 */
async function toggleSource(source: PromptSource, enabled: boolean) {
  source.enabled = enabled
  try {
    await request(`/api/v1/admin/prompt-sources/${source.id}`, { method: 'PATCH', body: { enabled } })
  } catch {
    source.enabled = !enabled
  }
}

async function syncSource(source: PromptSource) {
  syncingSourceId.value = source.id
  try {
    const result = await request<{ batchId: string; fetchedCount: number; duplicateCount: number }>(
      '/api/v1/admin/prompt-import-batches',
      { method: 'POST', body: { mode: importMode.value, sourceIds: [source.id] } },
    )
    await Promise.all([loadSources(), loadImportBatches()])
    const batch = importBatches.value.find((item) => item.id === result.batchId)
    if (batch) {
      importView.value = result.duplicateCount > 0 ? 'duplicates' : 'pending'
      await openImportBatch(batch)
      if (importMode.value === 'ai') void analyzeImportBatch()
    }
    ElMessage.success(`已获取 ${result.fetchedCount} 条，进入审核 ${result.duplicateCount} 条重复项`)
  } catch {
    // 错误提示由 request 统一弹出；重新拉取以展示 lastError
    await loadSources(true)
  } finally {
    syncingSourceId.value = ''
  }
}

async function removeSource(source: PromptSource) {
  const purgeItems = ref(false)
  await ElMessageBox({
    title: '删除数据源',
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
    message: () =>
      h('div', { class: 'source-delete-confirm' }, [
        h('p', null, `确认删除「${source.name}」？删除后该源的自动同步随之停止。`),
        h(
          ElCheckbox,
          {
            modelValue: purgeItems.value,
            'onUpdate:modelValue': (value: CheckboxValueType) => {
              purgeItems.value = Boolean(value)
            },
          },
          { default: () => `连带删除该源已导入的 ${source.itemCount} 条词条` },
        ),
      ]),
  })
  await request(`/api/v1/admin/prompt-sources/${source.id}`, {
    method: 'DELETE',
    query: purgeItems.value ? { purgeItems: 1 } : undefined,
  })
  ElMessage.success(purgeItems.value ? '数据源与已导入词条已删除' : '数据源已删除')
  await Promise.all([loadSources(), refresh()])
}

/* 新建 / 编辑数据源对话框 */
const sourceEditorOpen = ref(false)
const sourceSaving = ref(false)
const editingSourceId = ref('')
const sourceForm = reactive({
  name: '',
  sourceUrl: '',
  format: 'json' as PromptSource['format'],
  taskType: 't2i',
  defaultTagsText: '',
  syncIntervalMinutes: 360,
  autoSyncEnabled: true,
})

function openSourceEditor(source: PromptSource | null = null) {
  editingSourceId.value = source?.id ?? ''
  sourceForm.name = source?.name ?? ''
  sourceForm.sourceUrl = source ? sourceUrlOf(source) : ''
  sourceForm.format = source?.format ?? 'json'
  sourceForm.taskType = source?.taskType ?? 't2i'
  sourceForm.defaultTagsText = Array.isArray(source?.defaultTags) ? source.defaultTags.join('\n') : ''
  sourceForm.syncIntervalMinutes = source?.syncIntervalMinutes ?? 360
  sourceForm.autoSyncEnabled = source?.autoSyncEnabled !== false
  sourceEditorOpen.value = true
}

async function saveSource() {
  if (!sourceForm.name.trim() || !sourceForm.sourceUrl.trim()) {
    ElMessage.warning('请填写数据源名称和源地址')
    return
  }
  sourceSaving.value = true
  try {
    const body = {
      name: sourceForm.name.trim(),
      sourceUrl: sourceForm.sourceUrl.trim(),
      format: sourceForm.format,
      taskType: sourceForm.taskType,
      defaultTags: sourceForm.defaultTagsText
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean),
      syncIntervalMinutes: sourceForm.syncIntervalMinutes,
      autoSyncEnabled: sourceForm.autoSyncEnabled,
    }
    if (editingSourceId.value) {
      await request(`/api/v1/admin/prompt-sources/${editingSourceId.value}`, { method: 'PATCH', body })
    } else {
      await request('/api/v1/admin/prompt-sources', { method: 'POST', body: { ...body, enabled: true } })
    }
    ElMessage.success('数据源已保存')
    sourceEditorOpen.value = false
    await loadSources()
  } catch {
    // 错误提示由 request 统一处理
  } finally {
    sourceSaving.value = false
  }
}

onMounted(() => {
  void reset()
  void loadPromptCategories()
  void loadSources(true)
  void loadImportBatches(true)
})

watch(importView, () => {
  importPage.value = 1
  selectedImportItemIds.value = []
  void loadImportItems()
})

onBeforeUnmount(() => {
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  if (sortFilterTimer) clearTimeout(sortFilterTimer)
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="prompt-library-page">
    <header class="library-toolbar">
      <div class="library-toolbar__filters">
        <el-input
          v-model="query"
          :prefix-icon="Search"
          clearable
          placeholder="搜索名称、提示词或标签"
          class="prompt-search"
        />
        <el-select v-model="typeFilter" class="toolbar-select" aria-label="投放功能">
          <el-option label="全部功能" value="all" />
          <el-option v-for="type in PROMPT_TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
        </el-select>
        <el-select v-model="statusFilter" class="toolbar-select is-short" aria-label="状态">
          <el-option label="全部状态" value="all" />
          <el-option label="已启用" value="enabled" />
          <el-option label="已停用" value="disabled" />
          <el-option label="缺少封面" value="missing-cover" />
        </el-select>
        <el-select v-model="sourceFilter" class="toolbar-select is-short" aria-label="来源">
          <el-option label="全部来源" value="all" />
          <el-option label="远程同步" value="synced" />
          <el-option label="本地创建" value="local" />
        </el-select>
        <el-select v-model="orderFilter" class="toolbar-select is-short" aria-label="排序">
          <el-option label="手动排序" value="manual" />
          <el-option label="最新创建" value="latest" />
          <el-option label="点赞最多" value="likes" />
          <el-option label="收藏最多" value="favorites" />
          <el-option label="使用最多" value="usage" />
          <el-option label="综合热度" value="recommended" />
        </el-select>
        <el-select
          v-model="tagFilter"
          class="toolbar-select is-tags"
          multiple
          collapse-tags
          collapse-tags-tooltip
          clearable
          filterable
          placeholder="按标签筛选"
          aria-label="标签"
        >
          <el-option v-for="tag in availableTags" :key="tag" :label="displayTag(tag)" :value="tag" />
        </el-select>
        <el-button v-if="hasFilters" @click="resetFilters">重置</el-button>
      </div>
      <div class="library-toolbar__actions">
        <input
          ref="importFileRef"
          class="prompt-transfer-input"
          type="file"
          accept=".json,.csv,application/json,text/csv"
          @change="importPromptLibraryFile"
        />
        <el-dropdown trigger="click" @command="onLibraryMore">
          <el-button>
            更多
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="import" :icon="UploadFilled">
                导入 JSON / CSV
              </el-dropdown-item>
              <el-dropdown-item command="export-json" :icon="Download">
                导出 JSON
              </el-dropdown-item>
              <el-dropdown-item command="export-csv" :icon="Download">
                导出 CSV
              </el-dropdown-item>
              <el-dropdown-item command="cache-external-covers" :icon="Picture" divided :disabled="cachingExternalCovers">
                {{ cachingExternalCovers ? '正在缓存外链封面…' : '缓存外链封面到 OSS' }}
              </el-dropdown-item>
              <el-dropdown-item command="sort" :icon="Rank">
                排序
              </el-dropdown-item>
              <el-dropdown-item command="categories" :icon="CollectionTag">
                分类管理
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-badge :value="sources.length" :hidden="!sources.length" :offset="[-4, 4]" class="sources-entry-badge">
          <el-button :icon="Link" @click="openSourcesDrawer">数据源</el-button>
        </el-badge>
        <el-button
          :type="selectionMode ? 'primary' : ''"
          :icon="EditPen"
          :disabled="batchBusy"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? '退出多选' : '多选' }}
        </el-button>
        <div class="library-toolbar__buttons">
          <el-button type="primary" :icon="Plus" @click="openEditor()">新增</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>
    </header>

    <section class="items-workspace">
      <aside class="category-rail" aria-label="内容分类">
        <button
          v-for="category in categoryOptions"
          :key="category.value"
          type="button"
          :class="{
            'is-active': categoryFilter === category.value,
          }"
          @click="categoryFilter = category.value"
          :data-prompt-category="category.value"
        >
          <i :style="{ '--category-color': category.color }">{{ category.icon }}</i>
          <span>{{ category.label }}</span>
          <em class="tnum">{{ categoryTotal(category.value) }}</em>
        </button>
      </aside>

      <main class="prompt-content">
          <div ref="promptContentRef" class="prompt-content__scroll" @scroll.passive="onPromptScroll">
          <ListError :error="error" :loading="loading" @retry="retry" />

          <div v-if="selectionMode" class="prompt-bulk-bar" :class="{ 'is-active': selectedItems.length }">
            <div class="prompt-bulk-selection">
              <el-checkbox
                :model-value="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                :disabled="!visibleItems.length || batchBusy"
                @change="toggleVisibleSelection(Boolean($event))"
              >
                全选当前结果
              </el-checkbox>
              <span v-if="selectedItems.length">已选 {{ selectedItems.length }} 条</span>
            </div>
            <div v-if="selectedItems.length" class="prompt-bulk-controls">
              <el-select
                v-model="batchForm.category"
                clearable
                size="small"
                placeholder="修改分类"
                aria-label="批量修改分类"
                :disabled="batchBusy"
              >
                <el-option
                  v-for="category in categoryOptions.slice(1)"
                  :key="category.value"
                  :label="category.label"
                  :value="category.value"
                />
              </el-select>
              <el-select
                v-model="batchForm.taskType"
                clearable
                size="small"
                placeholder="修改投放"
                aria-label="批量修改投放功能"
                :disabled="batchBusy"
              >
                <el-option v-for="type in PROMPT_TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
              </el-select>
              <el-select
                v-model="batchForm.active"
                clearable
                size="small"
                placeholder="修改状态"
                aria-label="批量修改状态"
                :disabled="batchBusy"
              >
                <el-option label="启用" value="enabled" />
                <el-option label="停用" value="disabled" />
              </el-select>
              <el-button
                type="primary"
                size="small"
                :loading="batchSaving"
                :disabled="!hasBatchChanges || batchBusy"
                @click="applyBatchEdit"
              >
                应用修改
              </el-button>
              <el-button
                type="danger"
                size="small"
                :icon="Delete"
                :loading="batchDeleting"
                :disabled="batchBusy"
                @click="applyBatchDelete"
              >
                删除
              </el-button>
              <el-button text size="small" :disabled="batchBusy" @click="clearSelection">清除选择</el-button>
            </div>
          </div>

          <div class="prompt-grid" :class="{ 'is-refreshing': refreshing, 'is-scrolling': isGridScrolling }">
            <div v-if="initialLoading" class="prompt-grid__loading">正在加载提示词…</div>

            <div
              v-else-if="visibleItems.length"
              ref="masonryRef"
              class="prompt-masonry"
              :style="{ height: `${masonryHeight}px` }"
            >
              <article
                v-for="entry in visibleMasonryItems"
                :key="entry.key"
                class="prompt-card prompt-masonry__item"
                :class="{
                  'is-disabled': !entry.item.active,
                  'is-selected': selectedIds.has(entry.item.id),
                  'is-selection-mode': selectionMode,
                }"
                :style="{
                  width: `${entry.width}px`,
                  height: `${entry.height}px`,
                  transform: `translate3d(${entry.left}px, ${entry.top}px, 0)`,
                }"
              >
                <div
                  class="prompt-cover"
                  :class="{ 'has-image': Boolean(entry.cover) }"
                  :style="{ height: `${entry.mediaHeight}px` }"
                  @click="
                    selectionMode
                      ? toggleSelected(entry.item.id, !selectedIds.has(entry.item.id))
                      : openEditor(entry.item)
                  "
                >
                  <img
                    v-if="entry.cover"
                    :src="String(entry.cover)"
                    :alt="entry.item.title"
                    :loading="imageLoadingMode(entry.index)"
                    decoding="async"
                    draggable="false"
                    :width="Math.max(1, Math.round(entry.width))"
                    :height="Math.max(1, entry.mediaHeight)"
                    @load="measureFromEvent(entry.key, $event)"
                  />
                  <div v-else class="prompt-cover__empty">
                    <el-icon><Picture /></el-icon>
                    <span>缺少封面</span>
                  </div>
                  <el-checkbox
                    v-if="selectionMode"
                    class="prompt-card__select"
                    :model-value="selectedIds.has(entry.item.id)"
                    :aria-label="`选择 ${entry.item.title}`"
                    @click.stop
                    @change="toggleSelected(entry.item.id, Boolean($event))"
                  />
                  <span
                    v-if="entry.item.sourceId"
                    class="sync-badge"
                    title="来自远程数据源，同步时会自动更新"
                  >
                    <el-icon><Link /></el-icon>
                    同步
                  </span>
                  <div v-if="entry.item.tags?.length" class="prompt-cover__tags">
                    <span v-for="tag in (entry.item.tags ?? []).slice(0, 3)" :key="tag">{{ displayTag(tag) }}</span>
                  </div>
                  <span class="prompt-cover__time">{{ formatTime(entry.item.createdAt) }}</span>
                  <div class="prompt-cover__stats">
                    <span class="is-like" title="点赞"><el-icon><Star /></el-icon>{{ entry.item.likeCount || 0 }}</span>
                    <span class="is-favorite" title="收藏"><el-icon><CollectionTag /></el-icon>{{ entry.item.favoriteCount || 0 }}</span>
                    <span class="is-use" title="使用"><el-icon><Pointer /></el-icon>{{ entry.item.useCount || 0 }}</span>
                  </div>
                </div>

                <div class="prompt-card__body">
                  <header>
                    <strong class="prompt-card__name" :title="entry.item.title">{{ entry.item.title }}</strong>
                    <div class="prompt-card__header-actions">
                      <el-tooltip content="复制提示词" placement="top">
                        <button
                          type="button"
                          class="prompt-copy-btn"
                          aria-label="复制提示词"
                          @click.stop="copyPromptText(entry.item)"
                        >
                          <el-icon><CopyDocument /></el-icon>
                        </button>
                      </el-tooltip>
                      <el-switch
                        :model-value="entry.item.active"
                        size="small"
                        @change="toggleItem(entry.item, Boolean($event))"
                      />
                    </div>
                  </header>

                  <div class="prompt-card__toolbar">
                    <el-select
                      :model-value="entry.item.category"
                      size="small"
                      :loading="updatingItemFields.has(`${entry.item.id}:category`)"
                      aria-label="快捷分类"
                      @change="quickChangeCategory(entry.item, String($event))"
                    >
                      <el-option
                        v-for="category in categoryOptionsFor(entry.item)"
                        :key="category.value"
                        :label="category.label"
                        :value="category.value"
                      />
                    </el-select>
                    <el-select
                      :model-value="entry.item.taskType"
                      size="small"
                      :loading="updatingItemFields.has(`${entry.item.id}:taskType`)"
                      aria-label="快捷投放"
                      @change="quickChangeTaskType(entry.item, String($event))"
                    >
                      <el-option
                        v-for="type in PROMPT_TASK_TYPES"
                        :key="type"
                        :label="taskTypeLabel(type)"
                        :value="type"
                      />
                    </el-select>
                    <div class="prompt-card__actions">
                      <el-button link @click="openQuickSort(entry.item)">位置</el-button>
                      <el-button link type="primary" @click="openEditor(entry.item)">编辑</el-button>
                      <el-button link type="danger" @click="remove(entry.item)">删除</el-button>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <div v-if="!initialLoading && !visibleItems.length" class="library-empty">
              <el-icon><CollectionTag /></el-icon>
              <strong>{{ items.length || promptScopeTotal ? '没有匹配的提示词' : '还没有提示词' }}</strong>
              <span>
                {{
                  hasFilters || categoryFilter !== 'all'
                    ? '调整分类或筛选条件后再试'
                    : '新增或导入后会立即出现在用户端提示词库'
                }}
              </span>
              <el-button v-if="hasFilters" @click="resetFilters">清除筛选</el-button>
              <el-button v-else type="primary" :icon="Plus" @click="openEditor()">新增提示词</el-button>
            </div>
          </div>

          <div
            v-if="visibleItems.length"
            class="prompt-load-status"
            :class="{ 'is-loading': loadingMore }"
          >
            <span v-if="loadingMore">正在加载更多…</span>
            <span v-else-if="!hasMore">已加载全部 {{ items.length }} 条</span>
          </div>
          </div>
      </main>
    </section>

    <PromptCategoryManager
      v-model="categoryManagerOpen"
      @changed="handlePromptCategoriesChanged"
    />

    <AdminDialog
      v-model="quickSortOpen"
      title="调整展示顺序"
      subtitle="输入名次后保存，其他提示词会自动顺延"
      :icon="Rank"
      width="min(520px, 92vw)"
      confirm-text="保存位置"
      :confirm-loading="quickSortSaving"
      :confirm-disabled="quickSortLoading"
      @confirm="submitQuickSort()"
    >
      <div v-loading="quickSortLoading" class="prompt-quick-sort-panel">
        <div v-if="quickSortItem" class="prompt-quick-sort-item">
          <span class="prompt-quick-sort-cover">
            <img v-if="quickSortItem.coverUrl" :src="quickSortItem.coverUrl" :alt="quickSortItem.title" />
            <el-icon v-else><Picture /></el-icon>
          </span>
          <span>
            <small>正在调整</small>
            <strong>{{ quickSortItem.title }}</strong>
            <em>
              {{ quickSortScope.category ? categoryMeta(quickSortScope.category).label : '全部内容' }} ·
              {{ quickSortScope.taskType ? taskTypeLabel(quickSortScope.taskType) : '全部功能' }}
            </em>
          </span>
        </div>
        <div class="prompt-quick-sort-rank">
          <span>当前位于</span>
          <strong>第 {{ quickSortPosition }} 位</strong>
          <small>当前范围共 {{ quickSortCount }} 条</small>
        </div>
        <label class="prompt-quick-sort-input">
          <span>移动到目标名次</span>
          <el-input-number
            v-model="quickSortPosition"
            :min="1"
            :max="Math.max(1, quickSortCount)"
            controls-position="right"
            :disabled="quickSortLoading || quickSortSaving"
          />
        </label>
      </div>
      <template #footer>
        <div class="admin-dialog__footer prompt-quick-sort-footer">
          <div class="admin-dialog__actions" style="margin-right: auto">
            <el-button :disabled="quickSortLoading || quickSortSaving" @click="submitQuickSort(1)">置顶</el-button>
            <el-button :disabled="quickSortLoading || quickSortSaving" @click="submitQuickSort(quickSortCount)">置底</el-button>
          </div>
          <div class="admin-dialog__actions">
            <el-button :disabled="quickSortSaving" @click="quickSortOpen = false">取消</el-button>
            <el-button
              type="primary"
              :loading="quickSortSaving"
              :disabled="quickSortLoading"
              @click="submitQuickSort()"
            >
              保存位置
            </el-button>
          </div>
        </div>
      </template>
    </AdminDialog>

    <AdminDialog
      v-model="sortDrawerOpen"
      title="调整提示词顺序"
      subtitle="拖动缩略图排序，保存后同步到词库展示"
      :icon="Rank"
      width="min(560px, 94vw)"
      nested-scroll
      panel-class="prompt-sort-dialog"
      :close-on-click-modal="!sortDirty"
      confirm-text="保存顺序"
      :confirm-loading="sortSaving"
      :confirm-disabled="!sortDirty || !sortItems.length"
      @confirm="saveSortOrder()"
    >
      <template #footer>
        <div class="admin-dialog__footer">
          <span class="admin-dialog__hint">
            {{ sortDirty ? '当前页顺序有改动，尚未保存' : `当前范围 ${sortScopeTotal} 条 · 每页 ${SORT_PAGE_SIZE} 条` }}
          </span>
          <div class="admin-dialog__actions">
            <el-button :disabled="sortSaving" @click="closeSortDrawer">取消</el-button>
            <el-button type="primary" :loading="sortSaving" :disabled="!sortDirty || !sortItems.length" @click="saveSortOrder()">
              保存顺序
            </el-button>
          </div>
        </div>
      </template>
      <div class="prompt-sort-panel">
        <div class="prompt-sort-filters">
          <el-select v-model="sortCategory" aria-label="排序分类">
            <el-option v-for="category in categoryOptions" :key="category.value" :label="category.label" :value="category.value" />
          </el-select>
          <el-select v-model="sortType" aria-label="排序功能">
            <el-option label="全部功能" value="all" />
            <el-option v-for="type in PROMPT_TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
          </el-select>
          <el-select v-model="sortStatus" aria-label="排序状态">
            <el-option label="全部状态" value="all" />
            <el-option label="已启用" value="enabled" />
            <el-option label="已停用" value="disabled" />
            <el-option label="缺少封面" value="missing-cover" />
          </el-select>
        </div>

        <div v-if="sortLoading" class="prompt-sort-empty" v-loading="true" />
        <div v-else-if="!sortItems.length" class="prompt-sort-empty">
          <el-icon><Rank /></el-icon>
          <strong>当前筛选范围没有提示词</strong>
        </div>
        <draggable
          v-else
          v-model="sortItems"
          item-key="id"
          handle=".prompt-sort-handle"
          :animation="180"
          ghost-class="is-sort-ghost"
          drag-class="is-sort-dragging"
          class="prompt-sort-list"
        >
          <template #item="{ element: item, index }">
            <article class="prompt-sort-row">
              <span class="prompt-sort-index">{{ (sortPage - 1) * SORT_PAGE_SIZE + index + 1 }}</span>
              <button
                type="button"
                class="prompt-sort-handle prompt-sort-cover"
                :aria-label="`拖动第 ${(sortPage - 1) * SORT_PAGE_SIZE + index + 1} 项`"
              >
                <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" loading="lazy" />
                <el-icon v-else><Picture /></el-icon>
              </button>
            </article>
          </template>
        </draggable>

        <div v-if="!sortLoading && sortItems.length" class="prompt-sort-pagination">
          <CursorPager
            :has-prev="sortPage > 1"
            :has-next="Boolean(sortNextCursor)"
            :loading="sortLoading"
            :page="sortPage"
            :count="sortItems.length"
            :total="sortMatchTotal"
            @prev="changeSortPage(-1)"
            @next="changeSortPage(1)"
          />
        </div>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="editorOpen"
      :title="editingId ? '编辑提示词' : '新增提示词'"
      subtitle="完善内容与发布设置，保存后立即同步到用户端词库"
      :icon="EditPen"
      width="min(1280px, 94vw)"
      nested-scroll
      confirm-text="保存提示词"
      :confirm-loading="saving"
      :footer-hint="pendingImage ? '已选择新封面，保存时一并上传' : ''"
      @confirm="save"
    >
      <el-form label-position="top" class="editor-form editor-form--wide">
        <section class="editor-basics-panel">
          <div class="editor-meta-grid">
            <el-form-item label="名称"><el-input v-model="form.title" maxlength="80" placeholder="请输入清晰易懂的提示词名称" /></el-form-item>
            <el-form-item label="内容分类">
              <el-select
                v-model="form.category"
                filterable
                placeholder="选择内容分类"
                style="width: 100%"
              >
                <el-option
                  v-for="category in categoryOptions.slice(1)"
                  :key="category.value"
                  :label="`${category.label}（${category.value}）${category.active ? '' : ' · 已停用'}`"
                  :value="category.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="标签" class="editor-tags-field">
              <el-input v-model="form.tagsText" placeholder="用逗号分隔，例如：电影感，人物，霓虹" />
            </el-form-item>
            <el-form-item label="投放功能" class="editor-task-field">
              <el-select v-model="form.taskType" placeholder="选择投放功能" style="width: 100%">
                <el-option
                  v-for="type in PROMPT_TASK_TYPES"
                  :key="type"
                  :label="taskTypeLabel(type)"
                  :value="type"
                />
              </el-select>
            </el-form-item>
          </div>
          <div class="editor-publish-row">
            <el-form-item class="editor-publish-field">
              <el-switch v-model="form.active" inline-prompt active-text="开" inactive-text="关" />
            </el-form-item>
            <div class="editor-heat-metrics">
              <label class="editor-heat-metric">
                <span>点赞</span>
                <el-input-number v-model="form.likeCount" :min="0" :max="100000000" :controls="false" />
              </label>
              <label class="editor-heat-metric">
                <span>收藏</span>
                <el-input-number v-model="form.favoriteCount" :min="0" :max="100000000" :controls="false" />
              </label>
              <label class="editor-heat-metric">
                <span>使用</span>
                <el-input-number v-model="form.useCount" :min="0" :max="100000000" :controls="false" />
              </label>
            </div>
          </div>
        </section>

        <div class="editor-work-layout">
          <aside class="editor-options-panel">
            <section class="editor-setting-card editor-cover-card" :class="{ 'has-image': Boolean(previewUrl) }">
              <div class="image-picker">
                <button
                  v-if="previewUrl"
                  type="button"
                  class="image-picker__preview"
                  aria-label="全屏预览封面"
                  @click="openCoverPreview"
                >
                  <img :src="previewUrl" alt="提示词封面预览" />
                </button>
                <button
                  v-else
                  type="button"
                  class="image-picker__empty"
                  @click="triggerCoverPick"
                >
                  <el-icon :size="22"><Picture /></el-icon>
                  <strong>点击上传封面</strong>
                  <small>PNG / JPG / WebP · 8MB</small>
                </button>
                <button
                  v-if="previewUrl"
                  type="button"
                  class="image-picker__replace"
                  @click.stop="triggerCoverPick"
                >
                  更换图片
                </button>
                <input
                  ref="coverInputRef"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  @change="pickImage"
                />
              </div>
            </section>
          </aside>

          <section class="editor-prompt-panel editor-surface-card">
            <el-form-item class="prompt-body-field">
              <el-input
                v-model="form.prompt"
                type="textarea"
                maxlength="8000"
                show-word-limit
                placeholder="描述主体、构图、风格与细节要求…"
              />
            </el-form-item>
          </section>
        </div>
      </el-form>
    </AdminDialog>

    <el-image-viewer
      v-if="coverPreviewOpen && previewUrl"
      :url-list="[previewUrl]"
      teleported
      @close="coverPreviewOpen = false"
    />

    <el-drawer
      v-model="sourcesDrawerOpen"
      size="640px"
      append-to-body
      class="library-drawer sources-drawer"
    >
      <template #header>
        <div class="library-drawer__head">
          <span class="library-drawer__mark"><el-icon><Link /></el-icon></span>
          <div>
            <strong>提示词数据源</strong>
            <small>{{ enabledSourceCount }} / {{ sources.length }} 个已启用</small>
          </div>
          <el-button type="primary" :icon="Plus" @click="openSourceEditor()">新建源</el-button>
        </div>
      </template>
      <div class="sources-panel">
        <section class="import-launcher">
          <div class="import-mode-pills" role="radiogroup" aria-label="导入模式">
            <button
              v-for="mode in IMPORT_MODE_OPTIONS"
              :key="mode.value"
              type="button"
              role="radio"
              :aria-checked="importMode === mode.value"
              class="import-mode-pills__item"
              :class="{ 'is-active': importMode === mode.value }"
              @click="importMode = mode.value"
            >
              {{ mode.label }}
            </button>
          </div>
          <el-button
            type="primary"
            :icon="MagicStick"
            :loading="importBatchCreating"
            @click="createImportBatch"
          >
            获取全部源
          </el-button>
        </section>

        <section v-if="importBatches.length" class="import-batches">
          <header>
            <strong>最近批次</strong>
            <span>待审核可继续处理</span>
          </header>
          <div class="import-batch-grid">
            <button
              v-for="batch in importBatches.slice(0, 6)"
              :key="batch.id"
              type="button"
              class="import-batch-card"
              @click="openImportBatch(batch)"
            >
              <span class="import-batch-card__status" :class="`is-${batch.status}`">
                {{ batch.status === 'review' ? '待审核' : batch.status === 'completed' ? '已发布' : batch.status === 'failed' ? '失败' : '处理中' }}
              </span>
              <span class="import-batch-card__counts">
                <strong class="tnum">{{ batch.fetchedCount }} 条</strong>
                <span v-if="batch.duplicateCount">重复 {{ batch.duplicateCount }}</span>
              </span>
            </button>
          </div>
        </section>

        <section class="source-list-section">
          <header class="source-list-head">
            <strong>数据源</strong>
            <span class="tnum">{{ sources.length }} 个</span>
          </header>

          <div v-loading="sourcesLoading" class="source-list">
          <article
            v-for="source in sources"
            :key="source.id"
            class="source-card"
            :class="{ 'is-disabled': !source.enabled }"
          >
            <header class="source-card__head">
              <div class="source-card__title">
                <span class="source-card__state" :class="{ 'is-active': source.enabled }" />
                <strong :title="sourceUrlOf(source) || source.name">{{ source.name }}</strong>
                <span class="format-badge" :style="{ '--format-color': formatMeta(source.format).color }">
                  {{ formatMeta(source.format).label }}
                </span>
              </div>
              <el-switch
                :model-value="source.enabled"
                size="small"
                :aria-label="`${source.enabled ? '停用' : '启用'} ${source.name}`"
                @change="toggleSource(source, Boolean($event))"
              />
            </header>

            <div v-if="source.lastError" class="source-card__error">
              <el-icon><WarningFilled /></el-icon>
              <span :title="source.lastError">{{ source.lastError }}</span>
            </div>

            <footer class="source-card__footer">
              <p class="source-card__meta">
                <span class="tnum">{{ source.itemCount ?? 0 }} 条</span>
                <span>{{ taskTypeLabel(source.taskType) }}</span>
                <span>{{ source.lastSyncedAt ? `${relativeTime(source.lastSyncedAt)}同步` : '尚未同步' }}</span>
                <span :class="{ 'is-auto': source.autoSyncEnabled }">
                  {{ source.autoSyncEnabled ? intervalLabel(source.syncIntervalMinutes) : '仅手动' }}
                </span>
              </p>
              <div class="source-card__actions">
                <el-button
                  size="small"
                  text
                  :icon="Refresh"
                  :loading="syncingSourceId === source.id"
                  @click="syncSource(source)"
                >
                  获取
                </el-button>
                <el-button
                  size="small"
                  text
                  :icon="EditPen"
                  :aria-label="`编辑 ${source.name}`"
                  @click="openSourceEditor(source)"
                />
                <el-button
                  size="small"
                  text
                  type="danger"
                  :icon="Delete"
                  :aria-label="`删除 ${source.name}`"
                  @click="removeSource(source)"
                />
              </div>
            </footer>
          </article>

          <div v-if="!sourcesLoading && !sources.length" class="sources-empty">
            <el-icon><Link /></el-icon>
            <strong>还没有数据源</strong>
            <span>新建后即可批量获取并审核导入</span>
            <el-button type="primary" :icon="Plus" @click="openSourceEditor()">新建源</el-button>
          </div>
          </div>
        </section>
      </div>
    </el-drawer>

    <AdminDialog
      v-model="sourceEditorOpen"
      :title="editingSourceId ? '编辑数据源' : '新建数据源'"
      subtitle="同步只影响该源导入的词条，不会改动手工创建的提示词"
      :icon="Link"
      width="560px"
      confirm-text="保存数据源"
      :confirm-loading="sourceSaving"
      @confirm="saveSource"
    >
      <el-form label-position="top" class="editor-form">
        <div class="form-grid">
          <el-form-item label="名称"><el-input v-model="sourceForm.name" maxlength="100" /></el-form-item>
          <el-form-item label="源格式">
            <el-select v-model="sourceForm.format" style="width: 100%">
              <el-option label="JSON" value="json" />
              <el-option label="Markdown" value="markdown" />
              <el-option label="HTML" value="html" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="源地址">
          <el-input v-model="sourceForm.sourceUrl" placeholder="https://.../prompts.json 或 README.md" />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="导入到功能">
            <el-select v-model="sourceForm.taskType" style="width: 100%">
              <el-option v-for="type in PROMPT_TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
            </el-select>
          </el-form-item>
          <el-form-item label="默认标签（每行一个）">
            <el-input
              v-model="sourceForm.defaultTagsText"
              type="textarea"
              :rows="2"
              placeholder="将附加到该源的所有词条"
            />
          </el-form-item>
        </div>
        <div class="form-grid">
          <el-form-item label="自动同步">
            <el-switch v-model="sourceForm.autoSyncEnabled" active-text="定时拉取" inactive-text="仅手动" />
          </el-form-item>
          <el-form-item label="同步间隔">
            <el-select
              v-model="sourceForm.syncIntervalMinutes"
              :disabled="!sourceForm.autoSyncEnabled"
              style="width: 100%"
            >
              <el-option label="每 30 分钟" :value="30" />
              <el-option label="每 1 小时" :value="60" />
              <el-option label="每 3 小时" :value="180" />
              <el-option label="每 6 小时" :value="360" />
              <el-option label="每 12 小时" :value="720" />
              <el-option label="每天" :value="1440" />
              <el-option label="每 3 天" :value="4320" />
              <el-option label="每周" :value="10080" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
    </AdminDialog>

    <AdminDialog
      v-model="importReviewOpen"
      title="提示词批次审核"
      :subtitle="importReviewSubtitle"
      :icon="CollectionTag"
      width="min(1120px, 94vw)"
      nested-scroll
      panel-class="prompt-import-dialog"
      confirm-text="关闭"
      :show-cancel="false"
      @confirm="importReviewOpen = false"
    >
      <template #meta>
        <span
          v-if="activeImportBatch"
          class="import-review-status"
          :class="`is-${activeImportBatch.status}`"
        >
          {{
            activeImportBatch.status === 'review'
              ? '待完成'
              : activeImportBatch.status === 'completed'
                ? '已发布'
                : activeImportBatch.status === 'failed'
                  ? '失败'
                  : '处理中'
          }}
        </span>
      </template>

      <input
        ref="importCoverInputRef"
        class="prompt-transfer-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        @change="uploadImportCover"
      />

      <div class="import-review">
        <div class="import-review-toolbar">
          <div class="import-review-tabs" role="tablist" aria-label="审核范围">
            <button
              v-for="tab in IMPORT_VIEW_TABS"
              :key="tab.value"
              type="button"
              role="tab"
              class="import-review-tabs__item"
              :class="{ 'is-active': importView === tab.value }"
              :aria-selected="importView === tab.value"
              @click="importView = tab.value"
            >
              {{ tab.label }}
              <em v-if="tab.countKey && activeImportBatch" class="tnum">
                {{ activeImportBatch[tab.countKey] }}
              </em>
            </button>
          </div>
          <div class="import-review-toolbar__actions">
            <el-button :icon="MagicStick" :loading="importAnalyzing" @click="analyzeImportBatch">
              AI 检测
            </el-button>
            <el-dropdown trigger="click" @command="onImportReviewMore">
              <el-button>
                更多
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="drop-duplicates">重复项全部移除</el-dropdown-item>
                  <el-dropdown-item command="keep-duplicates">重复项全部保留</el-dropdown-item>
                  <el-dropdown-item command="reject-blocked" divided>移除违规项</el-dropdown-item>
                  <el-dropdown-item command="approve-safe">通过安全项</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button type="primary" :loading="importBulkWorking" @click="approveAllImportItems">
              全部通过
            </el-button>
          </div>
        </div>

        <div v-if="importItems.length" class="import-review-selection">
          <el-checkbox
            :model-value="importPageAllSelected"
            :indeterminate="importPageSomeSelected"
            :disabled="!importSelectableItems.length || importBulkWorking"
            @change="toggleImportPageSelection"
          >
            全选当前页
          </el-checkbox>
          <span>已选 {{ selectedImportItemIds.length }}</span>
          <div v-if="selectedImportItemIds.length" class="import-review-selection__actions">
            <el-button
              size="small"
              type="primary"
              :loading="importBulkWorking"
              @click="approveSelectedImportItems"
            >
              通过并入库
            </el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="importBulkWorking"
              @click="rejectSelectedImportItems"
            >
              移除
            </el-button>
          </div>
        </div>

        <div v-loading="importItemsLoading" class="import-review-list">
          <article
            v-for="item in importItems"
            :key="item.id"
            class="import-review-item"
            :class="{ 'is-selected': selectedImportItemSet.has(item.id), 'is-published': item.publishedAt }"
          >
            <div class="import-review-item__check">
              <el-checkbox
                v-if="!item.publishedAt"
                :model-value="selectedImportItemSet.has(item.id)"
                :aria-label="`选择 ${item.title}`"
                @change="toggleImportItemSelection(item, $event)"
              />
              <el-icon v-else><CircleCheck /></el-icon>
            </div>
            <div
              v-loading="importCoverUpdatingIds.has(item.id)"
              class="import-review-item__cover"
            >
              <button
                v-if="item.coverUrl"
                type="button"
                class="import-review-cover-preview"
                aria-label="查看封面大图"
                title="点击查看大图"
                @click.stop="openImportCoverPreview(item)"
              >
                <el-image :src="item.coverUrl" fit="cover" lazy />
              </button>
              <el-icon v-else><Picture /></el-icon>
              <div v-if="!item.publishedAt" class="import-review-cover-actions" @click.stop>
                <el-tooltip content="上传图片替换" placement="top">
                  <button
                    type="button"
                    :disabled="importCoverUpdatingIds.has(item.id)"
                    aria-label="上传图片替换"
                    @click="triggerImportCoverPick(item)"
                  >
                    <el-icon><UploadFilled /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>
            <div class="import-review-item__body">
              <header>
                <div>
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.sourceName }}</span>
                </div>
                <div class="import-review-item__badges">
                  <span v-if="item.duplicateKind !== 'none'" class="is-warning">
                    重复
                  </span>
                  <span
                    :class="
                      item.complianceStatus === 'blocked'
                        ? 'is-danger'
                        : item.complianceStatus === 'safe'
                          ? 'is-success'
                          : 'is-muted'
                    "
                  >
                    {{
                      item.complianceStatus === 'blocked'
                        ? '疑似违规'
                        : item.complianceStatus === 'safe'
                          ? '规则安全'
                          : '待检测'
                    }}
                  </span>
                  <span v-if="item.publishedAt" class="is-stored">已入库</span>
                </div>
              </header>
              <p>{{ item.prompt }}</p>
              <small v-if="item.complianceReason">{{ item.complianceReason }}</small>
              <footer v-if="!item.publishedAt">
                <el-select
                  :model-value="item.category"
                  size="small"
                  style="width: 128px"
                  @change="patchImportItem(item, { category: $event })"
                >
                  <el-option
                    v-for="category in categoryOptions.slice(1)"
                    :key="category.value"
                    :label="category.label"
                    :value="category.value"
                  />
                </el-select>
                <template v-if="item.duplicateKind !== 'none'">
                  <el-button
                    size="small"
                    :type="item.duplicateAction === 'keep' ? 'primary' : ''"
                    @click="patchImportItem(item, { duplicateAction: 'keep' })"
                  >
                    保留
                  </el-button>
                  <el-button
                    size="small"
                    :type="item.duplicateAction === 'drop' ? 'danger' : ''"
                    @click="patchImportItem(item, { duplicateAction: 'drop', reviewStatus: 'rejected' })"
                  >
                    移除
                  </el-button>
                </template>
                <el-button size="small" :icon="CircleCheck" @click="approveImportItem(item)">
                  通过
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :icon="CircleClose"
                  @click="patchImportItem(item, { complianceStatus: 'blocked', reviewStatus: 'rejected' })"
                >
                  移除
                </el-button>
              </footer>
            </div>
          </article>
          <el-empty v-if="!importItemsLoading && !importItems.length" description="当前范围没有数据" />
        </div>
      </div>

      <template #footer>
        <div class="import-review-footer">
          <el-pagination
            v-if="importTotal > 50"
            v-model:current-page="importPage"
            :page-size="50"
            :total="importTotal"
            layout="prev, pager, next, total"
            @current-change="loadImportItems"
          />
          <span v-else />
          <el-button type="primary" @click="importReviewOpen = false">关闭</el-button>
        </div>
      </template>
    </AdminDialog>

    <el-image-viewer
      v-if="importCoverPreviewUrl"
      :url-list="[importCoverPreviewUrl]"
      hide-on-click-modal
      teleported
      @close="importCoverPreviewUrl = ''"
    />
  </div>
</template>

<style scoped lang="scss">
.prompt-library-page {
  --library-accent: var(--accent);
  --library-border: var(--border);
  --library-muted: var(--ink-3);
  box-sizing: border-box;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  padding: 0;
}

.library-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.library-toolbar__filters {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.prompt-search {
  width: min(260px, 100%);
  flex: 1 1 180px;
  max-width: 280px;
}

.toolbar-select {
  width: 132px;
  flex: 0 0 auto;

  &.is-short {
    width: 118px;
  }

  &.is-tags {
    width: min(220px, 100%);
    flex: 1 1 160px;
    max-width: 260px;
  }
}

.library-toolbar__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
}

.library-toolbar__buttons {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  white-space: nowrap;

  :deep(.el-button) {
    margin: 0;
    height: 32px;
  }

  :deep(.el-button + .el-button) {
    margin-left: 0 !important;
  }
}

.items-workspace {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.category-rail {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 10px;
  border: 1px solid var(--library-border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);

  &.is-receiving-drop {
    background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface-2));

    > button:not(.is-drop-disabled) {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--category-color) 24%, transparent);
    }
  }

  > button {
    display: grid;
    width: 100%;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    margin: 2px 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    color: var(--ink-2);
    text-align: left;
    background: transparent;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;

    i {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 8px;
      color: var(--category-color);
      font-style: normal;
      background: color-mix(in srgb, var(--category-color) 12%, transparent);
    }

    > span {
      min-width: 0;
      overflow: hidden;
      font-size: 13px;
      font-weight: 550;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    > em {
      color: var(--ink-3);
      font-size: 11px;
      font-style: normal;
      font-weight: 700;
    }

    &:hover {
      background: var(--surface-2);
    }

    &.is-active {
      color: var(--accent-ink);
      background: var(--accent-soft);
      box-shadow: inset 3px 0 0 var(--accent-ink);

      i {
        color: var(--accent-ink);
        background: color-mix(in srgb, var(--accent-ink) 14%, transparent);
      }

      > em {
        color: var(--accent-ink);
      }
    }

    &.is-drop-target {
      color: var(--ink);
      background: color-mix(in srgb, var(--category-color) 14%, var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--category-color) 44%, transparent);
    }

    &.is-drop-disabled {
      opacity: 0.46;
      cursor: not-allowed;
    }
  }
}

.prompt-content {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.prompt-content__scroll {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 28%, transparent) transparent;
  padding: 16px 16px 12px;
}

.prompt-load-status {
  display: grid;
  place-items: center;
  min-height: 40px;
  padding: 4px 0 8px;
  color: var(--library-muted);
  font-size: 12px;
}

.prompt-load-status.is-loading {
  color: var(--accent-ink);
}

.prompt-bulk-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 7px 10px;
  border: 1px solid var(--library-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(14px);

  &.is-active {
    border-color: color-mix(in srgb, var(--accent) 32%, var(--library-border));
  }
}

.prompt-bulk-selection {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;

  > span {
    padding-left: 9px;
    border-left: 1px solid var(--library-border);
    color: var(--accent-ink);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
}

.prompt-bulk-controls {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;

  :deep(.el-select) {
    width: 128px;
  }

  .el-button + .el-button {
    margin-left: 0;
  }
}

.prompt-grid {
  position: relative;
  min-height: 320px;
}

.prompt-grid__loading {
  display: grid;
  place-items: center;
  min-height: 240px;
  color: var(--library-muted);
  font-size: 13px;
}

.prompt-masonry {
  position: relative;
  width: 100%;
}

.prompt-masonry__item {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

.prompt-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  gap: 8px;
  padding: 8px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: none;
  box-sizing: border-box;
  transition:
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    opacity 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--library-border));
    box-shadow: var(--shadow-sm);
  }

  &.is-disabled {
    opacity: 0.64;
  }

  &.is-disabled:hover {
    opacity: 1;
  }

  &.is-dragging {
    border-color: var(--accent);
    opacity: 0.36;
    box-shadow: 0 12px 28px color-mix(in srgb, var(--accent) 20%, transparent);
    user-select: none;
  }

  &.is-moving {
    pointer-events: none;
    opacity: 0.58;
  }

  &.is-selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--library-border));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }
}

.prompt-cover {
  position: relative;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface-2);
  cursor: pointer;

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

  &:hover img {
    transform: scale(1.02);
  }

  &:hover {
    .prompt-cover__tags,
    .prompt-cover__stats,
    .prompt-cover__time {
      opacity: 1;
    }
  }
}

.prompt-grid.is-scrolling {
  .prompt-card {
    pointer-events: none;
    box-shadow: none;
    transition: none;
  }

  .prompt-cover img {
    transform: none;
    transition: none;
  }
}

.prompt-cover__empty {
  display: grid;
  height: 100%;
  min-height: 164px;
  place-items: center;
  align-content: center;
  gap: 6px;
  color: var(--library-muted);
  background: var(--surface-2);

  .el-icon {
    font-size: 26px;
    color: var(--ink-3);
  }

  span {
    font-size: 12px;
  }
}

.prompt-card__select {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 4;
  display: grid;
  width: 28px;
  height: 28px;
  margin: 0;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 8px;
  background: rgb(15 23 42 / 68%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
  backdrop-filter: blur(10px);

  :deep(.el-checkbox__label) {
    display: none;
  }

  :deep(.el-checkbox__inner) {
    width: 16px;
    height: 16px;
  }
}

.prompt-card.is-selection-mode .sync-badge {
  top: 48px;
}

.prompt-card__body {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 2px 2px 1px;

  header {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
}

.prompt-card__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-card__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.prompt-copy-btn {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--library-border);
  border-radius: 7px;
  color: var(--library-muted);
  background: var(--el-fill-color-lighter);
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--library-border));
    color: var(--accent-ink);
    background: var(--accent-soft);
  }
}

.prompt-card__body-placeholder {
  width: 100%;
  min-height: 120px;
  pointer-events: none;
}

.prompt-card__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0;

  .el-button + .el-button {
    margin-left: 0;
  }

  :deep(.el-button) {
    height: 28px;
    padding: 0 4px;
    font-size: 12px;
  }
}

.prompt-card__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-width: 0;

  :deep(.el-select) {
    width: 100%;
    min-width: 0;
  }

  :deep(.el-select__wrapper) {
    min-height: 30px;
    padding: 4px 8px;
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--library-border) inset;
    background: var(--surface-2);
  }

  :deep(.el-select__selected-item) {
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.prompt-cover__tags {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: calc(100% - 72px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;

  > span {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    padding: 4px 9px;
    overflow: hidden;
    border: 0;
    border-radius: 999px;
    color: #1c1917;
    background: #fff;
    font-size: 10px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.prompt-cover__time {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  padding: 3px 7px;
  border-radius: 999px;
  color: #fff;
  background: #1c1917;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.prompt-cover__stats {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  max-width: calc(100% - 88px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    border: 0;
    border-radius: 999px;
    color: #fff;
    font-size: 10px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1;

    .el-icon {
      font-size: 11px;
    }

    &.is-like {
      background: #eab308;
      color: #422006;
    }

    &.is-favorite {
      background: #ef4444;
    }

    &.is-use {
      background: #3b82f6;
    }
  }
}

.prompt-card.is-selection-mode .prompt-cover__tags {
  top: 46px;
}

.prompt-drag-handle {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--library-border);
  border-radius: 7px;
  color: var(--library-muted);
  background: var(--el-fill-color-lighter);
  cursor: grab;
  touch-action: none;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--library-border));
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  &:active {
    cursor: grabbing;
  }

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
}

.prompt-quick-sort-trigger {
  cursor: pointer;

  &:active {
    transform: scale(0.94);
  }
}

@keyframes prompt-status-pulse {
  to {
    opacity: 0.52;
  }
}

.page-assignments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-drag-preview {
  position: fixed;
  z-index: 10020;
  display: grid;
  width: min(260px, calc(100vw - 28px));
  min-height: 58px;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 7px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 58%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: 0 16px 38px rgb(15 23 42 / 26%);
  pointer-events: none;
  transform: translate(16px, 16px) rotate(1deg);
  backdrop-filter: blur(14px);

  > img,
  > span {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 7px;
    object-fit: cover;
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  > div {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--el-text-color-primary);
    font-size: 12px;
  }

  small {
    color: var(--library-muted);
    font-size: 10px;
  }

  &.has-target {
    border-color: var(--success);
    box-shadow: 0 16px 40px color-mix(in srgb, var(--success) 24%, transparent);
    transform: translate(16px, 16px) rotate(0deg) scale(1.02);

    small {
      color: var(--success);
      font-weight: 700;
    }
  }
}

.prompt-drag-preview-enter-active,
.prompt-drag-preview-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.prompt-drag-preview-enter-from,
.prompt-drag-preview-leave-to {
  opacity: 0;
  transform: translate(8px, 8px) scale(0.94);
}

.library-empty {
  display: grid;
  width: 100%;
  min-height: 310px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--library-muted);
  border: 1px dashed var(--library-border);
  border-radius: var(--radius-card);

  .el-icon {
    font-size: 34px;
  }

  strong {
    color: var(--ink);
  }
}

.dialog-intro {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -6px 0 20px;
  padding: 13px 15px;
  border-radius: 12px;
  background: var(--accent-soft);

  > span {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 10px;
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  div {
    display: grid;
    gap: 3px;
  }

  small {
    color: var(--library-muted);
  }
}

.editor-form {
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .el-form-item {
    margin-bottom: 17px;
  }
}

.editor-form--wide {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.editor-meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(200px, 0.9fr) minmax(220px, 1fr) minmax(140px, 0.7fr);
  gap: 12px;

  .el-form-item {
    min-width: 0;
    margin-bottom: 0;
  }
}

.editor-publish-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin-top: 12px;

  .el-form-item {
    min-width: 0;
    margin-bottom: 0;
  }

  .el-switch {
    height: 32px;
  }
}

.editor-publish-field :deep(.el-form-item__content) {
  display: flex;
  align-items: center;
  min-height: 38px;
}

.editor-heat-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}

.editor-heat-metric {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 38px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--library-border);
  border-radius: 10px;
  background: var(--surface-2);
  cursor: text;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;

  > span {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 550;
    white-space: nowrap;
  }

  .el-input-number {
    width: 100%;
  }

  :deep(.el-input-number .el-input__wrapper) {
    padding: 0;
    box-shadow: none !important;
    background: transparent;
  }

  :deep(.el-input-number .el-input__inner) {
    height: 34px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--library-border));
    background: color-mix(in srgb, var(--accent-soft) 35%, var(--surface-2));
  }

  &:focus-within {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--library-border));
    background: var(--surface);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-soft) 70%, transparent);
  }
}

.editor-basics-panel,
.editor-surface-card,
.editor-setting-card {
  min-width: 0;
  border: 1px solid var(--library-border);
  border-radius: 11px;
  background: var(--surface);
}

.editor-basics-panel {
  padding: 13px 14px 14px;
}

.editor-work-layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  padding-top: 12px;
}

.editor-prompt-panel,
.editor-options-panel {
  min-width: 0;
}

.editor-options-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  min-height: 100%;
}

.editor-prompt-panel,
.editor-setting-card {
  padding: 13px 14px;
}

.editor-cover-card {
  display: flex;
  flex: 0 0 auto;
  width: 320px;
  max-width: min(380px, 36vw);
  height: auto;
  min-height: 0;
  padding: 0;
  overflow: hidden;

  &.has-image {
    width: fit-content;
  }
}

.editor-setting-card .el-form-item {
  margin-bottom: 0;
}

.prompt-body-field {
  margin-bottom: 0 !important;

  :deep(.el-textarea__inner) {
    height: 438px;
    min-height: 438px !important;
    padding: 14px 15px 28px;
    line-height: 1.65;
    resize: none;
  }
}


.editor-options-lower {
  display: grid;
  grid-template-columns: minmax(220px, 1.18fr) minmax(170px, 0.82fr);
  gap: 18px;
  align-items: start;

  > .el-form-item {
    min-width: 0;
    margin-bottom: 0;
  }
}

.type-checkboxes {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;

  button {
    height: 42px;
    margin: 0;
    padding: 0 11px;
    border: 1px solid var(--library-border);
    border-radius: 9px;
    color: var(--el-text-color-regular);
    font-size: 13px;
    background: var(--el-fill-color-lighter);
    cursor: pointer;
    transition: 0.15s ease;

    &:hover {
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--accent-ink);
    }

    &.is-active {
      border-color: var(--accent);
      color: var(--accent-ink);
      font-weight: 650;
      background: var(--accent-soft);
    }
  }
}

.form-settings {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-content: start;

  .el-form-item {
    margin-bottom: 0;
  }

  :deep(.el-input-number) {
    width: 100%;
  }
}

.editor-cover-card .image-picker {
  width: 100%;
  aspect-ratio: 4 / 3;
  min-height: 0;
  border: 0;
  border-radius: 11px;
  background: var(--surface-2);
  cursor: default;
}

.editor-cover-card.has-image .image-picker {
  display: block;
  width: fit-content;
  max-width: min(380px, 36vw);
  height: auto;
  aspect-ratio: auto;
  line-height: 0;
}

.editor-cover-card .image-picker__preview {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  line-height: 0;

  img {
    display: block;
    width: auto;
    height: auto;
    max-width: min(380px, 36vw);
    max-height: 320px;
    object-fit: contain;
    background: transparent;
  }
}

.editor-cover-card .image-picker__empty {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--library-muted);
  background: transparent;
  cursor: pointer;

  strong {
    color: var(--el-text-color-primary);
    font-size: 12px;
  }

  small {
    font-size: 10px;
  }
}

.editor-cover-card .image-picker__replace {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 1;
  margin: 0;
  padding: 8px 14px;
  border: 0;
  border-radius: 10px;
  color: #fff;
  font-size: 13px;
  font-weight: 650;
  font-style: normal;
  line-height: 1;
  background: rgb(15 23 42 / 78%);
  backdrop-filter: blur(8px);
  cursor: pointer;
  transition:
    background 0.15s ease,
    transform 0.15s ease;

  &:hover {
    background: rgb(15 23 42 / 90%);
    transform: translateY(-1px);
  }
}

.image-picker {
  position: relative;
  display: grid;
  width: 100%;
  height: 142px;
  place-items: center;
  overflow: hidden;
  border: 1px dashed var(--el-border-color);
  border-radius: 12px;
  background: var(--el-fill-color-lighter);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  > span {
    display: grid;
    place-items: center;
    gap: 5px;
    color: var(--library-muted);

    strong {
      color: var(--el-text-color-primary);
      font-size: 12px;
    }

    small {
      font-size: 10px;
    }
  }

  > em {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 5px 8px;
    border-radius: 7px;
    color: #fff;
    font-size: 10px;
    font-style: normal;
    background: rgb(15 23 42 / 72%);
    backdrop-filter: blur(8px);
  }

  input {
    display: none;
  }
}

/* ============ 数据源管理 ============ */
.sources-entry-badge {
  :deep(.el-badge__content) {
    border: 0;
    background: var(--accent);
  }
}

.prompt-transfer-input {
  display: none;
}

.import-launcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px 8px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface-2);
}

.import-mode-pills {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
}

.import-mode-pills__item {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface-2);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
}

.import-review-toolbar,
.import-review-toolbar__actions,
.import-review-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-review-footer {
  justify-content: space-between;
}

.import-batches {
  display: grid;
  gap: 8px;

  > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 2px;

    strong {
      font-size: 13px;
      font-weight: 700;
    }

    span {
      color: var(--ink-3);
      font-size: 12px;
    }
  }
}

.import-batch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.import-batch-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  text-align: left;

  &:hover {
    border-color: var(--border-strong);
    background: var(--surface);
  }
}

.import-batch-card__status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--info-soft);
  color: var(--info);
  font-size: 11px;
  font-weight: 700;

  &.is-review {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-completed {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-failed {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.import-batch-card__counts {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;

  strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }
}

.import-review {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}

.import-review-status {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: var(--info-soft);
  color: var(--info);
  font-size: 12px;
  font-weight: 700;

  &.is-review {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-completed {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-failed {
    background: var(--danger-soft);
    color: var(--danger);
  }
}

.import-review-toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
}

.import-review-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.import-review-tabs__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;

  em {
    color: var(--ink-3);
    font-size: 11px;
    font-style: normal;
    font-weight: 700;
  }

  &:hover:not(.is-active) {
    color: var(--ink);
    background: var(--surface);
  }

  &.is-active {
    background: var(--accent);
    color: var(--accent-on);

    em {
      color: color-mix(in srgb, var(--accent-on) 72%, transparent);
    }
  }
}

.import-review-toolbar__actions {
  flex-wrap: wrap;
  margin-left: auto;
}

.import-review-selection {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  > span {
    color: var(--ink-3);
    font-size: 12px;
  }
}

.import-review-selection__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.import-review-list {
  min-height: 0;
  display: grid;
  flex: 1;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}

.import-review-item {
  display: grid;
  grid-template-columns: 22px 112px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);

  &.is-selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  &.is-published {
    background: color-mix(in srgb, var(--success-soft) 55%, var(--surface-2));
  }
}

.import-review-item__check {
  display: flex;
  justify-content: center;
  padding-top: 2px;
  color: var(--success);
}

.import-review-item__cover {
  position: relative;
  width: 112px;
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink-3);
}

.import-review-cover-preview {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;

  .el-image {
    display: block;
    width: 100%;
    height: 100%;
  }
}

.import-review-cover-actions {
  position: absolute;
  right: 5px;
  bottom: 5px;
  z-index: 2;
  display: flex;
  gap: 4px;

  button {
    display: grid;
    width: 27px;
    height: 27px;
    padding: 0;
    place-items: center;
    border: 1px solid color-mix(in srgb, white 36%, transparent);
    border-radius: 8px;
    color: white;
    background: color-mix(in srgb, black 68%, transparent);
    backdrop-filter: blur(8px);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent) 82%, black);
    }

    &:disabled {
      cursor: wait;
      opacity: 0.55;
    }
  }
}

.import-review-item__body {
  min-width: 0;
  display: grid;
  gap: 8px;

  header,
  footer,
  .import-review-item__badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  header {
    justify-content: space-between;
  }

  header > div:first-child {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header > div:first-child span,
  small {
    color: var(--ink-3);
    font-size: 12px;
  }

  p {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.5;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  footer {
    flex-wrap: wrap;
  }
}

.import-review-item__badges span {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 700;

  &.is-warning {
    background: var(--warning-soft);
    color: var(--warning);
  }

  &.is-danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  &.is-success {
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-stored {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
}

.import-review-footer {
  width: 100%;
}

/* 词库卡片：远程源词条角标（叠在封面图上，跟随主题的 accent 令牌） */
.sync-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--accent-ink);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  background: color-mix(in srgb, var(--accent-soft) 92%, var(--surface));

  .el-icon {
    font-size: 10px;
  }
}

.sources-panel {
  display: grid;
  gap: 16px;
}

.source-list {
  display: grid;
  gap: 10px;
  min-height: 200px;
  align-content: start;
}

.source-list-section {
  display: grid;
  gap: 10px;
}

.source-list-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 2px;

  strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }

  span {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 650;
  }
}

.source-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);

  &.is-disabled {
    opacity: 0.72;
  }

  &.is-disabled:hover {
    opacity: 1;
  }
}

.source-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.source-card__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;

  strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.source-card__state {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ink-3);

  &.is-active {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
  }
}

.format-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  color: var(--format-color);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  background: color-mix(in srgb, var(--format-color) 12%, transparent);
}

.source-card__meta {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;

  span + span::before {
    margin: 0 6px;
    color: var(--border-strong);
    content: '·';
  }

  .is-auto {
    color: var(--success);
  }
}

.source-card__error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 12px;
  color: var(--danger);
  font-size: 12px;
  background: var(--danger-soft);

  .el-icon {
    flex-shrink: 0;
  }

  span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
}

.source-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.source-card__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;

  .el-button + .el-button {
    margin-left: 0;
  }
}

.sources-empty {
  display: grid;
  min-height: 240px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--ink-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-card);
  text-align: center;

  .el-icon {
    font-size: 30px;
  }

  strong {
    color: var(--ink);
  }

  span {
    max-width: 260px;
    font-size: 12px;
    line-height: 1.45;
  }
}

@media (max-width: 1500px) {
  .library-toolbar {
    flex-wrap: wrap;
  }

  .library-toolbar__filters {
    flex-wrap: wrap;
    flex-basis: 100%;
  }

  .prompt-search {
    flex-basis: 100%;
    max-width: none;
  }
}

@media (max-width: 1100px) {
  .prompt-bulk-bar {
    align-items: flex-start;
  }

  .prompt-bulk-controls {
    flex-wrap: wrap;
  }

  .editor-meta-grid {
    grid-template-columns: 1fr 1fr;
  }

  .editor-tags-field {
    grid-column: 1;
  }

  .editor-task-field {
    grid-column: 2;
  }

  .editor-publish-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .editor-work-layout {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
  }

  .editor-cover-card {
    width: 260px;
    max-width: min(300px, 42vw);
  }

  .editor-cover-card.has-image .image-picker,
  .editor-cover-card.has-image .image-picker__preview img {
    max-width: min(300px, 42vw);
    max-height: 260px;
  }

  .editor-options-panel {
    padding-left: 0;
  }

  .items-workspace {
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .category-rail {
    display: flex;
    min-height: auto;
    overflow-x: auto;
    overflow-y: hidden;

    > button {
      width: auto;
      min-width: 132px;
      flex: 0 0 auto;
    }

  }
}

@media (max-width: 900px) {
  .editor-work-layout {
    grid-template-columns: 1fr;
  }

  .editor-options-panel {
    padding-top: 0;
    padding-left: 0;
    border-top: 0;
    border-left: 0;
  }
}



@keyframes prompt-load-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes prompt-skeleton-shimmer {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: -120% 0;
  }
}
</style>

<style lang="scss">
/* 非 scoped：抽屉面板与 MessageBox 内容渲染在组件作用域之外 */
.library-drawer.el-drawer {
  border-left: 1px solid var(--border);
  background: var(--surface);
}

.library-drawer .el-drawer__header {
  margin-bottom: 0;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.library-drawer .el-drawer__body {
  padding: 16px 18px;
  background: var(--surface);
}

.library-drawer__head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding-right: 8px;
}

.library-drawer__mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.library-drawer__head > div {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 2px;
}

.library-drawer__head strong {
  color: var(--ink);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
}

.library-drawer__head small {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.35;
}

.sources-drawer {
  max-width: 94vw;
}

.sources-drawer .el-drawer__body {
  padding: 16px 18px 22px;
}

.prompt-quick-sort-dialog {
  border: 1px solid var(--border);
}

.prompt-quick-sort-panel {
  display: grid;
  min-height: 260px;
  gap: 18px;
}

.prompt-quick-sort-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface-2);
}

.prompt-quick-sort-cover {
  display: grid;
  width: 72px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  color: var(--ink-3);
  background: var(--surface);
}

.prompt-quick-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.prompt-quick-sort-item small,
.prompt-quick-sort-item strong,
.prompt-quick-sort-item em {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-quick-sort-item small {
  color: var(--ink-3);
  font-size: 10px;
}

.prompt-quick-sort-item strong {
  margin-top: 3px;
  color: var(--ink-1);
  font-size: 14px;
}

.prompt-quick-sort-item em {
  margin-top: 5px;
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
}

.prompt-quick-sort-rank {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 8px;
  padding: 0 4px;
  color: var(--ink-3);
  font-size: 12px;
}

.prompt-quick-sort-rank strong {
  color: var(--accent);
  font-size: 22px;
}

.prompt-quick-sort-input {
  display: grid;
  grid-template-columns: 1fr 180px;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 12px;
  color: var(--ink-1);
  font-weight: 650;
  background: var(--accent-soft);
}

.prompt-quick-sort-input .el-input-number {
  width: 100%;
}

.prompt-quick-sort-panel > p {
  margin: -6px 4px 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.6;
}

.prompt-quick-sort-footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.prompt-sort-panel {
  display: grid;
  gap: 12px;
}

.prompt-sort-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.prompt-sort-empty {
  display: grid;
  min-height: 180px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
}

.prompt-sort-empty .el-icon {
  font-size: 28px;
}

.prompt-sort-empty strong {
  color: var(--ink);
}

.prompt-sort-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;
  max-height: min(56vh, 480px);
  overflow: auto;
  padding: 4px 2px;
}

.prompt-sort-row {
  display: grid;
  gap: 6px;
  justify-items: center;
  min-width: 0;
}

.prompt-sort-handle {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
}

.prompt-sort-handle:active {
  cursor: grabbing;
}

.prompt-sort-index {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.prompt-sort-cover {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
  color: var(--ink-3);
}

.prompt-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.is-sort-ghost {
  opacity: 0.35;
}

.is-sort-ghost .prompt-sort-cover {
  border-style: dashed;
}

.is-sort-dragging .prompt-sort-cover {
  box-shadow: var(--shadow-md);
}

.prompt-sort-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.editor-sort-hint {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--accent);
  background: var(--accent-soft);
}

.editor-sort-hint strong,
.editor-sort-hint small {
  display: block;
}

.editor-sort-hint strong {
  color: var(--ink-1);
  font-size: 12px;
}

.editor-sort-hint small {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 10px;
}

.source-delete-confirm p {
  margin: 0 0 10px;
  line-height: 1.6;
}

.prompt-editor-dialog {
  height: fit-content;
  max-height: calc(100dvh - 32px);
  align-self: center;
  margin: 16px auto !important;
}

.prompt-content-editor {
  --el-dialog-padding-primary: 24px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.prompt-content-editor .el-dialog__header {
  margin: 0;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.editor-dialog-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.editor-dialog-head__mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  color: var(--accent-ink);
  background: var(--accent-soft);
}

.editor-dialog-head > div {
  display: grid;
  gap: 1px;
}

.editor-dialog-head strong {
  color: var(--ink);
  font-size: 15px;
}

.editor-dialog-head small {
  color: var(--ink-3);
  font-size: 10px;
}

.prompt-content-editor .el-dialog__footer {
  padding: 11px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}

.prompt-editor-dialog .el-dialog__body {
  padding: 14px 20px;
  overflow: visible;
}

.prompt-content-editor .el-dialog__body {
  padding-top: 14px;
}

.editor-dialog-footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.editor-dialog-footer > span {
  color: var(--ink-3);
  font-size: 10px;
}

.editor-dialog-footer > div {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .prompt-content-editor .el-dialog__body {
    max-height: calc(100dvh - 142px);
    padding-right: 8px;
    overflow-y: auto;
  }
}

@media (max-height: 680px) {
  .prompt-editor-dialog .el-dialog__body {
    max-height: calc(100dvh - 154px);
    overflow-y: auto;
  }
}
</style>
