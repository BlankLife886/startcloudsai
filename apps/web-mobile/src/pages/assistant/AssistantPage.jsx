import { useEffect, useMemo, useState } from "react";
import { DotLoading } from "antd-mobile";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { AuthPromptContext } from "@react/auth/AuthPromptContext.jsx";
import { useAssistantWorkspaceController } from "@react/features/assistant/useAssistantWorkspaceController.js";
import { AssistantFollowUpQueue, AssistantMessageRow } from "@react/features/assistant/AssistantMessageComponents.jsx";
import { AssistantImageOpenContext, CommerceSetOwnersContext, commerceSetOwners } from "@react/features/assistant/AssistantCommerceSet.jsx";
import { AssistantReplyActionsContext } from "@react/features/assistant/AssistantDataViews.jsx";
import { AssistantMemoryPanel, OPEN_MEMORY_EVENT } from "@react/features/assistant/AssistantMemoryViews.jsx";
import { imageEditSources } from "@react/features/assistant/domain/assistantImageCompare.js";
import { resolveProposalReferences } from "@react/features/assistant/assistantWorkspaceCore.jsx";
import { goLogin } from "@mobile/app/login.js";
import { useVisualViewport } from "@mobile/hooks/useVisualViewport.js";
import { AssistantComposer } from "./AssistantComposer.jsx";
import { AssistantHeader } from "./AssistantHeader.jsx";
import { AssistantWelcome } from "./AssistantWelcome.jsx";
import { AssistantDialogs } from "./AssistantDialogs.jsx";
import { HistorySheet } from "./HistorySheet.jsx";
import { ModeSheet } from "./ModeSheet.jsx";
import { ToolsSheet } from "./ToolsSheet.jsx";
import "./assistant-styles.js";
import "./assistant.css";

