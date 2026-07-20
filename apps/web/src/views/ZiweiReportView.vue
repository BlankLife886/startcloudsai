<script setup>
import { astro } from 'iztro'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ziweiCompassIcon from '../assets/ziwei/ziwei-compass-gold.svg'
import {
  animateZwChartReveal,
  animateZwCinematicChartReveal,
  animateZwPageBoot,
  animateZwPageBootFromCinematic,
  revealZwConsoleShell,
  animateZwPalaceHeadline,
  animateZwReadContent,
  animateZwSanfangPath,
  animateZwSubmitPulse,
} from '@/features/ziwei/ziweiMotion'
import ZiweiCinematicLayer from '@/features/ziwei/ZiweiCinematicLayer.vue'
import ZiweiStarfieldChart from '@/features/ziwei/ZiweiStarfieldChart.vue'
import ZwTimeSelect from '@/features/ziwei/ZwTimeSelect.vue'
import {
  canPlayZwCinematic,
  createZwCinematicController,
} from '@/features/ziwei/ziweiCinematicScene'
import { buildPaipanMicroSteps, schedulePaipanSteps } from '@/features/ziwei/ziweiPaipanDriver'
import { loadZiweiPrefs, saveZiweiPrefs } from '@/features/ziwei/ziweiPreferences'
import { cancelAnimations } from '@/lib/anime'
import { useAppearanceStore } from '@/stores/appearance'
import { storeToRefs } from 'pinia'
import './ziwei/ziwei-report.css'

const appearanceStore = useAppearanceStore()
const { isDark } = storeToRefs(appearanceStore)

const chartRevealed = ref(false)
const zwRoot = ref(null)
const chartStageRef = ref(null)
const starfieldRef = ref(null)
const readBodyRef = ref(null)
const palaceHeadlineRef = ref(null)
const submitButtonRef = ref(null)
const paipanStepIndex = ref(0)
const paipanMicroSteps = schedulePaipanSteps(buildPaipanMicroSteps(null), 2000)
let paipanStepTimer = null

const paipanPalaceProgress = computed(() => {
  const step = paipanMicroSteps[paipanStepIndex.value]
  if (!step) return 0
  if (step.phase === 'palace') return (step.palaceIndex ?? 0) + 1
  for (let i = paipanStepIndex.value; i >= 0; i -= 1) {
    const prev = paipanMicroSteps[i]
    if (prev?.phase === 'palace') return (prev.palaceIndex ?? 0) + 1
  }
  return 0
})
const cinematicCapable = canPlayZwCinematic()
const prefs = reactive(loadZiweiPrefs())
watch(
  prefs,
  () => {
    saveZiweiPrefs({ ...prefs })
  },
  { deep: true },
)
/** 仅进入页面时读取一次；勾选「下次跳过」不影响当前场次 */
const showEntryCinematic = ref(cinematicCapable && !prefs.skipEntryCinematic)
const showDashboardShell = computed(() => {
  if (!pageReady.value) return false
  if (['intro', 'intake', 'generating', 'constellation'].includes(journeyPhase.value)) return false
  return true
})

const journeyPhase = ref(showEntryCinematic.value ? 'intro' : 'console')
const pageReady = ref(!showEntryCinematic.value)
const cinematicLayerRef = ref(null)
let cinematicCtrl = null

const timeOptions = [
  { value: 0, label: '早子', range: '00:00-01:00' },
  { value: 1, label: '丑', range: '01:00-03:00' },
  { value: 2, label: '寅', range: '03:00-05:00' },
  { value: 3, label: '卯', range: '05:00-07:00' },
  { value: 4, label: '辰', range: '07:00-09:00' },
  { value: 5, label: '巳', range: '09:00-11:00' },
  { value: 6, label: '午', range: '11:00-13:00' },
  { value: 7, label: '未', range: '13:00-15:00' },
  { value: 8, label: '申', range: '15:00-17:00' },
  { value: 9, label: '酉', range: '17:00-19:00' },
  { value: 10, label: '戌', range: '19:00-21:00' },
  { value: 11, label: '亥', range: '21:00-23:00' },
  { value: 12, label: '晚子', range: '23:00-00:00' },
]

const ruleSet = {
  id: 'platform_default_iztro',
  label: '平台标准版',
  algorithm: 'default',
  version: 'iztro 2.5.8',
}

const palaceAreas = {
  0: 'yin',
  1: 'mao',
  2: 'chen',
  3: 'si',
  4: 'wu',
  5: 'wei',
  6: 'shen',
  7: 'you',
  8: 'xu',
  9: 'hai',
  10: 'zi',
  11: 'chou',
}

const tabs = [
  { id: 'overview', label: '深度总览', icon: 'bi-compass' },
  { id: 'themes', label: '结构解读', icon: 'bi-chat-square-text' },
  { id: 'palaces', label: '星曜明细', icon: 'bi-grid-3x3-gap' },
  { id: 'evidence', label: '计算依据', icon: 'bi-journal-check' },
]

const keyPalaceNames = ['命宫', '官禄', '财帛', '夫妻', '福德', '迁移']

const palaceThemeMap = {
  命宫: {
    title: '命宫主轴',
    scope: '观察人格底盘、行事节奏、外在呈现和人生主线。',
  },
  身宫: {
    title: '身宫落点',
    scope: '观察后天投入的重心，以及越到中后期越容易反复经营的主题。',
  },
  官禄: {
    title: '事业方向',
    scope: '观察职业承担、做事方式、组织关系和长期发展路径。',
  },
  财帛: {
    title: '财富节奏',
    scope: '观察资源取得、现金流习惯、变现方式和风险偏好。',
  },
  夫妻: {
    title: '关系互动',
    scope: '观察亲密关系、协作模式、伴侣期待和关系中的压力点。',
  },
  福德: {
    title: '内在状态',
    scope: '观察精神满足、休息方式、长期情绪能量和内心稳定度。',
  },
  迁移: {
    title: '外部机会',
    scope: '观察外出发展、环境变化、贵人接触和对外连接方式。',
  },
}

const majorStarMeanings = {
  紫微: '紫微重统筹、主导与资源整合，适合放在需要定方向、担责任的位置观察。',
  天机: '天机重思考、变化与策划，盘面主题常与学习、方案、机动调整有关。',
  太阳: '太阳重外放、照拂与公开表达，适合观察可见度、承担感和对外影响。',
  武曲: '武曲重执行、财务与秩序，盘面主题常落在效率、纪律和资源管理。',
  天同: '天同重感受、缓和与福分，适合观察舒适感、人缘和情绪恢复力。',
  廉贞: '廉贞重边界、规则与欲望管理，常提示关系、原则和取舍需要清楚。',
  天府: '天府重承载、稳定与蓄积，适合观察守成、资源库和长期安全感。',
  太阴: '太阴重细腻、积累与内在感受，常与照护、审美、资产和安全感有关。',
  贪狼: '贪狼重欲望、社交与多元兴趣，适合观察扩张力、才艺和选择过多的课题。',
  巨门: '巨门重表达、辨析与是非，常提示沟通、判断、信息差和口舌压力。',
  天相: '天相重协调、制度与服务，适合观察合作、支持位和对公平秩序的要求。',
  天梁: '天梁重保护、原则与长辈缘，常与责任感、专业信誉和照拂他人有关。',
  七杀: '七杀重突破、决断与压力推进，适合观察开创、竞争和高强度任务。',
  破军: '破军重破旧立新、重组与波动，盘面主题常与改变、迭代和重新分配有关。',
}

const mutagenMeanings = {
  禄: '化禄代表资源、机会与顺手处。',
  权: '化权代表推动、掌控与责任加重处。',
  科: '化科代表名声、修饰、学习与缓冲处。',
  忌: '化忌代表牵挂、阻滞、执念或需要反复修正处。',
}

const brightnessMeanings = {
  庙: '庙地主星力量充足，主题表现更直接。',
  旺: '旺地主星发挥顺畅，主题可见度较高。',
  得: '得地主星有可用之力，需要配合宫位环境。',
  利: '利地主星仍有助力，但要看辅星与四化承接。',
  平: '平地主星表现中性，宜结合三方四正判断。',
  陷: '陷地主星发挥受限，主题更容易先经历卡点或内耗。',
  不: '不得地主星发挥受限，主题需要更多外部条件承接。',
}

const palaceReadingBook = {
  命宫: { title: '命宫主轴', subject: '人格底盘、行事节奏、外在呈现与人生主线' },
  身宫: { title: '身宫落点', subject: '后天投入、实际经营方式与中后期反复投入的重心' },
  兄弟: { title: '同辈协作', subject: '同辈、手足、横向协作与资源分担' },
  夫妻: { title: '关系结构', subject: '亲密关系、合作契约、伴侣期待与互动压力' },
  子女: { title: '表达延展', subject: '子女、创作、下属、作品与向外延展的成果' },
  财帛: { title: '财帛结构', subject: '收入方式、现金流、资源取得与财务风险' },
  疾厄: { title: '身心承载', subject: '身体承载、情绪压力、隐性消耗与修复方式' },
  迁移: { title: '外部场域', subject: '外出发展、环境转换、对外机会与社会能见度' },
  仆役: { title: '人脉系统', subject: '朋友、团队、部属、社群与协作网络' },
  官禄: { title: '事业格局', subject: '职业方向、组织位置、责任结构与长期成就' },
  田宅: { title: '资产根基', subject: '居住、家庭、资产沉淀、不动产与内在安全感' },
  福德: { title: '精神底盘', subject: '精神状态、享受方式、长期情绪能量与福分承载' },
  父母: { title: '上缘系统', subject: '父母、长辈、制度资源、文书与上级关系' },
}

const majorStarRuleBook = {
  紫微: {
    core: '主统御、名位、资源整合与决策中心',
    use: '适合观察组织权责、领导位置、能否成为系统核心',
    shadow: '若受煞忌或失地，容易出现权责压力、资源不稳或名位虚耗',
  },
  天机: {
    core: '主机巧、策划、变动、学习与方案推演',
    use: '适合观察脑力、策略、迁动、技术和多方案处理能力',
    shadow: '若受煞忌，容易多思、多变、计划反复或稳定性不足',
  },
  太阳: {
    core: '主公开、照拂、担当、可见度与外放能量',
    use: '适合观察名声、服务、承担、公职或对外影响',
    shadow: '若失地或化忌，容易辛劳外放、付出过度或与男性/长辈议题牵连',
  },
  武曲: {
    core: '主财务、执行、纪律、技术、效率与结果导向',
    use: '适合观察资源管理、执行力、专业技能和财务秩序',
    shadow: '若煞曜同宫或失衡，容易刚硬、压力内收、关系表达偏冷',
  },
  天同: {
    core: '主福分、和气、感受、缓冲与生活舒适度',
    use: '适合观察情绪恢复、人缘、享受能力和缓和矛盾的能力',
    shadow: '若受煞忌，容易拖延、依赖舒适区或情绪承载不足',
  },
  廉贞: {
    core: '主规则、边界、欲望管理、关系张力与制度约束',
    use: '适合观察规则意识、审美、人际边界和资源取舍',
    shadow: '若受煞忌，容易陷入是非、执念、关系拉扯或风险交易',
  },
  天府: {
    core: '主库藏、承载、稳定、守成与资源调度',
    use: '适合观察资产沉淀、管理能力、长期安全感和后勤承载',
    shadow: '若会煞空耗，容易守成有余、开创不足，或资源进出不均',
  },
  太阴: {
    core: '主积累、照护、审美、资产、细腻感受与隐性资源',
    use: '适合观察财库、家庭、女性缘、细致规划和安全感',
    shadow: '若化忌或失地，容易牵挂、内耗、情绪积压或资产周转压力',
  },
  贪狼: {
    core: '主欲望、社交、才艺、扩张、多元兴趣与人情场',
    use: '适合观察社交经营、才艺表达、商业嗅觉和机会扩展',
    shadow: '若煞忌重，容易欲望分散、选择过多或人情牵制',
  },
  巨门: {
    core: '主口舌、辨析、暗曜、信息差、疑问与表达压力',
    use: '适合观察沟通、研究、辩证、谈判和信息处理',
    shadow: '若落陷或会煞忌，容易是非、误解、口舌压力或判断反复',
  },
  天相: {
    core: '主制度、服务、协调、公平、辅佐与秩序维护',
    use: '适合观察合作位置、制度执行、协调能力和专业服务',
    shadow: '若受煞，容易被制度夹住、责任多而自主性不足',
  },
  天梁: {
    core: '主原则、庇护、长辈缘、专业信誉与解厄',
    use: '适合观察责任感、资历、保护他人和解决问题的能力',
    shadow: '若陷地或会煞，容易原则压力、长辈/制度牵制或孤高感',
  },
  七杀: {
    core: '主决断、突破、竞争、压力推进与重新开局',
    use: '适合观察开创、外部战场、高强度任务和危机处理',
    shadow: '若煞重，容易变动剧烈、关系强硬或风险承担过高',
  },
  破军: {
    core: '主破旧立新、重组、消耗、变革与重新分配',
    use: '适合观察改革、创业、转换跑道和资源重组',
    shadow: '若失衡，容易先破后立、稳定性不足或关系/资产波动',
  },
}

