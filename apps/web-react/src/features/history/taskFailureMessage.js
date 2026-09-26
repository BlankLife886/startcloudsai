const ERROR_CODE_MESSAGES = {
  upstream_unreachable: "生成服务暂时不可用，请稍后重试",
  upstream_unavailable: "生成服务暂时不可用，请稍后重试",
  upstream_rate_limited: "生成服务当前繁忙或额度不足，请稍后重试",
  upstream_auth_failed: "模型服务配置异常，请联系管理员处理",
  image_stream_timeout: "生成服务响应超时，请稍后重试",
  image_poll_timeout: "图片生成超时，请稍后重试",
  storage_error: "图片保存失败，请重试",
  image_processing_error: "图片处理失败，请重试",
  upstream_text_reply: "上游返回了文本内容，没有生成图片",
  user_canceled: "任务已由用户取消",
  admin_canceled: "任务已由管理员取消",
  system_canceled: "任务已由系统停止",
};

const URL_PATTERN = /https?:\/\/\S+/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const PREFIXED_ID_PATTERN = /\b((?:client|request|task|trace|run|job)[\s_-]*id)\s*[:=]\s*["']?[^\s,;"']+/gi;
const MAX_FAILURE_MESSAGE_LENGTH = 500;

function safeFailureText(value) {
  const cleaned = String(value || "")
    .replace(URL_PATTERN, "")
    .replace(UUID_PATTERN, "[编号已隐藏]")
    .replace(PREFIXED_ID_PATTERN, "$1: [编号已隐藏]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export function taskFailureMessage(task, fallback = "生成失败，请稍后重试") {
  const params = task?.params && typeof task.params === "object" ? task.params : {};
  const code = String(task?.errorCode || params.errorCode || "").trim().toLowerCase();
  const message = safeFailureText(
    task?.errorMessage || task?.error || params.errorMessage || params.error,
  );
  const knownMessage = ERROR_CODE_MESSAGES[code];
  if (knownMessage && (!message || message.toLowerCase().startsWith(`${code}:`))) {
    return knownMessage;
  }
  if (message) return message;
  return knownMessage || fallback;
}
