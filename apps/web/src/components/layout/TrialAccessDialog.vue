<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatPoints } from '@/services/billingApi'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import {
  claimTrialAccessReward,
  getTrialAccessCampaign,
  getTrialAccessApplication,
  submitTrialAccessApplication,
} from '@/services/trialAccessApi'
import notificationService from '@/services/notification'
import { useClientNotifications } from '@/composables/useClientNotifications'
import { useClientWalletBalance } from '@/composables/useClientWalletBalance'
import { useAppearanceStore } from '@/stores/appearance'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { setBodyScrollLock } from '@/utils/bodyScrollLock'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'submitted', 'redeemed'])

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const localeStore = useLocaleStore()
const { availableCents, refreshWalletBalance, applyWalletSnapshot } = useClientWalletBalance()
const { refreshPreview, refreshUnreadCount } = useClientNotifications()

const dialog = ref(null)
const occupationInput = ref(null)
const loading = ref(false)
const submitting = ref(false)
const redeeming = ref(false)
const application = ref(null)
const campaign = ref(null)
const campaignLoading = ref(false)
const campaignError = ref('')
const loadError = ref('')
const occupation = ref('')
const selectedOccupations = ref([])
const reason = ref('')
const animatedReward = ref(0)
const animatedBalance = ref(0)
const occupationPickerOpen = ref(false)
const occupationCategory = ref('all')
const occupationSearch = ref('')
const customOccupation = ref('')
const occupationSearchInput = ref(null)
const TRIAL_DIALOG_SCROLL_LOCK = 'trial-access-dialog'
const PENDING_POLL_MS = 20_000
const MAX_OCCUPATIONS = 4

let pendingPollTimer = null
let applicationRequest = null
let campaignRequest = null
let campaignExpiryTimer = null
let numberAnimationFrame = 0

const isEnglish = computed(() => localeStore.locale === 'en')
const isTraditional = computed(() => localeStore.locale === 'zh-TW')
const localize = (simplified, traditional = simplified) =>
  isTraditional.value ? traditional : simplified

const occupationGroup = (id, icon, zh, en, occupations) => ({
  id,
  icon,
  zh,
  en,
  occupations: occupations.map(([nameZh, nameEn]) => ({ zh: nameZh, en: nameEn })),
})

const OCCUPATION_GROUPS = [
  occupationGroup('visual', 'bi-palette2', '视觉与平面', 'Visual & graphic', [
    ['平面设计师', 'Graphic designer'],
    ['品牌设计师', 'Brand designer'],
    ['UI 设计师', 'UI designer'],
    ['UX 设计师', 'UX designer'],
    ['网页设计师', 'Web designer'],
    ['插画师', 'Illustrator'],
    ['字体设计师', 'Type designer'],
    ['包装设计师', 'Packaging designer'],
    ['信息可视化设计师', 'Information designer'],
    ['艺术指导', 'Art director'],
  ]),
  occupationGroup('content', 'bi-camera-reels', '内容与社交媒体', 'Content & social media', [
    ['自媒体创作者', 'Independent creator'],
    ['短视频创作者', 'Short-form video creator'],
    ['摄影师', 'Photographer'],
    ['修图师', 'Photo retoucher'],
    ['文案策划', 'Copywriter'],
    ['新媒体运营', 'New media operator'],
    ['社交媒体运营', 'Social media manager'],
    ['编辑 / 记者', 'Editor / journalist'],
    ['博主 / KOL', 'Blogger / influencer'],
    ['直播主播', 'Live streamer'],
  ]),
  occupationGroup('film', 'bi-film', '影视与动画', 'Film & animation', [
    ['导演', 'Director'],
    ['制片人', 'Producer'],
    ['编剧', 'Screenwriter'],
    ['分镜师', 'Storyboard artist'],
    ['剪辑师', 'Video editor'],
    ['调色师', 'Colorist'],
    ['视觉特效师 / VFX', 'VFX artist'],
    ['动画师', 'Animator'],
    ['动效设计师', 'Motion designer'],
    ['广告创意', 'Advertising creative'],
  ]),
  occupationGroup('game', 'bi-controller', '游戏与 3D', 'Games & 3D', [
    ['游戏策划', 'Game designer'],
    ['游戏美术', 'Game artist'],
    ['原画师', 'Concept artist'],
    ['角色设计师', 'Character designer'],
    ['场景设计师', 'Environment designer'],
    ['3D 建模师', '3D modeler'],
    ['技术美术', 'Technical artist'],
    ['游戏开发者', 'Game developer'],
    ['独立游戏制作人', 'Indie game maker'],
    ['虚拟人设计师', 'Digital human designer'],
  ]),
  occupationGroup('product', 'bi-code-square', '产品与技术', 'Product & technology', [
    ['产品经理', 'Product manager'],
    ['产品设计师', 'Product designer'],
    ['前端开发工程师', 'Frontend developer'],
    ['后端开发工程师', 'Backend developer'],
    ['全栈开发工程师', 'Full-stack developer'],
    ['AI 工程师', 'AI engineer'],
    ['数据分析师', 'Data analyst'],
    ['数据科学家', 'Data scientist'],
    ['独立开发者', 'Independent developer'],
    ['科技创业者', 'Technology founder'],
  ]),
  occupationGroup('commerce', 'bi-megaphone', '电商与品牌营销', 'Commerce & marketing', [
    ['电商运营', 'E-commerce operator'],
    ['跨境电商从业者', 'Cross-border e-commerce'],
    ['店铺设计师', 'Storefront designer'],
    ['商业摄影师', 'Commercial photographer'],
    ['市场营销', 'Marketing specialist'],
    ['品牌运营', 'Brand manager'],
    ['广告投放', 'Media buyer'],
    ['公关传播', 'Public relations'],
    ['销售 / 商务', 'Sales / business development'],
    ['社群运营', 'Community manager'],
  ]),
  occupationGroup('space', 'bi-buildings', '建筑与空间工业', 'Architecture & industrial', [
    ['建筑师', 'Architect'],
    ['室内设计师', 'Interior designer'],
    ['景观设计师', 'Landscape designer'],
    ['城市规划师', 'Urban planner'],
    ['工业设计师', 'Industrial designer'],
    ['家具设计师', 'Furniture designer'],
    ['珠宝设计师', 'Jewelry designer'],
    ['服装设计师', 'Fashion designer'],
    ['展陈设计师', 'Exhibition designer'],
    ['汽车设计师', 'Automotive designer'],
  ]),
  occupationGroup('education', 'bi-mortarboard', '教育与研究', 'Education & research', [
    ['学生', 'Student'],
    ['教师', 'Teacher'],
    ['高校研究者', 'Academic researcher'],
    ['AI 研究员', 'AI researcher'],
    ['培训讲师', 'Trainer'],
    ['课程设计师', 'Instructional designer'],
    ['科普创作者', 'Science communicator'],
    ['教育产品经理', 'Education product manager'],
    ['图书馆 / 档案从业者', 'Library / archive professional'],
    ['学术出版从业者', 'Academic publishing professional'],
  ]),
  occupationGroup('professional', 'bi-briefcase', '企业与专业服务', 'Business & professional', [
    ['企业管理者', 'Business manager'],
    ['咨询顾问', 'Consultant'],
    ['人力资源', 'Human resources'],
    ['法律从业者', 'Legal professional'],
    ['金融从业者', 'Finance professional'],
    ['医疗从业者', 'Healthcare professional'],
    ['房地产从业者', 'Real estate professional'],
    ['行政 / 综合运营', 'Administration / operations'],
    ['客户服务', 'Customer service'],
    ['政府 / 公共服务', 'Government / public service'],
  ]),
  occupationGroup('independent', 'bi-person-workspace', '自由职业与其他', 'Independent & other', [
    ['自由职业者', 'Freelancer'],
    ['工作室主理人', 'Studio owner'],
    ['艺术家', 'Artist'],
    ['手工艺人', 'Craftsperson'],
    ['音乐人', 'Musician'],
    ['作家', 'Writer'],
    ['农业从业者', 'Agriculture professional'],
    ['餐饮从业者', 'Food service professional'],
    ['旅游从业者', 'Travel professional'],
    ['其他职业', 'Other occupation'],
  ]),
]

