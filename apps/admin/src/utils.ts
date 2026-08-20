/**
 * 钱包与模型价格使用整数积分。后端历史字段仍以 Cents 结尾，
 * 但字段值就是积分数，界面和业务层不得再做分/元换算。
 */
export function formatPoints(points: number | null | undefined): string {
  if (points === null || points === undefined) return "-";
  const value = Number(points);
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("zh-CN");
}

export function normalizePoints(points: number | null | undefined): number {
  const value = Number(points ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** UTC ISO8601 → 本地时间展示 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** 列表用短时间：`MM-DD HH:mm` */
export function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * 管理后台查看用户文件统一走管理员鉴权路由（避免用户会话 401），
 * 与用户端 /api/v1/files/*key 返回相同内容。
 */
export function adminFileUrl(key: string): string {
  return `/api/v1/admin/files/${key}`;
}

/** 任务类型 */
export const TASK_TYPES = [
  "t2i",
  "infinite_canvas",
  "coloring",
  "ui_design",
  "ecommerce_design",
  "model_sheet",
  "game_art",
  "puzzle",
] as const;

export const PROMPT_TASK_TYPES = ["assistant", ...TASK_TYPES] as const;

export const IMAGE_SERVICE_ROUTES = [
  { key: "t2i", label: "文生图", detail: "文字生成与参考图编辑" },
  { key: "infinite_canvas", label: "无限画布", detail: "画布节点生成与改图" },
  { key: "coloring", label: "插画染色", detail: "线稿与配色参考图" },
  {
    key: "ui_design",
    label: "UI 设计稿",
    detail: "整张设计稿生成（工作区 ui_design 图片价）",
  },
  { key: "ecommerce_design", label: "AI 电商", detail: "商品图、详情页与营销视觉" },
  {
    key: "ui_design_asset",
    label: "UI 框选优化 / 素材重建",
    detail: "设计稿框选二次处理与局部素材重建，计费同 ui_design 图片模型单价 × 1",
  },
  { key: "model_sheet", label: "模型设计", detail: "多视角模型参考" },
  { key: "game_art", label: "游戏设计", detail: "角色、场景、道具与 UI" },
  {
    key: "assistant_image",
    label: "AI 助手生图",
    detail: "助手中的生成与改图",
  },
] as const;

export type ImageServiceRouteKey = (typeof IMAGE_SERVICE_ROUTES)[number]["key"];

export const TASK_TYPE_LABELS: Record<string, string> = {
  assistant: "AI 助手",
  t2i: "文生图",
  infinite_canvas: "无限画布",
  coloring: "插画染色",
  ui_design: "UI设计稿",
  ecommerce_design: "AI电商",
  model_sheet: "模型设计",
  game_art: "游戏设计",
  puzzle: "拼图",
  background_remove: "背景移除",
};

export function taskTypeLabel(
  type: string,
  params?: Record<string, unknown> | null,
  source?: string,
): string {
  const origin = String(params?._source || params?.source || source || "");
  const kind = String(params?._kind || "");
  const workspace = String(params?.workspace || "");
  if (
    origin === "react_canvas" ||
    origin === "infinite_canvas" ||
    workspace === "infinite_canvas" ||
    kind.startsWith("canvas-")
  ) {
    return kind === "canvas-background-remove" ? "画布去背" : "无限画布";
  }
  return TASK_TYPE_LABELS[type] ?? type;
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已成功",
  failed: "已失败",
  canceled: "已取消",
};

export const TASK_STATUS_TAG: Record<
  string,
  "info" | "primary" | "success" | "danger" | "warning"
> = {
  queued: "info",
  running: "primary",
  succeeded: "success",
  failed: "danger",
  canceled: "warning",
};

/** 账本 kind → 中文（契约未穷举，未知 kind 原样展示） */
export const LEDGER_KIND_LABELS: Record<string, string> = {
  admin_adjust: "人工调整",
  order_grant: "充值入账",
  grant: "入账",
  signup_bonus: "注册赠送",
  task_spend: "任务消耗",
  spend: "消耗",
  freeze: "冻结",
  release: "解冻",
  task_refund: "任务退款",
  refund: "退款",
};

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_LABELS[kind] ?? kind;
}

export function ledgerReasonLabel(
  reason?: string | null,
  task?: { displayName?: string; source?: string; type?: string } | null,
): string {
  const text = String(reason || "").trim();
  const displayName = String(task?.displayName || "").trim();
  const source = String(task?.source || "").trim();
  const canvas =
    displayName === "无限画布" ||
    displayName === "画布去背" ||
    source === "react_canvas" ||
    source === "infinite_canvas";
  if (canvas && text) {
    return text
      .replaceAll("AI 助手", displayName || "无限画布")
      .replaceAll("任务冻结", "无限画布冻结")
      .replaceAll("任务结算", "无限画布结算")
      .replaceAll("任务解冻", "无限画布解冻")
      .replaceAll("任务重跑冻结", "无限画布重跑冻结");
  }
  return text || displayName || "-";
}

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  removed: "已下架",
};

export const SUBMISSION_STATUS_TAG: Record<
  string,
  "info" | "primary" | "success" | "danger" | "warning"
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  removed: "info",
};
