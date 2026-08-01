<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppearanceStore } from '@/stores/appearance'
import {
  deleteMyGallerySubmission,
  deleteUserAsset,
  createUserAsset,
  getOverview,
  getWallet,
  listMyGallerySubmissions,
  listNotifications,
  listUserAssets,
  listWalletLedger,
  markNotificationsRead,
  redeemWalletCode,
  updateProfile,
} from '@/services/meApi'
import { TASK_UPDATE_EVENT, uploadFile } from '@/services/tasksApi'
import { formatPoints } from '@/services/billingApi'
import notificationService from '@/services/notification'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'
import OptimizedImage from '@/components/common/OptimizedImage.vue'
import ProgressiveAuthenticatedImage from '@/components/common/ProgressiveAuthenticatedImage.vue'
import { useProfileDashboardMotion } from './useProfileDashboardMotion'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const appearanceStore = useAppearanceStore()
const pageRootRef = ref(null)

const TAB_IDS = ['dashboard', 'materials', 'submissions', 'wallet', 'notifications', 'account']
const TABS = [
  {
    id: 'dashboard',
    label: '总览',
    description: '个人中心仪表盘。',
    icon: 'bi-grid-1x2',
  },
  {
    id: 'materials',
    label: '素材库',
    description: '上传并整理可重复使用的个人视觉素材。',
    icon: 'bi-collection',
  },
  {
    id: 'submissions',
    label: '我的投稿',
    description: '查看画廊投稿与审核进度。',
    icon: 'bi-send-check',
  },
  { id: 'wallet', label: '钱包', description: '管理余额、兑换码和资金明细。', icon: 'bi-wallet2' },
  { id: 'notifications', label: '通知', description: '集中查看账号与任务消息。', icon: 'bi-bell' },
  {
    id: 'account',
    label: '账号设置',
    description: '管理公开资料、创作偏好和账号安全。',
    icon: 'bi-person-gear',
  },
]

const STUDIO_SHORTCUTS = [
  { to: '/ai-wallpaper', label: '文生图', tone: 'violet' },
  { to: '/assistant', label: 'AI 助手', tone: 'cyan' },
  { to: '/ai-illustration-coloring', label: '插画染色', tone: 'amber' },
]

function resolveTab(value) {
  const tab = String(value || '').trim()
  // 旧「我的作品」已迁到独立历史页，避免与 /history 重复
  if (tab === 'works') return 'materials'
  return TAB_IDS.includes(tab) ? tab : 'dashboard'
}

const activeTab = ref(resolveTab(route.query.tab))
const { playDashboardMotion } = useProfileDashboardMotion({
  rootRef: pageRootRef,
  activeTab,
})

// ---- 总览 ----
const overview = ref(null)
const unreadCount = computed(() => Number(overview.value?.unreadNotifications || 0))

// ---- 我的投稿 ----
const submissions = ref([])
const submissionsLoading = ref(false)
const submissionsCursor = ref(null)
const submissionsLoaded = ref(false)
const submissionsError = ref('')

// ---- 个人素材库 ----
const materials = ref([])
const materialsLoading = ref(false)
const materialsLoaded = ref(false)
const materialsCursor = ref(null)
const materialsUploading = ref(false)
const materialInput = ref(null)
const previewMaterial = ref(null)

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
const availableCents = computed(() => Math.max(0, balanceCents.value - frozenCents.value))
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

