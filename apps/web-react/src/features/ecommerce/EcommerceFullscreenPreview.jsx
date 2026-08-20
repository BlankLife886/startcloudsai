import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import { buildPreviewFilterCssString } from "@react/legacy-modules/features/filters/filterEngine.js";
import { FILTER_PRESETS } from "@react/legacy-modules/features/filters/filterPresets.js";
import { buildPresetFilterState } from "@react/legacy-modules/components/wallpaper/fullscreen-preview/features/filters/filterPresetApplier.js";
import "@react/legacy-styles/generated/components/common/WallevenImagePreview.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarActions.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarNavigation.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/viewport/WallpaperPreviewZoomHint.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/compare/WallpaperPreviewComparisonStage.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/info/WallpaperPreviewInfoPanel.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/info/InfoMetadataSection.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/info/InfoUserContentSection.css";
import "@react/legacy-static/components/wallpaper/fullscreen-preview/features/info/info-tags.css";
import "@react/legacy-static/components/wallpaper/fullscreen-preview/features/filters/filter-panel.css";

const FILTERS = [
  ["none", "原图", "none"],
  ["vivid", "鲜明", "saturate(1.28) contrast(1.08)"],
  ["warm", "暖色", "sepia(.16) saturate(1.14) hue-rotate(-8deg)"],
  ["cool", "冷色", "saturate(1.08) hue-rotate(12deg)"],
  ["grayscale", "黑白", "grayscale(1)"],
  ["soft", "柔和", "saturate(.86) contrast(.92) brightness(1.05)"],
];

const FILTER_GROUPS = [
  {
    label: "经典基础",
    items: [
      ["none", "原图"],
      ["auto_enhance", "自动增强"],
      ["natural", "自然"],
      ["fresh", "清新"],
      ["bright_clear", "通透"],
      ["vivid", "鲜艳"],
      ["balanced", "平衡"],
      ["hd_clear", "高清"],
      ["soft_focus", "柔焦"],
      ["cool_tone", "冷调"],
      ["warm_sun", "暖阳"],
    ],
  },
  {
    label: "胶片复古",
    items: [
      ["kodak_gold", "柯达金"],
      ["kodak_portra", "柯达人像"],
      ["fuji_classic", "富士经典"],
      ["fuji_vivid", "富士鲜艳"],
      ["cinestill_800t", "电影胶卷"],
      ["retro_film", "复古胶片"],
      ["old_photo", "老照片"],
      ["matte_film", "哑光胶片"],
      ["silver_salt", "银盐"],
      ["time_mark", "时光印记"],
    ],
  },
  {
    label: "电影氛围",
    items: [
      ["cinematic", "电影感"],
      ["black_gold", "黑金电影"],
      ["commercial_blockbuster", "商业大片"],
      ["teal_orange", "青橙电影"],
      ["midnight_theater", "午夜剧场"],
      ["sci_fi_blue", "科幻蓝调"],
      ["neon_night", "霓虹夜"],
      ["drama_light", "光影戏剧"],
    ],
  },
];

