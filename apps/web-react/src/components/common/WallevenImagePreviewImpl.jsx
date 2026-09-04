import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import copyToClipboard from "copy-to-clipboard";
import {
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from "@react/legacy-modules/services/authenticatedMedia.js";
import { getScopedLocalItem, setScopedLocalItem } from "@react/legacy-modules/services/scopedLocalStorage.js";
import { applyColorGradeToCanvas, buildPreviewFilterCssString } from "@react/legacy-modules/features/filters/filterEngine.js";
import { FILTER_PRESET_GROUPS, FILTER_PRESETS } from "@react/legacy-modules/features/filters/filterPresets.js";
import { applyArtStyleToCanvas, ART_STYLE_PARAM_CONFIG, ART_STYLE_PRESETS, buildDefaultArtStyleParams } from "@react/legacy-modules/features/filters/artStyleEngine.js";
import { buildPresetFilterState } from "@react/legacy-modules/components/wallpaper/fullscreen-preview/features/filters/filterPresetApplier.js";
import { defaultFilterParams } from "@react/legacy-modules/components/wallpaper/fullscreen-preview/features/filters/filterStateUtils.js";
import "@react/legacy-styles/generated/components/common/WallevenImagePreview.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarActions.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/toolbar/PreviewToolbarNavigation.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/viewport/WallpaperPreviewZoomHint.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/compare/WallpaperPreviewComparisonStage.css";
import "@react/legacy-styles/generated/components/wallpaper/fullscreen-preview/features/info/WallpaperPreviewInfoPanel.css";
import "@react/legacy-static/components/wallpaper/fullscreen-preview/features/info/info-tags.css";
import "@react/legacy-static/components/wallpaper/fullscreen-preview/features/filters/filter-panel.css";
import "@react/components/common/WallevenImagePreview.css";
import { usePreviewViewport } from "@react/components/common/usePreviewViewport.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { DownloadIcon } from "./DownloadIcon.jsx";
import { WallevenRegionEditor } from "./WallevenRegionEditor.jsx";

const FILTERS = [
  ["none", "原图", "none"],
  ["vivid", "鲜明", "saturate(1.28) contrast(1.08)"],
  ["warm", "暖色", "sepia(.16) saturate(1.14) hue-rotate(-8deg)"],
  ["cool", "冷色", "saturate(1.08) hue-rotate(12deg)"],
  ["grayscale", "黑白", "grayscale(1)"],
  ["soft", "柔和", "saturate(.86) contrast(.92) brightness(1.05)"],
];

const LUT_OPTIONS = [
  ["none", "无"], ["clean", "纯净"], ["film_gold", "金色胶片"],
  ["kodak_portra", "柯达人像"], ["fuji_classic", "富士经典"],
  ["fuji_vivid", "富士鲜艳"], ["film_matte", "哑光胶片"],
  ["cinestill", "电影胶片"], ["cinema", "电影"], ["blockbuster", "商业大片"],
  ["noir", "黑白电影"], ["dream", "梦幻"], ["nature", "自然"],
  ["night", "夜景"], ["neon", "霓虹"], ["cyber", "赛博"],
];

const CAMERA_OPTIONS = [
  ["none", "无"], ["canon_portrait", "Canon 人像"],
  ["nikon_landscape", "Nikon 风景"], ["sony_clean", "Sony 清晰"],
  ["leica_classic", "Leica 经典"], ["hasselblad_natural", "哈苏自然"],
  ["ricoh_gr", "Ricoh GR"], ["iphone_vivid", "iPhone 鲜明"],
];

const FILTER_ADJUST_GROUPS = [
  { title: "基础", items: [["brightness", "亮度", 0, 200, 1, "%"], ["contrast", "对比度", 0, 200, 1, "%"]] },
  { title: "光影", items: [["saturation", "饱和度", 0, 200, 1, "%"], ["blur", "模糊", 0, 20, 0.5, "px"], ["exposure", "曝光", -100, 100, 1], ["highlights", "高光", -100, 100, 1], ["shadows", "阴影", -100, 100, 1], ["blackPoint", "黑位", -100, 100, 1]] },
  { title: "色彩", items: [["grayscale", "灰度", 0, 100, 1, "%"], ["sepia", "褐调", 0, 100, 1, "%"], ["invert", "反相", 0, 100, 1, "%"], ["temperature", "色温", -100, 100, 1], ["vibrance", "自然饱和", -100, 100, 1], ["shadowCool", "冷影", 0, 100, 1, "%"], ["highlightWarm", "暖光", 0, 100, 1, "%"]] },
  { title: "胶片与 LUT", items: [["fade", "褪色", 0, 100, 1, "%"], ["vignette", "暗角", 0, 100, 1, "%"], ["grain", "颗粒", 0, 100, 1, "%"], ["curveStrength", "曲线", -100, 100, 1], ["lutStyle", "LUT 风格", "select", LUT_OPTIONS], ["lutIntensity", "LUT 强度", 0, 100, 1, "%"]] },
  { title: "细节与人像", items: [["clarity", "清晰度", -100, 100, 1], ["skinSmooth", "肤色柔化", 0, 100, 1, "%"], ["skinWarmth", "肤色暖度", -100, 100, 1], ["skinProtect", "肤色保护", 0, 100, 1, "%"], ["cameraProfile", "相机色彩", "select", CAMERA_OPTIONS], ["profileIntensity", "相机强度", 0, 100, 1, "%"]] },
];

const DESKTOP_MOCKUP_PRESETS = {
  macos: [[1728, 1117, "MacBook Pro 16"], [1512, 982, "MacBook Pro 14"], [2240, 1260, "iMac 24"]],
  windows: [[1920, 1080, "Full HD"], [2560, 1440, "QHD"], [3840, 2160, "4K UHD"]],
};

const INFO_LABELS = {
  category: "分类",
  ratio: "画面比例",
  aspectRatio: "画面比例",
  style: "风格",
  model: "模型",
  modelName: "模型",
  provider: "服务商",
  quality: "质量",
  prompt: "提示词",
};

const RESERVED_INFO_KEYS = new Set([
  "id", "resolution", "size", "fileSize", "file_type", "path",
  "dimension_x", "dimension_y", "width", "height", "tags", "colors",
  "category", "ratio", "aspectRatio", "style", "purity", "views", "favorites",
  "uploader", "date_added", "created_at", "createdAt", "source", "provider",
]);

function displayInfoValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "";
  if (typeof value === "string") return value.trim();
  return "";
}

