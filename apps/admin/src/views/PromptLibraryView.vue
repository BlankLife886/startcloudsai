<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Directive } from 'vue'
import { ElCheckbox, ElMessage, ElMessageBox, type CheckboxValueType } from 'element-plus'
import {
  CollectionTag,
  CopyDocument,
  Delete,
  EditPen,
  Link,
  Picture,
  Plus,
  Rank,
  Refresh,
  Search,
  WarningFilled,
} from '@element-plus/icons-vue'
import { request, normalizeList, type Page } from '@/request'
import { TASK_TYPES, taskTypeLabel } from '@/utils'
import draggable from 'vuedraggable'

interface PromptItem {
  id: string
  title: string
  prompt: string
  taskType: string
  category: string
  tags: string[]
  coverUrl?: string | null
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
  sourceUrl: string
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

interface SourceSyncResult {
  imported: number
  updated: number
  unchanged: number
  failed: number
  durationMs: number
  itemCount: number
}

interface CategoryOption {
  value: string
  label: string
  icon: string
  color: string
}

/**
 * 内置分类与用户端文生图工作台（AiWallpaperStudio 的 PROMPT_CATEGORY_META）保持一致，
 * 保证后台录入与用户端筛选联动；颜色取规范图表色序。
 */
const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'all', label: '全部内容', icon: '▦', color: '#6366f1' },
  { value: 'portrait', label: '人像人物', icon: '◉', color: '#f472b6' },
  { value: 'photography', label: '摄影写实', icon: '◎', color: '#38bdf8' },
  { value: 'product', label: '产品商业', icon: '◇', color: '#fbbf24' },
  { value: 'illustration', label: '插画动漫', icon: '✦', color: '#a78bfa' },
  { value: 'scene', label: '场景建筑', icon: '△', color: '#34d399' },
  { value: 'design', label: '视觉设计', icon: '✣', color: '#6366f1' },
  { value: 'game', label: '游戏美术', icon: '◆', color: '#f87171' },
  { value: 'typography', label: '文字排版', icon: 'T', color: '#94a3b8' },
  { value: 'other', label: '其他', icon: '·', color: '#94a3b8' },
]

const query = ref('')
const categoryFilter = ref('all')
const typeFilter = ref('all')
const statusFilter = ref('all')
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null
const items = ref<PromptItem[]>([])
const promptScopeTotal = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const currentCursor = ref<string | null>(null)
const previousPromptCursors = ref<(string | null)[]>([])
const promptPage = ref(1)
const promptContentRef = ref<HTMLElement | null>(null)
let promptRequestVersion = 0
let coverLoadObserver: IntersectionObserver | null = null
let bodyResizeObserver: ResizeObserver | null = null
const coverElements = new Map<HTMLElement, string>()
const bodyElements = new Map<HTMLElement, string>()
const visibleCoverIds = reactive(new Set<string>())
const cardBodyHeights = reactive<Record<string, number>>({})
const isGridScrolling = ref(false)
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

const hasNext = computed(() => nextCursor.value !== null)
const hasPrev = computed(() => previousPromptCursors.value.length > 0)
const initialLoading = computed(() => loading.value && items.value.length === 0)
const refreshing = computed(() => loading.value && items.value.length > 0)

function promptQueryParams(cursor: string | null) {
  return {
    type: typeFilter.value === 'all' ? '' : typeFilter.value,
    category: categoryFilter.value === 'all' ? '' : categoryFilter.value,
    status: statusFilter.value === 'all' ? '' : statusFilter.value,
    search: query.value.trim(),
    limit: 24,
    cursor,
  }
}

async function loadPromptPage(cursor: string | null) {
  const version = ++promptRequestVersion
  const hadItems = items.value.length > 0
  const params = promptQueryParams(cursor)
  loading.value = true
  error.value = null
  try {
    const page = normalizeList(
      await request<PromptItem[] | Page<PromptItem>>('/api/admin/prompt-library', {
        query: params,
      }),
    )
    if (version !== promptRequestVersion) return
    items.value = page.items
    currentCursor.value = cursor
    nextCursor.value = page.nextCursor
    promptScopeTotal.value = page.scopeTotal ?? page.total ?? page.items.length
    const loadedIds = new Set(page.items.map((item) => item.id))
    for (const id of selectedIds) {
      if (!loadedIds.has(id)) selectedIds.delete(id)
    }
    await nextTick()
    promptContentRef.value?.scrollTo({ top: 0, behavior: 'auto' })
  } catch (cause) {
    if (version !== promptRequestVersion) return
    if (!hadItems) items.value = []
    error.value = cause instanceof Error && cause.message ? cause.message : '加载失败，请重试'
  } finally {
    if (version === promptRequestVersion) loading.value = false
  }
}

function reset() {
  previousPromptCursors.value = []
  promptPage.value = 1
  return loadPromptPage(null)
}

async function nextPromptPage() {
  const cursor = nextCursor.value
  if (!cursor || loading.value) return
  previousPromptCursors.value.push(currentCursor.value)
  promptPage.value += 1
  await loadPromptPage(cursor)
}

async function prevPromptPage() {
  if (!previousPromptCursors.value.length || loading.value) return
  const cursor = previousPromptCursors.value.pop() ?? null
  promptPage.value = Math.max(1, promptPage.value - 1)
  await loadPromptPage(cursor)
}

function refresh() {
  return reset()
}

function retry() {
  return loadPromptPage(currentCursor.value)
}

function setupCoverObserver() {
  coverLoadObserver?.disconnect()
  coverLoadObserver = null
  if (typeof IntersectionObserver === 'undefined') {
    for (const id of coverElements.values()) visibleCoverIds.add(id)
    return
  }
  coverLoadObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = coverElements.get(entry.target as HTMLElement)
        if (!id) continue
        if (entry.isIntersecting) visibleCoverIds.add(id)
        else visibleCoverIds.delete(id)
      }
    },
    { root: promptContentRef.value, rootMargin: '720px 0px', threshold: 0.001 },
  )
  for (const element of coverElements.keys()) coverLoadObserver.observe(element)
}

const vPromptCoverVisibility: Directive<HTMLElement, string> = {
  mounted(element, binding) {
    coverElements.set(element, binding.value)
    if (coverLoadObserver) coverLoadObserver.observe(element)
    else visibleCoverIds.add(binding.value)
  },
  updated(element, binding) {
    if (binding.value === binding.oldValue) return
    if (binding.oldValue) visibleCoverIds.delete(binding.oldValue)
    coverElements.set(element, binding.value)
    visibleCoverIds.add(binding.value)
  },
  beforeUnmount(element) {
    const id = coverElements.get(element)
    coverLoadObserver?.unobserve(element)
    coverElements.delete(element)
    if (id) visibleCoverIds.delete(id)
  },
}

const vPromptBodySize: Directive<HTMLElement, string> = {
  mounted(element, binding) {
    bodyElements.set(element, binding.value)
    bodyResizeObserver?.observe(element)
  },
  updated(element, binding) {
    bodyElements.set(element, binding.value)
  },
  beforeUnmount(element) {
    bodyResizeObserver?.unobserve(element)
    bodyElements.delete(element)
  },
}

function onPromptScroll() {
  if (!isGridScrolling.value) isGridScrolling.value = true
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    isGridScrolling.value = false
  }, 140)
}

const visibleItems = computed(() => items.value)

