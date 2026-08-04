<script setup>
// UI 设计稿工作台 · 沉浸版
// 布局语言：无边框、填充式控件，层级靠底色深浅与间距；左栏固定节奏直排参数，
// 右侧为无框画布，操作与元信息浮于画布之上；环境光随品牌主色变化。
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import WallevenImagePreview from '@/components/common/WallevenImagePreview.vue'
import InsufficientCreditsDialog from '@/features/ai-shared/InsufficientCreditsDialog.vue'
import AspectRatioSelect from '@/features/ai-wallpaper/components/AspectRatioSelect.vue'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import AiDesignCanvas from '@/features/design-workshop/components/AiDesignCanvas.vue'
import {
  ACTIVE_DESIGN_ANALYSIS_KEY,
  ACTIVE_DESIGN_ANALYSIS_VERSION,
} from '@/features/design-workshop/aiDesignDocument'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import {
  getScopedLocalItem,
  removeScopedLocalItem,
  setScopedLocalItem,
} from '@/services/scopedLocalStorage'
import { readImageFile } from '@/features/design-workshop/imageWorkshop'
import { takePendingPrompt } from '@/features/creator-hub/studioTools'
import { useAppearanceStore } from '@/stores/appearance'

const appearanceStore = useAppearanceStore()

const SETTINGS_KEY = 'ui-design-workshop-v2'
const EDITABLE_HISTORY_KEY = 'ui-editable-document-history-v1'
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

const DEVICE_OPTIONS = [
  {
    id: 'web',
    label: 'Web 网页',
    icon: 'bi-window-fullscreen',
    ratio: '16:9',
    prompt: '桌面端网页界面（1440px 宽度、12 列栅格）',
  },
  {
    id: 'tablet',
    label: '平板',
    icon: 'bi-tablet-landscape',
    ratio: '4:3',
    prompt: '平板端界面（横屏布局、支持双栏结构）',
  },
]

const PAGE_TYPE_OPTIONS = [
  {
    id: 'landing',
    label: '落地页',
    prompt: '产品落地页：首屏 Hero、卖点分区、客户证言、定价表与页脚',
  },
  {
    id: 'dashboard',
    label: '仪表盘',
    prompt: '数据仪表盘：侧边导航、KPI 指标卡、趋势图表与明细数据表格',
  },
  {
    id: 'ecommerce',
    label: '电商页面',
    prompt: '电商页面：商品主图、价格与规格选择、购买按钮、评价与推荐位',
  },
  { id: 'feed', label: '信息流', prompt: '信息流页面：顶部导航、内容卡片流、互动按钮与底部标签栏' },
  { id: 'auth', label: '登录注册', prompt: '登录/注册页：品牌展示区、表单、第三方登录与协议说明' },
  {
    id: 'settings',
    label: '设置页',
    prompt: '设置页面：分组设置列表、开关与输入控件、账号与危险操作区',
  },
  { id: 'profile', label: '个人中心', prompt: '个人中心页：头像资料卡、数据统计、功能入口列表' },
  { id: 'chat', label: '聊天对话', prompt: '即时通讯界面：会话列表、消息气泡、输入框与工具栏' },
  { id: 'onboarding', label: '引导页', prompt: '新用户引导页：主题插画、步骤指示器、行动按钮' },
  { id: 'custom', label: '自定义', prompt: '' },
]

const STYLE_OPTIONS = [
  { id: 'minimal', label: '极简留白', prompt: '极简主义：大量留白、克制配色、精致排版' },
  { id: 'glass', label: '玻璃拟态', prompt: '玻璃拟态：半透明磨砂卡片、柔和渐变背景、细腻高光' },
  { id: 'darkpro', label: '深色专业', prompt: '深色专业：深灰背景、高对比信息层级、克制的强调色' },
  { id: 'vibrant', label: '多彩活力', prompt: '多彩活力：明快渐变、大圆角、活泼插画点缀' },
  { id: 'corporate', label: '商务企业', prompt: '商务企业：稳重蓝灰配色、清晰栅格、正式可信' },
  { id: 'neubrutal', label: '新粗野', prompt: '新粗野主义：粗描边、硬阴影、高饱和撞色色块' },
]

const PAGE_TYPE_SELECT_OPTIONS = PAGE_TYPE_OPTIONS.map((item) => ({
  value: item.id,
  label: item.label,
  icon:
    {
      landing: 'bi-window-stack',
      dashboard: 'bi-speedometer2',
      ecommerce: 'bi-bag',
      feed: 'bi-view-list',
      auth: 'bi-person-lock',
      settings: 'bi-sliders2',
      profile: 'bi-person-circle',
      chat: 'bi-chat-dots',
      onboarding: 'bi-signpost-split',
      custom: 'bi-pencil-square',
    }[item.id] || 'bi-layout-text-window',
}))

