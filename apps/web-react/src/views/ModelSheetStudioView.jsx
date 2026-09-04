import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { EcommerceMaskEditor } from "../features/ecommerce/EcommerceMaskEditor.jsx";
import { canOpenWallevenImagePreview, WallevenImagePreview } from "../components/common/WallevenImagePreview.jsx";
import { DownloadIcon } from "../components/common/DownloadIcon.jsx";
import { SoftMark } from "../components/common/SoftMark.jsx";
import { RegenerateIcon } from "../components/common/RegenerateIcon.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { PackageCheck } from "lucide-react";
import { useModelSheetJobs } from "../features/model-sheet/useModelSheetJobs.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { uploadAiInputFile } from "@react/legacy-modules/services/aiWallpaper.js";
import { createLocalUpscaledImage } from "@react/legacy-modules/features/ai-wallpaper/services/localImageUpscale.js";
import { withTransparentPngInstruction } from "@react/legacy-modules/features/ai-shared/transparentPng.js";
import { downloadAuthenticatedMedia, fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import { getScopedLocalItem, setScopedLocalItem } from "@react/legacy-modules/services/scopedLocalStorage.js";
import { listPromptLibrary, recordPromptEngagement } from "@react/legacy-modules/services/promptLibrary.js";
import { listMyShareAssets, submitShareItem } from "@react/legacy-modules/services/shareGallery.js";
import { composePendingLaunchPrompt, takePendingPrompt } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import {
  coerceImageModelSettings,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/views/ModelSheetStudioView.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "./ModelSheetStudioView.css";

const SETTINGS_KEY = "ultra-model-sheet-studio-v2";
const LABELS_KEY = "ultra-model-sheet-labels-v1";
const SUBJECTS_KEY = "ultra-model-sheet-subjects-v1";
const MAX_REFERENCES = 4;
const VIEW_OPTIONS = [
  { id: "front", label: "正面", en: "F", icon: "bi-person-standing" },
  { id: "side", label: "侧面", en: "S", icon: "bi-person-walking" },
  { id: "back", label: "背面", en: "B", icon: "bi-person-standing" },
  { id: "three-quarter", label: "3/4", en: "Q", icon: "bi-badge-3d" },
  { id: "detail", label: "细节", en: "D", icon: "bi-zoom-in" },
  { id: "material", label: "材质", en: "M", icon: "bi-layers" },
];
const VIEW_PRESETS = [
  { id: "turnaround", label: "三视图", desc: "正 / 侧 / 背，独立成图", mode: "separate", views: ["front", "side", "back"] },
  { id: "board", label: "设定板", desc: "一张多视角拼板", mode: "board", views: ["front", "side", "back", "three-quarter"] },
  { id: "custom", label: "自定义", desc: "自己选视角" },
];
const VIEW_EN = { front: "FRONT", side: "SIDE", back: "BACK", "three-quarter": "3/4", detail: "DETAIL", material: "MATERIAL" };
const ASPECT_OPTIONS = ["auto", "16:9", "21:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
const BACKGROUND_OPTIONS = [
  { id: "gray", label: "浅灰" },
  { id: "white", label: "纯白" },
  { id: "transparent", label: "透明" },
];
const BRIEF_EXAMPLES = [
  { label: "机甲角色", text: "全身机甲战士角色，硬表面装甲，可动关节结构清晰，冷灰主色配警示橙细节" },
  { label: "国风少女", text: "国风水墨风格少女角色，长发束带，襦裙层次分明，服饰纹样与配饰结构完整" },
  { label: "产品设备", text: "便携咖啡机产品，铝合金外壳，可拆卸水箱和滤杯，接缝与按键布局清晰" },
];
const DEFAULT_PROMPT = "保留原始主体的身份、比例、材质和结构特征，制作可供后续建模与生产使用的超高清标准模型参考图。";

function safePackageName(value, fallback = "model-sheet") {
  const name = String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 48);
  return name || fallback;
}

function imageExtension(contentType = "") {
  const value = String(contentType).toLowerCase();
  if (value.includes("webp")) return "webp";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  return "png";
}

function isSupportedImageFile(file) {
  const type = String(file?.type || "").toLowerCase();
  return ["image/png", "image/jpeg", "image/webp"].includes(type) || /\.(png|jpe?g|webp)$/i.test(file?.name || "");
}

function downloadLocalBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function defaultStudioSettings() {
  return {
    prompt: "",
    subjectType: "character",
    fidelity: "strict",
    aspectRatio: "3:4",
    detail: 85,
    outputMode: "separate",
    boardCount: 1,
    background: "gray",
    selectedViews: ["front", "side", "back"],
    customViews: [],
    referenceItems: [],
    activeSubjectId: "",
  };
}

function qualityForDetail(detail) {
  return detail >= 75 ? "high" : detail >= 55 ? "medium" : "low";
}

function detailForQuality(quality) {
  return quality === "high" ? 85 : quality === "medium" ? 65 : 48;
}

function supportedDetail(value, qualities) {
  const requested = qualityForDetail(value);
  if (qualities.includes(requested)) return value;
  return qualities
    .map((quality) => detailForQuality(quality))
    .sort((left, right) => Math.abs(left - value) - Math.abs(right - value))[0] || 65;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(getScopedLocalItem(key) || "null");
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function featureModels(config = {}) {
  const feature = config.features?.["ai.ultraModelSheet"] || {};
  const payload = feature.config && typeof feature.config === "object" ? { ...feature, ...feature.config } : feature;
  return (Array.isArray(payload.publicModels) ? payload.publicModels : [])
    .map((item) => ({
      ...item,
      id: String(item.id || item.publicModelKey || ""),
      publicModelKey: String(item.publicModelKey || item.id || ""),
      label: String(item.label || item.name || item.id || item.publicModelKey || ""),
      provider: String(item.providerName || item.provider || ""),
      creditCost: Math.max(0, Number(item.creditCost ?? item.pricePoints ?? payload.creditCost ?? 0)),
      ...normalizeImageModelCapabilities(item),
    }))
    .filter((item) => item.id);
}

function SelectPopover({ value, options, label, onChange, model = false, light = false }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const selected = options.find((item) => item.value === value) || options[0];
  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(
      Math.max(rect.width, model ? 342 : 184),
      window.innerWidth - 24,
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const opensUp = spaceBelow < 180 && rect.top > spaceBelow;
    const maxHeight = Math.max(
      120,
      Math.min(360, opensUp ? rect.top - 20 : spaceBelow),
    );
    setMenuStyle({
      left: Math.min(
        Math.max(rect.left, 12),
        window.innerWidth - width - 12,
      ),
      top: opensUp
        ? Math.max(12, rect.top - maxHeight - 8)
        : rect.bottom + 8,
      width,
      maxHeight,
    });
  }, [model]);
  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const close = (event) => !triggerRef.current?.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);
  return <div className={`ratio-select ms3-select-pop${open ? " is-open" : ""}${light ? " is-light" : ""}`}>
    <button ref={triggerRef} type="button" className="ratio-select__trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => { if (!open) positionMenu(); setOpen((current) => !current); }}>
      <span className="ratio-select__value-wrap"><span className="ratio-select__value">{selected?.label || selected?.value || "请选择"}</span></span>
      <i className="ratio-select__chevron bi bi-chevron-down" />
    </button>
    {open && createPortal(<div className={`ratio-select__menu${model ? " is-plain has-priced-options" : ""}${light ? " is-light" : ""}`} role="listbox" aria-label={label} style={menuStyle} onPointerDown={(event) => event.stopPropagation()}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={`ratio-select__option${option.value === value ? " is-selected" : ""}${model ? " has-icon has-price" : ""}`} onClick={() => { onChange(option.value); setOpen(false); }}>
        {model ? <SoftMark name="cpu" size="sm" /> : null}
        <span className="ratio-select__option-content"><span className="ratio-select__option-label">{option.label || option.value}</span></span>
        {model && option.creditCost != null && <span className={`model-point-price is-compact is-prominent${light ? " is-light" : ""}`}><strong><b>{option.creditCost}</b><span>积分/张</span></strong></span>}
      </button>)}
    </div>, document.body)}
  </div>;
}

