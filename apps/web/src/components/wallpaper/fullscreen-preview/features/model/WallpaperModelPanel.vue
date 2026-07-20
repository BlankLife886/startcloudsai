<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  createImageTo3dJob,
  waitForImageTo3dJob,
} from '@/services/aiModel3d'
import { useAuthStore } from '@/stores/auth'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { cancelServerAiJob, deleteServerAiJob } from '@/services/aiWallpaper'
import { getRuntimeAiProviderModels } from '@/config/aiModels'
import '@/features/ai-image-to-3d/styles/model-studio.css'
import { useModelStudioMotion } from '@/features/ai-image-to-3d/composables/useModelStudioMotion'

const props = defineProps({
  show: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false },
  imageUrl: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  imageInfo: { type: Object, default: null },
  wallpaper: { type: Object, default: null },
  loadImageFromSrc: { type: Function, default: null },
  runtimeConfig: { type: Object, default: null },
  disabledMessage: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const router = useRouter()
const authStore = useAuthStore()

const OPTIMAL_MODEL_PARAMS = {
  quality: 'high',
  format: 'glb',
  textureEnabled: true,
  pbrEnabled: true,
  targetPolycount: '150000',
  textureQuality: 'HD',
  faceLimit: '150000',
  quadMesh: false,
  textureAlignment: 'original_image',
  orientation: 'align_image',
  autoSize: true,
  cropMode: 'subject',
}

const FALLBACK_MODEL_PROVIDER = 'gptproto'
const FALLBACK_MODEL_ID = 'tripo3d-v2.5'
const DEFAULT_PARAMETER_RANGES = {
  faceLimit: { min: 1000, max: 300000, step: 1000 },
  seed: { min: 0, max: 2147483647, step: 1 },
  textureSeed: { min: 0, max: 2147483647, step: 1 },
}

const provider = ref(FALLBACK_MODEL_PROVIDER)
const selectedModel = ref(FALLBACK_MODEL_ID)
const quality = ref(OPTIMAL_MODEL_PARAMS.quality)
const format = ref(OPTIMAL_MODEL_PARAMS.format)
const textureEnabled = ref(OPTIMAL_MODEL_PARAMS.textureEnabled)
const pbrEnabled = ref(OPTIMAL_MODEL_PARAMS.pbrEnabled)
const targetPolycount = ref(OPTIMAL_MODEL_PARAMS.targetPolycount)
const textureQuality = ref(OPTIMAL_MODEL_PARAMS.textureQuality)
const faceLimit = ref(OPTIMAL_MODEL_PARAMS.faceLimit)
const quadMesh = ref(OPTIMAL_MODEL_PARAMS.quadMesh)
const textureAlignment = ref(OPTIMAL_MODEL_PARAMS.textureAlignment)
const orientation = ref(OPTIMAL_MODEL_PARAMS.orientation)
const autoSize = ref(OPTIMAL_MODEL_PARAMS.autoSize)
const cropMode = ref(OPTIMAL_MODEL_PARAMS.cropMode)
const seed = ref('')
const textureSeed = ref('')
const selectedPublicModel = ref('')
const task = ref(null)
const loading = ref(false)
const error = ref('')
const statusText = ref('')
const modelResult = ref(null)
const previewHost = ref(null)
const importFileInput = ref(null)
const importedImageUrl = ref('')
const importedImageName = ref('')
const importedImageSize = ref({ width: 0, height: 0 })
const previewLoading = ref(false)
const previewError = ref('')
const showAdvanced = ref(false)
const dragOver = ref(false)
const panelRef = ref(null)
const deletingTask = ref(false)
let previewState = null
let importedObjectUrl = ''
let previewLoadToken = 0
let modelTaskAbortController = null

const featureConfig = computed(() => props.runtimeConfig?.config || props.runtimeConfig || {})
const runtimeModelCatalog = computed(() => props.runtimeConfig?.aiModelCatalog || props.runtimeConfig?.config?.aiModelCatalog || null)
const isRuntimeEnabled = computed(() => props.runtimeConfig?.enabled !== false && !props.disabledMessage)
const disabledReason = computed(() => props.disabledMessage || '图转模型功能暂未开放')
const maxUploadMb = computed(() => {
  const configured = Number(featureConfig.value.maxUploadMb)
  return Number.isFinite(configured) && configured > 0 ? configured : 10
})
const parameterRanges = computed(() => ({
  ...DEFAULT_PARAMETER_RANGES,
  ...(featureConfig.value.parameterRanges || {}),
}))
const faceLimitRange = computed(() => normalizeRange(parameterRanges.value.faceLimit, DEFAULT_PARAMETER_RANGES.faceLimit))
const seedRange = computed(() => normalizeRange(parameterRanges.value.seed, DEFAULT_PARAMETER_RANGES.seed))
const textureSeedRange = computed(() => normalizeRange(parameterRanges.value.textureSeed, DEFAULT_PARAMETER_RANGES.textureSeed))
const allowedProviderIds = computed(() => normalizeStringList(featureConfig.value.allowedProviders))
const allowedModelIds = computed(() => normalizeStringList(featureConfig.value.allowedModels))
const publicModelOptions = computed(() =>
  normalizePublicModels(featureConfig.value.publicModels).filter((model) =>
    model.capabilities.includes('image.to3d'),
  ),
)
const currentPublicModel = computed(() =>
  publicModelOptions.value.find((model) => model.id === selectedPublicModel.value) ||
  publicModelOptions.value[0] ||
  null,
)
const runtimeProviderItems = computed(() => {
  const providers = Array.isArray(runtimeModelCatalog.value?.providers)
    ? runtimeModelCatalog.value.providers
    : []
  return providers
    .map((item) => ({
      id: String(item?.id || '').trim(),
      label: String(item?.label || item?.id || '').trim(),
      baseURL: String(item?.baseURL || item?.baseUrl || ''),
      note: String(item?.note || ''),
    }))
    .filter((item) => item.id)
})
const providerOptions = computed(() => {
  const allowed = allowedProviderIds.value
  const providers = allowed.length
    ? runtimeProviderItems.value.filter((item) => allowed.includes(item.id))
    : runtimeProviderItems.value
  return providers.filter((item) => getModelOptionsForProvider(item.id).length > 0)
})
const modelOptions = computed(() => getModelOptionsForProvider(provider.value))
const selectedModelLabel = computed(
  () => modelOptions.value.find((item) => item.id === selectedModel.value)?.label || selectedModel.value,
)
const sourceLabel = computed(() => {
  if (importedImageUrl.value) return importedImageName.value || '导入图片'
  if (props.wallpaper?.id) return `Wallhaven #${props.wallpaper.id}`
  return props.imageUrl ? '当前预览图片' : '未读取到图片'
})

const resolutionLabel = computed(() => {
  if (importedImageUrl.value) {
    const { width, height } = importedImageSize.value || {}
    return width && height ? `${width} x ${height}` : '导入图片'
  }
  const width = props.imageInfo?.dimension_x || props.imageInfo?.width || props.wallpaper?.width
  const height = props.imageInfo?.dimension_y || props.imageInfo?.height || props.wallpaper?.height
  if (!width || !height) return '尺寸未知'
  return `${width} x ${height}`
})

const displayImageUrl = computed(() => importedImageUrl.value || props.imageUrl)
const taskImageUrl = computed(() => importedImageUrl.value || props.sourceUrl || props.imageUrl)
const canCreateTask = computed(
  () =>
    isRuntimeEnabled.value &&
    Boolean(taskImageUrl.value) &&
    (Boolean(currentPublicModel.value) || (Boolean(provider.value) && Boolean(selectedModel.value))),
)

const modelDownloadUrl = computed(() => {
  const urls = modelResult.value?.modelUrls || {}
  const preferredFormat = quadMesh.value ? 'fbx' : format.value
  return urls[preferredFormat] || urls.glb || Object.values(urls)[0] || ''
})

const modelPreviewUrl = computed(() => {
  const urls = modelResult.value?.modelUrls || {}
  const glbUrl = urls.glb || urls.gltf || ''
  if (glbUrl) return glbUrl
  const firstPreviewable = Object.values(urls).find((url) => /\.(glb|gltf)(?:[?#].*)?$/i.test(String(url)))
  return firstPreviewable || ''
})

useModelStudioMotion({
  rootRef: panelRef,
  loading,
  modelPreviewUrl,
  previewLoading,
  error,
})

async function createModelTask() {
  if (!canCreateTask.value) return
  // 未登录时直接引导登录，避免发出注定 401 的请求后只在底部弹一条"未登录"
  if (!authStore.isAuthenticated) {
    router.push({ path: '/auth', query: createLoginRedirectQuery(router.currentRoute.value.fullPath) })
    return
  }
  modelTaskAbortController?.abort?.()
  const controller = new AbortController()
  modelTaskAbortController = controller
  normalizeNumericParams()
  loading.value = true
  error.value = ''
  modelResult.value = null
  try {
    const created = await createImageTo3dJob({
      imageUrl: taskImageUrl.value,
      loadImageFromSrc: props.loadImageFromSrc,
      provider: currentPublicModel.value ? '' : provider.value,
      model: currentPublicModel.value?.id || selectedModel.value,
      maxUploadMb: maxUploadMb.value,
      quality: quality.value,
      format: format.value,
      texture: textureEnabled.value,
      pbr: pbrEnabled.value,
      targetPolycount: targetPolycount.value,
      textureQuality: textureEnabled.value ? textureQuality.value : 'no',
      faceLimit: faceLimit.value,
      quadMesh: quadMesh.value,
      textureAlignment: textureAlignment.value,
      orientation: orientation.value,
      autoSize: autoSize.value,
      seed: seed.value,
      textureSeed: textureSeed.value,
      cropMode: cropMode.value,
      onStatus: (text) => {
        statusText.value = text
      },
    })
    task.value = {
      ...created,
      provider: provider.value,
      model: '系统自动选择',
      quality: quality.value,
      format: format.value,
      texture: textureEnabled.value,
      pbr: pbrEnabled.value,
      targetPolycount: targetPolycount.value,
      textureQuality: textureQuality.value,
      faceLimit: faceLimit.value,
      quadMesh: quadMesh.value,
      textureAlignment: textureAlignment.value,
      orientation: orientation.value,
      autoSize: autoSize.value,
      seed: seed.value,
      textureSeed: textureSeed.value,
      cropMode: cropMode.value,
    }
    if (controller.signal.aborted) {
      await cancelServerAiJob(created.id).catch(() => null)
      task.value = { ...task.value, status: 'cancelled' }
      statusText.value = '任务已取消'
      return
    }
    const finished = await waitForImageTo3dJob(created.id, {
      signal: controller.signal,
      onStatus: (text) => {
        statusText.value = text
      },
    })
    task.value = finished.job
    modelResult.value = finished.model
    statusText.value = '模型已生成'
  } catch (err) {
    if (err?.name === 'AbortError') return
    error.value = err?.message || '图转模型失败'
  } finally {
    if (modelTaskAbortController === controller) {
      modelTaskAbortController = null
      loading.value = false
    }
  }
}

async function cancelModelTask() {
  const currentTask = task.value
  modelTaskAbortController?.abort?.()
  modelTaskAbortController = null
  loading.value = false
  if (!currentTask?.id) {
    statusText.value = '任务已取消'
    return
  }
  try {
    const response = await cancelServerAiJob(currentTask.id)
    task.value = response.job || { ...currentTask, status: 'cancelled' }
    statusText.value = '任务已取消'
    error.value = ''
  } catch (err) {
    error.value = err?.message || '模型任务取消失败'
  }
}

async function deleteModelTask() {
  const currentTask = task.value
  if (!currentTask?.id || deletingTask.value) return
  deletingTask.value = true
  error.value = ''
  try {
    if (['queued', 'running', 'waiting_provider'].includes(String(currentTask.status || ''))) {
      await cancelServerAiJob(currentTask.id)
    }
    await deleteServerAiJob(currentTask.id)
    task.value = null
    modelResult.value = null
    statusText.value = ''
    resetModelPreview()
  } catch (err) {
    error.value = err?.message || '模型任务删除失败'
  } finally {
    deletingTask.value = false
  }
}

function downloadModel() {
  const url = modelDownloadUrl.value
  if (!url) return
  const link = document.createElement('a')
  link.href = url
  const ext = quadMesh.value ? 'fbx' : format.value || 'glb'
  link.download = `walleven-model-${task.value?.id || Date.now()}.${ext}`
  link.target = '_blank'
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function applyOptimalParams() {
  quality.value = OPTIMAL_MODEL_PARAMS.quality
  format.value = OPTIMAL_MODEL_PARAMS.format
  textureEnabled.value = OPTIMAL_MODEL_PARAMS.textureEnabled
  pbrEnabled.value = OPTIMAL_MODEL_PARAMS.pbrEnabled
  targetPolycount.value = OPTIMAL_MODEL_PARAMS.targetPolycount
  textureQuality.value = OPTIMAL_MODEL_PARAMS.textureQuality
  faceLimit.value = OPTIMAL_MODEL_PARAMS.faceLimit
  quadMesh.value = OPTIMAL_MODEL_PARAMS.quadMesh
  textureAlignment.value = OPTIMAL_MODEL_PARAMS.textureAlignment
  orientation.value = OPTIMAL_MODEL_PARAMS.orientation
  autoSize.value = OPTIMAL_MODEL_PARAMS.autoSize
  cropMode.value = OPTIMAL_MODEL_PARAMS.cropMode
  normalizeNumericParams()
}

function triggerImageImport() {
  importFileInput.value?.click()
}

async function applyImportedFile(file) {
  if (!file?.type?.startsWith('image/')) {
    error.value = '请选择图片文件'
    return
  }
  clearImportedImage()
  importedObjectUrl = URL.createObjectURL(file)
  importedImageUrl.value = importedObjectUrl
  importedImageName.value = file.name || '导入图片'
  importedImageSize.value = await readImportedImageSize(importedObjectUrl)
  task.value = null
  modelResult.value = null
  statusText.value = ''
  error.value = ''
}

async function handleImageImport(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  await applyImportedFile(file)
  if (event?.target) event.target.value = ''
}

function handleDragOver(event) {
  event.preventDefault()
  dragOver.value = true
}

function handleDragLeave() {
  dragOver.value = false
}

async function handleDrop(event) {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await applyImportedFile(file)
}

function clearImportedImage() {
  if (importedObjectUrl) URL.revokeObjectURL(importedObjectUrl)
  importedObjectUrl = ''
  importedImageUrl.value = ''
  importedImageName.value = ''
  importedImageSize.value = { width: 0, height: 0 }
}

function readImportedImageSize(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = src
  })
}

function getModelOptionsForProvider(providerId) {
  const models = getRuntimeAiProviderModels(providerId, 'imageTo3d', runtimeModelCatalog.value)
  const allowed = allowedModelIds.value
  const filtered = allowed.length
    ? models.filter((item) => allowed.includes(item.id) || allowed.includes(`${providerId}:${item.id}`))
    : models
  return filtered.length
    ? filtered
    : allowed
        .filter((entry) => entry.startsWith(`${providerId}:`))
        .map((entry) => entry.slice(providerId.length + 1))
        .filter(Boolean)
        .map((id) => ({ id, label: id, capabilities: ['imageTo3d'] }))
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : []
}

function normalizePublicModels(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const id = String(item?.id || item?.publicModelKey || '').trim()
      if (!id) return null
      return {
        id,
        label: String(item?.label || id),
        description: String(item?.description || ''),
        capabilities: normalizeStringList(item?.capabilities),
        userPriceUsd: Number(item?.userPriceUsd || 0),
        creditCost: Number(item?.creditCost || 0),
      }
    })
    .filter(Boolean)
}

function formatUsd(value) {
  // 去掉无意义的尾零：$1.8000 → $1.8，$0.0500 → $0.05
  return `$${String(Number(value.toFixed(4)))}`
}

function formatPublicModelCost(model) {
  if (!model) return '按实际消耗计费'
  const credits = Number(model.creditCost || 0)
  const usd = Number(model.userPriceUsd || 0)
  if (credits > 0 && usd > 0) return `${credits} 积分 / ${formatUsd(usd)}`
  if (credits > 0) return `${credits} 积分`
  if (usd > 0) return formatUsd(usd)
  return '按实际消耗计费'
}

function normalizeRange(value, fallback) {
  const source = value && typeof value === 'object' ? value : {}
  const min = Number(source.min)
  const max = Number(source.max)
  const step = Number(source.step)
  return {
    min: Number.isFinite(min) ? min : fallback.min,
    max: Number.isFinite(max) ? max : fallback.max,
    step: Number.isFinite(step) && step > 0 ? step : fallback.step,
  }
}

function clampNumericText(value, range, allowEmpty = false) {
  if (allowEmpty && (value === '' || value === null || value === undefined)) return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return allowEmpty ? '' : String(range.min)
  return String(Math.max(range.min, Math.min(Math.round(parsed), range.max)))
}

function normalizeNumericParams() {
  faceLimit.value = clampNumericText(faceLimit.value, faceLimitRange.value)
  seed.value = clampNumericText(seed.value, seedRange.value, true)
  textureSeed.value = clampNumericText(textureSeed.value, textureSeedRange.value, true)
}

function resetModelPreview() {
  previewLoadToken += 1
  previewLoading.value = false
  if (!previewState) return
  previewState.stop?.()
  previewState.controls?.dispose()
  previewState.renderer?.dispose()
  if (previewState.renderer?.domElement?.parentNode === previewState.host) {
    previewState.host.removeChild(previewState.renderer.domElement)
  }
  window.removeEventListener('resize', previewState.resize)
  previewState = null
}

function frameModel(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxSize = Math.max(size.x, size.y, size.z) || 1
  const distance = maxSize * 2.35
  camera.position.set(center.x + distance, center.y + distance * 0.72, center.z + distance)
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

async function loadModelPreview(url) {
  resetModelPreview()
  const currentLoadToken = previewLoadToken
  previewError.value = ''
  if (!url || !previewHost.value) return
  previewLoading.value = true
  await nextTick()
  const host = previewHost.value
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1114)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  host.appendChild(renderer.domElement)

  const ambient = new THREE.HemisphereLight(0xffffff, 0x29313a, 2.2)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(4, 5, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9bdcff, 0.85)
  fill.position.set(-4, 2, -3)
  scene.add(fill)

  const grid = new THREE.GridHelper(8, 16, 0x3a4555, 0x1e2630)
  grid.position.y = 0
  scene.add(grid)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.4
  controls.maxDistance = 80

  const resize = () => {
    if (!previewState) return
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  let stopped = false
  let frameId = 0
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  const animate = () => {
    if (stopped) return
    controls.update()
    renderer.render(scene, camera)
    frameId = requestAnimationFrame(animate)
  }

  previewState = {
    host,
    renderer,
    controls,
    resize,
    stop: () => {
      stopped = true
      if (frameId) cancelAnimationFrame(frameId)
      resizeObserver?.disconnect?.()
    },
  }
  window.addEventListener('resize', resize)
  resizeObserver?.observe(host)
  resize()

  try {
    const loader = new GLTFLoader()
    loader.setCrossOrigin('anonymous')
    const gltf = await loader.loadAsync(url)
    if (currentLoadToken !== previewLoadToken || previewState?.renderer !== renderer) return
    const model = gltf.scene
    scene.add(model)
    frameModel(camera, controls, model)
    previewLoading.value = false
    animate()
  } catch (err) {
    if (currentLoadToken !== previewLoadToken) return
    previewLoading.value = false
    previewError.value = err?.message || '模型预览加载失败，可先下载文件查看'
  }
}

watch(
  modelPreviewUrl,
  (url) => {
    if (url) loadModelPreview(url)
    else resetModelPreview()
  },
  { flush: 'post' },
)

watch(
  () => props.show,
  (show) => {
    if (show && modelPreviewUrl.value) loadModelPreview(modelPreviewUrl.value)
    if (!show) resetModelPreview()
  },
)

watch(
  providerOptions,
  (options) => {
    const configuredProvider = String(featureConfig.value.defaultProvider || '').trim()
    const nextProvider =
      options.find((item) => item.id === configuredProvider)?.id ||
      options.find((item) => item.id === provider.value)?.id ||
      options[0]?.id ||
      FALLBACK_MODEL_PROVIDER
    if (provider.value !== nextProvider) provider.value = nextProvider
  },
  { immediate: true },
)

watch(
  [modelOptions, () => featureConfig.value.defaultModel],
  ([options, defaultModel]) => {
    const configuredModel = String(defaultModel || '').trim()
    const nextModel =
      options.find((item) => item.id === configuredModel)?.id ||
      options.find((item) => item.id === selectedModel.value)?.id ||
      options[0]?.id ||
      FALLBACK_MODEL_ID
    if (selectedModel.value !== nextModel) selectedModel.value = nextModel
  },
  { immediate: true },
)

watch(
  [publicModelOptions, () => featureConfig.value.defaultPublicModel],
  ([models, defaultModel]) => {
    if (!models.length) {
      selectedPublicModel.value = ''
      return
    }
    const preferred =
      models.find((model) => model.id === String(defaultModel || '').trim())?.id ||
      models.find((model) => model.id === selectedPublicModel.value)?.id ||
      models[0]?.id ||
      ''
    if (selectedPublicModel.value !== preferred) selectedPublicModel.value = preferred
  },
  { immediate: true },
)

watch(textureEnabled, (enabled) => {
  if (!enabled) textureQuality.value = 'no'
  else if (textureQuality.value === 'no') textureQuality.value = 'standard'
})

watch(targetPolycount, (value) => {
  if (value !== 'auto') faceLimit.value = value
})

watch(quadMesh, (enabled) => {
  if (enabled) format.value = 'fbx'
})

watch([faceLimitRange, seedRange, textureSeedRange], normalizeNumericParams)

onBeforeUnmount(() => {
  modelTaskAbortController?.abort?.()
  modelTaskAbortController = null
  resetModelPreview()
  clearImportedImage()
})
</script>

<template>
  <aside
    v-if="show"
    ref="panelRef"
    class="model-panel"
    :class="{ 'model-panel--embedded': embedded }"
    aria-label="图转模型面板"
  >
    <!-- 独立页 Studio 布局 -->
    <template v-if="embedded">
      <header class="model-studio-topbar" data-model-motion>
        <div class="model-studio-brand">
          <span class="model-studio-brand-badge">IMAGE TO 3D</span>
          <div>
            <strong>图转模型</strong>
            <small>上传图片，生成可预览、可下载的 3D 资产</small>
          </div>
        </div>
        <div class="model-studio-top-meta">
          <span class="model-studio-status" :class="{ running: loading }" aria-live="polite">
            <i class="status-dot"></i>
            {{
              loading
                ? statusText || '生成中...'
                : modelResult
                  ? '生成完成'
                  : error
                    ? '生成失败'
                    : statusText || '等待上传'
            }}
          </span>
        </div>
      </header>

      <div class="model-studio-workspace">
        <!-- 左：输入图 -->
        <section class="model-studio-col model-studio-input" data-model-motion>
          <div class="model-studio-col-head">
            <span>Input</span>
            <strong>输入图片</strong>
          </div>
          <div class="model-studio-col-body">
            <div
              class="model-upload-zone"
              :class="{ 'has-image': displayImageUrl, 'is-dragover': dragOver }"
              @click="!displayImageUrl && triggerImageImport()"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
            >
              <template v-if="displayImageUrl">
                <div class="model-upload-preview">
                  <img :src="displayImageUrl" alt="" />
                </div>
              </template>
              <template v-else>
                <div class="model-upload-icon">
                  <i class="bi bi-cloud-arrow-up"></i>
                </div>
                <p>拖拽图片到此处</p>
                <small>或点击选择 · JPG / PNG / WebP</small>
              </template>
            </div>
            <div v-if="displayImageUrl" class="model-source-meta">
              <strong>{{ sourceLabel }}</strong>
              <small>{{ resolutionLabel }}</small>
              <div class="model-source-actions">
                <button type="button" @click="triggerImageImport">
                  <i class="bi bi-upload"></i>
                  更换图片
                </button>
                <button v-if="importedImageUrl" type="button" @click="clearImportedImage">
                  <i class="bi bi-arrow-counterclockwise"></i>
                  清除
                </button>
              </div>
            </div>
          </div>
          <input
            ref="importFileInput"
            class="model-file-input"
            type="file"
            accept="image/*"
            @change="handleImageImport"
          />
        </section>

        <!-- 中：3D 视口 -->
        <main class="model-studio-viewport" data-model-motion>
          <div ref="previewHost" class="model-viewport-canvas"></div>

          <div v-if="!modelPreviewUrl && displayImageUrl" class="model-viewport-image">
            <img :src="displayImageUrl" alt="" />
          </div>

          <div
            v-if="!displayImageUrl && !modelPreviewUrl"
            class="model-viewport-empty"
            @click="triggerImageImport"
          >
            <i class="bi bi-box"></i>
            <span>上传图片后在此预览 3D 模型</span>
          </div>

          <div v-if="modelPreviewUrl" class="model-viewport-toolbar">
            <button v-if="modelDownloadUrl" type="button" @click="downloadModel">
              <i class="bi bi-download"></i>
              下载 {{ quadMesh ? 'FBX' : (format || 'GLB').toUpperCase() }}
            </button>
          </div>

          <div v-if="modelPreviewUrl && !previewLoading" class="model-viewport-hint">
            拖拽旋转 · 滚轮缩放
          </div>

          <div v-if="loading" class="model-viewport-overlay">
            <div class="model-viewport-spinner"></div>
            <strong>{{ statusText || '正在生成 3D 模型...' }}</strong>
            <small>云端处理中，通常需要 1–3 分钟</small>
          </div>

          <div v-else-if="previewLoading" class="model-viewport-overlay">
            <div class="model-viewport-spinner"></div>
            <strong>正在加载 3D 预览...</strong>
          </div>

          <div v-if="previewError" class="model-viewport-error">{{ previewError }}</div>
          <div v-else-if="error" class="model-viewport-error">{{ error }}</div>
        </main>

        <!-- 右：参数 -->
        <aside class="model-studio-col model-studio-settings" data-model-motion>
          <div class="model-studio-col-head">
            <span>Settings</span>
            <strong>生成参数</strong>
          </div>
          <div class="model-studio-col-body">
            <div v-if="!isRuntimeEnabled" class="model-disabled-banner">
              <i class="bi bi-lock"></i>
              <span>{{ disabledReason }}</span>
            </div>

            <p class="model-runtime-note">
              {{ currentPublicModel ? `${formatPublicModelCost(currentPublicModel)} · ` : '' }}
              上传上限 {{ maxUploadMb }}MB
            </p>

            <div class="model-settings-group">
              <span>质量</span>
              <div class="model-pill-row">
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: quality === 'fast' }"
                  @click="quality = 'fast'"
                >
                  快速
                </button>
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: quality === 'standard' }"
                  @click="quality = 'standard'"
                >
                  标准
                </button>
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: quality === 'high' }"
                  @click="quality = 'high'"
                >
                  高清
                </button>
              </div>
            </div>

            <div class="model-settings-group">
              <span>输出格式</span>
              <div class="model-pill-row">
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: format === 'glb' && !quadMesh }"
                  @click="quadMesh = false; format = 'glb'"
                >
                  GLB
                </button>
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: quadMesh || format === 'fbx' }"
                  @click="quadMesh = true"
                >
                  FBX
                </button>
                <button
                  type="button"
                  class="model-pill"
                  :class="{ active: format === 'obj' && !quadMesh }"
                  @click="quadMesh = false; format = 'obj'"
                >
                  OBJ
                </button>
              </div>
            </div>

            <div class="model-settings-group">
              <span>纹理</span>
              <div class="model-pill-row">
                <button
                  type="button"
                  class="model-toggle-chip"
                  :class="{ active: textureEnabled }"
                  @click="textureEnabled = !textureEnabled"
                >
                  生成贴图
                </button>
                <button
                  type="button"
                  class="model-toggle-chip"
                  :class="{ active: pbrEnabled }"
                  :disabled="!textureEnabled"
                  @click="pbrEnabled = !pbrEnabled"
                >
                  PBR
                </button>
              </div>
            </div>

            <label class="model-setting-row">
              <span>输入裁剪</span>
              <select v-model="cropMode">
                <option value="subject">主体</option>
                <option value="upper_body">上半身</option>
                <option value="head">头部</option>
                <option value="full">完整</option>
              </select>
            </label>

            <label class="model-setting-row">
              <span>面数</span>
              <select v-model="targetPolycount">
                <option value="auto">自动</option>
                <option value="10000">10k</option>
                <option value="30000">30k</option>
                <option value="50000">50k</option>
                <option value="100000">100k</option>
                <option value="150000">150k</option>
              </select>
            </label>

            <button type="button" class="model-advanced-toggle" @click="showAdvanced = !showAdvanced">
              <span>高级参数</span>
              <i class="bi" :class="showAdvanced ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            </button>

            <div v-if="showAdvanced" class="model-advanced-panel">
              <label v-if="publicModelOptions.length > 1" class="model-setting-row">
                <span>模型</span>
                <select v-model="selectedPublicModel">
                  <option v-for="model in publicModelOptions" :key="model.id" :value="model.id">
                    {{ model.label }}
                  </option>
                </select>
              </label>

              <label class="model-setting-row">
                <span>贴图质量</span>
                <select v-model="textureQuality" :disabled="!textureEnabled">
                  <option value="standard">标准</option>
                  <option value="HD">高清</option>
                  <option value="no">不生成</option>
                </select>
              </label>

              <label class="model-setting-row">
                <span>精细面数</span>
                <input
                  v-model="faceLimit"
                  type="number"
                  :min="faceLimitRange.min"
                  :max="faceLimitRange.max"
                  :step="faceLimitRange.step"
                  @blur="normalizeNumericParams"
                />
              </label>

              <label class="model-setting-row">
                <span>贴图对齐</span>
                <select v-model="textureAlignment" :disabled="!textureEnabled">
                  <option value="original_image">原图对齐</option>
                  <option value="geometry">几何优先</option>
                </select>
              </label>

              <label class="model-setting-row">
                <span>朝向</span>
                <select v-model="orientation">
                  <option value="default">默认</option>
                  <option value="align_image">按图片</option>
                </select>
              </label>

              <div class="model-pill-row" style="margin-bottom: 8px">
                <button
                  type="button"
                  class="model-toggle-chip"
                  :class="{ active: quadMesh }"
                  @click="quadMesh = !quadMesh"
                >
                  四边面
                </button>
                <button
                  type="button"
                  class="model-toggle-chip"
                  :class="{ active: autoSize }"
                  @click="autoSize = !autoSize"
                >
                  自动尺寸
                </button>
              </div>

              <label class="model-setting-row">
                <span>形体种子</span>
                <input
                  v-model="seed"
                  type="number"
                  :min="seedRange.min"
                  :max="seedRange.max"
                  :step="seedRange.step"
                  placeholder="随机"
                  @blur="normalizeNumericParams"
                />
              </label>

              <label class="model-setting-row">
                <span>贴图种子</span>
                <input
                  v-model="textureSeed"
                  type="number"
                  :min="textureSeedRange.min"
                  :max="textureSeedRange.max"
                  :step="textureSeedRange.step"
                  placeholder="随机"
                  @blur="normalizeNumericParams"
                />
              </label>

              <button type="button" class="model-pill" @click="applyOptimalParams">
                恢复推荐参数
              </button>
            </div>
          </div>

          <div class="model-settings-footer">
            <button
              type="button"
              class="model-generate-btn"
              :disabled="!canCreateTask || loading"
              @click="createModelTask"
            >
              <i class="bi" :class="loading ? 'bi-arrow-repeat spin' : 'bi-stars'"></i>
              {{ loading ? statusText || '生成中...' : '开始生成' }}
            </button>
            <button
              v-if="loading"
              type="button"
              class="model-task-action-btn"
              @click="cancelModelTask"
            >
              <i class="bi bi-x-circle"></i>
              取消任务
            </button>
            <button
              v-else-if="task"
              type="button"
              class="model-task-action-btn is-danger"
              :disabled="deletingTask"
              @click="deleteModelTask"
            >
              <i class="bi bi-trash"></i>
              {{ deletingTask ? '删除中...' : '删除任务记录' }}
            </button>
            <button
              v-if="modelDownloadUrl"
              type="button"
              class="model-download-btn"
              @click="downloadModel"
            >
              <i class="bi bi-download"></i>
              下载模型文件
            </button>
          </div>
        </aside>
      </div>
    </template>

    <!-- 浮层模式（预览页内嵌） -->
    <template v-else>
      <header class="model-panel-head">
        <div>
          <span>IMAGE TO 3D</span>
          <h5>模型</h5>
        </div>
        <button type="button" class="model-close-btn" title="关闭模型面板" @click="emit('close')">
          <i class="bi bi-x-lg"></i>
        </button>
      </header>

      <section class="model-source-card">
        <img v-if="displayImageUrl" :src="displayImageUrl" alt="" />
        <div v-else class="model-source-empty">
          <i class="bi bi-image"></i>
        </div>
        <div class="model-source-body">
          <span>输入图</span>
          <strong>{{ sourceLabel }}</strong>
          <small>{{ resolutionLabel }}</small>
          <div class="model-source-actions">
            <button type="button" @click="triggerImageImport">
              <i class="bi bi-upload"></i>
              <span>导入图片</span>
            </button>
          </div>
        </div>
        <input
          ref="importFileInput"
          class="model-file-input"
          type="file"
          accept="image/*"
          @change="handleImageImport"
        />
      </section>

      <section v-if="!isRuntimeEnabled" class="model-disabled-card">
        <i class="bi bi-lock"></i>
        <span>{{ disabledReason }}</span>
      </section>

      <section class="model-section">
        <div class="model-section-title">
          <span>参数</span>
          <button type="button" class="model-section-action" @click="applyOptimalParams">
            最优参数
          </button>
        </div>
        <label class="model-control-row">
          <span>质量</span>
          <select v-model="quality">
            <option value="fast">快速</option>
            <option value="standard">标准</option>
            <option value="high">高清</option>
          </select>
        </label>
        <label class="model-control-row">
          <span>格式</span>
          <select v-model="format" :disabled="quadMesh">
            <option value="glb">GLB</option>
            <option value="obj">OBJ</option>
            <option value="fbx">FBX</option>
          </select>
        </label>
      </section>

      <section v-if="task || statusText || error" class="model-task-card">
        <span>{{ modelResult ? '模型结果' : loading ? '生成中' : error ? '任务失败' : '任务' }}</span>
        <strong>{{ task?.id || statusText || error }}</strong>
        <small>{{ error || statusText || task?.status || '等待任务状态' }}</small>
        <div v-if="modelPreviewUrl" class="model-preview-card">
          <div ref="previewHost" class="model-preview-canvas"></div>
          <div v-if="previewLoading || previewError" class="model-preview-status">
            {{ previewError || '正在加载 3D 预览...' }}
          </div>
        </div>
        <button v-if="modelDownloadUrl" type="button" class="model-download-btn" @click="downloadModel">
          <i class="bi bi-download"></i>
          <span>下载模型</span>
        </button>
      </section>

      <button
        type="button"
        class="model-primary-btn"
        :disabled="!canCreateTask || loading"
        @click="createModelTask"
      >
        <i class="bi" :class="loading ? 'bi-arrow-repeat spin' : 'bi-box'"></i>
        <span>{{ loading ? statusText || '正在生成模型' : '生成模型' }}</span>
      </button>
      <button
        v-if="loading"
        type="button"
        class="model-task-action-btn"
        @click="cancelModelTask"
      >
        <i class="bi bi-x-circle"></i>
        <span>取消任务</span>
      </button>
      <button
        v-else-if="task"
        type="button"
        class="model-task-action-btn is-danger"
        :disabled="deletingTask"
        @click="deleteModelTask"
      >
        <i class="bi bi-trash"></i>
        <span>{{ deletingTask ? '删除中...' : '删除任务记录' }}</span>
      </button>
    </template>
  </aside>
