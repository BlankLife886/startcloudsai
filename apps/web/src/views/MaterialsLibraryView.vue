<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import {
  createUserAsset,
  createUserAssetGroup,
  deleteUserAsset,
  deleteUserAssetGroup,
  listUserAssetGroups,
  listUserAssets,
  updateUserAsset,
  updateUserAssetGroup,
} from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import ProgressiveAuthenticatedImage from '@/components/common/ProgressiveAuthenticatedImage.vue'
import DeleteHistoryConfirmDialog from '@/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue'

const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()

const materials = ref([])
const groups = ref([])
const ungroupedCount = ref(0)
const totalAssetCount = ref(0)
const activeFilter = ref('all')
const loading = ref(false)
const loadingMore = ref(false)
const groupsLoading = ref(false)
const loaded = ref(false)
const cursor = ref(null)
const uploading = ref(false)
const materialInput = ref(null)
const previewMaterial = ref(null)
const uploadOpen = ref(false)
const uploadGroupId = ref('')
const pendingUploadFiles = ref([])
const deleteConfirmOpen = ref(false)
const pendingDelete = ref(null)
const groupDeleteOpen = ref(false)
const pendingGroupDelete = ref(null)

const editAsset = ref(null)
const editingTitle = ref('')
const editingGroupId = ref('')
const editInput = ref(null)
const savingEdit = ref(false)

const moveMenuId = ref(null)
const creatingGroup = ref(false)
const showGroupComposer = ref(false)
const newGroupName = ref('')
const groupNameInput = ref(null)
const renamingGroupId = ref(null)
const renamingGroupName = ref('')

const empty = computed(() => loaded.value && !loading.value && !materials.value.length)
const canUpload = computed(() => !uploading.value && totalAssetCount.value < 200)
const canCreateGroup = computed(() => groups.value.length < 50)

const uploadTargetLabel = computed(() => {
  if (!uploadGroupId.value) return '未分组'
  return groups.value.find((g) => g.id === uploadGroupId.value)?.name || '分组'
})

const boardMeta = computed(() => {
  const shown = materials.value.length
  const more = cursor.value ? '+' : ''
  const total = totalAssetCount.value
  if (total > 0) return `${shown}${more} 项 · ${total} / 200`
  return `${shown}${more} 项 · 上限 200`
})

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0))
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function displayTitle(title) {
  const raw = String(title || '').trim()
  if (!raw) return '未命名素材'
  if (/^[a-f0-9]{16,}$/i.test(raw) || /^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return `${raw.slice(0, 8)}…`
  }
  return raw
}

function groupNameOf(asset) {
  if (!asset?.groupId) return '未分组'
  return groups.value.find((g) => g.id === asset.groupId)?.name || '分组'
}

function closeMenus() {
  moveMenuId.value = null
}

async function loadGroups() {
  groupsLoading.value = true
  try {
    const result = await listUserAssetGroups()
    groups.value = result.items
    ungroupedCount.value = result.ungroupedCount
    totalAssetCount.value = result.totalAssetCount
  } catch (error) {
    // 分组接口未就绪时，不打断素材列表
    console.warn(error)
  } finally {
    groupsLoading.value = false
  }
}