const starGroupRuleBook = {
  soft: '左辅、右弼、文昌、文曲、天魁、天钺等辅曜，代表贵人、文书、学习、协调与外部助力。',
  tough:
    '擎羊、陀罗、火星、铃星、地空、地劫等煞曜，代表压力、切割、突发、损耗或必须处理的现实阻力。',
  flower: '桃花曜增强人缘、审美、情绪牵动与关系可见度，也会放大关系议题。',
  helper: '解神、年解等解曜有缓冲、化解、修复和转圜意味。',
  lucun: '禄存代表稳定资源、积累与守成能力。',
  tianma: '天马代表移动、迁动、奔波和跨场域机会。',
}

const brightnessLevel = {
  庙: 3,
  旺: 2,
  得: 1,
  利: 1,
  平: 0,
  不: -1,
  陷: -2,
}

const chartPreviewLayout = {
  width: 1800,
  height: 1160,
  grid: { x: 20, y: 20, cellW: 440, cellH: 280 },
  center: { x: 460, y: 300, width: 880, height: 560 },
}

const chartPreviewSlots = {
  si: { x: 20, y: 20 },
  wu: { x: 460, y: 20 },
  wei: { x: 900, y: 20 },
  shen: { x: 1340, y: 20 },
  chen: { x: 20, y: 300 },
  you: { x: 1340, y: 300 },
  mao: { x: 20, y: 580 },
  xu: { x: 1340, y: 580 },
  yin: { x: 20, y: 860 },
  chou: { x: 460, y: 860 },
  zi: { x: 900, y: 860 },
  hai: { x: 1340, y: 860 },
}

function getChartPalette() {
  if (isDark.value) {
    return {
      bg: '#0d0f18',
      palace: '#161824',
      palaceOverlay: 'rgba(160, 139, 255, 0.05)',
      strokeActive: 'rgba(160, 139, 255, 0.55)',
      strokeOpp: 'rgba(160, 139, 255, 0.32)',
      strokeSur: 'rgba(160, 139, 255, 0.22)',
      strokeIdle: 'rgba(160, 139, 255, 0.16)',
      branch: '#a08bff',
      name: '#f0ecff',
      decadal: '#c4b5ff',
      ages: 'rgba(154, 161, 184, 0.9)',
      changsheng: '#b8a8ff',
      boshi: 'rgba(154, 161, 184, 0.86)',
      jiangqian: 'rgba(255, 122, 144, 0.88)',
      suiqian: 'rgba(255, 154, 196, 0.84)',
      accent: '#a08bff',
      softAccent: '#c4b5ff',
      title: '#f0ecff',
      label: 'rgba(232, 234, 244, 0.55)',
      value: '#a08bff',
      divider: 'rgba(255, 255, 255, 0.065)',
      node: '#a08bff',
      statusA: '#7dcea0',
      statusB: '#a08bff',
      stop: '#a08bff',
      centerStroke: 'rgba(160, 139, 255, 0.22)',
      mingzhu: '#c4b5ff',
      minggong: '#f0ecff',
      mingzhuLabel: 'rgba(196, 181, 255, 0.72)',
      minggongLabel: 'rgba(240, 236, 255, 0.62)',
    }
  }
  return {
    bg: '#f7f7ff',
    palace: '#ffffff',
    palaceOverlay: 'rgba(106, 79, 224, 0.04)',
    strokeActive: 'rgba(106, 79, 224, 0.5)',
    strokeOpp: 'rgba(106, 79, 224, 0.32)',
    strokeSur: 'rgba(106, 79, 224, 0.22)',
    strokeIdle: 'rgba(106, 79, 224, 0.16)',
    branch: '#6a4fe0',
    name: '#151a2d',
    decadal: '#5a3fd0',
    ages: 'rgba(58, 66, 88, 0.72)',
    changsheng: '#8b74f0',
    boshi: 'rgba(121, 128, 154, 0.9)',
    jiangqian: 'rgba(212, 91, 122, 0.88)',
    suiqian: 'rgba(200, 100, 150, 0.84)',
    accent: '#6a4fe0',
    softAccent: '#8b74f0',
    title: '#151a2d',
    label: '#79809a',
    value: '#6a4fe0',
    divider: 'rgba(21, 26, 45, 0.1)',
    node: '#6a4fe0',
    statusA: '#2f9e6b',
    statusB: '#6a4fe0',
    stop: '#6a4fe0',
    centerStroke: 'rgba(106, 79, 224, 0.22)',
    mingzhu: '#6a4fe0',
    minggong: '#151a2d',
    mingzhuLabel: 'rgba(106, 79, 224, 0.72)',
    minggongLabel: 'rgba(21, 26, 45, 0.62)',
  }
}

function getChartPreviewTones() {
  const p = getChartPalette()
  return {
    default: { fill: p.palace, overlay: p.palaceOverlay },
    focused: { fill: p.palace, overlay: 'url(#zw-palace-active)' },
    opposite: { fill: p.palace, overlay: 'url(#zw-palace-opposite)' },
    surrounded: { fill: p.palace, overlay: 'url(#zw-palace-surround)' },
    body: { fill: p.palace, overlay: p.palaceOverlay },
    original: { fill: p.palace, overlay: p.palaceOverlay },
  }
}

function getPalaceTextColors() {
  const p = getChartPalette()
  return {
    branch: p.branch,
    name: p.name,
    decadal: p.decadal,
    ages: p.ages,
    changsheng: p.changsheng,
    boshi: p.boshi,
    jiangqian: p.jiangqian,
    suiqian: p.suiqian,
  }
}

/** 主星金 / 辅星紫 / 花系粉 — 语义色 */
const starColors = {
  major: '#fbbf24',
  soft: '#8b74f0',
  tough: '#e8928a',
  flower: '#f0a0c4',
  helper: '#8b74f0',
  lucun: '#8b74f0',
  tianma: '#54d6c4',
  adjective: '#8592a5',
  horoscope: '#8b74f0',
}

const starTierStyles = {
  major: { fontSize: 24, fontWeight: 850, opacity: 1 },
  minor: { fontSize: 19, fontWeight: 780, opacity: 0.94 },
  horoscope: { fontSize: 17, fontWeight: 720, opacity: 0.86 },
  adjective: { fontSize: 16, fontWeight: 700, opacity: 0.84 },
}

const starBrightnessColor = 'rgba(251, 191, 36, 0.78)'

function resolveStarPaint(star, group) {
  if (group === 'horoscope') {
    return { fill: starColors.horoscope, ...starTierStyles.horoscope }
  }
  if (group === 'major') {
    return { fill: starColors.major, ...starTierStyles.major }
  }
  const fill = starColors[star.type] || starColors.soft
  return { fill, ...starTierStyles.minor }
}

function getCenterPanelValueColors() {
  const p = getChartPalette()
  return {
    生肖: '#fbbf24',
    命主: p.mingzhu,
    命宫: p.minggong,
  }
}

function getCenterPanelLabelColors() {
  const p = getChartPalette()
  return {
    生肖: 'rgba(251, 191, 36, 0.72)',
    命主: p.mingzhuLabel,
    命宫: p.minggongLabel,
  }
}

const mutagenColors = {
  禄: '#d4a017',
  权: '#8b5cf6',
  科: '#38bdf8',
  忌: '#78716c',
}

const horoscopeScopes = [
  ['decadal', '大限', '#8b74f0'],
  ['age', '小限', '#54d6c4'],
  ['yearly', '流年', '#a08bff'],
  ['monthly', '流月', '#8b74f0'],
  ['daily', '流日', '#6a4fe0'],
  ['hourly', '流时', '#54d6c4'],
]

const form = reactive({
  calendar: 'solar',
  birthDate: '',
  timeIndex: 0,
  gender: '男',
  transitDate: '',
  transitTimeIndex: '',
  isLeapMonth: false,
  fixLeap: true,
  dayDivide: 'forward',
  yearDivide: 'normal',
})

const chart = ref(null)
const chartError = ref('')
const chartGenerating = ref(false)
const submitted = ref(false)
let generateToken = 0
const activePalaceIndex = ref(null)
const activeTab = ref('overview')
const savedSnapshots = ref([])

const selectedTime = computed(() => {
  if (form.timeIndex === '' || form.timeIndex === null || form.timeIndex === undefined) return null
  return timeOptions.find((item) => item.value === Number(form.timeIndex)) || null
})
const formReady = computed(() => Boolean(form.birthDate && selectedTime.value && form.gender))
const normalizedTransitDate = computed(() => normalizeDateForIztro(form.transitDate))

const activePalace = computed(() => {
  if (!chart.value?.palaces?.length) return null
  return (
    chart.value.palaces.find((palace) => palace.index === activePalaceIndex.value) ||
    getPalaceByName('命宫') ||
    chart.value.palaces[0]
  )
})

const soulPalace = computed(() => getPalaceByName('命宫'))
const bodyPalace = computed(
  () => chart.value?.palaces?.find((palace) => palace.isBodyPalace) || null,
)

const normalizedBirth = computed(() => {
  if (!chart.value) return null
  return {
    solar: chart.value.solarDate,
    lunar: chart.value.lunarDate,
    ganzhi: chart.value.chineseDate,
    time: `${chart.value.time} ${chart.value.timeRange}`,
    gender: chart.value.gender,
    zodiac: chart.value.zodiac,
    sign: chart.value.sign,
  }
})

const chartHash = computed(() => {
  if (!chart.value) return ''
  const source = [
    form.calendar,
    form.birthDate,
    form.timeIndex,
    form.gender,
    form.isLeapMonth,
    form.fixLeap,
    form.dayDivide,
    form.yearDivide,
    chart.value.chineseDate,
  ].join('|')
  return `sha256:${hashString(source)}`
})

const palaceBoard = computed(() =>
  (chart.value?.palaces || []).map((palace) => ({
    ...palace,
    area: palaceAreas[palace.index],
    relation: getPalaceRelation(palace),
  })),
)

const surroundedPalaces = computed(() => {
  if (!chart.value || !activePalace.value) return null
  try {
    return chart.value.surroundedPalaces(activePalace.value.name)
  } catch {
    return null
  }
})

const activeRelationCards = computed(() => {
  if (!surroundedPalaces.value) return []
  return [
    ['本宫', surroundedPalaces.value.target],
    ['对宫', surroundedPalaces.value.opposite],
    ['财帛位', surroundedPalaces.value.wealth],
    ['官禄位', surroundedPalaces.value.career],
  ].filter(([, palace]) => palace)
})

const inputSummaryRows = computed(() => [
  {
    label: '历法',
    value: form.calendar === 'solar' ? '阳历' : `农历${form.isLeapMonth ? '闰月' : ''}`,
  },
  { label: '出生日期', value: form.birthDate || '未填写' },
  {
    label: '出生时辰',
    value: selectedTime.value
      ? `${selectedTime.value.label}时 ${selectedTime.value.range}`
      : '未选择',
  },
  { label: '性别', value: form.gender || '未选择' },
  {
    label: '运限',
    value: normalizedTransitDate.value
      ? `${normalizedTransitDate.value}${transitTimeLabel.value}`
      : '未设置，仅生成本命盘',
  },
])

const transitTimeLabel = computed(() => {
  if (
    form.transitTimeIndex === '' ||
    form.transitTimeIndex === null ||
    form.transitTimeIndex === undefined
  )
    return ''
  const option = timeOptions.find((item) => item.value === Number(form.transitTimeIndex))
  return option ? ` ${option.label}时` : ''
})

const inputChecklist = computed(() => [
  { label: '出生日期', done: Boolean(form.birthDate), value: form.birthDate || '未填写' },
  {
    label: '出生时辰',
    done: Boolean(selectedTime.value),
    value: selectedTime.value
      ? `${selectedTime.value.label}时 ${selectedTime.value.range}`
      : '未选择',
  },
  { label: '性别', done: Boolean(form.gender), value: form.gender || '未选择' },
  {
    label: '运限日期',
    done: Boolean(normalizedTransitDate.value),
    value: normalizedTransitDate.value || '未设置，可只看本命盘',
  },
])

const assuranceItems = computed(() => [
  {
    status: chart.value ? '已计算' : '待生成',
    label: '本命排盘',
    body: '命宫、身宫、十二宫、主辅星、四化、五行局均由 iztro 本地引擎生成。',
    tone: chart.value ? 'ok' : 'idle',
  },
  {
    status: horoscope.value ? '已计算' : '可选',
    label: '运限结构',
    body: '填写运限日期后计算大限、小限、流年、流月、流日；流时仅在选择运限时辰后展示。',
    tone: horoscope.value ? 'ok' : 'warn',
  },
])

