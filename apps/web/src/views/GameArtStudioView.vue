<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import SharePublishDialog from '@/features/share/components/SharePublishDialog.vue'
import { readImageFile } from '@/features/design-workshop/imageWorkshop'
import { useCanvasDeck } from '@/features/creative-studios/useCanvasDeck'
import { useCreativeImageJob } from '@/features/creative-studios/useCreativeImageJob'
import { useStudioMotion } from '@/features/creative-studios/useStudioMotion'
import { downloadAuthenticatedMedia } from '@/services/authenticatedMedia'
import { getScopedLocalItem, setScopedLocalItem } from '@/services/scopedLocalStorage'
import { listMyShareAssets, submitShareItem } from '@/services/shareGallery'
import { listPromptLibrary } from '@/services/promptLibrary'
import notificationService from '@/services/notification'

const SETTINGS_KEY = 'game-art-studio-v1'

const ASSET_TYPES = [
  {
    id: 'character',
    label: '角色',
    en: 'CHARACTER',
    icon: 'bi-person-bounding-box',
    placeholder: '描述角色：种族 / 职业 / 服装结构 / 配色 / 武器道具 / 气质…',
    defaultPrompt: '一名在浮空遗迹中探索的星轨机械师，服装结构清晰，装备可拆分，造型具有强记忆点',
    examples: [
      { label: '暗夜刺客', text: '身披暗紫斗篷的精灵刺客，双持短刃，轻甲与皮革混搭，冷色调，剪影凌厉' },
      { label: 'Q 版法师', text: '圆润可爱的 Q 版小法师，超大帽子遮住半张脸，发光法杖，明快糖果色' },
      { label: '重装骑士', text: '全身板甲的圣殿骑士，鎏金纹章，巨剑拄地，庄重史诗感' },
    ],
    aspects: ['3:4', '1:1', '9:16'],
    defaultAspect: '3:4',
    selects: [
      {
        key: 'pose',
        label: '呈现方式',
        options: [
          { id: 'full-body', label: '全身立绘', prompt: '完整全身立绘，主体居中无裁切，脚部完整' },
          { id: 'turnaround', label: '三视图', prompt: '同一角色的正面、侧面、背面三视图并排，比例严格一致' },
          { id: 'bust', label: '半身特写', prompt: '半身像特写，突出面部神态与上身服装细节' },
          { id: 'action', label: '动态动作', prompt: '战斗动态姿势，动作张力强，剪影依然清晰可读' },
        ],
      },
    ],
    toggles: [{ key: 'transparent', label: '透明背景', prompt: '纯净透明背景，主体边缘干净' }],
    line: '游戏角色概念设计，轮廓剪影可识别，服装与装备结构清晰可拆解，适合建模与立绘使用。',
    shareCategory: 'illustration',
  },
  {
    id: 'environment',
    label: '场景',
    en: 'ENVIRONMENT',
    icon: 'bi-image',
    placeholder: '描述场景：地点 / 建筑结构 / 标志物 / 氛围 / 色调…',
    defaultPrompt: '悬浮在云海之上的古代遗迹群，断裂石桥与青铜巨门，藤蔓缠绕，神秘幽蓝辉光',
    examples: [
      { label: '雨夜霓虹街', text: '赛博朋克雨夜街道，霓虹招牌倒映在积水路面，蒸汽从井盖升起' },
      { label: '雪山营地', text: '暴风雪中的登山者营地，帐篷透出暖光，远处冰峰高耸' },
      { label: '地下宝库', text: '堆满金币与神器的地下宝库，火把光影摇曳，巨龙盘踞暗处' },
    ],
    aspects: ['16:9', '3:2', '1:1'],
    defaultAspect: '16:9',
    selects: [
      {
        key: 'view',
        label: '视角',
        options: [
          { id: 'wide', label: '广角全景', prompt: '广角全景构图，前中后景层次分明，有视觉引导线' },
          { id: 'isometric', label: '等距俯瞰', prompt: '等距 isometric 视角，适合策略与模拟游戏' },
          { id: 'side', label: '横版卷轴', prompt: '横版卷轴游戏场景，可行走平台层次清晰' },
          { id: 'topdown', label: '俯视地图', prompt: '自上而下俯视角，适合 RPG 地图与关卡俯瞰' },
        ],
      },
      {
        key: 'mood',
        label: '时间氛围',
        options: [
          { id: 'day', label: '白昼', prompt: '白昼明亮自然光照' },
          { id: 'dusk', label: '黄昏', prompt: '黄昏暖色逆光，长投影' },
          { id: 'night', label: '夜晚', prompt: '夜晚冷色基调与人工光源点缀' },
          { id: 'storm', label: '雨雾', prompt: '雨雾弥漫的湿润氛围，空气透视强' },
        ],
      },
    ],
    toggles: [],
    line: '游戏场景概念图，空间纵深与视觉引导明确，光影氛围完整，可作为关卡美术基准。',
    shareCategory: 'landscape',
  },
  {
    id: 'prop',
    label: '道具',
    en: 'PROP',
    icon: 'bi-hammer',
    placeholder: '描述道具：类型 / 材质 / 稀有度 / 结构与工艺细节…',
    defaultPrompt: '一把镶嵌蓝色能量核心的单手圣剑，剑柄缠绕鎏金藤纹，传说级稀有度',
    examples: [
      { label: '远古卷轴', text: '泛黄的远古魔法卷轴，火漆封印，边缘符文微微发光' },
      { label: '生命药水', text: '玻璃瓶装的鲜红生命药水，软木塞，瓶身有气泡与高光' },
      { label: '秘银宝箱', text: '秘银包角的橡木宝箱，锁扣精致，箱缝透出金光' },
    ],
    aspects: ['1:1', '4:3'],
    defaultAspect: '1:1',
    selects: [
      {
        key: 'layout',
        label: '展示方式',
        options: [
          { id: 'single', label: '单件展示', prompt: '单件道具居中完整展示' },
          { id: 'sheet', label: '多角度图鉴', prompt: '同一道具的多角度视图排列成设定图鉴' },
          { id: 'set', label: '同系列一组', prompt: '同一风格系列的一组道具整齐排列，风格严格统一' },
        ],
      },
    ],
    toggles: [{ key: 'transparent', label: '透明背景', prompt: '纯净透明背景，主体边缘干净' }],
    line: '游戏道具设计，材质与工艺细节可辨识，稀有度气质匹配，可直接进入资产管线。',
    shareCategory: 'other',
  },
  {
    id: 'ui',
    label: '游戏 UI',
    en: 'GAME UI',
    icon: 'bi-window-stack',
    placeholder: '描述界面：游戏类型 / 信息内容 / 控件 / 世界观氛围…',
    defaultPrompt: '东方仙侠 MMORPG 的界面，水墨与鎏金装饰边框，半透明面板，界面文案使用简洁中文',
    examples: [
      { label: '科幻 HUD', text: '硬科幻太空射击游戏的战斗界面，全息投影质感，青色描边，信息密度高' },
      { label: '休闲主菜单', text: '休闲消除手游主菜单，奶油色圆角卡片，大按钮，活泼气泡装饰' },
      { label: '暗黑背包', text: '暗黑风 ARPG 背包界面，铁艺格子，羊皮纸属性面板，血红强调色' },
    ],
    aspects: ['16:9', '9:16', '4:3'],
    defaultAspect: '16:9',
    selects: [
      {
        key: 'screen',
        label: '界面类型',
        options: [
          { id: 'hud', label: '战斗 HUD', prompt: '战斗 HUD 界面：血条、技能栏、小地图、任务追踪等控件布局完整' },
          { id: 'menu', label: '主菜单', prompt: '主菜单界面：游戏标题、开始/继续/设置入口、主视觉背景' },
          { id: 'inventory', label: '背包库存', prompt: '背包/库存界面：物品格子系统、装备栏、角色属性面板' },
          { id: 'shop', label: '商店', prompt: '游戏内商店界面：商品卡片、货币栏、购买按钮、限时促销位' },
          { id: 'result', label: '结算弹窗', prompt: '战斗结算弹窗：评级星级、奖励列表、经验条、按钮组' },
        ],
      },
    ],
    toggles: [],
    line: '完整游戏界面设计稿，控件层级与信息架构清晰，组件风格统一，可直接指导 UI 制作与切图。',
    shareCategory: 'other',
  },
  {
    id: 'icon',
    label: '图标',
    en: 'ICON',
    icon: 'bi-gem',
    placeholder: '描述图标：主题元素 / 颜色倾向 / 品质气质…',
    defaultPrompt: '一枚燃烧的火焰剑刃技能图标，橙红渐变能量，深色底座衬托',
    examples: [
      { label: '冰霜法术', text: '冰霜新星法术图标，六角冰晶绽放，青蓝通透质感' },
      { label: '金币货币', text: '游戏金币货币图标，立体堆叠，边缘高光，饱满金黄' },
      { label: '王者徽章', text: '王者段位成就徽章，翼形装饰环绕盾牌，紫金配色' },
    ],
    aspects: ['1:1'],
    defaultAspect: '1:1',
    selects: [
      {
        key: 'kind',
        label: '图标类型',
        options: [
          { id: 'skill', label: '技能图标', prompt: '技能图标，能量与动势表现强' },
          { id: 'item', label: '物品图标', prompt: '物品图标，实体感与材质细节清晰' },
          { id: 'currency', label: '货币/宝石', prompt: '货币与宝石图标，质感通透饱满' },
          { id: 'badge', label: '成就徽章', prompt: '成就徽章图标，构图对称，仪式感强' },
        ],
      },
      {
        key: 'layout',
        label: '排列',
        options: [
          { id: 'single', label: '单个大图', prompt: '单个图标居中展示' },
          { id: 'grid', label: '3x3 图标集', prompt: '同一风格的 9 个不同图标排成 3x3 网格，风格与光源严格统一' },
        ],
      },
    ],
    toggles: [{ key: 'transparent', label: '透明背景', prompt: '纯净透明背景，主体边缘干净' }],
    line: '游戏图标设计，小尺寸缩放后剪影依旧清晰可读，边缘干净，统一光源方向。',
    shareCategory: 'other',
  },
  {
    id: 'texture',
    label: '贴图',
    en: 'TEXTURE',
    icon: 'bi-grid-3x3',
    placeholder: '描述贴图：材质 / 风化程度 / 颜色 / 时代感…',
    defaultPrompt: '中世纪城堡的灰色石砖墙面，砖缝深邃，边缘轻微风化，苔藓点缀',
    examples: [
      { label: '古旧木纹', text: '饱经风霜的深色橡木板，木纹清晰，有钉孔与划痕' },
      { label: '科幻面板', text: '科幻飞船外壳金属面板，拼接线与铆钉，哑光灰蓝' },
      { label: '草地地表', text: '茂密草地地表，混有小石子与蒲公英，俯视视角' },
    ],
    aspects: ['1:1'],
    defaultAspect: '1:1',
    selects: [
      {
        key: 'material',
        label: '材质类型',
        options: [
          { id: 'stone', label: '石材', prompt: '石材质感，颗粒与裂纹自然' },
          { id: 'wood', label: '木纹', prompt: '木质纹理，年轮与纤维方向一致' },
          { id: 'metal', label: '金属', prompt: '金属质感，反射与磨损合理' },
          { id: 'fabric', label: '布料', prompt: '布料编织纹理，经纬清晰' },
          { id: 'ground', label: '地表', prompt: '自然地表材质，元素分布均匀不重复' },
          { id: 'scifi', label: '科幻', prompt: '科幻硬面板材，拼缝与功能细节合理' },
        ],
      },
    ],
    toggles: [
      { key: 'seamless', label: '无缝平铺', prompt: '无缝可平铺贴图（seamless tileable），四边完全衔接，无明显重复感' },
    ],
    line: '游戏贴图素材，均匀漫反射照明，无高光热点、无阴影投射、无景深、无透视畸变。',
    shareCategory: 'other',
  },
]

