<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
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
import { deleteTask, listTasks, TASK_TYPE_LABELS, uploadFile } from '@/services/tasksApi'
import { listGalleryCategories, submitShareItem } from '@/services/shareGallery'
import { formatCents } from '@/services/billingApi'
import notificationService from '@/services/notification'
import ProgressiveAuthenticatedImage from '@/components/common/ProgressiveAuthenticatedImage.vue'
import AuthenticatedImage from '@/components/common/AuthenticatedImage.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const TAB_IDS = ['works', 'materials', 'submissions', 'wallet', 'notifications', 'account']
const TABS = [
  {
    id: 'materials',
    label: '素材库',
    description: '上传并整理可重复使用的个人视觉素材。',
    icon: 'bi-collection',
  },
  {
    id: 'works',
    label: '我的作品',
    description: '查找、预览和管理你的创作记录。',
    icon: 'bi-images',
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
    description: '更新公开资料、头像和登录密码。',
    icon: 'bi-person-gear',
  },
]

function resolveTab(value) {
  const tab = String(value || '').trim()
  return TAB_IDS.includes(tab) ? tab : 'works'
}

const activeTab = ref(resolveTab(route.query.tab))
const activeTabInfo = computed(() => TABS.find((tab) => tab.id === activeTab.value) || TABS[0])

// ---- 总览 ----
const overview = ref(null)
const unreadCount = computed(() => Number(overview.value?.unreadNotifications || 0))

// ---- 我的作品（任务列表） ----
const tasks = ref([])
const tasksLoading = ref(false)
const tasksCursor = ref(null)
const taskTypeFilter = ref('')
const previewTask = ref(null)
const deletingTaskId = ref('')
const loggingOut = ref(false)
const submittingTaskId = ref('')
const taskSearch = ref('')
const taskStatusFilter = ref('')

const hasTaskFilters = computed(() =>
  Boolean(taskSearch.value.trim() || taskStatusFilter.value || taskTypeFilter.value),
)

function cleanText(value, max = 220) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function taskOriginalUrl(task) {
  return task?.originalUrls?.[0] || task?.outputUrls?.[0] || ''
}

function taskThumbnailUrl(task) {
  if (Array.isArray(task?.thumbnailKeys) && task.thumbnailKeys.length === 0) return ''
  return task?.thumbnailUrls?.[0] || task?.outputUrls?.[0] || ''
}

function taskDisplayPrompt(task) {
  return String(
    task?.params?.userPrompt || task?.userPrompt || task?.params?.prompt || task?.prompt || '',
  )
    .replace(/\{argument\b[^{}]*\bdefault="([^"]*)"[^{}]*\}/gi, '$1')
    .replace(/\{argument\b[^{}]*\bdefault='([^']*)'[^{}]*\}/gi, '$1')
    .replace(/\{argument\b[^{}]*\}/gi, '')
    .trim()
}

