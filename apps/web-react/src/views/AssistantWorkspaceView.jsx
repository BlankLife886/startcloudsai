import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  deleteAssistantTurn,
  deleteAssistantConversation,
  fetchAssistantConfig,
  getAssistantFile,
  importAssistantConversations,
  listActiveAssistantRuns,
  listAssistantConversations,
  openAssistantRunStream,
  uploadAssistantFile,
  waitForAssistantRun,
} from "@react/legacy-modules/services/assistantApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { getWallet, updateProfile } from "@react/legacy-modules/services/meApi.js";
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  IMAGE_COUNTS,
  conversationTitle,
  createAssistantPlaceholder,
  formatMessageDate,
  formatTime,
  imageCountFromPrompt,
  messagePreview,
  messageStatus,
  uid,
} from "@react/legacy-modules/features/assistant/domain/assistantMessages.js";
import { resolveVisualContext } from "@react/legacy-modules/features/assistant/domain/visualContext.js";
import {
  clearAssistantHistory,
  loadAssistantHistory,
  loadAssistantWorkspaceState,
  saveAssistantWorkspaceState,
} from "@react/legacy-modules/services/assistantHistory.js";
import {
  IMAGE_ASPECT_RATIOS,
  getModelAspectRatiosForResolution,
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
import { assistantClipboardFiles, isImageToPSDRequest, isPSDFile } from "./assistant-attachments.js";

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
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};
const REASONING_EFFORT_VALUES = Object.keys(REASONING_EFFORT_LABELS);

function normalizeReasoningEfforts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter((item) => REASONING_EFFORT_VALUES.includes(item)))];
}

function normalizeReasoningPrices(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([effort, raw]) => {
    if (!REASONING_EFFORT_VALUES.includes(effort) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const price = raw;
    const finite = (key) => Number.isFinite(Number(price[key])) ? Math.max(0, Number(price[key])) : undefined;
    return [[effort, {
      assistantStandardPricePoints: finite("assistantStandardPricePoints"),
      assistantPricePoints: finite("assistantPricePoints"),
      canvasAgentStandardPricePoints: finite("canvasAgentStandardPricePoints"),
      canvasAgentPricePoints: finite("canvasAgentPricePoints"),
    }]];
  }));
}

function assistantReasoningPrice(model, effort) {
  const configured = model?.reasoningPrices?.[effort];
  const effective = Number(configured?.assistantPricePoints);
  const standard = Number(configured?.assistantStandardPricePoints);
  return {
    effective: Number.isFinite(effective) ? Math.max(0, effective) : Math.max(0, Number(model?.pricePoints || 0)),
    standard: Number.isFinite(standard) ? Math.max(0, standard) : Math.max(0, Number(model?.standardPricePoints ?? model?.pricePoints ?? 0)),
  };
}

function defaultReasoningEffort(model) {
  const efforts = normalizeReasoningEfforts(model?.supportedReasoningEfforts);
  const configured = String(model?.defaultReasoningEffort || "").trim().toLowerCase();
  if (efforts.includes(configured)) return configured;
  return efforts.includes("medium") ? "medium" : efforts[0] || "";
}

const RESOLUTIONS = [
  { id: "1K", label: "标清 1K", quality: "low", longEdge: 1024 },
  { id: "2K", label: "高清 2K", quality: "medium", longEdge: 2048 },
  { id: "4K", label: "超清 4K", quality: "high", longEdge: 4096 },
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

function assistantCharacterCount(value) {
  return Array.from(String(value || "")).length;
}


function imageUrl(image = {}) {
  return String(image.dataUrl || image.url || "").trim();
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

function AssistantContextMeter({ context }) {
  const usage = normalizeAssistantContext(context);
  if (!usage) return <div className="assistant-context-meter is-empty" title="完成一次回答后显示上下文占用"><i className="bi bi-layers" /><span>上下文</span><strong>--</strong></div>;
  const title = `本轮估算 ${formatContextTokens(usage.estimatedInputTokens)} / ${formatContextTokens(usage.inputBudgetTokens)} tokens${usage.compactedMessages ? `，已压缩 ${usage.compactedMessages} 条消息` : ""}`;
  return <div className={`assistant-context-meter${usage.usagePercent >= 80 ? " is-high" : usage.compactedMessages ? " is-compacted" : ""}`} title={title} aria-label={title} role="status"><i className="bi bi-layers" /><span>上下文</span><strong>{usage.usagePercent}%</strong><em aria-hidden="true"><i style={{ width: `${usage.usagePercent}%` }} /></em></div>;
}

function imageRequestFromProposal(proposal = {}) {
  const resolution = RESOLUTIONS.find((item) => item.id === String(proposal.resolution || "").toUpperCase()) || RESOLUTIONS[0];
  const longEdge = resolution.longEdge;
  const ratio = String(proposal.ratio || "auto");
  if (ratio === "auto") return { width: longEdge, height: longEdge, requestSize: "auto", quality: resolution.quality };
  const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
  if (!ratioWidth || !ratioHeight) return { width: longEdge, height: longEdge, requestSize: `${longEdge}x${longEdge}`, quality: resolution.quality };
  const width = ratioWidth >= ratioHeight ? longEdge : Math.round((longEdge * ratioWidth) / ratioHeight);
  const height = ratioHeight >= ratioWidth ? longEdge : Math.round((longEdge * ratioHeight) / ratioWidth);
  return { width, height, requestSize: `${width}x${height}`, quality: resolution.quality };
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
        for (const image of (Array.isArray(message[field]) ? message[field] : []).slice(0, 4)) {
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

function normalizeConfig(config = {}) {
  const conversationModels = (Array.isArray(config.conversationModels)
    ? config.conversationModels
    : [])
    .map((item) => ({
      ...item,
      model: String(item?.model || "").trim(),
      label: String(item?.label || item?.model || "").trim(),
      description: String(item?.description || item?.provider || "后台配置的对话模型"),
      supportedReasoningEfforts: normalizeReasoningEfforts(item?.supportedReasoningEfforts),
      defaultReasoningEffort: String(item?.defaultReasoningEffort || "").trim().toLowerCase(),
      reasoningPrices: normalizeReasoningPrices(item?.reasoningPrices),
    }))
    .filter((item) => item.model && item.label);
  const imageModels = (Array.isArray(config.imageModels) ? config.imageModels : [])
    .map((item) => ({
      ...item,
      ...normalizeImageModelCapabilities(item),
      model: String(item?.model || "").trim(),
      label: String(item?.label || item?.model || "").trim(),
      description: String(item?.description || item?.provider || "后台配置的图片模型"),
    }))
    .filter((item) => item.model && item.label);
  return { conversationModels, imageModels };
}

function ModelMenuPrice({ model, perImage }) {
  const price = resolveModelPointPricing(model);
  if (!price.configured) return <span className="model-menu-price is-empty">未定价</span>;
  const suffix = perImage ? "/张" : "";
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

function AssistantImageViewer({ value, onClose, onStep }) {
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!value) return undefined;
    document.documentElement.classList.add("assistant-image-viewer-open");
    const handleKeydown = (event) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onStep(-1);
      else if (event.key === "ArrowRight") onStep(1);
      else if (event.key === "+" || event.key === "=") setZoom((current) => Math.min(5, current + 0.25));
      else if (event.key === "-" || event.key === "_") setZoom((current) => Math.max(0.5, current - 0.25));
      else if (event.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => {
      document.documentElement.classList.remove("assistant-image-viewer-open");
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [onClose, onStep, value]);
  useEffect(() => {
    setZoom(1);
    setNaturalSize({ width: 0, height: 0 });
  }, [value?.index, value?.item]);
  if (!value) return null;
  const { item, index, gallery } = value;
  // 下载始终用原图；大图预览优先展示图，404 时回退原图
  const url = imageUrl(item);
  const displayUrl = imageDisplayUrl(item);
  const download = () => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `assistant-image-${index + 1}.png`;
    link.rel = "noopener";
    link.click();
  };
  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="生成图片全屏预览" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <header className="image-viewer__head"><div className="image-viewer__title"><strong>全屏预览</strong>{gallery.length > 1 && <small>{index + 1} / {gallery.length}</small>}<small>{item.revisedPrompt || item.name || "AI 生成图片"}</small>{naturalSize.width > 0 && <small className="is-size">{naturalSize.width}×{naturalSize.height}</small>}</div></header>
      <div className="image-viewer__actions" aria-label="预览操作"><button type="button" title="下载原图" aria-label="下载原图" onClick={download}><i className="bi bi-download" /></button><button type="button" title="关闭预览" aria-label="关闭预览" onClick={onClose}><i className="bi bi-x-lg" /></button></div>
      <div className="image-viewer__stage">
        {gallery.length > 1 && <button className="image-viewer__nav is-previous" type="button" title="上一张" aria-label="上一张" data-click-guard="off" onClick={() => onStep(-1)}><i className="bi bi-chevron-left" /></button>}
        <div className={`image-viewer__frame${zoom > 1 ? " is-zoomed" : ""}`} onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.min(5, Math.max(0.5, current + (event.deltaY < 0 ? 0.25 : -0.25)))); }} onDoubleClick={() => setZoom((current) => current === 1 ? 2 : 1)}>
          <div className="image-viewer__image-layer" style={{ transform: `translate3d(0, 0, 0) scale(${zoom})` }}><img src={displayUrl} alt={item.revisedPrompt || item.name || "AI 生成图片"} draggable="false" onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={(event) => { const image = event.currentTarget; if (url && image.src !== url && !image.dataset.fallbackApplied) { image.dataset.fallbackApplied = "1"; image.src = url; } }} /></div>
        </div>
        {gallery.length > 1 && <button className="image-viewer__nav is-next" type="button" title="下一张" aria-label="下一张" data-click-guard="off" onClick={() => onStep(1)}><i className="bi bi-chevron-right" /></button>}
      </div>
      <div className="image-viewer__zoom-tools" aria-label="图片缩放工具" data-click-guard="off"><button type="button" disabled={zoom <= 0.5} aria-label="缩小图片" onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}><i className="bi bi-zoom-out" /><span>缩小</span></button><output>{Math.round(zoom * 100)}%</output><button type="button" disabled={zoom >= 5} aria-label="放大图片" onClick={() => setZoom((current) => Math.min(5, current + 0.25))}><i className="bi bi-zoom-in" /><span>放大</span></button><button type="button" aria-label="适应屏幕" onClick={() => setZoom(1)}><i className="bi bi-arrows-angle-contract" /><span>适应屏幕</span></button></div>
    </div>,
    document.body,
  );
}