// swatch 是纯 CSS 背景，用色彩气质示意风格，避免加载图片资源。
const STYLE_OPTIONS = [
  {
    id: 'stylized-3d',
    label: '风格化 3D',
    prompt: '风格化 3D 渲染，形体夸张有度，颜色饱满',
    swatch: 'radial-gradient(90% 120% at 30% 20%, #ffb54d 0%, #ff7847 34%, #35dcff 100%)',
  },
  {
    id: 'anime',
    label: '动漫赛璐璐',
    prompt: '动漫赛璐璐上色，干净色块与利落描边',
    swatch: 'linear-gradient(135deg, #ff9ecf 0 38%, #ffd7e8 38% 62%, #7cc7ff 62% 100%)',
  },
  {
    id: 'realistic',
    label: '写实次世代',
    prompt: '写实次世代品质，物理正确的材质与光照',
    swatch: 'linear-gradient(160deg, #d8dee5 0%, #6f7d8c 42%, #232c36 100%)',
  },
  {
    id: 'pixel-art',
    label: '像素美术',
    prompt: '精细像素美术，色板克制，像素对齐',
    swatch: 'repeating-conic-gradient(#57e3a2 0% 25%, #275d8c 0% 50%) 0 0 / 12px 12px',
  },
  {
    id: 'hand-painted',
    label: '手绘厚涂',
    prompt: '手绘厚涂质感，笔触可见，暖色光影',
    swatch: 'radial-gradient(120% 150% at 70% 30%, #f7d9a8 0%, #c98a5b 46%, #5c3a2e 100%)',
  },
]

const {
  authStore,
  modelId, models, status, error, running, cancelling, historyLoading, historyHasMore,
  outputs, activeOutput, outputJobIds, outputKinds, batchProgress,
  initialize, generate: generateImage, cancel: cancelGeneration,
  deleteOutput, formatCostEstimate, loadMoreHistory,
} = useCreativeImageJob({
  source: 'game-art-studio',
  featureKey: 'ai.gameDesign',
  jobKindPrefix: 'game-art',
  // 任务 kind 按资产类型细分（game-art-character-generation…），
  // 历史记录据此归类到各自的 tab，不再六类混在一条胶片里。
  kindVariants: ASSET_TYPES.map((type) => type.id),
})

const assetType = ref('character')
const style = ref('stylized-3d')
const imageCount = ref(1)
const hdMode = ref(true)
const negative = ref('模糊，低清晰度，错误肢体，文字，水印，照片样机，裁切主体')
const sourcePreview = ref('')
const inputFile = ref(null)
const referenceUrl = ref('')
const fileInput = ref(null)
const studioRoot = ref(null)
const localError = ref('')
const showGrid = ref(true)
const fullscreenOpen = ref(false)
const libraryOpen = ref(false)
const libraryTab = ref('history')
const myAssets = ref([])
const assetsLoading = ref(false)
const assetsLoaded = ref(false)
const publishOpen = ref(false)
const publishTargetUrl = ref('')
const submittingShare = ref(false)
const pendingDeleteUrl = ref('')
const promptItems = ref([])
const promptLoading = ref(false)
const promptHasMore = ref(false)
const promptPage = ref(1)
const promptQuery = ref('')
const promptLoaded = ref(false)
let pendingDeleteTimer = 0

const typeState = reactive(
  Object.fromEntries(
    ASSET_TYPES.map((type) => [
      type.id,
      {
        prompt: type.defaultPrompt,
        aspect: type.defaultAspect,
        selects: Object.fromEntries((type.selects || []).map((item) => [item.key, item.options[0].id])),
        toggles: Object.fromEntries((type.toggles || []).map((item) => [item.key, item.key === 'seamless'])),
      },
    ]),
  ),
)

// —— 刷新不丢状态：恢复各资产类型的草稿与全局参数 ——
try {
  const saved = JSON.parse(getScopedLocalItem(SETTINGS_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    if (ASSET_TYPES.some((type) => type.id === saved.assetType)) assetType.value = saved.assetType
    if (STYLE_OPTIONS.some((item) => item.id === saved.style)) style.value = saved.style
    if ([1, 2, 3, 4].includes(saved.imageCount)) imageCount.value = saved.imageCount
    if (typeof saved.hdMode === 'boolean') hdMode.value = saved.hdMode
    if (typeof saved.negative === 'string') negative.value = saved.negative
    if (typeof saved.showGrid === 'boolean') showGrid.value = saved.showGrid
    if (typeof saved.referenceUrl === 'string' && saved.referenceUrl) referenceUrl.value = saved.referenceUrl
    if (saved.typeState && typeof saved.typeState === 'object') {
      for (const type of ASSET_TYPES) {
        const entry = saved.typeState[type.id]
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.prompt === 'string' && entry.prompt.trim()) typeState[type.id].prompt = entry.prompt
        if (type.aspects.includes(entry.aspect)) typeState[type.id].aspect = entry.aspect
        for (const select of type.selects || []) {
          if (select.options.some((option) => option.id === entry.selects?.[select.key])) {
            typeState[type.id].selects[select.key] = entry.selects[select.key]
          }
        }
        for (const toggle of type.toggles || []) {
          if (typeof entry.toggles?.[toggle.key] === 'boolean') {
            typeState[type.id].toggles[toggle.key] = entry.toggles[toggle.key]
          }
        }
      }
    }
  }
} catch {
  /* 忽略损坏的本地存档 */
}

watch(
  [
    assetType,
    style,
    imageCount,
    hdMode,
    negative,
    showGrid,
    referenceUrl,
    () => JSON.stringify(typeState),
  ],
  () => {
    setScopedLocalItem(
      SETTINGS_KEY,
      JSON.stringify({
        assetType: assetType.value,
        style: style.value,
        imageCount: imageCount.value,
        hdMode: hdMode.value,
        negative: negative.value,
        showGrid: showGrid.value,
        referenceUrl: referenceUrl.value,
        typeState,
      }),
    )
  },
)

const currentType = computed(() => ASSET_TYPES.find((type) => type.id === assetType.value) || ASSET_TYPES[0])

// —— 作品按资产类型隔离：每个 tab 只看到自己的胶片条与选中图 ——
function outputTypeOf(url) {
  const kind = String(outputKinds.value[url] || '')
  const match = kind.match(/^game-art-(.+)-(?:generation|edit)$/)
  return match && ASSET_TYPES.some((type) => type.id === match[1]) ? match[1] : ''
}

function outputTypeLabel(url) {
  const typeId = outputTypeOf(url)
  return ASSET_TYPES.find((type) => type.id === typeId)?.label || '早期'
}

const typeOutputs = computed(() =>
  outputs.value.filter((url) => outputTypeOf(url) === assetType.value),
)
// 未细分类型前生成的早期作品，统一收在资产库里查看。
const legacyOutputs = computed(() => outputs.value.filter((url) => !outputTypeOf(url)))

// —— 画布只弹「最近一批」结果卡片，全部历史收在资产库 ——
const latestBatch = ref([])
let outputsBeforeRun = []

watch(running, (isRunning) => {
  if (isRunning) {
    outputsBeforeRun = [...outputs.value]
    return
  }
  const fresh = outputs.value.filter(
    (url) => !outputsBeforeRun.includes(url) && outputTypeOf(url) === assetType.value,
  )
  if (fresh.length) {
    latestBatch.value = fresh
    playCanvasReveal()
  }
})

// —— 抽卡揭晓（画布内完成）：卡背旋入 → 金色光带自上而下擦亮成图 → 边缘闪光收尾 ——
// 需在结果卡片插入 DOM 前同步置 true，让进场动画与卡背遮罩一起生效。
const freshReveal = ref(false)
let freshRevealTimer = 0

function playCanvasReveal() {
  window.clearTimeout(freshRevealTimer)
  freshReveal.value = true
  freshRevealTimer = window.setTimeout(() => {
    freshReveal.value = false
  }, 3600)
}

const busy = computed(() => running.value)
const overlayStatus = computed(() => status.value || '生成高清游戏素材')
const progressEntries = computed(() => batchProgress.value)

watch(assetType, () => {
  latestBatch.value = []
})

// 画布卡片：优先展示刚生成的一批；否则回放当前类型的最近作品。
// 浏览态（3D 堆叠）多展示几张，形成隧道景深；揭晓态仍只看最近一批。
const canvasOutputs = computed(() => {
  const batch = latestBatch.value.filter((url) => outputs.value.includes(url))
  if (batch.length) return batch
  // 堆叠最多 6 张：更深的卡肉眼几乎不可见，但每张都是一个合成层，白白吃 GPU
  return typeOutputs.value.slice(0, 6)
})

// 真实生成忙碌态（不含演示揭晓）——揭晓期间仍用平面抽卡，结束后切 3D 堆叠。
const preferFlatReveal = computed(() => freshReveal.value)
const deckEnabled = computed(
  () => canvasOutputs.value.length > 0 && !preferFlatReveal.value && !busy.value,
)
const prefersReducedMotion = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
const deckResults = ref(null)
const {
  active: deckActive,
  entered: deckEntered,
  dragging: deckDragging,
  frontIndex: deckFrontIndex,
  onWheel: onDeckWheel,
  onPointerDown: onDeckPointerDown,
  onPointerMove: onDeckPointerMove,
  onPointerUp: onDeckPointerUp,
  onPointerLeave: onDeckPointerLeave,
  settle: settleDeck,
} = useCanvasDeck({
  items: canvasOutputs,
  enabled: deckEnabled,
  reducedMotion: prefersReducedMotion,
  getContainer: () => deckResults.value?.$el ?? deckResults.value,
})

// 抽卡揭晓收尾后，成图直接定格为堆叠终态（刷新进入同样不跑进场动画）
watch(freshReveal, (open, wasOpen) => {
  if (wasOpen && !open && canvasOutputs.value.length) {
    void nextTick(() => settleDeck())
  }
})

// 记录每张成图的真实宽高比，画布卡片按图片比例贴合展示（无黑边）。
const outputAspects = reactive({})

function recordAspect(url, event) {
  const img = event?.target
  if (img?.naturalWidth && img?.naturalHeight) {
    outputAspects[url] = img.naturalWidth / img.naturalHeight
  }
}

const defaultAspectNumber = computed(() => {
  const [w, h] = currentState.value.aspect.split(':').map(Number)
  return w && h ? w / h : 0.75
})

