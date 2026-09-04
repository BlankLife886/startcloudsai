<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleClose, Search, Unlock, Wallet } from '@element-plus/icons-vue'
import AdminDialog from '@/components/AdminDialog.vue'
import RegistrationSettingsDialog from '@/components/settings/RegistrationSettingsDialog.vue'
import UserProfilePanel from '@/components/UserProfilePanel.vue'
import UserProfileRulesDialog from '@/components/UserProfileRulesDialog.vue'
import UserAnalyticsDrawer from '@/components/UserAnalyticsDrawer.vue'
import { normalizeList, request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import {
  formatProfileMoney,
  lifecycleLabels,
  profileTagLabels,
  workspaceLabels,
  type UserProfileDetail,
  type UserProfileMetrics,
} from '@/userProfile'
import {
  adminMediaUrl,
  formatPoints,
  formatShortTime,
  formatTime,
  ledgerKindLabel,
  ledgerReasonLabel,
  TASK_STATUS_LABELS,
  taskTypeLabel,
} from '@/utils'

interface UserUsage {
  tasksTotal: number
  tasksSucceeded: number
  tasksFailed: number
  tasksRunning: number
  tasksCanceled: number
  submissions: number
  assets: number
  orders: number
  feedback?: number
}

interface UserWallet {
  balanceCents: number
  frozenCents: number
  normalBalanceCents?: number
  trialBalanceCents?: number
  normalFrozenCents?: number
  trialFrozenCents?: number
  trialFeatureKey?: string | null
  trialFeatureLabel?: string | null
}

interface UserSubscription {
  active: boolean
  planId?: string
  planName?: string
  planCode?: string
  startsAt?: string | null
  endsAt?: string | null
  dailyGrantCents?: number
  grantedToday?: boolean
}

interface UserTrialAccess {
  id: string
  status: string
  occupation?: string
  rewardCents?: number | null
  rewardStatus?: string | null
  rewardClaimedAt?: string | null
  reviewedAt?: string | null
  features?: { key: string; label: string }[]
  feature?: { key: string; label: string } | null
}

interface UserCheckin {
  totalDays: number
  streak?: number
  cycleDay?: number
  lastDate?: string
  lastRewardCents?: number
}

interface UserGrowthGroup {
  id: string
  code: string
  status: string
  role: string
  memberCount: number
  targetMembers: number
  rewardCents: number
  expiresAt?: string | null
  completedAt?: string | null
}

interface AdminUser {
  id: string
  email: string
  username: string | null
  avatarUrl?: string | null
  bio?: string
  location?: string
  websiteUrl?: string
  requireCostConfirm?: boolean
  status: string
  lastLoginAt?: string | null
  submissionBannedUntil?: string | null
  wallet?: UserWallet
  /** 兼容旧版接口。 */
  balanceCents?: number
  createdAt: string
  usage?: UserUsage
  profile?: UserProfileMetrics | null
  subscription?: { active?: boolean } | null
  lastSessionIp?: string | null
}

function displayName(user: AdminUser | null | undefined) {
  return String(user?.username || user?.email || '未知用户').trim()
}

/** 列表展示：前 2 + … + 后 2；过短时原样返回 */
function maskedDisplayName(user: AdminUser | null | undefined) {
  const name = displayName(user)
  if (name.length <= 4) return name
  return `${name.slice(0, 2)}...${name.slice(-2)}`
}

function avatarInitial(user: AdminUser | null | undefined) {
  return displayName(user).slice(0, 1).toUpperCase() || '?'
}

/** 头像加载失败时回退到首字母占位 */
const brokenAvatars = ref(new Set<string>())

function avatarBroken(id: string) {
  if (brokenAvatars.value.has(id)) return
  const next = new Set(brokenAvatars.value)
  next.add(id)
  brokenAvatars.value = next
}

function showAvatar(user: AdminUser | null | undefined) {
  const url = String(user?.avatarUrl || '').trim()
  return Boolean(url && user?.id && !brokenAvatars.value.has(user.id))
}

function walletListParts(user: AdminUser) {
  const wallet = walletOf(user)
  return {
    normal: formatPoints(wallet.normalBalanceCents),
    trial: formatPoints(wallet.trialBalanceCents),
    frozen: formatPoints(wallet.frozenCents),
    total: formatPoints(wallet.balanceCents + wallet.frozenCents),
  }
}

function walletOf(user: AdminUser | null | undefined): UserWallet {
  return {
    balanceCents: user?.wallet?.balanceCents ?? user?.balanceCents ?? 0,
    frozenCents: user?.wallet?.frozenCents ?? 0,
    normalBalanceCents: user?.wallet?.normalBalanceCents ?? user?.wallet?.balanceCents ?? user?.balanceCents ?? 0,
    trialBalanceCents: user?.wallet?.trialBalanceCents ?? 0,
    normalFrozenCents: user?.wallet?.normalFrozenCents ?? 0,
    trialFrozenCents: user?.wallet?.trialFrozenCents ?? 0,
    trialFeatureKey: user?.wallet?.trialFeatureKey ?? null,
    trialFeatureLabel: user?.wallet?.trialFeatureLabel ?? null,
  }
}

function isSubmissionBanned(user: AdminUser | null | undefined) {
  if (!user?.submissionBannedUntil) return false
  return new Date(user.submissionBannedUntil).getTime() > Date.now()
}

function userStatusMeta(user: AdminUser | null | undefined) {
  if (user?.status === 'banned') return { label: '已封禁', tone: 'danger' as const }
  if (isSubmissionBanned(user)) return { label: '禁投稿', tone: 'warning' as const }
  return { label: '正常', tone: 'success' as const }
}

function lifecycleTone(lifecycle?: string) {
  if (lifecycle === 'active' || lifecycle === 'returned') return 'success'
  if (lifecycle === 'churn_risk') return 'warning'
  if (lifecycle === 'new' || lifecycle === 'activated') return 'info'
  return 'neutral'
}

function profileTagText(profile: UserProfileMetrics) {
  const tags = profile.tags
    .slice(0, 2)
    .map((tag) => profileTagLabels[tag] || tag)
    .filter(Boolean)
  return tags.join(' · ') || workspaceLabels[profile.primaryWorkspace] || '暂无偏好'
}

function lastActiveLabel(user: AdminUser) {
  const value = user.profile?.lastActivityAt || user.lastLoginAt || ''
  return value ? formatShortTime(value) : '暂无活动'
}

function websiteHref(value: string | null | undefined) {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url : ''
}

const filters = reactive({ search: '', status: '', lifecycle: '', risk: '', profileTag: '' })

const lifecycleOptions = Object.entries(lifecycleLabels).map(([value, label]) => ({ value, label }))
const profileTagOptions = Object.entries(profileTagLabels).map(([value, label]) => ({ value, label }))

const statusTabs = [
  { label: '全部', value: '' },
  { label: '正常', value: 'active' },
  { label: '已封禁', value: 'banned' },
] as const

const currentPage = ref(1)
const pageSize = ref(20)
const { items, loading, error, total, reset, refresh, retry } =
  usePagedList<AdminUser>(
    () =>
      request<Page<AdminUser>>('/api/v1/admin/users', {
        query: {
          search: filters.search,
          status: filters.status,
          lifecycle: filters.lifecycle,
          risk: filters.risk,
          profileTag: filters.profileTag,
          limit: pageSize.value,
          page: currentPage.value,
        },
      }).then(normalizeList),
    () => ({ ...filters, limit: pageSize.value, page: currentPage.value }),
  )

const listCount = computed(() => items.value.length)
const listTotal = computed(() => total.value ?? listCount.value)

function changePage(value: number) {
  if (value === currentPage.value) return
  currentPage.value = value
  reset()
}

function changePageSize(value: number) {
  pageSize.value = value
  currentPage.value = 1
  reset()
}

function queryUsers() {
  currentPage.value = 1
  reset()
}

function setStatusTab(value: string) {
  if (filters.status === value) return
  filters.status = value
  queryUsers()
}

function clearFilters() {
  filters.search = ''
  filters.status = ''
  filters.lifecycle = ''
  filters.risk = ''
  filters.profileTag = ''
  queryUsers()
}

onMounted(queryUsers)

async function toggleBan(user: AdminUser) {
  const banning = user.status !== 'banned'
  await ElMessageBox.confirm(
    banning ? `确认封禁用户 ${user.email}？封禁后无法登录与提交任务。` : `确认解封用户 ${user.email}？`,
    banning ? '封禁用户' : '解封用户',
    { type: 'warning', confirmButtonText: banning ? '封禁' : '解封', cancelButtonText: '取消' },
  )
  await request(`/api/v1/admin/users/${user.id}`, {
    method: 'PATCH',
    body: { status: banning ? 'banned' : 'active' },
  })
  ElMessage.success(banning ? '已封禁' : '已解封')
  refresh()
  if (drawerVisible.value && drawerUser.value?.id === user.id) loadOverview()
}

// ---------- 调整余额对话框 ----------
const adjustVisible = ref(false)
const adjustTarget = ref<AdminUser | null>(null)
const adjustForm = reactive({ deltaPoints: 0, reason: '' })
const adjustSubmitting = ref(false)

const adjustCents = computed(() => Math.round(Number(adjustForm.deltaPoints || 0)))

function openAdjust(user: AdminUser) {
  adjustTarget.value = user
  adjustForm.deltaPoints = 0
  adjustForm.reason = ''
  adjustVisible.value = true
}

async function submitAdjust() {
  if (!adjustTarget.value) return
  if (adjustCents.value === 0) {
    ElMessage.warning('调整积分不能为 0')
    return
  }
  if (!adjustForm.reason.trim()) {
    ElMessage.warning('请填写调整原因')
    return
  }
  adjustSubmitting.value = true
  try {
    await request(`/api/v1/admin/users/${adjustTarget.value.id}/wallet/entries`, {
      method: 'POST',
      body: { deltaCents: adjustCents.value, reason: adjustForm.reason.trim() },
    })
    ElMessage.success('积分调整成功')
    adjustVisible.value = false
    refresh()
    if (drawerVisible.value && drawerUser.value?.id === adjustTarget.value.id) {
      loadOverview()
      if (loadedTabs.has('ledger')) ledgerList.refresh()
    }
  } finally {
    adjustSubmitting.value = false
  }
}

// ---------- 用户详情抽屉 ----------
interface UserDetail {
  user: AdminUser
  wallet: UserWallet
  subscription?: UserSubscription | null
  trialAccess?: UserTrialAccess | null
  checkin?: UserCheckin | null
  growthGroup?: UserGrowthGroup | null
  counts: {
    orders: number
    tasksTotal: number
    tasksSucceeded: number
    tasksFailed: number
    tasksRunning: number
    tasksCanceled: number
    submissions: number
    assets: number
    feedback?: number
  }
  security: {
    activeSessions: number
    lastSessionIp: string | null
    lastSessionUserAgent: string | null
    lastSessionAt: string | null
    lastSessionExpiresAt: string | null
  }
  profile: UserProfileDetail
}

interface LedgerEntry {
  id: string
  kind: string
  deltaCents: number
  balanceAfterCents: number
  sourceType: string | null
  sourceId: string | null
  reason: string | null
  createdAt: string
  task?: {
    displayName?: string
    source?: string
    type?: string
  } | null
}

interface UserTask {
  id: string
  type: string
  model?: string
  status: string
  attempt?: number
  costCents: number
  errorMessage?: string | null
  createdAt: string
  source?: string
  params?: Record<string, unknown> | null
}

const router = useRouter()
const drawerVisible = ref(false)
const drawerUser = ref<AdminUser | null>(null)
const activeTab = ref('overview')
/** 已加载过的懒加载 Tab（账本/任务），换用户后清空 */
const loadedTabs = new Set<string>()

const overviewLoading = ref(false)
const overview = ref<UserDetail | null>(null)
const profileRefreshing = ref(false)

const ledgerPageSize = ref(20)
const taskPageSize = ref(20)

const ledgerList = usePagedList<LedgerEntry>(
  (cursor) =>
    request<Page<LedgerEntry>>(`/api/v1/admin/users/${drawerUser.value?.id}/wallet/entries`, {
      query: { limit: ledgerPageSize.value, cursor },
    }),
  () => `${drawerUser.value?.id ?? ''}:${ledgerPageSize.value}`,
)

const taskList = usePagedList<UserTask>(
  (cursor) =>
    request<Page<UserTask>>('/api/v1/admin/tasks', {
      query: { user: drawerUser.value?.id, limit: taskPageSize.value, cursor },
    }),
  () => `${drawerUser.value?.id ?? ''}:${taskPageSize.value}`,
)

async function loadOverview() {
  if (!drawerUser.value) return
  overviewLoading.value = true
  try {
    overview.value = await request<UserDetail>(`/api/v1/admin/users/${drawerUser.value.id}`)
  } finally {
    overviewLoading.value = false
  }
}

async function refreshProfile() {
  if (!drawerUser.value || !overview.value) return
  profileRefreshing.value = true
  try {
    overview.value.profile = await request<UserProfileDetail>(
      `/api/v1/admin/users/${drawerUser.value.id}/profile/refresh`,
      { method: 'POST' },
    )
    const listed = items.value.find((item) => item.id === drawerUser.value?.id)
    if (listed) listed.profile = overview.value.profile.metrics
    ElMessage.success('用户画像已重新计算')
  } finally {
    profileRefreshing.value = false
  }
}

function openDrawer(user: AdminUser) {
  drawerUser.value = user
  overview.value = null
  loadedTabs.clear()
  activeTab.value = 'overview'
  drawerVisible.value = true
  loadOverview()
}

watch(activeTab, (tab) => {
  if (!drawerVisible.value || tab === 'overview' || loadedTabs.has(tab)) return
  loadedTabs.add(tab)
  if (tab === 'ledger') ledgerList.reset()
  else if (tab === 'tasks') taskList.reset()
})

/** 抽屉里展示的用户（概览接口返回后以其为准） */
const drawerUserInfo = computed(() => overview.value?.user ?? drawerUser.value)
const drawerWallet = computed(() => overview.value?.wallet ?? walletOf(drawerUserInfo.value))
const taskSuccessRate = computed(() => {
  const counts = overview.value?.counts
  if (!counts?.tasksTotal) return 0
  return Math.round((counts.tasksSucceeded / counts.tasksTotal) * 100)
})

function openDrawerTab(tab: 'ledger' | 'tasks') {
  activeTab.value = tab
}

function openRelatedPage(path: string, search?: string) {
  void router.push({ path, query: search ? { search } : undefined })
}

function trialFeatureLabels(trial: UserTrialAccess | null | undefined) {
  const features = trial?.features?.length
    ? trial.features
    : trial?.feature
      ? [trial.feature]
      : []
  const labels = features.map((item) => item.label || item.key).filter(Boolean)
  return labels.length ? labels.join('、') : '-'
}

function trialStatusLabel(status?: string | null) {
  if (status === 'pending') return '待审核'
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '未通过'
  return '未申请'
}

function trialRewardLabel(trial: UserTrialAccess | null | undefined) {
  if (!trial || trial.status !== 'approved') return '-'
  const points = trial.rewardCents != null ? `${formatPoints(trial.rewardCents)} 积分` : ''
  if (trial.rewardStatus === 'redeemed') return points ? `已领取 ${points}` : '已领取'
  if (trial.rewardStatus === 'expired') return '已过期'
  if (trial.rewardStatus === 'active') return points ? `待领取 ${points}` : '待领取'
  return points || '-'
}

function checkinLabel(checkin: UserCheckin | null | undefined) {
  if (!checkin?.lastDate) return '未签到'
  return `连续 ${checkin.streak ?? 0} 天 · 最近 ${checkin.lastDate} · 共 ${checkin.totalDays} 次`
}

function growthStatusLabel(status?: string | null) {
  if (status === 'active') return '进行中'
  if (status === 'completed') return '已成团'
  if (status === 'expired') return '已过期'
  return status || '未参与'
}

function growthLabel(group: UserGrowthGroup | null | undefined) {
  if (!group) return '未参与'
  const role = group.role === 'owner' ? '团长' : '成员'
  return `${growthStatusLabel(group.status)} · ${role} · ${group.memberCount}/${group.targetMembers} · ${group.code}`
}

</script>

<template>
  <div class="users-page">
    <PageCard title="用户管理" subtitle="查看账号资料、资金状态、使用情况与安全信息">
      <div class="users-toolbar">
        <div class="status-tabs" role="tablist" aria-label="账号状态">
          <button
            v-for="tab in statusTabs"
            :key="tab.label"
            type="button"
            role="tab"
            class="status-tab"
            :class="{ 'is-active': filters.status === tab.value }"
            :aria-selected="filters.status === tab.value"
            @click="setStatusTab(tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="users-toolbar__actions">
          <el-select
            v-model="filters.lifecycle"
            class="profile-filter"
            placeholder="生命周期"
            clearable
            @change="queryUsers"
          >
            <el-option v-for="option in lifecycleOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-select
            v-model="filters.risk"
            class="profile-filter"
            placeholder="风险"
            clearable
            @change="queryUsers"
          >
            <el-option label="状态正常" value="low" />
            <el-option label="需关注" value="medium" />
            <el-option label="高风险" value="high" />
          </el-select>
          <el-select
            v-model="filters.profileTag"
            class="profile-filter is-wide"
            placeholder="画像标签"
            clearable
            @change="queryUsers"
          >
            <el-option v-for="option in profileTagOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <UserAnalyticsDrawer />
          <UserProfileRulesDialog />
          <RegistrationSettingsDialog />
          <el-input
            v-model="filters.search"
            class="users-search"
            placeholder="搜索邮箱 / 用户名"
            clearable
            :prefix-icon="Search"
            @keyup.enter="queryUsers"
            @clear="queryUsers"
          />
          <el-button @click="queryUsers">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
        </div>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="users-board"
        fill
        :has-prev="currentPage > 1"
        :has-next="currentPage * pageSize < listTotal"
        :loading="loading"
        :page="currentPage"
        :count="listCount"
        :total="listTotal"
        :page-size="pageSize"
        @update:page="changePage"
        @update:page-size="changePageSize"
      >
        <div class="users-table-shell">
          <el-table
            v-loading="loading"
            class="users-table"
            :data="items"
            height="100%"
            size="small"
            table-layout="fixed"
            row-class-name="row-clickable"
            @row-click="(row: AdminUser) => openDrawer(row)"
          >
            <template #empty>
              <el-empty description="暂无用户" :image-size="60">
                <div class="empty-sub">调整筛选条件后重新查询</div>
              </el-empty>
            </template>

            <el-table-column label="用户" min-width="248">
              <template #default="{ row }">
                <button
                  type="button"
                  class="user-cell"
                  :title="`${displayName(row as AdminUser)} · ${row.email}`"
                  @click.stop="openDrawer(row as AdminUser)"
                >
                  <span class="user-avatar" :class="{ 'has-image': showAvatar(row as AdminUser) }">
                    <img
                      v-if="showAvatar(row as AdminUser)"
                      :src="adminMediaUrl(row.avatarUrl)"
                      alt=""
                      @error="avatarBroken(row.id)"
                    />
                    <template v-else>{{ avatarInitial(row as AdminUser) }}</template>
                  </span>
                  <span class="user-meta">
                    <span class="user-meta__line">
                      <strong>{{ maskedDisplayName(row as AdminUser) }}</strong>
                      <span
                        class="badge"
                        :class="`badge--${userStatusMeta(row as AdminUser).tone}`"
                      >
                        {{ userStatusMeta(row as AdminUser).label }}
                      </span>
                    </span>
                    <span class="user-meta__email">{{ row.email }}</span>
                  </span>
                </button>
              </template>
            </el-table-column>

            <el-table-column label="任务" width="88" class-name="col-num col-group">
              <template #default="{ row }">
                <span class="tnum cell-num">{{ row.usage?.tasksTotal ?? 0 }}</span>
              </template>
            </el-table-column>

            <el-table-column label="成功 / 失败" width="108" class-name="col-num">
              <template #default="{ row }">
                <span class="pair-cell tnum">
                  <em>{{ row.usage?.tasksSucceeded ?? 0 }}</em>
                  <span class="pair-sep">/</span>
                  <em :class="{ 'is-fail': (row.usage?.tasksFailed ?? 0) > 0 }">
                    {{ row.usage?.tasksFailed ?? 0 }}
                  </em>
                </span>
              </template>
            </el-table-column>

            <el-table-column label="订阅" width="88" align="center">
              <template #default="{ row }">
                <span
                  class="badge"
                  :class="row.subscription?.active ? 'badge--success' : 'badge--neutral'"
                >
                  {{ row.subscription?.active ? '已订阅' : '未订阅' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="30日质量" width="140" class-name="col-num col-group">
              <template #default="{ row }">
                <div v-if="row.profile" class="metric-cell">
                  <strong class="tnum">{{ (row.profile.successRateBps30 / 100).toFixed(1) }}%</strong>
                  <small>{{ row.profile.successfulRuns30 }} 成功 / {{ row.profile.failedRuns30 }} 失败</small>
                </div>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>

            <el-table-column label="30日价值" width="128" class-name="col-num">
              <template #default="{ row }">
                <div v-if="row.profile" class="metric-cell">
                  <strong class="tnum">{{ formatProfileMoney(row.profile.revenueCents30) }}</strong>
                  <small :class="{ 'is-negative': row.profile.grossProfitCents30 < 0 }">
                    毛利 {{ formatProfileMoney(row.profile.grossProfitCents30) }}
                  </small>
                </div>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>

            <el-table-column label="普通" width="88" class-name="col-num col-group">
              <template #default="{ row }">
                <span class="tnum cell-num">{{ walletListParts(row as AdminUser).normal }}</span>
              </template>
            </el-table-column>
            <el-table-column label="体验" width="88" class-name="col-num">
              <template #default="{ row }">
                <span class="tnum cell-num">{{ walletListParts(row as AdminUser).trial }}</span>
              </template>
            </el-table-column>
            <el-table-column label="冻结" width="88" class-name="col-num">
              <template #default="{ row }">
                <span class="tnum cell-num">{{ walletListParts(row as AdminUser).frozen }}</span>
              </template>
            </el-table-column>
            <el-table-column label="合计" width="88" class-name="col-num">
              <template #default="{ row }">
                <span class="tnum cell-num">{{ walletListParts(row as AdminUser).total }}</span>
              </template>
            </el-table-column>

            <el-table-column label="最近活跃" width="120" class-name="col-group">
              <template #default="{ row }">
                <span class="cell-time tnum">{{ lastActiveLabel(row as AdminUser) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="注册时间" width="120">
              <template #default="{ row }">
                <span class="cell-time tnum">{{ formatShortTime(row.createdAt) }}</span>
              </template>
            </el-table-column>

            <el-table-column label="用户画像" width="168" class-name="col-group">
              <template #default="{ row }">
                <div v-if="row.profile" class="list-profile">
                  <span class="badge" :class="`badge--${lifecycleTone(row.profile.lifecycle)}`">
                    {{ lifecycleLabels[row.profile.lifecycle] || row.profile.lifecycle }}
                  </span>
                  <span class="list-profile__tags">{{ profileTagText(row.profile) }}</span>
                </div>
                <span v-else class="cell-muted">待计算</span>
              </template>
            </el-table-column>

            <el-table-column label="IP" width="118" class-name="col-ip">
              <template #default="{ row }">
                <span v-if="row.lastSessionIp" class="cell-ip mono" :title="row.lastSessionIp">
                  {{ row.lastSessionIp }}
                </span>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </AdminListShell>
    </PageCard>

    <!-- 调整余额 -->
    <AdminDialog
      v-model="adjustVisible"
      title="调整积分"
      subtitle="正数入账、负数扣减，记入钱包账本"
      :icon="Wallet"
      width="420px"
      footer-hint="单次范围 ±100000 积分"
      confirm-text="确认调整"
      :confirm-loading="adjustSubmitting"
      @confirm="submitAdjust"
    >
      <template v-if="adjustTarget" #meta>
        <span class="admin-dialog__chip tnum">
          当前 {{ formatPoints(walletOf(adjustTarget).balanceCents) }} 积分
        </span>
      </template>
      <el-form label-position="top" class="adjust-form">
        <el-form-item label="积分" required>
          <el-input-number
            v-model="adjustForm.deltaPoints"
            :min="-100000"
            :max="100000"
            :precision="0"
            :step="1"
          />
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input v-model="adjustForm.reason" type="textarea" :rows="3" placeholder="例如：活动补偿" />
        </el-form-item>
      </el-form>
    </AdminDialog>

    <!-- 用户详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      size="min(1040px, 96vw)"
      append-to-body
      destroy-on-close
      class="user-detail-drawer"
    >
      <template #header>
        <div v-if="drawerUserInfo" class="drawer-header">
          <span class="drawer-avatar" :class="{ 'has-image': showAvatar(drawerUserInfo) }">
            <img
              v-if="showAvatar(drawerUserInfo)"
              :src="adminMediaUrl(drawerUserInfo.avatarUrl)"
              alt=""
              @error="avatarBroken(drawerUserInfo.id)"
            />
            <template v-else>{{ avatarInitial(drawerUserInfo) }}</template>
          </span>
          <span class="drawer-heading">
            <span class="drawer-heading__line">
              <strong>{{ displayName(drawerUserInfo) }}</strong>
              <span class="badge" :class="`badge--${userStatusMeta(drawerUserInfo).tone}`">
                {{ userStatusMeta(drawerUserInfo).label }}
              </span>
              <span v-if="drawerUserInfo.location" class="drawer-heading__fact">{{ drawerUserInfo.location }}</span>
              <a
                v-if="websiteHref(drawerUserInfo.websiteUrl)"
                class="drawer-heading__fact drawer-heading__site"
                :href="websiteHref(drawerUserInfo.websiteUrl)"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ drawerUserInfo.websiteUrl }}
              </a>
              <span class="drawer-heading__fact">{{ formatTime(drawerUserInfo.createdAt) }}</span>
            </span>
            <small class="drawer-heading__meta">
              <span>{{ drawerUserInfo.email }}</span>
              <code class="drawer-heading__id mono" :title="drawerUserInfo.id">{{ drawerUserInfo.id }}</code>
            </small>
          </span>
        </div>
      </template>

      <div v-if="drawerUser" class="drawer-body">
        <el-tabs v-model="activeTab" class="user-detail-tabs">
          <el-tab-pane label="资料概览" name="overview" class="overview-tab">
            <div v-loading="overviewLoading" class="overview-panel">
              <section class="overview-toolbar">
                <div v-if="overview" class="overview-toolbar__meta">
                  <span>
                    <em>消耗确认</em>
                    {{ overview.user.requireCostConfirm ? '开启' : '关闭' }}
                  </span>
                  <span>
                    <em>投稿限制</em>
                    {{
                      isSubmissionBanned(overview.user)
                        ? `禁投至 ${formatTime(overview.user.submissionBannedUntil)}`
                        : '未限制'
                    }}
                  </span>
                </div>
                <div class="overview-toolbar__actions">
                  <button type="button" class="overview-btn" @click="openAdjust(drawerUser)">
                    <el-icon><Wallet /></el-icon>
                    调整余额
                  </button>
                  <button
                    type="button"
                    class="overview-btn"
                    :class="drawerUserInfo?.status === 'banned' ? 'is-success' : 'is-danger'"
                    @click="drawerUserInfo && toggleBan(drawerUserInfo)"
                  >
                    <el-icon>
                      <Unlock v-if="drawerUserInfo?.status === 'banned'" />
                      <CircleClose v-else />
                    </el-icon>
                    {{ drawerUserInfo?.status === 'banned' ? '解封' : '封禁' }}
                  </button>
                </div>
              </section>
              <template v-if="overview">
                <section class="detail-section">
                  <header class="detail-section__title">资金概览</header>
                  <div class="wallet-overview">
                    <div>
                      <small>普通可用</small>
                      <strong class="tnum">{{ formatPoints(drawerWallet.normalBalanceCents ?? 0) }}</strong>
                      <span>积分</span>
                    </div>
                    <div>
                      <small>体验可用</small>
                      <strong class="tnum">{{ formatPoints(drawerWallet.trialBalanceCents ?? 0) }}</strong>
                      <span>积分</span>
                    </div>
                    <div>
                      <small>冻结积分</small>
                      <strong class="tnum is-frozen">{{ formatPoints(drawerWallet.frozenCents) }}</strong>
                      <span>积分</span>
                    </div>
                    <div>
                      <small>资金合计</small>
                      <strong class="tnum">{{ formatPoints(drawerWallet.balanceCents + drawerWallet.frozenCents) }}</strong>
                      <span>积分</span>
                    </div>
                  </div>
                  <p v-if="drawerWallet.trialFeatureLabel || drawerWallet.trialFeatureKey" class="wallet-note">
                    体验功能：{{ drawerWallet.trialFeatureLabel || drawerWallet.trialFeatureKey }}
                  </p>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">套餐与活动</header>
                  <dl class="detail-fields">
                    <div>
                      <dt>当前套餐</dt>
                      <dd>{{ overview.subscription?.active ? overview.subscription.planName || overview.subscription.planCode : '无订阅' }}</dd>
                    </div>
                    <div>
                      <dt>到期时间</dt>
                      <dd>{{ overview.subscription?.active ? formatTime(overview.subscription.endsAt) : '-' }}</dd>
                    </div>
                    <div>
                      <dt>每日发放</dt>
                      <dd>
                        {{
                          overview.subscription?.active
                            ? `${formatPoints(overview.subscription.dailyGrantCents ?? 0)} 积分`
                            : '-'
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>今日发放</dt>
                      <dd>
                        {{
                          overview.subscription?.active
                            ? overview.subscription.grantedToday
                              ? '已发放'
                              : '未发放'
                            : '-'
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>体验申请</dt>
                      <dd>
                        <button
                          v-if="overview.trialAccess"
                          type="button"
                          class="detail-link"
                          @click="openRelatedPage('/trial-applications', overview.user.email)"
                        >
                          {{ trialStatusLabel(overview.trialAccess.status) }}
                        </button>
                        <template v-else>未申请</template>
                      </dd>
                    </div>
                    <div>
                      <dt>体验功能</dt>
                      <dd>{{ trialFeatureLabels(overview.trialAccess) }}</dd>
                    </div>
                    <div>
                      <dt>体验礼包</dt>
                      <dd>{{ trialRewardLabel(overview.trialAccess) }}</dd>
                    </div>
                    <div>
                      <dt>签到</dt>
                      <dd>{{ checkinLabel(overview.checkin) }}</dd>
                    </div>
                    <div>
                      <dt>拼团</dt>
                      <dd>
                        <button
                          v-if="overview.growthGroup"
                          type="button"
                          class="detail-link"
                          @click="openRelatedPage('/growth-groups')"
                        >
                          {{ growthLabel(overview.growthGroup) }}
                        </button>
                        <template v-else>未参与</template>
                      </dd>
                    </div>
                    <div>
                      <dt>反馈</dt>
                      <dd>
                        <button
                          type="button"
                          class="detail-link"
                          @click="openRelatedPage('/feedback', overview.user.email)"
                        >
                          {{ overview.counts.feedback ?? 0 }} 条
                        </button>
                      </dd>
                    </div>
                  </dl>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">使用情况</header>
                  <div class="count-cards">
                    <button type="button" class="count-card is-emphasis" @click="openDrawerTab('tasks')">
                      <span>任务总数</span>
                      <strong class="tnum">{{ overview.counts.tasksTotal }}</strong>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <span>成功率</span>
                      <strong class="tnum">{{ taskSuccessRate }}%</strong>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <span>成功</span>
                      <strong class="tnum">{{ overview.counts.tasksSucceeded }}</strong>
                    </button>
                    <button
                      type="button"
                      class="count-card"
                      :class="{ 'is-warn': overview.counts.tasksFailed > 0 }"
                      @click="openDrawerTab('tasks')"
                    >
                      <span>失败</span>
                      <strong class="tnum">{{ overview.counts.tasksFailed }}</strong>
                    </button>
                    <button
                      type="button"
                      class="count-card"
                      :class="{ 'is-live': overview.counts.tasksRunning > 0 }"
                      @click="openDrawerTab('tasks')"
                    >
                      <span>运行中</span>
                      <strong class="tnum">{{ overview.counts.tasksRunning }}</strong>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <span>已取消</span>
                      <strong class="tnum">{{ overview.counts.tasksCanceled }}</strong>
                    </button>
                    <div class="count-card">
                      <span>投稿</span>
                      <strong class="tnum">{{ overview.counts.submissions }}</strong>
                    </div>
                    <div class="count-card">
                      <span>素材</span>
                      <strong class="tnum">{{ overview.counts.assets }}</strong>
                    </div>
                    <button type="button" class="count-card" @click="openDrawerTab('ledger')">
                      <span>订单</span>
                      <strong class="tnum">{{ overview.counts.orders }}</strong>
                    </button>
                  </div>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">登录与会话</header>
                  <dl class="detail-fields">
                    <div>
                      <dt>有效会话</dt>
                      <dd>{{ overview.security.activeSessions }}</dd>
                    </div>
                    <div>
                      <dt>最近会话</dt>
                      <dd>{{ formatTime(overview.security.lastSessionAt) }}</dd>
                    </div>
                    <div>
                      <dt>最近 IP</dt>
                      <dd>{{ overview.security.lastSessionIp || '-' }}</dd>
                    </div>
                    <div>
                      <dt>会话到期</dt>
                      <dd>{{ formatTime(overview.security.lastSessionExpiresAt) }}</dd>
                    </div>
                    <div class="is-wide">
                      <dt>最近设备</dt>
                      <dd>
                        <span class="device-text" :title="overview.security.lastSessionUserAgent || ''">
                          {{ overview.security.lastSessionUserAgent || '-' }}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </section>
              </template>
              <el-empty v-else-if="!overviewLoading" description="暂无概览数据" :image-size="56" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="用户画像" name="profile" class="overview-tab">
            <div v-loading="overviewLoading" class="overview-panel">
              <UserProfilePanel
                v-if="overview?.profile"
                :profile="overview.profile"
                :refreshing="profileRefreshing"
                @refresh="refreshProfile"
              />
              <el-empty v-else-if="!overviewLoading" description="暂无画像数据" :image-size="56" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="账本" name="ledger" class="drawer-list-tab">
            <AdminListShell
              class="drawer-list-shell users-list-shell"
              fill
              :has-prev="ledgerList.hasPrev.value"
              :has-next="ledgerList.hasNext.value"
              :loading="ledgerList.loading.value"
              :page="ledgerList.page.value"
              :count="ledgerList.items.value.length"
              :total="ledgerList.total.value"
              :page-size="ledgerPageSize"
              @update:page="ledgerList.goToPage"
              @update:page-size="(size: number) => { ledgerPageSize = size; ledgerList.reset() }"
            >
              <div class="users-table-shell">
                <el-table
                  v-loading="ledgerList.loading.value"
                  class="users-table"
                  :data="ledgerList.items.value"
                  height="100%"
                  size="small"
                >
                  <template #empty>
                    <el-empty description="暂无流水" :image-size="60" />
                  </template>
                  <el-table-column label="时间" width="110" align="left" header-align="left">
                    <template #default="{ row }">
                      <span class="cell-text tnum">{{ formatShortTime(row.createdAt) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="类型" width="88" align="left" header-align="left">
                    <template #default="{ row }">
                      <span
                        class="kind-text"
                        :class="row.deltaCents >= 0 ? 'is-pos' : 'is-neg'"
                      >
                        {{ ledgerKindLabel(row.kind) }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column label="积分变动" width="96" align="left" header-align="left">
                    <template #default="{ row }">
                      <span
                        class="cell-num tnum"
                        :class="row.deltaCents >= 0 ? 'cell-ok' : 'cell-fail'"
                      >
                        {{ row.deltaCents >= 0 ? '+' : '' }}{{ formatPoints(row.deltaCents) }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column label="积分余额" width="96" align="left" header-align="left">
                    <template #default="{ row }">
                      <span class="cell-num tnum">{{ formatPoints(row.balanceAfterCents) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="原因" min-width="220" align="left" header-align="left" show-overflow-tooltip>
                    <template #default="{ row }">
                      <div class="ledger-reason">
                        <span class="cell-text">{{ ledgerReasonLabel(row.reason, row.task) }}</span>
                        <small v-if="row.sourceType" class="drawer-id" :title="row.sourceId || ''">
                          {{ row.sourceType }}<template v-if="row.sourceId"> · {{ row.sourceId }}</template>
                        </small>
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </AdminListShell>
          </el-tab-pane>

          <el-tab-pane label="任务" name="tasks" class="drawer-list-tab">
            <AdminListShell
              class="drawer-list-shell users-list-shell"
              fill
              :has-prev="taskList.hasPrev.value"
              :has-next="taskList.hasNext.value"
              :loading="taskList.loading.value"
              :page="taskList.page.value"
              :count="taskList.items.value.length"
              :total="taskList.total.value"
              :page-size="taskPageSize"
              @update:page="taskList.goToPage"
              @update:page-size="(size: number) => { taskPageSize = size; taskList.reset() }"
            >
              <div class="users-table-shell">
                <el-table
                  v-loading="taskList.loading.value"
                  class="users-table"
                  :data="taskList.items.value"
                  height="100%"
                  size="small"
                >
                  <template #empty>
                    <el-empty description="暂无任务" :image-size="60" />
                  </template>
                  <el-table-column label="任务 ID" min-width="240" align="left" header-align="left" show-overflow-tooltip>
                    <template #default="{ row }">
                      <span class="mono cell-text drawer-id" :title="row.id">{{ row.id }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="类型 / 模型" min-width="150" align="left" header-align="left">
                    <template #default="{ row }">
                      <div class="task-kind">
                        <strong>{{ taskTypeLabel(row.type, row.params, row.source) }}</strong>
                        <small :title="row.model || ''">{{ row.model || '未记录模型' }}</small>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="状态" width="100" align="left" header-align="left">
                    <template #default="{ row }">
                      <div class="task-status">
                        <span
                          class="kind-text"
                          :class="`is-status-${row.status}`"
                        >
                          {{ TASK_STATUS_LABELS[row.status] ?? row.status }}
                        </span>
                        <small v-if="row.attempt">尝试 {{ row.attempt }} 次</small>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="积分消耗" width="96" align="left" header-align="left">
                    <template #default="{ row }">
                      <span class="cell-num tnum">{{ formatPoints(row.costCents) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="时间" width="110" align="left" header-align="left">
                    <template #default="{ row }">
                      <span class="cell-text tnum" :title="row.errorMessage || formatTime(row.createdAt)">
                        {{ formatShortTime(row.createdAt) }}
                      </span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </AdminListShell>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>

  </div>
</template>

<style scoped>
:deep(.row-clickable) {
  cursor: pointer;
}

.users-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.users-page :deep(.page-card) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.users-page :deep(.page-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 14px;
  overflow: hidden;
}

.users-toolbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.status-tab {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.status-tab.is-active {
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-sm);
}

html.dark .status-tab.is-active {
  background: var(--surface-3);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.users-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.users-search {
  width: min(280px, 70vw);
}

.profile-filter {
  width: 112px;
}

.profile-filter.is-wide {
  width: 128px;
}

.users-search :deep(.el-input__wrapper) {
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--border) inset;
}

.users-board {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
}

.users-board :deep(.admin-list-shell) {
  border-top: 0;
}

.users-board :deep(.admin-list-shell__viewport) {
  overflow: hidden;
  scrollbar-gutter: auto;
}

.users-board :deep(.admin-list-shell__footer) {
  min-height: 52px;
  padding: 0 16px;
  background: var(--surface-2);
}

.users-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.users-table {
  --el-table-border-color: transparent;
}

.users-table :deep(.el-table__inner-wrapper::before),
.users-table :deep(.el-table__inner-wrapper::after),
.users-table :deep(.el-table__border-left-patch) {
  display: none;
}

.users-table :deep(.el-table__header-wrapper) {
  padding-right: 0 !important;
}

.users-table :deep(.el-table .cell) {
  overflow: hidden;
  padding: 0 12px;
}

.users-table :deep(.col-group .cell) {
  padding-left: 20px;
}

.users-table :deep(.el-table td.el-table__cell),
.users-table :deep(.el-table th.el-table__cell) {
  border: 0;
}

.users-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 40px;
  padding: 0;
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.users-table :deep(.el-table__body .el-table__cell) {
  padding: 8px 0;
}

.users-table :deep(.el-table__row td.el-table__cell) {
  height: 56px;
}

.users-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.users-table :deep(th.el-table__cell.gutter),
.users-table :deep(col[name='gutter']) {
  display: none;
  width: 0 !important;
}

.users-table :deep(.col-num .cell) {
  font-variant-numeric: tabular-nums;
}

.users-table :deep(.badge) {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 20px;
}

.ledger-reason,
.task-kind,
.task-status {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.task-kind small,
.ledger-reason span,
.ledger-reason small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-cell {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.user-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.user-avatar,
.drawer-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: var(--accent-ink);
  font-weight: 750;
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.user-avatar {
  width: 32px;
  height: 32px;
  font-size: 12px;
  letter-spacing: -0.02em;
}

.user-avatar.has-image,
.drawer-avatar.has-image {
  box-shadow: 0 0 0 1px var(--border);
  background: var(--surface-2);
}

.user-avatar img,
.drawer-avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-meta {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.user-meta__line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.user-meta__line strong,
.user-meta__email,
.cell-text,
.cell-num,
.cell-muted,
.cell-time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-meta__line strong {
  min-width: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.user-meta__line .badge {
  flex: 0 0 auto;
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
  line-height: 18px;
}

.user-meta__email {
  color: var(--ink-3);
  font-size: 11px;
}

.cell-text,
.cell-time {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-num {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.cell-num.is-negative {
  color: var(--danger);
}

.cell-num.is-frozen {
  color: var(--warning);
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.pair-cell {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 4px;
  white-space: nowrap;
}

.pair-cell em {
  color: var(--ink);
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}

.pair-cell em.is-frozen,
.pair-sep {
  color: var(--ink-3);
  font-weight: 600;
}

.pair-cell em.is-frozen {
  color: var(--warning);
  font-size: 12px;
}

.pair-cell em.is-fail {
  color: var(--danger);
}

.wallet-line {
  display: inline-flex;
  max-width: 100%;
  align-items: baseline;
  justify-content: flex-end;
  gap: 8px;
  overflow: hidden;
}

.wallet-line em {
  color: var(--ink);
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}

.wallet-line small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-ip {
  display: block;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-ok {
  color: var(--success);
  font-size: 12px;
}

.cell-fail {
  color: var(--danger);
  font-size: 12px;
}

.list-profile,
.metric-cell {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.list-profile .badge {
  width: fit-content;
  height: 20px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 20px;
}

.list-profile__tags,
.metric-cell small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-cell {
  justify-items: start;
}

.metric-cell strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.metric-cell small.is-negative {
  color: var(--danger);
}

.kind-text {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
}

.kind-text.is-pos,
.kind-text.is-status-succeeded {
  color: var(--success);
}

.kind-text.is-neg,
.kind-text.is-status-failed {
  color: var(--danger);
}

.kind-text.is-status-running,
.kind-text.is-status-queued {
  color: var(--info);
}

.kind-text.is-status-canceled {
  color: var(--warning);
}

.ledger-reason small,
.task-kind small,
.task-status small {
  color: var(--ink-3);
  font-size: 11px;
}

.task-kind strong {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 700;
}

@media (max-width: 900px) {
  .users-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .users-toolbar__actions {
    width: 100%;
  }

  .users-search {
    flex: 1;
    width: auto;
  }

  .profile-filter,
  .profile-filter.is-wide {
    flex: 1;
    width: min(150px, 45vw);
  }
}

.drawer-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding-right: 8px;
}

.drawer-avatar {
  width: 40px;
  height: 40px;
  font-size: 14px;
}

.drawer-heading {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.drawer-heading__line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.drawer-heading__line .badge {
  flex: none;
  height: 20px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 20px;
}

.drawer-heading__fact {
  flex: none;
  overflow: hidden;
  max-width: 220px;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-heading__site {
  color: var(--accent);
}

.drawer-heading strong,
.drawer-heading__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-heading strong {
  min-width: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.drawer-heading small,
.drawer-heading__meta {
  color: var(--ink-3);
  font-size: 12px;
}

.drawer-heading__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.drawer-heading__id {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
}

.drawer-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.overview-toolbar {
  display: flex;
  min-height: 44px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  margin-bottom: 14px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.overview-toolbar__meta {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
}

.overview-toolbar__meta > span {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.3;
}

.overview-toolbar__meta em {
  flex: none;
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 650;
}

.overview-toolbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.overview-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: -0.01em;
  cursor: pointer;
}

.overview-btn:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
}

.overview-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.overview-btn.is-danger {
  border-color: transparent;
  background: var(--danger-soft);
  color: var(--danger);
}

.overview-btn.is-danger:hover {
  background: color-mix(in srgb, var(--danger) 16%, var(--surface));
}

.overview-btn.is-success {
  border-color: transparent;
  background: var(--success-soft);
  color: var(--success);
}

.overview-btn.is-success:hover {
  background: color-mix(in srgb, var(--success) 16%, var(--surface));
}

.overview-btn .el-icon {
  font-size: 14px;
}

.drawer-id {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--ink-2);
  word-break: break-all;
  user-select: all;
}

.overview-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  padding-bottom: 20px;
}

.detail-section {
  margin-bottom: 14px;
}

.detail-section__title {
  margin-bottom: 6px;
  color: var(--ink);
  font-size: 12px;
  font-weight: 750;
}

.detail-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--border);
}

.detail-fields > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 36px;
  padding: 6px 12px;
  background: var(--surface);
}

.detail-fields > div.is-wide {
  grid-column: 1 / -1;
}

.detail-fields dt {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.detail-fields dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-fields .is-wide dd {
  white-space: normal;
}

.detail-fields code {
  display: block;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wallet-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.wallet-overview > div {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 3px 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
}

.wallet-overview small {
  grid-column: 1 / -1;
  color: var(--ink-3);
  font-size: 10px;
}

.wallet-overview strong {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 18px;
  text-overflow: ellipsis;
}

.wallet-overview strong.is-frozen {
  color: var(--warning);
}

.wallet-overview span {
  color: var(--ink-3);
  font-size: 10px;
}

.wallet-note {
  margin: 8px 0 0;
  color: var(--ink-3);
  font-size: 12px;
}

.detail-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.detail-link:hover {
  text-decoration: underline;
}

.count-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--border);
}

.count-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  background: var(--surface);
  text-align: left;
}

button.count-card {
  width: 100%;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button.count-card:hover {
  background: var(--surface-2);
}

.count-card.is-emphasis {
  background: var(--accent-soft);
}

button.count-card.is-emphasis:hover {
  background: color-mix(in srgb, var(--accent) 18%, var(--surface));
}

.count-card span {
  flex: none;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 650;
}

.count-card strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count-card.is-warn strong {
  color: var(--danger);
}

.count-card.is-live strong {
  color: var(--info);
}

.device-text {
  display: block;
  overflow-wrap: anywhere;
  line-height: 1.5;
  word-break: break-word;
}

.ledger-reason,
.task-kind,
.task-status {
  line-height: 1.3;
}

:deep(.user-detail-tabs) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

:deep(.user-detail-tabs .el-tabs__header) {
  margin-bottom: 14px;
  flex-shrink: 0;
}

:deep(.user-detail-tabs .el-tabs__content),
:deep(.user-detail-tabs .el-tab-pane) {
  flex: 1;
  min-height: 0;
}

.detail-fields a {
  display: block;
  overflow: hidden;
  color: var(--accent-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adjust-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.adjust-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.adjust-form :deep(.el-form-item__label) {
  margin-bottom: 6px;
  padding: 0;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
}

.adjust-form :deep(.el-input-number) {
  width: 100%;
}

.adjust-form :deep(.el-textarea__inner) {
  min-height: 76px;
}
</style>

<!-- append-to-body 后抽屉挂到 body，需非 scoped 才能控滚动 -->
<style>
.user-detail-drawer.el-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 0;
  overflow: hidden;
}

.user-detail-drawer .el-drawer__header {
  margin-bottom: 0;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.user-detail-drawer .el-drawer__close-btn {
  margin-left: 12px;
}

.user-detail-drawer .el-drawer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 12px 0 0;
}

.user-detail-drawer .drawer-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.user-detail-drawer .user-detail-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.user-detail-drawer .user-detail-tabs > .el-tabs__header {
  flex-shrink: 0;
  margin: 0 20px;
}

.user-detail-drawer .user-detail-tabs > .el-tabs__content {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.user-detail-drawer .user-detail-tabs .el-tab-pane {
  position: absolute;
  inset: 0;
  min-width: 0;
  overflow: hidden;
}

.user-detail-drawer .user-detail-tabs .el-tab-pane.overview-tab {
  overflow: auto;
  padding: 14px 20px 24px;
}

.user-detail-drawer .user-detail-tabs .el-tab-pane.drawer-list-tab {
  display: flex;
  flex-direction: column;
  padding: 0;
}

.user-detail-drawer .drawer-list-shell {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  border-top: 1px solid var(--border);
}

.user-detail-drawer .drawer-list-shell .admin-list-shell__viewport {
  scrollbar-gutter: auto;
}

.user-detail-drawer .drawer-list-shell .admin-list-shell__footer {
  flex-shrink: 0;
  min-height: 56px;
  padding: 8px 20px;
  background: var(--surface);
}
</style>
