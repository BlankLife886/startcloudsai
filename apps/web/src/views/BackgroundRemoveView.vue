<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { removeImageBackground, uploadAiInputFile } from '@/services/aiWallpaper'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import notificationService from '@/services/notification'

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

const toolModels = computed(() => {
  const models = runtimeConfigStore.getFeaturePayload('ai.imageTools')?.backgroundRemovalModels
  return Array.isArray(models) ? models.filter((model) => model?.id) : []
})
const activeTool = computed(
  () => toolModels.value.find((model) => model.default === true) || toolModels.value[0] || null,
)
const canRun = computed(() => Boolean(sourceFile.value && activeTool.value && !processing.value))

function releaseSourcePreview() {
  if (sourcePreview.value.startsWith('blob:')) URL.revokeObjectURL(sourcePreview.value)
  sourcePreview.value = ''
}

function selectFile(file) {
  if (!file) return
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
}

function handleFileChange(event) {
  selectFile(event.target.files?.[0])
  event.target.value = ''
}

function handleDrop(event) {
  dragging.value = false
  selectFile(event.dataTransfer?.files?.[0])
}

function clearImage() {
  if (processing.value) return
  releaseSourcePreview()
  sourceFile.value = null
  resultUrl.value = ''
}

async function executeBackgroundRemoval() {
  if (!canRun.value) return
  costConfirmOpen.value = false
  pendingCost.value = null
  processing.value = true
  resultUrl.value = ''
  try {
    const uploadedUrl = await uploadAiInputFile(sourceFile.value)
    const response = await removeImageBackground(uploadedUrl, activeTool.value.id)
    const output = response?.result?.outputs?.[0] || response?.job?.originalMediaUrls?.[0] || ''
    if (!output) throw new Error('任务已完成，但没有返回图片')
    resultUrl.value = output
    notificationService.success('背景已移除')
  } catch (error) {
    notificationService.error(error?.message || '背景移除失败')
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
  const unitPrice = Math.max(0, Number(activeTool.value?.pricePoints || 0))
  pendingCost.value = {
    billingMode: 'credits',
    unitCost: unitPrice,
    unitPriceCents: unitPrice,
    totalPriceCents: unitPrice,
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

onMounted(async () => {
  await runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null)
})

onBeforeUnmount(releaseSourcePreview)
</script>

<template>
  <main class="background-remove-page">
    <header class="background-remove-header">
      <div>
        <span class="background-remove-kicker">图片工具</span>
        <h1>背景移除</h1>
        <p>上传图片，保留主体并导出透明 PNG。</p>
      </div>
      <button
        v-if="sourceFile"
        type="button"
        class="background-remove-clear"
        :disabled="processing"
        @click="clearImage"
      >
        <i class="bi bi-trash3" aria-hidden="true"></i>
        清空
      </button>
    </header>

    <section class="background-remove-workspace" aria-label="背景移除工作区">
      <div
        class="background-remove-pane source-pane"
        :class="{ 'is-dragging': dragging }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="pane-heading">
          <strong>原图</strong>
          <span v-if="sourceFile">{{ sourceFile.name }}</span>
        </div>
        <button
          v-if="!sourcePreview"
          type="button"
          class="background-remove-dropzone"
          @click="fileInput?.click()"
        >
          <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
          <strong>上传图片</strong>
          <span>点击选择或拖入图片</span>
        </button>
        <div v-else class="background-remove-image-frame">
          <img :src="sourcePreview" alt="待处理原图" />
          <button type="button" @click="fileInput?.click()">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            更换图片
          </button>
        </div>
      </div>

      <div class="background-remove-flow" aria-hidden="true">
        <i class="bi bi-arrow-right"></i>
      </div>

      <div class="background-remove-pane result-pane">
        <div class="pane-heading">
          <strong>透明结果</strong>
          <span v-if="resultUrl">PNG</span>
        </div>
        <div v-if="resultUrl" class="background-remove-image-frame checkerboard">
          <img :src="resultUrl" alt="背景移除结果" />
        </div>
        <div v-else class="background-remove-empty">
          <span class="result-placeholder">
            <i v-if="processing" class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
            <i v-else class="bi bi-person-bounding-box" aria-hidden="true"></i>
          </span>
          <strong>{{ processing ? '正在移除背景' : '结果将在这里显示' }}</strong>
        </div>
      </div>
    </section>

    <footer class="background-remove-actions">
      <span v-if="!activeTool" class="background-remove-unavailable">后台尚未开放背景移除工具</span>
      <button
        type="button"
        class="background-remove-primary"
        :disabled="!canRun"
        @click="requestBackgroundRemoval"
      >
        <i v-if="processing" class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
        <i v-else class="bi bi-magic" aria-hidden="true"></i>
        {{ processing ? '处理中' : '移除背景' }}
      </button>
      <button
        type="button"
        class="background-remove-download"
        :disabled="!resultUrl"
        @click="downloadResult"
      >
        <i class="bi bi-download" aria-hidden="true"></i>
        下载 PNG
      </button>
    </footer>

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
.background-remove-page {
  min-height: calc(100vh - var(--app-header-offset, 72px));
  padding: 34px clamp(28px, 4vw, 72px) 42px;
  color: var(--text-primary, #202124);
  background: var(--page-bg, #f5f6f8);
}

.background-remove-header {
  max-width: 1500px;
  margin: 0 auto 24px;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
}

.background-remove-kicker {
  display: block;
  margin-bottom: 6px;
  color: #1677ff;
  font-size: 13px;
  font-weight: 700;
}

.background-remove-header h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
}

.background-remove-header p {
  margin: 8px 0 0;
  color: var(--text-secondary, #667085);
  font-size: 15px;
}

.background-remove-clear,
.background-remove-image-frame button,
.background-remove-primary,
.background-remove-download {
  min-height: 40px;
  border-radius: 7px;
  border: 1px solid var(--border-color, #dfe3e8);
  background: var(--surface-bg, #fff);
  color: inherit;
  padding: 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 650;
}

.background-remove-workspace {
  max-width: 1500px;
  height: min(66vh, 720px);
  min-height: 480px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px minmax(0, 1fr);
  align-items: stretch;
}

.background-remove-pane {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-color, #dfe3e8);
  border-radius: 8px;
  background: var(--surface-bg, #fff);
  display: flex;
  flex-direction: column;
}

.background-remove-pane.is-dragging {
  border-color: #1677ff;
  box-shadow: inset 0 0 0 2px rgba(22, 119, 255, 0.16);
}

.pane-heading {
  height: 54px;
  flex: 0 0 54px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.pane-heading span {
  overflow: hidden;
  color: var(--text-secondary, #667085);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.background-remove-dropzone,
.background-remove-empty {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text-secondary, #667085);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.background-remove-dropzone i,
.result-placeholder i {
  font-size: 34px;
  color: #1677ff;
}

.background-remove-dropzone strong,
.background-remove-empty strong {
  color: var(--text-primary, #202124);
  font-size: 15px;
}

.background-remove-image-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 24px;
  display: grid;
  place-items: center;
  background: #eef0f3;
}

.background-remove-image-frame.checkerboard {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
    linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
}

.background-remove-image-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.background-remove-image-frame button {
  position: absolute;
  right: 16px;
  bottom: 16px;
  min-height: 36px;
  background: rgba(255, 255, 255, 0.92);
  color: #202124;
  backdrop-filter: blur(12px);
}

.background-remove-flow {
  display: grid;
  place-items: center;
  color: var(--text-secondary, #98a2b3);
  font-size: 22px;
}

.background-remove-actions {
  max-width: 1500px;
  margin: 20px auto 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.background-remove-primary {
  min-width: 150px;
  border-color: #1677ff;
  background: #1677ff;
  color: #fff;
}

.background-remove-download {
  min-width: 130px;
}

.background-remove-unavailable {
  margin-right: auto;
  color: #d92d20;
  font-size: 13px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.spin {
  animation: background-remove-spin 0.8s linear infinite;
}

@keyframes background-remove-spin {
  to {
    transform: rotate(360deg);
  }
}

:global(html.dark) .background-remove-page,
:global([data-theme='dark']) .background-remove-page {
  --page-bg: #101113;
  --surface-bg: #17191d;
  --border-color: #2c3036;
  --text-primary: #f4f5f7;
  --text-secondary: #a6adb8;
}

:global(html.dark) .background-remove-image-frame,
:global([data-theme='dark']) .background-remove-image-frame {
  background-color: #111316;
}
</style>