function MediaImage({ src, alt = "", ...props }) {
  if (/^(?:blob:|data:)/i.test(String(src || ""))) return <img src={src} alt={alt} decoding="async" {...props} />;
  return <AuthenticatedImage src={src} alt={alt} {...props} />;
}

function progressStatusLabel(status) {
  if (status === "running") return "出图中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return "排队";
}

export function ModelSheetStudioView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const referenceUrlsRef = useRef(new Set());
  const pendingOverridesRef = useRef(new Set());
  const initialSettings = useMemo(() => defaultStudioSettings(), []);
  const hydratedScopeRef = useRef("");
  const [storageScope, setStorageScope] = useState("");
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState("");
  const activeModel = models.find((item) => item.id === modelId) || models[0] || null;
  const jobs = useModelSheetJobs({ model: activeModel, isAuthenticated: auth.isAuthenticated });
  const [referenceItems, setReferenceItems] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [activeSubjectId, setActiveSubjectId] = useState("");
  const [subjectNameDraft, setSubjectNameDraft] = useState("");
  const [subjectSaveOpen, setSubjectSaveOpen] = useState(false);
  const [subjectSaving, setSubjectSaving] = useState(false);
  const [subjectDeleteArmId, setSubjectDeleteArmId] = useState("");
  const [prompt, setPrompt] = useState(initialSettings.prompt);
  const [subjectType, setSubjectType] = useState(initialSettings.subjectType);
  const [fidelity, setFidelity] = useState(initialSettings.fidelity);
  const [aspectRatio, setAspectRatio] = useState(initialSettings.aspectRatio);
  const [detail, setDetail] = useState(initialSettings.detail);
  const [outputMode, setOutputMode] = useState(initialSettings.outputMode);
  const [boardCount, setBoardCount] = useState(initialSettings.boardCount);
  const [background, setBackground] = useState(initialSettings.background);
  const [selectedViews, setSelectedViews] = useState(initialSettings.selectedViews);
  const [customViews, setCustomViews] = useState(initialSettings.customViews);
  const [customViewDraft, setCustomViewDraft] = useState("");
  const [customViewInputOpen, setCustomViewInputOpen] = useState(false);
  const [wantsCustom, setWantsCustom] = useState(false);
  const [outputLabels, setOutputLabels] = useState({});
  const [panelTab, setPanelTab] = useState("history");
  const [galleryQuery, setGalleryQuery] = useState("");
  const [promptQuery, setPromptQuery] = useState("");
  const [promptItems, setPromptItems] = useState([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptPage, setPromptPage] = useState(0);
  const [promptHasMore, setPromptHasMore] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState("");
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [enhanceMenuOpen, setEnhanceMenuOpen] = useState(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState(0);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [submittingShare, setSubmittingShare] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState("");
  const [retryViews, setRetryViews] = useState([]);
  const [lastBatchGroupId, setLastBatchGroupId] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const modelCapabilities = useMemo(() => normalizeImageModelCapabilities(activeModel || {}), [activeModel]);
  const aspectOptions = useMemo(() => {
    const supported = new Set(modelCapabilities.aspectRatios);
    return ASPECT_OPTIONS.filter((value) => supported.has(value));
  }, [modelCapabilities.aspectRatios]);
  const maxReferences = modelCapabilities.maxReferenceImages;
  const backgroundOptions = useMemo(
    () => BACKGROUND_OPTIONS.filter((item) => item.id !== "transparent" || modelCapabilities.transparentBackground),
    [modelCapabilities.transparentBackground],
  );
  const detailLocked = modelCapabilities.qualities.length === 1;
  const allViewOptions = useMemo(() => [...VIEW_OPTIONS, ...customViews.map((view) => ({ ...view, en: view.label, icon: "bi-bookmark-star" }))], [customViews]);
  const matchedPreset = useMemo(() => {
    const key = `${outputMode}:${[...selectedViews].sort().join(",")}`;
    if (key === "separate:back,front,side") return "turnaround";
    if (key === "board:back,front,side,three-quarter") return "board";
    return "custom";
  }, [outputMode, selectedViews]);
  const activePreset = wantsCustom ? "custom" : matchedPreset;

  function applyPreset(preset) {
    if (preset.id === "custom") {
      setWantsCustom(true);
      return;
    }
    setWantsCustom(false);
    setCustomViewInputOpen(false);
    setOutputMode(preset.mode);
    setSelectedViews(preset.views);
    if (preset.mode === "board") setBoardCount(1);
  }
  const referenceFiles = referenceItems.filter((item) => item.type === "file").map((item) => item.file);
  const referenceUrls = referenceItems.filter((item) => item.type === "url").map((item) => item.url);
  const activeSubject = subjects.find((item) => item.id === activeSubjectId) || null;
  const activeEntry = jobs.entries.find((item) => item.url === jobs.activeOutput) || null;
  const requestedQuality = qualityForDetail(detail);
  const qualityLevel = coerceImageModelSettings(activeModel || {}, { quality: requestedQuality }).quality;
  const qualityLabel = qualityLevel === "high" ? "高" : qualityLevel === "medium" ? "中" : qualityLevel === "low" ? "低" : "模型默认";
  const selectedViewLabels = selectedViews.map((id) => allViewOptions.find((view) => view.id === id)?.label || id).join("、");
  const hasReference = referenceItems.length > 0;
  const brief = prompt.trim() || DEFAULT_PROMPT;
  const subjectLine = hasReference ? "严格以提供的参考图为唯一主体来源。" : "参考图未提供，请完全根据上方文字描述创建主体，并在整套输出中保持该主体一致。";
  const backgroundLine = background === "white" ? "纯白背景" : background === "transparent" ? "透明背景（输出透明 PNG）" : "纯浅灰背景";
  const finalPrompt = withTransparentPngInstruction(`${brief}\n${subjectLine}\n主体类型：${subjectType === "character" ? "人物/角色" : "物体/产品"}。\n输出视角：${selectedViewLabels}。\n还原策略：${fidelity === "strict" ? "严格忠于参考图，不改变身份和造型" : "保持主体特征并进行专业生产级优化"}。\n细节强度：${detail}/100。\n制作标准：单张完整模型设定板，正交视图比例一致，无遮挡，边缘清晰，中性影棚光，${backgroundLine}，无景深，无文字水印，超高清纹理，适合 3D 建模、雕刻、材质拆解和 LoRA 数据准备。`, background === "transparent");
  const estimatedUnits = outputMode === "board" ? boardCount : Math.max(1, selectedViews.length);
  const unitCost = Math.max(0, Number(activeModel?.creditCost || 0));
  const totalCost = unitCost * estimatedUnits;
  const costPrice = totalCost ? `${totalCost} 积分` : activeModel ? "免费" : "价格待确认";
  const frameStyle = useMemo(() => {
    const [rawWidth = 1, rawHeight = 1] = aspectRatio.split(":").map(Number);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
    return { aspectRatio: `${width} / ${height}`, width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 176px) * ${width / height}))` };
  }, [aspectRatio]);
  const silhouetteViews = selectedViews.slice(0, 4).map((id) => VIEW_EN[id] || allViewOptions.find((view) => view.id === id)?.label || id);
  const elapsedLabel = jobs.executionStartedAt
    ? `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`
    : "--:--";
  const batchDoneCount = jobs.batchProgress.filter((item) => item.status === "done").length;

  const groups = useMemo(() => {
    const map = new Map();
    jobs.entries.forEach((entry, index) => {
      const id = entry.groupId || entry.url;
      if (!map.has(id)) map.set(id, { id, urls: [], entries: [], firstIndex: index });
      const group = map.get(id);
      group.urls.push(entry.url);
      group.entries.push(entry);
    });
    return [...map.values()].map((group) => {
      group.entries.sort((left, right) => left.groupIndex - right.groupIndex);
      group.urls = group.entries.map((entry) => entry.url);
      group.cover = group.urls[0];
      return group;
    });
  }, [jobs.entries]);
  const filteredGroups = groups.filter((group) => {
    const query = galleryQuery.trim().toLowerCase();
    return !query || group.entries.some((entry) => String(outputLabels[entry.url] || entry.label || "").toLowerCase().includes(query));
  });
  const activeGroup = groups.find((group) => group.urls.includes(jobs.activeOutput));
  const turnaroundSlots = useMemo(() => {
    if (outputMode === "board") return [];
    const sourceGroup = jobs.running
      ? groups.find((group) => group.id === lastBatchGroupId)
      : activeGroup;
    const matchEntry = (viewId, label) => sourceGroup?.entries.find((item) => item.viewId === viewId)
      || sourceGroup?.entries.find((item) => (outputLabels[item.url] || item.label) === label)
      || null;
    const planned = selectedViews.map((id, index) => {
      const view = allViewOptions.find((item) => item.id === id);
      const label = view?.label || id;
      return { key: id, label, entry: matchEntry(id, label), status: jobs.batchProgress[index]?.status || "" };
    });
    if (sourceGroup?.entries?.length && !jobs.running && planned.every((slot) => !slot.entry)) {
      return sourceGroup.entries.map((entry) => ({
        key: entry.url,
        label: outputLabels[entry.url] || entry.label || "视图",
        entry,
        status: "",
      }));
    }
    return planned;
  }, [activeGroup, allViewOptions, groups, jobs.batchProgress, jobs.running, lastBatchGroupId, outputLabels, outputMode, selectedViews]);
  const filteredPrompts = promptItems.filter((item) => {
    const query = promptQuery.trim().toLowerCase();
    return !query || `${item?.title || ""} ${item?.prompt || ""}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    if (!jobs.running || !jobs.executionStartedAt) { setElapsedSeconds(0); return undefined; }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - jobs.executionStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [jobs.executionStartedAt, jobs.running]);

  useEffect(() => {
    mountedRef.current = true;
    fetchRuntimeConfig().then((config) => {
      if (!mountedRef.current) return;
      const available = featureModels(config);
      setModels(available);
      setModelId((current) => available.some((item) => item.id === current) ? current : available.find((item) => item.default)?.id || available[0]?.id || "");
      const pending = takePendingPrompt("model_sheet");
      if (pending) {
        const launchPrompt = composePendingLaunchPrompt(pending, 1500);
        if (launchPrompt) { pendingOverridesRef.current.add("prompt"); setPrompt(launchPrompt); }
        const configValue = pending.config || {};
        if (["character", "object"].includes(configValue.skill)) { pendingOverridesRef.current.add("subjectType"); setSubjectType(configValue.skill); }
        if (ASPECT_OPTIONS.includes(configValue.ratio)) { pendingOverridesRef.current.add("aspectRatio"); setAspectRatio(configValue.ratio); }
        if ([1, 2, 3, 4].includes(Number(configValue.count))) { pendingOverridesRef.current.add("boardCount"); setBoardCount(Number(configValue.count)); }
        if (configValue.model && available.some((item) => item.id === configValue.model)) setModelId(configValue.model);
      }
    }).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      referenceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.isAuthenticated) {
      hydratedScopeRef.current = "guest";
      setStorageScope("");
      setReferenceItems([]);
      setSubjects([]);
      setActiveSubjectId("");
      setOutputLabels({});
      setPrompt(initialSettings.prompt);
      setSubjectType(initialSettings.subjectType);
      setFidelity(initialSettings.fidelity);
      setAspectRatio(initialSettings.aspectRatio);
      setDetail(initialSettings.detail);
      setOutputMode(initialSettings.outputMode);
      setBoardCount(initialSettings.boardCount);
      setBackground(initialSettings.background);
      setSelectedViews(initialSettings.selectedViews);
      setCustomViews(initialSettings.customViews);
      setWantsCustom(false);
      return;
    }
    const scope = `user_${auth.user.id}`;
    if (hydratedScopeRef.current === scope) return;
    const saved = { ...initialSettings, ...readJson(SETTINGS_KEY, {}) };
    const savedReferences = (Array.isArray(saved.referenceItems) ? saved.referenceItems : [])
      .filter((item) => item?.type === "url" && item.url)
      .slice(0, MAX_REFERENCES);
    const savedSubjects = Array.isArray(readJson(SUBJECTS_KEY, [])) ? readJson(SUBJECTS_KEY, []) : [];
    setReferenceItems(savedReferences);
    setSubjects(savedSubjects.filter((item) => item?.id && item?.url).slice(0, 12));
    setActiveSubjectId(String(saved.activeSubjectId || ""));
    setOutputLabels(readJson(LABELS_KEY, {}));
    if (!pendingOverridesRef.current.has("prompt")) setPrompt(String(saved.prompt || initialSettings.prompt));
    if (!pendingOverridesRef.current.has("subjectType")) setSubjectType(["character", "object"].includes(saved.subjectType) ? saved.subjectType : initialSettings.subjectType);
    setFidelity(["strict", "enhance"].includes(saved.fidelity) ? saved.fidelity : initialSettings.fidelity);
    if (!pendingOverridesRef.current.has("aspectRatio")) setAspectRatio(ASPECT_OPTIONS.includes(saved.aspectRatio) ? saved.aspectRatio : initialSettings.aspectRatio);
    setDetail(Math.min(100, Math.max(40, Number(saved.detail) || initialSettings.detail)));
    setOutputMode(["board", "separate"].includes(saved.outputMode) ? saved.outputMode : initialSettings.outputMode);
    if (!pendingOverridesRef.current.has("boardCount")) setBoardCount([1, 2, 3, 4].includes(Number(saved.boardCount)) ? Number(saved.boardCount) : initialSettings.boardCount);
    setBackground(BACKGROUND_OPTIONS.some((item) => item.id === saved.background) ? saved.background : initialSettings.background);
    setSelectedViews(Array.isArray(saved.selectedViews) && saved.selectedViews.length ? saved.selectedViews : initialSettings.selectedViews);
    setCustomViews(Array.isArray(saved.customViews) ? saved.customViews.slice(0, 8) : []);
    hydratedScopeRef.current = scope;
    setStorageScope(scope);
  }, [auth.isAuthenticated, auth.loading, auth.user?.id, initialSettings]);

  useEffect(() => {
    if (!activeModel) return;
    setAspectRatio((current) => aspectOptions.includes(current) ? current : aspectOptions[0] || "");
    setBackground((current) => current === "transparent" && !modelCapabilities.transparentBackground ? "gray" : current);
    setReferenceItems((current) => current.length > maxReferences ? current.slice(0, maxReferences) : current);
    if (modelCapabilities.qualities.length) {
      setDetail((current) => supportedDetail(current, modelCapabilities.qualities));
    }
  }, [activeModel, aspectOptions, maxReferences, modelCapabilities.qualities, modelCapabilities.transparentBackground]);

  useEffect(() => {
    if (!storageScope) return undefined;
    const timer = window.setTimeout(() => setScopedLocalItem(SETTINGS_KEY, JSON.stringify({
      prompt, subjectType, fidelity, aspectRatio, detail, outputMode, boardCount, background, selectedViews, customViews,
      referenceItems: referenceItems.filter((item) => item.type === "url").map(({ id, type, url }) => ({ id, type, url })),
      activeSubjectId,
    })), 400);
    return () => window.clearTimeout(timer);
  }, [activeSubjectId, aspectRatio, background, boardCount, customViews, detail, fidelity, outputMode, prompt, referenceItems, selectedViews, storageScope, subjectType]);
  useEffect(() => {
    if (!storageScope) return;
    setScopedLocalItem(LABELS_KEY, JSON.stringify(outputLabels));
  }, [outputLabels, storageScope]);
  useEffect(() => {
    if (!storageScope) return;
    setScopedLocalItem(SUBJECTS_KEY, JSON.stringify(subjects.slice(0, 12)));
  }, [storageScope, subjects]);
  useEffect(() => {
    const keydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !jobs.running) { event.preventDefault(); void generate(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const acceptFiles = useCallback((files) => {
    const selected = Array.from(files || []);
    const incoming = selected.filter(isSupportedImageFile);
    if (!incoming.length) {
      if (selected.length) setLocalError("请选择 PNG、JPG 或 WebP 参考图");
      return;
    }
    setReferenceItems((current) => {
      const next = [...current];
      incoming.forEach((file) => {
        if (next.length >= maxReferences) return;
        const preview = URL.createObjectURL(file);
        referenceUrlsRef.current.add(preview);
        next.push({ id: `ref-${crypto.randomUUID()}`, type: "file", file, preview });
      });
      return next;
    });
    setLocalError("");
  }, [maxReferences]);

  function buildSeparatePrompt(view, chained = false) {
    const sourceLine = chained ? "严格以提供的参考图为唯一主体来源，保持同一人物/物体、同一服装、同一材质。" : subjectLine;
    return withTransparentPngInstruction(`${brief}\n${sourceLine}\n本次只生成一个独立的「${view.label}」视图，不要拼图、不要分镜、不要在同一画面放多个角度。\n主体类型：${subjectType === "character" ? "人物/角色" : "物体/产品"}。\n还原策略：${fidelity === "strict" ? "严格忠于参考图，不改变身份、造型、比例、服装和材质" : "保持主体身份与关键特征并进行专业生产级优化"}。\n细节强度：${detail}/100。\n制作标准：主体完整、居中、无遮挡，中性影棚光，${backgroundLine}，无景深，无文字水印。必须与同批次其他视图保持同一主体、同一服装、同一材质、同一比例和同一光照。`, background === "transparent");
  }

  async function runSeparateViews(views, { groupId = "", sourceOverride = "" } = {}) {
    const noReference = !referenceFiles.length && !referenceUrls.length && !sourceOverride;
    const batchId = groupId || crypto.randomUUID();
    setLastBatchGroupId(batchId);
    const result = await jobs.generateBatch({
      items: views.map((view, index) => ({ prompt: buildSeparatePrompt(view, Boolean(sourceOverride) || (noReference && index > 0)), aspectRatio, quality: qualityLevel, transparentPngEnabled: background === "transparent", viewId: view.id, viewLabel: view.label, outputMode: "separate" })),
      files: referenceFiles,
      sourceUrls: [...referenceUrls, sourceOverride].filter(Boolean),
      concurrency: 1,
      chainFirstOutputAsSource: noReference,
      groupId: batchId,
    });
    setLastBatchGroupId(result.groupId || batchId);
    setRetryViews(result.failures.map((failure) => failure.item).filter(Boolean));
    if (result.results.length) {
      setOutputLabels((current) => ({
        ...current,
        ...Object.fromEntries(
          result.results.flatMap((entry) =>
            entry.urls.map((url) => [url, entry.item?.viewLabel || "独立视图"]),
          ),
        ),
      }));
    }
  }

  async function generate() {
    if (requestAuth({ featureLabel: "模型设计" })) return;
    setLocalError("");
    setRetryViews([]);
    if (!selectedViews.length) { setLocalError("请至少选择一个输出视角"); return; }
    if (!activeModel) { setLocalError("后台还没有为模型设计分配可用模型"); return; }
    if (outputMode === "separate") {
      await runSeparateViews(selectedViews.map((id) => allViewOptions.find((view) => view.id === id)).filter(Boolean));
      return;
    }
    const result = await jobs.generateBatch({
      items: Array.from({ length: boardCount }, (_, index) => ({ prompt: finalPrompt, aspectRatio, quality: qualityLevel, transparentPngEnabled: background === "transparent", viewLabel: boardCount > 1 ? `方案 ${index + 1}` : "设定板", outputMode: "board" })),
      files: referenceFiles,
      sourceUrls: referenceUrls,
      concurrency: boardCount,
      groupId: crypto.randomUUID(),
    });
    if (result.results.length) {
      setOutputLabels((current) => ({
        ...current,
        ...Object.fromEntries(result.results.flatMap((entry) =>
          entry.urls.map((url) => [url, entry.item?.viewLabel || "设定板"]),
        )),
      }));
    }
  }

  async function loadPrompts(reset = false) {
    if (promptLoading) return;
    setPromptLoading(true);
    try {
      const page = reset ? 1 : promptPage + 1;
      const response = await listPromptLibrary("model_sheet", { pageNumber: page, pageSize: 24 });
      const incoming = Array.isArray(response?.items) ? response.items : [];
      setPromptItems((current) => reset ? incoming : [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()]);
      setPromptPage(Number(response?.page || page));
      setPromptHasMore(response?.hasMore === true);
    } catch (caught) { notificationService.error(caught?.message || "提示词库读取失败"); }
    finally { setPromptLoading(false); }
  }

  async function loadAssets() {
    if (assetsLoading || !auth.isAuthenticated) return;
    setAssetsLoading(true);
    try {
      const response = await listMyShareAssets({ page: 1, pageSize: 48 });
      setAssets((Array.isArray(response?.items) ? response.items : []).filter((item) => String(item?.kind || "").startsWith("ultra-reference")));
      setAssetsLoaded(true);
    } catch (caught) { notificationService.error(caught?.message || "我的资产读取失败"); }
    finally { setAssetsLoading(false); }
  }

  async function saveSubject() {
    const name = subjectNameDraft.trim().slice(0, 16);
    if (!name || subjectSaving) return;
    setSubjectSaving(true);
    try {
      let url = referenceUrls[0] || "";
      if (!url && referenceFiles[0]) url = await uploadAiInputFile(referenceFiles[0], { featureKey: "ai.ultraModelSheet" });
      if (!url) url = jobs.activeOutput;
      if (!url) throw new Error("请先导入参考图或选中一张生成结果");
      const subject = { id: `sub-${crypto.randomUUID()}`, name, url, description: prompt.trim().slice(0, 400), createdAt: new Date().toISOString() };
      setSubjects((current) => [subject, ...current].slice(0, 12));
      setActiveSubjectId(subject.id);
      setSubjectNameDraft("");
      setSubjectSaveOpen(false);
      notificationService.success(`主体档案「${name}」已保存`);
    } catch (caught) { notificationService.error(caught?.message || "主体档案保存失败"); }
    finally { setSubjectSaving(false); }
  }

  async function enhanceDownload(scale) {
    if (!jobs.activeOutput || enhanceBusy) return;
    setEnhanceMenuOpen(false); setEnhanceBusy(true); setEnhanceProgress(0);
    try {
      const result = await createLocalUpscaledImage({ sourceUrl: jobs.activeOutput, resolutionScale: scale, transparentPng: background === "transparent", onProgress: (value) => setEnhanceProgress(Math.round(value)) });
      if (result.skipped || !result.file) await downloadAuthenticatedMedia(jobs.activeOutput, `ultra-model-sheet-${scale}-${Date.now()}.png`);
      else {
        const url = URL.createObjectURL(result.file); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ultra-model-sheet-${scale}-${result.targetWidth}x${result.targetHeight}.png`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (caught) { notificationService.error(caught?.message || "高清增强失败"); }
    finally { setEnhanceBusy(false); }
  }

  async function exportModelSheetPack() {
    const entries = activeGroup?.entries?.length
      ? activeGroup.entries
      : activeEntry
        ? [activeEntry]
        : [];
    if (!entries.length || handoffBusy) return;
    setHandoffBusy(true);
    setLocalError("");
    try {
      const { strToU8, zipSync } = await import("fflate");
      const files = {};
      const manifestFiles = [];
      for (const [index, entry] of entries.entries()) {
        const blob = await fetchAuthenticatedMediaBlob(entry.url, {
          fallbackUrl: entry.displayUrl || entry.previewUrl || "",
        });
        const label = outputLabels[entry.url] || entry.label || `view-${index + 1}`;
        const filename = `views/${String(index + 1).padStart(2, "0")}-${safePackageName(label, `view-${index + 1}`)}.${imageExtension(blob.type)}`;
        files[filename] = new Uint8Array(await blob.arrayBuffer());
        manifestFiles.push({
          file: filename,
          label,
          viewId: entry.viewId || "",
          sourceTaskId: entry.jobId || "",
        });
      }
      const manifest = {
        kind: "starclouds-model-sheet",
        version: 1,
        subject: prompt.trim(),
        subjectType,
        outputMode,
        views: selectedViews,
        aspectRatio,
        background,
        fidelity,
        detail,
        quality: qualityLevel,
        model: activeModel?.label || activeModel?.id || "",
        files: manifestFiles,
      };
      files["model-sheet.json"] = strToU8(JSON.stringify(manifest, null, 2));
      files["prompt.txt"] = strToU8(
        outputMode === "board"
          ? finalPrompt
          : selectedViews
              .map((id) => buildSeparatePrompt(allViewOptions.find((view) => view.id === id) || VIEW_OPTIONS[0]))
              .join("\n\n---\n\n"),
      );
      files["README.md"] = strToU8([
        "# Model sheet handoff",
        "",
        `- Mode: ${outputMode}`,
        `- Aspect ratio: ${aspectRatio}`,
        `- Views: ${manifestFiles.map((item) => item.label).join(", ")}`,
        "",
        "Use model-sheet.json as the machine-readable index. Keep identity, scale, materials, and silhouettes consistent across every view.",
      ].join("\n"));
      const archive = zipSync(files, { level: 6 });
      downloadLocalBlob(
        new Blob([archive], { type: "application/zip" }),
        `${safePackageName(prompt || activeGroup?.id || "model-sheet")}-handoff.zip`,
      );
      notificationService.success(`模型交付包已生成，包含 ${manifestFiles.length} 张原图`);
    } catch (caught) {
      const message = caught?.message || "模型交付包导出失败";
      setLocalError(message);
      notificationService.error(message);
    } finally {
      setHandoffBusy(false);
    }
  }

  const generateLabel = jobs.running ? "渲染中…" : outputMode === "board" ? boardCount > 1 ? `生成 ${boardCount} 个方案` : "生成设定板" : `生成 ${selectedViews.length} 张视图`;
  const groupLabel = (group) => group.urls.length > 1 ? `${outputLabels[group.cover] || group.entries[0]?.label || "设定板"} 等 ${group.urls.length} 张` : outputLabels[group.cover] || group.entries[0]?.label || "设定板";

  return <main ref={rootRef} className={`ms3${isDark ? "" : " is-light"}`}>
    <h1 className="ms3-visually-hidden">模型设计</h1>
    <aside className="ms3-panel">
      <div className="ms3-panel-scroll">
        {maxReferences > 0 && <section className="ms3-block">
          <div className="ms3-block-head"><span>参考主体</span><em>{referenceItems.length ? `${referenceItems.length}/${maxReferences} 张` : maxReferences ? "可选" : "当前模型不支持"}</em></div>
          {referenceItems.length ? <div className="ms3-ref-grid" onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); acceptFiles(event.dataTransfer.files); }}>
            {referenceItems.map((item, index) => <div key={item.id} className="ms3-ref-slot"><MediaImage src={item.type === "url" ? item.url : item.preview} alt="参考主体" maxDimension={240} loading="eager" />{index === 0 && <span className="ms3-ref-primary">主</span>}<button type="button" className="ms3-source-del" title="移除这张参考" onClick={() => setReferenceItems((current) => { if (item.preview) { URL.revokeObjectURL(item.preview); referenceUrlsRef.current.delete(item.preview); } return current.filter((entry) => entry.id !== item.id); })}><i className="bi bi-x-lg" /></button></div>)}
            {referenceItems.length < maxReferences && <button type="button" className={`ms3-ref-add${dragOver ? " is-over" : ""}`} title="再添加一张参考图（正面照 / 侧面照 / 材质细节）" onClick={() => fileInputRef.current?.click()}><i className="bi bi-plus-lg" /></button>}
          </div> : <button type="button" className={`ms3-upload${dragOver ? " is-over" : ""}`} disabled={!maxReferences} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { if (!maxReferences) return; event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { if (!maxReferences) return; event.preventDefault(); setDragOver(false); acceptFiles(event.dataTransfer.files); }}><i className="bi bi-image" /><strong>{maxReferences ? "添加参考图" : "当前模型不支持参考图"}</strong>{maxReferences > 0 && <small>最多 {maxReferences} 张</small>}</button>}
          <input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { acceptFiles(event.target.files); event.target.value = ""; }} />
        </section>}
        <section className="ms3-block"><div className="ms3-block-head"><span>主体</span><em>{prompt.length}/1500</em></div><textarea className="ms3-textarea" rows={3} maxLength={1500} placeholder="写服装、材质、结构。空着也能先出三视图。" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="ms3-chips">{BRIEF_EXAMPLES.map((example) => <button key={example.label} type="button" onClick={() => setPrompt(example.text)}>{example.label}</button>)}</div></section>
        <section className="ms3-block">
          <div className="ms3-block-head"><span>方案</span><em>{outputMode === "board" ? "一张拼板" : `${selectedViews.length} 张独立图`}</em></div>
          <div className="ms3-seg" role="radiogroup" aria-label="出图方案">
            {VIEW_PRESETS.map((preset) => (
              <button key={preset.id} type="button" role="radio" aria-checked={activePreset === preset.id} className={activePreset === preset.id ? "is-on" : ""} onClick={() => applyPreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
          {activePreset === "custom" && <div className="ms3-seg"><button type="button" className={outputMode === "board" ? "is-on" : ""} onClick={() => setOutputMode("board")}>单张设定板</button><button type="button" className={outputMode === "separate" ? "is-on" : ""} onClick={() => setOutputMode("separate")}>多张独立视图</button></div>}
          {outputMode === "board" && <div className="ms3-row"><span>方案数量</span><div className="ms3-seg is-mini">{[1,2,3,4].map((count) => <button key={count} type="button" className={boardCount === count ? "is-on" : ""} onClick={() => setBoardCount(count)}>{count}</button>)}</div></div>}
          {activePreset === "custom" && <>
          <div className="ms3-views">{allViewOptions.map((view) => <button key={view.id} type="button" className={`ms3-view-chip${selectedViews.includes(view.id) ? " is-on" : ""}`} aria-pressed={selectedViews.includes(view.id)} onClick={() => setSelectedViews((current) => current.includes(view.id) ? current.filter((id) => id !== view.id) : [...current, view.id])}><i className={`bi ${view.icon}`} /><span>{view.label}</span>{view.id.startsWith("custom-") && <b role="button" tabIndex={0} title="删除自定义视角" onClick={(event) => { event.stopPropagation(); setCustomViews((current) => current.filter((item) => item.id !== view.id)); setSelectedViews((current) => current.filter((id) => id !== view.id)); }}><i className="bi bi-x" /></b>}</button>)}{!customViewInputOpen && customViews.length < 8 && <button type="button" className="ms3-view-add" onClick={() => setCustomViewInputOpen(true)}><i className="bi bi-plus-lg" /><span>添加视角</span></button>}</div>
          {customViewInputOpen && <div className="ms3-view-input"><input value={customViewDraft} maxLength={12} placeholder="如：俯视 / 战斗姿态" aria-label="自定义视角名称" onChange={(event) => setCustomViewDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && customViewDraft.trim()) { const view = { id: `custom-${crypto.randomUUID()}`, label: customViewDraft.trim() }; setCustomViews((current) => [...current, view]); setSelectedViews((current) => [...current, view.id]); setCustomViewDraft(""); setCustomViewInputOpen(false); } if (event.key === "Escape") setCustomViewInputOpen(false); }} /><button type="button" disabled={!customViewDraft.trim()} onClick={() => { const view = { id: `custom-${crypto.randomUUID()}`, label: customViewDraft.trim() }; setCustomViews((current) => [...current, view]); setSelectedViews((current) => [...current, view.id]); setCustomViewDraft(""); setCustomViewInputOpen(false); }}>添加</button><button type="button" className="is-ghost" onClick={() => setCustomViewInputOpen(false)}>取消</button></div>}
          </>}
        </section>
        <details className="ms3-more">
          <summary>画面设置</summary>
          <div className="ms3-row"><span>主体类型</span><div className="ms3-seg is-mini"><button type="button" className={subjectType === "character" ? "is-on" : ""} onClick={() => setSubjectType("character")}>人物</button><button type="button" className={subjectType === "object" ? "is-on" : ""} onClick={() => setSubjectType("object")}>物体</button></div></div>
          {aspectOptions.length > 0 && <div className="ms3-row"><span>输出比例</span><SelectPopover value={aspectRatio} options={aspectOptions.map((value) => ({ value, label: value }))} label="输出比例" onChange={setAspectRatio} light={!isDark} /></div>}
          <div className="ms3-row"><span>背景</span><div className="ms3-seg is-mini">{backgroundOptions.map((item) => <button key={item.id} type="button" className={background === item.id ? "is-on" : ""} onClick={() => setBackground(item.id)}>{item.label}</button>)}</div></div>
          <div className="ms3-row"><span>还原策略</span><div className="ms3-seg is-mini"><button type="button" className={fidelity === "strict" ? "is-on" : ""} onClick={() => setFidelity("strict")}>严格</button><button type="button" className={fidelity === "enhance" ? "is-on" : ""} onClick={() => setFidelity("enhance")}>优化</button></div></div>
          {modelCapabilities.qualities.length > 0 && <div className="ms3-row is-slider"><span>细节强度</span><em>{detail} · {qualityLabel}档</em><input value={detail} type="range" min="40" max="100" aria-label="细节强度" disabled={detailLocked} onChange={(event) => setDetail(supportedDetail(Number(event.target.value), modelCapabilities.qualities))} /></div>}
          <div className="ms3-row"><span>生成模型</span><SelectPopover value={modelId} options={models.map((item) => ({ value: item.id, label: item.label, creditCost: item.creditCost }))} label="生成模型" onChange={setModelId} model light={!isDark} /></div>
        </details>
        <details className="ms3-more">
          <summary>主体档案与提示词</summary>
          <div className="ms3-subjects">
            <div className="ms3-subjects-head"><span><i className="bi bi-person-badge" />主体档案</span>{!subjectSaveOpen && <button type="button" disabled={!hasReference && !jobs.activeOutput} onClick={() => setSubjectSaveOpen(true)}><i className="bi bi-plus-lg" />存档</button>}</div>
            {subjectSaveOpen && <div className="ms3-subject-save"><input value={subjectNameDraft} maxLength={16} placeholder="档案名（如：星轨机械师）" aria-label="主体档案名称" onChange={(event) => setSubjectNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSubject(); if (event.key === "Escape") setSubjectSaveOpen(false); }} /><button type="button" disabled={!subjectNameDraft.trim() || subjectSaving} onClick={saveSubject}>{subjectSaving ? "保存中…" : "保存"}</button><button type="button" className="is-ghost" onClick={() => setSubjectSaveOpen(false)}>取消</button></div>}
            {!subjects.length && !subjectSaveOpen ? <p className="ms3-subjects-empty">导入参考图或生成后点「存档」，同一角色可反复出图</p> : <div className="ms3-subject-row">{subjects.map((subject) => <button key={subject.id} type="button" className={`ms3-subject-card${subject.id === activeSubjectId ? " is-on" : ""}`} title={`使用主体「${subject.name}」`} onClick={() => { setReferenceItems([{ id: `ref-${crypto.randomUUID()}`, type: "url", url: subject.url }]); if (subject.description) setPrompt(subject.description); setActiveSubjectId(subject.id); }}><AuthenticatedImage src={subject.url} alt="" maxDimension={120} /><span>{subject.name}</span><b role="button" tabIndex={0} className={subjectDeleteArmId === subject.id ? "is-armed" : ""} title="删除档案" onClick={(event) => { event.stopPropagation(); if (subjectDeleteArmId !== subject.id) { setSubjectDeleteArmId(subject.id); window.setTimeout(() => setSubjectDeleteArmId(""), 3200); } else { setSubjects((current) => current.filter((item) => item.id !== subject.id)); setSubjectDeleteArmId(""); } }}><i className={`bi ${subjectDeleteArmId === subject.id ? "bi-question-lg" : "bi-x"}`} /></b></button>)}</div>}
            {activeSubject && jobs.activeOutput && <button type="button" className="ms3-subject-update" onClick={() => { setSubjects((current) => current.map((item) => item.id === activeSubject.id ? { ...item, url: jobs.activeOutput } : item)); notificationService.success(`已把当前图设为「${activeSubject.name}」的标准参考`); }}><i className="bi bi-bookmark-check" />设当前图为「{activeSubject.name}」标准参考</button>}
          </div>
          <details className="ms3-prompt-preview" open={promptPreviewOpen}><summary onClick={(event) => { event.preventDefault(); setPromptPreviewOpen((value) => !value); }}><i className="bi bi-braces" />查看将要发送的完整提示词<i className={`bi bi-chevron-down${promptPreviewOpen ? " is-open" : ""}`} /></summary><pre>{outputMode === "board" ? finalPrompt : `独立视图模式：每个视角单独发送一条提示词。\n${buildSeparatePrompt(allViewOptions.find((view) => view.id === selectedViews[0]) || VIEW_OPTIONS[0])}`}</pre></details>
        </details>
      </div>
      <footer className="ms3-panel-footer"><button className="ms3-generate" type="button" disabled={jobs.running} aria-label={`${generateLabel}，${costPrice}`} onClick={generate}><span className="ms3-generate-icon"><i className={`bi ${jobs.running ? "bi-arrow-repeat ms3-spin" : "bi-stars"}`} /></span><span className="ms3-generate-copy"><strong>{generateLabel}</strong><small><i className="bi bi-stopwatch" />约 1-2 分钟 / 张</small></span><span className="ms3-generate-price"><small>预计扣费</small><strong>{costPrice}</strong>{estimatedUnits > 1 && unitCost > 0 && <em>{unitCost} 积分 / 张 × {estimatedUnits}</em>}</span></button>{jobs.running && <button type="button" className="ms3-cancel-inline" disabled={jobs.cancelling} onClick={() => jobs.cancel()}>{jobs.cancelling ? "正在确认任务…" : "停止生成"}</button>}</footer>
    </aside>
    <section className="ms3-stage">
      <header className="ms3-stage-bar"><div className="ms3-stage-meta"><strong>{outputMode === "board" ? "设定板" : "建模参考台"}</strong><span className="ms3-tag">{outputMode === "board" ? "一张拼板" : selectedViewLabels || "独立视图"}</span><span className="ms3-tag">{aspectRatio}</span></div><div className="ms3-stage-actions">
        {maxReferences > 0 && <button type="button" disabled={!jobs.activeOutput || jobs.running} title="以当前结果作为参考主体继续生成" onClick={() => { if (!referenceItems.some((item) => item.type === "url" && item.url === jobs.activeOutput) && referenceItems.length < maxReferences) setReferenceItems((current) => [...current, { id: `ref-${crypto.randomUUID()}`, type: "url", url: jobs.activeOutput }]); }}><i className="bi bi-pin-angle" /><span>用作参考</span></button>}
        <button type="button" disabled={!jobs.activeOutput || jobs.running} title="涂抹修正当前图的局部（其余保持不变）" onClick={() => setMaskEditorOpen(true)}><i className="bi bi-bandaid" /><span>修正</span></button>
        <div className={`ms3-enhance${enhanceMenuOpen ? " is-open" : ""}`}><button type="button" disabled={!jobs.activeOutput || enhanceBusy} title="本地高清增强导出（不调用模型）" onClick={() => setEnhanceMenuOpen((value) => !value)}><i className={`bi ${enhanceBusy ? "bi-arrow-repeat ms3-spin" : "bi-badge-hd"}`} /><span>{enhanceBusy ? `${enhanceProgress}%` : "增强"}</span></button>{enhanceMenuOpen && <div className="ms3-enhance-menu" role="menu" aria-label="高清增强档位">{["2K","4K","8K"].map((scale) => <button key={scale} type="button" role="menuitem" onClick={() => enhanceDownload(scale)}>{scale}<small>{scale === "2K" ? "快速" : scale === "4K" ? "高清" : "极致"}</small></button>)}</div>}</div>
        <button type="button" disabled={!jobs.activeOutput} title="全屏查看" onClick={() => canOpenWallevenImagePreview() && setFullscreenOpen(true)}><i className="bi bi-arrows-fullscreen" /><span>大图</span></button><button type="button" disabled={!activeEntry?.jobId} title="发布到广场" onClick={() => setPublishOpen(true)}><i className="bi bi-broadcast" /><span>发布</span></button><button type="button" disabled={!jobs.activeOutput || handoffBusy} title="导出客户与 Codex 可读取的模型交付包" onClick={exportModelSheetPack}><PackageCheck size={15} aria-hidden="true" /><span>{handoffBusy ? "打包中" : "交付"}</span></button><button type="button" disabled={!jobs.activeOutput} title="下载当前模型图" onClick={() => downloadAuthenticatedMedia(jobs.activeOutput, `ultra-model-sheet-${Date.now()}.png`)}><DownloadIcon /><span>下载</span></button>
      </div></header>
      {(localError || jobs.error) && <p className="ms3-error" role="alert"><i className="bi bi-exclamation-triangle" /><span>{localError || jobs.error}</span>{retryViews.length > 0 && !jobs.running && <button type="button" className="ms3-retry" onClick={() => runSeparateViews(retryViews, { groupId: lastBatchGroupId, sourceOverride: hasReference ? "" : jobs.activeOutput })}><RegenerateIcon />重试失败视图（{retryViews.length}）</button>}</p>}
      <div className={`ms3-viewport${outputMode === "separate" ? " is-turnaround" : ""}`}>
        {jobs.running && <div className="ms3-runbar" aria-live="polite"><em className="ms3-hud-status">{jobs.status || "正在建立模型参考…"}</em>{jobs.batchProgress.length > 1 && <span className="ms3-render-count">{batchDoneCount}/{jobs.batchProgress.length}</span>}<b className="ms3-render-timer">{elapsedLabel}</b><button type="button" className="ms3-hud-cancel" disabled={jobs.cancelling} aria-label="停止生成" onClick={() => jobs.cancel()}><i className={`bi ${jobs.cancelling ? "bi-arrow-repeat ms3-spin" : "bi-x-lg"}`} /></button></div>}
        {outputMode === "separate" ? <div className="ms3-turnaround" style={{ "--slots": String(Math.max(1, turnaroundSlots.length)) }}>{turnaroundSlots.map((slot) => {
          const selected = Boolean(slot.entry && jobs.activeOutput === slot.entry.url);
          return <article key={slot.key} className={`ms3-slot${selected ? " is-on" : ""}${slot.entry ? " has-output" : ""}`} aria-label={`${slot.label}参考`}>
            {slot.entry ? <button type="button" className="ms3-slot-frame" aria-label={`查看${slot.label}参考图`} aria-pressed={selected} onClick={() => jobs.setActiveOutput(slot.entry.url)}><AuthenticatedImage className="model-sheet-stage-output" data-studio-output src={slot.entry.displayUrl || slot.entry.url} fallbackSrc={slot.entry.url} alt={selected ? "模型设计" : `${slot.label}视图`} loading="eager" retryCount={2} maxDimension={720} onLoad={() => setLocalError("")} onError={() => setLocalError("结果图加载失败，请选择其他版本或重新生成")} />{slot.status && slot.status !== "done" && <span className={`ms3-slot-state is-${slot.status}`}>{progressStatusLabel(slot.status)}</span>}</button> : <div className="ms3-slot-frame"><span className="ms3-slot-empty"><i className={`bi ${subjectType === "character" ? "bi-person-standing" : "bi-box-seam"}`} /></span>{slot.status && slot.status !== "done" && <span className={`ms3-slot-state is-${slot.status}`}>{progressStatusLabel(slot.status)}</span>}</div>}
            <em>{slot.label}</em>
          </article>;
        })}</div> : <div className="ms3-board"><div className="ms3-spec"><div><span>视角</span><b>{selectedViews.length} 组</b></div><div><span>质量</span><b>{qualityLabel}档 {detail}</b></div><div><span>背景</span><b>{backgroundOptions.find((item) => item.id === background)?.label || "浅灰"}</b></div></div><div className={`ms3-frame${jobs.activeOutput ? " has-output" : ""}`} style={frameStyle}><i className="ms3-ruler is-top" /><i className="ms3-ruler is-left" />
        {jobs.activeOutput ? <AuthenticatedImage className="model-sheet-stage-output" data-studio-output src={activeEntry?.displayUrl || jobs.activeOutput} fallbackSrc={jobs.activeOutput} alt="模型设计" loading="eager" retryCount={2} onLoad={() => setLocalError("")} onError={() => setLocalError("结果图加载失败，请选择其他版本或重新生成")} /> : <div className="ms3-silhouette" style={{ gridTemplateColumns: `repeat(${Math.max(1, silhouetteViews.length)}, 1fr)` }}>{(silhouetteViews.length ? silhouetteViews : ["FRONT","SIDE","BACK"]).map((view) => <div key={view}><i className={`bi ${subjectType === "character" ? "bi-person-standing" : "bi-box-seam"}`} /><span>{view}</span></div>)}</div>}
      </div>{activeGroup?.urls.length > 1 && !jobs.running && <div className="ms3-groupbar" aria-label="同组视图切换">{activeGroup.entries.map((entry, index) => <button key={entry.url} type="button" className={jobs.activeOutput === entry.url ? "is-on" : ""} title={outputLabels[entry.url] || entry.label} onClick={() => jobs.setActiveOutput(entry.url)}><AuthenticatedImage src={entry.previewUrl || entry.url} alt="" maxDimension={160} /><em>{outputLabels[entry.url] || entry.label || index + 1}</em></button>)}<button type="button" className="ms3-group-download" disabled={handoffBusy} onClick={exportModelSheetPack}><PackageCheck size={14} aria-hidden="true" /><em>{handoffBusy ? "打包中" : "交付包"}</em></button></div>}</div>}
      </div>
    </section>
    <aside className="ms3-gallery"><div className="ms3-tabs" role="tablist" aria-label="右侧面板">{[["prompts","bi-journal-text","词库"],["history","bi-clock-history","历史"],["assets","bi-collection","资产"]].map(([id,icon,label]) => <button key={id} type="button" className={panelTab === id ? "is-on" : ""} onClick={() => { setPanelTab(id); if (id === "prompts" && !promptItems.length) void loadPrompts(true); if (id === "assets" && !assetsLoaded) void loadAssets(); }}><i className={`bi ${icon}`} />{label}</button>)}</div>
      {panelTab === "prompts" ? <><div className="ms3-gallery-search"><i className="bi bi-search" /><input value={promptQuery} type="search" placeholder="搜索提示词…" aria-label="搜索提示词" onChange={(event) => setPromptQuery(event.target.value)} /></div><div className="ms3-gallery-body">{promptLoading && !promptItems.length ? <p className="ms3-gallery-note"><i className="bi bi-arrow-repeat ms3-spin" />正在载入词库…</p> : !filteredPrompts.length ? <p className="ms3-gallery-note">提示词库暂时为空<br />管理员分配后会显示在这里</p> : <div className="ms3-prompt-list">{filteredPrompts.map((item) => <button key={item.id} type="button" className="ms3-prompt-item" onClick={() => { setPrompt(String(item.prompt || "")); void recordPromptEngagement(item.id, "use").catch(() => undefined); }}><span className="ms3-prompt-cover">{item.coverUrl || item.imageUrl ? <AuthenticatedImage src={item.coverUrl || item.imageUrl} alt="" maxDimension={320} /> : <i className="bi bi-bounding-box-circles" />}</span><span className="ms3-prompt-copy">{item.title && <strong>{item.title}</strong>}<span>{item.prompt}</span><em><i className="bi bi-stars" />点击填入</em></span></button>)}{promptHasMore && <button type="button" className="ms3-prompt-more" disabled={promptLoading} onClick={() => loadPrompts(false)}><i className="bi bi-chevron-down" />加载更多</button>}</div>}</div></> : panelTab === "assets" ? <><header className="ms3-gallery-head"><strong><i className="bi bi-collection" />我的资产</strong><small>{assetsLoading ? "载入中…" : `${assets.length} 件`}</small><button type="button" title="刷新资产" onClick={loadAssets}><i className="bi bi-arrow-clockwise" /></button></header><div className="ms3-gallery-body">{!assets.length ? <p className="ms3-gallery-note">还没有发布过作品<br />选中一张输出点「发布」，审核通过后会出现在广场</p> : <div className="ms3-gallery-grid">{assets.map((asset) => <div key={asset.id} className="ms3-card is-asset"><div className="ms3-card-pick is-static"><AuthenticatedImage src={asset.coverUrl || asset.resultUrl} alt={asset.title} maxDimension={360} /></div><span className="ms3-asset-status" data-status={asset.status}>{asset.status === "approved" ? "已发布" : asset.status === "rejected" ? "未通过" : "审核中"}</span><span className="ms3-card-tag">{asset.title}</span></div>)}</div>}</div></> : <><header className="ms3-gallery-head"><strong><i className="bi bi-clock-history" />历史记录</strong><small>{jobs.historyLoading ? "载入中…" : `${jobs.entries.length} 张`}</small><button type="button" title="刷新历史" disabled={jobs.historyLoading} onClick={() => jobs.loadHistory()}><i className={`bi bi-arrow-clockwise${jobs.historyLoading ? " ms3-spin" : ""}`} /></button></header><div className="ms3-gallery-search"><i className="bi bi-search" /><input value={galleryQuery} type="search" placeholder="按视角 / 标签筛选…" aria-label="筛选历史输出" onChange={(event) => setGalleryQuery(event.target.value)} /></div><div className="ms3-gallery-body">{jobs.historyLoading && !jobs.entries.length ? <p className="ms3-gallery-note"><i className="bi bi-arrow-repeat ms3-spin" />正在载入历史…</p> : !filteredGroups.length ? <p className="ms3-gallery-note">暂无生成记录</p> : <div className="ms3-gallery-grid">{filteredGroups.map((group) => <div key={group.id} className={`ms3-card${group.urls.includes(jobs.activeOutput) ? " is-on" : ""}${group.urls.length > 1 ? " is-stack" : ""}`}><button type="button" className="ms3-card-pick" aria-pressed={group.urls.includes(jobs.activeOutput)} title="在画布中查看" onClick={() => jobs.setActiveOutput(group.cover)}><AuthenticatedImage src={group.entries[0]?.previewUrl || group.cover} alt="" maxDimension={360} rootMargin="480px 0px" /></button>{group.urls.length > 1 && <span className="ms3-card-count"><i className="bi bi-stack" />{group.urls.length}</span>}<span className="ms3-card-tag">{groupLabel(group)}</span><button type="button" className={`ms3-card-del${pendingDeleteGroup === group.id ? " is-armed" : ""}`} title="删除输出" onClick={() => { if (pendingDeleteGroup !== group.id) { setPendingDeleteGroup(group.id); window.setTimeout(() => setPendingDeleteGroup(""), 3200); } else { void jobs.deleteEntries(group.entries); setPendingDeleteGroup(""); } }}><i className={`bi ${pendingDeleteGroup === group.id ? "bi-question-lg" : "bi-x-lg"}`} /></button></div>)}</div>}{jobs.historyHasMore && <button type="button" className="ms3-prompt-more model-sheet-load-more" disabled={jobs.historyLoading} onClick={jobs.loadMoreHistory}><i className="bi bi-chevron-down" />加载更多</button>}</div></>}
    </aside>
    {maskEditorOpen && <EcommerceMaskEditor sourceUrl={jobs.activeOutput} sourceTitle={outputLabels[jobs.activeOutput] || "涂抹需要修正的区域"} busy={jobs.running} onClose={() => setMaskEditorOpen(false)} onSubmit={async (payload) => { setMaskEditorOpen(false); const group = activeGroup || { id: activeEntry?.groupId, entries: activeEntry ? [activeEntry] : [] }; try { const urls = await jobs.generateMaskedEdit({ sourceUrl: jobs.activeOutput, maskFile: payload.maskFile, prompt: payload.prompt, aspectRatio, quality: qualityLevel, groupId: group.id, groupIndex: group.entries.length }); setOutputLabels((current) => ({ ...current, ...Object.fromEntries(urls.map((url) => [url, `${outputLabels[jobs.activeOutput] || "视图"} 修正`])) })); } catch (caught) { setLocalError(caught?.message || "局部修正失败"); } }} />}
    <SharePublishDialog open={publishOpen} title={prompt.slice(0, 24) || "模型设计"} submitting={submittingShare} light={!isDark} onClose={() => setPublishOpen(false)} onSubmit={async (payload) => { if (!activeEntry?.jobId) return; setSubmittingShare(true); try { await submitShareItem({ jobId: activeEntry.jobId, styleLabel: "模型设定图", ...payload }); notificationService.success("已提交到广场审核，通过后会公开展示"); setPublishOpen(false); setAssetsLoaded(false); } catch (caught) { notificationService.error(caught?.message || "发布失败"); } finally { setSubmittingShare(false); } }} />
    <ConfirmDialog open={jobs.cancelConfirmationRequired} busy={jobs.cancelling} heading="停止接收这次生成结果？" description="任务已经提交给模型服务。停止后不再接收结果，本次积分不会退回。" confirmLabel="仍然停止" busyLabel="正在停止…" icon="bi-stop-circle" light={!isDark} onClose={jobs.dismissCancelConfirmation} onConfirm={() => jobs.cancel({ acknowledgeUpstream: true })} />
    {fullscreenOpen && jobs.activeOutput && <WallevenImagePreview sourceUrl={jobs.activeOutput} displaySourceUrl={activeEntry?.displayUrl || ""} title="模型设计" filename="ultra-model-sheet.png" metadata={{ id: activeEntry?.jobId || jobs.activeOutput, "生成模式": outputMode === "board" ? "设定板" : "独立视图", "画面比例": aspectRatio, "视角数量": `${selectedViews.length} 组` }} gallery={jobs.entries.map((entry) => entry.url)} displaySources={Object.fromEntries(jobs.entries.map((entry) => [entry.url, entry.displayUrl || ""]))} onSelect={jobs.setActiveOutput} onClose={() => setFullscreenOpen(false)} onDownload={() => downloadAuthenticatedMedia(jobs.activeOutput, "ultra-model-sheet.png")} />}
  </main>;
}
