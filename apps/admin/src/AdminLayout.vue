<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type Component,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowRight,
  Bell,
  Box,
  Brush,
  Calendar,
  ChatDotSquare,
  ChatLineRound,
  ChatLineSquare,
  Checked,
  Coin,
  Collection,
  CollectionTag,
  Connection,
  Cpu,
  DataLine,
  Document,
  Expand,
  Files,
  Goods,
  Film,
  Fold,
  List,
  Lock,
  MagicStick,
  Monitor,
  Moon,
  Notebook,
  Odometer,
  Operation,
  Picture,
  Postcard,
  PieChart,
  Present,
  Promotion,
  RefreshLeft,
  RefreshRight,
  Search,
  Setting,
  ShoppingBag,
  Star,
  Sunny,
  SwitchButton,
  Ticket,
  Tickets,
  Tools,
  TrendCharts,
  User,
  UserFilled,
  Wallet,
  Warning,
} from "@element-plus/icons-vue";
import AdminDialog from "@/components/AdminDialog.vue";
import { useAuthStore } from "@/stores/auth";
import { ADMIN_BADGES_STALE_EVENT, request } from "@/request";
import { preloadAdminRoute } from "@/router";
import {
  invalidateAdminBadgeCounts,
  loadAdminBadgeCounts,
} from "@/services/adminBadgeCounts";
import { isDark, toggleTheme } from "@/theme";
import { useAdminShellMotion } from "@/composables/useAdminShellMotion";
import { REFERRALS_ENABLED } from "@/referrals";

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

type NavItem = { path: string; label: string; icon: Component };
type NavGroup = { key: string; title: string; icon: Component; items: NavItem[] };

const HOME_ITEM: NavItem = { path: "/", label: "仪表盘", icon: Odometer };

type NavSection = { key: string; title: string; groups: NavGroup[] };

/**
 * 两级结构：板块（按使用频率排序）→ 分组（一件事一组，2~4 项）→ 页面。
 * 每天要处理的放最上面，偶尔才改的配置和系统类沉到底部。
 */
const NAV_SECTIONS: NavSection[] = [
  {
    key: "daily",
    title: "日常处理",
    groups: [
      {
        key: "users",
        title: "用户",
        icon: User,
        items: [
          { path: "/users", label: "用户管理", icon: User },
          { path: "/user-profile-dashboard", label: "用户画像", icon: PieChart },
          { path: "/feedback", label: "用户反馈", icon: ChatLineRound },
        ],
      },
      {
        key: "review",
        title: "内容审核",
        icon: Checked,
        items: [
          { path: "/gallery", label: "投稿审核", icon: Picture },
          { path: "/community", label: "社区管理", icon: ChatDotSquare },
          { path: "/content-policy", label: "内容违规", icon: Warning },
        ],
      },
      {
        key: "orders",
        title: "订单与财务",
        icon: Wallet,
        items: [
          { path: "/orders", label: "订单管理", icon: Tickets },
          { path: "/subscription-changes", label: "订阅变更", icon: RefreshLeft },
          { path: "/finance-center", label: "财务中心", icon: Coin },
        ],
      },
    ],
  },
  {
    key: "growth",
    title: "运营增长",
    groups: [
      {
        key: "site",
        title: "站点内容",
        icon: Postcard,
        items: [
          { path: "/page-controls", label: "页面控制", icon: Operation },
          { path: "/home-banners", label: "首页轮播", icon: Film },
          { path: "/announcements", label: "公告管理", icon: Bell },
          { path: "/changelog", label: "更新说明", icon: Document },
        ],
      },
      {
        key: "campaigns",
        title: "增长活动",
        icon: Promotion,
        items: [
          { path: "/trial-applications", label: "体验活动", icon: Star },
          { path: "/checkin-activity", label: "签到活动", icon: Calendar },
          { path: "/growth-groups", label: "好友拼团", icon: UserFilled },
          ...(REFERRALS_ENABLED
            ? [{ path: "/referrals", label: "邀请返利", icon: Present }]
            : []),
        ],
      },
      {
        key: "products",
        title: "套餐与权益",
        icon: Goods,
        items: [
          { path: "/plans", label: "套餐管理", icon: Box },
          { path: "/codes", label: "兑换码", icon: Ticket },
        ],
      },
    ],
  },
  {
    key: "product",
    title: "AI 与素材",
    groups: [
      {
        key: "models",
        title: "模型与任务",
        icon: Cpu,
        items: [
          { path: "/model-config", label: "模型配置", icon: MagicStick },
          { path: "/tasks", label: "任务与调度", icon: Monitor },
          { path: "/developer-api", label: "API 调用", icon: Connection },
        ],
      },
      {
        key: "quality",
        title: "AI 质量",
        icon: DataLine,
        items: [
          { path: "/agent-quality", label: "Agent 质量", icon: TrendCharts },
          { path: "/assistant-quality", label: "AI 助手质量", icon: ChatLineSquare },
        ],
      },
      {
        key: "library",
        title: "素材库",
        icon: Collection,
        items: [
          { path: "/prompt-library", label: "提示词库", icon: CollectionTag },
          { path: "/image-skills", label: "Skill 词库", icon: Brush },
          { path: "/ecommerce", label: "电商素材", icon: ShoppingBag },
          { path: "/canvas-templates", label: "画布模板", icon: Files },
        ],
      },
    ],
  },
  {
    key: "platform",
    title: "平台",
    groups: [
      {
        key: "system",
        title: "系统与安全",
        icon: Tools,
        items: [
          { path: "/settings", label: "系统设置", icon: Setting },
          { path: "/security-center", label: "安全中心", icon: Lock },
          { path: "/audit", label: "审计日志", icon: List },
          { path: "/platform-logs", label: "运行日志", icon: Notebook },
        ],
      },
    ],
  },
];