function aspectNumberOf(url) {
  return outputAspects[url] || defaultAspectNumber.value
}

// 加载失败的图渲染成出错卡片，可重试或删除。
const failedOutputs = reactive({})
const retryNonce = reactive({})

function markFailed(url) {
  failedOutputs[url] = true
}

function retryFailed(url) {
  delete failedOutputs[url]
  retryNonce[url] = (retryNonce[url] || 0) + 1
}

function openFullscreen(url) {
  activeOutput.value = url
  fullscreenOpen.value = true
}
// 中西文混排时补空格：「游戏 UI 设计」而非「游戏 UI设计」
const currentTypeHeading = computed(() => {
  const label = currentType.value.label
  return /[A-Za-z0-9]$/.test(label) ? `${label} 设计` : `${label}设计`
})
const currentState = computed(() => typeState[assetType.value])
const currentStyle = computed(() => STYLE_OPTIONS.find((item) => item.id === style.value) || STYLE_OPTIONS[0])
const transparentEnabled = computed(() => currentState.value.toggles.transparent === true)
const publishJobId = computed(() => outputJobIds.value[publishTargetUrl.value] || '')
const costLabel = computed(() => formatCostEstimate(imageCount.value))
const showBatchProgress = computed(() => progressEntries.value.length > 1)

// 资产库历史筛选：全部 / 仅早期未分类作品
const historyFilter = ref('all')
const libraryHistoryOutputs = computed(() =>
  historyFilter.value === 'legacy' ? legacyOutputs.value : outputs.value,
)
watch(legacyOutputs, (list) => {
  if (!list.length) historyFilter.value = 'all'
})

// 固定画质基线：正向增强 + 负向排除，随每次生成注入（用户可编辑的负面约束在其之上叠加）。
const QUALITY_POSITIVE = '干净高清画面，平滑3D动画渲染，细腻材质，纯净色彩，清晰边缘，无瑕疵背景，均匀光照'
const QUALITY_NEGATIVE = ['颗粒感', '噪点', '污点', '脏纹理', '杂色斑点', '胶片颗粒', '压缩痕迹', '像素化', '过度锐化', '碎片感']

const promptBlueprint = computed(() => {
  const type = currentType.value
  const state = currentState.value
  const lines = [state.prompt.trim() || type.defaultPrompt]
  lines.push(`游戏资产类型：${type.label}。${type.line}`)
  for (const select of type.selects || []) {
    const option = select.options.find((item) => item.id === state.selects[select.key])
    if (option) lines.push(`${select.label}：${option.prompt}。`)
  }
  lines.push(`美术风格：${currentStyle.value.prompt}。`)
  for (const toggle of type.toggles || []) {
    if (state.toggles[toggle.key]) lines.push(`${toggle.prompt}。`)
  }
  lines.push(
    '生产要求：可直接用于游戏开发的高清资产，轮廓明确，材质可辨识，光照服务于形体，完整展示主体，细节经得起放大。',
  )
  lines.push(`画质要求：${QUALITY_POSITIVE}。`)
  // 像素美术本身就要像素颗粒与像素化，冲突项不排除
  const qualityNegative = QUALITY_NEGATIVE.filter(
    (item) => style.value !== 'pixel-art' || !['像素化', '颗粒感'].includes(item),
  )
  const negativeParts = [negative.value.trim(), qualityNegative.join('、')].filter(Boolean)
  lines.push(`负面约束：${negativeParts.join('，')}。`)
  return lines.join('\n')
})

useStudioMotion(studioRoot, activeOutput)

onMounted(() => {
  initialize()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('paste', handlePaste)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('paste', handlePaste)
  window.clearTimeout(freshRevealTimer)
})

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (fullscreenOpen.value) {
      event.preventDefault()
      fullscreenOpen.value = false
    } else if (libraryOpen.value && !publishOpen.value) {
      event.preventDefault()
      libraryOpen.value = false
    }
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy.value) {
    event.preventDefault()
    generate()
  }
}

async function applySourceFile(file) {
  if (!file || !file.type?.startsWith('image/')) return
  inputFile.value = file
  sourcePreview.value = await readImageFile(file)
  referenceUrl.value = ''
  localError.value = ''
}

async function chooseFile(event) {
  await applySourceFile(event.target.files?.[0])
}

const dropActive = ref(false)

async function handleReferenceDrop(event) {
  dropActive.value = false
  await applySourceFile(event.dataTransfer?.files?.[0])
}

// 粘贴截图/图片即挂为参考图（对齐主流生成工作台的习惯）。
async function handlePaste(event) {
  const item = Array.from(event.clipboardData?.items || []).find((entry) =>
    entry.type?.startsWith('image/'),
  )
  if (!item) return
  const file = item.getAsFile()
  if (!file) return
  event.preventDefault()
  await applySourceFile(file)
  notificationService.success('已粘贴为参考图')
}

function clearSource() {
  inputFile.value = null
  sourcePreview.value = ''
  referenceUrl.value = ''
  localError.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function useOutputAsReference(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  referenceUrl.value = target
  inputFile.value = null
  sourcePreview.value = ''
  if (fileInput.value) fileInput.value.value = ''
  localError.value = ''
  notificationService.success('已设为参考图，下次生成将基于它重绘')
}

function applyExample(text) {
  currentState.value.prompt = text
  localError.value = ''
}

function generate() {
  localError.value = ''
  const state = currentState.value
  if (!state.prompt.trim() && !inputFile.value && !referenceUrl.value) {
    localError.value = '请先写一段创意描述，或挂一张参考图'
    return
  }
  generateImage({
    prompt: promptBlueprint.value,
    file: inputFile.value,
    sourceUrl: referenceUrl.value,
    aspectRatio: state.aspect,
    count: imageCount.value,
    quality: hdMode.value ? 'high' : 'medium',
    transparentPngEnabled: transparentEnabled.value,
    viewLabel: currentType.value.label,
    kindVariant: assetType.value,
  })
}

async function downloadOutput(url = '') {
  const target = String(url || activeOutput.value || '').trim()
  if (!target) return
  localError.value = ''
  try {
    await downloadAuthenticatedMedia(target, `game-${assetType.value}-${Date.now()}.png`)
  } catch (caught) {
    localError.value = caught?.message || '游戏资产下载失败'
  }
}

function requestDeleteOutput(url) {
  if (busy.value) return
  if (pendingDeleteUrl.value !== url) {
    pendingDeleteUrl.value = url
    window.clearTimeout(pendingDeleteTimer)
    pendingDeleteTimer = window.setTimeout(() => {
      pendingDeleteUrl.value = ''
    }, 3200)
    return
  }
  window.clearTimeout(pendingDeleteTimer)
  pendingDeleteUrl.value = ''
  deleteOutput(url)
    .then(() => notificationService.success('已删除该输出及其云端任务'))
    .catch((caught) => notificationService.error(caught?.message || '删除失败'))
}

function openLibrary(tab = 'history') {
  libraryTab.value = tab
  libraryOpen.value = true
  if (tab === 'published' && !assetsLoaded.value) void loadMyAssets()
  if (tab === 'prompts' && !promptLoaded.value) void loadPromptEntries(true)
}

function switchLibraryTab(tab) {
  libraryTab.value = tab
  if (tab === 'published' && !assetsLoaded.value) void loadMyAssets()
  if (tab === 'prompts' && !promptLoaded.value) void loadPromptEntries(true)
}

const filteredPrompts = computed(() => {
  const query = promptQuery.value.trim().toLowerCase()
  if (!query) return promptItems.value
  return promptItems.value.filter((item) =>
    `${item?.title || ''} ${item?.prompt || ''}`.toLowerCase().includes(query),
  )
})

async function loadPromptEntries(reset = false) {
  if (promptLoading.value) return
  promptLoading.value = true
  try {
    const nextPage = reset ? 1 : promptPage.value + 1
    const response = await listPromptLibrary('text-to-image', { pageNumber: nextPage, pageSize: 24 })
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
  currentState.value.prompt = text
  libraryOpen.value = false
  notificationService.success('已填入创意描述，可继续修改后生成')
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
    // 只展示从本工作台推送的资产（按任务 kind 过滤），其他页面的作品不混入。
    myAssets.value = items.filter((item) => String(item?.kind || '').startsWith('game-art'))
    assetsLoaded.value = true
  } catch (caught) {
    notificationService.error(caught?.message || '我的资产读取失败')
  } finally {
    assetsLoading.value = false
  }
}

// 资产库里点作品直接全屏预览（抽屉保持在下层，Esc 逐层退出）。
function pickFromLibrary(url) {
  localError.value = ''
  openFullscreen(url)
}

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
      styleLabel: currentStyle.value.label,
      ...payload,
    })
    publishOpen.value = false
    publishTargetUrl.value = ''
    notificationService.success('已提交到广场审核，通过后会公开展示')
    assetsLoaded.value = false
    if (libraryOpen.value && libraryTab.value === 'published') void loadMyAssets()
  } catch (caught) {
    notificationService.error(caught?.message || '发布失败，请稍后重试')
  } finally {
    submittingShare.value = false
  }
}

function assetStatusLabel(statusValue) {
  if (statusValue === 'approved') return '已发布'
  if (statusValue === 'rejected') return '未通过'
  return '审核中'
}
</script>

