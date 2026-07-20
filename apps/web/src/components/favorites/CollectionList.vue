<script setup>
import { computed, ref } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import notificationService from '@/services/notification'

const props = defineProps({
  collections: {
    type: Array,
    required: true,
  },
  selectedCollection: {
    type: Object,
    default: null,
  },
  showCollapseButton: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['select', 'edit', 'delete', 'create', 'toggle-collapse'])

const favoritesStore = useFavoritesStore()

// 拖放相关状态
const draggedCollection = ref(null)
const dragOverCollection = ref(null)
const isDragActive = ref(false)
const pendingDeleteCollection = ref(null)

// 计算属性：按更新时间排序的集合
const sortedCollections = computed(() => {
  return [...props.collections].sort((a, b) => {
    return new Date(b.updated_at) - new Date(a.updated_at)
  })
})

// 选择集合
function selectCollection(collection) {
  emit('select', collection)
}

// 编辑集合
function editCollection(event, collection) {
  event.stopPropagation()
  emit('edit', collection)
}

// 删除集合
function deleteCollection(event, collection) {
  event.stopPropagation()
  pendingDeleteCollection.value = collection
}

function cancelDeleteCollection() {
  pendingDeleteCollection.value = null
}

function confirmDeleteCollection() {
  if (pendingDeleteCollection.value) {
    emit('delete', pendingDeleteCollection.value)
  }
  pendingDeleteCollection.value = null
}

// 创建新集合
function createCollection() {
  emit('create')
}

function toggleCollapse() {
  emit('toggle-collapse')
}

// 清除选择
function clearSelection() {
  emit('select', null)
}

function getCollectionCount(collection) {
  if (!collection?.id) return 0
  return favoritesStore.favorites.filter((item) => {
    return Array.isArray(item.collections) && item.collections.includes(collection.id)
  }).length
}

function isSupportedDrag(event) {
  const types = Array.from(event.dataTransfer?.types || [])
  return types.includes('text/plain') || types.includes('application/x-walleven-wallpaper-id')
}

function getDropData(event) {
  return (
    event.dataTransfer.getData('application/x-walleven-wallpaper-id') ||
    event.dataTransfer.getData('text/plain') ||
    event.dataTransfer.getData('collection-id') ||
    event.dataTransfer.getData('application/x-walleven-collection-id')
  )
}

function activateDrag(event) {
  if (!isSupportedDrag(event)) return false
  event.preventDefault()
  isDragActive.value = true
  event.dataTransfer.dropEffect = draggedCollection.value ? 'move' : 'copy'
  return true
}

function resetDragState() {
  isDragActive.value = false
  dragOverCollection.value = null
}

function handleListDragEnter(event) {
  activateDrag(event)
}

function handleListDragOver(event) {
  activateDrag(event)
}

function handleListDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  resetDragState()
}

function handleListDrop(event) {
  event.preventDefault()
  resetDragState()
}

// 拖动开始
function handleDragStart(event, collection) {
  // 设置拖动的数据（收藏夹ID）
  event.dataTransfer.setData('text/plain', collection.id)
  event.dataTransfer.setData('collection-id', collection.id)
  event.dataTransfer.setData('application/x-walleven-collection-id', collection.id)

  // 设置拖动效果
  event.dataTransfer.effectAllowed = 'move'

  // 设置拖动图像（可选）
  const dragIcon = document.createElement('div')
  dragIcon.innerHTML = `<i class="bi bi-folder-fill" style="font-size: 24px; color: var(--primary-color)"></i>`
  document.body.appendChild(dragIcon)
  dragIcon.style.position = 'absolute'
  dragIcon.style.top = '-1000px'
  event.dataTransfer.setDragImage(dragIcon, 15, 15)
  setTimeout(() => document.body.removeChild(dragIcon), 0)

  // 记录被拖动的收藏夹
  draggedCollection.value = collection
}

// 拖动结束
function handleDragEnd() {
  // 清除拖动状态
  draggedCollection.value = null
  resetDragState()
}

// 拖动进入目标 - 简化版本
function handleDragEnter(event, collection) {
  if (!activateDrag(event)) return

  // 设置拖动悬停的收藏夹
  dragOverCollection.value = collection
}

