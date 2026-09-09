import { pendingBatchEntries } from "./submissionBatch.js";
import { QUEUE_CAPACITY_CODES } from "./submissionState.js";

function points(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function generationButtonState({ authenticated = true, loading = false, referencesReady = true,
  hasPrompt = true, modelReady = true, invalidSize = false, quoting = false, confirmation = null,
  submitting = false, submissionPhase = "", pendingBatch = null, taskCounts = {}, generationCost = null, count = 1 } = {}) {
  const remaining = pendingBatchEntries(pendingBatch);
  const full = remaining.some(entry => QUEUE_CAPACITY_CODES.has(entry.error?.code));
  let amount = modelReady ? points(generationCost) : null;
  let imageCount = count;
  if (remaining.length) {
    imageCount = remaining.length;
    const prices = remaining.map(entry => entry.error?.code === "price_changed" || entry.payload?.input?.autoBackgroundRemovalEnabled
      ? null : points(entry.payload?.expectedUnitPriceCents));
    amount = prices.every(price => price !== null) ? prices.reduce((sum, price) => sum + price, 0) : null;
  }
  const busy = submitting || submissionPhase === "recovering" || quoting;
  const disabled = authenticated && (busy || !referencesReady || (!remaining.length && (loading || !hasPrompt || !modelReady || invalidSize)));
  const result = { state: "ready", label: "立即生成", points: amount, count: imageCount, disabled, busy,
    title: amount === null ? "提交前核对本次费用" : `本次预计 ${amount} 积分，生成 ${imageCount} 张` };
  if (submitting || submissionPhase === "recovering") {
    const phase = submissionPhase || "submitting";
    return { ...result, state: phase, label: phase === "uploading" ? "上传参考图" : phase === "recovering" ? "核对提交" : "正在提交", title: "正在处理本次提交，请稍候" };
  }
  if (quoting) return { ...result, state: "quoting", label: "核算费用", title: "正在核对最新费用" };
  if (confirmation) return { ...result, state: "confirming", label: "等待确认", disabled: true, points: points(confirmation.total), count: confirmation.count, title: "请在费用弹窗中确认本次生成" };
  if (full) return { ...result, state: "full", label: "队列满·重试", title: `排队容量已满；点击核对费用并重试剩余 ${imageCount} 张` };
  if (remaining.length) return { ...result, state: "retry", label: "继续提交", title: `只补交尚未接受的 ${imageCount} 张，沿用原模型与参数` };
  if (authenticated && (loading || !referencesReady)) return { ...result, state: "loading", label: "正在准备", title: "正在读取生成配置和参考图" };
  if (authenticated && !modelReady) return { ...result, state: "unavailable", label: "暂无可用模型", points: null, title: "当前没有可用的生成模型" };
  if (authenticated && invalidSize) return { ...result, state: "invalid", label: "请调整尺寸", title: "请先调整生成尺寸" };
  if (authenticated && !hasPrompt) return { ...result, state: "empty", label: "输入提示词", title: "填写提示词后即可生成" };
  if (taskCounts.running) return { ...result, state: "generating", label: "继续生成", title: `已有 ${taskCounts.running} 张生成中，点击可创建新一批任务` };
  if (taskCounts.queued) return { ...result, state: "waiting", label: "继续生成", title: `已有 ${taskCounts.queued} 张排队中，点击可继续提交新任务` };
  return result;
}
