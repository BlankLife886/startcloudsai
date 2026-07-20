<script setup>
import { ref, computed } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import notificationService from '@/services/notification'

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
})

const emit = defineEmits(['close'])

// 获取收藏夹store
const favoritesStore = useFavoritesStore()

// 本地状态
const isExporting = ref(false)
const isImporting = ref(false)
const activePanel = ref('export')
const openMenu = ref(null)
const exportOptions = ref({
  includeCollections: true,
  selectedCollectionId: '',
  exportFormat: 'json',
})
const importFile = ref(null)
const fileInput = ref(null)
const importOptions = ref({
  importMode: 'merge', // 'merge' 或 'replace'
  importCollections: true,
})
const importPreview = ref(null)
const isPreviewLoading = ref(false)

const importModeOptions = [
  {
    value: 'merge',
    label: '合并',
    description: '保留现有收藏，添加新收藏',
    icon: 'intersect',
  },
  {
    value: 'replace',
    label: '替换',
    description: '清空现有收藏，仅保留导入的收藏',
    icon: 'arrow-repeat',
  },
]

function getCollectionCount(collectionId) {
  if (!collectionId) return favoritesStore.favoritesCount
  return favoritesStore.favorites.filter((item) => {
    return Array.isArray(item.collections) && item.collections.includes(collectionId)
  }).length
}

const selectedExportCount = computed(() => {
  if (!exportOptions.value.selectedCollectionId) return favoritesStore.favoritesCount
  return getCollectionCount(exportOptions.value.selectedCollectionId)
})

const exportScopeLabel = computed(() => {
  if (!exportOptions.value.selectedCollectionId) return '全部收藏'
  return (
    sortedCollections.value.find((c) => c.id === exportOptions.value.selectedCollectionId)?.name ||
    '选中收藏夹'
  )
})

const exportScopeOptions = computed(() => [
  {
    id: '',
    name: '全部收藏',
    icon: 'grid-1x2',
    count: favoritesStore.favoritesCount,
    description: '导出当前全部收藏数据',
  },
  ...sortedCollections.value.map((collection) => ({
    id: collection.id,
    name: collection.name,
    icon: collection.icon || 'folder',
    count: getCollectionCount(collection.id),
    description: `更新 ${formatShortDate(collection.updated_at)}`,
  })),
])

const selectedImportMode = computed(() => {
  return (
    importModeOptions.find((option) => option.value === importOptions.value.importMode) ||
    importModeOptions[0]
  )
})

// 计算属性：按更新时间排序的集合
const sortedCollections = computed(() => {
  return [...favoritesStore.collections].sort((a, b) => {
    return new Date(b.updated_at) - new Date(a.updated_at)
  })
})

function formatShortDate(dateString) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return '最近更新'
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  })
}

function toggleMenu(menuName) {
  if (openMenu.value === menuName) {
    closeMenus()
    return
  }

  openMenu.value = menuName
}

function closeMenus() {
  openMenu.value = null
}

function selectExportScope(collectionId) {
  exportOptions.value.selectedCollectionId = collectionId
  closeMenus()
}

function selectImportMode(mode) {
  importOptions.value.importMode = mode
  closeMenus()
}

function setActivePanel(panel) {
  activePanel.value = panel
  closeMenus()
}

// 导出收藏
function exportFavorites() {
  isExporting.value = true

  try {
    // 获取选中的收藏夹信息
    let collectionName = null
    if (exportOptions.value.selectedCollectionId) {
      const collection = favoritesStore.collections.find(
        (c) => c.id === exportOptions.value.selectedCollectionId,
      )
      if (collection) {
        collectionName = collection.name
      }
    }

    // 导出收藏
    const result = favoritesStore.exportFavorites({
      includeCollections: exportOptions.value.includeCollections,
      collectionId: exportOptions.value.selectedCollectionId,
      collectionName: collectionName,
    })

    if (result) {
      notificationService.success('收藏导出成功', {
        duration: 3000,
        position: 'top-right',
      })
    } else {
      notificationService.error('收藏导出失败', {
        duration: 3000,
        position: 'top-right',
      })
    }
  } catch (error) {
    console.error('导出收藏失败:', error)
    notificationService.error('导出收藏失败: ' + (error.message || '未知错误'), {
      duration: 3000,
      position: 'top-right',
    })
  } finally {
    isExporting.value = false
  }
}