const STYLE_SELECT_OPTIONS = STYLE_OPTIONS.map((item) => ({
  value: item.id,
  label: item.label,
  icon:
    {
      minimal: 'bi-layout-text-sidebar-reverse',
      glass: 'bi-layers',
      darkpro: 'bi-moon-stars',
      vibrant: 'bi-palette',
      corporate: 'bi-buildings',
      neubrutal: 'bi-bounding-box',
    }[item.id] || 'bi-palette',
}))

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
  { id: 'adaptive', label: '自适应', prompt: '同时定义桌面、宽屏和平板的布局重排策略' },
  { id: 'desktop-first', label: '桌面优先', prompt: '桌面端信息完整，窄屏逐级收敛并保留核心操作' },
]

const COMPONENT_STATE_OPTIONS = [
  { id: 'loading', label: '加载', prompt: '关键内容具有骨架屏或局部加载反馈' },
  { id: 'empty', label: '空状态', prompt: '核心列表或画布具有明确但克制的空状态' },
  { id: 'error', label: '错误', prompt: '表单与异步操作具有就近错误反馈和恢复入口' },
  { id: 'disabled', label: '禁用', prompt: '不可用操作具有清楚的禁用状态且不与可点击状态混淆' },
]

const BRAND_COLOR_OPTIONS = [
  { value: '#6d5cff', label: '星云紫', swatch: '#6d5cff' },
  { value: '#2f81f7', label: '科技蓝', swatch: '#2f81f7' },
  { value: '#12b76a', label: '活力绿', swatch: '#12b76a' },
  { value: '#f79009', label: '暖阳橙', swatch: '#f79009' },
  { value: '#f04438', label: '珊瑚红', swatch: '#f04438' },
  { value: '#d444f1', label: '霓虹紫', swatch: '#d444f1' },
  { value: '#0e9384', label: '青碧绿', swatch: '#0e9384' },
  { value: '#334155', label: '石墨蓝', swatch: '#334155' },
]

const BRIEF_EXAMPLES = [
  {
    label: '健身打卡 App',
    text: '一款年轻人用的健身打卡 App，首页展示今日训练计划、连续打卡天数、卡路里环形进度和好友动态',
  },
  {
    label: 'SaaS 官网',
    text: '一个面向中小团队的项目协作 SaaS 产品官网，突出任务看板、自动化流程和团队协作三个卖点',
  },
  {
    label: '咖啡外卖小程序',
    text: '精品咖啡外卖点单页面，展示招牌饮品、规格选择（杯型/温度/糖度）、优惠券入口和购物车',
  },
]

const COUNT_OPTIONS = [1, 2, 3, 4]