const NAV_GROUPS = NAV_SECTIONS.flatMap((section) => section.groups);

/* ---------- 侧栏：窄屏图标轨 / 手风琴分组 / 菜单搜索 ---------- */

const NARROW_QUERY = "(max-width: 720px)";
const isNarrow = ref(window.matchMedia(NARROW_QUERY).matches);
const isRail = computed(() => sidebarCollapsed.value || isNarrow.value);
const flyoutTrigger = window.matchMedia("(hover: hover)").matches
  ? "hover"
  : "click";

function onNarrowChange(event: MediaQueryListEvent) {
  isNarrow.value = event.matches;
}

function groupOfPath(path: string) {
  return NAV_GROUPS.find((group) =>
    group.items.some((item) => item.path === path),
  );
}

const activeGroupKey = computed(() => groupOfPath(route.path)?.key || "");
/** 一次只展开一组；默认展开当前页面所在的组，切页时跟随。 */
const openGroupKey = ref(activeGroupKey.value);
watch(activeGroupKey, (key) => {
  if (key) openGroupKey.value = key;
});

function toggleGroup(key: string) {
  openGroupKey.value = openGroupKey.value === key ? "" : key;
}

/* 分组展开 / 收起：只动这一块的 height + opacity，200ms 内结束；
   侧栏有 contain: layout，重排不会波及主内容区。 */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const GROUP_EASE = "cubic-bezier(0.2, 0, 0, 1)";

function animateGroupBody(el: Element, done: () => void, opening: boolean) {
  const body = el as HTMLElement;
  if (reducedMotion.matches) {
    done();
    return;
  }
  const height = `${body.scrollHeight}px`;
  body.style.overflow = "hidden";
  const frames = [
    { height: "0px", opacity: 0 },
    { height, opacity: 1 },
  ];
  const animation = body.animate(opening ? frames : frames.reverse(), {
    duration: opening ? 200 : 160,
    easing: GROUP_EASE,
  });
  if (opening) {
    body.firstElementChild?.animate(
      [{ transform: "translateY(-4px)" }, { transform: "none" }],
      { duration: 200, easing: GROUP_EASE },
    );
  }
  const finish = () => {
    body.style.overflow = "";
    done();
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

function onGroupBodyEnter(el: Element, done: () => void) {
  animateGroupBody(el, done, true);
}

function onGroupBodyLeave(el: Element, done: () => void) {
  animateGroupBody(el, done, false);
}

const navQuery = ref("");
const navSearchRef = ref<HTMLInputElement | null>(null);

const navSearchResults = computed(() => {
  const query = navQuery.value.trim().toLowerCase();
  if (!query) return [];
  return [
    { ...HOME_ITEM, group: "" },
    ...NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.title })),
    ),
  ].filter(
    (item) =>
      item.label.toLowerCase().includes(query) ||
      item.group.toLowerCase().includes(query) ||
      item.path.toLowerCase().includes(query),
  );
});

function goFirstSearchResult() {
  const first = navSearchResults.value[0];
  if (!first) return;
  navQuery.value = "";
  navSearchRef.value?.blur();
  if (first.path !== route.path) void router.push(first.path);
}

