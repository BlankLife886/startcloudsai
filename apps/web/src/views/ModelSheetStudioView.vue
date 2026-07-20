<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { defineAsyncComponent } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import AspectRatioSelect from '@/features/ai-wallpaper/components/AspectRatioSelect.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import { createLocalUpscaledImage } from '@/features/ai-wallpaper/services/localImageUpscale'
import { uploadAiInputFile } from '@/services/aiWallpaper'

const LocalMaskEditorDialog = defineAsyncComponent(
  () => import('@/features/ai-wallpaper/components/LocalMaskEditorDialog.vue'),
)
import { readImageFile } from '@/features/design-workshop/imageWorkshop'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { listPromptLibrary } from '@/services/promptLibrary'
import { listMyShareAssets, submitShareItem } from '@/services/shareGallery'
import notificationService from '@/services/notification'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '@/lib/anime'

const {
  authStore,
  creditsPrompt,
  modelId, models, status, error, running, cancelling, historyLoading, historyHasMore,
  outputs, activeOutput,
  outputJobIds, outputGroups, batchProgress,
  initialize, generate: generateImage, generateBatch, generateMaskedEdit,
  cancel: cancelGeneration,
  deleteOutput, formatCostEstimate, loadHistory, loadMoreHistory,
} = useCreativeImageJob({
  source: 'ultra-model-sheet',
  featureKey: 'ai.ultraModelSheet',
  jobKindPrefix: 'ultra-reference',
})

const SETTINGS_KEY = 'ultra-model-sheet-studio-v1'
const LABELS_KEY = 'ultra-model-sheet-labels-v1'

const VIEW_OPTIONS = [
  { id: 'front', label: '正面', en: 'F', icon: 'bi-person-standing' },
  { id: 'side', label: '侧面', en: 'S', icon: 'bi-person-walking' },
  { id: 'back', label: '背面', en: 'B', icon: 'bi-person-standing' },
  { id: 'three-quarter', label: '3/4', en: 'Q', icon: 'bi-badge-3d' },
  { id: 'detail', label: '细节', en: 'D', icon: 'bi-zoom-in' },
  { id: 'material', label: '材质', en: 'M', icon: 'bi-layers' },
]

const VIEW_EN = {
  front: 'FRONT',
  side: 'SIDE',
  back: 'BACK',
  'three-quarter': '3/4',
  detail: 'DETAIL',
  material: 'MATERIAL',
}