const {
  creditsPrompt,
  modelId,
  models,
  status,
  error: generationError,
  running,
  cancelling,
  historyLoading,
  outputs,
  activeOutput,
  outputJobIds,
  outputGroups,
  outputGroupIndexes,
  outputParents,
  initialize,
  generate: generateImage,
  cancel: cancelGeneration,
  formatCostEstimate,
} = useCreativeImageJob({
  source: 'ui-design-workshop',
  featureKey: 'ai.uiDesign',
  jobKindPrefix: 'ui-design',
  preferOriginalOutputs: true,
  outputLongSide: 2048,
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

const studioRoot = ref(null)
const fileInput = ref(null)
const briefField = ref(null)
const brief = ref('')
const iterationBrief = ref('')
const deviceId = ref('web')
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
const imageCount = ref(1)
const inputFile = ref(null)
const sourcePreview = ref('')
const iterationSource = ref('')
const localError = ref('')
const mediaError = ref('')
const promptPreviewOpen = ref(false)
const fullscreenOpen = ref(false)
const editableCanvasOpen = ref(false)
const editableGenerationNonce = ref(0)
const editableDocumentId = ref('')
const editableResumeSession = ref(readStoredActiveAnalysisSession())
const tabletPane = ref('controls')
const historyMode = ref('images')
const editableHistory = ref([])

function hasOption(options, id) {
  return options.some((item) => item.id === id)
}

try {
  const saved = JSON.parse(getScopedLocalItem(SETTINGS_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    if (typeof saved.brief === 'string') brief.value = saved.brief
    if (hasOption(DEVICE_OPTIONS, saved.deviceId)) deviceId.value = saved.deviceId
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
      componentStates.value = saved.componentStates.filter((id) =>
        COMPONENT_STATE_OPTIONS.some((item) => item.id === id),
      )
    }
    if (COUNT_OPTIONS.includes(saved.imageCount)) imageCount.value = saved.imageCount
  }
} catch {
  // Ignore a damaged local draft and keep production defaults.
}

try {
  const savedHistory = JSON.parse(getScopedLocalItem(EDITABLE_HISTORY_KEY) || '[]')
  if (Array.isArray(savedHistory) && savedHistory.length) {
    editableHistory.value = savedHistory.filter((item) => item?.referenceImage).slice(0, 12)
    if (editableHistory.value.length) historyMode.value = 'editable'
  }
} catch {
  // Ignore a damaged history index; generated image history remains available.
}

const device = computed(
  () => DEVICE_OPTIONS.find((item) => item.id === deviceId.value) || DEVICE_OPTIONS[0],
)
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
const hasReference = computed(() => Boolean(inputFile.value || iterationSource.value))
const isIteration = computed(() => Boolean(iterationSource.value))
const briefInput = computed({
  get: () => (isIteration.value ? iterationBrief.value : brief.value),
  set: (value) => {
    if (isIteration.value) iterationBrief.value = value
    else brief.value = value
  },
})
const generateActionLabel = computed(() =>
  isIteration.value ? '生成迭代稿' : inputFile.value ? '参考图重绘' : '生成设计稿',
)
const costLabel = computed(() => formatCostEstimate(imageCount.value))
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
const versionGroups = computed(() => {
  const groups = []
  const byId = new Map()
  const groupIdByOutput = new Map()
  for (const output of outputs.value) {
    const id = outputGroups.value[output] || outputJobIds.value[output] || `single:${output}`
    let group = byId.get(id)
    if (!group) {
      group = { id, outputs: [] }
      byId.set(id, group)
      groups.push(group)
    }
    group.outputs.push(output)
    groupIdByOutput.set(output, id)
  }
  for (const group of groups) {
    group.outputs.sort(
      (a, b) =>
        (Number(outputGroupIndexes.value[a]) || 0) - (Number(outputGroupIndexes.value[b]) || 0),
    )
    const parentOutput = group.outputs.map((output) => outputParents.value[output]).find(Boolean)
    const parentId = groupIdByOutput.get(parentOutput) || ''
    group.parentId = parentId && parentId !== group.id ? parentId : ''
  }
  return groups
})
const versionMetaByOutput = computed(() => {
  const metadata = {}
  const groups = versionGroups.value
  const byId = new Map(groups.map((group) => [group.id, group]))
  const childrenByParent = new Map()
  for (const group of groups) {
    if (!group.parentId || !byId.has(group.parentId)) continue
    const children = childrenByParent.get(group.parentId) || []
    children.push(group)
    childrenByParent.set(group.parentId, children)
  }
  const labels = new Map()
  const assignChildren = (parentId, parentLabel, lineage = new Set()) => {
    if (lineage.has(parentId)) return
    const nextLineage = new Set(lineage).add(parentId)
    const children = [...(childrenByParent.get(parentId) || [])].reverse()
    children.forEach((child, index) => {
      const label = `${parentLabel}.${index + 1}`
      labels.set(child.id, label)
      assignChildren(child.id, label, nextLineage)
    })
  }
  const roots = groups.filter((group) => !group.parentId || !byId.has(group.parentId)).reverse()
  roots.forEach((group, index) => {
    const label = `V${index + 1}`
    labels.set(group.id, label)
    assignChildren(group.id, label)
  })
  groups.forEach((group) => {
    const version = labels.get(group.id) || 'V?'
    group.outputs.forEach((output, outputIndex) => {
      const variant = group.outputs.length > 1 ? String.fromCharCode(65 + outputIndex) : ''
      metadata[output] = {
        version,
        variant,
        label: variant ? `${version}-${variant}` : version,
      }
    })
  })
  return metadata
})
const activeVersionLabel = computed(
  () => versionMetaByOutput.value[activeOutput.value]?.label || '',
)
// 环境光随品牌主色变化：只做低透明度的氛围渲染，控件仍使用固定强调色。
const ambientStyle = computed(() => ({ '--dws-brand': brandColor.value }))

const assembledPrompt = computed(() => {
  const lines = []
  const iterationText = iterationBrief.value.trim()
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
      `输出要求：${device.value.label} ${device.value.ratio}，正视图，整张图就是设计稿本身，不要样机、透视、倾斜、拼贴或设计软件界面。`,
    )
    return lines.join('\n')
  }
  const briefText = brief.value.trim()
  if (inputFile.value) {
    lines.push(
      `基于提供的参考界面进行重新设计：${briefText || '在保持信息结构的前提下提升视觉质量'}。`,
    )
  } else {
    lines.push(`为「${briefText || '一款现代数字产品'}」设计一张高保真 UI 设计稿。`)
  }
  lines.push(`设备载体：${device.value.prompt}。`)
  if (pageTypeId.value === 'custom') {
    const custom = customPageType.value.trim()
    if (custom) lines.push(`页面结构：${custom}。`)
  } else if (pageType.value.prompt) {
    lines.push(`页面结构：${pageType.value.prompt}。`)
  }
  lines.push(`目标用户：${audienceOption.value.prompt}。`)
  lines.push(`核心目标：${goalOption.value.prompt}。`)
  lines.push(`导航与布局：${navigationOption.value.prompt}。${densityOption.value.prompt}。`)
  lines.push(`视觉风格：${styleOption.value.prompt}。`)
  lines.push(
    `配色：主色 ${brandColor.value}，${colorScheme.value === 'dark' ? '深色' : '浅色'}模式，配套完整的中性色阶。`,
  )
  lines.push(
    `设计系统：${typographyOption.value.prompt}。${radiusOption.value.prompt}。采用 8pt 间距体系，统一按钮、输入框、卡片、菜单和反馈组件规范。`,
  )
  const selectedStates = COMPONENT_STATE_OPTIONS.filter((item) =>
    componentStates.value.includes(item.id),
  )
  if (selectedStates.length) {
    lines.push(`组件状态：${selectedStates.map((item) => item.prompt).join('；')}。`)
  }
  lines.push(`响应式策略：${responsiveOption.value.prompt}。`)
  lines.push(
    '交付标准：真实产品级布局，完整页面（含导航和内容区），清晰的字体层级与 8pt 间距体系，组件风格统一，界面文案使用简洁中文，细节可直接用于开发交付。',
  )
  lines.push(
    '文字要求：只使用需求中明确出现或与产品直接相关的简短文案，逐字清晰准确；使用现代无衬线字体，中文接近 Noto Sans SC，英文与数字接近 Inter，不要乱码、伪文字、额外标签或随机字母。',
  )
  lines.push(
    '画面要求：整张图就是设计稿本身，铺满画布。不要设备样机外壳、不要透视和倾斜、不要多页拼贴、不要展示设计软件窗口、不要水印。',
  )
  return lines.join('\n')
})

