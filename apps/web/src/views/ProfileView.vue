<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  deleteMyGallerySubmission,
  getOverview,
  listMyGallerySubmissions,
  listNotifications,
  markNotificationsRead,
  updateProfile,
} from '@/services/meApi'
import { deleteTask, listTasks, TASK_TYPE_LABELS } from '@/services/tasksApi'
import { submitShareItem } from '@/services/shareGallery'
import { formatCents } from '@/services/billingApi'
import notificationService from '@/services/notification'

const router = useRouter()
const authStore = useAuthStore()

const TABS = [
  { id: 'works', label: '我的作品', icon: 'bi-images' },
  { id: 'submissions', label: '我的投稿', icon: 'bi-send-check' },
  { id: 'notifications', label: '通知', icon: 'bi-bell' },
  { id: 'account', label: '账号设置', icon: 'bi-person-gear' },
]
const activeTab = ref('works')

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

// ---- 我的作品（任务列表） ----
const tasks = ref([])
const tasksLoading = ref(false)
const tasksCursor = ref(null)
const taskTypeFilter = ref('')
const previewTask = ref(null)
const deletingTaskId = ref('')
const submittingTaskId = ref('')

// ---- 我的投稿 ----
const submissions = ref([])
const submissionsLoading = ref(false)
const submissionsCursor = ref(null)
const submissionsLoaded = ref(false)

// ---- 通知 ----
const notifications = ref([])
const notificationsLoading = ref(false)
const notificationsCursor = ref(null)
const notificationsLoaded = ref(false)

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

async function loadSubmissions({ append = false } = {}) {
  if (submissionsLoading.value) return
  submissionsLoading.value = true
  try {
    const { items, nextCursor } = await listMyGallerySubmissions({
      limit: 12,
      cursor: append ? submissionsCursor.value || '' : '',
    })
    submissions.value = append ? [...submissions.value, ...items] : items
    submissionsCursor.value = nextCursor
    submissionsLoaded.value = true
  } catch (error) {
    notificationService.error(error?.message || '投稿列表读取失败')
  } finally {
    submissionsLoading.value = false
  }
}

async function loadNotifications({ append = false } = {}) {
  if (notificationsLoading.value) return
  notificationsLoading.value = true
  try {
    const { items, nextCursor } = await listNotifications({
      limit: 15,
      cursor: append ? notificationsCursor.value || '' : '',
    })
    notifications.value = append ? [...notifications.value, ...items] : items
    notificationsCursor.value = nextCursor
    notificationsLoaded.value = true
  } catch (error) {
    notificationService.error(error?.message || '通知读取失败')
  } finally {
    notificationsLoading.value = false
  }
}

function switchTab(tabId) {
  activeTab.value = tabId
  if (tabId === 'submissions' && !submissionsLoaded.value) void loadSubmissions()
  if (tabId === 'notifications' && !notificationsLoaded.value) void loadNotifications()
}

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

async function submitToGallery(task) {
  if (submittingTaskId.value) return
  const title = window.prompt('给作品起个标题：', task.prompt?.slice(0, 40) || 'AI 作品')
  if (title === null) return
  submittingTaskId.value = task.id
  try {
    await submitShareItem({ taskId: task.id, title: title.trim() || 'AI 作品' })
    notificationService.success('已提交审核，可在「我的投稿」查看进度')
    submissionsLoaded.value = false
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
  void loadTasks()
})
</script>