const copy = computed(() => {
  if (isEnglish.value) {
    return {
      title: 'Get trial access',
      eyebrow: 'EARLY CREATOR PROGRAM',
      intro: 'Tell us how you create. Approved applicants can claim trial credits with one click.',
      stepOne: 'Create or sign in to your account',
      stepTwo: 'Submit your occupation and reason',
      stepThree: 'Claim trial credits and enter the approved workspaces',
      registerTitle: 'Create an account first',
      registerBody:
        'Your application, review result, and credits will stay securely connected to your account.',
      register: 'Sign up for free',
      login: 'Already registered? Sign in',
      formTitle: 'Apply for trial access',
      formBody: 'Tell us briefly what you do and what you want to create.',
      occupation: 'Occupation',
      occupationPlaceholder: 'Choose your occupation',
      occupationPickerTitle: 'Choose your occupation',
      occupationPickerEyebrow: 'OCCUPATION DIRECTORY',
      occupationSearch: 'Search occupations',
      occupationAll: 'All occupations',
      occupationCustom: 'Occupation not listed',
      occupationCustomPlaceholder: 'Enter your occupation',
      occupationUseCustom: 'Add',
      occupationEmpty: 'No matching occupations',
      occupationCount: 'occupations',
      occupationLimit: 'Select up to 4 occupations',
      occupationSelected: 'Selected',
      occupationDone: 'Done',
      occupationLimitReached: 'You can select up to 4 occupations',
      occupationClose: 'Close occupation picker',
      reason: 'Why do you need trial access?',
      reasonPlaceholder: 'Tell us what you want to create and how you plan to use the platform…',
      submit: 'Submit application',
      submitting: 'Submitting…',
      rejected: 'Previous application was not approved',
      reapply: 'Update the information below and submit again.',
      pendingTitle: 'Application under review',
      pendingBody:
        'We received your application. The result will appear here and in your notifications.',
      refresh: 'Refresh status',
      pendingClose: 'Got it',
      approvedTitle: 'Trial access approved',
      approvedBody: 'Your feature access is active. Claimed credits work across all approved workspaces.',
      rewardReady: 'Credits ready',
      expires: 'Claim by',
      noExpiry: 'No expiry',
      approvedNote: 'Review note',
      claim: 'Claim now',
      claiming: 'Claiming…',
      redeemedTitle: 'Trial credits received',
      redeemedBody: 'The credits are ready. Choose an approved workspace to begin.',
      expiredTitle: 'Trial credits expired',
      expiredBody: 'The claim window has ended. Please wait for an administrator to reissue credits.',
      received: 'Received',
      walletBalance: 'Wallet balance',
      create: 'Start creating',
      wallet: 'View wallet',
      trialFeatures: 'Trial features',
      retry: 'Retry',
      close: 'Close trial access dialog',
      applied: 'Applied',
      remaining: 'Remaining',
      yourPosition: 'Your position',
      nextPosition: 'Next applicant',
      campaignDeadline: 'Ends',
      closedTitle: 'Applications are closed',
      closedBody:
        'This trial round is closed. Applications, reviews, credit claims, and trial access are unavailable.',
    }
  }
  return {
    title: localize('获取体验资格', '取得體驗資格'),
    eyebrow: 'EARLY CREATOR PROGRAM',
    intro: localize(
      '告诉我们你的创作方式。审核通过后，可一键领取体验积分。',
      '告訴我們你的創作方式。審核通過後，可一鍵領取體驗積分。',
    ),
    stepOne: localize('注册或登录账号', '註冊或登入帳號'),
    stepTwo: localize('填写职业与申请理由', '填寫職業與申請理由'),
    stepThree: localize('领取活动体验积分并进入获批工作台', '領取活動體驗積分並進入獲批工作台'),
    registerTitle: localize('请先注册账号', '請先註冊帳號'),
    registerBody: localize(
      '申请进度、审核结果和体验积分都会安全地绑定到你的账号。',
      '申請進度、審核結果和體驗積分都會安全地綁定到你的帳號。',
    ),
    register: localize('免费注册', '免費註冊'),
    login: localize('已有账号，去登录', '已有帳號，去登入'),
    formTitle: localize('申请体验资格', '申請體驗資格'),
    formBody: localize('简单说明你的职业和创作计划。', '簡單說明你的職業和創作計劃。'),
    occupation: localize('你的职业', '你的職業'),
    occupationPlaceholder: localize('点击选择职业', '點擊選擇職業'),
    occupationPickerTitle: localize('选择你的职业', '選擇你的職業'),
    occupationPickerEyebrow: localize('职业目录', '職業目錄'),
    occupationSearch: localize('搜索职业名称', '搜尋職業名稱'),
    occupationAll: localize('全部职业', '全部職業'),
    occupationCustom: localize('职业不在列表中', '職業不在清單中'),
    occupationCustomPlaceholder: localize('输入你的职业', '輸入你的職業'),
    occupationUseCustom: localize('添加', '新增'),
    occupationEmpty: localize('没有找到匹配的职业', '沒有找到符合的職業'),
    occupationCount: localize('个职业', '個職業'),
    occupationLimit: localize('最多选择 4 个职业', '最多選擇 4 個職業'),
    occupationSelected: localize('已选', '已選'),
    occupationDone: localize('完成选择', '完成選擇'),
    occupationLimitReached: localize('最多只能选择 4 个职业', '最多只能選擇 4 個職業'),
    occupationClose: localize('关闭职业选择', '關閉職業選擇'),
    reason: localize('申请理由', '申請理由'),
    reasonPlaceholder: localize(
      '请说明你想创作什么，以及准备如何使用平台…',
      '請說明想創作的內容，以及準備如何使用平台…',
    ),
    submit: localize('提交申请', '提交申請'),
    submitting: localize('正在提交…', '正在提交…'),
    rejected: localize('上次申请未通过', '上次申請未通過'),
    reapply: localize('可以更新下方信息后重新提交。', '可更新下方資料後重新提交。'),
    pendingTitle: localize('申请审核中', '申請審核中'),
    pendingBody: localize(
      '申请已收到，审核结果会显示在这里并通过站内通知提醒你。',
      '申請已收到，審核結果會顯示在這裡並透過站內通知提醒你。',
    ),
    refresh: localize('刷新状态', '重新整理狀態'),
    pendingClose: localize('我知道了', '我知道了'),
    approvedTitle: localize('体验资格已通过', '體驗資格已通過'),
    approvedBody: localize(
      '真实功能权限已经生效，领取后积分可用于全部获批功能。',
      '真實功能權限已經生效，領取後積分可用於全部獲批功能。',
    ),
    rewardReady: localize('待领取积分', '待領取積分'),
    expires: localize('领取有效期至', '領取有效期至'),
    noExpiry: localize('长期有效', '長期有效'),
    approvedNote: localize('审核说明', '審核說明'),
    claim: localize('立即领取', '立即領取'),
    claiming: localize('领取中…', '領取中…'),
    redeemedTitle: localize('体验积分已到账', '體驗積分已到帳'),
    redeemedBody: localize(
      '活动体验积分已经存入钱包，现在选择获批工作台开始体验。',
      '活動體驗積分已經存入錢包，現在選擇獲批工作台開始體驗。',
    ),
    expiredTitle: localize('体验积分已过期', '體驗積分已過期'),
    expiredBody: localize(
      '领取期限已经结束，请等待管理员重新发放体验积分。',
      '領取期限已經結束，請等待管理員重新發放體驗積分。',
    ),
    received: localize('本次到账', '本次到帳'),
    walletBalance: localize('钱包可用积分', '錢包可用積分'),
    create: localize('开始创作', '開始創作'),
    wallet: localize('查看钱包', '查看錢包'),
    trialFeatures: localize('体验功能', '體驗功能'),
    retry: localize('重试', '重試'),
    close: localize('关闭体验资格弹窗', '關閉體驗資格彈窗'),
    applied: localize('已申请', '已申請'),
    remaining: localize('剩余名额', '剩餘名額'),
    yourPosition: localize('你的申请排位', '你的申請排位'),
    nextPosition: localize('下一位申请者', '下一位申請者'),
    campaignDeadline: localize('活动截止', '活動截止'),
    closedTitle: localize('本期申请已结束', '本期申請已結束'),
    closedBody: localize(
      '本期体验名额已满或活动已关闭，申请、审核、积分领取和体验入口均已停止。',
      '本期體驗名額已滿或活動已關閉，申請、審核、積分領取和體驗入口均已停止。',
    ),
  }
})

const status = computed(() => application.value?.status || '')
const rewardStatus = computed(() => application.value?.rewardStatus || '')
const rewardCents = computed(() => Math.max(0, Number(application.value?.rewardCents || 0)))
const rewardClaimed = computed(
  () => status.value === 'approved' && rewardStatus.value === 'redeemed',
)
const campaignTitle = computed(() => campaign.value?.title || copy.value.title)
function sourceFeatures(source) {
  if (Array.isArray(source?.features) && source.features.length) return source.features
  return source?.feature ? [source.feature] : []
}

