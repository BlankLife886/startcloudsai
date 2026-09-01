import type { Component } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { abortPendingPageRequests } from "@/request";
import { useAuthStore } from "@/stores/auth";

declare module "vue-router" {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean;
    title?: string;
  }
}

type RouteModule = { default: Component };
type RouteLoader = () => Promise<RouteModule>;

function memoizeRouteLoader(loader: RouteLoader): RouteLoader {
  let loaded: Promise<RouteModule> | null = null;
  return () => {
    if (!loaded) {
      loaded = loader().catch((error) => {
        loaded = null;
        throw error;
      });
    }
    return loaded;
  };
}

const loginView = memoizeRouteLoader(() => import("@/views/LoginView.vue"));
const forbiddenView = memoizeRouteLoader(
  () => import("@/views/ForbiddenView.vue"),
);
const adminLayout = memoizeRouteLoader(() => import("@/AdminLayout.vue"));
const dashboardView = memoizeRouteLoader(
  () => import("@/views/DashboardView.vue"),
);
const usersView = memoizeRouteLoader(() => import("@/views/UsersView.vue"));
const codesView = memoizeRouteLoader(() => import("@/views/CodesView.vue"));
const plansView = memoizeRouteLoader(() => import("@/views/PlansView.vue"));
const ordersView = memoizeRouteLoader(() => import("@/views/OrdersView.vue"));
const trialApplicationsView = memoizeRouteLoader(
  () => import("@/views/TrialApplicationsView.vue"),
);
const checkinSettingsView = memoizeRouteLoader(
  () => import("@/views/CheckinSettingsView.vue"),
);
const growthGroupsView = memoizeRouteLoader(
  () => import("@/views/GrowthGroupsView.vue"),
);
const feedbackView = memoizeRouteLoader(
  () => import("@/views/FeedbackView.vue"),
);
const tasksView = memoizeRouteLoader(() => import("@/views/TasksView.vue"));
const profitabilityView = memoizeRouteLoader(
  () => import("@/views/ProfitabilityView.vue"),
);
const agentQualityView = memoizeRouteLoader(
  () => import("@/views/AgentQualityView.vue"),
);
const modelConfigView = memoizeRouteLoader(
  () => import("@/views/ModelConfigView.vue"),
);
const canvasTemplatesView = memoizeRouteLoader(
  () => import("@/views/CanvasTemplatesView.vue"),
);
const promptLibraryView = memoizeRouteLoader(
  () => import("@/views/PromptLibraryView.vue"),
);
const ecommerceView = memoizeRouteLoader(
  () => import("@/views/EcommerceCatalogView.vue"),
);
const communityView = memoizeRouteLoader(
  () => import("@/views/CommunityView.vue"),
);
const galleryView = memoizeRouteLoader(
  () => import("@/views/GalleryView.vue"),
);
const contentView = memoizeRouteLoader(
  () => import("@/views/ContentView.vue"),
);
const pageControlsView = memoizeRouteLoader(
  () => import("@/views/PageControlsView.vue"),
);
const auditView = memoizeRouteLoader(() => import("@/views/AuditView.vue"));
const platformLogsView = memoizeRouteLoader(() => import("@/views/PlatformLogsView.vue"));
const securityCenterView = memoizeRouteLoader(() => import("@/views/SecurityCenterView.vue"));
const settingsView = memoizeRouteLoader(
  () => import("@/views/SettingsView.vue"),
);

const routeLoaders = new Map<string, RouteLoader>([
  ["/login", loginView],
  ["/forbidden", forbiddenView],
  ["/", dashboardView],
  ["/users", usersView],
  ["/codes", codesView],
  ["/plans", plansView],
  ["/orders", ordersView],
  ["/trial-applications", trialApplicationsView],
  ["/checkin-activity", checkinSettingsView],
  ["/growth-groups", growthGroupsView],
  ["/feedback", feedbackView],
  ["/tasks", tasksView],
  ["/profitability", profitabilityView],
  ["/agent-quality", agentQualityView],
  ["/model-config", modelConfigView],
  ["/canvas-templates", canvasTemplatesView],
  ["/prompt-library", promptLibraryView],
  ["/ecommerce", ecommerceView],
  ["/community", communityView],
  ["/gallery", galleryView],
  ["/content", contentView],
  ["/page-controls", pageControlsView],
  ["/audit", auditView],
  ["/platform-logs", platformLogsView],
  ["/security-center", securityCenterView],
  ["/settings", settingsView],
]);

