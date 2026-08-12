import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { EcommerceMaskEditor } from "../features/ecommerce/EcommerceMaskEditor.jsx";
import { EcommerceFullscreenPreview } from "../features/ecommerce/EcommerceFullscreenPreview.jsx";
import { useModelSheetJobs } from "../features/model-sheet/useModelSheetJobs.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { uploadAiInputFile } from "@react/legacy-modules/services/aiWallpaper.js";
import { createLocalUpscaledImage } from "@react/legacy-modules/features/ai-wallpaper/services/localImageUpscale.js";
import { withTransparentPngInstruction } from "@react/legacy-modules/features/ai-shared/transparentPng.js";
import { downloadAuthenticatedMedia } from "@react/legacy-modules/services/authenticatedMedia.js";
import { getScopedLocalItem, setScopedLocalItem } from "@react/legacy-modules/services/scopedLocalStorage.js";
import { listPromptLibrary, recordPromptEngagement } from "@react/legacy-modules/services/promptLibrary.js";
import { listMyShareAssets, submitShareItem } from "@react/legacy-modules/services/shareGallery.js";
import { composePendingLaunchPrompt, takePendingPrompt } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/views/ModelSheetStudioView.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "./ModelSheetStudioView.css";

gsap.registerPlugin(useGSAP);

const SETTINGS_KEY = "ultra-model-sheet-studio-v1";
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
const VIEW_EN = { front: "FRONT", side: "SIDE", back: "BACK", "three-quarter": "3/4", detail: "DETAIL", material: "MATERIAL" };
const ASPECT_OPTIONS = ["16:9", "21:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
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
    }))
    .filter((item) => item.id);
}

