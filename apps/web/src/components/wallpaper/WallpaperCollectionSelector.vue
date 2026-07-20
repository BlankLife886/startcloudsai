<script setup>
import { ref, computed, onMounted } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useAppearanceStore } from '@/stores/appearance'
import notificationService from '@/services/notification'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
  wallpaper: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close'])

const favoritesStore = useFavoritesStore()
const appearanceStore = useAppearanceStore()

const selectedCollections = ref([])
const isCreatingCollection = ref(false)
const newCollectionName = ref('')
const newCollectionDescription = ref('')
const newCollectionIcon = ref('folder')
const isSubmitting = ref(false)
const nameError = ref('')

const availableIcons = [
  { value: 'folder', label: '文件夹' },
  { value: 'heart', label: '心形' },
  { value: 'star', label: '星星' },
  { value: 'bookmark', label: '书签' },
  { value: 'image', label: '图片' },
  { value: 'collection', label: '集合' },
  { value: 'palette', label: '调色板' },
  { value: 'camera', label: '相机' },
  { value: 'tag', label: '标签' },
]

const sortedCollections = computed(() => {
  return [...favoritesStore.collections].sort((a, b) => {
    return new Date(b.updated_at) - new Date(a.updated_at)
  })
})

const isFavorited = computed(() => {
  return favoritesStore.isFavorited(props.wallpaper.id)
})

onMounted(() => {
  if (props.wallpaper && props.wallpaper.id) {
    const wallpaperInFavorites = favoritesStore.favorites.find(
      (item) => item.id === props.wallpaper.id,
    )
    if (wallpaperInFavorites && wallpaperInFavorites.collections) {
      selectedCollections.value = [...wallpaperInFavorites.collections]
    }
  }
})

function toggleCollection(collectionId) {
  const index = selectedCollections.value.indexOf(collectionId)
  if (index === -1) {
    selectedCollections.value.push(collectionId)
  } else {
    selectedCollections.value.splice(index, 1)
  }
}

async function saveCollections() {
  isSubmitting.value = true

  try {
    if (!favoritesStore.isFavorited(props.wallpaper.id)) {
      await favoritesStore.addFavorite(props.wallpaper)
    }

    const wallpaperInFavorites = favoritesStore.favorites.find(
      (item) => item.id === props.wallpaper.id,
    )
    const currentCollections =
      wallpaperInFavorites && wallpaperInFavorites.collections
        ? [...wallpaperInFavorites.collections]
        : []

    const collectionsToAdd = selectedCollections.value.filter(
      (id) => !currentCollections.includes(id),
    )

    const collectionsToRemove = currentCollections.filter(
      (id) => !selectedCollections.value.includes(id),
    )

    for (const collectionId of collectionsToAdd) {
      await favoritesStore.addToCollection(props.wallpaper.id, collectionId)
    }

    for (const collectionId of collectionsToRemove) {
      await favoritesStore.removeFromCollection(props.wallpaper.id, collectionId)
    }

    if (collectionsToAdd.length > 0 || collectionsToRemove.length > 0) {
      notificationService.success('收藏夹设置已保存', {
        duration: 3000,
        position: 'top-right',
      })
    }

    emit('close')
  } catch (error) {
    console.error('保存收藏夹设置失败:', error)
    notificationService.error('保存收藏夹设置失败', {
      duration: 3000,
      position: 'top-right',
    })
  } finally {
    isSubmitting.value = false
  }
}

function createNewCollection() {
  nameError.value = ''
  if (!newCollectionName.value.trim()) {
    nameError.value = '请输入收藏夹名称'
    return
  }

  isSubmitting.value = true

  const result = favoritesStore.createCollection(
    newCollectionName.value.trim(),
    newCollectionDescription.value.trim(),
    newCollectionIcon.value,
  )

  if (result.success) {
    selectedCollections.value.push(result.collection.id)
    newCollectionName.value = ''
    newCollectionDescription.value = ''
    newCollectionIcon.value = 'folder'
    isCreatingCollection.value = false
    notificationService.success(`收藏夹 "${result.collection.name}" 已创建`, {
      duration: 3000,
      position: 'top-right',
    })
  } else {
    nameError.value = result.message || '创建失败'
    notificationService.error(result.message || '创建收藏夹失败', {
      duration: 3000,
      position: 'top-right',
    })
  }

  isSubmitting.value = false
}

function removeFavorite() {
  try {
    favoritesStore.removeFavorite(props.wallpaper.id)
    emit('close')
  } catch (error) {
    console.error('取消收藏失败:', error)
    notificationService.error('取消收藏失败: ' + (error.message || '未知错误'), {
      duration: 3000,
      position: 'top-right',
    })
  }
}

