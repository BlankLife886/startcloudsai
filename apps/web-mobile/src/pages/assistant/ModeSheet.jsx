import { BottomSheet } from "@mobile/components/overlay/index.js";
import { ModelCatalogIcon, isCatalogModelMaintenance } from "@react/components/common/ModelCatalogIcon.jsx";
import { ModelMenuPrice } from "@react/features/assistant/AssistantWorkspaceUi.jsx";
import { CREATION_TYPES } from "@react/features/assistant/assistantWorkspaceCore.jsx";

const MODE_HINTS = {
  chat: "只进行对话，不会调用图片生成",
  agent: "可以回答问题，也可以规划方案并出图",
  image: "描述画面，直接生成图片",
};

const MODE_ICONS = { chat: "bi-chat-left-dots", agent: "bi-magic", image: "bi-image" };

/** 顶栏标题点开：模式 / 模型 / 推理强度，与 App 的 _AssistantHeaderMenuPanel 同样三段。 */
export function ModeSheet({ visible, onClose, workspace }) {
  const {
    creationType,
    setCreationType,
    documents,
    mode,
    generationModels,
    generationModel,
    setImageModel,
    setConversationModel,
    modelWithReasoningPrice,
    reasoningEffortOptions,
    activeReasoningEffort,
    setReasoningEffort,
  } = workspace;
  return (
    <BottomSheet visible={visible} onClose={onClose} title="模式与模型" className="m-as-sheet">
      <h3 className="m-as-sheet-label">模式</h3>
      <div className="m-as-group">
        {CREATION_TYPES.map((type) => {
          const blocked = type.id === "image" && documents.length > 0;
          return (
            <button
              key={type.id}
              type="button"
              className={`m-as-option${creationType === type.id ? " is-on" : ""}`}
              disabled={blocked}
              onClick={() => setCreationType(type.id)}
            >
              <span className="m-as-option-icon"><i className={`bi ${MODE_ICONS[type.id]}`} /></span>
              <span className="m-as-option-text">
                <strong>{type.label}</strong>
                <small>{blocked ? "先移除文档附件" : MODE_HINTS[type.id]}</small>
              </span>
              {creationType === type.id && <i className="bi bi-check-lg m-as-check" />}
            </button>
          );
        })}
      </div>

      <h3 className="m-as-sheet-label">{mode === "image" ? "图片模型" : "对话模型"}</h3>
      <div className="m-as-group">
        {generationModels.map((model) => {
          const maintenance = isCatalogModelMaintenance(model);
          return (
            <button
              key={model.model}
              type="button"
              className={`m-as-option${generationModel === model.model ? " is-on" : ""}`}
              disabled={maintenance}
              onClick={() => {
                if (mode === "image") setImageModel(model.model);
                else setConversationModel(model.model);
              }}
            >
              <span className="m-as-option-icon is-model"><ModelCatalogIcon model={model} size="sm" /></span>
              <span className="m-as-option-text">
                <strong>{model.label}</strong>
                <small>{maintenance ? "维护中，暂不可选择" : <ModelMenuPrice model={mode === "image" ? model : modelWithReasoningPrice(model)} perImage={mode === "image"} />}</small>
              </span>
              {generationModel === model.model && <i className="bi bi-check-lg m-as-check" />}
            </button>
          );
        })}
        {!generationModels.length && <p className="m-as-empty-line">后台暂未提供可用模型</p>}
      </div>

      {mode !== "image" && reasoningEffortOptions.length > 0 && (
        <>
          <h3 className="m-as-sheet-label">推理强度</h3>
          <div className="m-as-chips">
            {reasoningEffortOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`m-as-chip${activeReasoningEffort === option.id ? " is-on" : ""}`}
                onClick={() => setReasoningEffort(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
