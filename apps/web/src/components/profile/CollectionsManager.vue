<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useRouter } from 'vue-router'
import notificationService from '@/services/notification'

const props = defineProps({
  limit: {
    type: Number,
    default: 6,
  },
})

const emit = defineEmits(['preview-wallpaper'])

// 获取stores
const favoritesStore = useFavoritesStore()
const router = useRouter()

// 本地状态
const isLoading = ref(false)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteModal = ref(false)
const selectedCollection = ref(null)
const deleteTargetCollection = ref(null)
const draggedCollection = ref(null)
const dragOverCollection = ref(null)
const searchQuery = ref('')
const sortBy = ref('updated') // 'updated', 'name', 'count'
const sortOrder = ref('desc') // 'asc', 'desc'
const createNameInput = ref(null)
const editNameInput = ref(null)

// 新收藏夹表单
const newCollectionForm = ref({
  name: '',
  description: '',
  icon: 'folder',
})

// 编辑收藏夹表单
const editCollectionForm = ref({
  id: '',
  name: '',
  description: '',
  icon: 'folder',
})

// 可用的图标
const availableIcons = [
  'folder',
  'heart',
  'star',
  'image',
  'bookmark',
  'collection',
  'camera',
  'palette',
  'brush',
  'mountains',
  'tree',
  'flower3',
  'sunset',
  'moon-stars',
  'cloud-sun',
  'rainbow',
  'water',
  'snow',
  'lightning',
  'hurricane',
  'fire',
  'emoji-smile',
  'emoji-sunglasses',
  'emoji-heart-eyes',
  'building',
  'house',
  'car-front',
  'airplane',
  'bicycle',
  'rocket',
  'controller',
  'laptop',
  'phone',
  'music-note',
  'film',
  'camera-reels',
  'book',
  'cup-hot',
  'trophy',
  'gem',
]

// 计算属性 - 过滤和排序后的收藏夹列表
const collections = computed(() => {
  // 先过滤
  let result = [...favoritesStore.collections]

  // 搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    result = result.filter((collection) => {
      // 搜索名称
      if (collection.name.toLowerCase().includes(query)) {
        return true
      }

      // 搜索描述
      if (collection.description && collection.description.toLowerCase().includes(query)) {
        return true
      }

      return false
    })
  }

  // 排序
  result.sort((a, b) => {
    if (sortBy.value === 'updated') {
      const dateA = new Date(a.updated_at || 0)
      const dateB = new Date(b.updated_at || 0)
      return sortOrder.value === 'asc' ? dateA - dateB : dateB - dateA
    } else if (sortBy.value === 'name') {
      return sortOrder.value === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    } else if (sortBy.value === 'count') {
      const countA = a.count || 0
      const countB = b.count || 0
      return sortOrder.value === 'asc' ? countA - countB : countB - countA
    }
    return 0
  })

  // 限制数量
  return result.slice(0, props.limit)
})

// 计算属性 - 收藏夹总数
const collectionsCount = computed(() => {
  return favoritesStore.collections.length
})

// 创建新收藏夹
function openCreateModal() {
  newCollectionForm.value = {
    name: '',
    description: '',
    icon: 'folder',
  }
  showCreateModal.value = true
  nextTick(() => createNameInput.value?.focus())
}

function closeCreateModal() {
  showCreateModal.value = false
}

