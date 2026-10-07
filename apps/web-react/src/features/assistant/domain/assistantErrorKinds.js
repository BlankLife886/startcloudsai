// 失败的回复按原因分类，给出用户能直接做的下一步。
// 服务端只给了一句错误文案（message.error），这里按文案里的关键词判断类型；
// 判断不出来的统一按“没完成，可以重试”处理。
// 原始文案可能带着上游的域名、IP、请求追踪号或英文堆栈，一律不直接展示：
// 先脱敏，脱敏后仍像技术报错（没有中文说明）就整句不显示。

const KINDS = [
  {
    kind: "storage",
    pattern: /NoSuchKey|NoSuchBucket|specified key does not exist|operation error S3|图片文件已失效|文件存储暂时不可用/i,
    icon: "bi-image",
    title: "图片文件读取失败",
    hint: "原图可能已过期或被清理，重新上传后再试一次。",
    actions: ["retry", "edit"],
  },
  {
    kind: "balance",
    pattern: /积分不足|余额不足|可用积分|insufficient|balance|quota exceeded|402/i,
    icon: "bi-wallet2",
    title: "积分不足",
    hint: "充值后可以直接重试，已输入的内容不会丢。",
    actions: ["recharge", "retry"],
  },
  {
    kind: "moderation",
    pattern: /审核|违规|敏感|不合规|安全策略|moderation|content policy|safety|nsfw|blocked/i,
    icon: "bi-shield-exclamation",
    title: "内容没有通过审核",
    hint: "换一种说法或去掉可能敏感的描述后再发。",
    actions: ["edit"],
  },
  {
    kind: "timeout",
    pattern: /超时|超过\s*\d+\s*分钟|timeout|timed out|deadline/i,
    icon: "bi-hourglass-bottom",
    title: "等待太久，没有完成",
    hint: "服务这会儿比较慢，可以重试，或换一个模型。",
    actions: ["retry"],
  },
  {
    kind: "busy",
    pattern: /繁忙|稍后再试|任务较多|限流|capacity|rate.?limit|too many|429|overloaded/i,
    icon: "bi-speedometer2",
    title: "服务繁忙",
    hint: "稍等片刻再试一次。",
    actions: ["retry"],
  },
  {
    kind: "upload",
    pattern: /上传|参考图.*(失败|无法|读取)|reference.*(fail|decode)|cannot be decoded|not a supported image/i,
    icon: "bi-cloud-slash",
    title: "参考图有问题",
    hint: "重新上传参考图，或换一张常见格式（JPG / PNG）的图片。",
    actions: ["edit"],
  },
  {
    kind: "model",
    pattern: /模型.*(不可用|维护|下线|未配置)|unavailable|not available|maintenance/i,
    icon: "bi-cpu",
    title: "当前模型暂不可用",
    hint: "在输入框下方换一个模型后重试。",
    actions: ["retry"],
  },
  {
    kind: "network",
    pattern: /网络|连接|断开|network|fetch|connection|ECONN|socket/i,
    icon: "bi-wifi-off",
    title: "网络中断",
    hint: "检查网络后重试。",
    actions: ["retry"],
  },
];

const FALLBACK = {
  kind: "unknown",
  icon: "bi-exclamation-circle",
  title: "这次没有完成",
  hint: "可以重试一次；反复失败请换个说法或稍后再来。",
  actions: ["retry"],
};

const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const HOST_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ai|cn|dev|app|cloud|co|xyz|top|me|site|tech|info|biz|asia|cc|tv|us|uk|jp|hk|tw|sg|vip|link|pro|online|store|live|run|sh|local|internal|localhost)(?::\d+)?\b/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const TRACE_RE = /\b(?:request ?id|host ?id|x-amz-[a-z-]+|trace ?id|cf-ray)\s*[:=]\s*[^\s,;]*,?/gi;
const CJK_RE = /[\u4e00-\u9fff]/;

// 给用户看的补充说明：去掉地址和追踪号；纯英文的技术报错不展示。
export function publicErrorDetail(text) {
  const cleaned = String(text || "")
    .replace(URL_RE, "")
    .replace(TRACE_RE, "")
    .replace(HOST_RE, "")
    .replace(IP_RE, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:：，；]+|[\s,;:：，；]+$/g, "");
  if (!cleaned || !CJK_RE.test(cleaned)) return "";
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

export function assistantErrorKind(message) {
  const text = String(message?.error || "").trim();
  if (!text && message?.statusStage !== "failed") return null;
  const match = KINDS.find((item) => item.pattern.test(text)) || FALLBACK;
  const { pattern: _pattern, ...kind } = match;
  const detail = publicErrorDetail(text);
  return { ...kind, detail: detail && detail !== kind.title && detail !== kind.hint ? detail : "" };
}
