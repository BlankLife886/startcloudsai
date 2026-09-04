import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { conversationTitle, createAssistantPlaceholder, uid } from "./domain/assistantMessages.js";
import { assistantCodeLanguageLabel, highlightAssistantCode } from "./domain/assistantCodeHighlight.js";
import { markAssistantMessageLocal } from "./domain/assistantRetryPolicy.js";
import { resolveVisualContext } from "./domain/visualContext.js";
import { getModelAspectRatiosForResolution, normalizeImageModelCapabilities } from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";

const CREATION_TYPES = [
  { id: "chat", label: "问答模式", icon: "bi-chat-left-dots", mark: "chat" },
  { id: "agent", label: "Agent 模式", icon: "bi-magic", mark: "agent" },
  { id: "image", label: "图片生成", icon: "bi-image", mark: "image" },
];

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
const LOAD_EARLIER_COOLDOWN_MS = 200;
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

function referenceImageIdentity(image = {}) {
  return String(image.id || image.fileKey || imageUrl(image) || "").trim();
}

function proposalImagePlanItems(proposal = {}) {
  const items = (Array.isArray(proposal.items) ? proposal.items : [])
    .map((item, index) => ({
      ...item,
      id: String(item?.id || `item-${index + 1}`).trim(),
      title: String(item?.title || `图片 ${index + 1}`).trim(),
      prompt: String(item?.prompt || "").trim(),
      referencedImageIds: [...new Set((Array.isArray(item?.referencedImageIds)
        ? item.referencedImageIds
        : Array.isArray(item?.referenceImageIds) ? item.referenceImageIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean))],
      referenceImages: uniqueReferenceImages(item?.referenceImages),
    }));
  return items.length >= 2 ? items : [];
}

function proposalReferenceImages(proposal = {}, sourceReferences = []) {
  const items = proposalImagePlanItems(proposal);
  const inheritedReferences = proposal.referenceImagesEdited === true ? [] : sourceReferences;
  return uniqueReferenceImages([
    ...inheritedReferences,
    ...(Array.isArray(proposal.referenceImages) ? proposal.referenceImages : []),
    ...items.flatMap((item) => item.referenceImages),
  ]);
}

function resolveProposalReferences(conversation = {}, proposalMessage = {}, maxReferences = MAX_MODEL_REFERENCE_IMAGES) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const messageIndex = messages.findIndex((item) => item.id === proposalMessage.id);
  const history = messageIndex >= 0 ? messages.slice(0, messageIndex + 1) : messages;
  const sourceUser = (proposalMessage.userMessageId && history.find((item) => item.id === proposalMessage.userMessageId))
    || [...history].reverse().find((item) => item.role === "user");
  const sourcePrompt = String(sourceUser?.content || proposalMessage.prompt || "").trim();
  const explicitReferences = uniqueReferenceImages(sourceUser?.referenceImages || []);
  const referencesEdited = proposalMessage?.proposal?.referenceImagesEdited === true;
  const contextualReferences = explicitReferences.length && !referencesEdited
    ? explicitReferences
    : referencesEdited
      ? []
    : resolveVisualContext(
      { ...conversation, messages: history },
      sourcePrompt,
      maxReferences,
      { force: proposalMessage?.proposal?.action === "edit" },
    );

  return {
    sourceUser,
    sourcePrompt,
    references: proposalReferenceImages(proposalMessage.proposal, contextualReferences),
  };
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

