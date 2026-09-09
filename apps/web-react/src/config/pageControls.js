export const PAGE_STATUS = Object.freeze({
  NORMAL: "normal",
  MAINTENANCE: "maintenance",
  DEVELOPING: "developing",
  REMOVED: "removed",
});

const PAGE_KEYS = [
  "studio",
  "canvas",
  "ecommerce.tryon",
  "ecommerce.handheld",
  "ecommerce.accessory",
  "ecommerce.shoot",
  "ecommerce.listing",
  "ecommerce.detail",
  "ecommerce.campaign",
  "ecommerce.background",
  "ecommerce.backdrop",
  "ecommerce.shadow",
  "ecommerce.outpaint",
  "ecommerce.enhance",
  "assistant",
  "developer_api",
  "text_to_image",
  "model_sheet",
  "illustration_coloring",
  "ui_design",
  "game_art",
  "pricing",
  "holo_card",
  "psd_decompose",
  "skills",
  "invitation",
  "developer_api_docs",
  "ai_tools",
  "prompts",
  "share",
  "app_space",
  "updates",
  "feedback",
  "background_remove",
  "image_compress",
  "puzzle",
  "media_tools",
  "history",
  "assets",
  "submissions",
  "wallet",
  "orders",
  "subscriptions",
  "notifications",
  "profile",
  "activity.checkin",
  "activity.trial",
  "activity.usage",
  "activity.group",
  "activity.suggestion",
  "activity.failure",
];

const PAGE_LABELS = Object.freeze({
  studio: "创作台",
  canvas: "无限画布",
  "ecommerce.tryon": "虚拟试衣",
  "ecommerce.handheld": "手持商品",
  "ecommerce.accessory": "饰品穿戴",
  "ecommerce.shoot": "AI 商拍",
  "ecommerce.listing": "商品套图",
  "ecommerce.detail": "A+ 详情",
  "ecommerce.campaign": "营销图",
  "ecommerce.background": "背景生成",
  "ecommerce.backdrop": "背景复刻",
  "ecommerce.shadow": "商品阴影",
  "ecommerce.outpaint": "智能扩图",
  "ecommerce.enhance": "清晰增强",
  assistant: "AI 助手",
  developer_api: "开发者 API",
  text_to_image: "文生图",
  model_sheet: "模型设计",
  illustration_coloring: "插画染色",
  ui_design: "UI 设计稿",
  game_art: "游戏设计",
  pricing: "创作价格",
  holo_card: "闪光卡",
  psd_decompose: "PSD 分解",
  skills: "Skill 中心",
  invitation: "邀请好友",
  developer_api_docs: "API 文档",
  ai_tools: "全部工具",
  prompts: "提示词",
  share: "作品社区",
  app_space: "关于我们",
  updates: "更新说明",
  feedback: "问题反馈",
  background_remove: "背景移除",
  image_compress: "图片压缩",
  puzzle: "拼图",
  media_tools: "媒体工具",
  history: "历史记录",
  assets: "我的资产",
  submissions: "我的投稿",
  wallet: "我的钱包",
  orders: "我的订单",
  subscriptions: "我的订阅",
  notifications: "通知中心",
  profile: "个人中心",
  "activity.checkin": "签到活动",
  "activity.trial": "申请体验",
  "activity.usage": "用量激励",
  "activity.group": "好友拼团",
  "activity.suggestion": "建议采纳",
  "activity.failure": "失败补偿",
});

export const ECOMMERCE_PAGE_KEYS = Object.freeze([
  "tryon",
  "handheld",
  "accessory",
  "shoot",
  "listing",
  "detail",
  "campaign",
  "background",
  "backdrop",
  "shadow",
  "outpaint",
  "enhance",
].map((id) => `ecommerce.${id}`));

export const INCENTIVE_PAGE_KEYS = Object.freeze([
  "activity.usage",
  "activity.group",
  "activity.suggestion",
  "activity.failure",
]);

export function getDefaultPageControls() {
  const controls = Object.fromEntries(
    PAGE_KEYS.map((key) => [key, { status: PAGE_STATUS.NORMAL, reason: "" }]),
  );
  for (const key of ["illustration_coloring", "game_art"]) {
    controls[key] = {
      status: PAGE_STATUS.DEVELOPING,
      reason: "功能正在开发中，敬请期待。",
    };
  }
  for (const key of [
    "activity.checkin",
    "activity.trial",
    ...INCENTIVE_PAGE_KEYS,
  ]) {
    controls[key] = { status: PAGE_STATUS.REMOVED, reason: "活动已下架。" };
  }
  controls.developer_api = {
    status: PAGE_STATUS.REMOVED,
    reason: "开放 API 正在内部测试。",
  };
  return controls;
}

export function normalizePageControls(values = {}) {
  const controls = getDefaultPageControls();
  for (const key of PAGE_KEYS) {
    const value = values?.[key];
    if (!value || !Object.values(PAGE_STATUS).includes(value.status)) continue;
    controls[key] = {
      status: value.status,
      reason: String(value.reason || "").trim(),
    };
  }
  return controls;
}