const visibleTasks = computed(() => {
  const seen = new Set()
  const query = taskSearch.value.trim().toLowerCase()
  return tasks.value
    .filter((task) => {
      const id = String(task?.id || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      if (taskStatusFilter.value && task.status !== taskStatusFilter.value) return false
      if (!query) return true
      return `${taskDisplayPrompt(task)} ${TASK_TYPE_LABELS[task.type] || ''}`
        .toLowerCase()
        .includes(query)
    })
    .map((task) => ({
      ...task,
      cleanPrompt: cleanText(taskDisplayPrompt(task), 180) || '未填写提示词',
    }))
})

// ---- 投稿到画廊对话框 ----
const submitDialog = reactive({ open: false, task: null, title: '', categoryId: '' })
const galleryCategories = ref([])
let galleryCategoriesRequested = false

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

const availableCents = computed(() =>
  Math.max(0, Number(wallet.value?.balanceCents || 0) - Number(wallet.value?.frozenCents || 0)),
)

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
const passwordForm = reactive({ old: '', next: '', confirm: '', saving: false })
const passwordVisible = reactive({ old: false, next: false, confirm: false })
const avatarInput = ref(null)

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
const passwordStarted = computed(() =>
  Boolean(passwordForm.old || passwordForm.next || passwordForm.confirm),
)
const passwordChecks = computed(() => ({
  length: passwordForm.next.length >= 8,
  matches: Boolean(passwordForm.confirm) && passwordForm.next === passwordForm.confirm,
}))
const passwordCanSave = computed(
  () =>
    Boolean(passwordForm.old) &&
    passwordChecks.value.length &&
    passwordChecks.value.matches &&
    !passwordForm.saving,
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

const TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  completed: '已完成',
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
  cancelled: '已取消',
  paused: '已暂停',
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

async function loadTasks({ append = false } = {}) {
  if (tasksLoading.value) return
  tasksLoading.value = true
  try {
    const { items, nextCursor } = await listTasks({
      type: taskTypeFilter.value,
      limit: 12,
      cursor: append ? tasksCursor.value || '' : '',
    })
    tasks.value = append ? [...tasks.value, ...items] : items
    tasksCursor.value = nextCursor
  } catch (error) {
    notificationService.error(error?.message || '任务列表读取失败')
  } finally {
    tasksLoading.value = false
  }
}

function setTaskFilter(type) {
  if (taskTypeFilter.value === type) return
  taskTypeFilter.value = type
  tasksCursor.value = null
  void loadTasks()
}

function clearTaskFilters() {
  const reload = Boolean(taskTypeFilter.value)
  taskSearch.value = ''
  taskStatusFilter.value = ''
  taskTypeFilter.value = ''
  if (reload) {
    tasksCursor.value = null
    void loadTasks()
  }
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
    notificationService.success(`已入账 ${formatCents(result?.grantCents || 0)}`)
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
  if (tabId === 'materials' && !materialsLoaded.value) void loadMaterials()
  if (tabId === 'submissions' && !submissionsLoaded.value) void loadSubmissions()
  if (tabId === 'wallet' && !walletLoaded.value) {
    void loadWallet()
    void loadLedger()
  }
  if (tabId === 'notifications' && !notificationsLoaded.value) void loadNotifications()
}

function switchTab(tabId) {
  const next = resolveTab(tabId)
  activeTab.value = next
  ensureTabData(next)
  const query = { ...route.query }
  if (next === 'works') delete query.tab
  else query.tab = next
  router.replace({ query }).catch(() => null)
}

watch(
  () => route.query.tab,
  (tab) => {
    const next = resolveTab(tab)
    if (next !== activeTab.value) {
      activeTab.value = next
      ensureTabData(next)
    }
  },
)

const overlayOpen = computed(() =>
  Boolean(previewTask.value || previewMaterial.value || submitDialog.open || confirmDialog.open),
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

async function removeTask(task) {
  if (deletingTaskId.value) return
  const confirmed = await askConfirmation({
    title: '删除这项作品？',
    message: '任务记录与生成产物会一并移除，删除后无法恢复。',
  })
  if (!confirmed) return
  deletingTaskId.value = task.id
  try {
    await deleteTask(task.id)
    tasks.value = tasks.value.filter((item) => item.id !== task.id)
    if (previewTask.value?.id === task.id) previewTask.value = null
    notificationService.success('任务已删除')
  } catch (error) {
    notificationService.error(error?.message || '删除失败')
  } finally {
    deletingTaskId.value = ''
  }
}

function openSubmitDialog(task) {
  if (submittingTaskId.value) return
  submitDialog.task = task
  submitDialog.title = taskDisplayPrompt(task).slice(0, 40) || 'AI 作品'
  submitDialog.categoryId = ''
  submitDialog.open = true
  if (!galleryCategoriesRequested) {
    galleryCategoriesRequested = true
    listGalleryCategories()
      .then((items) => {
        galleryCategories.value = items
      })
      .catch(() => {
        galleryCategories.value = []
      })
  }
}

function closeSubmitDialog() {
  if (submittingTaskId.value) return
  submitDialog.open = false
  submitDialog.task = null
}

async function submitToGallery() {
  const task = submitDialog.task
  if (!task || submittingTaskId.value) return
  submittingTaskId.value = task.id
  try {
    await submitShareItem({
      taskId: task.id,
      title: submitDialog.title.trim() || 'AI 作品',
      categoryId: submitDialog.categoryId,
    })
    notificationService.success('已提交审核，可在「我的投稿」查看进度')
    submissionsLoaded.value = false
    submitDialog.open = false
    submitDialog.task = null
  } catch (error) {
    notificationService.error(error?.message || '投稿失败')
  } finally {
    submittingTaskId.value = ''
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

async function removeAvatar() {
  if (profileForm.avatarUploading || !authStore.user?.avatarUrl) return
  profileForm.avatarUploading = true
  try {
    const result = await updateProfile({ avatarUrl: '' })
    authStore.patchUser(result?.user || { avatarUrl: null })
    notificationService.success('头像已移除')
  } catch (error) {
    notificationService.error(error?.message || '头像移除失败')
  } finally {
    profileForm.avatarUploading = false
  }
}

async function savePassword() {
  if (!passwordForm.old || !passwordForm.next) {
    notificationService.warning('请填写旧密码和新密码')
    return
  }
  if (passwordForm.next.length < 8) {
    notificationService.warning('新密码至少 8 位')
    return
  }
  if (passwordForm.next !== passwordForm.confirm) {
    notificationService.warning('两次输入的新密码不一致')
    return
  }
  passwordForm.saving = true
  try {
    await updateProfile({ password: { old: passwordForm.old, new: passwordForm.next } })
    passwordForm.old = ''
    passwordForm.next = ''
    passwordForm.confirm = ''
    notificationService.success('密码已更新')
  } catch (error) {
    notificationService.error(error?.message || '密码修改失败')
  } finally {
    passwordForm.saving = false
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
  await authStore.initAuth().catch(() => null)
  syncProfileForm()
  void loadOverview()
  void loadTasks()
  ensureTabData(activeTab.value)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.classList.remove('profile-overlay-open')
})
</script>

<template>
  <div class="pp-page">
    <div class="pp-atmosphere" aria-hidden="true"></div>

    <div class="pp-shell">
      <aside class="pp-sidebar">
        <!-- 个人资料摘要 -->
        <header class="pp-masthead">
          <div class="pp-profile-summary">
            <button
              type="button"
              class="pp-avatar"
              :disabled="profileForm.avatarUploading"
              aria-label="更换头像"
              @click="avatarInput?.click()"
            >
              <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" alt="头像" />
              <i v-else class="bi bi-person-fill" aria-hidden="true"></i>
              <em>
                <i
                  class="bi"
                  :class="profileForm.avatarUploading ? 'bi-arrow-repeat spin' : 'bi-camera-fill'"
                ></i>
              </em>
            </button>
            <div class="pp-profile-copy">
              <span>个人空间</span>
              <h1>{{ authStore.displayName }}</h1>
              <p data-no-translate>{{ authStore.user?.email }}</p>
            </div>
          </div>
          <input
            ref="avatarInput"
            class="pp-avatar-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="onAvatarSelected"
          />
          <p v-if="authStore.user?.bio" class="pp-profile-bio" data-no-translate>
            {{ authStore.user.bio }}
          </p>
          <div class="pp-idline">
            <span v-if="authStore.user?.location" data-no-translate>
              <i class="bi bi-geo-alt" aria-hidden="true"></i>
              {{ authStore.user.location }}
            </span>
            <span>
              <i class="bi bi-calendar3" aria-hidden="true"></i>
              {{ formatTime(authStore.user?.createdAt) }}
            </span>
          </div>
          <button type="button" class="pp-edit-shortcut" @click="switchTab('account')">
            <i class="bi bi-pencil-square" aria-hidden="true"></i>
            编辑个人资料
          </button>
        </header>

        <nav class="pp-tabs" aria-label="个人中心分区" role="tablist">
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
            <i class="bi bi-chevron-right pp-tab-arrow" aria-hidden="true"></i>
          </button>
        </nav>

        <footer class="pp-sidebar-footer">
          <button type="button" :disabled="loggingOut" @click="handleLogout">
            <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
            <span>{{ loggingOut ? '正在退出…' : '退出登录' }}</span>
          </button>
        </footer>
      </aside>

      <main class="pp-main">
        <header class="pp-content-head">
          <div>
            <span class="pp-content-index">
              SPACE
              {{ String(TABS.findIndex((tab) => tab.id === activeTab) + 1).padStart(2, '0') }} /
              {{ String(TABS.length).padStart(2, '0') }}
            </span>
            <h2>{{ activeTabInfo.label }}</h2>
            <p>{{ activeTabInfo.description }}</p>
          </div>
          <RouterLink to="/text-to-image" class="pp-create-link">
            <i class="bi bi-stars" aria-hidden="true"></i>
            开始创作
          </RouterLink>
        </header>

        <!-- 我的作品 -->
        <section
          id="profile-panel-works"
          v-show="activeTab === 'works'"
          class="pp-panel"
          role="tabpanel"
        >
          <div class="pp-works-filter">
            <button
              type="button"
              :class="{ 'is-active': taskTypeFilter === '' }"
              @click="setTaskFilter('')"
            >
              全部
            </button>
            <button
              v-for="(label, type) in TASK_TYPE_LABELS"
              :key="type"
              type="button"
              :class="{ 'is-active': taskTypeFilter === type }"
              @click="setTaskFilter(type)"
            >
              {{ label }}
            </button>
          </div>

          <div class="pp-works-toolbar">
            <label class="pp-search"
              ><i class="bi bi-search"></i
              ><input v-model="taskSearch" type="search" placeholder="搜索提示词"
            /></label>
            <div class="pp-works-toolbar__meta">
              <span>{{ visibleTasks.length }} 项结果</span>
              <button v-if="hasTaskFilters" type="button" @click="clearTaskFilters">
                清除筛选
              </button>
              <select v-model="taskStatusFilter" aria-label="状态筛选">
                <option value="">全部状态</option>
                <option value="succeeded">已完成</option>
                <option value="running">生成中</option>
                <option value="queued">排队中</option>
                <option value="failed">失败</option>
              </select>
            </div>
          </div>

          <div v-if="tasksLoading && !tasks.length" class="pp-works-grid" aria-label="正在加载作品">
            <div v-for="n in 8" :key="n" class="pp-work-skeleton" aria-hidden="true">
              <div></div>
              <span></span><span></span>
            </div>
          </div>
          <div v-else-if="visibleTasks.length" class="pp-works-grid">
            <article v-for="task in visibleTasks" :key="task.id" class="pp-work">
              <button
                type="button"
                class="pp-work__cover"
                :disabled="!taskOriginalUrl(task)"
                @click="previewTask = task"
              >
                <ProgressiveAuthenticatedImage
                  v-if="taskThumbnailUrl(task)"
                  :src="taskOriginalUrl(task)"
                  :preview-src="taskThumbnailUrl(task)"
                  :alt="task.cleanPrompt || 'AI 作品'"
                  loading="lazy"
                  :retry-count="2"
                />
                <span v-else class="pp-work__placeholder" :data-status="task.status">
                  <i
                    class="bi"
                    :class="
                      task.status === 'failed'
                        ? 'bi-x-circle'
                        : task.status === 'succeeded'
                          ? 'bi-image'
                          : 'bi-hourglass-split'
                    "
                  ></i>
                  {{
                    task.status === 'succeeded'
                      ? '缩略图暂不可用，点击查看原图'
                      : TASK_STATUS_LABELS[task.status] || task.status
                  }}
                </span>
              </button>
              <div class="pp-work__meta">
                <span class="pp-work__type">{{ TASK_TYPE_LABELS[task.type] || '其他创作' }}</span>
                <span class="pp-work__status" :data-status="task.status">
                  {{ TASK_STATUS_LABELS[task.status] || '未知状态' }}
                </span>
              </div>
              <p class="pp-work__prompt" :title="task.cleanPrompt" data-no-translate>
                {{ task.cleanPrompt }}
              </p>
              <small class="pp-work__caption">
                {{ formatTime(task.createdAt) }} · {{ formatCents(task.costCents) }}
              </small>
              <div class="pp-work__actions">
                <button
                  v-if="task.status === 'succeeded' && taskOriginalUrl(task)"
                  type="button"
                  :disabled="submittingTaskId === task.id"
                  @click="openSubmitDialog(task)"
                >
                  <i class="bi bi-send"></i> 投稿
                </button>
                <button
                  type="button"
                  class="is-danger"
                  :disabled="deletingTaskId === task.id"
                  @click="removeTask(task)"
                >
                  <i class="bi bi-trash3"></i> 删除
                </button>
              </div>
            </article>
          </div>
          <div v-else-if="!tasksLoading" class="pp-empty">
            <i class="bi" :class="hasTaskFilters ? 'bi-search' : 'bi-images'"></i>
            <strong>{{ hasTaskFilters ? '没有符合条件的作品' : '还没有创作记录' }}</strong>
            <p>
              {{ hasTaskFilters ? '换个关键词或清除筛选后再试。' : '去工作台生成第一张图吧。' }}
            </p>
            <button
              v-if="hasTaskFilters"
              type="button"
              class="pp-btn is-ghost"
              @click="clearTaskFilters"
            >
              清除筛选
            </button>
            <RouterLink v-else class="pp-btn is-primary" to="/text-to-image">开始创作</RouterLink>
          </div>

          <button
            v-if="tasksCursor"
            type="button"
            class="pp-btn is-ghost pp-load-more"
            :disabled="tasksLoading"
            @click="loadTasks({ append: true })"
          >
            {{ tasksLoading ? '加载中…' : '加载更多' }}
          </button>
        </section>

        <!-- 个人素材库 -->
        <section
          id="profile-panel-materials"
          v-show="activeTab === 'materials'"
          class="pp-panel pp-materials-panel"
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
          class="pp-panel"
          role="tabpanel"
        >
          <ul v-if="submissions.length" class="pp-submission-list">
            <li v-for="submission in submissions" :key="submission.id">
              <img
                v-if="submission.coverUrl || submission.mediaUrls?.length"
                :src="submission.coverUrl || submission.mediaUrls[0]"
                alt=""
                loading="lazy"
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
          <p v-else-if="submissionsLoaded && !submissionsLoading" class="pp-empty">
            还没有投稿，在「我的作品」里把成功任务投稿到画廊吧。
          </p>
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
          class="pp-panel"
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
                <strong class="pp-wallet-hero__amount">{{ formatCents(availableCents) }}</strong>
                <div class="pp-wallet-hero__meta">
                  <span>总余额 {{ formatCents(wallet?.balanceCents || 0) }}</span>
                  <span v-if="Number(wallet?.frozenCents || 0) > 0" class="is-frozen">
                    冻结 {{ formatCents(wallet?.frozenCents || 0) }}
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
                      }}{{ formatCents(entry.deltaCents) }}
                    </strong>
                  </div>
                  <small>
                    {{ formatTime(entry.createdAt) }} · 余额
                    {{ formatCents(entry.balanceAfterCents) }}
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
          class="pp-panel"
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
          class="pp-panel"
          role="tabpanel"
        >
          <div class="pp-account-forms">
            <form class="pp-account-form is-profile" @submit.prevent="saveProfile">
              <h3><i class="bi bi-person-vcard"></i> 个人资料</h3>
              <div class="pp-avatar-editor">
                <button
                  type="button"
                  class="pp-avatar-editor__preview"
                  @click="avatarInput?.click()"
                >
                  <img
                    v-if="authStore.user?.avatarUrl"
                    :src="authStore.user.avatarUrl"
                    alt="当前头像"
                  />
                  <i v-else class="bi bi-person-fill"></i>
                </button>
                <div>
                  <strong>个人头像</strong>
                  <p>自动裁切为 512 × 512，支持 PNG、JPEG、WebP。</p>
                  <div class="pp-avatar-editor__actions">
                    <button
                      type="button"
                      class="pp-btn is-ghost"
                      :disabled="profileForm.avatarUploading"
                      @click="avatarInput?.click()"
                    >
                      上传新头像
                    </button>
                    <button
                      v-if="authStore.user?.avatarUrl"
                      type="button"
                      class="pp-btn is-text"
                      :disabled="profileForm.avatarUploading"
                      @click="removeAvatar"
                    >
                      移除
                    </button>
                  </div>
                </div>
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

            <form class="pp-account-form" @submit.prevent="savePassword">
              <h3><i class="bi bi-shield-lock"></i> 修改密码</h3>
              <label>
                <span>当前密码</span>
                <span class="pp-password-input">
                  <input
                    v-model="passwordForm.old"
                    :type="passwordVisible.old ? 'text' : 'password'"
                    autocomplete="current-password"
                  />
                  <button
                    type="button"
                    :aria-label="passwordVisible.old ? '隐藏当前密码' : '显示当前密码'"
                    @click="passwordVisible.old = !passwordVisible.old"
                  >
                    <i class="bi" :class="passwordVisible.old ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </span>
              </label>
              <label>
                <span>新密码（至少 8 位）</span>
                <span class="pp-password-input">
                  <input
                    v-model="passwordForm.next"
                    :type="passwordVisible.next ? 'text' : 'password'"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    :aria-label="passwordVisible.next ? '隐藏新密码' : '显示新密码'"
                    @click="passwordVisible.next = !passwordVisible.next"
                  >
                    <i class="bi" :class="passwordVisible.next ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </span>
              </label>
              <label>
                <span>确认新密码</span>
                <span class="pp-password-input">
                  <input
                    v-model="passwordForm.confirm"
                    :type="passwordVisible.confirm ? 'text' : 'password'"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    :aria-label="passwordVisible.confirm ? '隐藏确认密码' : '显示确认密码'"
                    @click="passwordVisible.confirm = !passwordVisible.confirm"
                  >
                    <i class="bi" :class="passwordVisible.confirm ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </span>
              </label>
              <ul v-if="passwordStarted" class="pp-password-checks" aria-live="polite">
                <li :class="{ 'is-valid': passwordChecks.length }">
                  <i
                    class="bi"
                    :class="passwordChecks.length ? 'bi-check-circle-fill' : 'bi-circle'"
                  ></i>
                  至少 8 个字符
                </li>
                <li :class="{ 'is-valid': passwordChecks.matches }">
                  <i
                    class="bi"
                    :class="passwordChecks.matches ? 'bi-check-circle-fill' : 'bi-circle'"
                  ></i>
                  两次输入一致
                </li>
              </ul>
              <button type="submit" class="pp-btn is-primary" :disabled="!passwordCanSave">
                {{ passwordForm.saving ? '保存中…' : '更新密码' }}
              </button>
            </form>

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

    <!-- 投稿到画廊 -->
    <Teleport to="body">
      <div v-if="submitDialog.open" class="pp-backdrop" @click.self="closeSubmitDialog">
        <div class="pp-dialog" role="dialog" aria-modal="true" aria-label="投稿到画廊">
          <header>
            <strong>投稿到画廊</strong>
            <button type="button" aria-label="关闭" @click="closeSubmitDialog">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <img
            v-if="submitDialog.task?.outputUrls?.length"
            class="pp-dialog__cover"
            :src="submitDialog.task.outputUrls[0]"
            alt=""
          />
          <label>
            <span>作品标题</span>
            <input
              v-model="submitDialog.title"
              maxlength="120"
              placeholder="给作品起一个容易被发现的名字"
              @keydown.enter.prevent="submitToGallery"
            />
          </label>
          <label>
            <span>作品分类（可选）</span>
            <select v-model="submitDialog.categoryId">
              <option value="">暂不分类</option>
              <option v-for="category in galleryCategories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select>
          </label>
          <footer>
            <button type="button" class="pp-btn is-ghost" @click="closeSubmitDialog">取消</button>
            <button
              type="button"
              class="pp-btn is-primary"
              :disabled="Boolean(submittingTaskId) || !submitDialog.title.trim()"
              @click="submitToGallery"
            >
              <i class="bi" :class="submittingTaskId ? 'bi-arrow-repeat spin' : 'bi-send'"></i>
              {{ submittingTaskId ? '提交中…' : '提交审核' }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- 素材原图按需预览 -->
    <Teleport to="body">
      <div
        v-if="previewMaterial"
        class="pp-backdrop pp-viewport-backdrop"
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
            <img :src="previewMaterial.url" :alt="previewMaterial.title" />
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 产物大图预览 -->
    <Teleport to="body">
      <div
        v-if="previewTask"
        class="pp-backdrop pp-viewport-backdrop pp-task-preview-backdrop"
        tabindex="-1"
        @click.self="previewTask = null"
        @keydown.esc="previewTask = null"
      >
        <div class="pp-preview" role="dialog" aria-modal="true" aria-label="作品预览">
          <header>
            <strong>{{ TASK_TYPE_LABELS[previewTask.type] || previewTask.type }}</strong>
            <button type="button" aria-label="关闭" @click="previewTask = null">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <div class="pp-preview__media">
            <a
              v-for="(url, index) in previewTask.originalUrls?.length
                ? previewTask.originalUrls
                : previewTask.outputUrls"
              :key="index"
              :href="url"
              target="_blank"
              rel="noopener"
            >
              <ProgressiveAuthenticatedImage
                class="pp-preview__image"
                :src="url"
                :alt="`产物 ${index + 1}`"
                loading="eager"
                :load-original="true"
                :retry-count="2"
              />
            </a>
          </div>
          <p class="pp-preview__prompt" data-no-translate>
            {{ cleanText(taskDisplayPrompt(previewTask), 800) }}
          </p>
        </div>
      </div>
    </Teleport>

    <!-- 危险操作确认 -->
    <Teleport to="body">
      <div
        v-if="confirmDialog.open"
        class="pp-backdrop"
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

<style scoped>
/* —— 个人中心 · 深色美术馆语言（与价格页同一套 token） —— */
.pp-page {
  --pp-ink: #eceaf2;
  --pp-muted: rgba(214, 218, 235, 0.58);
  --pp-faint: rgba(214, 218, 235, 0.34);
  --pp-line: rgba(226, 201, 143, 0.14);
  --pp-hairline: rgba(255, 255, 255, 0.08);
  --pp-gold: #e2c98f;
  --pp-cyan: #8fd8d2;
  --pp-danger: #e08585;
  --pp-serif: 'Songti SC', 'Noto Serif SC', 'STSong', Georgia, serif;
  --pp-mono: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace;
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  max-width: 1180px;
  margin: 0 auto;
  padding: clamp(28px, 5vh, 52px) clamp(18px, 3.4vw, 40px) 72px;
  color: var(--pp-ink);
}

.pp-atmosphere {
  pointer-events: none;
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: min(56vh, 540px);
  background:
    radial-gradient(ellipse 46% 52% at 20% 8%, rgba(226, 201, 143, 0.06), transparent 70%),
    radial-gradient(ellipse 30% 38% at 82% 24%, rgba(143, 216, 210, 0.05), transparent 72%);
  mask-image: linear-gradient(180deg, #000 42%, transparent);
}

.pp-page > * {
  position: relative;
  z-index: 1;
}

/* —— 馆主档案页头 —— */
.pp-masthead {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 18px;
  padding-bottom: clamp(22px, 4vh, 32px);
  border-bottom: 1px solid var(--pp-line);
}

.pp-masthead__spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 2px;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.pp-masthead__spine i {
  flex: 1;
  width: 1px;
  margin: 12px 0;
  background: linear-gradient(180deg, transparent, rgba(226, 201, 143, 0.5), transparent);
}

.pp-masthead__spine em {
  font-style: normal;
  color: var(--pp-gold);
}

.pp-eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 12px;
  color: var(--pp-gold);
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pp-eyebrow i {
  width: 42px;
  height: 1px;
  background: linear-gradient(90deg, rgba(226, 201, 143, 0.6), transparent);
}

.pp-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin: 0;
}

.pp-name__text {
  font-family: var(--pp-serif);
  font-size: clamp(1.8rem, 4.4vw, 2.8rem);
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.15;
}

.pp-avatar {
  display: grid;
  place-items: center;
  width: clamp(52px, 6vw, 64px);
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid rgba(226, 201, 143, 0.4);
  color: var(--pp-gold);
  font-size: 1.5rem;
  background: rgba(226, 201, 143, 0.06);
}

.pp-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pp-member {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 1px solid rgba(226, 201, 143, 0.4);
  color: var(--pp-gold);
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.pp-idline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  color: var(--pp-muted);
  font-size: 0.84rem;
}

.pp-idline i {
  width: 26px;
  height: 1px;
  background: var(--pp-hairline);
}

.pp-masthead__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

/* —— 数据卡 —— */
.pp-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-top: clamp(20px, 4vh, 30px);
}

.pp-stats article {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 18px 20px;
  border: 1px solid var(--pp-hairline);
  border-top: 2px solid rgba(226, 201, 143, 0.34);
  background: rgba(255, 255, 255, 0.014);
}

.pp-stats__label {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pp-stats__value {
  font-family: var(--pp-serif);
  font-size: clamp(1.5rem, 2.6vw, 1.9rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pp-stats__value.is-gold {
  color: var(--pp-gold);
}

.pp-stats__foot {
  font-size: 0.76rem;
  color: var(--pp-faint);
  text-decoration: none;
}

a.pp-stats__foot,
.pp-stats__foot.is-link {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  color: var(--pp-gold);
  cursor: pointer;
}

.pp-stats__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.pp-type-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.pp-type-chip {
  padding: 4px 12px;
  border: 1px solid var(--pp-hairline);
  color: var(--pp-muted);
  font-family: var(--pp-mono);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
}

/* —— Tab —— */
.pp-tabs {
  display: flex;
  gap: 0;
  margin-top: clamp(28px, 5vh, 40px);
  border-bottom: 1px solid var(--pp-hairline);
  overflow-x: auto;
}

.pp-tabs button {
  display: grid;
  gap: 2px;
  justify-items: start;
  padding: 10px 20px 12px 0;
  margin-right: 26px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--pp-muted);
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
}

.pp-tabs button small {
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.pp-tabs button span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--pp-serif);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.pp-tabs button.is-active {
  color: var(--pp-ink);
  border-bottom-color: var(--pp-gold);
}

.pp-tabs button.is-active small {
  color: var(--pp-gold);
}

.pp-tabs em {
  font-style: normal;
  min-width: 18px;
  padding: 0 5px;
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  line-height: 18px;
  text-align: center;
  color: #16130a;
  background: var(--pp-gold);
}

.pp-panel {
  padding-top: 22px;
}

/* —— 我的作品 —— */
.pp-works-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.pp-works-filter button {
  padding: 6px 14px;
  border: 1px solid var(--pp-hairline);
  background: transparent;
  color: var(--pp-muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.pp-works-filter button.is-active {
  border-color: rgba(226, 201, 143, 0.55);
  color: var(--pp-gold);
  background: rgba(226, 201, 143, 0.06);
}

.pp-works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 16px;
}

.pp-work {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--pp-hairline);
  background: rgba(255, 255, 255, 0.014);
  transition:
    border-color 0.25s ease,
    transform 0.25s ease;
}

.pp-work:hover {
  border-color: rgba(226, 201, 143, 0.36);
  transform: translateY(-2px);
}

.pp-work__cover {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: none;
  overflow: hidden;
  padding: 0;
  cursor: zoom-in;
  background: rgba(0, 0, 0, 0.32);
}

.pp-work__cover:disabled {
  cursor: default;
}

.pp-work__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}

.pp-work:hover .pp-work__cover img {
  transform: scale(1.03);
}

.pp-work__mark {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 8px;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.5);
  font-family: var(--pp-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
}

.pp-work__placeholder {
  display: grid;
  place-items: center;
  gap: 6px;
  height: 100%;
  font-size: 0.8rem;
  color: var(--pp-faint);
}

.pp-work__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pp-work__type {
  color: var(--pp-gold);
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
}

.pp-work__status {
  font-family: var(--pp-mono);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border: 1px solid var(--pp-hairline);
  color: var(--pp-muted);
}

.pp-work__status[data-status='succeeded'] {
  color: var(--pp-cyan);
  border-color: rgba(143, 216, 210, 0.3);
}

.pp-work__status[data-status='failed'] {
  color: var(--pp-danger);
  border-color: rgba(224, 133, 133, 0.3);
}

.pp-work__status[data-status='running'],
.pp-work__status[data-status='queued'] {
  color: #f0b453;
  border-color: rgba(240, 180, 83, 0.3);
}

.pp-work__prompt {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--pp-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pp-work__caption {
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  color: var(--pp-faint);
}

.pp-work__actions {
  display: flex;
  gap: 8px;
}

.pp-work__actions button {
  flex: 1;
  padding: 7px 0;
  border: 1px solid var(--pp-hairline);
  background: transparent;
  color: var(--pp-muted);
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.pp-work__actions button:hover:not(:disabled) {
  border-color: rgba(226, 201, 143, 0.45);
  color: var(--pp-gold);
}

.pp-work__actions .is-danger {
  color: var(--pp-danger);
}

.pp-work__actions .is-danger:hover:not(:disabled) {
  border-color: rgba(224, 133, 133, 0.5);
  color: var(--pp-danger);
}

/* —— 投稿列表 —— */
.pp-submission-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.pp-submission-list li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--pp-hairline);
  background: rgba(255, 255, 255, 0.014);
}

.pp-submission-list img {
  width: 72px;
  height: 54px;
  object-fit: cover;
}

.pp-submission__body {
  flex: 1;
  min-width: 0;
}

.pp-submission__body strong {
  display: block;
  font-size: 0.9rem;
  letter-spacing: 0.03em;
}

.pp-submission__body small {
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  color: var(--pp-faint);
}

.pp-submission__reason {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: var(--pp-danger);
}

.pp-submission__status {
  flex-shrink: 0;
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border: 1px solid var(--pp-hairline);
  color: var(--pp-muted);
}

.pp-submission__status[data-status='pending'] {
  color: #f0b453;
  border-color: rgba(240, 180, 83, 0.3);
}

.pp-submission__status[data-status='approved'] {
  color: var(--pp-cyan);
  border-color: rgba(143, 216, 210, 0.3);
}

.pp-submission__status[data-status='rejected'],
.pp-submission__status[data-status='removed'] {
  color: var(--pp-danger);
  border-color: rgba(224, 133, 133, 0.3);
}

.pp-submission__remove {
  border: none;
  background: transparent;
  color: var(--pp-faint);
  cursor: pointer;
  font-size: 0.95rem;
}

.pp-submission__remove:hover {
  color: var(--pp-danger);
}

/* —— 通知 —— */
.pp-notify-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}

.pp-notify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.pp-notify-list li {
  display: flex;
  gap: 12px;
  padding: 13px 15px;
  border: 1px solid var(--pp-hairline);
  background: rgba(255, 255, 255, 0.01);
}

.pp-notify-list li.is-unread {
  border-color: rgba(226, 201, 143, 0.3);
  background: rgba(226, 201, 143, 0.03);
}

.pp-notify-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-top: 7px;
  transform: rotate(45deg);
  background: rgba(255, 255, 255, 0.16);
}

.pp-notify-list li.is-unread .pp-notify-dot {
  background: var(--pp-gold);
}

.pp-notify-list strong {
  font-size: 0.88rem;
  letter-spacing: 0.03em;
}

.pp-notify-list p {
  margin: 3px 0 0;
  font-size: 0.8rem;
  color: var(--pp-muted);
  line-height: 1.6;
}

.pp-notify-list small {
  font-family: var(--pp-mono);
  font-size: 0.66rem;
  color: var(--pp-faint);
}

/* —— 账号设置 —— */
.pp-account-forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.pp-account-form {
  display: grid;
  gap: 12px;
  padding: 22px;
  border: 1px solid var(--pp-hairline);
  border-top: 2px solid rgba(226, 201, 143, 0.34);
  background: rgba(255, 255, 255, 0.014);
}

.pp-account-form h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--pp-serif);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.pp-account-form h3 i {
  color: var(--pp-gold);
}

.pp-account-form label {
  display: grid;
  gap: 6px;
}

.pp-account-form label span {
  font-size: 0.76rem;
  color: var(--pp-faint);
  letter-spacing: 0.04em;
}

.pp-account-form input {
  padding: 10px 12px;
  border: 1px solid var(--pp-hairline);
  border-radius: 0;
  background: rgba(0, 0, 0, 0.28);
  color: inherit;
  outline: none;
}

.pp-account-form input:focus {
  border-color: rgba(226, 201, 143, 0.5);
}

/* —— 按钮 —— */
.pp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 18px;
  border-radius: 0;
  font-size: 0.84rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.pp-btn.is-primary {
  border: 1px solid var(--pp-gold);
  background: var(--pp-gold);
  color: #16130a;
}

.pp-btn.is-primary:hover:not(:disabled) {
  background: transparent;
  color: var(--pp-gold);
}

.pp-btn.is-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pp-btn.is-ghost {
  border: 1px solid var(--pp-hairline);
  background: transparent;
  color: var(--pp-muted);
}

.pp-btn.is-ghost:hover:not(:disabled) {
  border-color: rgba(226, 201, 143, 0.45);
  color: var(--pp-gold);
}

.pp-btn.is-text {
  border: none;
  background: transparent;
  color: var(--pp-faint);
  padding: 9px 4px;
}

.pp-btn.is-text:hover {
  color: var(--pp-danger);
}

.pp-load-more {
  margin-top: 18px;
}

.pp-empty {
  padding: 30px 0;
  color: var(--pp-faint);
  font-size: 0.86rem;
}

.pp-panel-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 14px;
  margin-bottom: 20px;
}