async function loadList({ append = false } = {}) {
  if (append) {
    if (loadingMore.value || !cursor.value) return
    loadingMore.value = true
  } else {
    if (loading.value) return
    loading.value = true
  }

  try {
    const result = await listUserAssets({
      limit: 24,
      cursor: append ? cursor.value || '' : '',
      groupId: activeFilter.value || 'all',
    })
    materials.value = append ? [...materials.value, ...result.items] : result.items
    cursor.value = result.nextCursor
    loaded.value = true

    if (!append && !result.nextCursor) {
      if (activeFilter.value === 'all' && result.items.length > totalAssetCount.value) {
        totalAssetCount.value = result.items.length
      }
      if (activeFilter.value === 'ungrouped') {
        ungroupedCount.value = result.items.length
      }
    }
  } catch (error) {
    notificationService.error(error?.message || '素材库读取失败')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function refreshAll() {
  closeMenus()
  await Promise.all([loadGroups(), loadList()])
}

watch(activeFilter, () => {
  closeMenus()
  closeEdit()
  cursor.value = null
  loaded.value = false
  materials.value = []
  loadList()
})

function materialTitle(file) {
  return String(file?.name || '个人素材')
    .replace(/\.[a-z0-9]+$/i, '')
    .trim()
    .slice(0, 120)
}

function defaultUploadGroupId() {
  if (activeFilter.value !== 'all' && activeFilter.value !== 'ungrouped') {
    return activeFilter.value
  }
  return ''
}

function openUpload() {
  if (!canUpload.value) return
  closeMenus()
  uploadGroupId.value = defaultUploadGroupId()
  pendingUploadFiles.value = []
  uploadOpen.value = true
}

function closeUpload() {
  if (uploading.value) return
  uploadOpen.value = false
  pendingUploadFiles.value = []
}

function pickUploadFiles() {
  materialInput.value?.click()
}

function onMaterialsSelected(event) {
  const files = Array.from(event.target?.files || [])
  if (event.target) event.target.value = ''
  if (!files.length || uploading.value) return
  if (files.length > 6) {
    notificationService.warning('单次最多上传 6 张素材')
    return
  }
  const invalid = files.find(
    (file) => !file.type.startsWith('image/') || file.size <= 0 || file.size > 10 * 1024 * 1024,
  )
  if (invalid) {
    notificationService.warning('仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片')
    return
  }
  if (totalAssetCount.value + files.length > 200) {
    notificationService.warning('素材库最多保存 200 项')
    return
  }
  pendingUploadFiles.value = files
  if (!uploadOpen.value) {
    uploadGroupId.value = defaultUploadGroupId()
    uploadOpen.value = true
  }
}

async function confirmUpload() {
  const files = pendingUploadFiles.value
  if (!files.length) {
    pickUploadFiles()
    return
  }
  if (uploading.value) return

  uploading.value = true
  let completed = 0
  const targetGroupId = uploadGroupId.value || null
  try {
    for (const file of files) {
      const uploaded = await uploadFile(file)
      const payload = {
        title: materialTitle(file),
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
      }
      if (targetGroupId) payload.groupId = targetGroupId
      const asset = await createUserAsset(payload)
      const matchesFilter =
        activeFilter.value === 'all' ||
        (activeFilter.value === 'ungrouped' && !asset.groupId) ||
        asset.groupId === activeFilter.value
      if (matchesFilter) {
        materials.value = [asset, ...materials.value.filter((item) => item.id !== asset.id)]
      }
      completed += 1
      totalAssetCount.value += 1
    }
    loaded.value = true
    pendingUploadFiles.value = []
    uploadOpen.value = false
    await loadGroups()
    const groupName = targetGroupId
      ? groups.value.find((g) => g.id === targetGroupId)?.name || '分组'
      : ''
    notificationService.success(
      groupName ? `已添加 ${completed} 项素材到「${groupName}」` : `已添加 ${completed} 项素材`,
    )
  } catch (error) {
    notificationService.error(error?.message || `已添加 ${completed} 项，其余素材上传失败`)
  } finally {
    uploading.value = false
  }
}

function removePendingFile(index) {
  pendingUploadFiles.value = pendingUploadFiles.value.filter((_, i) => i !== index)
}

function askDelete(asset) {
  closeMenus()
  pendingDelete.value = asset
  deleteConfirmOpen.value = true
}

async function confirmDelete() {
  const asset = pendingDelete.value
  deleteConfirmOpen.value = false
  pendingDelete.value = null
  if (!asset) return
  try {
    await deleteUserAsset(asset.id)
    materials.value = materials.value.filter((item) => item.id !== asset.id)
    if (previewMaterial.value?.id === asset.id) previewMaterial.value = null
    if (editAsset.value?.id === asset.id) closeEdit()
    totalAssetCount.value = Math.max(0, totalAssetCount.value - 1)
    await loadGroups()
    notificationService.success('素材已删除')
  } catch (error) {
    notificationService.error(error?.message || '素材删除失败')
  }
}

function cancelDelete() {
  deleteConfirmOpen.value = false
  pendingDelete.value = null
}

function applyAssetUpdate(updated) {
  materials.value = materials.value.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
  if (previewMaterial.value?.id === updated.id) {
    previewMaterial.value = { ...previewMaterial.value, ...updated }
  }
  if (editAsset.value?.id === updated.id) {
    editAsset.value = { ...editAsset.value, ...updated }
  }
}

async function openEdit(asset) {
  closeMenus()
  editAsset.value = asset
  editingTitle.value = asset.title || ''
  editingGroupId.value = asset.groupId || ''
  await nextTick()
  editInput.value?.focus?.()
  editInput.value?.select?.()
}

function closeEdit() {
  if (savingEdit.value) return
  editAsset.value = null
  editingTitle.value = ''
  editingGroupId.value = ''
}

async function saveEdit() {
  const asset = editAsset.value
  if (!asset) return
  const title = String(editingTitle.value || '').trim()
  if (!title) {
    notificationService.warning('标题不能为空')
    return
  }
  const nextGroupId = editingGroupId.value || null
  const titleChanged = title !== asset.title
  const groupChanged = (asset.groupId || null) !== nextGroupId
  if (!titleChanged && !groupChanged) {
    closeEdit()
    return
  }

  savingEdit.value = true
  try {
    const payload = {}
    if (titleChanged) payload.title = title
    if (groupChanged) payload.groupId = nextGroupId
    const updated = await updateUserAsset(asset.id, payload)
    applyAssetUpdate(updated)

    const stillVisible =
      activeFilter.value === 'all' ||
      (activeFilter.value === 'ungrouped' && !updated.groupId) ||
      updated.groupId === activeFilter.value
    if (!stillVisible) {
      materials.value = materials.value.filter((item) => item.id !== updated.id)
    }
    if (groupChanged) await loadGroups()
    editAsset.value = null
    editingTitle.value = ''
    editingGroupId.value = ''
    notificationService.success('素材已更新')
  } catch (error) {
    notificationService.error(error?.message || '素材更新失败')
  } finally {
    savingEdit.value = false
  }
}

function toggleMoveMenu(assetId) {
  moveMenuId.value = moveMenuId.value === assetId ? null : assetId
}

async function moveToGroup(asset, groupId) {
  const next = groupId || null
  closeMenus()
  if ((asset.groupId || null) === next) return
  try {
    const updated = await updateUserAsset(asset.id, { groupId: next })
    const stillVisible =
      activeFilter.value === 'all' ||
      (activeFilter.value === 'ungrouped' && !updated.groupId) ||
      updated.groupId === activeFilter.value
    applyAssetUpdate(updated)
    if (!stillVisible) {
      materials.value = materials.value.filter((item) => item.id !== asset.id)
    }
    await loadGroups()
    notificationService.success(next ? '已移入分组' : '已移出分组')
  } catch (error) {
    notificationService.error(error?.message || '素材更新失败')
  }
}

async function openGroupComposer() {
  showGroupComposer.value = true
  await nextTick()
  groupNameInput.value?.focus?.()
}

function cancelGroupComposer() {
  showGroupComposer.value = false
  newGroupName.value = ''
}

async function submitCreateGroup() {
  const name = String(newGroupName.value || '').trim()
  if (!name) {
    notificationService.warning('请输入分组名称')
    return
  }
  creatingGroup.value = true
  try {
    const group = await createUserAssetGroup({ name })
    groups.value = [...groups.value, group]
    cancelGroupComposer()
    activeFilter.value = group.id
    notificationService.success('分组已创建')
  } catch (error) {
    notificationService.error(error?.message || '分组创建失败')
  } finally {
    creatingGroup.value = false
  }
}

async function startRenameGroup(group) {
  renamingGroupId.value = group.id
  renamingGroupName.value = group.name || ''
  await nextTick()
}

function cancelRenameGroup() {
  renamingGroupId.value = null
  renamingGroupName.value = ''
}

async function saveRenameGroup(group) {
  const name = String(renamingGroupName.value || '').trim()
  if (!name) {
    notificationService.warning('请输入分组名称')
    return
  }
  if (name === group.name) {
    cancelRenameGroup()
    return
  }
  try {
    const updated = await updateUserAssetGroup(group.id, { name })
    groups.value = groups.value.map((item) => (item.id === group.id ? { ...item, ...updated } : item))
    cancelRenameGroup()
    notificationService.success('分组已重命名')
  } catch (error) {
    notificationService.error(error?.message || '分组更新失败')
  }
}

function askDeleteGroup(group) {
  pendingGroupDelete.value = group
  groupDeleteOpen.value = true
}

async function confirmDeleteGroup() {
  const group = pendingGroupDelete.value
  groupDeleteOpen.value = false
  pendingGroupDelete.value = null
  if (!group) return
  try {
    await deleteUserAssetGroup(group.id)
    groups.value = groups.value.filter((item) => item.id !== group.id)
    if (activeFilter.value === group.id) activeFilter.value = 'all'
    await refreshAll()
    notificationService.success('分组已删除')
  } catch (error) {
    notificationService.error(error?.message || '分组删除失败')
  }
}

function cancelDeleteGroup() {
  groupDeleteOpen.value = false
  pendingGroupDelete.value = null
}

onMounted(async () => {
  if (!authStore.isAuthenticated) {
    router.replace({
      name: 'auth',
      query: { ...createLoginRedirectQuery('/materials'), mode: 'login' },
    })
    return
  }
  await refreshAll()
})
</script>

<template>
  <div
    class="ml-page"
    :class="{ 'is-light': !appearanceStore.isDark, 'is-dark': appearanceStore.isDark }"
    @click="closeMenus"
  >
    <div class="ml-atmosphere" aria-hidden="true">
      <div class="ml-atmosphere__wash"></div>
      <div class="ml-atmosphere__orb ml-atmosphere__orb--a"></div>
      <div class="ml-atmosphere__orb ml-atmosphere__orb--b"></div>
    </div>

    <div class="ml-shell">
      <header class="ml-hero">
        <div class="ml-hero__copy">
          <h1>素材库</h1>
          <p>整理可复用的个人视觉素材，随时拖进创作。</p>
        </div>
        <div class="ml-hero__actions">
          <button
            type="button"
            class="ml-btn is-primary"
            :disabled="!canUpload"
            @click="openUpload"
          >
            <i class="bi" :class="uploading ? 'bi-arrow-repeat spin' : 'bi-plus-lg'"></i>
            {{ uploading ? '上传中…' : '添加素材' }}
          </button>
          <button
            type="button"
            class="ml-btn is-ghost"
            :disabled="loading || groupsLoading"
            @click="refreshAll()"
          >
            <i class="bi bi-arrow-repeat" :class="{ spin: loading || groupsLoading }"></i>
          </button>
          <input
            ref="materialInput"
            class="ml-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            @change="onMaterialsSelected"
          />
        </div>
      </header>

      <div class="ml-filters" @click.stop>
        <button
          type="button"
          class="ml-chip"
          :class="{ 'is-active': activeFilter === 'all' }"
          @click="activeFilter = 'all'"
        >
          全部
          <em v-if="totalAssetCount">{{ totalAssetCount }}</em>
        </button>
        <button
          type="button"
          class="ml-chip"
          :class="{ 'is-active': activeFilter === 'ungrouped' }"
          @click="activeFilter = 'ungrouped'"
        >
          未分组
          <em v-if="ungroupedCount">{{ ungroupedCount }}</em>
        </button>

        <div v-for="group in groups" :key="group.id" class="ml-chip-wrap">
          <button
            v-if="renamingGroupId !== group.id"
            type="button"
            class="ml-chip"
            :class="{ 'is-active': activeFilter === group.id }"
            @click="activeFilter = group.id"
            @dblclick="startRenameGroup(group)"
          >
            {{ group.name }}
            <em v-if="group.assetCount">{{ group.assetCount }}</em>
          </button>
          <form v-else class="ml-chip-edit" @submit.prevent="saveRenameGroup(group)">
            <input
              v-model="renamingGroupName"
              maxlength="64"
              aria-label="分组名称"
              @keydown.esc.prevent="cancelRenameGroup"
            />
            <button type="submit" aria-label="保存"><i class="bi bi-check-lg"></i></button>
          </form>
          <div v-if="renamingGroupId !== group.id && activeFilter === group.id" class="ml-chip-ops">
            <button type="button" aria-label="重命名分组" @click="startRenameGroup(group)">
              <i class="bi bi-pencil"></i>
            </button>
            <button type="button" aria-label="删除分组" @click="askDeleteGroup(group)">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </div>

        <form
          v-if="showGroupComposer"
          class="ml-chip-create"
          @submit.prevent="submitCreateGroup"
        >
          <input
            ref="groupNameInput"
            v-model="newGroupName"
            maxlength="64"
            placeholder="分组名称"
            aria-label="新建分组名称"
            @keydown.esc.prevent="cancelGroupComposer"
          />
          <button type="submit" :disabled="creatingGroup">{{ creatingGroup ? '…' : '创建' }}</button>
          <button type="button" @click="cancelGroupComposer">取消</button>
        </form>
        <button
          v-else-if="canCreateGroup"
          type="button"
          class="ml-chip is-ghost"
          @click="openGroupComposer"
        >
          <i class="bi bi-plus-lg"></i>
          新建分组
        </button>
      </div>

      <section class="ml-board" aria-live="polite">
        <div class="ml-board__meta">
          <span>{{ boardMeta }}</span>
          <span>单张 ≤ 10MB · 单次最多 6 张</span>
        </div>

        <div v-if="loading && !materials.length" class="ml-grid" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="ml-skel"></div>
        </div>

        <div v-else-if="materials.length" class="ml-grid">
          <article
            v-for="asset in materials"
            :key="asset.id"
            class="ml-card"
            :class="{ 'is-menu': moveMenuId === asset.id }"
            @click.stop
          >
            <div class="ml-card__media">
              <button type="button" class="ml-card__cover" @click="previewMaterial = asset">
                <AuthenticatedImage
                  :src="asset.thumbnailUrl"
                  :alt="asset.title"
                  loading="lazy"
                  root-margin="180px 0px"
                />
              </button>

              <div class="ml-card__toolbar">
                <button type="button" title="编辑" @click="openEdit(asset)">
                  <i class="bi bi-pencil"></i>
                </button>
                <button
                  type="button"
                  title="移动到分组"
                  :class="{ 'is-on': moveMenuId === asset.id }"
                  @click="toggleMoveMenu(asset.id)"
                >
                  <i class="bi bi-folder"></i>
                </button>
                <button type="button" title="删除" class="is-danger" @click="askDelete(asset)">
                  <i class="bi bi-trash3"></i>
                </button>
              </div>

              <div v-if="moveMenuId === asset.id" class="ml-card__menu" @click.stop>
                <button
                  type="button"
                  :class="{ 'is-active': !asset.groupId }"
                  @click="moveToGroup(asset, '')"
                >
                  未分组
                </button>
                <button
                  v-for="group in groups"
                  :key="group.id"
                  type="button"
                  :class="{ 'is-active': asset.groupId === group.id }"
                  @click="moveToGroup(asset, group.id)"
                >
                  {{ group.name }}
                </button>
                <p v-if="!groups.length" class="ml-card__menu-empty">还没有分组，先在上方新建</p>
              </div>
            </div>

            <div class="ml-card__meta">
              <strong :title="asset.title">{{ displayTitle(asset.title) }}</strong>
              <small>
                {{ formatBytes(asset.sizeBytes) }}
                <template v-if="activeFilter === 'all' && asset.groupId">
                  · {{ groupNameOf(asset) }}
                </template>
              </small>
            </div>
          </article>
        </div>

        <div v-else-if="empty" class="ml-empty">
          <i class="bi bi-collection" aria-hidden="true"></i>
          <strong>{{ activeFilter === 'all' ? '还没有素材' : '这个分组是空的' }}</strong>
          <p>
            {{
              activeFilter === 'all'
                ? '上传 PNG、JPEG 或 WebP，单张不超过 10MB。'
                : '上传到这里，或把其它素材移进来。'
            }}
          </p>
          <button type="button" class="ml-btn is-primary" @click="openUpload">
            {{ activeFilter === 'all' ? '添加素材' : '上传到此分组' }}
          </button>
        </div>

        <button
          v-if="cursor"
          type="button"
          class="ml-btn is-ghost ml-more"
          :disabled="loadingMore"
          @click="loadList({ append: true })"
        >
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="previewMaterial"
        class="ml-lightbox"
        :class="{ 'is-light': !appearanceStore.isDark }"
        tabindex="-1"
        @click.self="previewMaterial = null"
        @keydown.esc="previewMaterial = null"
      >
        <button type="button" class="ml-lightbox__close" aria-label="关闭" @click="previewMaterial = null">
          <i class="bi bi-x-lg"></i>
        </button>

        <div class="ml-lightbox__stage" @click.self="previewMaterial = null">
          <ProgressiveAuthenticatedImage
            :src="previewMaterial.url"
            :preview-src="previewMaterial.thumbnailUrl"
            :alt="previewMaterial.title"
            loading="eager"
            fetchpriority="high"
            load-original
          />
        </div>

        <footer class="ml-lightbox__bar">
          <div class="ml-lightbox__copy">
            <strong :title="previewMaterial.title">{{ previewMaterial.title }}</strong>
            <small
              >{{ formatBytes(previewMaterial.sizeBytes) }} · {{ groupNameOf(previewMaterial) }}</small
            >
          </div>
          <div class="ml-lightbox__actions">
            <button type="button" class="ml-btn is-ghost" @click="openEdit(previewMaterial)">
              <i class="bi bi-pencil"></i>
              编辑
            </button>
            <button type="button" class="ml-btn is-danger-ghost" @click="askDelete(previewMaterial)">
              <i class="bi bi-trash3"></i>
              删除
            </button>
          </div>
        </footer>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="uploadOpen"
        class="ml-edit-backdrop"
        :class="{ 'is-light': !appearanceStore.isDark }"
        @click.self="closeUpload"
      >
        <section
          class="ml-edit ml-upload"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ml-upload-title"
          @keydown.esc.stop="closeUpload"
        >
          <header class="ml-edit__head">
            <h2 id="ml-upload-title">添加素材</h2>
            <button type="button" aria-label="关闭" :disabled="uploading" @click="closeUpload">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="ml-upload__body">
            <label class="ml-upload__field">
              <span>添加到分组</span>
              <select v-model="uploadGroupId" :disabled="uploading">
                <option value="">未分组</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">
                  {{ group.name }}
                </option>
              </select>
            </label>

            <div class="ml-upload__picker">
              <button
                type="button"
                class="ml-upload__drop"
                :disabled="uploading"
                @click="pickUploadFiles"
              >
                <i class="bi bi-image" aria-hidden="true"></i>
                <strong>{{ pendingUploadFiles.length ? '重新选择图片' : '选择图片' }}</strong>
                <small>PNG / JPEG / WebP · 单张 ≤ 10MB · 最多 6 张</small>
              </button>

              <ul v-if="pendingUploadFiles.length" class="ml-upload__files">
                <li v-for="(file, index) in pendingUploadFiles" :key="`${file.name}-${index}`">
                  <span :title="file.name">{{ file.name }}</span>
                  <em>{{ formatBytes(file.size) }}</em>
                  <button
                    type="button"
                    aria-label="移除"
                    :disabled="uploading"
                    @click="removePendingFile(index)"
                  >
                    <i class="bi bi-x"></i>
                  </button>
                </li>
              </ul>
            </div>

            <footer class="ml-edit__actions">
              <button type="button" class="ml-btn is-ghost" :disabled="uploading" @click="closeUpload">
                取消
              </button>
              <button
                type="button"
                class="ml-btn is-primary"
                :disabled="uploading || !canUpload"
                @click="confirmUpload"
              >
                <i
                  v-if="uploading"
                  class="bi bi-arrow-repeat spin"
                  aria-hidden="true"
                ></i>
                {{
                  uploading
                    ? '上传中…'
                    : pendingUploadFiles.length
                      ? uploadGroupId
                        ? `上传到「${uploadTargetLabel}」`
                        : `上传 ${pendingUploadFiles.length} 项`
                      : '选择图片'
                }}
              </button>
            </footer>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="editAsset"
        class="ml-edit-backdrop"
        :class="{ 'is-light': !appearanceStore.isDark }"
        @click.self="closeEdit"
        @keydown.esc="closeEdit"
      >
        <section
          class="ml-edit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ml-edit-title"
          @keydown.esc.stop="closeEdit"
        >
          <header class="ml-edit__head">
            <h2 id="ml-edit-title">编辑素材</h2>
            <button type="button" aria-label="关闭" :disabled="savingEdit" @click="closeEdit">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="ml-edit__body">
            <div class="ml-edit__thumb">
              <AuthenticatedImage
                :src="editAsset.thumbnailUrl"
                :alt="editAsset.title"
                loading="eager"
              />
            </div>

            <form class="ml-edit__form" @submit.prevent="saveEdit">
              <label>
                <span>标题</span>
                <input
                  ref="editInput"
                  v-model="editingTitle"
                  maxlength="120"
                  placeholder="素材标题"
                  :disabled="savingEdit"
                />
              </label>
              <label>
                <span>分组</span>
                <select v-model="editingGroupId" :disabled="savingEdit">
                  <option value="">未分组</option>
                  <option v-for="group in groups" :key="group.id" :value="group.id">
                    {{ group.name }}
                  </option>
                </select>
              </label>
              <p class="ml-edit__hint">
                {{ formatBytes(editAsset.sizeBytes) }} · 点击卡片可预览原图
              </p>
              <footer class="ml-edit__actions">
                <button type="button" class="ml-btn is-ghost" :disabled="savingEdit" @click="closeEdit">
                  取消
                </button>
                <button type="submit" class="ml-btn is-primary" :disabled="savingEdit">
                  <i v-if="savingEdit" class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
                  {{ savingEdit ? '保存中…' : '保存' }}
                </button>
              </footer>
            </form>
          </div>
        </section>
      </div>
    </Teleport>

    <DeleteHistoryConfirmDialog
      :open="deleteConfirmOpen"
      heading="删除这项素材？"
      description="素材原图和缩略图都会移除，删除后无法恢复。"
      confirm-label="确认删除"
      icon="bi-trash3"
      tone="danger"
      :light="!appearanceStore.isDark"
      @confirm="confirmDelete"
      @close="cancelDelete"
    />

    <DeleteHistoryConfirmDialog
      :open="groupDeleteOpen"
      heading="删除这个分组？"
      description="分组内的素材不会删除，只会移到未分组。"
      confirm-label="确认删除"
      icon="bi-folder-x"
      tone="danger"
      :light="!appearanceStore.isDark"
      @confirm="confirmDeleteGroup"
      @close="cancelDeleteGroup"
    />
  </div>
</template>

<style scoped>
.ml-page {
  --ml-text: #1c1a27;
  --ml-muted: rgba(28, 26, 39, 0.55);
  --ml-line: rgba(28, 26, 39, 0.1);
  --ml-surface: rgba(255, 255, 255, 0.78);
  --ml-card: rgba(255, 255, 255, 0.94);
  --ml-accent: #6b5cff;
  --ml-accent-soft: rgba(107, 92, 255, 0.12);
  --ml-shadow: 0 18px 40px rgba(40, 30, 80, 0.07);
  position: relative;
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 28px clamp(16px, 3vw, 36px) 72px;
  color: var(--ml-text);
  overflow: clip;
}

.ml-page.is-dark {
  --ml-text: #f4f2ff;
  --ml-muted: rgba(244, 242, 255, 0.62);
  --ml-line: rgba(244, 242, 255, 0.12);
  --ml-surface: rgba(24, 22, 36, 0.78);
  --ml-card: rgba(32, 28, 48, 0.92);
  --ml-accent: #a99dff;
  --ml-accent-soft: rgba(169, 157, 255, 0.16);
  --ml-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
}

.ml-atmosphere {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.ml-atmosphere__wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(167, 139, 250, 0.22), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(125, 211, 252, 0.16), transparent 50%),
    linear-gradient(180deg, #f6f3ff 0%, #eef2ff 48%, #f8fafc 100%);
}

.ml-page.is-dark .ml-atmosphere__wash {
  background:
    radial-gradient(ellipse 70% 50% at 12% 0%, rgba(99, 102, 241, 0.28), transparent 55%),
    radial-gradient(ellipse 55% 45% at 88% 8%, rgba(56, 189, 248, 0.14), transparent 50%),
    linear-gradient(180deg, #120f1c 0%, #161325 48%, #101018 100%);
}

.ml-atmosphere__orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.55;
}

.ml-atmosphere__orb--a {
  width: 220px;
  height: 220px;
  top: 8%;
  right: 12%;
  background: rgba(167, 139, 250, 0.35);
}

.ml-atmosphere__orb--b {
  width: 180px;
  height: 180px;
  bottom: 18%;
  left: 8%;
  background: rgba(125, 211, 252, 0.28);
}

.ml-shell {
  position: relative;
  z-index: 1;
  width: min(1240px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.ml-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 8px 4px 0;
}

.ml-hero h1 {
  margin: 0;
  font-size: clamp(1.7rem, 2.6vw, 2.15rem);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.ml-hero__copy > p {
  margin: 8px 0 0;
  color: var(--ml-muted);
  font-size: 0.92rem;
}

.ml-hero__actions {
  display: flex;
  gap: 8px;
}

.ml-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.ml-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.ml-chip-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ml-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--ml-line);
  border-radius: 999px;
  background: var(--ml-surface);
  color: var(--ml-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease;
}

.ml-chip em {
  font-style: normal;
  color: var(--ml-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.ml-chip:hover {
  border-color: rgba(107, 92, 255, 0.28);
}

.ml-chip.is-active {
  border-color: transparent;
  background: var(--ml-accent);
  color: #fff;
}

.ml-chip.is-active em {
  color: rgba(255, 255, 255, 0.82);
}

.ml-chip.is-ghost {
  background: transparent;
  color: var(--ml-muted);
}

.ml-chip-ops {
  display: inline-flex;
  gap: 2px;
}

.ml-chip-ops button,
.ml-chip-edit button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ml-muted);
  cursor: pointer;
}

.ml-chip-ops button:hover {
  background: var(--ml-accent-soft);
  color: var(--ml-accent);
}

.ml-chip-ops button:last-child:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.ml-chip-edit,
.ml-chip-create {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ml-chip-edit input,
.ml-chip-create input {
  height: 32px;
  min-width: 120px;
  padding: 0 10px;
  border: 1px solid var(--ml-line);
  border-radius: 999px;
  background: var(--ml-card);
  color: var(--ml-text);
  font: inherit;
  font-size: 0.8rem;
}

.ml-chip-create button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ml-line);
  border-radius: 999px;
  background: var(--ml-card);
  color: var(--ml-text);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.ml-chip-create button[type='submit'] {
  border-color: transparent;
  background: var(--ml-accent);
  color: #fff;
}

.ml-board {
  border: 1px solid var(--ml-line);
  border-radius: 28px;
  background: var(--ml-surface);
  backdrop-filter: blur(16px);
  padding: 18px;
  box-shadow: var(--ml-shadow);
}

.ml-board__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  color: var(--ml-muted);
  font-size: 0.78rem;
  font-weight: 650;
}

.ml-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}

.ml-card {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.ml-card__media {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--ml-line);
  background: var(--ml-card);
  aspect-ratio: 1;
  transition:
    border-color 160ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
}

.ml-card:hover .ml-card__media,
.ml-card.is-menu .ml-card__media {
  border-color: rgba(107, 92, 255, 0.28);
  transform: translateY(-2px);
  box-shadow: 0 14px 28px rgba(37, 31, 75, 0.1);
}

.ml-card__cover {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.ml-card__cover :deep(img),
.ml-card__cover :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ml-card__toolbar {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%) translateY(8px);
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(16, 14, 24, 0.72);
  backdrop-filter: blur(10px);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.ml-card:hover .ml-card__toolbar,
.ml-card.is-menu .ml-card__toolbar,
.ml-card__toolbar:focus-within {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

.ml-card__toolbar button {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.ml-card__toolbar button:hover,
.ml-card__toolbar button.is-on {
  background: rgba(255, 255, 255, 0.16);
}

.ml-card__toolbar button.is-danger:hover {
  background: rgba(239, 68, 68, 0.28);
}

.ml-card__menu {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 48px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(16, 14, 24, 0.88);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
  max-height: 160px;
  overflow: auto;
}

.ml-card__menu button {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.ml-card__menu button:hover,
.ml-card__menu button.is-active {
  background: rgba(255, 255, 255, 0.12);
}

.ml-card__menu-empty {
  margin: 0;
  padding: 8px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.72rem;
  line-height: 1.4;
}

.ml-card__meta {
  display: grid;
  gap: 2px;
  padding: 0 2px;
}

.ml-card__meta strong {
  overflow: hidden;
  font-size: 0.82rem;
  font-weight: 750;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ml-card__meta small {
  color: var(--ml-muted);
  font-size: 0.7rem;
}

.ml-skel {
  aspect-ratio: 1;
  border-radius: 18px;
  background: linear-gradient(
    90deg,
    rgba(28, 26, 39, 0.04),
    rgba(28, 26, 39, 0.08),
    rgba(28, 26, 39, 0.04)
  );
  background-size: 200% 100%;
  animation: ml-shimmer 1.2s linear infinite;
}

.ml-page.is-dark .ml-skel {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.09),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
}

.ml-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 64px 16px;
  text-align: center;
  color: var(--ml-muted);
}

.ml-empty i {
  font-size: 1.6rem;
  color: var(--ml-accent);
}

.ml-empty strong {
  color: var(--ml-text);
  font-size: 1rem;
}

.ml-empty p {
  margin: 0;
  max-width: 32ch;
  font-size: 0.86rem;
  line-height: 1.5;
}

.ml-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--ml-line);
  background: #fff;
  color: var(--ml-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.ml-page.is-dark .ml-btn {
  background: rgba(255, 255, 255, 0.06);
}

.ml-btn.is-primary {
  border-color: transparent;
  background: var(--ml-accent);
  color: #fff;
}

.ml-btn.is-ghost {
  min-width: 36px;
  padding: 0 12px;
}

.ml-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.35);
  color: var(--ml-accent);
}

.ml-btn.is-danger-ghost {
  border-color: transparent;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.ml-btn.is-danger-ghost:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18);
}

.ml-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ml-more {
  width: 100%;
  margin-top: 14px;
}

.ml-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: rgba(8, 8, 12, 0.88);
  backdrop-filter: blur(18px);
  color: #f4f2ff;
}

