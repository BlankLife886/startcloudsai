// 动态调价的类型与预览计算。规则在服务端（internal/pricerules）生效，这里的计算只用于
// 后台预览，取整和底线规则与服务端保持一致。

export type RuleKind = "weekday" | "weekend" | "date";
export type AdjustMode = "percent" | "points";

export interface Adjustment {
  mode: AdjustMode;
  value: number;
}

export interface PriceRule {
  id: string;
  name: string;
  kind: RuleKind;
  enabled: boolean;
  startTime?: string;
  endTime?: string;
  startAt?: string;
  endAt?: string;
  models: Record<string, Adjustment>;
}

export interface PriceSchedule {
  enabled: boolean;
  rules: PriceRule[];
  subscriber: { enabled: boolean; models: Record<string, Adjustment> };
}

export interface ScheduleModel {
  id: string;
  name: string;
  kind: string;
  tool?: string;
  providerName: string;
  enabled: boolean;
  standardPricePoints: number;
  pricePoints: number;
  minPricePoints: number;
  maxPricePoints: number;
  tiered: boolean;
  upstreamCostPoints: number;
  allowZeroPrice: boolean;
  allowLossLeader: boolean;
}

export interface ActiveRule {
  ruleId: string;
  ruleName: string;
  kind: RuleKind;
  adjustment: Adjustment;
  endsAt: string;
}

export interface SchedulePayload {
  schedule: PriceSchedule;
  models: ScheduleModel[];
  now: string;
  active: Record<string, ActiveRule>;
  nextChangeAt: string | null;
}

export const KIND_LABELS: Record<RuleKind, string> = { date: "指定日期", weekend: "周末", weekday: "工作日" };
export const KIND_HINTS: Record<RuleKind, string> = {
  weekday: "周一到周五，每天在设定时段内生效",
  weekend: "周六、周日，每天在设定时段内生效",
  date: "从开始到结束的一段连续时间",
};

export const MIN_PERCENT = -95;
export const MAX_PERCENT = 500;

export function emptySchedule(): PriceSchedule {
  return { enabled: false, rules: [], subscriber: { enabled: false, models: {} } };
}

export function normalizeSchedule(value: Partial<PriceSchedule> | null | undefined): PriceSchedule {
  return {
    enabled: Boolean(value?.enabled),
    rules: (value?.rules || []).map((rule) => ({ ...rule, models: { ...(rule.models || {}) } })),
    subscriber: { enabled: Boolean(value?.subscriber?.enabled), models: { ...(value?.subscriber?.models || {}) } },
  };
}

// 与服务端 pricerules.Apply 相同：百分比四舍五入；降价时守住零积分和上游成本底线，
// 原价本身低于底线时不会被抬高。
export function applyAdjustment(price: number, adjustment: Adjustment, model: ScheduleModel, upstreamCost = model.upstreamCostPoints): number {
  let adjusted = price;
  if (adjustment.mode === "percent") adjusted = Math.round((price * (100 + adjustment.value)) / 100);
  else adjusted = price + adjustment.value;
  if (adjusted >= price) return adjusted;
  let minimum = model.allowZeroPrice ? 0 : 1;
  if (!model.allowLossLeader && upstreamCost > minimum) minimum = upstreamCost;
  if (minimum > price) minimum = price;
  return Math.max(adjusted, minimum);
}

// 调价后是否被底线截住（用于提示管理员）。
export function hitsFloor(price: number, adjustment: Adjustment, model: ScheduleModel): boolean {
  const raw = adjustment.mode === "percent" ? Math.round((price * (100 + adjustment.value)) / 100) : price + adjustment.value;
  return raw < price && applyAdjustment(price, adjustment, model) !== raw;
}

export function subscriberAdjustment(discount: Adjustment): Adjustment {
  return { mode: discount.mode, value: -Math.abs(discount.value) };
}

export function formatAdjustment(adjustment: Adjustment): string {
  if (!adjustment.value) return "原价";
  const sign = adjustment.value > 0 ? "+" : "−";
  const amount = Math.abs(adjustment.value);
  return adjustment.mode === "percent" ? `${sign}${amount}%` : `${sign}${amount} 积分`;
}

export function ruleWindowText(rule: PriceRule): string {
  if (rule.kind === "date") {
    const show = (value?: string) => (value ? value.replace("T", " ") : "—");
    return `${show(rule.startAt)} → ${show(rule.endAt)}`;
  }
  const days = rule.kind === "weekday" ? "周一至周五" : "周六、周日";
  return `${days} ${rule.startTime || "—"}–${rule.endTime || "—"}`;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

// 与服务端 Validate 对应的前端检查，返回第一条问题；没问题返回空串。
export function ruleProblem(rule: PriceRule): string {
  if (!rule.name.trim()) return "请填写规则名称";
  if (rule.kind === "date") {
    if (!DATE_TIME.test(rule.startAt || "") || !DATE_TIME.test(rule.endAt || "")) return "请选择开始和结束时间";
    if ((rule.endAt || "") <= (rule.startAt || "")) return "结束时间须晚于开始时间";
  } else {
    if (!CLOCK.test(rule.startTime || "") || !CLOCK.test(rule.endTime || "")) return "请填写 HH:MM 格式的时段";
    if (minutes(rule.endTime!) <= minutes(rule.startTime!)) return "结束时间须晚于开始时间（不跨天）";
  }
  for (const adjustment of Object.values(rule.models)) {
    if (adjustment.mode === "percent" && (adjustment.value < MIN_PERCENT || adjustment.value > MAX_PERCENT)) {
      return `百分比须在 ${MIN_PERCENT}% 到 +${MAX_PERCENT}% 之间`;
    }
  }
  return "";
}

// 时段下拉的候选：每 30 分钟一档，结束可选 24:00；也可以直接输入其他 HH:MM。
export const CLOCK_OPTIONS: string[] = Array.from({ length: 49 }, (_, index) => {
  const total = index * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});

// 北京时间的 YYYY-MM-DDTHH:mm。
export function beijingStamp(date: Date, offsetDays = 0): string {
  const shifted = new Date(date.getTime() + 8 * 3600_000 + offsetDays * 86400_000);
  return shifted.toISOString().slice(0, 16);
}

export function beijingClock(date: Date): string {
  return beijingStamp(date).replace("T", " ") + `:${String(new Date(date.getTime() + 8 * 3600_000).getUTCSeconds()).padStart(2, "0")}`;
}

export function newRule(kind: RuleKind, now: Date): PriceRule {
  const id = `rule-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (kind === "date") {
    const today = beijingStamp(now).slice(0, 10);
    const tomorrow = beijingStamp(now, 1).slice(0, 10);
    return { id, name: `${today} 活动`, kind, enabled: true, startAt: `${today}T00:00`, endAt: `${tomorrow}T00:00`, models: {} };
  }
  if (kind === "weekend") {
    return { id, name: "周末全天", kind, enabled: true, startTime: "00:00", endTime: "24:00", models: {} };
  }
  return { id, name: "工作日 09:00–17:00", kind, enabled: true, startTime: "09:00", endTime: "17:00", models: {} };
}