function SelectPopover({ value, options, label, onChange, model = false, light = false }) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value) || options[0];
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !triggerRef.current?.contains(event.target) && setOpen(false);
    const escape = (event) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const rect = open ? triggerRef.current?.getBoundingClientRect() : null;
  return <div className={`ratio-select ms3-select-pop${open ? " is-open" : ""}${light ? " is-light" : ""}`}>
    <button ref={triggerRef} type="button" className="ratio-select__trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="ratio-select__value-wrap"><span className="ratio-select__value">{selected?.label || selected?.value || "请选择"}</span></span>
      <i className="ratio-select__chevron bi bi-chevron-down" />
    </button>
    {open && rect && createPortal(<div className={`ratio-select__menu${model ? " is-plain has-priced-options" : ""}${light ? " is-light" : ""}`} role="listbox" aria-label={label} style={{ left: Math.min(Math.max(rect.left, 12), innerWidth - Math.max(rect.width, model ? 342 : 184) - 12), bottom: innerHeight - rect.top + 8, width: Math.max(rect.width, model ? 342 : 184), maxHeight: Math.min(360, rect.top - 30) }} onPointerDown={(event) => event.stopPropagation()}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={`ratio-select__option${option.value === value ? " is-selected" : ""}${model ? " has-price" : ""}`} onClick={() => { onChange(option.value); setOpen(false); }}>
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

export function ModelSheetStudioView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const referenceUrlsRef = useRef(new Set());
  const settings = useMemo(() => readJson(SETTINGS_KEY, {}), []);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState("");
  const activeModel = models.find((item) => item.id === modelId) || models[0] || null;
  const jobs = useModelSheetJobs({ model: activeModel, isAuthenticated: auth.isAuthenticated });
  const [referenceItems, setReferenceItems] = useState(() => (Array.isArray(settings.referenceItems) ? settings.referenceItems : []).filter((item) => item?.type === "url" && item.url).slice(0, MAX_REFERENCES));
  const [subjects, setSubjects] = useState(() => (Array.isArray(readJson(SUBJECTS_KEY, [])) ? readJson(SUBJECTS_KEY, []) : []).slice(0, 12));
  const [activeSubjectId, setActiveSubjectId] = useState(String(settings.activeSubjectId || ""));
  const [subjectNameDraft, setSubjectNameDraft] = useState("");
  const [subjectSaveOpen, setSubjectSaveOpen] = useState(false);
  const [subjectSaving, setSubjectSaving] = useState(false);
  const [subjectDeleteArmId, setSubjectDeleteArmId] = useState("");
  const [prompt, setPrompt] = useState(String(settings.prompt || DEFAULT_PROMPT));
  const [subjectType, setSubjectType] = useState(["character", "object"].includes(settings.subjectType) ? settings.subjectType : "character");
  const [fidelity, setFidelity] = useState(["strict", "enhance"].includes(settings.fidelity) ? settings.fidelity : "strict");
  const [aspectRatio, setAspectRatio] = useState(ASPECT_OPTIONS.includes(settings.aspectRatio) ? settings.aspectRatio : "16:9");
  const [detail, setDetail] = useState(Math.min(100, Math.max(40, Number(settings.detail) || 85)));
  const [outputMode, setOutputMode] = useState(["board", "separate"].includes(settings.outputMode) ? settings.outputMode : "board");
  const [boardCount, setBoardCount] = useState([1, 2, 3, 4].includes(Number(settings.boardCount)) ? Number(settings.boardCount) : 1);
  const [background, setBackground] = useState(BACKGROUND_OPTIONS.some((item) => item.id === settings.background) ? settings.background : "gray");
  const [selectedViews, setSelectedViews] = useState(Array.isArray(settings.selectedViews) && settings.selectedViews.length ? settings.selectedViews : ["front", "side", "back", "three-quarter"]);
  const [customViews, setCustomViews] = useState(Array.isArray(settings.customViews) ? settings.customViews.slice(0, 8) : []);
  const [customViewDraft, setCustomViewDraft] = useState("");
  const [customViewInputOpen, setCustomViewInputOpen] = useState(false);
  const [outputLabels, setOutputLabels] = useState(() => readJson(LABELS_KEY, {}));
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
  const [publishOpen, setPublishOpen] = useState(false);
  const [submittingShare, setSubmittingShare] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState("");
  const [retryViews, setRetryViews] = useState([]);
  const [lastBatchGroupId, setLastBatchGroupId] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const allViewOptions = useMemo(() => [...VIEW_OPTIONS, ...customViews.map((view) => ({ ...view, en: view.label, icon: "bi-bookmark-star" }))], [customViews]);
  const referenceFiles = referenceItems.filter((item) => item.type === "file").map((item) => item.file);
  const referenceUrls = referenceItems.filter((item) => item.type === "url").map((item) => item.url);
  const activeSubject = subjects.find((item) => item.id === activeSubjectId) || null;
  const activeEntry = jobs.entries.find((item) => item.url === jobs.activeOutput) || null;
  const qualityLevel = detail >= 75 ? "high" : detail >= 55 ? "medium" : "low";
  const qualityLabel = qualityLevel === "high" ? "高" : qualityLevel === "medium" ? "中" : "低";
  const selectedViewLabels = selectedViews.map((id) => allViewOptions.find((view) => view.id === id)?.label || id).join("、");
  const hasReference = referenceItems.length > 0;
  const subjectLine = hasReference ? "严格以提供的参考图为唯一主体来源。" : "参考图未提供，请完全根据上方文字描述创建主体，并在整套输出中保持该主体一致。";
  const backgroundLine = background === "white" ? "纯白背景" : background === "transparent" ? "透明背景（输出透明 PNG）" : "纯浅灰背景";
  const finalPrompt = withTransparentPngInstruction(`${prompt}\n${subjectLine}\n主体类型：${subjectType === "character" ? "人物/角色" : "物体/产品"}。\n输出视角：${selectedViewLabels}。\n还原策略：${fidelity === "strict" ? "严格忠于参考图，不改变身份和造型" : "保持主体特征并进行专业生产级优化"}。\n细节强度：${detail}/100。\n制作标准：单张完整模型设定板，正交视图比例一致，无遮挡，边缘清晰，中性影棚光，${backgroundLine}，无景深，无文字水印，超高清纹理，适合 3D 建模、雕刻、材质拆解和 LoRA 数据准备。`, background === "transparent");
  const estimatedUnits = outputMode === "board" ? boardCount : Math.max(1, selectedViews.length);
  const unitCost = Math.max(0, Number(activeModel?.creditCost || 0));
  const totalCost = unitCost * estimatedUnits;
  const costPrice = totalCost ? `${totalCost} 积分` : activeModel ? "免费" : "价格待确认";
  const frameStyle = useMemo(() => {
    const [width = 1, height = 1] = aspectRatio.split(":").map(Number);
    return { aspectRatio: `${width} / ${height}`, width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 176px) * ${width / Math.max(1, height)}))` };
  }, [aspectRatio]);
  const silhouetteViews = selectedViews.slice(0, 4).map((id) => VIEW_EN[id] || allViewOptions.find((view) => view.id === id)?.label || id);
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
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
  const filteredPrompts = promptItems.filter((item) => {
    const query = promptQuery.trim().toLowerCase();
    return !query || `${item?.title || ""} ${item?.prompt || ""}`.toLowerCase().includes(query);
  });

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ desktop: "(min-width: 901px)", reduce: "(prefers-reduced-motion: reduce)" }, ({ conditions }) => {
      if (conditions.reduce) return undefined;
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(".ms3-panel", { x: -40, autoAlpha: 0, duration: 0.7 })
        .from(".ms3-stage", { y: 30, autoAlpha: 0, duration: 0.7 }, "-=0.54")
        .from(".ms3-gallery", { x: 40, autoAlpha: 0, duration: 0.7 }, "-=0.58")
        .from(".ms3-panel .ms3-block", { y: 18, autoAlpha: 0, stagger: 0.055, duration: 0.5, clearProps: "transform,opacity,visibility" }, "-=0.48")
        .from(".ms3-frame", { scale: 0.95, autoAlpha: 0, duration: 0.85, ease: "expo.out" }, "-=0.62");
      return undefined;
    });
    return () => media.revert();
  }, { scope: rootRef });

  useEffect(() => {
    if (!jobs.running) { setElapsedSeconds(0); return undefined; }
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [jobs.running]);

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([fetchRuntimeConfig(), jobs.loadHistory()]).then(([config]) => {
      if (!mountedRef.current) return;
      const available = featureModels(config);
      setModels(available);
      setModelId((current) => available.some((item) => item.id === current) ? current : available.find((item) => item.default)?.id || available[0]?.id || "");
      const pending = takePendingPrompt("model_sheet");
      if (pending) {
        const launchPrompt = composePendingLaunchPrompt(pending, 1500);
        if (launchPrompt) setPrompt(launchPrompt);
        const configValue = pending.config || {};
        if (["character", "object"].includes(configValue.skill)) setSubjectType(configValue.skill);
        if (ASPECT_OPTIONS.includes(configValue.ratio)) setAspectRatio(configValue.ratio);
        if ([1, 2, 3, 4].includes(Number(configValue.count))) setBoardCount(Number(configValue.count));
        if (configValue.model && available.some((item) => item.id === configValue.model)) setModelId(configValue.model);
      }
    }).catch(() => undefined);
    return () => {
      mountedRef.current = false;
      referenceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setScopedLocalItem(SETTINGS_KEY, JSON.stringify({
      prompt, subjectType, fidelity, aspectRatio, detail, outputMode, boardCount, background, selectedViews, customViews,
      referenceItems: referenceItems.filter((item) => item.type === "url").map(({ id, type, url }) => ({ id, type, url })),
      activeSubjectId,
    })), 400);
    return () => window.clearTimeout(timer);
  }, [activeSubjectId, aspectRatio, background, boardCount, customViews, detail, fidelity, outputMode, prompt, referenceItems, selectedViews, subjectType]);
  useEffect(() => {
    setScopedLocalItem(LABELS_KEY, JSON.stringify(outputLabels));
  }, [outputLabels]);
  useEffect(() => {
    setScopedLocalItem(SUBJECTS_KEY, JSON.stringify(subjects.slice(0, 12)));
  }, [subjects]);
  useEffect(() => {
    const keydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !jobs.running) { event.preventDefault(); void generate(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const acceptFiles = useCallback((files) => {
    const incoming = Array.from(files || []).filter((file) => /^image\//i.test(file?.type || ""));
    setReferenceItems((current) => {
      const next = [...current];
      incoming.forEach((file) => {
        if (next.length >= MAX_REFERENCES) return;
        const preview = URL.createObjectURL(file);
        referenceUrlsRef.current.add(preview);
        next.push({ id: `ref-${crypto.randomUUID()}`, type: "file", file, preview });
      });
      return next;
    });
    setLocalError("");
  }, []);

  function buildSeparatePrompt(view, chained = false) {
    const sourceLine = chained ? "严格以提供的参考图为唯一主体来源，保持同一人物/物体、同一服装、同一材质。" : subjectLine;
    return withTransparentPngInstruction(`${prompt}\n${sourceLine}\n本次只生成一个独立的「${view.label}」视图，不要拼图、不要分镜、不要在同一画面放多个角度。\n主体类型：${subjectType === "character" ? "人物/角色" : "物体/产品"}。\n还原策略：${fidelity === "strict" ? "严格忠于参考图，不改变身份、造型、比例、服装和材质" : "保持主体身份与关键特征并进行专业生产级优化"}。\n细节强度：${detail}/100。\n制作标准：主体完整、居中、无遮挡，中性影棚光，${backgroundLine}，无景深，无文字水印。必须与同批次其他视图保持同一主体、同一服装、同一材质、同一比例和同一光照。`, background === "transparent");
  }

  async function runSeparateViews(views, { groupId = "", sourceOverride = "" } = {}) {
    const noReference = !referenceFiles.length && !referenceUrls.length && !sourceOverride;
    const result = await jobs.generateBatch({
      items: views.map((view, index) => ({ prompt: buildSeparatePrompt(view, Boolean(sourceOverride) || (noReference && index > 0)), aspectRatio, quality: qualityLevel, transparentPngEnabled: background === "transparent", viewId: view.id, viewLabel: view.label, outputMode: "separate" })),
      files: referenceFiles,
      sourceUrls: [...referenceUrls, sourceOverride].filter(Boolean),
      concurrency: 1,
      chainFirstOutputAsSource: noReference,
      groupId: groupId || crypto.randomUUID(),
    });
    setLastBatchGroupId(result.groupId);
    setRetryViews(result.failures.map((failure) => failure.item).filter(Boolean));
    if (result.outputs.length) setOutputLabels((current) => ({ ...current, ...Object.fromEntries(result.outputs.map((url, index) => [url, views[index]?.label || "独立视图"])) }));
  }

  async function generate() {
    setLocalError("");
    setRetryViews([]);
    if (!selectedViews.length) { setLocalError("请至少选择一个输出视角"); return; }
    if (!hasReference && !prompt.trim()) { setLocalError("请导入参考主体，或在描述中说明要创建的主体"); return; }
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
    if (result.outputs.length) setOutputLabels((current) => ({ ...current, ...Object.fromEntries(result.outputs.map((url) => [url, "设定板"])) }));
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

  const generateLabel = jobs.running ? "渲染中…" : outputMode === "board" ? boardCount > 1 ? `生成 ${boardCount} 个方案` : "生成设定板" : `生成 ${selectedViews.length} 张视图`;
  const groupLabel = (group) => group.urls.length > 1 ? `${outputLabels[group.cover] || group.entries[0]?.label || "设定板"} 等 ${group.urls.length} 张` : outputLabels[group.cover] || group.entries[0]?.label || "设定板";

  return <main ref={rootRef} className={`ms3${isDark ? "" : " is-light"}`}>
    <h1 className="ms3-visually-hidden">模型设计</h1>
    <aside className="ms3-panel">
      <div className="ms3-panel-scroll">
        <section className="ms3-block">
          <div className="ms3-block-head"><span>参考主体</span><em>{referenceItems.length ? `${referenceItems.length}/${MAX_REFERENCES} 张` : "可选"}</em></div>
          {referenceItems.length ? <div className="ms3-ref-grid" onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); acceptFiles(event.dataTransfer.files); }}>
            {referenceItems.map((item, index) => <div key={item.id} className="ms3-ref-slot"><MediaImage src={item.type === "url" ? item.url : item.preview} alt="参考主体" maxDimension={240} loading="eager" />{index === 0 && <span className="ms3-ref-primary">主</span>}<button type="button" className="ms3-source-del" title="移除这张参考" onClick={() => setReferenceItems((current) => current.filter((entry) => entry.id !== item.id))}><i className="bi bi-x-lg" /></button></div>)}
            {referenceItems.length < MAX_REFERENCES && <button type="button" className={`ms3-ref-add${dragOver ? " is-over" : ""}`} title="再添加一张参考图（正面照 / 侧面照 / 材质细节）" onClick={() => fileInputRef.current?.click()}><i className="bi bi-plus-lg" /></button>}
          </div> : <button type="button" className={`ms3-upload${dragOver ? " is-over" : ""}`} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); acceptFiles(event.dataTransfer.files); }}><i className="bi bi-image" /><strong>添加参考图</strong><small>最多 {MAX_REFERENCES} 张</small></button>}
          <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { acceptFiles(event.target.files); event.target.value = ""; }} />
          <div className="ms3-subjects">
            <div className="ms3-subjects-head"><span><i className="bi bi-person-badge" />主体档案</span>{!subjectSaveOpen && <button type="button" disabled={!hasReference && !jobs.activeOutput} onClick={() => setSubjectSaveOpen(true)}><i className="bi bi-plus-lg" />存档</button>}</div>
            {subjectSaveOpen && <div className="ms3-subject-save"><input value={subjectNameDraft} maxLength={16} placeholder="档案名（如：星轨机械师）" aria-label="主体档案名称" onChange={(event) => setSubjectNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSubject(); if (event.key === "Escape") setSubjectSaveOpen(false); }} /><button type="button" disabled={!subjectNameDraft.trim() || subjectSaving} onClick={saveSubject}>{subjectSaving ? "保存中…" : "保存"}</button><button type="button" className="is-ghost" onClick={() => setSubjectSaveOpen(false)}>取消</button></div>}
            {!subjects.length && !subjectSaveOpen ? <p className="ms3-subjects-empty">还没有档案：导入参考图或生成后点「存档」，同一角色可反复出图</p> : <div className="ms3-subject-row">{subjects.map((subject) => <button key={subject.id} type="button" className={`ms3-subject-card${subject.id === activeSubjectId ? " is-on" : ""}`} title={`使用主体「${subject.name}」`} onClick={() => { setReferenceItems([{ id: `ref-${crypto.randomUUID()}`, type: "url", url: subject.url }]); if (subject.description) setPrompt(subject.description); setActiveSubjectId(subject.id); }}><AuthenticatedImage src={subject.url} alt="" maxDimension={120} /><span>{subject.name}</span><b role="button" tabIndex={0} className={subjectDeleteArmId === subject.id ? "is-armed" : ""} title="删除档案" onClick={(event) => { event.stopPropagation(); if (subjectDeleteArmId !== subject.id) { setSubjectDeleteArmId(subject.id); window.setTimeout(() => setSubjectDeleteArmId(""), 3200); } else { setSubjects((current) => current.filter((item) => item.id !== subject.id)); setSubjectDeleteArmId(""); } }}><i className={`bi ${subjectDeleteArmId === subject.id ? "bi-question-lg" : "bi-x"}`} /></b></button>)}</div>}
            {activeSubject && jobs.activeOutput && <button type="button" className="ms3-subject-update" onClick={() => { setSubjects((current) => current.map((item) => item.id === activeSubject.id ? { ...item, url: jobs.activeOutput } : item)); notificationService.success(`已把当前图设为「${activeSubject.name}」的标准参考`); }}><i className="bi bi-bookmark-check" />设当前图为「{activeSubject.name}」标准参考</button>}
          </div>
        </section>
        <section className="ms3-block"><div className="ms3-block-head"><span>主体描述</span><em>{prompt.length}/1500</em></div><textarea className="ms3-textarea" rows={4} maxLength={1500} placeholder="描述主体与制作要求…" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="ms3-chips">{BRIEF_EXAMPLES.map((example) => <button key={example.label} type="button" onClick={() => setPrompt(`${example.text}。保留主体的身份、比例、材质和结构特征，制作可供建模与生产使用的超高清标准模型参考图。`)}>{example.label}</button>)}</div></section>
        <section className="ms3-block"><div className="ms3-block-head"><span>输出方式</span></div><div className="ms3-seg"><button type="button" className={outputMode === "board" ? "is-on" : ""} onClick={() => setOutputMode("board")}>单张设定板</button><button type="button" className={outputMode === "separate" ? "is-on" : ""} onClick={() => setOutputMode("separate")}>多张独立视图</button></div>{outputMode === "board" ? <div className="ms3-row"><span>方案数量</span><div className="ms3-seg is-mini">{[1,2,3,4].map((count) => <button key={count} type="button" className={boardCount === count ? "is-on" : ""} onClick={() => setBoardCount(count)}>{count}</button>)}</div></div> : <p className="ms3-note">每个视角单独出图，共 {selectedViews.length} 张，自动保持同一主体</p>}</section>
        <section className="ms3-block"><div className="ms3-block-head"><span>输出视角</span><em>{selectedViews.length}/6</em></div><div className="ms3-views">{allViewOptions.map((view) => <button key={view.id} type="button" className={`ms3-view-chip${selectedViews.includes(view.id) ? " is-on" : ""}`} aria-pressed={selectedViews.includes(view.id)} onClick={() => setSelectedViews((current) => current.includes(view.id) ? current.filter((id) => id !== view.id) : [...current, view.id])}><i className={`bi ${view.icon}`} /><span>{view.label}</span>{view.id.startsWith("custom-") && <b role="button" tabIndex={0} title="删除自定义视角" onClick={(event) => { event.stopPropagation(); setCustomViews((current) => current.filter((item) => item.id !== view.id)); setSelectedViews((current) => current.filter((id) => id !== view.id)); }}><i className="bi bi-x" /></b>}</button>)}{!customViewInputOpen && customViews.length < 8 && <button type="button" className="ms3-view-add" onClick={() => setCustomViewInputOpen(true)}><i className="bi bi-plus-lg" /><span>自定义</span></button>}</div>{customViewInputOpen && <div className="ms3-view-input"><input value={customViewDraft} maxLength={12} placeholder="如：俯视 / 战斗姿态" aria-label="自定义视角名称" onChange={(event) => setCustomViewDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && customViewDraft.trim()) { const view = { id: `custom-${crypto.randomUUID()}`, label: customViewDraft.trim() }; setCustomViews((current) => [...current, view]); setSelectedViews((current) => [...current, view.id]); setCustomViewDraft(""); setCustomViewInputOpen(false); } if (event.key === "Escape") setCustomViewInputOpen(false); }} /><button type="button" disabled={!customViewDraft.trim()} onClick={() => { const view = { id: `custom-${crypto.randomUUID()}`, label: customViewDraft.trim() }; setCustomViews((current) => [...current, view]); setSelectedViews((current) => [...current, view.id]); setCustomViewDraft(""); setCustomViewInputOpen(false); }}>添加</button><button type="button" className="is-ghost" onClick={() => setCustomViewInputOpen(false)}>取消</button></div>}</section>
        <section className="ms3-block">
          <div className="ms3-row"><span>主体类型</span><div className="ms3-seg is-mini"><button type="button" className={subjectType === "character" ? "is-on" : ""} onClick={() => setSubjectType("character")}>人物</button><button type="button" className={subjectType === "object" ? "is-on" : ""} onClick={() => setSubjectType("object")}>物体</button></div></div>
          <div className="ms3-row"><span>输出比例</span><SelectPopover value={aspectRatio} options={ASPECT_OPTIONS.map((value) => ({ value, label: value }))} label="输出比例" onChange={setAspectRatio} light={!isDark} /></div>
          <div className="ms3-row"><span>背景</span><div className="ms3-seg is-mini">{BACKGROUND_OPTIONS.map((item) => <button key={item.id} type="button" className={background === item.id ? "is-on" : ""} onClick={() => setBackground(item.id)}>{item.label}</button>)}</div></div>
          <div className="ms3-row"><span>还原策略</span><div className="ms3-seg is-mini"><button type="button" className={fidelity === "strict" ? "is-on" : ""} onClick={() => setFidelity("strict")}>严格</button><button type="button" className={fidelity === "enhance" ? "is-on" : ""} onClick={() => setFidelity("enhance")}>优化</button></div></div>
          <div className="ms3-row is-slider"><span>细节强度</span><em>{detail} · {qualityLabel}档</em><input value={detail} type="range" min="40" max="100" aria-label="细节强度" onChange={(event) => setDetail(Number(event.target.value))} /></div>
          <div className="ms3-row"><span>生成模型</span><SelectPopover value={modelId} options={models.map((item) => ({ value: item.id, label: item.label, creditCost: item.creditCost }))} label="生成模型" onChange={setModelId} model light={!isDark} /></div>
        </section>
        <details className="ms3-prompt-preview" open={promptPreviewOpen}><summary onClick={(event) => { event.preventDefault(); setPromptPreviewOpen((value) => !value); }}><i className="bi bi-braces" />查看将要发送的完整提示词<i className={`bi bi-chevron-down${promptPreviewOpen ? " is-open" : ""}`} /></summary><pre>{outputMode === "board" ? finalPrompt : `独立视图模式：每个视角单独发送一条提示词。\n${buildSeparatePrompt(allViewOptions.find((view) => view.id === selectedViews[0]) || VIEW_OPTIONS[0])}`}</pre></details>
      </div>
      <footer className="ms3-panel-footer"><button className="ms3-generate" type="button" disabled={jobs.running} aria-label={`${generateLabel}，${costPrice}`} onClick={generate}><span className="ms3-generate-icon"><i className={`bi ${jobs.running ? "bi-arrow-repeat ms3-spin" : "bi-stars"}`} /></span><span className="ms3-generate-copy"><strong>{generateLabel}</strong><small><i className="bi bi-stopwatch" />约 1-2 分钟 / 张</small></span><span className="ms3-generate-price"><small>预计扣费</small><strong>{costPrice}</strong>{estimatedUnits > 1 && unitCost > 0 && <em>{unitCost} 积分 / 张 × {estimatedUnits}</em>}</span></button>{jobs.running && <button type="button" className="ms3-cancel-inline" disabled={jobs.cancelling} onClick={jobs.cancel}>{jobs.cancelling ? "等待已开始任务…" : "停止后续生成"}</button>}</footer>
    </aside>
    <section className="ms3-stage">
      <header className="ms3-stage-bar"><div className="ms3-stage-meta"><strong>模型设计</strong><span className="ms3-tag">{outputMode === "board" ? "设定板" : "独立视图"}</span><span className="ms3-tag">{aspectRatio}</span><span className="ms3-tag is-accent">NO.{String(jobs.activeOutput ? Math.max(0, jobs.entries.findIndex((entry) => entry.url === jobs.activeOutput)) + 1 : 0).padStart(3, "0")}</span></div><div className="ms3-stage-actions">
        <button type="button" disabled={!jobs.activeOutput || jobs.running} title="以当前结果作为参考主体继续生成" onClick={() => { if (!referenceItems.some((item) => item.type === "url" && item.url === jobs.activeOutput) && referenceItems.length < MAX_REFERENCES) setReferenceItems((current) => [...current, { id: `ref-${crypto.randomUUID()}`, type: "url", url: jobs.activeOutput }]); }}><i className="bi bi-pin-angle" /><span>用作参考</span></button>
        <button type="button" disabled={!jobs.activeOutput || jobs.running} title="涂抹修正当前图的局部（其余保持不变）" onClick={() => setMaskEditorOpen(true)}><i className="bi bi-bandaid" /><span>修正</span></button>
        <div className={`ms3-enhance${enhanceMenuOpen ? " is-open" : ""}`}><button type="button" disabled={!jobs.activeOutput || enhanceBusy} title="本地高清增强导出（不调用模型）" onClick={() => setEnhanceMenuOpen((value) => !value)}><i className={`bi ${enhanceBusy ? "bi-arrow-repeat ms3-spin" : "bi-badge-hd"}`} /><span>{enhanceBusy ? `${enhanceProgress}%` : "增强"}</span></button>{enhanceMenuOpen && <div className="ms3-enhance-menu" role="menu" aria-label="高清增强档位">{["2K","4K","8K"].map((scale) => <button key={scale} type="button" role="menuitem" onClick={() => enhanceDownload(scale)}>{scale}<small>{scale === "2K" ? "快速" : scale === "4K" ? "高清" : "极致"}</small></button>)}</div>}</div>
        <button type="button" disabled={!jobs.activeOutput} title="全屏查看" onClick={() => setFullscreenOpen(true)}><i className="bi bi-arrows-fullscreen" /><span>大图</span></button><button type="button" disabled={!activeEntry?.jobId} title="发布到广场" onClick={() => setPublishOpen(true)}><i className="bi bi-broadcast" /><span>发布</span></button><button type="button" disabled={!jobs.activeOutput} title="下载当前模型图" onClick={() => downloadAuthenticatedMedia(jobs.activeOutput, `ultra-model-sheet-${Date.now()}.png`)}><i className="bi bi-download" /><span>下载</span></button>
      </div></header>
      {(localError || jobs.error) && <p className="ms3-error" role="alert"><i className="bi bi-exclamation-triangle" /><span>{localError || jobs.error}</span>{retryViews.length > 0 && !jobs.running && <button type="button" className="ms3-retry" onClick={() => runSeparateViews(retryViews, { groupId: lastBatchGroupId, sourceOverride: hasReference ? "" : jobs.activeOutput })}><i className="bi bi-arrow-clockwise" />重试失败视图（{retryViews.length}）</button>}</p>}
      <div className="ms3-viewport"><div className="ms3-spec"><div><span>视角</span><b>{selectedViews.length} 组</b></div><div><span>质量</span><b>{qualityLabel}档 {detail}</b></div><div><span>背景</span><b>{BACKGROUND_OPTIONS.find((item) => item.id === background)?.label}</b></div></div><div className={`ms3-frame${jobs.activeOutput ? " has-output" : ""}`} style={frameStyle}><i className="ms3-ruler is-top" /><i className="ms3-ruler is-left" />
        {jobs.activeOutput ? <AuthenticatedImage className="model-sheet-stage-output" data-studio-output src={jobs.activeOutput} alt="模型设计" loading="eager" retryCount={2} onError={() => setLocalError("结果图加载失败，请选择其他版本或重新生成")} /> : <div className="ms3-silhouette" style={{ gridTemplateColumns: `repeat(${Math.max(1, silhouetteViews.length)}, 1fr)` }}>{(silhouetteViews.length ? silhouetteViews : ["FRONT","SIDE","BACK"]).map((view) => <div key={view}><i className={`bi ${subjectType === "character" ? "bi-person-standing" : "bi-box-seam"}`} /><span>{view}</span></div>)}</div>}
        {jobs.running && <div className="ms3-rendering" aria-live="polite"><span className="ms3-flash" /><i className="ms3-beam is-h" /><i className="ms3-beam is-v" /><div className="ms3-hud"><div className="ms3-render-bar"><i /></div><div className="ms3-hud-left"><span className="ms3-render-dot" /><strong className="ms3-render-phase">锁定 LOCK</strong><em className="ms3-hud-status">{jobs.status || "正在建立模型参考板…"}</em></div>{jobs.batchProgress.length > 1 && <div className="ms3-hud-chips">{jobs.batchProgress.map((entry, index) => <span key={index} className={`ms3-hud-chip is-${entry.status}`} title={`${entry.label} · ${entry.status}`}><i className={`bi ${entry.status === "done" ? "bi-check-lg" : entry.status === "failed" ? "bi-x-lg" : entry.status === "running" ? "bi-arrow-repeat ms3-spin" : "bi-circle"}`} />{entry.label}</span>)}</div>}<div className="ms3-hud-right">{jobs.batchProgress.length > 1 && <span className="ms3-render-count">{batchDoneCount}/{jobs.batchProgress.length}</span>}<b className="ms3-render-timer">{elapsedLabel}</b><button type="button" className="ms3-hud-cancel" disabled={jobs.cancelling} aria-label="停止后续生成" onClick={jobs.cancel}><i className={`bi ${jobs.cancelling ? "bi-arrow-repeat ms3-spin" : "bi-x-lg"}`} /></button></div></div></div>}
      </div>{activeGroup?.urls.length > 1 && !jobs.running && <div className="ms3-groupbar" aria-label="同组视图切换">{activeGroup.entries.map((entry, index) => <button key={entry.url} type="button" className={jobs.activeOutput === entry.url ? "is-on" : ""} title={outputLabels[entry.url] || entry.label} onClick={() => jobs.setActiveOutput(entry.url)}><AuthenticatedImage src={entry.previewUrl || entry.url} alt="" maxDimension={160} /><em>{outputLabels[entry.url] || entry.label || index + 1}</em></button>)}<button type="button" className="ms3-group-download" onClick={async () => { for (const [index, entry] of activeGroup.entries.entries()) await downloadAuthenticatedMedia(entry.url, `ultra-model-sheet-${index + 1}.png`); }}><i className="bi bi-download" /><em>整组</em></button></div>}</div>
    </section>
    <aside className="ms3-gallery"><div className="ms3-tabs" role="tablist" aria-label="右侧面板">{[["prompts","bi-journal-text","词库"],["history","bi-clock-history","历史"],["assets","bi-collection","资产"]].map(([id,icon,label]) => <button key={id} type="button" className={panelTab === id ? "is-on" : ""} onClick={() => { setPanelTab(id); if (id === "prompts" && !promptItems.length) void loadPrompts(true); if (id === "assets" && !assetsLoaded) void loadAssets(); }}><i className={`bi ${icon}`} />{label}</button>)}</div>
      {panelTab === "prompts" ? <><div className="ms3-gallery-search"><i className="bi bi-search" /><input value={promptQuery} type="search" placeholder="搜索提示词…" aria-label="搜索提示词" onChange={(event) => setPromptQuery(event.target.value)} /></div><div className="ms3-gallery-body">{promptLoading && !promptItems.length ? <p className="ms3-gallery-note"><i className="bi bi-arrow-repeat ms3-spin" />正在载入词库…</p> : !filteredPrompts.length ? <p className="ms3-gallery-note">提示词库暂时为空<br />管理员分配后会显示在这里</p> : <div className="ms3-prompt-list">{filteredPrompts.map((item) => <button key={item.id} type="button" className="ms3-prompt-item" onClick={() => { setPrompt(String(item.prompt || "")); void recordPromptEngagement(item.id, "use").catch(() => undefined); }}><span className="ms3-prompt-cover">{item.coverUrl || item.imageUrl ? <AuthenticatedImage src={item.coverUrl || item.imageUrl} alt="" maxDimension={320} /> : <i className="bi bi-bounding-box-circles" />}</span><span className="ms3-prompt-copy">{item.title && <strong>{item.title}</strong>}<span>{item.prompt}</span><em><i className="bi bi-stars" />点击填入</em></span></button>)}{promptHasMore && <button type="button" className="ms3-prompt-more" disabled={promptLoading} onClick={() => loadPrompts(false)}><i className="bi bi-chevron-down" />加载更多</button>}</div>}</div></> : panelTab === "assets" ? <><header className="ms3-gallery-head"><strong><i className="bi bi-collection" />我的资产</strong><small>{assetsLoading ? "载入中…" : `${assets.length} 件`}</small><button type="button" title="刷新资产" onClick={loadAssets}><i className="bi bi-arrow-clockwise" /></button></header><div className="ms3-gallery-body">{!assets.length ? <p className="ms3-gallery-note">还没有发布过作品<br />选中一张输出点「发布」，审核通过后会出现在广场</p> : <div className="ms3-gallery-grid">{assets.map((asset) => <div key={asset.id} className="ms3-card is-asset"><div className="ms3-card-pick is-static"><AuthenticatedImage src={asset.coverUrl || asset.resultUrl} alt={asset.title} maxDimension={360} /></div><span className="ms3-asset-status" data-status={asset.status}>{asset.status === "approved" ? "已发布" : asset.status === "rejected" ? "未通过" : "审核中"}</span><span className="ms3-card-tag">{asset.title}</span></div>)}</div>}</div></> : <><header className="ms3-gallery-head"><strong><i className="bi bi-clock-history" />历史记录</strong><small>{jobs.historyLoading ? "载入中…" : `${jobs.entries.length} 张`}</small><button type="button" title="刷新历史" disabled={jobs.historyLoading} onClick={() => jobs.loadHistory()}><i className={`bi bi-arrow-clockwise${jobs.historyLoading ? " ms3-spin" : ""}`} /></button></header><div className="ms3-gallery-search"><i className="bi bi-search" /><input value={galleryQuery} type="search" placeholder="按视角 / 标签筛选…" aria-label="筛选历史输出" onChange={(event) => setGalleryQuery(event.target.value)} /></div><div className="ms3-gallery-body">{jobs.historyLoading && !jobs.entries.length ? <p className="ms3-gallery-note"><i className="bi bi-arrow-repeat ms3-spin" />正在载入历史…</p> : !filteredGroups.length ? <p className="ms3-gallery-note">暂无生成记录</p> : <div className="ms3-gallery-grid">{filteredGroups.map((group) => <div key={group.id} className={`ms3-card${group.urls.includes(jobs.activeOutput) ? " is-on" : ""}${group.urls.length > 1 ? " is-stack" : ""}`}><button type="button" className="ms3-card-pick" aria-pressed={group.urls.includes(jobs.activeOutput)} title="在画布中查看" onClick={() => jobs.setActiveOutput(group.cover)}><AuthenticatedImage src={group.entries[0]?.previewUrl || group.cover} alt="" maxDimension={360} rootMargin="480px 0px" /></button>{group.urls.length > 1 && <span className="ms3-card-count"><i className="bi bi-stack" />{group.urls.length}</span>}<span className="ms3-card-tag">{groupLabel(group)}</span><button type="button" className={`ms3-card-del${pendingDeleteGroup === group.id ? " is-armed" : ""}`} title="删除输出" onClick={() => { if (pendingDeleteGroup !== group.id) { setPendingDeleteGroup(group.id); window.setTimeout(() => setPendingDeleteGroup(""), 3200); } else { void jobs.deleteEntries(group.entries); setPendingDeleteGroup(""); } }}><i className={`bi ${pendingDeleteGroup === group.id ? "bi-question-lg" : "bi-x-lg"}`} /></button></div>)}</div>}{jobs.historyHasMore && <button type="button" className="ms3-prompt-more model-sheet-load-more" disabled={jobs.historyLoading} onClick={jobs.loadMoreHistory}><i className="bi bi-chevron-down" />加载更多</button>}</div></>}
    </aside>
    {maskEditorOpen && <EcommerceMaskEditor sourceUrl={jobs.activeOutput} sourceTitle={outputLabels[jobs.activeOutput] || "涂抹需要修正的区域"} busy={jobs.running} onClose={() => setMaskEditorOpen(false)} onSubmit={async (payload) => { setMaskEditorOpen(false); const group = activeGroup || { id: activeEntry?.groupId, entries: activeEntry ? [activeEntry] : [] }; try { const urls = await jobs.generateMaskedEdit({ sourceUrl: jobs.activeOutput, maskFile: payload.maskFile, prompt: payload.prompt, aspectRatio, quality: qualityLevel, groupId: group.id, groupIndex: group.entries.length }); setOutputLabels((current) => ({ ...current, ...Object.fromEntries(urls.map((url) => [url, `${outputLabels[jobs.activeOutput] || "视图"} 修正`])) })); } catch (caught) { setLocalError(caught?.message || "局部修正失败"); } }} />}
    <SharePublishDialog open={publishOpen} title={prompt.slice(0, 24) || "模型设计"} submitting={submittingShare} light={!isDark} onClose={() => setPublishOpen(false)} onSubmit={async (payload) => { if (!activeEntry?.jobId) return; setSubmittingShare(true); try { await submitShareItem({ jobId: activeEntry.jobId, styleLabel: "模型设定图", ...payload }); notificationService.success("已提交到广场审核，通过后会公开展示"); setPublishOpen(false); setAssetsLoaded(false); } catch (caught) { notificationService.error(caught?.message || "发布失败"); } finally { setSubmittingShare(false); } }} />
    {fullscreenOpen && jobs.activeOutput && <EcommerceFullscreenPreview sourceUrl={jobs.activeOutput} title="模型设计" gallery={jobs.entries.map((entry) => entry.url)} onSelect={jobs.setActiveOutput} onClose={() => setFullscreenOpen(false)} onDownload={() => downloadAuthenticatedMedia(jobs.activeOutput, "ultra-model-sheet.png")} />}
  </main>;
}