function closeModal() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="collection-selector-backdrop"
      :class="{ 'is-scheme-dark': appearanceStore.isDark }"
      @click="closeModal"
    >
      <div class="collection-selector-modal" @click.stop>
        <header class="modal-header">
          <div class="modal-heading">
            <span class="modal-icon" aria-hidden="true"><i class="bi bi-folder-plus"></i></span>
            <h5 class="modal-title">{{ isFavorited ? '管理收藏夹' : '添加到收藏夹' }}</h5>
          </div>
          <button type="button" class="modal-close" aria-label="关闭" @click="closeModal">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="modal-body">
          <div class="wallpaper-preview">
            <img :src="wallpaper.thumbnail" :alt="wallpaper.id" class="preview-img" />
            <div class="wallpaper-info">
              <div class="wallpaper-id">ID: {{ wallpaper.id }}</div>
              <div class="wallpaper-resolution" v-if="wallpaper.resolution">
                分辨率: {{ wallpaper.resolution }}
              </div>
            </div>
          </div>

          <div class="collections-list">
            <div v-if="sortedCollections.length === 0" class="no-collections">
              <p>暂无收藏夹</p>
            </div>

            <button
              v-for="collection in sortedCollections"
              :key="collection.id"
              type="button"
              class="collection-item"
              :class="{ selected: selectedCollections.includes(collection.id) }"
              @click="toggleCollection(collection.id)"
            >
              <span class="collection-checkbox" aria-hidden="true">
                <i
                  class="bi"
                  :class="
                    selectedCollections.includes(collection.id)
                      ? 'bi-check2-square'
                      : 'bi-square'
                  "
                ></i>
              </span>
              <span class="collection-icon">
                <i class="bi" :class="`bi-${collection.icon || 'folder'}`"></i>
              </span>
              <span class="collection-info">
                <span class="collection-name">{{ collection.name }}</span>
                <span class="collection-count">{{ collection.count || 0 }} 项</span>
              </span>
            </button>
          </div>

          <div class="create-collection" v-if="!isCreatingCollection">
            <button type="button" class="gallery-btn" @click="isCreatingCollection = true">
              <i class="bi bi-plus-lg"></i> 创建新收藏夹
            </button>
          </div>

          <div class="create-collection-form" v-else>
            <h6>创建新收藏夹</h6>
            <label class="field">
              <span>收藏夹名称</span>
              <input
                type="text"
                v-model="newCollectionName"
                :class="{ 'is-invalid': nameError }"
                placeholder="输入收藏夹名称"
              />
              <em v-if="nameError">{{ nameError }}</em>
            </label>

            <label class="field">
              <span>描述（可选）</span>
              <input
                type="text"
                v-model="newCollectionDescription"
                placeholder="输入收藏夹描述"
              />
            </label>

            <div class="field">
              <span>图标</span>
              <div class="icon-selector">
                <button
                  v-for="icon in availableIcons"
                  :key="icon.value"
                  type="button"
                  class="icon-option"
                  :class="{ selected: newCollectionIcon === icon.value }"
                  :title="icon.label"
                  @click="newCollectionIcon = icon.value"
                >
                  <i class="bi" :class="`bi-${icon.value}`"></i>
                </button>
              </div>
            </div>

            <div class="form-actions">
              <button
                type="button"
                class="gallery-btn"
                @click="isCreatingCollection = false"
                :disabled="isSubmitting"
              >
                取消
              </button>
              <button
                type="button"
                class="gallery-btn is-primary"
                @click="createNewCollection"
                :disabled="isSubmitting"
              >
                创建
              </button>
            </div>
          </div>
        </div>

        <footer class="modal-footer">
          <button
            v-if="isFavorited"
            type="button"
            class="gallery-btn is-danger"
            :disabled="isSubmitting"
            @click="removeFavorite"
          >
            <i class="bi bi-trash"></i> 取消收藏
          </button>
          <div class="footer-end">
            <button type="button" class="gallery-btn" @click="closeModal">取消</button>
            <button
              type="button"
              class="gallery-btn is-primary"
              @click="saveCollections"
              :disabled="isSubmitting"
            >
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.collection-selector-backdrop {
  --cs-ink: #18203b;
  --cs-muted: #79809a;
  --cs-accent: #6a4fe0;
  --cs-active: #151a2d;
  --cs-surface: #fff;
  --cs-page: #f7f7ff;
  --cs-line: rgba(21, 26, 45, 0.12);
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(13, 15, 24, 0.55);
  color: var(--cs-ink);
}

.collection-selector-backdrop.is-scheme-dark {
  --cs-ink: #e8eaf4;
  --cs-muted: #9aa1b8;
  --cs-accent: #a08bff;
  --cs-active: #f0ecff;
  --cs-surface: #161824;
  --cs-page: #0d0f18;
  --cs-line: rgba(160, 139, 255, 0.22);
}

.collection-selector-modal {
  width: min(500px, calc(100vw - 32px));
  max-height: min(90vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--cs-surface);
  border-radius: 0;
  box-shadow:
    inset 0 0 0 1px var(--cs-line),
    6px 6px 0 rgba(106, 79, 224, 0.55);
}

