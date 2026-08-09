<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { createUserAsset, deleteUserAsset } from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import {
  createCommerceProduct,
  deleteCommerceProduct,
  listCommerceProducts,
  updateCommerceProduct,
} from '@/services/ecommerceApi'
import notificationService from '@/services/notification'

const props = defineProps({
  selectedProductId: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'close', 'clear-product'])

const platformOptions = ['Amazon', '淘宝 / 天猫', '京东', 'TikTok Shop', 'Shopify', '独立站']
const marketOptions = ['美国', '中国大陆', '英国', '日本', '德国', '法国']
const languageOptions = ['英文', '简体中文', '日文', '德文', '法文', '西班牙文']
const categoryOptions = [
  '家居用品',
  '包装食品',
  '美妆个护',
  '小家电',
  '服装鞋包',
  '数码配件',
  '宠物用品',
  '其他',
]

const products = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const cursor = ref(null)
const search = ref('')
const statusFilter = ref('active')
const loadError = ref('')
const editorOpen = ref(false)
const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const fileInput = ref(null)
const searchInput = ref(null)
const pendingFiles = ref([])
const localPreviews = ref([])
const draft = ref(createDraft())
const deleteCandidate = ref(null)
const deleting = ref(false)
const deleteCancelButton = ref(null)
const deleteTrigger = ref(null)
const discardDialogOpen = ref(false)
const discardDialogButton = ref(null)
const discardTrigger = ref(null)
const closeAfterDiscard = ref(false)
const editorSnapshot = ref('')
const statusUpdatingId = ref('')
let searchTimer = 0
let productsRequestId = 0
let productsAbortController = null

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const editorTitle = computed(() => (editingId.value ? '编辑商品资料' : '建立商品资料'))
const emptyTitle = computed(() => {
  if (search.value) return '没有匹配的商品'
  if (statusFilter.value === 'archived') return '还没有归档商品'
  return '先建立一个商品'
})
const emptyDescription = computed(() => {
  if (search.value) return '换一个关键词试试'
  if (statusFilter.value === 'archived') {
    return '归档商品不会出现在默认列表中，但资料和素材仍然保留。'
  }
  return '保存商品资料和参考图后，可以反复生成套图、详情页与营销素材。'
})
const statusOptions = [
  { value: 'active', label: '使用中' },
  { value: 'archived', label: '已归档' },
  { value: '', label: '全部' },
]
const protectedElementsText = computed({
  get: () => draft.value.protectedElements.join('、'),
  set: (value) => {
    draft.value.protectedElements = String(value || '')
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  },
})
const canSave = computed(
  () =>
    !saving.value &&
    draft.value.title.trim().length > 0 &&
    (draft.value.assetIds.length > 0 || pendingFiles.value.length > 0),
)

function createDraft(product = null) {
  return {
    sku: product?.sku || '',
    title: product?.title || '',
    brand: product?.brand || '',
    category: product?.category || '',
    sellingPoints: product?.sellingPoints || '',
    targetAudience: product?.targetAudience || '',
    material: product?.material || '',
    color: product?.color || '',
    dimensions: product?.dimensions || '',
    platform: product?.platform || 'Amazon',
    market: product?.market || '美国',
    language: product?.language || '英文',
    assetIds: Array.isArray(product?.assetIds) ? [...product.assetIds] : [],
    protectedElements: Array.isArray(product?.protectedElements)
      ? [...product.protectedElements]
      : [],
    assets: Array.isArray(product?.assets) ? [...product.assets] : [],
  }
}

function clearLocalPreviews() {
  localPreviews.value.forEach((url) => URL.revokeObjectURL(url))
  localPreviews.value = []
}

function editorStateKey() {
  return JSON.stringify({
    ...draft.value,
    assets: draft.value.assets.map((asset) => asset.id),
    pendingFiles: pendingFiles.value.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })),
  })
}

function hasEditorChanges() {
  return Boolean(editorSnapshot.value) && editorSnapshot.value !== editorStateKey()
}

function rememberEditorSnapshot() {
  editorSnapshot.value = editorStateKey()
}

function productCover(product) {
  return product?.assets?.[0]?.thumbnailUrl || product?.assets?.[0]?.url || ''
}

function productMeta(product) {
  return [product?.sku, product?.category, product?.platform].filter(Boolean).join(' · ')
}

