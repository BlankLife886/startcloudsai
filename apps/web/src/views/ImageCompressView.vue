<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import { taskCoverUrl, taskOriginalUrl } from '@/features/creator-hub/taskMedia'
import {
  analyzeLossyImageFile,
  COMPRESS_MODE_OPTIONS,
  compressImageFile,
  downloadBlob,
  downloadBlobsAsZip,
  formatBytes,
  ICON_TARGET_BYTES,
  INTENSITY_OPTIONS,
  isAcceptedImageFile,
  isIconMaxEdge,
  LOSSY_FORMAT_OPTIONS,
  makePreviewDataUrl,
  MAX_EDGE_OPTIONS,
  MAX_FILE_BYTES,
  outputFilename,
  savingsPercent,
  terminateCompressWorker,
} from '@/features/image-compress/compressEngine'
import {
  clearCompressHistory,
  loadCompressHistory,
  loadCompressResultBlob,
  prependCompressHistory,
  saveCompressResultBlob,
} from '@/features/image-compress/compressHistory'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { removeImageBackground, uploadAiInputFile } from '@/services/aiWallpaper'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const router = useRouter()
const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()
const runtimeConfigStore = useRuntimeConfigStore()
const { availableCents, refreshWalletBalance } = useClientWalletBalance()
const fileInput = ref(null)
const items = ref([])
const selectedId = ref('')
const compressMode = ref('lossy')
const outputFormat = ref('webp')
const maxEdge = ref(0)
const intensity = ref('balanced')
const keepIfLarger = ref(true)
const dragging = ref(false)
const compressing = ref(false)
const historyItems = ref(loadCompressHistory())
const historyFocus = ref(null)
const zipBusy = ref(false)
const removingBg = ref(false)
const removeBgStage = ref('')
const costConfirmOpen = ref(false)
const pendingCost = ref(null)
let runToken = 0
let removeBgController = null

const toolModels = computed(() => {
  const models = runtimeConfigStore.getFeaturePayload('ai.imageTools')?.backgroundRemovalModels
  return Array.isArray(models) ? models.filter((model) => model?.id) : []
})
const activeRemoveTool = computed(
  () => toolModels.value.find((model) => model.default === true) || toolModels.value[0] || null,
)
const removeUnitPrice = computed(() => Math.max(0, Number(activeRemoveTool.value?.pricePoints || 0)))

const isLossyMode = computed(() => compressMode.value === 'lossy')
const selected = computed(() => items.value.find((item) => item.id === selectedId.value) || null)
const canRemoveSelectedBg = computed(
  () =>
    Boolean(selected.value?.file) &&
    !compressing.value &&
    !removingBg.value &&
    !historyFocus.value,
)
const iconBudgetActive = computed(
  () => isLossyMode.value && isIconMaxEdge(maxEdge.value),
)

function applyIconPreset(edge = 256) {
  if (compressing.value) return
  compressMode.value = 'lossy'
  outputFormat.value = 'webp'
  maxEdge.value = edge
  keepIfLarger.value = false
  notificationService.success(`已切换图标模式：最长边 ${edge}，目标约 4–10KB`)
}
const recentHistory = computed(() => (historyItems.value || []).slice(0, 5))
const activeHistoryId = computed(() => historyFocus.value?.entry?.id || '')
const doneItems = computed(() => items.value.filter((item) => item.status === 'done' && item.resultBlob))
const pendingCount = computed(
  () => items.value.filter((item) => item.status === 'queued' || item.status === 'compressing').length,
)
const totalBefore = computed(() =>
  doneItems.value.reduce((sum, item) => sum + (item.beforeBytes || 0), 0),
)
const totalAfter = computed(() =>
  doneItems.value.reduce((sum, item) => sum + (item.afterBytes || 0), 0),
)
const totalSavedLabel = computed(() => {
  if (!doneItems.value.length) return '尚未压缩'
  const saved = Math.max(0, totalBefore.value - totalAfter.value)
  const ratio = savingsPercent(totalBefore.value, totalAfter.value)
  return `已节省 ${formatBytes(saved)}（${ratio}%）`
})
const totalRatio = computed(() => savingsPercent(totalBefore.value, totalAfter.value))
const selectedVariants = computed(() => selected.value?.variants || [])

