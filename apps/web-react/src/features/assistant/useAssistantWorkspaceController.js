import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  cancelAssistantRun,
  createAssistantContextBoundary,
  createAssistantConversation,
  createAssistantRun,
  deleteAssistantFile,
  deleteAssistantMessage,
  deleteAssistantMessageImage,
  deleteAssistantTurn,
  deleteAssistantConversation,
  fetchAssistantConfig,
  editQueuedAssistantRun,
  getAssistantFile,
  getAssistantRun,
  importAssistantConversations,
  listActiveAssistantRuns,
  listAssistantConversations,
  openAssistantRunStream,
  patchAssistantConversation,
  setAssistantMessageFeedback,
  uploadAssistantFile,
  waitForAssistantRun,
} from "./services/assistantApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { scheduleWalletRefresh } from "@react/legacy-modules/services/walletSync.js";
import {
  createUserAsset,
  getWallet,
  listUserAssets,
  updateProfile,
} from "@react/legacy-modules/services/meApi.js";
import { submitShareItem } from "@react/legacy-modules/services/shareGallery.js";
import { composePendingLaunchPrompt, stashPendingPrompt, takePendingPrompt } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  conversationTitle,
  formatTime,
  assistantSendMode,
  assistantMessageMatchesRun,
  imageCountFromPrompt,
  messageIsQueued,
  messagePreview,
  uid,
} from "./domain/assistantMessages.js";
import { assistantStreamEventIsTerminal, mergeAssistantMessageSnapshot, mergeAssistantStreamText } from "./domain/assistantStreamMerge.js";
import { mergePersistedAssistantMessage, resolveAssistantRetryIdentity } from "./domain/assistantRetryPolicy.js";
import { resolveVisualContext } from "./domain/visualContext.js";
import { assistantRunGuidance } from "./domain/assistantGuidance.js";
import {
  clearAssistantHistory,
  loadAssistantHistory,
  loadAssistantWorkspaceState,
  saveAssistantWorkspaceState,
} from "./services/assistantHistory.js";
import {
  IMAGE_ASPECT_RATIOS,
  clampImageCount,
  getModelAspectRatiosForResolution,
  imageCountOptions,
  imageModelMaxCount,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useAuthPrompt } from "../../auth/AuthPromptContext.jsx";
import { useIsDark } from "../../hooks/useIsDark.js";
import { assistantClipboardFiles, isAssistantImageFile, isPSDFile } from "./domain/assistantAttachments.js";
import { isProductGuidesEnabled, subscribeProductGuideReplay } from "../../views/shared/productGuides.js";
import {
  ASSET_GRID_RENDER_SIZE,
  ASSET_LIBRARY_MOTION_MS,
  ASSET_LIBRARY_PAGE_SIZE,
  CREATION_TYPES,
  HISTORY_PREVIEW_COUNT,
  IMAGE_QUALITY_OPTIONS,
  LOAD_EARLIER_COOLDOWN_MS,
  MAX_ASSISTANT_MESSAGE_CHARACTERS,
  MAX_MODEL_REFERENCE_IMAGES,
  MESSAGE_BATCH_SIZE,
  REASONING_EFFORT_LABELS,
  RESOLUTIONS,
  SIDEBAR_MOTION_MS,
  TERMINAL_RUN_STATUSES,
  assistantActionImages,
  assistantCharacterCount,
  assistantImageSettings,
  assistantReasoningPrice,
  collectConversationAssets,
  collectConversationFiles,
  collectConversationLinks,
  conversationSearchGroupLabel,
  createLocalAssistantPlaceholder,
  defaultReasoningEffort,
  estimateAssistantTokens,
  exportAssistantDelivery,
  fileKeyFromAssetUrl,
  groupConversations,
  imageAssetFromItem,
  imageRequestFromProposal,
  imageRunReferenceMode,
  imageUrl,
  mergeAssistantUsage,
  messageSearchText,
  normalizeAssistantContext,
  normalizeConfig,
  normalizeConversation,
  prepareLegacyConversations,
  proposalImagePlanItems,
  proposalReferenceMode,
  ratioOption,
  requestedConversationId,
  resolveProposalReferences,
  sameAssetReference,
  syncConversationUrl,
  uniqueReferenceImages,
  usageStartedAtMs,
} from "./assistantWorkspaceCore.jsx";
import { closestNavigatorTurn } from "./AssistantMessageComponents.jsx";