async function focusNavSearch() {
  if (isRail.value) {
    if (isNarrow.value) return;
    toggleSidebar();
    await nextTick();
  }
  navSearchRef.value?.focus();
  navSearchRef.value?.select();
}

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    void focusNavSearch();
  }
}

const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
  ? "⌘K"
  : "Ctrl K";

onMounted(() => {
  window.matchMedia(NARROW_QUERY).addEventListener("change", onNarrowChange);
  window.addEventListener("keydown", onGlobalKeydown);
});
onBeforeUnmount(() => {
  window.matchMedia(NARROW_QUERY).removeEventListener("change", onNarrowChange);
  window.removeEventListener("keydown", onGlobalKeydown);
});

const displayName = computed(
  () => auth.user?.username || auth.user?.email || "管理员",
);
const avatarInitial = computed(() =>
  displayName.value.slice(0, 1).toUpperCase(),
);
const pageTitle = computed(() => String(route.meta.title || "管理后台"));

/* ---------- 待办数（侧边栏徽标 + 通知铃） ---------- */

const pendingSubmissions = ref(0);
const runningTasks = ref(0);
const pendingTrialApplications = ref(0);
const pendingFeedback = ref(0);
const pendingRefunds = ref(0);
/** 从未成功加载过时为 true；面板据此提示失败，而不是误报“全部处理完毕”。 */
const todoLoadFailed = ref(false);
const todoLoaded = ref(false);

/** 聚合端点一次返回全部徽标计数，替代原先的多次独立请求。 */
async function loadTodoCounts(force = false) {
  try {
    const data = await loadAdminBadgeCounts({ force });
    pendingSubmissions.value = data.pendingSubmissions;
    runningTasks.value = data.runningTasks;
    pendingTrialApplications.value = data.pendingTrialApplications;
    pendingFeedback.value = data.pendingFeedback;
    pendingRefunds.value = data.pendingRefunds;
    todoLoaded.value = true;
    todoLoadFailed.value = false;
  } catch {
    // 已有数据时保留旧值；从未成功过才在面板里提示失败
    if (!todoLoaded.value) todoLoadFailed.value = true;
  }
}

/** 需要管理员处理的待办：计入铃铛红点。 */
const todoItems = computed(() =>
  [
    {
      key: "pending",
      label: "投稿待审核",
      count: pendingSubmissions.value,
      icon: Picture,
      to: "/gallery",
    },
    {
      key: "trial",
      label: "体验资格待审核",
      count: pendingTrialApplications.value,
      icon: Star,
      to: "/trial-applications",
    },
    {
      key: "feedback",
      label: "用户反馈待处理",
      count: pendingFeedback.value,
      icon: ChatLineRound,
      to: "/feedback",
    },
    {
      key: "refund",
      label: "退款待审核",
      count: pendingRefunds.value,
      icon: RefreshLeft,
      to: "/subscription-changes?status=reviewing",
    },
  ].filter((item) => item.count > 0),
);

/** 运行状态：只做展示，不算待办、不点亮红点。 */
const activityItems = computed(() =>
  runningTasks.value > 0
    ? [
        {
          key: "running",
          label: "任务排队 / 运行中",
          count: runningTasks.value,
          icon: Monitor,
          to: "/tasks",
        },
      ]
    : [],
);

const notifyTotal = computed(() =>
  todoItems.value.reduce((sum, item) => sum + item.count, 0),
);

/** 侧栏徽标只标“需要人处理”的待办，运行中任务只进通知铃。 */
function navBadgeCount(path: string) {
  switch (path) {
    case "/gallery":
      return pendingSubmissions.value;
    case "/trial-applications":
      return pendingTrialApplications.value;
    case "/feedback":
      return pendingFeedback.value;
    case "/subscription-changes":
      return pendingRefunds.value;
    default:
      return 0;
  }
}

function groupBadgeCount(group: NavGroup) {
  return group.items.reduce((sum, item) => sum + navBadgeCount(item.path), 0);
}

function badgeText(count: number) {
  return count > 99 ? "99+" : String(count);
}

/* 刷新时机：切页（走 30s 缓存）、打开通知面板、审核类操作成功后、
   页面可见时每分钟一次、从后台切回标签页时。 */
const TODO_POLL_MS = 60_000;
let todoPollTimer: number | null = null;

function onBadgesStale() {
  invalidateAdminBadgeCounts();
  void loadTodoCounts(true);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") void loadTodoCounts();
}

