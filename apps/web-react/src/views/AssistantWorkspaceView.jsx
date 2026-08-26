import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { marked } from "marked";
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
  getAssistantFile,
  importAssistantConversations,
  listActiveAssistantRuns,
  listAssistantConversations,
  openAssistantRunStream,
  patchAssistantConversation,
  uploadAssistantFile,
  waitForAssistantRun,
} from "@react/legacy-modules/services/assistantApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { scheduleWalletRefresh } from "@react/legacy-modules/services/walletSync.js";
import { createUserAsset, getWallet, listUserAssets, updateProfile } from "@react/legacy-modules/services/meApi.js";
import { submitShareItem } from "@react/legacy-modules/services/shareGallery.js";
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  conversationTitle,
  createAssistantPlaceholder,
  formatMessageDate,
  formatTime,
  assistantSendMode,
  imageCountFromPrompt,
  messagePreview,
  messageStatus,
  uid,
} from "@react/legacy-modules/features/assistant/domain/assistantMessages.js";
import {
  assistantCodeLanguageLabel,
  highlightAssistantCode,
} from "@react/legacy-modules/features/assistant/domain/assistantCodeHighlight.js";
import { promptNeedsRecentVisual, resolveVisualContext } from "@react/legacy-modules/features/assistant/domain/visualContext.js";
import {
  clearAssistantHistory,
  loadAssistantHistory,
  loadAssistantWorkspaceState,
  saveAssistantWorkspaceState,
} from "@react/legacy-modules/services/assistantHistory.js";
import {
  IMAGE_ASPECT_RATIOS,
  clampImageCount,
  getModelAspectRatiosForResolution,
  imageCountOptions,
  imageModelMaxCount,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import "@react/legacy-static/features/assistant/styles/assistant-workspace.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "./assistant-workspace-react.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { WallevenImagePreview } from "../components/common/WallevenImagePreview.jsx";
import { assistantClipboardFiles, isAssistantImageFile, isImageToPSDRequest, isPSDFile } from "./assistant-attachments.js";

const SUGGESTIONS = [
  ["bi-stars", "画一张星空下的雪山桌面壁纸"],
  ["bi-grid-3x3-gap", "设计一个极简风格的天气 App 图标"],
  ["bi-chat-left-dots", "用三句话介绍你能帮我做什么"],
  ["bi-feather", "写一段科幻短篇的开头，主角是画师"],
];

const CREATION_TYPES = [
  { id: "chat", label: "问答模式", icon: "bi-chat-left-dots" },
  { id: "agent", label: "Agent 模式", icon: "bi-magic" },
  { id: "image", label: "图片生成", icon: "bi-image" },
];

const CREATION_TYPE_DESCRIPTIONS = {
  chat: "问答模式 · 只进行对话，不调用图片生成",
  agent: "Agent 模式 · 回答问题或整理生图方案",
  image: "图片生成 · 描述画面并上传参考图",
};

const REASONING_EFFORT_LABELS = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};
const ASSET_LIBRARY_MOTION_MS = 320;
const ASSET_LIBRARY_PAGE_SIZE = 48;
const ASSET_GRID_RENDER_SIZE = 36;
const MAX_MODEL_REFERENCE_IMAGES = 16;

function normalizeReasoningEffortId(value) {
  return String(value || "").trim().toLowerCase();
}

function finiteReasoningPoints(value) {
  const points = Number(value);
  return Number.isFinite(points) && points >= 0 ? Math.round(points) : undefined;
}

function normalizeReasoningPrices(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([effort, raw]) => {
    const id = normalizeReasoningEffortId(effort);
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const price = raw;
    const finite = (key) => finiteReasoningPoints(price[key]);
    return [[id, {
      assistantStandardPricePoints: finite("assistantStandardPricePoints"),
      assistantPricePoints: finite("assistantPricePoints"),
      assistantDiscountPricePoints: finite("assistantDiscountPricePoints"),
      canvasAgentStandardPricePoints: finite("canvasAgentStandardPricePoints"),
      canvasAgentPricePoints: finite("canvasAgentPricePoints"),
      canvasAgentDiscountPricePoints: finite("canvasAgentDiscountPricePoints"),
    }]];
  }));
}

function assistantReasoningPrice(model, effort, option = {}) {
  const configured = model?.reasoningPrices?.[effort] || {};
  const effective = finiteReasoningPoints(option.pricePoints ?? configured.assistantPricePoints)
    ?? finiteReasoningPoints(model?.pricePoints)
    ?? 0;
  const standard = finiteReasoningPoints(option.standardPricePoints ?? configured.assistantStandardPricePoints)
    ?? finiteReasoningPoints(model?.standardPricePoints ?? model?.pricePoints)
    ?? effective;
  const discount = finiteReasoningPoints(option.discountPricePoints ?? configured.assistantDiscountPricePoints);
  const billed = discount ?? effective;
  return {
    effective: billed,
    standard,
    discount: standard > billed ? billed : undefined,
    hasDiscount: standard > billed,
  };
}

function reasoningEffortOptionPriceModel(price) {
  return {
    pricePoints: price.effective,
    standardPricePoints: price.standard,
    discountPricePoints: price.hasDiscount ? price.effective : null,
  };
}

function normalizeReasoningEffortOptions(model = {}) {
  const priced = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : [];
  const source = priced.length
    ? priced
    : (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []);
  const seen = new Set();
  return source.flatMap((item) => {
    const raw = item && typeof item === "object" ? item : { id: item };
    const id = normalizeReasoningEffortId(raw.id || raw.effort);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const price = assistantReasoningPrice(model, id, raw);
    return [{
      id,
      label: String(raw.label || REASONING_EFFORT_LABELS[id] || id).trim() || id,
      ...price,
    }];
  });
}

function defaultReasoningEffort(model) {
  const efforts = (model?.reasoningEfforts || []).map((item) => item.id);
  const configured = normalizeReasoningEffortId(model?.defaultReasoningEffort);
  if (efforts.includes(configured)) return configured;
  return efforts.includes("medium") ? "medium" : efforts[0] || "";
}

const RESOLUTIONS = [
  { id: "1K", label: "标清 1K", longEdge: 1024 },
  { id: "2K", label: "高清 2K", longEdge: 2048 },
  { id: "4K", label: "超清 4K", longEdge: 4096 },
];

const IMAGE_QUALITY_OPTIONS = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

function ratioShape(value) {
  if (String(value || "") === "auto") return "auto";
  const [width, height] = String(value || "").split(":").map(Number);
  if (width === height) return "square";
  return width > height ? "wide" : "portrait";
}

function ratioPreviewStyle(value) {
  if (String(value || "") === "auto") return { aspectRatio: "1 / 1" };
  const [width, height] = String(value || "").split(":").map(Number);
  return { aspectRatio: `${width || 1} / ${height || 1}` };
}

function ratioOption(value) {
  const id = String(value || "").trim();
  return { id, label: id === "auto" ? "自动" : id, shape: ratioShape(id) };
}

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const MESSAGE_BATCH_SIZE = 24;
const MAX_ASSISTANT_MESSAGE_CHARACTERS = 12000;
const SIDEBAR_MOTION_MS = 280;

function assistantCharacterCount(value) {
  return Array.from(String(value || "")).length;
}


function fileUrlFromKey(key) {
  const value = String(key || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("/api/v1/files/") || value.startsWith("data:")) return value;
  return `/api/v1/files/${value.replace(/^\/+/, "")}`;
}

function imageUrl(image = {}) {
  if (typeof image === "string") return fileUrlFromKey(image);
  return String(
    image?.dataUrl ||
    image?.url ||
    image?.displayUrl ||
    image?.thumbUrl ||
    image?.thumbnailUrl ||
    fileUrlFromKey(image?.fileKey),
  ).trim();
}

function uniqueReferenceImages(images = []) {
  const seen = new Set();
  const out = [];
  for (const image of Array.isArray(images) ? images : []) {
    if (!image) continue;
    const key = String(image.id || image.fileKey || imageUrl(image) || "").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(image);
  }
  return out;
}

