<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import {
  fenToYuan,
  formatTime,
  ledgerKindLabel,
  shortId,
  TASK_STATUS_LABELS,
  TASK_STATUS_TAG,
  taskTypeLabel,
  yuanToFen,
} from '@/utils'

interface AdminUser {
  id: string
  email: string
  username: string | null
  avatarUrl?: string | null
  bio?: string
  location?: string
  websiteUrl?: string
  status: string
  lastLoginAt?: string | null
  submissionBannedUntil?: string | null
  wallet?: { balanceCents: number; frozenCents: number }
  /** 兼容旧版接口。 */
  balanceCents?: number
  createdAt: string
}

function displayName(user: AdminUser | null | undefined) {
  return String(user?.username || user?.email || '未知用户').trim()
}

function avatarInitial(user: AdminUser | null | undefined) {
  return displayName(user).slice(0, 1).toUpperCase() || '?'
}

function walletOf(user: AdminUser | null | undefined) {
  return {
    balanceCents: user?.wallet?.balanceCents ?? user?.balanceCents ?? 0,
    frozenCents: user?.wallet?.frozenCents ?? 0,
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

const filters = reactive({ search: '', status: '' })

const { items, loading, error, hasPrev, hasNext, reset, next, prev, refresh, retry } =
  usePagedList<AdminUser>(
    (cursor) =>
      request<Page<AdminUser>>('/api/admin/users', {
        query: { search: filters.search, status: filters.status, limit: 20, cursor },
      }),
    () => filters,
  )

onMounted(reset)

async function toggleBan(user: AdminUser) {
  const banning = user.status !== 'banned'
  await ElMessageBox.confirm(
    banning ? `确认封禁用户 ${user.email}？封禁后无法登录与提交任务。` : `确认解封用户 ${user.email}？`,
    banning ? '封禁用户' : '解封用户',
    { type: 'warning', confirmButtonText: banning ? '封禁' : '解封', cancelButtonText: '取消' },
  )
  await request(`/api/admin/users/${user.id}`, {
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
const adjustForm = reactive({ deltaYuan: 0, reason: '' })
const adjustSubmitting = ref(false)

const adjustCents = computed(() => yuanToFen(adjustForm.deltaYuan))

function openAdjust(user: AdminUser) {
  adjustTarget.value = user
  adjustForm.deltaYuan = 0
  adjustForm.reason = ''
  adjustVisible.value = true
}

async function submitAdjust() {
  if (!adjustTarget.value) return
  if (adjustCents.value === 0) {
    ElMessage.warning('调整金额不能为 0')
    return
  }
  if (!adjustForm.reason.trim()) {
    ElMessage.warning('请填写调整原因')
    return
  }
  adjustSubmitting.value = true
  try {
    await request(`/api/admin/users/${adjustTarget.value.id}/wallet-adjust`, {
      method: 'POST',
      body: { deltaCents: adjustCents.value, reason: adjustForm.reason.trim() },
    })
    ElMessage.success('余额调整成功')
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
  wallet: { balanceCents: number; frozenCents: number }
  counts: {
    orders: number
    tasksTotal: number
    tasksSucceeded: number
    tasksFailed: number
    tasksRunning: number
    tasksCanceled: number
    submissions: number
    assets: number
  }
  security: {
    activeSessions: number
    lastSessionIp: string | null
    lastSessionUserAgent: string | null
    lastSessionAt: string | null
    lastSessionExpiresAt: string | null
  }
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
}

const drawerVisible = ref(false)
const drawerUser = ref<AdminUser | null>(null)
const activeTab = ref('overview')
/** 已加载过的懒加载 Tab（账本/任务），换用户后清空 */
const loadedTabs = new Set<string>()

const overviewLoading = ref(false)
const overview = ref<UserDetail | null>(null)

const ledgerList = usePagedList<LedgerEntry>(
  (cursor) =>
    request<Page<LedgerEntry>>(`/api/admin/users/${drawerUser.value?.id}/ledger`, {
      query: { limit: 20, cursor },
    }),
  () => drawerUser.value?.id ?? '',
)

const taskList = usePagedList<UserTask>(
  (cursor) =>
    request<Page<UserTask>>('/api/admin/tasks', {
      query: { user: drawerUser.value?.id, limit: 20, cursor },
    }),
  () => drawerUser.value?.id ?? '',
)

async function loadOverview() {
  if (!drawerUser.value) return
  overviewLoading.value = true
  try {
    overview.value = await request<UserDetail>(`/api/admin/users/${drawerUser.value.id}`)
  } finally {
    overviewLoading.value = false
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

</script>

<template>
  <div class="page">
    <PageCard title="用户管理" subtitle="查看账号资料、资金状态、使用情况与安全信息">
      <div class="filter-bar">
        <el-input
          v-model="filters.search"
          placeholder="搜索邮箱 / 用户名"
          size="small"
          clearable
          style="width: 240px"
          @keyup.enter="reset"
          @clear="reset"
        />
        <el-select v-model="filters.status" placeholder="状态" size="small" clearable style="width: 120px" @change="reset">
          <el-option label="正常" value="active" />
          <el-option label="已封禁" value="banned" />
        </el-select>
        <el-button type="primary" size="small" @click="reset">查询</el-button>
        <el-button size="small" @click="filters.search = ''; filters.status = ''; reset()">重置</el-button>
      </div>

      <ListError :error="error" :loading="loading" @retry="retry" />

      <el-table
        v-loading="loading"
        :data="items"
        size="small"
        row-class-name="row-clickable"
        @row-click="(row: AdminUser) => openDrawer(row)"
      >
        <template #empty>
          <el-empty description="暂无用户" :image-size="60">
            <div class="empty-sub">调整筛选条件后重新查询</div>
          </el-empty>
        </template>
        <el-table-column label="用户" min-width="270">
          <template #default="{ row }">
            <button type="button" class="user-cell" @click.stop="openDrawer(row as AdminUser)">
              <span class="user-avatar">
                <img v-if="row.avatarUrl" :src="row.avatarUrl" :alt="displayName(row as AdminUser)" />
                <template v-else>{{ avatarInitial(row as AdminUser) }}</template>
              </span>
              <span class="user-cell__copy">
                <strong>{{ displayName(row as AdminUser) }}</strong>
                <small>{{ row.email }}</small>
                <code :title="row.id">{{ shortId(row.id) }}</code>
              </span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="资料" min-width="135">
          <template #default="{ row }">
            <div class="profile-state">
              <strong>{{ row.location || '未填写地区' }}</strong>
              <span>资料完整度 {{ profileCompleteness(row as AdminUser) }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="账号状态" width="120">
          <template #default="{ row }">
            <div class="status-stack">
              <el-tag :type="row.status === 'banned' ? 'danger' : 'success'" size="small">
                {{ row.status === 'banned' ? '已封禁' : '正常' }}
              </el-tag>
              <el-tag v-if="isSubmissionBanned(row as AdminUser)" type="warning" size="small" effect="plain">
                禁止投稿
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="资金（元）" width="135" align="right" class-name="col-num">
          <template #default="{ row }">
            <div class="money-cell">
              <strong>{{ fenToYuan(walletOf(row as AdminUser).balanceCents) }}</strong>
              <small>冻结 {{ fenToYuan(walletOf(row as AdminUser).frozenCents) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近活动" min-width="165">
          <template #default="{ row }">
            <div class="activity-cell">
              <strong>{{ row.lastLoginAt ? formatTime(row.lastLoginAt) : '从未登录' }}</strong>
              <small>注册 {{ formatTime(row.createdAt) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click.stop="openAdjust(row as AdminUser)">调整余额</el-button>
            <el-button
              size="small"
              :type="row.status === 'banned' ? 'success' : 'danger'"
              plain
              @click.stop="toggleBan(row as AdminUser)"
            >
              {{ row.status === 'banned' ? '解封' : '封禁' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <CursorPager :has-prev="hasPrev" :has-next="hasNext" :loading="loading" @prev="prev" @next="next" />
    </PageCard>

    <!-- 调整余额 -->
    <el-dialog v-model="adjustVisible" title="调整余额" width="440px">
      <p v-if="adjustTarget" class="text-muted" style="margin-top: 0">
        用户：{{ adjustTarget.email }}（当前余额 {{ fenToYuan(walletOf(adjustTarget).balanceCents) }} 元）
      </p>
      <el-form label-width="90px">
        <el-form-item label="金额（元）" required>
          <el-input-number
            v-model="adjustForm.deltaYuan"
            :min="-100000"
            :max="100000"
            :precision="2"
            :step="1"
            style="width: 200px"
          />
          <div class="text-muted">
            正数入账、负数扣减，单次范围 ±100000 元；实际写入 {{ adjustCents }} 分，记入钱包账本
          </div>
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input v-model="adjustForm.reason" type="textarea" :rows="2" placeholder="必填，例如：活动补偿" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="adjustSubmitting" @click="submitAdjust">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="drawerVisible" size="min(760px, 96vw)" class="user-detail-drawer">
      <template #header>
        <div v-if="drawerUserInfo" class="drawer-header">
          <span class="drawer-avatar">
            <img v-if="drawerUserInfo.avatarUrl" :src="drawerUserInfo.avatarUrl" :alt="displayName(drawerUserInfo)" />
            <template v-else>{{ avatarInitial(drawerUserInfo) }}</template>
          </span>
          <span class="drawer-heading">
            <strong>{{ displayName(drawerUserInfo) }}</strong>
            <small>{{ drawerUserInfo.email }}</small>
          </span>
          <span class="drawer-statuses">
            <el-tag :type="drawerUserInfo.status === 'banned' ? 'danger' : 'success'" size="small">
              {{ drawerUserInfo.status === 'banned' ? '已封禁' : '正常' }}
            </el-tag>
            <el-tag v-if="isSubmissionBanned(drawerUserInfo)" type="warning" size="small" effect="plain">
              禁止投稿
            </el-tag>
          </span>
        </div>
      </template>

      <template v-if="drawerUser">
        <div class="drawer-actions">
          <span>用户 ID：<code :title="drawerUser.id">{{ shortId(drawerUser.id) }}</code></span>
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
          <el-tab-pane label="资料概览" name="overview">
            <div v-loading="overviewLoading" class="overview-panel">
              <template v-if="overview">
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
                    <el-descriptions-item label="投稿限制" :span="2">
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
                      <small>可用余额</small>
                      <strong>{{ fenToYuan(drawerWallet.balanceCents) }}</strong>
                      <span>元</span>
                    </div>
                    <div>
                      <small>冻结金额</small>
                      <strong>{{ fenToYuan(drawerWallet.frozenCents) }}</strong>
                      <span>元</span>
                    </div>
                    <div>
                      <small>资金合计</small>
                      <strong>{{ fenToYuan(drawerWallet.balanceCents + drawerWallet.frozenCents) }}</strong>
                      <span>元</span>
                    </div>
                  </div>
                </section>

                <section class="detail-section">
                  <header class="detail-section__title">使用情况</header>
                  <div class="count-cards">
                    <div class="count-card is-emphasis">
                      <div class="count-value">{{ overview.counts.tasksTotal }}</div>
                      <div class="count-label">任务总数</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ taskSuccessRate }}%</div>
                      <div class="count-label">任务成功率</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.tasksSucceeded }}</div>
                      <div class="count-label">成功任务</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.tasksFailed }}</div>
                      <div class="count-label">失败任务</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.tasksRunning }}</div>
                      <div class="count-label">运行中</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.tasksCanceled }}</div>
                      <div class="count-label">已取消</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.submissions }}</div>
                      <div class="count-label">投稿</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.assets }}</div>
                      <div class="count-label">素材</div>
                    </div>
                    <div class="count-card">
                      <div class="count-value">{{ overview.counts.orders }}</div>
                      <div class="count-label">订单记录</div>
                    </div>
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
            </div>
          </el-tab-pane>

          <el-tab-pane label="账本" name="ledger">
            <el-table v-loading="ledgerList.loading.value" :data="ledgerList.items.value" size="small">
              <template #empty>
                <el-empty description="暂无流水" :image-size="60" />
              </template>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="类型" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.deltaCents >= 0 ? 'success' : 'warning'">
                    {{ ledgerKindLabel(row.kind) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="变动（元）" width="100" align="right">
                <template #default="{ row }">
                  <span :class="row.deltaCents >= 0 ? 'delta-pos' : 'delta-neg'">
                    {{ row.deltaCents >= 0 ? '+' : '' }}{{ fenToYuan(row.deltaCents) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="余额（元）" width="100" align="right">
                <template #default="{ row }">{{ fenToYuan(row.balanceAfterCents) }}</template>
              </el-table-column>
              <el-table-column label="原因" min-width="140">
                <template #default="{ row }">
                  <div class="ledger-reason">
                    <span>{{ row.reason || '-' }}</span>
                    <small v-if="row.sourceType" :title="row.sourceId || ''">
                      {{ row.sourceType }}<template v-if="row.sourceId"> · {{ shortId(row.sourceId) }}</template>
                    </small>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <CursorPager
              :has-prev="ledgerList.hasPrev.value"
              :has-next="ledgerList.hasNext.value"
              :loading="ledgerList.loading.value"
              @prev="ledgerList.prev"
              @next="ledgerList.next"
            />
          </el-tab-pane>

          <el-tab-pane label="任务" name="tasks">
            <el-table v-loading="taskList.loading.value" :data="taskList.items.value" size="small">
              <template #empty>
                <el-empty description="暂无任务" :image-size="60" />
              </template>
              <el-table-column label="任务ID" width="100">
                <template #default="{ row }">
                  <span class="mono" :title="row.id">{{ shortId(row.id) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="类型 / 模型" min-width="145">
                <template #default="{ row }">
                  <div class="task-kind">
                    <strong>{{ taskTypeLabel(row.type) }}</strong>
                    <small :title="row.model || ''">{{ row.model || '未记录模型' }}</small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="105">
                <template #default="{ row }">
                  <div class="task-status">
                    <el-tag :type="TASK_STATUS_TAG[row.status] ?? 'info'" size="small">
                      {{ TASK_STATUS_LABELS[row.status] ?? row.status }}
                    </el-tag>
                    <small v-if="row.attempt">尝试 {{ row.attempt }} 次</small>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="费用（元）" width="100" align="right">
                <template #default="{ row }">{{ fenToYuan(row.costCents) }}</template>
              </el-table-column>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">
                  <span :title="row.errorMessage || ''">{{ formatTime(row.createdAt) }}</span>
                </template>
              </el-table-column>
            </el-table>
            <CursorPager
              :has-prev="taskList.hasPrev.value"
              :has-next="taskList.hasNext.value"
              :loading="taskList.loading.value"
              @prev="taskList.prev"
              @next="taskList.next"
            />
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>

  </div>
</template>

<style scoped>
:deep(.row-clickable) {
  cursor: pointer;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
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
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
}

.user-avatar {
  width: 36px;
  height: 36px;
  font-size: 12px;
}

.user-avatar img,
.drawer-avatar img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-cell__copy,
.profile-state,
.money-cell,
.activity-cell,
.ledger-reason,
.task-kind,
.task-status {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.user-cell__copy strong,
.user-cell__copy small,
.user-cell__copy code,
.profile-state strong,
.activity-cell strong,
.activity-cell small,
.task-kind small,
.ledger-reason span,
.ledger-reason small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-cell__copy strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
}

.user-cell__copy small,
.profile-state span,
.money-cell small,
.activity-cell small,
.ledger-reason small,
.task-kind small,
.task-status small {
  color: var(--ink-3);
  font-size: 10px;
}

.user-cell__copy code {
  color: var(--ink-3);
  font-size: 9px;
}

.profile-state strong,
.activity-cell strong,
.money-cell strong,
.task-kind strong {
  color: var(--el-text-color-primary);
  font-size: 12px;
}

.status-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.money-cell {
  justify-items: end;
}

.drawer-header {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding-right: 12px;
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

.drawer-heading strong,
.drawer-heading small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-heading strong {
  color: var(--el-text-color-primary);
  font-size: 15px;
}

.drawer-heading small {
  color: var(--ink-3);
  font-size: 11px;
}

.drawer-statuses {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
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

.drawer-actions code {
  color: var(--ink-2);
}

.overview-panel {
  min-height: 260px;
  padding-bottom: 8px;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.wallet-overview span {
  color: var(--ink-3);
  font-size: 10px;
}

.count-cards {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.count-card {
  min-width: 0;
  padding: 9px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: center;
  background: var(--surface-2);
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

.delta-pos {
  color: var(--success);
}

.delta-neg {
  color: var(--warning);
}

:deep(.user-detail-tabs .el-tabs__header) {
  margin-bottom: 14px;
}

:deep(.user-detail-drawer .el-drawer__body) {
  padding-top: 8px;
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

@media (max-width: 720px) {
  .profile-overview,
  .wallet-overview {
    grid-template-columns: 1fr;
  }

  .wallet-overview > div + div {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .count-cards {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .drawer-statuses {
    display: none;
  }
}

</style>