export function EcommerceFullscreenPreview({
  sourceUrl,
  // 展示图（服务端压缩大图）：优先加载；404 时自动回退 sourceUrl 原图。
  displaySourceUrl = "",
  title,
  gallery = [],
  onSelect,
  onClose,
  onDownload,
}) {
  const rootRef = useRef(null);
  const imageRef = useRef(null);
  const imageContainerRef = useRef(null);
  const processedUrlRef = useRef("");
  const cropStartRef = useRef(null);
  const previousSourceRef = useRef(sourceUrl);
  const uniqueGallery = useMemo(
    () => [...new Set(gallery.filter(Boolean))],
    [gallery],
  );
  const index = uniqueGallery.indexOf(sourceUrl);
  const [resolved, setResolved] = useState("");
  const [processedUrl, setProcessedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [, setNaturalSize] = useState({ width: 0, height: 0 });
  const [userTags, setUserTags] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fit, setFit] = useState("contain");
  const [showInfo, setShowInfo] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [comparison, setComparison] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState(null);
  const [filterId, setFilterId] = useState("none");
  const [filterTab, setFilterTab] = useState("presets");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasFilterEffect =
    filterId !== "none" ||
    brightness !== 100 ||
    contrast !== 100 ||
    saturation !== 100;
  const directFilter = FILTERS.find(([id]) => id === filterId)?.[2] || "";
  const selectedPreset = FILTER_PRESETS.find(
    (preset) => preset.id === filterId,
  );
  const presetState = buildPresetFilterState(selectedPreset);
  const filterCss = presetState
    ? buildPreviewFilterCssString(presetState.activeFilter, true, 100, {
        ...presetState.filterParams,
        brightness:
          brightness === 100 ? presetState.filterParams.brightness : brightness,
        contrast:
          contrast === 100 ? presetState.filterParams.contrast : contrast,
        saturation:
          saturation === 100 ? presetState.filterParams.saturation : saturation,
      })
    : [
        directFilter === "none" ? "" : directFilter,
        brightness === 100 ? "" : `brightness(${brightness}%)`,
        contrast === 100 ? "" : `contrast(${contrast}%)`,
        saturation === 100 ? "" : `saturate(${saturation}%)`,
      ]
        .filter(Boolean)
        .join(" ") || "none";
  const displayUrl = processedUrl || resolved;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setLoading(true);
    setError("");
    setResolved("");
    fetchAuthenticatedMediaBlob(displaySourceUrl || sourceUrl, {
      signal: controller.signal,
      // 旧任务没有展示图变体：404 时回退原图。
      fallbackUrl: displaySourceUrl ? sourceUrl : "",
    })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved(objectUrl);
      })
      .catch((loadError) => {
        if (loadError?.name === "AbortError") return;
        setResolved(sourceUrl);
      });
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displaySourceUrl, sourceUrl, loadVersion]);

  useEffect(() => {
    if (previousSourceRef.current === sourceUrl) return;
    previousSourceRef.current = sourceUrl;
    releaseProcessedUrl();
    setZoom(1);
    setRotation(0);
    setFit("contain");
    setShowInfo(false);
    setShowFilters(false);
    setComparison(false);
    setCropMode(false);
    setCropRect(null);
    setFilterId("none");
    setFilterTab("presets");
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
  }, [sourceUrl]);

  useEffect(
    () => () => {
      releaseProcessedUrl();
    },
    [],
  );

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (cropMode) cancelCrop();
        else onClose?.();
      } else if (event.key === "+" || event.key === "=") {
        setZoom((value) => Math.min(4, value + 0.2));
      } else if (event.key === "-") {
        setZoom((value) => Math.max(0.25, value - 0.2));
      } else if (event.key === "ArrowLeft" && index > 0) {
        onSelect?.(uniqueGallery[index - 1]);
      } else if (
        event.key === "ArrowRight" &&
        index >= 0 &&
        index < uniqueGallery.length - 1
      ) {
        onSelect?.(uniqueGallery[index + 1]);
      } else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cropMode, index, onClose, onSelect, uniqueGallery]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const handleClick = (event) => {
      const actionButton = event.target.closest?.("[data-preview-action]");
      if (actionButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        action(actionButton.dataset.previewAction);
        return;
      }
      const commandButton = event.target.closest?.("[data-preview-command]");
      if (commandButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const command = commandButton.dataset.previewCommand;
        if (command === "close") onClose?.();
        else if (command === "previous" && index > 0)
          onSelect?.(uniqueGallery[index - 1]);
        else if (
          command === "next" &&
          index >= 0 &&
          index < uniqueGallery.length - 1
        )
          onSelect?.(uniqueGallery[index + 1]);
        else if (command === "zoom-in")
          setZoom((value) => Math.min(4, value + 0.2));
        else if (command === "zoom-out")
          setZoom((value) => Math.max(0.25, value - 0.2));
        else if (command === "reset-view") {
          setZoom(1);
          setRotation(0);
        } else if (command === "apply-crop") void applyCrop();
        else if (command === "cancel-crop") cancelCrop();
        else if (command === "close-info") setShowInfo(false);
        else if (command === "reset-filters") resetFilters();
        else if (command === "close-filters") setShowFilters(false);
        return;
      }
      const presetButton = event.target.closest?.("[data-filter-id]");
      if (presetButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFilterId(presetButton.dataset.filterId);
        return;
      }
      const tabButton = event.target.closest?.("[data-filter-tab]");
      if (tabButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFilterTab(tabButton.dataset.filterTab);
      }
    };
    const handleInput = (event) => {
      const param = event.target?.dataset?.filterParam;
      const value = Number(event.target?.value);
      if (param === "brightness") setBrightness(value);
      else if (param === "contrast") setContrast(value);
      else if (param === "saturation") setSaturation(value);
      else return;
      event.stopImmediatePropagation();
    };
    const handleKeyActivation = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (
        !event.target.closest?.(
          "[data-preview-action],[data-preview-command],[data-filter-id],[data-filter-tab]",
        )
      )
        return;
      handleClick(event);
    };
    root.addEventListener("pointerdown", handleClick, true);
    root.addEventListener("keydown", handleKeyActivation, true);
    root.addEventListener("input", handleInput, true);
    return () => {
      root.removeEventListener("pointerdown", handleClick, true);
      root.removeEventListener("keydown", handleKeyActivation, true);
      root.removeEventListener("input", handleInput, true);
    };
  });

  useLayoutEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return undefined;
    const handleDoubleClick = (event) => {
      if (event.target.closest?.(".preview-image"))
        setZoom((value) => (value === 1 ? 2 : 1));
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("pointerdown", beginCrop);
    container.addEventListener("pointermove", moveCrop);
    container.addEventListener("pointerup", endCrop);
    container.addEventListener("pointercancel", endCrop);
    container.addEventListener("dblclick", handleDoubleClick);
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("pointerdown", beginCrop);
      container.removeEventListener("pointermove", moveCrop);
      container.removeEventListener("pointerup", endCrop);
      container.removeEventListener("pointercancel", endCrop);
      container.removeEventListener("dblclick", handleDoubleClick);
    };
  });

  function releaseProcessedUrl() {
    if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current);
    processedUrlRef.current = "";
    setProcessedUrl("");
  }

  function setProcessedBlob(blob) {
    releaseProcessedUrl();
    const url = URL.createObjectURL(blob);
    processedUrlRef.current = url;
    setProcessedUrl(url);
  }

  function action(id) {
    if (id === "rotate") setRotation((value) => value + 90);
    else if (id === "fit")
      setFit((value) => (value === "contain" ? "cover" : "contain"));
    else if (id === "info") setShowInfo((value) => !value);
    else if (id === "compare") {
      setCropMode(false);
      setCropRect(null);
      setComparison((value) => !value);
    } else if (id === "crop") {
      setComparison(false);
      setFit("contain");
      setZoom(1);
      setCropRect(null);
      setCropMode((value) => !value);
    } else if (id === "filters") setShowFilters((value) => !value);
    else if (id === "download") void downloadCurrent();
    else if (id === "fullscreen") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void rootRef.current?.requestFullscreen?.();
    }
  }

  function resetFilters() {
    setFilterId("none");
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
  }

  function imageLoaded(event) {
    const image = event.currentTarget;
    setNaturalSize({
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    });
    setLoading(false);
    setError("");
  }

  function beginCrop(event) {
    if (!cropMode || event.button !== 0) return;
    const imageRect = imageRef.current?.getBoundingClientRect();
    if (!imageRect) return;
    const x = Math.min(
      imageRect.right,
      Math.max(imageRect.left, event.clientX),
    );
    const y = Math.min(
      imageRect.bottom,
      Math.max(imageRect.top, event.clientY),
    );
    cropStartRef.current = { x, y, imageRect };
    setCropRect({ left: x, top: y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveCrop(event) {
    const start = cropStartRef.current;
    if (!start) return;
    const x = Math.min(
      start.imageRect.right,
      Math.max(start.imageRect.left, event.clientX),
    );
    const y = Math.min(
      start.imageRect.bottom,
      Math.max(start.imageRect.top, event.clientY),
    );
    setCropRect({
      left: Math.min(start.x, x),
      top: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  }

  function endCrop(event) {
    if (!cropStartRef.current) return;
    cropStartRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function cancelCrop() {
    cropStartRef.current = null;
    setCropRect(null);
    setCropMode(false);
  }

  async function applyCrop() {
    const image = imageRef.current;
    const imageRect = image?.getBoundingClientRect();
    if (
      !image ||
      !imageRect ||
      !cropRect ||
      cropRect.width < 8 ||
      cropRect.height < 8
    )
      return;
    const sourceX = Math.max(
      0,
      ((cropRect.left - imageRect.left) / imageRect.width) * image.naturalWidth,
    );
    const sourceY = Math.max(
      0,
      ((cropRect.top - imageRect.top) / imageRect.height) * image.naturalHeight,
    );
    const sourceWidth = Math.min(
      image.naturalWidth - sourceX,
      (cropRect.width / imageRect.width) * image.naturalWidth,
    );
    const sourceHeight = Math.min(
      image.naturalHeight - sourceY,
      (cropRect.height / imageRect.height) * image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth));
    canvas.height = Math.max(1, Math.round(sourceHeight));
    const context = canvas.getContext("2d");
    context.filter = filterCss;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    canvas.width = 1;
    canvas.height = 1;
    if (blob) {
      setProcessedBlob(blob);
      resetFilters();
      setRotation(0);
      cancelCrop();
    }
  }

  async function downloadCurrent() {
    const modified =
      Boolean(processedUrl) || rotation % 360 !== 0 || hasFilterEffect;
    if (!modified) {
      onDownload?.(sourceUrl);
      return;
    }
    const image = imageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return;
    const quarterTurn = Math.abs(rotation / 90) % 2 === 1;
    const canvas = document.createElement("canvas");
    canvas.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    canvas.height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    const context = canvas.getContext("2d");
    context.filter = filterCss;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    canvas.width = 1;
    canvas.height = 1;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ecommerce-design.png";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleWheel(event) {
    event.preventDefault();
    setZoom((value) =>
      Math.min(4, Math.max(0.25, value + (event.deltaY < 0 ? 0.12 : -0.12))),
    );
  }

  const actions = [
    ["rotate", "旋转图片", "bi-arrow-clockwise", false],
    [
      "fit",
      fit === "cover" ? "切换为完整显示" : "切换为铺满显示",
      fit === "cover" ? "bi-arrows-angle-contract" : "bi-arrows-angle-expand",
      fit === "cover",
    ],
    [
      "info",
      "显示信息",
      showInfo ? "bi-info-circle-fill" : "bi-info-circle",
      false,
    ],
    ["compare", "比较模式", "bi-layout-split", comparison],
    [
      "crop",
      cropMode ? "退出裁切模式" : "进入裁切模式",
      "bi-bounding-box-circles",
      cropMode,
    ],
    ["filters", "图像滤镜", "bi-sliders", showFilters || hasFilterEffect],
    ["download", "下载壁纸", "bi-download", false],
    [
      "fullscreen",
      "切换全屏",
      isFullscreen ? "bi-fullscreen-exit" : "bi-fullscreen",
      false,
    ],
  ];

  return (
    <div
      ref={rootRef}
      className="wallpaper-fullscreen-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}全屏预览`}
      data-show-info={showInfo}
      data-show-filters={showFilters}
      data-comparison={comparison}
      data-crop-mode={cropMode}
      tabIndex={-1}
    >
      <div className="preview-container">
        <div
          className="preview-controls controls-visible"
          style={{ pointerEvents: "auto" }}
        >
          {actions.map(([id, label, icon, active]) => (
            <button
              key={id}
              type="button"
              data-preview-action={id}
              className={`preview-btn${active ? " active" : ""}`}
              style={{ pointerEvents: "auto", transform: "none" }}
              title={label}
              aria-label={label}
            >
              <i className={`bi ${icon}`} style={{ pointerEvents: "none" }} />
            </button>
          ))}
          {cropMode && (
            <>
              <button
                type="button"
                className="preview-btn"
                data-preview-command="apply-crop"
                disabled={
                  !cropRect || cropRect.width < 8 || cropRect.height < 8
                }
                title="应用裁切"
                aria-label="应用裁切"
                onClick={() => void applyCrop()}
              >
                <i className="bi bi-check2" />
              </button>
              <button
                type="button"
                className="preview-btn"
                data-preview-command="cancel-crop"
                title="取消裁切"
                aria-label="取消裁切"
                onClick={cancelCrop}
              >
                <i className="bi bi-x-circle" />
              </button>
            </>
          )}
          <button
            type="button"
            className="preview-btn preview-close-btn"
            data-preview-command="close"
            title="关闭预览"
            aria-label="关闭预览"
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
        {uniqueGallery.length > 1 && (
          <div className="preview-navigation controls-visible" data-click-guard="off">
            <button
              type="button"
              className="preview-btn preview-nav-btn preview-prev-btn"
              data-preview-command="previous"
              disabled={index <= 0}
              onClick={() => onSelect?.(uniqueGallery[index - 1])}
            >
              <i className="bi bi-chevron-left" />
            </button>
            <button
              type="button"
              className="preview-btn preview-nav-btn preview-next-btn"
              data-preview-command="next"
              disabled={index < 0 || index >= uniqueGallery.length - 1}
              onClick={() => onSelect?.(uniqueGallery[index + 1])}
            >
              <i className="bi bi-chevron-right" />
            </button>
          </div>
        )}
        <div className="preview-zoom-hint controls-visible">
          <div className="zoom-buttons" data-click-guard="off">
            <button
              type="button"
              data-preview-command="zoom-in"
              onClick={() => setZoom((value) => Math.min(4, value + 0.2))}
            >
              放大+
            </button>
            <button
              type="button"
              data-preview-command="zoom-out"
              onClick={() => setZoom((value) => Math.max(0.25, value - 0.2))}
            >
              缩小-
            </button>
            <button
              type="button"
              data-preview-command="reset-view"
              onClick={() => {
                setZoom(1);
                setRotation(0);
              }}
            >
              重置
            </button>
          </div>
        </div>
        {showInfo && (
          <div className="preview-info-panel controls-visible">
            <div className="info-header">
              <div className="info-header-titles">
                <h5>壁纸信息</h5>
                <button type="button" className="info-id-btn">
                  ecommerce-design.png
                </button>
              </div>
              <button
                className="info-close-btn"
                type="button"
                data-preview-command="close-info"
                aria-label="关闭"
                onClick={() => setShowInfo(false)}
              >
                <i className="bi bi-x" />
              </button>
            </div>
            <div className="info-content">
              <section className="info-metadata-section">
                <div className="info-card-grid">
                  <button
                    type="button"
                    className="info-card info-card--wide info-card--clickable"
                  >
                    <span className="info-card-label">分辨率</span>
                    <span className="info-card-value">PNG</span>
                  </button>
                  <div className="info-card info-card--wide">
                    <span className="info-card-label">来源</span>
                    <span className="info-card-value">Wallhaven</span>
                  </div>
                </div>
              </section>
              <section className="user-content-block">
                <div className="user-content-card">
                  <input
                    type="text"
                    value={userTags}
                    placeholder="自定义标签，逗号分隔"
                    onChange={(event) => setUserTags(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`save-user-content-btn${userTags.trim() ? " is-dirty" : ""}`}
                    disabled={!userTags.trim()}
                  >
                    {userTags.trim() ? "保存" : "已保存"}
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}
        {showFilters && (
          <div className="preview-filter-panel controls-visible">
            <div className="filter-header">
              <div className="filter-header-titles">
                <h5>图像滤镜</h5>
                <span className="filter-subtitle">预览与导出效果一致</span>
              </div>
              <div className="filter-actions">
                <span className="filter-history-badge">1 / 1</span>
                <button type="button" className="filter-action-btn" disabled>
                  <i className="bi bi-arrow-counterclockwise" />
                </button>
                <button type="button" className="filter-action-btn" disabled>
                  <i className="bi bi-arrow-clockwise" />
                </button>
                <button
                  type="button"
                  className="filter-action-btn"
                  data-preview-command="reset-filters"
                  title="重置"
                  onClick={resetFilters}
                >
                  <i className="bi bi-arrow-repeat" />
                </button>
                <button
                  type="button"
                  className="filter-close-btn"
                  data-preview-command="close-filters"
                  aria-label="关闭滤镜"
                  onClick={() => setShowFilters(false)}
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            </div>
            <div className="filter-tabs">
              <button
                type="button"
                data-filter-tab="presets"
                className={`filter-tab${filterTab === "presets" ? " active" : ""}`}
              >
                预设
              </button>
              <button
                type="button"
                data-filter-tab="styles"
                className={`filter-tab${filterTab === "styles" ? " active" : ""}`}
              >
                风格
              </button>
              <button
                type="button"
                data-filter-tab="pro"
                className={`filter-tab${filterTab === "pro" ? " active" : ""}`}
              >
                调色
              </button>
            </div>
            <div className="filter-content">
              <div className="filter-tab-panel">
                {filterTab === "presets" &&
                  FILTER_GROUPS.map((group) => (
                    <section key={group.label} className="filter-group-card">
                      <div className="filter-group-head">{group.label}</div>
                      <div className="filter-preset-grid">
                        {group.items.map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            data-filter-id={id}
                            className={`filter-preset-btn${filterId === id ? " active" : ""}`}
                          >
                            <span className="preset-label">{label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                {filterTab === "styles" && (
                  <section className="filter-group-card">
                    <div className="filter-group-head">视觉风格</div>
                    <div className="filter-preset-grid">
                      {FILTERS.map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          data-filter-id={id}
                          className={`filter-preset-btn${filterId === id ? " active" : ""}`}
                        >
                          <span className="preset-label">{label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {filterTab === "pro" &&
                  [
                    ["亮度", brightness, setBrightness],
                    ["对比度", contrast, setContrast],
                    ["饱和度", saturation, setSaturation],
                  ].map(([label, value, setter]) => (
                    <label key={label} className="filter-slider">
                      <span className="filter-slider-label">
                        {label}
                        <output className="filter-slider-value">
                          {value}%
                        </output>
                      </span>
                      <input
                        type="range"
                        data-filter-param={
                          label === "亮度"
                            ? "brightness"
                            : label === "对比度"
                              ? "contrast"
                              : "saturation"
                        }
                        min="50"
                        max="150"
                        value={value}
                        onChange={(event) => setter(Number(event.target.value))}
                      />
                    </label>
                  ))}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="preview-error">
            <div className="alert alert-danger">
              <i className="bi bi-exclamation-triangle-fill me-2" />
              {error}
              <button
                className="retry-load-btn"
                onClick={() => setLoadVersion((value) => value + 1)}
              >
                重试
              </button>
            </div>
          </div>
        )}
        <div ref={imageContainerRef} className="preview-image-container">
          {resolved && fit === "contain" && !comparison && (
            <div
              className="aspect-backdrop-layer"
              style={{ backgroundImage: `url("${resolved}")` }}
            />
          )}
          {comparison ? (
            <div className="comparison-stage">
              <div className="comparison-pane comparison-original">
                <img
                  src={resolved}
                  alt="Original Preview"
                  className="preview-image comparison-image"
                  draggable="false"
                  style={{
                    objectFit: "contain",
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                />
                <div className="comparison-label">原图</div>
              </div>
              <div className="comparison-pane comparison-processed">
                <img
                  ref={imageRef}
                  src={displayUrl}
                  alt={title}
                  className="preview-image"
                  draggable="false"
                  style={{
                    objectFit: "contain",
                    filter: filterCss,
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                  onLoad={imageLoaded}
                  onError={() => {
                    setLoading(false);
                    setError("图片加载失败");
                  }}
                />
                <div className="comparison-label">处理后</div>
              </div>
            </div>
          ) : (
            <div className="preview-main-pane">
              {loading && (
                <div className="preview-pane-loading" aria-hidden="true">
                  <div className="preview-pane-loading-shimmer" />
                </div>
              )}
              <div
                className={`preview-image-stage${loading ? " is-loading" : ""}`}
              >
                {displayUrl && (
                  <img
                    ref={imageRef}
                    src={displayUrl}
                    alt={title}
                    className={`preview-image${loading ? " is-revealing" : ""}`}
                    draggable="false"
                    style={{
                      objectFit: fit,
                      filter: filterCss,
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    }}
                    onLoad={imageLoaded}
                    onError={() => {
                      setLoading(false);
                      setError("图片加载失败");
                    }}
                    onDoubleClick={() =>
                      setZoom((value) => (value === 1 ? 2 : 1))
                    }
                  />
                )}
              </div>
            </div>
          )}
          {cropMode && cropRect && (
            <div
              className="crop-selection-box"
              style={{
                left: cropRect.left,
                top: cropRect.top,
                width: cropRect.width,
                height: cropRect.height,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