</template>

<style scoped>
.model-panel {
  position: absolute;
  top: 80px;
  right: 20px;
  width: min(360px, calc(100vw - 40px));
  max-height: calc(100vh - 120px);
  overflow: auto;
  z-index: 24;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  background: rgba(11, 13, 14, 0.86);
  color: #fff;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(14px);
}

.model-panel--embedded {
  position: static;
  width: 100%;
  max-height: none;
  overflow: hidden;
  z-index: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.model-panel-head,
.model-source-card,
.model-control-row,
.model-toggle-row {
  display: flex;
  align-items: center;
}

.model-panel-head {
  justify-content: space-between;
  gap: 12px;
}

.model-panel-head span,
.model-source-card span,
.model-section-title span,
.model-task-card span {
  display: block;
  color: rgba(255, 255, 255, 0.54);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.model-panel-head h5 {
  margin: 2px 0 0;
  font-size: 1.05rem;
  font-weight: 820;
}

.model-close-btn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.model-source-card {
  gap: 12px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
}

.model-disabled-card {
  min-height: 42px;
  border: 1px solid rgba(255, 190, 118, 0.25);
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  color: rgba(255, 226, 190, 0.92);
  background: rgba(255, 190, 118, 0.09);
  font-size: 0.82rem;
  font-weight: 760;
}

.model-source-body {
  min-width: 0;
  flex: 1 1 auto;
}

.model-source-card img,
.model-source-empty {
  width: 74px;
  height: 56px;
  flex: 0 0 auto;
  border-radius: 10px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.08);
}

.model-source-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.58);
}