function clearItemResult(item) {
  if (!item) return
  if (item.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(item.resultUrl)
  item.resultUrl = ''
  item.resultBlob = null
  item.afterBytes = 0
  item.keptOriginal = false
  item.resized = false
  item.variants = []
  item.selectedVariantId = ''
  item.recommendedVariantId = ''
  item.progressLabel = ''
}

function applyVariantToItem(item, variant) {
  if (!item || !variant?.blob) return
  if (item.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(item.resultUrl)
  item.resultBlob = variant.blob
  item.resultUrl = URL.createObjectURL(variant.blob)
  item.afterBytes = variant.bytes
  item.format = variant.format
  item.selectedVariantId = variant.id
  item.keptOriginal = false
}

function createId() {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function revokeItemUrls(item) {
  if (item?.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(item.sourceUrl)
  if (item?.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(item.resultUrl)
}

function clearHistoryFocus() {
  if (historyFocus.value?.resultUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(historyFocus.value.resultUrl)
  }
  historyFocus.value = null
}

function selectItem(id) {
  clearHistoryFocus()
  selectedId.value = id
}

function addFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean)
  if (!files.length) return
  let added = 0
  for (const file of files) {
    if (!isAcceptedImageFile(file)) {
      notificationService.warning(`已跳过不支持的文件：${file.name || '未命名'}`)
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      notificationService.warning(`${file.name || '图片'}超过 30MB，已跳过`)
      continue
    }
    const id = createId()
    const sourceUrl = URL.createObjectURL(file)
    items.value.push({
      id,
      file,
      name: file.name || `paste-${Date.now()}.png`,
      sourceUrl,
      resultUrl: '',
      resultBlob: null,
      status: 'queued',
      error: '',
      width: 0,
      height: 0,
      beforeBytes: file.size,
      afterBytes: 0,
      keptOriginal: false,
      resized: false,
      format: outputFormat.value,
      variants: [],
      selectedVariantId: '',
      recommendedVariantId: '',
      progressLabel: '',
      appliedSettings: '',
    })
    added += 1
    if (!selectedId.value) selectedId.value = id
  }
  if (added) notificationService.success(`已添加 ${added} 张图片`)
}

function handleFileChange(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function handleDrop(event) {
  dragging.value = false
  addFiles(event.dataTransfer?.files)
}

function extractClipboardImages(clipboard) {
  if (!clipboard) return []
  const fromItems = Array.from(clipboard.items || [])
    .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (fromItems.length) return fromItems
  return Array.from(clipboard.files || []).filter((file) => file?.type?.startsWith('image/'))
}

function handlePaste(event) {
  if (compressing.value || removingBg.value || costConfirmOpen.value) return
  const target = event.target
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  const images = extractClipboardImages(event.clipboardData)
  if (!images.length) return
  event.preventDefault()
  const named = images.map((image, index) => {
    const extension = String(image.type || '').includes('jpeg')
      ? 'jpg'
      : String(image.type || '').includes('webp')
        ? 'webp'
        : 'png'
    if (image.name && image.name !== 'image.png') return image
    return new File([image], `paste-${Date.now()}-${index + 1}.${extension}`, {
      type: image.type || 'image/png',
      lastModified: Date.now(),
    })
  })
  addFiles(named)
}

function removeItem(id) {
  const index = items.value.findIndex((item) => item.id === id)
  if (index < 0) return
  const [removed] = items.value.splice(index, 1)
  revokeItemUrls(removed)
  if (selectedId.value === id) {
    selectedId.value = items.value[index]?.id || items.value[index - 1]?.id || ''
  }
}

function clearQueue() {
  if (compressing.value) return
  items.value.forEach(revokeItemUrls)
  items.value = []
  selectedId.value = ''
}

function clearDone() {
  if (compressing.value) return
  const remain = []
  for (const item of items.value) {
    if (item.status === 'done') revokeItemUrls(item)
    else remain.push(item)
  }
  items.value = remain
  if (!remain.some((item) => item.id === selectedId.value)) {
    selectedId.value = remain[0]?.id || ''
  }
}

async function compressOneLossless(item, token) {
  const result = await compressImageFile(item.file, {
    format: outputFormat.value === 'png' ? 'png' : 'webp',
    keepIfLarger: keepIfLarger.value,
    maxEdge: maxEdge.value,
    intensity: intensity.value,
  })
  if (token !== runToken) return
  if (item.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(item.resultUrl)
  item.resultBlob = result.blob
  item.resultUrl = URL.createObjectURL(result.blob)
  item.beforeBytes = result.beforeBytes
  item.afterBytes = result.afterBytes
  item.width = result.width
  item.height = result.height
  item.keptOriginal = result.keptOriginal
  item.resized = result.resized
  item.format = result.format
  item.variants = []
  item.selectedVariantId = ''
  item.recommendedVariantId = ''
  item.status = 'done'
  return result
}

async function compressOneLossy(item, token) {
  const result = await analyzeLossyImageFile(item.file, {
    format: outputFormat.value,
    maxEdge: maxEdge.value,
    onProgress: (done, total) => {
      if (token !== runToken) return
      item.progressLabel = `分析 ${done}/${total}`
    },
  })
  if (token !== runToken) return
  item.beforeBytes = result.beforeBytes
  item.width = result.width
  item.height = result.height
  item.resized = result.resized
  item.variants = result.variants
  item.recommendedVariantId = result.recommended?.id || ''
  const pick = result.recommended || result.variants[0]
  if (!pick) throw new Error('未生成可用压缩结果')
  applyVariantToItem(item, pick)
  item.status = 'done'
  return {
    blob: pick.blob,
    format: pick.format,
    beforeBytes: result.beforeBytes,
    afterBytes: pick.bytes,
    width: result.width,
    height: result.height,
    keptOriginal: false,
  }
}

async function compressOne(item, token) {
  item.status = 'compressing'
  item.error = ''
  item.progressLabel = isLossyMode.value ? '分析中…' : ''
  // 只清当前这张的旧结果，避免一点「开始压缩」就把整队结果抹掉
  clearItemResult(item)
  const applied = settingsFingerprint()
  try {
    const result = isLossyMode.value
      ? await compressOneLossy(item, token)
      : await compressOneLossless(item, token)
    if (token !== runToken || !result) return
    item.progressLabel = ''
    item.appliedSettings = applied
    const previewDataUrl = await makePreviewDataUrl(result.blob).catch(() => '')
    const historyId = `${item.id}-${Date.now()}`
    await saveCompressResultBlob(historyId, result.blob)
    historyItems.value = prependCompressHistory({
      id: historyId,
      sourceItemId: item.id,
      name: outputFilename(item.name, result.format),
      format: result.format,
      beforeBytes: result.beforeBytes,
      afterBytes: result.afterBytes,
      width: result.width,
      height: result.height,
      keptOriginal: result.keptOriginal,
      createdAt: new Date().toISOString(),
      previewDataUrl,
    })
  } catch (error) {
    if (token !== runToken) return
    item.status = 'failed'
    item.progressLabel = ''
    item.appliedSettings = applied
    item.error = error?.message || '压缩失败'
  }
}

function selectVariant(variantId) {
  const item = selected.value
  if (!item?.variants?.length) return
  const variant = item.variants.find((entry) => entry.id === variantId)
  if (!variant) return
  applyVariantToItem(item, variant)
}

async function compressAll() {
  const current = settingsFingerprint()
  const targets = items.value.filter((item) => {
    if (item.status === 'queued' || item.status === 'failed') return true
    // 设置已变时，允许对已完成项重新压缩；未变则跳过，避免无意义清空重跑
    if (item.status === 'done' && item.appliedSettings !== current) return true
    return false
  })
  if (!targets.length) {
    notificationService.info(
      items.value.some((item) => item.status === 'done')
        ? '当前结果已是最新，修改设置后可重新压缩'
        : '没有待压缩的图片',
    )
    return
  }
  compressing.value = true
  const token = ++runToken
  try {
    for (const item of targets) {
      if (token !== runToken) break
      selectItem(item.id)
      await compressOne(item, token)
    }
    if (token === runToken) {
      const failed = targets.filter((item) => item.status === 'failed').length
      const done = targets.filter((item) => item.status === 'done').length
      if (done) notificationService.success(`已完成 ${done} 张压缩`)
      if (failed) notificationService.warning(`${failed} 张压缩失败`)
    }
  } finally {
    if (token === runToken) compressing.value = false
  }
}

function downloadOne(item) {
  if (!item?.resultBlob) return
  downloadBlob(item.resultBlob, outputFilename(item.name, item.format))
  notificationService.success('已开始下载')
}

async function downloadDoneResults() {
  if (!doneItems.value.length || zipBusy.value) return
  zipBusy.value = true
  try {
    const result = await downloadBlobsAsZip(
      doneItems.value.map((item) => ({
        blob: item.resultBlob,
        name: item.name,
        format: item.format,
      })),
      `image-compress-${new Date().toISOString().slice(0, 10)}.zip`,
    )
    notificationService.success(
      result?.zipped ? `已开始下载 ZIP（${result.count} 张）` : '已开始下载图片',
    )
  } catch (error) {
    notificationService.error(error?.message || '下载失败')
  } finally {
    zipBusy.value = false
  }
}

function statusLabel(item) {
  if (item.status === 'queued') return '等待压缩'
  if (item.status === 'compressing') return item.progressLabel || '压缩中'
  if (item.status === 'failed') return '失败'
  if (item.keptOriginal) return '已是较优'
  if (item.selectedVariantId && item.selectedVariantId === item.recommendedVariantId) return '推荐档'
  return '已完成'
}

function setCompressMode(mode) {
  if (compressing.value || compressMode.value === mode) return
  compressMode.value = mode
  if (mode === 'lossy') {
    if (!['jpeg', 'webp', 'png'].includes(outputFormat.value)) outputFormat.value = 'webp'
  } else if (!['webp', 'png'].includes(outputFormat.value)) {
    outputFormat.value = 'webp'
  }
}

function settingsFingerprint() {
  return [
    compressMode.value,
    outputFormat.value,
    maxEdge.value,
    intensity.value,
    keepIfLarger.value ? 1 : 0,
  ].join('|')
}

/** 当前队列结果是否仍匹配工具栏设置；不匹配时允许再次「开始压缩」 */
const settingsDirty = computed(() => {
  if (!items.value.length) return false
  const current = settingsFingerprint()
  return items.value.some(
    (item) =>
      (item.status === 'done' || item.status === 'failed') &&
      item.appliedSettings &&
      item.appliedSettings !== current,
  )
})

async function clearHistory() {
  clearHistoryFocus()
  await clearCompressHistory()
  historyItems.value = []
  notificationService.success('历史已清空')
}

async function openRecentEntry(entry) {
  if (!entry?.id || compressing.value) return

  const live = items.value.find(
    (item) => item.id === entry.sourceItemId && item.status === 'done' && item.resultBlob,
  )
  if (live) {
    selectItem(live.id)
    return
  }

  const blob = await loadCompressResultBlob(entry.id)
  clearHistoryFocus()
  selectedId.value = ''

  if (blob) {
    historyFocus.value = {
      entry,
      resultBlob: blob,
      resultUrl: URL.createObjectURL(blob),
      previewOnly: false,
    }
    return
  }

  if (entry.previewDataUrl) {
    historyFocus.value = {
      entry,
      resultBlob: null,
      resultUrl: entry.previewDataUrl,
      previewOnly: true,
    }
    notificationService.info('仅可预览缩略图；完整文件已不在本地')
    return
  }

  notificationService.warning('该记录无法打开')
}

function downloadHistoryFocus() {
  const focus = historyFocus.value
  if (!focus?.resultBlob || !focus.entry) return
  downloadBlob(focus.resultBlob, focus.entry.name || outputFilename('image', focus.entry.format))
  notificationService.success('已开始下载')
}

function formatHistoryTime(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function applyCutoutToItem(item, blob) {
  if (!item || !blob) return
  clearItemResult(item)
  if (item.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(item.sourceUrl)
  const base = String(item.name || 'image').replace(/\.[^.]+$/, '')
  const file = new File([blob], `${base}-cutout.png`, {
    type: blob.type || 'image/png',
  })
  item.file = file
  item.name = file.name
  item.sourceUrl = URL.createObjectURL(file)
  item.beforeBytes = file.size
  item.status = 'queued'
  item.error = ''
  item.bgRemoved = true
  item.width = 0
  item.height = 0
  item.appliedSettings = ''
}

function cancelRemoveBgCost() {
  costConfirmOpen.value = false
  pendingCost.value = null
}

async function requestRemoveSelectedBackground() {
  const item = selected.value
  if (!item?.file || compressing.value || removingBg.value) return
  if (!authStore.isAuthenticated) {
    notificationService.warning('登录后可在本页直接抠图，无需跳转')
    router.push({ path: '/auth/login', query: { redirect: '/tools/image-compress' } })
    return
  }
  if (!activeRemoveTool.value?.id) {
    notificationService.warning('背景移除工具暂未开放')
    return
  }
  if (authStore.user?.requireCostConfirm === false) {
    await executeRemoveSelectedBackground()
    return
  }
  await refreshWalletBalance({ force: true }).catch(() => null)
  pendingCost.value = {
    billingMode: 'credits',
    unitCost: removeUnitPrice.value,
    unitPriceCents: removeUnitPrice.value,
    totalPriceCents: removeUnitPrice.value,
    count: 1,
    creditAvailable: availableCents.value,
    featureLabel: '背景移除',
  }
  costConfirmOpen.value = true
}

async function executeRemoveSelectedBackground() {
  const item = selected.value
  if (!item?.file || !activeRemoveTool.value?.id) return
  costConfirmOpen.value = false
  pendingCost.value = null
  clearHistoryFocus()
  removeBgController?.abort()
  const controller = new AbortController()
  removeBgController = controller
  removingBg.value = true
  removeBgStage.value = '正在上传原图…'
  item.error = ''
  try {
    const uploadedUrl = await uploadAiInputFile(item.file, { signal: controller.signal })
    removeBgStage.value = '正在移除背景…'
    const response = await removeImageBackground(uploadedUrl, activeRemoveTool.value.id, {
      signal: controller.signal,
      onUpdate(task) {
        const status = String(task?.status || '').toLowerCase()
        if (status === 'queued') removeBgStage.value = '排队中…'
        else if (status === 'running') removeBgStage.value = '智能抠图中…'
      },
    })
    const completed = response?.task || null
    const output =
      response?.result?.outputs?.[0] ||
      response?.job?.originalMediaUrls?.[0] ||
      taskOriginalUrl(completed) ||
      taskCoverUrl(completed) ||
      ''
    if (!output) throw new Error('抠图完成，但没有返回图片')
    removeBgStage.value = '正在载入透明图…'
    const blob = await fetchAuthenticatedMediaBlob(output, { cache: 'no-store' })
    if (controller.signal.aborted) return
    applyCutoutToItem(item, blob)
    // Transparent cutouts compress best as PNG / WebP.
    if (compressMode.value === 'lossy' && outputFormat.value === 'jpeg') {
      outputFormat.value = 'webp'
    }
    notificationService.success('已在本页完成抠图，可直接压缩')
  } catch (error) {
    if (error?.name === 'AbortError') return
    item.error = error?.message || '背景移除失败'
    notificationService.error(item.error)
  } finally {
    if (removeBgController === controller) {
      removingBg.value = false
      removeBgStage.value = ''
      removeBgController = null
    }
    void refreshWalletBalance({ force: true }).catch(() => null)
  }
}

onMounted(async () => {
  window.addEventListener('paste', handlePaste)
  await runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null)
})

onBeforeUnmount(() => {
  runToken += 1
  removeBgController?.abort()
  window.removeEventListener('paste', handlePaste)
  terminateCompressWorker()
  clearHistoryFocus()
  items.value.forEach(revokeItemUrls)
})
</script>

<template>
  <main
    class="ic"
    :class="{ 'is-dark': appearanceStore.isDark, 'is-busy': compressing || removingBg }"
  >
    <div class="ic-glow" aria-hidden="true"></div>

    <header class="ic-header">
      <div class="ic-header__copy">
        <span class="ic-kicker">
          <i class="bi bi-arrows-collapse" aria-hidden="true"></i>
          图片工具
        </span>
        <h1>图片压缩</h1>
        <p>本地智能有损 / 无损压缩。需要透明底时可在本页直接抠图，再继续压缩，无需跳转。</p>
        <div class="ic-meta">
          <span class="ic-chip"><i class="bi bi-shield-check" aria-hidden="true"></i>本地压缩</span>
          <span class="ic-chip"><i class="bi bi-scissors" aria-hidden="true"></i>本页抠图</span>
          <span class="ic-chip"><i class="bi bi-images" aria-hidden="true"></i>支持批量</span>
          <span class="ic-chip"><i class="bi bi-clipboard-check" aria-hidden="true"></i>支持粘贴截图</span>
          <span class="ic-chip"><i class="bi bi-hdd" aria-hidden="true"></i>最大 30MB / 张</span>
          <span class="ic-chip"><i class="bi bi-app" aria-hidden="true"></i>图标可压到约 4–10KB</span>
        </div>
      </div>

      <aside class="ic-summary" aria-live="polite">
        <small>压缩大小</small>
        <div class="ic-summary__sizes">
          <div>
            <em>压缩前</em>
            <strong>{{ doneItems.length ? formatBytes(totalBefore) : '—' }}</strong>
          </div>
          <span class="ic-summary__arrow" aria-hidden="true">→</span>
          <div>
            <em>压缩后</em>
            <strong>{{ doneItems.length ? formatBytes(totalAfter) : '—' }}</strong>
          </div>
          <div class="ic-summary__saved">
            <em>节省</em>
            <strong>{{ doneItems.length ? `${totalRatio}%` : '—' }}</strong>
          </div>
        </div>
        <p>
          {{ totalSavedLabel }}
          · 队列 {{ items.length }} 张 · 完成 {{ doneItems.length }} 张
          <template v-if="pendingCount"> · 进行中 {{ pendingCount }}</template>
        </p>
      </aside>
    </header>

    <section class="ic-toolbar" aria-label="压缩设置">
      <div class="ic-formats" role="group" aria-label="压缩模式">
        <button
          v-for="option in COMPRESS_MODE_OPTIONS"
          :key="option.value"
          type="button"
          class="ic-seg"
          :class="{ 'is-active': compressMode === option.value }"
          :disabled="compressing"
          @click="setCompressMode(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="ic-formats" role="group" aria-label="输出格式">
        <template v-if="isLossyMode">
          <button
            v-for="option in LOSSY_FORMAT_OPTIONS"
            :key="option.value"
            type="button"
            class="ic-seg"
            :class="{ 'is-active': outputFormat === option.value }"
            :disabled="compressing"
            @click="outputFormat = option.value"
          >
            {{ option.label }}
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="ic-seg"
            :class="{ 'is-active': outputFormat === 'webp' }"
            :disabled="compressing"
            @click="outputFormat = 'webp'"
          >
            WebP 无损
          </button>
          <button
            type="button"
            class="ic-seg"
            :class="{ 'is-active': outputFormat === 'png' }"
            :disabled="compressing"
            @click="outputFormat = 'png'"
          >
            PNG 优化
          </button>
        </template>
      </div>
      <label class="ic-field">
        <span>输出尺寸</span>
        <select v-model.number="maxEdge" :disabled="compressing" aria-label="输出尺寸">
          <option v-for="option in MAX_EDGE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <button
        type="button"
        class="ic-seg"
        :class="{ 'is-active': iconBudgetActive }"
        :disabled="compressing"
        title="缩放图标并优先压到约 4–10KB（WebP 有损）"
        @click="applyIconPreset(256)"
      >
        图标 4–10KB
      </button>
      <span v-if="iconBudgetActive" class="ic-budget-hint">
        目标 {{ Math.round(ICON_TARGET_BYTES.min / 1024) }}–
        {{ Math.round(ICON_TARGET_BYTES.max / 1024) }}KB
      </span>
      <label v-if="!isLossyMode" class="ic-field">
        <span>压缩强度</span>
        <select v-model="intensity" :disabled="compressing" aria-label="压缩强度">
          <option v-for="option in INTENSITY_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="!isLossyMode" class="ic-check">
        <input v-model="keepIfLarger" type="checkbox" :disabled="compressing" />
        仅在更小时替换
      </label>
      <div class="ic-toolbar__spacer"></div>
      <button type="button" class="ic-ghost" :disabled="compressing || !items.length" @click="clearQueue">
        清空队列
      </button>
    </section>

    <section class="ic-workspace" aria-label="图片压缩工作区">
      <div
        class="ic-pane ic-queue"
        :class="{ 'is-dragging': dragging }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="ic-pane__head">
          <strong>压缩队列</strong>
          <span>{{ items.length ? `${items.length} 张` : '可拖入多张' }}</span>
          <button type="button" class="ic-ghost" @click="fileInput?.click()">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
            添加图片
          </button>
        </div>

        <button v-if="!items.length" type="button" class="ic-dropzone" @click="fileInput?.click()">
          <span class="ic-dropzone__icon" aria-hidden="true">
            <i class="bi bi-cloud-arrow-up"></i>
          </span>
          <strong>添加要压缩的图片</strong>
          <span>点击选择、拖入文件，或按 Ctrl/⌘ + V 粘贴截图</span>
        </button>

        <div v-else class="ic-list" role="list">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="ic-row"
            role="listitem"
            :class="{
              'is-active': selectedId === item.id,
              'is-done': item.status === 'done',
              'is-failed': item.status === 'failed',
              'is-busy': item.status === 'compressing',
            }"
            @click="selectItem(item.id)"
          >
            <span class="ic-row__thumb">
              <img :src="item.resultUrl || item.sourceUrl" :alt="item.name" />
            </span>
            <span class="ic-row__body">
              <strong>{{ item.name }}</strong>
              <small>
                {{ statusLabel(item) }}
                ·
                {{ formatBytes(item.beforeBytes) }}
                <template v-if="item.status === 'done'">
                  → {{ formatBytes(item.afterBytes) }}
                  （{{ savingsPercent(item.beforeBytes, item.afterBytes) }}%）
                </template>
              </small>
              <small v-if="item.error" class="is-error">{{ item.error }}</small>
            </span>
            <span class="ic-row__actions">
              <button
                type="button"
                class="ic-icon"
                title="下载"
                :disabled="item.status !== 'done'"
                @click.stop="downloadOne(item)"
              >
                <i class="bi bi-download" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="ic-icon"
                title="移除"
                :disabled="compressing && item.status === 'compressing'"
                @click.stop="removeItem(item.id)"
              >
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </span>
          </button>
        </div>
      </div>

      <div class="ic-pane ic-compare">
        <div class="ic-pane__head">
          <strong>前后对比</strong>
          <span v-if="historyFocus">
            历史 · {{ historyFocus.entry.name }}
            · {{ formatBytes(historyFocus.entry.beforeBytes) }} →
            {{ formatBytes(historyFocus.entry.afterBytes) }}
          </span>
          <span v-else-if="selected">
            <template v-if="selected.width">
              {{ selected.width }}×{{ selected.height }}
              <template v-if="selected.status === 'done'">
                · {{ formatBytes(selected.beforeBytes) }} → {{ formatBytes(selected.afterBytes) }}
              </template>
            </template>
            <template v-else>选择队列中的图片</template>
          </span>
          <span v-else>选择队列或右侧最近记录</span>
          <button
            v-if="historyFocus?.resultBlob"
            type="button"
            class="ic-ghost"
            @click="downloadHistoryFocus"
          >
            <i class="bi bi-download" aria-hidden="true"></i>
            下载
          </button>
        </div>

        <div v-if="historyFocus" class="ic-compare__body">
          <div class="ic-compare__grid is-history">
            <figure class="ic-frame">
              <figcaption>
                {{ historyFocus.previewOnly ? '缩略预览' : '压缩结果' }}
                · {{ formatBytes(historyFocus.entry.afterBytes) }}
                <template v-if="historyFocus.entry.width">
                  · {{ historyFocus.entry.width }}×{{ historyFocus.entry.height }}
                </template>
              </figcaption>
              <div class="ic-frame__media is-checker">
                <img :src="historyFocus.resultUrl" :alt="historyFocus.entry.name" />
              </div>
            </figure>
            <figure class="ic-frame">
              <figcaption>记录信息</figcaption>
              <div class="ic-frame__media ic-history-detail">
                <strong>{{ historyFocus.entry.name }}</strong>
                <p>
                  {{ formatHistoryTime(historyFocus.entry.createdAt) }}
                  · 节省
                  {{ savingsPercent(historyFocus.entry.beforeBytes, historyFocus.entry.afterBytes) }}%
                </p>
                <p>
                  {{ formatBytes(historyFocus.entry.beforeBytes) }} →
                  {{ formatBytes(historyFocus.entry.afterBytes) }}
                </p>
                <p v-if="historyFocus.previewOnly" class="is-muted">完整文件未保存，仅缩略图</p>
                <button
                  v-else
                  type="button"
                  class="ic-btn is-secondary"
                  @click="downloadHistoryFocus"
                >
                  下载此结果
                </button>
              </div>
            </figure>
          </div>
        </div>

        <div v-else-if="selected" class="ic-compare__body">
          <div v-if="removingBg" class="ic-linkbar is-busy">
            <i class="bi bi-arrow-repeat ic-spin" aria-hidden="true"></i>
            <span>{{ removeBgStage || '正在移除背景…' }}</span>
          </div>
          <div v-else class="ic-linkbar">
            <div class="ic-linkbar__copy">
              <strong>
                <i class="bi bi-scissors" aria-hidden="true"></i>
                {{ selected.bgRemoved ? '已抠图，可直接压缩' : '需要透明底？' }}
              </strong>
              <span>
                {{
                  selected.bgRemoved
                    ? '当前队列图已是透明 PNG，继续压缩即可'
                    : activeRemoveTool
                      ? `本页移除背景后继续压缩（约 ${formatPoints(removeUnitPrice)} / 张）`
                      : '背景移除工具暂未开放'
                }}
              </span>
            </div>
            <button
              v-if="!selected.bgRemoved"
              type="button"
              class="ic-btn is-secondary"
              :disabled="!canRemoveSelectedBg || !activeRemoveTool"
              @click="requestRemoveSelectedBackground"
            >
              <i class="bi bi-person-bounding-box" aria-hidden="true"></i>
              本页移除背景
            </button>
          </div>
          <div class="ic-compare__grid">
            <figure class="ic-frame">
              <figcaption>
                {{ selected.bgRemoved ? '抠图结果' : '原图' }} ·
                {{ formatBytes(selected.beforeBytes) }}
              </figcaption>
              <div class="ic-frame__media is-checker">
                <img :src="selected.sourceUrl" alt="压缩前原图" />
              </div>
            </figure>
            <figure class="ic-frame">
              <figcaption>
                结果 ·
                {{
                  selected.status === 'done'
                    ? `${formatBytes(selected.afterBytes)}${selected.keptOriginal ? ' · 已是较优' : ''}`
                    : statusLabel(selected)
                }}
              </figcaption>
              <div class="ic-frame__media is-checker">
                <img
                  v-if="selected.resultUrl"
                  :src="selected.resultUrl"
                  alt="压缩后结果"
                />
                <div v-else class="ic-frame__empty">
                  <i class="bi bi-hourglass-split" aria-hidden="true"></i>
                  <p>{{ selected.status === 'failed' ? selected.error || '压缩失败' : '压缩后显示在这里' }}</p>
                </div>
              </div>
            </figure>
          </div>

          <div v-if="selectedVariants.length" class="ic-ladder" aria-label="压缩档位">
            <div class="ic-ladder__head">
              <strong>压缩档位</strong>
              <span>点击切换预览与下载；绿色为推荐</span>
            </div>
            <div class="ic-ladder__table-wrap">
              <table class="ic-ladder__table">
                <thead>
                  <tr>
                    <th>档位</th>
                    <th>体积</th>
                    <th>节省</th>
                    <th>RMSE</th>
                    <th>最大误差</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="variant in selectedVariants"
                    :key="variant.id"
                    :class="{
                      'is-active': selected.selectedVariantId === variant.id,
                      'is-recommended': selected.recommendedVariantId === variant.id,
                    }"
                    @click="selectVariant(variant.id)"
                  >
                    <td>
                      {{ variant.label }}
                      <em v-if="selected.recommendedVariantId === variant.id">推荐</em>
                    </td>
                    <td>{{ formatBytes(variant.bytes) }}</td>
                    <td>{{ variant.savings }}%</td>
                    <td>{{ variant.rmse }}</td>
                    <td>{{ variant.maxError }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-else class="ic-compare__empty">
          <i class="bi bi-columns-gap" aria-hidden="true"></i>
          <strong>还没有选中图片</strong>
          <p>添加图片，或点击右侧最近记录查看结果</p>
        </div>
      </div>

      <aside class="ic-pane ic-recent" aria-label="最近压缩">
        <div class="ic-pane__head">
          <strong>最近 5 张</strong>
          <span>{{ recentHistory.length ? `${recentHistory.length} 条` : '本地保存' }}</span>
          <button
            type="button"
            class="ic-ghost"
            :disabled="!recentHistory.length"
            @click="clearHistory"
          >
            清空
          </button>
        </div>
        <div v-if="!recentHistory.length" class="ic-recent__empty">
          <i class="bi bi-clock-history" aria-hidden="true"></i>
          <strong>暂无记录</strong>
          <p>压缩完成后会保存在本地，点击可回看</p>
        </div>
        <div v-else class="ic-recent__list">
          <button
            v-for="entry in recentHistory"
            :key="entry.id"
            type="button"
            class="ic-recent__card"
            :class="{ 'is-active': activeHistoryId === entry.id || selected?.id === entry.sourceItemId }"
            @click="openRecentEntry(entry)"
          >
            <span class="ic-recent__thumb is-checker">
              <img v-if="entry.previewDataUrl" :src="entry.previewDataUrl" alt="" />
              <i v-else class="bi bi-image" aria-hidden="true"></i>
            </span>
            <span class="ic-recent__meta">
              <strong>{{ entry.name }}</strong>
              <small>
                {{ formatHistoryTime(entry.createdAt) }}
                · {{ formatBytes(entry.beforeBytes) }} → {{ formatBytes(entry.afterBytes) }}
                （{{ savingsPercent(entry.beforeBytes, entry.afterBytes) }}%）
              </small>
            </span>
          </button>
        </div>
      </aside>
    </section>

    <footer class="ic-actions">
      <div class="ic-actions__hint">
        <template v-if="!items.length">支持拖入与粘贴截图；压缩在本地完成，抠图可在本页联动</template>
        <template v-else-if="removingBg">{{ removeBgStage || '正在本页移除背景…' }}</template>
        <template v-else-if="compressing">正在压缩，请保持页面打开…</template>
        <template v-else-if="settingsDirty">设置已更改，点击「开始压缩」可按新设置重新处理</template>
        <template v-else-if="doneItems.length">
          {{ totalSavedLabel }}；单张直接下载，多张才打包 ZIP
        </template>
        <template v-else-if="isLossyMode">选择格式后点击「开始压缩」，将生成多档并自动推荐</template>
        <template v-else>选择输出格式后点击「开始压缩」</template>
      </div>
      <div class="ic-actions__btns">
        <button
          type="button"
          class="ic-btn is-ghost"
          :disabled="compressing || removingBg || !doneItems.length"
          @click="clearDone"
        >
          清空已完成
        </button>
        <button
          type="button"
          class="ic-btn is-secondary"
          :disabled="!canRemoveSelectedBg || !activeRemoveTool"
          @click="requestRemoveSelectedBackground"
        >
          <i class="bi bi-scissors" aria-hidden="true"></i>
          本页抠图
        </button>
        <button
          type="button"
          class="ic-btn is-secondary"
          :disabled="!doneItems.length || zipBusy || removingBg"
          @click="downloadDoneResults"
        >
          <i
            class="bi"
            :class="
              doneItems.length > 1 ? 'bi-file-earmark-zip' : 'bi-download'
            "
            aria-hidden="true"
          ></i>
          {{
            zipBusy
              ? doneItems.length > 1
                ? '打包中…'
                : '下载中…'
              : doneItems.length > 1
                ? `下载 ZIP（${doneItems.length}）`
                : '下载图片'
          }}
        </button>
        <button
          type="button"
          class="ic-btn is-primary"
          :disabled="compressing || removingBg || !items.length"
          @click="compressAll"
        >
          <i
            class="bi"
            :class="compressing ? 'bi-arrow-repeat ic-spin' : 'bi-lightning-charge'"
            aria-hidden="true"
          ></i>
          {{ compressing ? '压缩中…' : '开始压缩' }}
        </button>
      </div>
    </footer>

    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      hidden
      @change="handleFileChange"
    />

    <AiCostConfirmDialog
      :show="costConfirmOpen"
      :cost="pendingCost"
      :light="!appearanceStore.isDark"
      @confirm="executeRemoveSelectedBackground"
      @cancel="cancelRemoveBgCost"
    />
  </main>
</template>

<style scoped>
:global(.app-container > .main-content:has(> .ic)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.ic {
  --ic-ink: #14201f;
  --ic-muted: #5f726e;
  --ic-line: #d7e4e0;
  --ic-bg: #f3f7f6;
  --ic-surface: #ffffff;
  --ic-soft: #e8f3f0;
  --ic-accent: #0f9d8a;
  --ic-accent-2: #14b8a6;
  --ic-accent-soft: rgb(15 157 138 / 12%);
  --ic-danger: #e11d48;
  --ic-frame: #e6eeeb;
  --ic-shadow: 0 18px 48px rgb(20 50 45 / 8%);
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  padding-right: clamp(20px, 3.5vw, 56px);
  padding-bottom: 16px;
  padding-left: clamp(20px, 3.5vw, 56px);
  overflow: hidden;
  color: var(--ic-ink);
  background: var(--ic-bg);
}

.ic.is-dark {
  --ic-ink: #eef7f4;
  --ic-muted: #9bb0aa;
  --ic-line: #2a3633;
  --ic-bg: #0e1211;
  --ic-surface: #171c1b;
  --ic-soft: #1c2623;
  --ic-accent: #2dd4bf;
  --ic-accent-2: #5eead4;
  --ic-accent-soft: rgb(45 212 191 / 14%);
  --ic-danger: #fb7185;
  --ic-frame: #121716;
  --ic-shadow: 0 22px 52px rgb(0 0 0 / 35%);
}

.ic-glow {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 0%, rgb(20 184 166 / 16%), transparent 28%),
    radial-gradient(circle at 88% 8%, rgb(56 189 248 / 10%), transparent 24%),
    linear-gradient(180deg, color-mix(in srgb, var(--ic-soft) 70%, transparent), transparent 42%);
}

.ic-header {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.75fr);
  gap: 14px;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto 12px;
}

.ic-header__copy {
  display: grid;
  align-content: center;
  gap: 8px;
}

.ic-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  color: var(--ic-accent);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.ic-header h1 {
  margin: 0;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.05;
}

.ic-header__copy > p {
  margin: 0;
  max-width: 52ch;
  color: var(--ic-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.ic-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ic-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--ic-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ic-surface) 80%, transparent);
  color: var(--ic-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.ic-summary {
  display: grid;
  align-content: center;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--ic-line);
  border-radius: 18px;
  background: var(--ic-surface);
  box-shadow: var(--ic-shadow);
}

.ic-summary small {
  color: var(--ic-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.ic-summary p {
  margin: 0;
  color: var(--ic-muted);
  font-size: 0.78rem;
}

.ic-summary__sizes {
  display: grid;
  grid-template-columns: 1fr auto 1fr 0.85fr;
  gap: 8px;
  align-items: end;
}

.ic-summary__sizes em {
  display: block;
  margin-bottom: 2px;
  color: var(--ic-muted);
  font-size: 0.68rem;
  font-style: normal;
  font-weight: 700;
}

.ic-summary__sizes strong {
  display: block;
  font-size: 1.15rem;
  font-weight: 850;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.ic-summary__arrow {
  padding-bottom: 4px;
  color: var(--ic-accent);
  font-size: 1.1rem;
  font-weight: 800;
}

.ic-summary__saved strong {
  color: var(--ic-accent);
}

.ic-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ic-muted);
  font-size: 0.78rem;
  font-weight: 650;
}

.ic-field select {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--ic-line);
  border-radius: 10px;
  background: var(--ic-surface);
  color: var(--ic-ink);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
}

.ic-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto 12px;
}

.ic-formats {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--ic-line);
  border-radius: 12px;
  background: var(--ic-surface);
}

.ic-seg {
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ic-muted);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 750;
  cursor: pointer;
}

.ic-seg.is-active {
  color: #fff;
  background: linear-gradient(135deg, var(--ic-accent), var(--ic-accent-2));
}

.ic-budget-hint {
  color: var(--ic-accent);
  font-size: 0.76rem;
  font-weight: 750;
}

.ic-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ic-muted);
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
}

