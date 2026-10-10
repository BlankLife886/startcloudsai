import { EMPTY_STATE, emptyStateSuggestions, usePersonalSuggestions } from "@react/features/assistant/components/AssistantEmptyState.jsx";

// 与 App 的 _AssistantWelcome 一致的标题与说明。
const COPY = {
  chat: { title: "有什么可以帮你？", hint: "描述你的想法，开始对话" },
  agent: { title: "交给 Agent 来完成", hint: "说清目标，Agent 会帮你规划并生成" },
  image: { title: "想生成什么图片？", hint: "用一句话描述画面，马上开始生成" },
};

/** 空白对话：品牌标识 + 标题，下面是与桌面端相同的建议卡（含按记忆/套图给出的个性建议）。 */
export function AssistantWelcome({ creation, editableFilesEnabled, onPick, onOpenConversation, onUseAgent }) {
  const copy = COPY[creation.id] || COPY.chat;
  const personal = usePersonalSuggestions(creation.id);
  const items = emptyStateSuggestions(EMPTY_STATE[creation.id] ? creation.id : "chat", editableFilesEnabled, personal);
  const pick = (item) => {
    if (item.conversationId && onOpenConversation) return onOpenConversation(item.conversationId);
    if (item.personal && creation.id !== "agent") onUseAgent?.();
    return onPick(item.prompt || item.text);
  };
  return (
    <section className="m-as-welcome" key={creation.id}>
      <img className="m-as-welcome-mark" src={`${import.meta.env.BASE_URL}brand/brand_mark.svg`} alt="" />
      <h1>{copy.title}</h1>
      <p>{copy.hint}</p>
      <div className="m-as-suggestions">
        {items.map((item) => (
          <button key={item.id || item.text} type="button" className={`m-as-suggestion m-pressable${item.personal ? " is-personal" : ""}`} onClick={() => pick(item)}>
            <span>
              <strong>{item.text}</strong>
              {item.personal && item.reason && <small><i className={`bi ${item.icon || "bi-stars"}`} />{item.reason}</small>}
            </span>
            <i className={`bi ${item.conversationId ? "bi-box-arrow-up-right" : "bi-arrow-right"}`} />
          </button>
        ))}
      </div>
    </section>
  );
}
