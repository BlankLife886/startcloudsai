import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { useIllustrationColoringJobs } from "../features/illustration-coloring/useIllustrationColoringJobs.js";
import {
  COLORING_BATCH_COUNT_OPTIONS,
  COLORING_COMPRESS_KB_OPTIONS,
  COLORING_FORMAT_OPTIONS,
  COLORING_OUTPUT_ORIENTATION_OPTIONS,
  COLORING_OUTPUT_SIZE_OPTIONS,
  formatBytes,
  readColoringSettings,
  resolveOutputPixelSize,
  writeColoringSettings,
} from "@legacy/services/aiIllustrationColoringState.js";
import {
  isActiveColoringJobStatus,
} from "@legacy/features/ai-illustration-coloring/domain/mapColoringJobToHistory.js";
import { formatColoringErrorText } from "@legacy/features/ai-illustration-coloring/domain/coloringStability.js";
import { fetchRuntimeConfig } from "@legacy/services/runtimeConfig.js";
import { resolveModelPointPricing } from "@legacy/features/ai-shared/modelPointPricing.js";
import { getWallet } from "@legacy/services/meApi.js";
import { downloadAuthenticatedMedia } from "@legacy/services/authenticatedMedia.js";
import { submitShareItem } from "@legacy/services/shareGallery.js";
import notificationService from "@legacy/services/notification.js";
import "@legacy/features/ai-illustration-coloring/styles/illustration-coloring.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@legacy/features/ai-illustration-coloring/components/ColoringLibraryDrawer.vue?react-style";
import "@legacy/features/ai-illustration-coloring/components/ColoringSettingsDialog.vue?react-style";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "./AiIllustrationColoringView.css";

const ACTIVE = new Set(["queued", "running", "waiting_provider"]);
const MAX_REFERENCES = 3;

function featureConfig(config = {}) {
  const raw = config.features?.["ai.illustrationColoring"] || {};
  return raw.config && typeof raw.config === "object"
    ? { ...raw, ...raw.config }
    : raw;
}

function modelOptions(config) {
  const feature = featureConfig(config);
  const models = Array.isArray(feature.publicModels) ? feature.publicModels : [];
  return models.map((item) => {
    const id = String(item.publicModelKey || item.id || "").trim();
    return {
      ...item,
      id,
      label: String(item.label || item.name || id || "未命名模型"),
      // The Vue page bills coloring through creditCost/feature creditCost.
      // pricePoints is display metadata for newer shared selectors, not this guard.
      creditCost: Math.max(0, Number(item.creditCost ?? feature.creditCost ?? 0)),
    };
  }).filter((item) => item.id);
}

function MediaImage({ src, alt = "", className = "", ...props }) {
  const value = String(src || "").trim();
  if (/^(?:data:|blob:|\/sucai\/|\/images\/)/i.test(value)) {
    return <img {...props} className={className} src={value} alt={alt} decoding="async" draggable="false" />;
  }
  return <AuthenticatedImage {...props} className={className} src={value} alt={alt} />;
}

function statusLabel(item = {}) {
  return ({
    queued: "排队中",
    running: "AI 染色中",
    waiting_provider: "等待模型结果",
    completed: "已完成",
    done: "已完成",
    failed: "失败",
    paused: "已暂停",
    cancelled: "已取消",
    canceled: "已取消",
  })[String(item.status || "").toLowerCase()] || "处理中";
}

function historyTime(item = {}) {
  const time = Date.parse(item.createdAt || "") || Number(item.startedAt || 0);
  if (!time) return "";
  const date = new Date(time);
  const now = new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) return `今天 ${hh}:${mm}`;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}

function imageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        bytes: file.size,
        type: file.type,
      });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取这张图片"));
    };
    image.src = url;
  });
}

function orientationFromSize(width, height) {
  if (!width || !height) return "square";
  if (width / height > 1.08) return "landscape";
  if (width / height < 0.92) return "portrait";
  return "square";
}

