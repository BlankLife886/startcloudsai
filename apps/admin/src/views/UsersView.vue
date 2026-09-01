<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Wallet } from '@element-plus/icons-vue'
import AdminDialog from '@/components/AdminDialog.vue'
import RegistrationSettingsDialog from '@/components/settings/RegistrationSettingsDialog.vue'
import UserProfilePanel from '@/components/UserProfilePanel.vue'
import UserProfileRulesDialog from '@/components/UserProfileRulesDialog.vue'
import UserAnalyticsDrawer from '@/components/UserAnalyticsDrawer.vue'
import { request, type Page } from '@/request'
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

function profileCompleteness(user: AdminUser | null | undefined) {
  if (!user) return 0
  const fields = [user.username, user.avatarUrl, user.bio, user.location, user.websiteUrl]
  return Math.round((fields.filter((value) => String(value || '').trim()).length / fields.length) * 100)
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

const { items, loading, error, total, page, hasPrev, hasNext, reset, next, prev, refresh, retry } =
  usePagedList<AdminUser>(
    (cursor) =>
      request<Page<AdminUser>>('/api/v1/admin/users', {
        query: {
          search: filters.search,
          status: filters.status,
          lifecycle: filters.lifecycle,
          risk: filters.risk,
          profileTag: filters.profileTag,
          limit: 20,
          cursor,
        },
      }),
    () => filters,
  )

function setStatusTab(value: string) {
  if (filters.status === value) return
  filters.status = value
  reset()
}

function clearFilters() {
  filters.search = ''
  filters.status = ''
  filters.lifecycle = ''
  filters.risk = ''
  filters.profileTag = ''
  reset()
}

onMounted(reset)

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

const ledgerList = usePagedList<LedgerEntry>(
  (cursor) =>
    request<Page<LedgerEntry>>(`/api/v1/admin/users/${drawerUser.value?.id}/wallet/entries`, {
      query: { limit: 20, cursor },
    }),
  () => drawerUser.value?.id ?? '',
)

const taskList = usePagedList<UserTask>(
  (cursor) =>
    request<Page<UserTask>>('/api/v1/admin/tasks', {
      query: { user: drawerUser.value?.id, limit: 20, cursor },
    }),
  () => drawerUser.value?.id ?? '',
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
  <div class="page">
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
            @change="reset"
          >
            <el-option v-for="option in lifecycleOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-select
            v-model="filters.risk"
            class="profile-filter"
            placeholder="风险"
            clearable
            @change="reset"
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
            @change="reset"
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
            @keyup.enter="reset"
            @clear="reset"
          />
          <el-button @click="reset">查询</el-button>
          <el-button text @click="clearFilters">重置</el-button>
        </div>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <AdminListShell
        class="users-list-shell"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :loading="loading"
        :page="page"
        :count="items.length"
        :total="total"
        @prev="prev"
        @next="next"
      >
        <div class="users-table-shell">
          <el-table
            v-loading="loading"
            class="users-table"
            :data="items"
            height="100%"
            size="small"
            row-class-name="row-clickable"
            @row-click="(row: AdminUser) => openDrawer(row)"
          >
            <template #empty>
              <el-empty description="暂无用户" :image-size="60">
                <div class="empty-sub">调整筛选条件后重新查询</div>
              </el-empty>
            </template>

            <el-table-column label="用户" min-width="150" align="left" header-align="left">
              <template #default="{ row }">
                <button
                  type="button"
                  class="user-cell"
                  :title="displayName(row as AdminUser)"
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
                    <span
                      class="user-status"
                      :class="
                        row.status === 'banned'
                          ? 'is-danger'
                          : isSubmissionBanned(row as AdminUser)
                            ? 'is-warning'
                            : 'is-success'
                      "
                    >
                      {{
                        row.status === 'banned'
                          ? '已封禁'
                          : isSubmissionBanned(row as AdminUser)
                            ? '禁投稿'
                            : '正常'
                      }}
                    </span>
                    <span class="user-name">{{ maskedDisplayName(row as AdminUser) }}</span>
                  </span>
                </button>
              </template>
            </el-table-column>

            <el-table-column label="邮箱" min-width="180" align="left" header-align="left" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-text">{{ row.email }}</span>
              </template>
            </el-table-column>

            <el-table-column label="用户画像" min-width="170" align="left" header-align="left">
              <template #default="{ row }">
                <div v-if="row.profile" class="list-profile">
                  <span class="lifecycle-badge" :class="`is-${row.profile.lifecycle}`">
                    {{ lifecycleLabels[row.profile.lifecycle] || row.profile.lifecycle }}
                  </span>
                  <span class="list-profile__tags">
                    {{ row.profile.tags.slice(0, 2).map((tag: string) => profileTagLabels[tag] || tag).join(' · ') || (workspaceLabels[row.profile.primaryWorkspace] || '暂无偏好') }}
                  </span>
                </div>
                <span v-else class="cell-muted">待计算</span>
              </template>
            </el-table-column>

            <el-table-column label="30日质量" width="126" align="left" header-align="left">
              <template #default="{ row }">
                <div v-if="row.profile" class="quality-cell">
                  <strong>{{ (row.profile.successRateBps30 / 100).toFixed(1) }}%</strong>
                  <small>{{ row.profile.successfulRuns30 }} 成功 / {{ row.profile.failedRuns30 }} 失败</small>
                </div>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>

            <el-table-column label="30日价值" width="130" align="left" header-align="left">
              <template #default="{ row }">
                <div v-if="row.profile" class="value-cell">
                  <strong>{{ formatProfileMoney(row.profile.revenueCents30) }}</strong>
                  <small :class="{ 'is-negative': row.profile.grossProfitCents30 < 0 }">
                    毛利 {{ formatProfileMoney(row.profile.grossProfitCents30) }}
                  </small>
                </div>
                <span v-else class="cell-muted">-</span>
              </template>
            </el-table-column>

            <el-table-column label="余额/冻结" width="112" align="left" header-align="left">
              <template #default="{ row }">
                <span class="pair-cell tnum">
                  <em class="cell-num">{{ formatPoints(walletOf(row as AdminUser).balanceCents) }}</em>
                  <span class="pair-sep">/</span>
                  <em class="cell-frozen">{{ formatPoints(walletOf(row as AdminUser).frozenCents) }}</em>
                </span>
              </template>
            </el-table-column>

            <el-table-column label="最近活跃" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum">
                  {{ row.profile?.lastActivityAt ? formatShortTime(row.profile.lastActivityAt) : row.lastLoginAt ? formatShortTime(row.lastLoginAt) : '暂无活动' }}
                </span>
              </template>
            </el-table-column>

            <el-table-column label="注册时间" width="110" align="left" header-align="left">
              <template #default="{ row }">
                <span class="cell-text tnum">{{ formatShortTime(row.createdAt) }}</span>
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
      :subtitle="
        adjustTarget
          ? `${adjustTarget.email} · 当前余额 ${formatPoints(walletOf(adjustTarget).balanceCents)} 积分`
          : '正数入账、负数扣减，记入钱包账本'
      "
      :icon="Wallet"
      width="440px"
      confirm-text="确认调整"
      :confirm-loading="adjustSubmitting"
      @confirm="submitAdjust"
    >
      <el-form label-width="90px">
        <el-form-item label="积分" required>
          <el-input-number
            v-model="adjustForm.deltaPoints"
            :min="-100000"
            :max="100000"
            :precision="0"
            :step="1"
            style="width: 200px"
          />
          <div class="text-muted">
            正数入账、负数扣减，单次范围 ±100000 积分，记入钱包账本
          </div>
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input v-model="adjustForm.reason" type="textarea" :rows="2" placeholder="必填，例如：活动补偿" />
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
            <span
              class="drawer-status"
              :class="
                drawerUserInfo.status === 'banned'
                  ? 'is-danger'
                  : isSubmissionBanned(drawerUserInfo)
                    ? 'is-warning'
                    : 'is-success'
              "
            >
              {{
                drawerUserInfo.status === 'banned'
                  ? '已封禁'
                  : isSubmissionBanned(drawerUserInfo)
                    ? '禁投稿'
                    : '正常'
              }}
            </span>
            <strong>{{ displayName(drawerUserInfo) }}</strong>
            <small>{{ drawerUserInfo.email }}</small>
          </span>
        </div>
      </template>

      <div v-if="drawerUser" class="drawer-body">
        <div class="drawer-actions">
          <span class="drawer-actions__id">
            用户 ID：
            <code class="mono" :title="drawerUser.id">{{ drawerUser.id }}</code>
          </span>
          <el-button size="small" @click="openAdjust(drawerUser)">调整余额</el-button>
          <el-button
            size="small"
            :type="drawerUserInfo?.status === 'banned' ? 'success' : 'danger'"
            plain
            @click="drawerUserInfo && toggleBan(drawerUserInfo)"
          >
            {{ drawerUserInfo?.status === 'banned' ? '解封' : '封禁' }}
          </el-button>
        </div>

        <el-tabs v-model="activeTab" class="user-detail-tabs">
          <el-tab-pane label="资料概览" name="overview" class="overview-tab">
            <div v-loading="overviewLoading" class="overview-panel">
              <template v-if="overview">
                <section class="detail-section profile-detail-section">
                  <UserProfilePanel
                    :profile="overview.profile"
                    :refreshing="profileRefreshing"
                    @refresh="refreshProfile"
                  />
                </section>

                <section class="detail-section profile-overview">
                  <div class="profile-overview__copy">
                    <strong>资料完整度 {{ profileCompleteness(overview.user) }}%</strong>
                    <small>{{ overview.user.bio || '用户尚未填写个人简介' }}</small>
                  </div>
                  <el-progress
                    :percentage="profileCompleteness(overview.user)"
                    :stroke-width="7"
                    :show-text="false"
                  />
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">账号与个人资料</header>
                  <el-descriptions :column="2" size="small" border>
                    <el-descriptions-item label="用户 ID" :span="2">
                      <code class="mono" :title="overview.user.id">{{ overview.user.id }}</code>
                    </el-descriptions-item>
                    <el-descriptions-item label="邮箱">{{ overview.user.email }}</el-descriptions-item>
                    <el-descriptions-item label="用户名">{{ overview.user.username || '-' }}</el-descriptions-item>
                    <el-descriptions-item label="所在地">{{ overview.user.location || '-' }}</el-descriptions-item>
                    <el-descriptions-item label="个人网站">
                      <a
                        v-if="websiteHref(overview.user.websiteUrl)"
                        :href="websiteHref(overview.user.websiteUrl)"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {{ overview.user.websiteUrl }}
                      </a>
                      <template v-else>-</template>
                    </el-descriptions-item>
                    <el-descriptions-item label="注册时间">{{ formatTime(overview.user.createdAt) }}</el-descriptions-item>
                    <el-descriptions-item label="最近登录">{{ formatTime(overview.user.lastLoginAt) }}</el-descriptions-item>
                    <el-descriptions-item label="消耗确认">
                      {{ overview.user.requireCostConfirm ? '开启' : '关闭' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="投稿限制">
                      {{
                        isSubmissionBanned(overview.user)
                          ? `禁投至 ${formatTime(overview.user.submissionBannedUntil)}`
                          : '未限制'
                      }}
                    </el-descriptions-item>
                  </el-descriptions>
                </section>

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
                  <el-descriptions :column="2" size="small" border>
                    <el-descriptions-item label="当前套餐">
                      {{ overview.subscription?.active ? overview.subscription.planName || overview.subscription.planCode : '无订阅' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="到期时间">
                      {{ overview.subscription?.active ? formatTime(overview.subscription.endsAt) : '-' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="每日发放">
                      {{
                        overview.subscription?.active
                          ? `${formatPoints(overview.subscription.dailyGrantCents ?? 0)} 积分`
                          : '-'
                      }}
                    </el-descriptions-item>
                    <el-descriptions-item label="今日发放">
                      {{
                        overview.subscription?.active
                          ? overview.subscription.grantedToday
                            ? '已发放'
                            : '未发放'
                          : '-'
                      }}
                    </el-descriptions-item>
                    <el-descriptions-item label="体验申请">
                      <button
                        v-if="overview.trialAccess"
                        type="button"
                        class="detail-link"
                        @click="openRelatedPage('/trial-applications', overview.user.email)"
                      >
                        {{ trialStatusLabel(overview.trialAccess.status) }}
                      </button>
                      <template v-else>未申请</template>
                    </el-descriptions-item>
                    <el-descriptions-item label="体验功能">
                      {{ trialFeatureLabels(overview.trialAccess) }}
                    </el-descriptions-item>
                    <el-descriptions-item label="体验礼包">
                      {{ trialRewardLabel(overview.trialAccess) }}
                    </el-descriptions-item>
                    <el-descriptions-item label="签到">
                      {{ checkinLabel(overview.checkin) }}
                    </el-descriptions-item>
                    <el-descriptions-item label="拼团">
                      <button
                        v-if="overview.growthGroup"
                        type="button"
                        class="detail-link"
                        @click="openRelatedPage('/growth-groups')"
                      >
                        {{ growthLabel(overview.growthGroup) }}
                      </button>
                      <template v-else>未参与</template>
                    </el-descriptions-item>
                    <el-descriptions-item label="反馈">
                      <button
                        type="button"
                        class="detail-link"
                        @click="openRelatedPage('/feedback', overview.user.email)"
                      >
                        {{ overview.counts.feedback ?? 0 }} 条
                      </button>
                    </el-descriptions-item>
                  </el-descriptions>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">使用情况</header>
                  <div class="count-cards">
                    <button type="button" class="count-card is-emphasis" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ overview.counts.tasksTotal }}</div>
                      <div class="count-label">任务总数</div>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ taskSuccessRate }}%</div>
                      <div class="count-label">任务成功率</div>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ overview.counts.tasksSucceeded }}</div>
                      <div class="count-label">成功任务</div>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ overview.counts.tasksFailed }}</div>
                      <div class="count-label">失败任务</div>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ overview.counts.tasksRunning }}</div>
                      <div class="count-label">运行中</div>
                    </button>
                    <button type="button" class="count-card" @click="openDrawerTab('tasks')">
                      <div class="count-value tnum">{{ overview.counts.tasksCanceled }}</div>
                      <div class="count-label">已取消</div>
                    </button>
                    <div class="count-card">
                      <div class="count-value tnum">{{ overview.counts.submissions }}</div>
                      <div class="count-label">投稿</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value tnum">{{ overview.counts.assets }}</div>
                      <div class="count-label">素材</div>
                    </div>
                    <button type="button" class="count-card" @click="openDrawerTab('ledger')">
                      <div class="count-value tnum">{{ overview.counts.orders }}</div>
                      <div class="count-label">订单记录</div>
                    </button>
                  </div>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">登录与会话</header>
                  <el-descriptions :column="2" size="small" border>
                    <el-descriptions-item label="有效会话">{{ overview.security.activeSessions }}</el-descriptions-item>
                    <el-descriptions-item label="最近会话">{{ formatTime(overview.security.lastSessionAt) }}</el-descriptions-item>
                    <el-descriptions-item label="最近 IP">{{ overview.security.lastSessionIp || '-' }}</el-descriptions-item>
                    <el-descriptions-item label="会话到期">
                      {{ formatTime(overview.security.lastSessionExpiresAt) }}
                    </el-descriptions-item>
                    <el-descriptions-item label="最近设备" :span="2">
                      <span class="device-text" :title="overview.security.lastSessionUserAgent || ''">
                        {{ overview.security.lastSessionUserAgent || '-' }}
                      </span>
                    </el-descriptions-item>
                  </el-descriptions>
                </section>
              </template>
              <el-empty v-else-if="!overviewLoading" description="暂无概览数据" :image-size="56" />
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
              @prev="ledgerList.prev"
              @next="ledgerList.next"
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
              @prev="taskList.prev"
              @next="taskList.next"
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

