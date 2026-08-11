<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Bell,
  Box,
  Calendar,
  ChatDotRound,
  CollectionTag,
  Document,
  Expand,
  Fold,
  List,
  Lock,
  MagicStick,
  Monitor,
  Moon,
  Odometer,
  Picture,
  Sunny,
  SwitchButton,
  Ticket,
  Star,
  User,
  UserFilled,
} from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { useAuthStore } from "@/stores/auth";
import { request } from "@/request";
import { isDark, toggleTheme } from "@/theme";
import { useAdminShellMotion } from "@/composables/useAdminShellMotion";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sidebarCollapsed = ref(
  window.localStorage.getItem("startclouds-admin:sidebar-collapsed") === "true",
);

const layoutRef = ref<HTMLElement | null>(null);
const asideRef = ref<HTMLElement | null>(null);
const contentInnerRef = ref<HTMLElement | null>(null);
const routePath = computed(() => route.path);

const { animateSidebar, pulse } = useAdminShellMotion({
  root: layoutRef,
  aside: asideRef,
  content: contentInnerRef,
  collapsed: sidebarCollapsed,
  routePath,
});

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  window.localStorage.setItem(
    "startclouds-admin:sidebar-collapsed",
    String(sidebarCollapsed.value),
  );
  animateSidebar(sidebarCollapsed.value);
}

const NAV_GROUPS = [
  {
    title: "总览",
    items: [{ path: "/", label: "仪表盘", icon: Odometer }],
  },
  {
    title: "业务",
    items: [
      { path: "/users", label: "用户管理", icon: User },
      { path: "/tasks", label: "任务与调度", icon: Monitor },
      { path: "/model-config", label: "模型配置", icon: MagicStick },
    ],
  },
  {
    title: "内容运营",
    items: [
      { path: "/content", label: "内容管理", icon: Document },
      { path: "/prompt-library", label: "提示词库", icon: CollectionTag },
      { path: "/community", label: "社区管理", icon: ChatDotRound },
      { path: "/gallery", label: "投稿审核", icon: Picture },
      { path: "/feedback", label: "用户反馈", icon: ChatDotRound },
    ],
  },
  {
    title: "活动与增长",
    items: [
      { path: "/trial-applications", label: "体验活动", icon: Star },
      { path: "/checkin-activity", label: "签到活动", icon: Calendar },
      { path: "/growth-groups", label: "好友拼团", icon: UserFilled },
    ],
  },
  {
    title: "交易与审计",
    items: [
      { path: "/plans", label: "套餐管理", icon: Box },
      { path: "/codes", label: "兑换码", icon: Ticket },
      { path: "/audit", label: "审计日志", icon: List },
    ],
  },
];

const displayName = computed(
  () => auth.user?.username || auth.user?.email || "管理员",
);
const avatarInitial = computed(() =>
  displayName.value.slice(0, 1).toUpperCase(),
);
const pageTitle = computed(() => String(route.meta.title || "管理后台"));

/* ---------- 待办数（侧边栏徽标 + 通知铃），失败静默 ---------- */

const pendingSubmissions = ref(0);
/** 待审数超出单页时展示 N+ */
const pendingHasMore = ref(false);
const runningTasks = ref(0);
const pendingTrialApplications = ref(0);
const pendingFeedback = ref(0);

async function loadTodoCounts() {
  try {
    const data = await request<{
      items: unknown[];
      nextCursor: string | null;
      total?: number;
    }>("/api/v1/admin/gallery/submissions", {
      query: { status: "pending", limit: 50 },
      silent: true,
    });
    if (typeof data.total === "number") {
      pendingSubmissions.value = data.total;
      pendingHasMore.value = false;
    } else {
      pendingSubmissions.value = data.items?.length ?? 0;
      pendingHasMore.value = Boolean(data.nextCursor);
    }
  } catch {
    // 静默：徽标缺失不影响使用
  }
  try {
    const stats = await request<{ runningTasks?: number }>(
      "/api/v1/admin/statistics",
      {
        silent: true,
      },
    );
    runningTasks.value = stats.runningTasks ?? 0;
  } catch {
    // 静默
  }
  try {
    const data = await request<{
      items: unknown[];
      nextCursor: string | null;
      total?: number;
    }>("/api/v1/admin/trial-access-applications", {
      query: { status: "pending", limit: 1 },
      silent: true,
    });
    pendingTrialApplications.value = data.total ?? data.items?.length ?? 0;
  } catch {
    // 静默：体验申请徽标缺失不影响使用
  }
  try {
    const data = await request<{
      items: unknown[];
      nextCursor: string | null;
      total?: number;
    }>("/api/v1/admin/feedback", {
      query: { status: "open", limit: 1 },
      silent: true,
    });
    pendingFeedback.value = data.total ?? data.items?.length ?? 0;
  } catch {
    // 静默：反馈徽标缺失不影响使用
  }
}