.pp-panel-head h2 {
  margin: 0;
  font-family: var(--pp-serif);
  font-size: 1.2rem;
  letter-spacing: 0.06em;
}

.pp-panel-head p {
  margin: 6px 0 0;
  color: var(--pp-muted);
  font-size: 0.82rem;
}

.pp-state {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding: 28px 22px;
  border: 1px dashed rgba(226, 201, 143, 0.24);
  background: rgba(226, 201, 143, 0.02);
}

.pp-state strong {
  font-family: var(--pp-serif);
  font-size: 1.05rem;
  letter-spacing: 0.04em;
}

.pp-state p {
  margin: 0;
  color: var(--pp-muted);
  font-size: 0.84rem;
  line-height: 1.6;
}

.pp-state.is-error {
  border-color: rgba(224, 133, 133, 0.35);
  background: rgba(224, 133, 133, 0.04);
}

.pp-skel-list {
  display: grid;
  gap: 10px;
}

.pp-skel-row,
.pp-skel-card {
  min-height: 64px;
  border: 1px solid var(--pp-hairline);
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.02) 30%,
    rgba(255, 255, 255, 0.05) 50%,
    rgba(255, 255, 255, 0.02) 70%
  );
  background-size: 200% 100%;
  animation: pp-skel 1.4s ease infinite;
}

