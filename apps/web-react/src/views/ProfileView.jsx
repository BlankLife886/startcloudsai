import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ArrowUpRight } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { getOverview, getWallet, listUserAssets, updateProfile } from "@react/legacy-modules/services/meApi.js";
import { logoutAccount } from "@react/legacy-modules/services/auth.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import { TASK_TYPE_LABELS, TASK_UPDATE_EVENT, uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { getFeatureUnitPriceCents } from "@react/legacy-modules/services/pricing.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import {
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveT2iOutputSize } from "@react/legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import {
  createServerAiJob,
  getServerAiJob,
  listServerAiJobs,
  taskToLegacyJob,
  uploadAiInputFile,
  waitForServerAiJob,
} from "@react/legacy-modules/services/aiWallpaper.js";
import { fetchAuthenticatedMediaBlob, isAuthenticatedAiMediaUrl } from "@react/legacy-modules/services/authenticatedMedia.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "@react/legacy-static/views/ProfileView.modern.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { LogoutDialog } from "../components/LogoutDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import {
  DRESSUP_CATEGORIES,
  buildDressupSourcePlan,
  dressupSlotSummary,
  emptyDressupSelection,
  emptyDressupSlot,
  isDressupSlotFilled,
  revokeDressupPreview,
  revokeDressupSelection,
  selectedDressupSlots,
  serializeDressupSelection,
} from "./profileStudioDressup.js";

gsap.registerPlugin(useGSAP);

const DEFAULT_STUDIO_FIGURE = "/sucai/profile-hero-character.png?v=4";
const STUDIO_FIGURE_RATIO = 1360 / 2048;
const STUDIO_FIGURE_MAX_HEIGHT = 2048;
const STUDIO_FIGURE_MAX_BYTES = 10 * 1024 * 1024;
const STUDIO_FIGURE_PROMPT =
  "根据用户上传的参考图生成一张全身站立角色立绘，严格保留参考人物的外貌、发型、服装、配色与气质。固定 2:3 竖构图，全身入镜，高像素高清二次元插画。透明背景，移除背景。不要任何场景、地面、圆形或椭圆平台、展示台、光圈、光效背景、阴影底板、角色周围的圆形或椭圆边框、立绘外框、轮廓线或文字。no oval frame, no circular border, no standing platform, no vignette. 人物边缘干净，适合直接作为个人工作室形象。";
const FIGURE_JOB_STORAGE_PREFIX = "starclouds.profile-studio-figure:";
const applyingFigureJobs = new Map();

function figureJobStorageKey(userId) {
  return `${FIGURE_JOB_STORAGE_PREFIX}${String(userId || "").trim()}`;
}

