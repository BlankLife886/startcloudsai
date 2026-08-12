import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsDark } from "../hooks/useIsDark.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { EcommerceFullscreenPreview } from "../features/ecommerce/EcommerceFullscreenPreview.jsx";
import {
  PAGE_TYPES,
  VISUAL_STYLES,
  BRAND_COLORS,
  SPEC_OPTIONS,
  COMPONENT_STATES,
} from "../features/design-workshop/options.js";
import { fetchRuntimeConfig } from "@legacy/services/runtimeConfig.js";
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
  waitForServerAiJob,
} from "@legacy/services/aiWallpaper.js";
import {
  downloadAuthenticatedMedia,
  fetchAuthenticatedMediaBlob,
} from "@legacy/services/authenticatedMedia.js";
import {
  getScopedLocalItem,
  setScopedLocalItem,
} from "@legacy/services/scopedLocalStorage.js";
import {
  composePendingLaunchPrompt,
  takePendingPrompt,
} from "@legacy/features/creator-hub/studioTools.js";
import {
  DESIGN_DEVICE_OPTIONS,
  getDesignDevice,
  normalizeSelectedDeviceIds,
} from "@legacy/features/design-workshop/designDevices.js";
import { metricsForDeviceOption } from "@legacy/features/design-workshop/multiDeviceConsistency.js";
import {
  buildTileRefinePrompt,
  extractQuadrantTileFiles,
  resolveTileOutputLongSide,
  stitchQuadrantTiles,
} from "@legacy/features/design-workshop/tilePrecisionRefine.js";
import {
  buildVersionForest,
  canIterate,
  collectDescendants,
  pickCarrier,
} from "@legacy/features/design-workshop/versionTree.js";
import {
  DESIGN_QUALITY_REVIEW_MODES,
  auditAiDesignQuality,
  buildQualityIterationPrompt,
} from "@legacy/features/design-workshop/designQualityProfile.js";
import {
  REGION_EDIT_ACTIONS,
  REGION_RECOGNITION_OPTIONS,
  regionNodeMatchesRecognitionTypes,
  resolveRegionSelectionRequestSize,
} from "@legacy/features/design-workshop/regionOutputPolicy.js";
import {
  analyzeDesignCropElements,
  buildRegionEditInstruction,
  generateDesignRegionImage,
} from "@legacy/features/design-workshop/aiDesignDocument.js";
import { uploadAiTempBlob } from "@legacy/features/ai-shared/aiImageIO.js";
import { createUserAsset } from "@legacy/services/meApi.js";
import { uploadFile } from "@legacy/services/tasksApi.js";
import notificationService from "@legacy/services/notification.js";
import "@legacy/views/DesignWorkshopView.vue?react-style";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/AspectRatioSelect.css";
import "@legacy/features/design-workshop/components/DesignVersionDrawer.vue?react-style";
import "./DesignWorkshopView.css";

const SETTINGS_KEY = "ui-design-workshop-v2";
const REGION_PROCESS_KEY = "ui-design-region-process-v1";
const MAX_REFERENCES = 6;
const REGION_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DEFAULT_SPEC = {
  audience: "consumer",
  goal: "conversion",
  navigation: "auto",
  density: "balanced",
  typography: "neutral",
  radius: "medium",
  responsive: "adaptive",
};

function featureModels(config = {}) {
  const feature = config.features?.["ai.uiDesign"] || {};
  const payload =
    feature.config && typeof feature.config === "object"
      ? feature.config
      : feature;
  return (Array.isArray(payload.publicModels) ? payload.publicModels : [])
    .map((item) => ({
      ...item,
      id: String(item.id || item.publicModelKey || ""),
      label: String(
        item.label || item.name || item.id || item.publicModelKey || "",
      ),
      publicModelKey: String(item.publicModelKey || item.id || ""),
    }))
    .filter((item) => item.id);
}

function outputSizeForRatio(ratio = "16:9", longSide = 2048) {
  const [rw = 16, rh = 9] = ratio.split(":").map(Number);
  const width =
    rw >= rh ? longSide : Math.round((longSide * rw) / rh / 64) * 64;
  const height =
    rh >= rw ? longSide : Math.round((longSide * rh) / rw / 64) * 64;
  return `${Math.max(256, width)}x${Math.max(256, height)}`;
}