// 触发文件选择
function triggerFileInput() {
  if (fileInput.value) {
    fileInput.value.click()
  }
}

// 处理文件选择
function handleFileSelect(event) {
  const file = event.target.files[0]
  if (!file) return

  // 检查文件大小
  if (file.size > 10 * 1024 * 1024) {
    // 10MB限制
    notificationService.error('文件过大，请选择小于10MB的文件', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  // 检查文件类型
  if (!file.name.endsWith('.json')) {
    notificationService.error('请选择JSON格式的文件', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  importFile.value = file

  // 预览导入文件
  previewImportFile(file)
}

// 预览导入文件 - 简化版本，减少嵌套和复杂性
async function previewImportFile(file) {
  // 设置加载状态
  isPreviewLoading.value = true
  importPreview.value = null

  // 创建文件读取器
  const reader = new FileReader()

  // 设置读取完成回调
  reader.onload = function () {
    let data = null

    // 尝试解析JSON
    try {
      data = JSON.parse(reader.result)
    } catch (error) {
      handlePreviewError('JSON解析失败，请确保文件格式正确')
      return
    }

    // 基本验证
    if (!data || typeof data !== 'object') {
      handlePreviewError('导入数据无效，不是有效的JSON对象')
      return
    }

    // 验证favorites字段
    if (!data.favorites || !Array.isArray(data.favorites)) {
      handlePreviewError('导入数据无效，缺少favorites数组')
      return
    }

    // 设置预览数据
    importPreview.value = {
      favoritesCount: data.favorites.length,
      collectionsCount: data.collections ? data.collections.length : 0,
      version: data.version || '未知',
      exportedAt: data.exported_at ? new Date(data.exported_at).toLocaleString() : '未知',
    }

    // 完成加载
    isPreviewLoading.value = false
  }

  // 设置读取错误回调
  reader.onerror = function () {
    handlePreviewError('文件读取失败，请检查文件是否损坏')
  }

  // 开始读取文件
  try {
    reader.readAsText(file)
  } catch (error) {
    handlePreviewError('无法读取文件: ' + (error.message || '未知错误'))
  }
}

// 处理预览错误的辅助函数
function handlePreviewError(message) {
  console.error('预览错误:', message)

  notificationService.error('预览导入文件失败: ' + message, {
    duration: 3000,
    position: 'top-right',
  })

  // 重置状态
  importFile.value = null
  isPreviewLoading.value = false
}

// 导入收藏 - 简化版本，减少嵌套和复杂性
function importFavorites() {
  // 检查是否选择了文件
  if (!importFile.value) {
    notificationService.error('请先选择导入文件', {
      duration: 3000,
      position: 'top-right',
    })
    return
  }

  // 设置导入状态
  isImporting.value = true

  // 创建文件读取器
  const reader = new FileReader()

  // 设置读取完成回调
  reader.onload = function () {
    let data = null

    // 尝试解析JSON
    try {
      data = JSON.parse(reader.result)
    } catch (error) {
      handleImportError('JSON解析失败，请确保文件格式正确')
      return
    }

    // 基本验证
    if (!data || typeof data !== 'object') {
      handleImportError('导入数据无效，不是有效的JSON对象')
      return
    }

    // 验证favorites字段
    if (!data.favorites || !Array.isArray(data.favorites)) {
      handleImportError('导入数据无效，缺少favorites数组')
      return
    }

    // 执行导入
    try {
      // 调用store的导入方法
      const result = favoritesStore.importFavorites(data, {
        mode: importOptions.value.importMode,
        importCollections: importOptions.value.importCollections,
      })

      // 处理导入结果
      if (result && result.success) {
        // 导入成功
        const message =
          `成功导入 ${result.importedCount} 个收藏` +
          (result.importedCollections ? ` 和 ${result.importedCollections} 个收藏夹` : '')

        notificationService.success(message, {
          duration: 5000,
          position: 'top-right',
        })

        // 关闭对话框
        isImporting.value = false
        emit('close')
      } else {
        // 导入失败
        handleImportError(result.message || '导入过程中发生未知错误')
      }
    } catch (error) {
      // 捕获导入过程中的异常
      handleImportError('导入过程中发生异常: ' + (error.message || '未知错误'))
    }
  }

  // 设置读取错误回调
  reader.onerror = function () {
    handleImportError('文件读取失败，请检查文件是否损坏')
  }

  // 开始读取文件
  try {
    reader.readAsText(importFile.value)
  } catch (error) {
    handleImportError('无法读取文件: ' + (error.message || '未知错误'))
  }
}

// 处理导入错误的辅助函数
function handleImportError(message) {
  console.error('导入错误:', message)

  notificationService.error('导入收藏失败: ' + message, {
    duration: 5000,
    position: 'top-right',
  })

  // 重置状态
  isImporting.value = false
  importFile.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 关闭对话框
function closeModal() {
  closeMenus()
  emit('close')
}
</script>

<template>
  <Transition name="export-import">
    <div class="export-import-backdrop" v-if="show" @click="closeModal">
      <div
        class="export-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-import-title"
        @click.stop
      >
        <div class="modal-header">
          <div class="modal-title-wrap">
            <span class="modal-title-icon">
              <i class="bi bi-file-earmark-arrow-up-down"></i>
            </span>
            <div>
              <h5 id="export-import-title" class="modal-title">导入/导出收藏</h5>
              <p class="modal-subtitle">备份收藏数据，或从 JSON 文件恢复收藏列表。</p>
            </div>
          </div>
          <button type="button" class="btn-close" title="关闭" @click="closeModal"></button>
        </div>

        <div class="modal-body">
          <div class="export-tabs" role="tablist" aria-label="导入导出模式">
            <button
              class="export-tab"
              :class="{ active: activePanel === 'export' }"
              type="button"
              role="tab"
              :aria-selected="activePanel === 'export'"
              @click="setActivePanel('export')"
            >
              <i class="bi bi-box-arrow-down"></i>
              <span>导出收藏</span>
            </button>
            <button
              class="export-tab"
              :class="{ active: activePanel === 'import' }"
              type="button"
              role="tab"
              :aria-selected="activePanel === 'import'"
              @click="setActivePanel('import')"
            >
              <i class="bi bi-box-arrow-in-up"></i>
              <span>导入收藏</span>
            </button>
          </div>

          <!-- 导出选项 -->
          <div v-if="activePanel === 'export'" class="export-options">
            <div class="export-overview">
              <div>
                <span>导出范围</span>
                <strong>{{ exportScopeLabel }}</strong>
              </div>
              <div>
                <span>收藏数量</span>
                <strong>{{ selectedExportCount }}</strong>
              </div>
              <div>
                <span>收藏夹</span>
                <strong>{{
                  exportOptions.includeCollections ? sortedCollections.length : 0
                }}</strong>
              </div>
            </div>

            <div class="form-block">
              <label class="form-label">导出范围</label>
              <div class="custom-select" :class="{ open: openMenu === 'exportScope' }">
                <button
                  class="custom-select-trigger"
                  type="button"
                  :aria-expanded="openMenu === 'exportScope'"
                  @click="toggleMenu('exportScope')"
                >
                  <span class="custom-select-icon">
                    <i
                      class="bi"
                      :class="
                        exportOptions.selectedCollectionId
                          ? `bi-${
                              sortedCollections.find(
                                (item) => item.id === exportOptions.selectedCollectionId,
                              )?.icon || 'folder'
                            }`
                          : 'bi-grid-1x2'
                      "
                    ></i>
                  </span>
                  <span class="custom-select-copy">
                    <strong>{{ exportScopeLabel }}</strong>
                    <small>{{ selectedExportCount }} 项</small>
                  </span>
                  <i class="bi bi-chevron-down custom-select-chevron"></i>
                </button>

                <div v-if="openMenu === 'exportScope'" class="custom-select-menu">
                  <button
                    v-for="option in exportScopeOptions"
                    :key="option.id || 'all'"
                    class="custom-select-option"
                    :class="{ active: exportOptions.selectedCollectionId === option.id }"
                    type="button"
                    @click="selectExportScope(option.id)"
                  >
                    <span class="custom-select-icon">
                      <i class="bi" :class="`bi-${option.icon}`"></i>
                    </span>
                    <span class="custom-select-copy">
                      <strong>{{ option.name }}</strong>
                      <small>{{ option.description }}</small>
                    </span>
                    <span class="custom-select-count">{{ option.count }} 项</span>
                  </button>
                </div>
              </div>
            </div>

            <label class="option-row option-card" for="include-collections">
              <input
                type="checkbox"
                class="form-check-input"
                id="include-collections"
                v-model="exportOptions.includeCollections"
              />
              <div>
                <span class="form-check-label">包含收藏夹结构</span>
                <div class="form-text">导出时包含收藏夹信息，便于后续导入时保留收藏夹结构。</div>
              </div>
            </label>

            <div class="info-panel">
              <i class="bi bi-info-circle"></i>
              <span>
                将导出 <strong>{{ selectedExportCount }}</strong> 个收藏{{
                  exportOptions.includeCollections ? '和收藏夹结构' : ''
                }}。
              </span>
            </div>

            <div class="primary-action-row">
              <button
                class="btn btn-primary"
                type="button"
                @click="exportFavorites"
                :disabled="isExporting || selectedExportCount === 0"
              >
                <span
                  v-if="isExporting"
                  class="spinner-border spinner-border-sm me-1"
                  role="status"
                ></span>
                导出收藏
              </button>
            </div>
          </div>

          <!-- 导入选项 -->
          <div v-else class="import-options">
            <div class="form-block">
              <label class="form-label">选择导入文件</label>
              <button class="import-file-card" type="button" @click="triggerFileInput">
                <span class="import-file-icon">
                  <i class="bi" :class="importFile ? 'bi-filetype-json' : 'bi-cloud-arrow-up'"></i>
                </span>
                <span class="import-file-copy">
                  <strong>{{ importFile ? importFile.name : '选择 JSON 收藏备份文件' }}</strong>
                  <small>支持 .json 文件，最大 10MB</small>
                </span>
                <span class="import-file-action">浏览</span>
                <input
                  type="file"
                  ref="fileInput"
                  style="display: none"
                  accept=".json"
                  @change="handleFileSelect"
                />
              </button>
              <div class="form-text mt-2">
                <a href="/example_favorites.json" target="_blank">
                  <i class="bi bi-info-circle"></i>
                  查看示例导入文件格式
                </a>
              </div>
            </div>

            <div v-if="importPreview" class="import-preview">
              <div class="info-panel preview-panel">
                <h6>导入文件信息</h6>
                <div class="preview-grid">
                  <div>
                    <span>收藏数量</span><strong>{{ importPreview.favoritesCount }}</strong>
                  </div>
                  <div>
                    <span>收藏夹数量</span><strong>{{ importPreview.collectionsCount }}</strong>
                  </div>
                  <div>
                    <span>版本</span><strong>{{ importPreview.version }}</strong>
                  </div>
                  <div>
                    <span>导出时间</span><strong>{{ importPreview.exportedAt }}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="isPreviewLoading" class="import-loading">
              <div class="spinner-border spinner-border-sm" role="status">
                <span class="visually-hidden">加载中...</span>
              </div>
              <span>正在解析导入文件...</span>
            </div>

            <div class="form-block">
              <label class="form-label">导入模式</label>
              <div class="custom-select" :class="{ open: openMenu === 'importMode' }">
                <button
                  class="custom-select-trigger"
                  type="button"
                  :aria-expanded="openMenu === 'importMode'"
                  @click="toggleMenu('importMode')"
                >
                  <span class="custom-select-icon">
                    <i class="bi" :class="`bi-${selectedImportMode.icon}`"></i>
                  </span>
                  <span class="custom-select-copy">
                    <strong>{{ selectedImportMode.label }}</strong>
                    <small>{{ selectedImportMode.description }}</small>
                  </span>
                  <i class="bi bi-chevron-down custom-select-chevron"></i>
                </button>

                <div v-if="openMenu === 'importMode'" class="custom-select-menu">
                  <button
                    v-for="option in importModeOptions"
                    :key="option.value"
                    class="custom-select-option"
                    :class="{ active: importOptions.importMode === option.value }"
                    type="button"
                    @click="selectImportMode(option.value)"
                  >
                    <span class="custom-select-icon">
                      <i class="bi" :class="`bi-${option.icon}`"></i>
                    </span>
                    <span class="custom-select-copy">
                      <strong>{{ option.label }}</strong>
                      <small>{{ option.description }}</small>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <label class="option-row option-card" for="import-collections">
              <input
                type="checkbox"
                class="form-check-input"
                id="import-collections"
                v-model="importOptions.importCollections"
              />
              <div>
                <span class="form-check-label">导入收藏夹结构</span>
                <div class="form-text">如果导入文件包含收藏夹信息，将一并导入收藏夹结构。</div>
              </div>
            </label>

            <div class="primary-action-row">
              <button class="btn btn-primary" @click="importFavorites" :disabled="isImporting">
                <span
                  v-if="isImporting"
                  class="spinner-border spinner-border-sm me-1"
                  role="status"
                ></span>
                导入收藏
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.export-import-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background-color: rgba(0, 0, 0, 0.72);
  background:
    radial-gradient(circle at center, rgba(13, 110, 253, 0.13), transparent 42%),
    rgba(0, 0, 0, 0.66);
  z-index: 5000;
}

.export-import-modal {
  position: relative;
  width: min(640px, 100%);
  max-height: min(820px, calc(100svh - 48px));
  display: flex;
  flex-direction: column;
  overflow: visible;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background-color: #101314;
  background: linear-gradient(135deg, rgba(13, 110, 253, 0.1), transparent 38%), #101314;
  color: #ffffff;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
}

@supports not (color: color-mix(in srgb, #000, #fff)) {
  .export-import-modal {
    background: linear-gradient(135deg, rgba(13, 110, 253, 0.12), transparent 38%), #101314;
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 58px 12px 18px;
  border-bottom: none;
}

.modal-title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.modal-title-icon {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 13px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.22);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.modal-title {
  margin: 0;
  color: #ffffff;
  font-size: 1.12rem;
  font-weight: 800;
}

.modal-subtitle {
  margin: 4px 0 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.82rem;
  line-height: 1.35;
}

.btn-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 10px;
  opacity: 1;
  background: rgba(255, 255, 255, 0.08) !important;
  color: #ffffff;
  filter: none;
  font-size: 0;
}

.btn-close::before {
  content: '×';
  color: #ffffff;
  font-size: 1.5rem;
  line-height: 1;
}

.btn-close:hover {
  background-color: rgba(var(--primary-color-rgb), 0.18);
}

.modal-body {
  min-height: 0;
  padding: 8px 18px 14px;
  overflow: visible;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
}

.modal-body::-webkit-scrollbar {
  width: 8px;
}

.modal-body::-webkit-scrollbar-track {
  background: transparent;
}

.modal-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.export-options,
.import-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
}

.export-summary,
.import-preview {
  margin: 0;
}

.export-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 14px;
  padding: 4px;
  list-style: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.055);
}

.export-tab {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  border: none;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.7);
  background: transparent;
  font-weight: 700;
  text-decoration: none;
}

.export-tab:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.export-tab.active {
  color: #ffffff;
  background: var(--primary-color);
}

.export-overview,
.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.export-overview > div,
.preview-grid > div {
  min-width: 0;
  padding: 11px 12px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.055);
}