function collectConversationLinks(source = []) {
  const links = new Map();
  const push = (rawUrl, title, conversation, message) => {
    try {
      const parsed = new URL(String(rawUrl || "").trim(), window.location.origin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      const url = parsed.href;
      const label = String(title || "").replace(/\s+/g, " ").trim();
      const fallbackLabel = parsed.hostname.replace(/^www\./i, "") || url;
      const current = links.get(url);
      if (current) {
        current.occurrences += 1;
        if ((!current.label || current.label === current.host) && label && label !== url) current.label = label;
        return;
      }
      links.set(url, {
        id: url,
        url,
        label: label && label !== url ? label : fallbackLabel,
        host: fallbackLabel,
        conversationTitle: String(conversation?.title || "").trim(),
        role: message?.role || "",
        occurrences: 1,
      });
    } catch {
      // Ignore malformed and non-web links.
    }
  };

  for (const conversation of source) {
    for (const message of conversation?.messages || []) {
      for (const search of Array.isArray(message.webSearches) ? message.webSearches : []) {
        for (const item of Array.isArray(search?.sources) ? search.sources : []) {
          push(item?.url, item?.title, conversation, message);
        }
      }
      const content = String(message?.content || "").trim();
      if (!content) continue;
      const root = document.createElement("div");
      root.innerHTML = renderAssistantMarkdownHtml(content, { streaming: false });
      root.querySelectorAll("a[href]").forEach((anchor) => {
        push(anchor.getAttribute("href"), anchor.textContent, conversation, message);
      });
    }
  }
  return [...links.values()];
}

function assistantActionImages(conversation, message, action) {
  const requested = new Set((action?.payload?.referencedImageIds || []).map(String).filter(Boolean));
  const found = [];
  const seen = new Set();
  for (const candidate of conversation?.messages || []) {
    for (const field of ["referenceImages", "images"]) {
      for (const [index, image] of (candidate?.[field] || []).entries()) {
        const source = imageUrl(image);
        if (!source || seen.has(source)) continue;
        const aliases = [image?.id, image?.fileKey, source, `${candidate.id}-${field}-${index + 1}`].map(String);
        if (requested.size && !aliases.some((value) => requested.has(value))) continue;
        seen.add(source);
        found.push({
          id: String(image?.id || aliases[3]),
          name: String(image?.name || `参考图-${found.length + 1}.png`),
          dataUrl: source,
          thumbnailUrl: imageThumbUrl(image),
          fileKey: String(image?.fileKey || fileKeyFromAssetUrl(source)),
        });
      }
    }
  }
  if (found.length || requested.size) return found.slice(-8);
  const messageIndex = Math.max(0, (conversation?.messages || []).findIndex((item) => item.id === message?.id));
  const recent = (conversation?.messages || []).slice(0, messageIndex + 1).reverse();
  for (const candidate of recent) {
    for (const image of [...(candidate?.images || []), ...(candidate?.referenceImages || [])].reverse()) {
      const source = imageUrl(image);
      if (!source || seen.has(source)) continue;
      seen.add(source);
      found.push({
        id: String(image?.id || image?.fileKey || source),
        name: String(image?.name || `参考图-${found.length + 1}.png`),
        dataUrl: source,
        thumbnailUrl: imageThumbUrl(image),
        fileKey: String(image?.fileKey || fileKeyFromAssetUrl(source)),
      });
      if (found.length >= 8) return found;
    }
  }
  return found;
}

function safeDeliveryName(value, fallback = "AI-创作交付包") {
  return String(value || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}

async function exportAssistantDelivery(conversation, action) {
  const [{ saveAs }, { strToU8, zipSync }] = await Promise.all([import("file-saver"), import("fflate")]);
  const scope = String(action?.payload?.scope || "conversation");
  const allMessages = conversation?.messages || [];
  const selectedMessages = scope === "latest"
    ? [...allMessages].reverse().filter((item) => item.images?.length).slice(0, 1)
    : allMessages;
  const entries = {};
  const manifestImages = [];
  let imageIndex = 0;
  for (const message of selectedMessages) {
    for (const image of message?.images || []) {
      const source = imageUrl(image);
      if (!source) continue;
      const response = await fetch(source, { credentials: "include" });
      if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const extension = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
      const filename = `images/${String(++imageIndex).padStart(3, "0")}.${extension}`;
      entries[filename] = new Uint8Array(await blob.arrayBuffer());
      manifestImages.push({
        file: filename,
        prompt: image?.revisedPrompt || message?.prompt || "",
        model: message?.model || "",
        ratio: message?.requestRatio || message?.ratio || "",
        resolution: message?.resolution || message?.requestSize || "",
        quality: message?.quality || "",
        createdAt: message?.createdAt || "",
      });
    }
  }
  if (!manifestImages.length) throw new Error("当前对话没有可导出的生成图片");
  const prompts = manifestImages.map((item, index) => `## 图片 ${index + 1}\n\n${item.prompt || "未记录提示词"}\n`).join("\n");
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversation: { title: conversation?.title || "AI 助手", id: conversation?.id || "" },
    imageCount: manifestImages.length,
    images: manifestImages,
  };
  entries["prompts.md"] = strToU8(`# ${conversation?.title || "AI 创作交付"}\n\n${prompts}`);
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  entries["README.txt"] = strToU8("交付包包含生成图片、提示词和生成参数。manifest.json 可供程序读取。\n");
  const archive = zipSync(entries, { level: 6 });
  saveAs(new Blob([archive], { type: "application/zip" }), `${safeDeliveryName(action?.payload?.name)}.zip`);
  return manifestImages.length;
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


function imageThumbUrl(image = {}) {
  return String(image.thumbUrl || image.thumbnailUrl || "").trim() || imageUrl(image);
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

function createLocalAssistantPlaceholder(options) {
  return markAssistantMessageLocal(createAssistantPlaceholder(options));
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
    if (images.length) return imageThumbUrl(images[images.length - 1]);
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
  return {
    conversationModels,
    imageModels,
    editableFilesEnabled: config.editableFilesEnabled === true,
  };
}

function preferenceMotionDisabled() {
  return document.documentElement.classList.contains("settings-no-animations")
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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


export {
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
  conversationMark,
  conversationSearchGroupLabel,
  conversationThumbnail,
  createLocalAssistantPlaceholder,
  defaultReasoningEffort,
  documentIcon,
  documentStatusLabel,
  estimateAssistantTokens,
  exportAssistantDelivery,
  fileKeyFromAssetUrl,
  formatConversationRelativeTime,
  formatDocumentSize,
  formatDurationMs,
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
  reasoningEffortOptionPriceModel,
  requestedConversationId,
  resolveProposalReferences,
  sameAssetReference,
  syncConversationUrl,
  uniqueReferenceImages,
  usageStartedAtMs,
  applyThreadSearchMarks,
  assistantModelLabel,
  copyAssistantImage,
  downloadAssistantImage,
  ensureStreamCaret,
  formatContextTokens,
  formatElapsedClock,
  highlightSearchNodes,
  imageGenerationMeta,
  imageDisplayUrl,
  imageRatioValue,
  imageThumbUrl,
  normalizeAssistantUsage,
  preferenceMotionDisabled,
  proposalReferenceImages,
  ratioPreviewStyle,
  referenceImageIdentity,
  renderAssistantMarkdownHtml,
  retryableImageUrl,
  streamInsideFence,
  streamNeedsRebuild,
  takeStreamChunk,
  appendStreamChunk,
  useElapsedMs,
};
