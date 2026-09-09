export const QUEUE_CAPACITY_CODES = new Set(["user_task_limit", "user_image_capacity", "system_task_capacity", "system_image_capacity"]);
export const LOCAL_SUBMISSION_STATUSES = new Set(["submitting", "submission_pending", "submission_unknown", "submission_failed", "queue_full"]);

export function submissionFailure(error) {
  const code = String(error?.code || "");
  if (QUEUE_CAPACITY_CODES.has(code)) return { status: "queue_full", code, message: error.message || "排队容量已满，请稍后重试" };
  if (error?.name === "AbortError" || ["task_submission_uncertain", "network_error"].includes(code) || Number(error?.status) >= 500) {
    return { status: "submission_unknown", code: "task_submission_uncertain", message: "提交结果暂未确认，已保留本次参数，可核对后继续提交" };
  }
  if (code === "price_changed") return { status: "submission_pending", code, message: "价格已更新，请确认费用后继续提交" };
  return { status: "submission_failed", code, message: error?.message || "任务未能提交，请检查参数后重试" };
}

export function submissionTask(entry, batch, status = "") {
  const payload = entry.payload;
  const failure = entry.error ? submissionFailure(entry.error) : null;
  return {
    id: payload.clientRequestId, clientRequestId: payload.clientRequestId, serverJobId: "", kind: payload.kind,
    status: status || failure?.status || "submission_pending",
    prompt: payload.input?.userPrompt || payload.prompt,
    model: payload.params?.publicModelKey || "", publicModelKey: payload.params?.publicModelKey || "",
    aspectRatio: payload.input?.aspectRatio || "1:1", outputSize: payload.input?.outputSize || "",
    input: payload.input, params: payload.params, inputKeys: payload.inputKeys || [],
    outputs: [], thumbnailOutputs: [], createdAt: batch.batchCreatedAt, startedAt: "", finishedAt: "",
    error: failure?.message || "尚未进入服务器队列", errorCode: failure?.code || "",
    batchId: batch.batchId, batchIndex: payload.input?.batchIndex || 0, batchSize: batch.batchSize,
  };
}

export function serverTaskCounts(tasks) {
  const accepted = tasks.filter(task => task.serverJobId);
  return {
    running: accepted.filter(task => ["running", "waiting_provider"].includes(task.status) || (task.status === "queued" && task.cancelPolicy?.upstreamSubmitted === true)).length,
    queued: accepted.filter(task => task.status === "queued" && task.cancelPolicy?.upstreamSubmitted !== true).length,
    submitting: tasks.filter(task => !task.serverJobId && task.status === "submitting").length,
    pending: tasks.filter(task => !task.serverJobId && LOCAL_SUBMISSION_STATUSES.has(task.status) && task.status !== "submitting").length,
  };
}

export function taskStatePresentation(task) {
  const state = task?.status;
  if (state === "submitting") return { label: "正在提交", detail: "正在等待服务器接收，本次尚未进入队列", motion: "submitting" };
  if (state === "submission_pending") return { label: "待提交", detail: task.error || "本次参数已保留，确认后可继续提交", motion: "waiting" };
  if (state === "submission_unknown") return { label: "提交待确认", detail: task.error || "请核对提交状态后继续", motion: "warning" };
  if (state === "submission_failed") return { label: "提交未成功", detail: task.error || "请检查参数后重试", motion: "warning" };
  if (state === "queue_full") return { label: "排队容量已满", detail: task.error || "尚未进入队列，参数已保留，请稍后重试", motion: "full" };
  if (state === "queued") {
    if (task.cancelPolicy?.upstreamSubmitted === true) return { label: "等待上游结果", detail: "请求已提交上游，正在等待或恢复结果", motion: "generating" };
    const reasons = { user_execution_limit: "正在等待你的生成名额", user_queue_order: "正在等待前面的任务", global_execution_limit: "正在等待平台生成名额", provider_execution_limit: "正在等待模型可用线路", forecast_completion_pressure: "正在等待图片处理资源" };
    return { label: "排队中", detail: reasons[task.queueReason] || "已进入队列，等待可用生成名额", motion: "waiting" };
  }
  if (task?.generationStage === "preparing") return { label: "准备生成", detail: "正在读取参数与参考图", motion: "submitting" };
  if (task?.generationStage === "fetching_result") return { label: "读取结果", detail: "图片已生成，正在读取原图", motion: "saving" };
  if (task?.generationStage === "saving_result") return { label: "保存图片", detail: "正在保存原图和预览图", motion: "saving" };
  return { label: "生成中", detail: "模型正在绘制画面", motion: "generating" };
}
