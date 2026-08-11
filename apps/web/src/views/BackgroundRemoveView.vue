<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import { taskCoverUrl, taskOriginalUrl } from '@/features/creator-hub/taskMedia'
import {
  compressImageFile,
  downloadBlob,
  formatBytes,
  outputFilename,
  savingsPercent,
  terminateCompressWorker,
} from '@/features/image-compress/compressEngine'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { removeImageBackground, uploadAiInputFile } from '@/services/aiWallpaper'
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from '@/services/authenticatedMedia'
import { formatPoints } from '@/services/billingApi'
import { listTasks } from '@/services/tasksApi'
import notificationService from '@/services/notification'

const STAGE_META = {
  idle: { label: '等待上传', detail: '选择一张图片开始抠图' },
  ready: { label: '准备就绪', detail: '点击下方按钮移除背景' },
  uploading: { label: '上传原图', detail: '正在安全上传到处理通道' },
  queued: { label: '排队中', detail: '任务已创建，等待算力分配' },
  running: { label: '智能抠图', detail: '正在分离主体与背景' },
  succeeded: { label: '处理完成', detail: '透明 PNG 已就绪，可本页压缩后下载' },
  failed: { label: '处理失败', detail: '可更换图片或重试' },
}

const STAGE_ORDER = ['uploading', 'queued', 'running', 'succeeded']
const HISTORY_LIMIT = 24

const runtimeConfigStore = useRuntimeConfigStore()
const appearanceStore = useAppearanceStore()
const authStore = useAuthStore()
const { availableCents, refreshWalletBalance } = useClientWalletBalance()
const fileInput = ref(null)
const sourceFile = ref(null)
const sourcePreview = ref('')
const resultUrl = ref('')
const processing = ref(false)
const dragging = ref(false)
const costConfirmOpen = ref(false)
const pendingCost = ref(null)
const stage = ref('idle')
const errorMessage = ref('')
const resultReveal = ref(false)
const historyOpen = ref(false)
const historyLoading = ref(false)
const historyItems = ref([])
const historyError = ref('')
const activeHistoryId = ref('')
const latestFromHistory = ref(false)
const compressFormat = ref('png')
const compressBusy = ref(false)
const compressError = ref('')
const compressStats = ref(null)
let compressToken = 0
let resultFileCache = null
let resultFileCacheUrl = ''

const toolModels = computed(() => {
  const models = runtimeConfigStore.getFeaturePayload('ai.imageTools')?.backgroundRemovalModels
  return Array.isArray(models) ? models.filter((model) => model?.id) : []
})
const activeTool = computed(
  () => toolModels.value.find((model) => model.default === true) || toolModels.value[0] || null,
)
const unitPrice = computed(() => Math.max(0, Number(activeTool.value?.pricePoints || 0)))
const canRun = computed(() => Boolean(sourceFile.value && activeTool.value && !processing.value))
const stageMeta = computed(() => STAGE_META[stage.value] || STAGE_META.idle)
const stageIndex = computed(() => {
  if (stage.value === 'failed') return 1
  if (stage.value === 'ready' || stage.value === 'idle') return -1
  return STAGE_ORDER.indexOf(stage.value)
})
const statusTone = computed(() => {
  if (stage.value === 'failed') return 'danger'
  if (stage.value === 'succeeded') return 'success'
  if (processing.value) return 'busy'
  if (sourceFile.value) return 'ready'
  return 'idle'
})
const historyCountLabel = computed(() =>
  historyItems.value.length ? `${historyItems.value.length} 张` : '暂无',
)
const compressSavingsLabel = computed(() => {
  const stats = compressStats.value
  if (!stats) return ''
  if (stats.afterBytes >= stats.beforeBytes) return '已是较优体积'
  return `已减小 ${savingsPercent(stats.beforeBytes, stats.afterBytes)}%`
})

function resetCompressState() {
  compressToken += 1
  compressBusy.value = false
  compressError.value = ''
  compressStats.value = null
  resultFileCache = null
  resultFileCacheUrl = ''
}

function taskResultUrl(task) {
  return taskOriginalUrl(task) || taskCoverUrl(task)
}

function releaseSourcePreview() {
  if (sourcePreview.value.startsWith('blob:')) URL.revokeObjectURL(sourcePreview.value)
  sourcePreview.value = ''
}

function selectFile(file, { notifyPaste = false } = {}) {
  if (!file || processing.value) return
  if (!String(file.type || '').startsWith('image/')) {
    notificationService.warning('请选择 PNG、JPG 或 WebP 图片')
    return
  }
  if (file.size > 15 * 1024 * 1024) {
    notificationService.warning('图片不能超过 15MB')
    return
  }
  releaseSourcePreview()
  sourceFile.value = file
  sourcePreview.value = URL.createObjectURL(file)
  resultUrl.value = ''
  resultReveal.value = false
  errorMessage.value = ''
  activeHistoryId.value = ''
  latestFromHistory.value = false
  resetCompressState()
  stage.value = 'ready'
  if (notifyPaste) notificationService.success('已粘贴截图')
}

function handleFileChange(event) {
  selectFile(event.target.files?.[0])
  event.target.value = ''
}

function handleDrop(event) {
  dragging.value = false
  selectFile(event.dataTransfer?.files?.[0])
}

