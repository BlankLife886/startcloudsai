<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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

interface PromptItem {
  id: string
  title: string
  prompt: string
  taskType: string
  category: string
  tags: string[]
  coverUrl?: string | null
  sort: number
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
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const promptContentRef = ref<HTMLElement | null>(null)
const promptSentinelRef = ref<HTMLElement | null>(null)
let promptLoadObserver: IntersectionObserver | null = null
let promptRequestVersion = 0

const hasNext = computed(() => nextCursor.value !== null)
const initialLoading = computed(() => loading.value && items.value.length === 0)
const refreshing = computed(() => loading.value && items.value.length > 0)

function promptQueryParams(cursor: string | null) {
  return {
    type: typeFilter.value === 'all' ? '' : typeFilter.value,
    category: categoryFilter.value === 'all' ? '' : categoryFilter.value,
    search: query.value.trim(),
    limit: 24,
    cursor,
  }
}

async function reset() {
  const version = ++promptRequestVersion
  const hadItems = items.value.length > 0
  const params = promptQueryParams(null)
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
    nextCursor.value = page.nextCursor
    const loadedIds = new Set(page.items.map((item) => item.id))
    for (const id of selectedIds) {
      if (!loadedIds.has(id)) selectedIds.delete(id)
    }
    await nextTick()
    promptContentRef.value?.scrollTo({ top: 0, behavior: 'auto' })
    setupPromptObserver()
  } catch (cause) {
    if (version !== promptRequestVersion) return
    if (!hadItems) items.value = []
    error.value = cause instanceof Error && cause.message ? cause.message : '加载失败，请重试'
  } finally {
    if (version === promptRequestVersion) loading.value = false
  }
}

async function loadMorePrompts() {
  const cursor = nextCursor.value
  if (!cursor || loading.value || loadingMore.value) return
  const version = promptRequestVersion
  loadingMore.value = true
  try {
    const page = normalizeList(
      await request<PromptItem[] | Page<PromptItem>>('/api/admin/prompt-library', {
        query: promptQueryParams(cursor),
      }),
    )
    if (version !== promptRequestVersion) return
    const merged = new Map(items.value.map((item) => [item.id, item]))
    for (const item of page.items) merged.set(item.id, item)
    items.value = [...merged.values()]
    nextCursor.value = page.nextCursor
    error.value = null
  } catch (cause) {
    if (version === promptRequestVersion) {
      error.value = cause instanceof Error && cause.message ? cause.message : '加载更多失败，请重试'
    }
  } finally {
    if (version === promptRequestVersion) loadingMore.value = false
  }
}

function refresh() {
  return reset()
}

function retry() {
  return items.value.length ? loadMorePrompts() : reset()
}

function setupPromptObserver() {
  promptLoadObserver?.disconnect()
  promptLoadObserver = null
  if (typeof IntersectionObserver === 'undefined' || !promptSentinelRef.value) return
  promptLoadObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMorePrompts()
    },
    { root: promptContentRef.value, rootMargin: '560px 0px', threshold: 0.01 },
  )
  promptLoadObserver.observe(promptSentinelRef.value)
}

/** 启停/封面筛选（契约无该查询参数，作用于当前页） */
const visibleItems = computed(() => {
  if (statusFilter.value === 'enabled') return items.value.filter((item) => item.active)
  if (statusFilter.value === 'disabled') return items.value.filter((item) => !item.active)
  if (statusFilter.value === 'missing-cover') return items.value.filter((item) => !item.coverUrl)
  return items.value
})

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

/* 拖动归类：从卡片手柄拖到左侧分类，PATCH 成功后同步当前筛选结果。 */
const draggingItem = ref<PromptItem | null>(null)
const dragTargetCategory = ref('')
const movingItemId = ref('')
const dragPointer = reactive({ x: 0, y: 0 })
const updatingItemFields = reactive(new Set<string>())

const dragTargetMeta = computed(() =>
  dragTargetCategory.value ? categoryMeta(dragTargetCategory.value) : null,
)

