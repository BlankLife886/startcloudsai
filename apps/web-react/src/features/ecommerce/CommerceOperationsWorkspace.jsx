import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileCheck2,
  Images,
  PackageCheck,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  listCommerceAssetReviews,
  listCommerceProducts,
  saveCommerceAssetReview,
} from "@react/legacy-modules/services/ecommerceApi.js";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import "./CommerceOperationsWorkspace.css";

const QA_CHECKS = [
  { id: "identity", label: "商品身份", hint: "造型、部件、数量和配件与母片一致", enLabel: "Product identity", enHint: "Shape, parts, quantity and accessories match the master" },
  { id: "copy", label: "包装与文字", hint: "Logo、标签、认证和包装版本准确", enLabel: "Packaging and copy", enHint: "Logos, labels, certification and packaging are accurate" },
  { id: "color", label: "颜色与材质", hint: "色彩、纹理、透明和反光关系可信", enLabel: "Color and material", enHint: "Color, texture, transparency and reflections are credible" },
  { id: "physics", label: "光影与物理", hint: "接触影、比例、透视和人物交互自然", enLabel: "Light and physics", enHint: "Shadows, scale, perspective and interactions look natural" },
  { id: "channel", label: "渠道规范", hint: "画幅、安全区、背景和文案符合目标渠道", enLabel: "Channel policy", enHint: "Format, safe area, background and copy meet channel rules" },
  { id: "rights", label: "权利与标识", hint: "肖像、字体、商标授权及AI标识可追溯", enLabel: "Rights and labels", enHint: "Portrait, font, trademark and AI provenance are traceable" },
];

const FILTERS = [
  ["pending", "待质检", "Pending"],
  ["approved", "已批准", "Approved"],
  ["changes_requested", "需修改", "Changes"],
  ["all", "全部", "All"],
];

function isCompleteTask(task) {
  return ["succeeded", "completed", "done"].includes(
    String(task?.status || "").toLowerCase(),
  );
}

function modeLabel(task, english = false) {
  const kind = String(task?.kind || task?.params?._kind || "").toLowerCase();
  if (kind.includes("listing")) return english ? "Listing set" : "商品套图";
  if (kind.includes("tryon")) return english ? "Virtual try-on" : "虚拟试衣";
  if (kind.includes("handheld")) return english ? "Handheld shoot" : "手持商拍";
  if (kind.includes("accessory")) return english ? "Accessory shoot" : "配饰商拍";
  if (kind.includes("campaign")) return english ? "Campaign creative" : "营销图";
  if (kind.includes("background")) return english ? "Background" : "背景生成";
  if (kind.includes("clone")) return english ? "Visual remix" : "视觉复刻";
  if (kind.includes("detail")) return english ? "A+ detail" : "A+ 详情";
  return english ? "AI product shoot" : "AI 创意商拍";
}