async function loadProducts({ append = false } = {}) {
  if (append) {
    if (loadingMore.value || loading.value || !cursor.value) return
    loadingMore.value = true
  } else {
    loading.value = true
  }
  productsAbortController?.abort()
  const controller = new AbortController()
  productsAbortController = controller
  const signal = controller.signal
  const requestId = ++productsRequestId
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20_000)
  if (!append) loadError.value = ''
  try {
    const result = await listCommerceProducts({
      q: search.value.trim(),
      status: statusFilter.value,
      limit: 30,
      cursor: append ? cursor.value || '' : '',
      signal,
    })
    if (requestId !== productsRequestId) return
    products.value = append ? [...products.value, ...result.items] : result.items
    cursor.value = result.nextCursor
    loadError.value = ''
  } catch (error) {
    if (requestId !== productsRequestId) return
    if (error?.name === 'AbortError' && !timedOut) return
    loadError.value = timedOut ? '商品库读取超时，请重试' : error?.message || '商品库读取失败'
    notificationService.error(loadError.value)
  } finally {
    window.clearTimeout(timeout)
    if (requestId === productsRequestId) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function refreshProducts() {
  cursor.value = null
  loadError.value = ''
  return loadProducts()
}

function openCreate() {
  clearLocalPreviews()
  pendingFiles.value = []
  editingId.value = ''
  draft.value = createDraft()
  formError.value = ''
  rememberEditorSnapshot()
  editorOpen.value = true
}

function openEdit(product) {
  clearLocalPreviews()
  pendingFiles.value = []
  editingId.value = product.id
  draft.value = createDraft(product)
  formError.value = ''
  rememberEditorSnapshot()
  editorOpen.value = true
}

function completeCloseEditor() {
  clearLocalPreviews()
  pendingFiles.value = []
  editorOpen.value = false
  formError.value = ''
  editorSnapshot.value = ''
}

function rememberFocusTarget(event) {
  const target = event?.currentTarget || document.activeElement
  return target instanceof HTMLElement ? target : null
}

function restoreFocus(target, fallback = searchInput.value) {
  nextTick(() => {
    const candidate = target?.isConnected && !target.disabled ? target : fallback
    if (candidate?.isConnected && !candidate.disabled) candidate.focus()
  })
}

function handleDialogKeydown(event) {
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget
  const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element instanceof HTMLElement && !element.disabled && element.offsetParent !== null,
  )
  if (!focusable.length) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function requestDiscardEditor(event) {
  discardTrigger.value = rememberFocusTarget(event)
  discardDialogOpen.value = true
  nextTick(() => discardDialogButton.value?.focus())
}

function closeEditor(force = false) {
  if (saving.value && force !== true) return
  if (force !== true && hasEditorChanges()) {
    closeAfterDiscard.value = false
    requestDiscardEditor()
    return
  }
  completeCloseEditor()
}

function requestCloseLibrary(event) {
  if (!editorOpen.value || !hasEditorChanges()) {
    if (editorOpen.value) completeCloseEditor()
    emit('close')
    return
  }
  closeAfterDiscard.value = true
  requestDiscardEditor(event)
}

function cancelDiscardEditor() {
  const trigger = discardTrigger.value
  discardDialogOpen.value = false
  closeAfterDiscard.value = false
  discardTrigger.value = null
  restoreFocus(trigger)
}

function confirmDiscardEditor() {
  if (saving.value) return
  const shouldCloseLibrary = closeAfterDiscard.value
  const trigger = discardTrigger.value
  closeAfterDiscard.value = false
  discardDialogOpen.value = false
  discardTrigger.value = null
  completeCloseEditor()
  if (shouldCloseLibrary) emit('close')
  else restoreFocus(trigger)
}

function chooseFiles() {
  fileInput.value?.click()
}

function onFilesSelected(event) {
  const files = Array.from(event.target?.files || [])
  if (event.target) event.target.value = ''
  if (!files.length) return
  const available = Math.max(0, 6 - draft.value.assetIds.length - pendingFiles.value.length)
  if (!available) {
    notificationService.warning('同一商品最多保留 6 张主参考图')
    return
  }
  const valid = files.filter(
    (file) =>
      /^image\/(png|jpeg|webp)$/.test(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024,
  )
  if (valid.length !== files.length) {
    notificationService.warning('仅支持 10MB 以内的 PNG、JPG 或 WebP 图片')
  }
  if (!valid.length) return
  if (valid.length > available) notificationService.warning('同一商品最多保留 6 张主参考图')
  const next = [...pendingFiles.value, ...valid.slice(0, available)]
  pendingFiles.value = next
  clearLocalPreviews()
  localPreviews.value = pendingFiles.value.map((file) => URL.createObjectURL(file))
}

function removeExistingAsset(assetId) {
  draft.value.assetIds = draft.value.assetIds.filter((id) => id !== assetId)
  draft.value.assets = draft.value.assets.filter((asset) => asset.id !== assetId)
}

function removePendingFile(index) {
  pendingFiles.value = pendingFiles.value.filter((_, at) => at !== index)
  clearLocalPreviews()
  localPreviews.value = pendingFiles.value.map((file) => URL.createObjectURL(file))
}

async function uploadPendingAssets() {
  const added = []
  try {
    for (const [index, file] of pendingFiles.value.entries()) {
      const uploaded = await uploadFile(file)
      const asset = await createUserAsset({
        title:
          `${draft.value.title.trim() || file.name.replace(/\.[^.]+$/, '')} ${index + 1}`.slice(
            0,
            120,
          ),
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
        groupId: '',
      })
      added.push(asset)
    }
  } catch (error) {
    if (added.length) {
      await Promise.allSettled(added.map((asset) => deleteUserAsset(asset.id)))
    }
    throw error
  }
  return added
}

async function saveProduct() {
  formError.value = ''
  if (!draft.value.title.trim()) {
    formError.value = '请填写商品名称'
    return
  }
  if (!canSave.value) {
    formError.value = '至少添加一张商品参考图'
    return
  }
  saving.value = true
  const wasEditing = Boolean(editingId.value)
  let added = []
  try {
    added = pendingFiles.value.length ? await uploadPendingAssets() : []
    const assetIds = [...draft.value.assetIds, ...added.map((asset) => asset.id)].slice(0, 6)
    const payload = {
      sku: draft.value.sku,
      title: draft.value.title,
      brand: draft.value.brand,
      category: draft.value.category,
      sellingPoints: draft.value.sellingPoints,
      targetAudience: draft.value.targetAudience,
      material: draft.value.material,
      color: draft.value.color,
      dimensions: draft.value.dimensions,
      platform: draft.value.platform,
      market: draft.value.market,
      language: draft.value.language,
      assetIds,
      protectedElements: draft.value.protectedElements,
    }
    const product = editingId.value
      ? await updateCommerceProduct(editingId.value, payload)
      : await createCommerceProduct(payload)
    products.value = editingId.value
      ? products.value.map((item) => (item.id === product.id ? product : item))
      : [product, ...products.value]
    emit('select', product)
    closeEditor(true)
    notificationService.success(wasEditing ? '商品资料已更新' : '商品已建立')
  } catch (error) {
    if (added.length) {
      await Promise.allSettled(added.map((asset) => deleteUserAsset(asset.id)))
    }
    formError.value = error?.message || '商品保存失败'
  } finally {
    saving.value = false
  }
}

function selectProduct(product) {
  if (props.busy) return
  emit('select', product)
}

function requestRemoveProduct(product, event) {
  if (props.busy || !product?.id) return
  deleteTrigger.value = rememberFocusTarget(event)
  deleteCandidate.value = product
  nextTick(() => deleteCancelButton.value?.focus())
}

function closeDeleteDialog() {
  if (deleting.value) return
  const trigger = deleteTrigger.value
  deleteCandidate.value = null
  deleteTrigger.value = null
  restoreFocus(trigger)
}

async function confirmRemoveProduct() {
  const product = deleteCandidate.value
  if (deleting.value || !product?.id) return
  deleting.value = true
  try {
    await deleteCommerceProduct(product.id)
    products.value = products.value.filter((item) => item.id !== product.id)
    if (props.selectedProductId === product.id) emit('clear-product')
    deleteCandidate.value = null
    const trigger = deleteTrigger.value
    deleteTrigger.value = null
    restoreFocus(trigger)
    notificationService.success('商品已删除，关联素材仍保留在素材库')
  } catch (error) {
    notificationService.error(error?.message || '商品删除失败')
  } finally {
    deleting.value = false
  }
}

async function toggleProductStatus(product) {
  if (props.busy || statusUpdatingId.value || !product?.id) return
  const nextStatus = product.status === 'archived' ? 'active' : 'archived'
  statusUpdatingId.value = product.id
  try {
    const updated = await updateCommerceProduct(product.id, { status: nextStatus })
    if (statusFilter.value && updated.status !== statusFilter.value) {
      products.value = products.value.filter((item) => item.id !== product.id)
    } else {
      products.value = products.value.map((item) => (item.id === updated.id ? updated : item))
    }
    if (props.selectedProductId === product.id && nextStatus === 'archived') {
      emit('clear-product')
    }
    notificationService.success(nextStatus === 'archived' ? '商品已归档' : '商品已恢复')
  } catch (error) {
    notificationService.error(error?.message || '商品状态更新失败')
  } finally {
    statusUpdatingId.value = ''
  }
}

watch(
  () => search.value,
  () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => void refreshProducts(), 280)
  },
)