const deepReport = computed(() => {
  if (!chart.value || !soulPalace.value) return null
  const soul = soulPalace.value
  const body = bodyPalace.value
  const soulReport = buildPalaceAnalysis('命宫', soul)
  const bodyReport = body ? buildPalaceAnalysis('身宫', body) : null
  const soulSurrounded = getSurroundedSet(soul)
  const mutagens = mutagenOverview.value
  const corePalaces = uniquePalaces([
    soulSurrounded.target,
    soulSurrounded.opposite,
    soulSurrounded.wealth,
    soulSurrounded.career,
  ])
  const summaryPoints = [
    buildAxisReading(soul, body),
    buildSurroundedReading(soul),
    buildMutagenChainReading(mutagens),
    buildSupportPressureReading(corePalaces),
  ].filter(Boolean)

  return {
    summary: {
      headline: `${formatPalacePosition(soul)}为命宫，${body ? `${formatPalacePosition(body)}为身宫` : '未读取到身宫'}`,
      points: summaryPoints,
    },
    coreCards: [
      {
        label: '命身轴',
        title: `${soulReport?.headline || formatPalacePosition(soul)} / ${bodyReport?.headline || '身宫未读出'}`,
        body: buildAxisReading(soul, body),
        evidence: [
          `命宫：${buildPalaceEvidenceLine(soul)}`,
          body ? `身宫：${buildPalaceEvidenceLine(body)}` : '身宫：排盘对象未返回身宫标记',
        ],
      },
      {
        label: '三方四正',
        title: buildSurroundedTitle(soul),
        body: buildSurroundedReading(soul),
        evidence: buildSurroundedEvidenceLines(soul),
      },
      {
        label: '四化链路',
        title: mutagens.length
          ? mutagens.map((item) => `${item.star}化${item.mutagen}`).join('、')
          : '本盘未读取到四化',
        body: buildMutagenChainReading(mutagens),
        evidence: mutagens.length
          ? mutagens.map((item) => `${item.palace}${item.branch}：${item.star}化${item.mutagen}`)
          : ['星曜对象未返回 mutagen 字段'],
      },
      {
        label: '辅煞平衡',
        title: buildSupportPressureTitle(corePalaces),
        body: buildSupportPressureReading(corePalaces),
        evidence: buildSupportPressureEvidence(corePalaces),
      },
    ].filter((item) => item.body),
  }
})

const resultHighlights = computed(() => deepReport.value?.coreCards || [])

const selectedPalaceReport = computed(() => {
  if (!activePalace.value) return null
  return buildPalaceAnalysis(activePalace.value.name, activePalace.value)
})

const selectedPalaceStarGroups = computed(() => {
  if (!activePalace.value) return []
  return [
    {
      label: '主星',
      stars: activePalace.value.majorStars || [],
      empty: '空宫，重点看对宫与三方四正',
    },
    { label: '辅星', stars: activePalace.value.minorStars || [], empty: '少辅星' },
    { label: '杂曜', stars: activePalace.value.adjectiveStars || [], empty: '少杂曜' },
  ]
})

const selectedPalaceTags = computed(() => {
  if (!activePalace.value) return []
  const palace = activePalace.value
  return [
    formatStemBranch(palace),
    palace.decadal?.range ? `${palace.decadal.range[0]}-${palace.decadal.range[1]}岁大限` : '',
    palace.isBodyPalace ? '身宫' : '',
    palace.isOriginalPalace ? '来因宫' : '',
    getHoroscopeBadges(palace)
      .map((badge) => badge.label)
      .join('、'),
  ].filter(Boolean)
})

const mutagenOverview = computed(() =>
  palaceBoard.value.flatMap((palace) =>
    getMutagenStars(palace).map((star) => ({
      palace: palace.name,
      branch: formatStemBranch(palace),
      star: star.name,
      mutagen: star.mutagen,
      meaning: mutagenMeanings[star.mutagen] || '四化落点',
    })),
  ),
)

const palaceStats = computed(() => {
  if (!chart.value) return []
  const majorCount = palaceBoard.value.reduce(
    (sum, palace) => sum + (palace.majorStars?.length || 0),
    0,
  )
  const minorCount = palaceBoard.value.reduce(
    (sum, palace) => sum + (palace.minorStars?.length || 0),
    0,
  )
  const adjectiveCount = palaceBoard.value.reduce(
    (sum, palace) => sum + (palace.adjectiveStars?.length || 0),
    0,
  )
  const emptyCount = palaceBoard.value.filter((palace) => !palace.majorStars?.length).length
  return [
    { label: '十二宫', value: `${palaceBoard.value.length} 宫`, note: '本命盘宫位' },
    { label: '主星', value: `${majorCount} 颗`, note: `空宫 ${emptyCount} 宫` },
    { label: '辅星', value: `${minorCount} 颗`, note: '含左右昌曲魁钺等' },
    { label: '杂曜', value: `${adjectiveCount} 颗`, note: '用于辅助判断' },
  ]
})

const structureSummary = computed(() => deepReport.value?.summary || null)

const themeReports = computed(() =>
  keyPalaceNames.map((name) => buildPalaceAnalysis(name, getPalaceByName(name))).filter(Boolean),
)

const palaceOverviewRows = computed(() =>
  (chart.value?.palaces || []).map((palace) => ({
    ...palace,
    mainStars: summarizeStars(palace, 4) || '空宫',
    minorText: summarizeStarGroup(palace.minorStars, 6) || '少辅星',
    adjectiveText: summarizeStarGroup(palace.adjectiveStars, 6) || '少杂曜',
    mutagenText:
      getMutagenStars(palace)
        .map((star) => `${star.name}化${star.mutagen}`)
        .join('、') || '无四化',
    decadalText: palace.decadal?.range
      ? `${palace.decadal.range[0]}-${palace.decadal.range[1]}岁`
      : '-',
  })),
)

const evidenceRows = computed(() => {
  if (!chart.value) return []
  return [
    { label: '排盘引擎', value: ruleSet.version },
    { label: '规则集', value: `${ruleSet.label} / ${ruleSet.id}` },
    {
      label: '历法',
      value: form.calendar === 'solar' ? '阳历' : `农历${form.isLeapMonth ? '闰月' : ''}`,
    },
    { label: '晚子时', value: form.dayDivide === 'forward' ? '按次日' : '按当日' },
    { label: '年分界', value: form.yearDivide === 'normal' ? '正月初一' : '立春' },
    {
      label: '运限日期',
      value: horoscope.value
        ? `${horoscope.value.solarDate} / ${horoscope.value.lunarDate}`
        : '未设置，仅本命盘',
    },
    { label: '快照哈希', value: chartHash.value },
  ]
})

const horoscopeOverviewRows = computed(() => {
  const h = horoscope.value
  if (!h || !chart.value) return []
  return horoscopeScopes
    .filter(([scope]) => scope !== 'hourly' || form.transitTimeIndex !== '')
    .map(([scope, label]) => {
      const item = h[scope]
      const palace = item ? chart.value.palaces?.[item.index] : null
      return {
        label,
        palace: palace?.name || '-',
        branch: item ? `${item.heavenlyStem || ''}${item.earthlyBranch || ''}` : '-',
        stars: item?.stars?.[item.index]?.map((star) => star.name).join('、') || '无流曜落本宫',
        mutagen: item?.mutagen?.length ? item.mutagen.join('、') : '无四化列表',
        nominalAge: scope === 'age' && item?.nominalAge ? `${item.nominalAge}岁` : '',
      }
    })
})

const selectedPalaceHoroscopeRows = computed(() => {
  if (!activePalace.value || !horoscope.value) return []
  return horoscopeScopes
    .filter(([scope]) => scope !== 'hourly' || form.transitTimeIndex !== '')
    .map(([scope, label]) => {
      const item = horoscope.value?.[scope]
      if (!item) return null
      const stars = item.stars?.[activePalace.value.index] || []
      const isCurrent = item.index === activePalace.value.index
      if (!isCurrent && !stars.length) return null
      return {
        label,
        branch: `${item.heavenlyStem || ''}${item.earthlyBranch || ''}`,
        active: isCurrent,
        text: stars.length ? stars.map((star) => star.name).join('、') : '运限落此宫',
      }
    })
    .filter(Boolean)
})

const selectedPalaceLedgerRows = computed(() => {
  if (!activePalace.value) return []
  const palace = activePalace.value
  return [
    { label: '宫位', value: `${palace.name}${formatStemBranch(palace)}` },
    { label: '主星', value: summarizeStarGroup(palace.majorStars, 10) || '空宫' },
    { label: '辅星', value: summarizeStarGroup(palace.minorStars, 10) || '少辅星' },
    { label: '杂曜', value: summarizeStarGroup(palace.adjectiveStars, 10) || '少杂曜' },
    {
      label: '四化',
      value:
        getMutagenStars(palace)
          .map((star) => `${star.name}化${star.mutagen}`)
          .join('、') || '无四化',
    },
    {
      label: '大限',
      value: palace.decadal?.range
        ? `${palace.decadal.range[0]}-${palace.decadal.range[1]}岁`
        : '-',
    },
    {
      label: '长生/博士',
      value: [palace.changsheng12, palace.boshi12].filter(Boolean).join(' / ') || '-',
    },
    {
      label: '将前/岁前',
      value: [palace.jiangqian12, palace.suiqian12].filter(Boolean).join(' / ') || '-',
    },
  ]
})

const horoscope = computed(() => {
  if (!chart.value || !normalizedTransitDate.value) return null
  try {
    if (
      form.transitTimeIndex === '' ||
      form.transitTimeIndex === null ||
      form.transitTimeIndex === undefined
    ) {
      return chart.value.horoscope(normalizedTransitDate.value)
    }
    return chart.value.horoscope(normalizedTransitDate.value, Number(form.transitTimeIndex))
  } catch {
    return null
  }
})

const chartPreviewSvg = computed(() => {
  void isDark.value
  return buildChartPreviewSvg()
})

const activeRelationSummary = computed(() => {
  const relation = surroundedPalaces.value
  if (!relation || !activePalace.value) return null
  return {
    self: formatPalacePosition(relation.target),
    opposite: formatPalacePosition(relation.opposite),
    wealth: formatPalacePosition(relation.wealth),
    career: formatPalacePosition(relation.career),
  }
})

function getPalacePreviewStars(palace) {
  if (!palace) return ''
  return summarizeStars(palace, 4) || '空宫'
}

function onChartPalaceClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-palace-index]') : null
  if (!target) return
  const index = Number(target.getAttribute('data-palace-index'))
  if (Number.isNaN(index)) return
  const palace = chart.value?.palaces?.find((item) => item.index === index)
  if (palace) selectPalace(palace)
  if (document.activeElement instanceof Element && target.contains(document.activeElement)) {
    document.activeElement.blur()
  }
}

function onChartKeydown(event) {
  if (!chart.value?.palaces?.length) return
  const current = activePalaceIndex.value ?? chart.value.palaces[0]?.index ?? 0
  let next = current

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (current + 1) % 12
    event.preventDefault()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (current + 11) % 12
    event.preventDefault()
  } else if (event.key === 'Home') {
    next = chart.value.palaces.find((palace) => palace.name === '命宫')?.index ?? 0
    event.preventDefault()
  } else {
    return
  }

  const palace = chart.value.palaces.find((item) => item.index === next)
  if (palace) selectPalace(palace)
}

async function generateChart(options = {}) {
  const { deferReveal = false, useCinematicPaipan = false, fromConsole = false } = options
  const useStarfield = fromConsole ? prefs.buildStarfieldOnGenerate : true
  const playAnim = fromConsole ? prefs.playGenerateAnimations : true
  submitted.value = true
  chartError.value = ''

  if (!formReady.value) {
    chart.value = null
    chartError.value = '请填写出生日期、出生时辰和性别后再生成命盘。'
    return
  }

  if (useStarfield && journeyPhase.value === 'console') {
    journeyPhase.value = 'generating'
  }

  const dateStr = normalizeDateForIztro(form.birthDate)
  if (!dateStr) {
    chart.value = null
    chartError.value = '出生日期格式应为 1990/08/08。'
    return
  }

  const token = ++generateToken
  chartGenerating.value = true
  const pauseMs = playAnim ? 2000 : 0
  const t0 = performance.now()

  try {
    let result
    try {
      result = astro.withOptions({
        type: form.calendar,
        dateStr,
        timeIndex: Number(form.timeIndex),
        gender: form.gender,
        isLeapMonth: form.calendar === 'lunar' ? form.isLeapMonth : false,
        fixLeap: form.fixLeap,
        language: 'zh-CN',
        config: {
          algorithm: ruleSet.algorithm,
          dayDivide: form.dayDivide,
          yearDivide: form.yearDivide,
          horoscopeDivide: form.yearDivide,
          ageDivide: 'normal',
        },
      })
    } catch (error) {
      chart.value = null
      chartError.value = error?.message || '排盘失败，请检查出生信息。'
      return
    }

    if (token !== generateToken) return

    if (useCinematicPaipan && cinematicCtrl) {
      const elapsed = performance.now() - t0
      const animMs = Math.max(1400, pauseMs - elapsed)
      await cinematicCtrl.drivePaipanWithChart(result, animMs)
    } else if (playAnim && pauseMs > 0) {
      const elapsed = performance.now() - t0
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, pauseMs - elapsed)))
      if (token !== generateToken) return
    }

    chart.value = result
    activePalaceIndex.value =
      result.palaces?.find((palace) => palace.name === '命宫')?.index ??
      result.palaces?.[0]?.index ??
      null
    activeTab.value = 'overview'
    chartRevealed.value = false
    await nextTick()

  if (deferReveal) return

  chartRevealed.value = true
  if (useStarfield) {
    journeyPhase.value = 'constellation'
  } else if (journeyPhase.value === 'generating') {
    journeyPhase.value = 'console'
  }
  await nextTick()
  runChartRevealAnimations({
    cinematic: useCinematicPaipan,
    starfield: useStarfield,
    animate: playAnim,
  })
  } finally {
    if (token === generateToken) {
      chartGenerating.value = false
      if (journeyPhase.value === 'generating' && !chart.value) {
        journeyPhase.value = 'console'
      }
    }
  }
}

