<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { gsap } from 'gsap'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import DeleteHistoryConfirmDialog from '@/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import CommerceSelect from '@/features/ecommerce/CommerceSelect.vue'
import CommerceProductLibrary from '@/components/ecommerce/CommerceProductLibrary.vue'
import EcommerceBriefAssistantDialog from '@/components/ecommerce/EcommerceBriefAssistantDialog.vue'
import {
  buildEcommerceGenerationPlan,
  buildEcommerceRevisionPrompt,
  ecommerceConsistencyProfile,
  ECOMMERCE_DETAIL_MODULES,
  ECOMMERCE_MODULES,
  ECOMMERCE_MODES,
  ECOMMERCE_RAIL_GROUPS,
  ECOMMERCE_RAIL_MODES,
  ECOMMERCE_REVISION_DIRECTIONS,
  ecommerceShotBlueprints,
  ecommerceModeById,
  listingShotBlueprintsFromCounts,
  filterEcommerceOutputsByMode,
  prepareEcommerceInputFiles,
  supportedEcommerceModules,
} from '@/features/ecommerce/ecommerceTools'
import { composePendingLaunchPrompt, takePendingPrompt } from '@/features/creator-hub/studioTools'
import { normalizeImageModelCapabilities } from '@/features/ai-shared/modelImageCapabilities'
import { fetchAuthenticatedMediaBlob } from '@/services/authenticatedMedia'
import { generateCommerceProductBrief } from '@/services/ecommerceApi'
import { listUserAssetGroups, listUserAssets } from '@/services/meApi'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { useAppearanceStore } from '@/stores/appearance'
import {
  animate,
  cancelAnimations,
  ms,
  prefersReducedMotion,
} from '@/lib/anime'
import listingPreviewImage from '@/assets/ecommerce/listing-preview.webp'
import detailPreviewImage from '@/assets/ecommerce/detail-preview.webp'
import tryonPreviewImage from '@/assets/ecommerce/tryon-preview.webp'
import clonePreviewImage from '@/assets/ecommerce/clone-preview.webp'

const LocalMaskEditorDialog = defineAsyncComponent(
  () => import('@/features/ai-wallpaper/components/LocalMaskEditorDialog.vue'),
)

const route = useRoute()
const router = useRouter()
const appearanceStore = useAppearanceStore()

const platformOptions = [
  'Amazon',
  '淘宝 / 天猫 / 1688',
  'Temu',
  'TikTok Shop',
  '拼多多',
  '抖音电商',
  '京东',
  'Shopify',
  '独立站',
]
const marketOptions = [
  '美国',
  '欧洲',
  '中国大陆',
  '俄罗斯',
  '东南亚',
  '英国',
  '日本',
  '德国',
  '法国',
  '西班牙',
]
const languageOptions = [
  '英文',
  '简体中文',
  '日文',
  '韩文',
  '德文',
  '法文',
  '西班牙文',
  '葡萄牙文',
  '印度尼西亚文',
  '泰文',
  '无文字',
]
const ratioOptions = [
  { value: '1:1', label: '1:1 方图' },
  { value: '4:5', label: '4:5 竖图' },
  { value: '3:4', label: '3:4 详情' },
  { value: '16:9', label: '16:9 横图' },
  { value: '9:16', label: '9:16 竖屏' },
]
const sceneOptions = ['纯色影棚', '家居生活', '自然户外', '都市街景', '科技空间', '节日氛围']
const tryonSceneOptions = [
  '纯色棚拍',
  '都市街头',
  '街角咖啡',
  '自然草坪',
  '度假海滩',
  '温馨居家',
  '艺术展馆',
]
const toneOptions = ['极简高级', '清新明亮', '真实自然', '轻奢质感', '潮流活力', '科技未来']
const campaignOptions = ['新品首发', '日常种草', '限时促销', '节日活动', '品牌宣传']
const apparelOptions = ['上装', '下装', '连衣裙', '连体服', '套装', '外套']
const modelOptions = ['东亚女性', '东亚男性', '欧美女性', '欧美男性', '南亚女性', '不限定人群']
const poseOptions = ['正面站姿', '侧身展示', '半身特写', '生活方式', '坐姿展示']
const accessoryOptions = ['包袋', '耳饰', '项链', '戒指', '腕表', '眼镜', '帽子']
const shadowOptions = ['自然接触影', '柔和投影', '悬浮阴影', '长投影', '镜面倒影']
const cloneTypeOptions = [
  { value: 'product', label: '电商商品图', icon: 'bi-bag' },
  { value: 'fashion', label: '服饰电商图', icon: 'bi-person-standing-dress' },
  { value: 'campaign', label: '营销海报', icon: 'bi-megaphone' },
  { value: 'social', label: '社媒图文', icon: 'bi-postcard' },
  { value: 'creative', label: '创意海报', icon: 'bi-palette' },
  { value: 'other', label: '其他', icon: 'bi-grid' },
]
const cloneFidelityOptions = [
  {
    value: 'style',
    label: '参考风格',
    description: '参考整体风格和结构，允许重构色彩与场景。',
  },
  {
    value: 'high',
    label: '高度复刻',
    description: '保持视觉结构，重点替换商品和用户文案。',
  },
]
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
  outputGroupSizes,
  outputAspectRatios,
  outputTimings,
  outputParents,
  outputKinds,
  historyLoading,
  historyHasMore,
  historyError,
  historyHasMoreVariants,
  initialize,
  generateBatch,
  generateMaskedEdit,
  cancelling,
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
const commerceRailScroll = ref(null)
const railAtStart = ref(true)
const railAtEnd = ref(false)
const inputFiles = ref([])
const previews = ref([])
const platform = ref('Amazon')
const market = ref('美国')
const language = ref('英文')
const productName = ref('')
const sellingPoints = ref('')
const briefAssistantOpen = ref(false)
const briefAssistantBusy = ref(false)
const briefAssistantError = ref('')
const briefDraftName = ref('')
const briefDraftSellingPoints = ref('')
const briefGenerationAttempt = ref(0)
const briefUploadKeys = new WeakMap()
let briefAssistantController = null
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
const revisionPanelOpen = ref(false)
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
const assetsErrorAppend = ref(false)
const assetTotalCount = ref(0)
const referenceImporting = ref('')
const selectedProduct = ref(null)
const applyingProduct = ref(false)
const referenceDiagnostics = ref([])
let referenceDiagnosticRun = 0
let referenceImportController = null
let assetsAbortController = null
let disposed = false
let railResizeObserver = null
const previewOpen = ref(false)
const previewSource = ref('')
const maskEditorOpen = ref(false)
const maskEditorSource = ref('')
const loadedOutputs = ref(new Set())
const removingOutputs = ref(new Set())
const deleteCandidate = ref('')
const textStabilityEnabled = ref(true)
const listingStructureMode = ref('smart')
const listingStructureCounts = ref({ white: 1, scene: 2, selling: 2, other: 2 })
const cloneType = ref('product')
const cloneFidelity = ref('style')
let motionContext = null
const railMotionTargets = new Set()

const outputCountOptions = computed(() =>
  Array.from({ length: maxOutputCount.value }, (_, index) => ({
    value: index + 1,
    label: `${index + 1} 张`,
  })),
)
const modelSelectOptions = computed(() =>
  models.value.map((model) => ({ value: model.id, label: model.label })),
)
const currentGroupId = computed(() => {
  const current = currentOutput.value
  return current ? outputGroups.value[current] || '' : ''
})
const currentGroupOutputs = computed(() => {
  const current = currentOutput.value
  if (!current) return []
  const groupId = currentGroupId.value
  const group = groupId
    ? modeOutputs.value.filter((url) => outputGroups.value[url] === groupId)
    : [current]
  return [...new Set(group)].sort(
    (left, right) =>
      (Number(outputGroupIndexes.value[left]) || 0) -
      (Number(outputGroupIndexes.value[right]) || 0),
  )
})
const currentGroupSlots = computed(() => {
  const outputsInGroup = currentGroupOutputs.value
  if (!outputsInGroup.length) return []
  const indexed = new Map(
    outputsInGroup.map((url, fallbackIndex) => {
      const storedIndex = Number(outputGroupIndexes.value[url])
      const index = Number.isFinite(storedIndex) ? Math.max(0, storedIndex) : fallbackIndex
      return [index, url]
    }),
  )
  const highestIndex = indexed.size ? Math.max(...indexed.keys()) : -1
  const expectedSize = Math.max(
    outputsInGroup.length,
    highestIndex + 1,
    Number(outputGroupSizes.value[currentGroupId.value]) || 0,
  )
  return Array.from({ length: expectedSize }, (_, index) => indexed.get(index) || '')
})
const resultLayoutClass = computed(() => {
  const count = currentGroupSlots.value.length
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
const modePreview = computed(() => {
  if (activeMode.value.id === 'detail') {
    return {
      src: detailPreviewImage,
      label: '详情页案例预览',
      title: '从商品多角度图到完整详情视觉',
      description: '上传商品多角度图，生成符合目标平台规范的完整详情页视觉。',
      cta: '上传商品图开始',
      tags: ['01 商品原图', '02 详情长图', '03 主视觉', '04 功能细节', '05 使用场景'],
    }
  }
  if (['tryon', 'handheld', 'accessory'].includes(activeMode.value.id)) {
    return {
      src: tryonPreviewImage,
      label: '服饰穿戴案例预览',
      title: '同一服装、同一模特、同场景多姿势',
      description: '上传服装并选择模特形象，生成同场景、多姿势的成套实拍图。',
      cta: '上传服装开始',
      tags: ['01 服装原图', '02 正面展示', '03 动态全身', '04 面料特写'],
    }
  }
  if (activeMode.value.id === 'clone') {
    return {
      src: clonePreviewImage,
      label: '爆款复刻案例预览',
      title: '继承成熟视觉结构，替换为你的商品',
      description: '上传爆款参考图，可选上传新商品，批量复刻构图、场景与视觉节奏。',
      cta: '上传爆款参考图',
      tags: ['01 爆款参考', '02 新商品', '03 场景迁移', '04 整套复刻'],
    }
  }
  return {
    src: listingPreviewImage,
    label: '商品套图案例预览',
    title: '一张商品图，生成统一完整的上架套图',
    description: '上传商品图，生成符合目标平台规范的主图、场景、细节和卖点套图。',
    cta: '上传商品图开始',
    tags: ['01 合规主图', '02 场景展示', '03 模特场景', '04 细节说明', '05 卖点图'],
  }
})
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
const activeModeFields = computed(() => new Set(activeMode.value.fields || []))
const activeModuleOptions = computed(() =>
  activeMode.value.id === 'detail' ? ECOMMERCE_DETAIL_MODULES : ECOMMERCE_MODULES,
)
const selectedModuleDetails = computed(() =>
  supportedEcommerceModules(selectedModules.value, inputFiles.value.length),
)
const listingCustomBlueprints = computed(() =>
  listingShotBlueprintsFromCounts(listingStructureCounts.value),
)
const listingCustomCount = computed(() => listingCustomBlueprints.value.length)
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
    !applyingProduct.value &&
    !referenceImporting.value &&
    !running.value,
)
const canGenerate = computed(
  () =>
    inputFiles.value.length >= minimumFiles.value &&
    (!activeModeFields.value.has('modules') || selectedModuleDetails.value.length > 0) &&
    (activeMode.value.id !== 'listing' ||
      listingStructureMode.value !== 'custom' ||
      listingCustomCount.value === 7) &&
    Boolean(modelId.value) &&
    !consistencyCapacityError.value &&
    !applyingProduct.value &&
    !referenceImporting.value &&
    !running.value,
)
const availableShotBlueprints = computed(() => {
  if (activeMode.value.id === 'listing' && listingStructureMode.value === 'custom') {
    return listingCustomBlueprints.value
  }
  return ecommerceShotBlueprints(activeMode.value.id, selectedModules.value)
})
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
  if (activeModeFields.value.has('modules') && !selectedModuleDetails.value.length) {
    return { ready: false, label: '请选择视觉模块' }
  }
  if (
    activeMode.value.id === 'listing' &&
    listingStructureMode.value === 'custom' &&
    listingCustomCount.value !== 7
  ) {
    return {
      ready: false,
      label:
        listingCustomCount.value < 7
          ? `还需分配 ${7 - listingCustomCount.value} 张套图`
          : `请减少 ${listingCustomCount.value - 7} 张套图`,
    }
  }
  if (requiresBrief.value && sellingPoints.value.trim().length < 4) {
    return { ready: true, label: '可生成；补充核心卖点会更准确' }
  }
  return { ready: true, label: '配置完成，可以生成' }
})

function setListingStructureMode(mode) {
  listingStructureMode.value = mode
  if (mode !== 'smart') return
  selectedModules.value = ECOMMERCE_MODULES.filter((item) => item.value !== 'angles').map(
    (item) => item.value,
  )
  outputCount.value = Math.min(7, activeMode.value.maxCount)
}

function adjustListingStructure(key, delta) {
  const current = Number(listingStructureCounts.value[key]) || 0
  const total = listingCustomCount.value
  if (delta > 0 && total >= 7) return
  const minimum = key === 'white' ? 1 : 0
  const next = Math.max(minimum, Math.min(7, current + delta))
  listingStructureCounts.value = { ...listingStructureCounts.value, [key]: next }
}

function internalReferenceKey(file) {
  const source = String(file?.sourceUrl || '').trim()
  if (!source) return ''
  try {
    const pathname = new URL(source, window.location.origin).pathname
    const prefix = '/api/v1/files/'
    return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : ''
  } catch {
    return ''
  }
}

