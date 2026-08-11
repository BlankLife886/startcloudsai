import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { EcommerceFullscreenPreview } from "../features/ecommerce/EcommerceFullscreenPreview.jsx";
import { WireframeTerrainBackground } from "../features/game-art/WireframeTerrainBackground.jsx";
import { useGameArtJobs } from "../features/game-art/useGameArtJobs.js";
import {
  ASSET_TYPES,
  STYLE_OPTIONS,
  DEFAULT_POSITIVE,
  DEFAULT_NEGATIVE,
  POSITIVE_CONSTRAINT_PRESETS,
  NEGATIVE_CONSTRAINT_PRESETS,
  CLARITY_OPTIONS,
  REFERENCE_CONSTRAINT_OPTIONS,
  STUDIO_BACKGROUND_OPTIONS,
} from "@legacy/views/GameArtStudioView.vue?react-game-art-constants";
import { fetchRuntimeConfig } from "@legacy/services/runtimeConfig.js";
import { withTransparentPngInstruction } from "@legacy/features/ai-shared/transparentPng.js";
import { downloadAuthenticatedMedia } from "@legacy/services/authenticatedMedia.js";
import { getScopedLocalItem, setScopedLocalItem } from "@legacy/services/scopedLocalStorage.js";
import { listPromptLibrary, recordPromptEngagement } from "@legacy/services/promptLibrary.js";
import { listMyShareAssets, submitShareItem } from "@legacy/services/shareGallery.js";
import { composePendingLaunchPrompt, takePendingPrompt } from "@legacy/features/creator-hub/studioTools.js";
import notificationService from "@legacy/services/notification.js";
import "@legacy/views/GameArtStudioView.vue?react-style";
import "@legacy/features/creative-studios/ClockFilmstrip.vue?react-style";
import "@legacy/features/ai-shared/ModelPointPrice.vue?react-style";
import "@legacy/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue?react-style";
import "./GameArtStudioView.css";

gsap.registerPlugin(useGSAP);

const SETTINGS_KEY = "game-art-studio-v1";
const QUALITY_POSITIVE = "干净高清画面，准确还原形体与纹理，细腻材质，纯净色彩，清晰边缘，稳定光照";
const QUALITY_NEGATIVE = "颗粒感，噪点，污点，脏纹理，杂色斑点，压缩痕迹，过度锐化，锐化光晕，虚假纹理，边缘重影";
const CHARACTER_SAFE_POSITIVE = "角色明确为成年人，完整穿着适合公开发行游戏的得体服装，关键区域由结构完整的不透明服装或护甲可靠覆盖，画面重点表现人物气质、完整服装、自然姿态、光影层次与角色设计";