function extractClipboardImage(clipboard) {
  if (!clipboard) return null
  const fromItems = Array.from(clipboard.items || [])
    .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (fromItems[0]) return fromItems[0]
  return Array.from(clipboard.files || []).find((file) => file?.type?.startsWith('image/')) || null
}

function handlePaste(event) {
  if (processing.value || costConfirmOpen.value || historyOpen.value) return
  const target = event.target
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  const image = extractClipboardImage(event.clipboardData)
  if (!image) return
  event.preventDefault()
  const extension = String(image.type || '').includes('jpeg')
    ? 'jpg'
    : String(image.type || '').includes('webp')
      ? 'webp'
      : 'png'
  const named =
    image.name && image.name !== 'image.png'
      ? image
      : new File([image], `paste-${Date.now()}.${extension}`, {
          type: image.type || 'image/png',
          lastModified: Date.now(),
        })
  selectFile(named, { notifyPaste: true })
}

function clearImage() {
  if (processing.value) return
  releaseSourcePreview()
  sourceFile.value = null
  resultUrl.value = ''
  resultReveal.value = false
  errorMessage.value = ''
  activeHistoryId.value = ''
  latestFromHistory.value = false
  resetCompressState()
  stage.value = 'idle'
}

function applyTaskStage(task) {
  const status = String(task?.status || '')
    .trim()
    .toLowerCase()
  if (status === 'queued') stage.value = 'queued'
  else if (status === 'running') stage.value = 'running'
  else if (status === 'succeeded') stage.value = 'succeeded'
  else if (status === 'failed' || status === 'canceled') stage.value = 'failed'
}

function showResult(url, { historyId = '', fromHistory = false } = {}) {
  if (!url) return false
  resultUrl.value = url
  activeHistoryId.value = historyId
  latestFromHistory.value = fromHistory
  errorMessage.value = ''
  stage.value = 'succeeded'
  resultReveal.value = false
  requestAnimationFrame(() => {
    resultReveal.value = true
  })
  return true
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

function prependHistoryTask(task) {
  if (!task?.id || !taskResultUrl(task)) return
  historyItems.value = [task, ...historyItems.value.filter((item) => item.id !== task.id)].slice(
    0,
    HISTORY_LIMIT,
  )
}

async function loadHistory({ silent = false } = {}) {
  if (!authStore.isAuthenticated) {
    historyItems.value = []
    historyError.value = silent ? '' : '登录后可查看抠图历史'
    return []
  }
  historyLoading.value = true
  if (!silent) historyError.value = ''
  try {
    const { items } = await listTasks({
      type: 'background_remove',
      status: 'succeeded',
      limit: HISTORY_LIMIT,
    })
    historyItems.value = (items || []).filter((task) => taskResultUrl(task))
    return historyItems.value
  } catch (error) {
    historyError.value = error?.message || '历史记录读取失败'
    if (!silent) notificationService.error(historyError.value)
    return []
  } finally {
    historyLoading.value = false
  }
}

async function loadLatestResult() {
  if (!authStore.isAuthenticated || processing.value || sourceFile.value || resultUrl.value) return
  const items = historyItems.value.length
    ? historyItems.value
    : await loadHistory({ silent: true })
  const latest = items[0]
  if (!latest) return
  showResult(taskResultUrl(latest), { historyId: latest.id, fromHistory: true })
}

async function openHistory() {
  historyOpen.value = true
  if (!historyItems.value.length) await loadHistory()
}

function closeHistory() {
  historyOpen.value = false
}

function selectHistoryItem(task) {
  if (processing.value) return
  const url = taskResultUrl(task)
  if (!url) return
  showResult(url, { historyId: task.id, fromHistory: true })
  historyOpen.value = false
}

async function executeBackgroundRemoval() {
  if (!canRun.value) return
  costConfirmOpen.value = false
  pendingCost.value = null
  processing.value = true
  resultUrl.value = ''
  resultReveal.value = false
  errorMessage.value = ''
  activeHistoryId.value = ''
  latestFromHistory.value = false
  stage.value = 'uploading'
  try {
    const uploadedUrl = await uploadAiInputFile(sourceFile.value)
    stage.value = 'queued'
    const response = await removeImageBackground(uploadedUrl, activeTool.value.id, {
      onUpdate: applyTaskStage,
    })
    const completed = response?.task || null
    const output =
      response?.result?.outputs?.[0] ||
      response?.job?.originalMediaUrls?.[0] ||
      taskResultUrl(completed) ||
      ''
    if (!output) throw new Error('任务已完成，但没有返回图片')
    showResult(output, { historyId: completed?.id || '' })
    if (completed) prependHistoryTask(completed)
    else void loadHistory({ silent: true })
    notificationService.success('背景已移除')
  } catch (error) {
    stage.value = 'failed'
    errorMessage.value = error?.message || '背景移除失败'
    notificationService.error(errorMessage.value)
  } finally {
    processing.value = false
    void refreshWalletBalance({ force: true })
  }
}

async function requestBackgroundRemoval() {
  if (!canRun.value) return
  if (authStore.user?.requireCostConfirm === false) {
    await executeBackgroundRemoval()
    return
  }
  await refreshWalletBalance({ force: true }).catch(() => null)
  pendingCost.value = {
    billingMode: 'credits',
    unitCost: unitPrice.value,
    unitPriceCents: unitPrice.value,
    totalPriceCents: unitPrice.value,
    count: 1,
    creditAvailable: availableCents.value,
    featureLabel: '背景移除',
  }
  costConfirmOpen.value = true
}

function cancelCostConfirm() {
  costConfirmOpen.value = false
  pendingCost.value = null
}

async function downloadResult() {
  if (!resultUrl.value) return
  try {
    await downloadAuthenticatedMedia(resultUrl.value, `background-removed-${Date.now()}.png`)
    notificationService.success('已开始下载')
  } catch (error) {
    notificationService.error(error?.message || '下载失败')
  }
}

async function loadResultFile() {
  const url = String(resultUrl.value || '').trim()
  if (!url) throw new Error('还没有抠图结果')
  if (resultFileCache && resultFileCacheUrl === url) return resultFileCache
  const blob = await fetchAuthenticatedMediaBlob(url, { cache: 'no-store' })
  const file = new File([blob], `background-removed-${Date.now()}.png`, {
    type: blob.type || 'image/png',
  })
  resultFileCache = file
  resultFileCacheUrl = url
  return file
}

async function prepareCompressPreview() {
  if (!resultUrl.value || processing.value) return
  const token = ++compressToken
  compressBusy.value = true
  compressError.value = ''
  try {
    const file = await loadResultFile()
    if (token !== compressToken) return
    const result = await compressImageFile(file, {
      format: compressFormat.value,
      intensity: 'balanced',
      keepIfLarger: true,
    })
    if (token !== compressToken) return
    compressStats.value = {
      beforeBytes: result.beforeBytes,
      afterBytes: result.afterBytes,
      format: result.format,
      blob: result.blob,
      keptOriginal: result.keptOriginal,
      filename: outputFilename(file.name, result.format),
    }
  } catch (error) {
    if (token !== compressToken) return
    compressStats.value = null
    compressError.value = error?.message || '压缩预览失败'
  } finally {
    if (token === compressToken) compressBusy.value = false
  }
}

async function downloadCompressedResult() {
  if (!resultUrl.value || compressBusy.value) return
  try {
    if (!compressStats.value?.blob || compressStats.value.format !== compressFormat.value) {
      await prepareCompressPreview()
    }
    const stats = compressStats.value
    if (!stats?.blob) throw new Error(compressError.value || '压缩失败')
    downloadBlob(stats.blob, stats.filename)
    notificationService.success(
      stats.keptOriginal || stats.afterBytes >= stats.beforeBytes
        ? '已下载（体积已接近最优）'
        : `已下载压缩结果，减小 ${savingsPercent(stats.beforeBytes, stats.afterBytes)}%`,
    )
  } catch (error) {
    notificationService.error(error?.message || '压缩下载失败')
  }
}

watch(resultUrl, (url) => {
  resetCompressState()
  if (url) void prepareCompressPreview()
})

watch(compressFormat, () => {
  if (resultUrl.value) void prepareCompressPreview()
})

onMounted(async () => {
  window.addEventListener('paste', handlePaste)
  await runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null)
  await loadLatestResult()
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste)
  releaseSourcePreview()
  resetCompressState()
  terminateCompressWorker()
})
</script>

