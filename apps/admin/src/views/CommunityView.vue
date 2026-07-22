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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, CollectionTag, Delete, Plus, Rank, Search, User } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import { request, normalizeList, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
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

/* ---------- 作品管理 ---------- */

const workQuery = ref('')
const workFilter = ref('all') // all | featured | 分类 id
const workOperating = ref('')
const workOrderSaving = ref(false)

const {
  items: works,
  loading,
  error: worksError,
  hasPrev,
  hasNext,
  reset: reloadWorks,
  next,
  prev,
  retry: retryWorks,
} = usePagedList<CommunityWork>((cursor) =>
  request<CommunityWork[] | Page<CommunityWork>>('/api/admin/gallery/submissions', {
    query: { status: 'approved', limit: 100, cursor },
  }).then(normalizeList),
)

const orderedWorks = computed(() =>
  [...works.value].sort((a, b) => {
    const aSort = a.sort ?? 0
    const bSort = b.sort ?? 0
    if (aSort > 0 || bSort > 0) return (aSort || Number.MAX_SAFE_INTEGER) - (bSort || Number.MAX_SAFE_INTEGER)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  }),
)

/** 分类/精选/搜索为当前加载范围内筛选。 */
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

const workDragList = ref<CommunityWork[]>([])
const canDragWorks = computed(
  () => workFilter.value === 'all' && !workQuery.value.trim() && !hasPrev.value && !hasNext.value && !workOrderSaving.value,
)

watch(
  visibleWorks,
  (list) => {
    workDragList.value = [...list]
  },
  { immediate: true },
)

async function persistWorkOrder() {
  if (!canDragWorks.value) return
  const ordered = [...workDragList.value]
  const sortByID = new Map(ordered.map((item, index) => [item.id, (index + 1) * 10]))
  works.value = works.value.map((item) => ({ ...item, sort: sortByID.get(item.id) ?? item.sort }))
  workOrderSaving.value = true
  try {
    await request('/api/admin/gallery/submissions/reorder', {
      method: 'POST',
      body: { ids: ordered.map((item) => item.id) },
    })
    ElMessage.success('作品顺序已更新')
  } catch {
    await reloadWorks()
  } finally {
    workOrderSaving.value = false
  }
}

const selectedWorkIds = ref<Set<string>>(new Set())
const selectedCount = computed(() => selectedWorkIds.value.size)
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
  const list = item.mediaUrls?.length ? item.mediaUrls : item.coverUrl ? [item.coverUrl] : []
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
    await request(`/api/admin/gallery/submissions/${target.id}/curate`, {
      method: 'POST',
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
  if (!selectedCount.value) return
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
    await request('/api/admin/gallery/submissions/batch-curate', { method: 'POST', body })
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
    clearSelection()
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
    await request(`/api/admin/gallery/submissions/${item.id}/curate`, {
      method: 'POST',
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
  const page = await request<GalleryCategory[] | Page<GalleryCategory>>('/api/admin/gallery/categories').then(
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
    await request('/api/admin/gallery/categories', {
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
    await request(`/api/admin/gallery/categories/${item.id}`, { method: 'PATCH', body })
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
  await request(`/api/admin/gallery/categories/${item.id}`, { method: 'DELETE' })
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
        request(`/api/admin/gallery/categories/${item.id}`, { method: 'PATCH', body: { sort } }),
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
    const page = await request<CommunityAuthor[] | Page<CommunityAuthor>>('/api/admin/gallery/authors', {
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
    await request(`/api/admin/gallery/users/${row.userId}/unban`, { method: 'POST' })
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
  const data = await request<GallerySettings>('/api/admin/gallery/settings')
  settings.submissionEnabled = data.submissionEnabled
  settings.autoApprove = data.autoApprove
  settings.dailyLimit = data.dailyLimit
  settingsLoaded.value = true
}

async function saveSettings(message: string) {
  if (!settingsLoaded.value) return
  settingsSaving.value = true
  try {
    await request('/api/admin/gallery/settings', {
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
</script>

<template>
  <div class="community-ops-page">
    <div class="ops-toolbar-panel">
      <div class="community-toolbar">
        <div class="community-toolbar__left">
          <strong>社区管理</strong>
        </div>
        <div class="community-toolbar__actions">
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
          <button type="button" class="community-config-btn is-category" @click="categoryOpen = true">
            <el-icon :size="15"><CollectionTag /></el-icon>
            <span>分类</span>
            <em v-if="categories.length">{{ categories.length }}</em>
          </button>
          <button type="button" class="community-config-btn is-author" @click="authorsOpen = true">
            <el-icon :size="15"><User /></el-icon>
            <span>创作者</span>
            <em v-if="authors.length">{{ authors.length }}</em>
          </button>
        </div>
      </div>
    </div>

    <div class="community-pane">
      <div class="community-pane__bar">
        <div class="community-filters">
          <button
            type="button"
            class="community-filter"
            :class="{ 'is-active': workFilter === 'all' }"
            @click="workFilter = 'all'"
          >
            全部作品
          </button>
          <button
            type="button"
            class="community-filter"
            :class="{ 'is-active': workFilter === 'featured' }"
            @click="workFilter = 'featured'"
          >
            ★ 精选
          </button>
          <button
            v-for="category in enabledCategories"
            :key="category.id"
            type="button"
            class="community-filter"
            :class="{ 'is-active': workFilter === category.id }"
            @click="workFilter = category.id"
          >
            {{ category.name }}
          </button>
        </div>
        <div class="community-bar-aside">
          <label class="community-search">
            <el-icon class="community-search__icon" :size="15"><Search /></el-icon>
            <el-input v-model="workQuery" clearable placeholder="搜索标题、作者、邮箱或标签" />
          </label>
        </div>
      </div>

      <div class="community-selection-bar" :class="{ 'has-selection': selectedCount > 0 }">
        <div class="community-selection-bar__left">
          <el-checkbox :model-value="allVisibleSelected" @change="toggleSelectVisible">
            {{ allVisibleSelected ? '取消全选' : '全选当前结果' }}
          </el-checkbox>
          <span v-if="selectedCount">已选 {{ selectedCount }} 个作品</span>
          <span v-else-if="canDragWorks" class="is-hint">拖动卡片右上角手柄调整展示顺序</span>
          <span v-else class="is-hint">清除筛选并加载全部作品后可拖动排序</span>
        </div>
        <div v-if="selectedCount" class="community-selection-bar__actions">
          <el-button text @click="clearSelection">取消选择</el-button>
          <el-button type="primary" :icon="Check" @click="openBatchEdit">批量编辑</el-button>
        </div>
      </div>

      <ListError :error="worksError" :loading="loading" @retry="retryWorks" />

      <div v-loading="loading && works.length > 0" class="community-pane__scroll">
        <div v-if="loading && !works.length" class="community-board" aria-label="正在加载作品">
          <article v-for="index in 8" :key="`sk-${index}`" class="community-card-skeleton">
            <div />
            <footer><span /><small /><em /></footer>
          </article>
        </div>

        <el-empty v-else-if="!visibleWorks.length" description="当前筛选下暂无作品" />

        <draggable
          v-else
          v-model="workDragList"
          class="community-board"
          item-key="id"
          handle=".community-card__drag"
          :animation="180"
          :disabled="!canDragWorks"
          ghost-class="is-work-ghost"
          drag-class="is-work-drag"
          @end="persistWorkOrder"
        >
          <template #item="{ element: item }">
            <CommunityWorkCard
              :item="item"
              :operating="workOperating === item.id"
              :category-label="categoryLabelOf(item)"
              :selected="selectedWorkIds.has(item.id)"
              :draggable="canDragWorks"
              @edit="openEdit"
              @feature="toggleFeatured"
              @preview="openPreview"
              @select="setWorkSelected"
            />
          </template>
        </draggable>
      </div>

      <div class="community-pane__pager">
        <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
      </div>
    </div>

    <el-image-viewer
      v-if="previewVisible"
      :url-list="previewUrls"
      teleported
      @close="previewVisible = false"
    />

    <el-dialog
      v-model="categoryOpen"
      title="分类管理"
      width="720px"
      append-to-body
      destroy-on-close
      class="community-manage-dialog"
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

        <p class="cm-tip">点击名称改名；停用后前台不再展示。在「全部」下可拖动手柄排序。删除分类后作品变为未分类。</p>

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
    </el-dialog>

    <el-dialog
      v-model="categoryEditorOpen"
      title="新增分类"
      width="420px"
      append-to-body
      destroy-on-close
      class="community-config-editor-dialog"
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
      <template #footer>
        <el-button @click="categoryEditorOpen = false">取消</el-button>
        <el-button type="primary" :loading="Boolean(categorySaving)" @click="submitCategoryEditor">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="authorsOpen"
      title="创作者管理"
      width="880px"
      append-to-body
      destroy-on-close
      class="community-authors-dialog"
    >
      <div class="authors-overview">
        <div><strong>{{ authorSummary.creators }}</strong><span>当前创作者</span></div>
        <div><strong>{{ authorSummary.submissions }}</strong><span>累计投稿</span></div>
        <div><strong>{{ authorSummary.approved }}</strong><span>已通过</span></div>
        <div :class="{ 'is-alert': authorSummary.banned > 0 }">
          <strong>{{ authorSummary.banned }}</strong><span>禁投中</span>
        </div>
      </div>
      <div class="authors-toolbar">
        <label class="authors-search">
          <el-icon :size="16"><Search /></el-icon>
          <el-input
            v-model="authorQuery"
            clearable
            placeholder="搜索创作者名称或邮箱"
            @keyup.enter="loadAuthors"
            @clear="loadAuthors"
          />
        </label>
        <el-button type="primary" :loading="authorsLoading" @click="loadAuthors">查询</el-button>
      </div>
      <div v-loading="authorsLoading" class="authors-list">
        <el-empty v-if="!authorsLoading && !authors.length" description="暂无创作者" />
        <article v-for="row in authors" :key="row.userId" class="author-row" :class="{ 'is-banned': isBanned(row) }">
          <el-avatar class="author-row__avatar" :size="44" :src="row.avatarUrl || undefined">
            {{ authorInitial(row) }}
          </el-avatar>
          <div class="author-row__identity">
            <div class="author-row__name-line">
              <strong>{{ row.username || '未设置昵称' }}</strong>
              <el-tag v-if="isBanned(row)" type="danger" size="small" effect="light">禁投中</el-tag>
              <el-tag v-else type="success" size="small" effect="plain">正常</el-tag>
            </div>
            <small :title="row.email">{{ row.email }}</small>
          </div>
          <div class="author-row__metrics">
            <span><small>投稿</small><strong>{{ row.submissions }}</strong></span>
            <span><small>通过</small><strong>{{ row.approved }}</strong></span>
            <span><small>下架</small><strong>{{ row.removed }}</strong></span>
          </div>
          <div class="author-row__state">
            <small v-if="isBanned(row)">至 {{ formatTime(row.bannedUntil) }}</small>
            <el-button
              v-if="isBanned(row)"
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
    </el-dialog>

    <el-dialog
      v-model="batchOpen"
      :title="`批量编辑 · ${selectedCount} 个作品`"
      width="600px"
      append-to-body
      destroy-on-close
      class="community-batch-dialog"
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
      <template #footer>
        <el-button @click="batchOpen = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" @click="saveBatchEdit">应用更新</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editOpen"
      title="作品详情"
      width="820px"
      append-to-body
      destroy-on-close
      class="community-edit-dialog"
    >
      <div v-if="editTarget" class="community-edit">
        <div class="community-edit__layout">
          <button type="button" class="community-edit__cover" title="打开全屏预览" @click="openPreview(editTarget)">
            <img
              v-if="editTarget.coverUrl || editTarget.mediaUrls?.[0]"
              :src="editTarget.coverUrl ?? editTarget.mediaUrls?.[0]"
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
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveCurate">保存</el-button>
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

.community-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.community-toolbar__left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;

  > strong {
    position: relative;
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
}

.community-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.community-setting-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 4px 10px;
  border: 1px solid var(--community-line);
  border-radius: 10px;
  color: var(--ink-3);
  font-size: 12px;
  background: var(--surface);

  &.is-on {
    border-color: color-mix(in srgb, var(--success) 30%, transparent);
    background: var(--success-soft);
    color: var(--success);
  }

  &.is-limit :deep(.el-input-number) {
    width: 64px;
  }
}

.community-config-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px 0 10px;
  border: 1px solid var(--community-line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;

  em {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: inherit;
    font-size: 11px;
    font-style: normal;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }

  &:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
    background: var(--accent-soft);
    color: var(--accent-ink);
    box-shadow: var(--shadow-sm);
  }

  &.is-category {
    color: var(--accent-ink);
  }

  &.is-author {
    color: var(--warning);
  }
}

.community-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--community-line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.community-pane__bar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--community-line);
}

.community-filters {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.community-filter {
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: var(--surface-3);
    color: var(--ink);
  }

  &.is-active {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }
}

.community-bar-aside {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  margin-left: auto;
}

.community-search {
  display: flex;
  align-items: center;
  width: min(320px, 42vw);
  height: 34px;
  padding: 3px 3px 3px 10px;
  border: 1px solid var(--community-line);
  border-radius: 10px;
  background: var(--surface-2);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;

  &:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  :deep(.el-input) {
    flex: 1 1 auto;
    min-width: 0;
  }

  :deep(.el-input__wrapper) {
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none !important;
  }

  :deep(.el-input__inner) {
    height: 28px;
    font-size: 13px;
  }
}

.community-search__icon {
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
}

.community-selection-bar {
  display: flex;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--surface-2);

  &.has-selection {
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
    background: var(--accent-soft);
  }
}

.community-selection-bar__left,
.community-selection-bar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
}

.community-selection-bar__left .is-hint {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.community-pane__scroll {
  flex: 0 1 auto;
  min-height: 200px;
}

.community-pane__pager {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--community-line);
}

.community-board {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
  grid-auto-rows: 1fr;
}

@media (max-width: 1280px) {
  .community-board {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 800px) {
  .community-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.community-board :deep(.community-card) {
  border-color: var(--community-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.community-board :deep(.is-work-ghost) {
  opacity: 0.35;
  border-style: dashed;
}

.community-board :deep(.is-work-drag) {
  box-shadow: 0 14px 32px rgb(15 23 42 / 18%);
}

.community-card-skeleton {
  overflow: hidden;
  border: 1px solid var(--community-line);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);

  > div {
    aspect-ratio: 4 / 3;
    background: linear-gradient(90deg, var(--el-fill-color-light), var(--el-fill-color), var(--el-fill-color-light));
    background-size: 200% 100%;
    animation: community-shimmer 1.2s linear infinite;
  }

  footer {
    display: grid;
    grid-template-rows: 18px 16px 16px 28px;
    gap: 4px;
    padding: 8px;
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

@keyframes community-shimmer {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
}

@media (max-width: 900px) {
  .community-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .community-pane {
    padding: 8px;
  }

  .community-selection-bar {
    align-items: flex-start;
    flex-direction: column;
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
  .el-dialog__body {
    padding-top: 8px;
  }

  .authors-overview {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    margin-bottom: 14px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 10px;
    background: var(--community-dialog-line);

    > div {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      background: var(--surface-2);

      strong {
        color: var(--ink);
        font-size: 20px;
        line-height: 1.2;
      }

      span {
        color: var(--ink-3);
        font-size: 11px;
      }

      &.is-alert strong {
        color: var(--danger);
      }
    }
  }

  .authors-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .authors-search {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding-left: 10px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 9px;
    color: var(--ink-3);
    background: var(--surface-2);

    &:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .el-input__wrapper {
      background: transparent;
      box-shadow: none;
    }
  }

  .authors-list {
    display: grid;
    gap: 6px;
    min-height: 160px;
    max-height: min(56vh, 520px);
    padding-right: 3px;
    overflow: auto;
  }

  .author-row {
    display: grid;
    grid-template-columns: 44px minmax(180px, 1fr) auto minmax(88px, auto);
    align-items: center;
    gap: 14px;
    min-height: 68px;
    padding: 10px 14px;
    border: 1px solid var(--community-dialog-line);
    border-radius: 9px;
    background: var(--surface);

    &.is-banned {
      border-color: color-mix(in srgb, var(--danger) 30%, transparent);
      background: var(--danger-soft);
    }
  }

  .author-row__avatar {
    flex-shrink: 0;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
  }

  .author-row__identity {
    min-width: 0;

    > small {
      display: block;
      overflow: hidden;
      margin-top: 3px;
      color: var(--el-text-color-secondary);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .author-row__name-line {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;

    strong {
      overflow: hidden;
      color: var(--ink);
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .author-row__metrics {
    display: flex;
    gap: 5px;

    > span {
      display: flex;
      min-width: 62px;
      align-items: baseline;
      justify-content: space-between;
      gap: 7px;
      padding: 5px 8px;
      border-radius: 7px;
      background: var(--surface-2);

      strong {
        font-size: 13px;
      }

      small {
        color: var(--el-text-color-secondary);
        font-size: 10px;
      }
    }
  }

  .author-row__state {
    display: grid;
    justify-items: end;
    gap: 5px;

    > small {
      color: var(--danger);
      font-size: 10px;
    }
  }

  @media (max-width: 760px) {
    .authors-overview {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .author-row {
      grid-template-columns: 44px minmax(0, 1fr) auto;
    }

    .author-row__metrics {
      grid-column: 2 / -1;
      grid-row: 2;
      flex-wrap: wrap;
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

  @media (max-width: 640px) {
    .community-batch__row {
      grid-template-columns: 1fr;

      &.is-tags .el-select {
        grid-column: 1;
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
    border-radius: 10px;
    background: var(--el-fill-color-light);
    cursor: zoom-in;

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
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