export function WallevenImagePreviewImpl({
  sourceUrl,
  // 展示图（服务端压缩大图）：优先加载；404 时自动回退 sourceUrl 原图。
  displaySourceUrl = "",
  title = "图片预览",
  gallery = [],
  displaySources = {},
  onSelect,
  onClose,
  onDownload,
  filename = "image.png",
  metadata = {},
  enabledActions = {},
  actionBusy = "",
  regionEditBusy = false,
  onUseReference,
  onRegionEdit,
  onFavorite,
  onPublish,
  onDelete,
  onProcessed,
}) {
  const rootRef = useRef(null);
  const imageRef = useRef(null);
  const imageContainerRef = useRef(null);
  const processedUrlRef = useRef("");
  const processedKindRef = useRef("");
  const processingTokenRef = useRef(0);
  const cropStartRef = useRef(null);
  const mockupDragRef = useRef(null);
  const mockupImageReadyRef = useRef(false);
  const previousMockupUrlRef = useRef("");
  const controlsTimerRef = useRef(0);
  const filterHistoryTimerRef = useRef(0);
  const applyingFilterHistoryRef = useRef(false);
  const previousSourceRef = useRef(sourceUrl);
  const preferredFitModeRef = useRef(
    getScopedLocalItem("fullscreen_preview_fit_mode") === "cover" ? "cover" : "contain",
  );
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
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [aspectBackdropUrl, setAspectBackdropUrl] = useState("");
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
  const [filterAdjustments, setFilterAdjustments] = useState({});
  const [activeArtStyle, setActiveArtStyle] = useState("none");
  const [artStyleIntensity, setArtStyleIntensity] = useState(60);
  const [artStyleParams, setArtStyleParams] = useState(() => buildDefaultArtStyleParams());
  const [filterHistory, setFilterHistory] = useState([
    { filterId: "none", brightness: 100, contrast: 100, saturation: 100, filterAdjustments: {}, activeArtStyle: "none", artStyleIntensity: 60, artStyleParams: buildDefaultArtStyleParams() },
  ]);
  const [filterHistoryIndex, setFilterHistoryIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [controlsHovered, setControlsHovered] = useState(false);
  const [mockupMode, setMockupMode] = useState("none");
  const [showMockupSettings, setShowMockupSettings] = useState(false);
  const [mockupImagePosition, setMockupImagePosition] = useState({ x: 50, y: 50 });
  const [mockupImageReady, setMockupImageReady] = useState(false);
  const [mockupHoldoverUrl, setMockupHoldoverUrl] = useState("");
  const [mockupCompanionUrl, setMockupCompanionUrl] = useState("");
  const [desktopClock, setDesktopClock] = useState(() => new Date());
  const [desktopConfig, setDesktopConfig] = useState({ platform: "macos", width: 1728, height: 1117 });
  const [decomposeOpen, setDecomposeOpen] = useState(false);
  const [decomposeGridSize, setDecomposeGridSizeState] = useState(3);
  const [decomposedTiles, setDecomposedTiles] = useState([]);
  const [decomposeSwitching, setDecomposeSwitching] = useState(false);
  const [regionEditorOpen, setRegionEditorOpen] = useState(false);
  const hasFilterEffect =
    filterId !== "none" ||
    activeArtStyle !== "none" ||
    Object.keys(filterAdjustments).length > 0 ||
    brightness !== 100 ||
    contrast !== 100 ||
    saturation !== 100;
  const directFilter = FILTERS.find(([id]) => id === filterId)?.[2] || "";
  const selectedPreset = FILTER_PRESETS.find(
    (preset) => preset.id === filterId,
  );
  const presetState = buildPresetFilterState(selectedPreset);
  const effectiveFilterParams = {
    ...defaultFilterParams,
    ...(presetState?.filterParams || {}),
    ...filterAdjustments,
    brightness: brightness === 100 ? presetState?.filterParams?.brightness ?? 100 : brightness,
    contrast: contrast === 100 ? presetState?.filterParams?.contrast ?? 100 : contrast,
    saturation: saturation === 100 ? presetState?.filterParams?.saturation ?? 100 : saturation,
  };
  const filterCss = presetState
    ? buildPreviewFilterCssString(presetState.activeFilter, true, 100, effectiveFilterParams)
    : [
        directFilter === "none" ? "" : directFilter,
        brightness === 100 ? "" : `brightness(${brightness}%)`,
        contrast === 100 ? "" : `contrast(${contrast}%)`,
        saturation === 100 ? "" : `saturate(${saturation}%)`,
      ]
        .filter(Boolean)
        .join(" ") || "none";
  const displayUrl = processedUrl || resolved;
  const displayFilterCss = processedUrl ? "none" : filterCss;
  const actionEnabled = (id) => enabledActions[id] !== false;
  const resolution =
    naturalSize.width && naturalSize.height
      ? `${naturalSize.width} × ${naturalSize.height}`
      : metadata.resolution || "未知分辨率";
  const fileSize = metadata.size || metadata.fileSize || "未知大小";
  const sourceLabel = metadata.source || "";
  const wallpaperId = metadata.id ? String(metadata.id) : "";
  const headerSummary = [resolution, fileSize]
    .filter((value) => value && !String(value).startsWith("未知"))
    .join(" · ");
  const systemTags = Array.isArray(metadata.tags) ? metadata.tags : [];
  const colors = Array.isArray(metadata.colors) ? metadata.colors : [];
  const ratioText = metadata.ratio || (
    Number(metadata.dimension_x || metadata.width) && Number(metadata.dimension_y || metadata.height)
      ? `${metadata.dimension_x || metadata.width}:${metadata.dimension_y || metadata.height}`
      : ""
  );
  const uploader = typeof metadata.uploader === "string"
    ? metadata.uploader
    : metadata.uploader?.username || metadata.uploader?.name || "";
  const createdAt = metadata.date_added || metadata.created_at || metadata.createdAt;
  const dateText = createdAt && !Number.isNaN(new Date(createdAt).getTime())
    ? new Date(createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "";
  const infoRows = [
    ["分类", metadata.category],
    ["画面比例", ratioText],
    ["风格", metadata.style],
    ["纯净度", metadata.purity ? String(metadata.purity).toUpperCase() : ""],
    ["浏览量", metadata.views],
    ["收藏数", metadata.favorites],
    ["上传者", uploader],
    ["创建时间", dateText],
    ["来源", sourceLabel],
    ...Object.entries(metadata)
      .filter(([key]) => !RESERVED_INFO_KEYS.has(key))
      .map(([key, value]) => [INFO_LABELS[key] || key, value]),
  ]
    .map(([label, value]) => ({ label, value: displayInfoValue(value) }))
    .filter((row, rowIndex, rows) => row.value && rows.findIndex((item) => item.label === row.label) === rowIndex);
  const viewport = usePreviewViewport({
    imageRef,
    viewportRef: imageContainerRef,
    onActivity: revealControls,
    getPreferredFitMode: () => preferredFitModeRef.current,
  });
  const {
    zoom,
    rotation,
    baseFitMode: fit,
    dragging,
    transformStyle: imageTransformStyle,
  } = viewport;

  function revealControls() {
    setShowControls(true);
    window.clearTimeout(controlsTimerRef.current);
    if (controlsHovered || showInfo || showFilters || cropMode || decomposeOpen)
      return;
    controlsTimerRef.current = window.setTimeout(
      () => setShowControls(false),
      3000,
    );
  }

  useLayoutEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    rootRef.current?.focus();
    setShowControls(true);
    window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(
      () => setShowControls(false),
      3000,
    );
    return () => {
      window.clearTimeout(controlsTimerRef.current);
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const requestedUrl = displaySourceUrl || sourceUrl;
    let active = true;
    let resolvedUrl = "";
    setLoading(true);
    setError("");
    setResolved("");
    resolveAuthenticatedMediaUrl(requestedUrl, {
      // 旧任务没有展示图变体：404 时回退原图。
      fallbackUrl: displaySourceUrl ? sourceUrl : "",
    })
      .then((url) => {
        resolvedUrl = url;
        if (!active) {
          releaseAuthenticatedMediaUrl(requestedUrl, resolvedUrl);
          return;
        }
        setResolved(resolvedUrl);
      })
      .catch((loadError) => {
        if (!active || loadError?.name === "AbortError") return;
        setError(loadError?.message || "图片加载失败");
        setLoading(false);
      });
    return () => {
      active = false;
      if (resolvedUrl) {
        releaseAuthenticatedMediaUrl(requestedUrl, resolvedUrl);
      }
    };
  }, [displaySourceUrl, sourceUrl, loadVersion]);

  useEffect(() => {
    if (index < 0 || uniqueGallery.length < 2) return undefined;
    let active = true;
    const resolvedNeighbors = [];
    const neighbors = [uniqueGallery[index - 1], uniqueGallery[index + 1]]
      .filter(Boolean)
      .filter((value, neighborIndex, values) => values.indexOf(value) === neighborIndex);

    neighbors.forEach((neighborSource) => {
      const neighborDisplay =
        typeof displaySources === "function"
          ? displaySources(neighborSource)
          : displaySources?.[neighborSource];
      const requestedUrl = neighborDisplay || neighborSource;
      void resolveAuthenticatedMediaUrl(requestedUrl, {
        fallbackUrl: neighborDisplay ? neighborSource : "",
      })
        .then((url) => {
          if (active) resolvedNeighbors.push([requestedUrl, url]);
          else releaseAuthenticatedMediaUrl(requestedUrl, url);
        })
        .catch(() => {});
    });

    return () => {
      active = false;
      resolvedNeighbors.forEach(([requestedUrl, url]) =>
        releaseAuthenticatedMediaUrl(requestedUrl, url),
      );
    };
  }, [displaySources, index, uniqueGallery]);

  useEffect(() => {
    if (previousSourceRef.current === sourceUrl) return;
    previousSourceRef.current = sourceUrl;
    releaseProcessedUrl();
    viewport.resetView();
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
    setFilterAdjustments({});
    setActiveArtStyle("none");
    setArtStyleIntensity(60);
    setArtStyleParams(buildDefaultArtStyleParams());
    setFilterHistory([
      { filterId: "none", brightness: 100, contrast: 100, saturation: 100, filterAdjustments: {}, activeArtStyle: "none", artStyleIntensity: 60, artStyleParams: buildDefaultArtStyleParams() },
    ]);
    setFilterHistoryIndex(0);
    setAspectBackdropUrl("");
    setMockupMode("none");
    setShowMockupSettings(false);
    setMockupImagePosition({ x: 50, y: 50 });
    setDecomposeOpen(false);
    setDecomposedTiles([]);
    setDecomposeGridSizeState(3);
  }, [sourceUrl]);

  useEffect(() => {
    const platform = getScopedLocalItem("fullscreen_preview_desktop_mockup_platform");
    const width = Number(getScopedLocalItem("fullscreen_preview_desktop_mockup_width"));
    const height = Number(getScopedLocalItem("fullscreen_preview_desktop_mockup_height"));
    setDesktopConfig({
      platform: platform === "windows" ? "windows" : "macos",
      width: Number.isFinite(width) && width >= 320 ? width : 1728,
      height: Number.isFinite(height) && height >= 240 ? height : 1117,
    });
  }, []);

  useEffect(() => {
    const previousUrl = previousMockupUrlRef.current;
    if (previousUrl && previousUrl !== displayUrl && mockupImageReadyRef.current) {
      setMockupHoldoverUrl(previousUrl);
    }
    if (displayUrl) {
      mockupImageReadyRef.current = false;
      setMockupImageReady(false);
    }
    previousMockupUrlRef.current = displayUrl;
  }, [displayUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => setDesktopClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mockupMode !== "none") return;
    mockupImageReadyRef.current = false;
    setMockupImageReady(false);
    setMockupHoldoverUrl("");
    setMockupCompanionUrl("");
  }, [mockupMode]);

  function updateDesktopConfig(patch) {
    setDesktopConfig((current) => {
      const nextPlatform = patch.platform === "windows" ? "windows" : patch.platform === "macos" ? "macos" : current.platform;
      const currentIsPreset = DESKTOP_MOCKUP_PRESETS[current.platform].some(
        ([width, height]) => width === current.width && height === current.height,
      );
      const platformDefault = DESKTOP_MOCKUP_PRESETS[nextPlatform][0];
      const nextSource = patch.platform && currentIsPreset
        ? { ...current, width: platformDefault[0], height: platformDefault[1], ...patch }
        : { ...current, ...patch };
      const maxDisplaySide = nextPlatform === "macos" ? 4096 : 8192;
      const next = {
        platform: nextPlatform,
        width: Math.min(maxDisplaySide, Math.max(320, Math.round(Number(nextSource.width) || platformDefault[0]))),
        height: Math.min(maxDisplaySide, Math.max(240, Math.round(Number(nextSource.height) || platformDefault[1]))),
      };
      setScopedLocalItem("fullscreen_preview_desktop_mockup_platform", next.platform);
      setScopedLocalItem("fullscreen_preview_desktop_mockup_width", String(next.width));
      setScopedLocalItem("fullscreen_preview_desktop_mockup_height", String(next.height));
      return next;
    });
  }

  useEffect(() => {
    if (applyingFilterHistoryRef.current) {
      applyingFilterHistoryRef.current = false;
      return undefined;
    }
    window.clearTimeout(filterHistoryTimerRef.current);
    filterHistoryTimerRef.current = window.setTimeout(() => {
      const snapshot = { filterId, brightness, contrast, saturation, filterAdjustments, activeArtStyle, artStyleIntensity, artStyleParams };
      setFilterHistory((current) => {
        const active = current[filterHistoryIndex];
        if (active && JSON.stringify(active) === JSON.stringify(snapshot)) return current;
        const next = [...current.slice(0, filterHistoryIndex + 1), snapshot].slice(-30);
        setFilterHistoryIndex(next.length - 1);
        return next;
      });
    }, 180);
    return () => window.clearTimeout(filterHistoryTimerRef.current);
  }, [activeArtStyle, artStyleIntensity, artStyleParams, brightness, contrast, filterAdjustments, filterId, saturation]);

  useEffect(() => {
    const hasEffects =
      filterId !== "none" ||
      activeArtStyle !== "none" ||
      Object.keys(filterAdjustments).length > 0 ||
      brightness !== 100 ||
      contrast !== 100 ||
      saturation !== 100;
    if (!hasEffects || !resolved) {
      if (processedKindRef.current === "filter") releaseProcessedUrl();
      return undefined;
    }
    const token = ++processingTokenRef.current;
    const timer = window.setTimeout(() => {
      const source = new Image();
      source.onload = () => {
        if (token !== processingTokenRef.current) return;
        const maxPixels = 1900 * 1900;
        const scale = source.naturalWidth * source.naturalHeight > maxPixels
          ? Math.sqrt(maxPixels / (source.naturalWidth * source.naturalHeight))
          : 1;
        const width = Math.max(1, Math.round(source.naturalWidth * scale));
        const height = Math.max(1, Math.round(source.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.filter = filterCss;
        context.drawImage(source, 0, 0, width, height);
        context.filter = "none";
        applyColorGradeToCanvas(context, width, height, effectiveFilterParams);
        if (activeArtStyle !== "none") {
          applyArtStyleToCanvas(
            context,
            width,
            height,
            activeArtStyle,
            artStyleIntensity,
            artStyleParams,
          );
        }
        if (token !== processingTokenRef.current) return;
        processedKindRef.current = "filter";
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        processedUrlRef.current = dataUrl;
        setProcessedUrl(dataUrl);
        canvas.width = 1;
        canvas.height = 1;
      };
      source.src = resolved;
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeArtStyle, artStyleIntensity, artStyleParams, brightness, contrast, filterAdjustments, filterCss, filterId, resolved, saturation]);

  useEffect(() => {
    revealControls();
    return () => window.clearTimeout(controlsTimerRef.current);
  }, [controlsHovered, cropMode, decomposeOpen, showFilters, showInfo]);

  useEffect(
    () => () => {
      releaseProcessedUrl();
      const drag = mockupDragRef.current;
      if (drag) {
        window.removeEventListener("pointermove", drag.move);
        window.removeEventListener("pointerup", drag.end);
        window.removeEventListener("pointercancel", drag.end);
      }
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
        onClose?.();
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
  }, [index, onClose, onSelect, uniqueGallery]);

  useLayoutEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return undefined;
    const handleDoubleClick = (event) => {
      if (event.target.closest?.(".preview-image"))
        viewport.toggleZoom(event);
    };
    container.addEventListener("wheel", viewport.handleWheel, { passive: false });
    container.addEventListener("pointerdown", beginPointerInteraction);
    container.addEventListener("pointermove", movePointerInteraction);
    container.addEventListener("pointerup", endPointerInteraction);
    container.addEventListener("pointercancel", endPointerInteraction);
    container.addEventListener("dblclick", handleDoubleClick);
    return () => {
      container.removeEventListener("wheel", viewport.handleWheel);
      container.removeEventListener("pointerdown", beginPointerInteraction);
      container.removeEventListener("pointermove", movePointerInteraction);
      container.removeEventListener("pointerup", endPointerInteraction);
      container.removeEventListener("pointercancel", endPointerInteraction);
      container.removeEventListener("dblclick", handleDoubleClick);
    };
  });

  function releaseProcessedUrl() {
    if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current);
    processedUrlRef.current = "";
    processedKindRef.current = "";
    setProcessedUrl("");
  }

  function setProcessedBlob(blob) {
    releaseProcessedUrl();
    const url = URL.createObjectURL(blob);
    processedUrlRef.current = url;
    processedKindRef.current = "crop";
    setProcessedUrl(url);
  }

  function actionContext() {
    return {
      sourceUrl,
      displayUrl,
      title,
      filename,
      metadata,
      prompt: String(metadata.prompt || title || "").trim(),
    };
  }

  async function copyImage() {
    try {
      const response = await fetch(sourceUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error("图片读取失败");
      const blob = await response.blob();
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持复制图片");
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      notificationService.success("图片已复制");
    } catch (caught) {
      notificationService.error(caught?.message || "复制图片失败");
    }
  }

  async function copyPrompt() {
    const prompt = actionContext().prompt;
    if (!prompt) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
      else if (!copyToClipboard(prompt)) throw new Error("复制失败");
      notificationService.success("提示词已复制");
    } catch {
      if (copyToClipboard(prompt)) notificationService.success("提示词已复制");
      else notificationService.error("复制提示词失败");
    }
  }

  function action(id) {
    const context = actionContext();
    if (id === "copy-image") void copyImage();
    else if (id === "reference") void onUseReference?.(context);
    else if (id === "region-edit") setRegionEditorOpen(true);
    else if (id === "copy-prompt") void copyPrompt();
    else if (id === "favorite") void onFavorite?.(context);
    else if (id === "publish") void onPublish?.(context);
    else if (id === "delete") void onDelete?.(context);
    else if (id === "desktop-mockup") {
      setComparison(false);
      cancelCrop();
      setMockupMode((value) => (value === "desktop" ? "none" : "desktop"));
    } else if (id === "phone-mockup") {
      setComparison(false);
      cancelCrop();
      setMockupMode((value) => (value.startsWith("phone-") ? "none" : "phone-iphone"));
    } else if (id === "mockup-settings") {
      setShowMockupSettings((value) => !value);
    } else if (id === "decompose") {
      setMockupMode("none");
      setComparison(false);
      cancelCrop();
      void decomposeImage(decomposeGridSize);
    }
    else if (id === "rotate") viewport.rotate();
    else if (id === "fit") {
      const nextFitMode = fit === "cover" ? "contain" : "cover";
      preferredFitModeRef.current = nextFitMode;
      setScopedLocalItem("fullscreen_preview_fit_mode", nextFitMode);
      viewport.toggleFitMode();
    }
    else if (id === "info") setShowInfo((value) => !value);
    else if (id === "compare") {
      setMockupMode("none");
      setCropMode(false);
      setCropRect(null);
      setComparison((value) => !value);
    } else if (id === "crop") {
      setMockupMode("none");
      setComparison(false);
      if (fit !== "contain") {
        preferredFitModeRef.current = "contain";
        setScopedLocalItem("fullscreen_preview_fit_mode", "contain");
      }
      viewport.resetView("contain");
      setCropRect(null);
      setCropMode((value) => !value);
    } else if (id === "filters") setShowFilters((value) => !value);
    else if (id === "download") void downloadCurrent();
    else if (id === "fullscreen") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void rootRef.current?.requestFullscreen?.();
    }
  }

  function closeFromPointer(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onClose?.();
  }

  function resetFilters() {
    setFilterId("none");
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setFilterAdjustments({});
    setActiveArtStyle("none");
    setArtStyleIntensity(60);
    setArtStyleParams(buildDefaultArtStyleParams());
  }

  function updateFilterParam(key, value) {
    if (key === "brightness") setBrightness(Number(value));
    else if (key === "contrast") setContrast(Number(value));
    else if (key === "saturation") setSaturation(Number(value));
    else setFilterAdjustments((current) => ({ ...current, [key]: value }));
  }

  function updateArtStyleParam(key, value) {
    setArtStyleParams((current) => ({
      ...current,
      [activeArtStyle]: { ...(current[activeArtStyle] || {}), [key]: Number(value) },
    }));
  }

  async function copyInfoValue(value) {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard?.writeText?.(text);
    } catch {
      // Clipboard access is optional in embedded browsers.
    }
  }

  function restoreFilterHistory(nextIndex) {
    const snapshot = filterHistory[nextIndex];
    if (!snapshot) return;
    applyingFilterHistoryRef.current = true;
    setFilterHistoryIndex(nextIndex);
    setFilterId(snapshot.filterId);
    setBrightness(snapshot.brightness);
    setContrast(snapshot.contrast);
    setSaturation(snapshot.saturation);
    setFilterAdjustments(snapshot.filterAdjustments || {});
    setActiveArtStyle(snapshot.activeArtStyle || "none");
    setArtStyleIntensity(snapshot.artStyleIntensity ?? 60);
    setArtStyleParams(snapshot.artStyleParams || buildDefaultArtStyleParams());
  }

  function imageLoaded(event) {
    const image = event.currentTarget;
    setNaturalSize({
      width: image.naturalWidth || 0,
      height: image.naturalHeight || 0,
    });
    setLoading(false);
    setError("");
    viewport.resetZoom();
    if (image.naturalWidth && image.naturalHeight) {
      try {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight, 1);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        setAspectBackdropUrl(canvas.toDataURL("image/jpeg", 0.52));
        canvas.width = 1;
        canvas.height = 1;
      } catch {
        setAspectBackdropUrl("");
      }
    }
  }

  function mockupImageLoaded(event) {
    mockupImageReadyRef.current = true;
    setMockupImageReady(true);
    setMockupHoldoverUrl("");
    if (displayUrl) setMockupCompanionUrl(displayUrl);
    imageLoaded(event);
  }

  function beginPointerInteraction(event) {
    if (event.target.closest?.(".preview-minimap")) return;
    if (cropMode) {
      beginCrop(event);
      return;
    }
    if (comparison || mockupMode !== "none") return;
    viewport.startDrag(event);
  }

  function movePointerInteraction(event) {
    if (cropStartRef.current) {
      moveCrop(event);
      return;
    }
  }

  function endPointerInteraction(event) {
    if (cropStartRef.current) endCrop(event);
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

  async function buildDecomposedTiles(size) {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return [];
    const count = Number(size) || 3;
    const tileWidth = Math.floor(image.naturalWidth / count);
    const tileHeight = Math.floor(image.naturalHeight / count);
    const nextTiles = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        const sourceX = column * tileWidth;
        const sourceY = row * tileHeight;
        const sourceWidth = column === count - 1 ? image.naturalWidth - sourceX : tileWidth;
        const sourceHeight = row === count - 1 ? image.naturalHeight - sourceY : tileHeight;
        const canvas = document.createElement("canvas");
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.filter = displayFilterCss;
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        );
        nextTiles.push({
          id: `r${row + 1}c${column + 1}`,
          index: row * count + column + 1,
          selected: true,
          dataUrl: canvas.toDataURL("image/jpeg", 0.95),
        });
        canvas.width = 1;
        canvas.height = 1;
      }
    }
    return nextTiles;
  }

  async function decomposeImage(size) {
    const nextTiles = await buildDecomposedTiles(size);
    if (!nextTiles.length) return;
    setDecomposeGridSizeState(size);
    setDecomposedTiles(nextTiles);
    setDecomposeOpen(true);
  }

  async function changeDecomposeGridSize(size) {
    if (size === decomposeGridSize || decomposeSwitching) return;
    setDecomposeSwitching(true);
    const nextTiles = await buildDecomposedTiles(size);
    if (nextTiles.length) {
      window.setTimeout(() => {
        setDecomposeGridSizeState(size);
        setDecomposedTiles(nextTiles);
        setDecomposeSwitching(false);
      }, 180);
    } else setDecomposeSwitching(false);
  }

  function toggleDecomposedTile(id) {
    setDecomposedTiles((current) =>
      current.map((tile) =>
        tile.id === id ? { ...tile, selected: !tile.selected } : tile,
      ),
    );
  }

  function downloadDecomposedTiles() {
    const selected = decomposedTiles.filter((tile) => tile.selected);
    const prefix = filename.replace(/\.[^.]+$/, "") || "image";
    selected.forEach((tile) => {
      const anchor = document.createElement("a");
      anchor.href = tile.dataUrl;
      anchor.download = `${prefix}_tile_${tile.id}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
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
    context.filter = displayFilterCss;
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
      onProcessed?.({ blob, src: sourceUrl });
      resetFilters();
      viewport.resetView();
      cancelCrop();
    }
  }

  function startMockupImageDrag(event) {
    if (event.button !== 0) return;
    mockupDragRef.current?.end?.();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();
    const screen = event.currentTarget;
    const pointerId = event.pointerId;
    screen.setPointerCapture?.(pointerId);
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      position: mockupImagePosition,
    };
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      setMockupImagePosition({
        x: Math.min(100, Math.max(0, start.position.x - ((moveEvent.clientX - start.x) / start.width) * 100)),
        y: Math.min(100, Math.max(0, start.position.y - ((moveEvent.clientY - start.y) / start.height) * 100)),
      });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (screen.hasPointerCapture?.(pointerId)) screen.releasePointerCapture(pointerId);
      mockupDragRef.current = null;
    };
    mockupDragRef.current = { move, end };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function drawCoverImage(context, image, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceWidth, (image.naturalWidth - sourceWidth) * (mockupImagePosition.x / 100)));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight, (image.naturalHeight - sourceHeight) * (mockupImagePosition.y / 100)));
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  }

  function downloadMockupWallpaper() {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return;
    const desktop = mockupMode === "desktop";
    const width = desktop ? desktopConfig.width * (desktopConfig.platform === "macos" ? 2 : 1) : 1290;
    const height = desktop ? desktopConfig.height * (desktopConfig.platform === "macos" ? 2 : 1) : 2796;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(8192, width);
    canvas.height = Math.min(8192, height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.filter = displayFilterCss;
    drawCoverImage(context, image, canvas.width, canvas.height);
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/jpeg", 0.95);
    anchor.download = `${filename.replace(/\.[^.]+$/, "")}_${desktop ? "desktop" : "phone"}_wallpaper.jpg`;
    anchor.click();
    canvas.width = 1;
    canvas.height = 1;
  }

  async function downloadCurrent() {
    if (mockupMode !== "none") {
      downloadMockupWallpaper();
      return;
    }
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
    context.filter = displayFilterCss;
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
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions = [
    ["desktop-mockup", "桌面样机预览", "bi-display", mockupMode === "desktop"],
    ...(mockupMode === "desktop" ? [["mockup-settings", "样机配置", "bi-gear", showMockupSettings]] : []),
    ["phone-mockup", "手机样机预览", "bi-phone", mockupMode.startsWith("phone-")],
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
    ["decompose", "分解图片（3x3）", "bi-grid-3x3-gap", decomposeOpen],
    ["filters", "图像滤镜", "bi-sliders", showFilters || hasFilterEffect],
    ["copy-image", "复制图片", actionBusy === "copy-image" ? "bi-check2" : "bi-copy", false, { disabled: Boolean(actionBusy) }],
    ["reference", "用作参考图", "bi-image", false, { disabled: !onUseReference || Boolean(actionBusy) }],
    ["region-edit", "局部编辑", "bi-brush", false, { disabled: !onRegionEdit || regionEditBusy || Boolean(actionBusy) }],
    ["copy-prompt", "复制提示词", "bi-card-text", false, { disabled: !actionContext().prompt || Boolean(actionBusy) }],
    ["favorite", "收藏到资产", actionBusy === "favorite" ? "bi-check2" : "bi-folder-plus", false, { disabled: !onFavorite || Boolean(actionBusy) }],
    ["publish", "发布作品", "bi-send", false, { disabled: !onPublish || Boolean(actionBusy) }],
    ["delete", "删除图片", "bi-trash3", false, { danger: true, disabled: !onDelete || Boolean(actionBusy) }],
    ["download", "下载图片", "bi-download", false],
    [
      "fullscreen",
      "切换全屏",
      isFullscreen ? "bi-fullscreen-exit" : "bi-fullscreen",
      false,
    ],
  ].filter(([id]) => {
    if (id === "desktop-mockup" || id === "phone-mockup")
      return actionEnabled("mockup");
    return actionEnabled(id);
  });

  return createPortal(
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
      data-click-guard="off"
      tabIndex={-1}
      onPointerMove={revealControls}
    >
      <div className="preview-container">
        <div
          className={`preview-controls${showControls ? " controls-visible" : ""}`}
          style={{ pointerEvents: "auto" }}
          onPointerEnter={() => setControlsHovered(true)}
          onPointerLeave={() => setControlsHovered(false)}
        >
          {actions.map(([id, label, icon, active, options = {}]) => (
            <button
              key={id}
              type="button"
              data-preview-action={id}
              className={`preview-btn${active ? " active" : ""}${options.danger ? " is-danger" : ""}`}
              style={{ pointerEvents: "auto", transform: "none" }}
              title={label}
              aria-label={label}
              disabled={options.disabled}
              onClick={() => action(id)}
            >
              {icon === "bi-download" ? <DownloadIcon style={{ pointerEvents: "none" }} /> : <i className={`bi ${icon}`} style={{ pointerEvents: "none" }} />}
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
            onPointerDown={closeFromPointer}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose?.();
            }}
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
        {uniqueGallery.length > 1 && (
          <div
            className={`preview-navigation${showControls ? " controls-visible" : ""}`}
            data-click-guard="off"
            onPointerEnter={() => setControlsHovered(true)}
            onPointerLeave={() => setControlsHovered(false)}
          >
            <button
              type="button"
              className="preview-btn preview-nav-btn preview-prev-btn"
              data-preview-command="previous"
              title="上一张"
              aria-label="上一张"
              disabled={index <= 0}
              onClick={() => onSelect?.(uniqueGallery[index - 1])}
            >
              <i className="bi bi-chevron-left" />
            </button>
            <button
              type="button"
              className="preview-btn preview-nav-btn preview-next-btn"
              data-preview-command="next"
              title="下一张"
              aria-label="下一张"
              disabled={index < 0 || index >= uniqueGallery.length - 1}
              onClick={() => onSelect?.(uniqueGallery[index + 1])}
            >
              <i className="bi bi-chevron-right" />
            </button>
          </div>
        )}
        {uniqueGallery.length > 1 && (
          <span className={`preview-gallery-counter${showControls ? " controls-visible" : ""}`} aria-live="polite">
            {Math.max(0, index) + 1} / {uniqueGallery.length}
          </span>
        )}
        <div className={`preview-zoom-hint${showControls ? " controls-visible" : ""}`}>
          <div className="zoom-buttons" data-click-guard="off">
            <button
              type="button"
              data-preview-command="zoom-in"
              title="放大图片"
              aria-label="放大图片"
              onClick={viewport.zoomIn}
            >
              <i className="bi bi-plus-lg" />
            </button>
            <button
              type="button"
              data-preview-command="zoom-out"
              title="缩小图片"
              aria-label="缩小图片"
              onClick={viewport.zoomOut}
            >
              <i className="bi bi-dash-lg" />
            </button>
            <button
              type="button"
              data-preview-command="reset-view"
              title="重置视图"
              aria-label="重置视图"
              onClick={() => viewport.resetView()}
            >
              <i className="bi bi-arrow-counterclockwise" />
            </button>
            <output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output>
          </div>
        </div>
        {showInfo && (
          <div className="preview-info-panel controls-visible">
            <div className="info-header">
              <div className="info-header-titles">
                <span className="info-kicker">图片详情</span>
                <h5>{title}</h5>
                {wallpaperId && <button type="button" className="info-id-btn" title="复制 ID" onClick={() => void copyInfoValue(wallpaperId)}>ID · {wallpaperId}</button>}
                {headerSummary && <span className="info-summary">{headerSummary}</span>}
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
              <section className="info-primary" aria-label="图片尺寸">
                <span>分辨率</span>
                <strong>{resolution.startsWith("未知") ? "暂未读取" : resolution}</strong>
                {(ratioText || !fileSize.startsWith("未知")) && <small>{[ratioText, fileSize.startsWith("未知") ? "" : fileSize].filter(Boolean).join(" · ")}</small>}
              </section>
              {infoRows.length > 0 && (
                <section className="info-details" aria-label="图片元数据">
                  <span className="info-section-title">详细信息</span>
                  <div className="info-detail-list">
                    {infoRows.map((row) => (
                      <button key={row.label} type="button" className="info-detail-row" title={`复制${row.label}`} onClick={() => void copyInfoValue(row.value)}>
                        <span>{row.label}</span><strong>{row.value}</strong>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {colors.length > 0 && (
                <section className="info-visual-data"><span className="info-section-title">主色</span><div className="color-palette">{colors.map((color) => <button key={color} type="button" className="color-box" style={{ backgroundColor: color }} title={`复制 ${color}`} onClick={() => void copyInfoValue(color)} />)}</div></section>
              )}
              {systemTags.length > 0 && (
                <section className="info-visual-data"><span className="info-section-title">标签</span><div className="tags-list">{systemTags.map((tag) => { const text = typeof tag === "object" ? tag.name : tag; return <button key={typeof tag === "object" ? tag.id || tag.name : tag} type="button" className="preview-info-tag preview-info-tag-clickable" onClick={() => void copyInfoValue(text)}>{text}</button>; })}</div></section>
              )}
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
                <span className="filter-history-badge">{filterHistoryIndex + 1} / {filterHistory.length}</span>
                <button
                  type="button"
                  className="filter-action-btn"
                  disabled={filterHistoryIndex <= 0}
                  title="撤销滤镜调整"
                  onClick={() => restoreFilterHistory(filterHistoryIndex - 1)}
                >
                  <i className="bi bi-arrow-counterclockwise" />
                </button>
                <button
                  type="button"
                  className="filter-action-btn"
                  disabled={filterHistoryIndex >= filterHistory.length - 1}
                  title="重做滤镜调整"
                  onClick={() => restoreFilterHistory(filterHistoryIndex + 1)}
                >
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
                onClick={() => setFilterTab("presets")}
              >
                预设
              </button>
              <button
                type="button"
                data-filter-tab="styles"
                className={`filter-tab${filterTab === "styles" ? " active" : ""}`}
                onClick={() => setFilterTab("styles")}
              >
                风格
              </button>
              <button
                type="button"
                data-filter-tab="pro"
                className={`filter-tab${filterTab === "pro" ? " active" : ""}`}
                onClick={() => setFilterTab("pro")}
              >
                调色
              </button>
            </div>
            <div className="filter-content">
              <div className="filter-tab-panel">
                {filterTab === "presets" &&
                  FILTER_PRESET_GROUPS.filter((group) => group.id !== "custom").map((group) => (
                    <section key={group.id} className="filter-group-card">
                      <div className="filter-group-head">{group.label}</div>
                      <div className="filter-preset-grid">
                        {FILTER_PRESETS.filter((preset) => preset.group === group.id).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            data-filter-id={preset.id}
                            className={`filter-preset-btn${filterId === preset.id ? " active" : ""}`}
                            title={preset.description || preset.label}
                            onClick={() => setFilterId(preset.id)}
                          >
                            <span className="preset-label">{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                {filterTab === "styles" && (
                  <>
                    {activeArtStyle !== "none" && (
                      <section className="filter-group-card filter-group-card--style-params">
                        <div className="filter-group-head">{ART_STYLE_PRESETS.find((style) => style.id === activeArtStyle)?.label} · 参数</div>
                        <label className="filter-slider">
                          <span className="filter-slider-label">强度 <output className="filter-slider-value">{artStyleIntensity}%</output></span>
                          <input type="range" min="0" max="100" value={artStyleIntensity} onChange={(event) => setArtStyleIntensity(Number(event.target.value))} />
                        </label>
                        {(ART_STYLE_PARAM_CONFIG[activeArtStyle] || []).map((control) => (
                          <label key={control.key} className="filter-slider">
                            <span className="filter-slider-label">{control.label}<output className="filter-slider-value">{artStyleParams[activeArtStyle]?.[control.key] ?? control.defaultValue}</output></span>
                            <input type="range" min={control.min} max={control.max} step={control.step || 1} value={artStyleParams[activeArtStyle]?.[control.key] ?? control.defaultValue} onChange={(event) => updateArtStyleParam(control.key, event.target.value)} />
                          </label>
                        ))}
                      </section>
                    )}
                    <section className="filter-group-card">
                      <div className="filter-group-head">艺术风格</div>
                      <div className="filter-preset-grid">
                        {ART_STYLE_PRESETS.map((style) => (
                          <button key={style.id} type="button" className={`filter-preset-btn${activeArtStyle === style.id ? " active" : ""}`} title={style.description || style.label} onClick={() => setActiveArtStyle(style.id)}>
                            <span className="preset-label">{style.label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {filterTab === "pro" && FILTER_ADJUST_GROUPS.map((group) => (
                  <section key={group.title} className="filter-group-card">
                    <div className="filter-group-head">{group.title}</div>
                    {group.items.map(([key, label, minOrType, maxOrOptions, step, unit]) => {
                      const value = effectiveFilterParams[key];
                      return (
                        <label key={key} className="filter-slider">
                          <span className="filter-slider-label">{label}<output className="filter-slider-value">{minOrType === "select" ? maxOrOptions.find(([id]) => id === value)?.[1] || "无" : `${value}${unit || ""}`}</output></span>
                          {minOrType === "select" ? (
                            <select className="filter-select" value={value} onChange={(event) => updateFilterParam(key, event.target.value)}>
                              {maxOrOptions.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
                            </select>
                          ) : (
                            <input type="range" data-filter-param={key} min={minOrType} max={maxOrOptions} step={step} value={value} onChange={(event) => updateFilterParam(key, Number(event.target.value))} />
                          )}
                        </label>
                      );
                    })}
                  </section>
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
        <div
          ref={imageContainerRef}
          className={`preview-image-container${zoom > 1 ? " zoomed-container" : ""}${dragging ? " is-dragging" : ""}`}
        >
          {aspectBackdropUrl && fit === "contain" && !comparison && (
            <div
              className="aspect-backdrop-layer"
              style={{ backgroundImage: `url("${aspectBackdropUrl}")` }}
            />
          )}
          {mockupMode !== "none" ? (
            <div className={`preview-device-mockup mockup-stage ${mockupMode === "desktop" ? "is-desktop mockup-stage--desktop" : "is-phone mockup-stage--phone"}`}>
              {mockupMode === "desktop" && showMockupSettings && (
                <aside className="desktop-mockup-settings" aria-label="桌面样机配置">
                  <div className="desktop-settings-header">
                    <div><strong>样机配置</strong><span>{desktopConfig.platform === "macos" ? "Retina 导出" : "标准屏幕"}</span></div>
                    <div className="desktop-export-chip">{desktopConfig.width * (desktopConfig.platform === "macos" ? 2 : 1)} x {desktopConfig.height * (desktopConfig.platform === "macos" ? 2 : 1)}</div>
                  </div>
                  <div className="desktop-mockup-platforms" role="group" aria-label="桌面系统">
                    <button type="button" className={desktopConfig.platform === "macos" ? "active" : ""} onClick={() => updateDesktopConfig({ platform: "macos" })}><i className="bi bi-apple" />macOS</button>
                    <button type="button" className={desktopConfig.platform === "windows" ? "active" : ""} onClick={() => updateDesktopConfig({ platform: "windows" })}><i className="bi bi-windows" />Windows</button>
                  </div>
                  <div className="desktop-mockup-size-row">
                    <label>宽度<input type="number" min="320" max="8192" value={desktopConfig.width} onChange={(event) => updateDesktopConfig({ width: Math.max(320, Number(event.target.value) || 320) })} /></label>
                    <span>x</span>
                    <label>高度<input type="number" min="240" max="8192" value={desktopConfig.height} onChange={(event) => updateDesktopConfig({ height: Math.max(240, Number(event.target.value) || 240) })} /></label>
                  </div>
                  <div className="desktop-mockup-presets">
                    {DESKTOP_MOCKUP_PRESETS[desktopConfig.platform].map(([width,height,label]) => (
                      <button key={label} type="button" className={desktopConfig.width === width && desktopConfig.height === height ? "active" : ""} onClick={() => updateDesktopConfig({ width, height })}><strong>{label}</strong><span>{width} x {height}</span></button>
                    ))}
                  </div>
                </aside>
              )}
              <div
                className={`preview-device-frame device-frame ${mockupMode === "desktop" ? `device-frame--desktop device-frame--desktop-${desktopConfig.platform}` : "device-frame--phone device-frame--iphone"}`}
                style={mockupMode === "desktop" ? {
                  "--desktop-screen-aspect": `${desktopConfig.width} / ${desktopConfig.height}`,
                  "--desktop-frame-width": `${desktopConfig.width / desktopConfig.height >= 1.7 ? 1080 : desktopConfig.width / desktopConfig.height >= 1.5 ? 980 : 880}px`,
                } : undefined}
              >
                {mockupMode === "desktop" && <div className="device-top-dot" />}
                {mockupMode !== "desktop" && mockupCompanionUrl && (
                  <>
                    <div className="phone-companion phone-companion--left" aria-hidden="true">
                      <img className="phone-companion-image" src={mockupCompanionUrl} alt="" draggable="false" style={{ objectPosition: `${mockupImagePosition.x}% ${mockupImagePosition.y}%`, filter: displayFilterCss }} />
                      <span className="phone-companion-cutout phone-companion-cutout--hole" />
                    </div>
                    <div className="phone-companion phone-companion--right" aria-hidden="true">
                      <img className="phone-companion-image" src={mockupCompanionUrl} alt="" draggable="false" style={{ objectPosition: `${mockupImagePosition.x}% ${mockupImagePosition.y}%`, filter: displayFilterCss }} />
                      <span className="phone-companion-cutout phone-companion-cutout--pill" />
                    </div>
                  </>
                )}
                <div className="preview-device-screen device-screen" onPointerDown={startMockupImageDrag}>
                  {mockupMode === "desktop" && <div className="desktop-metal-bezel" aria-hidden="true"><span className="desktop-metal-shine" /></div>}
                  {mockupHoldoverUrl && (
                    <img
                      className="device-screen-image device-screen-image--holdover is-screen-loaded"
                      src={mockupHoldoverUrl}
                      alt=""
                      aria-hidden="true"
                      draggable="false"
                      style={{ objectPosition: `${mockupImagePosition.x}% ${mockupImagePosition.y}%` }}
                    />
                  )}
                  <img
                    ref={imageRef}
                    src={displayUrl}
                    alt={`${title}样机预览`}
                    className={`device-screen-image${mockupImageReady ? " is-screen-loaded" : ""}`}
                    draggable="false"
                    style={{ objectFit: "cover", objectPosition: `${mockupImagePosition.x}% ${mockupImagePosition.y}%`, filter: mockupImageReady ? displayFilterCss : undefined }}
                    onLoad={mockupImageLoaded}
                  />
                  {mockupMode === "desktop" ? (
                    <>
                      <div className="desktop-screen-edge" aria-hidden="true" />
                      <div className="desktop-os-overlay" aria-hidden="true">
                        <div className="desktop-folder-column">
                          {[["壁纸", "bi-folder-fill"], ["收藏", "bi-folder-fill"], ["下载", "bi-folder-fill"]].map(([label, icon]) => (
                            <div key={label} className="desktop-folder"><i className={`bi ${icon}`} /><span>{label}</span></div>
                          ))}
                        </div>
                        <div className="desktop-clock">
                          <div className="desktop-clock-date">{desktopClock.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</div>
                          <div className="desktop-clock-time">{desktopClock.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="phone-os-overlay" aria-hidden="true">
                      <div className="phone-status-bar"><span>09:41</span><div className="phone-status-icons"><i className="bi bi-reception-4" /><i className="bi bi-wifi" /><i className="bi bi-battery-full" /></div></div>
                      <div className="phone-home-indicator" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : comparison ? (
            <div className="comparison-stage">
              <div className="comparison-pane comparison-original">
                <img
                  src={resolved}
                  alt="Original Preview"
                  className="preview-image comparison-image"
                  draggable="false"
                  style={{
                    objectFit: "contain",
                    ...imageTransformStyle,
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
                    filter: displayFilterCss,
                    ...imageTransformStyle,
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
                      objectFit: "contain",
                      filter: displayFilterCss,
                      ...imageTransformStyle,
                      cursor: viewport.cursor,
                    }}
                    onLoad={imageLoaded}
                    onError={() => {
                      setLoading(false);
                      setError("图片加载失败");
                    }}
                  />
                )}
              </div>
              {loading && (
                <div className="preview-pane-loading-status" aria-live="polite">
                  <span className="preview-pane-loading-dot" />
                  正在加载高清图片
                </div>
              )}
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
          {viewport.minimap && !comparison && !cropMode && mockupMode === "none" && (
            <button
              type="button"
              className="preview-minimap"
              aria-label="移动当前预览范围"
              style={{ width: viewport.minimap.width, height: viewport.minimap.height }}
              onPointerDown={viewport.startMinimapDrag}
            >
              <img className="preview-minimap-image" src={displayUrl} alt="" draggable="false" />
              <span
                className="preview-minimap-viewport"
                style={{
                  width: viewport.minimap.viewportWidth,
                  height: viewport.minimap.viewportHeight,
                  left: viewport.minimap.viewportLeft,
                  top: viewport.minimap.viewportTop,
                }}
              />
            </button>
          )}
        </div>
        {decomposeOpen && (
          <aside
            className={`decompose-panel decompose-panel--${naturalSize.width >= naturalSize.height ? "landscape" : "portrait"}`}
            role="dialog"
            aria-label="图片分解"
          >
            <div className="decompose-grid-size-switch" role="group" aria-label="网格密度">
              {[2, 3, 4].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`decompose-size-btn${decomposeGridSize === size ? " active" : ""}`}
                  aria-pressed={decomposeGridSize === size}
                  onClick={() => void changeDecomposeGridSize(size)}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
            <div
              className={`decompose-grid-frame${decomposeSwitching ? " switching" : ""}`}
              style={{
                gridTemplateColumns: `repeat(${decomposeGridSize}, 1fr)`,
                gridTemplateRows: `repeat(${decomposeGridSize}, 1fr)`,
                "--source-aspect": `${naturalSize.width || 16} / ${naturalSize.height || 9}`,
              }}
            >
              {decomposedTiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  className={`decompose-tile${tile.selected ? " selected" : ""}`}
                  aria-pressed={tile.selected}
                  aria-label={`分块 ${tile.index}${tile.selected ? "，已选中" : ""}`}
                  disabled={decomposeSwitching}
                  onClick={() => toggleDecomposedTile(tile.id)}
                >
                  <img src={tile.dataUrl} alt={`分块 ${tile.index}`} draggable="false" />
                  {tile.selected ? (
                    <span className="decompose-tile-check" aria-hidden="true"><i className="bi bi-check-lg" /></span>
                  ) : (
                    <span className="decompose-tile-dim" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            <div className="decompose-footer">
              <button
                type="button"
                className="decompose-download-btn"
                disabled={!decomposedTiles.some((tile) => tile.selected)}
                onClick={downloadDecomposedTiles}
              >
                <DownloadIcon />
                下载已选
                <span className="decompose-download-count">{decomposedTiles.filter((tile) => tile.selected).length}</span>
              </button>
              <button type="button" className="decompose-cancel-btn" onClick={() => setDecomposeOpen(false)}>取消分解</button>
            </div>
          </aside>
        )}
        {regionEditorOpen && (
          <WallevenRegionEditor
            sourceUrl={sourceUrl}
            title={title}
            modelLabel={String(metadata.model || metadata.modelName || "图片模型")}
            busy={regionEditBusy}
            onClose={() => !regionEditBusy && setRegionEditorOpen(false)}
            onSubmit={async (payload) => {
              const result = await onRegionEdit?.(payload, actionContext());
              if (result !== false) setRegionEditorOpen(false);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
