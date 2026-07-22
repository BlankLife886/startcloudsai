<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Bell,
  ChatDotRound,
  CollectionTag,
  Document,
  List,
  Lock,
  MagicStick,
  Monitor,
  Moon,
  Odometer,
  Picture,
  Setting,
  Sunny,
  SwitchButton,
  Ticket,
  User,
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/request'
import { isDark, toggleTheme } from '@/theme'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const NAV_GROUPS = [
  {
    title: '总览',
    items: [{ path: '/', label: '仪表盘', icon: Odometer }],
  },
  {
    title: '业务',
    items: [
      { path: '/users', label: '用户管理', icon: User },
      { path: '/tasks', label: '任务监控', icon: Monitor },
    ],
  },
  {
    title: '社区运营',
    items: [
      { path: '/prompt-library', label: '提示词库', icon: CollectionTag },
      { path: '/community', label: '社区管理', icon: ChatDotRound },
      { path: '/gallery', label: '投稿审核', icon: Picture },
    ],
  },
  {
    title: '资金',
    items: [
      { path: '/codes', label: '兑换码', icon: Ticket },
      { path: '/audit', label: '审计日志', icon: List },
    ],
  },
  {
    title: '系统',
    items: [
      { path: '/content', label: '内容管理', icon: Document },
      { path: '/settings', label: '系统设置', icon: Setting },
    ],
  },
]

const displayName = computed(() => auth.user?.username || auth.user?.email || '管理员')
const avatarInitial = computed(() => displayName.value.slice(0, 1).toUpperCase())

/* ---------- 待办数（侧边栏徽标 + 通知铃），失败静默 ---------- */

const pendingSubmissions = ref(0)
/** 待审数超出单页时展示 N+ */
const pendingHasMore = ref(false)
const runningTasks = ref(0)

async function loadTodoCounts() {
  try {
    const data = await request<{ items: unknown[]; nextCursor: string | null; total?: number }>(
      '/api/admin/gallery/submissions',
      { query: { status: 'pending', limit: 50 }, silent: true },
    )
    if (typeof data.total === 'number') {
      pendingSubmissions.value = data.total
      pendingHasMore.value = false
    } else {
      pendingSubmissions.value = data.items?.length ?? 0
      pendingHasMore.value = Boolean(data.nextCursor)
    }
  } catch {
    // 静默：徽标缺失不影响使用
  }
  try {
    const stats = await request<{ runningTasks?: number }>('/api/admin/stats', { silent: true })
    runningTasks.value = stats.runningTasks ?? 0
  } catch {
    // 静默
  }
}

const pendingBadgeText = computed(() => {
  if (pendingSubmissions.value <= 0) return ''
  return pendingHasMore.value ? `${pendingSubmissions.value}+` : String(pendingSubmissions.value)
})

const notifyItems = computed(() =>
  [
    {
      key: 'pending',
      label: '投稿待审核',
      count: pendingSubmissions.value,
      countText: pendingBadgeText.value,
      tone: 'warning',
      icon: Picture,
      to: '/gallery',
    },
    {
      key: 'running',
      label: '任务运行中',
      count: runningTasks.value,
      countText: String(runningTasks.value),
      tone: 'info',
      icon: MagicStick,
      to: '/tasks',
    },
  ].filter((item) => item.count > 0),
)

const notifyTotal = computed(() => notifyItems.value.reduce((sum, item) => sum + item.count, 0))

onMounted(loadTodoCounts)
watch(() => route.path, loadTodoCounts)

function goTodo(to: string) {
  router.push(to)
}

/* ---------- 主题 / 用户菜单 ---------- */

async function onLogout() {
  await auth.logout()
  router.push('/login')
}

function onUserCommand(command: string) {
  if (command === 'logout') void onLogout()
  else if (command === 'password') openPassword()
}

/* ---------- 修改密码 ---------- */

const passwordOpen = ref(false)
const passwordSubmitting = ref(false)
const passwordForm = reactive({ old: '', next: '', confirm: '' })

function openPassword() {
  passwordForm.old = ''
  passwordForm.next = ''
  passwordForm.confirm = ''
  passwordOpen.value = true
}

