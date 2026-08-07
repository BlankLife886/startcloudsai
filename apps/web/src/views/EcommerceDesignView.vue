<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import CommerceSelect from '@/features/ecommerce/CommerceSelect.vue'
import {
  buildEcommerceGenerationPlan,
  buildEcommerceRevisionPrompt,
  ecommerceConsistencyProfile,
  ECOMMERCE_MODULES,
  ECOMMERCE_MODES,
  ECOMMERCE_RAIL_GROUPS,
  ECOMMERCE_REVISION_DIRECTIONS,
  ecommerceShotBlueprints,
  ecommerceModeById,
  filterEcommerceOutputsByMode,
  prepareEcommerceInputFiles,
  supportedEcommerceModules,
} from '@/features/ecommerce/ecommerceTools'
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from '@/features/creator-hub/studioTools'
import { normalizeImageModelCapabilities } from '@/features/ai-shared/modelImageCapabilities'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import { listUserAssetGroups, listUserAssets } from '@/services/meApi'
import notificationService from '@/services/notification'
import { useAppearanceStore } from '@/stores/appearance'

const LocalMaskEditorDialog = defineAsyncComponent(
  () => import('@/features/ai-wallpaper/components/LocalMaskEditorDialog.vue'),
)

const route = useRoute()
const router = useRouter()
const appearanceStore = useAppearanceStore()

const platformOptions = ['Amazon', '淘宝 / 天猫', '京东', 'TikTok Shop', 'Shopify', '独立站']
const marketOptions = ['美国', '中国大陆', '英国', '日本', '德国', '法国']
const languageOptions = ['英文', '简体中文', '日文', '德文', '法文', '西班牙文']
const ratioOptions = [
  { value: '1:1', label: '1:1 方图' },
  { value: '4:5', label: '4:5 竖图' },
  { value: '3:4', label: '3:4 详情' },
  { value: '16:9', label: '16:9 横图' },
  { value: '9:16', label: '9:16 竖屏' },
]
const sceneOptions = ['纯色影棚', '家居生活', '自然户外', '都市街景', '科技空间', '节日氛围']
const toneOptions = ['极简高级', '清新明亮', '真实自然', '轻奢质感', '潮流活力', '科技未来']
const campaignOptions = ['新品首发', '日常种草', '限时促销', '节日活动', '品牌宣传']
const apparelOptions = ['上装', '下装', '连衣裙', '连体服', '套装', '外套']
const modelOptions = ['东亚女性', '东亚男性', '欧美女性', '欧美男性', '南亚女性', '不限定人群']
const poseOptions = ['正面站姿', '侧身展示', '半身特写', '生活方式', '坐姿展示']
const accessoryOptions = ['包袋', '耳饰', '项链', '戒指', '腕表', '眼镜', '帽子']
const shadowOptions = ['自然接触影', '柔和投影', '悬浮阴影', '长投影', '镜面倒影']
const {
  creditsPrompt,
  modelId,
  models,
  selectedModel,
  status,
  error: generationError,
  running,
  outputs,
  activeOutput,
  outputPreviewUrls,
  outputGroups,
  outputGroupIndexes,
  outputAspectRatios,
  outputTimings,
  outputParents,
  outputKinds,
  historyLoading,
  historyHasMore,
  historyHasMoreVariants,
  initialize,
  generateBatch,
  generateMaskedEdit,
  cancel,
  loadHistory,
  loadMoreHistory,
  deleteOutput,
  formatCostEstimate,
} = useCreativeImageJob({
  source: 'ecommerce-design',
  featureKey: 'ai.ecommerceDesign',
  jobKindPrefix: 'ui-design-ecommerce',
  preferOriginalOutputs: true,
  outputLongSide: 2048,
  initialHistoryLimit: 12,
  filterHistoryByKind: true,
  kindVariants: ECOMMERCE_MODES.map((mode) => mode.id),
})

const fileInput = ref(null)
const commerceRoot = ref(null)
const canvasPanel = ref(null)
const inputFiles = ref([])
const previews = ref([])
const platform = ref('Amazon')
const market = ref('美国')
const language = ref('英文')
const productName = ref('')
const sellingPoints = ref('')
const selectedModules = ref(
  ECOMMERCE_MODULES.filter((item) => item.value !== 'angles').map((item) => item.value),
)
const aspectRatio = ref('3:4')
const outputCount = ref(1)
const sceneStyle = ref(sceneOptions[0])
const visualTone = ref(toneOptions[0])
const campaignGoal = ref(campaignOptions[0])
const apparelType = ref(apparelOptions[0])
const modelProfile = ref(modelOptions[0])
const modelPose = ref(poseOptions[0])
const accessoryType = ref(accessoryOptions[0])
const shadowStyle = ref(shadowOptions[0])
const localError = ref('')
const dragging = ref(false)
const activeMobilePane = ref('settings')
const revisionDirection = ref('precise')
const revisionBrief = ref('')
const revisionError = ref('')
const workspaceView = ref('result')
const historyScope = ref('current')
const assets = ref([])
const assetGroups = ref([])
const assetFilter = ref('all')
const assetsLoading = ref(false)
const assetsLoadingMore = ref(false)
const assetsLoaded = ref(false)
const assetsCursor = ref(null)
const assetsError = ref('')
const assetTotalCount = ref(0)
const referenceImporting = ref('')
const previewOpen = ref(false)
const previewSource = ref('')
const maskEditorOpen = ref(false)
const maskEditorSource = ref('')
const loadedOutputs = ref(new Set())
const textStabilityEnabled = ref(true)
let motionContext = null

const outputCountOptions = computed(() =>
  Array.from({ length: maxOutputCount.value }, (_, index) => ({
    value: index + 1,
    label: `${index + 1} 张`,
  })),
)
const modelSelectOptions = computed(() =>
  models.value.map((model) => ({ value: model.id, label: model.label })),
)
const currentGroupOutputs = computed(() => {
  const current = currentOutput.value
  if (!current) return []
  const groupId = outputGroups.value[current]
  const group = groupId
    ? modeOutputs.value.filter((url) => outputGroups.value[url] === groupId)
    : [current]
  return [...new Set(group)].sort(
    (left, right) =>
      (Number(outputGroupIndexes.value[left]) || 0) -
      (Number(outputGroupIndexes.value[right]) || 0),
  )
})
const resultLayoutClass = computed(() => {
  const count = currentGroupOutputs.value.length
  if (count <= 1) return 'is-single'
  if (count === 2) return 'is-double'
  if (count <= 4) return 'is-quad'
  return 'is-multi'
})
const generationLayoutClass = computed(() => {
  const count = actualOutputCount.value
  if (count <= 1) return 'is-single'
  if (count === 2) return 'is-double'
  if (count <= 4) return 'is-quad'
  return 'is-multi'
})
const previewGallery = computed(() =>
  currentGroupOutputs.value.length ? currentGroupOutputs.value : modeOutputs.value,
)
const generationAspectStyle = computed(() => {
  const [width, height] = String(aspectRatio.value)
    .split(':')
    .map((value) => Math.max(1, Number(value) || 1))
  return { aspectRatio: `${width} / ${height}` }
})

const consistencyProfile = computed(() =>
  ecommerceConsistencyProfile(activeMode.value.id, inputFiles.value.length),
)
const modelReferenceLimit = computed(
  () => normalizeImageModelCapabilities(selectedModel.value || {}).maxReferenceImages,
)
const consistencyCapacityError = computed(() => {
  const required = consistencyProfile.value.essentialReferenceCount
  if (!required || modelReferenceLimit.value >= required) return ''
  return `当前模型最多支持 ${modelReferenceLimit.value} 张参考图，但此工具需要同时锁定 ${required} 个身份参考，请切换支持更多参考图的模型`
})

const activeMode = computed(() => ecommerceModeById(String(route.query.tool || 'detail')))
const activeRailGroup = computed(
  () =>
    ECOMMERCE_RAIL_GROUPS.find((group) => group.modes.includes(activeMode.value.id)) ||
    ECOMMERCE_RAIL_GROUPS[0],
)
const activeRailModes = computed(() =>
  activeRailGroup.value.modes.map((modeId) => ecommerceModeById(modeId)),
)
const activeModeFields = computed(() => new Set(activeMode.value.fields || []))
const selectedModuleDetails = computed(() =>
  supportedEcommerceModules(selectedModules.value, inputFiles.value.length),
)
const requiresBrief = computed(() =>
  ['listing', 'detail', 'campaign'].includes(activeMode.value.id),
)
const minimumFiles = computed(() => Number(activeMode.value.minFiles || 1))
const subjectNameLabel = computed(() => {
  if (activeMode.value.id === 'tryon') return '服装名称'
  if (activeMode.value.id === 'accessory') return '饰品名称'
  return '商品名称'
})
const subjectNamePlaceholder = computed(() => {
  if (activeMode.value.id === 'tryon') return '例如：亚麻翻领连衣裙'
  if (activeMode.value.id === 'accessory') return '例如：复古金色耳环'
  return '例如：无线降噪蓝牙耳机'
})
const modeOutputs = computed(() => {
  return filterEcommerceOutputsByMode(outputs.value, outputKinds.value, activeMode.value.id)
})
const allEcommerceOutputs = computed(() =>
  outputs.value
    .filter((url) => String(outputKinds.value[url] || '').startsWith('ui-design-ecommerce-'))
    .sort((left, right) => outputTimestamp(right) - outputTimestamp(left)),
)
const visibleHistoryOutputs = computed(() =>
  historyScope.value === 'current' ? modeOutputs.value : allEcommerceOutputs.value,
)
const canLoadMoreHistory = computed(() =>
  historyScope.value === 'current'
    ? Boolean(historyHasMoreVariants.value[activeMode.value.id])
    : historyHasMore.value,
)
const currentOutput = computed(() =>
  modeOutputs.value.includes(activeOutput.value) ? activeOutput.value : modeOutputs.value[0] || '',
)
const currentOutputIndex = computed(() =>
  Math.max(0, Number(outputGroupIndexes.value[currentOutput.value]) || 0),
)
const currentShotLabel = computed(
  () =>
    availableShotBlueprints.value[currentOutputIndex.value]?.label ||
    activeMode.value.shortLabel ||
    activeMode.value.label,
)
const currentVersionNumber = computed(() => outputVersion(currentOutput.value))
const revisionCostLabel = computed(() => formatCostEstimate(1))
const canRevise = computed(
  () =>
    Boolean(currentOutput.value) &&
    revisionBrief.value.trim().length >= 4 &&
    Boolean(modelId.value) &&
    !consistencyCapacityError.value &&
    !running.value,
)
const canGenerate = computed(
  () =>
    inputFiles.value.length >= minimumFiles.value &&
    (!requiresBrief.value || sellingPoints.value.trim().length >= 4) &&
    (!activeModeFields.value.has('modules') || selectedModuleDetails.value.length > 0) &&
    Boolean(modelId.value) &&
    !consistencyCapacityError.value &&
    !running.value,
)
const availableShotBlueprints = computed(() =>
  ecommerceShotBlueprints(activeMode.value.id, selectedModules.value),
)
const maxOutputCount = computed(() =>
  Math.max(1, Math.min(activeMode.value.maxCount || 1, availableShotBlueprints.value.length || 1)),
)
const actualOutputCount = computed(() => Math.min(outputCount.value, maxOutputCount.value))
const costLabel = computed(() => formatCostEstimate(actualOutputCount.value))
const readiness = computed(() => {
  if (!models.value.length) return { ready: false, label: '后台暂未分配可用模型' }
  if (consistencyCapacityError.value) {
    return { ready: false, label: consistencyCapacityError.value }
  }
  if (inputFiles.value.length < minimumFiles.value) {
    const remaining = minimumFiles.value - inputFiles.value.length
    return { ready: false, label: `还需 ${remaining} 张参考图` }
  }
  if (requiresBrief.value && sellingPoints.value.trim().length < 4) {
    return { ready: false, label: '请补充核心卖点' }
  }
  if (activeModeFields.value.has('modules') && !selectedModuleDetails.value.length) {
    return { ready: false, label: '请选择视觉模块' }
  }
  return { ready: true, label: '配置完成，可以生成' }
})

watch(
  activeMode,
  (mode) => {
    const requestedMode = String(route.query.tool || '')
    if (requestedMode && requestedMode !== mode.id) {
      router.replace({ path: '/ecommerce-design', query: { tool: mode.id } })
    }
    aspectRatio.value = mode.ratio
    outputCount.value = Math.min(outputCount.value, mode.maxCount)
    if (mode.maxCount > 1 && outputCount.value < 1) outputCount.value = 1
    localError.value = ''
  },
  { immediate: true },
)

watch(maxOutputCount, (maximum) => {
  if (outputCount.value > maximum) outputCount.value = maximum
})

watch(currentOutput, () => {
  revisionBrief.value = ''
  revisionError.value = ''
})