const submissionStats = computed(() => {
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

// ---- 通知 ----
const notifications = ref([])
const notificationsLoading = ref(false)
const notificationsCursor = ref(null)
const notificationsLoaded = ref(false)
const notificationsError = ref('')

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
  free_daily: '每日赠送',
  redeem: '兑换码入账',
  subscription_grant: '订阅每日发放',
}

function ledgerKindLabel(kind) {
  return LEDGER_KIND_LABELS[kind] || kind || '变动'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadOverview() {
  try {
    overview.value = await getOverview()
  } catch {
    /* 静默失败 */
  }
}

let realtimeRefreshTimer = null
function handleRealtimeTaskUpdate(event) {
  if (!event?.detail?.task || !['succeeded', 'failed', 'canceled'].includes(event.detail.task.status)) {
    return
  }
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null
    void loadOverview()
    if (notificationsLoaded.value) void loadNotifications()
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

async function loadMaterials({ append = false } = {}) {
  if (materialsLoading.value) return
  materialsLoading.value = true
  try {
    const { items, nextCursor } = await listUserAssets({
      limit: 24,
      cursor: append ? materialsCursor.value || '' : '',
    })
    materials.value = append ? [...materials.value, ...items] : items
    materialsCursor.value = nextCursor
    materialsLoaded.value = true
  } catch (error) {
    notificationService.error(error?.message || '素材库读取失败')
  } finally {
    materialsLoading.value = false
  }
}

function materialTitle(file) {
  return String(file?.name || '个人素材')
    .replace(/\.[a-z0-9]+$/i, '')
    .trim()
    .slice(0, 120)
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0))
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function onMaterialsSelected(event) {
  const files = Array.from(event.target?.files || [])
  if (event.target) event.target.value = ''
  if (!files.length || materialsUploading.value) return
  if (files.length > 6) {
    notificationService.warning('单次最多上传 6 张素材')
    return
  }
  const invalid = files.find(
    (file) => !file.type.startsWith('image/') || file.size <= 0 || file.size > 10 * 1024 * 1024,
  )
  if (invalid) {
    notificationService.warning('仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片')
    return
  }
  materialsUploading.value = true
  let completed = 0
  try {
    for (const file of files) {
      const uploaded = await uploadFile(file)
      const asset = await createUserAsset({
        title: materialTitle(file),
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
      })
      materials.value = [asset, ...materials.value.filter((item) => item.id !== asset.id)]
      completed += 1
    }
    materialsLoaded.value = true
    notificationService.success(`已添加 ${completed} 项素材`)
  } catch (error) {
    notificationService.error(error?.message || `已添加 ${completed} 项，其余素材上传失败`)
  } finally {
    materialsUploading.value = false
  }
}

async function removeMaterial(asset) {
  const confirmed = await askConfirmation({
    title: '删除这项素材？',
    message: '素材原图和缩略图都会移除，删除后无法恢复。',
  })
  if (!confirmed) return
  try {
    await deleteUserAsset(asset.id)
    materials.value = materials.value.filter((item) => item.id !== asset.id)
    if (previewMaterial.value?.id === asset.id) previewMaterial.value = null
    notificationService.success('素材已删除')
  } catch (error) {
    notificationService.error(error?.message || '素材删除失败')
  }
}

async function loadWallet() {
  walletLoading.value = true
  walletError.value = ''
  try {
    wallet.value = await getWallet()
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
    await Promise.all([loadWallet(), loadLedger(), loadOverview()])
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

async function loadNotifications({ append = false } = {}) {
  if (notificationsLoading.value) return
  notificationsLoading.value = true
  notificationsError.value = ''
  try {
    const { items, nextCursor } = await listNotifications({
      limit: 15,
      cursor: append ? notificationsCursor.value || '' : '',
    })
    notifications.value = append ? [...notifications.value, ...items] : items
    notificationsCursor.value = nextCursor
    notificationsLoaded.value = true
  } catch (error) {
    notificationsError.value = error?.message || '通知读取失败'
    if (!append) notificationService.error(notificationsError.value)
  } finally {
    notificationsLoading.value = false
  }
}

function ensureTabData(tabId) {
  if (tabId === 'dashboard') {
    if (!materialsLoaded.value) void loadMaterials()
    if (!submissionsLoaded.value) void loadSubmissions()
    if (!walletLoaded.value) void loadWallet()
    if (!notificationsLoaded.value) void loadNotifications()
    return
  }
  if (tabId === 'materials' && !materialsLoaded.value) void loadMaterials()
  if (tabId === 'submissions' && !submissionsLoaded.value) void loadSubmissions()
  if (tabId === 'wallet' && !walletLoaded.value) {
    void loadWallet()
    void loadLedger()
  }
  if (tabId === 'notifications' && !notificationsLoaded.value) void loadNotifications()
}

function switchTab(tabId) {
  if (String(tabId || '') === 'works') {
    router.push('/history')
    return
  }
  const next = resolveTab(tabId)
  activeTab.value = next
  ensureTabData(next)
  const query = { ...route.query }
  if (next === 'dashboard') delete query.tab
  else query.tab = next
  router.replace({ query }).catch(() => null)
}

watch(
  () => route.query.tab,
  (tab) => {
    if (String(tab || '') === 'works') {
      router.replace('/history').catch(() => null)
      return
    }
    const next = resolveTab(tab)
    if (next !== activeTab.value) {
      activeTab.value = next
      ensureTabData(next)
    }
  },
)

const overlayOpen = computed(() =>
  Boolean(previewMaterial.value || confirmDialog.open),
)

watch(
  overlayOpen,
  (open) => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('profile-overlay-open', open)
    }
  },
  { immediate: true },
)

async function markAllRead() {
  try {
    await markNotificationsRead()
    notifications.value = notifications.value.map((item) => ({
      ...item,
      readAt: item.readAt || new Date().toISOString(),
    }))
    if (overview.value) overview.value = { ...overview.value, unreadNotifications: 0 }
    notificationService.success('已全部标记为已读')
  } catch (error) {
    notificationService.error(error?.message || '操作失败')
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
  const confirmed = await askConfirmation({
    title: '退出当前账号？',
    message: '退出后需要重新登录才能继续查看个人资料和创作记录。',
    confirmLabel: '确认退出',
    icon: 'bi-box-arrow-right',
    eyebrow: '账号安全',
    note: '仅退出当前设备，不会删除你的账号、作品或素材。',
    tone: 'logout',
  })
  if (!confirmed) return

  loggingOut.value = true
  try {
    const result = await authStore.logout()
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
  await authStore.initAuth().catch(() => null)
  syncProfileForm()
  void loadOverview()
  if (String(route.query.tab || '') === 'works') {
    router.replace('/history').catch(() => null)
    return
  }
  ensureTabData(activeTab.value)
  if (activeTab.value === 'dashboard') {
    await nextTick()
    void playDashboardMotion()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(TASK_UPDATE_EVENT, handleRealtimeTaskUpdate)
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  if (typeof document !== 'undefined') document.body.classList.remove('profile-overlay-open')
})
</script>

<template>
  <div
    ref="pageRootRef"
    class="pp-page is-glass"
    :class="{
      'is-light': !appearanceStore.isDark,
      'is-dark': appearanceStore.isDark,
      'is-dashboard': activeTab === 'dashboard',
    }"
  >
    <div class="pp-atmosphere" aria-hidden="true">
      <div
        class="pp-atmosphere__photo"
        :class="appearanceStore.isDark ? 'is-dark-photo' : 'is-light-photo'"
      ></div>
      <div class="pp-atmosphere__veil"></div>
    </div>

    <div class="pp-shell">
      <nav class="pp-dock" aria-label="个人中心分区" role="tablist">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`profile-panel-${tab.id}`"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="switchTab(tab.id)"
        >
          <i class="bi" :class="tab.icon" aria-hidden="true"></i>
          <span>{{ tab.label }}</span>
          <em v-if="tab.id === 'notifications' && unreadCount > 0">{{ unreadCount }}</em>
          <em v-else-if="tab.id === 'materials' && materials.length">{{ materials.length }}</em>
        </button>
        <router-link class="pp-dock__link" to="/history">
          <i class="bi bi-clock-history" aria-hidden="true"></i>
          <span>历史</span>
        </router-link>
        <button type="button" class="pp-dock__logout" :disabled="loggingOut" @click="handleLogout">
          <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
          <span>{{ loggingOut ? '退出中' : '退出' }}</span>
        </button>
      </nav>

      <main class="pp-main">
        <!-- 玻璃 Bento 总览：三列命名网格 -->
        <section
          id="profile-panel-dashboard"
          v-show="activeTab === 'dashboard'"
          class="pp-panel pp-bento"
          role="tabpanel"
        >
          <article class="pp-glass pp-bento-card is-studio">
            <div class="pp-bento-wave" aria-hidden="true"></div>
            <header>
              <strong>创作入口</strong>
              <small>常用工作室</small>
            </header>
            <div class="pp-bento-pills">
              <router-link
                v-for="item in STUDIO_SHORTCUTS"
                :key="item.to"
                :to="item.to"
                :class="`is-${item.tone}`"
              >
                {{ item.label }}
              </router-link>
            </div>
          </article>

          <article class="pp-glass pp-bento-card is-hero" aria-hidden="true">
            <div class="pp-bento-hero-visual">
              <!-- orbit 锁定 100% 居中尺寸；GSAP 只动 figure，不改宽高 -->
              <div class="pp-bento-hero-orbit">
                <img
                  class="pp-bento-hero-figure"
                  :src="heroVisualUrl"
                  alt=""
                  loading="eager"
                  decoding="async"
                  fetchpriority="high"
                />
              </div>
            </div>
          </article>

          <article class="pp-glass pp-bento-card is-wallet">
            <header>
              <strong>可用积分</strong>
              <button type="button" class="pp-bento-link" @click="switchTab('wallet')">管理</button>
            </header>
            <div class="pp-bento-wallet-body">
              <div class="pp-bento-points">
                <strong>{{ pointsDisplay }}</strong>
                <span>积分</span>
              </div>
              <div class="pp-bento-wallet-meta">
                <span>总余额 {{ formatPoints(balanceCents, { withUnit: false }) }}</span>
                <span v-if="frozenCents"
                  >冻结 {{ formatPoints(frozenCents, { withUnit: false }) }}</span
                >
              </div>
            </div>
            <div class="pp-bento-foot is-wallet">
              <router-link to="/pricing">去充值</router-link>
              <button type="button" @click="switchTab('wallet')">兑换码</button>
            </div>
          </article>

          <article class="pp-glass pp-bento-card is-bars">
            <header>
              <strong>任务分布</strong>
              <small>{{ taskStats.total }} 次</small>
            </header>
            <div v-if="taskTypeBars.length" class="pp-bento-bars" aria-hidden="true">
              <div v-for="bar in taskTypeBars" :key="bar.key" class="pp-bento-bar">
                <i :style="{ '--bar-h': `${bar.height}%` }"></i>
                <span>{{ bar.label }}</span>
              </div>
            </div>
            <p v-else class="pp-bento-empty">生成几次后会显示类型分布</p>
          </article>

          <article class="pp-glass pp-bento-card is-pref">
            <header>
              <strong>创作偏好</strong>
              <small>费用确认</small>
            </header>
            <label class="pp-bento-switch" :class="{ 'is-saving': preferenceSaving }">
              <span>
                <em>生成前确认</em>
                <small>{{ requireCostConfirm ? '开启中' : '已关闭' }}</small>
              </span>
              <input
                type="checkbox"
                :checked="requireCostConfirm"
                :disabled="preferenceSaving"
                @change="setCostConfirmPreference($event.target.checked)"
              />
              <i aria-hidden="true"></i>
            </label>
            <div class="pp-bento-sliders" aria-hidden="true">
              <div>
                <span>成功率 {{ successRate }}%</span>
                <b :style="{ '--value': `${successRate}%` }"></b>
              </div>
              <div>
                <span>素材 {{ materials.length }} / 200</span>
                <b :style="{ '--value': `${Math.min(100, (materials.length / 200) * 100)}%` }"></b>
              </div>
            </div>
          </article>

          <article class="pp-glass pp-bento-card is-activity">
            <header>
              <strong>创作与投稿</strong>
              <button type="button" class="pp-bento-link" @click="switchTab('submissions')">
                查看投稿
              </button>
            </header>
            <div class="pp-bento-dual">
              <div class="pp-bento-activity">
                <div class="pp-bento-ring is-activity" :style="ringStyle" aria-hidden="true">
                  <span>
                    <strong>{{ taskStats.total || 0 }}</strong>
                    <small>任务</small>
                  </span>
                </div>
                <ul>
                  <li><em></em><span>成功</span><b>{{ taskStats.succeeded }}</b></li>
                  <li>
                    <em class="is-run"></em><span>进行中</span><b>{{ taskStats.running }}</b>
                  </li>
                  <li><em class="is-fail"></em><span>失败</span><b>{{ taskStats.failed }}</b></li>
                </ul>
              </div>
              <div class="pp-bento-submit-body">
                <div class="pp-bento-donut" :style="approvalRingStyle" aria-hidden="true">
                  <i>{{ submissionStats.total }}</i>
                </div>
                <div class="pp-bento-swatches">
                  <span><i class="is-ok"></i>通过 {{ submissionStats.approved }}</span>
                  <span><i class="is-wait"></i>审核 {{ submissionStats.pending }}</span>
                  <span><i class="is-no"></i>拒绝 {{ submissionStats.rejected }}</span>
                </div>
              </div>
            </div>
          </article>

          <article class="pp-glass pp-bento-card is-metrics">
            <header>
              <strong>快捷入口</strong>
              <small>一键跳转</small>
            </header>
            <div class="pp-bento-metrics">
              <button type="button" @click="switchTab('materials')">
                <strong>{{ materials.length }}</strong>
                <span>素材</span>
              </button>
              <button type="button" @click="switchTab('notifications')">
                <strong>{{ unreadCount }}</strong>
                <span>未读</span>
              </button>
              <button type="button" @click="switchTab('submissions')">
                <strong>{{ submissionStats.approved }}</strong>
                <span>过审</span>
              </button>
              <router-link to="/history">
                <strong>{{ recentTasks.length }}</strong>
                <span>最近</span>
              </router-link>
            </div>
            <div class="pp-bento-foot">
              <router-link to="/history">创作历史</router-link>
              <button type="button" @click="switchTab('account')">账号设置</button>
            </div>
          </article>
        </section>

        <!-- 个人素材库 -->
        <section
          id="profile-panel-materials"
          v-show="activeTab === 'materials'"
          class="pp-panel pp-materials-panel pp-glass-panel"
          role="tabpanel"
        >
          <header class="pp-panel-head pp-materials-head">
            <div>
              <h2>个人素材</h2>
              <p>列表始终使用 512px 缩略图；只有打开预览时才读取原图。</p>
            </div>
            <button
              type="button"
              class="pp-btn is-primary"
              :disabled="materialsUploading || materials.length >= 200"
              @click="materialInput?.click()"
            >
              <i class="bi" :class="materialsUploading ? 'bi-arrow-repeat spin' : 'bi-plus-lg'"></i>
              {{ materialsUploading ? '上传中…' : '添加素材' }}
            </button>
            <input
              ref="materialInput"
              class="pp-avatar-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              @change="onMaterialsSelected"
            />
          </header>

          <div
            v-if="materialsLoading && !materials.length"
            class="pp-material-grid"
            aria-hidden="true"
          >
            <div v-for="n in 8" :key="n" class="pp-material-skeleton"></div>
          </div>
          <div v-else-if="materials.length" class="pp-material-grid">
            <article v-for="asset in materials" :key="asset.id" class="pp-material-card">
              <button
                type="button"
                class="pp-material-card__cover"
                @click="previewMaterial = asset"
              >
                <AuthenticatedImage
                  :src="asset.thumbnailUrl"
                  :alt="asset.title"
                  loading="lazy"
                  root-margin="180px 0px"
                />
                <span class="pp-material-card__preview-hint"
                  ><i class="bi bi-arrows-fullscreen"></i> 预览</span
                >
              </button>
              <div class="pp-material-card__body">
                <strong :title="asset.title">{{ asset.title }}</strong>
                <small
                  >{{ formatBytes(asset.sizeBytes) }} · {{ formatTime(asset.createdAt) }}</small
                >
                <button type="button" aria-label="删除素材" @click="removeMaterial(asset)">
                  <i class="bi bi-trash3"></i>
                </button>
              </div>
            </article>
          </div>
          <div v-else class="pp-empty is-compact">
            <i class="bi bi-collection"></i>
            <strong>建立你的私人素材架</strong>
            <p>上传 PNG、JPEG 或 WebP；单张不超过 10MB，单次最多 6 张。</p>
            <button type="button" class="pp-btn is-primary" @click="materialInput?.click()">
              添加第一项素材
            </button>
          </div>

          <div class="pp-material-limit">
            <span>{{ materials.length }} / 200 项</span>
            <span>单张 ≤ 10MB</span>
          </div>
          <button
            v-if="materialsCursor"
            type="button"
            class="pp-btn is-ghost pp-load-more"
            :disabled="materialsLoading"
            @click="loadMaterials({ append: true })"
          >
            {{ materialsLoading ? '加载中…' : '加载更多' }}
          </button>
        </section>

        <!-- 我的投稿 -->
        <section
          id="profile-panel-submissions"
          v-show="activeTab === 'submissions'"
          class="pp-panel pp-glass-panel"
          role="tabpanel"
        >
          <ul v-if="submissions.length" class="pp-submission-list">
            <li v-for="submission in submissions" :key="submission.id">
              <OptimizedImage
                v-if="submission.coverUrl || submission.mediaUrls?.length"
                :src="submission.coverUrl || submission.mediaUrls[0]"
                alt=""
                loading="lazy"
                root-margin="480px 0px"
              />
              <div class="pp-submission__body">
                <strong>{{ submission.title || 'AI 作品' }}</strong>
                <small>{{ formatTime(submission.createdAt) }}</small>
                <p v-if="submission.rejectReason" class="pp-submission__reason">
                  原因：{{ submission.rejectReason }}
                </p>
              </div>
              <span class="pp-submission__status" :data-status="submission.status">
                {{ SUBMISSION_STATUS_LABELS[submission.status] || submission.status }}
              </span>
              <button
                type="button"
                class="pp-submission__remove"
                title="撤回/删除"
                @click="removeSubmission(submission)"
              >
                <i class="bi bi-trash3"></i>
              </button>
            </li>
          </ul>
          <div v-else-if="submissionsLoaded && !submissionsLoading" class="pp-empty">
            <i class="bi bi-send"></i>
            <strong>还没有投稿</strong>
            <p>可在创作历史里把成功任务投稿到画廊。</p>
            <RouterLink class="pp-btn is-ghost" to="/history">打开创作历史</RouterLink>
          </div>
          <button
            v-if="submissionsCursor"
            type="button"
            class="pp-btn is-ghost pp-load-more"
            :disabled="submissionsLoading"
            @click="loadSubmissions({ append: true })"
          >
            {{ submissionsLoading ? '加载中…' : '加载更多' }}
          </button>
        </section>

        <!-- 钱包：余额 + 兑换码 + 账本 -->
        <section
          id="profile-panel-wallet"
          v-show="activeTab === 'wallet'"
          class="pp-panel pp-glass-panel"
          role="tabpanel"
        >
          <header class="pp-panel-head">
            <div>
              <h2>钱包</h2>
              <p>余额、兑换码入账与资金明细。</p>
            </div>
            <button
              type="button"
              class="pp-btn is-ghost"
              :disabled="walletLoading"
              @click="
                () => {
                  void loadWallet()
                  void loadLedger()
                }
              "
            >
              <i class="bi bi-arrow-repeat" :class="{ spin: walletLoading || ledgerLoading }"></i>
              刷新
            </button>
          </header>

          <div v-if="walletLoading && !walletLoaded" class="pp-skel-list" aria-hidden="true">
            <div class="pp-skel-card"></div>
            <div class="pp-skel-row"></div>
          </div>

          <div v-else-if="walletError && !wallet" class="pp-state is-error">
            <strong>钱包加载失败</strong>
            <p>{{ walletError }}</p>
            <button type="button" class="pp-btn is-ghost" @click="loadWallet()">重试</button>
          </div>

          <template v-else>
            <div class="pp-wallet-hero">
              <div>
                <span class="pp-wallet-hero__label">可用余额</span>
                <strong class="pp-wallet-hero__amount">{{ formatPoints(availableCents) }}</strong>
                <div class="pp-wallet-hero__meta">
                  <span>总余额 {{ formatPoints(balanceCents) }}</span>
                  <span v-if="frozenCents > 0" class="is-frozen">
                    冻结 {{ formatPoints(frozenCents) }}
                  </span>
                </div>
              </div>
              <RouterLink class="pp-btn is-primary" to="/pricing">去充值</RouterLink>
            </div>

            <div class="pp-redeem">
              <div class="pp-redeem__head">
                <h3>兑换码</h3>
                <p>持有兑换码可在此入账，格式 SC-XXXX-XXXX-XXXX。</p>
              </div>
              <form class="pp-redeem__form" @submit.prevent="submitRedeem">
                <input
                  :value="redeemCode"
                  type="text"
                  class="pp-redeem__input"
                  placeholder="SC-XXXX-XXXX-XXXX"
                  maxlength="20"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="兑换码"
                  @input="onRedeemInput"
                />
                <button type="submit" class="pp-btn is-primary" :disabled="redeeming">
                  {{ redeeming ? '兑换中…' : '兑换' }}
                </button>
              </form>
            </div>

            <div class="pp-ledger">
              <div class="pp-ledger__head">
                <h3>账本明细</h3>
                <span v-if="ledgerError" class="pp-ledger__error">{{ ledgerError }}</span>
              </div>

              <div v-if="ledgerLoading && !ledger.length" class="pp-skel-list" aria-hidden="true">
                <div v-for="n in 5" :key="n" class="pp-skel-row"></div>
              </div>

              <ul v-else-if="ledger.length" class="pp-ledger-list">
                <li v-for="entry in ledger" :key="entry.id">
                  <div class="pp-ledger__main">
                    <span>{{ ledgerKindLabel(entry.kind) }}</span>
                    <strong :class="Number(entry.deltaCents) >= 0 ? 'is-income' : 'is-spend'">
                      {{ Number(entry.deltaCents) >= 0 ? '+' : ''
                      }}{{ formatPoints(entry.deltaCents) }}
                    </strong>
                  </div>
                  <small>
                    {{ formatTime(entry.createdAt) }} · 余额
                    {{ formatPoints(entry.balanceAfterCents) }}
                    <template v-if="entry.reason"> · {{ entry.reason }}</template>
                  </small>
                </li>
              </ul>

              <p v-else-if="!ledgerLoading" class="pp-empty">暂无余额变动记录。</p>

              <button
                v-if="ledgerCursor"
                type="button"
                class="pp-btn is-ghost pp-load-more"
                :disabled="ledgerLoading"
                @click="loadLedger({ append: true })"
              >
                {{ ledgerLoading ? '加载中…' : '加载更多' }}
              </button>
            </div>
          </template>
        </section>

        <!-- 通知 -->
        <section
          id="profile-panel-notifications"
          v-show="activeTab === 'notifications'"
          class="pp-panel pp-glass-panel"
          role="tabpanel"
        >
          <div class="pp-notify-toolbar">
            <button type="button" class="pp-btn is-ghost" @click="markAllRead">
              <i class="bi bi-check2-all"></i> 全部已读
            </button>
          </div>
          <ul v-if="notifications.length" class="pp-notify-list">
            <li v-for="item in notifications" :key="item.id" :class="{ 'is-unread': !item.readAt }">
              <span class="pp-notify-dot" aria-hidden="true"></span>
              <div>
                <strong>{{ item.title }}</strong>
                <p v-if="item.body">{{ item.body }}</p>
                <small>{{ formatTime(item.createdAt) }}</small>
              </div>
            </li>
          </ul>
          <p v-else-if="notificationsLoaded && !notificationsLoading" class="pp-empty">
            暂无通知。
          </p>
          <button
            v-if="notificationsCursor"
            type="button"
            class="pp-btn is-ghost pp-load-more"
            :disabled="notificationsLoading"
            @click="loadNotifications({ append: true })"
          >
            {{ notificationsLoading ? '加载中…' : '加载更多' }}
          </button>
        </section>

        <!-- 账号设置 -->
        <section
          id="profile-panel-account"
          v-show="activeTab === 'account'"
          class="pp-panel pp-glass-panel"
          role="tabpanel"
        >
          <div class="pp-account-forms">
            <form class="pp-account-form is-profile" @submit.prevent="saveProfile">
              <h3><i class="bi bi-person-vcard"></i> 个人资料</h3>
              <div class="pp-avatar-editor">
                <button
                  type="button"
                  class="pp-avatar-editor__preview"
                  :disabled="profileForm.avatarUploading"
                  aria-label="更换头像"
                  @click="avatarInput?.click()"
                >
                  <img
                    v-if="authStore.user?.avatarUrl"
                    :src="authStore.user.avatarUrl"
                    alt="头像"
                    loading="eager"
                    decoding="async"
                  />
                  <img
                    v-else
                    src="/brand/avatar-placeholder.svg"
                    alt="头像"
                    loading="eager"
                    decoding="async"
                  />
                </button>
                <div>
                  <strong>{{ authStore.displayName }}</strong>
                  <p data-no-translate>{{ authStore.user?.email }}</p>
                  <div class="pp-avatar-editor__actions">
                    <button
                      type="button"
                      class="pp-btn is-ghost"
                      :disabled="profileForm.avatarUploading"
                      @click="avatarInput?.click()"
                    >
                      <i
                        class="bi"
                        :class="profileForm.avatarUploading ? 'bi-arrow-repeat spin' : 'bi-camera'"
                      ></i>
                      {{ profileForm.avatarUploading ? '上传中…' : '更换头像' }}
                    </button>
                  </div>
                </div>
                <input
                  ref="avatarInput"
                  class="pp-avatar-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  @change="onAvatarSelected"
                />
              </div>
              <div class="pp-profile-form-grid">
                <label
                  ><span>昵称</span
                  ><input
                    v-model="profileForm.username"
                    maxlength="64"
                    placeholder="你希望展示的名字"
                    :aria-invalid="Boolean(usernameError)"
                /></label>
                <label
                  ><span>所在地</span
                  ><input
                    v-model="profileForm.location"
                    maxlength="80"
                    placeholder="例如：上海 / Remote"
                /></label>
                <label class="is-wide"
                  ><span>个人网站</span
                  ><input
                    v-model="profileForm.websiteUrl"
                    maxlength="300"
                    inputmode="url"
                    placeholder="https://example.com"
                    :aria-invalid="Boolean(websiteError)"
                /></label>
                <p v-if="websiteError" class="pp-field-error is-wide">{{ websiteError }}</p>
                <label class="is-wide"
                  ><span
                    >个人简介 <em>{{ profileForm.bio.length }}/280</em></span
                  ><textarea
                    v-model="profileForm.bio"
                    maxlength="280"
                    rows="5"
                    placeholder="介绍你的创作方向、擅长风格或正在进行的项目…"
                  ></textarea>
                </label>
              </div>
              <div class="pp-form-footer">
                <span :class="{ 'is-dirty': profileDirty }">
                  <i class="bi" :class="profileDirty ? 'bi-circle-fill' : 'bi-check2-circle'"></i>
                  {{ profileDirty ? '有未保存的修改' : '资料已是最新状态' }}
                </span>
                <button type="submit" class="pp-btn is-primary" :disabled="!profileCanSave">
                  {{ profileForm.saving ? '保存中…' : '保存个人资料' }}
                </button>
              </div>
            </form>

            <section id="generation-preferences" class="pp-account-form is-preferences">
              <h3><i class="bi bi-sliders2"></i> 创作偏好</h3>
              <p class="pp-preference-intro">
                调整生成流程中的确认方式。余额不足、预算超限等安全拦截始终保留。
              </p>
              <label class="pp-preference-row" :class="{ 'is-saving': preferenceSaving }">
                <span class="pp-preference-copy">
                  <strong>生成前费用确认</strong>
                  <small>
                    {{
                      requireCostConfirm
                        ? '每次提交付费生成前显示费用明细'
                        : '校验通过后直接提交生成任务'
                    }}
                  </small>
                </span>
                <input
                  type="checkbox"
                  :checked="requireCostConfirm"
                  :disabled="preferenceSaving"
                  aria-label="生成前费用确认"
                  @change="setCostConfirmPreference($event.target.checked)"
                />
                <span class="pp-preference-switch" aria-hidden="true"><i></i></span>
              </label>
              <div class="pp-preference-state" :data-enabled="requireCostConfirm">
                <i
                  class="bi"
                  :class="preferenceSaving ? 'bi-arrow-repeat spin' : 'bi-check2-circle'"
                ></i>
                {{ preferenceSaving ? '正在保存账号偏好…' : '已同步到当前账号' }}
              </div>
            </section>

            <section class="pp-account-form is-identity">
              <h3><i class="bi bi-fingerprint"></i> 账号信息</h3>
              <dl>
                <div>
                  <dt>登录邮箱</dt>
                  <dd>{{ authStore.user?.email || '—' }}</dd>
                </div>
                <div>
                  <dt>账号 ID</dt>
                  <dd>{{ authStore.user?.id || '—' }}</dd>
                </div>
                <div>
                  <dt>注册时间</dt>
                  <dd>{{ formatTime(authStore.user?.createdAt) }}</dd>
                </div>
              </dl>
            </section>
          </div>
        </section>
      </main>
    </div>

    <!-- 素材原图按需预览 -->
    <Teleport to="body">
      <div
        v-if="previewMaterial"
        class="pp-backdrop pp-viewport-backdrop"
        :class="{ 'is-light': !appearanceStore.isDark }"
        tabindex="-1"
        @click.self="previewMaterial = null"
        @keydown.esc="previewMaterial = null"
      >
        <div class="pp-preview pp-material-preview">
          <header>
            <div>
              <strong>{{ previewMaterial.title }}</strong>
              <small>{{ formatBytes(previewMaterial.sizeBytes) }}</small>
            </div>
            <button type="button" aria-label="关闭" @click="previewMaterial = null">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <div class="pp-preview__media">
            <ProgressiveAuthenticatedImage
              :src="previewMaterial.url"
              :preview-src="previewMaterial.thumbnailUrl"
              :alt="previewMaterial.title"
              loading="eager"
              fetchpriority="high"
              load-original
            />
          </div>
        </div>
      </div>
    </Teleport>

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
            <button
              type="button"
              class="pp-btn"
              :class="confirmDialog.tone === 'logout' ? 'is-primary' : 'is-danger'"
              @click="closeConfirmation(true)"
            >
              <i class="bi" :class="confirmDialog.icon" aria-hidden="true"></i>
              {{ confirmDialog.confirmLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="./ProfileView.modern.css"></style>