<template>
  <main
    class="br"
    :class="{
      'is-dark': appearanceStore.isDark,
      'is-processing': processing,
      'is-done': stage === 'succeeded',
      'is-failed': stage === 'failed',
    }"
  >
    <div class="br-glow" aria-hidden="true"></div>

    <header class="br-header">
      <div class="br-header__copy">
        <span class="br-kicker">
          <i class="bi bi-scissors" aria-hidden="true"></i>
          图片工具
        </span>
        <h1>背景移除</h1>
        <p>上传商品或人像图，一键保留主体；抠图完成后可在本页直接压缩下载，无需跳转。</p>
        <div class="br-meta">
          <span class="br-chip">
            <i class="bi bi-filetype-png" aria-hidden="true"></i>
            透明 PNG
          </span>
          <span class="br-chip">
            <i class="bi bi-download" aria-hidden="true"></i>
            本页压缩下载
          </span>
          <span class="br-chip">
            <i class="bi bi-image" aria-hidden="true"></i>
            最大 15MB
          </span>
          <span class="br-chip">
            <i class="bi bi-clipboard-check" aria-hidden="true"></i>
            支持粘贴截图
          </span>
          <span v-if="activeTool" class="br-chip is-price">
            <i class="bi bi-coin" aria-hidden="true"></i>
            {{ formatPoints(unitPrice) }} / 张
          </span>
          <span v-else class="br-chip is-warn">工具未开放</span>
        </div>
      </div>

      <aside class="br-status" :data-tone="statusTone" aria-live="polite">
        <div class="br-status__pulse" aria-hidden="true"></div>
        <div class="br-status__copy">
          <small>当前状态</small>
          <strong>{{ stageMeta.label }}</strong>
          <p>{{ errorMessage || stageMeta.detail }}</p>
        </div>
        <ol class="br-steps" aria-label="处理进度">
          <li
            v-for="(key, index) in STAGE_ORDER"
            :key="key"
            :class="{
              'is-done': stageIndex > index || (stage === 'succeeded' && index === STAGE_ORDER.length - 1),
              'is-active': stageIndex === index,
            }"
          >
            <span>{{ STAGE_META[key].label }}</span>
          </li>
        </ol>
      </aside>
    </header>

    <section class="br-workspace" aria-label="背景移除工作区">
      <div
        class="br-pane"
        :class="{ 'is-dragging': dragging, 'has-image': Boolean(sourcePreview) }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="br-pane__head">
          <strong>原图</strong>
          <span v-if="sourceFile">{{ sourceFile.name }}</span>
          <button
            v-if="sourceFile"
            type="button"
            class="br-ghost"
            :disabled="processing"
            @click="clearImage"
          >
            <i class="bi bi-trash3" aria-hidden="true"></i>
            清空
          </button>
        </div>

        <button
          v-if="!sourcePreview"
          type="button"
          class="br-dropzone"
          @click="fileInput?.click()"
        >
          <span class="br-dropzone__icon" aria-hidden="true">
            <i class="bi bi-cloud-arrow-up"></i>
          </span>
          <strong>上传图片</strong>
          <span>点击选择、拖入文件，或按 Ctrl/⌘ + V 粘贴截图</span>
        </button>

        <div v-else class="br-frame">
          <img :src="sourcePreview" alt="待处理原图" />
          <div v-if="processing" class="br-scan" aria-hidden="true">
            <span class="br-scan__beam"></span>
            <span class="br-scan__veil"></span>
          </div>
          <button type="button" class="br-frame__action" :disabled="processing" @click="fileInput?.click()">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            更换
          </button>
        </div>
      </div>

      <div class="br-bridge" aria-hidden="true">
        <div class="br-bridge__rail">
          <span v-for="n in 5" :key="n" class="br-bridge__dot"></span>
        </div>
        <div class="br-bridge__orb">
          <i class="bi" :class="processing ? 'bi-hourglass-split' : resultUrl ? 'bi-check-lg' : 'bi-scissors'"></i>
        </div>
      </div>

      <div class="br-pane is-result" :class="{ 'has-result': Boolean(resultUrl) }">
        <div class="br-pane__head">
          <strong>透明结果</strong>
          <span v-if="resultUrl">
            {{ latestFromHistory ? '最近一张结果' : 'PNG · 透明通道' }}
          </span>
          <span v-else-if="processing">处理中</span>
          <button type="button" class="br-ghost" @click="openHistory">
            <i class="bi bi-clock-history" aria-hidden="true"></i>
            查看历史
          </button>
        </div>

        <div v-if="resultUrl" class="br-frame is-checker" :class="{ 'is-reveal': resultReveal }">
          <AuthenticatedImage
            class="br-result-image"
            :src="resultUrl"
            alt="背景移除结果"
            loading="eager"
            :max-dimension="1600"
          />
          <div class="br-frame__badge">
            <i class="bi bi-check2-circle" aria-hidden="true"></i>
            {{ latestFromHistory ? '历史结果' : '已抠图' }}
          </div>
        </div>

        <div v-else class="br-empty" :class="{ 'is-busy': processing }">
          <div class="br-loader" aria-hidden="true">
            <span class="br-loader__ring"></span>
            <span class="br-loader__ring is-delay"></span>
            <span class="br-loader__core">
              <i class="bi" :class="processing ? 'bi-magic' : 'bi-person-bounding-box'"></i>
            </span>
          </div>
          <strong>{{ processing ? stageMeta.label : '结果将在这里显示' }}</strong>
          <p>{{ processing ? stageMeta.detail : '移除背景后可预览、本页压缩并下载' }}</p>
          <div v-if="processing" class="br-progress" aria-hidden="true">
            <span></span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="resultUrl" class="br-compress" aria-label="本页压缩下载">
      <div class="br-compress__copy">
        <strong>
          <i class="bi bi-arrows-collapse" aria-hidden="true"></i>
          抠图后压缩
        </strong>
        <p v-if="compressBusy">正在本地压缩预览…</p>
        <p v-else-if="compressError">{{ compressError }}</p>
        <p v-else-if="compressStats">
          {{ formatBytes(compressStats.beforeBytes) }} →
          {{ formatBytes(compressStats.afterBytes) }}
          <template v-if="compressSavingsLabel"> · {{ compressSavingsLabel }}</template>
          · 本地处理，不离开本页
        </p>
        <p v-else>可直接压缩透明结果后再下载</p>
      </div>
      <div class="br-compress__controls">
        <div class="br-compress__formats" role="group" aria-label="压缩格式">
          <button
            type="button"
            class="br-seg"
            :class="{ 'is-on': compressFormat === 'png' }"
            :disabled="compressBusy || processing"
            @click="compressFormat = 'png'"
          >
            PNG 无损
          </button>
          <button
            type="button"
            class="br-seg"
            :class="{ 'is-on': compressFormat === 'webp' }"
            :disabled="compressBusy || processing"
            @click="compressFormat = 'webp'"
          >
            WebP
          </button>
        </div>
        <button
          type="button"
          class="br-btn is-primary"
          :disabled="!resultUrl || compressBusy || processing"
          @click="downloadCompressedResult"
        >
          <i
            class="bi"
            :class="compressBusy ? 'bi-arrow-repeat br-spin' : 'bi-download'"
            aria-hidden="true"
          ></i>
          {{ compressBusy ? '压缩中…' : '压缩并下载' }}
        </button>
      </div>
    </section>

    <footer class="br-actions">
      <div class="br-actions__hint">
        <template v-if="!activeTool">后台尚未开放背景移除工具</template>
        <template v-else-if="processing">请保持页面打开，完成后可本页压缩下载</template>
        <template v-else-if="resultUrl && latestFromHistory">
          正在显示最近一张抠图结果；可本页压缩，或上传新图继续处理
        </template>
        <template v-else-if="resultUrl">结果已生成，可本页压缩下载，无需跳转图片压缩页</template>
        <template v-else>支持拖入与粘贴截图；上传后按张扣积分，失败或取消会自动返还</template>
      </div>
      <div class="br-actions__btns">
        <button
          type="button"
          class="br-btn is-primary"
          :disabled="!canRun"
          @click="requestBackgroundRemoval"
        >
          <i
            class="bi"
            :class="processing ? 'bi-arrow-repeat br-spin' : 'bi-magic'"
            aria-hidden="true"
          ></i>
          {{ processing ? '处理中…' : stage === 'failed' ? '重新移除背景' : '移除背景' }}
        </button>
        <button
          type="button"
          class="br-btn is-secondary"
          :disabled="!resultUrl || processing"
          @click="downloadResult"
        >
          <i class="bi bi-download" aria-hidden="true"></i>
          原图下载
        </button>
        <button
          type="button"
          class="br-btn is-secondary"
          :disabled="!resultUrl || compressBusy || processing"
          @click="downloadCompressedResult"
        >
          <i class="bi bi-download" aria-hidden="true"></i>
          压缩下载
        </button>
      </div>
    </footer>

    <div
      v-if="historyOpen"
      class="br-history"
      role="dialog"
      aria-modal="true"
      aria-label="抠图历史"
    >
      <button type="button" class="br-history__backdrop" aria-label="关闭历史" @click="closeHistory" />
      <aside class="br-history__panel">
        <header class="br-history__head">
          <div>
            <strong>抠图历史</strong>
            <span>{{ historyCountLabel }}</span>
          </div>
          <div class="br-history__head-actions">
            <button
              type="button"
              class="br-ghost"
              :disabled="historyLoading"
              @click="loadHistory()"
            >
              <i class="bi bi-arrow-clockwise" :class="{ 'br-spin': historyLoading }" aria-hidden="true"></i>
              刷新
            </button>
            <button type="button" class="br-ghost" @click="closeHistory">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
              关闭
            </button>
          </div>
        </header>

        <div v-if="historyLoading && !historyItems.length" class="br-history__empty">
          <i class="bi bi-arrow-repeat br-spin" aria-hidden="true"></i>
          <p>正在加载历史…</p>
        </div>
        <div v-else-if="historyError && !historyItems.length" class="br-history__empty">
          <p>{{ historyError }}</p>
          <button
            v-if="authStore.isAuthenticated"
            type="button"
            class="br-btn is-secondary"
            @click="loadHistory()"
          >
            重新加载
          </button>
        </div>
        <div v-else-if="!historyItems.length" class="br-history__empty">
          <i class="bi bi-images" aria-hidden="true"></i>
          <strong>还没有抠图记录</strong>
          <p>完成一次背景移除后，结果会出现在这里</p>
        </div>
        <div v-else class="br-history__grid" role="list">
          <button
            v-for="item in historyItems"
            :key="item.id"
            type="button"
            class="br-history__card"
            role="listitem"
            :class="{ 'is-active': activeHistoryId === item.id }"
            :disabled="processing"
            @click="selectHistoryItem(item)"
          >
            <span class="br-history__thumb is-checker">
              <AuthenticatedImage
                :src="taskCoverUrl(item)"
                alt="历史抠图结果"
                :max-dimension="320"
              />
            </span>
            <span class="br-history__meta">
              <strong>{{ formatHistoryTime(item.finishedAt || item.createdAt) || '已完成' }}</strong>
              <small>点击查看</small>
            </span>
          </button>
        </div>
      </aside>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      @change="handleFileChange"
    />

    <AiCostConfirmDialog
      :show="costConfirmOpen"
      :cost="pendingCost"
      :light="!appearanceStore.isDark"
      @confirm="executeBackgroundRemoval"
      @cancel="cancelCostConfirm"
    />
  </main>