const campaignFeatures = computed(() => sourceFeatures(campaign.value))
const applicationFeatures = computed(() => sourceFeatures(application.value))
const activeFeatures = computed(() =>
  ['pending', 'approved'].includes(status.value)
    ? applicationFeatures.value
    : campaignFeatures.value,
)
const activeFeature = computed(() => activeFeatures.value[0] || null)
const featureRoute = computed(
  () => activeFeature.value?.route || campaign.value?.featureRoute || '/studio',
)
const campaignClosed = computed(
  () => !campaignLoading.value && (!campaign.value || !campaign.value.enabled),
)
const campaignUnavailable = computed(() => campaignClosed.value || campaign.value?.full)
const applicantPosition = computed(() => {
  const value = application.value?.position || campaign.value?.nextPosition || 0
  return Math.max(0, Number(value || 0))
})
const campaignProgress = computed(() => {
  const capacity = Math.max(0, Number(campaign.value?.capacity || 0))
  if (!capacity) return 0
  return Math.min(100, (Math.max(0, Number(campaign.value?.displayApplied || 0)) / capacity) * 100)
})
const campaignRemainingText = computed(() => {
  const expiresAt = new Date(campaign.value?.expiresAt || '').getTime()
  const milliseconds = expiresAt - Date.now()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return isEnglish.value ? 'Ended' : localize('已到期', '已到期')
  }
  const hours = Math.ceil(milliseconds / (60 * 60 * 1000))
  if (hours < 24) {
    return isEnglish.value ? `${hours}h left` : localize(`剩余 ${hours} 小时`, `剩餘 ${hours} 小時`)
  }
  const days = Math.ceil(hours / 24)
  return isEnglish.value ? `${days}d left` : localize(`剩余 ${days} 天`, `剩餘 ${days} 天`)
})
const screen = computed(() => {
  if (campaignLoading.value && !campaign.value) return 'loading'
  if (!authStore.isAuthenticated) return campaignUnavailable.value ? 'unavailable' : 'auth'
  if (loading.value && !application.value) return 'loading'
  if (loadError.value && !application.value) return 'error'
  if (campaignClosed.value) return 'unavailable'
  if (status.value === 'pending') return 'pending'
  if (status.value === 'approved' && rewardStatus.value === 'expired') return 'expired'
  if (status.value === 'approved') return rewardClaimed.value ? 'redeemed' : 'approved'
  if (campaignUnavailable.value) return 'unavailable'
  return 'apply'
})
const localizedOccupationGroups = computed(() =>
  OCCUPATION_GROUPS.map((group) => ({
    ...group,
    label: isEnglish.value ? group.en : group.zh,
    occupations: group.occupations.map((item) => ({
      ...item,
      label: isEnglish.value ? item.en : item.zh,
    })),
  })),
)
const occupationTotal = computed(() =>
  localizedOccupationGroups.value.reduce((total, group) => total + group.occupations.length, 0),
)
const visibleOccupationGroups = computed(() => {
  const query = occupationSearch.value.trim().toLocaleLowerCase()
  return localizedOccupationGroups.value
    .filter(
      (group) =>
        query || occupationCategory.value === 'all' || group.id === occupationCategory.value,
    )
    .map((group) => ({
      ...group,
      occupations: group.occupations.filter((item) => {
        if (!query) return true
        return `${item.zh} ${item.en}`.toLocaleLowerCase().includes(query)
      }),
    }))
    .filter((group) => group.occupations.length > 0)
})
const visibleOccupationCount = computed(() =>
  visibleOccupationGroups.value.reduce((total, group) => total + group.occupations.length, 0),
)

function serializeOccupations(items = selectedOccupations.value) {
  return items.join(isEnglish.value ? '; ' : '、')
}

function parseOccupations(value) {
  return String(value || '')
    .split(/\s*(?:、|;)\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_OCCUPATIONS)
}

function setOccupationSelections(value) {
  selectedOccupations.value = parseOccupations(value)
  occupation.value = serializeOccupations()
}

function syncOccupationValue() {
  occupation.value = serializeOccupations()
}

function openOccupationPicker() {
  occupationCategory.value = 'all'
  occupationSearch.value = ''
  customOccupation.value = ''
  occupationPickerOpen.value = true
  nextTick(() => occupationSearchInput.value?.focus())
}

function closeOccupationPicker({ restoreFocus = true } = {}) {
  occupationPickerOpen.value = false
  occupationSearch.value = ''
  if (restoreFocus) nextTick(() => occupationInput.value?.focus())
}

function selectOccupation(value) {
  const normalized = String(value || '')
    .trim()
    .slice(0, 80)
  if (!normalized) return
  const index = selectedOccupations.value.indexOf(normalized)
  if (index >= 0) {
    selectedOccupations.value.splice(index, 1)
    syncOccupationValue()
    return
  }
  if (selectedOccupations.value.length >= MAX_OCCUPATIONS) {
    notificationService.info(copy.value.occupationLimitReached)
    return
  }
  selectedOccupations.value.push(normalized)
  syncOccupationValue()
}

function selectOccupationCategory(category) {
  occupationSearch.value = ''
  occupationCategory.value = category
}

function useCustomOccupation() {
  const normalized = customOccupation.value.trim().slice(0, 50)
  if (normalized.length < 2) {
    notificationService.info(isEnglish.value ? 'Enter your occupation' : '请输入职业名称')
    return
  }
  if (selectedOccupations.value.includes(normalized)) {
    customOccupation.value = ''
    return
  }
  if (selectedOccupations.value.length >= MAX_OCCUPATIONS) {
    notificationService.info(copy.value.occupationLimitReached)
    return
  }
  selectedOccupations.value.push(normalized)
  customOccupation.value = ''
  syncOccupationValue()
}

function finishOccupationPicker() {
  if (!selectedOccupations.value.length) {
    notificationService.info(
      isEnglish.value ? 'Choose at least one occupation' : '请至少选择一个职业',
    )
    return
  }
  closeOccupationPicker()
}

function stopNumberAnimation() {
  if (!numberAnimationFrame) return
  window.cancelAnimationFrame(numberAnimationFrame)
  numberAnimationFrame = 0
}

function animateNumbers() {
  stopNumberAnimation()
  const targetReward = Math.round(rewardCents.value)
  const targetBalance = Math.round(Math.max(0, Number(availableCents.value || 0)))
  if (!['approved', 'redeemed'].includes(screen.value)) {
    animatedReward.value = targetReward
    animatedBalance.value = targetBalance
    return
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animatedReward.value = targetReward
    animatedBalance.value = targetBalance
    return
  }

  const startedAt = performance.now()
  const duration = 650
  animatedReward.value = 0
  animatedBalance.value = 0
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    animatedReward.value = Math.round(targetReward * eased)
    animatedBalance.value = Math.round(targetBalance * eased)
    if (progress < 1) numberAnimationFrame = window.requestAnimationFrame(step)
    else numberAnimationFrame = 0
  }
  numberAnimationFrame = window.requestAnimationFrame(step)
}