.model-source-card strong,
.model-task-card strong {
  display: block;
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 0.92rem;
  font-weight: 760;
}

.model-source-card small,
.model-task-card small {
  display: block;
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.78rem;
}

.model-source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.model-source-actions button {
  min-height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.075);
  font-size: 0.76rem;
  font-weight: 760;
  cursor: pointer;
}

.model-file-input {
  display: none;
}

.model-section {
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.045);
}

.model-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.model-section-action {
  min-height: 27px;
  border: 1px solid rgba(115, 227, 255, 0.28);
  border-radius: 9px;
  padding: 0 9px;
  color: #9eeeff;
  background: rgba(115, 227, 255, 0.09);
  font-size: 0.74rem;
  font-weight: 820;
  cursor: pointer;
}

.model-control-row,
.model-toggle-row {
  min-height: 38px;
  justify-content: space-between;
  gap: 12px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.86rem;
  font-weight: 680;
}

.model-control-row + .model-control-row,
.model-control-row + .model-toggle-row,
.model-toggle-row + .model-toggle-row {
  margin-top: 8px;
}

.model-control-row select {
  width: 132px;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 0 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
}

.model-control-row input {
  width: 132px;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 0 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
}

.model-control-row select:disabled,
.model-control-row input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.model-control-row input::placeholder {
  color: rgba(255, 255, 255, 0.42);
}

