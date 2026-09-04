import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PackageCheck } from "lucide-react";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { canOpenWallevenImagePreview, WallevenImagePreview } from "../components/common/WallevenImagePreview.jsx";
import {
  PAGE_TYPES,
  VISUAL_STYLES,
  BRAND_COLORS,
  SPEC_OPTIONS,
  COMPONENT_STATES,
} from "../features/design-workshop/options.js";
import {
  DEFAULT_DESIGN_SPEC,
  MOBILE_SYSTEMS,
  buildCodexHandoff,
  buildDesignHandoffMarkdown,
  buildDesignSystemPrompt,
  buildDesignTokensCss,
  cropElementFromImage,
  downloadBlobFile,
  getPhoneProfiles,
  resolveDesignSystem,
  slugFileName,
} from "../features/design-workshop/designSystem.js";
import { resolveTaskMedia } from "../features/task-media/taskMediaResults.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import {
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveT2iOutputSize } from "@react/legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
  waitForServerAiJob,
} from "@react/legacy-modules/services/aiWallpaper.js";
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from "@react/legacy-modules/services/authenticatedMedia.js";
import {
  cancelAssistantRun,
  listActiveAssistantRuns,
} from "../features/assistant/services/assistantApi.js";
import {
  getScopedLocalItem,
  setScopedLocalItem,
} from "@react/legacy-modules/services/scopedLocalStorage.js";
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import {
  DESIGN_DEVICE_OPTIONS,
  getDesignDevice,
  normalizeSelectedDeviceIds,
} from "@react/legacy-modules/features/design-workshop/designDevices.js";
import { orderDevicesForConsistency } from "@react/legacy-modules/features/design-workshop/multiDeviceConsistency.js";
import {
  buildVersionForest,
  canIterate,
  collectDescendants,
  pickCarrier,
  resolveParentOutputUrl,
} from "@react/legacy-modules/features/design-workshop/versionTree.js";
import {
  MAX_REGION_STYLE_REFERENCES,
  REGION_EDIT_ACTIONS,
  REGION_RECOGNITION_OPTIONS,
  createRegionBox,
  normalizeRegionBoxesFromSession,
  regionNodeMatchesRecognitionTypes,
  resolveRegionDesignReference,
  wantsRegionTransparentOutput,
} from "@react/legacy-modules/features/design-workshop/regionOutputPolicy.js";
import {
  assistantRunsToRegionJobs,
  clearRegionProcessSession,
  inferredParentFromRegionJobs,
  readRegionProcessSession,
  recoverRegionBoxesFromJobs,
  shouldContinueRegionProcess,
  writeRegionProcessSession,
} from "@react/legacy-modules/features/design-workshop/regionProcessSession.js";
import {
  analyzeDesignCropElements,
  buildRegionEditInstruction,
  generateDesignRegionImage,
} from "@react/legacy-modules/features/design-workshop/aiDesignDocument.js";
import { flattenPngAlphaOntoSolid, uploadAiTempBlob } from "@react/legacy-modules/features/ai-shared/aiImageIO.js";
import { createUserAsset } from "@react/legacy-modules/services/meApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/views/DesignWorkshopView.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@react/legacy-styles/generated/features/design-workshop/components/DesignVersionDrawer.css";
import { DownloadIcon } from "../components/common/DownloadIcon.jsx";
import { SoftMark } from "../components/common/SoftMark.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import "./DesignWorkshopView.css";

const SETTINGS_KEY = "ui-design-workshop-v2";
const UPLOADS_KEY = "ui-design-workshop-uploads-v1";
const MAX_REFERENCES = 6;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|webp)$/i;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function isImageFile(file) {
  if (!file) return false;
  if (IMAGE_MIME_TYPES.has(String(file.type || "").toLowerCase())) return true;
  return IMAGE_NAME_PATTERN.test(file.name || "");
}

function resolveRegionPointerRect(start, x, y, rect, lockRatio = false) {
  let endX = Math.max(0, Math.min(1, x));
  let endY = Math.max(0, Math.min(1, y));
  if (lockRatio) {
    const dx = (endX - start.x) * rect.width;
    const dy = (endY - start.y) * rect.height;
    const horizontalLimit = (dx < 0 ? start.x : 1 - start.x) * rect.width;
    const verticalLimit = (dy < 0 ? start.y : 1 - start.y) * rect.height;
    const side = Math.min(
      Math.max(Math.abs(dx), Math.abs(dy)),
      horizontalLimit,
      verticalLimit,
    );
    endX = start.x + (dx < 0 ? -side : side) / rect.width;
    endY = start.y + (dy < 0 ? -side : side) / rect.height;
  }
  return {
    x: Math.min(start.x, endX),
    y: Math.min(start.y, endY),
    width: Math.abs(endX - start.x),
    height: Math.abs(endY - start.y),
  };
}

function readSavedUploads() {
  try {
    const rows = JSON.parse(getScopedLocalItem(UPLOADS_KEY) || "[]");
    return Array.isArray(rows)
      ? rows.filter((item) => item?.url && item.source === "upload")
      : [];
  } catch {
    return [];
  }
}

function forgetSavedUploads(urls) {
  const removed = urls instanceof Set ? urls : new Set(urls || []);
  const next = readSavedUploads().filter((item) => !removed.has(item.url));
  setScopedLocalItem(UPLOADS_KEY, JSON.stringify(next));
}

async function decodeImageBlob(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("设计稿读取失败"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG 导出失败"))),
      "image/png",
    );
  });
}

function renderImageAsPng(image) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建设计稿画布");
  context.drawImage(image, 0, 0);
  return canvasToPngBlob(canvas);
}

function remapElementsToSource(nodes, fromSize, sourceSize) {
  const fromWidth = Math.max(1, Number(fromSize?.width || sourceSize?.width || 1));
  const fromHeight = Math.max(1, Number(fromSize?.height || sourceSize?.height || 1));
  const scaleX = Math.max(1, Number(sourceSize?.width || fromWidth)) / fromWidth;
  const scaleY = Math.max(1, Number(sourceSize?.height || fromHeight)) / fromHeight;
  return (nodes || []).map((node) => ({
    ...node,
    x: Number(node.x || 0) * scaleX,
    y: Number(node.y || 0) * scaleY,
    width: Number(node.width || 0) * scaleX,
    height: Number(node.height || 0) * scaleY,
  }));
}
const REGION_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DEFAULT_SPEC = {
  ...DEFAULT_DESIGN_SPEC,
  states: ["interaction", "empty", "error"],
};