async function submitPassword() {
  if (!passwordForm.old) {
    ElMessage.warning('请输入旧密码')
    return
  }
  if (passwordForm.next.length < 12) {
    ElMessage.warning('管理员密码至少 12 位')
    return
  }
  if (passwordForm.next !== passwordForm.confirm) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  passwordSubmitting.value = true
  try {
    await request('/api/admin/auth/password', {
	  method: 'PATCH',
	  body: { old: passwordForm.old, new: passwordForm.next },
    })
    passwordOpen.value = false
    ElMessage.success('密码已修改，请重新登录')
    await auth.logout()
    router.push('/login')
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<template>
  <div class="layout">
    <!-- ==== 侧边栏 ==== -->
    <aside class="aside">
      <div class="logo">
        <span class="logo-mark">
          <el-icon :size="18"><MagicStick /></el-icon>
        </span>
        <span class="logo-copy">
          <strong>星空云绘</strong>
          <small>StartClouds · 管理后台</small>
        </span>
      </div>

      <nav class="nav">
        <div v-for="group in NAV_GROUPS" :key="group.title" class="nav-group">
          <div class="nav-group__title">{{ group.title }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ 'is-active': route.path === item.path }"
          >
            <el-icon :size="17"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
            <em v-if="item.path === '/gallery' && pendingBadgeText" class="nav-badge tnum">
              {{ pendingBadgeText }}
            </em>
          </router-link>
        </div>
      </nav>

      <div class="user-card">
        <span class="user-avatar">{{ avatarInitial }}</span>
        <div class="user-meta">
          <strong :title="displayName">{{ displayName }}</strong>
          <span class="badge badge--accent">管理员</span>
        </div>
        <button type="button" class="user-logout" title="退出登录" @click="onLogout">
          <el-icon :size="15"><SwitchButton /></el-icon>
        </button>
      </div>
    </aside>

    <!-- ==== 主区域 ==== -->
    <div class="main-col">
      <header class="topbar">
        <div class="crumb">
          <span>星空云绘</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-current">{{ route.meta.title }}</span>
        </div>

        <div class="topbar-actions">
          <!-- 通知铃 -->
          <el-popover placement="bottom-end" :width="300" trigger="click" popper-class="notify-popper">
            <template #reference>
              <button type="button" class="icon-btn" title="通知中心">
                <el-icon :size="16"><Bell /></el-icon>
                <em v-if="notifyTotal > 0" class="icon-btn__dot tnum">
                  {{ notifyTotal > 99 ? '99+' : notifyTotal }}
                </em>
              </button>
            </template>
            <div class="notify-panel">
              <div class="notify-panel__title">待办通知 · {{ notifyTotal }} 项</div>
              <div v-if="!notifyItems.length" class="notify-panel__empty">全部处理完毕</div>
              <button
                v-for="item in notifyItems"
                :key="item.key"
                type="button"
                class="notify-row"
                @click="goTodo(item.to)"
              >
                <span class="notify-row__icon" :class="`is-${item.tone}`">
                  <el-icon :size="15"><component :is="item.icon" /></el-icon>
                </span>
                <span class="notify-row__label">{{ item.label }}</span>
                <span class="notify-row__count tnum">{{ item.countText }}</span>
              </button>
            </div>
          </el-popover>

          <!-- 主题切换 -->
          <button type="button" class="icon-btn" :title="isDark ? '切换为浅色' : '切换为深色'" @click="toggleTheme">
            <el-icon :size="16"><component :is="isDark ? Sunny : Moon" /></el-icon>
          </button>

          <!-- 用户菜单 -->
          <el-dropdown trigger="click" @command="onUserCommand">
            <button type="button" class="user-btn">
              <span class="user-btn__avatar">{{ avatarInitial }}</span>
              <span class="user-btn__name">{{ displayName }}</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="content" :class="{ 'content--workspace': route.path === '/prompt-library' }">
        <div :key="route.path" class="anim-fade-up content-inner">
          <router-view />
        </div>
      </main>
    </div>

    <!-- 修改密码 -->
    <el-dialog v-model="passwordOpen" title="修改密码" width="420px">
      <el-form label-width="90px" @submit.prevent="submitPassword">
        <el-form-item label="旧密码" required>
          <el-input v-model="passwordForm.old" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input
            v-model="passwordForm.next"
            type="password"
            show-password
            placeholder="至少 8 位"
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认新密码" required>
          <el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <p class="text-muted" style="margin: 0">修改成功后需要重新登录。</p>
      <template #footer>
        <el-button @click="passwordOpen = false">取消</el-button>
        <el-button type="primary" :loading="passwordSubmitting" @click="submitPassword">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.layout {
  position: fixed;
  inset: 0;
  display: flex;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
  background: var(--bg);
}

/* ---- 侧边栏 ---- */
.aside {
  display: flex;
  flex-direction: column;
  width: 236px;
  min-height: 0;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 20px 16px;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-md);
}

.logo-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.logo-copy strong {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.logo-copy small {
  color: var(--ink-3);
  font-size: 11px;
}

.nav {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 12px;
  display: grid;
  gap: 20px;
  align-content: start;
}

.nav-group__title {
  padding: 0 10px 6px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0;
  padding: 8px 10px;
  border-radius: 12px;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.nav-item .el-icon {
  color: var(--ink-3);
  transition: color 0.15s ease;
}

.nav-item:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.nav-item:hover .el-icon {
  color: var(--ink-2);
}

.nav-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.nav-item.is-active .el-icon {
  color: var(--accent-ink);
}

.nav-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  line-height: 1;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.user-meta {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
  justify-items: start;
}

.user-meta strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-logout {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.user-logout:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

/* ---- 顶栏 ---- */
.main-col {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  flex-shrink: 0;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  backdrop-filter: blur(12px);
  position: relative;
  z-index: 10;
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
  font-size: 13px;
}

.crumb-sep {
  color: var(--border-strong);
}

.crumb-current {
  color: var(--ink);
  font-weight: 500;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.icon-btn:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.icon-btn__dot {
  position: absolute;
  top: -1px;
  right: -1px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 1;
}

.user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px 0 5px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background-color 0.15s ease;
  outline: none;
}

.user-btn:hover {
  background: var(--surface-3);
}

.user-btn__avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.user-btn__name {
  max-width: 160px;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 内容区 ---- */
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.content.content--workspace {
  overflow: hidden;
}

.content-inner {
  min-height: 100%;
}

.content--workspace .content-inner {
  height: 100%;
  min-height: 0;
}

/* ---- 通知面板 ---- */
.notify-panel {
  display: grid;
  gap: 2px;
}

.notify-panel__title {
  padding: 6px 10px 8px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.notify-panel__empty {
  padding: 26px 10px;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}

.notify-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.notify-row:hover {
  background: var(--surface-2);
}

.notify-row__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 8px;
}

.notify-row__icon.is-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.notify-row__icon.is-info {
  background: var(--info-soft);
  color: var(--info);
}

.notify-row__label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.notify-row__count {
  font-size: 13px;
  font-weight: 700;
}
</style>

<style>
/* popover 自定义外观（teleport 到 body） */
.notify-popper.el-popper {
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  animation: pop-in 0.28s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}
</style>