function formatDate(value) {
  if (!value) return copy.value.noExpiry
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return copy.value.noExpiry
  return date.toLocaleDateString(localeStore.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(localeStore.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function close() {
  if (submitting.value || redeeming.value) return
  occupationPickerOpen.value = false
  emit('close')
}

function returnTarget() {
  const query = { ...route.query, trial: 'apply' }
  return router.resolve({ path: route.path || '/', query, hash: route.hash }).fullPath
}

function continueToAuth(mode) {
  emit('close')
  router
    .push({
      name: 'auth',
      query: { mode, ...createLoginRedirectQuery(returnTarget()) },
    })
    .catch(() => {})
}

function notifyStateChanged(previous, next) {
  if (!previous || previous === next) return
  void Promise.all([refreshUnreadCount({ force: true }), refreshPreview({ force: true })])
}

async function loadCampaign({ background = false } = {}) {
  if (campaignRequest) return campaignRequest
  if (!background) campaignLoading.value = true
  campaignError.value = ''
  const request = getTrialAccessCampaign()
    .then((item) => {
      campaign.value = item
      scheduleCampaignExpiryRefresh(item)
      return item
    })
    .catch((error) => {
      campaignError.value = error?.message || '体验活动读取失败'
      return null
    })
    .finally(() => {
      if (!background) campaignLoading.value = false
      if (campaignRequest === request) campaignRequest = null
    })
  campaignRequest = request
  return request
}

function clearCampaignExpiryTimer() {
  if (!campaignExpiryTimer) return
  window.clearTimeout(campaignExpiryTimer)
  campaignExpiryTimer = null
}

function scheduleCampaignExpiryRefresh(item) {
  clearCampaignExpiryTimer()
  if (!props.open || !item?.expiresAt) return
  const delay = new Date(item.expiresAt).getTime() - Date.now()
  if (!Number.isFinite(delay) || delay <= 0) return
  campaignExpiryTimer = window.setTimeout(() => {
    campaignExpiryTimer = null
    void refreshStatus({ background: true })
  }, Math.min(delay + 250, 2_000_000_000))
}

async function loadApplication({ background = false } = {}) {
  if (!authStore.isAuthenticated) {
    application.value = null
    return null
  }
  if (applicationRequest) return applicationRequest
  if (!background) loading.value = true
  loadError.value = ''
  const previousStatus = `${status.value}:${rewardStatus.value}`
  const request = getTrialAccessApplication()
    .then((item) => {
      application.value = item
      if (item?.status === 'rejected') {
        setOccupationSelections(item.occupation || '')
        reason.value = item.reason || ''
      }
      notifyStateChanged(previousStatus, `${item?.status || ''}:${item?.rewardStatus || ''}`)
      return item
    })
    .catch((error) => {
      if (!background) loadError.value = error?.message || '体验资格申请读取失败'
      return null
    })
    .finally(() => {
      if (!background) loading.value = false
      if (applicationRequest === request) applicationRequest = null
    })
  applicationRequest = request
  return request
}

async function submitApplication() {
  const normalizedOccupation = occupation.value.trim()
  const normalizedReason = reason.value.trim()
  if (normalizedOccupation.length < 2) {
    notificationService.info(isEnglish.value ? 'Choose your occupation' : '请选择职业')
    openOccupationPicker()
    return
  }
  if (normalizedReason.length < 10) {
    notificationService.info(
      isEnglish.value ? 'Please provide at least 10 characters' : '申请理由至少填写 10 个字符',
    )
    return
  }
  submitting.value = true
  try {
    const result = await submitTrialAccessApplication({
      occupation: normalizedOccupation,
      reason: normalizedReason,
    })
    application.value = result?.application || null
    await loadCampaign({ background: true })
    emit('submitted', application.value)
  } catch (error) {
    if (['trial_application_pending', 'trial_application_approved'].includes(error?.code)) {
      await loadApplication()
    } else if (error?.code === 'code_expired') {
      await loadApplication()
    } else if (['trial_campaign_closed', 'trial_campaign_full'].includes(error?.code)) {
      await loadCampaign()
      notificationService.info(error?.message || copy.value.closedBody)
    } else {
      notificationService.error(error?.message || '申请提交失败')
    }
  } finally {
    submitting.value = false
  }
}

async function refreshStatus({ background = false } = {}) {
  await Promise.all([loadCampaign({ background }), loadApplication({ background })])
}

async function claimReward() {
  if (rewardClaimed.value || redeeming.value) return
  redeeming.value = true
  try {
    const result = await claimTrialAccessReward()
    if (result?.balanceCents != null || result?.frozenCents != null) {
      applyWalletSnapshot({
        balanceCents: result?.balanceCents,
        frozenCents: result?.frozenCents,
        normalBalanceCents: result?.normalBalanceCents,
        trialBalanceCents: result?.trialBalanceCents,
        normalFrozenCents: result?.normalFrozenCents,
        trialFrozenCents: result?.trialFrozenCents,
      })
    }
    application.value = {
      ...application.value,
      rewardStatus: 'redeemed',
      rewardClaimedAt: new Date().toISOString(),
    }
    await Promise.all([
      refreshWalletBalance({ force: true }).catch(() => null),
      refreshUnreadCount({ force: true }).catch(() => null),
      refreshPreview({ force: true }).catch(() => null),
      loadApplication({ background: true }),
    ])
    emit('redeemed', result)
  } catch (error) {
    if (['trial_reward_already_claimed', 'code_redeemed'].includes(error?.code)) {
      await loadApplication()
    } else if (error?.code === 'trial_campaign_closed') {
      await refreshStatus()
      notificationService.info(error?.message || copy.value.closedBody)
    } else {
      notificationService.error(
        error?.message || (isEnglish.value ? 'Redemption failed' : '体验积分领取失败'),
      )
    }
  } finally {
    redeeming.value = false
  }
}

function goCreate(feature = activeFeature.value) {
  emit('close')
  router.push(feature?.route || featureRoute.value).catch(() => {})
}

function goWallet() {
  emit('close')
  router.push('/wallet').catch(() => {})
}

function stopPendingPolling() {
  if (!pendingPollTimer) return
  window.clearInterval(pendingPollTimer)
  pendingPollTimer = null
}

function syncPendingPolling() {
  stopPendingPolling()
  if (!props.open || !authStore.isAuthenticated || status.value !== 'pending') return
  pendingPollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshStatus({ background: true })
  }, PENDING_POLL_MS)
}

watch(
  () => props.open,
  async (open) => {
    setBodyScrollLock(TRIAL_DIALOG_SCROLL_LOCK, open, { freezeViewport: true })
    if (!open) {
      stopPendingPolling()
      clearCampaignExpiryTimer()
      stopNumberAnimation()
      occupationPickerOpen.value = false
      return
    }
    occupation.value = ''
    selectedOccupations.value = []
    reason.value = ''
    await Promise.all([loadCampaign(), loadApplication()])
    await nextTick()
    dialog.value?.focus()
    animateNumbers()
    if (authStore.isAuthenticated && !application.value && !campaignUnavailable.value) {
      occupationInput.value?.focus()
    }
  },
  { immediate: true },
)

watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (props.open && authenticated) void loadApplication()
  },
)

watch([() => props.open, status, () => authStore.isAuthenticated], syncPendingPolling)

watch(screen, async () => {
  if (!props.open) return
  await nextTick()
  animateNumbers()
})