onMounted(() => {
  void loadTodoCounts();
  todoPollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void loadTodoCounts(true);
  }, TODO_POLL_MS);
  window.addEventListener(ADMIN_BADGES_STALE_EVENT, onBadgesStale);
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onBeforeUnmount(() => {
  if (todoPollTimer !== null) window.clearInterval(todoPollTimer);
  window.removeEventListener(ADMIN_BADGES_STALE_EVENT, onBadgesStale);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
watch(
  () => route.path,
  () => void loadTodoCounts(),
);

/* 受控显示：el-popover 的 hide() 只会抛出 update:visible，不绑 v-model 关不掉 */
const notifyOpen = ref(false);
const notifyRefreshing = ref(false);

async function refreshNotify() {
  notifyRefreshing.value = true;
  try {
    await loadTodoCounts(true);
  } finally {
    notifyRefreshing.value = false;
  }
}

/* ---------- 路由预取 / 切页反馈 ---------- */

const navigatingTo = ref("");
let routePreloadTimer: number | null = null;

function cancelScheduledPreload() {
  if (routePreloadTimer === null) return;
  window.clearTimeout(routePreloadTimer);
  routePreloadTimer = null;
}

function preloadRouteNow(path: string) {
  cancelScheduledPreload();
  if (path !== route.path) void preloadAdminRoute(path);
}

function scheduleRoutePreload(path: string) {
  cancelScheduledPreload();
  if (path === route.path) return;
  routePreloadTimer = window.setTimeout(() => {
    routePreloadTimer = null;
    void preloadAdminRoute(path);
  }, 150);
}

function onNavClick(path: string, event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    path === route.path
  ) {
    navigatingTo.value = "";
    return;
  }
  navigatingTo.value = path;
}

const removeNavigationCompleteHook = router.afterEach(() => {
  navigatingTo.value = "";
});
const removeNavigationErrorHook = router.onError(() => {
  navigatingTo.value = "";
});

onBeforeUnmount(() => {
  cancelScheduledPreload();
  removeNavigationCompleteHook();
  removeNavigationErrorHook();
});

function goTodo(to: string) {
  notifyOpen.value = false;
  void router.push(to);
}

function navLinkEvents(path: string) {
  return {
    mouseenter: () => scheduleRoutePreload(path),
    mouseleave: cancelScheduledPreload,
    focus: () => preloadRouteNow(path),
    pointerdown: () => preloadRouteNow(path),
    click: (event: MouseEvent) => onNavClick(path, event),
  };
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
      :class="{ 'is-collapsed': sidebarCollapsed, 'is-rail': isRail }"
    >
      <div class="aside-inner">
        <div class="logo" title="StartClouds">
          <span class="logo-mark" aria-hidden="true">
            <el-icon :size="17"><MagicStick /></el-icon>
          </span>
          <span class="logo-copy">
            <strong>StartClouds</strong>
            <small>管理后台</small>
          </span>
        </div>

        <label v-if="!isRail" class="nav-search">
          <el-icon :size="14" class="nav-search__icon"><Search /></el-icon>
          <input
            ref="navSearchRef"
            v-model="navQuery"
            type="search"
            placeholder="搜索菜单"
            aria-label="搜索菜单"
            @keydown.enter.prevent="goFirstSearchResult"
            @keydown.esc="navQuery = ''"
          />
          <kbd v-if="!navQuery">{{ searchShortcut }}</kbd>
        </label>

        <!-- 图标轨：每组一个入口，悬停展开浮层 -->
        <nav v-if="isRail" class="nav nav--rail" aria-label="主导航">
          <router-link
            :to="HOME_ITEM.path"
            class="nav-item"
            :class="{ 'is-active': route.path === HOME_ITEM.path }"
            :title="HOME_ITEM.label"
            v-on="navLinkEvents(HOME_ITEM.path)"
          >
            <span class="nav-item__icon">
              <el-icon :size="18"><component :is="HOME_ITEM.icon" /></el-icon>
            </span>
          </router-link>
          <template v-for="section in NAV_SECTIONS" :key="section.key">
          <span
            class="nav-rail-divider"
            :title="section.title"
            aria-hidden="true"
          />
          <el-popover
            v-for="group in section.groups"
            :key="group.key"
            placement="right-start"
            :trigger="flyoutTrigger"
            :width="224"
            :offset="14"
            :show-after="60"
            :hide-after="120"
            :show-arrow="false"
            popper-class="nav-flyout-popper"
          >
            <template #reference>
              <button
                type="button"
                class="nav-item nav-item--group"
                :class="{ 'is-active': activeGroupKey === group.key }"
                :aria-label="group.title"
              >
                <span class="nav-item__icon">
                  <el-icon :size="18"><component :is="group.icon" /></el-icon>
                </span>
                <i v-if="groupBadgeCount(group) > 0" class="nav-dot" />
              </button>
            </template>
            <div class="nav-flyout">
              <div class="nav-flyout__title">{{ group.title }}</div>
              <router-link
                v-for="item in group.items"
                :key="item.path"
                :to="item.path"
                class="nav-flyout__item"
                :class="{ 'is-active': route.path === item.path }"
                v-on="navLinkEvents(item.path)"
              >
                <el-icon :size="16"><component :is="item.icon" /></el-icon>
                <span>{{ item.label }}</span>
                <em v-if="navBadgeCount(item.path) > 0" class="nav-badge tnum">
                  {{ badgeText(navBadgeCount(item.path)) }}
                </em>
              </router-link>
            </div>
          </el-popover>
          </template>
        </nav>

        <!-- 搜索结果：平铺，回车跳第一个 -->
        <nav v-else-if="navQuery.trim()" class="nav" aria-label="菜单搜索结果">
          <div v-if="!navSearchResults.length" class="nav-empty">
            没有匹配的菜单
          </div>
          <router-link
            v-for="(item, index) in navSearchResults"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{
              'is-active': route.path === item.path,
              'is-first': index === 0,
            }"
            v-on="navLinkEvents(item.path)"
            @click="navQuery = ''"
          >
            <span class="nav-item__icon">
              <el-icon :size="16"><component :is="item.icon" /></el-icon>
            </span>
            <span class="nav-item__label">{{ item.label }}</span>
            <small v-if="item.group" class="nav-item__hint">{{ item.group }}</small>
          </router-link>
        </nav>

        <!-- 展开态：手风琴分组 -->
        <nav v-else class="nav" aria-label="主导航">
          <router-link
            :to="HOME_ITEM.path"
            class="nav-item nav-item--home"
            :class="{
              'is-active': route.path === HOME_ITEM.path,
              'is-pending': navigatingTo === HOME_ITEM.path,
            }"
            v-on="navLinkEvents(HOME_ITEM.path)"
          >
            <span class="nav-item__icon">
              <el-icon :size="17"><component :is="HOME_ITEM.icon" /></el-icon>
            </span>
            <span class="nav-item__label">{{ HOME_ITEM.label }}</span>
          </router-link>

          <template v-for="section in NAV_SECTIONS" :key="section.key">
          <div class="nav-section__title">{{ section.title }}</div>
          <section
            v-for="group in section.groups"
            :key="group.key"
            class="nav-group"
            :class="{
              'is-open': openGroupKey === group.key,
              'has-active': activeGroupKey === group.key,
            }"
          >
            <button
              type="button"
              class="nav-group__head"
              :aria-expanded="openGroupKey === group.key"
              @click="toggleGroup(group.key)"
            >
              <span class="nav-item__icon">
                <el-icon :size="17"><component :is="group.icon" /></el-icon>
              </span>
              <span class="nav-group__title">{{ group.title }}</span>
              <em
                v-if="openGroupKey !== group.key && groupBadgeCount(group) > 0"
                class="nav-badge tnum"
              >
                {{ badgeText(groupBadgeCount(group)) }}
              </em>
              <el-icon :size="12" class="nav-group__chevron"><ArrowRight /></el-icon>
            </button>
            <Transition
              :css="false"
              @enter="onGroupBodyEnter"
              @leave="onGroupBodyLeave"
            >
            <div v-if="openGroupKey === group.key" class="nav-group__body">
              <div class="nav-group__items">
                <router-link
                  v-for="item in group.items"
                  :key="item.path"
                  :to="item.path"
                  class="nav-item nav-item--sub"
                  :class="{
                    'is-active': route.path === item.path,
                    'is-pending': navigatingTo === item.path,
                  }"
                  v-on="navLinkEvents(item.path)"
                >
                  <span class="nav-item__label">{{ item.label }}</span>
                  <em v-if="navBadgeCount(item.path) > 0" class="nav-badge tnum">
                    {{ badgeText(navBadgeCount(item.path)) }}
                  </em>
                </router-link>
              </div>
            </div>
            </Transition>
          </section>
          </template>
        </nav>

        <div v-if="!isNarrow" class="aside-footer">
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
            <span>{{ sidebarCollapsed ? "展开" : "收起侧栏" }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- ==== 主区域 ==== -->
    <div class="main-col">
      <div v-if="navigatingTo" class="route-progress" aria-hidden="true">
        <span />
      </div>
      <header class="topbar">
        <h1 class="page-title">{{ pageTitle }}</h1>

        <div class="topbar-actions">
          <el-popover
            v-model:visible="notifyOpen"
            placement="bottom-end"
            :width="300"
            trigger="click"
            popper-class="notify-popper"
            @before-enter="refreshNotify"
          >
            <template #reference>
              <button
                type="button"
                class="icon-btn"
                title="通知中心"
                :aria-label="notifyTotal > 0 ? `通知中心，${notifyTotal} 项待办` : '通知中心'"
              >
                <el-icon :size="16"><Bell /></el-icon>
                <em v-if="notifyTotal > 0" class="icon-btn__dot tnum">
                  {{ badgeText(notifyTotal) }}
                </em>
              </button>
            </template>
            <div class="notify-panel">
              <div class="notify-panel__title">
                <span>待办 · {{ notifyTotal }} 项</span>
                <button
                  type="button"
                  class="notify-panel__refresh"
                  :class="{ 'is-loading': notifyRefreshing }"
                  title="刷新"
                  aria-label="刷新通知"
                  :disabled="notifyRefreshing"
                  @click="refreshNotify"
                >
                  <el-icon :size="13"><RefreshRight /></el-icon>
                </button>
              </div>
              <div v-if="todoLoadFailed" class="notify-panel__empty is-error">
                通知加载失败，点右上角刷新重试
              </div>
              <div v-else-if="!todoLoaded" class="notify-panel__empty">
                加载中…
              </div>
              <div v-else-if="!todoItems.length" class="notify-panel__empty">
                没有待办，全部处理完毕
              </div>
              <button
                v-for="item in todoItems"
                :key="item.key"
                type="button"
                class="notify-row"
                @click="goTodo(item.to)"
              >
                <span class="notify-row__icon is-warning">
                  <el-icon :size="15"><component :is="item.icon" /></el-icon>
                </span>
                <span class="notify-row__label">{{ item.label }}</span>
                <span class="notify-row__count tnum">{{ badgeText(item.count) }}</span>
              </button>
              <template v-if="activityItems.length">
                <div class="notify-panel__subtitle">运行状态</div>
                <button
                  v-for="item in activityItems"
                  :key="item.key"
                  type="button"
                  class="notify-row is-muted"
                  @click="goTodo(item.to)"
                >
                  <span class="notify-row__icon is-info">
                    <el-icon :size="15"><component :is="item.icon" /></el-icon>
                  </span>
                  <span class="notify-row__label">{{ item.label }}</span>
                  <span class="notify-row__count tnum">{{ badgeText(item.count) }}</span>
                </button>
              </template>
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
            '/image-skills',
            '/ecommerce',
            '/community',
            '/gallery',
            '/tasks',
            '/developer-api',
            '/content-policy',
            '/finance-center',
            '/agent-quality',
            '/orders',
            '/subscription-changes',
            '/home-banners',
            '/users',
            '/platform-logs',
            '/security-center',
            '/plans',
            '/growth-groups',
            '/referrals',
            '/checkin-activity',
            '/settings',
            '/model-config',
            '/page-controls',
            '/canvas-templates',
            '/content',
            '/announcements',
            '/changelog',
            '/feedback',
            '/trial-applications',
            '/audit',
            '/user-profile-dashboard',
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
  --aside-pad-x: 12px;
  --aside-item-h: 40px;
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
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-soft) 45%, transparent) 0,
      transparent 132px
    ),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow-sm);
}

