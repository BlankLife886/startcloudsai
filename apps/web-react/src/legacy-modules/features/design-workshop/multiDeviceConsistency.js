/**
 * Multi-device UI generation consistency helpers.
 *
 * Strategy (aligned with responsive / cross-platform design practice):
 * 1. Canonical wide device first (web → tablet → tv → phone → miniapp).
 * 2. Shared content lock: copy, modules, and sample data stay identical.
 * 3. Device-only reflow: navigation, columns, density — not a new product.
 * 4. Job pipeline: first successful output becomes the series visual anchor.
 */

export const UI_SERIES_ANCHOR_ROLE =
  '系列视觉锚点（继承品牌色、组件语言、图标/插画风格与全部文案数据；仅按当前设备重排布局与导航，禁止另起一套内容或数据）'

const DEVICE_PRIORITY = {
  web: 0,
  tablet: 1,
  tv: 2,
  phone: 3,
  miniapp: 4,
}

const COMPACT_DEVICE_IDS = new Set(['phone', 'miniapp'])

/** Device-native layout / navigation rules (explicit constraints, not aesthetics). */
const DEVICE_ADAPTATION = {
  web: {
    columns: 12,
    margin: 80,
    gutter: 24,
    typeScale: '12 / 14 / 16 / 20 / 24 / 32',
    controlHeightOffset: 0,
    carrierPrompt: '桌面端网页界面（1440px 宽度、12 列栅格、完整信息架构）',
    navigation: {
      auto: '使用顶部导航或侧边导航，保证一级入口稳定可见',
      top: '使用清晰克制的顶部导航，主要入口横向排列',
      sidebar: '使用稳定侧边导航，支持多模块和深层级工作流',
      hybrid: '使用顶部全局导航与侧边模块导航组合',
      bottom: '桌面端不要使用底部标签栏；改为顶部或侧边导航承载一级入口',
    },
    structureHint:
      '桌面端可使用多栏栅格、侧栏与数据表格；信息完整优先，避免为了“好看”删减关键模块。',
    interactionHint: '可包含 hover / focus 状态；指针操作为主。',
  },
  tablet: {
    columns: 8,
    margin: 32,
    gutter: 20,
    typeScale: '12 / 14 / 16 / 18 / 22 / 28',
    controlHeightOffset: 0,
    carrierPrompt: '平板横屏界面（1024px 宽度、8 列栅格、可双栏）',
    navigation: {
      auto: '使用顶部导航或窄侧栏+内容区双栏，避免手机底部栏照搬',
      top: '使用顶部导航，次级入口可收入分段控件或侧栏',
      sidebar: '使用较窄侧边导航+主内容区，侧栏宽度克制',
      hybrid: '顶部全局入口 + 内容区内局部导航',
      bottom: '平板优先顶部/侧栏导航；仅在强 App 场景才使用底部标签',
    },
    structureHint:
      '平板端允许双栏：主列表/主图 + 详情；宽表格可保留但行高更触控友好；不要塞满桌面级三栏。',
    interactionHint: '触控与指针兼顾；主要点击目标不小于 40px。',
  },
  phone: {
    columns: 4,
    margin: 16,
    gutter: 12,
    typeScale: '12 / 14 / 16 / 18 / 22 / 28',
    controlHeightOffset: 4,
    carrierPrompt: '手机端竖屏界面（逻辑宽 390px、9:16 单列布局）',
    navigation: {
      auto: '顶部状态栏+导航；底部标签栏文案与其他端一级导航一致',
      top: '顶部标题栏；深层入口收入抽屉或页面内入口',
      sidebar: '禁止固定侧边导航；改为底部标签或顶部抽屉',
      hybrid: '顶栏 + 底部标签；内容区单列',
      bottom: '底部标签栏文案与其他端一级导航一致',
    },
    structureHint:
      '手机端单屏主界面：侧栏→底部标签/抽屉；多栏→纵向模块流；表格→卡片列表。禁止把桌面布局硬缩小，禁止多屏拼贴。',
    interactionHint: '触控优先：主按钮与列表行高足够，目标约 44px；不要依赖 hover。',
  },
  miniapp: {
    columns: 4,
    margin: 16,
    gutter: 12,
    typeScale: '12 / 14 / 16 / 18 / 22 / 26',
    controlHeightOffset: 4,
    carrierPrompt: '微信小程序竖屏界面（逻辑宽 390px、原生顶栏节奏）',
    navigation: {
      auto: '原生顶栏；若有 tabBar，放在底部，文案与其他端一级导航一致',
      top: '遵循小程序顶栏标题区，页面内提供次级入口',
      sidebar: '禁止侧边导航；改为 tabBar 或页面列表入口',
      hybrid: '顶栏 + tabBar；中间为内容区',
      bottom: '底部 tabBar 文案与其他端一级导航一致',
    },
    structureHint:
      '小程序单屏主界面：单列卡片流、原生组件节奏；表格改为列表卡；不要多页拼贴。',
    interactionHint: '触控目标充足；避免复杂 hover。',
  },
  tv: {
    columns: 12,
    margin: 96,
    gutter: 32,
    typeScale: '16 / 20 / 24 / 32 / 40 / 56',
    controlHeightOffset: 12,
    carrierPrompt: '智能电视 / 大屏界面（1920×1080、10-foot UI、焦点导航）',
    navigation: {
      auto: '使用左侧或顶部焦点导航，焦点态清晰，适合遥控器移动',
      top: '顶部焦点导航，条目间距更大',
      sidebar: '左侧焦点导航 + 主内容区大卡片',
      hybrid: '侧栏焦点导航 + 顶区上下文标题',
      bottom: '电视端不要底部手机标签栏；改为侧栏或顶部焦点导航',
    },
    structureHint:
      '大屏：少文字、大字号、大卡片、更少同屏模块；焦点框明确；不要手机底部栏或桌面密集表格。',
    interactionHint: '遥控器焦点态（focus）优先；不依赖精细点击与 hover。',
  },
}