function outputVersion(url) {
  let version = 1
  let cursor = String(url || '').trim()
  const visited = new Set()
  while (cursor && outputParents.value[cursor] && !visited.has(cursor) && version < 20) {
    visited.add(cursor)
    cursor = String(outputParents.value[cursor] || '').trim()
    version += 1
  }
  return version
}

function setActiveMode(mode) {
  if (!mode || mode.id === activeMode.value.id) return
  if (running.value) {
    notificationService.info('任务生成中，请停止后再切换工具')
    return
  }
  router.replace({ path: '/ecommerce-design', query: { tool: mode.id } })
  activeMobilePane.value = 'settings'
  workspaceView.value = 'result'
}

function outputTimestamp(url) {
  const timing = outputTimings.value[url] || {}
  return Date.parse(timing.finishedAt || timing.startedAt || timing.createdAt || '') || 0
}

function formatOutputTime(url) {
  const timestamp = outputTimestamp(url)
  if (!timestamp) return '生成时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

function outputModeId(url) {
  const kind = String(outputKinds.value[url] || '')
  const match = kind.match(/^ui-design-ecommerce-([a-z0-9]+)-/i)
  return match?.[1] || activeMode.value.id
}

function outputMode(url) {
  return ecommerceModeById(outputModeId(url))
}

async function openWorkspaceView(view) {
  workspaceView.value = view
  activeMobilePane.value = 'canvas'
  if (view === 'assets' && !assetsLoaded.value) await loadAssetsWorkspace()
}

async function openHistoryOutput(url) {
  const modeId = outputModeId(url)
  activeOutput.value = url
  workspaceView.value = 'result'
  activeMobilePane.value = 'canvas'
  if (modeId !== activeMode.value.id) {
    await router.replace({ path: '/ecommerce-design', query: { tool: modeId } })
  }
}

function safeReferenceName(value, fallback) {
  const normalized = String(value || fallback)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return normalized || fallback
}

async function useRemoteImageAsReference({ id, url, title, origin }) {
  if (running.value || referenceImporting.value) return
  if (inputFiles.value.length >= 6) {
    notificationService.info('参考图已达 6 张上限，请先移除一张')
    return
  }
  const source = String(url || '').trim()
  if (!source) {
    notificationService.error('这张图片暂时无法读取')
    return
  }
  referenceImporting.value = String(id || source)
  try {
    const blob = await fetchAuthenticatedMediaBlob(source, { cache: 'no-store' })
    const extension = blob.type.includes('png')
      ? 'png'
      : blob.type.includes('webp')
        ? 'webp'
        : 'jpg'
    const filename = `${safeReferenceName(title, origin === 'history' ? '电商历史' : '个人素材')}-${Date.now()}.${extension}`
    const file = new File([blob], filename, { type: blob.type, lastModified: Date.now() })
    // 保留站内原始地址。提交时可直接复用已有对象 key，避免下载后再上传
    // 导致额外压缩、R2 写入失败以及参考图在进入模型前失真。
    Object.defineProperty(file, 'sourceUrl', {
      value: source,
      configurable: true,
    })
    const before = inputFiles.value.length
    addFiles([file])
    if (inputFiles.value.length > before) {
      workspaceView.value = 'result'
      activeMobilePane.value = 'settings'
      notificationService.success('已加入当前任务参考图')
    }
  } catch (error) {
    notificationService.error(error?.message || '参考图读取失败')
  } finally {
    referenceImporting.value = ''
  }
}

function useHistoryAsReference(url) {
  return useRemoteImageAsReference({
    id: `history:${url}`,
    url,
    title: `${outputMode(url).shortLabel || outputMode(url).label}-V${outputVersion(url)}`,
    origin: 'history',
  })
}

function useAssetAsReference(asset) {
  return useRemoteImageAsReference({
    id: `asset:${asset.id}`,
    url: asset.url,
    title: asset.title,
    origin: 'asset',
  })
}

async function loadAssetsWorkspace({ append = false } = {}) {
  if (append) {
    if (assetsLoadingMore.value || !assetsCursor.value) return
    assetsLoadingMore.value = true
  } else {
    if (assetsLoading.value) return
    assetsLoading.value = true
    assetsError.value = ''
  }
  try {
    const requests = [
      listUserAssets({
        limit: 24,
        cursor: append ? assetsCursor.value || '' : '',
        groupId: assetFilter.value,
      }),
    ]
    if (!append && !assetGroups.value.length) {
      requests.push(listUserAssetGroups().catch(() => null))
    }
    const [assetResult, groupResult] = await Promise.all(requests)
    assets.value = append ? [...assets.value, ...assetResult.items] : assetResult.items
    assetsCursor.value = assetResult.nextCursor
    if (groupResult) {
      assetGroups.value = groupResult.items
      assetTotalCount.value = groupResult.totalAssetCount
    }
    assetsLoaded.value = true
  } catch (error) {
    assetsError.value = error?.message || '素材库读取失败'
  } finally {
    assetsLoading.value = false
    assetsLoadingMore.value = false
  }
}

function selectAssetFilter(filter) {
  if (assetFilter.value === filter || assetsLoading.value || assetsLoadingMore.value) return
  assetFilter.value = filter
  assets.value = []
  assetsCursor.value = null
  assetsLoaded.value = false
  loadAssetsWorkspace()
}

async function refreshAssets() {
  if (assetsLoading.value || assetsLoadingMore.value) return
  assetGroups.value = []
  assetsCursor.value = null
  assetsLoaded.value = false
  await loadAssetsWorkspace()
}

function loadMoreEcommerceHistory() {
  return loadMoreHistory(12, {
    kindVariant: historyScope.value === 'current' ? activeMode.value.id : '',
  })
}

function releasePreviews() {
  previews.value.forEach((item) => URL.revokeObjectURL(item.url))
}

function addFiles(fileList) {
  if (running.value) return
  localError.value = ''
  const prepared = prepareEcommerceInputFiles(inputFiles.value, fileList)
  if (prepared.invalidCount && !prepared.next.length) {
    localError.value = '仅支持 PNG、JPG 和 WebP 图片'
    return
  }
  if (prepared.oversized) {
    localError.value = '单张商品图不能超过 10MB'
    return
  }
  const next = prepared.next
  inputFiles.value = [...inputFiles.value, ...next]
  previews.value = [
    ...previews.value,
    ...next.map((file) => ({ file, url: URL.createObjectURL(file) })),
  ]
  if (prepared.invalidCount) notificationService.info('已忽略不支持的文件')
  if (prepared.duplicateCount) notificationService.info('已忽略重复图片')
  if (prepared.overflowCount) notificationService.info('同一任务最多上传 6 张图片')
}

function onFileChange(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function onDrop(event) {
  dragging.value = false
  addFiles(event.dataTransfer?.files)
}

function removeFile(index) {
  if (running.value) return
  const preview = previews.value[index]
  if (preview?.url) URL.revokeObjectURL(preview.url)
  inputFiles.value = inputFiles.value.filter((_, at) => at !== index)
  previews.value = previews.value.filter((_, at) => at !== index)
}

function referenceLabel(index) {
  return activeMode.value.referenceLabels?.[index] || `角度 ${index + 1}`
}

function resetTask() {
  if (running.value) {
    notificationService.info('请先停止当前生成任务')
    return
  }
  releasePreviews()
  inputFiles.value = []
  previews.value = []
  productName.value = ''
  sellingPoints.value = ''
  selectedModules.value = ECOMMERCE_MODULES.filter((item) => item.value !== 'angles').map(
    (item) => item.value,
  )
  sceneStyle.value = sceneOptions[0]
  visualTone.value = toneOptions[0]
  campaignGoal.value = campaignOptions[0]
  apparelType.value = apparelOptions[0]
  modelProfile.value = modelOptions[0]
  modelPose.value = poseOptions[0]
  accessoryType.value = accessoryOptions[0]
  shadowStyle.value = shadowOptions[0]
  aspectRatio.value = activeMode.value.ratio
  outputCount.value = 1
  localError.value = ''
  revisionDirection.value = 'precise'
  revisionBrief.value = ''
  revisionError.value = ''
  workspaceView.value = 'result'
  if (fileInput.value) fileInput.value.value = ''
}

const assembledPrompt = computed(() => {
  const modules = selectedModuleDetails.value.map((item) => item.label).join('、')
  const lines = [
    `任务：${activeMode.value.label}。${activeMode.value.prompt}`,
    `商品名称：${productName.value.trim() || '根据商品图片准确识别，不虚构品牌和型号'}。`,
    sellingPoints.value.trim() ? `商品卖点与要求：${sellingPoints.value.trim()}。` : '',
    activeModeFields.value.has('platform') ? `适配平台：${platform.value}。` : '',
    activeModeFields.value.has('market') ? `目标市场：${market.value}。` : '',
    activeModeFields.value.has('language')
      ? `页面文案语言：${language.value}。文案必须简短、准确、自然，符合平台规范。`
      : '',
    activeModeFields.value.has('scene') ? `场景方向：${sceneStyle.value}。` : '',
    activeModeFields.value.has('campaign') ? `营销目标：${campaignGoal.value}。` : '',
    activeModeFields.value.has('apparel') ? `服装类型：${apparelType.value}。` : '',
    activeModeFields.value.has('model') ? `模特人群：${modelProfile.value}。` : '',
    activeModeFields.value.has('pose') ? `模特姿态：${modelPose.value}。` : '',
    activeModeFields.value.has('accessory') ? `饰品类型：${accessoryType.value}。` : '',
    activeModeFields.value.has('shadow') ? `阴影类型：${shadowStyle.value}。` : '',
    activeModeFields.value.has('tone') ? `视觉风格：${visualTone.value}。` : '',
    activeModeFields.value.has('modules') ? `需要包含的视觉模块：${modules}。` : '',
    textStabilityEnabled.value
      ? `文字稳定性协议：仅使用用户明确提供的商品名称与卖点文案；所有文字必须逐字准确、方向正确、边缘清晰、字形统一。无法可靠生成的长文案改为留白，不得输出乱码、伪文字、随机字母或虚构品牌。`
      : '',
    '严格保持参考商品的造型、颜色、比例、Logo、包装文字和材质细节一致，不得改变商品本体，不得混入其他品牌商品。',
    '输出必须是完整可交付的商业成品，不展示编辑器界面、设备样机、制作过程、水印或无关品牌。需要文字时必须清晰可读，不要乱码和伪文字。',
  ]
  return lines.filter(Boolean).join('\n')
})

const generationPlan = computed(() =>
  buildEcommerceGenerationPlan({
    modeId: activeMode.value.id,
    count: actualOutputCount.value,
    selectedModules: selectedModuleDetails.value.map((item) => item.value),
    basePrompt: assembledPrompt.value,
    referenceCount: inputFiles.value.length,
  }),
)
const revisionBusinessPrompt = computed(() =>
  inputFiles.value.length || productName.value.trim() || sellingPoints.value.trim()
    ? assembledPrompt.value
    : '',
)

async function generate() {
  localError.value = ''
  if (consistencyCapacityError.value) {
    localError.value = consistencyCapacityError.value
    return
  }
  if (inputFiles.value.length < minimumFiles.value) {
    localError.value =
      minimumFiles.value > 1
        ? `当前工具至少需要 ${minimumFiles.value} 张参考图`
        : '请先上传商品图片'
    return
  }
  if (requiresBrief.value && sellingPoints.value.trim().length < 4) {
    localError.value = '请填写商品卖点与要求'
    return
  }
  if (activeModeFields.value.has('modules') && !selectedModules.value.length) {
    localError.value = '请至少选择一个视觉模块'
    return
  }
  activeMobilePane.value = 'canvas'
  workspaceView.value = 'result'
  const generationItems = generationPlan.value.map((item) => ({
    ...item,
    aspectRatio: aspectRatio.value,
    platform: `${platform.value} · ${market.value} · ${language.value}`,
    quality: 'high',
    inputFidelity: 'high',
    consistencyStrategy: 'identity-first-sequential-anchor',
    consistencyProfile: consistencyProfile.value.id,
    referenceRoles: consistencyProfile.value.roles,
    essentialReferenceCount: consistencyProfile.value.essentialReferenceCount,
    preserveSourceCanvas: activeMode.value.id === 'outpaint',
  }))
  const result = await generateBatch(generationItems, {
    files: inputFiles.value,
    concurrency: 1,
    chainReferenceOutput: generationItems.length > 1,
    essentialReferenceCount: consistencyProfile.value.essentialReferenceCount,
    referencePolicy: {
      strategy: 'identity-first',
      essentialIdentityCount: consistencyProfile.value.essentialReferenceCount,
    },
  })
  if (result?.outputs?.length) {
    notificationService.success(`${activeMode.value.label}已生成`)
    return
  }
  if (result?.failures?.length) {
    localError.value = result.failures[0]?.message || '生成失败，请重试'
  }
}

async function reviseCurrentOutput() {
  revisionError.value = ''
  const parentOutput = currentOutput.value
  const brief = revisionBrief.value.trim()
  if (!parentOutput) {
    revisionError.value = '请先选择一张需要调整的成品'
    return
  }
  if (brief.length < 4) {
    revisionError.value = '请具体描述本轮只需要修改的内容'
    return
  }
  const nextVersion = currentVersionNumber.value + 1
  const prompt = buildEcommerceRevisionPrompt({
    basePrompt: revisionBusinessPrompt.value,
    brief,
    direction: revisionDirection.value,
    versionNumber: nextVersion,
  })
  const result = await generateBatch(
    [
      {
        prompt,
        aspectRatio: outputAspectRatios.value[parentOutput] || aspectRatio.value,
        platform: `${platform.value} · ${market.value} · ${language.value}`,
        quality: 'high',
        inputFidelity: 'high',
        count: 1,
        kindVariant: activeMode.value.id,
        viewId: `${activeMode.value.id}-revision-v${nextVersion}`,
        viewLabel: `${currentShotLabel.value} · V${nextVersion}`,
        iterationMode: true,
        parentOutputUrl: parentOutput,
        consistencyStrategy: 'revision-anchor-with-original-identity',
        consistencyProfile: consistencyProfile.value.id,
        referenceRoles: ['当前成品', ...consistencyProfile.value.roles],
        essentialReferenceCount: consistencyProfile.value.essentialReferenceCount,
        batchIndex: currentOutputIndex.value,
        batchSize: Math.max(actualOutputCount.value, currentOutputIndex.value + 1),
      },
    ],
    {
      files: inputFiles.value,
      sourceUrl: parentOutput,
      prioritizeSourceUrls: true,
      concurrency: 1,
      preserveBatchMeta: true,
      referencePolicy: {
        strategy: 'anchor-first',
        essentialIdentityCount: consistencyProfile.value.essentialReferenceCount,
      },
    },
  )
  if (result?.outputs?.length) {
    revisionBrief.value = ''
    notificationService.success(`V${nextVersion} 调整完成，已保留上一版本`)
    return
  }
  if (result?.failures?.length) {
    revisionError.value = result.failures[0]?.message || '本轮调整失败，请重试'
  }
}

async function downloadOutput(url) {
  if (!url) return
  try {
    const blob = await fetchAuthenticatedMediaBlob(url, { cache: 'no-store' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    const extension = blob.type.includes('png')
      ? 'png'
      : blob.type.includes('webp')
        ? 'webp'
        : 'jpg'
    anchor.download = `ecommerce-${activeMode.value.id}-${Date.now()}.${extension}`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (error) {
    notificationService.error(error?.message || '下载失败')
  }
}

async function removeOutput(url) {
  try {
    await deleteOutput(url)
    notificationService.success('生成记录已删除')
  } catch (error) {
    notificationService.error(error?.message || '删除失败')
  }
}

function markOutputLoaded(url) {
  loadedOutputs.value = new Set([...loadedOutputs.value, url])
}

function openOutputPreview(url = currentOutput.value) {
  const source = String(url || '').trim()
  if (!source) return
  activeOutput.value = source
  previewSource.value = source
  previewOpen.value = true
}

function selectPreviewOutput(url) {
  const source = String(url || '').trim()
  if (!source) return
  previewSource.value = source
  activeOutput.value = source
}

function previewResultOnHover(url) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  activeOutput.value = url
}

function openLocalEditor(url = currentOutput.value) {
  const source = String(url || '').trim()
  if (!source || running.value) return
  activeOutput.value = source
  maskEditorSource.value = source
  maskEditorOpen.value = true
}

async function submitMaskEdit(payload) {
  if (running.value || !maskEditorSource.value) return
  maskEditorOpen.value = false
  const source = maskEditorSource.value
  const prompt = [
    assembledPrompt.value,
    `局部编辑要求：${String(payload?.prompt || '').trim()}。只修改蒙版区域，其他商品细节、文字、构图、光影与尺寸保持不变。`,
  ]
    .filter(Boolean)
    .join('\n')
  const generated = await generateMaskedEdit({
    sourceUrl: source,
    maskFile: payload?.maskFile,
    prompt,
    aspectRatio: outputAspectRatios.value[source] || aspectRatio.value,
    quality: 'high',
    viewLabel: `${currentShotLabel.value} · 局部修正`,
    kindVariant: activeMode.value.id,
  })
  if (generated?.length) {
    activeOutput.value = generated[0]
    notificationService.success('局部编辑完成，原图和新版本均已保留')
  }
}

function runScopedMotion(callback) {
  if (!motionContext || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  motionContext.add(callback)
}

function animateCanvasView() {
  nextTick(() => {
    const target = canvasPanel.value?.firstElementChild
    if (!target) return
    runScopedMotion(() =>
      gsap.fromTo(
        target,
        { autoAlpha: 0, y: 14, scale: 0.992 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.52, ease: 'power3.out', clearProps: 'transform,opacity,visibility' },
      ),
    )
  })
}

async function initializeWorkspace() {
  const pending = takePendingPrompt('ecommerce_design')
  const launchConfig = pending?.config || {}
  if (launchConfig.skill && ecommerceModeById(launchConfig.skill).id !== activeMode.value.id) {
    await router.replace({ path: '/ecommerce-design', query: { tool: launchConfig.skill } })
  }
  await initialize()
  const launchPrompt = composePendingLaunchPrompt(pending, 1200)
  if (launchPrompt) sellingPoints.value = launchPrompt
  if (ratioOptions.some((item) => item.value === launchConfig.ratio)) {
    aspectRatio.value = launchConfig.ratio
  }
  const requestedCount = Number(launchConfig.count)
  if (Number.isFinite(requestedCount) && requestedCount > 0) {
    outputCount.value = Math.min(activeMode.value.maxCount, Math.max(1, requestedCount))
  }
  if (launchConfig.model && models.value.some((model) => model.id === launchConfig.model)) {
    modelId.value = launchConfig.model
  }
}

watch(workspaceView, animateCanvasView)
watch(activeMode, animateCanvasView)
watch(
  () => previews.value.length,
  (nextLength, previousLength) => {
    if (nextLength <= previousLength) return
    nextTick(() => {
      const cards = commerceRoot.value?.querySelectorAll('.upload-grid figure')
      const added = Array.from(cards || []).slice(-(nextLength - previousLength))
      if (!added.length) return
      runScopedMotion(() =>
        gsap.fromTo(
          added,
          { autoAlpha: 0, y: 10, scale: 0.9 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.48,
            stagger: 0.06,
            ease: 'back.out(1.45)',
            clearProps: 'transform,opacity,visibility',
          },
        ),
      )
    })
  },
)
watch(
  () => currentGroupOutputs.value.join('|'),
  (next, previous) => {
    if (!next || next === previous) return
    nextTick(() => {
      const cards = commerceRoot.value?.querySelectorAll('.result-image-card')
      if (!cards?.length) return
      runScopedMotion(() =>
        gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 18, scale: 0.965 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.58,
            stagger: 0.08,
            ease: 'back.out(1.25)',
            clearProps: 'transform,opacity,visibility',
          },
        ),
      )
    })
  },
)

onMounted(async () => {
  await nextTick()
  if (commerceRoot.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    motionContext = gsap.context(() => {
      gsap.fromTo(
        ['.commerce-header', '.commerce-rail', '.commerce-settings', '.commerce-canvas'],
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.58,
          stagger: 0.055,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility',
        },
      )
    }, commerceRoot.value)
  }
  await initializeWorkspace()
})
onBeforeUnmount(() => {
  motionContext?.revert()
  motionContext = null
  releasePreviews()
})
</script>

<template>
  <main ref="commerceRoot" class="commerce-studio">
    <header class="commerce-header">
      <div class="commerce-workspace-title">
        <span class="commerce-workspace-title__icon" aria-hidden="true">
          <i class="bi bi-bag-check-fill"></i>
        </span>
        <span
          ><strong>AI 电商设计</strong><small>{{ activeMode.label }}</small></span
        >
      </div>
      <button type="button" class="commerce-new" :disabled="running" @click="resetTask">
        <i class="bi bi-plus-lg"></i><span>新建任务</span>
      </button>
      <span class="commerce-current-mode">
        <i class="bi" :class="activeMode.icon"></i>{{ activeMode.label }}
      </span>
      <div class="commerce-header__actions">
        <button
          type="button"
          :class="{ active: workspaceView === 'result' }"
          @click="openWorkspaceView('result')"
        >
          <i class="bi bi-easel2"></i>生成结果
        </button>
        <button
          type="button"
          :class="{ active: workspaceView === 'history' }"
          @click="openWorkspaceView('history')"
        >
          <i class="bi bi-clock-history"></i>电商历史
        </button>
        <button
          type="button"
          :class="{ active: workspaceView === 'assets' }"
          @click="openWorkspaceView('assets')"
        >
          <i class="bi bi-collection"></i>资产与素材
        </button>
        <span class="commerce-cost"><i class="bi bi-coin"></i>{{ costLabel }}</span>
      </div>
    </header>

    <div class="mobile-pane-switch" role="tablist" aria-label="工作区切换">
      <button
        type="button"
        :class="{ active: activeMobilePane === 'settings' }"
        @click="activeMobilePane = 'settings'"
      >
        参数设置
      </button>
      <button
        type="button"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'result' }"
        @click="openWorkspaceView('result')"
      >
        生成结果
      </button>
      <button
        type="button"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'history' }"
        @click="openWorkspaceView('history')"
      >
        历史
      </button>
      <button
        type="button"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'assets' }"
        @click="openWorkspaceView('assets')"
      >
        素材
      </button>
    </div>

    <div class="commerce-layout">
      <nav class="commerce-rail" aria-label="电商设计工具">
        <button
          v-for="group in ECOMMERCE_RAIL_GROUPS"
          :key="group.id"
          type="button"
          :class="{ active: group.modes.includes(activeMode.id) }"
          :title="group.label"
          :disabled="running"
          @click="setActiveMode(ecommerceModeById(group.mode))"
        >
          <i class="bi" :class="group.icon"></i><span>{{ group.label }}</span>
        </button>
        <RouterLink to="/tools/background-remove" title="智能抠图">
          <i class="bi bi-person-bounding-box"></i><span>智能抠图</span>
        </RouterLink>
      </nav>

      <aside
        class="commerce-settings"
        :class="{ 'is-mobile-hidden': activeMobilePane !== 'settings' }"
      >
        <div class="settings-scroll">
          <section class="settings-section">
            <h2>
              {{ activeMode.uploadTitle || '商品原图' }}
              <i
                class="bi bi-question-circle"
                :title="activeMode.uploadHint || '同一商品可上传多个角度'"
              ></i>
            </h2>
            <div
              class="product-upload"
              :class="{
                'is-dragging': dragging,
                'has-files': previews.length,
                'is-disabled': running,
              }"
              @dragenter.prevent="dragging = true"
              @dragover.prevent
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              <div v-if="previews.length" class="upload-grid">
                <figure v-for="(item, index) in previews" :key="item.url">
                  <img :src="item.url" :alt="`${referenceLabel(index)}参考图`" />
                  <span class="upload-role">{{ referenceLabel(index) }}</span>
                  <button
                    type="button"
                    title="移除图片"
                    :disabled="running"
                    @click="removeFile(index)"
                  >
                    <i class="bi bi-x-lg"></i>
                  </button>
                </figure>
                <button
                  v-if="previews.length < 6"
                  type="button"
                  class="upload-add"
                  title="继续添加"
                  :disabled="running"
                  @click="fileInput?.click()"
                >
                  <i class="bi bi-plus-lg"></i>
                </button>
              </div>
              <button
                v-else
                type="button"
                class="upload-empty"
                :disabled="running"
                @click="fileInput?.click()"
              >
                <i class="bi bi-cloud-arrow-up"></i><strong>上传参考图片</strong
                ><small>{{ activeMode.uploadHint || '支持 PNG、JPG、WebP，最多 6 张' }}</small>
              </button>
              <input
                ref="fileInput"
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                @change="onFileChange"
              />
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-heading">
              <h2>生成设置</h2>
              <span>{{ activeRailGroup.label }}</span>
            </div>
            <div
              v-if="activeRailModes.length > 1"
              class="mode-switch"
              role="tablist"
              :aria-label="`${activeRailGroup.label}工具`"
            >
              <button
                v-for="mode in activeRailModes"
                :key="mode.id"
                type="button"
                role="tab"
                :aria-selected="mode.id === activeMode.id"
                :class="{ active: mode.id === activeMode.id }"
                :disabled="running"
                @click="setActiveMode(mode)"
              >
                <i class="bi" :class="mode.icon"></i>
                <span>{{ mode.shortLabel || mode.label }}</span>
              </button>
            </div>
            <div
              v-if="activeModeFields.has('platform') || activeModeFields.has('market')"
              class="select-row"
            >
              <label v-if="activeModeFields.has('platform')"
                ><span>平台</span
                ><CommerceSelect
                  v-model="platform"
                  :options="platformOptions"
                  aria-label="选择电商平台"
                  :disabled="running"
                /></label
              >
              <label v-if="activeModeFields.has('market')"
                ><span>市场</span
                ><CommerceSelect
                  v-model="market"
                  :options="marketOptions"
                  aria-label="选择目标市场"
                  :disabled="running"
                /></label
              >
              <label v-if="activeModeFields.has('language')"
                ><span>语言</span
                ><CommerceSelect
                  v-model="language"
                  :options="languageOptions"
                  aria-label="选择文案语言"
                  :disabled="running"
                /></label
              >
            </div>
            <div class="select-row select-row--output">
              <label>
                <span>画面比例</span>
                <CommerceSelect
                  v-model="aspectRatio"
                  :options="ratioOptions"
                  aria-label="选择画面比例"
                  :disabled="running"
                />
              </label>
              <label v-if="maxOutputCount > 1">
                <span>生成张数</span>
                <CommerceSelect
                  v-model="outputCount"
                  :options="outputCountOptions"
                  aria-label="选择生成张数"
                  :disabled="running"
                />
              </label>
              <label>
                <span>生成模型</span>
                <CommerceSelect
                  v-model="modelId"
                  :options="modelSelectOptions"
                  placeholder="请选择模型"
                  aria-label="选择生成模型"
                  :disabled="running"
                />
              </label>
            </div>
            <div
              v-if="
                activeModeFields.has('scene') ||
                activeModeFields.has('campaign') ||
                activeModeFields.has('tone') ||
                activeModeFields.has('apparel') ||
                activeModeFields.has('model') ||
                activeModeFields.has('pose') ||
                activeModeFields.has('accessory') ||
                activeModeFields.has('shadow')
              "
              class="select-row select-row--creative"
            >
              <label v-if="activeModeFields.has('scene')">
                <span>场景方向</span>
                <CommerceSelect v-model="sceneStyle" :options="sceneOptions" aria-label="选择场景方向" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('campaign')">
                <span>营销目标</span>
                <CommerceSelect v-model="campaignGoal" :options="campaignOptions" aria-label="选择营销目标" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('tone')">
                <span>视觉风格</span>
                <CommerceSelect v-model="visualTone" :options="toneOptions" aria-label="选择视觉风格" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('apparel')">
                <span>服装类型</span>
                <CommerceSelect v-model="apparelType" :options="apparelOptions" aria-label="选择服装类型" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('model')">
                <span>模特人群</span>
                <CommerceSelect v-model="modelProfile" :options="modelOptions" aria-label="选择模特人群" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('pose')">
                <span>模特姿态</span>
                <CommerceSelect v-model="modelPose" :options="poseOptions" aria-label="选择模特姿态" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('accessory')">
                <span>饰品类型</span>
                <CommerceSelect v-model="accessoryType" :options="accessoryOptions" aria-label="选择饰品类型" :disabled="running" />
              </label>
              <label v-if="activeModeFields.has('shadow')">
                <span>阴影类型</span>
                <CommerceSelect v-model="shadowStyle" :options="shadowOptions" aria-label="选择阴影类型" :disabled="running" />
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h2>{{ requiresBrief ? '商品卖点与要求' : '补充要求' }}</h2>
            <label class="text-field">
              <span>{{ subjectNameLabel }}</span>
              <input v-model="productName" maxlength="60" :placeholder="subjectNamePlaceholder" />
            </label>
            <label class="text-field">
              <span>核心卖点</span>
              <textarea
                v-model="sellingPoints"
                maxlength="1200"
                :placeholder="
                  requiresBrief
                    ? '填写核心卖点、适用人群、期望场景和具体参数…'
                    : '可填写希望保留的细节、场景或处理要求…'
                "
              ></textarea>
              <small>{{ sellingPoints.length }}/1200</small>
            </label>
            <button
              type="button"
              class="text-stability-control"
              :class="{ active: textStabilityEnabled }"
              role="switch"
              :aria-checked="textStabilityEnabled"
              @click="textStabilityEnabled = !textStabilityEnabled"
            >
              <span><i class="bi bi-fonts"></i></span>
              <span>
                <strong>文字稳定性</strong>
                <small>锁定已提供文案，无法可靠生成时优先留白</small>
              </span>
              <i class="text-stability-switch"><b></b></i>
            </button>
          </section>

          <section v-if="activeModeFields.has('modules')" class="settings-section modules-section">
            <h2>视觉模块 <small>多选</small></h2>
            <div class="module-grid">
              <label v-for="item in ECOMMERCE_MODULES" :key="item.value">
                <input
                  v-model="selectedModules"
                  type="checkbox"
                  :value="item.value"
                  :disabled="item.value === 'angles' && inputFiles.length < 2"
                />
                <span class="module-check"><i class="bi bi-check"></i></span>
                <span
                  ><strong>{{ item.label }}</strong
                  ><small>{{
                    item.value === 'angles' && inputFiles.length < 2
                      ? '需要至少 2 张角度参考'
                      : item.hint
                  }}</small></span
                >
              </label>
            </div>
          </section>

          <section class="settings-section shot-plan-section">
            <div class="settings-heading">
              <h2>本次出图结构</h2>
              <span>{{ generationPlan.length }} 张 · 顺序生成</span>
            </div>
            <ol class="shot-plan-list">
              <li v-for="(item, index) in generationPlan" :key="item.viewId">
                <span>{{ index + 1 }}</span>
                <div>
                  <strong>{{ item.viewLabel.split(' · ').pop() }}</strong>
                  <small>{{ availableShotBlueprints[index]?.direction }}</small>
                </div>
              </li>
            </ol>
            <p v-if="generationPlan.length > 1" class="series-lock-note">
              <i class="bi bi-link-45deg"></i>
              首张结果将锁定后续图片的色彩、光线和版式语言
            </p>
          </section>
        </div>

        <footer class="generate-bar">
          <p v-if="localError || generationError" role="alert">
            {{ localError || generationError }}
          </p>
          <div v-else class="generate-meta">
            <span :class="{ ready: readiness.ready }">
              <i
                class="bi"
                :class="readiness.ready ? 'bi-check-circle-fill' : 'bi-info-circle'"
              ></i>
              {{ readiness.label }}
            </span>
            <strong>{{ costLabel }}</strong>
          </div>
          <button v-if="running" type="button" class="cancel-button" @click="cancel()">
            <i class="bi bi-stop-circle"></i>停止生成
          </button>
          <button
            v-else
            type="button"
            class="generate-button"
            :disabled="!canGenerate"
            @click="generate"
          >
            <i class="bi bi-stars"></i>生成{{ activeMode.label }}
          </button>
        </footer>
      </aside>

      <section
        ref="canvasPanel"
        class="commerce-canvas"
        :class="{ 'is-mobile-hidden': activeMobilePane !== 'canvas' }"
      >
        <section v-if="workspaceView === 'history'" class="workspace-library">
          <header class="workspace-library__header">
            <div>
              <span class="workspace-library__icon"><i class="bi bi-clock-history"></i></span>
              <span>
                <small>AI 电商资产</small>
                <strong>电商生成历史</strong>
              </span>
            </div>
            <div class="workspace-library__tools">
              <div class="workspace-segment" role="tablist" aria-label="历史范围">
                <button
                  type="button"
                  :class="{ active: historyScope === 'current' }"
                  @click="historyScope = 'current'"
                >
                  当前工具
                </button>
                <button
                  type="button"
                  :class="{ active: historyScope === 'all' }"
                  @click="historyScope = 'all'"
                >
                  全部电商
                </button>
              </div>
              <button
                type="button"
                class="workspace-icon-button"
                title="刷新历史"
                :disabled="historyLoading"
                @click="loadHistory(12)"
              >
                <i class="bi bi-arrow-clockwise"></i>
              </button>
            </div>
          </header>

          <div class="workspace-library__body">
            <div v-if="historyLoading && !visibleHistoryOutputs.length" class="asset-skeleton-grid">
              <span v-for="index in 8" :key="index"></span>
            </div>
            <div v-else-if="visibleHistoryOutputs.length" class="asset-grid">
              <article v-for="output in visibleHistoryOutputs" :key="output" class="asset-card">
                <button
                  type="button"
                  class="asset-card__media"
                  title="查看生成结果"
                  @click="openHistoryOutput(output)"
                >
                  <AuthenticatedImage
                    :src="outputPreviewUrls[output] || output"
                    :alt="`${outputMode(output).label}历史结果`"
                    :max-dimension="420"
                    loading="lazy"
                  />
                  <span>V{{ outputVersion(output) }}</span>
                </button>
                <div class="asset-card__copy">
                  <strong>{{ outputMode(output).shortLabel || outputMode(output).label }}</strong>
                  <small>{{ formatOutputTime(output) }}</small>
                </div>
                <div class="asset-card__actions">
                  <button type="button" @click="openHistoryOutput(output)">
                    <i class="bi bi-eye"></i>查看
                  </button>
                  <button
                    type="button"
                    class="primary"
                    :disabled="Boolean(referenceImporting) || running"
                    @click="useHistoryAsReference(output)"
                  >
                    <i
                      class="bi"
                      :class="
                        referenceImporting === `history:${output}`
                          ? 'bi-arrow-repeat is-spinning'
                          : 'bi-plus-circle'
                      "
                    ></i>
                    作为参考
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="workspace-empty">
              <span><i class="bi bi-clock-history"></i></span>
              <strong
                >还没有{{ historyScope === 'current' ? activeMode.label : '电商' }}记录</strong
              >
              <small>完成生成后，成品会自动保存在这里</small>
              <button type="button" @click="openWorkspaceView('result')">开始创作</button>
            </div>
            <button
              v-if="visibleHistoryOutputs.length && canLoadMoreHistory"
              type="button"
              class="workspace-load-more"
              :disabled="historyLoading"
              @click="loadMoreEcommerceHistory"
            >
              <i class="bi bi-arrow-down-circle"></i>
              {{ historyLoading ? '正在加载' : '加载更多历史' }}
            </button>
          </div>
        </section>

        <section v-else-if="workspaceView === 'assets'" class="workspace-library">
          <header class="workspace-library__header">
            <div>
              <span class="workspace-library__icon"><i class="bi bi-collection"></i></span>
              <span>
                <small>个人资源库</small>
                <strong>资产与素材</strong>
              </span>
            </div>
            <div class="workspace-library__tools">
              <span class="workspace-library__count">{{ assetTotalCount }} 项资产</span>
              <button
                type="button"
                class="workspace-icon-button"
                title="刷新素材"
                :disabled="assetsLoading || assetsLoadingMore"
                @click="refreshAssets"
              >
                <i class="bi bi-arrow-clockwise"></i>
              </button>
              <RouterLink to="/materials" class="workspace-manage-link">
                <i class="bi bi-box-arrow-up-right"></i><span>管理素材</span>
              </RouterLink>
            </div>
          </header>

          <div class="workspace-library__body">
            <div class="asset-filter-bar" aria-label="素材分组">
              <button
                type="button"
                :class="{ active: assetFilter === 'all' }"
                @click="selectAssetFilter('all')"
              >
                全部
              </button>
              <button
                type="button"
                :class="{ active: assetFilter === 'ungrouped' }"
                @click="selectAssetFilter('ungrouped')"
              >
                未分组
              </button>
              <button
                v-for="group in assetGroups"
                :key="group.id"
                type="button"
                :class="{ active: assetFilter === group.id }"
                @click="selectAssetFilter(group.id)"
              >
                {{ group.name }} <small>{{ group.assetCount }}</small>
              </button>
            </div>

            <div v-if="assetsLoading && !assets.length" class="asset-skeleton-grid">
              <span v-for="index in 8" :key="index"></span>
            </div>
            <div v-else-if="assetsError && !assets.length" class="workspace-empty is-error">
              <span><i class="bi bi-exclamation-circle"></i></span>
              <strong>素材读取失败</strong>
              <small>{{ assetsError }}</small>
              <button type="button" @click="refreshAssets">重新加载</button>
            </div>
            <div v-else-if="assets.length" class="asset-grid">
              <article v-for="asset in assets" :key="asset.id" class="asset-card">
                <button
                  type="button"
                  class="asset-card__media"
                  title="加入当前任务"
                  :disabled="Boolean(referenceImporting) || running"
                  @click="useAssetAsReference(asset)"
                >
                  <AuthenticatedImage
                    :src="asset.thumbnailUrl || asset.url"
                    :alt="asset.title || '个人素材'"
                    :max-dimension="420"
                    loading="lazy"
                  />
                </button>
                <div class="asset-card__copy">
                  <strong :title="asset.title">{{ asset.title || '未命名素材' }}</strong>
                  <small>{{
                    asset.contentType?.replace('image/', '').toUpperCase() || '图片'
                  }}</small>
                </div>
                <div class="asset-card__actions asset-card__actions--single">
                  <button
                    type="button"
                    class="primary"
                    :disabled="Boolean(referenceImporting) || running"
                    @click="useAssetAsReference(asset)"
                  >
                    <i
                      class="bi"
                      :class="
                        referenceImporting === `asset:${asset.id}`
                          ? 'bi-arrow-repeat is-spinning'
                          : 'bi-plus-circle'
                      "
                    ></i>
                    加入参考图
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="workspace-empty">
              <span><i class="bi bi-images"></i></span>
              <strong>这个分组还没有素材</strong>
              <small>可前往素材管理上传商品、人物或场景参考图</small>
              <RouterLink to="/materials">去管理素材</RouterLink>
            </div>
            <button
              v-if="assets.length && assetsCursor"
              type="button"
              class="workspace-load-more"
              :disabled="assetsLoadingMore"
              @click="loadAssetsWorkspace({ append: true })"
            >
              <i class="bi bi-arrow-down-circle"></i>
              {{ assetsLoadingMore ? '正在加载' : '加载更多素材' }}
            </button>
          </div>
        </section>

        <div v-else-if="running" class="canvas-generation" aria-live="polite">
          <header class="generation-status">
            <span class="generation-orbit"><i></i><b></b></span>
            <div>
              <small>AI 正在处理</small>
              <strong>{{ status || '正在生成电商设计' }}</strong>
              <span>正在锁定商品主体、文字与系列视觉</span>
            </div>
            <button type="button" @click="cancel()"><i class="bi bi-stop-circle"></i>停止</button>
          </header>
          <div class="generation-skeletons" :class="generationLayoutClass">
            <article
              v-for="(item, index) in generationPlan"
              :key="item.viewId"
              class="generation-skeleton"
              :style="generationAspectStyle"
            >
              <span class="generation-skeleton__shine"></span>
              <span class="generation-skeleton__product"><i class="bi bi-box-seam"></i></span>
              <footer>
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <strong>{{ item.viewLabel.split(' · ').pop() }}</strong>
                <i class="bi bi-three-dots"></i>
              </footer>
            </article>
          </div>
          <div class="generation-progress-line"><span></span></div>
          <p>可离开当前页面，任务完成后结果会自动进入电商历史</p>
        </div>

        <div v-else-if="modeOutputs.length" class="result-workspace">
          <header>
            <div>
              <span>{{ activeMode.label }}</span
              ><strong>{{ currentShotLabel }}</strong>
            </div>
            <div class="result-header-actions">
              <span class="version-badge">V{{ currentVersionNumber }}</span>
              <button type="button" title="放大查看细节" @click="openOutputPreview(currentOutput)">
                <i class="bi bi-arrows-fullscreen"></i>
              </button>
              <button
                type="button"
                title="局部编辑"
                :disabled="running"
                @click="openLocalEditor(currentOutput)"
              >
                <i class="bi bi-brush"></i>
              </button>
              <button type="button" title="下载当前结果" @click="downloadOutput(currentOutput)">
                <i class="bi bi-download"></i>
              </button>
            </div>
          </header>
          <div class="result-main">
            <div
              class="result-stage"
              :class="resultLayoutClass"
              :data-count="currentGroupOutputs.length"
            >
              <article
                v-for="(output, index) in currentGroupOutputs"
                :key="output"
                class="result-image-card"
                :class="{ active: output === currentOutput, loaded: loadedOutputs.has(output) }"
                :style="{
                  aspectRatio: String(outputAspectRatios[output] || aspectRatio).replace(':', ' / '),
                }"
                role="button"
                tabindex="0"
                :aria-label="`查看第 ${index + 1} 张结果细节`"
                @click="activeOutput = output"
                @dblclick="openOutputPreview(output)"
                @keydown.enter="openOutputPreview(output)"
              >
                <span v-if="!loadedOutputs.has(output)" class="result-image-skeleton"></span>
                <AuthenticatedImage
                  :src="output"
                  :alt="`${activeMode.label}第 ${index + 1} 张生成结果`"
                  :max-dimension="1600"
                  @load="markOutputLoaded(output)"
                />
                <span class="result-image-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="result-image-tools">
                  <button type="button" title="放大" @click.stop="openOutputPreview(output)">
                    <i class="bi bi-arrows-fullscreen"></i>
                  </button>
                  <button type="button" title="局部编辑" @click.stop="openLocalEditor(output)">
                    <i class="bi bi-brush"></i>
                  </button>
                </span>
              </article>
            </div>
            <aside class="revision-panel" aria-label="继续调整当前成品">
              <header>
                <span><i class="bi bi-sliders2"></i></span>
                <div>
                  <small>连续优化</small>
                  <strong>继续调整当前成品</strong>
                </div>
              </header>
              <p>只描述这一轮需要改变的内容，未提及部分会继续锁定。</p>
              <div class="version-lineage" aria-label="当前版本链">
                <span
                  v-for="version in currentVersionNumber"
                  :key="version"
                  :class="{ active: version === currentVersionNumber }"
                >
                  V{{ version }}
                </span>
              </div>
              <label class="revision-field">
                <span>调整方向</span>
                <CommerceSelect
                  v-model="revisionDirection"
                  :options="ECOMMERCE_REVISION_DIRECTIONS"
                  aria-label="选择调整方向"
                  :disabled="running"
                />
              </label>
              <label class="revision-field revision-field--brief">
                <span>本轮只修改</span>
                <textarea
                  v-model="revisionBrief"
                  maxlength="600"
                  placeholder="例如：商品再放大 15%，背景改为浅灰影棚，其他内容保持不变"
                ></textarea>
                <small>{{ revisionBrief.length }}/600</small>
              </label>
              <p v-if="revisionError || generationError" class="revision-error" role="alert">
                {{ revisionError || generationError }}
              </p>
              <div class="revision-submit-meta">
                <span><i class="bi bi-shield-check"></i>上一版本会保留</span>
                <strong>{{ revisionCostLabel }}</strong>
              </div>
              <button
                type="button"
                class="revision-submit"
                :disabled="!canRevise"
                @click="reviseCurrentOutput"
              >
                <i class="bi bi-arrow-repeat"></i>
                生成 V{{ currentVersionNumber + 1 }}
              </button>
            </aside>
          </div>
          <div class="result-strip" aria-label="生成历史">
            <button
              v-for="output in modeOutputs"
              :key="output"
              type="button"
              :class="{ active: output === currentOutput }"
              @click="activeOutput = output"
              @mouseenter="previewResultOnHover(output)"
            >
              <AuthenticatedImage
                :src="outputPreviewUrls[output] || output"
                alt=""
                :max-dimension="180"
              />
              <span class="result-shot-index">
                {{ String((outputGroupIndexes[output] || 0) + 1).padStart(2, '0') }} · V{{
                  outputVersion(output)
                }}
              </span>
              <span class="result-delete" title="删除" @click.stop="removeOutput(output)"
                ><i class="bi bi-trash3"></i
              ></span>
            </button>
          </div>
        </div>

        <div v-else class="canvas-empty">
          <div class="canvas-intro">
            <div>
              <p class="canvas-kicker">{{ activeMode.tagline }}</p>
              <h1>{{ activeMode.label }}</h1>
              <p>{{ activeMode.description }}</p>
            </div>
            <div class="canvas-facts" aria-label="当前任务配置">
              <span><i class="bi bi-grid-1x2"></i>{{ activeRailGroup.label }}</span>
              <span><i class="bi bi-aspect-ratio"></i>{{ aspectRatio }}</span>
              <span><i class="bi bi-images"></i>{{ actualOutputCount }} 张</span>
            </div>
          </div>
          <div class="canvas-flow">
            <button
              type="button"
              class="canvas-source"
              :class="{ 'has-images': previews.length }"
              :disabled="running"
              @click="fileInput?.click()"
            >
              <template v-if="previews.length">
                <img v-for="item in previews.slice(0, 3)" :key="item.url" :src="item.url" alt="" />
              </template>
              <template v-else>
                <i class="bi bi-cloud-arrow-up"></i>
                <strong>上传参考图</strong>
                <small>{{ activeMode.uploadHint || '最多 6 张' }}</small>
              </template>
            </button>
            <i class="canvas-flow__arrow bi bi-arrow-right" aria-hidden="true"></i>
            <div class="canvas-target">
              <header>
                <span><i class="bi" :class="activeMode.icon"></i></span>
                <div>
                  <small>本次将生成</small><strong>{{ actualOutputCount }} 张成品</strong>
                </div>
                <b>{{ aspectRatio }}</b>
              </header>
              <ol>
                <li v-for="(item, index) in generationPlan" :key="item.viewId">
                  <span>{{ String(index + 1).padStart(2, '0') }}</span>
                  <strong>{{ item.viewLabel.split(' · ').pop() }}</strong>
                  <i class="bi bi-check2"></i>
                </li>
              </ol>
              <footer v-if="generationPlan.length > 1">
                <i class="bi bi-link-45deg"></i>统一商品、色彩、光线与版式
              </footer>
            </div>
          </div>
        </div>
      </section>
    </div>

    <InsufficientCreditsDialog
      :show="creditsPrompt.dialogOpen.value"
      :required="creditsPrompt.requiredCredits.value"
      :available="creditsPrompt.availableCredits.value"
      :light="!appearanceStore.isDark"
      @close="creditsPrompt.closePrompt"
    />

    <LocalMaskEditorDialog
      v-if="maskEditorOpen"
      :open="maskEditorOpen"
      :source-url="maskEditorSource"
      :source-title="`${activeMode.label} · 涂抹需要调整的区域`"
      :busy="running"
      :light="!appearanceStore.isDark"
      @close="maskEditorOpen = false"
      @submit="submitMaskEdit"
    />

    <WallevenImagePreview
      :open="previewOpen"
      :images="previewGallery"
      :current-src="previewSource"
      :title="`${activeMode.label} · V${currentVersionNumber}`"
      filename="ecommerce-design.png"
      :enabled-actions="{ favorite: false, mockup: false, decompose: false, ai: false }"
      @close="previewOpen = false"
      @select="selectPreviewOutput"
      @download="downloadOutput($event?.src || previewSource)"
    />
  </main>
