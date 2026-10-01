const TASK_TYPE_LABELS = {
  t2i: "文生图",
  infinite_canvas: "无限画布",
  coloring: "插画染色",
  ui_design: "UI 设计稿",
  ecommerce_design: "AI 电商",
  model_sheet: "模型设计",
  game_art: "游戏设计",
  puzzle: "拼图",
  background_remove: "背景移除",
  assistant: "AI 助手",
};

const PRODUCT_NAMES = [
  "无限画布",
  "画布去背",
  "文生图",
  "插画染色",
  "UI 设计稿",
  "AI 电商",
  "模型设计",
  "游戏设计",
  "拼图",
  "背景移除",
  "AI 助手",
  "图片生成",
];

function labelForTaskCode(code) {
  const raw = String(code || "").trim();
  if (!raw) return "";
  if (TASK_TYPE_LABELS[raw]) return TASK_TYPE_LABELS[raw];
  const base = raw.replace(/[-_]\d+$/, "");
  return TASK_TYPE_LABELS[base] || "";
}

function extractQuotedTaskLabel(body) {
  const match = String(body || "").match(/「([^」]+)」/);
  return match ? labelForTaskCode(match[1]) : "";
}

function stripLeadingProductName(title, body) {
  let text = String(body || "").trim();
  const heading = String(title || "");
  for (const name of PRODUCT_NAMES) {
    if (heading.includes(name) && text.startsWith(name)) {
      return text.slice(name.length).replace(/^的?/, "").trim();
    }
  }
  return text;
}

/** Hide machine task codes like 「t2i」 and keep a readable task name. */
export function displayNotificationBody(body) {
  let text = String(body || "").trim();
  if (!text) return "";
  text = text.replace(/你的「([^」]+)」任务/g, (_, code) => {
    const label = labelForTaskCode(code);
    return label || "任务";
  });
  text = text.replace(/「([^」]+)」/g, (match, code) => {
    const label = labelForTaskCode(code);
    return label || match;
  });
  return text
    .replace(/^任务已生成/, "已生成")
    .replace(/^任务执行失败/, "执行失败")
    .replace(/^任务已被管理员取消/, "已被管理员取消")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function displayNotificationTitle(title, body) {
  const rawTitle = String(title || "").trim() || "通知";
  if (PRODUCT_NAMES.some((name) => rawTitle.includes(name))) return rawTitle;
  const label = extractQuotedTaskLabel(body);
  if (!label) return rawTitle;
  if (rawTitle === "任务已完成") return `${label}已完成`;
  if (rawTitle === "任务失败") return `${label}失败`;
  if (rawTitle === "任务已取消") return `${label}已取消`;
  return rawTitle;
}

export function isAnnouncementNotification(item) {
  const kind = String(item?.kind || "").toLowerCase();
  return kind.includes("announce") || String(item?.title || "").includes("公告");
}

export function displayNotification(item) {
  const title = displayNotificationTitle(item?.title, item?.body);
  const body = stripLeadingProductName(title, displayNotificationBody(item?.body));
  return { title, body };
}
