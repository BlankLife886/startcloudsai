<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import {
  deleteMyGallerySubmission,
  getOverview,
  getWallet,
  listMyGallerySubmissions,
  listWalletLedger,
  redeemWalletCode,
  updateProfile,
} from '@/services/meApi'
import { TASK_UPDATE_EVENT, uploadFile } from '@/services/tasksApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import { useClientWalletBalance, WALLET_UPDATED_EVENT } from '@/composables/useClientWalletBalance'
import { useClientNotifications } from '@/composables/useClientNotifications'
import DeleteHistoryConfirmDialog from '@/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue'
import { useProfileDashboardMotion } from './useProfileDashboardMotion'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { refreshWalletBalance, applyWalletSnapshot } = useClientWalletBalance()
const appearanceStore = useAppearanceStore()
const pageRootRef = ref(null)

const TAB_IDS = ['dashboard']

function legacyTabPath(value) {
  const tab = String(value || '').trim()
  if (tab === 'works') return '/history'
  if (tab === 'notifications') return '/notifications'
  if (tab === 'materials') return '/materials'
  if (tab === 'submissions') return '/submissions'
  if (tab === 'wallet') return '/wallet'
  if (tab === 'account') return '/account'
  return null
}

function resolveTab(value) {
  if (legacyTabPath(value)) return 'dashboard'
  const tab = String(value || '').trim()
  return TAB_IDS.includes(tab) ? tab : 'dashboard'
}

const activeTab = ref('dashboard')
const { playDashboardMotion } = useProfileDashboardMotion({
  rootRef: pageRootRef,
  activeTab,
})

// ---- 总览 ----
const overview = ref(null)
const { unreadCount, applyUnreadCount } = useClientNotifications()

// ---- 我的投稿 ----
const submissions = ref([])
const submissionsLoading = ref(false)
const submissionsCursor = ref(null)
const submissionsLoaded = ref(false)
const submissionsError = ref('')

// ---- 钱包 ----
const wallet = ref(null)
const walletLoading = ref(false)
const walletError = ref('')
const walletLoaded = ref(false)
const ledger = ref([])
const ledgerLoading = ref(false)
const ledgerCursor = ref(null)
const ledgerError = ref('')
const redeemCode = ref('')
const redeeming = ref(false)

const REDEEM_ERROR_MESSAGES = {
  code_invalid: '兑换码不存在，请检查后重试',
  code_redeemed: '该兑换码已被使用',
  code_expired: '兑换码已过期',
  code_disabled: '兑换码已停用',
  rate_limited: '尝试过于频繁，请稍后再试',
}

const overviewWallet = computed(() => overview.value?.wallet || null)
const balanceCents = computed(() =>
  Number(wallet.value?.balanceCents ?? overviewWallet.value?.balanceCents ?? 0),
)
const frozenCents = computed(() =>
  Number(wallet.value?.frozenCents ?? overviewWallet.value?.frozenCents ?? 0),
)
const availableCents = computed(() => Math.max(0, balanceCents.value))
const totalCents = computed(() => availableCents.value + Math.max(0, frozenCents.value))
const pointsDisplay = computed(() => formatPoints(availableCents.value, { withUnit: false }))

const taskStats = computed(() => ({
  total: Number(overview.value?.taskStats?.total || 0),
  succeeded: Number(overview.value?.taskStats?.succeeded || 0),
  failed: Number(overview.value?.taskStats?.failed || 0),
  running: Number(overview.value?.taskStats?.running || 0),
}))

const successRate = computed(() => {
  const done = taskStats.value.succeeded + taskStats.value.failed
  if (!done) return 0
  return Math.round((taskStats.value.succeeded / done) * 100)
})

const materialCount = computed(() => {
  const count = Number(overview.value?.assetCount)
  return Number.isFinite(count) ? Math.max(0, count) : 0
})