.collection-selector-backdrop.is-scheme-dark .collection-selector-modal {
  box-shadow:
    inset 0 0 0 1px var(--cs-line),
    6px 6px 0 rgba(106, 79, 224, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--cs-line);
  background: var(--cs-page);
}

.modal-heading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.modal-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #fff;
  background: var(--cs-active);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
}

.collection-selector-backdrop.is-scheme-dark .modal-icon {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5);
}

.modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 780;
  color: var(--cs-ink);
}

.modal-close {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cs-ink);
  box-shadow: inset 0 0 0 1px var(--cs-line);
  cursor: pointer;
}

.modal-close:hover {
  color: var(--cs-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--cs-line);
}

.footer-end {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.wallpaper-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--cs-line);
}

.preview-img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 0;
  box-shadow: inset 0 0 0 1px var(--cs-line);
}

.wallpaper-id {
  font-weight: 780;
  margin-bottom: 0.25rem;
  color: var(--cs-ink);
}

.wallpaper-resolution {
  color: var(--cs-muted);
  font-size: 0.82rem;
}

.collections-list {
  max-height: 280px;
  overflow-y: auto;
  margin-bottom: 12px;
  display: grid;
  gap: 6px;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cs-ink);
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--cs-line);
  transition:
    background 0.14s ease,
    box-shadow 0.14s ease;
}

.collection-item:hover {
  background: rgba(106, 79, 224, 0.06);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.35);
}

.collection-item.selected {
  background: rgba(106, 79, 224, 0.1);
  box-shadow:
    inset 0 0 0 1px rgba(106, 79, 224, 0.45),
    3px 3px 0 rgba(106, 79, 224, 0.35);
}

.collection-checkbox {
  color: var(--cs-accent);
  font-size: 1rem;
}

.collection-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: transparent;
  border-radius: 0;
  box-shadow: inset 0 0 0 1px var(--cs-line);
  color: var(--cs-accent);
}

.collection-info {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.collection-name {
  font-weight: 720;
}

.collection-count {
  font-size: 0.78rem;
  color: var(--cs-muted);
}

.create-collection,
.create-collection-form {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--cs-line);
}

.create-collection-form h6 {
  margin: 0 0 12px;
  font-size: 0.86rem;
  font-weight: 780;
  color: var(--cs-ink);
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.field > span {
  color: var(--cs-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.field input {
  min-height: 40px;
  border: 0;
  border-radius: 0;
  padding: 0 12px;
  background: var(--cs-page);
  color: var(--cs-ink);
  box-shadow: inset 0 0 0 1px var(--cs-line);
  font: inherit;
}

.field input:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.55);
}

.field input.is-invalid {
  box-shadow: inset 0 0 0 1px rgba(176, 58, 58, 0.55);
}

.field em {
  color: #b03a3a;
  font-size: 0.76rem;
  font-style: normal;
}

.icon-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.icon-option {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cs-ink);
  box-shadow: inset 0 0 0 1px var(--cs-line);
  cursor: pointer;
}

.icon-option:hover {
  color: var(--cs-accent);
  background: rgba(106, 79, 224, 0.08);
}

.icon-option.selected {
  color: #fff;
  background: var(--cs-active);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.75);
}

.collection-selector-backdrop.is-scheme-dark .icon-option.selected {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 2px 2px 0 rgba(180, 160, 255, 0.5);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.gallery-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cs-ink);
  box-shadow: inset 0 0 0 1px var(--cs-line);
  font-size: 0.86rem;
  font-weight: 720;
  cursor: pointer;
}

.gallery-btn:hover:not(:disabled) {
  color: var(--cs-accent);
  background: rgba(106, 79, 224, 0.08);
  box-shadow: inset 0 0 0 1px rgba(106, 79, 224, 0.4);
}

.gallery-btn.is-primary {
  color: #fff;
  background: var(--cs-active);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.75);
}

.collection-selector-backdrop.is-scheme-dark .gallery-btn.is-primary {
  color: #151a2d;
  background: #f0ecff;
  box-shadow: 3px 3px 0 rgba(180, 160, 255, 0.5);
}

.gallery-btn.is-primary:hover:not(:disabled) {
  background: #6a4fe0;
  color: #fff;
}

.collection-selector-backdrop.is-scheme-dark .gallery-btn.is-primary:hover:not(:disabled) {
  background: #fff;
  color: #151a2d;
}

.gallery-btn.is-danger {
  color: #b03a3a;
  box-shadow: inset 0 0 0 1px rgba(176, 58, 58, 0.4);
}

.gallery-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.no-collections {
  text-align: center;
  padding: 2rem 0;
  color: var(--cs-muted);
}

.no-collections p {
  margin: 0;
}

.create-collection .gallery-btn {
  width: 100%;
}
</style>
