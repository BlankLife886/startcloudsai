import { createPortal } from "react-dom";
import { formatTime, messagePreview } from "./domain/assistantMessages.js";
import { balancedOptionColumns } from "./adaptiveOptionGrid.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { SoftMark } from "../../components/common/SoftMark.jsx";
import { SharePublishDialog } from "../../components/SharePublishDialog.jsx";
import { AssistantEmptyState } from "./components/AssistantEmptyState.jsx";
import { AssistantOnboardingTour } from "./components/AssistantOnboardingTour.jsx";
import {
  CREATION_TYPES,
  MAX_ASSISTANT_MESSAGE_CHARACTERS,
  conversationMark,
  conversationThumbnail,
  documentIcon,
  documentStatusLabel,
  formatDocumentSize,
  reasoningEffortOptionPriceModel,
  resolveProposalReferences,
} from "./assistantWorkspaceCore.jsx";
import {
  AssistantAssetLibrary,
  AssistantContextMeter,
  AssistantCostDialog,
  AssistantDeleteDialog,
  AssistantFullscreenPreview,
  AssistantPreviewImage,
  AssistantRenameDialog,
  AssistantSearchDialog,
  AssistantStopDialog,
  ModelMenuPrice,
  NewChatIcon,
  PreferenceSegment,
  assistantContextMeterTitle,
} from "./AssistantWorkspaceUi.jsx";
import {
  AssistantFollowUpQueue,
  AssistantMessageRow,
  ConversationMinimap,
} from "./AssistantMessageComponents.jsx";

