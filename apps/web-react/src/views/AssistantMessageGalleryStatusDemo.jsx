import { useEffect, useRef, useState } from "react";
import { AssistantMessageRow } from "../features/assistant/AssistantMessageComponents.jsx";

// Dev gallery: replays one reply going from understanding → thinking → tools →
// answering → done, so the status line transitions can be judged in motion.

const REASONING = [
  "用户想知道本月的花费情况。",
  "先用统计工具查本月积分消耗，再按功能拆分。",
  "如果 AI 电商占比最高，需要顺带对比上个月，看看是不是异常增长。",
  "最后给出一两条节省积分的建议，语气简洁。",
];

const ANSWER = [
  "本月共消耗 **240 积分**，比上个月多 20%。",
  "\n\n- AI 电商：180 积分（75%）\n- AI 助手：60 积分（25%）",
  "\n\n主要增长来自电商套图，建议批量出图前先用 1 张确认风格。",
];

function frames(startedAt) {
  const base = { id: "demo-reply", role: "assistant", kind: "agent", content: "", pending: true, status: "running", startedAt, createdAt: new Date(startedAt).toISOString() };
  const tools = (search) => [
    { requestId: "t1", name: "my_stats_query", status: "completed", durationMs: 140 },
    ...(search ? [{ requestId: "t2", name: "web_search", status: search }] : []),
  ];
  return [
    [0, { ...base, statusStage: "routing" }],
    [1100, { ...base, statusStage: "thinking", reasoning: REASONING[0] }],
    [2000, { ...base, statusStage: "thinking", reasoning: REASONING.slice(0, 2).join("\n\n") }],
    [2900, { ...base, statusStage: "thinking", reasoning: REASONING.slice(0, 3).join("\n\n") }],
    [3800, { ...base, statusStage: "thinking", reasoning: REASONING.join("\n\n") }],
    [4700, { ...base, statusStage: "tool_action", reasoning: REASONING.join("\n\n"), toolSteps: [{ requestId: "t1", name: "my_stats_query", status: "running" }] }],
    [5800, { ...base, statusStage: "web_search", reasoning: REASONING.join("\n\n"), toolSteps: tools("running") }],
    [7000, { ...base, statusStage: "answering", reasoning: REASONING.join("\n\n"), toolSteps: tools("completed"), content: ANSWER[0] }],
    [7800, { ...base, statusStage: "answering", reasoning: REASONING.join("\n\n"), toolSteps: tools("completed"), content: ANSWER.slice(0, 2).join("") }],
    [8600, { ...base, statusStage: "answering", reasoning: REASONING.join("\n\n"), toolSteps: tools("completed"), content: ANSWER.join("") }],
    [9300, {
      ...base, pending: false, status: "complete", statusStage: "complete", reasoning: REASONING.join("\n\n"), toolSteps: tools("completed"), content: ANSWER.join(""),
      updatedAt: new Date(startedAt + 9300).toISOString(),
      usage: { inputTokens: 18_400, outputTokens: 212, firstTokenMs: 6_900, durationMs: 9_300 },
      context: { inputBudgetTokens: 128_000, estimatedInputTokens: 18_400, includedMessages: 12, totalMessages: 30 },
    }],
  ];
}

export function StatusTransitionDemo() {
  const [message, setMessage] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const timers = useRef([]);
  const noop = () => {};

  const play = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    setExpanded(false);
    const startedAt = Date.now();
    timers.current = frames(startedAt).map(([delay, next]) => window.setTimeout(() => setMessage(next), delay));
  };

  useEffect(() => {
    play();
    return () => timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div className="assistant-gallery-demo">
      <button type="button" className="assistant-gallery-demo-play" onClick={play}><i className="bi bi-arrow-repeat" />重播状态切换</button>
      {message ? (
        <AssistantMessageRow
          message={message}
          turnId="demo"
          expanded={expanded}
          copied={false}
          generating={message.pending}
          feedbackBusy={false}
          isLastAssistant
          isLastUser={false}
          editing={false}
          editingDraft=""
          moreOpen={false}
          loadedImages={new Set()}
          failedImages={new Set()}
          imageRetryVersions={{}}
          imageModels={[]}
          sourceProposal={null}
          proposalExecuted={false}
          attachedReferences={[]}
          onToolAction={noop}
          onToggleStatus={() => setExpanded((value) => !value)}
          onCopy={noop}
          onFeedback={noop}
          onQuote={noop}
          onOpenImage={noop}
          onImageLoad={noop}
          onImageError={noop}
          onImageRetry={noop}
          onUseReference={noop}
          onStartEdit={noop}
          onEditDraft={noop}
          onCancelEdit={noop}
          onSubmitEdit={noop}
          onRetry={noop}
          onToggleMore={noop}
          onDownloadMarkdown={noop}
          onDelete={noop}
          onProposalChange={noop}
          onProposalDismiss={noop}
          onProposalRestore={noop}
          onProposalApprove={noop}
          onReopenProposal={noop}
          onCorrection={noop}
        />
      ) : null}
    </div>
  );
}