.model-managed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.76);
  font-size: 0.82rem;
}

.model-managed-row strong {
  min-width: 0;
  max-width: 180px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-param-note {
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.76rem;
  line-height: 1.55;
}

.model-runtime-note {
  margin: -2px 0 10px;
  color: rgba(115, 227, 255, 0.72);
  font-size: 0.76rem;
  line-height: 1.45;
}

.model-toggle-row input {
  width: 18px;
  height: 18px;
  accent-color: #73e3ff;
}

.model-flow-list {
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.82rem;
  line-height: 1.75;
}

.model-task-card {
  padding: 12px;
  border-radius: 14px;
  background: rgba(115, 227, 255, 0.1);
}

.model-preview-card {
  position: relative;
  height: 220px;
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 14px;
  background: #0d1114;
}

.model-preview-canvas,
.model-preview-canvas :deep(canvas) {
  width: 100%;
  height: 100%;
  display: block;
}

.model-preview-status {
  position: absolute;
  inset: auto 10px 10px;
  padding: 8px 10px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.84);
  background: rgba(0, 0, 0, 0.48);
  font-size: 0.78rem;
  line-height: 1.4;
}

.model-download-btn {
  width: 100%;
  min-height: 34px;
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.model-primary-btn {
  min-height: 42px;
  border: 0;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #071012;
  background: #73e3ff;
  font-weight: 820;
  cursor: pointer;
}

.model-primary-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.spin {
  animation: modelSpin 0.9s linear infinite;
}

@keyframes modelSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
