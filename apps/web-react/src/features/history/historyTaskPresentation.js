export function historyTaskStatus(task) {
  const status = String(task?.status || "").trim().toLowerCase();
  return status === "cancelled" ? "canceled" : status;
}

function timestamp(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

export function historyTaskDurationMs(task, now = Date.now()) {
  const startedAt = timestamp(task?.startedAt);
  if (startedAt == null) return null;
  const terminal = ["succeeded", "failed", "canceled"].includes(historyTaskStatus(task));
  const finishedAt = timestamp(task?.finishedAt);
  const end = finishedAt ?? (terminal ? null : Number(now));
  if (end == null || !Number.isFinite(end)) return null;
  return Math.max(0, end - startedAt);
}

export function formatHistoryDuration(durationMs) {
  if (durationMs == null || !Number.isFinite(Number(durationMs))) return "";
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
  if (totalSeconds < 1) return "不足1秒";
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return seconds ? `${totalMinutes}分${seconds}秒` : `${totalMinutes}分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}小时${minutes ? `${minutes}分` : ""}${seconds ? `${seconds}秒` : ""}`;
}

export function historyTaskDurationLabel(task, now = Date.now()) {
  const duration = historyTaskDurationMs(task, now);
  if (duration != null) return formatHistoryDuration(duration);
  const status = historyTaskStatus(task);
  if (["failed", "canceled", "succeeded"].includes(status)) return "未开始生成";
  if (status === "queued") return "等待开始";
  return "准备中";
}

export function historyTaskCanOpen(_task, hasCover = false) {
  return Boolean(hasCover);
}
