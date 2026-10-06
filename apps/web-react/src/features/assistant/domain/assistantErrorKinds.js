// 失败的回复按原因分类，给出用户能直接做的下一步。
// 服务端只给了一句错误文案（message.error），这里按文案里的关键词判断类型；
// 判断不出来的统一按“没完成，可以重试”处理，原始文案照样显示。

const KINDS = [
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

export function assistantErrorKind(message) {
  const text = String(message?.error || "").trim();
  if (!text && message?.statusStage !== "failed") return null;
  const match = KINDS.find((item) => item.pattern.test(text)) || FALLBACK;
  const { pattern: _pattern, ...kind } = match;
  return { ...kind, detail: text || "本次任务没有完成，请稍后重试。" };
}