function taskEntries(jobs = []) {
  return jobs.flatMap((job) => {
    const urls = job.originalMediaUrls?.length
      ? job.originalMediaUrls
      : job.resultMediaUrls || [];
    return urls.filter(Boolean).map((url, index) => ({
      url,
      jobId: job.id,
      createdAt: job.createdAt || "",
      groupId: String(job.input?.batchId || job.input?.groupId || job.id),
      groupIndex: Number(job.input?.batchIndex || index),
      parent: String(job.input?.parentOutputUrl || ""),
      deviceId: String(job.input?.deviceId || job.input?.viewId || "web"),
    }));
  });
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
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
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
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            setMenuStyle({
              left: Math.round(rect.left),
              top: Math.round(rect.bottom + 6),
              width: Math.round(rect.width),
              maxHeight: Math.max(
                140,
                Math.min(360, window.innerHeight - rect.bottom - 18),
              ),
            });
          }
          setOpen((current) => !current);
        }}
      >
        <span className="ratio-select__value">
          <span>{selected?.label || "请选择"}</span>
        </span>
        <i className="bi bi-chevron-down ratio-select__chevron" />
      </button>
      {open && (
        <div
          className="ratio-select__menu is-glass"
          role="listbox"
          style={menuStyle}
        >
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`ratio-select__option${item.value === value ? " is-active" : ""}`}
              role="option"
              aria-selected={item.value === value}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              <i className={`bi ${item.icon || icon}`} />
              <span>{item.label}</span>
              {item.value === value && <i className="bi bi-check2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyCanvas({ device, pageType }) {
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
      <strong>画布等待第一稿</strong>
      <span>
        {device.label} · {device.ratio} · {pageType.label}
      </span>
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
            <small>PAGE ARCHETYPE</small>
            <strong id="dws-page-type-title">选择页面类型</strong>
          </span>
          <em>20 种结构</em>
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
                <small>{item.description}</small>
                <em>{item.prompt || "根据业务自由组合导航、内容和操作区域"}</em>
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
  states,
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
        : "配置设计规范";
  const eyebrow =
    type === "style"
      ? "VISUAL LANGUAGE"
      : type === "brand"
        ? "COLOR SYSTEM"
        : "DESIGN SYSTEM";
  const metrics = metricsForDeviceOption(device, {
    densityId: spec.density,
    radiusLabel:
      SPEC_OPTIONS.radius.find(([id]) => id === spec.radius)?.[1] || "标准 8px",
  });
  const labels = {
    audience: "目标用户",
    goal: "核心目标",
    navigation: "导航结构",
    density: "信息密度",
    typography: "字体气质",
    radius: "组件圆角",
    responsive: "响应式策略",
  };
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
            <small>{eyebrow}</small>
            <strong id={`dws-${type}-title`}>{title}</strong>
          </span>
          <em>
            {type === "style"
              ? "12 种风格"
              : type === "brand"
                ? "12 套色板"
                : `${metrics.columns} 列 · 8pt`}
          </em>
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
                  <small>{item.description}</small>
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
                  <small>{item.description}</small>
                  <em>{item.value}</em>
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
                <i className="bi bi-grid-3x3-gap" />
                <b>{metrics.columns} 列</b>
                <small>{metrics.margin}px 边距</small>
              </span>
              <span>
                <i className="bi bi-distribute-vertical" />
                <b>{metrics.spacing}pt</b>
                <small>{metrics.gutter}px 列距</small>
              </span>
              <span>
                <i className="bi bi-input-cursor-text" />
                <b>{metrics.controlHeight}px</b>
                <small>控件高度</small>
              </span>
              <span>
                <i className="bi bi-bounding-box-circles" />
                <b>{metrics.radius}</b>
                <small>组件圆角</small>
              </span>
            </div>
            <p className="dws-spec-hint">
              当前按「{device.label} {device.ratio}
              」计算栅格；多端生成时各端会自动适配列数与边距。
            </p>
            <div className="dws-spec-grid">
              {Object.entries(SPEC_OPTIONS).map(([key, options]) => (
                <div
                  key={key}
                  className={`dws-select-field${key === "responsive" ? " is-wide" : ""}`}
                >
                  <span className="dws-label">{labels[key]}</span>
                  <WorkshopSelect
                    value={spec[key]}
                    options={options.map(([id, label]) => ({
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
            <div className="dws-state-field">
              <span className="dws-label">必须覆盖的组件状态</span>
              <div
                className="dws-state-options"
                role="group"
                aria-label="必须覆盖的组件状态"
              >
                {COMPONENT_STATES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={states.includes(item.id) ? "is-on" : ""}
                    aria-pressed={states.includes(item.id)}
                    onClick={() => onState(item.id)}
                  >
                    <i
                      className={`bi ${states.includes(item.id) ? "bi-check2" : "bi-plus"}`}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function QualityDialog({
  light,
  audit,
  loading,
  error,
  mode,
  selected,
  onMode,
  onRun,
  onToggle,
  onApply,
  onClose,
}) {
  return createPortal(
    <div
      className="dws-quality-layer"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`dws-quality-dialog${light ? " is-light" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dws-quality-title"
      >
        <header className="dws-quality-header">
          <span>
            <small>DESIGN QUALITY · V3</small>
            <strong id="dws-quality-title">设计品质检查</strong>
          </span>
          <em>{audit?.version || "视觉模型评审"}</em>
          {audit && !loading && (
            <button
              type="button"
              className="is-refresh"
              aria-label="重新检查当前版本"
              onClick={onRun}
            >
              <i className="bi bi-arrow-clockwise" />
            </button>
          )}
          <button type="button" aria-label="关闭品质检查" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <nav className="dws-quality-modes" aria-label="品质检查视角">
          {DESIGN_QUALITY_REVIEW_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              className={mode === item.id ? "is-on" : ""}
              aria-pressed={mode === item.id}
              onClick={() => onMode(item.id)}
            >
              <i className={`bi ${item.icon}`} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {loading ? (
          <div className="dws-quality-loading">
            <span className="dws-quality-orbit">
              <i />
              <i />
              <i />
            </span>
            <strong>正在检查设计品质</strong>
            <p>分析信息层级、栅格、文字、配色、组件一致性与业务完整度</p>
            <div>
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : error ? (
          <div className="dws-quality-error">
            <i className="bi bi-exclamation-triangle" />
            <strong>检查没有完成</strong>
            <p>{error}</p>
            <button type="button" onClick={onRun}>
              <i className="bi bi-arrow-repeat" />
              重新检查
            </button>
          </div>
        ) : !audit ? (
          <div className="dws-quality-empty">
            <i className="bi bi-clipboard2-pulse" />
            <strong>这个视角还没有检查记录</strong>
            <p>
              {
                DESIGN_QUALITY_REVIEW_MODES.find((item) => item.id === mode)
                  ?.prompt
              }
            </p>
            <button type="button" onClick={onRun}>
              <i className="bi bi-stars" />
              开始检查
            </button>
          </div>
        ) : (
          <div className="dws-quality-result">
            <section className="dws-quality-summary">
              <div
                className="dws-quality-score"
                style={{ "--quality-score": `${audit.score * 3.6}deg` }}
              >
                <span>
                  <b>{audit.score}</b>
                  <small>/ 100</small>
                </span>
              </div>
              <div>
                <small>总体结论</small>
                <strong>{audit.verdict}</strong>
                <p>基于当前页面目标和所选视觉规范评估</p>
              </div>
            </section>
            {audit.dimensions?.length > 0 && (
              <section className="dws-quality-dimensions">
                {audit.dimensions.map((item) => (
                  <article key={item.id}>
                    <span>
                      <b>{item.label}</b>
                      <em>{item.score}</em>
                    </span>
                    <i>
                      <u style={{ width: `${item.score}%` }} />
                    </i>
                    <small>{item.note}</small>
                  </article>
                ))}
              </section>
            )}
            {audit.strengths?.length > 0 && (
              <section className="dws-quality-strengths">
                <h3>
                  <i className="bi bi-check2-circle" />
                  做得好的地方
                </h3>
                <ul>
                  {audit.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            <section className="dws-quality-issues">
              <header>
                <h3>
                  <i className="bi bi-list-check" />
                  需要调整
                </h3>
                <span>
                  {selected.length}/{audit.issues?.length || 0} 项
                </span>
              </header>
              <div>
                {audit.issues?.map((issue) => (
                  <article
                    key={issue.id}
                    className={selected.includes(issue.id) ? "is-selected" : ""}
                  >
                    <button
                      type="button"
                      className="dws-quality-check"
                      aria-pressed={selected.includes(issue.id)}
                      onClick={() => onToggle(issue.id)}
                    >
                      <i
                        className={`bi ${selected.includes(issue.id) ? "bi-check2" : "bi-plus"}`}
                      />
                    </button>
                    <span className={`is-${issue.severity}`}>
                      {issue.severity === "critical"
                        ? "严重"
                        : issue.severity === "major"
                          ? "主要"
                          : "细节"}
                    </span>
                    <div>
                      <strong>{issue.title}</strong>
                      <p>{issue.evidence}</p>
                      <small>
                        <i className="bi bi-arrow-return-right" />
                        {issue.fix}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {audit && !loading && (
          <footer className="dws-quality-footer">
            <span>
              <i className="bi bi-stars" />
              已选择 {selected.length} 项，未选择区域保持不变
            </span>
            <button type="button" disabled={!selected.length} onClick={onApply}>
              定向迭代
              <i className="bi bi-arrow-right" />
            </button>
          </footer>
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
            <small>VERSION HISTORY</small>
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
        <div className="dvd-legend">
          <span>
            <b>V14</b>大版本
          </span>
          <span>
            <b>V14.1</b>迭代
          </span>
          <span>
            <i className="bi bi-phone" />
            多端
          </span>
          <span>
            <i className="bi bi-bounding-box-circles" />
            元素分析
          </span>
        </div>
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
                  onClick={() =>
                    setExpanded((current) =>
                      current.includes(major.id)
                        ? current.filter((id) => id !== major.id)
                        : [...current, major.id],
                    )
                  }
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
                    aria-label={`删除 ${major.label}`}
                    onClick={() => onDelete(major)}
                  >
                    <i className="bi bi-trash3" />
                  </button>
                </div>
              </div>
              {expanded.includes(major.id) &&
                Object.entries(major.carriers).map(([deviceId, url]) => (
                  <button
                    key={url}
                    type="button"
                    className={`dvd-node${activeOutput === url ? " is-active" : ""}`}
                    onClick={() => onSelect(url)}
                  >
                    <i className={`bi ${getDesignDevice(deviceId).icon}`} />
                    <span>
                      <strong>{getDesignDevice(deviceId).label}</strong>
                      <small>{getDesignDevice(deviceId).ratio}</small>
                    </span>
                    <i className="bi bi-chevron-right" />
                  </button>
                ))}
            </article>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function DesignWorkshopView() {
  const isDark = useIsDark();
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const pageTypeTriggerRef = useRef(null);
  const styleTriggerRef = useRef(null);
  const brandTriggerRef = useRef(null);
  const specTriggerRef = useRef(null);
  const artboardRef = useRef(null);
  const mountedRef = useRef(true);
  const taskControllerRef = useRef(null);
  const historyControllerRef = useRef(null);
  const activeJobIdsRef = useRef(new Set());
  const previewUrlsRef = useRef(new Set());
  const regionStartRef = useRef(null);
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
  const [componentStates, setComponentStates] = useState(
    COMPONENT_STATES.map((item) => item.id),
  );
  const [references, setReferences] = useState([]);
  const [iterationSource, setIterationSource] = useState("");
  const [entries, setEntries] = useState([]);
  const [activeOutput, setActiveOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState("");
  const [localError, setLocalError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(0);
  const [tabletPane, setTabletPane] = useState("controls");
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [pageTypePicker, setPageTypePicker] = useState(null);
  const [configPicker, setConfigPicker] = useState(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [qualityMode, setQualityMode] = useState("balanced");
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState("");
  const [qualityByOutput, setQualityByOutput] = useState({});
  const [qualitySelected, setQualitySelected] = useState([]);
  const [analysisModelId, setAnalysisModelId] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisElements, setAnalysisElements] = useState([]);
  const [analysisTypes, setAnalysisTypes] = useState(["text", "icon", "image"]);
  const [tilePhase, setTilePhase] = useState("");
  const [tileProgress, setTileProgress] = useState([]);
  const [tileEntry, setTileEntry] = useState(null);
  const [tileDialogOpen, setTileDialogOpen] = useState(false);
  const [activeImageDimensions, setActiveImageDimensions] = useState(null);
  const [regionMode, setRegionMode] = useState(false);
  const [region, setRegion] = useState(null);
  const [regionRecognition, setRegionRecognition] = useState([]);
  const [regionAction, setRegionAction] = useState("remove");
  const [regionPrompt, setRegionPrompt] = useState("");
  const [regionElements, setRegionElements] = useState([]);
  const [regionMarked, setRegionMarked] = useState([]);
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionStatus, setRegionStatus] = useState("");
  const [regionError, setRegionError] = useState("");
  const [regionResult, setRegionResult] = useState("");
  const [regionApproving, setRegionApproving] = useState(false);
  const [regionFullscreen, setRegionFullscreen] = useState(false);
  const [regionViewport, setRegionViewport] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualDraft, setManualDraft] = useState(null);

  const pageType =
    PAGE_TYPES.find((item) => item.id === pageTypeId) || PAGE_TYPES[0];
  const visualStyle =
    VISUAL_STYLES.find((item) => item.id === styleId) || VISUAL_STYLES[0];
  const device = getDesignDevice(viewDeviceId);
  const radiusLabel =
    SPEC_OPTIONS.radius.find(([id]) => id === spec.radius)?.[1] || "标准 8px";
  const designMetrics = metricsForDeviceOption(device, {
    densityId: spec.density,
    radiusLabel,
  });
  const isIteration = Boolean(iterationSource);
  const hasReference = isIteration || references.length > 0;
  const activeModel =
    models.find((item) => item.id === modelId) || models[0] || null;
  const unitCost = Math.max(0, Number(activeModel?.creditCost || 0));
  const totalCost =
    unitCost * Math.max(1, isIteration ? 1 : selectedDeviceIds.length);
  const costLabel = totalCost ? `${totalCost} 积分` : "免费";
  const outputMaps = useMemo(() => {
    const outputs = entries.map((item) => item.url);
    return {
      outputs,
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
  const qualityAudit =
    qualityByOutput[`${qualityMode}::${activeOutput}`] || null;
  const visibleRegionElements = regionElements.filter(
    (node) =>
      node.manual === true ||
      regionNodeMatchesRecognitionTypes(node, regionRecognition),
  );
  const regionMarkedElements = visibleRegionElements.filter((node) =>
    regionMarked.includes(node.id),
  );
  const [frameWidth = 16, frameHeight = 9] = device.ratio
    .split(":")
    .map(Number);
  const frameRatio = frameWidth / Math.max(1, frameHeight);
  const imageRatio = activeImageDimensions
    ? activeImageDimensions.width / Math.max(1, activeImageDimensions.height)
    : frameRatio;
  const regionLayerStyle =
    imageRatio >= frameRatio
      ? {
          left: "0%",
          top: `${((1 - frameRatio / imageRatio) / 2) * 100}%`,
          width: "100%",
          height: `${(frameRatio / imageRatio) * 100}%`,
        }
      : {
          left: `${((1 - imageRatio / frameRatio) / 2) * 100}%`,
          top: "0%",
          width: `${(imageRatio / frameRatio) * 100}%`,
          height: "100%",
        };
  const regionOutputWidth = Math.max(
    1,
    Math.round((activeImageDimensions?.width || 1024) * (region?.width || 1)),
  );
  const regionOutputHeight = Math.max(
    1,
    Math.round((activeImageDimensions?.height || 1024) * (region?.height || 1)),
  );
  const regionOutputSizeLabel = `${regionOutputWidth}×${regionOutputHeight}`;

  const buildPrompt = useCallback(
    (targetDevice = device) => {
      if (isIteration)
        return [
          "任务类型：基于参考图的受控 UI 迭代，不是重新设计整张页面。",
          `本次唯一修改：${iterationBrief.trim() || "保持当前设计，仅提升文字和边缘清晰度"}。`,
          "锁定规则：除上述修改外，原图的画布比例、页面结构、组件位置与尺寸、间距、圆角、颜色、图标和装饰必须保持不变，不要新增、删除或移动任何元素。",
          `输出要求：${targetDevice.label} ${targetDevice.ratio}，正视图，整张图就是设计稿本身，不要样机、透视、倾斜、拼贴或设计软件界面。`,
        ].join("\n");
      const pagePrompt =
        pageTypeId === "custom" ? customPageType.trim() : pageType.prompt;
      return [
        references.length
          ? `基于提供的 ${references.length} 张参考界面进行重新设计：${brief.trim() || "在保持信息结构与视觉系统的前提下提升视觉质量"}。`
          : `为「${brief.trim() || "一款现代数字产品"}」设计一张高保真 UI 设计稿。`,
        `设备载体：${targetDevice.prompt}（生成画幅 ${targetDevice.ratio}）。`,
        `页面结构：${pagePrompt || "根据业务自由组合导航、内容和操作区域"}。`,
        `视觉风格：${visualStyle.prompt}。`,
        `配色规范：品牌主色 ${brandColor}，${colorScheme === "dark" ? "深色" : "浅色"}模式。`,
        `栅格与间距：${designMetrics.columns} 列栅格，左右安全边距 ${designMetrics.margin}px，列间距 ${designMetrics.gutter}px。`,
        `组件规范：按钮、输入框统一为 ${designMetrics.controlHeight}px 高，${radiusLabel}。`,
        "整张图就是设计稿本身，铺满画布；不要设备样机、透视、多页拼贴、设计软件窗口或水印。",
      ].join("\n");
    },
    [
      brandColor,
      brief,
      colorScheme,
      customPageType,
      designMetrics,
      device,
      isIteration,
      iterationBrief,
      pageType,
      pageTypeId,
      radiusLabel,
      references.length,
      visualStyle.prompt,
    ],
  );

  const loadHistory = useCallback(async () => {
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    try {
      const response = await listServerAiJobs(24, {
        type: "ui_design",
        signal: controller.signal,
        excludeFailed: true,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      const next = taskEntries(response.jobs);
      setEntries(next);
      setActiveOutput((current) => current || next[0]?.url || "");
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setLocalError(error?.message || "历史记录加载失败");
    } finally {
      if (mountedRef.current && historyControllerRef.current === controller)
        setHistoryLoading(false);
    }
  }, []);

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
    }
    try {
      const session = JSON.parse(
        getScopedLocalItem(REGION_PROCESS_KEY) || "null",
      );
      if (session?.outputUrl && session?.selection) {
        const viewport = session.elementViewport || null;
        setActiveOutput(session.outputUrl);
        setRegion(session.selection);
        setRegionRecognition(
          Array.isArray(session.recognitionTypes)
            ? session.recognitionTypes
            : [],
        );
        setRegionAction(session.editAction || "remove");
        setRegionPrompt(session.prompt || "");
        setRegionViewport(viewport);
        setRegionElements(
          Array.isArray(session.elements) ? session.elements : [],
        );
        setRegionMarked(
          Array.isArray(session.markedIds) ? session.markedIds : [],
        );
        setRegionStatus(session.stage || "勾选识别类型后开始分析");
        setRegionError(session.error || "");
        setRegionResult(session.resultUrl || "");
      }
    } catch {
      // Ignore a damaged resumable region session.
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
      .catch(() => undefined);
    return () => {
      mountedRef.current = false;
      taskControllerRef.current?.abort();
      historyControllerRef.current?.abort();
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, [loadHistory]);

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
        componentStates,
        designSpecVersion: 2,
      }),
    );
  }, [
    brandColor,
    brief,
    colorScheme,
    componentStates,
    customPageType,
    pageTypeId,
    selectedDeviceIds,
    spec,
    styleId,
  ]);

  useEffect(() => {
    setActiveImageDimensions(null);
  }, [activeOutput]);

  useEffect(() => {
    if (!activeOutput || !region) return;
    setScopedLocalItem(
      REGION_PROCESS_KEY,
      JSON.stringify({
        outputUrl: activeOutput,
        selection: region,
        coordinateSpace: "image-content-v1",
        prompt: regionPrompt,
        recognitionTypes: regionRecognition,
        editAction: regionAction,
        resultUrl: regionResult,
        stage: regionStatus,
        error: regionError,
        loading: regionBusy,
        elements: regionElements,
        elementViewport: regionViewport,
        elementGeometryVersion: 2,
        markedIds: regionMarked,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, [
    activeOutput,
    region,
    regionAction,
    regionBusy,
    regionElements,
    regionError,
    regionMarked,
    regionPrompt,
    regionRecognition,
    regionResult,
    regionStatus,
    regionViewport,
  ]);

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      if (qualityOpen) setQualityOpen(false);
      else if (versionDrawerOpen) setVersionDrawerOpen(false);
      else if (pageTypePicker) setPageTypePicker(null);
      else if (configPicker) setConfigPicker(null);
      else if (regionMode || region) {
        setRegionMode(false);
        setRegion(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [
    configPicker,
    pageTypePicker,
    qualityOpen,
    region,
    regionMode,
    versionDrawerOpen,
  ]);

  const addFiles = useCallback(
    (files) => {
      const images = [...files]
        .filter((file) => file.type?.startsWith("image/"))
        .slice(0, Math.max(0, MAX_REFERENCES - references.length));
      if (!images.length) return;
      const next = images.map((file) => {
        const preview = URL.createObjectURL(file);
        previewUrlsRef.current.add(preview);
        return { id: crypto.randomUUID(), file, preview, name: file.name };
      });
      setReferences((current) =>
        [...current, ...next].slice(0, MAX_REFERENCES),
      );
      setIterationSource("");
    },
    [references.length],
  );

  const generate = useCallback(async () => {
    setLocalError("");
    if (isIteration && !iterationBrief.trim()) {
      setLocalError("请描述本次迭代只需要修改的内容");
      setTabletPane("controls");
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
    const devices = isIteration
      ? [
          getDesignDevice(
            tree.metaByOutput[iterationSource]?.deviceId || viewDeviceId,
          ),
        ]
      : selectedDeviceIds.map(getDesignDevice);
    const controller = new AbortController();
    taskControllerRef.current?.abort();
    taskControllerRef.current = controller;
    setRunning(true);
    setStatus("正在上传参考图...");
    setTabletPane("canvas");
    const groupId = `ui-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const uploaded = [];
      for (const item of references)
        uploaded.push(
          await uploadAiInputFile(item.file, { signal: controller.signal }),
        );
      for (let index = 0; index < devices.length; index += 1) {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const target = devices[index];
        setStatus(`正在生成 ${target.label}（${index + 1}/${devices.length}）`);
        const sourceUrls = [
          ...uploaded,
          ...(iterationSource ? [iterationSource] : []),
        ];
        const outputSize = outputSizeForRatio(target.ratio);
        const created = await createServerAiJob({
          kind: iterationSource ? "ui-design-edit" : "ui-design-generation",
          clientRequestId: crypto.randomUUID(),
          prompt: buildPrompt(target),
          input: {
            source: "ui-design-workshop",
            sourceUrls,
            aspectRatio: target.ratio,
            size: outputSize,
            outputSize,
            quality: "high",
            platform: target.label,
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
            aspectRatio: target.ratio,
            size: outputSize,
            outputSize,
            quality: "high",
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
        });
        const jobId = created.job?.id;
        if (!jobId) throw new Error("任务创建后未返回任务 ID");
        activeJobIdsRef.current.add(jobId);
        const completed = await waitForServerAiJob(jobId, {
          signal: controller.signal,
          onStatus: setStatus,
        });
        activeJobIdsRef.current.delete(jobId);
        const url =
          completed.result?.outputs?.[0] ||
          completed.job?.originalMediaUrls?.[0] ||
          "";
        if (!url) throw new Error("任务已完成，但没有返回可用图片");
        const entry = {
          url,
          jobId,
          groupId,
          groupIndex: index,
          parent: iterationSource,
          deviceId: target.id,
          createdAt: completed.job?.createdAt || new Date().toISOString(),
        };
        setEntries((current) => [
          entry,
          ...current.filter((item) => item.url !== url),
        ]);
        setActiveOutput(url);
        setViewDeviceId(target.id);
      }
      if (iterationSource) {
        setIterationSource("");
        setIterationBrief("");
      }
      notificationService.success("设计稿生成完成");
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setLocalError(error?.message || "设计稿生成失败");
    } finally {
      if (mountedRef.current && taskControllerRef.current === controller) {
        setRunning(false);
        setStatus("");
      }
    }
  }, [
    activeModel,
    brief,
    buildPrompt,
    hasReference,
    isIteration,
    iterationBrief,
    iterationSource,
    references,
    selectedDeviceIds,
    tree.metaByOutput,
    viewDeviceId,
  ]);

  const cancelGeneration = useCallback(async () => {
    setCancelling(true);
    taskControllerRef.current?.abort();
    await Promise.allSettled(
      [...activeJobIdsRef.current].map((id) => cancelServerAiJob(id)),
    );
    activeJobIdsRef.current.clear();
    if (mountedRef.current) {
      setRunning(false);
      setCancelling(false);
      setStatus("");
    }
  }, []);

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

  const runQuality = useCallback(async () => {
    if (!activeOutput || qualityLoading) return;
    setQualityOpen(true);
    setQualityLoading(true);
    setQualityError("");
    try {
      const result = await auditAiDesignQuality({
        image: activeOutput,
        model: analysisModelId,
        productPrompt: brief.trim(),
        pageType: pageType.label,
        style: visualStyle.label,
        density: SPEC_OPTIONS.density.find(([id]) => id === spec.density)?.[1],
        colorScheme: colorScheme === "dark" ? "深色" : "浅色",
        reviewMode: qualityMode,
      });
      const snapshot = {
        ...result,
        output: activeOutput,
        version: activeVersionLabel,
        reviewMode: qualityMode,
        auditedAt: new Date().toISOString(),
      };
      setQualityByOutput((current) => ({
        ...current,
        [`${qualityMode}::${activeOutput}`]: snapshot,
      }));
      setQualitySelected(snapshot.issues?.map((item) => item.id) || []);
    } catch (error) {
      setQualityError(error?.message || "品质检查失败");
    } finally {
      setQualityLoading(false);
    }
  }, [
    activeOutput,
    activeVersionLabel,
    analysisModelId,
    brief,
    colorScheme,
    pageType.label,
    qualityLoading,
    qualityMode,
    spec.density,
    visualStyle.label,
  ]);

  const beginRegion = (event) => {
    if (!regionMode || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    regionStartRef.current = point;
    setRegion({ ...point, width: 0, height: 0 });
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
    setRegion({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  };
  const finishRegion = (event) => {
    if (!regionStartRef.current) return;
    regionStartRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    setRegion((current) => {
      if (
        !current ||
        current.width * rect.width < 8 ||
        current.height * rect.height < 8
      ) {
        setRegionError("框选范围太小，请至少拖出 8×8 像素的区域");
        return null;
      }
      setRegionMode(false);
      setRegionStatus("勾选识别类型后开始分析");
      return current;
    });
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
    setRegionElements((current) => [
      ...current.filter((item) => item.manual !== true),
      node,
    ]);
    setRegionMarked([id]);
  };

  const captureRegion = useCallback(async () => {
    const image = artboardRef.current?.querySelector("img");
    if (!image?.naturalWidth || !region)
      throw new Error("设计稿还在加载，请稍后再框选");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * region.width));
    canvas.height = Math.max(
      1,
      Math.round(image.naturalHeight * region.height),
    );
    const context = canvas.getContext("2d");
    context.drawImage(
      image,
      Math.round(image.naturalWidth * region.x),
      Math.round(image.naturalHeight * region.y),
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
      setRegionViewport(
        document.viewport || { width: captured.width, height: captured.height },
      );
      setRegionElements(document.nodes || []);
      setRegionMarked([]);
      setRegionStatus(
        `已定位 ${document.nodes?.length || 0} 个元素，请点选要编辑的`,
      );
    } catch (error) {
      setRegionError(error?.message || "元素分析失败");
    } finally {
      setRegionBusy(false);
    }
  }, [analysisModelId, captureRegion, regionBusy, regionRecognition]);

  const processRegion = useCallback(async () => {
    if (!region || regionBusy) return;
    const elements = regionElements.filter((item) =>
      regionMarked.includes(item.id),
    );
    const instruction = buildRegionEditInstruction({
      elements,
      userNote: regionPrompt.trim(),
      viewport: null,
      action: regionAction,
    });
    if (!instruction) {
      setRegionError("请先点选要编辑的元素，或填写具体编辑要求");
      return;
    }
    setRegionBusy(true);
    setRegionError("");
    setRegionStatus("正在准备图片编辑");
    try {
      const captured = await captureRegion();
      const blob = await (await fetch(captured.dataUrl)).blob();
      const regionReferenceDataUrl = await uploadAiTempBlob(blob);
      const requestSize = resolveRegionSelectionRequestSize(
        captured.width,
        captured.height,
      );
      const result = await generateDesignRegionImage({
        referenceImage: activeOutput,
        regionReferenceDataUrl,
        region: {
          name: "框选优化区域",
          type: "frame",
          description: instruction.slice(0, 240),
          width: captured.width,
          height: captured.height,
        },
        transparent: regionAction === "custom",
        generationMode: "strict",
        userInstruction: instruction,
        requestSize,
        quality: "high",
        preserveLayout: ["remove", "improve-icon"].includes(regionAction),
        onStage: () => setRegionStatus("正在图片编辑…"),
      });
      setRegionResult(result.dataUrl);
      setRegionStatus("编辑完成，可查看大图确认效果");
    } catch (error) {
      setRegionError(error?.message || "框选优化失败");
    } finally {
      setRegionBusy(false);
    }
  }, [
    activeOutput,
    captureRegion,
    region,
    regionAction,
    regionBusy,
    regionElements,
    regionMarked,
    regionPrompt,
  ]);

  const runFullAnalysis = useCallback(async () => {
    if (!activeOutput || analysisBusy || !analysisTypes.length) return;
    setAnalysisBusy(true);
    setAnalysisError("");
    try {
      const width =
        activeImageDimensions?.width || device.viewport?.width || 1440;
      const height =
        activeImageDimensions?.height || device.viewport?.height || 810;
      const document = await analyzeDesignCropElements({
        cropImage: activeOutput,
        width,
        height,
        recognitionTypes: analysisTypes,
        model: analysisModelId,
      });
      setAnalysisElements(document.nodes || []);
    } catch (error) {
      setAnalysisError(error?.message || "元素分析失败");
    } finally {
      setAnalysisBusy(false);
    }
  }, [
    activeImageDimensions,
    activeOutput,
    analysisBusy,
    analysisModelId,
    analysisTypes,
    device.viewport,
  ]);

  const approveRegionResult = useCallback(async () => {
    if (!regionResult || regionApproving) return;
    setRegionApproving(true);
    setRegionError("");
    try {
      const response = await fetch(regionResult);
      if (!response.ok) throw new Error("框选结果读取失败");
      const blob = await response.blob();
      const file = new File([blob], `ui-region-${Date.now()}.png`, {
        type: blob.type || "image/png",
      });
      const uploaded = await uploadFile(file);
      await createUserAsset({
        title: (regionPrompt.trim() || "框选优化素材").slice(0, 120),
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
      });
      notificationService.success("已加入素材库");
      setRegion(null);
      setRegionResult("");
      setRegionElements([]);
      setRegionMarked([]);
    } catch (error) {
      setRegionError(error?.message || "加入素材库失败");
    } finally {
      setRegionApproving(false);
    }
  }, [regionApproving, regionPrompt, regionResult]);

  const runTileRefine = useCallback(async () => {
    if (!activeOutput || running || tilePhase) return;
    const confirmed = window.confirm(
      "四宫格精修会把当前设计稿十字切成 4 块，并发生成后按原坐标硬拼回完整图。预计消耗约 4 张图费用，是否继续？",
    );
    if (!confirmed) return;
    const controller = new AbortController();
    taskControllerRef.current?.abort();
    taskControllerRef.current = controller;
    setLocalError("");
    setTilePhase("preparing");
    setTileProgress(
      ["左上", "右上", "左下", "右下"].map((label) => ({
        label,
        status: "pending",
      })),
    );
    const intermediateIds = [];
    try {
      const sourceBlob = await fetchAuthenticatedMediaBlob(activeOutput, {
        cache: "no-store",
        signal: controller.signal,
      });
      const extracted = await extractQuadrantTileFiles(sourceBlob);
      const uploaded = [];
      for (const entry of extracted.files) {
        uploaded.push({
          ...entry,
          url: await uploadAiInputFile(entry.file, {
            signal: controller.signal,
          }),
        });
      }
      setTilePhase("generating");
      const generatedUrls = await Promise.all(
        uploaded.map(async (entry, index) => {
          setTileProgress((current) =>
            current.map((item, at) =>
              at === index ? { ...item, status: "running" } : item,
            ),
          );
          const outputLongSide = resolveTileOutputLongSide(entry.tile);
          const outputSize = outputSizeForRatio(
            entry.tile.aspectLabel || entry.tile.aspectRatio,
            outputLongSide,
          );
          const created = await createServerAiJob({
            kind: "ui-design-tile-refine-edit",
            clientRequestId: crypto.randomUUID(),
            prompt: buildTileRefinePrompt({
              quadrantLabel: entry.tile.label,
              aspectLabel: entry.tile.aspectLabel || entry.tile.aspectRatio,
            }),
            input: {
              source: "ui-design-workshop",
              sourceUrls: [entry.url],
              aspectRatio: entry.tile.aspectLabel || entry.tile.aspectRatio,
              size: outputSize,
              outputSize,
              quality: "high",
              deviceId: viewDeviceId,
              viewId: `tile-${entry.tile.id}`,
              parentOutputUrl: activeOutput,
              iterationMode: true,
              batchIndex: index,
              batchSize: 4,
            },
            params: {
              publicModelKey: activeModel?.publicModelKey,
              modelHint: activeModel?.id,
              size: outputSize,
              outputSize,
              quality: "high",
              suppressHistory: true,
              batchIndex: index,
              batchSize: 4,
            },
            units: 1,
          });
          const jobId = created.job?.id;
          if (!jobId) throw new Error("精修任务未返回任务 ID");
          intermediateIds.push(jobId);
          const completed = await waitForServerAiJob(jobId, {
            signal: controller.signal,
          });
          const url =
            completed.result?.outputs?.[0] ||
            completed.job?.originalMediaUrls?.[0] ||
            "";
          if (!url) throw new Error(`${entry.tile.label}精修没有返回图片`);
          setTileProgress((current) =>
            current.map((item, at) =>
              at === index ? { ...item, status: "done" } : item,
            ),
          );
          return url;
        }),
      );
      setTilePhase("stitching");
      const blobs = [];
      for (const url of generatedUrls) {
        blobs.push(
          await fetchAuthenticatedMediaBlob(url, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );
      }
      const stitched = await stitchQuadrantTiles({
        tiles: extracted.tiles,
        tileImages: blobs,
        originalCrops: extracted.files.map((entry) => entry.cropFile),
        fullWidth: extracted.width,
        fullHeight: extracted.height,
      });
      const url = await uploadAiTempBlob(stitched.file, {
        signal: controller.signal,
      });
      const next = {
        url,
        parentOutputUrl: activeOutput,
        deviceId: viewDeviceId,
        width: stitched.width,
        height: stitched.height,
      };
      setTileEntry(next);
      setTileDialogOpen(true);
      setTilePhase("done");
      await Promise.allSettled(
        intermediateIds.map((id) => deleteServerAiJob(id)),
      );
      notificationService.success("四宫格精修完成，已合并为完整设计稿");
    } catch (error) {
      if (error?.name !== "AbortError")
        setLocalError(error?.message || "四宫格精修失败");
      setTilePhase("");
    }
  }, [activeModel, activeOutput, running, tilePhase, viewDeviceId]);

  const tileBusy = Boolean(tilePhase && tilePhase !== "done");

  const artboardRatio = device.ratio.split(":").map(Number);
  const artboardStyle = {
    aspectRatio: `${artboardRatio[0]} / ${artboardRatio[1]}`,
    width: `min(100%, calc((100vh - var(--app-header-offset, 64px) - 220px) * ${artboardRatio[0] / artboardRatio[1]}))`,
  };
  const assembledPrompt = buildPrompt(device);

  return (
    <main
      ref={rootRef}
      className={`dws${!entries.length && !running ? " is-blank" : ""} is-tablet-${tabletPane}${isDark ? "" : " is-light"}`}
      style={{ "--dws-brand": brandColor }}
    >
      <div className="dws-shell">
        <nav className="dws-tablet-tabs" aria-label="平板工作区视图">
          <button
            type="button"
            className={tabletPane === "controls" ? "is-on" : ""}
            aria-pressed={tabletPane === "controls"}
            onClick={() => setTabletPane("controls")}
          >
            <i className="bi bi-sliders2" />
            <span>参数</span>
          </button>
          <button
            type="button"
            className={tabletPane === "canvas" ? "is-on" : ""}
            aria-pressed={tabletPane === "canvas"}
            onClick={() => setTabletPane("canvas")}
          >
            <i className="bi bi-easel2" />
            <span>画布</span>
            {majors.length > 0 && <em>{majors.length}</em>}
          </button>
        </nav>
        <aside className="dws-panel">
          <div className="dws-panel-scroll">
            <section className="dws-engine">
              <span className="dws-engine-icon">
                <i className="bi bi-cpu" />
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
                          <small>仅修改明确描述的内容</small>
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
                                setReferences((current) =>
                                  current.filter(
                                    (entry) => entry.id !== item.id,
                                  ),
                                )
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
                      isIteration || references.length >= MAX_REFERENCES
                    }
                    aria-label={`添加参考图，还可添加 ${MAX_REFERENCES - references.length} 张`}
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
                accept="image/*"
                multiple
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </section>
            {isIteration ? (
              <section className="dws-block dws-iteration-guide">
                <header>
                  <div>
                    <small>CONTROLLED ITERATION</small>
                    <strong>受控迭代进行中</strong>
                  </div>
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
                </header>
                <ol>
                  <li>
                    <b>1</b>
                    <span>
                      基准成稿 <em>{activeVersionLabel || "当前版本"}</em>
                      ，只出这一端
                    </span>
                  </li>
                  <li>
                    <b>2</b>
                    <span>在上方输入框写「只改什么」</span>
                  </li>
                  <li>
                    <b>3</b>
                    <span>其余布局、配色、组件、文案全部锁定</span>
                  </li>
                </ol>
              </section>
            ) : (
              <>
                <section className="dws-block">
                  <span className="dws-label">设备载体 · 可多选同版生成</span>
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
                        <small>{item.ratio}</small>
                      </button>
                    ))}
                  </div>
                </section>
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
                        {designMetrics.columns} 列 ·{" "}
                        {designMetrics.controlHeight}px · 大众用户 · 转化 · 均衡
                        · 标准
                      </small>
                    </span>
                    <i className="bi bi-chevron-right" />
                  </button>
                </section>
              </>
            )}
            <details className="dws-prompt-preview" open={promptPreviewOpen}>
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  setPromptPreviewOpen((current) => !current);
                }}
              >
                <i className="bi bi-braces" />
                查看将要发送的完整提示词
                <i
                  className={`bi bi-chevron-down${promptPreviewOpen ? " is-open" : ""}`}
                />
              </summary>
              <pre>{assembledPrompt}</pre>
            </details>
            {localError && (
              <p className="dws-error" role="alert">
                <i className="bi bi-exclamation-circle" />
                {localError}
              </p>
            )}
          </div>
          <div className="dws-generate-dock">
            <button
              className="dws-generate"
              type="button"
              disabled={running || tileBusy}
              aria-label={`${isIteration ? "生成迭代稿" : references.length ? "参考图重绘" : "生成设计稿"}，${costLabel}`}
              onClick={generate}
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
                <small>
                  {running ? "正在创建界面结构与视觉细节" : "预计扣费"}
                </small>
              </span>
              <span className="dws-generate-price">
                <strong>{costLabel}</strong>
              </span>
            </button>
          </div>
        </aside>
        <section className="dws-stage">
          <div className="dws-stage-ambient" />
          <div className="dws-stage-meta" aria-hidden="true">
            <span>{device.label}</span>
            <b>{device.ratio}</b>
            {activeVersionLabel && <em>{activeVersionLabel}</em>}
          </div>
          <div className="dws-stage-spec" aria-hidden="true">
            <span>
              <i className="bi bi-grid-3x3-gap" />
              {designMetrics.columns} COL
            </span>
            <span>{designMetrics.spacing} PT</span>
            <span>{designMetrics.controlHeight} PX</span>
            <span>{radiusLabel}</span>
          </div>
          <div className="dws-stage-actions">
            <button
              type="button"
              className="is-quality"
              disabled={!activeOutput || running || qualityLoading}
              onClick={() => {
                setQualityOpen(true);
                if (!qualityAudit) void runQuality();
              }}
            >
              <i
                className={`bi ${qualityLoading ? "bi-arrow-repeat spin" : "bi-patch-check"}`}
              />
              <span>
                {qualityLoading
                  ? "检查中"
                  : qualityAudit
                    ? `${qualityAudit.score} 分`
                    : "品质检查"}
              </span>
            </button>
            <button
              type="button"
              className="is-editor"
              disabled={!activeOutput || running}
              onClick={() => setAnalysisOpen(true)}
            >
              <i className="bi bi-bounding-box" />
              <span>分析元素</span>
            </button>
            <button
              type="button"
              className={`is-region${regionMode || region ? " is-on" : ""}`}
              disabled={!activeOutput || running || regionBusy}
              onClick={() => {
                if (regionMode || region) {
                  setRegionMode(false);
                  setRegion(null);
                  setRegionElements([]);
                } else setRegionMode(true);
              }}
            >
              <i className="bi bi-bounding-box-circles" />
              <span>
                {regionMode ? "拖拽框选" : region ? "取消框选" : "框选优化"}
              </span>
            </button>
            <button
              type="button"
              disabled={!activeOutput || running || !canIterate(activeNode)}
              onClick={() => {
                setIterationSource(activeOutput);
                setIterationBrief("");
                setReferences([]);
                setTabletPane("controls");
              }}
            >
              <i className="bi bi-arrow-repeat" />
              <span>迭代此版本</span>
            </button>
            <button
              type="button"
              className="is-tile-refine"
              disabled={!activeOutput || running || tileBusy}
              title="四宫格精修将在下一步弹出精修结果"
              onClick={() =>
                tileEntry ? setTileDialogOpen(true) : void runTileRefine()
              }
            >
              <i
                className={`bi ${tileBusy ? "bi-arrow-repeat spin" : "bi-grid-3x3-gap"}`}
              />
              <span>
                {tileBusy ? "精修中" : tileEntry ? "查看精修" : "四宫格精修"}
              </span>
            </button>
            <button
              type="button"
              disabled={!activeOutput}
              onClick={() =>
                downloadAuthenticatedMedia(
                  activeOutput,
                  `ui-design-${Date.now()}.png`,
                )
              }
            >
              <i className="bi bi-download" />
              <span>下载</span>
            </button>
          </div>
          <div className={`dws-canvas${tileBusy ? " is-tile-refine" : ""}`}>
            {tileBusy && (
              <div className="dws-tile-refine" aria-live="polite">
                <div className="dws-tile-refine-card">
                  <header>
                    <i className="bi bi-grid-3x3-gap" />
                    <div>
                      <strong>
                        {tilePhase === "preparing"
                          ? "正在精密切图…"
                          : tilePhase === "stitching"
                            ? "正在无损拼接四象限…"
                            : "正在分象限高精度重绘…"}
                      </strong>
                      <small>
                        标准比例贴边 → 四路精修 → 对齐回裁 → 归属区防重影拼接
                      </small>
                    </div>
                  </header>
                  <ul>
                    {tileProgress.map((item, index) => (
                      <li key={index} className={`is-${item.status}`}>
                        <i
                          className={`bi ${item.status === "done" ? "bi-check-circle-fill" : item.status === "running" ? "bi-arrow-repeat spin" : "bi-circle"}`}
                        />
                        <span>{item.label}</span>
                        <em>
                          {item.status === "done"
                            ? "完成"
                            : item.status === "running"
                              ? "精修中"
                              : "排队"}
                        </em>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="dws-running-cancel"
                    disabled={tilePhase === "stitching"}
                    onClick={cancelGeneration}
                  >
                    停止精修
                  </button>
                </div>
              </div>
            )}
            <div
              ref={artboardRef}
              className={`dws-artboard${activeOutput && !running && !regionMode && !region ? " is-previewable" : ""}${regionMode || region ? " is-region-selecting" : ""}`}
              style={artboardStyle}
              role={activeOutput && !running && !region ? "button" : undefined}
              tabIndex={activeOutput && !running && !region ? 0 : undefined}
              aria-label={
                activeOutput && !running && !region
                  ? "查看当前设计稿大图"
                  : undefined
              }
              onClick={() =>
                activeOutput &&
                !regionMode &&
                !region &&
                setFullscreenOpen(true)
              }
            >
              {activeOutput ? (
                <div className="dws-artboard-stage">
                  <div className="dws-artboard-page">
                    <AuthenticatedImage
                      data-studio-output
                      src={activeOutput}
                      alt="UI 设计稿预览"
                      loading="eager"
                      maxDimension={2200}
                      onLoad={(event) =>
                        setActiveImageDimensions({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                      onError={() =>
                        setMediaError("图片加载失败，请切换版本或重新生成")
                      }
                    />
                    {(regionMode || (region && activeImageDimensions)) && (
                      <div
                        className={`dws-region-layer${regionMode ? " is-drawing" : " has-selection"}`}
                        style={regionLayerStyle}
                        onPointerDown={beginRegion}
                        onPointerMove={moveRegion}
                        onPointerUp={finishRegion}
                      >
                        {regionMode && (
                          <span
                            className={`dws-region-hint${regionError ? " is-error" : ""}`}
                          >
                            <i className="bi bi-bounding-box-circles" />
                            {regionError || "按住鼠标拖拽框选要优化的区域"}
                          </span>
                        )}
                        {region && (
                          <div
                            className={`dws-region-box is-adjustable${manualMode ? " is-manual" : ""}`}
                            style={{
                              left: `${region.x * 100}%`,
                              top: `${region.y * 100}%`,
                              width: `${region.width * 100}%`,
                              height: `${region.height * 100}%`,
                            }}
                            onPointerDown={beginManualElement}
                            onPointerMove={moveManualElement}
                            onPointerUp={finishManualElement}
                          >
                            {visibleRegionElements.map((node, index) => (
                              <button
                                key={node.id}
                                type="button"
                                className={`dws-region-hit${regionMarked.includes(node.id) ? " is-marked" : ""}`}
                                data-index={index + 1}
                                style={{
                                  left: `${node.manual ? node.x * 100 : (node.x / (regionViewport?.width || 1)) * 100}%`,
                                  top: `${node.manual ? node.y * 100 : (node.y / (regionViewport?.height || 1)) * 100}%`,
                                  width: `${node.manual ? node.width * 100 : (node.width / (regionViewport?.width || 1)) * 100}%`,
                                  height: `${node.manual ? node.height * 100 : (node.height / (regionViewport?.height || 1)) * 100}%`,
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRegionMarked((current) =>
                                    current.includes(node.id)
                                      ? current.filter((id) => id !== node.id)
                                      : [...current, node.id],
                                  );
                                }}
                              >
                                {(node.text || node.name) && (
                                  <span>{node.text || node.name}</span>
                                )}
                              </button>
                            ))}
                            {manualDraft && (
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
                            {!manualMode &&
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
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyCanvas device={device} pageType={pageType} />
              )}
              {running && (
                <div className="dws-running">
                  <span className="dws-running-scan" />
                  <i className="bi bi-stars" />
                  <strong>{status || "正在生成设计稿…"}</strong>
                  <span>正在组织布局、组件与视觉层级</span>
                  <button
                    type="button"
                    className="dws-running-cancel"
                    disabled={cancelling}
                    onClick={cancelGeneration}
                  >
                    <i
                      className={`bi ${cancelling ? "bi-arrow-repeat spin" : "bi-stop-fill"}`}
                    />
                    {cancelling ? "正在确认" : "停止后续生成"}
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
          states={componentStates}
          device={device}
          onSelect={(value) => {
            if (configPicker.type === "style") setStyleId(value);
            else setBrandColor(value);
            setConfigPicker(null);
          }}
          onSpec={(key, value) =>
            setSpec((current) => ({ ...current, [key]: value }))
          }
          onState={(id) =>
            setComponentStates((current) =>
              current.includes(id)
                ? current.length > 1
                  ? current.filter((item) => item !== id)
                  : current
                : [...current, id],
            )
          }
          onClose={() => setConfigPicker(null)}
        />
      )}
      {fullscreenOpen && (
        <EcommerceFullscreenPreview
          sourceUrl={activeOutput}
          title="UI 设计稿"
          gallery={outputMaps.outputs}
          onSelect={setActiveOutput}
          onClose={() => setFullscreenOpen(false)}
          onDownload={() =>
            downloadAuthenticatedMedia(activeOutput, "ui-design.png")
          }
        />
      )}
      {regionFullscreen && regionResult && (
        <EcommerceFullscreenPreview
          sourceUrl={regionResult}
          title="框选优化结果"
          gallery={[regionResult]}
          onClose={() => setRegionFullscreen(false)}
          onDownload={() =>
            downloadAuthenticatedMedia(regionResult, "ui-region-optimize.png")
          }
        />
      )}
      {versionDrawerOpen && (
        <VersionDrawer
          light={!isDark}
          forest={tree.forest}
          activeOutput={activeOutput}
          onSelect={(url) => {
            setActiveOutput(url);
            setVersionDrawerOpen(false);
          }}
          onIterate={(node) => {
            const url = pickCarrier(node, viewDeviceId) || node.cover;
            setActiveOutput(url);
            setIterationSource(url);
            setVersionDrawerOpen(false);
            setTabletPane("controls");
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
            const ids = [
              ...new Set(
                entries
                  .filter((item) => urls.has(item.url))
                  .map((item) => item.jobId),
              ),
            ];
            await Promise.all(
              ids.map((id) => deleteServerAiJob(id, { cascade: true })),
            );
            setEntries((current) =>
              current.filter((item) => !urls.has(item.url)),
            );
            setVersionDrawerOpen(false);
          }}
          onClose={() => setVersionDrawerOpen(false)}
        />
      )}
      {qualityOpen && (
        <QualityDialog
          light={!isDark}
          audit={qualityAudit}
          loading={qualityLoading}
          error={qualityError}
          mode={qualityMode}
          selected={qualitySelected}
          onMode={(mode) => {
            setQualityMode(mode);
            setQualitySelected(
              qualityByOutput[`${mode}::${activeOutput}`]?.issues?.map(
                (item) => item.id,
              ) || [],
            );
          }}
          onRun={runQuality}
          onToggle={(id) =>
            setQualitySelected((current) =>
              current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id],
            )
          }
          onApply={() => {
            const prompt = buildQualityIterationPrompt(
              qualityAudit,
              qualitySelected,
            ).trim();
            if (prompt) {
              setIterationSource(activeOutput);
              setIterationBrief(prompt);
              setQualityOpen(false);
              setTabletPane("controls");
            }
          }}
          onClose={() => setQualityOpen(false)}
        />
      )}
      {tileDialogOpen &&
        tileEntry &&
        createPortal(
          <div
            className="dws-tile-result"
            role="dialog"
            aria-modal="true"
            aria-label="四宫格精修结果"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setTileDialogOpen(false)
            }
          >
            <section className="dws-tile-result-card">
              <header>
                <div>
                  <strong>
                    四宫格精修结果 <em>Beta</em>
                  </strong>
                  <small>
                    {tileEntry.width}×{tileEntry.height} · 亚像素对齐 ·
                    无缝合并为 1 张整图
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setTileDialogOpen(false)}
                >
                  <i className="bi bi-x-lg" />
                </button>
              </header>
              <div className="dws-tile-result-stage">
                <AuthenticatedImage
                  src={tileEntry.url}
                  alt="四宫格精修合并结果"
                  loading="eager"
                  maxDimension={2400}
                />
              </div>
              <footer>
                <button
                  type="button"
                  className="is-secondary"
                  onClick={() => {
                    setTileDialogOpen(false);
                    setTileEntry(null);
                    setTilePhase("");
                  }}
                >
                  <i className="bi bi-arrow-repeat" />
                  重新精修（约 4 张图费用）
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => {
                    setActiveOutput(tileEntry.url);
                    setTileDialogOpen(false);
                    setTilePhase("");
                    setTabletPane("canvas");
                  }}
                >
                  <i className="bi bi-check2" />
                  应用到画布
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
      {region &&
        !regionMode &&
        createPortal(
          <div
            className="dws-region-composer"
            style={{
              left:
                typeof window === "undefined"
                  ? 12
                  : Math.max(12, window.innerWidth - 316),
              top: 150,
              width: 300,
              maxHeight: "calc(100vh - 170px)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="dws-region-composer__header">
              <strong>框选优化</strong>
              <button
                type="button"
                className="dws-region-close"
                aria-label="清除框选区域"
                onClick={() => {
                  setRegion(null);
                  setRegionElements([]);
                  setRegionResult("");
                  setManualMode(false);
                  setManualDraft(null);
                }}
              >
                <i className="bi bi-x" />
              </button>
            </header>
            {regionResult && (
              <figure
                className="dws-region-composer__preview is-clickable"
                onClick={() => setRegionFullscreen(true)}
              >
                <img src={regionResult} alt="编辑结果预览" />
                <button
                  type="button"
                  className="dws-region-composer__zoom"
                  onClick={() => setRegionFullscreen(true)}
                >
                  <i className="bi bi-arrows-fullscreen" />
                  查看大图
                </button>
              </figure>
            )}
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
            <p
              className={`dws-region-composer__status${regionError ? " is-error" : regionResult ? " is-done" : ""}`}
            >
              {regionError || regionStatus}
            </p>
            {regionMarkedElements.length > 0 && !regionResult && (
              <div className="dws-region-composer__chips">
                {regionMarkedElements.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="dws-region-composer__chip"
                    onClick={() =>
                      setRegionMarked((current) =>
                        current.filter((id) => id !== node.id),
                      )
                    }
                  >
                    {node.name || node.text || node.type}
                    <i className="bi bi-x" />
                  </button>
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
                  {item.label}
                </button>
              ))}
            </div>
            <textarea
              value={regionPrompt}
              rows={4}
              maxLength={1000}
              disabled={regionBusy}
              placeholder="补充具体修改要求"
              onChange={(event) => setRegionPrompt(event.target.value)}
            />
            <label className="dws-region-composer__option">
              <input
                type="checkbox"
                checked={regionAction === "custom"}
                disabled
              />
              <span>
                {regionAction === "replace-background"
                  ? "更换背景模式输出完整背景"
                  : regionAction === "improve-icon"
                    ? "美化图标保留完整画面"
                    : regionAction === "remove"
                      ? "移除元素后保留完整画面"
                      : "透明背景"}
              </span>
            </label>
            <p className="dws-region-composer__cost">
              图片编辑 · 输出 {regionOutputSizeLabel} · 预计消耗 1 张图费用
            </p>
            <div className="dws-region-composer__actions">
              {regionResult && (
                <button
                  type="button"
                  className="is-primary"
                  disabled={regionApproving || regionBusy}
                  onClick={approveRegionResult}
                >
                  {regionApproving ? "保存中…" : "满意，加入素材库"}
                </button>
              )}
              <button
                type="button"
                className={manualMode ? "is-active" : ""}
                aria-pressed={manualMode}
                disabled={regionBusy}
                onClick={() => setManualMode((current) => !current)}
              >
                <i className="bi bi-bounding-box" />
                {manualMode ? "退出手动框选" : "手动框选元素"}
              </button>
              {regionResult && (
                <button type="button" onClick={() => setRegionFullscreen(true)}>
                  查看大图
                </button>
              )}
              <button
                type="button"
                className="is-primary"
                disabled={
                  regionBusy || (!regionPrompt.trim() && !regionMarked.length)
                }
                onClick={processRegion}
              >
                {regionBusy
                  ? "处理中…"
                  : regionResult
                    ? "重新编辑"
                    : "开始图片编辑"}
              </button>
              <button
                type="button"
                disabled={regionBusy || !regionRecognition.length}
                onClick={analyzeRegion}
              >
                {visibleRegionElements.some((item) => !item.manual)
                  ? "重新分析元素"
                  : "开始分析元素"}
              </button>
              <button
                type="button"
                disabled={regionBusy}
                onClick={() => {
                  setRegion(null);
                  setRegionMode(true);
                  setManualMode(false);
                }}
              >
                重新框选
              </button>
            </div>
          </div>,
          document.body,
        )}
      {analysisOpen &&
        createPortal(
          <div
            className="dws-analysis-layer"
            role="dialog"
            aria-modal="true"
            aria-label="元素分析"
          >
            <section className="dws-analysis-panel">
              <header>
                <div>
                  <small>AI DESIGN CANVAS</small>
                  <strong>分析设计元素</strong>
                </div>
                <button
                  type="button"
                  aria-label="关闭元素分析"
                  onClick={() => setAnalysisOpen(false)}
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
                <div className="dws-analysis-canvas">
                  <AuthenticatedImage
                    src={activeOutput}
                    alt="待分析设计稿"
                    loading="eager"
                    maxDimension={1800}
                  />
                  <div className="dws-analysis-elements">
                    {analysisElements.map((node, index) => (
                      <span
                        key={node.id}
                        style={{
                          left: `${(node.x / (activeImageDimensions?.width || device.viewport.width)) * 100}%`,
                          top: `${(node.y / (activeImageDimensions?.height || device.viewport.height)) * 100}%`,
                          width: `${(node.width / (activeImageDimensions?.width || device.viewport.width)) * 100}%`,
                          height: `${(node.height / (activeImageDimensions?.height || device.viewport.height)) * 100}%`,
                        }}
                      >
                        <b>{index + 1}</b>
                        <em>{node.name || node.type}</em>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <footer>
                <span>
                  {analysisBusy
                    ? "正在调用分析模型识别元素…"
                    : "识别文字、图标、大图和页面模块"}
                </span>
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
                  onClick={() => {
                    setAnalysisOpen(false);
                    setRegionMode(true);
                  }}
                >
                  框选局部分析
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </main>
  );
}