watch(
  () => statusFilter.value,
  () => {
    void refreshProducts()
  },
)

onMounted(() => void loadProducts())
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  productsAbortController?.abort()
  clearLocalPreviews()
})
</script>

<template>
  <section class="commerce-products" :aria-busy="loading || props.busy">
    <header class="commerce-products__header">
      <div class="commerce-products__title">
        <span class="commerce-products__icon"><i class="bi bi-box-seam"></i></span>
        <div>
          <small>商品资产中心</small>
          <h2>商品库</h2>
        </div>
      </div>
      <div class="commerce-products__actions">
        <button
          type="button"
          class="commerce-products__icon-button"
          title="刷新商品库"
          aria-label="刷新商品库"
          :disabled="loading || props.busy"
          @click="refreshProducts"
        >
          <i class="bi bi-arrow-clockwise" :class="{ 'is-spinning': loading }"></i>
        </button>
        <button
          v-if="editorOpen"
          type="button"
          class="commerce-products__ghost"
          :disabled="props.busy"
          @click="closeEditor()"
        >
          返回商品列表
        </button>
        <button
          v-else
          type="button"
          class="commerce-products__primary"
          :disabled="props.busy"
          @click="openCreate"
        >
          <i class="bi bi-plus-lg"></i>建立商品
        </button>
        <button
          type="button"
          class="commerce-products__icon-button"
          title="关闭商品库"
          aria-label="关闭商品库"
          :disabled="props.busy"
          @click="requestCloseLibrary"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </header>

    <div v-if="!editorOpen" class="commerce-products__list">
      <div class="commerce-products__toolbar">
        <label class="commerce-products__search">
          <i class="bi bi-search"></i>
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            maxlength="120"
            aria-label="搜索商品库"
            placeholder="搜索商品名、SKU、品牌或类目"
          />
        </label>
        <div class="commerce-products__toolbar-meta">
          <div class="commerce-products__status-filter" role="group" aria-label="商品状态">
            <button
              v-for="option in statusOptions"
              :key="option.value || 'all'"
              type="button"
              :class="{ active: statusFilter === option.value }"
              :aria-pressed="statusFilter === option.value"
              :disabled="loading || props.busy"
              @click="statusFilter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <span>{{ products.length }} 个商品</span>
        </div>
      </div>
      <div v-if="loadError && products.length" class="commerce-products__inline-error" role="alert">
        <span><i class="bi bi-exclamation-circle"></i>{{ loadError }}</span>
        <button type="button" @click="refreshProducts">重试</button>
      </div>

      <div v-if="loading && !products.length" class="commerce-products__skeletons">
        <span v-for="index in 6" :key="index"></span>
      </div>
      <div v-else-if="products.length" class="commerce-products__grid">
        <article
          v-for="product in products"
          :key="product.id"
          class="commerce-product-card"
          :class="{
            selected: product.id === props.selectedProductId,
            'is-archived': product.status === 'archived',
          }"
        >
          <button
            type="button"
            class="commerce-product-card__media"
            title="将商品带入创作"
            :disabled="props.busy"
            @click="selectProduct(product)"
          >
            <AuthenticatedImage
              v-if="productCover(product)"
              :src="productCover(product)"
              :alt="product.title"
              :max-dimension="420"
              loading="lazy"
            />
            <span v-else><i class="bi bi-image"></i></span>
            <b>{{ product.assets?.length || 0 }} 张参考</b>
          </button>
          <div class="commerce-product-card__body">
            <div>
              <strong>
                {{ product.title }}
                <em v-if="product.status === 'archived'">已归档</em>
              </strong>
              <small>{{ productMeta(product) || '待补充渠道资料' }}</small>
            </div>
            <div class="commerce-product-card__tags">
              <span v-if="product.brand">{{ product.brand }}</span>
              <span v-if="product.market">{{ product.market }}</span>
              <span v-if="product.language">{{ product.language }}</span>
            </div>
            <div class="commerce-product-card__actions">
              <button
                type="button"
                class="is-primary"
                :disabled="props.busy"
                @click="selectProduct(product)"
              >
                <i class="bi bi-arrow-right"></i>开始创作
              </button>
              <button
                type="button"
                :title="product.status === 'archived' ? '恢复商品' : '归档商品'"
                :aria-label="product.status === 'archived' ? '恢复商品' : '归档商品'"
                :disabled="props.busy || statusUpdatingId === product.id"
                @click="toggleProductStatus(product)"
              >
                <i
                  class="bi"
                  :class="
                    statusUpdatingId === product.id
                      ? 'bi-arrow-repeat is-spinning'
                      : product.status === 'archived'
                        ? 'bi-arrow-counterclockwise'
                        : 'bi-archive'
                  "
                ></i>
              </button>
              <button
                type="button"
                title="编辑商品"
                aria-label="编辑商品"
                :disabled="props.busy || statusUpdatingId === product.id"
                @click="openEdit(product)"
              >
                <i class="bi bi-pencil"></i>
              </button>
              <button
                type="button"
                title="删除商品"
                aria-label="删除商品"
                :disabled="props.busy"
                @click="requestRemoveProduct(product, $event)"
              >
                <i class="bi bi-trash3"></i>
              </button>
            </div>
          </div>
        </article>
      </div>
      <div v-else-if="loadError && !products.length" class="commerce-products__empty is-error">
        <span><i class="bi bi-exclamation-circle"></i></span>
        <strong>商品库读取失败</strong>
        <small>{{ loadError }}</small>
        <button type="button" class="commerce-products__primary" @click="refreshProducts">
          <i class="bi bi-arrow-clockwise"></i>重新加载
        </button>
      </div>
      <div v-else class="commerce-products__empty">
        <span><i class="bi bi-box-seam"></i></span>
        <strong>{{ emptyTitle }}</strong>
        <small>{{ emptyDescription }}</small>
        <button
          v-if="!search && statusFilter !== 'archived'"
          type="button"
          class="commerce-products__primary"
          @click="openCreate"
        >
          <i class="bi bi-plus-lg"></i>建立商品
        </button>
      </div>
      <button
        v-if="cursor"
        type="button"
        class="commerce-products__load-more"
        :disabled="loadingMore || props.busy"
        @click="loadProducts({ append: true })"
      >
        <i class="bi bi-arrow-down-circle"></i>{{ loadingMore ? '正在加载' : '加载更多' }}
      </button>
    </div>

    <form v-else class="commerce-product-editor" @submit.prevent="saveProduct">
      <div class="commerce-product-editor__intro">
        <span><i class="bi bi-pencil-square"></i></span>
        <div>
          <small>可复用的商品事实</small><strong>{{ editorTitle }}</strong>
        </div>
      </div>
      <div class="commerce-product-editor__body">
        <section class="commerce-product-editor__assets">
          <div class="commerce-product-editor__section-heading">
            <h3>商品参考图</h3>
            <small>{{ draft.assetIds.length + pendingFiles.length }}/6</small>
          </div>
          <div class="commerce-product-editor__asset-grid">
            <figure v-for="asset in draft.assets" :key="asset.id">
              <AuthenticatedImage
                :src="asset.thumbnailUrl || asset.url"
                :alt="asset.title"
                :max-dimension="260"
                loading="eager"
              />
              <button
                type="button"
                title="移除参考图"
                :aria-label="`移除${asset.title || '这张'}参考图`"
                @click="removeExistingAsset(asset.id)"
              >
                <i class="bi bi-x"></i>
              </button>
            </figure>
            <figure v-for="(url, index) in localPreviews" :key="url" class="is-local">
              <img :src="url" :alt="`待上传参考图 ${index + 1}`" />
              <button
                type="button"
                title="移除参考图"
                :aria-label="`移除待上传参考图 ${index + 1}`"
                @click="removePendingFile(index)"
              >
                <i class="bi bi-x"></i>
              </button>
            </figure>
            <button
              v-if="draft.assetIds.length + pendingFiles.length < 6"
              type="button"
              class="commerce-product-editor__add-asset"
              @click="chooseFiles"
            >
              <i class="bi bi-plus-lg"></i><small>添加图片</small>
            </button>
          </div>
          <input
            ref="fileInput"
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            @change="onFilesSelected"
          />
          <p>建议上传正面、包装和关键细节图；生成时会优先锁定这些真实信息。</p>
        </section>

        <section class="commerce-product-editor__fields">
          <div class="commerce-product-editor__section-heading">
            <h3>商品资料</h3>
            <small>用于创意和文案约束</small>
          </div>
          <div class="commerce-product-editor__field-grid">
            <label
              ><span>商品名称 *</span
              ><input v-model="draft.title" maxlength="120" placeholder="例如：便携榨汁杯"
            /></label>
            <label
              ><span>SKU</span
              ><input v-model="draft.sku" maxlength="80" placeholder="例如：BLENDER-01"
            /></label>
            <label
              ><span>品牌</span><input v-model="draft.brand" maxlength="120" placeholder="品牌名称"
            /></label>
            <label
              ><span>类目</span
              ><select v-model="draft.category">
                <option value="">选择类目</option>
                <option v-for="item in categoryOptions" :key="item" :value="item">
                  {{ item }}
                </option>
              </select></label
            >
            <label
              ><span>默认平台</span
              ><select v-model="draft.platform">
                <option v-for="item in platformOptions" :key="item" :value="item">
                  {{ item }}
                </option>
              </select></label
            >
            <label
              ><span>目标市场</span
              ><select v-model="draft.market">
                <option v-for="item in marketOptions" :key="item" :value="item">{{ item }}</option>
              </select></label
            >
            <label
              ><span>文案语言</span
              ><select v-model="draft.language">
                <option v-for="item in languageOptions" :key="item" :value="item">
                  {{ item }}
                </option>
              </select></label
            >
            <label
              ><span>颜色 / 色号</span
              ><input v-model="draft.color" maxlength="120" placeholder="例如：薄荷绿 / #B8E5D2"
            /></label>
            <label
              ><span>材质</span
              ><input v-model="draft.material" maxlength="120" placeholder="例如：食品级 Tritan"
            /></label>
            <label
              ><span>尺寸 / 规格</span
              ><input v-model="draft.dimensions" maxlength="120" placeholder="只填写已确认的参数"
            /></label>
            <label
              ><span>目标人群</span
              ><input
                v-model="draft.targetAudience"
                maxlength="120"
                placeholder="例如：通勤和健身人群"
            /></label>
          </div>
          <label class="commerce-product-editor__textarea"
            ><span>核心卖点</span
            ><textarea
              v-model="draft.sellingPoints"
              maxlength="1200"
              placeholder="只填写真实、可验证的卖点和使用场景"
            ></textarea
            ><small>{{ draft.sellingPoints.length }}/1200</small></label
          >
          <label class="commerce-product-editor__textarea"
            ><span>必须保持的细节</span
            ><textarea
              v-model="protectedElementsText"
              maxlength="600"
              placeholder="用顿号分隔，例如：Logo、按钮数量、杯体刻度"
            ></textarea
            ><small>生成时会加入商品身份锁</small></label
          >
        </section>
      </div>
      <p v-if="formError" class="commerce-product-editor__error" role="alert">{{ formError }}</p>
      <footer class="commerce-product-editor__footer">
        <button type="button" class="commerce-products__ghost" @click="closeEditor()">取消</button>
        <button type="submit" class="commerce-products__primary" :disabled="!canSave">
          <i class="bi" :class="saving ? 'bi-arrow-repeat is-spinning' : 'bi-check-lg'"></i
          >{{ saving ? '保存中' : '保存商品并使用' }}
        </button>
      </footer>
    </form>

    <div
      v-if="deleteCandidate"
      class="commerce-delete-dialog__backdrop"
      @click.self="closeDeleteDialog"
    >
      <section
        class="commerce-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="commerce-delete-dialog-title"
        aria-describedby="commerce-delete-dialog-description"
        tabindex="-1"
        @keydown="handleDialogKeydown"
        @keydown.esc="closeDeleteDialog"
      >
        <header>
          <span><i class="bi bi-trash3"></i></span>
          <button
            ref="deleteCancelButton"
            type="button"
            title="取消删除"
            aria-label="取消删除"
            :disabled="deleting"
            @click="closeDeleteDialog"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>
        <div>
          <small>删除商品资料</small>
          <h2 id="commerce-delete-dialog-title">确定删除这个商品吗？</h2>
          <p id="commerce-delete-dialog-description">
            「{{ deleteCandidate.title }}」的商品资料会被移除，关联个人素材仍会保留。
          </p>
        </div>
        <footer>
          <button
            type="button"
            class="commerce-products__ghost"
            :disabled="deleting"
            @click="closeDeleteDialog"
          >
            取消
          </button>
          <button
            type="button"
            class="commerce-delete-dialog__danger"
            :disabled="deleting"
            @click="confirmRemoveProduct"
          >
            <i class="bi" :class="deleting ? 'bi-arrow-repeat is-spinning' : 'bi-trash3'"></i>
            {{ deleting ? '删除中' : '确认删除' }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="discardDialogOpen"
      class="commerce-delete-dialog__backdrop"
      @click.self="cancelDiscardEditor"
    >
      <section
        class="commerce-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="commerce-discard-dialog-title"
        aria-describedby="commerce-discard-dialog-description"
        tabindex="-1"
        @keydown="handleDialogKeydown"
        @keydown.esc="cancelDiscardEditor"
      >
        <header>
          <span class="commerce-delete-dialog__warning"><i class="bi bi-pencil-square"></i></span>
          <button
            ref="discardDialogButton"
            type="button"
            title="继续编辑"
            aria-label="继续编辑"
            @click="cancelDiscardEditor"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </header>
        <div>
          <small>尚未保存</small>
          <h2 id="commerce-discard-dialog-title">放弃当前编辑吗？</h2>
          <p id="commerce-discard-dialog-description">已经填写的商品资料和待上传图片不会被保存。</p>
        </div>
        <footer>
          <button type="button" class="commerce-products__ghost" @click="cancelDiscardEditor">
            继续编辑
          </button>
          <button
            type="button"
            class="commerce-delete-dialog__danger"
            @click="confirmDiscardEditor"
          >
            <i class="bi bi-arrow-counterclockwise"></i>放弃修改
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.commerce-products {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  color: var(--commerce-ink, #151a2d);
  background: var(--commerce-canvas, #f7f7ff);
}
.commerce-products__header {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 24px;
  background: var(--commerce-panel, #fff);
  border-bottom: 0;
  box-shadow: 0 6px 22px rgb(58 51 112 / 4%);
}
.commerce-products__title,
.commerce-products__actions,
.commerce-products__title > div,
.commerce-product-card__actions,
.commerce-products__toolbar,
.commerce-products__toolbar-meta {
  display: flex;
  align-items: center;
}
.commerce-products__title {
  min-width: 0;
  gap: 11px;
}
.commerce-products__title > div {
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.commerce-products__title small,
.commerce-product-editor__intro small {
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
}
.commerce-products__inline-error {
  display: flex;
  width: min(1120px, 100%);
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -6px auto 14px;
  padding: 8px 10px;
  color: #b73636;
  background: color-mix(in srgb, #b73636 8%, var(--commerce-panel, #fff));
  border: 1px solid color-mix(in srgb, #b73636 20%, var(--commerce-line, #e4e3ec));
  border-radius: 7px;
  font-size: 10px;
}
.commerce-products__inline-error span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-products__inline-error button {
  flex: 0 0 auto;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  font: inherit;
  font-weight: 750;
}
.commerce-products__title h2 {
  margin: 0;
  font-size: 17px;
}
.commerce-products__icon,
.commerce-product-editor__intro > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: var(--commerce-accent-ink, #563cc8);
  background: var(--commerce-accent-soft, #f0ecff);
  border-radius: 9px;
}
.commerce-products__actions {
  gap: 8px;
}
.commerce-products__primary,
.commerce-products__ghost,
.commerce-products__icon-button {
  height: 34px;
  border-radius: 7px;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
}
.commerce-products__primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  color: #fff;
  background: var(--commerce-accent, #6a4fe0);
  border: 0;
}
.commerce-products__primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.commerce-products__primary:focus-visible,
.commerce-products__ghost:focus-visible,
.commerce-products__icon-button:focus-visible,
.commerce-products__load-more:focus-visible,
.commerce-product-card button:focus-visible,
.commerce-product-editor button:focus-visible,
.commerce-delete-dialog button:focus-visible,
.commerce-products__inline-error button:focus-visible,
.commerce-products__search:focus-within {
  outline: 3px solid color-mix(in srgb, var(--commerce-accent, #6a4fe0) 22%, transparent);
  outline-offset: 2px;
}
.commerce-products button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.commerce-products__ghost {
  padding: 0 10px;
  color: var(--commerce-ink, #151a2d);
  background: var(--commerce-soft, #f4f4f8);
  border: 0;
}
.commerce-products__icon-button {
  display: grid;
  width: 34px;
  place-items: center;
  color: var(--commerce-muted, #79809a);
  background: var(--commerce-soft, #f4f4f8);
  border: 0;
}
.commerce-products__list {
  min-height: 0;
  padding: 24px;
  overflow: auto;
}
.commerce-products__toolbar {
  justify-content: space-between;
  gap: 16px;
  margin: 0 auto 18px;
  width: min(1120px, 100%);
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
}
.commerce-products__toolbar-meta {
  gap: 12px;
  flex: 0 0 auto;
}
.commerce-products__status-filter {
  display: inline-flex;
  padding: 3px;
  background: var(--commerce-soft, #f4f4f8);
  border: 0;
  border-radius: 8px;
}
.commerce-products__status-filter button {
  min-height: 28px;
  padding: 0 9px;
  color: var(--commerce-muted, #79809a);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.commerce-products__status-filter button.active {
  color: var(--commerce-accent-ink, #563cc8);
  background: var(--commerce-panel, #fff);
  box-shadow: 0 2px 7px rgb(38 32 80 / 8%);
}
.commerce-products__search {
  display: flex;
  min-width: min(420px, 100%);
  height: 38px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  color: var(--commerce-muted, #79809a);
  background: var(--commerce-panel, #fff);
  border: 0;
  border-radius: 8px;
  box-shadow: var(--commerce-shadow-control, 0 3px 12px rgb(58 51 112 / 7%));
}
.commerce-products__search input {
  min-width: 0;
  flex: 1;
  color: var(--commerce-ink, #151a2d);
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 11px;
}
.commerce-products__grid {
  display: grid;
  width: min(1120px, 100%);
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
  margin: 0 auto;
}
.commerce-product-card {
  overflow: hidden;
  background: var(--commerce-panel, #fff);
  border: 0;
  border-radius: 8px;
  box-shadow: var(--commerce-shadow-card, 0 10px 28px rgb(58 51 112 / 8%));
}
.commerce-product-card.selected {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--commerce-accent, #6a4fe0) 24%, transparent),
    var(--commerce-shadow-card, 0 10px 28px rgb(58 51 112 / 8%));
}
.commerce-product-card.is-archived {
  opacity: 0.82;
}
.commerce-product-card__media {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1.18;
  padding: 0;
  overflow: hidden;
  background: var(--commerce-soft, #f4f4f8);
  border: 0;
}
.commerce-product-card__media :deep(.authenticated-image),
.commerce-product-card__media :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.commerce-product-card__media > span {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--commerce-muted, #79809a);
  font-size: 28px;
}
.commerce-product-card__media b {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 4px 6px;
  color: #fff;
  background: rgb(20 22 31 / 70%);
  border-radius: 5px;
  font-size: 9px;
}
.commerce-product-card__body {
  display: grid;
  gap: 10px;
  padding: 13px;
}
.commerce-product-card__body > div:first-child {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.commerce-product-card__body strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.commerce-product-card__body strong em {
  display: inline-block;
  margin-left: 5px;
  padding: 2px 5px;
  color: var(--commerce-muted, #79809a);
  background: var(--commerce-soft, #f4f4f8);
  border-radius: 4px;
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
  vertical-align: 2px;
}
.commerce-product-card__body small {
  overflow: hidden;
  color: var(--commerce-muted, #79809a);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.commerce-product-card__tags {
  display: flex;
  min-height: 20px;
  flex-wrap: wrap;
  gap: 5px;
}
.commerce-product-card__tags span {
  padding: 3px 6px;
  color: var(--commerce-accent-ink, #563cc8);
  background: var(--commerce-accent-soft, #f0ecff);
  border-radius: 4px;
  font-size: 9px;
}
.commerce-product-card__actions {
  gap: 6px;
}
.commerce-product-card__actions button {
  display: grid;
  height: 30px;
  min-width: 30px;
  place-items: center;
  color: var(--commerce-muted, #79809a);
  background: var(--commerce-soft, #f4f4f8);
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 10px;
}
.commerce-product-card__actions button.is-primary {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #fff;
  background: var(--commerce-accent, #6a4fe0);
}
.commerce-products__empty {
  display: flex;
  min-height: 380px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 auto;
  flex-direction: column;
  text-align: center;
}
.commerce-products__empty > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  color: var(--commerce-accent-ink, #563cc8);
  background: var(--commerce-accent-soft, #f0ecff);
  border-radius: 14px;
  font-size: 24px;
}
.commerce-products__empty strong {
  margin-top: 7px;
  font-size: 15px;
}
.commerce-products__empty small {
  max-width: 360px;
  color: var(--commerce-muted, #79809a);
  font-size: 11px;
  line-height: 1.5;
}
.commerce-products__empty .commerce-products__primary {
  margin-top: 9px;
}
.commerce-products__empty.is-error > span {
  color: #b73636;
  background: color-mix(in srgb, #b73636 10%, var(--commerce-panel, #fff));
}
.commerce-products__load-more {
  display: flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: min(400px, 100%);
  margin: 18px auto 0;
  color: var(--commerce-accent-ink, #563cc8);
  background: transparent;
  border: 1px solid var(--commerce-accent-line, #d9d1ff);
  border-radius: 7px;
  font: inherit;
  font-size: 10px;
}
.commerce-products__skeletons {
  display: grid;
  width: min(1120px, 100%);
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
  margin: 0 auto;
}
.commerce-products__skeletons span {
  aspect-ratio: 1.18;
  border-radius: 10px;
  background: linear-gradient(
    110deg,
    var(--commerce-soft, #f4f4f8),
    var(--commerce-soft-strong, #eeeef5),
    var(--commerce-soft, #f4f4f8)
  );
  background-size: 220% 100%;
  animation: commerce-product-shimmer 1.5s infinite;
}
.commerce-product-editor {
  min-height: 0;
  overflow: auto;
}
.commerce-product-editor__intro {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 28px;
  background: var(--commerce-panel, #fff);
  border-bottom: 1px solid var(--commerce-line, #e4e3ec);
}
.commerce-product-editor__intro > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.commerce-product-editor__intro strong {
  font-size: 16px;
}
.commerce-product-editor__body {
  display: grid;
  width: min(1120px, calc(100% - 48px));
  grid-template-columns: minmax(280px, 0.75fr) minmax(420px, 1.25fr);
  gap: 18px;
  margin: 24px auto;
}
.commerce-product-editor__assets,
.commerce-product-editor__fields {
  padding: 18px;
  background: var(--commerce-panel, #fff);
  border: 1px solid var(--commerce-line, #e4e3ec);
  border-radius: 10px;
}
.commerce-product-editor__section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.commerce-product-editor__section-heading h3 {
  margin: 0;
  font-size: 13px;
}
.commerce-product-editor__section-heading small {
  color: var(--commerce-muted, #79809a);
  font-size: 9px;
}
.commerce-product-editor__asset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.commerce-product-editor__asset-grid figure,
.commerce-product-editor__add-asset {
  position: relative;
  display: grid;
  min-width: 0;
  aspect-ratio: 1;
  place-items: center;
  margin: 0;
  overflow: hidden;
  background: var(--commerce-soft, #f4f4f8);
  border-radius: 7px;
}
.commerce-product-editor__asset-grid figure :deep(.authenticated-image),
.commerce-product-editor__asset-grid figure :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.commerce-product-editor__asset-grid figure button {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: #fff;
  background: rgb(22 24 34 / 66%);
  border: 0;
  border-radius: 5px;
}
.commerce-product-editor__add-asset {
  color: var(--commerce-accent-ink, #563cc8);
  border: 1px dashed var(--commerce-accent-line, #d9d1ff);
  font: inherit;
}
.commerce-product-editor__add-asset small {
  margin-top: 5px;
  font-size: 9px;
}
.commerce-product-editor__assets > p {
  margin: 12px 0 0;
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
  line-height: 1.5;
}
.commerce-product-editor__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.commerce-product-editor label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.commerce-product-editor label > span {
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
}
.commerce-product-editor input,
.commerce-product-editor select,
.commerce-product-editor textarea {
  width: 100%;
  min-width: 0;
  color: var(--commerce-ink, #151a2d);
  background: var(--commerce-soft, #f4f4f8);
  border: 1px solid transparent;
  border-radius: 6px;
  outline: 0;
  font: inherit;
  font-size: 11px;
}
.commerce-product-editor input,
.commerce-product-editor select {
  height: 34px;
  padding: 0 9px;
}
.commerce-product-editor textarea {
  min-height: 78px;
  padding: 9px;
  resize: vertical;
  line-height: 1.5;
}
.commerce-product-editor input:focus,
.commerce-product-editor select:focus,
.commerce-product-editor textarea:focus {
  border-color: var(--commerce-accent-line, #d9d1ff);
  box-shadow: 0 0 0 3px rgb(106 79 224 / 8%);
}
.commerce-product-editor__textarea {
  position: relative;
  margin-top: 11px;
}
.commerce-product-editor__textarea small {
  align-self: flex-end;
  margin-top: -22px;
  padding-right: 8px;
  color: var(--commerce-muted, #79809a);
  font-size: 9px;
}
.commerce-product-editor__error {
  width: min(1120px, calc(100% - 48px));
  margin: -10px auto 0;
  color: #c24343;
  font-size: 10px;
}
.commerce-product-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto 24px;
}
.commerce-delete-dialog__backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  padding: 20px;
  place-items: center;
  background: rgb(16 17 24 / 42%);
  backdrop-filter: blur(5px);
}
.commerce-delete-dialog {
  width: min(410px, 100%);
  padding: 18px;
  color: var(--commerce-ink, #151a2d);
  background: var(--commerce-panel, #fff);
  border: 1px solid var(--commerce-line, #e4e3ec);
  border-radius: 12px;
  box-shadow: 0 24px 70px rgb(26 24 46 / 22%);
}
.commerce-delete-dialog > header,
.commerce-delete-dialog > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.commerce-delete-dialog > header > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: #b73636;
  background: color-mix(in srgb, #b73636 10%, var(--commerce-panel, #fff));
  border-radius: 9px;
}
.commerce-delete-dialog > header > span.commerce-delete-dialog__warning {
  color: var(--commerce-accent-ink, #563cc8);
  background: var(--commerce-accent-soft, #f0ecff);
}
.commerce-delete-dialog > header > button {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: var(--commerce-muted, #79809a);
  background: transparent;
  border: 0;
  border-radius: 6px;
}
.commerce-delete-dialog > div {
  margin: 18px 0 20px;
}
.commerce-delete-dialog small {
  color: var(--commerce-muted, #79809a);
  font-size: 10px;
}
.commerce-delete-dialog h2 {
  margin: 5px 0 8px;
  font-size: 17px;
}
.commerce-delete-dialog p {
  margin: 0;
  color: var(--commerce-muted, #79809a);
  font-size: 11px;
  line-height: 1.6;
}
.commerce-delete-dialog > footer {
  justify-content: flex-end;
}
.commerce-delete-dialog__danger {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  color: #fff;
  background: #b73636;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
}
.is-spinning {
  animation: commerce-product-spin 1s linear infinite;
}
@keyframes commerce-product-shimmer {
  to {
    background-position: -220% 0;
  }
}
@keyframes commerce-product-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 840px) {
  .commerce-products__header {
    padding: 12px 16px;
  }
  .commerce-products__list {
    padding: 16px;
  }
  .commerce-products__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .commerce-products__toolbar-meta {
    justify-content: space-between;
  }
  .commerce-products__search {
    min-width: 0;
  }
  .commerce-product-editor__body {
    width: calc(100% - 32px);
    grid-template-columns: 1fr;
    margin: 16px auto;
  }
  .commerce-product-editor__error,
  .commerce-product-editor__footer {
    width: calc(100% - 32px);
  }
}
@media (max-width: 540px) {
  .commerce-products__title h2 {
    font-size: 15px;
  }
  .commerce-products__actions .commerce-products__ghost {
    display: none;
  }
  .commerce-products__primary {
    padding: 0 9px;
  }
  .commerce-product-editor__field-grid {
    grid-template-columns: 1fr;
  }
  .commerce-product-editor__intro {
    padding: 16px;
  }
}
</style>