function runChartRevealAnimations({ cinematic = false, starfield = false, animate = true } = {}) {
  if (!animate) return
  if (starfield) {
    starfieldRef.value?.playReveal()
    if (!cinematic) {
      animateZwReadContent(readBodyRef.value)
      animateZwSubmitPulse(submitButtonRef.value)
      animateZwPageBootFromCinematic(zwRoot.value)
    }
    return
  }
  if (cinematic) {
    animateZwCinematicChartReveal(chartStageRef.value)
  } else {
    animateZwChartReveal(chartStageRef.value)
  }
  animateZwSanfangPath(chartStageRef.value)
  animateZwReadContent(readBodyRef.value)
  animateZwSubmitPulse(submitButtonRef.value)
}

function getPalaceByName(name) {
  return chart.value?.palace?.(name) || chart.value?.palaces?.find((palace) => palace.name === name)
}

function selectPalaceByIndex(index) {
  const palace = chart.value?.palaces?.find((item) => item.index === index)
  if (palace) selectPalace(palace)
}

function resolveStarfieldTooltip(hit) {
  if (!hit || !chart.value) return null

  if (hit.type === 'center') {
    const c = chart.value
    return {
      title: c.fiveElementsClass || '中宫',
      body: `命主 ${c.soul} · 身主 ${c.body}。${c.chineseDate}，${c.lunarDate}。生肖 ${c.zodiac}，星座 ${c.sign}。`,
      evidence: hit.metaLabel && hit.metaValue ? [`${hit.metaLabel}：${hit.metaValue}`] : undefined,
    }
  }

  const palace = chart.value.palaces.find((p) => p.index === hit.palaceIndex)
  if (!palace) return null

  if (hit.type === 'palace') {
    const report = buildPalaceAnalysis(palace.name, palace)
    if (!report) return null
    return {
      title: report.headline,
      body: report.body,
      evidence: report.evidence,
    }
  }

  if (hit.type === 'star') {
    const pool =
      hit.group === 'major'
        ? palace.majorStars
        : hit.group === 'minor'
          ? palace.minorStars
          : hit.group === 'adjective'
            ? palace.adjectiveStars
            : getHoroscopeStars(palace)
    const star = pool.find((s) => s.name === hit.starName)
    const rule = star ? majorStarRuleBook[star.name] : null
    return {
      title: `${palace.name}${formatStemBranch(palace)} · ${starLabel(star || { name: hit.starName })}`,
      body: rule
        ? `${rule.core}。${rule.use}。${rule.shadow}`
        : buildPalacePlainReading(palace),
      evidence: [`宫位：${formatPalacePosition(palace)}`, `星曜：${starLabel(star || { name: hit.starName })}`],
    }
  }

  if (hit.type === 'meta') {
    const report = buildPalaceAnalysis(palace.name, palace)
    return {
      title: `${palace.name}${formatStemBranch(palace)} · ${hit.metaLabel || hit.metaKey}`,
      body: hit.metaValue || buildPalacePlainReading(palace),
      evidence: report?.evidence?.slice(0, 3),
    }
  }

  return null
}

function selectPalace(palace) {
  if (!palace) return
  activePalaceIndex.value = palace.index
  nextTick(() => {
    if (journeyPhase.value === 'constellation') {
      animateZwPalaceHeadline(palaceHeadlineRef.value)
      return
    }
    animateZwSanfangPath(chartStageRef.value)
    animateZwPalaceHeadline(palaceHeadlineRef.value)
  })
}