</template>

<style scoped>
.commerce-studio {
  --commerce-line: #e4e3ec;
  --commerce-panel: #fff;
  --commerce-canvas: #f7f7ff;
  --commerce-soft: #f4f4f8;
  --commerce-soft-strong: #eeeef5;
  --commerce-ink: #151a2d;
  --commerce-muted: #79809a;
  --commerce-accent: #6a4fe0;
  --commerce-accent-ink: #563cc8;
  --commerce-accent-soft: #f0ecff;
  --commerce-accent-line: #d9d1ff;
  --commerce-success: #1f7a4d;
  --commerce-warning: #8a5b18;
  --commerce-shadow-control: 0 2px 8px rgb(36 28 73 / 8%);
  --commerce-shadow-footer: 0 -8px 22px rgb(31 42 58 / 4%);
  --commerce-shadow-panel: 0 14px 36px rgb(32 28 62 / 6%);
  --commerce-shadow-result: 0 15px 38px rgb(27 37 52 / 12%);
  --commerce-shadow-card: 0 8px 24px rgb(31 36 55 / 4%);
  color-scheme: light;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  color: var(--commerce-ink);
  background: var(--commerce-canvas);
  flex-direction: column;
}
.commerce-studio button,
.commerce-studio a {
  -webkit-tap-highlight-color: transparent;
}
.commerce-studio button:not(:disabled),
.commerce-studio a {
  transition:
    color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-studio button:not(:disabled):active,
.commerce-studio a:active {
  transform: scale(0.975);
}
.commerce-studio input,
.commerce-studio textarea {
  transition:
    border-color 200ms cubic-bezier(0.22, 1, 0.36, 1),
    background 200ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-header {
  display: flex;
  min-height: 52px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--commerce-panel);
  border-bottom: 1px solid var(--commerce-line);
  flex: 0 0 52px;
}
.commerce-workspace-title {
  display: flex;
  min-width: 178px;
  align-items: center;
  gap: 9px;
  color: var(--commerce-ink);
}
.commerce-workspace-title__icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 7px;
  font-size: 14px;
}
.commerce-workspace-title > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.commerce-workspace-title strong {
  font-size: 15px;
  line-height: 1.1;
}
.commerce-workspace-title small {
  margin-top: 3px;
  overflow: hidden;
  color: var(--commerce-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-new,
.commerce-header__actions a,
.commerce-header__actions button,
.commerce-cost {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  color: var(--commerce-ink);
  background: var(--commerce-soft);
  border: 0;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.commerce-header__actions button {
  cursor: pointer;
}
.commerce-header__actions button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
}
.commerce-new:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.commerce-current-mode {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
.commerce-header__actions {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: auto;
}
.commerce-cost {
  color: var(--commerce-warning);
  background: color-mix(in srgb, var(--commerce-warning) 10%, var(--commerce-panel));
}
.commerce-layout {
  display: grid;
  min-height: 0;
  grid-template-columns: 72px clamp(348px, 22vw, 404px) minmax(0, 1fr);
  flex: 1 1 auto;
  overflow: hidden;
}
.commerce-rail {
  display: flex;
  min-width: 0;
  min-height: 0;
  padding-top: 13px;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--commerce-panel);
  border-right: 1px solid var(--commerce-line);
  flex-direction: column;
  gap: 6px;
}
.commerce-rail a,
.commerce-rail button {
  display: flex;
  min-height: 59px;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--commerce-muted);
  text-decoration: none;
  flex-direction: column;
  font-size: 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.commerce-rail a i,
.commerce-rail button i {
  font-size: 19px;
}
.commerce-rail a.active,
.commerce-rail button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-right: 3px solid var(--commerce-accent);
}
.commerce-rail button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.commerce-settings {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--commerce-panel);
  border-right: 1px solid var(--commerce-line);
  flex-direction: column;
}
.settings-scroll {
  min-height: 0;
  padding: 18px 18px 28px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  flex: 1 1 auto;
  overflow-y: auto;
}
.settings-section + .settings-section {
  margin-top: 21px;
}
.settings-section h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 800;
}
.settings-section h2 > i,
.settings-section h2 > small {
  color: var(--commerce-muted);
  font-size: 11px;
  font-weight: 500;
}
.product-upload {
  min-height: 124px;
  padding: 10px;
  background: color-mix(in srgb, var(--commerce-soft) 52%, transparent);
  border: 1px dashed color-mix(in srgb, var(--commerce-muted) 32%, transparent);
  border-radius: 9px;
  transition:
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    background 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.product-upload.is-dragging {
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--commerce-accent) 10%, transparent);
  transform: scale(1.008);
}
.product-upload.is-disabled {
  pointer-events: none;
  opacity: 0.58;
}
.upload-empty {
  display: flex;
  width: 100%;
  height: 102px;
  align-items: center;
  justify-content: center;
  color: var(--commerce-ink);
  background: transparent;
  border: 0;
  flex-direction: column;
}
.upload-empty i {
  margin-bottom: 5px;
  color: var(--commerce-accent);
  font-size: 25px;
}
.upload-empty strong {
  font-size: 13px;
}
.upload-empty small {
  margin-top: 6px;
  color: var(--commerce-muted);
  font-size: 11px;
}
.upload-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.upload-grid figure,
.upload-add {
  position: relative;
  aspect-ratio: 1;
  margin: 0;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 7px;
  transition:
    border-color 200ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.upload-grid img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.upload-grid figure:hover {
  border-color: var(--commerce-accent-line);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--commerce-accent) 12%, transparent);
  transform: translateY(-2px);
}
.upload-grid figure:hover img {
  transform: scale(1.035);
}
.upload-grid figure button {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  width: 23px;
  height: 23px;
  place-items: center;
  color: #fff;
  background: rgb(12 14 18 / 68%);
  border: 0;
  border-radius: 50%;
  font-size: 10px;
}
.upload-role {
  position: absolute;
  right: 5px;
  bottom: 5px;
  left: 5px;
  overflow: hidden;
  padding: 3px 5px;
  color: #fff;
  background: rgb(20 23 28 / 68%);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-add {
  color: var(--commerce-muted);
  border-style: dashed;
  font-size: 20px;
}
.select-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 9px;
}
.select-row + .select-row {
  margin-top: 9px;
}
.select-row label,
.wide-select,
.text-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.select-row label > span,
.wide-select > span,
.text-field > span {
  color: var(--commerce-muted);
  font-size: 10px;
  font-weight: 650;
}
.select-row select,
.wide-select select,
.text-field input,
.text-field textarea {
  width: 100%;
  color: var(--commerce-ink);
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 12px;
}
.select-row select option,
.wide-select select option {
  color: var(--commerce-ink);
  background: var(--commerce-panel);
}
.text-field input::placeholder,
.text-field textarea::placeholder,
.revision-field textarea::placeholder {
  color: color-mix(in srgb, var(--commerce-muted) 82%, transparent);
}
.select-row select:focus,
.wide-select select:focus,
.text-field input:focus,
.text-field textarea:focus {
  border-color: var(--commerce-accent-line);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--commerce-accent) 10%, transparent);
}
.select-row select,
.wide-select select,
.text-field input {
  height: 36px;
  padding: 0 10px;
}
.wide-select {
  margin-top: 9px;
}
.settings-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.settings-heading h2 {
  margin-bottom: 0;
}
.settings-heading > span {
  padding: 4px 7px;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
}
.mode-switch {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 7px;
  margin: 0 0 12px;
  padding: 5px;
  background: var(--commerce-soft);
  border-radius: 8px;
}
.mode-switch button {
  display: flex;
  min-width: 0;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--commerce-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
.mode-switch button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mode-switch button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  border-color: var(--commerce-accent-line);
  box-shadow: var(--commerce-shadow-control);
}
.mode-switch button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.text-field + .text-field {
  margin-top: 10px;
}
.text-field textarea {
  height: 126px;
  padding: 10px 12px 25px;
  resize: vertical;
  line-height: 1.6;
}
.text-field {
  position: relative;
}
.text-field > small {
  position: absolute;
  right: 10px;
  bottom: 8px;
  color: var(--commerce-muted);
  font-size: 10px;
}
.text-stability-control {
  display: grid;
  width: 100%;
  min-height: 58px;
  grid-template-columns: 32px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 9px 11px;
  color: var(--commerce-ink);
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    background 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.text-stability-control:active {
  transform: scale(0.988);
}
.text-stability-control.active {
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent-line);
}
.text-stability-control > span:first-child {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  border-radius: 8px;
}
.text-stability-control > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.text-stability-control strong {
  font-size: 11px;
}
.text-stability-control small {
  overflow: hidden;
  color: var(--commerce-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text-stability-switch {
  position: relative;
  display: block;
  width: 34px;
  height: 20px;
  background: color-mix(in srgb, var(--commerce-muted) 34%, transparent);
  border-radius: 999px;
  transition: background 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.text-stability-switch b {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 2px 5px rgb(20 20 30 / 20%);
  transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.text-stability-control.active .text-stability-switch {
  background: var(--commerce-accent);
}
.text-stability-control.active .text-stability-switch b {
  transform: translateX(14px);
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.module-grid label {
  position: relative;
  display: flex;
  min-height: 68px;
  align-items: flex-start;
  gap: 9px;
  padding: 13px 11px;
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.module-grid label:has(input:checked) {
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent-line);
}
.module-grid input {
  position: absolute;
  opacity: 0;
}
.module-check {
  display: grid;
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  place-items: center;
  color: transparent;
  background: var(--commerce-panel);
  border: 1px solid color-mix(in srgb, var(--commerce-muted) 38%, transparent);
  border-radius: 4px;
}
.module-grid input:checked + .module-check {
  color: #fff;
  background: var(--commerce-accent);
  border-color: var(--commerce-accent);
}
.module-grid label > span:last-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.module-grid strong {
  font-size: 12px;
}
.module-grid small {
  color: var(--commerce-muted);
  font-size: 10px;
}
.shot-plan-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.shot-plan-list li {
  display: grid;
  min-width: 0;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  padding: 9px 10px;
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 7px;
}
.shot-plan-list li > span {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 5px;
  font-size: 10px;
  font-weight: 800;
}
.shot-plan-list li > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.shot-plan-list strong {
  font-size: 11px;
}
.shot-plan-list small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--commerce-muted);
  font-size: 9px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.series-lock-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 9px 1px 0;
  color: var(--commerce-accent-ink);
  font-size: 9px;
  line-height: 1.45;
}
.generate-bar {
  position: relative;
  z-index: 2;
  min-height: 94px;
  padding: 10px 18px;
  background: var(--commerce-panel);
  border-top: 1px solid var(--commerce-line);
  box-shadow: var(--commerce-shadow-footer);
  flex: 0 0 auto;
}
.generate-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--commerce-muted);
  font-size: 10px;
}
.generate-meta span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generate-meta span.ready {
  color: var(--commerce-success);
}
.generate-meta strong {
  flex: 0 0 auto;
  color: var(--commerce-warning);
  font-weight: 750;
}
.generate-bar p {
  margin: -3px 0 5px;
  overflow: hidden;
  color: #d94a4a;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generate-button,
.cancel-button {
  display: flex;
  width: 100%;
  height: 48px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  background: var(--commerce-accent);
  border: 0;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 800;
}
.generate-button:hover:not(:disabled) {
  background: var(--commerce-accent-ink);
}
.generate-button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.cancel-button {
  color: #b73636;
  background: color-mix(in srgb, #b73636 10%, var(--commerce-panel));
}
.commerce-canvas {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--commerce-canvas);
}
.canvas-empty,
.canvas-status {
  display: flex;
  height: 100%;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.canvas-empty {
  justify-content: flex-start;
  padding: clamp(28px, 4vh, 44px) 32px 36px;
  overflow: auto;
  overscroll-behavior: contain;
}
.canvas-intro {
  display: flex;
  width: min(1080px, calc(100% - 48px));
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  padding: 0 2px 22px;
  border-bottom: 1px solid var(--commerce-line);
}
.canvas-intro > div:first-child {
  min-width: 0;
}
.canvas-kicker {
  margin: 0 0 10px;
  color: var(--commerce-accent);
  font-size: 10px;
  font-weight: 850;
}
.canvas-intro h1 {
  margin: 0;
  font-size: 42px;
  font-weight: 850;
  line-height: 1.12;
}
.canvas-intro > div:first-child > p:not(.canvas-kicker) {
  max-width: 680px;
  margin: 11px 0 0;
  color: var(--commerce-muted);
  font-size: 14px;
  line-height: 1.55;
}
.canvas-facts {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin: 0;
}
.canvas-facts span {
  display: inline-flex;
  height: 25px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--commerce-muted);
  background: color-mix(in srgb, var(--commerce-panel) 82%, transparent);
  border: 1px solid var(--commerce-line);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}
.canvas-flow {
  display: grid;
  width: min(1080px, calc(100% - 48px));
  min-height: clamp(340px, 46vh, 410px);
  grid-template-columns: minmax(240px, 0.72fr) 42px minmax(380px, 1.28fr);
  align-items: stretch;
  gap: 20px;
  margin-top: 28px;
}
.canvas-source {
  display: grid;
  min-height: 100%;
  place-items: center;
  align-content: center;
  gap: 7px;
  padding: 12px;
  overflow: hidden;
  color: var(--commerce-ink);
  background: var(--commerce-panel);
  border: 1px dashed color-mix(in srgb, var(--commerce-muted) 38%, transparent);
  border-radius: 10px;
  box-shadow: var(--commerce-shadow-panel);
}
.canvas-source > i {
  color: var(--commerce-accent);
  font-size: 25px;
}
.canvas-source strong {
  font-size: 12px;
}
.canvas-source small {
  color: var(--commerce-muted);
  font-size: 10px;
  line-height: 1.45;
  text-align: center;
}
.canvas-source.has-images {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: stretch;
  gap: 5px;
  border-style: solid;
}
.canvas-source.has-images img {
  width: 100%;
  height: 100%;
  min-height: 90px;
  object-fit: contain;
  background: var(--commerce-panel);
  border-radius: 6px;
}
.canvas-source.has-images img:first-child:last-child,
.canvas-source.has-images img:nth-child(3) {
  grid-column: 1 / -1;
}
.canvas-flow__arrow {
  color: color-mix(in srgb, var(--commerce-muted) 58%, transparent);
  font-size: 24px;
}
.canvas-target {
  display: grid;
  width: 100%;
  min-height: 100%;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 18px;
  color: var(--commerce-muted);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 10px;
  box-shadow: var(--commerce-shadow-panel);
}
.canvas-target > header {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.canvas-target > header > span {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 7px;
}
.canvas-target > header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.canvas-target > header strong {
  color: var(--commerce-ink);
  font-size: 12px;
}
.canvas-target > header small {
  color: var(--commerce-muted);
  font-size: 9px;
}
.canvas-target > header b {
  color: var(--commerce-accent-ink);
  font-size: 11px;
}
.canvas-target > ol {
  display: grid;
  align-content: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.canvas-target > ol li {
  display: grid;
  min-height: 34px;
  grid-template-columns: 28px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  background: var(--commerce-soft);
  border-radius: 6px;
}
.canvas-target > ol span {
  color: var(--commerce-accent-ink);
  font-size: 9px;
  font-weight: 800;
}
.canvas-target > ol strong {
  overflow: hidden;
  color: var(--commerce-ink);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.canvas-target > ol i {
  color: var(--commerce-success);
  font-size: 12px;
}
.canvas-target > footer {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--commerce-accent-ink);
  font-size: 9px;
}
.canvas-target > footer i {
  font-size: 14px;
}
.canvas-target strong {
  color: var(--commerce-ink);
  font-size: 12px;
}
.canvas-generation {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: clamp(20px, 3vw, 34px);
  overflow-y: auto;
  flex-direction: column;
}
.generation-status {
  display: grid;
  width: min(980px, 100%);
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  margin: 0 auto 22px;
}
.generation-status > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.generation-status small,
.generation-status span,
.canvas-generation > p {
  color: var(--commerce-muted);
  font-size: 10px;
}
.generation-status strong {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generation-status button {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  color: #b73636;
  background: color-mix(in srgb, #b73636 9%, var(--commerce-panel));
  border: 1px solid color-mix(in srgb, #b73636 18%, transparent);
  border-radius: 9px;
  font-size: 10px;
  font-weight: 750;
}
.generation-orbit {
  position: relative;
  display: block;
  width: 46px;
  height: 46px;
  background: var(--commerce-accent-soft);
  border-radius: 13px;
}
.generation-orbit::before,
.generation-orbit::after,
.generation-orbit i,
.generation-orbit b {
  position: absolute;
  border-radius: 50%;
  content: '';
}
.generation-orbit::before {
  inset: 10px;
  border: 2px solid var(--commerce-accent-line);
  border-top-color: var(--commerce-accent);
  animation: commerce-spin 1.05s linear infinite;
}
.generation-orbit::after {
  inset: 18px;
  background: var(--commerce-accent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--commerce-accent) 48%, transparent);
  animation: commerce-pulse 1.4s ease-in-out infinite;
}
.generation-orbit i,
.generation-orbit b {
  width: 5px;
  height: 5px;
  background: var(--commerce-accent);
  animation: commerce-orbit 1.8s linear infinite;
  transform-origin: 18px 18px;
}
.generation-orbit i {
  top: 5px;
  left: 20px;
}
.generation-orbit b {
  top: 20px;
  left: 5px;
  animation-delay: -0.9s;
}
.generation-skeletons {
  display: grid;
  width: min(980px, 100%);
  min-height: 0;
  align-items: start;
  justify-content: center;
  gap: 14px;
  margin: auto;
}
.generation-skeletons.is-single {
  grid-template-columns: minmax(240px, 520px);
}
.generation-skeletons.is-double {
  grid-template-columns: repeat(2, minmax(180px, 1fr));
}
.generation-skeletons.is-quad {
  grid-template-columns: repeat(2, minmax(160px, 1fr));
  max-width: 760px;
}
.generation-skeletons.is-multi {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.generation-skeleton {
  position: relative;
  min-width: 0;
  max-height: 58vh;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 14px;
  box-shadow: var(--commerce-shadow-card);
}
.generation-skeleton__shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    108deg,
    transparent 20%,
    color-mix(in srgb, var(--commerce-panel) 72%, transparent) 43%,
    transparent 66%
  );
  animation: commerce-shine 1.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  transform: translateX(-110%);
}
.generation-skeleton__product {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  width: 70px;
  height: 70px;
  place-items: center;
  color: color-mix(in srgb, var(--commerce-muted) 40%, transparent);
  background: color-mix(in srgb, var(--commerce-panel) 52%, transparent);
  border-radius: 20px;
  font-size: 25px;
  animation: commerce-float 2.4s ease-in-out infinite;
  transform: translate(-50%, -60%);
}
.generation-skeleton footer {
  position: absolute;
  right: 10px;
  bottom: 10px;
  left: 10px;
  display: grid;
  height: 38px;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--commerce-panel) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--commerce-line) 76%, transparent);
  border-radius: 9px;
  backdrop-filter: blur(12px);
}
.generation-skeleton footer span,
.generation-skeleton footer i {
  color: var(--commerce-accent-ink);
  font-size: 9px;
}
.generation-skeleton footer strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generation-progress-line {
  width: min(980px, 100%);
  height: 4px;
  margin: 20px auto 10px;
  overflow: hidden;
  background: var(--commerce-soft-strong);
  border-radius: 999px;
}
.generation-progress-line span {
  display: block;
  width: 38%;
  height: 100%;
  background: linear-gradient(90deg, var(--commerce-accent), #39b99b);
  border-radius: inherit;
  animation: commerce-progress 1.9s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
.canvas-generation > p {
  margin: 0 auto;
  text-align: center;
}
.result-workspace {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: 58px minmax(0, 1fr) 92px;
}
.result-workspace > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  background: color-mix(in srgb, var(--commerce-panel) 86%, transparent);
  border-bottom: 1px solid var(--commerce-line);
}
.result-workspace > header div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.result-workspace > header span {
  color: var(--commerce-muted);
  font-size: 11px;
}
.result-workspace > header strong {
  font-size: 14px;
}
.result-workspace > header button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--commerce-ink);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 7px;
}
.result-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.result-workspace > header .version-badge {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 8px;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border: 1px solid var(--commerce-accent-line);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
}
.result-main {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) clamp(304px, 22vw, 344px);
  overflow: hidden;
}
.result-stage {
  display: grid;
  min-height: 0;
  align-content: center;
  justify-content: center;
  gap: 14px;
  padding: 28px;
  overflow: auto;
}
.result-stage.is-single {
  grid-template-columns: minmax(240px, min(760px, 100%));
}
.result-stage.is-double {
  grid-template-columns: repeat(2, minmax(180px, 1fr));
}
.result-stage.is-quad {
  grid-template-columns: repeat(2, minmax(160px, 1fr));
  max-width: 920px;
  width: 100%;
  justify-self: center;
}
.result-stage.is-multi {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  align-content: start;
}
.result-image-card {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  max-height: 72vh;
  padding: 0;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 14px;
  box-shadow: var(--commerce-shadow-result);
  outline: none;
  cursor: zoom-in;
  will-change: transform;
  transition:
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.result-image-card:hover,
.result-image-card:focus-visible {
  border-color: var(--commerce-accent-line);
  box-shadow: 0 22px 52px color-mix(in srgb, var(--commerce-accent) 18%, transparent);
  transform: translateY(-4px);
}
.result-image-card.active {
  border-color: var(--commerce-accent);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--commerce-accent) 14%, transparent),
    var(--commerce-shadow-result);
}
.result-image-card :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--commerce-soft);
}
.result-image-card :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.result-image-card:hover :deep(img),
.result-image-card:focus-visible :deep(img) {
  transform: scale(1.045) translateY(-0.6%);
}
.result-image-skeleton {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: linear-gradient(
    105deg,
    var(--commerce-soft) 22%,
    var(--commerce-soft-strong) 42%,
    var(--commerce-soft) 62%
  );
  background-size: 240% 100%;
  animation: commerce-skeleton 1.25s ease-in-out infinite;
}
.result-image-card.loaded .result-image-skeleton {
  display: none;
}
.result-image-index {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 3;
  display: grid;
  min-width: 28px;
  height: 24px;
  place-items: center;
  padding: 0 7px;
  color: #fff;
  background: rgb(16 18 24 / 68%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 7px;
  font-size: 9px;
  font-weight: 800;
  backdrop-filter: blur(10px);
}
.result-image-tools {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 3;
  display: flex;
  gap: 6px;
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 220ms ease,
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.result-image-card:hover .result-image-tools,
.result-image-card:focus-within .result-image-tools {
  opacity: 1;
  transform: translateY(0);
}
.result-image-tools button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: #fff;
  background: rgb(16 18 24 / 72%);
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 9px;
  backdrop-filter: blur(12px);
}
.result-image-tools button:hover {
  background: var(--commerce-accent);
}
.revision-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  padding: 22px 20px 18px;
  overflow-y: auto;
  background: var(--commerce-panel);
  border-left: 1px solid var(--commerce-line);
  flex-direction: column;
}
.revision-panel > header {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.revision-panel > header > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 8px;
  font-size: 16px;
}
.revision-panel > header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.revision-panel > header small {
  color: var(--commerce-muted);
  font-size: 9px;
}
.revision-panel > header strong {
  color: var(--commerce-ink);
  font-size: 14px;
}
.revision-panel > p:not(.revision-error) {
  margin: 13px 0 12px;
  color: var(--commerce-muted);
  font-size: 10px;
  line-height: 1.55;
}
.version-lineage {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  overflow-x: auto;
}
.version-lineage span {
  position: relative;
  display: grid;
  min-width: 30px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 5px;
  font-size: 9px;
  font-weight: 800;
}
.version-lineage span + span::before {
  position: absolute;
  right: 100%;
  width: 16px;
  height: 1px;
  content: '';
  background: var(--commerce-line);
}
.version-lineage span.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent-line);
}
.revision-field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.revision-field + .revision-field {
  margin-top: 12px;
}
.revision-field > span {
  color: var(--commerce-muted);
  font-size: 10px;
  font-weight: 700;
}
.revision-field select,
.revision-field textarea {
  width: 100%;
  color: var(--commerce-ink);
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 11px;
}
.revision-field select {
  height: 38px;
  padding: 0 10px;
}
.revision-field textarea {
  height: 148px;
  padding: 11px 12px 28px;
  resize: vertical;
  line-height: 1.55;
}
.revision-field select:focus,
.revision-field textarea:focus {
  border-color: var(--commerce-accent-line);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--commerce-accent) 10%, transparent);
}
.revision-field--brief > small {
  position: absolute;
  right: 9px;
  bottom: 8px;
  color: var(--commerce-muted);
  font-size: 9px;
}
.revision-error {
  margin: 9px 0 0;
  color: #d94a4a;
  font-size: 10px;
  line-height: 1.45;
}
.revision-submit-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 16px;
  color: var(--commerce-muted);
  font-size: 9px;
}
.revision-submit-meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.revision-submit-meta strong {
  color: var(--commerce-warning);
  font-size: 10px;
}
.revision-submit {
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 9px;
  color: #fff;
  background: var(--commerce-accent);
  border: 0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
}
.revision-submit:hover:not(:disabled) {
  background: var(--commerce-accent-ink);
}
.revision-submit:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.result-strip {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 18px;
  overflow-x: auto;
  background: var(--commerce-panel);
  border-top: 1px solid var(--commerce-line);
}
.result-strip > button {
  position: relative;
  width: 66px;
  height: 66px;
  flex: 0 0 auto;
  padding: 3px;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 2px solid transparent;
  border-radius: 7px;
}
.result-strip > button.active {
  border-color: var(--commerce-accent);
}
.result-strip > button:hover {
  border-color: var(--commerce-accent-line);
  transform: translateY(-2px);
}
.result-strip :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
  transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}