.aside.is-rail .aside-inner {
  width: 100%;
  min-width: 0;
}

/* 品牌 */
.logo {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 10px;
  height: 64px;
  padding: 0 calc(var(--aside-pad-x) + 4px);
}

.aside.is-rail .logo {
  justify-content: center;
  padding: 0;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 11px;
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 30%, transparent);
}

.logo-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.logo-copy strong {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.logo-copy small {
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1;
}

.aside.is-rail .logo-copy,
.aside.is-rail .sidebar-toggle span {
  display: none;
}

/* 菜单搜索 */
.nav-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 38px;
  margin: 0 var(--aside-pad-x) 6px;
  padding: 0 8px 0 11px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-2);
  color: var(--ink-3);
  cursor: text;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.nav-search:focus-within {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.nav-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
}

.nav-search input::placeholder {
  color: var(--ink-3);
}

.nav-search input::-webkit-search-cancel-button {
  display: none;
}

.nav-search kbd {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink-3);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.3;
}

/* 导航主体 */
.nav {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px var(--aside-pad-x) 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  /* 收起 / 展开侧栏、进出搜索时整块导航换了一棵树，给一个很短的淡入 */
  animation: nav-fade-in 0.18s ease-out;
}

@keyframes nav-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.nav::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.nav--rail {
  align-items: center;
  gap: 6px;
  padding: 4px 0 12px;
}