onBeforeUnmount(() => {
  stopPendingPolling()
  clearCampaignExpiryTimer()
  stopNumberAnimation()
  occupationPickerOpen.value = false
  setBodyScrollLock(TRIAL_DIALOG_SCROLL_LOCK, false)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="trial-dialog">
      <div
        v-if="open"
        class="trial-dialog-layer"
        :class="{ 'is-dark': appearanceStore.isDark }"
        role="presentation"
        @mousedown.self="close"
      >
        <section
          ref="dialog"
          class="trial-dialog"
          data-no-translate
          role="dialog"
          aria-modal="true"
          aria-labelledby="trial-dialog-title"
          tabindex="-1"
          @keydown.esc.stop="close"
        >
          <button
            type="button"
            class="trial-dialog__close"
            :aria-label="copy.close"
            :title="copy.close"
            @click="close"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>

          <aside class="trial-dialog__story">
            <div class="trial-dialog__mark" aria-hidden="true"><i class="bi bi-stars"></i></div>
            <p class="trial-dialog__eyebrow">{{ copy.eyebrow }}</p>
            <h2 id="trial-dialog-title">{{ campaignTitle }}</h2>
            <p class="trial-dialog__intro">{{ copy.intro }}</p>
            <section v-if="campaign" class="trial-dialog__campaign" aria-label="体验活动名额">
              <header>
                <span>{{ copy.trialFeatures }} · {{ activeFeatures.length }}</span>
                <strong>{{ Math.round(campaignProgress) }}%</strong>
              </header>
              <div v-if="activeFeatures.length" class="trial-dialog__campaign-features">
                <span v-for="feature in activeFeatures" :key="feature.key">
                  <i :class="['bi', feature.icon || 'bi-stars']" aria-hidden="true"></i>
                  {{ feature.label }}
                </span>
              </div>
              <p v-if="campaign.expiresAt" class="trial-dialog__campaign-deadline">
                <i class="bi bi-calendar-event" aria-hidden="true"></i>
                {{ copy.campaignDeadline }} {{ formatDateTime(campaign.expiresAt) }} ·
                {{ campaignRemainingText }}
              </p>
              <div class="trial-dialog__campaign-track" aria-hidden="true">
                <i :style="{ width: `${campaignProgress}%` }"></i>
              </div>
              <dl>
                <div>
                  <dt>{{ copy.applied }}</dt>
                  <dd>{{ campaign.displayApplied }} / {{ campaign.capacity }}</dd>
                </div>
                <div>
                  <dt>{{ copy.remaining }}</dt>
                  <dd>{{ campaign.remaining }}</dd>
                </div>
                <div v-if="applicantPosition">
                  <dt>{{ application ? copy.yourPosition : copy.nextPosition }}</dt>
                  <dd>#{{ applicantPosition }}</dd>
                </div>
              </dl>
            </section>
            <ol class="trial-dialog__steps">
              <li><span>01</span>{{ copy.stepOne }}</li>
              <li><span>02</span>{{ copy.stepTwo }}</li>
              <li><span>03</span>{{ copy.stepThree }}</li>
            </ol>
          </aside>

          <main class="trial-dialog__content" aria-live="polite">
            <div v-if="screen === 'auth'" class="trial-dialog__auth">
              <span class="trial-dialog__state-icon"><i class="bi bi-person-plus"></i></span>
              <h3>{{ copy.registerTitle }}</h3>
              <p>{{ copy.registerBody }}</p>
              <div class="trial-dialog__actions">
                <button type="button" class="is-primary" @click="continueToAuth('register')">
                  {{ copy.register }}
                  <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
                </button>
                <button type="button" class="is-secondary" @click="continueToAuth('login')">
                  {{ copy.login }}
                </button>
              </div>
            </div>

            <div v-else-if="screen === 'loading'" class="trial-dialog__loading" aria-label="加载中">
              <span></span><span></span><span></span>
            </div>

            <div v-else-if="screen === 'error'" class="trial-dialog__message is-error">
              <span class="trial-dialog__state-icon"><i class="bi bi-cloud-slash"></i></span>
              <p>{{ loadError }}</p>
              <button type="button" class="is-secondary" @click="refreshStatus()">
                {{ copy.retry }}
              </button>
            </div>

            <div v-else-if="screen === 'unavailable'" class="trial-dialog__message is-closed">
              <span class="trial-dialog__state-icon"><i class="bi bi-calendar2-x"></i></span>
              <h3>{{ copy.closedTitle }}</h3>
              <p>{{ campaignError || copy.closedBody }}</p>
              <div class="trial-dialog__actions">
                <button type="button" class="is-primary" @click="close">
                  {{ copy.pendingClose }}
                </button>
                <button
                  type="button"
                  class="is-secondary"
                  :disabled="campaignLoading"
                  @click="loadCampaign()"
                >
                  <i class="bi bi-arrow-repeat" aria-hidden="true"></i>{{ copy.refresh }}
                </button>
              </div>
            </div>

            <div v-else-if="screen === 'pending'" class="trial-dialog__message is-pending">
              <span class="trial-dialog__state-icon"><i class="bi bi-hourglass-split"></i></span>
              <span class="trial-dialog__status-dot" aria-hidden="true"></span>
              <h3>{{ copy.pendingTitle }}</h3>
              <p>{{ copy.pendingBody }}</p>
              <dl class="trial-dialog__summary">
                <div v-if="activeFeatures.length">
                  <dt>{{ isEnglish ? 'Trial feature' : '体验功能' }}</dt>
                  <dd class="trial-dialog__feature-list">
                    <span v-for="feature in activeFeatures" :key="feature.key">{{ feature.label }}</span>
                  </dd>
                </div>
                <div v-if="application.position">
                  <dt>{{ copy.yourPosition }}</dt>
                  <dd>#{{ application.position }}</dd>
                </div>
                <div>
                  <dt>{{ copy.occupation }}</dt>
                  <dd>{{ application.occupation }}</dd>
                </div>
                <div>
                  <dt>{{ copy.reason }}</dt>
                  <dd>{{ application.reason }}</dd>
                </div>
              </dl>
              <div class="trial-dialog__actions">
                <button type="button" class="is-primary" @click="close">
                  {{ copy.pendingClose }}
                </button>
                <button
                  type="button"
                  class="is-secondary"
                  :disabled="loading"
                  @click="refreshStatus()"
                >
                  <i class="bi bi-arrow-repeat" aria-hidden="true"></i>{{ copy.refresh }}
                </button>
              </div>
            </div>

            <div v-else-if="screen === 'approved'" class="trial-dialog__message is-approved">
              <span class="trial-dialog__state-icon"><i class="bi bi-patch-check-fill"></i></span>
              <h3>{{ copy.approvedTitle }}</h3>
              <p>{{ copy.approvedBody }}</p>
              <div class="trial-dialog__reward-card">
                <span>{{ copy.rewardReady }}</span>
                <strong>+{{ formatPoints(animatedReward, { withUnit: false }) }}</strong>
                <small>
                  {{ activeFeatures.map((feature) => feature.label).join('、') }} · {{ copy.expires }} ·
                  {{ formatDate(application.rewardExpiresAt) }}
                </small>
              </div>
              <div v-if="application.reviewNote" class="trial-dialog__review-note">
                <strong>{{ copy.approvedNote }}</strong>
                <p>{{ application.reviewNote }}</p>
              </div>
              <button
                type="button"
                class="is-primary trial-dialog__claim"
                :disabled="redeeming"
                @click="claimReward"
              >
                {{ redeeming ? copy.claiming : copy.claim }}
                <i v-if="!redeeming" class="bi bi-arrow-right" aria-hidden="true"></i>
              </button>
            </div>

            <div v-else-if="screen === 'expired'" class="trial-dialog__message is-closed">
              <span class="trial-dialog__state-icon"><i class="bi bi-clock-history"></i></span>
              <h3>{{ copy.expiredTitle }}</h3>
              <p>{{ copy.expiredBody }}</p>
              <div class="trial-dialog__reward-card">
                <span>{{ copy.rewardReady }}</span>
                <strong>+{{ formatPoints(animatedReward, { withUnit: false }) }}</strong>
                <small>{{ copy.expires }} · {{ formatDate(application.rewardExpiresAt) }}</small>
              </div>
              <button type="button" class="is-secondary" @click="close">
                {{ copy.pendingClose }}
              </button>
            </div>

            <div v-else-if="screen === 'redeemed'" class="trial-dialog__message is-redeemed">
              <span class="trial-dialog__state-icon"><i class="bi bi-check-lg"></i></span>
              <h3>{{ copy.redeemedTitle }}</h3>
              <p>{{ copy.redeemedBody }}</p>
              <div class="trial-dialog__receipt">
                <div>
                  <span>{{ copy.received }}</span>
                  <strong>+{{ formatPoints(animatedReward, { withUnit: false }) }}</strong>
                </div>
                <div>
                  <span>{{ copy.walletBalance }}</span>
                  <strong>{{ formatPoints(animatedBalance, { withUnit: false }) }}</strong>
                </div>
              </div>
              <div v-if="activeFeatures.length" class="trial-dialog__feature-launchers">
                <button
                  v-for="feature in activeFeatures"
                  :key="feature.key"
                  type="button"
                  @click="goCreate(feature)"
                >
                  <i :class="['bi', feature.icon || 'bi-stars']" aria-hidden="true"></i>
                  <span>{{ feature.label }}</span>
                  <i class="bi bi-arrow-up-right" aria-hidden="true"></i>
                </button>
              </div>
              <div class="trial-dialog__actions">
                <button type="button" class="is-secondary" @click="goWallet">
                  <i class="bi bi-wallet2" aria-hidden="true"></i>{{ copy.wallet }}
                </button>
              </div>
            </div>

            <form v-else class="trial-dialog__form" @submit.prevent="submitApplication">
              <div v-if="status === 'rejected'" class="trial-dialog__rejected">
                <strong>{{ copy.rejected }}</strong>
                <p v-if="application?.reviewNote">{{ application.reviewNote }}</p>
                <small>{{ copy.reapply }}</small>
              </div>
              <header>
                <span class="trial-dialog__state-icon"><i class="bi bi-send-check"></i></span>
                <h3>{{ copy.formTitle }}</h3>
                <p>{{ copy.formBody }}</p>
                <small v-if="campaign && applicantPosition" class="trial-dialog__position">
                  {{ copy.nextPosition }} #{{ applicantPosition }} · {{ copy.remaining }}
                  {{ campaign.remaining }}
                </small>
              </header>
              <div class="trial-dialog__field">
                <span class="trial-dialog__field-label">{{ copy.occupation }}</span>
                <button
                  id="trial-occupation-trigger"
                  ref="occupationInput"
                  type="button"
                  class="trial-dialog__occupation-trigger"
                  :class="{ 'has-value': occupation }"
                  aria-haspopup="dialog"
                  aria-controls="trial-occupation-picker"
                  :aria-expanded="occupationPickerOpen"
                  @click="openOccupationPicker"
                >
                  <span>{{ occupation || copy.occupationPlaceholder }}</span>
                  <small v-if="selectedOccupations.length">
                    {{ selectedOccupations.length }}/{{ MAX_OCCUPATIONS }}
                  </small>
                  <i class="bi bi-chevron-down" aria-hidden="true"></i>
                </button>
              </div>
              <label>
                <span>{{ copy.reason }}</span>
                <textarea
                  v-model="reason"
                  rows="5"
                  minlength="10"
                  maxlength="1000"
                  :placeholder="copy.reasonPlaceholder"
                  required
                ></textarea>
                <small>{{ reason.trim().length }} / 1000</small>
              </label>
              <button type="submit" class="is-primary trial-dialog__submit" :disabled="submitting">
                {{ submitting ? copy.submitting : copy.submit }}
                <i class="bi bi-arrow-right" aria-hidden="true"></i>
              </button>
            </form>
          </main>
        </section>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="occupation-picker">
      <div
        v-if="open && occupationPickerOpen && screen === 'apply'"
        class="occupation-picker-layer"
        :class="{ 'is-dark': appearanceStore.isDark }"
        role="presentation"
        @mousedown.self="closeOccupationPicker()"
        @keydown.esc.stop="closeOccupationPicker()"
      >
        <section
          id="trial-occupation-picker"
          class="occupation-picker"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trial-occupation-picker-title"
        >
          <header class="occupation-picker__header">
            <div>
              <p>{{ copy.occupationPickerEyebrow }} · {{ occupationTotal }}</p>
              <h3 id="trial-occupation-picker-title">{{ copy.occupationPickerTitle }}</h3>
            </div>
            <button
              type="button"
              class="occupation-picker__close"
              :aria-label="copy.occupationClose"
              :title="copy.occupationClose"
              @click="closeOccupationPicker()"
            >
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
            <label class="occupation-picker__search">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input
                ref="occupationSearchInput"
                v-model="occupationSearch"
                type="search"
                autocomplete="off"
                :placeholder="copy.occupationSearch"
              />
              <button
                v-if="occupationSearch"
                type="button"
                :aria-label="isEnglish ? 'Clear search' : '清空搜索'"
                :title="isEnglish ? 'Clear search' : '清空搜索'"
                @click="occupationSearch = ''"
              >
                <i class="bi bi-x-circle-fill" aria-hidden="true"></i>
              </button>
            </label>
            <div class="occupation-picker__selection">
              <span>{{ copy.occupationLimit }}</span>
              <div v-if="selectedOccupations.length">
                <button
                  v-for="item in selectedOccupations"
                  :key="item"
                  type="button"
                  :title="isEnglish ? 'Remove occupation' : '移除职业'"
                  @click="selectOccupation(item)"
                >
                  {{ item }}
                  <i class="bi bi-x" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </header>

          <div class="occupation-picker__body">
            <nav class="occupation-picker__categories" :aria-label="copy.occupationPickerEyebrow">
              <button
                type="button"
                :class="{ active: occupationCategory === 'all' && !occupationSearch }"
                @click="selectOccupationCategory('all')"
              >
                <i class="bi bi-grid" aria-hidden="true"></i>
                <span>{{ copy.occupationAll }}</span>
                <small>{{ occupationTotal }}</small>
              </button>
              <button
                v-for="group in localizedOccupationGroups"
                :key="group.id"
                type="button"
                :class="{ active: occupationCategory === group.id && !occupationSearch }"
                @click="selectOccupationCategory(group.id)"
              >
                <i class="bi" :class="group.icon" aria-hidden="true"></i>
                <span>{{ group.label }}</span>
                <small>{{ group.occupations.length }}</small>
              </button>
            </nav>

            <div class="occupation-picker__results">
              <div class="occupation-picker__result-meta">
                <span>{{ visibleOccupationCount }} {{ copy.occupationCount }}</span>
                <strong>
                  {{ copy.occupationSelected }} {{ selectedOccupations.length }}/{{
                    MAX_OCCUPATIONS
                  }}
                </strong>
              </div>
              <div v-if="visibleOccupationGroups.length" class="occupation-picker__groups">
                <section v-for="group in visibleOccupationGroups" :key="group.id">
                  <h4>
                    <i class="bi" :class="group.icon" aria-hidden="true"></i>{{ group.label }}
                  </h4>
                  <div class="occupation-picker__options">
                    <button
                      v-for="item in group.occupations"
                      :key="`${group.id}-${item.zh}`"
                      type="button"
                      :class="{ selected: selectedOccupations.includes(item.label) }"
                      :disabled="
                        selectedOccupations.length >= MAX_OCCUPATIONS &&
                        !selectedOccupations.includes(item.label)
                      "
                      @click="selectOccupation(item.label)"
                    >
                      <span>{{ item.label }}</span>
                      <i
                        v-if="selectedOccupations.includes(item.label)"
                        class="bi bi-check-lg"
                        aria-hidden="true"
                      ></i>
                    </button>
                  </div>
                </section>
              </div>
              <div v-else class="occupation-picker__empty">
                <i class="bi bi-search" aria-hidden="true"></i>
                <span>{{ copy.occupationEmpty }}</span>
              </div>
            </div>
          </div>

          <footer class="occupation-picker__custom">
            <label for="trial-custom-occupation">{{ copy.occupationCustom }}</label>
            <div>
              <input
                id="trial-custom-occupation"
                v-model="customOccupation"
                type="text"
                maxlength="50"
                autocomplete="organization-title"
                :placeholder="copy.occupationCustomPlaceholder"
                :disabled="selectedOccupations.length >= MAX_OCCUPATIONS"
                @keydown.enter.prevent="useCustomOccupation"
              />
              <button
                type="button"
                :disabled="
                  customOccupation.trim().length < 2 ||
                  selectedOccupations.length >= MAX_OCCUPATIONS
                "
                @click="useCustomOccupation"
              >
                {{ copy.occupationUseCustom }}
                <i class="bi bi-arrow-right" aria-hidden="true"></i>
              </button>
            </div>
            <button
              type="button"
              class="occupation-picker__done"
              :disabled="selectedOccupations.length === 0"
              @click="finishOccupationPicker"
            >
              {{ copy.occupationDone }}
              <span>{{ selectedOccupations.length }}/{{ MAX_OCCUPATIONS }}</span>
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.trial-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 11900;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(12 12 18 / 70%);
  -webkit-backdrop-filter: blur(18px) saturate(0.9);
  backdrop-filter: blur(18px) saturate(0.9);
}

.trial-dialog {
  position: relative;
  display: grid;
  grid-template-columns: minmax(310px, 0.82fr) minmax(420px, 1.18fr);
  width: min(1040px, 100%);
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  color: #20202a;
  background: #fff;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 28px;
  box-shadow: 0 32px 90px rgb(0 0 0 / 38%);
  outline: none;
}

.trial-dialog__close {
  position: absolute;
  z-index: 4;
  top: 18px;
  right: 18px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  color: #555461;
  background: rgb(255 255 255 / 92%);
  border: 1px solid rgb(26 25 36 / 10%);
  border-radius: 50%;
  cursor: pointer;
}

.trial-dialog__story {
  min-height: 650px;
  padding: 58px 46px;
  color: #fff;
  background: linear-gradient(148deg, #211832, #0d0e14 74%);
}

.trial-dialog__mark {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 48px;
  color: #171326;
  background: linear-gradient(135deg, #f9a8d4, #c4b5fd);
  border-radius: 17px;
  font-size: 1.45rem;
}

.trial-dialog__eyebrow {
  margin: 0;
  color: #c4b5fd;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.trial-dialog__story h2 {
  max-width: 360px;
  margin: 16px 0 0;
  font-size: 3.2rem;
  font-weight: 850;
  line-height: 1.04;
  letter-spacing: 0;
}

.trial-dialog__intro {
  max-width: 390px;
  margin: 28px 0 0;
  color: rgb(255 255 255 / 64%);
  font-size: 0.94rem;
  line-height: 1.75;
}

.trial-dialog__campaign {
  display: grid;
  gap: 11px;
  margin-top: 28px;
  padding: 14px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 5%);
}

.trial-dialog__campaign header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgb(255 255 255 / 72%);
  font-size: 0.72rem;
}

.trial-dialog__campaign header strong {
  color: #c4b5fd;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__campaign-features {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trial-dialog__campaign-features span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid rgb(196 181 253 / 18%);
  border-radius: 6px;
  background: rgb(196 181 253 / 9%);
  color: rgb(255 255 255 / 82%);
  font-size: 0.66rem;
  font-weight: 680;
  line-height: 1.2;
}

.trial-dialog__campaign-features i {
  flex: 0 0 auto;
  color: #c4b5fd;
  font-size: 0.72rem;
}

.trial-dialog__campaign-track {
  height: 5px;
  overflow: hidden;
  border-radius: 3px;
  background: rgb(255 255 255 / 11%);
}

.trial-dialog__campaign-deadline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: rgb(255 255 255 / 68%);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__campaign-track i {
  display: block;
  height: 100%;
  background: #c4b5fd;
  transition: width 240ms ease;
}

.trial-dialog__campaign dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.trial-dialog__campaign dt {
  color: rgb(255 255 255 / 46%);
  font-size: 0.62rem;
}

.trial-dialog__campaign dd {
  margin: 3px 0 0;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__steps {
  display: grid;
  gap: 16px;
  margin: 52px 0 0;
  padding: 0;
  list-style: none;
}

.trial-dialog__steps li {
  display: flex;
  align-items: center;
  gap: 14px;
  color: rgb(255 255 255 / 72%);
  font-size: 0.82rem;
}

.trial-dialog__steps span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: #c4b5fd;
  border: 1px solid rgb(196 181 253 / 28%);
  border-radius: 50%;
  font-size: 0.62rem;
  font-weight: 800;
}

.trial-dialog__content {
  display: flex;
  min-height: 650px;
  overflow-y: auto;
  padding: 66px clamp(36px, 5vw, 72px);
  background: #fff;
}

.is-dark .trial-dialog {
  color: #f6f4ff;
  background: #17171f;
}

.is-dark .trial-dialog__content {
  background: #17171f;
}

.trial-dialog__content > * {
  width: 100%;
  margin: auto 0;
}

.trial-dialog__state-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  color: #6d5cff;
  background: rgb(109 92 255 / 10%);
  border-radius: 15px;
  font-size: 1.22rem;
}