.pp-skel-card {
  min-height: 120px;
}

@keyframes pp-skel {
  to {
    background-position: -200% 0;
  }
}

.pp-order-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.pp-order-list li {
  padding: 16px 18px;
  border: 1px solid var(--pp-hairline);
  background: rgba(255, 255, 255, 0.014);
}

.pp-order__main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.pp-order__amount {
  font-family: var(--pp-serif);
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--pp-gold);
  font-variant-numeric: tabular-nums;
}

.pp-order__status {
  padding: 3px 10px;
  border: 1px solid var(--pp-hairline);
  font-family: var(--pp-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  color: var(--pp-muted);
}

.pp-order__status[data-status='pending'] {
  color: #f0b453;
  border-color: rgba(240, 180, 83, 0.35);
}

.pp-order__status[data-status='paid'] {
  color: var(--pp-gold);
  border-color: rgba(226, 201, 143, 0.35);
}

.pp-order__status[data-status='completed'] {
  color: var(--pp-cyan);
  border-color: rgba(143, 216, 210, 0.35);
}

.pp-order__status[data-status='failed'],
.pp-order__status[data-status='expired'] {
  color: var(--pp-danger);
  border-color: rgba(224, 133, 133, 0.35);
}

.pp-order__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  color: var(--pp-faint);
  font-size: 0.76rem;
}