function formatDate(value, english = false) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return english ? "Just now" : "刚刚";
  return date.toLocaleString(english ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function productTruthScore(product) {
  const checks = [
    product?.title,
    product?.assets?.length || product?.assetIds?.length,
    product?.sellingPoints,
    product?.material,
    product?.color,
    product?.dimensions,
    product?.platform,
    product?.market,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function reviewStatus(review) {
  return review?.status || "pending";
}

function statusCopy(status, english = false) {
  if (status === "approved") return [english ? "Approved" : "已批准", CheckCircle2];
  if (status === "changes_requested") return [english ? "Changes" : "需修改", AlertTriangle];
  return [english ? "Pending" : "待质检", ClipboardCheck];
}

function taskOutput(task) {
  return String(task?.previews?.[0] || task?.outputs?.[0] || "");
}

function Metric({ icon: Icon, label, value, detail, tone = "neutral" }) {
  return (
    <article className={`commerce-ops-metric is-${tone}`}>
      <span className="commerce-ops-metric__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

export function CommerceOperationsWorkspace({
  english = false,
  tasks = [],
  historyLoading = false,
  onRefresh,
  onPreview,
  onOpenProducts,
  onOpenAssets,
  onStartMode,
}) {
  const [products, setProducts] = useState([]);
  const [reviewsByTask, setReviewsByTask] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [checklist, setChecklist] = useState({});
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const controllerRef = useRef(null);
  const t = useMemo(
    () =>
      english
        ? {
            title: "Commerce operations",
            subtitle: "Manage every commercial asset from product truth to approval and delivery.",
            refresh: "Refresh",
            newShoot: "New shoot",
            activeProducts: "Active products",
            truthAverage: "truth pack average",
            productionTasks: "Production tasks",
            producing: "Queued or generating",
            pendingQa: "Pending QA",
            changes: "need changes",
            ready: "Ready to deliver",
            assets: "commercial assets",
            productionFlow: "PRODUCTION FLOW",
            pipeline: "Production pipeline",
            manageTruth: "Manage product truth",
            truthPack: "Truth pack",
            truthHint: "average completeness",
            inProduction: "In production",
            inProductionHint: "queued and generating",
            qaStage: "Pending QA",
            qaHint: "product owner approval required",
            delivery: "Ready",
            deliveryHint: "passed all hard gates",
            commercialQa: "COMMERCIAL QA",
            queue: "Asset review queue",
            search: "Search tasks",
            unnamed: "Untitled commercial asset",
            noFiltered: "No assets match this filter",
            noAssets: "No commercial assets ready for review",
            noAssetsHint: "Completed product shoots automatically enter this queue.",
            startShoot: "Start shoot",
            reviewGate: "REVIEW GATE",
            reviewTitle: "Commercial release checks",
            viewOriginal: "View original",
            targetChannel: "Target channel",
            channelPlaceholder: "e.g. Amazon US",
            reviewNote: "Review note",
            notePlaceholder: "Record product truth, composition or channel issues",
            saved: "QA draft saved",
            approved: "Asset approved and ready for delivery",
            requested: "Change request saved",
            saveDraft: "Save draft",
            requestChanges: "Request changes",
            approveDelivery: "Approve",
            selectAsset: "Select an asset to review",
            selectHint: "Product truth, channel policy and rights must be confirmed before approval.",
            truthAction: "Product truth packs",
            truthActionHint: "Maintain SKU, material, dimensions and protected elements",
            listingAction: "Batch listing set",
            listingActionHint: "Generate consistent channel-ready listing assets",
            assetAction: "Assets and references",
            assetActionHint: "Manage product masters, models and scene references",
            loadError: "Failed to load commerce operations",
            saveError: "Failed to save review",
            refreshTitle: "Refresh operations data",
            closeError: "Dismiss error",
            pipelineAria: "Commerce production pipeline",
            filterAria: "Review status",
            previewTitle: "View asset",
            currentAlt: "Selected commercial asset",
          }
        : {
            title: "商拍业务中心",
            subtitle: "从商品事实包到审核交付，统一管理每一张商业成片。",
            refresh: "刷新",
            newShoot: "新建商拍",
            activeProducts: "活跃商品",
            truthAverage: "事实包平均",
            productionTasks: "生产任务",
            producing: "正在排队或生成",
            pendingQa: "待质检",
            changes: "项需修改",
            ready: "可交付",
            assets: "张成片",
            productionFlow: "PRODUCTION FLOW",
            pipeline: "生产流水线",
            manageTruth: "管理商品事实包",
            truthPack: "事实包",
            truthHint: "平均完整度",
            inProduction: "生产中",
            inProductionHint: "排队与生成任务",
            qaStage: "待质检",
            qaHint: "需要商品负责人确认",
            delivery: "可交付",
            deliveryHint: "已通过六项硬质检",
            commercialQa: "COMMERCIAL QA",
            queue: "成片质检队列",
            search: "搜索任务",
            unnamed: "未命名商品成片",
            noFiltered: "当前筛选没有成片",
            noAssets: "还没有可质检的商业成片",
            noAssetsHint: "完成一次商拍生成后，结果会自动进入这里。",
            startShoot: "开始商拍",
            reviewGate: "REVIEW GATE",
            reviewTitle: "商业放行检查",
            viewOriginal: "查看原图",
            targetChannel: "目标渠道",
            channelPlaceholder: "例如 Amazon US",
            reviewNote: "审核意见",
            notePlaceholder: "记录需要修正的商品事实、构图或渠道问题",
            saved: "质检草稿已保存",
            approved: "成片已批准，可进入交付",
            requested: "修改意见已保存",
            saveDraft: "保存草稿",
            requestChanges: "退回修改",
            approveDelivery: "批准交付",
            selectAsset: "选择一张成片开始质检",
            selectHint: "批准前必须逐项确认商品真实性、渠道规范和权利状态。",
            truthAction: "商品事实包",
            truthActionHint: "维护SKU、材质、尺寸和保护元素",
            listingAction: "批量商品套图",
            listingActionHint: "按平台生成统一结构的上架素材",
            assetAction: "资产与素材",
            assetActionHint: "管理商品母片、模特和场景参考",
            loadError: "业务中心读取失败",
            saveError: "质检记录保存失败",
            refreshTitle: "刷新业务数据",
            closeError: "关闭错误",
            pipelineAria: "商拍生产流水线",
            filterAria: "质检状态",
            previewTitle: "查看成片",
            currentAlt: "当前质检成片",
          },
    [english],
  );

  async function load() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const [productResult, reviewItems] = await Promise.all([
        listCommerceProducts({ status: "active", limit: 100, signal: controller.signal }),
        listCommerceAssetReviews({ limit: 200, signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setProducts(productResult.items || []);
      setReviewsByTask(
        Object.fromEntries((reviewItems || []).map((item) => [item.taskId, item])),
      );
    } catch (loadError) {
      if (loadError?.name !== "AbortError") {
        setError(loadError?.message || t.loadError);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, []);

  const reviewableTasks = useMemo(
    () =>
      tasks.filter(
        (task) => isCompleteTask(task) && taskOutput(task) && !String(task.id).startsWith("local-"),
      ),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reviewableTasks.filter((task) => {
      const status = reviewStatus(reviewsByTask[task.id]);
      if (filter !== "all" && status !== filter) return false;
      if (!needle) return true;
      return `${modeLabel(task, english)} ${task.prompt || ""} ${task.id}`
        .toLowerCase()
        .includes(needle);
    });
  }, [english, filter, query, reviewableTasks, reviewsByTask]);

  useEffect(() => {
    if (filteredTasks.some((task) => task.id === selectedTaskId)) return;
    setSelectedTaskId(filteredTasks[0]?.id || reviewableTasks[0]?.id || "");
  }, [filteredTasks, reviewableTasks, selectedTaskId]);

  const selectedTask =
    reviewableTasks.find((task) => task.id === selectedTaskId) || null;
  const selectedReview = selectedTask ? reviewsByTask[selectedTask.id] : null;

  useEffect(() => {
    setChecklist(selectedReview?.checklist || {});
    setNote(selectedReview?.note || "");
    setChannel(
      selectedReview?.channel ||
        selectedTask?.params?.platform ||
        selectedTask?.params?.handheldSpec?.platform ||
        "",
    );
  }, [selectedReview, selectedTask]);

  const activeCount = tasks.filter((task) =>
    ["queued", "running", "waiting_provider"].includes(
      String(task?.status || "").toLowerCase(),
    ),
  ).length;
  const approvedCount = reviewableTasks.filter(
    (task) => reviewStatus(reviewsByTask[task.id]) === "approved",
  ).length;
  const changesCount = reviewableTasks.filter(
    (task) => reviewStatus(reviewsByTask[task.id]) === "changes_requested",
  ).length;
  const pendingCount = Math.max(0, reviewableTasks.length - approvedCount - changesCount);
  const truthCoverage = products.length
    ? Math.round(
        products.reduce((total, product) => total + productTruthScore(product), 0) /
          products.length,
      )
    : 0;
  const completedChecks = QA_CHECKS.filter((item) => checklist[item.id]).length;
  const allChecked = completedChecks === QA_CHECKS.length;

  async function save(status) {
    if (!selectedTask || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const review = await saveCommerceAssetReview(selectedTask.id, {
        status,
        checklist,
        note: note.trim(),
        channel: channel.trim(),
      });
      setReviewsByTask((current) => ({ ...current, [selectedTask.id]: review }));
      if (status !== "pending") setFilter(status);
      setNotice(
        status === "approved"
          ? t.approved
          : status === "changes_requested"
            ? t.requested
            : t.saved,
      );
    } catch (saveError) {
      setError(saveError?.message || t.saveError);
    } finally {
      setSaving(false);
    }
  }

  const pipeline = [
    { label: t.truthPack, value: products.length, hint: `${truthCoverage}% ${t.truthHint}`, tone: "blue" },
    { label: t.inProduction, value: activeCount, hint: t.inProductionHint, tone: "amber" },
    { label: t.qaStage, value: pendingCount, hint: t.qaHint, tone: "red" },
    { label: t.delivery, value: approvedCount, hint: t.deliveryHint, tone: "green" },
  ];

  return (
    <section className="commerce-ops" aria-busy={loading || historyLoading}>
      <header className="commerce-ops__header">
        <div>
          <span className="commerce-ops__eyebrow">AI COMMERCE OPERATIONS</span>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="commerce-ops__header-actions">
          <button type="button" title={t.refreshTitle} onClick={() => { void load(); onRefresh?.(); }}>
            <RefreshCw size={17} className={loading ? "is-spinning" : ""} />
            {t.refresh}
          </button>
          <button type="button" className="primary" onClick={() => onStartMode?.("shoot")}>
            <Play size={17} fill="currentColor" />
            {t.newShoot}
          </button>
        </div>
      </header>

      {error && (
        <div className="commerce-ops__error" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} title={t.closeError}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="commerce-ops__metrics">
        <Metric icon={Boxes} label={t.activeProducts} value={products.length} detail={`${t.truthAverage} ${truthCoverage}%`} tone="blue" />
        <Metric icon={Sparkles} label={t.productionTasks} value={activeCount} detail={t.producing} tone="amber" />
        <Metric icon={ClipboardCheck} label={t.pendingQa} value={pendingCount} detail={`${changesCount} ${t.changes}`} tone="red" />
        <Metric icon={PackageCheck} label={t.ready} value={approvedCount} detail={`${reviewableTasks.length} ${t.assets}`} tone="green" />
      </div>

      <section className="commerce-ops__pipeline" aria-label={t.pipelineAria}>
        <header>
          <div>
            <small>{t.productionFlow}</small>
            <h2>{t.pipeline}</h2>
          </div>
          <button type="button" onClick={onOpenProducts}>
            {t.manageTruth}
            <ArrowRight size={16} />
          </button>
        </header>
        <ol>
          {pipeline.map((step, index) => (
            <li key={step.label} className={`is-${step.tone}`}>
              <span className="commerce-ops__step-index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{step.label}</strong><small>{step.hint}</small></div>
              <b>{step.value}</b>
              {index < pipeline.length - 1 && <ArrowRight size={15} aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </section>

      <div className="commerce-ops__workbench">
        <section className="commerce-ops__queue">
          <header>
            <div>
              <small>{t.commercialQa}</small>
              <h2>{t.queue}</h2>
            </div>
            <label className="commerce-ops__search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />
            </label>
          </header>
          <div className="commerce-ops__filters" role="tablist" aria-label={t.filterAria}>
            {FILTERS.map(([id, label, enLabel]) => (
              <button key={id} type="button" className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
                {english ? enLabel : label}
                <span>{id === "all" ? reviewableTasks.length : id === "approved" ? approvedCount : id === "changes_requested" ? changesCount : pendingCount}</span>
              </button>
            ))}
          </div>
          <div className="commerce-ops__queue-list">
            {filteredTasks.length ? filteredTasks.map((task) => {
              const status = reviewStatus(reviewsByTask[task.id]);
              const [label, StatusIcon] = statusCopy(status, english);
              const output = taskOutput(task);
              return (
                <article key={task.id} className={`${selectedTaskId === task.id ? "is-selected" : ""} is-${status}`}>
                  <button type="button" className="commerce-ops__queue-select" onClick={() => { setSelectedTaskId(task.id); setNotice(""); }}>
                    <span className="commerce-ops__queue-image">
                      <AuthenticatedImage src={output} alt={modeLabel(task, english)} maxDimension={360} />
                    </span>
                    <span className="commerce-ops__queue-copy">
                      <small>{modeLabel(task, english)}</small>
                      <strong>{task.params?.productName || task.params?.title || t.unnamed}</strong>
                      <span>{formatDate(task.finishedAt || task.createdAt, english)}</span>
                    </span>
                    <span className={`commerce-ops__status is-${status}`}><StatusIcon size={14} />{label}</span>
                  </button>
                  <button type="button" className="commerce-ops__preview" title={t.previewTitle} onClick={() => onPreview?.(output)}>
                    <Eye size={17} />
                  </button>
                </article>
              );
            }) : (
              <div className="commerce-ops__empty">
                <FileCheck2 size={30} />
                <strong>{reviewableTasks.length ? t.noFiltered : t.noAssets}</strong>
                <span>{t.noAssetsHint}</span>
                <button type="button" onClick={() => onStartMode?.("shoot")}><Play size={16} />{t.startShoot}</button>
              </div>
            )}
          </div>
        </section>

        <aside className="commerce-ops__inspector">
          {selectedTask ? (
            <>
              <header>
                <div>
                  <small>{t.reviewGate}</small>
                  <h2>{t.reviewTitle}</h2>
                </div>
                <span>{completedChecks}/{QA_CHECKS.length}</span>
              </header>
              <button type="button" className="commerce-ops__selected-image" onClick={() => onPreview?.(taskOutput(selectedTask))}>
                <AuthenticatedImage src={taskOutput(selectedTask)} alt={t.currentAlt} maxDimension={720} />
                <span><Eye size={16} />{t.viewOriginal}</span>
              </button>
              <div className="commerce-ops__checklist">
                {QA_CHECKS.map((item) => (
                  <label key={item.id}>
                    <input type="checkbox" checked={Boolean(checklist[item.id])} onChange={(event) => setChecklist((current) => ({ ...current, [item.id]: event.target.checked }))} />
                    <span className="commerce-ops__checkmark"><Check size={14} /></span>
                    <span><strong>{english ? item.enLabel : item.label}</strong><small>{english ? item.enHint : item.hint}</small></span>
                  </label>
                ))}
              </div>
              <label className="commerce-ops__field">
                <span>{t.targetChannel}</span>
                <input value={channel} maxLength={80} onChange={(event) => setChannel(event.target.value)} placeholder={t.channelPlaceholder} />
              </label>
              <label className="commerce-ops__field">
                <span>{t.reviewNote}</span>
                <textarea value={note} maxLength={800} onChange={(event) => setNote(event.target.value)} placeholder={t.notePlaceholder} />
                <small>{note.length}/800</small>
              </label>
              {notice && <p className="commerce-ops__notice"><CheckCircle2 size={15} />{notice}</p>}
              <div className="commerce-ops__review-actions">
                <button type="button" disabled={saving} onClick={() => void save("pending")}>{t.saveDraft}</button>
                <button type="button" className="warning" disabled={saving || note.trim().length < 2} onClick={() => void save("changes_requested")}>
                  <AlertTriangle size={16} />{t.requestChanges}
                </button>
                <button type="button" className="approve" disabled={saving || !allChecked} onClick={() => void save("approved")}>
                  <ShieldCheck size={16} />{t.approveDelivery}
                </button>
              </div>
            </>
          ) : (
            <div className="commerce-ops__inspector-empty">
              <ShieldCheck size={34} />
              <strong>{t.selectAsset}</strong>
              <span>{t.selectHint}</span>
            </div>
          )}
        </aside>
      </div>

      <section className="commerce-ops__quick-actions">
        <button type="button" onClick={onOpenProducts}><Boxes size={18} /><span><strong>{t.truthAction}</strong><small>{t.truthActionHint}</small></span><ArrowRight size={16} /></button>
        <button type="button" onClick={() => onStartMode?.("listing")}><Images size={18} /><span><strong>{t.listingAction}</strong><small>{t.listingActionHint}</small></span><ArrowRight size={16} /></button>
        <button type="button" onClick={onOpenAssets}><FileCheck2 size={18} /><span><strong>{t.assetAction}</strong><small>{t.assetActionHint}</small></span><ArrowRight size={16} /></button>
      </section>
    </section>
  );
}