const PAGE_COMPACT_OVERRIDES = {
  landing:
    '移动端落地页：顶栏 → Hero → 卖点 → 证言/定价入口；不要桌面多栏营销墙原样缩放',
  dashboard:
    '移动端概览：顶栏/筛选 → 横向 KPI → 主趋势图；明细可摘要进入；不要侧边栏+多列表格同屏',
  ecommerce: '移动端商详：主图 → 价格规格 → 购买栏；详情/评价可摘要；不要桌面双栏',
  feed: '移动端信息流：顶栏 + 内容卡列表 + 底部标签',
  auth: '移动端登录：居中表单、品牌区精简、第三方登录与协议；避免左右分栏',
  settings: '移动端设置：分组列表+开关；右箭头进入子页；不要桌面双栏',
  profile: '移动端个人中心：头像资料卡 → 数据条 → 功能入口 → 底部导航',
  chat: '移动端聊天：会话列表或聊天气泡全宽、底部输入栏；避免三栏桌面布局',
  onboarding: '移动端引导：全屏插画/步骤、底部主按钮与指示点',
  workspace: '移动端工作台：顶栏 → 快捷入口宫格 → 待办/项目卡片',
  crm: '移动端 CRM：客户卡片列表、阶段筛选条、跟进入口',
  analytics: '移动端分析：筛选 → 主图 → 关键指标卡',
  admin: '移动端管理：列表+筛选 → 状态标签 → 详情入口；禁止桌面侧栏+密表同屏',
  finance: '移动端账务：资产概览 → 收支趋势 → 流水摘要',
  education: '移动端学习：课程卡 → 进度 → 章节入口',
  healthcare: '移动端健康：概览指标 → 趋势 → 服务/预约入口',
  booking: '移动端预订：条件 → 日历/时段 → 资源卡 → 价格确认',
  media: '移动端媒体：播放器/主视觉 → 推荐列表',
  portfolio: '移动端作品集：介绍 → 项目卡 → 联系入口',
}

export function orderDevicesForConsistency(devices = []) {
  return [...devices].sort(
    (a, b) =>
      (DEVICE_PRIORITY[a?.id] ?? Number.MAX_SAFE_INTEGER) -
      (DEVICE_PRIORITY[b?.id] ?? Number.MAX_SAFE_INTEGER),
  )
}

export function isCompactDevice(deviceId) {
  return COMPACT_DEVICE_IDS.has(String(deviceId || ''))
}

export function getDeviceAdaptation(deviceId) {
  return DEVICE_ADAPTATION[deviceId] || DEVICE_ADAPTATION.web
}

export function resolveNavigationPrompt(navigationId, deviceId) {
  const adaptation = getDeviceAdaptation(deviceId)
  const key = adaptation.navigation[navigationId] ? navigationId : 'auto'
  return adaptation.navigation[key]
}

export function adaptPageStructurePrompt(pageTypeId, basePrompt, deviceId) {
  const text = String(basePrompt || '').trim()
  const adaptation = getDeviceAdaptation(deviceId)
  if (isCompactDevice(deviceId)) {
    const override = PAGE_COMPACT_OVERRIDES[pageTypeId]
    if (override) return `${override}。${adaptation.structureHint}`
    if (text) return `${text}。${adaptation.structureHint}`
    return adaptation.structureHint
  }
  if (deviceId === 'tv' || deviceId === 'tablet') {
    return text ? `${text}。${adaptation.structureHint}` : adaptation.structureHint
  }
  return text || adaptation.structureHint
}