.pp-order__hint {
  margin: 10px 0 0;
  color: #f0b453;
  font-size: 0.78rem;
}

.pp-wallet-hero {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 18px;
  padding: 22px 22px 20px;
  border: 1px solid var(--pp-hairline);
  border-left: 2px solid var(--pp-gold);
  background: linear-gradient(150deg, rgba(226, 201, 143, 0.05), rgba(255, 255, 255, 0.012) 55%);
}

.pp-wallet-hero__label {
  display: block;
  color: var(--pp-faint);
  font-family: var(--pp-mono);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.pp-wallet-hero__amount {
  display: block;
  margin-top: 8px;
  font-family: var(--pp-serif);
  font-size: clamp(2rem, 4vw, 2.6rem);
  font-weight: 700;
  color: var(--pp-gold);
  font-variant-numeric: tabular-nums;
}

.pp-wallet-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  color: var(--pp-muted);
  font-size: 0.8rem;
}

.pp-wallet-hero__meta .is-frozen {
  color: #f0b453;
}

.pp-redeem {
  margin-top: 18px;
  padding: 20px 22px;
  border: 1px solid var(--pp-hairline);
  border-left: 2px solid rgba(143, 216, 210, 0.55);
  background: rgba(255, 255, 255, 0.014);
}

.pp-redeem__head h3 {
  margin: 0;
  font-family: var(--pp-serif);
  font-size: 1.02rem;
  letter-spacing: 0.05em;
}