.ic-toolbar__spacer {
  flex: 1;
}

.ic-workspace {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.35fr) minmax(210px, 0.7fr);
  gap: 14px;
  width: 100%;
  max-width: 1360px;
  min-height: 0;
  margin: 0 auto;
}

.ic-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ic-line);
  border-radius: 20px;
  background: var(--ic-surface);
  box-shadow: var(--ic-shadow);
}

.ic-queue.is-dragging {
  border-color: var(--ic-accent);
  box-shadow: 0 0 0 3px var(--ic-accent-soft), var(--ic-shadow);
}

.ic-pane__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--ic-line);
}

.ic-pane__head strong {
  font-size: 0.9rem;
  font-weight: 800;
}

.ic-pane__head span {
  min-width: 0;
  overflow: hidden;
  color: var(--ic-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-pane__head .ic-ghost {
  margin-left: auto;
}

.ic-ghost,
.ic-btn,
.ic-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--ic-line);
  border-radius: 11px;
  background: var(--ic-surface);
  color: inherit;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}

.ic-ghost {
  min-height: 32px;
  padding: 0 10px;
  color: var(--ic-muted);
  font-size: 0.74rem;
}

.ic-dropzone {
  display: grid;
  flex: 1;
  place-content: center;
  gap: 10px;
  padding: 24px;
  border: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ic-soft) 70%, transparent), transparent),
    transparent;
  color: var(--ic-muted);
  cursor: pointer;
}