export function useAssistantWorkspaceController() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceScope = `user:${auth.user?.id || "anonymous"}`;
  const mountedRef = useRef(true);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const composerRef = useRef(null);
  const composerZoneRef = useRef(null);
  const imageSettingsButtonRef = useRef(null);
  const composerInputHeightRef = useRef(0);
  const composerResizeStateRef = useRef(null);
  const recognitionRef = useRef(null);
  const draftRef = useRef("");
  const voiceBaseDraftRef = useRef("");
  const voiceIntentRef = useRef(false);
  const messageScrollerRef = useRef(null);
  const atBottomRef = useRef(true);
  const returningRef = useRef(false);
  const loadingEarlierRef = useRef(false);
  const loadEarlierAtRef = useRef(0);
  const messageScrollFrameRef = useRef(0);
  const navigatorMeasureFrameRef = useRef(0);
  const navigatorMessageOffsetsRef = useRef([]);
  const navigatorActiveSetterRef = useRef(() => {});
  const pendingEarlierScrollHeightRef = useRef(0);
  const returnBottomTimerRef = useRef(0);
  const workspaceControllerRef = useRef(null);
  const draftRequestControllerRef = useRef(null);
  const runControllersRef = useRef(new Map());
  const feedbackRequestsRef = useRef(new Set());
  const uploadControllerRef = useRef(null);
  const uploadReferencesRef = useRef(null);
  const costControllerRef = useRef(null);
  const costResolverRef = useRef(null);
  const pendingLaunchRef = useRef(null);
  const activeIdRef = useRef("");
  const conversationsRef = useRef([]);
  const queuedRunsRef = useRef([]);
  const messagesRef = useRef([]);
  const workspaceHydratedRef = useRef(false);
  const conversationDraftsRef = useRef(new Map());
  const composerWorkspaceScopeRef = useRef(workspaceScope);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [creationType, setCreationType] = useState("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const sidebarMotionTimerRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(-1);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [conversationMenuId, setConversationMenuId] = useState("");
  const searchInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const [modelSearch, setModelSearch] = useState("");
  const [creationMenuOpen, setCreationMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesPosition, setPreferencesPosition] = useState(null);
  const [tourOpen, setTourOpen] = useState(false);
  const tourStartedRef = useRef(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibraryMounted, setAssetLibraryMounted] = useState(false);
  const [assetLibraryEntered, setAssetLibraryEntered] = useState(false);
  const [assetTab, setAssetTab] = useState("all");
  const [assetKind, setAssetKind] = useState("image");
  const [assetSearch, setAssetSearch] = useState("");
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [libraryAssetsLoading, setLibraryAssetsLoading] = useState(false);
  const [assetRenderLimit, setAssetRenderLimit] = useState(ASSET_GRID_RENDER_SIZE);
  const libraryAssetsLoadedRef = useRef(false);
  const libraryCursorRef = useRef("");
  const libraryLoadingMoreRef = useRef(false);
  const [conversationModels, setConversationModels] = useState([]);
  const [imageModels, setImageModels] = useState([]);
  const [editableFilesEnabled, setEditableFilesEnabled] = useState(false);
  const [conversationModel, setConversationModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [generationRatio, setGenerationRatio] = useState("auto");
  const [generationResolution, setGenerationResolution] = useState("");
  const [generationQuality, setGenerationQuality] = useState("");
  const [generationCount, setGenerationCount] = useState(2);
  const [references, setReferences] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [activeRuns, setActiveRuns] = useState({});
  const [queuedRuns, setQueuedRuns] = useState([]);
  const [queueEditingId, setQueueEditingId] = useState("");
  const [queueBusyId, setQueueBusyId] = useState("");
  const [costPayload, setCostPayload] = useState(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resumeCandidates, setResumeCandidates] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageActionBusy, setImageActionBusy] = useState("");
  const [toolActionBusyId, setToolActionBusyId] = useState("");
  const [feedbackBusyIds, setFeedbackBusyIds] = useState(() => new Set());
  const [toolActionTarget, setToolActionTarget] = useState(null);
  const [imageDeleteTarget, setImageDeleteTarget] = useState(null);
  const [imageDeleteBusy, setImageDeleteBusy] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState(null);
  const [conversationPeek, setConversationPeek] = useState(null);
  const [loadedImages, setLoadedImages] = useState(() => new Set());
  const [failedImages, setFailedImages] = useState(() => new Set());
  const [imageRetryVersions, setImageRetryVersions] = useState({});
  const [expandedStatusId, setExpandedStatusId] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [activeMessageMenuId, setActiveMessageMenuId] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isReturningToBottom, setIsReturningToBottom] = useState(false);
  const [composerManuallyResized, setComposerManuallyResized] = useState(false);
  const [composerResizing, setComposerResizing] = useState(false);
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(MESSAGE_BATCH_SIZE);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadHitIndex, setThreadHitIndex] = useState(-1);

  const activeConversation = conversations.find((item) => item.id === activeId) || null;
  conversationsRef.current = conversations;
  queuedRunsRef.current = queuedRuns;
  activeIdRef.current = activeId;
  const messages = activeConversation?.messages || [];
  messagesRef.current = messages;

  const performAssistantToolAction = useCallback(async (message, action) => {
    if (!action || toolActionBusyId) return;
    setToolActionBusyId(String(action.id || action.tool || "tool-action"));
    try {
      if (action.kind === "download") {
        const count = await exportAssistantDelivery(activeConversation, action);
        notificationService.success(`已导出 ${count} 张图片的交付包`);
        return;
      }
      const route = String(action.route || "").trim();
      if (!route.startsWith("/") || route.startsWith("//")) throw new Error("站内目标地址无效");
      if (action.kind === "navigate") {
        navigate(route);
        return;
      }
      const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
      const references = assistantActionImages(activeConversation, message, action);
      const taskTypes = {
        canvas: "infinite_canvas", infinite_canvas: "infinite_canvas",
        ecommerce: "ecommerce", text_to_image: "t2i", ui_design: "ui_design",
        model_sheet: "model_sheet", game_art: "game_art",
        background_remove: "infinite_canvas", compress: "infinite_canvas",
        upscale: "infinite_canvas", crop: "infinite_canvas", split: "infinite_canvas",
      };
      const taskType = taskTypes[payload.taskType] || "infinite_canvas";
      const productPrompt = action.kind === "product_import"
        ? [`商品：${payload.title || "未命名商品"}`, payload.description, payload.price ? `页面价格：${payload.price}` : "", payload.sourceUrl ? `来源：${payload.sourceUrl}` : ""].filter(Boolean).join("\n")
        : "";
      const prompt = String(payload.instruction || productPrompt || action.description || "").trim();
      stashPendingPrompt({
        prompt,
        taskType,
        config: {
          referenceImages: references,
          materialPrompt: productPrompt,
          autoStart: false,
        },
      });
      navigate(route);
    } catch (error) {
      notificationService.error(error?.message || "工具执行失败");
    } finally {
      setToolActionBusyId("");
    }
  }, [activeConversation, navigate, toolActionBusyId]);

  const executeAssistantToolAction = useCallback((message, action) => {
    if (!action || toolActionBusyId) return;
    if (action.requiresConfirmation) {
      setToolActionTarget({ message, action });
      return;
    }
    void performAssistantToolAction(message, action);
  }, [performAssistantToolAction, toolActionBusyId]);

  const confirmAssistantToolAction = useCallback(async () => {
    const target = toolActionTarget;
    if (!target) return;
    setToolActionTarget(null);
    await performAssistantToolAction(target.message, target.action);
  }, [performAssistantToolAction, toolActionTarget]);
  const activeRun = activeRuns[activeId] || null;
  const conversationHasWork = Boolean(activeRun) || queuedRuns.some((run) => run.conversationId === activeId && run.status === "queued");
  const waitingRuns = useMemo(() => queuedRuns
    .filter((run) => run.conversationId === activeId && run.status === "queued" && run.id !== activeRun?.id)
    .sort((left, right) => Number(left.queuePosition || 0) - Number(right.queuePosition || 0)), [activeId, activeRun, queuedRuns]);
  const followUpRuns = useMemo(() => {
    const waiting = !activeRun ? (waitingRuns.length >= 2 ? waitingRuns.slice(1) : []) : waitingRuns;
    const seen = new Set(waiting.flatMap((run) => [run.id, run.assistantMessageId, run.userMessageId].filter(Boolean)));
    const optimistic = [];
    for (const message of messages) {
      if (message.role !== "assistant" || !messageIsQueued(message)) continue;
      if (activeRun && (activeRun.assistantMessageId === message.id || activeRun.id === message.runId)) continue;
      if (seen.has(message.id) || seen.has(message.userMessageId) || seen.has(message.runId)) continue;
                    optimistic.push({
        id: message.runId || message.id,
        prompt: message.prompt || "",
        assistantMessageId: message.id,
        userMessageId: message.userMessageId,
        status: "queued",
        pending: true,
      });
    }
    return [...waiting, ...optimistic];
  }, [activeRun, messages, waitingRuns]);
  const hiddenQueuedMessageIds = useMemo(() => {
    const ids = new Set();
    for (const run of followUpRuns) {
      if (run.userMessageId) ids.add(run.userMessageId);
      if (run.assistantMessageId) ids.add(run.assistantMessageId);
    }
    for (const message of messages) {
      if (message.role !== "assistant" || !messageIsQueued(message)) continue;
      if (activeRun && (activeRun.assistantMessageId === message.id || activeRun.id === message.runId)) continue;
      ids.add(message.id);
      if (message.userMessageId) ids.add(message.userMessageId);
    }
    return ids;
  }, [activeRun, followUpRuns, messages]);
  const runningGuidance = useMemo(() => activeRun && !draft.trim() && !queueEditingId && followUpRuns.length === 0
    ? assistantRunGuidance(activeRun)
    : [], [activeRun, draft, followUpRuns.length, queueEditingId]);
  const activeCancelPolicy = activeRun?.cancelPolicy || null;
  const composerScrolledAway = messages.length > 0
    && !isAtBottom
    && !isReturningToBottom
    && !composerManuallyResized;
  const firstRenderedMessageIndex = Math.max(0, messages.length - visibleMessageLimit);
  const renderedMessages = messages.slice(firstRenderedMessageIndex);
  const hiddenMessageCount = firstRenderedMessageIndex;
  const threadSearchHits = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return [];
    return messages.filter((message) => messageSearchText(message).toLowerCase().includes(query));
  }, [messages, threadSearch]);
  const threadSearchHitIds = useMemo(() => new Set(threadSearchHits.map((message) => message.id)), [threadSearchHits]);
  const currentThreadHitId = threadHitIndex >= 0 ? threadSearchHits[threadHitIndex]?.id || "" : "";
  const mode = creationType === "image" ? "image" : "chat";
  const selectedCreation = CREATION_TYPES.find((item) => item.id === creationType) || CREATION_TYPES[0];
  const generationModels = mode === "image" ? imageModels : conversationModels;
  const generationModel = mode === "image" ? imageModel : conversationModel;
  const resolveAssistantSend = (prompt, documentCount = documents.length) => {
    const responseMode = assistantSendMode(creationType, documentCount, prompt);
    return {
      responseMode,
      sendModel: responseMode === "image"
        ? (imageModel || imageModels[0]?.model || "")
        : (conversationModel || conversationModels[0]?.model || ""),
      requestedCount: responseMode === "image"
        ? clampImageCount(imageCountFromPrompt(prompt, maxImages) || generationCount, selectedImageModel)
        : responseMode === "agent"
          ? clampImageCount(imageCountFromPrompt(prompt, maxImages) || 1, selectedImageModel)
          : 1,
    };
  };
  const selectedModel = generationModels.find((item) => item.model === generationModel) || generationModels[0] || null;
  const generationModelLabel = selectedModel?.label || (loading ? "加载模型…" : "暂无可用模型");
  const selectedConversationModel = conversationModels.find((item) => item.model === conversationModel) || conversationModels[0] || null;
  const reasoningEffortOptions = selectedConversationModel?.reasoningEfforts || [];
  const reasoningEfforts = reasoningEffortOptions.map((item) => item.id);
  const activeReasoningEffort = reasoningEfforts.includes(reasoningEffort) ? reasoningEffort : defaultReasoningEffort(selectedConversationModel);
  const activeReasoningOption = reasoningEffortOptions.find((item) => item.id === activeReasoningEffort);
  const reasoningEffortLabel = activeReasoningOption?.label || REASONING_EFFORT_LABELS[activeReasoningEffort] || activeReasoningEffort || "";
  const modelWithReasoningPrice = (model, effort = activeReasoningEffort) => {
    const option = (model?.reasoningEfforts || []).find((item) => item.id === effort);
    const price = assistantReasoningPrice(model, effort, option);
    return {
      ...model,
      pricing: undefined,
      pricePoints: price.effective,
      standardPricePoints: price.standard,
      discountPricePoints: price.hasDiscount ? price.effective : null,
    };
  };
  const filteredGenerationModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return query ? generationModels.filter((item) => `${item.label} ${item.model} ${item.description || ""}`.toLowerCase().includes(query)) : generationModels;
  }, [generationModels, modelSearch]);
  const selectedImageModel = imageModels.find((item) => item.model === imageModel) || imageModels[0] || null;
  const availableCounts = useMemo(() => imageCountOptions(selectedImageModel), [selectedImageModel]);
  const maxImages = imageModelMaxCount(selectedImageModel);
  const maxReferences = normalizeImageModelCapabilities(selectedImageModel || {}).maxReferenceImages;
  const atReferenceLimit = references.length >= maxReferences;
  const referenceLimitMessage = maxReferences <= 0
    ? "当前模型不接收参考图"
    : `参考图已达上限，最多 ${maxReferences} 张`;
  const availableRatios = useMemo(
    () =>
      getModelAspectRatiosForResolution(
        selectedImageModel || {},
        generationResolution,
      ).map(ratioOption),
    [generationResolution, selectedImageModel],
  );
  const availableResolutions = useMemo(() => {
    const supported = new Set(
      normalizeImageModelCapabilities(selectedImageModel || {}).resolutions,
    );
    return RESOLUTIONS.filter((item) => supported.has(item.id));
  }, [selectedImageModel]);
  const availableQualities = useMemo(() => {
    const supported = new Set(
      normalizeImageModelCapabilities(selectedImageModel || {}).qualities,
    );
    return IMAGE_QUALITY_OPTIONS.filter((item) => supported.has(item.id));
  }, [selectedImageModel]);
  const listableConversations = useMemo(
    () => conversations.filter((item) => (item?.messages || []).length > 0),
    [conversations],
  );
  const visibleConversations = useMemo(() => {
    if (historyShowAll) return listableConversations;
    return listableConversations.slice(0, HISTORY_PREVIEW_COUNT);
  }, [historyShowAll, listableConversations]);
  const historyGroups = useMemo(() => {
    const pinned = visibleConversations.filter((item) => pinnedIds.includes(item.id));
    const unpinned = visibleConversations.filter((item) => !pinnedIds.includes(item.id));
    const groups = groupConversations(unpinned);
    return pinned.length ? [{ key: "已置顶", items: pinned }, ...groups] : groups;
  }, [pinnedIds, visibleConversations]);
  const historyHasMore = !historyShowAll && listableConversations.length > HISTORY_PREVIEW_COUNT;
  const railConversations = useMemo(() => {
    const pinned = listableConversations.filter((item) => pinnedIds.includes(item.id));
    const rest = listableConversations.filter((item) => !pinnedIds.includes(item.id));
    return [...pinned, ...rest];
  }, [listableConversations, pinnedIds]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return listableConversations;
    return listableConversations.filter((item) => `${item.title} ${(item.messages || []).map((message) => message.content).join(" ")}`.toLowerCase().includes(query));
  }, [listableConversations, searchQuery]);
  const searchGroups = useMemo(
    () => groupConversations(searchResults, conversationSearchGroupLabel),
    [searchResults],
  );
  const libraryAssetItems = useMemo(() => {
    const seen = new Set();
    return libraryAssets.flatMap((item) => {
      const dataUrl = String(item.url || "").trim();
      if (!dataUrl || seen.has(dataUrl)) return [];
      seen.add(dataUrl);
      return [{
        id: `library-${item.id}`,
        label: item.title || "我的资产",
        dataUrl,
        thumbUrl: item.thumbnailUrl || dataUrl,
        fileKey: String(item.fileKey || "").trim() || fileKeyFromAssetUrl(dataUrl),
      }];
    });
  }, [libraryAssets]);
  const assetLibraryImages = useMemo(() => {
    const conversationAssets = collectConversationAssets(assetTab === "session" ? [activeConversation].filter(Boolean) : conversations);
    const assets = assetTab === "all"
      ? [...libraryAssetItems, ...conversationAssets.filter((item) => !libraryAssetItems.some((libraryItem) => libraryItem.dataUrl === item.dataUrl))]
      : conversationAssets;
    const query = assetSearch.trim().toLowerCase();
    return query ? assets.filter((asset) => asset.label.toLowerCase().includes(query)) : assets;
  }, [activeConversation, assetSearch, assetTab, conversations, libraryAssetItems]);
  const assetLibraryFiles = useMemo(() => {
    const files = collectConversationFiles(assetTab === "session" ? [activeConversation].filter(Boolean) : conversations);
    const query = assetSearch.trim().toLowerCase();
    return query ? files.filter((file) => `${file.label} ${file.name || ""}`.toLowerCase().includes(query)) : files;
  }, [activeConversation, assetSearch, assetTab, conversations]);
  const collectedAssetLibraryLinks = useMemo(() => {
    if (!assetLibraryMounted || assetKind !== "link") return [];
    return collectConversationLinks(assetTab === "session" ? [activeConversation].filter(Boolean) : conversations);
  }, [activeConversation, assetKind, assetLibraryMounted, assetTab, conversations]);
  const assetLibraryLinks = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return query
      ? collectedAssetLibraryLinks.filter((link) => `${link.label} ${link.host} ${link.url} ${link.conversationTitle}`.toLowerCase().includes(query))
      : collectedAssetLibraryLinks;
  }, [assetSearch, collectedAssetLibraryLinks]);
  const visibleAssetLibraryImages = assetLibraryImages.slice(0, assetRenderLimit);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant" && !hiddenQueuedMessageIds.has(message.id))?.id || "";
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === "user" && !hiddenQueuedMessageIds.has(message.id))?.id || "";
  const latestContext = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.kind === "context-divider") return null;
      const context = normalizeAssistantContext(messages[index]?.context);
      if (context) return context;
    }
    return null;
  }, [messages]);
  const navigatorItems = useMemo(() => messages.filter((message) => message.role === "user" && !hiddenQueuedMessageIds.has(message.id)).map((message) => ({ id: message.id, time: formatTime(message.createdAt), preview: messagePreview(message.content) })), [hiddenQueuedMessageIds, messages]);

  const patchConversation = useCallback((id, patcher) => {
    setConversations((current) => current.map((item) => item.id === id ? patcher(item) : item));
  }, []);

  const submitMessageFeedback = useCallback(async (message, rating) => {
    const conversationId = activeConversation?.id;
    const messageId = String(message?.id || "").trim();
    if (!conversationId || !messageId || !["positive", "negative"].includes(rating) || feedbackRequestsRef.current.has(messageId)) return;
    const nextRating = message.feedback === rating ? "" : rating;
    feedbackRequestsRef.current.add(messageId);
    setFeedbackBusyIds((current) => new Set(current).add(messageId));
    try {
      const updatedMessage = await setAssistantMessageFeedback(messageId, nextRating);
      if (!updatedMessage || String(updatedMessage.id || "") !== messageId) throw new Error("回复评价状态同步失败");
      if (!mountedRef.current) return;
      patchConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) => item.id === messageId ? { ...item, ...updatedMessage } : item),
      }));
    } catch (error) {
      if (mountedRef.current) notificationService.error(error?.message || "回复评价提交失败");
    } finally {
      feedbackRequestsRef.current.delete(messageId);
      if (mountedRef.current) {
        setFeedbackBusyIds((current) => {
          const next = new Set(current);
          next.delete(messageId);
          return next;
        });
      }
    }
  }, [activeConversation?.id, patchConversation]);

  const toggleStatus = useCallback((id) => setExpandedStatusId((current) => current === id ? "" : id), []);
  const copyMessage = useCallback(async (message) => {
    try {
      await navigator.clipboard.writeText(String(message?.content || ""));
      setCopiedMessageId(message.id);
      window.setTimeout(() => mountedRef.current && setCopiedMessageId(""), 1400);
    } catch {
      notificationService.error("复制失败，请手动选择内容");
    }
  }, []);
  const quoteMessage = useCallback((message) => {
    setQuotedMessage({
      id: message.id,
      kind: message.images?.length ? "图片" : "回复",
      content: message.content || message.images?.[0]?.revisedPrompt || "AI 生成内容",
    });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);
  const openImage = useCallback((item, index = 0, gallery = [item], meta = null) => {
    if (!item) return;
    const list = uniqueReferenceImages(Array.isArray(gallery) && gallery.length ? gallery : [item]);
    const resolved = list[index] && imageUrl(list[index]) ? list[index] : list.find((entry) => entry === item) || item;
    if (!imageUrl(resolved)) {
      notificationService.error("这张参考图暂时无法预览");
      return;
    }
    const safeIndex = Math.max(0, list.findIndex((entry) => entry === resolved));
    setSelectedImage({ item: resolved, index: safeIndex < 0 ? 0 : safeIndex, gallery: list.length ? list : [resolved], meta });
  }, []);
  const closeImage = useCallback(() => setSelectedImage(null), []);
  const stepImage = useCallback((delta) => {
    setSelectedImage((current) => {
      if (!current?.gallery?.length) return current;
      const index = (current.index + delta + current.gallery.length) % current.gallery.length;
      return { ...current, index, item: current.gallery[index] };
    });
  }, []);
  const favoriteAssistantImage = useCallback(async (item, meta) => {
    if (!item?.fileKey || imageActionBusy) return;
    setImageActionBusy("favorite");
    try {
      const response = await fetch(imageUrl(item), { credentials: "same-origin" });
      if (!response.ok) throw new Error("图片读取失败");
      const blob = await response.blob();
      const file = new File([blob], `assistant-asset-${Date.now()}.png`, { type: blob.type || "image/png" });
      const uploaded = await uploadFile(file);
      const asset = await createUserAsset({
        title: String(meta?.prompt || item.revisedPrompt || "AI 助手图片").slice(0, 120),
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
      });
      setLibraryAssets((current) => [asset, ...current.filter((entry) => entry.id !== asset.id)]);
      libraryAssetsLoadedRef.current = false;
      notificationService.success("已收藏到我的资产");
    } catch (caught) {
      notificationService.error(caught?.code === "asset_exists" ? "这张图片已经在资产库中" : caught?.message || "收藏失败");
    } finally {
      setImageActionBusy("");
    }
  }, [imageActionBusy]);
  const requestPublishImage = useCallback((item, meta) => {
    setSelectedImage(null);
    setShareTarget({ item, meta: meta || {} });
  }, []);
  const requestDeleteImage = useCallback((item, meta) => {
    setSelectedImage(null);
    setImageDeleteTarget({ item, meta: meta || {} });
  }, []);
  const confirmDeleteImage = useCallback(async () => {
    const target = imageDeleteTarget;
    const messageId = target?.meta?.messageId;
    const imageId = target?.item?.id || target?.item?.fileKey;
    if (!messageId || !imageId || imageDeleteBusy || !activeConversation) return;
    setImageDeleteBusy(true);
    try {
      const result = await deleteAssistantMessageImage(messageId, imageId);
      patchConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        updatedAt: new Date().toISOString(),
        messages: result?.messageDeleted
          ? conversation.messages.filter((message) => message.id !== messageId)
          : conversation.messages.map((message) => message.id === messageId
            ? { ...message, images: (message.images || []).filter((image) => String(image.id || image.fileKey) !== String(imageId)) }
            : message),
      }));
      setImageDeleteTarget(null);
      notificationService.success("图片已删除");
    } catch (caught) {
      notificationService.error(caught?.message || "删除图片失败");
    } finally {
      setImageDeleteBusy(false);
    }
  }, [activeConversation, imageDeleteBusy, imageDeleteTarget, patchConversation]);
  const submitAssistantShare = useCallback(async (options) => {
    const runId = shareTarget?.meta?.runId;
    if (!runId || shareSubmitting) return;
    setShareSubmitting(true);
    try {
      await submitShareItem({ taskId: runId, ...options });
      notificationService.success("已提交到社区审核");
      setShareTarget(null);
    } catch (caught) {
      notificationService.error(caught?.message || "发布失败");
    } finally {
      setShareSubmitting(false);
    }
  }, [shareSubmitting, shareTarget]);
  const markImageLoaded = useCallback((messageId, index) => {
    const key = `${messageId}-${index}`;
    setLoadedImages((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setFailedImages((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    if (atBottomRef.current || returningRef.current) {
      window.requestAnimationFrame(() => {
        const scroller = messageScrollerRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }
  }, []);

  const markImageFailed = useCallback((messageId, index) => {
    const key = `${messageId}-${index}`;
    setFailedImages((current) => new Set(current).add(key));
    setLoadedImages((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const retryImage = useCallback((messageId, index) => {
    const key = `${messageId}-${index}`;
    setFailedImages((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setImageRetryVersions((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
  }, []);

  const setConversationRun = useCallback((conversationId, run) => {
    if (!conversationId || run?.status !== "running") return;
    setActiveRuns((current) => ({ ...current, [conversationId]: run }));
  }, []);

  const clearConversationRun = useCallback((conversationId, runId = "") => {
    if (!conversationId) return;
    setActiveRuns((current) => {
      if (!current[conversationId]) return current;
      if (runId && current[conversationId]?.id !== runId) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const upsertQueuedRun = useCallback((run) => {
    if (!run?.id || run.status !== "queued") return;
    setQueuedRuns((current) => {
      const next = current.filter((item) => item.id !== run.id);
      next.push(run);
      return next;
    });
  }, []);

  const removeQueuedRun = useCallback((runId) => {
    if (!runId) return;
    setQueuedRuns((current) => current.filter((item) => item.id !== runId));
  }, []);

  const setScrollState = useCallback((atBottom, returning = returningRef.current) => {
    if (atBottomRef.current === atBottom && returningRef.current === returning) return;
    atBottomRef.current = atBottom;
    returningRef.current = returning;
    setIsAtBottom(atBottom);
    setIsReturningToBottom(returning);
  }, []);

  const scrollToBottom = useCallback((behavior = "auto") => {
    window.clearTimeout(returnBottomTimerRef.current);
    setScrollState(true, true);
    window.requestAnimationFrame(() => {
      const scroller = messageScrollerRef.current;
      if (!scroller) {
        setScrollState(true, false);
        return;
      }
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      if (behavior === "smooth") {
        returnBottomTimerRef.current = window.setTimeout(() => setScrollState(true, false), 700);
      } else {
        window.requestAnimationFrame(() => setScrollState(true, false));
      }
    });
  }, [setScrollState]);

  const followConversationBottom = useCallback(() => {
    if (atBottomRef.current || returningRef.current) scrollToBottom();
  }, [scrollToBottom]);

  const refreshNavigatorOffsets = useCallback(() => {
    const scroller = messageScrollerRef.current;
    if (!scroller) {
      navigatorMessageOffsetsRef.current = [];
      return;
    }
    navigatorMessageOffsetsRef.current = Array.from(scroller.querySelectorAll(".message[data-turn-id]"), (element) => ({
      top: element.offsetTop,
      turnId: element.dataset.turnId || "",
    }));
  }, []);

  const updateMessageScrollState = useCallback(() => {
    const scroller = messageScrollerRef.current;
    if (!scroller) return;
    const scrollHeight = scroller.scrollHeight;
    const scrollTop = scroller.scrollTop;
    const clientHeight = scroller.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = atBottomRef.current ? distanceFromBottom <= 80 : distanceFromBottom <= 24;
    const leftBottom = atBottomRef.current && !atBottom;
    setScrollState(atBottom, atBottom ? false : returningRef.current);
    if (leftBottom) {
      setCreationMenuOpen(false);
      setModelMenuOpen(false);
      setReasoningMenuOpen(false);
      setPreferencesOpen(false);
    }
    const now = performance.now();
    if (
      scrollTop <= 36
      && hiddenMessageCount > 0
      && !loadingEarlierRef.current
      && now - loadEarlierAtRef.current >= LOAD_EARLIER_COOLDOWN_MS
    ) {
      loadingEarlierRef.current = true;
      loadEarlierAtRef.current = now;
      pendingEarlierScrollHeightRef.current = scrollHeight;
      setVisibleMessageLimit((current) => Math.min(messages.length, current + MESSAGE_BATCH_SIZE));
    }
    const target = scrollTop + clientHeight * 0.28;
    const activeTurn = closestNavigatorTurn(navigatorMessageOffsetsRef.current, target, navigatorItems[0]?.id || "");
    navigatorActiveSetterRef.current(activeTurn);
  }, [hiddenMessageCount, messages.length, navigatorItems, setScrollState]);

  const handleMessageScroll = useCallback(() => {
    if (messageScrollFrameRef.current) return;
    messageScrollFrameRef.current = window.requestAnimationFrame(() => {
      messageScrollFrameRef.current = 0;
      updateMessageScrollState();
    });
  }, [updateMessageScrollState]);

  useLayoutEffect(() => {
    const scroller = messageScrollerRef.current;
    const turns = scroller?.querySelector(".message-turns");
    if (!scroller || !turns) {
      navigatorMessageOffsetsRef.current = [];
      loadingEarlierRef.current = false;
      return undefined;
    }
    const previousHeight = pendingEarlierScrollHeightRef.current;
    if (previousHeight) {
      scroller.scrollTop += scroller.scrollHeight - previousHeight;
      pendingEarlierScrollHeightRef.current = 0;
      loadingEarlierRef.current = false;
    }
    refreshNavigatorOffsets();
    const scheduleRefresh = () => {
      window.cancelAnimationFrame(navigatorMeasureFrameRef.current);
      navigatorMeasureFrameRef.current = window.requestAnimationFrame(refreshNavigatorOffsets);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRefresh);
    observer?.observe(turns);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(navigatorMeasureFrameRef.current);
      navigatorMeasureFrameRef.current = 0;
    };
  }, [activeId, firstRenderedMessageIndex, hiddenQueuedMessageIds, loading, refreshNavigatorOffsets, renderedMessages.length]);

  const scrollToMessage = useCallback((messageId, behavior = "smooth") => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const requiredCount = messages.length - index;
    if (index < firstRenderedMessageIndex) setVisibleMessageLimit(Math.min(messages.length, Math.ceil(requiredCount / MESSAGE_BATCH_SIZE) * MESSAGE_BATCH_SIZE));
    navigatorActiveSetterRef.current(messageId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const scroller = messageScrollerRef.current;
      const target = scroller?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!scroller || !target) return;
      const top = Math.max(0, target.offsetTop - scroller.clientHeight * 0.18);
      if (behavior === "auto" || behavior === "instant") {
        scroller.scrollTop = top;
        return;
      }
      scroller.scrollTo({ top, behavior: "smooth" });
    }));
  }, [firstRenderedMessageIndex, messages]);

  const jumpToThreadHit = useCallback((direction) => {
    if (!threadSearchHits.length) return;
    const count = threadSearchHits.length;
    const next = direction < 0
      ? (threadHitIndex < 0 ? count - 1 : threadHitIndex - 1)
      : threadHitIndex + 1;
    const index = ((next % count) + count) % count;
    setThreadHitIndex(index);
    scrollToMessage(threadSearchHits[index].id);
  }, [scrollToMessage, threadHitIndex, threadSearchHits]);

  useEffect(() => {
    const query = threadSearch.trim();
    if (!query) {
      setThreadHitIndex(-1);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const hits = messagesRef.current.filter((message) => messageSearchText(message).toLowerCase().includes(query.toLowerCase()));
      if (!hits.length) {
        setThreadHitIndex(-1);
        return;
      }
      setThreadHitIndex(0);
      scrollToMessage(hits[0].id);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [scrollToMessage, threadSearch]);

  useEffect(() => {
    setVisibleMessageLimit(MESSAGE_BATCH_SIZE);
    setThreadSearch("");
    setThreadHitIndex(-1);
    if (loading || !activeId) return;
    scrollToBottom();
  }, [activeId, loading, scrollToBottom]);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    if (composerInputHeightRef.current > 0) return;
    const compact = messages.length > 0 && !isAtBottom && !isReturningToBottom;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, compact ? 36 : 168)}px`;
  }, [draft, isAtBottom, isReturningToBottom, messages.length]);

  const getComposerInputHeightBounds = useCallback(() => {
    const zone = composerZoneRef.current;
    const input = textareaRef.current;
    const main = zone?.closest(".assistant-main");
    const inputHeight = input?.getBoundingClientRect().height || 56;
    const zoneHeight = zone?.getBoundingClientRect().height || 168;
    const mainHeight = main?.getBoundingClientRect().height || window.innerHeight;
    const minimum = 56;
    const mobile = window.innerWidth <= 640;
    const preferredMaximum = Math.min(mobile ? 280 : 420, mainHeight * (mobile ? 0.42 : 0.52));
    const nonInputHeight = Math.max(96, zoneHeight - inputHeight);
    const readableMessageHeight = mobile ? 160 : 220;
    const availableMaximum = mainHeight - nonInputHeight - readableMessageHeight;
    return {
      minimum,
      maximum: Math.max(minimum, Math.floor(Math.min(preferredMaximum, availableMaximum))),
    };
  }, []);

  const applyComposerInputHeight = useCallback((value) => {
    const composer = composerRef.current;
    if (!composer) return 0;
    const { minimum, maximum } = getComposerInputHeightBounds();
    const next = Math.round(Math.min(maximum, Math.max(minimum, Number(value) || minimum)));
    composerInputHeightRef.current = next;
    composer.style.setProperty("--assistant-composer-input-height", `${next}px`);
    return next;
  }, [getComposerInputHeightBounds]);

  const startComposerResize = useCallback((event) => {
    if (event.button !== 0 || !textareaRef.current || !composerRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const startHeight = applyComposerInputHeight(
      composerInputHeightRef.current || textareaRef.current.getBoundingClientRect().height,
    );
    composerResizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      followBottom: atBottomRef.current || returningRef.current,
    };
    composerRef.current.classList.add("is-manually-resized", "is-resizing");
    setComposerManuallyResized(true);
    setComposerResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add("assistant-composer-resizing");
  }, [applyComposerInputHeight]);

  const moveComposerResize = useCallback((event) => {
    const state = composerResizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyComposerInputHeight(state.startHeight + state.startY - event.clientY);
  }, [applyComposerInputHeight]);

  const finishComposerResize = useCallback((event) => {
    const state = composerResizeStateRef.current;
    if (!state || (event?.pointerId !== undefined && state.pointerId !== event.pointerId)) return;
    composerResizeStateRef.current = null;
    composerRef.current?.classList.remove("is-resizing");
    setComposerResizing(false);
    document.documentElement.classList.remove("assistant-composer-resizing");
    if (event?.currentTarget?.hasPointerCapture?.(state.pointerId)) {
      event.currentTarget.releasePointerCapture(state.pointerId);
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const resetComposerInputHeight = useCallback(() => {
    composerResizeStateRef.current = null;
    composerInputHeightRef.current = 0;
    composerRef.current?.style.removeProperty("--assistant-composer-input-height");
    composerRef.current?.classList.remove("is-manually-resized", "is-resizing");
    setComposerManuallyResized(false);
    setComposerResizing(false);
    document.documentElement.classList.remove("assistant-composer-resizing");
    window.requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
      input.focus({ preventScroll: true });
    });
  }, []);

  const resizeComposerFromKeyboard = useCallback((event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const { minimum, maximum } = getComposerInputHeightBounds();
    const current = composerInputHeightRef.current || textareaRef.current?.getBoundingClientRect().height || minimum;
    const next = event.key === "Home"
      ? minimum
      : event.key === "End"
        ? maximum
        : current + (event.key === "ArrowUp" ? 16 : -16);
    composerRef.current?.classList.add("is-manually-resized");
    setComposerManuallyResized(true);
    applyComposerInputHeight(next);
  }, [applyComposerInputHeight, getComposerInputHeightBounds]);

  useLayoutEffect(() => {
    const zone = composerZoneRef.current;
    const workspace = zone?.closest(".assistant-workspace");
    if (!zone || !workspace) return undefined;
    let frame = 0;
    let previousHeight = 0;
    const syncReservedSpace = () => {
      const height = Math.ceil(zone.getBoundingClientRect().height);
      if (!height) return;
      const next = Math.max(250, height + 32);
      const reserved = (!atBottomRef.current && !returningRef.current)
        ? Math.max(previousHeight || next, next)
        : next;
      if (reserved === previousHeight) return;
      previousHeight = reserved;
      workspace.style.setProperty("--assistant-composer-reserved-space", `${reserved}px`);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const resizeState = composerResizeStateRef.current;
        if (!atBottomRef.current && !returningRef.current && !resizeState?.followBottom) return;
        const scroller = messageScrollerRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    };
    syncReservedSpace();
    const observer = new ResizeObserver(syncReservedSpace);
    observer.observe(zone);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      workspace.style.removeProperty("--assistant-composer-reserved-space");
      document.documentElement.classList.remove("assistant-composer-resizing");
    };
  }, []);

  useEffect(() => {
    if (!composerManuallyResized) return undefined;
    const clampHeight = () => applyComposerInputHeight(composerInputHeightRef.current);
    window.addEventListener("resize", clampHeight, { passive: true });
    clampHeight();
    return () => window.removeEventListener("resize", clampHeight);
  }, [applyComposerInputHeight, composerManuallyResized, documents.length, references.length, uploading]);

  const loadWorkspace = useCallback(async () => {
    const controller = new AbortController();
    workspaceControllerRef.current?.abort();
    workspaceControllerRef.current = controller;
    const composerScopeChanged = composerWorkspaceScopeRef.current !== workspaceScope;
    if (composerScopeChanged) {
      workspaceHydratedRef.current = false;
      composerWorkspaceScopeRef.current = workspaceScope;
      conversationDraftsRef.current.clear();
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
      setUploading(false);
      setReferences([]);
      setDocuments([]);
      setQuotedMessage(null);
    }
    setLoading(true);
    setServiceError("");
    try {
      const signedIn = auth.isAuthenticated;
      const [configResult, conversationResult, runResult] = await Promise.allSettled([
        fetchAssistantConfig(controller.signal),
        signedIn
          ? listAssistantConversations({ signal: controller.signal })
          : Promise.resolve([]),
        signedIn
          ? listActiveAssistantRuns({ signal: controller.signal })
          : Promise.resolve([]),
      ]);
      if (controller.signal.aborted || !mountedRef.current) return;
      if (configResult.status !== "fulfilled") throw configResult.reason;
      const config = normalizeConfig(configResult.value);
      setConversationModels(config.conversationModels);
      setImageModels(config.imageModels);
      setEditableFilesEnabled(config.editableFilesEnabled);
      setConversationModel(config.conversationModels[0]?.model || "");
      setImageModel(config.imageModels[0]?.model || "");
      const workspaceState = loadAssistantWorkspaceState(workspaceScope);
      let rows = conversationResult.status === "fulfilled"
        ? conversationResult.value.map(normalizeConversation)
        : [];
      if (signedIn && !rows.length && conversationResult.status === "fulfilled") {
        const legacy = await loadAssistantHistory(workspaceScope);
        if (legacy.length) {
          const prepared = await prepareLegacyConversations(legacy, controller.signal);
          await importAssistantConversations(prepared, { signal: controller.signal });
          await clearAssistantHistory(workspaceScope);
          rows = (await listAssistantConversations({ signal: controller.signal })).map(normalizeConversation);
          notificationService.success("旧对话已迁移到云端");
        }
      }
      if (controller.signal.aborted || !mountedRef.current) return;
      setConversations(rows);
      const requestedId = requestedConversationId();
      const nextActiveId = rows.some((item) => item.id === requestedId)
        ? requestedId
        : rows.some((item) => item.id === workspaceState.activeId)
          ? workspaceState.activeId
          : rows.find((item) => item.messages.length)?.id || "";
      setActiveId(nextActiveId);
      setPinnedIds(Array.isArray(workspaceState.pinnedIds) ? workspaceState.pinnedIds.filter((id) => rows.some((item) => item.id === id)) : []);
      if (typeof workspaceState.draft === "string") {
        const restoredDraft = workspaceState.draft.slice(0, 12000);
        const savedDraftConversationId = rows.some((item) => item.id === workspaceState.activeId)
          ? workspaceState.activeId
          : nextActiveId;
        if (savedDraftConversationId) conversationDraftsRef.current.set(savedDraftConversationId, restoredDraft);
        setDraft(savedDraftConversationId === nextActiveId ? restoredDraft : "");
      } else if (composerScopeChanged) {
        setDraft("");
      }
      if (CREATION_TYPES.some((item) => item.id === workspaceState.creationType)) setCreationType(workspaceState.creationType);
      if (IMAGE_ASPECT_RATIOS.includes(workspaceState.generationRatio)) setGenerationRatio(workspaceState.generationRatio);
      if (RESOLUTIONS.some((item) => item.id === String(workspaceState.generationResolution || "").toUpperCase())) setGenerationResolution(String(workspaceState.generationResolution).toUpperCase());
      if (IMAGE_QUALITY_OPTIONS.some((item) => item.id === String(workspaceState.generationQuality || "").toLowerCase())) setGenerationQuality(String(workspaceState.generationQuality).toLowerCase());
      if (Number.isFinite(Number(workspaceState.generationCount))) setGenerationCount(clampImageCount(workspaceState.generationCount, config.imageModels.find((item) => item.model === (workspaceState.creationType === "image" ? workspaceState.generationModel : "")) || config.imageModels[0]));
      const savedModel = String(workspaceState.generationModel || "").trim();
      if (workspaceState.creationType === "image" && config.imageModels.some((item) => item.model === savedModel)) setImageModel(savedModel);
      if (workspaceState.creationType !== "image" && config.conversationModels.some((item) => item.model === savedModel)) setConversationModel(savedModel);
      setReasoningEffort(String(workspaceState.reasoningEffort || "").trim().toLowerCase());
      const pending = takePendingPrompt("assistant");
      if (pending) {
        pendingLaunchRef.current = pending;
        setActiveId("");
        setDraft(composePendingLaunchPrompt(pending, 12000));
        const pendingSkill = String(pending.config?.mode || pending.config?.skill || "").trim();
        const pendingMode = pendingSkill === "image" || pendingSkill === "chat" || pendingSkill === "agent"
          ? pendingSkill
          : "agent";
        setCreationType(pendingMode);
        if (pending.config?.reasoningEffort) {
          setReasoningEffort(String(pending.config.reasoningEffort).trim().toLowerCase());
        }
        if (IMAGE_ASPECT_RATIOS.includes(pending.config?.ratio)) setGenerationRatio(pending.config.ratio);
        if (RESOLUTIONS.some((item) => item.id === String(pending.config?.resolution || "").toUpperCase())) {
          setGenerationResolution(String(pending.config.resolution).toUpperCase());
        }
        if (Number.isFinite(Number(pending.config?.count))) {
          setGenerationCount(clampImageCount(pending.config.count, config.imageModels.find((item) => item.model === pending.config?.model) || config.imageModels[0]));
        }
        if (Array.isArray(pending.config?.referenceImages)) setReferences(pending.config.referenceImages.slice(0, MAX_MODEL_REFERENCE_IMAGES));
        if (pending.config?.model) {
          if (pendingMode === "image") setImageModel(pending.config.model);
          else setConversationModel(pending.config.model);
        }
      }
      if (runResult.status === "fulfilled" && runResult.value.length) {
        const runs = runResult.value.filter((item) => rows.some((conversation) => conversation.id === item.conversationId));
        const running = runs.filter((run) => run.status === "running");
        setActiveRuns(Object.fromEntries(running.map((run) => [run.conversationId, run])));
        setQueuedRuns(runs.filter((run) => run.status === "queued"));
        setResumeCandidates(running);
      }
      workspaceHydratedRef.current = true;
    } catch (error) {
      if (error?.name !== "AbortError") setServiceError(error?.message || "AI 服务尚未配置");
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false);
    }
  }, [auth.isAuthenticated, workspaceScope]);

  useEffect(() => {
    mountedRef.current = true;
    void import("../../views/StudioHubView.jsx");
    try {
      setSidebarCollapsed(localStorage.getItem("starclouds:assistant-sidebar-collapsed") === "true");
    } catch {
      // Ignore unavailable local storage.
    }
    void loadWorkspace();
    return () => {
      mountedRef.current = false;
      workspaceControllerRef.current?.abort();
      draftRequestControllerRef.current?.abort();
      for (const controller of runControllersRef.current.values()) controller.abort();
      runControllersRef.current.clear();
      uploadControllerRef.current?.abort();
      costControllerRef.current?.abort();
      costResolverRef.current?.(false);
      costResolverRef.current = null;
      window.clearTimeout(returnBottomTimerRef.current);
      window.clearTimeout(sidebarMotionTimerRef.current);
      if (messageScrollFrameRef.current) {
        window.cancelAnimationFrame(messageScrollFrameRef.current);
        messageScrollFrameRef.current = 0;
      }
      recognitionRef.current?.abort?.();
      document.documentElement.classList.remove("assistant-image-viewer-open");
    };
  }, [loadWorkspace]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return undefined;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.onstart = () => {
      if (!mountedRef.current) return;
      if (!voiceIntentRef.current) {
        try { recognition.abort(); } catch { /* already stopping */ }
        setVoiceListening(false);
        return;
      }
      setVoiceListening(true);
    };
    recognition.onend = () => {
      voiceIntentRef.current = false;
      if (mountedRef.current) setVoiceListening(false);
    };
    recognition.onerror = (event) => {
      if (!mountedRef.current) return;
      if (event?.error === "aborted") return;
      voiceIntentRef.current = false;
      setVoiceListening(false);
      if (event?.error === "no-speech") return;
      notificationService.warning(event?.error === "not-allowed" ? "请允许使用麦克风后再试" : "语音识别暂时不可用");
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript || "";
      }
      if (!mountedRef.current || !transcript) return;
      const base = String(voiceBaseDraftRef.current || "").trim();
      setDraft(base && transcript ? `${base}\n${transcript}` : transcript || base);
    };
    recognitionRef.current = recognition;
    setVoiceSupported(true);
    return () => {
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort?.();
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeRun) return;
    voiceIntentRef.current = false;
    recognitionRef.current?.abort?.();
    setVoiceListening(false);
  }, [activeRun]);

  useEffect(() => {
    const ids = (selectedConversationModel?.reasoningEfforts || []).map((item) => item.id);
    if (!ids.length || ids.includes(reasoningEffort)) return;
    setReasoningEffort(defaultReasoningEffort(selectedConversationModel));
  }, [reasoningEffort, selectedConversationModel]);

  useEffect(() => {
    setGenerationCount((current) => clampImageCount(current, selectedImageModel));
  }, [selectedImageModel]);

  useEffect(() => {
    if (!workspaceHydratedRef.current || loading) return;
    saveAssistantWorkspaceState(workspaceScope, {
      activeId,
      draft,
      mode,
      creationType,
      generationRatio,
      generationModel,
      reasoningEffort: activeReasoningEffort,
      generationResolution,
      generationQuality,
      generationCount,
      pinnedIds,
    });
    syncConversationUrl(activeId);
  }, [activeId, activeReasoningEffort, creationType, draft, generationCount, generationModel, generationQuality, generationRatio, generationResolution, loading, mode, pinnedIds, workspaceScope]);

  useEffect(() => {
    const handleKeydown = (event) => {
      if (event.key !== "Escape" || selectedImage) return;
      if (editingMessageId) {
        cancelUserMessageEdit();
        return;
      }
      if (renamingId) {
        if (!renameSaving) {
          setRenamingId("");
          setRenameDraft("");
        }
        return;
      }
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (creationMenuOpen || modelMenuOpen || reasoningMenuOpen || preferencesOpen || activeMessageMenuId) {
        setCreationMenuOpen(false);
        setModelMenuOpen(false);
        setReasoningMenuOpen(false);
        setModelSearch("");
        setPreferencesOpen(false);
        setActiveMessageMenuId("");
      } else if (assetLibraryOpen) setAssetLibraryOpen(false);
      else if (stopConfirmOpen) setStopConfirmOpen(false);
      else if (deleteTarget) setDeleteTarget(null);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeMessageMenuId, assetLibraryOpen, creationMenuOpen, deleteTarget, editingMessageId, modelMenuOpen, preferencesOpen, reasoningMenuOpen, renameSaving, renamingId, searchOpen, selectedImage, stopConfirmOpen]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const query = searchQuery.trim().toLowerCase();
    const results = query
      ? listableConversations.filter((item) => `${item.title} ${(item.messages || []).map((message) => message.content).join(" ")}`.toLowerCase().includes(query))
      : listableConversations;
    const index = query ? 0 : results.findIndex((item) => item.id === activeId);
    setSearchCursor(results.length ? (index >= 0 ? index : 0) : -1);
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [listableConversations, searchOpen, searchQuery]);

  useEffect(() => {
    if (!renamingId) return undefined;
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [renamingId]);

  useEffect(() => {
    if (!activeRun) setStopConfirmOpen(false);
  }, [activeRun]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (assetLibraryOpen) {
      if (!assetLibraryMounted) {
        setAssetLibraryMounted(true);
        return undefined;
      }
      if (reduced) {
        setAssetLibraryEntered(true);
        return undefined;
      }
      let frameTwo = 0;
      const frameOne = window.requestAnimationFrame(() => {
        frameTwo = window.requestAnimationFrame(() => setAssetLibraryEntered(true));
      });
      return () => {
        window.cancelAnimationFrame(frameOne);
        window.cancelAnimationFrame(frameTwo);
      };
    }
    setAssetLibraryEntered(false);
    if (!assetLibraryMounted) return undefined;
    const timer = window.setTimeout(() => setAssetLibraryMounted(false), reduced ? 0 : ASSET_LIBRARY_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [assetLibraryMounted, assetLibraryOpen]);

  useEffect(() => {
    libraryAssetsLoadedRef.current = false;
    libraryCursorRef.current = "";
    setLibraryAssets([]);
    setAssetRenderLimit(ASSET_GRID_RENDER_SIZE);
  }, [workspaceScope]);

  useEffect(() => {
    setAssetRenderLimit(ASSET_GRID_RENDER_SIZE);
  }, [assetSearch, assetTab]);

  useEffect(() => {
    if (!assetLibraryOpen || !auth.isAuthenticated || libraryAssetsLoadedRef.current) return;
    const controller = new AbortController();
    setLibraryAssetsLoading(true);
    (async () => {
      try {
        const page = await listUserAssets({ limit: ASSET_LIBRARY_PAGE_SIZE, groupId: "all", signal: controller.signal });
        if (controller.signal.aborted || !mountedRef.current) return;
        setLibraryAssets(page.items || []);
        libraryCursorRef.current = page.nextCursor || "";
        libraryAssetsLoadedRef.current = true;
      } catch (error) {
        if (error?.name !== "AbortError") notificationService.error(error?.message || "我的资产读取失败");
      } finally {
        if (!controller.signal.aborted && mountedRef.current) setLibraryAssetsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [assetLibraryOpen, auth.isAuthenticated, workspaceScope]);

  useEffect(() => {
    if (!availableResolutions.length) {
      if (generationResolution) setGenerationResolution("");
    } else if (!availableResolutions.some((item) => item.id === generationResolution)) {
      setGenerationResolution(availableResolutions[0].id);
    }
  }, [availableResolutions, generationResolution]);

  useEffect(() => {
    if (!availableQualities.length) {
      if (generationQuality) setGenerationQuality("");
    } else if (!availableQualities.some((item) => item.id === generationQuality)) {
      setGenerationQuality(availableQualities[0].id);
    }
  }, [availableQualities, generationQuality]);

  useEffect(() => {
    if (!availableRatios.length) return;
    if (!availableRatios.some((item) => item.id === generationRatio)) {
      setGenerationRatio(availableRatios[0].id);
    }
  }, [availableRatios, generationRatio]);

  const pendingDocumentKey = documents
    .filter((item) => item.status === "queued" || item.status === "processing")
    .map((item) => `${item.id}:${item.status}`)
    .join("|");

  useEffect(() => {
    if (!pendingDocumentKey) return undefined;
    const controller = new AbortController();
    const ids = pendingDocumentKey.split("|").map((item) => item.split(":", 1)[0]).filter(Boolean);
    const poll = async () => {
      try {
        const updates = await Promise.all(ids.map((id) => getAssistantFile(id, { signal: controller.signal }).catch((error) => {
          if (error?.name === "AbortError") throw error;
          return null;
        })));
        if (controller.signal.aborted || !mountedRef.current) return;
        const byId = new Map(updates.filter(Boolean).map((item) => [item.id, item]));
        if (byId.size) {
          setDocuments((current) => current.map((item) => byId.get(item.id) || item));
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          // A transient status read is retried by the next interval.
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [pendingDocumentKey]);

  useEffect(() => {
    setReferences((current) => (current.length > maxReferences ? current.slice(0, Math.max(0, maxReferences)) : current));
  }, [maxReferences]);

  const updateSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    setConversationPeek(null);
    try { localStorage.setItem("starclouds:assistant-sidebar-collapsed", String(next)); } catch { /* ignore */ }
    window.clearTimeout(sidebarMotionTimerRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSidebarAnimating(false);
      return;
    }
    setSidebarAnimating(true);
    sidebarMotionTimerRef.current = window.setTimeout(() => setSidebarAnimating(false), SIDEBAR_MOTION_MS);
  };

  const startAssistantTour = () => {
    setCreationMenuOpen(false);
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
    setPreferencesOpen(false);
    setAssetLibraryOpen(false);
    setSearchOpen(false);
    const expandSidebar = sidebarCollapsed && window.matchMedia("(min-width: 641px)").matches;
    if (expandSidebar) updateSidebar();
    window.setTimeout(() => setTourOpen(true), expandSidebar ? 240 : 0);
  };

  useEffect(() => {
    if (loading) return undefined;
    if (searchParams.get("guide") === "1") {
      const next = new URLSearchParams(searchParams);
      next.delete("guide");
      setSearchParams(next, { replace: true });
    }
    if (!isProductGuidesEnabled() || tourStartedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      tourStartedRef.current = true;
      startAssistantTour();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loading, searchParams, setSearchParams]);

  const startAssistantTourRef = useRef(startAssistantTour);
  startAssistantTourRef.current = startAssistantTour;
  useEffect(() => subscribeProductGuideReplay(() => {
    tourStartedRef.current = true;
    startAssistantTourRef.current();
  }), []);

  const closeSearch = () => {
    setSearchOpen(false);
  };

  const handleSearchExited = () => {
    setSearchQuery("");
    setSearchCursor(-1);
  };

  const selectConversation = (nextConversationId, { forceReset = false, preserveCurrentDraft = true, restoreDraft = true } = {}) => {
    const nextId = String(nextConversationId || "");
    if (!forceReset && nextId === activeId) {
      setConversationPeek(null);
      setConversationMenuId("");
      return;
    }
    if (activeId) {
      if (preserveCurrentDraft && !queueEditingId) conversationDraftsRef.current.set(activeId, draftRef.current);
      else if (!preserveCurrentDraft) conversationDraftsRef.current.delete(activeId);
    }

    draftRequestControllerRef.current?.abort();
    draftRequestControllerRef.current = null;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    costControllerRef.current?.abort();
    costControllerRef.current = null;
    const resolvePendingCost = costResolverRef.current;
    costResolverRef.current = null;
    resolvePendingCost?.(false);
    setCostPayload(null);
    voiceIntentRef.current = false;
    recognitionRef.current?.abort?.();
    pendingLaunchRef.current = null;

    for (const item of documents) {
      if (!item.retained) void deleteAssistantFile(item.id).catch(() => undefined);
    }
    setActiveId(nextId);
    setDraft(restoreDraft && nextId ? String(conversationDraftsRef.current.get(nextId) || "") : "");
    setReferences([]);
    setDocuments([]);
    setQuotedMessage(null);
    setUploading(false);
    setVoiceListening(false);
    setQueueEditingId("");
    setEditingMessageId("");
    setEditingMessageDraft("");
    setExpandedStatusId("");
    setActiveMessageMenuId("");
    setThreadSearch("");
    setThreadHitIndex(-1);
    setVisibleMessageLimit(MESSAGE_BATCH_SIZE);
    setConversationPeek(null);
    setConversationMenuId("");
  };

  const openConversation = (conversation) => {
    closeSearch();
    selectConversation(conversation.id);
  };

  const startRename = (conversation) => {
    setConversationMenuId("");
    setRenameSaving(false);
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingId("");
    setRenameDraft("");
  };

  const commitRename = async () => {
    if (!renamingId || renameSaving) return;
    const conversation = conversations.find((item) => item.id === renamingId);
    const title = renameDraft.trim();
    if (!title || title === conversation?.title) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      const updated = await patchAssistantConversation(renamingId, { title });
      patchConversation(renamingId, (item) => ({ ...item, title: updated?.title || title, updatedAt: updated?.updatedAt || item.updatedAt }));
      setRenamingId("");
      setRenameDraft("");
    } catch (error) {
      notificationService.error(error?.message || "重命名失败");
    } finally {
      setRenameSaving(false);
    }
  };

  const togglePinned = (conversation) => {
    setConversationMenuId("");
    setPinnedIds((current) => current.includes(conversation.id)
      ? current.filter((id) => id !== conversation.id)
      : [conversation.id, ...current]);
  };

  const newConversation = () => {
    closeSearch();
    selectConversation("", { forceReset: true, restoreDraft: false });
    setCreationType("chat");
    setCreationMenuOpen(false);
    setModelMenuOpen(false);
    setPreferencesOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const swallowComposerMenuClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const toggleComposerMenu = (event, menu) => {
    event.preventDefault();
    event.stopPropagation();
    setCreationMenuOpen(menu === "creation" ? !creationMenuOpen : false);
    setModelMenuOpen(menu === "model" ? !modelMenuOpen : false);
    setReasoningMenuOpen(menu === "reasoning" ? !reasoningMenuOpen : false);
    setPreferencesOpen(menu === "preferences" ? !preferencesOpen : false);
  };

  const updatePreferencesPosition = useCallback(() => {
    const trigger = imageSettingsButtonRef.current;
    const composer = composerRef.current;
    if (!trigger || !composer) return;
    const triggerRect = trigger.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const width = Math.min(428, Math.max(240, composerRect.width - margin * 2));
    let left = triggerRect.left - composerRect.left;
    if (left + width > composerRect.width - margin) {
      left = composerRect.width - width - margin;
    }
    left = Math.max(margin, left);
    const bottom = Math.max(gap, composerRect.bottom - triggerRect.top + gap);
    const maxHeight = Math.max(200, Math.min(620, triggerRect.top - gap - margin));
    setPreferencesPosition({
      left: `${Math.round(left)}px`,
      bottom: `${Math.round(bottom)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
    });
  }, []);

  useLayoutEffect(() => {
    if (!preferencesOpen || mode !== "image") {
      setPreferencesPosition(null);
      return undefined;
    }
    updatePreferencesPosition();
    const onReposition = () => updatePreferencesPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    const scroller = messageScrollerRef.current;
    scroller?.addEventListener("scroll", onReposition, { passive: true });
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      scroller?.removeEventListener("scroll", onReposition);
    };
  }, [mode, preferencesOpen, updatePreferencesPosition]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const handleSearchKey = (event) => {
      if (event.isComposing || renamingId) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSearchCursor((current) => {
          if (!searchResults.length) return -1;
          const next = current + delta;
          if (next < 0) return searchResults.length - 1;
          if (next >= searchResults.length) return 0;
          return next;
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        const item = searchResults[searchCursor];
        if (!item) return;
        event.preventDefault();
        openConversation(item);
      }
    };
    window.addEventListener("keydown", handleSearchKey);
    return () => window.removeEventListener("keydown", handleSearchKey);
  }, [openConversation, renamingId, searchCursor, searchOpen, searchResults]);

  const notifyReferenceLimit = () => {
    notificationService.warning(referenceLimitMessage);
  };

  const uploadReferences = async (files) => {
    const selected = Array.from(files || []);
    const psdFiles = selected.filter(isPSDFile);
    if (psdFiles.length) notificationService.warning("PSD 是输出格式；请上传 JPG、PNG 或 WebP 原图后让助手制作分层 PSD");
    const supported = selected.filter((file) => !isPSDFile(file));
    const incomingImages = supported.filter((file) => isAssistantImageFile(file));
    const imageFiles = incomingImages.slice(0, Math.max(0, maxReferences - references.length));
    const documentFiles = mode === "image" ? [] : supported.filter((file) => !isAssistantImageFile(file)).slice(0, Math.max(0, 8 - documents.length));
    if (incomingImages.length && imageFiles.length < incomingImages.length) notifyReferenceLimit();
    if (!imageFiles.length && !documentFiles.length) {
      if (selected.length && mode === "image" && !incomingImages.length) notificationService.warning("图片生成模式仅支持图片附件");
      return;
    }
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;
    setUploading(true);
    try {
      const imageTask = imageFiles.length ? Promise.all(imageFiles.map(async (file) => {
        const result = await uploadFile(file, {
          signal: controller.signal,
          referenceUpload: true,
          behaviorFeature: "assistant",
        });
        return { id: uid(), name: file.name, dataUrl: result.url, thumbnailUrl: result.thumbnailUrl, fileKey: result.key };
      })).then((uploaded) => {
        if (mountedRef.current && !controller.signal.aborted) setReferences((current) => [...current, ...uploaded].slice(0, maxReferences));
      }).catch((error) => {
        if (error?.name !== "AbortError") notificationService.error(error?.message || "图片上传失败");
      }) : Promise.resolve();
      const documentTasks = documentFiles.map(async (file) => {
        try {
          const created = await uploadAssistantFile(file, { signal: controller.signal });
          if (mountedRef.current && !controller.signal.aborted) {
            setDocuments((current) => current.some((item) => item.id === created.id) ? current : [...current, created].slice(0, 8));
          }
        } catch (error) {
          if (error?.name === "AbortError") return;
          notificationService.error(error?.message || "文档上传失败");
        }
      });
      await Promise.all([imageTask, ...documentTasks]);
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        if (mountedRef.current) setUploading(false);
      }
    }
  };
  uploadReferencesRef.current = uploadReferences;

  useEffect(() => {
    const onPaste = (event) => {
      if (searchOpen || renamingId || assetLibraryOpen || selectedImage || editingMessageId || costPayload || Boolean(activeRun) || Boolean(serviceError)) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']") && !target.closest(".assistant-composer")) return;
      const files = assistantClipboardFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void uploadReferencesRef.current?.(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeRun, assetLibraryOpen, costPayload, editingMessageId, renamingId, searchOpen, selectedImage, serviceError]);

  const removeComposerDocument = (item) => {
    setDocuments((current) => current.filter((document) => document.id !== item.id));
    if (!item.retained) void deleteAssistantFile(item.id).catch(() => undefined);
  };

  const confirmAssistantCost = async (responseMode, requestedCount = 1, requestedModel = "", requestedReasoningEffort = activeReasoningEffort, { skip = false } = {}) => {
    const chatModel = conversationModels.find((item) => item.model === requestedModel) || conversationModels.find((item) => item.model === conversationModel) || conversationModels[0];
    const imagePriceModel = imageModels.find((item) => item.model === requestedModel) || selectedImageModel;
    const imageCount = clampImageCount(requestedCount, imagePriceModel, 1);
    const chatUnit = assistantReasoningPrice(chatModel, requestedReasoningEffort).effective;
    const imageUnit = Math.max(0, Number(imagePriceModel?.pricePoints || 0));
    const total = responseMode === "image" ? imageUnit * imageCount : chatUnit;
    if (!total || skip || auth.user?.requireCostConfirm === false) return true;
    const controller = new AbortController();
    costControllerRef.current?.abort();
    costControllerRef.current = controller;
    const wallet = await getWallet({ signal: controller.signal }).catch(() => null);
    if (controller.signal.aborted || !mountedRef.current) return false;
    const unit = responseMode === "image" ? imageUnit : chatUnit;
    const requestedEffortLabel = (selectedConversationModel?.reasoningEfforts || []).find((item) => item.id === requestedReasoningEffort)?.label
      || REASONING_EFFORT_LABELS[requestedReasoningEffort]
      || requestedReasoningEffort
      || "默认";
    setCostPayload({
      title: responseMode === "image" ? "确认生成费用" : "确认本轮费用",
      unit,
      count: responseMode === "image" ? imageCount : 1,
      total,
      available: wallet ? Number(wallet.normalBalanceCents ?? wallet.availableCents ?? wallet.balanceCents ?? 0) : null,
      unitLabel: responseMode === "image" ? "张" : "轮",
      featureLabel: responseMode === "image" ? "AI 助手生图" : responseMode === "agent" ? "AI 助手 Agent" : "AI 助手对话",
      summary: responseMode === "image"
        ? "提交后按图片数量预留费用；提交上游前停止会退回，提交后停止只会放弃接收结果且不退款。"
        : responseMode === "agent"
          ? `${requestedEffortLabel}推理为 ${chatUnit} 积分/轮；本轮只收 Agent 推理费用，执行生图时另行确认图片费用。主动停止不退还本轮积分。`
          : `${requestedEffortLabel}推理为 ${chatUnit} 积分/轮；成功后结算，失败自动退回。主动停止不退还本轮积分。`,
    });
    return new Promise((resolve) => { costResolverRef.current = resolve; });
  };

  const applyRunResult = useCallback((conversationId, localAssistantId, data, localUserId = "") => {
    const persisted = data?.assistantMessage;
    const persistedUser = data?.userMessage;
    const run = data?.run || {};
    const terminal = TERMINAL_RUN_STATUSES.has(run.status) || ["complete", "failed"].includes(persisted?.status);
    if (!terminal && run?.status === "running") {
      removeQueuedRun(run.id);
      setConversationRun(conversationId, run);
    } else if (!terminal && run?.status === "queued") {
      clearConversationRun(conversationId, run.id);
      upsertQueuedRun(run);
    }
    patchConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: persisted?.updatedAt || persistedUser?.updatedAt || new Date().toISOString(),
      messages: conversation.messages.map((message) => {
        if (persistedUser?.id && (message.id === localUserId || message.id === persistedUser.id)) {
          return mergePersistedAssistantMessage(message, persistedUser);
        }
        if (!assistantMessageMatchesRun(message, localAssistantId, run, persisted)) return message;
        if (message._streamTerminal === true && !terminal) return message;
        const runStatus = run.status || persisted?.status;
        const hasOtherWork = conversation.messages.some((item) => item.role === "assistant" && item.pending && !assistantMessageMatchesRun(item, localAssistantId, run, persisted));
        const nowQueued = !terminal && runStatus === "queued" && hasOtherWork;
        const wasQueued = message.statusStage === "queued";
        const mergedSnapshot = mergeAssistantMessageSnapshot(message, persisted, { authoritative: terminal });
        const nextStage = terminal
          ? persisted?.statusStage || (run.status === "canceled" ? "stopped" : undefined)
          : nowQueued
            ? "queued"
            : wasQueued && (!run?.stage || run.stage === "queued")
              ? (message.kind === "image" ? "preparing-image" : message.routing || message.kind === "agent" ? "routing" : "thinking")
              : (run?.stage && run.stage !== "queued" ? run.stage : persisted?.statusStage || message.statusStage);
        return {
          ...mergedSnapshot,
          ...(persisted ? { localOnly: false } : {}),
          id: persisted?.id || message.id,
          images: Array.isArray(persisted?.images) ? persisted.images : message.images,
          artifacts: Array.isArray(persisted?.artifacts) ? persisted.artifacts : terminal ? [] : message.artifacts,
          kind: run.resolvedMode || persisted?.kind || message.kind,
          usage: mergeAssistantUsage(message.usage, persisted?.usage, terminal ? {
            durationMs: usageStartedAtMs(message) ? Math.max(1, Date.now() - usageStartedAtMs(message)) : 0,
            outputTokens: estimateAssistantTokens(persisted?.content ?? message.content),
            inputTokens: Number(persisted?.context?.estimatedInputTokens ?? message.context?.estimatedInputTokens) || 0,
          } : {}),
          usageStartedAt: nowQueued ? 0 : wasQueued ? Date.now() : (usageStartedAtMs(message) || usageStartedAtMs(persisted) || Date.now()),
          pending: terminal ? false : ["queued", "running"].includes(runStatus),
          routing: nowQueued ? false : Boolean(persisted?.routing ?? message.routing),
          error: run?.errorMessage || persisted?.error || "",
          statusStage: nextStage,
          ...(terminal && message._streamTerminal === true ? { _streamTerminal: false } : {}),
        };
      }),
    }));
    if (conversationId === activeIdRef.current) followConversationBottom();
    if (terminal) {
      removeQueuedRun(run.id);
      clearConversationRun(conversationId, run.id);
      scheduleWalletRefresh();
    }
  }, [clearConversationRun, followConversationBottom, patchConversation, removeQueuedRun, setConversationRun, upsertQueuedRun]);

  const monitorRun = useCallback(async (conversationId, assistantMessageId, run, controller) => {
    if (!run?.id) return;
    setConversationRun(conversationId, run);
    const stream = openAssistantRunStream(run.id, {
      onEvent: (event) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        patchConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (!assistantMessageMatchesRun(message, assistantMessageId, run) || !message.pending) return message;
            let images = message.images || [];
            if (event?.image) {
              const incomingIndex = Number(event.image.index);
              const existing = images.findIndex((image, index) => Number(image.index ?? index) === incomingIndex);
              images = [...images];
              if (existing >= 0) images[existing] = { ...images[existing], ...event.image };
              else images.push(event.image);
              images.sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
            }
            const startedAt = usageStartedAtMs(message) || Date.now();
            const hasVisible = typeof event?.content === "string" && event.content.trim();
            const terminalEvent = assistantStreamEventIsTerminal(event);
            const nextContent = mergeAssistantStreamText(message.content, event?.content, { authoritative: terminalEvent });
            const nextReasoning = mergeAssistantStreamText(message.reasoning, event?.reasoning, { authoritative: terminalEvent });
            const extras = {};
            if (hasVisible) extras.firstTokenMs = Math.max(1, Date.now() - startedAt);
            if (event?.done) extras.durationMs = Math.max(1, Date.now() - startedAt);
            const usage = event?.usage || extras.firstTokenMs || extras.durationMs
              ? mergeAssistantUsage(message.usage, event?.usage, extras)
              : message.usage;
            let webSearches = Array.isArray(message.webSearches) ? message.webSearches : [];
            if (event?.tool?.name === "web_search" && event.tool.status === "completed" && event.tool.result) {
              const result = event.tool.result;
              const key = `${String(result.query || "").trim()}|${JSON.stringify(result.sources || [])}`;
              if (!webSearches.some((item) => `${String(item?.query || "").trim()}|${JSON.stringify(item?.sources || [])}` === key)) {
                webSearches = [...webSearches, result];
              }
            }
            return {
              ...message,
              usageStartedAt: startedAt,
              ...(nextContent !== message.content ? { content: nextContent } : {}),
              ...(nextReasoning !== message.reasoning ? { reasoning: nextReasoning } : {}),
              ...(event?.kind ? { kind: event.kind === "agent" ? message.kind : event.kind } : {}),
              ...(event?.stage ? { statusStage: event.stage } : {}),
              ...(event?.context ? { context: event.context } : {}),
              ...(usage ? { usage } : {}),
              ...(webSearches.length ? { webSearches } : {}),
              ...(event?.image ? { images, kind: "image", count: event.imageTotal || message.count } : {}),
              ...(terminalEvent ? { _streamTerminal: true } : {}),
            };
          }),
        }));
        if (conversationId === activeIdRef.current && (event?.image || event?.reasoning || (event?.stage && !event?.content))) followConversationBottom();
      },
    });
    try {
      const completed = await waitForAssistantRun(run.id, {
        signal: controller.signal,
        onUpdate: (update) => mountedRef.current && applyRunResult(conversationId, assistantMessageId, update),
      });
      if (mountedRef.current) applyRunResult(conversationId, assistantMessageId, completed);
    } finally {
      stream?.close();
    }
  }, [applyRunResult, followConversationBottom, patchConversation, setConversationRun]);

  const startRunMonitor = useCallback((run) => {
    if (!run?.id || run.status !== "running" || runControllersRef.current.has(run.id)) return;
    const conversation = conversationsRef.current.find((item) => item.id === run.conversationId);
    const assistantMessage = conversation?.messages.find((item) => item.id === run.assistantMessageId);
    if (!conversation || !assistantMessage) return;
    const controller = new AbortController();
    runControllersRef.current.set(run.id, controller);
    void monitorRun(conversation.id, assistantMessage.id, run, controller).catch((error) => {
      if (error?.name !== "AbortError" && mountedRef.current) {
        patchConversation(conversation.id, (item) => ({
          ...item,
          messages: item.messages.map((message) => message.id === assistantMessage.id
            ? { ...message, pending: false, error: error?.message || "任务状态恢复失败", statusStage: "failed" }
            : message),
        }));
        clearConversationRun(conversation.id, run.id);
      }
    }).finally(() => {
      if (runControllersRef.current.get(run.id) === controller) runControllersRef.current.delete(run.id);
    });
  }, [clearConversationRun, monitorRun, patchConversation]);

  const launchRun = useCallback(async ({ conversationId, prompt, userMessage, assistantMessage, responseMode, sourceUserMessageId = "", proposalSourceMessageId = "", maskEdit = null }) => {
    const controller = new AbortController();
    let launchedRun = {};
    try {
      const requestImageModel = responseMode === "image"
        ? imageModels.find((item) => item.model === assistantMessage.model) || selectedImageModel
        : selectedImageModel;
      const imageSettings = assistantImageSettings(requestImageModel, {
        ratio: assistantMessage.requestRatio || assistantMessage.ratio || generationRatio,
        resolution: assistantMessage.resolution || generationResolution,
        quality: assistantMessage.quality || generationQuality,
      });
      const includeImageParameters = responseMode === "image" || responseMode === "agent";
      const created = await createAssistantRun({
        conversationId,
        idempotencyKey: assistantMessage.id,
        prompt,
        userMessageContent: userMessage.content || prompt,
        mode: responseMode,
        clientUserMessageId: userMessage.id,
        clientAssistantMessageId: assistantMessage.id,
        ...(sourceUserMessageId ? { sourceUserMessageId } : {}),
        proposalSourceMessageId,
        referenceImages: (userMessage.referenceImages || []).map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl, thumbnailUrl: image.thumbnailUrl, fileKey: image.fileKey })),
        imagePlanItems: (assistantMessage.imagePlanItems || userMessage.imagePlanItems || []).map((item, index) => ({
          id: item.id || `item-${index + 1}`,
          title: item.title || `图片 ${index + 1}`,
          prompt: item.prompt || "",
          referenceImageIds: Array.isArray(item.referenceImageIds) ? item.referenceImageIds : item.referencedImageIds || [],
        })),
        referenceMode: responseMode === "image" ? imageRunReferenceMode(userMessage, assistantMessage) : "",
        attachments: (userMessage.attachments || []).filter((item) => item.status === "ready").map((item) => ({ id: item.id })),
        quoted: userMessage.quoted || null,
        skill: userMessage.skill || "",
        model: assistantMessage.model || (responseMode === "image" ? imageModel : conversationModel),
        count: responseMode === "image" || responseMode === "agent" ? assistantMessage.count || generationCount : 1,
        ...(includeImageParameters && imageSettings.ratio ? { ratio: imageSettings.ratio } : {}),
        ...(includeImageParameters && imageSettings.resolution ? { resolution: imageSettings.resolution } : {}),
        ...(includeImageParameters && imageSettings.requestSize ? { requestSize: imageSettings.requestSize } : {}),
        ...(includeImageParameters && imageSettings.width > 0 ? { width: imageSettings.width } : {}),
        ...(includeImageParameters && imageSettings.height > 0 ? { height: imageSettings.height } : {}),
        ...(includeImageParameters && imageSettings.quality ? { quality: imageSettings.quality } : {}),
        reasoningEffort: responseMode === "image" ? "" : assistantMessage.reasoningEffort || activeReasoningEffort,
        serviceKey: "assistant_image",
        parentOutputUrl: maskEdit?.parentOutputUrl || "",
        maskImage: maskEdit?.maskImage || null,
        maskBaseImage: maskEdit?.maskBaseImage || null,
        maskRect: maskEdit?.maskRect || "",
        queue: true,
      }, { signal: controller.signal });
      launchedRun = created.run || {};
      if (!mountedRef.current) return;
      applyRunResult(conversationId, assistantMessage.id, created, userMessage.id);
      scheduleWalletRefresh();
      if (created.run?.id && created.run.status === "running") {
        runControllersRef.current.set(created.run.id, controller);
        await monitorRun(conversationId, assistantMessage.id, created.run, controller);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        patchConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => assistantMessageMatchesRun(message, assistantMessage.id, launchedRun) ? { ...message, pending: false, routing: false, statusStage: "failed", error: error?.message || "生成失败，请稍后重试", content: message.content || error?.message || "生成失败，请稍后重试" } : message) }));
      }
      clearConversationRun(conversationId, launchedRun.id);
      removeQueuedRun(launchedRun.id);
    } finally {
      if (launchedRun.id && runControllersRef.current.get(launchedRun.id) === controller) runControllersRef.current.delete(launchedRun.id);
    }
  }, [activeReasoningEffort, applyRunResult, clearConversationRun, conversationModel, generationCount, generationQuality, generationRatio, generationResolution, imageModel, imageModels, monitorRun, patchConversation, removeQueuedRun, selectedImageModel]);

  const submitRegionEdit = useCallback(async (payload, item, meta = {}) => {
    if (!item || !payload?.prompt || !activeConversation || conversationHasWork || imageActionBusy) return false;
    const preferredModel = String(meta.model || imageModel || imageModels[0]?.model || "");
    const selected = imageModels.find((item) => item.model === preferredModel) || selectedImageModel;
    setImageActionBusy("region-edit");
    try {
      if (!(await confirmAssistantCost("image", 1, preferredModel, ""))) return false;
      const [cropUpload, maskUpload] = await Promise.all([
        uploadFile(payload.cropFile, { referenceUpload: true, behaviorFeature: "assistant" }),
        uploadFile(payload.maskFile, { referenceUpload: true, behaviorFeature: "assistant" }),
      ]);
      let baseImage = item.fileKey
        ? { id: item.id || "", name: "局部编辑底图", fileKey: item.fileKey, dataUrl: imageUrl(item) }
        : null;
      if (!baseImage) {
        if (!payload.baseFile) throw new Error("原始底图无法上传");
        const baseUpload = await uploadFile(payload.baseFile, {
          referenceUpload: true,
          behaviorFeature: "assistant",
        });
        baseImage = { name: "局部编辑底图", fileKey: baseUpload.key, dataUrl: baseUpload.url };
      }
      const cropReference = {
        id: crypto.randomUUID(),
        name: "局部编辑区域",
        fileKey: cropUpload.key,
        dataUrl: cropUpload.url,
        thumbnailUrl: cropUpload.thumbnailUrl || cropUpload.url,
      };
      const prompt = `${payload.prompt.trim()}\n只修改指定局部区域，保持区域外的构图、主体、光线、颜色和材质完全不变。`;
      const userMessageId = uid();
      const requestRatio = String(meta.requestRatio || generationRatio || "auto").toLowerCase() === "auto" ? "auto" : meta.requestRatio;
      const imageSettings = assistantImageSettings(selected, {
        ratio: requestRatio,
        resolution: meta.resolution || generationResolution,
        quality: meta.quality || generationQuality,
      });
      const assistantMessage = createLocalAssistantPlaceholder({
        prompt,
        responseMode: "image",
        userMessageId,
        defaults: {
          model: preferredModel,
          ratio: imageSettings.ratio,
          resolution: imageSettings.resolution,
          count: 1,
          requestSize: imageSettings.requestSize,
          quality: imageSettings.quality,
          width: imageSettings.width,
          height: imageSettings.height,
        },
      });
      const userMessage = {
        id: userMessageId,
        role: "user",
        content: `局部编辑：${payload.prompt.trim()}`,
        kind: "chat",
        referenceImages: [cropReference],
        attachments: [],
        localOnly: true,
        createdAt: new Date().toISOString(),
      };
      patchConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        updatedAt: assistantMessage.createdAt,
        messages: [...conversation.messages, userMessage, assistantMessage],
      }));
      scrollToBottom();
      await launchRun({
        conversationId: activeConversation.id,
        prompt,
        userMessage,
        assistantMessage,
        responseMode: "image",
        maskEdit: {
          parentOutputUrl: imageUrl(item),
          maskImage: { name: "局部编辑蒙版", fileKey: maskUpload.key, dataUrl: maskUpload.url },
          maskBaseImage: baseImage,
          maskRect: payload.maskRect,
        },
      });
      if (selected && selected.model !== imageModel) setImageModel(selected.model);
      return true;
    } finally {
      setImageActionBusy("");
    }
  }, [activeConversation, confirmAssistantCost, conversationHasWork, generationQuality, generationRatio, generationResolution, imageActionBusy, imageModel, imageModels, launchRun, patchConversation, scrollToBottom, selectedImageModel]);

  const executeSend = useCallback(async (prompt) => {
    const controller = new AbortController();
    draftRequestControllerRef.current?.abort();
    draftRequestControllerRef.current = controller;
    let conversation = activeConversation;
    if (!conversation) {
      try {
        conversation = normalizeConversation(await createAssistantConversation("新对话", { signal: controller.signal }));
        if (!mountedRef.current || controller.signal.aborted) return;
      } catch (error) {
        notificationService.error(error?.message || "新建对话失败");
        return;
      }
      setConversations((current) => [conversation, ...current]);
      setActiveId(conversation.id);
    }
    draftRequestControllerRef.current = null;
    const userMessageId = uid();
    const { responseMode, sendModel, requestedCount } = resolveAssistantSend(prompt);
    const imageSettings = assistantImageSettings(selectedImageModel, {
      ratio: generationRatio,
      resolution: generationResolution,
      quality: generationQuality,
    });
    const liveConversation = conversationsRef.current.find((item) => item.id === conversation.id) || conversation;
    const shouldQueue = Boolean(
      conversationHasWork ||
      activeRuns[conversation.id] ||
      queuedRunsRef.current.some((run) => run.conversationId === conversation.id && run.status === "queued") ||
      (liveConversation.messages || []).some((message) => message.role === "assistant" && message.pending),
    );
    const assistantMessage = createLocalAssistantPlaceholder({
      prompt,
      responseMode,
      userMessageId,
      queued: shouldQueue,
      defaults: {
        model: sendModel,
        reasoningEffort: activeReasoningEffort,
        ratio: imageSettings.ratio,
        resolution: imageSettings.resolution,
        count: requestedCount,
        requestSize: imageSettings.requestSize,
        quality: imageSettings.quality,
        width: imageSettings.width,
        height: imageSettings.height,
      },
    });
    const currentQuote = quotedMessage ? { ...quotedMessage } : null;
    const userMessage = { id: userMessageId, role: "user", content: prompt, kind: "chat", quoted: currentQuote, referenceImages: references, attachments: documents.filter((item) => item.status === "ready"), localOnly: true, createdAt: new Date().toISOString(), ...(shouldQueue ? { status: "queued" } : {}) };
    const visualContext = resolveVisualContext({ ...conversation, messages: [...conversation.messages, userMessage] }, prompt, maxReferences);
    if (!userMessage.referenceImages.length && visualContext.length) userMessage.referenceImages = visualContext;
    const nextTitle = conversation.messages.length ? conversation.title : conversationTitle(prompt);
    patchConversation(conversation.id, (item) => ({ ...item, title: nextTitle, messages: [...item.messages, userMessage, assistantMessage] }));
    setDraft("");
    setReferences([]);
    setDocuments([]);
    setQuotedMessage(null);
    scrollToBottom();
    controller.abort();
    await launchRun({ conversationId: conversation.id, prompt, userMessage, assistantMessage, responseMode });
  }, [activeConversation, activeReasoningEffort, activeRuns, conversationHasWork, conversationModel, conversationModels, creationType, documents, generationCount, generationQuality, generationRatio, generationResolution, imageModel, imageModels, launchRun, maxImages, maxReferences, patchConversation, quotedMessage, references, scrollToBottom, selectedImageModel]);

  useEffect(() => {
    if (!resumeCandidates.length) return;
    const candidates = resumeCandidates;
    setResumeCandidates([]);
    for (const run of candidates) {
      startRunMonitor(run);
    }
  }, [resumeCandidates, startRunMonitor]);

  const hasQueuedRuns = queuedRuns.length > 0;
  useEffect(() => {
    if (!auth.isAuthenticated || !hasQueuedRuns) return undefined;
    let stopped = false;
    let timer = 0;
    const synchronize = async () => {
      try {
        const expectedQueued = queuedRunsRef.current;
        const runs = await listActiveAssistantRuns({ workspace: "assistant" });
        if (stopped || !mountedRef.current) return;
        const running = runs.filter((run) => run.status === "running");
        const activeIds = new Set(runs.map((run) => run.id));
        setActiveRuns(Object.fromEntries(running.map((run) => [run.conversationId, run])));
        setQueuedRuns(runs.filter((run) => run.status === "queued"));
        for (const run of running) startRunMonitor(run);
        const disappeared = expectedQueued.filter((run) => !activeIds.has(run.id));
        if (disappeared.length) {
          const settled = await Promise.all(disappeared.map(async (run) => ({
            queued: run,
            result: await getAssistantRun(run.id).catch(() => null),
          })));
          if (stopped || !mountedRef.current) return;
          for (const item of settled) {
            if (item.result) applyRunResult(item.queued.conversationId, item.queued.assistantMessageId, item.result);
          }
        }
      } catch {
        // A single low-frequency sync retries on the next tick.
      } finally {
        if (!stopped) timer = window.setTimeout(synchronize, 2000);
      }
    };
    timer = window.setTimeout(synchronize, 800);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [applyRunResult, auth.isAuthenticated, hasQueuedRuns, startRunMonitor]);

  const requestSend = async () => {
    voiceIntentRef.current = false;
    recognitionRef.current?.abort?.();
    setVoiceListening(false);
    if (requestAuth({ featureLabel: "AI 助手" })) return;
    const prompt = draft.trim();
    if (!canSend) {
      if (assistantCharacterCount(prompt) > MAX_ASSISTANT_MESSAGE_CHARACTERS) {
        notificationService.warning("消息不能超过 12,000 个字符");
      } else if (documents.some((item) => item.status === "queued" || item.status === "processing")) {
        notificationService.warning("文档仍在解析，请等待完成后发送");
      } else if (documents.some((item) => item.status !== "ready")) {
        notificationService.warning("请移除解析失败的文档后再发送");
      }
      return;
    }
    const { responseMode, sendModel, requestedCount } = resolveAssistantSend(prompt);
    if (creationType === "image" && responseMode !== "image") {
      notificationService.info("这句话不像画面描述，已按对话回复，不会生成图片");
    }
    if (queueEditingId) {
      const editingRun = followUpRuns.find((run) => run.id === queueEditingId) || queuedRuns.find((run) => run.id === queueEditingId);
      if (editingRun) {
        await saveQueueEdit(editingRun, prompt);
        return;
      }
    }
    const confirmed = await confirmAssistantCost(responseMode, requestedCount, sendModel, activeReasoningEffort, {
      skip: pendingLaunchRef.current?.config?.costConfirmed === true,
    });
    if (!mountedRef.current || !confirmed) return;
    pendingLaunchRef.current = null;
    await executeSend(prompt);
  };

  const confirmCost = async (skip) => {
    setCostPayload(null);
    if (skip) {
      try {
        const result = await updateProfile({ requireCostConfirm: false });
        auth.setUser({ ...auth.user, ...(result?.user || { requireCostConfirm: false }) });
      } catch {
        // Confirmed work must continue if preference persistence fails.
      }
    }
    const resolve = costResolverRef.current;
    costResolverRef.current = null;
    resolve?.(true);
  };

  const cancelCost = () => {
    setCostPayload(null);
    const resolve = costResolverRef.current;
    costResolverRef.current = null;
    resolve?.(false);
  };

  const clearConversationContext = async () => {
    if (!activeConversation || conversationHasWork || !messages.length || messages.at(-1)?.kind === "context-divider") return;
    try {
      const boundary = await createAssistantContextBoundary(activeConversation.id);
      patchConversation(activeConversation.id, (conversation) => ({ ...conversation, updatedAt: new Date().toISOString(), messages: [...conversation.messages, boundary] }));
      notificationService.success("已从此处开始新的上下文");
      scrollToBottom("smooth");
    } catch (error) {
      notificationService.error(error?.message || "清除上文失败");
    }
  };

  const useGeneratedImageAsReference = (image) => {
    const asset = imageAssetFromItem(image);
    if (references.some((item) => sameAssetReference(item, asset))) {
      addAssetReference(asset);
      return;
    }
    if (references.length >= maxReferences) {
      notifyReferenceLimit();
      return;
    }
    addAssetReference(asset);
    notificationService.success("已加为参考图");
  };

  const addAssetReference = (asset) => {
    if (references.some((item) => sameAssetReference(item, asset))) {
      setReferences((current) => current.filter((item) => !sameAssetReference(item, asset)));
      return;
    }
    if (references.length >= maxReferences) {
      notifyReferenceLimit();
      return;
    }
    setReferences((current) => {
      if (current.length >= maxReferences || current.some((item) => sameAssetReference(item, asset))) return current;
      return [...current, { id: uid(), name: asset.label, dataUrl: asset.dataUrl, thumbnailUrl: asset.thumbUrl || asset.dataUrl, fileKey: asset.fileKey || "" }];
    });
  };

  const addAssetDocument = (file) => {
    if (file?.source === "output") {
      if (!file.downloadUrl) return;
      const link = document.createElement("a");
      link.href = file.downloadUrl;
      link.download = file.name || file.label || "assistant-output.txt";
      link.click();
      return;
    }
    if (mode === "image") {
      notificationService.warning("图片生成模式仅支持图片附件");
      return;
    }
    if (documents.some((item) => item.id === file.id)) {
      setDocuments((current) => current.filter((item) => item.id !== file.id));
      return;
    }
    if (documents.length >= 8) {
      notificationService.warning("最多 8 个文档");
      return;
    }
    setDocuments((current) => {
      if (current.length >= 8 || current.some((item) => item.id === file.id)) return current;
      return [...current, { ...file, name: file.label || file.name, status: file.status || "ready", retained: true }];
    });
  };

  const handleAssetGridScroll = (event) => {
    const scroller = event.currentTarget;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 160) return;
    setAssetRenderLimit((current) => {
      if (current >= assetLibraryImages.length) return current;
      return Math.min(assetLibraryImages.length, current + ASSET_GRID_RENDER_SIZE);
    });
    if (!libraryCursorRef.current || libraryLoadingMoreRef.current || !auth.isAuthenticated) return;
    libraryLoadingMoreRef.current = true;
    listUserAssets({ limit: ASSET_LIBRARY_PAGE_SIZE, cursor: libraryCursorRef.current, groupId: "all" })
      .then((page) => {
        if (!mountedRef.current) return;
        setLibraryAssets((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...(page.items || []).filter((item) => !seen.has(item.id))];
        });
        libraryCursorRef.current = page.nextCursor || "";
      })
      .catch((error) => {
        if (error?.name !== "AbortError") notificationService.error(error?.message || "我的资产读取失败");
      })
      .finally(() => {
        libraryLoadingMoreRef.current = false;
      });
  };

  const startEditingUserMessage = (message) => {
    if (conversationHasWork || message?.id !== lastUserMessageId) return;
    setEditingMessageId(message.id);
    setEditingMessageDraft(message.content || "");
    setActiveMessageMenuId("");
  };

  const cancelUserMessageEdit = () => {
    setEditingMessageId("");
    setEditingMessageDraft("");
  };

  const messageResponseMode = (message) => {
    if (["agent", "chat", "image"].includes(message?.requestedMode)) return message.requestedMode;
    if (message?.kind === "proposal") return "agent";
    return message?.kind === "image" || message?.images?.length ? "image" : "chat";
  };

  const modelForMode = (responseMode, preferred = "") => {
    const models = responseMode === "image" ? imageModels : conversationModels;
    if (models.some((item) => item.model === preferred)) return preferred;
    return responseMode === "image" ? imageModel || models[0]?.model || "" : conversationModel || models[0]?.model || "";
  };

  const withdrawLastTurn = async (message) => {
    if (!activeConversation || conversationHasWork || message?.id !== lastUserMessageId) return;
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    try {
      await deleteAssistantTurn(message.id);
      patchConversation(activeConversation.id, (conversation) => ({ ...conversation, updatedAt: new Date().toISOString(), messages: conversation.messages.slice(0, index) }));
      if (quotedMessage?.id === message.id) setQuotedMessage(null);
      cancelUserMessageEdit();
      notificationService.success("已撤回本轮对话");
    } catch (error) {
      notificationService.error(error?.message || "撤回本轮失败");
    }
  };

  const removeMessage = async (messageId) => {
    if (!activeConversation) return;
    try {
      await deleteAssistantMessage(messageId);
      patchConversation(activeConversation.id, (conversation) => ({ ...conversation, updatedAt: new Date().toISOString(), messages: conversation.messages.filter((message) => message.id !== messageId) }));
      if (quotedMessage?.id === messageId) setQuotedMessage(null);
      setActiveMessageMenuId("");
      notificationService.success("内容已删除");
    } catch (error) {
      notificationService.error(error?.message || "删除内容失败");
    }
  };

  const downloadMarkdown = (message) => {
    if (!message?.content) return;
    const blob = new Blob([message.content], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `AI助手-${new Date(message.createdAt || Date.now()).toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
    setActiveMessageMenuId("");
    notificationService.success("Markdown 已下载");
  };

  const retryAssistant = async (message) => {
    if (!activeConversation || conversationHasWork) return;
    const target = message?.role === "user"
      ? messages[messages.findIndex((item) => item.id === message.id) + 1]
      : message;
    if (!target || target.role !== "assistant" || target.id !== lastAssistantId) return;
    const index = messages.findIndex((item) => item.id === target.id);
    const userMessage = messages[index - 1];
    const retrySourceProposal = userMessage?.proposalSourceMessageId
      ? messages.find((item) => item.id === userMessage.proposalSourceMessageId && item.proposal)
      : null;
    const prompt = String(retrySourceProposal?.proposal?.prompt || target.prompt || userMessage?.content || "").trim();
    if (index < 1 || userMessage?.role !== "user" || !prompt) return;
    const replayLocalAttempt = target.localOnly === true;
    const requestedMode = replayLocalAttempt && ["agent", "chat", "image"].includes(target.kind)
      ? target.kind
      : messageResponseMode(target);
    const responseMode = replayLocalAttempt ? requestedMode : assistantSendMode(requestedMode, 0, prompt);
    const model = replayLocalAttempt && target.model
      ? target.model
      : modelForMode(responseMode, responseMode === requestedMode ? target.model : "");
    const retryEffort = target.reasoningEffort || activeReasoningEffort;
    const retryModel = imageModels.find((item) => item.model === model) || selectedImageModel;
    const retryCapabilities = normalizeImageModelCapabilities(retryModel || {});
    const retryPlanItems = responseMode === "image"
      ? proposalImagePlanItems({ items: target.imagePlanItems?.length ? target.imagePlanItems : retrySourceProposal?.proposal?.items })
      : [];
    let retryUserMessage = userMessage;
    if (responseMode === "image" && retrySourceProposal) {
      const recovered = resolveProposalReferences(
        activeConversation,
        retrySourceProposal,
        retryCapabilities.maxReferenceImages || MAX_MODEL_REFERENCE_IMAGES,
      );
      const recoveredReferences = uniqueReferenceImages([
        ...(userMessage.referenceImages || []),
        ...recovered.references,
      ]);
      if (retrySourceProposal.proposal.action === "edit" && !recoveredReferences.length) {
        notificationService.warning("没有找到原编辑方案的参考图，请重新上传后再试");
        return;
      }
      if (recoveredReferences.length > retryCapabilities.maxReferenceImages) {
        notificationService.warning(retryCapabilities.maxReferenceImages > 0
          ? `当前模型最多接收 ${retryCapabilities.maxReferenceImages} 张参考图，请减少参考图或切换模型`
          : "当前模型不支持参考图，请切换支持图片编辑的模型");
        return;
      }
      retryUserMessage = {
        ...userMessage,
        referenceMode: proposalReferenceMode(retrySourceProposal.proposal, recoveredReferences),
        referenceImages: recoveredReferences.map((image) => ({ ...image })),
        imagePlanItems: retryPlanItems,
      };
    }
    const retryCount = replayLocalAttempt
      ? responseMode === "chat" ? 1 : Math.max(1, Math.floor(Number(target.count) || 1))
      : responseMode === "image"
        ? retryPlanItems.length || clampImageCount(target.count || generationCount, retryModel)
        : 1;
    const retrySettings = replayLocalAttempt ? {
      ratio: target.requestRatio || target.ratio || "",
      resolution: target.resolution || "",
      quality: target.quality || "",
      requestSize: target.requestSize || "",
      width: Number(target.width) || 0,
      height: Number(target.height) || 0,
    } : assistantImageSettings(retryModel, {
      ratio: target.requestRatio || target.ratio || generationRatio,
      resolution: target.resolution || generationResolution,
      quality: target.quality || generationQuality,
    });
    if (!(await confirmAssistantCost(responseMode, retryCount, model, retryEffort))) return;
    const retryIdentity = resolveAssistantRetryIdentity(userMessage, target);
    const assistantMessage = createLocalAssistantPlaceholder({
      prompt,
      responseMode,
      previous: { ...target, model },
      userMessageId: userMessage.id,
      defaults: {
        model,
        reasoningEffort: retryEffort,
        ratio: retrySettings.ratio,
        requestRatio: retrySettings.ratio,
        resolution: retrySettings.resolution,
        count: retryCount,
        requestSize: retrySettings.requestSize,
        width: retrySettings.width,
        height: retrySettings.height,
        quality: retrySettings.quality,
      },
    });
    if (retryIdentity.retryAssistantMessageId) assistantMessage.id = retryIdentity.retryAssistantMessageId;
    if (retryPlanItems.length) assistantMessage.imagePlanItems = retryPlanItems;
    patchConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      updatedAt: assistantMessage.createdAt,
      messages: [
        ...conversation.messages.slice(0, index).map((item) => item.id === retryUserMessage.id ? retryUserMessage : item),
        assistantMessage,
      ],
    }));
    await launchRun({ conversationId: activeConversation.id, prompt, userMessage: retryUserMessage, assistantMessage, responseMode, sourceUserMessageId: retryIdentity.sourceUserMessageId, proposalSourceMessageId: retrySourceProposal?.id || "" });
  };

  const submitUserMessageEdit = async (message) => {
    const prompt = editingMessageDraft.trim();
    if (!activeConversation || conversationHasWork || !prompt || assistantCharacterCount(prompt) > MAX_ASSISTANT_MESSAGE_CHARACTERS || message.id !== lastUserMessageId) return;
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) return;
    const previousReply = messages[messageIndex + 1];
    const requestedMode = previousReply ? messageResponseMode(previousReply) : "chat";
    const responseMode = assistantSendMode(requestedMode, 0, prompt);
    const model = modelForMode(responseMode, responseMode === requestedMode ? previousReply?.model : "");
    const count = responseMode === "image"
      ? clampImageCount(previousReply?.count || generationCount, imageModels.find((item) => item.model === model) || selectedImageModel)
      : 1;
    const editModel = imageModels.find((item) => item.model === model) || selectedImageModel;
    const editSettings = assistantImageSettings(editModel, {
      ratio: previousReply?.requestRatio || previousReply?.ratio || generationRatio,
      resolution: previousReply?.resolution || generationResolution,
      quality: previousReply?.quality || generationQuality,
    });
    const editEffort = previousReply?.reasoningEffort || activeReasoningEffort;
    if (!(await confirmAssistantCost(responseMode, count, model, editEffort))) return;
    const editIdentity = resolveAssistantRetryIdentity(message, previousReply);
    const assistantMessage = createLocalAssistantPlaceholder({
      prompt,
      responseMode,
      previous: previousReply ? { ...previousReply, model } : null,
      userMessageId: message.id,
      defaults: {
        model,
        reasoningEffort: editEffort,
        ratio: editSettings.ratio,
        requestRatio: editSettings.ratio,
        resolution: editSettings.resolution,
        count,
        requestSize: editSettings.requestSize,
        width: editSettings.width,
        height: editSettings.height,
        quality: editSettings.quality,
      },
    });
    if (editIdentity.retryAssistantMessageId) assistantMessage.id = editIdentity.retryAssistantMessageId;
    const editedUser = { ...message, content: prompt, editedAt: new Date().toISOString() };
    patchConversation(activeConversation.id, (conversation) => ({ ...conversation, title: messageIndex === 0 ? conversationTitle(prompt) : conversation.title, updatedAt: assistantMessage.createdAt, messages: [...conversation.messages.slice(0, messageIndex), editedUser, assistantMessage] }));
    cancelUserMessageEdit();
    await launchRun({ conversationId: activeConversation.id, prompt, userMessage: editedUser, assistantMessage, responseMode, sourceUserMessageId: editIdentity.sourceUserMessageId });
  };

  const updateProposal = (messageId, patch) => {
    patchConversation(activeId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => {
      if (message.id !== messageId || !message.proposal) return message;
      const next = { ...message.proposal, ...patch };
      const selected = imageModels.find((item) => item.model === next.model) || imageModels[0];
      Object.assign(next, assistantImageSettings(selected, next));
      const planItems = proposalImagePlanItems(next);
      next.count = planItems.length || clampImageCount(next.count, selected, 1);
      return { ...message, proposal: next };
    }) }));
  };

  const approveAgentProposal = async (message) => {
    const liveConversation = conversationsRef.current.find((item) => item.id === activeConversation?.id) || activeConversation;
    const proposalMessage = liveConversation?.messages?.find((item) => item.id === message?.id) || message;
    const proposal = proposalMessage?.proposal;
    const prompt = String(proposal?.prompt || "").trim();
    const imagePlanItems = proposalImagePlanItems(proposal);
    if (!liveConversation || conversationHasWork || proposal?.submitting || (!prompt && !imagePlanItems.length)) return;
    const model = modelForMode("image", proposal.model);
    const selected = imageModels.find((item) => item.model === model) || selectedImageModel;
    const request = imageRequestFromProposal(proposal, selected);
    const modelCapabilities = normalizeImageModelCapabilities(selected || {});
    const { references: referenceImages } = resolveProposalReferences(liveConversation, proposalMessage, modelCapabilities.maxReferenceImages || MAX_MODEL_REFERENCE_IMAGES);
    const referenceMode = proposalReferenceMode(proposal, referenceImages);
    if (proposal.action === "edit" && !referenceImages.length) {
      notificationService.warning("没有找到本次编辑所需的参考图，请重新上传后再执行");
      return;
    }
    if (referenceImages.length > modelCapabilities.maxReferenceImages) {
      notificationService.warning(modelCapabilities.maxReferenceImages > 0
        ? `当前模型最多接收 ${modelCapabilities.maxReferenceImages} 张参考图，请减少参考图或切换模型`
        : "当前模型不支持参考图，请切换支持图片编辑的模型");
      return;
    }
    let count = imagePlanItems.length || clampImageCount(proposal.count, selected, 1);
    if (imagePlanItems.length) {
      if (imageModelMaxCount(selected) < imagePlanItems.length) {
        notificationService.warning(`当前模型最多生成 ${imageModelMaxCount(selected)} 张，方案需要 ${imagePlanItems.length} 张`);
        return;
      }
    } else if (referenceMode === "individual") {
      if (!referenceImages.length || imageModelMaxCount(selected) < referenceImages.length) {
        notificationService.warning("当前模型无法按参考图数量逐张生成，请调整模型或参考图");
        return;
      }
      count = referenceImages.length;
    }
    if (!(await confirmAssistantCost("image", count, model))) return;
    const userMessage = { id: uid(), role: "user", content: "执行这个创作方案", localOnly: true, createdAt: new Date().toISOString(), proposalSourceMessageId: proposalMessage.id, referenceMode, referenceImages: referenceImages.map((image) => ({ ...image })), imagePlanItems };
    const assistantMessage = createLocalAssistantPlaceholder({ prompt, responseMode: "image", userMessageId: userMessage.id, defaults: { model, ratio: request.ratio, requestRatio: request.ratio, resolution: request.resolution, count, requestSize: request.requestSize, width: request.width, height: request.height, quality: request.quality, referenceMode } });
    if (imagePlanItems.length) assistantMessage.imagePlanItems = imagePlanItems;
    updateProposal(proposalMessage.id, { submitting: true, dismissed: false });
    patchConversation(liveConversation.id, (conversation) => ({ ...conversation, updatedAt: userMessage.createdAt, messages: [...conversation.messages, userMessage, assistantMessage] }));
    try {
      await launchRun({ conversationId: liveConversation.id, prompt, userMessage, assistantMessage, responseMode: "image", proposalSourceMessageId: proposalMessage.id });
    } finally {
      if (mountedRef.current) updateProposal(proposalMessage.id, { submitting: false });
    }
  };

  const sourceProposalForImage = (message) => {
    const index = messages.findIndex((item) => item.id === message.id);
    const sourceId = index > 0 ? messages[index - 1]?.proposalSourceMessageId : "";
    return sourceId ? messages.find((item) => item.id === sourceId && item.proposal) || null : null;
  };

  const reopenSourceProposal = (proposalMessage) => {
    if (!proposalMessage) return;
    updateProposal(proposalMessage.id, { dismissed: false });
    scrollToMessage(proposalMessage.id, "auto");
  };

  const stopRun = async () => {
    if (!activeRun?.id || stopBusy) return;
    const stoppingRun = activeRun;
    setStopBusy(true);
    try {
      const acknowledgedUpstream = stoppingRun.cancelPolicy?.upstreamSubmitted === true;
      const result = await cancelAssistantRun(stoppingRun.id, { acknowledgeUpstream: acknowledgedUpstream });
      if (!result?.canceled) {
        setStopConfirmOpen(false);
        notificationService.info("任务已经结束，无需停止");
        return;
      }
      runControllersRef.current.get(stoppingRun.id)?.abort();
      runControllersRef.current.delete(stoppingRun.id);
      if (stoppingRun.conversationId && stoppingRun.assistantMessageId) {
        patchConversation(stoppingRun.conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === stoppingRun.assistantMessageId
            ? { ...message, pending: false, routing: false, statusStage: "stopped", content: message.content || "你已主动停止生成" }
            : message),
        }));
      }
      clearConversationRun(stoppingRun.conversationId || activeId, stoppingRun.id);
      setStopConfirmOpen(false);
      scheduleWalletRefresh();
      notificationService.warning(
        stoppingRun.cancelPolicy?.refunded
          ? "任务已停止，冻结积分已退回"
          : "任务已停止；已提交上游的部分不再接收结果，本轮积分不退还",
      );
    } catch (error) {
      if (error?.code === "assistant_cancel_confirmation_required") {
        const latest = await getAssistantRun(stoppingRun.id).catch(() => null);
        if (latest?.run) setConversationRun(stoppingRun.conversationId || activeId, latest.run);
        notificationService.info("任务状态刚刚发生变化，请确认新的停止后果");
        return;
      }
      setStopConfirmOpen(false);
      notificationService.error(error?.message || "停止任务失败");
    } finally {
      if (mountedRef.current) setStopBusy(false);
    }
  };

  const applyRunningGuidance = (item) => {
    if (!item?.prompt) return;
    setDraft(item.prompt);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const beginQueueEdit = (run) => {
    if (!run?.id || run.pending || queueBusyId) return;
    setQueueEditingId(run.id);
    setDraft(String(run.prompt || ""));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelQueueEdit = () => {
    setQueueEditingId("");
  };

  const saveQueueEdit = async (run, promptText = draft) => {
    const prompt = String(promptText || "").trim();
    if (!run?.id || run.pending || queueBusyId || !prompt) return;
    if (assistantCharacterCount(prompt) > MAX_ASSISTANT_MESSAGE_CHARACTERS) {
      notificationService.warning("消息不能超过 12,000 个字符");
      return;
    }
    setQueueBusyId(run.id);
    try {
      const result = await editQueuedAssistantRun(run.id, prompt);
      if (result?.run) upsertQueuedRun(result.run);
      patchConversation(run.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id === run.userMessageId) return { ...message, ...(result?.userMessage || {}), content: result?.userMessage?.content || prompt };
          if (message.id === run.assistantMessageId) return { ...message, prompt };
          return message;
        }),
      }));
      setDraft("");
      cancelQueueEdit();
      notificationService.success("排队内容已修改");
    } catch (error) {
      notificationService.error(error?.message || "修改排队任务失败");
    } finally {
      if (mountedRef.current) setQueueBusyId("");
    }
  };

  const cancelQueueItem = async (run) => {
    if (!run?.id || queueBusyId) return;
    setQueueBusyId(run.id);
    try {
      const result = await cancelAssistantRun(run.id);
      if (!result?.canceled) {
        notificationService.info("任务已经开始或结束，队列状态将自动更新");
        return;
      }
      removeQueuedRun(run.id);
      if (queueEditingId === run.id) cancelQueueEdit();
      patchConversation(run.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.filter((message) => message.id !== run.userMessageId && message.id !== run.assistantMessageId),
      }));
      scheduleWalletRefresh();
      notificationService.success("已从队列移除，冻结积分已退回");
    } catch (error) {
      notificationService.error(error?.message || "移除排队任务失败");
    } finally {
      if (mountedRef.current) setQueueBusyId("");
    }
  };

  const deleteConversationRow = async () => {
    if (!deleteTarget) return;
    try {
      const deletingRun = activeRuns[deleteTarget.id];
      const deletingQueue = queuedRuns.filter((run) => run.conversationId === deleteTarget.id);
      await deleteAssistantConversation(deleteTarget.id, { cancelActive: Boolean(deletingRun || deletingQueue.length) });
      if (deletingRun?.id) {
        runControllersRef.current.get(deletingRun.id)?.abort();
        runControllersRef.current.delete(deletingRun.id);
      }
      clearConversationRun(deleteTarget.id);
      setQueuedRuns((current) => current.filter((run) => run.conversationId !== deleteTarget.id));
      const next = conversationsRef.current.filter((item) => item.id !== deleteTarget.id);
      setConversations(next);
      conversationDraftsRef.current.delete(deleteTarget.id);
      if (activeId === deleteTarget.id) {
        selectConversation(next.find((item) => item.messages.length)?.id || "", { preserveCurrentDraft: false });
      }
      setDeleteTarget(null);
    } catch (error) {
      notificationService.error(error?.message || "删除对话失败");
    }
  };

  useEffect(() => {
    const pending = pendingLaunchRef.current;
    if (!loading && pending?.config?.autoStart && draft.trim()) {
      pendingLaunchRef.current = { ...pending, config: { ...pending.config, autoStart: false } };
      void requestSend();
    }
  });

  const draftCharacterCount = assistantCharacterCount(draft.trim());
  const canSend = draftCharacterCount > 0 && draftCharacterCount <= MAX_ASSISTANT_MESSAGE_CHARACTERS && !documents.some((item) => item.status !== "ready") && !costPayload && !loading && !serviceError && !uploading;
  const voiceBusy = Boolean(serviceError);
  const deleteTargetHasWork = Boolean(deleteTarget && (
    activeRuns[deleteTarget.id] || queuedRuns.some((run) => run.conversationId === deleteTarget.id)
  ));
  draftRef.current = draft;

  const stopVoiceInput = () => {
    voiceIntentRef.current = false;
    setVoiceListening(false);
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      try { recognition.stop(); } catch { /* already idle */ }
    }
  };

  const toggleVoiceInput = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      notificationService.warning("当前浏览器不支持语音输入");
      return;
    }
    if (voiceListening || voiceIntentRef.current) {
      stopVoiceInput();
      return;
    }
    if (voiceBusy) return;
    voiceIntentRef.current = true;
    voiceBaseDraftRef.current = draftRef.current;
    recognition.lang = "zh-CN";
    try {
      recognition.start();
    } catch {
      voiceIntentRef.current = false;
      setVoiceListening(false);
      notificationService.warning("语音识别暂时不可用");
    }
  };

  const renderSidebarBody = !sidebarCollapsed || sidebarAnimating;
  const renderSidebarRail = sidebarCollapsed || sidebarAnimating;

  return {
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
  };
}
