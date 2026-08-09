<script setup>
// UI 设计稿工作台 · 沉浸版
// 布局语言：无边框、填充式控件，层级靠底色深浅与间距；左栏固定节奏直排参数，
// 右侧为无框画布，操作与元信息浮于画布之上；环境光随品牌主色变化。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import AspectRatioSelect from '@/features/ai-wallpaper/components/AspectRatioSelect.vue'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import AiDesignCanvas from '@/features/design-workshop/components/AiDesignCanvas.vue'
import DesignVersionDrawer from '@/features/design-workshop/components/DesignVersionDrawer.vue'
import {
  ACTIVE_DESIGN_ANALYSIS_KEY,
  ACTIVE_DESIGN_ANALYSIS_VERSION,
} from '@/features/design-workshop/aiDesignDocument'
import {
  DESIGN_DEVICE_OPTIONS,
  getDesignDevice,
  normalizeSelectedDeviceIds,
} from '@/features/design-workshop/designDevices'
import {
  UI_SERIES_ANCHOR_ROLE,
  buildContentConsistencyLock,
  buildDeviceAdaptationBlock,
  metricsForDeviceOption,
  orderDevicesForConsistency,
} from '@/features/design-workshop/multiDeviceConsistency'
import {
  buildTileRefinePrompt,
  extractQuadrantTileFiles,
  resolveTileOutputLongSide,
  stitchQuadrantTiles,
} from '@/features/design-workshop/tilePrecisionRefine'
import { uploadAiTempBlob } from '@/features/ai-shared/aiImageIO'
import { deleteServerAiJob, uploadAiInputFile } from '@/services/aiWallpaper'
import {
  buildVersionForest,
  canIterate,
  collectDescendants,
  collectOutputUrls,
  findNodeByOutput,
  pickCarrier,
} from '@/features/design-workshop/versionTree'
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from '@/services/authenticatedMedia'
import { fetchAssistantConfig } from '@/services/assistantApi'
import {
  getScopedLocalItem,
  removeScopedLocalItem,
  setScopedLocalItem,
} from '@/services/scopedLocalStorage'
import { readImageFile } from '@/features/design-workshop/imageWorkshop'
import notificationService from '@/services/notification'
import {
  DESIGN_QUALITY_REVIEW_MODES,
  auditAiDesignQuality,
  auditAiDesignRegion,
  buildDesignQualityRules,
  buildQualityIterationPrompt,
} from '@/features/design-workshop/designQualityProfile'
import { composePendingLaunchPrompt, takePendingPrompt } from '@/features/creator-hub/studioTools'
import { useAppearanceStore } from '@/stores/appearance'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'

const appearanceStore = useAppearanceStore()
const runtimeConfigStore = useRuntimeConfigStore()

const SETTINGS_KEY = 'ui-design-workshop-v2'
const DESIGN_SPEC_VERSION = 2
const EDITABLE_HISTORY_KEY = 'ui-editable-document-history-v1'
const ANALYSIS_MODEL_KEY = 'ui-design-analysis-model-v1'
const QUALITY_AUDIT_HISTORY_KEY = 'ui-design-quality-audits-v4'
const TILE_REFINE_FINALS_KEY = 'ui-design-tile-refine-finals-v1'
const ACTIVE_ANALYSIS_MAX_AGE_MS = 6 * 60 * 60 * 1000

function readStoredActiveAnalysisSession() {
  try {
    const session = JSON.parse(getScopedLocalItem(ACTIVE_DESIGN_ANALYSIS_KEY) || 'null')
    const updatedAt = Date.parse(session?.updatedAt || session?.startedAt || '')
    const valid =
      session?.version === ACTIVE_DESIGN_ANALYSIS_VERSION &&
      Boolean(session?.conversationId) &&
      Boolean(session?.referenceImage) &&
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt < ACTIVE_ANALYSIS_MAX_AGE_MS
    if (valid) return session
  } catch {
    // Remove the damaged marker below.
  }
  removeScopedLocalItem(ACTIVE_DESIGN_ANALYSIS_KEY)
  return null
}

const DEVICE_OPTIONS = DESIGN_DEVICE_OPTIONS

const PAGE_TYPE_OPTIONS = [
  {
    id: 'landing',
    label: '落地页',
    icon: 'bi-window-stack',
    description: '品牌表达与转化路径',
    prompt: '产品落地页：首屏 Hero、卖点分区、客户证言、定价表与页脚',
  },
  {
    id: 'dashboard',
    label: '仪表盘',
    icon: 'bi-speedometer2',
    description: '指标监控与数据概览',
    prompt: '数据仪表盘：侧边导航、KPI 指标卡、趋势图表与明细数据表格',
  },
  {
    id: 'ecommerce',
    label: '电商页面',
    icon: 'bi-bag',
    description: '商品展示与购买转化',
    prompt: '电商页面：商品主图、价格与规格选择、购买按钮、评价与推荐位',
  },
  {
    id: 'feed',
    label: '信息流',
    icon: 'bi-view-list',
    description: '内容发现与持续浏览',
    prompt: '信息流页面：顶部导航、内容卡片流、互动按钮与底部标签栏',
  },
  {
    id: 'auth',
    label: '登录注册',
    icon: 'bi-person-lock',
    description: '账号验证与身份进入',
    prompt: '登录/注册页：品牌展示区、表单、第三方登录与协议说明',
  },
  {
    id: 'settings',
    label: '设置页',
    icon: 'bi-sliders2',
    description: '偏好配置与账户管理',
    prompt: '设置页面：分组设置列表、开关与输入控件、账号与危险操作区',
  },
  {
    id: 'profile',
    label: '个人中心',
    icon: 'bi-person-circle',
    description: '资料、数据与个人入口',
    prompt: '个人中心页：头像资料卡、数据统计、功能入口列表',
  },
  {
    id: 'chat',
    label: '聊天对话',
    icon: 'bi-chat-dots',
    description: '会话协作与即时沟通',
    prompt: '即时通讯界面：会话列表、消息气泡、输入框与工具栏',
  },
  {
    id: 'onboarding',
    label: '引导页',
    icon: 'bi-signpost-split',
    description: '新用户认知与步骤引导',
    prompt: '新用户引导页：主题插画、步骤指示器、行动按钮',
  },
  {
    id: 'workspace',
    label: '工作台',
    icon: 'bi-columns-gap',
    description: '多任务生产与快捷操作',
    prompt: '业务工作台：全局导航、快捷操作区、待办任务、最近项目与动态记录',
  },
  {
    id: 'crm',
    label: '客户管理',
    icon: 'bi-person-lines-fill',
    description: '线索、客户与跟进流程',
    prompt: 'CRM 客户管理页：客户列表、阶段漏斗、负责人、跟进记录与批量操作',
  },
  {
    id: 'analytics',
    label: '数据分析',
    icon: 'bi-graph-up-arrow',
    description: '多维筛选与趋势洞察',
    prompt: '数据分析页：时间与维度筛选、核心趋势图、对比指标、明细表和洞察摘要',
  },
  {
    id: 'admin',
    label: '管理后台',
    icon: 'bi-layout-sidebar-inset',
    description: '高密度运营与权限操作',
    prompt: '管理后台：稳定侧边导航、筛选工具栏、数据表格、状态标签与批量操作',
  },
  {
    id: 'finance',
    label: '金融账务',
    icon: 'bi-wallet2',
    description: '资产、账单与交易明细',
    prompt: '金融账务页：资产概览、收支趋势、账户卡片、交易流水与风险提示',
  },
  {
    id: 'education',
    label: '在线教育',
    icon: 'bi-mortarboard',
    description: '课程学习与进度管理',
    prompt: '在线教育页：课程目录、学习进度、视频区域、章节任务、笔记与讨论区',
  },
  {
    id: 'healthcare',
    label: '医疗健康',
    icon: 'bi-heart-pulse',
    description: '健康数据与服务预约',
    prompt: '医疗健康页：健康概览、指标趋势、服务入口、预约信息与风险提醒',
  },
  {
    id: 'booking',
    label: '预订服务',
    icon: 'bi-calendar2-check',
    description: '时间、资源与订单确认',
    prompt: '预订服务页：搜索条件、日期与时段选择、资源列表、价格明细和订单确认',
  },
  {
    id: 'media',
    label: '媒体播放',
    icon: 'bi-play-btn',
    description: '影音浏览与播放控制',
    prompt: '媒体播放页：内容主视觉、播放器、频道分类、推荐列表、收藏与播放队列',
  },
  {
    id: 'portfolio',
    label: '作品集',
    icon: 'bi-grid-1x2',
    description: '项目展示与个人表达',
    prompt: '作品集页面：个人或团队介绍、精选项目、案例详情入口、能力标签与联系方式',
  },
  {
    id: 'custom',
    label: '自定义',
    icon: 'bi-pencil-square',
    description: '自由定义页面信息结构',
    prompt: '',
  },
]

const STYLE_OPTIONS = [
  {
    id: 'minimal',
    label: '极简留白',
    icon: 'bi-layout-text-sidebar-reverse',
    description: '克制、清晰、重视内容',
    preview: ['#f7f7f8', '#18181b', '#e4e4e7'],
    prompt: '极简主义：大量留白、克制配色、精致排版',
  },
  {
    id: 'glass',
    label: '玻璃拟态',
    icon: 'bi-layers',
    description: '半透明层次与柔和光感',
    preview: ['#1d1830', '#9f8cff', '#493d68'],
    prompt: '玻璃拟态：半透明磨砂卡片、柔和渐变背景、细腻高光',
  },
  {
    id: 'darkpro',
    label: '深色专业',
    icon: 'bi-moon-stars',
    description: '高对比、沉稳、专业工具感',
    preview: ['#111318', '#e5e7eb', '#343946'],
    prompt: '深色专业：深灰背景、高对比信息层级、克制的强调色',
  },
  {
    id: 'vibrant',
    label: '多彩活力',
    icon: 'bi-palette',
    description: '明快色彩与活泼节奏',
    preview: ['#ff5a67', '#6558f5', '#ffc857'],
    prompt: '多彩活力：明快配色、大圆角、活泼插画点缀',
  },
  {
    id: 'corporate',
    label: '商务企业',
    icon: 'bi-buildings',
    description: '稳重、可信、结构严谨',
    preview: ['#16324f', '#2f81f7', '#dbe8f5'],
    prompt: '商务企业：稳重蓝灰配色、清晰栅格、正式可信',
  },
  {
    id: 'neubrutal',
    label: '新粗野',
    icon: 'bi-bounding-box',
    description: '硬边界、强对比、个性直接',
    preview: ['#f8ef52', '#ff6b6b', '#111111'],
    prompt: '新粗野主义：粗描边、硬阴影、高饱和撞色色块',
  },
  {
    id: 'editorial',
    label: '杂志编辑',
    icon: 'bi-newspaper',
    description: '大标题、强节奏、内容叙事',
    preview: ['#f3f0ea', '#171717', '#b5342b'],
    prompt: '杂志编辑风格：鲜明版式节奏、精致大标题、图文比例讲究且内容导向明确',
  },
  {
    id: 'luxury',
    label: '高端奢华',
    icon: 'bi-gem',
    description: '精致、稀缺、克制质感',
    preview: ['#171512', '#d8c28f', '#f4f0e8'],
    prompt: '高端奢华风格：精致材质感、克制高光、宽松排版和高品质视觉细节',
  },
  {
    id: 'friendly',
    label: '亲和圆润',
    icon: 'bi-emoji-smile',
    description: '柔和、易用、具有温度',
    preview: ['#fff7ed', '#34a37b', '#ff8a65'],
    prompt: '亲和圆润风格：柔和形态、自然配色、清晰反馈，友好但不过度幼态',
  },
  {
    id: 'futuristic',
    label: '未来科技',
    icon: 'bi-cpu',
    description: '精密、前沿、数字空间感',
    preview: ['#080b12', '#31e6c2', '#5965ff'],
    prompt: '未来科技风格：精密网格、冷色高亮、数据化细节和克制的数字空间感',
  },
  {
    id: 'organic',
    label: '自然有机',
    icon: 'bi-flower1',
    description: '自然色彩与柔和秩序',
    preview: ['#edf3ea', '#3f7552', '#d59b67'],
    prompt: '自然有机风格：自然色彩、柔和边缘、舒缓层级与真实材质图片',
  },
  {
    id: 'monochrome',
    label: '黑白单色',
    icon: 'bi-circle-half',
    description: '纯粹、高级、强调排版',
    preview: ['#ffffff', '#111111', '#a1a1aa'],
    prompt: '黑白单色风格：主要使用黑白灰，通过字号、字重、留白和边界建立层级',
  },
]

const AUDIENCE_OPTIONS = [
  { id: 'consumer', label: '大众用户', prompt: '面向大众消费者，认知负担低，核心操作直观' },
  {
    id: 'professional',
    label: '专业用户',
    prompt: '面向专业用户，支持高频操作、快速扫描和批量处理',
  },
  {
    id: 'enterprise',
    label: '企业团队',
    prompt: '面向企业团队，强调权限、协作、可信度和数据可追溯',
  },
]

const GOAL_OPTIONS = [
  { id: 'conversion', label: '转化', prompt: '以推动注册、购买或咨询转化为首要目标' },
  { id: 'workflow', label: '任务效率', prompt: '以缩短关键任务路径和提升重复操作效率为首要目标' },
  { id: 'content', label: '内容浏览', prompt: '以内容发现、阅读和持续浏览为首要目标' },
  { id: 'insight', label: '数据洞察', prompt: '以数据比较、异常识别和辅助决策为首要目标' },
]

const NAVIGATION_OPTIONS = [
  { id: 'auto', label: '智能布局', prompt: '根据页面类型和设备自动选择最合适的导航结构' },
  { id: 'top', label: '顶部导航', prompt: '使用清晰克制的顶部导航，主要入口横向排列' },
  { id: 'sidebar', label: '侧边导航', prompt: '使用稳定侧边导航，支持多模块和深层级工作流' },
  { id: 'hybrid', label: '混合导航', prompt: '使用顶部全局导航与侧边模块导航组合' },
  { id: 'bottom', label: '底部标签栏', prompt: '在移动端使用底部标签栏承载核心一级入口' },
]

const DENSITY_OPTIONS = [
  { id: 'compact', label: '紧凑', prompt: '紧凑信息密度，减少无效留白，适合高频专业操作' },
  { id: 'balanced', label: '均衡', prompt: '均衡信息密度，兼顾扫描效率与视觉呼吸感' },
  { id: 'comfortable', label: '宽松', prompt: '宽松信息密度，增加触控面积和内容呼吸感' },
]

const TYPOGRAPHY_OPTIONS = [
  { id: 'neutral', label: '中性无衬线', prompt: '中性现代无衬线字体，层级稳定，适合通用产品界面' },
  { id: 'technical', label: '技术理性', prompt: '技术理性字体气质，数字、表格和标签具有高辨识度' },
  { id: 'editorial', label: '编辑感', prompt: '编辑设计式排版，标题与正文形成明确节奏和内容气质' },
  { id: 'friendly', label: '亲和圆润', prompt: '亲和圆润字体气质，避免幼稚，保持产品可信度' },
]

const RADIUS_OPTIONS = [
  { id: 'sharp', label: '硬朗 4px', prompt: '组件圆角以 4px 为主，形态硬朗克制' },
  { id: 'medium', label: '标准 8px', prompt: '组件圆角以 8px 为主，层级清晰且不过度柔化' },
  { id: 'soft', label: '柔和 12px', prompt: '组件圆角以 12px 为主，触感柔和但避免胶囊化泛滥' },
]

const RESPONSIVE_OPTIONS = [
  {
    id: 'adaptive',
    label: '自适应',
    prompt:
      '按断点重排：桌面多栏/侧栏，平板双栏，手机与小程序单列+底部或顶栏导航，电视大卡片焦点流；内容与模块集合保持一致',
  },
  {
    id: 'desktop-first',
    label: '桌面优先',
    prompt: '桌面端信息完整，平板收敛为双栏，手机/小程序单列保留核心操作与同一套文案数据',
  },
]

const COMPONENT_STATE_OPTIONS = [
  {
    id: 'interaction',
    label: '交互',
    prompt: '按钮、链接和输入控件具有 hover、focus、pressed 状态',
  },
  { id: 'loading', label: '加载', prompt: '关键内容具有骨架屏或局部加载反馈' },
  { id: 'empty', label: '空状态', prompt: '核心列表或画布具有明确但克制的空状态' },
  { id: 'error', label: '错误', prompt: '表单与异步操作具有就近错误反馈和恢复入口' },
  { id: 'disabled', label: '禁用', prompt: '不可用操作具有清楚的禁用状态且不与可点击状态混淆' },
  { id: 'success', label: '成功', prompt: '提交与保存操作具有明确、短暂且不打断流程的成功反馈' },
]

function toSelectOptions(options, icon) {
  return options.map((item) => ({ value: item.id, label: item.label, icon }))
}

const AUDIENCE_SELECT_OPTIONS = toSelectOptions(AUDIENCE_OPTIONS, 'bi-people')
const GOAL_SELECT_OPTIONS = toSelectOptions(GOAL_OPTIONS, 'bi-bullseye')
const NAVIGATION_SELECT_OPTIONS = toSelectOptions(NAVIGATION_OPTIONS, 'bi-diagram-3')
const DENSITY_SELECT_OPTIONS = toSelectOptions(DENSITY_OPTIONS, 'bi-distribute-vertical')
const TYPOGRAPHY_SELECT_OPTIONS = toSelectOptions(TYPOGRAPHY_OPTIONS, 'bi-fonts')
const RADIUS_SELECT_OPTIONS = toSelectOptions(RADIUS_OPTIONS, 'bi-bounding-box-circles')
const RESPONSIVE_SELECT_OPTIONS = toSelectOptions(RESPONSIVE_OPTIONS, 'bi-arrows-angle-expand')

const BRAND_COLOR_OPTIONS = [
  { value: '#6d5cff', label: '星云紫', swatch: '#6d5cff', description: '创意与智能产品' },
  { value: '#2f81f7', label: '科技蓝', swatch: '#2f81f7', description: '科技与效率工具' },
  { value: '#12b76a', label: '活力绿', swatch: '#12b76a', description: '增长与健康服务' },
  { value: '#f79009', label: '暖阳橙', swatch: '#f79009', description: '消费与生活方式' },
  { value: '#f04438', label: '珊瑚红', swatch: '#f04438', description: '行动与重要提醒' },
  { value: '#d444f1', label: '霓虹紫', swatch: '#d444f1', description: '潮流与娱乐平台' },
  { value: '#0e9384', label: '青碧绿', swatch: '#0e9384', description: '专业与可持续' },
  { value: '#334155', label: '石墨蓝', swatch: '#334155', description: '企业与数据产品' },
  { value: '#e5484d', label: '朱砂红', swatch: '#e5484d', description: '品牌与内容传播' },
  { value: '#7c3aed', label: '电光紫', swatch: '#7c3aed', description: '数字内容与社区' },
  { value: '#0891b2', label: '湖水青', swatch: '#0891b2', description: '服务与信息平台' },
  { value: '#18181b', label: '经典黑', swatch: '#18181b', description: '高端与极简品牌' },
]

const QUALITY_DIMENSION_LABELS = {
  hierarchy: '层级',
  layout: '布局',
  typography: '文字',
  color: '配色',
  components: '组件',
  product: '业务',
}

function qualityAuditKey(output, mode = 'balanced') {
  return output ? `${mode}::${output}` : ''
}