/* 多选编辑：只操作当前已经加载且可见的提示词，避免误改筛选范围之外的数据。 */
const selectedIds = reactive(new Set<string>())
const selectionMode = ref(false)
const batchSaving = ref(false)
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
        await request(`/api/admin/prompt-library/${item.id}`, {
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

const updatingItemFields = reactive(new Set<string>())

const headerStatus = computed(() => {
  if (batchSaving.value) {
    return { tone: 'is-saving', title: '正在批量更新', detail: `${selectedItems.value.length} 条内容` }
  }
  if (selectedItems.value.length) {
    return { tone: 'is-selecting', title: '多选编辑', detail: `已选 ${selectedItems.value.length} 条` }
  }
  if (refreshing.value) {
    return { tone: 'is-saving', title: categoryMeta(categoryFilter.value).label, detail: '正在更新内容' }
  }
  return {
    tone: '',
    title: categoryMeta(categoryFilter.value).label,
    detail: `本页 ${visibleItems.value.length} 条`,
  }
})

function categoryOptionsFor(item: PromptItem) {
  const options = CATEGORY_OPTIONS.slice(1)
  if (!item.category || options.some((category) => category.value === item.category)) return options
  return [categoryMeta(item.category), ...options]
}

async function quickChangeCategory(item: PromptItem, category: string) {
  if (!category || category === item.category) return
  const key = `${item.id}:category`
  if (updatingItemFields.has(key)) return
  const previous = item.category
  item.category = category
  updatingItemFields.add(key)
  try {
    await request(`/api/admin/prompt-library/${item.id}`, { method: 'PATCH', body: { category } })
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
    await request(`/api/admin/prompt-library/${item.id}`, { method: 'PATCH', body: { taskType } })
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
      `/api/admin/prompt-library/${item.id}/position`,
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
      `/api/admin/prompt-library/${item.id}/move`,
      {
        method: 'POST',
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

/* 稳定瀑布流：保持现有多列布局，但图片异步加载后不再跨列搬动卡片。 */
const gridColumnCount = ref(5)
const imageRatios = reactive<Record<string, number>>({})
const gridColumns = computed(() => {
  const columns = Array.from({ length: gridColumnCount.value }, () => [] as PromptItem[])
  for (const [index, item] of visibleItems.value.entries()) {
    columns[index % gridColumnCount.value]?.push(item)
  }
  return columns
})

function updateGridColumnCount() {
  const width = window.innerWidth
  gridColumnCount.value = width <= 720 ? 1 : width <= 1100 ? 2 : width <= 1500 ? 3 : 4
}

function measureCover(item: PromptItem, event: Event) {
  const image = event.target as HTMLImageElement | null
  const width = Number(image?.naturalWidth ?? 0)
  const height = Number(image?.naturalHeight ?? 0)
  if (width > 0 && height > 0) imageRatios[item.id] = width / height
}

function coverStyle(item: PromptItem) {
  const ratio = Math.max(0.38, Math.min(3.2, imageRatios[item.id] ?? 16 / 10))
  return { aspectRatio: String(ratio) }
}

function cardBodyPlaceholderStyle(item: PromptItem) {
  const fallback = item.tags?.length ? 184 : 158
  return { height: `${Math.max(120, cardBodyHeights[item.id] ?? fallback)}px` }
}

function categoryMeta(value: string | undefined): CategoryOption {
  const key = value ?? 'other'
  const found = CATEGORY_OPTIONS.find((item) => item.value === key)
  if (found) return found
  // 自建分类：以原始 key 展示，用中性色
  return { value: key, label: key, icon: '·', color: '#94a3b8' }
}

function formatTime(value: string | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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

watch([query, categoryFilter, typeFilter, statusFilter], scheduleReload)
watch(statusFilter, clearSelection)

function resetFilters() {
  query.value = ''
  categoryFilter.value = 'all'
  typeFilter.value = 'all'
  statusFilter.value = 'all'
}

/* 大规模排序管理：服务端分页，每次只渲染一小段；跨页移动直接输入目标名次。
 * 当前页拖拽仍使用批量重排，未参与排序的条目保持原有相对位置。 */
const SORT_PAGE_SIZE = 60
const sortDrawerOpen = ref(false)
const sortLoading = ref(false)
const sortSaving = ref(false)
const sortItems = ref<PromptItem[]>([])
const sortSnapshot = ref<string[]>([])
const sortQuery = ref('')
const sortCategory = ref('all')
const sortType = ref('all')
const sortStatus = ref('all')
const sortPage = ref(1)
const sortCursors = ref<(string | null)[]>([null])
const sortNextCursor = ref<string | null>(null)
const sortMatchTotal = ref(0)
const sortScopeTotal = ref(0)
const sortSelectedId = ref('')
const sortTargetPosition = ref(1)
let sortFilterTimer: ReturnType<typeof setTimeout> | null = null
const sortDirty = computed(
  () => sortItems.value.map((item) => item.id).join('|') !== sortSnapshot.value.join('|'),
)
const sortSelectedItem = computed(() => sortItems.value.find((item) => item.id === sortSelectedId.value) ?? null)
const sortIsSearching = computed(() => Boolean(sortQuery.value.trim()))

async function loadSortItems(resetPaging = false) {
  if (resetPaging) {
    sortPage.value = 1
    sortCursors.value = [null]
  }
  sortLoading.value = true
  try {
    const page: Page<PromptItem> = normalizeList(
      await request<PromptItem[] | Page<PromptItem>>('/api/admin/prompt-library', {
        query: {
          type: sortType.value === 'all' ? '' : sortType.value,
          category: sortCategory.value === 'all' ? '' : sortCategory.value,
          status: sortStatus.value === 'all' ? '' : sortStatus.value,
          search: sortQuery.value.trim(),
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
    if (!sortItems.value.some((item) => item.id === sortSelectedId.value)) {
      sortSelectedId.value = ''
    }
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '排序列表加载失败')
  } finally {
    sortLoading.value = false
  }
}

function openSortDrawer() {
  sortQuery.value = query.value.trim()
  sortCategory.value = categoryFilter.value
  sortType.value = typeFilter.value
  sortStatus.value = statusFilter.value
  sortSelectedId.value = ''
  sortTargetPosition.value = 1
  sortDrawerOpen.value = true
  void loadSortItems(true)
}

function beforeCloseSortDrawer(done: () => void) {
  if (!sortDirty.value || sortSaving.value) {
    done()
    return
  }
  void ElMessageBox.confirm('当前排序还没有保存，确定放弃这些调整吗？', '放弃排序调整', {
    type: 'warning',
    confirmButtonText: '放弃调整',
    cancelButtonText: '继续排序',
  }).then(done).catch(() => undefined)
}

function moveSortItem(index: number, destination: number) {
  if (index < 0 || index >= sortItems.value.length) return
  const target = Math.max(0, Math.min(destination, sortItems.value.length - 1))
  if (target === index) return
  const [item] = sortItems.value.splice(index, 1)
  if (item) sortItems.value.splice(target, 0, item)
}

function selectSortItem(item: PromptItem, index: number) {
  sortSelectedId.value = item.id
  sortTargetPosition.value = sortIsSearching.value
    ? Math.max(1, Math.min(sortTargetPosition.value, sortScopeTotal.value))
    : (sortPage.value - 1) * SORT_PAGE_SIZE + index + 1
}

function reloadSortForFilters() {
  if (!sortDrawerOpen.value) return
  if (sortFilterTimer) clearTimeout(sortFilterTimer)
  sortFilterTimer = setTimeout(() => {
    sortFilterTimer = null
    void loadSortItems(true)
  }, sortQuery.value.trim() ? 280 : 50)
}

watch([sortQuery, sortCategory, sortType, sortStatus], reloadSortForFilters)

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
    await request('/api/admin/prompt-library/reorder', {
      method: 'POST',
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

async function moveSelectedPrompt(position = sortTargetPosition.value) {
  const item = sortSelectedItem.value
  if (!item || sortSaving.value) return
  if (sortDirty.value && !(await saveSortOrder(false))) return
  const target = Math.max(1, Math.min(Math.round(position || 1), sortScopeTotal.value || 1))
  sortSaving.value = true
  try {
    const result = await request<{ position: number; count: number }>(
      `/api/admin/prompt-library/${item.id}/move`,
      {
        method: 'POST',
        body: {
          position: target,
          taskType: sortType.value === 'all' ? '' : sortType.value,
          category: sortCategory.value === 'all' ? '' : sortCategory.value,
          status: sortStatus.value === 'all' ? '' : sortStatus.value,
        },
      },
    )
    sortTargetPosition.value = result.position
    sortScopeTotal.value = result.count
    ElMessage.success(`「${item.title}」已移到当前范围第 ${result.position} 位`)
    await loadSortItems(true)
    await refresh()
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

async function uploadCover(id: string, file: File) {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`/api/admin/prompt-library/${id}/cover`, {
    method: 'POST',
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
      ? await request<PromptItem>(`/api/admin/prompt-library/${editingId.value}`, { method: 'PATCH', body })
      : await request<PromptItem>('/api/admin/prompt-library', { method: 'POST', body })
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
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  pendingImage.value = null
})

async function toggleItem(item: PromptItem, active: boolean) {
  item.active = active
  try {
    await request(`/api/admin/prompt-library/${item.id}`, { method: 'PATCH', body: { active } })
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
  await request(`/api/admin/prompt-library/${item.id}`, { method: 'DELETE' })
  selectedIds.delete(item.id)
  ElMessage.success('提示词已删除')
  await refresh()
}

/* ============ 数据源管理（契约 v4：/api/admin/prompt-sources） ============ */

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
const sourcesLoading = ref(false)
const sourcesDrawerOpen = ref(false)
const syncingSourceId = ref('')

async function loadSources(silent = false) {
  sourcesLoading.value = true
  try {
    const data = await request<PromptSource[] | Page<PromptSource>>('/api/admin/prompt-sources', { silent })
    sources.value = normalizeList(data).items
  } catch {
    // 错误提示由 request 统一处理（silent 时静默，页头徽标保持旧值）
  } finally {
    sourcesLoading.value = false
  }
}

function openSourcesDrawer() {
  sourcesDrawerOpen.value = true
  void loadSources()
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

async function copySourceUrl(source: PromptSource) {
  try {
    await navigator.clipboard.writeText(source.sourceUrl)
    ElMessage.success('源地址已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

/** 启停开关：即改即存，失败回滚 */
async function toggleSource(source: PromptSource, enabled: boolean) {
  source.enabled = enabled
  try {
    await request(`/api/admin/prompt-sources/${source.id}`, { method: 'PATCH', body: { enabled } })
  } catch {
    source.enabled = !enabled
  }
}

async function syncSource(source: PromptSource) {
  syncingSourceId.value = source.id
  try {
    const result = await request<SourceSyncResult>(`/api/admin/prompt-sources/${source.id}/sync`, {
      method: 'POST',
    })
    const failedText = result.failed ? `，失败 ${result.failed} 条` : ''
    ElMessage.success(`同步完成：新增 ${result.imported} 条、更新 ${result.updated} 条${failedText}`)
    await Promise.all([loadSources(), refresh()])
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
  await request(`/api/admin/prompt-sources/${source.id}`, {
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
  sourceForm.sourceUrl = source?.sourceUrl ?? ''
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
      await request(`/api/admin/prompt-sources/${editingSourceId.value}`, { method: 'PATCH', body })
    } else {
      await request('/api/admin/prompt-sources', { method: 'POST', body: { ...body, enabled: true } })
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
  updateGridColumnCount()
  window.addEventListener('resize', updateGridColumnCount, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    bodyResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = bodyElements.get(entry.target as HTMLElement)
        const height = Math.ceil(entry.contentRect.height)
        if (id && height > 0) cardBodyHeights[id] = height
      }
    })
  }
  setupCoverObserver()
  void reset()
  void loadSources(true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateGridColumnCount)
  coverLoadObserver?.disconnect()
  bodyResizeObserver?.disconnect()
  coverElements.clear()
  bodyElements.clear()
  visibleCoverIds.clear()
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  if (sortFilterTimer) clearTimeout(sortFilterTimer)
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="prompt-library-page">
    <header class="library-header">
      <div class="library-header__top">
        <div class="library-header__copy">
          <span class="library-eyebrow">PROMPT OPERATIONS</span>
          <h2>统一提示词库</h2>
          <p>管理内容分类、投放功能、封面素材与启停排序</p>
        </div>
        <div class="library-header__actions">
          <el-tag type="success" effect="light" round size="small"
            >当前页 {{ items.length }} / 共 {{ promptScopeTotal }} 条</el-tag
          >
          <el-badge :value="sources.length" :hidden="!sources.length" :offset="[-4, 4]" class="sources-entry-badge">
            <el-button :icon="Link" @click="openSourcesDrawer">数据源</el-button>
          </el-badge>
          <el-button
            :type="selectionMode ? 'primary' : ''"
            :icon="EditPen"
            :disabled="batchSaving"
            @click="toggleSelectionMode"
          >
            {{ selectionMode ? '退出多选' : '多选编辑' }}
          </el-button>
          <el-button :icon="Rank" @click="openSortDrawer">批量排序</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openEditor()">新增提示词</el-button>
        </div>
      </div>

      <div class="library-header__controls">
        <div class="prompt-toolbar">
          <el-input
            v-model="query"
            :prefix-icon="Search"
            clearable
            placeholder="搜索名称、提示词或标签"
            class="prompt-search"
          />
          <el-select v-model="typeFilter" class="toolbar-select" aria-label="投放功能">
            <el-option label="全部功能" value="all" />
            <el-option v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
          </el-select>
          <el-select v-model="statusFilter" class="toolbar-select is-short" aria-label="状态">
            <el-option label="全部状态" value="all" />
            <el-option label="已启用" value="enabled" />
            <el-option label="已停用" value="disabled" />
            <el-option label="缺少封面" value="missing-cover" />
          </el-select>
          <el-button text @click="resetFilters">重置</el-button>
        </div>
        <div class="library-event-status" :class="headerStatus.tone" aria-live="polite">
          <el-icon><component :is="headerStatus.tone === 'is-dragging' ? Rank : CollectionTag" /></el-icon>
          <span>
            <strong :title="headerStatus.title">{{ headerStatus.title }}</strong>
            <small>{{ headerStatus.detail }}</small>
          </span>
        </div>
      </div>
    </header>

    <section class="library-workspace">
      <div class="items-workspace">
        <aside class="category-rail">
          <div class="category-rail__title">
            <span>内容分类</span>
            <small>{{ items.length }}</small>
          </div>
          <button
            v-for="category in CATEGORY_OPTIONS"
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
                :disabled="!visibleItems.length || batchSaving"
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
              >
                <el-option
                  v-for="category in CATEGORY_OPTIONS.slice(1)"
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
              >
                <el-option v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
              </el-select>
              <el-select
                v-model="batchForm.active"
                clearable
                size="small"
                placeholder="修改状态"
                aria-label="批量修改状态"
              >
                <el-option label="启用" value="enabled" />
                <el-option label="停用" value="disabled" />
              </el-select>
              <el-button
                type="primary"
                size="small"
                :loading="batchSaving"
                :disabled="!hasBatchChanges"
                @click="applyBatchEdit"
              >
                应用修改
              </el-button>
              <el-button text size="small" :disabled="batchSaving" @click="clearSelection">清除选择</el-button>
            </div>
          </div>

          <div class="prompt-grid" :class="{ 'is-refreshing': refreshing, 'is-scrolling': isGridScrolling }">
            <template v-if="initialLoading">
              <div
                v-for="columnIndex in gridColumnCount"
                :key="`prompt-skeleton-column-${columnIndex}`"
                class="prompt-grid__column"
              >
                <article
                  v-for="cardIndex in 3"
                  :key="`prompt-skeleton-${columnIndex}-${cardIndex}`"
                  class="prompt-skeleton-card"
                >
                  <span class="prompt-skeleton-card__cover" :class="`is-variant-${cardIndex}`" />
                  <span class="prompt-skeleton-card__line is-title" />
                  <span class="prompt-skeleton-card__line" />
                  <span class="prompt-skeleton-card__line is-short" />
                </article>
              </div>
            </template>

            <template v-else-if="visibleItems.length">
              <div
                v-for="(column, columnIndex) in gridColumns"
                :key="`prompt-column-${columnIndex}`"
                class="prompt-grid__column"
              >
                <article
                  v-for="item in column"
                  :key="item.id"
                  class="prompt-card"
                  :class="{
                    'is-disabled': !item.active,
                    'is-selected': selectedIds.has(item.id),
                    'is-selection-mode': selectionMode,
                  }"
                >
                  <div
                    v-prompt-cover-visibility="item.id"
                    class="prompt-cover"
                    :class="{ 'has-image': Boolean(item.coverUrl) }"
                    :style="item.coverUrl ? coverStyle(item) : undefined"
                    @click="selectionMode ? toggleSelected(item.id, !selectedIds.has(item.id)) : openEditor(item)"
                  >
                    <img
                      v-if="item.coverUrl && visibleCoverIds.has(item.id)"
                      :src="item.coverUrl"
                      :alt="item.title"
                      loading="eager"
                      decoding="async"
                      @load="measureCover(item, $event)"
                    />
                    <span v-else-if="item.coverUrl" class="prompt-cover__media-placeholder" aria-hidden="true" />
                    <div v-else class="prompt-cover__empty">
                      <el-icon><Picture /></el-icon>
                      <span>缺少封面</span>
                      <small>点击编辑上传</small>
                    </div>
                    <span class="category-badge" :style="{ '--category-color': categoryMeta(item.category).color }">
                      {{ categoryMeta(item.category).label }}
                    </span>
                    <el-checkbox
                      v-if="selectionMode"
                      class="prompt-card__select"
                      :model-value="selectedIds.has(item.id)"
                      :aria-label="`选择 ${item.title}`"
                      @click.stop
                      @change="toggleSelected(item.id, Boolean($event))"
                    />
                    <span v-if="item.sourceId" class="sync-badge" title="来自远程数据源，同步时会自动更新">
                      <el-icon><Link /></el-icon>
                      同步
                    </span>
                    <span class="prompt-cover__overlay">
                      <span class="prompt-cover__prompt">{{ item.prompt }}</span>
                      <span class="prompt-cover__specs">
                        <span>
                          <el-icon><CollectionTag /></el-icon>
                          {{ categoryMeta(item.category).label }}
                        </span>
                        <span v-if="item.tags?.length">{{ item.tags.slice(0, 2).join(' · ') }}</span>
                      </span>
                    </span>
                  </div>

                  <div v-if="visibleCoverIds.has(item.id)" v-prompt-body-size="item.id" class="prompt-card__body">
                    <header>
                      <div>
                        <strong :title="item.title">{{ item.title }}</strong>
                        <small>
                          {{ categoryMeta(item.category).label }} · 👍 {{ item.likeCount || 0 }} · ❤
                          {{ item.favoriteCount || 0 }} · 使用 {{ item.useCount || 0 }}
                        </small>
                      </div>
                      <div class="prompt-card__header-actions">
                        <el-tooltip content="直接调整展示顺序" placement="top">
                          <button
                            type="button"
                            class="prompt-drag-handle prompt-quick-sort-trigger"
                            :disabled="selectionMode"
                            aria-label="调整提示词展示顺序"
                            @click.stop="openQuickSort(item)"
                          >
                            <el-icon><Rank /></el-icon>
                          </button>
                        </el-tooltip>
                        <el-switch
                          :model-value="item.active"
                          size="small"
                          @change="toggleItem(item, Boolean($event))"
                        />
                      </div>
                    </header>
                    <div class="prompt-quick-fields">
                      <label>
                        <span>分类</span>
                        <el-select
                          :model-value="item.category"
                          size="small"
                          :loading="updatingItemFields.has(`${item.id}:category`)"
                          aria-label="快捷分类"
                          @change="quickChangeCategory(item, String($event))"
                        >
                          <el-option
                            v-for="category in categoryOptionsFor(item)"
                            :key="category.value"
                            :label="category.label"
                            :value="category.value"
                          />
                        </el-select>
                      </label>
                      <label>
                        <span>投放</span>
                        <el-select
                          :model-value="item.taskType"
                          size="small"
                          :loading="updatingItemFields.has(`${item.id}:taskType`)"
                          aria-label="快捷投放"
                          @change="quickChangeTaskType(item, String($event))"
                        >
                          <el-option
                            v-for="type in TASK_TYPES"
                            :key="type"
                            :label="taskTypeLabel(type)"
                            :value="type"
                          />
                        </el-select>
                      </label>
                    </div>
                    <div v-if="item.tags?.length" class="page-assignments">
                      <em v-for="tag in (item.tags ?? []).slice(0, 2)" :key="tag">#{{ tag }}</em>
                    </div>
                    <footer>
                      <span>创建于 {{ formatTime(item.createdAt) }}</span>
                      <div class="prompt-card__actions">
                        <el-tooltip content="编辑提示词" placement="top">
                          <el-button circle :icon="EditPen" @click="openEditor(item)" />
                        </el-tooltip>
                        <el-tooltip content="删除提示词" placement="top">
                          <el-button circle type="danger" plain :icon="Delete" @click="remove(item)" />
                        </el-tooltip>
                      </div>
                    </footer>
                  </div>
                  <div v-else class="prompt-card__body-placeholder" :style="cardBodyPlaceholderStyle(item)" />
                </article>
              </div>
            </template>

            <div v-if="!initialLoading && !visibleItems.length" class="library-empty">
              <el-icon><CollectionTag /></el-icon>
              <strong>没有匹配的提示词</strong>
              <span>调整分类或筛选条件后再试</span>
              <el-button @click="resetFilters">清除筛选</el-button>
            </div>
          </div>

          </div>
          <div class="prompt-library-pagination">
            <CursorPager
              :has-prev="hasPrev"
              :has-next="hasNext"
              :loading="loading"
              :page="promptPage"
              :count="items.length"
              :total="promptScopeTotal"
              @prev="prevPromptPage"
              @next="nextPromptPage"
            />
          </div>
        </main>
      </div>
    </section>

    <el-dialog
      v-model="quickSortOpen"
      title="调整展示顺序"
      width="min(520px, 92vw)"
      append-to-body
      align-center
      class="prompt-quick-sort-dialog"
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
        <p>无需拖动或翻页，输入名次后保存即可；其他提示词会自动顺延。</p>
      </div>
      <template #footer>
        <div class="prompt-quick-sort-footer">
          <el-button :disabled="quickSortLoading || quickSortSaving" @click="submitQuickSort(1)">置顶</el-button>
          <el-button :disabled="quickSortLoading || quickSortSaving" @click="submitQuickSort(quickSortCount)">置底</el-button>
          <span />
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
      </template>
    </el-dialog>

    <el-drawer
      v-model="sortDrawerOpen"
      title="提示词排序管理"
      size="min(820px, 98vw)"
      append-to-body
      :before-close="beforeCloseSortDrawer"
      class="prompt-sort-drawer"
    >
      <div class="prompt-sort-panel">
        <header class="prompt-sort-summary">
          <div>
            <strong>分页定位排序</strong>
            <span>
              当前范围 {{ sortScopeTotal }} 条，每页仅渲染 {{ SORT_PAGE_SIZE }} 条
            </span>
          </div>
          <el-button :loading="sortLoading" :icon="Refresh" @click="loadSortItems(false)">重新载入</el-button>
        </header>

        <div class="prompt-sort-filters">
          <el-input v-model="sortQuery" clearable :prefix-icon="Search" placeholder="搜索名称或提示词，快速定位目标" />
          <el-select v-model="sortCategory" aria-label="排序分类">
            <el-option v-for="category in CATEGORY_OPTIONS" :key="category.value" :label="category.label" :value="category.value" />
          </el-select>
          <el-select v-model="sortType" aria-label="排序功能">
            <el-option label="全部功能" value="all" />
            <el-option v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
          </el-select>
          <el-select v-model="sortStatus" aria-label="排序状态">
            <el-option label="全部状态" value="all" />
            <el-option label="已启用" value="enabled" />
            <el-option label="已停用" value="disabled" />
            <el-option label="缺少封面" value="missing-cover" />
          </el-select>
        </div>

        <div v-if="sortSelectedItem" class="prompt-sort-positioner">
          <span class="prompt-sort-positioner__item">
            <img v-if="sortSelectedItem.coverUrl" :src="sortSelectedItem.coverUrl" alt="" />
            <el-icon v-else><Picture /></el-icon>
            <span><small>正在移动</small><strong>{{ sortSelectedItem.title }}</strong></span>
          </span>
          <span class="prompt-sort-positioner__controls">
            <el-button :disabled="sortSaving" @click="moveSelectedPrompt(1)">置顶</el-button>
            <span>移到第</span>
            <el-input-number
              v-model="sortTargetPosition"
              :min="1"
              :max="Math.max(1, sortScopeTotal)"
              controls-position="right"
              :disabled="sortSaving"
            />
            <span>位</span>
            <el-button type="primary" :loading="sortSaving" @click="moveSelectedPrompt()">立即移动</el-button>
            <el-button :disabled="sortSaving" @click="moveSelectedPrompt(sortScopeTotal)">置底</el-button>
          </span>
        </div>

        <div v-if="sortIsSearching" class="prompt-sort-search-note">
          搜索到 {{ sortMatchTotal }} 条。搜索用于快速选中目标；目标名次仍按“分类、功能、状态”范围计算。
        </div>

        <div v-if="sortLoading" class="prompt-sort-loading" v-loading="true" />
        <div v-else-if="!sortItems.length" class="prompt-sort-empty">
          <el-icon><Rank /></el-icon>
          <strong>当前筛选范围没有提示词</strong>
          <span>关闭排序管理后调整筛选条件再试</span>
        </div>
        <draggable
          v-else
          v-model="sortItems"
          item-key="id"
          handle=".prompt-sort-handle"
          :animation="180"
          :disabled="sortIsSearching"
          ghost-class="is-sort-ghost"
          drag-class="is-sort-dragging"
          class="prompt-sort-list"
        >
          <template #item="{ element: item, index }">
            <article
              class="prompt-sort-row"
              :class="{ 'is-selected': sortSelectedId === item.id, 'is-search-result': sortIsSearching }"
              @click="selectSortItem(item, index)"
            >
              <button
                type="button"
                class="prompt-sort-handle"
                :disabled="sortIsSearching"
                :title="sortIsSearching ? '清除搜索后可拖动当前页' : '拖动当前页排序'"
                aria-label="拖动排序"
                @click.stop
              >
                <el-icon><Rank /></el-icon>
              </button>
              <span class="prompt-sort-index">{{ sortIsSearching ? '·' : (sortPage - 1) * SORT_PAGE_SIZE + index + 1 }}</span>
              <span class="prompt-sort-cover">
                <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" loading="lazy" />
                <el-icon v-else><Picture /></el-icon>
              </span>
              <span class="prompt-sort-copy">
                <strong :title="item.title">{{ item.title }}</strong>
                <small>{{ categoryMeta(item.category).label }} · {{ taskTypeLabel(item.taskType) }}</small>
              </span>
              <span class="prompt-sort-actions">
                <button type="button" title="选中并置顶" @click.stop="selectSortItem(item, index); moveSelectedPrompt(1)">⇈</button>
                <button type="button" title="当前页上移" :disabled="sortIsSearching || index === 0" @click.stop="moveSortItem(index, index - 1)">↑</button>
                <button type="button" title="当前页下移" :disabled="sortIsSearching || index === sortItems.length - 1" @click.stop="moveSortItem(index, index + 1)">↓</button>
                <button type="button" title="选中并置底" @click.stop="selectSortItem(item, index); moveSelectedPrompt(sortScopeTotal)">⇊</button>
              </span>
            </article>
          </template>
        </draggable>

        <div v-if="!sortLoading && sortItems.length" class="prompt-sort-pagination">
          <span v-if="sortIsSearching">当前排序范围共 {{ sortScopeTotal }} 条</span>
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

        <footer class="prompt-sort-footer">
          <span>{{ sortDirty ? '当前页顺序有改动，尚未保存' : '当前页顺序已保存' }}</span>
          <div>
            <el-button @click="sortDrawerOpen = false">关闭</el-button>
            <el-button type="primary" :loading="sortSaving" :disabled="!sortDirty" @click="saveSortOrder()">
              保存顺序
            </el-button>
          </div>
        </footer>
      </div>
    </el-drawer>

    <el-dialog
      v-model="editorOpen"
      width="min(1280px, 94vw)"
      align-center
      append-to-body
      destroy-on-close
      class="prompt-editor-dialog prompt-content-editor"
    >
      <template #header>
        <div class="editor-dialog-head">
          <span class="editor-dialog-head__mark"><el-icon><EditPen /></el-icon></span>
          <div>
            <strong>{{ editingId ? '编辑提示词' : '新增提示词' }}</strong>
            <small>完善内容与发布设置，保存后立即同步到用户端词库</small>
          </div>
        </div>
      </template>
      <el-form label-position="top" class="editor-form editor-form--wide">
        <section class="editor-basics-panel">
          <div class="editor-section-head">
            <div><strong>基础信息</strong><span>用于用户端搜索、分类和识别</span></div>
          </div>
          <div class="editor-meta-grid">
            <el-form-item label="名称"><el-input v-model="form.title" maxlength="80" placeholder="请输入清晰易懂的提示词名称" /></el-form-item>
            <el-form-item label="内容分类">
              <el-select
                v-model="form.category"
                filterable
                allow-create
                default-first-option
                placeholder="选择内容分类"
                style="width: 100%"
              >
                <el-option
                  v-for="category in CATEGORY_OPTIONS.slice(1)"
                  :key="category.value"
                  :label="`${category.label}（${category.value}）`"
                  :value="category.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="标签" class="editor-tags-field">
              <el-input v-model="form.tagsText" placeholder="用逗号分隔，例如：电影感，人物，霓虹" />
            </el-form-item>
          </div>
        </section>

        <div class="editor-work-layout">
          <section class="editor-prompt-panel editor-surface-card">
            <div class="editor-section-head">
              <div><strong>提示词内容</strong><span>描述主体、构图、风格与细节要求</span></div>
              <em>最多 8000 字</em>
            </div>
            <el-form-item class="prompt-body-field">
              <el-input
                v-model="form.prompt"
                type="textarea"
                maxlength="8000"
                show-word-limit
                placeholder="输入完整提示词内容…"
              />
            </el-form-item>
          </section>

          <aside class="editor-options-panel">
            <section class="editor-setting-card editor-publish-card">
              <div class="editor-section-head is-compact">
                <div><strong>发布设置</strong><span>决定投放位置和用户端可见性</span></div>
              </div>
              <el-form-item label="投放功能">
                <el-select v-model="form.taskType" placeholder="选择投放功能" style="width: 100%">
                  <el-option
                    v-for="type in TASK_TYPES"
                    :key="type"
                    :label="taskTypeLabel(type)"
                    :value="type"
                  />
                </el-select>
              </el-form-item>
              <div class="editor-visibility-row">
                <span><strong>用户端展示</strong><small>{{ form.active ? '当前用户可以看到并使用' : '仅后台保留，用户端隐藏' }}</small></span>
                <el-switch v-model="form.active" inline-prompt active-text="开" inactive-text="关" />
              </div>
            </section>

            <section class="editor-setting-card editor-cover-card">
              <div class="editor-section-head is-compact">
                <div><strong>封面图片</strong><span>建议使用清晰、能代表效果的图片</span></div>
                <em>PNG / JPG / WebP · 8MB</em>
              </div>
              <label class="image-picker">
                <img v-if="previewUrl" :src="previewUrl" alt="提示词封面预览" />
                <span v-else>
                  <el-icon :size="22"><Picture /></el-icon>
                  <strong>点击上传封面</strong>
                  <small>PNG / JPG / WebP</small>
                </span>
                <em v-if="previewUrl">更换图片</em>
                <input type="file" accept="image/png,image/jpeg,image/webp" @change="pickImage" />
              </label>
            </section>

            <section class="editor-setting-card editor-heat-card">
              <div class="editor-section-head is-compact">
                <div><strong>冷启动热度</strong><span>可选；真实用户行为会在此基础上累计</span></div>
              </div>
              <div class="editor-heat-fields">
                <label><span>点赞</span><el-input-number v-model="form.likeCount" :min="0" :max="100000000" controls-position="right" /></label>
                <label><span>收藏</span><el-input-number v-model="form.favoriteCount" :min="0" :max="100000000" controls-position="right" /></label>
                <label><span>使用</span><el-input-number v-model="form.useCount" :min="0" :max="100000000" controls-position="right" /></label>
              </div>
              <div class="editor-sort-note">
                <el-icon><Rank /></el-icon>
                <span>展示顺序请在保存后使用卡片右上角“调序”设置</span>
              </div>
            </section>
          </aside>
        </div>
      </el-form>
      <template #footer>
        <div class="editor-dialog-footer">
          <span>{{ pendingImage ? '已选择新封面，保存时一并上传' : '所有修改将在保存后生效' }}</span>
          <div>
            <el-button @click="editorOpen = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">保存提示词</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-drawer v-model="sourcesDrawerOpen" title="提示词数据源" size="560px" class="sources-drawer">
      <div class="sources-panel">
        <div class="sources-panel__head">
          <div>
            <strong>外部数据源</strong>
            <span>同步 JSON / Markdown / HTML 远程源，导入词条自动更新</span>
          </div>
          <el-button type="primary" :icon="Plus" @click="openSourceEditor()">新建源</el-button>
        </div>

        <div v-loading="sourcesLoading" class="source-list">
          <article
            v-for="source in sources"
            :key="source.id"
            class="source-card"
            :class="{ 'is-disabled': !source.enabled }"
          >
            <header class="source-card__head">
              <div class="source-card__title">
                <strong :title="source.name">{{ source.name }}</strong>
                <span class="format-badge" :style="{ '--format-color': formatMeta(source.format).color }">
                  {{ formatMeta(source.format).label }}
                </span>
              </div>
              <el-switch
                :model-value="source.enabled"
                size="small"
                @change="toggleSource(source, Boolean($event))"
              />
            </header>

            <button class="source-card__url" type="button" title="点击复制源地址" @click="copySourceUrl(source)">
              <span>{{ source.sourceUrl }}</span>
              <el-icon><CopyDocument /></el-icon>
            </button>

            <div class="source-card__meta">
              <span class="is-strong">{{ source.itemCount ?? 0 }} 条词条</span>
              <span>{{ taskTypeLabel(source.taskType) }}</span>
              <span>
                {{ source.lastSyncedAt ? `${relativeTime(source.lastSyncedAt)}同步` : '尚未同步'
                }}<template v-if="source.lastSyncedAt && source.lastSyncDurationMs != null">
                  · {{ source.lastSyncDurationMs }}ms</template
                >
              </span>
              <span :class="source.autoSyncEnabled ? 'is-auto' : ''">
                {{ source.autoSyncEnabled ? `自动同步 · ${intervalLabel(source.syncIntervalMinutes)}` : '仅手动同步' }}
              </span>
            </div>

            <div v-if="source.lastError" class="source-card__error">
              <el-icon><WarningFilled /></el-icon>
              <span :title="source.lastError">{{ source.lastError }}</span>
            </div>

            <footer class="source-card__actions">
              <el-button
                size="small"
                type="primary"
                plain
                :icon="Refresh"
                :loading="syncingSourceId === source.id"
                @click="syncSource(source)"
              >
                立即同步
              </el-button>
              <el-button size="small" :icon="EditPen" @click="openSourceEditor(source)">编辑</el-button>
              <el-tooltip content="删除数据源" placement="top">
                <el-button size="small" type="danger" text :icon="Delete" @click="removeSource(source)" />
              </el-tooltip>
            </footer>
          </article>

          <div v-if="!sourcesLoading && !sources.length" class="sources-empty">
            <el-icon><Link /></el-icon>
            <strong>还没有数据源</strong>
            <span>接入 JSON / Markdown / HTML 远程源，批量导入提示词</span>
            <el-button type="primary" :icon="Plus" @click="openSourceEditor()">新建源</el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <el-dialog
      v-model="sourceEditorOpen"
      :title="editingSourceId ? '编辑数据源' : '新建数据源'"
      width="560px"
      destroy-on-close
      class="prompt-editor-dialog"
    >
      <div class="dialog-intro">
        <span><el-icon :size="18"><Link /></el-icon></span>
        <div>
          <strong>提示词数据源</strong>
          <small>同步只影响该源导入的词条，不会改动手工创建的提示词。</small>
        </div>
      </div>
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
              <el-option v-for="type in TASK_TYPES" :key="type" :label="taskTypeLabel(type)" :value="type" />
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
      <template #footer>
        <el-button @click="sourceEditorOpen = false">取消</el-button>
        <el-button type="primary" :loading="sourceSaving" @click="saveSource">保存数据源</el-button>
      </template>
    </el-dialog>
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
  padding: 24px 28px;
  background:
    radial-gradient(circle at 88% 4%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 28%),
    var(--bg);
}

.library-header {
  position: relative;
  z-index: 4;
  display: grid;
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.library-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.library-header__copy {
  display: grid;
  gap: 2px;
  min-width: 0;

  h2 {
    margin: 0;
    color: var(--el-text-color-primary);
    font-size: 18px;
    font-weight: 760;
    line-height: 1.3;
  }

  p {
    margin: 0;
    color: var(--library-muted);
    font-size: 12px;
    line-height: 1.45;
  }
}

.library-eyebrow {
  color: var(--library-accent);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.library-header__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.library-header__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 240px);
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--library-border);
}

.library-event-status {
  display: grid;
  min-width: 0;
  min-height: 38px;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 4px 9px;
  border: 1px solid var(--library-border);
  border-radius: 9px;
  background: var(--el-fill-color-lighter);
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;

  > .el-icon {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 7px;
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  > span {
    display: grid;
    min-width: 0;
    gap: 1px;
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

  &.is-dragging {
    border-color: color-mix(in srgb, var(--accent) 46%, var(--library-border));
    background: var(--accent-soft);
  }

  &.is-selecting {
    border-color: color-mix(in srgb, var(--accent) 34%, var(--library-border));
    background: var(--accent-soft);
  }

  &.is-saving > .el-icon {
    animation: prompt-status-pulse 0.9s ease-in-out infinite alternate;
  }
}

.library-workspace {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.items-workspace {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: 210px minmax(0, 1fr);
}

.category-rail {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 12px;
  border-right: 1px solid var(--library-border);
  background: color-mix(in srgb, var(--el-fill-color-lighter) 65%, transparent);

  &.is-receiving-drop {
    background: color-mix(in srgb, var(--accent) 5%, var(--el-fill-color-lighter));

    > button:not(.is-drop-disabled) {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--category-color) 24%, transparent);
    }
  }

  &__title {
    display: flex;
    justify-content: space-between;
    padding: 4px 12px 13px;
    color: var(--library-muted);
    font-size: 12px;

    small {
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--el-fill-color);
    }
  }

  > button {
    display: grid;
    width: 100%;
    grid-template-columns: 30px 1fr;
    align-items: center;
    gap: 9px;
    margin: 2px 0;
    padding: 9px 10px;
    border: 0;
    border-radius: 9px;
    color: var(--el-text-color-regular);
    text-align: left;
    background: transparent;
    cursor: pointer;
    transition: 0.18s ease;

    i {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 8px;
      color: var(--category-color);
      font-style: normal;
      background: color-mix(in srgb, var(--category-color) 11%, transparent);
    }

    &:hover {
      background: var(--surface-3);
      transform: translateX(2px);
    }

    &.is-active {
      color: var(--accent-ink);
      font-weight: 600;
      background: var(--accent-soft);
    }

    &.is-drop-target {
      border-color: color-mix(in srgb, var(--category-color) 55%, transparent);
      color: var(--el-text-color-primary);
      background: color-mix(in srgb, var(--category-color) 14%, var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--category-color) 44%, transparent);
      transform: translateX(3px);
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
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}

.prompt-content__scroll {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 28%, transparent) transparent;
  padding: 18px;
}

.prompt-library-pagination {
  padding: 4px 18px;
  border-top: 1px solid var(--library-border);
  background: var(--surface-2);
}

.prompt-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.prompt-search {
  flex: 1 1 300px;
  min-width: 220px;
}

.toolbar-select {
  width: 150px;

  &.is-short {
    width: 128px;
  }
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
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 320px;
}

.prompt-grid__column {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  flex-direction: column;
  gap: 12px;
}

.prompt-skeleton-card {
  display: grid;
  gap: 9px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 16px;
  background: var(--surface);
}

.prompt-skeleton-card__cover,
.prompt-skeleton-card__line {
  display: block;
  border-radius: 8px;
  background: linear-gradient(
    100deg,
    var(--el-fill-color-light) 20%,
    var(--el-fill-color) 42%,
    var(--el-fill-color-light) 64%
  );
  background-size: 220% 100%;
  animation: prompt-skeleton-shimmer 1.35s ease-in-out infinite;
}

.prompt-skeleton-card__cover {
  height: 168px;

  &.is-variant-2 {
    height: 204px;
  }

  &.is-variant-3 {
    height: 148px;
  }
}

.prompt-skeleton-card__line {
  width: 100%;
  height: 9px;

  &.is-title {
    width: 72%;
    height: 12px;
  }

  &.is-short {
    width: 46%;
  }
}

.prompt-card {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 10px;
  padding: 10px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  content-visibility: auto;
  contain-intrinsic-size: auto 420px;
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease,
    border-color 0.22s ease,
    opacity 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    box-shadow: var(--shadow-lg);
    transform: translateY(-3px);
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
    transform: scale(0.975) rotate(-0.4deg);
    user-select: none;
  }

  &.is-moving {
    pointer-events: none;
    opacity: 0.58;
  }

  &.is-selected {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent),
      0 12px 30px color-mix(in srgb, var(--accent) 16%, transparent);
  }
}

.prompt-cover {
  position: relative;
  width: 100%;
  min-height: 164px;
  overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--el-fill-color-light), var(--el-fill-color));
  cursor: pointer;

  &.has-image {
    min-height: 0;
  }

  img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: contain;
    background: var(--el-fill-color-light);
    transition:
      transform 0.35s ease,
      filter 0.25s ease;
  }

  &:hover img {
    filter: brightness(0.82);
    transform: scale(1.025);
  }
}

.prompt-cover__media-placeholder {
  position: absolute;
  inset: 0;
  display: block;
  background: var(--el-fill-color-light);
}

.prompt-grid.is-scrolling {
  .prompt-card {
    pointer-events: none;
    box-shadow: none;
    transition: none;
  }

  .prompt-cover img {
    filter: none;
    transform: none;
    transition: none;
  }

  .category-badge,
  .prompt-card__select,
  .prompt-cover__specs span {
    backdrop-filter: none;
  }
}

.prompt-cover__empty {
  display: grid;
  min-height: 164px;
  place-items: center;
  align-content: center;
  gap: 5px;
  color: var(--library-muted);
  background-image:
    linear-gradient(45deg, color-mix(in srgb, var(--accent) 4%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--accent) 4%, transparent) 25%, transparent 25%);
  background-size: 24px 24px;

  .el-icon {
    font-size: 28px;
    color: var(--accent-ink);
  }

  span {
    font-size: 13px;
  }

  small {
    font-size: 11px;
    opacity: 0.7;
  }
}

.category-badge {
  position: absolute;
  top: 11px;
  left: 11px;
  padding: 5px 9px;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  line-height: 1;
  background: color-mix(in srgb, var(--category-color) 88%, #111827);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--category-color) 25%, transparent);
  backdrop-filter: blur(10px);
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

.prompt-cover__overlay {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  display: grid;
  gap: 7px;
  padding: 44px 11px 10px;
  color: #fff;
  text-align: left;
  background: linear-gradient(to bottom, transparent, rgb(5 5 10 / 42%) 30%, rgb(5 5 10 / 92%) 100%);
  pointer-events: none;
}

.prompt-cover__prompt {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.55;
  text-shadow: 0 1px 8px rgb(0 0 0 / 45%);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.prompt-cover__specs {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: rgb(255 255 255 / 78%);
  font-size: 9px;

  span {
    display: inline-flex;
    max-width: 100%;
    min-height: 22px;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: 999px;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: rgb(15 15 22 / 56%);
    backdrop-filter: blur(10px);
  }

  .el-icon {
    font-size: 10px;
  }
}

.prompt-card__body {
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 0 2px 1px;

  header {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;

    > div {
      display: grid;
      min-width: 0;
      gap: 3px;
    }

    strong {
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    small {
      overflow: hidden;
      color: var(--library-muted);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  footer {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--library-border);

    > span {
      overflow: hidden;
      color: var(--library-muted);
      font-size: 9px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.prompt-card__body-placeholder {
  width: 100%;
  min-height: 120px;
  pointer-events: none;
}

.prompt-card__actions {
  display: flex;
  align-items: center;
  gap: 5px;

  .el-button {
    width: 27px;
    height: 27px;
    min-height: 27px;
    padding: 0;
  }

  .el-button + .el-button {
    margin-left: 0;
  }
}

.prompt-card__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}

.prompt-quick-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 7px;

  label {
    display: grid;
    min-width: 0;
    gap: 4px;

    > span {
      color: var(--library-muted);
      font-size: 9px;
      font-weight: 650;
    }
  }

  :deep(.el-select) {
    width: 100%;
  }

  :deep(.el-select__wrapper) {
    min-height: 28px;
    padding: 3px 8px;
    border-radius: 7px;
    box-shadow: 0 0 0 1px var(--library-border) inset;
  }

  :deep(.el-select__selected-item) {
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
  min-height: 23px;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;

  span,
  em {
    padding: 3px 7px;
    border-radius: 6px;
    font-size: 10px;
    font-style: normal;
  }

  span {
    color: var(--info);
    background: var(--info-soft);
  }

  em {
    color: var(--accent-ink);
    background: var(--accent-soft);
  }
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
  border-radius: 14px;

  .el-icon {
    font-size: 34px;
  }

  strong {
    color: var(--el-text-color-primary);
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

.editor-meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.85fr) minmax(320px, 1.1fr);
  gap: 12px;

  .el-form-item {
    min-width: 0;
    margin-bottom: 0;
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

.editor-section-head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.editor-section-head > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.editor-section-head strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.editor-section-head span,
.editor-section-head em {
  color: var(--ink-3);
  font-size: 10px;
  font-style: normal;
  line-height: 1.4;
}

.editor-section-head.is-compact {
  margin-bottom: 10px;
}

.editor-work-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(340px, 0.72fr);
  gap: 12px;
  align-items: start;
  padding-top: 12px;
}

.editor-prompt-panel,
.editor-options-panel {
  min-width: 0;
}

.editor-options-panel {
  display: grid;
  gap: 10px;

  > .el-form-item {
    margin-bottom: 0;
  }
}

.editor-prompt-panel,
.editor-setting-card {
  padding: 13px 14px;
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

.editor-visibility-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 11px;
  padding-top: 11px;
  border-top: 1px solid var(--library-border);
}

.editor-visibility-row > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.editor-visibility-row strong {
  color: var(--ink-2);
  font-size: 12px;
}

.editor-visibility-row small {
  color: var(--ink-3);
  font-size: 9px;
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
  cursor: pointer;

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

/* 词库卡片：远程源词条角标（叠在封面图上，跟随主题的 accent 令牌） */
.sync-badge {
  position: absolute;
  top: 11px;
  right: 11px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  border-radius: 999px;
  color: var(--accent-ink);
  font-size: 11px;
  line-height: 1;
  background: color-mix(in srgb, var(--accent-soft) 92%, transparent);
  backdrop-filter: blur(10px);

  .el-icon {
    font-size: 10px;
  }
}

.sources-panel {
  display: grid;
  gap: 14px;
}

.sources-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-radius: 12px;
  background: var(--accent-soft);

  > div {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  strong {
    color: var(--el-text-color-primary);
    font-size: 14px;
  }

  span {
    color: var(--library-muted);
    font-size: 12px;
  }
}

.source-list {
  display: grid;
  gap: 12px;
  min-height: 200px;
  align-content: start;
}

.source-card {
  display: grid;
  gap: 10px;
  padding: 14px 15px;
  border: 1px solid var(--library-border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    box-shadow: var(--shadow-md);
  }

  &.is-disabled {
    opacity: 0.62;
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
    color: var(--el-text-color-primary);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.format-badge {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--format-color);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--format-color) 12%, transparent);
}

.source-card__url {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--library-muted);
  font-size: 11px;
  text-align: left;
  background: var(--surface-2);
  cursor: pointer;
  transition: 0.15s ease;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .el-icon {
    flex-shrink: 0;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  &:hover {
    color: var(--accent-ink);
    background: var(--accent-soft);

    .el-icon {
      opacity: 1;
    }
  }
}

.source-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;

  span {
    padding: 3px 8px;
    border-radius: 6px;
    color: var(--ink-2);
    font-size: 10px;
    background: var(--surface-3);

    &.is-strong {
      color: var(--accent-ink);
      font-weight: 650;
      background: var(--accent-soft);
    }

    &.is-auto {
      color: var(--success);
      background: var(--success-soft);
    }
  }
}

.source-card__error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  color: var(--danger);
  font-size: 11px;
  background: var(--danger-soft);

  .el-icon {
    flex-shrink: 0;
  }

  span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}

.source-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--library-border);

  .el-button + .el-button {
    margin-left: 0;
  }
}

.sources-empty {
  display: grid;
  min-height: 260px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--library-muted);
  border: 1px dashed var(--library-border);
  border-radius: 14px;

  .el-icon {
    font-size: 30px;
  }

  strong {
    color: var(--el-text-color-primary);
  }

  span {
    font-size: 12px;
  }
}

@media (max-width: 1500px) {
  .library-header__controls {
    grid-template-columns: minmax(0, 1fr) 210px;
  }

  .prompt-toolbar {
    flex-wrap: wrap;
  }

  .prompt-search {
    flex-basis: 100%;
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
    grid-column: 1 / -1;
  }

  .editor-work-layout {
    grid-template-columns: minmax(0, 1.25fr) minmax(330px, 0.75fr);
    gap: 12px;
  }

  .editor-options-panel {
    padding-left: 0;
  }

  .items-workspace {
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: 1fr;
  }

  .category-rail {
    display: flex;
    min-height: auto;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: 0;
    border-bottom: 1px solid var(--library-border);

    > button {
      width: auto;
      min-width: 132px;
      flex: 0 0 auto;
    }

    &__title {
      display: none;
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

@media (max-width: 720px) {
  .prompt-library-page {
    grid-template-rows: auto minmax(0, 1fr);
    padding: 10px;
  }

  .prompt-content {
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .prompt-content__scroll {
    padding: 12px;
  }

  .prompt-library-pagination {
    padding: 6px 12px;
  }

  .toolbar-select,
  .toolbar-select.is-short {
    width: calc(50% - 5px);
  }

  .library-header__top {
    flex-direction: column;
    align-items: stretch;
  }

  .library-header__actions {
    flex-wrap: wrap;
  }

  .library-header__controls {
    grid-template-columns: 1fr;
  }

  .library-event-status {
    min-width: 0;
  }

  .prompt-bulk-bar {
    position: relative;
    flex-direction: column;
    align-items: stretch;
  }

  .prompt-bulk-controls {
    justify-content: flex-start;

    :deep(.el-select) {
      width: calc(50% - 4px);
    }
  }

  .editor-meta-grid,
  .editor-form .form-grid,
  .editor-options-lower,
  .form-settings {
    grid-template-columns: 1fr;
  }

  .editor-tags-field {
    grid-column: auto;
  }

  .type-checkboxes {
    grid-template-columns: 1fr 1fr;
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
.sources-drawer {
  max-width: 94vw;
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
  gap: 8px;
}

.prompt-quick-sort-footer > span {
  flex: 1;
}

.prompt-sort-drawer {
  max-width: 96vw;
}

.prompt-sort-drawer .el-drawer__body {
  padding: 0;
  overflow: hidden;
}

.prompt-sort-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.prompt-sort-summary {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.prompt-sort-summary strong,
.prompt-sort-summary span {
  display: block;
}

.prompt-sort-summary strong {
  color: var(--ink-1);
  font-size: 14px;
}

.prompt-sort-summary span {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 11px;
}

.prompt-sort-filters {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(220px, 1fr) 132px 132px 118px;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.prompt-sort-positioner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  background: var(--accent-soft);
}

.prompt-sort-positioner__item {
  display: grid;
  min-width: 0;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
}

.prompt-sort-positioner__item > img,
.prompt-sort-positioner__item > .el-icon {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--surface);
}

.prompt-sort-positioner__item > .el-icon {
  padding: 9px;
  color: var(--ink-3);
}

.prompt-sort-positioner__item small,
.prompt-sort-positioner__item strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-sort-positioner__item small {
  color: var(--ink-3);
  font-size: 10px;
}

.prompt-sort-positioner__item strong {
  max-width: 220px;
  margin-top: 2px;
  color: var(--ink-1);
  font-size: 12px;
}

.prompt-sort-positioner__controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  color: var(--ink-2);
  font-size: 12px;
}

.prompt-sort-positioner__controls .el-input-number {
  width: 108px;
}

.prompt-sort-search-note {
  flex: 0 0 auto;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 11px;
  background: var(--surface-2);
}

.prompt-sort-loading,
.prompt-sort-empty {
  flex: 1;
  min-height: 220px;
}

.prompt-sort-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
}

.prompt-sort-empty .el-icon {
  font-size: 28px;
}

.prompt-sort-empty strong {
  color: var(--ink-1);
}

.prompt-sort-list {
  flex: 1;
  min-height: 0;
  padding: 10px 14px 20px;
  overflow-y: auto;
  background: var(--surface-2);
}

.prompt-sort-row {
  display: grid;
  grid-template-columns: 32px 32px 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 68px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
  cursor: pointer;
}

.prompt-sort-row:hover {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
}

.prompt-sort-row.is-selected {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent);
}

.prompt-sort-row.is-search-result .prompt-sort-handle {
  cursor: not-allowed;
  opacity: 0.4;
}

.prompt-sort-row.is-sort-ghost,
.is-sort-ghost .prompt-sort-row {
  opacity: 0.32;
}

.prompt-sort-handle {
  display: grid;
  width: 32px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: grab;
}

.prompt-sort-handle:active {
  cursor: grabbing;
}

.prompt-sort-index {
  color: var(--ink-3);
  font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
}

.prompt-sort-cover {
  display: grid;
  width: 56px;
  height: 50px;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-3);
}

.prompt-sort-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.prompt-sort-copy {
  min-width: 0;
}

.prompt-sort-copy strong,
.prompt-sort-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-sort-copy strong {
  color: var(--ink-1);
  font-size: 13px;
}

.prompt-sort-copy small {
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 10px;
}

.prompt-sort-actions {
  display: flex;
  gap: 4px;
}

.prompt-sort-actions button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--ink-2);
  cursor: pointer;
}

.prompt-sort-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.prompt-sort-actions button:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.prompt-sort-pagination {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 18px;
  border-top: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 11px;
  background: var(--surface-2);
}

.prompt-sort-pagination :deep(.cursor-pager) {
  min-width: 0;
  flex: 1;
}

.prompt-sort-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.prompt-sort-footer > span {
  color: var(--ink-3);
  font-size: 11px;
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

.editor-heat-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.editor-heat-fields label {
  display: grid;
  gap: 5px;
  color: var(--ink-3);
  font-size: 10px;
}

.editor-heat-fields .el-input-number {
  width: 100%;
}

.editor-sort-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--library-border);
  color: var(--ink-3);
  font-size: 9px;
}

.editor-sort-note .el-icon {
  flex: 0 0 auto;
  color: var(--accent-ink);
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
  .prompt-sort-filters {
    grid-template-columns: 1fr 1fr;
  }

  .prompt-sort-filters > :first-child {
    grid-column: 1 / -1;
  }

  .prompt-sort-positioner {
    align-items: stretch;
    flex-direction: column;
  }

  .prompt-sort-positioner__controls {
    flex-wrap: wrap;
  }

  .prompt-sort-row {
    grid-template-columns: 30px 26px 48px minmax(0, 1fr);
  }

  .prompt-sort-actions {
    grid-column: 3 / -1;
    justify-content: flex-end;
  }

  .prompt-sort-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

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