.ml-lightbox__close {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
}

.ml-lightbox__close:hover {
  background: rgba(255, 255, 255, 0.16);
}

.ml-lightbox__stage {
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 64px 24px 20px;
  overflow: auto;
}

.ml-lightbox__stage :deep(.progressive-authenticated-image) {
  position: relative;
  display: block;
  width: min(1100px, 100%);
  height: min(72vh, 820px);
  min-height: 280px;
  border-radius: 16px;
  object-fit: contain;
  background: transparent;
}

.ml-lightbox__stage :deep(.authenticated-image),
.ml-lightbox__stage :deep(.authenticated-image-media),
.ml-lightbox__stage :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ml-lightbox__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 0 16px 16px;
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(20, 18, 28, 0.82);
  backdrop-filter: blur(12px);
}

.ml-lightbox__copy {
  min-width: 0;
  flex: 1;
}

.ml-lightbox__copy strong {
  display: block;
  overflow: hidden;
  font-size: 0.95rem;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ml-lightbox__copy small {
  color: rgba(244, 242, 255, 0.62);
  font-size: 0.76rem;
}

.ml-lightbox__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ml-lightbox .ml-btn {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ml-lightbox .ml-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.ml-edit-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 10, 16, 0.58);
  backdrop-filter: blur(12px);
}