<template>
  <main ref="studioRoot" class="game-art-studio">
    <aside class="ga-rail" data-studio-enter>
      <button
        v-for="type in ASSET_TYPES"
        :key="type.id"
        type="button"
        :class="{ active: assetType === type.id }"
        :title="type.label"
        @click="assetType = type.id"
      >
        <i class="bi" :class="type.icon"></i><span>{{ type.label }}</span>
      </button>
      <button class="ga-library" type="button" title="历史记录与我的资产" @click="openLibrary('history')">
        <i class="bi bi-collection"></i><span>资产库</span>
      </button>
    </aside>

    <section class="ga-main">
      <div class="ga-workspace">
        <section class="ga-canvas" data-studio-enter>
          <div class="ga-canvas-head">
            <div class="ga-canvas-title">
              <Transition name="ga-type" mode="out-in">
                <strong :key="assetType">{{ currentTypeHeading }}</strong>
              </Transition>
              <span class="ga-canvas-status" :class="{ working: busy }">
                <i></i>{{ busy ? status || 'RENDERING' : `READY / ${currentState.aspect}` }}
                <template v-if="!busy && typeOutputs.length"> / {{ typeOutputs.length }} 张</template>
              </span>
            </div>
            <div class="ga-canvas-tools">
              <label class="ga-model-pick" title="切换生成模型">
                <i class="bi bi-cpu" aria-hidden="true"></i>
                <select v-model="modelId" aria-label="生成模型">
                  <option v-for="model in models" :key="model.id" :value="model.id">
                    {{ model.label }}{{ model.creditCost ? ` · ${model.creditCost} 积分/张` : '' }}
                  </option>
                </select>
              </label>
              <button type="button" title="显示网格" :class="{ active: showGrid }" @click="showGrid = !showGrid">
                <i class="bi bi-grid"></i>
              </button>
            </div>
          </div>
          <div
            class="ga-output"
            :class="{ 'grid-off': !showGrid, 'is-deck': deckActive }"
            @wheel="onDeckWheel"
            @pointerdown="onDeckPointerDown"
            @pointermove="onDeckPointerMove"
            @pointerup="onDeckPointerUp"
            @pointercancel="onDeckPointerUp"
            @pointerleave="onDeckPointerLeave"
          >
            <div v-if="deckActive" class="ga-deck-fx" aria-hidden="true">
              <i v-for="n in 7" :key="n" class="ga-deck-orb" :style="{ '--o': n }"></i>
              <span class="ga-deck-ribbon"></span>
            </div>
            <TransitionGroup
              v-if="canvasOutputs.length"
              ref="deckResults"
              name="ga-pop"
              tag="div"
              class="ga-results"
              :class="{
                'is-fresh': freshReveal,
                'is-deck': deckActive,
                'is-deck-entered': deckEntered,
                'is-deck-dragging': deckDragging,
              }"
              :data-count="canvasOutputs.length"
              appear
            >
              <article
                v-for="(output, index) in canvasOutputs"
                :key="output"
                class="ga-card"
                :class="{ 'is-front': deckActive && index === deckFrontIndex }"
                :style="{ '--i': index, '--car': aspectNumberOf(output) }"
              >
                <div v-if="failedOutputs[output]" class="ga-card-error">
                  <svg viewBox="0 0 64 64" aria-hidden="true">
                    <rect x="6" y="10" width="52" height="44" rx="5" />
                    <path d="M6 44 22 30l10 9 12-13 14 15" />
                    <circle cx="23" cy="23" r="4.5" />
                    <path class="ga-card-error-slash" d="M10 58 54 6" />
                  </svg>
                  <strong>图像加载失败</strong>
                  <div class="ga-card-error-actions">
                    <button type="button" @click="retryFailed(output)"><i class="bi bi-arrow-clockwise"></i>重试</button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                      {{ pendingDeleteUrl === output ? '确认删除' : '删除' }}
                    </button>
                  </div>
                </div>
                <template v-else>
                  <button type="button" class="ga-card-view" title="点击查看大图" @click="openFullscreen(output)">
                    <AuthenticatedImage
                      :key="`${output}#${retryNonce[output] || 0}`"
                      :src="output"
                      alt="游戏美术资产"
                      loading="eager"
                      :retry-count="2"
                      @load="recordAspect(output, $event)"
                      @error="markFailed(output)"
                    />
                  </button>
                  <template v-if="freshReveal">
                    <span class="ga-card-back" aria-hidden="true">
                      <i class="bi" :class="currentType.icon"></i>
                      <em>STARCLOUD FORGE</em>
                    </span>
                    <span class="ga-card-sweep" aria-hidden="true"></span>
                  </template>
                  <div class="ga-card-actions">
                    <button type="button" :disabled="busy" title="以它为参考继续生成" @click="useOutputAsReference(output)">
                      <i class="bi bi-pin-angle"></i>
                    </button>
                    <button type="button" :disabled="!outputJobIds[output]" title="发布到广场" @click="openPublish(output)">
                      <i class="bi bi-broadcast"></i>
                    </button>
                    <button type="button" title="下载" @click="downloadOutput(output)">
                      <i class="bi bi-download"></i>
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      :title="pendingDeleteUrl === output ? '再点一次确认删除' : '删除'"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                    </button>
                  </div>
                </template>
              </article>
            </TransitionGroup>
            <div v-else-if="historyLoading" class="ga-results" data-count="3" aria-hidden="true">
              <span v-for="n in 3" :key="n" class="ga-card ga-card-skeleton" :style="{ '--car': defaultAspectNumber }"></span>
            </div>
            <div v-else class="ga-empty">
              <Transition name="ga-type" mode="out-in">
                <div :key="assetType" class="ga-crosshair"><i class="bi" :class="currentType.icon"></i></div>
              </Transition>
              <strong>{{ currentTypeHeading }}工作台</strong>
              <em>{{ currentType.line }}</em>
              <div class="ga-inspo" role="group" aria-label="点一个灵感直接开始">
                <button
                  v-for="example in currentType.examples"
                  :key="example.label"
                  type="button"
                  @click="applyExample(example.text)"
                >
                  <strong>{{ example.label }}</strong>
                  <span>{{ example.text }}</span>
                </button>
              </div>
              <span>点一个灵感填入描述，或直接在下方输入框写下你的想法</span>
            </div>
            <div v-if="busy" class="ga-render">
              <div class="ga-loader"></div>
              <strong>{{ overlayStatus }}</strong>
              <ul v-if="showBatchProgress" class="ga-progress" aria-label="生成进度">
                <li v-for="(entry, index) in progressEntries" :key="index" :class="`is-${entry.status}`">
                  <i
                    class="bi"
                    :class="{
                      'bi-circle': entry.status === 'pending',
                      'bi-arrow-repeat spin': entry.status === 'running',
                      'bi-check-circle-fill': entry.status === 'done',
                      'bi-x-circle': entry.status === 'failed',
                      'bi-dash-circle': entry.status === 'cancelled',
                    }"
                  ></i>
                  {{ entry.label }} {{ index + 1 }}
                </li>
              </ul>
              <small v-else>云端任务可安全离开页面后继续运行</small>
              <button type="button" class="ga-cancel" :disabled="cancelling" @click="cancelGeneration()">
                <i class="bi bi-x-lg"></i>{{ cancelling ? '正在取消…' : '取消生成' }}
              </button>
            </div>
            <p v-if="deckActive && canvasOutputs.length > 1" class="ga-deck-hint">
              <i class="bi bi-arrows-vertical" aria-hidden="true"></i>滚轮或拖拽循环翻阅 · 点卡片看大图
            </p>
          </div>
          <p v-if="!authStore.isAuthenticated" class="ga-login-hint">
            <i class="bi bi-person-lock"></i>登录后才能生成资产、保留历史记录并发布到广场
          </p>
          <div v-if="error || localError" class="ga-error"><i class="bi bi-exclamation-octagon"></i>{{ localError || error }}</div>

          <div
            class="ga-composer"
            :class="{ 'is-drop': dropActive }"
            data-studio-enter
            @dragover.prevent="dropActive = true"
            @dragleave="dropActive = false"
            @drop.prevent="handleReferenceDrop"
          >
            <div class="ga-composer-ref" :class="{ 'has-image': Boolean(referenceUrl || sourcePreview) }">
              <button type="button" class="ga-composer-ref-pick" title="参考图：拖入 / 粘贴 / 点击上传" @click="fileInput?.click()">
                <AuthenticatedImage v-if="referenceUrl" :src="referenceUrl" alt="参考图" :max-dimension="160" />
                <img v-else-if="sourcePreview" :src="sourcePreview" alt="参考图" />
                <template v-else>
                  <i class="bi bi-image" aria-hidden="true"></i>
                  <span>参考图</span>
                </template>
              </button>
              <button
                v-if="inputFile || referenceUrl"
                type="button"
                class="ga-composer-ref-clear"
                title="移除参考图"
                @click="clearSource"
              >
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
            <div class="ga-composer-main">
              <Transition name="ga-type" mode="out-in">
                <textarea
                  :key="assetType"
                  v-model="currentState.prompt"
                  rows="2"
                  maxlength="1200"
                  :placeholder="currentType.placeholder"
                  @keydown.enter.exact.prevent="!busy && generate()"
                ></textarea>
              </Transition>
              <div class="ga-composer-tools">
                <div class="ga-examples" role="group" aria-label="灵感示例">
                  <button v-for="example in currentType.examples" :key="example.label" type="button" @click="applyExample(example.text)">
                    {{ example.label }}
                  </button>
                </div>
                <button type="button" class="ga-lib-link" @click="openLibrary('prompts')">
                  <i class="bi bi-journal-text" aria-hidden="true"></i>提示词库
                </button>
              </div>
            </div>
            <div class="ga-composer-run">
              <button class="ga-generate" type="button" :disabled="busy" @click="generate">
                <i class="bi" :class="busy ? 'bi-arrow-repeat spin' : 'bi-play-fill'"></i>
                <span>{{ busy ? '正在渲染' : '启动生成' }}</span>
                <kbd>↵</kbd>
              </button>
              <p class="ga-cost">{{ costLabel }}</p>
            </div>
          </div>

          <input ref="fileInput" hidden type="file" accept="image/*" @change="chooseFile" />
          <p v-if="typeOutputs.length > canvasOutputs.length" class="ga-more-hint">
            <button type="button" @click="openLibrary('history')">
              <i class="bi bi-collection"></i>画布只展示最近一批，全部 {{ typeOutputs.length }} 张作品都在资产库
            </button>
          </p>
        </section>

        <aside class="ga-console" data-studio-enter>
          <div class="ga-console-title"><span>GENERATOR</span><em>{{ currentType.en }}</em></div>

          <div class="ga-console-body">
            <Transition name="ga-type" mode="out-in">
              <div :key="assetType" class="ga-type-section">
                <div class="ga-sec"><b>01</b><span>呈现与规格</span></div>
                <div class="ga-sec-body">
                  <div v-for="select in currentType.selects" :key="select.key" class="ga-field">
                    <span class="ga-field-label">{{ select.label }}</span>
                    <div class="ga-chiprow" role="group" :aria-label="select.label">
                      <button
                        v-for="option in select.options"
                        :key="option.id"
                        type="button"
                        :class="{ 'is-on': currentState.selects[select.key] === option.id }"
                        :title="option.prompt"
                        @click="currentState.selects[select.key] = option.id"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>

                  <div v-if="currentType.toggles.length" class="ga-toggles">
                    <button
                      v-for="toggle in currentType.toggles"
                      :key="toggle.key"
                      type="button"
                      :class="{ 'is-on': currentState.toggles[toggle.key] }"
                      :title="toggle.prompt"
                      @click="currentState.toggles[toggle.key] = !currentState.toggles[toggle.key]"
                    >
                      <i class="bi" :class="currentState.toggles[toggle.key] ? 'bi-toggle-on' : 'bi-toggle-off'"></i>
                      {{ toggle.label }}
                    </button>
                  </div>

                  <div class="ga-pair">
                    <div class="ga-field">
                      <span class="ga-field-label">输出比例</span>
                      <div class="ga-chiprow" role="group" aria-label="输出比例">
                        <button
                          v-for="ratio in currentType.aspects"
                          :key="ratio"
                          type="button"
                          :class="{ 'is-on': currentState.aspect === ratio }"
                          @click="currentState.aspect = ratio"
                        >
                          {{ ratio }}
                        </button>
                      </div>
                    </div>
                    <div class="ga-field">
                      <span class="ga-field-label">生成数量</span>
                      <div class="ga-chiprow" role="group" aria-label="生成数量">
                        <button
                          v-for="count in [1, 2, 3, 4]"
                          :key="count"
                          type="button"
                          :class="{ 'is-on': imageCount === count }"
                          @click="imageCount = count"
                        >
                          {{ count }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>

            <div class="ga-sec"><b>02</b><span>美术风格</span></div>
            <div class="ga-sec-body">
              <div class="ga-stylegrid" role="group" aria-label="美术风格">
                <button
                  v-for="option in STYLE_OPTIONS"
                  :key="option.id"
                  type="button"
                  :class="{ 'is-on': style === option.id }"
                  :title="option.prompt"
                  @click="style = option.id"
                >
                  <span class="ga-swatch" :style="{ background: option.swatch }" aria-hidden="true"></span>
                  <span>{{ option.label }}</span>
                </button>
              </div>
              <p class="ga-style-hint">{{ currentStyle.prompt }}</p>
            </div>

            <div class="ga-sec"><b>03</b><span>质量控制</span></div>
            <div class="ga-sec-body">
              <details><summary>负面约束<i class="bi bi-chevron-down"></i></summary><textarea v-model="negative" rows="3"></textarea></details>
            </div>
          </div>

          <div class="ga-console-foot">
            <button class="ga-quality" type="button" :class="{ off: !hdMode }" @click="hdMode = !hdMode">
              <span><i class="bi bi-badge-hd"></i><strong>高清生产模式</strong></span>
              <em>{{ hdMode ? 'ON' : 'OFF' }}</em>
            </button>
          </div>
        </aside>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="ga-drawer">
        <div v-if="libraryOpen" class="ga-drawer-backdrop" @click.self="libraryOpen = false">
          <aside class="ga-drawer" role="dialog" aria-modal="true" aria-label="资产库">
            <header>
              <div class="ga-drawer-tabs" role="tablist">
                <button type="button" :class="{ 'is-on': libraryTab === 'prompts' }" @click="switchLibraryTab('prompts')">
                  <i class="bi bi-journal-text"></i>词库
                </button>
                <button type="button" :class="{ 'is-on': libraryTab === 'history' }" @click="switchLibraryTab('history')">
                  <i class="bi bi-clock-history"></i>历史记录
                </button>
                <button type="button" :class="{ 'is-on': libraryTab === 'published' }" @click="switchLibraryTab('published')">
                  <i class="bi bi-broadcast"></i>我的资产
                </button>
              </div>
              <button type="button" class="ga-drawer-close" aria-label="关闭资产库" @click="libraryOpen = false">
                <i class="bi bi-x-lg"></i>
              </button>
            </header>

            <div v-if="libraryTab === 'prompts'" class="ga-drawer-body">
              <div class="ga-prompt-search">
                <i class="bi bi-search" aria-hidden="true"></i>
                <input v-model="promptQuery" type="search" placeholder="搜索提示词…" aria-label="搜索提示词" />
              </div>
              <p v-if="promptLoading && !promptItems.length" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入词库…</p>
              <p v-else-if="!promptItems.length" class="ga-drawer-note">提示词库暂时为空，管理员分配后会显示在这里</p>
              <p v-else-if="!filteredPrompts.length" class="ga-drawer-note">没有匹配「{{ promptQuery }}」的提示词</p>
              <div v-else class="ga-prompt-list">
                <button v-for="item in filteredPrompts" :key="item.id" type="button" class="ga-prompt-item" @click="usePromptEntry(item)">
                  <strong v-if="item.title">{{ item.title }}</strong>
                  <span>{{ item.prompt }}</span>
                  <em><i class="bi bi-stars" aria-hidden="true"></i>点击填入创意描述</em>
                </button>
                <button v-if="promptHasMore" type="button" class="ga-prompt-more" :disabled="promptLoading" @click="loadPromptEntries(false)">
                  <i class="bi" :class="promptLoading ? 'bi-arrow-repeat spin' : 'bi-chevron-down'" aria-hidden="true"></i>
                  {{ promptLoading ? '载入中…' : '加载更多' }}
                </button>
              </div>
            </div>

            <div v-else-if="libraryTab === 'history'" class="ga-drawer-body">
              <div v-if="legacyOutputs.length" class="ga-history-filter" role="group" aria-label="历史筛选">
                <button type="button" :class="{ 'is-on': historyFilter === 'all' }" @click="historyFilter = 'all'">
                  全部 {{ outputs.length }}
                </button>
                <button type="button" :class="{ 'is-on': historyFilter === 'legacy' }" @click="historyFilter = 'legacy'">
                  <i class="bi bi-archive" aria-hidden="true"></i>早期作品 {{ legacyOutputs.length }}
                </button>
              </div>
              <p v-if="historyLoading && !outputs.length" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入历史…</p>
              <p v-else-if="!outputs.length" class="ga-drawer-note">还没有生成记录，先去生成一张吧</p>
              <div v-else class="ga-drawer-grid">
                <article v-for="output in libraryHistoryOutputs" :key="output" class="ga-shelf-item is-history">
                  <button type="button" class="ga-shelf-pick" @click="pickFromLibrary(output)">
                    <AuthenticatedImage :src="output" alt="" :max-dimension="480" />
                    <span class="ga-shelf-kind">{{ outputTypeLabel(output) }}</span>
                  </button>
                  <footer>
                    <button type="button" title="以它为参考" @click="useOutputAsReference(output)"><i class="bi bi-pin-angle"></i></button>
                    <button type="button" title="发布到广场" :disabled="!outputJobIds[output]" @click="openPublish(output)">
                      <i class="bi bi-broadcast"></i>
                    </button>
                    <button type="button" title="下载" @click="downloadOutput(output)"><i class="bi bi-download"></i></button>
                    <button
                      type="button"
                      :class="{ 'is-armed': pendingDeleteUrl === output }"
                      :title="pendingDeleteUrl === output ? '再点一次确认删除' : '删除'"
                      @click="requestDeleteOutput(output)"
                    >
                      <i class="bi" :class="pendingDeleteUrl === output ? 'bi-question-lg' : 'bi-trash3'"></i>
                    </button>
                  </footer>
                </article>
              </div>
              <button
                v-if="historyHasMore"
                type="button"
                class="ga-prompt-more ga-history-more"
                :disabled="historyLoading"
                @click="loadMoreHistory()"
              >
                <i class="bi" :class="historyLoading ? 'bi-arrow-repeat spin' : 'bi-chevron-down'" aria-hidden="true"></i>
                {{ historyLoading ? '载入中…' : '加载更多历史' }}
              </button>
            </div>

            <div v-else class="ga-drawer-body">
              <p v-if="assetsLoading" class="ga-drawer-note"><i class="bi bi-arrow-repeat spin"></i>正在载入我的资产…</p>
              <p v-else-if="!authStore.isAuthenticated" class="ga-drawer-note">登录后可查看我的资产：发布到广场的作品会集中显示在这里</p>
              <p v-else-if="!myAssets.length" class="ga-drawer-note">还没有发布过作品：生成后点「发布到广场」，审核通过就会出现在这里</p>
              <div v-else class="ga-drawer-grid">
                <article v-for="asset in myAssets" :key="asset.id" class="ga-shelf-item is-asset">
                  <div class="ga-shelf-pick">
                    <AuthenticatedImage :src="asset.resultUrl" :alt="asset.title" :max-dimension="480" loading="lazy" />
                    <span class="ga-asset-status" :data-status="asset.status">{{ assetStatusLabel(asset.status) }}</span>
                  </div>
                  <footer class="is-meta">
                    <strong :title="asset.title">{{ asset.title }}</strong>
                    <small>{{ new Date(asset.updatedAt || asset.createdAt).toLocaleDateString() }}</small>
                  </footer>
                </article>
              </div>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="ga-zoom">
        <div
          v-if="fullscreenOpen && activeOutput"
          class="ga-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="资产大图"
          @click.self="fullscreenOpen = false"
        >
          <button type="button" aria-label="关闭大图" @click="fullscreenOpen = false"><i class="bi bi-x-lg"></i></button>
          <AuthenticatedImage :src="activeOutput" alt="游戏美术资产大图" loading="eager" />
        </div>
      </Transition>
    </Teleport>

    <SharePublishDialog
      :open="publishOpen"
      :title="`${currentType.label} · ${currentState.prompt.slice(0, 24)}`"
      :style-label="currentStyle.label"
      :default-category="currentType.shareCategory"
      :suggested-tags="['游戏美术', currentType.label]"
      :submitting="submittingShare"
      @close="publishOpen = false"
      @submit="submitPublish"
    />
  </main>
</template>

<style scoped>
.game-art-studio{--acid:#b8ff35;--cyan:#35dcff;--panel:#17191c;min-height:calc(100vh - var(--app-header-offset,64px));display:grid;grid-template-columns:86px 1fr;background:#0d0f11;color:#f6f7f7;font-family:Inter,"PingFang SC",sans-serif;letter-spacing:0}.ga-rail{border-right:1px solid #2c3034;display:flex;flex-direction:column;align-items:center;padding:14px 8px;gap:5px}.ga-rail button{width:68px;height:58px;border:0;border-left:3px solid transparent;background:transparent;color:#777;display:grid;place-items:center;align-content:center;gap:4px;cursor:pointer}.ga-rail button i{font-size:18px}.ga-rail button span{font-size:9px}.ga-rail button.active{color:var(--acid);background:#1b201b;border-color:var(--acid)}.ga-rail .ga-library{margin-top:auto}.ga-main{min-width:0}.ga-workspace{display:grid;grid-template-columns:minmax(0,1fr) 350px;grid-template-rows:minmax(0,1fr);min-height:calc(100vh - var(--app-header-offset,64px))}.ga-canvas{padding:16px 22px;min-width:0;display:flex;flex-direction:column}.ga-canvas-head{min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:700 9px/1 monospace;color:#686e73;padding-bottom:10px}.ga-canvas-title{display:flex;align-items:baseline;gap:12px;min-width:0}.ga-canvas-title strong{font-size:15px;color:#eef1f2;letter-spacing:.04em;white-space:nowrap}.ga-canvas-status{display:flex;align-items:center;gap:7px;color:#777;white-space:nowrap}.ga-canvas-status i{width:6px;height:6px;border-radius:50%;background:#5ecf7a}.ga-canvas-status.working{color:var(--acid)}.ga-canvas-status.working i{background:var(--acid);box-shadow:0 0 10px var(--acid)}.ga-canvas-head button{border:0;background:transparent;color:#777;cursor:pointer;padding:0 5px;font-size:13px}.ga-canvas-head button:disabled{opacity:.35;cursor:not-allowed}.ga-output{position:relative;flex:1;min-height:360px;border:1px solid #272c31;background-color:#101215;background-image:linear-gradient(#171a1e 1px,transparent 1px),linear-gradient(90deg,#171a1e 1px,transparent 1px);background-size:44px 44px;display:grid;place-items:center;overflow:hidden}.ga-empty{display:grid;place-items:center;gap:8px;color:#757c82;padding:0 8%}.ga-empty strong{color:#a5abb0;font-size:12px}.ga-empty span{font-size:9px;text-align:center;line-height:1.6}.ga-crosshair{width:100px;height:100px;border:1px solid #333a3f;border-radius:50%;display:grid;place-items:center;position:relative}.ga-crosshair::before,.ga-crosshair::after{content:"";position:absolute;background:#333a3f}.ga-crosshair::before{width:140px;height:1px}.ga-crosshair::after{height:140px;width:1px}.ga-crosshair i{font-size:35px;color:var(--acid)}.ga-render{position:absolute;inset:0;background:#0d0f11e8;display:grid;place-items:center;align-content:center;gap:10px}.ga-render strong{font-size:12px;color:var(--acid)}.ga-render small{font-size:9px;color:#666}.ga-loader{width:56px;height:56px;border:2px solid #303630;border-top-color:var(--acid);border-radius:50%;animation:spin 1s linear infinite}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.ga-error{padding:10px 12px;margin-top:8px;border-radius:8px;background:#431f22;color:#ff9a9a;font-size:11px}.ga-console{border-left:1px solid #2c3034;background:var(--panel);display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - var(--app-header-offset,64px));position:sticky;top:var(--app-header-offset,64px);overflow:hidden}.ga-console-title{display:flex;justify-content:space-between;align-items:center;flex:0 0 auto;padding:13px 20px 11px;border-bottom:1px solid #30353a;font:700 10px/1 monospace}.ga-console-title span{color:var(--acid)}.ga-console-title em{color:#666;font-style:normal}.ga-console-body{flex:1;min-height:0;overflow-y:auto;padding:0 20px 18px;scrollbar-width:thin}.ga-console-foot{flex:0 0 auto;padding:13px 20px 15px;border-top:1px solid #30353a;background:#131518}.ga-field{display:block;min-width:0;font-size:10px;color:#8b9298;margin-top:12px}.ga-field-label{display:block;font-size:10px;color:#8b9298;letter-spacing:.06em}.ga-console textarea,.ga-console select{display:block;width:100%;box-sizing:border-box;margin-top:7px;border:1px solid #363b40;background:#101214;color:#e9ebec;padding:9px;font:11px/1.55 inherit}.ga-console select{height:38px;padding:0 8px}.ga-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.ga-pair .ga-field{margin-top:12px}.ga-console details{margin-top:12px;border:1px solid #30353a;border-radius:8px;background:#101214;padding:0;overflow:hidden}.ga-console summary{font-size:10px;color:#8b9298;display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:10px 11px;list-style:none}.ga-console summary::-webkit-details-marker{display:none}.ga-console details[open] summary{border-bottom:1px solid #30353a}.ga-console details textarea{margin:0;border:0;background:transparent}.ga-generate{height:46px;border:0;background:var(--acid);color:#111;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;font-size:11px;font-weight:800;white-space:nowrap;cursor:pointer}.ga-generate kbd{font:8px/1 monospace;border:1px solid #5d7e26;padding:4px}.ga-rail button,.ga-console textarea,.ga-console select,.ga-generate{border-radius:8px}.ga-output{border-radius:12px}@media(max-width:900px){.game-art-studio{grid-template-columns:1fr}.ga-rail{position:relative;z-index:20;height:64px;flex-direction:row;overflow:auto;background:#0d0f11;border-right:0;border-bottom:1px solid #2c3034;padding:5px}.ga-rail button{width:60px;height:50px;flex:0 0 auto}.ga-rail .ga-library{margin:0 0 0 auto}.ga-workspace{grid-template-columns:1fr;height:auto;min-height:0}.ga-canvas{height:auto}.ga-output{min-height:320px;max-height:56vh}.ga-model-pick select{max-width:120px}.ga-console{border-left:0;border-top:1px solid #2c3034;position:static;max-height:none;overflow:visible}.ga-console-body{overflow:visible;padding-bottom:14px}}@media(max-width:560px){.ga-canvas{padding:12px}.ga-output{min-height:260px}.ga-console-title{padding:14px 16px 12px}.ga-console-body{padding:0 16px 12px}.ga-console-foot{padding:12px 16px 14px}.ga-workspace{min-height:0}}
.game-art-studio{position:relative;isolation:isolate;overflow:hidden}.ga-rail button{transition:color .2s ease,background .2s ease}.ga-rail button:hover{color:var(--acid)}.ga-canvas-head button{transition:color .2s ease}.ga-canvas-head button:hover:not(:disabled){color:var(--acid)}.ga-canvas-head button.active{color:var(--acid)}.ga-canvas-title strong{border-left:3px solid var(--acid);padding-left:10px}.ga-output.grid-off{background-image:none}.ga-output::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(130% 105% at 50% 38%,transparent 55%,#00000052 100%)}.ga-empty{position:relative;z-index:1}.ga-render{z-index:3;backdrop-filter:blur(9px)}.ga-loader{position:relative}.ga-loader::after{content:"";position:absolute;inset:10px;border:1px solid var(--cyan);border-radius:50%;animation:spin .65s linear infinite reverse}.ga-console{background:linear-gradient(180deg,#191c1f,#141518);box-shadow:inset 1px 0 0 #ffffff08}.ga-console-foot{box-shadow:0 -12px 22px #0000004d}.ga-generate{background:linear-gradient(180deg,#c6fd52,#a9e832);box-shadow:0 10px 26px #b8ff3520;transition:filter .2s ease}.ga-generate:hover:not(:disabled){filter:brightness(1.07)}@media(prefers-reduced-motion:reduce){.ga-rail button,.ga-generate{transition:none}}

/* ---------- 类型切换动画 ---------- */
.ga-type-enter-active,
.ga-type-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ga-type-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.ga-type-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---------- 词库 ---------- */
.ga-history-more {
  width: 100%;
  margin-top: 12px;
}

.ga-lib-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-lib-link:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-prompt-search {
  position: relative;
  margin-bottom: 12px;
}

.ga-prompt-search i {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #666;
  font-size: 11px;
  pointer-events: none;
}

.ga-prompt-search input {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px 0 29px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #e9ebec;
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s ease;
}

.ga-prompt-search input:focus {
  border-color: var(--acid);
}

.ga-prompt-list {
  display: grid;
  gap: 8px;
}

.ga-prompt-item {
  display: grid;
  gap: 5px;
  padding: 10px 11px;
  border: 1px solid #30353a;
  border-radius: 8px;
  background: #101214;
  color: #e9ebec;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.ga-prompt-item:hover {
  transform: translateY(-1px);
  border-color: var(--acid);
  background: #1b201b;
}

.ga-prompt-item strong {
  font-size: 11px;
}

.ga-prompt-item span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  color: #9aa1a7;
  font-size: 10.5px;
  line-height: 1.55;
}

.ga-prompt-item em {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--acid);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ga-prompt-item:hover em {
  opacity: 1;
}

.ga-prompt-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-prompt-more:hover:not(:disabled) {
  border-color: var(--acid);
  color: var(--acid);
}

/* ---------- 分组标题（常显，不折叠） ---------- */
.ga-sec {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 0 0 8px;
  border-bottom: 1px solid #24282c;
}

.ga-type-section > .ga-sec:first-child {
  margin-top: 14px;
}

.ga-sec b {
  font: 800 10px/1 monospace;
  color: var(--acid);
}

.ga-sec span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ced3d7;
}

.ga-sec-body {
  min-width: 0;
}

.ga-style-hint {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: #6d747a;
}

/* 风格视觉卡片：色板示意气质，选中亮青柠描边 */
.ga-stylegrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin-top: 12px;
}