function isBareModelId(value) {
  const text = String(value || "").trim();
  return /^model-[0-9a-f-]{8,}$/i.test(text) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

function assistantModelLabel(modelId, models = [], fallback = "图片模型") {
  const id = String(modelId || "").trim();
  if (!id) return "默认模型";
  const match = models.find((item) => item.model === id || item.id === id || item.publicModelKey === id);
  const label = String(match?.label || match?.name || "").trim();
  if (label && !isBareModelId(label)) return label;
  if (!isBareModelId(id)) return id;
  return fallback;
}

function fileKeyFromAssetUrl(url) {
  const raw = String(url || "").trim();
  const marker = "/api/v1/files/";
  const index = raw.indexOf(marker);
  if (index < 0) return "";
  const key = raw.slice(index + marker.length).split(/[?#]/, 1)[0] || "";
  try {
    return decodeURIComponent(key).replace(/\/+$/, "");
  } catch {
    return key.replace(/\/+$/, "");
  }
}

function sameAssetReference(item, asset) {
  if (asset.dataUrl && item.dataUrl === asset.dataUrl) return true;
  const itemKey = String(item.fileKey || "").trim();
  const assetKey = String(asset.fileKey || "").trim();
  return Boolean(itemKey && assetKey && itemKey === assetKey);
}

function collectConversationAssets(source = []) {
  const seen = new Set();
  const assets = [];
  for (const conversation of source) {
    for (const message of conversation.messages || []) {
      for (const [index, image] of [...(message.images || []), ...(message.referenceImages || [])].entries()) {
        const dataUrl = imageUrl(image);
        if (!dataUrl || seen.has(dataUrl)) continue;
        seen.add(dataUrl);
        assets.push({
          id: `${conversation.id}-${message.id}-${index}`,
          label: image.revisedPrompt || image.name || conversation.title || "创作资产",
          dataUrl,
          thumbUrl: imageThumbUrl(image),
          fileKey: image.fileKey || fileKeyFromAssetUrl(dataUrl),
        });
      }
    }
  }
  return assets;
}

function collectConversationFiles(source = []) {
  const seen = new Set();
  const files = [];
  const push = (item, sourceKind) => {
    const id = String(item.id || item.downloadUrl || "").trim();
    if (!id || seen.has(id)) return;
    if (sourceKind !== "output" && item.status && item.status !== "ready") return;
    seen.add(id);
    files.push({
      ...item,
      id,
      source: sourceKind,
      label: item.name || item.label || (sourceKind === "output" ? "生成文件" : "文档"),
    });
  };
  for (const conversation of source) {
    for (const message of conversation.messages || []) {
      for (const item of message.attachments || []) push(item, "attachment");
      for (const item of message.artifacts || []) push(item, "output");
    }
  }
  return files;
}

function escapeSearchQuery(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearchNodes(text, query) {
  const source = String(text || "");
  const q = String(query || "").trim();
  if (!q || !source) return source;
  return source.split(new RegExp(`(${escapeSearchQuery(q)})`, "gi")).map((part, index) => (
    part.toLowerCase() === q.toLowerCase()
      ? <mark key={index} className="thread-search-mark">{part}</mark>
      : part
  ));
}

function applyThreadSearchMarks(root, query) {
  if (!root) return;
  root.querySelectorAll("mark.thread-search-mark").forEach((node) => {
    node.replaceWith(document.createTextNode(node.textContent || ""));
  });
  root.normalize();
  const q = String(query || "").trim();
  if (!q) return;
  const pattern = new RegExp(escapeSearchQuery(q), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("mark, .assistant-code, button, .assistant-code-src")) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      return pattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const textNode of nodes) {
    const value = textNode.nodeValue || "";
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match = pattern.exec(value);
    while (match) {
      if (match.index > last) frag.append(value.slice(last, match.index));
      const mark = document.createElement("mark");
      mark.className = "thread-search-mark";
      mark.textContent = match[0];
      frag.append(mark);
      last = match.index + match[0].length;
      match = pattern.exec(value);
    }
    if (last < value.length) frag.append(value.slice(last));
    textNode.replaceWith(frag);
  }
}

function messageSearchText(message) {
  if (!message || message.kind === "context-divider") return "";
  const proposal = message.proposal || {};
  return [
    message.content,
    message.prompt,
    message.error,
    proposal.prompt,
    proposal.reason,
    proposal.planningSummary,
    ...(message.attachments || []).map((item) => item.name),
    ...(message.artifacts || []).map((item) => item.name),
    ...(message.referenceImages || []).map((item) => item.name),
  ].filter(Boolean).join("\n");
}

function AssetLibraryFileRow({ file, picked, capped, blocked, onPick }) {
  const isOutput = file.source === "output";
  const title = isOutput
    ? `下载 ${file.label}`
    : picked
      ? `移除 ${file.label}`
      : blocked
        ? "图片生成模式仅支持图片附件"
        : capped
          ? "文档已达上限"
          : `添加 ${file.label} 到附件`;
  return (
    <button
      type="button"
      className={`asset-file-row${picked ? " is-picked" : ""}${capped && !picked && !isOutput ? " is-capped" : ""}`}
      aria-pressed={isOutput ? undefined : picked}
      title={title}
      onClick={() => onPick(file)}
    >
      <i className={`bi ${documentIcon(file)}`} aria-hidden="true" />
      <span>
        <strong>{file.label}</strong>
        <small>
          {isOutput
            ? `${String(file.format || "file").toUpperCase()} · ${formatDocumentSize(file.sizeBytes)} · 输出`
            : `${formatDocumentSize(file.sizeBytes)}${file.pageCount ? ` · ${file.pageCount} 页` : " · 文档"}`}
        </small>
      </span>
      <i className={`bi ${isOutput ? "bi-download" : picked ? "bi-check-lg" : "bi-plus-lg"}`} aria-hidden="true" />
    </button>
  );
}

function AssetLibraryTile({ asset, onPick, picked, capped }) {
  return (
    <button type="button" className={`${picked ? "is-picked" : ""}${capped && !picked ? " is-capped" : ""}`.trim()} aria-pressed={picked} title={picked ? `移除 ${asset.label}` : capped ? `参考图已达上限` : `添加 ${asset.label} 到参考图`} onClick={() => onPick(asset)}>
      <img src={asset.thumbUrl || asset.dataUrl} alt="" width="160" height="160" loading="lazy" decoding="async" />
      <span><i className={`bi ${picked ? "bi-check-lg" : "bi-plus-lg"}`} /></span>
    </button>
  );
}

// 聊天气泡内的小图：优先服务端缩略图，老消息没有则回退原图
function imageThumbUrl(image = {}) {
  return String(image.thumbUrl || "").trim() || imageUrl(image);
}

// 点开大图用展示图（服务端压缩大图），老消息没有则回退原图
function imageDisplayUrl(image = {}) {
  return String(image.displayUrl || "").trim() || imageUrl(image);
}

function imageRatioValue(message = {}) {
  const width = Number(message.width);
  const height = Number(message.height);
  return width > 0 && height > 0 ? `${width} / ${height}` : "1 / 1";
}

function imageGenerationMeta(message = {}, imageModels = []) {
  const ratio = String(message.ratio || "").trim();
  const size = message.requestSize && message.requestSize !== "auto"
    ? String(message.requestSize).replace("x", "×")
    : Number(message.width) > 0 && Number(message.height) > 0
      ? `${message.width}×${message.height}`
      : "";
  return {
    modelLabel: assistantModelLabel(message.model, imageModels),
    ratio: ratio === "auto" ? "Auto" : ratio,
    resolution: String(message.resolution || "").trim(),
    size,
    prompt: String(message.prompt || message.content || "").trim(),
  };
}

function imageAssetFromItem(image = {}) {
  const dataUrl = imageUrl(image);
  return {
    id: image.id || image.fileKey || dataUrl,
    label: image.name || image.revisedPrompt || "参考图",
    dataUrl,
    thumbUrl: imageThumbUrl(image) || dataUrl,
    fileKey: image.fileKey || fileKeyFromAssetUrl(dataUrl),
  };
}

function downloadAssistantImage(image, index = 0) {
  const link = document.createElement("a");
  link.href = imageUrl(image);
  link.download = `assistant-image-${index + 1}.png`;
  link.rel = "noopener";
  link.click();
}

async function copyAssistantImage(image) {
  const url = imageUrl(image);
  if (!url) throw new Error("没有可复制的图片");
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("复制图片失败");
  const blob = await response.blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

function AssistantFullscreenPreview({
  value,
  actionBusy = "",
  onClose,
  onStep,
  onUseReference,
  onRegionEdit,
  onFavorite,
  onPublish,
  onDelete,
}) {
  if (!value?.item) return null;
  const item = value.item;
  const galleryItems = uniqueReferenceImages(value.gallery?.length ? value.gallery : [item]);
  const sourceUrl = imageUrl(item);
  if (!sourceUrl) return null;
  const index = Math.max(0, galleryItems.findIndex((entry) => entry === item || sameAssetReference(entry, imageAssetFromItem(item))));
  const meta = value.meta && typeof value.meta === "object" ? value.meta : {};
  const prompt = String(meta.prompt || item.revisedPrompt || item.name || "").trim();
  const title = prompt || "AI 助手图片";
  const gallery = galleryItems.map(imageUrl).filter(Boolean);
  const displaySources = Object.fromEntries(galleryItems.map((entry) => [imageUrl(entry), imageDisplayUrl(entry)]).filter(([url]) => url));
  const pending = Boolean(meta.pending);
  return (
    <WallevenImagePreview
      sourceUrl={sourceUrl}
      displaySourceUrl={imageDisplayUrl(item)}
      title={title}
      filename={`assistant-image-${index + 1}.png`}
      gallery={gallery}
      displaySources={displaySources}
      metadata={{
        id: item.id || "",
        model: meta.modelLabel || meta.model || "",
        ratio: meta.ratio || "",
        resolution: meta.resolution || meta.size || "",
        prompt,
        source: meta.messageId ? "AI 助手" : "",
      }}
      actionBusy={pending ? "pending" : actionBusy}
      regionEditBusy={actionBusy === "region-edit"}
      onUseReference={() => onUseReference?.(item)}
      onRegionEdit={(payload) => onRegionEdit?.(payload, item, meta)}
      onFavorite={item.fileKey ? () => onFavorite?.(item, meta) : undefined}
      onPublish={meta.runId ? () => onPublish?.(item, meta) : undefined}
      onDelete={meta.messageId ? () => onDelete?.(item, meta) : undefined}
      onSelect={(url) => {
        const nextIndex = gallery.indexOf(url);
        if (nextIndex >= 0) onStep(nextIndex - index);
      }}
      onClose={onClose}
      onDownload={() => downloadAssistantImage(item, index)}
    />
  );
}

function formatDocumentSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function documentIcon(item = {}) {
  const type = String(item.contentType || "").toLowerCase();
  if (type.includes("photoshop")) return "bi-file-earmark-image";
  if (type.includes("pdf")) return "bi-file-earmark-pdf";
  if (type.includes("spreadsheet")) return "bi-file-earmark-spreadsheet";
  if (type.includes("presentation")) return "bi-file-earmark-slides";
  if (type.includes("wordprocessing")) return "bi-file-earmark-word";
  return "bi-file-earmark-text";
}

function documentStatusLabel(item = {}) {
  if (item.status === "ready") return item.pageCount ? `${item.pageCount} 页` : "可分析";
  if (item.status === "failed") return "解析失败";
  if (item.status === "processing") return "正在解析";
  return "等待解析";
}

function normalizeAssistantContext(value) {
  if (!value || typeof value !== "object") return null;
  const inputBudgetTokens = Math.max(0, Number(value.inputBudgetTokens) || 0);
  const estimatedInputTokens = Math.max(0, Number(value.estimatedInputTokens) || 0);
  if (!inputBudgetTokens) return null;
  return {
    ...value,
    inputBudgetTokens,
    estimatedInputTokens,
    usagePercent: Math.max(0, Math.min(100, Number(value.usagePercent) || Math.ceil((estimatedInputTokens * 100) / inputBudgetTokens))),
    compactedMessages: Math.max(0, Number(value.compactedMessages) || 0),
    includedMessages: Math.max(0, Number(value.includedMessages) || 0),
    omittedMessages: Math.max(0, Number(value.omittedMessages) || 0),
  };
}

function formatContextTokens(value) {
  const tokens = Math.max(0, Number(value) || 0);
  if (tokens < 1000) return String(tokens);
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value) || 0);
  if (!ms) return "";
  if (ms < 100) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function formatElapsedClock(value) {
  const seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function useElapsedMs(startMs, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startMs) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active, startMs]);
  if (!startMs) return 0;
  return Math.max(0, (active ? now : Date.now()) - startMs);
}

function estimateAssistantTokens(text) {
  let ascii = 0;
  let other = 0;
  for (const char of String(text || "")) {
    if (char.charCodeAt(0) <= 0x7f) ascii += 1;
    else other += 1;
  }
  const tokens = Math.floor(ascii / 4) + other;
  return String(text || "").trim() ? Math.max(1, tokens) : 0;
}

function messageDurationMs(message) {
  const start = Date.parse(message?.createdAt || "");
  const end = Date.parse(message?.updatedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

function mergeAssistantUsage(current, incoming, extras = {}) {
  const next = {
    ...(current && typeof current === "object" ? current : {}),
    ...(incoming && typeof incoming === "object" ? incoming : {}),
  };
  for (const [key, value] of Object.entries(extras)) {
    const amount = Math.max(0, Number(value) || 0);
    if (!amount) continue;
    if (!Math.max(0, Number(next[key]) || 0)) next[key] = amount;
  }
  return next;
}

function usageStartedAtMs(message) {
  const marked = Number(message?.usageStartedAt);
  if (Number.isFinite(marked) && marked > 0) return marked;
  const created = Date.parse(message?.createdAt || "");
  return Number.isFinite(created) ? created : 0;
}

function normalizeAssistantUsage(message) {
  if (!message || message.pending || message.role !== "assistant") return null;
  const raw = message.usage && typeof message.usage === "object" ? message.usage : {};
  const context = message.context && typeof message.context === "object" ? message.context : {};
  const durationMs = Math.max(0, Number(raw.durationMs) || 0) || messageDurationMs(message);
  const firstTokenMs = Math.max(0, Number(raw.firstTokenMs) || 0);
  const isImage = message.kind === "image" || Boolean(message.images?.length);
  if (isImage) {
    return durationMs ? { inputTokens: 0, outputTokens: 0, firstTokenMs: 0, durationMs } : null;
  }
  const inputTokens = Math.max(0, Number(raw.inputTokens ?? raw.promptTokens) || Number(context.estimatedInputTokens) || 0);
  const outputTokens = Math.max(0, Number(raw.outputTokens ?? raw.completionTokens) || 0) || estimateAssistantTokens(message.content);
  if (!inputTokens && !outputTokens && !firstTokenMs && !durationMs) return null;
  return { inputTokens, outputTokens, firstTokenMs, durationMs };
}

function ContextMeterIcon({ percent }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 5.25;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="assistant-context-meter-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="is-track" cx="8" cy="8" r={radius} />
      <circle
        className="is-value"
        cx="8"
        cy="8"
        r={radius}
        strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
      />
    </svg>
  );
}

function AssistantContextMeter({ context }) {
  const usage = normalizeAssistantContext(context);
  if (!usage) {
    return (
      <div className="assistant-context-meter is-empty" title="完成一次回答后显示上下文占用">
        <ContextMeterIcon percent={0} />
        <span>上下文</span>
        <strong>--</strong>
      </div>
    );
  }
  const title = `本轮估算 ${formatContextTokens(usage.estimatedInputTokens)} / ${formatContextTokens(usage.inputBudgetTokens)} tokens${usage.compactedMessages ? `，已压缩 ${usage.compactedMessages} 条消息` : ""}`;
  return (
    <div className={`assistant-context-meter${usage.usagePercent >= 80 ? " is-high" : usage.compactedMessages ? " is-compacted" : ""}`} title={title} aria-label={title} role="status">
      <ContextMeterIcon percent={usage.usagePercent} />
      <span>上下文</span>
      <strong>{usage.usagePercent}%</strong>
    </div>
  );
}

function assistantImageSettings(model, settings = {}) {
  const capabilities = normalizeImageModelCapabilities(model || {});
  const requestedResolution = String(settings.resolution || "").toUpperCase();
  const resolution = capabilities.resolutions.includes(requestedResolution)
    ? requestedResolution
    : capabilities.resolutions[0] || "";
  const requestedQuality = String(settings.quality || "").toLowerCase();
  const quality = capabilities.qualities.includes(requestedQuality)
    ? requestedQuality
    : capabilities.qualities[0] || "";
  const ratios = getModelAspectRatiosForResolution(model || {}, resolution);
  const requestedRatio = String(settings.ratio || "auto").toLowerCase();
  const ratio = ratios.includes(requestedRatio) ? requestedRatio : ratios[0] || "";
  const resolutionMeta = RESOLUTIONS.find((item) => item.id === resolution);
  if (!resolutionMeta) return { ratio, resolution: "", quality, width: 0, height: 0, requestSize: "" };
  const longEdge = resolutionMeta.longEdge;
  if (ratio === "auto") return { ratio, resolution, quality, width: longEdge, height: longEdge, requestSize: "auto" };
  const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
  if (!ratioWidth || !ratioHeight) return { ratio, resolution, quality, width: longEdge, height: longEdge, requestSize: `${longEdge}x${longEdge}` };
  const width = ratioWidth >= ratioHeight ? longEdge : Math.round((longEdge * ratioWidth) / ratioHeight);
  const height = ratioHeight >= ratioWidth ? longEdge : Math.round((longEdge * ratioHeight) / ratioWidth);
  return { ratio, resolution, quality, width, height, requestSize: `${width}x${height}` };
}

function imageRequestFromProposal(proposal = {}, model = null) {
  return assistantImageSettings(model, proposal);
}

function proposalReferenceMode(proposal = {}, references = []) {
  if (proposal.referenceMode === "individual" || proposal.referenceMode === "shared") {
    return proposal.referenceMode;
  }
  // Compatibility for plans created before referenceMode existed. A one-output-
  // per-reference edit is the only legacy shape that has an unambiguous mapping.
  if (proposal.action === "edit" && references.length > 1 && Number(proposal.count) === references.length) {
    return "individual";
  }
  return "shared";
}

function imageRunReferenceMode(userMessage = {}, assistantMessage = {}) {
  const explicit = userMessage.referenceMode || assistantMessage.referenceMode;
  if (explicit === "individual" || explicit === "shared") return explicit;
  const references = uniqueReferenceImages(userMessage.referenceImages || []);
  if (userMessage.proposalSourceMessageId && references.length > 1 && Number(assistantMessage.count) === references.length) {
    return "individual";
  }
  return "shared";
}

function retryableImageUrl(url, version = 0) {
  if (!version || !url || url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_assistant_retry=${version}`;
}

function normalizeConversation(value = {}) {
  return {
    ...value,
    id: String(value.id || uid()),
    title: String(value.title || "新对话"),
    messages: Array.isArray(value.messages) ? value.messages : [],
  };
}

async function prepareLegacyConversations(stored, signal) {
  const conversations = Array.isArray(stored) ? stored.slice(0, 30) : [];
  const prepared = [];
  for (const conversation of conversations) {
    const messages = [];
    for (const original of (Array.isArray(conversation.messages) ? conversation.messages : []).slice(-160)) {
      const message = { ...original };
      for (const field of ["referenceImages", "images"]) {
        const migrated = [];
        for (const image of (Array.isArray(message[field]) ? message[field] : []).slice(0, MAX_MODEL_REFERENCE_IMAGES)) {
          if (image?.fileKey) {
            migrated.push(image);
            continue;
          }
          const source = imageUrl(image);
          if (!source) continue;
          try {
            const response = await fetch(source, { credentials: "include", signal });
            if (!response.ok) continue;
            const blob = await response.blob();
            const file = new File([blob], image.name || `assistant-legacy-${Date.now()}.png`, { type: blob.type || "image/png" });
            const uploaded = await uploadFile(file, { signal });
            migrated.push({ ...image, dataUrl: uploaded.url, thumbnailUrl: uploaded.thumbnailUrl, fileKey: uploaded.key });
          } catch (error) {
            if (error?.name === "AbortError") throw error;
          }
        }
        message[field] = migrated;
      }
      if (message.pending) {
        message.pending = false;
        message.routing = false;
        message.statusStage = "stopped";
        message.content ||= "任务已中断，可重新生成";
      }
      messages.push(message);
    }
    prepared.push({ ...conversation, messages });
  }
  return prepared;
}

function conversationThumbnail(conversation = {}) {
  const messages = Array.isArray(conversation.messages) ? [...conversation.messages].reverse() : [];
  for (const message of messages) {
    const images = [...(message.images || []), ...(message.referenceImages || [])].filter((item) => imageUrl(item));
    if (images.length) return imageUrl(images[images.length - 1]);
  }
  return "";
}

function conversationMark(conversation = {}) {
  const found = String(conversation.title || "").trim().match(/[\p{L}\p{N}]/u);
  return found ? found[0].toUpperCase() : "新";
}

const HISTORY_PREVIEW_COUNT = 12;

function conversationGroupLabel(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "较早";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= today) return "今天";
  if (time >= today - 86400000) return "昨天";
  return "较早";
}

function conversationSearchGroupLabel(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "更早";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= today) return "今天";
  if (time >= today - 86400000) return "昨天";
  if (time >= today - 7 * 86400000) return "最近 7 天";
  if (new Date(time).getFullYear() === now.getFullYear()) return "今年";
  return "更早";
}

function formatConversationRelativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function groupConversations(list, labelFor = conversationGroupLabel) {
  const groups = [];
  const index = new Map();
  for (const item of list) {
    const key = labelFor(item.updatedAt);
    let group = index.get(key);
    if (!group) {
      group = { key, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function requestedConversationId() {
  try {
    return new URLSearchParams(window.location.search).get("c") || "";
  } catch {
    return "";
  }
}

function syncConversationUrl(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

function NewChatIcon() {
  return <span className="new-chat-icon" aria-hidden="true" />;
}

function normalizeConfig(config = {}) {
  const conversationModels = (Array.isArray(config.conversationModels)
    ? config.conversationModels
    : [])
    .map((item) => {
      const reasoningPrices = normalizeReasoningPrices(item?.reasoningPrices);
      const reasoningEfforts = normalizeReasoningEffortOptions({ ...item, reasoningPrices });
      return {
        ...item,
        model: String(item?.model || "").trim(),
        label: String(item?.label || item?.model || "").trim(),
        description: String(item?.description || item?.provider || "后台配置的对话模型"),
        reasoningEfforts,
        supportedReasoningEfforts: reasoningEfforts.map((option) => option.id),
        defaultReasoningEffort: String(item?.defaultReasoningEffort || "").trim().toLowerCase(),
        reasoningPrices,
      };
    })
    .filter((item) => item.model && item.label);
  const imageModels = (Array.isArray(config.imageModels) ? config.imageModels : [])
    .map((item) => ({
      ...item,
      ...normalizeImageModelCapabilities(item),
      model: String(item?.model || item?.id || item?.publicModelKey || "").trim(),
      label: String(item?.label || item?.name || item?.model || item?.id || "").trim(),
      description: String(item?.description || item?.provider || "后台配置的图片模型"),
    }))
    .filter((item) => item.model && item.label);
  return { conversationModels, imageModels };
}

function ModelMenuPrice({ model, perImage, unitSuffix }) {
  const price = resolveModelPointPricing(model);
  if (!price.configured) return <span className="model-menu-price is-empty">未定价</span>;
  const suffix = unitSuffix ?? (perImage ? "/张" : "");
  if (price.hasDiscount) {
    return (
      <span className="model-menu-price has-discount">
        <strong>折扣 {price.discount} 积分{suffix}</strong>
        <del>{price.standard} 积分{suffix}</del>
      </span>
    );
  }
  return (
    <span className="model-menu-price">
      <strong>{price.effective === 0 ? "免费" : `${price.effective} 积分${suffix}`}</strong>
    </span>
  );
}

function AssistantCostDialog({ payload, light, onCancel, onConfirm }) {
  const [skip, setSkip] = useState(false);
  if (!payload) return null;
  const total = Math.max(0, Number(payload.total || 0));
  const available = Number.isFinite(Number(payload.available))
    ? Math.max(0, Number(payload.available))
    : null;
  const insufficient = available != null && total > available;
  return createPortal(
    <div className={`ai-cost-confirm-layer is-elevated${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="ai-cost-confirm-panel is-credits" role="dialog" aria-modal="true" aria-labelledby="assistant-cost-title">
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon"><i className="bi bi-coin" /></span>
          <div className="ai-cost-confirm-titles"><span className="ai-cost-confirm-eyebrow">{payload.featureLabel}</span><h5 id="assistant-cost-title">{payload.title}</h5></div>
          <button type="button" className="ai-cost-confirm-close" aria-label="关闭费用确认" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        </header>
        <p className="ai-cost-confirm-summary">{payload.summary}</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total"><div className="ai-cost-confirm-total__copy"><span>本次预计</span><small>{payload.unit} 积分 / {payload.unitLabel} × {payload.count} {payload.unitLabel}</small></div><strong>{total.toLocaleString("zh-CN")} 积分</strong></div>
          <div className="ai-cost-confirm-balance"><div><span>当前可用</span><strong>{available == null ? "读取中" : `${available.toLocaleString("zh-CN")} 积分`}</strong></div><i className="bi bi-arrow-right" /><div className={insufficient ? "danger" : ""}><span>预留后余额</span><strong>{available == null ? "待计算" : insufficient ? "余额不足" : `${Math.max(0, available - total).toLocaleString("zh-CN")} 积分`}</strong></div></div>
        </div>
        <footer className="ai-cost-confirm-footer">
          <label className="ai-cost-confirm-preference"><input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} /><span>不再每次确认</span></label>
          <div className="ai-cost-confirm-actions"><button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button><button type="button" className="ai-cost-confirm-btn primary" disabled={insufficient} onClick={() => onConfirm(skip)}>确认</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function GeneratedImageGrid({ message, imageModels, loadedImages, failedImages, imageRetryVersions, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference }) {
  const meta = { ...imageGenerationMeta(message, imageModels), messageId: message.id, runId: message.runId || "", model: message.model || "", requestRatio: message.requestRatio || message.ratio || "", requestSize: message.requestSize || "", width: message.width, height: message.height, quality: message.quality || "", pending: Boolean(message.pending) };
  const params = [meta.modelLabel, meta.ratio, meta.resolution].filter(Boolean);
  return (
    <div className={`generated-images${message.images.length === 1 ? " is-single" : ""}${message.images.length > 2 ? " is-many" : ""}`} style={{ "--generated-ratio": imageRatioValue(message), "--image-slot-count": message.images.length }}>
      {message.images.map((image, index) => {
        const key = `${message.id}-${index}`;
        const loaded = loadedImages.has(key);
        const failed = failedImages.has(key);
        return (
          <figure key={key} data-image-key={key} className={failed ? "is-failed" : loaded ? "" : "is-loading"}>
            {failed ? (
              <div className="generated-image-failed">
                <i className="bi bi-image-alt" />
                <span>图片加载失败</span>
                <button type="button" onClick={() => onImageRetry(message.id, index)}>重新加载</button>
              </div>
            ) : (
              <button className="generated-image-preview" type="button" onClick={() => onOpenImage(image, index, message.images, meta)}>
                <img src={retryableImageUrl(imageThumbUrl(image), imageRetryVersions[key])} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" decoding="async" onLoad={() => onImageLoad(message.id, index)} onError={() => onImageError(message.id, index)} />
                <i className="tile-sheen" aria-hidden="true" />
              </button>
            )}
            {loaded && !failed && (
              <>
                {params.length > 0 && <div className="generated-image-params">{params.map((item) => <span key={item}>{item}</span>)}</div>}
                <div className="generated-image-actions">
                  <button type="button" title="查看大图" aria-label="查看大图" onClick={() => onOpenImage(image, index, message.images, meta)}><i className="bi bi-arrows-fullscreen" /></button>
                  <button type="button" title="复制图片" aria-label="复制图片" onClick={() => void copyAssistantImage(image).then(() => notificationService.success("图片已复制")).catch(() => notificationService.error("复制图片失败"))}><i className="bi bi-copy" /></button>
                  <button type="button" title="用作参考图" aria-label="用作参考图" onClick={() => onUseReference(image)}><i className="bi bi-image" /></button>
                  <button type="button" title="下载原图" aria-label="下载原图" onClick={() => downloadAssistantImage(image, index)}><i className="bi bi-download" /></button>
                </div>
              </>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function appendColorSwatches(node) {
  const pattern = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\brgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*[/,]\s*[\d.]+%?)?\s*\)/gi;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const textNode of texts) {
    const value = textNode.nodeValue;
    if (!value || !pattern.test(value)) continue;
    pattern.lastIndex = 0;
    const parts = [];
    let last = 0;
    let match = pattern.exec(value);
    while (match) {
      if (match.index > last) parts.push(document.createTextNode(value.slice(last, match.index)));
      const color = match[0];
      const wrap = document.createElement("span");
      wrap.className = "assistant-code-color";
      const swatch = document.createElement("span");
      swatch.className = "assistant-code-swatch";
      swatch.style.setProperty("--swatch", color);
      swatch.setAttribute("aria-hidden", "true");
      wrap.append(swatch, document.createTextNode(color));
      parts.push(wrap);
      last = match.index + color.length;
      match = pattern.exec(value);
    }
    if (last < value.length) parts.push(document.createTextNode(value.slice(last)));
    textNode.replaceWith(...parts);
  }
}

function enhanceMarkdownCodeBlocks(root, { streaming = false } = {}) {
  root.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".assistant-code")) return;
    const code = pre.querySelector("code");
    if (!code) return;
    try {
      const source = String(code.textContent || "").replace(/\n$/, "");
      const highlighted = highlightAssistantCode(source, code.classList, { streaming });
      const languageLabel = assistantCodeLanguageLabel(code.classList);
      const block = document.createElement("figure");
      block.className = "assistant-code markdown-code-block";
      block.dataset.code = source;
      const header = document.createElement("header");
      header.className = "assistant-code-toolbar";
      const language = document.createElement("span");
      language.className = "assistant-code-lang markdown-code-lang";
      language.textContent = languageLabel;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.dataset.copyCode = "true";
      copy.title = "复制代码";
      copy.setAttribute("aria-label", "复制代码");
      copy.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i>';
      header.append(language, copy);
      const body = document.createElement("pre");
      body.className = "assistant-code-body";
      const src = document.createElement("code");
      src.className = "assistant-code-src hljs";
      src.innerHTML = highlighted.html || "&nbsp;";
      if (!streaming) appendColorSwatches(src);
      body.append(src);
      pre.replaceWith(block);
      block.append(header, body);
    } catch {
      pre.classList.add("assistant-code-fallback");
    }
  });
}

function renderAssistantMarkdownHtml(content, { streaming = false } = {}) {
  const clean = DOMPurify.sanitize(marked.parse(String(content || ""), { async: false, breaks: true, gfm: true }), { USE_PROFILES: { html: true } });
  const root = document.createElement("div");
  root.innerHTML = clean;
  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  enhanceMarkdownCodeBlocks(root, { streaming });
  return root.innerHTML;
}

function fenceCount(text) {
  return (String(text || "").match(/```/g) || []).length;
}

function streamInsideFence(text) {
  return fenceCount(text) % 2 === 1;
}

function streamNeedsRebuild(previous, next) {
  if (!previous) return fenceCount(next) > 0;
  if (!next.startsWith(previous)) return true;
  return fenceCount(previous) !== fenceCount(next);
}

function takeStreamChunk(target, from, count) {
  const remain = String(target || "").slice(from);
  if (!remain) return "";
  let end = Math.min(remain.length, Math.max(1, count));
  if (end < remain.length && /[\uD800-\uDBFF]/.test(remain[end - 1])) end += 1;
  if (remain.startsWith("```")) return remain.slice(0, Math.max(end, 3));
  return remain.slice(0, end);
}

function unwrapStreamToken(span) {
  if (!span?.isConnected) return;
  span.replaceWith(document.createTextNode(span.textContent || ""));
}

function ensureStreamCaret(root, host = null) {
  let caret = root.querySelector(".assistant-stream-caret");
  if (!caret) {
    caret = document.createElement("span");
    caret.className = "assistant-stream-caret";
    caret.setAttribute("aria-hidden", "true");
  }
  if (host) {
    if (caret.parentNode !== host) host.append(caret);
    return caret;
  }
  let nextHost = root.lastElementChild;
  if (!nextHost || nextHost.matches("pre, figure, table, hr, .assistant-stream-caret")) {
    nextHost = document.createElement("p");
    root.append(nextHost);
  } else if (nextHost.matches("ul, ol")) {
    nextHost = nextHost.lastElementChild || nextHost;
  }
  if (caret.parentNode !== nextHost) nextHost.append(caret);
  return caret;
}

function appendAnimatedText(caret, text, reduceMotion) {
  if (!text) return;
  if (reduceMotion) {
    caret.before(document.createTextNode(text));
    return;
  }
  const span = document.createElement("span");
  span.className = "assistant-stream-token";
  span.textContent = text;
  caret.before(span);
  span.addEventListener("animationend", () => unwrapStreamToken(span), { once: true });
}

function appendToStreamCode(root, chunk) {
  const src = root.querySelector("figure.assistant-code:last-of-type .assistant-code-src")
    || root.querySelector("pre:last-of-type code");
  if (!src) return false;
  src.append(document.createTextNode(chunk));
  ensureStreamCaret(root, src);
  return true;
}

function startStreamParagraph(root, caret) {
  const host = caret.parentElement;
  const next = document.createElement("p");
  caret.remove();
  if (host?.parentElement === root) host.after(next);
  else root.append(next);
  next.append(caret);
}

function appendStreamChunk(root, chunk, reduceMotion, revealed) {
  if (!chunk) return;
  if (streamInsideFence(revealed)) {
    if (appendToStreamCode(root, chunk)) return;
    root.innerHTML = renderAssistantMarkdownHtml(revealed + chunk, { streaming: true });
    ensureStreamCaret(root, root.querySelector("figure.assistant-code:last-of-type .assistant-code-src"));
    return;
  }
  const caret = ensureStreamCaret(root);
  let buffer = "";
  const flush = () => {
    appendAnimatedText(caret, buffer, reduceMotion);
    buffer = "";
  };
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk[index] !== "\n") {
      buffer += chunk[index];
      continue;
    }
    flush();
    if (chunk[index + 1] === "\n") {
      index += 1;
      startStreamParagraph(root, caret);
      continue;
    }
    caret.before(document.createElement("br"));
  }
  flush();
}

function normalizeReasoningText(text) {
  return String(text || "")
    .replace(/\*\*\s*\*\*/g, "**\n\n**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AssistantReasoning({ text, pending }) {
  const value = normalizeReasoningText(text);
  const html = useMemo(() => (value ? renderAssistantMarkdownHtml(value, { streaming: false }) : ""), [value]);
  const [open, setOpen] = useState(Boolean(pending));
  useEffect(() => {
    setOpen(Boolean(pending));
  }, [pending]);
  if (!value) return null;
  return (
    <details className={`assistant-reasoning${pending ? " is-live" : ""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {pending ? <i className="reasoning-pulse" aria-hidden="true" /> : <i className="bi bi-lightbulb" aria-hidden="true" />}
        <strong>{pending ? "正在思考" : "思考过程"}</strong>
        <i className={`bi bi-chevron-down${open ? " is-open" : ""}`} aria-hidden="true" />
      </summary>
      <div className="assistant-reasoning-body" dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  );
}

function AssistantMarkdown({ content, streaming, highlightQuery = "" }) {
  const rootRef = useRef(null);
  const targetRef = useRef("");
  const revealedRef = useRef("");
  const polishedRef = useRef(false);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const carryRef = useRef(0);
  const tickRef = useRef(null);

  const stopStream = () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    lastTsRef.current = 0;
    carryRef.current = 0;
  };

  tickRef.current = (timestamp) => {
    const root = rootRef.current;
    if (!root) {
      rafRef.current = 0;
      return;
    }
    const target = targetRef.current;
    let revealed = revealedRef.current;
    if (revealed === target) {
      rafRef.current = 0;
      lastTsRef.current = 0;
      return;
    }
    if (revealed && !target.startsWith(revealed)) {
      revealed = "";
      revealedRef.current = "";
      root.innerHTML = "";
    }
    const elapsed = lastTsRef.current ? Math.min(48, timestamp - lastTsRef.current) : 16.6;
    lastTsRef.current = timestamp;
    const backlog = target.length - revealed.length;
    const rush = Math.min(1, backlog / 140);
    const msPerChar = 34 - rush * 22;
    carryRef.current += elapsed / msPerChar;
    let take = Math.floor(carryRef.current);
    if (take < 1) {
      rafRef.current = window.requestAnimationFrame((next) => tickRef.current?.(next));
      return;
    }
    carryRef.current -= take;
    take = Math.min(take, backlog);
    if (!revealed && backlog > 280) take = Math.max(take, backlog - 64);
    const chunk = takeStreamChunk(target, revealed.length, take);
    const next = revealed + chunk;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!revealed || streamNeedsRebuild(revealed, next)) {
      root.innerHTML = renderAssistantMarkdownHtml(next, { streaming: true });
      ensureStreamCaret(root, streamInsideFence(next)
        ? root.querySelector("figure.assistant-code:last-of-type .assistant-code-src")
        : null);
    } else {
      appendStreamChunk(root, chunk, reduceMotion, revealed);
    }
    revealedRef.current = next;
    rafRef.current = window.requestAnimationFrame((nextTs) => tickRef.current?.(nextTs));
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const text = String(content || "");
    if (!streaming) {
      stopStream();
      if (!polishedRef.current || revealedRef.current !== text) {
        root.innerHTML = renderAssistantMarkdownHtml(text, { streaming: false });
        polishedRef.current = true;
        revealedRef.current = text;
        targetRef.current = text;
      }
      return undefined;
    }
    polishedRef.current = false;
    targetRef.current = text;
    if (revealedRef.current && !text.startsWith(revealedRef.current)) {
      revealedRef.current = "";
      root.innerHTML = "";
    }
    if (!text && !revealedRef.current) {
      root.innerHTML = "";
      ensureStreamCaret(root);
    }
    if (!rafRef.current) {
      lastTsRef.current = 0;
      rafRef.current = window.requestAnimationFrame((timestamp) => tickRef.current?.(timestamp));
    }
    return undefined;
  }, [content, streaming]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || streaming) return;
    applyThreadSearchMarks(root, highlightQuery);
  }, [content, highlightQuery, streaming]);

  useEffect(() => () => stopStream(), []);

  const handleClick = async (event) => {
    const button = event.target.closest("[data-copy-code]");
    const block = button?.closest(".assistant-code");
    const code = block?.dataset.code ?? block?.querySelector(".assistant-code-raw")?.value;
    if (!button || code == null) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement("textarea");
      area.value = code;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "已复制");
    button.title = "已复制";
    button.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i>';
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", "复制代码");
      button.title = "复制代码";
      button.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i>';
    }, 1600);
  };

  return <div ref={rootRef} className={`assistant-markdown${streaming ? " is-streaming" : ""}`} onClick={(event) => void handleClick(event)} />;
}

function artifactLayerLabel(item = {}) {
  const count = Math.max(0, Number(item.layerCount) || 0);
  return count > 1 ? ` · ${count} 图层` : "";
}

function AssistantArtifacts({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="assistant-artifacts" aria-label="生成的文件">{items.map((item, index) => <a key={item.id || `${item.name}-${index}`} className="assistant-artifact" href={item.downloadUrl} download={item.name || "assistant-output.txt"}><i className={`bi ${documentIcon(item)}`} aria-hidden="true" /><span><strong>{item.name || "生成文件"}</strong><small>{String(item.format || "file").toUpperCase()} · {formatDocumentSize(item.sizeBytes)}{artifactLayerLabel(item)}</small></span><i className="bi bi-download" aria-hidden="true" /></a>)}</div>;
}

function ProposalSelect({ id, label, ariaLabel, valueLabel, options, disabled, open, onToggle, onPick }) {
  const wrapRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const minWidth = Math.max(rect.width, id === "model" ? 220 : 0);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const openUp = spaceBelow < 180 && rect.top > spaceBelow;
      const alignRight = id === "resolution" || id === "count";
      const next = {
        minWidth: `${minWidth}px`,
        maxHeight: `${Math.min(240, Math.max(120, openUp ? rect.top - 16 : spaceBelow))}px`,
      };
      if (openUp) next.bottom = `${window.innerHeight - rect.top + 6}px`;
      else next.top = `${rect.bottom + 6}px`;
      if (alignRight) next.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      else next.left = `${Math.max(8, rect.left)}px`;
      setMenuStyle(next);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, id, options.length, valueLabel]);

  const host = wrapRef.current?.closest(".assistant-workspace");
  const menu = open && menuStyle ? (
    <div className="agent-proposal-menu" role="listbox" aria-label={ariaLabel} style={menuStyle}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={option.selected}
          className={option.selected ? "active" : ""}
          onClick={(event) => { event.stopPropagation(); onPick(option.id); }}
        >
          {option.mark ? <i className={`ratio-shape is-${option.mark}`} style={option.markStyle} /> : null}
          <span className="agent-proposal-menu-copy">
            <strong>{option.label}</strong>
            {option.detail}
          </span>
          {option.selected ? <i className="bi bi-check-lg" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`agent-proposal-field${id === "model" ? " is-model" : ""}`}>
      <span>{label}</span>
      <div className="agent-proposal-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`agent-proposal-trigger${open ? " is-open" : ""}`}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
        >
          <span>{valueLabel}</span>
          <i className={`bi bi-chevron-down${open ? " is-open" : ""}`} aria-hidden="true" />
        </button>
        {menu && host ? createPortal(menu, host) : menu}
      </div>
    </div>
  );
}

function ProposalPromptDialog({ value, onCancel, onSave }) {
  const isDark = useIsDark();
  const [draft, setDraft] = useState(value || "");
  const textareaRef = useRef(null);
  const draftRef = useRef(draft);
  const onCancelRef = useRef(onCancel);
  const onSaveRef = useRef(onSave);
  draftRef.current = draft;
  onCancelRef.current = onCancel;
  onSaveRef.current = onSave;
  const count = assistantCharacterCount(draft);
  const overLimit = count > MAX_ASSISTANT_MESSAGE_CHARACTERS;

  useEffect(() => {
    const node = textareaRef.current;
    if (node) {
      node.focus();
      const end = node.value.length;
      node.setSelectionRange(end, end);
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (assistantCharacterCount(draftRef.current) <= MAX_ASSISTANT_MESSAGE_CHARACTERS) {
          onSaveRef.current(draftRef.current);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return createPortal(
    <div
      className={`assistant-dialog-layer agent-proposal-prompt-layer${isDark ? " is-dark" : ""}`}
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <section
        className="agent-proposal-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-proposal-prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="agent-proposal-prompt-title">编辑生成提示词</h2>
            <p>在弹窗里修改文案，确认后写回方案。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        </header>
        <textarea
          ref={textareaRef}
          rows={8}
          maxLength={12000}
          aria-label="编辑生成提示词"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <footer>
          <span className={overLimit ? "is-over" : ""}>{count.toLocaleString("zh-CN")} / 12,000</span>
          <div>
            <button type="button" onClick={onCancel}>取消</button>
            <button type="button" className="is-primary" disabled={overLimit} onClick={() => onSave(draft)}>完成</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AgentProposal({ message, imageModels, generating, executed, attachedReferences, onChange, onDismiss, onRestore, onApprove, onOpenImage }) {
  const [openMenu, setOpenMenu] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest(".agent-proposal-menu-wrap, .agent-proposal-menu")) return;
      setOpenMenu("");
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpenMenu("");
    };
    const onScroll = (event) => {
      if (event.target instanceof Element && event.target.closest(".agent-proposal-menu")) return;
      setOpenMenu("");
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [openMenu]);
  const proposal = message.proposal;
  const referenceImages = uniqueReferenceImages(attachedReferences?.length ? attachedReferences : promptNeedsRecentVisual(message.prompt) ? proposal?.referenceImages : []);
  if (!proposal) return null;
  if (proposal.dismissed) {
    return (
      <div className="agent-proposal is-dismissed">
        <button type="button" className="agent-proposal-restore" onClick={onRestore}>
          <i className="bi bi-magic" aria-hidden="true" />
          <span>创作方案已收起</span>
          <i className="bi bi-chevron-down" aria-hidden="true" />
        </button>
      </div>
    );
  }
  const selectedModel = imageModels.find((item) => item.model === proposal.model) || imageModels[0] || null;
  const modelCapabilities = normalizeImageModelCapabilities(selectedModel || {});
  const resolutions = RESOLUTIONS.filter((item) => modelCapabilities.resolutions.includes(item.id));
  const qualities = IMAGE_QUALITY_OPTIONS.filter((item) => modelCapabilities.qualities.includes(item.id));
  const ratios = getModelAspectRatiosForResolution(selectedModel, proposal.resolution).map(ratioOption);
  const counts = imageCountOptions(selectedModel);
  const referenceMode = proposalReferenceMode(proposal, referenceImages);
  const individualReferences = referenceMode === "individual" && referenceImages.length > 0;
  const proposalCount = individualReferences ? referenceImages.length : clampImageCount(proposal.count || 1, selectedModel, 1);
  const summary = proposal.planningSummary || proposal.reason || "";
  const busy = Boolean(proposal.submitting);
  const toggleMenu = (id) => setOpenMenu((current) => current === id ? "" : id);
  return (
    <div className={`agent-proposal${executed ? " is-executed" : ""}`}>
      <header className="agent-proposal-head">
        <span className="agent-proposal-icon"><i className="bi bi-stars" /></span>
        <div>
          <strong>{proposal.action === "edit" ? "图片编辑方案" : "图片生成方案"}</strong>
          {summary ? <small>{summary}</small> : null}
        </div>
        {executed ? <span className="agent-proposal-state">已执行</span> : null}
      </header>
      {referenceImages.length > 0 && (
        <div className="agent-proposal-refs" aria-label="参考图">
          {referenceImages.map((image, index) => (
            <button key={image.id || image.fileKey || index} type="button" onClick={() => onOpenImage(image, index, referenceImages)}>
              <img src={imageThumbUrl(image)} alt={image.name || `参考图 ${index + 1}`} />
              <span>图{index + 1}</span>
            </button>
          ))}
        </div>
      )}
      <div className="agent-proposal-prompt">
        <span>生成提示词</span>
        <button
          type="button"
          className={`agent-proposal-prompt-preview${proposal.prompt ? "" : " is-empty"}`}
          disabled={busy}
          aria-label="编辑生成提示词"
          onClick={() => { setOpenMenu(""); setPromptOpen(true); }}
        >
          <span>{proposal.prompt || "点击编辑生成提示词"}</span>
          <i className="bi bi-pencil" aria-hidden="true" />
        </button>
      </div>
      {promptOpen ? (
        <ProposalPromptDialog
          value={proposal.prompt || ""}
          onCancel={() => setPromptOpen(false)}
          onSave={(prompt) => { onChange({ prompt }); setPromptOpen(false); }}
        />
      ) : null}
      <div className="agent-proposal-params">
        {imageModels.length ? (
          <ProposalSelect
            id="model"
            label={<>模型{selectedModel ? <> · <ModelMenuPrice model={selectedModel} perImage /></> : null}</>}
            ariaLabel="生成模型"
            valueLabel={selectedModel?.label || proposal.modelName || proposal.model || "选择模型"}
            disabled={busy}
            open={openMenu === "model"}
            onToggle={() => toggleMenu("model")}
            onPick={(nextModel) => {
              setOpenMenu("");
              const model = imageModels.find((item) => item.model === nextModel) || selectedModel;
              if (individualReferences && imageModelMaxCount(model) < referenceImages.length) {
                notificationService.warning(`该模型最多生成 ${imageModelMaxCount(model)} 张，无法逐张处理 ${referenceImages.length} 张参考图`);
                return;
              }
              const settings = assistantImageSettings(model, proposal);
              onChange({ model: nextModel, ...settings, count: individualReferences ? referenceImages.length : clampImageCount(proposal.count, model, 1) });
            }}
            options={imageModels.map((model) => ({
              id: model.model,
              label: model.label,
              selected: (proposal.model || selectedModel?.model) === model.model,
              detail: <ModelMenuPrice model={model} perImage />,
            }))}
          />
        ) : (
          <div className="agent-proposal-field is-model">
            <span>模型</span>
            <div className="agent-proposal-readonly">{proposal.modelName || proposal.model || "模型不可用"}</div>
          </div>
        )}
        {ratios.length ? <ProposalSelect
          id="ratio"
          label="比例"
          ariaLabel="画面比例"
          valueLabel={ratios.find((item) => item.id === proposal.ratio)?.label || proposal.ratio || ratios[0]?.label}
          disabled={busy}
          open={openMenu === "ratio"}
          onToggle={() => toggleMenu("ratio")}
          onPick={(ratio) => { setOpenMenu(""); onChange({ ratio }); }}
          options={ratios.map((ratio) => ({
            id: ratio.id,
            label: ratio.label,
            selected: proposal.ratio === ratio.id,
            mark: ratio.shape,
            markStyle: ratioPreviewStyle(ratio.id),
          }))}
        /> : null}
        {resolutions.length ? <ProposalSelect
          id="resolution"
          label="清晰度"
          ariaLabel="清晰度"
          valueLabel={resolutions.find((item) => item.id === proposal.resolution)?.label || resolutions[0]?.label}
          disabled={busy}
          open={openMenu === "resolution"}
          onToggle={() => toggleMenu("resolution")}
          onPick={(resolution) => { setOpenMenu(""); onChange({ resolution }); }}
          options={resolutions.map((option) => ({
            id: option.id,
            label: option.label,
            selected: proposal.resolution === option.id,
          }))}
        /> : null}
        {qualities.length ? <ProposalSelect
          id="quality"
          label="质量"
          ariaLabel="图片质量"
          valueLabel={qualities.find((item) => item.id === (proposal.quality || qualities[0]?.id))?.label || qualities[0]?.label}
          disabled={busy}
          open={openMenu === "quality"}
          onToggle={() => toggleMenu("quality")}
          onPick={(quality) => { setOpenMenu(""); onChange({ quality }); }}
          options={qualities.map((option) => ({
            id: option.id,
            label: option.label,
            selected: (proposal.quality || qualities[0]?.id) === option.id,
          }))}
        /> : null}
        <ProposalSelect
          id="count"
          label="数量"
          ariaLabel="生成数量"
          valueLabel={`${proposalCount} 张${individualReferences ? " · 逐张" : ""}`}
          disabled={busy || individualReferences}
          open={openMenu === "count"}
          onToggle={() => toggleMenu("count")}
          onPick={(count) => { setOpenMenu(""); onChange({ count: Number(count) }); }}
          options={counts.map((count) => ({
            id: String(count),
            label: `${count} 张`,
            selected: proposalCount === count,
          }))}
        />
      </div>
      <footer className="agent-proposal-actions">
        <button type="button" className="is-secondary" disabled={busy} onClick={onDismiss}>取消</button>
        <button type="button" className="is-primary" disabled={busy || generating || !String(proposal.prompt || "").trim()} onClick={onApprove}>
          <i className={`bi ${busy ? "bi-arrow-repeat" : "bi-stars"}`} />
          <span>{busy ? "正在提交" : executed ? "再生成一组" : "开始生成"}</span>
        </button>
      </footer>
    </div>
  );
}

function AssistantMessageStatus({ message, status, contextUsage, expanded, onToggle }) {
  const pending = Boolean(message.pending);
  const progress = Math.min(92, Math.max(Number(status.progress) || 12, 12));
  const ring = 2 * Math.PI * 7;
  const usage = normalizeAssistantUsage(message);
  const elapsedMs = useElapsedMs(usageStartedAtMs(message), pending);
  const metrics = [];
  if (usage?.outputTokens) metrics.push(`消耗 ${formatContextTokens(usage.outputTokens)}`);
  if (usage?.inputTokens) metrics.push(`输入 ${formatContextTokens(usage.inputTokens)}`);
  if (usage?.firstTokenMs) metrics.push(`首字 ${formatDurationMs(usage.firstTokenMs)}`);
  return (
    <div className={`assistant-message-label is-${status.tone}${pending ? " is-live" : ""}`}>
      <div className="message-status-row">
        {pending ? (
          <div className="message-status-toggle" role="status">
            <span className="message-status-spinner" aria-hidden="true">
              <svg viewBox="0 0 18 18">
                <circle className="is-track" cx="9" cy="9" r="7" />
                <circle className="is-value" cx="9" cy="9" r="7" strokeDasharray={ring} strokeDashoffset={ring * (1 - progress / 100)} />
              </svg>
            </span>
            <strong aria-live="polite"><span>{status.label}</span></strong>
          </div>
        ) : (
          <button type="button" className="message-status-toggle" aria-expanded={expanded} onClick={() => onToggle(message.id)}>
            <span className="message-status-indicator" aria-hidden="true"><i /></span>
            <strong aria-live="polite"><span>{status.label}</span></strong>
            <i className={`bi bi-chevron-down message-status-chevron${expanded ? " is-expanded" : ""}`} aria-hidden="true" />
          </button>
        )}
        {pending && usageStartedAtMs(message) ? <b className="message-status-metrics" aria-label="已用时">{formatElapsedClock(elapsedMs)}</b> : null}
        {!pending && metrics.length ? <b className="message-status-metrics">{metrics.join(" · ")}</b> : null}
      </div>
      {!pending && expanded ? (
        <div className="message-status-detail">
          <p>{contextUsage ? "本轮实际送进模型的上下文如下。当前问题和正在生成的回复不计入条数。" : status.detail}</p>
          {contextUsage ? (
            <div className="message-context-stats">
              <div className="message-context-stat"><b>{contextUsage.usagePercent}%</b><em>上下文</em><small>{formatContextTokens(contextUsage.estimatedInputTokens)} / {formatContextTokens(contextUsage.inputBudgetTokens)}</small></div>
              <div className="message-context-stat"><b>{contextUsage.includedMessages}</b>{" "}<em>条近期消息</em></div>
              {Number(contextUsage.totalMessages) > contextUsage.includedMessages ? <div className="message-context-stat"><b>{contextUsage.totalMessages}</b><em>条对话总计</em></div> : null}
              {contextUsage.compactedMessages > 0 ? <div className="message-context-stat"><b>{contextUsage.compactedMessages}</b>{" "}<em>条已压缩</em></div> : null}
              {contextUsage.omittedMessages > 0 ? <div className="message-context-stat"><b>{contextUsage.omittedMessages}</b><em>条未纳入</em></div> : null}
              {Number(contextUsage.droppedMessages) > 0 ? <div className="message-context-stat"><b>{contextUsage.droppedMessages}</b><em>条已丢弃</em></div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ImageGenerationStage({ message, imageModelLabel, imageModels, loadedImages, onOpenImage, onImageLoad }) {
  const elapsedMs = useElapsedMs(usageStartedAtMs(message), Boolean(message.pending));
  const preparing = message.statusStage === "preparing-image";
  const previewMeta = { ...imageGenerationMeta(message, imageModels), messageId: message.id, runId: message.runId || "", model: message.model || "", requestRatio: message.requestRatio || message.ratio || "", requestSize: message.requestSize || "", width: message.width, height: message.height, quality: message.quality || "", pending: Boolean(message.pending) };
  const stageParameters = [message.ratio, message.resolution, message.quality].filter(Boolean);
  return (
    <div className="image-generation-stage">
      <div className="image-generation-summary">
        <strong>{message.prompt || "正在生成图片"}</strong>
        <span title={imageModelLabel}>{imageModelLabel}</span>
        {stageParameters.map((value) => <Fragment key={value}><i /><span>{value}</span></Fragment>)}
        <i />
        <span className="image-generation-elapsed" aria-label="已用时">{formatElapsedClock(elapsedMs)}</span>
      </div>
      <div className={`image-dream-grid${Number(message.count || 2) === 1 ? " is-single" : ""}${Number(message.count || 2) > 2 ? " is-many" : ""}`} style={{ "--image-skeleton-ratio": imageRatioValue(message), "--image-slot-count": Number(message.count || 2) }}>
        {Array.from({ length: Number(message.count || 2) }, (_, index) => {
          const image = message.images?.[index];
          const loaded = Boolean(image && loadedImages.has(`${message.id}-${index}`));
          return (
            <div key={index} className={`image-dream-slot${image ? " is-ready" : ""}${loaded ? " is-loaded" : ""}`}>
              {image && (
                <button className="image-dream-preview" type="button" title="查看大图" onClick={() => onOpenImage(image, index, message.images, previewMeta)}>
                  <img src={imageThumbUrl(image)} alt={image.revisedPrompt || "AI 生成图片"} onLoad={() => onImageLoad(message.id, index)} />
                </button>
              )}
              {(!image || !loaded) && <i className="dream-slot-spinner" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      <div className="image-generation-queue">
        <span>{preparing ? "意图识别" : "普通队列"}</span>
        <strong>{preparing ? "正在准备图片任务" : "成功进入生成阶段"}</strong>
      </div>
    </div>
  );
}

function AssistantMessageRow({ message, turnId, showDate, expanded, copied, generating, isLastAssistant, isLastUser, editing, editingDraft, moreOpen, loadedImages, failedImages, imageRetryVersions, imageModels, sourceProposal, proposalExecuted, attachedReferences, searchHit = false, searchCurrent = false, searchQuery = "", onToggleStatus, onCopy, onQuote, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference, onStartEdit, onEditDraft, onCancelEdit, onSubmitEdit, onRetry, onToggleMore, onDownloadMarkdown, onDelete, onProposalChange, onProposalDismiss, onProposalRestore, onProposalApprove, onReopenProposal }) {
  const status = message.role === "assistant" ? messageStatus(message) : null;
  const contextUsage = normalizeAssistantContext(message.context);
  const usage = normalizeAssistantUsage(message);
  const imageModelLabel = assistantModelLabel(message.model, imageModels);
  return (
    <div className="message-turn">
      {showDate && <h2 className="message-date-divider">{formatMessageDate(message.createdAt)}</h2>}
      {message.kind === "context-divider" ? <div className="assistant-context-divider"><span /><p><i className="bi bi-eraser" aria-hidden="true" /> 已从这里开始新的上下文</p><span /></div> : <article className={`message message--${message.role}${searchHit ? " is-search-hit" : ""}${searchCurrent ? " is-search-current" : ""}`} data-message-id={message.id} data-turn-id={turnId || undefined}>
        {status ? <AssistantMessageStatus message={message} status={status} contextUsage={contextUsage} expanded={expanded} onToggle={onToggleStatus} /> : null}
        {message.role === "user" && !editing && <div className="user-message-actions" aria-label="用户消息操作"><button type="button" title={copied ? "已复制" : "复制问题"} aria-label={copied ? "已复制" : "复制问题"} className={copied ? "is-copied" : ""} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button>{isLastUser && <button type="button" title="编辑问题" aria-label="编辑问题" disabled={generating} onClick={() => onStartEdit(message)}><i className="bi bi-pencil" /></button>}{isLastUser && <button type="button" title="重试" aria-label="重试" disabled={generating} onClick={() => onRetry(message)}><i className="bi bi-arrow-repeat" /></button>}</div>}
        {message.role === "user" && editing ? <div className="user-message-editor"><textarea autoFocus rows={3} aria-label="编辑问题" value={editingDraft} onChange={(event) => onEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmitEdit(message); } }} /><footer><span>{assistantCharacterCount(editingDraft.trim()).toLocaleString("zh-CN")} / 12,000</span><button type="button" onClick={onCancelEdit}>取消</button><button className="is-primary" type="button" disabled={!editingDraft.trim() || assistantCharacterCount(editingDraft.trim()) > MAX_ASSISTANT_MESSAGE_CHARACTERS || generating} onClick={() => onSubmitEdit(message)}><i className="bi bi-arrow-up" /><span>发送</span></button></footer></div> : <div className={`message-content${message.error ? " has-error" : ""}`}>
          {message.pending && message.kind === "image" ? <ImageGenerationStage message={message} imageModelLabel={imageModelLabel} imageModels={imageModels} loadedImages={loadedImages} onOpenImage={onOpenImage} onImageLoad={onImageLoad} /> : <>
            {message.role === "user" && message.quoted && <div className="sent-quote"><i className="bi bi-quote" /><span>[{message.quoted.kind}] {message.quoted.content}</span></div>}
            {message.role === "user" && uniqueReferenceImages(message.referenceImages).length > 0 && <div className="sent-reference-images">{uniqueReferenceImages(message.referenceImages).map((image, index, images) => <button key={image.id || image.fileKey || index} type="button" title="查看参考图" onClick={() => onOpenImage(image, index, images)}><img src={imageThumbUrl(image)} alt={image.name || "参考图"} /></button>)}</div>}
            {message.role === "user" && message.attachments?.length > 0 && <div className="assistant-document-chips">{message.attachments.map((item) => <span key={item.id} className="assistant-document-chip"><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{formatDocumentSize(item.sizeBytes)} · {item.pageCount ? `${item.pageCount} 页` : "文档"}</small></span></span>)}</div>}
            {message.role === "assistant" && <AssistantReasoning text={message.reasoning} pending={message.pending} />}
            {message.role === "assistant" && message.kind === "proposal" && message.proposal && <AgentProposal message={message} imageModels={imageModels} generating={generating} executed={proposalExecuted} attachedReferences={attachedReferences} onChange={onProposalChange} onDismiss={onProposalDismiss} onRestore={onProposalRestore} onApprove={onProposalApprove} onOpenImage={onOpenImage} />}
            {message.role === "assistant" && message.kind !== "proposal" && message.content && message.content !== message.error ? <AssistantMarkdown content={message.content} streaming={message.pending} highlightQuery={searchHit ? searchQuery : ""} /> : message.role !== "assistant" && message.content && message.content !== message.error ? <p>{searchHit ? highlightSearchNodes(message.content, searchQuery) : message.content}</p> : null}
            {message.role === "assistant" && <AssistantArtifacts items={message.artifacts} />}
            {message.images?.length > 0 && <GeneratedImageGrid message={message} imageModels={imageModels} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageError={onImageError} onImageRetry={onImageRetry} onUseReference={onUseReference} />}
          </>}
        </div>}
        {message.role === "assistant" && !message.pending && <><p className="message-meta">以上内容由 AI 生成{usage?.durationMs ? <b className="message-meta-duration">{formatDurationMs(usage.durationMs)}</b> : null}</p><div className="message-actions">{sourceProposal && <button className="source-proposal-button" type="button" title="回到生成这组图片的方案" onClick={onReopenProposal}><i className="bi bi-sliders" /><span>编辑方案</span></button>}<button className="regenerate-button" type="button" title="重新生成" disabled={generating || !isLastAssistant} onClick={() => onRetry(message)}><i className="bi bi-arrow-repeat" /><span>重新生成</span></button><button className={`copy-message-button${copied ? " is-copied" : ""}`} type="button" title={copied ? "已复制" : "复制回复"} aria-label={copied ? "已复制" : "复制回复"} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button><button type="button" title="引用" aria-label="引用" onClick={() => onQuote(message)}><i className="bi bi-quote" /></button><button type="button" title="更多操作" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); onToggleMore(message.id); }}><i className="bi bi-three-dots" /></button>{moreOpen && <div className="message-more-menu" onClick={(event) => event.stopPropagation()}>{message.kind !== "image" && <button type="button" onClick={() => onDownloadMarkdown(message)}><i className="bi bi-filetype-md" /><span>下载 Markdown</span></button>}<button className="is-danger" type="button" onClick={() => onDelete(message.id)}><i className="bi bi-trash3" /><span>删除</span></button></div>}</div></>}
      </article>}
    </div>
  );
}

export function AssistantWorkspaceView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const workspaceScope = `user:${auth.user?.id || "anonymous"}`;
  const mountedRef = useRef(true);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const composerRef = useRef(null);
  const composerZoneRef = useRef(null);
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
  const returnBottomTimerRef = useRef(0);
  const workspaceControllerRef = useRef(null);
  const draftRequestControllerRef = useRef(null);
  const runControllersRef = useRef(new Map());
  const uploadControllerRef = useRef(null);
  const uploadReferencesRef = useRef(null);
  const costControllerRef = useRef(null);
  const costResolverRef = useRef(null);
  const pendingLaunchRef = useRef(null);
  const activeIdRef = useRef("");
  const messagesRef = useRef([]);
  const workspaceHydratedRef = useRef(false);
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
  const [costPayload, setCostPayload] = useState(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resumeCandidates, setResumeCandidates] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageActionBusy, setImageActionBusy] = useState("");
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
  const [activeNavigatorMessageId, setActiveNavigatorMessageId] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [threadHitIndex, setThreadHitIndex] = useState(-1);

  const activeConversation = conversations.find((item) => item.id === activeId) || null;
  activeIdRef.current = activeId;
  const messages = activeConversation?.messages || [];
  messagesRef.current = messages;
  const activeRun = activeRuns[activeId] || null;
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
  const visibleAssetLibraryImages = assetLibraryImages.slice(0, assetRenderLimit);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id || "";
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === "user")?.id || "";
  const latestContext = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.kind === "context-divider") return null;
      const context = normalizeAssistantContext(messages[index]?.context);
      if (context) return context;
    }
    return null;
  }, [messages]);
  const navigatorItems = useMemo(() => messages.filter((message) => message.role === "user").map((message) => ({ id: message.id, time: formatTime(message.createdAt), preview: messagePreview(message.content) })), [messages]);
  const activeNavigatorIndex = navigatorItems.findIndex((item) => item.id === activeNavigatorMessageId);

  const patchConversation = useCallback((id, patcher) => {
    setConversations((current) => current.map((item) => item.id === id ? patcher(item) : item));
  }, []);

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
    if (!conversationId) return;
    setActiveRuns((current) => ({ ...current, [conversationId]: run }));
  }, []);

  const clearConversationRun = useCallback((conversationId) => {
    if (!conversationId) return;
    setActiveRuns((current) => {
      if (!current[conversationId]) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const setScrollState = useCallback((atBottom, returning = returningRef.current) => {
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

  const handleMessageScroll = useCallback(() => {
    const scroller = messageScrollerRef.current;
    if (!scroller) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40;
    const leftBottom = atBottomRef.current && !atBottom;
    setScrollState(atBottom, atBottom ? false : returningRef.current);
    if (leftBottom) {
      setCreationMenuOpen(false);
      setModelMenuOpen(false);
      setReasoningMenuOpen(false);
      setPreferencesOpen(false);
    }
    if (scroller.scrollTop <= 36 && hiddenMessageCount > 0 && !loadingEarlierRef.current) {
      loadingEarlierRef.current = true;
      const previousHeight = scroller.scrollHeight;
      setVisibleMessageLimit((current) => Math.min(messages.length, current + MESSAGE_BATCH_SIZE));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const currentScroller = messageScrollerRef.current;
        if (currentScroller) currentScroller.scrollTop += currentScroller.scrollHeight - previousHeight;
        loadingEarlierRef.current = false;
      }));
    }
    const target = scroller.scrollTop + scroller.clientHeight * 0.28;
    let activeTurn = navigatorItems[0]?.id || "";
    let distance = Number.POSITIVE_INFINITY;
    scroller.querySelectorAll(".message[data-turn-id]").forEach((element) => {
      const nextDistance = Math.abs(element.offsetTop - target);
      if (nextDistance < distance) {
        distance = nextDistance;
        activeTurn = element.dataset.turnId || activeTurn;
      }
    });
    setActiveNavigatorMessageId(activeTurn);
  }, [hiddenMessageCount, messages.length, navigatorItems, setScrollState]);

  const scrollToMessage = useCallback((messageId, behavior = "smooth") => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const requiredCount = messages.length - index;
    if (index < firstRenderedMessageIndex) setVisibleMessageLimit(Math.min(messages.length, Math.ceil(requiredCount / MESSAGE_BATCH_SIZE) * MESSAGE_BATCH_SIZE));
    setActiveNavigatorMessageId(messageId);
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
      if (!height || height === previousHeight) return;
      previousHeight = height;
      workspace.style.setProperty("--assistant-composer-reserved-space", `${Math.max(250, height + 32)}px`);
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
      if (typeof workspaceState.draft === "string") setDraft(workspaceState.draft.slice(0, 12000));
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
        const runs = runResult.value.filter((item) => rows.some((conversation) => conversation.id === item.conversationId)).slice(0, 4);
        setActiveRuns(Object.fromEntries(runs.map((run) => [run.conversationId, run])));
        setResumeCandidates(runs);
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
    void import("./CommercialHomeView.jsx");
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

  const closeSearch = () => {
    setSearchOpen(false);
  };

  const handleSearchExited = () => {
    setSearchQuery("");
    setSearchCursor(-1);
  };

  const openConversation = (conversation) => {
    closeSearch();
    setConversationPeek(null);
    setConversationMenuId("");
    setActiveId(conversation.id);
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
    setActiveId("");
    setDraft("");
    setReferences([]);
    for (const item of documents) {
      if (!item.retained) void deleteAssistantFile(item.id).catch(() => undefined);
    }
    setDocuments([]);
    setQuotedMessage(null);
    setVisibleMessageLimit(MESSAGE_BATCH_SIZE);
    setCreationType("chat");
    setCreationMenuOpen(false);
    setModelMenuOpen(false);
    setPreferencesOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

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
	if (psdFiles.length) notificationService.warning("AI 助手暂不支持 PSD 文件");
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
        const result = await uploadFile(file, { signal: controller.signal });
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
    const imageCount = Math.max(1, Math.min(4, Number(requestedCount) || 1));
    const chatModel = conversationModels.find((item) => item.model === requestedModel) || conversationModels.find((item) => item.model === conversationModel) || conversationModels[0];
    const imagePriceModel = imageModels.find((item) => item.model === requestedModel) || selectedImageModel;
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
        ? "提交后按图片数量预留费用，成功结算；失败自动退回。主动停止不退还本轮积分。"
        : responseMode === "agent"
          ? `${requestedEffortLabel}推理为 ${chatUnit} 积分/轮；本轮只收 Agent 推理费用，执行生图时另行确认图片费用。主动停止不退还本轮积分。`
          : `${requestedEffortLabel}推理为 ${chatUnit} 积分/轮；成功后结算，失败自动退回。主动停止不退还本轮积分。`,
    });
    return new Promise((resolve) => { costResolverRef.current = resolve; });
  };

  const applyRunResult = useCallback((conversationId, localAssistantId, data) => {
    const persisted = data?.assistantMessage;
    const run = data?.run || {};
    const terminal = TERMINAL_RUN_STATUSES.has(run.status) || ["complete", "failed"].includes(persisted?.status);
    patchConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: persisted?.updatedAt || new Date().toISOString(),
      messages: conversation.messages.map((message) => message.id === localAssistantId
        ? {
            ...message,
            ...(persisted || {}),
            id: persisted?.id || message.id,
            content: persisted?.content || message.content,
            images: Array.isArray(persisted?.images) ? persisted.images : message.images,
            artifacts: Array.isArray(persisted?.artifacts) ? persisted.artifacts : terminal ? [] : message.artifacts,
            kind: run.resolvedMode || persisted?.kind || message.kind,
            usage: mergeAssistantUsage(message.usage, persisted?.usage, terminal ? {
              durationMs: usageStartedAtMs(message) ? Math.max(1, Date.now() - usageStartedAtMs(message)) : 0,
              outputTokens: estimateAssistantTokens(persisted?.content ?? message.content),
              inputTokens: Number(persisted?.context?.estimatedInputTokens ?? message.context?.estimatedInputTokens) || 0,
            } : {}),
            usageStartedAt: usageStartedAtMs(message) || usageStartedAtMs(persisted) || Date.now(),
            reasoning: persisted?.reasoning || message.reasoning,
            pending: terminal ? false : ["queued", "running"].includes(run.status || persisted?.status),
            error: run?.errorMessage || persisted?.error || "",
            statusStage: terminal ? persisted?.statusStage || (run.status === "canceled" ? "stopped" : undefined) : run?.stage || persisted?.statusStage,
          }
        : message),
    }));
    if (conversationId === activeIdRef.current) followConversationBottom();
    if (terminal) {
      clearConversationRun(conversationId);
      scheduleWalletRefresh();
    }
  }, [clearConversationRun, followConversationBottom, patchConversation]);

  const monitorRun = useCallback(async (conversationId, assistantMessageId, run, controller) => {
    if (!run?.id) return;
    setConversationRun(conversationId, run);
    const stream = openAssistantRunStream(run.id, {
      onEvent: (event) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        patchConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (message.id !== assistantMessageId || !message.pending) return message;
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
            const extras = {};
            if (hasVisible) extras.firstTokenMs = Math.max(1, Date.now() - startedAt);
            if (event?.done) extras.durationMs = Math.max(1, Date.now() - startedAt);
            const usage = event?.usage || extras.firstTokenMs || extras.durationMs
              ? mergeAssistantUsage(message.usage, event?.usage, extras)
              : message.usage;
            return {
              ...message,
              usageStartedAt: startedAt,
              ...(typeof event?.content === "string" && event.content ? { content: event.content } : {}),
              ...(typeof event?.reasoning === "string" && event.reasoning ? { reasoning: event.reasoning } : {}),
              ...(event?.kind ? { kind: event.kind === "agent" ? message.kind : event.kind } : {}),
              ...(event?.stage ? { statusStage: event.stage } : {}),
              ...(event?.context ? { context: event.context } : {}),
              ...(usage ? { usage } : {}),
              ...(event?.image ? { images, kind: "image", count: event.imageTotal || message.count } : {}),
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

  const launchRun = useCallback(async ({ conversationId, prompt, userMessage, assistantMessage, responseMode, sourceUserMessageId = "", proposalSourceMessageId = "", maskEdit = null }) => {
    const controller = new AbortController();
    runControllersRef.current.get(conversationId)?.abort();
    runControllersRef.current.set(conversationId, controller);
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
        sourceUserMessageId,
        proposalSourceMessageId,
        referenceImages: (userMessage.referenceImages || []).map((image) => ({ name: image.name, dataUrl: image.dataUrl, thumbnailUrl: image.thumbnailUrl, fileKey: image.fileKey })),
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
      }, { signal: controller.signal });
      if (!mountedRef.current) return;
      applyRunResult(conversationId, assistantMessage.id, created);
      scheduleWalletRefresh();
      if (created.run?.id && !TERMINAL_RUN_STATUSES.has(created.run.status)) {
        await monitorRun(conversationId, assistantMessage.id, created.run, controller);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        patchConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, pending: false, routing: false, statusStage: "failed", error: error?.message || "生成失败，请稍后重试", content: message.content || error?.message || "生成失败，请稍后重试" } : message) }));
      }
      clearConversationRun(conversationId);
    } finally {
      if (runControllersRef.current.get(conversationId) === controller) runControllersRef.current.delete(conversationId);
    }
  }, [activeReasoningEffort, applyRunResult, clearConversationRun, conversationModel, generationCount, generationQuality, generationRatio, generationResolution, imageModel, imageModels, monitorRun, patchConversation, selectedImageModel]);

  const submitRegionEdit = useCallback(async (payload, item, meta = {}) => {
    if (!item || !payload?.prompt || !activeConversation || activeRun || imageActionBusy) return false;
    const preferredModel = String(meta.model || imageModel || imageModels[0]?.model || "");
    const selected = imageModels.find((item) => item.model === preferredModel) || selectedImageModel;
    setImageActionBusy("region-edit");
    try {
      if (!(await confirmAssistantCost("image", 1, preferredModel, ""))) return false;
      const [cropUpload, maskUpload] = await Promise.all([
        uploadFile(payload.cropFile),
        uploadFile(payload.maskFile),
      ]);
      let baseImage = item.fileKey
        ? { id: item.id || "", name: "局部编辑底图", fileKey: item.fileKey, dataUrl: imageUrl(item) }
        : null;
      if (!baseImage) {
        if (!payload.baseFile) throw new Error("原始底图无法上传");
        const baseUpload = await uploadFile(payload.baseFile);
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
      const assistantMessage = createAssistantPlaceholder({
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
  }, [activeConversation, activeRun, confirmAssistantCost, generationQuality, generationRatio, generationResolution, imageActionBusy, imageModel, imageModels, launchRun, patchConversation, scrollToBottom, selectedImageModel]);

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
    const assistantMessage = createAssistantPlaceholder({
      prompt,
      responseMode,
      userMessageId,
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
    const userMessage = { id: userMessageId, role: "user", content: prompt, kind: "chat", quoted: currentQuote, referenceImages: references, attachments: documents.filter((item) => item.status === "ready"), createdAt: new Date().toISOString() };
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
  }, [activeConversation, activeReasoningEffort, conversationModel, conversationModels, creationType, documents, generationCount, generationQuality, generationRatio, generationResolution, imageModel, imageModels, launchRun, maxImages, maxReferences, patchConversation, quotedMessage, references, scrollToBottom, selectedImageModel]);

  useEffect(() => {
    if (!resumeCandidates.length) return;
    const candidates = resumeCandidates;
    setResumeCandidates([]);
    for (const run of candidates) {
      const conversation = conversations.find((item) => item.id === run.conversationId);
      const assistantMessage = conversation?.messages.find((item) => item.id === run.assistantMessageId);
      if (!conversation || !assistantMessage) {
        clearConversationRun(run.conversationId);
        continue;
      }
      const controller = new AbortController();
      runControllersRef.current.set(conversation.id, controller);
      void monitorRun(conversation.id, assistantMessage.id, run, controller).catch((error) => {
        if (error?.name !== "AbortError" && mountedRef.current) {
          patchConversation(conversation.id, (item) => ({ ...item, messages: item.messages.map((message) => message.id === assistantMessage.id ? { ...message, pending: false, error: error?.message || "任务状态恢复失败", statusStage: "failed" } : message) }));
          clearConversationRun(conversation.id);
        }
      }).finally(() => {
        if (runControllersRef.current.get(conversation.id) === controller) runControllersRef.current.delete(conversation.id);
      });
    }
  }, [clearConversationRun, conversations, monitorRun, patchConversation, resumeCandidates]);

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
    if (Object.keys(activeRuns).length >= 4 && !activeRuns[activeId]) {
      notificationService.warning("最多可同时运行 4 个对话任务，请等待其中一个完成");
      return;
    }
    if (isImageToPSDRequest(prompt, references.length)) {
      notificationService.warning("AI 助手暂未开放 PSD 转换");
      return;
    }
    const { responseMode, sendModel, requestedCount } = resolveAssistantSend(prompt);
    if (creationType === "image" && responseMode !== "image") {
      notificationService.info("这句话不像画面描述，已按对话回复，不会生成图片");
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
    if (!activeConversation || activeRun || !messages.length || messages.at(-1)?.kind === "context-divider") return;
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
    if (activeRun || message?.id !== lastUserMessageId) return;
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
    if (!activeConversation || activeRun || message?.id !== lastUserMessageId) return;
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
    if (!activeConversation || activeRun) return;
    const target = message?.role === "user"
      ? messages[messages.findIndex((item) => item.id === message.id) + 1]
      : message;
    if (!target || target.role !== "assistant" || target.id !== lastAssistantId) return;
    const index = messages.findIndex((item) => item.id === target.id);
    const userMessage = messages[index - 1];
    const prompt = String(userMessage?.content || "").trim();
    if (index < 1 || userMessage?.role !== "user" || !prompt) return;
    const requestedMode = messageResponseMode(target);
    const responseMode = assistantSendMode(requestedMode, 0, prompt);
    const model = modelForMode(responseMode, responseMode === requestedMode ? target.model : "");
    const retryEffort = target.reasoningEffort || activeReasoningEffort;
    const retryModel = imageModels.find((item) => item.model === model) || selectedImageModel;
    const retryCount = responseMode === "image" ? clampImageCount(target.count || generationCount, retryModel) : 1;
    const retrySettings = assistantImageSettings(retryModel, {
      ratio: target.requestRatio || target.ratio || generationRatio,
      resolution: target.resolution || generationResolution,
      quality: target.quality || generationQuality,
    });
    if (!(await confirmAssistantCost(responseMode, retryCount, model, retryEffort))) return;
    const assistantMessage = createAssistantPlaceholder({
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
    patchConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      updatedAt: assistantMessage.createdAt,
      messages: [...conversation.messages.slice(0, index), assistantMessage],
    }));
    await launchRun({ conversationId: activeConversation.id, prompt, userMessage, assistantMessage, responseMode, sourceUserMessageId: userMessage.id });
  };

  const submitUserMessageEdit = async (message) => {
    const prompt = editingMessageDraft.trim();
    if (!activeConversation || activeRun || !prompt || assistantCharacterCount(prompt) > MAX_ASSISTANT_MESSAGE_CHARACTERS || message.id !== lastUserMessageId) return;
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
    const assistantMessage = createAssistantPlaceholder({
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
    const editedUser = { ...message, content: prompt, editedAt: new Date().toISOString() };
    patchConversation(activeConversation.id, (conversation) => ({ ...conversation, title: messageIndex === 0 ? conversationTitle(prompt) : conversation.title, updatedAt: assistantMessage.createdAt, messages: [...conversation.messages.slice(0, messageIndex), editedUser, assistantMessage] }));
    cancelUserMessageEdit();
    await launchRun({ conversationId: activeConversation.id, prompt, userMessage: editedUser, assistantMessage, responseMode, sourceUserMessageId: message.id });
  };

  const updateProposal = (messageId, patch) => {
    patchConversation(activeId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => {
      if (message.id !== messageId || !message.proposal) return message;
      const next = { ...message.proposal, ...patch };
      const selected = imageModels.find((item) => item.model === next.model) || imageModels[0];
      Object.assign(next, assistantImageSettings(selected, next));
      next.count = clampImageCount(next.count, selected, 1);
      return { ...message, proposal: next };
    }) }));
  };

  const approveAgentProposal = async (message) => {
    const proposal = message?.proposal;
    const prompt = String(proposal?.prompt || "").trim();
    if (!activeConversation || activeRun || proposal?.submitting || !prompt) return;
    if (Object.keys(activeRuns).length >= 4 && !activeRuns[activeConversation.id]) {
      notificationService.warning("最多可同时运行 4 个对话任务，请稍后再试");
      return;
    }
    const model = modelForMode("image", proposal.model);
    const selected = imageModels.find((item) => item.model === model) || selectedImageModel;
    const request = imageRequestFromProposal(proposal, selected);
    const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
    const sourceUser = (message.userMessageId && activeConversation.messages.find((item) => item.id === message.userMessageId))
      || [...activeConversation.messages.slice(0, Math.max(0, messageIndex))].reverse().find((item) => item.role === "user");
    const sourcePrompt = sourceUser?.content || message.prompt || "";
    const referenceImages = uniqueReferenceImages(sourceUser?.referenceImages?.length ? sourceUser.referenceImages : promptNeedsRecentVisual(sourcePrompt) ? proposal.referenceImages : []);
    const referenceMode = proposalReferenceMode(proposal, referenceImages);
    let count = clampImageCount(proposal.count, selected, 1);
    if (referenceMode === "individual") {
      if (!referenceImages.length || imageModelMaxCount(selected) < referenceImages.length) {
        notificationService.warning("当前模型无法按参考图数量逐张生成，请调整模型或参考图");
        return;
      }
      count = referenceImages.length;
    }
    if (!(await confirmAssistantCost("image", count, model))) return;
    const userMessage = { id: uid(), role: "user", content: "执行这个创作方案", createdAt: new Date().toISOString(), proposalSourceMessageId: message.id, referenceMode, referenceImages: referenceImages.map((image) => ({ ...image })) };
    const assistantMessage = createAssistantPlaceholder({ prompt, responseMode: "image", userMessageId: userMessage.id, defaults: { model, ratio: request.ratio, requestRatio: request.ratio, resolution: request.resolution, count, requestSize: request.requestSize, width: request.width, height: request.height, quality: request.quality, referenceMode } });
    updateProposal(message.id, { submitting: true, dismissed: false });
    patchConversation(activeConversation.id, (conversation) => ({ ...conversation, updatedAt: userMessage.createdAt, messages: [...conversation.messages, userMessage, assistantMessage] }));
    try {
      await launchRun({ conversationId: activeConversation.id, prompt, userMessage, assistantMessage, responseMode: "image", proposalSourceMessageId: message.id });
    } finally {
      if (mountedRef.current) updateProposal(message.id, { submitting: false });
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
    scrollToMessage(proposalMessage.id);
  };

  const stopRun = async () => {
    if (!activeRun?.id || stopBusy) return;
    const stoppingRun = activeRun;
    setStopBusy(true);
    try {
      const result = await cancelAssistantRun(stoppingRun.id);
      if (!result?.canceled) {
        setStopConfirmOpen(false);
        notificationService.info("任务已经结束，无需停止");
        return;
      }
      runControllersRef.current.get(activeId)?.abort();
      runControllersRef.current.delete(activeId);
      if (stoppingRun.conversationId && stoppingRun.assistantMessageId) {
        patchConversation(stoppingRun.conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === stoppingRun.assistantMessageId
            ? { ...message, pending: false, routing: false, statusStage: "stopped", content: message.content || "你已主动停止生成" }
            : message),
        }));
      }
      clearConversationRun(stoppingRun.conversationId || activeId);
      setStopConfirmOpen(false);
      scheduleWalletRefresh();
      notificationService.warning("你已主动停止生成，本轮积分不退还");
    } catch (error) {
      setStopConfirmOpen(false);
      notificationService.error(error?.message || "停止任务失败");
    } finally {
      if (mountedRef.current) setStopBusy(false);
    }
  };

  const deleteConversationRow = async () => {
    if (!deleteTarget) return;
    try {
      const deletingRun = activeRuns[deleteTarget.id];
      await deleteAssistantConversation(deleteTarget.id, { cancelActive: Boolean(deletingRun) });
      runControllersRef.current.get(deleteTarget.id)?.abort();
      runControllersRef.current.delete(deleteTarget.id);
      clearConversationRun(deleteTarget.id);
      setConversations((current) => {
        const next = current.filter((item) => item.id !== deleteTarget.id);
        if (activeId === deleteTarget.id) setActiveId(next.find((item) => item.messages.length)?.id || "");
        return next;
      });
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
  const canSend = draftCharacterCount > 0 && draftCharacterCount <= MAX_ASSISTANT_MESSAGE_CHARACTERS && !documents.some((item) => item.status !== "ready") && !activeRun && !costPayload && !loading && !serviceError && !uploading;
  const voiceBusy = Boolean(activeRun) || Boolean(serviceError);
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

  return (
    <div className={`assistant-workspace${isDark ? " is-dark" : ""}${activeRun ? " is-generating" : ""}${sidebarCollapsed ? " is-sidebar-narrow" : ""}${sidebarAnimating ? " is-sidebar-animating" : ""}`} onClick={() => { setCreationMenuOpen(false); setModelMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); setActiveMessageMenuId(""); setConversationMenuId(""); }}>
      <aside className="assistant-sidebar" onClick={(event) => { event.stopPropagation(); if (!event.target.closest(".conversation-more")) setConversationMenuId(""); }}>
        <button className="icon-button sidebar-close" type="button" title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={updateSidebar}><i className={`bi bi-chevron-left${sidebarCollapsed ? " is-collapsed" : ""}`} /></button>
        <div className="assistant-sidebar-body">
        <div className="assistant-brand-row"><div className="assistant-brand"><strong>开启创作</strong></div></div>
        <nav className="sidebar-nav" aria-label="创作入口">
          <button className="sidebar-nav-item" type="button" onClick={() => setSearchOpen(true)}>
            <i className="bi bi-search" aria-hidden="true" />
            <span>搜索</span>
          </button>
          <button className={`sidebar-nav-item${!activeId ? " is-active" : ""}`} type="button" onClick={newConversation}>
            <NewChatIcon />
            <span>新对话</span>
          </button>
          <button className={`sidebar-nav-item${assetLibraryOpen ? " is-active" : ""}`} type="button" onClick={() => setAssetLibraryOpen((value) => !value)}>
            <i className="bi bi-grid" aria-hidden="true" />
            <span>资产库</span>
          </button>
        </nav>
        <div className="sidebar-history">
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
                        <button className="conversation-select" type="button" title={conversation.title} onClick={() => { setConversationPeek(null); setConversationMenuId(""); setActiveId(conversation.id); }}>
                          <span className={`history-thumb${thumbnail ? " has-image" : ""}`}>
                            {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : <b>{conversationMark(conversation)}</b>}
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
        </div>
        <div className="assistant-sidebar-rail" aria-hidden={!sidebarCollapsed}>
          <button className="assistant-rail-new" type="button" title="搜索" onClick={() => setSearchOpen(true)}><i className="bi bi-search" /></button>
          <button className="assistant-rail-new" type="button" title="新对话" onClick={newConversation}><NewChatIcon /></button>
          <button className={`assistant-rail-new${assetLibraryOpen ? " is-active" : ""}`} type="button" title="资产库" onClick={() => setAssetLibraryOpen((value) => !value)}><i className="bi bi-grid" /></button>
          <button className="assistant-rail-history" type="button" title="历史" aria-label="历史" onClick={() => { setHistoryOpen(true); if (sidebarCollapsed) updateSidebar(); }}>
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
                  onClick={() => { setConversationPeek(null); setActiveId(conversation.id); }}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setConversationPeek({ conversation, top: Math.max(64, Math.min(rect.top, window.innerHeight - 176)) });
                  }}
                  onMouseLeave={() => setConversationPeek(null)}
                >
                  <span className={`assistant-rail-thumb${thumbnail ? " has-image" : ""}`}>
                    {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : <b>{conversationMark(conversation)}</b>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
      {conversationPeek && createPortal(<div className={`assistant-conversation-peek${isDark ? " is-dark" : ""}`} style={{ top: `${conversationPeek.top}px` }} aria-hidden="true"><strong>{conversationPeek.conversation.title}</strong>{(conversationPeek.conversation.messages || []).slice(-2).map((message, index) => <p key={`${message.id}-${index}`}><b>{message.role === "user" ? "我" : "AI"}</b>{message.images?.length ? `[图片 ×${message.images.length}]` : messagePreview(message.content)}</p>)}<small>{formatTime(conversationPeek.conversation.updatedAt)}</small></div>, document.body)}

      <main className={`assistant-main${messages.length ? "" : " is-empty"}`}>
        <div className="assistant-ambient-stage" aria-hidden="true"><i className="ambient-blob is-a" /><i className="ambient-blob is-b" /><i className="ambient-blob is-c" /></div>
        {messages.length > 0 && <header className="assistant-topbar"><div className="topbar-title"><label className="thread-search"><i className="bi bi-search" /><input value={threadSearch} type="text" placeholder="搜索对话历史" aria-label="搜索对话历史" autoComplete="off" onChange={(event) => { setThreadSearch(event.target.value); setThreadHitIndex(-1); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setThreadSearch(""); setThreadHitIndex(-1); return; } if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); jumpToThreadHit(event.shiftKey ? -1 : 1); }} />{threadSearch.trim() ? <span className="thread-search-count" aria-live="polite">{threadSearchHits.length ? (threadHitIndex >= 0 ? `${threadHitIndex + 1}/${threadSearchHits.length}` : `${threadSearchHits.length} 条`) : "无结果"}</span> : null}{threadSearch.trim() ? <button type="button" title="上一条" aria-label="上一条匹配" disabled={!threadSearchHits.length} onClick={() => jumpToThreadHit(-1)}><i className="bi bi-chevron-up" /></button> : null}{threadSearch.trim() ? <button type="button" title="下一条" aria-label="下一条匹配" disabled={!threadSearchHits.length} onClick={() => jumpToThreadHit(1)}><i className="bi bi-chevron-down" /></button> : null}{threadSearch ? <button type="button" title="清空搜索" aria-label="清空搜索" onClick={() => { setThreadSearch(""); setThreadHitIndex(-1); }}><i className="bi bi-x" /></button> : null}</label></div><div className="topbar-filters"><button type="button" title={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : "清除上文并保留可见历史"} aria-label={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : "清除上文并保留可见历史"} disabled={Boolean(activeRun) || messages.at(-1)?.kind === "context-divider"} onClick={() => void clearConversationContext()}><i className="bi bi-eraser" /><span>清除上文</span></button><button type="button" className={assetLibraryOpen ? "active" : ""} aria-pressed={assetLibraryOpen} title="资产库" aria-label="资产库" onClick={(event) => { event.stopPropagation(); setAssetLibraryOpen((value) => !value); }}><i className="bi bi-archive" /><span>资产库</span></button></div></header>}
        <div ref={messageScrollerRef} className="assistant-messages" onScroll={handleMessageScroll}>
          {loading ? <section className="assistant-thread-skeleton" aria-label="正在加载"><div className="sk-bubble is-user"><i style={{ width: "46%" }} /></div><div className="sk-bubble"><i style={{ width: "82%" }} /><i style={{ width: "64%" }} /></div><div className="sk-bubble is-user"><i style={{ width: "30%" }} /></div><div className="sk-bubble"><i style={{ width: "74%" }} /><i style={{ width: "40%" }} /></div></section> : messages.length === 0 ? <section className="assistant-empty-state" aria-label="空白创作区"><div className="assistant-empty-content"><span className="empty-mark"><i className="bi bi-stars" /></span><p className="empty-mode-label"><i className={`bi ${selectedCreation.icon}`} />{CREATION_TYPE_DESCRIPTIONS[creationType]}</p><h1>今天想创作什么？</h1><div className="suggestion-grid">{SUGGESTIONS.map(([icon, text]) => <button key={text} type="button" onClick={() => { setDraft(text); textareaRef.current?.focus(); }}><i className={`bi ${icon}`} /><span>{text}</span><i className="bi bi-arrow-up-right suggestion-arrow" /></button>)}</div></div></section> : <section className="message-thread" aria-live="polite">{hiddenMessageCount > 0 && <button className="load-earlier-messages" type="button" disabled={loadingEarlierRef.current} onClick={() => { const scroller = messageScrollerRef.current; if (scroller) scroller.scrollTop = 0; }}><i className="bi bi-clock-history" /><span>加载更早的对话（{hiddenMessageCount}）</span></button>}<div className="message-turns">{renderedMessages.map((message, offset) => {
            const originalIndex = firstRenderedMessageIndex + offset;
            const previous = messages[originalIndex - 1];
            const currentDate = new Date(message.createdAt);
            const previousDate = new Date(previous?.createdAt);
            const showDate = originalIndex === 0 || Number.isNaN(previousDate.getTime()) || currentDate.toDateString() !== previousDate.toDateString();
            const previousUser = message.role === "user" ? message : [...messages.slice(0, originalIndex)].reverse().find((item) => item.role === "user");
            const sourceProposal = sourceProposalForImage(message);
            return <AssistantMessageRow key={message.id} message={message} turnId={previousUser?.id} showDate={showDate} expanded={expandedStatusId === message.id} copied={copiedMessageId === message.id} generating={Boolean(activeRun)} isLastAssistant={message.id === lastAssistantId} isLastUser={message.id === lastUserMessageId} editing={editingMessageId === message.id} editingDraft={editingMessageDraft} moreOpen={activeMessageMenuId === message.id} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} imageModels={imageModels} sourceProposal={sourceProposal} proposalExecuted={messages.some((item) => item.role === "user" && item.proposalSourceMessageId === message.id)} attachedReferences={previousUser?.referenceImages} searchHit={threadSearchHitIds.has(message.id)} searchCurrent={message.id === currentThreadHitId} searchQuery={threadSearch} onToggleStatus={toggleStatus} onCopy={copyMessage} onQuote={quoteMessage} onOpenImage={openImage} onImageLoad={markImageLoaded} onImageError={markImageFailed} onImageRetry={retryImage} onUseReference={useGeneratedImageAsReference} onStartEdit={startEditingUserMessage} onEditDraft={setEditingMessageDraft} onCancelEdit={cancelUserMessageEdit} onSubmitEdit={(item) => void submitUserMessageEdit(item)} onRetry={(item) => void retryAssistant(item)} onToggleMore={(id) => setActiveMessageMenuId((current) => current === id ? "" : id)} onDownloadMarkdown={downloadMarkdown} onDelete={(id) => void removeMessage(id)} onProposalChange={(patch) => updateProposal(message.id, patch)} onProposalDismiss={() => updateProposal(message.id, { dismissed: true })} onProposalRestore={() => { updateProposal(message.id, { dismissed: false }); scrollToMessage(message.id); }} onProposalApprove={() => void approveAgentProposal(message)} onReopenProposal={() => reopenSourceProposal(sourceProposal)} />;
          })}</div></section>}
        </div>

        {navigatorItems.length > 0 && (
          <nav className="conversation-minimap" aria-label="对话位置导航">
            {navigatorItems.map((item, index) => {
              const isActive = item.id === activeNavigatorMessageId;
              const isMajor = (index + 1) % 5 === 0 && index !== activeNavigatorIndex;
              const position = activeNavigatorIndex >= 0 && index < activeNavigatorIndex
                ? "is-past"
                : activeNavigatorIndex >= 0 && index > activeNavigatorIndex
                  ? "is-ahead"
                  : "";
              return (
                <button
                  key={item.id}
                  type="button"
                  className={[isActive ? "active" : "", position, isMajor ? "is-major" : ""].filter(Boolean).join(" ")}
                  aria-label={`跳转到问题：${item.preview}`}
                  onClick={(event) => {
                    const tick = event.currentTarget;
                    tick.classList.remove("is-clicked");
                    void tick.offsetWidth;
                    tick.classList.add("is-clicked");
                    window.setTimeout(() => tick.classList.remove("is-clicked"), 320);
                    scrollToMessage(item.id, "auto");
                  }}
                >
                  <i />
                  <span className="conversation-minimap-preview">
                    <small><b>问</b>{item.time}</small>
                    <strong>{item.preview}</strong>
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <div ref={composerZoneRef} className={`composer-zone${composerScrolledAway ? " is-scrolled-away" : ""}`} onClick={(event) => event.stopPropagation()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadReferences(event.dataTransfer.files); }}>
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
            {creationMenuOpen && <section className="composer-popover creation-type-menu"><p className="popover-eyebrow">创作类型</p>{CREATION_TYPES.map((type) => <button key={type.id} type="button" className={creationType === type.id ? "active" : ""} disabled={type.id === "image" && documents.length > 0} title={type.id === "image" && documents.length > 0 ? "先移除文档附件" : undefined} onClick={() => { setCreationType(type.id); setCreationMenuOpen(false); }}><i className={`bi ${type.icon}`} /><span>{type.label}</span>{creationType === type.id && <i className="bi bi-check-lg menu-check" />}</button>)}</section>}
            {modelMenuOpen && <section className="composer-popover image-model-menu" style={{ "--model-menu-left": "168px" }}><header className="model-menu-head"><p className="popover-eyebrow">{mode === "image" ? "选择图片模型" : "选择对话模型"}</p><span>{generationModels.length} 个模型</span></header>{generationModels.length > 6 && <div className="model-menu-search"><i className="bi bi-search" /><input value={modelSearch} type="text" placeholder="搜索模型名称" autoComplete="off" onChange={(event) => setModelSearch(event.target.value)} />{modelSearch && <button type="button" aria-label="清空模型搜索" title="清空" onClick={() => setModelSearch("")}><i className="bi bi-x-lg" /></button>}</div>}<div className="model-menu-options">{filteredGenerationModels.map((model) => <button key={model.model} type="button" className={generationModel === model.model ? "active" : ""} onClick={() => { mode === "image" ? setImageModel(model.model) : setConversationModel(model.model); setModelMenuOpen(false); setModelSearch(""); }}><span className="model-mark"><i className="bi bi-stars" /></span><span className="model-copy"><strong>{model.label}</strong></span><ModelMenuPrice model={mode === "image" ? model : modelWithReasoningPrice(model)} perImage={mode === "image"} /><span className="model-menu-check-slot">{generationModel === model.model && <i className="bi bi-check-lg menu-check" />}</span></button>)}{!filteredGenerationModels.length && <p className="skill-empty">{modelSearch ? "没有匹配的模型" : "后台暂未提供可用模型"}</p>}</div></section>}
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
              <section className="composer-popover image-mode-preferences" aria-label="图片生成参数">
                {availableRatios.length ? <div className="preferences-block">
                  <p className="preferences-label">选择比例</p>
                  <div className="ratio-options">
                    {availableRatios.map((item) => (
                      <button key={item.id} type="button" className={generationRatio === item.id ? "active" : ""} aria-pressed={generationRatio === item.id} onClick={() => setGenerationRatio(item.id)}>
                        <i className={`ratio-shape is-${item.shape}`} style={ratioPreviewStyle(item.id)} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div> : null}
                <div className="preferences-split">
                  {availableResolutions.length ? <div className="preferences-block">
                    <p className="preferences-label">选择分辨率</p>
                    <div className="image-resolution-options">
                      {availableResolutions.map((option) => (
                        <button key={option.id} type="button" className={generationResolution === option.id ? "active" : ""} aria-pressed={generationResolution === option.id} onClick={() => setGenerationResolution(option.id)}>
                          {option.label}
                          <i className="bi bi-stars" />
                        </button>
                      ))}
                    </div>
                  </div> : null}
                  <div className="preferences-block">
                    <p className="preferences-label">选择生成数量</p>
                    <div className="image-count-options">
                      {availableCounts.map((value) => (
                        <button key={value} type="button" className={generationCount === value ? "active" : ""} aria-pressed={generationCount === value} onClick={() => setGenerationCount(value)}>{value}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {availableQualities.length ? <div className="preferences-block">
                  <p className="preferences-label">选择质量</p>
                  <div className="image-count-options">
                    {availableQualities.map((option) => (
                      <button key={option.id} type="button" className={generationQuality === option.id ? "active" : ""} aria-pressed={generationQuality === option.id} onClick={() => setGenerationQuality(option.id)}>{option.label}</button>
                    ))}
                  </div>
                </div> : null}
              </section>
            )}
            <input ref={fileInputRef} className="reference-file-input" type="file" accept={mode === "image" ? "image/*" : "image/*,.txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.pptx"} multiple aria-label={mode === "image" ? "添加参考图" : "添加图片或文档"} onChange={(event) => { void uploadReferences(event.target.files); event.target.value = ""; }} />
            {(references.length > 0 || documents.length > 0 || uploading) && <div className={`reference-dock has-images${uploading ? " is-uploading" : ""}`} aria-label="已添加的附件">{references.map((image, index) => <figure key={image.id} className="reference-card"><button type="button" className="reference-card-preview" title={image.name ? `查看 ${image.name}` : "查看参考图"} onClick={() => openImage(image, index, references)}><img src={image.thumbnailUrl || image.dataUrl} alt={image.name || "参考图"} /></button><button type="button" className="reference-card-remove" title="移除参考图" aria-label={image.name ? `移除参考图 ${image.name}` : "移除参考图"} onClick={(event) => { event.stopPropagation(); setReferences((current) => current.filter((item) => item.id !== image.id)); }}><i className="bi bi-x" /></button></figure>)}{documents.map((item) => <div key={item.id} className={`reference-document-card is-${item.status || "queued"}`} title={item.errorMessage || item.name}><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{documentStatusLabel(item)} · {formatDocumentSize(item.sizeBytes)}</small></span><button type="button" title="移除文档" aria-label={`移除文档 ${item.name}`} onClick={() => removeComposerDocument(item)}><i className="bi bi-x" /></button></div>)}{uploading && <span className="reference-card reference-skeleton" aria-label="附件上传或解析中" />}</div>}
            {quotedMessage && <div className="composer-quote"><i className="bi bi-quote" /><span>[{quotedMessage.kind}] {quotedMessage.content}</span><button type="button" title="移除引用" aria-label="移除引用" onClick={() => setQuotedMessage(null)}><i className="bi bi-x-lg" /></button></div>}
            <textarea ref={textareaRef} value={draft} rows={1} aria-label="消息输入" placeholder={mode === "image" ? "描述你想生成的画面，也可以上传参考图" : "输入问题，或粘贴、拖入图片和文档"} disabled={Boolean(activeRun) || Boolean(serviceError)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void requestSend(); } }} />
            {draftCharacterCount > 10000 && <div className={`draft-counter${draftCharacterCount > MAX_ASSISTANT_MESSAGE_CHARACTERS ? " is-over" : ""}`}>{draftCharacterCount.toLocaleString("zh-CN")} / 12,000</div>}
            <div className="composer-toolbar">
              <div className="composer-left">
                <button className="composer-attachment-inline" type="button" title={mode === "image" ? "添加参考图" : "添加附件"} aria-label={mode === "image" ? "添加参考图" : "添加附件"} onClick={() => fileInputRef.current?.click()}><i className="bi bi-paperclip" /></button>
                <button className={`agent-mode-button${creationMenuOpen ? " active" : ""}`} type="button" onClick={() => { setCreationMenuOpen((value) => !value); setModelMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); }}><i className={`bi ${selectedCreation.icon}`} /><span>{selectedCreation.label}</span><i className={`bi bi-chevron-down menu-chevron${creationMenuOpen ? " is-open" : ""}`} /></button>
                <button className={`composer-tool-button image-model-button${modelMenuOpen ? " active" : ""}`} type="button" title={`模型：${generationModelLabel}`} aria-label={`选择模型，当前为${generationModelLabel}`} onClick={() => { setModelMenuOpen((value) => !value); setCreationMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); }}><i className={`bi ${mode === "image" ? "bi-box" : "bi-cpu"}`} /><span>{generationModelLabel}</span>{mode === "image" ? <i className="bi bi-stars" /> : <i className={`bi bi-chevron-down menu-chevron${modelMenuOpen ? " is-open" : ""}`} />}</button>
                {mode === "image" ? (
                  <button className={`composer-tool-button image-settings-button${preferencesOpen ? " active" : ""}`} type="button" onClick={() => { setPreferencesOpen((value) => !value); setCreationMenuOpen(false); setModelMenuOpen(false); setReasoningMenuOpen(false); }}><i className="ratio-shape is-square" /><span>{[generationRatio === "auto" ? "Auto" : generationRatio, generationResolution, generationQuality, `${generationCount}张`].filter(Boolean).join(" | ")}</span></button>
                ) : (
                  <>
                    {reasoningEfforts.length > 0 && activeReasoningEffort ? <button className={`composer-tool-button reasoning-effort-button${reasoningMenuOpen ? " active" : ""}`} type="button" title={`推理强度：${reasoningEffortLabel}`} aria-label={`选择推理强度，当前为${reasoningEffortLabel}`} onClick={() => { setReasoningMenuOpen((value) => !value); setCreationMenuOpen(false); setModelMenuOpen(false); setPreferencesOpen(false); }}><i className="bi bi-speedometer2" /><span>推理 {reasoningEffortLabel}</span><i className={`bi bi-chevron-down menu-chevron${reasoningMenuOpen ? " is-open" : ""}`} /></button> : null}
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
                {activeRun ? <button className="send-button stop-button" type="button" title="停止生成，本轮积分不退还" aria-label="停止生成" onClick={() => setStopConfirmOpen(true)}><span className="stop-glyph" /></button> : <button className="send-button" type="button" title="发送" aria-label="发送" disabled={auth.isAuthenticated && !canSend} onClick={() => void requestSend()}><span className="send-glyph"><i className="bi bi-arrow-up" /></span></button>}
              </div>
            </div>
          </div>
          <div className="composer-context-row">
            <AssistantContextMeter context={latestContext} />
          </div>
        </div>
      </main>

      {assetLibraryMounted && createPortal(<div className={`asset-library-layer${isDark ? " is-dark" : ""}${assetLibraryEntered ? " is-open" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssetLibraryOpen(false); }}><div className={`assistant-workspace${isDark ? " is-dark" : ""}`}><aside className="asset-library-panel" role="dialog" aria-modal="true" aria-label="资产库" onMouseDown={(event) => event.stopPropagation()}><header className="asset-library-header"><div className="asset-library-heading"><p className="asset-library-kicker">资产库</p><div className="asset-library-tabs" role="tablist" aria-label="资产范围"><button type="button" role="tab" aria-selected={assetTab === "session"} className={assetTab === "session" ? "active" : ""} onClick={() => setAssetTab("session")}>会话资产</button><button type="button" role="tab" aria-selected={assetTab === "all"} className={assetTab === "all" ? "active" : ""} onClick={() => setAssetTab("all")}>全部资产</button></div></div><button className="asset-close" type="button" title="关闭资产库" aria-label="关闭资产库" onClick={() => setAssetLibraryOpen(false)}><i className="bi bi-x-lg" /></button></header><div className="asset-search-row"><label><i className="bi bi-search" /><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} type="text" placeholder={assetKind === "file" ? "搜索文件资产" : "搜索图片资产"} /></label></div><nav className="asset-kind-tabs" role="tablist" aria-label="资产类型"><button type="button" role="tab" aria-selected={assetKind === "image"} className={assetKind === "image" ? "active" : ""} onClick={() => setAssetKind("image")}>图片</button><button type="button" role="tab" aria-selected={assetKind === "file"} className={assetKind === "file" ? "active" : ""} onClick={() => setAssetKind("file")}>文件</button></nav>{assetKind === "file" ? <><div className="asset-file-list">{assetLibraryFiles.map((file) => <AssetLibraryFileRow key={file.id} file={file} picked={file.source !== "output" && documents.some((item) => item.id === file.id)} capped={documents.length >= 8} blocked={mode === "image"} onPick={addAssetDocument} />)}</div>{!assetLibraryFiles.length && <div className="asset-empty"><i className="bi bi-file-earmark-text" /><p>没有匹配的文件资产</p></div>}</> : <><div className="asset-image-grid" onScroll={handleAssetGridScroll}>{visibleAssetLibraryImages.map((asset) => <AssetLibraryTile key={asset.id} asset={asset} picked={references.some((item) => sameAssetReference(item, asset))} capped={atReferenceLimit} onPick={addAssetReference} />)}</div>{!assetLibraryImages.length && <div className="asset-empty"><i className="bi bi-images" /><p>{libraryAssetsLoading && assetTab !== "session" ? "正在载入我的资产…" : "没有匹配的图片资产"}</p></div>}</>}<footer className="asset-library-footer">{assetKind === "file" ? <><span>{assetLibraryFiles.length} 个文件资产</span><small>{mode === "image" ? "图片生成模式仅支持图片附件" : documents.length ? `已添加 ${documents.length}/8 个文档` : "附件可添加，输出文件可下载"}</small></> : <><span>{assetLibraryImages.length} 个图片资产</span><small>{references.length ? `已添加 ${references.length}/${maxReferences} 张参考图` : "点击即可添加为参考图"}</small></>}</footer></aside></div></div>, document.body)}

      <DialogMotion
        open={searchOpen}
        layerClassName={`assistant-dialog-layer assistant-search-layer${isDark ? " is-dark" : ""}`}
        panelClassName="assistant-search-dialog"
        ariaLabel="搜索对话"
        initialFocusRef={searchInputRef}
        onClose={closeSearch}
        onExited={handleSearchExited}
      >
        <label className="assistant-search-field" data-dialog-motion-item>
          <i className="bi bi-search" aria-hidden="true" />
          <input ref={searchInputRef} value={searchQuery} type="search" placeholder="搜索..." aria-label="搜索对话" autoComplete="off" onChange={(event) => setSearchQuery(event.target.value)} />
        </label>
        <div className="assistant-search-body" data-dialog-motion-item>
          <div className="assistant-search-pane">
            <div className="assistant-search-list">
              {searchGroups.length ? searchGroups.map((group) => (
                <section key={group.key} className="assistant-search-group">
                  <p className="assistant-search-day">{group.key}</p>
                  {group.items.map((conversation) => {
                    const index = searchResults.indexOf(conversation);
                    const highlighted = index === searchCursor;
                    return (
                      <div
                        key={conversation.id}
                        className={`assistant-search-item${highlighted ? " is-active" : ""}${conversation.id === activeId ? " is-current" : ""}`}
                        onMouseEnter={() => setSearchCursor(index)}
                      >
                        <button type="button" onClick={() => openConversation(conversation)}>
                          <span className="assistant-search-title">
                            <span>{conversation.title}</span>
                            {conversation.id === activeId ? <em className="assistant-search-current">当前</em> : null}
                          </span>
                          <small className="assistant-search-meta">
                            <time>{formatConversationRelativeTime(conversation.updatedAt)}</time>
                          </small>
                        </button>
                        <div className="assistant-search-item-actions">
                          <button type="button" title="编辑" aria-label="编辑" onClick={(event) => { event.preventDefault(); event.stopPropagation(); startRename(conversation); }}><i className="bi bi-pencil" /></button>
                          <button type="button" title="删除" aria-label="删除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDeleteTarget(conversation); }}><i className="bi bi-trash3" /></button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )) : <p className="assistant-search-empty">{searchQuery.trim() ? "没有匹配的对话" : "暂无记录"}</p>}
            </div>
          </div>
        </div>
      </DialogMotion>
      {renamingId && createPortal(
        <div className={`assistant-dialog-layer${isDark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelRename(); }}>
          <section className="assistant-dialog assistant-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-rename-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="assistant-rename-title">重新命名</h2>
            <input
              ref={renameInputRef}
              value={renameDraft}
              maxLength={42}
              disabled={renameSaving}
              aria-label="对话标题"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitRename(); } }}
            />
            <div className="dialog-actions">
              <button type="button" disabled={renameSaving} onClick={cancelRename}>取消</button>
              <button type="button" className="is-primary" disabled={renameSaving || !renameDraft.trim()} onClick={() => void commitRename()}>{renameSaving ? "保存中" : "保存"}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
      {stopConfirmOpen && createPortal(<div className={`assistant-dialog-layer${isDark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (!stopBusy && event.target === event.currentTarget) setStopConfirmOpen(false); }}><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-stop-title" onMouseDown={(event) => event.stopPropagation()}><span className="dialog-icon is-danger"><i className="bi bi-stop-circle" /></span><div className="dialog-copy"><h2 id="assistant-stop-title">停止本次生成？</h2><p>任务仍在进行中。主动停止后，本轮已预留的积分不会退还。</p></div><div className="dialog-actions"><button type="button" disabled={stopBusy} onClick={() => setStopConfirmOpen(false)}>继续生成</button><button type="button" className="is-danger" disabled={stopBusy} onClick={() => void stopRun()}>{stopBusy ? "正在停止" : "确认停止"}</button></div></section></div>, document.body)}
      {deleteTarget && createPortal(<div className={`assistant-dialog-layer${isDark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="dialog-icon is-danger"><i className={`bi ${activeRuns[deleteTarget.id] ? "bi-stop-circle" : "bi-trash3"}`} /></span><div className="dialog-copy"><h2 id="assistant-delete-title">{activeRuns[deleteTarget.id] ? "停止任务并删除对话？" : "删除这个对话？"}</h2><p>“{deleteTarget.title}”{activeRuns[deleteTarget.id] ? "仍在处理中。继续操作会先停止任务，再永久删除对话和已生成内容。主动停止不退还本轮积分。" : "及其中的消息将被永久删除。"}</p></div><div className="dialog-actions"><button type="button" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="is-danger" onClick={() => void deleteConversationRow()}>{activeRuns[deleteTarget.id] ? "停止任务并删除" : "删除"}</button></div></section></div>, document.body)}
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
    </div>
  );
}