.export-overview span,
.preview-grid span {
  display: block;
  color: rgba(255, 255, 255, 0.56);
  font-size: 0.72rem;
}

.export-overview strong,
.preview-grid strong {
  display: block;
  margin-top: 4px;
  color: #ffffff;
  font-size: 0.95rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.form-block {
  margin: 0;
}

.form-label {
  margin-bottom: 6px;
  color: #ffffff;
  font-size: 0.86rem;
  font-weight: 650;
}

.form-control {
  min-height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background-color: rgba(255, 255, 255, 0.08) !important;
  color: #ffffff !important;
  caret-color: #ffffff;
}

.form-control {
  padding: 8px 12px;
}

.form-control:focus {
  background-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 0 0 2px rgba(var(--primary-color-rgb), 0.28);
  outline: none;
}

.form-control::placeholder {
  color: rgba(255, 255, 255, 0.5) !important;
}

.custom-select {
  position: relative;
}

.custom-select.open {
  z-index: 80;
}

.custom-select-trigger {
  width: 100%;
  min-height: 50px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
  text-align: left;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.custom-select-trigger:hover,
.custom-select.open .custom-select-trigger {
  border-color: rgba(var(--primary-color-rgb), 0.32);
  background: rgba(255, 255, 255, 0.085);
  box-shadow: 0 0 0 2px rgba(var(--primary-color-rgb), 0.12);
}

.custom-select-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 10px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.18);
}