function readSettings() {
  try {
    return JSON.parse(getScopedLocalItem(SETTINGS_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function modelsFromConfig(config = {}) {
  const feature = config.features?.["ai.gameDesign"] || {};
  const payload = feature.config && typeof feature.config === "object" ? { ...feature, ...feature.config } : feature;
  return (Array.isArray(payload.publicModels) ? payload.publicModels : []).map((item) => ({
    ...item,
    id: String(item.id || item.publicModelKey || ""),
    publicModelKey: String(item.publicModelKey || item.id || ""),
    label: String(item.label || item.name || item.id || item.publicModelKey || ""),
    provider: String(item.providerName || item.provider || ""),
    creditCost: Math.max(0, Number(item.creditCost ?? item.pricePoints ?? payload.creditCost ?? 0)),
  })).filter((item) => item.id);
}

function initialTypeState(saved = {}) {
  return Object.fromEntries(ASSET_TYPES.map((type) => {
    const stored = saved[type.id] || {};
    const selects = Object.fromEntries((type.selects || []).map((item) => [
      item.key,
      item.options.some((option) => option.id === stored.selects?.[item.key]) ? stored.selects[item.key] : item.options[0]?.id || "",
    ]));
    const toggles = {
      transparent: stored.toggles?.transparent === true,
      ...Object.fromEntries((type.toggles || []).map((item) => [item.key, typeof stored.toggles?.[item.key] === "boolean" ? stored.toggles[item.key] : item.key === "seamless"])),
    };
    const sections = Object.fromEntries([...(type.controlGroups || []).map((group) => group.id), "style", "quality"].map((id) => [id, stored.sections?.[id] !== false]));
    return [type.id, {
      prompt: String(stored.prompt || type.defaultPrompt || ""),
      aspect: type.aspects?.includes(stored.aspect) ? stored.aspect : type.defaultAspect,
      referenceConstraint: REFERENCE_CONSTRAINT_OPTIONS.some((item) => item.id === stored.referenceConstraint) ? stored.referenceConstraint : "balanced",
      selects,
      toggles,
      sections,
    }];
  }));
}

function constraintParts(value) {
  return String(value || "").split(/[，,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function ModelPrice({ model, light }) {
  if (model?.creditCost == null) return null;
  return <span className={`model-point-price is-compact${light ? " is-light" : ""}`}><strong>{model.creditCost === 0 ? "免费" : `${model.creditCost} 积分/张`}</strong></span>;
}

function DeleteDialog({ open, busy, light, onClose, onConfirm }) {
  if (!open) return null;
  return createPortal(<div className={`delete-history-confirm-backdrop${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section className="delete-history-confirm-dialog" role="dialog" aria-modal="true">
      <span className="delete-history-confirm-icon"><i className="bi bi-trash3" /></span>
      <h3>删除这张生成图片？</h3>
      <p>对应的云端任务和同批生成图片将一并删除，删除后无法恢复。</p>
      <footer><button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button><button type="button" className="danger" disabled={busy} onClick={onConfirm}>{busy ? "删除中…" : "确认删除"}</button></footer>
    </section>
  </div>, document.body);
}

function Filmstrip({ groups, selectedId, onSelect }) {
  if (!groups.length) return null;
  return <aside className="clock-filmstrip" style={{ "--film-slots": Math.min(5, Math.max(2, groups.length)) }}><div className="clock-filmstrip__window"><div className="clock-filmstrip__track" tabIndex={0}><div className="clock-filmstrip__rail">{groups.map((group, index) => <button key={group.id} type="button" className={group.id === selectedId ? "active" : ""} role="option" aria-label={`查看历史图片 ${index + 1}`} aria-selected={group.id === selectedId} onClick={() => onSelect(group.id)}><AuthenticatedImage src={group.entries[0]?.previewUrl || group.cover} alt="" maxDimension={180} loading="eager" /></button>)}</div></div></div></aside>;
}

export function GameArtStudioView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewRef = useRef("");
  const settings = useMemo(readSettings, []);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(String(settings.modelId || ""));
  const currentModel = models.find((item) => item.id === modelId) || models[0] || null;
  const jobs = useGameArtJobs({ model: currentModel, isAuthenticated: auth.isAuthenticated });
  const [assetType, setAssetType] = useState(ASSET_TYPES.some((type) => type.id === settings.assetType) ? settings.assetType : "character");
  const [typeState, setTypeState] = useState(() => initialTypeState(settings.typeState));
  const [style, setStyle] = useState(STYLE_OPTIONS.some((item) => item.id === settings.style) ? settings.style : STYLE_OPTIONS[0].id);
  const [imageCount, setImageCount] = useState([1,2,3,4].includes(Number(settings.imageCount)) ? Number(settings.imageCount) : 1);
  const [hdMode, setHdMode] = useState(settings.hdMode !== false);
  const [clarity, setClarity] = useState(CLARITY_OPTIONS.some((item) => item.id === settings.clarity) ? settings.clarity : "ultra");
  const [positive, setPositive] = useState(String(settings.positive || DEFAULT_POSITIVE));
  const [negative, setNegative] = useState(String(settings.negative || DEFAULT_NEGATIVE));
  const [studioBackgroundId, setStudioBackgroundId] = useState(STUDIO_BACKGROUND_OPTIONS.some((item) => item.id === settings.studioBackgroundId) ? settings.studioBackgroundId : STUDIO_BACKGROUND_OPTIONS[0].id);
  const [inputFile, setInputFile] = useState(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [referenceUrl, setReferenceUrl] = useState(String(settings.referenceUrl || ""));
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [backgroundMenuOpen, setBackgroundMenuOpen] = useState(false);
  const [composerPanel, setComposerPanel] = useState("");
  const [localError, setLocalError] = useState("");
  const [selectedGroups, setSelectedGroups] = useState(settings.canvasGroupSelection || {});
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState("history");
  const [historyAssetType, setHistoryAssetType] = useState(assetType);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState("");
  const [deletingOutput, setDeletingOutput] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTargetUrl, setPublishTargetUrl] = useState("");
  const [submittingShare, setSubmittingShare] = useState(false);
  const [promptItems, setPromptItems] = useState([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptPage, setPromptPage] = useState(0);
  const [promptHasMore, setPromptHasMore] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [assets, setAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const currentType = ASSET_TYPES.find((type) => type.id === assetType) || ASSET_TYPES[0];
  const currentState = typeState[assetType];
  const currentStyle = STYLE_OPTIONS.find((item) => item.id === style) || STYLE_OPTIONS[0];
  const currentClarity = CLARITY_OPTIONS.find((item) => item.id === clarity) || CLARITY_OPTIONS[0];
  const currentReferenceConstraint = REFERENCE_CONSTRAINT_OPTIONS.find((item) => item.id === currentState.referenceConstraint) || REFERENCE_CONSTRAINT_OPTIONS[0];
  const currentBackground = STUDIO_BACKGROUND_OPTIONS.find((item) => item.id === studioBackgroundId) || STUDIO_BACKGROUND_OPTIONS[0];
  const hasReference = Boolean(inputFile || referenceUrl);
  const transparentEnabled = currentState.toggles.transparent === true;
  const currentTypeHeading = /[A-Za-z0-9]$/.test(currentType.label) ? `${currentType.label} 设计` : `${currentType.label}设计`;
  const unitCost = Math.max(0, Number(currentModel?.creditCost || 0));
  const totalCost = unitCost * imageCount;
  const costPrice = currentModel ? totalCost ? `${totalCost} 积分` : "免费" : "价格待确认";
  const activeEntry = jobs.entries.find((entry) => entry.url === jobs.activeOutput) || null;

  const typeEntries = jobs.entries.filter((entry) => entry.kindVariant === assetType);
  const groups = useMemo(() => {
    const map = new Map();
    typeEntries.forEach((entry) => {
      if (!map.has(entry.groupId)) map.set(entry.groupId, { id: entry.groupId, entries: [] });
      map.get(entry.groupId).entries.push(entry);
    });
    return [...map.values()].map((group) => {
      group.entries.sort((left, right) => left.groupIndex - right.groupIndex);
      group.cover = group.entries[0]?.url || "";
      return group;
    });
  }, [typeEntries]);
  const selectedGroupId = selectedGroups[assetType] && groups.some((group) => group.id === selectedGroups[assetType]) ? selectedGroups[assetType] : groups[0]?.id || "";
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0] || null;

  function patchState(patch) {
    setTypeState((current) => ({ ...current, [assetType]: { ...current[assetType], ...patch } }));
  }
  function patchSelect(key, value) {
    setTypeState((current) => ({ ...current, [assetType]: { ...current[assetType], selects: { ...current[assetType].selects, [key]: value } } }));
  }
  function patchToggle(key, value) {
    setTypeState((current) => ({ ...current, [assetType]: { ...current[assetType], toggles: { ...current[assetType].toggles, [key]: value } } }));
  }
  function toggleSection(id) {
    setTypeState((current) => ({ ...current, [assetType]: { ...current[assetType], sections: { ...current[assetType].sections, [id]: current[assetType].sections[id] === false } } }));
  }

  const currentControlGroups = useMemo(() => (currentType.controlGroups || [{ id: "specs", label: "呈现与规格", output: true }])
    .filter((group) => group.id !== "reference")
    .map((group, index) => ({
      ...group,
      number: String(index + 1).padStart(2, "0"),
      enabled: currentState.sections[group.id] !== false,
      selects: (currentType.selects || []).filter((select) => (select.group || "specs") === group.id && (!select.requiresReference || hasReference) && (!select.requiresBatch || imageCount > 1) && !(select.key === "background" && transparentEnabled)),
      toggles: (currentType.toggles || []).filter((toggle) => toggle.key !== "transparent" && (toggle.group || "specs") === group.id),
    }))
    .filter((group) => currentType.id === "character" || group.output || group.selects.length || group.toggles.length), [currentState, currentType, hasReference, imageCount, transparentEnabled]);

  const promptBlueprint = useMemo(() => {
    const lines = [currentState.prompt.trim() || currentType.defaultPrompt, `游戏资产类型：${currentType.label}。${currentType.line}`];
    for (const select of currentType.selects || []) {
      if (select.group === "reference" || currentState.sections[select.group || "specs"] === false) continue;
      const option = select.options.find((item) => item.id === currentState.selects[select.key]);
      if (option?.prompt) lines.push(`${select.label}：${option.prompt}。`);
    }
    if (currentType.id === "character") lines.push(`角色穿着与姿势合规：${CHARACTER_SAFE_POSITIVE}。`);
    if (currentState.sections.style !== false) lines.push(`美术风格：${currentStyle.prompt}。`);
    if (hasReference) lines.push(`参考图约束：${currentReferenceConstraint.prompt}。`);
    for (const toggle of currentType.toggles || []) {
      if (toggle.key !== "transparent" && currentState.toggles[toggle.key] && currentState.sections[toggle.group || "specs"] !== false) lines.push(`${toggle.prompt}。`);
    }
    if (currentState.sections.quality !== false) {
      if (positive.trim()) lines.push(`正面约束：${positive.trim()}。`);
      lines.push(`生产要求：可直接用于游戏开发的高清资产，轮廓明确，材质可辨识，完整展示主体。`);
      lines.push(`清晰度要求：${currentClarity.prompt}。画质要求：${QUALITY_POSITIVE}。`);
      lines.push(`负面约束：${negative.trim()}，${QUALITY_NEGATIVE}。`);
    }
    return lines.join("\n");
  }, [currentClarity.prompt, currentReferenceConstraint.prompt, currentState, currentStyle.prompt, currentType, hasReference, negative, positive]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ allow: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 901px)" }, ({ conditions }) => {
      if (!conditions.allow) return undefined;
      gsap.from("[data-studio-enter]", { autoAlpha: 0, y: 14, duration: 0.52, stagger: 0.06, ease: "power3.out", clearProps: "transform,opacity,visibility" });
      return undefined;
    });
    return () => media.revert();
  }, { scope: rootRef });

  useEffect(() => {
    let disposed = false;
    Promise.all([fetchRuntimeConfig(), jobs.loadHistory()]).then(([config]) => {
      if (disposed) return;
      const available = modelsFromConfig(config);
      setModels(available);
      setModelId((current) => available.some((item) => item.id === current) ? current : available.find((item) => item.default)?.id || available[0]?.id || "");
      const pending = takePendingPrompt("game_art");
      if (pending) {
        const configValue = pending.config || {};
        const nextType = ASSET_TYPES.some((type) => type.id === configValue.skill) ? configValue.skill : assetType;
        setAssetType(nextType);
        const text = composePendingLaunchPrompt(pending, 1200);
        if (text) setTypeState((current) => ({ ...current, [nextType]: { ...current[nextType], prompt: text, aspect: ASSET_TYPES.find((type) => type.id === nextType)?.aspects.includes(configValue.ratio) ? configValue.ratio : current[nextType].aspect } }));
        if ([1,2,3,4].includes(Number(configValue.count))) setImageCount(Number(configValue.count));
        if (configValue.model && available.some((item) => item.id === configValue.model)) setModelId(configValue.model);
      }
    }).catch(() => undefined);
    return () => { disposed = true; if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setScopedLocalItem(SETTINGS_KEY, JSON.stringify({ assetType, style, modelId, studioBackgroundId, imageCount, hdMode, clarity, positive, negative, referenceUrl, canvasGroupSelection: selectedGroups, typeState })), 350);
    return () => window.clearTimeout(timer);
  }, [assetType, clarity, hdMode, imageCount, modelId, negative, positive, referenceUrl, selectedGroups, studioBackgroundId, style, typeState]);

  useEffect(() => {
    const paste = (event) => {
      const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type?.startsWith("image/"));
      const file = item?.getAsFile?.();
      if (!file) return;
      event.preventDefault();
      applyFile(file);
      notificationService.success("已粘贴为参考图");
    };
    const keydown = (event) => {
      if (event.key === "Escape") { setComposerPanel(""); setModelMenuOpen(false); setBackgroundMenuOpen(false); if (!publishOpen) setLibraryOpen(false); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void generate(); }
    };
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", keydown); };
  });

  function applyFile(file) {
    if (!file?.type?.startsWith("image/")) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setInputFile(file);
    setSourcePreview(url);
    setReferenceUrl("");
    setLocalError("");
  }

  async function generate() {
    setLocalError("");
    if (!currentState.prompt.trim() && !inputFile && !referenceUrl) { setLocalError("请先写一段创意描述，或挂一张参考图"); return; }
    if (!currentModel) { setLocalError("后台还没有为游戏设计分配可用模型"); return; }
    const result = await jobs.generate({
      prompt: withTransparentPngInstruction(promptBlueprint, transparentEnabled),
      file: inputFile,
      sourceUrl: referenceUrl,
      referencePreviewUrl: referenceUrl || sourcePreview,
      aspectRatio: currentState.aspect,
      count: imageCount,
      quality: hdMode ? "high" : "medium",
      transparentPngEnabled: transparentEnabled,
      viewLabel: currentType.label,
      kindVariant: assetType,
    });
    if (result.groupId) setSelectedGroups((current) => ({ ...current, [assetType]: result.groupId }));
  }

  async function loadPrompts(reset = false) {
    if (promptLoading) return;
    setPromptLoading(true);
    try {
      const page = reset ? 1 : promptPage + 1;
      const response = await listPromptLibrary("game_art", { pageNumber: page, pageSize: 24 });
      const incoming = Array.isArray(response?.items) ? response.items : [];
      setPromptItems((current) => reset ? incoming : [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()]);
      setPromptPage(Number(response?.page || page));
      setPromptHasMore(response?.hasMore === true);
    } catch (caught) { notificationService.error(caught?.message || "提示词库读取失败"); }
    finally { setPromptLoading(false); }
  }

  async function loadAssets() {
    if (assetsLoading) return;
    setAssetsLoading(true);
    try {
      const response = await listMyShareAssets({ page: 1, pageSize: 48 });
      setAssets((Array.isArray(response?.items) ? response.items : []).filter((item) => String(item?.kind || "") === "game_art" || String(item?.kind || "").startsWith("game-art")));
      setAssetsLoaded(true);
    } catch (caught) { notificationService.error(caught?.message || "我的资产读取失败"); }
    finally { setAssetsLoading(false); }
  }

  function openLibrary(tab = "history") {
    setLibraryTab(tab);
    setHistoryAssetType(assetType);
    setLibraryOpen(true);
    if (tab === "prompts" && !promptItems.length) void loadPrompts(true);
    if (tab === "published" && !assetsLoaded) void loadAssets();
  }

  const backgroundStyle = currentBackground.procedural ? { backgroundColor: isDark ? "#1b1b1b" : "#eef1f5", backgroundImage: "none" } : { backgroundColor: isDark ? "#0a0811" : "#f3f5f7", backgroundImage: `url("${currentBackground.src}")`, backgroundPosition: "center", backgroundSize: "cover" };
  const libraryEntries = jobs.entries.filter((entry) => entry.kindVariant === historyAssetType);
  const filteredPrompts = promptItems.filter((item) => !promptQuery.trim() || `${item.title || ""} ${item.prompt || ""}`.toLowerCase().includes(promptQuery.trim().toLowerCase()));

  return <main ref={rootRef} className={`game-art-studio${isDark ? "" : " is-light"}`} style={backgroundStyle}>
    {currentBackground.procedural && <WireframeTerrainBackground className="ga-terrain-background" light={!isDark} />}
    <aside className="ga-rail" data-studio-enter>{ASSET_TYPES.map((type) => <button key={type.id} type="button" className={assetType === type.id ? "active" : ""} title={type.label} onClick={() => setAssetType(type.id)}><i className={`bi ${type.icon}`} /><span>{type.label}</span></button>)}<button className="ga-library" type="button" title="历史记录与我的资产" onClick={() => openLibrary("history")}><i className="bi bi-collection" /><span>资产库</span></button></aside>
    <section className="ga-main"><div className="ga-workspace"><section className="ga-canvas" data-studio-enter>
      <div className="ga-canvas-head"><div className="ga-canvas-title"><strong>{currentTypeHeading}</strong>{!jobs.generationTasks.length && <span className={`ga-canvas-status${jobs.busy ? " working" : ""}`}><i />{jobs.busy ? "RENDERING" : `READY / ${currentState.aspect}`}{!jobs.busy && typeEntries.length ? ` / ${typeEntries.length} 张` : ""}</span>}</div>
        {jobs.generationTasks.length > 0 && <div className="ga-render-stack" aria-label="正在运行的生成任务">{jobs.generationTasks.map((task) => <div key={task.id} className="ga-render"><div className="ga-render-copy"><strong>{task.status}</strong><small>{task.completedCount}/{task.totalCount}</small></div>{task.progress.length > 1 && <ul className="ga-progress">{task.progress.map((entry, index) => <li key={index} className={`is-${entry.status}`} title={entry.label}><i className={`bi ${entry.status === "done" ? "bi-check-circle-fill" : entry.status === "failed" ? "bi-x-circle" : entry.status === "running" ? "bi-arrow-repeat spin" : "bi-circle"}`} /></li>)}</ul>}</div>)}</div>}
        <div className="ga-canvas-tools"><div className={`ga-background-pick${backgroundMenuOpen ? " open" : ""}`}><button className="ga-background-trigger" type="button" aria-label="选择工作区背景" aria-expanded={backgroundMenuOpen} onClick={() => { setBackgroundMenuOpen((value) => !value); setModelMenuOpen(false); }}><i className="bi bi-images" /><span>背景</span><i className="bi bi-chevron-down" /></button>{backgroundMenuOpen && <div className="ga-background-menu" role="dialog" aria-label="选择工作区背景"><div className="ga-background-menu-head"><strong>选择背景</strong><span>{currentBackground.label}</span></div><div className="ga-background-grid">{STUDIO_BACKGROUND_OPTIONS.map((item) => <button key={item.id} type="button" className={item.id === studioBackgroundId ? "active" : ""} onClick={() => { setStudioBackgroundId(item.id); setBackgroundMenuOpen(false); }}>{item.procedural ? <div className="ga-background-procedural-thumb" /> : <img src={item.src} alt={item.label} />}<span>{item.label}</span><i className="bi bi-check2" /></button>)}</div></div>}</div>
          <div className={`ga-model-pick${modelMenuOpen ? " open" : ""}`}><i className="bi bi-cpu" /><button className="ga-model-trigger" type="button" aria-label="切换生成模型" aria-expanded={modelMenuOpen} onClick={() => { setModelMenuOpen((value) => !value); setBackgroundMenuOpen(false); }}><span>{currentModel?.label || "选择模型"}</span><i className="bi bi-chevron-down" /></button>{modelMenuOpen && <div className="ga-model-menu" role="listbox" aria-label="生成模型">{models.map((model) => <button key={model.id} type="button" role="option" aria-selected={model.id === modelId} className={model.id === modelId ? "active" : ""} onClick={() => { setModelId(model.id); setModelMenuOpen(false); }}><i className="bi bi-check2" /><span>{model.label}</span><ModelPrice model={model} light={!isDark} /></button>)}</div>}</div></div>
      </div>
      <div className={`ga-output${selectedGroup?.entries.length ? " has-results" : ""}`}>
        {selectedGroup?.entries.length ? <div className="ga-viewer-layout"><div className={`ga-results${selectedGroup.entries.length > 1 ? " is-group" : ""}${selectedGroup.entries.length === 4 ? " is-grid-2x2" : ""}`}><div className="ga-result-grid" style={{ "--group-count": selectedGroup.entries.length, "--group-aspect": Number(String(selectedGroup.entries[0]?.aspectRatio || "1:1").split(":")[0]) / Number(String(selectedGroup.entries[0]?.aspectRatio || "1:1").split(":")[1]) }}>{selectedGroup.entries.map((entry) => <div key={entry.url} className={`ga-card-slot${entry.url === jobs.activeOutput ? " is-active" : ""}`}><article className="ga-card" style={{ "--car": Number(entry.aspectRatio.split(":")[0]) / Number(entry.aspectRatio.split(":")[1]) }}><button type="button" className="ga-card-view" aria-label="查看大图" onClick={() => { jobs.setActiveOutput(entry.url); setFullscreenOpen(true); }}><AuthenticatedImage src={entry.url} alt="游戏美术资产" loading="eager" maxDimension={1200} retryCount={2} /></button><div className="ga-card-actions"><button type="button" title="以它为参考继续生成" onClick={() => { setReferenceUrl(entry.url); setInputFile(null); setSourcePreview(""); }}><i className="bi bi-pin-angle" /></button><button type="button" title="发布到广场" onClick={() => { setPublishTargetUrl(entry.url); setPublishOpen(true); }}><i className="bi bi-broadcast" /></button><button type="button" title="下载" onClick={() => downloadAuthenticatedMedia(entry.url, `game-${assetType}-${Date.now()}.png`)}><i className="bi bi-download" /></button><button type="button" title="删除" onClick={() => setPendingDeleteUrl(entry.url)}><i className="bi bi-trash3" /></button></div></article></div>)}</div></div><Filmstrip groups={groups} selectedId={selectedGroupId} onSelect={(id) => { setSelectedGroups((current) => ({ ...current, [assetType]: id })); const group = groups.find((item) => item.id === id); if (group?.cover) jobs.setActiveOutput(group.cover); }} /></div> : <div className="ga-empty"><div className="ga-crosshair"><i className={`bi ${currentType.icon}`} /></div><strong>{currentTypeHeading}工作台</strong><em>{currentType.line}</em><div className="ga-inspo" role="group" aria-label="点一个灵感直接开始">{currentType.examples.map((example) => <button key={example.label} type="button" onClick={() => patchState({ prompt: example.text })}><strong>{example.label}</strong><span>{example.text}</span></button>)}</div><span>点一个灵感填入描述，或直接在下方输入框写下你的想法</span></div>}
      </div>
      {(localError || jobs.error) && <div className="ga-error"><i className="bi bi-exclamation-octagon" />{localError || jobs.error}</div>}
      <div className={`ga-composer${dropActive ? " is-drop" : ""}`} data-studio-enter onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={(event) => { event.preventDefault(); setDropActive(false); applyFile(event.dataTransfer.files?.[0]); }}>
        <div className={`ga-composer-ref${referenceUrl || sourcePreview ? " has-image" : ""}`}><button type="button" className="ga-composer-ref-pick" title="参考图：拖入 / 粘贴 / 点击上传" onClick={() => fileInputRef.current?.click()}>{referenceUrl ? <AuthenticatedImage src={referenceUrl} alt="参考图" maxDimension={160} /> : sourcePreview ? <img src={sourcePreview} alt="参考图" /> : <><i className="bi bi-image" /><span>参考图</span></>}</button>{(inputFile || referenceUrl) && <button type="button" className="ga-composer-ref-clear" title="移除参考图" onClick={() => { setInputFile(null); setSourcePreview(""); setReferenceUrl(""); }}><i className="bi bi-x-lg" /></button>}</div>
        <div className="ga-composer-main"><textarea key={assetType} value={currentState.prompt} rows={2} maxLength={1200} placeholder={currentType.placeholder} onChange={(event) => patchState({ prompt: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void generate(); } }} /></div>
        <div className="ga-composer-features"><div className="ga-feature-grid" role="group" aria-label="生成扩展设置"><button type="button" className={`ga-feature-trigger${composerPanel === "quality" ? " is-open" : ""}${hdMode ? " is-on" : ""}`} onClick={() => setComposerPanel(composerPanel === "quality" ? "" : "quality")}><i className="bi bi-bounding-box-circles" /><span><strong>清晰度</strong><small>{currentClarity.label} · {hdMode ? "HD" : "标准"}</small></span><i className="bi bi-chevron-up" /></button><button type="button" className={`ga-feature-trigger${transparentEnabled ? " is-on" : ""}`} role="switch" aria-checked={transparentEnabled} onClick={() => patchToggle("transparent", !transparentEnabled)}><i className="bi bi-transparency" /><span><strong>透明背景</strong><small>{currentModel?.label || "当前模型"}</small></span><span className="ga-feature-switch"><span /></span></button><button type="button" disabled={!hasReference} className={`ga-feature-trigger${composerPanel === "reference" ? " is-open" : ""}${hasReference ? " is-on" : ""}`} onClick={() => hasReference && setComposerPanel(composerPanel === "reference" ? "" : "reference")}><i className="bi bi-image" /><span><strong>参考图约束</strong><small>{hasReference ? currentReferenceConstraint.label : "未添加"}</small></span><i className="bi bi-chevron-up" /></button><button type="button" className={`ga-feature-trigger${composerPanel === "output" ? " is-open" : ""}`} onClick={() => setComposerPanel(composerPanel === "output" ? "" : "output")}><i className="bi bi-aspect-ratio" /><span><strong>比例与数量</strong><small>{currentState.aspect} · {imageCount} 张</small></span><i className="bi bi-chevron-up" /></button></div>
          {composerPanel && <section className={`ga-feature-popover is-${composerPanel}`}><header><strong>{composerPanel === "quality" ? "清晰度与高清生产" : composerPanel === "reference" ? "参考图约束" : "比例与数量"}</strong><button type="button" title="关闭" onClick={() => setComposerPanel("")}><i className="bi bi-x-lg" /></button></header>{composerPanel === "quality" ? <><div className="ga-feature-segment">{CLARITY_OPTIONS.map((item) => <button key={item.id} type="button" className={clarity === item.id ? "is-on" : ""} onClick={() => setClarity(item.id)}>{item.label}</button>)}</div><button className={`ga-feature-option${hdMode ? " is-on" : ""}`} type="button" onClick={() => setHdMode((value) => !value)}><span><i className="bi bi-badge-hd" /><strong>高清生产模式</strong></span><span className="ga-feature-switch"><span /></span></button></> : composerPanel === "reference" ? <div className="ga-reference-options">{REFERENCE_CONSTRAINT_OPTIONS.map((item) => <button key={item.id} type="button" className={currentState.referenceConstraint === item.id ? "is-on" : ""} onClick={() => patchState({ referenceConstraint: item.id })}><strong>{item.label}</strong><small>{item.prompt}</small></button>)}</div> : <div className="ga-output-settings"><div className="ga-output-setting"><strong>输出比例</strong><div className="ga-output-options">{currentType.aspects.map((ratio) => <button key={ratio} type="button" className={currentState.aspect === ratio ? "is-on" : ""} onClick={() => patchState({ aspect: ratio })}>{ratio}</button>)}</div></div><div className="ga-output-setting"><strong>生成数量</strong><div className="ga-output-options is-count">{[1,2,3,4].map((count) => <button key={count} type="button" className={imageCount === count ? "is-on" : ""} onClick={() => setImageCount(count)}>{count} 张</button>)}</div></div></div>}</section>}
        </div>
        <div className="ga-composer-run"><button className={`ga-generate${jobs.busy ? " is-busy" : ""}`} type="button" aria-label={`${jobs.busy ? "再次创建新任务" : "启动生成"}，${costPrice}`} onClick={generate}><span className="ga-generate-icon"><i className={`bi ${jobs.busy ? "bi-plus-lg" : "bi-play-fill"}`} /></span><span className="ga-generate-copy"><span className="ga-generate-action">{jobs.busy ? "再次创建新任务" : "启动生成"}<em>预计扣费</em></span><span className="ga-generate-price"><strong>{costPrice}</strong>{imageCount > 1 && unitCost > 0 && <small>{unitCost} 积分 / 张 × {imageCount}</small>}</span></span><span className="ga-generate-trailing">{jobs.busy ? <span className="ga-generate-new">+1</span> : <kbd>↵</kbd>}</span></button></div>
      </div><input ref={fileInputRef} hidden type="file" accept="image/*" onChange={(event) => { applyFile(event.target.files?.[0]); event.target.value = ""; }} />
    </section>
    <aside className="ga-console" data-studio-enter><div className="ga-console-title"><span>GENERATOR</span><em>{currentType.en}</em><button type="button" title="重置当前类型的侧边栏设置" onClick={() => { setTypeState((current) => ({ ...current, [assetType]: initialTypeState({})[assetType] })); setStyle(STYLE_OPTIONS[0].id); setImageCount(1); setHdMode(true); setClarity("ultra"); setPositive(DEFAULT_POSITIVE); setNegative(DEFAULT_NEGATIVE); }}><i className="bi bi-arrow-counterclockwise" />重置</button></div><div className="ga-console-body"><div className="ga-type-section">{currentControlGroups.map((group, groupIndex) => <details key={group.id} className={`ga-control-group${group.enabled ? "" : " is-disabled"}`} open={groupIndex === 0}><summary className="ga-sec"><b>{group.number}</b><span>{group.label}</span><em>{group.selects.length + group.toggles.length}</em><button type="button" className={`ga-section-toggle${group.enabled ? " is-on" : ""}`} role="switch" aria-checked={group.enabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleSection(group.id); }}><span /></button><i className="bi bi-chevron-down" /></summary><div className="ga-sec-body">{group.selects.map((select) => <div key={select.key} className="ga-field"><span className="ga-field-label">{select.label}</span><div className="ga-chiprow" role="group" aria-label={select.label}>{select.options.map((option) => <button key={option.id} type="button" disabled={!group.enabled} className={currentState.selects[select.key] === option.id ? "is-on" : ""} title={option.prompt} onClick={() => patchSelect(select.key, option.id)}>{option.label}</button>)}</div></div>)}{group.toggles.length > 0 && <div className="ga-toggles">{group.toggles.map((toggle) => <button key={toggle.key} type="button" disabled={!group.enabled} className={currentState.toggles[toggle.key] ? "is-on" : ""} role="switch" aria-checked={currentState.toggles[toggle.key]} onClick={() => patchToggle(toggle.key, !currentState.toggles[toggle.key])}><span className="ga-toggle-copy"><i className={`bi ${toggle.icon || "bi-toggle2-off"}`} />{toggle.label}</span><span className="ga-mini-switch"><span /></span></button>)}</div>}</div></details>)}
      <details className={`ga-control-group ga-style-control${currentState.sections.style === false ? " is-disabled" : ""}`}><summary className="ga-sec"><b>{String(currentControlGroups.length + 1).padStart(2,"0")}</b><span>美术风格</span><em>{STYLE_OPTIONS.length}</em><button type="button" className={`ga-section-toggle${currentState.sections.style !== false ? " is-on" : ""}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleSection("style"); }}><span /></button><i className="bi bi-chevron-down" /></summary><div className="ga-sec-body"><div className="ga-stylegrid">{STYLE_OPTIONS.map((item) => <button key={item.id} type="button" className={style === item.id ? "is-on" : ""} onClick={() => setStyle(item.id)}><span className="ga-swatch" style={{ background: item.swatch }} /><span>{item.label}</span></button>)}</div><p className="ga-style-hint">{currentStyle.prompt}</p></div></details>
      <details className={`ga-control-group ga-quality-control${currentState.sections.quality === false ? " is-disabled" : ""}`}><summary className="ga-sec"><b>{String(currentControlGroups.length + 2).padStart(2,"0")}</b><span>生产约束</span><em>{POSITIVE_CONSTRAINT_PRESETS.length + NEGATIVE_CONSTRAINT_PRESETS.length}</em><button type="button" className={`ga-section-toggle${currentState.sections.quality !== false ? " is-on" : ""}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleSection("quality"); }}><span /></button><i className="bi bi-chevron-down" /></summary><div className="ga-sec-body ga-sidebar-constraints"><section><strong>正面约束</strong><div className="ga-sidebar-presets">{POSITIVE_CONSTRAINT_PRESETS.map((item) => <button key={item.value} type="button" className={constraintParts(positive).includes(item.value) ? "is-on" : ""} onClick={() => { const parts = constraintParts(positive); setPositive(parts.includes(item.value) ? parts.filter((part) => part !== item.value).join("，") : [...parts, item.value].join("，")); }}>{item.label}</button>)}</div><textarea value={positive} rows={4} onChange={(event) => setPositive(event.target.value)} /></section><section><strong>负面约束</strong><div className="ga-sidebar-presets">{NEGATIVE_CONSTRAINT_PRESETS.map((item) => <button key={item.value} type="button" className={constraintParts(negative).includes(item.value) ? "is-on" : ""} onClick={() => { const parts = constraintParts(negative); setNegative(parts.includes(item.value) ? parts.filter((part) => part !== item.value).join("，") : [...parts, item.value].join("，")); }}>{item.label}</button>)}</div><textarea value={negative} rows={4} onChange={(event) => setNegative(event.target.value)} /></section></div></details>
    </div></div></aside></div></section>
    {libraryOpen && createPortal(<div className={`ga-drawer-backdrop${isDark ? "" : " is-light"}`} onMouseDown={(event) => event.target === event.currentTarget && setLibraryOpen(false)}><aside className="ga-drawer" role="dialog" aria-modal="true" aria-label="资产库"><header><div className="ga-drawer-tabs" role="tablist">{[["prompts","bi-journal-text","词库"],["history","bi-clock-history","历史记录"],["published","bi-broadcast","我的资产"]].map(([id,icon,label]) => <button key={id} type="button" role="tab" aria-selected={libraryTab === id} className={libraryTab === id ? "is-on" : ""} onClick={() => { setLibraryTab(id); if (id === "prompts" && !promptItems.length) void loadPrompts(true); if (id === "published" && !assetsLoaded) void loadAssets(); }}><i className={`bi ${icon}`} />{label}</button>)}</div><button type="button" className="ga-drawer-close" aria-label="关闭资产库" onClick={() => setLibraryOpen(false)}><i className="bi bi-x-lg" /></button></header>
      {libraryTab === "prompts" ? <div className="ga-drawer-body"><div className="ga-prompt-search"><i className="bi bi-search" /><input value={promptQuery} type="search" placeholder="搜索提示词…" aria-label="搜索提示词" onChange={(event) => setPromptQuery(event.target.value)} /></div>{promptLoading && !promptItems.length ? <p className="ga-drawer-note"><i className="bi bi-arrow-repeat spin" />正在载入词库…</p> : !filteredPrompts.length ? <p className="ga-drawer-note">提示词库暂时为空，管理员分配后会显示在这里</p> : <div className="ga-prompt-list">{filteredPrompts.map((item) => <button key={item.id} type="button" className="ga-prompt-item" onClick={() => { patchState({ prompt: item.prompt }); setLibraryOpen(false); void recordPromptEngagement(item.id, "use").catch(() => undefined); }}><span className="ga-prompt-cover">{item.coverUrl || item.imageUrl ? <AuthenticatedImage src={item.coverUrl || item.imageUrl} alt="" maxDimension={360} /> : <i className="bi bi-controller" />}</span><span className="ga-prompt-copy">{item.title && <strong>{item.title}</strong>}<span>{item.prompt}</span><em><i className="bi bi-stars" />点击填入创意描述</em></span></button>)}{promptHasMore && <button type="button" className="ga-prompt-more" onClick={() => loadPrompts(false)}>加载更多</button>}</div>}</div> : libraryTab === "history" ? <div className="ga-drawer-body is-history"><div className="ga-history-types" role="tablist" aria-label="资产类型">{ASSET_TYPES.map((type) => <button key={type.id} type="button" role="tab" aria-selected={historyAssetType === type.id} className={historyAssetType === type.id ? "is-on" : ""} onClick={() => setHistoryAssetType(type.id)}>{type.label}</button>)}</div>{!libraryEntries.length ? <p className="ga-drawer-note">这个类型还没有生成记录</p> : <div className="ga-history-masonry" style={{ "--history-columns": 4 }}>{[0,1,2,3].map((column) => <div key={column} className="ga-history-column">{libraryEntries.filter((_, index) => index % 4 === column).map((entry) => <article key={entry.url} className="ga-history-item" style={{ "--history-aspect": Number(entry.aspectRatio.split(":")[0]) / Number(entry.aspectRatio.split(":")[1]) }}><button type="button" className="ga-history-pick" onClick={() => { setAssetType(entry.kindVariant); jobs.setActiveOutput(entry.url); setSelectedGroups((current) => ({ ...current, [entry.kindVariant]: entry.groupId })); setLibraryOpen(false); }}><AuthenticatedImage src={entry.previewUrl || entry.url} alt="" maxDimension={360} /></button><footer className="ga-history-actions"><button type="button" title="以它为参考" onClick={() => { setReferenceUrl(entry.url); setLibraryOpen(false); }}><i className="bi bi-pin-angle" /></button><button type="button" title="下载" onClick={() => downloadAuthenticatedMedia(entry.url, `game-${entry.kindVariant}.png`)}><i className="bi bi-download" /></button><button type="button" title="删除" onClick={() => setPendingDeleteUrl(entry.url)}><i className="bi bi-trash3" /></button></footer></article>)}</div>)}</div>}</div> : <div className="ga-drawer-body">{assetsLoading ? <p className="ga-drawer-note"><i className="bi bi-arrow-repeat spin" />正在载入我的资产…</p> : !assets.length ? <p className="ga-drawer-note">还没有投稿记录：生成图片后可发布到广场，并在这里查看审核状态</p> : <div className="ga-drawer-grid">{assets.map((asset) => <article key={asset.id} className="ga-shelf-item is-asset"><div className="ga-shelf-pick"><AuthenticatedImage src={asset.coverUrl || asset.resultUrl} alt={asset.title} maxDimension={480} /><span className="ga-asset-status" data-status={asset.status}>{asset.status === "approved" ? "已发布" : asset.status === "rejected" ? "未通过" : "审核中"}</span></div><footer className="is-meta"><strong>{asset.title}</strong></footer></article>)}</div>}</div>}
    </aside></div>, document.body)}
    {fullscreenOpen && jobs.activeOutput && <EcommerceFullscreenPreview sourceUrl={jobs.activeOutput} title={currentTypeHeading} gallery={typeEntries.map((entry) => entry.url)} onSelect={jobs.setActiveOutput} onClose={() => setFullscreenOpen(false)} onDownload={() => downloadAuthenticatedMedia(jobs.activeOutput, `game-${assetType}.png`)} />}
    <DeleteDialog open={Boolean(pendingDeleteUrl)} busy={deletingOutput} light={!isDark} onClose={() => setPendingDeleteUrl("")} onConfirm={async () => { setDeletingOutput(true); try { await jobs.deleteOutput(pendingDeleteUrl); notificationService.success("已删除该输出及其云端任务"); setPendingDeleteUrl(""); } catch (caught) { notificationService.error(caught?.message || "删除失败"); } finally { setDeletingOutput(false); } }} />
    <SharePublishDialog open={publishOpen} title={`${currentType.label} · ${currentState.prompt.slice(0,24)}`} submitting={submittingShare} light={!isDark} onClose={() => setPublishOpen(false)} onSubmit={async (payload) => { const entry = jobs.entries.find((item) => item.url === publishTargetUrl); if (!entry?.jobId) return; setSubmittingShare(true); try { await submitShareItem({ jobId: entry.jobId, styleLabel: currentStyle.label, ...payload }); notificationService.success("已提交到广场审核，通过后会公开展示"); setPublishOpen(false); setAssetsLoaded(false); } catch (caught) { notificationService.error(caught?.message || "发布失败"); } finally { setSubmittingShare(false); } }} />
  </main>;
}