const pendingBadgeText = computed(() => {
  if (pendingSubmissions.value <= 0) return "";
  return pendingHasMore.value
    ? `${pendingSubmissions.value}+`
    : String(pendingSubmissions.value);
});

const notifyItems = computed(() =>
  [
    {
      key: "pending",
      label: "投稿待审核",
      count: pendingSubmissions.value,
      countText: pendingBadgeText.value,
      tone: "warning",
      icon: Picture,
      to: "/gallery",
    },
    {
      key: "trial",
      label: "体验资格待审核",
      count: pendingTrialApplications.value,
      countText: String(pendingTrialApplications.value),
      tone: "warning",
      icon: Star,
      to: "/trial-applications",
    },
    {
      key: "feedback",
      label: "用户反馈待处理",
      count: pendingFeedback.value,
      countText: String(pendingFeedback.value),
      tone: "warning",
      icon: ChatDotRound,
      to: "/feedback",
    },
    {
      key: "running",
      label: "任务运行中",
      count: runningTasks.value,
      countText: String(runningTasks.value),
      tone: "info",
      icon: MagicStick,
      to: "/tasks",
    },
  ].filter((item) => item.count > 0),
);

const notifyTotal = computed(() =>
  notifyItems.value.reduce((sum, item) => sum + item.count, 0),
);

onMounted(() => {
  void loadTodoCounts();
});
watch(() => route.path, loadTodoCounts);

function goTodo(to: string) {
  router.push(to);
}

/* ---------- 主题 / 用户菜单 ---------- */

