<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  deleteMyGallerySubmission,
  getMySubscription,
  getOverview,
  getWallet,
  listMyGallerySubmissions,
  listNotifications,
  listWalletLedger,
  markNotificationsRead,
  redeemWalletCode,
  updateProfile,
} from '@/services/meApi'
import { deleteTask, listTasks, TASK_TYPE_LABELS } from '@/services/tasksApi'
import { listGalleryCategories, submitShareItem } from '@/services/shareGallery'
import { formatCents, getOrder, listOrders } from '@/services/billingApi'
import notificationService from '@/services/notification'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const TAB_IDS = ['works', 'submissions', 'orders', 'wallet', 'notifications', 'account']
const TABS = [
  { id: 'works', label: '我的作品', mono: 'Works', icon: 'bi-images' },
  { id: 'submissions', label: '我的投稿', mono: 'Gallery', icon: 'bi-send-check' },
  { id: 'orders', label: '订单', mono: 'Orders', icon: 'bi-receipt' },
  { id: 'wallet', label: '钱包', mono: 'Wallet', icon: 'bi-wallet2' },
  { id: 'notifications', label: '通知', mono: 'Inbox', icon: 'bi-bell' },
  { id: 'account', label: '账号设置', mono: 'Account', icon: 'bi-person-gear' },
]

function resolveTab(value) {
  const tab = String(value || '').trim()
  return TAB_IDS.includes(tab) ? tab : 'works'
}

const activeTab = ref(resolveTab(route.query.tab))

// ---- 总览 ----
const overview = ref(null)
const unreadCount = computed(() => Number(overview.value?.unreadNotifications || 0))
const taskStats = computed(() => overview.value?.taskStats || {})
const successRate = computed(() => {
  const total = Number(taskStats.value.total || 0)
  if (!total) return '—'
  return `${Math.round((Number(taskStats.value.succeeded || 0) / total) * 100)}%`
})
const typeStatRows = computed(() => {
  const byType = overview.value?.taskStatsByType || {}
  return Object.entries(TASK_TYPE_LABELS)
    .map(([type, label]) => ({ type, label, count: Number(byType[type] || 0) }))
    .filter((row) => row.count > 0)
})

// ---- 订阅（接口 404 时为 null，不显示徽标） ----
const subscription = ref(null)
const hasActiveSubscription = computed(() => subscription.value?.active === true)

// ---- 我的作品（任务列表） ----
const tasks = ref([])
const tasksLoading = ref(false)
const tasksCursor = ref(null)
const taskTypeFilter = ref('')
const previewTask = ref(null)
const deletingTaskId = ref('')
const submittingTaskId = ref('')

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

// ---- 订单 ----
const orders = ref([])
const ordersLoading = ref(false)
const ordersCursor = ref(null)
const ordersLoaded = ref(false)
const ordersError = ref('')
const activeOrder = ref(null)
let orderPollTimer = null

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
const profileForm = reactive({ username: '', saving: false })
const passwordForm = reactive({ old: '', next: '', confirm: '', saving: false })

const TASK_STATUS_LABELS = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

const SUBMISSION_STATUS_LABELS = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  removed: '已下架',
}