.result-strip > button:hover :deep(img) {
  transform: scale(1.06);
}
.result-shot-index {
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: grid;
  min-width: 20px;
  height: 17px;
  place-items: center;
  padding: 0 4px;
  color: #fff;
  background: rgb(20 22 25 / 72%);
  border-radius: 4px;
  font-size: 8px;
  font-weight: 800;
}
.result-delete {
  position: absolute;
  top: 3px;
  right: 3px;
  display: none;
  width: 21px;
  height: 21px;
  place-items: center;
  color: #fff;
  background: rgb(20 22 25 / 72%);
  border-radius: 50%;
  font-size: 10px;
}
.result-strip > button:hover .result-delete {
  display: grid;
}
.workspace-library {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 68px minmax(0, 1fr);
  background: var(--commerce-canvas);
}
.workspace-library__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 24px;
  background: color-mix(in srgb, var(--commerce-panel) 92%, transparent);
  border-bottom: 1px solid var(--commerce-line);
}
.workspace-library__header > div,
.workspace-library__header > div > span:last-child {
  display: flex;
  min-width: 0;
  align-items: center;
}
.workspace-library__header > div:first-child {
  gap: 11px;
}
.workspace-library__header > div > span:last-child {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}
.workspace-library__header small {
  color: var(--commerce-muted);
  font-size: 9px;
}
.workspace-library__header strong {
  color: var(--commerce-ink);
  font-size: 14px;
}
.workspace-library__icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 7px;
}
.workspace-library__tools {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.workspace-segment {
  display: grid;
  grid-template-columns: repeat(2, minmax(82px, 1fr));
  padding: 3px;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 7px;
}
.workspace-segment button {
  height: 29px;
  padding: 0 10px;
  color: var(--commerce-muted);
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 750;
}
.workspace-segment button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  box-shadow: var(--commerce-shadow-control);
}
.workspace-icon-button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  color: var(--commerce-ink);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 7px;
}
.workspace-icon-button:disabled {
  opacity: 0.45;
}
.workspace-library__count {
  color: var(--commerce-muted);
  font-size: 10px;
  white-space: nowrap;
}
.workspace-manage-link,
.workspace-empty a {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border: 1px solid var(--commerce-accent-line);
  border-radius: 7px;
  font-size: 10px;
  font-weight: 750;
  text-decoration: none;
  white-space: nowrap;
}
.workspace-library__body {
  min-width: 0;
  min-height: 0;
  padding: 20px 24px 28px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.asset-filter-bar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  margin-bottom: 18px;
  padding-bottom: 2px;
  overflow-x: auto;
}
.asset-filter-bar button {
  display: inline-flex;
  height: 32px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 0 11px;
  color: var(--commerce-muted);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}