function AssistantMarkdown({ content, streaming }) {
  const rootRef = useRef(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(String(content || ""), { async: false, breaks: true, gfm: true }), { USE_PROFILES: { html: true } }), [content]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.dataset.enhanced === "true") return;
      const code = pre.querySelector("code");
      if (!code) return;
      const toolbar = document.createElement("div");
      toolbar.className = "markdown-code-toolbar";
      const language = document.createElement("span");
      const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
      language.textContent = languageClass ? languageClass.slice(9) : "代码";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.dataset.copyCode = "true";
      copy.title = "复制代码";
      copy.setAttribute("aria-label", "复制代码");
      copy.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>';
      toolbar.append(language, copy);
      pre.prepend(toolbar);
      pre.dataset.enhanced = "true";
    });
  }, [html]);

  const handleClick = async (event) => {
    const button = event.target.closest("[data-copy-code]");
    const code = button?.closest("pre")?.querySelector("code")?.innerText;
    if (!button || !code) return;
    await navigator.clipboard.writeText(code);
    button.classList.add("is-copied");
    button.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i><span>已复制</span>';
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("is-copied");
      button.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>复制</span>';
    }, 1600);
  };

  return <div ref={rootRef} className={`assistant-markdown${streaming ? " is-streaming" : ""}`} onClick={(event) => void handleClick(event)} dangerouslySetInnerHTML={{ __html: html }} />;
}

function artifactLayerLabel(item = {}) {
  const count = Math.max(0, Number(item.layerCount) || 0);
  return count > 1 ? ` · ${count} 图层` : "";
}

