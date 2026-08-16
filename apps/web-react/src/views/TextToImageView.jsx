import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useNavigate } from "react-router";
import {
  buildWallpaperSkillPrompt,
  resolveActiveWallpaperSkills,
} from "@react/legacy-modules/features/ai-wallpaper/skills/wallpaperSkills.js";
import {
  T2I_ASPECT_OPTIONS,
  T2I_COUNT_OPTIONS,
  T2I_MODERATION_OPTIONS,
  T2I_OUTPUT_FORMAT_OPTIONS,
  T2I_QUALITY_OPTIONS,
  T2I_RESOLUTION_OPTIONS,
  WALLPAPER_PROMPT_PRESETS,
  WALLPAPER_SKILL_OPTIONS,
  resolveT2iOutputSize,
} from "@react/legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import {
  getModelAutoAspectRatioCandidates,
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import {
  fetchRuntimeConfig,
  getDefaultRuntimeConfig,
  normalizeRuntimeConfig,
} from "@react/legacy-modules/services/runtimeConfig.js";
import { getWallet, updateProfile } from "@react/legacy-modules/services/meApi.js";
import { getFeatureUnitPriceCents } from "@react/legacy-modules/services/pricing.js";
import { registerUploadedUrl } from "@react/legacy-modules/services/aiWallpaper.js";
import { downloadAuthenticatedMedia } from "@react/legacy-modules/services/authenticatedMedia.js";
import {
  listPromptCategories,
  listPromptLibrary,
  recordPromptEngagement,
} from "@react/legacy-modules/services/promptLibrary.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { AI_WALLPAPER_STUDIO_DRAFT_KEY } from "@react/legacy-modules/services/aiWallpaperState.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import {
  getScopedLocalItem,
  setScopedLocalItem,
} from "@react/legacy-modules/services/scopedLocalStorage.js";
import "@react/legacy-static/features/ai-wallpaper/styles/t2i-page.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { ProgressiveAuthenticatedImage } from "../components/ProgressiveAuthenticatedImage.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { useContentReveal } from "../components/motion/useContentReveal.js";
import { useTextToImageJobs } from "../features/text-to-image/useTextToImageJobs.js";
import "./TextToImageView.css";

gsap.registerPlugin(useGSAP);

const DRAFT_KEY = AI_WALLPAPER_STUDIO_DRAFT_KEY;
const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const PROMPT_CATEGORY_STORAGE_KEY = "ai-wallpaper-prompt-category-v1";
const PROMPT_CATEGORY_PRIMARY = [
  ["today", "24小时最新"],
  ["my-favorites", "我的收藏"],
  ["all", "全部"],
];
const PROMPT_SCOPE_CATEGORIES = new Set(PROMPT_CATEGORY_PRIMARY.map(([value]) => value));

function readStoredPromptCategory() {
  return String(getScopedLocalItem(PROMPT_CATEGORY_STORAGE_KEY) || "").trim();
}

function initialPromptCategory() {
  const stored = readStoredPromptCategory();
  if (stored === "latest") return "today";
  return PROMPT_SCOPE_CATEGORIES.has(stored) ? stored : "all";
}

function promptAspectScore(aspect) {
  const [width, height] = String(aspect || "").split("/").map((part) => Number(part.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return 1 / Math.max(0.35, Math.min(width / height, 3.2));
}

function buildBalancedPromptColumns(items, columnCount) {
  const count = Math.max(1, Number(columnCount) || 1);
  const columns = Array.from({ length: count }, () => []);
  const heights = Array.from({ length: count }, () => 0);
  items.forEach((item) => {
    let target = 0;
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index] < heights[target]) target = index;
    }
    columns[target].push(item);
    heights[target] += promptAspectScore(item.aspect);
  });
  return columns;
}

function storedRuntimeConfig() {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("walleven.runtime-config.v2") || "null",
    );
    return normalizeRuntimeConfig(value?.config || getDefaultRuntimeConfig());
  } catch {
    return getDefaultRuntimeConfig();
  }
}

function storedDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function normalizePublicModel(item = {}) {
  const id = String(item.id || item.publicModelKey || item.model || "").trim();
  if (!id) return null;
  const pointPricing = resolveModelPointPricing(item);
  return {
    ...item,
    ...normalizeImageModelCapabilities(item),
    id,
    label: String(item.label || item.name || id),
    pointPricing,
    creditCost: Math.max(0, Number(pointPricing.effective ?? 0)),
  };
}

function wallpaperFeature(config = {}) {
  const raw = config.features?.["ai.wallpaperGeneration"] || {};
  return raw.config && typeof raw.config === "object"
    ? { ...raw, ...raw.config }
    : raw;
}

function featureModels(config) {
  const feature = wallpaperFeature(config);
  const values = Array.isArray(feature.publicModels) ? feature.publicModels : [];
  return values.map(normalizePublicModel).filter(Boolean);
}

function ratioStyle(value) {
  if (value === "auto") return { aspectRatio: "1 / 1" };
  const [width, height] = String(value).split(":").map(Number);
  return { aspectRatio: `${width || 1} / ${height || 1}` };
}

function compactRatioClass(value) {
  if (value === "auto") return "is-auto";
  const [width, height] = String(value || "").split(":").map(Number);
  if (width === height) return "is-square";
  return width > height ? "is-landscape" : "is-portrait";
}

function stageAspectValue(task, measuredAspect = "") {
  const measured = String(measuredAspect || "").trim();
  if (measured) return measured;
  const sizeMatch = String(task?.actualOutputSize || "").match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (sizeMatch && Number(sizeMatch[1]) > 0 && Number(sizeMatch[2]) > 0) {
    return `${Number(sizeMatch[1])} / ${Number(sizeMatch[2])}`;
  }
  const [width, height] = String(task?.aspectRatio || "16:9").split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? `${width} / ${height}`
    : "16 / 9";
}

function stageFrameStyle(task, measuredAspect = "") {
  const aspect = stageAspectValue(task, measuredAspect);
  const [width, height] = aspect.split("/").map(Number);
  const ratio = Number.isFinite(width) && Number.isFinite(height) && height > 0
    ? width / height
    : 16 / 9;
  return {
    aspectRatio: aspect,
    "--t2i-stage-fit-width": `${ratio * 100}cqh`,
    "--t2i-stage-max-width": ratio > 1 ? "1280px" : "920px",
  };
}

function stageGridLayout(count, imageAspect, canvasAspect) {
  if (count < 2) return null;
  const [width, height] = String(imageAspect || "1 / 1").split("/").map(Number);
  const imageRatio = Number.isFinite(width) && Number.isFinite(height) && height > 0
    ? width / height
    : 1;
  const targetRatio = Number(canvasAspect) > 0 ? Number(canvasAspect) : 16 / 9;
  const candidates = [];
  for (let columns = 1; columns <= count; columns += 1) {
    if (count % columns === 0) {
      candidates.push({ columns, rows: count / columns, collage: false });
    }
  }
  if (count === 3) candidates.push({ columns: 2, rows: 2, collage: true });
  return candidates.reduce((best, candidate) => {
    const ratio = (imageRatio * candidate.columns) / candidate.rows;
    const score = Math.abs(Math.log(ratio / targetRatio));
    return !best || score < best.score ? { ...candidate, ratio, score } : best;
  }, null);
}

function showsTransparentCanvas(task) {
  return task?.transparentPngEnabled === true || task?.automaticBackgroundRemoval === true;
}

function taskOutput(task) {
  return taskOutputs(task)[0] || taskThumbnailOutputs(task)[0] || "";
}

function taskOutputs(task) {
  const preferred = Array.isArray(task?.originalOutputs) && task.originalOutputs.length
    ? task.originalOutputs
    : task?.outputs;
  return Array.from(
    new Set((Array.isArray(preferred) ? preferred : []).map(String).filter(Boolean)),
  );
}

function taskThumbnailOutputs(task) {
  if (task?.hasDedicatedThumbnails === false) return [];
  return Array.from(
    new Set(
      (Array.isArray(task?.thumbnailOutputs) ? task.thumbnailOutputs : [])
        .map(String)
        .filter(Boolean),
    ),
  );
}

function taskGroupKey(task) {
  return task?.batchId ? `batch:${task.batchId}` : `task:${task?.id || "unknown"}`;
}