.custom-select-copy {
  min-width: 0;
}

.custom-select-copy strong,
.custom-select-copy small {
  display: block;
}

.custom-select-copy strong {
  color: #ffffff;
  font-size: 0.9rem;
  font-weight: 760;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-copy small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.74rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-select-chevron {
  color: rgba(255, 255, 255, 0.55);
  transition: transform 0.2s ease;
}

.custom-select.open .custom-select-chevron {
  transform: rotate(180deg);
}

.custom-select-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 90;
  max-height: 250px;
  display: grid;
  gap: 5px;
  padding: 7px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: #121617;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.62);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.24) transparent;
}

.custom-select-menu::-webkit-scrollbar {
  width: 8px;
}

.custom-select-menu::-webkit-scrollbar-track {
  background: transparent;
}

.custom-select-menu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.custom-select-option {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: none;
  border-radius: 10px;
  color: #ffffff;
  background: transparent;
  text-align: left;
}

.custom-select-option:hover {
  background: rgba(255, 255, 255, 0.07);
}

.custom-select-option.active {
  background: rgba(var(--primary-color-rgb), 0.2);
}

.custom-select-count {
  flex: 0 0 auto;
  padding: 4px 7px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.72rem;
  font-weight: 800;
}

.import-file-card {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 13px;
  text-align: left;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.055);
}