.is-redeemed .trial-dialog__state-icon {
  color: #15806b;
  background: rgb(21 128 107 / 10%);
}

.trial-dialog__auth h3,
.trial-dialog__message h3,
.trial-dialog__form h3 {
  margin: 22px 0 0;
  font-size: 2rem;
  line-height: 1.15;
  letter-spacing: 0;
}

.trial-dialog__auth > p,
.trial-dialog__message > p,
.trial-dialog__form header > p {
  max-width: 520px;
  margin: 15px 0 0;
  color: rgb(32 32 42 / 58%);
  line-height: 1.75;
}

.is-dark .trial-dialog__auth > p,
.is-dark .trial-dialog__message > p,
.is-dark .trial-dialog__form header > p {
  color: rgb(255 255 255 / 56%);
}

.trial-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}

.trial-dialog button.is-primary,
.trial-dialog button.is-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 46px;
  padding: 0 20px;
  border-radius: 12px;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 780;
  cursor: pointer;
}

.trial-dialog button.is-primary {
  color: #fff;
  background: linear-gradient(110deg, #6654f6, #8b5cf6 62%, #b45cf0);
  border: 1px solid transparent;
  box-shadow: 0 12px 26px rgb(109 92 255 / 20%);
}

.trial-dialog button.is-secondary {
  color: inherit;
  background: transparent;
  border: 1px solid rgb(32 32 42 / 14%);
}

.is-dark .trial-dialog button.is-secondary {
  border-color: rgb(255 255 255 / 15%);
}

.trial-dialog button:disabled {
  opacity: 0.55;
  cursor: wait;
}

.trial-dialog__loading {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.trial-dialog__loading span {
  width: 9px;
  height: 9px;
  background: #7c66ff;
  border-radius: 50%;
}

.trial-dialog__message {
  position: relative;
}

.trial-dialog__status-dot {
  position: absolute;
  top: 0;
  left: 36px;
  width: 12px;
  height: 12px;
  background: #f59e0b;
  border: 3px solid #fff;
  border-radius: 50%;
}

.is-dark .trial-dialog__status-dot {
  border-color: #17171f;
}

.trial-dialog__summary {
  display: grid;
  gap: 10px;
  margin: 28px 0 0;
}

.trial-dialog__summary div {
  padding: 13px 15px;
  background: rgb(109 92 255 / 6%);
  border: 1px solid rgb(109 92 255 / 9%);
  border-radius: 13px;
}

.trial-dialog__summary dt {
  color: rgb(32 32 42 / 48%);
  font-size: 0.7rem;
  font-weight: 700;
}

.trial-dialog__summary dd {
  margin: 5px 0 0;
  font-size: 0.86rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.is-dark .trial-dialog__summary dt {
  color: rgb(255 255 255 / 45%);
}

.trial-dialog__reward-card {
  display: grid;
  gap: 7px;
  margin-top: 28px;
  padding: 22px;
  color: #fff;
  background: linear-gradient(135deg, #5b4ce0, #7c3aed);
  border-radius: 18px;
  box-shadow: 0 18px 38px rgb(91 76 224 / 20%);
}

.trial-dialog__reward-card span {
  font-size: 0.76rem;
  font-weight: 750;
  opacity: 0.8;
}

.trial-dialog__reward-card strong {
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__reward-card small {
  opacity: 0.68;
}

.trial-dialog__review-note {
  margin-top: 12px;
  padding: 12px 14px;
  background: rgb(109 92 255 / 5%);
  border: 1px solid rgb(109 92 255 / 10%);
  border-radius: 12px;
}

.trial-dialog__review-note strong {
  font-size: 0.72rem;
  color: #6654f6;
}

.trial-dialog__review-note p {
  margin: 4px 0 0;
  font-size: 0.8rem;
  line-height: 1.55;
}

.trial-dialog__claim {
  width: 100%;
  margin-top: 20px;
}

.trial-dialog__receipt {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin-top: 26px;
  overflow: hidden;
  background: rgb(21 128 107 / 14%);
  border: 1px solid rgb(21 128 107 / 14%);
  border-radius: 12px;
}

.trial-dialog__receipt > div {
  display: grid;
  gap: 5px;
  padding: 16px 18px;
  background: rgb(21 128 107 / 6%);
}

.trial-dialog__receipt span {
  color: rgb(32 32 42 / 52%);
  font-size: 0.7rem;
}

.trial-dialog__receipt strong {
  color: #14705e;
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__feature-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.trial-dialog__feature-list span {
  padding: 3px 7px;
  border-radius: 6px;
  background: rgb(20 112 94 / 9%);
  color: #14705e;
  font-size: 11px;
  font-weight: 650;
}

.trial-dialog__feature-launchers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  margin-top: 12px;
}

.trial-dialog__feature-launchers button {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid rgb(20 112 94 / 18%);
  border-radius: 7px;
  background: rgb(20 112 94 / 7%);
  color: #14705e;
  font: inherit;
  font-size: 12px;
  font-weight: 680;
  text-align: left;
  cursor: pointer;
}

.trial-dialog__feature-launchers button:hover {
  border-color: rgb(20 112 94 / 36%);
  background: rgb(20 112 94 / 12%);
}

.is-dark .trial-dialog__receipt span {
  color: rgb(255 255 255 / 52%);
}

.trial-dialog__form {
  display: grid;
  gap: 18px;
}

.trial-dialog__form header {
  margin-bottom: 2px;
}

.trial-dialog__position {
  display: inline-flex;
  width: max-content;
  margin-top: 10px;
  padding: 5px 8px;
  color: #5b4ce0;
  background: rgb(109 92 255 / 8%);
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
}

.trial-dialog__form label,
.trial-dialog__field {
  display: grid;
  gap: 8px;
}

.trial-dialog__form label > span,
.trial-dialog__field-label {
  font-size: 0.78rem;
  font-weight: 760;
}

.trial-dialog__occupation-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 46px;
  padding: 0 14px;
  color: rgb(32 32 42 / 44%);
  background: #f7f7fa;
  border: 1px solid rgb(32 32 42 / 10%);
  border-radius: 13px;
  outline: none;
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}

.trial-dialog__occupation-trigger.has-value {
  color: inherit;
}

.trial-dialog__occupation-trigger span {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trial-dialog__occupation-trigger small {
  flex: 0 0 auto;
  padding: 3px 7px;
  color: #5b4ce0;
  background: rgb(109 92 255 / 9%);
  border-radius: 6px;
  font-size: 0.65rem;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
}

.is-dark .trial-dialog__occupation-trigger small {
  color: #ddd6fe;
  background: rgb(196 181 253 / 10%);
}

.trial-dialog__occupation-trigger i {
  flex: 0 0 auto;
  color: #6d5cff;
  transition: transform 140ms ease;
}

.trial-dialog__occupation-trigger[aria-expanded='true'] i {
  transform: rotate(180deg);
}

.trial-dialog__form input,
.trial-dialog__form textarea {
  width: 100%;
  color: inherit;
  background: #f7f7fa;
  border: 1px solid rgb(32 32 42 / 10%);
  border-radius: 13px;
  outline: none;
  font: inherit;
  font-size: 0.88rem;
}

.trial-dialog__form input {
  min-height: 46px;
  padding: 0 14px;
}

.trial-dialog__form textarea {
  min-height: 130px;
  padding: 13px 14px;
  line-height: 1.65;
  resize: vertical;
}

.is-dark .trial-dialog__form input,
.is-dark .trial-dialog__form textarea,
.is-dark .trial-dialog__occupation-trigger {
  background: rgb(255 255 255 / 5%);
  border-color: rgb(255 255 255 / 10%);
}

.trial-dialog__form input:focus,
.trial-dialog__form textarea:focus,
.trial-dialog__occupation-trigger:focus-visible {
  border-color: rgb(109 92 255 / 60%);
  box-shadow: 0 0 0 3px rgb(109 92 255 / 12%);
}

.trial-dialog__form label > small {
  justify-self: end;
  margin-top: -3px;
  color: rgb(32 32 42 / 42%);
  font-size: 0.68rem;
}

.trial-dialog__submit {
  width: 100%;
  margin-top: 4px;
}

.trial-dialog__rejected {
  padding: 13px 15px;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 13px;
}

.trial-dialog__rejected p {
  margin: 5px 0;
  white-space: pre-wrap;
}

.trial-dialog__rejected small {
  opacity: 0.7;
}

.occupation-picker-layer {
  position: fixed;
  inset: 0;
  z-index: 11950;
  display: grid;
  place-items: center;
  padding: 48px;
  background: rgb(12 12 18 / 28%);
}

.occupation-picker {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(860px, calc(100vw - 96px));
  height: min(590px, calc(100vh - 96px));
  min-height: 500px;
  overflow: hidden;
  color: #20202a;
  background: #fff;
  border: 1px solid rgb(255 255 255 / 36%);
  border-radius: 18px;
  box-shadow: 0 30px 90px rgb(0 0 0 / 36%);
}

.occupation-picker-layer.is-dark .occupation-picker {
  color: #f6f4ff;
  background: #17171f;
  border-color: rgb(255 255 255 / 10%);
}

.occupation-picker__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px 24px;
  padding: 24px 26px 20px;
  border-bottom: 1px solid rgb(32 32 42 / 9%);
}

.is-dark .occupation-picker__header {
  border-bottom-color: rgb(255 255 255 / 9%);
}

.occupation-picker__header p {
  margin: 0 0 5px;
  color: #6d5cff;
  font-size: 0.66rem;
  font-weight: 820;
  letter-spacing: 0;
}

.occupation-picker__header h3 {
  margin: 0;
  font-size: 1.35rem;
  line-height: 1.2;
  letter-spacing: 0;
}

.occupation-picker__close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: rgb(32 32 42 / 60%);
  background: transparent;
  border: 1px solid rgb(32 32 42 / 12%);
  border-radius: 50%;
  cursor: pointer;
}

.is-dark .occupation-picker__close {
  color: rgb(255 255 255 / 65%);
  border-color: rgb(255 255 255 / 14%);
}

.occupation-picker__search {
  position: relative;
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
}

.occupation-picker__search > i {
  position: absolute;
  left: 15px;
  color: rgb(32 32 42 / 42%);
  pointer-events: none;
}

.occupation-picker__search input {
  width: 100%;
  height: 44px;
  padding: 0 44px;
  color: inherit;
  background: #f4f4f8;
  border: 1px solid transparent;
  border-radius: 10px;
  outline: none;
  font: inherit;
  font-size: 0.86rem;
}

.occupation-picker__search input:focus {
  border-color: rgb(109 92 255 / 52%);
  box-shadow: 0 0 0 3px rgb(109 92 255 / 10%);
}

.is-dark .occupation-picker__search input {
  background: rgb(255 255 255 / 6%);
}

.is-dark .occupation-picker__search > i {
  color: rgb(255 255 255 / 40%);
}

.occupation-picker__search button {
  position: absolute;
  right: 10px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: rgb(32 32 42 / 38%);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.is-dark .occupation-picker__search button {
  color: rgb(255 255 255 / 42%);
}

.occupation-picker__selection {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
}

.occupation-picker__selection > span {
  flex: 0 0 auto;
  color: rgb(32 32 42 / 48%);
  font-size: 0.7rem;
  font-weight: 700;
}

.is-dark .occupation-picker__selection > span {
  color: rgb(255 255 255 / 46%);
}

.occupation-picker__selection > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.occupation-picker__selection button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 4px 7px 4px 9px;
  color: #5140d3;
  background: rgb(109 92 255 / 9%);
  border: 1px solid rgb(109 92 255 / 16%);
  border-radius: 7px;
  font: inherit;
  font-size: 0.68rem;
  cursor: pointer;
}

.occupation-picker__selection button i {
  font-size: 0.82rem;
}

.is-dark .occupation-picker__selection button {
  color: #ddd6fe;
  background: rgb(196 181 253 / 10%);
  border-color: rgb(196 181 253 / 16%);
}

.occupation-picker__body {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  min-height: 0;
}

.occupation-picker__categories {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: #f7f7fa;
  border-right: 1px solid rgb(32 32 42 / 8%);
}

.is-dark .occupation-picker__categories {
  background: rgb(255 255 255 / 3%);
  border-right-color: rgb(255 255 255 / 8%);
}

.occupation-picker__categories button {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 39px;
  padding: 7px 9px;
  color: rgb(32 32 42 / 68%);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.occupation-picker__categories button + button {
  margin-top: 3px;
}

.occupation-picker__categories button:hover {
  background: rgb(109 92 255 / 7%);
}

.occupation-picker__categories button.active {
  color: #5947df;
  background: rgb(109 92 255 / 11%);
  font-weight: 760;
}

.is-dark .occupation-picker__categories button {
  color: rgb(255 255 255 / 66%);
}

.is-dark .occupation-picker__categories button.active {
  color: #c4b5fd;
  background: rgb(196 181 253 / 10%);
}

.occupation-picker__categories button > i {
  color: #6d5cff;
  font-size: 0.9rem;
}

.occupation-picker__categories button > span {
  min-width: 0;
  line-height: 1.3;
}

.occupation-picker__categories button > small {
  color: rgb(32 32 42 / 35%);
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
}

.is-dark .occupation-picker__categories button > small {
  color: rgb(255 255 255 / 34%);
}

.occupation-picker__results {
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 22px;
}

.occupation-picker__result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 28px;
  margin-bottom: 10px;
  color: rgb(32 32 42 / 42%);
  font-size: 0.68rem;
}

.occupation-picker__result-meta strong {
  max-width: 60%;
  overflow: hidden;
  color: #5b4ce0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-dark .occupation-picker__result-meta {
  color: rgb(255 255 255 / 40%);
}

.is-dark .occupation-picker__result-meta strong {
  color: #c4b5fd;
}

.occupation-picker__groups {
  display: grid;
  gap: 20px;
}

.occupation-picker__groups section h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 9px;
  color: rgb(32 32 42 / 58%);
  font-size: 0.72rem;
  letter-spacing: 0;
}

.occupation-picker__groups section h4 i {
  color: #6d5cff;
}

.is-dark .occupation-picker__groups section h4 {
  color: rgb(255 255 255 / 55%);
}

.occupation-picker__options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.occupation-picker__options button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 39px;
  padding: 7px 11px;
  color: rgb(32 32 42 / 82%);
  background: #f7f7fa;
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  font-size: 0.74rem;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
}

.occupation-picker__options button:hover {
  color: #5140d3;
  background: rgb(109 92 255 / 8%);
  border-color: rgb(109 92 255 / 13%);
}

.occupation-picker__options button.selected {
  color: #5140d3;
  background: rgb(109 92 255 / 11%);
  border-color: rgb(109 92 255 / 24%);
  font-weight: 760;
}

.is-dark .occupation-picker__options button {
  color: rgb(255 255 255 / 76%);
  background: rgb(255 255 255 / 5%);
}

.is-dark .occupation-picker__options button:hover,
.is-dark .occupation-picker__options button.selected {
  color: #ddd6fe;
  background: rgb(196 181 253 / 10%);
}

.occupation-picker__options button:disabled:not(.selected) {
  opacity: 0.38;
  cursor: not-allowed;
}

.occupation-picker__empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  min-height: 210px;
  color: rgb(32 32 42 / 42%);
  font-size: 0.8rem;
}