.ga-stylegrid button {
  display: grid;
  gap: 6px;
  padding: 6px 6px 7px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.ga-stylegrid button:hover {
  border-color: #4a5157;
  color: #d7dbde;
  transform: translateY(-1px);
}

.ga-stylegrid button.is-on {
  border-color: var(--acid);
  color: var(--acid);
  background: #b8ff350d;
}

.ga-swatch {
  display: block;
  height: 30px;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px #ffffff14;
}

/* 空画布灵感卡片：点一下直接填入描述 */
.ga-inspo {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: min(560px, 92%);
  margin-top: 6px;
}

.ga-inspo button {
  display: grid;
  gap: 6px;
  padding: 11px 12px;
  border: 1px solid #2c3237;
  border-radius: 10px;
  background: #14171acc;
  color: #8f969c;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
}

.ga-inspo button:hover {
  border-color: var(--acid);
  background: #171b16;
  transform: translateY(-2px);
}

.ga-inspo button strong {
  font-size: 11px;
  color: #d3d8db;
}

.ga-inspo button:hover strong {
  color: var(--acid);
}

.ga-inspo button span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 9.5px;
  line-height: 1.55;
  text-align: left;
}

@media (max-width: 700px) {
  .ga-inspo {
    grid-template-columns: 1fr;
    width: min(420px, 94%);
  }

  .ga-inspo button span {
    -webkit-line-clamp: 1;
  }

  /* 小屏画布高度有限：只保留两张灵感卡，准星缩小防止溢出裁切 */
  .ga-inspo button:nth-child(n + 3) {
    display: none;
  }

  .ga-crosshair {
    width: 72px;
    height: 72px;
  }

  .ga-crosshair i {
    font-size: 26px;
  }
}