function createCollection() {
  if (!newCollectionForm.value.name.trim()) {
    notificationService.error('收藏夹名称不能为空', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  // 检查名称长度
  if (newCollectionForm.value.name.length > 50) {
    notificationService.error('收藏夹名称不能超过50个字符', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  // 检查描述长度
  if (newCollectionForm.value.description && newCollectionForm.value.description.length > 200) {
    notificationService.error('收藏夹描述不能超过200个字符', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  const result = favoritesStore.createCollection(
    newCollectionForm.value.name,
    newCollectionForm.value.description,
    newCollectionForm.value.icon,
  )

  if (result.success) {
    notificationService.success('收藏夹创建成功', {
      duration: 3000,
      position: 'bottom-right',
    })

    // 重置表单并关闭模态框
    newCollectionForm.value = {
      name: '',
      description: '',
      icon: 'folder',
    }
    closeCreateModal()
  } else {
    notificationService.error(`创建收藏夹失败: ${result.message}`, {
      duration: 3000,
      position: 'bottom-right',
    })
  }
}

// 打开编辑收藏夹模态框
function openEditModal(collection) {
  selectedCollection.value = collection
  editCollectionForm.value = {
    id: collection.id,
    name: collection.name,
    description: collection.description || '',
    icon: collection.icon || 'folder',
  }
  showEditModal.value = true
  nextTick(() => editNameInput.value?.focus())
}

function closeEditModal() {
  showEditModal.value = false
  selectedCollection.value = null
}

function closeCollectionModals() {
  closeCreateModal()
  closeEditModal()
  closeDeleteModal()
}

// 更新收藏夹
function updateCollection() {
  if (!editCollectionForm.value.name.trim()) {
    notificationService.error('收藏夹名称不能为空', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  // 检查名称长度
  if (editCollectionForm.value.name.length > 50) {
    notificationService.error('收藏夹名称不能超过50个字符', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  // 检查描述长度
  if (editCollectionForm.value.description && editCollectionForm.value.description.length > 200) {
    notificationService.error('收藏夹描述不能超过200个字符', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  // 检查是否与其他收藏夹同名（排除自己）
  const hasDuplicateName = favoritesStore.collections.some(
    (c) => c.name === editCollectionForm.value.name && c.id !== editCollectionForm.value.id,
  )

  if (hasDuplicateName) {
    notificationService.error('已存在同名收藏夹', {
      duration: 3000,
      position: 'bottom-right',
    })
    return
  }

  const result = favoritesStore.updateCollection(editCollectionForm.value.id, {
    name: editCollectionForm.value.name,
    description: editCollectionForm.value.description,
    icon: editCollectionForm.value.icon,
  })

  if (result.success) {
    notificationService.success('收藏夹更新成功', {
      duration: 3000,
      position: 'bottom-right',
    })

    // 关闭模态框
    closeEditModal()
  } else {
    notificationService.error(`更新收藏夹失败: ${result.message}`, {
      duration: 3000,
      position: 'bottom-right',
    })
  }
}

// 删除收藏夹
function requestDeleteCollection(collection) {
  deleteTargetCollection.value = collection
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  deleteTargetCollection.value = null
}

function confirmDeleteCollection() {
  if (!deleteTargetCollection.value) return

  const result = favoritesStore.deleteCollection(deleteTargetCollection.value.id)

  if (result.success) {
    notificationService.success('收藏夹删除成功', {
      duration: 3000,
      position: 'bottom-right',
    })
    closeDeleteModal()
  } else {
    notificationService.error(`删除收藏夹失败: ${result.message}`, {
      duration: 3000,
      position: 'bottom-right',
    })
  }
}

// 导航到收藏夹详情页
function navigateToCollection(collection) {
  favoritesStore.selectCollection(collection)
  router.push({ name: 'favorites' })
}

// 拖动开始
function handleDragStart(event, collection) {
  event.dataTransfer.setData('collection-id', collection.id)
  event.dataTransfer.effectAllowed = 'move'
  draggedCollection.value = collection
}

// 拖动结束
function handleDragEnd() {
  draggedCollection.value = null
  dragOverCollection.value = null
}

// 拖动进入目标
function handleDragEnter(event, collection) {
  if (!draggedCollection.value || draggedCollection.value.id === collection.id) {
    return
  }

  dragOverCollection.value = collection
  event.preventDefault()
}

// 拖动离开目标
function handleDragLeave() {
  dragOverCollection.value = null
}

// 拖动悬停在目标上
function handleDragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

// 放置
function handleDrop(event, targetCollection) {
  event.preventDefault()
  dragOverCollection.value = null

  const sourceCollectionId = event.dataTransfer.getData('collection-id')
  const wallpaperId = event.dataTransfer.getData('text/plain')

  if (sourceCollectionId && sourceCollectionId !== targetCollection.id) {
    // 收藏夹间移动
    const result = favoritesStore.moveCollectionItems(sourceCollectionId, targetCollection.id)

    if (result.success && result.movedCount > 0) {
      notificationService.success(result.message, {
        duration: 3000,
        position: 'bottom-right',
      })
    } else if (result.success) {
      notificationService.info(result.message, {
        duration: 3000,
        position: 'bottom-right',
      })
    } else {
      notificationService.error(result.message, {
        duration: 3000,
        position: 'bottom-right',
      })
    }
  } else if (wallpaperId) {
    // 壁纸添加到收藏夹
    const result = favoritesStore.addToCollection(wallpaperId, targetCollection.id)

    if (result.success) {
      notificationService.success(`已将壁纸添加到"${targetCollection.name}"`, {
        duration: 3000,
        position: 'bottom-right',
      })
    } else {
      notificationService.error(result.message || '添加壁纸到收藏夹失败', {
        duration: 3000,
        position: 'bottom-right',
      })
    }
  }
}

// 更改排序方式
function changeSorting(by) {
  if (sortBy.value === by) {
    // 如果已经按这个字段排序，则切换排序顺序
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    // 否则，更改排序字段并设置为降序
    sortBy.value = by
    sortOrder.value = 'desc'
  }
}

// 清除搜索
function clearSearch() {
  searchQuery.value = ''
}

// 处理键盘事件
function handleKeyDown(event, modalType) {
  if (event.key === 'Escape' || event.key === 'Enter') {
    event.stopPropagation()
  }

  // ESC键关闭模态框
  if (event.key === 'Escape') {
    if (modalType === 'create') {
      closeCreateModal()
    } else if (modalType === 'edit') {
      closeEditModal()
    }
  }

  // Enter键提交表单
  if (event.key === 'Enter' && !event.shiftKey && event.target?.tagName !== 'TEXTAREA') {
    event.preventDefault()
    if (modalType === 'create') {
      createCollection()
    } else if (modalType === 'edit') {
      updateCollection()
    }
  }
}

function handleGlobalKeyDown(event) {
  if (showCreateModal.value) {
    handleKeyDown(event, 'create')
  } else if (showEditModal.value) {
    handleKeyDown(event, 'edit')
  } else if (showDeleteModal.value && event.key === 'Escape') {
    closeDeleteModal()
  }
}

// 组件挂载时初始化
onMounted(() => {
  if (favoritesStore.favoritesCount === 0 && favoritesStore.collectionsCount === 0) {
    isLoading.value = true
    favoritesStore
      .initFavorites()
      .catch((err) => {
        console.error('初始化收藏失败:', err)
      })
      .finally(() => {
        isLoading.value = false
      })
  }

  // 添加全局键盘事件监听
  window.addEventListener('keydown', handleGlobalKeyDown)
})

// 组件卸载时清理
onUnmounted(() => {
  // 移除全局键盘事件监听
  window.removeEventListener('keydown', handleGlobalKeyDown)
})
</script>

<template>
  <section class="collections-craft" aria-label="我的收藏夹">
    <header class="collections-craft__head">
      <div class="collections-craft__title-block">
        <span class="collections-craft__kicker">Collections</span>
        <h3 class="collections-craft__title">我的收藏夹</h3>
      </div>
      <div class="collections-craft__head-actions">
        <button type="button" class="collections-craft__btn collections-craft__btn--primary" @click="openCreateModal">
          <i class="bi bi-plus-lg" aria-hidden="true"></i>
          新建
        </button>
        <router-link to="/favorites" class="collections-craft__btn">
          全部 {{ collectionsCount }}
        </router-link>
      </div>
    </header>

    <div class="collections-craft__toolbar">
      <label class="collections-craft__search">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          type="search"
          placeholder="搜索收藏夹…"
          v-model="searchQuery"
          aria-label="搜索收藏夹"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="collections-craft__search-clear"
          title="清除搜索"
          @click="clearSearch"
        >
          <i class="bi bi-x" aria-hidden="true"></i>
        </button>
      </label>
      <div class="collections-craft__sorts" role="group" aria-label="排序">
        <button
          type="button"
          class="collections-craft__sort"
          :class="{ 'is-active': sortBy === 'updated' }"
          title="按更新时间排序"
          @click="changeSorting('updated')"
        >
          <i
            class="bi"
            :class="sortBy === 'updated' && sortOrder === 'desc' ? 'bi-clock-history' : 'bi-clock'"
            aria-hidden="true"
          ></i>
        </button>
        <button
          type="button"
          class="collections-craft__sort"
          :class="{ 'is-active': sortBy === 'name' }"
          title="按名称排序"
          @click="changeSorting('name')"
        >
          <i
            class="bi"
            :class="
              sortBy === 'name' && sortOrder === 'desc'
                ? 'bi-sort-alpha-down-alt'
                : 'bi-sort-alpha-down'
            "
            aria-hidden="true"
          ></i>
        </button>
        <button
          type="button"
          class="collections-craft__sort"
          :class="{ 'is-active': sortBy === 'count' }"
          title="按壁纸数量排序"
          @click="changeSorting('count')"
        >
          <i
            class="bi"
            :class="
              sortBy === 'count' && sortOrder === 'desc'
                ? 'bi-sort-numeric-down-alt'
                : 'bi-sort-numeric-down'
            "
            aria-hidden="true"
          ></i>
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="collections-craft__state">
      <span class="collections-craft__spinner" aria-hidden="true"></span>
      <p>加载收藏夹…</p>
    </div>

    <div v-else-if="favoritesStore.collections.length === 0" class="collections-craft__empty">
      <i class="bi bi-folder-x" aria-hidden="true"></i>
      <p>还没有创建任何收藏夹</p>
      <small>用主题把喜欢的画面收成几叠。</small>
      <button type="button" class="collections-craft__btn collections-craft__btn--primary" @click="openCreateModal">
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
        创建第一个收藏夹
      </button>
    </div>

    <div v-else-if="collections.length === 0 && searchQuery.trim()" class="collections-craft__empty">
      <i class="bi bi-search" aria-hidden="true"></i>
      <p>没有找到匹配「{{ searchQuery }}」的收藏夹</p>
      <button type="button" class="collections-craft__btn" @click="clearSearch">
        清除搜索
      </button>
    </div>

    <div v-else class="collections-craft__grid">
      <article
        v-for="collection in collections"
        :key="collection.id"
        class="collections-craft__card"
        :class="{
          'is-dragging': draggedCollection && draggedCollection.id === collection.id,
          'is-drop-target': dragOverCollection && dragOverCollection.id === collection.id,
        }"
        draggable="true"
        @dragstart="handleDragStart($event, collection)"
        @dragend="handleDragEnd"
        @dragenter="handleDragEnter($event, collection)"
        @dragleave="handleDragLeave"
        @dragover="handleDragOver"
        @drop="handleDrop($event, collection)"
        @click="navigateToCollection(collection)"
      >
        <div class="collections-craft__icon">
          <i class="bi" :class="`bi-${collection.icon || 'folder'}`" aria-hidden="true"></i>
        </div>
        <div class="collections-craft__info">
          <h4 class="collections-craft__name">{{ collection.name }}</h4>
          <div class="collections-craft__count">{{ collection.count || 0 }} 张壁纸</div>
          <p v-if="collection.description" class="collections-craft__desc">
            {{ collection.description }}
          </p>
        </div>
        <div class="collections-craft__card-actions">
          <button
            type="button"
            class="collections-craft__icon-btn"
            title="编辑收藏夹"
            @click.stop="openEditModal(collection)"
          >
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="collections-craft__icon-btn collections-craft__icon-btn--danger"
            title="删除收藏夹"
            @click.stop="requestDeleteCollection(collection)"
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <div
        v-if="showDeleteModal"
        class="collections-craft-modal collections-craft-modal--delete"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collections-delete-title"
      >
        <div class="collections-craft-modal__panel collections-craft-modal__panel--delete">
          <div class="collections-craft-modal__delete-icon">
            <i class="bi bi-trash3" aria-hidden="true"></i>
          </div>
          <div class="collections-craft-modal__delete-copy">
            <h5 id="collections-delete-title">删除收藏夹</h5>
            <p>
              确定删除「{{
                deleteTargetCollection?.name
              }}」吗？壁纸不会被删除，但会移除与此收藏夹的关联。
            </p>
          </div>
          <div class="collections-craft-modal__actions">
            <button type="button" class="collections-craft__btn" @click="closeDeleteModal">
              取消
            </button>
            <button
              type="button"
              class="collections-craft__btn collections-craft__btn--danger"
              @click="confirmDeleteCollection"
            >
              删除
            </button>
          </div>
        </div>
        <div class="collections-craft-modal__backdrop" @click="closeDeleteModal"></div>
      </div>
    </Teleport>

    <div
      class="collections-craft-modal"
      :class="{ 'is-open': showCreateModal }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collections-create-title"
    >
      <div class="collections-craft-modal__panel">
        <header class="collections-craft-modal__head">
          <h5 id="collections-create-title">
            <i class="bi bi-folder-plus" aria-hidden="true"></i>
            创建新收藏夹
          </h5>
          <button
            type="button"
            class="collections-craft-modal__close"
            aria-label="关闭"
            @click="closeCreateModal"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>
        <div class="collections-craft-modal__body">
          <form
            class="collections-craft-form"
            @submit.prevent="createCollection"
            @keydown="handleKeyDown($event, 'create')"
          >
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">
                名称 <em>*</em>
              </label>
              <input
                type="text"
                class="collections-craft-form__input"
                v-model="newCollectionForm.name"
                required
                maxlength="50"
                placeholder="输入收藏夹名称"
                ref="createNameInput"
                @focus="$event.target.select()"
              />
              <small class="collections-craft-form__meta">
                <span>必填，最多 50 个字符</span>
                <span>{{ newCollectionForm.name.length }}/50</span>
              </small>
            </div>
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">描述（可选）</label>
              <textarea
                class="collections-craft-form__input collections-craft-form__textarea"
                v-model="newCollectionForm.description"
                rows="3"
                maxlength="200"
                placeholder="输入收藏夹描述（可选）"
              ></textarea>
              <small class="collections-craft-form__meta collections-craft-form__meta--end">
                <span>{{ newCollectionForm.description.length }}/200</span>
              </small>
            </div>
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">图标</label>
              <div class="collections-craft-form__icons">
                <button
                  v-for="icon in availableIcons"
                  :key="icon"
                  type="button"
                  class="collections-craft-form__icon"
                  :class="{ 'is-active': newCollectionForm.icon === icon }"
                  title="选择图标"
                  @click="newCollectionForm.icon = icon"
                >
                  <i class="bi" :class="`bi-${icon}`" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </form>
        </div>
        <footer class="collections-craft-modal__foot">
          <button type="button" class="collections-craft__btn" @click="closeCreateModal">取消</button>
          <button
            type="button"
            class="collections-craft__btn collections-craft__btn--primary"
            @click="createCollection"
          >
            创建
          </button>
        </footer>
      </div>
    </div>

    <div
      class="collections-craft-modal"
      :class="{ 'is-open': showEditModal }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collections-edit-title"
    >
      <div class="collections-craft-modal__panel">
        <header class="collections-craft-modal__head">
          <h5 id="collections-edit-title">
            <i class="bi bi-folder" aria-hidden="true"></i>
            编辑收藏夹
          </h5>
          <button
            type="button"
            class="collections-craft-modal__close"
            aria-label="关闭"
            @click="closeEditModal"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>
        <div class="collections-craft-modal__body">
          <form
            class="collections-craft-form"
            @submit.prevent="updateCollection"
            @keydown="handleKeyDown($event, 'edit')"
          >
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">
                名称 <em>*</em>
              </label>
              <input
                type="text"
                class="collections-craft-form__input"
                v-model="editCollectionForm.name"
                required
                maxlength="50"
                placeholder="输入收藏夹名称"
                ref="editNameInput"
                @focus="$event.target.select()"
              />
              <small class="collections-craft-form__meta">
                <span>必填，最多 50 个字符</span>
                <span>{{ editCollectionForm.name.length }}/50</span>
              </small>
            </div>
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">描述（可选）</label>
              <textarea
                class="collections-craft-form__input collections-craft-form__textarea"
                v-model="editCollectionForm.description"
                rows="3"
                maxlength="200"
                placeholder="输入收藏夹描述（可选）"
              ></textarea>
              <small class="collections-craft-form__meta collections-craft-form__meta--end">
                <span>{{ editCollectionForm.description.length }}/200</span>
              </small>
            </div>
            <div class="collections-craft-form__block">
              <label class="collections-craft-form__label">图标</label>
              <div class="collections-craft-form__icons">
                <button
                  v-for="icon in availableIcons"
                  :key="icon"
                  type="button"
                  class="collections-craft-form__icon"
                  :class="{ 'is-active': editCollectionForm.icon === icon }"
                  title="选择图标"
                  @click="editCollectionForm.icon = icon"
                >
                  <i class="bi" :class="`bi-${icon}`" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </form>
        </div>
        <footer class="collections-craft-modal__foot">
          <button type="button" class="collections-craft__btn" @click="closeEditModal">取消</button>
          <button
            type="button"
            class="collections-craft__btn collections-craft__btn--primary"
            @click="updateCollection"
          >
            保存
          </button>
        </footer>
      </div>
    </div>

    <div
      v-if="showCreateModal || showEditModal"
      class="collections-craft-modal__backdrop collections-craft-modal__backdrop--page"
      @click="closeCollectionModals"
    ></div>
  </section>
</template>

<style scoped>
.collections-craft {
  --cc-ink: var(--pf-ink, #151a2d);
  --cc-accent: var(--pf-accent, #6a4fe0);
  --cc-accent-soft: var(--pf-accent-soft, rgba(106, 79, 224, 0.1));
  --cc-line: var(--pf-line, rgba(21, 26, 45, 0.1));
  --cc-line-strong: var(--pf-line-strong, rgba(106, 79, 224, 0.4));
  --cc-card: var(--pf-card, #ffffff);
  --cc-heading: var(--pf-heading, #151a2d);
  --cc-text: var(--pf-text, #3a4258);
  --cc-muted: var(--pf-muted, #79809a);
  --cc-subtle: var(--pf-subtle, #8a91a5);
  --cc-song: var(--pf-song, 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif);
  --cc-mono: var(--pf-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace);
  --cc-stamp: var(--pf-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
  --cc-stamp-soft: var(--pf-stamp-soft, 3px 3px 0 rgba(106, 79, 224, 0.12));
  --cc-ease: var(--pf-ease, cubic-bezier(0.22, 0.8, 0.24, 1));

  display: grid;
  gap: 14px;
  padding: 16px;
  background: var(--cc-card);
  color: var(--cc-text);
  box-shadow:
    inset 0 0 0 1px var(--cc-line),
    var(--cc-stamp-soft);
}

.collections-craft__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.collections-craft__kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--cc-accent);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.collections-craft__title {
  margin: 0;
  font-family: var(--cc-song);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--cc-heading);
  line-height: 1.2;
}

.collections-craft__head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.collections-craft__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background: var(--cc-card);
  color: var(--cc-heading);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px var(--cc-line),
    2px 2px 0 rgba(106, 79, 224, 0.12);
  transition:
    transform 0.16s var(--cc-ease),
    box-shadow 0.16s var(--cc-ease),
    background 0.16s var(--cc-ease),
    color 0.16s var(--cc-ease);
}

.collections-craft__btn:hover {
  transform: translate(-1px, -1px);
  background: var(--cc-accent-soft);
  box-shadow:
    inset 0 0 0 1px var(--cc-line-strong),
    3px 3px 0 rgba(106, 79, 224, 0.2);
}

.collections-craft__btn--primary {
  background: var(--cc-ink);
  color: #fff;
  box-shadow: var(--cc-stamp);
}

.collections-craft__btn--primary:hover {
  background: var(--cc-accent);
  color: #fff;
}

.collections-craft__btn--danger {
  background: #d64545;
  color: #fff;
  box-shadow: 3px 3px 0 rgba(214, 69, 69, 0.28);
}

.collections-craft__btn--danger:hover {
  background: #c03838;
  color: #fff;
}

html.color-scheme-dark .collections-craft__btn--primary {
  background: var(--cc-accent);
  color: var(--pf-on-accent, #12101c);
}

.collections-craft__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.collections-craft__search {
  position: relative;
  flex: 1;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  box-shadow: inset 0 0 0 1px var(--cc-line);
}

.collections-craft__search > i {
  color: var(--cc-accent);
  font-size: 0.85rem;
}

.collections-craft__search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--cc-heading);
  font: inherit;
  font-size: 0.84rem;
}

.collections-craft__search input::placeholder {
  color: var(--cc-subtle);
}

.collections-craft__search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-muted);
  cursor: pointer;
}

.collections-craft__search-clear:hover {
  color: var(--cc-heading);
  background: var(--cc-accent-soft);
}

.collections-craft__sorts {
  display: flex;
  gap: 6px;
}

.collections-craft__sort {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-muted);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cc-line);
  transition:
    background 0.16s var(--cc-ease),
    color 0.16s var(--cc-ease),
    box-shadow 0.16s var(--cc-ease);
}

.collections-craft__sort:hover {
  color: var(--cc-heading);
  background: var(--cc-accent-soft);
}

.collections-craft__sort.is-active {
  background: var(--cc-ink);
  color: #fff;
  box-shadow: var(--cc-stamp);
}

html.color-scheme-dark .collections-craft__sort.is-active {
  background: var(--cc-accent);
  color: var(--pf-on-accent, #12101c);
}

.collections-craft__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.collections-craft__card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  min-height: 84px;
  padding: 12px;
  background: transparent;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cc-line);
  transition:
    transform 0.16s var(--cc-ease),
    background 0.16s var(--cc-ease),
    box-shadow 0.16s var(--cc-ease);
}

.collections-craft__card:hover {
  background: var(--cc-accent-soft);
  transform: translate(-1px, -1px);
  box-shadow:
    inset 0 0 0 1px var(--cc-line-strong),
    var(--cc-stamp);
}

.collections-craft__card.is-dragging {
  opacity: 0.72;
  cursor: grabbing;
  transform: scale(0.98);
}

.collections-craft__card.is-drop-target {
  background: var(--cc-accent-soft);
  box-shadow:
    inset 0 0 0 1px var(--cc-line-strong),
    var(--cc-stamp);
}

.collections-craft__icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  color: var(--cc-accent);
  background: var(--cc-accent-soft);
  box-shadow: inset 0 0 0 1px var(--cc-line);
  font-size: 1.1rem;
}

.collections-craft__info {
  min-width: 0;
}

.collections-craft__name {
  margin: 0 0 2px;
  font-family: var(--cc-song);
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--cc-heading);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collections-craft__count {
  font-family: var(--cc-mono);
  font-size: 0.72rem;
  color: var(--cc-subtle);
  margin-bottom: 4px;
}

.collections-craft__desc {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--cc-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.collections-craft__card-actions {
  display: flex;
  gap: 4px;
}

.collections-craft__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-muted);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cc-line);
  transition:
    background 0.16s var(--cc-ease),
    color 0.16s var(--cc-ease);
}

.collections-craft__icon-btn:hover {
  color: var(--cc-heading);
  background: var(--cc-accent-soft);
}

.collections-craft__icon-btn--danger:hover {
  color: #d64545;
  background: rgba(214, 69, 69, 0.1);
}

.collections-craft__state,
.collections-craft__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  color: var(--cc-muted);
  box-shadow: inset 0 0 0 1px var(--cc-line);
}

.collections-craft__state p,
.collections-craft__empty p {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 650;
  color: var(--cc-heading);
}

.collections-craft__empty i {
  font-size: 1.8rem;
  color: var(--cc-accent);
}

.collections-craft__empty small {
  font-size: 0.8rem;
}

.collections-craft__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--cc-line);
  border-top-color: var(--cc-accent);
  border-radius: 0;
  animation: collections-craft-spin 0.7s linear infinite;
}

@keyframes collections-craft-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Modals (teleported / fixed) — use :global for body-level overlay pieces */
.collections-craft-modal {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: none;
}

.collections-craft-modal.is-open,
.collections-craft-modal--delete {
  display: flex;
}

.collections-craft-modal--delete {
  z-index: 4300;
  pointer-events: auto;
}

.collections-craft-modal__backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  background: rgba(21, 26, 45, 0.48);
  pointer-events: auto;
}

.collections-craft-modal__backdrop--page {
  z-index: 2190;
}

.collections-craft-modal__panel {
  position: relative;
  z-index: 1;
  width: min(560px, calc(100vw - 28px));
  max-height: min(86vh, 720px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--cc-card, #fff);
  color: var(--cc-text, #3a4258);
  box-shadow:
    inset 0 0 0 1px var(--cc-line, rgba(21, 26, 45, 0.1)),
    8px 8px 0 rgba(106, 79, 224, 0.22);
  animation: collections-craft-in 0.22s var(--cc-ease, ease);
}

.collections-craft-modal__panel--delete {
  width: min(460px, calc(100vw - 32px));
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  background:
    linear-gradient(145deg, rgba(214, 69, 69, 0.08), transparent 50%),
    var(--cc-card, #fff);
}

.collections-craft-modal__delete-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  color: #d64545;
  background: rgba(214, 69, 69, 0.12);
  box-shadow: inset 0 0 0 1px rgba(214, 69, 69, 0.28);
  font-size: 1.25rem;
}

.collections-craft-modal__delete-copy h5 {
  margin: 0 0 8px;
  font-family: var(--cc-song, 'Songti SC', 'Noto Serif SC', serif);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--cc-heading, #151a2d);
}

.collections-craft-modal__delete-copy p {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--cc-muted, #79809a);
}

.collections-craft-modal__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.collections-craft-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 10px;
}

.collections-craft-modal__head h5 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--cc-song, 'Songti SC', 'Noto Serif SC', serif);
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--cc-heading, #151a2d);
}

.collections-craft-modal__head h5 i {
  color: var(--cc-accent, #6a4fe0);
}

.collections-craft-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-muted, #79809a);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cc-line, rgba(21, 26, 45, 0.1));
}

.collections-craft-modal__close:hover {
  color: var(--cc-heading, #151a2d);
  background: var(--cc-accent-soft, rgba(106, 79, 224, 0.1));
}

.collections-craft-modal__body {
  flex: 1;
  min-height: 0;
  padding: 8px 16px 12px;
  overflow-y: auto;
}

.collections-craft-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px 16px;
}

.collections-craft-form {
  display: grid;
  gap: 14px;
}

.collections-craft-form__block {
  display: grid;
  gap: 6px;
}

.collections-craft-form__label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--cc-heading, #151a2d);
}

.collections-craft-form__label em {
  font-style: normal;
  color: #d64545;
}

.collections-craft-form__input {
  min-height: 40px;
  padding: 8px 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-heading, #151a2d);
  font: inherit;
  font-size: 0.9rem;
  box-shadow: inset 0 0 0 1px var(--cc-line, rgba(21, 26, 45, 0.1));
  outline: none;
}

.collections-craft-form__input:focus {
  box-shadow: inset 0 0 0 1px var(--cc-line-strong, rgba(106, 79, 224, 0.4));
  background: var(--cc-accent-soft, rgba(106, 79, 224, 0.1));
}

.collections-craft-form__input::placeholder {
  color: var(--cc-subtle, #8a91a5);
}

.collections-craft-form__textarea {
  min-height: 86px;
  resize: vertical;
}

.collections-craft-form__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--cc-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  color: var(--cc-subtle, #8a91a5);
}

.collections-craft-form__meta--end {
  justify-content: flex-end;
}

.collections-craft-form__icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  max-height: 154px;
  overflow-y: auto;
  padding: 2px;
  scrollbar-width: thin;
}

.collections-craft-form__icon {
  aspect-ratio: 1;
  min-height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--cc-heading, #151a2d);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cc-line, rgba(21, 26, 45, 0.1));
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.collections-craft-form__icon:hover {
  background: var(--cc-accent-soft, rgba(106, 79, 224, 0.1));
}

.collections-craft-form__icon.is-active {
  background: var(--cc-ink, #151a2d);
  color: #fff;
  box-shadow: var(--cc-stamp, 4px 4px 0 rgba(106, 79, 224, 0.18));
}

html.color-scheme-dark .collections-craft-form__icon.is-active {
  background: var(--cc-accent, #a08bff);
  color: var(--pf-on-accent, #12101c);
}

html.color-scheme-dark .collections-craft-modal__panel,
html.color-scheme-dark .collections-craft-modal__panel--delete {
  --cc-card: #151826;
  --cc-heading: #f4f2ff;
  --cc-text: rgba(244, 242, 255, 0.88);
  --cc-muted: rgba(210, 205, 240, 0.68);
  --cc-subtle: rgba(190, 184, 230, 0.5);
  --cc-line: rgba(255, 255, 255, 0.1);
  --cc-line-strong: rgba(160, 139, 255, 0.42);
  --cc-accent: #a08bff;
  --cc-accent-soft: rgba(160, 139, 255, 0.14);
  --cc-ink: #151a2d;
  --cc-stamp: 4px 4px 0 rgba(160, 139, 255, 0.22);
  background: #151826;
  color: rgba(244, 242, 255, 0.88);
}

html.color-scheme-dark .collections-craft-modal__panel--delete {
  background:
    linear-gradient(145deg, rgba(214, 69, 69, 0.12), transparent 50%),
    #151826;
}

html.color-scheme-dark .collections-craft-modal__backdrop {
  background: rgba(0, 0, 0, 0.62);
}

@keyframes collections-craft-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 640px) {
  .collections-craft__card {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .collections-craft__card-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