function useDarkScheme() {
  const read = () => document.documentElement.getAttribute("data-prefers-color-scheme") === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-prefers-color-scheme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function ThreadSkeleton() {
  return (
    <section className="m-as-skeleton" aria-label="正在加载">
      <i className="is-user" style={{ width: "46%" }} />
      <i style={{ width: "82%" }} />
      <i style={{ width: "64%" }} />
      <i className="is-user" style={{ width: "30%" }} />
      <i style={{ width: "74%" }} />
    </section>
  );
}

/**
 * AI 助手：业务全部复用桌面端的 useAssistantWorkspaceController 与消息组件（问答 / Agent / 图片三种模式、
 * 方案确认、自动授权、统计卡片、套图、记忆、纠正与追问建议都一致）；界面外壳按 App 的助手页重做。
 */
function AssistantWorkspace({ active }) {
  const workspace = useAssistantWorkspaceController();
  const dark = useDarkScheme();
  const viewport = useVisualViewport(active);
  const [sheet, setSheet] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryTab, setMemoryTab] = useState("memory");
  const {
    loading,
    messages,
    renderedMessages,
    firstRenderedMessageIndex,
    hiddenMessageCount,
    loadEarlierMessages,
    loadingEarlierRef,
    activeConversation,
    messageScrollerRef,
    handleMessageScroll,
    isAtBottom,
    scrollToBottom,
    selectedCreation,
    editableFilesEnabled,
    setDraft,
    textareaRef,
    selectConversation,
    setCreationType,
    hiddenQueuedMessageIds,
    sourceProposalForImage,
    conversationHasWork,
    lastAssistantId,
    lastUserMessageId,
    openImage,
    sendFollowUp,
  } = workspace;

  useEffect(() => {
    const open = (event) => {
      setMemoryTab(event?.detail?.tab === "reminders" ? "reminders" : "memory");
      setMemoryOpen(true);
    };
    window.addEventListener(OPEN_MEMORY_EVENT, open);
    return () => window.removeEventListener(OPEN_MEMORY_EVENT, open);
  }, []);

  const commerceOwners = useMemo(() => commerceSetOwners(messages), [messages]);
  // 卡片替用户发一句话（选择卡的选项）：沿用那条回复的模式发出去。
  const replyActions = {
    lastAssistantId,
    busy: conversationHasWork,
    send: (messageId, text) => {
      const target = messages.find((item) => item.id === messageId);
      if (target) void sendFollowUp(target, text);
    },
  };

  let body;
  if (loading || (activeConversation?.messagesDeferred && !messages.length)) {
    body = <ThreadSkeleton />;
  } else if (!messages.length) {
    body = (
      <AssistantWelcome
        creation={selectedCreation}
        editableFilesEnabled={editableFilesEnabled}
        onPick={(text) => { setDraft(text); textareaRef.current?.focus(); }}
        onOpenConversation={selectConversation}
        onUseAgent={() => setCreationType("agent")}
      />
    );
  } else {
    body = (
      <section className="message-thread" aria-live="polite">
        {(hiddenMessageCount > 0 || activeConversation?.hasMoreMessages) && (
          <button
            className="m-as-earlier"
            type="button"
            disabled={loadingEarlierRef.current}
            onClick={() => {
              if (hiddenMessageCount > 0) {
                const scroller = messageScrollerRef.current;
                if (scroller) {
                  scroller.scrollTop = 0;
                  handleMessageScroll();
                }
              } else {
                void loadEarlierMessages();
              }
            }}
          >
            {hiddenMessageCount > 0 ? `加载更早的对话（${hiddenMessageCount}）` : "加载更早的对话"}
          </button>
        )}
        <div className="message-turns">
          {renderedMessages.map((message, offset) => (
            <MessageRow
              key={message.id}
              workspace={workspace}
              message={message}
              originalIndex={firstRenderedMessageIndex + offset}
              hidden={hiddenQueuedMessageIds.has(message.id)}
              sourceProposal={sourceProposalForImage(message)}
              isLastAssistant={message.id === lastAssistantId}
              isLastUser={message.id === lastUserMessageId}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <AssistantImageOpenContext.Provider value={openImage}>
      <CommerceSetOwnersContext.Provider value={commerceOwners}>
        <AssistantReplyActionsContext.Provider value={replyActions}>
          <div
            className={`assistant-workspace m-assistant${dark ? " is-dark" : ""}${workspace.activeRun ? " is-generating" : ""}`}
            style={{ "--m-vv-top": `${viewport.top}px`, "--m-vv-h": `${viewport.height}px` }}
            onClick={() => workspace.setActiveMessageMenuId("")}
          >
            <AssistantHeader workspace={workspace} onOpenHistory={() => setSheet("history")} onOpenMode={() => setSheet("mode")} />

            <div ref={messageScrollerRef} className="assistant-messages m-as-scroll" onScroll={handleMessageScroll}>
              {body}
            </div>

            {!isAtBottom && messages.length > 0 && (
              <button type="button" className="m-as-jump m-pressable" aria-label="回到最新" onClick={() => scrollToBottom("smooth")}>
                <i className="bi bi-arrow-down" />
              </button>
            )}

            <div className="m-as-bottom">
              <AssistantFollowUpQueue
                items={workspace.followUpRuns}
                editingId={workspace.queueEditingId}
                busyId={workspace.queueBusyId}
                onEdit={workspace.beginQueueEdit}
                onRemove={workspace.cancelQueueItem}
              />
              <AssistantComposer workspace={workspace} active={active} onOpenTools={() => setSheet("tools")} />
            </div>
          </div>

          <HistorySheet visible={sheet === "history"} onClose={() => setSheet("")} workspace={workspace} />
          <ModeSheet visible={sheet === "mode"} onClose={() => setSheet("")} workspace={workspace} />
          <ToolsSheet
            visible={sheet === "tools"}
            onClose={() => setSheet("")}
            workspace={workspace}
            onOpenMemory={() => { setMemoryTab("memory"); setMemoryOpen(true); }}
          />
          <AssistantDialogs workspace={workspace} />
          <AssistantMemoryPanel open={memoryOpen} dark={dark} initialTab={memoryTab} onClose={() => setMemoryOpen(false)} />
        </AssistantReplyActionsContext.Provider>
      </CommerceSetOwnersContext.Provider>
    </AssistantImageOpenContext.Provider>
  );
}

/** 一条消息：参数与桌面端 AssistantWorkspaceLayout 渲染 AssistantMessageRow 时完全一致。 */
function MessageRow({ workspace: w, message, originalIndex, hidden, sourceProposal, isLastAssistant, isLastUser }) {
  if (hidden) return null;
  const { messages } = w;
  const previous = messages[originalIndex - 1];
  const currentDate = new Date(message.createdAt);
  const previousDate = new Date(previous?.createdAt);
  const showDate = originalIndex === 0 || Number.isNaN(previousDate.getTime()) || currentDate.toDateString() !== previousDate.toDateString();
  const previousUser = message.role === "user" ? message : [...messages.slice(0, originalIndex)].reverse().find((item) => item.role === "user");
  const attachedReferences = message.proposal
    ? resolveProposalReferences(w.activeConversation, message).references
    : previousUser?.referenceImages;
  return (
    <AssistantMessageRow
      message={message}
      editSources={message.images?.length ? imageEditSources(message, messages) : undefined}
      turnId={previousUser?.id}
      showDate={showDate}
      expanded={w.expandedStatusId === message.id}
      copied={w.copiedMessageId === message.id}
      generating={w.conversationHasWork}
      feedbackBusy={w.feedbackBusyIds.has(message.id)}
      isLastAssistant={isLastAssistant}
      isLastUser={isLastUser}
      editing={w.editingMessageId === message.id}
      editingDraft={w.editingMessageDraft}
      moreOpen={w.activeMessageMenuId === message.id}
      loadedImages={w.loadedImages}
      failedImages={w.failedImages}
      imageRetryVersions={w.imageRetryVersions}
      imageModels={w.imageModels}
      sourceProposal={sourceProposal}
      proposalExecuted={messages.some((item) => item.role === "user" && item.proposalSourceMessageId === message.id)}
      attachedReferences={attachedReferences}
      autoApprove={w.assistantAutoApprove}
      autoApproveBudgetCents={w.assistantAutoApproveBudgetCents}
      autoApproved={message.kind === "proposal" ? w.proposalAutoApproved(message) : false}
      searchHit={false}
      searchCurrent={false}
      searchQuery=""
      toolActionBusyId={w.toolActionBusyId}
      maxMessageCharacters={w.maxMessageCharacters}
      onToolAction={w.executeAssistantToolAction}
      onToggleStatus={w.toggleStatus}
      onCopy={w.copyMessage}
      onFeedback={w.submitMessageFeedback}
      onQuote={w.quoteMessage}
      onOpenImage={w.openImage}
      onImageLoad={w.markImageLoaded}
      onImageError={w.markImageFailed}
      onImageRetry={w.retryImage}
      onUseReference={w.useGeneratedImageAsReference}
      onStartEdit={w.startEditingUserMessage}
      onEditDraft={w.setEditingMessageDraft}
      onCancelEdit={w.cancelUserMessageEdit}
      onSubmitEdit={(item) => void w.submitUserMessageEdit(item)}
      onRetry={(item) => void w.retryAssistant(item)}
      onToggleMore={(id) => w.setActiveMessageMenuId((current) => (current === id ? "" : id))}
      onDownloadMarkdown={w.downloadMarkdown}
      onDelete={(id) => void w.removeMessage(id)}
      onProposalChange={(patch) => w.updateProposal(message.id, patch)}
      onProposalDismiss={() => w.updateProposal(message.id, { dismissed: true })}
      onProposalRestore={() => w.updateProposal(message.id, { dismissed: false })}
      onProposalApprove={(options) => w.approveAgentProposal(message, options)}
      onReopenProposal={() => w.reopenSourceProposal(sourceProposal)}
      onCorrection={(action) => void w.sendCorrection(message, action)}
      onFollowUp={(text) => void w.sendFollowUp(message, text)}
      onGenerateMissing={() => void w.generateMissingImages(message)}
      onEditPrompt={previousUser && previousUser.id === w.lastUserMessageId ? () => w.startEditingUserMessage(previousUser) : undefined}
      askFeedbackReasons={w.feedbackAskIds.has(message.id)}
      onFeedbackReasons={(reasons, note) => w.submitFeedbackReasons(message, reasons, note)}
      onDismissFeedbackReasons={() => w.dismissFeedbackReasons(message.id)}
    />
  );
}

/** 未登录时控制器里的“需要登录”统一跳到主站登录页（桌面端是弹窗）。 */
function MobileAuthPrompt({ children }) {
  const { isAuthenticated } = useAuth();
  const value = useMemo(() => ({
    requestAuth: () => {
      if (isAuthenticated) return false;
      goLogin();
      return true;
    },
    closeAuthPrompt: () => undefined,
  }), [isAuthenticated]);
  return <AuthPromptContext.Provider value={value}>{children}</AuthPromptContext.Provider>;
}

export default function AssistantPage({ active }) {
  const { loading } = useAuth();
  if (loading) return <div className="m-page-fallback"><DotLoading color="primary" /></div>;
  return (
    <MobileAuthPrompt>
      <AssistantWorkspace active={active} />
    </MobileAuthPrompt>
  );
}
