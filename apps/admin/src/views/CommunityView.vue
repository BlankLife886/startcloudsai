<script lang="ts">
/** 已过审社区作品（含 v3 策展字段） */
export interface CommunityWork {
  id: string
  title: string
  status: string
  coverUrl?: string
  mediaUrls?: string[]
  author?: { id: string; username: string | null }
  userEmail?: string
  featured?: boolean
  category?: { id: string; name: string } | null
  sort?: number
  tags?: string[]
  createdAt: string
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, CollectionTag, Delete, Plus, Rank, Search, User } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import AdminDialog from '@/components/AdminDialog.vue'
import { useVirtualMasonryFeed } from '@/composables/useVirtualMasonryFeed'
import { request, normalizeList, type Page } from '@/request'
import { formatTime } from '@/utils'
import CommunityWorkCard from './CommunityWorkCard.vue'

interface GalleryCategory {
  id: string
  name: string
  sort: number
  active: boolean
}

interface GallerySettings {
  submissionEnabled: boolean
  autoApprove: boolean
  dailyLimit: number
}

interface CommunityAuthor {
  userId: string
  email: string
  username: string | null
  avatarUrl: string | null
  submissions: number
  approved: number
  removed: number
  bannedUntil: string | null
}

/** 优先原图（mediaUrls），封面次之 */
function workImageUrl(item: Pick<CommunityWork, 'coverUrl' | 'mediaUrls'>): string {
  return String(item.mediaUrls?.[0] || item.coverUrl || '').trim()
}

/* ---------- 作品管理 ---------- */

const workQuery = ref('')
const workFilter = ref('all') // all | featured | 分类 id
const workOperating = ref('')
const workOrderSaving = ref(false)
const sortOpen = ref(false)
const sortList = ref<CommunityWork[]>([])

