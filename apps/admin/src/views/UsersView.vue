<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request, type Page } from '@/request'
import { usePagedList } from '@/usePagedList'
import {
  fenToYuan,
  formatTime,
  ledgerKindLabel,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TAG,
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
  role: string
  status: string
  balanceCents?: number
  createdAt: string
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
    submissions: number
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

interface UserOrder {
  id: string
  status: string
  amountCents: number
  planName?: string
  createdAt: string
}

interface UserTask {
  id: string
  type: string
  status: string
  costCents: number
  createdAt: string
}

const drawerVisible = ref(false)
const drawerUser = ref<AdminUser | null>(null)
const activeTab = ref('overview')
/** 已加载过的懒加载 Tab（账本/订单/任务），换用户后清空 */
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

const orderList = usePagedList<UserOrder>(
  (cursor) =>
    request<Page<UserOrder>>('/api/admin/orders', {
      query: { search: drawerUser.value?.email, limit: 20, cursor },
    }),
  () => drawerUser.value?.email ?? '',
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
  else if (tab === 'orders') orderList.reset()
  else if (tab === 'tasks') taskList.reset()
})

/** 抽屉里展示的用户（概览接口返回后以其为准） */
const drawerUserInfo = computed(() => overview.value?.user ?? drawerUser.value)

// ---------- 重置密码 ----------
const resetVisible = ref(false)
const resetForm = reactive({ newPassword: '' })
const resetSubmitting = ref(false)
/** 重置成功后仅展示一次的新密码 */
const resetDone = ref('')

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function openReset() {
  resetForm.newPassword = generatePassword()
  resetDone.value = ''
  resetVisible.value = true
}