<template>
  <div class="profile-page">
    <!-- 账号信息卡 -->
    <section class="profile-hero">
      <div class="profile-identity">
        <span class="profile-avatar">
          <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" alt="头像" />
          <i v-else class="bi bi-person-fill"></i>
        </span>
        <div>
          <h1>{{ authStore.displayName }}</h1>
          <p>{{ authStore.user?.email }}</p>
          <small>注册于 {{ formatTime(authStore.user?.createdAt) }}</small>
        </div>
      </div>
      <button type="button" class="profile-btn is-ghost" @click="handleLogout">
        <i class="bi bi-box-arrow-right"></i> 退出登录
      </button>
    </section>

    <!-- 数据总览 -->
    <section class="profile-stats">
      <article>
        <span>可用余额</span>
        <strong>{{
          formatCents(
            Math.max(
              0,
              Number(overview?.wallet?.balanceCents || 0) - Number(overview?.wallet?.frozenCents || 0),
            ),
          )
        }}</strong>
        <RouterLink to="/pricing">去充值 <i class="bi bi-arrow-right"></i></RouterLink>
      </article>
      <article>
        <span>任务总数</span>
        <strong>{{ taskStats.total ?? '—' }}</strong>
        <small>进行中 {{ taskStats.running || 0 }}</small>
      </article>
      <article>
        <span>成功率</span>
        <strong>{{ successRate }}</strong>
        <small>成功 {{ taskStats.succeeded || 0 }} / 失败 {{ taskStats.failed || 0 }}</small>
      </article>
      <article>
        <span>未读通知</span>
        <strong>{{ unreadCount }}</strong>
        <button type="button" class="profile-link-btn" @click="switchTab('notifications')">查看通知</button>
      </article>
    </section>

    <div v-if="typeStatRows.length" class="profile-type-stats">
      <span v-for="row in typeStatRows" :key="row.type" class="profile-type-chip">
        {{ row.label }} × {{ row.count }}
      </span>
    </div>

    <!-- Tab 导航 -->
    <nav class="profile-tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        :class="{ 'is-active': activeTab === tab.id }"
        @click="switchTab(tab.id)"
      >
        <i class="bi" :class="tab.icon"></i>
        {{ tab.label }}
        <em v-if="tab.id === 'notifications' && unreadCount > 0">{{ unreadCount }}</em>
      </button>
    </nav>

    <!-- 我的作品 -->
    <section v-show="activeTab === 'works'" class="profile-panel">
      <div class="works-filter">
        <button
          type="button"
          :class="{ 'is-active': taskTypeFilter === '' }"
          @click="setTaskFilter('')"
        >全部</button>
        <button
          v-for="(label, type) in TASK_TYPE_LABELS"
          :key="type"
          type="button"
          :class="{ 'is-active': taskTypeFilter === type }"
          @click="setTaskFilter(type)"
        >{{ label }}</button>
      </div>

      <div v-if="tasks.length" class="works-grid">
        <article v-for="task in tasks" :key="task.id" class="work-card">
          <button
            type="button"
            class="work-cover"
            :disabled="!task.outputUrls?.length"
            @click="previewTask = task"
          >
            <img
              v-if="task.outputUrls?.length"
              :src="task.outputUrls[0]"
              :alt="task.prompt || 'AI 作品'"
              loading="lazy"
            />
            <span v-else class="work-cover-placeholder">
              <i class="bi" :class="task.status === 'failed' ? 'bi-x-circle' : 'bi-hourglass-split'"></i>
              {{ TASK_STATUS_LABELS[task.status] || task.status }}
            </span>
          </button>
          <div class="work-meta">
            <span class="work-type">{{ TASK_TYPE_LABELS[task.type] || task.type }}</span>
            <span class="work-status" :data-status="task.status">{{ TASK_STATUS_LABELS[task.status] || task.status }}</span>
          </div>
          <p class="work-prompt" :title="task.prompt">{{ task.prompt || '（无提示词）' }}</p>
          <small>{{ formatTime(task.createdAt) }} · {{ formatCents(task.costCents) }}</small>
          <div class="work-actions">
            <button
              v-if="task.status === 'succeeded' && task.outputUrls?.length"
              type="button"
              :disabled="submittingTaskId === task.id"
              @click="submitToGallery(task)"
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
      <p v-else-if="!tasksLoading" class="profile-empty">还没有创作记录，去工作台生成第一张图吧。</p>

      <button
        v-if="tasksCursor"
        type="button"
        class="profile-btn is-ghost"
        :disabled="tasksLoading"
        @click="loadTasks({ append: true })"
      >
        {{ tasksLoading ? '加载中…' : '加载更多' }}
      </button>
    </section>

    <!-- 我的投稿 -->
    <section v-show="activeTab === 'submissions'" class="profile-panel">
      <ul v-if="submissions.length" class="submission-list">
        <li v-for="submission in submissions" :key="submission.id">
          <img
            v-if="submission.coverUrl || submission.mediaUrls?.length"
            :src="submission.coverUrl || submission.mediaUrls[0]"
            alt=""
            loading="lazy"
          />
          <div class="submission-body">
            <strong>{{ submission.title || 'AI 作品' }}</strong>
            <small>{{ formatTime(submission.createdAt) }}</small>
            <p v-if="submission.rejectReason" class="submission-reason">原因：{{ submission.rejectReason }}</p>
          </div>
          <span class="submission-status" :data-status="submission.status">
            {{ SUBMISSION_STATUS_LABELS[submission.status] || submission.status }}
          </span>
          <button type="button" class="submission-remove" title="撤回/删除" @click="removeSubmission(submission)">
            <i class="bi bi-trash3"></i>
          </button>
        </li>
      </ul>
      <p v-else-if="submissionsLoaded && !submissionsLoading" class="profile-empty">
        还没有投稿，在「我的作品」里把成功任务投稿到画廊吧。
      </p>
      <button
        v-if="submissionsCursor"
        type="button"
        class="profile-btn is-ghost"
        :disabled="submissionsLoading"
        @click="loadSubmissions({ append: true })"
      >
        {{ submissionsLoading ? '加载中…' : '加载更多' }}
      </button>
    </section>

    <!-- 通知 -->
    <section v-show="activeTab === 'notifications'" class="profile-panel">
      <div class="notifications-toolbar">
        <button type="button" class="profile-btn is-ghost" @click="markAllRead">
          <i class="bi bi-check2-all"></i> 全部已读
        </button>
      </div>
      <ul v-if="notifications.length" class="notification-list">
        <li v-for="item in notifications" :key="item.id" :class="{ 'is-unread': !item.readAt }">
          <span class="notification-dot" aria-hidden="true"></span>
          <div>
            <strong>{{ item.title }}</strong>
            <p v-if="item.body">{{ item.body }}</p>
            <small>{{ formatTime(item.createdAt) }}</small>
          </div>
        </li>
      </ul>
      <p v-else-if="notificationsLoaded && !notificationsLoading" class="profile-empty">暂无通知。</p>
      <button
        v-if="notificationsCursor"
        type="button"
        class="profile-btn is-ghost"
        :disabled="notificationsLoading"
        @click="loadNotifications({ append: true })"
      >
        {{ notificationsLoading ? '加载中…' : '加载更多' }}
      </button>
    </section>

    <!-- 账号设置 -->
    <section v-show="activeTab === 'account'" class="profile-panel">
      <div class="account-forms">
        <form class="account-form" @submit.prevent="saveUsername">
          <h3><i class="bi bi-person-badge"></i> 修改用户名</h3>
          <label>
            <span>用户名</span>
            <input v-model="profileForm.username" maxlength="24" placeholder="输入新的用户名" />
          </label>
          <button type="submit" class="profile-btn is-primary" :disabled="profileForm.saving">
            {{ profileForm.saving ? '保存中…' : '保存' }}
          </button>
        </form>

        <form class="account-form" @submit.prevent="savePassword">
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
          <button type="submit" class="profile-btn is-primary" :disabled="passwordForm.saving">
            {{ passwordForm.saving ? '保存中…' : '更新密码' }}
          </button>
        </form>
      </div>
    </section>

    <!-- 产物大图预览 -->
    <Teleport to="body">
      <div v-if="previewTask" class="work-preview-backdrop" @click.self="previewTask = null">
        <div class="work-preview-panel">
          <header>
            <strong>{{ TASK_TYPE_LABELS[previewTask.type] || previewTask.type }}</strong>
            <button type="button" aria-label="关闭" @click="previewTask = null"><i class="bi bi-x-lg"></i></button>
          </header>
          <div class="work-preview-media">
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
          <p class="work-preview-prompt">{{ previewTask.prompt }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(24px, 5vh, 44px) clamp(16px, 3vw, 32px) 80px;
  color: var(--text-color, #f0f0f0);
}

.profile-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(150deg, rgba(99, 102, 241, 0.1), rgba(15, 23, 42, 0.55) 60%);
}