function readStoredQualityAudits() {
  try {
    const stored = JSON.parse(getScopedLocalItem(QUALITY_AUDIT_HISTORY_KEY) || '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    return {}
  }
}

const {
  creditsPrompt,
  modelId,
  models,
  status,
  error: generationError,
  running,
  cancelling,
  historyLoading,
  historyHasMore,
  historyError,
  outputs,
  activeOutput,
  outputJobIds,
  outputGroups,
  outputGroupIndexes,
  outputParents,
  outputDevices,
  batchProgress,
  generationTasks,
  initialize,
  generateBatch,
  deleteOutput,
  loadMoreHistory,
  cancel: cancelGeneration,
  formatCostEstimate,
} = useCreativeImageJob({
  source: 'ui-design-workshop',
  featureKey: 'ai.uiDesign',
  jobKindPrefix: 'ui-design',
  preferOriginalOutputs: true,
  outputLongSide: 2048,
  initialHistoryLimit: 24,
})

const modelSelectOptions = computed(() =>
  models.value.map((model) => ({
    value: model.id,
    label: model.label,
    icon: 'bi-cpu',
    pricePoints: model.pricePoints,
    standardPricePoints: model.standardPricePoints,
    discountPricePoints: model.discountPricePoints,
  })),
)
const analysisModels = ref([])
const analysisModelId = ref(getScopedLocalItem(ANALYSIS_MODEL_KEY) || '')
const analysisModelsLoading = ref(false)
const analysisModelError = ref('')
const analysisModelOptions = computed(() =>
  analysisModels.value.map((model) => ({
    value: model.model,
    label: model.label,
    icon: 'bi-eye',
    description: model.description,
    pricePoints: model.pricePoints,
    standardPricePoints: model.standardPricePoints,
    discountPricePoints: model.discountPricePoints,
  })),
)

async function loadAnalysisModels() {
  analysisModelsLoading.value = true
  analysisModelError.value = ''
  try {
    await runtimeConfigStore.loadRuntimeConfig({ force: true })
    const featureConfig = runtimeConfigStore.getFeaturePayload('ai.uiDesign') || {}
    const hasWorkspaceModels =
      Array.isArray(featureConfig.analysisModels) && featureConfig.analysisModels.length > 0
    const assistantConfig = hasWorkspaceModels ? null : await fetchAssistantConfig()
    const configuredModels = hasWorkspaceModels
      ? featureConfig.analysisModels
      : assistantConfig?.conversationModels
    const options = Array.isArray(configuredModels)
      ? configuredModels
          .map((item) => ({
            label: String(item?.label || item?.name || item?.model || item?.id || '').trim(),
            model: String(item?.model || item?.id || item?.publicModelKey || '').trim(),
            description: String(item?.description || item?.provider || '对话与图片理解模型'),
            default: item?.default === true,
            pricePoints: item?.pricePoints,
            standardPricePoints: item?.standardPricePoints,
            discountPricePoints: item?.discountPricePoints,
          }))
          .filter((item) => item.label && item.model)
      : []
    if (!options.length && !hasWorkspaceModels && assistantConfig?.chatModel) {
      options.push({
        label: String(assistantConfig.chatModel),
        model: String(assistantConfig.chatModel),
        description: '后台默认分析模型',
        default: true,
      })
    }
    analysisModels.value = options
    if (!options.length) {
      analysisModelError.value = '后台尚未为 UI 设计稿分配元素分析模型'
    }
    const resumedModel = String(editableResumeSession.value?.model || '').trim()
    analysisModelId.value =
      options.find((item) => item.model === resumedModel)?.model ||
      options.find((item) => item.model === analysisModelId.value)?.model ||
      options.find((item) => item.default)?.model ||
      options[0]?.model ||
      ''
  } catch (caught) {
    analysisModelError.value = caught?.message || '分析模型加载失败'
  } finally {
    analysisModelsLoading.value = false
  }
}

const studioRoot = ref(null)
const artboardRef = ref(null)
const qualityTrigger = ref(null)
const qualityDialogRef = ref(null)
const qualityCloseButton = ref(null)
const fileInput = ref(null)
const composerDragging = ref(false)
let composerDragDepth = 0
const briefField = ref(null)
const pageTypePickerTrigger = ref(null)
const stylePickerTrigger = ref(null)
const brandPickerTrigger = ref(null)
const specificationTrigger = ref(null)
const brief = ref('')
const iterationBrief = ref('')
const selectedDeviceIds = ref(['web'])
const viewDeviceId = ref('web')
const generatingDeviceIds = ref([])
const pageTypeId = ref('landing')
const customPageType = ref('')
const styleId = ref('minimal')
const brandColor = ref(BRAND_COLOR_OPTIONS[0].value)
const colorScheme = ref('light')
const audienceId = ref('consumer')
const goalId = ref('conversion')
const navigationId = ref('auto')
const densityId = ref('balanced')
const typographyId = ref('neutral')
const radiusId = ref('medium')
const responsiveId = ref('adaptive')
const componentStates = ref(COMPONENT_STATE_OPTIONS.map((item) => item.id))
const MAX_REFERENCE_IMAGES = 6
const referenceImages = ref([])
const iterationSource = ref('')
const tileRefinePhase = ref('') // '', preparing, generating, stitching, done
const tileRefineError = ref('')
/** url -> true：标记四宫格精修成品，便于舞台角标识别 */
const tileRefineOutputs = ref({})
/** 原稿 url -> 最新精修成品条目（结果只走弹窗，不进版本抽屉） */
const tileRefineBySource = ref({})
const tileRefineDialogOpen = ref(false)
const tileRefineDialogEntry = ref(null)
const localError = ref('')
const mediaError = ref('')
const promptPreviewOpen = ref(false)
const pageTypePickerOpen = ref(false)
const pageTypePickerStyle = ref({})
const activeConfigPanel = ref('')
const configPickerStyle = ref({})
const qualityAuditOpen = ref(false)
const qualityAuditing = ref(false)
const qualityAudit = ref(null)
const qualityAuditError = ref('')
const qualityAuditsByOutput = ref(readStoredQualityAudits())
const qualityReviewMode = ref('balanced')
const selectedQualityIssueIds = ref([])
const activeQualityIssueId = ref('')
const regionSelectionMode = ref(false)
const regionSelection = ref(null)
const regionPreview = ref('')
const regionReview = ref(null)
const regionReviewLoading = ref(false)
const regionReviewError = ref('')
const fullscreenOpen = ref(false)
const editableCanvasOpen = ref(false)
const editableGenerationNonce = ref(0)
const editableDocumentId = ref('')
const editableResumeSession = ref(readStoredActiveAnalysisSession())
const editableSeedFindings = ref(null)
const tabletPane = ref('controls')
const versionDrawerOpen = ref(false)
const versionDrawerFocusId = ref('')
const versionDeleting = ref(false)
const historyViewport = ref(null)
const historyPage = ref(0)
const historyPageSize = ref(4)
const editableHistory = ref([])
const HISTORY_CARD_WIDTH = 236

function shortDeviceLabel(label = '') {
  return String(label || '')
    .replace(/^智能/, '')
    .replace(/端$/, '')
    .trim()
}

function collectMajorDevices(major) {
  const ids = new Set()
  const walk = (node) => {
    if (!node) return
    for (const [deviceId, url] of Object.entries(node.carriers || {})) {
      if (url) ids.add(deviceId)
    }
    for (const child of node.children || []) walk(child)
  }
  walk(major)
  const order = new Map(DESIGN_DEVICE_OPTIONS.map((item, index) => [item.id, index]))
  return [...ids]
    .map((id) => getDesignDevice(id))
    .filter(Boolean)
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
    .map((device) => ({
      id: device.id,
      label: device.label,
      shortLabel: shortDeviceLabel(device.label),
      icon: device.icon,
      ratio: device.ratio,
    }))
}
const HISTORY_CARD_GAP = 8
let qualityAuditController = null
let regionReviewController = null
let regionSelectionStart = null
let suppressArtboardClick = false
let historyResizeObserver = null
let historyLoadQueued = false

function hasOption(options, id) {
  return options.some((item) => item.id === id)
}

function openPageTypePicker() {
  const trigger = pageTypePickerTrigger.value
  if (!trigger || typeof window === 'undefined') return
  const rect = trigger.getBoundingClientRect()
  const viewportPadding = 12
  const gap = 12
  const width = Math.min(620, window.innerWidth - viewportPadding * 2)
  const maxHeight = Math.min(640, window.innerHeight - viewportPadding * 2)
  const preferredLeft = rect.right + gap
  const left =
    preferredLeft + width <= window.innerWidth - viewportPadding
      ? preferredLeft
      : Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
  const top = Math.min(
    Math.max(viewportPadding, rect.top - 8),
    Math.max(viewportPadding, window.innerHeight - maxHeight - viewportPadding),
  )
  pageTypePickerStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
  activeConfigPanel.value = ''
  pageTypePickerOpen.value = true
}

function closePageTypePicker({ restoreFocus = true } = {}) {
  pageTypePickerOpen.value = false
  if (restoreFocus) nextTick(() => pageTypePickerTrigger.value?.focus())
}

function selectPageType(id) {
  pageTypeId.value = id
  closePageTypePicker()
}

function openConfigPicker(type, trigger) {
  if (!trigger || typeof window === 'undefined') return
  const rect = trigger.getBoundingClientRect()
  const viewportPadding = 12
  const width = Math.min(type === 'specification' ? 680 : 600, window.innerWidth - 24)
  const maxHeight = Math.min(660, window.innerHeight - 24)
  const preferredLeft = rect.right + 12
  const left =
    preferredLeft + width <= window.innerWidth - viewportPadding
      ? preferredLeft
      : Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
  const top = Math.min(
    Math.max(viewportPadding, rect.top - 8),
    Math.max(viewportPadding, window.innerHeight - maxHeight - viewportPadding),
  )
  configPickerStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
  pageTypePickerOpen.value = false
  activeConfigPanel.value = type
}

function closeConfigPicker({ restoreFocus = true } = {}) {
  const panel = activeConfigPanel.value
  activeConfigPanel.value = ''
  if (!restoreFocus) return
  const trigger = {
    style: stylePickerTrigger,
    brand: brandPickerTrigger,
    specification: specificationTrigger,
  }[panel]
  nextTick(() => trigger?.value?.focus())
}

function selectStyle(id) {
  styleId.value = id
  closeConfigPicker()
}

function selectBrandColor(value) {
  brandColor.value = value
  closeConfigPicker()
}

try {
  const saved = JSON.parse(getScopedLocalItem(SETTINGS_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    if (typeof saved.brief === 'string') brief.value = saved.brief
    if (Array.isArray(saved.selectedDeviceIds) || saved.deviceId) {
      selectedDeviceIds.value = normalizeSelectedDeviceIds(
        saved.selectedDeviceIds || saved.deviceId,
      )
      viewDeviceId.value = selectedDeviceIds.value[0]
    }
    if (hasOption(PAGE_TYPE_OPTIONS, saved.pageTypeId)) pageTypeId.value = saved.pageTypeId
    if (typeof saved.customPageType === 'string') customPageType.value = saved.customPageType
    if (hasOption(STYLE_OPTIONS, saved.styleId)) styleId.value = saved.styleId
    if (BRAND_COLOR_OPTIONS.some((option) => option.value === saved.brandColor)) {
      brandColor.value = saved.brandColor
    }
    if (['light', 'dark'].includes(saved.colorScheme)) colorScheme.value = saved.colorScheme
    if (hasOption(AUDIENCE_OPTIONS, saved.audienceId)) audienceId.value = saved.audienceId
    if (hasOption(GOAL_OPTIONS, saved.goalId)) goalId.value = saved.goalId
    if (hasOption(NAVIGATION_OPTIONS, saved.navigationId)) navigationId.value = saved.navigationId
    if (hasOption(DENSITY_OPTIONS, saved.densityId)) densityId.value = saved.densityId
    if (hasOption(TYPOGRAPHY_OPTIONS, saved.typographyId)) typographyId.value = saved.typographyId
    if (hasOption(RADIUS_OPTIONS, saved.radiusId)) radiusId.value = saved.radiusId
    if (hasOption(RESPONSIVE_OPTIONS, saved.responsiveId)) responsiveId.value = saved.responsiveId
    if (Array.isArray(saved.componentStates)) {
      const restoredStates = saved.componentStates.filter((id) =>
        COMPONENT_STATE_OPTIONS.some((item) => item.id === id),
      )
      if (Number(saved.designSpecVersion || 0) < DESIGN_SPEC_VERSION) {
        restoredStates.push('interaction', 'success')
      }
      const nextStates = [...new Set(restoredStates)]
      componentStates.value = nextStates.length
        ? nextStates
        : COMPONENT_STATE_OPTIONS.map((item) => item.id)
    }
  }
} catch {
  // Ignore a damaged local draft and keep production defaults.
}

try {
  const savedHistory = JSON.parse(getScopedLocalItem(EDITABLE_HISTORY_KEY) || '[]')
  if (Array.isArray(savedHistory) && savedHistory.length) {
    editableHistory.value = savedHistory.filter((item) => item?.referenceImage).slice(0, 12)
  }
} catch {
  // Ignore a damaged history index; generated image history remains available.
}

const selectedDevices = computed(() =>
  selectedDeviceIds.value.map((id) => getDesignDevice(id)).filter(Boolean),
)
const viewDevice = computed(() => getDesignDevice(viewDeviceId.value))
const device = computed(() => viewDevice.value)
const pageType = computed(
  () => PAGE_TYPE_OPTIONS.find((item) => item.id === pageTypeId.value) || PAGE_TYPE_OPTIONS[0],
)
const styleOption = computed(
  () => STYLE_OPTIONS.find((item) => item.id === styleId.value) || STYLE_OPTIONS[0],
)
const audienceOption = computed(
  () => AUDIENCE_OPTIONS.find((item) => item.id === audienceId.value) || AUDIENCE_OPTIONS[0],
)
const goalOption = computed(
  () => GOAL_OPTIONS.find((item) => item.id === goalId.value) || GOAL_OPTIONS[0],
)
const navigationOption = computed(
  () => NAVIGATION_OPTIONS.find((item) => item.id === navigationId.value) || NAVIGATION_OPTIONS[0],
)
const densityOption = computed(
  () => DENSITY_OPTIONS.find((item) => item.id === densityId.value) || DENSITY_OPTIONS[1],
)
const typographyOption = computed(
  () => TYPOGRAPHY_OPTIONS.find((item) => item.id === typographyId.value) || TYPOGRAPHY_OPTIONS[0],
)
const radiusOption = computed(
  () => RADIUS_OPTIONS.find((item) => item.id === radiusId.value) || RADIUS_OPTIONS[1],
)
const responsiveOption = computed(
  () => RESPONSIVE_OPTIONS.find((item) => item.id === responsiveId.value) || RESPONSIVE_OPTIONS[0],
)
const hasReference = computed(
  () => referenceImages.value.length > 0 || Boolean(iterationSource.value),
)
const isIteration = computed(() => Boolean(iterationSource.value))
const canAddReferences = computed(
  () => !isIteration.value && referenceImages.value.length < MAX_REFERENCE_IMAGES,
)
const referenceSlotsLeft = computed(() =>
  Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.value.length),
)
const briefInput = computed({
  get: () => (isIteration.value ? iterationBrief.value : brief.value),
  set: (value) => {
    if (isIteration.value) iterationBrief.value = value
    else brief.value = value
  },
})
const generateActionLabel = computed(() =>
  isIteration.value
    ? '生成迭代稿'
    : referenceImages.value.length
      ? '参考图重绘'
      : '生成设计稿',
)
const costLabel = computed(() =>
  formatCostEstimate(Math.max(1, isIteration.value ? 1 : selectedDeviceIds.value.length)),
)
const costDisplay = computed(() => {
  const text = String(costLabel.value || '').trim()
  const value = text.replace(/^预计\s*/, '')
  const detailStart = value.indexOf('（')
  if (detailStart >= 0 && value.endsWith('）')) {
    return {
      price: value.slice(0, detailStart).trim(),
      detail: value.slice(detailStart + 1, -1).trim(),
    }
  }
  const perImage = value.match(/^((?:(?:¥|\$)\s*)?\d+(?:\.\d+)?(?:\s*积分)?)\s*(\/\s*张)$/)
  if (perImage) return { price: perImage[1], detail: perImage[2] }
  return { price: value, detail: '' }
})
const versionTreeModel = computed(() =>
  buildVersionForest({
    outputs: outputs.value,
    outputGroups: outputGroups.value,
    outputGroupIndexes: outputGroupIndexes.value,
    outputParents: outputParents.value,
    outputDevices: outputDevices.value,
    analysisEntries: editableHistory.value,
  }),
)
const versionForest = computed(() => versionTreeModel.value.forest)
const versionNodeById = computed(() => versionTreeModel.value.nodeById)
const versionMetaByOutput = computed(() => versionTreeModel.value.metaByOutput)
const versionMajors = computed(() =>
  versionForest.value.map((major) => {
    const devices = collectMajorDevices(major)
    return {
      id: major.id,
      label: major.label,
      cover: pickCarrier(major, viewDeviceId.value) || major.cover,
      versionCount: 1 + major.descendantCount,
      analyzedInTree: major.analyzedInTree,
      devices,
      deviceCount: devices.length,
    }
  }),
)
const historyPageCount = computed(() =>
  Math.max(1, Math.ceil(versionMajors.value.length / Math.max(1, historyPageSize.value))),
)
const pagedVersionMajors = computed(() => {
  const size = Math.max(1, historyPageSize.value)
  const start = historyPage.value * size
  return versionMajors.value.slice(start, start + size)
})
const canPrevHistoryPage = computed(() => historyPage.value > 0)
const canNextHistoryPage = computed(
  () => historyPage.value < historyPageCount.value - 1 || historyHasMore.value,
)
const activeVersionNode = computed(() =>
  findNodeByOutput(versionForest.value, activeOutput.value, versionNodeById.value),
)
const activeVersionLabel = computed(
  () => versionMetaByOutput.value[activeOutput.value]?.label || activeVersionNode.value?.label || '',
)
const isActiveTileRefine = computed(
  () =>
    Boolean(tileRefineOutputs.value[activeOutput.value]) ||
    String(activeVersionNode.value?.id || '').includes('tile-refine'),
)
const canIterateActive = computed(() => canIterate(activeVersionNode.value))
const iterationDevice = computed(() => {
  if (!isIteration.value) return null
  const carriers = activeVersionNode.value?.carriers || {}
  const deviceId =
    Object.entries(carriers).find(([, url]) => url === iterationSource.value)?.[0] ||
    viewDeviceId.value
  return getDesignDevice(deviceId)
})
const iterationTargetLabel = computed(() => {
  const version = activeVersionLabel.value || '当前版本'
  const device = iterationDevice.value
  if (!device) return version
  return `${version} · ${device.label}`
})

watch(isIteration, (iterating) => {
  if (!iterating) return
  pageTypePickerOpen.value = false
  activeConfigPanel.value = ''
})

const activeBatchProgress = computed(() => {
  const activeTask = generationTasks.value.find(
    (task) => task.state === 'running' || task.state === 'cancelling',
  )
  return activeTask?.progress?.length ? activeTask.progress : batchProgress.value
})

const canvasDeviceSlots = computed(() => {
  if (running.value && generatingDeviceIds.value.length) {
    return generatingDeviceIds.value.map((deviceId, index) => {
      const device = getDesignDevice(deviceId)
      const progress = activeBatchProgress.value[index] || {}
      const url = Array.isArray(progress.outputs) ? progress.outputs[0] || '' : ''
      return {
        deviceId,
        label: device.label,
        ratio: device.ratio,
        icon: device.icon,
        status: progress.status || (url ? 'done' : 'pending'),
        url,
        message: progress.message || '',
      }
    })
  }
  const carriers = activeVersionNode.value?.carriers || {}
  const order = new Map(DESIGN_DEVICE_OPTIONS.map((item, index) => [item.id, index]))
  return Object.entries(carriers)
    .filter(([, url]) => url)
    .sort(
      ([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([deviceId, url]) => {
      const device = getDesignDevice(deviceId)
      return {
        deviceId,
        label: device.label,
        ratio: device.ratio,
        icon: device.icon,
        status: 'done',
        url,
        message: '',
      }
    })
})

const showMultiDeviceLoading = computed(
  () => running.value && generatingDeviceIds.value.length > 1,
)
const showDeviceRail = computed(
  () => !running.value && canvasDeviceSlots.value.length > 1,
)

function slotFrameStyle(slot) {
  const [width = 16, height = 9] = String(slot?.ratio || '16:9')
    .split(':')
    .map(Number)
  return { aspectRatio: `${width} / ${Math.max(1, height)}` }
}

function selectCarrier(slot) {
  if (!slot?.url) return
  viewDeviceId.value = slot.deviceId
  selectOutput(slot.url)
}

function toggleDeviceSelection(id) {
  const current = [...selectedDeviceIds.value]
  const index = current.indexOf(id)
  if (index >= 0) {
    if (current.length === 1) return
    current.splice(index, 1)
  } else {
    current.push(id)
  }
  selectedDeviceIds.value = normalizeSelectedDeviceIds(current)
  if (!selectedDeviceIds.value.includes(viewDeviceId.value)) {
    viewDeviceId.value = selectedDeviceIds.value[0]
  }
}

function majorRootOf(node) {
  let cursor = node
  while (cursor?.parentId && versionNodeById.value.get(cursor.parentId)) {
    cursor = versionNodeById.value.get(cursor.parentId)
  }
  return cursor || null
}

function isMajorActive(majorId) {
  const root = majorRootOf(activeVersionNode.value)
  return Boolean(root?.id && root.id === majorId)
}

function selectMajorOnCanvas(majorId) {
  const node = versionNodeById.value.get(majorId)
  if (!node) return
  selectVersionNode(node)
}

function openVersionDrawer(majorId = '') {
  // versionMajors 已是最新在前；无指定时聚焦当前大版本，否则最新大版本。
  const fallback =
    majorRootOf(activeVersionNode.value)?.id || versionMajors.value[0]?.id || ''
  versionDrawerFocusId.value = majorId || fallback
  versionDrawerOpen.value = true
  void requestMoreHistory()
}

async function requestMoreHistory() {
  if (!historyHasMore.value || historyLoading.value || historyLoadQueued) return []
  historyLoadQueued = true
  try {
    return await loadMoreHistory(24)
  } catch (error) {
    notificationService.error(error?.message || historyError.value || '历史记录加载失败')
    return []
  } finally {
    historyLoadQueued = false
  }
}

function updateHistoryPageSize() {
  const width = historyViewport.value?.clientWidth || 0
  if (!width) return
  const next = Math.max(
    1,
    Math.floor((width + HISTORY_CARD_GAP) / (HISTORY_CARD_WIDTH + HISTORY_CARD_GAP)),
  )
  if (next !== historyPageSize.value) historyPageSize.value = next
  if (historyPage.value > historyPageCount.value - 1) {
    historyPage.value = Math.max(0, historyPageCount.value - 1)
  }
}

function setupHistoryViewportObserver() {
  historyResizeObserver?.disconnect()
  historyResizeObserver = null
  const target = historyViewport.value
  if (!target || typeof ResizeObserver === 'undefined') {
    updateHistoryPageSize()
    return
  }
  historyResizeObserver = new ResizeObserver(() => updateHistoryPageSize())
  historyResizeObserver.observe(target)
  updateHistoryPageSize()
}

function goPrevHistoryPage() {
  if (!canPrevHistoryPage.value) return
  historyPage.value -= 1
}

async function goNextHistoryPage() {
  if (historyPage.value < historyPageCount.value - 1) {
    historyPage.value += 1
    return
  }
  if (!historyHasMore.value) return
  await requestMoreHistory()
  await nextTick()
  if (historyPage.value < historyPageCount.value - 1) historyPage.value += 1
}

function selectVersionNode(node, preferredDeviceId = '') {
  const url = pickCarrier(node, preferredDeviceId || viewDeviceId.value)
  if (!url) return
  const deviceId = Object.entries(node.carriers || {}).find(([, value]) => value === url)?.[0]
  if (deviceId) viewDeviceId.value = deviceId
  selectOutput(url)
}

function iterateFromNode(node) {
  if (!canIterate(node)) {
    localError.value = '已达最终版本（Vn.n.n），请新建大版本继续'
    return
  }
  const url = pickCarrier(node, viewDeviceId.value)
  if (!url) return
  selectOutput(url)
  iterateFromActive()
  versionDrawerOpen.value = false
}

function analyzeVersionNode(node) {
  const url = pickCarrier(node, viewDeviceId.value)
  if (!url) return
  selectOutput(url)
  if (node.analysis?.id) {
    openEditableHistory(node.analysis)
  } else {
    editableResumeSession.value = null
    editableDocumentId.value = ''
    openEditableCanvas()
  }
  versionDrawerOpen.value = false
}

async function deleteVersionNodes(nodes) {
  const targets = nodes.flatMap((node) => collectDescendants(node))
  const urls = collectOutputUrls(targets)
  if (!urls.length) return
  versionDeleting.value = true
  try {
    const uniqueJobUrls = []
    const seenJobs = new Set()
    for (const url of urls) {
      const jobId = outputJobIds.value[url] || url
      if (seenJobs.has(jobId)) continue
      seenJobs.add(jobId)
      uniqueJobUrls.push(url)
    }
    for (const url of uniqueJobUrls) {
      await deleteOutput(url)
    }
    const removedUrls = new Set(urls)
    const removedEntries = editableHistory.value.filter((entry) =>
      removedUrls.has(entry?.referenceImage),
    )
    for (const entry of removedEntries) {
      if (entry?.id) removeScopedLocalItem(entry.id)
    }
    editableHistory.value = editableHistory.value.filter(
      (entry) => !removedUrls.has(entry?.referenceImage),
    )
    setScopedLocalItem(EDITABLE_HISTORY_KEY, JSON.stringify(editableHistory.value))
    selectedIdsCleanupAfterDelete()
    notificationService.success(`已删除 ${targets.length} 个版本`)
  } catch (error) {
    notificationService.error(error?.message || '删除版本失败')
  } finally {
    versionDeleting.value = false
  }
}

function selectedIdsCleanupAfterDelete() {
  if (!outputs.value.includes(activeOutput.value)) {
    activeOutput.value = outputs.value[0] || ''
  }
}

const activeQualityAuditKey = computed(() =>
  qualityAuditKey(activeOutput.value, qualityReviewMode.value),
)
const activeStoredQualityAudit = computed(
  () => qualityAuditsByOutput.value[activeQualityAuditKey.value] || null,
)
const qualityParentAudit = computed(() => {
  const parent = outputParents.value[activeOutput.value]
  return parent
    ? qualityAuditsByOutput.value[qualityAuditKey(parent, qualityReviewMode.value)] || null
    : null
})
const qualityScoreDelta = computed(() => {
  if (!qualityAudit.value || !qualityParentAudit.value) return null
  return qualityAudit.value.score - qualityParentAudit.value.score
})
const selectedQualityIssueCount = computed(() => selectedQualityIssueIds.value.length)
const qualityMarkedIssues = computed(() =>
  qualityAudit.value?.grounded === true && qualityAudit.value?.output === activeOutput.value
    ? qualityAudit.value.issues.filter((issue) => issue.region)
    : [],
)
const activeQualityIssue = computed(
  () =>
    qualityMarkedIssues.value.find((issue) => issue.id === activeQualityIssueId.value) ||
    qualityMarkedIssues.value[0] ||
    null,
)
const currentQualityReviewMode = computed(
  () =>
    DESIGN_QUALITY_REVIEW_MODES.find((item) => item.id === qualityReviewMode.value) ||
    DESIGN_QUALITY_REVIEW_MODES[0],
)
function qualityDimensionDelta(dimension) {
  const previous = qualityParentAudit.value?.dimensions?.find((item) => item.id === dimension.id)
  return previous ? dimension.score - previous.score : null
}

function normalizedRegionStyle(region) {
  if (!region) return {}
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  }
}

function qualityAssetPreviewStyle(asset) {
  const region = asset?.region
  if (!region || !activeOutput.value) return {}
  const horizontal = region.x / Math.max(0.001, 1 - region.width)
  const vertical = region.y / Math.max(0.001, 1 - region.height)
  return {
    backgroundImage: `url("${String(activeOutput.value).replaceAll('"', '\\"')}")`,
    backgroundSize: `${100 / region.width}% ${100 / region.height}%`,
    backgroundPosition: `${Math.max(0, Math.min(1, horizontal)) * 100}% ${Math.max(0, Math.min(1, vertical)) * 100}%`,
  }
}
function metricsForDevice(deviceOption) {
  return metricsForDeviceOption(deviceOption, {
    densityId: densityId.value,
    radiusLabel: radiusOption.value.label,
  })
}

const designMetrics = computed(() => metricsForDevice(device.value))
const specificationSummary = computed(() =>
  [
    audienceOption.value.label,
    goalOption.value.label,
    densityOption.value.label,
    radiusOption.value.label.replace(/\s+\d+px$/, ''),
  ]
    .filter(Boolean)
    .join(' · '),
)
// 环境光随品牌主色变化：只做低透明度的氛围渲染，控件仍使用固定强调色。
const ambientStyle = computed(() => ({ '--dws-brand': brandColor.value }))

function toggleComponentState(id) {
  const current = componentStates.value
  if (current.includes(id)) {
    if (current.length <= 1) {
      notificationService.info('至少保留一种组件状态')
      return
    }
    componentStates.value = current.filter((item) => item !== id)
    return
  }
  componentStates.value = [...current, id]
}

function resolvePageStructurePrompt() {
  if (pageTypeId.value === 'custom') return customPageType.value.trim()
  return pageType.value.prompt || ''
}

function buildAssembledPrompt(
  deviceOption = device.value,
  {
    multiDevice = false,
    isAnchor = false,
    deviceLabels = [],
  } = {},
) {
  const lines = []
  const metrics = metricsForDevice(deviceOption)
  const iterationText = iterationBrief.value.trim()
  const pagePrompt = resolvePageStructurePrompt()

  if (isIteration.value) {
    lines.push('任务类型：基于参考图的受控 UI 迭代，不是重新设计整张页面。')
    lines.push(`本次唯一修改：${iterationText || '保持当前设计，仅提升文字和边缘清晰度'}。`)
    lines.push(
      '锁定规则：除上述修改外，原图的画布比例、页面结构、组件位置与尺寸、间距、圆角、颜色、图标和装饰必须保持不变，不要新增、删除或移动任何元素。',
    )
    lines.push(
      '文字锁定：保留原图全部文案并逐字准确呈现，保持原有字号层级、字重、对齐和换行；文字边缘清晰锐利，不要乱码、伪文字、额外单词、随机标签、Logo 或水印。',
    )
    lines.push(
      `输出要求：${deviceOption.label} ${deviceOption.ratio}，正视图，整张图就是设计稿本身，不要样机、透视、倾斜、拼贴或设计软件界面。`,
    )
    lines.push(
      '多端同步：若同一版本存在其他设备稿，保持视觉系统、组件语言与文案一致，仅适配当前设备布局。',
    )
    return lines.join('\n')
  }

  const briefText = brief.value.trim()
  if (referenceImages.value.length) {
    const count = referenceImages.value.length
    lines.push(
      count > 1
        ? `基于提供的 ${count} 张参考界面进行重新设计：${briefText || '在保持信息结构与视觉系统的前提下提升视觉质量'}。多张参考图用于锁定同一产品/界面身份，请综合它们的结构、组件与视觉语言，不要把多张参考拼进同一张输出。`
        : `基于提供的参考界面进行重新设计：${briefText || '在保持信息结构的前提下提升视觉质量'}。`,
    )
  } else {
    lines.push(`为「${briefText || '一款现代数字产品'}」设计一张高保真 UI 设计稿。`)
  }

  lines.push(
    buildDeviceAdaptationBlock(deviceOption, {
      navigationId: navigationId.value,
      pageTypeId: pageTypeId.value,
      pagePrompt,
      multiDevice,
      isAnchor,
    }),
  )
  lines.push(`目标用户：${audienceOption.value.prompt}。`)
  lines.push(`核心目标：${goalOption.value.prompt}。`)
  lines.push(`信息密度：${densityOption.value.prompt}。`)
  lines.push(`视觉风格：${styleOption.value.prompt}。`)
  lines.push(
    `配色规范：品牌主色 ${brandColor.value}，${colorScheme.value === 'dark' ? '深色' : '浅色'}模式；建立 primary、surface、background、text、border、success、warning、error 语义色角色和完整中性色阶。同一语义只使用一种颜色，正文与背景对比度至少达到 WCAG AA。`,
  )
  lines.push(
    `栅格与间距：基准画布采用 ${metrics.columns} 列栅格，左右安全边距 ${metrics.margin}px，列间距 ${metrics.gutter}px；以 4px 为最小单位、8px 为主要步进，只使用 4/8/12/16/24/32/40/48/64px 间距。所有边缘、基线和组件严格对齐，禁止随意留白。`,
  )
  lines.push(
    `字体规范：${typographyOption.value.prompt}。使用 ${metrics.typeScale}px 字号阶梯，正文至少 14px，辅助文字至少 12px；标题、正文、标签分别限定字重和行高，单一层级保持一致，不使用模糊或无法辨认的伪文字。`,
  )
  lines.push(
    `组件规范：${radiusOption.value.prompt}。按钮、输入框、下拉框统一为 ${metrics.controlHeight}px 高；图标采用 16/20/24px 尺寸；同类按钮保持相同内边距、圆角和图标位置。卡片只用于独立内容单元，不嵌套卡片。`,
  )
  const selectedStates = COMPONENT_STATE_OPTIONS.filter((item) =>
    componentStates.value.includes(item.id),
  ).filter((item) => {
    // 窄屏/电视不以 hover 为主；保留 focus / pressed 等可落地状态描述。
    if (item.id !== 'interaction') return true
    return !['phone', 'miniapp', 'tv'].includes(deviceOption?.id)
  })
  if (selectedStates.length) {
    const stateText = selectedStates.map((item) => item.prompt).join('；')
    const touchExtra = ['phone', 'miniapp'].includes(deviceOption?.id)
      ? '；触控态以 pressed / focus 为主，不要依赖 hover'
      : deviceOption?.id === 'tv'
        ? '；以遥控器 focus 态为主'
        : ''
    lines.push(`组件状态：${stateText}${touchExtra}。`)
  }
  lines.push(
    `响应式策略：${responsiveOption.value.prompt}。当前只渲染 ${deviceOption.label} 断点，按该断点完整表达，不要在一张图里拼多个断点。`,
  )
  if (multiDevice) {
    lines.push(
      buildContentConsistencyLock({
        brief: briefText,
        pageTypeLabel: pageType.value.label,
        deviceLabels,
        brandColor: brandColor.value,
      }),
    )
  }
  lines.push(
    buildDesignQualityRules({
      pageType: pageTypeId.value,
      style: styleId.value,
      density: densityId.value,
      colorScheme: colorScheme.value,
    }),
  )
  lines.push(
    '交付检查：真实产品级完整页面，组件按原子、组合、模块、模板层级复用；内容不得溢出、遮挡、截断关键操作或出现错位，细节可直接用于开发交付。',
  )
  lines.push(
    '文字要求：只使用需求中明确出现或与产品直接相关的简短文案，逐字清晰准确；使用现代无衬线字体，中文接近 Noto Sans SC，英文与数字接近 Inter，不要乱码、伪文字、额外标签或随机字母。',
  )
  lines.push(
    '画面要求：整张图就是设计稿本身，铺满画布。不要设备样机外壳、不要透视和倾斜、不要多页拼贴、不要展示设计软件窗口、不要水印。',
  )
  return lines.join('\n')
}

const assembledPrompt = computed(() => buildAssembledPrompt(device.value))

const artboardStyle = computed(() => {
  const ratioText = String(device.value?.ratio || '16:9')
  const [width = 16, height = 9] = ratioText.split(':').map(Number)
  const ratio = width / Math.max(1, height)
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 220px) * ${ratio}))`,
  }
})
const regionSelectionStyle = computed(() => {
  const region = regionSelection.value
  if (!region) return {}
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  }
})

const editableViewport = computed(() => {
  const background = colorScheme.value === 'dark' ? '#111217' : '#ffffff'
  const viewport = device.value.viewport || { width: 1440, height: 810 }
  return { ...viewport, background }
})
const editableCanvasPrompt = computed(
  () => editableResumeSession.value?.prompt || assembledPrompt.value,
)
const hasActiveAnalysis = computed(() => Boolean(editableResumeSession.value?.conversationId))

useStudioMotion(studioRoot, activeOutput)

function restoreActiveAnalysisSession() {
  const session = readStoredActiveAnalysisSession()
  if (!session) return
  editableResumeSession.value = session
  activeOutput.value = session.referenceImage
  editableDocumentId.value = ''
  editableCanvasOpen.value = true
  editableGenerationNonce.value += 1
  tabletPane.value = 'canvas'
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  await Promise.all([initialize(), loadAnalysisModels()])
  restoreTileRefineFinals()
  restoreActiveAnalysisSession()
  const pending = takePendingPrompt('ui_design')
  if (pending) {
    const launchConfig = pending.config || {}
    const launchPrompt = composePendingLaunchPrompt(pending, 1000)
    if (launchPrompt) brief.value = launchPrompt
    if (hasOption(PAGE_TYPE_OPTIONS, launchConfig.skill)) pageTypeId.value = launchConfig.skill
    if (launchConfig.devices || launchConfig.device) {
      selectedDeviceIds.value = normalizeSelectedDeviceIds(
        launchConfig.devices || launchConfig.device,
      )
      viewDeviceId.value = selectedDeviceIds.value[0]
    }
    if (launchConfig.model && models.value.some((model) => model.id === launchConfig.model)) {
      modelId.value = launchConfig.model
    }
  }
})

watch(activeOutput, (value) => {
  regionReviewController?.abort()
  regionReviewController = null
  regionReviewLoading.value = false
  if (value) tabletPane.value = 'canvas'
  const deviceFromMeta = versionMetaByOutput.value[value]?.deviceId
  if (deviceFromMeta) viewDeviceId.value = deviceFromMeta
  qualityAudit.value =
    qualityAuditsByOutput.value[qualityAuditKey(value, qualityReviewMode.value)] || null
  selectedQualityIssueIds.value = qualityAudit.value?.issues.map((issue) => issue.id) || []
  activeQualityIssueId.value = qualityAudit.value?.issues.find((issue) => issue.region)?.id || ''
  qualityAuditError.value = ''
  regionSelectionMode.value = false
  regionSelection.value = null
  regionPreview.value = ''
  regionReview.value = null
  regionReviewError.value = ''
})

watch(
  qualityAuditsByOutput,
  (value) => {
    const entries = Object.entries(value)
      .sort(([, a], [, b]) => String(b?.auditedAt || '').localeCompare(String(a?.auditedAt || '')))
      .slice(0, 36)
    setScopedLocalItem(QUALITY_AUDIT_HISTORY_KEY, JSON.stringify(Object.fromEntries(entries)))
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  historyResizeObserver?.disconnect()
  historyResizeObserver = null
  qualityAuditController?.abort()
  regionReviewController?.abort()
})

watch(
  [historyViewport, () => versionMajors.value.length, historyLoading],
  async () => {
    await nextTick()
    setupHistoryViewportObserver()
  },
  { flush: 'post' },
)

watch(
  [() => versionMajors.value.length, historyPageSize, historyHasMore, historyPage],
  async () => {
    if (historyPage.value > historyPageCount.value - 1) {
      historyPage.value = Math.max(0, historyPageCount.value - 1)
    }
    // 翻到末页时预取更多历史，保证可继续下一页。
    if (
      historyHasMore.value &&
      !historyLoading.value &&
      historyPage.value >= Math.max(0, historyPageCount.value - 1)
    ) {
      await requestMoreHistory()
    }
  },
)

watch(analysisModelId, (value) => {
  if (value) setScopedLocalItem(ANALYSIS_MODEL_KEY, value)
})

watch(
  [
    brief,
    selectedDeviceIds,
    pageTypeId,
    customPageType,
    styleId,
    brandColor,
    colorScheme,
    audienceId,
    goalId,
    navigationId,
    densityId,
    typographyId,
    radiusId,
    responsiveId,
    componentStates,
  ],
  () => {
    setScopedLocalItem(
      SETTINGS_KEY,
      JSON.stringify({
        designSpecVersion: DESIGN_SPEC_VERSION,
        brief: brief.value,
        selectedDeviceIds: selectedDeviceIds.value,
        deviceId: selectedDeviceIds.value[0] || 'web',
        pageTypeId: pageTypeId.value,
        customPageType: customPageType.value,
        styleId: styleId.value,
        brandColor: brandColor.value,
        colorScheme: colorScheme.value,
        audienceId: audienceId.value,
        goalId: goalId.value,
        navigationId: navigationId.value,
        densityId: densityId.value,
        typographyId: typographyId.value,
        radiusId: radiusId.value,
        responsiveId: responsiveId.value,
        componentStates: componentStates.value,
      }),
    )
  },
  { deep: true },
)

function createReferenceId() {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function applyReferenceFiles(files = [], { notify = false } = {}) {
  const images = (Array.isArray(files) ? files : [files]).filter(
    (file) => file && String(file.type || '').startsWith('image/'),
  )
  if (!images.length) {
    localError.value = '请选择图片文件作为参考界面'
    return 0
  }
  if (isIteration.value) {
    iterationSource.value = ''
    iterationBrief.value = ''
  }
  const slots = referenceSlotsLeft.value
  if (slots <= 0) {
    localError.value = `参考图最多 ${MAX_REFERENCE_IMAGES} 张`
    notificationService.info(`参考图最多 ${MAX_REFERENCE_IMAGES} 张`)
    return 0
  }
  const accepted = images.slice(0, slots)
  const skipped = images.length - accepted.length
  const next = [...referenceImages.value]
  for (const file of accepted) {
    next.push({
      id: createReferenceId(),
      file,
      preview: await readImageFile(file),
      name: file.name || `参考图 ${next.length + 1}`,
    })
  }
  referenceImages.value = next
  localError.value = ''
  if (notify) {
    if (skipped > 0) {
      notificationService.info(`已添加 ${accepted.length} 张，另有 ${skipped} 张超出 ${MAX_REFERENCE_IMAGES} 张上限`)
    } else {
      notificationService.success(
        accepted.length > 1 ? `已添加 ${accepted.length} 张参考图` : '已添加参考图',
      )
    }
  } else if (skipped > 0) {
    localError.value = `最多 ${MAX_REFERENCE_IMAGES} 张，已忽略 ${skipped} 张`
  }
  return accepted.length
}

async function chooseFile(event) {
  const files = [...(event.target.files || [])]
  if (!files.length) return
  await applyReferenceFiles(files)
  event.target.value = ''
}

function extractClipboardImages(clipboardData) {
  const fromItems = [...(clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (fromItems.length) return fromItems
  return [...(clipboardData?.files || [])].filter((file) => file.type?.startsWith('image/'))
}

async function handleBriefPaste(event) {
  const files = extractClipboardImages(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  await applyReferenceFiles(files, { notify: true })
}

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function onComposerDragEnter(event) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  composerDragDepth += 1
  composerDragging.value = true
}

function onComposerDragOver(event) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onComposerDragLeave(event) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  composerDragDepth = Math.max(0, composerDragDepth - 1)
  if (!composerDragDepth) composerDragging.value = false
}

async function onComposerDrop(event) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  composerDragDepth = 0
  composerDragging.value = false
  const files = [...(event.dataTransfer?.files || [])].filter((entry) =>
    String(entry.type || '').startsWith('image/'),
  )
  if (!files.length) {
    localError.value = '请拖入图片文件作为参考界面'
    return
  }
  await applyReferenceFiles(files, { notify: true })
}

function removeReferenceImage(id) {
  referenceImages.value = referenceImages.value.filter((item) => item.id !== id)
  if (fileInput.value) fileInput.value.value = ''
}

function clearReference() {
  referenceImages.value = []
  iterationSource.value = ''
  iterationBrief.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function clearComposer() {
  if (isIteration.value) {
    clearReference()
    iterationBrief.value = ''
  } else {
    referenceImages.value = []
    brief.value = ''
    if (fileInput.value) fileInput.value.value = ''
  }
  localError.value = ''
  nextTick(() => briefField.value?.focus())
}

const canClearComposer = computed(
  () =>
    Boolean(briefInput.value?.trim()) ||
    referenceImages.value.length > 0 ||
    Boolean(iterationSource.value),
)

function iterateFromActive() {
  if (!activeOutput.value) return
  if (!canIterateActive.value) {
    localError.value = '已达最终版本（Vn.n.n），请清除迭代并新建大版本'
    return
  }
  iterationSource.value = activeOutput.value
  iterationBrief.value = ''
  referenceImages.value = []
  if (fileInput.value) fileInput.value.value = ''
  localError.value = ''
  tabletPane.value = 'controls'
  nextTick(() => briefField.value?.focus())
}

async function generate() {
  localError.value = ''
  mediaError.value = ''
  if (isIteration.value && !iterationBrief.value.trim()) {
    localError.value = '请描述本次迭代只需要修改的内容'
    tabletPane.value = 'controls'
    nextTick(() => briefField.value?.focus())
    return
  }
  if (!brief.value.trim() && !hasReference.value) {
    localError.value = '请先描述产品和页面内容，或导入一张参考界面'
    return
  }
  if (isIteration.value && !canIterateActive.value) {
    localError.value = '已达最终版本（Vn.n.n），无法继续迭代'
    return
  }
  const iterationBase = iterationSource.value
  const carriers = activeVersionNode.value?.carriers || {}
  // 迭代只改当前成稿所在端，避免用电脑端比例去锁死手机端。
  // 新建多端：宽屏母版优先，其余端继承视觉系统与文案数据。
  const devices = iterationBase
    ? [
        getDesignDevice(
          Object.entries(carriers).find(([, url]) => url === iterationBase)?.[0] ||
            viewDeviceId.value,
        ),
      ].filter(Boolean)
    : orderDevicesForConsistency(selectedDevices.value)
  if (!devices.length) {
    localError.value = '请至少选择一个设备载体'
    return
  }
  const multiDevice = devices.length > 1
  const deviceLabels = devices.map((item) => item.label)
  generatingDeviceIds.value = devices.map((item) => item.id)
  viewDeviceId.value = devices[0]?.id || viewDeviceId.value
  tabletPane.value = 'canvas'
  const groupId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const referenceFiles = referenceImages.value.map((item) => item.file).filter(Boolean)
  try {
    const result = await generateBatch(
      devices.map((item, index) => ({
        prompt: buildAssembledPrompt(item, {
          multiDevice,
          isAnchor: index === 0,
          deviceLabels,
        }),
        aspectRatio: item.ratio,
        platform: item.label,
        deviceId: item.id,
        viewId: item.id,
        viewLabel: item.label,
        parentOutputUrl: iterationBase || '',
        iterationMode: Boolean(iterationBase),
        quality: 'high',
        inputFidelity: multiDevice || Boolean(iterationBase) ? 'high' : '',
        count: 1,
        consistencyStrategy: multiDevice ? 'identity-first-anchor-then-parallel' : '',
        referenceRoles: referenceFiles.length
          ? referenceFiles.map((_, at) => (at === 0 ? '用户参考界面（身份）' : '补充参考界面'))
          : [],
        seriesAnchorRole: UI_SERIES_ANCHOR_ROLE,
        essentialReferenceCount: referenceFiles.length ? 1 : 0,
      })),
      {
        files: referenceFiles,
        sourceUrl: iterationBase,
        concurrency: Math.min(devices.length, 4),
        // 新建多端：先出母版，再并行适配其余端并注入系列锚点。
        chainReferenceOutput: multiDevice,
        essentialReferenceCount: referenceFiles.length ? 1 : 0,
        referencePolicy: referenceFiles.length
          ? { strategy: 'identity-first', essentialIdentityCount: 1 }
          : undefined,
        groupId,
      },
    )
    if (result?.outputs?.length && iterationBase && iterationSource.value === iterationBase) {
      clearReference()
    }
  } finally {
    generatingDeviceIds.value = []
  }
  await nextTick()
  // 生成结束后优先展示当前查看端（或首个成功端），其余端通过右侧缩略图切换。
  const preferred =
    canvasDeviceSlots.value.find((slot) => slot.deviceId === viewDeviceId.value && slot.url) ||
    canvasDeviceSlots.value.find((slot) => slot.url)
  if (preferred?.url) selectCarrier(preferred)
}

const tileRefineBusy = computed(
  () => Boolean(tileRefinePhase.value) && tileRefinePhase.value !== 'done',
)
const tileRefineCostLabel = computed(() => formatCostEstimate(4))
const tileRefineProgress = computed(() => {
  if (!tileRefineBusy.value) return []
  return activeBatchProgress.value.length
    ? activeBatchProgress.value
    : [
        { label: '左上', status: 'pending' },
        { label: '右上', status: 'pending' },
        { label: '左下', status: 'pending' },
        { label: '右下', status: 'pending' },
      ]
})

function shouldSkipTileRefineConfirm() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tileRefineAuto') === '1') return true
    if (window.localStorage.getItem('dws.tileRefine.skipConfirm') === '1') return true
  } catch {
    /* ignore */
  }
  return false
}

function readTileRefineFinals() {
  try {
    const raw = JSON.parse(getScopedLocalItem(TILE_REFINE_FINALS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((item) => item?.url) : []
  } catch {
    return []
  }
}

function persistTileRefineFinal(entry) {
  if (!entry?.url) return
  const next = [entry, ...readTileRefineFinals().filter((item) => item.url !== entry.url)].slice(
    0,
    40,
  )
  setScopedLocalItem(TILE_REFINE_FINALS_KEY, JSON.stringify(next))
}

function restoreTileRefineFinals() {
  const finals = readTileRefineFinals()
  if (!finals.length) return
  const marked = { ...tileRefineOutputs.value }
  const bySource = { ...tileRefineBySource.value }
  for (const entry of finals) {
    marked[entry.url] = true
    const source = String(entry.parentOutputUrl || '')
    // finals 按最新在前存储，同一原稿只保留最新一次精修结果。
    if (source && !bySource[source]) bySource[source] = entry
  }
  tileRefineOutputs.value = marked
  tileRefineBySource.value = bySource
}

const activeTileRefineEntry = computed(
  () => tileRefineBySource.value[String(activeOutput.value || '')] || null,
)

function handleTileRefineClick() {
  if (tileRefineBusy.value) return
  const existing = activeTileRefineEntry.value
  if (existing) {
    tileRefineDialogEntry.value = existing
    tileRefineDialogOpen.value = true
    return
  }
  runTilePrecisionRefine()
}

function rerunTileRefineFromDialog() {
  const source = String(tileRefineDialogEntry.value?.parentOutputUrl || activeOutput.value || '')
  tileRefineDialogOpen.value = false
  runTilePrecisionRefine(source)
}

function applyTileRefineToCanvas() {
  const entry = tileRefineDialogEntry.value
  if (!entry?.url) return
  tileRefineDialogOpen.value = false
  if (entry.deviceId) viewDeviceId.value = entry.deviceId
  activeOutput.value = entry.url
  tabletPane.value = 'canvas'
  mediaError.value = ''
}

async function runTilePrecisionRefine(sourceOverride = '') {
  localError.value = ''
  tileRefineError.value = ''
  mediaError.value = ''
  if (!(sourceOverride || activeOutput.value)) {
    localError.value = '请先选择一张设计稿，再进行四宫格精修'
    return
  }
  if (running.value || tileRefineBusy.value) {
    localError.value = '请等待当前生成任务完成'
    return
  }
  const skipConfirm = shouldSkipTileRefineConfirm()
  if (!skipConfirm) {
    const confirmed = window.confirm(
      `四宫格精修会把当前设计稿十字切成左上/右上/左下/右下 4 块，并发生成后再按原坐标硬拼回 1 张完整图（尺寸与像素网格与原图一致）。\n\n预计消耗约 4 张图费用（${tileRefineCostLabel.value || '以服务端结算为准'}），耗时更长。是否继续？`,
    )
    if (!confirmed) return
  }

  const sourceUrl = String(sourceOverride || activeOutput.value)
  const sourceDeviceId =
    Object.entries(activeVersionNode.value?.carriers || {}).find(([, url]) => url === sourceUrl)?.[0] ||
    viewDeviceId.value
  const sourceDevice = getDesignDevice(sourceDeviceId)
  const groupId = `tile-refine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  tabletPane.value = 'canvas'

  try {
    tileRefinePhase.value = 'preparing'
    const sourceBlob = await fetchAuthenticatedMediaBlob(sourceUrl, { cache: 'no-store' })
    if (!sourceBlob?.size) throw new Error('无法读取当前设计稿原图')
    const extracted = await extractQuadrantTileFiles(sourceBlob)

    const uploadedTiles = []
    for (const entry of extracted.files) {
      // Only send the padded quadrant crop. Full-page refs leak other zones into the tile
      // and cause ghosted titles/charts after stitching.
      const tileUrl = await uploadAiInputFile(entry.file)
      uploadedTiles.push({ ...entry, tileUrl })
    }

    tileRefinePhase.value = 'generating'
    const result = await generateBatch(
      uploadedTiles.map((entry, index) => ({
        prompt: buildTileRefinePrompt({
          quadrantLabel: entry.tile.label,
          aspectLabel: entry.tile.aspectLabel || entry.tile.aspectRatio,
        }),
        aspectRatio: entry.tile.aspectLabel || entry.tile.aspectRatio,
        outputLongSide: resolveTileOutputLongSide(entry.tile),
        platform: `${sourceDevice.label} · 四宫格精修 · ${entry.tile.label}`,
        deviceId: sourceDeviceId,
        viewId: `tile-${entry.tile.id}`,
        viewLabel: `精修·${entry.tile.label}`,
        parentOutputUrl: sourceUrl,
        iterationMode: true,
        quality: 'high',
        inputFidelity: 'high',
        count: 1,
        suppressHistory: true,
        sourceUrls: [entry.tileUrl],
        prioritizeSourceUrls: true,
        referenceRoles: ['当前象限切片（唯一精修对象，禁止补全切片外内容）'],
        essentialReferenceCount: 1,
        consistencyStrategy: 'revision-anchor-with-original-identity',
        batchIndex: index,
        batchSize: 4,
      })),
      {
        concurrency: 4,
        groupId,
        referencePolicy: { strategy: 'identity-first', essentialIdentityCount: 1 },
      },
    )

    // Prefer batchIndex match; fall back to progress order so merge never misses a tile.
    const tileOutputs = Array.from({ length: 4 }, (_, index) => {
      const match = (result?.items || []).find(
        (item) => Number(item.batchIndex ?? -1) === index,
      )
      if (match?.outputs?.[0]) return match.outputs[0]
      const progress = activeBatchProgress.value[index]
      return Array.isArray(progress?.outputs) ? progress.outputs[0] || '' : ''
    })
    if (tileOutputs.filter(Boolean).length < 4) {
      const cancelLike = (result?.failures || []).some((entry) =>
        /取消|abort/i.test(String(entry?.message || '')),
      )
      if (cancelLike) {
        tileRefinePhase.value = ''
        notificationService.info('已停止四宫格精修')
        return
      }
      const failed = result?.failures?.[0]?.message || '部分象限精修失败，无法合并'
      throw new Error(failed)
    }

    tileRefinePhase.value = 'stitching'
    const regeneratedBlobs = []
    for (const url of tileOutputs) {
      const blob = await fetchAuthenticatedMediaBlob(url, { cache: 'no-store' })
      if (!blob?.size) throw new Error('精修结果读取失败，无法合并')
      regeneratedBlobs.push(blob)
    }

    // 核心交付：4 象限无损拼成 1 张完整设计稿（中间象限图不展示）。
    const stitched = await stitchQuadrantTiles({
      tiles: extracted.tiles,
      tileImages: regeneratedBlobs,
      originalCrops: extracted.files.map((entry) => entry.cropFile),
      fullWidth: extracted.width,
      fullHeight: extracted.height,
    })
    if (!stitched?.file?.size) throw new Error('四宫格拼接失败，未生成合并图')
    const stitchedUrl = await uploadAiTempBlob(stitched.file)
    if (!stitchedUrl) throw new Error('合并图上传失败')

    const finishedAt = new Date().toISOString()
    const finalEntry = {
      url: stitchedUrl,
      parentOutputUrl: sourceUrl,
      deviceId: sourceDeviceId,
      aspectRatio: sourceDevice.ratio,
      width: stitched.width,
      height: stitched.height,
      finishedAt,
    }
    persistTileRefineFinal(finalEntry)
    tileRefineBySource.value = { ...tileRefineBySource.value, [sourceUrl]: finalEntry }
    tileRefineOutputs.value = { ...tileRefineOutputs.value, [stitchedUrl]: true }

    // 删除 4 张中间象限任务，避免历史里冒出四分之一图。
    const intermediateJobIds = (result?.items || [])
      .map((item) => String(item.jobId || '').trim())
      .filter(Boolean)
    await Promise.allSettled(intermediateJobIds.map((jobId) => deleteServerAiJob(jobId)))

    // 结果只在弹窗展示（Beta），不进版本抽屉；用户可在弹窗内重新精修或应用到画布。
    tileRefineDialogEntry.value = finalEntry
    tileRefineDialogOpen.value = true
    tileRefinePhase.value = 'done'
    notificationService.success(
      `四宫格精修完成：4 块已按原坐标硬拼为 ${stitched.width}×${stitched.height} 完整图`,
    )
    window.setTimeout(() => {
      if (tileRefinePhase.value === 'done') tileRefinePhase.value = ''
    }, 1600)
  } catch (caught) {
    if (caught?.name === 'AbortError') {
      tileRefinePhase.value = ''
      return
    }
    tileRefineError.value = caught?.message || '四宫格精修失败'
    localError.value = tileRefineError.value
    tileRefinePhase.value = ''
    notificationService.error(tileRefineError.value)
  }
}