.occupation-picker__empty i {
  font-size: 1.3rem;
}

.is-dark .occupation-picker__empty {
  color: rgb(255 255 255 / 42%);
}

.occupation-picker__custom {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 16px 22px;
  border-top: 1px solid rgb(32 32 42 / 9%);
}

.is-dark .occupation-picker__custom {
  border-top-color: rgb(255 255 255 / 9%);
}

.occupation-picker__custom > label {
  font-size: 0.74rem;
  font-weight: 760;
}

.occupation-picker__custom > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px;
}

.occupation-picker__custom input {
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  color: inherit;
  background: #f4f4f8;
  border: 1px solid transparent;
  border-radius: 9px;
  outline: none;
  font: inherit;
  font-size: 0.78rem;
}

.occupation-picker__custom input:focus {
  border-color: rgb(109 92 255 / 52%);
  box-shadow: 0 0 0 3px rgb(109 92 255 / 10%);
}

.is-dark .occupation-picker__custom input {
  background: rgb(255 255 255 / 6%);
}

.occupation-picker__custom input:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.occupation-picker__custom button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 15px;
  color: #fff;
  background: #6654f6;
  border: 0;
  border-radius: 9px;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 760;
  cursor: pointer;
}

.occupation-picker__custom button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.occupation-picker__done {
  min-width: 118px;
  white-space: nowrap;
}