.profile-identity { display: flex; align-items: center; gap: 16px; }

.profile-avatar {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  font-size: 28px;
  color: #a5b4fc;
  background: rgba(99, 102, 241, 0.16);
}

.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-identity h1 { margin: 0; font-size: 22px; }
.profile-identity p { margin: 2px 0 0; font-size: 13.5px; color: rgba(203, 213, 225, 0.66); }
.profile-identity small { font-size: 12px; color: rgba(148, 163, 184, 0.55); }

.profile-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.profile-stats article {
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  gap: 4px;
}

.profile-stats span { font-size: 12.5px; color: rgba(203, 213, 225, 0.58); }
.profile-stats strong { font-size: 24px; }
.profile-stats small { font-size: 12px; color: rgba(148, 163, 184, 0.55); }
.profile-stats a,
.profile-link-btn {
  font-size: 12.5px;
  color: #a5b4fc;
  text-decoration: none;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.profile-type-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }

.profile-type-chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  color: rgba(226, 232, 240, 0.75);
  background: rgba(148, 163, 184, 0.12);
}

.profile-tabs {
  display: flex;
  gap: 6px;
  margin-top: 28px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  overflow-x: auto;
}

.profile-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 11px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: rgba(203, 213, 225, 0.62);
  font-size: 14.5px;
  cursor: pointer;
  white-space: nowrap;
}

.profile-tabs button.is-active { color: #e0e7ff; border-bottom-color: #a5b4fc; }

.profile-tabs em {
  font-style: normal;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  color: #0b1020;
  background: #fbbf24;
}

.profile-panel { padding-top: 20px; }

.works-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }

.works-filter button {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: transparent;
  color: rgba(203, 213, 225, 0.7);
  font-size: 13px;
  cursor: pointer;
}

.works-filter button.is-active {
  border-color: rgba(165, 180, 252, 0.6);
  color: #e0e7ff;
  background: rgba(99, 102, 241, 0.16);
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

.work-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.5);
}