async function productBriefInputKeys(signal) {
  return Promise.all(
    inputFiles.value.slice(0, 4).map(async (file) => {
      const internalKey = internalReferenceKey(file)
      if (internalKey) return internalKey
      const cached = briefUploadKeys.get(file)
      if (cached) return cached
      const uploaded = await uploadFile(file, { signal })
      briefUploadKeys.set(file, uploaded.key)
      return uploaded.key
    }),
  )
}

function openProductBriefAssistant() {
  if (!inputFiles.value.length) {
    notificationService.info('请先上传商品参考图，再使用 AI 生成名称和卖点')
    return
  }
  briefAssistantOpen.value = true
  briefAssistantError.value = ''
  briefDraftName.value = ''
  briefDraftSellingPoints.value = ''
  briefGenerationAttempt.value = 0
  void generateProductBriefDraft()
}

async function generateProductBriefDraft() {
  if (briefAssistantBusy.value || !inputFiles.value.length) return
  briefAssistantController?.abort()
  const controller = new AbortController()
  briefAssistantController = controller
  briefAssistantBusy.value = true
  briefAssistantError.value = ''
  try {
    const inputKeys = await productBriefInputKeys(controller.signal)
    const result = await generateCommerceProductBrief(
      {
        inputKeys,
        platform: platform.value,
        market: market.value,
        language: language.value,
        previousProductName: briefGenerationAttempt.value ? briefDraftName.value : '',
        previousSellingPoints: briefGenerationAttempt.value
          ? briefDraftSellingPoints.value
          : '',
      },
      { signal: controller.signal },
    )
    if (controller.signal.aborted) return
    briefDraftName.value = String(result?.productName || '').trim()
    briefDraftSellingPoints.value = String(result?.sellingPoints || '').trim()
    briefGenerationAttempt.value += 1
  } catch (error) {
    if (error?.name !== 'AbortError') {
      briefAssistantError.value = error?.message || 'AI 商品识别失败，请重试'
    }
  } finally {
    if (briefAssistantController === controller) briefAssistantController = null
    briefAssistantBusy.value = false
  }
}

function closeProductBriefAssistant() {
  if (briefAssistantBusy.value) return
  briefAssistantOpen.value = false
}

function confirmProductBrief() {
  const name = briefDraftName.value.trim()
  const points = briefDraftSellingPoints.value.trim()
  if (!name || !points) return
  productName.value = name
  sellingPoints.value = points
  briefAssistantOpen.value = false
  notificationService.success('AI 生成内容已填入，可继续编辑')
}

watch(
  activeMode,
  (mode) => {
    const requestedMode = String(route.query.tool || '')
    if (requestedMode && requestedMode !== mode.id) {
      router.replace({ path: '/ecommerce-design', query: { tool: mode.id } })
    }
    aspectRatio.value = mode.ratio
    outputCount.value =
      mode.id === 'listing' && listingStructureMode.value === 'smart'
        ? Math.min(7, mode.maxCount)
        : Math.min(outputCount.value, mode.maxCount)
    if (mode.maxCount > 1 && outputCount.value < 1) outputCount.value = 1
    localError.value = ''
    if (mode.id === 'tryon' && !tryonSceneOptions.includes(sceneStyle.value)) {
      sceneStyle.value = tryonSceneOptions[0]
    }
  },
  { immediate: true },
)

watch(maxOutputCount, (maximum) => {
  if (outputCount.value > maximum) outputCount.value = maximum
})

watch(listingCustomCount, (count) => {
  if (activeMode.value.id === 'listing' && listingStructureMode.value === 'custom') {
    outputCount.value = count
  }
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

function railMotionEnabled() {
  return (
    !disposed
    && !prefersReducedMotion()
    && !document.documentElement.classList.contains('settings-no-animations')
  )
}

function updateRailEdgeState(event) {
  const scroll = event?.currentTarget || commerceRailScroll.value
  if (!scroll) return
  const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
  railAtStart.value = scroll.scrollTop <= 2
  railAtEnd.value = maxScroll <= 2 || scroll.scrollTop >= maxScroll - 2
}

function scrollActiveRailIntoView({ smooth = true } = {}) {
  const scroll = commerceRailScroll.value
  if (!scroll) return
  const active = scroll.querySelector('button.active')
  if (!active) return
  const reduceMotion =
    prefersReducedMotion() || document.documentElement.classList.contains('settings-no-animations')
  active.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: smooth && !reduceMotion ? 'smooth' : 'auto',
  })
  requestAnimationFrame(() => updateRailEdgeState())
}

function railIconFromEvent(event) {
  return event?.currentTarget?.querySelector?.('.commerce-rail__icon') || null
}

function animateRailTabHover(event, entering) {
  const icon = railIconFromEvent(event)
  if (!icon || !railMotionEnabled()) return
  railMotionTargets.add(icon)
  cancelAnimations(icon)
  animate(icon, {
    scale: entering ? 1.04 : 1,
    translateY: entering ? -0.5 : 0,
    duration: ms(entering ? 0.2 : 0.16),
    ease: 'outQuad',
    onComplete: () => {
      if (entering) return
      icon.style.removeProperty('transform')
      icon.style.removeProperty('translate')
      icon.style.removeProperty('scale')
      railMotionTargets.delete(icon)
    },
  })
}

function selectRailMode(mode, event) {
  const icon = railIconFromEvent(event)
  if (icon && railMotionEnabled()) {
    railMotionTargets.add(icon)
    cancelAnimations(icon)
    animate(icon, {
      scale: [
        { to: 0.95, duration: ms(0.08), ease: 'inQuad' },
        { to: 1.04, duration: ms(0.14), ease: 'outBack(1.4)' },
        { to: 1, duration: ms(0.16), ease: 'outQuad' },
      ],
      onComplete: () => {
        icon.style.removeProperty('transform')
        icon.style.removeProperty('scale')
        railMotionTargets.delete(icon)
      },
    })
  }
  setActiveMode(mode)
}

