<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AiCostConfirmDialog from '@/features/ai-shared/AiCostConfirmDialog.vue'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { removeImageBackground, uploadAiInputFile } from '@/services/aiWallpaper'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'

const STAGE_META = {
  idle: { label: '等待上传', detail: '选择一张图片开始抠图' },
  ready: { label: '准备就绪', detail: '点击下方按钮移除背景' },
  uploading: { label: '上传原图', detail: '正在安全上传到处理通道' },
  queued: { label: '排队中', detail: '任务已创建，等待算力分配' },
  running: { label: '智能抠图', detail: '正在分离主体与背景' },
  succeeded: { label: '处理完成', detail: '透明 PNG 已就绪，可下载' },
  failed: { label: '处理失败', detail: '可更换图片或重试' },
}

const STAGE_ORDER = ['uploading', 'queued', 'running', 'succeeded']

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

function releaseSourcePreview() {
  if (sourcePreview.value.startsWith('blob:')) URL.revokeObjectURL(sourcePreview.value)
  sourcePreview.value = ''
}

function selectFile(file) {
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
  stage.value = 'ready'
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
  resultReveal.value = false
  errorMessage.value = ''
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

async function executeBackgroundRemoval() {
  if (!canRun.value) return
  costConfirmOpen.value = false
  pendingCost.value = null
  processing.value = true
  resultUrl.value = ''
  resultReveal.value = false
  errorMessage.value = ''
  stage.value = 'uploading'
  try {
    const uploadedUrl = await uploadAiInputFile(sourceFile.value)
    stage.value = 'queued'
    const response = await removeImageBackground(uploadedUrl, activeTool.value.id, {
      onUpdate: applyTaskStage,
    })
    const output = response?.result?.outputs?.[0] || response?.job?.originalMediaUrls?.[0] || ''
    if (!output) throw new Error('任务已完成，但没有返回图片')
    resultUrl.value = output
    stage.value = 'succeeded'
    requestAnimationFrame(() => {
      resultReveal.value = true
    })
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

onMounted(async () => {
  await runtimeConfigStore.loadRuntimeConfig({ force: true }).catch(() => null)
})

onBeforeUnmount(releaseSourcePreview)
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
        <p>上传商品或人像图，一键保留主体并导出透明 PNG，可直接用于电商主图与合成。</p>
        <div class="br-meta">
          <span class="br-chip">
            <i class="bi bi-filetype-png" aria-hidden="true"></i>
            透明 PNG
          </span>
          <span class="br-chip">
            <i class="bi bi-image" aria-hidden="true"></i>
            最大 15MB
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
          <span>点击选择，或拖入 PNG / JPG / WebP</span>
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
          <span v-if="resultUrl">PNG · 透明通道</span>
          <span v-else-if="processing">处理中</span>
        </div>

        <div v-if="resultUrl" class="br-frame is-checker" :class="{ 'is-reveal': resultReveal }">
          <img :src="resultUrl" alt="背景移除结果" />
          <div class="br-frame__badge">
            <i class="bi bi-check2-circle" aria-hidden="true"></i>
            已抠图
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
          <p>{{ processing ? stageMeta.detail : '移除背景后可预览透明底与下载 PNG' }}</p>
          <div v-if="processing" class="br-progress" aria-hidden="true">
            <span></span>
          </div>
        </div>
      </div>
    </section>

    <footer class="br-actions">
      <div class="br-actions__hint">
        <template v-if="!activeTool">后台尚未开放背景移除工具</template>
        <template v-else-if="processing">请保持页面打开，完成后可立即下载</template>
        <template v-else-if="resultUrl">结果已生成，可继续更换图片再抠一张</template>
        <template v-else>上传后按张扣积分；失败或取消会自动返还</template>
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
          :disabled="!resultUrl"
          @click="downloadResult"
        >
          <i class="bi bi-download" aria-hidden="true"></i>
          下载 PNG
        </button>
      </div>
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
  min-height: calc(100dvh - var(--app-header-offset, 72px));
  padding: 28px clamp(20px, 3.5vw, 56px) 36px;
  overflow: clip;
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
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.85fr);
  gap: 20px;
  max-width: 1280px;
  margin: 0 auto 22px;
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
  font-size: clamp(2rem, 3.6vw, 2.75rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1.05;
}

.br-header__copy > p {
  margin: 0;
  max-width: 48ch;
  color: var(--br-muted);
  font-size: 0.98rem;
  line-height: 1.65;
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
  gap: 14px;
  padding: 18px 18px 16px;
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
  grid-template-columns: minmax(0, 1fr) 72px minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  max-width: 1280px;
  height: min(62vh, 680px);
  min-height: 460px;
  margin: 0 auto;
}

.br-pane {
  display: flex;
  min-width: 0;
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
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: 22px;
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

.br-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition:
    opacity 420ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 520ms ease;
}

.br-frame.is-checker img {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  filter: blur(4px);
}

.br-frame.is-checker.is-reveal img {
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

.br-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  max-width: 1280px;
  margin: 18px auto 0;
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
    height: auto;
    min-height: 0;
    gap: 12px;
  }

  .br-pane {
    min-height: 320px;
  }

  .br-bridge {
    min-height: 48px;
  }

  .br-bridge__rail {
    top: 50%;
    left: 20%;
    right: 20%;
  }

  .br-actions {
    align-items: stretch;
  }

  .br-actions__btns,
  .br-btn {
    width: 100%;
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
  .br-frame img {
    animation: none !important;
    transition: none !important;
  }

  .br-frame.is-checker img {
    opacity: 1;
    transform: none;
    filter: none;
  }
}
</style>