.nav-rail-divider {
  width: 24px;
  height: 1px;
  margin: 4px 0;
  flex-shrink: 0;
  background: var(--border);
}

.nav-empty {
  padding: 28px 8px;
  color: var(--ink-3);
  font-size: 13.5px;
  text-align: center;
}

.nav-item,
.nav-group__head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--aside-item-h);
  flex-shrink: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.nav-item__icon {
  display: grid;
  place-items: center;
  width: var(--aside-icon);
  height: var(--aside-icon);
  flex-shrink: 0;
  color: var(--ink-3);
  transition: color 0.18s ease;
}

/* 展开态：图标放进 28px 小方块，选中 / 所在分组用方块着色表达层级 */
.nav:not(.nav--rail) > .nav-item,
.nav-group__head {
  padding: 0 8px 0 6px;
}

.nav:not(.nav--rail) .nav-item__icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.nav:not(.nav--rail) > .nav-item.is-active .nav-item__icon {
  background: var(--accent);
  color: var(--accent-on);
}

.nav-group.is-open > .nav-group__head .nav-item__icon {
  background: var(--surface-2);
  color: var(--ink);
}

.nav-group.has-active > .nav-group__head .nav-item__icon {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.nav-item__label,
.nav-group__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.nav-item__hint {
  color: var(--ink-3);
  font-size: 12px;
}

.nav-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 6px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 1;
}