.import-file-card:hover {
  border-color: rgba(var(--primary-color-rgb), 0.42);
  background: rgba(var(--primary-color-rgb), 0.1);
}

.import-file-icon {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.2);
  font-size: 1.25rem;
}

.import-file-copy {
  min-width: 0;
}

.import-file-copy strong,
.import-file-copy small {
  display: block;
}

.import-file-copy strong {
  overflow: hidden;
  color: #ffffff;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-file-copy small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.56);
}

.import-file-action {
  padding: 7px 10px;
  border-radius: 9px;
  color: #ffffff;
  background: rgba(var(--primary-color-rgb), 0.24);
  font-weight: 700;
}

.option-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  align-items: flex-start;
  margin: 0;
}

.option-card {
  padding: 12px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.045);
  cursor: pointer;
}

.form-check-input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  border: none;
  background-color: rgba(255, 255, 255, 0.14);
}

.form-check-input:checked {
  background-color: var(--primary-color);
}

.form-check-label {
  color: #ffffff;
  font-weight: 650;
}

.form-text {
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
}

.form-text a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-color);
  text-decoration: none;
}

.info-panel {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.84);
  background: rgba(var(--primary-color-rgb), 0.14);
}

.info-panel > i {
  color: var(--primary-color);
  margin-top: 2px;
}

