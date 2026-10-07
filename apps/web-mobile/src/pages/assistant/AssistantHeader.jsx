export const MODE_SHORT = { chat: "问答", agent: "Agent", image: "图片" };

/** 与 App 一致：左侧历史、中间“模式 · 模型 ⌄”、右侧黑色新对话按钮。 */
export function AssistantHeader({ workspace, onOpenHistory, onOpenMode }) {
  const { creationType, generationModelLabel, newConversation, loading } = workspace;
  return (
    <header className="m-as-head">
      <button type="button" className="m-as-round m-pressable" aria-label="历史对话" disabled={loading} onClick={onOpenHistory}>
        <i className="bi bi-clock-history" />
      </button>
      <button type="button" className="m-as-title m-pressable" aria-label="切换模式与模型" disabled={loading} onClick={onOpenMode}>
        <span>{MODE_SHORT[creationType] || "问答"}</span>
        {generationModelLabel && <><i className="m-as-title-dot">·</i><span className="m-as-title-model">{generationModelLabel}</span></>}
        <i className="bi bi-chevron-down" />
      </button>
      <button type="button" className="m-as-round is-ink m-pressable" aria-label="新对话" disabled={loading} onClick={() => newConversation()}>
        <i className="bi bi-plus-lg" />
      </button>
    </header>
  );
}