async function onLogout() {
  try {
    await ElMessageBox.confirm("确定退出当前管理员账号？", "退出登录", {
      type: "warning",
      confirmButtonText: "退出",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await auth.logout();
  router.push("/login");
}

function setTheme(dark: boolean, event: MouseEvent) {
  if (isDark.value === dark) return;
  pulse(event.currentTarget);
  void toggleTheme(event);
}

function onUserCommand(command: string) {
  if (command === "logout") void onLogout();
  else if (command === "password") openPassword();
}

/* ---------- 修改密码 ---------- */

const passwordOpen = ref(false);
const passwordSubmitting = ref(false);
const passwordForm = reactive({ old: "", next: "", confirm: "" });

function openPassword() {
  passwordForm.old = "";
  passwordForm.next = "";
  passwordForm.confirm = "";
  passwordOpen.value = true;
}

async function submitPassword() {
  if (!passwordForm.old) {
    ElMessage.warning("请输入旧密码");
    return;
  }
  if (passwordForm.next.length < 12) {
    ElMessage.warning("管理员密码至少 12 位");
    return;
  }
  if (passwordForm.next !== passwordForm.confirm) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }
  passwordSubmitting.value = true;
  try {
    await request("/api/v1/admin/auth/password", {
      method: "PATCH",
      body: { old: passwordForm.old, new: passwordForm.next },
    });
    passwordOpen.value = false;
    ElMessage.success("密码已修改，请重新登录");
    await auth.logout();
    router.push("/login");
  } finally {
    passwordSubmitting.value = false;
  }
}
</script>

<template>
  <div ref="layoutRef" class="layout">
    <!-- ==== 侧边栏 ==== -->
    <aside
      ref="asideRef"
      class="aside"
      :class="{ 'is-collapsed': sidebarCollapsed }"
    >
      <div class="aside-inner">
        <div class="logo" title="StartClouds">
          <span class="logo-mark" aria-hidden="true">
            <el-icon :size="18"><MagicStick /></el-icon>
          </span>
          <span class="logo-copy">
            <strong>StartClouds</strong>
          </span>
        </div>

        <nav class="nav">
          <div v-for="group in NAV_GROUPS" :key="group.title" class="nav-group">
            <div class="nav-group__title">{{ group.title }}</div>
            <div class="nav-group__items">
              <router-link
                v-for="item in group.items"
                :key="item.path"
                :to="item.path"
                class="nav-item"
                :class="{ 'is-active': route.path === item.path }"
              >
                <span class="nav-item__icon">
                  <el-icon :size="18"><component :is="item.icon" /></el-icon>
                </span>
                <span class="nav-item__label">{{ item.label }}</span>
                <em
                  v-if="
                    (item.path === '/gallery' && pendingBadgeText) ||
                    (item.path === '/trial-applications' &&
                      pendingTrialApplications > 0) ||
                    (item.path === '/feedback' && pendingFeedback > 0)
                  "
                  class="nav-badge tnum"
                >
                  {{
                    item.path === "/trial-applications"
                      ? pendingTrialApplications > 99
                        ? "99+"
                        : pendingTrialApplications
					  : item.path === "/feedback"
                        ? pendingFeedback > 99
                          ? "99+"
                          : pendingFeedback
                        : pendingBadgeText
                  }}
                </em>
              </router-link>
            </div>
          </div>
        </nav>

        <div class="aside-footer">
          <button
            type="button"
            class="sidebar-toggle"
            :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
            :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
            @click="toggleSidebar"
          >
            <el-icon :size="15"
              ><component :is="sidebarCollapsed ? Expand : Fold"
            /></el-icon>
            <span>{{ sidebarCollapsed ? "展开" : "收起" }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- ==== 主区域 ==== -->
    <div class="main-col">
      <header class="topbar">
        <h1 class="page-title">{{ pageTitle }}</h1>

        <div class="topbar-actions">
          <el-popover
            placement="bottom-end"
            :width="300"
            trigger="click"
            popper-class="notify-popper"
          >
            <template #reference>
              <button type="button" class="icon-btn" title="通知中心">
                <el-icon :size="16"><Bell /></el-icon>
                <em v-if="notifyTotal > 0" class="icon-btn__dot tnum">
                  {{ notifyTotal > 99 ? "99+" : notifyTotal }}
                </em>
              </button>
            </template>
            <div class="notify-panel">
              <div class="notify-panel__title">
                待办通知 · {{ notifyTotal }} 项
              </div>
              <div v-if="!notifyItems.length" class="notify-panel__empty">
                全部处理完毕
              </div>
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

          <div class="theme-switch" role="group" aria-label="主题切换">
            <button
              type="button"
              class="theme-switch__btn"
              :class="{ 'is-active': !isDark }"
              title="浅色模式"
              :aria-pressed="!isDark"
              @click="setTheme(false, $event)"
            >
              <el-icon :size="15"><Sunny /></el-icon>
            </button>
            <button
              type="button"
              class="theme-switch__btn"
              :class="{ 'is-active': isDark }"
              title="深色模式"
              :aria-pressed="isDark"
              @click="setTheme(true, $event)"
            >
              <el-icon :size="15"><Moon /></el-icon>
            </button>
          </div>

          <el-dropdown trigger="click" @command="onUserCommand">
            <button type="button" class="profile-chip" :title="displayName">
              <span class="user-avatar">{{ avatarInitial }}</span>
              <span class="user-meta">
                <strong>{{ displayName }}</strong>
                <small>管理员</small>
              </span>
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

      <main
        class="content"
        :class="{
          'content--workspace': [
            '/',
            '/prompt-library',
            '/community',
            '/gallery',
            '/tasks',
            '/model-config',
          ].includes(route.path),
        }"
      >
        <div :key="route.path" ref="contentInnerRef" class="content-inner">
          <router-view />
        </div>
      </main>
    </div>

    <AdminDialog
      v-model="passwordOpen"
      title="修改密码"
      subtitle="修改成功后需要重新登录"
      :icon="Lock"
      width="420px"
      confirm-text="确认修改"
      :confirm-loading="passwordSubmitting"
      @confirm="submitPassword"
    >
      <el-form label-width="90px" @submit.prevent="submitPassword">
        <el-form-item label="旧密码" required>
          <el-input
            v-model="passwordForm.old"
            type="password"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input
            v-model="passwordForm.next"
            type="password"
            show-password
            placeholder="至少 12 位"
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认新密码" required>
          <el-input
            v-model="passwordForm.confirm"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>
    </AdminDialog>
  </div>
</template>

<style scoped>
.layout {
  position: fixed;
  inset: 0;
  display: flex;
  gap: 12px;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
  padding: 12px;
  background: var(--bg);
}

/* ---- 侧边栏 ---- */
.aside {
  --aside-pad-x: 14px;
  --aside-item-h: 42px;
  --aside-icon: 20px;
  --aside-expanded: 252px;
  --aside-collapsed: 78px;
  display: flex;
  width: var(--aside-expanded);
  min-height: 0;
  flex-shrink: 0;
  overflow: hidden;
  contain: layout paint;
}

.aside-inner {
  display: flex;
  flex-direction: column;
  width: var(--aside-expanded);
  min-width: var(--aside-expanded);
  min-height: 0;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow-sm);
}

/* 折叠：外层宽度由 GSAP 动画；加上 .is-collapsed 后内层同步收窄并居中图标 */

.logo {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
  height: 68px;
  padding: 0 var(--aside-pad-x);
  border-bottom: 1px solid var(--border);
}

.aside.is-collapsed .aside-inner {
  width: 100%;
  min-width: 0;
}

.aside.is-collapsed .logo {
  justify-content: center;
  padding: 0;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-on);
}