.ml-edit {
  width: min(520px, 100%);
  border: 1px solid var(--ml-line, rgba(255, 255, 255, 0.12));
  border-radius: 22px;
  background: #17171f;
  color: rgba(255, 255, 255, 0.94);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.ml-edit-backdrop.is-light .ml-edit {
  background: #fff;
  color: #1c1a27;
  border-color: rgba(28, 26, 39, 0.1);
}

.ml-edit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ml-edit-backdrop.is-light .ml-edit__head {
  border-bottom-color: rgba(28, 26, 39, 0.08);
}

.ml-edit__head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
}

.ml-edit__head button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}

.ml-edit__head button:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.ml-edit-backdrop.is-light .ml-edit__head button:hover {
  background: rgba(28, 26, 39, 0.06);
}

.ml-edit__body {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 16px;
  padding: 18px;
}

.ml-edit__thumb {
  aspect-ratio: 1;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ml-edit-backdrop.is-light .ml-edit__thumb {
  background: rgba(28, 26, 39, 0.04);
  border-color: rgba(28, 26, 39, 0.08);
}

.ml-edit__thumb :deep(img),
.ml-edit__thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ml-edit__form {
  display: grid;
  gap: 12px;
  align-content: start;
}

.ml-edit__form label {
  display: grid;
  gap: 6px;
}

.ml-edit__form label span {
  font-size: 0.74rem;
  font-weight: 700;
  opacity: 0.62;
}

.ml-edit__form input,
.ml-edit__form select {
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
  font-size: 0.88rem;
}

.ml-edit-backdrop.is-light .ml-edit__form input,
.ml-edit-backdrop.is-light .ml-edit__form select {
  border-color: rgba(28, 26, 39, 0.12);
  background: #fff;
}

.ml-edit__hint {
  margin: 0;
  font-size: 0.74rem;
  opacity: 0.55;
}

.ml-edit__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.ml-edit .ml-btn {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: inherit;
}

.ml-edit-backdrop.is-light .ml-edit .ml-btn {
  background: #fff;
  border-color: rgba(28, 26, 39, 0.12);
  color: #1c1a27;
}

.ml-edit .ml-btn.is-primary {
  border-color: transparent;
  background: #6b5cff;
  color: #fff;
}

.ml-upload {
  width: min(480px, 100%);
}

.ml-upload__body {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.ml-upload__field {
  display: grid;
  gap: 6px;
}

.ml-upload__field span {
  font-size: 0.74rem;
  font-weight: 700;
  opacity: 0.62;
}

.ml-upload__field select {
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
  font-size: 0.88rem;
}

.ml-edit-backdrop.is-light .ml-upload__field select {
  border-color: rgba(28, 26, 39, 0.12);
  background: #fff;
}

.ml-upload__picker {
  display: grid;
  gap: 10px;
}

.ml-upload__drop {
  display: grid;
  gap: 6px;
  place-items: center;
  width: 100%;
  padding: 28px 16px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: center;
}

.ml-edit-backdrop.is-light .ml-upload__drop {
  border-color: rgba(28, 26, 39, 0.16);
  background: rgba(28, 26, 39, 0.03);
}

.ml-upload__drop:hover:not(:disabled) {
  border-color: rgba(107, 92, 255, 0.45);
  background: rgba(107, 92, 255, 0.08);
}

.ml-upload__drop:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ml-upload__drop i {
  font-size: 1.35rem;
  color: #6b5cff;
}

.ml-upload__drop strong {
  font-size: 0.9rem;
}

.ml-upload__drop small {
  opacity: 0.55;
  font-size: 0.74rem;
}

.ml-upload__files {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.ml-upload__files li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.78rem;
}

.ml-edit-backdrop.is-light .ml-upload__files li {
  background: rgba(28, 26, 39, 0.04);
}

.ml-upload__files span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ml-upload__files em {
  font-style: normal;
  opacity: 0.55;
}

.ml-upload__files button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}

.ml-upload__files button:hover:not(:disabled) {
  opacity: 1;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.spin {
  animation: ml-spin 0.9s linear infinite;
}

@keyframes ml-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ml-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 720px) {
  .ml-page {
    padding: 20px 14px 56px;
  }

  .ml-hero {
    align-items: flex-start;
  }

  .ml-hero__actions {
    width: 100%;
  }

  .ml-hero__actions .ml-btn.is-primary {
    flex: 1;
  }

  .ml-board {
    padding: 14px;
    border-radius: 22px;
  }

  .ml-card__toolbar {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0);
  }

  .ml-edit__body {
    grid-template-columns: 1fr;
  }

  .ml-edit__thumb {
    width: 120px;
  }

  .ml-lightbox__bar {
    margin: 0 12px 12px;
  }
}
</style>