</template>

<style scoped>
/* 顶栏高度已由 app-shell 写到子根 padding-top；本页按 100dvh 铺满，避免再减一次 header。 */
:global(.app-container > .main-content:has(> .br)) {
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
  overflow: hidden;
}

.br {
  --br-ink: #14201f;
  --br-muted: #5f726e;
  --br-line: #d7e4e0;
  --br-bg: #f3f7f6;
  --br-surface: #ffffff;
  --br-soft: #e8f3f0;
  --br-accent: #0f9d8a;
  --br-accent-2: #14b8a6;
  --br-accent-soft: rgb(15 157 138 / 12%);
  --br-danger: #e11d48;
  --br-success: #059669;
  --br-frame: #e6eeeb;
  --br-shadow: 0 18px 48px rgb(20 50 45 / 8%);
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  padding-right: clamp(20px, 3.5vw, 56px);
  padding-bottom: 20px;
  padding-left: clamp(20px, 3.5vw, 56px);
  overflow: hidden;
  color: var(--br-ink);
  background: var(--br-bg);
}

.br.is-dark {
  --br-ink: #eef7f4;
  --br-muted: #9bb0aa;
  --br-line: #2a3633;
  --br-bg: #0e1211;
  --br-surface: #171c1b;
  --br-soft: #1c2623;
  --br-accent: #2dd4bf;
  --br-accent-2: #5eead4;
  --br-accent-soft: rgb(45 212 191 / 14%);
  --br-danger: #fb7185;
  --br-success: #34d399;
  --br-frame: #121716;
  --br-shadow: 0 22px 52px rgb(0 0 0 / 35%);
}