.pp-redeem__head p {
  margin: 6px 0 0;
  color: var(--pp-muted);
  font-size: 0.8rem;
}

.pp-redeem__form {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.pp-redeem__input {
  flex: 1;
  min-width: 0;
  padding: 11px 14px;
  border: 1px solid var(--pp-hairline);
  border-radius: 0;
  background: rgba(0, 0, 0, 0.28);
  color: inherit;
  font-family: var(--pp-mono);
  font-size: 0.86rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pp-redeem__input::placeholder {
  color: var(--pp-faint);
  text-transform: none;
}

.pp-redeem__input:focus {
  outline: none;
  border-color: rgba(226, 201, 143, 0.5);
}

.pp-ledger {
  margin-top: 22px;
}

.pp-ledger__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.pp-ledger__head h3 {
  margin: 0;
  font-family: var(--pp-serif);
  font-size: 1.02rem;
  letter-spacing: 0.05em;
}

.pp-ledger__error {
  color: var(--pp-danger);
  font-size: 0.76rem;
}

.pp-ledger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--pp-hairline);
}

.pp-ledger-list li {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.pp-ledger__main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 0.88rem;
}

.pp-ledger-list small {
  display: block;
  margin-top: 4px;
  color: var(--pp-faint);
  font-size: 0.74rem;
}

