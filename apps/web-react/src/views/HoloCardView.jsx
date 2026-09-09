import { useEffect, useMemo, useRef, useState } from 'react';
import { PageEntryLink as Link } from '../page-control/PageEntryLink.jsx';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Download, Eye, FileImage, FlipHorizontal2, History, ImagePlus, Layers, LoaderCircle, Palette, Pause, Play, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Square, Upload, WandSparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAuthPrompt } from '../auth/AuthPromptContext.jsx';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { TemplateCardStage } from '../features/holo-card/TemplateCardStage.jsx';
import { ASTRAL_SAMPLE } from '../features/holo-card/astral-design-layers.js';
import { ASTRAL_TEMPLATE_SETTINGS } from '../features/holo-card/holoTemplates.js';
import { applyCardSkin, getCardSkin, resolveCardDesign } from '../features/holo-card/cardSkins.js';
import { cardDesignAssetKey } from '../features/holo-card/cardSkinAssets.js';
import { CardTextControls, HoloSkinPanel } from '../features/holo-card/HoloSkinPanel.jsx';
import { readCardGraphic } from '../features/holo-card/cardGraphicInput.js';
import { HoloAtmosphere } from '../features/holo-card/HoloAtmosphere.jsx';
import { HoloPlayControls } from '../features/holo-card/HoloPlayControls.jsx';
import { FINISHES as ALL_FINISHES } from '../features/holo-card/holoVisualCatalog.js';
import { HoloFeedback, HoloLoadingState, useHoloFeedback } from '../features/holo-card/HoloFeedback.jsx';
import { HoloCreationGuide, HoloHowToDialog } from '../features/holo-card/HoloCreationGuide.jsx';
import { DEFAULT_CARD_SETTINGS, describeHoloGenerationError, modelBlockReason, selectSubjectResolution, subjectResolutionOptions } from '../features/holo-card/holoCard.js';
import { downloadCardBlob, readCardImage } from '../features/holo-card/holoCardImages.js';
import { useHoloCardJob } from '../features/holo-card/useHoloCardJob.js';
import './holo-card.css';

gsap.registerPlugin(useGSAP);
const STATUS = { queued: '排队中', running: '正在生成主体', succeeded: '生成完成', failed: '生成失败', canceled: '已停止' };
const FINISHES = [['spectrum', '光谱'], ['pearl', '珠光'], ['silver', '银箔'], ['gold', '金箔'], ['original', '原画']];
let pendingAuthDraft = null;
let authDraftTimer = 0;

function useBlobUrl(blob) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    if (!blob) { setEntry(null); return; }
    const url = URL.createObjectURL(blob);
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return entry && entry.blob === blob ? entry.url : '';
}

function ToolButton({ label, caption, children, ...props }) {
  return <button type="button" className="holo-tool-button" title={label} aria-label={label} {...props}>{children}{caption && <span>{caption}</span>}</button>;
}