.ic-dropzone__icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  margin: 0 auto 4px;
  border-radius: 20px;
  color: var(--ic-accent);
  background: var(--ic-accent-soft);
  font-size: 1.7rem;
}

.ic-dropzone strong {
  color: var(--ic-ink);
  font-size: 1.05rem;
  font-weight: 850;
}

.ic-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  overflow: auto;
}

.ic-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ic-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ic-soft) 45%, var(--ic-surface));
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ic-row.is-active {
  border-color: color-mix(in srgb, var(--ic-accent) 50%, var(--ic-line));
  box-shadow: 0 0 0 3px var(--ic-accent-soft);
}

.ic-row.is-busy {
  border-color: color-mix(in srgb, var(--ic-accent) 40%, var(--ic-line));
}

.ic-row.is-failed {
  border-color: color-mix(in srgb, var(--ic-danger) 40%, var(--ic-line));
}

.ic-row__thumb {
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--ic-frame);
}

.ic-row__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ic-row__body {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.ic-row__body strong {
  overflow: hidden;
  font-size: 0.82rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-row__body small {
  color: var(--ic-muted);
  font-size: 0.7rem;
}

.ic-row__body small.is-error {
  color: var(--ic-danger);
}

.ic-row__actions {
  display: inline-flex;
  gap: 4px;
}

.ic-icon {
  width: 32px;
  height: 32px;
  color: var(--ic-muted);
}

.ic-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ic-compare__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.ic-linkbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 12px 12px 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ic-accent) 26%, var(--ic-line));
  border-radius: 14px;
  background: color-mix(in srgb, var(--ic-accent) 8%, var(--ic-surface));
}