const submissionStats = computed(() => {
  const serverStats = overview.value?.submissionStats
  if (serverStats && typeof serverStats === 'object') {
    const counts = {
      pending: Number(serverStats.pending || 0),
      approved: Number(serverStats.approved || 0),
      rejected: Number(serverStats.rejected || 0),
      removed: Number(serverStats.removed || 0),
    }
    return {
      ...counts,
      total: Number(
        serverStats.total ?? Object.values(counts).reduce((sum, value) => sum + value, 0),
      ),
    }
  }
  const list = submissions.value || []
  const counts = { pending: 0, approved: 0, rejected: 0, removed: 0 }
  for (const item of list) {
    const key = String(item?.status || '')
    if (key in counts) counts[key] += 1
  }
  return { ...counts, total: list.length }
})

const taskTypeBars = computed(() => {
  const byType = overview.value?.taskStatsByType || {}
  const entries = Object.entries(byType)
    .map(([key, value]) => ({ key, value: Number(value || 0) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const max = Math.max(1, ...entries.map((item) => item.value))
  const labels = {
    t2i: '文生图',
    wallpaper: '壁纸',
    coloring: '染色',
    assistant: '助手',
    game: '游戏',
    design: '设计',
    puzzle: '拼图',
    modelsheet: '模型图',
  }
  return entries.map((item) => ({
    ...item,
    label: labels[item.key] || item.key,
    height: Math.max(12, Math.round((item.value / max) * 100)),
  }))
})

const recentTasks = computed(() =>
  Array.isArray(overview.value?.recentTasks) ? overview.value.recentTasks.slice(0, 5) : [],
)

const heroVisualUrl = '/sucai/profile-hero-character.png?v=4'

const ringAccent = computed(() => (appearanceStore.isDark ? '#7c6cff' : '#3b82f6'))
const ringCyan = computed(() => (appearanceStore.isDark ? '#5ec8ff' : '#0ea5e9'))
const ringTrack = computed(() =>
  appearanceStore.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(22,28,48,0.1)',
)

const ringStyle = computed(() => {
  const rate = successRate.value
  return {
    background: `conic-gradient(${ringAccent.value} 0 ${rate}%, ${ringTrack.value} ${rate}% 100%)`,
  }
})

const approvalRingStyle = computed(() => {
  const total = Math.max(1, submissionStats.value.total)
  const approved = submissionStats.value.approved
  const pending = submissionStats.value.pending
  const approvedPct = (approved / total) * 100
  const pendingPct = approvedPct + (pending / total) * 100
  return {
    background: `conic-gradient(${ringAccent.value} 0 ${approvedPct}%, ${ringCyan.value} ${approvedPct}% ${pendingPct}%, ${ringTrack.value} ${pendingPct}% 100%)`,
  }
})

// ---- 账号设置 ----
const profileForm = reactive({
  username: '',
  bio: '',
  location: '',
  websiteUrl: '',
  saving: false,
  avatarUploading: false,
})
const avatarInput = ref(null)
const loggingOut = ref(false)
const preferenceSaving = ref(false)
const requireCostConfirm = computed(() => authStore.user?.requireCostConfirm !== false)

const normalizedProfileForm = computed(() => ({
  username: profileForm.username.trim(),
  bio: profileForm.bio.trim(),
  location: profileForm.location.trim(),
  websiteUrl: profileForm.websiteUrl.trim(),
}))
const normalizedSavedProfile = computed(() => ({
  username: String(authStore.user?.username || '').trim(),
  bio: String(authStore.user?.bio || '').trim(),
  location: String(authStore.user?.location || '').trim(),
  websiteUrl: String(authStore.user?.websiteUrl || '').trim(),
}))
const profileDirty = computed(
  () =>
    JSON.stringify(normalizedProfileForm.value) !== JSON.stringify(normalizedSavedProfile.value),
)
const usernameError = computed(() => (normalizedProfileForm.value.username ? '' : '昵称不能为空'))
const websiteError = computed(() => {
  const url = normalizedProfileForm.value.websiteUrl
  return url && !/^https?:\/\/[^\s]+$/i.test(url) ? '请输入完整的 http:// 或 https:// 地址' : ''
})
const profileCanSave = computed(
  () => profileDirty.value && !usernameError.value && !websiteError.value && !profileForm.saving,
)

const confirmDialog = reactive({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确认删除',
  icon: 'bi-trash3',
  eyebrow: '请确认此操作',
  note: '',
  tone: 'danger',
})
let confirmDialogResolve = null
const logoutConfirmOpen = ref(false)

function askConfirmation({
  title,
  message,
  confirmLabel = '确认删除',
  icon = 'bi-trash3',
  eyebrow = '请确认此操作',
  note = '',
  tone = 'danger',
}) {
  if (confirmDialogResolve) confirmDialogResolve(false)
  confirmDialog.title = title
  confirmDialog.message = message
  confirmDialog.confirmLabel = confirmLabel
  confirmDialog.icon = icon
  confirmDialog.eyebrow = eyebrow
  confirmDialog.note = note
  confirmDialog.tone = tone
  confirmDialog.open = true
  return new Promise((resolve) => {
    confirmDialogResolve = resolve
  })
}

function closeConfirmation(confirmed = false) {
  confirmDialog.open = false
  const resolve = confirmDialogResolve
  confirmDialogResolve = null
  resolve?.(confirmed)
}

const SUBMISSION_STATUS_LABELS = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  removed: '已下架',
}

const LEDGER_KIND_LABELS = {
  order_grant: '套餐入账',
  grant: '入账',
  task_freeze: '任务冻结',
  task_settle: '任务结算',
  task_release: '任务解冻',
  admin_adjust: '人工调整',
  redeem: '兑换码入账',
  subscription_grant: '订阅每日发放',
}

const TASK_TYPE_LABELS = {
  t2i: '文生图',
  coloring: '插画染色',
  ui_design: 'UI 设计稿',
  ecommerce_design: 'AI 电商设计',
  model_sheet: '模型图生成',
  game_art: '游戏美术',
  puzzle: 'AI 拼图',
  background_remove: '背景移除',
}

const TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

function ledgerTaskLabel(entry) {
  const task = entry?.task
  if (!task) return 'AI 任务'
  if (task.type === 'background_remove' && task.automaticBackgroundRemove) {
    return '生成后自动抠图'
  }
  return TASK_TYPE_LABELS[task.type] || 'AI 任务'
}

function ledgerTaskMeta(entry) {
  const task = entry?.task
  if (!task) return ''
  return [
    String(task.modelName || '').trim(),
    Number(task.count || 1) > 1 ? `${task.count} 张` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function ledgerPresentation(entry) {
  const kind = String(entry?.kind || '').toLowerCase()
  const delta = Number(entry?.deltaCents || 0)
  const amount = Math.abs(delta)
  const taskLabel = ledgerTaskLabel(entry)
  const taskStatus = TASK_STATUS_LABELS[entry?.task?.status] || ''
  const taskCost = Math.max(0, Number(entry?.task?.costPoints || amount))
  const taskMeta = ledgerTaskMeta(entry)
  const balanceLabel = `变动后可用 ${formatPoints(entry?.balanceAfterCents)}`

  if (entry?.task && Array.isArray(entry.relatedEntries)) {
    const status = String(entry.task.status || '').toLowerCase()
    if (status === 'succeeded') {
      const settledCost = Math.max(
        0,
        Number(entry.task.settledCostPoints ?? entry.task.costPoints ?? taskCost),
      )
      return {
        icon: 'bi-check2-circle',
        tone: 'settled',
        title: taskLabel,
        badge: '成功',
        amount: `-${formatPoints(settledCost)}`,
        amountTone: 'spend',
        description: `本次实际扣除 ${formatPoints(settledCost)}；费用从提交时的预扣中结算，没有重复扣费。`,
        meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
      }
    }
    if (status === 'failed' || status === 'canceled') {
      return {
        icon: 'bi-arrow-counterclockwise',
        tone: 'refund',
        title: taskLabel,
        badge: status === 'canceled' ? '已取消并退款' : '失败已退款',
        amount: '净支出 0 积分',
        amountTone: 'income',
        description: `预扣的 ${formatPoints(taskCost)} 已全部退回，本次没有产生费用。`,
        meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
      }
    }
    return {
      icon: 'bi-hourglass-split',
      tone: 'pending',
      title: taskLabel,
      badge: taskStatus || '处理中',
      amount: `冻结 ${formatPoints(taskCost)}`,
      amountTone: 'neutral',
      description: `当前暂时冻结 ${formatPoints(taskCost)}；任务成功后结算，失败或取消会自动退回。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }

  if (kind === 'freeze' || kind === 'task_freeze') {
    return {
      icon: 'bi-hourglass-split',
      tone: 'pending',
      title: `${taskLabel}费用预扣`,
      badge: taskStatus || '处理中',
      amount: `-${formatPoints(amount)}`,
      amountTone: 'spend',
      description: `提交时暂时冻结 ${formatPoints(amount)}；成功后从这笔预扣结算，失败会自动退回。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }
  if (kind === 'spend' || kind === 'task_settle') {
    return {
      icon: 'bi-check2-circle',
      tone: 'settled',
      title: `${taskLabel}已完成`,
      badge: '已结算',
      amount: '未再次扣费',
      amountTone: 'neutral',
      description: `已从此前预扣的 ${formatPoints(taskCost)} 中结算，本条记录没有再次扣除积分。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }
  if (kind === 'release' || kind === 'task_release' || kind === 'refund') {
    return {
      icon: 'bi-arrow-counterclockwise',
      tone: 'refund',
      title: `${taskLabel}费用已退回`,
      badge: taskStatus || '已退款',
      amount: `+${formatPoints(amount)}`,
      amountTone: 'income',
      description: `任务失败、取消或未完整交付，${formatPoints(amount)} 已退回可用余额。`,
      meta: [taskMeta, balanceLabel].filter(Boolean).join(' · '),
    }
  }

  const sourceLabels = {
    order: '套餐入账',
    redeem_code: '兑换码入账',
    subscription_daily: '订阅积分发放',
    signup_bonus: '注册赠送',
    daily_checkin: '签到奖励',
    admin: '人工调整',
  }
  const title =
    sourceLabels[entry?.sourceType] ||
    LEDGER_KIND_LABELS[kind] ||
    (delta >= 0 ? '积分入账' : '积分扣减')
  return {
    icon: delta >= 0 ? 'bi-plus-circle' : 'bi-dash-circle',
    tone: delta >= 0 ? 'income' : 'spend',
    title,
    badge: delta >= 0 ? '已入账' : '已扣减',
    amount: `${delta >= 0 ? '+' : '-'}${formatPoints(amount)}`,
    amountTone: delta >= 0 ? 'income' : 'spend',
    description: String(entry?.reason || '').trim() || '账户积分发生变动。',
    meta: balanceLabel,
  }
}

const ledgerRows = computed(() => {
  const grouped = new Map()
  ledger.value.forEach((entry) => {
    const taskID = String(entry?.task?.id || '').trim()
    const key = taskID ? `task:${taskID}` : `entry:${entry.id}`
    if (!grouped.has(key)) {
      grouped.set(key, { ...entry, id: key, relatedEntries: [] })
    }
    grouped.get(key).relatedEntries.push(entry)
  })
  return Array.from(grouped.values()).map((entry) => ({
    ...entry,
    presentation: ledgerPresentation(entry),
  }))
})

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadOverview() {
  try {
    overview.value = await getOverview()
    applyUnreadCount(overview.value?.unreadNotifications)
  } catch {
    /* 静默失败 */
  }
}

let realtimeRefreshTimer = null
function handleRealtimeTaskUpdate(event) {
  if (
    !event?.detail?.task ||
    !['succeeded', 'failed', 'canceled'].includes(event.detail.task.status)
  ) {
    return
  }
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null
    void loadOverview()
  }, 120)
}

async function loadSubmissions({ append = false } = {}) {
  if (submissionsLoading.value) return
  submissionsLoading.value = true
  submissionsError.value = ''
  try {
    const { items, nextCursor } = await listMyGallerySubmissions({
      limit: 12,
      cursor: append ? submissionsCursor.value || '' : '',
    })
    submissions.value = append ? [...submissions.value, ...items] : items
    submissionsCursor.value = nextCursor
    submissionsLoaded.value = true
  } catch (error) {
    submissionsError.value = error?.message || '投稿列表读取失败'
    if (!append) notificationService.error(submissionsError.value)
  } finally {
    submissionsLoading.value = false
  }
}

async function loadWallet() {
  walletLoading.value = true
  walletError.value = ''
  try {
    wallet.value = await getWallet()
    applyWalletSnapshot(wallet.value)
    walletLoaded.value = true
  } catch (error) {
    walletError.value = error?.message || '钱包读取失败'
  } finally {
    walletLoading.value = false
  }
}

async function loadLedger({ append = false } = {}) {
  if (ledgerLoading.value) return
  ledgerLoading.value = true
  ledgerError.value = ''
  try {
    const { items, nextCursor } = await listWalletLedger({
      limit: 15,
      cursor: append ? ledgerCursor.value || '' : '',
    })
    ledger.value = append ? [...ledger.value, ...items] : items
    ledgerCursor.value = nextCursor
  } catch (error) {
    ledgerError.value = error?.message || '账本读取失败'
  } finally {
    ledgerLoading.value = false
  }
}

function onRedeemInput(event) {
  redeemCode.value = String(event.target.value || '').toUpperCase()
}

async function submitRedeem() {
  const code = redeemCode.value.trim().toUpperCase()
  if (!code) {
    notificationService.info('请输入兑换码（格式 SC-XXXX-XXXX-XXXX）')
    return
  }
  if (redeeming.value) return
  redeeming.value = true
  try {
    const result = await redeemWalletCode(code)
    notificationService.success(`已入账 ${formatPoints(result?.grantCents || 0)}`)
    redeemCode.value = ''
    if (result?.balanceCents != null || result?.frozenCents != null) {
      applyWalletSnapshot({
        balanceCents: result?.balanceCents,
        frozenCents: result?.frozenCents,
      })
    }
    await Promise.all([
      loadWallet(),
      loadLedger(),
      loadOverview(),
      refreshWalletBalance({ force: true }).catch(() => null),
    ])
  } catch (error) {
    const mapped = REDEEM_ERROR_MESSAGES[error?.code]
    if (mapped) {
      notificationService.error(mapped)
    } else if (error?.status === 404) {
      notificationService.info('兑换功能即将开放，敬请期待')
    } else {
      notificationService.error(error?.message || '兑换失败，请稍后再试')
    }
  } finally {
    redeeming.value = false
  }
}

function ensureTabData() {
  /* 总览数据由 loadOverview 负责；其它分区已迁到独立页面 */
}

function switchTab(tabId) {
  const legacy = legacyTabPath(tabId)
  if (legacy) {
    router.push(legacy)
    return
  }
  activeTab.value = 'dashboard'
  const query = { ...route.query }
  delete query.tab
  router.replace({ query }).catch(() => null)
}

watch(
  () => route.query.tab,
  (tab) => {
    const legacy = legacyTabPath(tab)
    if (legacy) {
      router.replace(legacy).catch(() => null)
      return
    }
    activeTab.value = resolveTab(tab)
  },
)

const overlayOpen = computed(() => Boolean(confirmDialog.open || logoutConfirmOpen.value))

watch(
  overlayOpen,
  (open) => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('profile-overlay-open', open)
    }
  },
  { immediate: true },
)

function onSharedWalletUpdated(event) {
  const snap = event?.detail
  if (!snap) return
  wallet.value = {
    ...(wallet.value || {}),
    balanceCents: Number(snap.balanceCents || 0),
    frozenCents: Number(snap.frozenCents || 0),
  }
  if (overview.value?.wallet) {
    overview.value = {
      ...overview.value,
      wallet: {
        ...overview.value.wallet,
        balanceCents: Number(snap.balanceCents || 0),
        frozenCents: Number(snap.frozenCents || 0),
      },
    }
  }
}

async function removeSubmission(submission) {
  const confirmed = await askConfirmation({
    title: '删除这项投稿？',
    message: '投稿将从你的记录中移除；已展示的作品也会从画廊撤下。',
  })
  if (!confirmed) return
  try {
    await deleteMyGallerySubmission(submission.id)
    submissions.value = submissions.value.filter((item) => item.id !== submission.id)
    await loadOverview()
    notificationService.success('投稿已删除')
  } catch (error) {
    notificationService.error(error?.message || '删除失败')
  }
}

function syncProfileForm() {
  profileForm.username = authStore.user?.username || ''
  profileForm.bio = authStore.user?.bio || ''
  profileForm.location = authStore.user?.location || ''
  profileForm.websiteUrl = authStore.user?.websiteUrl || ''
}

async function saveProfile() {
  const { username, bio, location, websiteUrl } = normalizedProfileForm.value
  if (!username) {
    notificationService.warning('用户名不能为空')
    return
  }
  profileForm.saving = true
  try {
    if (websiteUrl && !/^https?:\/\/[^\s]+$/i.test(websiteUrl)) {
      notificationService.warning('个人网站需要填写完整的 http/https 地址')
      return
    }
    const result = await updateProfile({
      username,
      bio,
      location,
      websiteUrl,
    })
    authStore.patchUser(
      result?.user || {
        username,
        bio,
        location,
        websiteUrl,
      },
    )
    syncProfileForm()
    notificationService.success('个人资料已保存')
  } catch (error) {
    notificationService.error(error?.message || '保存失败')
  } finally {
    profileForm.saving = false
  }
}

async function setCostConfirmPreference(enabled) {
  if (preferenceSaving.value) return
  const previous = requireCostConfirm.value
  const next = Boolean(enabled)
  authStore.patchUser({ requireCostConfirm: next })
  preferenceSaving.value = true
  try {
    const result = await updateProfile({ requireCostConfirm: next })
    authStore.patchUser(result?.user || { requireCostConfirm: next })
    notificationService.success(next ? '已开启生成前费用确认' : '已关闭生成前费用确认')
  } catch (error) {
    authStore.patchUser({ requireCostConfirm: previous })
    notificationService.error(error?.message || '创作偏好保存失败')
  } finally {
    preferenceSaving.value = false
  }
}

function loadAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectURL)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectURL)
      reject(new Error('头像图片读取失败'))
    }
    image.src = objectURL
  })
}

async function createAvatarUpload(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 PNG、JPEG 或 WebP 图片')
  if (file.size > 10 * 1024 * 1024) throw new Error('头像图片不能超过 10MB')
  const image = await loadAvatarImage(file)
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理头像图片')
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    512,
    512,
  )
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('头像处理失败')
  return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
}

async function onAvatarSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || profileForm.avatarUploading) return
  profileForm.avatarUploading = true
  try {
    const uploaded = await uploadFile(await createAvatarUpload(file))
    const result = await updateProfile({ avatarUrl: uploaded.url })
    authStore.patchUser(result?.user || { avatarUrl: uploaded.url })
    notificationService.success('头像已更新')
  } catch (error) {
    notificationService.error(error?.message || '头像上传失败')
  } finally {
    profileForm.avatarUploading = false
  }
}

async function handleLogout() {
  if (loggingOut.value) return
  logoutConfirmOpen.value = true
}

function closeLogoutConfirm() {
  if (loggingOut.value) return
  logoutConfirmOpen.value = false
}

async function confirmLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    const result = await authStore.logout()
    logoutConfirmOpen.value = false
    if (result?.error) {
      notificationService.warning('本机登录状态已清除，服务器会话可能仍需稍后重试。')
    } else {
      notificationService.success('已安全退出登录')
    }
    await router.replace({ name: 'auth', query: { mode: 'login', redirect: '/profile' } })
  } finally {
    loggingOut.value = false
  }
}

onMounted(async () => {
  window.addEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.addEventListener(WALLET_UPDATED_EVENT, onSharedWalletUpdated)
  await authStore.initAuth().catch(() => null)
  syncProfileForm()
  void loadOverview()
  const legacy = legacyTabPath(route.query.tab)
  if (legacy) {
    router.replace(legacy).catch(() => null)
    return
  }
  activeTab.value = 'dashboard'
  await nextTick()
  void playDashboardMotion()
})

onBeforeUnmount(() => {
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  window.removeEventListener(WALLET_UPDATED_EVENT, onSharedWalletUpdated)
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  if (typeof document !== 'undefined') document.body.classList.remove('profile-overlay-open')
})
</script>

<template>
  <div
    ref="pageRootRef"
    class="pp-page is-soft"
    :class="{
      'is-light': !appearanceStore.isDark,
      'is-dark': appearanceStore.isDark,
      'is-dashboard': true,
    }"
  >
    <div class="pp-atmosphere" aria-hidden="true">
      <div class="pp-atmosphere__wash"></div>
      <div class="pp-atmosphere__orb pp-atmosphere__orb--a"></div>
      <div class="pp-atmosphere__orb pp-atmosphere__orb--b"></div>
    </div>

    <div class="pp-shell">
      <main class="pp-main">
        <section id="profile-panel-dashboard" class="pp-panel pp-soft-board" role="tabpanel">
          <div class="pp-soft-hero">
            <div class="pp-soft-stripes" aria-hidden="true"></div>

            <div class="pp-soft-character" aria-hidden="true">
              <img
                class="pp-bento-hero-figure"
                :src="heroVisualUrl"
                alt=""
                loading="eager"
                decoding="async"
                fetchpriority="high"
              />
            </div>

            <div class="pp-soft-event">
              <p class="pp-soft-event__eyebrow">Hi, Welcome</p>
              <h2>
                {{ authStore.user?.username || '创作者' }}
                <em>Studio</em>
              </h2>
              <p class="pp-soft-event__date">
                可用积分 {{ pointsDisplay }} · 累计任务 {{ taskStats.total }}
              </p>
              <div class="pp-soft-event__actions">
                <router-link to="/ai-wallpaper">+ 开始创作</router-link>
                <router-link to="/pricing">+ 充值积分</router-link>
              </div>
              <div class="pp-soft-event__chip">
                <i></i>
                素材 {{ materialCount }} · 投稿通过 {{ submissionStats.approved }}
              </div>
              <button
                type="button"
                class="pp-soft-event__logout"
                :disabled="loggingOut"
                @click="handleLogout"
              >
                <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
                {{ loggingOut ? '退出中…' : '退出登录' }}
              </button>
            </div>
          </div>

          <aside class="pp-soft-performance">
            <header>
              <strong>Performance</strong>
              <button type="button" @click="switchTab('submissions')">查看投稿</button>
            </header>
            <div class="pp-soft-progress">
              <span>成功率 {{ successRate }}%</span>
              <b><i :style="{ width: `${successRate}%` }"></i></b>
            </div>
            <ul class="pp-soft-perf-list">
              <li>
                <span>进行中</span><strong>{{ taskStats.running }}</strong>
              </li>
              <li>
                <span>已成功</span><strong>{{ taskStats.succeeded }}</strong>
              </li>
              <li>
                <span>失败</span><strong>{{ taskStats.failed }}</strong>
              </li>
              <li>
                <span>审核中</span><strong>{{ submissionStats.pending }}</strong>
              </li>
            </ul>
            <label class="pp-soft-switch" :class="{ 'is-saving': preferenceSaving }">
              <span>
                <em>生成前确认费用</em>
                <small>{{ requireCostConfirm ? '已开启' : '已关闭' }}</small>
              </span>
              <input
                type="checkbox"
                :checked="requireCostConfirm"
                :disabled="preferenceSaving"
                @change="setCostConfirmPreference($event.target.checked)"
              />
            </label>
            <div class="pp-soft-perf-foot">
              <router-link to="/history">创作历史</router-link>
              <router-link to="/account">账号设置</router-link>
            </div>
          </aside>

          <div class="pp-soft-stats">
            <RouterLink to="/materials" class="pp-soft-stat">
              <small>To do</small>
              <strong>{{ materialCount }}</strong>
              <span>素材库</span>
            </RouterLink>
            <RouterLink to="/notifications" class="pp-soft-stat">
              <small>On going</small>
              <strong>{{ unreadCount }}</strong>
              <span>未读通知</span>
            </RouterLink>
            <RouterLink to="/submissions" class="pp-soft-stat">
              <small>Complete</small>
              <strong>{{ String(submissionStats.approved).padStart(2, '0') }}</strong>
              <span>过审投稿</span>
            </RouterLink>
            <RouterLink to="/wallet" class="pp-soft-stat is-earn">
              <small>Earnings</small>
              <strong>{{ pointsDisplay }}</strong>
              <span>可用积分</span>
            </RouterLink>
          </div>
        </section>
      </main>
    </div>

    <!-- 危险操作确认 -->
    <Teleport to="body">
      <div
        v-if="confirmDialog.open"
        class="pp-backdrop"
        :class="{ 'is-light': !appearanceStore.isDark }"
        @click.self="closeConfirmation(false)"
        @keydown.esc="closeConfirmation(false)"
      >
        <div
          class="pp-dialog pp-confirm-dialog"
          :class="`is-${confirmDialog.tone}`"
          role="alertdialog"
          aria-modal="true"
          :aria-label="confirmDialog.title"
          tabindex="-1"
        >
          <button
            type="button"
            class="pp-confirm-dialog__close"
            aria-label="关闭"
            @click="closeConfirmation(false)"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          <div class="pp-confirm-dialog__body">
            <span class="pp-confirm-dialog__icon" aria-hidden="true">
              <i class="bi" :class="confirmDialog.icon"></i>
            </span>
            <div class="pp-confirm-dialog__copy">
              <span class="pp-confirm-dialog__eyebrow">{{ confirmDialog.eyebrow }}</span>
              <h3>{{ confirmDialog.title }}</h3>
              <p>{{ confirmDialog.message }}</p>
            </div>
          </div>
          <p v-if="confirmDialog.note" class="pp-confirm-dialog__note">
            <i class="bi bi-shield-check" aria-hidden="true"></i>
            <span>{{ confirmDialog.note }}</span>
          </p>
          <footer>
            <button
              type="button"
              class="pp-btn is-ghost"
              autofocus
              @click="closeConfirmation(false)"
            >
              取消
            </button>
            <button type="button" class="pp-btn is-danger" @click="closeConfirmation(true)">
              <i class="bi" :class="confirmDialog.icon" aria-hidden="true"></i>
              {{ confirmDialog.confirmLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <DeleteHistoryConfirmDialog
      :open="logoutConfirmOpen"
      :busy="loggingOut"
      heading="退出当前账号？"
      description="退出后需要重新登录才能继续查看个人资料和创作记录。"
      confirm-label="确认退出"
      busy-label="正在退出…"
      icon="bi-box-arrow-right"
      tone="accent"
      :light="!appearanceStore.isDark"
      @close="closeLogoutConfirm"
      @confirm="confirmLogout"
    />
  </div>
</template>

<style scoped src="./ProfileView.modern.css"></style>