// 拖动离开目标 - 简化版本
function handleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
}

// 拖动悬停在目标上 - 简化版本，接受任何拖放
function handleDragOver(event) {
  activateDrag(event)
}

// 放置 - 超级简化版本
function handleDrop(event, targetCollection) {
  // 阻止默认行为
  event.preventDefault()
  event.stopPropagation()

  // 清除拖动悬停状态
  const dragData = getDropData(event)
  resetDragState()

  // 获取拖动的数据 - 使用text/plain格式
  if (!dragData) {
    console.error('没有拖放数据')
    return
  }

  // 检查是否是收藏夹ID (收藏夹ID通常以collection_开头)
  if (dragData.startsWith('collection_')) {
    // 如果源和目标相同，不处理
    if (dragData === targetCollection.id) return

    // 执行收藏夹间移动操作
    moveCollectionItems(dragData, targetCollection.id)
    return
  }

  // 否则假定是壁纸ID
  // 添加壁纸到收藏夹
  addWallpaperToCollection(dragData, targetCollection.id)
}

// 添加壁纸到收藏夹
function addWallpaperToCollection(wallpaperId, collectionId) {
  // 调用store的添加方法
  const result = favoritesStore.addToCollection(wallpaperId, collectionId)

  // 处理结果
  if (result.success) {
    // 获取收藏夹名称
    const collection = favoritesStore.collections.find((c) => c.id === collectionId)
    const collectionName = collection ? collection.name : '收藏夹'

    // 显示成功通知
    notificationService.success(`已将壁纸添加到"${collectionName}"`, {
      duration: 3000,
      position: 'bottom-right',
    })
  } else {
    // 显示错误通知
    notificationService.error(result.message || '添加壁纸到收藏夹失败', {
      duration: 3000,
      position: 'bottom-right',
    })
  }
}

// 移动收藏夹中的壁纸
function moveCollectionItems(sourceCollectionId, targetCollectionId) {
  // 调用store的移动方法
  const result = favoritesStore.moveCollectionItems(sourceCollectionId, targetCollectionId)

  // 处理结果
  if (result.success) {
    if (result.movedCount > 0) {
      // 显示成功通知
      notificationService.success(result.message, {
        duration: 3000,
        position: 'bottom-right',
      })
    } else {
      // 显示信息通知
      notificationService.info(result.message, {
        duration: 3000,
        position: 'bottom-right',
      })
    }
  } else {
    // 显示错误通知
    notificationService.error(result.message, {
      duration: 3000,
      position: 'bottom-right',
    })
  }
}
</script>