.ga-empty em {
  max-width: 420px;
  font-size: 10.5px;
  font-style: normal;
  line-height: 1.7;
  text-align: center;
  color: #8f969c;
}

/* 资产库历史筛选：早期未分类作品收在这里查看 */
.ga-history-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.ga-history-filter button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font: 700 10px/1 monospace;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-history-filter button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-shelf-kind {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 2;
  padding: 3px 7px;
  border-radius: 6px;
  background: #0d0f11cc;
  color: #c9ced2;
  font: 700 9px/1 monospace;
  letter-spacing: 0.06em;
  backdrop-filter: blur(4px);
}

/* ---------- 控制台组件 ---------- */
.ga-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ga-examples button {
  padding: 5px 10px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-examples button:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-chiprow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.ga-chiprow button {
  padding: 7px 11px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-chiprow button:hover:not(.is-on) {
  color: #d7dbde;
}

.ga-chiprow button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.ga-toggles button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ga-toggles button i {
  font-size: 14px;
}

.ga-toggles button.is-on {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-quality {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: 0;
  padding: 11px 13px;
  border: 0;
  border-left: 2px solid var(--acid);
  border-radius: 8px;
  background: #1e241c;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ga-quality span {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ga-quality strong {
  font-size: 10px;
}

.ga-quality i,
.ga-quality em {
  color: var(--acid);
}

.ga-quality em {
  font: 700 9px/1 monospace;
  font-style: normal;
}

.ga-quality.off {
  border-left-color: #4a5157;
  background: #191c1f;
}

.ga-quality.off i,
.ga-quality.off em {
  color: #7b8288;
}

.ga-cost {
  margin: 9px 0 0;
  color: #6d747a;
  font: 700 9px/1 monospace;
  text-align: center;
}

.ga-login-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  padding: 9px 12px;
  border: 1px dashed #3c4247;
  border-radius: 8px;
  color: #8a9197;
  font: 700 10px/1.5 monospace;
}

.ga-login-hint i {
  color: var(--acid);
}

/* ---------- 渲染进度与取消 ---------- */
.ga-progress {
  display: grid;
  gap: 5px;
  max-height: 120px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}

.ga-progress li {
  display: flex;
  align-items: center;
  gap: 7px;
  font: 600 10px/1.4 monospace;
  color: #8a9197;
}

.ga-progress li.is-running {
  color: #fff;
}

.ga-progress li.is-done {
  color: var(--acid);
}

.ga-progress li.is-failed {
  color: #ff9a9a;
}

.ga-progress li.is-cancelled {
  color: #666;
}

.ga-cancel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #ffffff30;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font: 700 10px/1 monospace;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ga-cancel:hover:not(:disabled) {
  border-color: var(--acid);
  background: #b8ff3514;
}

.ga-cancel:disabled {
  opacity: 0.55;
  cursor: wait;
}

/* ---------- 结果卡片：贴合图片比例，居中排布，无黑边 ---------- */
.ga-results {
  position: absolute;
  inset: 16px;
  z-index: 1;
  container-type: size;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  align-items: center;
  gap: 14px;
}

/* 卡片宽度 = min(列宽上限, 行高上限 × 图片比例)，高度由 aspect-ratio 推出，永不变形 */
.ga-card {
  --rowh: 100cqh;
  --maxw: 100cqw;
  position: relative;
  width: min(var(--maxw), calc(var(--rowh) * var(--car, 0.75)));
  aspect-ratio: var(--car, 0.75);
  border: 1px solid #2c3238;
  border-radius: 12px;
  background: #0e1013;
  overflow: hidden;
  box-shadow: 0 18px 40px #00000055;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.ga-results[data-count='2'] .ga-card {
  --maxw: calc(50cqw - 7px);
}

.ga-results[data-count='3'] .ga-card {
  --maxw: calc(33.3cqw - 10px);
}

.ga-results[data-count='4'] .ga-card {
  --rowh: calc(50cqh - 7px);
  --maxw: calc(50cqw - 7px);
}

/* ---------- 3D 透视堆叠（进入画布有成图时）：卡片隧道 + 景深 + 视差 ---------- */
.ga-output.is-deck {
  cursor: grab;
  touch-action: none;
}

.ga-output.is-deck:active,
.ga-results.is-deck-dragging {
  cursor: grabbing;
}

.ga-deck-fx {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

/* 氛围层不用运行时 filter（大面积 blur 逐帧渲染很贵），柔度全部烘进渐变 */
.ga-deck-orb {
  position: absolute;
  left: calc(12% + var(--o) * 11%);
  top: calc(18% + (var(--o) % 3) * 22%);
  width: calc(14px + (var(--o) % 4) * 8px);
  height: calc(14px + (var(--o) % 4) * 8px);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #f5ffe8cc, #b8ff3566 34%, #b8ff3522 58%, transparent 78%);
  opacity: 0.4;
  animation: ga-deck-float calc(7s + var(--o) * 0.7s) ease-in-out infinite;
  animation-delay: calc(var(--o) * -0.8s);
  will-change: transform;
}

.ga-deck-ribbon {
  position: absolute;
  left: -10%;
  right: -10%;
  top: 28%;
  height: 42%;
  background:
    radial-gradient(55% 80% at 50% 40%, #b8ff350e 0%, #b8ff3506 45%, transparent 72%),
    linear-gradient(115deg, transparent 24%, #ffffff05 42%, #ffffff08 50%, #ffffff05 58%, transparent 76%);
  opacity: 0.7;
  transform: rotate(-8deg);
  animation: ga-deck-ribbon 11s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes ga-deck-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(8px, -14px, 0) scale(1.08);
  }
}

@keyframes ga-deck-ribbon {
  0%,
  100% {
    transform: rotate(-8deg) translateY(0);
    opacity: 0.55;
  }
  50% {
    transform: rotate(-4deg) translateY(10px);
    opacity: 0.85;
  }
}

.ga-results.is-deck {
  display: grid;
  place-items: center;
  perspective: 950px;
  perspective-origin: 50% 84%;
  /* 不用 preserve-3d：配合卡片 3D 旋转会破坏 Chromium 命中测试（hover/点击失灵），
     堆叠层级由每张卡的 z-index 控制，视觉效果不变 */
  container-type: size;
  inset: 4px 16px 40px;
}

.ga-results.is-deck .ga-card {
  --maxw: min(360px, 50cqw);
  --rowh: min(500px, 80cqh);
  grid-area: 1 / 1;
  width: min(var(--maxw), calc(var(--rowh) * var(--car, 0.75)));
  transform: translate3d(0, var(--deck-y, 0), var(--deck-z, 0))
    rotateX(calc(var(--deck-rx, 8deg) + var(--tilt-y, 0deg)))
    rotateY(var(--tilt-x, 0deg))
    rotateZ(var(--deck-rz, 0deg))
    scale(var(--deck-scale, 1));
  opacity: var(--deck-opacity, 1);
  box-shadow: 0 24px 50px #00000080, 0 0 0 1px #ffffff10;
  /* 关键：基础卡片带 transform 过渡，逐帧驱动时会每帧重启过渡导致拖影卡顿 */
  transition: none;
  will-change: transform, opacity;
  pointer-events: none;
}

/* 后卡压暗：走遮罩透明度（可合成），不再用 filter: brightness 逐帧重绘 */
.ga-results.is-deck .ga-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #05070a;
  opacity: var(--deck-dim, 0);
  pointer-events: none;
}

/* 待机浮动：整叠错峰轻浮（独立 translate 属性，不与 3D 定位 transform 冲突） */
.ga-results.is-deck.is-deck-entered .ga-card {
  animation: ga-deck-bob 5.6s ease-in-out infinite;
  animation-delay: calc(var(--i, 0) * -1.4s);
}

.ga-results.is-deck-dragging .ga-card {
  animation-play-state: paused;
}

@keyframes ga-deck-bob {
  0%,
  100% {
    translate: 0 0;
  }

  50% {
    translate: 0 -6px;
  }
}

.ga-results.is-deck .ga-card.is-front {
  pointer-events: auto;
  border-color: #b8ff3566;
  box-shadow:
    0 32px 70px #00000099,
    0 0 0 1px #b8ff3540,
    0 0 48px #b8ff3524;
  transition: scale 0.32s cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 0.32s ease;
}

/* hover 上浮：前卡放大压近镜头 + 辉光增强（scale 独立属性叠加在 3D 定位之上） */
.ga-results.is-deck.is-deck-entered .ga-card.is-front:hover {
  scale: 1.04;
  box-shadow:
    0 42px 86px #000000b3,
    0 0 0 1px #b8ff3573,
    0 0 62px #b8ff3536;
}

.ga-results.is-deck .ga-card:hover {
  transform: translate3d(0, var(--deck-y, 0), var(--deck-z, 0))
    rotateX(calc(var(--deck-rx, 8deg) + var(--tilt-y, 0deg)))
    rotateY(var(--tilt-x, 0deg))
    rotateZ(var(--deck-rz, 0deg))
    scale(var(--deck-scale, 1));
}

.ga-results.is-deck .ga-pop-enter-active,
.ga-results.is-deck .ga-pop-leave-active {
  animation: none;
  transition: none;
}

.ga-results.is-deck .ga-card-actions {
  opacity: 0;
}

.ga-results.is-deck .ga-card.is-front:hover .ga-card-actions,
.ga-results.is-deck .ga-card.is-front:focus-within .ga-card-actions {
  opacity: 1;
  transform: none;
}

.ga-deck-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0;
  color: #6d747a;
  font: 700 10px/1 monospace;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.ga-deck-hint i {
  color: var(--acid);
  opacity: 0.75;
}

@media (max-width: 700px) {
  .ga-results.is-deck {
    inset: 8px 10px 40px;
  }

  .ga-results.is-deck .ga-card {
    --maxw: min(300px, 84cqw);
    --rowh: min(430px, 88cqh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ga-deck-orb,
  .ga-deck-ribbon,
  .ga-results.is-deck.is-deck-entered .ga-card {
    animation: none;
  }
}

.ga-card:hover {
  border-color: #b8ff3555;
  box-shadow: 0 22px 48px #00000073, 0 0 0 1px #b8ff351f;
  transform: translateY(-2px);
}

.ga-card-view {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}

.ga-card-view :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: transparent;
}

.ga-card-actions {
  position: absolute;
  left: 50%;
  bottom: 10px;
  z-index: 2;
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 1px solid #ffffff14;
  border-radius: 10px;
  /* 不用 backdrop-filter：卡片逐帧移动时实时背景模糊代价极高 */
  background: #0d0f11f2;
  opacity: 0;
  transform: translate(-50%, 8px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ga-card:hover .ga-card-actions,
.ga-card:focus-within .ga-card-actions {
  opacity: 1;
  transform: translate(-50%, 0);
}

.ga-card-actions button {
  width: 32px;
  height: 30px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #aab0b6;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ga-card-actions button:hover:not(:disabled) {
  background: #24282c;
  color: var(--acid);
}

.ga-card-actions button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ga-card-actions button.is-armed {
  background: #d64545;
  color: #fff;
}

/* 出错卡片：图像加载失败时渲染故障图形 */
.ga-card-error {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  height: 100%;
  padding: 14px;
  color: #e29a9a;
  background:
    repeating-linear-gradient(45deg, #17111266 0 10px, transparent 10px 20px),
    #120f10;
}

.ga-card-error svg {
  width: 52px;
  height: 52px;
  fill: none;
  stroke: #9c5b5b;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ga-card-error .ga-card-error-slash {
  stroke: #ff6b6b;
  stroke-width: 4;
}

.ga-card-error strong {
  font: 700 10.5px/1 monospace;
  letter-spacing: 0.08em;
}

.ga-card-error-actions {
  display: flex;
  gap: 6px;
}

.ga-card-error-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid #5a3a3d;
  border-radius: 8px;
  background: transparent;
  color: #e0a4a4;
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-card-error-actions button:hover {
  border-color: #ff6b6b;
  color: #ffb3b3;
}

.ga-card-error-actions button.is-armed {
  border-color: #d64545;
  background: #d64545;
  color: #fff;
}

.ga-card-skeleton {
  display: block;
  border: 1px dashed #2c3238;
  border-radius: 12px;
  background: linear-gradient(110deg, #14171a 30%, #21262b 50%, #14171a 70%);
  background-size: 220% 100%;
  animation: ga-shimmer 1.5s ease-in-out infinite;
}

/* 弹出动效：普通进场（历史回放等）轻翻入即可 */
.ga-pop-enter-active {
  animation: ga-pop-in 0.72s cubic-bezier(0.22, 1.1, 0.32, 1) both;
  animation-delay: calc(var(--i, 0) * 130ms);
}

.ga-pop-leave-active {
  position: absolute;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ga-pop-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@keyframes ga-pop-in {
  0% {
    opacity: 0;
    transform: perspective(1100px) translateY(26px) rotateY(-72deg) scale(0.9);
    filter: brightness(1.9) saturate(1.4);
  }

  60% {
    opacity: 1;
    transform: perspective(1100px) translateY(0) rotateY(9deg) scale(1.015);
    filter: brightness(1.12) saturate(1.1);
  }

  100% {
    opacity: 1;
    transform: none;
    filter: none;
  }
}

/* ---------- 抽卡揭晓（参考实体抽卡）：卡背旋入 → 金色光带下扫擦亮成图 → 边缘闪光 ---------- */
.ga-results.is-fresh .ga-pop-enter-active {
  animation: ga-spin-in 1.05s cubic-bezier(0.16, 0.8, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms);
}

@keyframes ga-spin-in {
  0% {
    opacity: 0;
    transform: perspective(1200px) translateY(42px) rotateY(-520deg) scale(0.5);
  }

  30% {
    opacity: 1;
  }

  100% {
    opacity: 1;
    transform: none;
  }
}

/* 卡背：旋入阶段盖住成图，随光带下扫被逐行擦掉 */
.ga-card-back {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border-radius: inherit;
  background:
    repeating-linear-gradient(-38deg, #ffffff06 0 2px, transparent 2px 11px),
    radial-gradient(90% 90% at 50% 34%, #1a2418 0%, #0b0e12 74%);
  box-shadow: inset 0 0 0 1px #b8ff3548, inset 0 0 40px #b8ff3512;
  pointer-events: none;
  animation: ga-back-wipe 0.95s cubic-bezier(0.6, 0, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.2s);
}

.ga-card-back i {
  font-size: clamp(28px, 3.6vw, 44px);
  color: var(--acid);
  text-shadow: 0 0 26px #b8ff3588;
}

.ga-card-back em {
  color: #5f6b60;
  font: 700 9px/1 monospace;
  letter-spacing: 0.4em;
  font-style: normal;
}

@keyframes ga-back-wipe {
  to {
    clip-path: inset(100% 0 0 0);
  }
}

/* 金色光带：与卡背擦除同速自上而下划过 */
.ga-card-sweep {
  position: absolute;
  left: -12%;
  right: -12%;
  top: -18%;
  height: 16%;
  z-index: 4;
  pointer-events: none;
  background: linear-gradient(180deg, transparent, #fff7d894 42%, #ffd76ae0 56%, transparent);
  filter: blur(5px) brightness(1.35);
  opacity: 0;
  animation: ga-sweep-down 0.95s cubic-bezier(0.6, 0, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.2s);
}

@keyframes ga-sweep-down {
  0% {
    opacity: 0;
    transform: translateY(0);
  }

  12% {
    opacity: 1;
  }

  86% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateY(760%);
  }
}

/* 揭晓收尾：边缘金色闪光一次 */
.ga-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: inherit;
  box-shadow: inset 0 0 0 2px #ffe9a0cc, inset 0 0 36px #ffd76a55;
  opacity: 0;
  pointer-events: none;
}

.ga-results.is-fresh .ga-card::after {
  animation: ga-rim-flash 0.9s ease-out both;
  animation-delay: calc(var(--i, 0) * 200ms + 1.95s);
}

@keyframes ga-rim-flash {
  0% {
    opacity: 0;
  }

  25% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}

.ga-more-hint {
  margin: 8px 0 0;
  text-align: center;
}

.ga-more-hint button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: #6d747a;
  font: 700 9.5px/1 monospace;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: color 0.15s ease;
}

.ga-more-hint button:hover {
  color: var(--acid);
}

@media (max-width: 700px) {
  .ga-results {
    gap: 10px;
  }

  .ga-results[data-count='3'] .ga-card,
  .ga-results[data-count='4'] .ga-card {
    --rowh: calc(50cqh - 5px);
    --maxw: calc(50cqw - 5px);
  }

  .ga-card-error svg {
    width: 40px;
    height: 40px;
  }
}

/* ---------- 画布顶部的模型切换 ---------- */
.ga-canvas-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ga-model-pick {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-right: 8px;
  padding: 0 10px;
  height: 30px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #14171a;
  transition: border-color 0.15s ease;
}

.ga-model-pick:hover,
.ga-model-pick:focus-within {
  border-color: var(--acid);
}

.ga-model-pick > i {
  font-size: 12px;
  color: var(--acid);
}

.ga-model-pick select {
  max-width: 190px;
  border: 0;
  background: transparent;
  color: #d7dbde;
  font: 700 10px/1 inherit;
  cursor: pointer;
  outline: none;
}

.ga-model-pick select option {
  background: #14171a;
  color: #d7dbde;
}

/* ---------- 画布底部的创作条 ---------- */
.ga-composer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: stretch;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #2c3238;
  border-radius: 14px;
  background: linear-gradient(180deg, #16191d, #121417);
  box-shadow: 0 14px 32px #00000047, inset 0 1px 0 #ffffff08;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.ga-composer:focus-within {
  border-color: #b8ff3566;
  box-shadow: 0 14px 32px #00000047, 0 0 0 3px #b8ff3512, inset 0 1px 0 #ffffff08;
}

.ga-composer.is-drop {
  border-color: var(--acid);
  box-shadow: 0 0 0 3px #b8ff3529;
}

.ga-composer-ref {
  position: relative;
  flex: 0 0 auto;
}

.ga-composer-ref-pick {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 3px;
  width: 66px;
  height: 100%;
  min-height: 66px;
  padding: 4px;
  border: 1px dashed #3c4247;
  border-radius: 10px;
  background: #101214;
  color: #7b8288;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-composer-ref-pick:hover {
  border-color: var(--acid);
  color: var(--acid);
  background: #b8ff350a;
}

.ga-composer-ref-pick i {
  font-size: 15px;
}

.ga-composer-ref-pick span {
  font-size: 8.5px;
  font-weight: 700;
}

.ga-composer-ref.has-image .ga-composer-ref-pick {
  padding: 0;
  border-style: solid;
}

.ga-composer-ref.has-image .ga-composer-ref-pick img,
.ga-composer-ref.has-image .ga-composer-ref-pick :deep(.authenticated-image) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ga-composer-ref-clear {
  position: absolute;
  right: -6px;
  top: -6px;
  z-index: 2;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid #ffffff2e;
  border-radius: 50%;
  background: #0d0f11;
  color: #fff;
  font-size: 9px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.ga-composer-ref-clear:hover {
  border-color: #d64545;
  background: #d64545;
}

.ga-composer-main {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.ga-composer-main textarea {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  color: #e9ebec;
  font: 11.5px/1.6 inherit;
  resize: none;
  outline: none;
}

.ga-composer-main textarea::placeholder {
  color: #5d646a;
}

.ga-composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ga-composer-tools .ga-examples {
  margin-top: 0;
  overflow: hidden;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.ga-composer-run {
  display: grid;
  gap: 5px;
  align-content: center;
  flex: 0 0 auto;
}

.ga-composer-run .ga-cost {
  margin: 0;
}

@media (max-width: 700px) {
  .ga-composer {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .ga-composer-run {
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr);
  }

  .ga-composer-run .ga-generate {
    width: 100%;
  }

  .ga-composer-tools .ga-examples button:nth-child(n + 3) {
    display: none;
  }

  .ga-model-pick select {
    max-width: 96px;
  }
}

/* ---------- 资产库抽屉 ---------- */
.ga-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10040;
  background: rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(6px);
}

.ga-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 94vw);
  display: flex;
  flex-direction: column;
  background: #121417;
  border-left: 1px solid #2c3034;
  box-shadow: -30px 0 80px #000a;
  color: #f6f7f7;
}

.ga-drawer > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #2c3034;
}

.ga-drawer-tabs {
  display: flex;
  gap: 6px;
}

.ga-drawer-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border: 1px solid #363b40;
  border-radius: 8px;
  background: #101214;
  color: #9aa1a7;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ga-drawer-tabs button.is-on {
  border-color: var(--acid);
  background: #1b201b;
  color: var(--acid);
}

.ga-drawer-close {
  width: 34px;
  height: 34px;
  border: 1px solid #3c4247;
  border-radius: 8px;
  background: #191c1f;
  color: #fff;
  cursor: pointer;
}

.ga-drawer-close:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scrollbar-width: thin;
}

.ga-drawer-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0;
  color: #8a9197;
  font-size: 11px;
}

.ga-drawer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.ga-shelf-item {
  border: 1px solid #30353a;
  border-radius: 8px;
  background: #171a1d;
  overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.ga-shelf-item:hover {
  transform: translateY(-3px);
  border-color: #4a5157;
  box-shadow: 0 10px 30px #000a;
}

.ga-shelf-pick {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4/3;
  padding: 0;
  border: 0;
  background: #101214;
  cursor: pointer;
}

.ga-shelf-item.is-asset .ga-shelf-pick {
  cursor: default;
}

.ga-shelf-pick :deep(.authenticated-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ga-asset-status {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 3px 7px;
  border-radius: 8px;
  background: #0d0f11d9;
  color: #e8b34c;
  font: 700 9px/1 monospace;
}

.ga-asset-status[data-status='approved'] {
  color: var(--acid);
}

.ga-asset-status[data-status='rejected'] {
  color: #ff9a9a;
}

.ga-shelf-item > footer {
  display: flex;
  justify-content: space-around;
  padding: 7px 6px;
  border-top: 1px solid #24282c;
}

.ga-shelf-item > footer button {
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8a9197;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ga-shelf-item > footer button:hover:not(:disabled) {
  background: #24282c;
  color: var(--acid);
}

.ga-shelf-item > footer button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ga-shelf-item > footer button.is-armed {
  background: #d64545;
  color: #fff;
}

.ga-shelf-item > footer.is-meta {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  text-align: left;
}

.ga-shelf-item > footer.is-meta strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ga-shelf-item > footer.is-meta small {
  color: #6d747a;
  font-size: 9px;
}

.ga-drawer-enter-active,
.ga-drawer-leave-active {
  transition: opacity 0.2s ease;
}

.ga-drawer-enter-active .ga-drawer,
.ga-drawer-leave-active .ga-drawer {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.ga-drawer-enter-from,
.ga-drawer-leave-to {
  opacity: 0;
}

.ga-drawer-enter-from .ga-drawer,
.ga-drawer-leave-to .ga-drawer {
  transform: translateX(40px);
}

/* ---------- 大图 ---------- */
.ga-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 28px;
  background: #070809e8;
  backdrop-filter: blur(10px);
}

.ga-fullscreen :deep(.authenticated-image) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 30px 90px #000c, 0 0 0 1px #b8ff3522;
}

.ga-fullscreen > button {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 42px;
  height: 42px;
  border: 1px solid #3c4247;
  border-radius: 8px;
  background: #121417cc;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}

.ga-fullscreen > button:hover {
  border-color: var(--acid);
  color: var(--acid);
}

.ga-zoom-enter-active,
.ga-zoom-leave-active {
  transition: opacity 0.18s ease;
}

.ga-zoom-enter-from,
.ga-zoom-leave-to {
  opacity: 0;
}

@keyframes ga-shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ga-card-skeleton {
    animation: none;
  }

  .ga-pop-enter-active,
  .ga-results.is-fresh .ga-pop-enter-active,
  .ga-results.is-fresh .ga-card::after {
    animation: none;
  }

  .ga-card-back,
  .ga-card-sweep {
    display: none;
  }

  .ga-type-enter-active,
  .ga-type-leave-active,
  .ga-drawer-enter-active .ga-drawer,
  .ga-drawer-leave-active .ga-drawer,
  .ga-card,
  .ga-shelf-item {
    transition: none;
  }
}
</style>