.ic-linkbar.is-busy {
  justify-content: flex-start;
  color: var(--ic-ink);
  font-size: 0.82rem;
  font-weight: 700;
}

.ic-linkbar__copy {
  display: grid;
  gap: 2px;
  min-width: min(100%, 240px);
}

.ic-linkbar__copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ic-ink);
  font-size: 0.84rem;
}

.ic-linkbar__copy span {
  color: var(--ic-muted);
  font-size: 0.76rem;
  line-height: 1.4;
}

.ic-compare__grid {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  min-height: 0;
  padding: 12px;
}

.ic-ladder {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  max-height: 38%;
  min-height: 120px;
  border-top: 1px solid var(--ic-line);
}

.ic-ladder__head {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 10px;
  padding: 8px 14px 6px;
}

.ic-ladder__head strong {
  font-size: 0.82rem;
  font-weight: 800;
}

.ic-ladder__head span {
  color: var(--ic-muted);
  font-size: 0.7rem;
}

.ic-ladder__table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 10px;
}

.ic-ladder__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.74rem;
}

.ic-ladder__table th,
.ic-ladder__table td {
  padding: 7px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--ic-line) 80%, transparent);
  text-align: left;
  white-space: nowrap;
}

.ic-ladder__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ic-surface);
  color: var(--ic-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.ic-ladder__table tbody tr {
  cursor: pointer;
  transition: background 0.15s ease;
}

.ic-ladder__table tbody tr:hover {
  background: color-mix(in srgb, var(--ic-soft) 80%, transparent);
}

.ic-ladder__table tbody tr.is-active {
  background: var(--ic-accent-soft);
}

.ic-ladder__table tbody tr.is-recommended td:first-child {
  color: var(--ic-accent);
  font-weight: 750;
}

.ic-ladder__table td em {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ic-accent-soft);
  color: var(--ic-accent);
  font-size: 0.64rem;
  font-style: normal;
  font-weight: 800;
}