.occupation-picker__done span {
  padding-left: 7px;
  border-left: 1px solid rgb(255 255 255 / 30%);
  font-variant-numeric: tabular-nums;
}

.occupation-picker-enter-active,
.occupation-picker-leave-active {
  transition: opacity 120ms ease;
}

.occupation-picker-enter-from,
.occupation-picker-leave-to {
  opacity: 0;
}

.trial-dialog-enter-active,
.trial-dialog-leave-active {
  transition: opacity 140ms ease;
}

.trial-dialog-enter-from,
.trial-dialog-leave-to {
  opacity: 0;
}

@media (min-width: 781px) and (max-height: 760px) {
  .trial-dialog__story,
  .trial-dialog__content {
    min-height: 0;
  }

  .trial-dialog__story {
    padding: 32px 36px;
  }

  .trial-dialog__mark {
    width: 46px;
    height: 46px;
    margin-bottom: 20px;
    border-radius: 14px;
  }

  .trial-dialog__story h2 {
    margin-top: 10px;
    font-size: 2.6rem;
  }

  .trial-dialog__intro {
    margin-top: 14px;
    line-height: 1.55;
  }

  .trial-dialog__campaign {
    gap: 8px;
    margin-top: 16px;
    padding: 12px;
  }

  .trial-dialog__steps {
    gap: 8px;
    margin-top: 18px;
  }

  .trial-dialog__steps span {
    width: 28px;
    height: 28px;
  }

  .trial-dialog__content {
    padding-top: 40px;
    padding-bottom: 40px;
  }
}

@media (max-width: 780px) {
  .trial-dialog-layer {
    align-items: end;
    padding: 12px;
  }

  .trial-dialog {
    grid-template-columns: 1fr;
    max-height: calc(100dvh - 24px);
    border-radius: 20px;
  }

  .trial-dialog__story {
    min-height: 0;
    padding: 24px 24px 20px;
  }

  .trial-dialog__mark {
    width: 38px;
    height: 38px;
    margin-bottom: 14px;
    border-radius: 12px;
    font-size: 1rem;
  }

  .trial-dialog__story h2 {
    margin-top: 8px;
    font-size: 1.7rem;
  }

  .trial-dialog__intro {
    display: none;
  }

  .trial-dialog__steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-top: 18px;
  }

  .trial-dialog__steps li {
    align-items: flex-start;
    gap: 6px;
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .trial-dialog__steps span {
    flex: 0 0 26px;
    width: 26px;
    height: 26px;
  }

  .trial-dialog__content {
    min-height: 0;
    max-height: calc(100dvh - 238px);
    padding: 32px 24px 28px;
  }

  .trial-dialog__auth h3,
  .trial-dialog__message h3,
  .trial-dialog__form h3 {
    font-size: 1.6rem;
  }

  .trial-dialog__actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .trial-dialog__actions button {
    width: 100%;
  }
}

@media (max-width: 430px) {
  .trial-dialog-layer {
    padding: 0;
  }

  .trial-dialog {
    max-height: 100dvh;
    border-radius: 0;
  }

  .trial-dialog__content {
    max-height: calc(100dvh - 224px);
  }

  .trial-dialog__receipt {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trial-dialog-enter-active,
  .trial-dialog-leave-active,
  .occupation-picker-enter-active,
  .occupation-picker-leave-active {
    transition-duration: 0.001ms;
  }
}
</style>