export function metricsForDeviceOption(deviceOption, { densityId = 'balanced', radiusLabel = '' } = {}) {
  const adaptation = getDeviceAdaptation(deviceOption?.id)
  const baseHeight = { compact: 32, balanced: 36, comfortable: 40 }[densityId] || 36
  return {
    columns: adaptation.columns,
    margin: adaptation.margin,
    gutter: adaptation.gutter,
    spacing: '4 / 8',
    controlHeight: baseHeight + (adaptation.controlHeightOffset || 0),
    typeScale: adaptation.typeScale,
    radius: String(radiusLabel || '').replace(/^[^\d]*/, ''),
  }
}

export function buildContentConsistencyLock({
  brief = '',
  pageTypeLabel = '',
  deviceLabels = [],
  brandColor = '',
} = {}) {
  const labels = deviceLabels.filter(Boolean).join('、')
  const briefText = String(brief || '').trim() || '（见参考图与页面类型）'
  return [
    `多端内容锁（${labels || '各端'}必须遵守）：`,
    `1. 同一产品、同一页面任务（${pageTypeLabel || '当前页面'}）：导航文案、模块标题、按钮文案、标签、示例姓名/数值/日期必须跨端逐字一致，禁止一端换一套文案或另一套假数据。`,
    '2. 模块集合一致：各端呈现同一套核心模块；窄屏可折叠/下钻次要信息，但不得替换成不同业务内容。',
    `3. 视觉系统一致：品牌主色 ${brandColor || '沿用规范'}、圆角语言、图标风格、插画主题跨端不变；只改变布局骨架与导航形态。`,
    `4. 用户需求原文（内容来源）：${briefText}`,
  ].join('\n')
}

export function buildDeviceAdaptationBlock(deviceOption, { navigationId = 'auto', pageTypeId = 'custom', pagePrompt = '', multiDevice = false, isAnchor = false } = {}) {
  const adaptation = getDeviceAdaptation(deviceOption?.id)
  const structure = adaptPageStructurePrompt(pageTypeId, pagePrompt, deviceOption?.id)
  const navigation = resolveNavigationPrompt(navigationId, deviceOption?.id)
  const lines = [
    `设备载体：${adaptation.carrierPrompt || deviceOption?.prompt}（生成画幅 ${deviceOption?.ratio}）。`,
    `页面结构（已按 ${deviceOption?.label} 适配）：${structure}`,
    `导航与布局（已按设备解析）：${navigation}。`,
    `交互约束：${adaptation.interactionHint}`,
  ]
  if (multiDevice) {
    lines.push(
      isAnchor
        ? '多端角色：你是本批的设计系统母版。后续设备会继承你的品牌色、组件语言与全部文案数据；请把信息架构和文案一次做对。'
        : '多端角色：你必须对齐系列视觉锚点（及用户参考）中的品牌色、组件、图标与文案数据；只做当前设备的响应式重排，不要重新发明产品内容。',
    )
  }
  lines.push(
    '只输出当前设备的一张完整主界面，铺满画布；不要设备样机、不要多端拼贴、不要设计软件窗口。',
  )
  return lines.join('\n')
}

export function buildCrossDeviceAdaptPrompt({
  deviceOption,
  iterationText = '',
  navigationId = 'auto',
  pageTypeId = 'custom',
  pagePrompt = '',
} = {}) {
  const adaptation = getDeviceAdaptation(deviceOption?.id)
  const structure = adaptPageStructurePrompt(pageTypeId, pagePrompt, deviceOption?.id)
  const navigation = resolveNavigationPrompt(navigationId, deviceOption?.id)
  return [
    '任务类型：跨设备布局适配，不是重新设计产品，也不是锁定原画布比例。',
    `目标设备：${deviceOption?.label} ${deviceOption?.ratio}（${adaptation.carrierPrompt}）。`,
    `适配要求：${iterationText || '在保持品牌、组件与文案数据一致的前提下，按目标设备重排布局'}。`,
    `页面结构：${structure}`,
    `导航：${navigation}`,
    '锁定：产品名、导航文案、模块标题、按钮文案、关键数据、品牌色、圆角与图标风格必须与参考稿一致。',
    '允许变化：列数、导航形态、字号阶梯、间距、模块堆叠顺序与触控尺寸。',
    '禁止：另起一套文案/数据、桌面布局硬缩放到手机、多端拼贴、设备样机外壳。',
    '画面：整张图就是目标设备的设计稿本身，正视图铺满画布。',
  ].join('\n')
}