<template>
  <div class="collections-container" :class="{ 'drag-active': isDragActive }">
    <div
      class="collections-list"
      @dragenter="handleListDragEnter"
      @dragover="handleListDragOver"
      @dragleave="handleListDragLeave"
      @drop="handleListDrop"
    >
      <!-- 全部收藏选项 -->
      <div
        class="collection-item all-collections"
        :class="{ active: !selectedCollection }"
        @click="clearSelection"
      >
        <div class="collection-icon">
          <i class="bi bi-grid"></i>
        </div>
        <div class="collection-info">
          <div class="collection-name">全部收藏</div>
        </div>
        <div class="collection-actions-inline">
          <button
            class="collection-tool-button create"
            type="button"
            @click.stop="createCollection"
            title="创建新集合"
          >
            <i class="bi bi-plus-lg"></i>
          </button>
          <button
            v-if="showCollapseButton"
            class="collection-tool-button"
            type="button"
            @click.stop="toggleCollapse"
            title="收起侧边栏"
          >
            <i class="bi bi-layout-sidebar-inset-reverse"></i>
          </button>
        </div>
      </div>

      <div class="collections-section-title">
        <span>收藏夹</span>
        <span>{{ sortedCollections.length }}</span>
      </div>

      <!-- 集合列表 -->
      <div
        v-for="collection in sortedCollections"
        :key="collection.id"
        class="collection-item"
        :class="{
          active: selectedCollection && selectedCollection.id === collection.id,
          'drag-target': dragOverCollection && dragOverCollection.id === collection.id,
        }"
        @click="selectCollection(collection)"
        @dragenter="handleDragEnter($event, collection)"
        @dragleave="handleDragLeave($event)"
        @dragover="handleDragOver($event)"
        @drop="handleDrop($event, collection)"
      >
        <div class="collection-icon">
          <i class="bi" :class="`bi-${collection.icon || 'folder'}`"></i>
        </div>
        <div class="collection-info">
          <div class="collection-name">{{ collection.name }}</div>
        </div>
        <span class="collection-count-pill">{{ getCollectionCount(collection) }}</span>
        <div class="collection-actions">
          <button
            class="collection-action-button"
            @click="editCollection($event, collection)"
            title="编辑集合"
          >
            <i class="bi bi-pencil"></i>
          </button>
          <button
            class="collection-action-button danger"
            @click="deleteCollection($event, collection)"
            title="删除集合"
          >
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>

      <!-- 空集合提示 -->
      <div v-if="sortedCollections.length === 0" class="no-collections">
        <span class="no-collections-icon" aria-hidden="true">
          <i class="bi bi-folder-plus"></i>
        </span>
        <p class="no-collections-copy">暂无集合</p>
        <button class="no-collections-action" type="button" @click="createCollection">
          <i class="bi bi-plus-lg"></i>
          <span>创建集合</span>
        </button>
      </div>
    </div>

    <div
      v-if="pendingDeleteCollection"
      class="collection-confirm-layer"
      role="dialog"
      aria-modal="true"
      @click.self="cancelDeleteCollection"
    >
      <div class="collection-confirm-panel">
        <span class="collection-confirm-icon">
          <i class="bi bi-trash3"></i>
        </span>
        <div class="collection-confirm-copy">
          <h6>删除集合</h6>
          <p>
            确定删除「{{ pendingDeleteCollection.name }}」吗？收藏的壁纸会保留，只会移除集合关联。
          </p>
        </div>
        <div class="collection-confirm-actions">
          <button
            type="button"
            class="collection-confirm-button ghost"
            @click="cancelDeleteCollection"
          >
            取消
          </button>
          <button
            type="button"
            class="collection-confirm-button danger"
            @click="confirmDeleteCollection"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.collections-container {
  position: relative;
  background-color: transparent;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--fav-ink, #18203b);
}

.collection-tool-button {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--fav-muted, #79809a);
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.12);
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.collection-tool-button:hover {
  color: var(--fav-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.collection-tool-button.create {
  color: #fff;
  background: var(--fav-active, #151a2d);
  box-shadow: none;
}

.collection-tool-button.create:hover {
  color: #fff;
  background: #1f2740;
  box-shadow: none;
}

.collection-item.active .collection-tool-button {
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.collection-item.active .collection-tool-button:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
}

.collection-item.active .collection-tool-button.create {
  color: #151a2d;
  background: #fff;
  box-shadow: none;
}

.collections-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(21, 26, 45, 0.18) transparent;
}

.collections-list::-webkit-scrollbar {
  width: 6px;
}

.collections-list::-webkit-scrollbar-track {
  background: transparent;
}

.collections-list::-webkit-scrollbar-thumb {
  border-radius: 0;
  background: rgba(21, 26, 45, 0.16);
}

.collections-container.drag-active .collections-list {
  padding-top: 8px;
}

.collections-container.drag-active .collections-section-title {
  color: var(--fav-accent, #6a4fe0);
}

.collections-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 6px 8px;
  color: var(--fav-muted, #79809a);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.collection-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 10px;
  border-radius: 0;
  margin-bottom: 6px;
  cursor: pointer;
  border: none;
  color: var(--fav-ink, #18203b);
  background: transparent;
  box-shadow: inset 0 0 0 1px transparent;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.collections-container.drag-active .collection-item:not(.all-collections) {
  min-height: 64px;
  background: rgba(106, 79, 224, 0.06);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.22);
}

.collections-container.drag-active .collection-actions {
  display: none;
}

.collections-container.drag-active .collection-count-pill {
  color: var(--fav-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.12);
}

.collection-item:hover {
  background: rgba(106, 79, 224, 0.06);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.28);
}

.collection-item.active {
  color: #fff;
  background: var(--fav-active, #151a2d);
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.75);
}

.collection-item.active::after {
  content: none;
}

.collection-item.all-collections {
  min-height: 52px;
  margin-bottom: 8px;
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.1);
}

.collection-item.all-collections:hover {
  background: rgba(106, 79, 224, 0.06);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.28);
}

.collection-item.all-collections.active {
  color: #fff;
  background: var(--fav-active, #151a2d);
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.75);
}

.collection-actions-inline {
  position: static;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: auto;
}

.collection-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-size: 0.98rem;
  color: var(--fav-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.1);
  border-radius: 0;
  margin-right: 0;
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.18);
}

