import { ECOMMERCE_MODES } from '@/features/ecommerce/ecommerceTools'
import {
  T2I_ASPECT_OPTIONS,
  T2I_COUNT_OPTIONS,
  T2I_QUALITY_OPTIONS,
  T2I_RESOLUTION_OPTIONS,
  WALLPAPER_SKILL_OPTIONS,
} from '@/features/ai-wallpaper/composables/wallpaperStudioConstants'

const option = (value, label, extra = {}) => ({ value, label, ...extra })

const RATIO_OPTIONS = T2I_ASPECT_OPTIONS.map((item) => option(item.value, item.label))
const RESOLUTION_OPTIONS = T2I_RESOLUTION_OPTIONS.map((item) => option(item.value, item.label))
const QUALITY_OPTIONS = T2I_QUALITY_OPTIONS.map((item) => option(item.value, item.label))
const COUNT_OPTIONS = T2I_COUNT_OPTIONS.map((item) => option(item.value, item.label))

const FIELD_META = {
  skill: { key: 'skill', label: 'Skill', icon: 'bi-lightning-charge-fill' },
  ratio: { key: 'ratio', label: '比例', icon: 'bi-aspect-ratio' },
  resolution: { key: 'resolution', label: '分辨率', icon: 'bi-badge-hd' },
  quality: { key: 'quality', label: '质量', icon: 'bi-stars' },
  count: { key: 'count', label: '张数', icon: 'bi-images' },
  model: { key: 'model', label: '模型', icon: 'bi-cpu' },
  material: { key: 'material', label: '提示词素材', icon: 'bi-journal-richtext' },
  device: { key: 'device', label: '设备', icon: 'bi-display' },
}

const materialOptions = (items) => [option('', '不使用素材'), ...items]