export function AssistantWorkspaceLayout({ workspace }) {
  const {
    auth,
    isDark,
    fileInputRef,
    textareaRef,
    composerRef,
    composerZoneRef,
    imageSettingsButtonRef,
    composerInputHeightRef,
    messageScrollerRef,
    loadingEarlierRef,
    navigatorActiveSetterRef,
    loading,
    serviceError,
    activeId,
    draft,
    setDraft,
    creationType,
    setCreationType,
    sidebarCollapsed,
    sidebarAnimating,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchCursor,
    setSearchCursor,
    pinnedIds,
    renamingId,
    renameDraft,
    setRenameDraft,
    renameSaving,
    historyOpen,
    setHistoryOpen,
    setHistoryShowAll,
    conversationMenuId,
    setConversationMenuId,
    searchInputRef,
    renameInputRef,
    modelSearch,
    setModelSearch,
    creationMenuOpen,
    setCreationMenuOpen,
    modelMenuOpen,
    setModelMenuOpen,
    reasoningMenuOpen,
    setReasoningMenuOpen,
    preferencesOpen,
    setPreferencesOpen,
    preferencesPosition,
    tourOpen,
    setTourOpen,
    assetLibraryOpen,
    setAssetLibraryOpen,
    assetLibraryMounted,
    assetLibraryEntered,
    assetTab,
    setAssetTab,
    assetKind,
    setAssetKind,
    assetSearch,
    setAssetSearch,
    libraryAssetsLoading,
    imageModels,
    editableFilesEnabled,
    setConversationModel,
    setReasoningEffort,
    setImageModel,
    generationRatio,
    setGenerationRatio,
    generationResolution,
    setGenerationResolution,
    generationQuality,
    setGenerationQuality,
    generationCount,
    setGenerationCount,
    references,
    setReferences,
    documents,
    uploading,
    voiceSupported,
    voiceListening,
    activeRuns,
    queueEditingId,
    queueBusyId,
    costPayload,
    stopConfirmOpen,
    setStopConfirmOpen,
    stopBusy,
    deleteTarget,
    setDeleteTarget,
    selectedImage,
    imageActionBusy,
    toolActionBusyId,
    feedbackBusyIds,
    toolActionTarget,
    setToolActionTarget,
    imageDeleteTarget,
    setImageDeleteTarget,
    imageDeleteBusy,
    shareTarget,
    setShareTarget,
    shareSubmitting,
    quotedMessage,
    setQuotedMessage,
    conversationPeek,
    setConversationPeek,
    loadedImages,
    failedImages,
    imageRetryVersions,
    expandedStatusId,
    copiedMessageId,
    editingMessageId,
    editingMessageDraft,
    setEditingMessageDraft,
    activeMessageMenuId,
    setActiveMessageMenuId,
    isAtBottom,
    isReturningToBottom,
    composerManuallyResized,
    composerResizing,
    threadSearch,
    setThreadSearch,
    threadHitIndex,
    setThreadHitIndex,
    activeConversation,
    messages,
    executeAssistantToolAction,
    confirmAssistantToolAction,
    activeRun,
    conversationHasWork,
    followUpRuns,
    hiddenQueuedMessageIds,
    runningGuidance,
    activeCancelPolicy,
    composerScrolledAway,
    firstRenderedMessageIndex,
    renderedMessages,
    hiddenMessageCount,
    threadSearchHits,
    threadSearchHitIds,
    currentThreadHitId,
    mode,
    selectedCreation,
    generationModels,
    generationModel,
    generationModelLabel,
    reasoningEffortOptions,
    reasoningEfforts,
    activeReasoningEffort,
    reasoningEffortLabel,
    modelWithReasoningPrice,
    filteredGenerationModels,
    availableCounts,
    maxReferences,
    atReferenceLimit,
    availableRatios,
    availableResolutions,
    availableQualities,
    historyGroups,
    historyHasMore,
    railConversations,
    searchResults,
    searchGroups,
    assetLibraryImages,
    assetLibraryFiles,
    assetLibraryLinks,
    visibleAssetLibraryImages,
    lastAssistantId,
    lastUserMessageId,
    latestContext,
    navigatorItems,
    submitMessageFeedback,
    toggleStatus,
    copyMessage,
    quoteMessage,
    openImage,
    closeImage,
    stepImage,
    favoriteAssistantImage,
    requestPublishImage,
    requestDeleteImage,
    confirmDeleteImage,
    submitAssistantShare,
    markImageLoaded,
    markImageFailed,
    retryImage,
    scrollToBottom,
    handleMessageScroll,
    scrollToMessage,
    jumpToThreadHit,
    getComposerInputHeightBounds,
    startComposerResize,
    moveComposerResize,
    finishComposerResize,
    resetComposerInputHeight,
    resizeComposerFromKeyboard,
    loadWorkspace,
    updateSidebar,
    closeSearch,
    handleSearchExited,
    selectConversation,
    openConversation,
    startRename,
    cancelRename,
    commitRename,
    togglePinned,
    newConversation,
    swallowComposerMenuClick,
    toggleComposerMenu,
    uploadReferences,
    removeComposerDocument,
    submitRegionEdit,
    requestSend,
    confirmCost,
    cancelCost,
    clearConversationContext,
    useGeneratedImageAsReference,
    addAssetReference,
    addAssetDocument,
    handleAssetGridScroll,
    startEditingUserMessage,
    cancelUserMessageEdit,
    removeMessage,
    downloadMarkdown,
    retryAssistant,
    submitUserMessageEdit,
    updateProposal,
    approveAgentProposal,
    sourceProposalForImage,
    reopenSourceProposal,
    stopRun,
    applyRunningGuidance,
    beginQueueEdit,
    cancelQueueEdit,
    cancelQueueItem,
    deleteConversationRow,
    draftCharacterCount,
    canSend,
    voiceBusy,
    deleteTargetHasWork,
    toggleVoiceInput,
    renderSidebarBody,
    renderSidebarRail,
  } = workspace;

  return (
    <div className={`assistant-workspace${isDark ? " is-dark" : ""}${activeRun ? " is-generating" : ""}${sidebarCollapsed ? " is-sidebar-narrow" : ""}${sidebarAnimating ? " is-sidebar-animating" : ""}`} onClick={() => { setCreationMenuOpen(false); setModelMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); setActiveMessageMenuId(""); setConversationMenuId(""); }}>
      <aside className="assistant-sidebar" onClick={(event) => { event.stopPropagation(); if (!event.target.closest(".conversation-more")) setConversationMenuId(""); }}>
        <button className="icon-button sidebar-close" type="button" title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={updateSidebar}><i className={`bi ${sidebarCollapsed ? "bi-chevron-right" : "bi-chevron-left"}`} /></button>
        {renderSidebarBody ? <div className="assistant-sidebar-body">
        <div className="assistant-brand-row"><div className="assistant-brand"><strong>开启创作</strong></div></div>
        <nav className="sidebar-nav" aria-label="创作入口">
          <button className="sidebar-nav-item" type="button" onClick={() => setSearchOpen(true)}>
            <i className="bi bi-search" aria-hidden="true" />
            <span>搜索</span>
          </button>
          <button className={`sidebar-nav-item${!activeId ? " is-active" : ""}`} type="button" data-assistant-tour="new-chat" onClick={newConversation}>
            <NewChatIcon />
            <span>新对话</span>
          </button>
          <button className={`sidebar-nav-item${assetLibraryOpen ? " is-active" : ""}`} type="button" data-assistant-tour="assets" onClick={() => setAssetLibraryOpen((value) => !value)}>
            <i className="bi bi-grid" aria-hidden="true" />
            <span>资产库</span>
          </button>
        </nav>
        <div className="sidebar-history" data-assistant-tour="history">
          <button className={`sidebar-history-toggle${historyOpen ? " is-open" : ""}`} type="button" aria-expanded={historyOpen} onClick={() => { setHistoryOpen((value) => !value); setConversationMenuId(""); }}>
            <span>历史</span>
            <i className="bi bi-chevron-down" aria-hidden="true" />
          </button>
          <div className={`sidebar-history-fold${historyOpen ? " is-open" : ""}`} aria-hidden={!historyOpen}>
            <div className="conversation-list sidebar-history-list">
              {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="conversation-skeleton" aria-hidden="true"><span><b /><b /></span></div>) : historyGroups.length ? historyGroups.map((group) => (
                <section key={group.key} className="sidebar-history-group">
                  <p className="sidebar-history-day">{group.key}</p>
                  {group.items.map((conversation) => {
                    const thumbnail = conversationThumbnail(conversation);
                    const pinned = pinnedIds.includes(conversation.id);
                    return (
                      <div key={conversation.id} className={`conversation-row${conversation.id === activeId ? " active" : ""}${pinned ? " is-pinned" : ""}`} data-conversation-id={conversation.id}>
                        <button className="conversation-select" type="button" title={conversation.title} onClick={() => selectConversation(conversation.id)}>
                          <span className={`history-thumb${thumbnail ? " has-image" : ""}`}>
                            {thumbnail ? <AssistantPreviewImage src={thumbnail} alt="" loading="lazy" /> : <b>{conversationMark(conversation)}</b>}
                          </span>
                          <span className="conversation-copy"><span>{conversation.title}</span></span>
                        </button>
                        {pinned ? <i className="bi bi-pin-angle-fill conversation-pin" aria-hidden="true" /> : null}
                        <div className={`conversation-more${conversationMenuId === conversation.id ? " is-open" : ""}`}>
                          <button className="conversation-more-toggle" type="button" title="更多" aria-label="更多" aria-expanded={conversationMenuId === conversation.id} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConversationMenuId((current) => current === conversation.id ? "" : conversation.id); }}>
                            <i className="bi bi-three-dots" aria-hidden="true" />
                          </button>
                          {conversationMenuId === conversation.id ? (
                            <div className="conversation-more-menu" role="menu">
                              <button type="button" role="menuitem" onClick={(event) => { event.preventDefault(); event.stopPropagation(); startRename(conversation); }}>
                                <i className="bi bi-pencil" aria-hidden="true" />
                                重新命名
                              </button>
                              <button type="button" role="menuitem" onClick={(event) => { event.preventDefault(); event.stopPropagation(); togglePinned(conversation); }}>
                                <i className={`bi ${pinned ? "bi-pin-angle-fill" : "bi-pin-angle"}`} aria-hidden="true" />
                                {pinned ? "取消置顶" : "置顶"}
                              </button>
                              <button type="button" role="menuitem" className="is-danger" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConversationMenuId(""); setDeleteTarget(conversation); }}>
                                <i className="bi bi-trash3" aria-hidden="true" />
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </section>
              )) : <p className="conversation-empty">暂无记录</p>}
              {historyHasMore ? <button className="sidebar-history-more" type="button" onClick={() => setHistoryShowAll(true)}>查看全部</button> : null}
            </div>
          </div>
        </div>
        </div> : null}
        {renderSidebarRail ? <div className="assistant-sidebar-rail" aria-hidden={!sidebarCollapsed}>
          <button className="assistant-rail-new" type="button" title="搜索" onClick={() => setSearchOpen(true)}><i className="bi bi-search" /></button>
          <button className="assistant-rail-new" type="button" title="新对话" data-assistant-tour="new-chat" onClick={newConversation}><NewChatIcon /></button>
          <button className={`assistant-rail-new${assetLibraryOpen ? " is-active" : ""}`} type="button" title="资产库" data-assistant-tour="assets" onClick={() => setAssetLibraryOpen((value) => !value)}><i className="bi bi-grid" /></button>
          <button className="assistant-rail-history" type="button" title="历史" aria-label="历史" data-assistant-tour="history" onClick={() => { setHistoryOpen(true); if (sidebarCollapsed) updateSidebar(); }}>
            <i className="bi bi-clock-history" aria-hidden="true" />
          </button>
          <div className="assistant-rail-list" aria-label="历史">
            {railConversations.map((conversation) => {
              const thumbnail = conversationThumbnail(conversation);
              const running = Boolean(activeRuns[conversation.id]);
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`assistant-rail-item${conversation.id === activeId ? " is-active" : ""}${running ? " is-running" : ""}`}
                  title={conversation.title}
                  onClick={() => selectConversation(conversation.id)}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setConversationPeek({ conversation, top: Math.max(64, Math.min(rect.top, window.innerHeight - 176)) });
                  }}
                  onMouseLeave={() => setConversationPeek(null)}
                >
                  <span className={`assistant-rail-thumb${thumbnail ? " has-image" : ""}`}>
                    {thumbnail ? <AssistantPreviewImage src={thumbnail} alt="" loading="lazy" /> : <b>{conversationMark(conversation)}</b>}
                  </span>
                </button>
              );
            })}
          </div>
        </div> : null}
      </aside>
      {conversationPeek && createPortal(<div className={`assistant-conversation-peek${isDark ? " is-dark" : ""}`} style={{ top: `${conversationPeek.top}px` }} aria-hidden="true"><strong>{conversationPeek.conversation.title}</strong>{(conversationPeek.conversation.messages || []).slice(-2).map((message, index) => <p key={`${message.id}-${index}`}><b>{message.role === "user" ? "我" : "AI"}</b>{message.images?.length ? `[图片 ×${message.images.length}]` : messagePreview(message.content)}</p>)}<small>{formatTime(conversationPeek.conversation.updatedAt)}</small></div>, document.body)}

      <main className={`assistant-main${messages.length ? "" : " is-empty"}`}>
        <div className="assistant-ambient-stage" aria-hidden="true"><i className="ambient-blob is-a" /><i className="ambient-blob is-b" /><i className="ambient-blob is-c" /></div>
        {messages.length > 0 && <header className="assistant-topbar"><div className="topbar-title"><label className="thread-search"><i className="bi bi-search" /><input name="assistant-thread-search" value={threadSearch} type="text" placeholder="搜索对话历史" aria-label="搜索对话历史" autoComplete="off" onChange={(event) => { setThreadSearch(event.target.value); setThreadHitIndex(-1); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setThreadSearch(""); setThreadHitIndex(-1); return; } if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); jumpToThreadHit(event.shiftKey ? -1 : 1); }} />{threadSearch.trim() ? <span className="thread-search-count" aria-live="polite">{threadSearchHits.length ? (threadHitIndex >= 0 ? `${threadHitIndex + 1}/${threadSearchHits.length}` : `${threadSearchHits.length} 条`) : "无结果"}</span> : null}{threadSearch.trim() ? <button type="button" title="上一条" aria-label="上一条匹配" disabled={!threadSearchHits.length} onClick={() => jumpToThreadHit(-1)}><i className="bi bi-chevron-up" /></button> : null}{threadSearch.trim() ? <button type="button" title="下一条" aria-label="下一条匹配" disabled={!threadSearchHits.length} onClick={() => jumpToThreadHit(1)}><i className="bi bi-chevron-down" /></button> : null}{threadSearch ? <button type="button" title="清空搜索" aria-label="清空搜索" onClick={() => { setThreadSearch(""); setThreadHitIndex(-1); }}><i className="bi bi-x" /></button> : null}</label></div><div className="topbar-filters"><button type="button" className="topbar-context-clear" data-assistant-tour="clear-context" title={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : `${assistantContextMeterTitle(latestContext)}。清除上文并保留可见历史`} aria-label={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : "清除上文并保留可见历史"} disabled={conversationHasWork || messages.at(-1)?.kind === "context-divider"} onClick={() => void clearConversationContext()}><AssistantContextMeter context={latestContext} /><span>清除上文</span></button></div></header>}
        <div ref={messageScrollerRef} className="assistant-messages" onScroll={handleMessageScroll}>
          {loading ? <section className="assistant-thread-skeleton" aria-label="正在加载"><div className="sk-bubble is-user"><i style={{ width: "46%" }} /></div><div className="sk-bubble"><i style={{ width: "82%" }} /><i style={{ width: "64%" }} /></div><div className="sk-bubble is-user"><i style={{ width: "30%" }} /></div><div className="sk-bubble"><i style={{ width: "74%" }} /><i style={{ width: "40%" }} /></div></section> : messages.length === 0 ? <AssistantEmptyState creation={selectedCreation} editableFilesEnabled={editableFilesEnabled} onPick={(text) => { setDraft(text); textareaRef.current?.focus(); }} /> : <section className="message-thread" aria-live="polite">{hiddenMessageCount > 0 && <button className="load-earlier-messages" type="button" disabled={loadingEarlierRef.current} onClick={() => { const scroller = messageScrollerRef.current; if (scroller) scroller.scrollTop = 0; }}><i className="bi bi-clock-history" /><span>加载更早的对话（{hiddenMessageCount}）</span></button>}<div className="message-turns">{renderedMessages.map((message, offset) => {
            const originalIndex = firstRenderedMessageIndex + offset;
            const previous = messages[originalIndex - 1];
            const currentDate = new Date(message.createdAt);
            const previousDate = new Date(previous?.createdAt);
            const showDate = originalIndex === 0 || Number.isNaN(previousDate.getTime()) || currentDate.toDateString() !== previousDate.toDateString();
            const previousUser = message.role === "user" ? message : [...messages.slice(0, originalIndex)].reverse().find((item) => item.role === "user");
            const sourceProposal = sourceProposalForImage(message);
            const attachedReferences = message.proposal
              ? resolveProposalReferences(activeConversation, message).references
              : previousUser?.referenceImages;
            if (hiddenQueuedMessageIds.has(message.id)) return null;
            return <AssistantMessageRow key={message.id} message={message} turnId={previousUser?.id} showDate={showDate} expanded={expandedStatusId === message.id} copied={copiedMessageId === message.id} generating={conversationHasWork} feedbackBusy={feedbackBusyIds.has(message.id)} isLastAssistant={message.id === lastAssistantId} isLastUser={message.id === lastUserMessageId} editing={editingMessageId === message.id} editingDraft={editingMessageDraft} moreOpen={activeMessageMenuId === message.id} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} imageModels={imageModels} sourceProposal={sourceProposal} proposalExecuted={messages.some((item) => item.role === "user" && item.proposalSourceMessageId === message.id)} attachedReferences={attachedReferences} searchHit={threadSearchHitIds.has(message.id)} searchCurrent={message.id === currentThreadHitId} searchQuery={threadSearch} toolActionBusyId={toolActionBusyId} onToolAction={executeAssistantToolAction} onToggleStatus={toggleStatus} onCopy={copyMessage} onFeedback={submitMessageFeedback} onQuote={quoteMessage} onOpenImage={openImage} onImageLoad={markImageLoaded} onImageError={markImageFailed} onImageRetry={retryImage} onUseReference={useGeneratedImageAsReference} onStartEdit={startEditingUserMessage} onEditDraft={setEditingMessageDraft} onCancelEdit={cancelUserMessageEdit} onSubmitEdit={(item) => void submitUserMessageEdit(item)} onRetry={(item) => void retryAssistant(item)} onToggleMore={(id) => setActiveMessageMenuId((current) => current === id ? "" : id)} onDownloadMarkdown={downloadMarkdown} onDelete={(id) => void removeMessage(id)} onProposalChange={(patch) => updateProposal(message.id, patch)} onProposalDismiss={() => updateProposal(message.id, { dismissed: true })} onProposalRestore={() => updateProposal(message.id, { dismissed: false })} onProposalApprove={() => void approveAgentProposal(message)} onReopenProposal={() => reopenSourceProposal(sourceProposal)} />;
          })}</div></section>}
        </div>

        <ConversationMinimap items={navigatorItems} activeSetterRef={navigatorActiveSetterRef} onScrollToMessage={scrollToMessage} />

        <div ref={composerZoneRef} className={`composer-zone${composerScrolledAway ? " is-scrolled-away" : ""}`} onClick={(event) => {
          event.stopPropagation();
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest(".composer-popover, .agent-mode-button, .image-model-button, .reasoning-effort-button, .image-settings-button")) return;
          setCreationMenuOpen(false);
          setModelMenuOpen(false);
          setReasoningMenuOpen(false);
          setPreferencesOpen(false);
          setModelSearch("");
        }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadReferences(event.dataTransfer.files); }}>
          {serviceError && <div className="assistant-service-error"><i className="bi bi-exclamation-circle" /><span>{serviceError}</span><button type="button" onClick={() => void loadWorkspace()}><i className="bi bi-arrow-clockwise" />重试</button></div>}
          <div ref={composerRef} className={`assistant-composer${mode === "image" ? " is-image-mode" : ""}${references.length || documents.length || uploading ? " has-attachments" : ""}${composerManuallyResized ? " is-manually-resized" : ""}${composerResizing ? " is-resizing" : ""}`}>
            <div
              className="composer-resize-handle"
              role="separator"
              aria-label="调整输入框高度"
              aria-orientation="horizontal"
              aria-valuemin="56"
              aria-valuemax={getComposerInputHeightBounds().maximum}
              aria-valuenow={composerInputHeightRef.current || undefined}
              tabIndex={0}
              title="拖动调整输入框高度，双击恢复"
              onPointerDown={startComposerResize}
              onPointerMove={moveComposerResize}
              onPointerUp={finishComposerResize}
              onPointerCancel={finishComposerResize}
              onDoubleClick={resetComposerInputHeight}
              onKeyDown={resizeComposerFromKeyboard}
            />
            {messages.length > 0 && !isAtBottom && !isReturningToBottom && (
              <button className="return-to-bottom" type="button" title="回到底部" aria-label="回到底部" onClick={() => scrollToBottom("smooth")}>
                <svg className="return-to-bottom-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2.5v8.2" />
                  <path d="M4.8 7.6 8 10.8l3.2-3.2" />
                  <path d="M3.5 13.5h9" />
                </svg>
                <span>回到底部</span>
              </button>
            )}
            <AssistantFollowUpQueue
              items={followUpRuns}
              editingId={queueEditingId}
              busyId={queueBusyId}
              onEdit={beginQueueEdit}
              onRemove={cancelQueueItem}
            />
            {runningGuidance.length > 0 && (
              <nav className="assistant-run-guidance" aria-label="接下来">
                <span>接下来</span>
                <div>
                  {runningGuidance.map((item) => <button key={item.id} type="button" onClick={() => applyRunningGuidance(item)}><i className={`bi ${item.icon}`} /><span>{item.label}</span></button>)}
                </div>
              </nav>
            )}
            {creationMenuOpen && <section className="composer-popover creation-type-menu"><p className="popover-eyebrow">创作类型</p>{CREATION_TYPES.map((type) => <button key={type.id} type="button" className={creationType === type.id ? "active" : ""} disabled={type.id === "image" && documents.length > 0} title={type.id === "image" && documents.length > 0 ? "先移除文档附件" : undefined} onClick={() => { setCreationType(type.id); setCreationMenuOpen(false); }}><SoftMark name={type.mark} size="sm" /><span>{type.label}</span>{creationType === type.id && <i className="bi bi-check-lg menu-check" />}</button>)}</section>}
            {modelMenuOpen && <section className="composer-popover image-model-menu" style={{ "--model-menu-left": "168px" }}><header className="model-menu-head"><p className="popover-eyebrow">{mode === "image" ? "选择图片模型" : "选择对话模型"}</p><span>{generationModels.length} 个模型</span></header>{generationModels.length > 6 && <div className="model-menu-search"><i className="bi bi-search" /><input name="assistant-model-search" value={modelSearch} type="text" placeholder="搜索模型名称" autoComplete="off" onChange={(event) => setModelSearch(event.target.value)} />{modelSearch && <button type="button" aria-label="清空模型搜索" title="清空" onClick={() => setModelSearch("")}><i className="bi bi-x-lg" /></button>}</div>}<div className="model-menu-options">{filteredGenerationModels.map((model) => <button key={model.model} type="button" className={generationModel === model.model ? "active" : ""} onClick={() => { mode === "image" ? setImageModel(model.model) : setConversationModel(model.model); setModelMenuOpen(false); setModelSearch(""); }}><SoftMark name="cpu" size="sm" /><span className="model-copy"><strong>{model.label}</strong></span><ModelMenuPrice model={mode === "image" ? model : modelWithReasoningPrice(model)} perImage={mode === "image"} /><span className="model-menu-check-slot">{generationModel === model.model && <i className="bi bi-check-lg menu-check" />}</span></button>)}{!filteredGenerationModels.length && <p className="skill-empty">{modelSearch ? "没有匹配的模型" : "后台暂未提供可用模型"}</p>}</div></section>}
            {reasoningMenuOpen && mode !== "image" && reasoningEffortOptions.length > 0 && (
              <section className="composer-popover reasoning-effort-menu" aria-label="推理强度">
                <header><p className="popover-eyebrow">推理强度</p><span>当前模型支持 {reasoningEffortOptions.length} 档</span></header>
                <div className="reasoning-effort-options">
                  {reasoningEffortOptions.map((option) => (
                    <button key={option.id} type="button" className={activeReasoningEffort === option.id ? "active" : ""} aria-pressed={activeReasoningEffort === option.id} onClick={() => { setReasoningEffort(option.id); setReasoningMenuOpen(false); }}>
                      <span className="reasoning-effort-copy"><strong>{option.label}</strong><small>{option.id}</small></span>
                      <ModelMenuPrice model={reasoningEffortOptionPriceModel(option)} unitSuffix="/轮" />
                      {activeReasoningEffort === option.id && <i className="bi bi-check-lg menu-check" />}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {preferencesOpen && mode === "image" && (
              <section className="composer-popover image-mode-preferences" aria-label="图片生成参数" style={preferencesPosition || undefined}>
                {availableRatios.length ? <div className="preferences-block">
                  <p className="preferences-label">比例</p>
                  <PreferenceSegment className="ratio-options" layout="wrap" value={generationRatio} items={availableRatios} onChange={setGenerationRatio} />
                </div> : null}
                {availableResolutions.length ? <div className="preferences-block">
                  <p className="preferences-label">分辨率</p>
                  <PreferenceSegment
                    className="image-resolution-options"
                    layout={availableResolutions.length >= 2 && availableResolutions.length <= 3 ? "track" : "wrap"}
                    columns={availableResolutions.length}
                    value={generationResolution}
                    items={availableResolutions}
                    onChange={setGenerationResolution}
                  />
                </div> : null}
                <div className="preferences-block">
                  <p className="preferences-label">数量</p>
                  <PreferenceSegment
                    className="image-count-options"
                    columns={balancedOptionColumns(availableCounts.length)}
                    value={generationCount}
                    items={availableCounts.map((count) => ({ id: count, label: count }))}
                    onChange={setGenerationCount}
                  />
                </div>
                {availableQualities.length ? <div className="preferences-block">
                  <p className="preferences-label">质量</p>
                  <PreferenceSegment
                    className="image-quality-options"
                    columns={availableQualities.length}
                    value={generationQuality}
                    items={availableQualities}
                    onChange={setGenerationQuality}
                  />
                </div> : null}
              </section>
            )}
            <input ref={fileInputRef} className="reference-file-input" name="assistant-attachments" type="file" accept={mode === "image" ? "image/*" : "image/*,.txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.pptx"} multiple aria-label={mode === "image" ? "添加参考图" : "添加图片或文档"} onChange={(event) => { void uploadReferences(event.target.files); event.target.value = ""; }} />
            {(references.length > 0 || documents.length > 0 || uploading) && <div className={`reference-dock has-images${uploading ? " is-uploading" : ""}`} aria-label="已添加的附件">{references.map((image, index) => <figure key={image.id} className="reference-card"><button type="button" className="reference-card-preview" title={image.name ? `查看 ${image.name}` : "查看参考图"} onClick={() => openImage(image, index, references)}><AssistantPreviewImage image={image} src={image.thumbnailUrl || image.dataUrl} fallbackSrc={image.dataUrl} alt={image.name || "参考图"} /></button><button type="button" className="reference-card-remove" title="移除参考图" aria-label={image.name ? `移除参考图 ${image.name}` : "移除参考图"} onClick={(event) => { event.stopPropagation(); setReferences((current) => current.filter((item) => item.id !== image.id)); }}><i className="bi bi-x" /></button></figure>)}{documents.map((item) => <div key={item.id} className={`reference-document-card is-${item.status || "queued"}`} title={item.errorMessage || item.name}><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{documentStatusLabel(item)} · {formatDocumentSize(item.sizeBytes)}</small></span><button type="button" title="移除文档" aria-label={`移除文档 ${item.name}`} onClick={() => removeComposerDocument(item)}><i className="bi bi-x" /></button></div>)}{uploading && <span className="reference-card reference-skeleton" aria-label="附件上传或解析中" />}</div>}
            {quotedMessage && <div className="composer-quote"><i className="bi bi-quote" /><span>[{quotedMessage.kind}] {quotedMessage.content}</span><button type="button" title="移除引用" aria-label="移除引用" onClick={() => setQuotedMessage(null)}><i className="bi bi-x-lg" /></button></div>}
            <textarea ref={textareaRef} name="assistant-message" value={draft} rows={1} aria-label="消息输入" data-assistant-tour="input" placeholder={queueEditingId ? "修改这条排队消息，发送后更新" : activeRun ? "继续输入，发送后会自动排队" : mode === "image" ? "描述你想生成的画面，也可以上传参考图" : "输入问题，或粘贴、拖入图片和文档"} disabled={Boolean(serviceError)} onChange={(event) => { setDraft(event.target.value); if (queueEditingId && !event.target.value) cancelQueueEdit(); }} onKeyDown={(event) => { if (event.key === "Escape" && queueEditingId) { event.preventDefault(); setDraft(""); cancelQueueEdit(); return; } if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void requestSend(); } }} />
            {draftCharacterCount > 10000 && <div className={`draft-counter${draftCharacterCount > MAX_ASSISTANT_MESSAGE_CHARACTERS ? " is-over" : ""}`}>{draftCharacterCount.toLocaleString("zh-CN")} / 12,000</div>}
            <div className="composer-toolbar">
              <div className="composer-left">
                <button className="composer-attachment-inline" type="button" data-assistant-tour="attach" title={mode === "image" ? "添加参考图" : "添加附件"} aria-label={mode === "image" ? "添加参考图" : "添加附件"} onClick={() => fileInputRef.current?.click()}><i className="bi bi-paperclip" /></button>
                <button className={`agent-mode-button${creationMenuOpen ? " active" : ""}`} type="button" data-assistant-tour="mode" aria-expanded={creationMenuOpen} onPointerDown={(event) => toggleComposerMenu(event, "creation")} onClick={swallowComposerMenuClick}><SoftMark name={selectedCreation.mark} size="sm" /><span>{selectedCreation.label}</span><i className={`bi bi-chevron-down menu-chevron${creationMenuOpen ? " is-open" : ""}`} /></button>
                <button className={`composer-tool-button image-model-button${modelMenuOpen ? " active" : ""}`} type="button" data-assistant-tour="model" title={`模型：${generationModelLabel}`} aria-label={`选择模型，当前为${generationModelLabel}`} aria-expanded={modelMenuOpen} onPointerDown={(event) => toggleComposerMenu(event, "model")} onClick={swallowComposerMenuClick}><SoftMark name="cpu" size="sm" /><span>{generationModelLabel}</span><i className={`bi bi-chevron-down menu-chevron${modelMenuOpen ? " is-open" : ""}`} /></button>
                {mode === "image" ? (
                  <button ref={imageSettingsButtonRef} className={`composer-tool-button image-settings-button${preferencesOpen ? " active" : ""}`} type="button" aria-expanded={preferencesOpen} onPointerDown={(event) => toggleComposerMenu(event, "preferences")} onClick={swallowComposerMenuClick}><span>{[generationRatio === "auto" ? "Auto" : generationRatio, generationResolution, generationQuality, `${generationCount}张`].filter(Boolean).join(" | ")}</span><i className={`bi bi-chevron-down menu-chevron${preferencesOpen ? " is-open" : ""}`} /></button>
                ) : (
                  <>
                    {reasoningEfforts.length > 0 && activeReasoningEffort ? <button className={`composer-tool-button reasoning-effort-button${reasoningMenuOpen ? " active" : ""}`} type="button" title={`推理强度：${reasoningEffortLabel}`} aria-label={`选择推理强度，当前为${reasoningEffortLabel}`} aria-expanded={reasoningMenuOpen} onPointerDown={(event) => toggleComposerMenu(event, "reasoning")} onClick={swallowComposerMenuClick}><i className="bi bi-speedometer2" /><span>推理 {reasoningEffortLabel}</span><i className={`bi bi-chevron-down menu-chevron${reasoningMenuOpen ? " is-open" : ""}`} /></button> : null}
                  </>
                )}
              </div>
              <div className="composer-actions">
                {voiceListening && <span className="composer-voice-status">正在聆听</span>}
                <button
                  className={`voice-button${voiceListening ? " is-listening" : ""}`}
                  type="button"
                  disabled={!voiceSupported || voiceBusy}
                  title={voiceSupported ? (voiceListening ? "停止语音输入" : "语音输入") : "当前浏览器不支持语音输入"}
                  aria-label={voiceListening ? "停止语音输入" : "语音输入"}
                  aria-pressed={voiceListening}
                  onClick={(event) => { event.stopPropagation(); toggleVoiceInput(); }}
                >
                  <i className={`bi ${voiceListening ? "bi-stop-fill" : "bi-mic"}`} />
                </button>
                {activeRun && <button className="send-button stop-button" type="button" title={activeCancelPolicy?.refunded ? "停止生成并退回冻结积分" : "停止生成"} aria-label="停止生成" onClick={() => setStopConfirmOpen(true)}><span className="stop-glyph" /></button>}
                <button className={`send-button${activeRun ? " queue-send-button" : ""}`} type="button" data-assistant-tour="send" title={activeRun ? "加入队列" : "发送"} aria-label={activeRun ? "加入队列" : "发送"} disabled={auth.isAuthenticated && !canSend} onClick={() => void requestSend()}><span className="send-glyph"><i className="bi bi-arrow-up" /></span></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AssistantAssetLibrary
        mounted={assetLibraryMounted}
        dark={isDark}
        entered={assetLibraryEntered}
        tab={assetTab}
        kind={assetKind}
        search={assetSearch}
        files={assetLibraryFiles}
        links={assetLibraryLinks}
        images={assetLibraryImages}
        visibleImages={visibleAssetLibraryImages}
        documents={documents}
        references={references}
        mode={mode}
        maxReferences={maxReferences}
        atReferenceLimit={atReferenceLimit}
        loading={libraryAssetsLoading}
        onClose={() => setAssetLibraryOpen(false)}
        onTabChange={setAssetTab}
        onKindChange={setAssetKind}
        onSearchChange={setAssetSearch}
        onGridScroll={handleAssetGridScroll}
        onPickFile={addAssetDocument}
        onPickImage={addAssetReference}
      />

      <AssistantSearchDialog
        open={searchOpen}
        dark={isDark}
        inputRef={searchInputRef}
        query={searchQuery}
        groups={searchGroups}
        results={searchResults}
        cursor={searchCursor}
        activeId={activeId}
        onQueryChange={setSearchQuery}
        onCursorChange={setSearchCursor}
        onOpenConversation={openConversation}
        onStartRename={startRename}
        onDelete={setDeleteTarget}
        onClose={closeSearch}
        onExited={handleSearchExited}
      />
      <AssistantRenameDialog
        conversationId={renamingId}
        dark={isDark}
        inputRef={renameInputRef}
        draft={renameDraft}
        saving={renameSaving}
        onDraftChange={setRenameDraft}
        onCancel={cancelRename}
        onCommit={commitRename}
      />
      <AssistantStopDialog
        open={stopConfirmOpen}
        dark={isDark}
        busy={stopBusy}
        policy={activeCancelPolicy}
        onClose={() => setStopConfirmOpen(false)}
        onStop={stopRun}
      />
      <AssistantDeleteDialog
        target={deleteTarget}
        dark={isDark}
        hasWork={deleteTargetHasWork}
        onClose={() => setDeleteTarget(null)}
        onDelete={deleteConversationRow}
      />
      <AssistantCostDialog payload={costPayload} light={!isDark} onCancel={cancelCost} onConfirm={(skip) => void confirmCost(skip)} />
      <AssistantFullscreenPreview
        value={selectedImage}
        actionBusy={imageActionBusy}
        onClose={closeImage}
        onStep={stepImage}
        onUseReference={useGeneratedImageAsReference}
        onRegionEdit={submitRegionEdit}
        onFavorite={(item, meta) => void favoriteAssistantImage(item, meta)}
        onPublish={requestPublishImage}
        onDelete={requestDeleteImage}
      />
      <ConfirmDialog
        open={Boolean(toolActionTarget)}
        busy={Boolean(toolActionBusyId)}
        heading={`确认${toolActionTarget?.action?.title || "执行这个工具"}？`}
        description={toolActionTarget?.action?.description || "确认后继续执行。可能产生费用的生成步骤仍会在目标页面单独确认。"}
        confirmLabel={toolActionTarget?.action?.buttonLabel || "确认执行"}
        busyLabel="处理中…"
        icon={toolActionTarget?.action?.kind === "download" ? "bi-file-earmark-zip" : "bi-magic"}
        tone="accent"
        light={!isDark}
        onClose={() => !toolActionBusyId && setToolActionTarget(null)}
        onConfirm={() => void confirmAssistantToolAction()}
      />
      <ConfirmDialog
        open={Boolean(imageDeleteTarget)}
        busy={imageDeleteBusy}
        heading="删除这张图片？"
        description="图片会从当前对话中移除，删除后无法恢复。"
        light={!isDark}
        onClose={() => !imageDeleteBusy && setImageDeleteTarget(null)}
        onConfirm={() => void confirmDeleteImage()}
      />
      <SharePublishDialog
        open={Boolean(shareTarget)}
        title={String(shareTarget?.meta?.prompt || shareTarget?.item?.revisedPrompt || "AI 助手创作").slice(0, 120)}
        submitting={shareSubmitting}
        light={!isDark}
        onClose={() => !shareSubmitting && setShareTarget(null)}
        onSubmit={(options) => void submitAssistantShare(options)}
      />
      {createPortal(
        <AssistantOnboardingTour open={tourOpen} dark={isDark} onClose={() => setTourOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