.active .collection-icon {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.collection-info {
  flex: 1;
  min-width: 0;
}

.collection-name {
  color: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collection-summary {
  display: flex;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
  color: var(--fav-muted, #79809a);
  font-size: 0.76rem;
}

.collection-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.collection-count-pill {
  min-width: 28px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 8px;
  border-radius: 0;
  color: var(--fav-muted, #79809a);
  background: rgba(21, 26, 45, 0.06);
  font-size: 0.74rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.collection-item.active .collection-count-pill {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
}

.collection-item:hover .collection-actions,
.collection-item.active .collection-actions {
  opacity: 1;
}

.collection-action-button {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  color: var(--fav-muted, #79809a);
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.1);
  transition:
    color 0.18s ease,
    background 0.18s ease;
}

.collection-action-button:hover {
  color: var(--fav-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.1);
}

.collection-action-button.danger:hover {
  color: #d45a6a;
  background: rgba(212, 90, 106, 0.12);
}

.active .collection-action-button {
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.no-collections {
  display: grid;
  gap: 10px;
  justify-items: center;
  margin: 2px 0 4px;
  padding: 22px 12px 18px;
  border-radius: 0;
  background: rgba(21, 26, 45, 0.03);
  box-shadow: inset 0 0 0 1px rgba(21, 26, 45, 0.1);
  text-align: center;
}

.no-collections-icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fav-accent, #6a4fe0);
  background: rgba(106, 79, 224, 0.1);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.2);
  font-size: 1.05rem;
}

.no-collections-copy {
  margin: 0;
  color: var(--fav-muted, #79809a);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.no-collections-action {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  color: #fff;
  background: var(--fav-active, #151a2d);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.no-collections-action:hover {
  background: #1f2740;
  box-shadow: 4px 4px 0 rgba(106, 79, 224, 0.85);
  transform: translate(-1px, -1px);
}

.no-collections-action:active {
  transform: translate(1px, 1px);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.65);
}

.no-collections-action i {
  font-size: 0.92rem;
}

.collection-item::before {
  content: none;
}

.collection-item.drag-target {
  background: rgba(106, 79, 224, 0.12) !important;
  box-shadow:
    inset 0 0 0 1px rgba(106, 79, 224, 0.55),
    4px 4px 0 rgba(106, 79, 224, 0.35) !important;
  transform: none;
}

.collection-item.drag-target::before {
  content: none;
}

.collection-item.drag-target::after {
  content: '松手加入';
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  background: var(--fav-active, #151a2d);
  color: #fff;
  padding: 4px 9px;
  border-radius: 0;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
  z-index: 10;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.65);
}

.collection-confirm-layer {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.54);
}

.collection-confirm-panel {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border: none;
  border-radius: 0;
  background: #111516;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    6px 6px 0 rgba(220, 53, 69, 0.35);
}

.collection-confirm-icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  color: #ff9aa6;
  background: rgba(220, 53, 69, 0.16);
}

.collection-confirm-copy {
  min-width: 0;
}

.collection-confirm-copy h6 {
  margin: 0;
  color: #ffffff;
  font-size: 0.98rem;
  font-weight: 800;
}

.collection-confirm-copy p {
  margin: 6px 0 0;
  color: rgba(255, 255, 255, 0.66);
  font-size: 0.78rem;
  line-height: 1.45;
}

.collection-confirm-actions {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.collection-confirm-button {
  min-height: 36px;
  border: none;
  border-radius: 0;
  color: #ffffff;
  font-weight: 800;
}

.collection-confirm-button.ghost {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.collection-confirm-button.danger {
  background: #dc3545;
}
</style>