.work-cover {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: none;
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  cursor: zoom-in;
  background: rgba(30, 41, 59, 0.6);
}

.work-cover:disabled { cursor: default; }
.work-cover img { width: 100%; height: 100%; object-fit: cover; }

.work-cover-placeholder {
  display: grid;
  place-items: center;
  gap: 6px;
  height: 100%;
  font-size: 13px;
  color: rgba(203, 213, 225, 0.55);
}

.work-meta { display: flex; justify-content: space-between; align-items: center; }
.work-type { font-size: 12px; color: #a5b4fc; }

.work-status {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.work-status[data-status='succeeded'] { color: #34d399; background: rgba(52, 211, 153, 0.12); }
.work-status[data-status='failed'] { color: #f87171; background: rgba(248, 113, 113, 0.12); }
.work-status[data-status='running'],
.work-status[data-status='queued'] { color: #fbbf24; background: rgba(251, 191, 36, 0.12); }

.work-prompt {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(226, 232, 240, 0.72);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.work-card small { font-size: 11.5px; color: rgba(148, 163, 184, 0.5); }

.work-actions { display: flex; gap: 8px; }

.work-actions button {
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: transparent;
  color: rgba(226, 232, 240, 0.78);
  font-size: 12.5px;
  cursor: pointer;
}

.work-actions button:hover:not(:disabled) { border-color: rgba(165, 180, 252, 0.5); }
.work-actions .is-danger { color: #f87171; }
.work-actions .is-danger:hover:not(:disabled) { border-color: rgba(248, 113, 113, 0.5); }

.submission-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }

.submission-list li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.5);
}

.submission-list img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; }
.submission-body { flex: 1; min-width: 0; }
.submission-body strong { display: block; font-size: 14.5px; }
.submission-body small { font-size: 12px; color: rgba(148, 163, 184, 0.55); }
.submission-reason { margin: 4px 0 0; font-size: 12.5px; color: #f87171; }

.submission-status {
  flex-shrink: 0;
  font-size: 12px;
  padding: 3px 11px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
}

.submission-status[data-status='pending'] { color: #fbbf24; background: rgba(251, 191, 36, 0.12); }
.submission-status[data-status='approved'] { color: #34d399; background: rgba(52, 211, 153, 0.12); }
.submission-status[data-status='rejected'],
.submission-status[data-status='removed'] { color: #f87171; background: rgba(248, 113, 113, 0.12); }

.submission-remove {
  border: none;
  background: transparent;
  color: rgba(203, 213, 225, 0.5);
  cursor: pointer;
  font-size: 15px;
}

.submission-remove:hover { color: #f87171; }

.notifications-toolbar { display: flex; justify-content: flex-end; margin-bottom: 14px; }

.notification-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }

.notification-list li {
  display: flex;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.45);
}

.notification-list li.is-unread { border-color: rgba(165, 180, 252, 0.35); background: rgba(99, 102, 241, 0.08); }

.notification-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.3);
}

.notification-list li.is-unread .notification-dot { background: #a5b4fc; }
.notification-list strong { font-size: 14px; }
.notification-list p { margin: 3px 0 0; font-size: 13px; color: rgba(203, 213, 225, 0.66); }
.notification-list small { font-size: 11.5px; color: rgba(148, 163, 184, 0.5); }

.account-forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.account-form {
  display: grid;
  gap: 12px;
  padding: 20px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.5);
}

.account-form h3 { margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.account-form label { display: grid; gap: 6px; }
.account-form label span { font-size: 12.5px; color: rgba(203, 213, 225, 0.6); }

.account-form input {
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(2, 6, 23, 0.5);
  color: inherit;
  outline: none;
}

.account-form input:focus { border-color: rgba(165, 180, 252, 0.55); }

.profile-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.profile-btn.is-primary {
  border: none;
  color: #0b1020;
  background: linear-gradient(120deg, #a5b4fc, #67e8f9);
}

.profile-btn.is-primary:disabled { opacity: 0.55; cursor: not-allowed; }

.profile-btn.is-ghost {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: transparent;
  color: rgba(226, 232, 240, 0.78);
}

.profile-empty { padding: 30px 0; color: rgba(203, 213, 225, 0.5); font-size: 14px; }

.work-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3600;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 6, 23, 0.8);
  backdrop-filter: blur(10px);
}

.work-preview-panel {
  width: min(880px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: #0f172a;
  padding: 18px 20px;
}

.work-preview-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.work-preview-panel header button {
  border: none;
  background: transparent;
  color: rgba(226, 232, 240, 0.7);
  cursor: pointer;
}

.work-preview-media { display: grid; gap: 12px; }
.work-preview-media img { width: 100%; border-radius: 10px; }
.work-preview-prompt { margin: 14px 0 0; font-size: 13.5px; color: rgba(203, 213, 225, 0.68); }
</style>
