// 一键纠正：用户觉得这一轮不对时点一下，当场按对的方式重来；服务端同时把这一轮记成
// 一条“本该怎么做”的标签。文字和模式与服务端 assistantreview.CorrectionFor 一致；
// mode 为空时沿用被纠正那一轮的模式。
export const ASSISTANT_CORRECTIONS = {
  just_asking: { label: "我只是问问", icon: "bi-chat-dots", prompt: "我只是问问，不用出图。", mode: "chat" },
  draw_it: { label: "帮我画出来", icon: "bi-image", prompt: "帮我画出来。", mode: "agent" },
  search_web: { label: "联网查一下", icon: "bi-globe2", prompt: "联网查一下最新信息。", mode: "" },
};

// 最新那条回复下面给哪些纠正：出图方案给“我只是问问”，文字回答给“帮我画出来”
// 和（没联网时）“联网查一下”。正在生成、已执行或已收起的方案、图片消息都不给。
export function assistantCorrectionActions(message, { isLastAssistant, generating, proposalExecuted, autoApproved }) {
  if (!isLastAssistant || generating || message?.role !== "assistant" || message.pending || message.status !== "complete") return [];
  if (message.kind === "proposal") {
    return proposalExecuted || autoApproved || message.proposal?.dismissed ? [] : ["just_asking"];
  }
  if (message.kind !== "chat" && message.kind !== "agent") return [];
  const actions = ["draw_it"];
  if (!(Array.isArray(message.webSearches) && message.webSearches.length)) actions.push("search_web");
  return actions;
}