function isToday(value) {
  const date = new Date(value || 0);
  const today = new Date();
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function taskMeta(task, now) {
  const size = task.actualOutputSize || task.outputSize || "";
  const elapsed = elapsedLabel(task, now);
  return [
    task.model || task.publicModelKey || "未知模型",
    task.resolutionScale,
    task.aspectRatio,
    size ? `实际 ${size}` : "",
    task.finishedAt
      ? new Date(task.finishedAt).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    elapsed ? `生成耗时 ${elapsed}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function downloadFilename(task, index = 0) {
  const extension = task?.outputFormat === "jpeg" ? "jpg" : task?.outputFormat || "png";
  return `starcloud-${String(task?.id || "image").slice(-12)}-${index + 1}.${extension}`;
}

function statusLabel(task) {
  if (task.status === "queued") return "排队中";
  if (task.status === "waiting_provider") return "等待模型响应";
  if (task.status === "running") return "正在生成";
  if (task.status === "completed") return "已完成";
  if (["cancelled", "canceled"].includes(task.status)) return "已取消";
  if (task.status === "failed") return "生成失败";
  return task.status || "处理中";
}

function useClock(enabled) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function elapsedLabel(task, now) {
  // queued 没有真正 startedAt，不能计入生成耗时。
  if (task.status === "queued" || !task.startedAt) return "";
  const started = Date.parse(task.startedAt);
  if (!Number.isFinite(started)) return "";
  const finished = Date.parse(task.finishedAt || "");
  const seconds = Math.max(
    0,
    Math.floor(((Number.isFinite(finished) ? finished : now) - started) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function buildGalleryItems(tasks, unavailableImageKeys = {}) {
  const items = [];
  for (const task of tasks.slice(0, 120)) {
    if (!isToday(task.createdAt)) continue;
    const outputs = taskOutputs(task);
    const thumbnails = taskThumbnailOutputs(task);
    if (outputs.length) {
      outputs.forEach((url, index) => {
        if (unavailableImageKeys[`${task.id}::${index}::${url}`]) return;
        items.push({
          key: `${task.id}-${index}`,
          kind: "image",
          task,
          url,
          thumbnailUrl: thumbnails[index] || "",
          index,
          batchIndex:
            Number(task.batchSize || 1) > 1 ? Number(task.batchIndex || 0) : index,
          total:
            Number(task.batchSize || 1) > 1 ? Number(task.batchSize) : outputs.length,
          title: task.prompt || "图片生成",
        });
      });
      continue;
    }
    if (ACTIVE_STATUSES.has(task.status)) {
      const batchSize = Math.max(1, Number(task.batchSize || 1));
      const slots = batchSize > 1
        ? 1
        : Math.min(4, Math.max(1, Number(task.count || 1)));
      for (let index = 0; index < slots; index += 1) {
      items.push({
        key: `pending-${task.id}-${index}`,
        kind: "pending",
        task,
        index,
        batchIndex: batchSize > 1 ? Number(task.batchIndex || 0) : index,
        total: batchSize > 1 ? batchSize : slots,
        title: task.prompt || "图片生成",
      });
      }
      continue;
    }
    if (["cancelled", "canceled"].includes(task.status)) {
      items.push({
        key: `status-${task.id}`,
        kind: "status",
        task,
        index: 0,
        batchIndex: Number(task.batchIndex || 0),
        total: Math.max(1, Number(task.batchSize || 1)),
        title: task.prompt || "图片生成",
      });
    }
  }
  const groups = new Map();
  items.forEach((item) => {
    const key = taskGroupKey(item.task);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });
  groups.forEach((group) => {
    group.sort((left, right) =>
      Number(left.task?.batchIndex || 0) - Number(right.task?.batchIndex || 0) ||
      Number(left.index || 0) - Number(right.index || 0));
    group.forEach((item, index) => {
      item.batchIndex = index;
      item.total = group.length;
    });
  });
  return items;
}

function groupGalleryItems(items) {
  const groups = [];
  const byKey = new Map();
  for (const item of items) {
    const key = taskGroupKey(item.task);
    let group = byKey.get(key);
    if (!group) {
      group = { key, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups.map((group) => {
    group.items.sort(
      (left, right) =>
        Number(left.batchIndex || left.index || 0) -
        Number(right.batchIndex || right.index || 0),
    );
    const imageCover = group.items.find((item) => item.kind === "image");
    const pendingCount = group.items.filter((item) => item.kind === "pending").length;
    return {
      ...group,
      cover: imageCover || group.items[0],
      pendingCount,
      kind: imageCover ? (pendingCount ? "mixed" : "image") : "pending",
    };
  });
}

function transitionClasses(name, phase) {
  if (phase === "entering") return `${name}-enter-active ${name}-enter-from`;
  if (phase === "open") return `${name}-enter-active`;
  if (phase === "closing") return `${name}-leave-active ${name}-leave-to`;
  return "";
}

function usePopoverPresence(open, duration, key = "popover") {
  const [mounted, setMounted] = useState(Boolean(open));
  const [phase, setPhase] = useState(open ? "open" : "closed");
  const [renderKey, setRenderKey] = useState(key);

  useEffect(() => {
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("settings-no-animations");
    let firstFrame = 0;
    let secondFrame = 0;
    let timer = 0;
    if (open) {
      setRenderKey(key);
      setMounted(true);
      if (reduceMotion) {
        setPhase("open");
      } else {
        setPhase("entering");
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(() => setPhase("open"));
        });
      }
    } else if (mounted) {
      if (reduceMotion) {
        setMounted(false);
        setPhase("closed");
      } else {
        setPhase("closing");
        timer = window.setTimeout(() => {
          setMounted(false);
          setPhase("closed");
        }, duration);
      }
    }
    return () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (timer) window.clearTimeout(timer);
    };
  }, [duration, key, mounted, open]);

  return { mounted, phase, key: renderKey };
}

function CostConfirmDialog({ cost, light = false, onCancel, onConfirm }) {
  const [skipEveryTime, setSkipEveryTime] = useState(false);
  const costRef = useRef(cost);
  if (cost) costRef.current = cost;
  useEffect(() => {
    if (cost) setSkipEveryTime(false);
  }, [cost]);
  const activeCost = costRef.current;
  if (!activeCost) return null;
  const total = Math.max(0, Number(activeCost.total || 0));
  const available = Number.isFinite(Number(activeCost.available))
    ? Math.max(0, Number(activeCost.available))
    : null;
  const insufficient = available != null && total > available;
  const remaining = available == null ? null : Math.max(0, available - total);
  return (
    <DialogMotion
      open={Boolean(cost)}
      layerClassName={`ai-cost-confirm-layer${light ? " is-light" : ""}`}
      panelClassName="ai-cost-confirm-panel is-credits"
      ariaLabelledby="ai-cost-confirm-title"
      ariaDescribedby="ai-cost-confirm-summary"
      onClose={onCancel}
    >
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon"><i className="bi bi-coin" /></span>
          <div className="ai-cost-confirm-titles">
            <span className="ai-cost-confirm-eyebrow">文生图</span>
            <h5 id="ai-cost-confirm-title">确认生成费用</h5>
          </div>
          <button className="ai-cost-confirm-close" type="button" aria-label="关闭费用确认" title="关闭" onClick={onCancel}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <p id="ai-cost-confirm-summary" className="ai-cost-confirm-summary">提交后先冻结预计费用，任务完成后按实际生成结果结算。</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total">
            <div className="ai-cost-confirm-total__copy">
              <span>本次预计</span>
              <small>{activeCost.unit} 积分 / 张 × {activeCost.count} 张</small>
            </div>
            <strong>{total > 0 ? `${total.toLocaleString("zh-CN")} 积分` : "按实际用量结算"}</strong>
          </div>
          <div className="ai-cost-confirm-balance">
            <div><span>当前可用</span><strong>{available == null ? "读取中" : `${available.toLocaleString("zh-CN")} 积分`}</strong></div>
            <i className="bi bi-arrow-right" />
            <div className={insufficient ? "danger" : ""}><span>支付后余额</span><strong>{available == null ? "待计算" : insufficient ? "余额不足" : `${remaining.toLocaleString("zh-CN")} 积分`}</strong></div>
          </div>
        </div>
        {activeCost.pricingUnavailable && <p className="ai-cost-confirm-warn"><i className="bi bi-info-circle" />暂时读取不到单价，本次费用以服务端结算为准。</p>}
        {insufficient && <p className="ai-cost-confirm-warn is-danger"><i className="bi bi-exclamation-circle" />钱包余额不足，请充值后再提交任务。</p>}
        <footer className="ai-cost-confirm-footer">
          <label className="ai-cost-confirm-preference"><input type="checkbox" checked={skipEveryTime} onChange={(event) => setSkipEveryTime(event.target.checked)} /><span>不再每次确认</span></label>
          <div className="ai-cost-confirm-actions">
            <button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button>
            <button type="button" className="ai-cost-confirm-btn primary" disabled={insufficient} onClick={() => onConfirm({ skipEveryTime })}>确认</button>
          </div>
        </footer>
    </DialogMotion>
  );
}

export function TextToImageView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  return (
    <TextToImageWorkspace
      user={auth.user}
      authenticated={auth.isAuthenticated}
      onRequireAuth={() => requestAuth({ featureLabel: "文生图" })}
      onUserPatch={(patch) => auth.setUser({ ...auth.user, ...patch })}
    />
  );
}

function TextToImageWorkspace({ user, authenticated, onRequireAuth, onUserPatch }) {
  const rootRef = useRef(null);
  const modelTriggerRef = useRef(null);
  const modelMenuRef = useRef(null);
  const skillTriggerRef = useRef(null);
  const skillPanelRef = useRef(null);
  const promptInputRef = useRef(null);
  const promptViewportRef = useRef(null);
  const promptMoreRef = useRef(null);
  const promptSentinelRef = useRef(null);
  const stageCanvasRef = useRef(null);
  const filmstripRef = useRef(null);
  const lightboxFrameRef = useRef(null);
  const lightboxPanStartRef = useRef(null);
  const lightboxComparePointerRef = useRef(null);
  const isDark = useIsDark();
  const fileInputRef = useRef(null);
  const pendingRef = useRef(null);
  const promptLibraryRequestRef = useRef(0);
  const storedPromptCategoryRef = useRef(readStoredPromptCategory());
  const draft = useMemo(storedDraft, []);
  const [runtime, setRuntime] = useState(storedRuntimeConfig);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(
    String(
      draft.prompt ||
        "极光穿过玻璃城市上空，远处雪山泛着蓝紫色光，精致、干净、适合作为 4K 桌面壁纸",
    ),
  );
  const [modelId, setModelId] = useState(String(draft.selectedPublicModel || ""));
  const [ratio, setRatio] = useState(String(draft.aspectRatio || "1:1"));
  const [resolution, setResolution] = useState(String(draft.resolutionScale || "1K"));
  const [quality, setQuality] = useState(String(draft.imageQuality || "medium"));
  const [count, setCount] = useState(Math.min(4, Math.max(1, Number(draft.imageCount) || 1)));
  const [outputFormat, setOutputFormat] = useState(String(draft.upscaleOutputFormat || "auto"));
  const [moderation, setModeration] = useState(String(draft.moderationLevel || ""));
  const [polish, setPolish] = useState(draft.promptPolishEnabled === true);
  const [translate, setTranslate] = useState(draft.autoTranslateEnabled === true);
  const [transparent, setTransparent] = useState(draft.transparentPngEnabled === true);
  const [autoRemove, setAutoRemove] = useState(draft.autoBackgroundRemovalEnabled === true);
  const [selectedSkillIds, setSelectedSkillIds] = useState(["preserve-4k-upscale"]);
  const [references, setReferences] = useState([]);
  const [openLayer, setOpenLayer] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [modelMenuStyle, setModelMenuStyle] = useState({});
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillPanelStyle, setSkillPanelStyle] = useState({});
  const [mainTab, setMainTab] = useState("images");
  const [promptCategory, setPromptCategory] = useState(initialPromptCategory);
  const [promptItems, setPromptItems] = useState([]);
  const [promptCategories, setPromptCategories] = useState([]);
  const [promptCategoriesLoaded, setPromptCategoriesLoaded] = useState(false);
  const [promptLibraryLoading, setPromptLibraryLoading] = useState(false);
  const [promptLibraryLoadingMore, setPromptLibraryLoadingMore] = useState(false);
  const [promptPage, setPromptPage] = useState(1);
  const [promptHasMore, setPromptHasMore] = useState(false);
  const [promptTotal, setPromptTotal] = useState(0);
  const [promptSort, setPromptSort] = useState("recommended");
  const [promptCategoryMoreOpen, setPromptCategoryMoreOpen] = useState(false);
  const [promptViewportWidth, setPromptViewportWidth] = useState(() => window.innerWidth);
  const [promptMeasuredAspects, setPromptMeasuredAspects] = useState({});
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeGalleryKey, setActiveGalleryKey] = useState("");
  const [activeGroupKey, setActiveGroupKey] = useState("");
  const [featuredImageAspects, setFeaturedImageAspects] = useState({});
  const [unavailableImageKeys, setUnavailableImageKeys] = useState({});
  const [stageCanvasAspect, setStageCanvasAspect] = useState(16 / 9);
  const [cost, setCost] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [lightboxPanning, setLightboxPanning] = useState(false);
  const [lightboxImageLoading, setLightboxImageLoading] = useState(false);
  const [lightboxNaturalSize, setLightboxNaturalSize] = useState({ width: 0, height: 0 });
  const [lightboxCompareEnabled, setLightboxCompareEnabled] = useState(false);
  const [lightboxComparePosition, setLightboxComparePosition] = useState(50);
  const [actionBusyId, setActionBusyId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [regenerateTarget, setRegenerateTarget] = useState(null);
  const [pendingRegenerate, setPendingRegenerate] = useState(null);
  const modelMenuPresence = usePopoverPresence(modelOpen, 240, "model");
  const skillPanelPresence = usePopoverPresence(skillOpen, 150, "skills");
  const controlLayerPresence = usePopoverPresence(
    Boolean(openLayer),
    190,
    openLayer || "frame",
  );
  const promptMorePresence = usePopoverPresence(promptCategoryMoreOpen, 150, "prompt-more");
  const models = useMemo(() => featureModels(runtime), [runtime]);
  const feature = useMemo(() => wallpaperFeature(runtime), [runtime]);
  const backgroundRemovalModels = useMemo(() => {
    const raw = runtime.features?.["ai.imageTools"] || {};
    const config = raw.config && typeof raw.config === "object" ? raw.config : raw;
    return Array.isArray(config.backgroundRemovalModels)
      ? config.backgroundRemovalModels.filter((item) => item?.id)
      : [];
  }, [runtime]);
  const backgroundRemovalModel =
    backgroundRemovalModels.find((item) => item.default === true) ||
    backgroundRemovalModels[0] ||
    null;
  const currentModel = models.find((item) => item.id === modelId) || models[0] || null;
  const hasPricedModels = models.some(
    (model) => resolveModelPointPricing(model).configured,
  );
  const maxReferences = Math.max(0, Number(currentModel?.maxReferenceImages ?? 4));
  const jobs = useTextToImageJobs({ authenticated });
  const isRunning = jobs.tasks.some((task) => ACTIVE_STATUSES.has(task.status));
  const now = useClock(isRunning);

  const updateModelMenuPosition = useCallback(() => {
    const trigger = modelTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const desiredWidth = Math.max(rect.width, hasPricedModels ? 342 : 96);
    const width = Math.min(
      desiredWidth,
      Math.max(96, window.innerWidth - viewportPadding * 2),
    );
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const spaceBelow = Math.max(
      96,
      window.innerHeight - rect.bottom - viewportPadding - 10,
    );
    setModelMenuStyle({
      left: `${Math.round(left)}px`,
      top: `${Math.round(rect.bottom + 8)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.min(360, Math.round(spaceBelow))}px`,
      zIndex: 1300,
    });
  }, [hasPricedModels]);

  useEffect(() => {
    if (!modelOpen) return undefined;
    updateModelMenuPosition();
    const onPointerDown = (event) => {
      if (
        modelTriggerRef.current?.contains(event.target) ||
        modelMenuRef.current?.contains(event.target)
      ) return;
      setModelOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setModelOpen(false);
      modelTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateModelMenuPosition, { passive: true });
    window.addEventListener("scroll", updateModelMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateModelMenuPosition);
      window.removeEventListener("scroll", updateModelMenuPosition, true);
    };
  }, [modelOpen, updateModelMenuPosition]);

  const updateSkillPanelPosition = useCallback(() => {
    const trigger = skillTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, 280),
      Math.min(360, window.innerWidth - 16),
    );
    const gap = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    left = Math.max(8, left);
    const spaceAbove = rect.top - gap - 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const openUp = spaceAbove >= 220 || spaceAbove >= spaceBelow;
    const height = Math.min(420, Math.max(200, openUp ? spaceAbove : spaceBelow));
    setSkillPanelStyle(
      openUp
        ? {
            left: `${Math.round(left)}px`,
            width: `${Math.round(width)}px`,
            bottom: `${Math.round(window.innerHeight - rect.top + gap)}px`,
            top: "auto",
            maxHeight: `${Math.round(height)}px`,
          }
        : {
            left: `${Math.round(left)}px`,
            width: `${Math.round(width)}px`,
            top: `${Math.round(rect.bottom + gap)}px`,
            bottom: "auto",
            maxHeight: `${Math.round(height)}px`,
          },
    );
  }, []);

  useEffect(() => {
    if (!skillOpen) return undefined;
    updateSkillPanelPosition();
    const onPointerDown = (event) => {
      if (
        skillTriggerRef.current?.contains(event.target) ||
        skillPanelRef.current?.contains(event.target)
      ) return;
      setSkillOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setSkillOpen(false);
      skillTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateSkillPanelPosition, { passive: true });
    window.addEventListener("scroll", updateSkillPanelPosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateSkillPanelPosition);
      window.removeEventListener("scroll", updateSkillPanelPosition, true);
    };
  }, [skillOpen, updateSkillPanelPosition]);

  useGSAP(
    () => {
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("settings-no-animations")
      ) {
        return;
      }
      gsap.fromTo(
        rootRef.current?.querySelectorAll("[data-motion]") || [],
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.035,
          ease: "power2.out",
          clearProps: "transform,opacity",
        },
      );
    },
    { scope: rootRef },
  );

  useEffect(() => {
    let disposed = false;
    fetchRuntimeConfig()
      .then((config) => {
        if (!disposed) setRuntime(config);
      })
      .catch(() => null)
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!models.length) return;
    if (!models.some((item) => item.id === modelId)) setModelId(models[0].id);
  }, [modelId, models]);

  const ratioOptions = useMemo(() => {
    const allowed = getModelAspectRatiosForResolution(currentModel || {}, resolution);
    const labels = new Map(T2I_ASPECT_OPTIONS.map((option) => [option.value, option.label]));
    return allowed.map((value) => ({
      value,
      label: labels.get(value) || (value === "auto" ? "Auto 比例" : value),
    }));
  }, [currentModel, resolution]);

  const resolutionOptions = useMemo(() => {
    const supported = normalizeImageModelCapabilities(currentModel || {}).resolutions;
    return T2I_RESOLUTION_OPTIONS.filter((option) => supported.includes(option.value));
  }, [currentModel]);

  const qualityOptions = useMemo(() => {
    const supported = normalizeImageModelCapabilities(currentModel || {}).qualities;
    return T2I_QUALITY_OPTIONS.filter((option) => supported.includes(option.value));
  }, [currentModel]);

  useEffect(() => {
    if (resolutionOptions.length && !resolutionOptions.some((item) => item.value === resolution)) {
      setResolution(resolutionOptions[0].value);
    }
  }, [resolution, resolutionOptions]);

  useEffect(() => {
    if (ratioOptions.length && !ratioOptions.some((item) => item.value === ratio)) {
      setRatio(ratioOptions[0].value);
    }
  }, [ratio, ratioOptions]);

  useEffect(() => {
    if (qualityOptions.length && !qualityOptions.some((item) => item.value === quality)) {
      setQuality(qualityOptions[0].value);
    }
  }, [quality, qualityOptions]);

  useEffect(() => {
    if (currentModel && !currentModel.transparentBackground && transparent) {
      setTransparent(false);
    }
    if (!backgroundRemovalModel && autoRemove) setAutoRemove(false);
    const supportedFormats = currentModel?.outputFormats || [];
    if (!supportedFormats.length) {
      if (outputFormat !== "auto") setOutputFormat("auto");
    } else if (
      outputFormat !== "auto" &&
      !supportedFormats.includes(outputFormat)
    ) {
      setOutputFormat(supportedFormats[0]);
    }
    const supportedModeration = currentModel?.moderationLevels || [];
    if (!supportedModeration.length) {
      if (moderation) setModeration("");
    } else if (moderation && !supportedModeration.includes(moderation)) {
      setModeration(supportedModeration[0]);
    }
  }, [autoRemove, backgroundRemovalModel, currentModel, moderation, outputFormat, transparent]);

  useEffect(() => {
    if (pendingRef.current) return;
    pendingRef.current = { consumed: true, value: takePendingPrompt("t2i") };
    const pending = pendingRef.current.value;
    if (!pending) return;
    const config = pending.config || {};
    setPrompt(composePendingLaunchPrompt(pending));
    if (config.model) setModelId(config.model);
    if (config.ratio) setRatio(config.ratio);
    if (config.resolution) setResolution(String(config.resolution));
    if (config.quality) setQuality(config.quality);
    if (config.count) setCount(Math.min(4, Math.max(1, Number(config.count) || 1)));
    if (Array.isArray(config.skills)) setSelectedSkillIds(config.skills.filter((id) => id !== "none"));
    setReferences(
      (config.referenceImages || []).map((item, index) => {
        if (item.fileKey && item.dataUrl) registerUploadedUrl(item.dataUrl, item.fileKey);
        return {
          id: item.id || `pending-reference-${index}`,
          name: item.name || `参考图 ${index + 1}`,
          preview: item.thumbnailUrl || item.dataUrl,
          url: item.dataUrl,
          file: null,
        };
      }),
    );
  }, []);

  useEffect(() => {
    if (mainTab !== "prompts" || promptCategoriesLoaded) return undefined;
    let disposed = false;
    listPromptCategories({ type: "t2i" })
      .then((items) => {
        if (disposed) return;
        const categories = Array.isArray(items) ? items : [];
        setPromptCategories(categories);
        setPromptCategoriesLoaded(true);
        const validKeys = new Set([
          ...PROMPT_SCOPE_CATEGORIES,
          ...categories.map((item) => String(item?.key || item?.id || "").trim()).filter(Boolean),
        ]);
        const preferred = storedPromptCategoryRef.current === "latest"
          ? "today"
          : storedPromptCategoryRef.current;
        setPromptCategory(validKeys.has(preferred) ? preferred : "all");
      })
      .catch(() => {
        if (!disposed) {
          setPromptCategories([]);
          setPromptCategoriesLoaded(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [mainTab, promptCategoriesLoaded]);

  useEffect(() => {
    setScopedLocalItem(PROMPT_CATEGORY_STORAGE_KEY, promptCategory);
  }, [promptCategory]);

  useEffect(() => {
    if (!promptCategoryMoreOpen) return undefined;
    const onPointerDown = (event) => {
      if (!promptMoreRef.current?.contains(event.target)) setPromptCategoryMoreOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setPromptCategoryMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [promptCategoryMoreOpen]);

  useEffect(() => {
    if (mainTab !== "prompts") return undefined;
    const viewport = promptViewportRef.current;
    if (!viewport) return undefined;
    const updateWidth = () => setPromptViewportWidth(viewport.clientWidth || window.innerWidth);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth, { passive: true });
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [mainTab]);

  useEffect(() => {
    if (mainTab !== "prompts") return;
    const requestId = ++promptLibraryRequestRef.current;
    const scopedCategory = ["today", "my-favorites"].includes(promptCategory)
      ? "all"
      : promptCategory;
    const scope = promptCategory === "my-favorites" ? "favorites" : promptCategory === "today" ? "today" : "";
    setPromptLibraryLoading(true);
    setPromptLibraryLoadingMore(false);
    listPromptLibrary("t2i", {
      pageNumber: 1,
      pageSize: 24,
      category: scopedCategory,
      scope,
      sort: promptCategory === "today" ? "latest" : promptSort,
    })
      .then((response) => {
        if (requestId !== promptLibraryRequestRef.current) return;
        const items = Array.isArray(response?.items)
          ? response.items.filter((item) => item?.id && item?.prompt)
          : [];
        setPromptItems(items);
        setPromptPage(Number(response?.page || 1));
        setPromptTotal(Number(response?.total || items.length));
        setPromptHasMore(response?.hasMore === true);
      })
      .catch(() => {
        if (requestId !== promptLibraryRequestRef.current) return;
        setPromptItems([]);
        setPromptPage(1);
        setPromptTotal(0);
        setPromptHasMore(false);
      })
      .finally(() => {
        if (requestId === promptLibraryRequestRef.current) setPromptLibraryLoading(false);
      });
  }, [mainTab, promptCategory, promptSort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        prompt,
        selectedPublicModel: modelId,
        aspectRatio: ratio,
        resolutionScale: resolution,
        imageQuality: quality,
        imageCount: count,
        upscaleOutputFormat: outputFormat,
        moderationLevel: moderation,
        promptPolishEnabled: polish,
        autoTranslateEnabled: translate,
        transparentPngEnabled: transparent,
        autoBackgroundRemovalEnabled: autoRemove,
      }));
    }, 240);
    return () => window.clearTimeout(timer);
  }, [autoRemove, count, modelId, moderation, outputFormat, polish, prompt, quality, ratio, resolution, translate, transparent]);

  useEffect(() => {
    if (!activeTaskId && jobs.tasks[0]) setActiveTaskId(jobs.tasks[0].id);
  }, [activeTaskId, jobs.tasks]);

  useEffect(() => {
    const canvas = stageCanvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Number(entry?.contentRect?.width || 0);
      const height = Number(entry?.contentRect?.height || 0);
      if (width > 0 && height > 0) setStageCanvasAspect(width / height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mainTab]);

  const addReferenceFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    setReferences((current) => {
      const slots = Math.max(0, maxReferences - current.length);
      const added = files.slice(0, slots).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        file,
        url: "",
        preview: URL.createObjectURL(file),
      }));
      return [...current, ...added];
    });
  }, [maxReferences]);

  const removeReference = (id) => {
    setReferences((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed?.preview?.startsWith("blob:")) URL.revokeObjectURL(removed.preview);
      return current.filter((item) => item.id !== id);
    });
  };

  const buildPayload = useCallback(({ sourceUrls, batchId, batchIndex, batchSize, batchCreatedAt }) => {
    const activeSkills = resolveActiveWallpaperSkills({
      outputType: "image",
      resolutionScale: resolution,
      superResolutionEnabled: feature.superResolutionEnabled !== false,
      selectedSkillIds,
      customSkills: [],
    });
    const skillPrompt = buildWallpaperSkillPrompt(activeSkills);
    const outputSize = resolveT2iOutputSize(ratio, resolution);
    const publicModelKey = currentModel?.id || modelId;
    const kind = sourceUrls.length ? "wallpaper-image-edit" : "wallpaper-image-generation";
    const requestPrompt = [prompt.trim(), skillPrompt].filter(Boolean).join("\n\n");
    const supportedFormats = currentModel?.outputFormats || [];
    const requestedFormat = transparent ? "png" : outputFormat;
    const effectiveOutputFormat = supportedFormats.includes(requestedFormat)
      ? requestedFormat
      : "";
    const supportedModeration = currentModel?.moderationLevels || [];
    const effectiveModeration = supportedModeration.includes(moderation)
      ? moderation
      : "";
    const input = {
      sourceUrl: sourceUrls[0] || "",
      sourceUrls,
      aspectRatio: ratio,
      requestedAspectRatio: ratio,
      autoAspectRatioCandidates:
        ratio === "auto"
          ? getModelAutoAspectRatioCandidates(currentModel || {}, resolution)
          : [],
      outputSize,
      size: outputSize,
      resolutionScale: resolution,
      quality,
      count: 1,
      n: 1,
      batchId,
      batchIndex,
      batchSize,
      batchCreatedAt,
      sourceMode: "text",
      userPrompt: prompt.trim(),
      promptPolishEnabled: polish,
      autoTranslateEnabled: translate,
      transparentPngEnabled: transparent,
      transparentBackground: transparent,
      autoBackgroundRemovalEnabled: autoRemove,
      autoBackgroundRemovalModelKey: autoRemove ? backgroundRemovalModel?.id || "" : "",
      ...(effectiveOutputFormat ? { outputFormat: effectiveOutputFormat } : {}),
      ...(effectiveModeration ? { moderationLevel: effectiveModeration } : {}),
      skills: activeSkills,
      skillIds: activeSkills.map((item) => item.id),
    };
    return {
      kind,
      clientRequestId: crypto.randomUUID(),
      prompt: requestPrompt,
      input,
      params: {
        ...input,
        providerHint: "",
        modelHint: publicModelKey,
        publicModelKey,
        executionMode: "server",
      },
      units: 1,
    };
  }, [autoRemove, backgroundRemovalModel?.id, currentModel, feature.superResolutionEnabled, modelId, moderation, outputFormat, polish, prompt, quality, ratio, resolution, selectedSkillIds, translate, transparent]);

  const submitGeneration = useCallback(async () => {
    if (!prompt.trim()) return;
    try {
      await jobs.createBatch({ count, references, buildPayload });
      setMainTab("images");
    } catch (error) {
      notificationService.error(error?.message || "任务提交失败");
    }
  }, [buildPayload, count, jobs, prompt, references]);

  const requestGeneration = useCallback(async () => {
    if (!authenticated) {
      onRequireAuth?.();
      return;
    }
    if (!prompt.trim() || !currentModel) return;
    if (user?.requireCostConfirm === false || pendingRef.current?.value?.config?.costConfirmed) {
      pendingRef.current = { consumed: true, value: null };
      await submitGeneration();
      return;
    }
    const [walletResult, featurePrice] = await Promise.allSettled([
      getWallet(),
      getFeatureUnitPriceCents("wallpaper"),
    ]);
    const modelPriceConfigured = currentModel.pointPricing?.configured === true;
    const serverPriceAvailable = featurePrice.status === "fulfilled";
    const generationUnit = Math.max(
      0,
      Number(
        modelPriceConfigured
          ? currentModel.creditCost
          : serverPriceAvailable
            ? featurePrice.value
            : feature.creditCost,
      ) || 0,
    );
    const removalUnit = autoRemove
      ? Math.max(0, Number(backgroundRemovalModel?.pricePoints || 0))
      : 0;
    const unit = generationUnit + removalUnit;
    const available = walletResult.status === "fulfilled"
      ? Math.max(0, Number(walletResult.value?.availableCents ?? walletResult.value?.balanceCents ?? 0))
      : null;
    setCost({
      unit,
      count,
      total: unit * count,
      available,
      pricingUnavailable:
        !modelPriceConfigured && !serverPriceAvailable && !Number.isFinite(Number(feature.creditCost)),
    });
  }, [authenticated, autoRemove, backgroundRemovalModel?.pricePoints, count, currentModel, feature.creditCost, onRequireAuth, submitGeneration, user?.requireCostConfirm]);

  useEffect(() => {
    const pending = pendingRef.current?.value;
    if (!loading && currentModel && pending?.config?.autoStart && prompt.trim()) {
      pendingRef.current = { consumed: true, value: { ...pending, config: { ...pending.config, autoStart: false } } };
      void requestGeneration();
    }
  }, [currentModel, loading, prompt, requestGeneration]);

  const galleryItems = useMemo(
    () => buildGalleryItems(jobs.tasks, unavailableImageKeys),
    [jobs.tasks, unavailableImageKeys],
  );
  const filmstripGroups = useMemo(() => groupGalleryItems(galleryItems), [galleryItems]);
  const featuredGroup =
    filmstripGroups.find((group) => group.key === activeGroupKey) ||
    filmstripGroups.find((group) => group.items.some((item) => item.key === activeGalleryKey)) ||
    filmstripGroups.find((group) => group.items.some((item) => item.task.id === activeTaskId)) ||
    filmstripGroups[0] || null;
  const featuredItem =
    featuredGroup?.items.find((item) => item.key === activeGalleryKey) ||
    featuredGroup?.items.find((item) => item.kind === "image") ||
    featuredGroup?.cover || null;
  const activeTask = featuredItem?.task || null;
  const activeOutput = featuredItem?.url || "";
  const stageGridItems = featuredGroup?.items.length > 1 ? featuredGroup.items : [];
  const featuredAspect = stageAspectValue(
    activeTask,
    featuredItem?.key ? featuredImageAspects[featuredItem.key] : "",
  );
  const gridLayout = stageGridLayout(stageGridItems.length, featuredAspect, stageCanvasAspect);
  const activeStageStyle = (() => {
    const style = stageFrameStyle(activeTask, featuredItem?.key ? featuredImageAspects[featuredItem.key] : "");
    if (!gridLayout) return style;
    return {
      ...style,
      aspectRatio: String(gridLayout.ratio),
      "--t2i-stage-fit-width": `${gridLayout.ratio * 100}cqh`,
      "--t2i-stage-max-width": "1600px",
    };
  })();
  const visibleFilmstripGroups = useMemo(() => {
    if (filmstripGroups.length <= 30) return filmstripGroups;
    const focusedIndex = Math.max(0, filmstripGroups.indexOf(featuredGroup));
    const start = Math.min(Math.max(0, focusedIndex - 15), filmstripGroups.length - 30);
    return filmstripGroups.slice(start, start + 30);
  }, [featuredGroup, filmstripGroups]);
  const completed = galleryItems.filter((item) => item.kind === "image");
  const historyItems = useMemo(() => {
    const rows = [...galleryItems];
    const represented = new Set(rows.map((item) => item.task.id));
    jobs.tasks.forEach((task) => {
      if (!isToday(task.createdAt) || represented.has(task.id)) return;
      rows.push({
        key: `history-${task.id}`,
        kind: "placeholder",
        task,
        index: 0,
        title: task.prompt || "图片生成",
      });
    });
    return rows;
  }, [galleryItems, jobs.tasks]);
  const historyColumns = useMemo(() => {
    const columns = [[], [], []];
    historyItems.forEach((item, index) => columns[index % columns.length].push(item));
    return columns;
  }, [historyItems]);
  const localPromptItems = useMemo(() =>
    WALLPAPER_PROMPT_PRESETS.map((preset, index) => ({
      id: `local-t2i-${index}`,
      title: `精选提示词 ${String(index + 1).padStart(2, "0")}`,
      prompt: preset,
      category: "other",
      categoryKey: "other",
      tags: [],
      coverUrl: "",
      local: true,
    })), []);
  const visiblePromptItems = promptItems.length
    ? promptItems
    : promptCategory === "all" && !promptLibraryLoading
      ? localPromptItems
      : [];
  const managedPromptCategories = useMemo(() =>
    promptCategories
      .map((item) => ({
        value: String(item?.key || item?.id || "").trim(),
        label: String(item?.label || "").trim(),
      }))
      .filter((item) => item.value && item.label && !PROMPT_SCOPE_CATEGORIES.has(item.value)),
  [promptCategories]);
  const promptCategoryMoreActive = managedPromptCategories.some((item) => item.value === promptCategory);
  const promptCategoryMoreLabel = managedPromptCategories.find((item) => item.value === promptCategory)?.label || "更多";
  const promptCategoryLabel = useCallback((value) => {
    const key = String(value || "other").trim();
    return [
      ...PROMPT_CATEGORY_PRIMARY.map(([category, label]) => ({ value: category, label })),
      ...managedPromptCategories,
    ].find((item) => item.value === key)?.label || "其他";
  }, [managedPromptCategories]);
  const promptColumnCount = promptViewportWidth <= 640 ? 1 : promptViewportWidth <= 960 ? 2 : 3;
  const promptFeedItems = useMemo(() => visiblePromptItems.map((item) => {
    const key = `prompt-${item.id}`;
    const declaredAspect = Number(item.coverWidth) > 0 && Number(item.coverHeight) > 0
      ? `${Number(item.coverWidth)} / ${Number(item.coverHeight)}`
      : "16 / 10";
    return {
      key,
      item,
      aspect: promptMeasuredAspects[key] || declaredAspect,
    };
  }), [promptMeasuredAspects, visiblePromptItems]);
  useContentReveal({
    rootRef,
    selector: ".t2i-library-view .t2i-collection-card",
    ready: mainTab === "prompts" && !promptLibraryLoading,
    resetKey: `${mainTab}:${promptCategory}:${promptSort}`,
    contentKey: visiblePromptItems.map((item) => item.id).join("|"),
    stateAttribute: "data-t2i-prompts-motion-state",
  });
  useContentReveal({
    rootRef,
    selector: ".t2i-history-card",
    ready: mainTab === "history" && !jobs.historyLoading,
    resetKey: mainTab,
    contentKey: historyItems.map((item) => item.key).join("|"),
    stateAttribute: "data-t2i-history-motion-state",
  });
  useContentReveal({
    rootRef,
    selector: ".t2i-assets-view > *",
    ready: mainTab === "assets",
    resetKey: mainTab,
    contentKey: mainTab,
    stateAttribute: "data-t2i-assets-motion-state",
    maxItems: 4,
  });
  const promptColumns = useMemo(() => {
    return buildBalancedPromptColumns(promptFeedItems, promptColumnCount);
  }, [promptColumnCount, promptFeedItems]);
  const promptEmptyTitle = promptCategory === "today"
    ? "最近24小时暂无新增提示词"
    : promptCategory === "my-favorites"
      ? "还没有收藏提示词"
      : "该分类暂时没有提示词";
  const promptEmptyDescription = promptCategory === "my-favorites"
    ? "点击提示词卡片下方的心形按钮，收藏后可以在这里快速找到。"
    : "选择其他分类继续浏览。";

  const selectPromptCategory = (value) => {
    if (promptViewportRef.current) promptViewportRef.current.scrollTop = 0;
    setPromptCategory(value);
    setPromptCategoryMoreOpen(false);
  };

  const measurePromptLibraryImage = (entry, event) => {
    const width = Number(event.currentTarget?.naturalWidth || event.target?.naturalWidth || 0);
    const height = Number(event.currentTarget?.naturalHeight || event.target?.naturalHeight || 0);
    if (!entry?.key || width <= 0 || height <= 0) return;
    const aspect = `${width} / ${height}`;
    setPromptMeasuredAspects((current) => current[entry.key] === aspect
      ? current
      : { ...current, [entry.key]: aspect });
  };

  const loadMorePrompts = async () => {
    if (promptLibraryLoading || promptLibraryLoadingMore || !promptHasMore) return;
    const requestId = promptLibraryRequestRef.current;
    const nextPage = promptPage + 1;
    const scopedCategory = ["today", "my-favorites"].includes(promptCategory) ? "all" : promptCategory;
    const scope = promptCategory === "my-favorites" ? "favorites" : promptCategory === "today" ? "today" : "";
    setPromptLibraryLoadingMore(true);
    try {
      const response = await listPromptLibrary("t2i", {
        pageNumber: nextPage,
        pageSize: 24,
        category: scopedCategory,
        scope,
        sort: promptCategory === "today" ? "latest" : promptSort,
      });
      if (requestId !== promptLibraryRequestRef.current) return;
      const incoming = Array.isArray(response?.items) ? response.items.filter((item) => item?.id && item?.prompt) : [];
      setPromptItems((current) => [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()]);
      setPromptPage(Number(response?.page || nextPage));
      setPromptTotal(Number(response?.total || promptItems.length + incoming.length));
      setPromptHasMore(response?.hasMore === true);
    } finally {
      if (requestId === promptLibraryRequestRef.current) setPromptLibraryLoadingMore(false);
    }
  };

  useEffect(() => {
    if (mainTab !== "prompts" || !promptHasMore || promptLibraryLoading || promptLibraryLoadingMore) {
      return undefined;
    }
    const sentinel = promptSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMorePrompts();
      },
      {
        root: sentinel.closest(".t2i-panel") || null,
        rootMargin: "520px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mainTab, promptHasMore, promptLibraryLoading, promptLibraryLoadingMore, promptPage, promptCategory, promptSort]);

  const usePromptLibraryEntry = (item) => {
    if (!item?.prompt) return;
    setPrompt(item.prompt);
    promptInputRef.current?.focus();
    if (item.local) return;
    setPromptItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, useCount: Math.max(0, Number(entry.useCount || 0) + 1) } : entry));
    void recordPromptEngagement(item.id, "use").then((result) => {
      setPromptItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...result } : entry));
    }).catch(() => undefined);
  };

  const togglePromptEngagement = async (item, action) => {
    if (!item?.id || item.local) return;
    if (!authenticated) {
      onRequireAuth?.();
      return;
    }
    const field = action === "like" ? "liked" : "favorited";
    const countField = action === "like" ? "likeCount" : "favoriteCount";
    const previous = item[field] === true;
    setPromptItems((current) => current.map((entry) => entry.id === item.id ? {
      ...entry,
      [field]: !previous,
      [countField]: Math.max(0, Number(entry[countField] || 0) + (previous ? -1 : 1)),
    } : entry));
    try {
      const result = await recordPromptEngagement(item.id, action, !previous);
      setPromptItems((current) => current
        .map((entry) => entry.id === item.id ? { ...entry, ...result } : entry)
        .filter((entry) => !(action === "favorite" && previous && promptCategory === "my-favorites" && entry.id === item.id)));
      if (action === "favorite" && previous && promptCategory === "my-favorites") setPromptTotal((current) => Math.max(0, current - 1));
    } catch {
      setPromptItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        [field]: previous,
        [countField]: Math.max(0, Number(entry[countField] || 0) + (previous ? 1 : -1)),
      } : entry));
      notificationService.error("操作失败，请稍后重试");
    }
  };
  const failedOrPausedTasks = jobs.tasks.filter((task) =>
    ["failed", "paused"].includes(task.status),
  );
  const lightboxItems = galleryItems.filter((item) => item.kind === "image");
  const lightboxItem = lightbox
    ? lightboxItems.find((item) => item.key === lightbox.key) || null
    : null;
  const lightboxOriginalUrl = String(
    lightboxItem?.task?.originalOutputUrl || "",
  ).trim();
  const lightboxCanCompare = Boolean(
    lightboxOriginalUrl &&
      lightboxItem?.url &&
      lightboxOriginalUrl !== lightboxItem.url,
  );
  const generationCost = (
    Math.max(
      0,
      Number(
        currentModel?.pointPricing?.configured
          ? currentModel.creditCost
          : feature.creditCost,
      ) || 0,
    ) +
    (autoRemove ? Math.max(0, Number(backgroundRemovalModel?.pricePoints || 0)) : 0)
  ) * count;
  const qualityLabel =
    T2I_QUALITY_OPTIONS.find((item) => item.value === quality)?.label || quality;
  const enhanceSummary = [
    `润色${polish ? "开" : "关"}`,
    `翻译${translate ? "开" : "关"}`,
    `透明${transparent ? "开" : "关"}`,
    backgroundRemovalModel ? `抠图${autoRemove ? "开" : "关"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const toggleSkill = (id) => {
    setSelectedSkillIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const applyTaskToInputs = useCallback((task) => {
    if (!task) return null;
    const nextModel = models.some((model) => model.id === task.publicModelKey)
      ? task.publicModelKey
      : modelId;
    const nextRatio = task.aspectRatio || ratio;
    const nextResolution = task.resolutionScale || resolution;
    const nextQuality = task.imageQuality || quality;
    const nextFormat = task.outputFormat || outputFormat;
    const nextModeration = task.moderationLevel || moderation;
    setPrompt(task.prompt || "");
    setModelId(nextModel);
    setRatio(nextRatio);
    setResolution(nextResolution);
    setQuality(nextQuality);
    setCount(1);
    if (nextFormat) setOutputFormat(nextFormat);
    if (nextModeration) setModeration(nextModeration);
    setPolish(task.promptPolishEnabled === true);
    setTranslate(task.autoTranslateEnabled === true);
    setTransparent(task.transparentPngEnabled === true);
    setAutoRemove(task.autoBackgroundRemovalEnabled === true);
    if (Array.isArray(task.input?.skillIds)) {
      setSelectedSkillIds(task.input.skillIds.filter(Boolean));
    }
    setMainTab("images");
    window.requestAnimationFrame(() => promptInputRef.current?.focus());
    return {
      prompt: task.prompt || "",
      modelId: nextModel,
      ratio: nextRatio,
      resolution: nextResolution,
      quality: nextQuality,
    };
  }, [modelId, models, moderation, outputFormat, quality, ratio, resolution]);

  useEffect(() => {
    if (!pendingRegenerate) return;
    if (
      prompt !== pendingRegenerate.prompt ||
      modelId !== pendingRegenerate.modelId ||
      ratio !== pendingRegenerate.ratio ||
      resolution !== pendingRegenerate.resolution ||
      quality !== pendingRegenerate.quality
    ) return;
    setPendingRegenerate(null);
    void requestGeneration();
  }, [modelId, pendingRegenerate, prompt, quality, ratio, requestGeneration, resolution]);

  const focusGroup = (group, event) => {
    if (!group?.cover) return;
    setActiveTaskId(group.cover.task?.id || "");
    setActiveGalleryKey(group.cover.key);
    setActiveGroupKey(group.key);
    const button = event?.currentTarget;
    const strip = filmstripRef.current;
    if (!(button instanceof HTMLElement) || !(strip instanceof HTMLElement)) return;
    const itemRect = button.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const edgePadding = Math.max(itemRect.width * 2.5, 96);
    if (
      itemRect.left >= stripRect.left + edgePadding &&
      itemRect.right <= stripRect.right - edgePadding
    ) return;
    const left = Math.max(
      0,
      strip.scrollLeft + itemRect.left + itemRect.width / 2 - stripRect.left - stripRect.width / 2,
    );
    strip.scrollTo({
      left,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const stepFeatured = (delta) => {
    if (filmstripGroups.length < 2) return;
    const currentIndex = Math.max(0, filmstripGroups.indexOf(featuredGroup));
    focusGroup(
      filmstripGroups[(currentIndex + delta + filmstripGroups.length) % filmstripGroups.length],
    );
  };

  const resetLightboxView = useCallback(() => {
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
    setLightboxPanning(false);
    setLightboxCompareEnabled(false);
    setLightboxComparePosition(50);
    lightboxPanStartRef.current = null;
    lightboxComparePointerRef.current = null;
  }, []);

  const openLightbox = (item) => {
    if (item?.kind !== "image") return;
    resetLightboxView();
    setLightboxImageLoading(true);
    setLightboxNaturalSize({ width: 0, height: 0 });
    setLightbox({ key: item.key });
  };

  const markImageUnavailable = useCallback((item) => {
    if (!item?.task?.id || !item?.url) return;
    const key = `${item.task.id}::${item.index}::${item.url}`;
    setUnavailableImageKeys((current) => current[key] ? current : { ...current, [key]: true });
  }, []);

  const stepLightbox = useCallback((delta) => {
    if (!lightboxItem || lightboxItems.length < 2) return;
    const index = Math.max(0, lightboxItems.findIndex((item) => item.key === lightboxItem.key));
    setLightbox({
      key: lightboxItems[(index + delta + lightboxItems.length) % lightboxItems.length].key,
    });
    resetLightboxView();
    setLightboxImageLoading(true);
    setLightboxNaturalSize({ width: 0, height: 0 });
  }, [lightboxItem, lightboxItems, resetLightboxView]);

  const clampLightboxPan = useCallback((nextPan, zoom = lightboxZoom) => {
    const frame = lightboxFrameRef.current;
    if (!frame || zoom <= 1) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    const naturalWidth = Number(lightboxNaturalSize.width || rect.width);
    const naturalHeight = Number(lightboxNaturalSize.height || rect.height);
    const fitScale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const maxX = Math.max(0, (naturalWidth * fitScale * zoom - rect.width) / 2);
    const maxY = Math.max(0, (naturalHeight * fitScale * zoom - rect.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
    };
  }, [lightboxNaturalSize, lightboxZoom]);

  const changeLightboxZoom = (value) => {
    const next = Math.min(5, Math.max(1, Math.round(Number(value || 1) * 100) / 100));
    setLightboxZoom(next);
    setLightboxPan((current) => clampLightboxPan(current, next));
  };

  const startLightboxPan = (event) => {
    if (event.button !== 0 || lightboxZoom <= 1) return;
    event.preventDefault();
    lightboxPanStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: lightboxPan.x,
      panY: lightboxPan.y,
    };
    setLightboxPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveLightboxPan = (event) => {
    const start = lightboxPanStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setLightboxPan(
      clampLightboxPan({
        x: start.panX + event.clientX - start.x,
        y: start.panY + event.clientY - start.y,
      }),
    );
  };

  const endLightboxPan = (event) => {
    if (lightboxPanStartRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    lightboxPanStartRef.current = null;
    setLightboxPanning(false);
  };

  const updateComparePosition = (event) => {
    const rect = lightboxFrameRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    setLightboxComparePosition(
      Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)),
    );
  };

  useEffect(() => {
    if (!lightboxItem) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setLightbox(null);
      if (event.key === "ArrowLeft") stepLightbox(-1);
      if (event.key === "ArrowRight") stepLightbox(1);
      if (event.key === "+" || event.key === "=") changeLightboxZoom(lightboxZoom + 0.25);
      if (event.key === "-" || event.key === "_") changeLightboxZoom(lightboxZoom - 0.25);
      if (event.key === "0") resetLightboxView();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxItem, lightboxZoom, resetLightboxView, stepLightbox]);

  const downloadItem = async (item) => {
    if (!item?.url) return;
    try {
      await downloadAuthenticatedMedia(
        item.url,
        downloadFilename(item.task, item.index),
      );
    } catch (error) {
      notificationService.error(error?.message || "图片下载失败");
    }
  };

  const useAsReference = (item) => {
    if (!item?.url) return;
    setReferences((current) => {
      if (current.some((reference) => reference.url === item.url)) return current;
      if (current.length >= maxReferences) {
        notificationService.warning(`当前模型最多支持 ${maxReferences} 张参考图`);
        return current;
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          name: (item.task.prompt || "生成图片").slice(0, 80),
          preview: item.url,
          url: item.url,
          file: null,
        },
      ];
    });
    setMainTab("images");
    notificationService.success("已添加到左侧参考图");
  };

  const requestDelete = (tasksToDelete, label = "这张图片") => {
    const unique = Array.from(
      new Map(tasksToDelete.filter(Boolean).map((task) => [task.id, task])).values(),
    );
    if (unique.length) setDeleteTarget({ tasks: unique, label });
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.tasks?.length || actionBusyId) return;
    setActionBusyId(deleteTarget.tasks[0].id);
    const results = await Promise.allSettled(
      deleteTarget.tasks.map((task) => jobs.removeTask(task)),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    setActionBusyId("");
    setDeleteTarget(null);
    setActiveTaskId("");
    if (failed) notificationService.warning(`已删除 ${results.length - failed} 项，${failed} 项失败`);
  };

  const editTask = (task) => {
    applyTaskToInputs(task);
    notificationService.success("已填回左侧，可修改后重新生成");
  };

  const confirmRegenerate = () => {
    const expected = applyTaskToInputs(regenerateTarget);
    setRegenerateTarget(null);
    if (expected) setPendingRegenerate(expected);
  };

  const confirmGenerationCost = async ({ skipEveryTime = false } = {}) => {
    setCost(null);
    if (skipEveryTime) {
      try {
        const result = await updateProfile({ requireCostConfirm: false });
        onUserPatch?.(result?.user || { requireCostConfirm: false });
      } catch {
        // Preference persistence must not block the confirmed generation.
      }
    }
    await submitGeneration();
  };

  return (
    <div ref={rootRef} className={`t2i-page${isDark ? "" : " is-light"}`} onClick={() => { setSkillOpen(false); setModelOpen(false); setOpenLayer(""); }}>
      <aside className="t2i-sidebar" aria-label="生成设置" onClick={(event) => event.stopPropagation()}>
        <div className="t2i-model" data-motion>
          <div className={`t2i-model-badge${loading ? " is-loading" : ""}`}>
            <span className="t2i-model-icon"><i className="bi bi-stars" /></span>
            {loading ? <span className="t2i-model-copy t2i-model-skeleton"><span /></span> : (
              <div className={`ratio-select t2i-model-select${modelOpen ? " is-open" : ""}${isDark ? "" : " is-light"}`}>
                <button
                  ref={modelTriggerRef}
                  type="button"
                  className="ratio-select__trigger"
                  aria-label="生成模型"
                  aria-haspopup="listbox"
                  aria-expanded={modelOpen}
                  onClick={() => {
                    const next = !modelOpen;
                    if (next) updateModelMenuPosition();
                    setModelOpen(next);
                  }}
                >
                  <span className="ratio-select__value-wrap">
                    <span className="ratio-select__value">{currentModel?.label || "选择生成模型"}</span>
                  </span>
                  <i className="ratio-select__chevron bi bi-chevron-down" />
                </button>
              </div>
            )}
            {modelMenuPresence.mounted && createPortal(
              <div
                ref={modelMenuRef}
                className={`ratio-select__menu is-plain is-compact-menu is-glass-accent opens-down ${transitionClasses("ratio-popover", modelMenuPresence.phase)}${hasPricedModels ? " has-priced-options" : ""}${isDark ? "" : " is-light"}`}
                style={modelMenuStyle}
                role="listbox"
                aria-label="生成模型列表"
              >
                {models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={model.id === modelId}
                    className={`ratio-select__option${model.id === modelId ? " is-selected" : ""}${resolveModelPointPricing(model).configured ? " has-price" : ""}`}
                    onClick={() => {
                      setModelId(model.id);
                      setModelOpen(false);
                    }}
                  >
                    <span className="ratio-select__option-content">
                      <span className="ratio-select__option-label">{model.label}</span>
                    </span>
                    <ModelPointPrice model={model} compact prominent light={!isDark} />
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>
        </div>
        <div className="t2i-side-scroll">
          <div className="t2i-prompt-box" data-motion>
            <textarea
              ref={promptInputRef}
              aria-label="创作描述"
              value={prompt}
              maxLength={8000}
              placeholder="描述主体、场景、光线与风格…"
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files || []);
                if (files.some((file) => file.type.startsWith("image/"))) addReferenceFiles(files);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void requestGeneration();
                }
              }}
            />
            <div className="t2i-prompt-foot">
              <div className="t2i-prompt-refs" aria-label="参考图片" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addReferenceFiles(event.dataTransfer.files); }}>
                {references.map((item) => (
                  <figure key={item.id} className="t2i-prompt-ref">
                    <img src={item.preview} alt={item.name} />
                    <button type="button" title="移除参考图" aria-label="移除参考图" onClick={() => removeReference(item.id)}><i className="bi bi-x-lg" /></button>
                  </figure>
                ))}
                {references.length < maxReferences && (
                  <button type="button" className="t2i-prompt-ref-add" aria-label="添加参考图" onClick={() => fileInputRef.current?.click()}><i className="bi bi-plus-lg" /></button>
                )}
                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { addReferenceFiles(event.target.files); event.target.value = ""; }} />
              </div>
              <div className="t2i-prompt-tools"><button type="button" className="t2i-icon-btn" title="清空提示词" onClick={() => setPrompt("")}><i className="bi bi-trash" /></button></div>
              <div className="t2i-skill-tools">
                <button ref={skillTriggerRef} type="button" className={`t2i-skill-trigger${skillOpen ? " is-open" : ""}${selectedSkillIds.length ? " has-items" : ""}`} aria-expanded={skillOpen} onClick={(event) => { event.stopPropagation(); const next = !skillOpen; if (next) updateSkillPanelPosition(); setSkillOpen(next); }}>
                  <i className="bi bi-lightning-charge" /><span>Skills</span><em>{selectedSkillIds.length}</em><i className="bi bi-chevron-down" />
                </button>
              </div>
            </div>
          </div>
          <div className="t2i-control-layers" data-motion>
            <div className="t2i-control-layer-bar" aria-label="生成参数分类">
              {[
                ["frame", "bi-aspect-ratio", "画面", `${qualityLabel} · ${ratio} · ${resolution} · ${count}张`],
                ["output", "bi-file-earmark-image", "输出", `${outputFormat === "auto" ? "模型内置" : outputFormat.toUpperCase()} · ${moderation ? (moderation === "auto" ? "自动审核" : "低限制") : "模型内置"}`],
                ["enhance", "bi-stars", "增强", enhanceSummary],
              ].map(([id, icon, title, summary]) => (
                <button key={id} type="button" className={openLayer === id ? "is-open" : ""} aria-expanded={openLayer === id} onClick={() => setOpenLayer((value) => value === id ? "" : id)}>
                  <i className={`bi ${icon}`} /><span className="t2i-layer-trigger-copy"><strong>{title}</strong><small>{summary}</small></span><i className="bi bi-chevron-down" />
                </button>
              ))}
            </div>
            {controlLayerPresence.mounted && controlLayerPresence.key === "frame" && (
              <section className={`t2i-control-layer-panel is-frame ${transitionClasses("t2i-control-popover", controlLayerPresence.phase)}`} aria-label="画面参数">
                <CompactSegments label="质量" value={quality} options={qualityOptions} onChange={setQuality} />
                <div className="t2i-compact-field is-ratio-field"><span>比例</span><div className="t2i-compact-ratio-grid">
                  {ratioOptions.map((option) => <button key={option.value} type="button" className={ratio === option.value ? "is-selected" : ""} aria-pressed={ratio === option.value} title={option.label} onClick={() => setRatio(option.value)}><i className={compactRatioClass(option.value)} style={ratioStyle(option.value)} /><small>{option.value === "auto" ? "自动" : option.value}</small></button>)}
                </div></div>
                <div className="t2i-compact-field-row">
                  <CompactSegments label="分辨率" value={resolution} options={resolutionOptions} onChange={setResolution} />
                  <CompactSegments label="张数" value={count} options={T2I_COUNT_OPTIONS} onChange={(value) => setCount(Number(value))} />
                </div>
              </section>
            )}
            {controlLayerPresence.mounted && controlLayerPresence.key === "output" && (
              <section className={`t2i-control-layer-panel is-output ${transitionClasses("t2i-control-popover", controlLayerPresence.phase)}`} aria-label="输出参数">
                <CompactSegments label="格式" value={outputFormat} options={T2I_OUTPUT_FORMAT_OPTIONS.filter((item) => item.value === "auto" || currentModel?.outputFormats?.includes(item.value))} onChange={setOutputFormat} />
                <CompactSegments label="内容审核" value={moderation} options={T2I_MODERATION_OPTIONS.filter((item) => item.value === "" || currentModel?.moderationLevels?.includes(item.value))} onChange={setModeration} />
              </section>
            )}
            {controlLayerPresence.mounted && controlLayerPresence.key === "enhance" && (
              <section className={`t2i-control-layer-panel is-enhance ${transitionClasses("t2i-control-popover", controlLayerPresence.phase)}`} aria-label="增强参数">
                <div className="t2i-prompt-enhancers">
                  <Toggle label="润色" icon="bi-stars" value={polish} onChange={setPolish} />
                  <Toggle label="翻译" icon="bi-translate" value={translate} onChange={setTranslate} />
                  <Toggle label="透明" icon="bi-transparency" value={transparent} disabled={!currentModel?.transparentBackground} onChange={(next) => { setTransparent(next); if (next) setAutoRemove(false); }} />
                  {backgroundRemovalModel && <Toggle label="生成后抠图" icon="bi-person-bounding-box" value={autoRemove} onChange={(next) => { setAutoRemove(next); if (next) setTransparent(false); }} />}
                </div>
              </section>
            )}
          </div>
        </div>
        <button type="button" className="t2i-generate" data-motion disabled={authenticated && (!prompt.trim() || !currentModel || jobs.submitting)} onClick={() => void requestGeneration()}>
          <span>{jobs.submitting ? "正在提交" : isRunning ? "再生成一张" : "立即生成"}</span>
          {currentModel && <small>{generationCost > 0 ? `${generationCost.toLocaleString("zh-CN")} 积分` : "免费"}</small>}
          <i className={`bi ${jobs.submitting ? "bi-arrow-repeat spin" : isRunning ? "bi-plus-lg" : "bi-stars"}`} />
        </button>
        {skillPanelPresence.mounted && createPortal(
          <section ref={skillPanelRef} className={`t2i-skill-panel is-floating ${transitionClasses("t2i-skill-popover", skillPanelPresence.phase)}${isDark ? "" : " is-light"}`} style={skillPanelStyle} aria-label="生成 Skills" onClick={(event) => event.stopPropagation()}>
            <header><div><strong>生成 Skills</strong><small>仅将已选择的 Skill 注入当前任务</small></div><button type="button" aria-label="关闭 Skill" title="关闭 Skills" onClick={() => setSkillOpen(false)}><i className="bi bi-x-lg" /></button></header>
            <div className="t2i-skill-list" role="listbox" aria-label="Skills" aria-multiselectable="true">
              {WALLPAPER_SKILL_OPTIONS.map((skill) => (
                <label key={skill.id} className="t2i-skill-item" role="option" aria-selected={selectedSkillIds.includes(skill.id)}>
                  <input type="checkbox" checked={selectedSkillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} />
                  <span className="t2i-skill-item-copy"><strong>{skill.name}</strong><small>{skill.description}</small></span>
                </label>
              ))}
            </div>
          </section>,
          document.body,
        )}
      </aside>

      <main className="t2i-main" aria-label="创作结果">
        <header className="t2i-main-head" data-motion>
          <div className="t2i-center-tabs" role="tablist" aria-label="主视图切换">
            {[['prompts', '提示词库'], ['images', '图片生成'], ['history', '历史记录'], ['assets', '我的资产']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mainTab === id} className={mainTab === id ? "is-active" : ""} onClick={() => setMainTab(id)}>{label}</button>
            ))}
          </div>
          <div className="t2i-main-status">
            {mainTab === "history" && failedOrPausedTasks.length > 0 && (
              <button
                type="button"
                className="t2i-clear-failed"
                onClick={() => requestDelete(failedOrPausedTasks, "全部失败/暂停任务")}
              >
                <i className="bi bi-trash3" />清除失败/暂停
                <em>{failedOrPausedTasks.length}</em>
              </button>
            )}
            <span>
              {loading
                ? "数据加载中"
                : isRunning
                  ? `任务处理中 · ${jobs.tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length} 个任务`
                  : mainTab === "images"
                    ? completed.length ? `今日 ${completed.length} 张` : "今日暂无作品"
                    : mainTab === "history"
                      ? historyItems.length ? `今日 ${historyItems.length} 条` : "今日暂无记录"
                      : mainTab === "prompts"
                        ? `${Math.max(promptTotal, visiblePromptItems.length)} 条提示词`
                        : "暂无资产"}
            </span>
          </div>
        </header>
        {mainTab === "images" && (
          <section className="t2i-panel t2i-panel--stage">
            <div className="t2i-stage-workspace" data-motion>
              {loading || jobs.historyLoading ? <StageSkeleton aspect={ratio} /> : !featuredItem ? (
                <div className="t2i-empty"><div className="t2i-empty-icon"><i className="bi bi-image" /></div><strong>今日还没有作品</strong><span>点左侧「立即生成」，当天作品会显示在这里和底部栏。</span></div>
              ) : (
                <div className="t2i-stage">
                  <div ref={stageCanvasRef} className="t2i-stage-canvas">
                    <div className="t2i-stage-frame" style={activeStageStyle}>
                      {stageGridItems.length > 0 ? (
                        <div
                          className={`t2i-stage-grid${gridLayout?.collage ? " is-collage" : ""}`}
                          style={{ "--t2i-grid-cols": gridLayout?.columns || 2 }}
                          aria-label="同批次生成结果"
                        >
                          {stageGridItems.map((item) => (
                            <div key={item.key} className={`t2i-stage-cell${item.kind === "pending" ? " is-pending" : ""}${showsTransparentCanvas(item.task) ? " is-transparent-output" : ""}`}>
                              {item.kind === "pending" ? (
                                <PendingStage task={item.task} now={now} batchIndex={item.batchIndex} />
                              ) : (
                                <>
                                  <button type="button" className="t2i-stage-cell-media" onClick={() => openLightbox(item)}>
                                    <ProgressiveAuthenticatedImage
                                      src={item.url}
                                      previewSrc={item.thumbnailUrl}
                                      alt=""
                                      loading="eager"
                                      loadOriginal
                                      hideStatus
                                      onError={() => markImageUnavailable(item)}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className="t2i-stage-cell-delete"
                                    aria-label="删除这张图片"
                                    title="删除这张图片"
                                    onClick={() => requestDelete([item.task])}
                                  >
                                    <span className="t2i-icon-delete" />
                                  </button>
                                  <ImageQuickActions
                                    item={item}
                                    cell
                                    onEdit={() => editTask(item.task)}
                                    onRegenerate={() => setRegenerateTarget(item.task)}
                                    onDownload={() => void downloadItem(item)}
                                    onReference={() => useAsReference(item)}
                                  />
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : featuredItem.kind === "image" ? (
                        <>
                          <button type="button" className={`t2i-stage-media${showsTransparentCanvas(activeTask) ? " is-transparent-output" : ""}`} onClick={() => openLightbox(featuredItem)}>
                            <ProgressiveAuthenticatedImage
                              src={activeOutput}
                              previewSrc={featuredItem.thumbnailUrl}
                              alt={activeTask.prompt}
                              loading="eager"
                              loadOriginal
                              hideStatus
                              onLoad={(event) => {
                                const width = Number(event.currentTarget?.naturalWidth || 0);
                                const height = Number(event.currentTarget?.naturalHeight || 0);
                                if (!featuredItem?.key || width <= 0 || height <= 0) return;
                                const nextAspect = `${width} / ${height}`;
                                setFeaturedImageAspects((current) =>
                                  current[featuredItem.key] === nextAspect
                                    ? current
                                    : { ...current, [featuredItem.key]: nextAspect },
                                );
                              }}
                              onError={() => markImageUnavailable(featuredItem)}
                            />
                          </button>
                          <ImageQuickActions
                            item={featuredItem}
                            onEdit={() => editTask(activeTask)}
                            onRegenerate={() => setRegenerateTarget(activeTask)}
                            onDownload={() => void downloadItem(featuredItem)}
                            onReference={() => useAsReference(featuredItem)}
                          />
                        </>
                      ) : (
                        <div className="t2i-stage-media is-skeleton" role="status">
                          <div className="t2i-skeleton-shine" />
                          <PendingStage task={activeTask} now={now} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="t2i-stage-bar">
                    <div className="t2i-stage-copy">
                      <strong title={activeTask.prompt}>{activeTask.prompt || "图片生成"}</strong>
                      <small>{featuredItem.kind !== "image" ? `${statusLabel(activeTask)}${elapsedLabel(activeTask, now) ? ` · ${elapsedLabel(activeTask, now)}` : ""}` : taskMeta(activeTask, now)}</small>
                    </div>
                    <div className="t2i-image-actions">
                      {featuredItem.kind === "image" ? (
                        <>
                          <button type="button" className="is-icon" aria-label="重新生成" title="重新生成" onClick={() => setRegenerateTarget(activeTask)}><span className="t2i-icon-regenerate" /></button>
                          <button type="button" className="is-danger is-icon" aria-label="删除" title="删除" onClick={() => requestDelete(featuredGroup.items.map((item) => item.task), featuredGroup.items.length > 1 ? "整组图片" : "这张图片")}><span className="t2i-icon-delete" /></button>
                        </>
                      ) : ACTIVE_STATUSES.has(activeTask.status) ? (
                        <button type="button" aria-label="取消" disabled={actionBusyId === activeTask.id} onClick={() => void jobs.cancelTask(activeTask)}>取消生成</button>
                      ) : (
                        <button type="button" className="is-primary" disabled={!prompt.trim()} onClick={() => void requestGeneration()}>生成下一张</button>
                      )}
                      {filmstripGroups.length > 1 && <button type="button" className="t2i-nav-btn" data-click-guard="off" onClick={() => stepFeatured(-1)}>上一张</button>}
                      {filmstripGroups.length > 1 && <button type="button" className="t2i-nav-btn" data-click-guard="off" onClick={() => stepFeatured(1)}>下一张</button>}
                    </div>
                  </div>
                  {filmstripGroups.length > 1 && (
                    <div ref={filmstripRef} className="t2i-filmstrip" aria-label="作品列表">
                      {visibleFilmstripGroups.map((group, groupIndex) => (
                        <button
                          key={group.key}
                          type="button"
                          data-click-guard="off"
                          className={`t2i-film-item${group.key === featuredGroup.key ? " is-on" : ""}${group.kind !== "image" ? " is-pending" : ""}`}
                          title={group.kind === "pending" ? "任务处理中" : group.kind === "mixed" ? `已完成 ${group.items.length - group.pendingCount}/${group.items.length} 张` : group.items.length > 1 ? "单击查看这组图片" : "单击查看，双击设为参考图"}
                          onClick={(event) => focusGroup(group, event)}
                          onDoubleClick={() => group.items.length === 1 && group.cover.kind === "image" && useAsReference(group.cover)}
                        >
                          {group.kind === "pending" ? (
                            <span className="t2i-film-pending"><span className="t2i-film-pending-spinner" /><em>{elapsedLabel(group.cover.task, now)}</em></span>
                          ) : (
                            <AuthenticatedImage
                              src={group.cover.thumbnailUrl || group.cover.url}
                              alt=""
                              loading={groupIndex < 12 ? "eager" : "lazy"}
                              rootMargin="180px 240px"
                              maxDimension={280}
                              onError={() => markImageUnavailable(group.cover)}
                            />
                          )}
                          {group.items.length > 1 && <span className="t2i-film-batch-index">{group.items.length} 张</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
        {mainTab === "history" && (
          <section className="t2i-panel t2i-panel--history">
            {jobs.historyLoading ? <HistorySkeleton /> : historyItems.length === 0 ? (
              <div className="t2i-empty"><div className="t2i-empty-icon"><i className="bi bi-clock-history" /></div><strong>今日还没有历史记录</strong><span>历史记录仅展示当天作品，提交生成后会显示在这里。</span></div>
            ) : (
              <div className="t2i-masonry-wrap">
                <div className="t2i-masonry" style={{ "--t2i-masonry-cols": 3 }}>
                  {historyColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className="t2i-masonry-col">
                      {column.map((item) => (
                        <article key={item.key} className={`t2i-masonry-card t2i-history-card${item.task.id === activeTaskId ? " is-active" : ""}`} data-status={item.task.status}>
                          {item.kind === "image" ? (
                            <button type="button" className="t2i-masonry-cover" style={ratioStyle(item.task.aspectRatio)} onClick={() => { setActiveTaskId(item.task.id); openLightbox(item); }}>
                              <AuthenticatedImage src={item.url} alt="" loading="lazy" />
                              {item.total > 1 && <span className="t2i-history-batch-index">{Number(item.batchIndex || 0) + 1}/{item.total}</span>}
                              <span className="t2i-history-image-overlay"><span className="t2i-history-image-prompt">{item.task.prompt}</span><span className="t2i-history-image-specs"><span><i className="bi bi-aspect-ratio" />{item.task.actualOutputSize || item.task.outputSize || item.task.aspectRatio}</span><span><i className="bi bi-clock" />{elapsedLabel(item.task, now) || statusLabel(item.task)}</span></span></span>
                            </button>
                          ) : (
                            <div className="t2i-masonry-cover t2i-masonry-placeholder" style={ratioStyle(item.task.aspectRatio)} data-status={item.task.status}><i className={`bi ${ACTIVE_STATUSES.has(item.task.status) ? "bi-arrow-repeat spin" : item.task.status === "failed" ? "bi-exclamation-triangle" : "bi-image"}`} /><span>{statusLabel(item.task)}</span></div>
                          )}
                          {item.kind !== "image" && <div className="t2i-masonry-body"><small className="t2i-history-error">{item.task.error}</small></div>}
                          <footer className="t2i-entry-actions t2i-history-actions">
                            {item.kind === "image" && <button type="button" aria-label="设为参考图" title="设为参考图" onClick={() => useAsReference(item)}><span className="t2i-icon-reference" /></button>}
                            <button type="button" aria-label="编辑任务" title="编辑" onClick={() => editTask(item.task)}><span className="t2i-icon-edit-image" /></button>
                            <button type="button" aria-label="重新生成" title="重新生成" onClick={() => setRegenerateTarget(item.task)}><span className="t2i-icon-regenerate" /></button>
                            {ACTIVE_STATUSES.has(item.task.status) && <button type="button" aria-label="取消任务" title="取消" onClick={() => void jobs.cancelTask(item.task)}><i className="bi bi-stop-circle" /></button>}
                            <button type="button" className="is-danger" aria-label="删除任务" title="删除" onClick={() => requestDelete([item.task])}><span className="t2i-icon-delete" /></button>
                          </footer>
                        </article>
                      ))}
                    </div>
                  ))}
                </div>
                {jobs.historyHasMore ? <button type="button" className="t2i-feed-more" onClick={jobs.loadMoreHistory}>加载更多</button> : <p className="t2i-feed-end">今日记录已全部加载</p>}
              </div>
            )}
          </section>
        )}
        {mainTab === "prompts" && (
          <section ref={promptViewportRef} className="t2i-panel t2i-library-view">
            <div className="t2i-masonry-wrap">
              <div className="t2i-library-toolbar">
                <nav className="t2i-library-categories" aria-label="提示词分类">
                  {PROMPT_CATEGORY_PRIMARY.map(([value, label]) => <button key={value} type="button" className={promptCategory === value ? "is-active" : ""} onClick={() => selectPromptCategory(value)}>{label}</button>)}
                </nav>
                <div ref={promptMoreRef} className="t2i-library-more">
                  <button type="button" className={`t2i-library-more-trigger${promptCategoryMoreActive ? " is-active" : ""}${promptCategoryMoreOpen ? " is-open" : ""}`} aria-expanded={promptCategoryMoreOpen} aria-haspopup="listbox" onClick={() => setPromptCategoryMoreOpen((value) => !value)}><span>{promptCategoryMoreLabel}</span><i className="bi bi-chevron-down" /></button>
                  {promptMorePresence.mounted && <div className={`t2i-library-more-menu ${transitionClasses("t2i-library-more", promptMorePresence.phase)}`} role="listbox" aria-label="更多分类">{managedPromptCategories.map((category) => <button key={category.value} type="button" role="option" aria-selected={promptCategory === category.value} className={promptCategory === category.value ? "is-active" : ""} onClick={() => selectPromptCategory(category.value)}>{category.label}</button>)}</div>}
                </div>
                {promptCategory !== "today" && <label className="t2i-library-sort"><i className="bi bi-sort-down" /><select value={promptSort} aria-label="提示词排序" onChange={(event) => setPromptSort(event.target.value)}><option value="recommended">智能推荐</option><option value="favorites">收藏最多</option><option value="likes">点赞最多</option><option value="usage">使用最多</option></select></label>}
              </div>
              {promptLibraryLoading && !visiblePromptItems.length ? <div className="t2i-history-skeleton" aria-label="提示词库加载中">{[0, 1, 2].map((column) => <div key={column} className="t2i-history-skeleton-col">{[0, 1, 2].map((row) => <article key={row} className="t2i-history-skeleton-card"><div className="t2i-skeleton-shine" /></article>)}</div>)}</div> : !visiblePromptItems.length ? <div className="t2i-empty t2i-collection-empty"><div className="t2i-empty-icon"><i className="bi bi-filter" /></div><strong>{promptEmptyTitle}</strong><span>{promptEmptyDescription}</span></div> : <div className="t2i-masonry" style={{ "--t2i-masonry-cols": promptColumnCount }}>
                {promptColumns.map((column, columnIndex) => <div key={columnIndex} className="t2i-masonry-col">{column.map((entry) => {
                  const { item } = entry;
                  return (
                  <article key={entry.key} className="t2i-masonry-card t2i-collection-card">
                    <button type="button" className={`t2i-masonry-cover${item.coverUrl || item.imageUrl ? "" : " t2i-masonry-placeholder"}`} style={{ aspectRatio: entry.aspect }} onClick={() => usePromptLibraryEntry(item)}>{item.coverUrl || item.imageUrl ? <AuthenticatedImage src={item.coverUrl || item.imageUrl} alt={item.title || item.label || "提示词封面"} loading="lazy" maxDimension={720} onLoad={(event) => measurePromptLibraryImage(entry, event)} /> : <span className="t2i-collection-placeholder"><i className="bi bi-stars" /><small>点击使用提示词</small></span>}<span className="t2i-history-image-overlay"><span className="t2i-history-image-prompt">{item.prompt}</span><span className="t2i-history-image-specs"><span><i className="bi bi-grid" />{promptCategoryLabel(item.categoryKey || item.category)}</span>{item.tags?.length > 0 && <span><i className="bi bi-tags" />{item.tags.slice(0, 2).join(" · ")}</span>}</span></span></button>
                    <div className="t2i-masonry-body"><header className="t2i-history-meta"><strong>{item.title || item.label}</strong><small>{promptCategoryLabel(item.categoryKey || item.category)} · 使用 {item.useCount || 0} 次</small></header></div>
                    <footer className="t2i-entry-actions t2i-prompt-card-actions">
                      <button
                        type="button"
                        className={`t2i-prompt-card-actions__metric${item.liked ? " is-active" : ""}`}
                        disabled={item.local}
                        aria-label={item.liked ? "取消点赞" : "点赞"}
                        title={item.liked ? "取消点赞" : "点赞"}
                        onClick={() => void togglePromptEngagement(item, "like")}
                      >
                        <i className={`bi ${item.liked ? "bi-hand-thumbs-up-fill" : "bi-hand-thumbs-up"}`} aria-hidden="true" />
                        <span>{item.likeCount || 0}</span>
                      </button>
                      <button
                        type="button"
                        className={`t2i-prompt-card-actions__metric${item.favorited ? " is-active" : ""}`}
                        disabled={item.local}
                        aria-label={item.favorited ? "取消收藏" : "收藏"}
                        title={item.favorited ? "取消收藏" : "收藏"}
                        onClick={() => void togglePromptEngagement(item, "favorite")}
                      >
                        <i className={`bi ${item.favorited ? "bi-heart-fill" : "bi-heart"}`} aria-hidden="true" />
                        <span>{item.favoriteCount || 0}</span>
                      </button>
                      <button
                        type="button"
                        className="t2i-prompt-card-actions__use"
                        onClick={() => usePromptLibraryEntry(item)}
                      >
                        <i className="bi bi-stars" aria-hidden="true" />
                        <span>使用提示词</span>
                        <i className="bi bi-arrow-up-right" aria-hidden="true" />
                      </button>
                    </footer>
                  </article>
                  );
                })}</div>)}
              </div>}
              {promptHasMore && <div ref={promptSentinelRef} className="t2i-masonry-sentinel" aria-hidden="true" />}
              {promptLibraryLoadingMore ? <p className="t2i-feed-loading"><i className="bi bi-arrow-repeat spin" />正在加载更多提示词…</p> : promptHasMore ? <button type="button" className="t2i-feed-more" onClick={() => void loadMorePrompts()}>加载更多</button> : visiblePromptItems.length > 0 && <p className="t2i-feed-end">没有更多数据了</p>}
            </div>
          </section>
        )}
        {mainTab === "assets" && <section className="t2i-panel t2i-assets-view"><div className="t2i-empty"><div className="t2i-empty-icon"><i className="bi bi-collection" /></div><strong>还没有已发布资产</strong><span>从历史记录发布作品后，投稿与审核状态会集中显示在这里。</span></div></section>}
      </main>
      <CostConfirmDialog
        cost={cost}
        light={!isDark}
        onCancel={() => setCost(null)}
        onConfirm={(options) => void confirmGenerationCost(options)}
      />
      <ActionConfirmDialog
        open={Boolean(deleteTarget)}
        heading={`删除${deleteTarget?.label || "这张图片"}？`}
        description={deleteTarget?.tasks?.length > 1 ? `将删除 ${deleteTarget.tasks.length} 条云端任务记录，删除后无法恢复。` : "将同时删除云端任务记录，删除后无法恢复。"}
        confirmLabel="确认删除"
        busy={Boolean(actionBusyId)}
        tone="danger"
        light={!isDark}
        onCancel={() => !actionBusyId && setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
      <ActionConfirmDialog
        open={Boolean(regenerateTarget)}
        heading="重新生成这张图片？"
        description="确认后会把原任务参数填回左侧，并进入正常的积分确认与生成流程。"
        confirmLabel="重新生成"
        tone="accent"
        light={!isDark}
        onCancel={() => setRegenerateTarget(null)}
        onConfirm={confirmRegenerate}
      />
      {lightboxItem && createPortal(
        <div className="t2i-lightbox is-plain-open" role="dialog" aria-modal="true" aria-label="全屏预览" onMouseDown={(event) => event.target === event.currentTarget && setLightbox(null)}>
          <div className="t2i-lightbox-stage">
            <div
              ref={lightboxFrameRef}
              className={`t2i-lightbox-frame${lightboxZoom > 1 ? " is-zoomed" : ""}${lightboxPanning ? " is-panning" : ""}`}
              onWheel={(event) => { event.preventDefault(); changeLightboxZoom(lightboxZoom + (event.deltaY < 0 ? 0.25 : -0.25)); }}
              onDoubleClick={() => changeLightboxZoom(lightboxZoom === 1 ? 2 : 1)}
              onPointerDown={startLightboxPan}
              onPointerMove={moveLightboxPan}
              onPointerUp={endLightboxPan}
              onPointerCancel={endLightboxPan}
            >
              <div className="t2i-lightbox-image-layer" style={{ transform: `translate3d(${lightboxPan.x}px, ${lightboxPan.y}px, 0) scale(${lightboxZoom})` }}>
                <AuthenticatedImage src={lightboxItem.url} alt={lightboxItem.task.prompt || "图片预览"} loading="eager" onLoad={(event) => { setLightboxImageLoading(false); setLightboxNaturalSize({ width: event.target.naturalWidth, height: event.target.naturalHeight }); }} onError={() => setLightboxImageLoading(false)} />
              </div>
              {lightboxCompareEnabled && lightboxCanCompare && (
                <>
                  <div className="t2i-lightbox-original-clip" style={{ clipPath: `inset(0 ${100 - lightboxComparePosition}% 0 0)` }}>
                    <div className="t2i-lightbox-image-layer" style={{ transform: `translate3d(${lightboxPan.x}px, ${lightboxPan.y}px, 0) scale(${lightboxZoom})` }}><AuthenticatedImage src={lightboxOriginalUrl} alt="" loading="eager" /></div>
                  </div>
                  <span className="t2i-lightbox-compare-badge is-original">{lightboxItem.task.originalOutputSize ? `原图 ${lightboxItem.task.originalOutputSize.replace(/x/i, "×")}` : "原图"}</span>
                  <span className="t2i-lightbox-compare-badge is-processed">{lightboxItem.task.actualOutputSize || lightboxItem.task.outputSize ? `处理后 ${(lightboxItem.task.actualOutputSize || lightboxItem.task.outputSize).replace(/x/i, "×")}` : "处理后"}</span>
                  <button
                    type="button"
                    className="t2i-lightbox-compare-divider"
                    style={{ left: `${lightboxComparePosition}%` }}
                    role="slider"
                    aria-label="拖动比较原图与处理后图片"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={Math.round(lightboxComparePosition)}
                    onPointerDown={(event) => { event.stopPropagation(); lightboxComparePointerRef.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); updateComparePosition(event); }}
                    onPointerMove={(event) => lightboxComparePointerRef.current === event.pointerId && updateComparePosition(event)}
                    onPointerUp={(event) => { event.currentTarget.releasePointerCapture?.(event.pointerId); lightboxComparePointerRef.current = null; }}
                    onKeyDown={(event) => { if (event.key === "ArrowLeft") setLightboxComparePosition((value) => Math.max(0, value - 2)); if (event.key === "ArrowRight") setLightboxComparePosition((value) => Math.min(100, value + 2)); }}
                  ><i className="bi bi-arrows" /></button>
                </>
              )}
            </div>
          </div>
          {lightboxItems.length > 1 && <><button type="button" className="t2i-lightbox-hotzone is-prev" aria-label="上一张" title="上一张" data-click-guard="off" onClick={() => stepLightbox(-1)}><i className="bi bi-chevron-left" /></button><button type="button" className="t2i-lightbox-hotzone is-next" aria-label="下一张" title="下一张" data-click-guard="off" onClick={() => stepLightbox(1)}><i className="bi bi-chevron-right" /></button></>}
          <div className={`t2i-lightbox-load-chip${lightboxImageLoading ? " is-visible" : ""}`} aria-hidden="true"><span className="t2i-lightbox-load-chip-dot" /><span>图片加载中</span></div>
          <div className="t2i-lightbox-controls" aria-label="预览操作">
            <div className="t2i-lightbox-controls-info"><strong className="t2i-lightbox-controls-title" title={lightboxItem.task.prompt}>{lightboxItem.task.prompt || "图片预览"}</strong><span className="t2i-lightbox-controls-count">{lightboxItems.findIndex((item) => item.key === lightboxItem.key) + 1} / {lightboxItems.length}</span><span className="t2i-lightbox-controls-size">{lightboxItem.task.actualOutputSize || lightboxItem.task.outputSize ? `处理后 ${(lightboxItem.task.actualOutputSize || lightboxItem.task.outputSize).replace(/x/i, "×")}` : "处理后"}</span></div>
            {lightboxItems.length > 1 && <div className="t2i-lightbox-controls-nav" data-click-guard="off"><button type="button" aria-label="上一张" title="上一张" onClick={() => stepLightbox(-1)}><i className="bi bi-chevron-left" /></button><button type="button" aria-label="下一张" title="下一张" onClick={() => stepLightbox(1)}><i className="bi bi-chevron-right" /></button></div>}
            <div className="t2i-lightbox-controls-tools" data-click-guard="off">
              <button type="button" disabled={lightboxZoom <= 1} aria-label="缩小图片" onClick={() => changeLightboxZoom(lightboxZoom - 0.25)}><i className="bi bi-zoom-out" /></button>
              <output className="t2i-lightbox-controls-zoom">{Math.round(lightboxZoom * 100)}%</output>
              <button type="button" disabled={lightboxZoom >= 5} aria-label="放大图片" onClick={() => changeLightboxZoom(lightboxZoom + 0.25)}><i className="bi bi-zoom-in" /></button>
              <button type="button" className="is-fit" aria-label="适应屏幕" onClick={resetLightboxView}><i className="bi bi-arrows-angle-contract" /><span>适应</span></button>
              {lightboxCanCompare && <button type="button" className={lightboxCompareEnabled ? "is-on" : ""} aria-pressed={lightboxCompareEnabled} aria-label="对比原图和处理后图片" title={lightboxCompareEnabled ? "退出前后对比" : "前后对比"} onClick={() => { const next = !lightboxCompareEnabled; setLightboxCompareEnabled(next); setLightboxComparePosition(50); if (next) changeLightboxZoom(2); }}><i className="bi bi-layout-split" /></button>}
              <button type="button" aria-label="局部编辑图片" title="局部编辑" onClick={() => { setLightbox(null); editTask(lightboxItem.task); }}><i className="bi bi-brush" /></button>
              <button type="button" aria-label="下载图片" title="下载" onClick={() => void downloadItem(lightboxItem)}><span className="t2i-icon-download" /></button>
              <button type="button" className="is-danger" aria-label="删除图片" title="删除" onClick={() => requestDelete([lightboxItem.task])}><span className="t2i-icon-delete" /></button>
              <span className="t2i-lightbox-controls-divider" />
              <button type="button" aria-label="关闭预览" title="关闭" onClick={() => setLightbox(null)}><i className="bi bi-x-lg" /></button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function CompactSegments({ label, value, options, onChange }) {
  if (!options.length) return null;
  return <div className="t2i-compact-field"><span>{label}</span><div className="t2i-compact-segments">{options.map((option) => <button key={option.value} type="button" className={String(value) === String(option.value) ? "is-selected" : ""} aria-pressed={String(value) === String(option.value)} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

function ModelPointPrice({ model, compact = false, prominent = false, light = false }) {
  const price = resolveModelPointPricing(model);
  if (!price.configured) return null;
  const classes = [
    "model-point-price",
    compact ? "is-compact" : "",
    prominent ? "is-prominent" : "",
    light ? "is-light" : "",
  ].filter(Boolean).join(" ");
  return (
    <span className={classes}>
      {price.hasDiscount ? (
        <>
          {prominent ? <strong><b>{price.discount}</b><span>积分/张</span></strong> : <strong>折扣 {price.discount} 积分/张</strong>}
          <del>标准 {price.standard} 积分/张</del>
        </>
      ) : price.effective === 0 ? (
        <strong>免费</strong>
      ) : prominent ? (
        <strong><b>{price.effective}</b><span>积分/张</span></strong>
      ) : (
        <strong>{price.effective} 积分/张</strong>
      )}
    </span>
  );
}

function Toggle({ label, icon, value, disabled = false, onChange }) {
  return <button type="button" className={`t2i-prompt-toggle${value ? " is-on" : ""}`} role="switch" aria-checked={value} disabled={disabled} onClick={() => onChange(!value)}><span className="t2i-prompt-toggle-copy"><i className={`bi ${icon}`} />{label}</span><span className="t2i-mini-switch"><span /></span></button>;
}

function PendingStage({ task, now, batchIndex }) {
  const isCell = Number.isFinite(Number(batchIndex));
  return (
    <div className={isCell ? "t2i-stage-cell-pending" : "t2i-stage-pending"} role="status">
      <span className="t2i-pending-orb"><i className="bi bi-stars" /></span>
      <strong>{isCell ? `第 ${Number(batchIndex) + 1} 张` : statusLabel(task)}</strong>
      <em className="t2i-pending-stage">{task?.status === "queued" ? "等待可用生成资源" : ["cancelled", "canceled"].includes(task?.status) ? "任务已取消" : "模型正在绘制画面"}</em>
      <span className="t2i-pending-bar"><i /></span>
      {elapsedLabel(task, now) && <em className="t2i-pending-elapsed">{elapsedLabel(task, now)}</em>}
      {!isCell && <span className="t2i-pending-prompt">{task?.prompt}</span>}
    </div>
  );
}

function ImageQuickActions({ cell = false, onEdit, onRegenerate, onDownload, onReference }) {
  return (
    <div className={`t2i-stage-quick-actions${cell ? " is-cell" : ""}`} aria-label="图片快捷操作">
      <button type="button" aria-label="编辑图片" title="编辑" onClick={onEdit}><span className="t2i-icon-edit-image" /></button>
      <button type="button" aria-label="重新生成" title="重新生成" onClick={onRegenerate}><span className="t2i-icon-regenerate" /></button>
      <button type="button" aria-label="下载图片" title="下载" onClick={onDownload}><span className="t2i-icon-download" /></button>
      <button type="button" aria-label="设为参考图" title="设为参考图" onClick={onReference}><span className="t2i-icon-reference" /></button>
    </div>
  );
}

function ActionConfirmDialog({ open, heading, description, confirmLabel, busy = false, tone = "accent", light = false, onCancel, onConfirm }) {
  return (
    <DialogMotion
      open={open}
      layerClassName={`delete-confirm__backdrop${light ? " is-light" : ""}`}
      panelClassName="delete-confirm__dialog"
      role="alertdialog"
      ariaLabelledby="delete-confirm-title"
      ariaDescribedby="delete-confirm-description"
      closeDisabled={busy}
      onClose={onCancel}
    >
        <div className={`delete-confirm__icon is-${tone}`}><i className={`bi ${tone === "danger" ? "bi-trash3" : "bi-arrow-clockwise"}`} /></div>
        <div className="delete-confirm__copy"><h2 id="delete-confirm-title">{heading}</h2><p id="delete-confirm-description">{description}</p></div>
        <footer className="delete-confirm__actions"><button type="button" className="is-cancel" disabled={busy} onClick={onCancel}>取消</button><button type="button" className={`is-confirm is-${tone}`} disabled={busy} onClick={onConfirm}>{busy && <i className="bi bi-arrow-repeat spin" />} {busy ? "处理中…" : confirmLabel}</button></footer>
    </DialogMotion>
  );
}

function HistorySkeleton() {
  return (
    <div className="t2i-history-skeleton" aria-label="历史记录加载中">
      {[1, 2, 3].map((column) => <div key={column} className="t2i-history-skeleton-col">{[1, 2, 3].map((row) => <article key={row} className="t2i-history-skeleton-card"><div className="t2i-skeleton-shine" /></article>)}</div>)}
    </div>
  );
}

function StageSkeleton({ aspect = "1:1" }) {
  return <div className="t2i-page-skeleton t2i-stage-page-skeleton" aria-label="作品加载中"><div className="t2i-page-skeleton-canvas"><div className="t2i-page-skeleton-media" style={ratioStyle(aspect)}><div className="t2i-skeleton-shine" /></div></div><div className="t2i-page-skeleton-bar"><div className="t2i-page-skeleton-copy"><div className="t2i-page-skeleton-line is-wide" /><div className="t2i-page-skeleton-line" /></div><div className="t2i-page-skeleton-actions">{[1, 2, 3, 4].map((item) => <span key={item} />)}</div></div><div className="t2i-page-skeleton-film">{Array.from({ length: 16 }, (_, index) => <span key={index} />)}</div></div>;
}