function openEditableCanvas() {
  localError.value = ''
  editableSeedFindings.value = null
  if (hasActiveAnalysis.value) {
    activeOutput.value = editableResumeSession.value.referenceImage
    editableDocumentId.value = ''
    editableGenerationNonce.value += 1
    editableCanvasOpen.value = true
    tabletPane.value = 'canvas'
    return
  }
  if (!activeOutput.value) {
    localError.value = '请先生成或选择一张设计稿，再分析其中的元素'
    tabletPane.value = 'canvas'
    return
  }
  const existing = activeVersionNode.value?.analysis
  if (existing?.id) {
    openEditableHistory(existing)
    return
  }
  editableResumeSession.value = null
  editableDocumentId.value = ''
  editableCanvasOpen.value = true
}

function openQualityAssetExtraction() {
  const assets = qualityAudit.value?.developerAssets || []
  if (!activeOutput.value || qualityAudit.value?.grounded !== true || !assets.length) return
  editableResumeSession.value = null
  editableDocumentId.value = ''
  editableSeedFindings.value = {
    id: `${qualityAudit.value.reviewMode || 'balanced'}-${qualityAudit.value.auditedAt || Date.now()}`,
    issues: qualityAudit.value.issues.filter((issue) => issue.region),
    assets,
  }
  qualityAuditOpen.value = false
  tabletPane.value = 'canvas'
  nextTick(() => {
    editableCanvasOpen.value = true
    nextTick(() => {
      editableGenerationNonce.value += 1
    })
  })
}

async function downloadActive() {
  if (!activeOutput.value) return
  mediaError.value = ''
  try {
    await downloadAuthenticatedMedia(activeOutput.value, `ui-design-${Date.now()}.png`)
  } catch (caught) {
    mediaError.value = caught?.message || '设计稿下载失败'
  }
}

function toggleRegionSelection() {
  if (!activeOutput.value || running.value) return
  qualityAuditOpen.value = false
  regionSelectionMode.value = !regionSelectionMode.value
  regionReviewError.value = ''
  if (regionSelectionMode.value) regionSelection.value = null
}

function closeQualityAudit({ restoreFocus = true } = {}) {
  qualityAuditOpen.value = false
  if (restoreFocus) nextTick(() => qualityTrigger.value?.focus())
}

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') return
  if (qualityAuditOpen.value) {
    event.preventDefault()
    closeQualityAudit()
    return
  }
  if (pageTypePickerOpen.value) {
    event.preventDefault()
    closePageTypePicker()
    return
  }
  if (activeConfigPanel.value) {
    event.preventDefault()
    closeConfigPicker()
    return
  }
  if (versionDrawerOpen.value) {
    event.preventDefault()
    versionDrawerOpen.value = false
    return
  }
  if (regionSelectionMode.value) {
    event.preventDefault()
    regionSelectionStart = null
    regionSelectionMode.value = false
    regionSelection.value = null
    regionReviewError.value = ''
  }
}

function trapQualityFocus(event) {
  if (event.key !== 'Tab') return
  const controls = [...(qualityDialogRef.value?.querySelectorAll('button:not(:disabled)') || [])]
  if (!controls.length) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleArtboardClick() {
  if (suppressArtboardClick) {
    suppressArtboardClick = false
    return
  }
  if (!regionSelectionMode.value) openActivePreview()
}

function regionPoint(event, element) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  }
}

