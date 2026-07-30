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

export function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** 任务类型 */
export const TASK_TYPES = [
  "t2i",
  "coloring",
  "ui_design",
  "model_sheet",
  "game_art",
  "puzzle",
] as const;

export const IMAGE_SERVICE_ROUTES = [
  { key: "t2i", label: "文生图", detail: "文字生成与参考图编辑" },
  { key: "coloring", label: "插画染色", detail: "线稿与配色参考图" },
  { key: "ui_design", label: "UI 设计稿", detail: "整张设计稿生成" },
  {
    key: "ui_design_asset",
    label: "UI 素材重建",
    detail: "选区 PNG / 透明素材",
  },
  { key: "model_sheet", label: "超高清模型图", detail: "多视角模型参考" },
  { key: "game_art", label: "游戏设计", detail: "角色、场景、道具与 UI" },
  {
    key: "assistant_image",
    label: "AI 助手生图",
    detail: "助手中的生成与改图",
  },
] as const;

export type ImageServiceRouteKey = (typeof IMAGE_SERVICE_ROUTES)[number]["key"];

export const TASK_TYPE_LABELS: Record<string, string> = {
  assistant: "AI助手",
  t2i: "文生图",
  coloring: "插画染色",
  ui_design: "UI设计稿",
  model_sheet: "超高清模型图",
  game_art: "游戏设计",
  puzzle: "AI拼图",
};

export function taskTypeLabel(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type;
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "成功",
  failed: "失败",
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
  task_refund: "任务退款",
  refund: "退款",
};

export function ledgerKindLabel(kind: string): string {
  return LEDGER_KIND_LABELS[kind] ?? kind;
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