const PROFILES = {
  assistant: {
    defaults: {
      skill: 'agent',
      ratio: 'auto',
      resolution: '1K',
      quality: 'high',
      count: 1,
      model: '',
      material: '',
    },
    fields(config) {
      return config.skill === 'image'
        ? ['skill', 'ratio', 'resolution', 'count', 'model', 'material']
        : ['skill', 'model', 'material']
    },
    options: {
      skill: [
        option('agent', 'Agent 模式'),
        option('image', '图片生成'),
        option('剧情短片', '剧情短片'),
        option('电商套图', '电商套图'),
        option('海报设计', '海报设计'),
        option('品牌设计', '品牌设计'),
      ],
      ratio: RATIO_OPTIONS,
      resolution: RESOLUTION_OPTIONS.filter((item) => ['1K', '2K', '4K'].includes(item.value)),
      quality: QUALITY_OPTIONS,
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('assistant-plan', '方案拆解', {
          prompt: '请先拆解目标、约束和交付步骤，再给出可执行方案。',
        }),
        option('assistant-creative', '创意发散', {
          prompt: '围绕核心目标提供三个差异明显、可直接执行的创意方向。',
        }),
        option('assistant-refine', '专业润色', {
          prompt: '保持原意不变，补齐专业细节、结构和明确的交付标准。',
        }),
      ]),
    },
  },
  t2i: {
    defaults: {
      skill: 'prompt-architect',
      ratio: '1:1',
      resolution: '2K',
      quality: 'high',
      count: 1,
      model: '',
      material: '',
    },
    fields: () => ['skill', 'ratio', 'resolution', 'quality', 'count', 'model', 'material'],
    options: {
      skill: [
        option('none', '不启用 Skill'),
        ...WALLPAPER_SKILL_OPTIONS.map((item) => option(item.id, item.name)),
      ],
      ratio: RATIO_OPTIONS,
      resolution: RESOLUTION_OPTIONS,
      quality: QUALITY_OPTIONS,
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('t2i-photo', '商业摄影', {
          prompt: '商业摄影，真实材质，受控布光，主体完整，画面干净，无文字和水印。',
        }),
        option('t2i-cinematic', '电影镜头', {
          prompt: '电影级镜头语言，明确景别与主光方向，空间层次清晰，色彩统一。',
        }),
        option('t2i-illustration', '精致插画', {
          prompt: '精致商业插画，轮廓清楚，配色统一，细节完整，构图稳定。',
        }),
      ]),
    },
  },
  coloring: {
    defaults: {
      skill: 'smart',
      ratio: 'source',
      resolution: '2k',
      count: 1,
      model: '',
      material: '',
    },
    fields: () => ['skill', 'ratio', 'resolution', 'count', 'model', 'material'],
    options: {
      skill: [
        option('smart', '智能上色'),
        option('cel', '赛璐璐', { prompt: '使用清晰的赛璐璐分区上色，阴影边界干净。' }),
        option('painterly', '厚涂质感', { prompt: '使用细腻厚涂质感，保留线稿结构与自然色彩层次。' }),
        option('flat', '平涂配色', { prompt: '使用干净平涂配色，色块明确，不改变原始线稿。' }),
      ],
      ratio: [
        option('source', '原图比例'),
        ...RATIO_OPTIONS.filter((item) => item.value !== 'auto'),
      ],
      resolution: [option('1k', '1K'), option('2k', '2K'), option('4k', '4K')],
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('coloring-anime', '动漫角色', { prompt: '动漫角色配色，肤色自然，服装分区清晰。' }),
        option('coloring-concept', '概念设定', { prompt: '概念设计配色，强化材质区分与视觉焦点。' }),
        option('coloring-soft', '柔和绘本', { prompt: '柔和绘本配色，低对比光影，色彩温暖协调。' }),
      ]),
    },
  },
  ui: {
    defaults: { skill: 'landing', device: 'web', count: 1, model: '', material: '' },
    fields: () => ['skill', 'device', 'count', 'model', 'material'],
    options: {
      skill: [
        option('landing', '落地页'),
        option('dashboard', '仪表盘'),
        option('ecommerce', '电商页面'),
        option('feed', '信息流'),
        option('auth', '登录注册'),
        option('settings', '设置页'),
        option('profile', '个人中心'),
        option('chat', '聊天对话'),
        option('onboarding', '引导页'),
        option('custom', '自定义'),
      ],
      device: [option('web', 'Web 网页'), option('tablet', '平板')],
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('ui-saas', 'SaaS 产品', { prompt: '专业 SaaS 产品界面，强调任务效率、数据层级与稳定布局。' }),
        option('ui-commerce', '电商转化', { prompt: '电商转化界面，突出商品、价格、规格选择和购买路径。' }),
        option('ui-mobile', '移动应用', { prompt: '移动端应用体验，主要流程清晰，触控区域合理，状态完整。' }),
      ]),
    },
  },
  ecommerce: {
    defaults: { skill: 'detail', ratio: '3:4', count: 1, model: '', material: '' },
    fields: () => ['skill', 'ratio', 'count', 'model', 'material'],
    options: {
      skill: ECOMMERCE_MODES.map((mode) => option(mode.id, mode.shortLabel || mode.label)),
      ratio: RATIO_OPTIONS.filter((item) => item.value !== 'auto'),
      count: (config) => {
        const maxCount = ECOMMERCE_MODES.find((mode) => mode.id === config.skill)?.maxCount || 1
        return COUNT_OPTIONS.filter((item) => Number(item.value) <= maxCount)
      },
      material: materialOptions([
        option('commerce-launch', '新品首发', { prompt: '新品首发，突出核心卖点、专业质感与清晰购买理由。' }),
        option('commerce-premium', '轻奢高级', { prompt: '轻奢高级商业视觉，材质真实，构图克制，品牌感统一。' }),
        option('commerce-social', '社媒种草', { prompt: '社媒种草视觉，生活方式场景自然，商品主体和使用价值明确。' }),
      ]),
    },
  },
  model: {
    defaults: { skill: 'character', ratio: '16:9', quality: 'high', count: 1, model: '', material: '' },
    fields: () => ['skill', 'ratio', 'quality', 'count', 'model', 'material'],
    options: {
      skill: [option('character', '角色模型图'), option('object', '物体模型图')],
      ratio: RATIO_OPTIONS.filter((item) => item.value !== 'auto'),
      quality: QUALITY_OPTIONS,
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('model-production', '生产级设定', { prompt: '生产级模型设定，结构、比例、材质分区和关键细节清晰可用。' }),
        option('model-turnaround', '标准视图', { prompt: '标准正交视图语言，主体比例一致，背景干净，便于建模参考。' }),
        option('model-detail', '细节强化', { prompt: '强化可信结构与材质细节，不改变主体身份和核心造型。' }),
      ]),
    },
  },
  game: {
    defaults: { skill: 'character', ratio: '3:4', quality: 'high', count: 1, model: '', material: '' },
    fields: () => ['skill', 'ratio', 'quality', 'count', 'model', 'material'],
    options: {
      skill: [
        option('character', '角色'),
        option('prop', '道具'),
        option('environment', '场景'),
        option('icon', '图标'),
        option('ui', '游戏 UI'),
        option('texture', '贴图'),
      ],
      ratio: (config) => {
        const ratiosByType = {
          character: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
          environment: ['16:9', '3:2', '1:1'],
          prop: ['1:1', '4:3'],
          ui: ['16:9', '9:16', '4:3'],
          icon: ['1:1'],
          texture: ['1:1'],
        }
        const allowed = new Set(ratiosByType[config.skill] || ['1:1'])
        return RATIO_OPTIONS.filter((item) => allowed.has(item.value))
      },
      quality: [option('medium', '标准'), option('high', '高清')],
      count: COUNT_OPTIONS,
      material: materialOptions([
        option('game-production', '制作规范', { prompt: '游戏生产级资产，轮廓可读，结构清楚，材质分区明确。' }),
        option('game-concept', '概念设计', { prompt: '概念设计方向，视觉焦点明确，造型有记忆点且可落地制作。' }),
        option('game-consistency', '系列一致', { prompt: '保持系列资产的比例、配色、细节密度和视觉语言一致。' }),
      ]),
    },
  },
  puzzle: {
    defaults: { skill: 'grid-4', ratio: 'auto', resolution: 2400, material: '' },
    fields: () => ['skill', 'ratio', 'resolution', 'material'],
    options: {
      skill: [
        option('split-h2', '左右双图'),
        option('split-v2', '上下双图'),
        option('grid-4', '四宫格'),
        option('grid-6', '六格矩阵'),
        option('grid-9', '九宫格'),
        option('hero-left', '大图 + 双列'),
        option('hero-top', '上大下三'),
        option('pin-5', '瀑布五格'),
      ],
      ratio: [
        option('auto', '模板默认'),
        option('r1x1', '1:1'),
        option('r4x3', '4:3'),
        option('r3x4', '3:4'),
        option('r16x9', '16:9'),
        option('r9x16', '9:16'),
      ],
      resolution: [option(1600, '1600px'), option(2400, '2400px'), option(3600, '3600px')],
      material: materialOptions([
        option('puzzle-story', '故事标题', { prompt: '我们的精彩时刻' }),
        option('puzzle-travel', '旅行记录', { prompt: '这一路的风景' }),
        option('puzzle-product', '产品合集', { prompt: '精选系列一览' }),
      ]),
    },
  },
}

export function studioLaunchProfile(toolId = '') {
  return PROFILES[String(toolId || '')] || PROFILES.t2i
}

export function studioLaunchDefaults(toolId = '') {
  return { ...studioLaunchProfile(toolId).defaults }
}

export function studioLaunchFields(toolId = '', config = {}) {
  const profile = studioLaunchProfile(toolId)
  return profile.fields(config).map((key) => ({
    ...FIELD_META[key],
    options:
      typeof profile.options[key] === 'function'
        ? profile.options[key](config)
        : profile.options[key] || [],
  }))
}

export function studioLaunchOption(toolId = '', key = '', value = '') {
  const profile = studioLaunchProfile(toolId)
  const source = profile.options[key]
  const options = typeof source === 'function' ? source(profile.defaults) : source
  return options?.find((item) => String(item.value) === String(value))
}

export function ecommerceModeDefaultRatio(modeId = '') {
  return ECOMMERCE_MODES.find((mode) => mode.id === modeId)?.ratio || '1:1'
}