.br-glow {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 0%, rgb(20 184 166 / 16%), transparent 28%),
    radial-gradient(circle at 88% 8%, rgb(56 189 248 / 10%), transparent 24%),
    linear-gradient(180deg, color-mix(in srgb, var(--br-soft) 70%, transparent), transparent 42%);
}

.br-header {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.85fr);
  gap: 16px;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto 16px;
  align-items: stretch;
}

.br-header__copy {
  display: grid;
  align-content: center;
  gap: 10px;
  padding: 8px 4px;
}

.br-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  color: var(--br-accent);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.br-header h1 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.4rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.05;
}

.br-header__copy > p {
  margin: 0;
  max-width: 48ch;
  color: var(--br-muted);
  font-size: 0.92rem;
  line-height: 1.55;
}

.br-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.br-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid var(--br-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--br-surface) 80%, transparent);
  color: var(--br-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.br-chip.is-price {
  color: var(--br-accent);
  border-color: color-mix(in srgb, var(--br-accent) 35%, var(--br-line));
  background: var(--br-accent-soft);
}

.br-chip.is-warn {
  color: var(--br-danger);
  border-color: color-mix(in srgb, var(--br-danger) 35%, var(--br-line));
}

.br-status {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px 14px;
  overflow: hidden;
  border: 1px solid var(--br-line);
  border-radius: 20px;
  background: var(--br-surface);
  box-shadow: var(--br-shadow);
}

.br-status__pulse {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--br-muted);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--br-muted) 40%, transparent);
}