function buildPalaceAnalysis(name, palace) {
  if (!palace) return null
  const theme = palaceReadingBook[name] ||
    palaceThemeMap[name] || { title: name, subject: '该宫位对应的人生主题' }
  const majorStars = palace.majorStars || []
  const mutagens = getMutagenStars(palace)
  const starText = summarizeStars(palace, 4) || '空宫'
  const surrounded = getSurroundedSet(palace)
  const starRules = majorStars.map((star) => majorStarRuleBook[star.name]).filter(Boolean)
  const brightStars = majorStars.filter((star) => getBrightnessScore(star) >= 2)
  const weakStars = majorStars.filter((star) => getBrightnessScore(star) < 0)
  const toughStars = getStarsByTypes(palace, ['tough'])
  const softStars = getStarsByTypes(palace, ['soft', 'helper', 'lucun'])
  const palaceMutagens = mutagens.map((star) => `${star.name}化${star.mutagen}`).join('、')
  const relationNames = buildSurroundedTitle(palace)
  const body = [
    `${formatPalacePosition(palace)}主看${theme.subject}。${majorStars.length ? `本宫主星为${majorStars.map((star) => starLabel(star)).join('、')}，核心取象为${starRules.map((rule) => rule.core).join('；')}。` : `本宫为空宫，不能单看本宫下结论，需借对宫${surrounded.opposite ? formatPalacePosition(surrounded.opposite) : '-'}及三方四正定性。`}`,
    brightStars.length
      ? `${brightStars.map((star) => `${star.name}${star.brightness}地`).join('、')}，表示本宫主题有可发挥的稳定条件。`
      : '',
    weakStars.length
      ? `${weakStars.map((star) => `${star.name}${star.brightness}地`).join('、')}，表示本宫主题有受限或先难后成的部分。`
      : '',
    palaceMutagens
      ? `本宫见${palaceMutagens}，四化会直接改写本宫主题的资源、推动、名声或牵挂。`
      : `本宫未见四化，重点转向主星亮度、辅煞配置与${relationNames}。`,
    softStars.length
      ? `辅曜见${softStars.map((star) => starLabel(star)).join('、')}，本宫有贵人、文书、资源或缓冲条件。`
      : '',
    toughStars.length
      ? `煞曜见${toughStars.map((star) => starLabel(star)).join('、')}，本宫议题会带现实压力、切割或消耗，需要看是否有辅曜与四化承接。`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return {
    key: name,
    title: theme.title,
    palace,
    headline: `${palace.name}${formatStemBranch(palace)}：${starText}`,
    body,
    tags: [
      formatStemBranch(palace),
      palace.decadal?.range
        ? `${palace.decadal.range[0]}-${palace.decadal.range[1]}岁大限`
        : '大限未读出',
      palace.isBodyPalace ? '身宫' : '',
      palace.isOriginalPalace ? '来因宫' : '',
    ].filter(Boolean),
    evidence: [
      `主星：${summarizeStarGroup(palace.majorStars, 8) || '空宫'}`,
      `辅星：${summarizeStarGroup(palace.minorStars, 8) || '少辅星'}`,
      `杂曜：${summarizeStarGroup(palace.adjectiveStars, 8) || '少杂曜'}`,
      `四化：${mutagens.map((star) => `${star.name}化${star.mutagen}`).join('、') || '无四化'}`,
      `三方四正：${relationNames}`,
    ],
  }
}

function buildPalacePlainReading(palace) {
  if (!palace) return '请先选择宫位。'
  return buildPalaceAnalysis(palace.name, palace)?.body || '当前宫位证据不足，需先核对排盘结果。'
}

function getSurroundedPalaceSummary(palace) {
  if (!chart.value || !palace) return '-'
  try {
    const relation = chart.value.surroundedPalaces(palace.name)
    return [
      relation?.target ? `本宫${relation.target.name}` : '',
      relation?.opposite ? `对宫${relation.opposite.name}` : '',
      relation?.wealth ? `财帛位${relation.wealth.name}` : '',
      relation?.career ? `官禄位${relation.career.name}` : '',
    ]
      .filter(Boolean)
      .join('、')
  } catch {
    return '-'
  }
}

function getSurroundedSet(palace) {
  if (!chart.value || !palace) return {}
  try {
    return chart.value.surroundedPalaces(palace.name) || {}
  } catch {
    return {}
  }
}

function buildAxisReading(soul, body) {
  if (!soul) return ''
  const soulStars = summarizeStarGroup(soul.majorStars, 4) || '空宫'
  const bodyStars = body ? summarizeStarGroup(body.majorStars, 4) || '空宫' : '未读出'
  const soulRules = (soul.majorStars || [])
    .map((star) => majorStarRuleBook[star.name]?.core)
    .filter(Boolean)
  const bodyRules = (body?.majorStars || [])
    .map((star) => majorStarRuleBook[star.name]?.core)
    .filter(Boolean)
  const sentence = [
    `命宫${formatStemBranch(soul)}见${soulStars}，这是人格底盘与第一层行动方式的主轴。`,
    soulRules.length
      ? `命宫取象重点为${soulRules.join('；')}。`
      : '命宫为空宫时，主轴需从对宫和三方四正借星定性。',
    body
      ? `身宫落${formatPalacePosition(body)}，见${bodyStars}，表示后天实际投入更容易落在${palaceReadingBook[body.name]?.subject || body.name}。`
      : '本盘未读取到身宫标记，命身合参暂缺一项关键证据。',
    bodyRules.length ? `身宫取象重点为${bodyRules.join('；')}。` : '',
    `命主${chart.value?.soul || '-'}、身主${chart.value?.body || '-'}、五行局${chart.value?.fiveElementsClass || '-'}，用于校验命身主线与整体气局。`,
  ]
  return sentence.filter(Boolean).join('')
}

function buildSurroundedTitle(palace) {
  const relation = getSurroundedSet(palace)
  return [
    relation.target ? `本宫${formatPalacePosition(relation.target)}` : '',
    relation.opposite ? `对宫${formatPalacePosition(relation.opposite)}` : '',
    relation.wealth ? `财帛位${formatPalacePosition(relation.wealth)}` : '',
    relation.career ? `官禄位${formatPalacePosition(relation.career)}` : '',
  ]
    .filter(Boolean)
    .join('、')
}

function buildSurroundedReading(palace) {
  const relation = getSurroundedSet(palace)
  const items = [
    ['本宫', relation.target],
    ['对宫', relation.opposite],
    ['财帛位', relation.wealth],
    ['官禄位', relation.career],
  ].filter(([, item]) => item)
  if (!items.length) return ''
  const emptyNames = items
    .filter(([, item]) => !(item.majorStars || []).length)
    .map(([, item]) => item.name)
  const mutagenNames = items.flatMap(([, item]) =>
    getMutagenStars(item).map((star) => `${item.name}${star.name}化${star.mutagen}`),
  )
  const strongNames = items.flatMap(([, item]) =>
    (item.majorStars || [])
      .filter((star) => getBrightnessScore(star) >= 2)
      .map((star) => `${item.name}${star.name}${star.brightness}`),
  )
  return [
    `${formatPalacePosition(palace)}的三方四正为${items.map(([label, item]) => `${label}${formatPalacePosition(item)}（${summarizeStarGroup(item.majorStars, 3) || '空宫'}）`).join('、')}。`,
    strongNames.length ? `其中${strongNames.join('、')}，说明相关宫位有较明确的发挥点。` : '',
    mutagenNames.length
      ? `三方四正见${mutagenNames.join('、')}，这些四化会把本宫主题拉到对应宫位处理。`
      : '',
    emptyNames.length
      ? `${emptyNames.join('、')}为空宫，判断时必须借对宫与三方四正，不能只看空宫字面。`
      : '',
  ]
    .filter(Boolean)
    .join('')
}

function buildSurroundedEvidenceLines(palace) {
  const relation = getSurroundedSet(palace)
  return [
    ['本宫', relation.target],
    ['对宫', relation.opposite],
    ['财帛位', relation.wealth],
    ['官禄位', relation.career],
  ]
    .filter(([, item]) => item)
    .map(
      ([label, item]) => `${label}${formatPalacePosition(item)}：${buildPalaceEvidenceLine(item)}`,
    )
}

function buildMutagenChainReading(mutagens) {
  if (!mutagens.length) return '本盘星曜对象未返回四化标记，因此不生成四化断语。'
  const grouped = mutagens.map(
    (item) => `${item.star}化${item.mutagen}落${item.palace}${item.branch}`,
  )
  const byMutagen = ['禄', '权', '科', '忌']
    .map((type) => mutagens.find((item) => item.mutagen === type))
    .filter(Boolean)
    .map(
      (item) =>
        `${item.mutagen}在${item.palace}，主${mutagenMeanings[item.mutagen] || '四化作用'}对应到${palaceReadingBook[item.palace]?.subject || item.palace}`,
    )
  return `本盘四化链路为${grouped.join('、')}。${byMutagen.join('；')}。这里仅按真实落宫说明资源、权责、名声和牵挂的流向，不做无法验证的吉凶分数。`
}

function buildSupportPressureTitle(palaces) {
  const soft = palaces.flatMap((palace) =>
    getStarsByTypes(palace, ['soft', 'helper', 'lucun', 'tianma']).map((star) => star.name),
  )
  const tough = palaces.flatMap((palace) =>
    getStarsByTypes(palace, ['tough']).map((star) => star.name),
  )
  return `助力${soft.length}项 / 压力${tough.length}项`
}

function buildSupportPressureReading(palaces) {
  if (!palaces.length) return ''
  const soft = palaces.flatMap((palace) =>
    getStarsByTypes(palace, ['soft', 'helper', 'lucun', 'tianma']).map(
      (star) => `${palace.name}${starLabel(star)}`,
    ),
  )
  const tough = palaces.flatMap((palace) =>
    getStarsByTypes(palace, ['tough']).map((star) => `${palace.name}${starLabel(star)}`),
  )
  return [
    soft.length
      ? `命盘核心宫位见${soft.join('、')}，代表贵人、文书、资源、移动或缓冲条件参与主线。`
      : '命盘核心宫位辅曜不明显，主线更依赖主星本身和三方四正承接。',
    tough.length
      ? `同时见${tough.join('、')}，表示核心主题并非单纯顺遂，会伴随压力、切割、突发或资源损耗，需要看化禄、化科、魁钺左右等是否能承接。`
      : '核心宫位煞曜压力不重，判断重点回到主星亮度、四化和限运。',
  ].join('')
}

function buildSupportPressureEvidence(palaces) {
  return palaces.map(
    (palace) =>
      `${formatPalacePosition(palace)}：辅曜 ${summarizeStarGroup(getStarsByTypes(palace, ['soft', 'helper', 'lucun', 'tianma']), 8) || '少'}；煞曜 ${summarizeStarGroup(getStarsByTypes(palace, ['tough']), 8) || '少'}`,
  )
}

function buildPalaceEvidenceLine(palace) {
  if (!palace) return '-'
  return [
    `主星${summarizeStarGroup(palace.majorStars, 8) || '空宫'}`,
    `辅星${summarizeStarGroup(palace.minorStars, 8) || '少'}`,
    `杂曜${summarizeStarGroup(palace.adjectiveStars, 8) || '少'}`,
    `四化${
      getMutagenStars(palace)
        .map((star) => `${star.name}化${star.mutagen}`)
        .join('、') || '无'
    }`,
    palace.decadal?.range ? `大限${palace.decadal.range[0]}-${palace.decadal.range[1]}岁` : '',
  ]
    .filter(Boolean)
    .join('；')
}

function uniquePalaces(items) {
  const seen = new Set()
  return (items || []).filter((item) => {
    if (!item || seen.has(item.index)) return false
    seen.add(item.index)
    return true
  })
}

function starLabel(star) {
  if (!star) return ''
  const brightness = star.brightness ? ` · ${star.brightness}` : ''
  const mutagen = star.mutagen ? ` · 化${star.mutagen}` : ''
  return `${star.name}${brightness}${mutagen}`
}

function summarizeStars(palace, max = 4) {
  if (!palace) return ''
  return [...(palace.majorStars || []), ...(palace.minorStars || [])]
    .slice(0, max)
    .map((star) => starLabel(star))
    .filter(Boolean)
    .join('、')
}

function summarizeStarGroup(stars = [], max = 8) {
  return stars
    .slice(0, max)
    .map((star) => starLabel(star))
    .filter(Boolean)
    .join('、')
}

function getMutagenStars(palace) {
  if (!palace) return []
  return [...(palace.majorStars || []), ...(palace.minorStars || [])].filter((star) => star.mutagen)
}

function getStarsByTypes(palace, types = []) {
  if (!palace) return []
  return [...(palace.minorStars || []), ...(palace.adjectiveStars || [])].filter((star) =>
    types.includes(star.type),
  )
}

function getBrightnessScore(star) {
  return brightnessLevel[star?.brightness] ?? 0
}

function getPalaceRelation(palace) {
  const relation = surroundedPalaces.value
  if (!relation || !palace) return ''
  if (relation.target?.index === palace.index) return 'target'
  if (relation.opposite?.index === palace.index) return 'opposite'
  if (relation.wealth?.index === palace.index) return 'wealth'
  if (relation.career?.index === palace.index) return 'career'
  return ''
}

function relStroke(relation) {
  const p = getChartPalette()
  if (relation === 'target') return p.strokeActive
  if (relation === 'opposite') return p.strokeOpp
  if (relation === 'wealth' || relation === 'career') return p.strokeSur
  return p.strokeIdle
}

function buildChartDefsSvg(starfield = false) {
  const p = getChartPalette()
  const starGlow = starfield
    ? `
      <filter id="zw-star-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="2.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="zw-node-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>`
    : ''
  return `
    <defs>
      <linearGradient id="zw-palace-active" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.stop}" stop-opacity="0.22" />
        <stop offset="100%" stop-color="${p.stop}" stop-opacity="0.08" />
      </linearGradient>
      <linearGradient id="zw-palace-opposite" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.stop}" stop-opacity="0.14" />
        <stop offset="100%" stop-color="${p.stop}" stop-opacity="0.05" />
      </linearGradient>
      <linearGradient id="zw-palace-surround" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.stop}" stop-opacity="0.1" />
        <stop offset="100%" stop-color="${p.stop}" stop-opacity="0.03" />
      </linearGradient>
      <filter id="zw-palace-glow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="${p.stop}" flood-opacity="0.18" />
      </filter>
      ${starGlow}
    </defs>
  `
}

function formatStemBranch(palace) {
  if (!palace) return ''
  return `${palace.heavenlyStem || ''}${palace.earthlyBranch || ''}`
}

function formatPalacePosition(palace) {
  if (!palace) return '-'
  return `${palace.name}${formatStemBranch(palace)}`
}

function buildChartPreviewSvg() {
  if (!chart.value) return ''

  const starfield = journeyPhase.value === 'starfield'
  const cellsSvg = palaceBoard.value.map((palace) => buildPreviewCellSvg(palace)).join('')
  const centerSvg = starfield ? buildCenterPanelSvgStarfield() : buildCenterPanelSvg()
  const svgClass = starfield ? 'zw-chart-svg zw-chart-svg--starfield' : 'zw-chart-svg'
  const bgRect = starfield
    ? ''
    : `<rect width="${chartPreviewLayout.width}" height="${chartPreviewLayout.height}" fill="${getChartPalette().bg}" rx="0" />`

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartPreviewLayout.width} ${chartPreviewLayout.height}" class="${svgClass}" role="img" aria-label="紫微斗数命盘">
      ${buildChartDefsSvg(starfield)}
      ${bgRect}
      <g>${cellsSvg}</g>
      ${centerSvg}
    </svg>
  `
}

function getPalaceHighlightTone(palace) {
  const tones = getChartPreviewTones()
  if (!palace || !activePalace.value) return tones.default
  const rel = getPalaceRelation(palace)
  if (rel === 'target') return tones.focused
  if (rel === 'opposite') return tones.opposite
  if (rel === 'wealth' || rel === 'career') return tones.surrounded
  return tones.default
}

function buildPreviewCellSvg(palace) {
  if (journeyPhase.value === 'starfield') {
    return buildPreviewCellSvgStarfield(palace)
  }

  const area = chartPreviewSlots[palace.area] || chartPreviewSlots.si
  const tone = getPalaceHighlightTone(palace)
  const cell = chartPreviewLayout.grid
  const inset = 6
  const visualW = cell.cellW - inset * 2
  const visualH = cell.cellH - inset * 2
  const isActive = activePalace.value?.index === palace.index
  const palaceLabel = `${palace.name || ''}${formatStemBranch(palace)}`
  const palette = getChartPalette()
  const palaceTextColors = getPalaceTextColors()
  const stroke = isActive ? palette.strokeActive : relStroke(getPalaceRelation(palace))
  const strokeWidth = isActive ? 1.4 : 1
  const corner = 0
  const divider = palette.divider
  const horoscopeBadges = getHoroscopeBadges(palace)
  const majorStars = buildStarLines(palace.majorStars, 28, 50, 25, 'major', 6)
  const minorStars = buildStarLines(palace.minorStars, 30, 136, 20, 'minor', 5)
  const adjectiveStars = buildRightStarLines(palace.adjectiveStars, cell.cellW - 30, 50, 18, 7)
  const horoscopeStars = buildStarLines(getHoroscopeStars(palace), 28, 207, 18, 'horoscope', 4)
  const mutagens = buildMutagenMarks(palace)
  const badges = horoscopeBadges
    .slice(0, 4)
    .map((badge, index) => buildBadgeSvg(222 + index * 68, 151, badge.label, badge.color))
    .join('')
  const ages = palace.ages?.length ? palace.ages.slice(0, 10).join(' ') : ''
  const decadal = palace.decadal?.range
    ? `${palace.decadal.range[0]} - ${palace.decadal.range[1]}`
    : ''
  const branch = `${palace.heavenlyStem || ''}${palace.earthlyBranch || ''}`
  const status = [palace.isBodyPalace ? '身宫' : '', palace.isOriginalPalace ? '来因' : ''].filter(
    Boolean,
  )

  return `
    <g
      class="zw-svg-palace${isActive ? ' is-active' : ''}"
      data-palace-index="${palace.index}"
      transform="translate(${area.x} ${area.y})"
      ${isActive ? 'filter="url(#zw-palace-glow)"' : ''}
    >
      <title>${escapeXml(`${palaceLabel} · 点击选中`)}</title>
      <rect class="zw-svg-palace__bg" x="${inset}" y="${inset}" width="${visualW}" height="${visualH}" fill="${tone.fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${corner}" />
      <rect class="zw-svg-palace__glass" x="${inset}" y="${inset}" width="${visualW}" height="${visualH}" fill="${tone.overlay}" stroke="none" rx="${corner}" pointer-events="none" />
      <line x1="28" y1="184" x2="${cell.cellW - 28}" y2="184" stroke="${divider}" />
      <line x1="322" y1="26" x2="322" y2="102" stroke="${divider}" />
      ${majorStars}
      ${mutagens}
      ${minorStars}
      ${adjectiveStars}
      ${horoscopeStars}
      ${badges}
      <text x="26" y="224" fill="${palaceTextColors.ages}" opacity="0.9" font-size="15" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(ages)}</text>
      <text x="${cell.cellW / 2}" y="164" text-anchor="middle" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">
        <tspan fill="${palaceTextColors.branch}" font-size="20" font-weight="900">${escapeXml(branch)} </tspan>
        <tspan fill="${palaceTextColors.name}" font-size="24" font-weight="900">${escapeXml(palace.name || '')}</tspan>
      </text>
      <text x="210" y="252" text-anchor="middle" fill="${palaceTextColors.decadal}" font-size="21" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(decadal)}</text>
      ${status
        .map((item, index) =>
          buildBadgeSvg(
            cell.cellW - 92,
            153 + index * 29,
            item,
            index === 0 ? palette.statusA : palette.statusB,
          ),
        )
        .join('')}
      <text x="${cell.cellW - 26}" y="268" text-anchor="end" fill="${palaceTextColors.changsheng}" font-size="19" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(`${palace.changsheng12 || ''}`)}</text>
      <text x="${cell.cellW - 26}" y="247" text-anchor="end" fill="${palaceTextColors.boshi}" opacity="0.88" font-size="16" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(`${palace.boshi12 || ''}`)}</text>
      <text x="${cell.cellW - 26}" y="226" text-anchor="end" fill="${palaceTextColors.jiangqian}" opacity="0.92" font-size="16" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(`${palace.jiangqian12 || ''}`)}</text>
      <text x="${cell.cellW - 26}" y="205" text-anchor="end" fill="${palaceTextColors.suiqian}" opacity="0.9" font-size="16" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(`${palace.suiqian12 || ''}`)}</text>
      <rect class="zw-svg-palace__hit" width="${cell.cellW}" height="${cell.cellH}" fill="transparent" pointer-events="all" />
    </g>
  `
}

function buildStarfieldStarColumn(stars = [], cx, startY, gap, group, max = 5) {
  const starClass =
    group === 'horoscope' ? 'zw-svg-star zw-svg-star--horoscope' : `zw-svg-star zw-svg-star--${group}`

  return stars
    .slice(0, max)
    .map((star, index) => {
      const style = resolveStarPaint(star, group)
      const opacity = group === 'minor' ? Math.min(style.opacity, 0.62) : style.opacity
      return `<text class="${starClass}" x="${cx}" y="${startY + index * gap}" text-anchor="middle" fill="${style.fill}" opacity="${opacity}" font-size="${style.fontSize}" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="${style.fontWeight}" filter="url(#zw-star-glow)">${escapeXml(star.name || '')}</text>`
    })
    .join('')
}

function buildPreviewCellSvgStarfield(palace) {
  const area = chartPreviewSlots[palace.area] || chartPreviewSlots.si
  const cell = chartPreviewLayout.grid
  const cx = cell.cellW / 2
  const isActive = activePalace.value?.index === palace.index
  const palaceLabel = `${palace.name || ''}${formatStemBranch(palace)}`
  const branch = `${palace.heavenlyBranch || ''}`
  const majorStars = buildStarfieldStarColumn(palace.majorStars, cx, 58, 28, 'major', 5)
  const minorStars = buildStarfieldStarColumn(palace.minorStars, cx, 168, 20, 'minor', 4)
  const mark = [palace.isBodyPalace ? '身' : '', palace.isOriginalPalace ? '因' : ''].filter(Boolean).join(' ')
  const markText = mark
    ? `<text x="${cx}" y="228" text-anchor="middle" fill="${getChartPalette().softAccent}" font-size="14" font-weight="800" opacity="0.72">${escapeXml(mark)}</text>`
    : ''

  return `
    <g
      class="zw-svg-palace zw-svg-palace--starfield${isActive ? ' is-active' : ''}"
      data-palace-index="${palace.index}"
      transform="translate(${area.x} ${area.y})"
      ${isActive ? 'filter="url(#zw-node-glow)"' : ''}
    >
      <title>${escapeXml(`${palaceLabel} · 点击选中`)}</title>
      <circle class="zw-svg-node" cx="${cx}" cy="132" r="${isActive ? 3.2 : 2.2}" fill="${isActive ? '#fbbf24' : getChartPalette().node}" opacity="${isActive ? 0.95 : 0.45}" filter="url(#zw-node-glow)" />
      ${majorStars}
      ${minorStars}
      <text x="${cx}" y="196" text-anchor="middle" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="800">
        <tspan fill="${getChartPalette().softAccent}" font-size="16" opacity="0.7">${escapeXml(branch)}</tspan>
        <tspan fill="${getChartPalette().name}" font-size="18" opacity="0.55"> ${escapeXml(palace.name || '')}</tspan>
      </text>
      ${markText}
      <rect class="zw-svg-palace__hit" width="${cell.cellW}" height="${cell.cellH}" fill="transparent" pointer-events="all" />
    </g>
  `
}

function buildCenterPanelSvgStarfield() {
  const center = chartPreviewLayout.center
  const cx = center.x + center.width / 2
  const cy = center.y + center.height / 2

  return `
    <g class="zw-svg-center zw-svg-center--starfield">
      ${buildCenterSanfangPathSvg()}
      <circle class="zw-svg-center-node" cx="${cx}" cy="${cy}" r="3.5" fill="#fbbf24" opacity="0.85" filter="url(#zw-node-glow)" />
      <text x="${cx}" y="${cy - 16}" text-anchor="middle" fill="${getChartPalette().accent}" font-size="22" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900" letter-spacing="0.18em">${escapeXml(chart.value.fiveElementsClass || '')}</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="${getChartPalette().label}" font-size="17" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="750">命主 ${escapeXml(chart.value.soul || '—')} · 身主 ${escapeXml(chart.value.body || '—')}</text>
    </g>
  `
}

function buildCenterPanelSvg() {
  const center = chartPreviewLayout.center
  const h = horoscope.value
  const leftRows = [
    ['五行局', chart.value.fiveElementsClass || '-'],
    ['四柱', chart.value.chineseDate || '-'],
    ['农历', chart.value.lunarDate || '-'],
    ['生肖', chart.value.zodiac || '-'],
    ['命主', chart.value.soul || '-'],
    ['命宫', chart.value.earthlyBranchOfSoulPalace || '-'],
  ]
  const rightRows = [
    ['年龄(虚岁)', h?.age?.nominalAge ? `${h.age.nominalAge} 岁` : '-'],
    ['阳历', chart.value.solarDate || '-'],
    [
      '时辰',
      `${chart.value.time || ''}${chart.value.timeRange ? `(${chart.value.timeRange})` : ''}`,
    ],
    ['星座', chart.value.sign || '-'],
    ['身主', chart.value.body || '-'],
    ['身宫', chart.value.earthlyBranchOfBodyPalace || '-'],
  ]
  const transitRows = h
    ? [
        ['农历', h.lunarDate || '-'],
        ['阳历', h.solarDate || '-'],
        ['大限', formatHoroscopeItem(h.decadal)],
        ['小限', formatHoroscopeItem(h.age)],
        ['流年', formatHoroscopeItem(h.yearly)],
        ['流月', formatHoroscopeItem(h.monthly)],
        ['流日', formatHoroscopeItem(h.daily)],
      ]
    : [
        ['状态', '未设置运限日期'],
        ['说明', '当前仅展示本命盘'],
      ]
  const leftSvg = buildCenterRowsSvg(leftRows, center.x + 58, center.y + 110, 36, 21)
  const rightSvg = buildCenterRowsSvg(rightRows, center.x + 500, center.y + 110, 36, 21)
  const transitSvg = buildCenterRowsSvg(transitRows, center.x + 58, center.y + 398, 36, 22)

  return `
    <g>
      <rect x="${center.x + 6}" y="${center.y + 6}" width="${center.width - 12}" height="${center.height - 12}" fill="${getChartPalette().palace}" stroke="${getChartPalette().centerStroke}" stroke-width="1" rx="0" />
      <rect x="${center.x + 7}" y="${center.y + 7}" width="${center.width - 14}" height="${center.height - 14}" fill="url(#zw-palace-active)" fill-opacity="0.35" stroke="none" rx="0" pointer-events="none" />
      ${buildCenterSanfangPathSvg()}
      <line x1="${center.x + 52}" y1="${center.y + 250}" x2="${center.x + center.width - 52}" y2="${center.y + 250}" stroke="${getChartPalette().divider}" />
      <line x1="${center.x + 52}" y1="${center.y + 350}" x2="${center.x + center.width - 52}" y2="${center.y + 350}" stroke="${getChartPalette().divider}" />
      <text x="${center.x + center.width / 2}" y="${center.y + 64}" text-anchor="middle" fill="${getChartPalette().title}" font-size="28" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">基本信息</text>
      <text x="${center.x + 370}" y="${center.y + 64}" text-anchor="end" fill="#e88ab8" font-size="28" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif">${escapeXml(form.gender === '女' ? '♀' : '♂')}</text>
      ${leftSvg}
      ${rightSvg}
      <text x="${center.x + center.width / 2}" y="${center.y + 332}" text-anchor="middle" fill="${getChartPalette().title}" font-size="28" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(h ? '运限信息' : '本命盘模式')}</text>
      ${transitSvg}
    </g>
  `
}

function buildCenterRowsSvg(rows, x, y, gap = 40, fontSize = 24) {
  return rows
    .map(([label, value], index) => {
      const labelFill = getCenterPanelLabelColors()[label] || getChartPalette().label
      const valueFill = getCenterPanelValueColors()[label] || getChartPalette().value
      return `
        <text x="${x}" y="${y + index * gap}" fill="${labelFill}" font-size="${fontSize}" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="750">${escapeXml(label)}：</text>
        <text x="${x + 116}" y="${y + index * gap}" fill="${valueFill}" font-size="${fontSize}" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(truncateText(value, 22))}</text>
      `
    })
    .join('')
}

function buildCenterSanfangPathSvg() {
  const idx = activePalace.value?.index
  if (idx == null || idx < 0) return ''

  const center = chartPreviewLayout.center
  const pad = 6
  const ox = center.x + pad
  const oy = center.y + pad
  const bw = center.width - pad * 2
  const bh = center.height - pad * 2
  const w = bw / 2
  const h = bh / 2
  const edgeInset = 5
  const clipX = center.x + pad
  const clipY = center.y + pad
  const clipW = bw
  const clipH = bh

  const points = [
    [ox + edgeInset, oy + bh - edgeInset],
    [ox + edgeInset, oy + h * 1.5],
    [ox + edgeInset, oy + h * 0.5],
    [ox + edgeInset, oy + edgeInset],
    [ox + w * 0.5, oy + edgeInset],
    [ox + w * 1.5, oy + edgeInset],
    [ox + bw - edgeInset, oy + edgeInset],
    [ox + bw - edgeInset, oy + h * 0.5],
    [ox + bw - edgeInset, oy + h * 1.5],
    [ox + bw - edgeInset, oy + bh - edgeInset],
    [ox + w * 1.5, oy + bh - edgeInset],
    [ox + w * 0.5, oy + bh - edgeInset],
  ]

  const fixIndex = (value) => ((value % 12) + 12) % 12
  const dgIdx = fixIndex(idx + 6)
  const q4Idx = fixIndex(idx + 4)
  const h4Idx = fixIndex(idx - 4)
  const dg = points[dgIdx]
  const self = points[idx]
  const q4 = points[q4Idx]
  const h4 = points[h4Idx]
  const pathD = `M ${dg[0]} ${dg[1]} L ${self[0]} ${self[1]} L ${q4[0]} ${q4[1]} L ${h4[0]} ${h4[1]} L ${self[0]} ${self[1]}`

  return `
    <g class="zw-svg-sfsz" aria-hidden="true">
      <defs>
        <clipPath id="zw-center-clip">
          <rect x="${clipX}" y="${clipY}" width="${clipW}" height="${clipH}" rx="10" />
        </clipPath>
      </defs>
      <path
        class="zw-svg-sfsz__line"
        clip-path="url(#zw-center-clip)"
        d="${pathD}"
        fill="none"
        stroke="${getChartPalette().strokeOpp}"
        stroke-width="0.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        pointer-events="none"
      />
    </g>
  `
}

function buildStarLines(stars = [], x, y, gap, group, max = 6) {
  const starClass =
    group === 'horoscope' ? 'zw-svg-star zw-svg-star--horoscope' : `zw-svg-star zw-svg-star--${group}`

  return stars
    .slice(0, max)
    .map((star, index) => {
      const style = resolveStarPaint(star, group)
      const brightness =
        group === 'major' && star.brightness
          ? `<tspan fill="${starBrightnessColor}" font-size="15" font-weight="750"> ${escapeXml(star.brightness)}</tspan>`
          : ''
      return `<text class="${starClass}" x="${x}" y="${y + index * gap}" fill="${style.fill}" opacity="${style.opacity}" font-size="${style.fontSize}" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="${style.fontWeight}"><tspan>${escapeXml(star.name || '')}</tspan>${brightness}</text>`
    })
    .join('')
}

function buildRightStarLines(stars = [], x, y, gap, max = 7) {
  return stars
    .slice(0, max)
    .map((star, index) => {
      const style = resolveStarPaint(star, 'minor')
      const fill = starColors[star.type] || starColors.adjective
      const opacity =
        star.type === 'tough' || star.type === 'flower' ? 0.9 : starTierStyles.adjective.opacity
      return `<text class="zw-svg-star zw-svg-star--adj" x="${x}" y="${y + index * gap}" text-anchor="end" fill="${fill}" opacity="${opacity}" font-size="${starTierStyles.adjective.fontSize}" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="${starTierStyles.adjective.fontWeight}">${escapeXml(starSvgLabel(star))}</text>`
    })
    .join('')
}

function buildMutagenMarks(palace) {
  return getMutagenStars(palace)
    .slice(0, 4)
    .map((star, index) => {
      const x = 78 + index * 30
      const color = mutagenColors[star.mutagen] || '#2563eb'
      return `
        <rect x="${x}" y="9" width="22" height="22" rx="5" fill="${color}" opacity="0.92" />
        <text x="${x + 11}" y="26" text-anchor="middle" fill="#ffffff" font-size="16" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(star.mutagen)}</text>
      `
    })
    .join('')
}

function buildBadgeSvg(x, y, label, color = '#6a4fe0') {
  const width = Math.max(48, String(label).length * 18 + 18)
  return `
    <rect x="${x}" y="${y}" width="${width}" height="25" rx="6" fill="${color}" opacity="0.92" />
    <text x="${x + width / 2}" y="${y + 18}" text-anchor="middle" fill="#ffffff" font-size="16" font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif" font-weight="900">${escapeXml(label)}</text>
  `
}

function getHoroscopeBadges(palace) {
  const h = horoscope.value
  if (!h) return []
  return horoscopeScopes
    .filter(([scope]) => scope !== 'hourly' || form.transitTimeIndex !== '')
    .map(([scope, label, color]) => {
      const item = h[scope]
      return item?.index === palace.index
        ? { label: `${label}·${item.heavenlyStem || ''}${item.earthlyBranch || ''}`, color }
        : null
    })
    .filter(Boolean)
}

function getHoroscopeStars(palace) {
  const h = horoscope.value
  if (!h) return []
  const items = [h.decadal, h.yearly, h.monthly, h.daily]
  if (form.transitTimeIndex !== '') items.push(h.hourly)
  return items.flatMap((item) => item?.stars?.[palace.index] || []).slice(0, 5)
}

function formatHoroscopeItem(item) {
  if (!item) return '-'
  return `${item.name || ''}${item.heavenlyStem || ''}${item.earthlyBranch || ''}`
}

function starSvgLabel(star, showBrightness = false) {
  if (!star) return ''
  const brightness = showBrightness && star.brightness ? star.brightness : ''
  return `${star.name}${brightness}`
}

async function downloadChartPreview() {
  if (!chart.value) return
  const svgBlob = new Blob([chartPreviewSvg.value], { type: 'image/svg+xml;charset=utf-8' })
  const blobUrl = URL.createObjectURL(svgBlob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = `ziwei-chart-${chartHash.value.replace(/^sha256:/, '') || 'chart'}.svg`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

function saveSnapshot() {
  if (!chart.value) return
  const snapshot = {
    id: chartHash.value,
    title: `${chart.value.solarDate} ${chart.value.time} · ${form.gender}`,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    summary: `${chart.value.fiveElementsClass} · 命主${chart.value.soul} · 身主${chart.value.body}`,
  }
  savedSnapshots.value = [
    snapshot,
    ...savedSnapshots.value.filter((item) => item.id !== snapshot.id),
  ].slice(0, 4)
}

function normalizeDateForIztro(value) {
  if (!value) return ''
  const match = String(value)
    .trim()
    .match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!match) return ''
  const [, year, month, day] = match
  return `${Number(year)}-${Number(month)}-${Number(day)}`
}

function truncateText(value, max = 18) {
  const text = String(value || '')
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(max - 1, 1))}…`
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