const works = ref<CommunityWork[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const worksError = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
let worksRequestVersion = 0

const hasMore = computed(() => nextCursor.value !== null)
const communityFeedRef = ref<HTMLElement | null>(null)
const isGridScrolling = ref(false)
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null

async function loadWorksPage(cursor: string | null, mode: 'replace' | 'append' = 'replace') {
  const version = ++worksRequestVersion
  const append = mode === 'append'
  if (append) {
    if (!cursor || loading.value || loadingMore.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    worksError.value = null
  }
  try {
    const page = normalizeList(
      await request<CommunityWork[] | Page<CommunityWork>>('/api/v1/admin/gallery/submissions', {
        query: { status: 'approved', limit: 24, cursor },
      }),
    )
    if (version !== worksRequestVersion) return
    if (append) {
      const seen = new Set(works.value.map((item) => item.id))
      works.value = [...works.value, ...page.items.filter((item) => !seen.has(item.id))]
    } else {
      works.value = page.items
      await nextTick()
      communityFeedRef.value?.scrollTo({ top: 0, behavior: 'auto' })
    }
    nextCursor.value = page.nextCursor
  } catch (cause) {
    if (version !== worksRequestVersion) return
    if (!append) {
      works.value = []
      worksError.value =
        cause instanceof Error && cause.message ? cause.message : '加载失败，请重试'
    } else {
      ElMessage.error('加载更多失败，请重试')
    }
  } finally {
    if (version !== worksRequestVersion) return
    if (append) loadingMore.value = false
    else loading.value = false
    await nextTick()
    scheduleViewportMeasure()
    void fillViewportIfNeeded()
  }
}

/** 列表区不足一屏时继续拉取 */
async function fillViewportIfNeeded() {
  const el = communityFeedRef.value
  if (!el || !hasMore.value || loading.value || loadingMore.value) return
  if (el.scrollHeight > el.clientHeight + 120) return
  await loadMoreWorks()
}

function reloadWorks() {
  nextCursor.value = null
  return loadWorksPage(null, 'replace')
}

function loadMoreWorks() {
  if (!nextCursor.value || loading.value || loadingMore.value) return
  return loadWorksPage(nextCursor.value, 'append')
}

function retryWorks() {
  return reloadWorks()
}

const orderedWorks = computed(() =>
  [...works.value].sort((a, b) => {
    const aSort = a.sort ?? 0
    const bSort = b.sort ?? 0
    if (aSort > 0 || bSort > 0) return (aSort || Number.MAX_SAFE_INTEGER) - (bSort || Number.MAX_SAFE_INTEGER)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  }),
)

/** 分类/精选/搜索为当前已加载范围内筛选。 */
const visibleWorks = computed(() => {
  let list = orderedWorks.value
  if (workFilter.value === 'featured') list = list.filter((item) => item.featured)
  else if (workFilter.value !== 'all') list = list.filter((item) => item.category?.id === workFilter.value)
  const keyword = workQuery.value.trim().toLowerCase()
  if (keyword) {
    list = list.filter((item) =>
      [item.title, item.author?.username ?? '', item.userEmail ?? '', ...(item.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }
  return list
})

const canSortWorks = computed(
  () =>
    workFilter.value === 'all' &&
    !workQuery.value.trim() &&
    !hasMore.value &&
    works.value.length > 0 &&
    !workOrderSaving.value,
)

/* 与用户端提示词页同款：最短列瀑布流 + 像素高度占位 + measureFromEvent */
const masonryItems = computed(() =>
  visibleWorks.value.map((item, index) => ({
    key: item.id,
    item,
    index,
    aspect: '3 / 4',
    cover: workImageUrl(item),
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
  bodyHeight: 74,
  mediaInset: 8,
  minColumnWidth: 168,
  maxColumns: 6,
  overscan: 960,
  getAspect: (entry) => entry.aspect,
  scrollParent: communityFeedRef,
})

function imageLoadingMode(index: number) {
  return index < Math.max(6, columnCount.value * 2) ? 'eager' : 'lazy'
}

function onCommunityScroll() {
  if (!isGridScrolling.value) isGridScrolling.value = true
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    isGridScrolling.value = false
  }, 140)

  scheduleViewportMeasure()

  const el = communityFeedRef.value
  if (!el || !hasMore.value || loading.value || loadingMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
    void loadMoreWorks()
  }
}

function openSortDialog() {
  if (!canSortWorks.value) {
    ElMessage.warning(hasMore.value ? '请先滚动加载完全部作品后再排序' : '请清除筛选后再排序')
    return
  }
  sortList.value = [...orderedWorks.value]
  sortOpen.value = true
}

async function persistWorkOrder() {
  if (!canSortWorks.value) return
  const ordered = [...sortList.value]
  const sortByID = new Map(ordered.map((item, index) => [item.id, (index + 1) * 10]))
  works.value = works.value.map((item) => ({ ...item, sort: sortByID.get(item.id) ?? item.sort }))
  workOrderSaving.value = true
  try {
    await request('/api/v1/admin/gallery/submissions/order', {
      method: 'PATCH',
      body: { ids: ordered.map((item) => item.id) },
    })
    sortOpen.value = false
    ElMessage.success('作品顺序已更新')
  } catch {
    await reloadWorks()
  } finally {
    workOrderSaving.value = false
  }
}

const selectedWorkIds = ref<Set<string>>(new Set())
const workSelectionMode = ref(false)
const selectedCount = computed(() => selectedWorkIds.value.size)
const featuredCount = computed(() => works.value.filter((item) => item.featured).length)
function worksInCategory(id: string) {
  return works.value.filter((item) => item.category?.id === id).length
}
const allVisibleSelected = computed(
  () => visibleWorks.value.length > 0 && visibleWorks.value.every((item) => selectedWorkIds.value.has(item.id)),
)

function setWorkSelected(item: CommunityWork, selected: boolean) {
  const next = new Set(selectedWorkIds.value)
  if (selected) next.add(item.id)
  else next.delete(item.id)
  selectedWorkIds.value = next
}

function toggleSelectVisible() {
  const next = new Set(selectedWorkIds.value)
  if (allVisibleSelected.value) visibleWorks.value.forEach((item) => next.delete(item.id))
  else visibleWorks.value.forEach((item) => next.add(item.id))
  selectedWorkIds.value = next
}

function clearSelection() {
  selectedWorkIds.value = new Set()
}

function enterWorkSelectionMode() {
  workSelectionMode.value = true
}

function exitWorkSelectionMode() {
  workSelectionMode.value = false
  clearSelection()
}

watch(works, (list) => {
  const valid = new Set(list.map((item) => item.id))
  selectedWorkIds.value = new Set([...selectedWorkIds.value].filter((id) => valid.has(id)))
})

function categoryLabelOf(item: CommunityWork) {
  return item.category?.name ?? '未分类'
}

/* ---------- 全屏预览 ---------- */

const previewUrls = ref<string[]>([])
const previewVisible = ref(false)

function openPreview(item: CommunityWork) {
  const list = item.mediaUrls?.length
    ? item.mediaUrls
    : item.coverUrl
      ? [item.coverUrl]
      : []
  if (!list.length) return
  previewUrls.value = list
  previewVisible.value = true
}

/* ---------- 作品详情 ---------- */

const editOpen = ref(false)
const editSaving = ref(false)
const editTarget = ref<CommunityWork | null>(null)
const editForm = reactive({ featured: false, categoryId: '', tags: [] as string[] })

function openEdit(item: CommunityWork) {
  editTarget.value = item
  editForm.featured = item.featured === true
  editForm.categoryId = item.category?.id ?? ''
  editForm.tags = [...(item.tags ?? [])]
  editOpen.value = true
}

function mergeWork(id: string, patch: Partial<CommunityWork>) {
  works.value = works.value.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

function cleanTagValues(values: string[]) {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase()
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function saveCurate() {
  const target = editTarget.value
  if (!target || editSaving.value) return
  const tags = cleanTagValues(editForm.tags)
  editSaving.value = true
  try {
    await request(`/api/v1/admin/gallery/submissions/${target.id}/curation`, {
      method: 'PUT',
      body: {
        featured: editForm.featured,
        categoryId: editForm.categoryId || null,
        tags,
      },
    })
    const category = categories.value.find((row) => row.id === editForm.categoryId)
    mergeWork(target.id, {
      featured: editForm.featured,
      category: category ? { id: category.id, name: category.name } : null,
      tags,
    })
    editOpen.value = false
    ElMessage.success('作品详情已更新')
  } finally {
    editSaving.value = false
  }
}

/* ---------- 批量编辑 ---------- */

const batchOpen = ref(false)
const batchSaving = ref(false)
const batchForm = reactive({
  setFeatured: false,
  featured: true,
  setCategory: false,
  categoryId: '',
  setTags: false,
  tagMode: 'add' as 'replace' | 'add' | 'remove',
  tags: [] as string[],
})

function openBatchEdit() {
  if (!workSelectionMode.value || !selectedCount.value) return
  batchForm.setFeatured = false
  batchForm.featured = true
  batchForm.setCategory = false
  batchForm.categoryId = ''
  batchForm.setTags = false
  batchForm.tagMode = 'add'
  batchForm.tags = []
  batchOpen.value = true
}

function mergeLocalTags(current: string[] = [], changed: string[], mode: 'replace' | 'add' | 'remove') {
  if (mode === 'replace') return [...changed]
  const keys = new Set(changed.map((tag) => tag.toLocaleLowerCase()))
  if (mode === 'remove') return current.filter((tag) => !keys.has(tag.toLocaleLowerCase()))
  const next = [...current]
  const seen = new Set(current.map((tag) => tag.toLocaleLowerCase()))
  changed.forEach((tag) => {
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      next.push(tag)
    }
  })
  return next
}

async function saveBatchEdit() {
  if (batchSaving.value) return
  if (!batchForm.setFeatured && !batchForm.setCategory && !batchForm.setTags) {
    ElMessage.warning('请至少选择一项要更新的内容')
    return
  }
  const ids = [...selectedWorkIds.value]
  const tags = cleanTagValues(batchForm.tags)
  const body: Record<string, unknown> = { ids }
  if (batchForm.setFeatured) body.featured = batchForm.featured
  if (batchForm.setCategory) body.categoryId = batchForm.categoryId || null
  if (batchForm.setTags) {
    body.tags = tags
    body.tagMode = batchForm.tagMode
  }
  batchSaving.value = true
  try {
    await request('/api/v1/admin/gallery/submissions', { method: 'PATCH', body })
    const category = categories.value.find((row) => row.id === batchForm.categoryId)
    works.value = works.value.map((item) => {
      if (!selectedWorkIds.value.has(item.id)) return item
      const patch: Partial<CommunityWork> = {}
      if (batchForm.setFeatured) patch.featured = batchForm.featured
      if (batchForm.setCategory) patch.category = category ? { id: category.id, name: category.name } : null
      if (batchForm.setTags) patch.tags = mergeLocalTags(item.tags, tags, batchForm.tagMode)
      return { ...item, ...patch }
    })
    batchOpen.value = false
    exitWorkSelectionMode()
    ElMessage.success(`已更新 ${ids.length} 个作品`)
  } finally {
    batchSaving.value = false
  }
}

async function toggleFeatured(item: CommunityWork) {
  if (workOperating.value) return
  workOperating.value = item.id
  const nextValue = item.featured !== true
  try {
    await request(`/api/v1/admin/gallery/submissions/${item.id}/curation`, {
      method: 'PUT',
      body: { featured: nextValue },
    })
    mergeWork(item.id, { featured: nextValue })
    ElMessage.success(nextValue ? '已设为精选' : '已取消精选')
  } finally {
    workOperating.value = ''
  }
}

/* ---------- 分类管理面板 ---------- */

const categories = ref<GalleryCategory[]>([])
const categoryOpen = ref(false)
const categorySaving = ref('')
const categoryFilter = ref<'all' | 'on' | 'off'>('all')
const categoryEditorOpen = ref(false)
const categoryEditorForm = reactive({ name: '', active: true })
const editingCategoryId = ref('')
const editingCategoryName = ref('')

const enabledCategories = computed(() => categories.value.filter((item) => item.active))

const filteredCategories = computed(() => {
  const list =
    categoryFilter.value === 'on'
      ? categories.value.filter((item) => item.active)
      : categoryFilter.value === 'off'
        ? categories.value.filter((item) => !item.active)
        : categories.value
  return [...list].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'))
})

const categoryDragList = ref<GalleryCategory[]>([])

watch(
  filteredCategories,
  (list) => {
    categoryDragList.value = [...list]
  },
  { immediate: true },
)

async function loadCategories() {
  const page = await request<GalleryCategory[] | Page<GalleryCategory>>('/api/v1/admin/gallery/categories').then(
    normalizeList,
  )
  categories.value = page.items
}

async function submitCategoryEditor() {
  const name = categoryEditorForm.name.trim()
  if (!name) {
    ElMessage.warning('请填写分类名称')
    return
  }
  categorySaving.value = '__create__'
  try {
    const nextSort = categories.value.reduce((max, item) => Math.max(max, item.sort), 0) + 10
    await request('/api/v1/admin/gallery/categories', {
      method: 'POST',
      body: { name, sort: nextSort, active: categoryEditorForm.active },
    })
    categoryEditorOpen.value = false
    ElMessage.success('分类已创建')
    await loadCategories()
  } finally {
    categorySaving.value = ''
  }
}

async function patchCategory(item: GalleryCategory, body: Partial<GalleryCategory>) {
  categorySaving.value = item.id
  try {
    await request(`/api/v1/admin/gallery/categories/${item.id}`, { method: 'PATCH', body })
    await loadCategories()
    return true
  } catch {
    await loadCategories()
    return false
  } finally {
    categorySaving.value = ''
  }
}

async function toggleCategoryActive(item: GalleryCategory, value: string | number | boolean) {
  const nextValue = value === true
  const ok = await patchCategory(item, { active: nextValue })
  if (ok) ElMessage.success(nextValue ? '分类已启用' : '分类已停用')
}

async function removeCategory(item: GalleryCategory) {
  await ElMessageBox.confirm(`删除「${item.name}」后，归属该分类的作品将变为未分类，确认继续？`, '删除分类', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  })
  await request(`/api/v1/admin/gallery/categories/${item.id}`, { method: 'DELETE' })
  ElMessage.success('分类已删除')
  await loadCategories()
}

async function startEditCategoryName(item: GalleryCategory) {
  if (categorySaving.value) return
  editingCategoryId.value = item.id
  editingCategoryName.value = item.name
  await nextTick()
  const input = document.querySelector(
    `.cm-card[data-key="${CSS.escape(item.id)}"] .cm-card__name-input input`,
  ) as HTMLInputElement | null
  input?.focus()
  input?.select()
}

async function commitCategoryName(item: GalleryCategory) {
  if (editingCategoryId.value !== item.id) return
  const name = editingCategoryName.value.trim()
  editingCategoryId.value = ''
  if (!name) {
    ElMessage.warning('名称不能为空')
    return
  }
  if (name === item.name) return
  await patchCategory(item, { name })
}

async function persistCategoryOrder() {
  if (categoryFilter.value !== 'all' || categorySaving.value) return
  const planned = categoryDragList.value.map((item, index) => ({ item, sort: (index + 1) * 10 }))
  const dirty = planned.filter(({ item, sort }) => item.sort !== sort)
  if (!dirty.length) return
  categorySaving.value = '__order__'
  try {
    await Promise.all(
      dirty.map(({ item, sort }) =>
        request(`/api/v1/admin/gallery/categories/${item.id}`, { method: 'PATCH', body: { sort } }),
      ),
    )
  } finally {
    categorySaving.value = ''
    await loadCategories()
  }
}

/* ---------- 创作者面板 ---------- */

const authorsOpen = ref(false)
const authors = ref<CommunityAuthor[]>([])
const authorsLoading = ref(false)
const authorQuery = ref('')
const unbanning = ref('')

const authorSummary = computed(() => ({
  creators: authors.value.length,
  submissions: authors.value.reduce((sum, item) => sum + item.submissions, 0),
  approved: authors.value.reduce((sum, item) => sum + item.approved, 0),
  banned: authors.value.filter(isBanned).length,
}))

function authorInitial(row: CommunityAuthor) {
  return (row.username || row.email || '?').trim().slice(0, 1).toUpperCase()
}

async function loadAuthors() {
  authorsLoading.value = true
  try {
    const page = await request<CommunityAuthor[] | Page<CommunityAuthor>>('/api/v1/admin/gallery/authors', {
      query: { search: authorQuery.value.trim() },
    }).then(normalizeList)
    authors.value = page.items
  } finally {
    authorsLoading.value = false
  }
}

function isBanned(row: CommunityAuthor) {
  if (!row.bannedUntil) return false
  return new Date(row.bannedUntil).getTime() > Date.now()
}

async function unbanAuthor(row: CommunityAuthor) {
  unbanning.value = row.userId
  try {
    await request(`/api/v1/admin/gallery/users/${row.userId}/ban`, { method: 'DELETE' })
    ElMessage.success('已解除禁投')
    await loadAuthors()
  } finally {
    unbanning.value = ''
  }
}

/* ---------- 社区设置 ---------- */

const settings = reactive<GallerySettings>({ submissionEnabled: true, autoApprove: false, dailyLimit: 10 })
const settingsLoaded = ref(false)
const settingsSaving = ref(false)

async function loadSettings() {
  const data = await request<GallerySettings>('/api/v1/admin/gallery/settings')
  settings.submissionEnabled = data.submissionEnabled
  settings.autoApprove = data.autoApprove
  settings.dailyLimit = data.dailyLimit
  settingsLoaded.value = true
}

async function saveSettings(message: string) {
  if (!settingsLoaded.value) return
  settingsSaving.value = true
  try {
    await request('/api/v1/admin/gallery/settings', {
      method: 'PUT',
      body: {
        submissionEnabled: settings.submissionEnabled,
        autoApprove: settings.autoApprove,
        dailyLimit: settings.dailyLimit,
      },
    })
    ElMessage.success(message)
  } catch {
    await loadSettings()
  } finally {
    settingsSaving.value = false
  }
}

onMounted(() => {
  void reloadWorks()
  void loadCategories().catch(() => undefined)
  void loadAuthors().catch(() => undefined)
  void loadSettings().catch(() => undefined)
})

onUnmounted(() => {
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
})
</script>

<template>
  <div class="community-ops-page">
    <header class="community-toolbar">
      <div class="community-tabs" role="tablist" aria-label="作品分类">
        <button
          type="button"
          role="tab"
          class="community-tab"
          :class="{ 'is-active': workFilter === 'all' }"
          :aria-selected="workFilter === 'all'"
          @click="workFilter = 'all'"
        >
          全部
          <em class="tnum">{{ works.length }}</em>
        </button>
        <button
          type="button"
          role="tab"
          class="community-tab"
          :class="{ 'is-active': workFilter === 'featured' }"
          :aria-selected="workFilter === 'featured'"
          @click="workFilter = 'featured'"
        >
          精选
          <em class="tnum">{{ featuredCount }}</em>
        </button>
        <button
          v-for="category in enabledCategories"
          :key="category.id"
          type="button"
          role="tab"
          class="community-tab"
          :class="{ 'is-active': workFilter === category.id }"
          :aria-selected="workFilter === category.id"
          @click="workFilter = category.id"
        >
          {{ category.name }}
          <em class="tnum">{{ worksInCategory(category.id) }}</em>
        </button>
      </div>

      <div class="community-toolbar__right">
        <el-input
          v-model="workQuery"
          :prefix-icon="Search"
          clearable
          class="community-search"
          placeholder="搜索标题、作者或标签"
        />
        <div class="community-setting-pill" :class="{ 'is-on': settings.submissionEnabled }">
          <span>开放投稿</span>
          <el-switch
            v-model="settings.submissionEnabled"
            :loading="settingsSaving"
            size="small"
            @change="saveSettings(settings.submissionEnabled ? '社区投稿已开启' : '社区投稿已关闭')"
          />
        </div>
        <div class="community-setting-pill" :class="{ 'is-on': settings.autoApprove }">
          <span>自动过审</span>
          <el-switch
            v-model="settings.autoApprove"
            :loading="settingsSaving"
            size="small"
            @change="saveSettings(settings.autoApprove ? '新投稿将自动过审' : '已恢复人工审核')"
          />
        </div>
        <div class="community-setting-pill is-limit">
          <span>每日限额</span>
          <el-input-number
            v-model="settings.dailyLimit"
            :min="0"
            :max="999"
            size="small"
            :controls="false"
            @change="saveSettings('每日投稿限额已更新')"
          />
        </div>
        <el-button :icon="CollectionTag" @click="categoryOpen = true">
          分类
        </el-button>
        <el-button :icon="User" @click="authorsOpen = true">
          创作者
        </el-button>
        <el-button
          :icon="Rank"
          :disabled="!canSortWorks || workOrderSaving"
          @click="openSortDialog"
        >
          排序
        </el-button>
        <el-button
          :type="workSelectionMode ? 'primary' : 'default'"
          :icon="Check"
          @click="workSelectionMode ? exitWorkSelectionMode() : enterWorkSelectionMode()"
        >
          {{ workSelectionMode ? '退出多选' : '多选' }}
        </el-button>
      </div>
    </header>

    <div v-if="workSelectionMode" class="community-selection-bar">
      <el-checkbox :model-value="allVisibleSelected" @change="toggleSelectVisible">
        {{ allVisibleSelected ? '取消全选' : '全选当前结果' }}
      </el-checkbox>
      <span class="community-selection-bar__count">已选 {{ selectedCount }} 个作品</span>
      <div class="community-selection-bar__actions">
        <el-button text :disabled="!selectedCount" @click="clearSelection">清空选择</el-button>
        <el-button
          type="primary"
          :icon="Check"
          :disabled="!selectedCount"
          @click="openBatchEdit"
        >
          批量编辑
        </el-button>
      </div>
    </div>

    <ListError :error="worksError" :loading="loading" @retry="retryWorks" />

    <div class="community-board">
      <div
        ref="communityFeedRef"
        v-loading="loading && works.length > 0"
        class="community-feed"
        :class="{ 'is-scrolling': isGridScrolling }"
        @scroll.passive="onCommunityScroll"
      >
        <div v-if="loading && !works.length" class="community-grid__loading">正在加载作品…</div>

        <div v-else-if="!visibleWorks.length" class="community-empty">
          <el-icon><CollectionTag /></el-icon>
          <strong>{{ works.length ? '没有匹配的作品' : '还没有社区作品' }}</strong>
          <span>{{ works.length ? '调整分类或搜索后再试' : '过审作品会显示在这里' }}</span>
        </div>

        <div
          v-else
          ref="masonryRef"
          class="community-masonry"
          :style="{ height: `${masonryHeight}px` }"
        >
          <CommunityWorkCard
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
            :operating="workOperating === entry.item.id"
            :category-label="categoryLabelOf(entry.item)"
            :selected="selectedWorkIds.has(entry.item.id)"
            :selection-mode="workSelectionMode"
            :media-height="entry.mediaHeight"
            :card-width="entry.width"
            :image-loading="imageLoadingMode(entry.index)"
            @edit="openEdit"
            @feature="toggleFeatured"
            @preview="openPreview"
            @select="setWorkSelected"
            @measure="(item, event) => measureFromEvent(item.id, event)"
          />
        </div>

        <div v-if="visibleWorks.length" class="community-load-status" :class="{ 'is-loading': loadingMore }">
          <span v-if="loadingMore">正在加载更多…</span>
          <span v-else-if="!hasMore">已加载全部 {{ works.length }} 条</span>
        </div>
      </div>
    </div>

    <el-image-viewer
      v-if="previewVisible"
      :url-list="previewUrls"
      teleported
      hide-on-click-modal
      @close="previewVisible = false"
    />

    <AdminDialog
      v-model="sortOpen"
      title="调整作品顺序"
      subtitle="拖动缩略图排序，保存后同步到社区展示"
      :icon="Rank"
      width="min(520px, 94vw)"
      nested-scroll
      confirm-text="保存顺序"
      :confirm-loading="workOrderSaving"
      :confirm-disabled="!sortList.length"
      @confirm="persistWorkOrder"
    >
      <draggable
        v-model="sortList"
        item-key="id"
        handle=".community-sort-handle"
        :animation="180"
        ghost-class="is-work-ghost"
        drag-class="is-work-drag"
        class="community-sort-list"
      >
        <template #item="{ element: item, index }">
          <article class="community-sort-row">
            <span class="community-sort-index">{{ index + 1 }}</span>
            <button type="button" class="community-sort-handle community-sort-cover" :aria-label="`拖动第 ${index + 1} 项`">
              <img v-if="workImageUrl(item)" :src="workImageUrl(item)" :alt="item.title || '作品'" />
            </button>
          </article>
        </template>
      </draggable>
    </AdminDialog>

    <AdminDialog
      v-model="categoryOpen"
      panel-class="community-manage-dialog"
      title="分类管理"
      subtitle="启停、改名与拖动排序；删除后作品变为未分类"
      :icon="CollectionTag"
      width="720px"
      hide-footer
      nested-scroll
    >
      <div class="cm-dialog">
        <div class="cm-toolbar">
          <div class="cm-filters">
            <button
              type="button"
              class="cm-filter"
              :class="{ 'is-active': categoryFilter === 'all' }"
              @click="categoryFilter = 'all'"
            >
              全部 {{ categories.length }}
            </button>
            <button
              type="button"
              class="cm-filter"
              :class="{ 'is-active': categoryFilter === 'on' }"
              @click="categoryFilter = 'on'"
            >
              启用 {{ enabledCategories.length }}
            </button>
            <button
              type="button"
              class="cm-filter"
              :class="{ 'is-active': categoryFilter === 'off' }"
              @click="categoryFilter = 'off'"
            >
              停用 {{ categories.length - enabledCategories.length }}
            </button>
          </div>
          <el-button
            type="primary"
            :icon="Plus"
            @click="((categoryEditorForm.name = ''), (categoryEditorForm.active = true), (categoryEditorOpen = true))"
          >
            新增
          </el-button>
        </div>

        <p class="cm-tip">点击名称改名；停用后前台不再展示。在「全部」下可拖动手柄排序。</p>

        <div class="cm-list">
          <el-empty v-if="!categoryDragList.length" description="暂无分类" />
          <draggable
            v-else
            v-model="categoryDragList"
            class="cm-list__stack"
            item-key="id"
            handle=".cm-card__handle"
            :animation="180"
            :disabled="categoryFilter !== 'all' || Boolean(categorySaving)"
            ghost-class="is-ghost"
            drag-class="is-drag"
            @end="persistCategoryOrder"
          >
            <template #item="{ element: item }">
              <article
                class="cm-card"
                :data-key="item.id"
                :class="{ 'is-off': !item.active, 'is-locked': categoryFilter !== 'all' }"
              >
                <button
                  type="button"
                  class="cm-card__handle"
                  :disabled="categoryFilter !== 'all' || Boolean(categorySaving)"
                  title="拖动排序"
                >
                  <el-icon :size="14"><Rank /></el-icon>
                </button>

                <button
                  type="button"
                  class="cm-card__delete"
                  :disabled="Boolean(categorySaving)"
                  title="删除分类"
                  @click="removeCategory(item)"
                >
                  <el-icon :size="13"><Delete /></el-icon>
                </button>

                <div class="cm-card__icon">
                  <el-icon :size="22"><CollectionTag /></el-icon>
                </div>

                <div class="cm-card__body">
                  <el-input
                    v-if="editingCategoryId === item.id"
                    v-model="editingCategoryName"
                    class="cm-card__name-input"
                    size="small"
                    maxlength="32"
                    @keyup.enter="commitCategoryName(item)"
                    @keyup.esc="editingCategoryId = ''"
                    @blur="commitCategoryName(item)"
                  />
                  <button v-else type="button" class="cm-card__name" title="点击改名" @click="startEditCategoryName(item)">
                    {{ item.name || '未命名分类' }}
                  </button>
                </div>

                <el-switch
                  :model-value="item.active === true"
                  :loading="categorySaving === item.id"
                  inline-prompt
                  active-text="开"
                  inactive-text="关"
                  @change="(value: string | number | boolean) => toggleCategoryActive(item, value)"
                />
              </article>
            </template>
          </draggable>
        </div>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="categoryEditorOpen"
      panel-class="community-config-editor-dialog"
      title="新增分类"
      :icon="Plus"
      width="420px"
      confirm-text="添加"
      :confirm-loading="Boolean(categorySaving)"
      @confirm="submitCategoryEditor"
    >
      <div class="cm-editor">
        <label>
          <span>显示名称</span>
          <el-input v-model="categoryEditorForm.name" placeholder="如：概念艺术" maxlength="32" />
        </label>
        <label class="is-switch">
          <span>前台可见</span>
          <el-switch v-model="categoryEditorForm.active" />
        </label>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="authorsOpen"
      panel-class="community-authors-dialog"
      title="创作者管理"
      subtitle="查看投稿数据，并解除禁投限制"
      :icon="User"
      width="800px"
      hide-footer
      nested-scroll
    >
      <div class="authors-panel">
        <div class="authors-overview">
          <div>
            <strong class="tnum">{{ authorSummary.creators }}</strong>
            <span>当前创作者</span>
          </div>
          <div>
            <strong class="tnum">{{ authorSummary.submissions }}</strong>
            <span>累计投稿</span>
          </div>
          <div>
            <strong class="tnum">{{ authorSummary.approved }}</strong>
            <span>已通过</span>
          </div>
          <div :class="{ 'is-alert': authorSummary.banned > 0 }">
            <strong class="tnum">{{ authorSummary.banned }}</strong>
            <span>禁投中</span>
          </div>
        </div>

        <div class="authors-toolbar">
          <el-input
            v-model="authorQuery"
            :prefix-icon="Search"
            clearable
            placeholder="搜索创作者名称或邮箱"
            @keyup.enter="loadAuthors"
            @clear="loadAuthors"
          />
          <el-button type="primary" :loading="authorsLoading" @click="loadAuthors">查询</el-button>
        </div>

        <div v-loading="authorsLoading" class="authors-list">
          <div v-if="!authorsLoading && !authors.length" class="authors-empty">
            <el-icon><User /></el-icon>
            <strong>暂无创作者</strong>
            <span>调整搜索后再试</span>
          </div>
          <article
            v-for="row in authors"
            :key="row.userId"
            class="author-row"
            :class="{ 'is-banned': isBanned(row) }"
          >
            <el-avatar class="author-row__avatar" :size="40" :src="row.avatarUrl || undefined">
              {{ authorInitial(row) }}
            </el-avatar>
            <div class="author-row__identity">
              <div class="author-row__name-line">
                <strong>{{ row.username || '未设置昵称' }}</strong>
                <span class="author-row__status" :class="{ 'is-banned': isBanned(row) }">
                  {{ isBanned(row) ? '禁投中' : '正常' }}
                </span>
              </div>
              <small :title="row.email">{{ row.email }}</small>
            </div>
            <div class="author-row__metrics">
              <span>投稿 <strong class="tnum">{{ row.submissions }}</strong></span>
              <span>通过 <strong class="tnum">{{ row.approved }}</strong></span>
              <span>下架 <strong class="tnum">{{ row.removed }}</strong></span>
            </div>
            <div v-if="isBanned(row)" class="author-row__state">
              <small>至 {{ formatTime(row.bannedUntil) }}</small>
              <el-button
                size="small"
                type="warning"
                plain
                :loading="unbanning === row.userId"
                @click="unbanAuthor(row)"
              >
                解除禁投
              </el-button>
            </div>
          </article>
        </div>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="batchOpen"
      panel-class="community-batch-dialog"
      :title="`批量编辑 · ${selectedCount} 个作品`"
      subtitle="勾选需要更新的字段后应用"
      :icon="Check"
      width="600px"
      confirm-text="应用更新"
      :confirm-loading="batchSaving"
      @confirm="saveBatchEdit"
    >
      <div class="community-batch">
        <div class="community-batch__row">
          <el-checkbox v-model="batchForm.setFeatured">更新精选状态</el-checkbox>
          <el-segmented
            v-model="batchForm.featured"
            :disabled="!batchForm.setFeatured"
            :options="[
              { label: '设为精选', value: true },
              { label: '取消精选', value: false },
            ]"
          />
        </div>
        <div class="community-batch__row">
          <el-checkbox v-model="batchForm.setCategory">更新分类</el-checkbox>
          <el-select
            v-model="batchForm.categoryId"
            :disabled="!batchForm.setCategory"
            clearable
            placeholder="未分类"
          >
            <el-option v-for="category in enabledCategories" :key="category.id" :label="category.name" :value="category.id" />
          </el-select>
        </div>
        <div class="community-batch__row is-tags">
          <el-checkbox v-model="batchForm.setTags">更新标签</el-checkbox>
          <el-segmented
            v-model="batchForm.tagMode"
            :disabled="!batchForm.setTags"
            :options="[
              { label: '添加', value: 'add' },
              { label: '移除', value: 'remove' },
              { label: '替换', value: 'replace' },
            ]"
          />
          <el-select
            v-model="batchForm.tags"
            :disabled="!batchForm.setTags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入标签后按回车"
          />
        </div>
      </div>
    </AdminDialog>

    <AdminDialog
      v-model="editOpen"
      panel-class="community-edit-dialog"
      title="作品详情"
      subtitle="调整分类、标签与精选状态"
      width="min(820px, 94vw)"
      nested-scroll
      confirm-text="保存"
      :confirm-loading="editSaving"
      @confirm="saveCurate"
    >
      <div v-if="editTarget" class="community-edit">
        <div class="community-edit__layout">
          <button type="button" class="community-edit__cover" title="打开全屏预览" @click="openPreview(editTarget)">
            <img
              v-if="workImageUrl(editTarget)"
              :src="workImageUrl(editTarget)"
              :alt="editTarget.title"
            />
            <span v-else class="community-edit__empty">无图片</span>
          </button>

          <div class="community-edit__content">
            <div class="community-edit__heading">
              <small>作品标题</small>
              <strong>{{ editTarget.title || '未命名作品' }}</strong>
            </div>
            <dl class="community-edit__meta">
              <div><dt>创作者</dt><dd>{{ editTarget.author?.username || '未设置昵称' }}</dd></div>
              <div><dt>账号</dt><dd>{{ editTarget.userEmail || '—' }}</dd></div>
              <div><dt>投稿时间</dt><dd>{{ formatTime(editTarget.createdAt) }}</dd></div>
              <div><dt>图片数量</dt><dd>{{ editTarget.mediaUrls?.length || 1 }}</dd></div>
            </dl>

            <el-form class="community-edit-form" label-position="top">
              <el-form-item label="分类归属">
                <el-select v-model="editForm.categoryId" clearable placeholder="未分类" style="width: 100%">
                  <el-option
                    v-for="category in enabledCategories"
                    :key="category.id"
                    :label="category.name"
                    :value="category.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="作品标签">
                <el-select
                  v-model="editForm.tags"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="输入标签后按回车，可直接删除已有标签"
                  style="width: 100%"
                />
              </el-form-item>
              <div class="community-edit__featured">
                <div><strong>精选展示</strong><small>在社区中突出展示该作品</small></div>
                <el-switch v-model="editForm.featured" />
              </div>
            </el-form>
          </div>
        </div>
      </div>
    </AdminDialog>
  </div>
</template>

<style scoped lang="scss">
.community-ops-page {
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

.community-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.community-tabs {
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

.community-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

  em {
    color: var(--ink-3);
    font-size: 12px;
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

.community-toolbar__right {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.community-search {
  width: 220px;
}

.community-setting-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  background: var(--surface-2);

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 28%, var(--border));
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-limit :deep(.el-input-number) {
    width: 56px;
  }

  &.is-limit :deep(.el-input__inner) {
    text-align: center;
  }
}

.community-selection-bar {
  display: flex;
  flex: 0 0 auto;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 14px;
  background: var(--accent-soft);
  font-size: 12px;
  font-weight: 650;
}

.community-selection-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.community-selection-bar__count {
  margin-right: auto;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.community-board {
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

.community-feed {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px;
}

.community-feed.is-scrolling :deep(.community-card) {
  pointer-events: none;
  box-shadow: none;
  transition: none;
}

.community-feed.is-scrolling :deep(.community-cover img) {
  transform: none;
  transition: none;
}

.community-grid__loading,
.community-empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ink-3);
  text-align: center;
}

.community-empty {
  .el-icon {
    font-size: 30px;
  }

  strong {
    color: var(--ink);
  }

  span {
    max-width: 280px;
    font-size: 12px;
    line-height: 1.45;
  }
}

.community-masonry {
  position: relative;
  width: 100%;
}

.community-masonry__item {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

.community-load-status {
  display: grid;
  place-items: center;
  min-height: 40px;
  padding: 8px 0 4px;
  color: var(--ink-3);
  font-size: 12px;
}

.community-load-status.is-loading {
  color: var(--accent-ink);
}

.community-card-skeleton {
  display: grid;
  gap: 8px;
  padding: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-2);

  > div {
    height: 168px;
    border-radius: 12px;
    background: linear-gradient(90deg, var(--el-fill-color-light), var(--el-fill-color), var(--el-fill-color-light));
    background-size: 200% 100%;
    animation: community-shimmer 1.2s linear infinite;

    &.is-variant-2 {
      height: 204px;
    }

    &.is-variant-3 {
      height: 148px;
    }
  }

  footer {
    display: grid;
    grid-template-rows: 18px 16px 16px;
    gap: 4px;
    padding: 2px;
  }

  footer span,
  footer small,
  footer em {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--el-fill-color);
  }

  footer span {
    width: 72%;
  }

  footer small {
    width: 48%;
  }

  footer em {
    width: 36%;
  }
}

.community-sort-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;
  max-height: min(60vh, 520px);
  overflow: auto;
  padding: 4px 2px;
}

.community-sort-row {
  display: grid;
  gap: 6px;
  justify-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.community-sort-handle {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.community-sort-index {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.community-sort-cover {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
}

.is-work-ghost {
  opacity: 0.35;

  .community-sort-cover {
    border-style: dashed;
  }
}

.is-work-drag {
  .community-sort-cover {
    box-shadow: 0 14px 32px rgb(15 23 42 / 18%);
  }
}

@keyframes community-shimmer {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
}

@media (max-width: 900px) {
  .community-toolbar__right {
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }

  .community-search {
    width: 100%;
    max-width: none;
  }
}
</style>

<style lang="scss">
/* 弹窗为 append-to-body，样式需全局作用域（沿用旧版 cm-* 设计） */
.community-manage-dialog,
.community-config-editor-dialog,
.community-authors-dialog,
.community-batch-dialog,
.community-edit-dialog {
  --community-dialog-line: var(--border);
}

.community-manage-dialog {
  .cm-dialog {
    display: grid;
    gap: 10px;
  }

  .cm-tip {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .cm-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .cm-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .cm-filter {
    min-height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;

    &.is-active {
      border-color: transparent;
      background: var(--accent);
      color: #fff;
    }
  }

  .cm-list {
    max-height: min(56vh, 560px);
    overflow: auto;
  }

  .cm-list__stack {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .cm-card {
    position: relative;
    display: grid;
    gap: 10px;
    justify-items: center;
    padding: 16px 12px 12px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    text-align: center;

    &.is-off {
      opacity: 0.68;
    }

    &.is-ghost {
      opacity: 0.45;
      border-style: dashed;
    }

    &.is-drag {
      box-shadow: 0 10px 24px color-mix(in srgb, #000 12%, transparent);
    }
  }

  .cm-card__handle,
  .cm-card__delete {
    position: absolute;
    top: 6px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--el-text-color-secondary);

    &:disabled {
      cursor: not-allowed;
      opacity: 0.35;
    }
  }

  .cm-card__handle {
    left: 6px;
    cursor: grab;

    &:hover:not(:disabled) {
      background: var(--el-fill-color-light);
      color: var(--el-color-primary);
    }

    &:active:not(:disabled) {
      cursor: grabbing;
    }
  }

  .cm-card__delete {
    right: 6px;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--el-color-danger-light-9);
      color: var(--el-color-danger);
    }
  }

  .cm-card__icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  .cm-card__body {
    display: grid;
    width: 100%;
    min-width: 0;
  }

  .cm-card__name {
    display: block;
    overflow: hidden;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--el-text-color-primary);
    font-size: 13px;
    font-weight: 680;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;

    &:hover {
      color: var(--el-color-primary);
    }
  }

  .cm-card__name-input {
    width: 100%;
  }

  @media (max-width: 900px) {
    .cm-list__stack {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}

.community-config-editor-dialog {
  .cm-editor {
    display: grid;
    gap: 12px;

    > label {
      display: grid;
      gap: 6px;

      > span {
        color: var(--el-text-color-secondary);
        font-size: 12px;
        font-weight: 650;
      }

      &.is-switch {
        grid-template-columns: 1fr auto;
        align-items: center;
      }
    }
  }
}

.community-authors-dialog {
  .authors-panel {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 12px;
  }

  .authors-overview {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;

    > div {
      display: grid;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface-2);

      strong {
        color: var(--ink);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.15;
      }

      span {
        color: var(--ink-3);
        font-size: 12px;
      }

      &.is-alert {
        border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
        background: var(--danger-soft);

        strong {
          color: var(--danger);
        }
      }
    }
  }

  .authors-toolbar {
    display: flex;
    flex: 0 0 auto;
    gap: 8px;

    .el-input {
      flex: 1;
    }
  }

  .authors-list {
    display: grid;
    flex: 1 1 auto;
    align-content: start;
    gap: 8px;
    min-height: 180px;
    overflow: auto;
  }

  .authors-empty {
    display: grid;
    min-height: 180px;
    place-content: center;
    justify-items: center;
    gap: 6px;
    color: var(--ink-3);
    text-align: center;

    .el-icon {
      font-size: 28px;
    }

    strong {
      color: var(--ink);
    }

    span {
      font-size: 12px;
    }
  }

  .author-row {
    display: grid;
    grid-template-columns: 40px minmax(160px, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-2);

    &.is-banned {
      border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
      background: var(--danger-soft);
    }
  }

  .author-row__avatar {
    flex-shrink: 0;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-size: 14px;
    font-weight: 700;
  }

  .author-row__identity {
    min-width: 0;

    > small {
      display: block;
      overflow: hidden;
      margin-top: 3px;
      color: var(--ink-3);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .author-row__name-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    strong {
      overflow: hidden;
      color: var(--ink);
      font-size: 14px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .author-row__status {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    min-height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--success-soft);
    color: var(--success);
    font-size: 11px;
    font-weight: 700;

    &.is-banned {
      background: var(--surface);
      color: var(--danger);
    }
  }

  .author-row__metrics {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;

    > span {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      min-height: 24px;
      padding: 0 8px;
      border-radius: var(--radius-pill);
      background: var(--surface);
      color: var(--ink-3);
      font-size: 12px;

      strong {
        color: var(--ink);
        font-size: 13px;
        font-weight: 700;
      }
    }
  }

  .author-row__state {
    display: grid;
    justify-items: end;
    gap: 4px;

    > small {
      color: var(--danger);
      font-size: 11px;
    }
  }
}

.community-batch-dialog {
  .community-batch {
    display: grid;
    gap: 8px;
  }

  .community-batch__row {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-height: 58px;
    padding: 10px 12px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 9px;
    background: var(--surface-2);

    &.is-tags {
      align-items: start;

      .el-select {
        grid-column: 2;
        width: 100%;
      }
    }
  }

}

.community-edit-dialog {
  .community-edit {
    min-width: 0;
  }

  .community-edit__layout {
    display: grid;
    grid-template-columns: minmax(250px, 0.9fr) minmax(320px, 1.1fr);
    gap: 18px;
  }

  .community-edit__cover {
    display: grid;
    place-items: center;
    min-height: 360px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--community-dialog-line);
    border-radius: 12px;
    background: var(--surface-2);
    cursor: zoom-in;

    img {
      display: block;
      width: 100%;
      height: 100%;
      max-height: 420px;
      object-fit: contain;
    }
  }

  .community-edit__empty {
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 300px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .community-edit__content {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 12px;
  }

  .community-edit__heading {
    display: grid;
    gap: 3px;

    small {
      color: var(--ink-3);
      font-size: 10px;
      font-weight: 650;
    }

    strong {
      overflow: hidden;
      color: var(--ink);
      font-size: 16px;
      line-height: 1.45;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .community-edit__meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    overflow: hidden;
    margin: 0;
    border: 1px solid var(--community-dialog-line);
    border-radius: 8px;
    background: var(--community-dialog-line);

    > div {
      min-width: 0;
      padding: 8px 10px;
      background: var(--surface-2);
    }

    dt {
      color: var(--ink-3);
      font-size: 10px;
    }

    dd {
      overflow: hidden;
      margin: 2px 0 0;
      color: var(--ink);
      font-size: 12px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .community-edit-form {
    min-width: 0;

    .el-form-item {
      margin-bottom: 12px;
    }
  }

  .community-edit__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .community-edit__featured {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 11px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 8px;

    > div {
      display: grid;
      gap: 2px;

      strong {
        font-size: 12px;
      }

      small {
        color: var(--ink-3);
        font-size: 10px;
      }
    }
  }

  @media (max-width: 900px) {
    .community-edit__layout,
    .community-edit__grid {
      grid-template-columns: 1fr;
    }

    .community-edit__cover {
      min-height: 240px;
    }
  }
}
</style>
