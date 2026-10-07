import { LOCAL_SUBMISSION_STATUSES } from "@react/features/text-to-image/submissionState.js";

export const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function isFailed(task) {
  return ["failed", "paused", "cancelled", "canceled"].includes(task.status)
    || (LOCAL_SUBMISSION_STATUSES.has(task.status) && task.status !== "submitting");
}

function groupKey(task) {
  return task.batchId || task.clientRequestId || task.id;
}

function taskImages(task) {
  const outputs = Array.isArray(task.outputs) ? task.outputs : [];
  return outputs.map((url, index) => ({
    key: `${task.id}-${index}`,
    task,
    url,
    previewUrl: task.displayOutputs?.[index] || url,
    thumbUrl: task.thumbnailOutputs?.[index] || task.displayOutputs?.[index] || url,
  }));
}

/**
 * 把任务按“一次提交”聚合成作品卡片：同一批次的多张图放在一张卡里，最新的在最前。
 * 每个格子是 image / pending / failed 之一。
 */
export function buildWorkGroups(tasks) {
  const byKey = new Map();
  for (const task of tasks) {
    const key = groupKey(task);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(task);
  }
  const groups = [];
  byKey.forEach((members, key) => {
    members.sort((left, right) => Number(left.batchIndex || 0) - Number(right.batchIndex || 0));
    const cells = [];
    for (const task of members) {
      const images = taskImages(task);
      if (images.length) images.forEach((image) => cells.push({ kind: "image", ...image }));
      else if (ACTIVE_STATUSES.has(task.status) || task.status === "submitting") cells.push({ kind: "pending", key: task.id, task });
      else if (isFailed(task)) cells.push({ kind: "failed", key: task.id, task });
    }
    if (!cells.length) return;
    const lead = members[0];
    const createdAt = members.reduce((latest, task) => {
      const time = Date.parse(task.createdAt || 0) || 0;
      return Math.max(latest, time);
    }, 0);
    const signature = [
      lead.prompt,
      ...cells.map((cell) => [cell.kind, cell.key, cell.previewUrl || "", cell.task.status, cell.task.generationStage || "", cell.task.startedAt || ""].join(":")),
    ].join("|");
    groups.push({
      key,
      signature,
      lead,
      tasks: members,
      cells,
      images: cells.filter((cell) => cell.kind === "image"),
      pendingCount: cells.filter((cell) => cell.kind === "pending").length,
      failedCount: cells.filter((cell) => cell.kind === "failed").length,
      createdAt,
    });
  });
  return groups.sort((left, right) => right.createdAt - left.createdAt);
}

export function mergeTasks(...lists) {
  const byId = new Map();
  lists.flat().forEach((task) => {
    if (!task?.id) return;
    byId.set(task.id, { ...byId.get(task.id), ...task });
  });
  return [...byId.values()];
}

export function aspectOf(task) {
  const size = String(task?.actualOutputSize || task?.outputSize || "").match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (size && Number(size[1]) > 0 && Number(size[2]) > 0) return `${size[1]} / ${size[2]}`;
  const [width, height] = String(task?.aspectRatio || "1:1").split(":").map(Number);
  return width > 0 && height > 0 ? `${width} / ${height}` : "1 / 1";
}

export function relativeTime(value, now = Date.now()) {
  const time = typeof value === "number" ? value : Date.parse(value || 0);
  if (!time) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  const date = new Date(time);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${hhmm}`;
  const yesterday = new Date(now - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
}

export function formatElapsed(task, now) {
  const started = Date.parse(task?.startedAt || 0);
  if (!started || task.status === "queued") return "";
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const QUALITY_LABELS = { low: "快速", medium: "标准", standard: "标准", high: "高清", hd: "高清" };

export function ratioLabel(value) {
  return value === "auto" ? "自动" : value || "";
}

export function qualityLabel(value) {
  return QUALITY_LABELS[String(value || "").toLowerCase()] || value || "";
}

/** 宽高比数值（宽 / 高），用于按比例排版生成中、失败的占位框。 */
export function aspectNumber(task) {
  const [width, height] = aspectOf(task).split("/").map((part) => Number(part.trim()));
  return width > 0 && height > 0 ? width / height : 1;
}

/** 与 App 一致的规格行：模型 · 比例 · 清晰度 · 质量 · N 张。 */
export function groupSpec(group, modelLabel) {
  const task = group.lead;
  return [
    modelLabel,
    ratioLabel(task.aspectRatio),
    task.resolutionScale,
    qualityLabel(task.imageQuality),
    `${group.cells.length} 张`,
  ].filter(Boolean).join(" · ");
}

function timeOf(value) {
  return Date.parse(value || 0) || 0;
}

/** 单张耗时（秒）：从提交到完成；生成中则算到现在。 */
export function cellSeconds(task, now) {
  const start = timeOf(task.createdAt) || timeOf(task.startedAt);
  if (!start) return null;
  const end = ACTIVE_STATUSES.has(task.status) || task.status === "submitting" ? now : timeOf(task.finishedAt);
  if (!end) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** 整组耗时（秒）：最早提交到最晚完成。 */
export function groupSeconds(group, now) {
  const starts = group.tasks.map((task) => timeOf(task.createdAt) || timeOf(task.startedAt)).filter(Boolean);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  if (group.pendingCount) return Math.max(0, Math.round((now - start) / 1000));
  const ends = group.tasks.map((task) => timeOf(task.finishedAt)).filter(Boolean);
  if (!ends.length) return null;
  return Math.max(0, Math.round((Math.max(...ends) - start) / 1000));
}