const artboardStyle = computed(() => {
  const [width = 16, height = 9] = device.value.ratio.split(':').map(Number)
  const ratio = width / Math.max(1, height)
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 220px) * ${ratio}))`,
  }
})

const editableViewport = computed(() => {
  const background = colorScheme.value === 'dark' ? '#111217' : '#ffffff'
  if (deviceId.value === 'tablet') return { width: 1024, height: 768, background }
  return { width: 1440, height: 810, background }
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
  await initialize()
  restoreActiveAnalysisSession()
  const pending = takePendingPrompt('ui_design')
  if (pending?.prompt) brief.value = pending.prompt
})

watch(activeOutput, (value) => {
  if (value) tabletPane.value = 'canvas'
})

watch(
  [
    brief,
    deviceId,
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
    imageCount,
  ],
  () => {
    setScopedLocalItem(
      SETTINGS_KEY,
      JSON.stringify({
        brief: brief.value,
        deviceId: deviceId.value,
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
        imageCount: imageCount.value,
      }),
    )
  },
  { deep: true },
)

function applyBriefExample(text) {
  brief.value = text
  localError.value = ''
}

async function chooseFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  inputFile.value = file
  sourcePreview.value = await readImageFile(file)
  iterationSource.value = ''
  iterationBrief.value = ''
  localError.value = ''
}

function clearReference() {
  inputFile.value = null
  sourcePreview.value = ''
  iterationSource.value = ''
  iterationBrief.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function iterateFromActive() {
  if (!activeOutput.value) return
  iterationSource.value = activeOutput.value
  iterationBrief.value = ''
  inputFile.value = null
  sourcePreview.value = ''
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
  const iterationBase = iterationSource.value
  tabletPane.value = 'canvas'
  const generated = await generateImage({
    prompt: assembledPrompt.value,
    file: inputFile.value,
    sourceUrl: iterationBase,
    parentOutputUrl: iterationBase,
    aspectRatio: device.value.ratio,
    platform: device.value.label,
    iterationMode: Boolean(iterationBase),
    quality: 'high',
    count: imageCount.value,
  })
  if (generated?.length && iterationBase && iterationSource.value === iterationBase) {
    clearReference()
  }
}

function openEditableCanvas() {
  localError.value = ''
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
  editableResumeSession.value = null
  editableDocumentId.value = ''
  editableGenerationNonce.value += 1
  editableCanvasOpen.value = true
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

function selectOutput(output, openPreview = false) {
  activeOutput.value = output
  tabletPane.value = 'canvas'
  mediaError.value = ''
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
  historyMode.value = 'editable'
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
          <em v-if="versionGroups.length">{{ versionGroups.length }}</em>
        </button>
      </nav>

      <aside class="dws-panel" data-studio-enter>
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

        <section class="dws-block">
          <label class="dws-label" for="dws-brief">
            {{ isIteration ? '本次迭代要求' : '产品与页面描述' }}
          </label>
          <textarea
            id="dws-brief"
            ref="briefField"
            v-model="briefInput"
            rows="4"
            maxlength="1000"
            :placeholder="
              isIteration
                ? '只描述需要修改的部分，例如：仅将主按钮改为蓝色，其余布局和文字保持不变'
                : inputFile
                  ? '描述要在参考界面基础上修改或强化的内容…'
                  : '这是一个什么产品？页面上要有什么内容？'
            "
          ></textarea>
          <div v-if="!isIteration" class="dws-examples" role="group" aria-label="灵感示例">
            <button
              v-for="example in BRIEF_EXAMPLES"
              :key="example.label"
              type="button"
              @click="applyBriefExample(example.text)"
            >
              {{ example.label }}
            </button>
          </div>
        </section>

        <section class="dws-block">
          <span class="dws-label">设备载体</span>
          <div class="dws-devices" role="group" aria-label="设备载体">
            <button
              v-for="item in DEVICE_OPTIONS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': deviceId === item.id }"
              :aria-pressed="deviceId === item.id"
              @click="deviceId = item.id"
            >
              <i class="bi" :class="item.icon" aria-hidden="true"></i>
              <span>{{ item.label }}</span>
              <small data-no-translate>{{ item.ratio }}</small>
            </button>
          </div>
        </section>

        <section class="dws-block dws-quick-settings">
          <div class="dws-select-field">
            <span class="dws-label">页面类型</span>
            <AspectRatioSelect
              v-model="pageTypeId"
              class="dws-control-select"
              :options="PAGE_TYPE_SELECT_OPTIONS"
              :show-ratio-icons="false"
              use-option-label
              compact-text
              compact-menu
              glass-menu
              menu-placement="auto"
              aria-label="页面类型"
            />
          </div>
          <div class="dws-select-field">
            <span class="dws-label">视觉风格</span>
            <AspectRatioSelect
              v-model="styleId"
              class="dws-control-select"
              :options="STYLE_SELECT_OPTIONS"
              :show-ratio-icons="false"
              use-option-label
              compact-text
              compact-menu
              glass-menu
              menu-placement="auto"
              aria-label="视觉风格"
            />
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
            <AspectRatioSelect
              v-model="brandColor"
              class="dws-control-select dws-brand-select"
              :options="BRAND_COLOR_OPTIONS"
              :show-ratio-icons="false"
              use-option-label
              compact-text
              compact-menu
              glass-menu
              :max-visible-options="3"
              menu-placement="auto"
              aria-label="品牌主色"
            />
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

        <section class="dws-block">
          <span class="dws-label">参考界面（可选）</span>
          <div v-if="iterationSource" class="dws-reference is-iteration">
            <AuthenticatedImage :src="iterationSource" alt="迭代基准版本" :max-dimension="240" />
            <div>
              <strong>基于 {{ activeVersionLabel || '当前版本' }} 迭代</strong>
              <span>仅修改明确描述的内容，其余保持不变</span>
            </div>
            <button type="button" aria-label="取消迭代" @click="clearReference">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </div>
          <div v-else-if="sourcePreview" class="dws-reference">
            <img
              :src="sourcePreview"
              alt="参考界面预览"
              loading="eager"
              decoding="async"
            />
            <div>
              <strong data-no-translate>{{ inputFile?.name }}</strong>
              <span>将基于此界面重新设计</span>
            </div>
            <button type="button" aria-label="移除参考图" @click="clearReference">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </div>
          <button v-else type="button" class="dws-upload" @click="fileInput?.click()">
            <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
            <span>导入界面截图或线框图重绘</span>
          </button>
          <input ref="fileInput" hidden type="file" accept="image/*" @change="chooseFile" />
        </section>

        <section class="dws-block dws-count-wrap">
          <span class="dws-label">生成数量</span>
          <div class="dws-count" role="group" aria-label="生成数量">
            <button
              v-for="count in COUNT_OPTIONS"
              :key="count"
              type="button"
              :class="{ 'is-on': imageCount === count }"
              :aria-pressed="imageCount === count"
              @click="imageCount = count"
            >
              {{ count }}
            </button>
          </div>
        </section>

        <details class="dws-prompt-preview" :open="promptPreviewOpen">
          <summary @click.prevent="promptPreviewOpen = !promptPreviewOpen">
            <i class="bi bi-braces" aria-hidden="true"></i>查看将要发送的完整提示词
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

        <div class="dws-generate-dock">
          <button
            class="dws-generate"
            type="button"
            :disabled="running"
            :aria-label="`${generateActionLabel}，${costLabel}`"
            @click="generate"
          >
            <span class="dws-generate-icon" aria-hidden="true">
              <i class="bi" :class="running ? 'bi-arrow-repeat spin' : 'bi-stars'"></i>
            </span>
            <span class="dws-generate-copy">
              <strong>{{ running ? status || '生成中…' : generateActionLabel }}</strong>
              <small>{{ running ? '正在创建界面结构与视觉细节' : '预计扣费' }}</small>
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
        </div>

        <div class="dws-stage-actions">
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
            :disabled="!activeOutput || running"
            title="以当前版本为基础继续修改"
            @click="iterateFromActive"
          >
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i><span>迭代此版本</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput"
            title="查看大图"
            @click="fullscreenOpen = true"
          >
            <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i><span>大图</span>
          </button>
          <button
            type="button"
            :disabled="!activeOutput"
            title="下载设计稿"
            @click="downloadActive"
          >
            <i class="bi bi-download" aria-hidden="true"></i><span>下载</span>
          </button>
        </div>

        <div class="dws-canvas">
          <div
            class="dws-artboard"
            :class="{ 'is-previewable': activeOutput && !running }"
            :style="artboardStyle"
            :role="activeOutput && !running ? 'button' : undefined"
            :tabindex="activeOutput && !running ? 0 : undefined"
            :aria-label="activeOutput && !running ? '查看当前设计稿大图' : undefined"
            @click="openActivePreview"
            @keydown.enter.prevent="openActivePreview"
            @keydown.space.prevent="openActivePreview"
          >
            <AuthenticatedImage
              v-if="activeOutput"
              data-studio-output
              :src="activeOutput"
              alt="UI 设计稿预览"
              loading="eager"
              :retry-count="2"
              @error="mediaError = '图片加载失败，请切换版本或重新生成'"
            />
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
              <span>{{ device.label }} · {{ device.ratio }} · {{ pageType.label }}</span>
            </div>
            <div v-if="running" class="dws-running" aria-live="polite">
              <span class="dws-running-scan" aria-hidden="true"></span>
              <i class="bi bi-stars" aria-hidden="true"></i>
              <strong>{{ cancelling ? '正在停止生成任务' : status || '正在生成设计稿…' }}</strong>
              <span>{{
                cancelling ? '正在同步云端任务状态' : '正在组织布局、组件与视觉层级'
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
                {{ cancelling ? '正在停止' : '停止生成' }}
              </button>
            </div>
          </div>
        </div>

        <p v-if="mediaError" class="dws-error is-stage" role="alert">{{ mediaError }}</p>

        <footer
          v-if="outputs.length || historyLoading || editableHistory.length"
          class="dws-versions-wrap"
          aria-label="历史记录"
        >
          <div class="dws-history-tabs" role="tablist" aria-label="历史记录类型">
            <button
              type="button"
              role="tab"
              :class="{ 'is-on': historyMode === 'images' }"
              :aria-selected="historyMode === 'images'"
              @click="historyMode = 'images'"
            >
              版本 <em>{{ versionGroups.length }}</em>
            </button>
            <button
              v-if="editableHistory.length"
              type="button"
              role="tab"
              :class="{ 'is-on': historyMode === 'editable' }"
              :aria-selected="historyMode === 'editable'"
              @click="historyMode = 'editable'"
            >
              分析记录 <em>{{ editableHistory.length }}</em>
            </button>
          </div>
          <div v-if="historyMode === 'images'" class="dws-versions" role="tabpanel">
            <button
              v-for="output in outputs"
              :key="output"
              type="button"
              :class="{ 'is-on': activeOutput === output }"
              :aria-pressed="activeOutput === output"
              :title="`切换到 ${versionMetaByOutput[output]?.label || '历史版本'}`"
              @click="selectOutput(output)"
            >
              <AuthenticatedImage :src="output" alt="" :max-dimension="320" />
              <em data-no-translate>{{ versionMetaByOutput[output]?.label }}</em>
            </button>
            <span
              v-if="historyLoading && !outputs.length"
              class="dws-versions-skeleton"
              aria-hidden="true"
            >
              <i></i><i></i><i></i>
            </span>
          </div>
          <div v-else class="dws-editable-history" role="tabpanel">
            <button
              v-for="entry in editableHistory"
              :key="entry.id"
              type="button"
              :title="`打开分析 ${entry.name || '设计稿元素分析'}`"
              @click="openEditableHistory(entry)"
            >
              <span class="dws-editable-thumb">
                <AuthenticatedImage
                  v-if="entry.referenceImage"
                  :src="entry.referenceImage"
                  alt=""
                  :max-dimension="320"
                />
                <i v-else class="bi bi-bezier2" aria-hidden="true"></i>
              </span>
              <span class="dws-editable-meta">
                <strong>{{ entry.name || '设计稿元素分析' }}</strong>
                <small>
                  {{ entry.nodeCount || 0 }} 个图层 ·
                  {{ formatEditableHistoryDate(entry.updatedAt) }}
                </small>
              </span>
              <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
            </button>
          </div>
        </footer>
      </section>
    </div>

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
      :viewport="editableViewport"
      :generation-nonce="editableGenerationNonce"
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
  align-self: start;
  box-sizing: border-box;
  overflow-y: auto;
  max-height: calc(100% - 24px);
  margin: 12px 0 12px 12px;
  padding: 20px 18px 0;
  border: 0;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 24%), rgba(15, 16, 24, 0.58);
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.34);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  backdrop-filter: blur(20px) saturate(120%);
}

.dws-block {
  margin-top: 17px;
}

.dws-panel > .dws-block:first-child {
  margin-top: 0;
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

/* 输入类：填充面，无边框，聚焦时才出现强调环 */
.dws-block textarea,
.dws-custom-structure {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
  color: var(--dws-ink);
  font: inherit;
  outline: none;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.dws-block textarea {
  padding: 12px 13px;
  font-size: 0.83rem;
  line-height: 1.6;
  resize: vertical;
}

.dws-block textarea:hover,
.dws-custom-structure:hover {
  background: var(--dws-fill-hover);
}

.dws-block textarea:focus,
.dws-custom-structure:focus {
  background: var(--dws-fill-hover);
  box-shadow: 0 0 0 1.5px rgba(109, 92, 255, 0.55);
}

.dws-block textarea::placeholder,
.dws-custom-structure::placeholder {
  color: var(--dws-faint);
}

.dws-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.dws-examples button {
  padding: 5px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dws-faint);
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.dws-examples button:hover {
  background: var(--dws-fill);
  color: #cdc5ff;
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

.dws-quick-settings .dws-custom-structure {
  grid-column: 1 / -1;
  margin-top: 0;
}

/* 选择类：等宽格子，选中为实色强调 */
.dws-devices {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  padding: 4px;
  border-radius: calc(var(--dws-radius) + 3px);
  background: var(--dws-fill-deep);
}

.dws-devices button {
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 10px 2px 8px;
  border: 0;
  border-radius: 10px;
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
  font-size: 1rem;
}

.dws-devices button span {
  font-size: 0.68rem;
  white-space: nowrap;
}

.dws-devices button small {
  color: var(--dws-faint);
  font: 600 0.6rem/1 monospace;
}

.dws-devices button.is-on {
  background: var(--dws-accent);
  color: #fff;
  box-shadow: 0 6px 18px rgba(109, 92, 255, 0.35);
}

.dws-devices button.is-on small {
  color: rgba(255, 255, 255, 0.75);
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

/* 参考界面 */
.dws-reference {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 9px;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
}

.dws-reference.is-iteration {
  background: var(--dws-accent-soft);
}

.dws-reference img,
.dws-reference :deep(.authenticated-image) {
  width: 56px;
  height: 42px;
  border-radius: 8px;
  object-fit: cover;
}

.dws-reference strong {
  display: block;
  overflow: hidden;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dws-reference span {
  display: block;
  margin-top: 3px;
  color: var(--dws-faint);
  font-size: 0.67rem;
}

.dws-reference > button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  color: var(--dws-muted);
  cursor: pointer;
}

.dws-reference > button:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.dws-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 48px;
  border: 0;
  border-radius: var(--dws-radius);
  background: var(--dws-fill);
  color: var(--dws-muted);
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.dws-upload:hover {
  background: var(--dws-fill-hover);
  color: #cdc5ff;
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

/* 生成按钮：吸底渐隐坞 */
.dws-generate-dock {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 14px -18px 0;
  padding: 12px 18px 14px;
  background: linear-gradient(180deg, transparent, rgba(10, 10, 16, 0.9) 34%);
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

.dws-artboard :deep(.authenticated-image) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0d0d12;
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

/* 历史：悬浮胶片条，无分隔线 */
.dws-versions-wrap {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  padding: 4px 0 14px;
}

.dws-history-tabs {
  display: flex;
  justify-content: center;
  gap: 2px;
  margin-bottom: 2px;
}

.dws-history-tabs button {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dws-faint);
  font-size: 0.66rem;
  cursor: pointer;
}

.dws-history-tabs button:hover,
.dws-history-tabs button.is-on {
  background: var(--dws-fill);
  color: var(--dws-ink);
}

.dws-history-tabs em {
  color: #a99cff;
  font: 700 0.58rem/1 monospace;
}

.dws-versions {
  display: flex;
  justify-content: safe center;
  gap: 9px;
  padding: 4px 20px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
  mask-image: linear-gradient(90deg, transparent, #000 26px, #000 calc(100% - 26px), transparent);
}

.dws-versions button {
  position: relative;
  flex: none;
  width: 104px;
  height: 66px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #101016;
  cursor: pointer;
  overflow: hidden;
  opacity: 0.62;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.dws-versions button:hover {
  opacity: 1;
  transform: translateY(-3px);
}

.dws-versions button.is-on {
  opacity: 1;
  box-shadow:
    0 0 0 2px var(--dws-accent),
    0 8px 22px rgba(109, 92, 255, 0.3);
}

.dws-versions :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dws-versions em {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(9, 9, 13, 0.78);
  color: #cdc5ff;
  font: 700 0.6rem/1.4 monospace;
}

.dws-versions-skeleton {
  display: flex;
  gap: 9px;
}

.dws-versions-skeleton i {
  width: 104px;
  height: 66px;
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

@keyframes dws-shimmer {
  to {
    background-position: -120% 0;
  }
}

/* ————— 焦点可见性 ————— */
.dws-devices button:focus-visible,
.dws-scheme button:focus-visible,
.dws-count button:focus-visible,
.dws-examples button:focus-visible,
.dws-upload:focus-visible,
.dws-generate:focus-visible,
.dws-stage-actions button:focus-visible,
.dws-artboard.is-previewable:focus-visible,
.dws-history-tabs button:focus-visible,
.dws-editable-history button:focus-visible,
.dws-versions button:focus-visible {
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
  .dws-artboard {
    transition: none;
  }

  .dws-running-scan,
  .dws-running i,
  .dws-empty-sketch span,
  .dws-versions-skeleton i {
    animation: none;
  }

  .dws-versions button:hover {
    transform: none;
  }
}

/* ————— 响应式 ————— */
@media (min-width: 768px) and (max-width: 1080px) {
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
    position: sticky;
    margin: 14px -16px 0;
    padding: 12px 16px 14px;
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

.dws.is-light .dws-examples button:hover,
.dws.is-light .dws-upload:hover,
.dws.is-light .dws-empty-editor,
.dws.is-light .dws-reference.is-iteration {
  color: #6250e8;
}

.dws.is-light .dws-reference > button {
  background: rgba(34, 36, 50, 0.06);
  color: var(--dws-muted);
}

.dws.is-light .dws-reference > button:hover {
  background: rgba(34, 36, 50, 0.11);
  color: var(--dws-ink);
}

.dws.is-light .dws-generate-dock {
  background: linear-gradient(180deg, transparent, rgba(243, 244, 248, 0.96) 34%);
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
.dws.is-light .dws-stage-actions {
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 8px 24px rgba(48, 44, 78, 0.09);
}

.dws.is-light .dws-stage-meta em,
.dws.is-light .dws-history-tabs em,
.dws.is-light .dws-stage-actions button.is-editor {
  color: #6250e8;
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

.dws.is-light .dws-versions,
.dws.is-light .dws-editable-history {
  scrollbar-color: rgba(98, 80, 232, 0.3) transparent;
}

.dws.is-light .dws-versions button,
.dws.is-light .dws-editable-history > button {
  border-color: rgba(35, 37, 52, 0.09);
  background: #ffffff;
  color: var(--dws-ink);
  box-shadow: 0 7px 20px rgba(48, 44, 78, 0.07);
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

@media (min-width: 768px) and (max-width: 1080px) {
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