/** 仅下载目标页面模块，不创建组件，因此不会触发页面接口。 */
export async function preloadAdminRoute(path: string): Promise<void> {
  const normalizedPath = path !== "/" ? path.replace(/\/$/, "") : path;
  const loader = routeLoaders.get(normalizedPath);
  if (!loader) return;
  try {
    await loader();
  } catch {
    // 导航本身会重试并通过 router.onError 处理资源版本问题。
  }
}

const router = createRouter({
  history: createWebHistory("/admin/"),
  routes: [
    {
      path: "/login",
      component: loginView,
      meta: { public: true, title: "登录" },
    },
    {
      path: "/forbidden",
      component: forbiddenView,
      meta: { public: true, title: "无权限" },
    },
    {
      path: "/",
      component: adminLayout,
      children: [
        {
          path: "",
          component: dashboardView,
          meta: { title: "仪表盘" },
        },
        {
          path: "users",
          component: usersView,
          meta: { title: "用户管理" },
        },
        {
          path: "codes",
          component: codesView,
          meta: { title: "兑换码" },
        },
        {
          path: "plans",
          component: plansView,
          meta: { title: "套餐管理" },
        },
        {
          path: "orders",
          component: ordersView,
          meta: { title: "订单管理" },
        },
        {
          path: "trial-applications",
          component: trialApplicationsView,
          meta: { title: "体验活动" },
        },
        {
          path: "checkin-activity",
          component: checkinSettingsView,
          meta: { title: "签到活动" },
        },
        {
          path: "growth-groups",
          component: growthGroupsView,
          meta: { title: "好友拼团" },
        },
        {
          path: "feedback",
          component: feedbackView,
          meta: { title: "用户反馈" },
        },
        {
          path: "tasks",
          component: tasksView,
          meta: { title: "任务与调度" },
        },
        {
          path: "profitability",
          component: profitabilityView,
          meta: { title: "成本利润" },
        },
        {
          path: "agent-quality",
          component: agentQualityView,
          meta: { title: "Agent 质量" },
        },
        {
          path: "model-config",
          component: modelConfigView,
          meta: { title: "模型配置" },
        },
        {
          path: "canvas-templates",
          component: canvasTemplatesView,
          meta: { title: "画布模板" },
        },
        {
          path: "prompt-library",
          component: promptLibraryView,
          meta: { title: "提示词库" },
        },
        {
          path: "ecommerce",
          component: ecommerceView,
          meta: { title: "电商素材" },
        },
        {
          path: "community",
          component: communityView,
          meta: { title: "社区管理" },
        },
        {
          path: "gallery",
          component: galleryView,
          meta: { title: "投稿审核" },
        },
        {
          path: "content",
          component: contentView,
          meta: { title: "内容管理" },
        },
        {
          path: "page-controls",
          component: pageControlsView,
          meta: { title: "页面控制" },
        },
        {
          path: "audit",
          component: auditView,
          meta: { title: "审计日志" },
        },
        {
          path: "platform-logs",
          component: platformLogsView,
          meta: { title: "运行日志" },
        },
        {
          path: "security-center",
          component: securityCenterView,
          meta: { title: "安全中心" },
        },
        {
          path: "settings",
          component: settingsView,
          meta: { title: "系统设置" },
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

const assetReloadKey = "starclouds-admin:asset-version-reload";
const assetLoadErrorPattern =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

function recoverFromStaleAssetVersion(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!assetLoadErrorPattern.test(message)) return false;

  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const now = Date.now();
  let previous: { path?: string; at?: number } | null = null;
  try {
    previous = JSON.parse(
      window.sessionStorage.getItem(assetReloadKey) || "null",
    );
  } catch {
    previous = null;
  }
  if (previous?.path === path && now - Number(previous.at || 0) < 30_000)
    return false;

  window.sessionStorage.setItem(
    assetReloadKey,
    JSON.stringify({ path, at: now }),
  );
  window.location.replace(path);
  return true;
}

window.addEventListener("vite:preloadError", (event) => {
  const preloadEvent = event as Event & { payload?: unknown };
  if (recoverFromStaleAssetVersion(preloadEvent.payload || event))
    event.preventDefault();
});

router.onError((error) => {
  recoverFromStaleAssetVersion(error);
});

router.beforeEach(async (to, from) => {
  if (to.path !== from.path) abortPendingPageRequests();

  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();

  if (to.meta.public) {
    // 已登录管理员访问登录页时直接进后台
    if (to.path === "/login" && auth.isAdmin) return "/";
    return true;
  }
  if (!auth.user) return { path: "/login", query: { redirect: to.fullPath } };
  if (!auth.isAdmin) return "/forbidden";
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title
    ? `${to.meta.title} · StartClouds 管理后台`
    : "StartClouds 管理后台";
});

export default router;