async function enterConsoleFromCinematic({ rememberSkip = false } = {}) {
  if (rememberSkip) prefs.skipEntryCinematic = true

  journeyPhase.value = 'console'
  pageReady.value = true
  await nextTick()

  if (cinematicCtrl) {
    cinematicCtrl.destroy()
    cinematicCtrl = null
  }

  await nextTick()
  revealZwConsoleShell(zwRoot.value, { animate: prefs.playGenerateAnimations })
}

async function goDirectToConsoleRemember(remember = false) {
  await enterConsoleFromCinematic({ rememberSkip: remember })
}

async function exitCinematicToConsole() {
  await enterConsoleFromCinematic()
}

async function enterConsoleFromConstellation() {
  if (!chart.value || journeyPhase.value !== 'constellation') return
  journeyPhase.value = 'console'
  chartRevealed.value = true
  await nextTick()
  animateZwPageBootFromCinematic(zwRoot.value)
  animateZwChartReveal(chartStageRef.value)
  animateZwSanfangPath(chartStageRef.value)
  animateZwReadContent(readBodyRef.value)
}

async function enterConstellationFromConsole() {
  if (!chart.value || journeyPhase.value !== 'console') return
  journeyPhase.value = 'constellation'
  await nextTick()
  starfieldRef.value?.playReveal()
}