.br-status[data-tone='busy'] .br-status__pulse {
  background: var(--br-accent);
  animation: br-pulse 1.6s ease-out infinite;
}

.br-status[data-tone='success'] .br-status__pulse {
  background: var(--br-success);
}

.br-status[data-tone='danger'] .br-status__pulse {
  background: var(--br-danger);
}

.br-status[data-tone='ready'] .br-status__pulse {
  background: var(--br-accent-2);
}

.br-status__copy small {
  display: block;
  color: var(--br-muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.br-status__copy strong {
  display: block;
  margin-top: 4px;
  font-size: 1.15rem;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.br-status__copy p {
  margin: 6px 0 0;
  color: var(--br-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.br-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.br-steps li {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
  color: var(--br-muted);
  font-size: 0.66rem;
  font-weight: 700;
}

.br-steps li::before {
  content: '';
  display: block;
  height: 4px;
  border-radius: 999px;
  background: var(--br-line);
  transition:
    background 220ms ease,
    box-shadow 220ms ease;
}

.br-steps li.is-done::before,
.br-steps li.is-active::before {
  background: linear-gradient(90deg, var(--br-accent), var(--br-accent-2));
}

.br-steps li.is-active::before {
  box-shadow: 0 0 0 3px var(--br-accent-soft);
  animation: br-step-glow 1.4s ease-in-out infinite;
}

.br-steps li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br-workspace {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) 72px minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  width: 100%;
  max-width: 1280px;
  min-height: 0;
  margin: 0 auto;
}

.br-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--br-line);
  border-radius: 22px;
  background: var(--br-surface);
  box-shadow: var(--br-shadow);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.br-pane.is-dragging {
  border-color: var(--br-accent);
  box-shadow:
    0 0 0 3px var(--br-accent-soft),
    var(--br-shadow);
}

.br-pane__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 16px 0 18px;
  border-bottom: 1px solid var(--br-line);
}

.br-pane__head strong {
  font-size: 0.9rem;
  font-weight: 800;
}

.br-pane__head span {
  min-width: 0;
  overflow: hidden;
  color: var(--br-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br-pane__head .br-ghost {
  margin-left: auto;
}

.br-ghost,
.br-btn,
.br-frame__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--br-line);
  border-radius: 12px;
  background: var(--br-surface);
  color: inherit;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}

.br-ghost {
  min-height: 32px;
  padding: 0 10px;
  color: var(--br-muted);
  font-size: 0.74rem;
}

.br-dropzone {
  display: grid;
  flex: 1;
  place-content: center;
  gap: 10px;
  padding: 24px;
  border: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--br-soft) 70%, transparent), transparent),
    transparent;
  color: var(--br-muted);
  cursor: pointer;
}

.br-dropzone__icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  margin: 0 auto 4px;
  border-radius: 20px;
  color: var(--br-accent);
  background: var(--br-accent-soft);
  font-size: 1.7rem;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--br-accent) 18%, transparent);
}

.br-dropzone strong {
  color: var(--br-ink);
  font-size: 1.05rem;
  font-weight: 850;
}

.br-dropzone span {
  font-size: 0.84rem;
}

.br-frame {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  background: var(--br-frame);
}