.users-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
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
  gap: 8px;
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

.users-list-shell {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.users-list-shell :deep(.admin-list-shell__footer) {
  min-height: 56px;
  padding: 8px 18px;
  background: var(--surface);
}

.users-list-shell :deep(.cursor-pager__meta strong) {
  color: var(--ink);
}

.users-table-shell {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.users-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.users-table :deep(.el-table__header-wrapper th.el-table__cell),
.users-table :deep(.el-table__body td.el-table__cell),
.users-table :deep(.el-table .cell) {
  text-align: left !important;
}

.users-table :deep(.el-table .cell) {
  display: block;
  justify-content: flex-start;
  padding-left: 12px;
  padding-right: 12px;
}

.users-table :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 48px;
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.users-table :deep(.el-table__body .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.users-table :deep(.el-table__row td.el-table__cell) {
  height: 56px;
}

.users-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: var(--surface-2);
}

.users-table :deep(.el-table__body tr.el-table__row:last-child td.el-table__cell) {
  border-bottom-color: transparent;
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

.user-avatar,
.drawer-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  color: var(--accent-on);
  font-weight: 700;
  background: linear-gradient(145deg, var(--accent), var(--accent-hover));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-on) 8%, transparent);
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
  gap: 2px;
  text-align: left;
}

.user-status,
.user-name,
.cell-text,
.cell-num,
.cell-muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-status {
  font-size: 11px;
  font-weight: 650;
  line-height: 1.2;
}