.is-income {
  color: var(--pp-cyan);
  font-variant-numeric: tabular-nums;
}

.is-spend {
  color: var(--pp-danger);
  font-variant-numeric: tabular-nums;
}

/* —— 弹层 —— */
.pp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3600;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 5, 10, 0.82);
  backdrop-filter: blur(10px);
}

.pp-preview {
  width: min(880px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  border: 1px solid rgba(226, 201, 143, 0.22);
  background: #0f111a;
  padding: 18px 20px;
}

.pp-preview header,
.pp-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.pp-preview header strong,
.pp-dialog header strong {
  font-family: var(--pp-serif);
  font-size: 1.02rem;
  letter-spacing: 0.06em;
}

.pp-preview header button,
.pp-dialog header button {
  border: none;
  background: transparent;
  color: var(--pp-muted);
  cursor: pointer;
}

.pp-preview__media {
  display: grid;
  gap: 12px;
}

.pp-preview__media img {
  width: 100%;
}

.pp-preview__prompt {
  margin: 14px 0 0;
  font-size: 0.82rem;
  color: var(--pp-muted);
  line-height: 1.7;
}

.pp-dialog {
  width: min(440px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  display: grid;
  gap: 14px;
  border: 1px solid rgba(226, 201, 143, 0.22);
  background: #0f111a;
  padding: 18px 20px 20px;
}

.pp-dialog header {
  margin-bottom: 0;
}

.pp-dialog__cover {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}

.pp-dialog label {
  display: grid;
  gap: 6px;
}

.pp-dialog label span {
  font-size: 0.76rem;
  color: var(--pp-faint);
}

.pp-dialog input,
.pp-dialog select {
  padding: 10px 12px;
  border: 1px solid var(--pp-hairline);
  border-radius: 0;
  background: rgba(0, 0, 0, 0.28);
  color: inherit;
  outline: none;
}

.pp-dialog input:focus,
.pp-dialog select:focus {
  border-color: rgba(226, 201, 143, 0.5);
}

.pp-dialog select option {
  color: #eceaf2;
  background: #0f111a;
}

.pp-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.spin {
  animation: pp-spin 1s linear infinite;
}

@keyframes pp-spin {
  to {
    transform: rotate(360deg);
  }
}

/* —— 响应式 —— */
@media (max-width: 640px) {
  .pp-masthead {
    grid-template-columns: 1fr;
  }

  .pp-masthead__spine {
    display: none;
  }

  .pp-redeem__form {
    flex-direction: column;
  }

  .pp-tabs button {
    margin-right: 18px;
    padding-right: 4px;
  }
}
</style>
<style scoped src="./ProfileView.modern.css"></style>