async function beginCinematicJourney() {
  await nextTick()
  const root = cinematicLayerRef.value?.$el
  if (!root) {
    journeyPhase.value = 'console'
    pageReady.value = true
    return
  }

  cinematicCtrl = createZwCinematicController(root)
  await cinematicCtrl.playIntro()
  journeyPhase.value = 'intake'
  await cinematicCtrl.playIntakeEnter()
}

async function skipCinematic() {
  if (journeyPhase.value === 'intro') {
    if (cinematicCtrl) {
      await cinematicCtrl.skipIntroEarly()
    }
    journeyPhase.value = 'intake'
    if (cinematicCtrl) {
      await cinematicCtrl.playIntakeEnter()
    }
    return
  }

  if (journeyPhase.value === 'intake') {
    await enterConsoleFromCinematic()
    return
  }
}

async function handleCinematicGenerate() {
  if (!formReady.value || chartGenerating.value) return

  if (cinematicCtrl) {
    await cinematicCtrl.playWarpToGenerating()
  }

  journeyPhase.value = 'generating'
  pageReady.value = true
  await nextTick()

  await generateChart({ deferReveal: true, useCinematicPaipan: true })

  chartRevealed.value = true
  await nextTick()

  if (cinematicCtrl) {
    await cinematicCtrl.playArriveAtStarfield()
    cinematicCtrl.destroy()
    cinematicCtrl = null
  }

  journeyPhase.value = 'constellation'
  await nextTick()
  runChartRevealAnimations({ cinematic: true, starfield: true, animate: true })
}

function onCinematicKeydown(event) {
  if (!showEntryCinematic.value) return
  if (['console', 'constellation'].includes(journeyPhase.value)) return
  if (event.key === 'Enter' && journeyPhase.value === 'intro') {
    event.preventDefault()
    skipCinematic()
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    skipCinematic()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onCinematicKeydown)

  if (!showEntryCinematic.value) {
    journeyPhase.value = 'console'
    pageReady.value = true
    await nextTick()
    revealZwConsoleShell(zwRoot.value, { animate: prefs.playGenerateAnimations })
    return
  }

  pageReady.value = false
  await beginCinematicJourney()
})

watch(chartGenerating, (active) => {
  if (journeyPhase.value === 'generating') return
  cinematicCtrl?.pulseGenerating?.(active)

  if (paipanStepTimer) {
    clearInterval(paipanStepTimer)
    paipanStepTimer = null
  }
  if (active) {
    paipanStepIndex.value = 0
    const started = performance.now()
    paipanStepTimer = setInterval(() => {
      const elapsed = performance.now() - started
      const idx = paipanMicroSteps.findIndex((step, i) => {
        const next = paipanMicroSteps[i + 1]
        return elapsed >= step.at && (!next || elapsed < next.at)
      })
      paipanStepIndex.value = idx === -1 ? paipanMicroSteps.length - 1 : idx
    }, 48)
  } else {
    paipanStepIndex.value = 0
  }
})

watch(activeTab, async () => {
  if (!prefs.playGenerateAnimations) return
  await nextTick()
  animateZwReadContent(readBodyRef.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCinematicKeydown)
  if (paipanStepTimer) clearInterval(paipanStepTimer)
  cinematicCtrl?.destroy()
  cinematicCtrl = null

  const root = zwRoot.value
  if (!root) return
  cancelAnimations([
    root.querySelector('.zw-topbar'),
    root.querySelector('.zw-sidebar'),
    root.querySelector('.zw-workbench'),
    chartStageRef.value,
    readBodyRef.value,
    palaceHeadlineRef.value,
    submitButtonRef.value,
    ...(chartStageRef.value?.querySelectorAll('.zw-svg-palace') || []),
  ])
})
</script>