async function applyCommerceProduct(product) {
  if (!product || running.value || applyingProduct.value) return
  applyingProduct.value = true
  selectedProduct.value = product
  try {
    releasePreviews()
    inputFiles.value = []
    previews.value = []
    referenceDiagnosticRun += 1
    referenceDiagnostics.value = []
    productName.value = product.title || ''
    sellingPoints.value = product.sellingPoints || ''
    if (product.platform) platform.value = product.platform
    if (product.market) market.value = product.market
    if (product.language) language.value = product.language
    const productAssets = Array.isArray(product.assets) ? product.assets.slice(0, 6) : []
    let importedCount = 0
    for (const asset of productAssets) {
      const imported = await useRemoteImageAsReference({
        id: `product:${product.id}:${asset.id}`,
        url: asset.url,
        title: asset.title || product.title,
        origin: 'product',
      })
      if (disposed) return
      if (imported) importedCount += 1
    }
    if (!importedCount) {
      selectedProduct.value = null
      notificationService.error('商品参考图读取失败，请重试')
      return
    }
    if (importedCount < productAssets.length) {
      notificationService.warning(`已载入 ${importedCount}/${productAssets.length} 张商品参考图`)
    }
    workspaceView.value = 'result'
    activeMobilePane.value = 'settings'
    notificationService.success(`已载入商品「${product.title}」，可以开始生成`)
  } finally {
    applyingProduct.value = false
  }
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

function commerceProductSnapshot(product) {
  if (!product?.id) return null
  return {
    id: product.id,
    sku: product.sku || '',
    title: product.title || '',
    brand: product.brand || '',
    category: product.category || '',
    sellingPoints: product.sellingPoints || '',
    targetAudience: product.targetAudience || '',
    material: product.material || '',
    color: product.color || '',
    dimensions: product.dimensions || '',
    platform: product.platform || '',
    market: product.market || '',
    language: product.language || '',
    assetIds: Array.isArray(product.assetIds) ? [...product.assetIds] : [],
    protectedElements: Array.isArray(product.protectedElements)
      ? [...product.protectedElements]
      : [],
  }
}

async function openWorkspaceView(view) {
  if (disposed) return
  if (running.value && view !== 'result') {
    notificationService.info('任务生成中，请先停止任务后再切换工作区')
    return
  }
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
  if (disposed || running.value || referenceImporting.value) return false
  if (inputFiles.value.length >= 6) {
    notificationService.info('参考图已达 6 张上限，请先移除一张')
    return false
  }
  const source = String(url || '').trim()
  if (!source) {
    notificationService.error('这张图片暂时无法读取')
    return false
  }
  referenceImporting.value = String(id || source)
  const controller = new AbortController()
  referenceImportController = controller
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const blob = await fetchAuthenticatedMediaBlob(source, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (disposed) return false
    const blobType = String(blob.type || '').toLowerCase()
    if (blobType && !['image/png', 'image/jpeg', 'image/webp'].includes(blobType)) {
      throw new Error('读取到的不是支持的商品图片')
    }
    const fileType = blobType || 'image/jpeg'
    const extension = fileType.includes('png') ? 'png' : fileType.includes('webp') ? 'webp' : 'jpg'
    const filename = `${safeReferenceName(title, origin === 'history' ? '电商历史' : '个人素材')}-${Date.now()}.${extension}`
    const file = new File([blob], filename, { type: fileType, lastModified: Date.now() })
    // 保留站内原始地址。提交时可直接复用已有对象 key，避免下载后再上传
    // 导致额外压缩、R2 写入失败以及参考图在进入模型前失真。
    Object.defineProperty(file, 'sourceUrl', {
      value: source,
      configurable: true,
    })
    const before = inputFiles.value.length
    addFiles([file], { preserveProduct: origin === 'product' })
    if (inputFiles.value.length > before) {
      workspaceView.value = 'result'
      activeMobilePane.value = 'settings'
      notificationService.success('已加入当前任务参考图')
      return true
    }
    return false
  } catch (error) {
    notificationService.error(
      error?.name === 'AbortError' ? '参考图读取超时，请重试' : error?.message || '参考图读取失败',
    )
    return false
  } finally {
    window.clearTimeout(timeout)
    if (referenceImportController === controller) referenceImportController = null
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
  if (disposed) return
  if (append) {
    if (assetsLoadingMore.value || !assetsCursor.value) return
    assetsLoadingMore.value = true
  } else {
    if (assetsLoading.value) return
    assetsLoading.value = true
    assetsError.value = ''
    assetsErrorAppend.value = false
  }
  assetsAbortController?.abort()
  briefAssistantController?.abort()
  const controller = new AbortController()
  assetsAbortController = controller
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 20_000)
  try {
    const requests = [
      listUserAssets({
        limit: 24,
        cursor: append ? assetsCursor.value || '' : '',
        groupId: assetFilter.value,
        signal: controller.signal,
      }),
    ]
    if (!append && !assetGroups.value.length) {
      requests.push(listUserAssetGroups({ signal: controller.signal }).catch(() => null))
    }
    const [assetResult, groupResult] = await Promise.all(requests)
    if (disposed) return
    assets.value = append ? [...assets.value, ...assetResult.items] : assetResult.items
    assetsCursor.value = assetResult.nextCursor
    if (groupResult) {
      assetGroups.value = groupResult.items
      assetTotalCount.value = groupResult.totalAssetCount
    }
    assetsLoaded.value = true
    assetsError.value = ''
    assetsErrorAppend.value = false
  } catch (error) {
    if (disposed) return
    if (error?.name === 'AbortError' && !timedOut) return
    assetsError.value = timedOut ? '素材库读取超时，请重试' : error?.message || '素材库读取失败'
    assetsErrorAppend.value = append
  } finally {
    window.clearTimeout(timeout)
    assetsLoading.value = false
    assetsLoadingMore.value = false
  }
}

function retryAssetsLoad() {
  return assetsErrorAppend.value ? loadAssetsWorkspace({ append: true }) : refreshAssets()
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

function inspectReferenceFile(file, index) {
  return new Promise((resolve) => {
    const source = URL.createObjectURL(file)
    const image = new Image()
    let timer = 0
    let settled = false
    const finish = (width = 0, height = 0) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      URL.revokeObjectURL(source)
      const longSide = Math.max(width, height)
      const issues = []
      if (!width || !height) {
        issues.push('无法读取尺寸')
      } else if (longSide < 512) {
        issues.push('分辨率过低')
      } else if (longSide < 1024) {
        issues.push('建议使用更高清原图')
      }
      resolve({
        index,
        name: file.name || `参考图 ${index + 1}`,
        width,
        height,
        level: issues.some((item) => item === '分辨率过低')
          ? 'error'
          : issues.length
            ? 'warn'
            : 'ok',
        message: issues.join('、') || `${width} × ${height}`,
      })
    }
    timer = window.setTimeout(() => finish(), 8000)
    image.onload = () => finish(image.naturalWidth || 0, image.naturalHeight || 0)
    image.onerror = () => finish()
    image.src = source
  })
}

async function refreshReferenceDiagnostics() {
  const run = ++referenceDiagnosticRun
  const files = [...inputFiles.value]
  if (!files.length) {
    referenceDiagnostics.value = []
    return
  }
  const diagnostics = await Promise.all(
    files.map((file, index) => inspectReferenceFile(file, index)),
  )
  if (!disposed && run === referenceDiagnosticRun) referenceDiagnostics.value = diagnostics
}

function addFiles(fileList, { preserveProduct = false } = {}) {
  if (disposed || running.value) return
  localError.value = ''
  const prepared = prepareEcommerceInputFiles(inputFiles.value, fileList)
  if (prepared.invalidCount && !prepared.next.length) {
    localError.value = '仅支持 PNG、JPG 和 WebP 图片'
    return
  }
  if (prepared.oversized) {
    notificationService.warning(
      prepared.oversizedCount > 1
        ? `已忽略 ${prepared.oversizedCount} 张超过 10MB 的图片`
        : '已忽略超过 10MB 的图片',
    )
  }
  const next = prepared.next
  if (!next.length) return
  if (!preserveProduct && !applyingProduct.value && next.length) selectedProduct.value = null
  inputFiles.value = [...inputFiles.value, ...next]
  previews.value = [
    ...previews.value,
    ...next.map((file) => ({ file, url: URL.createObjectURL(file) })),
  ]
  void refreshReferenceDiagnostics()
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
  selectedProduct.value = null
  void refreshReferenceDiagnostics()
}

function referenceLabel(index) {
  return activeMode.value.referenceLabels?.[index] || `角度 ${index + 1}`
}

function clearSelectedProduct() {
  selectedProduct.value = null
}

const assembledPrompt = computed(() => {
  const modules = selectedModuleDetails.value.map((item) => item.label).join('、')
  const lines = [
    `任务：${activeMode.value.label}。${activeMode.value.prompt}`,
    `商品名称：${productName.value.trim() || '根据商品图片准确识别，不虚构品牌和型号'}。`,
    selectedProduct.value?.brand
      ? `商品品牌：${selectedProduct.value.brand}。不得替换或虚构品牌。`
      : '',
    selectedProduct.value?.category ? `商品类目：${selectedProduct.value.category}。` : '',
    selectedProduct.value?.targetAudience
      ? `目标人群：${selectedProduct.value.targetAudience}。`
      : '',
    selectedProduct.value?.material ? `商品材质：${selectedProduct.value.material}。` : '',
    selectedProduct.value?.color ? `商品颜色：${selectedProduct.value.color}。` : '',
    selectedProduct.value?.dimensions ? `商品规格：${selectedProduct.value.dimensions}。` : '',
    sellingPoints.value.trim() ? `商品卖点与要求：${sellingPoints.value.trim()}。` : '',
    selectedProduct.value?.protectedElements?.length
      ? `商品必须保持的细节：${selectedProduct.value.protectedElements.join('、')}。这些细节优先于创意变化。`
      : '',
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
    activeMode.value.id === 'clone'
      ? `复刻类型：${cloneTypeOptions.find((item) => item.value === cloneType.value)?.label || '电商商品图'}。`
      : '',
    activeMode.value.id === 'clone'
      ? `复刻程度：${cloneFidelity.value === 'high' ? '高度复刻视觉结构并替换商品与文案' : '参考整体风格并重构场景'}。`
      : '',
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
    shotBlueprints:
      activeMode.value.id === 'listing' && listingStructureMode.value === 'custom'
        ? listingCustomBlueprints.value
        : null,
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
    consistencyStrategy: 'identity-first-anchor-then-parallel',
    consistencyProfile: consistencyProfile.value.id,
    commerceProductId: selectedProduct.value?.id || '',
    commerceProductSnapshot: commerceProductSnapshot(selectedProduct.value),
    referenceRoles: consistencyProfile.value.roles,
    essentialReferenceCount: consistencyProfile.value.essentialReferenceCount,
    preserveSourceCanvas: activeMode.value.id === 'outpaint',
  }))
  const result = await generateBatch(generationItems, {
    files: inputFiles.value,
    concurrency: Math.min(generationItems.length, 4),
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
        commerceProductId: selectedProduct.value?.id || '',
        commerceProductSnapshot: commerceProductSnapshot(selectedProduct.value),
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
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const blob = await fetchAuthenticatedMediaBlob(url, {
      cache: 'no-store',
      signal: controller.signal,
    })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    const extension = blob.type.includes('png')
      ? 'png'
      : blob.type.includes('webp')
        ? 'webp'
        : 'jpg'
    anchor.download = `ecommerce-${activeMode.value.id}-${Date.now()}.${extension}`
    document.body.appendChild(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove()
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (error) {
    notificationService.error(
      error?.name === 'AbortError' ? '下载超时，请重试' : error?.message || '下载失败',
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

function requestOutputRemoval(url) {
  const target = String(url || '').trim()
  if (!target || removingOutputs.value.has(target)) return
  deleteCandidate.value = target
}

function closeOutputRemoval() {
  if (!removingOutputs.value.has(deleteCandidate.value)) deleteCandidate.value = ''
}

async function confirmOutputRemoval() {
  const removed = await removeOutput(deleteCandidate.value, { cascade: true })
  if (removed) deleteCandidate.value = ''
}

async function removeOutput(url, options = {}) {
  const target = String(url || '').trim()
  if (!target || removingOutputs.value.has(target)) return false
  removingOutputs.value = new Set([...removingOutputs.value, target])
  try {
    await deleteOutput(target, options)
    notificationService.success('生成记录已删除')
    return true
  } catch (error) {
    notificationService.error(historyDeleteErrorMessage(error))
    return false
  } finally {
    const next = new Set(removingOutputs.value)
    next.delete(target)
    removingOutputs.value = next
  }
}

function historyDeleteErrorMessage(error) {
  const code = String(error?.code || '').trim()
  const status = Number(error?.status || 0)
  if (code === 'task_in_use') {
    return '这张图片已被后续版本使用，请先删除最新版本，再按版本倒序删除。'
  }
  if (code === 'task_not_cancelable') {
    return '任务仍在生成中，暂时不能删除。请先停止生成，或等待任务完成后再删除。'
  }
  if (code === 'task_not_found' || status === 404) {
    return '这条历史记录已经不存在，请刷新历史列表。'
  }
  if (code === 'auth_required' || status === 401) {
    return '登录状态已失效，请重新登录后再删除。'
  }
  if (code === 'network_error' || status === 0) {
    return '网络连接失败，记录未删除，请检查网络后重试。'
  }
  return '暂时无法删除这条记录，记录已保留，请稍后重试。'
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
    commerceProductId: selectedProduct.value?.id || '',
    commerceProductSnapshot: commerceProductSnapshot(selectedProduct.value),
    consistencyStrategy: 'revision-anchor-with-original-identity',
    consistencyProfile: consistencyProfile.value.id,
    referenceRoles: ['当前成品', ...consistencyProfile.value.roles],
    essentialReferenceCount: consistencyProfile.value.essentialReferenceCount,
  })
  if (generated?.length) {
    activeOutput.value = generated[0]
    notificationService.success('局部编辑完成，原图和新版本均已保留')
  }
}

function runScopedMotion(callback) {
  if (disposed || !motionContext || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return
  motionContext.add(callback)
}

function animateCanvasView() {
  nextTick(() => {
    const target = canvasPanel.value?.firstElementChild
    if (!target) return
    runScopedMotion(() => {
      gsap.fromTo(
        target,
        { opacity: 0, y: 14, scale: 0.988 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.42,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
        },
      )
      const stageImage = target.querySelector?.('.showcase-demo__stage img')
      if (stageImage) {
        gsap.fromTo(
          stageImage,
          { scale: 1.05 },
          { scale: 1, duration: 0.8, ease: 'power2.out', clearProps: 'transform' },
        )
      }
      const tags = target.querySelectorAll?.('.showcase-demo__tag')
      if (tags?.length) {
        gsap.fromTo(
          tags,
          { opacity: 0, y: 6, scale: 0.96 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.32,
            stagger: 0.045,
            delay: 0.1,
            ease: 'power2.out',
            clearProps: 'transform,opacity',
          },
        )
      }
    })
  })
}

async function initializeWorkspace() {
  const pending = takePendingPrompt('ecommerce_design')
  const launchConfig = pending?.config || {}
  if (launchConfig.skill && ecommerceModeById(launchConfig.skill).id !== activeMode.value.id) {
    await router.replace({ path: '/ecommerce-design', query: { tool: launchConfig.skill } })
  }
  await initialize()
  if (disposed) return
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
watch(activeMode, () => {
  animateCanvasView()
  nextTick(() => scrollActiveRailIntoView({ smooth: true }))
})
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
          { opacity: 0, y: 10, scale: 0.9 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.4,
            stagger: 0.05,
            ease: 'back.out(1.45)',
            clearProps: 'transform,opacity',
          },
        ),
      )
    })
  },
)
onMounted(async () => {
  await nextTick()
  if (disposed) return
  updateRailEdgeState()
  scrollActiveRailIntoView({ smooth: false })
  if (typeof ResizeObserver !== 'undefined' && commerceRailScroll.value) {
    railResizeObserver = new ResizeObserver(() => {
      if (disposed) return
      updateRailEdgeState()
    })
    railResizeObserver.observe(commerceRailScroll.value)
  }
  if (commerceRoot.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    motionContext = gsap.context(() => {
      // Opacity-only on atmosphere so layout panels never stay visibility:hidden.
      gsap.fromTo(
        '.commerce-atmosphere__glow',
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.7, stagger: 0.08, ease: 'power2.out' },
      )
      gsap.fromTo(
        ['.commerce-header', '.commerce-rail', '.commerce-settings', '.commerce-canvas'],
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.42,
          stagger: 0.04,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
        },
      )
      gsap.fromTo(
        '.commerce-rail__scroll > button, .commerce-rail__scroll > a',
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.018,
          delay: 0.1,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        },
      )
    }, commerceRoot.value)
  }
  await initializeWorkspace()
  if (!disposed) {
    await nextTick()
    scrollActiveRailIntoView({ smooth: false })
    updateRailEdgeState()
  }
})
onBeforeUnmount(() => {
  disposed = true
  railResizeObserver?.disconnect()
  railResizeObserver = null
  motionContext?.revert()
  motionContext = null
  cancelAnimations([...railMotionTargets])
  railMotionTargets.clear()
  referenceImportController?.abort()
  assetsAbortController?.abort()
  releasePreviews()
})
</script>

