import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import {
  compressImageFile,
  downloadBlob,
  formatBytes,
  outputFilename,
  savingsPercent,
  terminateCompressWorker,
} from "@legacy/features/image-compress/compressEngine.js";
import { taskCoverUrl, taskOriginalUrl } from "@legacy/features/creator-hub/taskMedia.js";
import { fetchRuntimeConfig } from "@legacy/services/runtimeConfig.js";
import { getWallet, updateProfile } from "@legacy/services/meApi.js";
import { listTasks } from "@legacy/services/tasksApi.js";
import { removeImageBackground, uploadAiInputFile } from "@legacy/services/aiWallpaper.js";
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from "@legacy/services/authenticatedMedia.js";
import { formatPoints } from "@legacy/services/billingApi.js";
import notificationService from "@legacy/services/notification.js";
import "@react/legacy-styles/generated/views/BackgroundRemoveView.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "./BackgroundRemoveView.css";

const STAGE_META = {
  idle: { label: "等待上传", detail: "选择一张图片开始抠图" },
  ready: { label: "准备就绪", detail: "点击下方按钮移除背景" },
  uploading: { label: "上传原图", detail: "正在安全上传到处理通道" },
  queued: { label: "排队中", detail: "任务已创建，等待算力分配" },
  running: { label: "智能抠图", detail: "正在分离主体与背景" },
  succeeded: { label: "处理完成", detail: "透明 PNG 已就绪，可本页压缩后下载" },
  failed: { label: "处理失败", detail: "可更换图片或重试" },
};
const STAGE_ORDER = ["uploading", "queued", "running", "succeeded"];
const HISTORY_LIMIT = 24;

function imageTools(config = {}) {
  const feature = config.features?.["ai.imageTools"] || {};
  const payload = feature.config && typeof feature.config === "object" ? feature.config : {};
  const models = Array.isArray(payload.backgroundRemovalModels)
    ? payload.backgroundRemovalModels.filter((model) => model?.id)
    : [];
  return {
    enabled: feature.enabled !== false,
    models,
    active: models.find((model) => model.default === true) || models[0] || null,
  };
}

function stageFromTask(task = {}) {
  const status = String(task.status || "").toLowerCase();
  if (["queued", "running", "succeeded"].includes(status)) return status;
  if (["failed", "canceled", "cancelled"].includes(status)) return "failed";
  return "queued";
}

function historyTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CostConfirmDialog({ cost, light, onCancel, onConfirm }) {
  const [skipEveryTime, setSkipEveryTime] = useState(false);
  useEffect(() => {
    if (cost) setSkipEveryTime(false);
  }, [cost]);
  if (!cost) return null;
  const insufficient = cost.available != null && cost.available < cost.total;
  return createPortal(
    <div
      className={`ai-cost-confirm-layer${light ? " is-light" : ""}`}
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section
        className="ai-cost-confirm-panel is-credits"
        role="dialog"
        aria-modal="true"
        aria-labelledby="background-cost-title"
      >
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon"><i className="bi bi-coin" /></span>
          <div className="ai-cost-confirm-titles">
            <span className="ai-cost-confirm-eyebrow">背景移除</span>
            <h5 id="background-cost-title">确认生成费用</h5>
          </div>
          <button type="button" className="ai-cost-confirm-close" aria-label="关闭费用确认" onClick={onCancel}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <p className="ai-cost-confirm-summary">提交后先冻结预计费用，任务完成后按实际生成结果结算。</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total">
            <div className="ai-cost-confirm-total__copy"><span>本次预计</span><small>{cost.unit} 积分 / 张 × 1 张</small></div>
            <strong>{cost.total > 0 ? `${cost.total} 积分` : "按实际用量结算"}</strong>
          </div>
          <div className="ai-cost-confirm-balance">
            <div><span>当前可用</span><strong>{cost.available == null ? "读取中" : `${cost.available} 积分`}</strong></div>
            <i className="bi bi-arrow-right" />
            <div className={insufficient ? "danger" : ""}><span>支付后余额</span><strong>{cost.available == null ? "待计算" : insufficient ? "余额不足" : `${cost.available - cost.total} 积分`}</strong></div>
          </div>
        </div>
        {insufficient && <p className="ai-cost-confirm-warn is-danger"><i className="bi bi-exclamation-circle" />钱包余额不足，请兑换积分后再提交任务。</p>}
        <footer className="ai-cost-confirm-footer">
          <label className="ai-cost-confirm-preference">
            <input type="checkbox" checked={skipEveryTime} onChange={(event) => setSkipEveryTime(event.target.checked)} />
            <span>不再每次确认</span>
          </label>
          <div className="ai-cost-confirm-actions">
            <button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button>
            <button type="button" className="ai-cost-confirm-btn primary" disabled={insufficient} onClick={() => onConfirm({ skipEveryTime })}>确认</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function BackgroundRemoveView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const sourcePreviewRef = useRef("");
  const taskControllerRef = useRef(null);
  const historyControllerRef = useRef(null);
  const compressControllerRef = useRef(null);
  const compressTokenRef = useRef(0);
  const resultCacheRef = useRef({ url: "", file: null });
  const [sourceFile, setSourceFile] = useState(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cost, setCost] = useState(null);
  const [stage, setStage] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultReveal, setResultReveal] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [latestFromHistory, setLatestFromHistory] = useState(false);
  const [compressFormat, setCompressFormat] = useState("png");
  const [compressBusy, setCompressBusy] = useState(false);
  const [compressError, setCompressError] = useState("");
  const [compressStats, setCompressStats] = useState(null);
  const [toolState, setToolState] = useState({ enabled: true, models: [], active: null });

  sourcePreviewRef.current = sourcePreview;
  const activeTool = toolState.active;
  const unitPrice = Math.max(0, Number(activeTool?.pricePoints || 0));
  const canRun = Boolean(sourceFile && activeTool && !processing);
  const meta = STAGE_META[stage] || STAGE_META.idle;
  const stageIndex = stage === "failed" ? 1 : ["ready", "idle"].includes(stage) ? -1 : STAGE_ORDER.indexOf(stage);
  const tone = stage === "failed" ? "danger" : stage === "succeeded" ? "success" : processing ? "busy" : sourceFile ? "ready" : "idle";
  const compressSavings = compressStats
    ? compressStats.afterBytes >= compressStats.beforeBytes
      ? "已是较优体积"
      : `已减小 ${savingsPercent(compressStats.beforeBytes, compressStats.afterBytes)}%`
    : "";

  const releasePreview = useCallback(() => {
    setSourcePreview((current) => {
      if (current.startsWith("blob:")) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  const resetCompression = useCallback(() => {
    compressTokenRef.current += 1;
    compressControllerRef.current?.abort();
    compressControllerRef.current = null;
    setCompressBusy(false);
    setCompressError("");
    setCompressStats(null);
    resultCacheRef.current = { url: "", file: null };
  }, []);

  const showResult = useCallback((url, { historyId = "", fromHistory = false } = {}) => {
    if (!url || !mountedRef.current) return false;
    setResultUrl(url);
    setActiveHistoryId(historyId);
    setLatestFromHistory(fromHistory);
    setErrorMessage("");
    setStage("succeeded");
    setResultReveal(false);
    requestAnimationFrame(() => mountedRef.current && setResultReveal(true));
    return true;
  }, []);

  const selectFile = useCallback((file, { notifyPaste = false } = {}) => {
    if (!file || processing) return;
    if (!String(file.type || "").startsWith("image/")) {
      notificationService.warning("请选择 PNG、JPG 或 WebP 图片");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notificationService.warning("图片不能超过 15MB");
      return;
    }
    releasePreview();
    const preview = URL.createObjectURL(file);
    setSourceFile(file);
    setSourcePreview(preview);
    setResultUrl("");
    setResultReveal(false);
    setErrorMessage("");
    setActiveHistoryId("");
    setLatestFromHistory(false);
    resetCompression();
    setStage("ready");
    if (notifyPaste) notificationService.success("已粘贴截图");
  }, [processing, releasePreview, resetCompression]);

  const clearImage = useCallback(() => {
    if (processing) return;
    releasePreview();
    setSourceFile(null);
    setResultUrl("");
    setResultReveal(false);
    setErrorMessage("");
    setActiveHistoryId("");
    setLatestFromHistory(false);
    resetCompression();
    setStage("idle");
  }, [processing, releasePreview, resetCompression]);

  const loadHistory = useCallback(async ({ silent = false, showLatest = false } = {}) => {
    if (!auth.isAuthenticated) {
      setHistoryItems([]);
      setHistoryError(silent ? "" : "登录后可查看抠图历史");
      return [];
    }
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    if (!silent) setHistoryError("");
    try {
      const { items } = await listTasks({
        type: "background_remove",
        status: "succeeded",
        limit: HISTORY_LIMIT,
        signal: controller.signal,
      });
      const next = (items || []).filter((task) => taskOriginalUrl(task) || taskCoverUrl(task));
      if (!mountedRef.current || controller.signal.aborted) return [];
      setHistoryItems(next);
      if (showLatest && !sourceFile && !resultUrl && next[0]) {
        showResult(taskOriginalUrl(next[0]) || taskCoverUrl(next[0]), {
          historyId: next[0].id,
          fromHistory: true,
        });
      }
      return next;
    } catch (error) {
      if (error?.name === "AbortError") return [];
      if (mountedRef.current) {
        setHistoryError(error?.message || "历史记录读取失败");
        if (!silent) notificationService.error(error?.message || "历史记录读取失败");
      }
      return [];
    } finally {
      if (mountedRef.current && historyControllerRef.current === controller) setHistoryLoading(false);
    }
  }, [auth.isAuthenticated, resultUrl, showResult, sourceFile]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    fetchRuntimeConfig()
      .then((config) => !disposed && setToolState(imageTools(config)))
      .catch(() => undefined);
    void loadHistory({ silent: true, showLatest: true });
    return () => {
      disposed = true;
      mountedRef.current = false;
      taskControllerRef.current?.abort();
      historyControllerRef.current?.abort();
      compressControllerRef.current?.abort();
      const preview = sourcePreviewRef.current;
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
      terminateCompressWorker();
    };
    // Initial history restore is intentionally one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPaste = (event) => {
      if (processing || cost || historyOpen) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const image = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type?.startsWith("image/"))
        .map((item) => item.getAsFile())
        .find(Boolean);
      if (!image) return;
      event.preventDefault();
      const ext = image.type.includes("jpeg") ? "jpg" : image.type.includes("webp") ? "webp" : "png";
      const named = image.name && image.name !== "image.png"
        ? image
        : new File([image], `paste-${Date.now()}.${ext}`, { type: image.type || "image/png" });
      selectFile(named, { notifyPaste: true });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [cost, historyOpen, processing, selectFile]);

  const loadResultFile = useCallback(async (signal) => {
    if (!resultUrl) throw new Error("还没有抠图结果");
    if (resultCacheRef.current.url === resultUrl && resultCacheRef.current.file) {
      return resultCacheRef.current.file;
    }
    const blob = await fetchAuthenticatedMediaBlob(resultUrl, { cache: "no-store", signal });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const file = new File([blob], `background-removed-${Date.now()}.png`, {
      type: blob.type || "image/png",
    });
    resultCacheRef.current = { url: resultUrl, file };
    return file;
  }, [resultUrl]);

  const prepareCompression = useCallback(async () => {
    if (!resultUrl || processing) return null;
    const token = ++compressTokenRef.current;
    compressControllerRef.current?.abort();
    const controller = new AbortController();
    compressControllerRef.current = controller;
    setCompressBusy(true);
    setCompressError("");
    try {
      const file = await loadResultFile(controller.signal);
      const result = await compressImageFile(file, {
        format: compressFormat,
        intensity: "balanced",
        keepIfLarger: true,
        signal: controller.signal,
      });
      if (!mountedRef.current || token !== compressTokenRef.current || controller.signal.aborted) return null;
      const stats = {
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        format: result.format,
        blob: result.blob,
        keptOriginal: result.keptOriginal,
        filename: outputFilename(file.name, result.format),
      };
      setCompressStats(stats);
      return stats;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (mountedRef.current && token === compressTokenRef.current) {
        setCompressStats(null);
        setCompressError(error?.message || "压缩预览失败");
      }
      return null;
    } finally {
      if (mountedRef.current && token === compressTokenRef.current) setCompressBusy(false);
    }
  }, [compressFormat, loadResultFile, processing, resultUrl]);

  useEffect(() => {
    resetCompression();
    if (resultUrl) void prepareCompression();
  }, [compressFormat, prepareCompression, resetCompression, resultUrl]);

  const executeRemoval = useCallback(async () => {
    if (!canRun) return;
    setCost(null);
    taskControllerRef.current?.abort();
    const controller = new AbortController();
    taskControllerRef.current = controller;
    setProcessing(true);
    setResultUrl("");
    setResultReveal(false);
    setErrorMessage("");
    setActiveHistoryId("");
    setLatestFromHistory(false);
    setStage("uploading");
    try {
      const uploadedUrl = await uploadAiInputFile(sourceFile, { signal: controller.signal });
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      setStage("queued");
      const response = await removeImageBackground(uploadedUrl, activeTool.id, {
        signal: controller.signal,
        onUpdate(task) {
          if (mountedRef.current && !controller.signal.aborted) setStage(stageFromTask(task));
        },
      });
      const completed = response?.task || null;
      const output =
        response?.result?.outputs?.[0] ||
        response?.job?.originalMediaUrls?.[0] ||
        taskOriginalUrl(completed) ||
        "";
      if (!output) throw new Error("任务已完成，但没有返回图片");
      showResult(output, { historyId: completed?.id || "" });
      if (completed) {
        setHistoryItems((current) => [completed, ...current.filter((item) => item.id !== completed.id)].slice(0, HISTORY_LIMIT));
      } else {
        void loadHistory({ silent: true });
      }
      notificationService.success("背景已移除");
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current) {
        setStage("failed");
        setErrorMessage(error?.message || "背景移除失败");
        notificationService.error(error?.message || "背景移除失败");
      }
    } finally {
      if (mountedRef.current && taskControllerRef.current === controller) setProcessing(false);
    }
  }, [activeTool, canRun, loadHistory, showResult, sourceFile]);

  const requestRemoval = useCallback(async () => {
    if (!canRun) return;
    if (auth.user?.requireCostConfirm === false) {
      await executeRemoval();
      return;
    }
    let available = null;
    try {
      const wallet = await getWallet();
      const value = Number(wallet?.availableCents ?? wallet?.balanceCents ?? wallet?.availablePoints);
      if (Number.isFinite(value)) available = Math.max(0, value);
    } catch { /* the task service remains authoritative */ }
    setCost({ unit: unitPrice, total: unitPrice, available });
  }, [auth.user?.requireCostConfirm, canRun, executeRemoval, unitPrice]);

  const confirmRemovalCost = useCallback(async ({ skipEveryTime = false } = {}) => {
    setCost(null);
    if (skipEveryTime) {
      try {
        const result = await updateProfile({ requireCostConfirm: false });
        auth.setUser((current) => ({
          ...(current || {}),
          ...(result?.user || { requireCostConfirm: false }),
        }));
      } catch {
        // Preference persistence must not block the confirmed removal task.
      }
    }
    await executeRemoval();
  }, [auth, executeRemoval]);

  const downloadCompressed = useCallback(async () => {
    if (!resultUrl || compressBusy || processing) return;
    try {
      const stats = compressStats?.blob && compressStats.format === compressFormat
        ? compressStats
        : await prepareCompression();
      if (!stats?.blob) throw new Error(compressError || "压缩失败");
      downloadBlob(stats.blob, stats.filename);
      notificationService.success(
        stats.keptOriginal || stats.afterBytes >= stats.beforeBytes
          ? "已下载（体积已接近最优）"
          : `已下载压缩结果，减小 ${savingsPercent(stats.beforeBytes, stats.afterBytes)}%`,
      );
    } catch (error) {
      notificationService.error(error?.message || "压缩下载失败");
    }
  }, [compressBusy, compressError, compressFormat, compressStats, prepareCompression, processing, resultUrl]);

  const openHistory = () => {
    setHistoryOpen(true);
    if (!historyItems.length) void loadHistory();
  };
  const selectHistory = (task) => {
    if (processing) return;
    const url = taskOriginalUrl(task) || taskCoverUrl(task);
    if (!url) return;
    showResult(url, { historyId: task.id, fromHistory: true });
    setHistoryOpen(false);
  };

  return (
    <main className={`br${isDark ? " is-dark" : ""}${processing ? " is-processing" : ""}${stage === "succeeded" ? " is-done" : ""}${stage === "failed" ? " is-failed" : ""}`}>
      <div className="br-glow" aria-hidden="true" />
      <header className="br-header">
        <div className="br-header__copy">
          <span className="br-kicker"><i className="bi bi-scissors" />图片工具</span>
          <h1>背景移除</h1>
          <p>上传商品或人像图，一键保留主体；抠图完成后可在本页直接压缩下载，无需跳转。</p>
          <div className="br-meta">
            <span className="br-chip"><i className="bi bi-filetype-png" />透明 PNG</span>
            <span className="br-chip"><i className="bi bi-download" />本页压缩下载</span>
            <span className="br-chip"><i className="bi bi-image" />最大 15MB</span>
            <span className="br-chip"><i className="bi bi-clipboard-check" />支持粘贴截图</span>
            {activeTool ? <span className="br-chip is-price"><i className="bi bi-coin" />{formatPoints(unitPrice)} / 张</span> : <span className="br-chip is-warn">工具未开放</span>}
          </div>
        </div>
        <aside className="br-status" data-tone={tone} aria-live="polite">
          <div className="br-status__pulse" />
          <div className="br-status__copy"><small>当前状态</small><strong>{meta.label}</strong><p>{errorMessage || meta.detail}</p></div>
          <ol className="br-steps" aria-label="处理进度">
            {STAGE_ORDER.map((key, index) => <li key={key} className={`${stageIndex > index || (stage === "succeeded" && index === STAGE_ORDER.length - 1) ? "is-done" : ""}${stageIndex === index ? " is-active" : ""}`}><span>{STAGE_META[key].label}</span></li>)}
          </ol>
        </aside>
      </header>

      <section className="br-workspace" aria-label="背景移除工作区">
        <div className={`br-pane${dragging ? " is-dragging" : ""}${sourcePreview ? " has-image" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files?.[0]); }}>
          <div className="br-pane__head"><strong>原图</strong>{sourceFile && <span>{sourceFile.name}</span>}{sourceFile && <button type="button" className="br-ghost" disabled={processing} onClick={clearImage}><i className="bi bi-trash3" />清空</button>}</div>
          {!sourcePreview ? <button type="button" className="br-dropzone" onClick={() => fileInputRef.current?.click()}><span className="br-dropzone__icon"><i className="bi bi-cloud-arrow-up" /></span><strong>上传图片</strong><span>点击选择、拖入文件，或按 Ctrl/⌘ + V 粘贴截图</span></button> : <div className="br-frame"><img src={sourcePreview} alt="待处理原图" /><>{processing && <div className="br-scan"><span className="br-scan__beam" /><span className="br-scan__veil" /></div>}</><button type="button" className="br-frame__action" disabled={processing} onClick={() => fileInputRef.current?.click()}><i className="bi bi-arrow-repeat" />更换</button></div>}
        </div>
        <div className="br-bridge" aria-hidden="true"><div className="br-bridge__rail">{Array.from({ length: 5 }, (_, index) => <span key={index} className="br-bridge__dot" />)}</div><div className="br-bridge__orb"><i className={`bi ${processing ? "bi-hourglass-split" : resultUrl ? "bi-check-lg" : "bi-scissors"}`} /></div></div>
        <div className={`br-pane is-result${resultUrl ? " has-result" : ""}`}>
          <div className="br-pane__head"><strong>透明结果</strong>{resultUrl ? <span>{latestFromHistory ? "最近一张结果" : "PNG · 透明通道"}</span> : processing ? <span>处理中</span> : null}<button type="button" className="br-ghost" onClick={openHistory}><i className="bi bi-clock-history" />查看历史</button></div>
          {resultUrl ? <div className={`br-frame is-checker${resultReveal ? " is-reveal" : ""}`}><AuthenticatedImage className="br-result-image" src={resultUrl} alt="背景移除结果" loading="eager" maxDimension={1600} /><div className="br-frame__badge"><i className="bi bi-check2-circle" />{latestFromHistory ? "历史结果" : "已抠图"}</div></div> : <div className={`br-empty${processing ? " is-busy" : ""}`}><div className="br-loader"><span className="br-loader__ring" /><span className="br-loader__ring is-delay" /><span className="br-loader__core"><i className={`bi ${processing ? "bi-magic" : "bi-person-bounding-box"}`} /></span></div><strong>{processing ? meta.label : "结果将在这里显示"}</strong><p>{processing ? meta.detail : "移除背景后可预览、本页压缩并下载"}</p>{processing && <div className="br-progress"><span /></div>}</div>}
        </div>
      </section>

      {resultUrl && <section className="br-compress" aria-label="本页压缩下载"><div className="br-compress__copy"><strong><i className="bi bi-arrows-collapse" />抠图后压缩</strong><p>{compressBusy ? "正在本地压缩预览…" : compressError ? compressError : compressStats ? <>{formatBytes(compressStats.beforeBytes)} → {formatBytes(compressStats.afterBytes)}{compressSavings ? ` · ${compressSavings}` : ""} · 本地处理，不离开本页</> : "可直接压缩透明结果后再下载"}</p></div><div className="br-compress__controls"><div className="br-compress__formats" role="group" aria-label="压缩格式"><button type="button" className={`br-seg${compressFormat === "png" ? " is-on" : ""}`} disabled={compressBusy || processing} onClick={() => setCompressFormat("png")}>PNG 无损</button><button type="button" className={`br-seg${compressFormat === "webp" ? " is-on" : ""}`} disabled={compressBusy || processing} onClick={() => setCompressFormat("webp")}>WebP</button></div><button type="button" className="br-btn is-primary" disabled={!resultUrl || compressBusy || processing} onClick={downloadCompressed}><i className={`bi ${compressBusy ? "bi-arrow-repeat br-spin" : "bi-download"}`} />{compressBusy ? "压缩中…" : "压缩并下载"}</button></div></section>}

      <footer className="br-actions"><div className="br-actions__hint">{!activeTool ? "后台尚未开放背景移除工具" : processing ? "请保持页面打开，完成后可本页压缩下载" : resultUrl && latestFromHistory ? "正在显示最近一张抠图结果；可本页压缩，或上传新图继续处理" : resultUrl ? "结果已生成，可本页压缩下载，无需跳转图片压缩页" : "支持拖入与粘贴截图；上传后按张扣积分，失败或取消会自动返还"}</div><div className="br-actions__btns"><button type="button" className="br-btn is-primary" disabled={!canRun} onClick={requestRemoval}><i className={`bi ${processing ? "bi-arrow-repeat br-spin" : "bi-magic"}`} />{processing ? "处理中…" : stage === "failed" ? "重新移除背景" : "移除背景"}</button><button type="button" className="br-btn is-secondary" disabled={!resultUrl || processing} onClick={() => downloadAuthenticatedMedia(resultUrl, `background-removed-${Date.now()}.png`)}><i className="bi bi-download" />原图下载</button><button type="button" className="br-btn is-secondary" disabled={!resultUrl || compressBusy || processing} onClick={downloadCompressed}><i className="bi bi-download" />压缩下载</button></div></footer>

      {historyOpen && createPortal(<div className={`br-history${isDark ? " is-dark" : ""}`} role="dialog" aria-modal="true" aria-label="抠图历史"><button type="button" className="br-history__backdrop" aria-label="关闭历史" onClick={() => setHistoryOpen(false)} /><aside className="br-history__panel"><header className="br-history__head"><div><strong>抠图历史</strong><span>{historyItems.length ? `${historyItems.length} 张` : "暂无"}</span></div><div className="br-history__head-actions"><button type="button" className="br-ghost" disabled={historyLoading} onClick={() => loadHistory()}><i className={`bi bi-arrow-clockwise${historyLoading ? " br-spin" : ""}`} />刷新</button><button type="button" className="br-ghost" onClick={() => setHistoryOpen(false)}><i className="bi bi-x-lg" />关闭</button></div></header>{historyLoading && !historyItems.length ? <div className="br-history__empty"><i className="bi bi-arrow-repeat br-spin" /><p>正在加载历史…</p></div> : historyError && !historyItems.length ? <div className="br-history__empty"><p>{historyError}</p><button type="button" className="br-btn is-secondary" onClick={() => loadHistory()}>重新加载</button></div> : !historyItems.length ? <div className="br-history__empty"><i className="bi bi-images" /><strong>还没有抠图记录</strong><p>完成一次背景移除后，结果会出现在这里</p></div> : <div className="br-history__grid" role="list">{historyItems.map((item) => <button key={item.id} type="button" className={`br-history__card${activeHistoryId === item.id ? " is-active" : ""}`} role="listitem" disabled={processing} onClick={() => selectHistory(item)}><span className="br-history__thumb is-checker"><AuthenticatedImage src={taskCoverUrl(item)} alt="历史抠图结果" maxDimension={320} /></span><span className="br-history__meta"><strong>{historyTime(item.finishedAt || item.createdAt) || "已完成"}</strong><small>点击查看</small></span></button>)}</div>}</aside></div>, document.body)}

      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
      <CostConfirmDialog cost={cost} light={!isDark} onCancel={() => setCost(null)} onConfirm={confirmRemovalCost} />
    </main>
  );
}