const ASPECT_OPTIONS = ['16:9', '21:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
const ASPECT_SELECT_OPTIONS = ASPECT_OPTIONS.map((value) => ({ value }))

const BRIEF_EXAMPLES = [
  { label: '机甲角色', text: '全身机甲战士角色，硬表面装甲，可动关节结构清晰，冷灰主色配警示橙细节' },
  { label: '国风少女', text: '国风水墨风格少女角色，长发束带，襦裙层次分明，服饰纹样与配饰结构完整' },
  { label: '产品设备', text: '便携咖啡机产品，铝合金外壳，可拆卸水箱和滤杯，接缝与按键布局清晰' },
]

const fileInput = ref(null)
// 多参考图：最多 4 张（本地文件 / 云端引用混合），首张为主参考
const referenceItems = ref([])
const MAX_REFERENCES = 4
// 主体档案：可复用的角色/产品档案
const SUBJECTS_KEY = 'ultra-model-sheet-subjects-v1'
const subjects = ref([])
const activeSubjectId = ref('')
const subjectNameDraft = ref('')
const subjectSaveOpen = ref(false)
const subjectSaving = ref(false)
const subjectDeleteArmId = ref('')
let subjectDeleteTimer = 0
// 图形优化
const maskEditorOpen = ref(false)
const enhanceMenuOpen = ref(false)
const enhanceBusy = ref(false)
const enhanceProgress = ref(0)
const customViews = ref([])
const customViewDraft = ref('')
const customViewInputOpen = ref(false)
const promptPreviewOpen = ref(false)
const galleryBodyRef = ref(null)
const gallerySentinelRef = ref(null)
let galleryObserver = null
const subjectType = ref('character')
const fidelity = ref('strict')
const aspectRatio = ref('16:9')
const detail = ref(85)
const outputMode = ref('board')
const boardCount = ref(1)
const prompt = ref('保留原始主体的身份、比例、材质和结构特征，制作可供后续建模与生产使用的超高清标准模型参考图。')
const selectedViews = ref(['front', 'side', 'back', 'three-quarter'])
const outputLabels = ref({})
const studioRoot = ref(null)
const localError = ref('')
const fullscreenOpen = ref(false)
const dragOver = ref(false)
const background = ref('gray')
const retryViews = ref([])
const pendingDeleteUrl = ref('')
const galleryQuery = ref('')
let pendingDeleteTimer = 0

// —— 右栏三块：词库 / 历史 / 资产 ——
const panelTab = ref('history')
const promptItems = ref([])
const promptLoading = ref(false)
const promptHasMore = ref(false)
const promptPage = ref(1)
const promptQuery = ref('')
const promptLoaded = ref(false)
const myAssets = ref([])
const assetsLoading = ref(false)
const assetsLoaded = ref(false)
const publishOpen = ref(false)
const publishTargetUrl = ref('')
const submittingShare = ref(false)

const BACKGROUND_OPTIONS = [
  { id: 'gray', label: '浅灰' },
  { id: 'white', label: '纯白' },
  { id: 'transparent', label: '透明' },
]

// —— 刷新不丢状态：恢复上次的参数与标签，进行中的云端任务由 composable 自动接管 ——
try {
  const saved = JSON.parse(getScopedLocalItem(SETTINGS_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    if (typeof saved.prompt === 'string' && saved.prompt.trim()) prompt.value = saved.prompt
    if (['character', 'object'].includes(saved.subjectType)) subjectType.value = saved.subjectType
    if (['strict', 'enhance'].includes(saved.fidelity)) fidelity.value = saved.fidelity
    if (ASPECT_OPTIONS.includes(saved.aspectRatio)) aspectRatio.value = saved.aspectRatio
    if (Number.isFinite(saved.detail)) detail.value = Math.min(100, Math.max(40, saved.detail))
    if (['board', 'separate'].includes(saved.outputMode)) outputMode.value = saved.outputMode
    if ([1, 2, 3, 4].includes(saved.boardCount)) boardCount.value = saved.boardCount
    if (BACKGROUND_OPTIONS.some((item) => item.id === saved.background)) background.value = saved.background
    if (Array.isArray(saved.customViews)) {
      customViews.value = saved.customViews
        .filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string')
        .slice(0, 8)
    }
    if (Array.isArray(saved.selectedViews)) {
      const valid = saved.selectedViews.filter(
        (id) =>
          VIEW_OPTIONS.some((view) => view.id === id) ||
          customViews.value.some((view) => view.id === id),
      )
      if (valid.length) selectedViews.value = valid
    }
    if (Array.isArray(saved.referenceItems)) {
      referenceItems.value = saved.referenceItems
        .filter((item) => item && item.type === 'url' && typeof item.url === 'string' && item.url)
        .slice(0, MAX_REFERENCES)
        .map((item) => ({ id: item.id || `ref-${Math.random().toString(36).slice(2, 8)}`, type: 'url', url: item.url }))
    }
    if (typeof saved.activeSubjectId === 'string') activeSubjectId.value = saved.activeSubjectId
  }
} catch {
  /* 忽略损坏的本地存档 */
}
try {
  const savedSubjects = JSON.parse(getScopedLocalItem(SUBJECTS_KEY) || 'null')
  if (Array.isArray(savedSubjects)) {
    subjects.value = savedSubjects
      .filter((item) => item && typeof item.id === 'string' && typeof item.url === 'string')
      .slice(0, 12)
  }
} catch {
  /* 忽略 */
}

function persistSubjects() {
  setScopedLocalItem(SUBJECTS_KEY, JSON.stringify(subjects.value.slice(0, 12)))
}
try {
  const savedLabels = JSON.parse(getScopedLocalItem(LABELS_KEY) || 'null')
  if (savedLabels && typeof savedLabels === 'object') outputLabels.value = savedLabels
} catch {
  /* 忽略 */
}

// 设置持久化做防抖：避免输入提示词时每个按键都同步序列化 + 写 localStorage。
let settingsSaveTimer = 0
watch(
  [prompt, subjectType, fidelity, aspectRatio, detail, outputMode, boardCount, background, selectedViews, customViews, referenceItems, activeSubjectId],
  () => {
    window.clearTimeout(settingsSaveTimer)
    settingsSaveTimer = window.setTimeout(() => {
      setScopedLocalItem(
        SETTINGS_KEY,
        JSON.stringify({
          prompt: prompt.value,
          subjectType: subjectType.value,
          fidelity: fidelity.value,
          aspectRatio: aspectRatio.value,
          detail: detail.value,
          outputMode: outputMode.value,
          boardCount: boardCount.value,
          background: background.value,
          selectedViews: selectedViews.value,
          customViews: customViews.value,
          // 本地文件无法跨会话恢复，只持久化云端引用
          referenceItems: referenceItems.value
            .filter((item) => item.type === 'url')
            .map((item) => ({ id: item.id, type: 'url', url: item.url })),
          activeSubjectId: activeSubjectId.value,
        }),
      )
    }, 400)
  },
  { deep: true },
)

watch(outputLabels, (value) => {
  const entries = Object.entries(value || {})
  const trimmed = entries.length > 240 ? Object.fromEntries(entries.slice(-240)) : value
  setScopedLocalItem(LABELS_KEY, JSON.stringify(trimmed))
})

const hasReference = computed(() => referenceItems.value.length > 0)
const referenceFiles = computed(() =>
  referenceItems.value.filter((item) => item.type === 'file').map((item) => item.file),
)
const referenceUrls = computed(() =>
  referenceItems.value.filter((item) => item.type === 'url').map((item) => item.url),
)
const activeSubject = computed(
  () => subjects.value.find((item) => item.id === activeSubjectId.value) || null,
)
const allViewOptions = computed(() => [
  ...VIEW_OPTIONS,
  ...customViews.value.map((view) => ({ ...view, en: view.label, icon: 'bi-bookmark-star' })),
])
const silhouetteViews = computed(() => {
  const views = selectedViews.value
    .slice(0, 4)
    .map((id) => VIEW_EN[id] || allViewOptions.value.find((view) => view.id === id)?.label || id)
  return views.length ? views : ['FRONT', 'SIDE', 'BACK']
})
const activeIndex = computed(() => outputs.value.indexOf(activeOutput.value))
const sheetNumber = computed(() =>
  activeIndex.value >= 0 ? `NO.${String(activeIndex.value + 1).padStart(3, '0')}` : 'NO.000',
)
const subjectLine = computed(() =>
  hasReference.value
    ? '严格以提供的参考图为唯一主体来源。'
    : '参考图未提供，请完全根据上方文字描述创建主体，并在整套输出中保持该主体一致。',
)
const backgroundLine = computed(() => {
  if (background.value === 'white') return '纯白背景'
  if (background.value === 'transparent') return '透明背景（输出透明 PNG）'
  return '纯浅灰背景'
})
const transparentEnabled = computed(() => background.value === 'transparent')
// 细节强度直接映射 gpt-image 的 quality 档位，而不是只写进提示词。
const qualityLevel = computed(() => {
  const value = Number(detail.value) || 85
  if (value >= 75) return 'high'
  if (value >= 55) return 'medium'
  return 'low'
})
const qualityLabel = computed(() =>
  qualityLevel.value === 'high' ? '高' : qualityLevel.value === 'medium' ? '中' : '低',
)
const selectedViewLabels = computed(() =>
  selectedViews.value
    .map((id) => allViewOptions.value.find((view) => view.id === id)?.label || id)
    .join('、'),
)
const estimatedUnits = computed(() =>
  outputMode.value === 'board' ? boardCount.value : Math.max(1, selectedViews.value.length),
)
const costLabel = computed(() => formatCostEstimate(estimatedUnits.value))
const showBatchProgress = computed(
  () => running.value && batchProgress.value.length > 1,
)
const batchDoneCount = computed(
  () => batchProgress.value.filter((entry) => entry.status === 'done').length,
)
const PROGRESS_TEXT = {
  pending: '等待',
  running: '生成中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}
// —— 分组：同一批 / 同一任务的多张图在画廊合成一张卡 ——
const galleryGroups = computed(() => {
  const map = new Map()
  outputs.value.forEach((url, index) => {
    const gid = outputGroups.value[url] || url
    if (!map.has(gid)) map.set(gid, { id: gid, urls: [], firstIndex: index })
    map.get(gid).urls.push(url)
  })
  return Array.from(map.values()).map((group) => ({ ...group, cover: group.urls[0] }))
})
const filteredGroups = computed(() => {
  const query = galleryQuery.value.trim().toLowerCase()
  if (!query) return galleryGroups.value
  return galleryGroups.value.filter((group) =>
    group.urls.some((url, index) => {
      const label = String(outputLabels.value[url] || `no.${group.firstIndex + index + 1}`)
      return label.toLowerCase().includes(query)
    }),
  )
})
const activeGroup = computed(() => {
  const gid = outputGroups.value[activeOutput.value] || ''
  if (!gid) return null
  const group = galleryGroups.value.find((item) => item.id === gid)
  return group && group.urls.length > 1 ? group : null
})

function groupLabel(group) {
  const cover = group.cover
  const base = outputLabels.value[cover] || `NO.${String(group.firstIndex + 1).padStart(2, '0')}`
  return group.urls.length > 1 ? `${base} 等 ${group.urls.length} 张` : base
}

const filteredPrompts = computed(() => {
  const query = promptQuery.value.trim().toLowerCase()
  if (!query) return promptItems.value
  return promptItems.value.filter((item) =>
    `${item?.title || ''} ${item?.prompt || ''}`.toLowerCase().includes(query),
  )
})
const publishJobId = computed(() => String(outputJobIds.value[publishTargetUrl.value] || ''))

function openPublish(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  if (!outputJobIds.value[target]) {
    notificationService.warning('这张图缺少云端任务信息，暂时无法发布')
    return
  }
  publishTargetUrl.value = target
  publishOpen.value = true
}

async function submitPublish(payload) {
  if (!publishJobId.value || submittingShare.value) return
  submittingShare.value = true
  try {
    await submitShareItem({
      jobId: publishJobId.value,
      styleLabel: '模型设定图',
      ...payload,
    })
    publishOpen.value = false
    publishTargetUrl.value = ''
    notificationService.success('已提交到广场审核，通过后会公开展示')
    assetsLoaded.value = false
    if (panelTab.value === 'assets') void loadMyAssets()
  } catch (caught) {
    notificationService.error(caught?.message || '发布失败，请稍后重试')
  } finally {
    submittingShare.value = false
  }
}

function switchPanelTab(tab) {
  panelTab.value = tab
  if (tab === 'prompts' && !promptLoaded.value) void loadPromptEntries(true)
  if (tab === 'assets' && !assetsLoaded.value) void loadMyAssets()
}

async function loadPromptEntries(reset = false) {
  if (promptLoading.value) return
  promptLoading.value = true
  try {
    const nextPage = reset ? 1 : promptPage.value + 1
    const response = await listPromptLibrary('model_sheet', { pageNumber: nextPage, pageSize: 24 })
    const incoming = Array.isArray(response?.items) ? response.items : []
    promptItems.value = reset
      ? incoming
      : Array.from(new Map([...promptItems.value, ...incoming].map((item) => [item.id, item])).values())
    promptPage.value = Number(response?.page || nextPage)
    promptHasMore.value = response?.hasMore === true
    promptLoaded.value = true
  } catch (caught) {
    if (reset) promptItems.value = []
    notificationService.error(caught?.message || '提示词库读取失败')
  } finally {
    promptLoading.value = false
  }
}

function usePromptEntry(item) {
  const text = String(item?.prompt || '').trim()
  if (!text) return
  prompt.value = text
  notificationService.success('已填入提示词，可继续修改后生成')
}

async function loadMyAssets() {
  if (assetsLoading.value) return
  // 未登录时接口必然 401，直接显示空态提示即可
  if (!authStore.isAuthenticated) {
    myAssets.value = []
    assetsLoaded.value = true
    return
  }
  assetsLoading.value = true
  try {
    const response = await listMyShareAssets({ page: 1, pageSize: 48 })
    const items = Array.isArray(response?.items) ? response.items : []
    // 只显示从本工作台推送到广场的资产。
    myAssets.value = items.filter((item) => String(item?.kind || '').startsWith('ultra-reference'))
    assetsLoaded.value = true
  } catch (caught) {
    notificationService.error(caught?.message || '我的资产读取失败')
  } finally {
    assetsLoading.value = false
  }
}

function assetStatusLabel(statusValue) {
  if (statusValue === 'approved') return '已发布'
  if (statusValue === 'rejected') return '未通过'
  return '审核中'
}
const finalPrompt = computed(() => `${prompt.value}
${subjectLine.value}
主体类型：${subjectType.value === 'character' ? '人物/角色' : '物体/产品'}。
输出视角：${selectedViewLabels.value}。
还原策略：${fidelity.value === 'strict' ? '严格忠于参考图，不改变身份和造型' : '保持主体特征并进行专业生产级优化'}。
细节强度：${detail.value}/100。
制作标准：单张完整模型设定板，正交视图比例一致，无遮挡，边缘清晰，中性影棚光，${backgroundLine.value}，无景深，无文字水印，超高清纹理，适合 3D 建模、雕刻、材质拆解和 LoRA 数据准备。`)
const frameStyle = computed(() => {
  const [width = 1, height = 1] = aspectRatio.value.split(':').map(Number)
  const ratio = width / Math.max(1, height)
  // 预览框在固定高度的查看器内自适应：切换比例只改变内部框，不改变页面布局。
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 176px) * ${ratio}))`,
  }
})
const generateLabel = computed(() => {
  if (running.value) return '渲染中…'
  if (outputMode.value === 'board') return boardCount.value > 1 ? `生成 ${boardCount.value} 个方案` : '生成设定板'
  return `生成 ${selectedViews.value.length} 张视图`
})

useStudioMotion(studioRoot, activeOutput)

// —— GSAP 动效编排：入场时间线 + quickTo 指针视差 + 渲染特效 ——
let motionCtx = null
let renderCtx = null
let parallaxSetters = []

// —— Canvas 粒子场：斜向星尘带（数百颗带景深的光点，单画布 + GSAP ticker） ——
let fxCanvas = null
let fxCtx = null
let fxParticles = []
let fxSprites = []
let fxTickerFn = null
let fxWidth = 0
let fxHeight = 0

function buildParticleSprites() {
  // 预渲染三种光晕贴图（冷白 / 冰蓝 / 信号橙），运行时只做 drawImage。
  return ['244, 246, 252', '168, 198, 255', '255, 150, 92'].map((rgb) => {
    const sprite = document.createElement('canvas')
    sprite.width = 64
    sprite.height = 64
    const context = sprite.getContext('2d')
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, `rgba(${rgb}, 1)`)
    gradient.addColorStop(0.32, `rgba(${rgb}, 0.5)`)
    gradient.addColorStop(1, `rgba(${rgb}, 0)`)
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
    return sprite
  })
}

function spawnFxParticle(initial = false) {
  const roll = Math.random()
  // 大颗散景少量、中等适中、微尘最多——参考银河尘埃带的粒径分布。
  const radius =
    roll < 0.1
      ? 3.5 + Math.random() * 5.5
      : roll < 0.34
        ? 1.6 + Math.random() * 1.8
        : 0.5 + Math.random() * 1.1
  const spriteRoll = Math.random()
  return {
    u: initial ? Math.random() : -0.05,
    v: (Math.random() + Math.random() + Math.random() - 1.5) / 1.5,
    speed: 0.006 + Math.random() * 0.02,
    radius,
    sprite: spriteRoll < 0.62 ? 0 : spriteRoll < 0.92 ? 1 : 2,
    // 大颗散景更透明，模拟失焦景深
    baseAlpha: radius > 3 ? 0.16 + Math.random() * 0.2 : 0.35 + Math.random() * 0.45,
    twinkle: 1.2 + Math.random() * 2.4,
    phase: Math.random() * Math.PI * 2,
    wobble: (Math.random() - 0.5) * 0.05,
  }
}

function startParticleField(overlay) {
  const rect = overlay.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 40) return
  fxCanvas = document.createElement('canvas')
  fxCanvas.className = 'ms3-fx-canvas'
  const dpr = Math.min(1.5, window.devicePixelRatio || 1)
  fxWidth = rect.width
  fxHeight = rect.height
  fxCanvas.width = Math.round(rect.width * dpr)
  fxCanvas.height = Math.round(rect.height * dpr)
  overlay.appendChild(fxCanvas)
  fxCtx = fxCanvas.getContext('2d')
  if (!fxCtx) return
  fxCtx.scale(dpr, dpr)
  if (!fxSprites.length) fxSprites = buildParticleSprites()
  const count = Math.round(Math.min(620, Math.max(220, (fxWidth * fxHeight) / 2400)))
  fxParticles = Array.from({ length: count }, () => spawnFxParticle(true))

  // 尘埃带：从左下角流向右上角，右上端更亮更密（对应参考图的光核）
  const ax = -0.08 * fxWidth
  const ay = 0.88 * fxHeight
  const bx = 1.08 * fxWidth
  const by = 0.1 * fxHeight
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  const perpX = -dy / length
  const perpY = dx / length
  const bandWidth = Math.min(fxHeight * 0.3, 260)

  let elapsed = 0
  fxTickerFn = (_time, deltaMs) => {
    if (!fxCtx) return
    const dt = Math.min(64, deltaMs) / 1000
    elapsed += dt
    fxCtx.clearRect(0, 0, fxWidth, fxHeight)
    fxCtx.globalCompositeOperation = 'lighter'
    for (let index = 0; index < fxParticles.length; index += 1) {
      const p = fxParticles[index]
      p.u += p.speed * dt * 6
      p.v += p.wobble * dt
      if (p.u > 1.05) {
        fxParticles[index] = spawnFxParticle(false)
        continue
      }
      const x = ax + dx * p.u + perpX * p.v * bandWidth
      const y = ay + dy * p.u + perpY * p.v * bandWidth
      if (x < -20 || x > fxWidth + 20 || y < -20 || y > fxHeight + 20) continue
      // 沿带越靠后越亮 + 各自闪烁
      const flow = 0.3 + 0.7 * p.u
      const tw = 0.62 + 0.38 * Math.sin(elapsed * p.twinkle + p.phase)
      fxCtx.globalAlpha = Math.min(1, p.baseAlpha * flow * tw)
      const size = p.radius * 2
      fxCtx.drawImage(fxSprites[p.sprite], x - p.radius, y - p.radius, size, size)
    }
    fxCtx.globalAlpha = 1
    fxCtx.globalCompositeOperation = 'source-over'
  }
  gsap.ticker.add(fxTickerFn)
}

function stopParticleField() {
  if (fxTickerFn) gsap.ticker.remove(fxTickerFn)
  fxTickerFn = null
  fxCanvas?.remove()
  fxCanvas = null
  fxCtx = null
  fxParticles = []
}

function setupPageMotion() {
  const root = studioRoot.value
  if (!root || prefersReducedMotion()) return
  motionCtx = gsap.context(() => {
    // 三栏与内部元素的入场编排
    gsap
      .timeline({ defaults: { ease: 'power3.out' } })
      .from('.ms3-panel', { x: -40, autoAlpha: 0, duration: 0.7 })
      .from('.ms3-stage', { y: 30, autoAlpha: 0, duration: 0.7 }, '-=0.54')
      .from('.ms3-gallery', { x: 40, autoAlpha: 0, duration: 0.7 }, '-=0.58')
      .from(
        '.ms3-panel .ms3-block',
        { y: 18, autoAlpha: 0, stagger: 0.055, duration: 0.5, clearProps: 'transform,opacity,visibility' },
        '-=0.48',
      )
      .from('.ms3-frame', { scale: 0.95, autoAlpha: 0, duration: 0.85, ease: 'expo.out' }, '-=0.62')
      .from('.ms3-spec', { y: -14, autoAlpha: 0, duration: 0.5 }, '-=0.55')

    // 指针跟随只保留用户视线所在的画布：轻微 3D 倾斜 + 规格卡漂浮。
    // 大面积背景层已移除——被面板挡住看不见，还会拖慢合成。
    gsap.set('.ms3-frame', { transformPerspective: 1100 })
    parallaxSetters = []
    const bind = (selector, prop, amplitude, axis, duration = 0.6) => {
      const targets = root.querySelectorAll(selector)
      if (!targets.length) return
      const to = gsap.quickTo(targets, prop, { duration, ease: 'power3' })
      parallaxSetters.push({ to, amplitude, axis })
    }
    bind('.ms3-frame', 'rotationY', 3, 'x', 0.75)
    bind('.ms3-frame', 'rotationX', -2.2, 'y', 0.75)
    bind('.ms3-spec', 'x', 10, 'x', 0.5)
    bind('.ms3-spec', 'y', 8, 'y', 0.5)
  }, root)
}

function handleParallax(event) {
  if (!parallaxSetters.length) return
  const x = event.clientX / window.innerWidth - 0.5
  const y = event.clientY / window.innerHeight - 0.5
  for (const setter of parallaxSetters) {
    setter.to((setter.axis === 'x' ? x : y) * setter.amplitude)
  }
}

// —— 渲染特效：多阶段仪器序列（GSAP 时间线 + anime.js 粒子） ——
const elapsedSeconds = ref(0)
const elapsedLabel = computed(() => {
  const minutes = Math.floor(elapsedSeconds.value / 60)
  const seconds = elapsedSeconds.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
let elapsedTimer = 0
const RENDER_PHASES = ['锁定 LOCK', '扫描 SCAN', '合成 SYNTH', '校验 VERIFY']

function startRenderFx() {
  const overlay = studioRoot.value?.querySelector('.ms3-rendering')
  if (!overlay) return
  stopRenderFx()
  elapsedSeconds.value = 0
  elapsedTimer = window.setInterval(() => {
    elapsedSeconds.value += 1
  }, 1000)
  if (prefersReducedMotion()) return
  renderCtx = gsap.context(() => {
    // HUD 读出条从画布底边升起
    gsap.from('.ms3-hud', { yPercent: 110, autoAlpha: 0, duration: 0.55, ease: 'power3.out' })

    // 双向测量光束持续扫掠
    gsap.fromTo(
      '.ms3-beam.is-h',
      { top: '4%' },
      { top: '96%', duration: 2.6, repeat: -1, yoyo: true, ease: 'sine.inOut' },
    )
    gsap.fromTo(
      '.ms3-beam.is-v',
      { left: '4%' },
      { left: '96%', duration: 3.4, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 0.6 },
    )

    // 相位标签循环
    const phaseEl = overlay.querySelector('.ms3-render-phase')
    if (phaseEl) {
      let phaseIndex = 0
      const cyclePhase = gsap.timeline({ repeat: -1, repeatDelay: 2.1 })
      cyclePhase
        .to(phaseEl, { autoAlpha: 0, y: -6, duration: 0.22, ease: 'power2.in' })
        .call(() => {
          phaseIndex = (phaseIndex + 1) % RENDER_PHASES.length
          phaseEl.textContent = RENDER_PHASES[phaseIndex]
        })
        .fromTo(phaseEl, { y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' })
    }

    gsap.fromTo(
      '.ms3-render-bar i',
      { xPercent: -120 },
      { xPercent: 360, duration: 1.4, repeat: -1, ease: 'power1.inOut' },
    )
    gsap.to('.ms3-render-dot', {
      scale: 0.72,
      opacity: 0.4,
      duration: 0.55,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    gsap.from('.ms3-hud-chip', {
      y: 10,
      autoAlpha: 0,
      stagger: 0.06,
      duration: 0.35,
      ease: 'power2.out',
      delay: 0.3,
    })
  }, overlay)

  // 斜向星尘粒子带（Canvas，参考银河散景质感）
  startParticleField(overlay)
}

function stopRenderFx() {
  renderCtx?.revert()
  renderCtx = null
  window.clearInterval(elapsedTimer)
  elapsedTimer = 0
  stopParticleField()
}

watch(running, async (value) => {
  if (value) {
    await nextTick()
    startRenderFx()
  } else {
    stopRenderFx()
  }
})

// 每完成一张：白闪 + 计时数字弹跳，给出明确的阶段性反馈
watch(batchDoneCount, (next, previous) => {
  if (!running.value || next <= (previous || 0) || prefersReducedMotion()) return
  const overlay = studioRoot.value?.querySelector('.ms3-rendering')
  if (!overlay) return
  const flash = overlay.querySelector('.ms3-flash')
  if (flash) {
    gsap.fromTo(flash, { opacity: 0.55 }, { opacity: 0, duration: 0.6, ease: 'power2.out' })
  }
  const timer = overlay.querySelector('.ms3-render-timer')
  if (timer) {
    gsap.fromTo(timer, { scale: 1.18 }, { scale: 1, duration: 0.5, ease: 'back.out(2)' })
  }
  const count = overlay.querySelector('.ms3-render-count')
  if (count) {
    gsap.fromTo(count, { scale: 1.3 }, { scale: 1, duration: 0.45, ease: 'back.out(2)' })
  }
})

// —— 历史滚动加载：画廊触底自动翻页 ——
function setupGalleryObserver() {
  galleryObserver?.disconnect()
  const rootEl = galleryBodyRef.value
  const target = gallerySentinelRef.value
  if (!rootEl || !target) return
  galleryObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (historyLoading.value || !historyHasMore.value) return
      void loadMoreHistory().catch(() => null)
    },
    { root: rootEl, rootMargin: '160px' },
  )
  galleryObserver.observe(target)
}

watch([panelTab, gallerySentinelRef], () => {
  if (panelTab.value === 'history') setupGalleryObserver()
  else galleryObserver?.disconnect()
})

onMounted(() => {
  initialize()
  setupPageMotion()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('pointermove', handleParallax, { passive: true })
  setupGalleryObserver()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('pointermove', handleParallax)
  stopRenderFx()
  motionCtx?.revert()
  parallaxSetters = []
  galleryObserver?.disconnect()
})

function handleKeydown(event) {
  if (event.key === 'Escape' && fullscreenOpen.value) {
    fullscreenOpen.value = false
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !running.value) {
    event.preventDefault()
    generate()
  }
}

async function acceptFiles(files) {
  const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ''))
  for (const file of incoming) {
    if (referenceItems.value.length >= MAX_REFERENCES) break
    const preview = await readImageFile(file)
    referenceItems.value = [
      ...referenceItems.value,
      { id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, type: 'file', file, preview },
    ]
  }
  localError.value = ''
}

async function chooseFile(event) {
  await acceptFiles(event.target.files)
  if (fileInput.value) fileInput.value.value = ''
}

async function handleDrop(event) {
  dragOver.value = false
  await acceptFiles(event.dataTransfer?.files)
}

function removeReference(id) {
  referenceItems.value = referenceItems.value.filter((item) => item.id !== id)
  if (!referenceItems.value.length) activeSubjectId.value = ''
}

function clearSource() {
  referenceItems.value = []
  activeSubjectId.value = ''
  localError.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function useOutputAsReference() {
  const url = String(activeOutput.value || '').trim()
  if (!url) return
  if (referenceItems.value.some((item) => item.type === 'url' && item.url === url)) return
  if (referenceItems.value.length >= MAX_REFERENCES) {
    localError.value = `参考图最多 ${MAX_REFERENCES} 张，请先移除一张`
    return
  }
  referenceItems.value = [
    ...referenceItems.value,
    { id: `ref-${Date.now().toString(36)}`, type: 'url', url },
  ]
  localError.value = ''
}

// —— 主体档案 ——
async function saveCurrentAsSubject() {
  const name = subjectNameDraft.value.trim().slice(0, 16)
  if (!name || subjectSaving.value) return
  subjectSaving.value = true
  try {
    let url = referenceUrls.value[0] || ''
    if (!url && referenceFiles.value[0]) {
      url = await uploadAiInputFile(referenceFiles.value[0], { featureKey: 'ai.ultraModelSheet' })
    }
    if (!url) url = String(activeOutput.value || '').trim()
    if (!url) {
      notificationService.warning('请先导入参考图或选中一张生成结果')
      return
    }
    const subject = {
      id: `sub-${Date.now().toString(36)}`,
      name,
      url,
      description: prompt.value.trim().slice(0, 400),
      createdAt: new Date().toISOString(),
    }
    subjects.value = [subject, ...subjects.value].slice(0, 12)
    persistSubjects()
    activeSubjectId.value = subject.id
    subjectNameDraft.value = ''
    subjectSaveOpen.value = false
    notificationService.success(`主体档案「${name}」已保存，之后可一键复用`)
  } catch (caught) {
    notificationService.error(caught?.message || '主体档案保存失败')
  } finally {
    subjectSaving.value = false
  }
}

function applySubject(subject) {
  if (!subject?.url) return
  referenceItems.value = [{ id: `ref-${Date.now().toString(36)}`, type: 'url', url: subject.url }]
  if (subject.description) prompt.value = subject.description
  activeSubjectId.value = subject.id
  localError.value = ''
  notificationService.success(`已切换到主体「${subject.name}」`)
}

function updateSubjectStandard() {
  const subject = activeSubject.value
  const url = String(activeOutput.value || '').trim()
  if (!subject || !url) return
  subjects.value = subjects.value.map((item) =>
    item.id === subject.id ? { ...item, url, updatedAt: new Date().toISOString() } : item,
  )
  persistSubjects()
  notificationService.success(`已把当前图设为「${subject.name}」的标准参考`)
}

function requestDeleteSubject(subject) {
  if (subjectDeleteArmId.value !== subject.id) {
    subjectDeleteArmId.value = subject.id
    window.clearTimeout(subjectDeleteTimer)
    subjectDeleteTimer = window.setTimeout(() => {
      subjectDeleteArmId.value = ''
    }, 3200)
    return
  }
  window.clearTimeout(subjectDeleteTimer)
  subjectDeleteArmId.value = ''
  subjects.value = subjects.value.filter((item) => item.id !== subject.id)
  if (activeSubjectId.value === subject.id) activeSubjectId.value = ''
  persistSubjects()
}

// —— 图形优化：局部修正 + 本地高清导出 ——
async function submitMaskEdit(payload) {
  if (running.value) return
  maskEditorOpen.value = false
  const sourceUrl = String(activeOutput.value || '').trim()
  const generated = await generateMaskedEdit({
    sourceUrl,
    maskFile: payload?.maskFile,
    prompt: payload?.prompt,
    aspectRatio: aspectRatio.value,
    quality: qualityLevel.value,
    viewLabel: `${outputLabels.value[sourceUrl] || '视图'} 修正`,
  })
  if (generated?.length) {
    outputLabels.value = {
      ...outputLabels.value,
      ...Object.fromEntries(
        generated.map((url) => [url, `${outputLabels.value[sourceUrl] || '视图'} 修正`]),
      ),
    }
    notificationService.success('局部修正完成，已并入同组视图')
  }
}

async function enhanceDownload(scale) {
  const sourceUrl = String(activeOutput.value || '').trim()
  if (!sourceUrl || enhanceBusy.value) return
  enhanceMenuOpen.value = false
  enhanceBusy.value = true
  enhanceProgress.value = 0
  try {
    const result = await createLocalUpscaledImage({
      sourceUrl,
      resolutionScale: scale,
      transparentPng: transparentEnabled.value,
      onProgress: (percent) => {
        enhanceProgress.value = Math.round(percent)
      },
    })
    if (result.skipped || !result.file) {
      notificationService.info('原图已达到该档位分辨率，直接下载原图')
      await downloadAuthenticatedMedia(sourceUrl, `ultra-model-sheet-${scale}-${Date.now()}.png`)
      return
    }
    const objectUrl = URL.createObjectURL(result.file)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `ultra-model-sheet-${scale}-${result.targetWidth}x${result.targetHeight}.png`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
    notificationService.success(`已增强到 ${result.targetWidth}×${result.targetHeight} 并开始下载`)
  } catch (caught) {
    notificationService.error(caught?.message || '高清增强失败')
  } finally {
    enhanceBusy.value = false
  }
}

function applyBriefExample(text) {
  prompt.value = `${text}。保留主体的身份、比例、材质和结构特征，制作可供建模与生产使用的超高清标准模型参考图。`
  localError.value = ''
}

function toggleView(id) {
  selectedViews.value = selectedViews.value.includes(id)
    ? selectedViews.value.filter((item) => item !== id)
    : [...selectedViews.value, id]
}

function buildSeparateViewPrompt(view, { chained = false } = {}) {
  const subject = chained
    ? '严格以提供的参考图为唯一主体来源，保持同一人物/物体、同一服装、同一材质。'
    : subjectLine.value
  return `${prompt.value}
${subject}
本次只生成一个独立的「${view.label}」视图，不要拼图、不要分镜、不要在同一画面放多个角度。
主体类型：${subjectType.value === 'character' ? '人物/角色' : '物体/产品'}。
还原策略：${fidelity.value === 'strict' ? '严格忠于参考图，不改变身份、造型、比例、服装和材质' : '保持主体身份与关键特征并进行专业生产级优化'}。
细节强度：${detail.value}/100。
制作标准：主体完整、居中、无遮挡，中性影棚光，${backgroundLine.value}，无景深，无文字水印。必须与同批次其他视图保持同一主体、同一服装、同一材质、同一比例和同一光照。`
}

const lastBatchGroupId = ref('')

async function runSeparateViews(views, { sourceOverride = '', groupId = '' } = {}) {
  const batchSourceUrls = [...referenceUrls.value, ...(sourceOverride ? [sourceOverride] : [])]
  const hasAnyReference = Boolean(referenceFiles.value.length || batchSourceUrls.length)
  // 没有参考图时把第一张成功视图接力当参考，保证整批是同一个主体。
  const chainViews = !hasAnyReference && views.length > 1
  const result = await generateBatch(
    views.map((view, index) => ({
      prompt: buildSeparateViewPrompt(view, {
        chained: Boolean(sourceOverride) || (chainViews && index > 0),
      }),
      aspectRatio: aspectRatio.value,
      count: 1,
      transparentPngEnabled: transparentEnabled.value,
      quality: qualityLevel.value,
      viewId: view.id,
      viewLabel: view.label,
      outputMode: 'separate',
    })),
    {
      files: referenceFiles.value,
      sourceUrls: batchSourceUrls,
      concurrency: 1,
      chainFirstOutputAsSource: chainViews,
      groupId,
    },
  )
  lastBatchGroupId.value = result.groupId || lastBatchGroupId.value
  const labels = { ...outputLabels.value }
  for (const item of result.items || []) {
    for (const url of item.outputs || []) labels[url] = item.viewLabel || '独立视图'
  }
  outputLabels.value = labels
  retryViews.value = (result.failures || [])
    .map((failure) => allViewOptions.value.find((view) => view.id === failure?.item?.viewId))
    .filter(Boolean)
  return result
}

const modelSelectOptions = computed(() =>
  models.value.map((model) => ({ value: model.id, label: model.label })),
)

function addCustomView() {
  const label = customViewDraft.value.trim().slice(0, 12)
  if (!label) return
  if (allViewOptions.value.some((view) => view.label === label)) {
    customViewDraft.value = ''
    return
  }
  const view = { id: `custom-${Date.now().toString(36)}`, label }
  customViews.value = [...customViews.value, view].slice(0, 8)
  selectedViews.value = [...selectedViews.value, view.id]
  customViewDraft.value = ''
  customViewInputOpen.value = false
}

function removeCustomView(id) {
  customViews.value = customViews.value.filter((view) => view.id !== id)
  selectedViews.value = selectedViews.value.filter((item) => item !== id)
}

async function downloadGroup(group) {
  if (!group?.urls?.length) return
  localError.value = ''
  try {
    for (const [index, url] of group.urls.entries()) {
      const label = outputLabels.value[url] || `view-${index + 1}`
      // 顺序触发，避免浏览器拦截并发下载。
      await downloadAuthenticatedMedia(url, `ultra-model-sheet-${label}-${index + 1}.png`)
    }
  } catch (caught) {
    localError.value = caught?.message || '整组下载失败'
  }
}

async function generate() {
  localError.value = ''
  retryViews.value = []
  if (!selectedViews.value.length) {
    localError.value = '请至少选择一个输出视角'
    return
  }
  if (!hasReference.value && !prompt.value.trim()) {
    localError.value = '请导入参考主体，或在描述中说明要创建的主体'
    return
  }
  if (outputMode.value === 'separate') {
    const views = selectedViews.value
      .map((id) => allViewOptions.value.find((view) => view.id === id))
      .filter(Boolean)
    await runSeparateViews(views)
    return
  }
  const generated = await generateImage({
    prompt: finalPrompt.value,
    files: referenceFiles.value,
    sourceUrls: referenceUrls.value,
    aspectRatio: aspectRatio.value,
    count: boardCount.value,
    transparentPngEnabled: transparentEnabled.value,
    quality: qualityLevel.value,
    outputMode: 'board',
  })
  if (generated?.length) {
    outputLabels.value = {
      ...outputLabels.value,
      ...Object.fromEntries(generated.map((url) => [url, '设定板'])),
    }
  }
}

async function retryFailedViews() {
  if (running.value || !retryViews.value.length) return
  localError.value = ''
  // 补齐失败视图时锚定已成功的输出作为参考，并归入同一组，避免主体漂移和分组割裂。
  const sourceOverride = hasReference.value ? '' : activeOutput.value || outputs.value[0] || ''
  await runSeparateViews(retryViews.value, { sourceOverride, groupId: lastBatchGroupId.value })
}

function requestDeleteGroup(group) {
  if (running.value) return
  if (pendingDeleteUrl.value !== group.id) {
    pendingDeleteUrl.value = group.id
    window.clearTimeout(pendingDeleteTimer)
    pendingDeleteTimer = window.setTimeout(() => {
      pendingDeleteUrl.value = ''
    }, 3200)
    return
  }
  window.clearTimeout(pendingDeleteTimer)
  pendingDeleteUrl.value = ''
  ;(async () => {
    for (const url of group.urls) {
      // deleteOutput 会按任务级联移除同任务的所有图，已被移除的跳过。
      if (outputs.value.includes(url)) await deleteOutput(url)
    }
  })().catch((caught) => {
    localError.value = caught?.message || '历史输出删除失败'
  })
}

async function downloadOutput() {
  if (!activeOutput.value) return
  localError.value = ''
  const label = outputLabels.value[activeOutput.value] || 'board'
  try {
    await downloadAuthenticatedMedia(activeOutput.value, `ultra-model-sheet-${label}-${Date.now()}.png`)
  } catch (caught) {
    localError.value = caught?.message || '模型图下载失败'
  }
}

function selectOutput(output) {
  activeOutput.value = output
  localError.value = ''
}

function refreshHistory() {
  if (historyLoading.value) return
  void loadHistory().catch(() => null)
}
</script>

<template>
  <main ref="studioRoot" class="ms3">
    <h1 class="ms3-visually-hidden">超高清模型图</h1>

    <!-- 左：参数面板 -->
    <aside class="ms3-panel">
      <div class="ms3-panel-scroll">
        <section class="ms3-block">
          <div class="ms3-block-head">
            <span>参考主体</span>
            <em v-if="referenceItems.length">{{ referenceItems.length }}/{{ MAX_REFERENCES }} 张</em>
            <em v-else>可选</em>
          </div>
          <div
            v-if="referenceItems.length"
            class="ms3-ref-grid"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="handleDrop"
          >
            <div v-for="(item, index) in referenceItems" :key="item.id" class="ms3-ref-slot">
              <AuthenticatedImage v-if="item.type === 'url'" :src="item.url" alt="参考主体" :max-dimension="240" />
              <img v-else :src="item.preview" alt="参考主体" />
              <span v-if="index === 0" class="ms3-ref-primary">主</span>
              <button type="button" class="ms3-source-del" title="移除这张参考" @click="removeReference(item.id)">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
            <button
              v-if="referenceItems.length < MAX_REFERENCES"
              type="button"
              class="ms3-ref-add"
              :class="{ 'is-over': dragOver }"
              title="再添加一张参考图（正面照 / 侧面照 / 材质细节）"
              @click="fileInput?.click()"
            >
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
            </button>
          </div>
          <button
            v-else
            type="button"
            class="ms3-upload"
            :class="{ 'is-over': dragOver }"
            @click="fileInput?.click()"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="handleDrop"
          >
            <i class="bi bi-image" aria-hidden="true"></i>
            <strong>点击 / 拖拽图片到这里</strong>
            <small>支持多张（正面 / 侧面 / 材质），不导入时按下方描述创建主体</small>
          </button>
          <input ref="fileInput" hidden type="file" accept="image/*" multiple @change="chooseFile" />

          <!-- 主体档案 -->
          <div class="ms3-subjects">
            <div class="ms3-subjects-head">
              <span><i class="bi bi-person-badge" aria-hidden="true"></i>主体档案</span>
              <button
                v-if="!subjectSaveOpen"
                type="button"
                :disabled="!hasReference && !activeOutput"
                title="把当前参考与描述存为可复用的主体档案"
                @click="subjectSaveOpen = true"
              >
                <i class="bi bi-plus-lg" aria-hidden="true"></i>存档
              </button>
            </div>
            <div v-if="subjectSaveOpen" class="ms3-subject-save">
              <input
                v-model="subjectNameDraft"
                type="text"
                maxlength="16"
                placeholder="档案名（如：星轨机械师）"
                aria-label="主体档案名称"
                @keydown.enter.prevent="saveCurrentAsSubject"
                @keydown.esc="subjectSaveOpen = false"
              />
              <button type="button" :disabled="!subjectNameDraft.trim() || subjectSaving" @click="saveCurrentAsSubject">
                {{ subjectSaving ? '保存中…' : '保存' }}
              </button>
              <button type="button" class="is-ghost" @click="subjectSaveOpen = false">取消</button>
            </div>
            <p v-if="!subjects.length && !subjectSaveOpen" class="ms3-subjects-empty">
              还没有档案：导入参考图或生成后点「存档」，同一角色可反复出图
            </p>
            <div v-else-if="subjects.length" class="ms3-subject-row">
              <button
                v-for="subject in subjects"
                :key="subject.id"
                type="button"
                class="ms3-subject-card"
                :class="{ 'is-on': subject.id === activeSubjectId }"
                :title="`使用主体「${subject.name}」`"
                @click="applySubject(subject)"
              >
                <AuthenticatedImage :src="subject.url" alt="" :max-dimension="120" loading="lazy" />
                <span>{{ subject.name }}</span>
                <b
                  role="button"
                  tabindex="0"
                  :class="{ 'is-armed': subjectDeleteArmId === subject.id }"
                  :title="subjectDeleteArmId === subject.id ? '再点一次确认删除' : '删除档案'"
                  @click.stop="requestDeleteSubject(subject)"
                  @keydown.enter.stop="requestDeleteSubject(subject)"
                >
                  <i class="bi" :class="subjectDeleteArmId === subject.id ? 'bi-question-lg' : 'bi-x'" aria-hidden="true"></i>
                </b>
              </button>
            </div>
            <button
              v-if="activeSubject && activeOutput"
              type="button"
              class="ms3-subject-update"
              :title="`把画布当前图设为「${activeSubject.name}」的标准参考`"
              @click="updateSubjectStandard"
            >
              <i class="bi bi-bookmark-check" aria-hidden="true"></i>设当前图为「{{ activeSubject.name }}」标准参考
            </button>
          </div>
        </section>

        <section class="ms3-block">
          <div class="ms3-block-head"><span>主体描述</span><em>{{ prompt.length }}/1500</em></div>
          <textarea v-model="prompt" class="ms3-textarea" rows="4" maxlength="1500" placeholder="描述主体与制作要求…"></textarea>
          <div class="ms3-chips">
            <button v-for="example in BRIEF_EXAMPLES" :key="example.label" type="button" @click="applyBriefExample(example.text)">
              {{ example.label }}
            </button>
          </div>
        </section>

        <section class="ms3-block">
          <div class="ms3-block-head"><span>输出方式</span></div>
          <div class="ms3-seg">
            <button type="button" :class="{ 'is-on': outputMode === 'board' }" @click="outputMode = 'board'">单张设定板</button>
            <button type="button" :class="{ 'is-on': outputMode === 'separate' }" @click="outputMode = 'separate'">多张独立视图</button>
          </div>
          <div v-if="outputMode === 'board'" class="ms3-row">
            <span>方案数量</span>
            <div class="ms3-seg is-mini">
              <button v-for="count in [1, 2, 3, 4]" :key="count" type="button" :class="{ 'is-on': boardCount === count }" @click="boardCount = count">
                {{ count }}
              </button>
            </div>
          </div>
          <p v-else class="ms3-note">每个视角单独出图，共 {{ selectedViews.length }} 张，自动保持同一主体</p>
        </section>

        <section class="ms3-block">
          <div class="ms3-block-head"><span>输出视角</span><em>{{ selectedViews.length }}/6</em></div>
          <div class="ms3-views">
            <button
              v-for="view in allViewOptions"
              :key="view.id"
              type="button"
              class="ms3-view-chip"
              :class="{ 'is-on': selectedViews.includes(view.id) }"
              :aria-pressed="selectedViews.includes(view.id)"
              @click="toggleView(view.id)"
            >
              <i class="bi" :class="view.icon" aria-hidden="true"></i>
              <span>{{ view.label }}</span>
              <b
                v-if="view.id.startsWith('custom-')"
                role="button"
                tabindex="0"
                title="删除自定义视角"
                @click.stop="removeCustomView(view.id)"
                @keydown.enter.stop="removeCustomView(view.id)"
              >
                <i class="bi bi-x" aria-hidden="true"></i>
              </b>
            </button>
            <button
              v-if="!customViewInputOpen && customViews.length < 8"
              type="button"
              class="ms3-view-add"
              title="添加自定义视角（如：俯视 / 战斗姿态）"
              @click="customViewInputOpen = true"
            >
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>自定义</span>
            </button>
          </div>
          <div v-if="customViewInputOpen" class="ms3-view-input">
            <input
              v-model="customViewDraft"
              type="text"
              maxlength="12"
              placeholder="如：俯视 / 战斗姿态"
              aria-label="自定义视角名称"
              @keydown.enter.prevent="addCustomView"
              @keydown.esc="customViewInputOpen = false"
            />
            <button type="button" :disabled="!customViewDraft.trim()" @click="addCustomView">添加</button>
            <button type="button" class="is-ghost" @click="customViewInputOpen = false">取消</button>
          </div>
        </section>

        <section class="ms3-block">
          <div class="ms3-row">
            <span>主体类型</span>
            <div class="ms3-seg is-mini">
              <button type="button" :class="{ 'is-on': subjectType === 'character' }" @click="subjectType = 'character'">人物</button>
              <button type="button" :class="{ 'is-on': subjectType === 'object' }" @click="subjectType = 'object'">物体</button>
            </div>
          </div>
          <div class="ms3-row">
            <span>输出比例</span>
            <AspectRatioSelect
              v-model="aspectRatio"
              class="ms3-select-pop"
              :options="ASPECT_SELECT_OPTIONS"
              aria-label="输出比例"
            />
          </div>
          <div class="ms3-row">
            <span>背景</span>
            <div class="ms3-seg is-mini">
              <button
                v-for="option in BACKGROUND_OPTIONS"
                :key="option.id"
                type="button"
                :class="{ 'is-on': background === option.id }"
                :title="option.id === 'transparent' ? '输出透明 PNG' : `${option.label}背景`"
                @click="background = option.id"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="ms3-row">
            <span>还原策略</span>
            <div class="ms3-seg is-mini">
              <button type="button" :class="{ 'is-on': fidelity === 'strict' }" title="严格忠于参考图" @click="fidelity = 'strict'">严格</button>
              <button type="button" :class="{ 'is-on': fidelity === 'enhance' }" title="生产级优化" @click="fidelity = 'enhance'">优化</button>
            </div>
          </div>
          <div class="ms3-row is-slider">
            <span>细节强度</span>
            <em>{{ detail }} · {{ qualityLabel }}档</em>
            <input v-model.number="detail" type="range" min="40" max="100" aria-label="细节强度" />
          </div>
          <div class="ms3-row">
            <span>生成模型</span>
            <AspectRatioSelect
              v-model="modelId"
              class="ms3-select-pop"
              :options="modelSelectOptions"
              :show-ratio-icons="false"
              use-option-label
              aria-label="生成模型"
              placeholder="选择模型"
            />
          </div>
        </section>

        <details class="ms3-prompt-preview" :open="promptPreviewOpen">
          <summary @click.prevent="promptPreviewOpen = !promptPreviewOpen">
            <i class="bi bi-braces" aria-hidden="true"></i>查看将要发送的完整提示词
            <i class="bi bi-chevron-down" :class="{ 'is-open': promptPreviewOpen }" aria-hidden="true"></i>
          </summary>
          <pre>{{ outputMode === 'board' ? finalPrompt : `独立视图模式：每个视角单独发送一条提示词。\n—— 以「${allViewOptions.find((view) => view.id === selectedViews[0])?.label || '正面'}」为例 ——\n${buildSeparateViewPrompt(allViewOptions.find((view) => view.id === selectedViews[0]) || VIEW_OPTIONS[0])}` }}</pre>
        </details>

        <p v-if="!authStore.isAuthenticated" class="ms3-hint">
          <i class="bi bi-person-lock" aria-hidden="true"></i>登录后才能生成模型图并保留历史输出
        </p>
      </div>

      <footer class="ms3-panel-footer">
        <div class="ms3-cost"><i class="bi bi-stopwatch" aria-hidden="true"></i>约 1-2 分钟 / 张<b>·</b>{{ costLabel }}</div>
        <button class="ms3-generate" type="button" :disabled="running" @click="generate">
          <i class="bi" :class="running ? 'bi-arrow-repeat ms3-spin' : 'bi-stars'" aria-hidden="true"></i>
          <span>{{ generateLabel }}</span>
          <kbd>⌘↵</kbd>
        </button>
        <button v-if="running" class="ms3-cancel-inline" type="button" :disabled="cancelling" @click="cancelGeneration">
          {{ cancelling ? '正在取消…' : '取消生成' }}
        </button>
      </footer>
    </aside>

    <!-- 中：查看器 -->
    <section class="ms3-stage">
      <header class="ms3-stage-bar">
        <div class="ms3-stage-meta">
          <strong>超高清模型图</strong>
          <span class="ms3-tag">{{ outputMode === 'board' ? '设定板' : '独立视图' }}</span>
          <span class="ms3-tag">{{ aspectRatio }}</span>
          <span class="ms3-tag is-accent">{{ sheetNumber }}</span>
        </div>
        <div class="ms3-stage-actions">
          <button type="button" :disabled="!activeOutput || running" title="以当前结果作为参考主体继续生成" @click="useOutputAsReference">
            <i class="bi bi-pin-angle" aria-hidden="true"></i><span>用作参考</span>
          </button>
          <button type="button" :disabled="!activeOutput || running" title="涂抹修正当前图的局部（其余保持不变）" @click="maskEditorOpen = true">
            <i class="bi bi-bandaid" aria-hidden="true"></i><span>修正</span>
          </button>
          <div class="ms3-enhance" :class="{ 'is-open': enhanceMenuOpen }">
            <button
              type="button"
              :disabled="!activeOutput || enhanceBusy"
              :title="enhanceBusy ? `增强中 ${enhanceProgress}%` : '本地高清增强导出（不调用模型）'"
              @click="enhanceMenuOpen = !enhanceMenuOpen"
            >
              <i class="bi" :class="enhanceBusy ? 'bi-arrow-repeat ms3-spin' : 'bi-badge-hd'" aria-hidden="true"></i>
              <span>{{ enhanceBusy ? `${enhanceProgress}%` : '增强' }}</span>
            </button>
            <div v-if="enhanceMenuOpen" class="ms3-enhance-menu" role="menu" aria-label="高清增强档位">
              <button v-for="scale in ['2K', '4K', '8K']" :key="scale" type="button" role="menuitem" @click="enhanceDownload(scale)">
                {{ scale }}<small>{{ scale === '2K' ? '快速' : scale === '4K' ? '高清' : '极致' }}</small>
              </button>
            </div>
          </div>
          <button type="button" :disabled="!activeOutput" title="全屏查看" @click="fullscreenOpen = true">
            <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i><span>大图</span>
          </button>
          <button type="button" :disabled="!activeOutput || !outputJobIds[activeOutput]" title="发布到广场" @click="openPublish()">
            <i class="bi bi-broadcast" aria-hidden="true"></i><span>发布</span>
          </button>
          <button type="button" :disabled="!activeOutput" title="下载当前模型图" @click="downloadOutput">
            <i class="bi bi-download" aria-hidden="true"></i><span>下载</span>
          </button>
        </div>
      </header>

      <p v-if="error || localError" class="ms3-error" role="alert">
        <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
        <span>{{ localError || error }}</span>
        <button v-if="retryViews.length && !running" type="button" class="ms3-retry" @click="retryFailedViews">
          <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>重试失败视图（{{ retryViews.length }}）
        </button>
      </p>

      <div class="ms3-viewport">
        <div class="ms3-spec" aria-hidden="true">
          <div><span>视角</span><b>{{ selectedViews.length }} 组</b></div>
          <div><span>质量</span><b>{{ qualityLabel }}档 {{ detail }}</b></div>
          <div><span>背景</span><b>{{ BACKGROUND_OPTIONS.find((item) => item.id === background)?.label }}</b></div>
        </div>
        <div class="ms3-frame" :style="frameStyle">
          <i class="ms3-ruler is-top" aria-hidden="true"></i>
          <i class="ms3-ruler is-left" aria-hidden="true"></i>
          <i class="ms3-corner is-tl" aria-hidden="true"></i>
          <i class="ms3-corner is-tr" aria-hidden="true"></i>
          <i class="ms3-corner is-bl" aria-hidden="true"></i>
          <i class="ms3-corner is-br" aria-hidden="true"></i>
          <AuthenticatedImage
            v-if="activeOutput"
            data-studio-output
            :src="activeOutput"
            alt="超高清模型图"
            loading="eager"
            :retry-count="2"
            :max-dimension="1024"
            @error="localError = '结果图加载失败，请选择其他版本或重新生成'"
          />
          <div v-else class="ms3-silhouette" :style="{ gridTemplateColumns: `repeat(${silhouetteViews.length}, 1fr)` }">
            <div v-for="view in silhouetteViews" :key="view">
              <i class="bi" :class="subjectType === 'character' ? 'bi-person-standing' : 'bi-box-seam'" aria-hidden="true"></i>
              <span>{{ view }}</span>
            </div>
          </div>
          <div v-if="activeGroup && !running" class="ms3-groupbar" aria-label="同组视图切换">
            <button
              v-for="(url, index) in activeGroup.urls"
              :key="url"
              type="button"
              :class="{ 'is-on': activeOutput === url }"
              :title="outputLabels[url] || `视图 ${index + 1}`"
              @click="selectOutput(url)"
            >
              <AuthenticatedImage :src="url" alt="" :max-dimension="160" loading="lazy" />
              <em>{{ outputLabels[url] || index + 1 }}</em>
            </button>
            <button type="button" class="ms3-group-download" :title="`打包下载整组 ${activeGroup.urls.length} 张`" @click="downloadGroup(activeGroup)">
              <i class="bi bi-download" aria-hidden="true"></i>
              <em>整组</em>
            </button>
          </div>
          <div v-if="running" class="ms3-rendering" aria-live="polite">
            <span class="ms3-flash" aria-hidden="true"></span>
            <i class="ms3-beam is-h" aria-hidden="true"></i>
            <i class="ms3-beam is-v" aria-hidden="true"></i>
            <div class="ms3-hud">
              <div class="ms3-render-bar" aria-hidden="true"><i></i></div>
              <div class="ms3-hud-left">
                <span class="ms3-render-dot" aria-hidden="true"></span>
                <strong class="ms3-render-phase">锁定 LOCK</strong>
                <em class="ms3-hud-status">{{ status || '正在建立模型参考板…' }}</em>
              </div>
              <div v-if="showBatchProgress" class="ms3-hud-chips" aria-label="生成进度">
                <span
                  v-for="(entry, index) in batchProgress"
                  :key="index"
                  class="ms3-hud-chip"
                  :class="`is-${entry.status}`"
                  :title="`${entry.label} · ${PROGRESS_TEXT[entry.status] || entry.status}`"
                >
                  <i
                    class="bi"
                    :class="{
                      'bi-circle': entry.status === 'pending',
                      'bi-arrow-repeat ms3-spin': entry.status === 'running',
                      'bi-check-lg': entry.status === 'done',
                      'bi-x-lg': entry.status === 'failed',
                      'bi-dash-lg': entry.status === 'cancelled',
                    }"
                    aria-hidden="true"
                  ></i>
                  {{ entry.label }}
                </span>
              </div>
              <div class="ms3-hud-right">
                <span v-if="showBatchProgress" class="ms3-render-count">{{ batchDoneCount }}/{{ batchProgress.length }}</span>
                <b class="ms3-render-timer">{{ elapsedLabel }}</b>
                <button
                  type="button"
                  class="ms3-hud-cancel"
                  :disabled="cancelling"
                  :title="cancelling ? '正在取消…' : '取消生成'"
                  :aria-label="cancelling ? '正在取消…' : '取消生成'"
                  @click="cancelGeneration"
                >
                  <i class="bi" :class="cancelling ? 'bi-arrow-repeat ms3-spin' : 'bi-x-lg'" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 右：词库 / 历史 / 资产 -->
    <aside class="ms3-gallery">
      <div class="ms3-tabs" role="tablist" aria-label="右侧面板">
        <button type="button" :class="{ 'is-on': panelTab === 'prompts' }" @click="switchPanelTab('prompts')">
          <i class="bi bi-journal-text" aria-hidden="true"></i>词库
        </button>
        <button type="button" :class="{ 'is-on': panelTab === 'history' }" @click="switchPanelTab('history')">
          <i class="bi bi-clock-history" aria-hidden="true"></i>历史
        </button>
        <button type="button" :class="{ 'is-on': panelTab === 'assets' }" @click="switchPanelTab('assets')">
          <i class="bi bi-collection" aria-hidden="true"></i>资产
        </button>
      </div>

      <!-- 词库 -->
      <template v-if="panelTab === 'prompts'">
        <div class="ms3-gallery-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input v-model="promptQuery" type="search" placeholder="搜索提示词…" aria-label="搜索提示词" />
        </div>
        <div class="ms3-gallery-body">
          <p v-if="promptLoading && !promptItems.length" class="ms3-gallery-note"><i class="bi bi-arrow-repeat ms3-spin"></i>正在载入词库…</p>
          <p v-else-if="!promptItems.length" class="ms3-gallery-note">提示词库暂时为空<br />管理员分配后会显示在这里</p>
          <p v-else-if="!filteredPrompts.length" class="ms3-gallery-note">没有匹配「{{ promptQuery }}」的提示词</p>
          <div v-else class="ms3-prompt-list">
            <button v-for="item in filteredPrompts" :key="item.id" type="button" class="ms3-prompt-item" @click="usePromptEntry(item)">
              <strong v-if="item.title">{{ item.title }}</strong>
              <span>{{ item.prompt }}</span>
              <em><i class="bi bi-stars" aria-hidden="true"></i>点击填入</em>
            </button>
            <button v-if="promptHasMore" type="button" class="ms3-prompt-more" :disabled="promptLoading" @click="loadPromptEntries(false)">
              <i class="bi" :class="promptLoading ? 'bi-arrow-repeat ms3-spin' : 'bi-chevron-down'" aria-hidden="true"></i>
              {{ promptLoading ? '载入中…' : '加载更多' }}
            </button>
          </div>
        </div>
      </template>

      <!-- 我的资产 -->
      <template v-else-if="panelTab === 'assets'">
        <header class="ms3-gallery-head">
          <strong><i class="bi bi-collection" aria-hidden="true"></i>我的资产</strong>
          <small v-if="assetsLoading">载入中…</small>
          <small v-else>{{ myAssets.length }} 件</small>
          <button type="button" title="刷新资产" :disabled="assetsLoading" @click="loadMyAssets">
            <i class="bi bi-arrow-clockwise" :class="{ 'ms3-spin': assetsLoading }" aria-hidden="true"></i>
          </button>
        </header>
        <div class="ms3-gallery-body">
          <p v-if="assetsLoading && !myAssets.length" class="ms3-gallery-note"><i class="bi bi-arrow-repeat ms3-spin"></i>正在载入我的资产…</p>
          <p v-else-if="!authStore.isAuthenticated" class="ms3-gallery-note">登录后可查看我的资产<br />发布到广场的作品会集中显示在这里</p>
          <p v-else-if="!myAssets.length" class="ms3-gallery-note">还没有发布过作品<br />选中一张输出点「发布」，审核通过后会出现在广场</p>
          <div v-else class="ms3-gallery-grid">
            <div v-for="asset in myAssets" :key="asset.id" class="ms3-card is-asset">
              <div class="ms3-card-pick is-static">
                <AuthenticatedImage :src="asset.resultUrl" :alt="asset.title" :max-dimension="360" loading="lazy" />
              </div>
              <span class="ms3-asset-status" :data-status="asset.status">{{ assetStatusLabel(asset.status) }}</span>
              <span class="ms3-card-tag" :title="asset.title">{{ asset.title }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 历史记录 -->
      <template v-else>
        <header class="ms3-gallery-head">
          <strong><i class="bi bi-clock-history" aria-hidden="true"></i>历史记录</strong>
          <small v-if="historyLoading">载入中…</small>
          <small v-else>{{ outputs.length }} 张</small>
          <button type="button" title="刷新历史" :disabled="historyLoading" @click="refreshHistory">
            <i class="bi bi-arrow-clockwise" :class="{ 'ms3-spin': historyLoading }" aria-hidden="true"></i>
          </button>
        </header>
        <div class="ms3-gallery-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input v-model="galleryQuery" type="search" placeholder="按视角 / 标签筛选…" aria-label="筛选历史输出" />
        </div>
        <div ref="galleryBodyRef" class="ms3-gallery-body">
        <p v-if="historyLoading && !outputs.length" class="ms3-gallery-note"><i class="bi bi-arrow-repeat ms3-spin"></i>正在载入历史…</p>
        <p v-else-if="!outputs.length" class="ms3-gallery-note">还没有生成记录<br />配置左侧参数后点击「生成」</p>
        <p v-else-if="!filteredGroups.length" class="ms3-gallery-note">没有匹配「{{ galleryQuery }}」的输出</p>
        <div v-else class="ms3-gallery-grid">
          <div
            v-for="group in filteredGroups"
            :key="group.id"
            class="ms3-card"
            :class="{ 'is-on': group.urls.includes(activeOutput), 'is-stack': group.urls.length > 1 }"
          >
            <button
              type="button"
              class="ms3-card-pick"
              :aria-pressed="group.urls.includes(activeOutput)"
              :title="group.urls.length > 1 ? `包含 ${group.urls.length} 张视图，点击展开查看` : '查看'"
              @click="selectOutput(group.cover)"
            >
              <AuthenticatedImage :src="group.cover" alt="" :max-dimension="360" loading="lazy" />
            </button>
            <span v-if="group.urls.length > 1" class="ms3-card-count">
              <i class="bi bi-stack" aria-hidden="true"></i>{{ group.urls.length }}
            </span>
            <span class="ms3-card-tag">{{ groupLabel(group) }}</span>
            <button
              type="button"
              class="ms3-card-del"
              :class="{ 'is-armed': pendingDeleteUrl === group.id }"
              :title="pendingDeleteUrl === group.id ? '再点一次确认删除整组' : group.urls.length > 1 ? '删除整组输出' : '删除这张输出'"
              :aria-label="pendingDeleteUrl === group.id ? '再点一次确认删除整组' : '删除输出'"
              @click.stop="requestDeleteGroup(group)"
            >
              <i class="bi" :class="pendingDeleteUrl === group.id ? 'bi-question-lg' : 'bi-x-lg'" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div ref="gallerySentinelRef" class="ms3-gallery-sentinel" aria-hidden="true"></div>
        <p v-if="historyLoading && outputs.length" class="ms3-gallery-note is-inline">
          <i class="bi bi-arrow-repeat ms3-spin" aria-hidden="true"></i>正在加载更多…
        </p>
        <p v-else-if="!historyHasMore && outputs.length > 8" class="ms3-gallery-note is-inline">已经到底了</p>
      </div>
      </template>
    </aside>

    <LocalMaskEditorDialog
      v-if="maskEditorOpen"
      :open="maskEditorOpen"
      :source-url="activeOutput"
      :source-title="outputLabels[activeOutput] || '涂抹需要修正的区域'"
      :busy="false"
      @close="maskEditorOpen = false"
      @submit="submitMaskEdit"
    />

    <SharePublishDialog
      :open="publishOpen"
      :title="prompt.slice(0, 24) || '超高清模型图'"
      style-label="模型设定图"
      :default-category="subjectType === 'character' ? 'illustration' : 'other'"
      :suggested-tags="['模型设定图', subjectType === 'character' ? '角色三视图' : '产品设定']"
      :submitting="submittingShare"
      @close="publishOpen = false"
      @submit="submitPublish"
    />

    <Teleport to="body">
      <Transition name="ms3-zoom">
        <div
          v-if="fullscreenOpen && activeOutput"
          class="ms3-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="模型图大图"
          @click.self="fullscreenOpen = false"
        >
          <button type="button" aria-label="关闭大图" @click="fullscreenOpen = false"><i class="bi bi-x-lg"></i></button>
          <AuthenticatedImage :src="activeOutput" alt="超高清模型图大图" loading="eager" />
        </div>
      </Transition>
    </Teleport>

    <InsufficientCreditsDialog
      :show="creditsPrompt.dialogOpen.value"
      :required="creditsPrompt.requiredCredits.value"
      :available="creditsPrompt.availableCredits.value"
      @close="creditsPrompt.closePrompt"
    />
  </main>
</template>

<style scoped>
.ms3 {
  --bg: #0f0f13;
  --panel: #17171c;
  --panel-2: #1c1c22;
  --field: #121217;
  --line: #26262e;
  --line-2: #34343e;
  --ink: #f4f1ec;
  --muted: #a5a5b0;
  --dim: #6a6a74;
  --accent: #ff5c1a;
  --accent-2: #ff5c1a;
  --accent-soft: rgba(255, 92, 26, 0.13);
  --danger: #ff7d6e;
  --radius: 10px;
  --radius-sm: 8px;
  display: grid;
  grid-template-columns: 304px minmax(0, 1fr) 296px;
  gap: 12px;
  height: calc(100vh - var(--app-header-offset, 64px));
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, 'Helvetica Neue', 'PingFang SC', sans-serif;
  letter-spacing: 0;
}

.ms3-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ================= 左：参数面板 ================= */
.ms3-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow: hidden;
}

.ms3-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 6px;
  scrollbar-width: thin;
}

.ms3-block {
  padding-bottom: 14px;
}

.ms3-block + .ms3-block {
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.ms3-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}

.ms3-block-head span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}

.ms3-block-head em {
  color: var(--dim);
  font-size: 10px;
  font-style: normal;
}

/* 参考主体 */
.ms3-upload {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  width: 100%;
  min-height: 108px;
  padding: 14px;
  border: 1.5px dashed var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ms3-upload i {
  font-size: 20px;
  color: var(--accent);
}

.ms3-upload strong {
  font-size: 11.5px;
  font-weight: 600;
}

.ms3-upload small {
  color: var(--dim);
  font-size: 10px;
}

.ms3-upload:hover,
.ms3-upload.is-over {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 3px rgba(255, 92, 26, 0.08);
}

/* 多参考图槽位 */
.ms3-ref-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.ms3-ref-slot {
  position: relative;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--field);
}

.ms3-ref-slot img,
.ms3-ref-slot :deep(.authenticated-image) {
  display: block;
  width: 100%;
  aspect-ratio: 1/1;
  object-fit: cover;
}

.ms3-ref-primary {
  position: absolute;
  top: 3px;
  left: 3px;
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--accent);
  color: #1a0a02;
  font: 700 8.5px/1 monospace;
  pointer-events: none;
}

.ms3-ref-slot .ms3-source-del {
  top: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  font-size: 8px;
  opacity: 0;
}

.ms3-ref-slot:hover .ms3-source-del {
  opacity: 1;
}

.ms3-ref-add {
  display: grid;
  place-items: center;
  aspect-ratio: 1/1;
  border: 1.5px dashed var(--line-2);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--dim);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-ref-add:hover,
.ms3-ref-add.is-over {
  border-color: var(--accent);
  color: var(--accent);
}

/* 主体档案 */
.ms3-subjects {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px dashed var(--line);
}

.ms3-subjects-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ms3-subjects-head > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.ms3-subjects-head > span i {
  color: var(--accent);
}

.ms3-subjects-head button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-subjects-head button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.ms3-subjects-head button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ms3-subject-save {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.ms3-subject-save input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  color: var(--ink);
  font-size: 11px;
  outline: none;
}

.ms3-subject-save input:focus {
  border-color: var(--accent);
}

.ms3-subject-save button {
  flex: none;
  padding: 0 11px;
  border: 1px solid rgba(255, 92, 26, 0.55);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}

.ms3-subject-save button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ms3-subject-save button.is-ghost {
  border-color: var(--line-2);
  background: transparent;
  color: var(--dim);
}

.ms3-subjects-empty {
  margin: 0;
  color: var(--dim);
  font-size: 10px;
  line-height: 1.6;
}

.ms3-subject-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
  padding-bottom: 3px;
}

.ms3-subject-card {
  position: relative;
  flex: none;
  width: 64px;
  padding: 0 0 4px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.ms3-subject-card:hover {
  transform: translateY(-2px);
}

.ms3-subject-card.is-on {
  border-color: var(--accent);
}

.ms3-subject-card :deep(.authenticated-image) {
  width: 100%;
  aspect-ratio: 1/1;
  object-fit: cover;
}

.ms3-subject-card > span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: 3px 4px 0;
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms3-subject-card.is-on > span {
  color: var(--accent);
}

.ms3-subject-card > b {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #101014e0;
  color: var(--danger);
  font-size: 9px;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.ms3-subject-card:hover > b,
.ms3-subject-card > b.is-armed {
  opacity: 1;
}

.ms3-subject-card > b.is-armed {
  background: var(--danger);
  color: #23110d;
}

.ms3-subject-update {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px dashed var(--line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-subject-update:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* 高清增强菜单 */
.ms3-enhance {
  position: relative;
}

.ms3-enhance-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  gap: 2px;
  min-width: 120px;
  padding: 5px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: #141418f8;
  box-shadow: 0 16px 40px #000a;
}

.ms3-enhance-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ms3-enhance-menu button:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.ms3-enhance-menu small {
  color: var(--dim);
  font-size: 9px;
}

.ms3-source-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: #101014d9;
  color: var(--danger);
  font-size: 10px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ms3-source-del:hover {
  background: var(--danger);
  color: #23110d;
}

/* 描述 */
.ms3-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 11px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  color: var(--ink);
  font: 12px/1.65 inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.ms3-textarea:focus {
  border-color: var(--accent);
}

.ms3-textarea::placeholder {
  color: var(--dim);
}

.ms3-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ms3-chips button {
  padding: 5px 10px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ms3-chips button:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

/* 分段控件 */
.ms3-seg {
  display: flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--field);
}

.ms3-seg button {
  flex: 1;
  min-height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease, color 0.16s ease;
}

.ms3-seg button:hover:not(.is-on) {
  color: var(--ink);
}

.ms3-seg button.is-on {
  background: var(--panel-2);
  color: var(--accent);
  box-shadow: 0 0 0 1px var(--line-2), 0 2px 8px #0006;
}

.ms3-seg.is-mini button {
  min-height: 24px;
  padding: 0 7px;
  font-size: 10px;
}

/* 行式设置 */
.ms3-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.ms3-row > span {
  flex: none;
  color: var(--muted);
  font-size: 11px;
}

.ms3-row.is-slider {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
}

.ms3-row.is-slider em {
  color: var(--accent);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}

.ms3-row.is-slider input {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: var(--accent);
}

.ms3-note {
  margin: 9px 0 0;
  color: var(--dim);
  font-size: 10px;
  line-height: 1.6;
}

/* 视角多选 */
.ms3-views {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.ms3-views button {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 9px 4px 7px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  color: var(--muted);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.ms3-views button:hover {
  transform: translateY(-1px);
  color: var(--ink);
}

.ms3-views button i {
  font-size: 14px;
}

.ms3-views button span {
  font-size: 10px;
}

.ms3-views button.is-on {
  border-color: rgba(255, 92, 26, 0.55);
  background: var(--accent-soft);
  color: var(--accent);
}

.ms3-view-chip {
  position: relative;
}

.ms3-view-chip b {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 17px;
  height: 17px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--danger);
  color: #23110d;
  font-size: 10px;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.ms3-view-chip:hover b {
  opacity: 1;
}

.ms3-view-add {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  padding: 9px 4px 7px;
  border: 1.5px dashed var(--line-2);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--dim);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-view-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.ms3-view-add i {
  font-size: 13px;
}

.ms3-view-add span {
  font-size: 10px;
}

.ms3-view-input {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.ms3-view-input input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  color: var(--ink);
  font-size: 11px;
  outline: none;
}

.ms3-view-input input:focus {
  border-color: var(--accent);
}

.ms3-view-input button {
  flex: none;
  padding: 0 11px;
  border: 1px solid rgba(255, 92, 26, 0.55);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}

.ms3-view-input button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ms3-view-input button.is-ghost {
  border-color: var(--line-2);
  background: transparent;
  color: var(--dim);
}

.ms3-row.is-wrap {
  display: grid;
  gap: 6px;
}

/* 复用文生图上拉框：触发器压缩到行内尺寸并对齐本页主题 */
.ms3-select-pop {
  flex: 1;
  min-width: 0;
  max-width: 178px;
}

.ms3-select-pop :deep(.ratio-select__trigger) {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border-color: var(--line-2);
  background: var(--field);
  font-size: 11px;
}

.ms3-select-pop :deep(.ratio-select__trigger:hover) {
  border-color: #3f3f4c;
}

.ms3-select-pop.is-open :deep(.ratio-select__trigger),
.ms3-select-pop :deep(.ratio-select__trigger:focus-visible) {
  border-color: rgba(255, 92, 26, 0.65);
  box-shadow: none;
  background: var(--field);
}

.ms3-prompt-preview {
  margin: 0 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--field);
}

.ms3-prompt-preview summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  color: var(--dim);
  font-size: 10.5px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.ms3-prompt-preview summary::-webkit-details-marker {
  display: none;
}

.ms3-prompt-preview summary .bi-chevron-down {
  margin-left: auto;
  transition: transform 0.2s ease;
}

.ms3-prompt-preview summary .bi-chevron-down.is-open {
  transform: rotate(180deg);
}

.ms3-prompt-preview pre {
  margin: 0;
  padding: 0 11px 11px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.ms3-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding: 9px 11px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 10.5px;
}

.ms3-hint i {
  color: var(--accent);
}

/* 底部生成区 */
.ms3-panel-footer {
  flex: none;
  padding: 11px 14px 13px;
  border-top: 1px solid var(--line);
  background: var(--panel-2);
}

.ms3-cost {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 9px;
  color: var(--dim);
  font-size: 10px;
}

.ms3-cost b {
  color: var(--dim);
}

.ms3-cost i {
  color: var(--accent);
}

.ms3-generate {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #1a0a02;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
  box-shadow: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
}


.ms3-generate:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.ms3-generate:active:not(:disabled) {
  transform: translateY(1px) scale(0.99);
}

.ms3-generate:disabled {
  cursor: wait;
  opacity: 0.85;
}

.ms3-generate kbd {
  padding: 3px 6px;
  border: 1px solid #2a16031f;
  border-radius: 6px;
  background: #ffffff2e;
  font: 700 9px/1 monospace;
}

.ms3-cancel-inline {
  width: 100%;
  margin-top: 8px;
  padding: 7px 0;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: transparent;
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ms3-cancel-inline:hover:not(:disabled) {
  border-color: var(--danger);
  background: #ff7d6e14;
}

.ms3-cancel-inline:disabled {
  opacity: 0.55;
  cursor: wait;
}

/* ================= 中：查看器 ================= */
.ms3-stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow: hidden;
}

.ms3-stage-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}

.ms3-stage-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ms3-stage-meta strong {
  font-size: 12.5px;
  white-space: nowrap;
}

.ms3-tag {
  padding: 3px 8px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
  white-space: nowrap;
}

.ms3-tag.is-accent {
  border-color: rgba(255, 92, 26, 0.45);
  color: var(--accent);
}

.ms3-stage-actions {
  display: flex;
  gap: 7px;
}

.ms3-stage-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}

.ms3-stage-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.ms3-stage-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ms3-error {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 9px 12px;
  border: 1px solid #ff7d6e3d;
  border-radius: var(--radius-sm);
  background: #2a1512;
  color: #ffb3a5;
  font-size: 11px;
  line-height: 1.5;
}

.ms3-retry {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 4px 10px;
  border: 1px solid #ff7d6e66;
  border-radius: 999px;
  background: transparent;
  color: var(--danger);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ms3-retry:hover {
  background: var(--danger);
  color: #23110d;
}

.ms3-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 18px;
}

.ms3-spec {
  position: absolute;
  z-index: 4;
  top: 14px;
  left: 14px;
  display: grid;
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: #141418f2;
  /* 规格卡悬浮在画布之上，跟随幅度更大 */
  will-change: transform;
  pointer-events: none;
}

.ms3-spec div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.ms3-spec span {
  color: var(--dim);
  font-size: 9.5px;
}

.ms3-spec b {
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
}

.ms3-frame {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  will-change: transform;
  background-color: #121216;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 48px 48px;
  box-shadow: 0 16px 40px #0008;
  transition: aspect-ratio 0.28s ease, width 0.28s ease;
}

.ms3-frame :deep(.authenticated-image) {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ms3-silhouette {
  display: grid;
  width: 88%;
  height: 82%;
  align-items: end;
}

.ms3-silhouette div {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  border-right: 1px dashed var(--line);
}

.ms3-silhouette div:last-child {
  border: 0;
}

.ms3-silhouette i {
  font-size: clamp(64px, 10vw, 168px);
  color: #2c2c35;
}

.ms3-silhouette span {
  color: var(--dim);
  font: 700 9px/1 monospace;
  letter-spacing: 0.14em;
}

/* 渲染遮罩 */
.ms3-rendering {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  background: #0c0c10d9;
}




.ms3-render-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
  animation: ms3-dot 1.1s ease-in-out infinite;
}


.ms3-render-count {
  display: inline-block;
  padding: 3px 9px;
  border: 1px solid rgba(255, 92, 26, 0.5);
  border-radius: 6px;
  color: var(--accent);
  font: 700 10px/1 monospace;
  will-change: transform;
}

.ms3-render-bar {
  position: relative;
  height: 3px;
  margin-top: 12px;
  border-radius: 3px;
  background: #ffffff14;
  overflow: hidden;
}

.ms3-render-bar i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 42%;
  background: linear-gradient(90deg, transparent, var(--accent), #ffe9c4, var(--accent), transparent);
  animation: ms3-bar 1.5s ease-in-out infinite;
}





/* ================= 右：我的生成 ================= */
.ms3-gallery {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  overflow: hidden;
}

.ms3-tabs {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.ms3-tabs button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.ms3-tabs button:hover:not(.is-on) {
  color: var(--ink);
  background: var(--field);
}

.ms3-tabs button.is-on {
  border-color: rgba(255, 92, 26, 0.5);
  background: var(--accent-soft);
  color: var(--accent);
}

.ms3-gallery-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
}

.ms3-gallery-head strong {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.ms3-gallery-head strong i {
  color: var(--accent);
}

.ms3-gallery-head small {
  color: var(--dim);
  font-size: 10px;
}

.ms3-gallery-head button {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-gallery-head button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.ms3-gallery-head button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.ms3-gallery-search {
  flex: none;
  position: relative;
  padding: 10px 12px 0;
}

.ms3-gallery-search i {
  position: absolute;
  left: 22px;
  top: 50%;
  margin-top: 5px;
  transform: translateY(-50%);
  color: var(--dim);
  font-size: 11px;
  pointer-events: none;
}

.ms3-gallery-search input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px 0 30px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  color: var(--ink);
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s ease;
}

.ms3-gallery-search input:focus {
  border-color: var(--accent);
}

.ms3-gallery-search input::placeholder {
  color: var(--dim);
}

.ms3-gallery-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
}

.ms3-gallery-note {
  margin: 20px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--dim);
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}

.ms3-gallery-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ms3-card {
  position: relative;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  overflow: hidden;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.ms3-card:hover {
  transform: translateY(-2px);
  border-color: #3f3f4c;
  box-shadow: 0 10px 24px #000a;
}

.ms3-card.is-on {
  border-color: var(--accent);
  box-shadow: none;
}

.ms3-card-pick {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.ms3-card-pick :deep(.authenticated-image) {
  display: block;
  width: 100%;
  aspect-ratio: 1/1;
  /* 铺满卡片，不留黑边 */
  object-fit: cover;
  background: var(--field);
  transition: transform 0.3s ease;
}

.ms3-card:hover .ms3-card-pick :deep(.authenticated-image) {
  transform: scale(1.04);
}

.ms3-card-tag {
  position: absolute;
  left: 5px;
  bottom: 5px;
  max-width: calc(100% - 10px);
  overflow: hidden;
  padding: 3px 7px;
  border-radius: 6px;
  background: #101014d9;
  color: var(--muted);
  font: 700 8.5px/1.2 monospace;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.ms3-card.is-on .ms3-card-tag {
  background: var(--accent);
  color: #2a1603;
}

.ms3-card-del {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: #101014e0;
  color: var(--danger);
  font-size: 9.5px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.ms3-card:hover .ms3-card-del,
.ms3-card-del.is-armed {
  opacity: 1;
}

.ms3-card-del:hover,
.ms3-card-del.is-armed {
  background: var(--danger);
  color: #23110d;
}

/* 词库 */
.ms3-prompt-list {
  display: grid;
  gap: 8px;
}

.ms3-prompt-item {
  display: grid;
  gap: 5px;
  padding: 10px 11px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--field);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.ms3-prompt-item:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 92, 26, 0.5);
  background: var(--accent-soft);
}

.ms3-prompt-item strong {
  font-size: 11px;
}

.ms3-prompt-item span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.ms3-prompt-item em {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ms3-prompt-item:hover em {
  opacity: 1;
}

.ms3-prompt-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-prompt-more:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

/* 我的资产 */
.ms3-card.is-asset .ms3-card-pick.is-static {
  cursor: default;
}

.ms3-asset-status {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  padding: 3px 7px;
  border-radius: 6px;
  background: #101014e0;
  color: #ffd58a;
  font: 700 8.5px/1 monospace;
  pointer-events: none;
}

.ms3-asset-status[data-status='approved'] {
  color: #8ce6a8;
}

.ms3-asset-status[data-status='rejected'] {
  color: var(--danger);
}

/* ================= 渲染特效：仪器测量序列 ================= */
.ms3-flash {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: #fff;
  opacity: 0;
  pointer-events: none;
}

.ms3-beam {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

.ms3-beam.is-h {
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent) 24%, #ffd9c2 50%, var(--accent) 76%, transparent);
  box-shadow: 0 0 18px rgba(255, 92, 26, 0.55);
}

.ms3-beam.is-h::after {
  content: '';
  position: absolute;
  inset: -7px 0 auto;
  height: 16px;
  background: repeating-linear-gradient(90deg, #ffffff2e 0 1px, transparent 1px 14px);
  mask-image: linear-gradient(90deg, transparent, #000 30%, #000 70%, transparent);
}

.ms3-beam.is-v {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: linear-gradient(180deg, transparent, rgba(255, 92, 26, 0.7) 30%, #ffd9c2 50%, rgba(255, 92, 26, 0.7) 70%, transparent);
  box-shadow: 0 0 14px rgba(255, 92, 26, 0.4);
  opacity: 0.7;
}


/* 底部仪器读出条：贴合画布下边缘，不遮挡画面 */
.ms3-hud {
  position: absolute;
  z-index: 6;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 52px;
  padding: 0 14px 0 16px;
  border-top: 1px solid #ffffff14;
  background: #0e0e12eb;
  will-change: transform, opacity;
}

.ms3-hud .ms3-render-bar {
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 2px;
  margin: 0;
  border-radius: 0;
}

.ms3-hud-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.ms3-render-phase {
  display: inline-block;
  flex: none;
  color: var(--ink);
  font: 700 12px/1 'SF Mono', ui-monospace, monospace;
  letter-spacing: 0.06em;
  will-change: transform, opacity;
}

.ms3-hud-status {
  overflow: hidden;
  color: var(--dim);
  font: 600 10px/1.4 monospace;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms3-hud-chips {
  display: flex;
  flex: none;
  gap: 6px;
  max-width: 42%;
  overflow-x: auto;
  scrollbar-width: none;
}

.ms3-hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  color: var(--dim);
  font: 700 9.5px/1 monospace;
  white-space: nowrap;
}

.ms3-hud-chip i {
  font-size: 9px;
}

.ms3-hud-chip.is-running {
  border-color: rgba(255, 92, 26, 0.55);
  color: var(--accent);
}

.ms3-hud-chip.is-done {
  border-color: #3d5a48;
  color: #7fc493;
}

.ms3-hud-chip.is-failed {
  border-color: #6b3a33;
  color: var(--danger);
}

.ms3-hud-chip.is-cancelled {
  opacity: 0.5;
}

.ms3-hud-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.ms3-hud-cancel {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ms3-hud-cancel:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(255, 125, 110, 0.08);
}

.ms3-hud-cancel:disabled {
  opacity: 0.6;
  cursor: wait;
}


.ms3-render-timer {
  color: var(--ink);
  font: 700 20px/1 'SF Mono', ui-monospace, monospace;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  display: inline-block;
  will-change: transform;
}


.ms3-fx-canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  pointer-events: none;
}


/* ================= 仪器面板细节 ================= */
/* 左栏分区编号：01 · 参考主体 …… */
.ms3-panel-scroll {
  counter-reset: ms3-section;
}

.ms3-block-head > span::before {
  counter-increment: ms3-section;
  content: counter(ms3-section, decimal-leading-zero);
  margin-right: 8px;
  color: var(--accent);
  font: 700 10px/1 'SF Mono', ui-monospace, monospace;
  letter-spacing: 0.08em;
}

/* 画布刻度尺与对位角标 */
.ms3-ruler {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  opacity: 0.55;
}

.ms3-ruler.is-top {
  top: 0;
  left: 0;
  right: 0;
  height: 7px;
  background:
    repeating-linear-gradient(90deg, #ffffff38 0 1px, transparent 1px 12px) 0 0 / 100% 4px no-repeat,
    repeating-linear-gradient(90deg, #ffffff59 0 1px, transparent 1px 60px) 0 0 / 100% 7px no-repeat;
}

.ms3-ruler.is-left {
  top: 0;
  bottom: 0;
  left: 0;
  width: 7px;
  background:
    repeating-linear-gradient(180deg, #ffffff38 0 1px, transparent 1px 12px) 0 0 / 4px 100% no-repeat,
    repeating-linear-gradient(180deg, #ffffff59 0 1px, transparent 1px 60px) 0 0 / 7px 100% no-repeat;
}

.ms3-corner {
  position: absolute;
  z-index: 2;
  width: 14px;
  height: 14px;
  border: 0 solid var(--accent);
  opacity: 0.85;
  pointer-events: none;
}

.ms3-corner.is-tl { top: 7px; left: 7px; border-top-width: 2px; border-left-width: 2px; }
.ms3-corner.is-tr { top: 7px; right: 7px; border-top-width: 2px; border-right-width: 2px; }
.ms3-corner.is-bl { bottom: 7px; left: 7px; border-bottom-width: 2px; border-left-width: 2px; }
.ms3-corner.is-br { bottom: 7px; right: 7px; border-bottom-width: 2px; border-right-width: 2px; }

/* 顶栏机加工斜纹 */
.ms3-stage-bar {
  background-image: repeating-linear-gradient(-45deg, transparent 0 10px, #ffffff05 10px 11px);
}

/* 细节强度大数字读出 */
.ms3-row.is-slider em {
  font: 700 17px/1 'SF Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

/* ================= 同组多视图 ================= */
.ms3-card.is-stack {
  box-shadow:
    3px 3px 0 -1px var(--panel-2),
    3px 3px 0 0 var(--line-2),
    6px 6px 0 -1px var(--panel),
    6px 6px 0 0 var(--line);
}

.ms3-card.is-stack:hover {
  box-shadow:
    3px 3px 0 -1px var(--panel-2),
    3px 3px 0 0 var(--line-2),
    6px 6px 0 -1px var(--panel),
    6px 6px 0 0 var(--line),
    0 10px 24px #000a;
}

.ms3-card-count {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 6px;
  background: #101014e0;
  color: var(--accent);
  font: 700 9px/1 monospace;
  pointer-events: none;
}

.ms3-groupbar {
  position: absolute;
  z-index: 4;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  max-width: 92%;
  padding: 6px;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: #141418f2;
  overflow-x: auto;
  scrollbar-width: thin;
  animation: ms3-card-in 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.ms3-groupbar button {
  position: relative;
  flex: none;
  width: 66px;
  height: 46px;
  padding: 0;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--field);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.ms3-groupbar button:hover {
  transform: translateY(-2px);
}

.ms3-groupbar button.is-on {
  border-color: var(--accent);
  box-shadow: none;
}

.ms3-groupbar :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ms3-group-download {
  display: grid !important;
  place-items: center;
  align-content: center;
  gap: 3px;
  background: var(--accent-soft) !important;
  border-color: rgba(255, 92, 26, 0.5) !important;
  color: var(--accent);
}

.ms3-group-download i {
  font-size: 13px;
}

.ms3-group-download em {
  position: static !important;
  padding: 0 !important;
  background: transparent !important;
  color: var(--accent) !important;
}

.ms3-gallery-sentinel {
  height: 1px;
}

.ms3-gallery-note.is-inline {
  flex-direction: row;
  justify-content: center;
  margin: 10px 4px 4px;
}

.ms3-groupbar em {
  position: absolute;
  left: 3px;
  bottom: 3px;
  max-width: calc(100% - 6px);
  overflow: hidden;
  padding: 2px 5px;
  border-radius: 5px;
  background: #101014cc;
  color: var(--muted);
  font: 700 8px/1 monospace;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ================= 大图 ================= */
.ms3-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #08080be8;
  backdrop-filter: blur(10px);
}

.ms3-fullscreen :deep(.authenticated-image) {
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
  object-fit: contain;
  box-shadow: 0 30px 90px #000c, 0 0 0 1px rgba(255, 92, 26, 0.18);
}

.ms3-fullscreen > button {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 42px;
  height: 42px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: #141418cc;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ms3-fullscreen > button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.ms3-zoom-enter-active,
.ms3-zoom-leave-active {
  transition: opacity 0.18s ease;
}

.ms3-zoom-enter-from,
.ms3-zoom-leave-to {
  opacity: 0;
}

/* ================= 动效 ================= */
.ms3-spin {
  animation: ms3-spin 1s linear infinite;
}

@keyframes ms3-spin {
  to { transform: rotate(360deg); }
}

@keyframes ms3-bar {
  0% { left: -45%; }
  100% { left: 105%; }
}

@keyframes ms3-dot {
  50% { opacity: 0.35; transform: scale(0.82); }
}

@keyframes ms3-card-in {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes ms3-beam {
  55%, 100% { transform: translateX(130%); }
}

@media (prefers-reduced-motion: reduce) {
  .ms3-render-bar i,
  .ms3-render-dot,
  .ms3-frame,
  .ms3-spec {
    transform: none !important;
  }

  .ms3-card,
  .ms3-views button,
  .ms3-generate,
  .ms3-frame {
    transition: none;
  }
}

/* ================= 响应式 ================= */
@media (max-width: 1240px) {
  .ms3 {
    grid-template-columns: 284px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) 236px;
  }

  .ms3-panel {
    grid-row: 1 / 3;
  }

  .ms3-gallery {
    grid-column: 2;
  }
}

@media (max-width: 900px) {
  .ms3 {
    height: auto;
    overflow: visible;
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }

  .ms3-panel {
    grid-row: auto;
    order: 2;
  }

  .ms3-panel-scroll {
    overflow: visible;
  }

  .ms3-stage {
    order: 1;
    min-height: 58vh;
  }

  .ms3-viewport {
    min-height: 46vh;
  }

  .ms3-frame {
    width: 100% !important;
  }

  .ms3-gallery {
    order: 3;
    max-height: 60vh;
  }

  .ms3-spec {
    display: none;
  }
}
</style>