function DesignSystemFields({ spec, onSpec, onState }) {
  const fieldKeys = [
    "audience",
    "goal",
    "navigation",
    "density",
    "typography",
    "radius",
    "responsive",
  ];
  const labels = {
    audience: "目标用户",
    goal: "核心目标",
    navigation: "导航结构",
    density: "信息密度",
    typography: "字体气质",
    radius: "组件圆角",
    responsive: "响应策略",
  };
  return (
    <>
      <div className="dws-spec-grid">
        {fieldKeys.map((key) => (
          <div key={key} className="dws-select-field">
            <span className="dws-label">{labels[key]}</span>
            <WorkshopSelect
              value={spec[key]}
              options={SPEC_OPTIONS[key].map(([id, label]) => ({
                value: id,
                label,
                icon: "bi-sliders2",
              }))}
              onChange={(next) => onSpec(key, next)}
              label={labels[key]}
              className="dws-control-select"
              icon="bi-sliders2"
            />
          </div>
        ))}
      </div>
      <div className="dws-spec-states">
        <span className="dws-label">必须覆盖的组件状态</span>
        <div>
          {COMPONENT_STATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={(spec.states || []).includes(item.id) ? "is-on" : ""}
              onClick={() => onState(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function featureModels(config = {}) {
  const feature = config.features?.["ai.uiDesign"] || {};
  const payload =
    feature.config && typeof feature.config === "object"
      ? feature.config
      : feature;
  return (Array.isArray(payload.publicModels) ? payload.publicModels : [])
    .map((item) => ({
      ...item,
      ...normalizeImageModelCapabilities(item),
      id: String(item.id || item.publicModelKey || ""),
      label: String(
        item.label || item.name || item.id || item.publicModelKey || "",
      ),
      publicModelKey: String(item.publicModelKey || item.id || ""),
    }))
    .filter((item) => item.id);
}

function modelOutputParamsForRatio(model, ratio) {
  const capabilities = normalizeImageModelCapabilities(model || {});
  const resolutionScale = capabilities.resolutions.find((resolution) =>
    getModelAspectRatiosForResolution(model || {}, resolution).includes(ratio),
  ) || "";
  const supportsRatio = capabilities.resolutions.length
    ? Boolean(resolutionScale)
    : capabilities.aspectRatios.includes(ratio);
  const outputSize = supportsRatio && resolutionScale
    ? resolveT2iOutputSize(ratio, resolutionScale)
    : "";
  return {
    ...(supportsRatio ? { aspectRatio: ratio } : {}),
    ...(resolutionScale ? { resolutionScale } : {}),
    ...(outputSize ? { size: outputSize, outputSize } : {}),
  };
}

function jobKind(job = {}) {
  return String(job.kind || job.input?._kind || job.params?._kind || "")
    .trim()
    .toLowerCase();
}

function isRegionEditJob(job = {}) {
  return jobKind(job) === "ui-design-region-edit";
}

function jobOutputUrls(job = {}) {
  return resolveTaskMedia(job).urls;
}

function jobToEntries(job = {}, result = null) {
  const media = resolveTaskMedia(job, result);
  const urls = media.urls;
  return urls.map((url, index) => ({
    url,
    displayUrl: media.displayByUrl[url] || "",
    jobId: job.id,
    createdAt: job.createdAt || "",
    groupId: String(
      job.input?.batchId ||
        job.input?.groupId ||
        (isRegionEditJob(job)
          ? `region-${job.input?.assistantRunId || job.id}`
          : job.id),
    ),
    groupIndex: Number(job.input?.batchIndex || index),
    parent: String(job.input?.parentOutputUrl || ""),
    deviceId: String(job.input?.deviceId || job.input?.viewId || "web"),
  }));
}

function taskEntries(jobs = [], extraParentUrls = []) {
  const draftEntries = jobs.filter((job) => !isRegionEditJob(job)).flatMap(jobToEntries);
  const parentUrls = [
    ...draftEntries.map((item) => item.url),
    ...extraParentUrls.filter(Boolean),
  ];
  const regionEntries = jobs
    .filter(isRegionEditJob)
    .flatMap(jobToEntries)
    .map((entry) => {
      const parent = resolveParentOutputUrl(entry.parent, parentUrls);
      return { ...entry, parent: parent || entry.parent || "" };
    });
  return [...regionEntries, ...draftEntries];
}

function isDeadAssistantRun(error) {
  const status = Number(error?.status || 0);
  if (status === 404 || status === 410) return true;
  const code = String(error?.code || "").toLowerCase();
  if (["not_found", "assistant_run_not_found"].includes(code)) return true;
  const message = String(error?.message || "");
  return /不存在|已取消|已停止|canceled|cancelled/i.test(message);
}

async function waitForArtboardImage(artboard, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const image = artboard?.querySelector("img");
    if (image?.naturalWidth) return image;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  throw new Error("设计稿还在加载，请稍后再试");
}

function regionResultEntry({ url, parent, runId, deviceId = "web" }) {
  return {
    url,
    displayUrl: "",
    jobId: "",
    createdAt: new Date().toISOString(),
    groupId: runId ? `region-${runId}` : `region-${url}`,
    groupIndex: 0,
    parent: String(parent || ""),
    deviceId,
  };
}

function WorkshopSelect({
  value,
  options,
  onChange,
  label,
  className = "",
  icon = "bi-cpu",
}) {
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const selected = options.find((item) => item.value === value) || options[0];
  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - 18;
    const opensUp = spaceBelow < 180 && rect.top > spaceBelow;
    const maxHeight = Math.max(
      140,
      Math.min(360, opensUp ? rect.top - 18 : spaceBelow),
    );
    setMenuStyle({
      left: Math.round(Math.min(rect.left, window.innerWidth - rect.width - 12)),
      ...(opensUp
        ? { bottom: Math.round(window.innerHeight - rect.top + 6), top: "auto" }
        : { top: Math.round(rect.bottom + 6), bottom: "auto" }),
      width: Math.round(rect.width),
      maxHeight,
    });
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === "Escape" && setOpen(false);
    positionMenu();
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
  return (
    <div
      className={`ratio-select ${className}${open ? " is-open" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ratio-select__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!options.length}
        onClick={() => {
          positionMenu();
          setOpen((current) => !current);
        }}
      >
        <span className="ratio-select__value">
          <span>
            {selected?.label || (options.length ? "请选择" : "加载中…")}
          </span>
        </span>
        <i className="bi bi-chevron-down ratio-select__chevron" />
      </button>
      {open && createPortal(
        <div
          className="ratio-select__menu is-glass dws-select-menu"
          role="listbox"
          style={menuStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`ratio-select__option has-icon${item.value === value ? " is-selected" : ""}`}
              role="option"
              aria-selected={item.value === value}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              {(item.icon || icon) === "bi-cpu" ? (
                <SoftMark name="cpu" size="sm" />
              ) : (
                <i className={`bi ${item.icon || icon}`} />
              )}
              <span>{item.label}</span>
              {item.value === value && <i className="bi bi-check2" />}
            </button>
          ))}
        </div>
      , document.body)}
    </div>
  );
}

function EmptyCanvas({ uploading, onUpload }) {
  return (
    <div className="dws-empty">
      <div className="dws-empty-sketch" aria-hidden="true">
        <header>
          <i />
          <span />
          <b />
          <b />
        </header>
        <div>
          <aside>
            <i />
            <i />
            <i />
            <i />
          </aside>
          <div className="dws-empty-content">
            <span className="is-hero" />
            <span className="is-copy" />
            <section>
              <i />
              <i />
              <i />
            </section>
          </div>
        </div>
      </div>
      <strong>描述左侧需求后生成</strong>
      <span>也可以上传已有设计稿</span>
      <button
        type="button"
        className="dws-empty-editor"
        disabled={uploading}
        onClick={(event) => {
          event.stopPropagation();
          onUpload();
        }}
      >
        <i className={`bi ${uploading ? "bi-arrow-repeat spin" : "bi-upload"}`} />
        {uploading ? "正在上传…" : "上传设计稿"}
      </button>
    </div>
  );
}

function PageTypePicker({ light, style, value, onSelect, onClose }) {
  return createPortal(
    <div
      className="dws-page-type-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`dws-page-type-picker${light ? " is-light" : ""}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="dws-page-type-title"
      >
        <header className="dws-page-type-header">
          <span>
            <strong id="dws-page-type-title">选择页面类型</strong>
          </span>
          <button type="button" aria-label="关闭页面类型选择" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <div className="dws-page-type-grid">
          {PAGE_TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={value === item.id ? "is-on" : ""}
              aria-pressed={value === item.id}
              onClick={() => onSelect(item.id)}
            >
              <span className="dws-page-type-icon">
                <i className={`bi ${item.icon}`} />
              </span>
              <span className="dws-page-type-copy">
                <strong>{item.label}</strong>
              </span>
              <i
                className={`bi ${value === item.id ? "bi-check-circle-fill" : "bi-arrow-up-right"}`}
              />
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ConfigPicker({
  type,
  light,
  style,
  value,
  spec,
  device,
  onSelect,
  onSpec,
  onState,
  onClose,
}) {
  const title =
    type === "style"
      ? "选择视觉风格"
      : type === "brand"
        ? "选择品牌主色"
        : "配置设计系统";
  const system = resolveDesignSystem(device, spec);
  return createPortal(
    <div
      className="dws-config-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`dws-config-picker is-${type}${light ? " is-light" : ""}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`dws-${type}-title`}
      >
        <header className="dws-config-header">
          <span>
            <strong id={`dws-${type}-title`}>{title}</strong>
          </span>
          <button
            type="button"
            aria-label={`关闭${title}选择`}
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        {type === "style" ? (
          <div className="dws-style-grid">
            {VISUAL_STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={value === item.id ? "is-on" : ""}
                aria-pressed={value === item.id}
                onClick={() => onSelect(item.id)}
              >
                <span className="dws-style-preview">
                  {item.preview.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span className="dws-style-copy">
                  <i className={`bi ${item.icon}`} />
                  <strong>{item.label}</strong>
                </span>
                <i
                  className={`bi ${value === item.id ? "bi-check-circle-fill" : "bi-arrow-up-right"}`}
                />
              </button>
            ))}
          </div>
        ) : type === "brand" ? (
          <div className="dws-brand-grid">
            {BRAND_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={value === item.value ? "is-on" : ""}
                style={{ "--picker-brand": item.value }}
                aria-pressed={value === item.value}
                onClick={() => onSelect(item.value)}
              >
                <span
                  className="dws-brand-swatch"
                  style={{ background: item.value }}
                />
                <span>
                  <strong>{item.label}</strong>
                </span>
                <span className="dws-brand-tones">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <i
                  className={`bi ${value === item.value ? "bi-check-circle-fill" : "bi-arrow-up-right"}`}
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="dws-spec-editor">
            <div className="dws-spec-overview">
              <span>
                <i className="bi bi-phone" />
                <b>{system.platformLabel}</b>
                <small>
                  {system.profile?.label || system.deviceLabel} ·{" "}
                  {system.viewport.width}×{system.viewport.height}
                </small>
              </span>
              <span>
                <i className="bi bi-grid-3x3-gap" />
                <b>{system.tokens.layout.columns} 列</b>
                <small>{system.tokens.space.margin}px 边距</small>
              </span>
              <span>
                <i className="bi bi-input-cursor-text" />
                <b>{system.tokens.control.height}px</b>
                <small>点击 {system.tokens.control.touch}px</small>
              </span>
              <span>
                <i className="bi bi-fonts" />
                <b>{system.typographyLabel}</b>
                <small>{system.tokens.type.body}px 正文</small>
              </span>
            </div>
            <DesignSystemFields spec={spec} onSpec={onSpec} onState={onState} />
            <ul className="dws-spec-rules">
              {system.chromeLines.slice(0, 4).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function VersionDrawer({
  light,
  forest,
  activeOutput,
  onSelect,
  onIterate,
  onDelete,
  onClose,
}) {
  const [expanded, setExpanded] = useState(() => forest.map((item) => item.id));
  const [selectedIds, setSelectedIds] = useState([]);
  const allNodes = useMemo(
    () => forest.flatMap((major) => collectDescendants(major)),
    [forest],
  );
  const selectedNodes = allNodes.filter((node) =>
    selectedIds.includes(node.id),
  );
  const imageCount = allNodes.reduce(
    (sum, node) =>
      sum + Object.values(node.carriers || {}).filter(Boolean).length,
    0,
  );
  return createPortal(
    <div
      className={`dvd-scrim${light ? " is-light" : ""}`}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="dvd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dvd-title"
      >
        <div
          className="dvd-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整版本抽屉宽度"
        >
          <i />
        </div>
        <header className="dvd-header">
          <div className="dvd-heading">
            <div className="dvd-title-row">
              <strong id="dvd-title">设计版本</strong>
              <span className="dvd-stats">
                {forest.length} 组 · {allNodes.length} 版 · {imageCount} 图
              </span>
            </div>
          </div>
          <button
            type="button"
            className="dvd-icon-btn"
            aria-label="关闭版本抽屉"
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <div className="dvd-toolbar">
          <div className="dvd-toolbar-left">
            <strong>
              {selectedNodes.length
                ? `已选 ${selectedNodes.length}`
                : "管理版本"}
            </strong>
            <small>
              {selectedNodes.length
                ? `含 ${selectedNodes.reduce((sum, node) => sum + Object.keys(node.carriers || {}).length, 0)} 张图`
                : "点预览打开画布，可勾选后批量删除"}
            </small>
          </div>
          <div className="dvd-toolbar-actions">
            {selectedNodes.length > 0 && (
              <button
                type="button"
                className="dvd-text-btn"
                onClick={() => setSelectedIds([])}
              >
                取消选择
              </button>
            )}
            <button
              type="button"
              className="dvd-text-btn"
              disabled={!forest.length}
              onClick={() =>
                setExpanded(
                  expanded.length > 1
                    ? [forest[0]?.id].filter(Boolean)
                    : forest.map((item) => item.id),
                )
              }
            >
              {expanded.length > 1 ? "收起" : "展开全部"}
            </button>
            <button
              type="button"
              className="dvd-danger-btn"
              disabled={!selectedNodes.length}
              onClick={() => onDelete(selectedNodes)}
            >
              <i className="bi bi-trash3" />
              删除
            </button>
          </div>
        </div>
        <div className="dvd-body">
          {forest.map((major) => (
            <article
              key={major.id}
              className={`dvd-major${expanded.includes(major.id) ? " is-open" : ""}${Object.values(major.carriers || {}).includes(activeOutput) ? " is-current" : ""}`}
            >
              <div className="dvd-major-bar">
                <button
                  type="button"
                  className="dvd-major-main"
                  aria-expanded={expanded.includes(major.id)}
                  onClick={() => {
                    const extras =
                      Object.keys(major.carriers || {}).length > 1 ||
                      (major.children || []).length > 0;
                    if (extras) {
                      setExpanded((current) =>
                        current.includes(major.id)
                          ? current.filter((id) => id !== major.id)
                          : [...current, major.id],
                      );
                      return;
                    }
                    const url = pickCarrier(major) || major.cover;
                    if (url) onSelect(url);
                  }}
                >
                  <span className="dvd-major-thumb">
                    <AuthenticatedImage
                      src={major.cover}
                      alt=""
                      maxDimension={240}
                    />
                  </span>
                  <span className="dvd-major-copy">
                    <span className="dvd-major-title">
                      <strong>{major.label}</strong>
                      <em>{1 + major.descendantCount} 版</em>
                    </span>
                    <small>{Object.keys(major.carriers).length} 个设备稿</small>
                  </span>
                </button>
                <div className="dvd-major-actions">
                  <button
                    type="button"
                    aria-label={`选择 ${major.label}`}
                    onClick={() =>
                      setSelectedIds((current) =>
                        current.includes(major.id)
                          ? current.filter((id) => id !== major.id)
                          : [...current, major.id],
                      )
                    }
                  >
                    <i
                      className={`bi ${selectedIds.includes(major.id) ? "bi-check-square-fill" : "bi-square"}`}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`迭代 ${major.label}`}
                    disabled={!canIterate(major)}
                    onClick={() => onIterate(major)}
                  >
                    <i className="bi bi-arrow-repeat" />
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    aria-label={`删除 ${major.label}`}
                    onClick={() => onDelete(major)}
                  >
                    <i className="bi bi-trash3" />
                  </button>
                </div>
              </div>
              {expanded.includes(major.id) &&
                (Object.keys(major.carriers || {}).length > 1 ||
                  (major.children || []).length > 0) && (
                <div className="dvd-major-extra">
                  {Object.keys(major.carriers || {}).length > 1 && (
                    <div className="dvd-carriers">
                      {Object.entries(major.carriers).map(([deviceId, url]) => (
                        <button
                          key={url}
                          type="button"
                          className={`dvd-carrier${activeOutput === url ? " is-on" : ""}`}
                          onClick={() => onSelect(url)}
                        >
                          <AuthenticatedImage
                            src={url}
                            alt=""
                            maxDimension={88}
                          />
                          <span>
                            <i className={`bi ${getDesignDevice(deviceId).icon}`} />
                            {getDesignDevice(deviceId).label}{" "}
                            {getDesignDevice(deviceId).ratio}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {collectDescendants(major, { includeSelf: false }).map(
                    (child) => {
                      const url =
                        child.cover || Object.values(child.carriers || {})[0];
                      if (!url) return null;
                      const active =
                        activeOutput === url ||
                        Object.values(child.carriers || {}).includes(
                          activeOutput,
                        );
                      return (
                        <button
                          key={child.id}
                          type="button"
                          className={`dvd-child${active ? " is-on" : ""}`}
                          onClick={() => onSelect(url)}
                        >
                          <span className="dvd-child-thumb">
                            <AuthenticatedImage
                              src={url}
                              alt=""
                              maxDimension={88}
                            />
                          </span>
                          <span className="dvd-child-copy">
                            <strong>{child.label}</strong>
                            <small>
                              {String(child.id || "").startsWith("region-")
                                ? "框选优化"
                                : "迭代"}
                            </small>
                          </span>
                          <i className="bi bi-chevron-right" />
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function DesignWorkshopView() {
  const { requestAuth } = useAuthPrompt();
  const isDark = useIsDark();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const designFileInputRef = useRef(null);
  const regionFileInputRef = useRef(null);
  const pageTypeTriggerRef = useRef(null);
  const styleTriggerRef = useRef(null);
  const brandTriggerRef = useRef(null);
  const specTriggerRef = useRef(null);
  const artboardRef = useRef(null);
  const mountedRef = useRef(true);
  const taskControllerRef = useRef(null);
  const historyControllerRef = useRef(null);
  const recoveryControllerRef = useRef(null);
  const analysisControllerRef = useRef(null);
  const activeJobIdsRef = useRef(new Set());
  const resumeJobIdsRef = useRef(new Set());
  const generationRunRef = useRef(false);
  const previewUrlsRef = useRef(new Set());
  const regionStartRef = useRef(null);
  const regionAdjustRef = useRef(null);
  const regionPersistRef = useRef({});
  const regionResumeIdsRef = useRef(new Set());
  const continueRegionProcessRef = useRef(async () => {});
  const regionContinueLockRef = useRef(false);
  const manualStartRef = useRef(null);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState("");
  const [brief, setBrief] = useState("");
  const [iterationBrief, setIterationBrief] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState(["web"]);
  const [viewDeviceId, setViewDeviceId] = useState("web");
  const [pageTypeId, setPageTypeId] = useState("landing");
  const [customPageType, setCustomPageType] = useState("");
  const [styleId, setStyleId] = useState("minimal");
  const [brandColor, setBrandColor] = useState(BRAND_COLORS[0].value);
  const [colorScheme, setColorScheme] = useState("light");
  const [spec, setSpec] = useState(DEFAULT_SPEC);
  const [references, setReferences] = useState([]);
  const [iterationSource, setIterationSource] = useState("");
  const [entries, setEntries] = useState([]);
  const [activeOutput, setActiveOutput] = useState("");
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const [failedDeviceIds, setFailedDeviceIds] = useState([]);
  const [status, setStatus] = useState("");
  const [localError, setLocalError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState("controls");
  const [pageTypePicker, setPageTypePicker] = useState(null);
  const [configPicker, setConfigPicker] = useState(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [analysisModelId, setAnalysisModelId] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisElements, setAnalysisElements] = useState([]);
  const [analysisSelectedId, setAnalysisSelectedId] = useState("");
  const [analysisExporting, setAnalysisExporting] = useState(false);
  const [analysisTypes, setAnalysisTypes] = useState(["text", "icon", "image"]);
  const [activeImageDimensions, setActiveImageDimensions] = useState(null);
  const [analysisImageDimensions, setAnalysisImageDimensions] = useState(null);
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [regions, setRegions] = useState([]);
  const [activeRegionId, setActiveRegionId] = useState("");
  const [regionDraft, setRegionDraft] = useState(null);
  const [regionReferences, setRegionReferences] = useState([]);
  const [regionRecognition, setRegionRecognition] = useState([]);
  const [regionAction, setRegionAction] = useState("remove");
  const [regionPrompt, setRegionPrompt] = useState("");
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionStatus, setRegionStatus] = useState("");
  const [regionError, setRegionError] = useState("");
  const [regionApproving, setRegionApproving] = useState(false);
  const [regionFullscreen, setRegionFullscreen] = useState(false);
  const [regionPreviewUrl, setRegionPreviewUrl] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualDraft, setManualDraft] = useState(null);

  const pageType =
    PAGE_TYPES.find((item) => item.id === pageTypeId) || PAGE_TYPES[0];
  const visualStyle =
    VISUAL_STYLES.find((item) => item.id === styleId) || VISUAL_STYLES[0];
  const device = getDesignDevice(viewDeviceId);
  const radiusLabel =
    SPEC_OPTIONS.radius.find(([id]) => id === spec.radius)?.[1] || "标准 8px";
  const densityLabel =
    SPEC_OPTIONS.density.find(([id]) => id === spec.density)?.[1] || "均衡";
  const brandLabel =
    BRAND_COLORS.find((item) => item.value === brandColor)?.label || "主色";
  const selectedDeviceLabel = selectedDeviceIds
    .map((id) => getDesignDevice(id)?.label)
    .filter(Boolean)
    .join(" / ");
  const activeSystem = useMemo(
    () =>
      resolveDesignSystem(device, {
        ...spec,
        brandColor,
        colorScheme,
      }),
    [brandColor, colorScheme, device, spec],
  );
  const isIteration = Boolean(iterationSource);
  const hasReference = isIteration || references.length > 0;
  const activeModel =
    models.find((item) => item.id === modelId) || models[0] || null;
  const referenceLimit = activeModel
    ? Math.min(
        MAX_REFERENCES,
        Math.max(0, Number(activeModel.maxReferenceImages || 0)),
      )
    : MAX_REFERENCES;
  const unitCost = Math.max(0, Number(activeModel?.creditCost || 0));
  const totalCost =
    unitCost * Math.max(1, isIteration ? 1 : selectedDeviceIds.length);
  const costLabel = totalCost ? `${totalCost} 积分` : "免费";
  const outputMaps = useMemo(() => {
    const outputs = entries.map((item) => item.url);
    return {
      outputs,
      // 原图 URL → 展示图 URL；大图预览时用，404 回退原图
      displays: Object.fromEntries(
        entries.map((item) => [item.url, item.displayUrl || ""]),
      ),
      groups: Object.fromEntries(
        entries.map((item) => [item.url, item.groupId]),
      ),
      indexes: Object.fromEntries(
        entries.map((item) => [item.url, item.groupIndex]),
      ),
      parents: Object.fromEntries(
        entries.map((item) => [item.url, item.parent]),
      ),
      devices: Object.fromEntries(
        entries.map((item) => [item.url, item.deviceId]),
      ),
    };
  }, [entries]);
  const tree = useMemo(
    () =>
      buildVersionForest({
        outputs: outputMaps.outputs,
        outputGroups: outputMaps.groups,
        outputGroupIndexes: outputMaps.indexes,
        outputParents: outputMaps.parents,
        outputDevices: outputMaps.devices,
      }),
    [outputMaps],
  );
  const activeNode =
    tree.nodeById.get(tree.metaByOutput[activeOutput]?.nodeId) || null;
  const activeVersionLabel =
    tree.metaByOutput[activeOutput]?.label || activeNode?.label || "";
  const majors = useMemo(
    () =>
      tree.forest.map((major) => ({
        ...major,
        cover: pickCarrier(major, viewDeviceId) || major.cover,
      })),
    [tree, viewDeviceId],
  );
  const pagedMajors = majors.slice(historyPage * 4, historyPage * 4 + 4);
  const historyPages = Math.max(1, Math.ceil(majors.length / 4));
  const region =
    regions.find((item) => item.id === activeRegionId) || regions[0] || null;
  const regionElements = region?.elements || [];
  const regionMarked = region?.marked || [];
  const regionViewport = region?.viewport || null;
  const regionResultUrls = regions
    .map((item) => item.resultUrl)
    .filter(Boolean);
  const regionResult = region?.resultUrl || regionResultUrls[0] || "";
  const visibleRegionElements = regionElements.filter(
    (node) =>
      node.manual === true ||
      regionNodeMatchesRecognitionTypes(node, regionRecognition),
  );
  const regionMarkedElements = visibleRegionElements.filter((node) =>
    regionMarked.includes(node.id),
  );
  const hasRegionSelection = regions.length > 0 || Boolean(regionDraft);
  const regionWantsTransparent = wantsRegionTransparentOutput(
    regionPrompt,
    regionAction,
  );
  const regionOutputWidth = Math.max(
    1,
    Math.round((activeImageDimensions?.width || 1024) * (region?.width || 1)),
  );
  const regionOutputHeight = Math.max(
    1,
    Math.round((activeImageDimensions?.height || 1024) * (region?.height || 1)),
  );
  const regionOutputSizeLabel =
    regions.length > 1
      ? `共 ${regions.length} 处`
      : `${regionOutputWidth}×${regionOutputHeight}`;
  const regionPendingCount = regionBusy
    ? Math.max(1, regions.filter((item) => !item.resultUrl).length)
    : 0;
  const regionHasMarks = regions.some((box) => box.marked?.length);
  const regionHasPrompt = Boolean(regionPrompt.trim());
  const regionHasStyleShortcut =
    regionReferences.length > 0 &&
    ["improve-icon", "custom"].includes(regionAction);
  const regionCanProcess =
    regions.length > 0 &&
    (regionHasPrompt ||
      regionHasMarks ||
      regionHasStyleShortcut ||
      regionAction === "replace-background");
  const regionActionGuide =
    regionAction === "remove"
      ? {
          placeholder: "例如：去掉这张卡上的价格和促销标签",
          next: "写明要去掉什么，或分析后点选元素",
        }
      : regionAction === "improve-icon"
        ? {
            placeholder: "例如：图标更精致，保持原来的含义",
            next: "写一句要求，或添加风格参考图",
          }
        : regionAction === "replace-background"
          ? {
              placeholder: "例如：换成更干净的浅色渐变（可留空直接开始）",
              next: "可直接开始，也可补充背景风格",
            }
          : {
              placeholder: "说明要改什么，越具体越好",
              next: "写明修改要求，或添加参考图",
            };
  const regionNextStep = regionBusy
    ? regionStatus || "正在处理…"
    : regionError
      ? regionError
      : regionResultUrls.length
        ? "满意就加入素材库，或改完再出一版"
        : !regions.length
          ? "先在左侧拖出要改的区域"
          : regionCanProcess
            ? "可以开始编辑，拖空白处还能再加框"
            : regionActionGuide.next;

  const buildPrompt = useCallback(
    (targetDevice = device, { isAnchor = false } = {}) =>
      buildDesignSystemPrompt({
        device: targetDevice,
        spec,
        brief,
        pageType,
        pageTypeId,
        customPageType,
        visualStyle,
        brandColor,
        colorScheme,
        references,
        isIteration,
        iterationBrief,
        selectedDeviceLabels: selectedDeviceIds
          .map((id) => getDesignDevice(id)?.label)
          .filter(Boolean),
        isAnchor,
      }),
    [
      brandColor,
      brief,
      colorScheme,
      customPageType,
      device,
      isIteration,
      iterationBrief,
      pageType,
      pageTypeId,
      references,
      selectedDeviceIds,
      spec,
      visualStyle,
    ],
  );

  const patchSpec = useCallback((key, value) => {
    setSpec((current) => {
      if (key === "mobileSystem") {
        const profile = getPhoneProfiles(value)[0];
        return {
          ...current,
          mobileSystem: value,
          phoneProfile: profile?.id || current.phoneProfile,
        };
      }
      return { ...current, [key]: value };
    });
  }, []);

  const toggleSpecState = useCallback((id) => {
    setSpec((current) => {
      const states = current.states || [];
      const next = states.includes(id)
        ? states.length > 1
          ? states.filter((item) => item !== id)
          : states
        : [...states, id];
      return { ...current, states: next };
    });
  }, []);

  const persistRegionProcess = useCallback((patch = {}) => {
    const snapshot = {
      ...regionPersistRef.current,
      ...patch,
    };
    if (
      !snapshot.outputUrl ||
      !(snapshot.selections?.length || snapshot.selection)
    ) {
      return false;
    }
    regionPersistRef.current = snapshot;
    return writeRegionProcessSession(snapshot);
  }, []);

  const ingestDesignJob = useCallback((job, result = null, { activate = true } = {}) => {
    const incoming = jobToEntries(job, result);
    if (!incoming.length || !mountedRef.current) return [];
    const urls = new Set(incoming.map((item) => item.url));
    setEntries((current) => [
      ...incoming,
      ...current.filter((item) => !urls.has(item.url)),
    ]);
    if (activate) {
      setActiveOutput(incoming[0].url);
      setViewDeviceId(incoming[0].deviceId || "web");
      setWorkspaceView("canvas");
    }
    return incoming;
  }, []);

  const resumeActiveJob = useCallback(async (job, signal) => {
    const jobId = String(job?.id || "");
    if (!jobId || resumeJobIdsRef.current.has(jobId)) return;
    resumeJobIdsRef.current.add(jobId);
    activeJobIdsRef.current.add(jobId);
    if (mountedRef.current) {
      setRunning(true);
      setWorkspaceView("canvas");
      setStatus(`正在恢复 ${String(job.input?.viewLabel || "未完成设计稿")}`);
    }
    try {
      const completed = await waitForServerAiJob(jobId, {
        signal,
        onStatus: (message) => mountedRef.current && setStatus(`恢复任务 · ${message}`),
        onImage: (_urls, partialJob, partialResult) => {
          if (!signal.aborted) ingestDesignJob(partialJob, partialResult);
        },
      });
      if (!signal.aborted) ingestDesignJob(completed.job || job, completed.result);
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current) {
        setLocalError(error?.message || "未完成任务恢复失败");
      }
    } finally {
      resumeJobIdsRef.current.delete(jobId);
      activeJobIdsRef.current.delete(jobId);
      if (!resumeJobIdsRef.current.size && !generationRunRef.current && mountedRef.current) {
        setRunning(false);
        setStatus("");
      }
    }
  }, [ingestDesignJob]);

  const applyRegionSession = useCallback((session, boxes) => {
    if (!session?.outputUrl || !boxes?.length) return;
    regionPersistRef.current = {
      ...regionPersistRef.current,
      ...session,
      outputUrl: session.outputUrl,
      selections: boxes,
    };
    writeRegionProcessSession(regionPersistRef.current);
    setActiveOutput(session.outputUrl);
    setRegions(boxes);
    setActiveRegionId(boxes[0]?.id || "");
    setRegionMode(true);
    if (Array.isArray(session.recognitionTypes)) {
      setRegionRecognition(session.recognitionTypes);
    }
    if (session.editAction) setRegionAction(session.editAction);
    if (session.prompt != null) setRegionPrompt(session.prompt);
    setRegionStatus(session.stage || "勾选识别类型后开始分析");
    setRegionError(session.error || "");
    setRegionPreviewUrl(session.resultUrl || boxes[0]?.resultUrl || "");
    if (shouldContinueRegionProcess(session, boxes)) {
      setRegionBusy(true);
      setRegionStatus(
        boxes.some((box) => box.runId && !box.resultUrl)
          ? "正在恢复框选优化任务…"
          : "正在继续框选优化…",
      );
    }
  }, []);

  const loadHistory = useCallback(async () => {
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    try {
      const [response, activeRuns] = await Promise.all([
        listServerAiJobs(80, {
          type: "ui_design",
          signal: controller.signal,
          excludeFailed: true,
        }),
        listActiveAssistantRuns({
          workspace: "ui_design",
          signal: controller.signal,
        }).catch(() => []),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      const savedUploads = readSavedUploads();
      const regionJobs = [
        ...response.jobs.filter(isRegionEditJob),
        ...assistantRunsToRegionJobs(activeRuns),
      ];
      const next = taskEntries(response.jobs, [
        ...savedUploads.map((item) => item.url),
        ...regionJobs
          .map((job) => String(job.input?.parentOutputUrl || ""))
          .filter(Boolean),
      ]);
      const activeJobs = response.jobs.filter((job) =>
        ACTIVE_JOB_STATUSES.has(String(job.status || "").toLowerCase()),
      );
      if (activeJobs.length) {
        if (!recoveryControllerRef.current || recoveryControllerRef.current.signal.aborted) {
          recoveryControllerRef.current = new AbortController();
        }
        activeJobs.forEach((job) => {
          void resumeActiveJob(job, recoveryControllerRef.current.signal);
        });
      }
      const urls = new Set(next.map((item) => item.url));
      const parentPool = [
        ...next.map((item) => item.url),
        ...savedUploads.map((item) => item.url),
      ];
      setEntries((current) => {
        const locals = current
          .filter(
            (item) =>
              String(item.groupId || "").startsWith("region-") &&
              !urls.has(item.url),
          )
          .map((item) => {
            const parent = resolveParentOutputUrl(item.parent, parentPool);
            return { ...item, parent: parent || item.parent || "" };
          });
        return [
          ...savedUploads.filter((item) => !urls.has(item.url)),
          ...locals,
          ...next,
        ];
      });
      const parent =
        regionPersistRef.current.outputUrl ||
        inferredParentFromRegionJobs(regionJobs);
      let recovered = [];
      setRegions((boxes) => {
        recovered = recoverRegionBoxesFromJobs(boxes, regionJobs, parent);
        return recovered.length ? recovered : boxes;
      });
      if (recovered.length) {
        if (parent) {
          setActiveOutput((current) => current || parent);
        }
        const snapshot = {
          ...regionPersistRef.current,
          outputUrl: parent || regionPersistRef.current.outputUrl,
          selections: recovered,
        };
        persistRegionProcess({
          ...snapshot,
          loading: shouldContinueRegionProcess(snapshot, recovered),
          stage: shouldContinueRegionProcess(snapshot, recovered)
            ? "正在继续框选优化…"
            : regionPersistRef.current.stage,
        });
        if (shouldContinueRegionProcess(snapshot, recovered)) {
          setRegionMode(true);
          setRegionBusy(true);
          setActiveRegionId((current) => current || recovered[0].id);
          setRegionStatus("正在继续框选优化…");
        }
      }
      const draftEntries = next.filter(
        (item) => !String(item.groupId || "").startsWith("region-"),
      );
      setActiveOutput(
        (current) =>
          current ||
          parent ||
          draftEntries[0]?.url ||
          next[0]?.url ||
          savedUploads[0]?.url ||
          "",
      );
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setLocalError(error?.message || "历史记录加载失败");
    } finally {
      if (mountedRef.current && historyControllerRef.current === controller)
        setHistoryLoading(false);
      if (mountedRef.current && !controller.signal.aborted) {
        const snapshot = regionPersistRef.current;
        const boxes = snapshot.selections || [];
        if (shouldContinueRegionProcess(snapshot, boxes)) {
          void continueRegionProcessRef.current(
            boxes,
            snapshot.outputUrl,
          );
        }
      }
    }
  }, [persistRegionProcess, resumeActiveJob]);

  useEffect(() => {
    mountedRef.current = true;
    const saved = (() => {
      try {
        return JSON.parse(getScopedLocalItem(SETTINGS_KEY) || "null");
      } catch {
        return null;
      }
    })();
    if (saved) {
      if (typeof saved.brief === "string") setBrief(saved.brief);
      setSelectedDeviceIds(
        normalizeSelectedDeviceIds(
          saved.selectedDeviceIds || saved.deviceId || ["web"],
        ),
      );
      if (
        saved.pageTypeId &&
        PAGE_TYPES.some((item) => item.id === saved.pageTypeId)
      )
        setPageTypeId(saved.pageTypeId);
      if (
        saved.styleId &&
        VISUAL_STYLES.some((item) => item.id === saved.styleId)
      )
        setStyleId(saved.styleId);
      if (BRAND_COLORS.some((item) => item.value === saved.brandColor))
        setBrandColor(saved.brandColor);
      if (["light", "dark"].includes(saved.colorScheme))
        setColorScheme(saved.colorScheme);
      if (saved && typeof saved === "object") {
        setSpec((current) => ({
          ...current,
          audience: saved.audience || current.audience,
          goal: saved.goal || current.goal,
          navigation: saved.navigation || current.navigation,
          density: saved.density || current.density,
          typography: saved.typography || current.typography,
          radius: saved.radius || current.radius,
          responsive: saved.responsive || current.responsive,
          mobileSystem: saved.mobileSystem || current.mobileSystem,
          phoneProfile: saved.phoneProfile || current.phoneProfile,
          states: Array.isArray(saved.states) ? saved.states : current.states,
        }));
      }
    }
    const session = readRegionProcessSession();
    if (session) {
      applyRegionSession(session, normalizeRegionBoxesFromSession(session));
    }
    Promise.all([fetchRuntimeConfig(), loadHistory()])
      .then(([config]) => {
        if (!mountedRef.current) return;
        const nextModels = featureModels(config);
        setModels(nextModels);
        setModelId(
          nextModels.find((item) => item.default)?.id ||
            nextModels[0]?.id ||
            "",
        );
        const analysis =
          config.features?.["ai.uiDesign"]?.config?.analysisModels || [];
        setAnalysisModelId(
          String(
            analysis.find((item) => item.default)?.model ||
              analysis[0]?.model ||
              "",
          ),
        );
        const pending = takePendingPrompt("ui_design");
        if (pending) {
          const prompt = composePendingLaunchPrompt(pending, 1000);
          if (prompt) setBrief(prompt);
        }
      })
      .catch((error) => {
        if (mountedRef.current) {
          setLocalError(error?.message || "设计模型配置加载失败，请刷新后重试");
        }
      });
    return () => {
      mountedRef.current = false;
      taskControllerRef.current?.abort();
      historyControllerRef.current?.abort();
      recoveryControllerRef.current?.abort();
      analysisControllerRef.current?.abort();
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, [applyRegionSession, loadHistory]);

  useEffect(() => {
    setScopedLocalItem(
      SETTINGS_KEY,
      JSON.stringify({
        brief,
        selectedDeviceIds,
        pageTypeId,
        customPageType,
        styleId,
        brandColor,
        colorScheme,
        ...spec,
        designSpecVersion: 2,
      }),
    );
  }, [
    brandColor,
    brief,
    colorScheme,
    customPageType,
    pageTypeId,
    selectedDeviceIds,
    spec,
    styleId,
  ]);

  useEffect(() => {
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = null;
    setAnalysisBusy(false);
    setActiveImageDimensions(null);
    setAnalysisImageDimensions(null);
    setAnalysisElements([]);
    setAnalysisSelectedId("");
    setAnalysisError("");
    setMediaError("");

    const savedRegionOutput = String(regionPersistRef.current.outputUrl || "");
    if (activeOutput && savedRegionOutput === activeOutput) {
      const restored = normalizeRegionBoxesFromSession(regionPersistRef.current);
      if (restored.length) {
        setRegions(restored);
        setActiveRegionId((current) =>
          restored.some((item) => item.id === current) ? current : restored[0].id,
        );
        setRegionMode(true);
        setRegionPrompt(regionPersistRef.current.prompt || "");
        setRegionRecognition(regionPersistRef.current.recognitionTypes || []);
        setRegionAction(regionPersistRef.current.editAction || "remove");
        setRegionPreviewUrl(
          regionPersistRef.current.resultUrl || restored[0]?.resultUrl || "",
        );
        setRegionStatus(regionPersistRef.current.stage || "");
        setRegionError(regionPersistRef.current.error || "");
        setRegionBusy(Boolean(regionPersistRef.current.loading));
      }
      return;
    }

    setRegionDialogOpen(false);
    setRegionMode(false);
    setRegions([]);
    setActiveRegionId("");
    setRegionDraft(null);
    setManualMode(false);
    setManualDraft(null);
    setRegionPrompt("");
    setRegionRecognition([]);
    setRegionAction("remove");
    setRegionPreviewUrl("");
    setRegionStatus("");
    setRegionError("");
    setRegionBusy(false);
    setRegionReferences((current) => {
      for (const item of current) {
        if (!item.preview) continue;
        URL.revokeObjectURL(item.preview);
        previewUrlsRef.current.delete(item.preview);
      }
      return [];
    });
  }, [activeOutput]);

  useEffect(() => {
    const nextDeviceId = outputMaps.devices[activeOutput];
    if (nextDeviceId) setViewDeviceId(nextDeviceId);
  }, [activeOutput, outputMaps.devices]);

  useEffect(() => {
    if (running || activeOutput) setWorkspaceView("canvas");
  }, [activeOutput, running]);

  useEffect(() => {
    if (!activeOutput || !regions.length) return;
    const savedRegionOutput = String(regionPersistRef.current.outputUrl || "");
    if (savedRegionOutput && savedRegionOutput !== activeOutput) return;
    persistRegionProcess({
      outputUrl: activeOutput,
      selection: region,
      selections: regions,
      prompt: regionPrompt,
      recognitionTypes: regionRecognition,
      editAction: regionAction,
      resultUrl: regionResult,
      resultUrls: regionResultUrls,
      stage: regionStatus,
      error: regionError,
      loading: regionBusy,
      conversationId:
        regions.find((item) => item.conversationId)?.conversationId || "",
      runId:
        regions.find((item) => item.runId && !item.resultUrl)?.runId ||
        regions.find((item) => item.runId)?.runId ||
        "",
    });
  }, [
    activeOutput,
    persistRegionProcess,
    region,
    regionAction,
    regionBusy,
    regionError,
    regionPrompt,
    regionRecognition,
    regionResult,
    regionResultUrls,
    regionStatus,
    regions,
  ]);

  useEffect(() => {
    const flush = () => {
      writeRegionProcessSession(regionPersistRef.current);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      if (versionDrawerOpen) setVersionDrawerOpen(false);
      else if (pageTypePicker) setPageTypePicker(null);
      else if (configPicker) setConfigPicker(null);
      else if (regionDialogOpen) setRegionDialogOpen(false);
      else if (analysisOpen) {
        analysisControllerRef.current?.abort();
        setAnalysisOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [
    analysisOpen,
    configPicker,
    pageTypePicker,
    regionDialogOpen,
    versionDrawerOpen,
  ]);

  const duplicateActiveRegion = useCallback(() => {
    if (!region || regionBusy) return;
    const offsetX = Math.max(
      0.02,
      20 / Math.max(1, activeImageDimensions?.width || 1000),
    );
    const offsetY = Math.max(
      0.02,
      20 / Math.max(1, activeImageDimensions?.height || 1000),
    );
    const nextX =
      region.x + region.width + offsetX <= 1
        ? region.x + offsetX
        : Math.max(0, region.x - offsetX);
    const nextY =
      region.y + region.height + offsetY <= 1
        ? region.y + offsetY
        : Math.max(0, region.y - offsetY);
    const duplicate = {
      ...region,
      id: crypto.randomUUID(),
      x: nextX,
      y: nextY,
      elements: [],
      marked: [],
      viewport: null,
      resultUrl: "",
      runId: "",
      conversationId: "",
    };
    setRegions((current) => [...current, duplicate]);
    setActiveRegionId(duplicate.id);
    setRegionMode(true);
    setManualMode(false);
    setRegionError("");
    setRegionStatus("已复制同尺寸选区，可拖动到目标位置");
  }, [activeImageDimensions, region, regionBusy]);

  useEffect(() => {
    if (!regionDialogOpen || !region) return undefined;
    const onCopy = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c")
        return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        window.getSelection()?.toString()
      ) {
        return;
      }
      event.preventDefault();
      duplicateActiveRegion();
    };
    window.addEventListener("keydown", onCopy);
    return () => window.removeEventListener("keydown", onCopy);
  }, [duplicateActiveRegion, region, regionDialogOpen]);

  const addFiles = useCallback(
    (files) => {
      const images = [...files]
        .filter(isImageFile)
        .slice(0, Math.max(0, referenceLimit - references.length));
      if (!images.length) return;
      const next = images.map((file) => {
        const preview = URL.createObjectURL(file);
        previewUrlsRef.current.add(preview);
        return { id: crypto.randomUUID(), file, preview, name: file.name };
      });
      setReferences((current) =>
        [...current, ...next].slice(0, referenceLimit),
      );
      setIterationSource("");
    },
    [referenceLimit, references.length],
  );

  const rememberUpload = useCallback((entry) => {
    const next = [
      entry,
      ...readSavedUploads().filter((item) => item.url !== entry.url),
    ].slice(0, 12);
    setScopedLocalItem(UPLOADS_KEY, JSON.stringify(next));
  }, []);

  const openDesignPicker = useCallback(() => {
    if (requestAuth({ featureLabel: "UI 设计稿" })) return;
    designFileInputRef.current?.click();
  }, [requestAuth]);

  const uploadDesign = useCallback(
    async (file) => {
      if (!file) return;
      if (!isImageFile(file)) {
        setLocalError("请选择 PNG、JPG 或 WEBP 设计稿");
        return;
      }
      if (requestAuth({ featureLabel: "UI 设计稿" })) return;
      setLocalError("");
      setUploadingDesign(true);
      try {
        const url = String(await uploadAiInputFile(file) || "").trim();
        if (!url) throw new Error("设计稿上传失败");
        const entry = {
          url,
          jobId: `upload-${crypto.randomUUID()}`,
          groupId: `upload-${Date.now().toString(36)}`,
          groupIndex: 0,
          parent: "",
          deviceId: viewDeviceId || selectedDeviceIds[0] || "web",
          createdAt: new Date().toISOString(),
          source: "upload",
        };
        setEntries((current) => [
          entry,
          ...current.filter((item) => item.url !== url),
        ]);
        setActiveOutput(url);
        setViewDeviceId(entry.deviceId);
        setMediaError("");
        rememberUpload(entry);
        notificationService.success("设计稿已放到画布");
      } catch (error) {
        setLocalError(error?.message || "设计稿上传失败");
      } finally {
        setUploadingDesign(false);
      }
    },
    [rememberUpload, requestAuth, selectedDeviceIds, viewDeviceId],
  );

  const generate = useCallback(async (retryDeviceIds = null) => {
    if (requestAuth({ featureLabel: "UI 设计稿" })) return;
    if (running || generationRunRef.current) return;
    setLocalError("");
    setFailedDeviceIds([]);
    if (isIteration && !iterationBrief.trim()) {
      setLocalError("请描述本次迭代只需要修改的内容");
      return;
    }
    if (!brief.trim() && !hasReference) {
      setLocalError("请先描述产品和页面内容，或导入一张参考界面");
      return;
    }
    if (!activeModel) {
      setLocalError("后台还没有为图片工作台分配可用模型。");
      return;
    }
    const maxReferenceImages = Math.max(0, Number(activeModel.maxReferenceImages || 0));
    if (!isIteration && references.length > maxReferenceImages) {
      setLocalError(
        `当前模型最多支持 ${maxReferenceImages} 张参考图，请移除多余图片后再生成。`,
      );
      return;
    }
    if (hasReference && maxReferenceImages < 1) {
      setLocalError("当前模型不支持参考图，请在后台切换模型后重试。");
      return;
    }
    const requestedDeviceIds = Array.isArray(retryDeviceIds) && retryDeviceIds.length
      ? retryDeviceIds
      : selectedDeviceIds;
    const devices = isIteration
      ? [
          getDesignDevice(
            tree.metaByOutput[iterationSource]?.deviceId || viewDeviceId,
          ),
        ]
      : orderDevicesForConsistency(requestedDeviceIds.map(getDesignDevice));
    const canUseSeriesAnchor = !isIteration && devices.length > 1 && maxReferenceImages > 0;
    const retryAnchor = Array.isArray(retryDeviceIds) && activeOutput ? activeOutput : "";
    const reservedReferences = (iterationSource ? 1 : 0) + (canUseSeriesAnchor || retryAnchor ? 1 : 0);
    const referenceCapacity = Math.max(0, maxReferenceImages - reservedReferences);
    if (references.length > referenceCapacity) {
      setLocalError(
        `当前模型本次最多读取 ${referenceCapacity} 张用户参考图，请移除多余图片后再生成。`,
      );
      return;
    }
    const controller = new AbortController();
    taskControllerRef.current?.abort();
    taskControllerRef.current = controller;
    generationRunRef.current = true;
    setRunning(true);
    setWorkspaceView("canvas");
    setStatus("正在上传参考图...");
    const groupId = `ui-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const uploaded = [];
      for (const item of references)
        uploaded.push(
          await uploadAiInputFile(item.file, { signal: controller.signal }),
        );
      let seriesAnchorUrl = retryAnchor;
      const failures = [];
      let completedCount = 0;
      for (let index = 0; index < devices.length; index += 1) {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const target = devices[index];
        setStatus(`正在生成 ${target.label}（${index + 1}/${devices.length}）`);
        const sourceUrls = [
          ...(iterationSource ? [iterationSource] : []),
          ...(seriesAnchorUrl ? [seriesAnchorUrl] : []),
          ...uploaded,
        ].slice(0, maxReferenceImages);
        const modelOutputParams = modelOutputParamsForRatio(activeModel, target.ratio);
        let jobId = "";
        try {
          const targetSystem = resolveDesignSystem(target, {
            ...spec,
            brandColor,
            colorScheme,
          });
          const created = await createServerAiJob({
            kind: iterationSource ? "ui-design-edit" : "ui-design-generation",
            clientRequestId: crypto.randomUUID(),
            prompt: buildPrompt(target, { isAnchor: devices.length > 1 && index === 0 }),
            input: {
              source: "ui-design-workshop",
              sourceUrls,
              ...modelOutputParams,
              platform: targetSystem.platformLabel,
              designSystem: targetSystem.platformId,
              phoneProfile: spec.phoneProfile,
              deviceId: target.id,
              viewId: target.id,
              viewLabel: target.label,
              parentOutputUrl: iterationSource,
              iterationMode: Boolean(iterationSource),
              batchId: groupId,
              groupId,
              batchIndex: index,
              batchSize: devices.length,
            },
            params: {
              publicModelKey: activeModel.publicModelKey,
              modelHint: activeModel.id,
              ...modelOutputParams,
              deviceId: target.id,
              viewId: target.id,
              viewLabel: target.label,
              parentOutputUrl: iterationSource,
              batchId: groupId,
              groupId,
              batchIndex: index,
              batchSize: devices.length,
            },
            units: 1,
            signal: controller.signal,
          });
          jobId = String(created.job?.id || "");
          if (!jobId) throw new Error("任务创建后未返回任务 ID");
          activeJobIdsRef.current.add(jobId);
          const completed = await waitForServerAiJob(jobId, {
            signal: controller.signal,
            onStatus: (message) => setStatus(`${target.label} · ${message}`),
            onImage: (_urls, partialJob, partialResult) =>
              ingestDesignJob(partialJob, partialResult),
          });
          const incoming = ingestDesignJob(completed.job || created.job, completed.result);
          if (!incoming.length) throw new Error("任务已完成，但没有返回可用图片");
          if (!seriesAnchorUrl && canUseSeriesAnchor) seriesAnchorUrl = incoming[0].url;
          completedCount += 1;
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          failures.push({ deviceId: target.id, message: error?.message || `${target.label} 生成失败` });
        } finally {
          if (jobId) activeJobIdsRef.current.delete(jobId);
        }
      }
      if (iterationSource && completedCount) {
        setIterationSource("");
        setIterationBrief("");
      }
      setFailedDeviceIds(failures.map((item) => item.deviceId));
      if (failures.length) {
        setLocalError(
          `${completedCount ? `已完成 ${completedCount} 张，` : ""}${failures.length} 个设备生成失败：${failures[0].message}`,
        );
      }
      if (completedCount) notificationService.success(`已完成 ${completedCount} 张设计稿`);
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setLocalError(error?.message || "设计稿生成失败");
    } finally {
      generationRunRef.current = false;
      if (mountedRef.current && taskControllerRef.current === controller) {
        if (!resumeJobIdsRef.current.size) {
          setRunning(false);
          setStatus("");
        }
      }
    }
  }, [
    requestAuth,
    activeOutput,
    activeModel,
    brandColor,
    brief,
    buildPrompt,
    colorScheme,
    hasReference,
    isIteration,
    iterationBrief,
    iterationSource,
    ingestDesignJob,
    references,
    running,
    selectedDeviceIds,
    spec,
    tree.metaByOutput,
    viewDeviceId,
  ]);

  const cancelGeneration = useCallback(async ({ acknowledgeUpstream = false } = {}) => {
    if (cancelling) return;
    setCancelling(true);
    setStatus(acknowledgeUpstream ? "正在停止任务" : "正在确认任务阶段");
    const jobIds = [...activeJobIdsRef.current];
    const settled = await Promise.allSettled(
      jobIds.map((id) =>
        cancelServerAiJob(id, { acknowledgeUpstream }),
      ),
    );
    settled.forEach((item, index) => {
      if (item.status === "fulfilled") activeJobIdsRef.current.delete(jobIds[index]);
    });
    const needsConfirmation = settled.some(
      (item) => item.status === "rejected" && item.reason?.code === "task_cancel_confirmation_required",
    );
    if (needsConfirmation && !acknowledgeUpstream) {
      if (mountedRef.current) {
        setCancelConfirmationOpen(true);
        setCancelling(false);
        setStatus("任务已提交上游，请确认是否停止接收结果");
      }
      return;
    }
    const failed = settled.find((item) => item.status === "rejected");
    if (failed) {
      if (mountedRef.current) {
        setCancelling(false);
        setLocalError(failed.reason?.message || "停止任务失败，任务仍在继续");
        setStatus("任务仍在运行，完成后会自动显示");
      }
      return;
    }
    taskControllerRef.current?.abort();
    recoveryControllerRef.current?.abort();
    activeJobIdsRef.current.clear();
    resumeJobIdsRef.current.clear();
    generationRunRef.current = false;
    if (mountedRef.current) {
      setRunning(false);
      setCancelling(false);
      setCancelConfirmationOpen(false);
      setStatus("");
    }
  }, [cancelling]);

  const openPicker = (type, ref) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(
      type === "specification" ? 680 : 600,
      window.innerWidth - 24,
    );
    const maxHeight = Math.min(660, window.innerHeight - 24);
    const left =
      rect.right + 12 + width <= window.innerWidth - 12
        ? rect.right + 12
        : Math.max(12, window.innerWidth - width - 12);
    const top = Math.min(
      Math.max(12, rect.top - 8),
      Math.max(12, window.innerHeight - maxHeight - 12),
    );
    setPageTypePicker(null);
    setConfigPicker({ type, style: { left, top, width, maxHeight } });
  };

  const openPageTypes = () => {
    const rect = pageTypeTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(620, window.innerWidth - 24);
    const maxHeight = Math.min(640, window.innerHeight - 24);
    const left =
      rect.right + 12 + width <= window.innerWidth - 12
        ? rect.right + 12
        : Math.max(12, window.innerWidth - width - 12);
    const top = Math.min(
      Math.max(12, rect.top - 8),
      Math.max(12, window.innerHeight - maxHeight - 12),
    );
    setConfigPicker(null);
    setPageTypePicker({ left, top, width, maxHeight });
  };

  const patchActiveRegion = useCallback((patch) => {
    setRegions((current) =>
      current.map((item) =>
        item.id === activeRegionId ? { ...item, ...patch } : item,
      ),
    );
  }, [activeRegionId]);

  const clearRegionSession = useCallback(() => {
    const runIds = new Set(
      (regionPersistRef.current.selections || [])
        .map((item) => item.runId)
        .filter(Boolean),
    );
    if (regionPersistRef.current.runId) {
      runIds.add(regionPersistRef.current.runId);
    }
    for (const runId of runIds) {
      cancelAssistantRun(runId).catch(() => null);
    }
    clearRegionProcessSession();
    regionPersistRef.current = {};
    setRegionMode(true);
    setRegions([]);
    setActiveRegionId("");
    setRegionDraft(null);
    setManualMode(false);
    setManualDraft(null);
    setRegionError("");
    setRegionStatus("");
    setRegionPreviewUrl("");
    setRegionReferences((current) => {
      for (const item of current) {
        if (item.preview) {
          URL.revokeObjectURL(item.preview);
          previewUrlsRef.current.delete(item.preview);
        }
      }
      return [];
    });
  }, []);

  const addRegionFiles = useCallback(
    (files) => {
      const images = [...(files || [])]
        .filter(isImageFile)
        .slice(
          0,
          Math.max(0, MAX_REGION_STYLE_REFERENCES - regionReferences.length),
        );
      if (!images.length) return;
      const next = images.map((file) => {
        const preview = URL.createObjectURL(file);
        previewUrlsRef.current.add(preview);
        return { id: crypto.randomUUID(), file, preview, name: file.name };
      });
      setRegionReferences((current) =>
        [...current, ...next].slice(0, MAX_REGION_STYLE_REFERENCES),
      );
    },
    [regionReferences.length],
  );

  const beginRegion = (event) => {
    if (!regionMode || event.button !== 0) return;
    if (event.target.closest(".dws-region-box")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    regionStartRef.current = point;
    setRegionDraft({ ...point, width: 0, height: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveRegion = (event) => {
    const start = regionStartRef.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    setRegionDraft(
      resolveRegionPointerRect(start, x, y, rect, event.shiftKey),
    );
  };
  const finishRegion = (event) => {
    const start = regionStartRef.current;
    if (!start) return;
    regionStartRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    const next = resolveRegionPointerRect(
      start,
      x,
      y,
      rect,
      event.shiftKey,
    );
    setRegionDraft(null);
    if (next.width * rect.width < 8 || next.height * rect.height < 8) {
      setRegionError("框选范围太小，请至少拖出 8×8 像素的区域");
      return;
    }
    const box = createRegionBox(next, regions.length);
    if (!box) {
      setRegionError("框选范围太小，请至少拖出 8×8 像素的区域");
      return;
    }
    box.id = crypto.randomUUID();
    if (regionPersistRef.current.outputUrl !== activeOutput) {
      regionPersistRef.current = { outputUrl: activeOutput };
    }
    setRegions((current) => [...current, box]);
    setActiveRegionId(box.id);
    setRegionError("");
    setRegionStatus(
      regions.length
        ? `已框选 ${regions.length + 1} 处，将出 ${regions.length + 1} 张`
        : "可继续框选其他区域，框几处出几张",
    );
  };

  const beginRegionAdjustment = (event, box) => {
    if (regionBusy || event.button !== 0) return;
    const layer = event.currentTarget.closest(".dws-region-layer");
    const rect = layer?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveRegionId(box.id);
    regionAdjustRef.current = {
      pointerId: event.pointerId,
      regionId: box.id,
      handle:
        event.target.closest(".dws-region-handle")?.dataset.handle || "move",
      startX: event.clientX,
      startY: event.clientY,
      layerWidth: rect.width,
      layerHeight: rect.height,
      origin: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      changed: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveRegionAdjustment = (event) => {
    const adjustment = regionAdjustRef.current;
    if (!adjustment || adjustment.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - adjustment.startX) / adjustment.layerWidth;
    const dy = (event.clientY - adjustment.startY) / adjustment.layerHeight;
    const minimumWidth = Math.min(1, 8 / adjustment.layerWidth);
    const minimumHeight = Math.min(1, 8 / adjustment.layerHeight);
    const origin = adjustment.origin;
    const next = { ...origin };

    if (adjustment.handle === "move") {
      next.x = Math.max(0, Math.min(1 - origin.width, origin.x + dx));
      next.y = Math.max(0, Math.min(1 - origin.height, origin.y + dy));
    } else {
      if (adjustment.handle.includes("w")) {
        const right = origin.x + origin.width;
        next.x = Math.max(0, Math.min(right - minimumWidth, origin.x + dx));
        next.width = right - next.x;
      }
      if (adjustment.handle.includes("e")) {
        next.width = Math.max(
          minimumWidth,
          Math.min(1 - origin.x, origin.width + dx),
        );
      }
      if (adjustment.handle.includes("n")) {
        const bottom = origin.y + origin.height;
        next.y = Math.max(
          0,
          Math.min(bottom - minimumHeight, origin.y + dy),
        );
        next.height = bottom - next.y;
      }
      if (adjustment.handle.includes("s")) {
        next.height = Math.max(
          minimumHeight,
          Math.min(1 - origin.y, origin.height + dy),
        );
      }
      if (event.shiftKey && /^(nw|ne|se|sw)$/.test(adjustment.handle)) {
        const anchorX = adjustment.handle.includes("w")
          ? origin.x + origin.width
          : origin.x;
        const anchorY = adjustment.handle.includes("n")
          ? origin.y + origin.height
          : origin.y;
        const pointerX = Math.max(
          0,
          Math.min(1, (event.clientX - adjustment.startX) / adjustment.layerWidth +
            (adjustment.handle.includes("w") ? origin.x : origin.x + origin.width)),
        );
        const pointerY = Math.max(
          0,
          Math.min(1, (event.clientY - adjustment.startY) / adjustment.layerHeight +
            (adjustment.handle.includes("n") ? origin.y : origin.y + origin.height)),
        );
        const ratio =
          (origin.width * adjustment.layerWidth) /
          Math.max(1, origin.height * adjustment.layerHeight);
        const availableWidth = adjustment.handle.includes("w")
          ? anchorX * adjustment.layerWidth
          : (1 - anchorX) * adjustment.layerWidth;
        const availableHeight = adjustment.handle.includes("n")
          ? anchorY * adjustment.layerHeight
          : (1 - anchorY) * adjustment.layerHeight;
        let width = Math.abs(pointerX - anchorX) * adjustment.layerWidth;
        let height = Math.abs(pointerY - anchorY) * adjustment.layerHeight;
        if (width / Math.max(1, height) > ratio) height = width / ratio;
        else width = height * ratio;
        const scale = Math.min(
          1,
          availableWidth / Math.max(1, width),
          availableHeight / Math.max(1, height),
        );
        width = Math.max(8, width * scale);
        height = Math.max(8, height * scale);
        next.width = Math.min(availableWidth, width) / adjustment.layerWidth;
        next.height =
          Math.min(availableHeight, height) / adjustment.layerHeight;
        next.x = adjustment.handle.includes("w")
          ? anchorX - next.width
          : anchorX;
        next.y = adjustment.handle.includes("n")
          ? anchorY - next.height
          : anchorY;
      }
    }

    if (
      next.x === origin.x &&
      next.y === origin.y &&
      next.width === origin.width &&
      next.height === origin.height
    ) {
      return;
    }
    adjustment.changed = true;
    setRegions((current) =>
      current.map((item) =>
        item.id === adjustment.regionId
          ? {
              ...item,
              ...next,
              elements: [],
              marked: [],
              viewport: null,
              resultUrl: "",
              runId: "",
              conversationId: "",
            }
          : item,
      ),
    );
  };

  const finishRegionAdjustment = (event) => {
    const adjustment = regionAdjustRef.current;
    if (!adjustment || adjustment.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    regionAdjustRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (adjustment.changed) {
      setRegionError("");
      setRegionStatus("选区已调整，可重新分析元素或开始图片编辑");
    }
  };

  const beginManualElement = (event) => {
    if (!manualMode || event.button !== 0) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    manualStartRef.current = point;
    setManualDraft({ ...point, width: 0, height: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveManualElement = (event) => {
    const start = manualStartRef.current;
    if (!start) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    setManualDraft({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  };

  const finishManualElement = (event) => {
    const draft = manualDraft;
    if (!manualStartRef.current || !draft) return;
    event.stopPropagation();
    manualStartRef.current = null;
    setManualDraft(null);
    const rect = event.currentTarget.getBoundingClientRect();
    if (draft.width * rect.width < 8 || draft.height * rect.height < 8) return;
    const id = `manual-${crypto.randomUUID()}`;
    const count = regionElements.filter((item) => item.manual).length + 1;
    const node = {
      id,
      name: `手动框选 ${count}`,
      type: "image",
      manual: true,
      ...draft,
    };
    patchActiveRegion({
      elements: [
        ...regionElements.filter((item) => item.manual !== true),
        node,
      ],
      marked: [id],
    });
  };

  const captureRegion = useCallback(async (box = region) => {
    const image = artboardRef.current?.querySelector("img");
    if (!image?.naturalWidth || !box)
      throw new Error("设计稿还在加载，请稍后再框选");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * box.width));
    canvas.height = Math.max(
      1,
      Math.round(image.naturalHeight * box.height),
    );
    const context = canvas.getContext("2d");
    context.drawImage(
      image,
      Math.round(image.naturalWidth * box.x),
      Math.round(image.naturalHeight * box.y),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  }, [region]);

  const continueRegionProcess = useCallback(
    async (boxes, parentUrl) => {
      const parent = String(
        parentUrl || regionPersistRef.current.outputUrl || "",
      ).trim();
      const list = (boxes || []).filter((box) => box && !box.resultUrl);
      if (!list.length) {
        persistRegionProcess({ loading: false });
        if (mountedRef.current) setRegionBusy(false);
        return;
      }
      if (regionContinueLockRef.current) return;
      regionContinueLockRef.current = true;
      if (!parent) {
        persistRegionProcess({
          loading: false,
          error: "找不到原设计稿，无法继续框选任务",
        });
        if (mountedRef.current) {
          setRegionBusy(false);
          setRegionError("找不到原设计稿，无法继续框选任务");
        }
        regionContinueLockRef.current = false;
        return;
      }
      const prompt = String(
        regionPersistRef.current.prompt || regionPrompt || "",
      ).trim();
      const action = regionPersistRef.current.editAction || regionAction;
      const transparent = wantsRegionTransparentOutput(prompt, action);
      const preserveLayout =
        ["remove", "improve-icon"].includes(action) && !transparent;
      let sharedConversationId =
        list.find((item) => item.conversationId)?.conversationId ||
        regionPersistRef.current.conversationId ||
        "";
      let firstStyleReferenceUrl = "";
      persistRegionProcess({
        outputUrl: parent,
        selections: boxes,
        loading: true,
        error: "",
        stage: "正在继续框选优化…",
      });
      if (mountedRef.current) {
        setRegionBusy(true);
        setRegionMode(true);
        setRegionError("");
        setRegionStatus("正在继续框选优化…");
      }
      try {
        await waitForArtboardImage(artboardRef.current);
        for (const box of (regionPersistRef.current.selections || boxes).filter(
          (item) => item.resultUrl,
        )) {
          if (firstStyleReferenceUrl) break;
          firstStyleReferenceUrl =
            (await flattenPngAlphaOntoSolid(box.resultUrl).catch(() => "")) ||
            box.resultUrl;
        }
        for (let index = 0; index < list.length; index += 1) {
          const box = list[index];
          const editingStatus =
            list.length > 1
              ? `正在继续图片编辑（${index + 1}/${list.length}）…`
              : "正在继续图片编辑…";
          persistRegionProcess({
            outputUrl: parent,
            loading: true,
            stage: editingStatus,
          });
          if (mountedRef.current) setRegionStatus(editingStatus);
          const elements = (box.elements || []).filter((item) =>
            (box.marked || []).includes(item.id),
          );
          const instruction =
            buildRegionEditInstruction({
              elements,
              userNote: prompt,
              viewport: null,
              action,
              hasStyleReference: Boolean(firstStyleReferenceUrl),
              transparent,
            }) ||
            buildRegionEditInstruction({
              userNote: prompt || "处理当前框选区域",
              action: action === "remove" && !elements.length ? "custom" : action,
              hasStyleReference: Boolean(firstStyleReferenceUrl),
              transparent,
            });
          const applyResult = (result) => {
            const resultUrl = result.dataUrl;
            const nextSelections = (
              regionPersistRef.current.selections || boxes
            ).map((item) =>
              item.id === box.id || item.runId === box.runId
                ? {
                    ...item,
                    resultUrl,
                    runId: result.runId || item.runId,
                    conversationId:
                      result.conversationId || item.conversationId,
                  }
                : item,
            );
            persistRegionProcess({
              outputUrl: parent,
              selections: nextSelections,
              resultUrl,
              conversationId: result.conversationId || sharedConversationId,
              runId: result.runId,
              loading: index < list.length - 1,
              error: "",
              stage: editingStatus,
            });
            if (mountedRef.current) {
              setRegions(nextSelections);
              setRegionPreviewUrl(resultUrl);
              setEntries((current) => {
                if (current.some((item) => item.url === resultUrl)) {
                  return current;
                }
                return [
                  regionResultEntry({
                    url: resultUrl,
                    parent,
                    runId: result.runId,
                    deviceId: viewDeviceId,
                  }),
                  ...current,
                ];
              });
            }
            return resultUrl;
          };
          const rememberRun = (runId) => {
            if (runId) regionResumeIdsRef.current.add(runId);
            const current = regionPersistRef.current.selections || boxes;
            const next = current.map((item) =>
              item.id === box.id
                ? {
                    ...item,
                    runId,
                    conversationId:
                      sharedConversationId || item.conversationId,
                  }
                : item,
            );
            persistRegionProcess({
              outputUrl: parent,
              selections: next,
              conversationId: sharedConversationId,
              runId,
              loading: true,
              stage: editingStatus,
            });
            if (mountedRef.current) setRegions(next);
          };
          let result = null;
          const runId = String(box.runId || "").trim();
          if (runId && !regionResumeIdsRef.current.has(`dead:${runId}`)) {
            try {
              result = await generateDesignRegionImage({
                referenceImage: parent,
                regionReferenceDataUrl: parent,
                region: {
                  name: "框选优化区域",
                  type: "frame",
                  description: "",
                  width: 1,
                  height: 1,
                },
                conversationId: box.conversationId || sharedConversationId,
                runId,
                retainConversation: true,
                parentOutputUrl: parent,
                onConversation: (id) => {
                  sharedConversationId = id || sharedConversationId;
                },
                onRun: rememberRun,
                onStage: () => {
                  if (mountedRef.current) setRegionStatus(editingStatus);
                },
              });
            } catch (error) {
              if (!isDeadAssistantRun(error)) throw error;
              regionResumeIdsRef.current.add(`dead:${runId}`);
            }
          }
          if (!result) {
            const captured = await captureRegion(box);
            const blob = await (await fetch(captured.dataUrl)).blob();
            const regionReferenceDataUrl = await uploadAiTempBlob(blob);
            const designReference = resolveRegionDesignReference({
              index,
              firstResultUrl: firstStyleReferenceUrl,
              draftUrl: parent,
              preserveLayout,
              hasStyleReferences: Boolean(firstStyleReferenceUrl),
            });
            result = await generateDesignRegionImage({
              referenceImage: parent,
              regionReferenceDataUrl,
              designReferenceImage: designReference?.url || "",
              designReferenceName: designReference?.name || "",
              region: {
                name:
                  list.length > 1
                    ? `框选优化区域 ${index + 1}`
                    : "框选优化区域",
                type: "frame",
                description: (instruction || "处理当前框选区域").slice(0, 240),
                width: captured.width,
                height: captured.height,
              },
              transparent,
              generationMode: "strict",
              userInstruction:
                instruction || prompt || "处理当前框选区域",
              preserveLayout,
              retainConversation: true,
              conversationId: sharedConversationId,
              parentOutputUrl: parent,
              onConversation: (id) => {
                sharedConversationId = id || sharedConversationId;
              },
              onRun: rememberRun,
              onStage: () => {
                if (mountedRef.current) setRegionStatus(editingStatus);
              },
            });
          }
          if (!sharedConversationId && result.conversationId) {
            sharedConversationId = result.conversationId;
          }
          const resultUrl = applyResult(result);
          if (!firstStyleReferenceUrl) {
            firstStyleReferenceUrl =
              (await flattenPngAlphaOntoSolid(resultUrl).catch(() => "")) ||
              resultUrl;
          }
        }
        persistRegionProcess({ loading: false, error: "" });
        if (mountedRef.current) {
          setRegionStatus("编辑完成，可查看大图确认效果");
        }
      } catch (error) {
        persistRegionProcess({
          loading: false,
          error: error?.message || "继续框选任务失败",
        });
        if (error?.name !== "AbortError" && mountedRef.current) {
          setRegionError(error?.message || "继续框选任务失败");
        }
      } finally {
        regionContinueLockRef.current = false;
        if (mountedRef.current) setRegionBusy(false);
      }
    },
    [
      captureRegion,
      persistRegionProcess,
      regionAction,
      regionPrompt,
      viewDeviceId,
    ],
  );
  continueRegionProcessRef.current = continueRegionProcess;

  const analyzeRegion = useCallback(async () => {
    if (!regionRecognition.length || regionBusy) return;
    setRegionBusy(true);
    setRegionError("");
    setRegionStatus("正在分析元素…");
    try {
      const captured = await captureRegion();
      const document = await analyzeDesignCropElements({
        cropImage: captured.dataUrl,
        width: captured.width,
        height: captured.height,
        recognitionTypes: regionRecognition,
        model: analysisModelId,
        onStage: (value) =>
          setRegionStatus(
            value === "analyzing" ? "正在分析元素…" : "正在准备分析…",
          ),
      });
      patchActiveRegion({
        viewport:
          document.viewport || { width: captured.width, height: captured.height },
        elements: document.nodes || [],
        marked: [],
      });
      setRegionStatus(
        `已定位 ${document.nodes?.length || 0} 个元素，请点选要编辑的`,
      );
    } catch (error) {
      setRegionError(error?.message || "元素分析失败");
    } finally {
      setRegionBusy(false);
    }
  }, [
    analysisModelId,
    captureRegion,
    patchActiveRegion,
    regionBusy,
    regionRecognition,
  ]);

  const processRegion = useCallback(async () => {
    if (!regions.length || regionBusy) return;
    const hasStyleReference = regionReferences.length > 0;
    const hasInstruction = regions.some((box) => {
      const elements = (box.elements || []).filter((item) =>
        (box.marked || []).includes(item.id),
      );
      return Boolean(
        buildRegionEditInstruction({
          elements,
          userNote: regionPrompt.trim(),
          viewport: null,
          action: regionAction,
          hasStyleReference,
        }),
      );
    });
    if (!hasInstruction) {
      setRegionError("请先点选要编辑的元素，或填写具体编辑要求");
      return;
    }
    const preparingStatus =
      regions.length > 1
        ? `正在准备图片编辑（1/${regions.length}）`
        : "正在准备图片编辑";
    setRegionBusy(true);
    setRegionError("");
    setRegionStatus(preparingStatus);
    persistRegionProcess({
      outputUrl: activeOutput,
      selections: regions,
      prompt: regionPrompt,
      recognitionTypes: regionRecognition,
      editAction: regionAction,
      loading: true,
      error: "",
      stage: preparingStatus,
    });
    try {
      const uploadedRefs = [];
      for (const item of regionReferences) {
        uploadedRefs.push({
          url: await uploadAiInputFile(item.file),
          name: item.name || "用户参考图",
        });
      }
      const transparent = regionWantsTransparent;
      const preserveLayout =
        ["remove", "improve-icon"].includes(regionAction) && !transparent;
      let firstStyleReferenceUrl = "";
      let sharedConversationId =
        regions.find((item) => item.conversationId)?.conversationId || "";
      for (let index = 0; index < regions.length; index += 1) {
        const box = regions[index];
        const elements = (box.elements || []).filter((item) =>
          (box.marked || []).includes(item.id),
        );
        const instruction =
          buildRegionEditInstruction({
            elements,
            userNote: regionPrompt.trim(),
            viewport: null,
            action: regionAction,
            hasStyleReference: uploadedRefs.length > 0,
            transparent: regionWantsTransparent,
          }) ||
          buildRegionEditInstruction({
            userNote: regionPrompt.trim() || "处理当前框选区域",
            action:
              regionAction === "remove" && !elements.length
                ? "custom"
                : regionAction,
            hasStyleReference: uploadedRefs.length > 0,
            transparent: regionWantsTransparent,
          });
        if (!instruction) continue;
        const editingStatus =
          regions.length > 1
            ? `正在图片编辑（${index + 1}/${regions.length}）…`
            : "正在图片编辑…";
        persistRegionProcess({
          outputUrl: activeOutput,
          loading: true,
          stage: editingStatus,
        });
        if (mountedRef.current) setRegionStatus(editingStatus);
        const captured = await captureRegion(box);
        const blob = await (await fetch(captured.dataUrl)).blob();
        const regionReferenceDataUrl = await uploadAiTempBlob(blob);
        const designReference = resolveRegionDesignReference({
          index,
          firstResultUrl: firstStyleReferenceUrl,
          draftUrl: activeOutput,
          preserveLayout,
          hasStyleReferences: uploadedRefs.length > 0,
        });
        const result = await generateDesignRegionImage({
          referenceImage: activeOutput,
          regionReferenceDataUrl,
          designReferenceImage: designReference?.url || "",
          designReferenceName: designReference?.name || "",
          styleReferences: uploadedRefs,
          region: {
            name:
              regions.length > 1
                ? `框选优化区域 ${index + 1}`
                : "框选优化区域",
            type: "frame",
            description: instruction.slice(0, 240),
            width: captured.width,
            height: captured.height,
          },
          transparent,
          generationMode: uploadedRefs.length ? "replace" : "strict",
          userInstruction: instruction,
          preserveLayout,
          retainConversation: true,
          conversationId: sharedConversationId,
          parentOutputUrl: activeOutput,
          onConversation: (id) => {
            sharedConversationId = id || sharedConversationId;
          },
          onRun: (runId) => {
            const current =
              regionPersistRef.current.selections || regions;
            const next = current.map((item) =>
              item.id === box.id
                ? {
                    ...item,
                    runId,
                    conversationId:
                      sharedConversationId || item.conversationId,
                  }
                : item,
            );
            persistRegionProcess({
              outputUrl: activeOutput,
              selections: next,
              conversationId: sharedConversationId,
              runId,
              loading: true,
              stage: editingStatus,
            });
            if (mountedRef.current) setRegions(next);
          },
          onStage: () => {
            persistRegionProcess({
              outputUrl: activeOutput,
              loading: true,
              stage: editingStatus,
            });
            if (mountedRef.current) setRegionStatus(editingStatus);
          },
        });
        if (!sharedConversationId && result.conversationId) {
          sharedConversationId = result.conversationId;
        }
        if (!firstStyleReferenceUrl) {
          firstStyleReferenceUrl =
            (await flattenPngAlphaOntoSolid(result.dataUrl).catch(() => "")) ||
            result.dataUrl;
        }
        const nextSelections = (
          regionPersistRef.current.selections || regions
        ).map((item) =>
          item.id === box.id
            ? {
                ...item,
                resultUrl: result.dataUrl,
                runId: result.runId || item.runId,
                conversationId:
                  result.conversationId || item.conversationId,
              }
            : item,
        );
        persistRegionProcess({
          outputUrl: activeOutput,
          selections: nextSelections,
          resultUrl: result.dataUrl,
          conversationId: sharedConversationId,
          runId: result.runId,
          loading: index < regions.length - 1,
        });
        if (!mountedRef.current) continue;
        setRegions(nextSelections);
        setRegionPreviewUrl(result.dataUrl);
        setEntries((current) => {
          if (current.some((item) => item.url === result.dataUrl)) return current;
          return [
            regionResultEntry({
              url: result.dataUrl,
              parent: activeOutput,
              runId: result.runId,
              deviceId: viewDeviceId,
            }),
            ...current,
          ];
        });
      }
      const doneStatus =
        regions.length > 1
          ? uploadedRefs.length
            ? `已出 ${regions.length} 张，已按参考图统一风格、各框保持各自内容`
            : `已出 ${regions.length} 张，后续已按第一张出图对齐风格`
          : "编辑完成，可查看大图确认效果";
      persistRegionProcess({
        outputUrl: activeOutput,
        loading: false,
        error: "",
        stage: doneStatus,
      });
      if (mountedRef.current) setRegionStatus(doneStatus);
    } catch (error) {
      persistRegionProcess({
        outputUrl: activeOutput,
        loading: false,
        error: error?.message || "框选优化失败",
      });
      if (mountedRef.current) setRegionError(error?.message || "框选优化失败");
    } finally {
      if (mountedRef.current) setRegionBusy(false);
    }
  }, [
    activeOutput,
    captureRegion,
    persistRegionProcess,
    regionAction,
    regionBusy,
    regionPrompt,
    regionRecognition,
    regionReferences,
    regionWantsTransparent,
    regions,
    viewDeviceId,
  ]);

  const runFullAnalysis = useCallback(async () => {
    if (!activeOutput || analysisBusy || !analysisTypes.length) return;
    analysisControllerRef.current?.abort();
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    setAnalysisBusy(true);
    setAnalysisError("");
    try {
      const width =
        analysisImageDimensions?.width || activeImageDimensions?.width || device.viewport?.width || 1440;
      const height =
        analysisImageDimensions?.height || activeImageDimensions?.height || device.viewport?.height || 810;
      const document = await analyzeDesignCropElements({
        cropImage: activeOutput,
        width,
        height,
        recognitionTypes: analysisTypes,
        model: analysisModelId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAnalysisElements(document.nodes || []);
      setAnalysisSelectedId(document.nodes?.[0]?.id || "");
    } catch (error) {
      if (error?.name !== "AbortError") {
        setAnalysisError(error?.message || "元素分析失败");
      }
    } finally {
      if (analysisControllerRef.current === controller) {
        analysisControllerRef.current = null;
        setAnalysisBusy(false);
      }
    }
  }, [
    activeImageDimensions,
    analysisImageDimensions,
    activeOutput,
    analysisBusy,
    analysisModelId,
    analysisTypes,
    device.viewport,
  ]);

  const loadAnalysisImage = useCallback(async () => {
    const blob = await fetchAuthenticatedMediaBlob(
      activeOutput,
      { fallbackUrl: outputMaps.displays[activeOutput] || "" },
    );
    return decodeImageBlob(blob);
  }, [activeOutput, outputMaps.displays]);

  const cropAnalysisNodes = useCallback(
    async (nodes) => {
      const image = await loadAnalysisImage();
      const sourceSize = analysisImageDimensions || activeImageDimensions || {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      for (const node of nodes) {
        const canvas = cropElementFromImage(image, node, sourceSize);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("切片导出失败")),
            "image/png",
          );
        });
        downloadBlobFile(
          blob,
          `${slugFileName(node.name || node.type || node.id)}.png`,
        );
      }
    },
    [activeImageDimensions, analysisImageDimensions, loadAnalysisImage],
  );

  const exportAnalysisNodes = useCallback(
    async (nodes) => {
      if (!activeOutput || !nodes.length || analysisExporting) return;
      setAnalysisExporting(true);
      setAnalysisError("");
      try {
        await cropAnalysisNodes(nodes);
        notificationService.success(
          nodes.length > 1 ? `已导出 ${nodes.length} 个 PNG` : "已导出 PNG",
        );
      } catch (error) {
        setAnalysisError(error?.message || "导出 PNG 失败");
      } finally {
        setAnalysisExporting(false);
      }
    },
    [activeOutput, analysisExporting, cropAnalysisNodes],
  );

  const exportCodexPack = useCallback(async () => {
    if (!activeOutput || analysisExporting) return;
    setAnalysisExporting(true);
    setAnalysisError("");
    try {
      const sourceBlob = await fetchAuthenticatedMediaBlob(activeOutput, {
        fallbackUrl: outputMaps.displays[activeOutput] || "",
      });
      const sourceImage = await decodeImageBlob(sourceBlob);
      const sourceSize = {
        width: sourceImage.naturalWidth,
        height: sourceImage.naturalHeight,
      };
      const coordinateBasis =
        analysisImageDimensions || activeImageDimensions || sourceSize;
      const sourceElements = remapElementsToSource(
        analysisElements,
        coordinateBasis,
        sourceSize,
      );
      const system = resolveDesignSystem(device, {
        ...spec,
        brandColor,
        colorScheme,
      });
      const handoff = buildCodexHandoff({
        brief,
        pageType,
        visualStyle,
        system,
        prompt: buildPrompt(device),
        imageUrl: "design.png",
        elements: sourceElements,
        sourceSize,
      });
      const [{ strToU8, zipSync }, artboardPng] = await Promise.all([
        import("fflate"),
        sourceBlob.type.startsWith("image/png")
          ? Promise.resolve(sourceBlob)
          : renderImageAsPng(sourceImage),
      ]);
      const files = {
        "design.png": new Uint8Array(await artboardPng.arrayBuffer()),
        "design-system.json": strToU8(JSON.stringify(handoff, null, 2)),
        "tokens.css": strToU8(buildDesignTokensCss(system)),
        "README.md": strToU8(buildDesignHandoffMarkdown(handoff)),
      };
      for (const node of handoff.elements) {
        const canvas = cropElementFromImage(sourceImage, node, sourceSize);
        const blob = await canvasToPngBlob(canvas);
        files[node.file] = new Uint8Array(await blob.arrayBuffer());
      }
      const archive = zipSync(files, { level: 6 });
      downloadBlobFile(
        new Blob([archive], { type: "application/zip" }),
        `${slugFileName(brief || pageType?.label || "ui-design")}-handoff.zip`,
      );
      notificationService.success(
        handoff.elements.length
          ? `交付包已生成，包含 ${handoff.elements.length} 个元素 PNG`
          : "交付包已生成",
      );
    } catch (error) {
      setAnalysisError(error?.message || "导出规范包失败");
    } finally {
      setAnalysisExporting(false);
    }
  }, [
    activeOutput,
    activeImageDimensions,
    analysisElements,
    analysisExporting,
    analysisImageDimensions,
    brandColor,
    brief,
    buildPrompt,
    colorScheme,
    device,
    outputMaps.displays,
    pageType,
    spec,
    visualStyle,
  ]);

  const approveRegionResult = useCallback(async () => {
    if (!regionResultUrls.length || regionApproving) return;
    setRegionApproving(true);
    setRegionError("");
    try {
      const baseTitle = (regionPrompt.trim() || "框选优化素材").slice(0, 100);
      for (const [index, url] of regionResultUrls.entries()) {
        const blob = await fetchAuthenticatedMediaBlob(url);
        const file = new File([blob], `ui-region-${Date.now()}-${index + 1}.png`, {
          type: blob.type || "image/png",
        });
        const uploaded = await uploadFile(file);
        await createUserAsset({
          title:
            regionResultUrls.length > 1
              ? `${baseTitle} ${index + 1}`
              : baseTitle,
          fileKey: uploaded.key,
          thumbnailKey: uploaded.thumbnailKey,
          contentType: uploaded.contentType || file.type,
        });
      }
      notificationService.success(
        regionResultUrls.length > 1
          ? `已加入素材库 ${regionResultUrls.length} 张`
          : "已加入素材库",
      );
      clearRegionSession();
      setRegionDialogOpen(false);
    } catch (error) {
      setRegionError(error?.message || "加入素材库失败");
    } finally {
      setRegionApproving(false);
    }
  }, [clearRegionSession, regionApproving, regionPrompt, regionResultUrls]);

  const artboardRatio = [
    activeSystem.viewport.width,
    activeSystem.viewport.height,
  ];
  const artboardStyle = {
    aspectRatio: `${artboardRatio[0]} / ${artboardRatio[1]}`,
    width: `min(100%, calc((100dvh - var(--app-header-offset, 64px) - 128px) * ${artboardRatio[0] / artboardRatio[1]}))`,
  };
  const regionSelectionLayer = activeImageDimensions ? (
    <div
      className={`dws-region-layer${regionMode && !regionBusy ? " is-drawing" : " has-selection"}`}
      onPointerDown={beginRegion}
      onPointerMove={(event) => {
        if (regionAdjustRef.current) moveRegionAdjustment(event);
        else moveRegion(event);
      }}
      onPointerUp={(event) => {
        if (regionAdjustRef.current) finishRegionAdjustment(event);
        else finishRegion(event);
      }}
      onPointerCancel={(event) => {
        if (regionAdjustRef.current) finishRegionAdjustment(event);
        else {
          regionStartRef.current = null;
          setRegionDraft(null);
        }
      }}
    >
      {regionMode && regions.length === 0 && !regionDraft && (
        <span
          className={`dws-region-hint${regionError ? " is-error" : ""}`}
        >
          <i className="bi bi-bounding-box-circles" />
          {regionError || "按住鼠标拖拽框选要优化的区域"}
        </span>
      )}
      {regions.map((box, index) => {
        const active = box.id === region?.id;
        return (
          <div
            key={box.id}
            className={`dws-region-box${active ? " is-adjustable is-active" : ""}${manualMode && active ? " is-manual" : ""}`}
            data-index={index + 1}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              setActiveRegionId(box.id);
              if (manualMode && active) beginManualElement(event);
              else if (!manualMode) beginRegionAdjustment(event, box);
            }}
            onPointerMove={
              manualMode && active ? moveManualElement : undefined
            }
            onPointerUp={
              manualMode && active ? finishManualElement : undefined
            }
            onPointerCancel={
              manualMode && active
                ? () => {
                    manualStartRef.current = null;
                    setManualDraft(null);
                  }
                : undefined
            }
          >
            {active &&
              visibleRegionElements.map((node, hitIndex) => (
                <button
                  key={node.id}
                  type="button"
                  className={`dws-region-hit${regionMarked.includes(node.id) ? " is-marked" : ""}`}
                  data-index={hitIndex + 1}
                  style={{
                    left: `${node.manual ? node.x * 100 : (node.x / (regionViewport?.width || 1)) * 100}%`,
                    top: `${node.manual ? node.y * 100 : (node.y / (regionViewport?.height || 1)) * 100}%`,
                    width: `${node.manual ? node.width * 100 : (node.width / (regionViewport?.width || 1)) * 100}%`,
                    height: `${node.manual ? node.height * 100 : (node.height / (regionViewport?.height || 1)) * 100}%`,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    const marked = regionMarked.includes(node.id)
                      ? regionMarked.filter((id) => id !== node.id)
                      : [...regionMarked, node.id];
                    patchActiveRegion({ marked });
                  }}
                >
                  {(node.text || node.name) && (
                    <span>{node.text || node.name}</span>
                  )}
                </button>
              ))}
            {active && manualDraft && (
              <span
                className="dws-region-manual-draft"
                style={{
                  left: `${manualDraft.x * 100}%`,
                  top: `${manualDraft.y * 100}%`,
                  width: `${manualDraft.width * 100}%`,
                  height: `${manualDraft.height * 100}%`,
                }}
              />
            )}
            {active &&
              !manualMode &&
              REGION_HANDLES.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className="dws-region-handle"
                  data-handle={handle}
                  aria-label={`调整选区 ${handle}`}
                />
              ))}
          </div>
        );
      })}
      {regionDraft && (
        <div
          className="dws-region-box is-draft"
          style={{
            left: `${regionDraft.x * 100}%`,
            top: `${regionDraft.y * 100}%`,
            width: `${regionDraft.width * 100}%`,
            height: `${regionDraft.height * 100}%`,
          }}
        />
      )}
    </div>
  ) : null;

  return (
    <main
      ref={rootRef}
      className={`dws is-tablet-${workspaceView}${!entries.length && !running ? " is-blank" : ""}${isDark ? "" : " is-light"}`}
      style={{ "--dws-brand": brandColor }}
    >
      <div className="dws-shell">
        <nav className="dws-tablet-tabs" role="tablist" aria-label="UI 设计工作区">
          <button type="button" role="tab" aria-selected={workspaceView === "controls"} className={workspaceView === "controls" ? "is-on" : ""} onClick={() => setWorkspaceView("controls")}>
            <i className="bi bi-sliders" />需求与规范
          </button>
          <button type="button" role="tab" aria-selected={workspaceView === "canvas"} className={workspaceView === "canvas" ? "is-on" : ""} onClick={() => setWorkspaceView("canvas")}>
            <i className="bi bi-easel2" />画布{running ? <em>运行中</em> : activeOutput ? <em>1</em> : null}
          </button>
        </nav>
        <aside className="dws-panel">
          <div className="dws-panel-scroll">
            <section className="dws-engine">
              <span className="dws-engine-icon">
                <SoftMark name="cpu" size="md" />
              </span>
              <div className="dws-engine-control">
                <WorkshopSelect
                  value={modelId}
                  options={models.map((item) => ({
                    value: item.id,
                    label: item.label,
                    icon: "bi-cpu",
                  }))}
                  onChange={setModelId}
                  label="生成模型"
                  className="dws-model-menu"
                />
              </div>
            </section>
            <section className="dws-block dws-composer-block">
              <div
                className={`dws-composer${hasReference ? " has-reference" : ""}${isIteration ? " is-iteration" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(event.dataTransfer.files);
                }}
              >
                <textarea
                  id="dws-brief"
                  value={isIteration ? iterationBrief : brief}
                  rows={5}
                  maxLength={1000}
                  aria-label={isIteration ? "本次迭代要求" : "产品与页面描述"}
                  placeholder={
                    isIteration
                      ? "只写需要改的地方，例如：主按钮改成蓝色，其余保持不变"
                      : "这是一个什么产品？页面上要有什么内容？"
                  }
                  onChange={(event) =>
                    isIteration
                      ? setIterationBrief(event.target.value)
                      : setBrief(event.target.value)
                  }
                  onPaste={(event) => {
                    const files = [...(event.clipboardData?.files || [])];
                    if (files.length) {
                      event.preventDefault();
                      addFiles(files);
                    }
                  }}
                />
                {hasReference && (
                  <div className="dws-composer-media" aria-label="参考内容">
                    {isIteration ? (
                      <div className="dws-composer-iteration">
                        <AuthenticatedImage
                          src={iterationSource}
                          alt="迭代基准版本"
                          maxDimension={240}
                        />
                        <div>
                          <strong>
                            基于 {activeVersionLabel || "当前版本"} 迭代
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="dws-composer-refs">
                        {references.map((item, index) => (
                          <article key={item.id}>
                            <img
                              src={item.preview}
                              alt={item.name || `参考图 ${index + 1}`}
                            />
                            <button
                              type="button"
                              aria-label={`移除参考图 ${index + 1}`}
                              onClick={() =>
                                setReferences((current) => {
                                  if (item.preview) {
                                    URL.revokeObjectURL(item.preview);
                                    previewUrlsRef.current.delete(item.preview);
                                  }
                                  return current.filter(
                                    (entry) => entry.id !== item.id,
                                  );
                                })
                              }
                            >
                              <i className="bi bi-x" />
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <footer className="dws-composer-bar">
                  <button
                    type="button"
                    className="dws-composer-add"
                    disabled={
                      isIteration || references.length >= referenceLimit
                    }
                    aria-label={`添加参考图，还可添加 ${Math.max(0, referenceLimit - references.length)} 张`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <i className="bi bi-plus-lg" />
                  </button>
                  <button
                    type="button"
                    className="dws-composer-clear"
                    disabled={!brief.trim() && !hasReference}
                    aria-label="清空内容"
                    onClick={() => {
                      setBrief("");
                      setIterationBrief("");
                      setIterationSource("");
                      setReferences([]);
                    }}
                  >
                    <i className="bi bi-trash3" />
                  </button>
                </footer>
              </div>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <input
                ref={designFileInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="上传设计稿"
                onChange={(event) => {
                  void uploadDesign(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </section>
            {isIteration ? (
              <section className="dws-block dws-iteration-bar">
                <button
                  type="button"
                  className="dws-iteration-exit"
                  onClick={() => {
                    setIterationSource("");
                    setIterationBrief("");
                  }}
                >
                  退出迭代
                </button>
              </section>
            ) : (
              <>
                <section className="dws-block">
                  <button
                    type="button"
                    className={`dws-settings-summary${settingsOpen ? " is-open" : ""}`}
                    aria-expanded={settingsOpen}
                    onClick={() => setSettingsOpen((current) => !current)}
                  >
                    <span>
                      <strong>设计系统</strong>
                      <small>
                        {selectedDeviceLabel}
                        {activeSystem.profile
                          ? ` · ${activeSystem.profile.label}`
                          : ""}{" "}
                        · {pageType.label} · {visualStyle.label}
                      </small>
                    </span>
                    <i
                      className={`bi ${settingsOpen ? "bi-chevron-up" : "bi-chevron-down"}`}
                    />
                  </button>
                </section>
                {settingsOpen ? (
                <section className="dws-block">
                  <span className="dws-label">设备</span>
                  <div
                    className="dws-devices"
                    role="group"
                    aria-label="设备载体"
                  >
                    {DESIGN_DEVICE_OPTIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={
                          selectedDeviceIds.includes(item.id) ? "is-on" : ""
                        }
                        aria-pressed={selectedDeviceIds.includes(item.id)}
                        title={`${item.label} ${item.ratio}`}
                        aria-label={`${item.label} ${item.ratio}`}
                        onClick={() =>
                          setSelectedDeviceIds((current) =>
                            current.includes(item.id)
                              ? current.length > 1
                                ? current.filter((id) => id !== item.id)
                                : current
                              : [...current, item.id],
                          )
                        }
                      >
                        <i className={`bi ${item.icon}`} />
                        <em>{item.label}</em>
                        <small>{item.ratio}</small>
                      </button>
                    ))}
                  </div>
                </section>
                ) : null}
                {settingsOpen && selectedDeviceIds.includes("phone") ? (
                <section className="dws-block">
                  <div className="dws-select-field">
                    <span className="dws-label">手机系统</span>
                    <div className="dws-scheme" role="group" aria-label="手机系统">
                      {MOBILE_SYSTEMS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={spec.mobileSystem === item.id ? "is-on" : ""}
                          onClick={() => patchSpec("mobileSystem", item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="dws-select-field">
                    <span className="dws-label">机型规范</span>
                    <WorkshopSelect
                      value={spec.phoneProfile}
                      options={getPhoneProfiles(spec.mobileSystem).map((item) => ({
                        value: item.id,
                        label: `${item.label} · ${item.width}×${item.height}`,
                        icon: "bi-phone",
                      }))}
                      onChange={(value) => patchSpec("phoneProfile", value)}
                      label="机型规范"
                      className="dws-control-select"
                      icon="bi-phone"
                    />
                  </div>
                </section>
                ) : null}
                {settingsOpen ? (
                <section className="dws-block dws-quick-settings">
                  <div className="dws-select-field">
                    <span className="dws-label">页面类型</span>
                    <button
                      ref={pageTypeTriggerRef}
                      type="button"
                      className="dws-page-type-trigger"
                      aria-label="页面类型"
                      onClick={() =>
                        pageTypePicker
                          ? setPageTypePicker(null)
                          : openPageTypes()
                      }
                    >
                      <i className={`bi ${pageType.icon}`} />
                      <span>{pageType.label}</span>
                      <i className="bi bi-chevron-right" />
                    </button>
                  </div>
                  <div className="dws-select-field">
                    <span className="dws-label">视觉风格</span>
                    <button
                      ref={styleTriggerRef}
                      type="button"
                      className="dws-page-type-trigger"
                      aria-label="视觉风格"
                      onClick={() =>
                        configPicker?.type === "style"
                          ? setConfigPicker(null)
                          : openPicker("style", styleTriggerRef)
                      }
                    >
                      <i className={`bi ${visualStyle.icon}`} />
                      <span>{visualStyle.label}</span>
                      <i className="bi bi-chevron-right" />
                    </button>
                  </div>
                  {pageTypeId === "custom" && (
                    <input
                      className="dws-custom-structure"
                      value={customPageType}
                      maxLength={120}
                      placeholder="描述页面结构"
                      onChange={(event) =>
                        setCustomPageType(event.target.value)
                      }
                    />
                  )}
                </section>
                ) : null}
                {settingsOpen ? (
                <section className="dws-block dws-color-row">
                  <div className="dws-color-brand dws-select-field">
                    <span className="dws-label">品牌主色</span>
                    <button
                      ref={brandTriggerRef}
                      type="button"
                      className="dws-page-type-trigger dws-brand-trigger"
                      aria-label="品牌主色"
                      onClick={() =>
                        configPicker?.type === "brand"
                          ? setConfigPicker(null)
                          : openPicker("brand", brandTriggerRef)
                      }
                    >
                      <i
                        className="dws-brand-dot"
                        style={{ background: brandColor }}
                      />
                      <span>
                        {
                          BRAND_COLORS.find((item) => item.value === brandColor)
                            ?.label
                        }
                      </span>
                      <i className="bi bi-chevron-right" />
                    </button>
                  </div>
                  <div className="dws-color-scheme">
                    <span className="dws-label">明暗模式</span>
                    <div
                      className="dws-scheme"
                      role="group"
                      aria-label="明暗模式"
                    >
                      <button
                        type="button"
                        className={colorScheme === "light" ? "is-on" : ""}
                        onClick={() => setColorScheme("light")}
                      >
                        <i className="bi bi-sun" />
                        浅色
                      </button>
                      <button
                        type="button"
                        className={colorScheme === "dark" ? "is-on" : ""}
                        onClick={() => setColorScheme("dark")}
                      >
                        <i className="bi bi-moon-stars" />
                        深色
                      </button>
                    </div>
                  </div>
                </section>
                ) : null}
                {settingsOpen ? (
                <section className="dws-block dws-specification">
                  <button
                    ref={specTriggerRef}
                    type="button"
                    className="dws-specification-toggle"
                    aria-label="设计规范"
                    onClick={() =>
                      configPicker?.type === "specification"
                        ? setConfigPicker(null)
                        : openPicker("specification", specTriggerRef)
                    }
                  >
                    <span>
                      <i className="bi bi-sliders" />
                      <strong>设计规范</strong>
                      <small>
                        {activeSystem.platformLabel} · {densityLabel} ·{" "}
                        {radiusLabel} · 点击 {activeSystem.tokens.control.touch}px
                      </small>
                    </span>
                    <i className="bi bi-chevron-right" />
                  </button>
                </section>
                ) : null}
              </>
            )}
            {localError && (
              <p className="dws-error" role="alert">
                <i className="bi bi-exclamation-circle" />
                <span>{localError}</span>
                {failedDeviceIds.length > 0 && !running && (
                  <button type="button" className="dws-retry" onClick={() => generate(failedDeviceIds)}>
                    <i className="bi bi-arrow-clockwise" />重试失败设备
                  </button>
                )}
              </p>
            )}
          </div>
          <div className="dws-generate-dock">
            <button
              className="dws-generate"
              type="button"
              disabled={running}
              aria-label={`${isIteration ? "生成迭代稿" : references.length ? "参考图重绘" : "生成设计稿"}，${costLabel}`}
              onClick={() => generate()}
            >
              <span className="dws-generate-icon">
                <i
                  className={`bi ${running ? "bi-arrow-repeat spin" : "bi-stars"}`}
                />
              </span>
              <span className="dws-generate-copy">
                <strong>
                  {running
                    ? status || "生成中…"
                    : isIteration
                      ? "生成迭代稿"
                      : references.length
                        ? "参考图重绘"
                        : "生成设计稿"}
                </strong>
              </span>
              <span className="dws-generate-price">
                <strong>{costLabel}</strong>
              </span>
            </button>
          </div>
        </aside>
        <section className="dws-stage">
          <div className="dws-stage-ambient" />
          {activeOutput ? (
          <div className="dws-stage-actions">
                <button
                  type="button"
                  className={`is-region${regionBusy || hasRegionSelection ? " is-on" : ""}`}
                  disabled={running}
                  onClick={() => {
                    if (!hasRegionSelection) setRegionMode(true);
                    setManualMode(false);
                    setRegionDialogOpen(true);
                  }}
                >
                  <i className="bi bi-bounding-box-circles" />
                  <span>{regionBusy ? `处理中 ${regionPendingCount}` : "框选优化"}</span>
                </button>
                <button
                  type="button"
                  aria-label="迭代此版本"
                  disabled={running || activeNode?.canIterate === false}
                  onClick={() => {
                    setIterationSource(activeOutput);
                    setIterationBrief("");
                    setReferences([]);
                  }}
                >
                  <i className="bi bi-arrow-repeat" />
                  <span>迭代</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadAuthenticatedMedia(
                    activeOutput,
                    `ui-design-${Date.now()}.png`,
                  ).catch((error) => setMediaError(error?.message || "设计稿下载失败"))}
                >
                  <DownloadIcon />
                  <span>下载</span>
                </button>
                <button
                  type="button"
                  className="is-editor is-secondary"
                  disabled={running}
                  onClick={() => setAnalysisOpen(true)}
                >
                  <PackageCheck size={15} aria-hidden="true" />
                  <span>交付</span>
                </button>
                <button
                  type="button"
                  className="is-secondary"
                  disabled={running || uploadingDesign}
                  onClick={openDesignPicker}
                >
                  <i
                    className={`bi ${uploadingDesign ? "bi-arrow-repeat spin" : "bi-upload"}`}
                  />
                  <span>{uploadingDesign ? "上传中" : "上传"}</span>
                </button>
          </div>
          ) : null}
          <div
            className="dws-canvas"
            onDragOver={(event) => {
              if (activeOutput || running) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (activeOutput || running) return;
              event.preventDefault();
              void uploadDesign(event.dataTransfer.files?.[0]);
            }}
          >
            <div
              ref={artboardRef}
              className={`dws-artboard${activeOutput && !running ? " is-previewable" : ""}`}
              style={artboardStyle}
              role={activeOutput && !running ? "button" : undefined}
              tabIndex={activeOutput && !running ? 0 : undefined}
              aria-label={
                activeOutput && !running
                  ? "查看当前设计稿大图"
                  : undefined
              }
              onClick={() =>
                activeOutput &&
                canOpenWallevenImagePreview() && setFullscreenOpen(true)
              }
              onKeyDown={(event) => {
                if (!activeOutput || running || !["Enter", " "].includes(event.key)) return;
                event.preventDefault();
                if (canOpenWallevenImagePreview()) setFullscreenOpen(true);
              }}
            >
              {activeOutput ? (
                <div className="dws-artboard-stage">
                  <div className="dws-artboard-page">
                    <AuthenticatedImage
                      data-studio-output
                      src={outputMaps.displays[activeOutput] || activeOutput}
                      fallbackSrc={activeOutput}
                      alt="UI 设计稿预览"
                      loading="eager"
                      maxDimension={2200}
                      onLoad={(event) => {
                        setMediaError("");
                        setActiveImageDimensions({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        });
                      }}
                      onError={() =>
                        setMediaError("图片加载失败，请切换版本或重新生成")
                      }
                    />
                  </div>
                </div>
              ) : (
                <EmptyCanvas
                  uploading={uploadingDesign}
                  onUpload={openDesignPicker}
                />
              )}
              {running && (
                <div className="dws-running">
                  <span className="dws-running-scan" />
                  <i className="bi bi-stars" />
                  <strong>{status || "正在生成设计稿…"}</strong>
                  <button
                    type="button"
                    className="dws-running-cancel"
                    disabled={cancelling}
                    onClick={() => cancelGeneration()}
                  >
                    <i
                      className={`bi ${cancelling ? "bi-arrow-repeat spin" : "bi-stop-fill"}`}
                    />
                    {cancelling ? "正在确认" : "停止生成"}
                  </button>
                </div>
              )}
            </div>
          </div>
          {mediaError && <p className="dws-error is-stage">{mediaError}</p>}
          {(majors.length > 0 || historyLoading) && (
            <footer className="dws-versions-wrap" aria-label="设计版本">
              <button
                type="button"
                className="dws-history-page is-prev"
                disabled={historyPage === 0}
                aria-label="上一页历史"
                onClick={() =>
                  setHistoryPage((value) => Math.max(0, value - 1))
                }
              >
                <i className="bi bi-chevron-left" />
              </button>
              <div className="dws-version-history">
                <div className="dws-version-families">
                  {pagedMajors.map((major) => (
                    <div
                      key={major.id}
                      className={`dws-version-family${activeNode?.id === major.id ? " is-on" : ""}`}
                    >
                      <button
                        type="button"
                        className="dws-family-main"
                        aria-label={`在画布显示 ${major.label}`}
                        onClick={() => {
                          const url =
                            pickCarrier(major, viewDeviceId) || major.cover;
                          setActiveOutput(url);
                          setViewDeviceId(
                            tree.metaByOutput[url]?.deviceId || viewDeviceId,
                          );
                        }}
                      >
                        <span className="dws-family-thumb">
                          <AuthenticatedImage
                            src={major.cover}
                            alt=""
                            maxDimension={320}
                          />
                        </span>
                        <span className="dws-family-meta">
                          <span className="dws-family-head">
                            <strong>{major.label}</strong>
                            <span className="dws-family-tags">
                              {major.descendantCount > 0 && (
                                <em>{major.descendantCount + 1} 版</em>
                              )}
                            </span>
                          </span>
                          <span className="dws-family-devices">
                            {Object.keys(major.carriers).map((id) => (
                              <i
                                key={id}
                                className={`bi dws-family-device ${getDesignDevice(id).icon}`}
                              />
                            ))}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="dws-family-detail"
                        aria-label={`打开 ${major.label} 侧边栏`}
                        onClick={() => setVersionDrawerOpen(true)}
                      >
                        <i className="bi bi-layout-sidebar-inset-reverse" />
                      </button>
                    </div>
                  ))}
                </div>
                {historyLoading && !majors.length && (
                  <span className="dws-versions-skeleton">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <div className="dws-history-page-meta">
                <strong>
                  {historyPage + 1} / {historyPages}
                </strong>
                {historyLoading && <i className="bi bi-arrow-repeat spin" />}
              </div>
              <button
                type="button"
                className="dws-history-page is-next"
                disabled={historyPage >= historyPages - 1}
                aria-label="下一页历史"
                onClick={() =>
                  setHistoryPage((value) =>
                    Math.min(historyPages - 1, value + 1),
                  )
                }
              >
                <i className="bi bi-chevron-right" />
              </button>
            </footer>
          )}
        </section>
      </div>
      {pageTypePicker && (
        <PageTypePicker
          light={!isDark}
          style={pageTypePicker}
          value={pageTypeId}
          onSelect={(id) => {
            setPageTypeId(id);
            setPageTypePicker(null);
          }}
          onClose={() => setPageTypePicker(null)}
        />
      )}
      {configPicker && (
        <ConfigPicker
          type={configPicker.type}
          light={!isDark}
          style={configPicker.style}
          value={configPicker.type === "style" ? styleId : brandColor}
          spec={spec}
          device={device}
          onSelect={(value) => {
            if (configPicker.type === "style") setStyleId(value);
            else setBrandColor(value);
            setConfigPicker(null);
          }}
          onSpec={patchSpec}
          onState={toggleSpecState}
          onClose={() => setConfigPicker(null)}
        />
      )}
      {fullscreenOpen && (
        <WallevenImagePreview
          sourceUrl={activeOutput}
          displaySourceUrl={outputMaps.displays[activeOutput] || ""}
          title="UI 设计稿"
          filename="ui-design.png"
          metadata={{
            id: activeVersionLabel || majors[0]?.label || "ui-design",
            category: pageType.label,
            ratio: activeSystem.ratio,
            style: visualStyle.label,
          }}
          gallery={outputMaps.outputs}
          displaySources={outputMaps.displays}
          onSelect={(url) => {
            setActiveOutput(url);
            setViewDeviceId(outputMaps.devices[url] || viewDeviceId);
          }}
          onClose={() => setFullscreenOpen(false)}
          onDownload={() =>
            downloadAuthenticatedMedia(activeOutput, "ui-design.png")
          }
        />
      )}
      {regionFullscreen && regionResultUrls.length > 0 && (
        <WallevenImagePreview
          sourceUrl={regionPreviewUrl || regionResultUrls[0]}
          title="框选优化结果"
          filename="ui-region-optimize.png"
          metadata={{
            id: "region-optimize",
            category: "框选优化",
            ratio: activeSystem.ratio,
          }}
          gallery={regionResultUrls}
          onSelect={setRegionPreviewUrl}
          onClose={() => setRegionFullscreen(false)}
          onDownload={() =>
            downloadAuthenticatedMedia(
              regionPreviewUrl || regionResultUrls[0],
              "ui-region-optimize.png",
            )
          }
        />
      )}
      {versionDrawerOpen && (
        <VersionDrawer
          light={!isDark}
          forest={tree.forest}
          activeOutput={activeOutput}
          onSelect={(url) => {
            const entry = entries.find((item) => item.url === url);
            if (entry && String(entry.groupId || "").startsWith("region-")) {
              setActiveOutput(entry.parent || activeOutput);
              setRegionPreviewUrl(url);
              setRegionMode(true);
              setRegions((current) => {
                if (current.some((box) => box.resultUrl === url)) return current;
                const box = createRegionBox({
                  resultUrl: url,
                  x: 0.12,
                  y: 0.12,
                  width: 0.76,
                  height: 0.76,
                });
                return box ? [...current, box] : current;
              });
              setVersionDrawerOpen(false);
              return;
            }
            setActiveOutput(url);
            setViewDeviceId(
              tree.metaByOutput[url]?.deviceId ||
                entry?.deviceId ||
                viewDeviceId,
            );
            setVersionDrawerOpen(false);
          }}
          onIterate={(node) => {
            const url = pickCarrier(node, viewDeviceId) || node.cover;
            const entry = entries.find((item) => item.url === url);
            const source =
              entry && String(entry.groupId || "").startsWith("region-")
                ? entry.parent || url
                : url;
            setActiveOutput(source);
            setViewDeviceId(
              tree.metaByOutput[source]?.deviceId ||
                entry?.deviceId ||
                viewDeviceId,
            );
            setIterationSource(source);
            setVersionDrawerOpen(false);
          }}
          onDelete={async (value) => {
            const nodes = Array.isArray(value) ? value : [value];
            const urls = new Set(
              nodes.flatMap((node) =>
                collectDescendants(node).flatMap((entry) =>
                  Object.values(entry.carriers || {}),
                ),
              ),
            );
            const removedEntries = entries.filter((item) => urls.has(item.url));
            const ids = [
              ...new Set(
                removedEntries
                  .map((item) => item.jobId)
                  .filter(
                    (id) => id && !String(id).startsWith("upload-"),
                  ),
              ),
            ];
            setLocalError("");
            try {
              await Promise.all(
                ids.map((id) => deleteServerAiJob(id, { cascade: true })),
              );
            } catch (error) {
              const message = error?.message || "删除版本失败，请稍后重试";
              setLocalError(message);
              notificationService.error(message);
              return;
            }
            forgetSavedUploads(urls);
            setEntries((current) =>
              current.filter((item) => !urls.has(item.url)),
            );
            if (urls.has(activeOutput)) {
              const fallback = entries.find((item) => !urls.has(item.url));
              setActiveOutput(fallback?.url || "");
              if (fallback?.deviceId) setViewDeviceId(fallback.deviceId);
            }
            setVersionDrawerOpen(false);
            notificationService.success(
              removedEntries.length > 1 ? "版本组已删除" : "版本已删除",
            );
          }}
          onClose={() => setVersionDrawerOpen(false)}
        />
      )}
      {regionDialogOpen &&
        createPortal(
          <div
            className="dws-region-workspace"
            role="dialog"
            aria-modal="true"
            aria-label="框选优化"
            onClick={(event) => event.stopPropagation()}
          >
            <section className="dws-region-workspace__canvas">
              <header className="dws-region-workspace__header">
                <div>
                  <span className="dws-region-workspace__mark" aria-hidden="true">
                    <i className="bi bi-bounding-box-circles" />
                  </span>
                  <div>
                    <strong>框选优化</strong>
                    <small>
                      {regionBusy
                        ? `${regionPendingCount} 个任务正在处理`
                        : activeVersionLabel || "当前设计稿"}
                    </small>
                  </div>
                </div>
                <div>
                  {region && (
                    <button
                      type="button"
                      className="dws-region-size-copy"
                      aria-label="复制同尺寸选区"
                      title="复制同尺寸选区"
                      disabled={regionBusy}
                      onClick={duplicateActiveRegion}
                    >
                      <i className="bi bi-copy" />
                      {regionOutputWidth} × {regionOutputHeight}
                    </button>
                  )}
                  <button
                    type="button"
                    className="dws-region-close"
                    aria-label="关闭框选优化"
                    onClick={() => setRegionDialogOpen(false)}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                </div>
              </header>
              <div className="dws-region-workspace__viewport">
                <div
                  className="dws-region-workspace__stage"
                  style={{
                    aspectRatio: `${activeImageDimensions?.width || 16} / ${activeImageDimensions?.height || 9}`,
                    width: `min(100%, ${Math.max(32, ((activeImageDimensions?.width || 16) / Math.max(1, activeImageDimensions?.height || 9)) * 82)}vh)`,
                  }}
                >
                  <AuthenticatedImage
                    src={outputMaps.displays[activeOutput] || activeOutput}
                    fallbackSrc={activeOutput}
                    alt="待框选的 UI 设计稿"
                    loading="eager"
                    maxDimension={2400}
                    onLoad={(event) =>
                      setActiveImageDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {regionSelectionLayer}
                </div>
              </div>
              <footer className="dws-region-workspace__footer">
                <span>
                  {regions.length
                    ? `已框选 ${regions.length} 处 · 拖空白处可再加`
                    : "在图片上拖拽创建选区"}
                </span>
                <div className="dws-region-workspace__tools">
                  <button
                    type="button"
                    className={regionMode ? "is-active" : ""}
                    disabled={regionBusy}
                    onClick={() => {
                      setRegionMode(true);
                      setManualMode(false);
                      setRegionStatus("继续拖拽可再框选一处");
                    }}
                  >
                    {regionMode ? "继续框选中" : "继续框选"}
                  </button>
                  {regions.length > 1 && (
                    <button
                      type="button"
                      disabled={regionBusy || !region}
                      onClick={() => {
                        const next = regions.filter((item) => item.id !== region?.id);
                        setRegions(next);
                        setActiveRegionId(next[0]?.id || "");
                        if (!next.length) setRegionMode(true);
                      }}
                    >
                      删除此框
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={regionBusy}
                    onClick={() => {
                      clearRegionProcessSession();
                      regionPersistRef.current = {};
                      setRegions([]);
                      setActiveRegionId("");
                      setRegionDraft(null);
                      setRegionPreviewUrl("");
                      setRegionMode(true);
                      setManualMode(false);
                      setRegionStatus("");
                    }}
                  >
                    重新框选
                  </button>
                </div>
                {regionBusy && <em>{regionStatus || "正在处理…"}</em>}
              </footer>
            </section>
            <aside className="dws-region-composer">
              <header className="dws-region-composer__header">
                <div>
                  <strong>操作{regions.length > 1 ? ` · ${regions.length} 处` : ""}</strong>
                  <small>{regionNextStep}</small>
                </div>
                <button
                  type="button"
                  className="dws-region-close"
                  aria-label="清除框选区域"
                  disabled={regionBusy || !regions.length}
                  onClick={clearRegionSession}
                  title="清除全部选区"
                >
                  <i className="bi bi-trash3" />
                </button>
              </header>
            {regions.length > 1 && (
              <div className="dws-region-composer__boxes" aria-label="切换选区">
                {regions.map((box, index) => (
                  <button
                    key={box.id}
                    type="button"
                    className={box.id === region?.id ? "is-on" : ""}
                    disabled={regionBusy}
                    onClick={() => setActiveRegionId(box.id)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
            {regionResultUrls.length > 0 && (
              <div
                className={`dws-region-composer__previews${regionResultUrls.length > 1 ? " is-multi" : ""}`}
              >
                {regionResultUrls.map((url, index) => (
                  <figure
                    key={`${url}-${index}`}
                    className="dws-region-composer__preview is-clickable"
                    onClick={() => {
                      setRegionPreviewUrl(url);
                      if (canOpenWallevenImagePreview()) setRegionFullscreen(true);
                    }}
                  >
                    <AuthenticatedImage
                      src={url}
                      alt={`编辑结果 ${index + 1}`}
                      maxDimension={720}
                    />
                    {regionResultUrls.length > 1 && <em>{index + 1}</em>}
                    <button
                      type="button"
                      className="dws-region-composer__zoom"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRegionPreviewUrl(url);
                        if (canOpenWallevenImagePreview()) setRegionFullscreen(true);
                      }}
                    >
                      <i className="bi bi-arrows-fullscreen" />
                      查看大图
                    </button>
                  </figure>
                ))}
              </div>
            )}
            <div className="dws-region-composer__modes" aria-label="编辑方式">
              {REGION_EDIT_ACTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={regionAction === item.id ? "active" : ""}
                  disabled={regionBusy}
                  onClick={() => setRegionAction(item.id)}
                >
                  <i className={`bi ${item.icon}`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <textarea
              value={regionPrompt}
              rows={4}
              maxLength={1000}
              disabled={regionBusy}
              placeholder={regionActionGuide.placeholder}
              onChange={(event) => setRegionPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (regionCanProcess && !regionBusy) processRegion();
                }
              }}
            />
            <div className="dws-region-composer__refs">
              <strong>参考图</strong>
              <div>
                {regionReferences.map((item, index) => (
                  <article key={item.id}>
                    <img
                      src={item.preview}
                      alt={item.name || `参考图 ${index + 1}`}
                    />
                    <button
                      type="button"
                      aria-label={`移除参考图 ${index + 1}`}
                      disabled={regionBusy}
                      onClick={() =>
                        setRegionReferences((current) => {
                          const next = current.filter(
                            (entry) => entry.id !== item.id,
                          );
                          if (item.preview) {
                            URL.revokeObjectURL(item.preview);
                            previewUrlsRef.current.delete(item.preview);
                          }
                          return next;
                        })
                      }
                    >
                      <i className="bi bi-x" />
                    </button>
                  </article>
                ))}
                <button
                  type="button"
                  className="dws-region-composer__ref-add"
                  disabled={
                    regionBusy ||
                    regionReferences.length >= MAX_REGION_STYLE_REFERENCES
                  }
                  onClick={() => regionFileInputRef.current?.click()}
                >
                  <i className="bi bi-plus-lg" />
                  添加参考图
                </button>
              </div>
              <p>
                {regions.length > 1
                  ? regionReferences.length
                    ? "多框选各出一张：按参考图统一风格，每个框保持自己的内容"
                    : "多框选各出一张：无参考图时，后续按第一张出图对齐风格"
                  : "可继续框选，框几处出几张"}
              </p>
              <input
                ref={regionFileInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  addRegionFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
            <div className="dws-region-composer__elements">
              <div className="dws-region-composer__recognition">
                <strong>识别类型</strong>
                <div>
                  {REGION_RECOGNITION_OPTIONS.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        value={item.id}
                        checked={regionRecognition.includes(item.id)}
                        disabled={regionBusy}
                        onChange={() =>
                          setRegionRecognition((current) =>
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          )
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="dws-region-composer__element-actions">
                <button
                  type="button"
                  className={manualMode ? "is-active" : ""}
                  aria-pressed={manualMode}
                  disabled={regionBusy || !region}
                  onClick={() => setManualMode((current) => !current)}
                >
                  <i className="bi bi-bounding-box" />
                  {manualMode ? "退出手动框选" : "手动框选元素"}
                </button>
                <button
                  type="button"
                  disabled={
                    regionBusy || !region || !regionRecognition.length
                  }
                  onClick={analyzeRegion}
                >
                  {visibleRegionElements.some((item) => !item.manual)
                    ? "重新分析元素"
                    : "开始分析元素"}
                </button>
              </div>
              {regionMarkedElements.length > 0 && !regionResult && (
                <div className="dws-region-composer__chips">
                  {regionMarkedElements.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className="dws-region-composer__chip"
                      onClick={() =>
                        patchActiveRegion({
                          marked: regionMarked.filter((id) => id !== node.id),
                        })
                      }
                    >
                      {node.name || node.text || node.type}
                      <i className="bi bi-x" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(regionError || regionStatus) && (
            <p
              className={`dws-region-composer__status${regionError ? " is-error" : regionResult ? " is-done" : ""}`}
            >
              {regionError || regionStatus}
            </p>
            )}
            <p className="dws-region-composer__cost">
              图片编辑 · 输出 {regionOutputSizeLabel} · 预计消耗{" "}
              {regions.length} 张图费用
            </p>
            <div className="dws-region-composer__actions">
              <button
                type="button"
                className="is-primary"
                disabled={regionBusy || !regionCanProcess}
                onClick={processRegion}
              >
                {regionBusy
                  ? "处理中…"
                  : regionResultUrls.length
                    ? "重新编辑"
                    : regions.length > 1
                      ? `开始图片编辑（${regions.length}）`
                      : "开始图片编辑"}
              </button>
              {regionResultUrls.length > 0 && (
                <button
                  type="button"
                  className="is-primary"
                  disabled={regionApproving || regionBusy}
                  onClick={approveRegionResult}
                >
                  {regionApproving
                    ? "保存中…"
                    : regionResultUrls.length > 1
                      ? `满意，加入素材库（${regionResultUrls.length}）`
                      : "满意，加入素材库"}
                </button>
              )}
              {regionResultUrls.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setRegionPreviewUrl(regionResultUrls[0]);
                    if (canOpenWallevenImagePreview()) setRegionFullscreen(true);
                  }}
                >
                  查看大图
                </button>
              )}
            </div>
            </aside>
          </div>,
          document.body,
        )}
      {analysisOpen &&
        createPortal(
          <div
            className="dws-analysis-layer"
            role="dialog"
            aria-modal="true"
            aria-label="设计交付"
          >
            <section className="dws-analysis-panel">
              <header>
                <div>
                  <strong>设计交付</strong>
                </div>
                <button
                  type="button"
                  aria-label="关闭设计交付"
                  onClick={() => {
                    analysisControllerRef.current?.abort();
                    setAnalysisOpen(false);
                  }}
                >
                  <i className="bi bi-x-lg" />
                </button>
              </header>
              <div className="dws-analysis-tools">
                <div>
                  {REGION_RECOGNITION_OPTIONS.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={analysisTypes.includes(item.id)}
                        disabled={analysisBusy}
                        onChange={() =>
                          setAnalysisTypes((current) =>
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          )
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <span>
                  {analysisElements.length
                    ? `已识别 ${analysisElements.length} 个元素`
                    : analysisError || "选择类型后开始分析"}
                </span>
              </div>
              <div className="dws-analysis-stage">
                <div
                  className="dws-analysis-canvas"
                  style={{
                    aspectRatio: `${analysisImageDimensions?.width || activeImageDimensions?.width || 16} / ${analysisImageDimensions?.height || activeImageDimensions?.height || 9}`,
                  }}
                >
                  <AuthenticatedImage
                    src={activeOutput}
                    alt="待分析设计稿"
                    loading="eager"
                    maxDimension={1800}
                    onLoad={(event) =>
                      setAnalysisImageDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  <div className="dws-analysis-elements">
                    {analysisElements.map((node, index) => (
                      <button
                        key={node.id}
                        type="button"
                        className={
                          analysisSelectedId === node.id ? "is-on" : ""
                        }
                        style={{
                          left: `${(node.x / (analysisImageDimensions?.width || activeImageDimensions?.width || device.viewport.width)) * 100}%`,
                          top: `${(node.y / (analysisImageDimensions?.height || activeImageDimensions?.height || device.viewport.height)) * 100}%`,
                          width: `${(node.width / (analysisImageDimensions?.width || activeImageDimensions?.width || device.viewport.width)) * 100}%`,
                          height: `${(node.height / (analysisImageDimensions?.height || activeImageDimensions?.height || device.viewport.height)) * 100}%`,
                        }}
                        onClick={() => setAnalysisSelectedId(node.id)}
                      >
                        <b>{index + 1}</b>
                        <em>{node.name || node.type}</em>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <footer>
                <span>
                  {analysisBusy
                    ? "正在识别元素…"
                    : analysisExporting
                      ? "正在导出…"
                      : analysisElements.length
                        ? "元素已就绪"
                        : "设计稿可直接打包，也可先分析元素"}
                </span>
                <div className="dws-analysis-actions">
                <button
                  type="button"
                  disabled={analysisBusy || !analysisTypes.length}
                  onClick={runFullAnalysis}
                >
                  {analysisBusy
                    ? "分析中…"
                    : analysisElements.length
                      ? "重新分析"
                      : "开始分析元素"}
                </button>
                <button
                  type="button"
                  disabled={
                    analysisBusy ||
                    analysisExporting ||
                    !analysisElements.some((item) => item.id === analysisSelectedId)
                  }
                  onClick={() =>
                    exportAnalysisNodes(
                      analysisElements.filter(
                        (item) => item.id === analysisSelectedId,
                      ),
                    )
                  }
                >
                  导出 PNG
                </button>
                <button
                  type="button"
                  disabled={
                    analysisBusy ||
                    analysisExporting
                  }
                  onClick={exportCodexPack}
                >
                  <PackageCheck size={14} aria-hidden="true" />导出交付包
                </button>
                </div>
              </footer>
            </section>
          </div>,
          document.body,
        )}
      <ConfirmDialog
        open={cancelConfirmationOpen}
        busy={cancelling}
        heading="停止接收这次生成结果？"
        description="任务已经提交给模型服务。停止后不再接收结果，本次积分不会退回。"
        confirmLabel="仍然停止"
        busyLabel="正在停止…"
        icon="bi-stop-circle"
        light={!isDark}
        onClose={() => {
          setCancelConfirmationOpen(false);
          setStatus("任务继续运行，完成后会自动显示");
        }}
        onConfirm={() => cancelGeneration({ acknowledgeUpstream: true })}
      />
    </main>
  );
}