.nav-section__title::after {
  content: "";
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
}

/* 分组（手风琴） */
.nav-group__head {
  color: var(--ink-2);
}

.nav-group.has-active > .nav-group__head {
  color: var(--ink);
}

.nav-group.has-active > .nav-group__head {
  font-weight: 600;
}

.nav-group__chevron {
  flex-shrink: 0;
  color: var(--ink-3);
  opacity: 0.6;
  transition:
    transform 0.2s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease;
}

.nav-group.is-open .nav-group__chevron {
  transform: rotate(90deg);
}

/* 展开 / 收起动画见 animateGroupBody */
.nav-group__body {
  overflow: hidden;
}

.nav-group__items {
  position: relative;
  display: grid;
  gap: 1px;
  margin-left: 19px;
  padding-left: 12px;
}

/* 子项左侧的细引导线 */
.nav-group__items::before {
  content: "";
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 1px;
  background: var(--border);
}

.nav-group.is-open .nav-group__items {
  padding-top: 2px;
  padding-bottom: 6px;
}

.nav-item--sub {
  height: 36px;
  padding: 0 10px;
  font-size: 14.5px;
  color: var(--ink-2);
}

.nav-item--sub.is-active::before {
  content: "";
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: -12.5px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}

@media (hover: hover) and (pointer: fine) {
  .nav-item:hover,
  .nav-group__head:hover {
    background: var(--surface-2);
    color: var(--ink);
  }

  .nav-item:hover .nav-item__icon,
  .nav-group__head:hover .nav-item__icon {
    color: var(--ink);
  }

  .nav-item.is-active:hover {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }

  .nav-item.is-active:hover .nav-item__icon {
    color: var(--accent-ink);
  }

  .nav:not(.nav--rail) > .nav-item:not(.is-active):hover .nav-item__icon,
  .nav-group:not(.has-active) > .nav-group__head:hover .nav-item__icon {
    background: var(--surface-3);
  }

  .nav-group__head:hover .nav-group__chevron {
    opacity: 1;
  }
}

.nav-item:focus-visible,
.nav-group__head:focus-visible,
.sidebar-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* 选中：浅色底 + 强调色字，比整块实色更轻，层级更清楚 */
.nav-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}

.nav-item.is-active .nav-item__icon {
  color: var(--accent-ink);
}

.nav-item.is-first:not(.is-active) {
  background: var(--surface-2);
  color: var(--ink);
}

.nav-item.is-pending:not(.is-active) {
  background: var(--surface-2);
  color: var(--ink);
}

.nav-item.is-pending:not(.is-active) .nav-item__icon,
.nav-item--sub.is-pending:not(.is-active) .nav-item__label {
  animation: nav-pending-pulse 0.7s ease-in-out infinite alternate;
}