const ORDER_STATUS_LABELS = {
  pending: '等待支付',
  paid: '已支付',
  completed: '已完成',
  failed: '失败',
  expired: '已过期',
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

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '未知'
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

function formatDay(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('zh-CN')
}

async function loadOverview() {
  try {
    overview.value = await getOverview()
  } catch {
    /* 静默失败 */
  }
}

async function loadSubscription() {
  try {
    subscription.value = await getMySubscription()
  } catch {
    /* 静默失败：不显示会员徽标 */
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

async function loadOrders({ append = false } = {}) {
  if (ordersLoading.value) return
  ordersLoading.value = true
  ordersError.value = ''
  try {
    const { items, nextCursor } = await listOrders({
      limit: 12,
      cursor: append ? ordersCursor.value || '' : '',
    })
    orders.value = append ? [...orders.value, ...items] : items
    ordersCursor.value = nextCursor
    ordersLoaded.value = true
    const pending = orders.value.find((item) => item.status === 'pending')
    if (pending) startOrderPolling(pending.id)
  } catch (error) {
    ordersError.value = error?.message || '订单列表读取失败'
  } finally {
    ordersLoading.value = false
  }
}

function stopOrderPolling() {
  if (orderPollTimer) {
    clearInterval(orderPollTimer)
    orderPollTimer = null
  }
}

function startOrderPolling(orderId) {
  if (!orderId) return
  stopOrderPolling()
  orderPollTimer = setInterval(async () => {
    try {
      const order = await getOrder(orderId)
      activeOrder.value = order
      const index = orders.value.findIndex((item) => item.id === order.id)
      if (index >= 0) orders.value[index] = { ...orders.value[index], ...order }
      if (['completed', 'failed', 'expired'].includes(order?.status)) {
        stopOrderPolling()
        if (order.status === 'completed') {
          notificationService.success('订单已完成，余额已入账')
          await Promise.all([loadOverview(), loadWallet(), loadLedger()])
        }
      }
    } catch {
      /* 下一轮重试 */
    }
  }, 3000)
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
  if (tabId === 'submissions' && !submissionsLoaded.value) void loadSubmissions()
  if (tabId === 'orders' && !ordersLoaded.value) void loadOrders()
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
  if (!window.confirm('删除后任务记录与产物都会移除，确定删除？')) return
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
  submitDialog.title = task.prompt?.slice(0, 40) || 'AI 作品'
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
  if (!window.confirm('确定撤回/删除该投稿？')) return
  try {
    await deleteMyGallerySubmission(submission.id)
    submissions.value = submissions.value.filter((item) => item.id !== submission.id)
    notificationService.success('投稿已删除')
  } catch (error) {
    notificationService.error(error?.message || '删除失败')
  }
}

async function saveUsername() {
  const username = profileForm.username.trim()
  if (!username) {
    notificationService.warning('用户名不能为空')
    return
  }
  profileForm.saving = true
  try {
    await updateProfile({ username })
    authStore.patchUser({ username })
    notificationService.success('用户名已更新')
  } catch (error) {
    notificationService.error(error?.message || '保存失败')
  } finally {
    profileForm.saving = false
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
  await authStore.logout()
  router.push('/')
}

onMounted(async () => {
  await authStore.initAuth().catch(() => null)
  profileForm.username = authStore.user?.username || ''
  void loadOverview()
  void loadSubscription()
  void loadTasks()
  ensureTabData(activeTab.value)
})

onBeforeUnmount(() => stopOrderPolling())
</script>

<template>
  <div class="pp-page">
    <div class="pp-atmosphere" aria-hidden="true"></div>

    <!-- 馆主档案页头 -->
    <header class="pp-masthead">
      <div class="pp-masthead__spine" aria-hidden="true">
        <span>Curator Profile</span>
        <i></i>
        <em>SC</em>
      </div>
      <div class="pp-masthead__body">
        <p class="pp-eyebrow">StarCloud Curator <i></i> 馆主档案</p>
        <h1 class="pp-name">
          <span class="pp-avatar">
            <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" alt="头像" />
            <i v-else class="bi bi-person-fill"></i>
          </span>
          <span class="pp-name__text">{{ authStore.displayName }}</span>
          <span v-if="hasActiveSubscription" class="pp-member" :title="subscription.planName || '订阅会员'">
            <i class="bi bi-patch-check-fill" aria-hidden="true"></i>
            {{ subscription.planName || '会员' }} · 至 {{ formatDay(subscription.endsAt) }}
          </span>
        </h1>
        <div class="pp-idline">
          <span>{{ authStore.user?.email }}</span>
          <i aria-hidden="true"></i>
          <span>注册于 {{ formatTime(authStore.user?.createdAt) }}</span>
        </div>
        <div class="pp-masthead__actions">
          <button type="button" class="pp-btn is-ghost" @click="switchTab('account')">
            <i class="bi bi-pencil-square"></i> 编辑资料 / 改密
          </button>
          <button type="button" class="pp-btn is-text" @click="handleLogout">
            <i class="bi bi-box-arrow-right"></i> 退出登录
          </button>
        </div>
      </div>
    </header>

    <!-- 四张数据卡 -->
    <section class="pp-stats" aria-label="账号数据">
      <article>
        <span class="pp-stats__label">Balance · 可用余额</span>
        <strong class="pp-stats__value is-gold">{{
          formatCents(
            Math.max(
              0,
              Number(overview?.wallet?.balanceCents || 0) -
                Number(overview?.wallet?.frozenCents || 0),
            ),
          )
        }}</strong>
        <div class="pp-stats__actions">
          <button type="button" class="pp-stats__foot is-link" @click="switchTab('wallet')">
            钱包 / 兑换码 →
          </button>
          <RouterLink class="pp-stats__foot" to="/pricing">去充值 →</RouterLink>
        </div>
      </article>
      <article>
        <span class="pp-stats__label">Tasks · 任务总数</span>
        <strong class="pp-stats__value">{{ taskStats.total ?? '—' }}</strong>
        <small class="pp-stats__foot">进行中 {{ taskStats.running || 0 }}</small>
      </article>
      <article>
        <span class="pp-stats__label">Rate · 成功率</span>
        <strong class="pp-stats__value">{{ successRate }}</strong>
        <small class="pp-stats__foot">
          成功 {{ taskStats.succeeded || 0 }} / 失败 {{ taskStats.failed || 0 }}
        </small>
      </article>
      <article>
        <span class="pp-stats__label">Inbox · 未读通知</span>
        <strong class="pp-stats__value">{{ unreadCount }}</strong>
        <button type="button" class="pp-stats__foot is-link" @click="switchTab('notifications')">
          查看通知 →
        </button>
      </article>
    </section>

    <div v-if="typeStatRows.length" class="pp-type-chips">
      <span v-for="row in typeStatRows" :key="row.type" class="pp-type-chip">
        {{ row.label }} × {{ row.count }}
      </span>
    </div>

    <!-- Tab 导航 -->
    <nav class="pp-tabs" aria-label="个人中心分区">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        :class="{ 'is-active': activeTab === tab.id }"
        @click="switchTab(tab.id)"
      >
        <small>{{ tab.mono }}</small>
        <span>
          {{ tab.label }}
          <em v-if="tab.id === 'notifications' && unreadCount > 0">{{ unreadCount }}</em>
        </span>
      </button>
    </nav>

    <!-- 我的作品 -->
    <section v-show="activeTab === 'works'" class="pp-panel">
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

      <div v-if="tasks.length" class="pp-works-grid">
        <article v-for="(task, index) in tasks" :key="task.id" class="pp-work">
          <button
            type="button"
            class="pp-work__cover"
            :disabled="!task.outputUrls?.length"
            @click="previewTask = task"
          >
            <img
              v-if="task.outputUrls?.length"
              :src="task.outputUrls[0]"
              :alt="task.prompt || 'AI 作品'"
              loading="lazy"
            />
            <span v-else class="pp-work__placeholder">
              <i
                class="bi"
                :class="task.status === 'failed' ? 'bi-x-circle' : 'bi-hourglass-split'"
              ></i>
              {{ TASK_STATUS_LABELS[task.status] || task.status }}
            </span>
            <span class="pp-work__mark">No.{{ String(index + 1).padStart(2, '0') }}</span>
          </button>
          <div class="pp-work__meta">
            <span class="pp-work__type">{{ TASK_TYPE_LABELS[task.type] || task.type }}</span>
            <span class="pp-work__status" :data-status="task.status">
              {{ TASK_STATUS_LABELS[task.status] || task.status }}
            </span>
          </div>
          <p class="pp-work__prompt" :title="task.prompt">{{ task.prompt || '（无提示词）' }}</p>
          <small class="pp-work__caption">
            {{ formatTime(task.createdAt) }} · {{ formatCents(task.costCents) }}
          </small>
          <div class="pp-work__actions">
            <button
              v-if="task.status === 'succeeded' && task.outputUrls?.length"
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
      <p v-else-if="!tasksLoading" class="pp-empty">还没有创作记录，去工作台生成第一张图吧。</p>

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

    <!-- 我的投稿 -->
    <section v-show="activeTab === 'submissions'" class="pp-panel">
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

    <!-- 订单 -->
    <section v-show="activeTab === 'orders'" class="pp-panel">
      <header class="pp-panel-head">
        <div>
          <h2>我的订单</h2>
          <p>订阅与充值订单状态，待支付订单会自动刷新。</p>
        </div>
        <RouterLink class="pp-btn is-ghost" to="/pricing">去价格页购买</RouterLink>
      </header>

      <div v-if="ordersLoading && !ordersLoaded" class="pp-skel-list" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="pp-skel-row"></div>
      </div>

      <div v-else-if="ordersError && !orders.length" class="pp-state is-error">
        <strong>订单加载失败</strong>
        <p>{{ ordersError }}</p>
        <button type="button" class="pp-btn is-ghost" @click="loadOrders()">重试</button>
      </div>

      <ul v-else-if="orders.length" class="pp-order-list">
        <li v-for="order in orders" :key="order.id">
          <div class="pp-order__main">
            <strong class="pp-order__amount">{{ formatCents(order.amountCents) }}</strong>
            <span class="pp-order__status" :data-status="order.status">
              {{ orderStatusLabel(order.status) }}
            </span>
          </div>
          <div class="pp-order__meta">
            <span>{{ order.planName || order.planId || '套餐订单' }}</span>
            <span>{{ formatTime(order.createdAt) }}</span>
          </div>
          <p v-if="order.id === activeOrder?.id && activeOrder.status === 'pending'" class="pp-order__hint">
            正在等待支付结果，完成后将自动入账…
          </p>
        </li>
      </ul>

      <div v-else-if="ordersLoaded" class="pp-state">
        <strong>还没有订单</strong>
        <p>去价格页购买订阅或充值包后，记录会出现在这里。</p>
        <RouterLink class="pp-btn is-primary" to="/pricing">去看看套餐</RouterLink>
      </div>

      <button
        v-if="ordersCursor"
        type="button"
        class="pp-btn is-ghost pp-load-more"
        :disabled="ordersLoading"
        @click="loadOrders({ append: true })"
      >
        {{ ordersLoading ? '加载中…' : '加载更多' }}
      </button>
    </section>

    <!-- 钱包：余额 + 兑换码 + 账本 -->
    <section v-show="activeTab === 'wallet'" class="pp-panel">
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
            <span class="pp-wallet-hero__label">Available · 可用余额</span>
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
                  {{ Number(entry.deltaCents) >= 0 ? '+' : '' }}{{ formatCents(entry.deltaCents) }}
                </strong>
              </div>
              <small>
                {{ formatTime(entry.createdAt) }} · 余额 {{ formatCents(entry.balanceAfterCents) }}
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
    <section v-show="activeTab === 'notifications'" class="pp-panel">
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
      <p v-else-if="notificationsLoaded && !notificationsLoading" class="pp-empty">暂无通知。</p>
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
    <section v-show="activeTab === 'account'" class="pp-panel">
      <div class="pp-account-forms">
        <form class="pp-account-form" @submit.prevent="saveUsername">
          <h3><i class="bi bi-person-badge"></i> 修改用户名</h3>
          <label>
            <span>用户名</span>
            <input v-model="profileForm.username" maxlength="24" placeholder="输入新的用户名" />
          </label>
          <button type="submit" class="pp-btn is-primary" :disabled="profileForm.saving">
            {{ profileForm.saving ? '保存中…' : '保存' }}
          </button>
        </form>

        <form class="pp-account-form" @submit.prevent="savePassword">
          <h3><i class="bi bi-shield-lock"></i> 修改密码</h3>
          <label>
            <span>当前密码</span>
            <input v-model="passwordForm.old" type="password" autocomplete="current-password" />
          </label>
          <label>
            <span>新密码（至少 8 位）</span>
            <input v-model="passwordForm.next" type="password" autocomplete="new-password" />
          </label>
          <label>
            <span>确认新密码</span>
            <input v-model="passwordForm.confirm" type="password" autocomplete="new-password" />
          </label>
          <button type="submit" class="pp-btn is-primary" :disabled="passwordForm.saving">
            {{ passwordForm.saving ? '保存中…' : '更新密码' }}
          </button>
        </form>
      </div>
    </section>

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

    <!-- 产物大图预览 -->
    <Teleport to="body">
      <div v-if="previewTask" class="pp-backdrop" @click.self="previewTask = null">
        <div class="pp-preview">
          <header>
            <strong>{{ TASK_TYPE_LABELS[previewTask.type] || previewTask.type }}</strong>
            <button type="button" aria-label="关闭" @click="previewTask = null">
              <i class="bi bi-x-lg"></i>
            </button>
          </header>
          <div class="pp-preview__media">
            <a
              v-for="(url, index) in previewTask.outputUrls"
              :key="index"
              :href="url"
              target="_blank"
              rel="noopener"
            >
              <img :src="url" :alt="`产物 ${index + 1}`" />
            </a>
          </div>
          <p class="pp-preview__prompt">{{ previewTask.prompt }}</p>
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