function beginRegionSelection(event) {
  if (!regionSelectionMode.value) return
  regionReviewError.value = ''
  const point = regionPoint(event, event.currentTarget)
  regionSelectionStart = point
  regionSelection.value = { x: point.x, y: point.y, width: 0, height: 0 }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function cancelRegionSelectionPointer() {
  if (!regionSelectionStart) return
  regionSelectionStart = null
  regionSelection.value = null
  regionReviewError.value = '框选已取消，请重新拖拽选择区域'
}

function moveRegionSelection(event) {
  if (!regionSelectionStart) return
  const point = regionPoint(event, event.currentTarget)
  regionSelection.value = {
    x: Math.min(regionSelectionStart.x, point.x),
    y: Math.min(regionSelectionStart.y, point.y),
    width: Math.abs(point.x - regionSelectionStart.x),
    height: Math.abs(point.y - regionSelectionStart.y),
  }
}

async function captureSelectedRegion(region) {
  const image = artboardRef.value?.querySelector('img')
  if (!image) throw new Error('当前设计稿还没有加载完成')
  if (!image.complete) await image.decode()
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const sourceX = Math.round(region.x * sourceWidth)
  const sourceY = Math.round(region.y * sourceHeight)
  const cropWidth = Math.max(1, Math.round(region.width * sourceWidth))
  const cropHeight = Math.max(1, Math.round(region.height * sourceHeight))
  const scale = Math.min(1, 1200 / Math.max(cropWidth, cropHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cropWidth * scale))
  canvas.height = Math.max(1, Math.round(cropHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建区域预览')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/png')
}

async function finishRegionSelection(event) {
  if (!regionSelectionStart) return
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  regionSelectionStart = null
  const region = regionSelection.value
  if (!region || region.width < 0.04 || region.height < 0.04) {
    regionSelection.value = null
    regionReviewError.value = '框选范围太小，请拖出一个完整的界面区域'
    return
  }
  regionSelectionMode.value = false
  suppressArtboardClick = true
  await runRegionQualityAudit(region)
}

async function runRegionQualityAudit(region = regionSelection.value) {
  if (!activeOutput.value || !region || regionReviewLoading.value) return
  const reviewedOutput = activeOutput.value
  qualityAuditOpen.value = true
  nextTick(() => qualityCloseButton.value?.focus())
  regionReviewLoading.value = true
  regionReviewError.value = ''
  regionReview.value = null
  regionReviewController?.abort()
  const controller = new AbortController()
  regionReviewController = controller
  try {
    const regionImage = await captureSelectedRegion(region)
    regionPreview.value = regionImage
    const analyze = (model) =>
      auditAiDesignRegion({
        image: reviewedOutput,
        regionImage,
        region,
        model,
        productPrompt: brief.value.trim(),
        signal: controller.signal,
      })
    try {
      const result = await analyze(analysisModelId.value)
      if (activeOutput.value === reviewedOutput && regionReviewController === controller) {
        regionReview.value = result
      }
    } catch (caught) {
      if (!String(caught?.message || '').includes('所选模型不可用')) throw caught
      await loadAnalysisModels()
      const result = await analyze('')
      if (activeOutput.value === reviewedOutput && regionReviewController === controller) {
        regionReview.value = result
      }
    }
  } catch (caught) {
    if (
      caught?.name !== 'AbortError' &&
      activeOutput.value === reviewedOutput &&
      regionReviewController === controller
    ) {
      regionReviewError.value = caught?.message || '框选区域分析失败'
    }
  } finally {
    if (regionReviewController === controller) {
      regionReviewLoading.value = false
      regionReviewController = null
    }
  }
}

function applyRegionReview() {
  const prompt = regionReview.value?.iterationPrompt?.trim()
  if (!activeOutput.value || !prompt) return
  iterationSource.value = activeOutput.value
  iterationBrief.value = prompt
  referenceImages.value = []
  if (fileInput.value) fileInput.value.value = ''
  qualityAuditOpen.value = false
  tabletPane.value = 'controls'
  nextTick(() => briefField.value?.focus())
}

function clearRegionSelection() {
  regionReviewController?.abort()
  regionReviewController = null
  regionReviewLoading.value = false
  regionSelectionMode.value = false
  regionSelection.value = null
  regionPreview.value = ''
  regionReview.value = null
  regionReviewError.value = ''
}

function openQualityAudit() {
  qualityAuditOpen.value = true
  nextTick(() => qualityCloseButton.value?.focus())
  if (activeStoredQualityAudit.value) {
    qualityAudit.value = activeStoredQualityAudit.value
    selectedQualityIssueIds.value = qualityAudit.value.issues.map((issue) => issue.id)
    activeQualityIssueId.value = qualityAudit.value.issues.find((issue) => issue.region)?.id || ''
    return
  }
  runQualityAudit()
}

function selectQualityReviewMode(mode) {
  if (!DESIGN_QUALITY_REVIEW_MODES.some((item) => item.id === mode)) return
  qualityReviewMode.value = mode
  qualityAudit.value =
    qualityAuditsByOutput.value[qualityAuditKey(activeOutput.value, mode)] || null
  selectedQualityIssueIds.value = qualityAudit.value?.issues.map((issue) => issue.id) || []
  activeQualityIssueId.value = qualityAudit.value?.issues.find((issue) => issue.region)?.id || ''
  qualityAuditError.value = ''
}

function selectQualityIssues(mode) {
  const issues = qualityAudit.value?.issues || []
  selectedQualityIssueIds.value = issues
    .filter((issue) => mode === 'all' || ['critical', 'major'].includes(issue.severity))
    .map((issue) => issue.id)
}

function toggleQualityIssue(id) {
  selectedQualityIssueIds.value = selectedQualityIssueIds.value.includes(id)
    ? selectedQualityIssueIds.value.filter((item) => item !== id)
    : [...selectedQualityIssueIds.value, id]
}

function activateQualityIssue(id) {
  if (!qualityAudit.value?.issues.some((issue) => issue.id === id && issue.region)) return
  activeQualityIssueId.value = id
}

function openLocatedQualityIssue(id) {
  activateQualityIssue(id)
  qualityAuditOpen.value = true
}

async function runQualityAudit() {
  if (!activeOutput.value || qualityAuditing.value) return
  const auditedOutput = activeOutput.value
  const auditedMode = qualityReviewMode.value
  const parentOutput = outputParents.value[auditedOutput]
  const auditedBaseline = parentOutput
    ? qualityAuditsByOutput.value[qualityAuditKey(parentOutput, auditedMode)] || null
    : null
  qualityAuditOpen.value = true
  qualityAuditError.value = ''
  qualityAuditing.value = true
  qualityAuditController?.abort()
  qualityAuditController = new AbortController()
  try {
    const audit = (model) =>
      auditAiDesignQuality({
        image: activeOutput.value,
        model,
        productPrompt: brief.value.trim(),
        pageType: pageType.value.label,
        style: styleOption.value.label,
        density: densityOption.value.label,
        colorScheme: colorScheme.value === 'dark' ? '深色' : '浅色',
        reviewMode: auditedMode,
        baseline: auditedBaseline,
        signal: qualityAuditController.signal,
      })
    let result
    try {
      result = await audit(analysisModelId.value)
    } catch (caught) {
      if (!String(caught?.message || '').includes('所选模型不可用')) throw caught
      await loadAnalysisModels()
      result = await audit('')
    }
    const snapshot = {
      ...result,
      output: auditedOutput,
      version: versionMetaByOutput.value[auditedOutput]?.label || '',
      reviewMode: auditedMode,
      auditedAt: new Date().toISOString(),
    }
    const snapshotKey = qualityAuditKey(auditedOutput, auditedMode)
    qualityAuditsByOutput.value = { ...qualityAuditsByOutput.value, [snapshotKey]: snapshot }
    if (activeOutput.value === auditedOutput && qualityReviewMode.value === auditedMode) {
      qualityAudit.value = snapshot
      selectedQualityIssueIds.value = snapshot.issues.map((issue) => issue.id)
      activeQualityIssueId.value = snapshot.issues.find((issue) => issue.region)?.id || ''
    }
  } catch (caught) {
    if (caught?.name !== 'AbortError') {
      qualityAuditError.value = caught?.message || '品质检查失败'
    }
  } finally {
    qualityAuditing.value = false
    qualityAuditController = null
  }
}

function applyQualityAuditFixes() {
  const prompt = buildQualityIterationPrompt(
    qualityAudit.value,
    selectedQualityIssueIds.value,
  ).trim()
  if (!activeOutput.value || !prompt) return
  iterationSource.value = activeOutput.value
  iterationBrief.value = prompt
  referenceImages.value = []
  if (fileInput.value) fileInput.value.value = ''
  qualityAuditOpen.value = false
  tabletPane.value = 'controls'
  nextTick(() => briefField.value?.focus())
}

function selectOutput(output, openPreview = false) {
  activeOutput.value = output
  tabletPane.value = 'canvas'
  mediaError.value = ''
  qualityAudit.value =
    qualityAuditsByOutput.value[qualityAuditKey(output, qualityReviewMode.value)] || null
  selectedQualityIssueIds.value = qualityAudit.value?.issues.map((issue) => issue.id) || []
  activeQualityIssueId.value = qualityAudit.value?.issues.find((issue) => issue.region)?.id || ''
  qualityAuditError.value = ''
  if (openPreview) fullscreenOpen.value = true
}

function openActivePreview() {
  if (!activeOutput.value || running.value) return
  fullscreenOpen.value = true
}

function handleEditableDocumentSaved(entry) {
  if (!entry?.id) return
  editableHistory.value = [
    entry,
    ...editableHistory.value.filter((item) => item?.id !== entry.id),
  ].slice(0, 12)
  setScopedLocalItem(EDITABLE_HISTORY_KEY, JSON.stringify(editableHistory.value))
}

function handleAnalysisSession(session) {
  editableResumeSession.value = session || null
}

function openEditableHistory(entry) {
  if (!entry?.id || !entry.referenceImage) return
  localError.value = ''
  mediaError.value = ''
  editableResumeSession.value = null
  if (entry.referenceImage) activeOutput.value = entry.referenceImage
  editableDocumentId.value = entry.id
  editableGenerationNonce.value += 1
  editableCanvasOpen.value = true
}

function formatEditableHistoryDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
</script>

<template>
  <main
    ref="studioRoot"
    class="dws"
    :class="{
      'is-blank': !outputs.length && !running,
      'is-tablet-controls': tabletPane === 'controls',
      'is-tablet-canvas': tabletPane === 'canvas',
      'is-light': !appearanceStore.isDark,
    }"
    :style="ambientStyle"
    @keydown.esc="pageTypePickerOpen ? closePageTypePicker() : closeConfigPicker()"
  >
    <div class="dws-shell">
      <nav class="dws-tablet-tabs" aria-label="平板工作区视图">
        <button
          type="button"
          :class="{ 'is-on': tabletPane === 'controls' }"
          :aria-pressed="tabletPane === 'controls'"
          @click="tabletPane = 'controls'"
        >
          <i class="bi bi-sliders2" aria-hidden="true"></i><span>参数</span>
        </button>
        <button
          type="button"
          :class="{ 'is-on': tabletPane === 'canvas' }"
          :aria-pressed="tabletPane === 'canvas'"
          @click="tabletPane = 'canvas'"
        >
          <i class="bi bi-easel2" aria-hidden="true"></i><span>画布</span>
          <em v-if="versionMajors.length">{{ versionMajors.length }}</em>
        </button>
      </nav>

      <aside class="dws-panel" data-studio-enter>
        <div class="dws-panel-scroll">
        <section class="dws-engine">
          <span class="dws-engine-icon" aria-hidden="true">
            <i class="bi bi-cpu"></i>
          </span>
          <div class="dws-engine-control">
            <AspectRatioSelect
              v-model="modelId"
              class="dws-model-menu"
              :options="modelSelectOptions"
              :show-ratio-icons="false"
              use-option-label
              compact-menu
              glass-menu
              menu-placement="bottom"
              aria-label="生成模型"
              placeholder="选择生成模型"
            />
          </div>
        </section>

        <section class="dws-block dws-composer-block">
          <div
            class="dws-composer"
            :class="{
              'is-dragging': composerDragging,
              'has-reference': hasReference,
              'is-iteration': isIteration,
            }"
            @dragenter="onComposerDragEnter"
            @dragover="onComposerDragOver"
            @dragleave="onComposerDragLeave"
            @drop="onComposerDrop"
          >
            <textarea
              id="dws-brief"
              ref="briefField"
              v-model="briefInput"
              rows="5"
              maxlength="1000"
              :aria-label="isIteration ? '本次迭代要求' : '产品与页面描述'"
              :placeholder="
                isIteration
                  ? '只写需要改的地方，例如：主按钮改成蓝色，其余保持不变'
                  : '这是一个什么产品？页面上要有什么内容？'
              "
              @paste="handleBriefPaste"
            ></textarea>

            <div
              v-if="iterationSource || referenceImages.length"
              class="dws-composer-media"
              aria-label="参考内容"
            >
              <div v-if="iterationSource" class="dws-composer-iteration">
                <AuthenticatedImage
                  :src="iterationSource"
                  alt="迭代基准版本"
                  :max-dimension="240"
                />
                <div>
                  <strong>基于 {{ activeVersionLabel || '当前版本' }} 迭代</strong>
                  <small>仅修改明确描述的内容</small>
                </div>
              </div>
              <div v-else class="dws-composer-refs">
                <article v-for="(item, index) in referenceImages" :key="item.id">
                  <img :src="item.preview" :alt="item.name || `参考图 ${index + 1}`" />
                  <button
                    type="button"
                    :aria-label="`移除参考图 ${index + 1}`"
                    @click="removeReferenceImage(item.id)"
                  >
                    <i class="bi bi-x" aria-hidden="true"></i>
                  </button>
                </article>
              </div>
            </div>

            <footer class="dws-composer-bar">
              <button
                type="button"
                class="dws-composer-add"
                :disabled="isIteration || !canAddReferences"
                :title="
                  isIteration
                    ? '迭代模式使用当前版本作参考'
                    : canAddReferences
                      ? `添加参考图（${referenceImages.length}/${MAX_REFERENCE_IMAGES}）`
                      : `参考图已满 ${MAX_REFERENCE_IMAGES} 张`
                "
                :aria-label="
                  canAddReferences
                    ? `添加参考图，还可添加 ${referenceSlotsLeft} 张`
                    : `参考图已满 ${MAX_REFERENCE_IMAGES} 张`
                "
                @click="fileInput?.click()"
              >
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="dws-composer-clear"
                :disabled="!canClearComposer"
                title="清空内容"
                aria-label="清空内容"
                @click="clearComposer()"
              >
                <i class="bi bi-trash3" aria-hidden="true"></i>
              </button>
            </footer>
          </div>
          <input
            ref="fileInput"
            hidden
            type="file"
            accept="image/*"
            multiple
            @change="chooseFile"
          />
        </section>

        <section v-if="isIteration" class="dws-block dws-iteration-guide" aria-live="polite">
          <header>
            <div>
              <small>CONTROLLED ITERATION</small>
              <strong>受控迭代进行中</strong>
            </div>
            <button type="button" class="dws-iteration-exit" @click="clearReference()">
              退出迭代
            </button>
          </header>
          <ol>
            <li>
              <b>1</b>
              <span
                >基准成稿 <em data-no-translate>{{ iterationTargetLabel }}</em
                >，只出这一端</span
              >
            </li>
            <li>
              <b>2</b>
              <span>在上方输入框写「只改什么」，例如：主按钮改成橙色</span>
            </li>
            <li>
              <b>3</b>
              <span>其余布局、配色、组件、文案全部锁定，不会按下方参数重做</span>
            </li>
          </ol>
          <div class="dws-iteration-lock">
            <i class="bi bi-lock-fill" aria-hidden="true"></i>
            <div>
              <strong>本次不生效</strong>
              <small>设备多选、页面类型、视觉风格、品牌主色、明暗模式、设计规范</small>
            </div>
          </div>
          <div v-if="iterationDevice" class="dws-iteration-device">
            <i class="bi" :class="iterationDevice.icon" aria-hidden="true"></i>
            <span>
              迭代输出：{{ iterationDevice.label }} ·
              {{ iterationDevice.ratio }}
            </span>
          </div>
        </section>

        <template v-else>
          <section class="dws-block">
            <span class="dws-label">设备载体 · 可多选同版生成</span>
            <div class="dws-devices" role="group" aria-label="设备载体">
              <button
                v-for="item in DEVICE_OPTIONS"
                :key="item.id"
                type="button"
                :class="{ 'is-on': selectedDeviceIds.includes(item.id) }"
                :aria-pressed="selectedDeviceIds.includes(item.id)"
                :title="`${item.label} ${item.ratio}`"
                :aria-label="`${item.label} ${item.ratio}`"
                @click="toggleDeviceSelection(item.id)"
              >
                <i class="bi" :class="item.icon" aria-hidden="true"></i>
                <small data-no-translate>{{ item.ratio }}</small>
              </button>
            </div>
          </section>

          <section class="dws-block dws-quick-settings">
            <div class="dws-select-field">
              <span class="dws-label">页面类型</span>
              <button
                ref="pageTypePickerTrigger"
                type="button"
                class="dws-page-type-trigger"
                aria-haspopup="dialog"
                :aria-expanded="pageTypePickerOpen"
                aria-label="页面类型"
                @click="pageTypePickerOpen ? closePageTypePicker() : openPageTypePicker()"
              >
                <i class="bi" :class="pageType.icon" aria-hidden="true"></i>
                <span>{{ pageType.label }}</span>
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <div class="dws-select-field">
              <span class="dws-label">视觉风格</span>
              <button
                ref="stylePickerTrigger"
                type="button"
                class="dws-page-type-trigger"
                aria-haspopup="dialog"
                :aria-expanded="activeConfigPanel === 'style'"
                aria-label="视觉风格"
                @click="
                  activeConfigPanel === 'style'
                    ? closeConfigPicker()
                    : openConfigPicker('style', stylePickerTrigger)
                "
              >
                <i class="bi" :class="styleOption.icon" aria-hidden="true"></i>
                <span>{{ styleOption.label }}</span>
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <input
              v-if="pageTypeId === 'custom'"
              v-model="customPageType"
              class="dws-custom-structure"
              type="text"
              maxlength="120"
              placeholder="描述页面结构，例如：顶部搜索栏 + 左侧筛选 + 卡片瀑布流"
              aria-label="自定义页面结构"
            />
          </section>

          <section class="dws-block dws-color-row">
            <div class="dws-color-brand dws-select-field">
              <span class="dws-label">品牌主色</span>
              <button
                ref="brandPickerTrigger"
                type="button"
                class="dws-page-type-trigger dws-brand-trigger"
                aria-haspopup="dialog"
                :aria-expanded="activeConfigPanel === 'brand'"
                aria-label="品牌主色"
                @click="
                  activeConfigPanel === 'brand'
                    ? closeConfigPicker()
                    : openConfigPicker('brand', brandPickerTrigger)
                "
              >
                <i class="dws-brand-dot" :style="{ background: brandColor }" aria-hidden="true"></i>
                <span>{{
                  BRAND_COLOR_OPTIONS.find((item) => item.value === brandColor)?.label
                }}</span>
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <div class="dws-color-scheme">
              <span class="dws-label">明暗模式</span>
              <div class="dws-scheme" role="group" aria-label="明暗模式">
                <button
                  type="button"
                  :class="{ 'is-on': colorScheme === 'light' }"
                  :aria-pressed="colorScheme === 'light'"
                  @click="colorScheme = 'light'"
                >
                  <i class="bi bi-sun" aria-hidden="true"></i>浅色
                </button>
                <button
                  type="button"
                  :class="{ 'is-on': colorScheme === 'dark' }"
                  :aria-pressed="colorScheme === 'dark'"
                  @click="colorScheme = 'dark'"
                >
                  <i class="bi bi-moon-stars" aria-hidden="true"></i>深色
                </button>
              </div>
            </div>
          </section>

          <section class="dws-block dws-specification">
            <button
              ref="specificationTrigger"
              type="button"
              class="dws-specification-toggle"
              aria-haspopup="dialog"
              :aria-expanded="activeConfigPanel === 'specification'"
              @click="
                activeConfigPanel === 'specification'
                  ? closeConfigPicker()
                  : openConfigPicker('specification', specificationTrigger)
              "
            >
              <span>
                <i class="bi bi-sliders" aria-hidden="true"></i>
                <strong>设计规范</strong>
                <small>
                  {{ designMetrics.columns }} 列 · {{ designMetrics.controlHeight }}px ·
                  {{ specificationSummary }}
                </small>
              </span>
              <i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </section>
        </template>

        <details class="dws-prompt-preview" :open="promptPreviewOpen">
          <summary @click.prevent="promptPreviewOpen = !promptPreviewOpen">
            <i class="bi bi-braces" aria-hidden="true"></i
            >{{ isIteration ? '查看本次迭代将发送的提示词' : '查看将要发送的完整提示词' }}
            <i
              class="bi bi-chevron-down"
              :class="{ 'is-open': promptPreviewOpen }"
              aria-hidden="true"
            ></i>
          </summary>
          <pre>{{ assembledPrompt }}</pre>
        </details>

        <p v-if="localError || generationError" class="dws-error" role="alert">
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
          {{ localError || generationError }}
        </p>
        </div>

        <div class="dws-generate-dock">
          <button
            class="dws-generate"
            type="button"
            :disabled="running || tileRefineBusy"
            :aria-label="`${generateActionLabel}，${costLabel}`"
            @click="generate"
          >
            <span class="dws-generate-icon" aria-hidden="true">
              <i class="bi" :class="running ? 'bi-arrow-repeat spin' : 'bi-stars'"></i>
            </span>
            <span class="dws-generate-copy">
              <strong>{{ running ? status || '生成中…' : generateActionLabel }}</strong>
              <small>{{
                running
                  ? isIteration
                    ? '正在按描述做局部修改'
                    : '正在创建界面结构与视觉细节'
                  : isIteration
                    ? '只改描述内容 · 预计扣费'
                    : '预计扣费'
              }}</small>
            </span>
            <span v-if="costLabel" class="dws-generate-price">
              <strong>{{ costDisplay.price }}</strong>
              <small v-if="costDisplay.detail">{{ costDisplay.detail }}</small>
            </span>
          </button>
        </div>
      </aside>

      <section class="dws-stage" data-studio-enter>
        <div class="dws-stage-ambient" aria-hidden="true"></div>

        <div class="dws-stage-meta" data-no-translate aria-hidden="true">
          <span>{{ device.label }}</span>
          <b>{{ device.ratio }}</b>
          <em v-if="activeVersionLabel">{{ activeVersionLabel }}</em>
          <em v-if="isActiveTileRefine" class="is-tile-refine-tag">四宫格精修</em>
        </div>

        <div class="dws-stage-spec" data-no-translate aria-hidden="true">
          <span><i class="bi bi-grid-3x3-gap"></i>{{ designMetrics.columns }} COL</span>
          <span>{{ designMetrics.spacing }} PT</span>
          <span>{{ designMetrics.controlHeight }} PX</span>
          <span>{{ radiusOption.label }}</span>
        </div>

        <div class="dws-stage-actions">
          <button
            ref="qualityTrigger"
            type="button"
            class="is-quality"
            :disabled="!activeOutput || running || qualityAuditing"
            title="检查层级、布局、文字和组件一致性"
            @click="openQualityAudit"
          >
            <i
              class="bi"
              :class="qualityAuditing ? 'bi-arrow-repeat spin' : 'bi-patch-check'"
              aria-hidden="true"
            ></i>
            <span>{{
              qualityAuditing
                ? '检查中'
                : activeStoredQualityAudit
                  ? `${activeStoredQualityAudit.score} 分`
                  : '品质检查'
            }}</span>
          </button>
          <button
            type="button"
            class="is-editor"
            :disabled="running || (!activeOutput && !hasActiveAnalysis)"
            :title="hasActiveAnalysis ? '继续正在进行的元素分析' : '分析按钮、图标、图片和页面模块'"
            @click="openEditableCanvas"
          >
            <i
              class="bi"
              :class="hasActiveAnalysis ? 'bi-arrow-repeat spin' : 'bi-bounding-box'"
              aria-hidden="true"
            ></i
            ><span>{{ hasActiveAnalysis ? '继续分析' : '分析元素' }}</span>
          </button>
          <button
            type="button"
            class="is-region"
            :class="{ 'is-on': regionSelectionMode }"
            :disabled="!activeOutput || running || regionReviewLoading"
            title="在设计稿上框选区域并获取优化说明"
            @click="toggleRegionSelection"
          >
            <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
            <span>{{ regionSelectionMode ? '拖拽框选' : '框选优化' }}</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput || running || !canIterateActive || tileRefineBusy"
            :title="
              canIterateActive
                ? '以当前版本为基础继续修改'
                : '已达最终版本 Vn.n.n，请新建大版本'
            "
            @click="iterateFromActive"
          >
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i><span>迭代此版本</span>
          </button>
          <button
            type="button"
            class="is-tile-refine"
            :disabled="!activeOutput || running || tileRefineBusy"
            :title="
              activeTileRefineEntry
                ? '这张稿已精修过，点击查看结果或重新精修（Beta）'
                : `十字切成 4 块并发生成，再按原坐标硬拼回整图（尺寸与像素网格对齐原图；Beta，约 ${tileRefineCostLabel}）`
            "
            @click="handleTileRefineClick"
          >
            <i
              class="bi"
              :class="tileRefineBusy ? 'bi-arrow-repeat spin' : 'bi-grid-3x3-gap'"
              aria-hidden="true"
            ></i>
            <span>{{ tileRefineBusy ? '精修中' : activeTileRefineEntry ? '查看精修' : '四宫格精修' }}</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput || tileRefineBusy"
            title="下载设计稿"
            @click="downloadActive"
          >
            <i class="bi bi-download" aria-hidden="true"></i><span>下载</span>
          </button>
        </div>

        <div
          class="dws-canvas"
          :class="{
            'is-multi-loading': showMultiDeviceLoading,
            'is-device-rail': showDeviceRail,
            'is-tile-refine': tileRefineBusy,
          }"
        >
          <div v-if="tileRefineBusy" class="dws-tile-refine" aria-live="polite">
            <div class="dws-tile-refine-card">
              <header>
                <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
                <div>
                  <strong>{{
                    tileRefinePhase === 'preparing'
                      ? '正在精密切图…'
                      : tileRefinePhase === 'stitching'
                        ? '正在无损拼接四象限…'
                        : '正在分象限高精度重绘…'
                  }}</strong>
                  <small>标准比例贴边 → 四路精修 → 对齐回裁 → 归属区防重影拼接</small>
                </div>
              </header>
              <ul>
                <li
                  v-for="(item, index) in tileRefineProgress"
                  :key="`tile-progress-${index}`"
                  :class="`is-${item.status || 'pending'}`"
                >
                  <i
                    class="bi"
                    :class="
                      item.status === 'done'
                        ? 'bi-check-circle-fill'
                        : item.status === 'failed' || item.status === 'cancelled'
                          ? 'bi-x-circle'
                          : item.status === 'running'
                            ? 'bi-arrow-repeat spin'
                            : 'bi-circle'
                    "
                    aria-hidden="true"
                  ></i>
                  <span>{{ item.label || `象限 ${index + 1}` }}</span>
                  <em>{{
                    item.status === 'done'
                      ? '完成'
                      : item.status === 'failed'
                        ? '失败'
                        : item.status === 'running'
                          ? '精修中'
                          : item.status === 'cancelled'
                            ? '已取消'
                            : tileRefinePhase === 'stitching'
                              ? '待拼接'
                              : '排队'
                  }}</em>
                </li>
              </ul>
              <button
                type="button"
                class="dws-running-cancel"
                :disabled="cancelling || tileRefinePhase === 'stitching'"
                @click="cancelGeneration()"
              >
                {{ cancelling ? '正在停止…' : '停止精修' }}
              </button>
            </div>
          </div>

          <div v-if="showMultiDeviceLoading" class="dws-multi-board" aria-live="polite">
            <article
              v-for="slot in canvasDeviceSlots"
              :key="`loading-${slot.deviceId}`"
              class="dws-multi-slot"
              :class="[`is-${slot.status || 'pending'}`, { 'is-ready': Boolean(slot.url) }]"
            >
              <div class="dws-multi-frame" :style="slotFrameStyle(slot)">
                <AuthenticatedImage
                  v-if="slot.url"
                  :src="slot.url"
                  :alt="`${slot.label} 预览`"
                  :max-dimension="720"
                />
                <div v-else class="dws-multi-loading">
                  <span class="dws-running-scan" aria-hidden="true"></span>
                  <i
                    class="bi"
                    :class="
                      slot.status === 'failed'
                        ? 'bi-exclamation-circle'
                        : slot.status === 'cancelled'
                          ? 'bi-stop-circle'
                          : 'bi-arrow-repeat spin'
                    "
                    aria-hidden="true"
                  ></i>
                  <strong>
                    {{
                      slot.status === 'failed'
                        ? '生成失败'
                        : slot.status === 'cancelled'
                          ? '已取消'
                          : slot.status === 'running'
                            ? '生成中…'
                            : '排队中…'
                    }}
                  </strong>
                  <small>{{ slot.message || `${slot.label} · ${slot.ratio}` }}</small>
                </div>
              </div>
              <header>
                <i class="bi" :class="slot.icon" aria-hidden="true"></i>
                <span>{{ slot.label }}</span>
                <em data-no-translate>{{ slot.ratio }}</em>
              </header>
            </article>
            <button
              type="button"
              class="dws-running-cancel is-multi"
              :disabled="cancelling"
              :aria-busy="cancelling"
              @click="cancelGeneration()"
            >
              <i
                class="bi"
                :class="cancelling ? 'bi-arrow-repeat spin' : 'bi-stop-fill'"
                aria-hidden="true"
              ></i>
              {{ cancelling ? '正在确认' : '停止后续生成' }}
            </button>
          </div>

          <template v-else>
            <div
              ref="artboardRef"
              class="dws-artboard"
              :class="{
                'is-previewable': activeOutput && !running && !regionSelectionMode,
                'is-region-selecting': regionSelectionMode,
              }"
              :style="artboardStyle"
              :role="activeOutput && !running ? 'button' : undefined"
              :tabindex="activeOutput && !running ? 0 : undefined"
              :aria-label="activeOutput && !running ? '查看当前设计稿大图' : undefined"
              @click="handleArtboardClick()"
              @keydown.enter.prevent="!regionSelectionMode && openActivePreview()"
              @keydown.space.prevent="!regionSelectionMode && openActivePreview()"
            >
              <div v-if="activeOutput" class="dws-artboard-stage">
                <div class="dws-artboard-page">
                  <AuthenticatedImage
                    data-studio-output
                    :src="activeOutput"
                    alt="UI 设计稿预览"
                    loading="eager"
                    :retry-count="2"
                    @error="mediaError = '图片加载失败，请切换版本或重新生成'"
                  />
                  <div
                    v-if="regionSelectionMode || regionSelection"
                    class="dws-region-layer"
                    :class="{ 'is-drawing': regionSelectionMode }"
                    @pointerdown.prevent="beginRegionSelection"
                    @pointermove.prevent="moveRegionSelection"
                    @pointerup.prevent="finishRegionSelection"
                    @pointercancel="cancelRegionSelectionPointer"
                  >
                    <span
                      v-if="regionSelectionMode"
                      class="dws-region-hint"
                      :class="{ 'is-error': regionReviewError }"
                      role="status"
                    >
                      <i
                        class="bi"
                        :class="
                          regionReviewError ? 'bi-exclamation-circle' : 'bi-bounding-box-circles'
                        "
                        aria-hidden="true"
                      ></i
                      >{{ regionReviewError || '拖拽框选需要优化的区域' }}
                    </span>
                    <div
                      v-if="regionSelection"
                      class="dws-region-box"
                      :style="regionSelectionStyle"
                    >
                      <i></i><i></i><i></i><i></i>
                      <button
                        v-if="!regionSelectionMode"
                        type="button"
                        aria-label="清除框选区域"
                        @pointerdown.stop
                        @click.stop="clearRegionSelection"
                      >
                        <i class="bi bi-x" aria-hidden="true"></i>
                      </button>
                    </div>
                  </div>
                  <div
                    v-if="qualityMarkedIssues.length && !regionSelectionMode && !running"
                    class="dws-quality-marks"
                    aria-label="品质问题定位"
                  >
                    <button
                      v-for="(issue, index) in qualityMarkedIssues"
                      :key="issue.id"
                      type="button"
                      :class="[
                        `is-${issue.severity}`,
                        { 'is-active': activeQualityIssue?.id === issue.id },
                      ]"
                      :style="normalizedRegionStyle(issue.region)"
                      :aria-label="`定位问题 ${index + 1}：${issue.title}`"
                      @click.stop="openLocatedQualityIssue(issue.id)"
                    >
                      <b>{{ index + 1 }}</b
                      ><span>{{ issue.title }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="dws-empty">
                <div class="dws-empty-sketch" aria-hidden="true">
                  <header><i></i><span></span><b></b><b></b></header>
                  <div>
                    <aside><i></i><i></i><i></i><i></i></aside>
                    <div class="dws-empty-content">
                      <span class="is-hero"></span>
                      <span class="is-copy"></span>
                      <section><i></i><i></i><i></i></section>
                    </div>
                  </div>
                </div>
                <strong>画布等待第一稿</strong>
                <span
                  >{{ device.label }} · {{ device.ratio }} · {{ pageType.label }}</span
                >
              </div>
              <div v-if="running" class="dws-running" aria-live="polite">
                <span class="dws-running-scan" aria-hidden="true"></span>
                <i class="bi bi-stars" aria-hidden="true"></i>
                <strong>{{
                  status || (cancelling ? '正在停止后续生成' : '正在生成设计稿…')
                }}</strong>
                <span>{{
                  cancelling
                    ? '排队任务会取消并退款，已开始任务继续完成'
                    : '正在组织布局、组件与视觉层级'
                }}</span>
                <button
                  type="button"
                  class="dws-running-cancel"
                  :disabled="cancelling"
                  :aria-busy="cancelling"
                  @click="cancelGeneration()"
                >
                  <i
                    class="bi"
                    :class="cancelling ? 'bi-arrow-repeat spin' : 'bi-stop-fill'"
                    aria-hidden="true"
                  ></i>
                  {{ cancelling ? '正在确认' : '停止后续生成' }}
                </button>
              </div>
            </div>

            <aside
              v-if="showDeviceRail"
              class="dws-device-rail"
              aria-label="多端预览切换"
            >
              <button
                v-for="slot in canvasDeviceSlots"
                :key="`rail-${slot.deviceId}`"
                type="button"
                :class="{ 'is-on': activeOutput === slot.url || viewDeviceId === slot.deviceId }"
                :aria-pressed="activeOutput === slot.url"
                :title="`${slot.label} ${slot.ratio}`"
                @click="selectCarrier(slot)"
              >
                <span class="dws-device-rail-thumb" :style="slotFrameStyle(slot)">
                  <AuthenticatedImage
                    v-if="slot.url"
                    :src="slot.url"
                    alt=""
                    :max-dimension="240"
                  />
                  <i v-else class="bi" :class="slot.icon" aria-hidden="true"></i>
                </span>
                <span class="dws-device-rail-meta">
                  <strong>{{ slot.label }}</strong>
                  <small data-no-translate>{{ slot.ratio }}</small>
                </span>
              </button>
            </aside>
          </template>
        </div>

        <p v-if="mediaError" class="dws-error is-stage" role="alert">{{ mediaError }}</p>

        <footer
          v-if="versionMajors.length || historyLoading"
          class="dws-versions-wrap"
          aria-label="设计版本"
        >
          <button
            type="button"
            class="dws-history-page is-prev"
            :disabled="!canPrevHistoryPage"
            aria-label="上一页历史"
            @click="goPrevHistoryPage()"
          >
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <div ref="historyViewport" class="dws-version-history">
            <div class="dws-version-families" aria-label="大版本列表">
              <div
                v-for="major in pagedVersionMajors"
                :key="major.id"
                class="dws-version-family"
                :class="{ 'is-on': isMajorActive(major.id) }"
              >
                <button
                  type="button"
                  class="dws-family-main"
                  :title="`在画布显示 ${major.label}`"
                  :aria-label="`在画布显示 ${major.label}${
                    major.devices.length
                      ? `，${major.devices.map((item) => item.label).join('、')}`
                      : ''
                  }`"
                  :aria-pressed="isMajorActive(major.id)"
                  @click="selectMajorOnCanvas(major.id)"
                >
                  <span class="dws-family-thumb">
                    <AuthenticatedImage
                      v-if="major.cover"
                      :src="major.cover"
                      alt=""
                      :max-dimension="320"
                    />
                  </span>
                  <span class="dws-family-meta">
                    <span class="dws-family-head">
                      <strong data-no-translate>{{ major.label }}</strong>
                      <span class="dws-family-tags">
                        <em v-if="major.versionCount > 1">{{ major.versionCount }} 版</em>
                        <em v-if="major.deviceCount > 1">{{ major.deviceCount }} 端</em>
                        <em v-if="major.analyzedInTree" class="is-analyzed">已分析</em>
                      </span>
                    </span>
                    <span
                      v-if="major.devices.length"
                      class="dws-family-devices"
                      aria-hidden="true"
                    >
                      <i
                        v-for="device in major.devices"
                        :key="`${major.id}-${device.id}`"
                        class="bi dws-family-device"
                        :class="device.icon"
                        :title="`${device.label} ${device.ratio}`"
                      ></i>
                    </span>
                    <small v-else class="dws-family-empty-device">未标记设备</small>
                  </span>
                </button>
                <button
                  type="button"
                  class="dws-family-detail"
                  :title="`打开 ${major.label} 侧边栏`"
                  :aria-label="`打开 ${major.label} 侧边栏`"
                  @click="openVersionDrawer(major.id)"
                >
                  <i class="bi bi-layout-sidebar-inset-reverse" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <span
              v-if="historyLoading && !versionMajors.length"
              class="dws-versions-skeleton"
              aria-hidden="true"
            >
              <i></i><i></i><i></i>
            </span>
          </div>
          <div class="dws-history-page-meta" aria-live="polite">
            <strong>{{ historyPage + 1 }} / {{ historyPageCount }}{{ historyHasMore ? '+' : '' }}</strong>
            <i
              v-if="historyLoading"
              class="bi bi-arrow-repeat spin"
              aria-hidden="true"
            ></i>
          </div>
          <button
            type="button"
            class="dws-history-page is-next"
            :disabled="!canNextHistoryPage || (historyLoading && historyPage >= historyPageCount - 1)"
            aria-label="下一页历史"
            @click="goNextHistoryPage()"
          >
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </footer>
      </section>
    </div>

    <DesignVersionDrawer
      :open="versionDrawerOpen"
      :forest="versionForest"
      :focus-major-id="versionDrawerFocusId"
      :active-output="activeOutput"
      :active-node-id="activeVersionNode?.id || ''"
      :is-light="!appearanceStore.isDark"
      :deleting="versionDeleting"
      :history-has-more="historyHasMore"
      :history-loading="historyLoading"
      @close="versionDrawerOpen = false"
      @select-node="selectVersionNode"
      @iterate-node="iterateFromNode"
      @analyze-node="analyzeVersionNode"
      @delete-nodes="deleteVersionNodes"
      @load-more="requestMoreHistory"
    />

    <Teleport to="body">
      <div
        v-if="pageTypePickerOpen"
        class="dws-page-type-scrim"
        @mousedown.self="closePageTypePicker()"
      >
        <section
          class="dws-page-type-picker"
          :class="{ 'is-light': !appearanceStore.isDark }"
          :style="pageTypePickerStyle"
          role="dialog"
          aria-modal="false"
          aria-labelledby="dws-page-type-title"
        >
          <header class="dws-page-type-header">
            <span>
              <small>PAGE ARCHETYPE</small>
              <strong id="dws-page-type-title">选择页面类型</strong>
            </span>
            <em>20 种结构</em>
            <button type="button" aria-label="关闭页面类型选择" @click="closePageTypePicker()">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>

          <div class="dws-page-type-grid">
            <button
              v-for="item in PAGE_TYPE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': pageTypeId === item.id }"
              :aria-pressed="pageTypeId === item.id"
              @click="selectPageType(item.id)"
            >
              <span class="dws-page-type-icon">
                <i class="bi" :class="item.icon" aria-hidden="true"></i>
              </span>
              <span class="dws-page-type-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.description }}</small>
                <em>{{ item.prompt || '根据业务自由组合导航、内容和操作区域' }}</em>
              </span>
              <i
                class="bi"
                :class="pageTypeId === item.id ? 'bi-check-circle-fill' : 'bi-arrow-up-right'"
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="activeConfigPanel" class="dws-config-scrim" @mousedown.self="closeConfigPicker()">
        <section
          class="dws-config-picker"
          :class="[`is-${activeConfigPanel}`, { 'is-light': !appearanceStore.isDark }]"
          :style="configPickerStyle"
          role="dialog"
          aria-modal="false"
          :aria-labelledby="`dws-${activeConfigPanel}-title`"
        >
          <header class="dws-config-header">
            <span>
              <small>{{
                activeConfigPanel === 'style'
                  ? 'VISUAL LANGUAGE'
                  : activeConfigPanel === 'brand'
                    ? 'COLOR SYSTEM'
                    : 'DESIGN SYSTEM'
              }}</small>
              <strong :id="`dws-${activeConfigPanel}-title`">
                {{
                  activeConfigPanel === 'style'
                    ? '选择视觉风格'
                    : activeConfigPanel === 'brand'
                      ? '选择品牌主色'
                      : '配置设计规范'
                }}
              </strong>
            </span>
            <em v-if="activeConfigPanel === 'style'">12 种风格</em>
            <em v-else-if="activeConfigPanel === 'brand'">12 套色板</em>
            <em v-else>{{ designMetrics.columns }} 列 · 8pt</em>
            <button
              type="button"
              :aria-label="`关闭${activeConfigPanel === 'style' ? '视觉风格' : activeConfigPanel === 'brand' ? '品牌主色' : '设计规范'}选择`"
              @click="closeConfigPicker()"
            >
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>

          <div v-if="activeConfigPanel === 'style'" class="dws-style-grid">
            <button
              v-for="item in STYLE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': styleId === item.id }"
              :aria-pressed="styleId === item.id"
              @click="selectStyle(item.id)"
            >
              <span class="dws-style-preview">
                <i v-for="color in item.preview" :key="color" :style="{ background: color }"></i>
              </span>
              <span class="dws-style-copy">
                <i class="bi" :class="item.icon" aria-hidden="true"></i>
                <strong>{{ item.label }}</strong>
                <small>{{ item.description }}</small>
              </span>
              <i
                class="bi"
                :class="styleId === item.id ? 'bi-check-circle-fill' : 'bi-arrow-up-right'"
                aria-hidden="true"
              ></i>
            </button>
          </div>

          <div v-else-if="activeConfigPanel === 'brand'" class="dws-brand-grid">
            <button
              v-for="item in BRAND_COLOR_OPTIONS"
              :key="item.value"
              type="button"
              :class="{ 'is-on': brandColor === item.value }"
              :style="{ '--picker-brand': item.value }"
              :aria-pressed="brandColor === item.value"
              @click="selectBrandColor(item.value)"
            >
              <span class="dws-brand-swatch" :style="{ background: item.value }"></span>
              <span>
                <strong>{{ item.label }}</strong>
                <small>{{ item.description }}</small>
                <em data-no-translate>{{ item.value }}</em>
              </span>
              <span class="dws-brand-tones" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <i
                class="bi"
                :class="brandColor === item.value ? 'bi-check-circle-fill' : 'bi-arrow-up-right'"
                aria-hidden="true"
              ></i>
            </button>
          </div>

          <div v-else class="dws-spec-editor">
            <div class="dws-spec-overview">
              <span>
                <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
                <b>{{ designMetrics.columns }} 列</b>
                <small>{{ designMetrics.margin }}px 边距</small>
              </span>
              <span>
                <i class="bi bi-distribute-vertical" aria-hidden="true"></i>
                <b>{{ designMetrics.spacing }}pt</b>
                <small>{{ designMetrics.gutter }}px 列距</small>
              </span>
              <span>
                <i class="bi bi-input-cursor-text" aria-hidden="true"></i>
                <b>{{ designMetrics.controlHeight }}px</b>
                <small>控件高度</small>
              </span>
              <span>
                <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
                <b>{{ designMetrics.radius }}</b>
                <small>组件圆角</small>
              </span>
            </div>

            <p class="dws-spec-hint">
              当前按「{{ device.label }} {{ device.ratio }}」计算栅格；多端生成时各端会自动适配列数与边距。
            </p>

            <div class="dws-spec-grid">
              <div class="dws-select-field">
                <span class="dws-label">目标用户</span>
                <AspectRatioSelect
                  v-model="audienceId"
                  class="dws-control-select"
                  :options="AUDIENCE_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="目标用户"
                />
              </div>
              <div class="dws-select-field">
                <span class="dws-label">核心目标</span>
                <AspectRatioSelect
                  v-model="goalId"
                  class="dws-control-select"
                  :options="GOAL_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="核心目标"
                />
              </div>
              <div class="dws-select-field">
                <span class="dws-label">导航结构</span>
                <AspectRatioSelect
                  v-model="navigationId"
                  class="dws-control-select"
                  :options="NAVIGATION_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="导航结构"
                />
              </div>
              <div class="dws-select-field">
                <span class="dws-label">信息密度</span>
                <AspectRatioSelect
                  v-model="densityId"
                  class="dws-control-select"
                  :options="DENSITY_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="信息密度"
                />
              </div>
              <div class="dws-select-field">
                <span class="dws-label">字体气质</span>
                <AspectRatioSelect
                  v-model="typographyId"
                  class="dws-control-select"
                  :options="TYPOGRAPHY_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="字体气质"
                />
              </div>
              <div class="dws-select-field">
                <span class="dws-label">组件圆角</span>
                <AspectRatioSelect
                  v-model="radiusId"
                  class="dws-control-select"
                  :options="RADIUS_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="组件圆角"
                />
              </div>
              <div class="dws-select-field is-wide">
                <span class="dws-label">响应式策略</span>
                <AspectRatioSelect
                  v-model="responsiveId"
                  class="dws-control-select"
                  :options="RESPONSIVE_SELECT_OPTIONS"
                  :show-ratio-icons="false"
                  use-option-label
                  compact-text
                  compact-menu
                  glass-menu
                  menu-placement="auto"
                  :menu-z-index="2120"
                  aria-label="响应式策略"
                />
              </div>
            </div>

            <div class="dws-state-field">
              <span class="dws-label">必须覆盖的组件状态</span>
              <div class="dws-state-options" role="group" aria-label="必须覆盖的组件状态">
                <button
                  v-for="item in COMPONENT_STATE_OPTIONS"
                  :key="item.id"
                  type="button"
                  :class="{ 'is-on': componentStates.includes(item.id) }"
                  :aria-pressed="componentStates.includes(item.id)"
                  :title="item.prompt"
                  @click="toggleComponentState(item.id)"
                >
                  <i
                    class="bi"
                    :class="componentStates.includes(item.id) ? 'bi-check2' : 'bi-plus'"
                    aria-hidden="true"
                  ></i>
                  <span>{{ item.label }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="qualityAuditOpen" class="dws-quality-layer" @mousedown.self="closeQualityAudit()">
        <section
          ref="qualityDialogRef"
          class="dws-quality-dialog"
          :class="{ 'is-light': !appearanceStore.isDark }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dws-quality-title"
          @keydown="trapQualityFocus"
        >
          <header class="dws-quality-header">
            <span>
              <small>DESIGN QUALITY · V3</small>
              <strong id="dws-quality-title">设计品质检查</strong>
            </span>
            <em>{{ qualityAudit?.version || '视觉模型评审' }}</em>
            <button
              v-if="qualityAudit && !qualityAuditing"
              type="button"
              class="is-refresh"
              title="重新检查当前版本"
              aria-label="重新检查当前版本"
              @click="runQualityAudit"
            >
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </button>
            <button
              ref="qualityCloseButton"
              type="button"
              aria-label="关闭品质检查"
              @click="closeQualityAudit()"
            >
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>

          <nav class="dws-quality-modes" aria-label="品质检查视角">
            <button
              v-for="mode in DESIGN_QUALITY_REVIEW_MODES"
              :key="mode.id"
              type="button"
              :disabled="qualityAuditing"
              :class="{ 'is-on': qualityReviewMode === mode.id }"
              :aria-pressed="qualityReviewMode === mode.id"
              @click="selectQualityReviewMode(mode.id)"
            >
              <i class="bi" :class="mode.icon" aria-hidden="true"></i>
              <span>{{ mode.label }}</span>
              <em
                v-if="qualityAuditsByOutput[qualityAuditKey(activeOutput, mode.id)]"
                data-no-translate
              >
                {{ qualityAuditsByOutput[qualityAuditKey(activeOutput, mode.id)].score }}
              </em>
            </button>
          </nav>

          <div v-if="qualityAuditing" class="dws-quality-loading" aria-live="polite">
            <span class="dws-quality-orbit"><i></i><i></i><i></i></span>
            <strong>正在检查设计品质</strong>
            <p>分析信息层级、栅格、文字、配色、组件一致性与业务完整度</p>
            <div aria-hidden="true"><i></i><i></i><i></i></div>
          </div>

          <div v-else-if="qualityAuditError" class="dws-quality-error" role="alert">
            <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
            <strong>检查没有完成</strong>
            <p>{{ qualityAuditError }}</p>
            <button type="button" @click="runQualityAudit">
              <i class="bi bi-arrow-repeat" aria-hidden="true"></i>重新检查
            </button>
          </div>

          <div
            v-else-if="
              !qualityAudit && !(regionSelection || regionReviewLoading || regionReviewError)
            "
            class="dws-quality-empty"
          >
            <i class="bi bi-clipboard2-pulse" aria-hidden="true"></i>
            <strong>这个视角还没有检查记录</strong>
            <p>
              {{
                DESIGN_QUALITY_REVIEW_MODES.find((item) => item.id === qualityReviewMode)?.prompt
              }}
            </p>
            <button type="button" @click="runQualityAudit">
              <i class="bi bi-stars" aria-hidden="true"></i>开始检查
            </button>
          </div>

          <div
            v-else-if="qualityAudit || regionSelection || regionReviewLoading || regionReviewError"
            class="dws-quality-result"
          >
            <section v-if="!qualityAudit" class="dws-quality-inline-empty">
              <span>
                <i class="bi bi-clipboard2-pulse" aria-hidden="true"></i>
                <b>当前视角尚未检查</b>
                <small>{{ currentQualityReviewMode.label }}</small>
              </span>
              <button type="button" @click="runQualityAudit">开始检查</button>
            </section>
            <section v-if="qualityAudit" class="dws-quality-summary">
              <div
                class="dws-quality-score"
                :style="{ '--quality-score': `${qualityAudit.score * 3.6}deg` }"
                :aria-label="`品质评分 ${qualityAudit.score} 分`"
              >
                <span
                  ><b>{{ qualityAudit.score }}</b
                  ><small>/ 100</small></span
                >
              </div>
              <div>
                <small>总体结论</small>
                <strong>{{ qualityAudit.verdict }}</strong>
                <p>
                  基于当前页面目标和所选视觉规范评估
                  <b
                    v-if="qualityScoreDelta !== null"
                    :class="qualityScoreDelta >= 0 ? 'is-up' : 'is-down'"
                  >
                    {{ qualityScoreDelta >= 0 ? '+' : '' }}{{ qualityScoreDelta }} 分
                  </b>
                </p>
              </div>
            </section>

            <section
              v-if="qualityParentAudit && qualityScoreDelta !== null"
              class="dws-quality-comparison"
            >
              <span :class="qualityScoreDelta >= 0 ? 'is-up' : 'is-down'">
                <i
                  class="bi"
                  :class="qualityScoreDelta >= 0 ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow'"
                  aria-hidden="true"
                ></i>
                <b>{{ qualityScoreDelta >= 0 ? '+' : '' }}{{ qualityScoreDelta }}</b>
              </span>
              <div>
                <strong>相对父版本</strong>
                <p>{{ qualityAudit.comparison?.summary || '已按同一评分口径完成版本对比。' }}</p>
              </div>
              <ul v-if="qualityAudit.comparison">
                <li>已解决 {{ qualityAudit.comparison.resolvedIssueIds.length }}</li>
                <li>仍存在 {{ qualityAudit.comparison.persistentIssueIds.length }}</li>
                <li>新增 {{ qualityAudit.comparison.newIssueCount }}</li>
              </ul>
            </section>

            <section
              v-if="regionSelection || regionReviewLoading || regionReviewError"
              class="dws-region-review"
            >
              <header>
                <span>
                  <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
                  <strong>框选区域优化</strong>
                </span>
                <button type="button" aria-label="清除框选区域" @click="clearRegionSelection">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </header>
              <div class="dws-region-review-body">
                <figure>
                  <img v-if="regionPreview" :src="regionPreview" alt="框选区域预览" />
                  <span v-else><i class="bi bi-image" aria-hidden="true"></i></span>
                </figure>
                <div v-if="regionReviewLoading" class="dws-region-review-loading">
                  <i class="bi bi-arrow-repeat spin" aria-hidden="true"></i>
                  <strong>正在理解框选区域</strong>
                  <p>结合完整页面判断区域职责、视觉问题和修改边界</p>
                </div>
                <div v-else-if="regionReviewError" class="dws-region-review-error">
                  <strong>{{ regionReviewError }}</strong>
                  <button type="button" @click="runRegionQualityAudit()">重新分析</button>
                </div>
                <div v-else-if="regionReview" class="dws-region-review-copy">
                  <small>{{ regionReview.location }}</small>
                  <strong>{{ regionReview.title }}</strong>
                  <p>{{ regionReview.summary }}</p>
                  <ul>
                    <li v-for="item in regionReview.suggestions" :key="item">{{ item }}</li>
                  </ul>
                  <button
                    type="button"
                    :disabled="!regionReview.iterationPrompt"
                    @click="applyRegionReview"
                  >
                    仅优化此区域<i class="bi bi-arrow-right" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </section>

            <section v-if="qualityAudit?.dimensions?.length" class="dws-quality-dimensions">
              <article v-for="dimension in qualityAudit.dimensions" :key="dimension.id">
                <span
                  ><b>{{ dimension.label }}</b
                  ><em>{{ dimension.score }}</em
                  ><u
                    v-if="qualityDimensionDelta(dimension) !== null"
                    :class="qualityDimensionDelta(dimension) >= 0 ? 'is-up' : 'is-down'"
                    >{{ qualityDimensionDelta(dimension) >= 0 ? '+' : ''
                    }}{{ qualityDimensionDelta(dimension) }}</u
                  ></span
                >
                <i><u :style="{ width: `${dimension.score}%` }"></u></i>
                <small>{{ dimension.note }}</small>
              </article>
            </section>

            <section v-if="qualityAudit?.strengths.length" class="dws-quality-strengths">
              <h3><i class="bi bi-check2-circle" aria-hidden="true"></i>做得好的地方</h3>
              <ul>
                <li v-for="item in qualityAudit.strengths" :key="item">{{ item }}</li>
              </ul>
            </section>

            <section
              v-if="qualityAudit?.grounded && qualityAudit?.developerAssets?.length"
              class="dws-quality-assets"
            >
              <header>
                <span>
                  <i class="bi bi-box-seam" aria-hidden="true"></i>
                  <strong>开发素材候选</strong>
                  <small>{{ qualityAudit.developerAssets.length }} 个</small>
                </span>
                <button type="button" @click="openQualityAssetExtraction">
                  提取素材<i class="bi bi-arrow-up-right" aria-hidden="true"></i>
                </button>
              </header>
              <div>
                <article v-for="asset in qualityAudit.developerAssets" :key="asset.id">
                  <span
                    class="dws-quality-asset-thumb"
                    :style="qualityAssetPreviewStyle(asset)"
                  ></span>
                  <div>
                    <strong>{{ asset.name }}</strong>
                    <small>{{ asset.type }} · {{ asset.suggestedFormat.toUpperCase() }}</small>
                    <p>{{ asset.reason }}</p>
                  </div>
                </article>
              </div>
            </section>

            <section v-if="qualityAudit" class="dws-quality-issues">
              <header>
                <h3><i class="bi bi-list-check" aria-hidden="true"></i>需要调整</h3>
                <div>
                  <button type="button" @click="selectQualityIssues('major')">仅主要</button>
                  <button type="button" @click="selectQualityIssues('all')">全部</button>
                  <span>{{ selectedQualityIssueCount }}/{{ qualityAudit.issues.length }} 项</span>
                </div>
              </header>
              <div v-if="qualityAudit.issues.length">
                <article
                  v-for="(issue, index) in qualityAudit.issues"
                  :key="`${issue.title}-${index}`"
                  :class="{
                    'is-selected': selectedQualityIssueIds.includes(issue.id),
                    'is-located': activeQualityIssue?.id === issue.id,
                  }"
                  @click="activateQualityIssue(issue.id)"
                >
                  <button
                    type="button"
                    class="dws-quality-check"
                    :aria-label="`${selectedQualityIssueIds.includes(issue.id) ? '取消' : '选择'}修复：${issue.title}`"
                    :aria-pressed="selectedQualityIssueIds.includes(issue.id)"
                    @click.stop="toggleQualityIssue(issue.id)"
                  >
                    <i
                      class="bi"
                      :class="selectedQualityIssueIds.includes(issue.id) ? 'bi-check2' : 'bi-plus'"
                      aria-hidden="true"
                    ></i>
                  </button>
                  <span :class="`is-${issue.severity}`">
                    {{
                      issue.severity === 'critical'
                        ? '严重'
                        : issue.severity === 'major'
                          ? '主要'
                          : '细节'
                    }}
                  </span>
                  <div>
                    <strong
                      >{{ issue.title }}<em>{{ QUALITY_DIMENSION_LABELS[issue.dimension] }}</em
                      ><i v-if="issue.region" class="bi bi-crosshair" aria-hidden="true"></i
                    ></strong>
                    <p>{{ issue.evidence }}</p>
                    <small
                      ><i class="bi bi-arrow-return-right" aria-hidden="true"></i
                      >{{ issue.fix }}</small
                    >
                  </div>
                </article>
              </div>
              <p v-else class="dws-quality-clear">没有发现需要优先处理的问题。</p>
            </section>
          </div>

          <footer v-if="qualityAudit && !qualityAuditing" class="dws-quality-footer">
            <span
              ><i class="bi bi-stars" aria-hidden="true"></i>已选择
              {{ selectedQualityIssueCount }} 项，未选择区域保持不变</span
            >
            <button
              type="button"
              :disabled="!selectedQualityIssueCount"
              @click="applyQualityAuditFixes"
            >
              定向迭代<i class="bi bi-arrow-right" aria-hidden="true"></i>
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="tileRefineDialogOpen && tileRefineDialogEntry"
        class="dws-tile-result"
        role="dialog"
        aria-modal="true"
        aria-label="四宫格精修结果"
        @click.self="tileRefineDialogOpen = false"
      >
        <section class="dws-tile-result-card">
          <header>
            <div>
              <strong>四宫格精修结果 <em>Beta</em></strong>
              <small>
                {{ tileRefineDialogEntry.width }}×{{ tileRefineDialogEntry.height }} ·
                亚像素对齐 · 无缝合并为 1 张整图
              </small>
            </div>
            <button type="button" aria-label="关闭" @click="tileRefineDialogOpen = false">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>
          <div class="dws-tile-result-stage">
            <AuthenticatedImage
              :src="tileRefineDialogEntry.url"
              alt="四宫格精修合并结果"
              loading="eager"
              :retry-count="2"
            />
          </div>
          <footer>
            <button
              type="button"
              class="is-secondary"
              :disabled="tileRefineBusy || running"
              @click="rerunTileRefineFromDialog"
            >
              <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
              重新精修（约 {{ tileRefineCostLabel || '4 张图费用' }}）
            </button>
            <button type="button" class="is-primary" @click="applyTileRefineToCanvas">
              <i class="bi bi-check2" aria-hidden="true"></i>
              应用到画布
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <WallevenImagePreview
      :open="fullscreenOpen"
      :images="outputs"
      :current-src="activeOutput"
      title="UI 设计稿"
      filename="ui-design.png"
      :metadata="{
        id: activeVersionLabel || 'ui-design',
        category: pageType.label,
        ratio: device.ratio,
        style: styleOption.label,
      }"
      @close="fullscreenOpen = false"
      @select="selectOutput"
    />

    <AiDesignCanvas
      :open="editableCanvasOpen"
      :prompt="editableCanvasPrompt"
      :reference-image="editableResumeSession?.referenceImage || activeOutput"
      :document-id="editableDocumentId"
      :resume-session="editableResumeSession"
      :seed-findings="editableSeedFindings"
      :viewport="editableViewport"
      :generation-nonce="editableGenerationNonce"
      v-model:analysis-model="analysisModelId"
      :analysis-models="analysisModelOptions"
      :analysis-models-loading="analysisModelsLoading"
      :analysis-model-error="analysisModelError"
      @close="editableCanvasOpen = false"
      @document-saved="handleEditableDocumentSaved"
      @analysis-session="handleAnalysisSession"
    />

    <InsufficientCreditsDialog
      :show="creditsPrompt.dialogOpen.value"
      :required="creditsPrompt.requiredCredits.value"
      :available="creditsPrompt.availableCredits.value"
      :light="!appearanceStore.isDark"
      @close="creditsPrompt.closePrompt"
    />
  </main>
</template>

<style scoped>
/* ————— 设计令牌：无边框、填充式分层 ————— */
.dws {
  --dws-bg: #0a0a10;
  --dws-brand: #6d5cff;
  --dws-ink: rgba(255, 255, 255, 0.95);
  --dws-muted: rgba(255, 255, 255, 0.6);
  --dws-faint: rgba(255, 255, 255, 0.34);
  --dws-fill: rgba(255, 255, 255, 0.05);
  --dws-fill-hover: rgba(255, 255, 255, 0.09);
  --dws-fill-deep: rgba(255, 255, 255, 0.03);
  --dws-accent: #6d5cff;
  --dws-accent-2: #8a72ff;
  --dws-accent-soft: rgba(109, 92, 255, 0.2);
  --dws-radius: 12px;
  min-height: calc(100vh - var(--app-header-offset, 64px));
  color: var(--dws-ink);
  background:
    radial-gradient(
      1100px 560px at 72% -12%,
      color-mix(in srgb, var(--dws-brand) 13%, transparent),
      transparent 64%
    ),
    radial-gradient(760px 460px at 6% 108%, rgba(109, 92, 255, 0.07), transparent 60%),
    var(--dws-bg);
  transition: background 0.4s ease;
}

.dws-shell {
  position: relative;
  display: grid;
  grid-template-columns: 332px minmax(0, 1fr);
  width: 100%;
  height: calc(100vh - var(--app-header-offset, 64px));
  min-height: 620px;
  box-sizing: border-box;
  overflow: hidden;
  background-color: #08090f;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.014) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.014) 1px, transparent 1px);
  background-size: 24px 24px;
  background-position: center;
}

.dws-shell::before {
  content: '';
  pointer-events: none;
  position: absolute;
  z-index: 0;
  top: 40%;
  right: -26%;
  bottom: -54%;
  left: -26%;
  background-image:
    linear-gradient(color-mix(in srgb, var(--dws-brand) 24%, transparent) 1px, transparent 1px),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--dws-brand) 24%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size:
    120px 120px,
    120px 120px,
    24px 24px,
    24px 24px;
  background-position: calc(50% + 166px) top;
  transform: perspective(640px) rotateX(58deg) scale(1.14);
  transform-origin: calc(50% + 166px) 0;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 72%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 72%, transparent);
}

.dws-tablet-tabs {
  display: none;
}

/* ————— 左栏：直排参数，统一节奏 ————— */
.dws-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-self: stretch;
  box-sizing: border-box;
  overflow: hidden;
  height: calc(100% - 24px);
  max-height: calc(100% - 24px);
  margin: 12px 0 12px 12px;
  padding: 20px 18px 0;
  border: 0;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 24%), rgba(15, 16, 24, 0.58);
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.34);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  backdrop-filter: blur(20px) saturate(120%);
}

.dws-panel-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 2px 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}

.dws-block {
  margin-top: 17px;
}

.dws-panel > .dws-block:first-child {
  margin-top: 0;
}

.dws-composer-block {
  margin-top: 0;
}

.dws-iteration-guide {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--dws-accent) 12%, var(--dws-fill));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dws-accent) 28%, transparent);
}

.dws-iteration-guide > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.dws-iteration-guide > header small {
  display: block;
  margin-bottom: 4px;
  color: #bdb3ff;
  font: 700 0.56rem/1 monospace;
  letter-spacing: 0.06em;
}

.dws-iteration-guide > header strong {
  font-size: 0.9rem;
  font-weight: 750;
}

.dws-iteration-exit {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--dws-ink);
  font: 650 0.68rem/1 inherit;
  cursor: pointer;
}

.dws-iteration-guide ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dws-iteration-guide li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  color: var(--dws-muted);
  font-size: 0.72rem;
  line-height: 1.45;
}

.dws-iteration-guide li b {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dws-accent) 28%, transparent);
  color: #efeaff;
  font-size: 0.62rem;
  font-weight: 750;
}

.dws-iteration-guide li em {
  color: var(--dws-ink);
  font-style: normal;
  font-weight: 700;
}

.dws-iteration-lock,
.dws-iteration-device {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.16);
}

.dws-iteration-lock i,
.dws-iteration-device i {
  margin-top: 1px;
  color: #c7beff;
  font-size: 0.9rem;
}

.dws-iteration-lock {
  align-items: center;
}

.dws-iteration-lock strong,
.dws-iteration-device span {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
}

.dws-iteration-lock small {
  display: block;
  margin-top: 3px;
  color: var(--dws-faint);
  font-size: 0.62rem;
  line-height: 1.4;
}

.dws-iteration-device {
  align-items: center;
  color: var(--dws-muted);
  font-size: 0.7rem;
}

.dws-label {
  display: block;
  margin-bottom: 8px;
  color: var(--dws-faint);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0;
}

.dws-engine {
  position: relative;
  min-height: 58px;
  margin-bottom: 16px;
}

.dws-engine-icon {
  position: absolute;
  z-index: 1;
  top: 9px;
  left: 9px;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 10px;
  background: var(--dws-accent-soft);
  color: #bfb5ff;
  font-size: 0.96rem;
  pointer-events: none;
}

.dws-engine-control {
  min-width: 0;
}

.dws-engine-control :deep(.ratio-select__trigger) {
  min-height: 58px;
  padding: 0 12px 0 59px;
  border: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.045);
  box-shadow: none;
  font-size: 0.88rem;
  font-weight: 700;
}

.dws-engine-control :deep(.ratio-select__trigger:hover),
.dws-engine-control :deep(.ratio-select__trigger:focus-visible),
.dws-engine-control :deep(.ratio-select.is-open .ratio-select__trigger) {
  border: 0;
  background: rgba(255, 255, 255, 0.065);
  box-shadow: none;
}

.dws-engine-control :deep(.ratio-select__chevron) {
  color: #9e91ff;
}

/* 输入类：填充面，无外描边 */
.dws-custom-structure {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
  color: var(--dws-ink);
  font: inherit;
  outline: none;
  box-shadow: none;
  transition: background 0.15s ease;
}

.dws-custom-structure:hover,
.dws-custom-structure:focus {
  background: var(--dws-fill-hover);
  box-shadow: none;
  outline: none;
}

.dws-custom-structure::placeholder {
  color: var(--dws-faint);
}

/* 需求描述 + 参考图一体输入区：上输入、中参考、下 + / 清空 */
.dws-composer {
  display: flex;
  flex-direction: column;
  min-height: 196px;
  border: 0;
  border-radius: 18px;
  background: var(--dws-fill);
  overflow: hidden;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.dws-composer:focus-within {
  background: color-mix(in srgb, var(--dws-accent) 5%, var(--dws-fill-hover));
}

.dws-composer.is-dragging {
  background: color-mix(in srgb, var(--dws-accent) 9%, var(--dws-fill-hover));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--dws-accent) 42%, transparent);
}

.dws-composer textarea {
  flex: 1 1 auto;
  width: 100%;
  min-height: 120px;
  box-sizing: border-box;
  margin: 0;
  padding: 16px 16px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dws-ink);
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.55;
  outline: none;
  box-shadow: none;
  resize: none;
}

.dws-composer textarea::placeholder {
  color: var(--dws-faint);
}

.dws-composer-media {
  padding: 0 12px 8px;
}

.dws-composer-iteration {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--dws-accent) 12%, transparent);
}

.dws-composer-iteration :deep(.authenticated-image) {
  width: 48px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  background: #111119;
}

.dws-composer-iteration strong,
.dws-composer-iteration small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-composer-iteration strong {
  font-size: 0.7rem;
  font-weight: 650;
}

.dws-composer-iteration small {
  margin-top: 3px;
  color: var(--dws-faint);
  font-size: 0.6rem;
}

.dws-composer-refs {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.dws-composer-refs > article {
  position: relative;
  flex: 0 0 52px;
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #111119;
}

.dws-composer-refs > article img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-composer-refs > article > button {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(12, 12, 18, 0.72);
  color: #fff;
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
}

.dws-composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 14px 14px;
}

.dws-composer-add,
.dws-composer-clear {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.dws-composer-add {
  width: 38px;
  height: 38px;
  border: 1.5px dashed color-mix(in srgb, var(--dws-accent) 48%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--dws-accent) 10%, transparent);
  color: color-mix(in srgb, var(--dws-accent) 88%, var(--dws-ink));
}

.dws-composer-add i {
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1;
}

.dws-composer-add:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dws-accent) 72%, transparent);
  background: color-mix(in srgb, var(--dws-accent) 16%, transparent);
  color: var(--dws-ink);
}

.dws-composer-clear {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dws-ink) 8%, transparent);
  color: var(--dws-muted);
}

.dws-composer-clear i {
  font-size: 0.92rem;
  line-height: 1;
}

.dws-composer-clear:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dws-ink) 13%, transparent);
  color: var(--dws-ink);
}

.dws-composer-add:disabled,
.dws-composer-clear:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dws-custom-structure {
  margin-top: 8px;
  padding: 10px 12px;
  font-size: 0.79rem;
}

.dws-quick-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.dws-select-field {
  min-width: 0;
}

.dws-select-field .dws-label {
  margin-bottom: 6px;
}

.dws-select-field :deep(.ratio-select__trigger) {
  min-height: 38px;
  padding: 0 32px 0 11px;
  border: 0;
  border-radius: 11px;
  background: var(--dws-fill);
  box-shadow: none;
  color: var(--dws-ink);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.dws-select-field :deep(.ratio-select__trigger:hover) {
  background: var(--dws-fill-hover);
}

.dws-select-field :deep(.ratio-select__trigger:focus-visible),
.dws-select-field :deep(.ratio-select.is-open .ratio-select__trigger) {
  border: 0;
  background: var(--dws-fill-hover);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dws-accent) 52%, transparent);
}

.dws-page-type-trigger {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 12px;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 0;
  border-radius: 11px;
  background: var(--dws-fill);
  color: var(--dws-ink);
  text-align: left;
  cursor: pointer;
}

.dws-page-type-trigger:hover,
.dws-page-type-trigger[aria-expanded='true'] {
  background: var(--dws-fill-hover);
}

.dws-page-type-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dws-accent) 58%, transparent);
  outline-offset: 2px;
}

.dws-page-type-trigger > i:first-child {
  color: #a99cff;
}

.dws-page-type-trigger span {
  overflow: hidden;
  font-size: 0.75rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-page-type-trigger .bi-chevron-right {
  color: var(--dws-faint);
  font-size: 0.62rem;
  transition: transform 0.18s ease;
}

.dws-page-type-trigger[aria-expanded='true'] .bi-chevron-right {
  transform: rotate(180deg);
}

.dws-page-type-scrim {
  position: fixed;
  z-index: 2100;
  inset: 0;
  background: transparent;
}

.dws-page-type-picker {
  --picker-bg: rgba(16, 17, 24, 0.98);
  --picker-ink: rgba(255, 255, 255, 0.94);
  --picker-muted: rgba(255, 255, 255, 0.55);
  --picker-faint: rgba(255, 255, 255, 0.34);
  --picker-fill: rgba(255, 255, 255, 0.045);
  --picker-border: rgba(255, 255, 255, 0.075);
  position: fixed;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--picker-border);
  border-radius: 14px;
  background: var(--picker-bg);
  color: var(--picker-ink);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  backdrop-filter: blur(24px) saturate(130%);
  animation: dws-page-type-enter 0.18s ease-out both;
}

.dws-page-type-header {
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 32px;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: 68px;
  padding: 0 16px 0 18px;
  border-bottom: 1px solid var(--picker-border);
  background: color-mix(in srgb, var(--picker-bg) 94%, transparent);
}

.dws-page-type-header > span {
  display: grid;
  gap: 4px;
}

.dws-page-type-header small {
  color: #a99cff;
  font: 700 0.56rem/1 monospace;
}

.dws-page-type-header strong {
  font-size: 0.93rem;
}

.dws-page-type-header > em {
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(109, 92, 255, 0.14);
  color: #bdb3ff;
  font: 600 0.62rem/1 monospace;
  font-style: normal;
}

.dws-page-type-header > button {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--picker-fill);
  color: var(--picker-muted);
  cursor: pointer;
}

.dws-page-type-header > button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--picker-ink);
}

.dws-page-type-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(109, 92, 255, 0.42) transparent;
}

.dws-page-type-grid > button {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-content: start;
  gap: 9px;
  min-width: 0;
  min-height: 116px;
  padding: 12px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--picker-fill);
  color: var(--picker-ink);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.dws-page-type-grid > button:hover {
  border-color: rgba(138, 114, 255, 0.34);
  background: rgba(109, 92, 255, 0.1);
  transform: translateY(-1px);
}

.dws-page-type-grid > button.is-on {
  border-color: rgba(138, 114, 255, 0.56);
  background: rgba(109, 92, 255, 0.16);
}

.dws-page-type-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 9px;
  background: rgba(109, 92, 255, 0.14);
  color: #bdb3ff;
  font-size: 0.86rem;
}

.dws-page-type-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dws-page-type-copy strong {
  padding-right: 14px;
  font-size: 0.75rem;
  line-height: 1.25;
}

.dws-page-type-copy small {
  overflow: hidden;
  color: var(--picker-muted);
  font-size: 0.62rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-page-type-copy em {
  display: -webkit-box;
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--picker-faint);
  font-size: 0.58rem;
  font-style: normal;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dws-page-type-grid > button > .bi:last-child {
  position: absolute;
  top: 12px;
  right: 10px;
  color: var(--picker-faint);
  font-size: 0.65rem;
}

.dws-page-type-grid > button.is-on > .bi:last-child {
  color: #a99cff;
}

.dws-page-type-picker.is-light {
  --picker-bg: rgba(255, 255, 255, 0.98);
  --picker-ink: rgba(27, 29, 42, 0.96);
  --picker-muted: rgba(43, 45, 60, 0.64);
  --picker-faint: rgba(47, 49, 65, 0.45);
  --picker-fill: rgba(34, 36, 50, 0.045);
  --picker-border: rgba(35, 37, 52, 0.1);
  box-shadow: 0 28px 80px rgba(48, 44, 78, 0.18);
}

.dws-page-type-picker.is-light .dws-page-type-header small,
.dws-page-type-picker.is-light .dws-page-type-header > em,
.dws-page-type-picker.is-light .dws-page-type-icon,
.dws-page-type-picker.is-light .dws-page-type-grid > button.is-on > .bi:last-child {
  color: #6250e8;
}

.dws-brand-dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}

.dws-brand-trigger > i:first-child {
  color: transparent;
}

.dws-config-scrim {
  position: fixed;
  z-index: 2110;
  inset: 0;
  background: transparent;
}

.dws-config-picker {
  --dws-ink: rgba(255, 255, 255, 0.94);
  --dws-muted: rgba(255, 255, 255, 0.58);
  --dws-faint: rgba(255, 255, 255, 0.36);
  --dws-fill: rgba(255, 255, 255, 0.05);
  --dws-fill-hover: rgba(255, 255, 255, 0.09);
  --dws-fill-deep: rgba(255, 255, 255, 0.03);
  --dws-accent: #6d5cff;
  --dws-accent-soft: rgba(109, 92, 255, 0.18);
  position: fixed;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(16, 17, 24, 0.98);
  color: var(--dws-ink);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  backdrop-filter: blur(24px) saturate(130%);
  animation: dws-page-type-enter 0.18s ease-out both;
}

.dws-config-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 32px;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: 68px;
  padding: 0 16px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.dws-config-header > span {
  display: grid;
  gap: 4px;
}

.dws-config-header small {
  color: #a99cff;
  font: 700 0.56rem/1 monospace;
}

.dws-config-header strong {
  font-size: 0.93rem;
}

.dws-config-header > em {
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--dws-accent-soft);
  color: #bdb3ff;
  font: 600 0.62rem/1 monospace;
  font-style: normal;
}

.dws-config-header > button {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--dws-fill);
  color: var(--dws-muted);
  cursor: pointer;
}

.dws-config-header > button:hover {
  background: var(--dws-fill-hover);
  color: var(--dws-ink);
}

.dws-style-grid,
.dws-brand-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(109, 92, 255, 0.42) transparent;
}

.dws-style-grid > button {
  position: relative;
  min-width: 0;
  padding: 0 0 11px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--dws-fill);
  color: var(--dws-ink);
  text-align: left;
  cursor: pointer;
}

.dws-style-grid > button:hover,
.dws-style-grid > button.is-on,
.dws-brand-grid > button:hover,
.dws-brand-grid > button.is-on {
  border-color: rgba(138, 114, 255, 0.5);
  background: rgba(109, 92, 255, 0.11);
}

.dws-style-preview {
  display: grid;
  grid-template-columns: 1.6fr 1fr 0.7fr;
  height: 64px;
  margin-bottom: 10px;
}

.dws-style-preview i {
  display: block;
}

.dws-style-copy {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 4px 7px;
  padding: 0 10px;
}

.dws-style-copy > i {
  grid-row: 1 / span 2;
  color: #a99cff;
}

.dws-style-copy strong {
  padding-right: 12px;
  font-size: 0.73rem;
}

.dws-style-copy small {
  overflow: hidden;
  color: var(--dws-faint);
  font-size: 0.6rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-style-grid > button > .bi:last-child,
.dws-brand-grid > button > .bi:last-child {
  position: absolute;
  right: 9px;
  bottom: 11px;
  color: var(--dws-faint);
  font-size: 0.64rem;
}

.dws-style-grid > button.is-on > .bi:last-child,
.dws-brand-grid > button.is-on > .bi:last-child {
  color: #a99cff;
}

.dws-brand-grid > button {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 104px;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--dws-fill);
  color: var(--dws-ink);
  text-align: left;
  cursor: pointer;
}

.dws-brand-swatch {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.dws-brand-grid > button > span:nth-child(2) {
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
}

.dws-brand-grid strong {
  font-size: 0.73rem;
}

.dws-brand-grid small {
  overflow: hidden;
  color: var(--dws-faint);
  font-size: 0.59rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-brand-grid em {
  color: var(--dws-muted);
  font: 600 0.56rem/1 monospace;
  font-style: normal;
}

.dws-brand-tones {
  position: absolute;
  right: 11px;
  bottom: 10px;
  left: 11px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
}

.dws-brand-tones i:nth-child(1) {
  background: color-mix(in srgb, var(--picker-brand) 18%, white);
}

.dws-brand-tones i:nth-child(2) {
  background: color-mix(in srgb, var(--picker-brand) 55%, white);
}

.dws-brand-tones i:nth-child(3) {
  background: var(--picker-brand);
}

.dws-brand-tones i:nth-child(4) {
  background: color-mix(in srgb, var(--picker-brand) 72%, black);
}

.dws-spec-editor {
  display: grid;
  gap: 12px;
  padding: 14px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dws-spec-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.dws-spec-overview > span {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 8px;
  row-gap: 2px;
  align-items: center;
  min-width: 0;
  padding: 10px 10px 9px;
  border-radius: 10px;
  background: var(--dws-fill);
}

.dws-spec-overview i {
  grid-row: 1 / span 2;
  color: #a99cff;
  font-size: 0.95rem;
  line-height: 1;
}

.dws-spec-overview b,
.dws-spec-overview small {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-spec-overview b {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
}

.dws-spec-overview small {
  color: var(--dws-faint);
  font-size: 0.58rem;
  line-height: 1.2;
}

.dws-spec-hint {
  margin: 0;
  color: var(--dws-faint);
  font-size: 0.66rem;
  line-height: 1.45;
}

.dws-config-picker .dws-spec-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 10px;
  padding-top: 0;
  border-top: 0;
}

.dws-config-picker .dws-spec-grid .is-wide {
  grid-column: span 3;
}

.dws-config-picker .dws-state-field {
  margin-top: 2px;
}

.dws-config-picker .dws-state-options {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.dws-config-picker .dws-state-options button {
  min-height: 34px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
}

.dws-config-picker .dws-state-options button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-config-picker.is-light {
  --dws-ink: rgba(27, 29, 42, 0.96);
  --dws-muted: rgba(43, 45, 60, 0.66);
  --dws-faint: rgba(47, 49, 65, 0.45);
  --dws-fill: rgba(34, 36, 50, 0.05);
  --dws-fill-hover: rgba(34, 36, 50, 0.09);
  --dws-fill-deep: rgba(34, 36, 50, 0.03);
  --dws-accent: #6250e8;
  --dws-accent-soft: rgba(98, 80, 232, 0.12);
  border-color: rgba(35, 37, 52, 0.1);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 28px 80px rgba(48, 44, 78, 0.18);
}

.dws-config-picker.is-light .dws-config-header {
  border-color: rgba(35, 37, 52, 0.09);
}

.dws-config-picker.is-light .dws-config-header small,
.dws-config-picker.is-light .dws-config-header > em,
.dws-config-picker.is-light .dws-style-copy > i,
.dws-config-picker.is-light .dws-spec-overview i {
  color: #6250e8;
}

.dws-config-picker.is-light .dws-state-options button.is-on {
  color: #4e3bd0;
}

.dws-quality-layer {
  position: fixed;
  z-index: 2200;
  inset: 0;
  display: grid;
  padding: 24px;
  place-items: center;
  background: rgba(6, 7, 11, 0.66);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}

.dws-quality-dialog {
  --quality-bg: #111319;
  --quality-ink: rgba(255, 255, 255, 0.94);
  --quality-muted: rgba(255, 255, 255, 0.58);
  --quality-faint: rgba(255, 255, 255, 0.36);
  --quality-fill: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  width: min(820px, 100%);
  max-height: min(780px, calc(100dvh - 48px));
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: var(--quality-bg);
  color: var(--quality-ink);
  box-shadow: 0 32px 100px rgba(0, 0, 0, 0.54);
  animation: dws-quality-enter 0.22s ease-out both;
}

.dws-quality-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 34px 34px;
  align-items: center;
  gap: 12px;
  flex: none;
  min-height: 70px;
  padding: 0 16px 0 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.dws-quality-header > span {
  display: grid;
  gap: 4px;
}

.dws-quality-header small {
  color: #72d5b1;
  font: 700 0.56rem/1 monospace;
}

.dws-quality-header strong {
  font-size: 0.96rem;
}

.dws-quality-header > em {
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(18, 183, 106, 0.12);
  color: #91dfc3;
  font-size: 0.62rem;
  font-style: normal;
}

.dws-quality-header > button {
  display: grid;
  width: 34px;
  height: 34px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--quality-fill);
  color: var(--quality-muted);
  cursor: pointer;
}

.dws-quality-header > button.is-refresh {
  color: #91dfc3;
}

.dws-quality-modes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  flex: none;
  padding: 6px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.dws-quality-modes button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--quality-faint);
  font-size: 0.66rem;
  cursor: pointer;
}

.dws-quality-modes button.is-on {
  background: var(--quality-fill);
  color: var(--quality-ink);
}

.dws-quality-modes button:disabled {
  cursor: wait;
  opacity: 0.5;
}

.dws-quality-modes button > i {
  color: #72d5b1;
}

.dws-quality-modes button > em {
  min-width: 23px;
  padding: 3px 5px;
  border-radius: 5px;
  background: rgba(18, 183, 106, 0.12);
  color: #72d5b1;
  font: 700 0.54rem/1 monospace;
  font-style: normal;
}

.dws-quality-loading,
.dws-quality-error,
.dws-quality-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  min-height: 390px;
  padding: 40px;
  place-content: center;
  text-align: center;
}

.dws-quality-loading > strong,
.dws-quality-error > strong,
.dws-quality-empty > strong {
  font-size: 0.9rem;
}

.dws-quality-loading > p,
.dws-quality-error > p,
.dws-quality-empty > p {
  max-width: 440px;
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.7rem;
  line-height: 1.6;
}

.dws-quality-orbit {
  position: relative;
  width: 54px;
  height: 54px;
  margin-bottom: 8px;
  border: 1px solid rgba(114, 213, 177, 0.22);
  border-radius: 50%;
  animation: dws-spin 3s linear infinite;
}

.dws-quality-orbit i {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #72d5b1;
}

.dws-quality-orbit i:nth-child(1) {
  top: -4px;
  left: 23px;
}

.dws-quality-orbit i:nth-child(2) {
  right: 2px;
  bottom: 7px;
  opacity: 0.65;
}

.dws-quality-orbit i:nth-child(3) {
  bottom: 7px;
  left: 2px;
  opacity: 0.35;
}

.dws-quality-loading > div {
  display: grid;
  gap: 7px;
  width: min(360px, 80vw);
  margin-top: 18px;
}

.dws-quality-loading > div i {
  height: 7px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(114, 213, 177, 0.15),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
  animation: dws-quality-scan 1.6s ease-in-out infinite;
}

.dws-quality-loading > div i:nth-child(2) {
  width: 76%;
}

.dws-quality-loading > div i:nth-child(3) {
  width: 56%;
}

.dws-quality-error > i {
  color: #ffb36b;
  font-size: 1.8rem;
}

.dws-quality-empty > i {
  color: #72d5b1;
  font-size: 1.8rem;
}

.dws-quality-error > button,
.dws-quality-empty > button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  margin-top: 10px;
  padding: 0 13px;
  border: 0;
  border-radius: 8px;
  background: rgba(109, 92, 255, 0.18);
  color: #c7beff;
  font-size: 0.7rem;
  cursor: pointer;
}

.dws-quality-result {
  padding: 18px 20px 24px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(114, 213, 177, 0.32) transparent;
}

.dws-quality-inline-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--quality-fill);
}

.dws-quality-inline-empty > span {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.dws-quality-inline-empty i {
  color: #72d5b1;
}

.dws-quality-inline-empty b {
  font-size: 0.64rem;
}

.dws-quality-inline-empty small {
  color: var(--quality-faint);
  font-size: 0.57rem;
}

.dws-quality-inline-empty > button {
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: rgba(109, 92, 255, 0.18);
  color: #c7beff;
  font-size: 0.6rem;
  cursor: pointer;
  white-space: nowrap;
}

.dws-quality-summary {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.dws-quality-score {
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#55c99f var(--quality-score), rgba(255, 255, 255, 0.06) 0);
}

.dws-quality-score::before {
  content: '';
  grid-area: 1 / 1;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--quality-bg);
}

.dws-quality-score > span {
  z-index: 1;
  grid-area: 1 / 1;
  display: grid;
  justify-items: center;
  gap: 3px;
}

.dws-quality-score b {
  font: 800 1.38rem/1 monospace;
}

.dws-quality-score small {
  color: var(--quality-faint);
  font: 600 0.54rem/1 monospace;
}

.dws-quality-summary > div:last-child {
  display: grid;
  gap: 7px;
}

.dws-quality-summary > div:last-child small {
  color: #72d5b1;
  font-size: 0.6rem;
}

.dws-quality-summary > div:last-child strong {
  font-size: 0.9rem;
  line-height: 1.45;
}

.dws-quality-summary p {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.64rem;
}

.dws-quality-summary p b {
  padding: 3px 6px;
  border-radius: 5px;
  font: 700 0.58rem/1 monospace;
}

.dws-quality-summary p b.is-up {
  background: rgba(18, 183, 106, 0.13);
  color: #72d5b1;
}

.dws-quality-summary p b.is-down {
  background: rgba(240, 68, 56, 0.13);
  color: #ff9d95;
}

.dws-quality-comparison {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 11px 12px;
  border: 1px solid rgba(114, 213, 177, 0.14);
  border-radius: 8px;
  background: rgba(114, 213, 177, 0.045);
}

.dws-quality-comparison > span {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 700 0.76rem/1 monospace;
}

.dws-quality-comparison > span.is-up {
  color: #72d5b1;
}

.dws-quality-comparison > span.is-down {
  color: #ff9d95;
}

.dws-quality-comparison > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dws-quality-comparison strong {
  font-size: 0.63rem;
}

.dws-quality-comparison p {
  overflow: hidden;
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.58rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-quality-comparison ul {
  display: flex;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dws-quality-comparison li {
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--quality-fill);
  color: var(--quality-muted);
  font-size: 0.54rem;
  white-space: nowrap;
}

.dws-region-review {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid rgba(114, 213, 177, 0.17);
  border-radius: 9px;
  background: rgba(114, 213, 177, 0.035);
}

.dws-region-review > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dws-region-review > header > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.68rem;
}

.dws-region-review > header > span i {
  color: #72d5b1;
}

.dws-region-review > header > button {
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: var(--quality-fill);
  color: var(--quality-faint);
  cursor: pointer;
}

.dws-region-review-body {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 14px;
  padding: 12px;
}

.dws-region-review figure {
  display: grid;
  min-height: 118px;
  margin: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 7px;
  background: rgba(8, 10, 14, 0.72);
}

.dws-region-review figure img {
  width: 100%;
  height: 100%;
  max-height: 150px;
  object-fit: contain;
}

.dws-region-review figure > span {
  color: var(--quality-faint);
  font-size: 1.2rem;
}

.dws-region-review-loading,
.dws-region-review-error,
.dws-region-review-copy {
  display: grid;
  align-content: center;
  gap: 7px;
  min-width: 0;
}

.dws-region-review-loading > i {
  color: #72d5b1;
}

.dws-region-review-loading strong,
.dws-region-review-error strong,
.dws-region-review-copy > strong {
  font-size: 0.72rem;
}

.dws-region-review-loading p,
.dws-region-review-copy p {
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.62rem;
  line-height: 1.5;
}

.dws-region-review-copy > small {
  overflow: hidden;
  color: #72d5b1;
  font-size: 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-region-review-copy ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 16px;
  color: var(--quality-muted);
  font-size: 0.58rem;
  line-height: 1.4;
}

.dws-region-review-copy > button,
.dws-region-review-error > button {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 7px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: #5a4bd4;
  color: #fff;
  font-size: 0.62rem;
  cursor: pointer;
}

.dws-quality-dimensions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.dws-quality-dimensions article {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--quality-fill);
}

.dws-quality-dimensions article > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dws-quality-dimensions b {
  font-size: 0.63rem;
}

.dws-quality-dimensions em {
  color: #72d5b1;
  font: 700 0.63rem/1 monospace;
  font-style: normal;
}

.dws-quality-dimensions article > span > u {
  margin-left: auto;
  padding: 2px 4px;
  border-radius: 4px;
  font: 700 0.51rem/1 monospace;
  text-decoration: none;
}

.dws-quality-dimensions article > span > u.is-up {
  background: rgba(18, 183, 106, 0.12);
  color: #72d5b1;
}

.dws-quality-dimensions article > span > u.is-down {
  background: rgba(240, 68, 56, 0.12);
  color: #ff9d95;
}

.dws-quality-dimensions article > i {
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.07);
}

.dws-quality-dimensions article > i u {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #55c99f;
  text-decoration: none;
}

.dws-quality-dimensions small {
  overflow: hidden;
  color: var(--quality-faint);
  font-size: 0.56rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-quality-strengths,
.dws-quality-assets,
.dws-quality-issues {
  margin-top: 20px;
}

.dws-quality-assets > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.dws-quality-assets > header > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.74rem;
}

.dws-quality-assets > header > span i {
  color: #a99cff;
}

.dws-quality-assets > header small {
  color: var(--quality-faint);
  font: 600 0.57rem/1 monospace;
}

.dws-quality-assets > header button {
  min-height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: rgba(109, 92, 255, 0.14);
  color: #bdb3ff;
  font-size: 0.6rem;
  cursor: pointer;
}

.dws-quality-assets > header button i {
  margin-left: 5px;
}

.dws-quality-assets > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.dws-quality-assets article {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 9px;
  min-width: 0;
  padding: 7px;
  border-radius: 7px;
  background: var(--quality-fill);
}

.dws-quality-asset-thumb {
  min-height: 58px;
  border-radius: 5px;
  background-color: rgba(0, 0, 0, 0.22);
  background-repeat: no-repeat;
}

.dws-quality-assets article > div {
  display: grid;
  align-content: center;
  gap: 3px;
  min-width: 0;
}

.dws-quality-assets article strong {
  overflow: hidden;
  font-size: 0.64rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-quality-assets article small {
  color: #a99cff;
  font: 600 0.52rem/1.2 monospace;
}

.dws-quality-assets article p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.55rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dws-quality-strengths h3,
.dws-quality-issues h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 0.75rem;
}

.dws-quality-strengths h3 i {
  color: #72d5b1;
}

.dws-quality-strengths ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 20px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.dws-quality-strengths li {
  position: relative;
  padding-left: 13px;
  color: var(--quality-muted);
  font-size: 0.66rem;
  line-height: 1.5;
}

.dws-quality-strengths li::before {
  content: '';
  position: absolute;
  top: 0.55em;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #55c99f;
}

.dws-quality-issues > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.dws-quality-issues > header > div {
  display: flex;
  align-items: center;
  gap: 5px;
}

.dws-quality-issues > header button {
  min-height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: var(--quality-fill);
  color: var(--quality-muted);
  font-size: 0.58rem;
  cursor: pointer;
}

.dws-quality-issues > header span {
  margin-left: 3px;
  color: var(--quality-faint);
  font: 600 0.58rem/1 monospace;
}

.dws-quality-issues article {
  display: grid;
  grid-template-columns: 28px 42px minmax(0, 1fr);
  gap: 10px;
  margin: 0 -8px;
  padding: 13px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 7px;
  transition: background-color 0.15s ease;
}

.dws-quality-issues article.is-selected {
  background: rgba(114, 213, 177, 0.045);
}

.dws-quality-issues article.is-located {
  box-shadow: inset 3px 0 #6d5cff;
}

.dws-quality-issues article:has(.bi-crosshair) {
  cursor: pointer;
}

.dws-quality-check {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: transparent;
  color: var(--quality-faint);
  cursor: pointer;
}

.dws-quality-check[aria-pressed='true'] {
  border-color: rgba(114, 213, 177, 0.38);
  background: rgba(18, 183, 106, 0.14);
  color: #91dfc3;
}

.dws-quality-issues article > span {
  align-self: start;
  padding: 4px 0;
  border-radius: 5px;
  color: #ffd1a8;
  font-size: 0.56rem;
  text-align: center;
}

.dws-quality-issues article > span.is-critical {
  background: rgba(240, 68, 56, 0.15);
  color: #ff9d95;
}

.dws-quality-issues article > span.is-major {
  background: rgba(247, 144, 9, 0.14);
  color: #ffc178;
}

.dws-quality-issues article > span.is-minor {
  background: rgba(47, 129, 247, 0.13);
  color: #91c0ff;
}

.dws-quality-issues article > div {
  display: grid;
  gap: 5px;
}

.dws-quality-issues article strong {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.7rem;
}

.dws-quality-issues article strong em {
  padding: 3px 5px;
  border-radius: 4px;
  background: var(--quality-fill);
  color: var(--quality-faint);
  font-size: 0.53rem;
  font-style: normal;
  font-weight: 600;
}

.dws-quality-issues article strong > i {
  margin-left: auto;
  color: #a99cff;
  font-size: 0.67rem;
}

.dws-quality-issues article p,
.dws-quality-issues article small {
  margin: 0;
  color: var(--quality-faint);
  font-size: 0.63rem;
  line-height: 1.5;
}

.dws-quality-issues article small {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--quality-muted);
}

.dws-quality-clear {
  margin: 14px 0 0;
  color: var(--quality-muted);
  font-size: 0.68rem;
}

.dws-quality-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  min-height: 64px;
  padding: 0 16px 0 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.dws-quality-footer > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--quality-faint);
  font-size: 0.61rem;
}

.dws-quality-footer > span i {
  color: #72d5b1;
}

.dws-quality-footer > button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: #5a4bd4;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.dws-quality-footer > button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.dws-quality-dialog.is-light {
  --quality-bg: #ffffff;
  --quality-ink: rgba(27, 29, 42, 0.96);
  --quality-muted: rgba(43, 45, 60, 0.66);
  --quality-faint: rgba(47, 49, 65, 0.45);
  --quality-fill: rgba(34, 36, 50, 0.055);
  border-color: rgba(35, 37, 52, 0.1);
  box-shadow: 0 32px 90px rgba(48, 44, 78, 0.2);
}

.dws-quality-dialog.is-light .dws-quality-header,
.dws-quality-dialog.is-light .dws-quality-modes,
.dws-quality-dialog.is-light .dws-quality-summary,
.dws-quality-dialog.is-light .dws-quality-footer,
.dws-quality-dialog.is-light .dws-quality-issues article {
  border-color: rgba(35, 37, 52, 0.08);
}

@keyframes dws-quality-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.985);
  }
}

@keyframes dws-quality-scan {
  to {
    background-position: -200% 0;
  }
}

@keyframes dws-page-type-enter {
  from {
    opacity: 0;
    transform: translateX(-8px) scale(0.985);
  }
}

.dws-quick-settings .dws-custom-structure {
  grid-column: 1 / -1;
  margin-top: 0;
}

/* 设备载体：单行图标 + 尺寸 */
.dws-devices {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 3px;
  border-radius: calc(var(--dws-radius) + 2px);
  background: var(--dws-fill-deep);
}

.dws-devices button {
  display: grid;
  flex: 1 1 0;
  justify-items: center;
  gap: 2px;
  min-width: 0;
  padding: 7px 2px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-devices button:hover:not(.is-on) {
  background: var(--dws-fill);
  color: var(--dws-ink);
}

.dws-devices button i {
  font-size: 0.95rem;
  line-height: 1;
}

.dws-devices button small {
  color: var(--dws-faint);
  font: 600 0.54rem/1 monospace;
  letter-spacing: -0.02em;
}

.dws-devices button.is-on {
  background: var(--dws-accent);
  color: #fff;
  box-shadow: 0 4px 12px rgba(109, 92, 255, 0.28);
}

.dws-devices button.is-on small {
  color: rgba(255, 255, 255, 0.78);
}

/* 配色行：主色 + 明暗，同一行两列对齐 */
.dws-color-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}

.dws-color-brand,
.dws-color-scheme,
.dws-count-wrap {
  min-width: 0;
}

.dws-brand-select :deep(.ratio-select__swatch) {
  width: 16px;
  height: 16px;
  border-radius: 5px;
}

.dws-scheme {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 11px;
  background: var(--dws-fill-deep);
}

.dws-scheme button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.71rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-scheme button.is-on {
  background: var(--dws-accent);
  color: #fff;
}

/* 设计规范：参数可编辑，令牌摘要可快速核对 */
.dws-specification {
  overflow: visible;
  border-radius: 13px;
  background: var(--dws-fill-deep);
}

.dws-specification-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: 8px 11px;
  border: 0;
  border-radius: 13px;
  background: transparent;
  color: var(--dws-ink);
  cursor: pointer;
}

.dws-specification-toggle > span {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 8px;
  min-width: 0;
  text-align: left;
}

.dws-specification-toggle > span > i {
  grid-row: 1 / span 2;
  color: #a99cff;
  font-size: 0.95rem;
}

.dws-specification-toggle strong,
.dws-specification-toggle small {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-specification-toggle strong {
  font-size: 0.75rem;
  line-height: 1.3;
}

.dws-specification-toggle small {
  margin-top: 2px;
  color: var(--dws-faint);
  font: 600 0.58rem/1.25 monospace;
}

.dws-specification-toggle > .bi-chevron-down {
  color: var(--dws-faint);
  font-size: 0.66rem;
  transition: transform 0.2s ease;
}

.dws-specification.is-open .dws-specification-toggle > .bi-chevron-down {
  transform: rotate(180deg);
}

.dws-specification-body {
  padding: 4px 10px 10px;
}

.dws-spec-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.055);
}

.dws-spec-grid .is-wide {
  grid-column: 1 / -1;
}

.dws-state-field {
  margin-top: 12px;
}

.dws-state-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.dws-state-options button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 30px;
  padding: 0 5px;
  border: 0;
  border-radius: 8px;
  background: var(--dws-fill);
  color: var(--dws-faint);
  font-size: 0.64rem;
  cursor: pointer;
}

.dws-state-options button.is-on {
  background: var(--dws-accent-soft);
  color: #c9c1ff;
}

.dws-token-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
}

.dws-token-strip span {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 7px 2px;
  background: var(--dws-fill-deep);
  color: var(--dws-faint);
  font-size: 0.55rem;
  white-space: nowrap;
}

.dws-token-strip b {
  color: var(--dws-muted);
  font: 700 0.63rem/1 monospace;
}

.dws-count {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  width: 100%;
  padding: 4px;
  border-radius: 11px;
  background: var(--dws-fill-deep);
}

.dws-count button {
  width: 100%;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-count button.is-on {
  background: var(--dws-accent);
  color: #fff;
}

/* 提示词预览 */
.dws-prompt-preview {
  margin-top: 16px;
  border-radius: var(--dws-radius);
  background: var(--dws-fill-deep);
}

.dws-prompt-preview summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--dws-faint);
  font-size: 0.71rem;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.dws-prompt-preview summary::-webkit-details-marker {
  display: none;
}

.dws-prompt-preview summary .bi-chevron-down {
  margin-left: auto;
  transition: transform 0.2s ease;
}

.dws-prompt-preview summary .bi-chevron-down.is-open {
  transform: rotate(180deg);
}

.dws-prompt-preview pre {
  margin: 0;
  padding: 0 12px 12px;
  color: var(--dws-muted);
  font-size: 0.69rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.dws-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 14px 0 0;
  color: #ff9d9d;
  font-size: 0.74rem;
  line-height: 1.5;
}

/* 生成按钮：固定在侧栏底部，上方内容单独滚动 */
.dws-generate-dock {
  position: relative;
  z-index: 2;
  flex: none;
  margin: 0 -18px;
  padding: 10px 18px 14px;
  background: linear-gradient(180deg, transparent, rgba(10, 10, 16, 0.92) 28%);
  border-top: 1px solid color-mix(in srgb, var(--dws-ink) 6%, transparent);
}

.dws-generate {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 62px;
  padding: 7px 12px 7px 8px;
  border: 1px solid color-mix(in srgb, var(--dws-accent) 62%, #fff 10%);
  border-radius: 13px;
  background: color-mix(in srgb, var(--dws-accent) 88%, #16131f 12%);
  color: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--dws-accent) 34%, transparent);
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease;
}

.dws-generate:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.52);
  background: color-mix(in srgb, var(--dws-accent) 94%, #fff 6%);
  transform: translateY(-1px);
}

.dws-generate:active:not(:disabled) {
  transform: scale(0.985);
}

.dws-generate:disabled {
  opacity: 0.78;
  cursor: wait;
}

.dws-generate-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 9px;
  background: rgba(8, 7, 14, 0.2);
  font-size: 0.88rem;
}

.dws-generate-copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.dws-generate-copy strong {
  overflow: hidden;
  font-size: 0.84rem;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-generate-copy small {
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.62rem;
}

.dws-generate-price {
  display: grid;
  justify-items: end;
  gap: 5px;
  white-space: nowrap;
}

.dws-generate-price strong {
  font: 800 0.88rem/1 monospace;
}

.dws-generate-price small {
  color: rgba(255, 255, 255, 0.62);
  font: 600 0.56rem/1 monospace;
}

/* ————— 右侧：无框沉浸画布 ————— */
.dws-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: transparent;
}

/* 画布环境光：跟随品牌主色 */
.dws-stage-ambient {
  pointer-events: none;
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      58% 46% at 50% 43%,
      color-mix(in srgb, var(--dws-brand) 9%, transparent),
      transparent 74%
    ),
    linear-gradient(to bottom, transparent 40%, rgba(0, 0, 0, 0.18) 100%);
  transition: background 0.4s ease;
}

.dws-stage-meta {
  position: absolute;
  top: 16px;
  left: 20px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(12, 12, 19, 0.62);
  color: var(--dws-muted);
  font-size: 0.72rem;
  backdrop-filter: blur(10px);
}

.dws-stage-meta b {
  color: var(--dws-faint);
  font: 600 0.66rem/1 monospace;
}

.dws-stage-meta em {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--dws-accent-soft);
  color: #c3b8ff;
  font: 700 0.64rem/1.3 monospace;
}

.dws-stage-meta em.is-tile-refine-tag {
  background: rgba(109, 92, 255, 0.28);
  color: #efeaff;
}

.dws-stage-spec {
  position: absolute;
  top: 55px;
  left: 20px;
  z-index: 4;
  display: flex;
  gap: 5px;
  color: var(--dws-faint);
  font: 600 0.56rem/1 monospace;
}

.dws-stage-spec span {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  background: rgba(12, 12, 19, 0.48);
  backdrop-filter: blur(8px);
}

.dws-stage-actions {
  position: absolute;
  top: 16px;
  right: 20px;
  z-index: 4;
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(12, 12, 19, 0.62);
  backdrop-filter: blur(10px);
}

.dws-stage-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dws-muted);
  font-size: 0.72rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-stage-actions button:hover:not(:disabled) {
  background: var(--dws-accent-soft);
  color: #fff;
}

.dws-stage-actions button.is-editor {
  background: var(--dws-accent-soft);
  color: #d4ceff;
}

.dws-stage-actions button.is-quality {
  color: #8fd9c0;
}

.dws-stage-actions button.is-quality:hover:not(:disabled) {
  background: rgba(18, 183, 106, 0.14);
  color: #b4f0db;
}

.dws-stage-actions button.is-region.is-on {
  background: rgba(18, 183, 106, 0.16);
  color: #a7ead2;
}

.dws-stage-actions button.is-tile-refine {
  background: rgba(109, 92, 255, 0.14);
  color: #d5ceff;
}

.dws-stage-actions button.is-tile-refine:hover:not(:disabled) {
  background: rgba(109, 92, 255, 0.24);
  color: #efeaff;
}

.dws-stage-actions button.is-editor:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dws-accent) 34%, transparent);
  color: #fff;
}

.dws-stage-actions button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.dws-empty-editor {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--dws-accent-soft);
  color: #c8bfff;
  font-size: 0.69rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.dws-empty-editor:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dws-accent) 32%, transparent);
  color: #fff;
  transform: translateY(-1px);
}

.dws-empty-editor:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dws-canvas {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: clamp(56px, 7vh, 76px) clamp(20px, 3vw, 44px) 16px;
}

.dws-canvas.is-device-rail {
  grid-template-columns: minmax(0, 1fr) 108px;
  align-items: center;
  justify-items: center;
  gap: 14px;
  padding-right: 18px;
}

.dws-canvas.is-multi-loading {
  place-items: stretch;
  align-content: center;
}

.dws-canvas.is-tile-refine {
  position: relative;
}

.dws-tile-refine {
  position: absolute;
  z-index: 12;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 8, 14, 0.55);
  backdrop-filter: blur(8px);
}

.dws-tile-refine-card {
  display: grid;
  gap: 14px;
  width: min(420px, 100%);
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(18, 18, 26, 0.96);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.92);
}

.dws-tile-refine-card > header {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.dws-tile-refine-card > header > i {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: rgba(109, 92, 255, 0.24);
  color: #cfc7ff;
}

.dws-tile-refine-card strong {
  display: block;
  font-size: 0.92rem;
  font-weight: 750;
}

.dws-tile-refine-card small {
  display: block;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.68rem;
  line-height: 1.4;
}

.dws-tile-refine-card ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dws-tile-refine-card li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.72rem;
}

.dws-tile-refine-card li.is-done {
  color: #9ef0c8;
}

.dws-tile-refine-card li.is-running {
  color: #dcd6ff;
}

.dws-tile-refine-card li.is-failed,
.dws-tile-refine-card li.is-cancelled {
  color: #ffb0a8;
}

.dws-tile-refine-card li em {
  font-style: normal;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.62rem;
}

.dws-tile-refine-card .dws-running-cancel {
  justify-self: center;
}

.dws-tile-result {
  position: fixed;
  z-index: 240;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(6, 6, 12, 0.7);
  backdrop-filter: blur(10px);
}

.dws-tile-result-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  width: min(880px, 100%);
  max-height: min(88vh, 920px);
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background: rgba(16, 16, 24, 0.97);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.92);
}

.dws-tile-result-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dws-tile-result-card > header strong {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.94rem;
  font-weight: 750;
}

.dws-tile-result-card > header strong em {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(109, 92, 255, 0.26);
  color: #d9d2ff;
  font-style: normal;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.dws-tile-result-card > header small {
  display: block;
  margin-top: 5px;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.68rem;
}

.dws-tile-result-card > header > button {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
}

.dws-tile-result-card > header > button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.dws-tile-result-stage {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  background:
    repeating-conic-gradient(rgba(255, 255, 255, 0.04) 0% 25%, transparent 0% 50%) 0 0 / 22px 22px,
    rgba(10, 10, 16, 0.9);
}

.dws-tile-result-stage :deep(img),
.dws-tile-result-stage img {
  display: block;
  max-width: 100%;
  max-height: min(64vh, 720px);
  object-fit: contain;
}

.dws-tile-result-card > footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.dws-tile-result-card > footer button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 11px;
  font-size: 0.76rem;
  font-weight: 650;
  cursor: pointer;
}

.dws-tile-result-card > footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dws-tile-result-card > footer button.is-secondary {
  background: rgba(109, 92, 255, 0.16);
  color: #d5ceff;
}

.dws-tile-result-card > footer button.is-secondary:hover:not(:disabled) {
  background: rgba(109, 92, 255, 0.26);
}

.dws-tile-result-card > footer button.is-primary {
  background: #6d5cff;
  color: #fff;
}

.dws-tile-result-card > footer button.is-primary:hover {
  background: #7f70ff;
}

.dws-multi-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  align-content: center;
  gap: 14px;
  width: min(100%, 1100px);
  max-height: 100%;
  margin: 0 auto;
  overflow: auto;
  padding: 4px 2px 8px;
}

.dws-multi-slot {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.dws-multi-slot > header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dws-muted);
  font-size: 0.66rem;
}

.dws-multi-slot > header em {
  margin-left: auto;
  color: var(--dws-faint);
  font-style: normal;
  font-family: monospace;
  font-size: 0.58rem;
}

.dws-multi-frame {
  position: relative;
  width: 100%;
  max-height: min(52vh, 420px);
  border-radius: 12px;
  background: #101018;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}

.dws-multi-frame :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-multi-loading {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  padding: 16px;
  color: rgba(255, 255, 255, 0.78);
  text-align: center;
  background: linear-gradient(180deg, rgba(18, 18, 28, 0.2), rgba(18, 18, 28, 0.72));
}

.dws-multi-loading i {
  position: relative;
  z-index: 1;
  font-size: 1.1rem;
  color: #b7aeff;
}

.dws-multi-loading strong,
.dws-multi-loading small {
  position: relative;
  z-index: 1;
}

.dws-multi-loading strong {
  font-size: 0.74rem;
}

.dws-multi-loading small {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.6rem;
}

.dws-multi-slot.is-failed .dws-multi-loading i {
  color: #ff8f8f;
}

.dws-running-cancel.is-multi {
  grid-column: 1 / -1;
  justify-self: center;
  margin-top: 4px;
}

.dws-device-rail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 108px;
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 4px 2px;
}

.dws-device-rail > button {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--dws-ink) 10%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dws-fill) 86%, transparent);
  color: var(--dws-muted);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.dws-device-rail > button:hover {
  color: var(--dws-ink);
  transform: translateY(-1px);
}

.dws-device-rail > button.is-on {
  border-color: color-mix(in srgb, var(--dws-accent) 48%, transparent);
  background: color-mix(in srgb, var(--dws-accent) 12%, var(--dws-fill));
  color: var(--dws-ink);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--dws-accent) 14%, transparent);
}

.dws-device-rail-thumb {
  display: grid;
  width: 100%;
  place-items: center;
  max-height: 96px;
  border-radius: 8px;
  background: #111119;
  overflow: hidden;
}

.dws-device-rail-thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-device-rail-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.dws-device-rail-meta strong,
.dws-device-rail-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-device-rail-meta strong {
  font-size: 0.62rem;
  font-weight: 650;
}

.dws-device-rail-meta small {
  color: var(--dws-faint);
  font-size: 0.54rem;
  font-family: monospace;
}

.dws-artboard {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  border-radius: 14px;
  background: #0f0f16;
  box-shadow:
    0 40px 110px rgba(0, 0, 0, 0.62),
    0 10px 34px color-mix(in srgb, var(--dws-brand) 14%, transparent);
  overflow: hidden;
  transition:
    aspect-ratio 0.25s ease,
    width 0.25s ease,
    box-shadow 0.4s ease;
}

.dws-artboard.is-previewable {
  cursor: zoom-in;
}

.dws-artboard.is-previewable:hover {
  box-shadow:
    0 44px 120px rgba(0, 0, 0, 0.68),
    0 0 0 1px rgba(255, 255, 255, 0.12),
    0 12px 38px color-mix(in srgb, var(--dws-brand) 20%, transparent);
}

.dws-artboard.is-region-selecting {
  cursor: crosshair;
  box-shadow:
    0 0 0 2px rgba(114, 213, 177, 0.7),
    0 36px 100px rgba(0, 0, 0, 0.62);
}

.dws-artboard-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.dws-artboard-page {
  position: absolute;
  inset: 0;
}

.dws-artboard :deep(.authenticated-image) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0d0d12;
}

.dws-region-layer {
  position: absolute;
  z-index: 8;
  inset: 0;
  pointer-events: none;
}

.dws-region-layer.is-drawing {
  pointer-events: auto;
  background: rgba(7, 9, 13, 0.16);
  touch-action: none;
  user-select: none;
}

.dws-region-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(114, 213, 177, 0.32);
  border-radius: 7px;
  background: rgba(10, 13, 18, 0.82);
  color: #b8f0dc;
  font-size: 0.65rem;
  transform: translateX(-50%);
  backdrop-filter: blur(8px);
}

.dws-region-hint.is-error {
  border-color: rgba(240, 68, 56, 0.48);
  background: rgba(48, 19, 22, 0.9);
  color: #ffb0aa;
}

.dws-region-box {
  position: absolute;
  border: 2px solid #72d5b1;
  background: rgba(114, 213, 177, 0.08);
  box-shadow: 0 0 0 9999px rgba(5, 7, 10, 0.34);
}

.dws-region-box > i {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 2px solid #effff9;
  border-radius: 2px;
  background: #2eae81;
}

.dws-region-box > i:nth-child(1) {
  top: -5px;
  left: -5px;
}

.dws-region-box > i:nth-child(2) {
  top: -5px;
  right: -5px;
}

.dws-region-box > i:nth-child(3) {
  right: -5px;
  bottom: -5px;
}

.dws-region-box > i:nth-child(4) {
  bottom: -5px;
  left: -5px;
}

.dws-region-box > button {
  position: absolute;
  top: -14px;
  right: -14px;
  display: grid;
  width: 26px;
  height: 26px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: #151820;
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
}

.dws-quality-marks {
  position: absolute;
  z-index: 7;
  inset: 0;
  pointer-events: none;
}

.dws-quality-marks > button {
  position: absolute;
  min-width: 12px;
  min-height: 12px;
  padding: 0;
  border: 1.5px solid #f79009;
  border-radius: 4px;
  background: rgba(247, 144, 9, 0.08);
  box-shadow: 0 0 0 1px rgba(10, 10, 16, 0.45);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.dws-quality-marks > button.is-critical {
  border-color: #f04438;
  background: rgba(240, 68, 56, 0.1);
}

.dws-quality-marks > button.is-minor {
  border-color: #2f81f7;
  background: rgba(47, 129, 247, 0.08);
}

.dws-quality-marks > button.is-active {
  border-width: 2px;
  background: rgba(109, 92, 255, 0.12);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.92),
    0 0 0 5px rgba(109, 92, 255, 0.72),
    0 12px 32px rgba(0, 0, 0, 0.34);
}

.dws-quality-marks b {
  position: absolute;
  top: -11px;
  left: -11px;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #151820;
  font: 700 0.56rem/1 monospace;
}

.dws-quality-marks span {
  position: absolute;
  bottom: calc(100% + 7px);
  left: 0;
  display: none;
  width: max-content;
  max-width: 210px;
  padding: 6px 8px;
  border-radius: 5px;
  background: rgba(16, 17, 24, 0.94);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  font-size: 0.58rem;
  line-height: 1.35;
}

.dws-quality-marks > button:hover span,
.dws-quality-marks > button.is-active span {
  display: block;
}

.dws-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--dws-faint);
  background: radial-gradient(60% 60% at 50% 42%, rgba(255, 255, 255, 0.025), transparent 78%);
}

.dws-empty strong {
  color: var(--dws-muted);
  font-size: 0.94rem;
}

.dws-empty span {
  font-size: 0.74rem;
}

.dws-empty-sketch {
  display: grid;
  width: clamp(210px, 34%, 360px);
  aspect-ratio: 16 / 10;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.018);
}

.dws-empty-sketch > header {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 14%;
  padding: 0 5%;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.dws-empty-sketch > header > i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--dws-brand) 72%, transparent);
}

.dws-empty-sketch > header > span {
  width: 24%;
  height: 4px;
  margin-right: auto;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
}

.dws-empty-sketch > header > b {
  width: 8%;
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.07);
}

.dws-empty-sketch > div {
  display: grid;
  grid-template-columns: 20% minmax(0, 1fr);
  min-height: 0;
}

.dws-empty-sketch aside {
  display: grid;
  align-content: start;
  gap: 9%;
  padding: 18% 20%;
  border-right: 1px solid rgba(255, 255, 255, 0.045);
}

.dws-empty-sketch aside i {
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.065);
}

.dws-empty-content {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8%;
  padding: 10%;
}

.dws-empty-content > span {
  display: block;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.065);
}

.dws-empty-sketch .is-hero {
  width: 58%;
  height: 12px;
  background: color-mix(in srgb, var(--dws-brand) 24%, rgba(255, 255, 255, 0.05));
}

.dws-empty-sketch .is-copy {
  width: 74%;
  height: 5px;
}

.dws-empty-content > section {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  width: 100%;
  height: 36%;
}

.dws-empty-content > section i {
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.045);
}

.dws-running {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  background: rgba(9, 9, 13, 0.72);
  color: #d8d2ff;
  backdrop-filter: blur(5px);
  overflow: hidden;
}

.dws-running i {
  font-size: 1.6rem;
  animation: dws-breathe 1.6s ease-in-out infinite;
}

.dws-running strong {
  font-size: 0.82rem;
}

.dws-running span {
  color: var(--dws-faint);
  font-size: 0.7rem;
}

.dws-running-cancel {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  margin-top: 8px;
  padding: 0 13px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.dws-running-cancel:hover:not(:disabled) {
  border-color: rgba(255, 112, 112, 0.55);
  background: rgba(224, 72, 72, 0.12);
  color: #ff9d9d;
}

.dws-running-cancel:disabled {
  cursor: wait;
}

.dws-running-scan {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(109, 92, 255, 0.14) 48%,
    rgba(109, 92, 255, 0.32) 50%,
    rgba(109, 92, 255, 0.14) 52%,
    transparent 100%
  );
  background-size: 100% 260%;
  animation: dws-scan 2.6s ease-in-out infinite;
}

.dws-error.is-stage {
  position: relative;
  z-index: 4;
  margin: 0 20px 8px;
}

/* 历史：版本族与迭代胶片 */
.dws-versions-wrap {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto 36px;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  width: 100%;
  margin: 0;
  padding: 8px 16px 14px;
  border-top: 1px solid color-mix(in srgb, var(--dws-ink) 8%, transparent);
}

.dws-history-page {
  display: grid;
  width: 36px;
  height: 52px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--dws-ink) 10%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dws-fill) 82%, transparent);
  color: var(--dws-ink);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.dws-history-page:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dws-accent) 40%, transparent);
  background: color-mix(in srgb, var(--dws-accent) 12%, var(--dws-fill));
}

.dws-history-page:disabled {
  opacity: 0.35;
  cursor: default;
}

.dws-history-page-meta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 44px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dws-fill) 78%, transparent);
  color: var(--dws-faint);
  font-size: 0.58rem;
  white-space: nowrap;
}

.dws-history-page-meta strong {
  color: var(--dws-muted);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.dws-history-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: none;
  gap: 6px;
  width: 228px;
}

.dws-history-tabs button {
  display: inline-grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  justify-items: start;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--dws-ink) 10%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dws-fill) 82%, transparent);
  color: var(--dws-faint);
  cursor: pointer;
  transition:
    background-color 0.22s ease,
    border-color 0.22s ease,
    color 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
}

.dws-history-tabs button:hover:not(:disabled) {
  background: var(--dws-fill);
  border-color: color-mix(in srgb, var(--dws-ink) 16%, transparent);
  color: var(--dws-ink);
  transform: translateY(-1px);
}

.dws-history-tabs button.is-on {
  background: color-mix(in srgb, var(--dws-accent) 14%, var(--dws-fill));
  border-color: color-mix(in srgb, var(--dws-accent) 46%, transparent);
  color: var(--dws-ink);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--dws-accent) 12%, transparent);
  transform: translateY(-1px);
}

.dws-history-tabs button:disabled {
  cursor: default;
  opacity: 0.45;
  transform: none;
}

.dws-history-tabs button > i {
  color: currentColor;
  font-size: 0.62rem;
  transition: color 0.22s ease;
}

.dws-history-tabs button.is-on > i {
  color: var(--dws-accent);
}

.dws-history-tabs strong {
  overflow: hidden;
  color: inherit;
  font-size: 0.6rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-history-tabs em {
  display: grid;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  place-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--dws-accent) 10%, transparent);
  color: #a99cff;
  font: 700 0.52rem/1 monospace;
  transition:
    background-color 0.22s ease,
    color 0.22s ease;
}

.dws-history-tabs button.is-on em {
  background: color-mix(in srgb, var(--dws-accent) 18%, transparent);
}

.dws-history-panel-enter-active,
.dws-history-panel-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.dws-history-panel-enter-from,
.dws-history-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.dws-history-panel-enter-to,
.dws-history-panel-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.dws-version-history {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dws-version-families {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 2px 0;
  overflow: hidden;
}

.dws-version-family {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  align-items: stretch;
  flex: 0 0 236px;
  width: 236px;
  max-width: 236px;
  min-width: 0;
  height: 64px;
  border: 0;
  border-radius: 12px;
  background: color-mix(in srgb, var(--dws-fill) 88%, transparent);
  color: var(--dws-muted);
  overflow: hidden;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.dws-version-family:hover,
.dws-version-family.is-on {
  color: var(--dws-ink);
  background: color-mix(in srgb, var(--dws-fill) 96%, var(--dws-accent) 5%);
}

.dws-version-family:hover {
  transform: translateY(-1px);
}

.dws-version-family.is-on {
  background: color-mix(in srgb, var(--dws-accent) 12%, var(--dws-fill));
  box-shadow: 0 8px 20px color-mix(in srgb, var(--dws-accent) 14%, transparent);
}

.dws-family-main,
.dws-family-detail {
  border: 0;
  outline: 0;
  box-shadow: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dws-family-main {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 6px 4px 6px 6px;
  text-align: left;
}

.dws-family-detail {
  display: grid;
  place-items: center;
  color: var(--dws-muted);
  transition: color 0.15s ease, background-color 0.15s ease;
}

.dws-family-detail:hover {
  background: color-mix(in srgb, var(--dws-accent) 10%, transparent);
  color: var(--dws-ink);
}

.dws-family-detail > i {
  font-size: 1.15rem;
  line-height: 1;
}

.dws-family-thumb {
  display: grid;
  width: 70px;
  height: 52px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: #111119;
  box-shadow: none;
  overflow: hidden;
}

.dws-family-thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 0;
  box-shadow: none;
}

.dws-family-meta {
  display: grid;
  gap: 6px;
  min-width: 0;
  align-content: center;
}

.dws-family-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.dws-family-head strong {
  flex: none;
  color: var(--dws-ink);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
}

.dws-family-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.dws-family-tags em {
  flex: none;
  color: var(--dws-faint);
  font: 500 0.58rem/1 system-ui, sans-serif;
  font-style: normal;
  white-space: nowrap;
}

.dws-family-tags em.is-analyzed {
  color: color-mix(in srgb, var(--dws-accent) 72%, var(--dws-ink));
}

.dws-family-devices {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.dws-family-device {
  flex: none;
  color: var(--dws-muted);
  font-size: 0.95rem;
  line-height: 1;
}

.dws-version-family.is-on .dws-family-device {
  color: var(--dws-ink);
}

.dws-family-empty-device {
  color: var(--dws-faint);
  font-size: 0.58rem;
}

.dws-inline-iterations {
  display: flex;
  align-items: center;
  gap: 5px;
}

.dws-inline-iterations > i {
  color: var(--dws-faint);
  font-size: 0.72rem;
}

.dws-inline-iterations button {
  position: relative;
  flex: none;
  width: 66px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: #101016;
  cursor: pointer;
  overflow: hidden;
  opacity: 0.66;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.dws-inline-iterations button:hover {
  opacity: 1;
  transform: translateY(-1px);
}

.dws-inline-iterations button.is-on {
  opacity: 1;
  box-shadow:
    0 0 0 2px var(--dws-accent),
    0 5px 14px rgba(109, 92, 255, 0.26);
}

.dws-inline-iterations :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-inline-iterations em {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(9, 9, 13, 0.78);
  color: #cdc5ff;
  font: 700 0.52rem/1.2 monospace;
}

.dws-versions-skeleton {
  display: flex;
  gap: 9px;
}

.dws-versions-skeleton i {
  width: 236px;
  height: 62px;
  border-radius: 10px;
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.04) 30%,
    rgba(255, 255, 255, 0.09) 50%,
    rgba(255, 255, 255, 0.04) 70%
  );
  background-size: 220% 100%;
  animation: dws-shimmer 1.5s ease-in-out infinite;
}

.dws-editable-history {
  display: flex;
  justify-content: safe center;
  gap: 8px;
  padding: 4px 20px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
  mask-image: linear-gradient(90deg, transparent, #000 26px, #000 calc(100% - 26px), transparent);
}

.dws-editable-history > button {
  display: grid;
  grid-template-columns: 70px minmax(108px, 1fr) auto;
  align-items: center;
  gap: 9px;
  flex: 0 0 236px;
  min-width: 0;
  height: 62px;
  padding: 5px 9px 5px 5px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--dws-muted);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.dws-editable-history > button:hover {
  background: rgba(255, 255, 255, 0.085);
  color: var(--dws-ink);
  transform: translateY(-2px);
}

.dws-editable-thumb {
  display: grid;
  width: 70px;
  height: 52px;
  place-items: center;
  border-radius: 7px;
  background: #111119;
  color: #aea3ff;
  overflow: hidden;
}

.dws-editable-thumb :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-editable-meta {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.dws-editable-meta strong,
.dws-editable-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-editable-meta strong {
  font-size: 0.7rem;
  font-weight: 600;
}

.dws-editable-meta small {
  color: var(--dws-faint);
  font-size: 0.6rem;
}

.dws-editable-history > button > i {
  color: var(--dws-faint);
  font-size: 0.68rem;
}

.dws-analysis-history-empty {
  display: flex;
  align-items: center;
  gap: 9px;
  width: min(360px, calc(100% - 40px));
  min-height: 58px;
  padding: 8px 12px;
  border: 1px dashed color-mix(in srgb, var(--dws-ink) 14%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--dws-fill) 58%, transparent);
  color: var(--dws-faint);
}

.dws-analysis-history-empty > i {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dws-accent) 12%, transparent);
  color: var(--dws-accent);
}

.dws-analysis-history-empty > span {
  display: grid;
  gap: 3px;
}

.dws-analysis-history-empty strong {
  color: var(--dws-ink);
  font-size: 0.64rem;
  font-weight: 650;
}

.dws-analysis-history-empty small {
  font-size: 0.56rem;
}

@keyframes dws-shimmer {
  to {
    background-position: -120% 0;
  }
}

/* ————— 焦点可见性 ————— */
.dws-devices button:focus-visible,
.dws-scheme button:focus-visible,
.dws-specification-toggle:focus-visible,
.dws-state-options button:focus-visible,
.dws-count button:focus-visible,
.dws-composer-add:focus-visible,
.dws-composer-clear:focus-visible,
.dws-composer-refs > article > button:focus-visible,
.dws-generate:focus-visible,
.dws-stage-actions button:focus-visible,
.dws-artboard.is-previewable:focus-visible,
.dws-history-tabs button:focus-visible,
.dws-version-families button:focus-visible,
.dws-editable-history button:focus-visible,
.dws-inline-iterations button:focus-visible,
.dws-quality-header button:focus-visible,
.dws-quality-modes button:focus-visible,
.dws-quality-issues button:focus-visible,
.dws-quality-footer button:focus-visible,
.dws-quality-inline-empty button:focus-visible,
.dws-region-review button:focus-visible,
.dws-region-box button:focus-visible {
  outline: 2px solid var(--dws-accent-2);
  outline-offset: 2px;
}

/* ————— 动效 ————— */
.spin {
  animation: dws-spin 1s linear infinite;
}

@keyframes dws-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dws-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@keyframes dws-scan {
  0% {
    background-position: 0 130%;
  }
  100% {
    background-position: 0 -130%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dws,
  .dws-stage-ambient,
  .dws-artboard,
  .dws-page-type-picker,
  .dws-config-picker,
  .dws-quality-dialog,
  .dws-history-tabs button,
  .dws-history-panel-enter-active,
  .dws-history-panel-leave-active {
    transition: none;
    animation: none;
  }

  .dws-history-tabs button:hover:not(:disabled),
  .dws-history-tabs button.is-on {
    transform: none;
  }

  .dws-history-panel-enter-from,
  .dws-history-panel-leave-to,
  .dws-history-panel-enter-to,
  .dws-history-panel-leave-from {
    opacity: 1;
    transform: none;
  }

  .dws-running-scan,
  .dws-running i,
  .dws-empty-sketch span,
  .dws-versions-skeleton i,
  .dws-quality-orbit,
  .dws-quality-loading > div i {
    animation: none;
  }

  .dws-version-family:hover,
  .dws-editable-history > button:hover,
  .dws-inline-iterations button:hover {
    transform: none;
  }
}

/* ————— 响应式 ————— */
@media (max-width: 1080px) {
  .dws {
    height: calc(100dvh - var(--app-header-offset, 64px));
    min-height: 0;
    overflow: hidden;
  }

  .dws-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 48px minmax(0, 1fr);
    height: calc(100dvh - var(--app-header-offset, 64px));
    min-height: 0;
  }

  .dws-shell::before {
    background-position: center top;
    transform-origin: 50% 0;
  }

  .dws-tablet-tabs {
    z-index: 8;
    display: grid;
    grid-row: 1;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: #0c0c13;
  }

  .dws-tablet-tabs button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-width: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--dws-faint);
    font-size: 0.74rem;
    cursor: pointer;
  }

  .dws-tablet-tabs button.is-on {
    background: var(--dws-fill-hover);
    color: #fff;
  }

  .dws-tablet-tabs button.is-on i {
    color: #bdb3ff;
  }

  .dws-tablet-tabs em {
    display: grid;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    place-items: center;
    border-radius: 5px;
    background: var(--dws-accent-soft);
    color: #c9c1ff;
    font: 700 0.58rem/1 monospace;
    font-style: normal;
  }

  .dws-panel,
  .dws-stage {
    grid-row: 2;
    grid-column: 1;
    min-height: 0;
    order: initial;
  }

  .dws-panel {
    align-self: stretch;
    height: 100%;
    max-height: 100%;
    margin: 0;
    padding: 16px 16px 0;
    border: 0;
    border-radius: 0;
    background: #0e0e16;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .dws-stage {
    height: 100%;
  }

  .dws.is-tablet-controls .dws-stage,
  .dws.is-tablet-canvas .dws-panel {
    display: none;
  }

  .dws-generate-dock {
    margin: 0 -16px;
    padding: 10px 16px 14px;
  }

  .dws-canvas {
    padding-top: 64px;
  }

  .dws-stage-actions button span {
    display: none;
  }

  .dws-stage-actions button {
    padding: 8px 10px;
  }
}

@media (max-width: 767px) {
  .dws-history-tabs {
    width: 212px;
    gap: 5px;
  }

  .dws-history-tabs button {
    min-height: 30px;
    padding: 0 7px;
  }

  .dws-quality-layer {
    padding: 10px;
  }

  .dws-quality-dialog {
    max-height: calc(100dvh - 20px);
  }

  .dws-quality-strengths ul {
    grid-template-columns: 1fr;
  }

  .dws-quality-dimensions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dws-quality-comparison {
    grid-template-columns: 52px minmax(0, 1fr);
  }

  .dws-quality-comparison ul {
    grid-column: 1 / -1;
  }

  .dws-region-review-body {
    grid-template-columns: 1fr;
  }

  .dws-region-review figure {
    max-height: 170px;
  }

  .dws-quality-footer {
    align-items: stretch;
    flex-direction: column;
    padding: 12px;
  }

  .dws-quality-footer > button {
    justify-content: center;
  }

  .dws-page-type-grid,
  .dws-style-grid,
  .dws-brand-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dws-config-picker .dws-spec-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dws-config-picker .dws-spec-grid .is-wide {
    grid-column: span 2;
  }

  .dws-spec-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dws-config-picker .dws-state-options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dws-tablet-tabs {
    padding-inline: 10px;
  }

  .dws-panel {
    padding-inline: 12px;
  }

  .dws-generate-dock {
    margin-inline: -12px;
    padding-inline: 12px;
  }

  .dws-stage-meta {
    left: 12px;
  }

  .dws-stage-actions {
    right: 12px;
  }

  .dws-stage-spec {
    display: none;
  }

  .dws-canvas {
    padding: 62px 12px 12px;
  }

  .dws-empty-sketch {
    width: min(72%, 300px);
  }
}

@media (max-width: 420px) {
  .dws-quality-header {
    grid-template-columns: minmax(0, 1fr) 34px 34px;
  }

  .dws-quality-header > em {
    display: none;
  }

  .dws-quality-result {
    padding-inline: 14px;
  }

  .dws-quality-summary {
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 12px;
  }

  .dws-quality-score {
    width: 74px;
    height: 74px;
  }

  .dws-quality-score::before {
    width: 60px;
    height: 60px;
  }

  .dws-quality-dimensions {
    grid-template-columns: 1fr;
  }

  .dws-quality-modes {
    padding-inline: 12px;
  }

  .dws-quality-modes button {
    gap: 5px;
  }

  .dws-quality-modes button > i {
    display: none;
  }

  .dws-quality-issues > header {
    align-items: flex-start;
    gap: 8px;
  }

  .dws-page-type-header,
  .dws-config-header {
    grid-template-columns: minmax(0, 1fr) 32px;
  }

  .dws-page-type-header > em,
  .dws-config-header > em {
    display: none;
  }

  .dws-page-type-grid,
  .dws-style-grid,
  .dws-brand-grid,
  .dws-config-picker .dws-spec-grid {
    grid-template-columns: 1fr;
  }

  .dws-config-picker .dws-spec-grid .is-wide {
    grid-column: auto;
  }

  .dws-page-type-grid > button {
    min-height: 104px;
  }

  .dws-stage-meta span {
    display: none;
  }

  .dws-spec-grid {
    grid-template-columns: 1fr;
  }

  .dws-spec-grid .is-wide {
    grid-column: auto;
  }
}

/* Light appearance */
.dws.is-light {
  --dws-bg: #f2f3f7;
  --dws-ink: rgba(27, 29, 42, 0.96);
  --dws-muted: rgba(43, 45, 60, 0.66);
  --dws-faint: rgba(47, 49, 65, 0.43);
  --dws-fill: rgba(34, 36, 50, 0.055);
  --dws-fill-hover: rgba(34, 36, 50, 0.09);
  --dws-fill-deep: rgba(34, 36, 50, 0.035);
  --dws-accent: #6250e8;
  --dws-accent-2: #7564ee;
  --dws-accent-soft: rgba(98, 80, 232, 0.12);
  color-scheme: light;
}

.dws.is-light .dws-shell {
  background-color: #f3f4f8;
  background-image:
    linear-gradient(rgba(35, 37, 52, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(35, 37, 52, 0.035) 1px, transparent 1px);
}

.dws.is-light .dws-shell::before {
  background-image:
    linear-gradient(color-mix(in srgb, var(--dws-brand) 12%, transparent) 1px, transparent 1px),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--dws-brand) 12%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(rgba(35, 37, 52, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(35, 37, 52, 0.035) 1px, transparent 1px);
}

.dws.is-light .dws-panel {
  background:
    linear-gradient(180deg, rgba(98, 80, 232, 0.05), transparent 24%), rgba(255, 255, 255, 0.88);
  box-shadow: 0 22px 60px rgba(48, 44, 78, 0.1);
  scrollbar-color: rgba(98, 80, 232, 0.28) transparent;
}

.dws.is-light .dws-engine-icon {
  color: #6250e8;
}

.dws.is-light .dws-engine-control :deep(.ratio-select__trigger),
.dws.is-light .dws-engine-control :deep(.ratio-select__trigger:hover),
.dws.is-light .dws-engine-control :deep(.ratio-select__trigger:focus-visible),
.dws.is-light .dws-engine-control :deep(.ratio-select.is-open .ratio-select__trigger) {
  background: var(--dws-fill);
  color: var(--dws-ink);
}

.dws.is-light .dws-empty-editor {
  color: #6250e8;
}

.dws.is-light .dws-composer {
  background: #eceef5;
}

.dws.is-light .dws-composer:focus-within {
  background: color-mix(in srgb, #6250e8 6%, #eceef5);
}

.dws.is-light .dws-composer.is-dragging {
  background: color-mix(in srgb, #6250e8 9%, #eceef5);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #6250e8 40%, transparent);
}

.dws.is-light .dws-composer-iteration {
  background: color-mix(in srgb, #6250e8 10%, #ffffff);
}

.dws.is-light .dws-iteration-guide {
  background: color-mix(in srgb, #6250e8 8%, #ffffff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #6250e8 22%, transparent);
}

.dws.is-light .dws-iteration-guide > header small {
  color: #6250e8;
}

.dws.is-light .dws-iteration-exit {
  background: rgba(35, 37, 52, 0.06);
}

.dws.is-light .dws-iteration-guide li b {
  background: color-mix(in srgb, #6250e8 16%, transparent);
  color: #4e3bd0;
}

.dws.is-light .dws-iteration-lock,
.dws.is-light .dws-iteration-device {
  background: rgba(35, 37, 52, 0.04);
}

.dws.is-light .dws-iteration-lock i,
.dws.is-light .dws-iteration-device i {
  color: #6250e8;
}

.dws.is-light .dws-composer-add {
  border-color: color-mix(in srgb, #7b6cf0 55%, transparent);
  background: color-mix(in srgb, #7b6cf0 10%, #ffffff);
  color: #6b5ce6;
}

.dws.is-light .dws-composer-add:hover:not(:disabled) {
  border-color: #6b5ce6;
  background: color-mix(in srgb, #7b6cf0 14%, #ffffff);
  color: #4e3bd0;
}

.dws.is-light .dws-composer-clear {
  background: rgba(35, 37, 52, 0.07);
  color: #8a8d9a;
}

.dws.is-light .dws-panel-scroll {
  scrollbar-color: rgba(98, 80, 232, 0.28) transparent;
}

.dws.is-light .dws-generate-dock {
  background: linear-gradient(180deg, transparent, rgba(243, 244, 248, 0.98) 28%);
  border-top-color: rgba(35, 37, 52, 0.06);
}

.dws.is-light .dws-stage-ambient {
  background:
    radial-gradient(
      58% 46% at 50% 43%,
      color-mix(in srgb, var(--dws-brand) 8%, transparent),
      transparent 74%
    ),
    linear-gradient(to bottom, transparent 42%, rgba(70, 67, 90, 0.04) 100%);
}

.dws.is-light .dws-stage-meta,
.dws.is-light .dws-stage-actions,
.dws.is-light .dws-stage-spec span {
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 8px 24px rgba(48, 44, 78, 0.09);
}

.dws.is-light .dws-stage-meta em,
.dws.is-light .dws-history-tabs em,
.dws.is-light .dws-stage-actions button.is-editor {
  color: #6250e8;
}

.dws.is-light .dws-history-tabs button {
  border-color: rgba(35, 37, 52, 0.1);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 4px 12px rgba(48, 44, 78, 0.05);
}

.dws.is-light .dws-history-tabs button:hover:not(:disabled) {
  border-color: rgba(35, 37, 52, 0.16);
  background: #ffffff;
}

.dws.is-light .dws-history-tabs button.is-on {
  border-color: color-mix(in srgb, #6250e8 48%, transparent);
  background: color-mix(in srgb, #6250e8 10%, #ffffff);
  box-shadow: 0 8px 18px rgba(98, 80, 232, 0.12);
}

.dws.is-light .dws-stage-actions button:hover:not(:disabled),
.dws.is-light .dws-empty-editor:hover:not(:disabled) {
  color: #4e3bd0;
}

.dws.is-light .dws-artboard {
  border: 1px solid rgba(35, 37, 52, 0.09);
  background: #ffffff;
  box-shadow:
    0 30px 80px rgba(48, 44, 78, 0.14),
    0 8px 28px color-mix(in srgb, var(--dws-brand) 10%, transparent);
}

.dws.is-light .dws-artboard.is-previewable:hover {
  box-shadow:
    0 34px 90px rgba(48, 44, 78, 0.18),
    0 0 0 1px rgba(98, 80, 232, 0.22),
    0 10px 32px color-mix(in srgb, var(--dws-brand) 14%, transparent);
}

.dws.is-light .dws-artboard :deep(.authenticated-image) {
  background: #eef0f5;
}

.dws.is-light .dws-empty {
  background: radial-gradient(60% 60% at 50% 42%, rgba(98, 80, 232, 0.06), transparent 78%);
}

.dws.is-light .dws-empty-sketch {
  border-color: rgba(35, 37, 52, 0.09);
  background: rgba(35, 37, 52, 0.025);
}

.dws.is-light .dws-empty-sketch > header,
.dws.is-light .dws-empty-sketch aside {
  border-color: rgba(35, 37, 52, 0.075);
}

.dws.is-light .dws-empty-sketch > header > span,
.dws.is-light .dws-empty-sketch > header > b,
.dws.is-light .dws-empty-sketch aside i,
.dws.is-light .dws-empty-content > span,
.dws.is-light .dws-empty-content > section i {
  background: rgba(35, 37, 52, 0.09);
}

.dws.is-light .dws-empty-sketch .is-hero {
  background: color-mix(in srgb, var(--dws-brand) 18%, rgba(35, 37, 52, 0.05));
}

.dws.is-light .dws-version-families,
.dws.is-light .dws-editable-history {
  scrollbar-color: rgba(98, 80, 232, 0.3) transparent;
}

.dws.is-light .dws-version-family,
.dws.is-light .dws-inline-iterations button,
.dws.is-light .dws-editable-history > button {
  border: 0;
  background: #ffffff;
  color: var(--dws-ink);
  box-shadow: 0 8px 20px rgba(48, 44, 78, 0.07);
}

.dws.is-light .dws-version-family:hover {
  background: #ffffff;
  box-shadow: 0 10px 22px rgba(48, 44, 78, 0.1);
}

.dws.is-light .dws-version-family.is-on {
  background: color-mix(in srgb, #6250e8 8%, #ffffff);
  box-shadow: 0 10px 22px rgba(98, 80, 232, 0.12);
}

.dws.is-light .dws-history-page {
  border-color: rgba(35, 37, 52, 0.1);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 12px rgba(48, 44, 78, 0.06);
}

.dws.is-light .dws-device-rail > button {
  border-color: rgba(35, 37, 52, 0.1);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 6px 16px rgba(48, 44, 78, 0.07);
}

.dws.is-light .dws-device-rail > button.is-on {
  border-color: color-mix(in srgb, #6250e8 48%, transparent);
  background: color-mix(in srgb, #6250e8 10%, #ffffff);
}

.dws.is-light .dws-multi-frame {
  background: #ffffff;
  box-shadow: 0 16px 40px rgba(48, 44, 78, 0.12);
}

.dws.is-light .dws-family-detail:hover {
  background: color-mix(in srgb, #6250e8 8%, #ffffff);
}

.dws.is-light .dws-versions-skeleton i {
  background: linear-gradient(
    110deg,
    rgba(35, 37, 52, 0.04) 30%,
    rgba(35, 37, 52, 0.1) 50%,
    rgba(35, 37, 52, 0.04) 70%
  );
  background-size: 220% 100%;
}

@media (max-width: 1080px) {
  .dws.is-light .dws-tablet-tabs,
  .dws.is-light .dws-panel {
    border-color: rgba(35, 37, 52, 0.09);
    background: #f8f8fb;
  }

  .dws.is-light .dws-tablet-tabs button.is-on {
    color: var(--dws-ink);
  }

  .dws.is-light .dws-tablet-tabs button.is-on i {
    color: #6250e8;
  }
}
</style>