function Range({ label, value, onChange, disabled = false, min = 0, max = 1 }) {
  return <label className={`holo-range${disabled ? ' is-disabled' : ''}`}><span>{label}<output>{Math.round(value * 100)}<small>%</small></output></span>
    <input aria-label={label} type="range" min={min} max={max} step="0.01" value={value} disabled={disabled} style={{ '--range-fill': `${(value - min) / (max - min) * 100}%` }} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function Details({ title, children }) {
  return <details className="holo-details"><summary>{title}<ChevronDown size={15}/></summary><div>{children}</div></details>;
}

function FinishPicker({ value, onChange, onMore }) {
  const extended = !FINISHES.some(([id]) => id === value) && ALL_FINISHES.find(item => item.id === value);
  return <div className="holo-foil-swatches" role="group" aria-label="镭射材质">{FINISHES.map(([id, label]) => <button type="button" key={id} aria-label={label} aria-pressed={value === id} onClick={() => onChange(id)}><span className={`holo-foil is-${id}`}/><small>{label}</small></button>)}<button type="button" className="holo-foil-more" aria-label="更多材质" aria-pressed={Boolean(extended)} title="探索全部 9 种材质" onClick={onMore}>{extended ? <span className="holo-foil" style={{ background: extended.swatch }}/> : <Sparkles size={17}/>}<small>{extended ? extended.label : '更多'}</small></button></div>;
}

function AssetRow({ url, title, description, action, onClick, disabled, onRemove, removeLabel }) {
  return <div className="holo-asset-row"><button type="button" className="holo-asset-main" onClick={onClick} disabled={disabled}>
    <span className={`holo-asset-thumb${url ? ' has-image' : ''}`}>{url ? <img src={url} alt={title}/> : <ImagePlus size={20}/>}</span>
    <span className="holo-asset-copy"><strong>{title}</strong><small>{description}</small></span><span className="holo-asset-action">{action || <ChevronRight size={15}/>}</span>
  </button>{onRemove && <ToolButton label={removeLabel} onClick={onRemove}><X size={14}/></ToolButton>}</div>;
}

export function HoloCardView() {
  const auth = useAuth();
  return <HoloCardWorkspace key={auth.loading ? 'loading' : auth.user?.id || 'guest'} user={auth.user} authLoading={auth.loading}/>;
}

function HoloCardWorkspace({ user, authLoading }) {
  const { requestAuth } = useAuthPrompt();
  const dark = true;
  const rootRef = useRef(null), editorRef = useRef(null), editorTriggerRef = useRef(null), generationRef = useRef(null), confirmationStateRef = useRef(null);
  const [editorOpen, setEditorOpen] = useState(false), [editorMounted, setEditorMounted] = useState(false), [cleanView, setCleanView] = useState(false);
  const [source, setSource] = useState(null), [subject, setSubject] = useState(null), [candidate, setCandidate] = useState(null);
  const [background, setBackground] = useState(null), [lineart, setLineart] = useState(null);
  const [backgroundMode, setBackgroundMode] = useState('template');
  const [graphics, setGraphics] = useState({});
  const [mode, setMode] = useState('original'), [panel, setPanel] = useState('design'), [view, setView] = useState('card');
  const [librarySection, setLibrarySection] = useState('presets');
  const [helpOpen, setHelpOpen] = useState(false), [acknowledgedCapabilityFailure, setAcknowledgedCapabilityFailure] = useState('');
  const [settings, setSettings] = useState({ ...DEFAULT_CARD_SETTINGS, ...ASTRAL_TEMPLATE_SETTINGS });
  const [modelId, setModelId] = useState(''), [resolution, setResolution] = useState('2K'), [instructions, setInstructions] = useState('');
  const [zoom, setZoom] = useState(0), [inspectionBg, setInspectionBg] = useState('checker');
  const [reading, setReading] = useState(false), [exporting, setExporting] = useState(false);
  const [renderReady, setRenderReady] = useState(false), [renderError, setRenderError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const feedback = useHoloFeedback();
  const pendingPresentation = useRef(null), dragDepth = useRef(0), notificationRef = useRef(null);
  const sourceInput = useRef(null), subjectInput = useRef(null), backgroundInput = useRef(null), lineartInput = useRef(null), stage = useRef(null);
  const frameInput = useRef(null), effectsInput = useRef(null), backInput = useRef(null);
  const fileTicket = useRef(0), alive = useRef(true);
  const sourceUrl = useBlobUrl(source?.blob), subjectUrl = useBlobUrl(subject?.blob), candidateUrl = useBlobUrl(candidate?.blob);
  const backgroundUrl = useBlobUrl(background?.blob), lineartUrl = useBlobUrl(lineart?.blob);
  const frameUrl = useBlobUrl(graphics.frame?.blob), effectsUrl = useBlobUrl(graphics.effects?.blob), backUrl = useBlobUrl(graphics.back?.blob);
  const activeSkin = getCardSkin(settings.skinId);
  const job = useHoloCardJob({ userId: user?.id, onCandidate: material => {
    setCandidate(material); setPanel('layers'); setView('subject'); setZoom(0); setEditorOpen(false); setCleanView(false);
  } });
  const selectedModel = job.models.find(model => model.id === modelId);
  const preferredModel = job.models.find(model => model.default && !modelBlockReason(model))
    || job.models.find(model => !modelBlockReason(model));
  const currentModel = selectedModel && !modelBlockReason(selectedModel) ? selectedModel
    : preferredModel || selectedModel || job.models[0];
  const modelReason = job.configError ? '暂时无法连接 image2 服务' : modelBlockReason(currentModel);
  const resolutionOptions = useMemo(() => subjectResolutionOptions(currentModel, source?.dimensions), [currentModel, source?.dimensions]);
  const effectiveResolution = selectSubjectResolution(resolutionOptions, resolution);
  const outputPlan = resolutionOptions.find(option => option.resolution === effectiveResolution);
  const modelAttempts = [job.task, ...job.history].filter(Boolean)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const latestModelTask = currentModel && modelAttempts.find(record => record.params?.publicModelKey === currentModel.id);
  const unsupportedRecord = latestModelTask?.status === 'failed'
    && describeHoloGenerationError(latestModelTask.errorMessage).errorDetail.code === 'transparent_output_unsupported' ? latestModelTask : null;
  const capabilityFailureKey = unsupportedRecord ? `${currentModel.id}:${unsupportedRecord.id}` : '';
  const capabilityBlocked = Boolean(capabilityFailureKey && capabilityFailureKey !== acknowledgedCapabilityFailure);
  const alternativeModel = capabilityBlocked ? job.models.filter(model => {
    if (model.id === currentModel?.id || modelBlockReason(model)) return false;
    const recent = modelAttempts.find(record => record.params?.publicModelKey === model.id);
    if (recent?.status === 'failed' && describeHoloGenerationError(recent.errorMessage).errorDetail.code === 'transparent_output_unsupported') return false;
    return subjectResolutionOptions(model, source?.dimensions).some(option => option.available);
  }).sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)))[0] : null;
  const generationReason = capabilityBlocked ? '这条线路拒绝了本次请求的透明背景参数。可以改用其他已配置的 gpt-image-2 接法，最终仍会检查真实透明通道。'
    : modelReason || (!effectiveResolution ? resolutionOptions[0]?.reason || '当前线路没有适合这张图片的高清输出尺寸' : '');
  confirmationStateRef.current = { job, generationReason };
  const disabled = job.busy || reading || authLoading || Boolean(job.confirmation);
  const pendingCandidate = candidate && candidate !== subject;
  const isDemo = !source && !subject;
  const layered = mode === 'layered' && Boolean(subject);
  const canExport = layered ? Boolean(subject) : Boolean(source);
  const setSetting = (key, value) => {
    if (['skinId', 'backgroundDesign', 'frameDesign', 'layoutDesign', 'effectsDesign', 'backDesign', 'accentColor'].includes(key)) {
      const next = { ...settings, [key]: value };
      if (cardDesignAssetKey(settings) !== cardDesignAssetKey(next) || resolveCardDesign(settings).layout.id !== resolveCardDesign(next).layout.id || getCardSkin(settings.skinId).id !== getCardSkin(next.skinId).id) setRenderReady(false);
    }
    setSettings(current => ({ ...current, [key]: value }));
  };
  const resetMotion = () => setSettings(current => ({ ...current, flipped: false, autoOrbit: false, exploded: false }));
  const onStageReady = ready => {
    setRenderReady(ready);
    if (!ready && pendingPresentation.current) pendingPresentation.current.armed = true;
    if (ready) {
      setRenderError('');
      if (pendingPresentation.current?.armed) { feedback.notify(pendingPresentation.current.label); pendingPresentation.current = null; }
    }
  };

  function openEditor(next = 'design', event) {
    editorTriggerRef.current = event?.currentTarget || document.activeElement;
    setPanel(next); setEditorMounted(true); setEditorOpen(true); setCleanView(false);
  }
  function closeEditor() {
    setEditorOpen(false);
    if (editorTriggerRef.current?.isConnected) editorTriggerRef.current.focus({ preventScroll: true });
  }
  function openGenerator(event) {
    openEditor('layers', event);
    requestAnimationFrame(() => {
      if (alive.current) generationRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  function applyTemplate() {
    if (backgroundMode !== 'template' || (subject && mode !== 'layered') || cardDesignAssetKey(settings) !== cardDesignAssetKey({}) || settings.layoutDesign && !['skin', 'astral'].includes(settings.layoutDesign) || Object.values(graphics).some(asset => asset.mode === 'custom')) setRenderReady(false);
    setSettings(current => ({ ...applyCardSkin(current, 'astral'), ...ASTRAL_TEMPLATE_SETTINGS, lineStrength: 0 }));
    setMode(subject ? 'layered' : 'original');
    setGraphics(current => Object.fromEntries(Object.entries(current).map(([key, asset]) => [key, { ...asset, mode: 'template' }])));
    setBackgroundMode('template'); setView('card'); setCleanView(false);
    stage.current?.reset();
    feedback.notify('已恢复示例的背景、光屑、排版与立体层次');
  }
  function selectSkin(id) {
    const next = applyCardSkin(settings, id);
    const changesAssets = cardDesignAssetKey(settings) !== cardDesignAssetKey(next) || settings.skinId !== next.skinId || settings.layoutDesign !== next.layoutDesign
      || backgroundMode === 'custom' || Object.values(graphics).some(asset => asset.mode === 'custom');
    if (changesAssets) {
      setRenderReady(false);
      pendingPresentation.current = { label: `已换上「${getCardSkin(id).title}」`, armed: true };
    } else feedback.notify(`已应用「${getCardSkin(id).title}」完整设计`);
    setSettings(next); setBackgroundMode('template');
    setGraphics(current => Object.fromEntries(Object.entries(current).map(([key, asset]) => [key, { ...asset, mode: 'template' }])));
    setView('card');
  }
  function setGraphicMode(kind, nextMode) {
    if (kind === 'background') {
      if (backgroundMode === nextMode) return;
      setRenderReady(false); setBackgroundMode(nextMode); return;
    }
    if (!graphics[kind] || graphics[kind].mode === nextMode) return;
    setRenderReady(false); setGraphics(current => ({ ...current, [kind]: { ...current[kind], mode: nextMode } }));
  }
  function uploadGraphic(kind) {
    ({ background: backgroundInput, frame: frameInput, effects: effectsInput, back: backInput })[kind]?.current?.click();
  }
  useGSAP(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      gsap.set('.holo-enter', { autoAlpha: 1, y: 0 });
      return;
    }
    gsap.fromTo('.holo-enter', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: .55, stagger: .06, ease: 'power3.out' });
  }, { scope: rootRef });
  useGSAP(() => {
    if (!editorMounted || !editorRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      gsap.set(editorRef.current, { autoAlpha: editorOpen ? 1 : 0, x: editorOpen ? 0 : 16 });
      if (editorOpen) editorRef.current.focus({ preventScroll: true });
      else setEditorMounted(false);
      return;
    }
    if (editorOpen) gsap.set(editorRef.current, { visibility: 'visible' });
    gsap.to(editorRef.current, { autoAlpha: editorOpen ? 1 : 0, x: editorOpen ? 0 : 16,
      duration: editorOpen ? .32 : .2, ease: 'power3.out', overwrite: true,
      onComplete: () => { if (!editorOpen) setEditorMounted(false); },
    });
    if (editorOpen) editorRef.current.focus({ preventScroll: true });
  }, { scope: rootRef, dependencies: [editorOpen, editorMounted] });
  useEffect(() => {
    if (!editorOpen && !cleanView) return;
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || job.confirmation || helpOpen) return;
      event.preventDefault();
      if (editorOpen) closeEditor();
      else setCleanView(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorOpen, cleanView, job.confirmation, helpOpen]);
  useGSAP(() => {
    const node = rootRef.current?.querySelector('.holo-preview-area');
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { gsap.set(node, { opacity: 1, y: 0 }); return; }
    gsap.fromTo(node, { opacity: .5, y: 5 }, { opacity: 1, y: 0, duration: .27, ease: 'power2.out', overwrite: true });
  }, { scope: rootRef, dependencies: [view], revertOnUpdate: true });
  useGSAP(() => {
    if (!editorOpen) return;
    const node = rootRef.current?.querySelector(`#holo-panel-${panel}`);
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { gsap.set(node, { opacity: 1, y: 0 }); return; }
    gsap.fromTo(node, { opacity: .35, y: 7 }, { opacity: 1, y: 0, duration: .24, ease: 'power2.out', overwrite: true });
  }, { scope: rootRef, dependencies: [panel, editorOpen], revertOnUpdate: true });
  useGSAP(() => {
    if (!job.error || !notificationRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { gsap.set(notificationRef.current, { opacity: 1, y: 0 }); return; }
    gsap.fromTo(notificationRef.current, { opacity: 0, y: -5 }, { opacity: 1, y: 0, duration: .25, ease: 'power2.out' });
  }, { scope: rootRef, dependencies: [job.error], revertOnUpdate: true });

  useEffect(() => {
    alive.current = true;
    const previous = document.title;
    document.title = '闪光卡 · 星空云绘';
    return () => { alive.current = false; fileTicket.current++; document.title = previous; };
  }, []);
  useEffect(() => {
    if (!user || !pendingAuthDraft) return;
    const draft = pendingAuthDraft;
    pendingAuthDraft = null; clearTimeout(authDraftTimer);
    setSource(draft.source); setSettings({ ...DEFAULT_CARD_SETTINGS, ...ASTRAL_TEMPLATE_SETTINGS, ...draft.settings });
    setBackground(draft.background || null); setBackgroundMode(draft.backgroundMode || 'template');
    setGraphics(draft.graphics || {});
    setSubject(draft.subject || null); setCandidate(draft.candidate || draft.subject || null);
    setMode(draft.mode || 'original'); setLineart(draft.lineart || null);
    setModelId(draft.modelId); setResolution(draft.resolution); setInstructions(draft.instructions); openEditor('layers');
  }, [user?.id]);
  useEffect(() => {
    if (currentModel && currentModel.id !== modelId) setModelId(currentModel.id);
  }, [currentModel, modelId]);
  useEffect(() => {
    if (currentModel && effectiveResolution && effectiveResolution !== resolution) setResolution(effectiveResolution);
  }, [currentModel, effectiveResolution, resolution]);
  useEffect(() => {
    if (job.recoveredSource && !source && !subject && !candidate) {
      setSource(job.recoveredSource); setMode('original'); setView('card');
    }
  }, [job.recoveredSource, source, subject, candidate]);

  async function choose(file, kind = 'source') {
    if (!file || disabled || job.confirmation) return;
    const ticket = ++fileTicket.current;
    setReading(true); job.setError('');
    if (kind !== 'subject') setRenderReady(false);
    try {
      if (kind === 'lineart' && !subject) throw new Error('请先确认透明主体');
      const isGraphic = ['frame', 'effects', 'back'].includes(kind);
      const dimensions = isGraphic ? await readCardGraphic(file, kind, { artworkRect: resolveCardDesign(settings).artworkRect }) : await readCardImage(file, { strictAlpha: kind === 'subject', registeredTo: kind === 'lineart' ? subject.stats : null, detectAlpha: kind === 'source' });
      if (!alive.current || ticket !== fileTicket.current) return;
      const material = { blob: file, name: file.name, dimensions };
      if (kind === 'source') {
        const suppliedSubject = dimensions.alphaStats ? { ...material, stats: dimensions.alphaStats, source: material, origin: 'local' } : null;
        pendingPresentation.current = { label: suppliedSubject ? '已识别透明人物，同款四层闪卡已完成' : '图片已放入同款版式，点击生成同款完成人物分层', armed: false };
        job.clear(); setSource(material); setCandidate(suppliedSubject); setSubject(suppliedSubject); setLineart(null);
        setMode(suppliedSubject ? 'layered' : 'original'); setView('card'); resetMotion(); setEditorOpen(false); setCleanView(false);
      } else if (kind === 'subject') {
        job.clear(); setCandidate({ ...material, stats: dimensions, source }); setPanel('layers'); setView('subject'); setZoom(0); setEditorOpen(false); setCleanView(false);
      } else if (isGraphic) {
        pendingPresentation.current = { label: `${{ frame: '卡框', effects: '前景装饰', back: '卡背' }[kind]}已更新`, armed: true };
        setGraphics(current => ({ ...current, [kind]: { ...material, mode: 'custom' } }));
        if (kind === 'frame') setSetting('showFrame', true);
        if (kind === 'effects') setSetting('showEffects', true);
        if (kind === 'back') setSetting('flipped', true);
        setView('card');
      } else if (kind === 'lineart') { pendingPresentation.current = { label: '轮廓图层已载入', armed: false }; setLineart(material); setSettings(current => ({ ...current, lineStrength: Math.max(.15, current.lineStrength) })); setPanel('layers'); }
      else { pendingPresentation.current = { label: '背景已更新', armed: false }; setBackground(material); setBackgroundMode('custom'); }
    } catch (e) { if (alive.current && ticket === fileTicket.current) { job.setError(e.message || '图片读取失败'); if (kind !== 'subject') setRenderReady(Boolean(stage.current?.getState()?.ready)); } }
    finally { if (alive.current && ticket === fileTicket.current) setReading(false); }
  }

  function generate() {
    if (!source) { sourceInput.current?.click(); return; }
    if (generationReason) { job.setError(generationReason); openEditor('layers'); return; }
    if (!user) {
      pendingAuthDraft = { source, subject, candidate, mode, lineart, settings, background, backgroundMode, graphics, modelId: currentModel?.id, resolution: effectiveResolution, instructions };
      clearTimeout(authDraftTimer); authDraftTimer = setTimeout(() => { pendingAuthDraft = null; }, 10 * 60_000);
      requestAuth({ featureLabel: '闪光卡', detail: '登录后可生成 image2 透明主体并保存生成记录。' });
    } else void job.prepare({ source, model: currentModel, resolution: effectiveResolution, instructions });
  }

  function completeTemplate() {
    if (subject) {
      if (mode !== 'layered') setRenderReady(false);
      setMode('layered'); setView('card'); setEditorOpen(false);
      return;
    }
    generate();
  }

  function confirmGeneration() {
    // The dialog retains its children while exiting; a canceled quote must not
    // be submitted by a keyboard event delivered to that retained button.
    const current = confirmationStateRef.current;
    if (!alive.current || !current?.job.confirmation) return;
    if (current.job.confirmation.kind !== 'cancel' && current.generationReason) {
      current.job.dismiss(); current.job.setError(current.generationReason); openGenerator();
      return;
    }
    void current.job.confirm();
  }

  function adoptCandidate() {
    if (!candidate || candidate === subject) return;
    setRenderReady(false);
    pendingPresentation.current = { label: '主体已采用，同款四层闪卡已完成', armed: false };
    setSubject(candidate); setSource(candidate.source || null); setLineart(null);
    setMode('layered'); setView('card'); setPanel('design'); resetMotion(); setEditorOpen(false);
  }

  async function exportCard() {
    if (!stage.current || exporting || !renderReady || !canExport) return;
    setView('card'); setExporting(true); job.setError('');
    try {
      const blob = await stage.current.exportPng();
      if (alive.current) { downloadCardBlob(blob, 'starclouds-holo-card.png'); feedback.notify('PNG 下载已开始', 'export'); }
    } catch (e) { if (alive.current) job.setError(e.message || '导出失败'); }
    finally { if (alive.current) setExporting(false); }
  }

  const inspection = view === 'applied' ? subject : view === 'subject' ? (candidate || subject) : view === 'lineart' ? lineart : source;
  const inspectionUrl = view === 'applied' ? subjectUrl : view === 'subject' ? (candidate ? candidateUrl : subjectUrl) : view === 'lineart' ? lineartUrl : sourceUrl;
  const inspectionSize = inspection?.stats || inspection?.dimensions;
  const taskActive = job.task && ['queued', 'running'].includes(job.task.status);
  const status = reading ? '读取图片' : job.phase || (taskActive ? STATUS[job.task.status] : pendingCandidate ? '主体待验收' : subject ? renderReady ? mode === 'layered' ? '同款已完成' : '原图对照' : '装配同款中' : source ? '版式已就绪 · 待分离主体' : '示例同款');
  const views = [['card', '闪卡'], ...(source ? [['source', '原图']] : []), ...(candidate || subject ? [['subject', '透明主体']] : []), ...(pendingCandidate && subject ? [['applied', '已采用主体']] : []), ...(lineart ? [['lineart', '线稿']] : [])];

  return <div ref={rootRef} style={{ '--active-skin-accent': settings.accentColor || activeSkin.palette.accent }} className={`holo-workspace is-dark${editorOpen ? ' has-editor' : ''}${cleanView ? ' is-clean' : ''}${layered && renderReady && view === 'card' ? ' has-finished-card' : ''}${view !== 'card' ? ' is-inspecting' : ''}${dragOver ? ' is-drag-over' : ''}`}>
    <HoloAtmosphere paused={settings.paused || view !== 'card'} tone={settings.foil}/>
    <HoloFeedback feedback={feedback.feedback} onDismiss={feedback.dismiss}/>
    <header className="holo-toolbar holo-enter">
      <div className="holo-heading"><Link to="/ai-tools" className="holo-back" aria-label="返回工具"><ArrowLeft size={18}/></Link><span className="holo-brand-mark"><Sparkles size={21}/></span><h1>闪光卡</h1>
        <span className="holo-status" role="status">{(reading || job.busy) && <LoaderCircle className="holo-spin" size={13}/>}<i/><span key={status} className="holo-status-copy">{status}</span></span>
      </div>
      <div className="holo-header-actions"><button type="button" className="holo-help-trigger" aria-label="使用说明" onClick={() => setHelpOpen(true)}><CircleHelp size={15}/><span>怎么用</span></button><Link className="holo-sample-link" to="/holo-card/sample">样卡展厅<ArrowRight size={14}/></Link><span className="holo-export-hint">{canExport ? '当前角度 · PNG' : ''}</span><button type="button" className="holo-primary" aria-label="导出 PNG" onClick={exportCard} disabled={!renderReady || exporting || !canExport}>
        {exporting ? <LoaderCircle className="holo-spin" size={16}/> : feedback.feedback?.kind === 'export' ? <Check size={16}/> : <Download size={16}/>}<span>{exporting ? '导出中' : '导出图片'}</span>
      </button></div>
    </header>
    {cleanView && <button type="button" className="holo-clean-exit" onClick={() => setCleanView(false)}>显示工具<X size={14}/></button>}
    <input ref={sourceInput} aria-label="上传原图" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { choose(event.target.files?.[0]); event.target.value = ''; }}/>
    <input ref={subjectInput} aria-label="导入透明主体" type="file" accept="image/png" hidden onChange={event => { choose(event.target.files?.[0], 'subject'); event.target.value = ''; }}/>
    <input ref={backgroundInput} aria-label="上传独立背景" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { choose(event.target.files?.[0], 'background'); event.target.value = ''; }}/>
    <input ref={lineartInput} aria-label="上传对齐线稿" type="file" accept="image/png" hidden onChange={event => { choose(event.target.files?.[0], 'lineart'); event.target.value = ''; }}/>
    <input ref={frameInput} aria-label="卡框文件" type="file" accept="image/png" hidden onChange={event => { choose(event.target.files?.[0], 'frame'); event.target.value = ''; }}/>
    <input ref={effectsInput} aria-label="前景装饰文件" type="file" accept="image/png" hidden onChange={event => { choose(event.target.files?.[0], 'effects'); event.target.value = ''; }}/>
    <input ref={backInput} aria-label="卡背文件" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { choose(event.target.files?.[0], 'back'); event.target.value = ''; }}/>
    <div className="holo-body">
      <section className="holo-center" aria-label="闪卡工作区" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragOver(true); } }} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragOver(false); choose(event.dataTransfer.files[0]); }}>
        <div className="holo-stage-toolbar holo-enter"><div className="holo-tabs" role="tablist" aria-label="预览视图">{views.map(([value, label]) => <button type="button" role="tab" key={value} aria-selected={view === value} onClick={() => { setView(value); setZoom(0); }}>{label}{value === 'subject' && pendingCandidate && <i/>}</button>)}</div>
          {view === 'card' ? <button type="button" className="holo-skin-entry" aria-label="更换卡片皮肤" onClick={event => openEditor('skins', event)}><i/><span>{activeSkin.title}</span><ChevronDown size={13}/></button> : <span className="holo-stage-meta">{`${inspectionSize?.width || 0} × ${inspectionSize?.height || 0} px`}</span>}
        </div>
        <div className="holo-preview-area"><div className="holo-scene" hidden={view !== 'card'}>
          <TemplateCardStage sourceUrl={isDemo ? ASTRAL_SAMPLE.assets.subject : sourceUrl} subjectUrl={isDemo ? ASTRAL_SAMPLE.assets.subject : subjectUrl}
            backgroundUrl={backgroundMode === 'custom' ? backgroundUrl : undefined} lineartUrl={lineartUrl} mode={isDemo ? 'layered' : mode}
            frameUrl={graphics.frame?.mode === 'custom' ? frameUrl : undefined} effectsUrl={graphics.effects?.mode === 'custom' ? effectsUrl : undefined} backUrl={graphics.back?.mode === 'custom' ? backUrl : undefined}
            settings={settings} stageRef={stage} onError={setRenderError} onReady={onStageReady}/>
          <HoloLoadingState active={!renderReady && !renderError && Boolean(isDemo || source || subject)} label={reading ? '读取图片' : '正在装裱图片'}/>
          {renderError && <div className="holo-stage-error" role="alert"><FileImage size={24}/><p>{renderError}</p></div>}
        </div>{view !== 'card' && inspection && <div className={`holo-inspection is-${inspectionBg}`} aria-label="原尺寸图层检查">
          {inspectionUrl && <img src={inspectionUrl} alt={view === 'applied' || (view === 'subject' && !pendingCandidate) ? '已采用透明主体' : view === 'subject' ? '待验收透明主体' : view === 'lineart' ? '对齐线稿图层' : '上传原图'} style={zoom ? { width: inspectionSize.width * zoom, maxWidth: 'none', maxHeight: 'none' } : undefined}/>}
        </div>}</div>
        {view === 'card' && <HoloCreationGuide hasImage={!isDemo} hasSubject={Boolean(subject)} layered={layered} pending={Boolean(pendingCandidate)} assembled={renderReady} previewFailed={Boolean(renderError)} ready={renderReady && canExport && !exporting} disabled={disabled} generateDisabled={!subject && job.configLoading} busyLabel={job.busy ? job.phase || STATUS[job.task?.status] || '准备主体中' : !subject && job.configLoading ? '准备生成线路' : ''} onChoose={() => sourceInput.current?.click()} onEffects={event => openEditor('play', event)} onGenerate={completeTemplate} onInspect={() => { setView('subject'); setEditorOpen(false); }} onExport={exportCard}/>}
        {view === 'subject' && pendingCandidate && <p className="holo-inspection-guide">检查发丝和轮廓后点击“采用此图层”，背景、光屑、文字与四层效果会自动配好。</p>}
        {view === 'card' ? <div className="holo-preview-footer holo-enter" data-holo-preserve-pose><div className="holo-material-dock"><FinishPicker value={settings.foil} onChange={value => setSetting('foil', value)} onMore={event => { setLibrarySection('finishes'); openEditor('play', event); }}/></div><div className="holo-view-controls">
          <ToolButton label={settings.flipped ? '查看正面' : '翻转卡片'} caption="翻面" aria-pressed={settings.flipped} onClick={() => setSetting('flipped', !settings.flipped)}><FlipHorizontal2 size={17}/></ToolButton>
          <ToolButton label={settings.paused ? '启用鼠标交互' : '静止预览'} caption={settings.paused ? '互动' : '静止'} onClick={() => setSetting('paused', !settings.paused)}>{settings.paused ? <Play size={16}/> : <Pause size={16}/>}</ToolButton>
          <ToolButton label="复位角度" caption="复位" onClick={() => { resetMotion(); stage.current?.reset(); }}><RotateCcw size={16}/></ToolButton>
        </div>{isDemo ? <button type="button" className="holo-start-button" onClick={() => sourceInput.current?.click()} disabled={disabled}><Upload size={15}/>选图制作同款<ArrowRight size={15}/></button>
          : pendingCandidate ? <button type="button" className="holo-review-link" onClick={() => setView('subject')}><Eye size={15}/>新主体待确认<ChevronRight size={15}/></button>
            : layered ? <button type="button" className="holo-start-button" aria-label="导出同款闪卡" onClick={exportCard} disabled={!renderReady || exporting}><Download size={15}/>保存同款闪卡</button>
              : <button type="button" className="holo-start-button" aria-label={subject ? '返回同款预览' : '开始生成同款'} onClick={completeTemplate} disabled={disabled || (!subject && job.configLoading)}><Sparkles size={15}/>{job.busy ? job.phase || '准备主体中' : subject ? '返回同款效果' : '生成同款'}<ArrowRight size={14}/></button>}</div> : <>
          <div className="holo-inspection-controls"><button type="button" className="holo-text-button" onClick={() => setView('card')}><ArrowLeft size={14}/>返回闪卡</button><div className="holo-inspection-swatches" aria-label="检查底色">
            {[['checker', '棋盘底'], ['white', '白底'], ['black', '黑底']].map(([value, label]) => <button type="button" key={value} className={`is-${value}`} aria-label={label} title={label} aria-pressed={inspectionBg === value} onClick={() => setInspectionBg(value)}/>)}</div>
            <select aria-label="预览缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value="0">适应画布</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select>
          </div>{view === 'subject' && pendingCandidate && <div className="holo-approval"><div><strong>最后确认人物轮廓</strong><span>{subject ? '采用后替换主体，保留整套同款版式' : '采用后自动完成四层同款，无需再配背景和光屑'}</span></div>
            <button type="button" className="holo-text-button" onClick={() => { setCandidate(subject); setView('card'); }}>暂不采用</button><button type="button" className="holo-primary" onClick={adoptCandidate}><Check size={15}/>采用此图层</button>
          </div>}
        </>}
        {dragOver && <div className="holo-drop-state"><Upload size={25}/><strong>放入图片，开启你的闪卡</strong><span>PNG · JPG · WebP</span></div>}
      </section>
      <nav className="holo-quick-tools holo-enter" aria-label="创作工具" data-holo-preserve-pose>
        <button type="button" aria-label="选择图片" onClick={() => sourceInput.current?.click()} disabled={disabled}><Upload size={19}/><span>图片</span></button>
        <button type="button" aria-label="卡片皮肤" aria-expanded={editorOpen && panel === 'skins'} onClick={event => editorOpen && panel === 'skins' ? closeEditor() : openEditor('skins', event)}><Palette size={19}/><span>皮肤</span></button>
        <button type="button" aria-label="设计面板" aria-expanded={editorOpen && panel === 'design'} onClick={event => editorOpen && panel === 'design' ? closeEditor() : openEditor('design', event)}><SlidersHorizontal size={19}/><span>设计</span></button>
        <button type="button" aria-label="视觉玩法" aria-expanded={editorOpen && panel === 'play'} onClick={event => editorOpen && panel === 'play' ? closeEditor() : openEditor('play', event)}><WandSparkles size={19}/><span>玩法</span></button>
        <button type="button" aria-label="图层面板" aria-expanded={editorOpen && panel === 'layers'} onClick={event => editorOpen && panel === 'layers' ? closeEditor() : openEditor('layers', event)}><Layers size={19}/><span>图层</span>{pendingCandidate && <i/>}</button>
        <button type="button" aria-label="生成记录" aria-expanded={editorOpen && panel === 'history'} onClick={event => editorOpen && panel === 'history' ? closeEditor() : openEditor('history', event)}><History size={19}/><span>记录</span></button>
        <button type="button" aria-label="隐藏工具" onClick={() => { closeEditor(); setCleanView(true); }}><Eye size={19}/><span>纯净</span></button>
      </nav>
      <div ref={notificationRef} className="holo-notifications">
        {job.error && <div className="holo-error" role="alert"><span>{job.error}</span>{job.taskId && job.errorDetail?.code !== 'transparent_output_unsupported' && <ToolButton label="重新同步" onClick={job.retryTask} disabled={Boolean(job.phase)}><RefreshCw size={15}/></ToolButton>}<ToolButton label="关闭错误" onClick={() => job.setError('')}><X size={15}/></ToolButton></div>}
        {(taskActive || job.phase) && <div className="holo-taskbar" role="status"><LoaderCircle className="holo-spin" size={15}/><span>{job.phase || STATUS[job.task?.status]}</span>{taskActive && <button type="button" onClick={job.requestCancel} disabled={Boolean(job.phase)}><Square size={12}/>停止任务</button>}</div>}
      </div>
      <aside ref={editorRef} className="holo-editor" role="dialog" aria-label="闪卡编辑" aria-modal="false" tabIndex={-1} hidden={!editorMounted} inert={!editorOpen} data-holo-preserve-pose>
        <div className="holo-editor-heading"><span>调整作品</span><ToolButton label="关闭编辑面板" onClick={closeEditor}><X size={16}/></ToolButton></div>
        <div className="holo-editor-tabs" role="tablist" aria-label="编辑面板">{[['skins', '皮肤', Palette], ['design', '设计', SlidersHorizontal], ['play', '玩法', WandSparkles], ['layers', '图层', Layers], ['history', '记录', History]].map(([value, label, Icon]) => <button type="button" key={value} role="tab" aria-selected={panel === value} aria-controls={`holo-panel-${value}`} id={`holo-tab-${value}`} onClick={() => setPanel(value)}><Icon size={16}/>{label}{value === 'layers' && pendingCandidate && <i/>}</button>)}</div>
        <div id="holo-panel-skins" role="tabpanel" aria-labelledby="holo-tab-skins" className="holo-panel-scroll" hidden={panel !== 'skins'}><HoloSkinPanel settings={settings} onChange={setSetting} onSelect={selectSkin} artworkUrl={isDemo ? ASTRAL_SAMPLE.assets.subject : subjectUrl || sourceUrl} active={editorMounted && panel === 'skins'} disabled={reading || exporting || authLoading}
          onUpload={uploadGraphic} onGraphicMode={setGraphicMode} graphicAssets={[
            { kind: 'background', label: '背景', url: backgroundUrl, name: background?.name, mode: backgroundMode },
            { kind: 'frame', label: '卡框', url: frameUrl, name: graphics.frame?.name, mode: graphics.frame?.mode, transparent: true },
            { kind: 'effects', label: '前景装饰', url: effectsUrl, name: graphics.effects?.name, mode: graphics.effects?.mode, transparent: true },
            { kind: 'back', label: '卡背', url: backUrl, name: graphics.back?.name, mode: graphics.back?.mode },
          ]}/></div>
        <div id="holo-panel-design" role="tabpanel" aria-labelledby="holo-tab-design" className="holo-panel-scroll" hidden={panel !== 'design'}>
          <section className="holo-section"><div className="holo-create-path"><strong>{activeSkin.title} · 完整卡片设计</strong><p>{activeSkin.subtitle}。背景、卡框、装饰、文字和卡背已配好，放入你的角色即可使用。</p><div className="holo-template-layers"><span><Check size={11}/>背景</span><span>{subject ? <Check size={11}/> : <Layers size={11}/>}人物{subject ? '' : '待准备'}</span><span><Check size={11}/>装饰</span><span><Check size={11}/>文字</span></div><button type="button" onClick={event => openEditor('skins', event)}><Palette size={14}/>更换皮肤与自由混搭</button><button type="button" onClick={applyTemplate} disabled={disabled}><RotateCcw size={14}/>重新套用示例版式</button>{isDemo ? <button type="button" onClick={() => sourceInput.current?.click()} disabled={disabled}><Upload size={14}/>选择图片开始</button> : !layered && <button type="button" onClick={completeTemplate} disabled={disabled || (!subject && job.configLoading)}><Sparkles size={14}/>{subject ? '返回同款效果' : '生成同款'}</button>}</div></section>
          <section className="holo-section"><h2>你的图片</h2><div className="holo-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
            <AssetRow url={sourceUrl || subjectUrl} title={source?.name || (subject ? '透明主体' : '添加一张图片')} description={source ? `${source.dimensions.width} × ${source.dimensions.height} · 原图` : subject ? `${subject.stats.width} × ${subject.stats.height} · 已采用` : 'PNG、JPG、WebP，最大 15 MB'} action={source || subject ? '更换' : <Upload size={16}/>} onClick={() => sourceInput.current?.click()} disabled={disabled}/>
          </div>{subject && <div className="holo-segments" role="group" aria-label="卡片模式"><button type="button" aria-label="原图闪卡" aria-pressed={mode === 'original'} disabled={!source} onClick={() => { if (mode !== 'original') setRenderReady(false); setMode('original'); setSetting('exploded', false); }}>原图对照</button><button type="button" aria-label="分层闪卡" aria-pressed={mode === 'layered'} onClick={() => { if (mode !== 'layered') setRenderReady(false); setMode('layered'); }}>同款效果</button></div>}</section>
          <section className="holo-section"><div className="holo-section-heading"><h2>光泽</h2><span>{ALL_FINISHES.find(item => item.id === settings.foil)?.label}</span></div>
            <Range label="镭射强度" value={settings.foilStrength} disabled={settings.foil === 'original'} onChange={value => setSetting('foilStrength', value)}/>
          </section>
          <Details title="卡面文字">{panel === 'design' && <CardTextControls settings={settings} onChange={setSetting}/>}</Details>
          <Details title="细节调节"><Range label="倾斜幅度" value={settings.tilt} onChange={value => setSetting('tilt', value)}/>{layered && <><Range label="主体比例" value={settings.subjectScale} min={0.75} max={1.2} onChange={value => setSetting('subjectScale', value)}/><Range label="图层深度" value={settings.depth} onChange={value => setSetting('depth', value)}/></>}</Details>
          {!subject && <button type="button" className="holo-depth-entry" onClick={() => setPanel('layers')}><span className="holo-depth-icon"><Layers size={19}/></span><span><strong>让主体浮起来</strong><small>添加透明主体，开启前后景视差</small></span><ArrowRight size={16}/></button>}
        </div>
        <div id="holo-panel-play" role="tabpanel" aria-labelledby="holo-tab-play" className="holo-panel-scroll" hidden={panel !== 'play'}><section className="holo-section"><HoloPlayControls settings={settings} onChange={setSetting} onPatch={patch => setSettings(current => ({ ...current, ...patch }))} section={librarySection} onSectionChange={setLibrarySection} onShine={() => stage.current?.shine()} disabled={!renderReady || view !== 'card'} canExplode={isDemo || layered}/>{view !== 'card' && <button type="button" className="holo-text-button holo-full" onClick={() => setView('card')}>返回闪卡预览</button>}</section></div>
        <div id="holo-panel-layers" role="tabpanel" aria-labelledby="holo-tab-layers" className="holo-panel-scroll" hidden={panel !== 'layers'}>
          <section className="holo-section"><div className="holo-create-path"><strong>让主体和背景分开运动</strong><p>需要一张真正透明的主体图片。已有透明 PNG 可以直接导入；在线生成则需要线路支持透明输出。</p><button type="button" onClick={openGenerator}><Sparkles size={14}/>查看在线生成<ArrowRight size={13}/></button><small>操作顺序：添加主体 → 检查轮廓 → 采用此图层。原图闪卡可以随时使用。</small></div></section>
          <section className="holo-section"><div className="holo-section-heading"><h2>主体图层</h2><span>{subject ? '已采用' : '未添加'}</span></div>
            {subject && <AssetRow url={subjectUrl} title="已采用主体" description={`${subject.stats.width} × ${subject.stats.height} · PNG`} onClick={() => { setView(pendingCandidate ? 'applied' : 'subject'); setZoom(0); }} action={<Eye size={15}/>}/>}
            {pendingCandidate && <div className="holo-candidate"><AssetRow url={candidateUrl} title="新主体待确认" description="当前卡片不会自动替换" action="检查" onClick={() => { setView('subject'); setZoom(0); }}/></div>}
            {!subject && !pendingCandidate && <div className="holo-layer-placeholder"><Layers size={28}/><strong>为卡片添加层次</strong><p>用 image2 分离主体，或导入已有透明 PNG。</p></div>}
            <button type="button" className="holo-secondary holo-full" disabled={disabled} onClick={() => subjectInput.current?.click()}><Upload size={15}/>导入透明 PNG</button>
            {candidate?.sourceWarning && <p className="holo-source-warning" role="status">{candidate.sourceWarning}</p>}
            {subject && <button type="button" className="holo-text-button holo-full" aria-label="下载原始透明 PNG" onClick={() => downloadCardBlob(subject.blob, 'image2-subject.png')}><Download size={14}/>下载已采用主体</button>}
          </section>
          <section ref={generationRef} className="holo-section"><div className="holo-section-heading"><h2>在线生成透明主体</h2><span className="holo-quality-tag">image2</span></div>
            <p className="holo-caption">由选中的 gpt-image-2 移除背景，出图后检查透明通道，再由你确认采用。</p>
            {!source && <button type="button" className="holo-inline-upload" onClick={() => sourceInput.current?.click()} disabled={disabled}><ImagePlus size={16}/>先选择一张原图<ArrowRight size={14}/></button>}
            {source && <AssetRow url={sourceUrl} title={source.name} description="生成参考图" action="更换" onClick={() => sourceInput.current?.click()} disabled={disabled}/>}
            {source && outputPlan && !generationReason && <div className="holo-generation-summary"><strong>{currentModel?.label || currentModel?.name} · {effectiveResolution}</strong><span>计划输出 {outputPlan.width} × {outputPlan.height} · 请求高质量透明 PNG</span>{outputPlan.canvasAdjusted && <span>{outputPlan.canvasNote}</span>}{!currentModel.outputFormats?.length && <span>使用模型内置格式，返回结果必须通过 PNG 与透明通道检查。</span>}</div>}
            <Details title="生成设置"><label className="holo-field holo-request-field">主体要求<span className="holo-optional">选填</span><textarea rows={3} maxLength={800} value={instructions} disabled={disabled} placeholder="例如：保留人物、发丝和手中的花" onChange={event => setInstructions(event.target.value)}/></label><label className="holo-field">模型<select value={currentModel?.id || ''} onChange={event => setModelId(event.target.value)} disabled={disabled || job.configLoading}>{!job.models.length && <option value="">{job.configLoading ? '读取模型' : '暂无 image2 线路'}</option>}{job.models.map(model => <option key={model.id} value={model.id} disabled={Boolean(modelBlockReason(model))}>{model.label || model.name || model.id}{modelBlockReason(model) ? ` · ${modelBlockReason(model)}` : ''}</option>)}</select></label>
              <label className="holo-field">分辨率<select value={effectiveResolution} disabled={disabled || !currentModel || !effectiveResolution} onChange={event => setResolution(event.target.value)}>{!effectiveResolution && <option value="">没有符合精细度要求的尺寸</option>}{resolutionOptions.map(option => <option key={option.resolution} value={option.resolution} disabled={!option.available}>{option.resolution}{option.available ? ` · ${option.width} × ${option.height}` : ' · 当前画幅精度不足'}</option>)}</select></label></Details>
            {generationReason && !job.configLoading && <div className="holo-generation-unavailable" role="status"><strong>当前设置暂不能生成透明主体</strong><p>{generationReason}</p>{alternativeModel && <button type="button" onClick={() => setModelId(alternativeModel.id)} disabled={disabled}><Sparkles size={13}/>改用 {alternativeModel.label || alternativeModel.name}</button>}{capabilityBlocked ? <button type="button" onClick={() => { setAcknowledgedCapabilityFailure(capabilityFailureKey); job.refreshConfig(); }} disabled={job.configLoading}><RefreshCw size={13}/>更换线路后重新检查</button> : <ToolButton label="重试连接模型" onClick={job.refreshConfig} disabled={job.configLoading}><RefreshCw size={14}/></ToolButton>}</div>}
            {job.error && <div className="holo-inline-error"><p>{job.error}</p><div className="holo-inline-error-actions"><button type="button" onClick={() => { setView('card'); closeEditor(); }} disabled={!source && !subject}>用当前图片继续制卡</button><button type="button" onClick={() => subjectInput.current?.click()} disabled={disabled}>导入透明 PNG 继续</button></div>{job.errorDetail?.originalMessage && job.errorDetail.originalMessage !== job.error && <details><summary>查看原始错误</summary><p>{job.errorDetail.originalMessage}</p></details>}</div>}
            <button type="button" className="holo-primary holo-full" onClick={generate} disabled={!source || disabled || job.configLoading || Boolean(generationReason)}><Sparkles size={16}/>{user ? '生成精细主体' : '登录后生成主体'}</button><p className="holo-caption">先读取报价，确认积分后才提交。生成后仍需检查并采用。</p>
          </section>
          <section className="holo-section"><h2>背景与卡片装饰</h2><AssetRow url={backgroundMode === 'custom' ? backgroundUrl : activeSkin.id === 'astral' ? ASTRAL_SAMPLE.assets.background : ''} title={backgroundMode === 'custom' ? background?.name : `${activeSkin.title} · 皮肤背景`} description="装饰随皮肤配好，也能使用自己的图片" action={<Upload size={15}/>} onClick={() => backgroundInput.current?.click()} disabled={disabled}/>{backgroundMode === 'custom' && <button type="button" className="holo-text-button holo-full" onClick={() => setGraphicMode('background', 'template')}>恢复{activeSkin.id === 'astral' ? '示例星轨背景' : '皮肤背景'}</button>}<button type="button" className="holo-text-button holo-full" onClick={event => openEditor('skins', event)}><Palette size={14}/>更换卡框、装饰与卡背</button></section>
          {subject && <Details title="轮廓线稿"><AssetRow url={lineartUrl} title={lineart?.name || '导入线稿'} description="与主体同尺寸的黑色线稿 PNG" onClick={() => lineartInput.current?.click()} disabled={disabled} onRemove={lineart ? () => { setLineart(null); if (view === 'lineart') setView('card'); } : null} removeLabel="移除线稿"/>
            {lineart && <Range label="轮廓光泽" value={settings.lineStrength} disabled={!layered || settings.foil === 'original'} onChange={value => setSetting('lineStrength', value)}/>}</Details>}
          {(candidate || subject) && <Details title="透明信息"><dl className="holo-stats"><dt>像素尺寸</dt><dd>{(candidate || subject).stats.width} × {(candidate || subject).stats.height}</dd><dt>透明区域</dt><dd>{((candidate || subject).stats.transparentRatio * 100).toFixed(1)}%</dd><dt>半透明像素</dt><dd>{((candidate || subject).stats.partialRatio * 100).toFixed(2)}%</dd></dl></Details>}
        </div>
        <div id="holo-panel-history" role="tabpanel" aria-labelledby="holo-tab-history" className="holo-panel-scroll holo-history" hidden={panel !== 'history'}>
          <section className="holo-section"><div className="holo-section-heading"><h2>主体生成记录</h2><ToolButton label="刷新任务" onClick={job.refreshHistory} disabled={job.historyLoading}><RefreshCw size={15}/></ToolButton></div><p className="holo-caption holo-history-description">选择记录检查主体，采用后替换当前图层。</p>
            {job.historyError && <div className="holo-service-notice" role="alert"><span>{job.historyError}</span></div>}
            {job.historyLoading && <div className="holo-history-empty" role="status"><LoaderCircle className="holo-spin" size={22}/><span>读取生成记录</span></div>}
            {!job.historyLoading && !job.history.length && <div className="holo-history-empty"><History size={32}/><strong>{user ? '还没有生成记录' : '登录后查看记录'}</strong><span>{user ? '生成的主体会保存在这里' : '同步你生成过的透明主体'}</span>{!user && <button type="button" className="holo-secondary" onClick={() => requestAuth({ featureLabel: '主体生成记录' })}>登录</button>}</div>}
            {job.history.map(item => <button type="button" key={item.id} className={`holo-history-item${item.id === job.taskId ? ' is-selected' : ''}`} disabled={disabled} onClick={() => job.openHistory(item.id)}><span className="holo-history-icon"><FileImage size={20}/></span><span><strong>{String(item.params?.sourceName || '透明主体')}</strong><small>{STATUS[item.status] || item.status}</small></span><ChevronRight size={15}/></button>)}
          </section>
        </div>
      </aside>
    </div>
    <HoloHowToDialog open={helpOpen} onClose={() => setHelpOpen(false)} onChoose={() => sourceInput.current?.click()}/>
    <ConfirmDialog open={Boolean(job.confirmation)} busy={Boolean(job.phase)} light={!dark} tone="primary" icon="bi-stars" heading={job.confirmation?.kind === 'cancel' ? '停止当前任务？' : '确认生成透明主体？'}
      description={job.confirmation?.kind === 'cancel' ? '尚未提交上游时取消，冻结积分会退回。确认时若请求已提交上游，停止只会放弃接收结果，本次预留积分不退回，上游可能仍继续生成。' : `${currentModel?.label || currentModel?.name || 'image2'} · ${effectiveResolution}，本次预计 ${job.confirmation?.total ?? 0} 积分，生成 1 张高质量 PNG。生成后可放大检查边缘，确认后替换主体。不合格时不会自动再次生成。`}
      confirmLabel={job.confirmation?.kind === 'cancel' ? '停止任务' : '确认生成'} busyLabel={job.phase || '提交中'} onClose={job.dismiss} onConfirm={confirmGeneration}/>
  </div>;
}