.asset-filter-bar button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent-line);
}
.asset-filter-bar small {
  font-size: 8px;
}
.asset-grid,
.asset-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(188px, 100%), 1fr));
  align-items: start;
  gap: 14px;
}
.asset-card {
  min-width: 0;
  overflow: hidden;
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 8px;
  box-shadow: var(--commerce-shadow-card);
}
.asset-card__media {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 0;
}
.asset-card__media :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms ease;
}
.asset-card__media :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.asset-card__media:hover :deep(img) {
  transform: scale(1.025);
}
.asset-card__media > span {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  min-width: 28px;
  height: 21px;
  place-items: center;
  padding: 0 6px;
  color: #fff;
  background: rgb(20 22 29 / 72%);
  border-radius: 5px;
  font-size: 9px;
  font-weight: 800;
}
.asset-card__copy {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 11px 8px;
}
.asset-card__copy strong {
  min-width: 0;
  overflow: hidden;
  color: var(--commerce-ink);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-card__copy small {
  flex: 0 0 auto;
  color: var(--commerce-muted);
  font-size: 8px;
  white-space: nowrap;
}
.asset-card__actions {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  gap: 7px;
  padding: 0 10px 10px;
}
.asset-card__actions--single {
  grid-template-columns: 1fr;
}
.asset-card__actions button {
  display: inline-flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border: 0;
  border-radius: 6px;
  font-size: 9px;
  font-weight: 750;
  white-space: nowrap;
}
.asset-card__actions button.primary {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
}
.asset-card__actions button:disabled,
.asset-card__media:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.asset-skeleton-grid span {
  aspect-ratio: 4 / 3;
  background: linear-gradient(
    100deg,
    var(--commerce-soft) 25%,
    var(--commerce-soft-strong) 40%,
    var(--commerce-soft) 55%
  );
  background-size: 240% 100%;
  border-radius: 8px;
  animation: commerce-skeleton 1.25s ease-in-out infinite;
}
.workspace-empty {
  display: flex;
  min-height: min(460px, 70vh);
  align-items: center;
  justify-content: center;
  color: var(--commerce-muted);
  flex-direction: column;
  text-align: center;
}
.workspace-empty > span {
  display: grid;
  width: 50px;
  height: 50px;
  margin-bottom: 14px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 8px;
  font-size: 21px;
}
.workspace-empty strong {
  color: var(--commerce-ink);
  font-size: 14px;
}
.workspace-empty small {
  margin: 6px 0 16px;
  font-size: 10px;
}
.workspace-empty button {
  height: 34px;
  padding: 0 13px;
  color: #fff;
  background: var(--commerce-accent);
  border: 0;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 750;
}
.workspace-empty.is-error > span {
  color: #b73636;
  background: color-mix(in srgb, #b73636 10%, var(--commerce-panel));
}
.workspace-load-more {
  display: flex;
  min-width: 150px;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 22px auto 0;
  padding: 0 16px;
  color: var(--commerce-ink);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 7px;
  font-size: 10px;
  font-weight: 750;
}
.is-spinning {
  animation: commerce-spin 0.8s linear infinite;
}
.mobile-pane-switch {
  display: none;
}
@keyframes commerce-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes commerce-orbit {
  to {
    transform: rotate(360deg);
  }
}
@keyframes commerce-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.75);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}
@keyframes commerce-shine {
  to {
    transform: translateX(110%);
  }
}
@keyframes commerce-float {
  0%,
  100% {
    transform: translate(-50%, -60%) translateY(3px);
  }
  50% {
    transform: translate(-50%, -60%) translateY(-5px);
  }
}
@keyframes commerce-progress {
  0% {
    transform: translateX(-110%);
  }
  55% {
    transform: translateX(125%);
  }
  100% {
    transform: translateX(280%);
  }
}
@keyframes commerce-skeleton {
  to {
    background-position-x: -140%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .commerce-studio *,
  .commerce-studio *::before,
  .commerce-studio *::after {
    scroll-behavior: auto !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
:global(html.color-scheme-dark .commerce-studio) {
  --commerce-line: #303039;
  --commerce-panel: #17171c;
  --commerce-canvas: #101014;
  --commerce-soft: #222228;
  --commerce-soft-strong: #2a2a32;
  --commerce-ink: #f1f1f5;
  --commerce-muted: #a5a4b1;
  --commerce-accent: #9b87f5;
  --commerce-accent-ink: #c8bcff;
  --commerce-accent-soft: #2c263f;
  --commerce-accent-line: #514875;
  --commerce-success: #70c697;
  --commerce-warning: #e5bd78;
  --commerce-shadow-control: 0 2px 10px rgb(0 0 0 / 22%);
  --commerce-shadow-footer: 0 -10px 28px rgb(0 0 0 / 20%);
  --commerce-shadow-panel: 0 16px 40px rgb(0 0 0 / 24%);
  --commerce-shadow-result: 0 18px 44px rgb(0 0 0 / 38%);
  --commerce-shadow-card: 0 10px 28px rgb(0 0 0 / 20%);
  color-scheme: dark;
}
:global(html.color-scheme-dark .commerce-studio .settings-scroll),
:global(html.color-scheme-dark .commerce-studio .revision-panel),
:global(html.color-scheme-dark .commerce-studio .workspace-library__body),
:global(html.color-scheme-dark .commerce-studio .result-stage),
:global(html.color-scheme-dark .commerce-studio .result-strip) {
  scrollbar-color: #4b4a56 transparent;
}
:global(html.color-scheme-dark .commerce-studio input),
:global(html.color-scheme-dark .commerce-studio textarea),
:global(html.color-scheme-dark .commerce-studio select) {
  caret-color: var(--commerce-accent-ink);
}
:global(html.color-scheme-dark .commerce-studio .product-upload) {
  background: color-mix(in srgb, var(--commerce-soft) 72%, transparent);
  border-color: #44434e;
}
:global(html.color-scheme-dark .commerce-studio .canvas-source),
:global(html.color-scheme-dark .commerce-studio .canvas-target),
:global(html.color-scheme-dark .commerce-studio .asset-card) {
  border-color: #32313a;
}
:global(html.color-scheme-dark .commerce-studio .result-stage) {
  background: #111116;
}
:global(html.color-scheme-dark .commerce-studio .result-strip),
:global(html.color-scheme-dark .commerce-studio .workspace-library__header),
:global(html.color-scheme-dark .commerce-studio .result-workspace > header) {
  background: #18181e;
}
:global(html.color-scheme-dark .commerce-studio .result-stage img) {
  box-shadow: var(--commerce-shadow-result);
}
:global(html.color-scheme-dark .commerce-studio .asset-card__media) {
  background: #1d1d23;
}
:global(html.color-scheme-dark .commerce-studio .mobile-pane-switch button) {
  color: var(--commerce-muted);
}
:global(html.color-scheme-dark .commerce-studio .mobile-pane-switch button.active) {
  color: var(--commerce-accent-ink);
}
@media (max-width: 1120px) and (min-width: 861px) {
  .commerce-layout {
    grid-template-columns: 66px clamp(326px, 34vw, 370px) minmax(0, 1fr);
  }
  .commerce-workspace-title {
    min-width: 162px;
  }
  .commerce-current-mode {
    display: none;
  }
  .commerce-header__actions button {
    width: 34px;
    padding: 0;
    justify-content: center;
    font-size: 0;
  }
  .commerce-header__actions button i {
    font-size: 13px;
  }
  .canvas-flow {
    width: calc(100% - 40px);
    grid-template-columns: minmax(120px, 0.75fr) 32px minmax(150px, 1fr);
    gap: 12px;
  }
  .result-main {
    display: block;
    overflow-y: auto;
  }
  .result-stage {
    min-height: 430px;
  }
  .revision-panel {
    min-height: 390px;
    overflow: visible;
    border-top: 1px solid var(--commerce-line);
    border-left: 0;
  }
}
@media (max-width: 860px) {
  .commerce-studio {
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .commerce-header {
    z-index: 20;
    min-height: 50px;
    padding: 0 12px;
    flex: 0 0 50px;
  }
  .commerce-workspace-title {
    min-width: 0;
    flex: 1 1 auto;
  }
  .commerce-workspace-title__icon {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }
  .commerce-workspace-title small,
  .commerce-header__actions,
  .commerce-current-mode,
  .commerce-new span {
    display: none;
  }
  .mobile-pane-switch {
    z-index: 19;
    display: grid;
    height: 44px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 4px;
    background: var(--commerce-panel);
    border-bottom: 1px solid var(--commerce-line);
    flex: 0 0 44px;
  }
  .mobile-pane-switch button {
    min-width: 0;
    padding: 0 4px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    font-weight: 750;
  }
  .mobile-pane-switch button.active {
    background: var(--commerce-accent-soft);
    color: var(--commerce-accent);
  }
  .commerce-layout {
    display: block;
    height: 0;
    min-height: 0;
    overflow: hidden;
    flex: 1 1 0;
  }
  .commerce-rail {
    display: none;
  }
  .commerce-settings,
  .commerce-canvas {
    width: 100%;
    height: 100%;
    min-height: 0;
    border-right: 0;
  }
  .is-mobile-hidden {
    display: none;
  }
  .settings-scroll {
    min-height: 0;
    padding: 18px 16px 26px;
  }
  .generate-bar {
    position: relative;
    padding: 9px 16px max(9px, env(safe-area-inset-bottom));
  }
  .canvas-empty {
    justify-content: flex-start;
    padding: 28px 16px 28px;
  }
  .canvas-intro {
    width: 100%;
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 18px;
  }
  .canvas-facts {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .canvas-flow {
    width: min(480px, 100%);
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-top: 30px;
  }
  .canvas-source {
    min-height: 190px;
  }
  .canvas-flow__arrow {
    transform: rotate(90deg);
    justify-self: center;
  }
  .canvas-target {
    min-height: 250px;
  }
  .canvas-empty h1 {
    font-size: 29px;
  }
  .canvas-intro > div:first-child > p:not(.canvas-kicker) {
    max-width: 310px;
    text-align: left;
  }
  .result-main {
    display: block;
    overflow-y: auto;
  }
  .result-stage {
    min-height: 58vh;
    padding: 18px;
  }
  .result-stage.is-double,
  .result-stage.is-quad,
  .result-stage.is-multi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
  }
  .result-image-card {
    border-radius: 11px;
  }
  .result-image-tools {
    opacity: 1;
    transform: none;
  }
  .canvas-generation {
    padding: 18px 14px 22px;
  }
  .generation-status {
    grid-template-columns: 44px minmax(0, 1fr) auto;
    margin-bottom: 16px;
  }
  .generation-status > div > span,
  .generation-status button {
    font-size: 0;
  }
  .generation-status button {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
  .generation-status button i {
    font-size: 13px;
  }
  .generation-orbit {
    width: 42px;
    height: 42px;
  }
  .generation-skeletons.is-double,
  .generation-skeletons.is-quad,
  .generation-skeletons.is-multi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }
  .revision-panel {
    min-height: 410px;
    overflow: visible;
    border-top: 1px solid var(--commerce-line);
    border-left: 0;
  }
  .workspace-library {
    grid-template-rows: 64px minmax(0, 1fr);
  }
  .workspace-library__header {
    gap: 10px;
    padding: 0 14px;
  }
  .workspace-library__body {
    padding: 16px 14px 24px;
  }
  .asset-grid,
  .asset-skeleton-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .workspace-library__count {
    display: none;
  }
}
@media (max-width: 480px) {
  .commerce-new {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
  .canvas-flow {
    gap: 10px;
  }
  .canvas-source {
    min-height: 164px;
  }
  .canvas-empty h1 {
    font-size: 26px;
  }
  .result-stage {
    gap: 8px;
    padding: 12px;
  }
  .result-image-index {
    top: 6px;
    left: 6px;
  }
  .result-image-tools {
    right: 6px;
    bottom: 6px;
  }
  .result-image-tools button {
    width: 30px;
    height: 30px;
  }
  .generation-skeletons {
    gap: 8px;
  }
  .workspace-library__icon,
  .workspace-library__header small {
    display: none;
  }
  .workspace-library__header strong {
    font-size: 12px;
    white-space: nowrap;
  }
  .workspace-segment {
    grid-template-columns: repeat(2, minmax(68px, 1fr));
  }
  .workspace-segment button {
    padding: 0 6px;
  }
  .workspace-manage-link {
    width: 34px;
    padding: 0;
  }
  .workspace-manage-link span {
    display: none;
  }
}
</style>
