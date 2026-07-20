<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CollectionTag, Delete, EditPen, Picture, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { request, normalizeList, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
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
}

const CATEGORY_OPTIONS = [
  { value: 'all', label: '全部内容', icon: '▦', color: '#6d5dfc' },
  { value: 'portrait', label: '人像人物', icon: '◉', color: '#ec4899' },
  { value: 'photography', label: '摄影写实', icon: '◎', color: '#0ea5e9' },
  { value: 'product', label: '产品商业', icon: '◇', color: '#f59e0b' },
  { value: 'illustration', label: '插画动漫', icon: '✦', color: '#8b5cf6' },
  { value: 'scene', label: '场景建筑', icon: '△', color: '#10b981' },
  { value: 'design', label: '视觉设计', icon: '✣', color: '#6366f1' },
  { value: 'game', label: '游戏美术', icon: '◆', color: '#ef4444' },
  { value: 'typography', label: '文字排版', icon: 'T', color: '#64748b' },
  { value: 'other', label: '其他', icon: '·', color: '#94a3b8' },
] as const

const query = ref('')
const categoryFilter = ref('all')
const typeFilter = ref('all')
const statusFilter = ref('all')
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null

const { items, loading, hasPrev, hasNext, reset, next, prev, refresh } = usePagedList<PromptItem>((cursor) =>
  request<PromptItem[] | Page<PromptItem>>('/api/admin/prompt-library', {
    query: {
      type: typeFilter.value === 'all' ? '' : typeFilter.value,
      category: categoryFilter.value === 'all' ? '' : categoryFilter.value,
      search: query.value.trim(),
      limit: 24,
      cursor,
    },
  }).then(normalizeList),
)

/** 启停/封面筛选（契约无该查询参数，作用于当前页） */
const visibleItems = computed(() => {
  if (statusFilter.value === 'enabled') return items.value.filter((item) => item.active)
  if (statusFilter.value === 'disabled') return items.value.filter((item) => !item.active)
  if (statusFilter.value === 'missing-cover') return items.value.filter((item) => !item.coverUrl)
  return items.value
})

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

function categoryMeta(value: string | undefined) {
  return CATEGORY_OPTIONS.find((item) => item.value === (value ?? 'other')) ?? CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1]!
}

function formatTime(value: string | undefined) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function scheduleReload() {
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
  ElMessage.success('提示词已删除')
  await refresh()
}

onMounted(() => {
  updateGridColumnCount()
  window.addEventListener('resize', updateGridColumnCount, { passive: true })
  void reset()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateGridColumnCount)
  if (filterReloadTimer) clearTimeout(filterReloadTimer)
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="prompt-library-page">
    <header class="library-header">
      <div class="library-header__copy">
        <span class="library-eyebrow">PROMPT OPERATIONS</span>
        <h2>统一提示词库</h2>
        <p>管理内容分类、投放功能、封面素材与启停排序</p>
      </div>
      <div class="library-header__actions">
        <el-tag type="success" effect="light" round size="small">已加载 {{ items.length }} 条内容</el-tag>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openEditor()">新增提示词</el-button>
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
            :class="{ 'is-active': categoryFilter === category.value }"
            @click="categoryFilter = category.value"
          >
            <i :style="{ '--category-color': category.color }">{{ category.icon }}</i>
            <span>{{ category.label }}</span>
          </button>
        </aside>

        <main class="prompt-content">
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

          <div class="result-summary">
            <div>
              <strong>{{ categoryMeta(categoryFilter).label }}</strong>
              <span>本页 {{ visibleItems.length }} 条提示词</span>
            </div>
            <el-button type="primary" :icon="Plus" @click="openEditor()">新增内容</el-button>
          </div>

          <div v-loading="loading" class="prompt-grid">
            <template v-if="visibleItems.length">
              <div
                v-for="(column, columnIndex) in gridColumns"
                :key="`prompt-column-${columnIndex}`"
                class="prompt-grid__column"
              >
                <article
                  v-for="item in column"
                  :key="item.id"
                  class="prompt-card"
                  :class="{ 'is-disabled': !item.active }"
                >
                  <div class="prompt-cover" :class="{ 'has-image': Boolean(item.coverUrl) }" @click="openEditor(item)">
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
                      <el-switch
                        :model-value="item.active"
                        size="small"
                        @change="toggleItem(item, Boolean($event))"
                      />
                    </header>
                    <div class="page-assignments">
                      <span>{{ taskTypeLabel(item.taskType) }}</span>
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

            <div v-if="!loading && !visibleItems.length" class="library-empty">
              <el-icon><CollectionTag /></el-icon>
              <strong>没有匹配的提示词</strong>
              <span>调整分类或筛选条件后再试</span>
              <el-button @click="resetFilters">清除筛选</el-button>
            </div>
          </div>

          <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
        </main>
      </div>
    </section>

    <el-dialog
      v-model="editorOpen"
      :title="editingId ? '编辑提示词' : '新增提示词'"
      width="820px"
      destroy-on-close
      class="prompt-editor-dialog"
    >
      <div class="dialog-intro">
        <span><el-icon :size="18"><CollectionTag /></el-icon></span>
        <div>
          <strong>{{ editingId ? '维护提示词内容' : '创建一条提示词' }}</strong>
          <small>内容分类用于检索，投放功能决定用户在哪个工作台可以看到它。</small>
        </div>
      </div>
      <el-form label-position="top" class="editor-form">
        <div class="form-grid">
          <el-form-item label="名称"><el-input v-model="form.title" maxlength="80" /></el-form-item>
          <el-form-item label="内容分类">
            <el-select v-model="form.category" style="width: 100%">
              <el-option
                v-for="category in CATEGORY_OPTIONS.slice(1)"
                :key="category.value"
                :label="category.label"
                :value="category.value"
              />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="提示词内容">
          <el-input v-model="form.prompt" type="textarea" :rows="8" maxlength="8000" show-word-limit />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="form.tagsText" placeholder="用逗号分隔，例如：电影感，人物，霓虹" />
        </el-form-item>
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
        <div class="form-bottom-grid">
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
      </el-form>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存提示词</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.prompt-library-page {
  --library-accent: #6d5dfc;
  --library-border: color-mix(in srgb, var(--el-border-color) 78%, transparent);
  --library-muted: var(--el-text-color-secondary);
  box-sizing: border-box;
  display: grid;
  gap: 12px;
  padding: 12px 16px 20px;
  background:
    radial-gradient(circle at 88% 4%, rgb(109 93 252 / 8%), transparent 28%),
    var(--el-fill-color-lighter);
}

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--el-bg-color);
  box-shadow: 0 6px 18px rgb(15 23 42 / 3.5%);
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

