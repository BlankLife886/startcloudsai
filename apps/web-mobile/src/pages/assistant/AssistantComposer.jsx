import { useState } from "react";
import { documentIcon, documentStatusLabel, formatDocumentSize } from "@react/features/assistant/assistantWorkspaceCore.jsx";

function uploadProgress(image) {
  if (["compressing", "uploading", "processing"].includes(image.uploadStatus)) {
    const progress = image.uploadStatus === "processing" ? 100 : Number(image.uploadProgress) || 0;
    return Math.max(0, Math.min(100, progress));
  }
  return null;
}

const PLACEHOLDERS = { chat: "问点什么…", agent: "描述任务目标", image: "描述想生成的图片" };

/**
 * 与 App 的 _AssistantComposer 一致：收起时是一行胶囊（+ / 输入 / 语音 / 发送），聚焦后展开成多行；
 * 上方依次是引用、附件、下一步建议。生成中可以继续输入，发送后自动排队。
 */
export function AssistantComposer({ workspace, onOpenTools }) {
  const {
    auth,
    draft,
    setDraft,
    textareaRef,
    composerRef,
    composerZoneRef,
    fileInputRef,
    mode,
    creationType,
    serviceError,
    maxMessageCharacters,
    draftCharacterCount,
    references,
    removeReference,
    documents,
    removeComposerDocument,
    uploading,
    uploadReferences,
    openImage,
    quotedMessage,
    setQuotedMessage,
    queueEditingId,
    cancelQueueEdit,
    activeRun,
    setStopConfirmOpen,
    canSend,
    requestSend,
    voiceSupported,
    voiceListening,
    voiceBusy,
    toggleVoiceInput,
    messages,
    runningGuidance,
    applyRunningGuidance,
  } = workspace;
  const [focused, setFocused] = useState(false);
  const expanded = focused || draft.includes("\n") || draft.length > 40;

  // 回复完成后模型给出的下一步：输入框为空时显示成建议，点一下采纳。
  const last = messages[messages.length - 1];
  const nextSuggestion = !draft && !activeRun && !queueEditingId && last?.role === "assistant" && !last.pending
    && last.status === "complete" && typeof last.nextPrompt === "string" ? last.nextPrompt.trim() : "";

  const placeholder = serviceError
    ? "助手暂时不可用"
    : queueEditingId
      ? "修改这条排队消息，发送后更新"
      : activeRun
        ? "继续输入，发送后会自动排队"
        : PLACEHOLDERS[creationType] || PLACEHOLDERS.chat;
  const showStop = Boolean(activeRun) && !draft.trim();
  const hasAttachments = references.length > 0 || documents.length > 0 || uploading;

  return (
    <div ref={composerZoneRef} className="m-as-composer">
      {runningGuidance.length > 0 && (
        <nav className="m-as-guidance" aria-label="接下来">
          {runningGuidance.map((item) => (
            <button key={item.id} type="button" className="m-pressable" onClick={() => applyRunningGuidance(item)}>
              <i className={`bi ${item.icon}`} />{item.label}
            </button>
          ))}
        </nav>
      )}

      {nextSuggestion && (
        <button type="button" className="m-as-next m-pressable" onClick={() => { setDraft(nextSuggestion); textareaRef.current?.focus(); }}>
          <i className="bi bi-lightbulb" />
          <span>{nextSuggestion}</span>
          <small>采纳</small>
        </button>
      )}

      {quotedMessage && (
        <div className="m-as-quote">
          <i className="bi bi-quote" />
          <span>{quotedMessage.content}</span>
          <button type="button" aria-label="移除引用" onClick={() => setQuotedMessage(null)}><i className="bi bi-x-lg" /></button>
        </div>
      )}

      {hasAttachments && (
        <div className="m-as-attachments" aria-label="已添加的附件">
          {references.map((image, index) => {
            const progress = uploadProgress(image);
            return (
              <figure key={image.id} className={`m-as-ref${progress !== null ? " is-uploading" : ""}`}>
                <button type="button" className="m-as-ref-img" aria-label="查看参考图" onClick={() => openImage(image, index, references)}>
                  <img src={image.thumbnailUrl || image.dataUrl || image.url} alt={image.name || "参考图"} />
                </button>
                {progress !== null && <span className="m-as-ref-progress" style={{ "--p": `${progress}%` }} />}
                <button type="button" className="m-as-ref-remove" aria-label="移除参考图" onClick={() => removeReference(image.id)}><i className="bi bi-x" /></button>
              </figure>
            );
          })}
          {documents.map((item) => (
            <div key={item.id} className={`m-as-doc is-${item.status || "queued"}`}>
              <i className={`bi ${documentIcon(item)}`} />
              <span><strong>{item.name}</strong><small>{documentStatusLabel(item)} · {formatDocumentSize(item.sizeBytes)}</small></span>
              <button type="button" aria-label="移除文档" onClick={() => removeComposerDocument(item)}><i className="bi bi-x" /></button>
            </div>
          ))}
          {uploading && !references.some((item) => uploadProgress(item) !== null) && <span className="m-as-ref is-skeleton" />}
        </div>
      )}

      <div
        ref={composerRef}
        className={`m-as-input${expanded ? " is-expanded" : ""}${voiceListening ? " is-listening" : ""}`}
        onClick={() => textareaRef.current?.focus()}
      >
        <textarea
          ref={textareaRef}
          name="assistant-message"
          value={draft}
          rows={expanded ? 3 : 1}
          placeholder={placeholder}
          disabled={Boolean(serviceError)}
          maxLength={maxMessageCharacters}
          enterKeyHint="enter"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setDraft(event.target.value);
            if (queueEditingId && !event.target.value) cancelQueueEdit();
          }}
        />
        <div className="m-as-input-bar">
          <button type="button" className="m-as-icon-btn" aria-label="更多工具" onClick={(event) => { event.stopPropagation(); onOpenTools(); }}>
            <i className="bi bi-plus-lg" />
          </button>
          {!expanded && <span className="m-as-input-spacer" />}
          {draftCharacterCount > Math.min(10000, Math.floor(maxMessageCharacters * 0.8)) && (
            <small className={`m-as-counter${draftCharacterCount > maxMessageCharacters ? " is-over" : ""}`}>{draftCharacterCount}/{maxMessageCharacters}</small>
          )}
          {voiceSupported && !showStop && (
            <button
              type="button"
              className={`m-as-icon-btn${voiceListening ? " is-on" : ""}`}
              aria-label={voiceListening ? "停止语音输入" : "语音输入"}
              disabled={voiceBusy}
              onClick={(event) => { event.stopPropagation(); toggleVoiceInput(); }}
            >
              <i className={`bi ${voiceListening ? "bi-soundwave" : "bi-mic"}`} />
            </button>
          )}
          {showStop ? (
            <button type="button" className="m-as-send is-stop" aria-label="停止生成" onClick={(event) => { event.stopPropagation(); setStopConfirmOpen(true); }}>
              <span className="m-as-stop-glyph" />
            </button>
          ) : (
            <button
              type="button"
              className="m-as-send"
              aria-label={activeRun ? "加入队列" : "发送"}
              disabled={auth.isAuthenticated && !canSend}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                navigator.vibrate?.(10);
                void requestSend();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="m-as-file"
        name="assistant-attachments"
        type="file"
        accept={mode === "image" ? "image/*" : "image/*,.txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.pptx"}
        multiple
        hidden
        onChange={(event) => {
          void uploadReferences(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