.logo-copy {
  min-width: 0;
  display: flex;
  align-items: center;
}

.aside.is-collapsed .logo-copy,
.aside.is-collapsed .nav-group__title,
.aside.is-collapsed .nav-item__label,
.aside.is-collapsed .sidebar-toggle span {
  display: none;
}

.logo-copy strong {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.nav {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px var(--aside-pad-x) 10px;
  display: grid;
  gap: 18px;
  align-content: start;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.nav::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.nav-group {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.nav-group__title {
  padding: 0 12px;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
}

.nav-group__items {
  display: grid;
  gap: 2px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--aside-item-h);
  padding: 0 12px;
  border-radius: 12px;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}

.nav-item__icon {
  display: grid;
  place-items: center;
  width: var(--aside-icon);
  height: var(--aside-icon);
  flex-shrink: 0;
  color: var(--ink-3);
  transition: color 0.2s ease;
}

.nav-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.aside.is-collapsed .nav {
  padding: 12px 0 8px;
  gap: 8px;
  justify-items: center;
}

.aside.is-collapsed .nav-group {
  width: 100%;
  justify-items: center;
}

.aside.is-collapsed .nav-group__items {
  width: 100%;
  justify-items: center;
}

.aside.is-collapsed .nav-item {
  justify-content: center;
  width: 44px;
  padding: 0;
}

.aside.is-collapsed .nav-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  left: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
}

@media (hover: hover) and (pointer: fine) {
  .nav-item:hover {
    background: var(--surface-3);
    color: var(--ink);
  }

  .nav-item:hover .nav-item__icon {
    color: var(--ink);
  }

  .nav-item.is-active:hover {
    background: var(--accent-hover);
    color: var(--accent-on);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .nav-item.is-active:hover .nav-item__icon {
    color: var(--accent-on);
  }
}

.nav-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.nav-item.is-active {
  background: var(--accent);
  color: var(--accent-on);
  font-weight: 600;
}

.nav-item.is-active .nav-item__icon {
  color: var(--accent-on);
}

.nav-item.is-active .nav-badge {
  background: var(--accent-on);
  color: var(--accent);
}

.nav-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0 7px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-on);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}

.aside-footer {
  display: flex;
  flex-shrink: 0;
  padding: 10px var(--aside-pad-x) 14px;
  border-top: 1px solid var(--border);
}

.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: var(--aside-item-h);
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

@media (hover: hover) and (pointer: fine) {
  .sidebar-toggle:hover {
    background: var(--surface-3);
    border-color: var(--border);
    color: var(--ink);
  }
}

.sidebar-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.aside.is-collapsed .aside-footer {
  padding: 10px 0 14px;
  justify-content: center;
}

.aside.is-collapsed .sidebar-toggle {
  width: 44px;
  margin: 0;
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  .aside {
    width: var(--aside-expanded);
  }

  .aside.is-collapsed {
    width: var(--aside-collapsed);
  }
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
  height: 64px;
  flex-shrink: 0;
  padding: 0 8px 0 4px;
  position: relative;
  z-index: 10;
}

.page-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.15;
  color: var(--ink);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.icon-btn:hover {
  background: var(--surface-2);
  color: var(--ink);
  border-color: var(--border-strong);
}

.icon-btn__dot {
  position: absolute;
  top: -3px;
  right: -3px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 1;
}

.theme-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.theme-switch__btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.theme-switch__btn:hover {
  color: var(--ink);
}

.theme-switch__btn.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
  transform: scale(1.02);
}

.profile-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 200px;
  height: 48px;
  padding: 6px 14px 6px 6px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--ink);
  cursor: pointer;
  outline: none;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.profile-chip:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.user-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-on);
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.user-meta {
  min-width: 0;
  display: grid;
  gap: 1px;
  text-align: left;
}

.user-meta strong {
  max-width: 120px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-meta small {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.25;
}

@media (prefers-reduced-motion: reduce) {
  .theme-switch__btn {
    transition: none;
  }

  .theme-switch__btn.is-active {
    transform: none;
  }
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
  transform: translateZ(0);
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
  border-radius: 14px;
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
  border-radius: 10px;
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
.notify-popper.el-popper {
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  animation: pop-in 0.28s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}
</style>