.library-workspace {
  overflow: hidden;
  border: 1px solid var(--library-border);
  border-radius: 16px;
  background: var(--el-bg-color);
  box-shadow: 0 12px 36px rgb(30 41 59 / 5%);
}

.items-workspace {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 600px;
}

.category-rail {
  padding: 18px 12px;
  border-right: 1px solid var(--library-border);
  background: color-mix(in srgb, var(--el-fill-color-lighter) 65%, transparent);

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
      background: var(--el-fill-color-light);
      transform: translateX(2px);
    }

    &.is-active {
      color: var(--library-accent);
      font-weight: 600;
      background: rgb(109 93 252 / 9%);
    }
  }
}

.prompt-content {
  min-width: 0;
  padding: 18px;
}

.prompt-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px;
  border: 1px solid var(--library-border);
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
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

.result-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 2px 14px;

  div {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  strong {
    font-size: 17px;
  }

  span {
    color: var(--library-muted);
    font-size: 12px;
  }
}

.prompt-grid {
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
  background: var(--el-bg-color);
  box-shadow: 0 6px 20px rgb(30 41 59 / 4%);
  transition:
    transform 0.22s ease,
    box-shadow 0.22s ease,
    border-color 0.22s ease,
    opacity 0.2s ease;

  &:hover {
    border-color: rgb(109 93 252 / 35%);
    box-shadow: 0 16px 36px rgb(30 41 59 / 10%);
    transform: translateY(-3px);
  }

  &.is-disabled {
    opacity: 0.64;
  }

  &.is-disabled:hover {
    opacity: 1;
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
    linear-gradient(45deg, rgb(109 93 252 / 4%) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(109 93 252 / 4%) 25%, transparent 25%);
  background-size: 24px 24px;

  .el-icon {
    font-size: 28px;
    color: #a7a0e8;
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
    color: #0369a1;
    background: rgb(14 165 233 / 8%);
  }

  em {
    color: #6959d9;
    background: rgb(109 93 252 / 8%);
  }
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
  background: rgb(109 93 252 / 7%);

  > span {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 10px;
    color: #6d5dfc;
    background: rgb(109 93 252 / 10%);
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

.type-checkboxes {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;

  button {
    height: 38px;
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
      border-color: rgb(109 93 252 / 40%);
      color: var(--library-accent);
    }

    &.is-active {
      border-color: var(--library-accent);
      color: var(--library-accent);
      font-weight: 650;
      background: rgb(109 93 252 / 9%);
    }
  }
}

.form-bottom-grid {
  display: grid;
  grid-template-columns: 270px 1fr;
  gap: 18px;
}

.form-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-content: start;
}

.image-picker {
  position: relative;
  display: grid;
  width: 100%;
  height: 154px;
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

@media (max-width: 1500px) {
  .prompt-toolbar {
    flex-wrap: wrap;
  }

  .prompt-search {
    flex-basis: 100%;
  }
}

@media (max-width: 1100px) {
  .items-workspace {
    grid-template-columns: 1fr;
  }

  .category-rail {
    display: flex;
    overflow-x: auto;
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

@media (max-width: 720px) {
  .prompt-library-page {
    padding: 10px;
  }

  .prompt-content {
    padding: 12px;
  }

  .toolbar-select,
  .toolbar-select.is-short {
    width: calc(50% - 5px);
  }

  .result-summary div span {
    display: none;
  }

  .library-header {
    flex-direction: column;
    align-items: stretch;
  }

  .editor-form .form-grid,
  .form-bottom-grid,
  .form-settings {
    grid-template-columns: 1fr;
  }

  .type-checkboxes {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