function AssistantArtifacts({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="assistant-artifacts" aria-label="生成的文件">{items.map((item, index) => <a key={item.id || `${item.name}-${index}`} className="assistant-artifact" href={item.downloadUrl} download={item.name || "assistant-output.txt"}><i className={`bi ${documentIcon(item)}`} aria-hidden="true" /><span><strong>{item.name || "生成文件"}</strong><small>{String(item.format || "file").toUpperCase()} · {formatDocumentSize(item.sizeBytes)}{artifactLayerLabel(item)}</small></span><i className="bi bi-download" aria-hidden="true" /></a>)}</div>;
}

function AgentProposal({ message, imageModels, generating, executed, onChange, onDismiss, onRestore, onApprove, onOpenImage }) {
  const proposal = message.proposal;
  if (!proposal) return null;
  if (proposal.dismissed) {
    return <div className="agent-proposal is-dismissed"><button type="button" className="agent-proposal-restore" onClick={onRestore}><i className="bi bi-magic" aria-hidden="true" /><span>创作方案已收起</span><i className="bi bi-chevron-down" aria-hidden="true" /></button></div>;
  }
  const selectedModel = imageModels.find((item) => item.model === proposal.model) || imageModels[0] || null;
  const resolutions = RESOLUTIONS.filter((item) =>
    normalizeImageModelCapabilities(selectedModel || {}).resolutions.includes(item.id),
  );
  const ratios = getModelAspectRatiosForResolution(selectedModel, proposal.resolution).map(ratioOption);
  return <div className="agent-proposal">
    <header className="agent-proposal-head"><span className="agent-proposal-icon"><i className="bi bi-stars" /></span><div><strong>{proposal.action === "edit" ? "图片编辑方案" : "图片生成方案"}</strong><small>{proposal.planningSummary || proposal.reason}</small></div>{executed && <span className="agent-proposal-state">已执行</span>}</header>
    {proposal.reason && proposal.reason !== proposal.planningSummary && <p className="agent-proposal-reason"><i className="bi bi-signpost-split" /><span>{proposal.reason}</span></p>}
    {proposal.referenceImages?.length > 0 && <div className="agent-proposal-refs">{proposal.referenceImages.map((image, index) => <button key={image.id || image.fileKey || index} type="button" onClick={() => onOpenImage(image, index, proposal.referenceImages)}><img src={imageUrl(image)} alt={image.name || `参考图 ${index + 1}`} /><span>图{index + 1}</span></button>)}</div>}
    <label className="agent-proposal-prompt"><span>生成提示词</span><textarea rows={4} maxLength={12000} disabled={proposal.submitting} value={proposal.prompt || ""} onChange={(event) => onChange({ prompt: event.target.value })} /></label>
    <div className="agent-proposal-params">
      <label><span>生成模型</span>{imageModels.length ? <select value={proposal.model || selectedModel?.model || ""} disabled={proposal.submitting} onChange={(event) => onChange({ model: event.target.value })}>{imageModels.map((model) => <option key={model.model} value={model.model}>{model.label}</option>)}</select> : <div className="agent-proposal-readonly">{proposal.modelName || proposal.model || "模型不可用"}</div>}</label>
      <label><span>画面比例</span><select value={proposal.ratio || "auto"} disabled={proposal.submitting} onChange={(event) => onChange({ ratio: event.target.value })}>{ratios.map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label}</option>)}</select></label>
      <label><span>清晰度</span><select value={proposal.resolution || resolutions[0]?.id || "1K"} disabled={proposal.submitting} onChange={(event) => onChange({ resolution: event.target.value })}>{resolutions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label><span>生成数量</span><select value={Number(proposal.count || 1)} disabled={proposal.submitting} onChange={(event) => onChange({ count: Number(event.target.value) })}>{IMAGE_COUNTS.map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
    </div>
    <footer className="agent-proposal-actions"><button type="button" className="is-secondary" disabled={proposal.submitting} onClick={onDismiss}>取消</button><button type="button" className="is-primary" disabled={proposal.submitting || generating || !String(proposal.prompt || "").trim()} onClick={onApprove}><i className={`bi ${proposal.submitting ? "bi-arrow-repeat" : "bi-stars"}`} /><span>{proposal.submitting ? "正在提交" : executed ? "再生成一组" : "开始生成"}</span></button></footer>
  </div>;
}

function AssistantMessageRow({ message, turnId, showDate, expanded, copied, generating, isLastAssistant, isLastUser, editing, editingDraft, moreOpen, loadedImages, failedImages, imageRetryVersions, imageModels, sourceProposal, proposalExecuted, onToggleStatus, onCopy, onQuote, onOpenImage, onImageLoad, onImageError, onImageRetry, onStartEdit, onEditDraft, onCancelEdit, onSubmitEdit, onWithdraw, onRetry, onToggleMore, onDownloadMarkdown, onDelete, onProposalChange, onProposalDismiss, onProposalRestore, onProposalApprove, onReopenProposal }) {
  const status = message.role === "assistant" ? messageStatus(message) : null;
  const contextUsage = normalizeAssistantContext(message.context);
  return (
    <div className="message-turn">
      {showDate && <h2 className="message-date-divider">{formatMessageDate(message.createdAt)}</h2>}
      {message.kind === "context-divider" ? <div className="assistant-context-divider"><span /><p><i className="bi bi-eraser" aria-hidden="true" /> 已从这里开始新的上下文</p><span /></div> : <article className={`message message--${message.role}`} data-message-id={message.id} data-turn-id={turnId || undefined}>
        {status && <div className={`assistant-message-label is-${status.tone}`}><button className="message-status-toggle" type="button" aria-expanded={expanded} onClick={() => onToggleStatus(message.id)}><span className="message-status-indicator" aria-hidden="true"><i /></span><strong aria-live="polite"><span>{status.label}</span></strong><i className={`bi bi-chevron-right message-status-chevron${expanded ? " is-expanded" : ""}`} /></button>{expanded && <div className="message-status-detail"><p>{status.detail}</p>{contextUsage && <div className="message-context-stats"><span><b>{contextUsage.usagePercent}%</b> 上下文</span><span><b>{contextUsage.includedMessages}</b> 条近期消息</span>{contextUsage.compactedMessages > 0 && <span><b>{contextUsage.compactedMessages}</b> 条已压缩</span>}{contextUsage.omittedMessages > 0 && <span><b>{contextUsage.omittedMessages}</b> 条未纳入</span>}</div>}{message.pending && message.kind !== "image" && status.progress > 0 && <div className="message-status-progress" aria-hidden="true"><i style={{ width: `${status.progress}%` }} /></div>}</div>}</div>}
        {message.role === "user" && !editing && <div className="user-message-actions" aria-label="用户消息操作"><button type="button" title={copied ? "已复制" : "复制问题"} aria-label={copied ? "已复制" : "复制问题"} className={copied ? "is-copied" : ""} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button>{isLastUser && <button type="button" title="编辑问题" aria-label="编辑问题" disabled={generating} onClick={() => onStartEdit(message)}><i className="bi bi-pencil" /></button>}{isLastUser && <button type="button" title="撤回本轮" aria-label="撤回本轮" disabled={generating} onClick={() => onWithdraw(message)}><i className="bi bi-arrow-counterclockwise" /></button>}</div>}
        {message.role === "user" && editing ? <div className="user-message-editor"><textarea autoFocus rows={3} aria-label="编辑问题" value={editingDraft} onChange={(event) => onEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmitEdit(message); } }} /><footer><span>{assistantCharacterCount(editingDraft.trim()).toLocaleString("zh-CN")} / 12,000</span><button type="button" onClick={onCancelEdit}>取消</button><button className="is-primary" type="button" disabled={!editingDraft.trim() || assistantCharacterCount(editingDraft.trim()) > MAX_ASSISTANT_MESSAGE_CHARACTERS || generating} onClick={() => onSubmitEdit(message)}><i className="bi bi-arrow-up" /><span>发送</span></button></footer></div> : <div className={`message-content${message.error ? " has-error" : ""}`}>
          {message.pending && message.kind === "image" ? <div className="image-generation-stage"><div className="image-generation-summary"><strong>{message.prompt || "正在生成图片"}</strong><span>{message.model || "默认模型"}</span><i /><span>{message.ratio || "智能"}</span><i /><span>{message.resolution || "1K"}</span><button type="button" title="生成详情" aria-label="生成详情"><i className="bi bi-info-circle" /></button></div><div className={`image-dream-grid${Number(message.count || 2) === 1 ? " is-single" : ""}${Number(message.count || 2) > 2 ? " is-many" : ""}`} style={{ "--image-skeleton-ratio": imageRatioValue(message), "--image-slot-count": Number(message.count || 2) }}>{Array.from({ length: Number(message.count || 2) }, (_, index) => { const image = message.images?.[index]; return <div key={index} className={`image-dream-slot${image ? " is-ready" : ""}${image && loadedImages.has(`${message.id}-${index}`) ? " is-loaded" : ""}`}>{image && <button className="image-dream-preview" type="button" title="查看大图" onClick={() => onOpenImage(image, index, message.images)}><img src={imageThumbUrl(image)} alt={image.revisedPrompt || "AI 生成图片"} onLoad={() => onImageLoad(message.id, index)} /></button>}{(!image || !loadedImages.has(`${message.id}-${index}`)) && <i className="dream-slot-spinner" aria-hidden="true" />}</div>; })}</div><div className="image-generation-queue"><span>{message.statusStage === "preparing-image" ? "意图识别" : "普通队列"}</span><strong>{message.statusStage === "preparing-image" ? "正在准备图片任务" : "成功进入生成阶段"}</strong></div></div> : <>
            {message.role === "user" && message.quoted && <div className="sent-quote"><i className="bi bi-quote" /><span>[{message.quoted.kind}] {message.quoted.content}</span></div>}
            {message.role === "user" && message.referenceImages?.length > 0 && <div className="sent-reference-images">{message.referenceImages.map((image, index) => <button key={image.id || image.fileKey || index} type="button" title="查看参考图" onClick={() => onOpenImage(image, index, message.referenceImages)}><img src={imageUrl(image)} alt={image.name || "参考图"} /></button>)}</div>}
            {message.role === "user" && message.attachments?.length > 0 && <div className="assistant-document-chips">{message.attachments.map((item) => <span key={item.id} className="assistant-document-chip"><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{formatDocumentSize(item.sizeBytes)} · {item.pageCount ? `${item.pageCount} 页` : "文档"}</small></span></span>)}</div>}
            {message.role === "assistant" && message.kind === "proposal" && message.proposal && <AgentProposal message={message} imageModels={imageModels} generating={generating} executed={proposalExecuted} onChange={onProposalChange} onDismiss={onProposalDismiss} onRestore={onProposalRestore} onApprove={onProposalApprove} onOpenImage={onOpenImage} />}
            {message.role === "assistant" && message.kind !== "proposal" && message.content && message.content !== message.error ? <AssistantMarkdown content={message.content} streaming={message.pending} /> : message.role !== "assistant" && message.content && message.content !== message.error ? <p>{message.content}</p> : null}
            {message.role === "assistant" && <AssistantArtifacts items={message.artifacts} />}
            {!message.content && message.pending && status?.tone === "working" && <span className="typing-indicator"><i /><i /><i /></span>}
            {message.images?.length > 0 && <div className={`generated-images${message.images.length === 1 ? " is-single" : ""}${message.images.length > 2 ? " is-many" : ""}`} style={{ "--generated-ratio": imageRatioValue(message), "--image-slot-count": message.images.length }}>{message.images.map((image, index) => { const key = `${message.id}-${index}`; const loaded = loadedImages.has(key); const failed = failedImages.has(key); return <figure key={key} data-image-key={key} className={failed ? "is-failed" : loaded ? "" : "is-loading"}>{failed ? <div className="generated-image-failed"><i className="bi bi-image-alt" /><span>图片加载失败</span><button type="button" onClick={() => onImageRetry(message.id, index)}>重新加载</button></div> : <button className="generated-image-preview" type="button" title="查看大图" onClick={() => onOpenImage(image, index, message.images)}><img src={retryableImageUrl(imageThumbUrl(image), imageRetryVersions[key])} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" decoding="async" onLoad={() => onImageLoad(message.id, index)} onError={() => onImageError(message.id, index)} /><i className="tile-sheen" aria-hidden="true" /></button>}{loaded && !failed && <div className="generated-image-actions"><button type="button" title="下载原图" aria-label="下载原图" onClick={() => { const link = document.createElement("a"); link.href = imageUrl(image); link.download = `assistant-image-${index + 1}.png`; link.click(); }}><i className="bi bi-download" /></button></div>}</figure>; })}</div>}
          </>}
        </div>}
        {message.role === "assistant" && !message.pending && <><p className="message-meta">以上内容由 AI 生成</p><div className="message-actions">{sourceProposal && <button className="source-proposal-button" type="button" title="回到生成这组图片的方案" onClick={onReopenProposal}><i className="bi bi-sliders" /><span>编辑方案</span></button>}<button className="regenerate-button" type="button" title="重新生成" disabled={generating || !isLastAssistant} onClick={() => onRetry(message)}><i className="bi bi-arrow-repeat" /><span>重新生成</span></button><button className={`copy-message-button${copied ? " is-copied" : ""}`} type="button" title={copied ? "已复制" : "复制回复"} aria-label={copied ? "已复制" : "复制回复"} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button><button type="button" title="引用" aria-label="引用" onClick={() => onQuote(message)}><i className="bi bi-quote" /></button><button type="button" title="更多操作" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); onToggleMore(message.id); }}><i className="bi bi-three-dots" /></button>{moreOpen && <div className="message-more-menu" onClick={(event) => event.stopPropagation()}>{message.kind !== "image" && <button type="button" onClick={() => onDownloadMarkdown(message)}><i className="bi bi-filetype-md" /><span>下载 Markdown</span></button>}<button className="is-danger" type="button" onClick={() => onDelete(message.id)}><i className="bi bi-trash3" /><span>删除</span></button></div>}</div></>}
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
  const messageScrollerRef = useRef(null);
  const atBottomRef = useRef(true);
  const returningRef = useRef(false);
  const loadingEarlierRef = useRef(false);
  const returnBottomTimerRef = useRef(0);
  const workspaceControllerRef = useRef(null);
  const draftRequestControllerRef = useRef(null);
  const runControllersRef = useRef(new Map());
  const uploadControllerRef = useRef(null);
  const costControllerRef = useRef(null);
  const costResolverRef = useRef(null);
  const pendingLaunchRef = useRef(null);
  const activeIdRef = useRef("");
  const workspaceHydratedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [creationType, setCreationType] = useState("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [creationMenuOpen, setCreationMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetTab, setAssetTab] = useState("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [conversationModels, setConversationModels] = useState([]);
  const [imageModels, setImageModels] = useState([]);
  const [conversationModel, setConversationModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [generationRatio, setGenerationRatio] = useState("auto");
  const [generationResolution, setGenerationResolution] = useState("1K");
  const [generationCount, setGenerationCount] = useState(2);
  const [customImageWidth, setCustomImageWidth] = useState(1024);
  const [customImageHeight, setCustomImageHeight] = useState(1024);
  const [references, setReferences] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [activeRuns, setActiveRuns] = useState({});
  const [costPayload, setCostPayload] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resumeCandidates, setResumeCandidates] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
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
  const [visibleMessageLimit, setVisibleMessageLimit] = useState(MESSAGE_BATCH_SIZE);
  const [activeNavigatorMessageId, setActiveNavigatorMessageId] = useState("");

  const activeConversation = conversations.find((item) => item.id === activeId) || null;
  activeIdRef.current = activeId;
  const messages = activeConversation?.messages || [];
  const activeRun = activeRuns[activeId] || null;
  const firstRenderedMessageIndex = Math.max(0, messages.length - visibleMessageLimit);
  const renderedMessages = messages.slice(firstRenderedMessageIndex);
  const hiddenMessageCount = firstRenderedMessageIndex;
  const mode = creationType === "image" ? "image" : "chat";
  const selectedCreation = CREATION_TYPES.find((item) => item.id === creationType) || CREATION_TYPES[0];
  const generationModels = mode === "image" ? imageModels : conversationModels;
  const generationModel = mode === "image" ? imageModel : conversationModel;
  const selectedModel = generationModels.find((item) => item.model === generationModel) || generationModels[0] || null;
  const generationModelLabel = selectedModel?.label || (loading ? "加载模型…" : "暂无可用模型");
  const selectedConversationModel = conversationModels.find((item) => item.model === conversationModel) || conversationModels[0] || null;
  const reasoningEfforts = useMemo(() => normalizeReasoningEfforts(selectedConversationModel?.supportedReasoningEfforts), [selectedConversationModel]);
  const activeReasoningEffort = reasoningEfforts.includes(reasoningEffort) ? reasoningEffort : defaultReasoningEffort(selectedConversationModel);
  const reasoningEffortLabel = REASONING_EFFORT_LABELS[activeReasoningEffort] || "";
  const modelWithReasoningPrice = (model, effort = activeReasoningEffort) => {
    const price = assistantReasoningPrice(model, effort);
    return { ...model, pricePoints: price.effective, standardPricePoints: price.standard };
  };
  const filteredGenerationModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return query ? generationModels.filter((item) => `${item.label} ${item.model} ${item.description || ""}`.toLowerCase().includes(query)) : generationModels;
  }, [generationModels, modelSearch]);
  const selectedImageModel = imageModels.find((item) => item.model === imageModel) || imageModels[0] || null;
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
  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    const listable = conversations.filter((item) => item.messages.length > 0);
    return query
      ? listable.filter((item) => `${item.title} ${item.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(query))
      : listable;
  }, [conversationSearch, conversations]);
  const assetLibraryImages = useMemo(() => {
    const source = assetTab === "session" ? [activeConversation].filter(Boolean) : conversations;
    const seen = new Set();
    const assets = [];
    for (const conversation of source) {
      for (const message of conversation.messages || []) {
        for (const [index, image] of [...(message.images || []), ...(message.referenceImages || [])].entries()) {
          const dataUrl = imageUrl(image);
          if (!dataUrl || seen.has(dataUrl)) continue;
          seen.add(dataUrl);
          // 网格小图优先服务端缩略图；dataUrl 原图保留给引用/下载
          assets.push({ id: `${conversation.id}-${message.id}-${index}`, label: image.revisedPrompt || image.name || conversation.title || "创作资产", dataUrl, thumbUrl: imageThumbUrl(image) });
        }
      }
    }
    const query = assetSearch.trim().toLowerCase();
    return query ? assets.filter((asset) => asset.label.toLowerCase().includes(query)) : assets;
  }, [activeConversation, assetSearch, assetTab, conversations]);
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
  const navigatorItems = useMemo(() => messages.filter((message) => message.role === "user").map((message) => ({ id: message.id, date: formatMessageDate(message.createdAt), time: formatTime(message.createdAt), preview: messagePreview(message.content), icon: message.referenceImages?.length ? "bi-image" : "bi-chat-left-text" })), [messages]);

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
  const openImage = useCallback((item, index = 0, gallery = [item]) => {
    setSelectedImage({ item, index, gallery: Array.isArray(gallery) ? gallery : [item] });
  }, []);
  const closeImage = useCallback(() => setSelectedImage(null), []);
  const stepImage = useCallback((delta) => {
    setSelectedImage((current) => {
      if (!current?.gallery?.length) return current;
      const index = (current.index + delta + current.gallery.length) % current.gallery.length;
      return { ...current, index, item: current.gallery[index] };
    });
  }, []);
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

  const patchConversation = useCallback((id, patcher) => {
    setConversations((current) => current.map((item) => item.id === id ? patcher(item) : item));
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

  const scrollToMessage = useCallback((messageId) => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const requiredCount = messages.length - index;
    if (index < firstRenderedMessageIndex) setVisibleMessageLimit(Math.min(messages.length, Math.ceil(requiredCount / MESSAGE_BATCH_SIZE) * MESSAGE_BATCH_SIZE));
    setActiveNavigatorMessageId(messageId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const scroller = messageScrollerRef.current;
      const target = scroller?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!scroller || !target) return;
      scroller.scrollTo({ top: Math.max(0, target.offsetTop - scroller.clientHeight * 0.18), behavior: "smooth" });
    }));
  }, [firstRenderedMessageIndex, messages]);

  useEffect(() => {
    setVisibleMessageLimit(MESSAGE_BATCH_SIZE);
    if (loading || !activeId) return;
    scrollToBottom();
  }, [activeId, loading, scrollToBottom]);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }, [draft]);

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
      setActiveId(rows.some((item) => item.id === workspaceState.activeId) ? workspaceState.activeId : rows.find((item) => item.messages.length)?.id || "");
      if (typeof workspaceState.draft === "string") setDraft(workspaceState.draft.slice(0, 12000));
      if (CREATION_TYPES.some((item) => item.id === workspaceState.creationType)) setCreationType(workspaceState.creationType);
      if (IMAGE_ASPECT_RATIOS.includes(workspaceState.generationRatio)) setGenerationRatio(workspaceState.generationRatio);
      if (RESOLUTIONS.some((item) => item.id === String(workspaceState.generationResolution || "").toUpperCase())) setGenerationResolution(String(workspaceState.generationResolution).toUpperCase());
      if (IMAGE_COUNTS.includes(Number(workspaceState.generationCount))) setGenerationCount(Number(workspaceState.generationCount));
      if (Number.isFinite(Number(workspaceState.customImageWidth))) setCustomImageWidth(Math.min(4096, Math.max(256, Number(workspaceState.customImageWidth))));
      if (Number.isFinite(Number(workspaceState.customImageHeight))) setCustomImageHeight(Math.min(4096, Math.max(256, Number(workspaceState.customImageHeight))));
      const savedModel = String(workspaceState.generationModel || "").trim();
      if (workspaceState.creationType === "image" && config.imageModels.some((item) => item.model === savedModel)) setImageModel(savedModel);
      if (workspaceState.creationType !== "image" && config.conversationModels.some((item) => item.model === savedModel)) setConversationModel(savedModel);
      setReasoningEffort(String(workspaceState.reasoningEffort || "").trim().toLowerCase());
      const pending = takePendingPrompt("assistant");
      if (pending) {
        pendingLaunchRef.current = pending;
        setActiveId("");
        setDraft(composePendingLaunchPrompt(pending, 12000));
        const pendingMode = pending.config?.mode === "image" || pending.config?.skill === "image" ? "image" : "agent";
        setCreationType(pendingMode);
        if (IMAGE_ASPECT_RATIOS.includes(pending.config?.ratio)) setGenerationRatio(pending.config.ratio);
        if (RESOLUTIONS.some((item) => item.id === String(pending.config?.resolution || "").toUpperCase())) {
          setGenerationResolution(String(pending.config.resolution).toUpperCase());
        }
        if (IMAGE_COUNTS.includes(Number(pending.config?.count))) setGenerationCount(Number(pending.config.count));
        if (Array.isArray(pending.config?.referenceImages)) setReferences(pending.config.referenceImages.slice(0, 4));
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
      document.documentElement.classList.remove("assistant-image-viewer-open");
    };
  }, [loadWorkspace]);

  useEffect(() => {
    if (!reasoningEfforts.length || reasoningEfforts.includes(reasoningEffort)) return;
    setReasoningEffort(defaultReasoningEffort(selectedConversationModel));
  }, [reasoningEffort, reasoningEfforts, selectedConversationModel]);

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
      generationCount,
      customImageWidth,
      customImageHeight,
    });
  }, [activeId, activeReasoningEffort, creationType, customImageHeight, customImageWidth, draft, generationCount, generationModel, generationRatio, generationResolution, loading, mode, workspaceScope]);

  useEffect(() => {
    const handleKeydown = (event) => {
      if (event.key !== "Escape" || selectedImage) return;
      if (editingMessageId) {
        cancelUserMessageEdit();
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
      else if (deleteTarget) setDeleteTarget(null);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeMessageMenuId, assetLibraryOpen, creationMenuOpen, deleteTarget, editingMessageId, modelMenuOpen, preferencesOpen, reasoningMenuOpen, selectedImage]);

  useEffect(() => {
    if (!availableResolutions.length) return;
    if (!availableResolutions.some((item) => item.id === generationResolution)) {
      setGenerationResolution(availableResolutions[0].id);
    }
  }, [availableResolutions, generationResolution]);

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
    const longEdge = availableResolutions.find((item) => item.id === generationResolution)?.longEdge || 1024;
    if (generationRatio === "auto") {
      setCustomImageWidth(longEdge);
      setCustomImageHeight(longEdge);
      return;
    }
    const [ratioWidth, ratioHeight] = generationRatio.split(":").map(Number);
    if (!ratioWidth || !ratioHeight || ratioWidth === ratioHeight) {
      setCustomImageWidth(longEdge);
      setCustomImageHeight(longEdge);
    } else if (ratioWidth > ratioHeight) {
      setCustomImageWidth(longEdge);
      setCustomImageHeight(Math.round((longEdge * ratioHeight) / ratioWidth));
    } else {
      setCustomImageWidth(Math.round((longEdge * ratioWidth) / ratioHeight));
      setCustomImageHeight(longEdge);
    }
  }, [availableResolutions, generationRatio, generationResolution]);

  const updateSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    setConversationPeek(null);
    try { localStorage.setItem("starclouds:assistant-sidebar-collapsed", String(next)); } catch { /* ignore */ }
  };

  const newConversation = () => {
    setActiveId("");
    setDraft("");
    setReferences([]);
    for (const item of documents) void deleteAssistantFile(item.id).catch(() => undefined);
    setDocuments([]);
    setQuotedMessage(null);
    setVisibleMessageLimit(MESSAGE_BATCH_SIZE);
    setCreationType("chat");
    setCreationMenuOpen(false);
    setModelMenuOpen(false);
    setPreferencesOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const uploadReferences = async (files) => {
    const maxReferences = Math.min(4, Math.max(0, Number(selectedImageModel?.maxReferenceImages ?? 4)));
    const selected = Array.from(files || []);
	const psdFiles = selected.filter(isPSDFile);
	if (psdFiles.length) notificationService.warning("AI 助手暂不支持 PSD 文件");
	const supported = selected.filter((file) => !isPSDFile(file));
    const imageFiles = supported.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, maxReferences - references.length));
    const documentFiles = mode === "image" ? [] : supported.filter((file) => !file.type.startsWith("image/")).slice(0, Math.max(0, 8 - documents.length));
    if (!imageFiles.length && !documentFiles.length) {
      if (selected.length && mode === "image") notificationService.warning("图片生成模式仅支持图片附件");
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

  const removeComposerDocument = (item) => {
    setDocuments((current) => current.filter((document) => document.id !== item.id));
    void deleteAssistantFile(item.id).catch(() => undefined);
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
    setCostPayload({
      title: responseMode === "image" ? "确认生成费用" : "确认本轮费用",
      unit,
      count: responseMode === "image" ? imageCount : 1,
      total,
      available: wallet ? Number(wallet.normalBalanceCents ?? wallet.availableCents ?? wallet.balanceCents ?? 0) : null,
      unitLabel: responseMode === "image" ? "张" : "轮",
      featureLabel: responseMode === "image" ? "AI 助手生图" : responseMode === "agent" ? "AI 助手 Agent" : "AI 助手对话",
      summary: responseMode === "image"
        ? "提交后按图片数量预留费用，成功结算；失败或停止时自动退回。"
        : responseMode === "agent"
          ? `${REASONING_EFFORT_LABELS[requestedReasoningEffort] || requestedReasoningEffort || "默认"}推理为 ${chatUnit} 积分/轮；本轮只收 Agent 推理费用，执行生图时另行确认图片费用。`
          : `${REASONING_EFFORT_LABELS[requestedReasoningEffort] || requestedReasoningEffort || "默认"}推理为 ${chatUnit} 积分/轮；成功后结算，失败或停止时自动退回。`,
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
            content: persisted?.content ?? message.content,
            images: Array.isArray(persisted?.images) ? persisted.images : message.images,
            kind: run.resolvedMode || persisted?.kind || message.kind,
            pending: terminal ? false : ["queued", "running"].includes(run.status || persisted?.status),
            error: run?.errorMessage || persisted?.error || "",
            statusStage: terminal ? persisted?.statusStage || (run.status === "canceled" ? "stopped" : undefined) : run?.stage || persisted?.statusStage,
          }
        : message),
    }));
    if (conversationId === activeIdRef.current) followConversationBottom();
    if (terminal) clearConversationRun(conversationId);
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
            return {
              ...message,
              ...(typeof event?.content === "string" && event.content ? { content: event.content } : {}),
              ...(event?.kind ? { kind: event.kind === "agent" ? message.kind : event.kind } : {}),
              ...(event?.stage ? { statusStage: event.stage } : {}),
              ...(event?.context ? { context: event.context } : {}),
              ...(event?.image ? { images, kind: "image", count: event.imageTotal || message.count } : {}),
            };
          }),
        }));
        if (conversationId === activeIdRef.current) followConversationBottom();
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

  const launchRun = useCallback(async ({ conversationId, prompt, userMessage, assistantMessage, responseMode, sourceUserMessageId = "", proposalSourceMessageId = "" }) => {
    const controller = new AbortController();
    runControllersRef.current.get(conversationId)?.abort();
    runControllersRef.current.set(conversationId, controller);
    try {
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
        attachments: (userMessage.attachments || []).filter((item) => item.status === "ready").map((item) => ({ id: item.id })),
        quoted: userMessage.quoted || null,
        skill: userMessage.skill || "",
        model: assistantMessage.model || generationModel,
        ratio: assistantMessage.requestRatio || assistantMessage.ratio || generationRatio,
        resolution: assistantMessage.resolution || generationResolution,
        count: assistantMessage.count || generationCount,
        requestSize: assistantMessage.requestSize || (generationRatio === "auto" ? "auto" : `${customImageWidth}x${customImageHeight}`),
        width: assistantMessage.width || customImageWidth,
        height: assistantMessage.height || customImageHeight,
        quality: assistantMessage.quality || availableResolutions.find((item) => item.id === generationResolution)?.quality || "high",
        reasoningEffort: responseMode === "image" ? "" : assistantMessage.reasoningEffort || activeReasoningEffort,
        serviceKey: "assistant_image",
      }, { signal: controller.signal });
      if (!mountedRef.current) return;
      applyRunResult(conversationId, assistantMessage.id, created);
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
  }, [activeReasoningEffort, applyRunResult, availableResolutions, clearConversationRun, customImageHeight, customImageWidth, generationCount, generationModel, generationRatio, generationResolution, monitorRun, patchConversation]);

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
    const responseMode = documents.length ? "chat" : creationType === "image" ? "image" : creationType === "agent" ? "agent" : "chat";
    const requestedCount = imageCountFromPrompt(prompt) || generationCount;
    const assistantMessage = createAssistantPlaceholder({
      prompt,
      responseMode,
      userMessageId,
      defaults: {
        model: generationModel,
        reasoningEffort: activeReasoningEffort,
        ratio: generationRatio,
        resolution: generationResolution,
        count: requestedCount,
        requestSize: generationRatio === "auto" ? "auto" : `${customImageWidth}x${customImageHeight}`,
        quality: availableResolutions.find((item) => item.id === generationResolution)?.quality || "high",
        width: customImageWidth,
        height: customImageHeight,
      },
    });
    const currentQuote = quotedMessage ? { ...quotedMessage } : null;
    const userMessage = { id: userMessageId, role: "user", content: prompt, kind: "chat", quoted: currentQuote, referenceImages: references, attachments: documents.filter((item) => item.status === "ready"), createdAt: new Date().toISOString() };
    const visualContext = resolveVisualContext({ ...conversation, messages: [...conversation.messages, userMessage] }, prompt);
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
  }, [activeConversation, activeReasoningEffort, availableResolutions, creationType, customImageHeight, customImageWidth, documents, generationCount, generationModel, generationRatio, generationResolution, launchRun, patchConversation, quotedMessage, references, scrollToBottom]);

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
    const responseMode = documents.length ? "chat" : creationType === "image" ? "image" : creationType === "agent" ? "agent" : "chat";
    const requestedCount = imageCountFromPrompt(prompt) || generationCount;
    const confirmed = await confirmAssistantCost(responseMode, requestedCount, generationModel, activeReasoningEffort, {
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

  const addAssetReference = (asset) => {
    setReferences((current) => {
      if (current.length >= 4 || current.some((item) => item.dataUrl === asset.dataUrl)) return current;
      return [...current, { id: uid(), name: asset.label, dataUrl: asset.dataUrl, thumbnailUrl: asset.thumbUrl || asset.dataUrl, fileKey: "" }];
    });
    setAssetLibraryOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
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
    if (!activeConversation || activeRun || message.id !== lastAssistantId) return;
    const index = messages.findIndex((item) => item.id === message.id);
    const userMessage = messages[index - 1];
    const prompt = String(userMessage?.content || "").trim();
    if (index < 1 || !prompt) return;
    const responseMode = messageResponseMode(message);
    const model = modelForMode(responseMode, message.model);
    const retryEffort = message.reasoningEffort || activeReasoningEffort;
    if (!(await confirmAssistantCost(responseMode, message.count || generationCount, model, retryEffort))) return;
    const nextAssistant = { ...message, model, reasoningEffort: retryEffort, requestedMode: responseMode, content: "", images: [], feedback: "", error: "", pending: true, routing: responseMode === "agent", statusStage: responseMode === "image" ? "preparing-image" : "thinking" };
    patchConversation(activeConversation.id, (conversation) => ({ ...conversation, messages: conversation.messages.map((item) => item.id === message.id ? nextAssistant : item) }));
    await launchRun({ conversationId: activeConversation.id, prompt, userMessage, assistantMessage: nextAssistant, responseMode, sourceUserMessageId: userMessage.id });
  };

  const submitUserMessageEdit = async (message) => {
    const prompt = editingMessageDraft.trim();
    if (!activeConversation || activeRun || !prompt || assistantCharacterCount(prompt) > MAX_ASSISTANT_MESSAGE_CHARACTERS || message.id !== lastUserMessageId) return;
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) return;
    const previousReply = messages[messageIndex + 1];
    const responseMode = previousReply ? messageResponseMode(previousReply) : "chat";
    const model = modelForMode(responseMode, previousReply?.model);
    const count = Number(previousReply?.count || generationCount);
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
        ratio: previousReply?.ratio || generationRatio,
        requestRatio: previousReply?.requestRatio || generationRatio,
        resolution: previousReply?.resolution || generationResolution,
        count,
        requestSize: previousReply?.requestSize || (generationRatio === "auto" ? "auto" : `${customImageWidth}x${customImageHeight}`),
        width: previousReply?.width || customImageWidth,
        height: previousReply?.height || customImageHeight,
        quality: previousReply?.quality || availableResolutions.find((item) => item.id === generationResolution)?.quality || "high",
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
      const resolutionIds = normalizeImageModelCapabilities(selected || {}).resolutions;
      if (resolutionIds.length && !resolutionIds.includes(String(next.resolution || "").toUpperCase())) next.resolution = resolutionIds[0];
      const ratioIds = getModelAspectRatiosForResolution(selected, next.resolution);
      if (ratioIds.length && !ratioIds.includes(next.ratio)) next.ratio = ratioIds[0];
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
    const count = Math.max(1, Math.min(4, Number(proposal.count || 1)));
    const model = modelForMode("image", proposal.model);
    if (!(await confirmAssistantCost("image", count, model))) return;
    const request = imageRequestFromProposal(proposal);
    const userMessage = { id: uid(), role: "user", content: "执行这个创作方案", createdAt: new Date().toISOString(), proposalSourceMessageId: message.id, referenceImages: (proposal.referenceImages || []).map((image) => ({ ...image })) };
    const assistantMessage = createAssistantPlaceholder({ prompt, responseMode: "image", userMessageId: userMessage.id, defaults: { model, ratio: proposal.ratio || "auto", requestRatio: proposal.ratio || "auto", resolution: proposal.resolution || "1K", count, requestSize: request.requestSize, width: request.width, height: request.height, quality: proposal.quality || request.quality } });
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
    if (!activeRun?.id) return;
    const stoppingRun = activeRun;
    runControllersRef.current.get(activeId)?.abort();
    runControllersRef.current.delete(activeId);
    if (stoppingRun.conversationId && stoppingRun.assistantMessageId) {
      patchConversation(stoppingRun.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === stoppingRun.assistantMessageId
          ? { ...message, pending: false, routing: false, statusStage: "stopped", content: message.content || "已停止生成" }
          : message),
      }));
    }
    clearConversationRun(activeId);
    try {
      await cancelAssistantRun(stoppingRun.id);
    } catch (error) {
      notificationService.error(error?.message || "停止任务失败");
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

  return (
    <div className={`assistant-workspace${isDark ? " is-dark" : ""}${activeRun ? " is-generating" : ""}${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`} onClick={() => { setCreationMenuOpen(false); setModelMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); setActiveMessageMenuId(""); }}>
      <aside className="assistant-sidebar" onClick={(event) => event.stopPropagation()}>
        <div className="assistant-brand-row"><div className="assistant-brand"><strong>开启创作</strong></div><button className="icon-button sidebar-close" type="button" title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={updateSidebar}><i className={`bi bi-chevron-left${sidebarCollapsed ? " is-collapsed" : ""}`} /></button></div>
        <button className="new-chat-button" type="button" title="新对话" onClick={newConversation}><i className="bi bi-pencil-square" /><span>新对话</span></button>
        <div className="conversation-section">
          <p className="conversation-label"><span>最近</span><small>{conversations.filter((item) => item.messages.length).length}</small></p>
          <label className="conversation-search"><i className="bi bi-search" /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} type="text" placeholder="搜索对话" />{conversationSearch && <button type="button" aria-label="清空搜索" onClick={() => setConversationSearch("")}><i className="bi bi-x" /></button>}</label>
          <div className="conversation-list">
            {loading ? Array.from({ length: 5 }, (_, index) => <div key={index} className="conversation-skeleton" aria-hidden="true"><i /><span><b /><b /></span></div>) : filteredConversations.length ? filteredConversations.map((conversation) => { const thumbnail = conversationThumbnail(conversation); const running = Boolean(activeRuns[conversation.id]); return <div key={conversation.id} className={`conversation-row${conversation.id === activeId ? " active" : ""}`} data-conversation-id={conversation.id}><button className="conversation-select" type="button" title={conversation.title} onClick={() => { setConversationPeek(null); setActiveId(conversation.id); }} onMouseEnter={(event) => { if (!sidebarCollapsed) return; const rect = event.currentTarget.getBoundingClientRect(); setConversationPeek({ conversation, top: Math.max(64, Math.min(rect.top, window.innerHeight - 176)) }); }} onMouseLeave={() => setConversationPeek(null)}><span className={`conversation-thumb${thumbnail ? " has-image" : ""}${running ? " is-running" : ""}`}>{thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : <i className="bi bi-chat-square" />}{running && <i className="bi bi-arrow-repeat conversation-run-indicator" aria-label="任务处理中" />}</span><span className="conversation-copy"><span>{conversation.title}</span><small>{running ? "处理中" : formatTime(conversation.updatedAt)}</small></span></button><button className="conversation-delete" type="button" title="删除对话" aria-label="删除对话" onClick={() => setDeleteTarget(conversation)}><i className="bi bi-trash3" /></button></div>; }) : <p className="conversation-empty">暂无记录</p>}
          </div>
        </div>
      </aside>
      {conversationPeek && createPortal(<div className={`assistant-conversation-peek${isDark ? " is-dark" : ""}`} style={{ top: `${conversationPeek.top}px` }} aria-hidden="true"><strong>{conversationPeek.conversation.title}</strong>{(conversationPeek.conversation.messages || []).slice(-2).map((message, index) => <p key={`${message.id}-${index}`}><b>{message.role === "user" ? "我" : "AI"}</b>{message.images?.length ? `[图片 ×${message.images.length}]` : messagePreview(message.content)}</p>)}<small>{formatTime(conversationPeek.conversation.updatedAt)}</small></div>, document.body)}

      <main className={`assistant-main${messages.length ? "" : " is-empty"}`}>
        <div className="assistant-ambient-stage" aria-hidden="true"><i className="ambient-blob is-a" /><i className="ambient-blob is-b" /><i className="ambient-blob is-c" /></div>
        {messages.length > 0 && <header className="assistant-topbar"><div className="topbar-title"><span className="active-conversation-title" title={activeConversation?.title}>{activeConversation?.title}</span></div><div className="topbar-context"><AssistantContextMeter context={latestContext} /></div><div className="topbar-filters"><button type="button" title={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : "清除上文并保留可见历史"} aria-label={messages.at(-1)?.kind === "context-divider" ? "新的上下文已开始" : "清除上文并保留可见历史"} disabled={Boolean(activeRun) || messages.at(-1)?.kind === "context-divider"} onClick={() => void clearConversationContext()}><i className="bi bi-eraser" /><span>清除上文</span></button><button type="button" className={assetLibraryOpen ? "active" : ""} aria-pressed={assetLibraryOpen} title="资产库" aria-label="资产库" onClick={(event) => { event.stopPropagation(); setAssetLibraryOpen((value) => !value); }}><i className="bi bi-archive" /><span>资产库</span></button></div></header>}
        <div ref={messageScrollerRef} className="assistant-messages" onScroll={handleMessageScroll}>
          {loading ? <section className="assistant-thread-skeleton" aria-label="正在加载"><div className="sk-bubble is-user"><i style={{ width: "46%" }} /></div><div className="sk-bubble"><i style={{ width: "82%" }} /><i style={{ width: "64%" }} /></div><div className="sk-bubble is-user"><i style={{ width: "30%" }} /></div><div className="sk-bubble"><i style={{ width: "74%" }} /><i style={{ width: "40%" }} /></div></section> : messages.length === 0 ? <section className="assistant-empty-state" aria-label="空白创作区"><div className="assistant-empty-content"><span className="empty-mark"><i className="bi bi-stars" /></span><p className="empty-mode-label"><i className={`bi ${selectedCreation.icon}`} />{CREATION_TYPE_DESCRIPTIONS[creationType]}</p><h1>今天想创作什么？</h1><div className="suggestion-grid">{SUGGESTIONS.map(([icon, text]) => <button key={text} type="button" onClick={() => { setDraft(text); textareaRef.current?.focus(); }}><i className={`bi ${icon}`} /><span>{text}</span><i className="bi bi-arrow-up-right suggestion-arrow" /></button>)}</div></div></section> : <section className="message-thread" aria-live="polite">{hiddenMessageCount > 0 && <button className="load-earlier-messages" type="button" disabled={loadingEarlierRef.current} onClick={() => { const scroller = messageScrollerRef.current; if (scroller) scroller.scrollTop = 0; }}><i className="bi bi-clock-history" /><span>加载更早的对话（{hiddenMessageCount}）</span></button>}<div className="message-turns">{renderedMessages.map((message, offset) => {
            const originalIndex = firstRenderedMessageIndex + offset;
            const previous = messages[originalIndex - 1];
            const currentDate = new Date(message.createdAt);
            const previousDate = new Date(previous?.createdAt);
            const showDate = originalIndex === 0 || Number.isNaN(previousDate.getTime()) || currentDate.toDateString() !== previousDate.toDateString();
            const previousUser = message.role === "user" ? message : [...messages.slice(0, originalIndex)].reverse().find((item) => item.role === "user");
            const sourceProposal = sourceProposalForImage(message);
            return <AssistantMessageRow key={message.id} message={message} turnId={previousUser?.id} showDate={showDate} expanded={expandedStatusId === message.id} copied={copiedMessageId === message.id} generating={Boolean(activeRun)} isLastAssistant={message.id === lastAssistantId} isLastUser={message.id === lastUserMessageId} editing={editingMessageId === message.id} editingDraft={editingMessageDraft} moreOpen={activeMessageMenuId === message.id} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} imageModels={imageModels} sourceProposal={sourceProposal} proposalExecuted={messages.some((item) => item.role === "user" && item.proposalSourceMessageId === message.id)} onToggleStatus={toggleStatus} onCopy={copyMessage} onQuote={quoteMessage} onOpenImage={openImage} onImageLoad={markImageLoaded} onImageError={markImageFailed} onImageRetry={retryImage} onStartEdit={startEditingUserMessage} onEditDraft={setEditingMessageDraft} onCancelEdit={cancelUserMessageEdit} onSubmitEdit={(item) => void submitUserMessageEdit(item)} onWithdraw={(item) => void withdrawLastTurn(item)} onRetry={(item) => void retryAssistant(item)} onToggleMore={(id) => setActiveMessageMenuId((current) => current === id ? "" : id)} onDownloadMarkdown={downloadMarkdown} onDelete={(id) => void removeMessage(id)} onProposalChange={(patch) => updateProposal(message.id, patch)} onProposalDismiss={() => updateProposal(message.id, { dismissed: true })} onProposalRestore={() => { updateProposal(message.id, { dismissed: false }); scrollToMessage(message.id); }} onProposalApprove={() => void approveAgentProposal(message)} onReopenProposal={() => reopenSourceProposal(sourceProposal)} />;
          })}</div></section>}
        </div>

        {navigatorItems.length > 0 && <nav className="conversation-minimap" aria-label="对话位置导航">{navigatorItems.map((item) => <button key={item.id} type="button" className={activeNavigatorMessageId === item.id ? "active" : ""} aria-label={`跳转到：${item.preview}`} onClick={() => scrollToMessage(item.id)}><i /><span className="conversation-minimap-preview"><small>{item.date} · {item.time}</small><strong>{item.preview}</strong><em><i className={`bi ${item.icon}`} /> 对话节点</em></span></button>)}</nav>}

        <div className={`composer-zone${messages.length > 0 && !isAtBottom && !isReturningToBottom ? " is-scrolled-away" : ""}`} onClick={(event) => event.stopPropagation()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadReferences(event.dataTransfer.files); }}>
          {messages.length > 0 && !isAtBottom && !isReturningToBottom && <div className="return-to-bottom-row"><button className="return-to-bottom" type="button" title="回到底部" aria-label="回到底部" onClick={() => scrollToBottom("smooth")}><span>回到底部</span><i className="bi bi-chevron-double-down" /></button></div>}
          {serviceError && <div className="assistant-service-error"><i className="bi bi-exclamation-circle" /><span>{serviceError}</span><button type="button" onClick={() => void loadWorkspace()}><i className="bi bi-arrow-clockwise" />重试</button></div>}
          <div className={`assistant-composer${mode === "image" ? " is-image-mode" : ""}`}>
            {creationMenuOpen && <section className="composer-popover creation-type-menu"><p className="popover-eyebrow">创作类型</p>{CREATION_TYPES.map((type) => <button key={type.id} type="button" className={creationType === type.id ? "active" : ""} disabled={type.id === "image" && documents.length > 0} title={type.id === "image" && documents.length > 0 ? "先移除文档附件" : undefined} onClick={() => { setCreationType(type.id); setCreationMenuOpen(false); }}><i className={`bi ${type.icon}`} /><span>{type.label}</span>{creationType === type.id && <i className="bi bi-check-lg menu-check" />}</button>)}</section>}
            {modelMenuOpen && <section className="composer-popover image-model-menu" style={{ "--model-menu-left": "150px" }}><header className="model-menu-head"><p className="popover-eyebrow">{mode === "image" ? "选择图片模型" : "选择对话模型"}</p><span>{generationModels.length} 个模型</span></header>{generationModels.length > 6 && <div className="model-menu-search"><i className="bi bi-search" /><input value={modelSearch} type="text" placeholder="搜索模型名称" autoComplete="off" onChange={(event) => setModelSearch(event.target.value)} />{modelSearch && <button type="button" aria-label="清空模型搜索" title="清空" onClick={() => setModelSearch("")}><i className="bi bi-x-lg" /></button>}</div>}<div className="model-menu-options">{filteredGenerationModels.map((model) => <button key={model.model} type="button" className={generationModel === model.model ? "active" : ""} onClick={() => { mode === "image" ? setImageModel(model.model) : setConversationModel(model.model); setModelMenuOpen(false); setModelSearch(""); }}><span className="model-mark"><i className="bi bi-stars" /></span><span className="model-copy"><strong>{model.label}</strong></span><ModelMenuPrice model={mode === "image" ? model : modelWithReasoningPrice(model)} perImage={mode === "image"} /><span className="model-menu-check-slot">{generationModel === model.model && <i className="bi bi-check-lg menu-check" />}</span></button>)}{!filteredGenerationModels.length && <p className="skill-empty">{modelSearch ? "没有匹配的模型" : "后台暂未提供可用模型"}</p>}</div></section>}
            {reasoningMenuOpen && mode !== "image" && reasoningEfforts.length > 0 && (
              <section className="composer-popover reasoning-effort-menu" aria-label="推理强度">
                <header><p className="popover-eyebrow">推理强度</p><span>当前模型支持 {reasoningEfforts.length} 档</span></header>
                <div className="reasoning-effort-options">
                  {reasoningEfforts.map((effort) => (
                    <button key={effort} type="button" className={activeReasoningEffort === effort ? "active" : ""} aria-pressed={activeReasoningEffort === effort} onClick={() => { setReasoningEffort(effort); setReasoningMenuOpen(false); }}>
                      <span><strong>{REASONING_EFFORT_LABELS[effort] || effort}</strong><small>{effort} · {assistantReasoningPrice(selectedConversationModel, effort).effective} 积分/轮</small></span>
                      {activeReasoningEffort === effort && <i className="bi bi-check-lg menu-check" />}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {preferencesOpen && mode === "image" && (
              <section className="composer-popover image-mode-preferences" aria-label="图片生成参数">
                <div className="preferences-block">
                  <p className="preferences-label">选择比例</p>
                  <div className="ratio-options">
                    {availableRatios.map((item) => (
                      <button key={item.id} type="button" className={generationRatio === item.id ? "active" : ""} aria-pressed={generationRatio === item.id} onClick={() => setGenerationRatio(item.id)}>
                        <i className={`ratio-shape is-${item.shape}`} style={ratioPreviewStyle(item.id)} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="preferences-split">
                  <div className="preferences-block">
                    <p className="preferences-label">选择分辨率</p>
                    <div className="image-resolution-options">
                      {availableResolutions.map((option) => (
                        <button key={option.id} type="button" className={generationResolution === option.id ? "active" : ""} aria-pressed={generationResolution === option.id} onClick={() => setGenerationResolution(option.id)}>
                          {option.label}
                          <i className="bi bi-stars" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="preferences-block">
                    <p className="preferences-label">选择生成数量</p>
                    <div className="image-count-options">
                      {IMAGE_COUNTS.map((value) => (
                        <button key={value} type="button" className={generationCount === value ? "active" : ""} aria-pressed={generationCount === value} onClick={() => setGenerationCount(value)}>{value}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="preferences-block">
                  <p className="preferences-label">尺寸</p>
                  <div className="custom-image-size">
                    <label>
                      <span>W</span>
                      <input aria-label="图片宽度" value={customImageWidth} type="number" min="256" max="4096" onChange={(event) => setCustomImageWidth(Math.min(4096, Math.max(256, Number(event.target.value) || 256)))} />
                    </label>
                    <i className="bi bi-link-45deg" aria-hidden="true" />
                    <label>
                      <span>H</span>
                      <input aria-label="图片高度" value={customImageHeight} type="number" min="256" max="4096" onChange={(event) => setCustomImageHeight(Math.min(4096, Math.max(256, Number(event.target.value) || 256)))} />
                    </label>
                    <span>PX</span>
                  </div>
                </div>
              </section>
            )}
            <input ref={fileInputRef} className="reference-file-input" type="file" accept={mode === "image" ? "image/*" : "image/*,.txt,.md,.markdown,.csv,.json,.pdf,.docx,.xlsx,.pptx"} multiple aria-label={mode === "image" ? "添加参考图" : "添加图片或文档"} onChange={(event) => { void uploadReferences(event.target.files); event.target.value = ""; }} />
            {(references.length > 0 || documents.length > 0 || uploading) && <div className={`reference-dock has-images${uploading ? " is-uploading" : ""}`} aria-label="已添加的附件">{references.map((image) => <figure key={image.id} className="reference-card"><img src={image.thumbnailUrl || image.dataUrl} alt={image.name} /><button type="button" title="移除参考图" aria-label="移除参考图" onClick={() => setReferences((current) => current.filter((item) => item.id !== image.id))}><i className="bi bi-x" /></button></figure>)}{documents.map((item) => <div key={item.id} className={`reference-document-card is-${item.status || "queued"}`} title={item.errorMessage || item.name}><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{documentStatusLabel(item)} · {formatDocumentSize(item.sizeBytes)}</small></span><button type="button" title="移除文档" aria-label={`移除文档 ${item.name}`} onClick={() => removeComposerDocument(item)}><i className="bi bi-x" /></button></div>)}{uploading && <span className="reference-card reference-skeleton" aria-label="附件上传或解析中" />}</div>}
            {quotedMessage && <div className="composer-quote"><i className="bi bi-quote" /><span>[{quotedMessage.kind}] {quotedMessage.content}</span><button type="button" title="移除引用" aria-label="移除引用" onClick={() => setQuotedMessage(null)}><i className="bi bi-x-lg" /></button></div>}
            <textarea ref={textareaRef} value={draft} rows={1} aria-label="消息输入" placeholder={mode === "image" ? "描述你想生成的画面，也可以上传参考图" : "输入问题，或粘贴、拖入图片和文档"} disabled={Boolean(activeRun) || Boolean(serviceError)} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => { const files = assistantClipboardFiles(event.clipboardData); if (files.length) { event.preventDefault(); void uploadReferences(files); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void requestSend(); } }} />
            {draftCharacterCount > 10000 && <div className={`draft-counter${draftCharacterCount > MAX_ASSISTANT_MESSAGE_CHARACTERS ? " is-over" : ""}`}>{draftCharacterCount.toLocaleString("zh-CN")} / 12,000</div>}
            <div className="composer-toolbar">
              <div className="composer-left">
                <button className="composer-attachment-inline" type="button" title={mode === "image" ? "添加参考图" : "添加附件"} aria-label={mode === "image" ? "添加参考图" : "添加附件"} onClick={() => fileInputRef.current?.click()}><i className="bi bi-paperclip" /></button>
                <button className={`agent-mode-button${creationMenuOpen ? " active" : ""}`} type="button" onClick={() => { setCreationMenuOpen((value) => !value); setModelMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); }}><i className={`bi ${selectedCreation.icon}`} /><span>{selectedCreation.label}</span><i className={`bi ${creationMenuOpen ? "bi-chevron-up" : "bi-chevron-down"}`} /></button>
                <button className={`composer-tool-button image-model-button${modelMenuOpen ? " active" : ""}`} type="button" title={`模型：${generationModelLabel}`} aria-label={`选择模型，当前为${generationModelLabel}`} onClick={() => { setModelMenuOpen((value) => !value); setCreationMenuOpen(false); setReasoningMenuOpen(false); setPreferencesOpen(false); }}><i className={`bi ${mode === "image" ? "bi-box" : "bi-cpu"}`} /><span>{generationModelLabel}</span><i className={`bi ${mode === "image" ? "bi-stars" : "bi-chevron-down"}`} /></button>
                {mode === "image" ? (
                  <button className={`composer-tool-button image-settings-button${preferencesOpen ? " active" : ""}`} type="button" onClick={() => { setPreferencesOpen((value) => !value); setCreationMenuOpen(false); setModelMenuOpen(false); setReasoningMenuOpen(false); }}><i className="ratio-shape is-square" /><span>{generationRatio === "auto" ? "Auto" : generationRatio} | {generationResolution} | {generationCount}</span></button>
                ) : (
                  <>
                    {reasoningEfforts.length > 0 && activeReasoningEffort ? <button className={`composer-tool-button reasoning-effort-button${reasoningMenuOpen ? " active" : ""}`} type="button" title={`推理强度：${reasoningEffortLabel}`} aria-label={`选择推理强度，当前为${reasoningEffortLabel}`} onClick={() => { setReasoningMenuOpen((value) => !value); setCreationMenuOpen(false); setModelMenuOpen(false); setPreferencesOpen(false); }}><i className="bi bi-speedometer2" /><span>推理 {reasoningEffortLabel}</span><i className={`bi ${reasoningMenuOpen ? "bi-chevron-up" : "bi-chevron-down"}`} /></button> : null}
                    <button className={`composer-tool-button${documents.length ? " active" : ""}`} type="button" disabled title={documents.length ? "文档分析已启用" : "上传文档后自动启用"} aria-label={documents.length ? "文档分析已启用" : "使用技能"}><i className={`bi ${documents.length ? "bi-file-earmark-search" : "bi-wrench-adjustable"}`} /><span>{documents.length ? "文档分析" : "使用技能"}</span></button>
                    <button className="composer-tool-button is-mention" type="button" disabled title="暂未开放" aria-label="添加主体，暂未开放"><span>@</span></button>
                  </>
                )}
              </div>
              {activeRun ? <button className="send-button stop-button" type="button" aria-label="停止生成" onClick={() => void stopRun()}><span className="stop-glyph" /></button> : <button className="send-button" type="button" title="发送" aria-label="发送" disabled={auth.isAuthenticated && !canSend} onClick={() => void requestSend()}><span className="send-glyph"><i className="bi bi-arrow-up" /></span></button>}
            </div>
          </div>
        </div>
      </main>

      {assetLibraryOpen && <aside className="asset-library-panel" aria-label="资产库" onClick={(event) => event.stopPropagation()}><header className="asset-library-header"><div className="asset-library-tabs" role="tablist" aria-label="资产范围"><button type="button" role="tab" aria-selected={assetTab === "session"} className={assetTab === "session" ? "active" : ""} onClick={() => setAssetTab("session")}>会话资产</button><button type="button" role="tab" aria-selected={assetTab === "all"} className={assetTab === "all" ? "active" : ""} onClick={() => setAssetTab("all")}>全部资产</button></div><button className="asset-close" type="button" title="关闭资产库" aria-label="关闭资产库" onClick={() => setAssetLibraryOpen(false)}><i className="bi bi-x-lg" /></button></header><div className="asset-search-row"><label><i className="bi bi-search" /><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} type="text" placeholder="搜索图片资产" /></label><button type="button" title="筛选" aria-label="筛选"><i className="bi bi-funnel" /></button></div><nav className="asset-type-tabs" aria-label="资产类型"><button type="button" className="active">图片</button><button type="button">视频</button><button type="button">音频</button><button type="button">文档</button><button type="button">主体</button></nav><div className="asset-image-grid">{assetLibraryImages.map((asset) => <button key={asset.id} type="button" title={`添加 ${asset.label} 到参考图`} onClick={() => addAssetReference(asset)}><img src={asset.thumbUrl || asset.dataUrl} alt={asset.label} loading="lazy" decoding="async" /><span><i className="bi bi-plus-lg" /></span></button>)}</div>{!assetLibraryImages.length && <div className="asset-empty"><i className="bi bi-images" /><p>没有匹配的图片资产</p></div>}<footer className="asset-library-footer"><span>{assetLibraryImages.length} 个图片资产</span><small>点击图片即可添加为参考图</small></footer></aside>}

      {deleteTarget && createPortal(<div className="assistant-dialog-layer" role="presentation"><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-delete-title"><span className="dialog-icon is-danger"><i className={`bi ${activeRuns[deleteTarget.id] ? "bi-stop-circle" : "bi-trash3"}`} /></span><div><h2 id="assistant-delete-title">{activeRuns[deleteTarget.id] ? "停止任务并删除对话？" : "删除这个对话？"}</h2><p>“{deleteTarget.title}”{activeRuns[deleteTarget.id] ? "仍在处理中。继续操作会先停止任务，再永久删除对话和已生成内容。" : "及其中的消息将被永久删除。"}</p></div><div className="dialog-actions"><button type="button" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="is-danger" onClick={() => void deleteConversationRow()}>{activeRuns[deleteTarget.id] ? "停止任务并删除" : "删除"}</button></div></section></div>, document.body)}
      <AssistantCostDialog payload={costPayload} light={!isDark} onCancel={cancelCost} onConfirm={(skip) => void confirmCost(skip)} />
      <AssistantImageViewer value={selectedImage} onClose={closeImage} onStep={stepImage} />
    </div>
  );
}