const headerStatus = computed(() => {
  if (batchSaving.value) {
    return { tone: 'is-saving', title: '正在批量更新', detail: `${selectedItems.value.length} 条内容` }
  }
  if (selectedItems.value.length) {
    return { tone: 'is-selecting', title: '多选编辑', detail: `已选 ${selectedItems.value.length} 条` }
  }
  if (movingItemId.value) {
    return { tone: 'is-saving', title: '正在更新分类', detail: '保存中' }
  }
  if (draggingItem.value) {
    const target = dragTargetCategory.value ? categoryMeta(dragTargetCategory.value).label : '选择目标分类'
    return { tone: 'is-dragging', title: draggingItem.value.title, detail: `目标：${target}` }
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

function categoryAtPoint(x: number, y: number) {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-prompt-category]')
  const value = target?.dataset.promptCategory ?? ''
  if (!value || value === 'all') return null
  return CATEGORY_OPTIONS.find((category) => category.value === value) ?? null
}

function startCategoryDrag(item: PromptItem, event: PointerEvent) {
  if (movingItemId.value) {
    event.preventDefault()
    return
  }
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  draggingItem.value = item
  dragTargetCategory.value = ''
  dragPointer.x = event.clientX
  dragPointer.y = event.clientY
}

function finishCategoryDrag() {
  draggingItem.value = null
  dragTargetCategory.value = ''
}

function moveCategoryDrag(event: PointerEvent) {
  if (!draggingItem.value) return
  event.preventDefault()
  dragPointer.x = event.clientX
  dragPointer.y = event.clientY
  dragTargetCategory.value = categoryAtPoint(event.clientX, event.clientY)?.value ?? ''
}

async function finishPointerCategoryDrag(event: PointerEvent) {
  const item = draggingItem.value
  const category = categoryAtPoint(event.clientX, event.clientY)
  finishCategoryDrag()
  if (!item || !category || item.category === category.value || movingItemId.value) return

  const previousCategory = item.category
  item.category = category.value
  movingItemId.value = item.id
  try {
    await request(`/api/admin/prompt-library/${item.id}`, {
      method: 'PATCH',
      body: { category: category.value },
    })
    ElMessage.success(`已移入「${category.label}」`)
    if (categoryFilter.value !== 'all') await refresh()
  } catch {
    item.category = previousCategory
  } finally {
    movingItemId.value = ''
  }
}

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

/* 瀑布流列布局（还原旧版按图片比例分列） */
const gridColumnCount = ref(5)
const imageRatios = reactive<Record<string, number>>({})
const gridColumns = computed(() => {
  const columns = Array.from({ length: gridColumnCount.value }, () => [] as PromptItem[])
  const heights = Array.from({ length: gridColumnCount.value }, () => 0)
  for (const item of visibleItems.value) {
    let target = 0
    for (let index = 1; index < heights.length; index += 1) {
      if ((heights[index] ?? 0) < (heights[target] ?? 0)) target = index
    }
    columns[target]?.push(item)
    const ratio = Math.max(0.38, Math.min(3.2, imageRatios[item.id] ?? 16 / 10))
    heights[target] = (heights[target] ?? 0) + 1 / ratio + 0.52
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

watch([query, categoryFilter, typeFilter], scheduleReload)
watch(statusFilter, clearSelection)

function resetFilters() {
  query.value = ''
  categoryFilter.value = 'all'
  typeFilter.value = 'all'
  statusFilter.value = 'all'
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
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    ElMessage.warning('提示词封面不能超过 8MB')
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
  const payload = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
  if (!payload?.success) throw new Error(payload?.error ?? '封面上传失败')
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
      sort: form.sort,
      active: form.active,
    }
    const saved = editingId.value
      ? await request<PromptItem>(`/api/admin/prompt-library/${editingId.value}`, { method: 'PATCH', body })
      : await request<PromptItem>('/api/admin/prompt-library', { method: 'POST', body })
    const id = saved?.id || editingId.value
    if (pendingImage.value && id) {
      await uploadCover(id, pendingImage.value)
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
  window.addEventListener('pointermove', moveCategoryDrag, { passive: false })
  window.addEventListener('pointerup', finishPointerCategoryDrag)
  window.addEventListener('pointercancel', finishCategoryDrag)
  void reset()
  void loadSources(true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateGridColumnCount)
  window.removeEventListener('pointermove', moveCategoryDrag)
  window.removeEventListener('pointerup', finishPointerCategoryDrag)
  window.removeEventListener('pointercancel', finishCategoryDrag)
  promptLoadObserver?.disconnect()
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
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
          <el-tag type="success" effect="light" round size="small">已加载 {{ items.length }} 条内容</el-tag>
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
        <aside class="category-rail" :class="{ 'is-receiving-drop': Boolean(draggingItem) }">
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
              'is-drop-target': dragTargetCategory === category.value,
              'is-drop-disabled': Boolean(draggingItem) && category.value === 'all',
            }"
            @click="categoryFilter = category.value"
            :data-prompt-category="category.value"
          >
            <i :style="{ '--category-color': category.color }">{{ category.icon }}</i>
            <span>{{ category.label }}</span>
          </button>
        </aside>

        <main ref="promptContentRef" class="prompt-content">
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

          <div class="prompt-grid" :class="{ 'is-refreshing': refreshing }">
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
                    'is-dragging': draggingItem?.id === item.id,
                    'is-moving': movingItemId === item.id,
                    'is-selected': selectedIds.has(item.id),
                    'is-selection-mode': selectionMode,
                  }"
                >
                  <div
                    class="prompt-cover"
                    :class="{ 'has-image': Boolean(item.coverUrl) }"
                    @click="selectionMode ? toggleSelected(item.id, !selectedIds.has(item.id)) : openEditor(item)"
                  >
                    <img
                      v-if="item.coverUrl"
                      :src="item.coverUrl"
                      :alt="item.title"
                      loading="lazy"
                      @load="measureCover(item, $event)"
                    />
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

                  <div class="prompt-card__body">
                    <header>
                      <div>
                        <strong :title="item.title">{{ item.title }}</strong>
                        <small>{{ categoryMeta(item.category).label }} · 排序 {{ item.sort }}</small>
                      </div>
                      <div class="prompt-card__header-actions">
                        <el-tooltip content="拖动到左侧分类" placement="top">
                          <button
                            type="button"
                            class="prompt-drag-handle"
                            :disabled="Boolean(movingItemId) || selectionMode"
                            aria-label="拖动提示词分类"
                            @click.stop.prevent
                            @pointerdown="startCategoryDrag(item, $event)"
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

          <div ref="promptSentinelRef" class="prompt-load-sentinel" aria-hidden="true" />
          <div v-if="loadingMore" class="prompt-load-state" aria-live="polite">
            <el-icon class="is-spinning"><Refresh /></el-icon>
            <span>正在加载更多提示词</span>
          </div>
          <div v-else-if="items.length && !hasNext" class="prompt-load-state is-complete">
            <span>已加载全部 {{ items.length }} 条</span>
          </div>
        </main>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="prompt-drag-preview">
        <div
          v-if="draggingItem"
          class="prompt-drag-preview"
          :class="{ 'has-target': Boolean(dragTargetMeta) }"
          :style="{ left: `${dragPointer.x}px`, top: `${dragPointer.y}px` }"
        >
          <img v-if="draggingItem.coverUrl" :src="draggingItem.coverUrl" alt="" />
          <span v-else><el-icon><Picture /></el-icon></span>
          <div>
            <strong>{{ draggingItem.title }}</strong>
            <small>
              {{ categoryMeta(draggingItem.category).label }}
              <template v-if="dragTargetMeta"> → {{ dragTargetMeta.label }}</template>
            </small>
          </div>
        </div>
      </Transition>
    </Teleport>

    <el-dialog
      v-model="editorOpen"
      :title="editingId ? '编辑提示词' : '新增提示词'"
      width="min(1480px, 94vw)"
      align-center
      append-to-body
      destroy-on-close
      class="prompt-editor-dialog prompt-content-editor"
    >
      <el-form label-position="top" class="editor-form editor-form--wide">
        <div class="editor-meta-grid">
          <el-form-item label="名称"><el-input v-model="form.title" maxlength="80" /></el-form-item>
          <el-form-item label="内容分类">
            <el-select
              v-model="form.category"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入新分类 key"
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

        <div class="editor-work-layout">
          <section class="editor-prompt-panel">
            <el-form-item label="提示词内容" class="prompt-body-field">
              <el-input v-model="form.prompt" type="textarea" maxlength="8000" show-word-limit />
            </el-form-item>
          </section>

          <aside class="editor-options-panel">
            <el-form-item label="投放功能">
              <div class="type-checkboxes">
                <button
                  v-for="type in TASK_TYPES"
                  :key="type"
                  type="button"
                  :class="{ 'is-active': form.taskType === type }"
                  @click="form.taskType = type"
                >
                  {{ taskTypeLabel(type) }}
                </button>
              </div>
            </el-form-item>
            <div class="editor-options-lower">
              <el-form-item label="封面图片">
                <label class="image-picker">
                  <img v-if="previewUrl" :src="previewUrl" alt="提示词封面预览" />
                  <span v-else>
                    <el-icon :size="24"><Picture /></el-icon>
                    <strong>上传封面</strong>
                    <small>PNG / JPG / WebP，最大 8MB</small>
                  </span>
                  <em v-if="previewUrl">更换图片</em>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="pickImage" />
                </label>
              </el-form-item>
              <div class="form-settings">
                <el-form-item label="后台排序">
                  <el-input-number v-model="form.sort" :min="0" :max="10000" />
                </el-form-item>
                <el-form-item label="用户端状态">
                  <el-switch v-model="form.active" active-text="启用" inactive-text="停用" />
                </el-form-item>
              </div>
            </div>
          </aside>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存提示词</el-button>
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
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 28%, transparent) transparent;
  padding: 18px;
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

.prompt-load-sentinel {
  width: 100%;
  height: 1px;
}

.prompt-load-state {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--library-muted);
  font-size: 11px;

  .is-spinning {
    color: var(--accent-ink);
    animation: prompt-load-spin 0.85s linear infinite;
  }

  &.is-complete {
    opacity: 0.72;
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
    display: block;
    width: 100%;
    height: auto;
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
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--library-border);

  .el-form-item {
    min-width: 0;
    margin-bottom: 0;
  }
}

.editor-work-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(460px, 0.9fr);
  gap: 28px;
  align-items: stretch;
  padding-top: 18px;
}

.editor-prompt-panel,
.editor-options-panel {
  min-width: 0;
}

.editor-options-panel {
  padding-left: 28px;
  border-left: 1px solid var(--library-border);

  > .el-form-item {
    margin-bottom: 20px;
  }
}

.prompt-body-field {
  margin-bottom: 0 !important;

  :deep(.el-textarea__inner) {
    height: 320px;
    min-height: 320px !important;
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

.image-picker {
  position: relative;
  display: grid;
  width: 100%;
  height: 192px;
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
    grid-template-columns: minmax(0, 1.25fr) minmax(380px, 0.9fr);
    gap: 20px;
  }

  .editor-options-panel {
    padding-left: 20px;
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
    padding-top: 18px;
    padding-left: 0;
    border-top: 1px solid var(--library-border);
    border-left: 0;
  }
}

@media (max-width: 720px) {
  .prompt-library-page {
    grid-template-rows: auto minmax(0, 1fr);
    padding: 10px;
  }

  .prompt-content {
    padding: 12px;
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
}

.prompt-content-editor .el-dialog__footer {
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.prompt-editor-dialog .el-dialog__body {
  padding-top: 12px;
  overflow: visible;
}

.prompt-content-editor .el-dialog__body {
  padding-top: 8px;
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