.br-frame.is-checker {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(-45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #dfe7e4 75%),
    linear-gradient(-45deg, transparent 75%, #dfe7e4 75%);
  background-position: 0 0, 0 12px, 12px -12px, -12px 0;
  background-size: 24px 24px;
}

.br.is-dark .br-frame.is-checker {
  background-color: #101413;
  background-image:
    linear-gradient(45deg, #1b2321 25%, transparent 25%),
    linear-gradient(-45deg, #1b2321 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1b2321 75%),
    linear-gradient(-45deg, transparent 75%, #1b2321 75%);
}

/* 以框高为准完整容纳图片，避免 width:100% 把竖图底部裁掉 */
.br-frame > img {
  flex: 0 1 auto;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.br-frame > .br-result-image {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  background: transparent;
  transition:
    opacity 420ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 520ms ease;
}

.br-frame > .br-result-image :deep(.authenticated-image-media) {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.br-frame.is-checker > .br-result-image {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  filter: blur(4px);
}

.br-frame.is-checker.is-reveal > .br-result-image {
  opacity: 1;
  transform: none;
  filter: none;
}

.br-frame__action,
.br-frame__badge {
  position: absolute;
  z-index: 2;
}

.br-frame__action {
  right: 14px;
  bottom: 14px;
  min-height: 36px;
  padding: 0 12px;
  color: var(--br-ink);
  background: color-mix(in srgb, var(--br-surface) 92%, transparent);
  backdrop-filter: blur(10px);
  font-size: 0.78rem;
}

.br-frame__badge {
  top: 14px;
  left: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  color: #fff;
  background: color-mix(in srgb, var(--br-success) 92%, #000);
  font-size: 0.72rem;
  font-weight: 800;
}

.br-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.br-scan__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(15 157 138 / 8%), transparent 40%, rgb(15 157 138 / 10%));
}

.br-scan__beam {
  position: absolute;
  left: -8%;
  width: 116%;
  height: 18%;
  background: linear-gradient(
    180deg,
    transparent,
    rgb(45 212 191 / 28%),
    rgb(255 255 255 / 55%),
    rgb(45 212 191 / 28%),
    transparent
  );
  filter: blur(0.4px);
  animation: br-scan 1.8s ease-in-out infinite;
}

.br-bridge {
  position: relative;
  display: grid;
  place-items: center;
}

.br-bridge__rail {
  position: absolute;
  top: 50%;
  left: 12px;
  right: 12px;
  display: flex;
  justify-content: space-between;
  transform: translateY(-50%);
}

.br-bridge__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--br-line);
}

.br.is-processing .br-bridge__dot {
  animation: br-flow 1.1s ease-in-out infinite;
}

.br.is-processing .br-bridge__dot:nth-child(2) {
  animation-delay: 0.12s;
}
.br.is-processing .br-bridge__dot:nth-child(3) {
  animation-delay: 0.24s;
}
.br.is-processing .br-bridge__dot:nth-child(4) {
  animation-delay: 0.36s;
}
.br.is-processing .br-bridge__dot:nth-child(5) {
  animation-delay: 0.48s;
}

.br-bridge__orb {
  position: relative;
  z-index: 1;
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--br-accent) 35%, var(--br-line));
  border-radius: 50%;
  color: var(--br-accent);
  background: var(--br-surface);
  box-shadow: var(--br-shadow);
  font-size: 1.15rem;
}

.br.is-processing .br-bridge__orb {
  animation: br-orb 1.4s ease-in-out infinite;
}

.br.is-done .br-bridge__orb {
  color: #fff;
  background: var(--br-success);
  border-color: transparent;
}

.br-empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 28px 20px;
  text-align: center;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--br-soft) 55%, transparent), transparent 50%),
    var(--br-surface);
}

.br-empty strong {
  font-size: 1rem;
  font-weight: 850;
}

.br-empty p {
  margin: 0;
  max-width: 28ch;
  color: var(--br-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.br-loader {
  position: relative;
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
  margin-bottom: 6px;
}

.br-loader__ring {
  position: absolute;
  inset: 0;
  border: 2px solid transparent;
  border-top-color: var(--br-accent);
  border-right-color: color-mix(in srgb, var(--br-accent) 35%, transparent);
  border-radius: 50%;
  opacity: 0.35;
}

.br-empty.is-busy .br-loader__ring {
  opacity: 1;
  animation: br-spin 1.1s linear infinite;
}

.br-empty.is-busy .br-loader__ring.is-delay {
  inset: 10px;
  animation-direction: reverse;
  animation-duration: 1.6s;
  border-top-color: var(--br-accent-2);
}

.br-loader__core {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 18px;
  color: var(--br-accent);
  background: var(--br-accent-soft);
  font-size: 1.35rem;
}

.br-empty.is-busy .br-loader__core {
  animation: br-breathe 1.5s ease-in-out infinite;
}

.br-progress {
  width: min(220px, 70%);
  height: 4px;
  overflow: hidden;
  margin-top: 6px;
  border-radius: 999px;
  background: var(--br-line);
}

.br-progress span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--br-accent), var(--br-accent-2));
  animation: br-progress 1.35s ease-in-out infinite;
}

.br-compress {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  max-width: 1280px;
  margin: 14px auto 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--br-accent) 28%, var(--br-line));
  border-radius: 16px;
  background: color-mix(in srgb, var(--br-accent) 8%, var(--br-surface));
}

.br-compress__copy {
  display: grid;
  gap: 4px;
  min-width: min(100%, 280px);
}

.br-compress__copy strong {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--br-ink);
  font-size: 0.92rem;
}