.user-status.is-success {
  color: var(--success);
}

.user-status.is-danger {
  color: var(--danger);
}

.user-status.is-warning {
  color: var(--warning);
}

.user-name {
  min-width: 0;
  color: var(--ink);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: -0.01em;
}

.cell-text {
  color: var(--ink-2);
  font-size: 12px;
}

.cell-num {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}

.cell-muted {
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
}

.pair-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.pair-cell em {
  font-style: normal;
  font-weight: 700;
}

.pair-sep {
  color: var(--ink-3);
  font-weight: 500;
}

.cell-frozen {
  color: var(--warning);
  font-size: 12px;
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
.quality-cell,
.value-cell {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.lifecycle-badge {
  width: fit-content;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 700;
  background: var(--surface-2);
}

.lifecycle-badge.is-active,
.lifecycle-badge.is-returned {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
}

.lifecycle-badge.is-churn_risk {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.lifecycle-badge.is-new,
.lifecycle-badge.is-activated {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 10%, transparent);
}

.list-profile__tags,
.quality-cell small,
.value-cell small {
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quality-cell strong,
.value-cell strong {
  color: var(--ink);
  font-size: 12px;
}

.value-cell small.is-negative {
  color: var(--danger);
}

.profile-detail-section {
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border);
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
  align-items: center;
  gap: 12px;
  width: 100%;
  padding-right: 8px;
}

.drawer-avatar {
  width: 42px;
  height: 42px;
  font-size: 14px;
}

.drawer-heading {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}

.drawer-status {
  justify-self: start;
  margin-bottom: 1px;
  color: var(--success);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.2;
}

.drawer-status.is-warning {
  color: var(--warning);
}

.drawer-status.is-danger {
  color: var(--danger);
}

.drawer-heading strong,
.drawer-heading small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-heading strong {
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
}

.drawer-heading small {
  color: var(--ink-3);
  font-size: 11px;
}

.drawer-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.drawer-actions {
  display: flex;
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.drawer-actions > span {
  min-width: 0;
  flex: 1;
  color: var(--ink-3);
  font-size: 11px;
}

.drawer-actions__id {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 4px;
}

.drawer-actions__id code,
.drawer-id {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--ink-2);
  word-break: break-all;
  user-select: all;
}

.drawer-actions code {
  color: var(--ink-2);
}

.overview-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  padding-bottom: 24px;
}

.detail-section {
  margin-bottom: 18px;
}

.detail-section__title {
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 700;
}

.profile-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--accent-soft);
}

.profile-overview__copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.profile-overview__copy strong {
  color: var(--accent-ink);
  font-size: 12px;
}

.profile-overview__copy small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.wallet-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.wallet-overview > div {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 3px 6px;
  padding: 12px 14px;
}

.wallet-overview > div + div {
  border-left: 1px solid var(--border);
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
  gap: 8px;
}

.count-card {
  min-width: 0;
  padding: 10px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: left;
  background: var(--surface-2);
}

button.count-card {
  width: 100%;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button.count-card:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.count-card.is-emphasis {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  background: var(--accent-soft);
}

.count-value {
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.count-label {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 12px;
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

:deep(.detail-section .el-descriptions__label) {
  min-width: 82px;
  width: 96px;
  color: var(--ink-3);
  font-weight: 500;
  white-space: nowrap;
}

:deep(.detail-section .el-descriptions__content) {
  min-width: 0;
  word-break: break-word;
}

.detail-section a {
  display: block;
  max-width: 230px;
  overflow: hidden;
  color: var(--accent-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 16px 20px 12px;
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

.user-detail-drawer .drawer-actions {
  margin: 0 20px 12px;
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