<template>
  <main
    ref="zwRoot"
    class="zw"
    :class="{
      'zw--ready': chart,
      'zw--page-ready': pageReady,
      'zw--journey-active': showEntryCinematic && ['intro', 'intake'].includes(journeyPhase),
      'zw--journey-generating': showEntryCinematic && journeyPhase === 'generating',
      'zw--journey-constellation': journeyPhase === 'constellation',
      'zw--journey-console': journeyPhase === 'console',
      'zw--constellation': journeyPhase === 'constellation' && !!chart,
    }"
  >
    <ZiweiCinematicLayer
      v-if="showEntryCinematic && ['intro', 'intake', 'generating'].includes(journeyPhase)"
      ref="cinematicLayerRef"
      v-model:form="form"
      :form-ready="formReady"
      :generating="chartGenerating"
      :time-options="timeOptions"
      @skip="skipCinematic"
      @direct-console="goDirectToConsoleRemember"
      @generate="handleCinematicGenerate"
    />

    <div v-if="showDashboardShell" class="zw-shell">
      <header class="zw-topbar">
        <div class="zw-brand">
          <img class="zw-brand__mark" :src="ziweiCompassIcon" alt="" aria-hidden="true" />
          <div>
            <strong>紫微斗数</strong>
            <small>ZI WEI DOU SHU</small>
          </div>
        </div>

        <div class="zw-hero__copy">
          <h1>
            {{
              chart
                ? `${chart.fiveElementsClass} · 命主${chart.soul} · 身主${chart.body}`
                : '紫微斗数命盘'
            }}
          </h1>
          <p>
            {{
              chart
                ? `${chart.solarDate} · ${chart.time}（${chart.timeRange}） · ${chart.chineseDate}`
                : '填写左侧资料，生成十二宫命盘'
            }}
          </p>
        </div>

        <div class="zw-topbar__actions">
          <div class="zw-stage__tools">
            <button
              v-if="chart && journeyPhase === 'console'"
              type="button"
              class="zw-icon-btn"
              @click="enterConstellationFromConsole"
            >
              <i class="bi bi-stars"></i>
              沉浸命盘
            </button>
            <RouterLink to="/ziwei/docs" class="zw-icon-btn">
              <i class="bi bi-book"></i>
              文档
            </RouterLink>
            <button type="button" class="zw-icon-btn" :disabled="!chart" @click="downloadChartPreview">
              <i class="bi bi-download"></i>
              下载
            </button>
            <button type="button" class="zw-icon-btn" :disabled="!chart" @click="activeTab = 'evidence'">
              <i class="bi bi-journal-check"></i>
              依据
            </button>
          </div>
        </div>
      </header>

      <aside class="zw-sidebar">
        <div class="zw-sidebar__surface">
          <form class="zw-form zw-form--sidebar" @submit.prevent="generateChart({ fromConsole: true })">
            <header class="zw-sidenav__head zw-sidenav__head--submit">
              <button
                ref="submitButtonRef"
                class="zw-submit"
                type="submit"
                :disabled="!formReady || chartGenerating"
              >
                <span v-if="chartGenerating" class="zw-submit__spinner" aria-hidden="true"></span>
                <img
                  v-else
                  class="zw-submit__mark"
                  :src="ziweiCompassIcon"
                  alt=""
                  aria-hidden="true"
                />
                {{ chartGenerating ? '排盘中…' : '生成命盘' }}
              </button>
            </header>

            <div class="zw-sidenav__body">
            <section class="zw-form-card">
              <div class="zw-form-card__title">基础资料</div>

              <div class="zw-seg" aria-label="历法">
                <button
                  type="button"
                  :class="{ active: form.calendar === 'solar' }"
                  @click="form.calendar = 'solar'"
                >
                  阳历
                </button>
                <button
                  type="button"
                  :class="{ active: form.calendar === 'lunar' }"
                  @click="form.calendar = 'lunar'"
                >
                  农历
                </button>
              </div>

              <div class="zw-field zw-field--birth-date">
                <div class="zw-field__label-row">
                  <span><i class="bi bi-cake2"></i>出生日期</span>
                  <label
                    class="zw-check--inline"
                    :class="{ 'is-visible': form.calendar === 'lunar' }"
                  >
                    <input
                      v-model="form.isLeapMonth"
                      type="checkbox"
                      :tabindex="form.calendar === 'lunar' ? 0 : -1"
                    />
                    <span>闰月</span>
                  </label>
                </div>
                <input
                  v-model="form.birthDate"
                  type="text"
                  inputmode="numeric"
                  placeholder="格式：1990/08/08，"
                  autocomplete="off"
                />
              </div>

              <label class="zw-field">
                <span><i class="bi bi-alarm"></i>出生时辰</span>
                <ZwTimeSelect
                  v-model="form.timeIndex"
                  :options="timeOptions"
                  placeholder="请选择时辰"
                  variant="console"
                />
              </label>

              <div class="zw-field zw-field--gender">
                <span><i class="bi bi-gender-ambiguous"></i>性别</span>
                <div class="zw-seg zw-seg--gender" role="group" aria-label="性别">
                  <button
                    type="button"
                    :class="{ active: form.gender === '男' }"
                    @click="form.gender = '男'"
                  >
                    男
                  </button>
                  <button
                    type="button"
                    :class="{ active: form.gender === '女' }"
                    @click="form.gender = '女'"
                  >
                    女
                  </button>
                </div>
              </div>
            </section>

            <details class="zw-advanced">
              <summary>
                <span><i class="bi bi-sliders"></i>生成与体验</span>
                <i class="bi bi-chevron-down"></i>
              </summary>
              <div class="zw-advanced__body">
                <label class="zw-check">
                  <input v-model="prefs.skipEntryCinematic" type="checkbox" />
                  <span>跳过开场动画（下次进入生效）</span>
                </label>
                <label class="zw-check">
                  <input v-model="prefs.buildStarfieldOnGenerate" type="checkbox" />
                  <span>生成时构建沉浸星图</span>
                </label>
                <label class="zw-check">
                  <input v-model="prefs.playGenerateAnimations" type="checkbox" />
                  <span>播放生成动画</span>
                </label>
              </div>
            </details>

            <details class="zw-advanced">
              <summary>
                <span><i class="bi bi-calendar4-event"></i>运限</span>
                <i class="bi bi-chevron-down"></i>
              </summary>
              <div class="zw-advanced__body">
                <label class="zw-field">
                  <span><i class="bi bi-calendar4-event"></i>运限日期</span>
                  <input
                    v-model="form.transitDate"
                    type="text"
                    inputmode="numeric"
                    placeholder="格式：1990/08/08，"
                    autocomplete="off"
                  />
                </label>

                <label class="zw-field">
                  <span>流时时辰</span>
                  <ZwTimeSelect
                    v-model="form.transitTimeIndex"
                    :options="timeOptions"
                    variant="console"
                    allow-empty
                    empty-label="不看流时"
                    placeholder="不看流时"
                  />
                </label>
              </div>
            </details>

            <details class="zw-advanced">
              <summary>
                <span><i class="bi bi-gear-wide-connected"></i>排盘参数</span>
                <i class="bi bi-chevron-down"></i>
              </summary>
              <div class="zw-advanced__body">
                <label class="zw-field">
                  <span>年分界</span>
                  <div class="zw-select-wrap">
                    <select v-model="form.yearDivide" class="zw-select">
                      <option value="normal">正月初一</option>
                      <option value="exact">立春</option>
                    </select>
                    <i class="bi bi-chevron-down zw-select-wrap__chev" aria-hidden="true"></i>
                  </div>
                </label>
                <label class="zw-field">
                  <span>晚子时</span>
                  <div class="zw-select-wrap">
                    <select v-model="form.dayDivide" class="zw-select">
                      <option value="forward">按次日</option>
                      <option value="current">按当日</option>
                    </select>
                    <i class="bi bi-chevron-down zw-select-wrap__chev" aria-hidden="true"></i>
                  </div>
                </label>
                <label class="zw-check">
                  <input v-model="form.fixLeap" type="checkbox" />
                  <span>修正农历闰月</span>
                </label>
              </div>
            </details>

            <div v-if="submitted && chartError" class="zw-error">{{ chartError }}</div>
            </div>
          </form>
        </div>
      </aside>

      <section class="zw-workbench">
        <section class="zw-stage">
          <div
            v-if="chartGenerating"
            class="zw-stage__placeholder zw-stage__placeholder--loading"
            aria-live="polite"
          >
            <div class="zw-stage__placeholder-warp" aria-hidden="true">
              <span class="zw-stage__placeholder-warp-ring zw-stage__placeholder-warp-ring--a"></span>
              <span class="zw-stage__placeholder-warp-ring zw-stage__placeholder-warp-ring--b"></span>
              <span class="zw-stage__placeholder-warp-ring zw-stage__placeholder-warp-ring--c"></span>
            </div>
            <div class="zw-stage__placeholder-ring" aria-hidden="true">
              <img :src="ziweiCompassIcon" alt="" />
            </div>
            <strong>演星排盘中…</strong>
            <span class="zw-stage__paipan-step">
              {{ paipanMicroSteps[paipanStepIndex]?.text }}
            </span>
            <span class="zw-stage__paipan-sub">
              {{ paipanMicroSteps[paipanStepIndex]?.sub }}
            </span>
            <template v-if="!showEntryCinematic">
              <div class="zw-stage__paipan-dots" aria-hidden="true">
                <span
                  v-for="i in 12"
                  :key="i"
                  class="zw-stage__paipan-dot"
                  :class="{ 'is-lit': paipanPalaceProgress >= i }"
                ></span>
              </div>
              <span class="zw-stage__paipan-counter">
                {{ paipanStepIndex + 1 }} / {{ paipanMicroSteps.length }}
              </span>
            </template>
          </div>

          <div v-else-if="!chart" class="zw-stage__placeholder">
            <div class="zw-stage__placeholder-ring" aria-hidden="true">
              <img :src="ziweiCompassIcon" alt="" />
            </div>
            <strong>等待生成命盘</strong>
            <span>填写左侧出生资料，点击「生成命盘」</span>
          </div>

          <template v-else>
            <div
              ref="chartStageRef"
              class="zw-stage__chart zw-chart-interactive"
              :class="{ 'is-revealed': chartRevealed }"
              role="application"
              aria-label="紫微命盘，点击宫位选中，方向键切换宫位"
              tabindex="0"
              @click="onChartPalaceClick"
              @keydown="onChartKeydown"
              v-html="chartPreviewSvg"
            />

            <Transition name="zw-hint" mode="out-in">
              <p
                :key="`${activePalace?.index ?? 'none'}-${activePalace?.name ?? ''}`"
                class="zw-stage__chart-hint"
              >
                当前：<strong>{{ activePalace?.name }}{{ formatStemBranch(activePalace) }}</strong>
                · {{ getPalacePreviewStars(activePalace) }}
                <span v-if="activePalace?.isBodyPalace"> · 身宫</span>
                <span v-if="activePalace?.isOriginalPalace"> · 来因宫</span>
                <span v-if="activeRelationSummary" class="zw-stage__chart-hint-sub">
                  · 三方四正：{{ activeRelationSummary.opposite }} / {{ activeRelationSummary.wealth }} /
                  {{ activeRelationSummary.career }}
                </span>
                <span class="zw-stage__chart-hint-sub"> · 中宫折线为三方四正指示 · 点击选中</span>
              </p>
            </Transition>
          </template>
        </section>

        <section v-if="chart" class="zw-read-dock">
          <header class="zw-read__head">
            <div>
              <span class="zw-block__label">当前宫位</span>
              <h2 ref="palaceHeadlineRef" class="zw-read__palace">
                {{
                  activePalace
                    ? `${activePalace.name}${formatStemBranch(activePalace)}`
                    : '选择宫位'
                }}
              </h2>
            </div>
            <p class="zw-read__hint">
              {{ structureSummary?.headline || '点击命盘宫位查看解读' }}
            </p>
          </header>

          <nav class="zw-tabs" aria-label="解读分区">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <i class="bi" :class="tab.icon"></i>
              {{ tab.label }}
            </button>
          </nav>

          <div ref="readBodyRef" class="zw-read__body">
            <Transition name="zw-tab" mode="out-in">
              <div v-if="activeTab === 'overview'" key="overview" class="zw-read-grid">
                <article class="zw-block zw-block--wide">
                  <span class="zw-block__label">核心判断</span>
                  <h3>{{ structureSummary?.headline }}</h3>
                  <p v-for="point in structureSummary?.points" :key="point">{{ point }}</p>
                </article>

                <article v-if="activePalace" class="zw-block">
                  <span class="zw-block__label">当前宫位</span>
                  <h3>{{ selectedPalaceReport?.headline }}</h3>
                  <div class="zw-tags">
                    <span v-for="tag in selectedPalaceTags" :key="tag">{{ tag }}</span>
                  </div>
                  <p>{{ selectedPalaceReport?.body }}</p>
                  <ul class="zw-list">
                    <li v-for="line in selectedPalaceReport?.evidence" :key="line">{{ line }}</li>
                  </ul>
                </article>

                <article v-for="item in resultHighlights" :key="item.label" class="zw-block">
                  <span class="zw-block__label">{{ item.label }}</span>
                  <h3>{{ item.title }}</h3>
                  <p>{{ item.body }}</p>
                  <ul class="zw-list">
                    <li v-for="line in item.evidence" :key="line">{{ line }}</li>
                  </ul>
                </article>

                <article v-if="horoscopeOverviewRows.length" class="zw-block">
                  <span class="zw-block__label">运限落宫</span>
                  <h3>{{ horoscope?.solarDate }} · {{ horoscope?.lunarDate }}</h3>
                  <div v-for="item in horoscopeOverviewRows" :key="item.label" class="zw-mini">
                    <strong>{{ item.label }}{{ item.nominalAge ? ` ${item.nominalAge}` : '' }}</strong>
                    <p>
                      {{ item.branch }}落{{ item.palace }}，流曜：{{ item.stars }}；四化：{{
                        item.mutagen
                      }}
                    </p>
                  </div>
                </article>
              </div>

              <div v-else-if="activeTab === 'themes'" key="themes" class="zw-read-grid">
                <article v-for="item in themeReports" :key="item.key" class="zw-block">
                  <span class="zw-block__label">{{ item.title }}</span>
                  <h3>{{ item.headline }}</h3>
                  <p>{{ item.body }}</p>
                  <div class="zw-tags">
                    <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
                  </div>
                  <ul class="zw-list">
                    <li v-for="evidence in item.evidence" :key="evidence">{{ evidence }}</li>
                  </ul>
                </article>
              </div>

              <div v-else-if="activeTab === 'palaces'" key="palaces" class="zw-table">
                <article
                  v-for="palace in palaceOverviewRows"
                  :key="`${palace.index}-${palace.name}`"
                  class="zw-table__row"
                  :class="{ active: activePalace?.index === palace.index }"
                  @click="selectPalace(palace)"
                >
                  <strong>{{ palace.name }}</strong>
                  <span>{{ palace.heavenlyStem }}{{ palace.earthlyBranch }}</span>
                  <p>{{ palace.mainStars }}</p>
                  <p>{{ palace.minorText }} · {{ palace.mutagenText }} · {{ palace.decadalText }}</p>
                </article>
              </div>

              <div v-else key="evidence" class="zw-read-grid">
                <article class="zw-block">
                  <span class="zw-block__label">排盘依据</span>
                  <div v-for="item in assuranceItems" :key="item.label" class="zw-mini">
                    <span
                      class="zw-badge"
                      :class="item.tone === 'ok' ? 'ok' : item.tone === 'warn' ? 'warn' : ''"
                    >
                      {{ item.status }}
                    </span>
                    <strong>{{ item.label }}</strong>
                    <p>{{ item.body }}</p>
                  </div>
                  <dl class="zw-dl">
                    <div v-for="item in evidenceRows" :key="item.label">
                      <dt>{{ item.label }}</dt>
                      <dd>{{ item.value }}</dd>
                    </div>
                  </dl>
                </article>

                <article class="zw-block">
                  <span class="zw-block__label">输入与标准化</span>
                  <dl class="zw-dl">
                    <div v-for="item in inputSummaryRows" :key="item.label">
                      <dt>{{ item.label }}</dt>
                      <dd>{{ item.value }}</dd>
                    </div>
                    <div>
                      <dt>阳历</dt>
                      <dd>{{ normalizedBirth?.solar }}</dd>
                    </div>
                    <div>
                      <dt>农历</dt>
                      <dd>{{ normalizedBirth?.lunar }}</dd>
                    </div>
                    <div>
                      <dt>干支</dt>
                      <dd>{{ normalizedBirth?.ganzhi }}</dd>
                    </div>
                    <div>
                      <dt>时辰</dt>
                      <dd>{{ normalizedBirth?.time }}</dd>
                    </div>
                    <div>
                      <dt>生肖/星座</dt>
                      <dd>{{ normalizedBirth?.zodiac }} / {{ normalizedBirth?.sign }}</dd>
                    </div>
                  </dl>
                  <button type="button" class="zw-icon-btn zw-save-btn" @click="saveSnapshot">
                    <i class="bi bi-bookmark-plus"></i>
                    保存快照
                  </button>
                </article>

                <article v-if="activePalace" class="zw-block">
                  <span class="zw-block__label">当前宫位证据</span>
                  <dl class="zw-dl">
                    <div v-for="item in selectedPalaceLedgerRows" :key="item.label">
                      <dt>{{ item.label }}</dt>
                      <dd>{{ item.value }}</dd>
                    </div>
                  </dl>
                </article>
              </div>
            </Transition>
          </div>
        </section>
      </section>
    </div>

    <section
      v-if="journeyPhase === 'constellation' && chart"
      class="zw-cosmos-stage"
      tabindex="0"
      @keydown="onChartKeydown"
    >
      <div class="zw-stage__cosmos" aria-hidden="true">
        <span v-for="i in 72" :key="i" class="zw-stage__cosmos-star" :style="{ '--ci': i }"></span>
      </div>
      <ZiweiStarfieldChart
        ref="starfieldRef"
        :chart="chart"
        :palace-areas="palaceAreas"
        :horoscope="horoscope"
        :horoscope-scopes="horoscopeScopes"
        :include-hourly="form.transitTimeIndex !== ''"
        :active-palace-index="activePalaceIndex"
        :resolve-tooltip="resolveStarfieldTooltip"
        @select-palace="selectPalaceByIndex"
      />
    </section>

    <Teleport to="body">
      <div
        v-if="journeyPhase === 'constellation' && chart"
        class="zw-cosmos-bar"
        role="toolbar"
        aria-label="命盘导航"
      >
        <button type="button" class="zw-cosmos-bar__btn" @click="enterConsoleFromConstellation">
          <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
          进入紫微控制台
        </button>
      </div>
    </Teleport>
  </main>
</template>