<template>
  <main ref="commerceRoot" class="commerce-studio">
    <div class="commerce-atmosphere" aria-hidden="true">
      <span class="commerce-atmosphere__glow commerce-atmosphere__glow--a"></span>
      <span class="commerce-atmosphere__glow commerce-atmosphere__glow--b"></span>
      <span class="commerce-atmosphere__grain"></span>
    </div>

    <header class="commerce-header">
      <div class="commerce-header__brand">
        <span class="commerce-header__badge" aria-hidden="true">
          <i class="bi" :class="activeMode.icon"></i>
        </span>
        <div class="commerce-header__copy">
          <em>AI 电商</em>
          <strong>{{ activeMode.label }}</strong>
        </div>
      </div>
      <div class="commerce-header__actions" role="tablist" aria-label="工作区">
        <button
          type="button"
          role="tab"
          :class="{ active: workspaceView === 'result' }"
          :aria-selected="workspaceView === 'result'"
          @click="openWorkspaceView('result')"
        >
          <i class="bi bi-easel2"></i>生成结果
        </button>
        <button
          type="button"
          role="tab"
          :class="{ active: workspaceView === 'history' }"
          :aria-selected="workspaceView === 'history'"
          :disabled="running"
          @click="openWorkspaceView('history')"
        >
          <i class="bi bi-clock-history"></i>电商历史
        </button>
        <button
          type="button"
          role="tab"
          :class="{ active: workspaceView === 'assets' }"
          :aria-selected="workspaceView === 'assets'"
          :disabled="running"
          @click="openWorkspaceView('assets')"
        >
          <i class="bi bi-collection"></i>资产与素材
        </button>
        <button
          type="button"
          role="tab"
          :class="{ active: workspaceView === 'products' }"
          :aria-selected="workspaceView === 'products'"
          :disabled="running"
          @click="openWorkspaceView('products')"
        >
          <i class="bi bi-box-seam"></i>商品库
        </button>
        <span class="commerce-cost"><i class="bi bi-coin"></i>{{ costLabel }}</span>
      </div>
    </header>

    <div class="mobile-pane-switch" role="tablist" aria-label="工作区切换">
      <button
        type="button"
        role="tab"
        :class="{ active: activeMobilePane === 'settings' }"
        :aria-selected="activeMobilePane === 'settings'"
        @click="activeMobilePane = 'settings'"
      >
        参数设置
      </button>
      <button
        type="button"
        role="tab"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'result' }"
        :aria-selected="activeMobilePane === 'canvas' && workspaceView === 'result'"
        @click="openWorkspaceView('result')"
      >
        生成结果
      </button>
      <button
        type="button"
        role="tab"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'history' }"
        :aria-selected="activeMobilePane === 'canvas' && workspaceView === 'history'"
        :disabled="running"
        @click="openWorkspaceView('history')"
      >
        历史
      </button>
      <button
        type="button"
        role="tab"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'assets' }"
        :aria-selected="activeMobilePane === 'canvas' && workspaceView === 'assets'"
        :disabled="running"
        @click="openWorkspaceView('assets')"
      >
        素材
      </button>
      <button
        type="button"
        role="tab"
        :class="{ active: activeMobilePane === 'canvas' && workspaceView === 'products' }"
        :aria-selected="activeMobilePane === 'canvas' && workspaceView === 'products'"
        :disabled="running"
        @click="openWorkspaceView('products')"
      >
        商品库
      </button>
    </div>

    <nav
      v-if="activeMobilePane === 'settings'"
      class="mobile-tool-switch"
      aria-label="选择电商设计工具"
    >
      <button
        v-for="mode in ECOMMERCE_RAIL_MODES"
        :key="mode.id"
        type="button"
        :class="{ active: mode.id === activeMode.id }"
        :disabled="running"
        @click="setActiveMode(mode)"
      >
        <i class="bi" :class="mode.icon"></i>
        <span>{{ mode.shortLabel || mode.label }}</span>
      </button>
    </nav>

    <div class="commerce-layout">
      <nav
        class="commerce-rail"
        :class="{ 'is-at-start': railAtStart, 'is-at-end': railAtEnd }"
        aria-label="电商设计工具"
      >
        <div ref="commerceRailScroll" class="commerce-rail__scroll" @scroll="updateRailEdgeState">
          <template v-for="(group, groupIndex) in ECOMMERCE_RAIL_GROUPS" :key="group.id">
            <div
              v-if="groupIndex > 0"
              class="commerce-rail__rule"
              role="separator"
              :aria-label="group.label"
            ></div>
            <button
              v-for="mode in group.items"
              :key="mode.id"
              type="button"
              :class="{ active: mode.id === activeMode.id }"
              :aria-label="mode.label"
              :aria-current="mode.id === activeMode.id ? 'page' : undefined"
              :title="`${mode.label}：${mode.tagline}`"
              :disabled="running"
              @mouseenter="animateRailTabHover($event, true)"
              @mouseleave="animateRailTabHover($event, false)"
              @click="selectRailMode(mode, $event)"
            >
              <span class="commerce-rail__icon" aria-hidden="true">
                <i class="bi" :class="mode.icon"></i>
              </span>
              <span class="commerce-rail__label">{{ mode.shortLabel || mode.label }}</span>
            </button>
          </template>
        </div>
      </nav>

      <aside
        class="commerce-settings"
        :class="{ 'is-mobile-hidden': activeMobilePane !== 'settings' }"
      >
        <div class="settings-scroll">
          <section class="settings-section">
            <div class="settings-heading settings-heading--source">
              <h2>
                {{ activeMode.uploadTitle || '商品原图' }}
                <i
                  class="bi bi-question-circle"
                  :title="activeMode.uploadHint || '同一商品可上传多个角度'"
                ></i>
              </h2>
            </div>
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
                    :aria-label="`移除${referenceLabel(index)}参考图`"
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
                  aria-label="继续添加参考图"
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
            <div v-if="activeMode.referenceLabels?.length" class="upload-role-guide">
              <span v-for="(label, index) in activeMode.referenceLabels.slice(0, 2)" :key="label">
                <b>{{ index + 1 }}</b>
                <span
                  ><strong>{{ label }}</strong
                  ><small>{{ index < minimumFiles ? '必填' : '可选' }}</small></span
                >
              </span>
            </div>
          </section>

          <div v-if="referenceDiagnostics.length" class="reference-diagnostics" aria-live="polite">
            <div class="reference-diagnostics__header">
              <span><i class="bi bi-shield-check"></i>素材预检</span>
              <small>生成前检查</small>
            </div>
            <div class="reference-diagnostics__list">
              <span
                v-for="item in referenceDiagnostics"
                :key="`${item.index}-${item.name}`"
                :class="item.level"
                :title="item.name"
              >
                <i
                  class="bi"
                  :class="
                    item.level === 'ok'
                      ? 'bi-check-circle-fill'
                      : item.level === 'error'
                        ? 'bi-exclamation-octagon-fill'
                        : 'bi-exclamation-triangle-fill'
                  "
                ></i>
                {{ referenceLabel(item.index) }} · {{ item.message }}
              </span>
            </div>
          </div>

          <button
            v-if="selectedProduct"
            type="button"
            class="selected-product-context"
            @click="openWorkspaceView('products')"
          >
            <span><i class="bi bi-box-seam"></i></span>
            <span>
              <small>当前商品</small>
              <strong>{{ selectedProduct.title }}</strong>
            </span>
            <i class="bi bi-chevron-right"></i>
          </button>

          <section class="settings-section">
            <div class="settings-heading">
              <h2>生成设置</h2>
            </div>
            <div
              v-if="
                activeModeFields.has('platform') ||
                activeModeFields.has('market') ||
                activeModeFields.has('language')
              "
              class="select-row"
            >
              <label v-if="activeModeFields.has('platform')"
                ><span>平台</span
                ><CommerceSelect
                  v-model="platform"
                  :options="platformOptions"
                  aria-label="选择电商平台"
                  :disabled="running"
              /></label>
              <label v-if="activeModeFields.has('market')"
                ><span>市场</span
                ><CommerceSelect
                  v-model="market"
                  :options="marketOptions"
                  aria-label="选择目标市场"
                  :disabled="running"
              /></label>
              <label v-if="activeModeFields.has('language')"
                ><span>语言</span
                ><CommerceSelect
                  v-model="language"
                  :options="languageOptions"
                  aria-label="选择文案语言"
                  :disabled="running"
              /></label>
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
              <label v-if="maxOutputCount > 1 && activeMode.id !== 'listing'">
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
              <label v-if="activeModeFields.has('scene') && activeMode.id !== 'tryon'">
                <span>场景方向</span>
                <CommerceSelect
                  v-model="sceneStyle"
                  :options="sceneOptions"
                  aria-label="选择场景方向"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('campaign')">
                <span>营销目标</span>
                <CommerceSelect
                  v-model="campaignGoal"
                  :options="campaignOptions"
                  aria-label="选择营销目标"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('tone')">
                <span>视觉风格</span>
                <CommerceSelect
                  v-model="visualTone"
                  :options="toneOptions"
                  aria-label="选择视觉风格"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('apparel')">
                <span>服装类型</span>
                <CommerceSelect
                  v-model="apparelType"
                  :options="apparelOptions"
                  aria-label="选择服装类型"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('model')">
                <span>模特人群</span>
                <CommerceSelect
                  v-model="modelProfile"
                  :options="modelOptions"
                  aria-label="选择模特人群"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('pose')">
                <span>模特姿态</span>
                <CommerceSelect
                  v-model="modelPose"
                  :options="poseOptions"
                  aria-label="选择模特姿态"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('accessory')">
                <span>饰品类型</span>
                <CommerceSelect
                  v-model="accessoryType"
                  :options="accessoryOptions"
                  aria-label="选择饰品类型"
                  :disabled="running"
                />
              </label>
              <label v-if="activeModeFields.has('shadow')">
                <span>阴影类型</span>
                <CommerceSelect
                  v-model="shadowStyle"
                  :options="shadowOptions"
                  aria-label="选择阴影类型"
                  :disabled="running"
                />
              </label>
            </div>
          </section>

          <section v-if="activeMode.id === 'tryon'" class="settings-section tryon-scene-section">
            <h2>拍摄场景</h2>
            <div class="choice-chip-grid">
              <button
                v-for="item in tryonSceneOptions"
                :key="item"
                type="button"
                :class="{ active: sceneStyle === item }"
                @click="sceneStyle = item"
              >
                <i class="bi bi-check-lg"></i>{{ item }}
              </button>
            </div>
          </section>

          <section v-if="activeMode.id === 'clone'" class="settings-section clone-settings-section">
            <h2>复刻类型</h2>
            <div class="clone-type-grid">
              <button
                v-for="item in cloneTypeOptions"
                :key="item.value"
                type="button"
                :class="{ active: cloneType === item.value }"
                @click="cloneType = item.value"
              >
                <i class="bi" :class="item.icon"></i>{{ item.label }}
              </button>
            </div>
            <h2 class="clone-subheading">复刻程度</h2>
            <div class="clone-fidelity-grid">
              <button
                v-for="item in cloneFidelityOptions"
                :key="item.value"
                type="button"
                :class="{ active: cloneFidelity === item.value }"
                @click="cloneFidelity = item.value"
              >
                <span class="structure-mode-check"><i class="bi bi-check-lg"></i></span>
                <span
                  ><strong>{{ item.label }}</strong
                  ><small>{{ item.description }}</small></span
                >
              </button>
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-heading settings-heading--brief">
              <h2>{{ requiresBrief ? '商品卖点与要求' : '补充要求' }}</h2>
              <button
                type="button"
                class="brief-organize"
                title="识别商品图片并生成名称和卖点"
                @click="openProductBriefAssistant"
              >
                <i class="bi bi-stars"></i>AI 生成
              </button>
            </div>
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

          <section
            v-if="activeMode.id === 'listing'"
            class="settings-section listing-structure-section"
          >
            <h2>套图结构配置</h2>
            <div class="structure-mode-grid">
              <button
                type="button"
                :class="{ active: listingStructureMode === 'smart' }"
                @click="setListingStructureMode('smart')"
              >
                <span class="structure-mode-check"><i class="bi bi-check-lg"></i></span>
                <span
                  ><strong>智能匹配</strong
                  ><small>分析商品资料，自动组织 7 张高转化套图</small></span
                >
              </button>
              <button
                type="button"
                :class="{ active: listingStructureMode === 'custom' }"
                @click="setListingStructureMode('custom')"
              >
                <span class="structure-mode-check"><i class="bi bi-check-lg"></i></span>
                <span
                  ><strong>自定义配置</strong><small>自由选择图片类型和本次生成数量</small></span
                >
              </button>
            </div>
            <div v-if="listingStructureMode === 'custom'" class="listing-count-config">
              <article
                v-for="item in [
                  { key: 'white', label: '白底图', hint: '平台合规主图，多角度展示商品' },
                  { key: 'scene', label: '场景图', hint: '生活使用场景与人物搭配' },
                  { key: 'selling', label: '卖点图', hint: '核心卖点与细节特写' },
                  { key: 'other', label: '其他', hint: '规格、包装、细节智能匹配' },
                ]"
                :key="item.key"
              >
                <span
                  ><strong>{{ item.label }}</strong
                  ><small>{{ item.hint }}</small></span
                >
                <div class="listing-stepper" :aria-label="`${item.label}数量`">
                  <button
                    type="button"
                    :aria-label="`减少${item.label}`"
                    :disabled="listingStructureCounts[item.key] <= (item.key === 'white' ? 1 : 0)"
                    @click="adjustListingStructure(item.key, -1)"
                  >
                    <i class="bi bi-dash"></i>
                  </button>
                  <b>{{ listingStructureCounts[item.key] }}</b>
                  <button
                    type="button"
                    :aria-label="`增加${item.label}`"
                    :disabled="listingCustomCount >= 7"
                    @click="adjustListingStructure(item.key, 1)"
                  >
                    <i class="bi bi-plus"></i>
                  </button>
                </div>
              </article>
              <footer>
                <span>已分配 {{ listingCustomCount }}/7 张</span>
                <strong :class="{ ready: listingCustomCount === 7 }">
                  {{ listingCustomCount === 7 ? '结构完整' : '需要分配满 7 张' }}
                </strong>
              </footer>
            </div>
          </section>

          <section
            v-if="activeModeFields.has('modules') && activeMode.id !== 'listing'"
            class="settings-section modules-section"
          >
            <h2>视觉模块 <small>多选</small></h2>
            <div class="module-grid">
              <label v-for="item in activeModuleOptions" :key="item.value">
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
              <span>
                {{ generationPlan.length }} 张{{ generationPlan.length > 1 ? ' · 首张后并行' : '' }}
              </span>
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
              首张锁定系列视觉后，其余图片并行生成
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
          <button
            v-if="running"
            type="button"
            class="cancel-button"
            :disabled="cancelling"
            :aria-label="cancelling ? '正在停止生成' : '停止生成'"
            @click="cancel()"
          >
            <i class="bi" :class="cancelling ? 'bi-arrow-repeat is-spinning' : 'bi-stop-circle'"></i
            >{{ cancelling ? '停止中' : '停止生成' }}
          </button>
          <button
            v-else
            type="button"
            class="generate-button"
            :disabled="!canGenerate"
            :title="readiness.label"
            @click="generate"
          >
            <i class="bi bi-stars"></i>一键生成{{ activeMode.label }}（{{ actualOutputCount }}张）
          </button>
        </footer>
      </aside>

      <section
        ref="canvasPanel"
        class="commerce-canvas"
        :class="{ 'is-mobile-hidden': activeMobilePane !== 'canvas' }"
      >
        <CommerceProductLibrary
          v-if="workspaceView === 'products'"
          :selected-product-id="selectedProduct?.id || ''"
          :busy="applyingProduct"
          @select="applyCommerceProduct"
          @clear-product="clearSelectedProduct"
          @close="openWorkspaceView('result')"
        />

        <section v-else-if="workspaceView === 'history'" class="workspace-library">
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
                  role="tab"
                  :class="{ active: historyScope === 'current' }"
                  :aria-selected="historyScope === 'current'"
                  @click="historyScope = 'current'"
                >
                  当前工具
                </button>
                <button
                  type="button"
                  role="tab"
                  :class="{ active: historyScope === 'all' }"
                  :aria-selected="historyScope === 'all'"
                  @click="historyScope = 'all'"
                >
                  全部电商
                </button>
              </div>
              <button
                type="button"
                class="workspace-icon-button"
                title="刷新历史"
                aria-label="刷新历史"
                :disabled="historyLoading"
                @click="loadHistory(12)"
              >
                <i class="bi bi-arrow-clockwise"></i>
              </button>
            </div>
          </header>

          <div class="workspace-library__body">
            <div v-if="historyError" class="workspace-library__inline-error" role="alert">
              <span><i class="bi bi-exclamation-circle"></i>{{ historyError }}</span>
              <button type="button" @click="loadHistory(12)">
                <i class="bi bi-arrow-clockwise"></i>重试
              </button>
            </div>
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
                  <button
                    type="button"
                    class="danger"
                    :disabled="removingOutputs.has(output)"
                    :aria-label="`删除${outputMode(output).shortLabel || outputMode(output).label}历史记录`"
                    @click="requestOutputRemoval(output)"
                  >
                    <i
                      class="bi"
                      :class="
                        removingOutputs.has(output) ? 'bi-arrow-repeat is-spinning' : 'bi-trash3'
                      "
                    ></i>
                    删除
                  </button>
                </div>
              </article>
            </div>
            <div v-else-if="!historyError" class="workspace-empty">
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
                aria-label="刷新素材"
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

            <div
              v-if="assetsError && assets.length"
              class="workspace-library__inline-error"
              role="alert"
            >
              <span><i class="bi bi-exclamation-circle"></i>{{ assetsError }}</span>
              <button type="button" @click="retryAssetsLoad">
                <i class="bi bi-arrow-clockwise"></i>重试
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
            <button
              type="button"
              :disabled="cancelling"
              :aria-label="cancelling ? '正在停止生成' : '停止生成'"
              @click="cancel()"
            >
              <i
                class="bi"
                :class="cancelling ? 'bi-arrow-repeat is-spinning' : 'bi-stop-circle'"
              ></i
              >{{ cancelling ? '停止中' : '停止' }}
            </button>
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
              <button
                type="button"
                title="放大查看细节"
                aria-label="放大查看当前结果"
                @click="openOutputPreview(currentOutput)"
              >
                <i class="bi bi-arrows-fullscreen"></i>
              </button>
              <button
                type="button"
                title="局部编辑"
                aria-label="局部编辑当前结果"
                :disabled="running"
                @click="openLocalEditor(currentOutput)"
              >
                <i class="bi bi-brush"></i>
              </button>
              <button
                type="button"
                title="下载当前结果"
                aria-label="下载当前结果"
                @click="downloadOutput(currentOutput)"
              >
                <i class="bi bi-download"></i>
              </button>
            </div>
          </header>
          <div class="result-main" :class="{ 'revision-is-open': revisionPanelOpen }">
            <div
              class="result-stage"
              :class="resultLayoutClass"
              :data-count="currentGroupSlots.length"
            >
              <article
                v-for="(output, index) in currentGroupSlots"
                :key="`${currentGroupId || 'result'}:${index}`"
                class="result-image-card"
                :class="{
                  active: output && output === currentOutput,
                  loaded: output && loadedOutputs.has(output),
                  'is-pending': !output,
                }"
                :style="{
                  aspectRatio: String((output && outputAspectRatios[output]) || aspectRatio).replace(
                    ':',
                    ' / ',
                  ),
                }"
              >
                <button
                  v-if="output"
                  type="button"
                  class="result-image-hit-area"
                  :aria-label="`查看第 ${index + 1} 张结果细节`"
                  @click="activeOutput = output"
                  @dblclick="openOutputPreview(output)"
                >
                  <span v-if="!loadedOutputs.has(output)" class="result-image-skeleton"></span>
                  <AuthenticatedImage
                    :src="output"
                    :alt="`${activeMode.label}第 ${index + 1} 张生成结果`"
                    loading="eager"
                    :max-dimension="1600"
                    @load="markOutputLoaded(output)"
                  />
                  <span class="result-image-index">{{ String(index + 1).padStart(2, '0') }}</span>
                </button>
                <div v-else class="result-image-pending" role="status">
                  <span class="result-image-skeleton"></span>
                  <span class="result-image-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <small>等待结果</small>
                </div>
              </article>
            </div>
            <aside
              class="revision-panel"
              :class="{ open: revisionPanelOpen }"
              aria-label="继续调整当前成品"
            >
              <header>
                <button
                  type="button"
                  class="revision-panel__toggle"
                  :title="revisionPanelOpen ? '收起连续优化' : '继续优化当前成品'"
                  :aria-label="revisionPanelOpen ? '收起连续优化' : '展开连续优化'"
                  :aria-expanded="revisionPanelOpen"
                  @click="revisionPanelOpen = !revisionPanelOpen"
                >
                  <i :class="revisionPanelOpen ? 'bi bi-chevron-right' : 'bi bi-sliders2'"></i>
                </button>
                <div class="revision-panel__title">
                  <small>连续优化</small>
                  <strong>继续调整当前成品</strong>
                </div>
              </header>
              <div v-show="revisionPanelOpen" class="revision-panel__body">
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
              </div>
            </aside>
          </div>
          <div class="result-strip" role="list" aria-label="生成历史">
            <div
              v-for="output in modeOutputs"
              :key="output"
              class="result-strip__item"
              role="listitem"
            >
              <button
                type="button"
                class="result-strip__select"
                :class="{ active: output === currentOutput }"
                :aria-label="`查看第 ${(outputGroupIndexes[output] || 0) + 1} 张结果，第 ${outputVersion(output)} 版`"
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
              </button>
              <button
                type="button"
                class="result-delete"
                title="删除结果"
                :aria-label="`删除第 ${(outputGroupIndexes[output] || 0) + 1} 张结果，第 ${outputVersion(output)} 版`"
                :disabled="removingOutputs.has(output)"
                @click="requestOutputRemoval(output)"
              >
                <i
                  class="bi"
                  :class="removingOutputs.has(output) ? 'bi-arrow-repeat is-spinning' : 'bi-trash3'"
                ></i>
              </button>
            </div>
          </div>
        </div>

        <div v-else class="canvas-empty">
          <div class="canvas-intro">
            <div>
              <h1>{{ activeMode.label }}</h1>
              <p>{{ modePreview.description }}</p>
            </div>
          </div>
          <div class="canvas-showcase" :class="{ 'is-demo': !previews.length }">
            <div v-if="!previews.length" class="showcase-demo" :class="`is-${activeMode.id}`">
              <div class="showcase-demo__stage">
                <img :src="modePreview.src" :alt="modePreview.label" />
                <span
                  v-for="(tag, index) in modePreview.tags"
                  :key="tag"
                  class="showcase-demo__tag"
                  :class="`tag-${index + 1}`"
                >
                  {{ tag }}
                </span>
              </div>
              <div class="showcase-demo__caption">
                <div class="showcase-demo__caption-copy">
                  <span><i class="bi bi-stars"></i>{{ modePreview.label }}</span>
                  <strong>{{ modePreview.title }}</strong>
                </div>
                <button type="button" :disabled="running" @click="fileInput?.click()">
                  <i class="bi bi-cloud-arrow-up"></i>
                  {{ modePreview.cta }}
                </button>
              </div>
            </div>
            <template v-else>
              <button
                type="button"
                class="showcase-product has-images"
                :disabled="running"
                @click="fileInput?.click()"
              >
                <img :src="previews[0].url" :alt="`${activeMode.label}商品参考图`" />
                <span><i class="bi bi-arrow-repeat"></i>更换商品图</span>
              </button>
              <span class="showcase-flow-arrow" aria-hidden="true"
                ><i class="bi bi-arrow-right"></i
              ></span>
              <div
                class="showcase-output-grid"
                :class="{ 'is-single': generationPlan.length === 1 }"
              >
                <article
                  v-for="(item, index) in generationPlan.slice(0, 5)"
                  :key="item.viewId"
                  :class="{ featured: index === 0 }"
                >
                  <span>{{ String(index + 1).padStart(2, '0') }}</span>
                  <i class="bi" :class="item.icon || activeMode.icon"></i>
                  <strong>{{ item.viewLabel.split(' · ').pop() }}</strong>
                  <small>{{ index === 0 ? `${platform} · ${aspectRatio}` : '系列视觉统一' }}</small>
                </article>
                <span v-if="generationPlan.length > 5" class="showcase-more">
                  +{{ generationPlan.length - 5 }} 张
                </span>
              </div>
            </template>
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

    <EcommerceBriefAssistantDialog
      v-model:product-name="briefDraftName"
      v-model:selling-points="briefDraftSellingPoints"
      :open="briefAssistantOpen"
      :busy="briefAssistantBusy"
      :error="briefAssistantError"
      :light="!appearanceStore.isDark"
      @close="closeProductBriefAssistant"
      @regenerate="generateProductBriefDraft"
      @confirm="confirmProductBrief"
    />

    <DeleteHistoryConfirmDialog
      :open="Boolean(deleteCandidate)"
      heading="删除这条记录及后续结果？"
      description="将删除这张图片；如果其他结果由它继续生成，也会一并删除。删除后无法恢复。"
      confirm-label="确认删除"
      busy-label="删除中…"
      :busy="removingOutputs.has(deleteCandidate)"
      :light="!appearanceStore.isDark"
      @close="closeOutputRemoval"
      @confirm="confirmOutputRemoval"
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
  --commerce-line: rgb(40 32 72 / 9%);
  --commerce-panel: rgb(255 255 255 / 86%);
  --commerce-canvas: #f3f1f8;
  --commerce-soft: color-mix(in srgb, #6d5cff 7%, #f4f2fb);
  --commerce-soft-strong: color-mix(in srgb, #6d5cff 12%, #ebe7f8);
  --commerce-ink: #17131f;
  --commerce-muted: #6f6880;
  --commerce-accent: #6d5cff;
  --commerce-accent-ink: #5340d8;
  --commerce-accent-soft: rgb(109 92 255 / 12%);
  --commerce-accent-line: rgb(109 92 255 / 28%);
  --commerce-success: #1f7a4d;
  --commerce-warning: #9a6418;
  --commerce-shadow-control: 0 4px 14px rgb(58 51 112 / 8%);
  --commerce-shadow-footer: 0 -12px 32px rgb(58 51 112 / 7%);
  --commerce-shadow-panel: 0 18px 44px rgb(48 36 96 / 12%);
  --commerce-shadow-result: 0 22px 48px rgb(38 32 80 / 16%);
  --commerce-shadow-card: 0 12px 30px rgb(58 51 112 / 10%);
  --commerce-settings-surface: rgb(255 255 255 / 82%);
  --commerce-settings-control: rgb(245 243 252 / 88%);
  --commerce-settings-line: rgb(48 40 84 / 9%);
  --commerce-settings-primary: var(--commerce-accent);
  --commerce-settings-primary-ink: #fff;
  --commerce-settings-radius: 20px;
  --commerce-settings-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --commerce-display: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --commerce-sans: 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  --commerce-rail-fade: #f3f1f8;
  --commerce-panel-solid: #ffffff;
  --commerce-cost-bg: color-mix(in srgb, var(--commerce-warning) 12%, #fff);
  --commerce-section-fill: color-mix(in srgb, #fff 58%, transparent);
  --commerce-showcase-dock: color-mix(in srgb, #fff 96%, transparent);
  --commerce-canvas-panel: color-mix(in srgb, #fff 48%, transparent);
  --commerce-showcase-card: color-mix(in srgb, #fff 78%, transparent);
  --commerce-footer-fill: color-mix(in srgb, var(--commerce-settings-surface) 92%, #fff);
  position: relative;
  isolation: isolate;
  color-scheme: light;
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  color: var(--commerce-ink);
  background: var(--commerce-canvas);
  font-family: var(--commerce-sans);
  flex-direction: column;
}
.commerce-atmosphere {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.commerce-atmosphere__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(8px);
}
.commerce-atmosphere__glow--a {
  top: -18%;
  left: -8%;
  width: 46vw;
  height: 46vw;
  background: radial-gradient(circle, rgb(109 92 255 / 22%), transparent 68%);
}
.commerce-atmosphere__glow--b {
  right: -10%;
  bottom: -22%;
  width: 42vw;
  height: 42vw;
  background: radial-gradient(circle, rgb(56 189 168 / 16%), transparent 70%);
}
.commerce-atmosphere__grain {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.commerce-studio > :not(.commerce-atmosphere) {
  position: relative;
  z-index: 1;
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
  min-height: 60px;
  align-items: center;
  gap: 16px;
  margin: 10px 10px 0;
  padding: 0 14px 0 12px;
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 18px;
  box-shadow: 0 10px 28px rgb(48 36 96 / 6%);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
  backdrop-filter: blur(18px) saturate(120%);
  flex: 0 0 60px;
}
.commerce-header__brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.commerce-header__badge {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  color: #fff;
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 24%, rgb(255 255 255 / 28%), transparent 46%),
    linear-gradient(145deg, #6d5cff, #8b5cf6 58%, #14b8a6);
  box-shadow: 0 8px 18px rgb(109 92 255 / 24%);
  font-size: 1rem;
}
.commerce-header__copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.commerce-header__copy em {
  color: var(--commerce-muted);
  font-family: var(--commerce-settings-mono);
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 740;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.commerce-header__copy strong {
  overflow: hidden;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-header__actions a,
.commerce-header__actions button,
.commerce-cost {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--commerce-muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.commerce-header__actions button {
  cursor: pointer;
}
.commerce-header__actions button:hover:not(:disabled) {
  color: var(--commerce-ink);
  background: var(--commerce-soft);
}
.commerce-header__actions button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  box-shadow: inset 0 0 0 1px var(--commerce-accent-line);
}
.commerce-header__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--commerce-soft) 70%, transparent);
}
.commerce-cost {
  color: var(--commerce-warning);
  background: var(--commerce-cost-bg);
  margin-left: 4px;
}
.commerce-layout {
  display: grid;
  min-height: 0;
  grid-template-columns: 92px clamp(388px, 25vw, 438px) minmax(0, 1fr);
  flex: 1 1 auto;
  overflow: hidden;
}
.commerce-rail {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 18px;
  box-shadow: 0 12px 30px rgb(48 36 96 / 6%);
  margin: 8px 6px 8px 8px;
  align-self: stretch;
  flex-direction: column;
  -webkit-backdrop-filter: blur(16px) saturate(118%);
  backdrop-filter: blur(16px) saturate(118%);
}
.commerce-rail::before,
.commerce-rail::after {
  position: absolute;
  right: 1px;
  left: 1px;
  z-index: 4;
  height: 36px;
  content: '';
  opacity: 1;
  pointer-events: none;
  transition: opacity 180ms ease;
}
.commerce-rail::before {
  top: 0;
  background: linear-gradient(to bottom, var(--commerce-rail-fade) 12%, transparent 100%);
  border-radius: 17px 17px 0 0;
}
.commerce-rail::after {
  bottom: 0;
  background: linear-gradient(to top, var(--commerce-rail-fade) 12%, transparent 100%);
  border-radius: 0 0 17px 17px;
}
.commerce-rail.is-at-start::before,
.commerce-rail.is-at-end::after {
  opacity: 0;
}
.commerce-rail__scroll {
  display: grid;
  min-width: 0;
  min-height: 0;
  padding: 10px 8px;
  overflow-x: hidden;
  overflow-y: auto;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: auto;
  align-content: start;
  gap: 8px;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.commerce-rail__scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.commerce-rail__rule {
  height: 1px;
  min-height: 1px;
  margin: 2px 10px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--commerce-line) 90%, transparent),
    transparent
  );
}
.commerce-rail a,
.commerce-rail button {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 64px;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px 7px;
  overflow: hidden;
  color: var(--commerce-muted);
  text-decoration: none;
  flex-direction: column;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
}
.commerce-rail__icon {
  position: relative;
  z-index: 0;
  display: flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  color: var(--commerce-muted);
  opacity: 0.3;
  pointer-events: none;
  border-radius: 10px;
  background: transparent;
  transform: none;
  transition:
    color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.commerce-rail__icon i {
  font-size: 18px;
  line-height: 1;
}
.commerce-rail__label {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 0 2px;
  overflow: hidden;
  color: var(--commerce-ink);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.15;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.commerce-rail a:hover,
.commerce-rail button:not(:disabled):hover {
  color: var(--commerce-ink);
  background: var(--commerce-soft-strong);
  box-shadow: none;
}
.commerce-rail a:hover .commerce-rail__icon,
.commerce-rail button:not(:disabled):hover .commerce-rail__icon {
  color: var(--commerce-accent-ink);
  opacity: 0.42;
}
.commerce-rail a.active,
.commerce-rail button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-color: transparent;
  box-shadow: none;
  font-weight: 700;
}
.commerce-rail a.active .commerce-rail__label,
.commerce-rail button.active .commerce-rail__label {
  color: var(--commerce-accent-ink);
}
.commerce-rail a.active .commerce-rail__icon,
.commerce-rail button.active .commerce-rail__icon {
  color: #fff;
  opacity: 1;
  background: linear-gradient(145deg, #6d5cff, #14b8a6);
  box-shadow: 0 6px 14px rgb(109 92 255 / 26%);
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
  min-height: 88px;
  padding: 6px;
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
.selected-product-context {
  display: grid;
  width: 100%;
  min-height: 40px;
  grid-template-columns: 28px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 7px;
  margin: 8px 0 0;
  padding: 6px 8px;
  color: var(--commerce-ink);
  text-align: left;
  background: var(--commerce-accent-soft);
  border: 1px solid var(--commerce-accent-line);
  border-radius: 8px;
  cursor: pointer;
}
.selected-product-context > span:first-child {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  border-radius: 7px;
}
.selected-product-context > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.selected-product-context small {
  color: var(--commerce-muted);
  font-size: 9px;
}
.selected-product-context strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected-product-context > i {
  color: var(--commerce-muted);
  font-size: 11px;
}
.reference-diagnostics {
  display: grid;
  gap: 5px;
  margin-top: 6px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--commerce-soft) 72%, transparent);
  border: 1px solid var(--commerce-line);
  border-radius: 8px;
}
.reference-diagnostics__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--commerce-accent-ink);
  font-size: 10px;
  font-weight: 750;
}
.reference-diagnostics__header span,
.reference-diagnostics__header small {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.reference-diagnostics__header small {
  color: var(--commerce-muted);
  font-size: 9px;
  font-weight: 500;
}
.reference-diagnostics__list {
  display: grid;
  gap: 4px;
}
.reference-diagnostics__list span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--commerce-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-diagnostics__list span.ok {
  color: var(--commerce-success);
}
.reference-diagnostics__list span.warn {
  color: var(--commerce-warning);
}
.reference-diagnostics__list span.error {
  color: #c24343;
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
.upload-role-guide {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}
.upload-role-guide > span {
  display: grid;
  min-width: 0;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border-radius: var(--commerce-settings-radius);
}
.upload-role-guide b {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 5px;
  font-size: 9px;
}
.upload-role-guide > span > span {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 5px;
}
.upload-role-guide strong,
.upload-role-guide small {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-role-guide strong {
  color: var(--commerce-ink);
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
.settings-heading--source,
.settings-heading--brief {
  margin-bottom: 12px;
}
.brief-organize {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  border: 1px solid var(--commerce-accent-line);
  border-radius: 7px;
  font-size: 10px;
  font-weight: 750;
  cursor: pointer;
}
.brief-organize:hover {
  background: var(--commerce-accent-soft);
}
.structure-mode-grid {
  display: grid;
  gap: 9px;
}
.structure-mode-grid > button {
  display: grid;
  width: 100%;
  min-height: 72px;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 14px;
  color: var(--commerce-ink);
  text-align: left;
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.structure-mode-grid > button.active {
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent);
}
.structure-mode-check {
  display: grid;
  width: 19px;
  height: 19px;
  place-items: center;
  color: transparent;
  background: var(--commerce-panel);
  border: 1px solid color-mix(in srgb, var(--commerce-muted) 35%, transparent);
  border-radius: 5px;
  font-size: 11px;
}
.structure-mode-grid > button.active .structure-mode-check {
  color: #fff;
  background: var(--commerce-accent);
  border-color: var(--commerce-accent);
}
.structure-mode-grid > button > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.structure-mode-grid strong {
  font-size: 12px;
}
.structure-mode-grid small {
  color: var(--commerce-muted);
  font-size: 10px;
  line-height: 1.45;
}
.listing-count-config {
  display: grid;
  gap: 7px;
  margin-top: 9px;
  padding: 9px;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 8px;
}
.listing-count-config article {
  display: grid;
  min-height: 58px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  background: var(--commerce-panel);
  border-radius: var(--commerce-settings-radius);
}
.listing-count-config article > span,
.clone-fidelity-grid button > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.listing-count-config article strong,
.clone-fidelity-grid strong {
  font-size: 11px;
}
.listing-count-config article small,
.clone-fidelity-grid small {
  color: var(--commerce-muted);
  font-size: 9px;
  line-height: 1.4;
}
.listing-stepper {
  display: grid;
  grid-template-columns: 26px 24px 26px;
  align-items: center;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 1px solid var(--commerce-line);
  border-radius: 6px;
}
.listing-stepper button {
  display: grid;
  width: 26px;
  height: 28px;
  place-items: center;
  color: var(--commerce-ink);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.listing-stepper button:disabled {
  cursor: not-allowed;
  opacity: 0.28;
}
.listing-stepper b {
  color: var(--commerce-ink);
  font-size: 11px;
  text-align: center;
}
.listing-count-config > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 0;
  color: var(--commerce-muted);
  font-size: 9px;
}
.listing-count-config > footer strong.ready {
  color: var(--commerce-success);
}
.choice-chip-grid,
.clone-type-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.choice-chip-grid button,
.clone-type-grid button {
  display: flex;
  min-width: 0;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px;
  color: var(--commerce-muted);
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.choice-chip-grid button i {
  display: none;
}
.choice-chip-grid button.active,
.clone-type-grid button.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent-line);
}
.choice-chip-grid button.active i {
  display: inline;
}
.clone-subheading {
  margin-top: 18px !important;
}
.clone-fidelity-grid {
  display: grid;
  gap: 8px;
}
.clone-fidelity-grid button {
  display: grid;
  min-height: 64px;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  padding: 12px;
  color: var(--commerce-ink);
  text-align: left;
  background: var(--commerce-soft);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.clone-fidelity-grid button.active {
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent);
}
.clone-fidelity-grid button.active .structure-mode-check {
  color: #fff;
  background: var(--commerce-accent);
  border-color: var(--commerce-accent);
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
  min-height: 44px;
  grid-template-columns: 28px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 7px 9px;
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
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-panel);
  border-radius: 7px;
  font-size: 12px;
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
  gap: 6px;
}
.module-grid label {
  position: relative;
  display: flex;
  min-height: 52px;
  align-items: flex-start;
  gap: 7px;
  padding: 8px 9px;
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
  border-top: 0;
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
.cancel-button:disabled,
.generation-status button:disabled {
  cursor: wait;
  opacity: 0.65;
}

/* High-contrast editorial treatment for the settings tool surface. */
.commerce-settings {
  margin: 8px 8px 8px 0;
  overflow: hidden;
  background: var(--commerce-settings-surface);
  border: 1px solid var(--commerce-settings-line);
  border-radius: var(--commerce-settings-radius);
  box-shadow: 0 16px 40px rgb(48 36 96 / 8%);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
  backdrop-filter: blur(18px) saturate(120%);
}
.settings-scroll {
  padding: 12px 12px 18px;
  background: transparent;
  counter-reset: commerce-step;
}
.settings-section + .settings-section {
  margin-top: 10px;
}
.settings-section {
  padding: 10px 10px 12px;
  border: 1px solid color-mix(in srgb, var(--commerce-settings-line) 80%, transparent);
  border-radius: 14px;
  background: var(--commerce-section-fill);
}
.settings-section h2 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  color: var(--commerce-ink);
  font-size: 13px;
  font-weight: 800;
}
.settings-section h2::before {
  counter-increment: commerce-step;
  content: counter(commerce-step, decimal-leading-zero);
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  color: var(--commerce-accent-ink);
  border-radius: 6px;
  background: var(--commerce-accent-soft);
  font-family: var(--commerce-settings-mono);
  font-size: 0.56rem;
  font-weight: 780;
}
.settings-section h2 > i,
.settings-section h2 > small {
  color: var(--commerce-muted);
  font-size: 10px;
}
.settings-heading {
  margin-bottom: 8px;
}
.settings-heading > span {
  padding: 3px 6px;
  color: var(--commerce-muted);
  background: var(--commerce-settings-control);
  border: 0;
  border-radius: 5px;
  font-size: 9px;
}
.product-upload {
  min-height: 88px;
  padding: 6px;
  background: color-mix(in srgb, var(--commerce-settings-control) 64%, transparent);
  border-color: var(--commerce-settings-line);
  border-style: solid;
  border-radius: var(--commerce-settings-radius);
  box-shadow: none;
}
.upload-empty {
  height: 76px;
}
.upload-empty i {
  margin-bottom: 2px;
  color: var(--commerce-accent);
  font-size: 20px;
}
.upload-empty strong {
  color: var(--commerce-ink);
  font-size: 12px;
  font-weight: 800;
}
.upload-empty small {
  margin-top: 3px;
  color: var(--commerce-muted);
  font-size: 9px;
}
.upload-grid {
  gap: 6px;
}
.upload-role-guide {
  gap: 6px;
  margin-top: 6px;
}
.upload-role-guide > span {
  min-height: 34px;
  padding: 6px 8px;
  color: var(--commerce-muted);
  background: color-mix(in srgb, var(--commerce-settings-control) 68%, transparent);
  border: 1px solid var(--commerce-settings-line);
  border-radius: var(--commerce-settings-radius);
  font-size: 10px;
}
.upload-role-guide b {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  font-family: var(--commerce-settings-mono);
}
.select-row {
  gap: 8px;
}
.select-row + .select-row {
  margin-top: 8px;
}
.select-row label,
.wide-select,
.text-field {
  gap: 4px;
}
.select-row label > span,
.wide-select > span,
.text-field > span {
  color: var(--commerce-muted);
  font-size: 9px;
  font-weight: 700;
}
.commerce-settings :deep(.commerce-select-trigger) {
  height: 34px;
  padding: 0 10px;
  color: var(--commerce-ink);
  background: var(--commerce-settings-control);
  border-color: transparent;
  border-radius: 12px;
  font-size: 11px;
}
.commerce-settings :deep(.commerce-select-trigger:hover:not(:disabled)) {
  background: var(--commerce-settings-surface);
  border-color: color-mix(in srgb, var(--commerce-ink) 26%, var(--commerce-settings-line));
}
.commerce-settings :deep(.commerce-select-trigger:focus-visible),
.commerce-settings :deep(.commerce-select-trigger.is-open) {
  border-color: var(--commerce-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--commerce-accent) 14%, transparent);
}
.text-field input,
.text-field textarea {
  min-height: 34px;
  padding: 7px 10px;
  color: var(--commerce-ink);
  background: var(--commerce-settings-control);
  border-color: transparent;
  border-radius: 10px;
  font-size: 12px;
}
.text-field textarea {
  min-height: 72px;
}
.text-field + .text-field {
  margin-top: 8px;
}
.choice-chip-grid button,
.clone-type-grid button,
.clone-fidelity-grid button,
.structure-mode-grid > button,
.module-grid label,
.shot-plan-list li,
.text-stability-control,
.listing-count-config {
  background: var(--commerce-settings-control);
  border-color: var(--commerce-settings-line);
}
.choice-chip-grid button,
.clone-type-grid button {
  min-height: 34px;
  color: var(--commerce-muted);
  border-radius: 8px;
  font-size: 11px;
}
.choice-chip-grid button.active,
.clone-type-grid button.active,
.clone-fidelity-grid button.active,
.structure-mode-grid > button.active,
.module-grid label:has(input:checked),
.text-stability-control.active {
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-color: var(--commerce-accent);
  box-shadow: none;
}
.mode-switch {
  padding: 0;
  background: transparent;
  border: 1px solid var(--commerce-settings-line);
  border-radius: 8px;
}
.mode-switch button {
  min-height: 32px;
  border-radius: 7px;
  font-size: 11px;
}
.mode-switch button.active {
  background: var(--commerce-settings-control);
  border-color: transparent;
  box-shadow: none;
}
.shot-plan-list {
  gap: 6px;
}
.shot-plan-list li {
  min-height: 0;
  padding: 8px 9px;
}
.generate-bar {
  min-height: 0;
  padding: 10px 12px 12px;
  background: var(--commerce-footer-fill);
  border-top: 1px solid color-mix(in srgb, var(--commerce-settings-line) 72%, transparent);
  border-radius: var(--commerce-settings-radius) var(--commerce-settings-radius) 0 0;
  box-shadow: var(--commerce-shadow-footer);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
  backdrop-filter: blur(18px) saturate(120%);
}
.generate-meta {
  margin-bottom: 6px;
  font-family: var(--commerce-settings-mono);
  font-size: 9px;
}
.generate-button {
  height: 42px;
  color: var(--commerce-settings-primary-ink);
  background:
    radial-gradient(circle at 28% 20%, rgb(255 255 255 / 24%), transparent 42%),
    linear-gradient(135deg, #6d5cff, #7c5cff 48%, #14b8a6);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 10px 22px rgb(109 92 255 / 24%);
  font-size: 12px;
  font-weight: 800;
}
.generate-button:hover:not(:disabled) {
  filter: brightness(1.04);
  transform: translateY(-1px);
}
.generate-button:disabled {
  box-shadow: none;
  filter: grayscale(0.15);
}
.cancel-button {
  height: 42px;
  border-radius: 12px;
  font-size: 12px;
}
.commerce-canvas {
  position: relative;
  min-width: 0;
  min-height: 0;
  margin: 8px 10px 8px 0;
  overflow: hidden;
  background: var(--commerce-canvas-panel);
  border: 1px solid var(--commerce-line);
  border-radius: 20px;
  box-shadow: 0 16px 40px rgb(48 36 96 / 7%);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
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
  padding: clamp(22px, 3.4vh, 36px) 28px 28px;
  overflow: auto;
  overscroll-behavior: contain;
}
.canvas-intro {
  display: flex;
  width: min(1080px, calc(100% - 36px));
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 0 2px 18px;
  text-align: center;
}
.canvas-intro > div:first-child {
  min-width: 0;
}
.canvas-intro h1 {
  margin: 0;
  font-family: var(--commerce-display);
  font-size: clamp(2rem, 3.4vw, 2.7rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.12;
}
.canvas-intro > div:first-child > p {
  max-width: 640px;
  margin: 10px auto 0;
  color: var(--commerce-muted);
  font-size: 14px;
  line-height: 1.55;
}
.canvas-intro > div:first-child > p strong {
  color: var(--commerce-accent-ink);
  font-weight: 750;
}
.canvas-showcase {
  display: grid;
  width: min(980px, calc(100% - 36px));
  min-height: clamp(360px, 49vh, 470px);
  grid-template-columns: minmax(260px, 0.95fr) 54px minmax(390px, 1.35fr);
  align-items: center;
  gap: 18px;
  margin-top: 4px;
  padding: 22px;
  background: var(--commerce-showcase-card);
  border: 1px solid var(--commerce-line);
  border-radius: 22px;
  box-shadow: var(--commerce-shadow-panel);
}
.canvas-showcase.is-demo {
  display: block;
  width: min(720px, calc(100% - 48px));
  min-height: 0;
  margin-top: 0;
  padding: 0;
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.showcase-demo {
  position: relative;
  display: grid;
  width: 100%;
  gap: 16px;
  overflow: visible;
  background: transparent;
}
.showcase-demo__stage {
  position: relative;
  width: 100%;
  aspect-ratio: 1400 / 788;
  overflow: hidden;
  background: transparent;
  border-radius: 20px;
  box-shadow:
    0 18px 48px rgb(48 36 96 / 16%),
    0 4px 14px rgb(28 22 60 / 8%);
  transform: translateY(0);
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.showcase-demo__stage:hover {
  transform: translateY(-3px);
  box-shadow:
    0 24px 56px rgb(48 36 96 / 20%),
    0 8px 18px rgb(28 22 60 / 10%);
}
.showcase-demo__stage > img,
.showcase-demo > img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform-origin: 50% 50%;
}
.showcase-demo__tag {
  position: absolute;
  z-index: 2;
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 9px;
  color: #27303c;
  background: rgb(255 255 255 / 92%);
  border: 1px solid rgb(220 225 232 / 88%);
  border-radius: 999px;
  box-shadow: 0 6px 16px rgb(27 37 52 / 12%);
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
  backdrop-filter: blur(8px);
}
.showcase-demo__tag.tag-1 {
  top: 12px;
  left: 12px;
}
.showcase-demo__tag.tag-2 {
  top: 12px;
  left: 0;
  right: 0;
  width: max-content;
  margin-inline: auto;
}
.showcase-demo__tag.tag-3 {
  top: 12px;
  right: 12px;
}
.showcase-demo__tag.tag-4 {
  top: 52%;
  left: 0;
  right: 0;
  width: max-content;
  margin-inline: auto;
}
.showcase-demo__tag.tag-5 {
  top: 52%;
  right: 12px;
}
.showcase-demo.is-tryon .showcase-demo__tag,
.showcase-demo.is-handheld .showcase-demo__tag,
.showcase-demo.is-accessory .showcase-demo__tag {
  top: 12px;
  right: auto;
  width: auto;
  margin-inline: 0;
}
.showcase-demo.is-tryon .tag-1,
.showcase-demo.is-handheld .tag-1,
.showcase-demo.is-accessory .tag-1 {
  left: 3%;
}
.showcase-demo.is-tryon .tag-2,
.showcase-demo.is-handheld .tag-2,
.showcase-demo.is-accessory .tag-2 {
  left: 27%;
  right: auto;
}
.showcase-demo.is-tryon .tag-3,
.showcase-demo.is-handheld .tag-3,
.showcase-demo.is-accessory .tag-3 {
  left: 52%;
  right: auto;
}
.showcase-demo.is-tryon .tag-4,
.showcase-demo.is-handheld .tag-4,
.showcase-demo.is-accessory .tag-4 {
  left: 76%;
  right: auto;
}
.showcase-demo.is-clone .tag-1 {
  top: 12px;
  left: 12px;
}
.showcase-demo.is-clone .tag-2 {
  top: 12px;
  left: auto;
  right: 12px;
  width: auto;
  margin-inline: 0;
}
.showcase-demo.is-clone .tag-3 {
  top: auto;
  bottom: 14px;
  left: 12px;
  right: auto;
  width: auto;
  margin-inline: 0;
}
.showcase-demo.is-clone .tag-4 {
  top: auto;
  bottom: 14px;
  left: auto;
  right: 12px;
  width: auto;
  margin-inline: 0;
}
.showcase-demo__caption {
  position: static;
  display: flex;
  min-height: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0;
  background: transparent;
  border-top: 0;
}
.showcase-demo__caption-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.showcase-demo__caption span,
.showcase-demo__caption-copy > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--commerce-accent-ink);
  font-size: 9px;
  font-weight: 800;
}
.showcase-demo__caption strong,
.showcase-demo__caption-copy > strong {
  overflow: hidden;
  color: var(--commerce-ink);
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.showcase-demo__caption > button {
  display: inline-flex;
  height: 42px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 16px;
  color: #fff;
  background:
    radial-gradient(circle at 28% 22%, rgb(255 255 255 / 26%), transparent 46%),
    linear-gradient(135deg, #6d5cff, #14b8a6);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 10px 22px rgb(109 92 255 / 24%);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.showcase-demo__caption > button:hover:not(:disabled) {
  filter: brightness(1.04);
}
.showcase-product {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--commerce-ink);
  background: #f8f9fb;
  border: 1px dashed #cbd2dc;
  border-radius: 8px;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
}
.showcase-product.has-images {
  background: #fff;
  border-style: solid;
}
.showcase-product > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.showcase-product > span:not(.showcase-product__empty) {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: #fff;
  background: rgb(20 24 31 / 74%);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}
.showcase-product__empty {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  color: var(--commerce-accent);
  background: var(--commerce-accent-soft);
  border-radius: 8px;
  font-size: 22px;
}
.showcase-product strong {
  font-size: 14px;
}
.showcase-product small {
  max-width: 220px;
  color: var(--commerce-muted);
  font-size: 10px;
  line-height: 1.5;
  text-align: center;
}
.showcase-flow-arrow {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 50%;
  font-size: 18px;
}
.showcase-output-grid {
  position: relative;
  display: grid;
  min-width: 0;
  height: 100%;
  min-height: 320px;
  grid-template-columns: 1.15fr 1fr;
  grid-template-rows: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.showcase-output-grid article {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  justify-content: flex-end;
  gap: 5px;
  padding: 12px;
  overflow: hidden;
  color: var(--commerce-ink);
  background: #f0f3f7;
  border: 1px solid var(--commerce-line);
  border-radius: 8px;
  flex-direction: column;
}
.showcase-output-grid article.featured {
  grid-row: 1 / -1;
  justify-content: center;
  align-items: center;
  background: #f8fafc;
  text-align: center;
}
.showcase-output-grid article > span {
  position: absolute;
  top: 9px;
  left: 9px;
  color: var(--commerce-accent-ink);
  font-size: 9px;
  font-weight: 850;
}
.showcase-output-grid article > i {
  color: var(--commerce-accent);
  font-size: 18px;
}
.showcase-output-grid article.featured > i {
  font-size: 42px;
}
.showcase-output-grid article strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.showcase-output-grid article small {
  overflow: hidden;
  color: var(--commerce-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.showcase-output-grid.is-single article.featured {
  grid-column: 1 / -1;
}
.showcase-more {
  position: absolute;
  right: 9px;
  bottom: 9px;
  padding: 4px 7px;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border-radius: 5px;
  font-size: 9px;
  font-weight: 800;
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
  border-bottom: 0;
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
  background: var(--commerce-soft);
  border: 0;
  border-radius: 8px;
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
  border: 0;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 800;
}
.result-main {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) 64px;
  overflow: hidden;
  transition: grid-template-columns 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.result-main.revision-is-open {
  grid-template-columns: minmax(0, 1fr) clamp(304px, 22vw, 344px);
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
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  place-items: center;
  overflow: hidden;
}
.result-stage.is-single .result-image-card {
  width: auto;
  height: 82%;
  max-width: 82%;
  max-height: 82%;
}
.result-stage.is-double {
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  width: min(760px, 100%);
  justify-self: center;
}
.result-stage.is-quad {
  grid-template-columns: repeat(2, minmax(160px, 1fr));
  grid-template-rows: repeat(2, max-content);
  grid-auto-flow: column;
  align-content: start;
  max-width: 760px;
  width: 100%;
  justify-self: center;
}
.result-stage.is-multi {
  grid-template-columns: none;
  grid-template-rows: repeat(2, max-content);
  grid-auto-flow: column;
  grid-auto-columns: minmax(150px, 1fr);
  grid-auto-rows: max-content;
  align-content: start;
  width: 100%;
  justify-self: stretch;
  overflow-x: auto;
  overflow-y: hidden;
}
.result-stage:is(.is-double, .is-quad, .is-multi) .result-image-card {
  align-self: start;
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
  border: 0;
  border-radius: 8px;
  box-shadow: var(--commerce-shadow-result);
  contain: layout paint style;
  isolation: isolate;
  transition:
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.result-image-card:hover,
.result-image-card:focus-within {
  border-color: var(--commerce-accent-line);
  box-shadow: 0 22px 52px color-mix(in srgb, var(--commerce-accent) 18%, transparent);
}
.result-image-hit-area {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: inherit;
  cursor: zoom-in;
  font: inherit;
  text-align: inherit;
}
.result-image-pending {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--commerce-muted);
}
.result-image-pending small {
  position: relative;
  z-index: 3;
  font-size: 11px;
}
.result-image-hit-area:focus-visible {
  outline: 2px solid var(--commerce-accent);
  outline-offset: -3px;
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
  object-fit: contain;
  object-position: center;
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
.revision-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  padding: 14px 12px;
  overflow-y: auto;
  background: var(--commerce-panel);
  border-left: 0;
  box-shadow: -10px 0 28px rgb(58 51 112 / 5%);
  flex-direction: column;
}
.revision-panel.open {
  padding: 22px 20px 18px;
}
.revision-panel > header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.revision-panel__toggle {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  color: var(--commerce-accent-ink);
  background: var(--commerce-accent-soft);
  border: 0;
  border-radius: 8px;
  font-size: 16px;
}
.revision-panel__toggle:hover {
  background: color-mix(in srgb, var(--commerce-accent) 18%, var(--commerce-panel));
}
.revision-panel__title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.revision-panel:not(.open) .revision-panel__title {
  display: none;
}
.revision-panel > header small {
  color: var(--commerce-muted);
  font-size: 9px;
}
.revision-panel > header strong {
  color: var(--commerce-ink);
  font-size: 14px;
}
.revision-panel__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.revision-panel__body > p:not(.revision-error) {
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
.result-strip__item {
  position: relative;
  width: 66px;
  height: 66px;
  flex: 0 0 auto;
}
.result-strip__select {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 3px;
  overflow: hidden;
  background: var(--commerce-soft);
  border: 2px solid transparent;
  border-radius: 7px;
}
.result-strip__select.active {
  border-color: var(--commerce-accent);
}
.result-strip__select:hover,
.result-strip__select:focus-visible {
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
.result-strip__select:hover :deep(img),
.result-strip__select:focus-visible :deep(img) {
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
  display: grid;
  width: 21px;
  height: 21px;
  place-items: center;
  padding: 0;
  color: #fff;
  background: rgb(20 22 25 / 72%);
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  font-size: 10px;
}
.result-strip__item:hover .result-delete,
.result-strip__item:focus-within .result-delete,
.result-delete:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.result-delete:hover,
.result-delete:focus-visible {
  background: #d94a4a;
  outline: none;
}
.result-delete:disabled {
  cursor: wait;
  opacity: 1;
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
  border-bottom: 0;
  box-shadow: 0 6px 22px rgb(58 51 112 / 4%);
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
  border: 0;
  border-radius: 8px;
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
  background: var(--commerce-soft);
  border: 0;
  border-radius: 8px;
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
  border: 0;
  border-radius: 8px;
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
.workspace-library__inline-error {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 9px 11px;
  color: #b73636;
  background: color-mix(in srgb, #b73636 8%, var(--commerce-panel));
  border: 1px solid color-mix(in srgb, #b73636 22%, var(--commerce-line));
  border-radius: 7px;
  font-size: 10px;
}
.workspace-library__inline-error > span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-library__inline-error button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  color: #b73636;
  background: transparent;
  border: 1px solid color-mix(in srgb, #b73636 28%, var(--commerce-line));
  border-radius: 5px;
  font-size: 9px;
  font-weight: 750;
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
  background: var(--commerce-soft);
  border: 0;
  border-radius: 8px;
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
  border: 0;
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
  grid-template-columns: 0.75fr 1.15fr 0.75fr;
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
.asset-card__actions button.danger {
  color: #b73636;
  background: color-mix(in srgb, #b73636 8%, var(--commerce-panel));
}
.asset-card__actions button.danger:hover:not(:disabled) {
  color: #fff;
  background: #c94747;
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
  background: var(--commerce-soft);
  border: 0;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 750;
}
.is-spinning {
  animation: commerce-spin 0.8s linear infinite;
}
.mobile-pane-switch {
  display: none;
}
.mobile-tool-switch {
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
  --commerce-line: rgb(255 255 255 / 10%);
  --commerce-panel: rgb(22 20 34 / 88%);
  --commerce-canvas: #0c0a12;
  --commerce-soft: #1a1726;
  --commerce-soft-strong: #242033;
  --commerce-ink: rgb(255 255 255 / 94%);
  --commerce-muted: rgb(255 255 255 / 56%);
  --commerce-accent: #8b7bff;
  --commerce-accent-ink: #aa9fff;
  --commerce-accent-soft: rgb(109 92 255 / 18%);
  --commerce-accent-line: rgb(139 123 255 / 34%);
  --commerce-success: #70c697;
  --commerce-warning: #e5bd78;
  --commerce-shadow-control: 0 3px 14px rgb(0 0 0 / 28%);
  --commerce-shadow-footer: 0 -10px 30px rgb(0 0 0 / 26%);
  --commerce-shadow-panel: 0 16px 42px rgb(0 0 0 / 34%);
  --commerce-shadow-result: 0 20px 48px rgb(0 0 0 / 44%);
  --commerce-shadow-card: 0 12px 32px rgb(0 0 0 / 30%);
  --commerce-settings-surface: rgb(22 20 34 / 90%);
  --commerce-settings-control: rgb(40 37 54 / 78%);
  --commerce-settings-line: rgb(255 255 255 / 9%);
  --commerce-settings-primary: var(--commerce-accent);
  --commerce-settings-primary-ink: #fff;
  --commerce-rail-fade: #12101c;
  --commerce-panel-solid: #161222;
  --commerce-cost-bg: color-mix(in srgb, var(--commerce-warning) 18%, #1a1726);
  --commerce-section-fill: color-mix(in srgb, #1a1726 78%, transparent);
  --commerce-showcase-dock: color-mix(in srgb, #161222 96%, transparent);
  --commerce-canvas-panel: color-mix(in srgb, #161222 62%, transparent);
  --commerce-showcase-card: color-mix(in srgb, #1a1726 82%, transparent);
  --commerce-footer-fill: color-mix(in srgb, var(--commerce-settings-surface) 94%, #12101c);
  color-scheme: dark;
}
:global(html.color-scheme-dark .commerce-studio .commerce-atmosphere__glow--a) {
  background: radial-gradient(circle, rgb(124 92 255 / 28%), transparent 68%);
}
:global(html.color-scheme-dark .commerce-studio .commerce-atmosphere__glow--b) {
  background: radial-gradient(circle, rgb(45 212 191 / 14%), transparent 70%);
}
:global(html.color-scheme-dark .commerce-studio .commerce-atmosphere__grain) {
  opacity: 0.05;
}
:global(html.color-scheme-dark .commerce-studio .commerce-header),
:global(html.color-scheme-dark .commerce-studio .commerce-rail),
:global(html.color-scheme-dark .commerce-studio .commerce-settings),
:global(html.color-scheme-dark .commerce-studio .commerce-canvas) {
  box-shadow: 0 14px 36px rgb(0 0 0 / 34%);
}
:global(html.color-scheme-dark .commerce-studio .commerce-header__actions) {
  background: color-mix(in srgb, #1a1726 80%, transparent);
}
:global(html.color-scheme-dark .commerce-studio .commerce-rail a.active .commerce-rail__icon),
:global(html.color-scheme-dark .commerce-studio .commerce-rail button.active .commerce-rail__icon) {
  box-shadow: 0 8px 18px rgb(0 0 0 / 36%);
}
:global(html.color-scheme-dark .commerce-studio .generate-button:hover:not(:disabled)) {
  filter: brightness(1.08);
}
:global(html.color-scheme-dark .commerce-studio .showcase-demo__stage) {
  box-shadow:
    0 20px 52px rgb(0 0 0 / 48%),
    0 4px 16px rgb(0 0 0 / 28%);
}
:global(html.color-scheme-dark .commerce-studio .showcase-demo__stage:hover) {
  box-shadow:
    0 26px 60px rgb(0 0 0 / 56%),
    0 8px 20px rgb(0 0 0 / 32%);
}
:global(html.color-scheme-dark .commerce-studio .showcase-demo__tag) {
  color: rgb(255 255 255 / 92%);
  background: rgb(22 20 34 / 82%);
  border-color: rgb(255 255 255 / 12%);
  box-shadow: 0 8px 18px rgb(0 0 0 / 32%);
}
:global(html.color-scheme-dark .commerce-studio .settings-scroll),
:global(html.color-scheme-dark .commerce-studio .revision-panel),
:global(html.color-scheme-dark .commerce-studio .workspace-library__body),
:global(html.color-scheme-dark .commerce-studio .result-stage),
:global(html.color-scheme-dark .commerce-studio .result-strip) {
  scrollbar-color: #4b4a56 transparent;
}
:global(html.color-scheme-dark .commerce-studio .commerce-settings) {
  box-shadow: none;
}
:global(html.color-scheme-dark .commerce-studio input),
:global(html.color-scheme-dark .commerce-studio textarea),
:global(html.color-scheme-dark .commerce-studio select) {
  caret-color: var(--commerce-accent-ink);
}
:global(html.color-scheme-dark .commerce-studio .product-upload) {
  background: color-mix(in srgb, var(--commerce-settings-control) 72%, transparent);
  border-color: var(--commerce-settings-line);
}
:global(html.color-scheme-dark .commerce-studio .canvas-source),
:global(html.color-scheme-dark .commerce-studio .canvas-target),
:global(html.color-scheme-dark .commerce-studio .asset-card) {
  border-color: #32313a;
}
:global(html.color-scheme-dark .commerce-studio .result-stage) {
  background: var(--commerce-canvas);
}
:global(html.color-scheme-dark .commerce-studio .result-strip),
:global(html.color-scheme-dark .commerce-studio .workspace-library__header),
:global(html.color-scheme-dark .commerce-studio .result-workspace > header) {
  background: var(--commerce-panel);
}
:global(html.color-scheme-dark .commerce-studio .result-stage img) {
  box-shadow: var(--commerce-shadow-result);
}
:global(html.color-scheme-dark .commerce-studio .asset-card__media) {
  background: #1d1d23;
}
:global(html.color-scheme-dark .commerce-studio .showcase-demo__caption-copy > strong) {
  color: var(--commerce-ink);
}
:global(html.color-scheme-dark .commerce-studio .mobile-pane-switch button) {
  color: var(--commerce-muted);
}
:global(html.color-scheme-dark .commerce-studio .mobile-pane-switch button.active) {
  color: var(--commerce-accent-ink);
}
@media (max-width: 1120px) and (min-width: 861px) {
  .commerce-layout {
    grid-template-columns: 82px clamp(326px, 34vw, 370px) minmax(0, 1fr);
  }
  .commerce-rail {
    margin: 6px 4px 6px 6px;
  }
  .commerce-rail__scroll {
    padding: 8px 6px;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .commerce-rail a,
  .commerce-rail button {
    min-height: 58px;
    padding: 6px 3px 6px;
  }
  .commerce-rail__icon {
    width: 24px;
    height: 24px;
  }
  .commerce-rail__icon i {
    font-size: 16px;
  }
  .commerce-rail__label {
    font-size: 10px;
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
  .canvas-showcase {
    width: calc(100% - 28px);
    grid-template-columns: minmax(170px, 0.8fr) 36px minmax(250px, 1.2fr);
    gap: 10px;
    padding: 16px;
  }
  .canvas-showcase.is-demo {
    width: calc(100% - 28px);
  }
  .result-main {
    display: block;
    overflow-y: auto;
  }
  .result-stage {
    min-height: 430px;
  }
  .revision-panel {
    min-height: 62px;
    padding: 12px 18px;
    overflow: visible;
    border-top: 1px solid var(--commerce-line);
    border-left: 0;
  }
  .revision-panel.open {
    min-height: 390px;
    padding: 18px 20px;
  }
  .revision-panel:not(.open) > header {
    justify-content: flex-start;
  }
  .revision-panel:not(.open) .revision-panel__title {
    display: flex;
  }
  .revision-panel:not(.open) .revision-panel__title small {
    display: none;
  }
}
@media (max-width: 860px) {
  .commerce-studio {
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .commerce-atmosphere__glow--a,
  .commerce-atmosphere__glow--b {
    opacity: 0.55;
  }
  .commerce-header {
    display: none;
  }
  .commerce-header__actions {
    display: none;
  }
  .commerce-settings,
  .commerce-canvas {
    margin: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .mobile-pane-switch {
    z-index: 19;
    display: grid;
    height: 44px;
    grid-template-columns: repeat(5, minmax(0, 1fr));
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
  .mobile-tool-switch {
    display: grid;
    min-height: 94px;
    grid-auto-columns: 88px;
    grid-auto-flow: column;
    grid-template-rows: repeat(2, 40px);
    align-items: stretch;
    gap: 5px;
    padding: 5px 10px 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    background: var(--commerce-panel);
    border-bottom: 1px solid var(--commerce-line);
    scrollbar-width: thin;
    flex: 0 0 94px;
  }
  .mobile-tool-switch button {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    padding: 0 8px;
    color: var(--commerce-muted);
    background: var(--commerce-soft);
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .mobile-tool-switch button i {
    color: var(--commerce-muted);
    font-size: 14px;
  }
  .mobile-tool-switch button.active {
    color: var(--commerce-accent-ink);
    background: var(--commerce-accent-soft);
    border-color: var(--commerce-accent-line);
  }
  .mobile-tool-switch button.active i {
    color: var(--commerce-accent);
  }
  .mobile-tool-switch button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
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
  .commerce-settings {
    margin: 0;
    border: 0;
    border-radius: 0;
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
    border-radius: 0;
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
  .canvas-showcase {
    width: 100%;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-top: 18px;
    padding: 14px;
  }
  .canvas-showcase.is-demo {
    width: 100%;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  .showcase-demo__stage {
    aspect-ratio: 1400 / 788;
  }
  .showcase-demo__caption {
    position: static;
    min-height: 0;
    flex-wrap: wrap;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }
  .showcase-demo__tag {
    min-height: 20px;
    padding: 0 7px;
    font-size: 9px;
  }
  .showcase-demo__tag.tag-1,
  .showcase-demo__tag.tag-2,
  .showcase-demo__tag.tag-3 {
    top: 8px;
  }
  .showcase-demo__tag.tag-1 {
    left: 8px;
  }
  .showcase-demo__tag.tag-3 {
    right: 8px;
  }
  .showcase-demo__caption > strong {
    white-space: normal;
  }
  .showcase-demo__caption > button {
    width: 100%;
    grid-row: auto;
    grid-column: auto;
    margin-top: 5px;
  }
  .showcase-product {
    min-height: 240px;
  }
  .showcase-flow-arrow {
    width: 36px;
    height: 36px;
    margin: -2px auto;
    transform: rotate(90deg);
  }
  .showcase-output-grid {
    min-height: 360px;
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
  .canvas-intro > div:first-child > p {
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
  .result-stage.is-single .result-image-card {
    width: auto;
    height: 88%;
    max-width: 92%;
    max-height: 88%;
  }
  .result-stage.is-double {
    grid-template-columns: repeat(2, minmax(132px, 1fr));
    align-content: start;
  }
  .result-stage.is-quad {
    grid-template-columns: repeat(2, minmax(132px, 1fr));
    max-width: none;
    align-content: start;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .result-stage.is-multi {
    grid-template-columns: none;
    grid-template-rows: repeat(2, max-content);
    grid-auto-columns: minmax(132px, 1fr);
    align-content: start;
  }
  .result-image-card {
    border-radius: 11px;
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
    min-height: 62px;
    padding: 12px 14px;
    overflow: visible;
    border-top: 1px solid var(--commerce-line);
    border-left: 0;
  }
  .revision-panel.open {
    min-height: 410px;
    padding: 18px 16px;
  }
  .revision-panel:not(.open) .revision-panel__title {
    display: flex;
  }
  .revision-panel:not(.open) .revision-panel__title small {
    display: none;
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