function ColoringSelect({ value, options, onChange, label, disabled, className = "", icon = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const selected = options.find((item) => item.value === value) || options[0];
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const rect = open ? triggerRef.current?.getBoundingClientRect() : null;
  return <div className={`ratio-select${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
    <button ref={triggerRef} type="button" className="ratio-select__trigger is-compact-text" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span className="ratio-select__value-wrap"><span className="ratio-select__value">{selected?.label || "请选择"}</span></span>
      <i className="ratio-select__chevron bi bi-chevron-down" />
    </button>
    {open && rect && createPortal(<div className="ratio-select__menu is-plain is-compact-text is-compact-menu is-glass-accent opens-down" role="listbox" aria-label={label} style={{ top: rect.bottom + 6, left: rect.left, width: rect.width, maxHeight: Math.min(320, innerHeight - rect.bottom - 18) }} onPointerDown={(event) => event.stopPropagation()}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={`ratio-select__option${option.value === value ? " is-selected" : ""}${icon ? " has-icon" : ""}`} onClick={() => { onChange(option.value); setOpen(false); }}>
        {icon && <i className="ratio-select__option-glyph bi bi-cpu" />}
        <span className="ratio-select__option-content"><span className="ratio-select__option-label">{option.label}</span></span>
        {option.creditCost != null && <small className="coloring-react-model-price">{option.creditCost} 积分/张</small>}
      </button>)}
    </div>, document.body)}
  </div>;
}

function CostConfirmDialog({ cost, light, onCancel, onConfirm }) {
  if (!cost) return null;
  const insufficient = cost.available != null && cost.available < cost.total;
  return createPortal(<div className={`ai-cost-confirm-layer is-elevated${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
    <section className="ai-cost-confirm-panel is-credits" role="dialog" aria-modal="true" aria-labelledby="coloring-cost-title">
      <header className="ai-cost-confirm-head"><span className="ai-cost-confirm-icon"><i className="bi bi-coin" /></span><div className="ai-cost-confirm-titles"><span className="ai-cost-confirm-eyebrow">插画染色</span><h5 id="coloring-cost-title">确认生成费用</h5></div><button type="button" className="ai-cost-confirm-close" aria-label="关闭费用确认" onClick={onCancel}><i className="bi bi-x-lg" /></button></header>
      <p className="ai-cost-confirm-summary">提交后先冻结预计费用，任务完成后按实际生成结果结算。</p>
      <div className="ai-cost-confirm-card"><div className="ai-cost-confirm-total"><div className="ai-cost-confirm-total__copy"><span>本次预计</span><small>{cost.unit} 积分 / 张 × {cost.count} 张</small></div><strong>{cost.total > 0 ? `${cost.total} 积分` : "按实际用量结算"}</strong></div><div className="ai-cost-confirm-balance"><div><span>当前可用</span><strong>{cost.available == null ? "读取中" : `${cost.available} 积分`}</strong></div><i className="bi bi-arrow-right" /><div className={insufficient ? "danger" : ""}><span>支付后余额</span><strong>{cost.available == null ? "待计算" : insufficient ? "余额不足" : `${cost.available - cost.total} 积分`}</strong></div></div></div>
      {!cost.priced && <p className="ai-cost-confirm-warn"><i className="bi bi-info-circle" />暂时读取不到单价，本次费用以服务端结算为准。</p>}
      {insufficient && <p className="ai-cost-confirm-warn is-danger"><i className="bi bi-exclamation-circle" />钱包余额不足，请兑换积分后再提交任务。</p>}
      <footer className="ai-cost-confirm-footer is-no-preference"><div className="ai-cost-confirm-actions"><button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button><button type="button" className="ai-cost-confirm-btn primary" disabled={insufficient} onClick={onConfirm}>确认</button></div></footer>
    </section>
  </div>, document.body);
}

function SettingsDialog({ open, settings, light, onClose, onSave }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => { if (open) setDraft(settings); }, [open, settings]);
  useEffect(() => {
    if (!open) return undefined;
    const keydown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [onClose, open]);
  if (!open) return null;
  const patch = (value) => setDraft((current) => ({ ...current, ...value }));
  return createPortal(<div className={`coloring-settings-layer${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="coloring-settings-panel" role="dialog" aria-modal="true" aria-labelledby="coloring-settings-title">
      <header><div><strong id="coloring-settings-title">染色设置</strong><small>上传处理与历史记录偏好</small></div><button type="button" className="coloring-settings-close" aria-label="关闭" onClick={onClose}><i className="bi bi-x-lg" /></button></header>
      <div className="coloring-settings-body"><section className="coloring-settings-section"><h3><i className="bi bi-cloud-arrow-up" /> 上传</h3><label className="coloring-settings-switch"><input type="checkbox" checked={draft.enableCompress} onChange={(event) => patch({ enableCompress: event.target.checked })} /><span>上传前压缩图片</span></label><div className={`coloring-settings-field${draft.enableCompress ? "" : " disabled"}`}><span>压缩上限</span><div className="coloring-settings-chips">{COLORING_COMPRESS_KB_OPTIONS.map((kb) => <button key={kb} type="button" className={draft.compressMaxKb === kb ? "active" : ""} disabled={!draft.enableCompress} onClick={() => patch({ compressMaxKb: kb })}>{kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}</button>)}</div></div><div className={`coloring-settings-field${draft.enableCompress ? "" : " disabled"}`}><span>压缩后格式</span><div className="coloring-settings-chips">{COLORING_FORMAT_OPTIONS.map((item) => <button key={item.id} type="button" className={draft.inputFormat === item.id ? "active" : ""} disabled={!draft.enableCompress} onClick={() => patch({ inputFormat: item.id })}>{item.label}</button>)}</div><small>{draft.enableCompress ? "超过上限时会先降质量再缩小尺寸，开启压缩可能让出图变糊。" : "关闭后直接上传原文件，不转格式、不降低质量、不缩小尺寸。"}</small></div></section><section className="coloring-settings-section"><h3><i className="bi bi-trash3" /> 历史记录</h3><label className="coloring-settings-switch"><input type="checkbox" checked={draft.confirmBeforeDelete} onChange={(event) => patch({ confirmBeforeDelete: event.target.checked })} /><span>删除历史前需要确认</span></label><small>开启后，删除单次或批量染色记录前会显示确认窗口。</small></section></div>
      <footer><button type="button" className="coloring-settings-secondary" onClick={onClose}>取消</button><button type="button" className="coloring-settings-primary" onClick={() => onSave(draft)}>保存设置</button></footer>
    </section>
  </div>, document.body);
}

function LibraryDrawer({ open, tab, setTab, history, activeId, light, onClose, onSelect, onPrompt }) {
  useEffect(() => {
    if (!open) return undefined;
    const keydown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [onClose, open]);
  if (!open) return null;
  const assets = history.filter((item) => ["completed", "done"].includes(item.status) && item.resultUrl);
  const prompts = [
    { title: "清透日系", prompt: "低饱和粉蓝配色，通透空气感，柔和环境光，保持线稿清晰" },
    { title: "电影暖调", prompt: "琥珀金与深青色对比，电影感光影，材质细节完整" },
    { title: "赛博霓虹", prompt: "紫红与电光蓝霓虹配色，冷暖对比，高质感金属反射" },
  ];
    return createPortal(<div className={`coloring-library-backdrop${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="coloring-library-drawer" role="dialog" aria-modal="true" aria-label="染色资源"><header className="coloring-library-head"><div><strong>染色资源</strong><small>选择结果、任务或配色提示词</small></div><button type="button" aria-label="关闭" onClick={onClose}><i className="bi bi-x-lg" /></button></header><nav className="coloring-library-tabs" role="tablist">{[["assets", "bi-images", "资产库", assets.length], ["history", "bi-clock-history", "历史记录", history.length], ["prompts", "bi-journal-text", "提示词库", null]].map(([id, icon, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><i className={`bi ${icon}`} />{label}{count != null && <em>{count}</em>}</button>)}</nav><div className="coloring-library-body">
    {tab === "assets" && (assets.length ? <div className="coloring-library-grid">{assets.map((item) => <button key={item.id} type="button" className={`coloring-library-card${item.id === activeId ? " active" : ""}`} onClick={() => onSelect(item)}><span className="coloring-library-image"><MediaImage src={item.resultUrl} alt="" /></span><strong>{item.title || "插画染色"}</strong><small>{item.outputOrientation || "原图比例"} · {item.outputSize || "2K"}</small></button>)}</div> : <div className="coloring-library-empty"><i className="bi bi-images" /><strong>还没有染色资产</strong><span>完成的染色结果会自动保存在这里。</span></div>)}
    {tab === "history" && (history.length ? <div className="coloring-library-list">{history.map((item) => <button key={item.id} type="button" className={item.id === activeId ? "active" : ""} onClick={() => onSelect(item)}><span className="coloring-library-list-thumb">{item.resultUrl || item.sourcePreview ? <MediaImage src={item.resultUrl || item.sourcePreview} alt="" /> : <i className="bi bi-palette2" />}</span><span><strong>{item.title || "插画染色"}</strong><small>{statusLabel(item)}</small></span><i className="bi bi-chevron-right" /></button>)}</div> : <div className="coloring-library-empty"><i className="bi bi-clock-history" /><strong>暂无历史记录</strong><span>创建任务后可在这里查看进度和结果。</span></div>)}
    {tab === "prompts" && <div className="coloring-prompt-list">{prompts.map((item) => <button key={item.title} type="button" onClick={() => onPrompt(item)}><span><strong>{item.title}</strong><small>{item.prompt}</small></span><i className="bi bi-plus-circle" /></button>)}</div>}
  </div></aside></div>, document.body);
}

function FrameMedia({ src, alt, fitMode, zoom, pan, onWheel, onPointerDown, onPointerMove, onPointerUp, onLoad, onError }) {
  return <div className={`coloring-frame-body${zoom > 1 || fitMode === "cover" ? " pannable" : ""}`} onWheel={onWheel} onDoubleClick={() => {}} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}><div className={`coloring-frame-matte fit-${fitMode} is-visible`}><div className="coloring-media-transform" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}><MediaImage src={src} alt={alt} loading="eager" style={{ width: fitMode === "cover" ? "100%" : "auto", height: fitMode === "cover" ? "100%" : "auto", maxWidth: fitMode === "cover" ? "none" : "100%", maxHeight: fitMode === "cover" ? "none" : "100%", objectFit: fitMode }} onLoad={onLoad} onError={onError} /></div></div></div>;
}

export function AiIllustrationColoringView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const referenceInput = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const sourceRef = useRef(null);
  const referencesRef = useRef([]);
  const [settings, setSettings] = useState(readColoringSettings);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState(null);
  const [sourceMeta, setSourceMeta] = useState({ width: 0, height: 0, bytes: 0, type: "" });
  const [references, setReferences] = useState([]);
  const [models, setModels] = useState([]);
  const [disabledMessage, setDisabledMessage] = useState("");
  const [compareMode, setCompareMode] = useState("result");
  const [batchGrid, setBatchGrid] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState("assets");
  const [referenceCollapsed, setReferenceCollapsed] = useState(() => localStorage.getItem("walleven.coloring.referencePanelCollapsed") === "1");
  const [cost, setCost] = useState(null);
  const [pendingSubmit, setPendingSubmit] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const jobs = useIllustrationColoringJobs({ authenticated: auth.isAuthenticated });

  useEffect(() => {
    let disposed = false;
    fetchRuntimeConfig().then((config) => {
      if (disposed) return;
      const feature = featureConfig(config);
      const nextModels = modelOptions(config);
      setModels(nextModels);
      setDisabledMessage(feature.enabled === false ? feature.message || "插画染色功能暂未开放" : "");
      setSettings((current) => {
        if (current.publicModelKey || !nextModels[0]) return current;
        const next = { ...current, publicModelKey: nextModels[0].id };
        writeColoringSettings(next);
        return next;
      });
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const fullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", fullscreen);
    return () => document.removeEventListener("fullscreenchange", fullscreen);
  }, []);

  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { referencesRef.current = references; }, [references]);
  useEffect(() => () => {
    const currentSource = sourceRef.current;
    if (currentSource?.owned && currentSource.preview) URL.revokeObjectURL(currentSource.preview);
    referencesRef.current.forEach((item) => item.owned && URL.revokeObjectURL(item.previewUrl));
  }, []);

  const active = jobs.history.find((item) => item.id === jobs.activeId) || null;
  const activeBatch = useMemo(() => {
    if (!active) return [];
    return jobs.history.filter((item) => active.batchId ? item.batchId === active.batchId : item.id === active.id).sort((a, b) => a.variantIndex - b.variantIndex);
  }, [active, jobs.history]);
  const resultUrl = active?.resultUrl || active?.outputs?.[0] || "";
  const loading = Boolean(active && ACTIVE.has(active.status));
  const batchResults = activeBatch.filter((item) => item.resultUrl || item.outputs?.[0]);
  const showBatch = batchGrid && activeBatch.length > 1 && (batchResults.length || loading);
  const sourceUrl = source?.preview || active?.sourcePreview || active?.sourceRemoteUrl || "";
  const effectiveMeta = source?.meta || (active ? { width: active.sourceWidth, height: active.sourceHeight, bytes: active.sourceBytes, type: active.inputType } : sourceMeta);
  const outputPreview = resolveOutputPixelSize(effectiveMeta.width, effectiveMeta.height, settings.outputSize, settings.outputOrientation);
  const selectedModel = models.find((item) => item.id === settings.publicModelKey) || models[0] || null;
  const unitCost = selectedModel?.creditCost || 0;
  const totalCost = unitCost * settings.generationCount;
  const canSubmit = auth.isAuthenticated && !disabledMessage && Boolean(source?.file || source?.remoteUrl || sourceUrl) && !jobs.submitting;
  const split = compareMode === "split" && sourceUrl && resultUrl && !showBatch;
  const stageWidth = resultUrl ? active?.resultWidth || active?.requestedOutputWidth : effectiveMeta.width;
  const stageHeight = resultUrl ? active?.resultHeight || active?.requestedOutputHeight : effectiveMeta.height;
  const frameStyle = { "--frame-aspect": `${Math.max(1, stageWidth || 1)} / ${Math.max(1, stageHeight || 1)}`, "--frame-ratio": String(Math.max(1, stageWidth || 1) / Math.max(1, stageHeight || 1)) };
  const orientation = orientationFromSize(stageWidth, stageHeight);
  const controlsLocked = jobs.submitting;

  useEffect(() => {
    if (!active || source) return;
    setSource({
      preview: active.sourcePreview || active.sourceRemoteUrl,
      remoteUrl: active.sourceRemoteUrl || active.sourcePreview,
      file: null,
      owned: false,
      meta: {
        width: active.sourceWidth,
        height: active.sourceHeight,
        bytes: active.sourceBytes,
        type: active.inputType,
      },
    });
    setSourceMeta({
      width: active.sourceWidth,
      height: active.sourceHeight,
      bytes: active.sourceBytes,
      type: active.inputType,
    });
    setPrompt(active.customPrompt || "");
    if (active.resultUrl && (active.sourcePreview || active.sourceRemoteUrl)) {
      setCompareMode("split");
    }
  }, [active, source]);

  const updateSettings = useCallback((patch) => {
    setSettings((current) => {
      const next = writeColoringSettings({ ...current, ...patch });
      return next;
    });
  }, []);

  const chooseSource = useCallback(async (file) => {
    if (!file?.type?.startsWith("image/")) return;
    try {
      const meta = await imageMeta(file);
      const preview = URL.createObjectURL(file);
      setSource((current) => {
        if (current?.owned) URL.revokeObjectURL(current.preview);
        return { file, preview, meta, owned: true, remoteUrl: "" };
      });
      setSourceMeta(meta);
      jobs.setActiveId("");
      setCompareMode("result");
      setBatchGrid(true);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (error) {
      notificationService.error(error.message);
    }
  }, [jobs]);

  const chooseReferences = useCallback((files) => {
    const available = Math.max(0, MAX_REFERENCES - references.length);
    const next = [...files].filter((file) => file.type.startsWith("image/")).slice(0, available).map((file) => ({ id: crypto.randomUUID(), file, name: file.name, previewUrl: URL.createObjectURL(file), owned: true }));
    setReferences((current) => [...current, ...next]);
  }, [references.length]);

  const selectHistory = useCallback((item) => {
    jobs.setActiveId(item.id);
    setSource({ preview: item.sourcePreview || item.sourceRemoteUrl, remoteUrl: item.sourceRemoteUrl || item.sourcePreview, file: null, owned: false, meta: { width: item.sourceWidth, height: item.sourceHeight, bytes: item.sourceBytes, type: item.inputType } });
    setSourceMeta({ width: item.sourceWidth, height: item.sourceHeight, bytes: item.sourceBytes, type: item.inputType });
    setTitle(item.title || "");
    setPrompt(item.customPrompt || "");
    setReferences((current) => { current.forEach((entry) => entry.owned && URL.revokeObjectURL(entry.previewUrl)); return (item.referenceImageUrls || []).map((url, index) => ({ id: `history-ref-${index}`, previewUrl: url, remoteUrl: url, name: `参考图 ${index + 1}`, owned: false })); });
    updateSettings({ outputSize: item.outputSize || settings.outputSize, outputOrientation: item.outputOrientation || settings.outputOrientation, publicModelKey: item.publicModelKey || settings.publicModelKey });
    setBatchGrid(true);
    setLibraryOpen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [jobs, settings, updateSettings]);

  const executeSubmit = useCallback(async (payload) => {
    setCost(null);
    setPendingSubmit(null);
    try {
      await jobs.createBatch(payload);
    } catch (error) {
      if (error?.name !== "AbortError") notificationService.error(formatColoringErrorText(error?.message || "提交失败"));
    }
  }, [jobs]);

  const startColoring = useCallback(async () => {
    if (!canSubmit) return;
    const payload = {
      sourceFile: source?.file || null,
      sourceUrl: source?.remoteUrl || (!source?.owned ? sourceUrl : ""),
      sourceMeta: effectiveMeta,
      referenceFiles: references.filter((item) => item.file).map((item) => item.file),
      referenceUrls: references.filter((item) => item.remoteUrl).map((item) => item.remoteUrl),
      title: title.trim() || "插画染色",
      customPrompt: prompt.trim(),
      publicModelKey: selectedModel?.id || settings.publicModelKey || "standard",
      outputSize: settings.outputSize,
      outputOrientation: settings.outputOrientation,
      generationCount: settings.generationCount,
      uploadSettings: settings,
    };
    let available = null;
    try {
      const wallet = await getWallet();
      available = Number(wallet?.availablePoints ?? wallet?.balancePoints ?? wallet?.balance ?? wallet?.totalPoints);
      if (!Number.isFinite(available)) available = null;
    } catch { /* service will enforce the balance */ }
    setPendingSubmit(payload);
    setCost({ unit: unitCost, count: settings.generationCount, total: totalCost, available, priced: Boolean(selectedModel && resolveModelPointPricing(selectedModel).configured) });
  }, [canSubmit, effectiveMeta, prompt, references, selectedModel, settings, source, sourceUrl, title, totalCost, unitCost]);

  const removeHistory = useCallback((item) => {
    const items = item.batchId ? jobs.history.filter((entry) => entry.batchId === item.batchId) : [item];
    if (items.some((entry) => isActiveColoringJobStatus(entry.status))) return;
    if (settings.confirmBeforeDelete) setDeleteTarget({ ...item, items });
    else void jobs.remove(items.map((entry) => entry.id));
  }, [jobs, settings.confirmBeforeDelete]);

  const beginNewTask = useCallback(() => {
    jobs.setActiveId("");
    setBatchGrid(true);
    setCompareMode("result");
    setTitle("");
    setPrompt("");
    setSource(null);
    setReferences([]);
  }, [jobs]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await stageRef.current?.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch { setIsFullscreen(Boolean(document.fullscreenElement)); }
  }, []);

  const onWheel = useCallback((event) => {
    event.preventDefault();
    setZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.16 : -0.16))));
  }, []);
  const onPointerDown = useCallback((event) => {
    if (zoom <= 1 && settings.fitMode !== "cover") return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [pan, settings.fitMode, zoom]);
  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    setPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
  }, []);
  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const openLibrary = (tab) => { setLibraryTab(tab); setLibraryOpen(true); };
  const historyGroups = useMemo(() => {
    const groups = new Map();
    jobs.history.forEach((item) => {
      const key = item.batchId || item.id;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    });
    return [...groups.values()].map((items) => {
      const representative = items.find((item) => item.id === jobs.activeId) || items.find((item) => item.resultUrl) || items[0];
      const completed = items.filter((item) => item.resultUrl).length;
      const running = items.filter((item) => ACTIVE.has(item.status)).length;
      return { ...representative, items, active: items.some((item) => item.id === jobs.activeId), running: running > 0, sourceThumb: representative.sourceThumbUrl || representative.sourcePreview, resultThumb: items.find((item) => item.resultUrl)?.resultThumbUrl || items.find((item) => item.resultUrl)?.resultUrl || "", statusLabel: items.length > 1 ? running ? `生成中 ${completed}/${items.length}` : `已完成 ${completed}/${items.length}` : statusLabel(representative) };
    }).slice(0, 6);
  }, [jobs.activeId, jobs.history]);

  return <main className={`coloring-studio-page${isDark ? "" : " is-light"}`}>
    <div className="coloring-studio"><div className="coloring-workspace">
      <aside className="coloring-sidebar"><div className="coloring-side-scroll">
        <section className="coloring-model-engine" aria-label="生成模型"><span className="coloring-model-engine-icon"><i className="bi bi-cpu" /></span><ColoringSelect className="coloring-model-select" value={selectedModel?.id || settings.publicModelKey} options={(models.length ? models : [{ id: settings.publicModelKey || "standard", label: "标准染色模型", creditCost: 0 }]).map((item) => ({ value: item.id, label: item.label, creditCost: item.creditCost }))} onChange={(value) => updateSettings({ publicModelKey: value })} label="生成模型" disabled={controlsLocked} icon /></section>
        {disabledMessage && <div className="coloring-disabled-banner">{disabledMessage}</div>}
        {!auth.isAuthenticated && <div className="coloring-login-card"><div className="coloring-login-mark"><i className="bi bi-person-lock" /></div><div><strong>登录后开始染色</strong><p>上传线稿、描述配色，一键 AI 上色</p></div><button type="button" className="coloring-login-btn" onClick={() => navigate("/auth?mode=login&redirect=%2Fai-illustration-coloring")}>去登录</button></div>}
        <section className="coloring-block coloring-block--title"><input className="coloring-input" value={title} maxLength={80} disabled={controlsLocked} aria-label="作品名称" placeholder="作品名称，例如：赛博机甲头像" onChange={(event) => setTitle(event.target.value)} /></section>
        <section className="coloring-block coloring-block--source"><div className={`coloring-source-card${sourceUrl ? "" : " is-empty"}${uploadDragOver ? " is-dragover" : ""}`} onDragOver={(event) => { event.preventDefault(); setUploadDragOver(true); }} onDragLeave={() => setUploadDragOver(false)} onDrop={(event) => { event.preventDefault(); setUploadDragOver(false); void chooseSource(event.dataTransfer.files[0]); }}>
          {!sourceUrl ? <button type="button" className="coloring-source-main" disabled={controlsLocked} onClick={() => fileInput.current?.click()}><span className="coloring-upload-icon"><i className="bi bi-cloud-arrow-up" /></span><span className="coloring-source-copy"><strong>上传线稿</strong><small>拖拽或点击 · PNG / JPG / WEBP</small></span></button> : <div className="coloring-source-main coloring-source-main--preview"><div className="coloring-source-thumb" data-orientation={orientationFromSize(effectiveMeta.width, effectiveMeta.height)}><MediaImage src={sourceUrl} alt="线稿预览" loading="eager" /></div><div className="coloring-source-copy"><strong>{effectiveMeta.width && effectiveMeta.height ? `${effectiveMeta.width}×${effectiveMeta.height}` : "读取图片信息中…"}</strong><small>{effectiveMeta.bytes ? `${formatBytes(effectiveMeta.bytes)} · ${String(effectiveMeta.type || "").replace("image/", "").toUpperCase()}` : "原始线稿"}</small></div></div>}
          <div className="coloring-source-tools"><button type="button" className="coloring-source-tool" disabled={controlsLocked} title="本地上传" aria-label="本地上传" onClick={() => fileInput.current?.click()}><i className="bi bi-upload" /></button></div>
        </div><input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { void chooseSource(event.target.files?.[0]); event.target.value = ""; }} /></section>
        <section className="coloring-library-launcher" aria-label="染色资源">{[["assets", "bi-images", "资产库"], ["history", "bi-clock-history", "历史记录"], ["prompts", "bi-journal-text", "提示词库"]].map(([id, icon, label]) => <button key={id} type="button" onClick={() => openLibrary(id)}><i className={`bi ${icon}`} /><span>{label}</span></button>)}</section>
        <section className="coloring-block"><header className="coloring-block-head"><span>配色描述</span><small>{prompt.length} 字</small></header><textarea className="coloring-textarea" value={prompt} disabled={controlsLocked} placeholder="描述主色、阴影倾向、材质或氛围，例如：薄荷绿与珊瑚粉，暖色阴影，线稿保持清晰…" onChange={(event) => setPrompt(event.target.value)} /></section>
        <section className="coloring-block coloring-parameter-block"><header className="coloring-block-head"><span>输出设置</span><small>{outputPreview.label}</small></header><div className="coloring-parameter-selectors"><div className="coloring-selector-field is-wide"><span>输出比例</span><ColoringSelect value={settings.outputOrientation} options={COLORING_OUTPUT_ORIENTATION_OPTIONS.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => updateSettings({ outputOrientation: value })} label="输出比例" disabled={controlsLocked} /></div><div className="coloring-selector-field"><span>分辨率</span><ColoringSelect value={settings.outputSize} options={COLORING_OUTPUT_SIZE_OPTIONS.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => updateSettings({ outputSize: value })} label="分辨率" disabled={controlsLocked} /></div><div className="coloring-selector-field"><span>生成张数</span><ColoringSelect value={settings.generationCount} options={COLORING_BATCH_COUNT_OPTIONS.map((value) => ({ value, label: `${value} 张` }))} onChange={(value) => updateSettings({ generationCount: Number(value) })} label="生成张数" disabled={controlsLocked} /></div></div></section>
      </div><div className="coloring-side-footer">{unitCost > 0 && <div className="coloring-footer-meta"><span>本次约消耗</span><strong>{totalCost} 积分</strong></div>}{jobs.history.some((item) => ACTIVE.has(item.status)) && active && <button type="button" className="coloring-secondary-btn coloring-new-task-btn" disabled={jobs.submitting} onClick={beginNewTask}><i className="bi bi-plus-circle" />新建染色任务</button>}<button type="button" className="coloring-primary-btn" disabled={!canSubmit} onClick={startColoring}><i className={`bi ${jobs.submitting ? "bi-arrow-repeat spin" : "bi-palette-fill"}`} />{jobs.submitting ? "正在提交…" : settings.generationCount > 1 ? `开始 AI 染色 · ${settings.generationCount} 张` : "开始 AI 染色"}</button>{active && ["failed", "cancelled", "canceled"].includes(active.status) && <button type="button" className="coloring-retry-btn" disabled={jobs.submitting} onClick={startColoring}><i className="bi bi-arrow-clockwise" />重试失败任务</button>}{active && isActiveColoringJobStatus(active.status) && <button type="button" className="coloring-secondary-btn" disabled={jobs.submitting} onClick={() => jobs.cancel(active)}><i className="bi bi-x-circle" />取消任务</button>}</div></aside>

      <section className="coloring-stage"><div ref={stageRef} className={`coloring-stage-shell${isFullscreen ? " is-fullscreen" : ""}`}>
        <div className="coloring-stage-toolbar"><div className="coloring-stage-toolbar-main"><div className="coloring-view-toggle" aria-label="视图模式"><button type="button" className={compareMode === "result" ? "active" : ""} aria-pressed={compareMode === "result"} onClick={() => setCompareMode("result")}><i className="bi bi-image" /><span>{resultUrl ? "结果" : "预览"}</span></button><button type="button" className={`coloring-compare-toggle${compareMode === "split" ? " active" : ""}${sourceUrl && resultUrl ? " ready" : ""}`} disabled={!sourceUrl || !resultUrl} onClick={() => setCompareMode("split")}><i className="bi bi-layout-split" /><span>对比</span></button></div><div className="coloring-fit-toggle" aria-label="画面适配"><button type="button" className={settings.fitMode === "contain" ? "active" : ""} onClick={() => { updateSettings({ fitMode: "contain" }); setZoom(1); setPan({ x: 0, y: 0 }); }}><i className="bi bi-aspect-ratio" /><span>适配</span></button><button type="button" className={settings.fitMode === "cover" ? "active" : ""} onClick={() => { updateSettings({ fitMode: "cover" }); setZoom(1); setPan({ x: 0, y: 0 }); }}><i className="bi bi-arrows-fullscreen" /><span>铺满</span></button></div></div>
          <div className="coloring-tool-strip">{activeBatch.length > 1 && <button type="button" className={`coloring-tool-btn${batchGrid ? " active" : ""}`} onClick={() => setBatchGrid(true)}><i className="bi bi-grid-3x3-gap" /><span>批量对比</span></button>}<button type="button" className={`coloring-tool-btn${isFullscreen ? " active" : ""}`} title={isFullscreen ? "退出全屏" : "全屏预览"} onClick={toggleFullscreen}><i className={`bi ${isFullscreen ? "bi-fullscreen-exit" : "bi-fullscreen"}`} /><span>{isFullscreen ? "退出" : "全屏"}</span></button><button type="button" className="coloring-tool-btn" disabled={!resultUrl} title="下载结果" onClick={() => downloadAuthenticatedMedia(resultUrl, `${active?.title || "插画染色"}.png`)}><i className="bi bi-download" /><span>下载</span></button><button type="button" className="coloring-tool-btn" disabled={!resultUrl || sharing || active?.shareSubmitted} title="提交到 Share 审核" onClick={() => setShareOpen(true)}><i className="bi bi-send-check" /><span>{active?.shareSubmitted ? "已提交" : "Share"}</span></button><button type="button" className="coloring-tool-btn" disabled={!resultUrl || loading} title="继续二次染色" onClick={() => { setSource({ preview: resultUrl, remoteUrl: resultUrl, file: null, owned: false, meta: { width: active?.resultWidth || active?.requestedOutputWidth, height: active?.resultHeight || active?.requestedOutputHeight, bytes: active?.resultBytes, type: active?.resultType } }); jobs.setActiveId(""); setCompareMode("result"); }}><i className="bi bi-layers" /><span>二次染色</span></button><div className="coloring-tool-meta"><span className={`coloring-status-chip${loading || jobs.submitting ? " running" : ""}`}><i className={`bi ${loading || jobs.submitting ? "bi-arrow-repeat spin" : "bi-magic"}`} />{jobs.submitting ? "正在提交…" : loading ? statusLabel(active) : resultUrl ? "染色完成" : sourceUrl ? "已选线稿，可填写配色描述后开始染色" : "上传线稿后开始"}</span>{unitCost > 0 && <span className="coloring-credit-chip"><i className="bi bi-coin" />{totalCost} 积分</span>}<button type="button" className="coloring-icon-btn" title="设置" onClick={() => setSettingsOpen(true)}><i className="bi bi-gear" /></button></div></div>
        </div>
        <div className="coloring-canvas-area" data-orientation={orientation}><aside className={`coloring-ref-float${referenceCollapsed ? " is-collapsed" : ""}`} aria-label="配色参考图">{referenceCollapsed ? <button type="button" className="coloring-ref-float-chip" title="展开参考图" onClick={() => { setReferenceCollapsed(false); localStorage.setItem("walleven.coloring.referencePanelCollapsed", "0"); }}><i className="bi bi-images" /><span>参考</span><em>{references.length}/{MAX_REFERENCES}</em></button> : <div className="coloring-ref-float-panel"><header className="coloring-ref-float-head"><div className="coloring-ref-float-title"><strong>参考图</strong><small>可选 · {MAX_REFERENCES} 张</small></div><div className="coloring-ref-float-actions">{references.length > 0 && <button type="button" className="coloring-text-btn" onClick={() => setReferences([])}>清空</button>}<button type="button" className="coloring-ref-float-collapse" title="收起参考图" onClick={() => { setReferenceCollapsed(true); localStorage.setItem("walleven.coloring.referencePanelCollapsed", "1"); }}><i className="bi bi-chevron-left" /></button></div></header>{references.length ? <div className="coloring-reference-strip">{references.map((item) => <div key={item.id} className="coloring-reference-card" title={item.name}><AuthenticatedImage src={item.previewUrl || item.remoteUrl} alt="参考图" /><button type="button" className="coloring-reference-remove" title="移除参考图" onClick={() => setReferences((current) => current.filter((entry) => entry.id !== item.id))}><i className="bi bi-x" /></button></div>)}{references.length < MAX_REFERENCES && <button type="button" className="coloring-reference-add" title="添加参考图" onClick={() => referenceInput.current?.click()}><i className="bi bi-plus-lg" /></button>}</div> : <button type="button" className="coloring-reference-empty" onClick={() => referenceInput.current?.click()}><i className="bi bi-images" /><span>添加配色参考图</span></button>}</div>}<input ref={referenceInput} type="file" accept="image/*" multiple hidden onChange={(event) => { chooseReferences(event.target.files || []); event.target.value = ""; }} /></aside>
          {sourceUrl || resultUrl || loading || active?.status === "failed" ? <div className={`coloring-board${split ? " is-split" : " is-single"}${showBatch ? " is-batch-results" : ""} is-${orientation}${settings.fitMode === "cover" ? " is-cover" : ""}`} style={frameStyle}>
            {(split || (!resultUrl && !showBatch)) && <article className="coloring-frame is-source" style={frameStyle}><div className="coloring-frame-chrome"><span className="coloring-frame-badge">原线稿</span><small className="coloring-frame-meta">{effectiveMeta.width && effectiveMeta.height ? `${effectiveMeta.width}×${effectiveMeta.height}` : ""}</small></div><FrameMedia src={sourceUrl} alt="原线稿" fitMode={settings.fitMode} zoom={zoom} pan={pan} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} /></article>}
            {(split || resultUrl || loading || active?.status === "failed") && <article className={`coloring-frame is-result${loading && !resultUrl ? " generating" : ""}${showBatch ? " is-batch" : ""}${active?.status === "failed" ? " failed" : ""}`} style={frameStyle}><div className="coloring-frame-chrome"><span className={`coloring-frame-badge${loading && !resultUrl ? " live" : ""}${active?.status === "failed" ? " failed" : ""}`}>{loading && !resultUrl ? "生成中" : active?.status === "failed" ? "失败" : "染色结果"}</span>{loading && !resultUrl && <small className="coloring-frame-meta">{statusLabel(active)}</small>}</div>
              {showBatch ? <div className="coloring-frame-body coloring-batch-stage"><div className="coloring-batch-head"><div><strong>批量结果对比</strong><small>同一配置生成 {activeBatch.length} 张，完成后可点选查看高清结果</small></div><span>{batchResults.length}/{activeBatch.length}</span></div><div className="coloring-batch-grid" aria-label="批量生成结果横向列表">{activeBatch.map((item) => <button key={item.id} type="button" className={`coloring-batch-card${item.id === jobs.activeId ? " active" : ""}${ACTIVE.has(item.status) ? " running" : ""}${item.resultUrl ? "" : " empty"}`} onClick={() => { selectHistory(item); setBatchGrid(false); }}><>{item.resultUrl ? <AuthenticatedImage src={item.resultUrl} alt={`染色结果 ${item.variantIndex}`} /> : <span className="coloring-batch-placeholder"><i className="bi bi-arrow-repeat spin" /></span>}</><em>#{item.variantIndex}</em><span className="coloring-batch-card-state">{item.resultUrl ? "已完成" : statusLabel(item)}</span></button>)}</div><div className="coloring-batch-status"><strong>已完成 {batchResults.length} / {activeBatch.length}</strong><small>{activeBatch.some((item) => ACTIVE.has(item.status)) ? "仍有图片处理中" : "点击任意结果查看高清图"}</small></div></div> : loading && !resultUrl ? <div className="coloring-frame-body"><div className="coloring-generating"><div className="coloring-gen-backdrop" /><div className="coloring-gen-orb" /><div className="coloring-gen-orbit"><div className="coloring-gen-ring" /><div className="coloring-gen-ring-track" /><span className="coloring-gen-ring-tip" /></div><div className="coloring-gen-brush"><i className="bi bi-brush-fill" /></div><div className="coloring-gen-copy"><strong>{statusLabel(active)}</strong><p>色彩正在铺开，请稍候</p><div className="coloring-gen-dots"><span /><span /><span /></div></div></div></div> : resultUrl ? <div className="coloring-result-stage"><FrameMedia src={resultUrl} alt="染色结果" fitMode={settings.fitMode} zoom={zoom} pan={pan} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onError={() => notificationService.error("结果图片加载失败，请稍后重试")} /></div> : <div className="coloring-frame-body"><div className="coloring-frame-empty is-failed"><i className="bi bi-exclamation-triangle" /><p>{formatColoringErrorText(active?.error || "染色失败")}</p><button type="button" className="coloring-empty-retry" onClick={startColoring}>重试</button></div></div>}
            </article>}
          </div> : <div className="coloring-board-empty coloring-board-empty--action"><div className="coloring-empty-orb" /><strong>上传线稿开始创作</strong><p>竖图、横图都会按比例展示，像画廊一样并排对比</p><button type="button" className="coloring-empty-upload" onClick={() => fileInput.current?.click()}><i className="bi bi-cloud-arrow-up" />选择线稿</button></div>}
          {sourceUrl && !showBatch && <div className={`coloring-canvas-gesture-hint${zoom > 1 || split ? " active" : ""}`}><i className={`bi ${split ? "bi-layout-split" : zoom > 1 ? "bi-arrows-move" : "bi-mouse2"}`} /><span>{split ? "同步缩放 · 拖动对齐查看" : zoom > 1 ? `${Math.round(zoom * 100)}% · 拖动查看` : "滚轮或双击放大"}</span></div>}
        </div>
        {historyGroups.length > 0 && <div className="coloring-history-rail"><div className="coloring-history-track">{historyGroups.slice(0, 5).map((item) => <button key={item.id} type="button" className={`coloring-history-card${item.active ? " active" : ""}${item.running ? " running" : ""}${item.status === "failed" ? " failed" : ""}`} onClick={() => selectHistory(item)}><span className="coloring-history-thumb-pair"><span className="coloring-history-thumb is-source">{item.sourceThumb ? <AuthenticatedImage src={item.sourceThumb} alt="" /> : <i className="bi bi-file-image" />}</span><span className={`coloring-history-thumb is-result${item.resultThumb ? "" : " empty"}`}>{item.resultThumb ? <AuthenticatedImage src={item.resultThumb} alt="" /> : <i className="bi bi-palette2" />}{item.running && <em className="coloring-history-live" />}</span></span><span className="coloring-history-copy"><span className="coloring-history-title">{item.title || "插画染色"}</span><span className="coloring-history-meta">{item.statusLabel}{historyTime(item) ? ` · ${historyTime(item)}` : ""}</span></span><span className={`coloring-history-remove${item.running ? " disabled" : ""}`} title="删除" onClick={(event) => { event.stopPropagation(); removeHistory(item); }}><i className="bi bi-x" /></span></button>)}{jobs.history.length > 5 && <button type="button" className="coloring-history-more" onClick={() => openLibrary("history")}><span className="coloring-history-more-icon"><i className="bi bi-grid" /></span><span className="coloring-history-more-copy"><strong>查看全部</strong><small>浏览历史记录</small></span><span className="coloring-history-more-count">+{jobs.history.length - 5}</span><i className="bi bi-chevron-right coloring-history-more-arrow" /></button>}</div></div>}
      </div></section>
    </div></div>
    <LibraryDrawer open={libraryOpen} tab={libraryTab} setTab={setLibraryTab} history={jobs.history} activeId={jobs.activeId} light={!isDark} onClose={() => setLibraryOpen(false)} onSelect={selectHistory} onPrompt={(item) => { setPrompt(item.prompt); setLibraryOpen(false); }} />
    <SettingsDialog open={settingsOpen} settings={settings} light={!isDark} onClose={() => setSettingsOpen(false)} onSave={(next) => { setSettings(writeColoringSettings(next)); setSettingsOpen(false); }} />
    <CostConfirmDialog cost={cost} light={!isDark} onCancel={() => { setCost(null); setPendingSubmit(null); }} onConfirm={() => pendingSubmit && executeSubmit(pendingSubmit)} />
    {deleteTarget && createPortal(<div className="coloring-confirm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}><section className="coloring-confirm-dialog" role="dialog" aria-modal="true" aria-label="删除历史"><header><span className="coloring-confirm-mark"><i className="bi bi-trash3" /></span><div><strong>删除这条历史？</strong><p>会同时从本地历史存储移除缩略图、原图地址和结果记录。</p></div></header><div className="coloring-confirm-target"><span>{deleteTarget.title || "插画染色"}</span><small>{statusLabel(deleteTarget)}</small></div><footer><button type="button" className="coloring-confirm-secondary" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="coloring-confirm-danger" onClick={() => { void jobs.remove(deleteTarget.items.map((item) => item.id)); setDeleteTarget(null); }}>删除</button></footer></section></div>, document.body)}
    <SharePublishDialog open={shareOpen} title={active?.title || title || "插画染色"} submitting={sharing} light={!isDark} onClose={() => setShareOpen(false)} onSubmit={async (options) => { if (!active?.serverJobId) return; setSharing(true); try { await submitShareItem({ jobId: active.serverJobId, ...options }); notificationService.success("已提交共享审核"); setShareOpen(false); } catch (error) { notificationService.error(error?.message || "提交失败"); } finally { setSharing(false); } }} />
  </main>;
}