async function submitReset() {
  if (!drawerUser.value) return
  const pwd = resetForm.newPassword.trim()
  if (pwd.length < 8) {
    ElMessage.warning('新密码至少 8 位')
    return
  }
  resetSubmitting.value = true
  try {
    await request(`/api/admin/users/${drawerUser.value.id}/reset-password`, {
      method: 'POST',
      body: { newPassword: pwd },
    })
    resetDone.value = pwd
    ElMessage.success('密码已重置，该用户所有登录态已失效')
  } finally {
    resetSubmitting.value = false
  }
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(resetDone.value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}
</script>

<template>
  <div class="page">
    <PageCard title="用户列表" subtitle="查看与管理全部注册用户，点击行查看详情">
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
        <el-table-column prop="email" label="邮箱" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click.stop="openDrawer(row as AdminUser)">
              {{ row.email }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户名" min-width="120">
          <template #default="{ row }">{{ row.username || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.role === 'admin'" type="danger" size="small">管理员</el-tag>
            <span v-else>用户</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'banned' ? 'danger' : 'success'" size="small">
              {{ row.status === 'banned' ? '已封禁' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="余额（元）" width="110" align="right" class-name="col-num">
          <template #default="{ row }">{{ fenToYuan(row.balanceCents) }}</template>
        </el-table-column>
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
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
        用户：{{ adjustTarget.email }}（当前余额 {{ fenToYuan(adjustTarget.balanceCents) }} 元）
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
    <el-drawer v-model="drawerVisible" size="640px">
      <template #header>
        <div class="drawer-header">
          <span class="drawer-title">{{ drawerUserInfo?.email ?? '用户详情' }}</span>
          <el-tag
            v-if="drawerUserInfo"
            :type="drawerUserInfo.status === 'banned' ? 'danger' : 'success'"
            size="small"
          >
            {{ drawerUserInfo.status === 'banned' ? '已封禁' : '正常' }}
          </el-tag>
        </div>
      </template>

      <template v-if="drawerUser">
        <div class="drawer-actions">
          <el-button size="small" @click="openAdjust(drawerUser)">调整余额</el-button>
          <el-button size="small" type="warning" plain @click="openReset">重置密码</el-button>
          <el-button
            size="small"
            :type="drawerUserInfo?.status === 'banned' ? 'success' : 'danger'"
            plain
            @click="drawerUserInfo && toggleBan(drawerUserInfo)"
          >
            {{ drawerUserInfo?.status === 'banned' ? '解封' : '封禁' }}
          </el-button>
        </div>

        <el-tabs v-model="activeTab">
          <el-tab-pane label="概览" name="overview">
            <div v-loading="overviewLoading">
              <template v-if="overview">
                <el-descriptions :column="2" size="small" border>
                  <el-descriptions-item label="邮箱" :span="2">{{ overview.user.email }}</el-descriptions-item>
                  <el-descriptions-item label="用户名">{{ overview.user.username || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="角色">
                    {{ overview.user.role === 'admin' ? '管理员' : '用户' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="注册时间" :span="2">
                    {{ formatTime(overview.user.createdAt) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="可用余额">
                    {{ fenToYuan(overview.wallet.balanceCents) }} 元
                  </el-descriptions-item>
                  <el-descriptions-item label="冻结金额">
                    {{ fenToYuan(overview.wallet.frozenCents) }} 元
                  </el-descriptions-item>
                </el-descriptions>

                <div class="count-cards">
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.orders }}</div>
                    <div class="count-label">订单</div>
                  </div>
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.tasksTotal }}</div>
                    <div class="count-label">任务总数</div>
                  </div>
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.tasksSucceeded }}</div>
                    <div class="count-label">成功</div>
                  </div>
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.tasksFailed }}</div>
                    <div class="count-label">失败</div>
                  </div>
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.tasksRunning }}</div>
                    <div class="count-label">运行中</div>
                  </div>
                  <div class="count-card">
                    <div class="count-value">{{ overview.counts.submissions }}</div>
                    <div class="count-label">投稿</div>
                  </div>
                </div>
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
                <template #default="{ row }">{{ row.reason || '-' }}</template>
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

          <el-tab-pane label="订单" name="orders">
            <el-table v-loading="orderList.loading.value" :data="orderList.items.value" size="small">
              <template #empty>
                <el-empty description="暂无订单" :image-size="60" />
              </template>
              <el-table-column label="订单ID" width="100">
                <template #default="{ row }">
                  <span class="mono" :title="row.id">{{ shortId(row.id) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="套餐" min-width="120">
                <template #default="{ row }">{{ row.planName ?? '-' }}</template>
              </el-table-column>
              <el-table-column label="金额（元）" width="100" align="right">
                <template #default="{ row }">{{ fenToYuan(row.amountCents) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="ORDER_STATUS_TAG[row.status] ?? 'info'" size="small">
                    {{ ORDER_STATUS_LABELS[row.status] ?? row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
            </el-table>
            <CursorPager
              :has-prev="orderList.hasPrev.value"
              :has-next="orderList.hasNext.value"
              :loading="orderList.loading.value"
              @prev="orderList.prev"
              @next="orderList.next"
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
              <el-table-column label="类型" width="110">
                <template #default="{ row }">{{ taskTypeLabel(row.type) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="TASK_STATUS_TAG[row.status] ?? 'info'" size="small">
                    {{ TASK_STATUS_LABELS[row.status] ?? row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="费用（元）" width="100" align="right">
                <template #default="{ row }">{{ fenToYuan(row.costCents) }}</template>
              </el-table-column>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
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

    <!-- 重置密码 -->
    <el-dialog v-model="resetVisible" title="重置密码" width="440px">
      <template v-if="!resetDone">
        <p v-if="drawerUser" class="text-muted" style="margin-top: 0">
          用户：{{ drawerUser.email }}。重置后该用户所有登录态将失效。
        </p>
        <el-form label-width="90px">
          <el-form-item label="新密码" required>
            <el-input v-model="resetForm.newPassword" placeholder="至少 8 位" style="width: 240px" />
            <el-button style="margin-left: 8px" @click="resetForm.newPassword = generatePassword()">
              随机生成
            </el-button>
          </el-form-item>
        </el-form>
      </template>
      <template v-else>
        <el-alert type="success" :closable="false" title="密码已重置，请立即复制并转交用户"
          description="关闭本窗口后将无法再次查看。" />
        <div class="reset-result">
          <span class="mono reset-password">{{ resetDone }}</span>
          <el-button size="small" @click="copyPassword">复制</el-button>
        </div>
      </template>
      <template #footer>
        <template v-if="!resetDone">
          <el-button @click="resetVisible = false">取消</el-button>
          <el-button type="primary" :loading="resetSubmitting" @click="submitReset">确认重置</el-button>
        </template>
        <el-button v-else type="primary" @click="resetVisible = false">我已保存，关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.row-clickable) {
  cursor: pointer;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-title {
  font-size: 15px;
  font-weight: 600;
}

.drawer-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.count-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.count-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: center;
}

.count-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.count-label {
  margin-top: 2px;
  color: var(--ink-3);
  font-size: 12px;
}

.delta-pos {
  color: var(--success);
}

.delta-neg {
  color: var(--warning);
}

.reset-result {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.reset-password {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
}
</style>