function readFigureJob(userId) {
  if (!userId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(figureJobStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    const jobId = String(parsed.jobId || "").trim();
    if (!jobId) return null;
    return {
      jobId,
      phase: String(parsed.phase || "running"),
      error: String(parsed.error || ""),
      outputUrl: String(parsed.outputUrl || ""),
      mode: String(parsed.mode || "reference") === "outfit" ? "outfit" : "reference",
    };
  } catch {
    return null;
  }
}

function writeFigureJob(userId, job) {
  if (!userId || typeof localStorage === "undefined") return;
  const jobId = String(job?.jobId || "").trim();
  if (!jobId) return;
  localStorage.setItem(
    figureJobStorageKey(userId),
    JSON.stringify({
      jobId,
      phase: String(job.phase || "running"),
      error: String(job.error || ""),
      outputUrl: String(job.outputUrl || ""),
      mode: String(job.mode || "reference") === "outfit" ? "outfit" : "reference",
    }),
  );
}

function clearFigureJob(userId) {
  if (!userId || typeof localStorage === "undefined") return;
  localStorage.removeItem(figureJobStorageKey(userId));
}

function isProfileStudioJob(job = {}) {
  const params = job.params && typeof job.params === "object" ? job.params : {};
  const input = job.input && typeof job.input === "object" ? job.input : {};
  const source = String(params._source || input._source || "").trim().toLowerCase();
  const kind = String(params._kind || input._kind || job.kind || "").trim().toLowerCase();
  return source === "profile_studio" || kind === "profile-studio-figure" || kind === "profile-studio-outfit";
}

function isOutfitStudioJob(job = {}) {
  const params = job.params && typeof job.params === "object" ? job.params : {};
  const input = job.input && typeof job.input === "object" ? job.input : {};
  const kind = String(params._kind || input._kind || job.kind || "").trim().toLowerCase();
  return kind === "profile-studio-outfit";
}

function isActiveFigureJob(job = {}) {
  const status = String(job.status || "").toLowerCase();
  return ["queued", "running", "waiting_provider"].includes(status);
}

function isFailedFigureJob(job = {}) {
  const status = String(job.status || "").toLowerCase();
  return ["failed", "cancelled", "canceled"].includes(status);
}

function uniqueUrls(...groups) {
  return Array.from(
    new Set(
      groups
        .flat()
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function originalFileUrlFromAny(value) {
  const url = siteFileUrl(value) || String(value || "").trim();
  if (!url) return "";
  const variant = url.match(/^(.*\/)(?:display|thumb)\/([^/?#]+)$/i);
  if (!variant) return url;
  const name = String(variant[2] || "").replace(/\.[a-z0-9]+$/i, "");
  return name ? `${variant[1]}original/${name}.png` : url;
}

function studioFigureCandidateUrls(completed = {}) {
  const job = completed.job && typeof completed.job === "object" ? completed.job : {};
  const result = completed.result && typeof completed.result === "object" ? completed.result : {};
  const fromKeys = (Array.isArray(job.outputKeys) ? job.outputKeys : [])
    .map((key) => String(key || "").replace(/^\/+/, "").trim())
    .filter(Boolean)
    .map((key) => `/api/v1/files/${key}`);
  return uniqueUrls(
    fromKeys,
    job.originalMediaUrls,
    job.originalMediaUrl,
    result.outputs,
    job.displayMediaUrls,
    job.displayMediaUrl,
    job.resultMediaUrls,
    job.resultMediaUrl,
  );
}

function studioFigureOutputUrls(completed = {}) {
  const originals = studioFigureCandidateUrls(completed)
    .map((url) => originalFileUrlFromAny(url) || siteFileUrl(url) || String(url || "").trim())
    .filter((url) => /\/original\//i.test(url));
  if (originals.length) return originals;
  return studioFigureCandidateUrls(completed)
    .map((url) => siteFileUrl(url) || String(url || "").trim())
    .filter((url) => /\/api\/v1\/files\//i.test(url));
}

function isSavedFigureForJob(url, jobId) {
  const value = String(url || "");
  const id = String(jobId || "").trim();
  return Boolean(id && value.includes(`studio-figure-${id}`));
}

function siteFileUrl(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/\/api\/v1\/files\/[^?#]+/);
  return match ? match[0] : "";
}

function fileUrlFromUpload(upload = {}) {
  const key = String(upload.key || "").replace(/^\/+/, "").trim();
  if (key) return `/api/v1/files/${key}`;
  return siteFileUrl(upload.url);
}

function studioFigurePersistUrl(urls, job = {}) {
  const keys = Array.isArray(job.outputKeys) ? job.outputKeys : [];
  const fromKeys = keys
    .map((key) => String(key || "").replace(/^\/+/, "").trim())
    .filter(Boolean)
    .map((key) => `/api/v1/files/${key}`);
  const list = uniqueUrls(fromKeys, urls)
    .map((url) => originalFileUrlFromAny(url))
    .filter((url) => /\/original\//i.test(url));
  return (
    list.find((url) => /\/files\/tasks\/[^/?#]+\/[^/?#]+\/original\//i.test(url)) ||
    list.find((url) => /\/files\/uploads\/[^/?#]+\/original\//i.test(url)) ||
    list[0] ||
    ""
  );
}

function asImageFile(blob, name = `studio-figure-${Date.now()}.png`) {
  const type = String(blob?.type || "").toLowerCase().startsWith("image/")
    ? blob.type
    : "image/png";
  return new File([blob], name, { type });
}

function loadFigureImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("形象图片读取失败"));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function createStudioFigureUpload(file) {
  if (!file) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  const image = await loadFigureImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理形象图片");
  let maxHeight = STUDIO_FIGURE_MAX_HEIGHT;
  let blob = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const height = maxHeight;
    const width = Math.round(height * STUDIO_FIGURE_RATIO);
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const dw = Math.max(1, Math.round(image.naturalWidth * scale));
    const dh = Math.max(1, Math.round(image.naturalHeight * scale));
    const dx = Math.round((width - dw) / 2);
    const dy = Math.round(height - dh);
    context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, dx, dy, dw, dh);
    blob = await canvasToBlob(canvas, "image/png");
    if (blob && blob.size <= STUDIO_FIGURE_MAX_BYTES) break;
    maxHeight = Math.round(maxHeight * 0.82);
    blob = null;
  }
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("形象处理失败");
  return new File([blob], `studio-figure-${Date.now()}.png`, { type: "image/png" });
}

async function readGeneratedFigureBlob(urls) {
  const list = uniqueUrls(urls);
  let lastError = null;
  for (let index = 0; index < list.length; index += 1) {
    const url = list[index];
    const fallbackUrl = list[index + 1] || "";
    try {
      return await fetchAuthenticatedMediaBlob(url, { fallbackUrl });
    } catch (error) {
      lastError = error;
      try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (blob.size) return blob;
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
  }
  throw lastError || new Error("生成结果为空");
}

function isGptImage2Model(item = {}) {
  const values = [item.id, item.publicModelKey, item.model, item.upstreamModel, item.label, item.name]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return values.some((value) => value.includes("gpt-image-2") || value.includes("gptimage2"));
}

function modelAllowsTransparentBackground(item = {}) {
  return isGptImage2Model(item) || item.transparentBackground === true;
}

async function resolveStudioFigurePlan() {
  const config = await fetchRuntimeConfig();
  const feature = config.features?.["ai.wallpaperGeneration"] || {};
  const merged =
    feature.config && typeof feature.config === "object"
      ? { ...feature, ...feature.config }
      : feature;
  const models = Array.isArray(merged.publicModels) ? merged.publicModels : [];
  const usable = models
    .map((item) => {
      const id = String(item?.id || item?.publicModelKey || item?.model || "").trim();
      if (!id) return null;
      const capabilities = normalizeImageModelCapabilities(item);
      if (capabilities.maxReferenceImages < 1) return null;
      if (!modelAllowsTransparentBackground(item)) return null;
      const resolutionScale =
        ["2K", "4K", "1K"].find((scale) => {
          if (!capabilities.resolutions.includes(scale)) return false;
          return getModelAspectRatiosForResolution(item, scale).includes("2:3");
        }) || "";
      if (!resolutionScale) return null;
      return { item, id, capabilities, resolutionScale };
    })
    .filter(Boolean);
  const model =
    usable.find((entry) => isGptImage2Model(entry.item) && entry.resolutionScale === "2K") ||
    usable.find((entry) => isGptImage2Model(entry.item)) ||
    usable.find((entry) => entry.resolutionScale === "2K") ||
    usable[0];
  if (!model) throw new Error("当前没有支持透明背景的参考生成模型（需要 gpt-image-2）");
  const qualities = model.capabilities.qualities || [];
  const quality = qualities.includes("high")
    ? "high"
    : qualities.includes("medium")
      ? "medium"
      : qualities[0] || "";
  const canPng = model.capabilities.outputFormats.includes("png");
  const pointPricing = resolveModelPointPricing(model.item);
  const creditCost = Math.max(0, Number(pointPricing.effective ?? merged.creditCost ?? 0));
  return {
    id: model.id,
    creditCost,
    pointPricing,
    resolutionScale: model.resolutionScale,
    quality,
    outputFormat: canPng ? "png" : "",
  };
}

function FigureCostDialog({ cost, isDark, onCancel, onConfirm }) {
  if (!cost) return null;
  const insufficient = cost.available != null && cost.available < cost.total;
  return createPortal(
    <div
      className={`ai-cost-confirm-layer is-elevated pp-figure-cost${isDark ? "" : " is-light"}`}
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section
        className="ai-cost-confirm-panel is-credits"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-figure-cost-title"
      >
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon">
            <i className="bi bi-coin" />
          </span>
          <div className="ai-cost-confirm-titles">
            <span className="ai-cost-confirm-eyebrow">{cost.mode === "outfit" ? "装扮" : "参考生成"}</span>
            <h5 id="profile-figure-cost-title">确认生成费用</h5>
          </div>
          <button
            type="button"
            className="ai-cost-confirm-close"
            aria-label="关闭费用确认"
            onClick={onCancel}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <p className="ai-cost-confirm-summary">
          {cost.mode === "outfit"
            ? "将以当前立绘为参考图，按你上传的配件图或填写的描述生成一张 2:3 高清透明底立绘。"
            : "将按你上传的参考图，用 gpt-image-2 生成一张 2:3 高清透明底立绘。"}
        </p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total">
            <div className="ai-cost-confirm-total__copy">
              <span>本次预计</span>
              <small>{cost.unit} 积分 / 张 × 1 张</small>
            </div>
            <strong>{cost.total > 0 ? `${cost.total} 积分` : "按实际用量结算"}</strong>
          </div>
          <div className="ai-cost-confirm-balance">
            <div>
              <span>当前可用</span>
              <strong>{cost.available == null ? "读取中" : `${cost.available} 积分`}</strong>
            </div>
            <i className="bi bi-arrow-right" />
            <div className={insufficient ? "danger" : ""}>
              <span>支付后余额</span>
              <strong>
                {cost.available == null
                  ? "待计算"
                  : insufficient
                    ? "余额不足"
                    : `${cost.available - cost.total} 积分`}
              </strong>
            </div>
          </div>
        </div>
        {insufficient ? (
          <p className="ai-cost-confirm-warn is-danger">
            <i className="bi bi-exclamation-circle" />
            钱包余额不足，请兑换积分后再生成。
          </p>
        ) : null}
        <footer className="ai-cost-confirm-footer is-no-preference">
          <div className="ai-cost-confirm-actions">
            <button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="ai-cost-confirm-btn primary"
              disabled={insufficient || cost.loading}
              onClick={onConfirm}
            >
              {cost.loading ? "读取费用…" : "确认生成"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function DressupMedia({ src, alt = "", fallbackSrc = "" }) {
  if (!src) return null;
  if (isAuthenticatedAiMediaUrl(src) || isAuthenticatedAiMediaUrl(fallbackSrc)) {
    return <AuthenticatedImage src={src} fallbackSrc={fallbackSrc} alt={alt} />;
  }
  return <img src={src} alt={alt} />;
}

const DRESSUP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

function StudioDressupDialog({
  open,
  busy,
  isDark,
  figureSrc,
  figureFallbackSrc,
  previewSrc,
  note,
  selection,
  categoryId,
  onCategory,
  onSlotChange,
  onClearSlot,
  onReset,
  onClose,
  onConfirm,
  onUsePreview,
  onDiscardPreview,
  onRetry,
  closeLocked,
}) {
  const fileInputRef = useRef(null);
  const [assetOpen, setAssetOpen] = useState(false);
  const [assets, setAssets] = useState({ loading: false, items: [], nextCursor: "", error: "" });
  const active = DRESSUP_CATEGORIES.find((item) => item.id === categoryId) || DRESSUP_CATEGORIES[0];
  const slot = selection[active.id] || emptyDressupSlot();
  const picked = selectedDressupSlots(selection);
  const filled = isDressupSlotFilled(slot);

  useEffect(() => {
    if (!open) setAssetOpen(false);
  }, [open]);

  useEffect(() => {
    if (!assetOpen) return undefined;
    let cancelled = false;
    setAssets((current) => ({ ...current, loading: true, error: "" }));
    listUserAssets({ limit: 48, groupId: "all" })
      .then((result) => {
        if (cancelled) return;
        setAssets({
          loading: false,
          items: result.items || [],
          nextCursor: result.nextCursor || "",
          error: "",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setAssets({ loading: false, items: [], nextCursor: "", error: error?.message || "素材库读取失败" });
      });
    return () => {
      cancelled = true;
    };
  }, [assetOpen]);

  const pickFile = (file) => {
    if (busy || !file) return;
    if (!file.type?.startsWith("image/")) return;
    if (file.size > DRESSUP_IMAGE_MAX_BYTES) return;
    onSlotChange(active.id, {
      file,
      previewUrl: URL.createObjectURL(file),
      sourceUrl: "",
    });
  };

  const pickAsset = (asset) => {
    const url = originalFileUrlFromAny(asset.url) || siteFileUrl(asset.url) || String(asset.url || "").trim();
    if (!url) return;
    onSlotChange(active.id, {
      file: null,
      previewUrl: String(asset.thumbnailUrl || asset.url || url).trim(),
      sourceUrl: url,
    });
    setAssetOpen(false);
  };

  const loadMoreAssets = async () => {
    if (!assets.nextCursor || assets.loading) return;
    setAssets((current) => ({ ...current, loading: true }));
    try {
      const result = await listUserAssets({ limit: 48, groupId: "all", cursor: assets.nextCursor });
      setAssets((current) => ({
        loading: false,
        items: [...current.items, ...(result.items || [])],
        nextCursor: result.nextCursor || "",
        error: "",
      }));
    } catch (error) {
      setAssets((current) => ({ ...current, loading: false, error: error?.message || "素材库读取失败" }));
    }
  };

  return (
    <DialogMotion
      open={open}
      layerClassName={`pp-dressup-layer${isDark ? " is-dark" : ""}`}
      panelClassName="pp-dressup"
      variant="detail"
      ariaLabelledby="pp-dressup-title"
      closeDisabled={busy || closeLocked}
      onClose={onClose}
    >
      <header className="pp-dressup__head" data-dialog-motion-item>
        <div>
          <p>形象装扮</p>
          <h2 id="pp-dressup-title">给当前立绘换衣服和配件</h2>
        </div>
        <button type="button" aria-label="关闭装扮" disabled={busy || closeLocked} onClick={onClose}>
          <i className="bi bi-x-lg" />
        </button>
      </header>
      <div className="pp-dressup__body" data-dialog-motion-item>
        <aside className="pp-dressup__stage">
          <div className={`pp-dressup__figure${busy ? " is-busy" : ""}${previewSrc ? " is-preview" : ""}`}>
            {isAuthenticatedAiMediaUrl(previewSrc || figureSrc) ? (
              <AuthenticatedImage
                src={previewSrc || figureSrc}
                fallbackSrc={previewSrc ? "" : figureFallbackSrc}
                alt={previewSrc ? "装扮预览" : "当前立绘参考图"}
                loading="eager"
                keepLoaded
              />
            ) : (
              <img src={previewSrc || figureSrc} alt={previewSrc ? "装扮预览" : "当前立绘参考图"} />
            )}
            {busy ? <em>正在生成装扮…</em> : null}
            {previewSrc && !busy ? <span>待确认</span> : null}
          </div>
          {note && (busy || previewSrc) ? <p className="pp-dressup__status">{note}</p> : null}
          <div className="pp-dressup__equipped">
            <p>{picked.length ? `已装配 ${picked.length} 个部位` : "还没有装配"}</p>
            {picked.length ? (
              <ul>
                {picked.map(({ category, slot: item }) => (
                  <li key={category.id}>
                    {item.previewUrl ? (
                      <DressupMedia src={item.previewUrl} fallbackSrc={item.sourceUrl} alt="" />
                    ) : (
                      <i className={`bi ${category.icon}`} />
                    )}
                    <span>
                      <b>{category.label}</b>
                      <small>{dressupSlotSummary(item)}</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`移除${category.label}`}
                      disabled={busy}
                      onClick={() => onClearSlot(category.id)}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <small>选右侧部位，上传参考图或填写描述</small>
            )}
          </div>
        </aside>
        <section className="pp-dressup__editor">
          <nav className="pp-dressup__cats" aria-label="装扮部位">
            {DRESSUP_CATEGORIES.map((category) => {
              const current = selection[category.id] || emptyDressupSlot();
              const on = isDressupSlotFilled(current);
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`${category.id === active.id ? "is-on" : ""}${on ? " is-filled" : ""}`}
                  onClick={() => onCategory(category.id)}
                >
                  {category.label}
                </button>
              );
            })}
          </nav>
          <div className="pp-dressup__panel">
            <header>
              <strong>{active.label}</strong>
              <span>{active.hint}</span>
            </header>
            <div className="pp-dressup__pair">
              <div
                className={`pp-dressup__upload${slot.previewUrl ? " has-image" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  pickFile(event.dataTransfer.files?.[0]);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  disabled={busy}
                  onChange={(event) => {
                    pickFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {slot.previewUrl ? (
                  <>
                    <DressupMedia src={slot.previewUrl} fallbackSrc={slot.sourceUrl} alt={`${active.label}参考图`} />
                    <span className="pp-dressup__upload-actions">
                      <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                        上传
                      </button>
                      <button type="button" disabled={busy} onClick={() => setAssetOpen(true)}>
                        资产
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSlotChange(active.id, { file: null, previewUrl: "", sourceUrl: "" })}
                      >
                        移除
                      </button>
                    </span>
                  </>
                ) : (
                  <div className="pp-dressup__upload-empty">
                    <i className="bi bi-image" />
                    <b>添加{active.label}参考图</b>
                    <small>上传本地图片，或从我的资产里选一张</small>
                    <span className="pp-dressup__upload-actions is-empty">
                      <button type="button" disabled={busy} aria-label="上传参考图" onClick={() => fileInputRef.current?.click()}>
                        上传
                      </button>
                      <button type="button" disabled={busy} onClick={() => setAssetOpen(true)}>
                        我的资产
                      </button>
                    </span>
                  </div>
                )}
              </div>
              <label className="pp-dressup__desc">
                <span>描述想换的{active.label}</span>
                <textarea
                  value={slot.text}
                  disabled={busy}
                  placeholder={active.placeholder}
                  aria-label={`描述想换的${active.label}`}
                  rows={6}
                  onChange={(event) => onSlotChange(active.id, { text: event.target.value })}
                />
              </label>
            </div>
            <p className="pp-dressup__tip">
              {filled
                ? "这个部位会按参考图和描述一起改；也可以只选图或只写文字。"
                : "这个部位现在保持原样。参考图可上传或从我的资产选择，也可以只写描述。"}
            </p>
          </div>
        </section>
      </div>
      <footer className="pp-dressup__foot" data-dialog-motion-item>
        <p>
          {previewSrc
            ? "看一下对不对。对了再换上当前立绘，不对可以移除或重新生成。"
            : "第一张参考图是当前立绘。未装配的部位保持原样。"}
        </p>
        <div>
          {previewSrc ? (
            <>
              <button type="button" disabled={busy} onClick={onDiscardPreview}>
                移除
              </button>
              <button type="button" disabled={busy} onClick={onRetry}>
                重新生成
              </button>
              <button type="button" className="is-primary" disabled={busy} onClick={onUsePreview}>
                使用这张
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !picked.length} onClick={onReset}>
                清空
              </button>
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy || !picked.length}
                onClick={onConfirm}
              >
                {busy ? "生成中…" : "生成装扮"}
              </button>
            </>
          )}
        </div>
      </footer>
      {assetOpen ? (
        <div className="pp-dressup__assets" role="dialog" aria-label="从我的资产选择">
          <header>
            <div>
              <p>我的资产</p>
              <strong>选择一张作为{active.label}参考图</strong>
            </div>
            <button type="button" aria-label="关闭资产选择" onClick={() => setAssetOpen(false)}>
              <i className="bi bi-x-lg" />
            </button>
          </header>
          <div className="pp-dressup__assets-body">
            {assets.loading && !assets.items.length ? (
              <p>正在读取资产…</p>
            ) : assets.error && !assets.items.length ? (
              <p>{assets.error}</p>
            ) : assets.items.length ? (
              <div className="pp-dressup__assets-grid">
                {assets.items.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    disabled={busy}
                    onClick={() => pickAsset(asset)}
                  >
                    <DressupMedia src={asset.thumbnailUrl || asset.url} fallbackSrc={asset.url} alt={asset.title || "个人素材"} />
                    <span>{asset.title || "未命名素材"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pp-dressup__assets-empty">
                <p>还没有资产</p>
                <Link to="/assets">去素材库上传</Link>
              </div>
            )}
          </div>
          {assets.nextCursor ? (
            <footer>
              <button type="button" disabled={assets.loading} onClick={() => void loadMoreAssets()}>
                {assets.loading ? "加载中…" : "加载更多"}
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </DialogMotion>
  );
}

const LEGACY_TABS = {
  works: "/history",
  notifications: "/notifications",
  materials: "/assets",
  submissions: "/submissions",
  wallet: "/wallet",
  account: "/account",
};

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatJoinedAt(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short" });
}

function websiteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

function taskTypeLabel(type) {
  return TASK_TYPE_LABELS[String(type || "").trim()] || "创作";
}

function taskStatusLabel(status) {
  switch (String(status || "").toLowerCase()) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "running":
      return "进行中";
    case "queued":
    case "waiting_provider":
      return "排队中";
    case "canceled":
    case "cancelled":
      return "已取消";
    default:
      return "创作";
  }
}

function taskPreviewUrl(task = {}) {
  const first = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || "").trim())
      .find(Boolean) || "";
  return (
    first(task.displayUrls) ||
    first(task.thumbnailUrls) ||
    first(task.outputUrls) ||
    first(task.originalUrls)
  );
}

function chartParts(items) {
  return items
    .map((item) => ({ ...item, value: numeric(item.value) }))
    .filter((item) => item.value > 0);
}

function MiniBars({ items }) {
  const parts = chartParts(items);
  const values = parts.length ? parts : [{ value: 1, color: "var(--pc-accent-soft)" }];
  const max = Math.max(1, ...values.map((item) => item.value));
  const width = 80;
  const height = 64;
  const gap = 8;
  const barWidth = Math.min(18, (width - 16 - gap * Math.max(0, values.length - 1)) / values.length);
  const startX = (width - (barWidth * values.length + gap * Math.max(0, values.length - 1))) / 2;
  return (
    <svg className="pp-soft-stat__svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {values.map((item, index) => {
        const barHeight = Math.max(parts.length ? 6 : 4, (item.value / max) * 48);
        return (
          <rect
            key={`${item.color}-${index}`}
            x={startX + index * (barWidth + gap)}
            y={height - 6 - barHeight}
            width={barWidth}
            height={barHeight}
            rx="5"
            fill={item.color}
          />
        );
      })}
    </svg>
  );
}

function MiniDonut({ items }) {
  const parts = chartParts(items);
  const total = parts.reduce((sum, item) => sum + item.value, 0);
  const size = 76;
  const center = size / 2;
  const radius = 26;
  const stroke = 8;
  const circle = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg className="pp-soft-stat__svg is-donut" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--pc-accent-soft)"
        strokeWidth={stroke}
      />
      {parts.map((item, index) => {
        const length = (item.value / total) * circle;
        const node = (
          <circle
            key={`${item.color}-${index}`}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={item.color}
            strokeWidth={stroke}
            strokeDasharray={`${length} ${circle - length}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${center} ${center})`}
          />
        );
        offset += length;
        return node;
      })}
    </svg>
  );
}

function MiniGauge({ value, max = 0 }) {
  const amount = numeric(value);
  const ceiling = Math.max(amount, numeric(max), 1);
  const progress = amount / ceiling;
  const radius = 26;
  const circle = 2 * Math.PI * radius;
  const dash = circle * 0.72;
  return (
    <svg className="pp-soft-stat__svg is-donut" viewBox="0 0 76 76" aria-hidden="true">
      <circle
        cx="38"
        cy="42"
        r={radius}
        fill="none"
        stroke="var(--pc-accent-soft)"
        strokeWidth="8"
        strokeDasharray={`${dash} ${circle}`}
        strokeLinecap="round"
        transform="rotate(140 38 42)"
      />
      <circle
        cx="38"
        cy="42"
        r={radius}
        fill="none"
        stroke="var(--pc-accent)"
        strokeWidth="8"
        strokeDasharray={`${dash * progress} ${circle}`}
        strokeLinecap="round"
        transform="rotate(140 38 42)"
      />
    </svg>
  );
}

function MiniStack({ items }) {
  const parts = chartParts(items);
  const total = parts.reduce((sum, item) => sum + item.value, 0) || 1;
  let x = 8;
  return (
    <svg className="pp-soft-stat__svg" viewBox="0 0 80 64" aria-hidden="true">
      <defs>
        <clipPath id="pp-soft-stack">
          <rect x="8" y="22" width="64" height="18" rx="9" />
        </clipPath>
      </defs>
      <rect x="8" y="22" width="64" height="18" rx="9" fill="var(--pc-accent-soft)" />
      <g clipPath="url(#pp-soft-stack)">
        {parts.map((item, index) => {
          const width = (item.value / total) * 64;
          const node = (
            <rect
              key={`${item.color}-${index}`}
              x={x}
              y="22"
              width={width}
              height="18"
              fill={item.color}
            />
          );
          x += width;
          return node;
        })}
      </g>
    </svg>
  );
}

export function ProfileView() {
  const auth = useAuth();
  const isDark = useIsDark();
  const location = useLocation();
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const figureInputRef = useRef(null);
  const generateInputRef = useRef(null);
  const pendingGenerateFileRef = useRef(null);
  const pendingGenerateModeRef = useRef("reference");
  const pendingCharacterSrcRef = useRef("");
  const pendingDressupPromptRef = useRef("");
  const figureBusyRef = useRef("");
  const figurePreviewRef = useRef("");
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const realtimeTimerRef = useRef(0);
  const applyGeneratedOutputsRef = useRef(async () => {});
  const showGeneratedFigureRef = useRef(() => []);
  const skipProfilePreviewRef = useRef(false);
  const [overview, setOverview] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [figureBusy, setFigureBusy] = useState("");
  const [figurePreviewUrl, setFigurePreviewUrl] = useState("");
  const [figureNote, setFigureNote] = useState("");
  const [figureCost, setFigureCost] = useState(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [dressupOpen, setDressupOpen] = useState(false);
  const [dressupCategory, setDressupCategory] = useState(DRESSUP_CATEGORIES[0].id);
  const [dressupSelection, setDressupSelection] = useState(emptyDressupSelection);
  const [dressupDraft, setDressupDraft] = useState(null);
  const dressupSelectionRef = useRef(dressupSelection);
  dressupSelectionRef.current = dressupSelection;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (figurePreviewRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(figurePreviewRef.current);
      }
      revokeDressupSelection(dressupSelectionRef.current);
    };
  }, []);

  const loadOverview = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await getOverview({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setOverview(result);
      const unread = numeric(result?.unreadNotifications);
      setUnreadCount(unread);
      window.dispatchEvent(
        new CustomEvent("starclouds:notifications-updated", {
          detail: { unreadCount: unread, source: "profile-overview" },
        }),
      );
    } catch (error) {
      if (error?.name !== "AbortError") {
        // The dashboard keeps stable zero states when overview is unavailable.
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab") || "";
    if (LEGACY_TABS[tab]) {
      navigate(LEGACY_TABS[tab], { replace: true });
      return undefined;
    }
    void loadOverview();
    const onTaskUpdate = (event) => {
      const task = event?.detail?.task;
      const status = String(task?.status || "").toLowerCase();
      if (["succeeded", "failed", "canceled"].includes(status)) {
        if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = window.setTimeout(() => {
          realtimeTimerRef.current = 0;
          void loadOverview();
        }, 120);
      }
      if (status !== "succeeded" || !isProfileStudioJob(task)) return;
      const job = taskToLegacyJob(task);
      const completed = {
        job,
        result: { outputs: job.originalMediaUrls || job.resultMediaUrls || [] },
      };
      const urls = showGeneratedFigureRef.current(completed, job.id);
      if (urls.length) void applyGeneratedOutputsRef.current(completed, urls);
    };
    const onWalletUpdated = (event) => {
      const snapshot = event?.detail;
      if (!snapshot) return;
      setOverview((current) => ({
        ...(current || {}),
        wallet: {
          ...(current?.wallet || {}),
          ...snapshot,
          balanceCents: Number(snapshot.balanceCents || 0),
          frozenCents: Number(snapshot.frozenCents || 0),
        },
      }));
    };
    window.addEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
    window.addEventListener("starclouds:wallet-updated", onWalletUpdated);
    return () => {
      controllerRef.current?.abort();
      window.removeEventListener(TASK_UPDATE_EVENT, onTaskUpdate);
      window.removeEventListener("starclouds:wallet-updated", onWalletUpdated);
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    };
  }, [loadOverview, location.search, navigate]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: "(prefers-reduced-motion: reduce)",
          motion: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          const targets = [
            ".pp-soft-hero",
            ".pp-bento-hero-figure",
            ".pp-soft-hero-link",
            ".pp-soft-event",
            ".pp-soft-performance",
            ".pp-soft-stat",
          ];
          if (context.conditions.reduce) {
            gsap.set(targets, { clearProps: "all" });
            return undefined;
          }
          const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
          timeline
            .from(".pp-soft-hero", { autoAlpha: 0, y: 18, duration: 0.5, clearProps: "transform" }, 0)
            .from(
              ".pp-bento-hero-figure",
              { autoAlpha: 0, y: 20, duration: 0.55, clearProps: "transform" },
              0.12,
            )
            .from(
              ".pp-soft-hero-link",
              {
                autoAlpha: 0,
                duration: 0.4,
                stagger: 0.05,
              },
              0.16,
            )
            .from(
              ".pp-soft-event",
              { autoAlpha: 0, x: 14, duration: 0.45, clearProps: "transform" },
              0.18,
            )
            .from(
              ".pp-soft-performance",
              { autoAlpha: 0, y: 22, duration: 0.48 },
              0.1,
            )
            .from(
              ".pp-soft-stat",
              {
                autoAlpha: 0,
                y: 18,
                duration: 0.45,
                stagger: 0.05,
                clearProps: "transform",
              },
              0.16,
            );
          return undefined;
        },
      );
      return () => media.revert();
    },
    { scope: pageRef },
  );

  const taskStats = useMemo(
    () => ({
      total: numeric(overview?.taskStats?.total),
      succeeded: numeric(overview?.taskStats?.succeeded),
      failed: numeric(overview?.taskStats?.failed),
      running: numeric(overview?.taskStats?.running),
    }),
    [overview],
  );
  const successRate = useMemo(() => {
    const done = taskStats.succeeded + taskStats.failed;
    return done ? Math.round((taskStats.succeeded / done) * 100) : 0;
  }, [taskStats]);
  const submissionStats = useMemo(
    () => ({
      total: numeric(overview?.submissionStats?.total),
      pending: numeric(overview?.submissionStats?.pending),
      approved: numeric(overview?.submissionStats?.approved),
      rejected: numeric(overview?.submissionStats?.rejected),
      removed: numeric(overview?.submissionStats?.removed),
    }),
    [overview],
  );
  const materialCount = numeric(overview?.assetCount);
  const assetUngrouped = numeric(overview?.assetUngrouped);
  const assetGrouped = Math.max(0, materialCount - assetUngrouped);
  const unreadPersonal = numeric(overview?.unreadPersonal);
  const unreadBroadcast = numeric(overview?.unreadBroadcast);
  const walletAvailable = numeric(overview?.wallet?.availableCents ?? overview?.wallet?.balanceCents);
  const walletFrozen = numeric(overview?.wallet?.frozenCents);
  const walletTrial = numeric(overview?.wallet?.trialBalanceCents);
  const walletNormal = numeric(overview?.wallet?.normalBalanceCents);
  const balanceCents = numeric(overview?.wallet?.balanceCents);
  const pointsDisplay = formatPoints(balanceCents, { withUnit: false });
  const customFigure = Boolean(auth.user?.studioFigureUrl || figurePreviewUrl);
  const rawFigureSrc = figurePreviewUrl || auth.user?.studioFigureUrl || DEFAULT_STUDIO_FIGURE;
  const figureSrc = isAuthenticatedAiMediaUrl(rawFigureSrc)
    ? originalFileUrlFromAny(rawFigureSrc) || rawFigureSrc
    : rawFigureSrc;
  const figureFallbackSrc = figureSrc !== rawFigureSrc ? rawFigureSrc : "";
  const figureSaving = Boolean(figureBusy);
  const profileBio = String(auth.user?.bio || "").trim();
  const profileLocation = String(auth.user?.location || "").trim();
  const profileWebsite = String(auth.user?.websiteUrl || "").trim();
  const profileJoined = formatJoinedAt(auth.user?.createdAt);
  const websiteLabel = websiteHost(profileWebsite);
  const typeCounts =
    overview?.taskStatsByType && typeof overview.taskStatsByType === "object"
      ? overview.taskStatsByType
      : {};
  const typeMix = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count: numeric(count), label: taskTypeLabel(type) }))
    .filter((item) => item.count > 0 && item.type !== "background_remove")
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
  const typeMixMax = Math.max(1, ...typeMix.map((item) => item.count));
  const recentTasks = (Array.isArray(overview?.recentTasks) ? overview.recentTasks : [])
    .filter((task) => taskPreviewUrl(task))
    .slice(0, 10);
  const recentLoop = [];
  while (recentTasks.length && recentLoop.length < 10) {
    recentLoop.push(...recentTasks);
  }

  const markFigureBusy = (value) => {
    figureBusyRef.current = value;
    setFigureBusy(value);
  };

  const setFigurePreview = (url) => {
    const next = String(url || "").trim();
    const previous = figurePreviewRef.current;
    if (previous && previous !== next && previous.startsWith("blob:")) {
      URL.revokeObjectURL(previous);
    }
    figurePreviewRef.current = next;
    setFigurePreviewUrl(next);
  };

  const commitStudioFigure = (studioFigureUrl) => {
    const nextUrl = String(studioFigureUrl || "").trim();
    auth.setUser((user) => ({
      ...(user || {}),
      studioFigureUrl: nextUrl || null,
    }));
    clearFigureJob(auth.user?.id);
    if (!mountedRef.current) return;
    setFigurePreview(nextUrl);
    setFigureNote("");
    markFigureBusy("");
  };

  const saveStudioFigure = async (studioFigureUrl, successMessage = "") => {
    const nextUrl = siteFileUrl(studioFigureUrl) || String(studioFigureUrl || "").trim();
    if (!nextUrl) {
      setFigurePreview("");
      clearFigureJob(auth.user?.id);
    }
    markFigureBusy(figureBusyRef.current || "upload");
    try {
      const result = await updateProfile({ studioFigureUrl: nextUrl });
      const saved = String(result?.user?.studioFigureUrl || "").trim();
      if (nextUrl && !saved) {
        throw new Error("形象未保存到账号，请重试");
      }
      commitStudioFigure(saved);
    } catch (error) {
      if (mountedRef.current) {
        markFigureBusy("");
        setFigureNote(error?.message || "形象上传失败");
      }
      throw error instanceof Error ? error : new Error(error?.message || "形象上传失败");
    }
  };

  const showGeneratedFigure = (completed, jobId = "") => {
    const outputUrls = studioFigureOutputUrls(completed);
    const previewUrl = outputUrls[0] || studioFigureCandidateUrls(completed)[0] || "";
    if (previewUrl && !skipProfilePreviewRef.current) {
      setFigurePreview(previewUrl);
      if (auth.user?.id && jobId) {
        writeFigureJob(auth.user.id, {
          jobId,
          phase: "ready",
          outputUrl: previewUrl,
        });
      }
    } else if (previewUrl && skipProfilePreviewRef.current && auth.user?.id && jobId) {
      writeFigureJob(auth.user.id, {
        jobId,
        phase: "preview",
        mode: "outfit",
        outputUrl: previewUrl,
      });
    }
    return outputUrls.length ? outputUrls : previewUrl ? [previewUrl] : [];
  };

  const applyGeneratedOutputs = async (completed, outputUrls) => {
    const job = completed?.job && typeof completed.job === "object" ? completed.job : {};
    const applyKey = String(job.id || job.taskId || "").trim();
    if (applyKey && applyingFigureJobs.has(applyKey)) {
      return applyingFigureJobs.get(applyKey);
    }
    const run = (async () => {
      const persistUrl = studioFigurePersistUrl(outputUrls, job);
      const previewUrl = persistUrl || outputUrls[0] || "";
      if (!previewUrl) throw new Error("生成结果为空");
      if (auth.user?.id) {
        writeFigureJob(auth.user.id, {
          jobId: applyKey,
          phase: "ready",
          outputUrl: previewUrl,
        });
      }
      if (mountedRef.current) {
        setFigurePreview(previewUrl);
        setFigureNote("正在保存形象…");
      }
      let savedUrl = "";
      try {
        const account = await auth.refresh();
        const existing = String(account?.studioFigureUrl || "").trim();
        if (isSavedFigureForJob(existing, applyKey)) savedUrl = existing;
      } catch {
        savedUrl = "";
      }
      if (!savedUrl && persistUrl) {
        try {
          const result = await updateProfile({ studioFigureUrl: persistUrl });
          savedUrl = String(result?.user?.studioFigureUrl || "").trim();
        } catch {
          savedUrl = "";
        }
      }
      if (!savedUrl) {
        const blob = await readGeneratedFigureBlob(outputUrls.length ? outputUrls : [previewUrl]);
        const prepared =
          blob.size <= STUDIO_FIGURE_MAX_BYTES
            ? asImageFile(blob)
            : await createStudioFigureUpload(asImageFile(blob));
        if (mountedRef.current) setFigurePreview(URL.createObjectURL(prepared));
        const upload = await uploadFile(prepared);
        const fileUrl = fileUrlFromUpload(upload);
        if (!fileUrl) throw new Error("形象文件上传失败");
        const result = await updateProfile({ studioFigureUrl: fileUrl });
        savedUrl = String(result?.user?.studioFigureUrl || "").trim();
      }
      if (savedUrl) {
        commitStudioFigure(savedUrl);
        return;
      }
      if (mountedRef.current) {
        markFigureBusy("");
        setFigureNote("形象已套用，保存到账号失败，请再试一次");
      }
    })();
    if (applyKey) applyingFigureJobs.set(applyKey, run);
    try {
      await run;
    } finally {
      if (applyKey) applyingFigureJobs.delete(applyKey);
    }
  };

  const followFigureJob = async (jobId, options = {}) => {
    const apply = options.apply !== false;
    const id = String(jobId || "").trim();
    if (!id) throw new Error("任务 ID 无效");
    const userId = auth.user?.id;
    if (userId) {
      writeFigureJob(userId, {
        ...(readFigureJob(userId) || {}),
        jobId: id,
        phase: "running",
        mode: apply ? "reference" : "outfit",
      });
    }
    markFigureBusy(apply ? "generate" : "outfit");
    setFigureNote(apply ? "正在出图…" : "正在生成装扮…");
    const completed = await waitForServerAiJob(id, {
      onUpdate: (job, result) => {
        if (showGeneratedFigure({ job, result }, id).length && apply) {
          setFigureNote("正在套用形象…");
        }
      },
      onImage: (urls, job, result) => {
        showGeneratedFigure({ job, result: { ...result, outputs: urls } }, id);
      },
    });
    const outputUrls = showGeneratedFigure(completed, id);
    if (!outputUrls.length) throw new Error("生成结果为空");
    if (!apply) {
      const previewUrl = outputUrls[0] || "";
      if (userId) {
        writeFigureJob(userId, {
          jobId: id,
          phase: "preview",
          mode: "outfit",
          outputUrl: previewUrl,
        });
      }
      if (mountedRef.current) {
        setDressupDraft({
          previewUrl,
          outputUrls,
          completed,
          jobId: id,
        });
        setDressupOpen(true);
        markFigureBusy("");
        setFigureNote("");
      }
      return;
    }
    await applyGeneratedOutputs(completed, outputUrls);
  };

  const generateStudioFigure = async (file, options = {}) => {
    const mode = options.mode === "outfit" ? "outfit" : "reference";
    const kind = mode === "outfit" ? "profile-studio-outfit" : "profile-studio-figure";
    const plan = mode === "outfit" ? buildDressupSourcePlan(options.dressup || dressupSelection) : null;
    const prompt = mode === "outfit" ? plan.prompt : STUDIO_FIGURE_PROMPT;
    if (mode === "outfit") {
      if (!plan.picked.length) {
        setFigureNote("请先选择装扮");
        return;
      }
    } else if (!file) {
      return;
    }
    if (figureBusyRef.current) return;
    skipProfilePreviewRef.current = mode === "outfit";
    markFigureBusy(mode === "outfit" ? "outfit" : "generate");
    setFigureCost(null);
    if (mode !== "outfit") setDressupOpen(false);
    else setDressupOpen(true);
    setFigureNote(mode === "outfit" ? "正在生成装扮…" : "正在生成形象…");
    let charged = false;
    let jobId = "";
    try {
      const model = await resolveStudioFigurePlan();
      const sourceUrls = [];
      if (mode === "outfit") {
        const characterSrc = String(options.characterSrc || figureSrc || DEFAULT_STUDIO_FIGURE).trim();
        const characterUrl = /\/api\/v1\/files\//.test(characterSrc)
          ? siteFileUrl(characterSrc) || characterSrc
          : await uploadAiInputFile(asImageFile(await readGeneratedFigureBlob([characterSrc])));
        if (!characterUrl) throw new Error("当前立绘读取失败");
        sourceUrls.push(characterUrl);
        for (const extra of plan.extras || []) {
          if (extra.file) sourceUrls.push(await uploadAiInputFile(extra.file));
          else if (extra.url) sourceUrls.push(siteFileUrl(extra.url) || extra.url);
        }
      } else {
        sourceUrls.push(await uploadAiInputFile(file));
      }
      const outputSize = resolveT2iOutputSize("2:3", model.resolutionScale);
      const created = await createServerAiJob({
        kind: "wallpaper-image-edit",
        clientRequestId: crypto.randomUUID(),
        prompt,
        input: {
          sourceUrl: sourceUrls[0],
          sourceUrls,
          aspectRatio: "2:3",
          requestedAspectRatio: "2:3",
          outputSize,
          size: outputSize,
          resolutionScale: model.resolutionScale,
          ...(model.quality ? { quality: model.quality } : {}),
          count: 1,
          n: 1,
          sourceMode: "text",
          userPrompt: prompt,
          transparentPngEnabled: true,
          transparentBackground: true,
          ...(model.outputFormat ? { outputFormat: model.outputFormat } : {}),
          _kind: kind,
          _source: "profile_studio",
          ...(mode === "outfit" ? { dressup: serializeDressupSelection(options.dressup || dressupSelection) } : {}),
        },
        params: {
          publicModelKey: model.id,
          modelHint: model.id,
          executionMode: "server",
          _kind: kind,
          _source: "profile_studio",
        },
        units: 1,
      });
      charged = true;
      jobId = created?.job?.id || created?.job?.taskId || "";
      if (!jobId) throw new Error("任务创建后未返回任务 ID");
      if (auth.user?.id) {
        writeFigureJob(auth.user.id, { jobId, phase: "running", mode });
      }
      await followFigureJob(jobId, { apply: mode !== "outfit" });
    } catch (error) {
      if (error?.name === "AbortError") return;
      const previewUrl = figurePreviewRef.current || readFigureJob(auth.user?.id)?.outputUrl || "";
      const retryHint = mode === "outfit" ? "装扮" : "参考生成";
      const message = charged
        ? previewUrl
          ? "形象已生成，正在同步到账号…"
          : `${error?.message || "形象生成失败"}。积分已扣，可在文生图历史中查看结果`
        : error?.message || (mode === "outfit" ? "装扮失败" : "形象生成失败");
      if (auth.user?.id && jobId) {
        writeFigureJob(auth.user.id, {
          jobId,
          phase: previewUrl ? (mode === "outfit" ? "preview" : "ready") : "failed",
          mode,
          error: previewUrl ? "" : message,
          outputUrl: previewUrl,
        });
      }
      if (!mountedRef.current) return;
      markFigureBusy("");
      if (mode === "outfit") {
        setDressupOpen(true);
        if (previewUrl) {
          setDressupDraft((current) => current || { previewUrl, outputUrls: [previewUrl], completed: null, jobId });
        }
        setFigureNote(previewUrl ? "装扮已生成，确认后再换上。" : message);
        return;
      }
      if (previewUrl) {
        setFigurePreview(previewUrl);
        setFigureNote(`形象已套用，保存到账号失败时请再试一次${retryHint}`);
        return;
      }
      setFigureNote(message);
    }
  };

  const followFigureJobRef = useRef(followFigureJob);
  followFigureJobRef.current = followFigureJob;
  applyGeneratedOutputsRef.current = applyGeneratedOutputs;
  showGeneratedFigureRef.current = showGeneratedFigure;

  useEffect(() => {
    const userId = auth.user?.id;
    if (!userId) return undefined;
    const session = readFigureJob(userId);
    const outfitSession = session?.mode === "outfit";
    if (session?.outputUrl && !outfitSession) setFigurePreview(session.outputUrl);
    if (outfitSession) {
      setDressupOpen(true);
      if (session.outputUrl) {
        setDressupDraft({
          previewUrl: session.outputUrl,
          outputUrls: [session.outputUrl],
          completed: null,
          jobId: session.jobId,
        });
      }
    }
    if (session?.phase === "failed" && session.error) {
      setFigureNote(session.error);
    } else if (session?.jobId && session.phase !== "preview") {
      markFigureBusy(outfitSession ? "outfit" : "generate");
      setFigureNote(
        outfitSession ? "正在生成装扮…" : session.phase === "ready" ? "正在套用形象…" : "正在出图…",
      );
    }
    let cancelled = false;
    const resume = async () => {
      if (figureBusyRef.current === "upload") return;
      const follow = (jobId, options) => followFigureJobRef.current(jobId, options);
      if (session?.jobId) {
        try {
          const { job } = await getServerAiJob(session.jobId);
          if (cancelled) return;
          if (isFailedFigureJob(job)) {
            const message = job.error || session.error || "形象生成失败";
            writeFigureJob(userId, {
              jobId: session.jobId,
              phase: "failed",
              mode: outfitSession ? "outfit" : "reference",
              error: message,
              outputUrl: session.outputUrl || "",
            });
            markFigureBusy("");
            setFigureNote(message);
            return;
          }
          const completed = String(job.status || "").toLowerCase() === "completed";
          const outfitJob = outfitSession || isOutfitStudioJob(job);
          if (outfitJob && completed && session.phase === "preview" && session.outputUrl) {
            skipProfilePreviewRef.current = true;
            markFigureBusy("");
            return;
          }
          if (isActiveFigureJob(job) || completed || session.phase === "ready" || session.phase === "preview") {
            try {
              skipProfilePreviewRef.current = outfitJob;
              await follow(session.jobId, { apply: !outfitJob });
            } catch (error) {
              if (error?.name === "AbortError" || cancelled) return;
              const message = error?.message || "形象生成失败";
              writeFigureJob(userId, {
                jobId: session.jobId,
                phase: "failed",
                mode: outfitJob ? "outfit" : "reference",
                error: message,
                outputUrl: readFigureJob(userId)?.outputUrl || session.outputUrl || "",
              });
              if (mountedRef.current) {
                markFigureBusy("");
                setFigureNote(message);
              }
            }
            return;
          }
        } catch {
          if (session.phase === "failed") return;
        }
      }
      try {
        const { jobs } = await listServerAiJobs(12, { type: "t2i" });
        if (cancelled) return;
        const running = (jobs || []).find(
          (job) => isProfileStudioJob(job) && isActiveFigureJob(job),
        );
        if (running?.id) {
          const outfitJob = isOutfitStudioJob(running);
          skipProfilePreviewRef.current = outfitJob;
          if (outfitJob) setDressupOpen(true);
          await follow(running.id, { apply: !outfitJob });
        }
      } catch {
        // Keep any stored note if the task list cannot be read.
      }
    };
    void resume();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  const requestStudioFigureGenerate = async (file, options = {}) => {
    const mode = options.mode === "outfit" ? "outfit" : "reference";
    if (mode !== "outfit" && !file?.type?.startsWith("image/")) {
      setFigureNote("请选择 PNG、JPEG 或 WebP 图片");
      return;
    }
    const characterSrc = String(options.characterSrc || figureSrc || DEFAULT_STUDIO_FIGURE).trim();
    const prompt = String(options.prompt || "").trim();
    if (mode === "outfit" && !prompt) {
      setFigureNote("请先选择装扮");
      return;
    }
    if (auth.user?.requireCostConfirm === false) {
      await generateStudioFigure(file, { mode, characterSrc, prompt, dressup: options.dressup });
      return;
    }
    pendingGenerateFileRef.current = file || null;
    pendingGenerateModeRef.current = mode;
    pendingCharacterSrcRef.current = characterSrc;
    pendingDressupPromptRef.current = prompt;
    setFigureCost({
      unit: 0,
      total: 0,
      available: null,
      mode,
      loading: true,
    });
    try {
      const [model, wallet, featurePrice] = await Promise.all([
        resolveStudioFigurePlan(),
        getWallet().catch(() => null),
        getFeatureUnitPriceCents("wallpaper"),
      ]);
      const generateUnit = Math.max(
        0,
        Number(
          model.pointPricing?.configured
            ? model.creditCost
            : featurePrice ?? model.creditCost,
        ) || 0,
      );
      const available =
        wallet == null
          ? null
          : Math.max(0, Number(wallet.availableCents ?? wallet.balanceCents ?? 0));
      setFigureCost({
        unit: generateUnit,
        total: generateUnit,
        available,
        mode,
        loading: false,
      });
    } catch (error) {
      pendingGenerateFileRef.current = null;
      pendingGenerateModeRef.current = "reference";
      pendingCharacterSrcRef.current = "";
      pendingDressupPromptRef.current = "";
      setFigureCost(null);
      setFigureNote(error?.message || (mode === "outfit" ? "装扮失败" : "形象生成失败"));
    }
  };

  const requestStudioDressup = async () => {
    const plan = buildDressupSourcePlan(dressupSelection);
    if (!plan.picked.length) {
      setFigureNote("请至少选择一项装扮");
      return;
    }
    await requestStudioFigureGenerate(null, {
      mode: "outfit",
      characterSrc: figureSrc,
      prompt: plan.prompt,
      dressup: dressupSelection,
    });
  };

  const discardDressupDraft = () => {
    skipProfilePreviewRef.current = false;
    setDressupDraft(null);
    if (auth.user?.id) clearFigureJob(auth.user.id);
    setFigureNote("");
  };

  const useDressupDraft = async () => {
    if (!dressupDraft?.outputUrls?.length) return;
    skipProfilePreviewRef.current = false;
    markFigureBusy("outfit");
    setFigureNote("正在保存形象…");
    try {
      await applyGeneratedOutputs(dressupDraft.completed || { job: { id: dressupDraft.jobId } }, dressupDraft.outputUrls);
      setDressupDraft(null);
      setDressupOpen(false);
    } catch (error) {
      if (!mountedRef.current) return;
      markFigureBusy("");
      setFigureNote(error?.message || "形象保存失败");
    }
  };

  const onStudioFigureSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || figureBusyRef.current) return;
    if (!file.type?.startsWith("image/")) {
      setFigureNote("请选择 PNG、JPEG 或 WebP 图片");
      return;
    }
    markFigureBusy("upload");
    try {
      const prepared = await createStudioFigureUpload(file);
      setFigurePreview(URL.createObjectURL(prepared));
      const upload = await uploadFile(prepared);
      await saveStudioFigure(fileUrlFromUpload(upload));
    } catch (error) {
      if (mountedRef.current) {
        markFigureBusy("");
        setFigureNote(error?.message || "形象上传失败");
      }
    }
  };

  const onStudioFigureGenerateSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || figureBusyRef.current) return;
    await requestStudioFigureGenerate(file);
  };

  const confirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAccount().catch(() => null);
      auth.setUser(null);
      if (mountedRef.current)
        navigate("/auth?mode=login&redirect=%2Fprofile", { replace: true });
    } finally {
      if (mountedRef.current) {
        setLoggingOut(false);
        setLogoutOpen(false);
      }
    }
  };

  return (
    <div
      ref={pageRef}
      className={`pp-page is-soft is-dashboard ${isDark ? "is-dark" : "is-light"}`}
    >
      <div className="pp-atmosphere" aria-hidden="true">
        <div className="pp-atmosphere__wash" />
        <div className="pp-atmosphere__orb pp-atmosphere__orb--a" />
        <div className="pp-atmosphere__orb pp-atmosphere__orb--b" />
      </div>
      <div className="pp-shell">
        <main className="pp-main">
          <section
            id="profile-panel-dashboard"
            className="pp-panel pp-soft-board"
            role="tabpanel"
          >
            <div className="pp-soft-hero">
              <div className="pp-soft-hero__mech" aria-hidden="true">
                <div className="pp-soft-hero__clip">
                  <div className="pp-soft-hero__plate" />
                  <div className="pp-soft-hero__glow" />
                  <div className="pp-soft-hero__clouds" />
                  <div className="pp-soft-hero__horizon" />
                  <div className="pp-soft-stripes" />
                  <div className="pp-soft-hero__rim" />
                </div>
              </div>
              <nav className="pp-soft-hero-links" aria-label="个人入口">
                {[
                  {
                    to: "/assets",
                    icon: "bi-collection",
                    tone: "assets",
                    title: "我的资产",
                    value: String(materialCount),
                    hint: "件素材",
                  },
                  {
                    to: "/submissions",
                    icon: "bi-send-check",
                    tone: "submissions",
                    title: "我的投稿",
                    value: String(submissionStats.total),
                    hint: submissionStats.pending
                      ? `待审 ${submissionStats.pending}`
                      : "社区投稿",
                  },
                  {
                    to: "/wallet",
                    icon: "bi-wallet2",
                    tone: "wallet",
                    title: "我的钱包",
                    value: pointsDisplay,
                    hint: "可用积分",
                  },
                  {
                    to: "/orders",
                    icon: "bi-receipt",
                    tone: "orders",
                    title: "我的订单",
                    value: "",
                    hint: "充值与订阅",
                  },
                ].map((item, index) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`pp-soft-hero-link is-${item.tone}${item.value ? "" : " is-bare"}`}
                  >
                    <span className="pp-soft-hero-link__glow" aria-hidden="true" />
                    <span className="pp-soft-hero-link__mark" aria-hidden="true">
                      <i className={`bi ${item.icon}`} />
                    </span>
                    <span className="pp-soft-hero-link__head">
                      <span className="pp-soft-hero-link__index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="pp-soft-hero-link__go" aria-hidden="true">
                        <ArrowUpRight size={28} strokeWidth={2.1} />
                      </span>
                    </span>
                    <span className="pp-soft-hero-link__copy">
                      <strong>{item.title}</strong>
                      {item.value ? <b>{item.value}</b> : null}
                      <small>{item.hint}</small>
                    </span>
                  </Link>
                ))}
              </nav>
              <div className={`pp-soft-character${figureSaving ? " is-busy" : ""}`}>
                {isAuthenticatedAiMediaUrl(figureSrc) ? (
                  <AuthenticatedImage
                    className="pp-bento-hero-figure"
                    src={figureSrc}
                    fallbackSrc={figureFallbackSrc}
                    alt=""
                    width="1360"
                    height="2048"
                    loading="eager"
                    keepLoaded
                    decoding="async"
                    fetchPriority="high"
                  />
                ) : (
                  <img
                    className="pp-bento-hero-figure"
                    src={figureSrc}
                    alt=""
                    width="1360"
                    height="2048"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                  />
                )}
                {figureNote ? (
                  <p
                    className={`pp-soft-character__note${figureBusy ? "" : " is-error"}`}
                  >
                    {figureNote}
                  </p>
                ) : null}
              </div>
              <div className="pp-soft-event">
                <p className="pp-soft-event__eyebrow">
                  <i className="pp-soft-event__led" aria-hidden="true" />
                  Hi, Welcome
                </p>
                <h2>
                  {auth.user?.username || "创作者"} <em>Studio</em>
                </h2>
                {profileBio ? <p className="pp-soft-event__bio">{profileBio}</p> : null}
                {profileLocation || websiteLabel || profileJoined ? (
                  <ul className="pp-soft-event__meta">
                    {profileLocation ? <li>{profileLocation}</li> : null}
                    {websiteLabel ? (
                      <li>
                        <a href={profileWebsite} target="_blank" rel="noreferrer">
                          {websiteLabel}
                        </a>
                      </li>
                    ) : null}
                    {profileJoined ? <li>加入于 {profileJoined}</li> : null}
                  </ul>
                ) : null}
                <div className="pp-soft-event__actions">
                  <Link to="/studio">+ 开始创作</Link>
                  <Link to="/pricing">+ 充值积分</Link>
                </div>
                <div className="pp-soft-event__figure-tools">
                  <button
                    type="button"
                    disabled={figureSaving}
                    onClick={() => figureInputRef.current?.click()}
                  >
                    {figureBusy === "upload" ? "上传中…" : "更换形象"}
                  </button>
                  <button
                    type="button"
                    disabled={figureSaving}
                    onClick={() => setDressupOpen(true)}
                  >
                    {figureBusy === "outfit" ? "装扮中…" : "装扮"}
                  </button>
                  <button
                    type="button"
                    disabled={figureSaving}
                    onClick={() => generateInputRef.current?.click()}
                  >
                    {figureBusy === "generate" ? "生成中…" : "参考生成"}
                  </button>
                  {customFigure ? (
                    <button
                      type="button"
                      disabled={figureSaving}
                      onClick={() => void saveStudioFigure("").catch(() => {})}
                    >
                      恢复默认
                    </button>
                  ) : null}
                </div>
                <input
                  ref={figureInputRef}
                  className="pp-soft-character__input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onStudioFigureSelected}
                />
                <input
                  ref={generateInputRef}
                  className="pp-soft-character__input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onStudioFigureGenerateSelected}
                />
              </div>
              <button
                type="button"
                className="pp-soft-hero__logout"
                disabled={loggingOut}
                onClick={() => setLogoutOpen(true)}
              >
                <i className="bi bi-power" aria-hidden="true" />
                {loggingOut ? "退出中…" : "退出登录"}
              </button>
            </div>
            <aside className="pp-soft-performance">
              <header>
                <strong>Performance</strong>
                <button type="button" onClick={() => navigate("/submissions")}>
                  查看投稿
                </button>
              </header>
              <div className="pp-soft-progress">
                <div className="pp-soft-progress__meta">
                  <strong aria-hidden="true">{successRate}</strong>
                  <span>成功率 {successRate}%</span>
                </div>
                <b>
                  <i style={{ width: `${successRate}%` }} />
                </b>
              </div>
              {typeMix.length ? (
                <ul className="pp-soft-types">
                  {typeMix.map((item) => (
                    <li key={item.type}>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                      <b>
                        <i style={{ width: `${Math.round((item.count / typeMixMax) * 100)}%` }} />
                      </b>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="pp-soft-perf-list">
                <li>
                  <span>进行中</span>
                  <strong>{taskStats.running}</strong>
                </li>
                <li className="is-ok">
                  <span>已成功</span>
                  <strong>{taskStats.succeeded}</strong>
                </li>
                <li className="is-bad">
                  <span>失败</span>
                  <strong>{taskStats.failed}</strong>
                </li>
                <li>
                  <span>审核中</span>
                  <strong>{submissionStats.pending}</strong>
                </li>
              </ul>
              {recentLoop.length ? (
                <div
                  className="pp-soft-recent"
                  style={{ "--pp-recent-n": recentLoop.length }}
                >
                  <div className="pp-soft-recent__viewport">
                    <div className="pp-soft-recent__track">
                      {[0, 1].map((copy) => (
                        <ul
                          key={copy}
                          className="pp-soft-recent__set"
                          aria-hidden={copy ? true : undefined}
                          inert={copy ? true : undefined}
                        >
                          {recentLoop.map((task, index) => {
                            const preview = taskPreviewUrl(task);
                            const label = `${taskTypeLabel(task.type)} ${taskStatusLabel(task.status)}`;
                            return (
                              <li key={`${copy}-${task.id || task.createdAt}-${index}`}>
                                <Link to="/history" aria-label={copy ? undefined : label} title={copy ? undefined : label} tabIndex={copy ? -1 : undefined}>
                                  {isAuthenticatedAiMediaUrl(preview) ? (
                                    <AuthenticatedImage
                                      src={preview}
                                      alt=""
                                      loading="lazy"
                                      maxDimension={240}
                                    />
                                  ) : (
                                    <img src={preview} alt="" />
                                  )}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="pp-soft-perf-foot">
                <Link to="/history">创作历史</Link>
                <Link to="/account">账号设置</Link>
              </div>
            </aside>
            <div className="pp-soft-stats">
              <Link to="/assets" className="pp-soft-stat">
                <small>
                  已分组 {assetGrouped} · 未分组 {assetUngrouped || (assetGrouped ? 0 : materialCount)}
                </small>
                <strong>{materialCount}</strong>
                <span>我的资产</span>
                <div className="pp-soft-stat__chart">
                  <MiniBars
                    items={[
                      { value: assetGrouped, color: "var(--pc-accent)" },
                      { value: assetUngrouped || (assetGrouped ? 0 : materialCount), color: "var(--pc-accent-strong)" },
                    ]}
                  />
                </div>
              </Link>
              <Link to="/notifications" className="pp-soft-stat">
                <small>
                  {unreadPersonal || unreadBroadcast
                    ? `个人 ${unreadPersonal} · 广播 ${unreadBroadcast}`
                    : unreadCount
                      ? `共 ${unreadCount} 条`
                      : "暂无未读"}
                </small>
                <strong>{unreadCount}</strong>
                <span>未读通知</span>
                <div className="pp-soft-stat__chart">
                  {unreadPersonal || unreadBroadcast ? (
                    <MiniDonut
                      items={[
                        { value: unreadPersonal, color: "var(--pc-accent)" },
                        { value: unreadBroadcast, color: "var(--pc-accent-strong)" },
                      ]}
                    />
                  ) : (
                    <MiniGauge value={unreadCount} max={Math.max(unreadCount, 10)} />
                  )}
                </div>
              </Link>
              <Link to="/submissions" className="pp-soft-stat">
                <small>
                  待审 {submissionStats.pending} · 未过审 {submissionStats.rejected}
                </small>
                <strong>
                  {String(submissionStats.approved).padStart(2, "0")}
                </strong>
                <span>过审投稿</span>
                <div className="pp-soft-stat__chart">
                  <MiniDonut
                    items={[
                      { value: submissionStats.approved, color: "var(--pc-accent)" },
                      { value: submissionStats.pending, color: "var(--pc-warning)" },
                      { value: submissionStats.rejected, color: "var(--pc-danger)" },
                      { value: submissionStats.removed, color: "var(--pc-faint)" },
                    ]}
                  />
                </div>
              </Link>
              <Link to="/wallet" className="pp-soft-stat is-earn">
                <small>
                  冻结 {formatPoints(walletFrozen, { withUnit: false })}
                  {walletTrial > 0
                    ? ` · 试用 ${formatPoints(walletTrial, { withUnit: false })}`
                    : ""}
                </small>
                <strong>{pointsDisplay}</strong>
                <span>可用积分</span>
                <div className="pp-soft-stat__chart">
                  {walletTrial > 0 || walletFrozen > 0 ? (
                    <MiniStack
                      items={[
                        { value: walletNormal || walletAvailable, color: "var(--pc-earn)" },
                        { value: walletTrial, color: "#14b8a6" },
                        { value: walletFrozen, color: "var(--pc-accent-soft)" },
                      ]}
                    />
                  ) : (
                    <MiniGauge value={walletAvailable} max={Math.max(walletAvailable, 100)} />
                  )}
                </div>
              </Link>
            </div>
          </section>
        </main>
      </div>
      <FigureCostDialog
        cost={figureCost}
        isDark={isDark}
        onCancel={() => {
          pendingGenerateFileRef.current = null;
          pendingGenerateModeRef.current = "reference";
          pendingCharacterSrcRef.current = "";
          pendingDressupPromptRef.current = "";
          setFigureCost(null);
        }}
        onConfirm={() => {
          const file = pendingGenerateFileRef.current;
          const mode = pendingGenerateModeRef.current || "reference";
          const characterSrc = pendingCharacterSrcRef.current;
          const prompt = pendingDressupPromptRef.current;
          pendingGenerateFileRef.current = null;
          pendingGenerateModeRef.current = "reference";
          pendingCharacterSrcRef.current = "";
          pendingDressupPromptRef.current = "";
          setFigureCost(null);
          if (mode === "outfit" || file) {
            void generateStudioFigure(file, {
              mode,
              characterSrc,
              prompt,
              dressup: dressupSelection,
            });
          }
        }}
      />
      <StudioDressupDialog
        open={dressupOpen}
        busy={figureSaving}
        isDark={isDark}
        figureSrc={figureSrc}
        figureFallbackSrc={figureFallbackSrc}
        previewSrc={dressupDraft?.previewUrl || ""}
        note={figureNote}
        selection={dressupSelection}
        categoryId={dressupCategory}
        onCategory={setDressupCategory}
        onSlotChange={(categoryId, patch) => {
          setDressupSelection((current) => {
            const prev = current[categoryId] || emptyDressupSlot();
            if (Object.prototype.hasOwnProperty.call(patch, "previewUrl") && prev.previewUrl && prev.previewUrl !== patch.previewUrl) {
              revokeDressupPreview(prev);
            }
            return { ...current, [categoryId]: { ...prev, ...patch } };
          });
        }}
        onClearSlot={(categoryId) => {
          setDressupSelection((current) => {
            revokeDressupPreview(current[categoryId]);
            return { ...current, [categoryId]: emptyDressupSlot() };
          });
        }}
        onReset={() => {
          setDressupSelection((current) => {
            revokeDressupSelection(current);
            return emptyDressupSelection();
          });
        }}
        onClose={() => {
          if (figureSaving) return;
          discardDressupDraft();
          setDressupOpen(false);
        }}
        onConfirm={() => void requestStudioDressup()}
        onUsePreview={() => void useDressupDraft()}
        onDiscardPreview={discardDressupDraft}
        onRetry={() => void requestStudioDressup()}
        closeLocked={Boolean(figureCost)}
      />
      <LogoutDialog
        open={logoutOpen}
        busy={loggingOut}
        isDark={isDark}
        onClose={() => !loggingOut && setLogoutOpen(false)}
        onConfirm={confirmLogout}
      />
    </div>
  );
}