.info-panel strong {
  color: #ffffff;
}

.preview-panel {
  display: block;
}

.preview-panel h6 {
  margin: 0 0 10px;
  color: #ffffff;
  font-weight: 800;
}

.preview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.import-loading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.74);
  background: rgba(255, 255, 255, 0.045);
}

.primary-action-row {
  display: grid;
}

.primary-action-row .btn-primary {
  min-height: 42px;
  border: none;
  border-radius: 10px;
  color: #ffffff;
  background: var(--primary-color);
  font-weight: 750;
}

.primary-action-row .btn-primary:disabled {
  opacity: 0.5;
}

.spinner-border {
  color: var(--primary-color);
}

.export-import-enter-active,
.export-import-leave-active {
  transition: opacity 0.18s ease;
}

.export-import-enter-active .export-import-modal,
.export-import-leave-active .export-import-modal {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.export-import-enter-from,
.export-import-leave-to {
  opacity: 0;
}

.export-import-enter-from .export-import-modal,
.export-import-leave-to .export-import-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 640px) {
  .export-import-backdrop {
    padding: 12px;
  }

  .export-import-modal {
    max-height: calc(100svh - 24px);
  }

  .modal-header {
    padding: 16px 54px 8px 14px;
  }

  .modal-body {
    padding: 8px 14px 12px;
  }

  .export-overview,
  .preview-grid {
    grid-template-columns: 1fr;
  }

  .import-file-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .import-file-action {
    grid-column: 1 / -1;
    text-align: center;
  }
}
</style>