.ic-frame {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  margin: 0;
  gap: 8px;
}

.ic-frame figcaption {
  flex: 0 0 auto;
  color: var(--ic-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.ic-frame__media {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--ic-frame);
}

.ic-frame__media.is-checker {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(-45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #dfe7e4 75%),
    linear-gradient(-45deg, transparent 75%, #dfe7e4 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
}

.ic.is-dark .ic-frame__media.is-checker {
  background-color: #101413;
  background-image:
    linear-gradient(45deg, #1b2321 25%, transparent 25%),
    linear-gradient(-45deg, #1b2321 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1b2321 75%),
    linear-gradient(-45deg, transparent 75%, #1b2321 75%);
}

.ic-frame__media > img {
  flex: 0 1 auto;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.ic-frame__empty,
.ic-compare__empty {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--ic-muted);
  text-align: center;
}

.ic-compare__empty {
  flex: 1;
  padding: 24px;
}

.ic-frame__empty i,
.ic-compare__empty i {
  font-size: 1.5rem;
  color: var(--ic-accent);
}

.ic-frame__empty p,
.ic-compare__empty p {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
}

.ic-compare__empty strong {
  color: var(--ic-ink);
}

.ic-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  max-width: 1360px;
  margin: 12px auto 0;
}

.ic-actions__hint {
  color: var(--ic-muted);
  font-size: 0.82rem;
}

.ic-actions__btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ic-btn {
  min-height: 42px;
  min-width: 120px;
  padding: 0 16px;
  font-size: 0.88rem;
}

.ic-btn.is-primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--ic-accent), var(--ic-accent-2));
  box-shadow: 0 12px 28px rgb(15 157 138 / 24%);
}

.ic-btn.is-secondary {
  color: var(--ic-ink);
  background: var(--ic-surface);
}

.ic-btn.is-ghost {
  min-width: 0;
  color: var(--ic-muted);
  background: transparent;
}

.ic-btn:disabled,
.ic-ghost:disabled,
.ic-seg:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.ic-spin {
  animation: ic-spin 0.85s linear infinite;
}

.ic-recent__list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  overflow: auto;
}

.ic-compare__grid.is-history {
  grid-template-columns: minmax(0, 1.2fr) minmax(180px, 0.8fr);
}

.ic-history-detail {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 10px;
  padding: 18px;
  text-align: left;
}

.ic-history-detail strong {
  font-size: 0.92rem;
  font-weight: 800;
  word-break: break-all;
}

.ic-history-detail p {
  margin: 0;
  color: var(--ic-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.ic-history-detail p.is-muted {
  color: var(--ic-danger);
}

.ic-recent__card {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ic-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ic-soft) 50%, var(--ic-surface));
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.ic-recent__card:hover {
  border-color: color-mix(in srgb, var(--ic-accent) 45%, var(--ic-line));
  background: var(--ic-accent-soft);
}

.ic-recent__card.is-active {
  border-color: color-mix(in srgb, var(--ic-accent) 55%, var(--ic-line));
  box-shadow: 0 0 0 2px var(--ic-accent-soft);
}

.ic-recent__thumb {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  overflow: hidden;
  border-radius: 9px;
  color: var(--ic-muted);
  background: var(--ic-frame);
}

.ic-recent__thumb.is-checker {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(-45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #dfe7e4 75%),
    linear-gradient(-45deg, transparent 75%, #dfe7e4 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.ic-recent__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ic-recent__meta {
  min-width: 0;
}

.ic-recent__meta strong {
  display: block;
  overflow: hidden;
  font-size: 0.76rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-recent__meta small {
  display: block;
  color: var(--ic-muted);
  font-size: 0.66rem;
  line-height: 1.4;
}

.ic-recent__empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 6px;
  padding: 20px 14px;
  color: var(--ic-muted);
  text-align: center;
}

.ic-recent__empty i {
  font-size: 1.35rem;
  color: var(--ic-accent);
}

.ic-recent__empty strong {
  color: var(--ic-ink);
  font-size: 0.85rem;
}

.ic-recent__empty p {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.4;
}

@keyframes ic-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 960px) {
  .ic-header,
  .ic-workspace,
  .ic-compare__grid {
    grid-template-columns: 1fr;
  }

  .ic-workspace {
    overflow: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ic-spin {
    animation: none !important;
  }
}
</style>