@keyframes nav-pending-pulse {
  from {
    opacity: 0.45;
  }
  to {
    opacity: 1;
  }
}

/* 图标轨 */
.nav--rail .nav-item {
  justify-content: center;
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 12px;
}

.nav--rail .nav-item.is-active {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 28%, transparent);
}

.nav--rail .nav-item.is-active .nav-item__icon {
  color: var(--accent-on);
}

@media (hover: hover) and (pointer: fine) {
  .nav--rail .nav-item.is-active:hover {
    background: var(--accent-hover);
    color: var(--accent-on);
  }

  .nav--rail .nav-item.is-active:hover .nav-item__icon {
    color: var(--accent-on);
  }
}

.nav-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--danger);
}

.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}

/* 底部收起按钮 */
.aside-footer {
  display: flex;
  flex-shrink: 0;
  padding: 8px var(--aside-pad-x) 12px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.sidebar-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--aside-item-h);
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink-3);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.sidebar-toggle .el-icon {
  width: var(--aside-icon);
}

@media (hover: hover) and (pointer: fine) {
  .sidebar-toggle:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
}

.aside.is-rail .aside-footer {
  justify-content: center;
  padding: 8px 0 12px;
}

.aside.is-rail .sidebar-toggle {
  justify-content: center;
  width: 42px;
  height: 42px;
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  .aside {
    width: var(--aside-expanded);
  }

  .aside.is-collapsed {
    width: var(--aside-collapsed);
  }

  .nav {
    animation: none;
  }

  .nav-group__chevron {
    transition: none;
  }
}

/* ---- 顶栏 ---- */
.main-col {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.route-progress {
  position: absolute;
  z-index: 30;
  top: 0;
  right: 8px;
  left: 4px;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
}

.route-progress span {
  display: block;
  width: 32%;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--el-color-primary);
  animation: route-progress-move 0.85s ease-in-out infinite;
}

@keyframes route-progress-move {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(420%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nav-item.is-pending:not(.is-active) .nav-item__icon,
  .nav-item--sub.is-pending:not(.is-active) .nav-item__label,
  .route-progress span {
    animation: none;
  }

  .route-progress span {
    width: 100%;
    opacity: 0.65;
  }
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
  scrollbar-gutter: auto;
}

.content-inner {
  min-height: 100%;
  transform: translateZ(0);
}

.content--workspace .content-inner {
  height: 100%;
  min-height: 0;
}

@media (max-width: 720px) {
  .layout {
    gap: 6px;
    padding: 6px;
  }

  .aside,
  .aside.is-collapsed {
    width: 64px !important;
    --aside-collapsed: 64px;
  }

  .logo {
    height: 56px;
  }

  .topbar {
    height: 58px;
    justify-content: flex-end;
    padding: 0;
  }

  .page-title,
  .profile-chip .user-meta {
    display: none;
  }

  .topbar-actions {
    gap: 6px;
  }

  .icon-btn {
    width: 38px;
    height: 38px;
  }

  .theme-switch__btn {
    width: 30px;
    height: 30px;
  }

  .profile-chip {
    width: 40px;
    height: 40px;
    padding: 2px;
  }
}

/* ---- 通知面板 ---- */
.notify-panel {
  display: grid;
  gap: 2px;
}

.notify-panel__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px 10px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.notify-panel__subtitle {
  margin-top: 6px;
  padding: 8px 10px 4px;
  border-top: 1px solid var(--border);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.notify-panel__refresh {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.notify-panel__refresh:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--ink);
}

.notify-panel__refresh.is-loading .el-icon {
  animation: notify-spin 0.8s linear infinite;
}

@keyframes notify-spin {
  to {
    transform: rotate(360deg);
  }
}

.notify-panel__empty.is-error {
  color: var(--danger);
}

.notify-row.is-muted .notify-row__label,
.notify-row.is-muted .notify-row__count {
  color: var(--ink-2);
  font-weight: 500;
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
.nav-flyout-popper.el-popper {
  padding: 6px;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
}

.nav-flyout {
  display: grid;
  gap: 1px;
}

.nav-flyout__title {
  padding: 6px 10px 6px;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.nav-flyout__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--ink-2);
  font-size: 14.5px;
  font-weight: 500;
  text-decoration: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.nav-flyout__item span {
  flex: 1;
}

.nav-flyout__item:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.nav-flyout__item.is-active {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}

.nav-flyout__item .nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}

.notify-popper.el-popper {
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  animation: pop-in 0.28s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}
</style>