.br-compress__copy p {
  margin: 0;
  color: var(--br-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.br-compress__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.br-compress__formats {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--br-line);
  border-radius: 999px;
  background: var(--br-surface);
}

.br-seg {
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--br-muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.br-seg.is-on {
  background: color-mix(in srgb, var(--br-accent) 18%, var(--br-surface));
  color: var(--br-ink);
}

.br-seg:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.br-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  max-width: 1280px;
  margin: 14px auto 0;
}

.br-actions__hint {
  color: var(--br-muted);
  font-size: 0.82rem;
}

.br-actions__btns {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.br-btn {
  min-height: 44px;
  min-width: 138px;
  padding: 0 18px;
  font-size: 0.9rem;
  transition:
    transform 160ms ease,
    background 160ms ease,
    border-color 160ms ease,
    opacity 160ms ease;
}

.br-btn.is-primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--br-accent), var(--br-accent-2));
  box-shadow: 0 12px 28px rgb(15 157 138 / 24%);
}

.br-btn.is-secondary {
  color: var(--br-ink);
  background: var(--br-surface);
}

.br-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.br-history {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  justify-items: end;
}

.br-history__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgb(10 16 15 / 42%);
  cursor: pointer;
}

.br-history__panel {
  position: relative;
  z-index: 1;
  display: flex;
  width: min(420px, 100%);
  height: 100%;
  flex-direction: column;
  border-left: 1px solid var(--br-line);
  background: var(--br-surface);
  box-shadow: -18px 0 48px rgb(12 28 24 / 18%);
  color: var(--br-ink);
  animation: br-history-in 220ms ease;
}

.br-history__head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  padding: calc(var(--app-header-offset, 82px) + 8px) 16px 12px;
  border-bottom: 1px solid var(--br-line);
}

.br-history__head strong {
  display: block;
  font-size: 1.05rem;
  font-weight: 850;
}

.br-history__head span {
  color: var(--br-muted);
  font-size: 0.75rem;
}

.br-history__head-actions {
  display: flex;
  gap: 6px;
}

.br-history__grid {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
  min-height: 0;
  padding: 14px;
  overflow: auto;
}

.br-history__card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--br-line);
  border-radius: 16px;
  background: color-mix(in srgb, var(--br-soft) 55%, var(--br-surface));
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.br-history__card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--br-accent) 45%, var(--br-line));
  transform: translateY(-1px);
  box-shadow: var(--br-shadow);
}

.br-history__card.is-active {
  border-color: color-mix(in srgb, var(--br-accent) 55%, var(--br-line));
  box-shadow: 0 0 0 3px var(--br-accent-soft);
}

.br-history__card:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.br-history__thumb {
  display: grid;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(-45deg, #dfe7e4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #dfe7e4 75%),
    linear-gradient(-45deg, transparent 75%, #dfe7e4 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
}

.br.is-dark .br-history__thumb {
  background-color: #101413;
  background-image:
    linear-gradient(45deg, #1b2321 25%, transparent 25%),
    linear-gradient(-45deg, #1b2321 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1b2321 75%),
    linear-gradient(-45deg, transparent 75%, #1b2321 75%);
}

.br-history__thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
}

.br-history__meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.br-history__meta strong {
  overflow: hidden;
  font-size: 0.78rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br-history__meta small {
  color: var(--br-muted);
  font-size: 0.7rem;
}

.br-history__empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 32px 24px;
  color: var(--br-muted);
  text-align: center;
}

.br-history__empty i {
  font-size: 1.6rem;
  color: var(--br-accent);
}

.br-history__empty strong {
  color: var(--br-ink);
  font-size: 0.95rem;
}

.br-history__empty p {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.5;
}

@keyframes br-history-in {
  from {
    opacity: 0.4;
    transform: translateX(18px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.br-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none;
}

.br-spin {
  animation: br-spin 0.85s linear infinite;
}

@keyframes br-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes br-scan {
  0% {
    top: -20%;
  }
  100% {
    top: 110%;
  }
}

@keyframes br-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--br-accent) 45%, transparent);
  }
  70% {
    box-shadow: 0 0 0 12px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@keyframes br-step-glow {
  50% {
    filter: brightness(1.15);
  }
}

@keyframes br-flow {
  0%,
  100% {
    background: var(--br-line);
    transform: scale(0.9);
  }
  50% {
    background: var(--br-accent);
    transform: scale(1.25);
  }
}

@keyframes br-orb {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}

@keyframes br-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

@keyframes br-progress {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(280%);
  }
}

@media (max-width: 960px) {
  .br-header,
  .br-workspace {
    grid-template-columns: 1fr;
  }

  .br-workspace {
    gap: 12px;
    overflow: auto;
  }

  .br-pane {
    min-height: 280px;
  }

  .br-bridge {
    min-height: 48px;
  }

  .br-bridge__rail {
    top: 50%;
    left: 20%;
    right: 20%;
  }

  .br-actions,
  .br-compress {
    align-items: stretch;
  }

  .br-compress__controls,
  .br-actions__btns,
  .br-btn {
    width: 100%;
  }

  .br-compress__formats {
    width: 100%;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .br-scan__beam,
  .br-status__pulse,
  .br-steps li.is-active::before,
  .br-bridge__dot,
  .br-bridge__orb,
  .br-loader__ring,
  .br-loader__core,
  .br-progress span,
  .br-spin,
  .br-frame > img,
  .br-frame > .br-result-image {
    animation: none !important;
    transition: none !important;
  }

  .br-frame.is-checker > .br-result-image,
  .br-history__panel {
    opacity: 1;
    transform: none;
    filter: none;
    animation: none !important;
  }
}
</style>