function ecommercePageKey(search = "") {
  const tool = new URLSearchParams(search).get("tool") || "shoot";
  const key = `ecommerce.${tool}`;
  return PAGE_KEYS.includes(key) ? key : null;
}

function normalizePagePath(pathname) {
  let path = String(pathname || "/");
  try {
    path = path.split("/").map((segment) => decodeURIComponent(segment).replace(/\//g, "%2F")).join("/");
  } catch {
    // Keep malformed paths available to the router's normal error handling.
  }
  return path.replace(/\/+$/, "").toLowerCase() || "/";
}

export function pageKeyForLocation(pathname, search = "") {
  pathname = normalizePagePath(pathname);
  if (pathname === "/studio") return "studio";
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return "canvas";
  if (pathname === "/assistant") return "assistant";
  if (pathname === "/developer-api") return "developer_api";
  if (pathname === "/developer-api/docs") return "developer_api_docs";
  if (pathname === "/text-to-image" || pathname === "/ai-wallpaper") return "text_to_image";
  if (pathname === "/model-sheet") return "model_sheet";
  if (pathname === "/ai-illustration-coloring") return "illustration_coloring";
  if (pathname === "/design-workshop") return "ui_design";
  if (pathname === "/game-art") return "game_art";
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/holo-card" || pathname === "/holo-card/sample") return "holo_card";
  if (pathname === "/psd-decompose") return "psd_decompose";
  if (pathname === "/skills") return "skills";
  if (pathname === "/invite") return "invitation";
  if (pathname === "/ai-tools") return "ai_tools";
  if (pathname === "/prompts") return "prompts";
  if (pathname === "/share") return "share";
  if (pathname === "/app-space") return "app_space";
  if (pathname === "/updates") return "updates";
  if (pathname === "/feedback") return "feedback";
  if (pathname === "/tools/background-remove") return "background_remove";
  if (pathname === "/tools/image-compress") return "image_compress";
  if (pathname === "/tools/puzzle" || pathname === "/ai-puzzle") return "puzzle";
  if (/^\/tools\/[^/]+$/.test(pathname)) return "media_tools";
  if (pathname === "/history") return "history";
  if (pathname === "/assets" || pathname === "/materials") return "assets";
  if (pathname === "/submissions") return "submissions";
  if (pathname === "/wallet") return "wallet";
  if (pathname === "/orders") return "orders";
  if (pathname === "/subscriptions" || pathname === "/incentive-plans/membership") return "subscriptions";
  if (pathname === "/notifications") return "notifications";
  if (pathname === "/profile") return "profile";
  if (pathname === "/check-in") return "activity.checkin";
  if (pathname === "/incentive-plans/usage" || pathname === "/incentive-plans/milestone")
    return "activity.usage";
  if (pathname === "/incentive-plans/group") return "activity.group";
  if (pathname === "/incentive-plans/suggestion") return "activity.suggestion";
  if (pathname === "/incentive-plans/failure") return "activity.failure";
  return null;
}

export function pageKeyForHref(href = "") {
  const [rawPathname, query = ""] = String(href).split("#")[0].split("?");
  const pathname = normalizePagePath(rawPathname);
  if (pathname === "/ecommerce-design") {
    return ecommercePageKey(query ? `?${query}` : "");
  }
  return pageKeyForLocation(rawPathname, query ? `?${query}` : "");
}

export function pageControlForKey(controls, key) {
  if (!key) return { status: PAGE_STATUS.NORMAL, reason: "" };
  return controls?.[key] || getDefaultPageControls()[key] || {
    status: PAGE_STATUS.NORMAL,
    reason: "",
  };
}

export function pageControlForLocation(controls, pathname, search = "") {
  if (normalizePagePath(pathname) === "/incentive-plans") {
    const removed = INCENTIVE_PAGE_KEYS.every(
      (key) => pageControlForKey(controls, key).status === PAGE_STATUS.REMOVED,
    );
    return removed
      ? { status: PAGE_STATUS.REMOVED, reason: "相关激励活动已下架。", key: "activity.index", label: "创作激励" }
      : { status: PAGE_STATUS.NORMAL, reason: "", key: "activity.index", label: "创作激励" };
  }
  const key = pageKeyForLocation(pathname, search);
  return { ...pageControlForKey(controls, key), key, label: PAGE_LABELS[key] || "当前页面" };
}

export function isPageEntryVisible(controls, keyOrHref) {
  if (normalizePagePath(String(keyOrHref || "").split(/[?#]/)[0]) === "/incentive-plans") {
    return INCENTIVE_PAGE_KEYS.some(
      (key) => pageControlForKey(controls, key).status !== PAGE_STATUS.REMOVED,
    );
  }
  const key = String(keyOrHref || "").startsWith("/")
    ? pageKeyForHref(keyOrHref)
    : keyOrHref;
  return pageControlForKey(controls, key).status !== PAGE_STATUS.REMOVED;
}
